// "A female / male teacher": read conservatively from what is written, always overruled by what the person says,
// never guessed from a name, and never a reason to hide a video when nobody knows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { textVoice, commentVoice, guessVoice, voiceResolver, voiceFit, voiceNote, voiceText, KNOWN_VOICES } from '../../js/teacher.js';
import { channelKey } from '../../js/channel.js';
import { CATALOGUE } from '../../data/teachers.js';
import * as model from '../../js/model.js';
import { freshState, splitState, loadState, markTeacher, markedVoice, unmarkTeacher, mergeImport, MAX_TEACHER_MARKS } from '../../js/state.js';
import { analyzeVideoText, ANALYSIS_VERSION } from '../../js/analyze.js';
import { parseCommand } from '../../js/query.js';
import { describeFilters, ctx } from '../../js/ctx.js';

const { rankCandidates, buildModel } = model;

// ---------------------------------------------------------------- what the words say

test('outright statements in the description are read; ordinary mentions of women or men are not', () => {
  assert.equal(textVoice({ description: 'Hi! Pronouns: she/her. I teach yoga.' }).gender, 'female');
  assert.equal(textVoice({ description: 'Your female yoga teacher, every Monday' }).gender, 'female');
  assert.equal(textVoice({ description: 'He/him. Yoga and mobility.' }).gender, 'male');
  assert.equal(textVoice({ description: 'A male yoga instructor with 10 years of practice' }).gender, 'male');
  assert.equal(textVoice({ description: 'I’m a yoga teacher and a busy mum of two' }).gender, 'female');
  assert.equal(textVoice({ description: 'I\'m a runner, coach and proud dad' }).gender, 'male');
  assert.equal(textVoice({ description: 'We are a husband and wife team' }).gender, 'mixed');
  assert.equal(textVoice({ description: 'she/her, he/him' }).gender, 'mixed', 'both named: several teachers');
  for (const nothing of ['Yoga for women over 50: hips and hamstrings', 'Men’s hip mobility routine', 'My husband loves this stretch', 'Pelvic floor yoga for women', '']) assert.equal(textVoice({ description: nothing }), null, nothing);
  assert.equal(textVoice({ description: 'she/her' }).certainty, 'sure');
  assert.equal(textVoice({ description: 'I am a mum of two' }).certainty, 'probable', 'a statement about being a parent is weaker than a stated pronoun or role');
});

test('a name alone says nothing: the same description with only a first name reads as unknown', () => {
  for (const channel of ['Sarah Yoga', 'John Fitness', 'Alex Moves', 'Sam']) assert.equal(textVoice({ channel, description: 'Daily yoga for everyone' }), null, channel);
  assert.equal(guessVoice({ channel: 'Emma Yoga', description: 'Welcome to the channel' }), null);
});

// ---------------------------------------------------------------- what viewers say

test('viewers who clearly agree give a probable answer; few or split voices give none', () => {
  const her = ['I love her voice so much', 'Thank you ma\'am', 'she is so amazing', 'her cues are perfect', 'great video, thanks', 'My husband says he loved it too'];
  const g = commentVoice(her);
  assert.equal(g.gender, 'female'); assert.equal(g.certainty, 'probable');
  assert.match(g.evidence, /4 comments say/);
  assert.equal(commentVoice(['his voice is calm', 'he explains everything so well', 'love him', 'thank you sir']).gender, 'male');
  assert.equal(commentVoice(['I love her voice', 'her cues are good']), null, 'two comments are not enough');
  assert.equal(commentVoice(['his voice', 'he explains well', 'love him', 'her voice', 'she is amazing', 'thank you ma’am']), null, 'viewers disagree');
  assert.equal(commentVoice(['great', 'nice', 'felt good', 'my sister likes it']), null);
  assert.equal(commentVoice(undefined), null);
  assert.equal(commentVoice([{ text: 'love her voice' }, { text: 'her cues are clear' }, { text: 'she teaches so well' }]).gender, 'female', 'comment objects work too');
});

test('words and viewers together: they can agree; when they disagree only an outright statement wins', () => {
  assert.equal(guessVoice({ description: 'she/her', comments: ['her voice', 'love her', 'she is amazing'] }).gender, 'female');
  assert.equal(guessVoice({ description: 'she/her', comments: ['his voice', 'he explains', 'love him'] }).gender, 'female', 'her own bio beats the comments');
  assert.equal(guessVoice({ description: 'I am a mum of two', comments: ['his voice', 'he explains', 'love him'] }), null, 'a weak reading against viewers: no answer');
  assert.equal(guessVoice({ description: 'nothing', comments: ['love her', 'her voice', 'thank you madam'] }).gender, 'female');
});

// ---------------------------------------------------------------- who wins

