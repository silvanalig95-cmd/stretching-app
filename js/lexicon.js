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
export function compile(entries) {
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
// Some areas have more SPECIFIC children (`parent`): "Core" and also "Lower abdomen", "Side abs"... The general
// area stays selectable; a video that works a child counts for its parent too (see combineSources), and a
// video that only says "core" is a weaker match for each child.
const area = (id, label, group, say, parent = null) => ({ id, label, group, say, parent });
export const AREAS = [
  area('neck', 'Neck', 'upper', ['neck', 'tight neck', 'neck tension', 'text neck']),
  area('upper_traps', 'Upper traps', 'upper', ['upper traps', 'trap tension', 'tight traps', 'neck and traps'], 'neck'),
  area('shoulders', 'Shoulders', 'upper', ['shoulders', 'tight shoulders', 'shoulder mobility', 'shoulder tension']),
  area('rotator_cuff', 'Rotator cuff', 'upper', ['rotator cuff', 'shoulder stability', 'shoulder impingement', 'shoulder rehab'], 'shoulders'),
  area('chest', 'Chest', 'upper', ['chest', 'chest opener', 'tight chest', 'chest and shoulders']),
  area('upper_back', 'Upper back & posture', 'upper', ['upper back', 'posture', 'upper back tension', 'rounded shoulders']),
  area('rhomboids', 'Between the shoulder blades', 'upper', ['between the shoulder blades', 'rhomboids', 'shoulder blade tension', 'scapular stretch'], 'upper_back'),
  area('thoracic', 'Mid-back (thoracic spine)', 'upper', ['thoracic spine', 'mid back', 'thoracic mobility', 'mid back stiffness'], 'upper_back'),
  area('lats', 'Lats & side body', 'upper', ['side body', 'lats', 'side stretch', 'lat stretch']),
  area('arms', 'Arms', 'upper', ['arms', 'biceps and triceps', 'arm stretch']),
  area('biceps', 'Biceps', 'upper', ['biceps', 'biceps stretch', 'biceps and forearms'], 'arms'),
  area('triceps', 'Triceps', 'upper', ['triceps', 'triceps stretch', 'back of the arms'], 'arms'),
  area('elbows', 'Elbows', 'upper', ['elbows', 'tennis elbow', 'golfers elbow', 'elbow pain'], 'arms'),
  area('wrists', 'Wrists & forearms', 'upper', ['wrists', 'wrists and forearms', 'wrist pain', 'forearm stretch']),
  area('lower_back', 'Lower back', 'back', ['lower back', 'low back pain', 'lower back relief', 'tight lower back']),
  area('ql', 'Side of the lower back (QL)', 'back', ['QL stretch', 'quadratus lumborum', 'side of the lower back', 'low back side'], 'lower_back'),
  area('si_joint', 'Sacrum & SI joint', 'back', ['SI joint', 'sacroiliac', 'sacrum pain', 'SI joint pain'], 'lower_back'),
  area('spine', 'Spine mobility', 'back', ['spine', 'spinal mobility', 'spine twist', 'back mobility']),
  area('core', 'Core', 'back', ['core', 'core strength', 'abs', 'core stability']),
  area('abs_upper', 'Upper abs', 'back', ['upper abs', 'upper abdominals', 'six pack abs', 'crunches'], 'core'),
  area('abs_lower', 'Lower abdomen', 'back', ['lower abs', 'lower belly', 'lower abdominals', 'lower abs workout'], 'core'),
  area('obliques', 'Side abs (obliques)', 'back', ['obliques', 'side abs', 'waist and obliques', 'love handles'], 'core'),
  area('deep_core', 'Deep core (transverse)', 'back', ['deep core', 'transverse abdominis', 'core stability', 'deep abs'], 'core'),
  area('pelvic_floor', 'Pelvic floor', 'back', ['pelvic floor', 'kegel', 'pelvic floor exercises', 'postpartum core'], 'core'),
  area('hip_flexors', 'Hip flexors', 'hips', ['hip flexors', 'tight hip flexors', 'psoas', 'hip flexor release']),
  area('psoas', 'Psoas (deep hip flexor)', 'hips', ['psoas', 'psoas release', 'psoas stretch', 'iliopsoas'], 'hip_flexors'),
  area('glutes', 'Glutes & piriformis', 'hips', ['glutes', 'piriformis', 'sciatica', 'tight glutes', 'glutes and hips']),
  area('piriformis', 'Piriformis & deep rotators', 'hips', ['piriformis', 'piriformis stretch', 'sciatica relief', 'deep hip rotators'], 'glutes'),
  area('outer_hip', 'Outer hip & IT band', 'hips', ['outer hip', 'IT band', 'hip stability', 'glute medius']),
  area('adductors', 'Inner thighs & groin', 'hips', ['inner thighs', 'groin', 'adductors', 'hip openers inner thigh']),
  area('hamstrings', 'Hamstrings', 'legs', ['hamstrings', 'tight hamstrings', 'hamstring flexibility', 'back of legs']),
  area('quads', 'Quads', 'legs', ['quads', 'quad stretch', 'tight quads', 'quadriceps']),
  area('knees', 'Knees', 'legs', ['knees', 'knee pain', 'knee mobility', 'knee friendly']),
  area('calves', 'Calves & shins', 'legs', ['calves', 'tight calves', 'calf stretch', 'shins and calves']),
  area('achilles', 'Achilles & soleus', 'legs', ['achilles', 'achilles tendon', 'soleus stretch', 'achilles tightness'], 'calves'),
  area('shins', 'Shins', 'legs', ['shins', 'shin splints', 'tibialis', 'shin pain'], 'calves'),
  area('feet', 'Feet & ankles', 'legs', ['feet', 'ankles', 'feet and ankles', 'ankle mobility']),
  area('ankles', 'Ankles', 'legs', ['ankles', 'ankle mobility', 'weak ankles', 'ankle stability'], 'feet'),
  area('arches', 'Arches & plantar fascia', 'legs', ['plantar fasciitis', 'arches of the feet', 'foot arches', 'foot pain'], 'feet'),
  area('full_body', 'Full body', 'whole', ['full body', 'total body', 'whole body']),
];
export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));
export const areaLabel = (id) => AREA_BY_ID[id]?.label ?? id;
export const parentOf = (id) => AREA_BY_ID[id]?.parent ?? null;
export const isSpecific = (id) => !!AREA_BY_ID[id]?.parent;
export const childrenOf = (id) => AREAS.filter((a) => a.parent === id);
/** The general area a specific one belongs to (or itself): used to count "how many different things" a video covers. */
export const rootOf = (id) => AREA_BY_ID[id]?.parent ?? id;
/** "Core › Lower abdomen" for a specific area, plain label otherwise (for menus where the context helps). */
export const areaPath = (id) => (isSpecific(id) ? `${areaLabel(parentOf(id))} › ${areaLabel(id)}` : areaLabel(id));
// A video that only speaks of the general area ("core workout") is a weak match for each specific one, never a strong one.
export const GENERIC_TO_SPECIFIC = 0.4;
// A video that works a specific area also works the general one it belongs to, almost as strongly.
export const SPECIFIC_TO_GENERIC = 0.9;

