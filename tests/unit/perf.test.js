// Guards against slowdowns with a heavy user's library (2,000 videos is the most the app keeps).
// Budgets are ~10x what a laptop needs, so they only trip on a real regression (e.g. something turning quadratic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { makeState } from '../helpers/synthetic.js';
import { SearchIndex, parseSearch } from '../../js/index.js';
import { buildModel, rankCandidates, composeCombos } from '../../js/model.js';
import { splitState, loadState } from '../../js/state.js';

const ms = (fn) => { const t = performance.now(); const r = fn(); return [performance.now() - t, r]; };
let state;
const getState = () => (state ??= makeState(2000));

test('a 2,000-video library: ranking, searching, combos and saving stay snappy', () => {
  const s = getState();
  assert.equal(Object.keys(s.videos).length, 2000);
  const filters = { areas: [{ id: 'hip_flexors', mode: 'tight' }, { id: 'glutes', mode: 'weak' }], minMin: 10, maxMin: 30, styles: [], hints: [], terms: [], source: 'all' };
  const [tModel, model] = ms(() => buildModel(s.history, s.videos));
  const libraryIds = new Set(Object.keys(s.library));
  const args = { videos: Object.values(s.videos), filters, model, libraryIds, trusted: s.prefs.trusted, blocked: s.blocked, adventure: 0.5 };
  const [tRank, ranked] = ms(() => rankCandidates(args));
  assert.ok(ranked.length > 50, 'ranking returns real candidates');
  const [tCold, index] = ms(() => new SearchIndex(Object.values(s.videos).map((v) => ({ id: v.id, fields: { title: v.title, description: v.description, tags: (v.tags ?? []).join(' ') }, meta: null }))));
  const [tSearch] = ms(() => { for (let i = 0; i < 20; i++) index.query('pigeon pose hips'); });
  const [tCombo] = ms(() => composeCombos(ranked, { ...filters, areas: [...filters.areas, { id: 'neck', mode: 'tight' }, { id: 'shoulders', mode: 'tight' }], minMin: 20, maxMin: 40 }, { minTotal: 20, maxTotal: 40 }));
  const [tSave, saved] = ms(() => { const { profile, index: ix } = splitState(s); return [JSON.stringify(profile), JSON.stringify(ix)]; });
  const [tLoad] = ms(() => loadState({ profile: JSON.parse(saved[0]), index: JSON.parse(saved[1]) }));
  const report = { tModel, tRank, tCold, tSearch: tSearch / 20, tCombo, tSave, tLoad };
  const budget = { tModel: 100, tRank: 500, tCold: 2500, tSearch: 100, tCombo: 300, tSave: 600, tLoad: 800 };
  for (const [k, limit] of Object.entries(budget)) assert.ok(report[k] < limit, `${k} took ${report[k].toFixed(0)} ms (budget ${limit} ms)`);
});

test('rebuilding the search index after a small change reuses everything that did not change', () => {
  const s = getState();
  SearchIndex.fromVideos(s.videos, s.library);                      // warm
  const [tWarm] = ms(() => SearchIndex.fromVideos(s.videos, s.library));
  const [tRebuildAfterTag] = ms(() => {
    const id = Object.keys(s.library)[0];
    s.library[id] = { ...s.library[id], tags: ['brand-new-tag'] };
    return SearchIndex.fromVideos(s.videos, s.library);
  });
  assert.ok(tWarm < 400, `warm rebuild ${tWarm.toFixed(0)} ms`);
  assert.ok(tRebuildAfterTag < 400, `rebuild after one tag edit ${tRebuildAfterTag.toFixed(0)} ms`);
});

test('the reused documents never go stale: edits, new comments and removals show up in the next build', () => {
  const s = makeState(60, { library: 5, sessions: 5, seed: 3 });
  const [first, other] = Object.keys(s.videos);
  let idx = SearchIndex.fromVideos(s.videos, s.library);
  assert.equal(idx.query('zzyzxword').results.length, 0);

  s.videos[first] = { ...s.videos[first], title: `${s.videos[first].title} zzyzxword` };            // the video itself changes
  idx = SearchIndex.fromVideos(s.videos, s.library);
  assert.deepEqual(idx.query('zzyzxword').results.map((r) => r.id), [first]);

  s.library[other] = { ...(s.library[other] ?? { addedAt: 1 }), tags: ['qqvexed'], note: 'wibbleflux' };  // your tag and note change
  idx = SearchIndex.fromVideos(s.videos, s.library);
  assert.deepEqual(idx.query('qqvexed').results.map((r) => r.id), [other]);
  assert.deepEqual(idx.query('wibbleflux').results.map((r) => r.id), [other]);

  delete s.library[other].tags; s.library[other].note = '';                                          // ... and are removed again
  idx = SearchIndex.fromVideos(s.videos, s.library);
  assert.equal(idx.query('qqvexed').results.length, 0);
  assert.equal(idx.query('wibbleflux').results.length, 0);

  delete s.videos[first];                                                                            // the video is deleted
  idx = SearchIndex.fromVideos(s.videos, s.library);
  assert.equal(idx.query('zzyzxword').results.length, 0);
  assert.equal(idx.docs.has(first), false);
});

test('parseSearch + query on a big index handle awkward input quickly', () => {
  const s = getState();
  const idx = SearchIndex.fromVideos(s.videos, s.library);
  const nasty = ['', '   ', '"', '""""', '-', '- - -', 'a'.repeat(500), 'hips '.repeat(60), 'teacher:', 'len:', 'len:10-', '"unclosed phrase', 'ünïcödé strëtch', '🧘 yoga'];
  const [t] = ms(() => { for (const q of nasty) { parseSearch(q); idx.query(q, { prefix: true }); } });
  assert.ok(t < 1500, `${t.toFixed(0)} ms for ${nasty.length} awkward queries`);
});
