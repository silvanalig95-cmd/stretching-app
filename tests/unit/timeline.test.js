// The order of a routine: chapters first, then what the teacher says, then the times viewers write in comments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, commentMoments, timelineOf, sections, sectionIndexAt } from '../../js/timeline.js';
import { analyzeVideoText, attachComments } from '../../js/analyze.js';

const chapters = [{ t: 0, label: 'Intro' }, { t: 90, label: 'Pigeon pose' }, { t: 300, label: 'Low lunge' }, { t: 540, label: 'Child’s pose' }];

test('a chapter list is the timeline, with the pose each chapter is about', () => {
  const tl = buildTimeline({ chapters });
  assert.equal(tl.source, 'chapters');
  assert.deepEqual(tl.items.map((i) => i.poseId), [null, 'pigeon', 'low_lunge', 'childs']);
  assert.equal(buildTimeline({ chapters: chapters.slice(0, 2) }), null, 'two chapters is not a list');
});

test('without chapters: what the teacher says, then what viewers write', () => {
  const tl = buildTimeline({ transcriptTimeline: [{ id: 'pigeon', t: 30 }, { id: 'frog', t: 200 }, { id: 'childs', t: 400 }], comments: [] });
  assert.equal(tl.source, 'transcript'); assert.equal(tl.items[1].label, 'Frog');
  const comments = [{ t: '12:30 pigeon is where it clicked for me' }, { t: 'pigeon at 12:35 was amazing' }, { t: 'the 3:05 frog pose, wow' }, { t: 'great video thanks' }, { t: '99:99 nonsense pigeon' }, { t: 'see you at 1:00 tomorrow' }];
  const moments = commentMoments(comments, 1800);
  assert.deepEqual(moments.map((m) => [m.poseId, m.count]), [['frog', 1], ['pigeon', 2]], 'clustered by pose and time, in order');
  assert.ok(Math.abs(moments[1].t - 750) <= 5);
  const viaComments = buildTimeline({ comments, durationSec: 1800 });
  assert.equal(viaComments.source, 'comments');
  assert.equal(buildTimeline({ comments: [{ t: 'pigeon at 12:30' }] }), null, 'one comment is not enough to call it an order');
});

test('times beyond the length of the video, and times with no pose near them, are ignored', () => {
  assert.deepEqual(commentMoments([{ t: '40:00 pigeon' }], 1200), []);
  assert.deepEqual(commentMoments([{ t: 'meet me at 5:00 for lunch' }, { t: '5:00' }], 1200), []);
});

test('the analysis stores a timeline only when it is not just the chapter list; timelineOf rebuilds the rest', () => {
  const withChapters = analyzeVideoText({ title: 'Hips', description: 'Chapters\n0:00 Intro\n1:30 Pigeon pose\n5:00 Low lunge\n9:00 Child pose', tags: [], durationSec: 700 });
  assert.equal(withChapters.timeline, undefined, 'chapters are already stored');
  assert.equal(timelineOf(withChapters).source, 'chapters');
  const v = attachComments({ title: 'Hips', description: '', tags: [], durationSec: 1800 }, [{ text: '12:30 pigeon was the best', likes: 5 }, { text: 'pigeon 12:32 yes', likes: 1 }, { text: '3:00 frog pose, wow', likes: 1 }]);
  assert.equal(v.profile.timeline.source, 'comments');
  assert.equal(timelineOf(v.profile).items.length, 2);
  assert.equal(timelineOf({ chapters: [] }), null);
});

test('sections run to the next one, and the one playing is found by time', () => {
  const s = sections(buildTimeline({ chapters }), 700);
  assert.deepEqual(s.map((x) => x.end), [90, 300, 540, 700]);
  assert.equal(sectionIndexAt(s, 0), 0); assert.equal(sectionIndexAt(s, 89.6), 1, 'a hair early still counts as the next one');
  assert.equal(sectionIndexAt(s, 301), 2); assert.equal(sectionIndexAt(s, 9999), 3);
  assert.equal(sectionIndexAt([{ t: 30, end: 60 }], 5), -1, 'before the first section');
  assert.equal(sections({ items: [{ t: 10, label: 'x' }] }, null)[0].end, 70);
});
