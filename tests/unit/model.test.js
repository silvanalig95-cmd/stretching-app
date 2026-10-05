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

test('free-text terms: typed alone they must match; alongside muscles they boost; with no matches they do nothing', () => {
  const pigeon = vid('Hip flow', { description: '0:00 a\n1:00 Pigeon pose\n5:00 b\n8:00 c' });
  const other = vid('Hip flow two', { description: 'Just lunges' });
  const neck = vid('Neck release');
  const m = buildModel([], {});
  const scores = new Map([[pigeon.id, 1], [other.id, 0.2]]);
  const only = rankCandidates({ videos: [pigeon, other, neck], filters: { areas: [], minMin: 5, maxMin: 40, styles: [], terms: ['pigeon'] }, model: m, textScores: scores });
  assert.deepEqual(only.map((r) => r.video.id), [pigeon.id, other.id], 'free text alone excludes non-matches');
  assert.match(only[0].reasons[0], /Matches what you typed/);
  const both = rankCandidates({ videos: [pigeon, other, neck], filters: F([{ id: 'hip_flexors', mode: 'tight' }], { terms: ['pigeon'] }), model: m, textScores: scores, adventure: 0 });
  assert.equal(both[0].video.id, pigeon.id);
  assert.ok(!both.some((r) => r.video.id === neck.id), 'muscles still required');
  const ignored = rankCandidates({ videos: [pigeon, other, neck], filters: { areas: [], minMin: 5, maxMin: 40, styles: [], terms: ['pigeon'] }, model: m, textScores: null });
  assert.equal(ignored.length, 3, 'no text scores supplied (nothing matched) => terms ignored');
});

test('scope: library-only and discovered-only', () => {
  const a = vid('Hip flexor stretch A'), b = vid('Hip flexor stretch B');
  const lib = new Set([a.id]);
  const ids = (source) => rankCandidates({ videos: [a, b], filters: F([{ id: 'hip_flexors', mode: 'tight' }], { source }), model: buildModel([], {}), libraryIds: lib }).map((r) => r.video.id);
  assert.deepEqual(ids('library'), [a.id]);
  assert.deepEqual(ids('discovered'), [b.id]);
  assert.equal(ids('all').length, 2);
  const r = rankCandidates({ videos: [a, b], filters: F([{ id: 'hip_flexors', mode: 'tight' }]), model: buildModel([], {}), libraryIds: lib });
  assert.equal(r.find((x) => x.video.id === a.id).flags.inLibrary, true);
  assert.equal(r.find((x) => x.video.id === b.id).flags.inLibrary, false);
});

import { areaHeat, neglectedAreas } from '../../js/model.js';
const hs = (date, areas, ratings = {}) => ({ id: `s${date}${areas.join('')}`, date, videoId: 'x', areas: areas.map((id) => ({ id, mode: 'tight' })), ratings });

test('areaHeat: counts recent sessions, last-done and how much it helped, per muscle', () => {
  const heat = areaHeat([
    hs('2026-09-01', ['glutes'], { glutes: 'much' }),
    hs('2026-10-01', ['glutes', 'neck'], { glutes: 'some' }),
    hs('2026-10-04', ['neck']),
  ], { today: '2026-10-05', days: 28 });
  assert.equal(heat.glutes.sessions, 1, 'the September one is outside the 28-day window');
  assert.equal(heat.glutes.daysAgo, 4);
  assert.equal(heat.glutes.helped, 0.75);
  assert.equal(heat.neck.sessions, 2); assert.equal(heat.neck.daysAgo, 1); assert.equal(heat.neck.helped, null);
});

test('neglectedAreas: standing spots by how long since you worked them; never-worked comes first; weak wins ties', () => {
  const focus = [{ id: 'neck', mode: 'tight' }, { id: 'glutes', mode: 'weak' }, { id: 'calves', mode: 'tight' }, { id: 'core', mode: 'weak' }];
  const hist = [hs('2026-10-04', ['neck']), hs('2026-09-20', ['glutes'])];
  const r = neglectedAreas(focus, hist, { today: '2026-10-05', n: 4 });
  assert.deepEqual(r.map((x) => x.id), ['core', 'calves', 'glutes', 'neck'], 'never-done first (weak before tight), then oldest');
  assert.equal(r[2].daysAgo, 15); assert.equal(r[0].daysAgo, null);
  assert.equal(neglectedAreas(focus, hist, { today: '2026-10-05', n: 2 }).length, 2);
});

test('with no standing spots set, the areas you work most often stand in', () => {
  const hist = [hs('2026-10-01', ['glutes']), hs('2026-10-02', ['glutes']), hs('2026-09-30', ['neck']), hs('2026-10-04', ['full_body'])];
  const r = neglectedAreas([], hist, { today: '2026-10-05', n: 5 });
  assert.deepEqual(r.map((x) => x.id), ['neck', 'glutes'], 'neck was longest ago; full body is not a muscle to neglect');
  assert.deepEqual(neglectedAreas([], [], { today: '2026-10-05' }), []);
});

import { composeCombos } from '../../js/model.js';
const entryOf = (v, score = 0.6) => ({ video: v, score, parts: {}, flags: {}, reasons: [] });
const withAreas = (title, min, areas, o = {}) => { const v = vid(title, { min, ...o }); v.profile = { areas, styles: o.styles ?? { stretch: 0.8 }, poses: [] }; return v; };

