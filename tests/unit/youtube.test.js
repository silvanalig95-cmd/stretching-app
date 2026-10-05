import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeClient, toApiError, QuotaError, KeyError, CommentsDisabledError, YouTubeError, discover, verifyVideos, fetchOEmbed, quotaDay, quotaUsed, spendQuota, estimateRunCost, THOROUGHNESS } from '../../js/youtube.js';
import { freshState, applyDiscovery, logSession } from '../../js/state.js';
import { mulberry32 } from '../../js/model.js';
import { fakeFetch, fault, VIDEOS } from '../helpers/fake-youtube.js';

const client = (o = {}) => new YouTubeClient({ key: 'k', base: 'http://fake.local/youtube/v3', fetchFn: fakeFetch, ...o });
const reset = () => { fault.quota = false; fault.commentsOff = new Set(); fault.calls.length = 0; };
const hips = { areas: [{ id: 'hip_flexors', mode: 'tight' }, { id: 'glutes', mode: 'tight' }], minMin: 10, maxMin: 30, styles: [] };

test('real API error shapes map to helpful errors', () => {
  const invalid = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }], details: [{ '@type': 'x', reason: 'API_KEY_INVALID' }] } };
  assert.ok(toApiError(400, invalid) instanceof KeyError);
  assert.match(toApiError(400, invalid).message, /API key/);
  assert.ok(toApiError(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }) instanceof QuotaError);
  assert.ok(toApiError(403, { error: { errors: [{ reason: 'commentsDisabled' }] } }) instanceof CommentsDisabledError);
  assert.ok(toApiError(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }) instanceof KeyError);
  assert.ok(toApiError(403, { error: { details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }) instanceof KeyError);
  const other = toApiError(500, null);
  assert.ok(other instanceof YouTubeError && !(other instanceof KeyError));
});

test('search decodes titles and exposes the next page token', async () => {
  reset();
  const r = await client().search({ q: 'hip flexors', order: 'relevance' });
  assert.equal(r.ids.length, 5);
  assert.ok(r.nextPageToken);
  assert.ok(r.items.every((i) => i.id && i.channel && !i.title.includes('&amp;')));
  const page2 = await client().search({ q: 'hip flexors', pageToken: r.nextPageToken });
  assert.equal(page2.ids.filter((id) => r.ids.includes(id)).length, 0, 'page two is new');
});

test('an invalid key raises KeyError; a down network raises a friendly YouTubeError', async () => {
  await assert.rejects(() => new YouTubeClient({ key: 'INVALID', base: 'http://fake.local/youtube/v3', fetchFn: fakeFetch }).search({ q: 'x' }), KeyError);
  await assert.rejects(() => new YouTubeClient({ key: 'k', fetchFn: async () => { throw new Error('offline'); } }).search({ q: 'x' }), /Couldn’t reach YouTube/);
});

test('onSpend counts quota units per endpoint', async () => {
  reset();
  let spent = 0;
  const c = client({ onSpend: (u) => { spent += u; } });
  await c.search({ q: 'hips' }); await c.videos([VIDEOS[0].id]); await c.comments(VIDEOS[0].id); await c.channels([VIDEOS[0].channelId]);
  assert.equal(spent, 100 + 1 + 1 + 1);
});

test('comments: disabled comments give [] rather than an error', async () => {
  reset(); fault.commentsOff.add(VIDEOS[0].id);
  assert.deepEqual(await client().comments(VIDEOS[0].id), []);
  assert.ok((await client().comments(VIDEOS[1].id)).length > 0);
});

test('videos(): maps duration, stats and embeddability', async () => {
  reset();
  const [v] = await client().videos([VIDEOS[0].id]);
  assert.equal(v.durationSec, 15 * 60);
  assert.equal(v.views, 1200000);
  assert.equal(v.embeddable, true);
  assert.equal(v.verified, true);
});

test('discover(): finds new videos, reads comments for the best, and builds profiles', async () => {
  reset();
  const state = freshState();
  const res = await discover({ client: client(), filters: hips, state, rng: mulberry32(11), opts: { queries: 2, commentVideos: 6 } });
  assert.equal(res.report.queries.length, 2);
  assert.ok(res.records.length >= 3, `found ${res.records.length}`);
  assert.ok(res.records.every((r) => r.profile && r.verified && r.source === 'search'));
  const read = res.records.filter((r) => r.evidence);
  assert.ok(read.length > 0 && read.length <= 6, `comments read for ${read.length}`);
  assert.ok(read[0].evidence.n >= 2);
  assert.ok(res.report.commentsRead > 0);
  // best-matching videos got their comments read first
  const hipRec = res.records.find((r) => r.id === 'TESTvid0001');
  if (hipRec?.evidence) assert.ok(hipRec.profile.sources.comments.hip_flexors > 0 || hipRec.profile.sources.comments.glutes > 0);
  // subscriber counts attached (for hidden-gem detection)
  assert.ok(res.records.some((r) => r.subscribers != null));
  // nothing mutated
  assert.equal(Object.keys(state.queryLog).length, 0);
});

