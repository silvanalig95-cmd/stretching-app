// The AI coach: how the question for Claude is put together, and how its answer is checked.
// Nothing here talks to the network (see ../llm.js) or touches the page, so it can be tested on its own.
//
// Claude never gets to invent anything. It is shown the catalogue of exercises the person can actually do (their
// equipment, their movements-to-avoid and their "never suggest" list already applied), answers with ids from it, and
// every id in the answer is checked against the same list again before anything reaches the screen.

import { SLOTS, GOALS, EQUIPMENT_BY_ID } from './muscles.js';
import { doable, hasAvoided, indexExercises } from './catalog.js';
import { defaultRx, summarizeSets } from './rx.js';

const SLOT_ORDER = Object.keys(SLOTS);
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo ? Math.min(hi, n) : 0; };

// ---------------------------------------------------------------- what Claude may choose from

/** The exercises this person can do: equipment owned, nothing they avoid, nothing they said never to suggest. */
export function candidatesFor({ catalog, have, avoid = [], exclude = new Set() }) {
  return catalog.filter((e) => doable(e, have) && !hasAvoided(e, avoid) && !exclude.has(e.id))
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.id.localeCompare(b.id));
}

/** One compact line per exercise: id | name | movement | main muscles | helping muscles | needs | level | counted in | notes. */
export function catalogueLines(o) {
  const list = candidatesFor(o);
  const ids = new Set(list.map((e) => e.id));
  return list.map((e) => [
    e.id, e.name.replace(/\s+/g, ' '), e.slot, e.primary.join(','), e.secondary.slice(0, 3).join(','),
    e.needs.length ? e.needs.join('+') : 'none', `L${e.level}`, e.metric === 'time' ? 'seconds' : 'reps',
    [e.unilateral ? 'one side at a time' : '', e.next && ids.has(e.next) ? `harder: ${e.next}` : ''].filter(Boolean).join('; '),
  ].filter((field, i, all) => i < all.length - 1 || field).join(' | '));
}

const SYSTEM = `You are an experienced strength and conditioning coach who designs home workouts for one person.

You may only use exercises from the CATALOGUE at the end, and you refer to them by their id. Everything in the catalogue is something this person can do with the equipment they own, and nothing in it is on their avoid list, so never invent an exercise or an id and never suggest equipment they do not have.

How to build a workout:
- Fit the length of time the person asks for, or their usual session length. As a guide: a set takes 40-60 seconds of work plus rest (about 2 minutes after heavy compound lifts, 1 minute after accessories, 30-45 seconds after core and stability work), plus about a minute of set-up per exercise.
- Order: main compound lifts first, then accessories, then stability and core.
- Balance: pair pressing with pulling and squatting with hinging, unless the request is deliberately narrow (for example "only biceps").
- Match the goal and the level. Do not pick level 3 exercises for a beginner. For running, favour single-leg strength, hips, calves and core, and keep loads moderate.
- Look at RECENT TRAINING: avoid hammering muscles that were trained hard in the last two days, and build on what they already do (the "harder:" id is the next step of a progression) rather than repeating it blindly.
- For a multi-day request such as a weekly plan, give one workout per training day (at most 6), vary the emphasis between days and keep the main lifts consistent from day to day.
- Sets: 1 to 6. Reps and seconds are whole-number ranges (low at most high). Use seconds only for exercises counted in seconds; leave the unused number fields at 0.
- Give each exercise one short, concrete reason ("why").
- "explanation" is 2-4 plain sentences on what the workout does and why it fits the request. "notes" holds caveats: what you could not include because of equipment, how to choose loads, what you assumed when the request was vague. If anything sounds like an injury or a medical condition, stay conservative and say in the notes that a professional should look at it.
- Write the explanation, notes and reasons in the language of the request.
- For a single workout return exactly one entry in "workouts".`;

/** The long, stable part of the question (instructions + catalogue). The same text for the same equipment, so it can be cached. */
export function systemPrompt(o) {
  return `${SYSTEM}\n\nCATALOGUE (id | name | movement | main muscles | helping muscles | needs | level | counted in | notes)\n${catalogueLines(o).join('\n')}`;
}

