// The app's "anatomy knowledge": muscle areas, the words people use for them,
// what common poses/exercises actually work, and the vocabulary used to read
// viewer comments. Everything here is plain data + a tiny matcher, so the
// analysis in analyze.js stays transparent and easy to tune.

// ---------------------------------------------------------------- text helpers

/** Lowercase, drop apostrophes, turn every other symbol into a space. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build one alternation regex (longest phrase first) + a phrase -> entry map. */
function compile(entries) {
  const map = new Map();
  for (const e of entries) for (const p of e.phrases) map.set(normalize(p), e);
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  return { map, re: new RegExp(`\\b(?:${alts.join('|')})s?\\b`, 'g') };
}

/** Find every non-overlapping phrase match in `text`. */
export function scan(compiled, text) {
  const out = [];
  for (const m of normalize(text).matchAll(compiled.re)) {
    let key = m[0];
    if (!compiled.map.has(key)) key = key.slice(0, -1);
    const entry = compiled.map.get(key);
    if (entry) out.push({ phrase: key, entry, index: m.index });
  }
  return out;
}

// ---------------------------------------------------------------- muscle areas

export const GROUPS = [
  { id: 'upper', label: 'Neck & upper body' },
  { id: 'back', label: 'Back & core' },
  { id: 'hips', label: 'Hips' },
  { id: 'legs', label: 'Legs & feet' },
  { id: 'whole', label: 'Whole body' },
];

// `say` = natural phrases used when building YouTube search queries.
export const AREAS = [
  { id: 'neck', label: 'Neck', group: 'upper', say: ['neck', 'tight neck', 'neck tension', 'text neck'] },
  { id: 'shoulders', label: 'Shoulders', group: 'upper', say: ['shoulders', 'tight shoulders', 'shoulder mobility', 'shoulder tension'] },
  { id: 'chest', label: 'Chest', group: 'upper', say: ['chest', 'chest opener', 'tight chest', 'chest and shoulders'] },
  { id: 'upper_back', label: 'Upper back & posture', group: 'upper', say: ['upper back', 'posture', 'upper back tension', 'rounded shoulders'] },
  { id: 'lats', label: 'Lats & side body', group: 'upper', say: ['side body', 'lats', 'side stretch', 'lat stretch'] },
  { id: 'arms', label: 'Arms', group: 'upper', say: ['arms', 'biceps and triceps', 'arm stretch'] },
  { id: 'wrists', label: 'Wrists & forearms', group: 'upper', say: ['wrists', 'wrists and forearms', 'wrist pain', 'forearm stretch'] },
  { id: 'lower_back', label: 'Lower back', group: 'back', say: ['lower back', 'low back pain', 'lower back relief', 'tight lower back'] },
  { id: 'spine', label: 'Spine mobility', group: 'back', say: ['spine', 'spinal mobility', 'spine twist', 'back mobility'] },
  { id: 'core', label: 'Core', group: 'back', say: ['core', 'core strength', 'abs', 'core stability'] },
  { id: 'hip_flexors', label: 'Hip flexors', group: 'hips', say: ['hip flexors', 'tight hip flexors', 'psoas', 'hip flexor release'] },
  { id: 'glutes', label: 'Glutes & piriformis', group: 'hips', say: ['glutes', 'piriformis', 'sciatica', 'tight glutes', 'glutes and hips'] },
  { id: 'outer_hip', label: 'Outer hip & IT band', group: 'hips', say: ['outer hip', 'IT band', 'hip stability', 'glute medius'] },
  { id: 'adductors', label: 'Inner thighs & groin', group: 'hips', say: ['inner thighs', 'groin', 'adductors', 'hip openers inner thigh'] },
  { id: 'hamstrings', label: 'Hamstrings', group: 'legs', say: ['hamstrings', 'tight hamstrings', 'hamstring flexibility', 'back of legs'] },
  { id: 'quads', label: 'Quads', group: 'legs', say: ['quads', 'quad stretch', 'tight quads', 'quadriceps'] },
  { id: 'calves', label: 'Calves & shins', group: 'legs', say: ['calves', 'tight calves', 'calf stretch', 'shins and calves'] },
  { id: 'feet', label: 'Feet & ankles', group: 'legs', say: ['feet', 'ankles', 'feet and ankles', 'ankle mobility'] },
  { id: 'full_body', label: 'Full body', group: 'whole', say: ['full body', 'total body', 'whole body'] },
];
export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));
export const areaLabel = (id) => AREA_BY_ID[id]?.label ?? id;

