// One teacher (a YouTube channel) as the app knows them: which of the known videos are theirs, what they usually teach,
// how it has gone for you, and how to browse their videos. Pure functions: no DOM, no network.

import { channelMatcher, normName } from './channel.js';
import { CATALOGUE } from './catalogue.js';
import { AREA_BY_ID, POSE_BY_ID, areaLabel, parentOf } from './lexicon.js';
import { STYLE_BY_ID } from './style.js';
import { RATING_VALUE } from './model.js';
import { formatDuration } from './analyze.js';

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const tally = (items) => { const t = new Map(); for (const i of items) if (i != null && i !== '') t.set(i, (t.get(i) ?? 0) + 1); return [...t].sort((a, b) => b[1] - a[1]); };
const CHANNEL_ID = /^UC[\w-]{22}$/;

// ---------------------------------------------------------------- who is meant

/**
 * Work out which teacher a name (or a channel id) refers to: the list's entry, one you kept from Gemini, and what the known videos say
 * about the channel's id. A teacher the app has never heard of still works (it just has nothing yet).
 * @param {string} nameOrId
 * @param {{videos?:object, channels?:object, following?:object[], myTeachers?:object[], aliases?:Record<string,string>, catalogue?:object[]}} [from]  aliases: the channel you picked for a name (state.teacherChannels)
 * @returns {{name:string, channelId:string|null, handle:string|null, entry:object|null, mine:boolean, followed:object|null, known:boolean}}
 */
export function resolveTeacher(nameOrId, { videos = {}, channels = {}, following = [], myTeachers = [], aliases = {}, catalogue = CATALOGUE } = {}) {
  const raw = String(nameOrId ?? '').trim();
  const byId = CHANNEL_ID.test(raw) ? raw : null;
  const idName = byId ? (channels[byId]?.name ?? following.find((f) => f.channelId === byId)?.name ?? Object.values(videos).find((v) => v.channelId === byId)?.channel ?? '') : '';
  const name = idName || raw;
  const key = normName(name);
  const mineEntry = myTeachers.find((t) => normName(t.name) === key) ?? null;
  const entry = catalogue.find((t) => normName(t.name) === key) ?? mineEntry;
  const theirs = Object.values(videos).filter((v) => (v.channelId && v.channelId === byId) || (v.channel && normName(v.channel) === key));
  const channelId = byId ?? aliases[key] ?? tally(theirs.map((v) => v.channelId))[0]?.[0] ?? following.find((f) => normName(f.name) === key)?.channelId
    ?? Object.values(channels).find((c) => normName(c.name) === key)?.id ?? null;
  const display = entry?.name ?? tally(theirs.map((v) => v.channel))[0]?.[0] ?? name;
  const followed = following.find((f) => (channelId && f.channelId === channelId) || normName(f.name) === key) ?? null;
  return { name: display, channelId, handle: entry?.handle ?? null, entry, mine: entry?.by === 'gemini' && !!mineEntry, followed, known: !!(entry || theirs.length || followed) };
}

/** The known videos that are this teacher's (by channel id when YouTube gave one, else by the channel's name). */
export function teacherVideos(ref, videos) {
  const is = channelMatcher([{ name: ref.name, channelId: ref.channelId }]);
  return Object.values(videos).filter((v) => is(v));
}

