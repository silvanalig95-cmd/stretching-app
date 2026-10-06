// YouTube Data API v3 client + the "go find me new stuff" pipeline.
//
// Needs a (free) API key from the user. Costs per call: search 100 units,
// everything else 1 unit, against a default 10,000/day allowance, so one
// discovery run (2 searches + details + comments for ~10 videos) is ~210 units.

import { decodeEntities, parseIsoDuration, analyzeVideoText, attachComments, reanalyze } from './analyze.js';
import { buildModel, rankCandidates, channelKey } from './model.js';
import { buildQueries, expandQueries } from './query.js';
import { SearchIndex } from './index.js';
import { normalize } from './lexicon.js';

export const API_BASE = 'https://www.googleapis.com/youtube/v3';
export const PROXY_BASE = '/api/yt';   // the Unfurl server, when it keeps the YouTube key itself (see serve.py)
export const COST = { search: 100, videos: 1, commentThreads: 1, channels: 1, playlistItems: 1, playlists: 1 };
export const DAILY_QUOTA = 10000;

export class YouTubeError extends Error {
  constructor(message, { status = 0, reason = '' } = {}) { super(message); this.name = 'YouTubeError'; this.status = status; this.reason = reason; }
}
export class QuotaError extends YouTubeError { constructor(m, o) { super(m, o); this.name = 'QuotaError'; } }
export class KeyError extends YouTubeError { constructor(m, o) { super(m, o); this.name = 'KeyError'; } }
export class CommentsDisabledError extends YouTubeError { constructor(m, o) { super(m, o); this.name = 'CommentsDisabledError'; } }

