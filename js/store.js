// Persistence. Two interchangeable backends:
//   server  - serve.py keeps userdata/state.json + userdata/config.json on disk
//             (durable, survives clearing the browser, works from any browser)
//   local   - falls back to localStorage when no server is there
// The API key lives in "config", separate from your data, so exporting or
// sharing your history never includes it.

import { normalizeState, emptyState } from './state.js';

const HEADERS = { 'X-Unfurl': '1' }; // custom header => other websites can't talk to the local server

export class Store {
  constructor({ fetchFn = (...a) => fetch(...a), storage = globalThis.localStorage } = {}) {
    this.fetchFn = fetchFn; this.storage = storage;
    this.mode = 'local';
    this.state = emptyState();
    this.config = { apiKey: '', apiBase: '' };
    this.timer = null; this.dirty = false;
  }

  async init() {
    try {
      const res = await this.fetchFn('/api/ping', { headers: HEADERS });
      if (res.ok && (await res.json()).app === 'unfurl') this.mode = 'server';
    } catch { /* no server: stay local */ }

    let rawState = null, rawConfig = null;
    if (this.mode === 'server') {
      rawState = await this.#get('/api/state');
      rawConfig = await this.#get('/api/config');
    } else {
      rawState = this.#readLocal('unfurl.state');
      rawConfig = this.#readLocal('unfurl.config');
    }
    this.state = normalizeState(rawState);
    this.config = { apiKey: '', apiBase: '', ...(rawConfig ?? {}) };
    return this;
  }

  async #get(path) {
    try {
      const res = await this.fetchFn(path, { headers: HEADERS });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }
  #readLocal(key) {
    try { return JSON.parse(this.storage?.getItem(key) ?? 'null'); } catch { return null; }
  }

  /** Debounced save of the library/history. */
  save() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  async flush() {
    clearTimeout(this.timer);
    if (!this.dirty) return;
    this.dirty = false;
    await this.#put('/api/state', 'unfurl.state', this.state);
  }
  async saveConfig() { await this.#put('/api/config', 'unfurl.config', this.config); }

  async #put(path, localKey, value) {
    const text = JSON.stringify(value);
    if (this.mode === 'server') {
      try {
        const res = await this.fetchFn(path, { method: 'PUT', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: text });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return;
      } catch (e) { this.lastError = `Couldn’t save to disk (${e.message}).`; }
    }
    try { this.storage?.setItem(localKey, text); this.lastError = null; }
    catch (e) { this.lastError = `Couldn’t save in this browser (${e.name}). Export a backup from Settings.`; }
  }

  /** Replace the whole state (used by import / reset). */
  async replace(state) { this.state = normalizeState(state); this.dirty = true; await this.flush(); }
}