// ---------------------------------------------------------------- what Claude is told about the person

/** The last sessions, in a line each. Only exercise names, sets and dates: nothing from the video library or notes. */
export function recentLines({ history = [], catalog = [], today = new Date().toISOString().slice(0, 10), days = 14, max = 6 } = {}) {
  const from = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
  const by = indexExercises(catalog);
  return history.filter((h) => h.kind === 'strength' && h.date >= from).sort((a, b) => b.date.localeCompare(a.date)).slice(0, max)
    .map((h) => `${h.date} ${text(h.title, 60) || 'Strength session'}: ${(h.exercises ?? []).slice(0, 10).map((x) => `${by[x.exId]?.name || text(x.name, 40) || x.exId} ${summarizeSets(x.sets) || '(done)'}`).join('; ')}`);
}

function personLines(o) {
  const eq = o.equipment ?? {};
  const have = [...o.have].filter((id) => id !== 'bodyweight').map((id) => EQUIPMENT_BY_ID[id]?.label.replace(/ \(.*\)/, '') ?? id);
  const goal = GOALS.find((g) => g.id === o.goal);
  return [
    `Goal: ${goal ? `${goal.label} (${goal.blurb})` : o.goal ?? 'general fitness'}`,
    `Level: ${o.level ?? 'intermediate'}`,
    `Usual session length: ${o.minutes ?? 45} minutes${o.perWeek ? `; aims for ${o.perWeek} strength sessions a week` : ''}`,
    `Equipment: bodyweight${have.length ? `, ${have.join(', ')}` : ''}`,
    (eq.dumbbellKg ?? []).length && o.have.has('dumbbell') ? `Dumbbells: ${eq.dumbbellKg.join(', ')} kg each` : '',
    o.have.has('cable_station') && eq.cableStepKg ? `Cable station: steps of ${eq.cableStepKg} kg up to ${eq.cableMaxKg} kg` : '',
    (o.weakAreas ?? []).length ? `Wants to strengthen: ${o.weakAreas.map((a) => String(a).replace(/_/g, ' ')).join(', ')}` : '',
    o.legsFatigued ? 'Legs are tired from a hard run today: go easy on them' : '',
  ].filter(Boolean);
}

const draftLines = (items, by) => items.map((it) => `${it.exId} (${by[it.exId]?.name ?? '?'}) ${it.sets ?? '?'} sets`);

// ---------------------------------------------------------------- the questions

const num = { type: 'integer' };
const str = { type: 'string' };

/** The shape of a workout answer. Every field is required and objects are closed, as structured outputs need. */
export const WORKOUTS_SCHEMA = {
  type: 'object',
  properties: {
    title: str,
    explanation: str,
    workouts: { type: 'array', items: { type: 'object', properties: {
      name: str,
      items: { type: 'array', items: { type: 'object', properties: { exercise_id: str, sets: num, reps_low: num, reps_high: num, seconds_low: num, seconds_high: num, why: str },
        required: ['exercise_id', 'sets', 'reps_low', 'reps_high', 'seconds_low', 'seconds_high', 'why'], additionalProperties: false } },
    }, required: ['name', 'items'], additionalProperties: false } },
    notes: { type: 'array', items: str },
  },
  required: ['title', 'explanation', 'workouts', 'notes'],
  additionalProperties: false,
};

export const IDEAS_SCHEMA = {
  type: 'object',
  properties: {
    summary: str,
    ideas: { type: 'array', items: { type: 'object', properties: { exercise_id: str, why: str }, required: ['exercise_id', 'why'], additionalProperties: false } },
  },
  required: ['summary', 'ideas'],
  additionalProperties: false,
};

/** Ask for a workout (or a few, for a plan) from a description. */
export function workoutRequest(request, o) {
  const lines = ['REQUEST', text(request, 600), '', 'PERSON', ...personLines(o)];
  const recent = recentLines({ history: o.history, catalog: o.catalog, today: o.today });
  lines.push('', 'RECENT TRAINING (last 14 days)', ...(recent.length ? recent : ['nothing logged']));
  return { system: systemPrompt(o), prompt: lines.join('\n'), schema: WORKOUTS_SCHEMA, maxTokens: 8000 };
}

