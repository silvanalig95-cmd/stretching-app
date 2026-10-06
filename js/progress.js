// The training log's arithmetic: totals, streaks, a weekly goal, a calendar, milestones, per-muscle progress, CSV.
//
// All of it is a pure function of the history log (state.history), so editing or deleting an entry changes
// every number honestly, and nothing here needs storing except the weekly goal (prefs.weeklyGoal).
// Days are local calendar dates ("2026-03-09"); weeks start on Monday.

import { RATING_VALUE, localDate } from './model.js';
import { areaLabel, parentOf } from './lexicon.js';

export const DEFAULT_WEEKLY_GOAL = 3;

// ---------------------------------------------------------------- dates

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const parseDay = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12); };
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return localDate(d); };
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
/** The Monday of the week containing this day. */
export const weekStart = (s) => addDays(s, -((parseDay(s).getDay() + 6) % 7));

/** Entries with a usable date that is not in the future, oldest first. */
function sessionsUpTo(history, today) {
  return history.filter((h) => DAY_RE.test(h.date ?? '') && h.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at ?? '') < (b.at ?? '') ? -1 : 1));
}

/** Minutes a routine took: what was recorded when you logged it, else the video's length. */
export function sessionMinutes(rec, videos = {}) {
  const sec = rec.durationSec ?? videos[rec.videoId]?.durationSec ?? 0;
  return Math.round(sec / 60);
}

// ---------------------------------------------------------------- totals and streaks

export function totals(history, videos, today = localDate()) {
  const list = sessionsUpTo(history, today);
  const days = new Set(list.map((h) => h.date));
  const minutes = list.reduce((s, h) => s + sessionMinutes(h, videos), 0);
  const since = list[0]?.date ?? null;
  const weeksSince = since ? Math.max(1, Math.round(daysBetween(weekStart(since), weekStart(today)) / 7) + 1) : 0;
  return { sessions: list.length, minutes, activeDays: days.size, since, perWeek: weeksSince ? Math.round((10 * list.length) / weeksSince) / 10 : 0 };
}

/** Days in a row with at least one routine. Today not being done yet does not break the current streak. */
export function streaks(history, today = localDate()) {
  const days = [...new Set(sessionsUpTo(history, today).map((h) => h.date))];
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const set = new Set(days);
  let current = 0, d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) { current++; d = addDays(d, -1); }
  return { current, best: Math.max(best, current), lastDay: days.at(-1) ?? null, daysSince: days.length ? daysBetween(days.at(-1), today) : null };
}

// ---------------------------------------------------------------- weeks and the weekly goal

/** The last `weeks` weeks, oldest first: [{start, sessions, minutes, days}]. */
export function weekly(history, videos, { today = localDate(), weeks = 12 } = {}) {
  const thisWeek = weekStart(today);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) out.push({ start: addDays(thisWeek, -7 * i), sessions: 0, minutes: 0, _days: new Set() });
  const by = new Map(out.map((w) => [w.start, w]));
  for (const h of sessionsUpTo(history, today)) {
    const w = by.get(weekStart(h.date));
    if (w) { w.sessions++; w.minutes += sessionMinutes(h, videos); w._days.add(h.date); }
  }
  return out.map(({ _days, ...w }) => ({ ...w, days: _days.size }));
}

function weekCounts(history, today) {
  const m = new Map();
  for (const h of sessionsUpTo(history, today)) { const w = weekStart(h.date); m.set(w, (m.get(w) ?? 0) + 1); }
  return m;
}

/** How this week is going against the goal (sessions per week; 0 turns the goal off). */
export function goalProgress(history, goal, today = localDate()) {
  const done = weekCounts(history, today).get(weekStart(today)) ?? 0;
  const daysLeft = 7 - ((parseDay(today).getDay() + 6) % 7);   // today included
  return { goal, done, remaining: Math.max(0, goal - done), met: goal > 0 && done >= goal, daysLeft, onTrack: goal > 0 && goal - done <= daysLeft };
}

/** Consecutive weeks that met the goal. A week still in progress never breaks the run. */
export function goalStreak(history, goal, today = localDate()) {
  if (!goal) return null;
  const counts = weekCounts(history, today);
  if (!counts.size) return { current: 0, best: 0 };
  const first = [...counts.keys()].sort()[0], now = weekStart(today);
  let run = 0, best = 0;
  for (let w = first; w <= now; w = addDays(w, 7)) {
    if ((counts.get(w) ?? 0) >= goal) { run++; best = Math.max(best, run); } else if (w !== now) run = 0;
  }
  return { current: run, best };
}

