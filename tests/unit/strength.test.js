// The strength engine: catalogue, prescriptions, progression, the builder, templates, stats and storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, BUILT_IN, problemsWith, searchExercises, ladderOf, namesOf, haveSet, customExercise, allExercises, indexExercises } from '../../js/strength/catalog.js';
import { MUSCLES, MUSCLE_BY_ID, EQUIPMENT, areasOfMuscles, SLOTS } from '../../js/strength/muscles.js';
import { defaultRx, describeRx, estimateMinutes, e1rm, suggestNext, nextWeight, summarizeSets } from '../../js/strength/rx.js';
import { suggestMore, fillWorkout, parseRequest, buildFromRequest, orderWorkout, itemFor } from '../../js/strength/builder.js';
import { TEMPLATES, instantiate, bestTemplates, ladderPick } from '../../js/strength/templates.js';
import { lastSets, bestsFor, personalBests, weeklySetsByMuscle, volume, describeSession, exerciseHistory, pushPull } from '../../js/strength/stats.js';
import {
  defaultStrength, normalizeStrength, addCustomExercise, deleteCustomExercise, saveWorkout, deleteWorkout, duplicateWorkout, savePlan, nextInPlan, addGuide, removeGuide, guidesFor,
  logStrength, updateStrengthSession, mergeStrength, recentExercises, catalogById, haveOf, HOME_GYM,
} from '../../js/strength/store.js';
import { freshState, splitState, loadState, mergeImport } from '../../js/state.js';
import { AREAS } from '../../js/lexicon.js';

const BY = indexExercises(EXERCISES);
const HOME = haveSet(HOME_GYM);
const BODY = haveSet([]);
const equipment = { dumbbellKg: [2, 4, 6, 8, 10], cableStepKg: 5, cableMaxKg: 60 };
const ctxFor = (extra = {}) => ({ catalog: EXERCISES, have: HOME, goal: 'running', level: 'intermediate', avoid: [], weakAreas: [], recent: [], exclude: new Set(), ...extra });

// ------------------------------------------------------------ catalogue

test('every exercise is well formed, names never collide, and progressions point at each other', () => {
  for (const e of EXERCISES) assert.deepEqual(problemsWith(e), [], e.id);
  assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length, 'unique ids');
  const seen = new Map();
  for (const e of EXERCISES) for (const n of namesOf(e)) { assert.ok(!seen.has(n) || seen.get(n) === e.id, `"${n}" names both ${seen.get(n)} and ${e.id}`); seen.set(n, e.id); }
  for (const e of EXERCISES) {
    if (e.next) { assert.ok(BY[e.next], `${e.id}.next`); assert.equal(BY[e.next].prev, e.id, `${e.next}.prev should be ${e.id}`); }
    if (e.prev) { assert.ok(BY[e.prev], `${e.id}.prev`); assert.equal(BY[e.prev].next, e.id, `${e.prev}.next should be ${e.id}`); }
  }
  assert.deepEqual(ladderOf('pistol').map((e) => e.id), ['squat_touchdown', 'pistol_box', 'pistol_assisted', 'pistol_eccentric', 'pistol'], 'the pistol ladder, easiest first');
  assert.deepEqual(ladderOf('pullup').map((e) => e.id), ['scap_pullup', 'pullup_negative', 'pullup_jumping', 'pullup']);
  assert.deepEqual(ladderOf('plank'), [], 'no ladder, no list');
});

test('muscles link to real body areas, and the catalogue covers the whole home setup', () => {
  const areaIds = new Set(AREAS.map((a) => a.id));
  for (const m of MUSCLES) assert.ok(areaIds.has(m.area), `${m.id} -> ${m.area}`);
  assert.deepEqual(areasOfMuscles(['delt_front', 'delt_side', 'chest']).sort(), ['chest', 'shoulders']);
  const count = (q) => EXERCISES.filter((e) => e.needs.includes(q)).length;
  assert.ok(count('dumbbell') >= 15 && count('band_loop') >= 8 && count('cable_station') >= 30 && count('pullup_bar') >= 8 && count('feetup') >= 1, JSON.stringify({ d: count('dumbbell'), b: count('band_loop'), c: count('cable_station'), p: count('pullup_bar') }));
  assert.ok(EXERCISES.filter((e) => !e.needs.length).length >= 30, 'plenty to do with no equipment at all');
  for (const id of ['pullup', 'seated_cable_row', 'bench_press', 'lat_pulldown', 'reverse_fly_machine', 'db_lateral_raise', 'plank', 'side_plank', 'hip_hike', 'bulgarian_split_squat', 'single_leg_rdl', 'calf_raise', 'clamshell', 'bird_dog', 'pistol', 'squat_touchdown', 'dead_hang', 'pullup_negative', 'pullup_jumping', 'goblet_squat', 'copenhagen_plank', 'suitcase_carry', 'feetup_headstand', 'burpee', 'lateral_walk', 'monster_walk', 'leg_curl', 'leg_extension', 'cable_crunch_standing', 'pallof_press']) assert.ok(BY[id], id);
  for (const slot of Object.keys(SLOTS)) assert.ok(EXERCISES.some((e) => e.slot === slot), `a ${slot} exercise`);
});

