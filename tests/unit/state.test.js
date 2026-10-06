import test from 'node:test';
import assert from 'node:assert/strict';
import { SUGGESTIONS } from '../../data/suggestions.js';
import { ANALYSIS_VERSION } from '../../js/analyze.js';
import {
  SCHEMA, emptyState, freshState, loadState, splitState, migrateProfile, fromLegacyV1, applyDiscovery, logSession, blockVideo, unblockVideo,
  addToLibrary, removeFromLibrary, toggleLibrary, updateLibraryItem, allTags, inLibrary, addManualVideo, importRecords, applyPlayerInfo,
  mergeImport, trimIndex, exportData, followChannel, unfollowChannel, deleteSession, reindexAll, saveSearch, deleteSavedSearch,
} from '../../js/state.js';

test('a fresh install has an EMPTY library; the starter videos are suggestions in the index', () => {
  const s = freshState();
  assert.deepEqual(s.library, {});
  assert.equal(Object.keys(s.videos).length, SUGGESTIONS.length);
  assert.ok(Object.values(s.videos).every((v) => v.source === 'suggestion' && v.verified === false && v.profile));
  assert.ok(s.videos['zPzSkLHp9ws'].profile.areas.calves > 0.7); // "Calves and Shins" title is understood
  assert.equal(s.schema, SCHEMA);
});

test('the profile (precious) and the index (rebuildable) are separate documents', () => {
  const s = freshState();
  addToLibrary(s, 'zPzSkLHp9ws', { tags: ['a'] });
  const { profile, index } = splitState(s);
  assert.deepEqual(Object.keys(profile).sort(), ['app', 'blocked', 'blockedChannels', 'favoriteChannels', 'following', 'history', 'library', 'prefs', 'savedSearches', 'schema', 'strength']);
  assert.ok(!('videos' in profile) && 'videos' in index);
  assert.ok(profile.library.zPzSkLHp9ws.snapshot.title, 'library keeps a snapshot so it survives losing the index');
  assert.ok(!JSON.stringify(profile).includes('apiKey'));
});

test('round trip: split -> load gives the same data back, and nothing needs saving', () => {
  const s = freshState();
  addToLibrary(s, 'zPzSkLHp9ws'); logSession(s, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'much' } });
  const { profile, index } = JSON.parse(JSON.stringify(splitState(s)));
  const r = loadState({ profile, index });
  assert.equal(r.changed, false);
  assert.equal(r.readOnly, false);
  assert.deepEqual(r.state.library, s.library);
  assert.deepEqual(r.state.history, s.history);
  assert.equal(Object.keys(r.state.videos).length, Object.keys(s.videos).length);
});

test('losing the index loses nothing that matters: library + history videos come back as stubs, suggestions re-seed', () => {
  const s = freshState();
  s.videos.ABCDEFGHIJK = { id: 'ABCDEFGHIJK', title: 'My hip routine', channel: 'Me', durationSec: 600, source: 'manual' };
  addToLibrary(s, 'ABCDEFGHIJK');
  logSession(s, { videoId: 'ABCDEFGHIJK', ratings: { glutes: 'much' } });
  const { profile } = JSON.parse(JSON.stringify(splitState(s)));
  const r = loadState({ profile, index: null });     // index.json deleted
  assert.equal(r.state.videos.ABCDEFGHIJK.title, 'My hip routine');
  assert.equal(r.state.videos.ABCDEFGHIJK.source, 'restored');
  assert.equal(r.state.history.length, 1);
  assert.equal(Object.values(r.state.videos).filter((v) => v.source === 'suggestion').length, SUGGESTIONS.length);
  assert.equal(r.changed, true, 'should be saved again');
});

