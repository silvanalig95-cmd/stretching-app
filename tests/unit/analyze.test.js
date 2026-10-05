import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/analyze.js';

test('decodeEntities handles named and numeric entities', () => {
  assert.equal(A.decodeEntities('Hips &amp; Back &#39;Release&#39; &quot;x&quot; &#x1F600;'), `Hips & Back 'Release' "x" 😀`);
  assert.equal(A.decodeEntities('&bogus; &#99999999;'), '&bogus; &#99999999;');
});

test('parseIsoDuration', () => {
  assert.equal(A.parseIsoDuration('PT15M'), 900);
  assert.equal(A.parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(A.parseIsoDuration('PT45S'), 45);
  assert.equal(A.parseIsoDuration('P0D'), 0); // live streams
  assert.equal(A.parseIsoDuration('nonsense'), null);
});

test('parseChapters needs a forward-running list of 3+', () => {
  const ok = A.parseChapters('Intro\n0:00 Start\n1:30 - Low lunge\n(4:10) Pigeon pose\n1:02:00 Outro');
  assert.deepEqual(ok.map((c) => c.t), [0, 90, 250, 3720]);
  assert.equal(ok[1].label, 'Low lunge');
  assert.deepEqual(A.parseChapters('see you at 5:00 and 6:00'), []); // only 2, not a chapter list
  assert.deepEqual(A.parseChapters('3:00 a\n1:00 b\n0:30 c'), []);   // not ascending
});

test('analyzeVideoText: a hips video scores hips high and calves low', () => {
  const p = A.analyzeVideoText({
    title: '20 Minute Yoga for Tight Hips',
    description: 'Release hip flexors.\n0:00 Intro\n1:00 Low lunge\n5:00 Pigeon pose\n9:00 Figure four',
  });
  assert.ok(p.areas.hip_flexors > 0.7, `hip_flexors ${p.areas.hip_flexors}`);
  assert.ok(p.areas.glutes > 0.7, `glutes ${p.areas.glutes}`);
  assert.ok((p.areas.calves ?? 0) < 0.2);
  assert.deepEqual(p.poses.map((x) => x.id).sort(), ['figure_four', 'low_lunge', 'pigeon']);
  assert.equal(p.poses.find((x) => x.id === 'pigeon').count, 1); // chapters not double counted
});

test('analyzeVideoText works from a title alone (starter videos)', () => {
  const p = A.analyzeVideoText({ title: '10 Min Yoga For Tight Calves' });
  assert.ok(p.areas.calves >= 0.8);
  assert.ok(p.styles.stretch > 0);
});

test('conditions map to the right muscles', () => {
  const p = A.analyzeVideoText({ title: 'Yoga for Sciatica Relief' });
  assert.ok(p.areas.glutes >= 0.8 && p.areas.lower_back >= 0.4);
  const q = A.analyzeVideoText({ title: 'Desk Posture Reset: neck, chest & rounded shoulders' });
  assert.ok(q.areas.upper_back > 0.6 && q.areas.chest > 0.6 && q.areas.neck > 0.6);
});

test('generalist videos are dampened relative to focused ones', () => {
  const focused = A.analyzeVideoText({ title: 'Hamstring stretch' });
  const generalist = A.analyzeVideoText({ title: 'Hamstrings, hips, shoulders, neck, calves, quads and lower back stretch' });
  assert.ok(generalist.areas.hamstrings < focused.areas.hamstrings);
});

test('sentenceSentiment: negation beats positive words', () => {
  assert.equal(A.sentenceSentiment('This really helped my hips'), 1);
  assert.equal(A.sentenceSentiment("It didn't help at all"), -1);
  assert.equal(A.sentenceSentiment('Made my back feel so much better'), 1); // not "made my" => negative
  assert.equal(A.sentenceSentiment('First!'), 0);
});

test('analyzeComments attributes sentiment to the muscles mentioned', () => {
  const ev = A.analyzeComments([
    { text: 'My sciatica is so much better after a week. Thank you!', likes: 40 },
    { text: 'The pigeon pose really helped my tight glutes.', likes: 12 },
    { text: "Didn't help my hips at all, too fast for me.", likes: 1 },
    { text: 'Love this, perfect for desk workers with stiff hips', likes: 5 },
    'ok',
  ]);
  assert.equal(ev.n, 4); // "ok" is too short to count
  assert.ok(ev.mentions.glutes.pos >= 2);
  assert.ok(ev.mentions.hip_flexors.neg >= 1 && ev.mentions.hip_flexors.pos >= 1);
  assert.equal(ev.pace.tooFast, 1);
  assert.ok(ev.benefits.sciatica >= 1);
  assert.ok(ev.quotes.length >= 1 && ev.quotes[0].likes === 40); // most-liked relevant quote first
  assert.equal(ev.posesMentioned.pigeon, 1);
});

test('comment evidence raises confidence in an area, bad reviews lower it', () => {
  const base = A.analyzeVideoText({ title: 'Yoga flow', description: 'Includes pigeon pose.' });
  const good = A.analyzeComments(Array.from({ length: 6 }, () => ({ text: 'My piriformis and glutes feel so much better, thanks!' })));
  const bad = A.analyzeComments(Array.from({ length: 6 }, () => ({ text: "Didn't help my glutes, waste of time" })));
  const up = A.applyComments(base, good).areas.glutes;
  const down = A.applyComments(base, bad).areas.glutes;
  assert.ok(up > base.areas.glutes, 'positive comments raise it');
  assert.ok(down < up, 'negative comments rank below positive');
});

test('fewer than 3 comments produce no area evidence (too noisy)', () => {
  const ev = A.analyzeComments(['My hips feel great thanks']);
  assert.deepEqual(A.commentSupport(ev), {});
});

test('qualityScore rewards like ratio and sentiment', () => {
  const liked = A.qualityScore({ views: 100000, likes: 4000 });
  const meh = A.qualityScore({ views: 100000, likes: 600 });
  assert.ok(liked > meh);
  assert.equal(A.likeRatioScore({ views: 50, likes: 5 }), 0.5); // too few views to judge
  assert.equal(A.likeRatioScore({ views: 10000, likes: null }), 0.5); // hidden likes
});

test('isHiddenGem: well-liked but not huge', () => {
  assert.equal(A.isHiddenGem({ views: 20000, likes: 1200 }), true);
  assert.equal(A.isHiddenGem({ views: 20000000, likes: 900000 }), false);
  assert.equal(A.isHiddenGem({ views: 20000, likes: 100 }), false);
});

test('explainMatch gives readable reasons', () => {
  const video = { profile: A.analyzeVideoText({ title: 'Hips', description: '0:00 a\n1:00 Pigeon pose\n2:00 Low lunge' }), evidence: A.analyzeComments(Array.from({ length: 4 }, () => 'My hip flexors feel amazing')) };
  const r = A.explainMatch(video, ['hip_flexors']);
  assert.match(r[0], /Hip flexors/);
  assert.match(r[0], /Low lunge/);
});
