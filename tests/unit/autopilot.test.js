// The quota sweep (js/autopilot.js): what is worth doing, and a whole run against the fake YouTube: it spends what is left, in turns,
// never touches the reserve, stops when told to, and says why it stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ctx, quotaInfo } from '../../js/ctx.js';
import { freshState, addToLibrary } from '../../js/state.js';
import { analyzeVideoText } from '../../js/analyze.js';
import { quotaDay } from '../../js/youtube.js';
import { channelsToRead, thinAreas, runAutopilot, sweepSummary } from '../../js/autopilot.js';
import { handle as fakeApi, fault, VIDEOS, chId } from '../helpers/fake-youtube.js';

const CALM = chId('Calm Hips Studio'), TINY = chId('Tiny Yoga Room');

/** A fetch that answers the YouTube API from the fake, and the app's own AI routes from `ai`. */
function net({ ai = null } = {}) {
  const calls = { gen: 0 };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://www.googleapis.com/youtube/v3')) { const { status, body } = fakeApi(u); return { ok: status < 400, status, json: async () => body }; }
    if (u.includes('/api/gemini/status')) return { ok: true, status: 200, json: async () => ai ?? { ready: false } };
    if (u.includes('/api/gemini/generate')) { calls.gen++; return { ok: true, status: 200, json: async () => ({ ok: true, model: 'gemini-test', sources: [], queries: [], text: JSON.stringify({ summary: 'ok', kind: { id: 'yoga', confidence: 0.7, evidence: ['x'] }, level: 'beginner', pace: 'slow', props: [], areas: { hip_flexors: 0.9 }, sections: [{ t: 0, label: 'Intro' }, { t: 60, label: 'Lunge' }, { t: 180, label: 'Pigeon pose' }], cautions: [] }) }) }; }
    throw new Error(`unexpected request ${u} ${init?.method ?? ''}`);
  };
  return calls;
}
function setup({ used = 0, key = 'TESTKEY', library = [], favourites = [], following = [], thorough = 'quick' } = {}) {
  const state = freshState();
  state.prefs.thoroughness = thorough;
  state.quota = { day: quotaDay(), used };
  for (const v of VIDEOS.filter((x) => library.includes(x.id))) {
    const rec = { id: v.id, title: v.topic === 'hips' ? 'Hip opener flow' : 'Morning stretch', channel: v.channel, channelId: v.channelId, description: 'a stretch', tags: [], durationSec: 600, verified: true, source: 'search', embeddable: true };
    state.videos[v.id] = { ...rec, profile: analyzeVideoText(rec) };
    addToLibrary(state, v.id);
  }
  state.favoriteChannels = favourites; state.following = following;
  ctx.store = { state, config: { apiKey: key }, server: { ytProxy: false }, save() {} };
  ctx.ui.filters = { areas: [], minMin: 10, maxMin: 25, styles: [], hints: [], terms: [], source: 'all', voice: '' };
  fault.quota = false; fault.calls.length = 0; fault.pageSize = 5;
  return state;
}
const fromCalm = VIDEOS.filter((v) => v.channelId === CALM).slice(0, 3).map((v) => v.id);

// ---------------------------------------------------------------- what is worth doing