test('v1 -> v2 migration: saved, done and hand-added videos become the library; discovered stay out; nothing is lost', () => {
  const legacy = {
    version: 1, starterVersion: 1,
    videos: {
      SAVEDSAVED1: { id: 'SAVEDSAVED1', title: 'Saved one', channel: 'A', source: 'search', durationSec: 600 },
      DONEDONE111: { id: 'DONEDONE111', title: 'Done one', channel: 'B', source: 'search', durationSec: 700 },
      MANUALMAN11: { id: 'MANUALMAN11', title: 'Pasted one', source: 'manual' },
      FOUNDONLY11: { id: 'FOUNDONLY11', title: 'Just found', source: 'search' },
      zPzSkLHp9ws: { id: 'zPzSkLHp9ws', title: 'Calves', source: 'starter', verified: false },
    },
    channels: { c1: { id: 'c1', name: 'A' } }, queryLog: { 'yoga hips': { count: 2 } }, quota: { day: '2026-10-05', used: 300 },
    saved: ['SAVEDSAVED1'], blocked: ['BLOCKED1111'],
    history: [{ id: 'h1', at: '2026-10-01T10:00:00Z', date: '2026-10-01', videoId: 'DONEDONE111', ratings: { glutes: 'much' } }],
    prefs: { adventure: 0.8, trusted: ['X'] },
  };
  const r = loadState({ legacy: JSON.parse(JSON.stringify(legacy)) });
  const s = r.state;
  assert.deepEqual(Object.keys(s.library).sort(), ['DONEDONE111', 'MANUALMAN11', 'SAVEDSAVED1']);
  assert.ok(!('FOUNDONLY11' in s.library), 'merely discovered videos are not in the library');
  assert.ok(!('zPzSkLHp9ws' in s.library), 'neither are suggestions');
  assert.ok(s.videos.FOUNDONLY11 && s.videos.DONEDONE111, 'the index keeps them');
  assert.equal(s.videos.zPzSkLHp9ws.source, 'suggestion');
  assert.equal(s.history[0].title, 'Done one', 'history gained a snapshot');
  assert.equal(s.library.SAVEDSAVED1.snapshot.title, 'Saved one');
  assert.deepEqual(s.blocked, ['BLOCKED1111']);
  assert.equal(s.prefs.adventure, 0.8); assert.equal(s.prefs.autoLibrary, false); assert.deepEqual(s.prefs.trusted, ['X']);
  assert.equal(s.queryLog['yoga hips'].count, 2); assert.equal(s.quota.used, 300);
  assert.equal(r.changed, true); assert.ok(r.notes.some((n) => /Upgraded/.test(n)));
  assert.ok(s.analysisVersion === ANALYSIS_VERSION, 'and was re-indexed under the current analysis');
});

test('data from a NEWER version is loaded read-only and never rewritten or downgraded', () => {
  const profile = { app: 'unfurl', schema: SCHEMA + 1, library: { A1234567890: { addedAt: 1, tags: [], note: 'future' } }, history: [], blocked: [], prefs: { weirdFutureThing: true } };
  const r = loadState({ profile, index: { schema: SCHEMA + 1, videos: {}, suggestionsVersion: 99 } });
  assert.equal(r.readOnly, true);
  assert.equal(r.changed, false);
  assert.match(r.notes[0], /newer version/);
  assert.equal(r.state.library.A1234567890.note, 'future');
  assert.equal(Object.keys(r.state.videos).length, 1, 'no suggestions seeded into read-only data; only a stub for the library item');
});

test('migrateProfile runs the chain of upgrade steps in order and refuses to guess', () => {
  const steps = {
    2: (d) => ({ ...d, schema: 3, renamed: d.old, old: undefined }),
    3: (d) => ({ ...d, schema: 4, extra: 'x' }),
  };
  const out = migrateProfile({ schema: 2, old: 'v' }, 4, steps);
  assert.deepEqual([out.schema, out.renamed, out.extra], [4, 'v', 'x']);
  assert.throws(() => migrateProfile({ schema: 2 }, 5, steps), /No upgrade path/);
  assert.equal(migrateProfile({ schema: 4, k: 1 }, 4, steps).k, 1, 'already current: untouched');
  const input = { schema: 2, old: 'v' }; migrateProfile(input, 3, steps); assert.equal(input.schema, 2, 'input not mutated');
});