// ---------------------------------------------------------------- vocabulary -> areas
// `weak: true` = generic words that only count at half weight and are ignored
// when reading comments ("come back", "arm balance", ...).

const term = (phrases, map, weak = false) => ({ phrases, map, weak });

const TERM_DEFS = [
  term(['text neck', 'tech neck', 'forward head', 'forward head posture'], { neck: 1, upper_back: 0.6 }),
  term(['neck', 'cervical', 'levator scapulae', 'scalenes', 'sternocleidomastoid'], { neck: 1 }),
  term(['shoulder blades', 'shoulder blade', 'scapula', 'scapulae'], { upper_back: 0.8, shoulders: 0.5 }),
  term(['shoulder', 'deltoid', 'deltoids', 'rotator cuff'], { shoulders: 1 }),
  term(['chest', 'pec', 'pecs', 'pectoral', 'pectorals', 'heart opener', 'heart opening'], { chest: 1 }),
  term(['upper back', 'thoracic', 'trapezius', 'traps', 'rhomboid', 'rhomboids', 'mid back', 'middle back'], { upper_back: 1 }),
  term(
    ['rounded shoulders', 'slouch', 'slouching', 'hunch', 'hunched', 'kyphosis', 'posture', 'poor posture', 'desk posture'],
    { upper_back: 1, chest: 0.7, neck: 0.6, shoulders: 0.6, hip_flexors: 0.3 },
  ),
  term(
    ['desk workers', 'desk worker', 'desk job', 'desk', 'office workers', 'office', 'sitting all day', 'sedentary', 'sitting'],
    { upper_back: 0.6, neck: 0.6, hip_flexors: 0.6, wrists: 0.4, chest: 0.4, lower_back: 0.4 },
    true,
  ),
  term(['lats', 'lat', 'latissimus', 'side body', 'side stretch', 'side bend', 'side bends', 'intercostal', 'intercostals'], { lats: 1 }),
  term(['biceps', 'bicep', 'triceps', 'tricep', 'arms', 'arm'], { arms: 1 }, true),
  term(['wrist', 'forearm', 'carpal tunnel', 'typing', 'keyboard', 'hands'], { wrists: 1 }),
  term(
    ['lower back', 'low back', 'lumbar', 'lumbago', 'back pain', 'backache', 'sacrum', 'sacral', 'si joint', 'sacroiliac', 'tailbone'],
    { lower_back: 1 },
  ),
  term(['sciatica', 'sciatic', 'sciatic nerve'], { glutes: 1, lower_back: 0.6, hamstrings: 0.4 }),
  term(['back'], { lower_back: 0.6, upper_back: 0.6 }, true),
  term(['spine', 'spinal', 'spinal mobility', 'vertebrae', 'cat cow', 'marjaryasana'], { spine: 1 }),
  term(['core', 'abs', 'abdominal', 'abdominals', 'obliques', 'transverse abdominis', 'tummy', 'belly'], { core: 1 }),
  term(['hip flexor', 'psoas', 'iliopsoas', 'iliacus'], { hip_flexors: 1 }),
  term(
    ['glute', 'gluteal', 'piriformis', 'buttocks', 'butt', 'deep hip rotators', 'hip rotators', 'external rotators'],
    { glutes: 1 },
  ),
  term(
    ['it band', 'itb', 'iliotibial', 'outer hip', 'glute medius', 'gluteus medius', 'tfl', 'hip abductors', 'abductors', 'side hip'],
    { outer_hip: 1 },
  ),
  term(['inner thigh', 'adductor', 'adductors', 'groin', 'hip adductors'], { adductors: 1 }),
  term(
    ['hips', 'hip', 'hip opener', 'hip openers', 'hip opening', 'tight hips', 'hip mobility', 'hip pain'],
    { hip_flexors: 0.7, glutes: 0.7, outer_hip: 0.5, adductors: 0.5 },
  ),
  term(
    ['hamstring', 'back of the leg', 'back of your legs', 'back of legs', 'back of the thigh', 'back of thigh'],
    { hamstrings: 1 },
  ),
  term(['quad', 'quadricep', 'quadriceps', 'front of the thigh', 'front of thigh', 'front of your thigh'], { quads: 1 }),
  term(['calf', 'calves', 'achilles', 'soleus', 'gastrocnemius', 'shin', 'shins', 'shin splints'], { calves: 1 }),
  term(['foot', 'feet', 'ankle', 'plantar fasciitis', 'plantar', 'arches', 'toes'], { feet: 1 }),
  term(['legs', 'leg', 'lower body', 'tired legs', 'heavy legs'], { hamstrings: 0.6, quads: 0.6, calves: 0.5, glutes: 0.4 }, true),
  term(
    ['runner', 'runners', 'running', 'post run', 'after a run', 'marathon', 'cyclist', 'cycling', 'hiking'],
    { quads: 0.6, hip_flexors: 0.6, calves: 0.6, hamstrings: 0.6, outer_hip: 0.5 },
    true,
  ),
  term(['full body', 'total body', 'whole body', 'head to toe', 'all over', 'every muscle'], { full_body: 1 }),
];
export const AREA_TERMS = compile(TERM_DEFS);