/** This week and this month so far, each against the one before. */
export function periods(history, videos, today = localDate()) {
  const list = sessionsUpTo(history, today);
  const sum = (from, to) => list.filter((h) => h.date >= from && h.date <= to).reduce((a, h) => ({ sessions: a.sessions + 1, minutes: a.minutes + sessionMinutes(h, videos) }), { sessions: 0, minutes: 0 });
  const ws = weekStart(today);
  const monthFirst = `${today.slice(0, 7)}-01`;
  const prevMonthLast = addDays(monthFirst, -1);
  return {
    week: { now: sum(ws, today), before: sum(addDays(ws, -7), addDays(ws, -1)) },
    month: { now: sum(monthFirst, today), before: sum(`${prevMonthLast.slice(0, 7)}-01`, prevMonthLast) },
  };
}

// ---------------------------------------------------------------- calendar

/** A month as weeks of 7 days (Monday first): [{date, inMonth, sessions, minutes, titles, today, future}]. */
export function monthGrid(year, month, history, videos, today = localDate()) {
  const first = localDate(new Date(year, month, 1, 12));
  const last = localDate(new Date(year, month + 1, 0, 12));
  const per = new Map();
  for (const h of sessionsUpTo(history, today)) {
    const e = per.get(h.date) ?? { sessions: 0, minutes: 0, titles: [] };
    e.sessions++; e.minutes += sessionMinutes(h, videos);
    e.titles.push(h.title ?? videos[h.videoId]?.title ?? 'a routine');
    per.set(h.date, e);
  }
  const weeks = [];
  for (let d = weekStart(first); d <= last; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i), e = per.get(date);
      return { date, inMonth: date.slice(0, 7) === first.slice(0, 7), sessions: e?.sessions ?? 0, minutes: e?.minutes ?? 0, titles: e?.titles ?? [], today: date === today, future: date > today };
    }));
  }
  return weeks;
}

// ---------------------------------------------------------------- milestones

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const MILESTONES = [
  { id: 'routines', icon: '🏁', unit: 'routines', steps: [1, 5, 10, 25, 50, 100, 250, 500], label: (n) => (n === 1 ? 'First routine' : `${n} routines done`) },
  { id: 'streak', icon: '🔥', unit: 'days in a row', steps: [3, 7, 14, 30, 60, 100], label: (n) => `${n} days in a row` },
  { id: 'hours', icon: '⏱️', unit: 'hours of practice', steps: [1, 5, 10, 25, 50, 100], label: (n) => `${plural(n, 'hour', 'hours')} of practice` },
  { id: 'weeks', icon: '📅', unit: 'weeks with a routine', steps: [2, 4, 12, 26, 52], label: (n) => `${n} weeks of practice` },
  { id: 'areas', icon: '🧍', unit: 'muscle areas worked', steps: [5, 10, 15, 25], label: (n) => `${n} different muscle areas` },
  { id: 'felt', icon: '😀', unit: '“much better” answers', steps: [1, 10, 25, 50], label: (n) => (n === 1 ? 'First “much better”' : `“Much better” ${n}×`) },
];

const areasOf = (h) => [...new Set([...(h.areas ?? []).map((a) => a.id), ...Object.keys(h.ratings ?? {})])].filter((a) => a !== 'full_body');

/**
 * What you have achieved (with the day it happened, found by replaying the log) and what is closest.
 * @returns {{earned: {id:string, icon:string, label:string, date:string}[], next: {id:string, icon:string, label:string, have:number, need:number, unit:string}[]}}
 */