test('an index from an incompatible schema is discarded and rebuilt; the profile is kept', () => {
  const s = freshState(); addToLibrary(s, 'zPzSkLHp9ws');
  const { profile, index } = JSON.parse(JSON.stringify(splitState(s)));
  index.schema = SCHEMA - 1; index.videos = { JUNKJUNK111: { id: 'JUNKJUNK111' } };
  const r = loadState({ profile, index });
  assert.ok(!r.state.videos.JUNKJUNK111);
  assert.ok(r.state.library.zPzSkLHp9ws);
  assert.equal(r.changed, true);
});

test('when the analysis version changes, everything is re-analysed from the stored raw text and comments', () => {
  const s = freshState();
  s.videos.RAWRAWRAW11 = { id: 'RAWRAWRAW11', title: 'Yoga flow', description: 'Includes pigeon pose', source: 'search',
    comments: Array.from({ length: 6 }, () => ({ t: 'My piriformis and glutes feel so much better, thanks!', l: 3 })),
    profile: { areas: { neck: 0.9 }, sources: {}, poses: [] } };   // a stale, wrong profile from an "older analysis"
  s.analysisVersion = ANALYSIS_VERSION - 1;
  const { profile, index } = JSON.parse(JSON.stringify(splitState(s)));
  const r = loadState({ profile, index });
  const v = r.state.videos.RAWRAWRAW11;
  assert.equal(r.changed, true);
  assert.equal(r.state.analysisVersion, ANALYSIS_VERSION);
  assert.ok(v.profile.areas.glutes > 0.5 && !(v.profile.areas.neck > 0.5), JSON.stringify(v.profile.areas));
  assert.ok(v.evidence.n >= 6, 're-derived from the stored comment sample');
  // and on demand
  assert.equal(reindexAll(r.state), true);
});

test('v1 data without raw comments still re-indexes (falls back to the saved evidence)', () => {
  const s = freshState();
  s.videos.OLDOLDOLD11 = { id: 'OLDOLDOLD11', title: 'Hips', evidence: { n: 9, positive: 8, negative: 0, mentions: { glutes: { n: 6, pos: 6, neg: 0 } }, quotes: [], benefits: {}, posesMentioned: {}, pace: {}, sentiment: 0.5 } };
  reindexAll(s);
  assert.ok(s.videos.OLDOLDOLD11.profile.sources.comments.glutes > 0.5);
});

test('library rules: add / remove / toggle / tags / notes', () => {
  const s = freshState();
  assert.equal(inLibrary(s, 'zPzSkLHp9ws'), false);
  assert.equal(toggleLibrary(s, 'zPzSkLHp9ws'), true);
  assert.equal(inLibrary(s, 'zPzSkLHp9ws'), true);
  updateLibraryItem(s, 'zPzSkLHp9ws', { tags: [' Morning ', 'morning', 'before run', ''], note: 'x'.repeat(900) });
  assert.deepEqual(s.library.zPzSkLHp9ws.tags, ['morning', 'before run']);
  assert.equal(s.library.zPzSkLHp9ws.note.length, 500);
  assert.deepEqual(allTags(s), ['before run', 'morning']);
  assert.equal(updateLibraryItem(s, 'NOTINLIB111', { note: 'x' }), null);
  assert.equal(toggleLibrary(s, 'zPzSkLHp9ws'), false);
  assert.deepEqual(s.library, {});
});

test('doing a routine adds it to the library; "never show again" removes and blocks it', () => {
  const s = freshState();
  const h = logSession(s, { videoId: 'zPzSkLHp9ws', areas: [{ id: 'calves', mode: 'tight' }], ratings: { calves: 'much' }, intensity: 'right', repeat: 'yes', note: 'x'.repeat(900) });
  assert.ok(inLibrary(s, 'zPzSkLHp9ws'));
  assert.equal(h.note.length, 500);
  assert.match(h.title, /Calves/);
  logSession(s, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'none' }, repeat: 'no' });
  assert.deepEqual(s.blocked, ['zPzSkLHp9ws']);
  assert.ok(!inLibrary(s, 'zPzSkLHp9ws'));
  blockVideo(s, 'zPzSkLHp9ws'); assert.equal(s.blocked.length, 1);
  unblockVideo(s, 'zPzSkLHp9ws'); assert.deepEqual(s.blocked, []);
  deleteSession(s, h.id); assert.equal(s.history.length, 1);
});

