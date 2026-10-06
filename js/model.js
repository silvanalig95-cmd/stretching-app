// Ranking + learning.
//
// A candidate video is scored from four independent signals:
//   match    - how strongly its profile (title, chapters, poses, comments) covers
//              the muscle areas you asked for
//   quality  - likes/views, popularity, comment sentiment, teacher trust
//   learned  - what YOUR past "did it help?" answers predict for it
//   novelty  - new teacher / never-done video (weighted by your "adventure" setting)
// then adjusted for length fit, style fit and how recently you did it.
//
// The learned part is rebuilt from the history log every time (no hidden
// state), so editing or deleting a history entry changes the model honestly.

import { POSE_BY_ID, AREA_BY_ID, parentOf } from './lexicon.js';
import { qualityScore, isHiddenGem, explainMatch } from './analyze.js';

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

export const RATING_VALUE = { much: 1, some: 0.5, none: 0 };
const INTENSITY_VALUE = { easy: -1, right: 0, hard: 1 };
const W = { match: 0.42, quality: 0.18, learned: 0.22, novel: 0.2 };
/** How much a favourite channel's video can gain (at most, and only when it fits the request fully): +22 %. */
export const FAVORITE_BOOST = 0.22;

// ---------------------------------------------------------------- random helpers

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Same date + salt => same sequence, so "today's routine" doesn't change on reload. */
export const seededRng = (dateStr, salt = 0) => mulberry32(hashString(`${dateStr}#${salt}`));

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- identity helpers

export const channelKey = (v) => (v.channelId || v.channel || '').toLowerCase();

/** A test for "is this video from one of these channels?" (the blocked list, the favourites list). Entries look like {key, name, channelId?}. */
export function channelMatcher(channels = []) {
  const ids = new Set(), keys = new Set(), names = new Set();
  for (const c of channels) {
    if (c.channelId) ids.add(c.channelId);
    if (c.key) keys.add(c.key);
    if (c.name) names.add(normName(c.name));
  }
  if (!ids.size && !keys.size && !names.size) return () => false;
  // by id when YouTube gave one, else by the channel's name (the starter suggestions only know the name)
  return (v) => !!((v.channelId && ids.has(v.channelId)) || keys.has(channelKey(v)) || (v.channel && names.has(normName(v.channel))));
}
export const channelBlocker = channelMatcher;
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export function isTrusted(video, trusted = []) {
  const ch = normName(video.channel);
  return !!ch && trusted.some((t) => { const n = normName(t); return n && (ch.includes(n) || n.includes(ch)); });
}
const bucket = (sec) => (sec == null ? 'unknown' : sec < 480 ? 'xs' : sec < 900 ? 's' : sec < 1500 ? 'm' : sec < 2400 ? 'l' : 'xl');

// ---------------------------------------------------------------- the learned model

function add(map, key, value, w = 1) {
  const e = map.get(key) ?? { sum: 0, w: 0, n: 0 };
  e.sum += value * w; e.w += w; e.n++;
  map.set(key, e);
}
const mean = (e) => (e && e.w ? e.sum / e.w : null);

/** Rebuild everything we know about the user from their history log. */
export function buildModel(history, videos) {
  const m = {
    sessions: history.length,
    videoArea: new Map(), channel: new Map(), channelArea: new Map(), pose: new Map(),
    style: new Map(), durBucket: new Map(), areaTotals: new Map(),
    doneCount: new Map(), lastDone: new Map(), channelDone: new Map(),
    intensity: { sum: 0, n: 0 }, ratings: 0,
  };
  for (const h of history) {
    const v = videos[h.videoId];
    m.doneCount.set(h.videoId, (m.doneCount.get(h.videoId) ?? 0) + 1);
    if (!m.lastDone.has(h.videoId) || h.date > m.lastDone.get(h.videoId)) m.lastDone.set(h.videoId, h.date);
    const ck = v ? channelKey(v) : '';
    if (ck) m.channelDone.set(ck, (m.channelDone.get(ck) ?? 0) + 1);
    if (h.intensity in INTENSITY_VALUE) { m.intensity.sum += INTENSITY_VALUE[h.intensity]; m.intensity.n++; }

    for (const [a, r] of Object.entries(h.ratings ?? {})) {
      const val = RATING_VALUE[r];
      if (val == null) continue;
      m.ratings++;
      add(m.videoArea, `${h.videoId}|${a}`, val);
      add(m.areaTotals, a, val);
      if (!v) continue;
      if (ck) { add(m.channel, ck, val); add(m.channelArea, `${a}|${ck}`, val); }
      // Credit the exercises in the video that actually work this area.
      for (const { id } of v.profile?.poses ?? []) {
        const w = POSE_BY_ID[id]?.areas[a];
        if (w >= 0.5) add(m.pose, `${a}|${id}`, val, w);
      }
      for (const [s, sc] of Object.entries(v.profile?.styles ?? {})) if (sc >= 0.4) add(m.style, s, val);
      add(m.durBucket, bucket(v.durationSec), val);
    }
  }
  return m;
}