// ---------------------------------------------------------------- poses / exercises
// What a named pose or exercise actually works. mode: 'stretch' | 'strength' | 'both'.

const pose = (id, label, names, areas, mode = 'stretch') => ({ id, label, phrases: names, areas, mode });

export const POSES = [
  pose('low_lunge', 'Low lunge', ['low lunge', 'crescent lunge', 'runners lunge', 'anjaneyasana', 'kneeling hip flexor', 'half kneeling', 'lizard pose', 'lizard', 'deep lunge'], { hip_flexors: 1, quads: 0.5 }),
  pose('couch', 'Couch stretch', ['couch stretch'], { quads: 1, hip_flexors: 1 }),
  pose('dragon', 'Dragon pose', ['dragon pose', 'dragon'], { hip_flexors: 1, quads: 0.6, adductors: 0.3 }),
  pose('pigeon', 'Pigeon', ['pigeon', 'pigeon pose', 'sleeping pigeon', 'sleeping swan', 'swan', 'eka pada rajakapotasana', 'king pigeon'], { glutes: 1, hip_flexors: 0.5, outer_hip: 0.4 }),
  pose('figure_four', 'Figure four', ['figure four', 'figure 4', 'reclined pigeon', 'eye of the needle', 'seated figure four', 'chair pigeon', 'seated pigeon'], { glutes: 1, outer_hip: 0.4 }),
  pose('ninety_ninety', '90/90', ['90 90', 'ninety ninety', 'shoelace', 'square pose'], { glutes: 0.8, outer_hip: 0.8, hip_flexors: 0.3 }),
  pose('happy_baby', 'Happy baby', ['happy baby', 'ananda balasana'], { adductors: 0.7, lower_back: 0.6, glutes: 0.4, hamstrings: 0.3 }),
  pose('butterfly', 'Butterfly', ['butterfly', 'baddha konasana', 'bound angle', 'cobbler', 'reclined butterfly', 'supta baddha konasana'], { adductors: 1, glutes: 0.3 }),
  pose('frog', 'Frog', ['frog pose', 'frog', 'mandukasana'], { adductors: 1 }),
  pose('straddle', 'Wide-legged fold', ['wide legged forward fold', 'straddle', 'prasarita', 'upavistha konasana', 'middle splits'], { adductors: 0.8, hamstrings: 0.8 }),
  pose('garland', 'Garland / yogi squat', ['garland', 'malasana', 'yogi squat', 'deep squat'], { adductors: 0.6, glutes: 0.5, feet: 0.4, calves: 0.3 }, 'both'),
  pose('hand_to_toe', 'Reclined hand-to-big-toe', ['hand to big toe', 'supta padangusthasana', 'reclined hamstring', 'hamstring stretch'], { hamstrings: 1, outer_hip: 0.3 }),
  pose('forward_fold', 'Forward fold', ['forward fold', 'forward bend', 'uttanasana', 'paschimottanasana', 'ragdoll', 'rag doll'], { hamstrings: 1, lower_back: 0.6, calves: 0.3 }),
  pose('caterpillar', 'Caterpillar', ['caterpillar'], { hamstrings: 0.8, lower_back: 0.8 }),
  pose('pyramid', 'Pyramid', ['pyramid pose', 'parsvottanasana'], { hamstrings: 1, calves: 0.4 }),
  pose('down_dog', 'Downward dog', ['downward dog', 'downward facing dog', 'adho mukha svanasana', 'down dog'], { hamstrings: 0.7, calves: 0.7, shoulders: 0.6, lats: 0.4, upper_back: 0.3 }, 'both'),
  pose('childs', "Child's pose", ['childs pose', 'child pose', 'balasana', 'extended childs pose'], { lower_back: 0.8, lats: 0.6, shoulders: 0.4, glutes: 0.3 }),
  pose('wide_child', 'Wide-knee child', ['wide knee childs pose', 'wide child'], { adductors: 0.6, lower_back: 0.6, lats: 0.4 }),
  pose('knees_to_chest', 'Knees to chest', ['knees to chest', 'apanasana', 'wind relieving'], { lower_back: 1, glutes: 0.5 }),
  pose('cat_cow', 'Cat-cow', ['cat cow', 'cat and cow', 'marjaryasana'], { spine: 1, lower_back: 0.6, upper_back: 0.6, neck: 0.2 }, 'both'),
  pose('thread_needle', 'Thread the needle', ['thread the needle'], { upper_back: 0.9, shoulders: 0.8, neck: 0.3 }),
  pose('cobra', 'Cobra / sphinx', ['cobra', 'sphinx', 'upward dog', 'upward facing dog', 'bhujangasana', 'seal pose'], { chest: 0.8, spine: 0.6, lower_back: 0.5, core: 0.5, hip_flexors: 0.4 }, 'both'),
  pose('bridge', 'Bridge', ['bridge pose', 'glute bridge', 'setu bandha', 'hip bridge'], { glutes: 0.9, hamstrings: 0.5, hip_flexors: 0.5, chest: 0.4, core: 0.3 }, 'both'),
  pose('camel', 'Camel', ['camel pose', 'ustrasana'], { chest: 1, hip_flexors: 0.6, quads: 0.6, core: 0.4 }),
  pose('twist', 'Spinal twist', ['supine twist', 'reclined twist', 'spinal twist', 'seated twist', 'revolved', 'jathara parivartanasana', 'twist', 'twists'], { spine: 0.9, lower_back: 0.8, glutes: 0.4, upper_back: 0.4, outer_hip: 0.3 }),
  pose('eagle', 'Eagle', ['eagle pose', 'garudasana', 'eagle arms'], { shoulders: 0.8, upper_back: 0.7, outer_hip: 0.5, glutes: 0.4 }),
  pose('cow_face', 'Cow face', ['cow face', 'gomukhasana'], { shoulders: 0.8, outer_hip: 0.7, glutes: 0.6, arms: 0.5 }),
  pose('puppy', 'Puppy / melting heart', ['puppy pose', 'melting heart', 'uttana shishosana'], { shoulders: 0.8, upper_back: 0.7, chest: 0.6, lats: 0.5 }),
  pose('chest_opener', 'Chest opener', ['doorway stretch', 'chest opener', 'wall stretch', 'clasped hands behind back', 'interlace hands behind', 'reverse table top', 'reverse tabletop'], { chest: 1, shoulders: 0.6 }),
  pose('neck_stretch', 'Neck stretch', ['neck roll', 'ear to shoulder', 'neck stretch', 'chin tuck', 'neck release'], { neck: 1 }),
  pose('shoulder_circles', 'Shoulder circles', ['shoulder roll', 'shoulder circles', 'arm circles', 'shoulder rolls'], { shoulders: 0.9, upper_back: 0.4 }, 'both'),
  pose('wrist_stretch', 'Wrist stretches', ['wrist circles', 'wrist stretch', 'prayer stretch', 'reverse prayer', 'wrist flexor', 'wrist extensor', 'finger stretch'], { wrists: 1 }),
  pose('side_bend', 'Side bend', ['side bend', 'crescent moon', 'half moon', 'standing side stretch'], { lats: 0.9, core: 0.4, outer_hip: 0.3 }),
  pose('banana', 'Banana stretch', ['banana pose', 'banana stretch'], { lats: 0.8, outer_hip: 0.4 }),
  pose('triangle', 'Triangle', ['triangle pose', 'trikonasana', 'revolved triangle'], { hamstrings: 0.7, adductors: 0.5, outer_hip: 0.5, lats: 0.4, spine: 0.3 }),
  pose('warrior_two', 'Warrior II', ['warrior two', 'warrior 2', 'warrior ii', 'virabhadrasana ii'], { quads: 0.7, glutes: 0.5, adductors: 0.5, shoulders: 0.3 }, 'strength'),
  pose('warrior_one', 'Warrior I', ['warrior one', 'warrior 1', 'warrior i', 'virabhadrasana i'], { hip_flexors: 0.6, quads: 0.6, glutes: 0.4 }, 'both'),
  pose('chair', 'Chair / squat', ['chair pose', 'utkatasana', 'squat', 'squats', 'wall sit'], { quads: 0.8, glutes: 0.8 }, 'strength'),
  pose('plank', 'Plank', ['plank', 'high plank', 'forearm plank', 'side plank', 'vasisthasana'], { core: 1, shoulders: 0.5, wrists: 0.4 }, 'strength'),
  pose('boat', 'Boat', ['boat pose', 'navasana'], { core: 1, hip_flexors: 0.5 }, 'strength'),
  pose('locust', 'Locust', ['locust', 'salabhasana', 'superman'], { lower_back: 0.7, glutes: 0.6, upper_back: 0.6 }, 'strength'),
  pose('bird_dog', 'Bird dog', ['bird dog'], { core: 0.8, lower_back: 0.7, glutes: 0.6 }, 'strength'),
  pose('dead_bug', 'Dead bug', ['dead bug'], { core: 1 }, 'strength'),
  pose('clamshell', 'Clamshell', ['clamshell', 'clam shell'], { outer_hip: 1, glutes: 0.6 }, 'strength'),
  pose('hydrant', 'Fire hydrant', ['fire hydrant', 'donkey kick', 'donkey kicks'], { glutes: 0.9, outer_hip: 0.7 }, 'strength'),
  pose('side_leg_lift', 'Side leg lift', ['side leg lift', 'lateral leg raise', 'side lying leg lift', 'leg lifts'], { outer_hip: 1, glutes: 0.4 }, 'strength'),
  pose('pelvic_tilt', 'Pelvic tilt', ['pelvic tilt', 'pelvic tilts'], { lower_back: 0.8, core: 0.6 }, 'both'),
  pose('calf_raise', 'Calf raise', ['calf raise', 'heel raise', 'heel raises'], { calves: 1 }, 'strength'),
  pose('calf_stretch', 'Calf stretch', ['calf stretch', 'wall calf stretch', 'standing calf', 'runners stretch'], { calves: 1 }),
  pose('toe_squat', 'Toe squat / foot work', ['toe squat', 'toe stretch', 'foot massage', 'plantar fascia', 'arch lift'], { feet: 1 }),
  pose('ankle_circles', 'Ankle circles', ['ankle circles', 'ankle rolls', 'ankle mobility', 'ankle stretch'], { feet: 1, calves: 0.3 }, 'both'),
  pose('quad_stretch', 'Quad stretch', ['quad stretch', 'standing quad', 'quadriceps stretch', 'half frog', 'natarajasana', 'dancer pose'], { quads: 1, hip_flexors: 0.4 }),
  pose('hero', 'Hero / reclined hero', ['hero pose', 'virasana', 'reclined hero', 'supta virasana', 'saddle pose'], { quads: 1, feet: 0.6, hip_flexors: 0.4 }),
  pose('legs_up_wall', 'Legs up the wall', ['legs up the wall', 'viparita karani', 'legs up wall'], { hamstrings: 0.5, calves: 0.6, lower_back: 0.5 }),
  pose('dolphin', 'Dolphin', ['dolphin pose', 'dolphin'], { shoulders: 0.9, upper_back: 0.6, hamstrings: 0.5 }, 'both'),
  pose('wall_angels', 'Wall angels', ['wall angel', 'wall angels'], { upper_back: 0.8, shoulders: 0.8 }, 'both'),
  pose('scapular', 'Scapular work', ['scapular', 'scapula retraction', 'shoulder blade squeeze', 'band pull apart', 'prone y', 'rows'], { upper_back: 0.9, shoulders: 0.6 }, 'strength'),
  pose('thoracic_ext', 'Thoracic extension', ['thoracic extension', 'foam roll', 'foam roller', 'thoracic mobility'], { upper_back: 0.9 }, 'both'),
  pose('snail', 'Snail / plough', ['snail pose', 'plough pose', 'plow pose', 'halasana'], { upper_back: 0.7, spine: 0.8, neck: 0.5 }),
  pose('triceps_stretch', 'Triceps / overhead stretch', ['triceps stretch', 'overhead stretch', 'cross body shoulder', 'cross body stretch'], { arms: 0.9, shoulders: 0.6 }),
];
export const POSE_BY_ID = Object.fromEntries(POSES.map((p) => [p.id, p]));
export const POSE_TERMS = compile(POSES);