test('searching the catalogue by words, muscle and equipment; your own exercises join in', () => {
  assert.ok(searchExercises(EXERCISES, { q: 'pull ups' }).some((e) => e.id === 'pullup'));
  assert.ok(searchExercises(EXERCISES, { q: 'rear delt' }).every((e) => [...e.primary, ...e.secondary].includes('delt_rear') || namesOf(e).join(' ').includes('rear delt')));
  assert.ok(searchExercises(EXERCISES, { muscle: 'glute_med' }).length >= 10);
  assert.ok(searchExercises(EXERCISES, { equipment: 'bodyweight' }).every((e) => !e.needs.length));
  assert.ok(searchExercises(EXERCISES, { equipment: 'band_loop' }).every((e) => e.needs.includes('band_loop')));
  assert.ok(searchExercises(EXERCISES, { mine: true, have: BODY }).every((e) => !e.needs.length));
  assert.equal(searchExercises(EXERCISES, { q: 'zzzz' }).length, 0);
  const mine = customExercise({ name: 'Sled push', primary: ['quads', 'glutes'], slot: 'squat', type: 'compound', needs: ['nonsense'], level: 9 }, new Set());
  assert.deepEqual(problemsWith(mine), []);
  assert.equal(mine.level, 1); assert.deepEqual(mine.needs, []); assert.ok(mine.id.startsWith('my_sled_push'));
  assert.ok(allExercises([mine, { ...BY.pullup }]).filter((e) => e.id === 'pullup').length === 1, 'a custom copy of a built-in id is ignored');
});

// ------------------------------------------------------------ prescriptions and progression

test('prescriptions follow the goal; holds are seconds; hard bodyweight moves stay in low reps', () => {
  assert.deepEqual([defaultRx(BY.goblet_squat, 'strength').sets, defaultRx(BY.goblet_squat, 'strength').reps], [4, [3, 6]]);
  assert.deepEqual(defaultRx(BY.goblet_squat, 'muscle').reps, [8, 12]);
  assert.deepEqual(defaultRx(BY.db_curl, 'endurance').reps, [15, 20]);
  assert.deepEqual(defaultRx(BY.plank).secs, [20, 45]);
  assert.deepEqual(defaultRx(BY.pullup, 'muscle').reps, [3, 6], 'a pull-up stays low whatever the goal');
  assert.deepEqual(defaultRx(BY.pistol, 'endurance').reps, [12, 16] || [3, 6]);
  assert.equal(defaultRx(BY.hip_hike, 'running').sets, 3);
  assert.equal(describeRx(defaultRx(BY.single_leg_rdl, 'running')), '3 × 6–10 per side');
  assert.equal(describeRx(defaultRx(BY.plank)), '3 × 20–45 s');
  const items = [itemFor(BY.pullup, 'strength'), itemFor(BY.seated_cable_row, 'strength'), itemFor(BY.plank)];
  const mins = estimateMinutes(items, BY);
  assert.ok(mins >= 15 && mins <= 40, `${mins} minutes`);
  assert.equal(estimateMinutes([], BY), 0);
  assert.equal(e1rm(100, 5), 116.7); assert.equal(e1rm(60, 1), 60); assert.equal(e1rm(0, 5), 0);
});