/**
 * What does the user's own history predict this video will do for the areas
 * they want? 0.5 = no idea; confidence says how much data backs the number.
 */
export function predictLearned(model, video, selected) {
  const notes = [];
  const ck = channelKey(video);
  let total = 0, conf = 0;
  const areas = selected.length ? selected : [];
  for (const { id: a } of areas) {
    let sw = 1, swv = 0.5; // prior: neutral, worth one observation
    const direct = model.videoArea.get(`${video.id}|${a}`);
    if (direct) {
      sw += 3 * direct.n; swv += 3 * direct.sum;
      notes.push({ s: 3, text: `You rated this ${direct.n}× for ${AREA_BY_ID[a]?.label ?? a}: ${Math.round(mean(direct) * 100)}% helpful` });
    }
    const ch = model.channelArea.get(`${a}|${ck}`) ?? null;
    if (ch && ck) { const w = 0.6 * Math.min(ch.n, 5); sw += w; swv += w * mean(ch); }
    for (const { id } of video.profile?.poses ?? []) {
      const pw = POSE_BY_ID[id]?.areas[a];
      const e = model.pose.get(`${a}|${id}`);
      if (pw >= 0.5 && e) {
        const w = 0.5 * Math.min(e.n, 4); sw += w; swv += w * mean(e);
        if (e.n >= 2 && mean(e) >= 0.7) notes.push({ s: 1 + mean(e), text: `${POSE_BY_ID[id].label} has helped your ${AREA_BY_ID[a]?.label ?? a} (${e.n} ratings)` });
      }
    }
    total += swv / sw;
    conf += (sw - 1) / sw;
  }
  const n = areas.length || 1;
  let value = total / n;
  // Overall taste: styles and teachers that work for you in general.
  const styleEdges = Object.entries(video.profile?.styles ?? {}).filter(([, s]) => s >= 0.4).map(([s]) => mean(model.style.get(s))).filter((x) => x != null);
  if (styleEdges.length) value = 0.85 * value + 0.15 * (styleEdges.reduce((a, b) => a + b, 0) / styleEdges.length);
  return { value: clamp(value), confidence: clamp(conf / n), notes: notes.sort((a, b) => b.s - a.s).map((x) => x.text).slice(0, 2) };
}

export function teacherTrust(video, model, trusted = []) {
  const base = isTrusted(video, trusted) ? 0.75 : 0.5;
  const e = model.channel.get(channelKey(video));
  if (!e) return base;
  return (base * 2 + mean(e) * Math.min(e.n, 8)) / (2 + Math.min(e.n, 8));
}

// ---------------------------------------------------------------- scoring pieces

function strengthShare(video, area) {
  const moves = (video.profile?.poses ?? []).filter(({ id }) => (POSE_BY_ID[id]?.areas[area] ?? 0) >= 0.5);
  if (!moves.length) return null;
  const w = moves.reduce((s, { id }) => s + (POSE_BY_ID[id].mode === 'strength' ? 1 : POSE_BY_ID[id].mode === 'both' ? 0.5 : 0), 0);
  return w / moves.length;
}