// ---------------------------------------------------------------- styles

const style = (id, phrases) => ({ id, phrases });
export const STYLES = [
  { id: 'stretch', label: 'Stretch & release' },
  { id: 'yin', label: 'Yin / deep holds' },
  { id: 'flow', label: 'Flow' },
  { id: 'strength', label: 'Strength' },
  { id: 'mobility', label: 'Mobility' },
  { id: 'restorative', label: 'Gentle / sleep' },
];
export const STYLE_TERMS = compile([
  style('yin', ['yin', 'deep hold', 'long hold', 'long holds', 'fascia']),
  style('restorative', ['restorative', 'bedtime', 'before bed', 'sleep', 'wind down', 'relax', 'relaxing', 'gentle', 'nidra', 'calm', 'unwind', 'evening']),
  style('flow', ['flow', 'vinyasa', 'sun salutation', 'sun salutations', 'power yoga', 'morning yoga']),
  style('strength', ['strength', 'strong', 'strengthen', 'strengthening', 'workout', 'sculpt', 'burn', 'activation', 'stability', 'stabilize', 'core work']),
  style('stretch', ['stretch', 'stretching', 'release', 'loosen', 'flexibility', 'deep stretch', 'opener', 'tight', 'tension', 'relief']),
  style('mobility', ['mobility', 'mobilize', 'range of motion', 'dynamic', 'joint', 'joints', 'warm up', 'warmup']),
]);

