// YouTube Data API v3 client + the "go find me new stuff" pipeline.
//
// Needs a (free) API key from the user. Costs per call: search 100 units,
// everything else 1 unit, against a default 10,000/day allowance, so one
// discovery run (2 searches + details + comments for ~10 videos) is ~210 units.

import { decodeEntities, parseIsoDuration, analyzeVideoText, attachComments, reanalyze } from './analyze.js';
import { buildModel, rankCandidates, channelKey } from './model.js';
import { buildQueries } from './query.js';
import { normalize } from './lexicon.js';

export const API_BASE = 'https://www.googleapis.com/youtube/v3';
export const COST = { search: 100, videos: 1, commentThreads: 1, channels: 1, playlistItems: 1, playlists: 1 };
export const DAILY_QUOTA = 10000;

export class YouTubeError extends Error {
  constructor(message, { status = 0, reason = '' } = {}) { super(message); this.name = 'YouTubeError'; this.status = status; this.reason = reason; }
}
export class QuotaError extends YouTubeError { constructor(m, o) { super(m, o); this.name = 'QuotaError'; } }
export class KeyError extends YouTubeError { constructor(m, o) { super(m, o); this.name = 'KeyError'; } }
export class CommentsDisabledError extends YouTubeError { constructor(m, o) { super(m, o); this.name = 'CommentsDisabledError'; } }

