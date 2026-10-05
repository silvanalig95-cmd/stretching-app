import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVideoText } from '../../js/analyze.js';
import {
  buildModel, predictLearned, rankCandidates, pickRoutine, insights, coverage, mulberry32, seededRng, lengthFit, recencyPenalty, isTrusted,
} from '../../js/model.js';

let n = 0;
const vid = (title, o = {}) => {
  const v = { id: `V${String(++n).padStart(10, '0')}`, title, description: o.description ?? '', durationSec: (o.min ?? 15) * 60, channel: o.channel ?? 'Chan A',
    channelId: o.channelId ?? o.channel ?? 'Chan A', views: o.views ?? 100000, likes: o.likes ?? 4000, embeddable: true, ...o };
  v.profile = analyzeVideoText(v);
  return v;
};
const byId = (...vs) => Object.fromEntries(vs.map((v) => [v.id, v]));
const session = (v, ratings, date = '2026-09-01', extra = {}) => ({ id: `s${++n}`, videoId: v.id, date, areas: Object.keys(ratings).map((id) => ({ id, mode: 'tight' })), ratings, ...extra });
const tightHips = [{ id: 'glutes', mode: 'tight' }];
const F = (areas, o = {}) => ({ areas, minMin: 5, maxMin: 40, styles: [], ...o });

test('lengthFit: inside is 1, a little outside is penalised, far outside is excluded', () => {
  const v = (min) => ({ durationSec: min * 60 });
  assert.equal(lengthFit(v(15), 10, 20), 1);
  assert.ok(lengthFit(v(21), 10, 20) < 1 && lengthFit(v(21), 10, 20) > 0);
  assert.equal(lengthFit(v(40), 10, 20), 0);
  assert.equal(lengthFit(v(2), 10, 20), 0);
  assert.equal(lengthFit({ durationSec: null }, 10, 20), 0.55); // unknown length: allowed but not preferred
});

test('learning: ratings credit the poses, so a *different* video with the same pose is predicted to help', () => {
  const a = vid('Hip flow', { description: '0:00 a\n1:00 Pigeon pose\n5:00 Figure four\n8:00 b', channel: 'Teacher One' });
  const b = vid('Slow stretch session', { description: '0:00 a\n1:00 Pigeon pose\n5:00 b\n8:00 c', channel: 'Teacher Two' });
  const c = vid('Neck stretch', { description: 'Neck rolls', channel: 'Teacher Three' });
  const hist = [session(a, { glutes: 'much' }, '2026-08-01'), session(a, { glutes: 'much' }, '2026-08-08'), session(a, { glutes: 'much' }, '2026-08-15')];
  const model = buildModel(hist, byId(a, b, c));
  const pb = predictLearned(model, b, tightHips);
  const pc = predictLearned(model, c, tightHips);
  assert.ok(pb.value > 0.6, `pose credit should lift b (got ${pb.value})`);
  assert.equal(pc.value, 0.5);
  assert.ok(pb.notes.some((t) => /Pigeon/.test(t)), pb.notes.join('|'));
  assert.ok(predictLearned(model, a, tightHips).value > pb.value, 'the video itself is the strongest evidence');
});

test('learning: "not really" answers push a teacher/video down', () => {
  const a = vid('Hip stretch', { channel: 'Meh Teacher' });
  const b = vid('Another hip stretch', { channel: 'Meh Teacher' });
  const model = buildModel([session(a, { glutes: 'none' }), session(a, { glutes: 'none' })], byId(a, b));
  assert.ok(predictLearned(model, b, tightHips).value < 0.45);
  assert.ok(predictLearned(model, a, tightHips).value < predictLearned(model, b, tightHips).value);
});

test('learning is rebuilt from history: deleting a session removes its influence', () => {
  const a = vid('Hip stretch');
  const withIt = buildModel([session(a, { glutes: 'much' })], byId(a));
  const without = buildModel([], byId(a));
  assert.ok(predictLearned(withIt, a, tightHips).value > 0.5);
  assert.equal(predictLearned(without, a, tightHips).value, 0.5);
});

test('ranking: filters by length, block list, and broken/unembeddable videos', () => {
  const ok = vid('Hip flexor stretch', { min: 15 });
  const long = vid('Hip flexor stretch long', { min: 55 });
  const blocked = vid('Hip flexor stretch blocked', { min: 15 });
  const broken = vid('Hip flexor stretch broken', { min: 15, broken: true });
  const noEmbed = vid('Hip flexor stretch noembed', { min: 15, embeddable: false });
  const r = rankCandidates({ videos: [ok, long, blocked, broken, noEmbed], filters: F([{ id: 'hip_flexors', mode: 'tight' }], { minMin: 10, maxMin: 20 }),
    model: buildModel([], {}), blocked: [blocked.id] });
  assert.deepEqual(r.map((x) => x.video.id), [ok.id]);
});

