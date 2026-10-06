// What KIND of routine is this? Yoga (and which kind), Pilates, plain stretching, mobility work, foam rolling...
// and how it feels to do: slow or flowing, long holds or short, talked through or quiet, on the floor or standing,
// which props it needs.
//
// This is an estimate from the words around the video (title, channel name, tags, description, chapters, the poses
// it names, a transcript if one was added, and what viewers wrote), never from the footage. Every label comes with
// the evidence it rests on, so you can see why, and you can correct it. Pure functions: no DOM, no network.

import { compile, scan, normalize, POSE_BY_ID } from './lexicon.js';

const sat = (x, k) => 1 - Math.exp(-k * x);
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- the styles

/** A discipline is the broad family; a type is a kind within it. Both are "styles" for filtering. */
export const DISCIPLINES = ['yoga', 'pilates', 'stretch', 'mobility', 'rolling', 'rehab', 'taichi', 'barre', 'meditation', 'strength'];

export const STYLE_LIST = [
  // id, label, discipline it belongs to (itself for a discipline), shown as a main chip
  { id: 'stretch', label: 'Stretching', discipline: 'stretch', main: true, name: 'Stretching routine' },
  { id: 'yoga', label: 'Yoga', discipline: 'yoga', main: true, name: 'Yoga' },
  { id: 'flow', label: 'Flow / vinyasa', discipline: 'yoga', main: true, name: 'Vinyasa / flow yoga' },
  { id: 'yin', label: 'Yin', discipline: 'yoga', main: true, name: 'Yin yoga' },
  { id: 'restorative', label: 'Gentle / restorative', discipline: 'yoga', main: true, name: 'Restorative / gentle yoga' },
  { id: 'pilates', label: 'Pilates', discipline: 'pilates', main: true, name: 'Pilates' },
  { id: 'mobility', label: 'Mobility', discipline: 'mobility', main: true, name: 'Mobility work' },
  { id: 'strength', label: 'Strength', discipline: 'strength', main: true, name: 'Strength / workout' },
  { id: 'hatha', label: 'Hatha', discipline: 'yoga', name: 'Hatha yoga' },
  { id: 'power', label: 'Power yoga', discipline: 'yoga', name: 'Power yoga' },
  { id: 'ashtanga', label: 'Ashtanga', discipline: 'yoga', name: 'Ashtanga yoga' },
  { id: 'iyengar', label: 'Iyengar', discipline: 'yoga', name: 'Iyengar yoga' },
  { id: 'kundalini', label: 'Kundalini', discipline: 'yoga', name: 'Kundalini yoga' },
  { id: 'nidra', label: 'Yoga nidra', discipline: 'yoga', name: 'Yoga nidra' },
  { id: 'chair', label: 'Chair yoga', discipline: 'yoga', name: 'Chair yoga' },
  { id: 'wall_pilates', label: 'Wall Pilates', discipline: 'pilates', name: 'Wall Pilates' },
  { id: 'reformer', label: 'Reformer Pilates', discipline: 'pilates', name: 'Reformer Pilates' },
  { id: 'rolling', label: 'Foam rolling', discipline: 'rolling', name: 'Foam rolling / self-massage' },
  { id: 'rehab', label: 'Rehab / physio', discipline: 'rehab', name: 'Rehab / physio exercises' },
  { id: 'taichi', label: 'Tai chi / qigong', discipline: 'taichi', name: 'Tai chi / qigong' },
  { id: 'barre', label: 'Barre', discipline: 'barre', name: 'Barre' },
  { id: 'meditation', label: 'Meditation & breath', discipline: 'meditation', name: 'Meditation / breathwork' },
];
export const STYLE_BY_ID = Object.fromEntries(STYLE_LIST.map((s) => [s.id, s]));
// from most general to most specific, for choosing between kinds that score about the same
const SPECIFIC = ['flow', 'restorative', 'hatha', 'power', 'yin', 'iyengar', 'kundalini', 'ashtanga', 'chair', 'nidra', 'wall_pilates', 'reformer'];
const GENERIC = new Set(['stretch', 'mobility', 'strength']);
const BLENDS = new Set(['yoga', 'pilates', 'barre', 'taichi', 'mobility']);   // families that are genuinely mixed ("yoga Pilates fusion"), unlike a yoga video that also stretches
const TYPES_OF = (d) => STYLE_LIST.filter((s) => s.discipline === d && s.id !== d);

