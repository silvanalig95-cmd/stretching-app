import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeClient, parseSourceInput, importSource, refreshFollowed, KeyError, YouTubeError } from '../../js/youtube.js';
import { freshState, importRecords, followChannel, inLibrary } from '../../js/state.js';
import { fakeFetch, fault, VIDEOS, chId, uploadsOf, handleOf, PLAYLIST_ID, PLAYLIST_VIDEOS } from '../helpers/fake-youtube.js';

const client = (o = {}) => new YouTubeClient({ key: 'k', base: 'http://fake.local/youtube/v3', fetchFn: fakeFetch, ...o });
const reset = () => { fault.quota = false; fault.commentsOff = new Set(); fault.calls.length = 0; };
const TINY = 'Tiny Yoga Room';
const tinyIds = VIDEOS.filter((v) => v.channel === TINY).map((v) => v.id);

test('parseSourceInput recognises videos, playlists, channels, handles and plain names', () => {
  const ch = chId(TINY);
  const t = (x) => parseSourceInput(x);
  assert.deepEqual(t('GffXQl3zvUI'), { type: 'video', value: 'GffXQl3zvUI' });
  assert.deepEqual(t('https://youtu.be/GffXQl3zvUI?si=x'), { type: 'video', value: 'GffXQl3zvUI' });
  assert.deepEqual(t('https://www.youtube.com/watch?v=GffXQl3zvUI&list=PLabcdefghijklmnopqrstuvwxyz012345'), { type: 'video', value: 'GffXQl3zvUI' });
  assert.deepEqual(t('https://www.youtube.com/playlist?list=PLabcdefghijklmnopqrstuvwxyz012345'), { type: 'playlist', value: 'PLabcdefghijklmnopqrstuvwxyz012345' });
  assert.deepEqual(t('PLabcdefghijklmnopqrstuvwxyz012345'), { type: 'playlist', value: 'PLabcdefghijklmnopqrstuvwxyz012345' });
  assert.deepEqual(t(`https://www.youtube.com/channel/${ch}`), { type: 'channel', value: ch });
  assert.deepEqual(t(ch), { type: 'channel', value: ch });
  assert.deepEqual(t('https://www.youtube.com/@YogaWithAdriene/videos'), { type: 'handle', value: 'YogaWithAdriene' });
  assert.deepEqual(t('@yogawithadriene'), { type: 'handle', value: 'yogawithadriene' });
  assert.deepEqual(t('https://www.youtube.com/user/someone'), { type: 'username', value: 'someone' });
  assert.deepEqual(t('https://www.youtube.com/c/CustomName'), { type: 'search', value: 'CustomName' });
  assert.deepEqual(t('Yoga With Kassandra'), { type: 'search', value: 'Yoga With Kassandra' });
  assert.equal(t('').type, 'search');
});

test('importing a teacher by channel id fetches their whole upload history, newest first, cheaply', async () => {
  reset();
  let spent = 0;
  const res = await importSource({ client: client({ onSpend: (u) => { spent += u; } }), input: chId(TINY), state: freshState() });
  assert.equal(res.type, 'channel');
  assert.equal(res.title, TINY);
  assert.deepEqual(new Set(res.records.map((r) => r.id)), new Set(tinyIds));
  assert.ok(res.records.every((r) => r.source === 'channel' && r.profile && r.channelId === chId(TINY)));
  assert.ok(res.records.every((r) => r.subscribers === 4200), 'channel size attached');
  assert.ok(spent <= 8, `a full catalogue should cost a handful of units, spent ${spent}`);
  assert.equal(fault.calls.filter((c) => c.endpoint === 'search').length, 0, 'no 100-unit searches');
});

