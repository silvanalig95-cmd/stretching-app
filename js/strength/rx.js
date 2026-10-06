// Prescriptions (how many sets and reps), time estimates, and what to try next time.
// Nothing here is mandatory: a person can ignore every number. They are starting points that follow the goal.

import { LEVEL_NUM } from './muscles.js';

export const REST = { compound: 120, accessory: 75, stability: 45, core: 45, skill: 30, mobility: 20, conditioning: 45 };

const SCHEMES = {
  compound: { strength: [4, [3, 6]], muscle: [3, [8, 12]], running: [3, [6, 10]], endurance: [3, [12, 16]], general: [3, [8, 12]] },
  accessory: { strength: [3, [6, 10]], muscle: [3, [10, 15]], running: [3, [10, 15]], endurance: [3, [15, 20]], general: [3, [10, 15]] },
};

/**
 * A sensible prescription for an exercise under a goal: sets, a rep range (or a hold in seconds), rest.
 * An exercise can carry its own `rx` ({sets, reps|secs}) that wins.
 * @returns {{sets:number, reps:number[]|null, secs:number[]|null, restSec:number, perSide:boolean}}
 */
export function defaultRx(ex, goal = 'general') {
  const restSec = REST[ex.type] ?? 60;
  const perSide = !!ex.unilateral;
  if (ex.rx) return { sets: ex.rx.sets ?? 3, reps: ex.rx.reps ?? null, secs: ex.rx.secs ?? null, restSec, perSide };
  if (ex.metric === 'time') {
    const secs = ex.type === 'skill' ? [20, 60] : ex.slot === 'carry' ? [30, 45] : ex.type === 'core' ? [20, 45] : ex.slot === 'pull_v' ? [15, 40] : [20, 40];
    return { sets: ex.type === 'skill' ? 2 : 3, secs, reps: null, restSec, perSide };
  }
  let sets, reps;
  const scheme = SCHEMES[ex.type];
  if (scheme) [sets, reps] = scheme[goal] ?? scheme.general;
  else if (ex.type === 'stability') [sets, reps] = [goal === 'running' ? 3 : 2, [10, 15]];
  else if (ex.type === 'core') [sets, reps] = [3, [8, 12]];
  else if (ex.type === 'skill') [sets, reps] = [2, [3, 6]];
  else if (ex.type === 'conditioning') [sets, reps] = [2, [6, 10]];
  else [sets, reps] = [2, [6, 10]];
  // Hard bodyweight moves (pull-ups, pistols) are done in low reps whatever the goal.
  if (ex.level >= 3 && ex.type === 'compound' && !(ex.loads ?? []).length && !(ex.needs ?? []).some((n) => n === 'dumbbell' || n === 'cable_station') && goal !== 'endurance') reps = [3, 6];
  return { sets, reps, secs: null, restSec, perSide };
}

export const midpoint = (range) => Math.round((range[0] + range[1]) / 2);

