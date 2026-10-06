// Favourite channels: their videos gain weight, but only as far as they fit what was asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, splitState, loadState, blockChannel, favoriteChannel, unfavoriteChannel, isFavoriteChannel, hiddenReason, mergeImport } from '../../js/state.js';
import { rankCandidates, buildModel, FAVORITE_BOOST } from '../../js/model.js';
import { analyzeVideoText } from '../../js/analyze.js';

const video = (id, channel, channelId, { title = 'Hip opener stretch for tight hips', description = 'hips', likes = 2000, views = 40000, durationSec = 900 } = {}) => ({
  id, title, channel, channelId, description, tags: [], durationSec, views, likes, embeddable: true, verified: true, profile: analyzeVideoText({ title, description, tags: [] }),
});
const filters = (extra = {}) => ({ areas: [{ id: 'hip_flexors', mode: 'tight' }], minMin: 10, maxMin: 25, styles: [], hints: [], terms: [], ...extra });
const model = buildModel([], {});
const rank = (videos, state, f = filters()) => rankCandidates({ videos, filters: f, model, blocked: state.blocked, blockedChannels: state.blockedChannels, favoriteChannels: state.favoriteChannels });

test('a favourite channel\'s video overtakes a slightly better one from elsewhere, and only because it is a favourite', () => {
  const state = freshState();
  const fav = video('aaaaaaaaaa1', 'Beloved Teacher', 'UC_beloved', { likes: 1500 });
  const other = video('bbbbbbbbbb1', 'Other Teacher', 'UC_other', { likes: 2400 });
  assert.deepEqual(rank([fav, other], state).map((r) => r.video.id), ['bbbbbbbbbb1', 'aaaaaaaaaa1'], 'without the flag, the better-liked video wins');
  favoriteChannel(state, fav);
  const ranked = rank([fav, other], state);
  assert.deepEqual(ranked.map((r) => r.video.id), ['aaaaaaaaaa1', 'bbbbbbbbbb1'], 'with the flag, the favourite comes first');
  assert.equal(ranked[0].flags.favorite, true);
  assert.equal(ranked[1].flags.favorite, false);
  assert.ok(ranked[0].reasons.some((r) => r.startsWith('★')), 'and the explanation says why');
});

test('the lift is bounded: at most +FAVORITE_BOOST of the score the video would have had anyway', () => {
  const state = freshState();
  const v = video('cccccccccc1', 'Beloved Teacher', 'UC_beloved');
  const plain = rank([v], state)[0].score;
  favoriteChannel(state, v);
  const boosted = rank([v], state)[0];
  assert.ok(boosted.score > plain);
  assert.ok(boosted.score <= plain * (1 + FAVORITE_BOOST) + 1e-9, `${boosted.score} vs ${plain}`);
  assert.ok(boosted.parts.favorite > 0 && boosted.parts.favorite <= 1);
});

test('a favourite gains nothing when the video does not fit the request: wrong style, loosely related muscles, or the length is off', () => {
  const state = freshState();
  const fav = video('dddddddddd1', 'Beloved Teacher', 'UC_beloved');
  // style asked for: yin. This video is not yin, so no lift (and the usual style penalty still applies).
  const f = filters({ styles: ['yin'] });
  const before = rank([fav], state, f)[0].score;
  favoriteChannel(state, fav);
  const after = rank([fav], state, f)[0];
  assert.equal(after.score, before, 'style mismatch: no lift');
  assert.equal(after.parts.favorite, 0);
  // length: just outside the window gets only part of the lift; well inside gets all of it
  const inside = rank([fav], state)[0];
  const edge = rank([video('dddddddddd2', 'Beloved Teacher', 'UC_beloved', { durationSec: 26.5 * 60 })], state)[0];
  assert.equal(inside.parts.favorite, 1);
  assert.ok(edge && edge.parts.favorite < inside.parts.favorite, `edge ${edge?.parts.favorite}`);
  // a video that doesn't cover the asked-for muscles at all is not surfaced just because of the channel
  const shoulders = video('dddddddddd3', 'Beloved Teacher', 'UC_beloved', { title: 'Shoulder and neck release', description: 'shoulders neck' });
  assert.deepEqual(rank([shoulders], state), []);
});