test('combo: when no single video covers all muscles, it stitches short ones that do, within the time range', () => {
  const neck = withAreas('Neck release', 8, { neck: 0.9 }), hips = withAreas('Hip opener', 10, { hip_flexors: 0.9 }), calves = withAreas('Calf stretch', 7, { calves: 0.9 });
  const mixed = withAreas('Everything a bit', 25, { neck: 0.3, hip_flexors: 0.3, calves: 0.3 });
  const f = { areas: ['neck', 'hip_flexors', 'calves'].map((id) => ({ id, mode: 'tight' })), minMin: 20, maxMin: 30 };
  const { combos, bestSingle } = composeCombos([neck, hips, calves, mixed].map((v) => entryOf(v)), f);
  assert.ok(combos.length >= 1);
  const top = combos[0];
  assert.equal(top.parts.length, 3, 'all three specialists');
  assert.ok(top.totalMin >= 20 && top.totalMin <= 30, `total ${top.totalMin}`);
  assert.ok(top.coverage > 0.8 && top.gain > 0.4, `coverage ${top.coverage}, gain ${top.gain}`);
  assert.equal(bestSingle.entry.video.id, mixed.id, 'the only single video in range is the weak generalist');
});

test('combo: never exceeds the maximum, never falls below the minimum, never uses a video twice', () => {
  const vids = [8, 9, 10, 11, 12, 13].map((m, i) => withAreas(`V${i}`, m, { [['neck', 'hip_flexors', 'calves', 'glutes', 'chest', 'quads'][i]]: 0.9 }));
  const f = { areas: ['neck', 'hip_flexors', 'calves', 'glutes'].map((id) => ({ id, mode: 'tight' })), minMin: 25, maxMin: 36 };
  const { combos } = composeCombos(vids.map((v) => entryOf(v)), f, { n: 5 });
  assert.ok(combos.length > 1);
  for (const c of combos) {
    assert.ok(c.totalMin >= 25 && c.totalMin <= 36, `total ${c.totalMin}`);
    const ids = c.parts.map((p) => p.video.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(c.parts.length <= 4);
  }
  const sets = combos.map((c) => c.parts.map((p) => p.video.id).sort().join());
  assert.equal(new Set(sets).size, sets.length, 'distinct combos');
});

test('combo: a single video that already covers everything is reported as the baseline (gain ~0 or negative)', () => {
  const all = withAreas('Neck + hips + calves', 22, { neck: 0.9, hip_flexors: 0.9, calves: 0.9 });
  const a = withAreas('Neck only', 8, { neck: 0.9 }), b = withAreas('Hips only', 8, { hip_flexors: 0.9 }), c = withAreas('Calves only', 8, { calves: 0.9 });
  const f = { areas: ['neck', 'hip_flexors', 'calves'].map((id) => ({ id, mode: 'tight' })), minMin: 20, maxMin: 26 };
  const r = composeCombos([entryOf(all, 0.9), entryOf(a), entryOf(b), entryOf(c)], f);
  assert.equal(r.bestSingle.entry.video.id, all.id);
  assert.ok(r.combos.every((x) => x.gain < 0.05), 'no combo meaningfully beats it');
});

test('combo: parts are ordered as a gentle arc (flow/mobility first, long holds last)', () => {
  const yin = withAreas('Yin hips', 10, { hip_flexors: 0.9 }, { styles: { yin: 0.9 } });
  const flow = withAreas('Neck flow', 10, { neck: 0.9 }, { styles: { flow: 0.9 } });
  const stretch = withAreas('Calf stretch', 10, { calves: 0.9 }, { styles: { stretch: 0.9 } });
  const f = { areas: ['neck', 'hip_flexors', 'calves'].map((id) => ({ id, mode: 'tight' })), minMin: 28, maxMin: 32 };
  const { combos } = composeCombos([yin, stretch, flow].map((v) => entryOf(v)), f);
  assert.deepEqual(combos[0].parts.map((p) => p.video.title), ['Neck flow', 'Calf stretch', 'Yin hips']);
});

test('combo: edge cases (one muscle, one candidate, nothing fits) return nothing rather than failing', () => {
  const v = withAreas('x', 10, { neck: 0.9 });
  assert.deepEqual(composeCombos([entryOf(v)], { areas: [{ id: 'neck', mode: 'tight' }], minMin: 5, maxMin: 30 }).combos, []);
  assert.deepEqual(composeCombos([entryOf(v)], { areas: [{ id: 'neck', mode: 'tight' }, { id: 'calves', mode: 'tight' }], minMin: 5, maxMin: 30 }).combos, []);
  const long = withAreas('long', 90, { neck: 0.9 }), long2 = withAreas('long2', 90, { calves: 0.9 });
  assert.deepEqual(composeCombos([entryOf(long), entryOf(long2)], { areas: [{ id: 'neck', mode: 'tight' }, { id: 'calves', mode: 'tight' }], minMin: 5, maxMin: 30 }).combos, []);
  assert.deepEqual(composeCombos([], { areas: [] }).combos, []);
});

test('combo: weak spots prefer strengthening videos within a combo', () => {
  const stretchy = withAreas('Glute stretch', 10, { glutes: 0.9 }, { styles: { stretch: 0.9 } });
  const strong = withAreas('Glute strength', 10, { glutes: 0.9 }, { styles: { strength: 0.9 } });
  const neck = withAreas('Neck', 10, { neck: 0.9 });
  const mk2 = (mode) => composeCombos([stretchy, strong, neck].map((v) => entryOf(v)), { areas: [{ id: 'glutes', mode }, { id: 'neck', mode: 'tight' }], minMin: 18, maxMin: 22 }, { n: 1 }).combos[0].parts.map((p) => p.video.title);
  assert.ok(mk2('weak').includes('Glute strength') && !mk2('weak').includes('Glute stretch'));
  assert.ok(mk2('tight').includes('Glute stretch'));
});
