// Ready-made plans. A template is not a fixed list of exercises: each line names what it wants (an exercise, a few
// alternatives in order of preference, a movement slot, or a progression ladder) and is turned into real
// exercises with the equipment you have ticked. Lines marked `anchor` are the main lifts that stay put for 6-8 weeks;
// the rest can be rotated.

import { EXERCISES, indexExercises, doable, hasAvoided, ladderOf } from './catalog.js';
import { suggestMore, itemFor } from './builder.js';
import { SLOTS } from './muscles.js';

const PULLUPS = ['pullup', 'pullup_jumping', 'pullup_negative', 'lat_pulldown'];
const PRESSES = ['bench_press', 'db_bench_press', 'db_floor_press', 'pushup'];
const ROWS = ['seated_cable_row', 'db_row_one_arm', 'db_row_bent'];
const REAR = ['reverse_fly_machine', 'db_rear_delt_raise', 'band_pull_apart'];

export const TEMPLATES = [
  {
    id: 'runner_abc', name: 'Runner’s strength, 3 days', goal: 'running', level: 'intermediate',
    blurb: 'Upper body + core, legs + running stability, full body. Pull-ups, rows, bench, single-leg strength and hip stability as the stable core of the plan.',
    tips: ['Keep the main (anchor) lifts the same for 6–8 weeks so progress is measurable; rotate the accessories.', 'Do the leg day away from your hardest run, and skip the optional lines when running load is high.'],
    days: [
      { name: 'A · Upper body + core', focus: 'upper', entries: [
        { alt: PULLUPS, anchor: true }, { alt: ROWS, anchor: true }, { alt: PRESSES, anchor: true }, { alt: ['lat_pulldown'], optional: true },
        { alt: REAR }, { alt: ['db_lateral_raise', 'cable_lateral_raise'] }, 'plank', 'side_plank', 'hip_hike'] },
      { name: 'B · Legs, running stability + core', focus: 'lower', entries: [
        { ladder: 'squat_touchdown', anchor: true, note: 'Move up the ladder when every set is clean.' }, { alt: ['bulgarian_split_squat'], anchor: true }, { alt: ['single_leg_rdl', 'db_rdl', 'glute_bridge'], anchor: true },
        'hip_hike', 'calf_raise', 'clamshell', 'bird_dog', { alt: ['plank', 'side_plank'], optional: true }, { alt: ['leg_curl', 'leg_extension', 'cable_hip_abduction'], optional: true }] },
      { name: 'C · Full body strength', focus: 'full', entries: [
        { alt: PULLUPS, anchor: true }, { alt: PRESSES, anchor: true }, { alt: ROWS }, { alt: ['goblet_squat', 'squat_bodyweight', 'bulgarian_split_squat'] },
        { alt: ['single_leg_rdl', 'db_rdl'] }, { alt: REAR }, { alt: ['plank', 'side_plank'] }, 'hip_hike', { alt: ['db_curl', 'cable_pushdown', 'cable_fly'], optional: true }] },
    ],
  },
  {
    id: 'pistol_path', name: 'Pistol squat path, 2 days', goal: 'running', level: 'intermediate',
    blurb: 'Single-leg strength built around the pistol-squat ladder (touch-down → box → assisted → slow lowering → pistol), plus hips and calves.',
    tips: ['Stay on a rung until all sets are controlled and pain-free, then move up one.', 'Two days a week is enough; leave at least a day between them.'],
    days: [
      { name: 'Day 1 · Ladder + posterior chain', focus: 'lower', entries: [{ ladder: 'squat_touchdown', anchor: true }, { alt: ['bulgarian_split_squat'], anchor: true }, { alt: ['single_leg_rdl', 'split_stance_rdl'], anchor: true }, 'single_leg_calf_raise', 'hip_hike', 'side_plank'] },
      { name: 'Day 2 · Ladder + stability', focus: 'lower', entries: [{ ladder: 'squat_touchdown', anchor: true }, { alt: ['step_up', 'reverse_lunge'] }, { alt: ['single_leg_glute_bridge', 'glute_bridge'] }, 'clamshell', 'bird_dog', 'plank'] },
    ],
  },
  {
    id: 'full_body_2', name: 'Full body, 2 days (minimal)', goal: 'general', level: 'beginner',
    blurb: 'The least that works: a squat, a press, a pull, a hinge and core, twice a week.',
    tips: ['Add a third day later, or a little more weight each week.'],
    days: [
      { name: 'A', focus: 'full', entries: [{ slot: 'squat', anchor: true }, { slot: 'push_h', anchor: true }, { slot: 'pull_h', anchor: true }, { slot: 'hinge' }, { slot: 'core' }] },
      { name: 'B', focus: 'full', entries: [{ slot: 'pull_v', anchor: true }, { slot: 'push_v' }, { slot: 'squat', anchor: true }, { slot: 'hinge', anchor: true }, { slot: 'core' }] },
    ],
  },
  {
    id: 'full_body_3', name: 'Full body, 3 days', goal: 'general', level: 'intermediate',
    blurb: 'Three full-body sessions with a different emphasis each, so every muscle is worked about three times a week at moderate volume.',
    tips: ['Rest a day between sessions.'],
    days: [
      { name: 'A', focus: 'full', entries: [{ slot: 'pull_v', anchor: true }, { slot: 'push_h', anchor: true }, { slot: 'squat', anchor: true }, { slot: 'hinge' }, { slot: 'core' }] },
      { name: 'B', focus: 'full', entries: [{ slot: 'pull_h', anchor: true }, { slot: 'push_v', anchor: true }, { slot: 'squat' }, { slot: 'hip_stab' }, { slot: 'core' }] },
      { name: 'C', focus: 'full', entries: [{ slot: 'pull_v' }, { slot: 'push_h' }, { slot: 'hinge', anchor: true }, { slot: 'rear' }, { slot: 'calf' }, { slot: 'core' }] },
    ],
  },
  {
    id: 'upper_lower_4', name: 'Upper / lower, 4 days', goal: 'muscle', level: 'intermediate',
    blurb: 'Two upper and two lower sessions a week: more volume per muscle for building size and strength.',
    tips: ['Upper, lower, rest, upper, lower works well.'],
    days: [
      { name: 'Upper A', focus: 'upper', entries: [{ slot: 'pull_v', anchor: true }, { slot: 'push_h', anchor: true }, { slot: 'pull_h' }, { slot: 'shoulder_iso' }, { slot: 'rear' }, { slot: 'arms', muscle: 'triceps' }] },
      { name: 'Lower A', focus: 'lower', entries: [{ slot: 'squat', anchor: true }, { slot: 'hinge', anchor: true }, { slot: 'hip_stab' }, { slot: 'calf' }, { slot: 'core' }] },
      { name: 'Upper B', focus: 'upper', entries: [{ slot: 'pull_h', anchor: true }, { slot: 'push_v', anchor: true }, { slot: 'pull_v' }, { slot: 'push_h' }, { slot: 'arms', muscle: 'biceps' }, { slot: 'core' }] },
      { name: 'Lower B', focus: 'lower', entries: [{ slot: 'hinge', anchor: true }, { slot: 'squat', anchor: true }, { slot: 'knee_iso' }, { slot: 'calf' }, { slot: 'core' }] },
    ],
  },
  {
    id: 'ppl_3', name: 'Push / pull / legs, 3 days', goal: 'muscle', level: 'intermediate',
    blurb: 'A classic split: pressing muscles, pulling muscles, then legs and core.',
    tips: ['Repeat the cycle twice a week if you have the energy and the recovery.'],
    days: [
      { name: 'Push', focus: 'upper', entries: [{ slot: 'push_h', anchor: true }, { slot: 'push_v', anchor: true }, { slot: 'shoulder_iso' }, { slot: 'push_h' }, { slot: 'arms', muscle: 'triceps' }] },
      { name: 'Pull', focus: 'upper', entries: [{ slot: 'pull_v', anchor: true }, { slot: 'pull_h', anchor: true }, { slot: 'rear' }, { slot: 'arms', muscle: 'biceps' }, { slot: 'core' }] },
      { name: 'Legs', focus: 'lower', entries: [{ slot: 'squat', anchor: true }, { slot: 'hinge', anchor: true }, { slot: 'hip_stab' }, { slot: 'calf' }, { slot: 'core' }] },
    ],
  },
  {
    id: 'core_hips_20', name: 'Core + hip stability, 20 minutes', goal: 'running', level: 'beginner',
    blurb: 'A short session for pelvis, hip and core control that is gentle enough to sit next to running days.',
    tips: ['Fits as a warm-up before a run or on its own on an easy day.'],
    days: [
      { name: 'Core + hips', focus: 'full', entries: ['clamshell', 'hip_hike', { alt: ['lateral_walk', 'side_leg_raise'] }, 'side_plank', 'bird_dog', 'dead_bug', 'plank'] },
    ],
  },
];
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/** The rung of a ladder to start on: the highest one you have logged, else the lowest. */
export function ladderPick(startId, recentIds, catalog) {
  const rungs = ladderOf(startId, catalog);
  if (!rungs.length) return null;
  let best = 0;
  rungs.forEach((r, i) => { if (recentIds.has(r.id)) best = Math.max(best, i); });
  return rungs[best];
}

