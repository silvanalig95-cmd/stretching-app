// Persistence. Two interchangeable backends:
//   server  - serve.py keeps profile.json / index.json / config.json in your
//             per-user data folder (durable, outside the app folder, backed up)
//   local   - falls back to localStorage when no server is there
// The API key lives in "config", apart from your data, so exporting or sharing
// your history never includes it.

import { loadState, splitState, emptyState } from './state.js';

const HEADERS = { 'X-Unfurl': '1' }; // custom header => other websites can't talk to the local server

export class Store {
  constructor({ fetchFn = (...a) => fetch(...a), storage = globalThis.localStorage } = {}) {
    this.fetchFn = fetchFn; this.storage = storage;
    this.mode = 'local';
    this.server = { version: null, dataDir: null };
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
      const j = res.ok ? await res.json() : null;
      if (j?.app === 'unfurl') { this.mode = 'server'; this.server = { version: j.version, dataDir: j.dataDir }; }
    } catch { /* no server: stay local */ }

    let profile, index, legacy = null, config, unreadable = false;
    if (this.mode === 'server') {
      const p = await this.#fetchJson('/api/profile'), ix = await this.#fetchJson('/api/index'), cfg = await this.#fetchJson('/api/config');
      // "no file yet" (ok, null) is very different from "couldn't read it" (not ok): never start fresh and overwrite on the latter.
      if (!p.ok || !ix.ok) unreadable = true;
      profile = p.data?.data ?? null;
      this.recoveredFrom = p.data?.recoveredFrom ?? null;
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
    this.readOnly = loaded.readOnly || unreadable;
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
  flush() {
    clearTimeout(this.timer);
    if (this.readOnly) return Promise.resolve();
    this.chain = this.chain.then(() => this.#flushNow()).catch(() => {});
    return this.chain;
  }

  async #flushNow(force = false) {
    const { profile, index } = splitState(this.state);
    const docs = { profile: JSON.stringify(profile), index: JSON.stringify(index) };
    if (force || docs.profile !== this.written.profile) { await this.#put('/api/profile', 'unfurl.profile', docs.profile); this.written.profile = docs.profile; }
    if (force || docs.index !== this.written.index) { await this.#put('/api/index', 'unfurl.index', docs.index, true); this.written.index = docs.index; }
  }

  async saveConfig() { await this.#put('/api/config', 'unfurl.config', JSON.stringify(this.config)); }

  async #put(path, localKey, text, trimmable = false) {
    if (this.mode === 'server') {
      try {
        const res = await this.fetchFn(path, { method: 'PUT', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: text });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.lastError = null;
        return;
      } catch (e) { this.lastError = `Couldn’t save to disk (${e.message}). Your changes are kept in this browser for now.`; }
    }
    this.#putLocal(localKey, text, trimmable);
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
      try { this.storage?.setItem(key, t); if (!this.lastError?.startsWith('Couldn’t save to disk')) this.lastError = null; return; } catch { /* too big: try smaller */ }
    }
    this.lastError = 'This browser has no room left to save your data. Run serve.py (data goes to files), or export a backup from Settings.';
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
    await this.#flushNow(true);
  }
}