test('typed words count as the fit when no muscle is chosen: a favourite that does not match what you typed gets no lift', () => {
  const state = freshState();
  const fav = video('eeeeeeeeee1', 'Beloved Teacher', 'UC_beloved');
  favoriteChannel(state, fav);
  const f = { areas: [], minMin: 10, maxMin: 25, styles: [], hints: [], terms: ['pigeon'] };
  const run = (text) => rankCandidates({ videos: [fav], filters: f, model, favoriteChannels: state.favoriteChannels, textScores: new Map([[fav.id, text]]) })[0];
  assert.equal(run(0), undefined, 'not matching the typed words at all: not offered');
  assert.ok(run(0.15).parts.favorite < 0.5, 'a weak text match: a small lift');
  assert.equal(run(0.9).parts.favorite, 1);
});

test('favouriting and blocking a channel exclude each other, and blocking always wins in the ranking', () => {
  const state = freshState();
  const a = video('ffffffffff1', 'Both Ways', 'UC_both');
  favoriteChannel(state, a);
  assert.equal(isFavoriteChannel(state, a), true);
  blockChannel(state, a);
  assert.equal(isFavoriteChannel(state, a), false, 'blocking removes the favourite');
  assert.equal(hiddenReason(state, a), 'channel');
  favoriteChannel(state, a);
  assert.equal(hiddenReason(state, a), null, 'favouriting un-blocks');
  assert.equal(isFavoriteChannel(state, a), true);
  // if both ever end up in the lists (e.g. edited by hand), the video is simply hidden
  state.blockedChannels.push({ key: 'uc_both', name: 'Both Ways', channelId: 'UC_both' });
  assert.deepEqual(rank([a], state), []);
});

test('a channel known only by name matches by name, and by id once YouTube supplies it', () => {
  const state = freshState();
  favoriteChannel(state, video('gggggggggg1', 'Yoga With Someone', undefined));
  assert.equal(isFavoriteChannel(state, video('gggggggggg2', 'yoga with someone', 'UC_real')), true);
  assert.equal(isFavoriteChannel(state, video('gggggggggg3', 'Somebody Else', 'UC_x')), false);
  assert.equal(favoriteChannel(state, { id: 'nochannel01', title: 'x' }), null, 'nothing to favourite without a channel');
  assert.equal(state.favoriteChannels.length, 1, 'favouriting twice keeps one entry');
  favoriteChannel(state, video('gggggggggg2', 'yoga with someone', 'UC_real'));
  assert.equal(state.favoriteChannels.length, 1);
  unfavoriteChannel(state, state.favoriteChannels[0].key);
  assert.deepEqual(state.favoriteChannels, []);
});

test('favourites are saved with the profile, survive a reload, merge from backups (blocking still wins), and old data loads fine', () => {
  const state = freshState();
  favoriteChannel(state, video('hhhhhhhhhh1', 'Kept Channel', 'UC_kept'));
  const { profile, index } = splitState(state);
  assert.deepEqual(profile.favoriteChannels, [{ key: 'uc_kept', name: 'Kept Channel', channelId: 'UC_kept' }]);
  assert.equal(loadState({ profile: JSON.parse(JSON.stringify(profile)), index: JSON.parse(JSON.stringify(index)) }).state.favoriteChannels.length, 1);
  const old = JSON.parse(JSON.stringify(profile)); delete old.favoriteChannels;
  assert.deepEqual(loadState({ profile: old, index }).state.favoriteChannels, []);
  const garbage = JSON.parse(JSON.stringify(profile)); garbage.favoriteChannels = [null, 5, { name: 'no key' }, { key: 'ok', name: 'Ok' }];
  assert.deepEqual(loadState({ profile: garbage, index }).state.favoriteChannels.map((c) => c.key), ['ok']);

  const other = freshState();
  favoriteChannel(other, video('iiiiiiiiii1', 'Other Fav', 'UC_otherfav'));
  favoriteChannel(other, video('iiiiiiiiii2', 'Kept Channel', 'UC_kept'));
  blockChannel(other, video('iiiiiiiiii3', 'Now Blocked', 'UC_blk'));
  const target = freshState();
  favoriteChannel(target, video('hhhhhhhhhh1', 'Kept Channel', 'UC_kept'));
  favoriteChannel(target, video('jjjjjjjjjj1', 'Now Blocked', 'UC_blk'));
  mergeImport(target, splitState(other));
  assert.deepEqual(target.favoriteChannels.map((c) => c.key).sort(), ['uc_kept', 'uc_otherfav'], 'union, no duplicates, and a channel blocked in the other copy is no longer a favourite');
  assert.equal(target.blockedChannels.length, 1);
});