/** "3 × 6–10 per side", "3 × 20–40 s". */
export function describeRx(rx) {
  const range = (r, unit = '') => (r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}–${r[1]}${unit}`);
  const what = rx.secs ? range(rx.secs, ' s') : rx.reps ? range(rx.reps) : '';
  return `${rx.sets} × ${what}${rx.perSide ? ' per side' : ''}`.trim();
}

/** Minutes a list of {exId, sets, reps, secs} takes, counting rest and a little set-up per exercise. */
export function estimateMinutes(items, byId) {
  let sec = 0;
  for (const it of items) {
    const ex = byId[it.exId];
    if (!ex) continue;
    const rx = defaultRx(ex);
    const sets = Number(it.sets) || rx.sets;
    const work = it.secs ? (Array.isArray(it.secs) ? midpoint(it.secs) : Number(it.secs)) : rx.secs ? midpoint(rx.secs) : 3.5 * (Array.isArray(it.reps) ? midpoint(it.reps) : Number(it.reps) || midpoint(rx.reps ?? [8, 12]));
    const side = ex.unilateral ? 2 : 1;
    sec += sets * (work * side + (ex.unilateral ? rx.restSec * 0.6 : rx.restSec)) + 45;
  }
  return Math.round(sec / 60);
}

// ---------------------------------------------------------------- strength numbers

/** Estimated one-rep max (Epley), for comparing sets of different weights and reps. */
export const e1rm = (weight, reps) => (weight > 0 && reps > 0 ? Math.round(weight * (reps <= 1 ? 1 : 1 + reps / 30) * 10) / 10 : 0);

/** The next weight you can actually load, from what you own. Equals `w` when there is nothing heavier. */
export function nextWeight(ex, w, equipment = {}) {
  const usesDumbbell = (ex.needs ?? []).includes('dumbbell') || (!(ex.needs ?? []).includes('cable_station') && (ex.loads ?? []).includes('dumbbell'));
  if (usesDumbbell) {
    const sizes = [...(equipment.dumbbellKg ?? [])].sort((a, b) => a - b);
    return sizes.find((s) => s > w) ?? w;
  }
  if ((ex.needs ?? []).includes('cable_station')) {
    const step = equipment.cableStepKg || 5, max = equipment.cableMaxKg || 60;
    return w + step <= max ? w + step : w;
  }
  return w + 2.5;
}

/** "3×8 @ 20 kg" for a list of sets. */
export function summarizeSets(sets, ex) {
  const done = (sets ?? []).filter((s) => s.reps || s.secs || s.weight);
  if (!done.length) return '';
  const unit = (s) => (s.secs ? `${s.secs} s` : `${s.reps ?? '?'}`);
  const w = (s) => (s.weight ? ` @ ${s.weight} kg` : s.band ? ` (${s.band} band)` : '');
  const same = done.every((s) => unit(s) === unit(done[0]) && w(s) === w(done[0]));
  return same ? `${done.length}×${unit(done[0])}${w(done[0])}` : done.map((s) => `${unit(s)}${w(s)}`).join(', ');
}

/**
 * What to aim for next time, from your last session of this exercise ("double progression": add reps until the
 * top of the range on every set, then add weight or make it harder).
 * @param {object} ex
 * @param {{reps?:number,weight?:number,secs?:number,band?:string}[]|null} last   your last performed sets of it
 * @returns {{reps?:number, weight?:number, secs?:number, band?:string, note:string, harder?:string}}
 */
export function suggestNext(ex, last, { equipment = {}, goal = 'general', byId = {} } = {}) {
  const rx = defaultRx(ex, goal);
  const sets = (last ?? []).filter((s) => s.reps || s.secs);
  const loadable = (ex.needs ?? []).some((n) => n === 'dumbbell' || n === 'cable_station') || (ex.loads ?? []).includes('dumbbell');
  const harder = ex.next && byId[ex.next] ? byId[ex.next].name : null;

  if (rx.secs) {
    if (!sets.length) return { secs: rx.secs[0], note: `Start with ${rx.secs[0]} seconds, with good form.` };
    const best = Math.max(...sets.map((s) => s.secs ?? 0));
    if (best >= rx.secs[1]) return { secs: best + 5, note: `You held ${best} s last time: add 5 s${harder ? `, or move on to ${harder}` : ', or make it harder'}.`, ...(harder ? { harder } : {}) };
    return { secs: Math.min(rx.secs[1], best + 5), note: `Last time ${best} s: try 5 s more.` };
  }
  const lo = rx.reps[0], hi = rx.reps[1];
  if (!sets.length) {
    return loadable
      ? { reps: lo, note: `Start light: pick a weight you could lift ${hi + 2}–${hi + 3} times, and do ${lo}–${hi}, stopping 2–3 reps before it gets ugly.` }
      : { reps: lo, note: ex.level >= 3 ? 'Do as many clean reps as you can; use an easier step of the progression if fewer than 3.' : `Aim for ${lo}–${hi} clean reps.` };
  }
  const reps = sets.map((s) => s.reps ?? 0);
  const minReps = Math.min(...reps);
  const atTop = sets.length >= Math.min(rx.sets, 2) && reps.every((r) => r >= hi);
  const weights = sets.map((s) => s.weight ?? 0).filter(Boolean);
  if (weights.length) {
    const w = Math.max(...weights);
    if (atTop) {
      const nw = nextWeight(ex, w, equipment);
      if (nw > w) return { weight: nw, reps: lo, note: `Every set reached ${hi} reps at ${w} kg: step up to ${nw} kg and aim for ${lo}.` };
      return { weight: w, reps: hi, note: `You are at the heaviest weight you own (${w} kg): slow the lowering (3 s), pause at the hardest point, or move to a single-leg version.`, ...(harder ? { harder } : {}) };
    }
    return { weight: w, reps: Math.min(hi, minReps + 1), note: `Same weight (${w} kg); aim for one more rep on each set.` };
  }
  const band = sets.find((s) => s.band)?.band;
  if (band) return atTop ? { band, reps: hi, note: 'Easy at the top of the range: use the next stronger band, or slow it down.' } : { band, reps: Math.min(hi, minReps + 1), note: 'Same band; one more rep.' };
  if (atTop) {
    if (harder) return { reps: lo, note: `All sets reached ${hi}: ready for ${harder}.`, harder };
    if (loadable && (equipment.dumbbellKg ?? []).length) return { reps: lo, weight: [...equipment.dumbbellKg].sort((a, b) => a - b)[0], note: `All sets reached ${hi}: add a dumbbell (start with ${[...equipment.dumbbellKg].sort((a, b) => a - b)[0]} kg).` };
    return { reps: hi + 2, note: `All sets reached ${hi}: go a little beyond, or slow each rep down.` };
  }
  return { reps: Math.min(hi, minReps + 1), note: `Last time ${minReps}+ reps: aim for one more on each set.` };
}

export const levelNum = (level) => LEVEL_NUM[level] ?? 1;
