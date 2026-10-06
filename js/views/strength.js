// Strength: describe or build a workout, start from a template, keep your own exercises, follow a plan, log sets.
// It sits beside the stretching side and shares only the body map and the Journal.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { toast } from '../modal.js';
import { catalogById, saveWorkout, deleteWorkout, duplicateWorkout, savePlan, deletePlan, nextInPlan, lastDoneDate, HOME_GYM } from '../strength/store.js';
import { buildFromRequest, parseRequest } from '../strength/builder.js';
import { TEMPLATES, instantiate, bestTemplates } from '../strength/templates.js';
import { describeRx } from '../strength/rx.js';
import { EQUIPMENT, GOALS, LEVELS, AVOID_FLAGS } from '../strength/muscles.js';
import { ui, S, builderCtx, minutesOf, musclesOfItems, rerender, go } from './strength-shared.js';
import { exercisesPage } from './strength-exercises.js';
import { editorView, openEditor } from './strength-editor.js';
import { sessionView, doneView, startSession, resumeDraft } from './strength-session.js';
import { loadCoach, coachState, coachProblem, askForWorkouts, showWorkouts, modelName } from './strength-coach.js';

const PAGES = [['workouts', 'Workouts'], ['exercises', 'Exercises'], ['plans', 'Plans'], ['setup', 'Setup']];
const EXAMPLES = ['45 minutes upper body, strength', 'legs and hip stability for running, 40 min', 'dumbbells only, full body, 30 minutes', 'pistol squat progression and side plank', 'core and glutes, no equipment'];

export function mountStrength(root) {
  const u = ui();
  if (resumeDraft()) u.page = 'session';
  const draw = () => {
    const st = S();
    const page = u.page === 'session' && u.session ? 'session' : u.page === 'done' && u.done ? 'done' : u.page === 'build' && u.editor ? 'build'
      : ['exercises', 'plans', 'setup'].includes(u.page) ? u.page : 'workouts';
    u.page = page;
    const body = { session: sessionView, done: doneView, build: editorView, exercises: exercisesPage, plans: plansPage, setup: setupPage, workouts: workoutsPage }[page]();
    fill(root,
      h('h1', null, 'Strength'),
      h('p', { class: 'sub' }, 'Build workouts from a catalogue of exercises that fit your equipment, follow a plan, and log what you lift. Your stretching and strength sit together in the Journal.'),
      !st.equipment.configured ? h('p', { class: 'banner', id: 'strength-setup-note' }, 'Tell me what you train with, so I only suggest what you can do. ',
        h('button', { class: 'link', type: 'button', id: 'use-home-gym', onclick: () => { applyHomeGym(); } }, 'Use the home-gym preset'), ' (dumbbells, bench, cable station, pull-up bar, loop bands, inversion trainer), or ', h('button', { class: 'link', type: 'button', onclick: () => go('setup') }, 'choose in Setup'), '.') : null,
      u.session && page !== 'session' ? h('p', { class: 'banner', id: 'session-banner' }, `A session is in progress (${u.session.title}). `, h('button', { class: 'link', type: 'button', id: 'resume-session', onclick: () => go('session') }, 'Resume it')) : null,
      h('nav', { class: 'subtabs', 'aria-label': 'Strength sections' }, PAGES.map(([id, label]) => h('button', {
        type: 'button', class: `subtab${page === id ? ' on' : ''}`, id: `st-${id}`, 'aria-current': page === id ? 'page' : null,
        onclick: () => { u.page = id; if (id === 'workouts') u.done = null; rerender(); } }, label)),
        u.session ? h('button', { type: 'button', class: `subtab${page === 'session' ? ' on' : ''}`, id: 'st-session', onclick: () => go('session') }, '● Training') : null,
        u.editor ? h('button', { type: 'button', class: `subtab${page === 'build' ? ' on' : ''}`, id: 'st-editor', onclick: () => go('build') }, '✎ Building') : null),
      body);
  };
  u.mounted = draw;
  draw();
  loadCoach();
}

function applyHomeGym() {
  const st = S();
  st.equipment.have = [...HOME_GYM];
  st.equipment.configured = true;
  if (!ctx.state.prefs.strengthGoal && !ctx.state.prefs.strengthGoalSet) ctx.state.prefs.strengthGoal = 3;
  ctx.store.save();
  toast('Equipment set. You can fine-tune it in Setup.', 'success');
  rerender();
}