const vid = (id, channel, channelId, voice) => ({ id, channel, channelId, ...(voice ? { profile: { voice } } : { profile: {} }) });
const g = (gender, certainty = 'probable') => ({ gender, certainty, evidence: 'because' });

test('what you said wins, then well-known teachers, then the channel\'s other videos, then the video itself', () => {
  const marks = [{ key: 'uc_a', name: 'Some Channel', channelId: 'UC_a', voice: 'male' }];
  const a1 = vid('a1', 'Some Channel', 'UC_a', g('female'));
  assert.deepEqual([voiceResolver({ marks, videos: [a1] })(a1).gender, voiceResolver({ marks, videos: [a1] })(a1).source], ['male', 'you'], 'your mark beats the app\'s reading');
  const adriene = vid('x1', 'Yoga With Adriene', 'UC_x', g('male'));
  assert.deepEqual([voiceResolver({ videos: [adriene] })(adriene).gender, voiceResolver({ videos: [adriene] })(adriene).source], ['female', 'known']);
  assert.equal(voiceResolver({ marks: [{ key: 'uc_x', name: 'Yoga With Adriene', channelId: 'UC_x', voice: 'mixed' }], videos: [adriene] })(adriene).gender, 'mixed', 'and your mark beats the known list');

  const five = [1, 2, 3, 4, 5].map((i) => vid(`f${i}`, 'Many Videos', 'UC_m', g('female')));
  const odd = vid('f6', 'Many Videos', 'UC_m', g('male'));
  const r = voiceResolver({ videos: [...five, odd] });
  assert.deepEqual([r(odd).gender, r(odd).source], ['female', 'channel'], 'one odd video does not overrule the channel (5 of 6)');
  assert.match(r(odd).evidence, /5 of 6 videos/);
  const blank = vid('f7', 'Many Videos', 'UC_m');
  assert.equal(voiceResolver({ videos: [...five, blank] })(blank).gender, 'female', 'a video with nothing of its own takes what the channel says');

  const split = [vid('s1', 'Split', 'UC_s', g('female')), vid('s2', 'Split', 'UC_s', g('male')), vid('s3', 'Split', 'UC_s', g('female')), vid('s4', 'Split', 'UC_s', g('male'))];
  assert.equal(voiceResolver({ videos: split })(split[0]), null, 'a channel whose videos disagree is unknown, not a coin toss');
  const stated = vid('s5', 'Split', 'UC_s', g('female', 'sure'));
  assert.equal(voiceResolver({ videos: [...split, stated] })(stated).gender, 'female', 'unless the video says so outright');
  assert.equal(voiceResolver({ videos: [vid('q', 'Quiet', 'UC_q')] })(vid('q', 'Quiet', 'UC_q')), null);
  assert.equal(voiceResolver()(null), null);
});

test('well-known teachers come from the app\'s teachers list, spelled the way names are compared, and never override a person', () => {
  assert.ok(Object.keys(KNOWN_VOICES).length >= 40, 'a useful start');
  for (const k of Object.keys(KNOWN_VOICES)) assert.match(k, /^[a-z0-9]+$/, `${k} is compared without spaces or capitals`);
  const v = { id: 'k', channel: 'Travis Eliot', channelId: 'UC_t' };
  const got = voiceResolver({ videos: [v] })(v);
  assert.deepEqual([got.gender, got.source, got.certainty], ['male', 'known', 'sure']);
  const single = CATALOGUE.find((t) => t.voice && t.voiceBy === 'probable');
  const r = voiceResolver({ videos: [] })({ id: 'p', channel: single.name });
  assert.deepEqual([r.gender, r.certainty], [single.voice, 'probable'], 'a single source gives a probable reading, shown with a ?');
  assert.match(voiceNote(r), /a guess.*teachers list/);
});

test('fit: no preference always fits, a mixed teaching team fits either, unknown is neither yes nor no', () => {
  assert.equal(voiceFit('', null), 'yes');
  assert.equal(voiceFit('female', { gender: 'female' }), 'yes');
  assert.equal(voiceFit('female', { gender: 'male' }), 'no');
  assert.equal(voiceFit('male', { gender: 'mixed' }), 'yes');
  assert.equal(voiceFit('male', null), 'unknown');
  assert.equal(voiceText('female'), 'Female teacher'); assert.equal(voiceText('mixed'), 'Several teachers'); assert.equal(voiceText('x'), '');
  assert.match(voiceNote({ gender: 'female', certainty: 'probable', source: 'channel', evidence: '5 of 6 videos' }), /Female teacher \(a guess\).*5 of 6 videos/);
  assert.match(voiceNote({ gender: 'male', certainty: 'sure', source: 'you' }), /You marked this channel/);
  assert.equal(voiceNote(null), '');
});