// How strongly a type points to its discipline ("yin" is nearly always yoga; "flow" could be a mobility flow).
const IMPLIES = { yin: 0.85, restorative: 0.5, flow: 0.45, hatha: 0.9, power: 0.8, ashtanga: 0.95, iyengar: 0.9, kundalini: 0.95, nidra: 0.7, chair: 0.8, wall_pilates: 1, reformer: 1 };

// [style, weight, phrases]: weight 1 = decisive on its own in a title, 0.35 = a hint.
const ROWS = [
  ['yoga', 1, ['yoga', 'asana', 'asanas', 'yogi', 'yogini', 'namaste']],
  ['yoga', 0.5, ['sun salutation', 'sun salutations', 'savasana', 'shavasana', 'chakra', 'chakras', 'vinyasa', 'ujjayi', 'drishti', 'downward dog']],
  ['pilates', 1, ['pilates', 'pilate', 'reformer', 'joseph pilates', 'powerhouse']],
  ['pilates', 0.4, ['imprint', 'scoop', 'neutral spine', 'the hundred']],
  ['wall_pilates', 1, ['wall pilates', 'wall pilate', 'pilates wall']],
  ['reformer', 1, ['reformer', 'reformer pilates']],
  ['stretch', 1, ['stretching', 'stretch routine', 'stretches', 'flexibility', 'splits', 'static stretching', 'pnf']],
  ['stretch', 0.4, ['stretch', 'release', 'loosen', 'opener', 'deep stretch', 'tight', 'tension', 'relief', 'unlock']],
  ['mobility', 1, ['mobility', 'mobilize', 'mobilise', 'mobilization', 'range of motion', 'controlled articular rotations']],
  ['mobility', 0.45, ['dynamic', 'joint', 'joints', 'warm up', 'warmup', 'activation', 'prehab', 'dynamic stretching']],
  ['rolling', 1, ['foam roller', 'foam rolling', 'foam roll', 'self massage', 'myofascial', 'lacrosse ball', 'massage ball', 'trigger point', 'smr', 'massage gun']],
  ['rehab', 1, ['physical therapy', 'physical therapist', 'physiotherapy', 'physiotherapist', 'physio', 'rehab', 'rehabilitation']],
  ['rehab', 0.4, ['pain relief', 'sciatica', 'injury', 'injuries', 'pain free', 'exercises for pain']],
  ['taichi', 1, ['tai chi', 'qigong', 'qi gong', 'chi kung', 'taiji']],
  ['barre', 1, ['barre', 'ballet']],
  ['meditation', 1, ['meditation', 'breathwork', 'breathing exercise', 'breathing exercises', 'mindfulness', 'body scan', 'pranayama']],
  ['strength', 1, ['strength', 'strong', 'strengthen', 'strengthening', 'workout', 'sculpt', 'burn', 'stability', 'stabilize', 'stabilise', 'core work', 'hiit', 'cardio', 'tabata', 'bodyweight', 'bootcamp']],
  ['strength', 0.4, ['activation', 'sets', 'reps', 'squeeze']],
  ['yin', 1, ['yin', 'yin yoga', 'deep hold', 'long hold', 'long holds', 'fascia']],
  ['yin', 0.4, ['surrender', 'melt', 'let gravity', 'three minutes', 'five minutes', 'stay for']],
  ['restorative', 1, ['restorative', 'bedtime', 'before bed', 'sleep', 'wind down', 'unwind', 'yoga nidra', 'nidra', 'bolster']],
  ['restorative', 0.5, ['relax', 'relaxing', 'gentle', 'calm', 'evening', 'soothing', 'let go']],
  ['flow', 1, ['flow', 'vinyasa', 'sun salutation', 'sun salutations', 'power yoga', 'morning yoga', 'power flow', 'yoga flow']],
  ['flow', 0.4, ['inhale and exhale', 'step back', 'step forward', 'transition', 'breath to movement']],
  ['hatha', 1, ['hatha']],
  ['power', 1, ['power yoga', 'power flow', 'strong flow', 'strength yoga']],
  ['ashtanga', 1, ['ashtanga', 'primary series', 'mysore']],
  ['iyengar', 1, ['iyengar']],
  ['kundalini', 1, ['kundalini', 'kriya']],
  ['nidra', 1, ['yoga nidra', 'nidra', 'non sleep deep rest', 'nsdr']],
  ['chair', 1, ['chair yoga', 'seated yoga', 'desk yoga', 'office yoga', 'chair stretch', 'chair stretches', 'seated stretches', 'seated stretch']],
];
const byPhrase = new Map();
for (const [style, w, phrases] of ROWS) for (const p of phrases) {
  const key = normalize(p);
  if (!byPhrase.has(key)) byPhrase.set(key, { phrases: [p], hits: [] });
  byPhrase.get(key).hits.push({ style, w });
}
const TERMS = compile([...byPhrase.values()]);