// ---------------------------------------------------------------- vocabulary -> areas
// `weak: true` = generic words that only count at half weight and are ignored
// when reading comments ("come back", "arm balance", ...).

const term = (phrases, map, weak = false) => ({ phrases, map, weak });

const TERM_DEFS = [
  term(['text neck', 'tech neck', 'forward head', 'forward head posture'], { neck: 1, upper_back: 0.6 }),
  term(['neck', 'cervical', 'levator scapulae', 'scalenes', 'sternocleidomastoid'], { neck: 1 }),
  term(['upper traps', 'upper trap', 'upper trapezius', 'trapezius', 'traps', 'trap tension', 'shoulder knots', 'knots in my shoulders'], { upper_traps: 1 }),
  term(['shoulder blades', 'shoulder blade', 'scapula', 'scapulae'], { upper_back: 0.8, shoulders: 0.5 }),
  term(['between the shoulder blades', 'between shoulder blades', 'between my shoulder blades', 'rhomboid', 'rhomboids', 'scapular retraction'], { rhomboids: 1 }),
  term(['shoulder', 'deltoid', 'deltoids'], { shoulders: 1 }),
  term(['rotator cuff', 'supraspinatus', 'infraspinatus', 'shoulder impingement', 'shoulder joint', 'external rotation', 'internal rotation'], { rotator_cuff: 1 }),
  term(['chest', 'pec', 'pecs', 'pectoral', 'pectorals', 'heart opener', 'heart opening'], { chest: 1 }),
  term(['upper back'], { upper_back: 1 }),
  term(['thoracic', 'thoracic spine', 'mid back', 'middle back', 'mid-back'], { thoracic: 1 }),
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
  term(['arms', 'arm'], { arms: 1 }, true),
  term(['biceps', 'bicep'], { biceps: 1 }),
  term(['triceps', 'tricep'], { triceps: 1 }),
  term(['elbow', 'elbows', 'tennis elbow', 'golfers elbow', 'golfer elbow'], { elbows: 1 }),
  term(['wrist', 'forearm', 'carpal tunnel', 'typing', 'keyboard', 'hands'], { wrists: 1 }),
  term(['lower back', 'low back', 'lumbar', 'lumbago', 'back pain', 'backache'], { lower_back: 1 }),
  term(['si joint', 'sacroiliac', 'sacrum', 'sacral', 'tailbone', 'si joint pain'], { si_joint: 1 }),
  term(['quadratus lumborum', 'ql', 'ql stretch', 'side of the lower back', 'side of my lower back', 'side of the low back'], { ql: 1 }),
  term(['sciatica', 'sciatic', 'sciatic nerve'], { glutes: 1, lower_back: 0.6, hamstrings: 0.4, piriformis: 0.45 }),
  term(['back'], { lower_back: 0.6, upper_back: 0.6 }, true),
  term(['spine', 'spinal', 'spinal mobility', 'vertebrae', 'cat cow', 'marjaryasana'], { spine: 1 }),
  term(['core', 'abs', 'abdominal', 'abdominals', 'tummy', 'belly'], { core: 1 }),
  term(['upper abs', 'upper ab', 'upper abdominals', 'upper abdominal', 'rectus abdominis', 'crunch', 'crunches', 'sit ups', 'situps'], { abs_upper: 1 }),
  term(['lower abs', 'lower ab', 'lower abdomen', 'lower abdominals', 'lower belly', 'lower tummy', 'below the belly button', 'lower abs workout', 'pooch'], { abs_lower: 1 }),
  term(['six pack', 'six pack abs', 'sixpack', '6 pack'], { abs_upper: 0.7, abs_lower: 0.7 }),
  term(['obliques', 'oblique', 'side abs', 'side abdominals', 'side abdominal', 'love handles', 'waistline', 'waist', 'side belly', 'russian twist', 'russian twists'], { obliques: 1 }),
  term(['transverse abdominis', 'tva', 'deep core', 'deep abs', 'deep abdominals', 'diastasis recti', 'hollow body'], { deep_core: 1 }),
  term(['pelvic floor', 'pelvic floor muscles', 'kegel', 'kegels', 'postpartum core', 'postpartum'], { pelvic_floor: 1 }),
  term(['hip flexor', 'hip flexors'], { hip_flexors: 1 }),
  term(['psoas', 'iliopsoas', 'iliacus', 'psoas release'], { psoas: 1 }),
  term(['glute', 'glutes', 'gluteal', 'buttocks', 'butt'], { glutes: 1 }),
  term(['piriformis', 'deep hip rotators', 'hip rotators', 'external rotators', 'piriformis syndrome'], { piriformis: 1 }),
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
  term(['calf', 'calves', 'gastrocnemius'], { calves: 1 }),
  term(['achilles', 'achilles tendon', 'soleus'], { achilles: 1 }),
  term(['shin', 'shins', 'shin splints', 'shin pain', 'tibialis', 'tibialis anterior'], { shins: 1 }),
  term(['foot', 'feet', 'toes'], { feet: 1 }),
  term(['ankle', 'ankles', 'ankle mobility', 'ankle stability', 'sprained ankle', 'weak ankles'], { ankles: 1 }),
  term(['plantar fasciitis', 'plantar fascia', 'plantar', 'arches', 'flat feet', 'foot arch', 'foot arches'], { arches: 1 }),
  term(['knee pain', 'knee health', 'knee mobility', 'knee friendly', 'knee strength', 'knee rehab', 'healthy knees', 'bad knees', 'patella', 'patellar', 'meniscus', 'runners knee', 'runner s knee', 'acl'], { knees: 1 }),
  term(['legs', 'leg', 'lower body', 'tired legs', 'heavy legs'], { hamstrings: 0.6, quads: 0.6, calves: 0.5, glutes: 0.4 }, true),
  term(
    ['runner', 'runners', 'running', 'post run', 'after a run', 'marathon', 'cyclist', 'cycling', 'hiking'],
    { quads: 0.6, hip_flexors: 0.6, calves: 0.6, hamstrings: 0.6, outer_hip: 0.5 },
    true,
  ),
  term(['full body', 'total body', 'whole body', 'head to toe', 'all over', 'every muscle'], { full_body: 1 }),
];
export const AREA_TERMS = compile(TERM_DEFS);
// Words that are fine as a REQUEST ("knees") but too ambiguous to read as evidence in a title or comment
// ("knees to chest" is a pose that works the lower back, not the knees).
export const COMMAND_ONLY_TERMS = compile([term(['knee', 'knees'], { knees: 1 })]);

