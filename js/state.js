// The app's data shape and the pure functions that change it.
// (Persistence lives in store.js; nothing here touches the network or disk.)

import { STARTER_VIDEOS, STARTER_VERSION } from '../data/starter.js';
import { analyzeVideoText } from './analyze.js';
import { mergeVideo } from './youtube.js';
import { localDate } from './model.js';

export const STATE_VERSION = 1;
export const MAX_VIDEOS = 2000;
export const DEFAULT_TRUSTED = [
  'Yoga With Adriene', 'Yoga With Kassandra', 'Sarah Beth Yoga', 'Boho Beautiful', 'Mady Morrison', 'Travis Eliot', 'Breathe and Flow',
];

export function emptyState() {
  return {
    version: STATE_VERSION,
    starterVersion: 0,
    videos: {},      // id -> video record (metadata + profile + comment evidence)
    channels: {},    // channelId -> {id, name, subscribers}
    history: [],     // every routine you've done, with your "did it help?" answers
    blocked: [],     // video ids you never want to see again
    saved: [],       // video ids you bookmarked
    queryLog: {},    // normalized query -> {count, order, nextPageToken, lastAt}
    quota: { day: '', used: 0 },
    prefs: { trusted: [...DEFAULT_TRUSTED], adventure: 0.35, minMin: 10, maxMin: 25, searchWeb: true, queriesPerRun: 2, commentVideos: 10 },
  };
}

/** Fill in anything missing (older saves, hand-edited files) and add the starter shelf. */
export function normalizeState(raw) {
  const base = emptyState();
  const s = { ...base, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.prefs = { ...base.prefs, ...(s.prefs ?? {}) };
  for (const k of ['videos', 'channels', 'queryLog']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
  for (const k of ['history', 'blocked', 'saved']) if (!Array.isArray(s[k])) s[k] = [];
  if (!s.quota || typeof s.quota !== 'object') s.quota = { day: '', used: 0 };
  if ((s.starterVersion ?? 0) < STARTER_VERSION) {
    for (const v of STARTER_VIDEOS) if (!s.videos[v.id]) s.videos[v.id] = { ...v, addedAt: Date.now() };
    s.starterVersion = STARTER_VERSION;
  }
  for (const [id, v] of Object.entries(s.videos)) {
    if (!v || typeof v !== 'object') { delete s.videos[id]; continue; }
    v.id = id;
    if (!v.profile) v.profile = analyzeVideoText(v);
  }
  return s;
}

/** Keep stored records small: the analysis is kept, the long raw description isn't. */
function slim(v) {
  return v.description && v.description.length > 600 ? { ...v, description: v.description.slice(0, 600) } : v;
}

/** Merge a discovery result into the library. Returns how many videos are new. */
export function applyDiscovery(state, result) {
  let added = 0;
  for (const r of result.records) {
    if (!state.videos[r.id]) added++;
    state.videos[r.id] = slim(mergeVideo(state.videos[r.id], r));
  }
  Object.assign(state.channels, result.channels);
  for (const [k, u] of Object.entries(result.queryUpdates)) state.queryLog[k] = { ...state.queryLog[k], ...u };
  trimLibrary(state);
  return added;
}

/** Past the cap, forget the least valuable unseen videos (never anything you've done or saved). */
export function trimLibrary(state, max = MAX_VIDEOS) {
  const ids = Object.keys(state.videos);
  if (ids.length <= max) return;
  const keep = new Set([...state.history.map((h) => h.videoId), ...state.saved]);
  const droppable = ids.filter((id) => !keep.has(id)).sort((a, b) => {
    const va = state.videos[a], vb = state.videos[b];
    return (va.likes ?? 0) / Math.max(1, va.views ?? 1) - (vb.likes ?? 0) / Math.max(1, vb.views ?? 1);
  });
  for (const id of droppable.slice(0, ids.length - max)) delete state.videos[id];
}

const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/**
 * Record a finished routine and what you thought of it.
 * @param {{videoId:string, areas:{id:string,mode:string}[], ratings:Record<string,'much'|'some'|'none'>, intensity?:'easy'|'right'|'hard', repeat?:'yes'|'no', note?:string, date?:string}} entry
 */
export function logSession(state, entry) {
  const rec = {
    id: newId(),
    at: new Date().toISOString(),
    date: entry.date ?? localDate(),
    videoId: entry.videoId,
    areas: entry.areas ?? [],
    ratings: entry.ratings ?? {},
    intensity: entry.intensity ?? null,
    repeat: entry.repeat ?? null,
    note: (entry.note ?? '').slice(0, 500),
  };
  state.history.push(rec);
  if (rec.repeat === 'no') blockVideo(state, rec.videoId);
  return rec;
}

export function blockVideo(state, id) { if (!state.blocked.includes(id)) state.blocked.push(id); }
export function unblockVideo(state, id) { state.blocked = state.blocked.filter((x) => x !== id); }
export function toggleSaved(state, id) {
  const on = state.saved.includes(id);
  state.saved = on ? state.saved.filter((x) => x !== id) : [...state.saved, id];
  return !on;
}
export function deleteSession(state, sessionId) { state.history = state.history.filter((h) => h.id !== sessionId); }

/** Add a video by hand (pasted link). Returns the stored record. */
export function addManualVideo(state, rec) {
  const base = { views: null, likes: null, embeddable: true, verified: false, source: 'manual', addedAt: Date.now(), ...rec };
  const merged = slim(mergeVideo(state.videos[rec.id], { ...base, profile: undefined }));
  merged.profile = analyzeVideoText(merged);
  state.videos[rec.id] = merged;
  return merged;
}

/** What the embedded player tells us once it has actually loaded the video. */
export function applyPlayerInfo(state, id, info) {
  const v = state.videos[id];
  if (!v) return null;
  let changed = false;
  if (info.duration > 0 && Math.abs((v.durationSec ?? 0) - info.duration) > 5) { v.durationSec = Math.round(info.duration); changed = true; }
  if (v.durationApprox && info.duration > 0) { v.durationApprox = false; changed = true; }
  if (info.title && v.title !== info.title) { v.title = info.title; changed = true; }
  if (info.author && !v.channel) { v.channel = info.author; changed = true; }
  if (changed) v.profile = analyzeVideoText(v);
  return changed ? v : null;
}

/** Import a backup produced by exportData. Videos merge; sessions are added once. */
export function mergeImport(state, incoming) {
  const inc = normalizeState(incoming);
  for (const [id, v] of Object.entries(inc.videos)) state.videos[id] = mergeVideo(state.videos[id], v);
  Object.assign(state.channels, inc.channels);
  const have = new Set(state.history.map((h) => h.id));
  for (const h of inc.history) if (!have.has(h.id)) state.history.push(h);
  state.history.sort((a, b) => (a.at < b.at ? -1 : 1));
  state.blocked = [...new Set([...state.blocked, ...inc.blocked])];
  state.saved = [...new Set([...state.saved, ...inc.saved])];
  for (const [k, q] of Object.entries(inc.queryLog)) if (!state.queryLog[k] || (q.count ?? 0) > (state.queryLog[k].count ?? 0)) state.queryLog[k] = q;
  return state;
}

export const exportData = (state) => JSON.stringify({ app: 'unfurl', exportedAt: new Date().toISOString(), ...state }, null, 2);
