// The app's data shape, how it is upgraded between versions, and the pure
// functions that change it. (Disk/browser persistence lives in store.js.)
//
// Two kinds of data, saved separately:
//   PROFILE (precious, small)  library, history & ratings, blocked, following, preferences
//   INDEX   (rebuildable)      every video the app has seen + its analysis, channels, search memory
// Losing the index costs some re-fetching. Losing the profile would cost you your
// history, so it is versioned, migrated, backed up (serve.py) and never edited
// by a version that doesn't understand it.

import { SUGGESTIONS, SUGGESTIONS_VERSION } from '../data/suggestions.js';
import { analyzeVideoText, reanalyze, ANALYSIS_VERSION } from './analyze.js';
import { mergeVideo } from './youtube.js';
import { localDate } from './model.js';

export const SCHEMA = 2;
export const MAX_VIDEOS = 2000;
export const DEFAULT_TRUSTED = [
  'Yoga With Adriene', 'Yoga With Kassandra', 'Sarah Beth Yoga', 'Boho Beautiful', 'Mady Morrison', 'Travis Eliot', 'Breathe and Flow',
];
export const DEFAULT_PREFS = {
  trusted: DEFAULT_TRUSTED, adventure: 0.35, minMin: 10, maxMin: 25, searchWeb: true,
  thoroughness: 'balanced',   // how wide a web search goes: quick | balanced | thorough | exhaustive (see THOROUGHNESS)
  autoLibrary: false,  // true: everything a search finds is added to your library automatically
  focus: [],           // your standing tight / weak spots: [{id, mode}]
  enrichTop: 3,        // read comments for this many top picks that haven't been read yet
};

export function emptyState() {
  return {
    schema: SCHEMA,
    analysisVersion: ANALYSIS_VERSION,
    suggestionsVersion: 0,
    // ---- profile
    library: {},     // id -> {addedAt, tags[], note, snapshot:{title, channel, durationSec}}  (starts EMPTY: you build it)
    history: [],     // every routine you've done, with your "did it help?" answers
    blocked: [],     // video ids you never want to see again
    following: [],   // teachers whose uploads you track: [{channelId, name, addedAt}]
    savedSearches: [], // named library searches: [{id, name, q, area, len, tag, tab}]
    prefs: { ...DEFAULT_PREFS, trusted: [...DEFAULT_TRUSTED], focus: [] },
    // ---- index
    videos: {},      // id -> video record (metadata + raw text/comments sample + derived profile)
    channels: {},    // channelId -> {id, name, subscribers}
    queryLog: {},    // normalized query -> {count, order, nextPageToken, lastAt}
    quota: { day: '', used: 0 },
  };
}

/** The two documents that go to disk. */
export function splitState(state) {
  return {
    profile: { app: 'unfurl', schema: SCHEMA, library: state.library, history: state.history, blocked: state.blocked, following: state.following, savedSearches: state.savedSearches, prefs: state.prefs },
    index: { schema: SCHEMA, analysisVersion: state.analysisVersion, suggestionsVersion: state.suggestionsVersion, videos: state.videos, channels: state.channels, queryLog: state.queryLog, quota: state.quota },
  };
}

// ---------------------------------------------------------------- upgrading old data

/**
 * Upgrade steps for the PROFILE document: PROFILE_MIGRATIONS[n] turns a schema-n
 * profile into a schema-(n+1) profile. (Schema 1 was a single combined state.json;
 * see fromLegacyV1.) Add a step here whenever the profile's shape changes, bump
 * SCHEMA, and add a test with a saved sample of the old shape.
 */
export const PROFILE_MIGRATIONS = {};

export function migrateProfile(doc, target = SCHEMA, migrations = PROFILE_MIGRATIONS) {
  let d = doc;
  while ((d.schema ?? 1) < target) {
    const step = migrations[d.schema ?? 1];
    if (!step) throw new Error(`No upgrade path from data format ${d.schema ?? 1} to ${target}.`);
    d = step(structuredClone(d));
  }
  return d;
}

