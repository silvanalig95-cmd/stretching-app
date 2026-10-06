// Transcripts: what the teacher SAYS is the richest evidence of what a move is for. (They are pasted: YouTube's API
// does not hand other people's captions to other programs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript, cleanTranscript, attachTranscript, analyzeVideoText, attachComments, TRANSCRIPT_MAX_CHARS } from '../../js/analyze.js';
import { mergeVideo } from '../../js/youtube.js';
import { buildReport } from '../../js/report.js';
import { freshState } from '../../js/state.js';

const SAMPLE = `0:00
hi everyone welcome to this ten minute flow
0:20
we start in a low lunge. you will feel a deep stretch in your hip flexors and the front of the thigh
1:10
now sink into pigeon pose, this releases your glutes and piriformis
2:00
for the lower abs: dead bug, press your lower back down and engage your deep core`;

test('every common way of copying a transcript is understood', () => {
  const youtube = parseTranscript(SAMPLE);                                  // "0:20" on one line, the words on the next
  assert.deepEqual(youtube.map((l) => l.t), [0, 20, 70, 120]);
  assert.match(youtube[1].text, /low lunge/);
  const inline = parseTranscript('0:05 hello there\n1:02:03 an hour in');   // stamp and words on the same line
  assert.deepEqual(inline, [{ t: 5, text: 'hello there' }, { t: 3723, text: 'an hour in' }]);
  const srt = parseTranscript('1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:03,500 --> 00:00:05,000\nlow lunge now');
  assert.deepEqual(srt, [{ t: 1, text: 'Hello there' }, { t: 3, text: 'low lunge now' }]);
  const vtt = parseTranscript('WEBVTT\n\n00:01.000 --> 00:03.000\n<c>Hello</c> there');
  assert.deepEqual(vtt, [{ t: 1, text: 'Hello there' }]);
  const prose = parseTranscript('Just some words.\nAnother line about hamstrings.');
  assert.deepEqual(prose.map((l) => l.t), [null, null]);
  assert.deepEqual(parseTranscript(''), []);
  assert.deepEqual(parseTranscript('[Music]\n♪\n   '), [], 'music cues are not speech');
});

test('stored transcripts are plain text, capped, and unambiguous about timestamps', () => {
  const { text, lines } = cleanTranscript(SAMPLE);
  assert.equal(lines, 4);
  assert.match(text.split('\n')[0], /^@0 hi everyone/);
  const numbers = cleanTranscript('5 minutes in we twist\n10 breaths here');   // lines that merely START with a number are not stamps
  assert.deepEqual(numbers.text.split('\n'), ['5 minutes in we twist', '10 breaths here']);
  const huge = cleanTranscript('word '.repeat(TRANSCRIPT_MAX_CHARS));
  assert.ok(huge.text.length <= TRANSCRIPT_MAX_CHARS);
});

test('what the teacher says shapes the analysis: muscles, exercises, and when each one comes up', () => {
  const base = { id: 'tr000000001', title: 'Morning flow', description: '', tags: [] };
  const plain = analyzeVideoText(base);
  assert.ok((plain.areas.hip_flexors ?? 0) < 0.3, 'the title alone says nothing about hips');
  const v = attachTranscript(base, SAMPLE);
  assert.ok(v.profile.areas.hip_flexors >= 0.45, `hip flexors ${v.profile.areas.hip_flexors}`);
  assert.ok(v.profile.areas.abs_lower >= 0.3 && v.profile.areas.deep_core >= 0.3, 'spoken specific areas count');
  assert.deepEqual(v.profile.poses.map((p) => p.id).sort(), ['dead_bug', 'low_lunge', 'pigeon']);
  assert.deepEqual(v.profile.transcript.timeline, [{ id: 'low_lunge', t: 20 }, { id: 'pigeon', t: 70 }, { id: 'dead_bug', t: 120 }]);
  assert.equal(v.profile.transcript.lines, 4);
  assert.ok(v.profile.sources.transcript.hip_flexors > 0);
});

test('a sentence that explains what a move does counts for more than a passing mention', () => {
  const cue = attachTranscript({ id: 'tr000000002', title: 'x', description: '', tags: [] }, 'you will feel this stretch in your hamstrings');
  const pass = attachTranscript({ id: 'tr000000003', title: 'x', description: '', tags: [] }, 'my hamstrings are over there by the door');
  assert.ok(cue.profile.sources.transcript.hamstrings > pass.profile.sources.transcript.hamstrings);
});

test('adding a transcript keeps the comment evidence, removing it restores the earlier analysis', () => {
  const base = { id: 'tr000000004', title: 'Hip routine', description: 'hips', tags: [] };
  const withComments = attachComments(base, [{ text: 'my hip flexors feel so much looser, thank you!', likes: 5 }, { text: 'the pigeon pose helped my glutes', likes: 2 }, { text: 'great pace', likes: 1 }]);
  const both = attachTranscript(withComments, SAMPLE);
  assert.ok(both.evidence?.n >= 3 && both.comments?.length === 3, 'comments survive');
  assert.ok(both.profile.sources.comments && both.profile.sources.transcript, 'both sources feed the profile');
  const removed = attachTranscript(both, '');
  assert.equal(removed.transcript, undefined);
  assert.equal(removed.profile.transcript, undefined);
  assert.deepEqual(removed.profile.areas, attachComments(base, withComments.comments.map((c) => ({ text: c.t, likes: c.l }))).profile.areas, 'as if the transcript had never been added');
  assert.equal(attachTranscript(both, '[Music]').transcript, undefined, 'text with no words in it removes it too');
});

test('a fresh copy from YouTube does not erase a transcript you pasted', () => {
  const mine = attachTranscript({ id: 'tr000000005', title: 'Flow', description: '', tags: [], source: 'manual' }, SAMPLE);
  const fresh = { id: 'tr000000005', title: 'Flow (updated title)', description: 'new', views: 5, source: 'search' };
  assert.equal(mergeVideo(mine, fresh).transcript, mine.transcript);
});

test('the report says what was heard, and invites a transcript when there is none', () => {
  const state = freshState();
  const none = buildReport({ id: 'tr000000006', title: 'Flow', description: 'x', tags: [], profile: analyzeVideoText({ title: 'Flow', description: 'x', tags: [] }) }, { state });
  assert.equal(none.transcript, null);
  assert.ok(none.limits.some((l) => /Paste one/.test(l)));
  const v = attachTranscript({ id: 'tr000000007', title: 'Flow', description: 'x', tags: [] }, SAMPLE);
  const r = buildReport(v, { state });
  assert.equal(r.transcript.words > 20, true);
  assert.deepEqual(r.transcript.timeline.map((t) => [t.at, t.label]), [['0:20', 'Low lunge'], ['1:10', 'Pigeon'], ['2:00', 'Dead bug']]);
  assert.ok(r.transcript.heard.some((x) => x.id === 'hip_flexors'));
  assert.ok(!r.limits.some((l) => /Paste one/.test(l)));
  assert.ok(r.areas.find((a) => a.id === 'hip_flexors')?.why.includes('the teacher talks about it'));
});