/** Map a real YouTube API error body to something a person can act on. */
export function toApiError(status, body, viaServer = false) {
  const err = body?.error ?? {};
  const reason = err.errors?.[0]?.reason ?? '';
  const detail = err.details?.find((d) => d.reason)?.reason ?? '';
  const msg = err.message ?? `HTTP ${status}`;
  const o = { status, reason: detail || reason };
  if (['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)) {
    return new QuotaError(viaServer && err.errors?.[0]?.domain === 'unfurl' ? `${msg} It resets at midnight Pacific time.` : 'Today’s YouTube search allowance is used up. It resets at midnight Pacific time.', o);
  }
  if (viaServer && (detail === 'API_KEY_INVALID' || detail === 'SERVICE_DISABLED' || reason === 'keyInvalid' || reason === 'accessNotConfigured')) {
    return new KeyError('The YouTube key kept on this server isn’t working. Tell whoever runs the server, or paste a key of your own in Settings.', o);
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
    this.proxied = !key;   // no key of our own: the server adds its key (and enforces each person's daily share)
    this.spentUnits = 0;   // quota units this client has used (so a long search can respect a budget)
  }

  async call(endpoint, params) {
    const url = new URL(`${this.base}/${endpoint}`, globalThis.location?.href);   // a relative base (the server's proxy) needs the page address
    for (const [k, v] of Object.entries({ ...params, key: this.key })) if (v != null && v !== '') url.searchParams.set(k, v);
    let res;
    try { res = await this.fetchFn(url.toString()); } catch (e) { throw new YouTubeError(`Couldn’t reach ${this.proxied ? 'the Unfurl server' : 'YouTube'} (${e.message}). Check your connection.`); }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw toApiError(res.status, body, this.proxied);
    const units = COST[endpoint] ?? 1;
    this.spentUnits += units;
    this.onSpend(units);
    return body;
  }

  async search({ q, order = 'relevance', pageToken, videoDuration, maxResults = 50 }) {
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
/**
 * How hard a web search tries. The expensive part is searching (100 units per page of up to 50
 * results); reading a video's comments costs 1 unit. So the wide-net presets look at MANY candidates
 * and read comments on the best few dozen, and keep going in rounds until enough strong fits turn up.
 * `budget` is a hard cap on units for one run (searches + comments).
 */
export const THOROUGHNESS = {
  quick:      { label: 'Quick',      queries: 1, extraPages: 1, maxRounds: 1, budget: 250,  commentVideos: 12, strongFits: 1,  blurb: 'one search, about 50–100 videos looked at' },
  balanced:   { label: 'Balanced',   queries: 2, extraPages: 1, maxRounds: 3, budget: 650,  commentVideos: 25, strongFits: 4,  blurb: 'up to 3 rounds; stops once 4 strong fits turn up' },
  thorough:   { label: 'Thorough',   queries: 3, extraPages: 2, maxRounds: 5, budget: 1500, commentVideos: 40, strongFits: 8,  blurb: 'up to 5 rounds, hundreds of videos, comments on the best 40' },
  exhaustive: { label: 'Exhaustive', queries: 4, extraPages: 3, maxRounds: 8, budget: 3000, commentVideos: 60, strongFits: 14, blurb: 'leaves no stone unturned (uses a big slice of the daily allowance)' },
};
export const DEFAULT_THOROUGHNESS = 'balanced';
export const effortFor = (name) => THOROUGHNESS[name] ?? THOROUGHNESS[DEFAULT_THOROUGHNESS];

/** Rough cost of one run: the cap, and what it usually takes (stops early once enough strong fits are found). */
export function estimateRunCost(name = DEFAULT_THOROUGHNESS) {
  const e = effortFor(name);
  return { max: e.budget, typical: Math.round(e.budget * 0.45) };
}

// ---------------------------------------------------------------- discovery

const MIN_SEC = 90, MAX_SEC = 3 * 3600;
const MIN_FRESH = 3; // a result page with fewer than this many unknown videos triggers a look at the next page

/**
 * Go and find new routines for these filters: a WIDE net, then a careful read.
 *
 *   rounds:   search -> details -> score every candidate against the request
 *             -> if there aren't yet enough strong fits, learn from the best ones
 *             (their poses, teachers, tags) and search again, never repeating a query
 *   stopping: enough strong fits found, rounds used up, or the unit budget reached
 *   then:     read viewer comments on the best candidates (1 unit each, cheap), re-rank
 *             with what they say, and read a few more that moved up
 *
 * Never mutates `state`; the caller merges `records` / `queryUpdates` / `channels`.
 */
export async function discover({ client, filters, state, rng, progress = () => {}, opts = {} }) {
  const o = { queries: 2, commentVideos: 25, extraPages: 1, maxRounds: 1, budget: Infinity, strongFits: 0, ...opts };
  const hasTarget = !!(filters.areas?.length || filters.terms?.length);
  if (!hasTarget) o.maxRounds = 1;                      // nothing to measure "fit" against: one pass is all there is
  const model = buildModel(state.history, state.videos);
  const libraryIds = new Set(Object.keys(state.library ?? {}));
  const knownTeachers = new Set();
  for (const v of Object.values(state.videos)) if (model.channelDone.has(channelKey(v))) knownTeachers.add(normalize(v.channel).replace(/ /g, ''));

  const startUnits = client.spentUnits ?? 0;
  const spent = () => (client.spentUnits ?? 0) - startUnits;
  const commentReserve = Math.min(o.commentVideos, 60);
  const searchBudget = Number.isFinite(o.budget) ? o.budget - commentReserve - 10 : Infinity;   // keep room for the comment phase

  const report = { queries: [], warnings: [], newVideos: 0, newChannels: 0, commentsRead: 0, rounds: 0, examined: 0, strong: 0, spent: 0, stopped: '' };
  const log = { ...state.queryLog };        // grows as we go, so later rounds never repeat earlier queries
  const queryUpdates = {};
  const found = new Map();                   // id -> search item: everything surfaced this run
  const touched = new Map();                 // id -> full, analysed record
  const freshIds = new Set();                // ids the library had never seen before this run
  let expansion = [], stop = false;
  const now = Date.now();

  // ---- how well does everything we have so far fit the request?
  const rankRun = () => {
    const videos = [...found.keys()].map((id) => touched.get(id) ?? state.videos[id]).filter(Boolean);
    let textScores = null;
    if (filters.terms?.length) {
      const rel = SearchIndex.fromVideos(Object.fromEntries(videos.map((v) => [v.id, v])), state.library).relevance(filters.terms, {});
      if (rel.size) textScores = rel;
    }
    return rankCandidates({ videos, filters, model, textScores, libraryIds, trusted: state.prefs.trusted, blocked: state.blocked, blockedChannels: state.blockedChannels, adventure: state.prefs.adventure });
  };
  const isStrong = (r) => r.parts.match >= 0.65 && r.parts.fit >= 0.99 && r.parts.quality >= 0.45;

  const fetchDetails = async () => {
    const need = [...found.keys()].filter((id) => !touched.has(id) && !state.videos[id]?.verified);
    // known, verified videos take part too: they just need no re-fetch
    for (const id of found.keys()) if (!touched.has(id) && state.videos[id]?.verified) touched.set(id, { ...state.videos[id] });
    if (!need.length) return;
    progress(`Reading details for ${need.length} videos…`);
    for (const r of await client.videos(need)) {
      if (r.live || r.durationSec == null || r.durationSec < MIN_SEC || r.durationSec > MAX_SEC || r.embeddable === false) continue;
      const rec = reanalyze(mergeVideo(state.videos[r.id], { ...r, source: 'search', addedAt: now }));
      touched.set(r.id, rec);
      if (!state.videos[r.id]) freshIds.add(r.id);
    }
  };

  // ---- rounds
  for (let round = 1; round <= o.maxRounds && !stop; round++) {
    report.rounds = round;
    const base = buildQueries(filters, { queryLog: log, rng, n: o.queries, knownTeachers, adventure: state.prefs.adventure });
    const seen = new Set();
    const queries = [...expansion, ...base].filter((q) => (seen.has(q.key) ? false : seen.add(q.key)));

    for (const q of queries) {
      let page = q, pages = 0, fresh = 0;
      for (;;) {
        if (spent() + COST.search > searchBudget) { report.stopped = 'budget'; stop = true; break; }
        progress(`Round ${round}: searching YouTube for “${q.q}”${page.pageToken ? ' (going deeper)' : ''}…`);
        let res;
        try {
          res = await client.search(page);
        } catch (e) {
          if (found.size && (e instanceof QuotaError)) { report.warnings.push(e.message); stop = true; break; }
          throw e;
        }
        pages++;
        const prev = log[q.key] ?? {};
        queryUpdates[q.key] = log[q.key] = { ...prev, count: (prev.count ?? 0) + (pages === 1 ? 1 : 0), lastAt: now, order: q.order, nextPageToken: res.nextPageToken, q: q.q };
        const newHere = res.items.filter((it) => !state.videos[it.id] && !found.has(it.id)).length;
        fresh += newHere;
        for (const it of res.items) if (!found.has(it.id)) found.set(it.id, it);
        // Mostly videos we already know? Look further down rather than come back empty-handed.
        if (newHere >= MIN_FRESH || !res.nextPageToken || pages > o.extraPages) break;
        progress('Mostly familiar results, so looking a little further down…');
        page = { ...q, pageToken: res.nextPageToken };
      }
      if (pages) report.queries.push({ q: q.q, order: q.order, deeper: !!q.pageToken, pages, fresh, round });
      if (stop) break;
    }

    await fetchDetails();
    report.examined = found.size;
    const ranked = rankRun();
    const strong = ranked.filter((r) => isStrong(r) && freshIds.has(r.video.id));
    report.strong = strong.length;
    progress(`Round ${round}: looked at ${found.size} videos so far, ${strong.length} strong fit${strong.length === 1 ? '' : 's'}.`);
    if (o.strongFits && strong.length >= o.strongFits) { report.stopped = 'enough'; break; }
    if (stop || round === o.maxRounds) break;
    expansion = expandQueries(ranked.slice(0, 8).map((r) => r.video), filters, { queryLog: log, rng, n: 2 });
  }
  if (!report.stopped) report.stopped = 'rounds';
  report.newVideos = freshIds.size;

  // ---- who are these teachers? (subscriber counts reveal small channels worth a look)
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
  }

  // ---- the careful read: viewer comments on the best candidates, re-ranked as the evidence arrives
  const hardCap = Number.isFinite(o.budget) ? o.budget : Infinity;
  const readIds = new Set();
  for (let pass = 0; pass < 3 && readIds.size < o.commentVideos; pass++) {
    const toRead = rankRun().map((r) => r.video)
      .filter((v) => !readIds.has(v.id) && !v.comments && !(v.evidence?.n > 0) && (v.commentCount == null || v.commentCount >= 3))
      .slice(0, o.commentVideos - readIds.size);
    if (!toRead.length) break;
    let i = 0, quotaOut = false;
    for (const v of toRead) {
      if (spent() + COST.commentThreads > hardCap) { quotaOut = true; break; }
      progress(`Reading viewer comments (${readIds.size + 1}/${o.commentVideos}): ${v.title.slice(0, 48)}…`);
      readIds.add(v.id);
      let comments;
      try { comments = await client.comments(v.id); } catch (e) { if (e instanceof QuotaError) { report.warnings.push(e.message); quotaOut = true; break; } continue; }
      const rec = attachComments(touched.get(v.id), comments);
      touched.set(v.id, rec);
      report.commentsRead += rec.evidence.n;
      i++;
    }
    if (quotaOut) break;
  }

  report.strong = rankRun().filter((r) => isStrong(r) && freshIds.has(r.video.id)).length;
  report.spent = spent();
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