/** Version 1 kept everything in one file; split it, and turn "saved" + "done" + hand-added videos into the library. */
export function fromLegacyV1(legacy) {
  const lv = legacy.videos && typeof legacy.videos === 'object' ? legacy.videos : {};
  const snap = (v) => (v ? { title: v.title, channel: v.channel, durationSec: v.durationSec } : undefined);
  const library = {};
  const add = (id, at) => {
    if (!id || library[id]) return;
    library[id] = { addedAt: at || lv[id]?.addedAt || Date.now(), tags: [], note: '', snapshot: snap(lv[id]) };
  };
  for (const id of legacy.saved ?? []) add(id);
  for (const h of legacy.history ?? []) add(h.videoId, Date.parse(h.at));
  for (const v of Object.values(lv)) if (v?.source === 'manual') add(v.id, v.addedAt);

  const videos = {};
  for (const [id, v] of Object.entries(lv)) if (v && typeof v === 'object') videos[id] = { ...v, source: v.source === 'starter' ? 'suggestion' : v.source };
  return {
    profile: {
      app: 'unfurl', schema: SCHEMA, library,
      history: (legacy.history ?? []).map((h) => ({ ...h, title: h.title ?? lv[h.videoId]?.title, channel: h.channel ?? lv[h.videoId]?.channel })),
      blocked: legacy.blocked ?? [], following: [],
      prefs: { ...DEFAULT_PREFS, ...(legacy.prefs ?? {}) },
    },
    index: { schema: SCHEMA, analysisVersion: legacy.analysisVersion ?? 1, suggestionsVersion: 0, videos, channels: legacy.channels ?? {}, queryLog: legacy.queryLog ?? {}, quota: legacy.quota ?? { day: '', used: 0 } },
  };
}

// ---------------------------------------------------------------- loading

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

/**
 * Turn whatever is on disk into a ready-to-use state.
 * @param {{profile?:object|null, index?:object|null, legacy?:object|null}} docs  legacy = an old single-file state
 * @returns {{state:object, readOnly:boolean, changed:boolean, notes:string[]}}
 *   changed: something was upgraded/repaired/seeded, so it should be saved.
 *   readOnly: the data is from a NEWER version of the app; don't write anything.
 */
export function loadState({ profile = null, index = null, legacy = null } = {}) {
  const notes = [];
  let changed = false, readOnly = false;
  let p = isObj(profile) ? profile : null, ix = isObj(index) ? index : null;

  if (!p && isObj(legacy)) {
    ({ profile: p, index: ix } = fromLegacyV1(legacy));
    notes.push('Upgraded your data to the new format. Your old file was kept as a backup.');
    changed = true;
  }
  if (p && (p.schema ?? 1) > SCHEMA) {
    readOnly = true;
    notes.push(`Your data was saved by a newer version of Unfurl (data format ${p.schema}; this version understands ${SCHEMA}). It is shown read-only so nothing gets damaged. Please update the app.`);
  } else if (p && (p.schema ?? 1) < SCHEMA) {
    p = migrateProfile(p);
    notes.push('Upgraded your data to the current format (a backup of the old one was kept).');
    changed = true;
  }

  const s = emptyState();
  if (p) {
    if (isObj(p.library)) s.library = p.library;
    if (Array.isArray(p.history)) s.history = p.history.filter((h) => isObj(h) && typeof h.videoId === 'string');
    if (Array.isArray(p.blocked)) s.blocked = p.blocked;
    if (Array.isArray(p.following)) s.following = p.following;
    if (Array.isArray(p.savedSearches)) s.savedSearches = p.savedSearches.filter((x) => isObj(x) && typeof x.q === 'string');
    if (isObj(p.prefs)) s.prefs = { ...s.prefs, ...p.prefs };
  }
  if (ix && ((ix.schema ?? 1) === SCHEMA || readOnly)) {
    if (isObj(ix.videos)) s.videos = ix.videos;
    if (isObj(ix.channels)) s.channels = ix.channels;
    if (isObj(ix.queryLog)) s.queryLog = ix.queryLog;
    if (isObj(ix.quota)) s.quota = ix.quota;
    s.suggestionsVersion = ix.suggestionsVersion ?? 0;
    s.analysisVersion = ix.analysisVersion ?? 1;
  } else if (ix) {
    changed = true; // an index from an incompatible version is simply rebuilt
  }

  if (!readOnly) {
    if (seedSuggestions(s)) changed = true;
    if (ensureStubs(s)) changed = true;
    if (reindex(s)) changed = true;
  } else {
    ensureStubs(s);
  }
  for (const [id, v] of Object.entries(s.videos)) {
    if (!isObj(v)) { delete s.videos[id]; continue; }
    v.id = id;
    if (!v.profile) v.profile = analyzeVideoText(v);
  }
  return { state: s, readOnly, changed, notes };
}

/** Fresh install / tests: an empty library and the suggestions shelf. */
export const freshState = () => loadState({}).state;

/** Add any suggestions this install hasn't seen. Never touches existing records. */
function seedSuggestions(s) {
  if (s.suggestionsVersion >= SUGGESTIONS_VERSION) return false;
  for (const v of SUGGESTIONS) if (!s.videos[v.id]) s.videos[v.id] = { ...v, addedAt: Date.now() };
  s.suggestionsVersion = SUGGESTIONS_VERSION;
  return true;
}