/** Where to send someone who wants to see the teacher on YouTube. */
export function teacherYoutubeUrl(ref) {
  if (ref.channelId) return `https://www.youtube.com/channel/${ref.channelId}`;
  if (ref.handle) return `https://www.youtube.com/${ref.handle}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ref.name} yoga stretching`)}`;
}

/** What to hand to the importer so it finds this teacher's channel: the id if known, else the handle, else the name. */
export const teacherImportInput = (ref) => ref.channelId || ref.handle || ref.name;

// ---------------------------------------------------------------- what they usually teach

const LENGTHS = [['under10', 'Under 10 min', 0, 600], ['10to20', '10–20 min', 600, 1200], ['20to45', '20–45 min', 1200, 2700], ['over45', 'Over 45 min', 2700, Infinity]];
export const LENGTH_CHOICES = LENGTHS.map(([id, label]) => [id, label]);
const lengthOf = (sec) => LENGTHS.find(([, , lo, hi]) => sec >= lo && sec < hi)?.[0] ?? null;

const kindOf = (v) => {
  const id = v.profile?.kind?.id ?? Object.entries(v.profile?.styles ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return id && STYLE_BY_ID[id] ? id : null;
};

/**
 * What the known videos say about how this teacher teaches.
 * @param {object[]} vids  the teacher's videos (teacherVideos)
 * @param {{library?:object, history?:{videoId:string, ratings?:object}[], spots?:{id:string, mode?:string}[]}} [o]  spots: your standing tight/weak areas
 */
export function teacherProfile(vids, { library = {}, history = [], spots = [] } = {}) {
  const n = vids.length;
  const ids = new Set(vids.map((v) => v.id));
  const counts = {
    inLibrary: vids.filter((v) => library[v.id]).length,
    withComments: vids.filter((v) => (v.comments?.length ?? 0) > 0 || (v.evidence?.n ?? 0) > 0).length,
    withChapters: vids.filter((v) => (v.profile?.chapters?.length ?? 0) >= 3).length,
    aiRead: vids.filter((v) => v.ai).length,
  };

  const kinds = tally(vids.map(kindOf)).slice(0, 5).map(([id, c]) => ({ id, name: STYLE_BY_ID[id].name, n: c, share: c / n }));
  const levels = Object.fromEntries(tally(vids.map((v) => v.profile?.level)));
  const pace = Object.fromEntries(tally(vids.map((v) => v.profile?.traits?.pace).filter((p) => p && p !== 'steady')));
  const props = tally(vids.flatMap((v) => v.profile?.traits?.props ?? [])).slice(0, 5).map(([id, c]) => ({ id, n: c }));

  const secs = vids.map((v) => v.durationSec).filter((s) => s != null && s > 0);
  const length = {
    n: secs.length, min: secs.length ? Math.min(...secs) : null, max: secs.length ? Math.max(...secs) : null, median: median(secs),
    buckets: Object.fromEntries(LENGTHS.map(([id]) => [id, secs.filter((s) => lengthOf(s) === id).length])),
  };

  // muscle areas: how much of the time a video works them (mean of the video scores), and in how many it is a main focus
  const total = new Map();
  for (const v of vids) for (const [a, s] of Object.entries(v.profile?.areas ?? {})) if (AREA_BY_ID[a] && a !== 'full_body') { const e = total.get(a) ?? { sum: 0, focus: 0 }; e.sum += s; if (s >= 0.5) e.focus++; total.set(a, e); }
  const areas = [...total].map(([id, e]) => ({ id, label: areaLabel(id), score: e.sum / n, videos: e.focus, share: e.focus / n }))
    .filter((a) => a.videos > 0).sort((a, b) => b.share - a.share || b.score - a.score).slice(0, 8);
  const fullBody = vids.filter((v) => (v.profile?.areas?.full_body ?? 0) >= 0.5).length;

  const poses = tally(vids.flatMap((v) => [...new Set((v.profile?.poses ?? []).map((p) => p.id))])).filter(([id]) => POSE_BY_ID[id]).slice(0, 6).map(([id, c]) => ({ id, label: POSE_BY_ID[id].label, n: c }));

  // how well your standing spots are covered by what they teach
  const share = (id) => { const own = total.get(id)?.focus ?? 0; const par = parentOf(id) ? (total.get(parentOf(id))?.focus ?? 0) : 0; return Math.max(own, par) / (n || 1); };
  const fits = spots.filter((s) => AREA_BY_ID[s.id]).map((s) => ({ id: s.id, label: areaLabel(s.id), mode: s.mode ?? 'tight', share: share(s.id) })).sort((a, b) => b.share - a.share);

  // what happened when you did their videos
  const mine = history.filter((h) => ids.has(h.videoId));
  const rated = mine.flatMap((h) => Object.values(h.ratings ?? {})).map((r) => RATING_VALUE[r]).filter((x) => x != null);
  const yours = { sessions: mine.length, videos: new Set(mine.map((h) => h.videoId)).size, ratings: rated.length, helpful: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null };

  const dates = vids.map((v) => Date.parse(v.publishedAt)).filter(Number.isFinite);
  return { n, counts, kinds, levels, pace, props, length, areas, fullBody, poses, fits, yours, newest: dates.length ? Math.max(...dates) : null, oldest: dates.length ? Math.min(...dates) : null };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

/** The profile in a few plain sentences. Hedged by how little there may be to go on. */
export function teacherSummary(p) {
  if (!p.n) return [];
  const out = [];
  if (p.kinds[0]) {
    const top = p.kinds.filter((k) => k.share >= 0.2).slice(0, 3);
    out.push(top.length > 1 ? `Mostly ${list(top.map((k) => `${k.name.toLowerCase()} (${k.n})`))}.` : `${p.kinds[0].share >= 0.6 ? 'Mostly' : 'Often'} ${p.kinds[0].name.toLowerCase()} (${p.kinds[0].n} of ${p.n} videos).`);
  }
  if (p.length.median != null) {
    const [lo, hi] = [p.length.min, p.length.max].map((s) => Math.round(s / 60));
    out.push(`Usually about ${Math.round(p.length.median / 60)} minutes${hi > lo ? ` (from ${lo} to ${hi})` : ''}.`);
  }
  if (p.areas.length) out.push(`Most often works ${list(p.areas.slice(0, 3).map((a) => a.label.toLowerCase()))}${p.fullBody > p.n / 2 ? ', and many of the routines are for the whole body' : ''}.`);
  const lv = Object.entries(p.levels).sort((a, b) => b[1] - a[1])[0];
  if (lv && lv[1] >= Math.max(2, p.n * 0.3)) out.push(`Videos are mostly marked ${lv[0]} level.`);
  const pc = Object.entries(p.pace).sort((a, b) => b[1] - a[1])[0];
  if (pc && pc[1] >= Math.max(2, p.n * 0.3)) out.push(`The pace tends to be ${pc[0]}.`);
  if (p.yours.sessions) out.push(`You have done ${p.yours.sessions} of their routines${p.yours.helpful != null ? ` and ${pct(p.yours.helpful)} of your ratings said it helped` : ''}.`);
  return out;
}

/** How much to trust the above: a sentence about what it was based on. */
export function teacherBasis(p) {
  if (!p.n) return 'The app has not read any of their videos yet.';
  const bits = [`${p.n} video${p.n === 1 ? '' : 's'}`];
  if (p.counts.withComments) bits.push(`${p.counts.withComments} with viewer comments read`);
  if (p.counts.withChapters) bits.push(`${p.counts.withChapters} with a chapter list`);
  if (p.counts.aiRead) bits.push(`${p.counts.aiRead} read by Gemini`);
  const small = p.n < 5 ? ' That is a small sample: reading more of their channel gives a truer picture.' : '';
  return `Based on ${bits.join(', ')}.${small}`;
}

// ---------------------------------------------------------------- browsing their videos

export const SORTS = [['mine', 'Yours first, then most viewed'], ['popular', 'Most viewed'], ['new', 'Newest first'], ['short', 'Shortest first'], ['long', 'Longest first']];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Filter and order a teacher's videos.
 * @param {object[]} vids
 * @param {{q?:string, area?:string, kind?:string, length?:string, mine?:boolean, sort?:string}} f
 * @param {{library?:object}} [o]
 */
export function browseVideos(vids, f = {}, { library = {} } = {}) {
  const words = norm(f.q).split(' ').filter(Boolean);
  const out = vids.filter((v) => {
    if (f.mine && !library[v.id]) return false;
    if (f.kind && kindOf(v) !== f.kind) return false;
    if (f.length && lengthOf(v.durationSec ?? -1) !== f.length) return false;
    if (f.area && (v.profile?.areas?.[f.area] ?? 0) < 0.5) return false;
    if (words.length) {
      const hay = norm(`${v.title} ${(v.profile?.poses ?? []).map((p) => POSE_BY_ID[p.id]?.label ?? '').join(' ')} ${STYLE_BY_ID[kindOf(v)]?.name ?? ''} ${(library[v.id]?.tags ?? []).join(' ')} ${library[v.id]?.note ?? ''}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const views = (v) => v.views ?? 0, len = (v) => v.durationSec ?? Infinity;
  const cmp = {
    popular: (a, b) => views(b) - views(a),
    mine: (a, b) => (library[b.id] ? 1 : 0) - (library[a.id] ? 1 : 0) || views(b) - views(a),
    new: (a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0),
    short: (a, b) => len(a) - len(b),
    long: (a, b) => (b.durationSec ?? -1) - (a.durationSec ?? -1),
  }[f.sort] ?? ((a, b) => views(b) - views(a));
  return out.sort((a, b) => cmp(a, b) || a.title.localeCompare(b.title));
}

/** The choices for the filters, from what these videos actually are (so there are no empty options). */
export function browseChoices(vids) {
  const areas = tally(vids.flatMap((v) => Object.entries(v.profile?.areas ?? {}).filter(([a, s]) => s >= 0.5 && a !== 'full_body' && AREA_BY_ID[a]).map(([a]) => a))).map(([id, c]) => ({ id, label: areaLabel(id), n: c }));
  const kinds = tally(vids.map(kindOf)).map(([id, c]) => ({ id, name: STYLE_BY_ID[id].name, n: c }));
  const lengths = LENGTHS.map(([id, label]) => ({ id, label, n: vids.filter((v) => lengthOf(v.durationSec ?? -1) === id).length })).filter((l) => l.n);
  return { areas, kinds, lengths };
}

/** A video's length, as a person writes it ("12:30", "~12:30" when it is a guess). */
export const lengthLabel = (v) => (v.durationSec == null ? '?' : `${v.durationApprox ? '~' : ''}${formatDuration(v.durationSec)}`);
