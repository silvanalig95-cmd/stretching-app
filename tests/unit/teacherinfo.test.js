// One teacher as the app knows them: who is meant, which videos are theirs, what they usually teach, and browsing their videos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTeacher, teacherVideos, teacherYoutubeUrl, teacherImportInput, teacherProfile, teacherSummary, teacherBasis, browseVideos, browseChoices, lengthLabel } from '../../js/teacherinfo.js';
import { analyzeVideoText } from '../../js/analyze.js';
import { freshState, splitState, loadState, mergeImport, linkTeacherChannel, MAX_TEACHER_CHANNELS } from '../../js/state.js';

const UC = 'UC' + 'a'.repeat(22), UC2 = 'UC' + 'b'.repeat(22);
let n = 0;
const vid = (extra = {}) => {
  const id = `vid${String(++n).padStart(8, '0')}`;
  const v = { id, title: 'Hip opener flow', channel: 'Calm Studio', channelId: UC, description: 'slow hips', tags: [], durationSec: 900, views: 1000, publishedAt: '2026-01-01T00:00:00Z', ...extra };
  return { ...v, profile: analyzeVideoText(v) };
};
const index = (...vs) => Object.fromEntries(vs.map((v) => [v.id, v]));

// ---------------------------------------------------------------- who is meant

test('a name finds the list’s entry, a name from the videos finds the channel id, and an id finds the name', () => {
  const videos = index(vid({ channel: 'Calm Studio' }), vid({ channel: 'Calm Studio' }), vid({ channel: 'Other', channelId: UC2 }));
  const calm = resolveTeacher('Calm Studio', { videos, catalogue: [] });
  assert.deepEqual([calm.name, calm.channelId, calm.known, calm.entry], ['Calm Studio', UC, true, null], 'the channel id comes from its videos');
  const adriene = resolveTeacher('yoga with adriene', { videos: {}, catalogue: [{ name: 'Yoga With Adriene', handle: '@yogawithadriene', styles: ['yoga'] }] });
  assert.deepEqual([adriene.name, adriene.handle, adriene.known], ['Yoga With Adriene', '@yogawithadriene', true], 'capitals and spaces do not matter; the list’s spelling is shown');
  const byId = resolveTeacher(UC2, { videos, catalogue: [] });
  assert.deepEqual([byId.name, byId.channelId], ['Other', UC2], 'a channel id is turned into the channel’s name');
  const stranger = resolveTeacher('Somebody New', { videos, catalogue: [] });
  assert.deepEqual([stranger.known, stranger.channelId, stranger.entry], [false, null, null], 'an unknown teacher still resolves, with nothing yet');
});

test('kept and followed teachers are recognised', () => {
  const kept = { name: 'Quiet Hips Studio', by: 'gemini', styles: ['yin'] };
  const r = resolveTeacher('Quiet Hips Studio', { myTeachers: [kept], following: [{ channelId: UC2, name: 'Quiet Hips Studio' }], catalogue: [] });
  assert.deepEqual([r.mine, r.channelId, r.followed?.channelId, r.known], [true, UC2, UC2, true]);
  const builtin = resolveTeacher('Yoga With Adriene', {});
  assert.equal(builtin.mine, false, 'a teacher from the built-in list is not "kept from Gemini"');
});

test('their videos are those of the channel, by id when there is one and else by name', () => {
  const a1 = vid(), a2 = vid({ channelId: undefined }), other = vid({ channel: 'Other', channelId: UC2 }), renamed = vid({ channel: 'Calm Studio (new name)' });
  const videos = index(a1, a2, other, renamed);
  assert.deepEqual(teacherVideos({ name: 'Calm Studio', channelId: UC }, videos).map((v) => v.id).sort(), [a1.id, a2.id, renamed.id].sort(), 'same id counts even when the channel was renamed; a video without an id counts by name');
  assert.deepEqual(teacherVideos({ name: 'Calm Studio', channelId: null }, videos).map((v) => v.id).sort(), [a1.id, a2.id].sort(), 'by name alone');
  assert.deepEqual(teacherVideos({ name: 'Nobody', channelId: null }, videos), []);
});

test('where to look them up, and what to give the importer', () => {
  assert.equal(teacherYoutubeUrl({ name: 'X', channelId: UC }), `https://www.youtube.com/channel/${UC}`);
  assert.equal(teacherYoutubeUrl({ name: 'X', handle: '@x' }), 'https://www.youtube.com/@x');
  assert.match(teacherYoutubeUrl({ name: 'A & B' }), /results\?search_query=A%20%26%20B%20yoga%20stretching$/);
  assert.equal(teacherImportInput({ name: 'X', channelId: UC, handle: '@x' }), UC);
  assert.equal(teacherImportInput({ name: 'X', handle: '@x' }), '@x');
  assert.equal(teacherImportInput({ name: 'X' }), 'X');
});

