// Your strength data inside the profile: equipment, settings, your own exercises, saved workouts, plans, guide videos,
// and logging a session. Pure functions on the app state, so they are tested without a browser.

import { allExercises, customExercise, indexExercises, BUILT_IN } from './catalog.js';
import { EQUIPMENT_BY_ID, GOALS, LEVEL_NUM, AVOID_FLAGS, areasOfMuscles } from './muscles.js';
import { localDate } from '../model.js';

const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback = null) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
const LIMITS = { custom: 300, workouts: 200, plans: 50, guides: 8, items: 40, sessions: 5000 };

export const HOME_GYM = ['dumbbell', 'bench', 'cable_station', 'pullup_bar', 'band_loop', 'feetup'];

export function defaultStrength() {
  return {
    equipment: { configured: false, have: [], dumbbellKg: [2, 4, 6, 8, 10], cableStepKg: 5, cableMaxKg: 60, bandLevels: ['light', 'medium', 'heavy'] },
    prefs: { goal: 'general', level: 'intermediate', minutes: 45, avoid: [], excluded: [], legsFatigued: false },
    custom: [], workouts: [], plans: [], guides: {},
  };
}

// ---------------------------------------------------------------- reading what was saved (never trust the file)

const cleanItem = (it) => {
  if (!isObj(it) || typeof it.exId !== 'string') return null;
  const range = (r) => (Array.isArray(r) && r.length === 2 ? [num(r[0], 1, 300, 1), num(r[1], 1, 300, 1)].sort((a, b) => a - b) : null);
  const out = { exId: it.exId.slice(0, 80), sets: num(it.sets, 1, 12, 3) };
  const secs = range(it.secs), reps = range(it.reps);
  if (secs) out.secs = secs; else out.reps = reps ?? [8, 12];
  if (it.anchor) out.anchor = true;
  if (typeof it.note === 'string' && it.note) out.note = it.note.slice(0, 200);
  return out;
};
const cleanWorkout = (w) => (isObj(w) && typeof w.id === 'string' ? {
  id: w.id.slice(0, 80), name: String(w.name ?? 'Workout').slice(0, 80), note: String(w.note ?? '').slice(0, 500),
  items: (Array.isArray(w.items) ? w.items : []).map(cleanItem).filter(Boolean).slice(0, LIMITS.items),
  createdAt: Number(w.createdAt) || Date.now(), updatedAt: Number(w.updatedAt) || Number(w.createdAt) || Date.now(),
  ...(typeof w.template === 'string' ? { template: w.template.slice(0, 40) } : {}),
} : null);
const cleanPlan = (p) => (isObj(p) && typeof p.id === 'string' ? {
  id: p.id.slice(0, 80), name: String(p.name ?? 'Plan').slice(0, 80), note: String(p.note ?? '').slice(0, 500),
  workoutIds: (Array.isArray(p.workoutIds) ? p.workoutIds : []).filter((x) => typeof x === 'string').slice(0, 14),
  createdAt: Number(p.createdAt) || Date.now(), ...(typeof p.template === 'string' ? { template: p.template.slice(0, 40) } : {}),
} : null);
const cleanGuide = (g) => (isObj(g) && /^[\w-]{11}$/.test(g.id ?? '') ? { id: g.id, title: String(g.title ?? '').slice(0, 140), channel: String(g.channel ?? '').slice(0, 80), addedAt: Number(g.addedAt) || Date.now() } : null);

/** Whatever was saved, made safe and complete. */
export function normalizeStrength(raw) {
  const d = defaultStrength();
  if (!isObj(raw)) return d;
  const eq = isObj(raw.equipment) ? raw.equipment : {};
  d.equipment = {
    configured: !!eq.configured,
    have: [...new Set((Array.isArray(eq.have) ? eq.have : []).filter((q) => EQUIPMENT_BY_ID[q] && !EQUIPMENT_BY_ID[q].always))],
    dumbbellKg: [...new Set((Array.isArray(eq.dumbbellKg) ? eq.dumbbellKg : d.equipment.dumbbellKg).map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 100))].slice(0, 30).sort((a, b) => a - b),
    cableStepKg: num(eq.cableStepKg, 0.5, 20, 5), cableMaxKg: num(eq.cableMaxKg, 5, 300, 60),
    bandLevels: (Array.isArray(eq.bandLevels) && eq.bandLevels.length ? eq.bandLevels : d.equipment.bandLevels).map((b) => String(b).slice(0, 20)).slice(0, 6),
  };
  const p = isObj(raw.prefs) ? raw.prefs : {};
  d.prefs = {
    goal: GOALS.some((g) => g.id === p.goal) ? p.goal : 'general', level: p.level in LEVEL_NUM ? p.level : 'intermediate', minutes: num(p.minutes, 10, 120, 45),
    avoid: (Array.isArray(p.avoid) ? p.avoid : []).filter((f) => AVOID_FLAGS.some((a) => a.id === f)),
    excluded: (Array.isArray(p.excluded) ? p.excluded : []).filter((x) => typeof x === 'string').slice(0, 200), legsFatigued: !!p.legsFatigued,
  };
  d.custom = (Array.isArray(raw.custom) ? raw.custom : []).filter((e) => isObj(e) && typeof e.id === 'string' && !BUILT_IN[e.id]).map((e) => customExercise({ ...e }, new Set())).slice(0, LIMITS.custom);
  d.workouts = (Array.isArray(raw.workouts) ? raw.workouts : []).map(cleanWorkout).filter(Boolean).slice(0, LIMITS.workouts);
  d.plans = (Array.isArray(raw.plans) ? raw.plans : []).map(cleanPlan).filter(Boolean).slice(0, LIMITS.plans);
  if (isObj(raw.guides)) for (const [exId, list] of Object.entries(raw.guides)) {
    const g = (Array.isArray(list) ? list : []).map(cleanGuide).filter(Boolean).slice(0, LIMITS.guides);
    if (g.length) d.guides[exId.slice(0, 80)] = g;
  }
  return d;
}