test('searches add to the index but not the library — unless "auto-add" is on', () => {
  const rec = (id) => ({ id, title: 'Hip stretch', profile: {}, source: 'search' });
  const s = freshState();
  const added = applyDiscovery(s, { records: [rec('NEWNEWNEW01'), rec('NEWNEWNEW02')], channels: { c1: { id: 'c1', name: 'C', subscribers: 5 } }, queryUpdates: { 'q a': { count: 1 } } });
  assert.equal(added, 2);
  assert.ok(s.videos.NEWNEWNEW01 && !inLibrary(s, 'NEWNEWNEW01'));
  assert.equal(s.channels.c1.subscribers, 5); assert.equal(s.queryLog['q a'].count, 1);
  s.prefs.autoLibrary = true;
  applyDiscovery(s, { records: [rec('NEWNEWNEW03')], channels: {}, queryUpdates: {} });
  assert.ok(inLibrary(s, 'NEWNEWNEW03') && !inLibrary(s, 'NEWNEWNEW01'), 'only newly found ones, from now on');
});

test('applyDiscovery keeps provenance and your earlier comment analysis', () => {
  const s = freshState();
  s.videos['zPzSkLHp9ws'].evidence = { n: 9 };
  applyDiscovery(s, { records: [{ id: 'zPzSkLHp9ws', title: 'Real title', channel: 'Real Channel', description: 'd'.repeat(2000), durationSec: 600, verified: true, source: 'search', profile: { areas: {} } }], channels: {}, queryUpdates: {} });
  const v = s.videos['zPzSkLHp9ws'];
  assert.equal(v.source, 'suggestion'); assert.equal(v.title, 'Real title'); assert.deepEqual(v.evidence, { n: 9 });
  assert.equal(v.description.length, 2000, 'raw text is kept for future re-indexing');
});

test('pasted links go to the library; imports go to the library only on request', () => {
  const s = freshState();
  const v = addManualVideo(s, { id: 'MANUALVID01', title: 'Yoga for Tight Hips', channel: '' });
  assert.equal(v.source, 'manual'); assert.ok(v.profile.areas.hip_flexors > 0.5); assert.ok(inLibrary(s, 'MANUALVID01'));
  assert.equal(importRecords(s, [{ id: 'IMPORTED001', title: 'x', profile: {} }, { id: 'IMPORTED002', title: 'y', profile: {} }]), 2);
  assert.ok(!inLibrary(s, 'IMPORTED001'));
  importRecords(s, [{ id: 'IMPORTED003', title: 'z', profile: {} }], { toLibrary: true });
  assert.ok(inLibrary(s, 'IMPORTED003'));
});

test('applyPlayerInfo corrects guessed lengths and refreshes the library snapshot', () => {
  const s = freshState();
  addToLibrary(s, 'zPzSkLHp9ws');
  assert.equal(s.videos.zPzSkLHp9ws.durationApprox, true);
  applyPlayerInfo(s, 'zPzSkLHp9ws', { duration: 612 });
  assert.equal(s.videos.zPzSkLHp9ws.durationSec, 612); assert.equal(s.videos.zPzSkLHp9ws.durationApprox, false);
  assert.equal(s.library.zPzSkLHp9ws.snapshot.durationSec, 612);
  assert.equal(applyPlayerInfo(s, 'nope', { duration: 1 }), null);
});

test('following teachers', () => {
  const s = freshState();
  assert.equal(followChannel(s, { channelId: 'UC1', name: 'T' }), true);
  assert.equal(followChannel(s, { channelId: 'UC1', name: 'T' }), false);
  assert.equal(followChannel(s, { name: 'no id' }), false);
  unfollowChannel(s, 'UC1'); assert.deepEqual(s.following, []);
});

