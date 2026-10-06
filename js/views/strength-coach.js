// The optional AI coach in the Strength section: ask Claude for a workout (or a few, for a plan) or for ideas to round
// off the workout being built. The question and the checking of the answer live in ../strength/coach.js, the plumbing
// in ../llm.js, and the key stays on the server. Everything here degrades to "use the simple rules instead".

import { h } from '../dom.js';
import { ctx } from '../ctx.js';
import { openModal, toast } from '../modal.js';
import { askClaude, llmStatus, CoachError } from '../llm.js';
import { workoutRequest, ideasRequest, readWorkouts, readIdeas } from '../strength/coach.js';
import { catalogById, saveWorkout, savePlan } from '../strength/store.js';
import { describeRx } from '../strength/rx.js';
import { coachCtx, ui, rerender } from './strength-shared.js';

export const MODEL_NAMES = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5' };
export const modelName = (id) => MODEL_NAMES[id] ?? id ?? 'Claude';

/** Look up whether the coach is ready (once per visit) and redraw the page if that changed what it shows. */
export async function loadCoach() {
  const u = ui();
  if (u.coachLoaded) return;
  u.coachLoaded = true;
  const before = JSON.stringify(u.coach ?? null);
  u.coach = await llmStatus();
  if (JSON.stringify(u.coach ?? null) !== before) rerender();
}

/** 'off' (not talking to the server), 'setup' (no key yet) or 'ready'. */
export function coachState() {
  const s = ui().coach;
  return !s ? 'off' : s.ready ? 'ready' : 'setup';
}

/** A line saying what is wrong, with a way to fix it. */
export function coachProblem(e) {
  const code = e instanceof CoachError ? e.code : 'error';
  const msg = e instanceof CoachError ? e.message : 'Something went wrong asking the coach.';
  const fix = code === 'no_key' || code === 'invalid_key' ? [' ', h('a', { href: '#settings', id: 'coach-open-settings' }, 'Open Settings')] : null;
  return [msg, fix, h('span', { class: 'muted' }, ' You can still use the simple rule-based builder.')];
}

// ---------------------------------------------------------------- asking

/** A workout, or several for a plan, from a description. Throws a CoachError with something a person can read. */
export async function askForWorkouts(text) {
  const o = coachCtx();
  const res = await askClaude(workoutRequest(text, o));
  const read = readWorkouts(res.result, o);
  if (!read.workouts.length) throw new CoachError('Claude did not come back with a workout I could use. Try describing it a little differently.', 'empty');
  return { read, model: res.model, usage: res.usage };
}

/** Ideas to add to the workout being built. */
export async function askForIdeas(draft) {
  const o = coachCtx();
  const res = await askClaude(ideasRequest(draft, o, 5));
  const read = readIdeas(res.result, o, draft.items);
  if (!read.ideas.length) throw new CoachError('Claude had no further ideas that fit your equipment. The workout may be complete already.', 'empty');
  return { read, model: res.model };
}

/** Show a workout answer: one workout opens in the builder, several are previewed as a plan. */
export function showWorkouts(read, model, openEditor) {
  const notes = [...read.notes, ...read.problems];
  if (read.workouts.length === 1) {
    const w = read.workouts[0];
    openEditor({ name: w.name, items: w.items, interpretation: read.explanation, notes, why: w.why, source: 'ai', model });
    return;
  }
  openPlanPreview(read, model, openEditor);
}

function openPlanPreview(read, model, openEditor) {
  const by = catalogById(ctx.state);
  const save = () => {
    const ids = read.workouts.map((w) => saveWorkout(ctx.state, { name: `${read.title || 'Plan'} · ${w.name}`.slice(0, 80), items: w.items })?.id).filter(Boolean);
    if (!ids.length) { toast('Could not save (the list of saved workouts is full).', 'error'); return; }
    savePlan(ctx.state, { name: read.title || 'Plan from the coach', workoutIds: ids, note: read.explanation });
    ctx.store.save();
    modal.close();
    toast(`Saved ${ids.length} workouts (My workouts) and the plan “${read.title || 'Plan from the coach'}” that rotates through them.`, 'success');
    ui().page = 'plans';
    rerender();
  };
  const body = h('div', { class: 'coach-plan', id: 'coach-plan' },
    h('p', { class: 'hint' }, `✨ Built by ${modelName(model)}. Nothing is saved until you choose.`),
    read.explanation ? h('p', null, read.explanation) : null,
    [...read.notes, ...read.problems].length ? h('ul', { class: 'hint' }, [...read.notes, ...read.problems].map((n) => h('li', null, n))) : null,
    read.workouts.map((w, i) => h('section', { class: 'tpl-day', 'data-day': i },
      h('h3', null, w.name),
      h('ol', null, w.items.map((it) => h('li', null, by[it.exId]?.name ?? it.exId, h('small', { class: 'muted' }, ` ${describeRx({ ...it, perSide: !!by[it.exId]?.unilateral })}`), w.why[it.exId] ? h('small', { class: 'why' }, ` ${w.why[it.exId]}`) : null))),
      h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'open-day', onclick: () => { modal.close(); openEditor({ name: w.name, items: w.items, interpretation: read.explanation, notes: [], why: w.why, source: 'ai', model }); } }, 'Open in the builder'))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', id: 'coach-save-plan', onclick: save }, `Save ${read.workouts.length} workouts as a plan`),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => modal.close() }, 'Close')));
  const modal = openModal({ title: read.title || 'A plan from the coach', body, wide: true });
}