// ---------------------------------------------------------------- the catalogue, with your own exercises

export const catalogOf = (state) => allExercises(state.strength.custom);
export const catalogById = (state) => indexExercises(catalogOf(state));
export const haveOf = (state) => new Set(['bodyweight', ...state.strength.equipment.have]);

export function addCustomExercise(state, input) {
  const existing = new Set(state.strength.custom.map((e) => e.id));
  const e = customExercise(input, existing);
  if (!e.name || !e.primary.length) return null;
  if (state.strength.custom.length >= LIMITS.custom) return null;
  const i = state.strength.custom.findIndex((c) => c.id === e.id);
  if (i >= 0) state.strength.custom[i] = e; else state.strength.custom.push(e);
  return e;
}
export function deleteCustomExercise(state, id) {
  state.strength.custom = state.strength.custom.filter((e) => e.id !== id);
  delete state.strength.guides[id];
}

// ---------------------------------------------------------------- guide videos (YouTube) for an exercise

export const guidesFor = (state, exId) => state.strength.guides[exId] ?? [];
/** Attach a YouTube video to an exercise (any exercise, built-in or yours). Returns false for a duplicate or a full list. */
export function addGuide(state, exId, { id, title = '', channel = '' }) {
  const g = cleanGuide({ id, title, channel, addedAt: Date.now() });
  if (!g) return false;
  const list = (state.strength.guides[exId] ??= []);
  if (list.some((x) => x.id === g.id) || list.length >= LIMITS.guides) return false;
  list.push(g);
  return true;
}
export function removeGuide(state, exId, videoId) {
  const list = (state.strength.guides[exId] ?? []).filter((g) => g.id !== videoId);
  if (list.length) state.strength.guides[exId] = list; else delete state.strength.guides[exId];
}

// ---------------------------------------------------------------- workouts and plans

/** Create or replace a saved workout. */
export function saveWorkout(state, w) {
  const clean = cleanWorkout({ ...w, id: w.id ?? newId(), updatedAt: Date.now(), createdAt: w.createdAt ?? Date.now() });
  const list = state.strength.workouts;
  const i = list.findIndex((x) => x.id === clean.id);
  if (i >= 0) list[i] = clean; else if (list.length < LIMITS.workouts) list.push(clean); else return null;
  return clean;
}
export function deleteWorkout(state, id) {
  state.strength.workouts = state.strength.workouts.filter((w) => w.id !== id);
  for (const p of state.strength.plans) p.workoutIds = p.workoutIds.filter((x) => x !== id);
}
export function duplicateWorkout(state, id) {
  const w = state.strength.workouts.find((x) => x.id === id);
  return w ? saveWorkout(state, { ...structuredClone(w), id: newId(), name: `${w.name} (copy)`, createdAt: Date.now() }) : null;
}
export function savePlan(state, p) {
  const clean = cleanPlan({ ...p, id: p.id ?? newId(), createdAt: p.createdAt ?? Date.now() });
  const i = state.strength.plans.findIndex((x) => x.id === clean.id);
  if (i >= 0) state.strength.plans[i] = clean; else if (state.strength.plans.length < LIMITS.plans) state.strength.plans.push(clean); else return null;
  return clean;
}
export function deletePlan(state, id) { state.strength.plans = state.strength.plans.filter((p) => p.id !== id); }

/** Which workout of a plan is next: the one after the one you did most recently, else the first. */
export function nextInPlan(state, plan) {
  const ids = plan.workoutIds.filter((id) => state.strength.workouts.some((w) => w.id === id));
  if (!ids.length) return null;
  const lastDone = [...state.history].reverse().find((h) => h.kind === 'strength' && ids.includes(h.workoutId));
  const at = lastDone ? ids.indexOf(lastDone.workoutId) : -1;
  return state.strength.workouts.find((w) => w.id === ids[(at + 1) % ids.length]);
}
export const lastDoneDate = (state, workoutId) => [...state.history].reverse().find((h) => h.kind === 'strength' && h.workoutId === workoutId)?.date ?? null;