test('"same channel" means the same thing here as for blocking and favourites', () => {
  for (const v of [{ channelId: 'UC_ABC', channel: 'X' }, { channel: 'Only A Name' }, {}]) assert.equal(model.channelKey(v), channelKey(v));
  assert.equal(model.channelMatcher, model.channelBlocker);
});

// ---------------------------------------------------------------- the filter in the ranking

const mk = (id, channel, channelId, voice, extra = {}) => ({
  id, title: 'Hip opener stretch for tight hips', channel, channelId, description: 'hips', tags: [], durationSec: 900, views: 40000, likes: 2000, embeddable: true, verified: true,
  profile: { ...analyzeVideoText({ title: 'Hip opener stretch for tight hips', description: 'hips', tags: [] }), ...(voice ? { voice } : {}) }, ...extra,
});
const f = (voice) => ({ areas: [{ id: 'hip_flexors', mode: 'tight' }], minMin: 10, maxMin: 25, styles: [], hints: [], terms: [], ...(voice ? { voice } : {}) });
const m0 = buildModel([], {});
const rank = (videos, voice, extra = {}) => rankCandidates({ videos, filters: f(voice), model: m0, ...extra });

test('a teacher known to be the other one is left out; unknown ones stay but come after the ones that fit; with no choice nothing changes', () => {
  const woman = mk('wwwwwwwwwww', 'She Channel', 'UC_w', g('female', 'sure'));
  const man = mk('mmmmmmmmmmm', 'He Channel', 'UC_m', g('male', 'sure'));
  const unknown = mk('uuuuuuuuuuu', 'Quiet Channel', 'UC_u', null);
  const team = mk('ttttttttttt', 'Team Channel', 'UC_t', g('mixed', 'sure'));
  const all = [woman, man, unknown, team];
  assert.deepEqual(rank(all, '').map((r) => r.video.id).sort(), all.map((v) => v.id).sort(), 'no preference: everyone');
  const wantFemale = rank(all, 'female').map((r) => r.video.id);
  assert.ok(!wantFemale.includes(man.id), 'the known man is left out');
  assert.ok(wantFemale.includes(unknown.id), 'the unknown one is still offered');
  assert.ok(wantFemale.indexOf(woman.id) < wantFemale.indexOf(unknown.id) && wantFemale.indexOf(team.id) < wantFemale.indexOf(unknown.id), 'but after the ones that fit');
  const wantMale = rank(all, 'male').map((r) => r.video.id);
  assert.ok(!wantMale.includes(woman.id) && wantMale.includes(man.id) && wantMale.includes(team.id));
  assert.ok(rank(all, 'female').find((r) => r.video.id === woman.id).reasons.some((x) => /Female teacher, as you asked/.test(x)), 'and the explanation says why');
  assert.deepEqual(rank(all, 'nonsense').map((r) => r.video.id).sort(), all.map((v) => v.id).sort(), 'a value that is not female or male is no preference');
});

test('your own mark changes the result at once, and a known teacher can be corrected', () => {
  const a = mk('aaaaaaaaaaa', 'Some Channel', 'UC_a', null);
  const b = mk('bbbbbbbbbbb', 'Yoga With Adriene', 'UC_ad', null);
  assert.deepEqual(rank([a, b], 'male').map((r) => r.video.id), ['aaaaaaaaaaa'], 'Adriene is a known woman, so she is out; the unknown one stays');
  const state = freshState();
  markTeacher(state, a, 'male');
  const ranked = rank([a, b], 'male', { teacherVoices: state.teacherVoices });
  assert.equal(ranked[0].video.id, 'aaaaaaaaaaa'); assert.equal(ranked.length, 1);
  markTeacher(state, b, 'mixed');
  assert.equal(rank([a, b], 'male', { teacherVoices: state.teacherVoices }).length, 2, 'a mark can also say "both"');
});

// ---------------------------------------------------------------- marks in the data