export const DIFFICULTY_TERMS = compile([
  { phrases: ['beginner', 'beginners', 'gentle', 'easy', 'basic', 'for everyone', 'all levels', 'seniors'], level: 'beginner' },
  { phrases: ['intermediate'], level: 'intermediate' },
  { phrases: ['advanced', 'challenging', 'intense', 'deep stretch', 'power', 'hard'], level: 'advanced' },
]);

// ---------------------------------------------------------------- reading comments

// Checked first: a sentence matching any of these is negative, and its
// positive words are ignored ("didn't help" must not count as "help").
export const NEGATIVE_PHRASES = [
  'did not help', 'didnt help', 'doesnt help', 'does not help', 'no relief', 'not helpful', 'made it worse', 'got worse',
  'hurts my', 'hurt me', 'too fast', 'too quick', 'too hard', 'too difficult', 'too advanced', 'too intense',
  'cant keep up', 'boring', 'annoying', 'waste of time', 'not for me', 'dislike', 'disappointed', 'useless', 'terrible', 'worst',
];
export const POSITIVE_PHRASES = [
  'helped', 'helps', 'helping', 'relief', 'relieved', 'better', 'amazing', 'love this', 'loved', 'perfect', 'thank you', 'thanks',
  'feels so good', 'feel so good', 'feels amazing', 'finally', 'pain free', 'life changing', 'lifesaver', 'the best', 'best', 'godsend',
  'needed this', 'works', 'worked', 'improved', 'loosened', 'released', 'melted', 'so good', 'wonderful', 'great', 'fixed', 'gone', 'magic',
];
export const PACE_PHRASES = {
  tooFast: ['too fast', 'too quick', 'cant keep up', 'goes too fast', 'moves too fast'],
  tooHard: ['too hard', 'too difficult', 'too advanced', 'too intense'],
  tooEasy: ['too easy', 'too slow', 'too basic', 'not challenging'],
  beginnerFriendly: ['beginner', 'beginners', 'perfect pace', 'easy to follow', 'easy to follow along', 'gentle', 'clear instructions'],
};
const negRe = (list) => new RegExp(`\\b(?:${list.map((p) => escapeRe(normalize(p))).join('|')})\\b`);
export const NEG_RE = negRe(NEGATIVE_PHRASES);
export const POS_RE = negRe(POSITIVE_PHRASES);
export const PACE_RE = Object.fromEntries(Object.entries(PACE_PHRASES).map(([k, v]) => [k, negRe(v)]));