/** Map a real YouTube API error body to something a person can act on. */
export function toApiError(status, body) {
  const err = body?.error ?? {};
  const reason = err.errors?.[0]?.reason ?? '';
  const detail = err.details?.find((d) => d.reason)?.reason ?? '';
  const msg = err.message ?? `HTTP ${status}`;
  const o = { status, reason: detail || reason };
  if (['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)) {
    return new QuotaError('Today’s YouTube search allowance is used up. It resets at midnight Pacific time.', o);
  }
  if (['commentsDisabled', 'commentThreadNotFound'].includes(reason)) return new CommentsDisabledError('Comments are turned off for this video.', o);
  if (detail === 'API_KEY_INVALID' || reason === 'keyInvalid') return new KeyError('YouTube says this API key isn’t valid. Check it in Settings.', o);
  if (detail === 'SERVICE_DISABLED' || reason === 'accessNotConfigured') {
    return new KeyError('The “YouTube Data API v3” isn’t enabled for this key’s Google Cloud project. Enable it, then try again.', o);
  }
  if (/REFER+ER/i.test(detail) || reason === 'ipRefererBlocked') {
    return new KeyError('This key is restricted by website. Allow http://localhost:8765/* for the key, or remove the restriction.', o);
  }
  return new YouTubeError(msg, o);
}

export class YouTubeClient {
  /**
   * @param {{key:string, base?:string, fetchFn?:typeof fetch, onSpend?:(units:number)=>void}} o
   */
  constructor({ key, base = API_BASE, fetchFn = (...a) => fetch(...a), onSpend = () => {} }) {
    this.key = key; this.base = base; this.fetchFn = fetchFn; this.onSpend = onSpend;
  }

  async call(endpoint, params) {
    const url = new URL(`${this.base}/${endpoint}`);
    for (const [k, v] of Object.entries({ ...params, key: this.key })) if (v != null && v !== '') url.searchParams.set(k, v);
    let res;
    try { res = await this.fetchFn(url.toString()); } catch (e) { throw new YouTubeError(`Couldn’t reach YouTube (${e.message}). Check your connection.`); }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw toApiError(res.status, body);
    this.onSpend(COST[endpoint] ?? 1);
    return body;
  }

  async search({ q, order = 'relevance', pageToken, videoDuration, maxResults = 25 }) {
    const body = await this.call('search', {
      part: 'snippet', type: 'video', q, order, pageToken, videoDuration, maxResults,
      videoEmbeddable: 'true', videoSyndicated: 'true', relevanceLanguage: 'en', safeSearch: 'moderate',
    });
    const items = (body.items ?? []).filter((it) => it.id?.videoId).map((it) => ({
      id: it.id.videoId, title: decodeEntities(it.snippet?.title), channelId: it.snippet?.channelId, channel: decodeEntities(it.snippet?.channelTitle),
    }));
    return { items, ids: items.map((i) => i.id), nextPageToken: body.nextPageToken ?? null };
  }

  /** Full details for up to any number of ids (batched 50 at a time). */
  async videos(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const body = await this.call('videos', { part: 'snippet,contentDetails,statistics,status', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
      for (const it of body.items ?? []) out.push(toRecord(it));
    }
    return out;
  }

  /** Top comments (most relevant first). Returns [] when comments are off. */
  async comments(videoId, max = 50) {
    try {
      const body = await this.call('commentThreads', { part: 'snippet', videoId, maxResults: max, order: 'relevance', textFormat: 'plainText' });
      return (body.items ?? []).map((it) => {
        const s = it.snippet?.topLevelComment?.snippet;
        return { text: s?.textDisplay ?? s?.textOriginal ?? '', likes: s?.likeCount ?? 0 };
      });
    } catch (e) {
      if (e instanceof CommentsDisabledError) return [];
      throw e;
    }
  }

  /** One channel by id, @handle or legacy username. Returns {id, name, subscribers, uploads} or null. */
  async channel({ id, handle, username }) {
    const body = await this.call('channels', {
      part: 'snippet,statistics,contentDetails', id, forHandle: handle ? `@${handle.replace(/^@/, '')}` : undefined, forUsername: username, maxResults: 1,
    });
    const it = body.items?.[0];
    if (!it) return null;
    return {
      id: it.id, name: decodeEntities(it.snippet?.title),
      subscribers: it.statistics?.hiddenSubscriberCount ? null : Number(it.statistics?.subscriberCount ?? NaN) || null,
      uploads: it.contentDetails?.relatedPlaylists?.uploads ?? null,
    };
  }

  /** Find channels by name (100 units: only used when we can't resolve a link). */
  async searchChannels(q) {
    const body = await this.call('search', { part: 'snippet', type: 'channel', q, maxResults: 5 });
    return (body.items ?? []).filter((it) => it.id?.channelId).map((it) => ({ id: it.id.channelId, name: decodeEntities(it.snippet?.channelTitle ?? it.snippet?.title) }));
  }

  /** Video ids in a playlist (a channel's uploads are one), newest first, 50 per unit. */
  async playlistVideoIds(playlistId, { max = 150 } = {}) {
    const ids = [];
    let pageToken;
    do {
      const body = await this.call('playlistItems', { part: 'contentDetails', playlistId, maxResults: Math.min(50, max - ids.length), pageToken });
      for (const it of body.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
      pageToken = body.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  async playlistTitle(playlistId) {
    const body = await this.call('playlists', { part: 'snippet', id: playlistId, maxResults: 1 });
    const it = body.items?.[0];
    return it ? { title: decodeEntities(it.snippet?.title), channelId: it.snippet?.channelId, channel: decodeEntities(it.snippet?.channelTitle) } : null;
  }

  async channels(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 50) {
      const body = await this.call('channels', { part: 'snippet,statistics', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
      for (const it of body.items ?? []) {
        out[it.id] = {
          id: it.id, name: decodeEntities(it.snippet?.title),
          subscribers: it.statistics?.hiddenSubscriberCount ? null : Number(it.statistics?.subscriberCount ?? NaN) || null,
        };
      }
    }
    return out;
  }
}

/** videos.list item -> our stored record. */
export function toRecord(item) {
  const sn = item.snippet ?? {}, st = item.statistics ?? {}, cd = item.contentDetails ?? {};
  return {
    id: item.id,
    title: decodeEntities(sn.title),
    channelId: sn.channelId,
    channel: decodeEntities(sn.channelTitle),
    description: decodeEntities(sn.description).slice(0, 3000),
    tags: (sn.tags ?? []).slice(0, 30),
    publishedAt: sn.publishedAt,
    durationSec: parseIsoDuration(cd.duration),
    views: st.viewCount != null ? Number(st.viewCount) : null,
    likes: st.likeCount != null ? Number(st.likeCount) : null,
    commentCount: st.commentCount != null ? Number(st.commentCount) : null,
    embeddable: item.status?.embeddable !== false,
    live: sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none',
    verified: true,
  };
}

/** Keep user-side facts when a fresher copy of a video arrives. */
export function mergeVideo(old, fresh) {
  if (!old) return fresh;
  const merged = { ...old, ...fresh, source: old.source === 'suggestion' || old.source === 'manual' ? old.source : fresh.source ?? old.source, addedAt: old.addedAt ?? fresh.addedAt };
  if (!fresh.evidence && old.evidence) merged.evidence = old.evidence;
  if (!fresh.profile && old.profile) merged.profile = old.profile;
  if (old.subscribers != null && fresh.subscribers == null) merged.subscribers = old.subscribers;
  return merged;
}

/** Re-run text analysis (and comments, if we have them) after metadata changes. */
export const reprofile = reanalyze;

// ---------------------------------------------------------------- quota bookkeeping

export const quotaDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export function quotaUsed(state, d = new Date()) {
  return state.quota?.day === quotaDay(d) ? state.quota.used : 0;
}
export function spendQuota(state, units, d = new Date()) {
  const day = quotaDay(d);
  state.quota = { day, used: (state.quota?.day === day ? state.quota.used : 0) + units };
}
/** Worst case: every search needs one extra page. Typical runs cost roughly half of the search part. */
export const estimateRunCost = ({ queries = 2, commentVideos = 10, extraPages = 1 } = {}) => queries * COST.search * (1 + extraPages) + commentVideos + 6;

// ---------------------------------------------------------------- discovery

const MIN_SEC = 90, MAX_SEC = 3 * 3600;
const MIN_FRESH = 3; // a result page with fewer than this many unknown videos triggers a look at the next page

/**
 * Go and find new routines for these filters, read their metadata + comments,
 * and return everything that should be merged into the library.
 * Never mutates `state`; the caller merges `records` / `queryUpdates` / `channels`.
 */
export async function discover({ client, filters, state, rng, progress = () => {}, opts = {} }) {
  const o = { queries: 2, commentVideos: 10, extraPages: 1, ...opts };
  const model = buildModel(state.history, state.videos);
  const knownTeachers = new Set();
  for (const v of Object.values(state.videos)) if (model.channelDone.has(channelKey(v))) knownTeachers.add(normalize(v.channel).replace(/ /g, ''));

  const queries = buildQueries(filters, { queryLog: state.queryLog, rng, n: o.queries, knownTeachers, adventure: state.prefs.adventure });
  const report = { queries: [], warnings: [], newVideos: 0, newChannels: 0, commentsRead: 0 };
  const queryUpdates = {};
  const found = new Map();
  let stop = false;

  for (const q of queries) {
    let page = q, pages = 0, fresh = 0;
    for (;;) {
      progress(`Searching YouTube for “${q.q}”${page.pageToken ? ' (going deeper)' : ''}…`);
      let res;
      try {
        res = await client.search(page);
      } catch (e) {
        if (found.size && (e instanceof QuotaError)) { report.warnings.push(e.message); stop = true; break; }
        throw e;
      }
      pages++;
      const prev = state.queryLog[q.key] ?? {};
      queryUpdates[q.key] = { count: (prev.count ?? 0) + 1, lastAt: Date.now(), order: q.order, nextPageToken: res.nextPageToken, q: q.q };
      const newHere = res.items.filter((it) => !state.videos[it.id] && !found.has(it.id)).length;
      fresh += newHere;
      for (const it of res.items) if (!found.has(it.id)) found.set(it.id, it);
      // Mostly videos we already know? Look one page further down rather than come back empty-handed.
      if (newHere >= MIN_FRESH || !res.nextPageToken || pages > o.extraPages) break;
      progress('Mostly familiar results, so looking a little further down…');
      page = { ...q, pageToken: res.nextPageToken };
    }
    if (pages) report.queries.push({ q: q.q, order: q.order, deeper: !!q.pageToken, pages, fresh });
    if (stop) break;
  }

  const ids = [...found.keys()];
  const touched = new Map();
  progress(`Reading details for ${ids.length} videos…`);
  const needDetails = ids.filter((id) => !state.videos[id]?.verified);
  const fresh = await client.videos(needDetails);
  const now = Date.now();
  for (const r of fresh) {
    if (r.live || r.durationSec == null || r.durationSec < MIN_SEC || r.durationSec > MAX_SEC || r.embeddable === false) continue;
    touched.set(r.id, { ...mergeVideo(state.videos[r.id], { ...r, source: 'search', addedAt: now }) });
  }
  report.newVideos = [...touched.keys()].filter((id) => !state.videos[id]).length;

  // Who are these teachers? (subscriber counts reveal small channels worth a look)
  const chIds = [...new Set([...touched.values()].map((v) => v.channelId).filter((c) => c && !state.channels[c]))];
  let channels = {};
  if (chIds.length) {
    progress(`Checking ${chIds.length} channels…`);
    try { channels = await client.channels(chIds); } catch (e) { if (e instanceof QuotaError || e instanceof KeyError) throw e; }
    report.newChannels = Object.keys(channels).length;
  }
  for (const v of touched.values()) {
    const ch = channels[v.channelId] ?? state.channels[v.channelId];
    if (ch?.subscribers != null) v.subscribers = ch.subscribers;
    Object.assign(v, reanalyze(v));
  }

  // Already-known candidates take part too (they may just need their comments read).
  for (const id of ids) if (!touched.has(id) && state.videos[id]) touched.set(id, { ...state.videos[id] });

  // Read comments for the most promising candidates only (1 unit each).
  const ranked = rankCandidates({
    videos: [...touched.values()], filters, model, trusted: state.prefs.trusted, blocked: state.blocked, adventure: state.prefs.adventure,
  });
  const toRead = ranked.map((r) => r.video).filter((v) => !v.evidence).slice(0, o.commentVideos);
  let i = 0;
  for (const v of toRead) {
    progress(`Reading viewer comments (${++i}/${toRead.length}): ${v.title.slice(0, 48)}…`);
    let comments;
    try { comments = await client.comments(v.id); } catch (e) { if (e instanceof QuotaError) { report.warnings.push(e.message); break; } continue; }
    const rec = attachComments(touched.get(v.id), comments);
    touched.set(v.id, rec);
    report.commentsRead += rec.evidence.n;
  }

  return { records: [...touched.values()], queryUpdates, channels, report };
}

/**
 * Check videos we only know from the starter list (or typed in by hand) against
 * the real API: fix titles/lengths/channels, and flag the ones that no longer exist.
 */
export async function verifyVideos({ client, videos, readComments = false }) {
  const real = await client.videos(videos.map((v) => v.id));
  const byId = new Map(real.map((r) => [r.id, r]));
  const out = [];
  for (const v of videos) {
    const r = byId.get(v.id);
    if (!r) { out.push({ ...v, broken: true, verified: true }); continue; }
    let rec = reprofile(mergeVideo(v, { ...r, broken: false }));
    if (readComments && !rec.evidence) rec = attachComments(rec, await client.comments(rec.id));
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------- bringing in whole sources

const ID11 = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^(?:PL|UU|OLAK5uy_|FL|RD)[A-Za-z0-9_-]{10,40}$/;

/**
 * What did the user paste? A video, playlist, channel (by id, /@handle or /user/ link), or just a name to look up.
 * @returns {{type:'video'|'playlist'|'channel'|'handle'|'username'|'search', value:string}}
 */
export function parseSourceInput(input) {
  const s = String(input ?? '').trim();
  if (!s) return { type: 'search', value: '' };
  if (CHANNEL_ID.test(s)) return { type: 'channel', value: s };
  if (PLAYLIST_ID.test(s) && !ID11.test(s)) return { type: 'playlist', value: s };
  if (/^@[\w.\-]{3,40}$/.test(s)) return { type: 'handle', value: s.slice(1) };
  if (ID11.test(s)) return { type: 'video', value: s };
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return ID11.test(u.pathname.slice(1, 12)) ? { type: 'video', value: u.pathname.slice(1, 12) } : { type: 'search', value: s };
    if (host.endsWith('youtube.com')) {
      const list = u.searchParams.get('list'), v = u.searchParams.get('v');
      if (u.pathname === '/playlist' && list) return { type: 'playlist', value: list };
      if (v && ID11.test(v)) return { type: 'video', value: v };
      if (list && !v) return { type: 'playlist', value: list };
      let m;
      if ((m = u.pathname.match(/^\/channel\/(UC[\w-]{22})/))) return { type: 'channel', value: m[1] };
      if ((m = u.pathname.match(/^\/@([\w.\-]+)/))) return { type: 'handle', value: m[1] };
      if ((m = u.pathname.match(/^\/user\/([\w.\-]+)/))) return { type: 'username', value: m[1] };
      if ((m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/))) return { type: 'video', value: m[1] };
      if ((m = u.pathname.match(/^\/c\/([\w.\-]+)/))) return { type: 'search', value: decodeURIComponent(m[1]) };
    }
  } catch { /* not a URL: treat as a name */ }
  return { type: 'search', value: s };
}

/** Keep only videos worth suggesting: real length, embeddable, not live. */
const usable = (r) => !r.live && r.durationSec != null && r.durationSec >= MIN_SEC && r.durationSec <= MAX_SEC && r.embeddable !== false;

/** Fetch details for ids, drop the unusable, attach channel size and a first analysis. */
async function recordsFor(client, ids, state, source, channelInfo) {
  const details = await client.videos(ids);
  const keep = details.filter(usable);
  const need = [...new Set(keep.map((r) => r.channelId).filter((c) => c && !state.channels[c] && c !== channelInfo?.id))];
  const channels = need.length ? await client.channels(need).catch(() => ({})) : {};
  if (channelInfo) channels[channelInfo.id] = { id: channelInfo.id, name: channelInfo.name, subscribers: channelInfo.subscribers };
  const records = keep.map((r) => {
    const subs = (channels[r.channelId] ?? state.channels[r.channelId])?.subscribers;
    return reanalyze({ ...r, source, addedAt: Date.now(), ...(subs != null ? { subscribers: subs } : {}) });
  });
  return { records, channels, skipped: details.length - keep.length, missing: ids.length - details.length };
}

/**
 * Import everything behind a pasted link: a video, a playlist, or a teacher's whole upload history.
 * Cheap: ~1 unit per 50 videos (a search is 100). Never mutates `state`.
 * @returns {{type:string, title:string, channel:{id,name,subscribers}|null, records:object[], channels:object, skipped:number, missing:number}}
 */
export async function importSource({ client, input, state, maxVideos = 150, progress = () => {} }) {
  const src = typeof input === 'string' ? parseSourceInput(input) : input;
  if (src.type === 'video') {
    progress('Reading the video…');
    const r = await recordsFor(client, [src.value], state, 'manual');
    return { type: 'video', title: r.records[0]?.title ?? '', channel: null, ...r };
  }
  if (src.type === 'playlist') {
    progress('Reading the playlist…');
    const [meta, ids] = await Promise.all([client.playlistTitle(src.value).catch(() => null), client.playlistVideoIds(src.value, { max: maxVideos })]);
    if (!ids.length) return { type: 'playlist', title: meta?.title ?? '', channel: null, records: [], channels: {}, skipped: 0, missing: 0 };
    progress(`Reading details for ${ids.length} videos…`);
    const r = await recordsFor(client, ids, state, 'playlist');
    return { type: 'playlist', title: meta?.title ?? 'Playlist', channel: null, ...r };
  }
  // a teacher / channel
  let ch = null;
  progress('Finding the channel…');
  if (src.type === 'channel') ch = await client.channel({ id: src.value });
  else if (src.type === 'handle') ch = await client.channel({ handle: src.value });
  else if (src.type === 'username') ch = await client.channel({ username: src.value });
  else {
    const found = (await client.searchChannels(src.value))[0];
    ch = found ? await client.channel({ id: found.id }) : null;
  }
  if (!ch?.uploads) throw new YouTubeError(`Couldn’t find a channel for “${src.value}”.`);
  progress(`Reading ${ch.name}’s uploads…`);
  const ids = await client.playlistVideoIds(ch.uploads, { max: maxVideos });
  progress(`Reading details for ${ids.length} videos…`);
  const r = await recordsFor(client, ids, state, 'channel', ch);
  return { type: 'channel', title: ch.name, channel: ch, ...r };
}

/** Check followed teachers for uploads we haven't seen. ~2 units per teacher. */
export async function refreshFollowed({ client, state, perChannel = 15, progress = () => {} }) {
  const records = [], channels = {}, updated = [];
  for (const f of state.following) {
    progress(`Checking ${f.name}…`);
    const uploads = f.uploads ?? (await client.channel({ id: f.channelId }))?.uploads;
    if (!uploads) continue;
    const ids = (await client.playlistVideoIds(uploads, { max: perChannel })).filter((id) => !state.videos[id]);
    updated.push({ channelId: f.channelId, uploads, lastChecked: Date.now(), found: ids.length });
    if (!ids.length) continue;
    const r = await recordsFor(client, ids, state, 'channel', { id: f.channelId, name: f.name, subscribers: state.channels[f.channelId]?.subscribers ?? null });
    records.push(...r.records); Object.assign(channels, r.channels);
  }
  return { records, channels, updated };
}

/** Title + channel for a pasted link, without an API key (best effort; CORS may block it). */
export async function fetchOEmbed(id, fetchFn = (...a) => fetch(...a)) {
  try {
    const res = await fetchFn(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
    if (!res.ok) return null;
    const j = await res.json();
    const title = decodeEntities(j.title), channel = decodeEntities(j.author_name);
    return title || channel ? { title, channel } : null;
  } catch { return null; }
}
