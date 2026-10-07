// Reads what a video is *about*: which muscles it works, in what style, how
// well viewers say it worked. Pure functions (no DOM, no network) so they can
// be unit-tested and tuned.
//
// Evidence per muscle area comes from independent sources which are combined
// with a "noisy-OR": each source says "I'm X% sure this video works area A",
// and several agreeing sources make the final number higher than any one.

import { classifyStyle, withFix, stylesWithFix } from './style.js';
import { buildTimeline } from './timeline.js';
import { guessVoice } from './teacher.js';
import {
  AREA_TERMS, POSE_TERMS, DIFFICULTY_TERMS, BENEFIT_TERMS,
  POSE_BY_ID, AREA_BY_ID, NEG_RE, POS_RE, PACE_RE, BENEFITS, normalize, scan,
  rootOf, SPECIFIC_TO_GENERIC, GENERIC_TO_SPECIFIC,
} from './lexicon.js';

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const sat = (x, k) => 1 - Math.exp(-k * x); // saturating 0..1

// Bump this whenever the analysis changes in a way that alters profiles (lexicon,
// weights, parsing). On load the app re-runs the analysis over everything it has
// stored, so improvements apply retroactively without re-fetching anything.
export const ANALYSIS_VERSION = 6;

// How much we trust each kind of evidence.
export const SOURCE_WEIGHT = { title: 0.85, desc: 0.6, tags: 0.4, chapters: 0.65, poses: 0.6, comments: 0.7, transcript: 0.75, mine: 0.8 };

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

// ---------------------------------------------------------------- transcripts

export const TRANSCRIPT_MAX_CHARS = 40000;

/** Turn pasted transcript text into [{t:seconds|null, text}] lines. Copes with YouTube's "0:12" / "1:02:03" stamps, SRT and plain prose. */
export function parseTranscript(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').replace(/<[^>]+>/g, ' ').slice(0, TRANSCRIPT_MAX_CHARS * 2);
  const lines = [];
  let pendingT = null;
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || /^\d+$/.test(l) || /^WEBVTT/i.test(l)) continue;
    const srt = l.match(/^(\d{1,2}):(\d{2}):(\d{2})[,.]\d{1,3}\s*-->/);
    if (srt) { pendingT = +srt[1] * 3600 + +srt[2] * 60 + +srt[3]; continue; }
    const vtt = l.match(/^(\d{1,2}):(\d{2})[.]\d{1,3}\s*-->/);
    if (vtt) { pendingT = +vtt[1] * 60 + +vtt[2]; continue; }
    const stamped = l.match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-–—:]?\s*(.*)$/);   // "0:12 text" or "0:12" alone, text on the next line
    if (stamped) {
      const t = parseTimestamp(stamped[1]);
      if (stamped[2]) { lines.push({ t, text: stamped[2] }); pendingT = null; } else pendingT = t;
      continue;
    }
    lines.push({ t: pendingT, text: l.replace(/\s+/g, ' ') });
    pendingT = null;
  }
  return lines.filter((x) => x.text.replace(/\[[^\]]*\]|♪/g, '').trim());
}

/** The transcript as stored: plain text, one line per caption, capped. */
export function cleanTranscript(raw) {
  const lines = parseTranscript(raw);
  let out = '', n = 0;
  for (const { t, text } of lines) {
    const row = `${t == null ? '' : `@${t} `}${text.replace(/\s+/g, ' ').trim()}\n`;
    if (out.length + row.length > TRANSCRIPT_MAX_CHARS) break;
    out += row; n++;
  }
  return { text: out.trimEnd(), lines: n };
}
const storedLines = (stored) => String(stored ?? '').split('\n').map((l) => {
  const m = l.match(/^@(\d+)\s(.*)$/);
  return m ? { t: +m[1], text: m[2] } : { t: null, text: l };
}).filter((x) => x.text);