/** Library/history must never point at a video the index has lost (e.g. after the index was deleted). */
function ensureStubs(s) {
  let changed = false;
  const need = [
    ...Object.entries(s.library).map(([id, l]) => [id, l.snapshot]),
    ...s.history.map((h) => [h.videoId, { title: h.title, channel: h.channel }]),
  ];
  for (const [id, snap] of need) {
    if (s.videos[id]) continue;
    s.videos[id] = { id, title: snap?.title ?? 'Video (details will reload)', channel: snap?.channel ?? '', durationSec: snap?.durationSec ?? null, verified: false, source: 'restored', embeddable: true, addedAt: Date.now() };
    changed = true;
  }
  return changed;
}

/** If the analysis code changed since this data was last analysed, redo it from the stored raw material. */
function reindex(s) {
  if (s.analysisVersion === ANALYSIS_VERSION) return false;
  for (const [id, v] of Object.entries(s.videos)) if (isObj(v)) s.videos[id] = reanalyze(v);
  s.analysisVersion = ANALYSIS_VERSION;
  return true;
}
export const reindexAll = (s) => { s.analysisVersion = -1; return reindex(s); };

// ---------------------------------------------------------------- library

export const inLibrary = (state, id) => id in state.library;

function snapshot(state, id) {
  const v = state.videos[id];
  if (v && state.library[id]) state.library[id].snapshot = { title: v.title, channel: v.channel, durationSec: v.durationSec };
}

