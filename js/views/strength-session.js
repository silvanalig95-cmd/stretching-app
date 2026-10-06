// Doing a workout: tick off sets, optionally with reps, weight and time (with sensible starting points),
// then log it. Every number is optional: an exercise with no numbers still counts as done.

import { h, fill } from '../dom.js';
import { ctx, rankNow, findRoutine } from '../ctx.js';
import { toast } from '../modal.js';
import { catalogById, logStrength, updateStrengthSession } from '../strength/store.js';
import { suggestNext, describeRx, defaultRx, summarizeSets } from '../strength/rx.js';
import { lastSets, personalBests, describeSession } from '../strength/stats.js';
import { itemFor } from '../strength/builder.js';
import { ui, rerender, S, saveDraft, loadDraft, todayStr, muscleLine, exName } from './strength-shared.js';
import { openPicker } from './strength-exercises.js';
import { guideButton } from './guides.js';

const blankSet = () => ({ reps: '', weight: '', secs: '', band: '', done: false });
const loadable = (ex) => (ex.needs ?? []).some((n) => n === 'dumbbell' || n === 'cable_station') || (ex.loads ?? []).includes('dumbbell');
const filled = (s) => s.done || s.reps !== '' || s.weight !== '' || s.secs !== '';

function itemFromPlan(it, by) {
  const ex = by[it.exId];
  const rx = { sets: it.sets, ...(it.secs ? { secs: it.secs } : { reps: it.reps ?? defaultRx(ex ?? {}).reps }) };
  return { exId: it.exId, rx, note: it.note ?? '', sets: Array.from({ length: it.sets ?? 3 }, blankSet), showWeight: false };
}

// ---------------------------------------------------------------- starting and resuming

export function startSession({ title = 'Strength session', workoutId = null, items = [] } = {}) {
  const by = catalogById(ctx.state);
  const session = { id: null, title, workoutId, date: todayStr(), startedAt: Date.now(), minutes: '', note: '', intensity: null, items: items.map((i) => itemFromPlan(i, by)) };
  ui().session = session; ui().done = null; ui().page = 'session';
  saveDraft(session); rerender();
}
/** Open a logged session again to correct it. */
export function editSession(rec) {
  const by = catalogById(ctx.state);
  const session = {
    id: rec.id, title: rec.title, workoutId: rec.workoutId ?? null, date: rec.date, startedAt: Date.now(), minutes: rec.durationSec ? String(Math.round(rec.durationSec / 60)) : '', note: rec.note ?? '', intensity: rec.intensity ?? null,
    items: (rec.exercises ?? []).map((x) => ({ exId: x.exId, rx: { sets: x.sets.length || 3, ...(by[x.exId]?.metric === 'time' ? { secs: defaultRx(by[x.exId]).secs } : { reps: defaultRx(by[x.exId] ?? {}).reps }) }, note: x.note ?? '',
      sets: (x.sets.length ? x.sets : [blankSet()]).map((s) => ({ reps: s.reps ?? '', weight: s.weight ?? '', secs: s.secs ?? '', band: s.band ?? '', done: true })), showWeight: (x.sets ?? []).some((s) => s.weight) })),
  };
  ui().session = session; ui().done = null; ui().page = 'session';
  rerender();
}
/** An unfinished session saved before the page was closed. */
export function resumeDraft() {
  if (ui().session) return false;
  const d = loadDraft();
  if (d?.items && d.items.every((i) => typeof i.exId === 'string')) { ui().session = d; return true; }
  return false;
}

// ---------------------------------------------------------------- hand-off to the stretching side

export function stretchWhatYouTrained(rec) {
  const areas = (rec.areas ?? []).map((a) => a.id).filter((a) => a !== 'full_body').slice(0, 5);
  ctx.ui.filters.areas = areas.map((id) => ({ id, mode: 'tight' }));
  ctx.ui.filters.terms = [];
  rankNow();
  ctx.hooks.navigate('today');
  findRoutine({ web: false });
}

// ---------------------------------------------------------------- the view