// Which sources count for how much. Title and channel name say the most; a single comment says the least.
const SRC = { title: 3, channel: 2, tags: 1.5, chapters: 1.2, desc: 1, transcript: 0.5, comments: 0.35 };
const WEAK_CAP = 1.4;
const SRC_NAME = { title: 'in the title', channel: 'in the channel name', tags: 'in its tags', chapters: 'in the chapter list', desc: 'in the description', transcript: 'in the transcript', comments: 'in viewer comments' };

// Poses that point to a style (a hint each, never decisive).
const YOGA_POSES = ['down_dog', 'childs', 'cat_cow', 'cobra', 'warrior_one', 'warrior_two', 'triangle', 'eagle', 'cow_face', 'puppy', 'camel', 'hero', 'garland', 'pigeon', 'low_lunge', 'dolphin', 'boat', 'locust', 'snail', 'legs_up_wall', 'pyramid', 'dragon', 'frog', 'wide_child'];
const YIN_POSES = ['dragon', 'caterpillar', 'butterfly', 'frog', 'hero', 'snail', 'cobra', 'pigeon', 'straddle', 'ninety_ninety', 'wide_child', 'childs'];
const RESTORATIVE_POSES = ['legs_up_wall', 'childs', 'happy_baby', 'knees_to_chest', 'butterfly'];
const PILATES_POSES = ['pilates_hundred', 'roll_up', 'single_leg_stretch', 'criss_cross', 'teaser', 'leg_circles', 'rolling_ball', 'spine_stretch', 'side_kick', 'mermaid', 'shoulder_bridge', 'leg_pull'];
const MOBILITY_POSES = ['shoulder_circles', 'ankle_circles', 'wall_angels', 'thoracic_ext', 'knee_care', 'cat_cow', 'cuff_work'];
const STRENGTH_POSES_MIN = 3;   // this many strength-type moves named: it really is a workout

// Positions, for "mostly on the floor / standing".
const FLOOR = new Set(['pigeon', 'figure_four', 'ninety_ninety', 'happy_baby', 'butterfly', 'frog', 'straddle', 'hand_to_toe', 'caterpillar', 'childs', 'wide_child', 'knees_to_chest', 'cat_cow', 'thread_needle', 'cobra', 'bridge', 'camel', 'twist', 'cow_face', 'puppy', 'side_plank', 'plank', 'boat', 'locust', 'bird_dog', 'dead_bug', 'clamshell', 'hydrant', 'side_leg_lift', 'pelvic_tilt', 'crunch', 'leg_raise', 'hollow_hold', 'legs_up_wall', 'hero', 'snail', 'dolphin', 'low_lunge', 'couch', 'dragon', 'banana', 'ql_stretch', 'down_dog', 'pilates_hundred', 'roll_up', 'single_leg_stretch', 'criss_cross', 'teaser', 'leg_circles', 'rolling_ball', 'spine_stretch', 'side_kick', 'shoulder_bridge', 'leg_pull', 'mermaid', 'russian_twist', 'toe_squat']);
const STANDING = new Set(['forward_fold', 'pyramid', 'triangle', 'warrior_two', 'warrior_one', 'chair', 'eagle', 'side_bend', 'quad_stretch', 'calf_stretch', 'calf_raise', 'shin_stretch', 'shoulder_circles', 'neck_stretch', 'trap_stretch', 'wrist_stretch', 'chest_opener', 'triceps_stretch', 'biceps_stretch', 'wall_angels', 'cuff_work', 'knee_care', 'ankle_circles', 'garland', 'thoracic_ext']);