// ---------------------------------------------------------------- what they usually teach

test('the profile counts what is there: kinds, length, muscles, poses, what has been read', () => {
  const yin = [vid({ title: 'Yin yoga for hips: deep hip opener', description: 'yin yoga, hold for three minutes, pigeon pose', durationSec: 1500 }), vid({ title: 'Yin yoga for tight hips', description: 'yin yoga, pigeon pose, long holds', durationSec: 1800, comments: [{ t: 'my hips feel so open' }] })];
  const quick = vid({ title: '5 min neck and shoulder stretch', description: 'quick neck stretch for desk workers', durationSec: 300 });
  const p = teacherProfile([...yin, quick], { library: { [yin[0].id]: { addedAt: 1 } }, spots: [{ id: 'hip_flexors', mode: 'tight' }, { id: 'calves', mode: 'tight' }] });
  assert.equal(p.n, 3); assert.equal(p.counts.inLibrary, 1); assert.equal(p.counts.withComments, 1); assert.equal(p.counts.aiRead, 0);
  assert.ok(p.kinds[0].id === 'yin' && p.kinds[0].n === 2, `yin leads: ${JSON.stringify(p.kinds)}`);
  assert.deepEqual([p.length.min, p.length.median, p.length.max, p.length.buckets.under10, p.length.buckets['20to45']], [300, 1500, 1800, 1, 2]);
  assert.ok(p.areas.some((a) => a.id === 'hip_flexors' || a.id === 'glutes'), 'the hips show up');
  assert.ok(p.areas.every((a) => a.id !== 'full_body' && a.share > 0 && a.share <= 1));
  assert.ok(p.poses.some((x) => x.id === 'pigeon' && x.n === 2), `pigeon is named in two: ${JSON.stringify(p.poses)}`);
  const fit = Object.fromEntries(p.fits.map((f) => [f.id, f.share]));
  assert.ok(fit.hip_flexors > fit.calves && fit.calves === 0, 'your hips are covered, your calves are not');
});

test('what you did with their videos counts only theirs', () => {
  const a = vid(), b = vid(), other = vid({ channel: 'Other', channelId: UC2 });
  const history = [{ videoId: a.id, ratings: { hip_flexors: 'much', glutes: 'some' } }, { videoId: a.id, ratings: { hip_flexors: 'none' } }, { videoId: other.id, ratings: { neck: 'much' } }];
  const p = teacherProfile([a, b], { history });
  assert.deepEqual([p.yours.sessions, p.yours.videos, p.yours.ratings], [2, 1, 3]);
  assert.equal(p.yours.helpful, 0.5, 'much 1 + some 0.5 + none 0, over three ratings');
  assert.equal(teacherProfile([b], { history }).yours.helpful, null, 'nothing rated, nothing claimed');
});

test('the summary is plain sentences, and says how little it may be based on', () => {
  assert.deepEqual(teacherSummary(teacherProfile([])), []);
  assert.match(teacherBasis(teacherProfile([])), /not read any/);
  const vids = [vid({ title: 'Yin yoga for hips', description: 'yin yoga pigeon pose hold three minutes', durationSec: 1200 }), vid({ title: 'Yin yoga for hips II', description: 'yin yoga pigeon pose', durationSec: 1200 })];
  const p = teacherProfile(vids, { history: [{ videoId: vids[0].id, ratings: { hip_flexors: 'much' } }] });
  const lines = teacherSummary(p);
  assert.ok(lines.some((l) => /yin/i.test(l)), lines.join(' | '));
  assert.ok(lines.some((l) => /about 20 minutes/.test(l)));
  assert.ok(lines.some((l) => /You have done 1 of their routines and 100% of your ratings said it helped/.test(l)));
  assert.match(teacherBasis(p), /Based on 2 videos.*small sample/);
  assert.doesNotMatch(teacherBasis(teacherProfile(Array.from({ length: 6 }, () => vid()))), /small sample/);
});

// ---------------------------------------------------------------- browsing

