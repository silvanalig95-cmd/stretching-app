// A small local search index over everything the app has collected.
//
// Each video becomes a document with weighted fields (title, teacher, the poses
// and chapters it contains, what viewers said, your own tags and notes ...), and
// queries are ranked with BM25. This is what lets you find "pigeon", "sciatica"
// or "Kassandra" in the Library even when the title says none of it, and what
// lets the command box understand "Adriene hips" or "pigeon pose, 20 min".

import { normalize, POSE_BY_ID, BENEFITS, AREA_BY_ID } from './lexicon.js';

export const FIELD_WEIGHTS = { title: 3, tags: 3, channel: 2, concepts: 2, chapters: 2, keywords: 1.5, description: 1, viewers: 1, note: 1 };
const K1 = 1.2, B = 0.75;

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

/** Text -> stemmed tokens (no stop-word removal: that's the query side's job). */
export function tokenize(text) {
  const n = normalize(String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, ''));
  return n ? n.split(' ').filter((w) => w.length > 1).map(stem) : [];
}

/** Query text -> meaningful stemmed terms. Falls back to everything if the query is all stop words. */
export function queryTerms(text) {
  const all = tokenize(text);
  const kept = all.filter((t) => !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  return kept.length ? kept : all;
}

/** What gets indexed for one video (and which of your own tags/notes go with it). */
export function videoFields(video, libItem) {
  const p = video.profile ?? {};
  const areaWords = Object.entries(p.areas ?? {}).filter(([, s]) => s >= 0.5).map(([a]) => AREA_BY_ID[a]?.label ?? a);
  const benefitWords = Object.keys(video.evidence?.benefits ?? {}).map((id) => BENEFITS.find((b) => b.id === id)?.label ?? id);
  return {
    title: video.title,
    channel: video.channel,
    tags: `${(video.tags ?? []).join(' ')} ${(libItem?.tags ?? []).join(' ')}`,
    concepts: [...areaWords, ...(p.poses ?? []).map(({ id }) => POSE_BY_ID[id]?.label ?? ''), ...Object.keys(p.styles ?? {})].join(' '),
    chapters: (p.chapters ?? []).map((c) => c.label).join(' '),
    keywords: benefitWords.join(' '),
    description: String(video.description ?? '').slice(0, 1500),
    viewers: (video.evidence?.quotes ?? []).map((q) => q.text).join(' '),
    note: libItem?.note ?? '',
  };
}

export class SearchIndex {
  /** @param {Array<{id:string, fields:Record<string,string>}>} docs */
  constructor(docs) {
    this.docs = new Map();      // id -> {len, tf: Map(term -> weighted tf)}
    this.df = new Map();        // term -> number of docs containing it
    let totalLen = 0;
    for (const { id, fields } of docs) {
      const tf = new Map();
      let len = 0;
      for (const [f, text] of Object.entries(fields)) {
        const w = FIELD_WEIGHTS[f] ?? 1;
        for (const t of tokenize(text)) { tf.set(t, (tf.get(t) ?? 0) + w); len += w; }
      }
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.set(id, { len, tf });
      totalLen += len;
    }
    this.avgLen = docs.length ? totalLen / docs.length : 1;
    this.terms = [...this.df.keys()];
  }

  static fromVideos(videos, library = {}) {
    return new SearchIndex(Object.values(videos).map((v) => ({ id: v.id, fields: videoFields(v, library[v.id]) })));
  }

  /** Expand a query term to the index terms it matches (itself, plus prefixes for as-you-type search). */
  #expand(term, prefix) {
    if (this.df.has(term)) return [term];
    if (!prefix || term.length < 3) return [];
    return this.terms.filter((t) => t.startsWith(term)).slice(0, 25);
  }

  /**
   * Rank documents for a query. A document must match every term (AND), except
   * that if nothing matches all of them, documents matching any term are returned.
   * @returns {{id:string, score:number}[]} best first
   */
  search(query, { limit = 100, prefix = false, ids = null } = {}) {
    const terms = Array.isArray(query) ? query : queryTerms(query);
    if (!terms.length) return [];
    const N = this.docs.size;
    const scores = new Map();   // id -> score
    const hits = new Map();     // id -> number of distinct query terms matched
    for (const q of terms) {
      const forms = this.#expand(q, prefix);
      const seen = new Set();
      for (const t of forms) {
        const idf = Math.log(1 + (N - this.df.get(t) + 0.5) / (this.df.get(t) + 0.5));
        for (const [id, d] of this.docs) {
          const tf = d.tf.get(t);
          if (!tf || (ids && !ids.has(id))) continue;
          const s = idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (d.len / this.avgLen))));
          scores.set(id, (scores.get(id) ?? 0) + s * (t === q ? 1 : 0.7));
          if (!seen.has(id)) { seen.add(id); hits.set(id, (hits.get(id) ?? 0) + 1); }
        }
      }
    }
    let out = [...scores].map(([id, score]) => ({ id, score, hits: hits.get(id) }));
    const all = out.filter((r) => r.hits === terms.length);
    out = all.length ? all : out;
    return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({ id, score }) => ({ id, score }));
  }

  /** id -> 0..1 relevance (best match = 1), for blending into ranking. */
  relevance(query, opts) {
    const r = this.search(query, opts);
    const top = r[0]?.score ?? 0;
    return new Map(r.map(({ id, score }) => [id, top ? score / top : 0]));
  }
}