test('marking a channel, changing it, clearing it; the profile keeps it and old data without it still loads', () => {
  const s = freshState();
  const v = { id: 'aaaaaaaaaaa', channel: 'Foo Yoga', channelId: 'UC_foo' };
  const e = markTeacher(s, v, 'female');
  assert.deepEqual(e, { key: 'uc_foo', name: 'Foo Yoga', channelId: 'UC_foo', voice: 'female' });
  assert.equal(markedVoice(s, v), 'female');
  assert.equal(markedVoice(s, { id: 'zzzzzzzzzzz', channel: 'Foo Yoga' }), 'female', 'any video of that channel, even one that only knows its name');
  markTeacher(s, v, 'male');
  assert.equal(s.teacherVoices.length, 1, 'changing it replaces, never duplicates');
  assert.equal(markedVoice(s, v), 'male');

  const { profile, index } = splitState(s);
  assert.deepEqual(profile.teacherVoices, [{ key: 'uc_foo', name: 'Foo Yoga', channelId: 'UC_foo', voice: 'male' }]);
  const again = loadState({ profile: JSON.parse(JSON.stringify(profile)), index: JSON.parse(JSON.stringify(index)) }).state;
  assert.equal(again.teacherVoices.length, 1);
  const old = JSON.parse(JSON.stringify(profile)); delete old.teacherVoices;
  assert.deepEqual(loadState({ profile: old, index }).state.teacherVoices, []);
  const garbage = JSON.parse(JSON.stringify(profile)); garbage.teacherVoices = [null, 5, { key: 'k' }, { key: 'k2', voice: 'robot' }, { key: 'ok', name: 'Ok', voice: 'mixed' }];
  assert.deepEqual(loadState({ profile: garbage, index }).state.teacherVoices.map((c) => c.key), ['ok']);

  markTeacher(s, v, null);
  assert.deepEqual(s.teacherVoices, [], 'null takes the mark away');
  assert.equal(markTeacher(s, { id: 'x' }, 'female'), null, 'an unknown channel cannot be marked');
  markTeacher(s, v, 'female'); unmarkTeacher(s, 'uc_foo'); assert.deepEqual(s.teacherVoices, []);
});

test('the list of marks is bounded, and importing a backup adds the marks you did not have (yours win)', () => {
  const s = freshState();
  for (let i = 0; i < MAX_TEACHER_MARKS + 5; i++) markTeacher(s, { id: `v${i}`, channel: `Channel ${i}`, channelId: `UC_${i}` }, 'female');
  assert.equal(s.teacherVoices.length, MAX_TEACHER_MARKS);

  const mine = freshState(), other = freshState();
  markTeacher(mine, { id: 'a', channel: 'Shared', channelId: 'UC_s' }, 'female');
  markTeacher(other, { id: 'a', channel: 'Shared', channelId: 'UC_s' }, 'male');
  markTeacher(other, { id: 'b', channel: 'Only There', channelId: 'UC_o' }, 'male');
  mergeImport(mine, JSON.parse(JSON.stringify(splitState(other))));
  assert.deepEqual(mine.teacherVoices.map((c) => [c.key, c.voice]).sort(), [['uc_o', 'male'], ['uc_s', 'female']]);
});

// ---------------------------------------------------------------- typed requests, filters, analysis

test('"a female teacher" in what you type sets the choice; a topic about women does not; asking for both asks for neither', () => {
  const cases = [
    ['15 min tight hips with a female teacher', 'female'], ['male yoga instructor, lower back', 'male'], ['taught by a woman, hamstrings', 'female'],
    ['led by a man, 20 min', 'male'], ['a woman teacher', 'female'], ['yoga for women tight hips', ''], ['pelvic floor yoga for women', ''],
    ['female teacher or male teacher hips', ''], ['tight hips', ''],
  ];
  for (const [text, want] of cases) assert.equal(parseCommand(text).voice, want, text);
  const p = parseCommand('15 min tight hips with a female teacher');
  assert.ok(p.areas.length && p.minMin != null);
  assert.ok(!p.terms.includes('female') && !p.terms.includes('teacher'), `those words are not searched for: ${p.terms}`);
  assert.equal(parseCommand('a woman teacher').understood, true);
  assert.deepEqual(parseCommand('yoga for women tight hips').terms.includes('women'), true, 'still a topic');
});

test('the request reads back in plain words', () => {
  const was = ctx.ui.filters;
  ctx.ui.filters = { areas: [], terms: [], minMin: 10, maxMin: 20, styles: [], source: 'all', voice: 'male' };
  assert.match(describeFilters(), /male teacher/);
  ctx.ui.filters = { ...ctx.ui.filters, voice: '' };
  assert.doesNotMatch(describeFilters(), /teacher/);
  ctx.ui.filters = was;
});

test('analysis stores what it could read about the teacher, and the stored text is re-read when the analysis changes', () => {
  assert.ok(ANALYSIS_VERSION >= 6);
  const withBio = analyzeVideoText({ title: 'Hip stretch', channel: 'Some Channel', description: 'Hi, she/her here. Yoga for hips.', tags: [] });
  assert.equal(withBio.voice.gender, 'female');
  const withComments = analyzeVideoText({ title: 'Hip stretch', channel: 'C', description: 'hips', tags: [], comments: ['love her voice', 'her cues are great', 'she explains so well', 'thanks ma\'am'] });
  assert.equal(withComments.voice.gender, 'female'); assert.equal(withComments.voice.certainty, 'probable');
  assert.ok(!('voice' in analyzeVideoText({ title: 'Hip stretch', channel: 'C', description: 'hips', tags: [] })), 'nothing is stored when nothing is known');
});