test('discover() filters out unusable results (too short, not embeddable, live)', async () => {
  reset();
  const state = freshState();
  const orig = VIDEOS[0].min; VIDEOS[0].min = 1; // a 1-minute "short"
  try {
    const res = await discover({ client: client(), filters: hips, state, rng: mulberry32(11), opts: { queries: 3 } });
    assert.ok(!res.records.some((r) => r.id === VIDEOS[0].id));
  } finally { VIDEOS[0].min = orig; }
});

test('repeated discovery keeps finding NEW videos (queries and result pages rotate)', async () => {
  reset();
  const state = freshState();
  const seen = new Set();
  const queries = new Set();
  let newPerRun = [];
  for (let run = 0; run < 4; run++) {
    const res = await discover({ client: client(), filters: hips, state, rng: mulberry32(50 + run), opts: { queries: 2, commentVideos: 4 } });
    newPerRun.push(applyDiscovery(state, res));
    for (const q of res.report.queries) { assert.ok(!queries.has(q.q) || q.deeper, `repeated query "${q.q}" without going deeper`); queries.add(q.q); }
    for (const r of res.records) seen.add(r.id);
  }
  assert.ok(newPerRun[0] > 0);
  assert.ok(newPerRun.slice(1).some((n) => n > 0), `later runs found something new: ${newPerRun}`);
  assert.ok(Object.keys(state.queryLog).length >= 6);
  assert.ok(Object.values(state.queryLog).some((q) => q.nextPageToken), 'page tokens stored for going deeper');
  assert.ok(Object.keys(state.videos).length > 46, 'library grew beyond the starter set');
});

test('if the allowance runs out on the 2nd search, the 1st search\'s results are still returned with a warning', async () => {
  reset();
  const state = freshState();
  let searches = 0;
  const flaky = new YouTubeClient({ key: 'k', base: 'http://fake.local/youtube/v3', fetchFn: async (u) => {
    if (String(u).includes('/search') && ++searches === 2) {
      return { ok: false, status: 403, json: async () => ({ error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }) };
    }
    return fakeFetch(u);
  } });
  const res = await discover({ client: flaky, filters: hips, state, rng: mulberry32(3), opts: { queries: 2 } });
  assert.equal(res.report.queries.length, 1);
  assert.match(res.report.warnings[0], /allowance is used up/);
  assert.ok(res.records.length > 0);
});

test('if the very first call is over quota, the error says why', async () => {
  reset(); fault.quota = true;
  await assert.rejects(() => discover({ client: client(), filters: hips, state: freshState(), rng: mulberry32(3) }), /allowance is used up/);
  reset();
});

test('comments disabled on some videos does not stop discovery', async () => {
  reset(); VIDEOS.slice(0, 6).forEach((v) => fault.commentsOff.add(v.id));
  const res = await discover({ client: client(), filters: hips, state: freshState(), rng: mulberry32(11), opts: { queries: 2, commentVideos: 10 } });
  assert.ok(res.records.length > 0);
  reset();
});

test('verifyVideos corrects starter metadata and flags videos that no longer exist', async () => {
  reset();
  const real = { id: VIDEOS[0].id, title: 'wrong', channel: '', durationSec: 60, source: 'suggestion', verified: false };
  const gone = { id: 'GONEGONE123', title: 'Deleted video', source: 'suggestion', verified: false };
  const [a, b] = await verifyVideos({ client: client(), videos: [real, gone], readComments: true });
  assert.equal(a.title, VIDEOS[0].title);
  assert.equal(a.durationSec, 900);
  assert.equal(a.source, 'suggestion'); // provenance kept
  assert.equal(a.verified, true);
  assert.ok(a.evidence && a.profile.areas.hip_flexors > 0.5);
  assert.equal(b.broken, true);
});

test('fetchOEmbed: best effort, never throws', async () => {
  assert.deepEqual(await fetchOEmbed('abc', async () => ({ ok: true, json: async () => ({ title: 'T &amp; U', author_name: 'Ann' }) })), { title: 'T & U', channel: 'Ann' });
  assert.equal(await fetchOEmbed('abc', async () => { throw new Error('CORS'); }), null);
  assert.equal(await fetchOEmbed('abc', async () => ({ ok: false })), null);
});

