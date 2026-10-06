// Persistence. Two interchangeable backends:
//   server  - serve.py keeps profile.json / index.json / config.json in your
//             per-user data folder (durable, outside the app folder, backed up)
//   local   - falls back to localStorage when no server is there
// The API key lives in "config", apart from your data, so exporting or sharing
// your history never includes it.

import { loadState, splitState, emptyState, mergeImport, SCHEMA } from './state.js';

const HEADERS = { 'X-Unfurl': '1' }; // custom header => other websites can't talk to the local server

export class Store {
  constructor({ fetchFn = (...a) => fetch(...a), storage = globalThis.localStorage, retryBaseMs = 1000 } = {}) {
    this.fetchFn = fetchFn; this.storage = storage; this.retryBaseMs = retryBaseMs;
    this.retryTimer = null; this.attempts = 0;
    this.onSaveState = () => {};   // called with (ok:boolean, message) when saving to the server starts failing or recovers
    this.saveOk = true;
    this.rev = null;               // the saved profile's revision as of our last read/write (server mode)
    this.hostProblem = null;       // {host, allowed}: the server refused the address this page was opened with
    this.onMerged = () => {};      // called when changes made elsewhere (another tab/device) were merged in
    this.mode = 'local';
    this.server = { version: null, dataDir: null, build: '', pollSeconds: 0, ytProxy: false, ytDailyUnits: 0, user: null, multiUser: false };
    this.state = emptyState();
    this.config = { apiKey: '' };
    this.readOnly = false;       // data from a newer app version: never write
    this.notes = [];             // things to tell the user once (upgrades, recovery)
    this.recoveredFrom = null;
    this.lastError = null;
    this.timer = null;
    this.written = { profile: null, index: null };  // last JSON written, so unchanged files aren't rewritten
    this.chain = Promise.resolve();
  }

