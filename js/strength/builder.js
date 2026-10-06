// Putting a workout together: suggesting what is missing from one you started, filling it to a time, and
// reading a description such as "40 minutes upper body with dumbbells, I want to run better, no overhead work".
// It is all rules you can read (no hidden model): every suggestion says why.

import { MUSCLE_BY_ID, SLOTS, TYPE_ORDER, LEVEL_NUM } from './muscles.js';
import { EXERCISES, indexExercises, haveSet, doable, hasAvoided, namesOf } from './catalog.js';
import { defaultRx, estimateMinutes } from './rx.js';

const SLOT_ORDER = ['pull_v', 'pull_h', 'push_h', 'push_v', 'squat', 'hinge', 'knee_iso', 'rear', 'shoulder_iso', 'arms', 'hip_stab', 'calf', 'core', 'carry', 'skill', 'conditioning'];
const norm = (s) => ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const muscleGroup = (id) => MUSCLE_BY_ID[id]?.group;

// ---------------------------------------------------------------- order

const orderKey = (ex) => (TYPE_ORDER[ex?.type] ?? 9) * 100 + Math.max(0, SLOT_ORDER.indexOf(ex?.slot));

/** Heavy compound lifts first, then accessories, stability, core. Stable for equal keys. */
export function orderWorkout(items, byId) {
  return items.map((it, i) => ({ it, i, k: orderKey(byId[it.exId]) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.it);
}
/** Put a new item where it belongs without disturbing the order the person chose. */
export function insertOrdered(items, item, byId) {
  const k = orderKey(byId[item.exId]);
  const at = items.findIndex((it) => orderKey(byId[it.exId]) > k);
  const out = [...items];
  out.splice(at < 0 ? out.length : at, 0, item);
  return out;
}

export const itemFor = (ex, goal = 'general') => {
  const rx = defaultRx(ex, goal);
  return { exId: ex.id, sets: rx.sets, ...(rx.secs ? { secs: rx.secs } : { reps: rx.reps }) };
};

// ---------------------------------------------------------------- what a balanced workout contains

const NEEDS = {
  upper: [
    { slots: ['pull_v'], want: 1, weight: 3, label: 'pulling from above (pull-ups, pulldowns)' },
    { slots: ['pull_h'], want: 1, weight: 3, label: 'rowing' },
    { slots: ['push_h'], want: 1, weight: 3, label: 'pressing forward' },
    { slots: ['push_v', 'shoulder_iso'], want: 1, weight: 2.4, label: 'shoulders' },
    { slots: ['rear'], want: 1, weight: 2.4, label: 'rear shoulders and upper back' },
    { slots: ['core'], want: 2, weight: 1.8, label: 'core' },
  ],
  lower: [
    { slots: ['squat'], want: 2, weight: 3, label: 'squatting and lunging' },
    { slots: ['hinge'], want: 1, weight: 3, label: 'hinging (hamstrings, glutes)' },
    { slots: ['hip_stab'], want: 1, weight: 2.4, label: 'hip and pelvis stability' },
    { slots: ['calf'], want: 1, weight: 2, label: 'calves' },
    { slots: ['core'], want: 1, weight: 1.6, label: 'core' },
  ],
  full: [
    { slots: ['pull_v', 'pull_h'], want: 1, weight: 3, label: 'pulling' },
    { slots: ['push_h', 'push_v'], want: 1, weight: 3, label: 'pressing' },
    { slots: ['squat'], want: 1, weight: 3, label: 'squatting and lunging' },
    { slots: ['hinge'], want: 1, weight: 3, label: 'hinging (hamstrings, glutes)' },
    { slots: ['core'], want: 1, weight: 1.8, label: 'core' },
  ],
};
function needsFor(focus, goal) {
  const needs = (NEEDS[focus] ?? NEEDS.full).map((n) => ({ ...n }));
  if (goal === 'running' && focus !== 'lower') needs.push({ slots: ['hip_stab'], want: 1, weight: 2.4, label: 'hip and pelvis stability for running' });
  if (goal === 'running' && focus === 'lower') { const sq = needs.find((n) => n.slots[0] === 'squat'); if (sq) sq.label = 'single-leg strength for running'; }
  if (goal === 'muscle' && focus !== 'lower') needs.push({ slots: ['arms'], want: 1, weight: 1.3, label: 'arms' });
  if (goal === 'muscle' && focus !== 'upper') needs.push({ slots: ['knee_iso'], want: 1, weight: 1, label: 'quads and hamstrings in isolation' });
  return needs;
}

/** Upper, lower or full body, from what is already in the workout. */
export function inferFocus(chosen) {
  let up = 0, low = 0;
  for (const e of chosen) { const g = SLOTS[e.slot]?.group; if (g === 'upper') up++; else if (g === 'lower') low++; }
  if (!up && !low) return 'full';
  const share = up / (up + low);
  return share >= 0.7 ? 'upper' : share <= 0.3 ? 'lower' : 'full';
}

const ladderRoot = (e, byId) => {
  let cur = e; const seen = new Set();
  while (cur.prev && byId[cur.prev] && !seen.has(cur.id)) { seen.add(cur.id); cur = byId[cur.prev]; }
  return cur.next || cur !== e ? cur.id : null;
};

/** What a balanced workout of this kind still lacks (labels), for the little "still missing" line in the builder. */
export function missingNeeds(items, { catalog = EXERCISES, goal = 'general', focus = null } = {}) {
  const byId = indexExercises(catalog);
  const chosen = items.map((i) => byId[i.exId]).filter(Boolean);
  if (!chosen.length) return [];
  return needsFor(focus ?? inferFocus(chosen), goal).filter((n) => chosen.filter((c) => n.slots.includes(c.slot)).length < n.want).map((n) => n.label);
}

// ---------------------------------------------------------------- suggest more

/**
 * What would make this workout better? Scores every exercise you could do and says why.
 * @param {{exId:string}[]} items the workout so far
 * @param {object} o
 * @param {object[]} o.catalog @param {Set<string>} o.have equipment (see haveSet) @param {string} [o.goal] @param {string} [o.level]
 * @param {string[]} [o.avoid] movement flags @param {string[]} [o.weakAreas] body areas marked as weak spots
 * @param {{exId:string,date:string}[]} [o.recent] what was done lately, for familiarity @param {boolean} [o.legsFatigued] after a hard run
 * @param {string} [o.focus] 'upper'|'lower'|'full' @param {string[]} [o.targetMuscles] muscles that must be worked
 * @param {Set<string>} [o.exclude] exercise ids never to suggest @param {Set<string>} [o.prefer] equipment worth using
 * @returns {{ex:object, score:number, why:string[], item:object}[]} best first
 */
export function suggestMore(items, o) {
  const { catalog = EXERCISES, have = haveSet(), goal = 'general', level = 'intermediate', avoid = [], weakAreas = [], recent = [], legsFatigued = false, targetMuscles = [], exclude = new Set(), prefer = new Set(), count = 6 } = o;
  const byId = indexExercises(catalog);
  const chosen = items.map((i) => byId[i.exId]).filter(Boolean);
  const chosenIds = new Set(chosen.map((e) => e.id));
  const focus = o.focus ?? inferFocus(chosen);
  const needs = targetMuscles.length ? [] : needsFor(focus, goal);
  const lvl = LEVEL_NUM[level] ?? 2;
  const coveredPrimary = new Map();
  for (const e of chosen) for (const m of e.primary) coveredPrimary.set(m, (coveredPrimary.get(m) ?? 0) + 1);
  const groupCount = { push: 0, pull: 0 };
  for (const e of chosen) { const g = muscleGroup(e.primary[0]); if (g in groupCount) groupCount[g]++; }
  const roots = new Set(chosen.map((e) => ladderRoot(e, byId)).filter(Boolean));
  const recentIds = new Set(recent.map((r) => r.exId));
  const weak = new Set(weakAreas);
  const targets = new Set(targetMuscles);

  const out = [];
  for (const e of catalog) {
    if (chosenIds.has(e.id) || exclude.has(e.id) || !doable(e, have) || hasAvoided(e, avoid)) continue;
    const group = SLOTS[e.slot]?.group;
    if (focus === 'upper' && group === 'lower' && !(goal === 'running' && e.slot === 'hip_stab')) continue;
    if (focus === 'lower' && group === 'upper') continue;
    if (e.type === 'conditioning' && goal !== 'endurance') continue;
    const r = ladderRoot(e, byId);
    if (r && roots.has(r)) continue;               // one rung of a progression at a time
    let score = 0; const why = [];
    const add = (pts, text) => { score += pts; if (text && pts > 0) why.push(text); };

    // 1. the gaps of a balanced workout
    for (const n of needs) {
      if (!n.slots.includes(e.slot)) continue;
      const have_ = chosen.filter((c) => n.slots.includes(c.slot)).length;
      if (have_ < n.want) add(n.weight, `Adds ${n.label}, which this workout does not have yet`);
      else score -= 1.2 * (have_ - n.want + 1);
    }
    // 2. the muscles the person asked for
    if (targets.size) {
      const hit = e.primary.filter((m) => targets.has(m)).length, second = e.secondary.filter((m) => targets.has(m)).length;
      if (!hit && !second) continue;
      add(3 * (hit / e.primary.length) + 0.8 * Math.min(second, 2), `Works ${e.primary.filter((m) => targets.has(m)).map((m) => MUSCLE_BY_ID[m].label.toLowerCase()).join(' and ') || 'the muscles you asked for'}`);
    }
    // 3. muscles nothing in the workout trains yet
    const fresh = e.primary.filter((m) => !coveredPrimary.has(m));
    if (fresh.length) add(Math.min(1.6, 0.8 * fresh.length), `Trains ${fresh.slice(0, 2).map((m) => MUSCLE_BY_ID[m].label.toLowerCase()).join(' and ')}, which nothing here works yet`);
    // 4. push against pull
    const g = muscleGroup(e.primary[0]);
    if (g === 'pull' && groupCount.push > groupCount.pull) add(1.2, 'Balances the pressing with some pulling');
    if (g === 'push' && groupCount.pull > groupCount.push + 1) add(0.8, 'Balances the pulling with some pressing');
    // 5. the goal
    if (goal === 'running' && e.tags.includes('running')) add(1, 'Helps your running (stability, single-leg strength)');
    if (goal === 'running' && e.unilateral && group === 'lower') add(0.5);
    if (goal === 'strength' && e.type === 'compound') add(0.8, 'A heavy compound lift, good for getting stronger');
    if (goal === 'muscle' && e.type === 'accessory') add(0.4);
    if (e.tags.includes('anchor')) add(0.6, 'A main exercise for this kind of workout');
    // 6. your weak spots, and what you already know
    const weakHit = e.primary.some((m) => weak.has(MUSCLE_BY_ID[m]?.area));
    if (weakHit) add(1, 'Works a spot you marked as weak');
    if (recentIds.has(e.id)) add(0.4);
    if (prefer.size && (e.needs ?? []).some((n) => prefer.has(n))) add(0.5);
    // 7. things that count against it
    if (e.level > lvl + 1) score -= 2.5; else if (e.level > lvl) score -= 0.8;
    if (legsFatigued && ['squat', 'hinge'].includes(e.slot) && e.type === 'compound') score -= 2.5;
    if (e.tags.includes('low-priority')) score -= 3;
    const similar = chosen.filter((c) => c.slot === e.slot && c.primary.some((m) => e.primary.includes(m))).length;
    score -= 1.2 * similar;
    if (score > 0.5) out.push({ ex: e, score, why: why.slice(0, 3), item: itemFor(e, goal) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, count);
}

/** Add the best-fitting exercises until the workout fills the time (never removing what is there). */
export function fillWorkout(items, o) {
  const byId = indexExercises(o.catalog ?? EXERCISES);
  const minutes = o.minutes ?? 45;
  let list = [...items];
  const added = [];
  for (let i = 0; i < 14; i++) {
    if (list.length >= 3 && estimateMinutes(list, byId) >= minutes - 3) break;
    const [best] = suggestMore(list, { ...o, count: 1 });
    if (!best || best.score < 1) break;
    list = insertOrdered(list, best.item, byId);
    added.push({ ...best.item, why: best.why });
  }
  return { items: list, added, minutes: estimateMinutes(list, byId) };
}

// ---------------------------------------------------------------- reading a description

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const MUSCLE_PHRASES = [
  ['lower back', ['lower_back']], ['upper back', ['upper_back', 'delt_rear', 'traps']], ['rear delts', ['delt_rear']], ['rear delt', ['delt_rear']], ['rear shoulders', ['delt_rear']],
  ['glute medius', ['glute_med']], ['hip stability', ['glute_med', 'glutes']], ['hip stabilisers', ['glute_med']], ['pelvic stability', ['glute_med', 'abs']], ['pelvis stability', ['glute_med', 'abs']],
  ['inner thighs', ['adductors']], ['adductors', ['adductors']], ['hip flexors', ['hip_flexors']], ['hips', ['glute_med', 'glutes', 'hip_flexors']],
  ['chest', ['chest']], ['pecs', ['chest']], ['lats', ['lats']], ['back', ['lats', 'upper_back']], ['shoulders', ['delt_front', 'delt_side', 'delt_rear']], ['shoulder', ['delt_front', 'delt_side', 'delt_rear']], ['delts', ['delt_front', 'delt_side', 'delt_rear']],
  ['biceps', ['biceps']], ['triceps', ['triceps']], ['arms', ['biceps', 'triceps']], ['forearms', ['forearms']], ['grip', ['forearms']], ['traps', ['traps']],
  ['abs', ['abs', 'obliques']], ['abdominals', ['abs', 'obliques']], ['core', ['abs', 'obliques', 'lower_back']], ['obliques', ['obliques']],
  ['glutes', ['glutes', 'glute_med']], ['glute', ['glutes', 'glute_med']], ['butt', ['glutes']], ['quads', ['quads']], ['quadriceps', ['quads']], ['hamstrings', ['hamstrings']], ['calves', ['calves']], ['calf', ['calves']],
];
const FOCUS_PHRASES = [['upper', ['upper body', 'upper']], ['lower', ['lower body', 'leg day', 'legs']], ['full', ['full body', 'whole body', 'total body']]];
const EQUIP_PHRASES = [
  ['pullup_bar', ['pull up bar', 'pullup bar', 'chin up bar']],
  ['band_loop', ['loop bands', 'loop band', 'resistance bands', 'resistance band', 'theraband', 'bands', 'band']],
  ['cable_station', ['weight station', 'cable station', 'cables', 'cable', 'station', 'ferrum', 'machine']],
  ['dumbbell', ['dumbbells', 'dumbbell', 'dumbells', 'free weights']],
  ['feetup', ['feetup', 'headstand trainer']],
];
const AVOID_PHRASES = [
  ['overhead', /\b(?:no|avoid|without|skip)\s+overhead\b|\b(?:bad|sore|injured|painful|hurt)\s+shoulders?\b/],
  ['knee', /\b(?:bad|sore|injured|painful|hurt)\s+knees?\b|\bknee\s+(?:pain|problems?|injury)\b/],
  ['wrist', /\b(?:bad|sore|injured|painful|hurt)\s+wrists?\b|\bwrist\s+(?:pain|problems?)\b/],
  ['lowback', /\b(?:bad|sore|injured|painful)\s+(?:lower\s+)?back\b|\bback\s+(?:pain|problems?)\b/],
  ['impact', /\b(?:no|avoid|without)\s+(?:jumping|impact|plyo)\b/],
  ['hanging', /\b(?:no|avoid|without)\s+hanging\b/],
];

/**
 * Understand a description. Everything that was understood comes back, so it can be shown and corrected.
 * @returns {{focus:string|null, muscles:string[], minutes:number|null, goal:string|null, level:string|null, onlyEquipment:string[]|null,
 *   prefer:string[], seeds:string[], exclude:string[], avoid:string[], days:number|null, understood:string[]}}
 */
export function parseRequest(text, { catalog = EXERCISES } = {}) {
  let t = norm(text);
  const out = { focus: null, muscles: [], minutes: null, goal: null, level: null, onlyEquipment: null, prefer: [], seeds: [], exclude: [], avoid: [], days: null, understood: [] };
  const consume = (phrase) => { t = t.replace(new RegExp(`\\b${phrase.trim().replace(/ +/g, ' +')}\\b`, 'g'), ' '); };

  // how many days, and how long
  const daysRe = /\b(\d|one|two|three|four|five|six|seven)\s*(?:x|times|days|sessions|workouts)\s*(?:a|per|each)?\s*(?:week|wk)\b/;
  const d = t.match(daysRe);
  if (d) { out.days = NUM_WORDS[d[1]] ?? Number(d[1]); t = t.replace(daysRe, ' '); }
  const mins = t.match(/\b(\d{1,3})\s*(?:min|mins|minutes?)\b/);
  if (mins) { out.minutes = Math.min(120, Math.max(10, Number(mins[1]))); t = t.replace(mins[0], ' '); }
  else if (/\bhalf an hour\b|\bhalf hour\b/.test(t)) out.minutes = 30;
  else if (/\b(?:an|one|1)\s+hour\b/.test(t)) out.minutes = 60;
  else if (/\b(?:quick|short)\b/.test(t)) out.minutes = 20;

  // equipment (before exercise names, so "pull up bar" is not read as pull-ups)
  const only = new Set(); let bodyOnly = /\b(?:no equipment|without equipment|bodyweight only|body weight only|no weights|nothing but my body)\b/.test(t);
  if (bodyOnly) t = t.replace(/\b(?:no equipment|without equipment|bodyweight only|body weight only|no weights|nothing but my body)\b/g, ' ');
  for (const [id, phrases] of EQUIP_PHRASES) {
    for (const p of phrases) {
      if (!t.includes(` ${p} `)) continue;
      const restrictive = new RegExp(`\\b(?:only|just)\\s+(?:with\\s+|my\\s+|the\\s+)?(?:a\\s+)?${p}\\b|\\b${p}\\s+only\\b`).test(t);
      if (restrictive) only.add(id); else out.prefer.push(id);
      consume(p);
      t = t.replace(/\b(?:only|just)\b/, ' ');
      break;
    }
  }
  if (only.size || bodyOnly) out.onlyEquipment = [...only];
  out.prefer = out.prefer.filter((p) => !only.has(p));

  // named exercises (longest names first, so "side plank" is not read as "plank")
  const names = catalog.flatMap((e) => namesOf(e).map((n) => [n, e.id])).sort((a, b) => b[0].length - a[0].length);
  for (const [n, id] of names) {
    const at = t.indexOf(` ${n} `);
    if (at < 0) continue;
    const before = t.slice(Math.max(0, at - 14), at);
    if (/\b(?:no|not|without|skip|avoid|except)\s*$/.test(before)) { if (!out.exclude.includes(id)) out.exclude.push(id); }
    else if (!out.seeds.includes(id)) out.seeds.push(id);
    t = t.replace(` ${n} `, ' ');
  }

  // movement flags
  for (const [flag, re] of AVOID_PHRASES) if (re.test(t)) { out.avoid.push(flag); t = t.replace(re, ' '); }

  // muscles, then the general focus of the day
  const muscles = new Set();
  for (const [phrase, ids] of MUSCLE_PHRASES) if (t.includes(` ${phrase} `)) { ids.forEach((m) => muscles.add(m)); consume(phrase); }
  if (/\bpush (?:day|workout|session)\b/.test(t)) { ['chest', 'delt_front', 'triceps'].forEach((m) => muscles.add(m)); }
  if (/\bpull (?:day|workout|session)\b/.test(t)) { ['lats', 'upper_back', 'biceps', 'delt_rear'].forEach((m) => muscles.add(m)); }
  out.muscles = [...muscles];
  for (const [f, phrases] of FOCUS_PHRASES) if (phrases.some((p) => t.includes(` ${p} `))) { out.focus = f; break; }

  // goal and level
  if (/\b(?:run|running|runner|marathon|race|races|trail|jogging)\b/.test(t)) out.goal = 'running';
  else if (/\b(?:strength|stronger|strong|heavy|powerful|power)\b/.test(t)) out.goal = 'strength';
  else if (/\b(?:muscle|muscles|hypertrophy|bigger|size|mass|bulk|toned?|build)\b/.test(t)) out.goal = 'muscle';
  else if (/\b(?:endurance|stamina|high rep)\b/.test(t)) out.goal = 'endurance';
  if (/\b(?:beginner|new to|just starting|never trained)\b/.test(t)) out.level = 'beginner';
  else if (/\badvanced\b/.test(t)) out.level = 'advanced';
  else if (/\bintermediate\b/.test(t)) out.level = 'intermediate';

  const names_ = (ids) => ids.map((m) => MUSCLE_BY_ID[m]?.label.toLowerCase()).filter(Boolean);
  if (out.focus) out.understood.push({ upper: 'upper body', lower: 'lower body', full: 'full body' }[out.focus]);
  if (out.muscles.length) out.understood.push(`focus on ${[...new Set(names_(out.muscles))].slice(0, 5).join(', ')}`);
  if (out.goal) out.understood.push({ running: 'to support running', strength: 'for strength', muscle: 'for muscle', endurance: 'for endurance' }[out.goal]);
  if (out.minutes) out.understood.push(`${out.minutes} minutes`);
  if (out.onlyEquipment) out.understood.push(out.onlyEquipment.length ? `only ${out.onlyEquipment.join(' and ').replace(/_/g, ' ')} (and bodyweight)` : 'bodyweight only');
  else if (out.prefer.length) out.understood.push(`using ${out.prefer.join(' and ').replace(/_/g, ' ')}`);
  const byId = indexExercises(catalog);
  if (out.seeds.length) out.understood.push(`including ${out.seeds.map((s) => byId[s].name.toLowerCase()).join(', ')}`);
  if (out.exclude.length) out.understood.push(`without ${out.exclude.map((s) => byId[s].name.toLowerCase()).join(', ')}`);
  if (out.avoid.length) out.understood.push(`avoiding ${out.avoid.join(', ')} movements`);
  if (out.days) out.understood.push(`${out.days} days a week`);
  return out;
}

/**
 * Build a workout from a description (plus your equipment and settings).
 * @returns {{name:string, items:object[], request:object, interpretation:string, notes:string[], minutes:number}}
 */
export function buildFromRequest(text, ctx) {
  const catalog = ctx.catalog ?? EXERCISES;
  const byId = indexExercises(catalog);
  const request = parseRequest(text, { catalog });
  const notes = [];
  let have = ctx.have;
  if (request.onlyEquipment) {
    const owned = request.onlyEquipment.filter((q) => ctx.have.has(q));
    for (const q of request.onlyEquipment) if (!ctx.have.has(q)) notes.push(`You asked for ${q.replace(/_/g, ' ')}, but it is not ticked in Setup, so I did not use it.`);
    have = haveSet(owned);
  }
  const goal = request.goal ?? ctx.goal ?? 'general';
  const exclude = new Set([...(ctx.exclude ?? []), ...request.exclude]);
  const avoid = [...new Set([...(ctx.avoid ?? []), ...request.avoid])];
  const opts = {
    catalog, have, goal, level: request.level ?? ctx.level ?? 'intermediate', avoid, weakAreas: ctx.weakAreas ?? [], recent: ctx.recent ?? [], legsFatigued: !!ctx.legsFatigued,
    minutes: request.minutes ?? ctx.minutes ?? 45, focus: request.focus ?? null, targetMuscles: request.muscles, exclude, prefer: new Set(request.prefer),
  };
  let items = [];
  for (const id of request.seeds) {
    const ex = byId[id];
    if (!doable(ex, have)) { notes.push(`${ex.name} needs equipment you do not have, so I left it out.`); continue; }
    items = insertOrdered(items, itemFor(ex, goal), byId);
  }
  const filled = fillWorkout(items, opts);
  const focusName = request.focus ? { upper: 'Upper body', lower: 'Lower body', full: 'Full body' }[request.focus] : request.muscles.length ? [...new Set(request.muscles.map((m) => MUSCLE_BY_ID[m]?.label))].slice(0, 2).join(' & ') : 'Workout';
  const name = `${focusName}${request.goal ? ` · ${{ running: 'for running', strength: 'strength', muscle: 'muscle', endurance: 'endurance' }[request.goal]}` : ''}`;
  if (!filled.items.length) notes.push('I could not find exercises for that with the equipment ticked in Setup. Try fewer restrictions.');
  return { name, items: filled.items, request, interpretation: request.understood.length ? `I understood: ${request.understood.join(' · ')}.` : 'I could not pick out much from that, so this is a balanced workout. Try naming muscles, a length or equipment.', notes, minutes: filled.minutes };
}