// What people say these videos did for them (used for "viewers report ..." badges).
export const BENEFITS = [
  { id: 'back_pain', label: 'back pain relief', phrases: ['back pain', 'backache', 'lower back', 'low back', 'lumbar'] },
  { id: 'sciatica', label: 'sciatica relief', phrases: ['sciatica', 'sciatic', 'piriformis'] },
  { id: 'posture', label: 'posture', phrases: ['posture', 'slouch', 'hunch', 'rounded shoulders', 'text neck'] },
  { id: 'stiffness', label: 'less stiffness', phrases: ['stiff', 'stiffness', 'tightness', 'tight'] },
  { id: 'tension', label: 'tension release', phrases: ['tension', 'knots', 'tense'] },
  { id: 'soreness', label: 'sore muscles', phrases: ['sore', 'soreness', 'doms'] },
  { id: 'sleep', label: 'sleep', phrases: ['sleep', 'sleeping', 'insomnia', 'bedtime'] },
  { id: 'stress', label: 'stress / calm', phrases: ['stress', 'anxiety', 'anxious', 'calm'] },
  { id: 'mobility', label: 'mobility', phrases: ['mobility', 'flexibility', 'range of motion', 'flexible'] },
  { id: 'headache', label: 'headaches', phrases: ['headache', 'headaches', 'migraine'] },
  { id: 'knees', label: 'knee comfort', phrases: ['knee', 'knees'] },
  { id: 'desk', label: 'desk-job relief', phrases: ['desk', 'office', 'computer', 'sitting all day', 'work from home'] },
];
export const BENEFIT_TERMS = compile(BENEFITS);