test('channels worth reading more of: favourites, followed and library channels, best first; only with a known id; each read to 150 and maybe once to 500', () => {
  const state = setup({ library: fromCalm, favourites: [{ key: 'tiny yoga room', name: 'Tiny Yoga Room' }], following: [{ channelId: chId('Big Channel Yoga'), name: 'Big Channel Yoga' }] });
  state.videos[VIDEOS.find((v) => v.channelId === TINY).id] = { id: 'tinyvid0001', title: 'x', channel: 'Tiny Yoga Room', channelId: TINY };   // how a name-only favourite finds its id
  const list = channelsToRead(state);
  assert.deepEqual(list.map((c) => c.id), [TINY, chId('Big Channel Yoga'), CALM], 'a favourite, then followed, then the library channel');
  assert.ok(list.every((c) => c.max === 150));
  assert.match(list[0].why, /favourite/); assert.match(list[2].why, /3 in your library/);
  assert.deepEqual(channelsToRead(setup({ favourites: [{ key: 'nobody', name: 'Nobody Known' }] })), [], 'a name with no known channel id would cost a search: left alone');
  state.channels[TINY] = { id: TINY, name: 'Tiny Yoga Room', swept: { at: 1, max: 150, got: 148 } };
  assert.equal(channelsToRead(state).find((c) => c.id === TINY).max, 500, 'a full 150 is read once more, to 500');
  state.channels[TINY].swept = { at: 2, max: 500, got: 480 };
  assert.ok(!channelsToRead(state).some((c) => c.id === TINY), 'and then it is done');
  state.channels[CALM] = { id: CALM, name: 'Calm Hips Studio', swept: { at: 1, max: 150, got: 12 } };
  assert.ok(!channelsToRead(state).some((c) => c.id === CALM), 'a channel with only a few videos was read in full: done');
  state.blockedChannels = [{ key: CALM, name: 'Calm Hips Studio', channelId: CALM }]; state.channels[CALM].swept = undefined;
  assert.ok(!channelsToRead(state).some((c) => c.id === CALM), 'a blocked teacher is never read');
  assert.equal(channelsToRead(setup({ library: fromCalm, following: [{ channelId: TINY, name: 'T' }, { channelId: chId('Big Channel Yoga'), name: 'B' }] }), { limit: 1 }).length, 1, 'a limit');
});

test('the thinnest muscle areas, two at a time, rotating', () => {
  const state = setup({ library: fromCalm });
  const a0 = thinAreas(state, 0), a1 = thinAreas(state, 1), a2 = thinAreas(state, 2);
  assert.equal(a0.length, 2);
  assert.ok(![...a0, ...a1, ...a2].includes('full_body'));
  assert.notDeepEqual(a0, a1, 'the next round aims somewhere new');
  assert.deepEqual(thinAreas(state, 0), a0, 'but it is the same every time for the same round (no luck involved)');
});

// ---------------------------------------------------------------- a whole run

test('a run spends what is left in turns, adds videos, reads comments, never touches the reserve, and says what it did', async () => {
  net();
  const state = setup({ used: 9000, library: fromCalm, following: [{ channelId: chId('Big Channel Yoga'), name: 'Big Channel Yoga' }], favourites: [{ key: 'tiny yoga room', name: 'Tiny Yoga Room', channelId: TINY }], thorough: 'quick' });
  const before = Object.keys(state.videos).length;
  const r = await runAutopilot({ reserve: 300, ai: false });
  assert.ok(r.spent > 0 && r.spent <= 700, `spent ${r.spent} of the 700 above the reserve`);
  assert.ok(quotaInfo().left >= 300, `the reserve is untouched: ${quotaInfo().left} left`);
  assert.equal(r.startedLeft - r.left, r.spent);
  assert.ok(Object.keys(state.videos).length > before, 'videos were added');
  assert.ok(r.added > 0 && r.channelsRead >= 1, JSON.stringify(r.steps));
  assert.ok(r.commentsRead > 0, 'comments were read');
  assert.ok(['budget', 'done'].includes(r.stopped), r.stopped);
  const names = r.steps.map((s) => s.name);
  assert.ok(names.includes('Followed teachers') && names.some((n) => n.startsWith('Teacher: ')), names.join(' | '));
  assert.ok(state.channels[TINY]?.swept?.max === 150, 'what was read is remembered, so tomorrow it goes on instead of repeating');
  assert.match(sweepSummary(r), /YouTube units used.*new videos/);
});

