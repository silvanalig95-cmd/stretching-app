// Turning what you type into filters, and filters into varied YouTube searches.
//
// The query generator is what makes "each search go new places": it remembers
// every query it has used (and the result page it reached), and prefers
// phrasings/teachers/sort orders it hasn't tried yet.

import { AREA_TERMS, STYLE_TERMS, POSE_TERMS, AREA_BY_ID, TEACHERS, normalize, scan } from './lexicon.js';
import { STOP_WORDS } from './index.js';

// ---------------------------------------------------------------- video URLs

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** Accepts a bare id or any common YouTube URL form; returns the id or null. */
export function parseVideoId(input) {
  const s = String(input ?? '').trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return ID_RE.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && ID_RE.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch { /* not a URL */ }
  return null;
}

export const youtubeSearchUrl = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
export const youtubeWatchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// ---------------------------------------------------------------- "give the command"

const WEAK_CUES = /\b(weak|weakness|weaker|strengthen|stronger|strength|activate|activation|unstable|stability)\b/;
const TIGHT_CUES = /\b(tight|tightness|stiff|stiffness|sore|tense|achy|aching|knotted|knots|stretch|release|loosen|relieve)\b/;
const HINT_WORDS = ['morning', 'evening', 'bedtime', 'beginner', 'beginners', 'advanced', 'desk', 'office', 'runner', 'runners', 'running', 'seniors', 'gentle', 'sciatica', 'posture'];

/**
 * Free text -> filters. "20-30 min, tight hips and weak glutes, yin" works.
 * Anything it can't place is ignored, and `understood` says whether it found something.
 */