// ---------------------------------------------------------------- UI helpers

// One-tap presets that expand into several areas (and sometimes a style).
export const QUICK_PICKS = [
  { id: 'desk', label: 'Desk posture', areas: ['neck', 'upper_back', 'chest', 'shoulders', 'hip_flexors'] },
  { id: 'lowback', label: 'Achy lower back', areas: ['lower_back', 'glutes', 'hamstrings', 'hip_flexors'] },
  { id: 'sciatica', label: 'Sciatica / piriformis', areas: ['glutes', 'lower_back', 'hamstrings'] },
  { id: 'runner', label: 'Runner recovery', areas: ['quads', 'hip_flexors', 'calves', 'hamstrings', 'outer_hip'] },
  { id: 'typing', label: 'Wrists & typing', areas: ['wrists', 'shoulders', 'neck'] },
  { id: 'hips', label: 'Tight hips', areas: ['hip_flexors', 'glutes', 'adductors'] },
  { id: 'weakglutes', label: 'Weak glutes & core', areas: ['glutes', 'outer_hip', 'core'], mode: 'weak', styles: ['strength'] },
  { id: 'lowerlegs', label: 'Calves & feet', areas: ['calves', 'feet'] },
  { id: 'unwind', label: 'Unwind / sleep', areas: ['full_body'], styles: ['restorative'] },
  { id: 'morning', label: 'Morning wake-up', areas: ['full_body', 'spine'], styles: ['flow'] },
];

// Teachers/channels used to bias searches. Names only (matched against the
// channel title YouTube returns), so nothing here can go stale or be wrong
// about IDs. `note` comes from published "best yoga channel" roundups.
export const TEACHERS = [
  { name: 'Yoga With Adriene' },
  { name: 'Yoga With Kassandra' },
  { name: 'Sarah Beth Yoga' },
  { name: 'Boho Beautiful' },
  { name: 'Mady Morrison' },
  { name: 'Travis Eliot', note: 'Slow, meditative yin and power yoga' },
  { name: 'Breathe and Flow', note: 'Strong, breath-led flows' },
  { name: 'Yoga With Bird', note: 'Gentle, short classes' },
  { name: 'YogaTX', note: 'Mostly 30 minutes or less, many beginner series' },
  { name: 'Caren Baginski', note: 'Restorative yoga and yoga therapy' },
  { name: 'Bright and Salted Yoga' },
  { name: 'Edyn Loves Life', note: 'Practices designed for larger bodies' },
  { name: 'Bob and Brad', note: 'Physical therapists' },
  { name: 'Tim Senesi' },
  { name: 'Yoga With Paige' },
  { name: 'Yoga By Candace' },
  { name: 'Lesley Fightmaster' },
];