/** "Tight" areas want stretch/release videos; "weak" areas want strengthening ones. */
export function modeFit(video, area, mode) {
  const st = video.profile?.styles ?? {};
  const share = strengthShare(video, area);
  if (mode === 'weak') {
    const s = Math.max(st.strength ?? 0, share ?? 0);
    return 0.6 + 0.4 * s;
  }
  const s = Math.max(st.stretch ?? 0, st.yin ?? 0, st.restorative ?? 0, st.mobility ?? 0, share == null ? 0 : 1 - share);
  return 0.75 + 0.25 * s;
}

export function matchScore(video, selected) {
  if (!selected.length) return 0.5;
  let tot = 0;
  for (const { id, mode } of selected) tot += (video.profile?.areas?.[id] ?? 0) * modeFit(video, id, mode);
  return tot / selected.length;
}

export function lengthFit(video, minMin, maxMin) {
  if (video.durationSec == null) return 0.55;
  const d = video.durationSec / 60;
  if (d >= minMin && d <= maxMin) return 1;
  const dist = d < minMin ? minMin - d : d - maxMin;
  const tol = Math.max(2, 0.2 * (d < minMin ? minMin : maxMin));
  if (dist > tol) return 0;
  return 0.9 - 0.6 * (dist / tol);
}

export function recencyPenalty(model, videoId, today = localDate()) {
  const last = model.lastDone.get(videoId);
  if (!last) return 0;
  const days = Math.round((Date.parse(today) - Date.parse(last)) / 86400000);
  const base = days < 1 ? 0.5 : days < 3 ? 0.35 : days < 7 ? 0.2 : days < 21 ? 0.08 : 0.02;
  return base + Math.min(0.15, 0.03 * (model.doneCount.get(videoId) ?? 0));
}

/**
 * Rank candidate videos for a request.
 * @param {object} p
 * @param {object[]} p.videos        candidate records
 * @param {{areas:{id:string,mode:string}[], minMin:number, maxMin:number, styles:string[]}} p.filters
 * @param {object} p.model           from buildModel
 */
export function rankCandidates({
  videos, filters, model, trusted = [], blocked = [], blockedChannels = [], favoriteChannels = [], adventure = 0.35, today = localDate(), now = Date.now(),
  textScores = null,   // Map id -> 0..1 relevance of the free-text terms the user typed (from the search index)
  libraryIds = null,   // Set of ids in the user's library
  collectionIds = null, // Set of ids in the collection the person picked ("Morning"): nothing else is considered
}) {
  const selected = filters.areas ?? [];
  const blockedSet = new Set(blocked);
  const channelBlocked = channelBlocker(blockedChannels);
  const isFavorite = channelMatcher(favoriteChannels);
  const useText = !!(filters.terms?.length && textScores);
  const out = [];
  for (const video of videos) {
    if (blockedSet.has(video.id) || channelBlocked(video) || video.broken || video.embeddable === false) continue;
    const inLib = !!libraryIds?.has(video.id);
    if (filters.source === 'library' && !inLib) continue;
    if (filters.source === 'discovered' && inLib) continue;
    if (collectionIds && !collectionIds.has(video.id)) continue;
    const fit = lengthFit(video, filters.minMin ?? 0, filters.maxMin ?? 999);
    if (fit === 0) continue;
    const areaMatch = matchScore(video, selected);
    if (selected.length && areaMatch < 0.12) continue;
    // Typed words ("pigeon", a teacher's name) count alongside the muscles; typed alone, they must match.
    const text = useText ? textScores.get(video.id) ?? 0 : null;
    if (useText && !selected.length && text === 0) continue;
    const match = text == null ? areaMatch : selected.length ? 0.65 * areaMatch + 0.35 * text : text;

    const quality = qualityScore(video, { teacherTrust: teacherTrust(video, model, trusted) });
    const learned = predictLearned(model, video, selected);
    const chNew = model.channelDone.has(channelKey(video)) ? 0 : 1;
    const vidNew = model.doneCount.has(video.id) ? 0 : 1;
    const novelty = 0.6 * chNew + 0.4 * vidNew;

    const nw = adventure * W.novel;
    let score = (W.match * match + W.quality * quality + W.learned * learned.value + nw * novelty) / (W.match + W.quality + W.learned + nw);
    score *= 0.4 + 0.6 * fit;
    if (filters.styles?.length) {
      const has = filters.styles.some((s) => (video.profile?.styles?.[s] ?? 0) >= 0.3);
      if (!has) score *= 0.45;
    }
    // If sessions keep being "too hard" (or "too easy") nudge the level.
    if (model.intensity.n >= 3) {
      const bias = model.intensity.sum / model.intensity.n;
      const lvl = video.profile?.level;
      if (bias > 0.4 && lvl === 'beginner') score *= 1.06;
      if (bias > 0.4 && lvl === 'advanced') score *= 0.9;
      if (bias < -0.4 && lvl === 'advanced') score *= 1.06;
      if (bias < -0.4 && lvl === 'beginner') score *= 0.92;
    }
    // A favourite channel gets a lift, but only as much as the video already fits what was asked for
    // (its muscles, its length, the style): a poor fit from a favourite stays a poor fit.
    const favorite = isFavorite(video);
    let lift = 0;
    if (favorite) {
      const relevance = selected.length ? areaMatch : text ?? 1;
      const styleOk = !filters.styles?.length || filters.styles.some((s) => (video.profile?.styles?.[s] ?? 0) >= 0.3);
      lift = styleOk ? clamp((relevance - 0.2) / 0.3) * clamp((fit - 0.3) / 0.7) : 0;
      score *= 1 + FAVORITE_BOOST * lift;
    }
    score -= recencyPenalty(model, video.id, today);

    out.push({
      video, score,
      parts: { match, quality, learned: learned.value, confidence: learned.confidence, novelty, fit, favorite: lift },
      flags: {
        favorite,
        newChannel: !!chNew && !isTrusted(video, trusted),
        newVideo: !!vidNew,
        hiddenGem: isHiddenGem(video),
        trusted: isTrusted(video, trusted),
        commentsRead: (video.evidence?.n ?? 0) >= 5,
        inLibrary: inLib,
        suggestion: video.source === 'suggestion',
      },
      reasons: [
        ...(lift >= 0.5 ? [`★ From “${video.channel}”, a channel you marked as a favourite`] : []),
        ...(text >= 0.5 ? [`Matches what you typed: “${filters.terms.join(' ')}”`] : []),
        ...learned.notes.map((t) => `📈 ${t}`),
        ...explainMatch(video, selected.map((s) => s.id)),
      ],
    });
  }
  out.sort((a, b) => b.score - a.score);
  return diversify(out);
}