export function addToLibrary(state, id, extra = {}) {
  if (!state.library[id]) state.library[id] = { addedAt: Date.now(), tags: [], note: '' };
  Object.assign(state.library[id], extra);
  snapshot(state, id);
  return state.library[id];
}
export function removeFromLibrary(state, id) { delete state.library[id]; }
/** Returns true if the video is in the library afterwards. */
export function toggleLibrary(state, id) {
  if (inLibrary(state, id)) { removeFromLibrary(state, id); return false; }
  addToLibrary(state, id); return true;
}
export function updateLibraryItem(state, id, { tags, note }) {
  const item = state.library[id];
  if (!item) return null;
  if (tags) item.tags = [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  if (note != null) item.note = String(note).slice(0, 500);
  return item;
}
export const allTags = (state) => [...new Set(Object.values(state.library).flatMap((l) => l.tags ?? []))].sort();

// ---------------------------------------------------------------- discovery results

/** Merge a discovery result into the index. Returns how many videos are new. */
export function applyDiscovery(state, result) {
  let added = 0;
  for (const r of result.records) {
    const isNew = !state.videos[r.id];
    if (isNew) added++;
    state.videos[r.id] = mergeVideo(state.videos[r.id], r);
    if (isNew && state.prefs.autoLibrary) addToLibrary(state, r.id);
  }
  Object.assign(state.channels, result.channels);
  for (const [k, u] of Object.entries(result.queryUpdates)) state.queryLog[k] = { ...state.queryLog[k], ...u };
  trimIndex(state);
  return added;
}

/** Past the cap, forget the least valuable discovered videos (never your library, history, or suggestions). */
export function trimIndex(state, max = MAX_VIDEOS) {
  const ids = Object.keys(state.videos);
  if (ids.length <= max) return;
  const keep = new Set([...Object.keys(state.library), ...state.history.map((h) => h.videoId)]);
  const droppable = ids.filter((id) => !keep.has(id) && state.videos[id].source !== 'suggestion').sort((a, b) => {
    const va = state.videos[a], vb = state.videos[b];
    return (va.likes ?? 0) / Math.max(1, va.views ?? 1) - (vb.likes ?? 0) / Math.max(1, vb.views ?? 1);
  });
  for (const id of droppable.slice(0, ids.length - max)) delete state.videos[id];
}

/** Add a hand-picked video (pasted link) to the index AND your library. */
export function addManualVideo(state, rec, { toLibrary = true } = {}) {
  const base = { views: null, likes: null, embeddable: true, verified: false, source: 'manual', addedAt: Date.now(), ...rec };
  const merged = mergeVideo(state.videos[rec.id], { ...base, profile: undefined });
  merged.profile = analyzeVideoText(merged);
  state.videos[rec.id] = merged;
  if (toLibrary) addToLibrary(state, rec.id);
  return merged;
}

/** Records from a channel/playlist import: into the index, optionally into the library. */
export function importRecords(state, records, { toLibrary = false } = {}) {
  let added = 0;
  for (const r of records) {
    if (!state.videos[r.id]) added++;
    state.videos[r.id] = mergeVideo(state.videos[r.id], r);
    if (toLibrary || state.prefs.autoLibrary) addToLibrary(state, r.id);
  }
  trimIndex(state);
  return added;
}

// ---------------------------------------------------------------- saved searches

/** Remember a library search (text + filters) under a name. Re-saving a name replaces it. */
export function saveSearch(state, { name, q = '', area = '', len = '', tag = '', tab = 'mine' }) {
  const nm = String(name ?? '').trim().slice(0, 40);
  if (!nm || (!q.trim() && !area && !len && !tag)) return null;
  state.savedSearches = state.savedSearches.filter((x) => x.name.toLowerCase() !== nm.toLowerCase());
  const rec = { id: newId(), name: nm, q: q.slice(0, 200), area, len, tag, tab };
  state.savedSearches.push(rec);
  state.savedSearches = state.savedSearches.slice(-20);
  return rec;
}
export function deleteSavedSearch(state, id) { state.savedSearches = state.savedSearches.filter((x) => x.id !== id); }

// ---------------------------------------------------------------- following

export function followChannel(state, { channelId, name }) {
  if (!channelId || state.following.some((f) => f.channelId === channelId)) return false;
  state.following.push({ channelId, name, addedAt: Date.now(), lastChecked: null });
  return true;
}
export function unfollowChannel(state, channelId) { state.following = state.following.filter((f) => f.channelId !== channelId); }

// ---------------------------------------------------------------- history

const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/**
 * Record a finished routine and what you thought of it. A routine you've done is
 * part of your practice, so it joins your library.
 */
export function logSession(state, entry) {
  const v = state.videos[entry.videoId];
  const rec = {
    id: newId(),
    at: new Date().toISOString(),
    date: entry.date ?? localDate(),
    videoId: entry.videoId,
    title: v?.title, channel: v?.channel,
    areas: entry.areas ?? [],
    ratings: entry.ratings ?? {},
    intensity: entry.intensity ?? null,
    repeat: entry.repeat ?? null,
    note: (entry.note ?? '').slice(0, 500),
  };
  state.history.push(rec);
  if (rec.repeat === 'no') { blockVideo(state, rec.videoId); removeFromLibrary(state, rec.videoId); }
  else addToLibrary(state, rec.videoId);
  return rec;
}

export function blockVideo(state, id) { if (!state.blocked.includes(id)) state.blocked.push(id); }
export function unblockVideo(state, id) { state.blocked = state.blocked.filter((x) => x !== id); }
export function deleteSession(state, sessionId) { state.history = state.history.filter((h) => h.id !== sessionId); }

/** What the embedded player tells us once it has actually loaded the video. */
export function applyPlayerInfo(state, id, info) {
  const v = state.videos[id];
  if (!v) return null;
  let changed = false;
  if (info.duration > 0 && Math.abs((v.durationSec ?? 0) - info.duration) > 5) { v.durationSec = Math.round(info.duration); changed = true; }
  if (v.durationApprox && info.duration > 0) { v.durationApprox = false; changed = true; }
  if (info.title && v.title !== info.title) { v.title = info.title; changed = true; }
  if (info.author && !v.channel) { v.channel = info.author; changed = true; }
  if (changed) { state.videos[id] = reanalyze(v); snapshot(state, id); }
  return changed ? state.videos[id] : null;
}

// ---------------------------------------------------------------- backup / restore

/** A portable backup: everything except the API key. */
export const exportData = (state) => JSON.stringify({ app: 'unfurl', exportedAt: new Date().toISOString(), ...splitState(state) }, null, 2);

/** Merge a backup into the current state: nothing is lost, sessions are added once. */
export function mergeImport(state, incoming) {
  let { profile, index } = incoming.profile ? incoming : fromLegacyV1(incoming); // current or version-1 backups
  const inc = loadState({ profile, index }).state;
  for (const [id, v] of Object.entries(inc.videos)) state.videos[id] = mergeVideo(state.videos[id], v);
  Object.assign(state.channels, inc.channels);
  for (const [id, l] of Object.entries(inc.library)) {
    const cur = state.library[id];
    state.library[id] = cur ? { ...l, ...cur, tags: [...new Set([...(cur.tags ?? []), ...(l.tags ?? [])])] } : l;
  }
  const have = new Set(state.history.map((h) => h.id));
  for (const h of inc.history) if (!have.has(h.id)) state.history.push(h);
  state.history.sort((a, b) => (a.at < b.at ? -1 : 1));
  state.blocked = [...new Set([...state.blocked, ...inc.blocked])];
  for (const f of inc.following) followChannel(state, f);
  for (const x of inc.savedSearches) if (!state.savedSearches.some((y) => y.name.toLowerCase() === x.name.toLowerCase())) state.savedSearches.push(x);
  for (const [k, q] of Object.entries(inc.queryLog)) if (!state.queryLog[k] || (q.count ?? 0) > (state.queryLog[k].count ?? 0)) state.queryLog[k] = q;
  ensureStubs(state);
  return state;
}