test('ranking: the right muscles win; unrelated videos are dropped', () => {
  const hips = vid('15 Min Yoga for Tight Hips and Hip Flexors');
  const neck = vid('15 Min Neck Stretch');
  const full = vid('15 Min Full Body Stretch');
  const r = rankCandidates({ videos: [neck, full, hips], filters: F([{ id: 'hip_flexors', mode: 'tight' }]), model: buildModel([], {}) });
  assert.equal(r[0].video.id, hips.id);
  assert.ok(!r.some((x) => x.video.id === neck.id));
  assert.ok(r.some((x) => x.video.id === full.id), 'full-body videos still qualify, just lower');
});

test('ranking: "weak" areas prefer strengthening videos, "tight" prefer stretches (mode effect isolated)', () => {
  // Identical muscle coverage; the only difference is stretch-vs-strength character.
  const stretch = vid('Glutes A');
  const strong = vid('Glutes B');
  stretch.profile = { areas: { glutes: 0.9 }, styles: { stretch: 0.8 }, poses: [{ id: 'pigeon', count: 1 }, { id: 'figure_four', count: 1 }] };
  strong.profile = { areas: { glutes: 0.9 }, styles: { strength: 0.8 }, poses: [{ id: 'clamshell', count: 1 }, { id: 'hydrant', count: 1 }] };
  const order = (mode) => rankCandidates({ videos: [stretch, strong], filters: F([{ id: 'glutes', mode }]), model: buildModel([], {}), adventure: 0 }).map((x) => x.video.id);
  assert.deepEqual(order('weak'), [strong.id, stretch.id]);
  assert.deepEqual(order('tight'), [stretch.id, strong.id]);
});

test('weak/tight also works end-to-end from plain text analysis', () => {
  const stretch = vid('Glute stretch and release', { description: 'Pigeon pose and figure four to release tight glutes' });
  const strong = vid('Glute strength workout', { description: 'Glute bridge, fire hydrant, clamshell and squats to strengthen your glutes' });
  const weak = rankCandidates({ videos: [stretch, strong], filters: F([{ id: 'glutes', mode: 'weak' }]), model: buildModel([], {}) });
  const tight = rankCandidates({ videos: [stretch, strong], filters: F([{ id: 'glutes', mode: 'tight' }]), model: buildModel([], {}) });
  assert.equal(weak[0].video.id, strong.id);
  assert.equal(tight[0].video.id, stretch.id);
});

test('ranking: what helped you before outranks a slightly better text match', () => {
  const liked = vid('Yoga flow', { description: 'Includes pigeon pose', channel: 'Fav' });
  const better = vid('Yoga for glutes and piriformis', { channel: 'Other' });
  const hist = [session(liked, { glutes: 'much' }), session(liked, { glutes: 'much' }), session(liked, { glutes: 'much' })];
  const model = buildModel(hist, byId(liked, better));
  const fresh = rankCandidates({ videos: [liked, better], filters: F(tightHips), model: buildModel([], {}), today: '2026-10-05' });
  assert.equal(fresh[0].video.id, better.id, 'without history the better text match wins');
  const learned = rankCandidates({ videos: [liked, better], filters: F(tightHips), model, today: '2026-10-05' });
  assert.ok(learned.find((x) => x.video.id === liked.id).parts.learned > 0.6);
  assert.ok(learned.find((x) => x.video.id === liked.id).reasons.some((r) => r.includes('📈')));
});

test('ranking: variety — recently done videos are pushed down, then come back', () => {
  const a = vid('Hip flexor stretch A', { channel: 'A' });
  const b = vid('Hip flexor stretch B', { channel: 'B', likes: 3000 });
  const done = [session(a, { hip_flexors: 'much' }, '2026-10-04')];
  const top = (today) => rankCandidates({ videos: [a, b], filters: F([{ id: 'hip_flexors', mode: 'tight' }]), model: buildModel(done, byId(a, b)), today })[0].video.id;
  assert.ok(recencyPenalty(buildModel(done, byId(a)), a.id, '2026-10-05') > recencyPenalty(buildModel(done, byId(a)), a.id, '2026-10-30'));
  assert.equal(top('2026-10-05'), b.id, 'done yesterday => try the other one');
});