test('browsing: search words, muscle, kind, length, yours only, and the orders', () => {
  const a = vid({ title: 'Yin yoga for hips', description: 'yin yoga pigeon pose', durationSec: 1500, views: 500, publishedAt: '2026-03-01T00:00:00Z' });
  const b = vid({ title: '5 min neck stretch', description: 'neck stretch', durationSec: 300, views: 9000, publishedAt: '2026-05-01T00:00:00Z' });
  const c = vid({ title: 'Power flow', description: 'vinyasa power yoga', durationSec: 3000, views: 100, publishedAt: '2026-01-01T00:00:00Z' });
  const all = [a, b, c], ids = (x) => x.map((v) => v.id);
  const library = { [c.id]: { addedAt: 1, tags: ['morning'], note: 'tough' } };
  assert.deepEqual(ids(browseVideos(all, { sort: 'popular' })), [b.id, a.id, c.id]);
  assert.deepEqual(ids(browseVideos(all, { sort: 'mine' }, { library })), [c.id, b.id, a.id], 'yours first, then most viewed');
  assert.deepEqual(ids(browseVideos(all, { sort: 'new' })), [b.id, a.id, c.id]);
  assert.deepEqual(ids(browseVideos(all, { sort: 'short' })), [b.id, a.id, c.id]);
  assert.deepEqual(ids(browseVideos(all, { sort: 'long' })), [c.id, a.id, b.id]);
  assert.deepEqual(ids(browseVideos(all, { q: 'pigeon' })), [a.id], 'a pose named in it is found');
  assert.deepEqual(ids(browseVideos(all, { q: 'morning tough' }, { library })), [c.id], 'your own tags and note are searched');
  assert.deepEqual(ids(browseVideos(all, { length: 'under10' })), [b.id]);
  assert.deepEqual(ids(browseVideos(all, { length: 'over45' })), [c.id]);
  assert.deepEqual(ids(browseVideos(all, { mine: true }, { library })), [c.id]);
  assert.deepEqual(ids(browseVideos(all, { area: 'neck' })), [b.id]);
  assert.deepEqual(ids(browseVideos(all, { kind: 'yin' })), [a.id]);
  assert.deepEqual(ids(browseVideos(all, { q: 'nonexistentword' })), []);
  assert.equal(browseVideos(all, {}).length, 3, 'no filters: all of them');
  const choices = browseChoices(all);
  assert.deepEqual(choices.lengths.map((l) => l.id), ['under10', '20to45', 'over45'], 'only lengths that exist');
  assert.ok(choices.areas.some((x) => x.id === 'neck') && choices.kinds.some((k) => k.id === 'yin'));
  assert.equal(lengthLabel({ durationSec: 750 }), '13 min'); assert.equal(lengthLabel({ durationSec: 750, durationApprox: true }), '~13 min'); assert.equal(lengthLabel({ durationSec: null }), '?');
});

// ---------------------------------------------------------------- the channel you picked for a name

test('the channel picked for a name is remembered, saved with your data, merged, and bad entries are dropped', () => {
  const st = freshState();
  assert.equal(linkTeacherChannel(st, 'Calm Studio', UC), true);
  assert.equal(linkTeacherChannel(st, 'CALM  studio', UC), false, 'the same again changes nothing');
  assert.equal(linkTeacherChannel(st, 'Calm Studio', 'not-a-channel-id'), false, 'only real channel ids');
  assert.equal(linkTeacherChannel(st, '   ', UC), false);
  assert.deepEqual(st.teacherChannels, { calmstudio: UC });
  const { profile } = splitState(st);
  assert.deepEqual(profile.teacherChannels, { calmstudio: UC }, 'it is in the profile (precious), not the rebuildable index');
  const back = loadState({ profile: JSON.parse(JSON.stringify(profile)), index: {} }).state;
  assert.deepEqual(back.teacherChannels, { calmstudio: UC });
  const dirty = loadState({ profile: { ...JSON.parse(JSON.stringify(profile)), teacherChannels: { ok: UC2, bad: 'x', '': UC, num: 5 } }, index: {} }).state;
  assert.deepEqual(dirty.teacherChannels, { ok: UC2 }, 'anything that is not a channel id is dropped on load');
  const other = freshState(); other.teacherChannels.calmstudio = UC2;
  mergeImport(other, JSON.parse(JSON.stringify(splitState(st))));
  assert.equal(other.teacherChannels.calmstudio, UC2, 'what you already chose here is not overwritten by an imported copy');
  const third = freshState(); mergeImport(third, JSON.parse(JSON.stringify(splitState(st))));
  assert.equal(third.teacherChannels.calmstudio, UC, 'but it is added when there was none');
  for (let i = 0; i < MAX_TEACHER_CHANNELS + 5; i++) linkTeacherChannel(st, `Teacher ${i}`, UC);
  assert.ok(Object.keys(st.teacherChannels).length <= MAX_TEACHER_CHANNELS, 'the list is capped');
  // and the page finds their videos through it, even when YouTube titles the channel differently
  const videos = index(vid({ channel: 'Calm Studio Official', channelId: UC2 }));
  const ref = resolveTeacher('Calm Studio', { videos, aliases: { calmstudio: UC2 }, catalogue: [] });
  assert.equal(ref.channelId, UC2);
  assert.equal(teacherVideos(ref, videos).length, 1, 'found by the remembered channel, not by the name');
});
