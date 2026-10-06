// A local search index over everything the app has collected.
//
// Each video becomes a document with weighted fields (title, teacher, the poses
// and chapters it contains, what viewers said, your own tags and notes ...) and
// queries are ranked with BM25. On top of plain keywords it understands:
//
//   "exact phrase"        the words together          -word / -"phrase"   leave these out
//   channel:adriene       who made it                 tag:morning         your own tags
//   pose:pigeon           a named exercise inside it  area:glutes         a muscle it works
//   title:hips            words in the title          len:10-20           length (<15, >20, 15)
//
// and, without any syntax:
//   concepts   "lumbar" finds low-back videos even if they never say "lumbar" (it knows
//              the muscle behind the word, and the muscles the analysis found in each video)
//   typos      "pigion" still finds pigeon pose, and says so
//   forms      "calf" finds "calves", "stretching" finds "stretch"
//   as-you-type  prefixes and autocomplete

import { normalize, scan, AREA_TERMS, POSE_TERMS, POSE_BY_ID, BENEFITS, AREA_BY_ID, AREAS } from './lexicon.js';
import { STYLE_BY_ID } from './style.js';

export const FIELD_WEIGHTS = { title: 3, tags: 3, channel: 2, concepts: 2, chapters: 2, keywords: 1.5, description: 1, viewers: 1, note: 1 };
const K1 = 1.2, B = 0.75;
const CONCEPT_BONUS = 1.6;    // how much knowing the muscle/pose behind a word is worth, relative to a BM25 hit
const PHRASE_BONUS = 2.5;

// Words that carry no search value, or that every video here shares.
export const STOP_WORDS = new Set((
  'the a an and or for of to in on at by from my me with without is are be it its this that these those i you your we our as can do does how what when where why which who ' +
  'yoga stretch stretching stretches routine routines video videos minute minutes min mins hour follow along best good great some any more most very just also pose poses ' +
  'please want need like looking find show give get make tight weak stiff sore tense achy release relief help helps new old'
).split(' '));

const IRREGULAR = { calves: 'calf', feet: 'foot', teeth: 'tooth', hips: 'hip' };

