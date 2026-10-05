import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeClient, discover, THOROUGHNESS, effortFor, QuotaError } from '../../js/youtube.js';
import { expandQueries } from '../../js/query.js';
import { freshState, applyDiscovery } from '../../js/state.js';
import { mulberry32 } from '../../js/model.js';
import { analyzeVideoText } from '../../js/analyze.js';
import { fakeFetch, fault, VIDEOS } from '../helpers/fake-youtube.js';

const client = () => new YouTubeClient({ key: 'k', base: 'http://fake.local/youtube/v3', fetchFn: fakeFetch });
const reset = (pageSize = 50) => { fault.quota = false; fault.commentsOff = new Set(); fault.calls.length = 0; fault.pageSize = pageSize; };
const hips = { areas: [{ id: 'hip_flexors', mode: 'tight' }, { id: 'glutes', mode: 'tight' }], minMin: 10, maxMin: 30, styles: [], terms: [] };
const run = (opts, o = {}) => { const c = o.client ?? client(); return discover({ client: c, filters: o.filters ?? hips, state: o.state ?? freshState(), rng: mulberry32(o.seed ?? 5), opts }).then((r) => ({ ...r, c })); };

test('presets: more thorough means more rounds, bigger budget, more comments read, higher bar', () => {
  const order = ['quick', 'balanced', 'thorough', 'exhaustive'].map((k) => THOROUGHNESS[k]);
  for (let i = 1; i < order.length; i++) {
    for (const k of ['maxRounds', 'budget', 'commentVideos', 'strongFits', 'queries']) assert.ok(order[i][k] > order[i - 1][k], `${k} grows with thoroughness`);
  }
  assert.ok(THOROUGHNESS.balanced.commentVideos > 10, 'reads comments on well over 10 videos by default');
  assert.equal(effortFor('nope'), THOROUGHNESS.balanced);
});

test('a wide search looks at far more than 10 videos and reports what it did', async () => {
  reset();
  const { report, records } = await run({ ...THOROUGHNESS.thorough, strongFits: 999 });
  assert.ok(report.examined >= 30, `examined ${report.examined}`);
  assert.ok(records.length >= 25);
  assert.ok(report.rounds >= 2, `rounds ${report.rounds}`);
  assert.ok(report.commentsRead > 0 && records.filter((r) => r.evidence?.n > 0).length > 10, 'comments read on more than 10 videos');
  assert.ok(report.spent > 0 && report.stopped);
});

test('it stops early once enough strong fits have turned up (and does not waste quota)', async () => {
  reset();
  const { report } = await run({ ...THOROUGHNESS.thorough, strongFits: 2 });
  assert.equal(report.stopped, 'enough');
  assert.equal(report.rounds, 1, 'the first round already had two strong fits');
  assert.ok(report.strong >= 2);
  const wide = await run({ ...THOROUGHNESS.thorough, strongFits: 999 });
  assert.ok(report.spent < wide.report.spent, `${report.spent} < ${wide.report.spent}`);
});

test('when strong fits are scarce it keeps going, round after round, never repeating a query', async () => {
  reset();
  const { report } = await run({ ...THOROUGHNESS.thorough, maxRounds: 4, strongFits: 999, budget: Infinity });
  assert.equal(report.stopped, 'rounds');
  assert.ok(report.rounds >= 3, `rounds ${report.rounds}`);
  const qs = report.queries.map((q) => q.q);
  assert.equal(new Set(qs).size, qs.length, `repeated a query: ${qs}`);
  assert.deepEqual([...new Set(report.queries.map((q) => q.round))].sort(), Array.from({ length: report.rounds }, (_, i) => i + 1).filter((r) => report.queries.some((q) => q.round === r)));
});

test('later rounds learn from the best fits so far: their poses and teachers become new searches', async () => {
  reset();
  const { report } = await run({ ...THOROUGHNESS.thorough, maxRounds: 3, strongFits: 999 });
  const later = report.queries.filter((q) => q.round >= 2).map((q) => q.q.toLowerCase());
  assert.ok(later.length > 0);
  const channels = [...new Set(VIDEOS.map((v) => v.channel.toLowerCase()))];
  assert.ok(later.some((q) => /pigeon|low lunge|figure four/.test(q) || channels.some((c) => q.includes(c))), `later queries: ${later.join(' | ')}`);
});

test('the budget is a hard cap: it stops, says so, and still returns what it found', async () => {
  reset(5);
  const { report, c, records } = await run({ ...THOROUGHNESS.exhaustive, budget: 330, commentVideos: 20, maxRounds: 8, strongFits: 999, extraPages: 3 });
  assert.ok(c.spentUnits <= 330, `spent ${c.spentUnits}`);
  assert.equal(report.stopped, 'budget');
  assert.ok(records.length > 0);
  assert.equal(report.spent, c.spentUnits);
});