// ---------------------------------------------------------------- poses / exercises
// What a named pose or exercise actually works. mode: 'stretch' | 'strength' | 'both'.

const pose = (id, label, names, areas, mode = 'stretch') => ({ id, label, phrases: names, areas, mode });

export const POSES = [
  pose('low_lunge', 'Low lunge', ['low lunge', 'crescent lunge', 'runners lunge', 'anjaneyasana', 'kneeling hip flexor', 'half kneeling', 'lizard pose', 'lizard', 'deep lunge'], { hip_flexors: 1, psoas: 0.9, quads: 0.5 }),
  pose('couch', 'Couch stretch', ['couch stretch'], { quads: 1, hip_flexors: 1, psoas: 0.7 }),
  pose('dragon', 'Dragon pose', ['dragon pose', 'dragon'], { hip_flexors: 1, psoas: 0.8, quads: 0.6, adductors: 0.3 }),
  pose('pigeon', 'Pigeon', ['pigeon', 'pigeon pose', 'sleeping pigeon', 'sleeping swan', 'swan', 'eka pada rajakapotasana', 'king pigeon'], { glutes: 1, piriformis: 0.9, hip_flexors: 0.5, outer_hip: 0.4 }),
  pose('figure_four', 'Figure four', ['figure four', 'figure 4', 'reclined pigeon', 'eye of the needle', 'seated figure four', 'chair pigeon', 'seated pigeon'], { glutes: 1, piriformis: 0.9, outer_hip: 0.4 }),
  pose('ninety_ninety', '90/90', ['90 90', 'ninety ninety', 'shoelace', 'square pose'], { glutes: 0.8, piriformis: 0.6, outer_hip: 0.8, hip_flexors: 0.3 }),
  pose('happy_baby', 'Happy baby', ['happy baby', 'ananda balasana'], { adductors: 0.7, lower_back: 0.6, glutes: 0.4, hamstrings: 0.3 }),
  pose('butterfly', 'Butterfly', ['butterfly', 'baddha konasana', 'bound angle', 'cobbler', 'reclined butterfly', 'supta baddha konasana'], { adductors: 1, glutes: 0.3 }),
  pose('frog', 'Frog', ['frog pose', 'frog', 'mandukasana'], { adductors: 1 }),
  pose('straddle', 'Wide-legged fold', ['wide legged forward fold', 'straddle', 'prasarita', 'upavistha konasana', 'middle splits'], { adductors: 0.8, hamstrings: 0.8 }),
  pose('garland', 'Garland / yogi squat', ['garland', 'malasana', 'yogi squat', 'deep squat'], { adductors: 0.6, glutes: 0.5, feet: 0.4, calves: 0.3 }, 'both'),
  pose('hand_to_toe', 'Reclined hand-to-big-toe', ['hand to big toe', 'supta padangusthasana', 'reclined hamstring', 'hamstring stretch'], { hamstrings: 1, outer_hip: 0.3 }),
  pose('forward_fold', 'Forward fold', ['forward fold', 'forward bend', 'uttanasana', 'paschimottanasana', 'ragdoll', 'rag doll'], { hamstrings: 1, lower_back: 0.6, calves: 0.3 }),
  pose('caterpillar', 'Caterpillar', ['caterpillar'], { hamstrings: 0.8, lower_back: 0.8 }),
  pose('pyramid', 'Pyramid', ['pyramid pose', 'parsvottanasana'], { hamstrings: 1, calves: 0.4 }),
  pose('down_dog', 'Downward dog', ['downward dog', 'downward facing dog', 'adho mukha svanasana', 'down dog'], { hamstrings: 0.7, calves: 0.7, achilles: 0.4, shoulders: 0.6, lats: 0.4, upper_back: 0.3 }, 'both'),
  pose('childs', "Child's pose", ['childs pose', 'child pose', 'balasana', 'extended childs pose'], { lower_back: 0.8, lats: 0.6, shoulders: 0.4, glutes: 0.3 }),
  pose('wide_child', 'Wide-knee child', ['wide knee childs pose', 'wide child'], { adductors: 0.6, lower_back: 0.6, lats: 0.4 }),
  pose('knees_to_chest', 'Knees to chest', ['knees to chest', 'apanasana', 'wind relieving'], { lower_back: 1, glutes: 0.5 }),
  pose('cat_cow', 'Cat-cow', ['cat cow', 'cat and cow', 'marjaryasana'], { spine: 1, thoracic: 0.5, lower_back: 0.6, upper_back: 0.6, neck: 0.2 }, 'both'),
  pose('thread_needle', 'Thread the needle', ['thread the needle'], { upper_back: 0.9, thoracic: 0.6, rhomboids: 0.5, shoulders: 0.8, neck: 0.3 }),
  pose('cobra', 'Cobra / sphinx', ['cobra', 'sphinx', 'upward dog', 'upward facing dog', 'bhujangasana', 'seal pose'], { chest: 0.8, spine: 0.6, lower_back: 0.5, core: 0.5, hip_flexors: 0.4 }, 'both'),
  pose('bridge', 'Bridge', ['bridge pose', 'glute bridge', 'setu bandha', 'hip bridge'], { glutes: 0.9, hamstrings: 0.5, hip_flexors: 0.5, chest: 0.4, core: 0.3 }, 'both'),
  pose('camel', 'Camel', ['camel pose', 'ustrasana'], { chest: 1, hip_flexors: 0.6, quads: 0.6, core: 0.4 }),
  pose('twist', 'Spinal twist', ['supine twist', 'reclined twist', 'spinal twist', 'seated twist', 'revolved', 'jathara parivartanasana', 'twist', 'twists'], { spine: 0.9, lower_back: 0.8, thoracic: 0.4, obliques: 0.3, glutes: 0.4, upper_back: 0.4, outer_hip: 0.3 }),
  pose('eagle', 'Eagle', ['eagle pose', 'garudasana', 'eagle arms'], { shoulders: 0.8, upper_back: 0.7, rhomboids: 0.6, outer_hip: 0.5, glutes: 0.4 }),
  pose('cow_face', 'Cow face', ['cow face', 'gomukhasana'], { shoulders: 0.8, triceps: 0.5, outer_hip: 0.7, glutes: 0.6, piriformis: 0.5, arms: 0.5 }),
  pose('puppy', 'Puppy / melting heart', ['puppy pose', 'melting heart', 'uttana shishosana'], { shoulders: 0.8, upper_back: 0.7, thoracic: 0.5, chest: 0.6, lats: 0.5 }),
  pose('chest_opener', 'Chest opener', ['doorway stretch', 'chest opener', 'wall stretch', 'clasped hands behind back', 'interlace hands behind', 'reverse table top', 'reverse tabletop'], { chest: 1, shoulders: 0.6 }),
  pose('neck_stretch', 'Neck stretch', ['neck roll', 'ear to shoulder', 'neck stretch', 'chin tuck', 'neck release'], { neck: 1, upper_traps: 0.5 }),
  pose('trap_stretch', 'Upper trap stretch', ['upper trap stretch', 'trap stretch', 'trapezius stretch', 'levator scapulae stretch'], { upper_traps: 1, neck: 0.5 }),
  pose('shoulder_circles', 'Shoulder circles', ['shoulder roll', 'shoulder circles', 'arm circles', 'shoulder rolls'], { shoulders: 0.9, upper_back: 0.4 }, 'both'),
  pose('wrist_stretch', 'Wrist stretches', ['wrist circles', 'wrist stretch', 'prayer stretch', 'reverse prayer', 'wrist flexor', 'wrist extensor', 'finger stretch'], { wrists: 1 }),
  pose('elbow_care', 'Elbow / tendon care', ['tennis elbow stretch', 'golfers elbow stretch', 'eccentric wrist', 'elbow mobility', 'tyler twist', 'flexbar'], { elbows: 1, wrists: 0.5 }, 'both'),
  pose('side_bend', 'Side bend', ['side bend', 'crescent moon', 'half moon', 'standing side stretch'], { lats: 0.9, obliques: 0.5, ql: 0.5, outer_hip: 0.3 }),
  pose('ql_stretch', 'QL stretch', ['ql stretch', 'quadratus lumborum', 'side lying ql', 'wall ql stretch'], { ql: 1, lats: 0.4 }),
  pose('banana', 'Banana stretch', ['banana pose', 'banana stretch'], { lats: 0.8, outer_hip: 0.4 }),
  pose('triangle', 'Triangle', ['triangle pose', 'trikonasana', 'revolved triangle'], { hamstrings: 0.7, adductors: 0.5, outer_hip: 0.5, lats: 0.4, spine: 0.3 }),
  pose('warrior_two', 'Warrior II', ['warrior two', 'warrior 2', 'warrior ii', 'virabhadrasana ii'], { quads: 0.7, glutes: 0.5, adductors: 0.5, shoulders: 0.3 }, 'strength'),
  pose('warrior_one', 'Warrior I', ['warrior one', 'warrior 1', 'warrior i', 'virabhadrasana i'], { hip_flexors: 0.6, quads: 0.6, glutes: 0.4 }, 'both'),
  pose('chair', 'Chair / squat', ['chair pose', 'utkatasana', 'squat', 'squats', 'wall sit'], { quads: 0.8, glutes: 0.8 }, 'strength'),
  pose('plank', 'Plank', ['plank', 'high plank', 'forearm plank'], { core: 1, deep_core: 0.7, abs_upper: 0.5, shoulders: 0.5, wrists: 0.4 }, 'strength'),
  pose('side_plank', 'Side plank', ['side plank', 'vasisthasana', 'side plank pose'], { obliques: 1, core: 0.7, shoulders: 0.5, outer_hip: 0.4 }, 'strength'),
  pose('boat', 'Boat', ['boat pose', 'navasana'], { core: 1, abs_lower: 0.9, abs_upper: 0.6, hip_flexors: 0.5 }, 'strength'),
  pose('locust', 'Locust', ['locust', 'salabhasana', 'superman'], { lower_back: 0.7, glutes: 0.6, upper_back: 0.6 }, 'strength'),
  pose('bird_dog', 'Bird dog', ['bird dog'], { core: 0.8, deep_core: 0.7, lower_back: 0.7, glutes: 0.6 }, 'strength'),
  pose('dead_bug', 'Dead bug', ['dead bug'], { core: 1, deep_core: 0.9, abs_lower: 0.8 }, 'strength'),
  pose('clamshell', 'Clamshell', ['clamshell', 'clam shell'], { outer_hip: 1, glutes: 0.6 }, 'strength'),
  pose('hydrant', 'Fire hydrant', ['fire hydrant', 'donkey kick', 'donkey kicks'], { glutes: 0.9, outer_hip: 0.7 }, 'strength'),
  pose('side_leg_lift', 'Side leg lift', ['side leg lift', 'lateral leg raise', 'side lying leg lift', 'leg lifts'], { outer_hip: 1, glutes: 0.4 }, 'strength'),
  pose('pelvic_tilt', 'Pelvic tilt', ['pelvic tilt', 'pelvic tilts'], { lower_back: 0.8, core: 0.6, abs_lower: 0.7, deep_core: 0.6, pelvic_floor: 0.4 }, 'both'),
  pose('crunch', 'Crunch / sit-up', ['crunch', 'crunches', 'sit ups', 'situps', 'ab curl'], { abs_upper: 1, core: 0.8, abs_lower: 0.3 }, 'strength'),
  pose('leg_raise', 'Leg raise / flutter kicks', ['leg raise', 'leg raises', 'lying leg raise', 'reverse crunch', 'scissor kicks', 'flutter kicks', 'toe taps', 'heel taps'], { abs_lower: 1, core: 0.8, hip_flexors: 0.4 }, 'strength'),
  pose('russian_twist', 'Russian twist / bicycle', ['russian twist', 'russian twists', 'bicycle crunch', 'bicycle crunches', 'wood chop', 'woodchop', 'windshield wipers'], { obliques: 1, core: 0.8, abs_upper: 0.4 }, 'strength'),
  pose('hollow_hold', 'Hollow hold', ['hollow hold', 'hollow body', 'hollow rock'], { deep_core: 1, abs_lower: 0.8, core: 0.9 }, 'strength'),
  pose('kegel', 'Pelvic floor work', ['kegel', 'kegels', 'pelvic floor lift', 'pelvic floor exercise', 'pelvic floor exercises', 'pelvic floor release'], { pelvic_floor: 1, deep_core: 0.4 }, 'both'),
  pose('tva_breath', 'Core breathing / TVA', ['tva', 'transverse abdominis', 'core breathing', 'abdominal bracing', 'drawing in', 'belly breathing'], { deep_core: 1, pelvic_floor: 0.4 }, 'strength'),
  pose('calf_raise', 'Calf raise', ['calf raise', 'heel raise', 'heel raises'], { calves: 1, achilles: 0.5 }, 'strength'),
  pose('calf_stretch', 'Calf stretch', ['calf stretch', 'wall calf stretch', 'standing calf', 'runners stretch'], { calves: 1, achilles: 0.6 }),
  pose('shin_stretch', 'Shin stretch', ['shin stretch', 'tibialis stretch', 'toe pulls', 'toe raises', 'shin splint stretch'], { shins: 1 }),
  pose('toe_squat', 'Toe squat / foot work', ['toe squat', 'toe stretch', 'foot massage', 'plantar fascia', 'arch lift', 'short foot', 'foot doming'], { feet: 1, arches: 0.9 }),
  pose('ankle_circles', 'Ankle circles', ['ankle circles', 'ankle rolls', 'ankle mobility', 'ankle stretch', 'ankle alphabet'], { feet: 1, ankles: 1, calves: 0.3 }, 'both'),
  pose('knee_care', 'Knee strengthening / mobility', ['terminal knee extension', 'tke', 'knee circles', 'vmo', 'knee extension', 'step down', 'step downs', 'knee mobility'], { knees: 1, quads: 0.5 }, 'both'),
  pose('quad_stretch', 'Quad stretch', ['quad stretch', 'standing quad', 'quadriceps stretch', 'half frog', 'natarajasana', 'dancer pose'], { quads: 1, hip_flexors: 0.4 }),
  pose('hero', 'Hero / reclined hero', ['hero pose', 'virasana', 'reclined hero', 'supta virasana', 'saddle pose'], { quads: 1, feet: 0.6, knees: 0.4, hip_flexors: 0.4 }),
  pose('legs_up_wall', 'Legs up the wall', ['legs up the wall', 'viparita karani', 'legs up wall'], { hamstrings: 0.5, calves: 0.6, lower_back: 0.5 }),
  pose('dolphin', 'Dolphin', ['dolphin pose', 'dolphin'], { shoulders: 0.9, upper_back: 0.6, hamstrings: 0.5 }, 'both'),
  pose('wall_angels', 'Wall angels', ['wall angel', 'wall angels'], { upper_back: 0.8, rhomboids: 0.6, shoulders: 0.8, rotator_cuff: 0.4 }, 'both'),
  pose('cuff_work', 'Rotator cuff work', ['external rotation', 'internal rotation', 'sleeper stretch', 'cuff work', 'band external rotation', 'shoulder rehab'], { rotator_cuff: 1, shoulders: 0.5 }, 'both'),
  pose('scapular', 'Scapular work', ['scapular', 'scapula retraction', 'shoulder blade squeeze', 'band pull apart', 'prone y', 'rows'], { upper_back: 0.9, rhomboids: 1, shoulders: 0.6 }, 'strength'),
  pose('thoracic_ext', 'Thoracic extension', ['thoracic extension', 'foam roll', 'foam roller', 'thoracic mobility'], { upper_back: 0.9, thoracic: 1 }, 'both'),
  pose('snail', 'Snail / plough', ['snail pose', 'plough pose', 'plow pose', 'halasana'], { upper_back: 0.7, spine: 0.8, neck: 0.5 }),
  pose('triceps_stretch', 'Triceps / overhead stretch', ['triceps stretch', 'overhead stretch', 'cross body shoulder', 'cross body stretch'], { arms: 0.9, triceps: 1, shoulders: 0.6 }),
  pose('biceps_stretch', 'Biceps stretch', ['biceps stretch', 'bicep stretch', 'wall biceps stretch', 'biceps and forearm stretch'], { biceps: 1, arms: 0.7, chest: 0.3 }),
  // Classic Pilates mat exercises (the style classifier uses their names as evidence, and they work the core and hips).
  pose('pilates_hundred', 'The Hundred', ['the hundred', 'pilates hundred'], { core: 1, abs_upper: 0.8, deep_core: 0.7 }, 'strength'),
  pose('roll_up', 'Roll up', ['roll up', 'roll ups', 'pilates roll up'], { abs_upper: 0.9, core: 0.9, spine: 0.6, hamstrings: 0.4 }, 'both'),
  pose('single_leg_stretch', 'Single-leg stretch', ['single leg stretch', 'double leg stretch'], { abs_upper: 0.9, core: 0.9, abs_lower: 0.5 }, 'strength'),
  pose('criss_cross', 'Criss-cross', ['criss cross', 'criss crosses'], { obliques: 1, core: 0.8, abs_upper: 0.6 }, 'strength'),
  pose('teaser', 'Teaser', ['teaser', 'pilates teaser'], { core: 1, abs_lower: 0.9, hip_flexors: 0.5, deep_core: 0.6 }, 'strength'),
  pose('leg_circles', 'Leg circles', ['leg circles', 'single leg circles'], { hip_flexors: 0.6, glutes: 0.4, core: 0.6, outer_hip: 0.4 }, 'both'),
  pose('rolling_ball', 'Rolling like a ball', ['rolling like a ball'], { core: 0.8, spine: 0.8, abs_upper: 0.6 }, 'both'),
  pose('spine_stretch', 'Spine stretch forward', ['spine stretch forward', 'spine stretch'], { spine: 0.8, hamstrings: 0.6, lower_back: 0.5, core: 0.4 }),
  pose('side_kick', 'Side-kick series', ['side kick series', 'side kicks', 'pilates side kick'], { outer_hip: 1, glutes: 0.7, obliques: 0.4 }, 'strength'),
  pose('mermaid', 'Mermaid stretch', ['mermaid stretch', 'mermaid'], { lats: 0.9, obliques: 0.7, ql: 0.6, shoulders: 0.3 }),
  pose('shoulder_bridge', 'Shoulder bridge', ['shoulder bridge'], { glutes: 0.9, hamstrings: 0.6, core: 0.5, hip_flexors: 0.4 }, 'both'),
  pose('leg_pull', 'Leg pull', ['leg pull', 'leg pull front'], { core: 0.9, shoulders: 0.6, glutes: 0.5 }, 'strength'),
];
export const POSE_BY_ID = Object.fromEntries(POSES.map((p) => [p.id, p]));
export const POSE_TERMS = compile(POSES);