// ---------------------------------------------------------------- logging a session

const cleanSet = (s) => {
  const out = {};
  if (s?.reps != null && s.reps !== '') out.reps = num(s.reps, 0, 1000);
  if (s?.weight != null && s.weight !== '') out.weight = num(s.weight, 0, 1000);
  if (s?.secs != null && s.secs !== '') out.secs = num(s.secs, 0, 7200);
  if (typeof s?.band === 'string' && s.band) out.band = s.band.slice(0, 20);
  if (s?.rpe != null && s.rpe !== '') out.rpe = num(s.rpe, 1, 10);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && v !== 0 || (typeof v === 'string')));
};
const cleanLogged = (x, byId) => (isObj(x) && typeof x.exId === 'string' ? {
  exId: x.exId.slice(0, 80), name: String(x.name ?? byId[x.exId]?.name ?? x.exId).slice(0, 80),
  sets: (Array.isArray(x.sets) ? x.sets : []).map(cleanSet).filter((s) => Object.keys(s).length).slice(0, 20), ...(x.note ? { note: String(x.note).slice(0, 300) } : {}),
} : null);

/** The body areas a session worked (for the shared muscle map): the primary muscles of what was done. */
export function areasOfExercises(exercises, byId) {
  const muscles = new Set();
  for (const x of exercises) for (const m of byId[x.exId]?.primary ?? []) muscles.add(m);
  return areasOfMuscles([...muscles]).map((id) => ({ id, mode: 'weak' }));
}

/**
 * Log a strength session. Sets are optional: an exercise with no sets still counts as done.
 * @param {object} state @param {{date?:string, workoutId?:string, title?:string, minutes?:number, exercises:object[], note?:string, intensity?:string}} entry
 */
export function logStrength(state, entry) {
  const byId = catalogById(state);
  const exercises = (entry.exercises ?? []).map((x) => cleanLogged(x, byId)).filter(Boolean).slice(0, LIMITS.items);
  const day = typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date <= localDate() ? entry.date : localDate();
  const minutes = num(entry.minutes, 0, 600, 0);
  const rec = {
    id: newId(), at: new Date().toISOString(), date: day, videoId: '', kind: 'strength',
    title: String(entry.title ?? 'Strength session').trim().slice(0, 120) || 'Strength session',
    ...(typeof entry.workoutId === 'string' ? { workoutId: entry.workoutId } : {}),
    durationSec: minutes ? Math.round(minutes * 60) : null,
    exercises, areas: areasOfExercises(exercises, byId), ratings: {}, intensity: ['easy', 'right', 'hard'].includes(entry.intensity) ? entry.intensity : null, repeat: null,
    note: String(entry.note ?? '').slice(0, 500),
  };
  state.history.push(rec);
  return rec;
}
/** Change a logged strength session (its sets, day, note, length). */
export function updateStrengthSession(state, id, patch) {
  const rec = state.history.find((h) => h.id === id && h.kind === 'strength');
  if (!rec) return null;
  const byId = catalogById(state);
  if ('exercises' in patch) { rec.exercises = (patch.exercises ?? []).map((x) => cleanLogged(x, byId)).filter(Boolean); rec.areas = areasOfExercises(rec.exercises, byId); }
  if ('date' in patch && /^\d{4}-\d{2}-\d{2}$/.test(patch.date) && patch.date <= localDate()) rec.date = patch.date;
  if ('note' in patch) rec.note = String(patch.note ?? '').slice(0, 500);
  if ('title' in patch && String(patch.title).trim()) rec.title = String(patch.title).trim().slice(0, 120);
  if ('minutes' in patch) rec.durationSec = num(patch.minutes, 0, 600, 0) ? Math.round(Number(patch.minutes) * 60) : null;
  if ('intensity' in patch) rec.intensity = ['easy', 'right', 'hard'].includes(patch.intensity) ? patch.intensity : null;
  return rec;
}

// ---------------------------------------------------------------- merging a backup into what you have

/** Bring workouts, plans, own exercises and guides from another copy of the data in, never overwriting what is here. */
export function mergeStrength(into, from) {
  const a = into.strength, b = normalizeStrength(from);
  for (const e of b.custom) if (!a.custom.some((x) => x.id === e.id)) a.custom.push(e);
  for (const w of b.workouts) if (!a.workouts.some((x) => x.id === w.id)) a.workouts.push(w);
  for (const p of b.plans) if (!a.plans.some((x) => x.id === p.id)) a.plans.push(p);
  for (const [exId, list] of Object.entries(b.guides)) for (const g of list) addGuide(into, exId, g);
  if (!a.equipment.configured && b.equipment.configured) a.equipment = b.equipment;
  return a;
}

/** Recent strength entries as [{exId, date}] (what the builder uses to prefer what you already know). */
export function recentExercises(state, { days = 60, today = localDate() } = {}) {
  const from = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
  return state.history.filter((h) => h.kind === 'strength' && h.date >= from).flatMap((h) => (h.exercises ?? []).map((x) => ({ exId: x.exId, date: h.date })));
}
