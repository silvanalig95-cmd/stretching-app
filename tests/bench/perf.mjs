// How fast is everything with a big library?   node tests/bench/perf.mjs [videos=2000]
import { performance } from 'node:perf_hooks';
import { makeState } from '../helpers/synthetic.js';
import { SearchIndex, parseSearch } from '../../js/index.js';
import { buildModel, rankCandidates, composeCombos } from '../../js/model.js';
import { splitState, loadState, reindexAll } from '../../js/state.js';

const N = Number(process.argv[2] ?? 2000);
const rows = [];
function time(name, fn, runs = 5) {
  let r; const ts = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); r = fn(); ts.push(performance.now() - t); }
  ts.sort((a, b) => a - b);
  rows.push([name, ts[Math.floor(ts.length / 2)], ts[0]]);
  return r;
}

let t0 = performance.now();
const state = makeState(N);
console.log(`built ${Object.keys(state.videos).length} synthetic videos, ${Object.keys(state.library).length} in library, ${state.history.length} sessions in ${Math.round(performance.now() - t0)} ms (not measured)\n`);

const filters = { areas: [{ id: 'hip_flexors', mode: 'tight' }, { id: 'glutes', mode: 'weak' }], minMin: 10, maxMin: 30, styles: [], hints: [], terms: [], source: 'all' };
const model = time('buildModel (history → learned credit)', () => buildModel(state.history, state.videos));
const libraryIds = new Set(Object.keys(state.library));
const rankArgs = { videos: Object.values(state.videos), filters, model, libraryIds, trusted: state.prefs.trusted, blocked: state.blocked, adventure: 0.5 };
const ranked = time('rankCandidates (2 muscles, all videos)', () => rankCandidates(rankArgs));
time('rankCandidates with typed words', () => {
  const rel = SearchIndex.fromVideos(state.videos, state.library).relevance(['pigeon', 'pose'], {});
  return rankCandidates({ ...rankArgs, filters: { ...filters, terms: ['pigeon', 'pose'] }, textScores: rel });
});
const index = time('SearchIndex.fromVideos (build)', () => SearchIndex.fromVideos(state.videos, state.library));
time('search: plain words', () => index.search(parseSearch('pigeon pose hips')));
time('search: phrase + exclusion + filters', () => index.search(parseSearch('"hip opener" -beginners teacher:calm len:10-30')));
time('search: typo ("hamstrng strech")', () => index.search(parseSearch('hamstrng strech')));
time('autocomplete suggestions', () => index.suggest('pige'));
time('composeCombos (beam search)', () => composeCombos(ranked, { ...filters, areas: [{ id: 'hip_flexors', mode: 'tight' }, { id: 'glutes', mode: 'weak' }, { id: 'shoulders', mode: 'tight' }, { id: 'neck', mode: 'tight' }], minMin: 20, maxMin: 40 }, { minTotal: 20, maxTotal: 40 }));
const saved = time('save: split + JSON.stringify', () => { const { profile, index: ix } = splitState(state); return [JSON.stringify(profile), JSON.stringify(ix)]; });
const kb = Math.round((saved[0].length + saved[1].length) / 1024);
time('load: parse + loadState', () => loadState({ profile: JSON.parse(saved[0]), index: JSON.parse(saved[1]) }), 3);
time('re-analyse everything (after an analysis upgrade)', () => { const s = loadState({ profile: JSON.parse(saved[0]), index: JSON.parse(saved[1]) }).state; reindexAll(s); }, 3);

console.log(`library of ${N} videos, saved size ${kb} KB\n`);
const w = Math.max(...rows.map((r) => r[0].length));
for (const [name, med, best] of rows) console.log(`${name.padEnd(w)}  median ${med.toFixed(1).padStart(8)} ms   best ${best.toFixed(1).padStart(8)} ms`);