test('quota bookkeeping resets each Pacific day and estimates a run', () => {
  const s = freshState();
  const d1 = new Date('2026-10-05T20:00:00Z'), d2 = new Date('2026-10-06T20:00:00Z');
  spendQuota(s, 300, d1); spendQuota(s, 50, d1);
  assert.equal(quotaUsed(s, d1), 350);
  assert.equal(quotaUsed(s, d2), 0);
  assert.equal(quotaDay(new Date('2026-10-05T03:00:00Z')), '2026-10-04'); // still the previous day in Pacific time
  assert.deepEqual(estimateRunCost('balanced'), { max: THOROUGHNESS.balanced.budget, typical: Math.round(THOROUGHNESS.balanced.budget * 0.45) });
  assert.equal(estimateRunCost('nonsense').max, THOROUGHNESS.balanced.budget, 'unknown names fall back to balanced');
  assert.ok(estimateRunCost('quick').max < estimateRunCost('thorough').max && estimateRunCost('thorough').max < estimateRunCost('exhaustive').max);
});

test('end to end: rate a session, and the next discovery run ranks it using what you told it', async () => {
  reset();
  const state = freshState();
  const res = await discover({ client: client(), filters: hips, state, rng: mulberry32(11), opts: { queries: 3, commentVideos: 8 } });
  applyDiscovery(state, res);
  const done = state.videos['TESTvid0004'] ?? Object.values(state.videos).find((v) => v.source === 'search');
  logSession(state, { videoId: done.id, areas: hips.areas, ratings: { hip_flexors: 'much', glutes: 'much' } });
  assert.equal(state.history.length, 1);
  assert.equal(state.blocked.length, 0);
  logSession(state, { videoId: done.id, areas: hips.areas, ratings: { glutes: 'none' }, repeat: 'no' });
  assert.deepEqual(state.blocked, [done.id]);
});

test('mostly-familiar results make discovery look one page further down (and count the query once)', async () => {
  reset();
  const state = freshState();
  // Pass 1: learn what page one of this query returns, then forget the query log so the same query is generated again.
  const first = await discover({ client: client(), filters: hips, state, rng: mulberry32(77), opts: { queries: 1, commentVideos: 0, extraPages: 0 } });
  applyDiscovery(state, first);
  assert.equal(first.report.queries[0].pages, 1);
  state.queryLog = {};
  // Pass 2: page one is now entirely known, so it should fetch page two and find new videos there.
  const second = await discover({ client: client(), filters: hips, state, rng: mulberry32(77), opts: { queries: 1, commentVideos: 0, extraPages: 1 } });
  assert.equal(second.report.queries[0].q, first.report.queries[0].q, 'same query regenerated');
  assert.equal(second.report.queries[0].pages, 2);
  assert.ok(second.report.queries[0].fresh >= 1, 'page two had new videos');
  const knownBefore = new Set(Object.keys(state.videos));
  assert.ok(second.records.some((r) => !knownBefore.has(r.id)), 'new videos came back');
  const key = Object.keys(second.queryUpdates)[0];
  assert.equal(second.queryUpdates[key].count, 1, 'counted once even though it took two pages');
  assert.ok(second.queryUpdates[key].nextPageToken === null || typeof second.queryUpdates[key].nextPageToken === 'string');
});

test('extraPages: 0 never fetches a second page', async () => {
  reset();
  const state = freshState();
  const res = await discover({ client: client(), filters: hips, state, rng: mulberry32(5), opts: { queries: 2, commentVideos: 0, extraPages: 0 } });
  assert.ok(res.report.queries.every((q) => q.pages === 1));
  assert.equal(fault.calls.filter((c) => c.endpoint === 'search').length, 2);
});

test('across many seeds, repeated searches keep adding new videos and never repeat a query without going deeper', async () => {
  reset();
  const filters = { areas: [{ id: 'hip_flexors', mode: 'tight' }, { id: 'glutes', mode: 'tight' }, { id: 'adductors', mode: 'tight' }], minMin: 10, maxMin: 30, styles: [] };
  let grew = 0, seeds = 60, repeats = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const state = freshState();
    const seen = new Set();
    let sizeAfterTwo = 0;
    for (let run = 0; run < 4; run++) {
      const res = await discover({ client: client(), filters, state, rng: mulberry32(seed * 1000 + run), opts: { queries: 2, commentVideos: 3 } });
      applyDiscovery(state, res);
      for (const q of res.report.queries) { if (seen.has(q.q) && !q.deeper) repeats++; seen.add(q.q); }
      if (run === 1) sizeAfterTwo = Object.keys(state.videos).length;
    }
    if (Object.keys(state.videos).length > sizeAfterTwo) grew++;
  }
  assert.equal(repeats, 0, 'no query repeated without going deeper');
  assert.ok(grew / seeds >= 0.95, `runs 3-4 found new videos in ${grew}/${seeds} seeds`);
});