test('ranking: a high adventure setting favours teachers you have never done', () => {
  const known = vid('Hip flexor stretch', { channel: 'Known', likes: 4500 });
  const unknown = vid('Hip flexor stretch', { channel: 'Newbie', likes: 4000 });
  const other = vid('Back stretch', { channel: 'Known' });
  const model = buildModel([session(other, { lower_back: 'some' }, '2026-01-01')], byId(known, unknown, other));
  const rank = (adventure) => rankCandidates({ videos: [known, unknown], filters: F([{ id: 'hip_flexors', mode: 'tight' }]), model, adventure, today: '2026-10-05' });
  assert.equal(rank(0)[0].video.id, known.id);
  assert.equal(rank(1)[0].video.id, unknown.id);
  assert.equal(rank(1)[0].flags.newChannel, true);
});

test('ranking: channel diversity — one teacher does not fill the top', () => {
  const same = [1, 2, 3].map((i) => vid(`Hip flexor stretch ${i}`, { channel: 'Same', likes: 4000 + i }));
  const other = vid('Hip flexor stretch other', { channel: 'Other', likes: 3900 });
  const r = rankCandidates({ videos: [...same, other], filters: F([{ id: 'hip_flexors', mode: 'tight' }]), model: buildModel([], {}), adventure: 0 });
  assert.ok(r.slice(0, 2).some((x) => x.video.channel === 'Other'));
});

test('isTrusted matches teacher names loosely', () => {
  assert.equal(isTrusted({ channel: 'Yoga With Adriene' }, ['yoga with adriene']), true);
  assert.equal(isTrusted({ channel: 'Sarah Beth Yoga' }, ['Sarah Beth']), true);
  assert.equal(isTrusted({ channel: 'Someone Else' }, ['Sarah Beth']), false);
  assert.equal(isTrusted({ channel: '' }, ['x']), false);
});

test('pickRoutine is stable for a seed, varies with the salt, and prefers the best', () => {
  const ranked = [0.9, 0.85, 0.8, 0.5, 0.3, 0.2].map((score, i) => ({ score, video: { id: `x${i}` } }));
  const pick = (salt) => pickRoutine(ranked, seededRng('2026-10-05', salt)).video.id;
  assert.equal(pick(0), pick(0));
  assert.notEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(pick)).size, 1);
  const counts = {};
  for (let i = 0; i < 400; i++) { const id = pickRoutine(ranked, mulberry32(i)).video.id; counts[id] = (counts[id] ?? 0) + 1; }
  assert.ok(counts.x0 > counts.x3 && !counts.x5, JSON.stringify(counts));
  assert.equal(pickRoutine([], mulberry32(1)), null);
});

test('insights: what has worked, per muscle', () => {
  const a = vid('Hip flow', { description: '0:00 a\n1:00 Pigeon pose\n4:00 b\n7:00 c', channel: 'Teach' });
  const hist = [session(a, { glutes: 'much' }), session(a, { glutes: 'much' }), session(a, { glutes: 'some' }, '2026-09-10')];
  const ins = insights(buildModel(hist, byId(a)), byId(a));
  const g = ins.find((i) => i.area === 'glutes');
  assert.equal(g.ratings, 3);
  assert.ok(g.helped > 0.8);
  assert.equal(g.poses[0].label, 'Pigeon');
  assert.equal(g.teachers[0].name, 'Teach');
  assert.equal(g.videos[0].id, a.id);
});

test('coverage counts usable videos per area', () => {
  const a = vid('Hip flexor stretch'), b = vid('Hip flexor stretch 2', { broken: true });
  const c = coverage([a, b]);
  assert.equal(c.hip_flexors, 1);
  assert.equal(c.neck, 0);
});

test('intensity feedback nudges level: repeatedly "too hard" favours beginner videos', () => {
  const gentle = vid('Gentle beginner hip flexor stretch', { channel: 'G' });
  const hard = vid('Advanced intense hip flexor stretch', { channel: 'H' });
  assert.equal(gentle.profile.level, 'beginner'); assert.equal(hard.profile.level, 'advanced');
  const other = vid('Back stretch', { channel: 'Z' });
  const hist = [1, 2, 3, 4].map((i) => session(other, { lower_back: 'some' }, `2026-09-0${i}`, { intensity: 'hard' }));
  const r = rankCandidates({ videos: [gentle, hard], filters: F([{ id: 'hip_flexors', mode: 'tight' }]), model: buildModel(hist, byId(other)), adventure: 0, today: '2026-10-05' });
  assert.equal(r[0].video.id, gentle.id);
});
