// Importing a playlist or a teacher always reads what viewers say, and a catch-up reads whatever has none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle as fakeApi, fault, PLAYLIST_VIDEOS, PLAYLIST_ID, VIDEOS } from '../helpers/fake-youtube.js';
import { ctx, importInputs, readMissingComments, missingCommentsCount } from '../../js/ctx.js';
import { freshState, addToLibrary } from '../../js/state.js';
import { readCommentsFor, needsComments, YouTubeClient } from '../../js/youtube.js';

const realFetch = globalThis.fetch;
let calls;
function setup({ key = 'k', state = freshState() } = {}) {
  calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    const { status, body } = fakeApi(u);
    calls.push(new URL(u).pathname.split('/').pop());
    return { ok: status < 400, status, json: async () => body };
  };
  ctx.store = { state, config: { apiKey: key }, server: { ytProxy: false }, save() {} };
  ctx.hooks.renderResults = () => {};
  fault.quota = false;
  return state;
}
test.after(() => { globalThis.fetch = realFetch; fault.quota = false; });

test('importing a playlist reads the viewer comments of every video in it, and says so', async () => {
  const state = setup();
  const r = await importInputs(`https://www.youtube.com/playlist?list=${PLAYLIST_ID}`, {});
  assert.ok(r.imported >= 10, `imported ${r.imported}`);
  const vids = PLAYLIST_VIDEOS.map((id) => state.videos[id]);
  const worthReading = vids.filter((v) => v.commentCount == null || v.commentCount >= 3);
  assert.equal(r.commentsRead, worthReading.length, 'every video that has comments to read was read');
  assert.ok(worthReading.every((v) => Array.isArray(v.comments)), 'and its comment sample is stored');
  assert.ok(vids.filter((v) => v.evidence?.n > 0).length >= 5, 'and the evidence feeds each analysis');
  assert.ok(calls.filter((c) => c === 'commentThreads').length >= r.imported);
});

test('importing a teacher does the same', async () => {
  const state = setup();
  const r = await importInputs('Calm Hips Studio', {});
  const theirs = Object.values(state.videos).filter((v) => v.channel === 'Calm Hips Studio');
  assert.ok(r.imported > 0 && r.commentsRead > 0, JSON.stringify({ i: r.imported, c: r.commentsRead }));
  assert.ok(theirs.every((v) => Array.isArray(v.comments) || v.commentCount < 3), 'all of them read, except any with hardly any comments');
});

test('a long import is capped per press and says how to finish; the catch-up button then reads the rest', async () => {
  const state = setup();
  const ids = VIDEOS.slice(0, 40).map((v) => v.id);
  const client = new YouTubeClient({ key: 'k' });
  // make the videos known first, without comments
  const recs = await client.videos(ids);
  for (const r of recs) state.videos[r.id] = r;
  const need = ids.filter((id) => needsComments(state.videos[id])).length;
  assert.ok(need > 25, `${need} videos need comments`);
  const first = await readCommentsFor({ client, state, ids, max: 15 });
  assert.equal(first.read, 15);
  assert.equal(first.stopped, 'cap');
  assert.equal(first.remaining, need - 15);
  const rest = await readMissingComments({ max: 500 });
  assert.ok(rest.read >= need - 15, `read ${rest.read}`);
  assert.equal(ids.filter((id) => needsComments(state.videos[id])).length, 0, 'nothing is left unread');
  const again = await readMissingComments({});
  assert.equal(again.read, 0, 'and a second press has nothing to do (no wasted quota)');
});

test('the catch-up reads your library first', async () => {
  const state = setup();
  const client = new YouTubeClient({ key: 'k' });
  const ids = VIDEOS.slice(0, 20).map((v) => v.id);
  for (const r of await client.videos(ids)) state.videos[r.id] = r;
  const mine = ids.slice(15);
  for (const id of mine) addToLibrary(state, id);
  await readMissingComments({ max: 5 });
  assert.ok(mine.every((id) => !needsComments(state.videos[id])), 'the five library videos were read, not five arbitrary ones');
});

test('when the day\'s YouTube allowance runs out it stops at once, keeps what it read, and tells the person', async () => {
  const state = setup();
  const client = new YouTubeClient({ key: 'k' });
  const ids = VIDEOS.slice(0, 30).map((v) => v.id);
  for (const r of await client.videos(ids)) state.videos[r.id] = r;
  let n = 0;
  const flaky = { comments: async (id) => { if (++n > 6) { fault.quota = true; } return client.comments(id); } };
  const res = await readCommentsFor({ client: flaky, state, ids, max: 100, concurrency: 1 });
  assert.equal(res.stopped, 'quota');
  assert.ok(res.read >= 6 && res.read < 30, `read ${res.read}`);
  assert.ok(res.remaining > 0);
  fault.quota = false;
});

test('without a key the catch-up explains what is needed, and videos with too few comments are never fetched', async () => {
  setup({ key: '' });
  await assert.rejects(() => readMissingComments({}), /needs a YouTube key/);
  assert.equal(needsComments({ id: 'a', commentCount: 1 }), false);
  assert.equal(needsComments({ id: 'a', commentCount: null }), true);
  assert.equal(needsComments({ id: 'a', commentCount: 40, comments: [] }), false, 'an empty sample means "already looked"');
  assert.equal(needsComments({ id: 'a', commentCount: 40, broken: true }), false);
});