/** Light stemmer: enough to match plurals and -ing/-ed without a dictionary. */
export function stem(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

const fold = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Text -> stemmed tokens (no stop-word removal: that's the query side's job). */
export function tokenize(text) {
  const n = normalize(fold(text));
  return n ? n.split(' ').filter((w) => w.length > 1).map(stem) : [];
}

/** Query text -> meaningful stemmed terms. Falls back to everything if the query is all stop words. */
export function queryTerms(text) {
  const all = tokenize(text);
  const kept = all.filter((t) => !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  return kept.length ? kept : all;
}

/** Edit distance (insert / delete / substitute / swap-adjacent), giving up beyond `max`. */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

// ---------------------------------------------------------------- the query language

export const SEARCH_FIELDS = {
  channel: 'channel', teacher: 'channel', by: 'channel',
  tag: 'tag', tags: 'tag',
  pose: 'pose', exercise: 'pose',
  area: 'area', muscle: 'area', for: 'area',
  title: 'title',
  len: 'len', length: 'len', min: 'len',
};

/**
 * Parse a search box string.
 * @returns {{terms:string[], rawTerms:string[], phrases:string[], exclude:{terms:string[], phrases:string[]}, filters:{field:string,value:string}[], len:{min:number|null,max:number|null,exMin:boolean,exMax:boolean}|null}}
 */
export function parseSearch(text) {
  const out = { terms: [], rawTerms: [], phrases: [], exclude: { terms: [], phrases: [] }, filters: [], len: null };
  const re = /(-?)(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const neg = m[1] === '-';
    let field = m[2] ? SEARCH_FIELDS[m[2].toLowerCase()] : null;
    let value = (m[3] ?? m[4] ?? '').trim();
    if (m[2] && !field) value = `${m[2]}:${value}`;           // "10:30" or "note:this" are just words
    if (!value) continue;
    if (field === 'len') {
      const r = value.match(/^(<|>)?\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/);
      if (r) {
        const a = +r[2], b = r[3] ? +r[3] : null;
        // "<15" / ">20" are strict ("under 15"); a range or a single number is inclusive (a single number means about that long)
        out.len = r[1] === '<' ? { min: null, max: a, exMin: false, exMax: true }
          : r[1] === '>' ? { min: a, max: null, exMin: true, exMax: false }
          : b != null ? { min: Math.min(a, b), max: Math.max(a, b), exMin: false, exMax: false }
          : { min: Math.max(0, a - 3), max: a + 3, exMin: false, exMax: false };
      }
      continue;
    }
    if (field && !neg) { out.filters.push({ field, value }); continue; }
    if (field && neg) { out.exclude.terms.push(...queryTerms(value)); continue; }
    const isPhrase = m[3] !== undefined && /\s/.test(value);
    const norm = normalize(fold(value));
    if (!norm) continue;
    if (neg) { (isPhrase ? out.exclude.phrases : out.exclude.terms).push(...(isPhrase ? [norm] : queryTerms(value))); continue; }
    if (isPhrase) out.phrases.push(norm);
    for (const raw of norm.split(' ')) {
      const st = stem(raw);
      if (raw.length < 2 || STOP_WORDS.has(st) || /^\d+$/.test(raw)) continue;
      out.terms.push(st); out.rawTerms.push(raw);
    }
  }
  if (!out.terms.length && !out.phrases.length && !out.filters.length && !out.len && !out.exclude.terms.length && !out.exclude.phrases.length) {
    // all stop words ("yoga"): search them as plain words rather than returning nothing
    for (const raw of normalize(fold(text)).split(' ').filter((w) => w.length > 1)) { out.terms.push(stem(raw)); out.rawTerms.push(raw); }
  }
  return out;
}

// ---------------------------------------------------------------- what gets indexed

/** What gets indexed for one video (and which of your own tags/notes go with it). */
export function videoFields(video, libItem) {
  const p = video.profile ?? {};
  const areaWords = Object.entries(p.areas ?? {}).filter(([, s]) => s >= 0.5).map(([a]) => AREA_BY_ID[a]?.label ?? a);
  const benefitWords = Object.keys(video.evidence?.benefits ?? {}).map((id) => BENEFITS.find((b) => b.id === id)?.label ?? id);
  return {
    title: video.title,
    channel: video.channel,
    tags: `${(video.tags ?? []).join(' ')} ${(libItem?.tags ?? []).join(' ')}`,
    concepts: [...areaWords, ...(p.poses ?? []).map(({ id }) => POSE_BY_ID[id]?.label ?? ''), ...Object.entries(p.styles ?? {}).filter(([, x]) => x >= 0.3).map(([id]) => STYLE_BY_ID[id]?.name ?? id), p.kind?.label ?? ''].join(' '),
    chapters: (p.chapters ?? []).map((c) => c.label).join(' '),
    keywords: benefitWords.join(' '),
    description: String(video.description ?? '').slice(0, 1500),
    viewers: (video.evidence?.quotes ?? []).map((q) => q.text).join(' '),
    note: libItem?.note ?? '',
  };
}

/** Structured facts about a video, for field filters and concept matching. */
export function videoMeta(video, libItem) {
  const p = video.profile ?? {};
  return {
    channel: video.channel ?? '',
    tags: (libItem?.tags ?? []).map((t) => normalize(t)),
    ownTags: (video.tags ?? []).map((t) => normalize(t)),
    poses: new Set((p.poses ?? []).map((x) => x.id)),
    areas: p.areas ?? {},
    durationSec: video.durationSec ?? null,
  };
}

const normFields = (fields) => ` ${normalize(fold(Object.values(fields).join(' | ')))} `;

// Tokenising every field of every video is the expensive part of building an index, and almost nothing
// changes between two builds. So each video's tokenised document is remembered, keyed by id and checked
// against the exact text it was built from: edit a tag or read new comments and only that video is redone.
const DOC_MEMO = new Map();   // id -> {sig, len, tf, text, title}

export class SearchIndex {
  /** @param {Array<{id:string, fields:Record<string,string>, meta?:object}>} docs
   *  @param {Map<string, any>|null} [memo]  reuse tokenised documents from an earlier build */
  constructor(docs, memo = null) {
    this.docs = new Map();      // id -> {len, tf: Map(term -> weighted tf), text, title, meta}
    this.df = new Map();        // term -> number of docs containing it
    this.channels = new Map();  // display name -> count (for suggestions)
    let totalLen = 0;
    for (const { id, fields, meta } of docs) {
      const sig = memo ? Object.values(fields).join('\u0001') : '';
      let d = memo?.get(id);
      if (!d || d.sig !== sig) {
        const tf = new Map();
        let len = 0;
        for (const [f, text] of Object.entries(fields)) {
          const w = FIELD_WEIGHTS[f] ?? 1;
          for (const t of tokenize(text)) { tf.set(t, (tf.get(t) ?? 0) + w); len += w; }
        }
        d = { sig, len, tf, text: normFields(fields), title: ` ${normalize(fold(fields.title ?? ''))} ` };
        memo?.set(id, d);
      }
      for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.set(id, { len: d.len, tf: d.tf, text: d.text, title: d.title, meta: meta ?? null });
      if (meta?.channel) this.channels.set(meta.channel, (this.channels.get(meta.channel) ?? 0) + 1);
      totalLen += d.len;
    }
    if (memo && memo.size > docs.length * 1.5 + 200) for (const id of memo.keys()) if (!this.docs.has(id)) memo.delete(id);   // forget videos that are gone
    this.avgLen = docs.length ? totalLen / docs.length : 1;
    this.terms = [...this.df.keys()];
  }

  static fromVideos(videos, library = {}) {
    return new SearchIndex(Object.values(videos).map((v) => ({ id: v.id, fields: videoFields(v, library[v.id]), meta: videoMeta(v, library[v.id]) })), DOC_MEMO);
  }

  // ------------------------------------------------------------ pieces of a query

  /** Index terms a typed term stands for: itself, or (as-you-type) things it is the start of. */
  #forms(term, prefix) {
    if (this.df.has(term)) return [{ t: term, w: 1 }];
    if (prefix && term.length >= 3) return this.terms.filter((t) => t.startsWith(term)).slice(0, 25).map((t) => ({ t, w: 0.7 }));
    return [];
  }

  /** Close spellings in the vocabulary ("pigion" -> "pigeon"), most common first. */
  #fuzzy(term) {
    if (term.length < 4) return [];
    const max = term.length >= 8 ? 2 : 1;
    const out = [];
    for (const t of this.terms) {
      if (Math.abs(t.length - term.length) > max) continue;
      const d = editDistance(term, t, max);
      if (d <= max) out.push({ t, d, df: this.df.get(t) });
    }
    return out.sort((a, b) => a.d - b.d || b.df - a.df).slice(0, 3);
  }

  /**
   * The muscles and exercises behind the typed words, with the word range each one covers.
   * "lower back pain" -> {lower_back, covers words 0-1}, "pigeon" -> {pigeon pose, covers word 2}.
   * `text` is the typed words joined by single spaces (stop words already removed).
   */
  static conceptCovers(text) {
    const words = text ? text.split(' ') : [];
    const wordAt = (charIndex) => (text.slice(0, charIndex).match(/ /g) ?? []).length;
    const covers = [];
    for (const { entry, phrase, index } of scan(AREA_TERMS, text)) {
      if (entry.weak) continue;
      const areas = new Map();
      for (const [a, w] of Object.entries(entry.map)) if (w >= 0.5) areas.set(a, w);
      if (!areas.size) continue;
      const from = wordAt(index);
      covers.push({ from, to: Math.min(words.length - 1, from + phrase.split(' ').length - 1), areas, poses: new Set() });
    }
    for (const { entry, phrase, index } of scan(POSE_TERMS, text)) {
      const from = wordAt(index);
      covers.push({ from, to: Math.min(words.length - 1, from + phrase.split(' ').length - 1), areas: new Map(), poses: new Set([entry.id]) });
    }
    return covers;
  }

  #poseMatches(meta, value) {
    const v = normalize(fold(value));
    if (!v) return false;
    for (const id of meta.poses) {
      const p = POSE_BY_ID[id];
      if (normalize(p.label).includes(v) || id.replace(/_/g, ' ').includes(v) || p.phrases.some((ph) => normalize(ph).includes(v))) return true;
    }
    return false;
  }

  #areaMatches(meta, value) {
    const v = normalize(fold(value));
    if (!v) return false;
    const wanted = new Set();
    for (const { entry } of scan(AREA_TERMS, v)) for (const [a, w] of Object.entries(entry.map)) if (w >= 0.5) wanted.add(a);
    for (const a of AREAS) if (normalize(a.label).includes(v) || a.id.replace(/_/g, ' ').includes(v)) wanted.add(a.id);
    return [...wanted].some((a) => (meta.areas[a] ?? 0) >= 0.45);
  }

  #passesFilters(doc, q) {
    const m = doc.meta;
    for (const f of q.filters) {
      const v = normalize(fold(f.value));
      if (f.field === 'title') { if (!doc.title.includes(v)) return false; continue; }
      if (!m) return false;
      if (f.field === 'channel') { if (!normalize(fold(m.channel)).includes(v) && !tokenize(m.channel).some((t) => t.startsWith(stem(v)))) return false; }
      else if (f.field === 'tag') { if (![...m.tags, ...m.ownTags].some((t) => t === v || t.includes(v))) return false; }
      else if (f.field === 'pose') { if (!this.#poseMatches(m, f.value)) return false; }
      else if (f.field === 'area') { if (!this.#areaMatches(m, f.value)) return false; }
    }
    if (q.len) {
      const mins = (doc.meta?.durationSec ?? null) == null ? null : doc.meta.durationSec / 60;
      if (mins == null) return false;
      if (q.len.min != null && (q.len.exMin ? mins <= q.len.min : mins < q.len.min)) return false;
      if (q.len.max != null && (q.len.exMax ? mins >= q.len.max : mins > q.len.max)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ searching

  /**
   * Run a search. Every term must be satisfied (by the word, a close spelling, or the muscle/exercise
   * behind it); if nothing satisfies them all, documents matching some of them are returned (partial).
   * @param {string|string[]} query   a search-box string, or an array of already-stemmed terms
   * @param {{limit?:number, prefix?:boolean, ids?:Set<string>|null, fuzzy?:boolean, concepts?:boolean}} [opts]
   * @returns {{results:{id:string,score:number}[], interpretation:{terms:string[], corrections:Record<string,string>, concepts:string[], phrases:string[], excluded:string[], filters:{field:string,value:string}[], len:object|null, partial:boolean}}}
   */
  query(query, { limit = 100, prefix = false, ids = null, fuzzy = true, concepts = true } = {}) {
    const q = Array.isArray(query)
      ? { terms: query, rawTerms: query, phrases: [], exclude: { terms: [], phrases: [] }, filters: [], len: null }
      : parseSearch(query);
    const info = { terms: q.terms, corrections: {}, concepts: [], phrases: q.phrases, excluded: [...q.exclude.terms, ...q.exclude.phrases], filters: q.filters, len: q.len, partial: false };
    const pool = [...this.docs].filter(([id, d]) => (!ids || ids.has(id)) && this.#passesFilters(d, q));
    const hasMatchers = q.terms.length || q.phrases.length;

    // filters / exclusions only: everything that passes
    const excluded = (d) => q.exclude.terms.some((t) => d.tf.has(t)) || q.exclude.phrases.some((p) => d.text.includes(` ${p} `));
    if (!hasMatchers) {
      const keep = (q.filters.length || q.len || info.excluded.length) ? pool.filter(([, d]) => !excluded(d)) : [];
      return { results: keep.slice(0, limit).map(([id]) => ({ id, score: 1 })), interpretation: info };
    }

    // what each typed word stands for: the index term(s), a close spelling, and/or the muscle or exercise it names
    const text = q.rawTerms.join(' ');
    const covers = concepts ? SearchIndex.conceptCovers(text) : [];
    const covered = (i) => covers.some((c) => i >= c.from && i <= c.to);
    const termInfo = q.terms.map((t, i) => {
      let forms = this.#forms(t, prefix);
      if (!forms.length && fuzzy && !covered(i)) {
        const fz = this.#fuzzy(t);
        if (fz.length) { forms = fz.map((f) => ({ t: f.t, w: 0.6 })); info.corrections[q.rawTerms[i]] = fz[0].t; }
      }
      return { t, forms };
    });
    for (const c of covers) {
      for (const a of c.areas.keys()) { const label = AREA_BY_ID[a]?.label ?? a; if (!info.concepts.includes(label)) info.concepts.push(label); }
      for (const p of c.poses) { const label = POSE_BY_ID[p].label; if (!info.concepts.includes(label)) info.concepts.push(label); }
    }

    const N = this.docs.size;
    const scored = [];
    for (const [id, d] of pool) {
      if (excluded(d)) continue;
      if (q.phrases.some((p) => !d.text.includes(` ${p} `))) continue;
      let score = 0;
      const sat = new Array(q.terms.length).fill(false);
      termInfo.forEach((ti, i) => {
        for (const { t, w } of ti.forms) {
          const tf = d.tf.get(t);
          if (!tf) continue;
          const df = this.df.get(t);
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          score += w * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (d.len / this.avgLen))));
          sat[i] = true;
        }
      });
      // not said in so many words: does the video work that muscle / contain that exercise?
      if (d.meta) {
        for (const c of covers) {
          let s = 0;
          for (const [a, w] of c.areas) { const v = d.meta.areas[a] ?? 0; if (v >= 0.5) s = Math.max(s, w * v); }
          if (!s && [...c.poses].some((p) => d.meta.poses.has(p))) s = 1;
          if (!s) continue;
          score += CONCEPT_BONUS * s;
          for (let i = c.from; i <= c.to; i++) sat[i] = true;
        }
      }
      for (const p of q.phrases) score += PHRASE_BONUS + (d.title.includes(` ${p} `) ? 1.5 : 0);
      const satisfied = sat.filter(Boolean).length;
      if (satisfied === 0 && !q.phrases.length) continue;
      scored.push({ id, score, satisfied });
    }

    const full = scored.filter((r) => r.satisfied >= q.terms.length);
    info.partial = !full.length && scored.length > 0 && q.terms.length > 1;
    const out = (full.length ? full : scored).sort((a, b) => b.score - a.score).slice(0, limit);
    return { results: out.map(({ id, score }) => ({ id, score })), interpretation: info };
  }

  /** Back-compatible ranked list. */
  search(query, opts) { return this.query(query, opts).results; }

  /** id -> 0..1 relevance (best match = 1), for blending into ranking. */
  relevance(query, opts) {
    const r = this.search(query, opts);
    const top = r[0]?.score ?? 0;
    return new Map(r.map(({ id, score }) => [id, top ? score / top : 0]));
  }

  // ------------------------------------------------------------ typing assistance

  /**
   * Completions for the search box. Returns full replacement strings (the rest of the query, kept, plus the completion).
   * Understands "channel:", "tag:", "pose:" and "area:" prefixes.
   */
  suggest(text, n = 8) {
    const m = String(text ?? '').match(/^(.*?)(\S*)$/s);
    const head = m[1], last = m[2];
    if (last.length < 2) return [];
    const f = last.match(/^(-?)([a-z]+):(.*)$/i);
    const field = f ? SEARCH_FIELDS[f[2].toLowerCase()] : null;
    const neg = f?.[1] ?? '';
    const stemOf = (s) => stem(normalize(fold(s)));
    let options = [];
    if (field) {
      const part = normalize(fold(f[3]));
      if (field === 'channel') options = [...this.channels].map(([c, k]) => [c, k]);
      else if (field === 'pose') options = Object.values(POSE_BY_ID).map((p) => [p.label, 1]);
      else if (field === 'area') options = AREAS.map((a) => [a.label, 1]);
      else if (field === 'tag') { const tags = new Map(); for (const d of this.docs.values()) for (const t of d.meta?.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1); options = [...tags]; }
      return options.filter(([o]) => normalize(fold(o)).includes(part)).sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([o]) => `${head}${neg}${f[2]}:${/\s/.test(o) ? `"${o}"` : o}`);
    }
    const part = normalize(fold(last));
    const sp = stemOf(last);
    const words = this.terms.filter((t) => t.startsWith(sp) && t !== sp && t.length > 2 && !/^\d+$/.test(t)).sort((a, b) => this.df.get(b) - this.df.get(a)).slice(0, n).map((t) => [t, this.df.get(t)]);
    const names = [...this.channels].filter(([c]) => normalize(fold(c)).split(' ').some((w) => w.startsWith(part))).map(([c, k]) => [`channel:"${c}"`, k + 1000]);
    const poses = Object.values(POSE_BY_ID).filter((p) => normalize(p.label).startsWith(part)).map((p) => [`pose:${p.label.toLowerCase().split(/[ /]/)[0]}`, 500]);
    return [...poses, ...names, ...words].sort((a, b) => b[1] - a[1]).slice(0, n).map(([o]) => `${head}${o}`);
  }
}