test('with a big allowance it goes on through every kind of work, and a second run has less to repeat', async () => {
  net();
  const state = setup({ used: 0, library: fromCalm, favourites: [{ key: 'tiny yoga room', name: 'Tiny Yoga Room', channelId: TINY }], thorough: 'quick' });
  const r1 = await runAutopilot({ reserve: 300, ai: false });
  assert.ok(r1.searches >= 1 && r1.channelsRead >= 1 && r1.commentsRead >= 1, JSON.stringify({ s: r1.searches, c: r1.channelsRead, k: r1.commentsRead }));
  assert.ok(quotaInfo().left >= 300);
  const steps2 = (await runAutopilot({ reserve: 300, ai: false })).steps.map((s) => s.name);
  assert.ok(!steps2.some((n) => n === 'Teacher: Tiny Yoga Room'), 'a teacher read in full is not read again');
  assert.ok(Object.values(state.videos).length >= Object.keys(state.library).length);
});

test('it can be stopped, does nothing when the reserve is already reached, and needs a key', async () => {
  net();
  setup({ used: 0, library: fromCalm });
  const stopped = await runAutopilot({ reserve: 300, ai: false, shouldStop: () => true });
  assert.deepEqual([stopped.spent, stopped.stopped], [0, 'you']);
  setup({ used: 9800, library: fromCalm });
  const none = await runAutopilot({ reserve: 300, ai: false });
  assert.deepEqual([none.spent, none.stopped, none.steps.length], [0, 'budget', 0], 'less than the reserve is left: nothing is spent');
  setup({ key: '', library: fromCalm });
  const nokey = await runAutopilot({ reserve: 300, ai: false });
  assert.deepEqual([nokey.stopped, nokey.spent], ['no_key', 0]);
  assert.match(sweepSummary(nokey), /no YouTube key/);
});

test('YouTube saying the day’s allowance is gone stops the run with that reason', async () => {
  net();
  setup({ used: 0, library: fromCalm, favourites: [{ key: 'tiny yoga room', name: 'Tiny Yoga Room', channelId: TINY }] });
  fault.quota = true;
  const r = await runAutopilot({ reserve: 300, ai: false });
  assert.equal(r.stopped, 'quota'); assert.ok(r.notes.some((n) => /allowance/.test(n)));
});

test('time is limited too', async () => {
  net();
  setup({ used: 0, library: fromCalm, favourites: [{ key: 'tiny yoga room', name: 'Tiny Yoga Room', channelId: TINY }] });
  let t = 0;
  const r = await runAutopilot({ reserve: 300, ai: false, maxMs: 1000, clock: () => (t += 600) });
  assert.equal(r.stopped, 'time');
});

test('the AI helper gets the rest of its own allowance: a few videos watched, never more than it has left', async () => {
  const calls = net({ ai: { ready: true, dailyCap: 5, usedToday: 0 } });
  const state = setup({ used: 9800, library: fromCalm });   // (no YouTube allowance left: only the AI part runs)
  const r = await runAutopilot({ reserve: 300, ai: true });
  assert.equal(calls.gen, 3, 'five requests a day, two kept back, three left: three videos watched');
  assert.equal(r.aiRead, 3);
  assert.ok(fromCalm.every((id) => state.videos[id].ai?.sections?.length === 3), 'and kept with the videos');
  assert.ok(r.steps.some((s) => s.name === 'Gemini watched videos'));
  const none = net({ ai: { ready: true, dailyCap: 5, usedToday: 4 } });
  setup({ used: 9800, library: fromCalm });
  assert.equal((await runAutopilot({ reserve: 300, ai: true })).aiRead, 0); assert.equal(none.gen, 0, 'allowance used up: not asked');
  const off = net({ ai: { ready: true, dailyCap: 60, usedToday: 0 } });
  setup({ used: 9800, library: fromCalm });
  await runAutopilot({ reserve: 300, ai: false }); assert.equal(off.gen, 0, 'switched off: not asked');
  const unready = net({ ai: { ready: false } });
  setup({ used: 9800, library: fromCalm });
  assert.equal((await runAutopilot({ reserve: 300, ai: true })).aiRead, 0); assert.equal(unready.gen, 0);
});