/** Ask what to add to a workout that is being built. */
export function ideasRequest(draft, o, count = 5) {
  const by = indexExercises(o.catalog);
  const lines = [`Suggest ${count} exercises that would round off the workout below, none of which are already in it. Choose only ids from the catalogue and give a short reason for each. Put your overall thinking in "summary".`, '',
    `WORKOUT BEING BUILT${draft.name ? `: ${text(draft.name, 80)}` : ''}`, ...(draft.items.length ? draftLines(draft.items, by) : ['empty so far']), '', 'PERSON', ...personLines(o)];
  const recent = recentLines({ history: o.history, catalog: o.catalog, today: o.today });
  lines.push('', 'RECENT TRAINING (last 14 days)', ...(recent.length ? recent : ['nothing logged']));
  return { system: systemPrompt(o), prompt: lines.join('\n'), schema: IDEAS_SCHEMA, maxTokens: 4000 };
}

// ---------------------------------------------------------------- the answers, checked

function itemFrom(ex, raw, goal) {
  const rx = defaultRx(ex, goal);
  const sets = int(raw.sets, 1, 8) || rx.sets;
  const range = (lo, hi, max, fallback) => {
    let a = int(raw[lo], 1, max), b = int(raw[hi], 1, max);
    if (!a && !b) return [...fallback];
    if (!a) a = b; if (!b) b = a;
    return a <= b ? [a, b] : [b, a];
  };
  return ex.metric === 'time' ? { exId: ex.id, sets, secs: range('seconds_low', 'seconds_high', 600, rx.secs ?? [20, 40]) } : { exId: ex.id, sets, reps: range('reps_low', 'reps_high', 60, rx.reps ?? [8, 12]) };
}

/**
 * Turn a workout answer into workouts the builder understands, dropping anything that is not on the list Claude was given.
 * @returns {{title:string, explanation:string, notes:string[], workouts:{name:string, items:object[], why:Record<string,string>}[], problems:string[]}}
 */
export function readWorkouts(answer, o) {
  const allowed = new Set(candidatesFor(o).map((e) => e.id));
  const by = indexExercises(o.catalog);
  const problems = [];
  const workouts = [];
  for (const w of (Array.isArray(answer?.workouts) ? answer.workouts : []).slice(0, 6)) {
    const items = [], why = {}, seen = new Set();
    for (const raw of (Array.isArray(w?.items) ? w.items : []).slice(0, 20)) {
      const id = text(raw?.exercise_id, 80);
      if (!id || !allowed.has(id)) { if (id) problems.push(`Left out “${id}”: it is not an exercise you can do with your setup.`); continue; }
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(itemFrom(by[id], raw, o.goal));
      const reason = text(raw.why, 200);
      if (reason) why[id] = reason;
    }
    if (items.length) workouts.push({ name: text(w.name, 80) || 'Workout', items, why });
  }
  const notes = (Array.isArray(answer?.notes) ? answer.notes : []).map((n) => text(n, 300)).filter(Boolean).slice(0, 6);
  return { title: text(answer?.title, 80), explanation: text(answer?.explanation, 700), notes, workouts, problems: [...new Set(problems)].slice(0, 5) };
}

/** Turn an ideas answer into suggestions in the shape the builder's suggestion list already shows. */
export function readIdeas(answer, o, draftItems = []) {
  const allowed = new Set(candidatesFor(o).map((e) => e.id));
  const by = indexExercises(o.catalog);
  const have = new Set(draftItems.map((i) => i.exId));
  const problems = [];
  const ideas = [];
  for (const raw of (Array.isArray(answer?.ideas) ? answer.ideas : []).slice(0, 10)) {
    const id = text(raw?.exercise_id, 80);
    if (!id || have.has(id)) continue;
    if (!allowed.has(id)) { problems.push(`Left out “${id}”: it is not an exercise you can do with your setup.`); continue; }
    have.add(id);
    ideas.push({ ex: by[id], why: [text(raw.why, 200) || 'Suggested by Claude'] });
  }
  return { summary: text(answer?.summary, 500), ideas: ideas.slice(0, 8), problems: [...new Set(problems)].slice(0, 5) };
}