test('by @handle, by pasted URL, and by name (falls back to a channel search)', async () => {
  reset();
  const byHandle = await importSource({ client: client(), input: `https://www.youtube.com/${handleOf(TINY)}/videos`, state: freshState() });
  assert.equal(byHandle.title, TINY);
  const byName = await importSource({ client: client(), input: 'tiny yoga room', state: freshState() });
  assert.equal(byName.title, TINY);
  assert.equal(fault.calls.filter((c) => c.endpoint === 'search').length, 1, 'only the name lookup searches');
  await assert.rejects(() => importSource({ client: client(), input: 'definitely not a channel xyzzy', state: freshState() }), /Couldn’t find a channel/);
  await assert.rejects(() => importSource({ client: client(), input: 'https://www.youtube.com/user/someone', state: freshState() }), /Couldn’t find a channel/);
});

test('long catalogues are paginated and capped by maxVideos', async () => {
  reset();
  const big = 'Big Channel Yoga';
  const all = VIDEOS.filter((v) => v.channel === big).length;
  assert.ok(all > 8, 'fixture needs more than one page');
  const full = await importSource({ client: client(), input: chId(big), state: freshState(), maxVideos: 200 });
  assert.equal(full.records.length + full.skipped, all);
  const capped = await importSource({ client: client(), input: chId(big), state: freshState(), maxVideos: 10 });
  assert.ok(capped.records.length + capped.skipped <= 10);
});

test('playlists: title, ids, details; and a missing playlist is a clear error', async () => {
  reset();
  const res = await importSource({ client: client(), input: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`, state: freshState() });
  assert.equal(res.type, 'playlist'); assert.equal(res.title, 'My favourite hip routines');
  assert.deepEqual(new Set(res.records.map((r) => r.id)), new Set(PLAYLIST_VIDEOS));
  await assert.rejects(() => importSource({ client: client(), input: 'PLdoesnotexist0000000000000000000000', state: freshState() }), YouTubeError);
});

test('unusable videos (too short, live, not embeddable) are filtered out and counted', async () => {
  reset();
  const orig = VIDEOS.find((v) => v.channel === TINY); const was = orig.min; orig.min = 1;
  try {
    const res = await importSource({ client: client(), input: chId(TINY), state: freshState() });
    assert.equal(res.skipped, 1);
    assert.ok(!res.records.some((r) => r.id === orig.id));
  } finally { orig.min = was; }
});

test('a pasted single video link works through the same path', async () => {
  reset();
  const res = await importSource({ client: client(), input: `https://youtu.be/${VIDEOS[0].id}`, state: freshState() });
  assert.equal(res.type, 'video'); assert.equal(res.records[0].id, VIDEOS[0].id); assert.equal(res.records[0].source, 'manual');
});

test('imported records go to the index, and to the library only when asked', async () => {
  reset();
  const s = freshState();
  const res = await importSource({ client: client(), input: chId(TINY), state: s });
  const before = Object.keys(s.videos).length;
  assert.equal(importRecords(s, res.records), res.records.length);
  assert.equal(Object.keys(s.videos).length, before + res.records.length);
  assert.ok(res.records.every((r) => !inLibrary(s, r.id)));
  importRecords(s, res.records.slice(0, 2), { toLibrary: true });
  assert.equal(Object.keys(s.library).length, 2);
});

test('a bad key surfaces as a KeyError from the importer', async () => {
  reset();
  await assert.rejects(() => importSource({ client: new YouTubeClient({ key: 'INVALID', base: 'http://fake.local/youtube/v3', fetchFn: fakeFetch }), input: chId(TINY), state: freshState() }), KeyError);
});

test('refreshFollowed finds only uploads we have not seen', async () => {
  reset();
  const s = freshState();
  followChannel(s, { channelId: chId(TINY), name: TINY });
  const first = await refreshFollowed({ client: client(), state: s });
  assert.ok(first.records.length > 0);
  assert.equal(first.updated[0].uploads, uploadsOf(chId(TINY)));
  importRecords(s, first.records);
  const second = await refreshFollowed({ client: client(), state: s });
  assert.equal(second.records.length, 0, 'nothing new the second time');
  // a "new upload" appears
  const v = VIDEOS.find((x) => x.channel === TINY);
  delete s.videos[v.id];
  const third = await refreshFollowed({ client: client(), state: s });
  assert.deepEqual(third.records.map((r) => r.id), [v.id]);
});