// ---------------------------------------------------------------- workouts: describe, saved, templates

/** The three words, in plain language. Open for newcomers, folded away once there is a plan. */
function explainer(open) {
  return h('details', { class: 'panel explainer', id: 'how-it-fits', open },
    h('summary', null, 'How exercises, workouts and plans fit together'),
    h('ol', { class: 'fit' },
      h('li', null, h('strong', null, 'Exercise'), ' is one movement, such as “Pull-up” or “Plank”. They live in the catalogue (the Exercises tab).'),
      h('li', null, h('strong', null, 'Workout'), ' is one training session: a list of exercises with sets and reps, for example “Upper A”. You start a workout, log your sets, and it goes into the Journal.'),
      h('li', null, h('strong', null, 'Plan'), ' is an order of workouts that you rotate through, for example Upper A → Lower → Upper B → Lower. A plan has no exercises of its own; it only remembers which workout is up next, so you can just press start.')),
    h('p', { class: 'hint' }, 'You do not need a plan: single workouts are fine. A template from below is a ready-made plan that is saved as its workouts plus the rotation.'));
}

/** Plans that a workout is part of. */
const plansOf = (workoutId) => S().plans.filter((p) => p.workoutIds.includes(workoutId));

/** One line per plan: which workout is next. */
function nextUpPanel() {
  const rows = S().plans.map((p) => ({ p, next: nextInPlan(ctx.state, p) })).filter((r) => r.next);
  if (!rows.length) return null;
  return h('section', { class: 'panel next-up', id: 'next-up' },
    h('h2', null, 'Next up'),
    h('ul', { class: 'next-list' }, rows.map(({ p, next }) => h('li', { 'data-plan': p.id },
      h('span', null, h('strong', null, next.name), h('small', { class: 'muted' }, ` · from the plan “${p.name}”${lastDoneDate(ctx.state, next.id) ? ` · last done ${lastDoneDate(ctx.state, next.id)}` : ' · not done yet'}`)),
      h('button', { class: 'btn small primary', type: 'button', 'data-action': 'start-next-up', onclick: () => startSession({ title: next.name, workoutId: next.id, items: next.items }) }, '▶ Start')))));
}


