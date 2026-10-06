// The AI coach, client side: what Claude is told, and how its answer is checked before anything reaches the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, BUILT_IN } from '../../js/strength/catalog.js';
import { HOME_GYM } from '../../js/strength/store.js';
import { candidatesFor, catalogueLines, systemPrompt, workoutRequest, ideasRequest, readWorkouts, readIdeas, recentLines, WORKOUTS_SCHEMA, IDEAS_SCHEMA } from '../../js/strength/coach.js';

const base = (extra = {}) => ({
  catalog: EXERCISES, have: new Set(['bodyweight', ...HOME_GYM]), avoid: [], exclude: new Set(), goal: 'strength', level: 'intermediate', minutes: 45, perWeek: 3,
  weakAreas: [], history: [], today: '2026-10-06', equipment: { dumbbellKg: [2, 4, 6, 8, 10], cableStepKg: 5, cableMaxKg: 60, bandLevels: ['light'] }, ...extra,
});

test('Claude is only offered what the person can do: equipment, avoided movements and "never suggest" are applied first', () => {
  const all = candidatesFor(base());
  const bodyOnly = candidatesFor(base({ have: new Set(['bodyweight']) }));
  assert.ok(all.length > bodyOnly.length && bodyOnly.length > 10);
  assert.ok(bodyOnly.every((e) => e.needs.length === 0), 'bodyweight only means no equipment needed');
  assert.ok(!bodyOnly.some((e) => e.id === 'pullup'), 'no pull-up bar, no pull-ups');
  const noOverhead = candidatesFor(base({ avoid: ['overhead'] }));
  assert.ok(noOverhead.every((e) => !(e.avoid ?? []).includes('overhead')));
  assert.ok(all.some((e) => (e.avoid ?? []).includes('overhead')), 'it really was in the list before');
  assert.ok(!candidatesFor(base({ exclude: new Set(['plank']) })).some((e) => e.id === 'plank'));
  const lines = catalogueLines(base());
  assert.equal(lines.length, all.length);
  assert.ok(lines.some((l) => l.startsWith('pullup | Pull-up | pull_v | lats,biceps |')), 'id, name, movement and muscles are on every line');
  assert.ok(lines.every((l) => !l.endsWith(' | ')), 'no dangling separator');
  assert.match(lines.find((l) => l.startsWith('pullup_negative |')), /harder: pullup_jumping$/, 'the next rung of a progression is named');
  assert.ok(!/harder:/.test(lines.find((l) => l.startsWith('pullup |'))), 'the top rung has none');
});

test('the long part of the question is identical for the same setup (so it can be cached) and changes with the equipment', () => {
  const a = systemPrompt(base()), b = systemPrompt(base({ minutes: 20, goal: 'muscle', weakAreas: ['hips'], history: [{ kind: 'strength', date: '2026-10-05', title: 'x', exercises: [] }] }));
  assert.equal(a, b, 'goal, time and history live in the question, not in the cached part');
  assert.notEqual(a, systemPrompt(base({ have: new Set(['bodyweight']) })));
  assert.match(a, /CATALOGUE/);
  assert.match(a, /never invent an exercise/);
  assert.ok(a.length < 40000, `${a.length} characters is well inside the limit the server accepts (60000)`);
});

test('the question carries the request, the person\'s settings and the recent sessions, and nothing else of theirs', () => {
  const history = [
    { kind: 'strength', date: '2026-10-04', title: 'Upper A', exercises: [{ exId: 'pullup', name: 'Pull-up', sets: [{ reps: 6 }, { reps: 6 }, { reps: 5 }] }, { exId: 'seated_cable_row', name: 'Seated cable row', sets: [{ reps: 10, weight: 40 }, { reps: 10, weight: 40 }] }] },
    { kind: 'strength', date: '2026-08-01', title: 'Too old', exercises: [{ exId: 'plank', sets: [{ secs: 30 }] }] },
    { kind: 'stretch', date: '2026-10-05', title: 'Secret hip video', videoId: 'abc', note: 'my private note about my knee' },
  ];
  const r = workoutRequest('legs and hip stability for running, 40 min', base({ goal: 'running', weakAreas: ['hip_flexors'], legsFatigued: true, history }));
  assert.match(r.prompt, /legs and hip stability for running, 40 min/);
  assert.match(r.prompt, /Strength for running/);
  assert.match(r.prompt, /aims for 3 strength sessions a week/);
  assert.match(r.prompt, /Dumbbells: 2, 4, 6, 8, 10 kg each/);
  assert.match(r.prompt, /Wants to strengthen: hip flexors/);
  assert.match(r.prompt, /Legs are tired/);
  assert.match(r.prompt, /2026-10-04 Upper A: Pull-up 3×6|2026-10-04 Upper A: Pull-up 6, 6, 5/);
  assert.match(r.prompt, /Seated cable row 2×10 @ 40 kg/);
  assert.ok(!r.prompt.includes('Too old') && !r.prompt.includes('Secret hip video') && !r.prompt.includes('private note'), 'old sessions, stretching history and notes are not sent');
  assert.equal(r.schema, WORKOUTS_SCHEMA);
  assert.ok(r.maxTokens >= 4000 && r.maxTokens <= 12000);
  assert.deepEqual(recentLines({ history, catalog: EXERCISES, today: '2026-10-06' }).length, 1);
  const long = workoutRequest('x'.repeat(5000), base());
  assert.ok(long.prompt.length < 6000, 'a pasted essay is cut down');
});

