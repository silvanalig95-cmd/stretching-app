// What your strength log says: what you did last time, personal bests, volume, sets per muscle each week.
// Everything is read from the history entries of kind 'strength' (state.history); nothing extra is stored.

import { e1rm } from './rx.js';
import { MUSCLE_BY_ID } from './muscles.js';
import { addDays, weekStart, daysBetween } from '../progress.js';
import { localDate } from '../model.js';

export const isStrength = (h) => h?.kind === 'strength';
const performed = (s) => !!(s && (s.reps || s.secs));

/** The sets of an entry that were actually done (a set counts once it has reps or seconds). */
export const doneSets = (entry) => (entry.exercises ?? []).flatMap((x) => (x.sets ?? []).filter(performed).map((s) => ({ ...s, exId: x.exId })));

/** Total weight moved: reps × kg, summed over the sets that had both. */
export const volume = (entry) => Math.round(doneSets(entry).reduce((a, s) => a + (s.reps && s.weight ? s.reps * s.weight : 0), 0));

/** All the times an exercise was logged, newest first: [{date, id, sets}]. */
export function exerciseHistory(history, exId) {
  return history.filter(isStrength).map((h) => ({ date: h.date, at: h.at ?? '', id: h.id, sets: (h.exercises ?? []).filter((x) => x.exId === exId).flatMap((x) => (x.sets ?? []).filter(performed)) }))
    .filter((x) => x.sets.length).sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1));
}
/** What you did the last time you did this exercise (or null). */
export const lastSets = (history, exId) => exerciseHistory(history, exId)[0]?.sets ?? null;

/** Best numbers for an exercise: heaviest estimated max, most reps, longest hold, and when. */
export function bestsFor(history, exId) {
  let best = { e1rm: 0, weight: 0, reps: 0, secs: 0, date: null };
  for (const x of exerciseHistory(history, exId)) {
    for (const s of x.sets) {
      const est = e1rm(s.weight, s.reps);
      if (est > best.e1rm) best = { ...best, e1rm: est, weight: s.weight, reps: s.reps, date: x.date };
      if (!s.weight && (s.reps ?? 0) > best.reps && !best.e1rm) best = { ...best, reps: s.reps, date: x.date };
      if ((s.secs ?? 0) > best.secs) best = { ...best, secs: s.secs, date: best.date ?? x.date };
    }
  }
  return best.e1rm || best.reps || best.secs ? best : null;
}

/** Did this session set a personal best on anything (compared with everything logged before it)? */
export function personalBests(entry, history) {
  const before = history.filter((h) => isStrength(h) && h.id !== entry.id && (h.date < entry.date || (h.date === entry.date && (h.at ?? '') < (entry.at ?? ''))));
  const out = [];
  for (const x of entry.exercises ?? []) {
    const prev = bestsFor(before, x.exId);
    const mine = bestsFor([{ ...entry }], x.exId);
    if (!mine || !prev) continue;                      // the first time is not a "best", it is a start
    if (mine.e1rm > prev.e1rm && mine.e1rm) out.push({ exId: x.exId, kind: 'weight', now: mine, was: prev });
    else if (!mine.e1rm && mine.reps > prev.reps) out.push({ exId: x.exId, kind: 'reps', now: mine, was: prev });
    else if (mine.secs > prev.secs && mine.secs) out.push({ exId: x.exId, kind: 'time', now: mine, was: prev });
  }
  return out;
}

/** Hard sets per muscle for the last `weeks` weeks (this one included): {muscleId: [setsThisWeek, ..., ] oldest first}. */
export function weeklySetsByMuscle(history, byId, { weeks = 4, today = localDate() } = {}) {
  const start = addDays(weekStart(today), -7 * (weeks - 1));
  const out = {};
  for (const h of history.filter(isStrength)) {
    if (h.date < start || h.date > today) continue;
    const w = Math.floor(daysBetween(start, h.date) / 7);
    for (const x of h.exercises ?? []) {
      const n = (x.sets ?? []).filter(performed).length;
      const ex = byId[x.exId];
      if (!n || !ex) continue;
      for (const m of ex.primary) (out[m] ??= Array(weeks).fill(0))[w] += n;
      for (const m of ex.secondary) (out[m] ??= Array(weeks).fill(0))[w] += n * 0.5;
    }
  }
  return out;
}

/** Pushing against pulling over the last `days`: sets of each. */
export function pushPull(history, byId, { days = 28, today = localDate() } = {}) {
  const from = addDays(today, -days);
  const t = { push: 0, pull: 0, legs: 0, core: 0 };
  for (const h of history.filter(isStrength)) {
    if (h.date < from || h.date > today) continue;
    for (const x of h.exercises ?? []) {
      const n = (x.sets ?? []).filter(performed).length, ex = byId[x.exId];
      const g = MUSCLE_BY_ID[ex?.primary?.[0]]?.group;
      if (n && g in t) t[g] += n;
    }
  }
  return t;
}

/** A short line about a logged strength session: "5 exercises · 14 sets · 2 340 kg moved". */
export function describeSession(entry) {
  const ex = (entry.exercises ?? []).length, sets = doneSets(entry).length, vol = volume(entry);
  return [`${ex} exercise${ex === 1 ? '' : 's'}`, sets ? `${sets} set${sets === 1 ? '' : 's'}` : 'no sets noted', vol ? `${vol.toLocaleString('en')} kg moved` : null].filter(Boolean).join(' · ');
}