export function milestones(history, videos, today = localDate()) {
  const hit = new Map();            // "family:step" -> date it was first reached
  const weeks = new Set(), areas = new Set();
  let routines = 0, minutes = 0, felt = 0, run = 0, prev = null;
  const value = () => ({ routines, streak: run, hours: Math.floor(minutes / 60), weeks: weeks.size, areas: areas.size, felt });
  for (const h of sessionsUpTo(history, today)) {
    routines++; minutes += sessionMinutes(h, videos); weeks.add(weekStart(h.date));
    for (const a of areasOf(h)) areas.add(a);
    felt += Object.values(h.ratings ?? {}).filter((r) => r === 'much').length;
    if (h.date !== prev) { run = prev && daysBetween(prev, h.date) === 1 ? run + 1 : 1; prev = h.date; }
    const now = value();
    for (const f of MILESTONES) for (const step of f.steps) if (now[f.id] >= step && !hit.has(`${f.id}:${step}`)) hit.set(`${f.id}:${step}`, h.date);
  }
  const earned = [...hit].map(([key, date]) => {
    const [id, step] = key.split(':'); const f = MILESTONES.find((m) => m.id === id);
    return { id: key, icon: f.icon, label: f.label(Number(step)), date };
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const final = { ...value(), streak: streaks(history, today).current };
  const next = MILESTONES.map((f) => {
    const step = f.steps.find((s) => !hit.has(`${f.id}:${s}`));
    return step == null ? null : { id: `${f.id}:${step}`, icon: f.icon, label: f.label(step), have: final[f.id], need: step, unit: f.unit };
  }).filter(Boolean).sort((a, b) => b.have / b.need - a.have / a.need).slice(0, 3);
  return { earned, next };
}

// ---------------------------------------------------------------- progress per muscle

const meanOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Per muscle area: how often you worked it and whether it is helping more than it used to
 * (your first few "did it help?" answers against your latest ones; needs `min` answers to say).
 */
export function areaProgress(history, { min = 6, top = 8, today = localDate() } = {}) {
  const per = new Map();
  for (const h of sessionsUpTo(history, today)) {
    const ids = new Set(areasOf(h));
    for (const a of [...ids]) { const p = parentOf(a); if (p) ids.add(p); }
    for (const a of ids) {
      const e = per.get(a) ?? { area: a, label: areaLabel(a), sessions: 0, first: h.date, last: h.date, answers: [] };
      e.sessions++; e.last = h.date;
      const r = h.ratings?.[a] ?? Object.entries(h.ratings ?? {}).find(([c]) => parentOf(c) === a)?.[1];
      if (RATING_VALUE[r] != null) e.answers.push(RATING_VALUE[r]);
      per.set(a, e);
    }
  }
  return [...per.values()].map(({ answers, ...e }) => {
    const n = answers.length, k = Math.min(5, Math.floor(n / 2));
    const early = n >= min ? meanOf(answers.slice(0, k)) : null, recent = n >= min ? meanOf(answers.slice(-k)) : null;
    const diff = early == null ? null : recent - early;
    return { ...e, answers: n, helped: n ? meanOf(answers) : null, early, recent, trend: diff == null ? null : diff >= 0.15 ? 'up' : diff <= -0.15 ? 'down' : 'steady' };
  }).sort((a, b) => b.sessions - a.sessions || (b.last < a.last ? -1 : 1)).slice(0, top);
}

// ---------------------------------------------------------------- encouragement

/** One to three plain sentences about where you stand. No fluff: every line is a fact about your log. */
export function encouragement(history, videos, { goal = DEFAULT_WEEKLY_GOAL, today = localDate() } = {}) {
  const t = totals(history, videos, today);
  if (!t.sessions) return ['Do your first routine and it shows up here: your streak, your week, and what has been helping.'];
  const out = [];
  const s = streaks(history, today), g = goalProgress(history, goal, today);
  if (goal > 0) {
    if (g.met) out.push(`Weekly goal reached: ${g.done} of ${goal} routines this week. Anything more is a bonus.`);
    else if (g.onTrack) out.push(`${plural(g.remaining, 'more routine', 'more routines')} to reach this week’s goal (${g.done} of ${goal}), with ${plural(g.daysLeft, 'day', 'days')} left.`);
    else out.push(`This week’s goal (${goal}) is out of reach now (${g.done} done, ${plural(g.daysLeft, 'day', 'days')} left). A short one still counts, and next week starts fresh on Monday.`);
  }
  if (s.daysSince >= 3) out.push(`It has been ${s.daysSince} days. A 10-minute routine is enough to start again.`);
  else if (s.current >= 2 && s.current >= s.best) out.push(`${s.current} days in a row: your longest streak so far.`);
  else if (s.current >= 1 && s.best > s.current) out.push(`${s.current} day${s.current === 1 ? '' : 's'} in a row; your best is ${s.best}, ${plural(s.best - s.current, 'more day', 'more days')} to match it.`);
  const p = periods(history, videos, today);
  if (p.month.before.sessions && p.month.now.sessions >= p.month.before.sessions) out.push(`This month already matches last month’s ${plural(p.month.before.sessions, 'routine', 'routines')}.`);
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- export

const FORMULA = /^[=+\-@\t\r]/;
/** One CSV cell. Quoted when needed; a leading = + - @ is defused so a spreadsheet never runs it as a formula. */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole training log as CSV (UTF-8 with a BOM so Excel reads accents correctly). */
export function historyCsv(history, videos = {}) {
  const head = ['date', 'title', 'channel', 'minutes', 'muscle areas', 'did it help', 'intensity', 'note', 'video'];
  const rows = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at ?? '') < (b.at ?? '') ? -1 : 1)).map((h) => {
    const v = videos[h.videoId];
    return [
      h.date, h.title ?? v?.title ?? '', h.channel ?? v?.channel ?? '', sessionMinutes(h, videos) || '',
      areasOf(h).map(areaLabel).join('; '),
      Object.entries(h.ratings ?? {}).map(([a, r]) => `${areaLabel(a)}: ${r}`).join('; '),
      h.intensity ?? '', h.note ?? '', h.videoId ? `https://www.youtube.com/watch?v=${h.videoId}` : '',
    ];
  });
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
