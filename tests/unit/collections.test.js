// Collections: your own groups of library videos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, loadState, splitState, mergeImport, createCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection, moveInCollection, collectionsOf, removeFromLibrary, inLibrary, MAX_COLLECTIONS } from '../../js/state.js';
import { rankCandidates, buildModel } from '../../js/model.js';

const ids = (s) => Object.keys(s.videos).slice(0, 5);

test('make, rename and delete collections; names are cleaned, unique and limited', () => {
  const s = freshState();
  const a = createCollection(s, '  Morning   stretch  ');
  assert.equal(a.name, 'Morning stretch');
  assert.equal(createCollection(s, 'morning STRETCH'), a, 'the same name (any case) is the same collection');
  assert.equal(createCollection(s, '   '), null);
  assert.equal(createCollection(s, 'x'.repeat(100)).name.length, 40);
  const b = createCollection(s, 'Desk');
  assert.equal(renameCollection(s, b.id, 'After a run'), true);
  assert.equal(renameCollection(s, b.id, 'morning stretch'), false, 'a name another collection has');
  assert.equal(renameCollection(s, b.id, ''), false);
  deleteCollection(s, b.id);
  assert.deepEqual(s.collections.map((c) => c.name), ['Morning stretch', 'x'.repeat(40)]);
  const t = freshState();
  for (let i = 0; i < MAX_COLLECTIONS + 5; i++) createCollection(t, `c${i}`);
  assert.equal(t.collections.length, MAX_COLLECTIONS);
});

test('putting a video in a collection keeps it in the library; taking it out of the library takes it out of them', () => {
  const s = freshState();
  const [v1, v2] = ids(s);
  const c = createCollection(s, 'Morning');
  assert.equal(inLibrary(s, v1), false);
  assert.equal(addToCollection(s, c.id, v1), true);
  assert.equal(inLibrary(s, v1), true, 'added to the library too');
  addToCollection(s, c.id, v1);
  assert.deepEqual(c.videoIds, [v1], 'once only');
  assert.equal(addToCollection(s, c.id, 'unknownvideo'), false, 'only videos the app knows');
  assert.equal(addToCollection(s, 'nope', v2), false);
  addToCollection(s, c.id, v2);
  const d = createCollection(s, 'Desk'); addToCollection(s, d.id, v1);
  assert.deepEqual(collectionsOf(s, v1).map((x) => x.name), ['Morning', 'Desk'], 'a video can be in several');
  removeFromCollection(s, c.id, v1);
  assert.deepEqual(c.videoIds, [v2]); assert.equal(inLibrary(s, v1), true, 'still in the library');
  removeFromLibrary(s, v2);
  assert.deepEqual(c.videoIds, []);
  removeFromLibrary(s, v1);
  assert.deepEqual(d.videoIds, []);
});

test('the order can be changed', () => {
  const s = freshState();
  const [a, b, c3] = ids(s);
  const c = createCollection(s, 'Flow');
  for (const v of [a, b, c3]) addToCollection(s, c.id, v);
  assert.equal(moveInCollection(s, c.id, c3, -1), true);
  assert.deepEqual(c.videoIds, [a, c3, b]);
  assert.equal(moveInCollection(s, c.id, a, -1), false, 'cannot go before the first');
  assert.equal(moveInCollection(s, c.id, b, 1), false, 'or after the last');
  assert.equal(moveInCollection(s, c.id, 'zzz', 1), false);
});

test('collections are saved in the profile and come back cleaned; junk is dropped', () => {
  const s = freshState();
  const [a, b] = ids(s);
  const c = createCollection(s, 'Morning'); addToCollection(s, c.id, a); addToCollection(s, c.id, b);
  const { profile } = splitState(s);
  assert.equal(profile.collections.length, 1);
  const back = loadState({ profile: JSON.parse(JSON.stringify(profile)) }).state;
  assert.deepEqual(back.collections[0].videoIds, [a, b]);
  const messy = { ...profile, collections: [null, 'x', { id: 5 }, { id: 'ok', name: '  Fine  ', videoIds: ['a', 'a', 3, 'b'] }, { id: 'noname', name: '  ', videoIds: [] }] };
  const cleaned = loadState({ profile: messy }).state.collections;
  assert.equal(cleaned.length, 1);
  assert.deepEqual(cleaned[0], { id: 'ok', name: 'Fine', createdAt: 0, videoIds: ['a', 'b'] });
  assert.deepEqual(loadState({ profile: { ...profile, collections: 'nope' } }).state.collections, []);
});

test('importing a backup merges collections by name and keeps only videos that are in the library', () => {
  const mine = freshState(), theirs = freshState();
  const [a, b, c3] = ids(mine);
  const m = createCollection(mine, 'Morning'); addToCollection(mine, m.id, a);
  const t = createCollection(theirs, 'morning'); addToCollection(theirs, t.id, b); addToCollection(theirs, t.id, c3);
  const u = createCollection(theirs, 'Desk'); addToCollection(theirs, u.id, c3);
  const { profile, index } = splitState(theirs);
  mergeImport(mine, { profile: JSON.parse(JSON.stringify(profile)), index });
  assert.deepEqual(mine.collections.map((c) => c.name).sort(), ['Desk', 'Morning']);
  assert.deepEqual(mine.collections.find((c) => c.name === 'Morning').videoIds.sort(), [a, b, c3].sort());
});

test('a request can be limited to one collection', () => {
  const s = freshState();
  const [a, b, c3] = ids(s);
  const col = createCollection(s, 'Morning'); addToCollection(s, col.id, a); addToCollection(s, col.id, b);
  const filters = { areas: [], minMin: 0, maxMin: 999, styles: [], hints: [], terms: [], source: `collection:${col.id}` };
  const run = (collectionIds) => rankCandidates({ videos: Object.values(s.videos), filters, model: buildModel(s.history, s.videos), libraryIds: new Set(Object.keys(s.library)), collectionIds }).map((r) => r.video.id);
  const only = run(new Set(col.videoIds));
  assert.deepEqual(only.sort(), [a, b].sort());
  assert.ok(!only.includes(c3));
  assert.ok(run(null).length > 2, 'without the limit there are more');
  assert.deepEqual(run(new Set()), [], 'an empty collection offers nothing');
});