test('what to do next time: more reps first, then more weight from what you own, then something harder', () => {
  const opts = { equipment, goal: 'muscle', byId: BY };
  const first = suggestNext(BY.db_curl, null, opts);
  assert.equal(first.weight, undefined); assert.match(first.note, /Start light/);
  assert.deepEqual(suggestNext(BY.db_curl, [{ reps: 10, weight: 8 }, { reps: 9, weight: 8 }, { reps: 8, weight: 8 }], opts), { weight: 8, reps: 9, note: 'Same weight (8 kg); aim for one more rep on each set.' });
  const up = suggestNext(BY.db_curl, [{ reps: 15, weight: 8 }, { reps: 15, weight: 8 }, { reps: 15, weight: 8 }], opts);
  assert.equal(up.weight, 10); assert.equal(up.reps, 10); assert.match(up.note, /step up to 10 kg/);
  const maxed = suggestNext(BY.db_curl, [{ reps: 15, weight: 10 }, { reps: 15, weight: 10 }, { reps: 15, weight: 10 }], opts);
  assert.equal(maxed.weight, 10); assert.match(maxed.note, /heaviest weight you own/);
  assert.equal(nextWeight(BY.lat_pulldown, 55, equipment), 60); assert.equal(nextWeight(BY.lat_pulldown, 60, equipment), 60, 'the stack ends at 60 kg');
  const cable = suggestNext(BY.seated_cable_row, [{ reps: 12, weight: 40 }, { reps: 12, weight: 40 }, { reps: 12, weight: 40 }], { ...opts, goal: 'muscle' });
  assert.equal(cable.weight, 45);
  const ladder = suggestNext(BY.squat_touchdown, [{ reps: 10 }, { reps: 10 }, { reps: 10 }], { ...opts, goal: 'running' });
  assert.equal(ladder.harder, BY.pistol_box.name); assert.match(ladder.note, /ready for Box pistol/i);
  assert.equal(suggestNext(BY.plank, [{ secs: 30 }], opts).secs, 35);
  assert.match(suggestNext(BY.plank, [{ secs: 45 }], opts).note, /add 5 s/i);
  assert.equal(summarizeSets([{ reps: 8, weight: 20 }, { reps: 8, weight: 20 }, { reps: 8, weight: 20 }]), '3×8 @ 20 kg');
  assert.equal(summarizeSets([{ reps: 8, weight: 20 }, { reps: 6, weight: 22.5 }]), '8 @ 20 kg, 6 @ 22.5 kg');
  assert.equal(summarizeSets([{ secs: 40 }, { secs: 40 }]), '2×40 s');
});

// ------------------------------------------------------------ suggestions

test('"suggest more": after three pulling and pressing lifts it asks for what is missing, and says why', () => {
  const have3 = [itemFor(BY.pullup), itemFor(BY.seated_cable_row), itemFor(BY.bench_press)];
  const out = suggestMore(have3, ctxFor({ goal: 'strength' }));
  assert.ok(out.length >= 4);
  const slots = out.slice(0, 5).map((s) => s.ex.slot);
  assert.ok(slots.includes('core') || slots.includes('rear') || slots.includes('shoulder_iso') || slots.includes('push_v'), slots.join());
  assert.ok(out.every((s) => s.why.length >= 1 && s.ex.slot !== 'squat' && s.ex.slot !== 'hinge'), 'an upper-body start gets upper-body and core suggestions');
  assert.ok(!out.some((s) => ['pullup', 'seated_cable_row', 'bench_press'].includes(s.ex.id)), 'never what is already there');
  assert.ok(!out.some((s) => ['pullup_wide', 'pullup_neutral', 'chinup'].includes(s.ex.id) && s.score > 3), 'a second pull-up variant is not a priority');
  assert.ok(out.every((s, i) => i === 0 || out[i - 1].score >= s.score), 'best first');
  assert.ok(out.some((s) => s.why.some((w) => /rear shoulders|core|shoulders/i.test(w))), JSON.stringify(out.map((s) => [s.ex.id, s.why])));
});