const PROPS = [
  ['block', ['block', 'blocks', 'yoga block']], ['strap', ['strap', 'yoga strap', 'belt']], ['bolster', ['bolster', 'pillow', 'cushion']],
  ['blanket', ['blanket', 'towel']], ['wall', ['wall', 'against the wall', 'legs up the wall']], ['chair', ['chair']],
  ['foam roller', ['foam roller', 'roller']], ['band', ['resistance band', 'loop band', 'theraband', 'mini band']], ['ball', ['massage ball', 'lacrosse ball', 'tennis ball', 'pilates ball']],
  ['mat', ['yoga mat', 'mat']],
];
const PROP_TERMS = compile(PROPS.map(([id, phrases]) => ({ id, phrases })));
const NO_PROPS_RE = /\b(?:no props|no equipment|no equipment needed|without props|no mat needed)\b/;

// ---------------------------------------------------------------- what is said about holds, pace, guidance

const HOLD_RE = /\b(?:hold(?:ing)?|stay(?:ing)?|stay here|rest here|breathe here|linger)(?: (?:it|this|each|each pose|every pose|the pose|here))?(?: for)? (?:about |around |up to )?(\d{1,3}|one|two|three|four|five|ten) ?(seconds?|secs?|s|minutes?|mins?|breaths?)\b/g;
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };
const EACH_RE = /\b(\d{1,3}|one|two|three|four|five|ten) ?(seconds?|secs?|minutes?|mins?) (?:each|per) (?:side|leg|arm|pose|position)\b/g;

