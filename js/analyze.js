// Reads what a video is *about*: which muscles it works, in what style, how
// well viewers say it worked. Pure functions (no DOM, no network) so they can
// be unit-tested and tuned.
//
// Evidence per muscle area comes from independent sources which are combined
// with a "noisy-OR": each source says "I'm X% sure this video works area A",
// and several agreeing sources make the final number higher than any one.

import {
  AREA_TERMS, POSE_TERMS, STYLE_TERMS, DIFFICULTY_TERMS, BENEFIT_TERMS,
  POSE_BY_ID, AREA_BY_ID, NEG_RE, POS_RE, PACE_RE, BENEFITS, normalize, scan,
} from './lexicon.js';

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const sat = (x, k) => 1 - Math.exp(-k * x); // saturating 0..1

// How much we trust each kind of evidence.
export const SOURCE_WEIGHT = { title: 0.85, desc: 0.6, tags: 0.4, chapters: 0.65, poses: 0.6, comments: 0.7 };

// ---------------------------------------------------------------- small parsers

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** ISO-8601 duration ("PT1H2M3S") -> seconds. "P0D" (live streams) -> 0. */
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [, d = 0, h = 0, mi = 0, s = 0] = m;
  return (+d) * 86400 + (+h) * 3600 + (+mi) * 60 + (+s);
}