/** Don't fill the top of the list with one teacher. */
function diversify(ranked) {
  const seen = new Map();
  const adj = ranked.map((r) => {
    const k = channelKey(r.video) || r.video.id;
    const c = seen.get(k) ?? 0;
    seen.set(k, c + 1);
    return { r, s: r.score - 0.035 * c };
  });
  return adj.sort((a, b) => b.s - a.s).map((x) => x.r);
}

/**
 * Pick one routine from the top of the ranking. Seeded, so "today's" pick is
 * stable; a different salt gives a different (but still good) pick.
 */
export function pickRoutine(ranked, rng, { k = 6, temperature = 0.06 } = {}) {
  const top = ranked.slice(0, k);
  if (!top.length) return null;
  const best = top[0].score;
  const weights = top.map((r) => Math.exp((r.score - best) / temperature));
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) { x -= weights[i]; if (x <= 0) return top[i]; }
  return top[0];
}

// ---------------------------------------------------------------- what the app has learned

/** For the journal: per area, what's actually been working for this person. */
export function insights(model, videos) {
  const perArea = {};
  for (const [a, e] of model.areaTotals) perArea[a] = { area: a, ratings: e.n, helped: mean(e), poses: [], teachers: [], videos: [] };
  for (const [key, e] of model.pose) {
    const [a, id] = key.split('|');
    perArea[a]?.poses.push({ id, label: POSE_BY_ID[id]?.label ?? id, n: e.n, helped: mean(e) });
  }
  for (const [key, e] of model.channelArea) {
    const [a, ck] = key.split('|');
    const name = Object.values(videos).find((v) => channelKey(v) === ck)?.channel ?? ck;
    perArea[a]?.teachers.push({ name, n: e.n, helped: mean(e) });
  }
  for (const [key, e] of model.videoArea) {
    const [id, a] = key.split('|');
    perArea[a]?.videos.push({ id, title: videos[id]?.title ?? id, n: e.n, helped: mean(e) });
  }
  const best = (list, minN) => list.filter((x) => x.n >= minN).sort((x, y) => y.helped - x.helped || y.n - x.n).slice(0, 3);
  return Object.values(perArea)
    .map((p) => ({ ...p, poses: best(p.poses, 2), teachers: best(p.teachers, 2), videos: best(p.videos, 1) }))
    .sort((a, b) => b.ratings - a.ratings);
}

