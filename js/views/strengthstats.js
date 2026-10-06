// The strength side of the Journal: sets per muscle, pushing against pulling, personal bests, and how each exercise has gone.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { muscleLabel } from '../strength/muscles.js';
import { catalogById } from '../strength/store.js';
import { e1rm, summarizeSets } from '../strength/rx.js';
import { isStrength, weeklySetsByMuscle, pushPull, personalBests, exerciseHistory, bestsFor } from '../strength/stats.js';
import { localDate } from '../model.js';

const WEEKS = 4;

export function strengthPanel(state) {
  const hist = state.history.filter(isStrength);
  if (!hist.length) return '';
  const by = catalogById(state);
  const today = localDate();
  const sets = weeklySetsByMuscle(state.history, by, { weeks: WEEKS, today });
  const rows = Object.entries(sets).map(([m, w]) => ({ m, w, total: w.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  const max = Math.max(8, ...rows.map((r) => Math.max(...r.w)));
  const pp = pushPull(state.history, by, { days: WEEKS * 7, today });
  const bests = hist.flatMap((rec) => personalBests(rec, state.history).map((p) => ({ ...p, date: rec.date }))).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);

  const logged = [...new Set(hist.flatMap((r) => (r.exercises ?? []).filter((x) => (x.sets ?? []).length).map((x) => x.exId)))];
  const pick = h('select', { id: 'ex-progress', 'aria-label': 'An exercise' }, logged.map((id) => h('option', { value: id }, by[id]?.name ?? id)));
  const detail = h('div', { id: 'ex-progress-detail' });
  const drawDetail = () => {
    const id = pick.value;
    const list = exerciseHistory(state.history, id).slice(0, 8);
    const best = bestsFor(state.history, id);
    fill(detail,
      best ? h('p', { class: 'hint' }, best.e1rm ? `Best: ${best.weight} kg × ${best.reps} (about ${best.e1rm} kg for one rep), ${best.date}.` : best.reps ? `Best: ${best.reps} reps, ${best.date}.` : `Best hold: ${best.secs} s.`) : null,
      h('ol', { class: 'ex-hist' }, list.map((x) => h('li', null, h('span', { class: 'muted' }, `${x.date}  `), summarizeSets(x.sets), (() => { const top = Math.max(0, ...x.sets.map((s) => e1rm(s.weight, s.reps))); return top ? h('small', { class: 'muted' }, ` · about ${top} kg max`) : null; })()))));
  };
  pick.addEventListener('change', drawDetail);
  const panel = h('section', { class: 'panel', id: 'strength-stats' },
    h('h2', null, 'Strength, last 4 weeks'),
    h('p', { class: 'hint' }, 'Hard sets per muscle, a week at a time (oldest to newest). A helping muscle counts half. As a rough guide, many people grow and get stronger with about 8 to 15 hard sets per muscle per week.'),
    h('div', { class: 'heat' }, rows.slice(0, 12).map((r) => h('div', { class: 'heat-row', 'data-muscle': r.m },
      h('span', { class: 'c-label' }, muscleLabel(r.m)),
      h('span', { class: 'wk-mini', 'aria-label': `${r.w.map((n) => Math.round(n * 10) / 10).join(', ')} sets in the last ${WEEKS} weeks` }, r.w.map((n) => { const i = h('i', { class: n ? 'k-strength' : '' }); i.style.height = `${Math.round((Math.min(n, max) / max) * 100)}%`; i.title = `${Math.round(n * 10) / 10} sets`; return i; })),
      h('span', { class: 'c-n' }, `${Math.round(r.w.at(-1) * 10) / 10}`), h('span', { class: 'heat-last' }, 'this week'), h('span', { class: 'heat-help' }, `${Math.round(r.total * 10) / 10} in ${WEEKS} weeks`)))),
    h('p', { class: 'hint', id: 'push-pull' }, `Pushing ${Math.round(pp.push)} sets · pulling ${Math.round(pp.pull)} sets · legs ${Math.round(pp.legs)} · core ${Math.round(pp.core)}${pp.push && pp.pull && pp.push > pp.pull * 1.5 ? ' · a little more pulling would balance it' : pp.push && pp.pull && pp.pull > pp.push * 1.5 ? ' · a little more pressing would balance it' : ''}`),
    bests.length ? h('div', { id: 'recent-bests' }, h('h3', null, 'Recent personal bests'), h('ul', { class: 'pbs' }, bests.map((b) => h('li', null, '🏆 ', h('strong', null, by[b.exId]?.name ?? b.exId), b.kind === 'weight' ? ` about ${b.now.e1rm} kg` : b.kind === 'reps' ? ` ${b.now.reps} reps` : ` ${b.now.secs} s`, h('small', { class: 'muted' }, ` · ${b.date}`))))) : null,
    logged.length ? h('div', null, h('h3', null, 'How an exercise has gone'), pick, detail) : null);
  if (logged.length) drawDetail();
  return panel;
}