test('suggestions respect equipment, movement limits, the pistol ladder, tired legs, weak spots and target muscles', () => {
  const dumbbellsOnly = haveSet(['dumbbell']);
  const a = suggestMore([itemFor(BY.db_row_one_arm)], ctxFor({ have: dumbbellsOnly, count: 40 }));
  assert.ok(a.every((s) => s.ex.needs.every((n) => dumbbellsOnly.has(n))), 'only what the equipment allows');
  const b = suggestMore([itemFor(BY.db_row_one_arm)], ctxFor({ avoid: ['overhead', 'wrist'], count: 60 }));
  assert.ok(b.every((s) => !s.ex.avoid.includes('overhead') && !s.ex.avoid.includes('wrist')));
  const c = suggestMore([itemFor(BY.pistol_box)], ctxFor({ focus: 'lower', count: 60 }));
  assert.ok(c.every((s) => !['squat_touchdown', 'pistol_assisted', 'pistol_eccentric', 'pistol'].includes(s.ex.id)), 'one rung of a ladder at a time');
  const fresh = suggestMore([], ctxFor({ focus: 'lower', count: 60 }));
  const tired = suggestMore([], ctxFor({ focus: 'lower', count: 60, legsFatigued: true }));
  const rank = (list, id) => list.findIndex((s) => s.ex.id === id);
  assert.ok(rank(tired, 'bulgarian_split_squat') === -1 || rank(tired, 'bulgarian_split_squat') > rank(fresh, 'bulgarian_split_squat'), 'heavy leg work after a hard run drops down');
  const t = suggestMore([], ctxFor({ targetMuscles: ['glute_med'], count: 30 }));
  assert.ok(t.length >= 8 && t.every((s) => [...s.ex.primary, ...s.ex.secondary].includes('glute_med')));
  const weak = suggestMore([itemFor(BY.pullup)], ctxFor({ weakAreas: ['outer_hip'], focus: 'full', count: 60 }));
  const plain = suggestMore([itemFor(BY.pullup)], ctxFor({ focus: 'full', count: 60 }));
  const best = (list) => Math.max(...list.filter((s) => s.ex.primary.includes('glute_med')).map((s) => s.score));
  assert.ok(best(weak) > best(plain), 'a weak spot lifts what works it');
  assert.ok(!suggestMore([], ctxFor({ count: 100 })).some((s) => s.ex.id === 'burpee'), 'burpees are not suggested unless you want conditioning');
  const beginner = suggestMore([], ctxFor({ level: 'beginner', focus: 'upper', count: 3 }));
  assert.ok(beginner.every((s) => s.ex.level <= 2), 'a beginner is not led to the hardest moves first');
});

