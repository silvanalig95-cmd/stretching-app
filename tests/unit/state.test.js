import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_VIDEOS } from '../../data/starter.js';
import {
  emptyState, normalizeState, applyDiscovery, logSession, blockVideo, unblockVideo, toggleSaved, deleteSession,
  addManualVideo, applyPlayerInfo, mergeImport, trimLibrary, exportData,
} from '../../js/state.js';

test('a fresh state contains the starter shelf, each video already analysed', () => {
  const s = normalizeState(null);
  assert.equal(Object.keys(s.videos).length, STARTER_VIDEOS.length);
  assert.ok(Object.values(s.videos).every((v) => v.profile && v.verified === false && v.source === 'starter'));
  assert.ok(s.videos['zPzSkLHp9ws'].profile.areas.calves > 0.7); // "Calves and Shins" title
});

test('normalizeState repairs damaged or old data and is idempotent', () => {
  const s = normalizeState({ videos: { ABCDEFGHIJK: { title: 'Hip stretch' }, bad: null }, history: 'oops', prefs: { adventure: 0.9 }, blocked: null });
  assert.ok(s.videos.ABCDEFGHIJK.profile);
  assert.ok(!('bad' in s.videos));
  assert.deepEqual(s.history, []);
  assert.equal(s.prefs.adventure, 0.9);
  assert.equal(s.prefs.queriesPerRun, 2); // defaults filled in
  const again = normalizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(Object.keys(again.videos).length, Object.keys(s.videos).length);
});

test('logging a session; "No, never again" blocks the video', () => {
  const s = normalizeState(null);
  const h = logSession(s, { videoId: 'zPzSkLHp9ws', areas: [{ id: 'calves', mode: 'tight' }], ratings: { calves: 'much' }, intensity: 'right', repeat: 'yes', note: 'x'.repeat(900) });
  assert.equal(s.history.length, 1);
  assert.equal(h.note.length, 500);
  assert.deepEqual(s.blocked, []);
  logSession(s, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'none' }, repeat: 'no' });
  assert.deepEqual(s.blocked, ['zPzSkLHp9ws']);
  blockVideo(s, 'zPzSkLHp9ws'); assert.equal(s.blocked.length, 1); // no duplicates
  unblockVideo(s, 'zPzSkLHp9ws'); assert.deepEqual(s.blocked, []);
  assert.equal(toggleSaved(s, 'a'), true); assert.equal(toggleSaved(s, 'a'), false);
  deleteSession(s, h.id); assert.equal(s.history.length, 1);
});

test('applyDiscovery merges without losing your own data, and slims long descriptions', () => {
  const s = normalizeState(null);
  s.videos['zPzSkLHp9ws'].evidence = { n: 9 };
  const rec = { id: 'zPzSkLHp9ws', title: 'Real title', channel: 'Real Channel', description: 'd'.repeat(4000), durationSec: 600, verified: true, source: 'search', profile: { areas: {} } };
  const added = applyDiscovery(s, { records: [rec, { id: 'NEWVIDEO123', title: 'New', profile: {}, source: 'search' }], channels: { c1: { id: 'c1', name: 'C', subscribers: 5 } }, queryUpdates: { 'q a': { count: 1 } } });
  assert.equal(added, 1);
  assert.equal(s.videos['zPzSkLHp9ws'].source, 'starter', 'provenance kept');
  assert.equal(s.videos['zPzSkLHp9ws'].title, 'Real title');
  assert.deepEqual(s.videos['zPzSkLHp9ws'].evidence, { n: 9 }, 'earlier comment analysis kept');
  assert.equal(s.videos['zPzSkLHp9ws'].description.length, 600);
  assert.equal(s.channels.c1.subscribers, 5);
  assert.equal(s.queryLog['q a'].count, 1);
});

test('addManualVideo (pasted link) and applyPlayerInfo (what the player reports)', () => {
  const s = normalizeState(null);
  const v = addManualVideo(s, { id: 'MANUALVID01', title: 'Yoga for Tight Hips', channel: '' });
  assert.equal(v.source, 'manual'); assert.ok(v.profile.areas.hip_flexors > 0.5); assert.equal(v.durationSec, undefined);
  const changed = applyPlayerInfo(s, 'MANUALVID01', { duration: 754.2, title: 'Yoga for Tight Hips', author: 'Some Teacher' });
  assert.equal(changed.durationSec, 754); assert.equal(changed.channel, 'Some Teacher');
  // starter: approximate length gets replaced by the real one
  const st = s.videos['zPzSkLHp9ws'];
  assert.equal(st.durationApprox, true);
  applyPlayerInfo(s, 'zPzSkLHp9ws', { duration: 612 });
  assert.equal(st.durationSec, 612); assert.equal(st.durationApprox, false);
  assert.equal(applyPlayerInfo(s, 'nope', { duration: 1 }), null);
});

test('mergeImport adds sessions once and unions blocks/saves', () => {
  const a = normalizeState(null), b = normalizeState(null);
  const h = logSession(b, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'much' } }); blockVideo(b, 'X'); toggleSaved(b, 'Y');
  mergeImport(a, JSON.parse(exportData(b)));
  mergeImport(a, JSON.parse(exportData(b)));
  assert.equal(a.history.length, 1); assert.equal(a.history[0].id, h.id);
  assert.deepEqual(a.blocked, ['X']); assert.deepEqual(a.saved, ['Y']);
});

test('trimLibrary never drops videos you have done or saved', () => {
  const s = emptyState();
  for (let i = 0; i < 30; i++) s.videos[`V${String(i).padStart(10, '0')}`] = { id: `V${i}`, views: 1000, likes: i };
  s.history.push({ videoId: 'V0000000000' }); s.saved.push('V0000000001');
  trimLibrary(s, 10);
  assert.equal(Object.keys(s.videos).length, 10);
  assert.ok(s.videos['V0000000000'] && s.videos['V0000000001']);
});

test('exportData does not include the API key (it lives in config, not state)', () => {
  const s = normalizeState(null);
  assert.ok(!/apiKey/i.test(exportData(s)));
});