/** "1:02:03" / "12:30" -> seconds. */
export function parseTimestamp(ts) {
  const parts = String(ts).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatDuration(sec) {
  if (sec == null) return '?';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Video chapters from a description ("0:00 Intro", "2:10 Pigeon pose", ...). */
export function parseChapters(description) {
  const out = [];
  for (const line of String(description ?? '').split(/\r?\n/)) {
    const m = line.match(/(?:^|[\s(\[])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s)\]])/);
    if (!m) continue;
    const t = parseTimestamp(m[1]);
    const label = line.replace(m[1], ' ').replace(/^[\s\-–—:•·|>)\](\[]+|[\s\-–—:•·|(\[]+$/g, '').replace(/\s+/g, ' ').trim();
    if (t != null && label) out.push({ t, label: label.slice(0, 80) });
  }
  // Real chapter lists run forward in time; anything else is probably a stray time.
  const ascending = out.filter((c, i) => i === 0 || c.t > out[i - 1].t);
  return ascending.length >= 3 ? ascending.slice(0, 60) : [];
}

// ---------------------------------------------------------------- video text -> profile

function sumByArea(matches, { skipWeak = false } = {}) {
  const sums = {};
  for (const { entry } of matches) {
    if (skipWeak && entry.weak) continue;
    const f = entry.weak ? 0.5 : 1;
    for (const [a, w] of Object.entries(entry.map)) sums[a] = (sums[a] ?? 0) + w * f;
  }
  return sums;
}

function noisyOrByArea(matches) {
  const miss = {};
  for (const { entry } of matches) {
    const f = entry.weak ? 0.5 : 1;
    for (const [a, w] of Object.entries(entry.map)) miss[a] = (miss[a] ?? 1) * (1 - clamp(w * f));
  }
  return Object.fromEntries(Object.entries(miss).map(([a, m]) => [a, 1 - m]));
}

function countPoses(matches, into = {}) {
  for (const { entry } of matches) into[entry.id] = (into[entry.id] ?? 0) + 1;
  return into;
}

/** Evidence from named poses: sum of (how much the pose works the area). */
function poseEvidence(poseCounts, factor = 1) {
  const sums = {};
  for (const [id, count] of Object.entries(poseCounts)) {
    const p = POSE_BY_ID[id];
    if (!p) continue;
    for (const [a, w] of Object.entries(p.areas)) sums[a] = (sums[a] ?? 0) + w * Math.sqrt(Math.min(3, count)) * factor;
  }
  return Object.fromEntries(Object.entries(sums).map(([a, s]) => [a, sat(s, 0.6)]));
}

/** Combine per-source scores into one score per area. */
export function combineSources(sources) {
  const areas = {};
  const ids = new Set(Object.values(sources).flatMap((s) => Object.keys(s ?? {})));
  for (const a of ids) {
    let miss = 1;
    for (const [src, scores] of Object.entries(sources)) {
      const s = scores?.[a];
      if (s) miss *= 1 - (SOURCE_WEIGHT[src] ?? 0.5) * clamp(s);
    }
    areas[a] = 1 - miss;
  }
  // A video that claims to cover everything is a generalist: dampen it a bit so
  // a focused video wins when you ask for something specific.
  const strong = Object.entries(areas).filter(([a, v]) => a !== 'full_body' && v >= 0.45).length;
  if (strong > 3) {
    const scale = Math.max(0.7, 1 - 0.06 * (strong - 3));
    for (const a of Object.keys(areas)) if (a !== 'full_body') areas[a] *= scale;
  }
  // "Full body" videos do touch everything, just not specifically.
  const fb = areas.full_body ?? 0;
  if (fb >= 0.5) for (const a of Object.keys(AREA_BY_ID)) if (a !== 'full_body') areas[a] = Math.max(areas[a] ?? 0, 0.35 * fb);
  return Object.fromEntries(Object.entries(areas).map(([a, v]) => [a, Math.round(v * 1000) / 1000]));
}

function detectStyles(title, desc, poseCounts) {
  const score = {};
  for (const { entry } of scan(STYLE_TERMS, title)) score[entry.id] = (score[entry.id] ?? 0) + 2;
  for (const { entry } of scan(STYLE_TERMS, desc.slice(0, 1200))) score[entry.id] = Math.min(4, (score[entry.id] ?? 0) + 0.5);
  // Many strength-type exercises named => it's genuinely a strength session.
  const strengthMoves = Object.entries(poseCounts).filter(([id]) => POSE_BY_ID[id]?.mode === 'strength').length;
  if (strengthMoves >= 3) score.strength = (score.strength ?? 0) + 1.5;
  return Object.fromEntries(Object.entries(score).map(([k, v]) => [k, Math.round(sat(v, 0.5) * 100) / 100]));
}

function detectLevel(title, desc) {
  const pick = (matches) => {
    const c = {};
    for (const { entry } of matches) c[entry.level] = (c[entry.level] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return pick(scan(DIFFICULTY_TERMS, title)) ?? pick(scan(DIFFICULTY_TERMS, desc.slice(0, 800)));
}

/**
 * Build a profile from a video's own text.
 * @param {{title?:string, description?:string, tags?:string[]}} video
 */
export function analyzeVideoText(video) {
  const title = decodeEntities(video.title);
  const description = decodeEntities(video.description).slice(0, 3000);
  const tags = (video.tags ?? []).join(' , ');
  const chapters = parseChapters(video.description);
  const chapterText = chapters.map((c) => c.label).join(' . ');

  const poseCounts = {};
  // The description already contains the chapter lines, so don't scan them twice.
  countPoses(scan(POSE_TERMS, `${title} . ${description}`), poseCounts);

  const sources = {
    title: noisyOrByArea(scan(AREA_TERMS, title)),
    desc: Object.fromEntries(Object.entries(sumByArea(scan(AREA_TERMS, description))).map(([a, s]) => [a, sat(s, 0.55)])),
    tags: Object.fromEntries(Object.entries(sumByArea(scan(AREA_TERMS, tags))).map(([a, s]) => [a, sat(s, 0.45)])),
    chapters: Object.fromEntries(Object.entries(sumByArea(scan(AREA_TERMS, chapterText))).map(([a, s]) => [a, sat(s, 0.8)])),
    poses: poseEvidence(poseCounts),
  };
  return {
    sources,
    areas: combineSources(sources),
    poses: Object.entries(poseCounts).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    chapters: chapters.slice(0, 40),
    styles: detectStyles(title, description, poseCounts),
    level: detectLevel(title, description),
  };
}

// ---------------------------------------------------------------- comments -> evidence

export function sentenceSentiment(sentence) {
  const n = normalize(sentence);
  if (NEG_RE.test(n)) return -1;
  if (POS_RE.test(n)) return 1;
  return 0;
}

/**
 * Read viewer comments for what they say about muscles and effects.
 * @param {Array<string|{text:string, likes?:number}>} comments
 */
export function analyzeComments(comments) {
  const ev = {
    n: 0, positive: 0, negative: 0, mentions: {}, benefits: {}, quotes: [], posesMentioned: {},
    pace: { tooFast: 0, tooHard: 0, tooEasy: 0, beginnerFriendly: 0 }, analyzedAt: Date.now(),
  };
  const quotes = [];

  for (const raw of comments ?? []) {
    const text = decodeEntities(typeof raw === 'string' ? raw : raw?.text).trim();
    if (text.length < 4) continue;
    const likes = typeof raw === 'object' ? raw.likes ?? 0 : 0;
    ev.n++;

    const sentences = text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
    const sentiments = sentences.map(sentenceSentiment);
    const overall = sentiments.includes(-1) ? -1 : sentiments.includes(1) ? 1 : 0;
    if (overall > 0) ev.positive++;
    if (overall < 0) ev.negative++;

    const n = normalize(text);
    for (const [k, re] of Object.entries(PACE_RE)) if (re.test(n)) ev.pace[k]++;

    // Per-area reading: what did this commenter say about each muscle?
    const hit = {}; // area -> {pos, neg}
    sentences.forEach((s, i) => {
      for (const { entry } of scan(AREA_TERMS, s)) {
        if (entry.weak) continue;
        for (const [a, w] of Object.entries(entry.map)) {
          if (w < 0.5) continue;
          const h = (hit[a] ??= { pos: 0, neg: 0 });
          // Sentiment in the same sentence counts fully; elsewhere in the comment, half.
          const own = sentiments[i];
          const v = own !== 0 ? own : overall * 0.5;
          if (v > 0) h.pos = Math.max(h.pos, Math.abs(v));
          if (v < 0) h.neg = Math.max(h.neg, Math.abs(v));
        }
      }
    });
    for (const [a, h] of Object.entries(hit)) {
      const m = (ev.mentions[a] ??= { n: 0, pos: 0, neg: 0 });
      m.n++; m.pos += h.pos; m.neg += h.neg;
    }
    if (overall > 0 && Object.keys(hit).length) {
      quotes.push({
        text: text.length > 240 ? `${text.slice(0, 237)}…` : text,
        areas: Object.keys(hit),
        likes,
        score: Math.log2(1 + likes) + (text.length >= 40 && text.length <= 240 ? 1 : 0) + Math.min(2, Object.keys(hit).length) * 0.5,
      });
    }

    // What did people say it did for them?
    if (overall > 0) {
      const seen = new Set();
      for (const { entry } of scan(BENEFIT_TERMS, text)) {
        if (!seen.has(entry.id)) { seen.add(entry.id); ev.benefits[entry.id] = (ev.benefits[entry.id] ?? 0) + 1; }
      }
    }

    // Exercises viewers name (e.g. "pigeon pose is where it clicked for me").
    const seenPoses = new Set(scan(POSE_TERMS, text).map((m) => m.entry.id));
    for (const id of seenPoses) ev.posesMentioned[id] = (ev.posesMentioned[id] ?? 0) + 1;
  }

  ev.quotes = quotes.sort((a, b) => b.score - a.score).slice(0, 4).map(({ text, areas, likes }) => ({ text, areas, likes }));
  ev.sentiment = ev.n ? (ev.positive - ev.negative) / (ev.positive + ev.negative + 8) : 0;
  return ev;
}

/** Evidence from comments as a 0..1 score per area. */
export function commentSupport(ev) {
  const out = {};
  if (!ev || ev.n < 3) return out;
  for (const [a, m] of Object.entries(ev.mentions)) {
    const neutral = Math.max(0, m.n - m.pos - m.neg);
    const support = sat(m.pos + 0.25 * neutral, 1 / 3) * (1 - m.neg / (m.n + 1));
    // Pose names that commenters bring up also count (weaker).
    out[a] = Math.round(clamp(support) * 1000) / 1000;
  }
  // Exercises mentioned in comments work their areas too (a small nudge).
  const nudge = poseEvidence(Object.fromEntries(Object.entries(ev.posesMentioned).filter(([, c]) => c >= 2)), 0.5);
  for (const [a, s] of Object.entries(nudge)) out[a] = Math.max(out[a] ?? 0, Math.round(s * 0.6 * 1000) / 1000);
  return out;
}

/** Fold comment evidence into a text-only profile. */
export function applyComments(profile, evidence) {
  const sources = { ...profile.sources, comments: commentSupport(evidence) };
  return { ...profile, sources, areas: combineSources(sources) };
}

// ---------------------------------------------------------------- quality

export function likeRatioScore(video) {
  const views = video.views ?? 0;
  if (video.likes == null || views < 200) return 0.5;
  return clamp((video.likes / views - 0.008) / (0.04 - 0.008));
}

export function qualityScore(video, { teacherTrust = 0.5, evidence = video.evidence } = {}) {
  const pop = clamp((Math.log10((video.views ?? 0) + 1) - 3) / 3);
  const hasSent = evidence && evidence.n >= 5;
  const sent = hasSent ? clamp(0.5 + 0.5 * evidence.sentiment) : 0.5;
  return 0.4 * likeRatioScore(video) + 0.25 * pop + 0.15 * sent + 0.2 * teacherTrust;
}

/** Well-liked but not huge: the videos you'd never find from a "top results" list. */
export function isHiddenGem(video, subscribers = video.subscribers) {
  const views = video.views ?? 0;
  return likeRatioScore(video) >= 0.65 && views >= 1500 && (views < 150000 || (subscribers != null && subscribers < 60000));
}

// ---------------------------------------------------------------- explaining

/** Plain-language reasons this video fits the requested areas. */
export function explainMatch(video, areaIds) {
  const p = video.profile;
  if (!p) return [];
  const reasons = [];
  for (const a of areaIds.slice(0, 4)) {
    const label = AREA_BY_ID[a]?.label ?? a;
    const src = p.sources ?? {};
    const bits = [];
    if ((src.title?.[a] ?? 0) >= 0.5) bits.push('in the title');
    if ((src.chapters?.[a] ?? 0) >= 0.4) bits.push('in the chapter list');
    const moves = (p.poses ?? [])
      .map(({ id, count }) => ({ id, w: (POSE_BY_ID[id]?.areas[a] ?? 0) * count }))
      .filter((x) => x.w >= 0.5).sort((x, y) => y.w - x.w).slice(0, 3).map((x) => POSE_BY_ID[x.id].label);
    if (moves.length) bits.push(`${moves.join(', ')}`);
    const m = video.evidence?.mentions?.[a];
    if (m && m.n >= 2) bits.push(`${Math.round(m.pos)} of ${m.n} comments about it are positive`);
    if (bits.length) reasons.push(`${label}: ${bits.join(' · ')}`);
  }
  const ben = Object.entries(video.evidence?.benefits ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, n]) => n >= 2);
  if (ben.length) {
    const label = (id) => BENEFITS.find((b) => b.id === id)?.label ?? id;
    reasons.push(`Viewers report: ${ben.map(([id, n]) => `${label(id)} (${n})`).join(', ')}`);
  }
  return reasons;
}