/** How many usable library videos cover each area? Used to grow the library where it's thin. */
export function coverage(videos, blocked = []) {
  const bl = new Set(blocked);
  const counts = Object.fromEntries(Object.keys(AREA_BY_ID).map((a) => [a, 0]));
  for (const v of videos) {
    if (bl.has(v.id) || v.broken) continue;
    for (const [a, s] of Object.entries(v.profile?.areas ?? {})) if (s >= 0.5 && a in counts) counts[a]++;
  }
  return counts;
}

// ---------------------------------------------------------------- your body over time

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Areas a session worked: the ones you targeted plus any you rated. */
const sessionAreas = (h) => [...new Set([...(h.areas ?? []).map((a) => a.id), ...Object.keys(h.ratings ?? {})])];

/**
 * Per muscle area: how often and how recently you've worked it, and how much it helped.
 * @returns {Record<string, {sessions:number, last:string|null, daysAgo:number|null, helped:number|null}>}
 */
export function areaHeat(history, { days = 28, today = localDate() } = {}) {
  const out = {};
  for (const h of history) {
    const age = daysBetween(h.date, today);
    // Working a specific area (lower abs) also counts for the general one it belongs to (core).
    const ids = new Set(sessionAreas(h));
    for (const a of [...ids]) { const p = parentOf(a); if (p) ids.add(p); }
    for (const a of ids) {
      const e = (out[a] ??= { sessions: 0, last: null, daysAgo: null, helped: null, _sum: 0, _n: 0 });
      if (age <= days) e.sessions++;
      if (!e.last || h.date > e.last) e.last = h.date;
      // a rating given to the area itself, or else the one its specific part was given
      const rated = h.ratings?.[a] ?? [...ids].map((c) => (parentOf(c) === a ? h.ratings?.[c] : null)).find(Boolean);
      const v = RATING_VALUE[rated];
      if (v != null) { e._sum += v; e._n++; }
    }
  }
  for (const e of Object.values(out)) {
    e.daysAgo = e.last ? daysBetween(e.last, today) : null;
    e.helped = e._n ? e._sum / e._n : null;
    delete e._sum; delete e._n;
  }
  return out;
}

/**
 * Your standing spots ordered by how long it's been since you worked them (never = most neglected).
 * With no standing spots set, falls back to the areas you target most often.
 * @param {{id:string, mode:string}[]} focus
 */
export function neglectedAreas(focus, history, { today = localDate(), n = 3 } = {}) {
  const heat = areaHeat(history, { today });
  let spots = focus;
  if (!spots?.length) {
    spots = Object.entries(heat).filter(([a]) => a !== 'full_body').sort((a, b) => b[1].sessions - a[1].sessions).slice(0, 6).map(([id]) => ({ id, mode: 'tight' }));
  }
  return spots
    .map((s) => ({ ...s, daysAgo: heat[s.id]?.daysAgo ?? null }))
    .sort((a, b) => (b.daysAgo ?? 1e6) - (a.daysAgo ?? 1e6) || (a.mode === 'weak' ? -1 : 1))
    .slice(0, n);
}

// ---------------------------------------------------------------- combos: several videos, one session