/**
 * Turn a template into real workouts for this person.
 * @param {object} tpl
 * @param {{catalog?:object[], have:Set<string>, goal?:string, level?:string, avoid?:string[], weakAreas?:string[], recent?:{exId:string}[], exclude?:Set<string>}} ctx
 * @returns {{workouts:{name:string, focus:string, items:object[]}[], notes:string[]}}
 */
export function instantiate(tpl, ctx) {
  const catalog = ctx.catalog ?? EXERCISES;
  const byId = indexExercises(catalog);
  const goal = ctx.goal ?? tpl.goal ?? 'general';
  const exclude = ctx.exclude ?? new Set();
  const recentIds = new Set((ctx.recent ?? []).map((r) => r.exId));
  const okEx = (e) => e && doable(e, ctx.have) && !hasAvoided(e, ctx.avoid ?? []) && !exclude.has(e.id);
  const notes = [];
  const usedElsewhere = new Set();
  const workouts = tpl.days.map((day) => {
    const items = [], used = new Set();
    for (const raw of day.entries) {
      const entry = typeof raw === 'string' ? { alt: [raw] } : Array.isArray(raw) ? { alt: raw } : raw;
      let ex = null;
      if (entry.ladder) ex = (() => { const r = ladderPick(entry.ladder, recentIds, catalog); return okEx(r) ? r : (ladderOf(entry.ladder, catalog).find(okEx) ?? null); })();
      else if (entry.alt) ex = entry.alt.map((id) => byId[id]).find((e) => okEx(e) && !used.has(e.id)) ?? null;
      if (!ex && entry.slot) {
        const ranked = suggestMore([], { ...ctx, catalog, goal, focus: day.focus, count: 60, exclude: new Set([...exclude, ...used]) }).filter((s) => s.ex.slot === entry.slot && (!entry.muscle || s.ex.primary.includes(entry.muscle)));
        ex = (ranked.find((s) => !usedElsewhere.has(s.ex.id)) ?? ranked[0])?.ex ?? null;
      }
      if (!ex) {
        if (!entry.optional) notes.push(`${day.name}: nothing for ${entry.alt ? entry.alt.map((id) => byId[id]?.name).filter(Boolean)[0] ?? 'one line' : SLOTS[entry.slot]?.label ?? 'one line'} with your equipment, so it was left out.`);
        continue;
      }
      used.add(ex.id);
      const item = { ...itemFor(ex, goal), ...(entry.sets ? { sets: entry.sets } : {}), ...(entry.reps ? { reps: entry.reps } : {}), ...(entry.secs ? { secs: entry.secs } : {}), ...(entry.anchor ? { anchor: true } : {}), ...(entry.note ? { note: entry.note } : {}) };
      items.push(item);
    }
    items.forEach((i) => usedElsewhere.add(i.exId));
    return { name: day.name, focus: day.focus, items };
  });
  return { workouts, notes };
}

/** Which templates suit a request (days a week, goal, equipment), best first. */
export function bestTemplates(request, ctx) {
  return TEMPLATES.map((tpl) => {
    const { workouts } = instantiate(tpl, ctx);
    const total = tpl.days.reduce((n, d) => n + d.entries.filter((e) => !(e.optional)).length, 0);
    const got = workouts.reduce((n, w) => n + w.items.length, 0);
    let score = (got / Math.max(1, total)) * 3;
    if (request?.days) score += 3 - Math.min(3, Math.abs(request.days - tpl.days.length) * 1.5);
    if (request?.goal && request.goal === tpl.goal) score += 1.5;
    if (!request?.goal && ctx.goal && ctx.goal === tpl.goal) score += 0.8;
    return { tpl, score };
  }).sort((a, b) => b.score - a.score).map((x) => x.tpl);
}