// ---------------------------------------------------------------- styles

const style = (id, phrases) => ({ id, phrases });
// (The list of styles shown as filters, with their labels, lives in style.js next to the classifier.)
export const STYLE_TERMS = compile([
  style('yin', ['yin', 'deep hold', 'long hold', 'long holds', 'fascia']),
  style('restorative', ['restorative', 'bedtime', 'before bed', 'sleep', 'wind down', 'relax', 'relaxing', 'gentle', 'nidra', 'calm', 'unwind', 'evening']),
  style('flow', ['flow', 'vinyasa', 'sun salutation', 'sun salutations', 'power yoga', 'morning yoga']),
  style('strength', ['strength', 'strong', 'strengthen', 'strengthening', 'workout', 'sculpt', 'burn', 'activation', 'stability', 'stabilize', 'core work']),
  style('stretch', ['stretch', 'stretching', 'release', 'loosen', 'flexibility', 'deep stretch', 'opener', 'tight', 'tension', 'relief']),
  style('mobility', ['mobility', 'mobilize', 'range of motion', 'dynamic', 'joint', 'joints', 'warm up', 'warmup']),
  // kinds of practice a person can ask for by name
  style('pilates', ['pilates']), style('wall_pilates', ['wall pilates']), style('reformer', ['reformer', 'reformer pilates']),
  style('hatha', ['hatha']), style('ashtanga', ['ashtanga']), style('kundalini', ['kundalini']), style('chair', ['chair yoga', 'seated yoga', 'desk yoga']),
  style('rolling', ['foam rolling', 'foam roller', 'self massage', 'myofascial']), style('taichi', ['tai chi', 'qigong', 'qi gong']),
  style('barre', ['barre']), style('meditation', ['meditation', 'breathwork']),
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
  { id: 'lowerabs', label: 'Lower abs & deep core', areas: ['abs_lower', 'deep_core'], mode: 'weak', styles: ['strength'] },
  { id: 'sideabs', label: 'Side abs & waist', areas: ['obliques', 'ql'], styles: [] },
  { id: 'knees', label: 'Happy knees', areas: ['knees', 'quads', 'hamstrings'] },
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
