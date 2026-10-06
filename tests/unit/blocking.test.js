// "Not for me": hide one video, or everything from its channel, with a way back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, splitState, loadState, blockVideo, unblockVideo, blockChannel, unblockChannel, hiddenReason, mergeImport } from '../../js/state.js';
import { rankCandidates, buildModel, channelBlocker } from '../../js/model.js';
import { analyzeVideoText } from '../../js/analyze.js';

const video = (id, channel, channelId, title = 'Hip opener stretch for tight hips') => ({
  id, title, channel, channelId, description: 'hips', tags: [], durationSec: 900, views: 40000, likes: 2000, embeddable: true, verified: true, profile: analyzeVideoText({ title, description: 'hips', tags: [] }),
});
const filters = { areas: [{ id: 'hip_flexors', mode: 'tight' }], minMin: null, maxMin: null, styles: [], hints: [], terms: [] };
const rank = (videos, state) => rankCandidates({ videos, filters, model: buildModel([], {}), blocked: state.blocked, blockedChannels: state.blockedChannels }).map((r) => r.video.id);

test('blocking a channel hides all its videos from suggestions (by id, or by name when no id is known), and only those', () => {
  const state = freshState();
  const a1 = video('aaaaaaaaaa1', 'Calm Hips Studio', 'UC_calm'), a2 = video('aaaaaaaaaa2', 'Calm Hips Studio', 'UC_calm');
  const b1 = video('bbbbbbbbbb1', 'Other Teacher', 'UC_other');
  const nameOnly = video('cccccccccc1', 'calm hips studio', undefined);   // a starter suggestion: it only knows the name
  assert.deepEqual(rank([a1, a2, b1, nameOnly], state).sort(), ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'bbbbbbbbbb1', 'cccccccccc1']);
  const entry = blockChannel(state, a1);
  assert.deepEqual(entry, { key: 'uc_calm', name: 'Calm Hips Studio', channelId: 'UC_calm' });
  assert.deepEqual(rank([a1, a2, b1, nameOnly], state), ['bbbbbbbbbb1'], 'every video of that channel is gone, however it is identified');
  assert.equal(blockChannel(state, a2).key, entry.key);
  assert.equal(state.blockedChannels.length, 1, 'blocking twice keeps one entry');
  unblockChannel(state, entry.key);
  assert.equal(rank([a1, a2, b1, nameOnly], state).length, 4, 'and it all comes back');
});

test('a channel blocked from a name-only suggestion still matches once YouTube supplies the real channel id', () => {
  const state = freshState();
  blockChannel(state, video('cccccccccc1', 'Yoga With Someone', undefined));
  assert.deepEqual(rank([video('dddddddddd1', 'Yoga With Someone', 'UC_real_id')], state), []);
  assert.deepEqual(rank([video('dddddddddd2', 'Somebody Else', 'UC_x')], state), ['dddddddddd2']);
});

test('hidden videos and blocked channels are told apart, and videos without a channel cannot be channel-blocked', () => {
  const state = freshState();
  const v = video('eeeeeeeeee1', 'Chan', 'UC_c'), w = video('eeeeeeeeee2', 'Chan', 'UC_c'), x = video('eeeeeeeeee3', 'Else', 'UC_e');
  blockVideo(state, x.id);
  blockChannel(state, v);
  assert.equal(hiddenReason(state, v), 'channel');
  assert.equal(hiddenReason(state, w), 'channel');
  assert.equal(hiddenReason(state, x), 'video');
  assert.equal(hiddenReason(state, video('eeeeeeeeee4', 'Free', 'UC_f')), null);
  unblockVideo(state, x.id);
  assert.equal(hiddenReason(state, x), null);
  assert.equal(blockChannel(state, { id: 'noch0000001', title: 'x' }), null, 'nothing to block without a channel');
  assert.equal(channelBlocker([])(v), false);
});

test('blocked channels are saved with the profile, survive a reload, merge from backups, and old data without them loads fine', () => {
  const state = freshState();
  blockChannel(state, video('ffffffffff1', 'Saved Channel', 'UC_saved'));
  const { profile, index } = splitState(state);
  assert.deepEqual(profile.blockedChannels, [{ key: 'uc_saved', name: 'Saved Channel', channelId: 'UC_saved' }]);
  const reloaded = loadState({ profile: JSON.parse(JSON.stringify(profile)), index: JSON.parse(JSON.stringify(index)) }).state;
  assert.equal(reloaded.blockedChannels.length, 1);
  const old = JSON.parse(JSON.stringify(profile)); delete old.blockedChannels;
  assert.deepEqual(loadState({ profile: old, index }).state.blockedChannels, [], 'a profile from before this feature');
  const garbage = JSON.parse(JSON.stringify(profile)); garbage.blockedChannels = [null, 5, { name: 'no key' }, { key: 'ok', name: 'Ok' }];
  assert.deepEqual(loadState({ profile: garbage, index }).state.blockedChannels, [{ key: 'ok', name: 'Ok' }], 'junk entries are dropped');
  const other = freshState();
  mergeImport(other, { app: 'unfurl', ...splitState(state) });
  assert.equal(other.blockedChannels.length, 1, 'importing a backup brings its blocked channels');
  mergeImport(other, { app: 'unfurl', ...splitState(state) });
  assert.equal(other.blockedChannels.length, 1, 'without duplicating them');
});