export function sessionView() {
  const s = ui().session;
  const st = S();
  const by = catalogById(ctx.state);
  const others = () => ctx.state.history.filter((h) => h.id !== s.id);
  const save = () => saveDraft(s);
  const cards = h('div', { id: 'session-items' });

  const card = (it, idx) => {
    const ex = by[it.exId];
    if (!ex) return h('div', { class: 'session-card' }, h('p', null, `${it.exId} is no longer in your catalogue.`), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { s.items.splice(idx, 1); save(); drawCards(); } }, 'Remove'));
    const last = lastSets(others(), ex.id);
    const next = suggestNext(ex, last, { equipment: st.equipment, goal: st.prefs.goal, byId: by });
    const isTime = !!it.rx.secs;
    const showWeight = !isTime && (loadable(ex) || it.showWeight || it.sets.some((x) => x.weight !== ''));
    const holder = h('div', { class: 'session-card', 'data-ex': ex.id });
    const draw = () => {
      const rows = it.sets.map((row, k) => {
        const prev = [...it.sets.slice(0, k)].reverse().find((r) => r.done || r.reps !== '' || r.weight !== '' || r.secs !== '');
        const ph = (field) => String(prev?.[field] !== '' && prev?.[field] != null ? prev[field] : field === 'reps' ? next.reps ?? it.rx.reps?.[0] ?? '' : field === 'weight' ? next.weight ?? '' : field === 'secs' ? next.secs ?? it.rx.secs?.[0] ?? '' : '');
        const field = (key, label, extra = {}) => h('input', { type: 'number', inputmode: 'decimal', min: 0, step: key === 'weight' ? 0.5 : 1, value: row[key] === '' ? '' : String(row[key]), placeholder: ph(key), 'aria-label': `${ex.name} set ${k + 1} ${label}`, 'data-field': key, ...extra,
          onchange: (e) => { row[key] = e.target.value === '' ? '' : Number(e.target.value); save(); } });
        return h('div', { class: `set-row${row.done ? ' done' : ''}`, 'data-set': k },
          h('span', { class: 'set-n' }, `${k + 1}`),
          isTime ? field('secs', 'seconds') : field('reps', 'reps'),
          isTime ? h('span', { class: 'unit' }, 's') : null,
          showWeight ? field('weight', 'kilograms') : null, showWeight ? h('span', { class: 'unit' }, 'kg') : null,
          (ex.needs ?? []).includes('band_loop') ? h('select', { 'aria-label': `${ex.name} set ${k + 1} band`, 'data-field': 'band', onchange: (e) => { row.band = e.target.value; save(); } }, [h('option', { value: '' }, 'band'), ...st.equipment.bandLevels.map((b) => h('option', { value: b, selected: row.band === b }, b))]) : null,
          h('button', { class: `btn small${row.done ? ' primary' : ''}`, type: 'button', 'aria-pressed': row.done, 'aria-label': `${row.done ? 'Undo' : 'Mark'} set ${k + 1} done`, 'data-action': 'tick', onclick: () => {
            row.done = !row.done;
            if (row.done) {   // a tap with nothing typed accepts the suggested numbers
              if (isTime) { if (row.secs === '') row.secs = Number(ph('secs')) || ''; }
              else { if (row.reps === '') row.reps = Number(ph('reps')) || ''; if (showWeight && row.weight === '' && ph('weight') !== '') row.weight = Number(ph('weight')); }
            }
            save(); draw();
          } }, row.done ? '✓' : '○'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Remove set ${k + 1}`, onclick: () => { it.sets.splice(k, 1); save(); draw(); } }, '✕'));
      });
      fill(holder,
        h('div', { class: 'sc-head' },
          h('div', null, h('h4', null, ex.name), h('div', { class: 'muted small' }, muscleLine(ex)), h('div', { class: 'hint' }, `Plan: ${describeRx({ ...it.rx, perSide: ex.unilateral })}`)),
          h('div', { class: 'sc-tools' }, guideButton(ex, { onChange: draw }),
            h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Skip ${ex.name}`, 'data-action': 'skip', onclick: () => { s.items.splice(idx, 1); save(); drawCards(); } }, 'Skip'))),
        h('p', { class: 'next-note', 'data-note': 'proposal' }, last ? h('span', { class: 'muted' }, `Last time ${summarizeSets(last)}. `) : null, next.note),
        h('div', { class: 'set-rows' }, rows),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small', type: 'button', 'data-action': 'add-set', onclick: () => { it.sets.push(blankSet()); save(); draw(); } }, '＋ Set'),
          !isTime && !showWeight ? h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'add-weight', onclick: () => { it.showWeight = true; draw(); } }, '＋ Add weight') : null),
        h('input', { type: 'text', class: 'sc-note', maxlength: 300, placeholder: 'A note on this exercise (optional)', value: it.note ?? '', 'aria-label': `${ex.name} note`, onchange: (e) => { it.note = e.target.value; save(); } }));
    };
    draw();
    return holder;
  };

  const drawCards = () => fill(cards, s.items.length ? s.items.map(card) : h('p', { class: 'empty-note' }, 'No exercises in this session. Add the ones you do as you go.'));

  const elapsed = () => Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  const minutes = h('input', { type: 'number', id: 's-minutes', min: 0, max: 600, value: s.minutes === '' ? '' : String(s.minutes), placeholder: String(elapsed()), 'aria-label': 'Minutes it took', onchange: (e) => { s.minutes = e.target.value; save(); } });
  const date = h('input', { type: 'date', id: 's-date', value: s.date, max: todayStr(), 'aria-label': 'Day', onchange: (e) => { s.date = e.target.value || todayStr(); save(); } });
  const title = h('input', { type: 'text', id: 's-title', value: s.title, maxlength: 120, 'aria-label': 'Session name', onchange: (e) => { s.title = e.target.value; save(); } });
  const note = h('textarea', { id: 's-note', rows: 2, maxlength: 500, placeholder: 'How did it go? (optional)', onchange: (e) => { s.note = e.target.value; save(); } }); note.value = s.note;
  const intensity = h('div', { class: 'choice-row', role: 'radiogroup', 'aria-label': 'How hard was it' }, [['easy', 'Easy'], ['right', 'Just right'], ['hard', 'Hard']].map(([v, l]) => h('button', { type: 'button', class: `choice${s.intensity === v ? ' on' : ''}`, role: 'radio', 'aria-checked': s.intensity === v, onclick: (e) => { s.intensity = s.intensity === v ? null : v; save(); [...e.currentTarget.parentNode.children].forEach((b, i) => { const on = ['easy', 'right', 'hard'][i] === s.intensity; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); } }, l)));

  const finish = () => {
    const exercises = s.items.map((it) => ({ exId: it.exId, name: exName(it.exId), note: it.note, sets: it.sets.filter(filled).map((r) => ({ reps: r.reps, weight: r.weight, secs: r.secs, band: r.band })) }));
    if (!exercises.length) { toast('There is nothing in this session yet.', 'error'); return; }
    const mins = s.minutes === '' ? Math.min(240, elapsed()) : Number(s.minutes);
    const payload = { title: s.title, workoutId: s.workoutId ?? undefined, date: s.date, minutes: s.id ? Number(s.minutes) || 0 : mins, exercises, note: s.note, intensity: s.intensity };
    const rec = s.id ? updateStrengthSession(ctx.state, s.id, payload) : logStrength(ctx.state, payload);
    ctx.store.save(); saveDraft(null);
    ui().session = null; ui().page = 'done';
    ui().done = { rec, pbs: personalBests(rec, ctx.state.history), edited: !!s.id };
    ctx.hooks.renderResults?.();
    rerender();
  };

  const page = h('section', { class: 'panel', id: 'session' },
    h('div', { class: 'ed-head' }, h('h2', null, s.id ? 'Edit session' : 'Training'), title),
    h('div', { class: 'session-meta' }, h('label', { class: 'mini' }, h('span', null, 'day'), date), h('label', { class: 'mini' }, h('span', null, 'minutes'), minutes),
      h('span', { class: 'hint' }, 'Numbers are optional. Tap ○ to accept the suggestion for a set, or type your own.')),
    cards,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', id: 's-add', onclick: () => openPicker({ title: 'Add an exercise to this session', has: (id) => s.items.some((i) => i.exId === id), onPick: (ex) => { s.items.push(itemFromPlan(itemFor(ex, st.prefs.goal), by)); save(); drawCards(); } }) }, '＋ Add exercise')),
    h('h3', null, 'How hard was it overall?'), intensity,
    h('label', { class: 'note' }, h('span', null, 'Notes (optional)'), note),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', id: 's-finish', onclick: finish }, s.id ? 'Save changes' : 'Finish and log it'),
      h('button', { class: 'btn ghost', type: 'button', id: 's-cancel', onclick: () => { if (confirm(s.id ? 'Discard your changes?' : 'Discard this session without logging it?')) { ui().session = null; ui().page = 'workouts'; saveDraft(null); rerender(); } } }, s.id ? 'Cancel' : 'Discard')));
  drawCards();
  return page;
}