// An instructor describing what a move does is the best evidence there is. These phrases mark such sentences.
const CUE_RE = /\b(?:you(?:'ll| will| should| might| may)? (?:feel|notice)|feel(?:ing)? (?:this|it|that|a|the|your)|stretch(?:ing|es)?|opening|release|releasing|loosen(?:ing)?|lengthen(?:ing)?|strengthen(?:ing)?|engag(?:e|ing)|activat(?:e|ing)|squeez(?:e|ing)|working|targets?|targeting|tightness|tension)\b/;

/** Evidence per area, how many words were read, and when each exercise first comes up. */
function transcriptEvidence(stored) {
  const lines = storedLines(stored);
  if (!lines.length) return null;
  const sums = {}, poseCounts = {}, firstAt = {};
  let words = 0;
  for (const { t, text } of lines) {
    words += text.split(/\s+/).length;
    const cue = CUE_RE.test(normalize(text)) ? 2.5 : 1;
    const matches = scan(AREA_TERMS, text);
    for (const [a, v] of Object.entries(sumByArea(matches))) sums[a] = (sums[a] ?? 0) + v * cue;
    for (const { entry } of scan(POSE_TERMS, text)) {
      poseCounts[entry.id] = (poseCounts[entry.id] ?? 0) + 1;
      if (t != null && firstAt[entry.id] == null) firstAt[entry.id] = t;
    }
  }
  const areas = Object.fromEntries(Object.entries(sums).map(([a, s]) => [a, sat(s, 0.16)]));
  const timeline = Object.entries(firstAt).map(([id, t]) => ({ id, t })).sort((x, y) => x.t - y.t).slice(0, 30);
  return { areas, poseCounts, timeline, words, lines: lines.length };
}

/**
 * What the person wrote about a video themselves: their note, their tags, and what they wrote after doing it.
 * Their own words about what it did for them are strong evidence. A sentence that says it did NOT help
 * ("didn't do anything for my hamstrings") is skipped, so it never raises that area.
 * @param {{note?:string, tags?:string[], sessions?:string[]}} mine
 */
export function mineEvidence(mine) {
  const sums = {}, poseCounts = {};
  const read = (text, factor) => {
    for (const sentence of String(text ?? '').split(/[.!?;\n]+/)) {
      const s = sentence.trim();
      if (s.length < 2) continue;
      const n = normalize(s);
      if (NEG_RE.test(n)) continue;
      const cue = CUE_RE.test(n) ? 1.5 : 1;
      for (const [a, v] of Object.entries(sumByArea(scan(AREA_TERMS, s)))) sums[a] = (sums[a] ?? 0) + v * cue * factor;
      for (const { entry } of scan(POSE_TERMS, s)) poseCounts[entry.id] = (poseCounts[entry.id] ?? 0) + 1;
    }
  };
  read(mine?.note, 1);
  for (const t of mine?.tags ?? []) read(t, 1.3);          // a tag is a deliberate label
  for (const t of mine?.sessions ?? []) read(t, 0.8);      // written right after doing it
  if (!Object.keys(sums).length && !Object.keys(poseCounts).length) return null;
  return { areas: Object.fromEntries(Object.entries(sums).map(([a, v]) => [a, sat(v, 0.9)])), poseCounts };
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
  // (A specific area and its general one are one thing here, so "lower abs" + "core" count once.)
  const strong = new Set(Object.entries(areas).filter(([a, v]) => a !== 'full_body' && v >= 0.45).map(([a]) => rootOf(a))).size;
  if (strong > 3) {
    const scale = Math.max(0.7, 1 - 0.06 * (strong - 3));
    for (const a of Object.keys(areas)) if (a !== 'full_body') areas[a] *= scale;
  }
  // "Full body" videos do touch everything, just not specifically.
  const fb = areas.full_body ?? 0;
  if (fb >= 0.5) for (const a of Object.keys(AREA_BY_ID)) if (a !== 'full_body') areas[a] = Math.max(areas[a] ?? 0, 0.35 * fb);
  // Specific <-> general. Working "lower abs" works "core" almost as much; a video that only says "core" is a
  // weak (never strong) match for each specific part. The general score is taken before it is raised by its
  // children, so one specific part never lends strength to its siblings.
  const generic = {};
  for (const a of Object.keys(areas)) if (!AREA_BY_ID[a]?.parent) generic[a] = areas[a];
  for (const [a, v] of Object.entries({ ...areas })) {
    const parent = AREA_BY_ID[a]?.parent;
    if (parent) areas[parent] = Math.max(areas[parent] ?? 0, SPECIFIC_TO_GENERIC * v);
  }
  for (const def of Object.values(AREA_BY_ID)) {
    if (def.parent && generic[def.parent]) areas[def.id] = Math.max(areas[def.id] ?? 0, GENERIC_TO_SPECIFIC * generic[def.parent]);
  }
  return Object.fromEntries(Object.entries(areas).map(([a, v]) => [a, Math.round(v * 1000) / 1000]));
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
  // What the teacher says out loud (if a transcript was added): the best evidence of what each move is for.
  const spoken = video.transcript ? transcriptEvidence(video.transcript) : null;
  if (spoken) for (const [id, n] of Object.entries(spoken.poseCounts)) poseCounts[id] = (poseCounts[id] ?? 0) + n;
  // What the person wrote themselves (note, tags, what they said after doing it).
  const mine = video.mine ? mineEvidence(video.mine) : null;
  if (mine) for (const [id, n] of Object.entries(mine.poseCounts)) poseCounts[id] = (poseCounts[id] ?? 0) + n;

  const sources = {
    title: noisyOrByArea(scan(AREA_TERMS, title)),
    desc: Object.fromEntries(Object.entries(sumByArea(scan(AREA_TERMS, description))).map(([a, s]) => [a, sat(s, 0.55)])),
    tags: Object.fromEntries(Object.entries(sumByArea(scan(AREA_TERMS, tags))).map(([a, s]) => [a, sat(s, 0.45)])),
    chapters: Object.fromEntries(Object.entries(sumByArea(scan(AREA_TERMS, chapterText))).map(([a, s]) => [a, sat(s, 0.8)])),
    poses: poseEvidence(poseCounts),
    ...(spoken ? { transcript: spoken.areas } : {}),
    ...(mine ? { mine: mine.areas } : {}),
  };
  const poses = Object.entries(poseCounts).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  const level = detectLevel(title, description);
  // What kind of routine this is, and how it feels to do (see style.js). Read from the words around the video, never the footage.
  const found = classifyStyle({
    title, channel: video.channel, tags: video.tags, description, chapters, poses, transcript: video.transcript, comments: video.comments, durationSec: video.durationSec, level,
  });
  // a correction the person made ("this is really Pilates") travels on the video record, so every re-analysis keeps it
  const styles = video.styleFix ? stylesWithFix(found.styles, video.styleFix) : found.styles;
  const kind = video.styleFix ? withFix(found.kind, video.styleFix) : found.kind;
  const traits = found.traits;
  const timeline = buildTimeline({ chapters, transcriptTimeline: spoken?.timeline, comments: video.comments, durationSec: video.durationSec });
  // who teaches, when the words say so outright or viewers agree (see teacher.js); a channel you marked is looked up separately
  const voice = guessVoice({ channel: video.channel, description, comments: video.comments });
  return {
    sources,
    areas: combineSources(sources),
    poses,
    chapters: chapters.slice(0, 40),
    styles, kind, traits,
    ...(voice ? { voice } : {}),
    level,
    ...(timeline && timeline.source !== 'chapters' ? { timeline } : {}),   // a chapter list is already stored as `chapters`
    ...(spoken ? { transcript: { words: spoken.words, lines: spoken.lines, timeline: spoken.timeline } } : {}),
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

  // Copy-pasted comments are common; quote each distinct text once.
  const distinct = new Set();
  ev.quotes = quotes.sort((a, b) => b.score - a.score)
    .filter((q) => { const k = normalize(q.text); if (distinct.has(k)) return false; distinct.add(k); return true; })
    .slice(0, 4).map(({ text, areas, likes }) => ({ text, areas, likes }));
  ev.sentiment = ev.n ? (ev.positive - ev.negative) / (ev.positive + ev.negative + 8) : 0;
  return ev;
}

/** How many comments we keep per video (and analyse): enough signal, bounded storage. */
export const COMMENT_SAMPLE = 50;

/** Trim fetched comments to the bounded sample we store. Evidence is computed from exactly this, so a later re-index reproduces it. */
export function compactComments(comments) {
  return (comments ?? []).slice(0, COMMENT_SAMPLE).map((c) => {
    const text = decodeEntities(typeof c === 'string' ? c : c?.text).replace(/\s+/g, ' ').trim().slice(0, 240);
    return { t: text, l: typeof c === 'object' ? c.likes ?? c.l ?? 0 : 0 };
  }).filter((c) => c.t.length >= 4);
}

/** Add (or replace) a pasted transcript and re-derive the profile from everything stored. An empty text removes it. */
export function attachTranscript(video, raw) {
  const { text, lines } = cleanTranscript(raw);
  const next = { ...video };
  if (lines) next.transcript = text; else delete next.transcript;
  return reanalyze(next);
}

/** Store comments on a video and (re)derive its evidence + profile. */
export function attachComments(video, comments) {
  const sample = compactComments(comments);
  const evidence = analyzeComments(sample.map((c) => ({ text: c.t, likes: c.l })));
  const base = analyzeVideoText({ ...video, comments: sample });   // comments also say what kind of routine it is
  return { ...video, comments: sample, evidence, profile: applyComments(base, evidence) };
}

/** Re-run the whole analysis from the raw material we keep (text + comment sample). */
export function reanalyze(video) {
  const profile = analyzeVideoText(video);
  if (!video.comments?.length) return { ...video, profile: video.evidence ? applyComments(profile, video.evidence) : profile };
  const evidence = analyzeComments(video.comments.map((c) => ({ text: c.t, likes: c.l })));
  return { ...video, evidence, profile: applyComments(profile, evidence) };
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
  // Explain the areas this video actually works first: with five areas picked, a video that only fits the fifth
  // used to get no explanation at all.
  const byFit = [...areaIds].sort((x, y) => (p.areas?.[y] ?? 0) - (p.areas?.[x] ?? 0));
  for (const a of byFit.slice(0, 4)) {
    const label = AREA_BY_ID[a]?.label ?? a;
    const src = p.sources ?? {};
    const bits = [];
    if ((src.title?.[a] ?? 0) >= 0.5) bits.push('in the title');
    if ((src.chapters?.[a] ?? 0) >= 0.4) bits.push('in the chapter list');
    if ((src.mine?.[a] ?? 0) >= 0.4) bits.push('in your own notes');
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