/** Hold lengths (in seconds) the text mentions: "hold for 3 minutes", "30 seconds each side". */
export function holdTimes(text) {
  const out = [];
  const t = normalize(text);
  for (const re of [HOLD_RE, EACH_RE]) for (const m of t.matchAll(re)) {
    const n = WORDNUM[m[1]] ?? Number(m[1]);
    const unit = m[2][0];
    const sec = unit === 'm' ? n * 60 : unit === 'b' ? n * 5 : n;   // a breath is about 5 seconds
    if (sec >= 3 && sec <= 900) out.push(sec);
  }
  return out;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

const storedText = (stored) => String(stored ?? '').split('\n').map((l) => l.replace(/^@\d+\s/, '')).join('\n');

// ---------------------------------------------------------------- the classifier

/**
 * @param {object} v
 * @param {string} [v.title] @param {string} [v.channel] @param {string[]} [v.tags] @param {string} [v.description]
 * @param {{t:number,label:string}[]} [v.chapters] @param {{id:string,count:number}[]} [v.poses]
 * @param {string} [v.transcript]   as stored (one line per caption, "@seconds text")
 * @param {{t:string}[]} [v.comments] @param {number|null} [v.durationSec] @param {string|null} [v.level]
 * @returns {{styles:Record<string,number>, kind:object|null, traits:object}}
 */
export function classifyStyle(v) {
  const title = String(v.title ?? ''), desc = String(v.description ?? '').slice(0, 1500);
  const transcript = v.transcript ? storedText(v.transcript) : '';
  const commentText = (v.comments ?? []).map((c) => (typeof c === 'string' ? c : c?.t ?? c?.text ?? '')).join(' \n ');
  const chapterText = (v.chapters ?? []).map((c) => c.label).join(' . ');

  // 1. every phrase hit, with where it was found
  const buckets = {};   // style -> Map(key -> {src, phrase, w, count})
  const add = (src, text) => {
    if (!text) return;
    for (const { phrase, entry } of scan(TERMS, text)) {
      for (const { style, w } of entry.hits) {
        const m = (buckets[style] ??= new Map());
        const key = `${src}|${phrase}`;
        const e = m.get(key);
        if (e) e.count++; else m.set(key, { src, phrase, w, count: 1 });
      }
    }
  };
  add('title', title); add('channel', v.channel); add('tags', (v.tags ?? []).join(' , ')); add('chapters', chapterText);
  add('desc', desc); add('transcript', transcript.slice(0, 12000)); add('comments', commentText.slice(0, 8000));

  const raw = {}, why = {}, firm = new Set();   // style -> sum, style -> contributions, styles with at least one decisive piece of evidence
  const credit = (style, amount, text, decisive = false) => { if (amount <= 0) return; raw[style] = (raw[style] ?? 0) + amount; (why[style] ??= []).push({ amount, text }); if (decisive) firm.add(style); };
  for (const [style, m] of Object.entries(buckets)) {
    let hints = 0;   // many weak words ("tight", "release", "relief") must not add up to a style
    for (const { src, phrase, w, count } of m.values()) {
      const repeats = src === 'transcript' || src === 'comments' ? Math.min(3, 1 + 0.3 * (count - 1)) : 1 + Math.min(0.5, 0.15 * (count - 1));
      let amount = w * SRC[src] * repeats;
      if (w < 0.5) { amount = Math.min(amount, Math.max(0, WEAK_CAP - hints)); hints += amount; }
      credit(style, amount, `“${phrase}” ${SRC_NAME[src]}${count > 1 && (src === 'transcript' || src === 'comments') ? ` (${count}×)` : ''}`, w >= 0.8 && src !== 'comments');
    }
  }

  // 2. the poses it names
  const poseIds = new Set((v.poses ?? []).map((p) => p.id));
  const named = (ids) => ids.filter((id) => poseIds.has(id));
  const vote = (style, ids, each, cap, why_) => {
    const hit = named(ids);
    if (hit.length) credit(style, Math.min(cap, each * hit.length), `${hit.slice(0, 3).map((id) => POSE_BY_ID[id]?.label ?? id).join(', ')}: ${why_}`);
  };
  vote('yoga', YOGA_POSES, 0.35, 1.75, 'poses that are typical of yoga');
  vote('yin', YIN_POSES, 0.3, 1.2, 'poses typical of yin');
  vote('restorative', RESTORATIVE_POSES, 0.25, 0.75, 'poses typical of a restful practice');
  vote('pilates', PILATES_POSES, 0.8, 3, 'Pilates exercises');
  if (named(PILATES_POSES).length >= 2) firm.add('pilates');
  vote('mobility', MOBILITY_POSES, 0.3, 0.9, 'mobility drills');
  const strongMoves = (v.poses ?? []).filter((p) => POSE_BY_ID[p.id]?.mode === 'strength' && !PILATES_POSES.includes(p.id));
  if (strongMoves.length >= STRENGTH_POSES_MIN) credit('strength', Math.min(2.5, 0.5 * strongMoves.length), `${strongMoves.length} strengthening exercises named`);
  const sanskrit = (normalize(`${title} ${desc} ${chapterText} ${transcript.slice(0, 6000)}`).match(/\b[a-z]{3,}asana\b/g) ?? []);
  if (sanskrit.length) credit('yoga', Math.min(2.4, 0.8 * new Set(sanskrit).size), `Sanskrit pose names (${[...new Set(sanskrit)].slice(0, 2).join(', ')})`);

  // 3. pace and holds
  const holds = holdTimes(`${desc} ${transcript}`);
  const hold = median(holds);
  const sureHold = holds.length >= 2 ? hold : null;   // one mention could be anything; two agree on a pattern
  if (sureHold != null) {
    if (hold >= 90) { credit('yin', 1.2, `holds of about ${Math.round(hold / 60 * 10) / 10} minutes mentioned`, true); credit('restorative', 0.5, 'long holds mentioned'); }
    else if (hold <= 45 && hold >= 15) credit('stretch', 0.7, `holds of about ${hold} seconds mentioned`);
  }
  const chapters = v.chapters ?? [];
  let avgSection = null;
  if (chapters.length >= 6 && v.durationSec) {
    const body = chapters.slice(1);   // the first chapter is usually an intro
    avgSection = Math.round((v.durationSec - body[0].t) / body.length);
    if (avgSection >= 150) credit('yin', 0.7, `long sections (about ${Math.round(avgSection / 60 * 10) / 10} min per pose)`);
    else if (avgSection <= 50) credit('flow', 0.4, `short sections (about ${avgSection} s per move)`);
  }

  // 4. implications: a type is also a (weaker) vote for its family
  for (const [type, factor] of Object.entries(IMPLIES)) {
    const d = STYLE_BY_ID[type].discipline;
    if (raw[type] && d !== type) credit(d, raw[type] * factor, `${STYLE_BY_ID[type].label} is a kind of ${STYLE_BY_ID[d].label.toLowerCase()}`);
  }
  if (raw.nidra) credit('meditation', raw.nidra * 0.4, 'yoga nidra is a guided relaxation');

  const styles = {};
  for (const s of STYLE_LIST) if (raw[s.id]) styles[s.id] = Math.round(sat(raw[s.id], 0.5) * 100) / 100;

  // 5. the label: the strongest family, then its strongest kind
  // Stretching, mobility and strength are what many yoga and Pilates videos also are, so they only lead when nothing more specific does.
  const family = DISCIPLINES.map((d) => ({ id: d, score: styles[d] ?? 0, rank: (styles[d] ?? 0) + (GENERIC.has(d) ? 0 : 0.25) })).sort((a, b) => b.rank - a.rank);
  const [top, second] = family;
  let kind = null;
  if (top.score >= 0.3) {
    // the best kind within the family; when two are close, the more specific one wins ("yoga nidra" over "restorative")
    // (a kind needs a decisive word somewhere, or a lot of weaker evidence: "calm" in a channel name is not "restorative yoga")
    const kinds = TYPES_OF(top.id).map((s) => ({ id: s.id, score: styles[s.id] ?? 0 })).filter((t) => t.score >= 0.35 && (firm.has(t.id) || t.score >= 0.6)).sort((a, b) => b.score - a.score);
    const type = kinds.filter((t) => t.score >= kinds[0].score - 0.25).sort((a, b) => (SPECIFIC.indexOf(b.id) - SPECIFIC.indexOf(a.id)) || b.score - a.score)[0] ?? null;
    const primary = type ?? { id: top.id, score: top.score };
    const blend = second && BLENDS.has(top.id) && BLENDS.has(second.id) && second.score >= 0.5 && second.score >= 0.75 * top.score ? second : null;
    const margin = top.score - (second?.score ?? 0);
    const confidence = Math.round(clamp(top.score * (0.55 + 0.45 * Math.min(1, margin / 0.45)) * (type || top.id === 'stretch' ? 1 : 0.9)) * 100) / 100;
    const evidence = (why[primary.id] ?? why[top.id] ?? []).slice().sort((a, b) => b.amount - a.amount);
    const more = type ? (why[top.id] ?? []).filter((e) => !/is a kind of/.test(e.text)).sort((a, b) => b.amount - a.amount) : [];
    const lines = [...new Set([...evidence, ...more].map((e) => e.text))].filter((t) => !/is a kind of/.test(t)).slice(0, 4);
    kind = {
      discipline: top.id, type: type?.id ?? null, id: primary.id,
      label: blend ? `${STYLE_BY_ID[type?.id ?? top.id].name} + ${STYLE_BY_ID[blend.id].label}` : STYLE_BY_ID[primary.id].name,
      confidence, certainty: confidence >= 0.7 ? 'clearly' : confidence >= 0.45 ? 'probably' : 'possibly',
      alternatives: family.slice(1).filter((f) => f.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, 2).map((f) => ({ id: f.id, label: STYLE_BY_ID[f.id].name, score: f.score })),
      evidence: lines,
    };
  }

  return { styles, kind, traits: traitsOf(v, { styles, kind, hold, sureHold, avgSection, transcript, poseIds }) };
}

function traitsOf(v, { styles, kind, hold, sureHold, avgSection, transcript, poseIds }) {
  const text = normalize(`${v.title ?? ''} ${v.description ?? ''} ${(v.tags ?? []).join(' ')} ${v.channel ?? ''}`);
  const type = kind?.type ?? kind?.id;

  // pace
  let pace = 'steady';
  if (['yin', 'restorative', 'nidra', 'chair'].includes(type) || (sureHold != null && sureHold >= 90) || (avgSection != null && avgSection >= 150)) pace = 'slow';
  else if (['flow', 'power', 'ashtanga'].includes(type) || (avgSection != null && avgSection <= 45) || (styles.flow ?? 0) >= 0.6) pace = 'flowing';

  // intensity
  const level = v.level ?? null;
  let intensity = 'moderate';
  if (level === 'beginner' || ['restorative', 'nidra', 'chair', 'yin'].includes(type) || kind?.discipline === 'meditation' || (kind?.discipline === 'taichi')) intensity = 'gentle';
  if (level === 'advanced' || ['power', 'ashtanga'].includes(type) || kind?.discipline === 'strength' || (styles.strength ?? 0) >= 0.7) intensity = 'challenging';
  if (level === 'beginner' && intensity === 'challenging') intensity = 'moderate';

  // guidance: how much the teacher talks (only when a transcript covers the whole video)
  let guidance = null;
  const words = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  if (words >= 80 && v.durationSec && transcript.length < 36000) {
    const wpm = words / (v.durationSec / 60);
    guidance = { wpm: Math.round(wpm), label: wpm >= 80 ? 'talks you through every move' : wpm >= 35 ? 'some guidance' : 'mostly quiet (music)' };
  }

  // position
  const floor = [...poseIds].filter((id) => FLOOR.has(id)).length, standing = [...poseIds].filter((id) => STANDING.has(id)).length;
  let position = null;
  if (floor + standing >= 4) position = floor / (floor + standing) >= 0.65 ? 'mostly on the floor' : standing / (floor + standing) >= 0.65 ? 'mostly standing' : 'floor and standing';
  if (/\b(?:chair|seated|desk|office)\b/.test(text) && (type === 'chair' || /\b(?:chair|seated) (?:yoga|stretch|stretches|exercises|workout)\b/.test(text))) position = 'seated';
  else if (/\bstanding\b/.test(text) && (!position || position === 'floor and standing') && /\bstanding (?:only|stretch|stretches|routine|yoga|workout)\b/.test(text)) position = 'mostly standing';
  else if (/\b(?:in bed|before getting out of bed|bed)\b/.test(text) && /\bin bed\b/.test(text)) position = 'in bed';

  // props
  const propText = `${v.title ?? ''} . ${v.description ?? ''} . ${(v.tags ?? []).join(' ')}`;
  const props = [];
  for (const { entry } of scan(PROP_TERMS, propText)) if (entry.id !== 'mat' && !props.includes(entry.id)) props.push(entry.id);
  const noProps = NO_PROPS_RE.test(normalize(propText));

  return { pace, intensity, hold: hold != null ? { seconds: hold, label: hold >= 60 ? `about ${Math.round(hold / 60 * 10) / 10} min per pose` : `about ${hold} s per pose` } : null,
    guidance, position, props: noProps ? [] : props.slice(0, 5), noProps };
}

// ---------------------------------------------------------------- corrections and display

/** Apply a correction the person made ("this is really Pilates"): a fixed label at full confidence. */
export function withFix(kind, styleId) {
  const s = STYLE_BY_ID[styleId];
  if (!s) return kind;
  return { ...(kind ?? {}), discipline: s.discipline, type: s.id !== s.discipline ? s.id : null, id: s.id, label: s.name, confidence: 1, certainty: 'you said', fixed: true, alternatives: kind?.alternatives ?? [], evidence: ['you corrected it'] };
}

/** The style scores as the rest of the app should see them once a correction is applied. */
export function stylesWithFix(styles, styleId) {
  const s = STYLE_BY_ID[styleId];
  if (!s) return styles ?? {};
  const out = { ...(styles ?? {}) };
  out[s.id] = 1;
  if (s.discipline !== s.id) out[s.discipline] = Math.max(out[s.discipline] ?? 0, 0.9);
  return out;
}

/** One line of traits for a card: "slow · gentle · mostly on the floor · block, bolster". */
export function traitLine(traits) {
  if (!traits) return '';
  return [traits.pace === 'slow' ? 'slow' : traits.pace === 'flowing' ? 'flowing' : null, traits.intensity === 'gentle' ? 'gentle' : traits.intensity === 'challenging' ? 'challenging' : null,
    traits.position, traits.props?.length ? traits.props.join(', ') : traits.noProps ? 'no props' : null].filter(Boolean).join(' · ');
}