const STYLE_ORDER = { mobility: 0, flow: 0, strength: 0, stretch: 1, yin: 2, restorative: 2 };
const styleRank = (v) => {
  const st = Object.entries(v.profile?.styles ?? {}).filter(([, s]) => s >= 0.3).map(([k]) => STYLE_ORDER[k]).filter((x) => x != null);
  return st.length ? Math.max(...st) : 1;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Find short sequences of videos that together cover ALL the requested muscles within the time range,
 * when no single video does. A small beam search over the best-ranked candidates.
 *
 * @param {object[]} candidates  ranked entries (from rankCandidates; ideally with a loose minimum length)
 * @param {{areas:{id:string,mode:string}[], minMin?:number|null, maxMin?:number|null}} filters
 * @returns {{combos: {parts:object[], totalMin:number, cover:number[], coverage:number, gain:number, value:number}[], bestSingle: {entry:object, coverage:number}|null}}
 *   gain = how much more of your muscles the combo covers than the best single video in the time range
 */
export function composeCombos(candidates, filters, { minTotal, maxTotal, maxParts = 4, n = 3, pool = 24, beam = 60 } = {}) {
  const areas = filters.areas ?? [];
  const none = { combos: [], bestSingle: null };
  if (areas.length < 2) return none;
  const lo = minTotal ?? filters.minMin ?? 10, hi = maxTotal ?? filters.maxMin ?? 45;
  const cands = candidates
    .filter((c) => c.video.durationSec != null && c.video.durationSec / 60 <= hi)
    .slice(0, pool)
    .map((c) => ({ entry: c, mins: c.video.durationSec / 60, cov: areas.map((a) => (c.video.profile?.areas?.[a.id] ?? 0) * modeFit(c.video, a.id, a.mode)) }));
  if (cands.length < 2) return none;

  const coverOf = (best) => avg(best);
  let bestSingle = null;
  for (const c of cands) {
    if (c.mins < lo) continue;
    const cov = coverOf(c.cov);
    if (!bestSingle || cov > bestSingle.coverage) bestSingle = { entry: c.entry, coverage: cov };
  }
  const baseline = bestSingle?.coverage ?? Math.max(...cands.map((c) => coverOf(c.cov)));

  const finals = [];
  let frontier = [{ idx: [], total: 0, best: areas.map(() => 0) }];
  for (let depth = 1; depth <= maxParts; depth++) {
    const next = [];
    for (const st of frontier) {
      const start = st.idx.length ? st.idx[st.idx.length - 1] + 1 : 0;   // combinations, not permutations
      for (let i = start; i < cands.length; i++) {
        const total = st.total + cands[i].mins;
        if (total > hi) continue;
        const best = st.best.map((b, k) => Math.max(b, cands[i].cov[k]));
        const ns = { idx: [...st.idx, i], total, best };
        next.push(ns);
        if (ns.idx.length >= 2 && total >= lo) finals.push(ns);
      }
    }
    frontier = next
      .map((s) => ({ s, h: coverOf(s.best) + 0.15 * avg(s.idx.map((i) => cands[i].entry.score)) }))
      .sort((a, b) => b.h - a.h).slice(0, beam).map((x) => x.s);
    if (!frontier.length) break;
  }

  const scored = finals.map((st) => {
    const parts = st.idx.map((i) => cands[i]);
    const coverage = coverOf(st.best);
    const channels = new Set(parts.map((p) => channelKey(p.entry.video) || p.entry.video.id));
    const variety = parts.length > 1 ? (channels.size - 1) / (parts.length - 1) : 0;
    const value = 0.62 * coverage + 0.28 * avg(parts.map((p) => p.entry.score)) + 0.05 * variety + 0.08 * (st.total / hi) - 0.03 * (parts.length - 1);
    return { st, parts, coverage, value };
  }).sort((a, b) => b.value - a.value);

  const chosen = [];
  for (const c of scored) {
    const ids = new Set(c.parts.map((p) => p.entry.video.id));
    const dup = chosen.some((o) => { const inter = o.ids.filter((x) => ids.has(x)).length; return inter / Math.max(o.ids.length, ids.size) > 0.6; });
    if (dup) continue;
    chosen.push({ ids: [...ids], c });
    if (chosen.length >= n) break;
  }
  const combos = chosen.map(({ c }) => ({
    // a gentle arc: mobility / flow first, long holds and winding down last
    parts: [...c.parts].sort((a, b) => styleRank(a.entry.video) - styleRank(b.entry.video)).map((p) => p.entry),
    totalMin: Math.round(c.st.total),
    cover: c.st.best,
    coverage: c.coverage,
    gain: c.coverage - baseline,
    value: c.value,
  }));
  return { combos, bestSingle };
}