  async init() {
    try {
      const res = await this.fetchFn('/api/ping', { headers: HEADERS });
      let j = null;
      if (res.ok) j = await res.json();
      else if (res.status === 403) {
        // The server is there but refuses the name this page was opened with. Don't pretend to be a server-less app:
        // anything saved here would end up stranded in this browser.
        const why = await res.json().catch(() => null);
        if (why?.reason === 'host') this.hostProblem = { host: why.host ?? '', allowed: why.allowed ?? [] };
      }
      if (j?.app === 'unfurl') {
        this.mode = 'server';
        this.server = { version: j.version, dataDir: j.dataDir ?? null, build: j.build ?? '', pollSeconds: j.pollSeconds ?? 0, ytProxy: !!j.ytProxy, ytDailyUnits: j.ytDailyUnits ?? 0, user: j.user ?? null, multiUser: !!j.multiUser };
      }
    } catch { /* no server: stay local */ }

    let profile, index, legacy = null, config, unreadable = false;
    if (this.mode === 'server') {
      const p = await this.#fetchJson('/api/profile'), ix = await this.#fetchJson('/api/index'), cfg = await this.#fetchJson('/api/config');
      // "no file yet" (ok, null) is very different from "couldn't read it" (not ok): never start fresh and overwrite on the latter.
      if (!p.ok || !ix.ok) unreadable = true;
      profile = p.data?.data ?? null;
      this.recoveredFrom = p.data?.recoveredFrom ?? null;
      this.rev = p.data?.rev ?? null;
      index = ix.data;
      config = cfg.data;
      if (!profile && !unreadable) legacy = (await this.#fetchJson('/api/legacy')).data;
    } else {
      profile = this.#readLocal('unfurl.profile');
      index = this.#readLocal('unfurl.index');
      config = this.#readLocal('unfurl.config');
      if (!profile) legacy = this.#readLocal('unfurl.state');
    }
    const loaded = loadState({ profile, index, legacy });
    this.state = loaded.state;
    this.readOnly = loaded.readOnly || unreadable || !!this.hostProblem;
    this.notes = [...this.notes, ...loaded.notes];
    if (unreadable) this.notes.push('Couldn’t read your saved data from the Unfurl server just now. To be safe nothing will be saved this session, so your real data can’t be overwritten. Reload the page (or restart serve.py) and try again.');
    if (this.recoveredFrom) this.notes.push(`Your data file was damaged, so it was restored from the backup “${this.recoveredFrom}”. The damaged file was kept.`);
    this.config = { apiKey: '', ...(config ?? {}) };
    if (loaded.changed && !this.readOnly) await this.#flushNow(true);
    else this.#remember();
    return this;
  }

  /** @returns {{ok:boolean, data:any}} ok=false means we could not read it (as opposed to it being empty). */
  async #fetchJson(path) {
    try {
      const res = await this.fetchFn(path, { headers: HEADERS });
      return res.ok ? { ok: true, data: await res.json() } : { ok: false, data: null };
    } catch { return { ok: false, data: null }; }
  }
  async #get(path) { return (await this.#fetchJson(path)).data; }
  #readLocal(key) {
    let raw = null;
    try { raw = this.storage?.getItem(key) ?? null; } catch { return null; }
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch {
      // damaged: keep the bytes aside instead of letting the next save overwrite them
      try { this.storage.setItem(`${key}.damaged-${Date.now()}`, raw); } catch { /* storage full */ }
      this.notes.push(`Some saved data in this browser was damaged (${key}). A copy was kept aside.`);
      return null;
    }
  }
  #remember() {
    const { profile, index } = splitState(this.state);
    this.written = { profile: JSON.stringify(profile), index: JSON.stringify(index) };
  }

  /** Debounced save. */
  save() {
    if (this.readOnly) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  /** Write whatever changed. Never throws; if the server couldn't be reached it keeps retrying in the background. */
  flush() {
    clearTimeout(this.timer);
    if (this.readOnly) return Promise.resolve(true);
    this.chain = this.chain.then(async () => {
      const saved = await this.#flushNow();
      if (saved) { this.attempts = 0; clearTimeout(this.retryTimer); this.retryTimer = null; } else this.#retryLater();
      return saved;
    }).catch(() => { this.#retryLater(); return false; });
    return this.chain;
  }

  /** A server restart (every deployed update) can swallow a save. Try again soon, a little slower each time. */
  #retryLater() {
    if (this.retryTimer || this.mode !== 'server') return;
    const delay = Math.min(30000, this.retryBaseMs * 2 ** Math.min(this.attempts++, 5));
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.flush(); }, delay);
    this.retryTimer.unref?.();
  }

  /** Wait (up to maxMs) until everything is safely on the server. Resolves true when nothing is left unsaved. */
  async flushReliably(maxMs = 8000) {
    const end = Date.now() + maxMs;
    for (;;) {
      if (await this.flush()) return true;
      if (Date.now() >= end) return false;
      await new Promise((r) => setTimeout(r, Math.min(400, Math.max(50, this.retryBaseMs / 2))));
    }
  }

  /** @returns {Promise<boolean>} true if everything that changed is now stored */
  async #flushNow(force = false) {
    const { profile, index } = splitState(this.state);
    const docs = { profile: JSON.stringify(profile), index: JSON.stringify(index) };
    let all = true;
    if (force || docs.profile !== this.written.profile) {
      const written = this.mode === 'server' ? await this.#putProfile(force) : (await this.#put('/api/profile', 'unfurl.profile', docs.profile) ? docs.profile : null);
      if (written != null) this.written.profile = written; else all = false;
    }
    if (force || docs.index !== this.written.index) { if (await this.#put('/api/index', 'unfurl.index', docs.index, true)) this.written.index = docs.index; else all = false; }
    return all;
  }

  /**
   * Save the profile on the server, but only on top of the version we last saw. If another tab or device saved
   * in between, merge its changes into ours (nothing of either is lost) and save the combined result.
   * @returns {Promise<string|null>} the text that was saved, or null if it couldn't be
   */
  async #putProfile(force) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const text = JSON.stringify(splitState(this.state).profile);
      let res;
      try {
        res = await this.fetchFn('/api/profile', { method: 'PUT', headers: { ...HEADERS, 'Content-Type': 'application/json', ...(force ? {} : { 'If-Match': this.rev ?? 'none' }) }, body: text });
      } catch (e) { return this.#failed(e.message); }
      if (res.status === 409) {
        const theirs = await res.json().catch(() => null);
        this.rev = theirs?.rev ?? null;
        if (theirs?.data && theirs.data.schema > SCHEMA) {   // written by a newer app: don't touch it
          this.readOnly = true;
          this.notes.push('Your data was changed by a newer version of Unfurl, so this page can no longer save. Reload it.');
          return this.#failed('the data was changed by a newer version');
        }
        if (theirs?.data) { mergeImport(this.state, { profile: theirs.data, index: null }); this.#merged(); }
        continue;
      }
      if (!res.ok) return this.#failed(`HTTP ${res.status}`);
      this.rev = (await res.json().catch(() => null))?.rev ?? this.rev;
      this.lastError = null;
      this.#saveState(true);
      return text;
    }
    return this.#failed('it keeps changing somewhere else');
  }

  #failed(why) {
    // Not stored: report that (so it is retried) instead of pretending. The page still holds the data.
    this.lastError = `Couldn’t save to the server just now (${why}). I’ll keep trying; please keep this page open.`;
    this.#saveState(false, this.lastError);
    return null;
  }

  #merged() { try { this.onMerged(); } catch { /* a UI hook must never break saving */ } }

  async saveConfig() { await this.#put('/api/config', 'unfurl.config', JSON.stringify(this.config)); }

  #saveState(ok, message = '') {
    if (ok === this.saveOk) return;
    this.saveOk = ok;
    try { this.onSaveState(ok, message); } catch { /* a UI hook must never break saving */ }
  }

  /** @returns {Promise<boolean>} whether it is now safely stored */
  async #put(path, localKey, text, trimmable = false) {
    if (this.mode === 'server') {
      try {
        const res = await this.fetchFn(path, { method: 'PUT', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: text });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.lastError = null;
        this.#saveState(true);
        return true;
      } catch (e) {
        // Not stored: report that (so it is retried) instead of pretending. The page still holds the data.
        this.lastError = `Couldn’t save to the server just now (${e.message}). I’ll keep trying; please keep this page open.`;
        this.#saveState(false, this.lastError);
        return false;
      }
    }
    return this.#putLocal(localKey, text, trimmable);
  }

  /** Browser storage is small (~5 MB): if the index doesn't fit, drop the bulkiest raw extras first. */
  #putLocal(key, text, trimmable) {
    const attempts = [text];
    if (trimmable) {
      const doc = JSON.parse(text);
      const lib = new Set(Object.keys(this.state.library));
      for (const v of Object.values(doc.videos)) delete v.comments;
      attempts.push(JSON.stringify(doc));
      for (const [id, v] of Object.entries(doc.videos)) if (!lib.has(id)) v.description = (v.description ?? '').slice(0, 300);
      attempts.push(JSON.stringify(doc));
    }
    for (const t of attempts) {
      try { this.storage?.setItem(key, t); this.lastError = null; return true; } catch { /* too big: try smaller */ }
    }
    this.lastError = 'This browser has no room left to save your data. Run serve.py (data goes to files), or export a backup from Settings.';
    return false;
  }

  /** What build the server is on right now ('' if unknown); used to notice when an update has been deployed. */
  async currentBuild() {
    if (this.mode !== 'server') return null;
    try {
      const res = await this.fetchFn('/api/ping', { headers: HEADERS });
      const j = res.ok ? await res.json() : null;
      return j?.app === 'unfurl' ? { build: j.build ?? '', version: j.version } : null;
    } catch { return null; }   // server restarting mid-update: try again next time
  }

  // ---- backups (server mode only: the server owns the backup folder)
  async listBackups() { return this.mode === 'server' ? (await this.#get('/api/backups')) ?? [] : []; }
  async #post(path, body) {
    try {
      const res = await this.fetchFn(path, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }
  /** Keep a labelled copy of the profile as it is right now (before anything destructive). */
  async snapshot(label) { await this.flush(); return this.mode === 'server' ? (await this.#post('/api/backups/snapshot', { label }))?.name ?? null : null; }
  async restoreBackup(name) { return this.mode === 'server' && !!(await this.#post('/api/backups/restore', { name }))?.ok; }

  /** Replace everything (used by "reset"). Call snapshot() first. */
  async replace(raw) {
    this.state = loadState(raw ?? {}).state;
    this.readOnly = false;
    return this.#flushNow(true);
  }
}