function workoutsPage() {
  const st = S();
  const by = catalogById(ctx.state);
  const input = h('input', { type: 'text', id: 'describe', placeholder: 'Describe it: “45 minutes upper body for strength”, “legs and hip stability for running”…', 'aria-label': 'Describe the workout you want', autocomplete: 'off', spellcheck: 'false' });
  const note = h('p', { class: 'hint', id: 'describe-note', 'aria-live': 'polite' });
  const buildRules = () => {
    const text = input.value.trim();
    if (!text) { note.textContent = 'Say a little about what you want, for example “45 minutes upper body”.'; return; }
    const ctxb = builderCtx();
    const parsed = parseRequest(text, { catalog: ctxb.catalog });
    if (parsed.days && parsed.days >= 2) {
      const tpls = bestTemplates(parsed, ctxb).slice(0, 3);
      note.textContent = `That sounds like a plan for ${parsed.days} days a week. These templates fit best, or build a single workout below: ${tpls.map((t) => t.name).join(' · ')}.`;
      document.getElementById('templates-panel')?.scrollIntoView({ block: 'start' });
    }
    const r = buildFromRequest(text, ctxb);
    openEditor({ name: r.name, items: r.items, interpretation: r.interpretation, notes: r.notes, source: 'rules' });
  };
  const buildCoach = async () => {
    const text = input.value.trim();
    if (!text) { note.textContent = 'Say a little about what you want, for example “a 4-day plan for running strength, 45 minutes”.'; return; }
    const state = coachState();
    if (state === 'off') { note.textContent = 'The AI coach needs the app server (serve.py), which keeps your Anthropic key. This page is not connected to it, so “Build it” (simple rules) is what works here.'; return; }
    if (state === 'setup') { fill(note, 'The coach needs your Anthropic API key. ', h('a', { href: '#settings', id: 'coach-open-settings' }, 'Add it in Settings'), '. Until then “Build it” uses simple rules.'); return; }
    const buttons = [...document.querySelectorAll('#describe-panel button')];
    buttons.forEach((b) => { b.disabled = true; });
    fill(note, `Asking ${modelName(ui().coach?.model)}… this usually takes 10 to 40 seconds.`);
    try {
      const { read, model } = await askForWorkouts(text);
      showWorkouts(read, model, openEditor);
      fill(note);
    } catch (e) { fill(note, coachProblem(e)); } finally { buttons.forEach((b) => { b.disabled = false; }); }
  };
  const coach = ui().coach;
  const coachLine = coachState() === 'ready' ? `AI coach ready: ${modelName(coach.model)}${coach.dailyCap ? `, ${coach.usedToday ?? 0} of ${coach.dailyCap} requests used today` : ''}.`
    : coachState() === 'setup' ? 'The AI coach is off until you add your Anthropic key in Settings.' : '';
  const describePanel = h('section', { class: 'panel', id: 'describe-panel' },
    h('h2', null, 'Describe a workout'),
    h('form', { class: 'command', onsubmit: (e) => { e.preventDefault(); buildRules(); } }, input,
      h('button', { class: 'btn primary', type: 'submit', id: 'describe-go', title: 'Instant and offline: picks exercises from the catalogue with simple scoring rules' }, 'Build it'),
      h('button', { class: 'btn', type: 'button', id: 'describe-coach', title: 'Ask Claude to design it (needs your Anthropic API key)', onclick: buildCoach }, '✨ Ask the coach')),
    h('div', { class: 'chips' }, EXAMPLES.map((t) => h('button', { type: 'button', class: 'chip quick', onclick: () => { input.value = t; buildRules(); } }, t))),
    note,
    h('p', { class: 'hint', id: 'describe-explainer' }, h('strong', null, 'Build it'), ' uses simple built-in rules: it picks up muscles, length, equipment and goal words from what you type and chooses from the catalogue by scoring. It is quick and works offline, but it is not an expert. ',
      h('strong', null, '✨ Ask the coach'), ' sends your request, your equipment, your goal and your last two weeks of strength sessions to Claude, which designs the workout (or a whole plan) from the same catalogue and explains why. ', coachLine ? h('span', { id: 'coach-line' }, coachLine) : null),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', id: 'new-workout', onclick: () => openEditor({ name: '' }) }, '＋ Start from nothing'),
      h('button', { class: 'btn', type: 'button', id: 'empty-session', onclick: () => startSession({ title: 'Strength session', items: [] }) }, '▶ Log a session as I go')));

  const saved = st.workouts;
  const savedPanel = h('section', { class: 'panel', id: 'my-workouts' },
    h('h2', null, `My workouts${saved.length ? ` (${saved.length})` : ''}`),
    h('p', { class: 'hint' }, 'A workout is one training session. Start one to log it, or put several into a plan (Plans tab) to rotate through them.'),
    saved.length ? h('div', { class: 'wk-grid' }, [...saved].sort((a, b) => b.updatedAt - a.updatedAt).map((w) => {
      const last = lastDoneDate(ctx.state, w.id);
      return h('article', { class: 'wk-card', 'data-workout': w.id },
        h('h3', null, w.name),
        h('p', { class: 'badges' }, plansOf(w.id).length ? plansOf(w.id).map((p) => h('button', { class: 'badge plan', type: 'button', title: 'Show this plan', 'data-action': 'show-plan', onclick: () => go('plans') }, `in plan: ${p.name}`)) : h('span', { class: 'badge' }, 'single workout')),
        h('p', { class: 'hint' }, `${w.items.length} exercise${w.items.length === 1 ? '' : 's'} · about ${minutesOf(w.items)} min${last ? ` · last done ${last}` : ''}`),
        h('p', { class: 'muted small' }, musclesOfItems(w.items, by).slice(0, 5).join(', ')),
        h('ol', { class: 'wk-items' }, w.items.slice(0, 8).map((i) => h('li', null, by[i.exId]?.name ?? i.exId, i.anchor ? ' ★' : '', h('small', { class: 'muted' }, ` ${by[i.exId] ? describeRx({ ...i, perSide: by[i.exId].unilateral }) : ''}`))), w.items.length > 8 ? h('li', { class: 'muted' }, `+${w.items.length - 8} more`) : null),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small primary', type: 'button', 'data-action': 'start-workout', onclick: () => startSession({ title: w.name, workoutId: w.id, items: w.items }) }, '▶ Start'),
          h('button', { class: 'btn small', type: 'button', 'data-action': 'edit-workout', onclick: () => openEditor({ ...w }) }, 'Edit'),
          h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'copy-workout', onclick: () => { duplicateWorkout(ctx.state, w.id); ctx.store.save(); rerender(); } }, 'Duplicate'),
          h('button', { class: 'btn small ghost danger', type: 'button', 'data-action': 'delete-workout', onclick: () => { if (confirm(`Delete “${w.name}”? Sessions you logged with it stay in your Journal.`)) { deleteWorkout(ctx.state, w.id); ctx.store.save(); rerender(); } } }, 'Delete')));
    })) : h('p', { class: 'empty-note', id: 'no-workouts' }, 'Nothing saved yet. Describe a workout above, pick a template below, or build one from the catalogue, then save it to reuse.'));

  const ctxb = builderCtx();
  const templatesPanel = h('section', { class: 'panel', id: 'templates-panel' },
    h('h2', null, 'Start from a template'),
    h('p', { class: 'hint' }, 'Ready-made programmes, filled in with what you own and your settings. A template with several days saves those days as separate workouts plus a plan that rotates through them; a one-day template saves a single workout. The ★ lifts are the ones to keep for 6–8 weeks; everything else can be swapped.'),
    h('div', { class: 'tpl-grid' }, TEMPLATES.map((tpl) => {
      const { workouts, notes } = instantiate(tpl, ctxb);
      return h('article', { class: 'tpl-card', 'data-template': tpl.id },
        h('h3', null, tpl.name),
        h('p', { class: 'hint' }, tpl.blurb),
        h('details', null, h('summary', null, workouts.length > 1 ? `${workouts.length} workouts in rotation: preview` : 'One workout: preview'),
          workouts.map((w) => h('div', { class: 'tpl-day' }, h('strong', null, w.name), h('ol', null, w.items.map((i) => h('li', null, by[i.exId]?.name ?? i.exId, i.anchor ? ' ★' : ''))),
            h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'open-day', onclick: () => openEditor({ name: `${tpl.name.split(',')[0]} · ${w.name}`, items: w.items, template: tpl.id }) }, 'Open in the builder'))),
          notes.length ? h('ul', { class: 'hint' }, notes.map((n) => h('li', null, n))) : null,
          tpl.tips?.length ? h('ul', { class: 'hint' }, tpl.tips.map((t) => h('li', null, t))) : null),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn small primary', type: 'button', 'data-action': 'use-template', onclick: () => useTemplate(tpl, workouts) }, workouts.length > 1 ? `Save as a plan (${workouts.length} workouts)` : 'Save this workout')));
    })));
  return h('div', { id: 'workouts-page' }, explainer(!st.plans.length && st.workouts.length < 3), nextUpPanel(), describePanel, savedPanel, templatesPanel);
}