test('comment reading respects the preset and skips videos with (almost) no comments', async () => {
  reset();
  const state = freshState();
  const { report, records } = await run({ ...THOROUGHNESS.balanced, commentVideos: 6, strongFits: 999 }, { state });
  assert.ok(records.filter((r) => r.evidence?.n > 0 && !state.videos[r.id]).length <= 6);
  const tiny = VIDEOS.find((v) => v.topic === 'hips'); const keep = tiny.comments; tiny.comments = ['ok'];
  try {
    reset();
    const out = await run({ ...THOROUGHNESS.balanced, commentVideos: 40, strongFits: 999 });
    assert.ok(!out.records.find((r) => r.id === tiny.id)?.evidence, 'a video with a single comment is not worth a unit');
  } finally { tiny.comments = keep; }
});

test('comments are re-ranked as they arrive: a video can move up and get read in a later pass', async () => {
  reset();
  const { records, report } = await run({ ...THOROUGHNESS.thorough, commentVideos: 12, strongFits: 999, maxRounds: 2 });
  const read = records.filter((r) => r.evidence?.n > 0);
  assert.ok(read.length <= 12 && read.length >= 6, `${read.length}`);
  assert.ok(report.commentsRead >= read.length);
});

test('requests with nothing to measure fit against (no muscles, no words) get a single pass', async () => {
  reset();
  const { report } = await run({ ...THOROUGHNESS.thorough, maxRounds: 5, strongFits: 999 }, { filters: { areas: [], minMin: 10, maxMin: 30, styles: [], terms: [] } });
  assert.equal(report.rounds, 1);
});

test('free-text terms take part in judging fit (so "pigeon" searches can finish early)', async () => {
  reset();
  const { report, records } = await run({ ...THOROUGHNESS.balanced, strongFits: 3 }, { filters: { areas: [], minMin: 5, maxMin: 60, styles: [], terms: ['pigeon'] } });
  assert.ok(report.rounds >= 1 && report.examined > 0);
  assert.ok(records.some((r) => r.profile.poses.some((p) => p.id === 'pigeon')));
});

test('running out of quota mid-way returns what was found so far', async () => {
  reset(5);
  let calls = 0;
  const flaky = new YouTubeClient({ key: 'k', base: 'http://fake.local/youtube/v3', fetchFn: async (u) => {
    if (String(u).includes('/search') && ++calls === 3) return { ok: false, status: 403, json: async () => ({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }) };
    return fakeFetch(u);
  } });
  const out = await run({ ...THOROUGHNESS.thorough, strongFits: 999 }, { client: flaky });
  assert.ok(out.report.warnings.some((w) => /allowance is used up/.test(w)));
  assert.ok(out.records.length > 0);
});

test('a second wide search finds NEW places (it remembers every query and page)', async () => {
  reset(10);
  const state = freshState();
  const first = await run({ ...THOROUGHNESS.balanced, strongFits: 999 }, { state, seed: 1 });
  applyDiscovery(state, first);
  const second = await run({ ...THOROUGHNESS.balanced, strongFits: 999 }, { state, seed: 2 });
  const q1 = new Set(first.report.queries.map((q) => q.q));
  assert.ok(second.report.queries.every((q) => q.deeper || !q1.has(q.q)), 'no query repeated from the first run unless going deeper');
  assert.ok(second.report.newVideos >= 0);
});

test('expandQueries: poses that work the requested muscles come first, then the teachers who made them; used queries are skipped', () => {
  const mk = (title, channel, tags = []) => { const v = { title, channel, tags, description: '0:00 a\n1:00 Pigeon pose\n4:00 Low lunge\n8:00 x' }; return { ...v, profile: analyzeVideoText(v) }; };
  const top = [mk('Hip release', 'Calm Hips Studio', ['hip stretch']), mk('Hip flow', 'Calm Hips Studio', ['hip stretch']), mk('Hips', 'Tiny Yoga Room')];
  const f = { areas: [{ id: 'hip_flexors', mode: 'tight' }], minMin: 10, maxMin: 20, terms: [] };
  const qs = expandQueries(top, f, { n: 6, rng: mulberry32(1) });
  assert.ok(qs.length >= 4);
  assert.match(qs[0].q, /pigeon|low lunge/i);
  assert.ok(qs.some((q) => /calm hips studio/i.test(q.q)));
  assert.ok(qs.every((q) => q.pageToken === null && q.order === 'relevance' && q.key));
  const used = { [qs[0].key]: { count: 1 } };
  assert.ok(!expandQueries(top, f, { n: 6, queryLog: used, rng: mulberry32(1) }).some((q) => q.key === qs[0].key), 'never repeats');
  const typed = expandQueries(top, { ...f, terms: ['pigeon'] }, { n: 6, rng: mulberry32(1) });
  assert.ok(!typed.some((q) => /^pigeon pose/i.test(q.q)), 'does not re-search a pose the user already typed');
  assert.deepEqual(expandQueries([], f, { n: 3 }), []);
});