test('the answer schemas are closed objects with everything required (what structured outputs accept)', () => {
  const check = (node, where) => {
    if (node && typeof node === 'object') {
      if (node.type === 'object') {
        assert.equal(node.additionalProperties, false, `${where} is closed`);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${where}: every property is required`);
      }
      for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'default']) assert.ok(!(banned in node), `${where} uses ${banned}, which the API may refuse`);
      for (const [k, v] of Object.entries(node)) check(v, `${where}.${k}`);
    }
  };
  check(WORKOUTS_SCHEMA, 'workouts'); check(IDEAS_SCHEMA, 'ideas');
  assert.ok(JSON.stringify(WORKOUTS_SCHEMA).length < 3000);
});

const answer = (items, extra = {}) => ({ title: 'Upper strength', explanation: 'Pull, push, then core.', notes: ['Pick weights you could lift 2 more times.'], workouts: [{ name: 'Upper A', items }], ...extra });
const row = (exercise_id, o = {}) => ({ exercise_id, sets: 3, reps_low: 6, reps_high: 10, seconds_low: 0, seconds_high: 0, why: 'because', ...o });

test('a good answer becomes workouts the builder understands: sets, ranges, reasons', () => {
  const r = readWorkouts(answer([row('pullup', { sets: 4, reps_low: 3, reps_high: 6, why: 'your main vertical pull' }), row('seated_cable_row'), row('plank', { reps_low: 0, reps_high: 0, seconds_low: 30, seconds_high: 45 })]), base());
  assert.equal(r.title, 'Upper strength');
  assert.equal(r.explanation, 'Pull, push, then core.');
  assert.deepEqual(r.notes, ['Pick weights you could lift 2 more times.']);
  assert.equal(r.workouts.length, 1);
  const w = r.workouts[0];
  assert.equal(w.name, 'Upper A');
  assert.deepEqual(w.items[0], { exId: 'pullup', sets: 4, reps: [3, 6] });
  assert.deepEqual(w.items[1], { exId: 'seated_cable_row', sets: 3, reps: [6, 10] });
  assert.deepEqual(w.items[2], { exId: 'plank', sets: 3, secs: [30, 45] }, 'held exercises use seconds');
  assert.equal(w.why.pullup, 'your main vertical pull');
  assert.deepEqual(r.problems, []);
});

test('anything Claude makes up or that the person cannot do is dropped and said so; the rest is kept', () => {
  const o = base({ have: new Set(['bodyweight', 'dumbbell']), avoid: ['wrist'], exclude: new Set(['plank']) });
  const r = readWorkouts(answer([row('pullup'), row('turbo_squat_9000'), row('pushup'), row('db_row_one_arm'), row('plank'), row('db_row_one_arm'), row(''), { why: 'no id at all' }, null, 'string']), o);
  const ids = r.workouts[0].items.map((i) => i.exId);
  assert.deepEqual(ids, ['db_row_one_arm'], 'no pull-up bar, an invented id, a wrist-loading push-up, a never-suggest plank, duplicates and junk are all gone');
  assert.ok(r.problems.some((p) => p.includes('pullup')) && r.problems.some((p) => p.includes('turbo_squat_9000')));
  assert.ok(r.problems.length <= 5);
  const none = readWorkouts(answer([row('nonsense')]), base());
  assert.deepEqual(none.workouts, [], 'a workout with nothing usable is not offered at all');
});

test('numbers are clamped and repaired; the wrong kind of number falls back to the exercise\'s usual prescription', () => {
  const r = readWorkouts(answer([
    row('seated_cable_row', { sets: 99, reps_low: 20, reps_high: 5 }),            // too many sets; range the wrong way round
    row('db_lateral_raise', { sets: 0, reps_low: 0, reps_high: 0 }),               // nothing given
    row('plank', { reps_low: 12, reps_high: 12, seconds_low: 0, seconds_high: 0 }), // reps for a timed exercise
    row('pullup', { reps_low: 1000, reps_high: 2000 }),
    row('hip_hike', { reps_low: 8, reps_high: 0 }),                                 // one end only
    row('side_plank', { seconds_low: -5, seconds_high: 'lots' }),
  ]), base());
  const by = Object.fromEntries(r.workouts[0].items.map((i) => [i.exId, i]));
  assert.deepEqual(by.seated_cable_row, { exId: 'seated_cable_row', sets: 8, reps: [5, 20] });
  assert.equal(by.db_lateral_raise.sets, 3, 'zero sets means the usual number');
  assert.ok(Array.isArray(by.db_lateral_raise.reps) && by.db_lateral_raise.reps[0] > 0);
  assert.ok(by.plank.secs && !by.plank.reps, 'a held exercise is never given reps');
  assert.deepEqual(by.pullup.reps, [60, 60]);
  assert.deepEqual(by.hip_hike.reps, [8, 8]);
  assert.ok(by.side_plank.secs[0] > 0);
});

test('a plan (several days) is kept, capped at six, and weird answers never throw', () => {
  const day = (n) => ({ name: `Day ${n}`, items: [row('pullup'), row('pushup')] });
  const plan = readWorkouts({ title: 'Week', explanation: 'x', notes: [], workouts: [1, 2, 3, 4, 5, 6, 7, 8].map(day) }, base());
  assert.equal(plan.workouts.length, 6);
  assert.equal(plan.workouts[5].name, 'Day 6');
  for (const junk of [null, undefined, 'text', 5, [], {}, { workouts: 'x' }, { workouts: [null, 3, { items: 'no' }] }, { workouts: [{ name: 'x', items: [{ exercise_id: { evil: 1 } }] }] }]) {
    const r = readWorkouts(junk, base());
    assert.deepEqual(r.workouts, []);
    assert.equal(typeof r.explanation, 'string');
    assert.ok(Array.isArray(r.notes) && Array.isArray(r.problems));
  }
  const long = readWorkouts({ title: 't'.repeat(500), explanation: 'e'.repeat(5000), notes: Array.from({ length: 20 }, () => 'n'.repeat(1000)), workouts: [] }, base());
  assert.ok(long.title.length <= 80 && long.explanation.length <= 700 && long.notes.length <= 6 && long.notes.every((n) => n.length <= 300));
});

test('ideas: what is already in the workout is not suggested again; unknown ids are dropped; the shape matches the suggestion list', () => {
  const draft = { name: 'Upper A', items: [{ exId: 'pullup', sets: 3, reps: [3, 6] }] };
  const q = ideasRequest(draft, base(), 4);
  assert.match(q.prompt, /Suggest 4 exercises/);
  assert.match(q.prompt, /pullup \(Pull-up\) 3 sets/);
  assert.equal(q.schema, IDEAS_SCHEMA);
  const r = readIdeas({ summary: 'You have a pull but no press or core.', ideas: [{ exercise_id: 'pullup', why: 'again' }, { exercise_id: 'pushup', why: 'a horizontal press' }, { exercise_id: 'made_up', why: 'x' }, { exercise_id: 'pushup', why: 'twice' }, { exercise_id: 'plank', why: '' }] }, base(), draft.items);
  assert.deepEqual(r.ideas.map((i) => i.ex.id), ['pushup', 'plank']);
  assert.equal(r.ideas[0].ex, BUILT_IN.pushup, 'the full exercise, like the rule-based suggestions');
  assert.deepEqual(r.ideas[0].why, ['a horizontal press']);
  assert.ok(r.ideas[1].why[0], 'an empty reason still says where the idea came from');
  assert.equal(r.problems.length, 1);
  assert.equal(r.summary, 'You have a pull but no press or core.');
  assert.deepEqual(readIdeas(null, base()).ideas, []);
});