/** Save a template's workouts, and (when there are several) a plan that cycles through them. */
function useTemplate(tpl, workouts) {
  const ids = workouts.map((w) => saveWorkout(ctx.state, { name: `${tpl.name.split(',')[0]} · ${w.name}`, items: w.items, template: tpl.id })?.id).filter(Boolean);
  if (workouts.length > 1) savePlan(ctx.state, { name: tpl.name, workoutIds: ids, template: tpl.id, note: (tpl.tips ?? []).join(' ') });
  ctx.store.save();
  toast(workouts.length > 1 ? `Saved ${ids.length} workouts (My workouts) and a plan “${tpl.name}” that rotates through them.` : `Saved “${tpl.name}” as a workout.`, 'success');
  ui().page = workouts.length > 1 ? 'plans' : 'workouts';
  rerender();
}

// ---------------------------------------------------------------- plans

function plansPage() {
  const st = S();
  const by = catalogById(ctx.state);
  const wk = (id) => st.workouts.find((w) => w.id === id);
  const planCard = (p) => {
    const next = nextInPlan(ctx.state, p);
    const body = h('article', { class: 'plan-card', 'data-plan': p.id });
    const drawCard = () => fill(body,
      h('h3', null, p.name),
      h('p', { class: 'rotation muted small' }, p.workoutIds.length ? `Rotation: ${p.workoutIds.map((id) => wk(id)?.name ?? '(deleted)').join(' → ')} → and round again` : 'Empty: add a workout below.'),
      p.note ? h('p', { class: 'hint' }, p.note) : null,
      h('ol', { class: 'plan-days' }, p.workoutIds.map((id, i) => { const w = wk(id); return h('li', { class: w && next?.id === id ? 'next' : '' }, w ? w.name : '(deleted)', w && next?.id === id ? h('span', { class: 'badge new' }, 'next') : null, w ? h('small', { class: 'muted' }, ` ${lastDoneDate(ctx.state, id) ? `last ${lastDoneDate(ctx.state, id)}` : 'not done yet'}`) : null,
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [p.workoutIds[i - 1], p.workoutIds[i]] = [p.workoutIds[i], p.workoutIds[i - 1]]; ctx.store.save(); drawCard(); } }, '▲'),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Move down', disabled: i === p.workoutIds.length - 1, onclick: () => { [p.workoutIds[i + 1], p.workoutIds[i]] = [p.workoutIds[i], p.workoutIds[i + 1]]; ctx.store.save(); drawCard(); } }, '▼'),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Take out of the plan', onclick: () => { p.workoutIds.splice(i, 1); ctx.store.save(); rerender(); } }, '✕')); })),
      (() => {
        const left = st.workouts.filter((w) => !p.workoutIds.includes(w.id));
        if (!left.length) return null;
        const sel = h('select', { 'aria-label': 'Add a saved workout to this plan' }, left.map((w) => h('option', { value: w.id }, w.name)));
        return h('div', { class: 'row-actions' }, sel, h('button', { class: 'btn small', type: 'button', onclick: () => { p.workoutIds.push(sel.value); ctx.store.save(); rerender(); } }, '＋ Add'));
      })(),
      h('div', { class: 'row-actions' },
        next ? h('button', { class: 'btn small primary', type: 'button', 'data-action': 'start-next', onclick: () => startSession({ title: next.name, workoutId: next.id, items: next.items }) }, `▶ Start ${next.name}`) : null,
        h('button', { class: 'btn small ghost danger', type: 'button', 'data-action': 'delete-plan', onclick: () => { if (confirm(`Delete the plan “${p.name}”? Your workouts stay.`)) { deletePlan(ctx.state, p.id); ctx.store.save(); rerender(); } } }, 'Delete plan')));
    drawCard();
    return body;
  };
  const name = h('input', { type: 'text', id: 'plan-name', placeholder: 'Plan name, e.g. “Spring block”', maxlength: 80, 'aria-label': 'Plan name' });
  const picks = new Set();
  return h('div', { id: 'plans-page' },
    h('section', { class: 'panel' },
      h('h2', null, 'Plans'),
      h('p', { class: 'hint' }, 'A plan is an order of workouts that you rotate through; it holds no exercises of its own. “Next up” is the workout after the one you did last, and after the last one it starts again from the top. Keep the ★ lifts the same for 6–8 weeks so progress is measurable; swap accessories when you like.'),
      st.plans.length ? h('div', { class: 'plan-grid' }, st.plans.map(planCard)) : h('p', { class: 'empty-note', id: 'no-plans' }, 'No plans yet. Save a template as a plan on the Workouts page, or make one from your own workouts below.')),
    h('section', { class: 'panel' },
      h('h3', null, 'New plan from my workouts'),
      st.workouts.length ? h('form', { onsubmit: (e) => {
        e.preventDefault();
        if (!picks.size) { toast('Pick at least one workout.', 'error'); return; }
        savePlan(ctx.state, { name: name.value.trim() || 'My plan', workoutIds: st.workouts.filter((w) => picks.has(w.id)).map((w) => w.id) });
        ctx.store.save(); rerender();
      } }, name,
        h('div', { class: 'chips' }, st.workouts.map((w) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-workout': w.id, onclick: (e) => { if (picks.has(w.id)) picks.delete(w.id); else picks.add(w.id); e.currentTarget.classList.toggle('on', picks.has(w.id)); e.currentTarget.setAttribute('aria-pressed', picks.has(w.id)); } }, w.name))),
        h('button', { class: 'btn primary', type: 'submit', id: 'plan-save' }, 'Create plan')) : h('p', { class: 'empty-note' }, 'Save a workout first.')));
}

// ---------------------------------------------------------------- setup

function setupPage() {
  const st = S();
  const have = new Set(st.equipment.have);
  const list = (s) => String(s).split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const bells = h('input', { type: 'text', id: 'su-bells', value: st.equipment.dumbbellKg.join(', '), 'aria-label': 'Dumbbell weights in kilograms' });
  const step = h('input', { type: 'number', id: 'su-step', min: 0.5, step: 0.5, value: String(st.equipment.cableStepKg), 'aria-label': 'Cable weight step in kilograms' });
  const stack = h('input', { type: 'number', id: 'su-stack', min: 5, value: String(st.equipment.cableMaxKg), 'aria-label': 'Heaviest cable weight in kilograms' });
  const bands = h('input', { type: 'text', id: 'su-bands', value: st.equipment.bandLevels.join(', '), 'aria-label': 'Names of your loop bands, lightest first' });
  const goal = h('select', { id: 'su-goal' }, GOALS.map((g) => h('option', { value: g.id, selected: g.id === st.prefs.goal }, g.label)));
  const level = h('select', { id: 'su-level' }, LEVELS.map(([v, l]) => h('option', { value: v, selected: v === st.prefs.level }, l)));
  const minutes = h('input', { type: 'number', id: 'su-minutes', min: 10, max: 120, value: String(st.prefs.minutes), 'aria-label': 'Usual session length in minutes' });
  const weekly = h('input', { type: 'number', id: 'su-weekly', min: 0, max: 7, value: String(ctx.state.prefs.strengthGoal || 0), 'aria-label': 'Strength sessions per week' });
  const avoid = new Set(st.prefs.avoid);
  const checks = (items, set, idPrefix) => h('div', { class: 'checks' }, items.map(([id, label]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id: `${idPrefix}-${id}`, checked: set.has(id), onchange: (e) => { if (e.target.checked) set.add(id); else set.delete(id); } }), ` ${label}`)));
  const excluded = st.prefs.excluded;
  const by = catalogById(ctx.state);
  return h('section', { class: 'panel', id: 'setup-page' },
    h('h2', null, 'Setup'),
    h('h3', null, 'What you have to train with'),
    checks(EQUIPMENT.filter((e) => !e.always).map((e) => [e.id, e.label]), have, 'eq'),
    h('div', { class: 'form-row' }, h('label', null, h('span', null, 'Dumbbell weights (kg, each)'), bells), h('label', null, h('span', null, 'Cable weight step (kg)'), step), h('label', null, h('span', null, 'Heaviest cable weight (kg)'), stack), h('label', null, h('span', null, 'Loop bands, lightest first'), bands)),
    h('p', { class: 'hint' }, 'The weights are used to suggest your next step up (the next dumbbell you own, the next notch on the stack). Bodyweight always counts.'),
    h('h3', null, 'Your goal'),
    h('div', { class: 'form-row' }, h('label', null, h('span', null, 'Training for'), goal), h('label', null, h('span', null, 'Level'), level), h('label', null, h('span', null, 'Usual session (min)'), minutes), h('label', null, h('span', null, 'Strength sessions a week (0 = no goal)'), weekly)),
    h('h3', null, 'Movements to avoid'),
    h('p', { class: 'hint' }, 'Exercises that load these are left out of suggestions and templates (they stay in the catalogue).'),
    checks(AVOID_FLAGS.map((a) => [a.id, a.label]), avoid, 'av'),
    excluded.length ? h('div', null, h('h3', null, 'Never suggest'), h('ul', { class: 'backups' }, excluded.map((id) => h('li', { 'data-ex': id }, h('span', null, by[id]?.name ?? id), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { st.prefs.excluded = st.prefs.excluded.filter((x) => x !== id); ctx.store.save(); rerender(); } }, 'Allow again'))))) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', id: 'su-save', onclick: () => {
      st.equipment = { ...st.equipment, configured: true, have: [...have], dumbbellKg: [...new Set(list(bells.value))].sort((a, b) => a - b), cableStepKg: Number(step.value) || 5, cableMaxKg: Number(stack.value) || 60, bandLevels: bands.value.split(/[,;]+/).map((b) => b.trim()).filter(Boolean).slice(0, 6) };
      if (!st.equipment.dumbbellKg.length) st.equipment.dumbbellKg = [2, 4, 6, 8, 10];
      if (!st.equipment.bandLevels.length) st.equipment.bandLevels = ['light', 'medium', 'heavy'];
      st.prefs = { ...st.prefs, goal: goal.value, level: level.value, minutes: Math.min(120, Math.max(10, Number(minutes.value) || 45)), avoid: [...avoid] };
      ctx.state.prefs.strengthGoal = Math.min(7, Math.max(0, Math.round(Number(weekly.value) || 0))); ctx.state.prefs.strengthGoalSet = true;
      ctx.store.save(); toast('Saved.', 'success'); rerender();
    } }, 'Save'), h('button', { class: 'btn', type: 'button', id: 'su-preset', onclick: () => applyHomeGym() }, 'Use the home-gym preset')));
}