test('export/import: complete, never contains the key, merges without duplicating or losing', () => {
  const a = freshState(), b = freshState();
  addToLibrary(b, 'zPzSkLHp9ws', { tags: ['x'] }); const h = logSession(b, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'much' } });
  blockVideo(b, 'BLOCKED1111'); followChannel(b, { channelId: 'UC1', name: 'T' });
  addToLibrary(a, 'zPzSkLHp9ws', { tags: ['y'] });
  const text = exportData(b);
  assert.ok(!/apiKey/i.test(text));
  mergeImport(a, JSON.parse(text)); mergeImport(a, JSON.parse(text));
  assert.equal(a.history.length, 1); assert.equal(a.history[0].id, h.id);
  assert.deepEqual(a.library.zPzSkLHp9ws.tags.sort(), ['x', 'y']);
  assert.deepEqual(a.blocked, ['BLOCKED1111']); assert.equal(a.following.length, 1);
});

test('a backup made by version 1 can still be imported', () => {
  const s = freshState();
  mergeImport(s, { app: 'unfurl', version: 1, videos: { OLDVIDEO111: { id: 'OLDVIDEO111', title: 'Old', source: 'manual' } }, history: [], saved: ['OLDVIDEO111'], blocked: [] });
  assert.ok(inLibrary(s, 'OLDVIDEO111'));
});

test('trimIndex never drops library, history or suggestion videos', () => {
  const s = emptyState();
  for (let i = 0; i < 30; i++) s.videos[`V${String(i).padStart(10, '0')}`] = { id: `V${i}`, views: 1000, likes: i, source: 'search' };
  s.videos.SUGGESTED01 = { id: 'SUGGESTED01', views: 1, likes: 0, source: 'suggestion' };
  addToLibrary(s, 'V0000000000'); s.history.push({ videoId: 'V0000000001' });
  trimIndex(s, 10);
  assert.equal(Object.keys(s.videos).length, 10);
  assert.ok(s.videos.V0000000000 && s.videos.V0000000001 && s.videos.SUGGESTED01);
});

test('fromLegacyV1 tolerates junk', () => {
  const { profile, index } = fromLegacyV1({ videos: { X: null, Y: { id: 'Y' } }, history: [{ videoId: 'Y' }] });
  assert.ok(index.videos.Y && !index.videos.X);
  assert.ok(profile.library.Y);
});

test('saved searches: named, replaceable, bounded, persisted in the profile, merged on import', () => {
  const s = freshState();
  assert.equal(saveSearch(s, { name: 'x' }), null, 'nothing to save');
  assert.equal(saveSearch(s, { name: '  ', q: 'hips' }), null, 'needs a name');
  const a = saveSearch(s, { name: 'Desk reset', q: 'neck -yin len:<15', area: 'neck', tab: 'mine' });
  assert.equal(s.savedSearches.length, 1);
  saveSearch(s, { name: 'desk RESET', q: 'different' });
  assert.equal(s.savedSearches.length, 1, 'same name (any case) replaces');
  assert.equal(s.savedSearches[0].q, 'different');
  for (let i = 0; i < 30; i++) saveSearch(s, { name: `s${i}`, q: `q${i}` });
  assert.equal(s.savedSearches.length, 20, 'bounded');
  const { profile, index } = JSON.parse(JSON.stringify(splitState(s)));
  assert.equal(loadState({ profile, index }).state.savedSearches.length, 20, 'survives save + load');
  deleteSavedSearch(s, s.savedSearches[0].id); assert.equal(s.savedSearches.length, 19);
  const t = freshState(); mergeImport(t, JSON.parse(exportData(s)));
  assert.equal(t.savedSearches.length, 19);
  mergeImport(t, JSON.parse(exportData(s)));
  assert.equal(t.savedSearches.length, 19, 'import is idempotent');
  void a;
});

test('profiles written before saved searches existed still load (additive keys need no migration)', () => {
  const s = freshState();
  const { profile, index } = JSON.parse(JSON.stringify(splitState(s)));
  delete profile.savedSearches;
  const r = loadState({ profile, index });
  assert.deepEqual(r.state.savedSearches, []);
  assert.equal(r.readOnly, false);
});