export function parseCommand(text) {
  const raw = String(text ?? '').toLowerCase();
  const out = { areas: [], minMin: null, maxMin: null, styles: [], hints: [], terms: [], understood: false };

  // --- length
  const num = '(\\d{1,3})';
  const mins = '\\s*(?:min|mins|minutes?|m)\\b';
  let m;
  if ((m = raw.match(new RegExp(`${num}\\s*(?:-|–|to|and)\\s*${num}${mins}`)))) {
    out.minMin = Math.min(+m[1], +m[2]); out.maxMin = Math.max(+m[1], +m[2]);
  } else if ((m = raw.match(new RegExp(`(?:under|less than|below|at most|up to|no more than|within|max(?:imum)?(?: of)?)\\s*${num}${mins}`)))) {
    out.minMin = 3; out.maxMin = +m[1];
  } else if ((m = raw.match(new RegExp(`(?:over|more than|at least|longer than|min(?:imum)?(?: of)?)\\s*${num}${mins}`)))) {
    out.minMin = +m[1]; out.maxMin = Math.max(+m[1] + 30, 60);
  } else if ((m = raw.match(new RegExp(`(?:around|about|approx(?:imately)?|roughly|~)\\s*${num}${mins}`)))) {
    out.minMin = Math.max(3, +m[1] - 5); out.maxMin = +m[1] + 5;
  } else if ((m = raw.match(new RegExp(`${num}${mins}`)))) {
    const d = Math.max(3, Math.round(+m[1] * 0.2));
    out.minMin = Math.max(3, +m[1] - d); out.maxMin = +m[1] + d;
  } else if (/\b(half an hour|half hour)\b/.test(raw)) { out.minMin = 25; out.maxMin = 35; }
  else if (/\b(an hour|1 hour|one hour)\b/.test(raw)) { out.minMin = 45; out.maxMin = 75; }
  else if (/\b(quick|short|few minutes|brief)\b/.test(raw)) { out.minMin = 3; out.maxMin = 10; }
  else if (/\b(long|extended)\b/.test(raw)) { out.minMin = 30; out.maxMin = 60; }

  // --- areas, with "tight" vs "weak" carried along the sentence
  const seen = new Map();
  let mode = 'tight';
  for (const sentence of raw.split(/[.;\n]+/)) {
    mode = 'tight';
    for (const seg of sentence.split(/,|\band\b|\bbut\b|\bplus\b|\bwith\b|\bthen\b/)) {
      if (WEAK_CUES.test(seg)) mode = 'weak'; else if (TIGHT_CUES.test(seg)) mode = 'tight';
      for (const { entry } of scan(AREA_TERMS, seg)) {
        for (const [a, w] of Object.entries(entry.map)) if (w >= 0.5 && !seen.has(a)) seen.set(a, mode);
      }
    }
  }
  out.areas = [...seen].map(([id, mode]) => ({ id, mode }));

  // --- styles ('stretch' is deliberately not a filter: nearly everything is one)
  const styleMap = { yin: 'yin', restorative: 'restorative', flow: 'flow', strength: 'strength', mobility: 'mobility' };
  // "weak glutes" / "strengthen hips" describe the muscle, not a style request; only a literal "strength" does.
  const styleText = raw.replace(new RegExp(WEAK_CUES.source, 'g'), (w) => (w === 'strength' ? 'strength' : ' '));
  for (const { entry } of scan(STYLE_TERMS, styleText)) if (styleMap[entry.id] && !out.styles.includes(entry.id)) out.styles.push(entry.id);

  // --- extra words that make searches better
  const words = new Set(normalize(raw).split(' '));
  out.hints = HINT_WORDS.filter((w) => words.has(w));
  if (out.hints.some((h) => ['bedtime', 'evening'].includes(h)) && !out.styles.includes('restorative')) out.styles.push('restorative');

  // --- whatever is left over ("pigeon", a teacher's name, "sphinx") is searched for as free text
  let rest = ` ${normalize(raw)} `;
  for (const compiled of [AREA_TERMS, STYLE_TERMS]) {
    for (const m of scan(compiled, raw)) rest = rest.replace(new RegExp(`\\b${m.phrase}s?\\b`, 'g'), ' ');
  }
  const noise = new Set([...HINT_WORDS, 'half', 'hour', 'hours', 'quick', 'short', 'long', 'extended', 'brief', 'few', 'under', 'over', 'around', 'about', 'approximately', 'roughly', 'least', 'most', 'than', 'less', 'more', 'within', 'max', 'maximum', 'minimum', 'one', 'today', 'tonight']);
  const leftover = rest.split(' ').filter((w) => w.length > 2 && !noise.has(w) && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  out.terms = [...new Set(leftover)].slice(0, 6);

  const namedPose = scan(POSE_TERMS, raw).length > 0;
  out.understood = !!(out.areas.length || out.minMin != null || out.styles.length || out.hints.length || namedPose);
  return out;
}

// ---------------------------------------------------------------- search generation

const TYPICAL_MINUTES = [5, 8, 10, 15, 20, 25, 30, 40, 45, 60];
const MODIFIERS = ['for beginners', 'follow along', 'slow and gentle', 'deep stretch', 'after work', 'for desk workers', 'physical therapist', 'no equipment', 'morning', 'before bed', 'for runners', 'relief'];
const ORDERS = ['relevance', 'viewCount', 'rating'];

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const normKey = (q) => normalize(q);

function durationPhrase(minMin, maxMin, rng) {
  if (minMin == null && maxMin == null) return '';
  const lo = minMin ?? 3, hi = maxMin ?? 90;
  const inside = TYPICAL_MINUTES.filter((t) => t >= lo && t <= hi);
  const n = inside.length ? pick(inside, rng) : Math.round((lo + hi) / 2);
  return `${n} minute`;
}

function areaPhrase(areas, rng) {
  const parts = areas.map((a) => pick(AREA_BY_ID[a.id].say, rng));
  return parts.length <= 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function videoDurationParam(minMin, maxMin) {
  if (minMin != null && minMin >= 20) return 'long';
  if (maxMin != null && maxMin <= 20 && (minMin ?? 0) >= 4) return 'medium';
  return null;
}

/**
 * Generate `n` distinct searches that are as new as possible.
 * @param {{areas:{id:string,mode:string}[], minMin?:number, maxMin?:number, styles?:string[], hints?:string[]}} filters
 * @param {{queryLog:object, rng:()=>number, n?:number, teachers?:{name:string}[], knownTeachers?:Set<string>, adventure?:number}} ctx
 */
export function buildQueries(filters, ctx) {
  const { queryLog = {}, rng, n = 2, teachers = TEACHERS, knownTeachers = new Set(), adventure = 0.35 } = ctx;
  const terms = (filters.terms ?? []).join(' ');
  // With free-text terms and no muscles ("pigeon pose"), search for the terms alone rather than defaulting to full body.
  const areas = filters.areas?.length ? filters.areas : terms ? [] : [{ id: 'full_body', mode: 'tight' }];
  const styles = filters.styles ?? [];
  const hints = filters.hints ?? [];
  const unseen = teachers.filter((t) => !knownTeachers.has(normalize(t.name).replace(/ /g, '')));
  const candidates = new Map();

  for (let i = 0; i < 28; i++) {
    // 1-2 areas per search keeps queries natural; across searches we cover them all.
    const k = areas.length > 1 && rng() < 0.55 ? 2 : 1;
    const shuffled = [...areas].sort(() => rng() - 0.5).slice(0, Math.min(k, areas.length));
    const A0 = shuffled.length ? areaPhrase(shuffled, rng) : '';
    const A = [terms, A0].filter(Boolean).join(' ');
    const weak = shuffled.length > 0 && shuffled.every((a) => a.mode === 'weak');
    const dur = rng() < 0.8 ? durationPhrase(filters.minMin, filters.maxMin, rng) : '';
    const mod = hints.length && rng() < 0.7 ? pick(hints, rng) : pick(MODIFIERS, rng);

    const t = [];
    if (weak) t.push(`${dur} yoga strength for ${A}`, `${A} activation exercises ${dur}`, `strengthen ${A} follow along ${dur}`);
    else t.push(`${dur} yoga for ${A}`, `${dur} ${A} stretch`, `yoga for ${A} ${mod}`, `${A} stretching routine follow along ${dur}`, `best ${A} stretches ${dur}`);
    if (styles.includes('yin')) t.push(`yin yoga for ${A} ${dur}`);
    if (styles.includes('restorative')) t.push(`gentle ${A} yoga before bed ${dur}`);
    if (styles.includes('flow')) t.push(`${dur} yoga flow ${A}`);
    if (styles.includes('mobility')) t.push(`${A} mobility routine ${dur}`);
    if (styles.includes('strength') && !weak) t.push(`${dur} yoga strength ${A}`);
    // Teacher-flavoured searches: lean toward teachers you haven't tried as "adventure" grows.
    let teacher = null;
    if (teachers.length && rng() < 0.3) {
      const pool = rng() < 0.4 + adventure * 0.5 && unseen.length ? unseen : teachers;
      teacher = pick(pool, rng).name;
      t.push(`${teacher} ${A} ${dur}`);
    }
    const q = pick(t, rng).replace(/\s+/g, ' ').trim();
    const key = normKey(q);
    if (!candidates.has(key)) candidates.set(key, { q, key, teacher });
  }

  // Prefer least-used; a little noise so ties don't always resolve the same way.
  const scored = [...candidates.values()].map((c) => {
    const used = queryLog[c.key]?.count ?? 0;
    const teacherBonus = c.teacher && !knownTeachers.has(normalize(c.teacher).replace(/ /g, '')) ? 0.25 * adventure : 0;
    return { ...c, s: -used + rng() * 0.6 + teacherBonus };
  }).sort((a, b) => b.s - a.s);

  const chosen = [];
  const usedAreaPhrases = new Set();
  for (const c of scored) {
    if (chosen.length >= n) break;
    const sig = c.key.split(' ').slice(0, 4).join(' ');
    if (usedAreaPhrases.has(sig)) continue; // avoid near-duplicates within one run
    usedAreaPhrases.add(sig);
    chosen.push(c);
  }

  return chosen.map(({ q, key }) => {
    const prev = queryLog[key];
    // Seen this exact query before? Go deeper (next page) rather than re-reading page one.
    if (prev?.nextPageToken) return { q, key, order: prev.order ?? 'relevance', pageToken: prev.nextPageToken, videoDuration: videoDurationParam(filters.minMin, filters.maxMin) };
    const order = ORDERS[(prev?.count ?? 0) % ORDERS.length];
    return { q, key, order, pageToken: null, videoDuration: videoDurationParam(filters.minMin, filters.maxMin) };
  });
}