// ---------------------------------------------------------------- after logging

export function doneView() {
  const { rec, pbs, edited } = ui().done;
  const by = catalogById(ctx.state);
  return h('section', { class: 'panel', id: 'session-done' },
    h('h2', null, edited ? 'Saved ✓' : 'Logged ✓'),
    h('p', null, h('strong', null, rec.title), h('span', { class: 'muted' }, ` · ${rec.date} · ${describeSession(rec)}${rec.durationSec ? ` · ${Math.round(rec.durationSec / 60)} min` : ''}`)),
    pbs.length ? h('ul', { class: 'pbs', id: 'pbs' }, pbs.map((p) => h('li', null, '🏆 ', h('strong', null, by[p.exId]?.name ?? p.exId), p.kind === 'weight' ? ` new best: about ${p.now.e1rm} kg (was ${p.was.e1rm})` : p.kind === 'reps' ? ` new best: ${p.now.reps} reps (was ${p.was.reps})` : ` new best hold: ${p.now.secs} s (was ${p.was.secs})`))) : null,
    h('p', { class: 'hint' }, 'It is in your Journal now, together with your stretching.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', id: 'stretch-trained', onclick: () => stretchWhatYouTrained(rec) }, 'Stretch what you trained →'),
      h('button', { class: 'btn', type: 'button', id: 'done-edit', onclick: () => editSession(rec) }, 'Edit this session'),
      h('button', { class: 'btn ghost', type: 'button', id: 'done-close', onclick: () => { ui().done = null; ui().page = 'workouts'; rerender(); } }, 'Back to workouts')));
}