test('filling a workout to a time: balanced, no duplicates, compounds first, and nothing you did not allow', () => {
  const { items, added, minutes } = fillWorkout([itemFor(BY.pullup, 'strength')], { ...ctxFor({ goal: 'strength' }), minutes: 45, focus: 'upper' });
  const ids = items.map((i) => i.exId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(items.length >= 5 && items.length <= 12, `${items.length} exercises`);
  assert.ok(minutes >= 35 && minutes <= 55, `${minutes} min`);
  assert.equal(items[0].exId, 'pullup', 'what you put first stays first');
  assert.ok(added.every((a) => a.why.length), 'each addition explains itself');
  const types = items.map((i) => BY[i.exId].type);
  const firstAccessory = types.findIndex((t) => t !== 'compound');
  assert.ok(types.slice(firstAccessory).every((t) => t !== 'compound') || firstAccessory < 0, `compounds come first: ${types.join()}`);
  const body = fillWorkout([], { ...ctxFor({ have: BODY, goal: 'general' }), minutes: 30 });
  assert.ok(body.items.length >= 4 && body.items.every((i) => BY[i.exId].needs.length === 0));
  assert.deepEqual(orderWorkout([itemFor(BY.plank), itemFor(BY.pullup), itemFor(BY.db_curl)], BY).map((i) => i.exId), ['pullup', 'db_curl', 'plank']);
});

// ------------------------------------------------------------ describing a workout

test('a description is understood: length, focus, goal, equipment, limits, named exercises and exclusions', () => {
  const a = parseRequest('40 minutes upper body with dumbbells only, no overhead work, to support my running');
  assert.deepEqual({ m: a.minutes, f: a.focus, e: a.onlyEquipment, av: a.avoid, g: a.goal }, { m: 40, f: 'upper', e: ['dumbbell'], av: ['overhead'], g: 'running' });
  const b = parseRequest('pistol squat progression and side plank, no burpees');
  assert.deepEqual(b.seeds.sort(), ['pistol', 'side_plank'].sort());
  assert.deepEqual(b.exclude, ['burpee']);
  const c = parseRequest('3 days a week full body, I want to get stronger');
  assert.deepEqual({ d: c.days, f: c.focus, g: c.goal }, { d: 3, f: 'full', g: 'strength' });
  const d = parseRequest('lower back and glute medius, 20 min, no equipment');
  assert.deepEqual({ m: d.minutes, e: d.onlyEquipment }, { m: 20, e: [] });
  assert.ok(d.muscles.includes('lower_back') && d.muscles.includes('glute_med'));
  assert.equal(d.focus, null, '"lower back" is a muscle, not "lower body"');
  const e = parseRequest('quick pull up bar session');
  assert.equal(e.minutes, 20); assert.deepEqual(e.prefer, ['pullup_bar']); assert.deepEqual(e.seeds, [], '"pull up bar" is equipment, not the exercise');
  assert.match(parseRequest('upper body for muscle').understood.join(' '), /upper body/);
  assert.deepEqual(parseRequest('hello there').understood, []);
  assert.deepEqual(parseRequest('bad knees, 30 minutes legs').avoid, ['knee']);
});

test('building from a description uses what you have and tells you what it understood', () => {
  const up = buildFromRequest('45 minutes upper body, strength', ctxFor({ goal: 'general' }));
  assert.match(up.interpretation, /upper body/); assert.match(up.name, /Upper body/);
  const slots = new Set(up.items.map((i) => BY[i.exId].slot));
  for (const s of ['pull_v', 'push_h']) assert.ok([...slots].some((x) => x === s || (s === 'pull_v' && x === 'pull_h')), `has ${s}: ${[...slots]}`);
  assert.ok(up.items.every((i) => ['upper', 'core'].includes(SLOTS[BY[i.exId].slot].group)), 'only upper body and core');
  const db = buildFromRequest('dumbbells only, legs', ctxFor());
  assert.ok(db.items.length >= 3 && db.items.every((i) => BY[i.exId].needs.every((n) => ['dumbbell'].includes(n))), db.items.map((i) => i.exId).join());
  const seeded = buildFromRequest('pistol squat and pull-ups, 40 minutes', ctxFor());
  assert.ok(seeded.items.some((i) => i.exId === 'pistol') && seeded.items.some((i) => i.exId === 'pullup'));
  const noKit = buildFromRequest('cables only', ctxFor({ have: BODY }));
  assert.ok(noKit.notes.some((n) => /not ticked in Setup/.test(n)));
  const excluded = buildFromRequest('full body, no plank', ctxFor());
  assert.ok(!excluded.items.some((i) => i.exId === 'plank'));
  const lost = buildFromRequest('qwerty', ctxFor());
  assert.match(lost.interpretation, /balanced workout/); assert.ok(lost.items.length >= 4);
});

// ------------------------------------------------------------ templates

test('templates turn into real workouts with the equipment you have; anchors are marked; ladders start where you are', () => {
  const abc = instantiate(TEMPLATES.find((t) => t.id === 'runner_abc'), ctxFor());
  assert.deepEqual(abc.workouts.map((w) => w.name), ['A · Upper body + core', 'B · Legs, running stability + core', 'C · Full body strength']);
  const ids = (n) => abc.workouts[n].items.map((i) => i.exId);
  assert.deepEqual(ids(0), ['pullup', 'seated_cable_row', 'bench_press', 'lat_pulldown', 'reverse_fly_machine', 'db_lateral_raise', 'plank', 'side_plank', 'hip_hike']);
  assert.deepEqual(ids(1).slice(0, 5), ['squat_touchdown', 'bulgarian_split_squat', 'single_leg_rdl', 'hip_hike', 'calf_raise']);
  assert.ok(ids(1).includes('clamshell') && ids(1).includes('bird_dog') && ids(1).includes('plank'));
  assert.ok(ids(2).includes('goblet_squat') && ids(2).includes('single_leg_rdl'));
  assert.ok(abc.workouts[0].items[0].anchor && !abc.workouts[0].items.find((i) => i.exId === 'side_plank').anchor);
  const later = instantiate(TEMPLATES.find((t) => t.id === 'runner_abc'), ctxFor({ recent: [{ exId: 'pistol_assisted' }] }));
  assert.equal(later.workouts[1].items[0].exId, 'pistol_assisted', 'it starts on the rung you are on');
  assert.equal(ladderPick('squat_touchdown', new Set(), EXERCISES).id, 'squat_touchdown');
  const bodyOnly = instantiate(TEMPLATES.find((t) => t.id === 'runner_abc'), ctxFor({ have: BODY }));
  for (const w of bodyOnly.workouts) for (const i of w.items) assert.ok(BY[i.exId].needs.every((n) => n === 'bodyweight'), i.exId);
  assert.ok(bodyOnly.notes.length >= 1 && bodyOnly.workouts[0].items.some((i) => i.exId === 'pushup'));
  const avoided = instantiate(TEMPLATES.find((t) => t.id === 'runner_abc'), ctxFor({ avoid: ['hanging'] }));
  assert.ok(!avoided.workouts[0].items.some((i) => i.exId === 'pullup'), 'a limit removes the exercise');
});

test('every template works with the home setup and with nothing at all, and the best fit for a request comes first', () => {
  for (const tpl of TEMPLATES) {
    for (const have of [HOME, BODY]) {
      const { workouts } = instantiate(tpl, ctxFor({ have }));
      assert.equal(workouts.length, tpl.days.length, tpl.id);
      for (const w of workouts) {
        assert.ok(w.items.length >= (have === HOME ? 3 : 2), `${tpl.id} ${w.name} (${w.items.length})`);
        assert.equal(new Set(w.items.map((i) => i.exId)).size, w.items.length, 'no duplicates in a day');
      }
    }
  }
  assert.equal(bestTemplates({ days: 4 }, ctxFor({ goal: 'muscle' }))[0].id, 'upper_lower_4');
  assert.equal(bestTemplates({ days: 2, goal: 'running' }, ctxFor())[0].id, 'pistol_path');
  assert.equal(bestTemplates({ days: 3, goal: 'running' }, ctxFor())[0].id, 'runner_abc');
});

// ------------------------------------------------------------ stats

const sess = (id, date, exercises, extra = {}) => ({ id, at: `${date}T09:00:00.000Z`, date, kind: 'strength', videoId: '', title: 'S', exercises, areas: [], ratings: {}, ...extra });
const set = (reps, weight, extra = {}) => ({ reps, weight, ...extra });

test('what you did last time, personal bests, volume and sets per muscle', () => {
  const h = [
    sess('a', '2026-03-02', [{ exId: 'db_curl', sets: [set(10, 8), set(9, 8)] }, { exId: 'plank', sets: [{ secs: 30 }] }]),
    sess('b', '2026-03-09', [{ exId: 'db_curl', sets: [set(12, 8), set(12, 8), set(10, 8)] }, { exId: 'seated_cable_row', sets: [set(10, 40)] }]),
    sess('c', '2026-03-10', [{ exId: 'db_curl', sets: [set(8, 10)] }, { exId: 'plank', sets: [{ secs: 45 }] }, { exId: 'pullup', sets: [{ reps: 4 }] }]),
  ];
  assert.deepEqual(lastSets(h, 'db_curl'), [set(8, 10)]);
  assert.equal(lastSets(h, 'squat'), null);
  assert.deepEqual(exerciseHistory(h, 'db_curl').map((x) => x.date), ['2026-03-10', '2026-03-09', '2026-03-02']);
  assert.equal(bestsFor(h, 'db_curl').e1rm, e1rm(10, 8));
  assert.equal(bestsFor(h, 'plank').secs, 45);
  assert.equal(bestsFor(h, 'pullup').reps, 4);
  const pbs = personalBests(h[2], h);
  assert.deepEqual(pbs.map((p) => [p.exId, p.kind]).sort(), [['db_curl', 'weight'], ['plank', 'time']]);
  assert.deepEqual(personalBests(h[0], h), [], 'the first time is a start, not a record');
  assert.equal(volume(h[1]), 12 * 8 + 12 * 8 + 10 * 8 + 10 * 40);
  assert.match(describeSession(h[1]), /2 exercises · 4 sets · 672 kg moved/);
  const weeks = weeklySetsByMuscle(h, BY, { weeks: 2, today: '2026-03-11' });
  assert.deepEqual(weeks.biceps, [2, 5.5], 'two curl sets the week before; this week 4 curl sets + a pull-up set, and half a set for the row');
  assert.ok(weeks.upper_back[1] >= 1 + 0.5, 'primary sets count fully, secondary half');
  const pp = pushPull(h, BY, { days: 28, today: '2026-03-11' });
  assert.ok(pp.pull > 0 && pp.push === 0);
});

// ------------------------------------------------------------ storage

test('saved strength data is read defensively', () => {
  assert.deepEqual(normalizeStrength(null), defaultStrength());
  const n = normalizeStrength({
    equipment: { configured: 1, have: ['dumbbell', 'laser', 'bodyweight'], dumbbellKg: ['x', 4, 2, -1], cableStepKg: 'a', bandLevels: [] },
    prefs: { goal: 'nonsense', level: 'expert', minutes: 9999, avoid: ['knee', 'bogus'], excluded: [5, 'burpee'] },
    custom: [{ id: 'pullup', name: 'Fake' }, { id: 'my_x', name: 'X', primary: ['chest'], slot: 'push_h', type: 'accessory' }, 'junk'],
    workouts: [{ id: 'w', name: 'W', items: [{ exId: 'plank', sets: 99, secs: [60, 20] }, { exId: 5 }, { exId: 'pullup', reps: [0, 999] }] }, { name: 'no id' }],
    plans: [{ id: 'p', name: 'P', workoutIds: ['w', 5] }],
    guides: { plank: [{ id: 'dQw4w9WgXcQ', title: 'T' }, { id: 'short' }], bad: 'x' },
  });
  assert.deepEqual(n.equipment.have, ['dumbbell']);
  assert.deepEqual(n.equipment.dumbbellKg, [2, 4]); assert.equal(n.equipment.cableStepKg, 5); assert.deepEqual(n.equipment.bandLevels, ['light', 'medium', 'heavy']);
  assert.deepEqual(n.prefs, { goal: 'general', level: 'intermediate', minutes: 120, avoid: ['knee'], excluded: ['burpee'], legsFatigued: false });
  assert.deepEqual(n.custom.map((e) => e.id), ['my_x']);
  assert.deepEqual(n.workouts[0].items, [{ exId: 'plank', sets: 12, secs: [20, 60] }, { exId: 'pullup', sets: 3, reps: [1, 300] }]);
  assert.deepEqual(n.plans[0].workoutIds, ['w']);
  assert.deepEqual(Object.keys(n.guides), ['plank']); assert.equal(n.guides.plank.length, 1);
});

test('your own exercises, saved workouts, plans and guide videos', () => {
  const s = freshState();
  const e = addCustomExercise(s, { name: 'Sled push', primary: ['quads'], slot: 'squat', type: 'compound' });
  assert.equal(catalogById(s)[e.id].name, 'Sled push');
  assert.equal(addCustomExercise(s, { name: '', primary: ['quads'] }), null); assert.equal(addCustomExercise(s, { name: 'No muscle' }), null);
  assert.equal(addCustomExercise(s, { name: 'Sled push', primary: ['glutes'] }).id, `${e.id}_2`, 'a second one with the same name gets its own id');
  const w = saveWorkout(s, { name: 'Upper A', items: [itemFor(BY.pullup), itemFor(BY.plank)] });
  assert.equal(s.strength.workouts.length, 1);
  saveWorkout(s, { ...w, name: 'Upper A+' });
  assert.equal(s.strength.workouts.length, 1); assert.equal(s.strength.workouts[0].name, 'Upper A+');
  const copy = duplicateWorkout(s, w.id);
  assert.equal(copy.name, 'Upper A+ (copy)'); assert.notEqual(copy.id, w.id);
  const plan = savePlan(s, { name: 'Mine', workoutIds: [w.id, copy.id] });
  assert.equal(nextInPlan(s, plan).id, w.id, 'nothing done yet: start at the first');
  logStrength(s, { workoutId: w.id, title: 'Upper A+', exercises: [{ exId: 'pullup', sets: [{ reps: 3 }] }] });
  assert.equal(nextInPlan(s, plan).id, copy.id, 'then the next one');
  logStrength(s, { workoutId: copy.id, exercises: [] });
  assert.equal(nextInPlan(s, plan).id, w.id, 'and round again');
  deleteWorkout(s, copy.id);
  assert.deepEqual(s.strength.plans[0].workoutIds, [w.id]);
  // guide videos
  assert.equal(addGuide(s, 'plank', { id: 'dQw4w9WgXcQ', title: 'Plank form', channel: 'Coach' }), true);
  assert.equal(addGuide(s, 'plank', { id: 'dQw4w9WgXcQ' }), false, 'no duplicates');
  assert.equal(addGuide(s, 'plank', { id: 'nope' }), false);
  for (let i = 0; i < 12; i++) addGuide(s, 'plank', { id: `abcdefghi${String(i).padStart(2, '0')}` });
  assert.equal(guidesFor(s, 'plank').length, 8, 'a handful per exercise');
  removeGuide(s, 'plank', 'dQw4w9WgXcQ');
  assert.ok(!guidesFor(s, 'plank').some((g) => g.id === 'dQw4w9WgXcQ'));
  addGuide(s, e.id, { id: 'dQw4w9WgXcQ' }); deleteCustomExercise(s, e.id);
  assert.deepEqual(guidesFor(s, e.id), [], 'a deleted exercise takes its guides with it');
});

test('logging a session: sets are optional, areas follow the exercises, and it can be edited', () => {
  const s = freshState();
  const rec = logStrength(s, { title: 'Legs', minutes: 50, exercises: [
    { exId: 'bulgarian_split_squat', sets: [{ reps: '8', weight: '10' }, { reps: 8, weight: 10 }, {}] }, { exId: 'calf_raise' }, { exId: 'nonsense-but-kept' }, 7,
  ], note: 'felt strong' });
  assert.equal(rec.kind, 'strength'); assert.equal(rec.videoId, ''); assert.equal(rec.durationSec, 3000);
  assert.deepEqual(rec.exercises[0].sets, [{ reps: 8, weight: 10 }, { reps: 8, weight: 10 }], 'empty sets are dropped, numbers typed as text are read');
  assert.deepEqual(rec.exercises[1].sets, [], 'an exercise with no numbers still counts as done');
  assert.deepEqual(rec.areas.map((a) => a.id).sort(), ['calves', 'glutes', 'quads']);
  assert.equal(logStrength(s, { date: '2999-01-01', exercises: [] }).date, logStrength(s, { exercises: [] }).date, 'never in the future');
  updateStrengthSession(s, rec.id, { exercises: [{ exId: 'plank', sets: [{ secs: 40 }] }], minutes: 20, date: '2020-01-02', note: 'edited' });
  assert.deepEqual({ d: rec.date, m: rec.durationSec, n: rec.note, a: rec.areas.map((x) => x.id) }, { d: '2020-01-02', m: 1200, n: 'edited', a: ['core'] });
  assert.equal(updateStrengthSession(s, 'missing', {}), null);
  assert.ok(recentExercises(s, { days: 36500, today: '2026-03-11' }).some((r) => r.exId === 'plank'));
});

test('strength data is saved with the profile, survives a reload, and merges from a backup', () => {
  const a = freshState();
  a.strength.equipment = { ...a.strength.equipment, configured: true, have: HOME_GYM };
  saveWorkout(a, { id: 'w1', name: 'Keep', items: [itemFor(BY.plank)] });
  addCustomExercise(a, { name: 'Sled push', primary: ['quads'], slot: 'squat' });
  addGuide(a, 'plank', { id: 'dQw4w9WgXcQ', title: 'Form' });
  const { profile, index } = splitState(a);
  assert.ok(profile.strength.workouts.length === 1);
  const back = loadState({ profile: JSON.parse(JSON.stringify(profile)), index: JSON.parse(JSON.stringify(index)) }).state;
  assert.equal(back.strength.workouts[0].name, 'Keep'); assert.deepEqual(back.strength.equipment.have, HOME_GYM); assert.equal(haveOf(back).has('cable_station'), true);
  assert.equal(guidesFor(back, 'plank')[0].title, 'Form');
  const old = JSON.parse(JSON.stringify(profile)); delete old.strength;
  assert.deepEqual(loadState({ profile: old, index }).state.strength, defaultStrength(), 'data from before this section loads fine');
  const other = freshState();
  saveWorkout(other, { id: 'w1', name: 'Other copy', items: [itemFor(BY.plank)] });
  saveWorkout(other, { id: 'w2', name: 'New one', items: [itemFor(BY.pullup)] });
  mergeImport(other, splitState(a));
  assert.deepEqual(other.strength.workouts.map((w) => w.name).sort(), ['New one', 'Other copy'], 'the same id keeps what is here; new ones are added');
  assert.equal(other.strength.custom.length, 1); assert.equal(guidesFor(other, 'plank').length, 1);
  assert.equal(other.strength.equipment.configured, true, 'equipment comes along when this copy had none set');
});
