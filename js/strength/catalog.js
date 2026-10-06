// The exercise catalogue: what each exercise trains, what it needs, and how hard it is.
// Built around a home setup: bodyweight, dumbbells, a pull-up bar, loop bands, a cable / weight station and an
// inversion trainer. It can always be extended with your own exercises (they live in your profile, see store.js).
//
// Fields:  slot/type = what it is for;  primary/secondary = muscles (see muscles.js);  needs = equipment that must
// be there;  loads = optional equipment that makes it harder;  level 1-3;  metric 'reps' or 'time';
// avoid = movement flags it loads (see AVOID_FLAGS);  next/prev = the harder / easier rung of a progression.

import { MUSCLE_BY_ID, EQUIPMENT_BY_ID, SLOTS, TYPE_ORDER, AVOID_FLAGS, LEVEL_NUM } from './muscles.js';

const E = (id, name, slot, type, p) => ({
  id, name, slot, type, aka: [], primary: [], secondary: [], needs: [], loads: [], level: 1, unilateral: false, metric: 'reps', tags: [], avoid: [], cue: '', ...p,
});

export const EXERCISES = [
  // ------------------------------------------------------------ pulling from above (pull-up bar, pulldown)
  E('pullup', 'Pull-up', 'pull_v', 'compound', { aka: ['pull-ups', 'pull ups', 'pullups', 'pull up'], primary: ['lats', 'biceps'], secondary: ['upper_back', 'delt_rear', 'forearms', 'abs'], needs: ['pullup_bar'], level: 3, avoid: ['hanging', 'overhead'], tags: ['anchor'], prev: 'pullup_jumping', cue: 'Start from a straight-arm hang, pull your chest toward the bar leading with the elbows, lower under control.' }),
  E('pullup_wide', 'Wide-grip pull-up', 'pull_v', 'compound', { primary: ['lats'], secondary: ['biceps', 'upper_back', 'forearms'], needs: ['pullup_bar'], level: 3, avoid: ['hanging', 'overhead'], cue: 'Hands wider than the shoulders; think of pulling the elbows down to your ribs.' }),
  E('pullup_narrow', 'Narrow-grip pull-up', 'pull_v', 'compound', { primary: ['lats', 'biceps'], secondary: ['upper_back', 'forearms'], needs: ['pullup_bar'], level: 3, avoid: ['hanging', 'overhead'], cue: 'Hands close together; more arm involvement.' }),
  E('pullup_neutral', 'Neutral-grip pull-up', 'pull_v', 'compound', { aka: ['hammer-grip pull-up'], primary: ['lats', 'biceps'], secondary: ['upper_back', 'forearms'], needs: ['pullup_bar'], level: 3, avoid: ['hanging', 'overhead'], cue: 'Palms facing each other on the vertical handles: usually the friendliest grip for the shoulders.' }),
  E('chinup', 'Chin-up (underhand grip)', 'pull_v', 'compound', { aka: ['chin-ups', 'chin ups', 'chinups'], primary: ['lats', 'biceps'], secondary: ['upper_back', 'forearms'], needs: ['pullup_bar'], level: 2, avoid: ['hanging', 'overhead'], cue: 'Palms toward you, shoulder-width; the biceps help more than in a pull-up.' }),
  E('scap_pullup', 'Scapular pull-up', 'pull_v', 'accessory', { primary: ['upper_back', 'lats'], secondary: ['forearms'], needs: ['pullup_bar'], level: 1, avoid: ['hanging'], next: 'pullup_negative', cue: 'Hang with straight arms and only pull the shoulder blades down and together, lifting an inch.' }),
  E('pullup_negative', 'Pull-up negative (slow lowering)', 'pull_v', 'compound', { aka: ['negatives', 'negative pull-ups', 'pull-up negatives'], primary: ['lats', 'biceps'], secondary: ['upper_back', 'forearms'], needs: ['pullup_bar'], level: 2, avoid: ['hanging', 'overhead'], prev: 'scap_pullup', next: 'pullup_jumping', cue: 'Jump or step up to the top position, then lower yourself over 4-6 seconds.' }),
  E('pullup_jumping', 'Jumping pull-up with slow lowering', 'pull_v', 'compound', { aka: ['jumping pull-ups', 'jumping pullups'], primary: ['lats', 'biceps'], secondary: ['upper_back', 'forearms'], needs: ['pullup_bar'], level: 2, avoid: ['hanging'], prev: 'pullup_negative', next: 'pullup', cue: 'Use a small jump to help up, pull the rest yourself, and lower slowly.' }),
  E('pullup_hold', 'Pull-up isometric hold', 'pull_v', 'accessory', { aka: ['isometric hold', 'isometric pull-up hold'], metric: 'time', primary: ['lats', 'biceps'], secondary: ['upper_back', 'forearms'], needs: ['pullup_bar'], level: 2, avoid: ['hanging', 'overhead'], cue: 'Hold the position at the top, or halfway, or low; any point of the pull-up works.' }),
  E('dead_hang', 'Dead hang', 'pull_v', 'accessory', { aka: ['dead hangs', 'hang'], metric: 'time', primary: ['forearms'], secondary: ['lats', 'upper_back'], needs: ['pullup_bar'], avoid: ['hanging'], cue: 'Hang from straight arms with active (slightly pulled-down) shoulders.' }),
  E('lat_pulldown', 'Lat pulldown', 'pull_v', 'compound', { aka: ['pulldown', 'lat pull down', 'latziehen'], primary: ['lats'], secondary: ['biceps', 'upper_back', 'delt_rear', 'forearms'], needs: ['cable_station'], tags: ['anchor'], cue: 'Pull the bar to your upper chest, elbows down and back; do not lean far back.' }),
  E('lat_pulldown_narrow', 'Lat pulldown, narrow neutral grip', 'pull_v', 'compound', { primary: ['lats', 'biceps'], secondary: ['upper_back', 'forearms'], needs: ['cable_station'], cue: 'Close, neutral handles; pull to the chest.' }),
  E('straight_arm_pulldown', 'Straight-arm pulldown', 'pull_v', 'accessory', { primary: ['lats'], secondary: ['abs', 'triceps'], needs: ['cable_station'], cue: 'Arms nearly straight, sweep the bar down to your thighs, keep the ribs down.' }),

  // ------------------------------------------------------------ rowing
  E('seated_cable_row', 'Seated cable row', 'pull_h', 'compound', { aka: ['seated row', 'cable row', 'rowing'], primary: ['upper_back', 'lats'], secondary: ['biceps', 'delt_rear', 'forearms', 'lower_back'], needs: ['cable_station'], tags: ['anchor'], cue: 'Tall chest, pull the handle to your lower ribs, squeeze the shoulder blades, return slowly.' }),
  E('close_grip_row', 'Close-grip seated cable row', 'pull_h', 'compound', { primary: ['lats', 'upper_back'], secondary: ['biceps', 'forearms'], needs: ['cable_station'], cue: 'Narrow neutral handle, elbows brush your sides.' }),
  E('wide_row', 'Wide-grip cable row', 'pull_h', 'compound', { primary: ['upper_back', 'delt_rear'], secondary: ['lats', 'biceps', 'traps'], needs: ['cable_station'], cue: 'Wide grip, elbows flared, pull to the chest.' }),
  E('standing_cable_row', 'Standing cable row', 'pull_h', 'compound', { primary: ['upper_back', 'lats'], secondary: ['biceps', 'abs', 'glutes'], needs: ['cable_station'], cue: 'Stand tall and braced; the legs and trunk resist the pull.' }),
  E('one_arm_cable_row', 'One-arm cable row', 'pull_h', 'compound', { primary: ['lats', 'upper_back'], secondary: ['biceps', 'obliques', 'forearms'], needs: ['cable_station'], unilateral: true, cue: 'Do not let the cable twist you; pull the elbow past the ribs.' }),
  E('db_row_one_arm', 'One-arm dumbbell row', 'pull_h', 'compound', { aka: ['dumbbell row', 'one arm row', 'single arm row'], primary: ['lats', 'upper_back'], secondary: ['biceps', 'delt_rear', 'forearms'], needs: ['dumbbell'], unilateral: true, cue: 'Hand and knee on a bench or chair, flat back, pull the dumbbell to your hip.' }),
  E('db_row_bent', 'Bent-over dumbbell row', 'pull_h', 'compound', { primary: ['upper_back', 'lats'], secondary: ['biceps', 'delt_rear', 'lower_back', 'hamstrings'], needs: ['dumbbell'], avoid: ['lowback'], level: 2, cue: 'Hinge forward with a flat back, row both dumbbells to the ribs.' }),

  // ------------------------------------------------------------ rear shoulders and upper back
  E('reverse_fly_machine', 'Reverse butterfly (rear-delt machine)', 'rear', 'accessory', { aka: ['reverse butterfly', 'reverse fly', 'reverse flys', 'rear delt fly', 'rear delts'], primary: ['delt_rear'], secondary: ['upper_back', 'traps'], needs: ['cable_station'], tags: ['anchor'], cue: 'Arms wide and slightly bent, lead with the elbows, no shrugging.' }),
  E('cable_rear_delt_fly', 'Cable rear-delt fly', 'rear', 'accessory', { primary: ['delt_rear'], secondary: ['upper_back'], needs: ['cable_station'], unilateral: true, cue: 'Cross the cables or use one at a time; sweep the arm back at shoulder height.' }),
  E('face_pull', 'Face pull (front pull)', 'rear', 'accessory', { aka: ['front pull', 'face pulls', 'front pulls'], primary: ['delt_rear', 'upper_back'], secondary: ['traps', 'biceps'], needs: ['cable_station'], cue: 'Pull the handles toward your face, elbows high and wide, hands finish beside the ears.' }),
  E('db_rear_delt_raise', 'Dumbbell rear-delt raise', 'rear', 'accessory', { aka: ['rear delt raise', 'rear-delt raise', 'bent-over lateral raise', 'reverse flyes'], primary: ['delt_rear'], secondary: ['upper_back', 'traps'], needs: ['dumbbell'], cue: 'Hinge forward, raise the dumbbells out to the sides with soft elbows.' }),
  E('db_rear_delt_row', 'Dumbbell rear-delt row', 'rear', 'accessory', { primary: ['delt_rear', 'upper_back'], secondary: ['traps', 'biceps'], needs: ['dumbbell'], cue: 'A row with the elbows flared out at shoulder height.' }),
  E('band_pull_apart', 'Band pull-apart', 'rear', 'accessory', { aka: ['pull-aparts', 'pull aparts'], primary: ['delt_rear', 'upper_back'], secondary: ['traps'], needs: ['band_loop'], tags: ['warmup'], cue: 'Hold the loop in front of you at chest height and pull it apart by squeezing the shoulder blades.' }),
  E('prone_ytw', 'Prone Y-T-W raise', 'rear', 'accessory', { aka: ['y t w raise', 'prone raises', 'prone y raise', 'ytw'], primary: ['delt_rear', 'upper_back'], secondary: ['traps', 'lower_back'], tags: ['warmup'], cue: 'Face down, lift the arms off the floor in a Y, then a T, then a W; small, slow, thumbs up.' }),
  E('shrug_db', 'Dumbbell shrug', 'rear', 'accessory', { aka: ['shrugs', 'shoulder shrugs'], primary: ['traps'], secondary: ['forearms'], needs: ['dumbbell'], cue: 'Lift the shoulders straight up toward the ears, pause, lower slowly.' }),
  E('shrug_cable', 'Cable shrug', 'rear', 'accessory', { primary: ['traps'], secondary: ['forearms'], needs: ['cable_station'], cue: 'As the dumbbell shrug, with steady cable tension.' }),

  // ------------------------------------------------------------ pressing forward
  E('bench_press', 'Bench press (station)', 'push_h', 'compound', { aka: ['bench press', 'chest press'], primary: ['chest', 'triceps'], secondary: ['delt_front'], needs: ['cable_station'], tags: ['anchor'], cue: 'Shoulder blades pinched, feet planted, press smoothly and lower to the chest under control.' }),
  E('db_bench_press', 'Dumbbell bench press', 'push_h', 'compound', { aka: ['dumbbell press', 'db bench'], primary: ['chest', 'triceps'], secondary: ['delt_front'], needs: ['dumbbell', 'bench'], cue: 'Elbows about 45-60 degrees from the body, lower to chest level, press up and slightly together.' }),
  E('db_floor_press', 'Dumbbell floor press', 'push_h', 'compound', { primary: ['chest', 'triceps'], secondary: ['delt_front'], needs: ['dumbbell'], cue: 'Lying on the floor, lower until the upper arms touch the floor, press up.' }),
  E('pushup', 'Push-up', 'push_h', 'compound', { aka: ['push-ups', 'push ups', 'pushups'], primary: ['chest', 'triceps'], secondary: ['delt_front', 'abs'], avoid: ['wrist'], cue: 'Body in one line like a moving plank; chest to the floor, elbows about 45 degrees.' }),
  E('pushup_close', 'Close-grip push-up', 'push_h', 'compound', { primary: ['triceps', 'chest'], secondary: ['delt_front', 'abs'], avoid: ['wrist'], level: 2, cue: 'Hands under the shoulders or closer, elbows brushing the ribs.' }),
  E('pushup_feet_up', 'Feet-elevated push-up', 'push_h', 'compound', { primary: ['chest', 'delt_front'], secondary: ['triceps', 'abs'], avoid: ['wrist'], level: 2, cue: 'Feet on a step or chair; more load on the upper chest and shoulders.' }),
  E('pushup_slow', 'Slow-lowering push-up', 'push_h', 'compound', { primary: ['chest', 'triceps'], secondary: ['delt_front', 'abs'], avoid: ['wrist'], level: 2, cue: 'Take 3-4 seconds to lower, press up at normal speed.' }),
  E('cable_chest_press', 'Cable chest press', 'push_h', 'compound', { primary: ['chest', 'triceps'], secondary: ['delt_front', 'abs'], needs: ['cable_station'], unilateral: true, cue: 'Cables set at chest height, stagger the stance, press forward without twisting.' }),
  E('butterfly', 'Butterfly (chest fly machine)', 'push_h', 'accessory', { aka: ['pec deck', 'chest fly machine', 'butterflies'], primary: ['chest'], secondary: ['delt_front'], needs: ['cable_station'], cue: 'Soft elbows, bring the arms together in an arc, stretch gently on the way back.' }),
  E('cable_fly', 'Cable fly', 'push_h', 'accessory', { aka: ['cable flies', 'cable flys'], primary: ['chest'], secondary: ['delt_front'], needs: ['cable_station'], cue: 'Pulleys at different heights change which part of the chest works; hug a big tree.' }),
  E('db_fly', 'Dumbbell fly', 'push_h', 'accessory', { aka: ['dumbbell flies', 'dumbbell fly variations'], primary: ['chest'], secondary: ['delt_front'], needs: ['dumbbell', 'bench'], cue: 'Soft elbows, open the arms in an arc until you feel a stretch, close by squeezing the chest.' }),

  // ------------------------------------------------------------ pressing overhead and shoulder raises
  E('db_shoulder_press', 'Dumbbell shoulder press', 'push_v', 'compound', { aka: ['shoulder press', 'overhead press', 'dumbbell overhead press'], primary: ['delt_front', 'delt_side', 'triceps'], secondary: ['traps', 'abs'], needs: ['dumbbell'], level: 2, avoid: ['overhead'], cue: 'Ribs down, press straight up past the ears, do not arch the back.' }),
  E('arnold_press', 'Arnold press', 'push_v', 'compound', { primary: ['delt_front', 'delt_side', 'triceps'], secondary: ['traps'], needs: ['dumbbell'], level: 2, avoid: ['overhead'], cue: 'Start with palms facing you and rotate them outward as you press.' }),
  E('pike_pushup', 'Pike push-up', 'push_v', 'compound', { primary: ['delt_front', 'triceps'], secondary: ['delt_side', 'chest'], level: 2, avoid: ['overhead', 'wrist'], cue: 'Hips high in an upside-down V, lower the head toward the floor between the hands.' }),
  E('db_lateral_raise', 'Dumbbell lateral raise', 'shoulder_iso', 'accessory', { aka: ['lateral raise', 'lateral raises', 'side raise', 'side raises', 'arm abduction'], primary: ['delt_side'], secondary: ['traps'], needs: ['dumbbell'], tags: ['anchor'], cue: 'Raise the arms out to the sides to shoulder height with a soft bend, lead with the elbows, lower slowly.' }),
  E('cable_lateral_raise', 'Cable lateral raise', 'shoulder_iso', 'accessory', { primary: ['delt_side'], secondary: ['traps'], needs: ['cable_station'], unilateral: true, cue: 'Constant tension from the low pulley; raise to shoulder height.' }),
  E('db_front_raise', 'Dumbbell front raise', 'shoulder_iso', 'accessory', { aka: ['front raises'], primary: ['delt_front'], secondary: ['chest'], needs: ['dumbbell'], cue: 'Raise to eye level with straight-ish arms, no swinging.' }),
  E('cable_front_raise', 'Cable front raise', 'shoulder_iso', 'accessory', { primary: ['delt_front'], secondary: ['chest'], needs: ['cable_station'], cue: 'Raise to shoulder height from the low pulley.' }),
  E('cable_upright_row', 'Cable upright row', 'shoulder_iso', 'accessory', { primary: ['delt_side', 'traps'], secondary: ['biceps', 'delt_front'], needs: ['cable_station'], avoid: ['overhead'], level: 2, cue: 'Pull the handle up the front of the body to the chest, elbows leading, no higher than shoulder height.' }),

  // ------------------------------------------------------------ arms
  E('db_curl', 'Dumbbell curl', 'arms', 'accessory', { aka: ['biceps curl', 'bicep curl', 'alternating curls', 'dumbbell curls'], primary: ['biceps'], secondary: ['forearms'], needs: ['dumbbell'], cue: 'Elbows by your sides, curl up, lower for two seconds.' }),
  E('hammer_curl', 'Hammer curl', 'arms', 'accessory', { aka: ['hammer curls'], primary: ['biceps', 'forearms'], needs: ['dumbbell'], cue: 'Palms facing each other throughout.' }),
  E('concentration_curl', 'Concentration curl', 'arms', 'accessory', { primary: ['biceps'], needs: ['dumbbell'], unilateral: true, cue: 'Elbow braced against the inner thigh, slow strict curl.' }),
  E('preacher_curl', 'Preacher curl (station pad)', 'arms', 'accessory', { aka: ['preacher curls'], primary: ['biceps'], secondary: ['forearms'], needs: ['cable_station'], cue: 'Upper arms flat on the pad, full range, no swinging.' }),
  E('cable_curl', 'Standing cable curl', 'arms', 'accessory', { aka: ['cable curl', 'cable biceps curl', 'curl bar curl'], primary: ['biceps'], secondary: ['forearms'], needs: ['cable_station'], cue: 'Curl bar or handles from the low pulley; elbows pinned.' }),
  E('cable_curl_one_arm', 'One-arm cable curl', 'arms', 'accessory', { primary: ['biceps'], secondary: ['forearms'], needs: ['cable_station'], unilateral: true, cue: 'Strict single-arm curls from the low pulley.' }),
  E('chair_dip', 'Chair dip', 'arms', 'accessory', { aka: ['bench dip', 'bench dips', 'chair dips', 'triceps dip'], primary: ['triceps'], secondary: ['chest', 'delt_front'], level: 2, avoid: ['wrist'], cue: 'Hands on a sturdy chair behind you, lower the elbows to about 90 degrees, press up; keep the hips close to the chair.' }),
  E('cable_pushdown', 'Cable triceps pushdown', 'arms', 'accessory', { aka: ['triceps extension', 'triceps extensions', 'pushdown', 'tricep pushdown'], primary: ['triceps'], needs: ['cable_station'], cue: 'Elbows pinned to the sides, press down until the arms are straight, control the way up.' }),
  E('cable_overhead_tri_ext', 'Cable overhead triceps extension', 'arms', 'accessory', { primary: ['triceps'], secondary: ['abs'], needs: ['cable_station'], avoid: ['overhead'], cue: 'Face away from the pulley, elbows by the ears, extend the arms forward.' }),
  E('overhead_tri_ext_db', 'Overhead dumbbell triceps extension', 'arms', 'accessory', { aka: ['overhead triceps extension'], primary: ['triceps'], needs: ['dumbbell'], avoid: ['overhead'], cue: 'Hold one dumbbell with both hands behind the head, extend upward, elbows close.' }),
  E('db_kickback', 'Dumbbell triceps kickback', 'arms', 'accessory', { aka: ['kickbacks', 'triceps kickbacks'], primary: ['triceps'], needs: ['dumbbell'], unilateral: true, cue: 'Upper arm parallel to the floor, straighten the elbow, pause.' }),
  E('cable_kickback', 'Cable triceps kickback', 'arms', 'accessory', { primary: ['triceps'], needs: ['cable_station'], unilateral: true, cue: 'Same as the dumbbell kickback with steady tension.' }),

  // ------------------------------------------------------------ squatting and lunging (the pistol-squat ladder is here)
  E('squat_bodyweight', 'Bodyweight squat', 'squat', 'compound', { aka: ['air squat', 'squats', 'squat'], primary: ['quads', 'glutes'], secondary: ['hamstrings', 'adductors', 'abs'], avoid: ['knee'], cue: 'Feet shoulder-width, sit between the hips, knees track over the toes, chest up.' }),
  E('goblet_squat', 'Goblet squat', 'squat', 'compound', { aka: ['goblet squats', 'dumbbell goblet squat'], primary: ['quads', 'glutes'], secondary: ['abs', 'adductors', 'hamstrings'], needs: ['dumbbell'], avoid: ['knee'], tags: ['anchor'], cue: 'Hold one dumbbell at your chest, elbows inside the knees at the bottom, stand tall.' }),
  E('db_squat', 'Dumbbell squat', 'squat', 'compound', { aka: ['dumbbell squats'], primary: ['quads', 'glutes'], secondary: ['hamstrings', 'adductors', 'abs'], needs: ['dumbbell'], avoid: ['knee'], cue: 'Dumbbells at your sides or on the shoulders; same form as the bodyweight squat.' }),
  E('squat_touchdown', 'Single-leg touch-down squat', 'squat', 'compound', { aka: ['touch-down squat', 'touch down squat', 'touch-down squats', 'touchdown squat', 'touch down squats'], primary: ['quads', 'glutes'], secondary: ['glute_med', 'hamstrings', 'abs'], unilateral: true, level: 2, avoid: ['knee'], tags: ['running', 'pistol'], next: 'pistol_box', cue: 'On one leg, lower until the other heel or fingertips lightly touch the floor, stand up without pushing off it.' }),
  E('pistol_box', 'Box pistol squat (sit to a box on one leg)', 'squat', 'compound', { aka: ['box-assisted pistol squat', 'box pistol', 'box-assisted pistol squats', 'box assisted pistol'], primary: ['quads', 'glutes'], secondary: ['glute_med', 'hamstrings', 'abs'], unilateral: true, level: 2, avoid: ['knee'], tags: ['running', 'pistol'], prev: 'squat_touchdown', next: 'pistol_assisted', cue: 'Sit down onto a box or chair on one leg, free leg forward, and stand up; lower the box over the weeks.' }),
  E('pistol_assisted', 'Assisted pistol squat', 'squat', 'compound', { aka: ['assisted pistols', 'assisted pistol'], primary: ['quads', 'glutes'], secondary: ['glute_med', 'hamstrings', 'abs'], unilateral: true, level: 3, avoid: ['knee'], tags: ['running', 'pistol'], prev: 'pistol_box', next: 'pistol_eccentric', cue: 'Hold a door frame, pole or band for balance and use it as little as you can.' }),
  E('pistol_eccentric', 'Slow-lowering pistol squat (eccentric)', 'squat', 'compound', { aka: ['slow eccentric pistols', 'eccentric pistol', 'eccentric pistols'], primary: ['quads', 'glutes'], secondary: ['glute_med', 'hamstrings', 'abs'], unilateral: true, level: 3, avoid: ['knee'], tags: ['running', 'pistol'], prev: 'pistol_assisted', next: 'pistol', cue: 'Lower all the way on one leg over 4-5 seconds, then use two legs (or help) to stand.' }),
  E('pistol', 'Pistol squat', 'squat', 'compound', { aka: ['pistol squats', 'single-leg squat', 'single leg squat', 'pistols'], primary: ['quads', 'glutes'], secondary: ['glute_med', 'hamstrings', 'abs', 'calves'], unilateral: true, level: 3, avoid: ['knee'], tags: ['running', 'pistol', 'anchor'], prev: 'pistol_eccentric', cue: 'Full single-leg squat with the free leg held out in front.' }),
  E('bulgarian_split_squat', 'Bulgarian split squat', 'squat', 'compound', { aka: ['bulgarian', 'split squat', 'bulgarian split squats'], primary: ['quads', 'glutes'], secondary: ['glute_med', 'hamstrings', 'adductors'], loads: ['dumbbell'], unilateral: true, level: 2, avoid: ['knee'], tags: ['running', 'anchor'], cue: 'Rear foot on a bench or chair, front foot far enough forward, drop straight down.' }),
  E('lunge', 'Forward lunge', 'squat', 'compound', { aka: ['lunges'], primary: ['quads', 'glutes'], secondary: ['hamstrings', 'glute_med'], loads: ['dumbbell'], unilateral: true, avoid: ['knee'], cue: 'Step forward, lower the back knee toward the floor, push back to standing.' }),
  E('reverse_lunge', 'Reverse lunge', 'squat', 'compound', { aka: ['reverse lunges'], primary: ['quads', 'glutes'], secondary: ['hamstrings', 'glute_med'], loads: ['dumbbell'], unilateral: true, tags: ['running'], cue: 'Step back, drop the back knee, drive through the front heel; kinder to the knee than a forward lunge.' }),
  E('step_up', 'Step-up', 'squat', 'compound', { aka: ['step-ups', 'step ups'], primary: ['quads', 'glutes'], secondary: ['glute_med', 'hamstrings', 'calves'], loads: ['dumbbell'], unilateral: true, tags: ['running'], cue: 'Whole foot on a sturdy step, stand up using the top leg only, lower slowly.' }),
  E('wall_sit', 'Wall sit', 'squat', 'accessory', { metric: 'time', primary: ['quads'], secondary: ['glutes'], avoid: ['knee'], cue: 'Back against the wall, thighs parallel to the floor, hold.' }),
  E('banded_squat', 'Banded squat', 'squat', 'accessory', { aka: ['banded squats'], primary: ['quads', 'glutes'], secondary: ['glute_med'], needs: ['band_loop'], avoid: ['knee'], tags: ['running'], cue: 'Loop above the knees, push the knees out against it as you squat.' }),
  E('banded_split_squat', 'Banded split squat', 'squat', 'accessory', { primary: ['quads', 'glutes'], secondary: ['glute_med'], needs: ['band_loop'], unilateral: true, avoid: ['knee'], cue: 'Loop above the knees, keep the front knee from caving in.' }),
  E('banded_lunge', 'Banded lunge', 'squat', 'accessory', { primary: ['quads', 'glutes'], secondary: ['glute_med'], needs: ['band_loop'], unilateral: true, avoid: ['knee'], cue: 'Loop above the knees while lunging.' }),
  E('leg_extension', 'Leg extension (station)', 'knee_iso', 'accessory', { aka: ['leg extensions', 'knee extension'], primary: ['quads'], needs: ['cable_station'], cue: 'Smooth full extension, pause, lower slowly.' }),

  // ------------------------------------------------------------ hinging and glutes
  E('db_rdl', 'Dumbbell Romanian deadlift', 'hinge', 'compound', { aka: ['romanian deadlift', 'rdl', 'romanian deadlifts'], primary: ['hamstrings', 'glutes'], secondary: ['lower_back', 'forearms'], needs: ['dumbbell'], level: 2, avoid: ['lowback'], tags: ['anchor'], cue: 'Soft knees, push the hips back with a flat back until the hamstrings stretch, stand by driving the hips forward.' }),
  E('single_leg_rdl', 'Single-leg deadlift', 'hinge', 'compound', { aka: ['single leg deadlift', 'single-leg deadlifts', 'single leg rdl', 'single-leg rdl', 'single-leg romanian deadlift', 'single leg deadlifts'], primary: ['hamstrings', 'glutes', 'glute_med'], secondary: ['lower_back', 'abs', 'calves'], loads: ['dumbbell'], unilateral: true, level: 2, avoid: ['lowback'], tags: ['running', 'anchor'], cue: 'Hinge on one leg, the other reaching back like a see-saw, hips square to the floor; touch a wall for balance if needed.' }),
  E('split_stance_rdl', 'Split-stance hinge (staggered RDL)', 'hinge', 'compound', { aka: ['split-stance hinge', 'split stance hinges', 'staggered rdl'], primary: ['hamstrings', 'glutes'], secondary: ['lower_back'], loads: ['dumbbell'], unilateral: true, avoid: ['lowback'], tags: ['running'], cue: 'Back foot light on the toes as a kickstand; most of the load on the front leg.' }),
  E('glute_bridge', 'Glute bridge', 'hinge', 'accessory', { aka: ['glute bridges', 'hip bridge'], primary: ['glutes'], secondary: ['hamstrings', 'abs'], loads: ['dumbbell'], tags: ['running'], cue: 'Heels close, drive the hips up, squeeze the glutes at the top without arching the back.' }),
  E('single_leg_glute_bridge', 'Single-leg glute bridge', 'hinge', 'accessory', { aka: ['single leg glute bridge', 'single-leg glute bridges'], primary: ['glutes', 'glute_med'], secondary: ['hamstrings', 'abs'], unilateral: true, level: 2, tags: ['running'], cue: 'One foot planted, other leg straight; keep the pelvis level.' }),
  E('hip_thrust', 'Hip thrust', 'hinge', 'compound', { aka: ['hip thrusts', 'dumbbell hip thrust'], primary: ['glutes'], secondary: ['hamstrings', 'adductors'], loads: ['dumbbell'], level: 2, cue: 'Upper back on a bench or sofa, dumbbell across the hips, drive up to a flat body line.' }),
  E('banded_glute_bridge', 'Banded glute bridge', 'hinge', 'accessory', { primary: ['glutes', 'glute_med'], secondary: ['hamstrings'], needs: ['band_loop'], tags: ['running'], cue: 'Loop above the knees, push the knees out while bridging.' }),
  E('banded_hip_thrust', 'Banded hip thrust', 'hinge', 'accessory', { primary: ['glutes', 'glute_med'], secondary: ['hamstrings'], needs: ['band_loop'], level: 2, cue: 'Hip thrust with a loop above the knees.' }),
  E('leg_curl', 'Leg curl (station)', 'knee_iso', 'accessory', { aka: ['leg curls', 'leg flexion'], primary: ['hamstrings'], secondary: ['calves'], needs: ['cable_station'], cue: 'Curl smoothly, pause, lower in about three seconds.' }),
  E('cable_hip_extension', 'Cable hip extension (ankle strap)', 'hinge', 'accessory', { aka: ['hip extension', 'cable kickback glute', 'glute kickback'], primary: ['glutes'], secondary: ['hamstrings', 'lower_back'], needs: ['cable_station'], unilateral: true, cue: 'Strap on the ankle, hold on, push the leg straight back without arching the lower back.' }),
  E('cable_pull_through', 'Cable pull-through', 'hinge', 'compound', { primary: ['glutes', 'hamstrings'], secondary: ['lower_back'], needs: ['cable_station'], level: 2, avoid: ['lowback'], cue: 'Face away from the low pulley, handle between the legs, hinge back and snap the hips forward.' }),

  // ------------------------------------------------------------ hip and pelvis stability (running)
  E('hip_hike', 'Hip hike (pelvic hike)', 'hip_stab', 'stability', { aka: ['hip hikes', 'pelvic hike', 'pelvic hikes', 'hip hikes / pelvic hikes'], primary: ['glute_med'], secondary: ['obliques', 'lower_back'], unilateral: true, tags: ['running', 'anchor'], cue: 'Stand with one foot on a step edge, the other leg hanging; lower the free hip, then lift it using the standing-side hip, knee straight.' }),
  E('clamshell', 'Clamshell', 'hip_stab', 'stability', { aka: ['clamshells'], primary: ['glute_med'], secondary: ['glutes'], unilateral: true, tags: ['running'], cue: 'On your side, knees bent, feet together; open the top knee without rolling the pelvis back.' }),
  E('clamshell_band', 'Banded clamshell', 'hip_stab', 'stability', { primary: ['glute_med'], secondary: ['glutes'], needs: ['band_loop'], unilateral: true, tags: ['running'], cue: 'Loop above the knees; open against it slowly.' }),
  E('side_leg_raise', 'Side-lying leg raise (hip abduction)', 'hip_stab', 'stability', { aka: ['side leg raise', 'hip abduction floor'], primary: ['glute_med'], secondary: ['glutes'], unilateral: true, tags: ['running'], cue: 'Lie on your side, lift the top leg a little backward of straight, toes level or slightly down.' }),
  E('lateral_walk', 'Banded lateral walk', 'hip_stab', 'stability', { aka: ['lateral band walk', 'banded lateral walks', 'lateral walks', 'side steps'], primary: ['glute_med'], secondary: ['glutes', 'adductors'], needs: ['band_loop'], tags: ['running'], cue: 'Loop above the knees or at the ankles, slight squat, step sideways keeping tension.' }),
  E('monster_walk', 'Monster walk', 'hip_stab', 'stability', { aka: ['monster walks'], primary: ['glute_med', 'glutes'], secondary: ['quads'], needs: ['band_loop'], tags: ['running'], cue: 'Loop at the ankles or above the knees, walk forward and back with wide steps.' }),
  E('cable_hip_abduction', 'Hip abduction (station)', 'hip_stab', 'accessory', { aka: ['hip abduction', 'cable hip abduction'], primary: ['glute_med'], secondary: ['glutes'], needs: ['cable_station'], unilateral: true, tags: ['running'], cue: 'Ankle strap, stand tall holding on, lift the leg out to the side without leaning.' }),
  E('cable_hip_adduction', 'Hip adduction (station)', 'hip_stab', 'accessory', { aka: ['hip adduction', 'cable hip adduction'], primary: ['adductors'], needs: ['cable_station'], unilateral: true, cue: 'Ankle strap, bring the leg across the body in front of the standing leg.' }),
  E('hip_er_band', 'Banded hip external rotation', 'hip_stab', 'stability', { aka: ['hip external rotation'], primary: ['glute_med', 'glutes'], needs: ['band_loop'], unilateral: true, cue: 'Seated or lying, rotate the thigh outward against the loop.' }),
  E('hip_ir_band', 'Banded hip internal rotation', 'hip_stab', 'stability', { aka: ['hip internal rotation'], primary: ['glute_med', 'adductors'], needs: ['band_loop'], unilateral: true, cue: 'Rotate the thigh inward against the loop, slowly.' }),
  E('fire_hydrant', 'Fire hydrant', 'hip_stab', 'stability', { primary: ['glute_med'], secondary: ['glutes'], unilateral: true, cue: 'On hands and knees, lift one knee out to the side keeping the back still.' }),
  E('single_leg_balance', 'Single-leg balance', 'hip_stab', 'stability', { metric: 'time', primary: ['glute_med'], secondary: ['calves', 'abs'], unilateral: true, tags: ['running'], cue: 'Stand on one leg, pelvis level; progress to eyes closed or a soft surface.' }),

  // ------------------------------------------------------------ calves
  E('calf_raise', 'Calf raise', 'calf', 'accessory', { aka: ['calf raises', 'weighted calf raises'], primary: ['calves'], loads: ['dumbbell'], tags: ['running', 'anchor'], cue: 'Rise on the balls of the feet, pause at the top, lower slowly through the full range.' }),
  E('single_leg_calf_raise', 'Single-leg calf raise', 'calf', 'accessory', { aka: ['single leg calf raise', 'single-leg calf raises'], primary: ['calves'], loads: ['dumbbell'], unilateral: true, level: 2, tags: ['running'], cue: 'The same on one leg, holding a wall for balance only.' }),

  // ------------------------------------------------------------ core
  E('plank', 'Plank', 'core', 'core', { aka: ['planks', 'forearm plank'], metric: 'time', primary: ['abs'], secondary: ['obliques', 'lower_back', 'delt_front', 'glutes'], tags: ['running', 'anti-extension', 'anchor'], cue: 'Forearms under the shoulders, a straight line from head to heels, ribs down, glutes tight.' }),
  E('side_plank', 'Side plank', 'core', 'core', { aka: ['side planks'], metric: 'time', primary: ['obliques', 'glute_med'], secondary: ['abs', 'delt_side'], unilateral: true, tags: ['running', 'anti-lateral', 'anchor'], cue: 'On one forearm, lift the hips into a straight line, top leg stacked or in front for balance.' }),
  E('copenhagen_plank', 'Copenhagen plank', 'core', 'core', { aka: ['copenhagen'], metric: 'time', primary: ['adductors', 'obliques'], secondary: ['abs', 'glute_med'], unilateral: true, level: 3, tags: ['running', 'anti-lateral'], cue: 'Top leg on a bench or chair, side plank with the lower leg lifted; start with the knee on the support.' }),
  E('bird_dog', 'Bird dog', 'core', 'core', { aka: ['bird dogs', 'bird-dog'], primary: ['lower_back', 'abs'], secondary: ['glutes', 'delt_front'], unilateral: true, tags: ['running', 'anti-rotation', 'anchor'], cue: 'From hands and knees, reach the opposite arm and leg out without rotating or arching.' }),
  E('dead_bug', 'Dead bug', 'core', 'core', { aka: ['dead bugs'], primary: ['abs'], secondary: ['obliques', 'hip_flexors'], unilateral: true, tags: ['running', 'anti-extension'], cue: 'On your back, lower the opposite arm and leg while the lower back stays pressed down.' }),
  E('superman', 'Superman', 'core', 'core', { aka: ['supermans', 'back extension', 'prone back raise'], primary: ['lower_back'], secondary: ['glutes', 'delt_rear'], tags: ['running'], cue: 'Face down, lift arms and legs a little off the floor, hold briefly, lower slowly.' }),
  E('leg_raise', 'Lying leg raise', 'core', 'core', { aka: ['leg raises', 'leg raise'], primary: ['abs', 'hip_flexors'], level: 2, cue: 'Lower back stays down; lower the legs only as far as you can control.' }),
  E('crunch', 'Crunch', 'core', 'core', { aka: ['crunches'], primary: ['abs'], cue: 'Curl the ribs toward the pelvis; do not pull on the neck.' }),
  E('hollow_hold', 'Hollow hold', 'core', 'core', { metric: 'time', primary: ['abs'], secondary: ['hip_flexors'], level: 2, tags: ['anti-extension'], cue: 'Lower back pressed down, arms and legs reaching away; bend the knees to make it easier.' }),
  E('hanging_knee_raise', 'Hanging knee raise', 'core', 'core', { aka: ['hanging knee raises'], primary: ['abs', 'hip_flexors'], secondary: ['forearms', 'lats'], needs: ['pullup_bar'], level: 2, avoid: ['hanging'], next: 'hanging_leg_raise', cue: 'Hang from the bar, tuck the knees to the chest without swinging.' }),
  E('hanging_leg_raise', 'Hanging leg raise', 'core', 'core', { aka: ['hanging leg raises'], primary: ['abs', 'hip_flexors'], secondary: ['forearms', 'lats'], needs: ['pullup_bar'], level: 3, avoid: ['hanging'], prev: 'hanging_knee_raise', cue: 'Straight legs up toward the bar with control.' }),
  E('cable_crunch_standing', 'Standing cable crunch', 'core', 'core', { aka: ['cable crunch', 'standing cable crunches'], primary: ['abs'], secondary: ['obliques'], needs: ['cable_station'], cue: 'Hinge at the ribs, not the hips; pull the elbows toward the knees.' }),
  E('seated_crunch_station', 'Seated crunch (station)', 'core', 'core', { aka: ['seated crunches', 'seated crunch'], primary: ['abs'], needs: ['cable_station'], cue: 'Curl forward through the trunk, return slowly.' }),
  E('cable_oblique_crunch', 'Diagonal cable crunch (oblique)', 'core', 'core', { aka: ['oblique crunch', 'standing diagonal crunch', 'diagonal cable crunches'], primary: ['obliques'], secondary: ['abs'], needs: ['cable_station'], unilateral: true, cue: 'Crunch diagonally toward the opposite hip.' }),
  E('seated_oblique_crunch', 'Seated oblique crunch (station)', 'core', 'core', { aka: ['seated oblique crunches'], primary: ['obliques'], secondary: ['abs'], needs: ['cable_station'], unilateral: true, cue: 'Seated, crunch to one side with control.' }),
  E('cable_side_bend', 'Cable side bend', 'core', 'core', { aka: ['side bends', 'side bend'], primary: ['obliques'], secondary: ['lower_back'], needs: ['cable_station'], unilateral: true, cue: 'Bend sideways against the cable and return; do not twist.' }),
  E('db_side_bend', 'Dumbbell side bend', 'core', 'core', { primary: ['obliques'], secondary: ['lower_back'], needs: ['dumbbell'], unilateral: true, cue: 'One dumbbell, bend sideways in the same plane, no twisting.' }),
  E('cable_trunk_rotation', 'Cable trunk rotation', 'core', 'core', { aka: ['trunk rotation', 'woodchop', 'cable rotation'], primary: ['obliques'], secondary: ['abs', 'glutes'], needs: ['cable_station'], unilateral: true, cue: 'Turn from the trunk with arms mostly straight, hips stay facing forward or pivot together.' }),
  E('pallof_press', 'Pallof press (anti-rotation)', 'core', 'core', { aka: ['pallof', 'pallof presses', 'anti-rotation press'], primary: ['obliques', 'abs'], secondary: ['glute_med', 'delt_front'], needs: ['cable_station'], unilateral: true, tags: ['running', 'anti-rotation'], cue: 'Stand side-on to the cable, press the handle away from the chest and resist being turned.' }),
  E('suitcase_carry', 'Suitcase carry', 'carry', 'core', { aka: ['suitcase carries'], metric: 'time', primary: ['obliques', 'forearms'], secondary: ['glute_med', 'traps', 'abs'], needs: ['dumbbell'], unilateral: true, tags: ['running', 'anti-lateral'], cue: 'One heavy dumbbell at your side, walk tall without leaning.' }),
  E('farmer_carry', 'Farmer carry', 'carry', 'core', { aka: ['farmer carries', 'farmers walk', 'weighted carry', 'weighted carries'], metric: 'time', primary: ['forearms', 'traps'], secondary: ['abs', 'obliques', 'glutes'], needs: ['dumbbell'], tags: ['running'], cue: 'A dumbbell in each hand, shoulders down, walk with short steady steps.' }),

  // ------------------------------------------------------------ balance, inversion, conditioning
  E('feetup_headstand', 'Supported headstand (inversion trainer)', 'skill', 'skill', { aka: ['headstand', 'feetup', 'supported headstand'], metric: 'time', primary: ['delt_front', 'abs'], secondary: ['upper_back', 'traps', 'triceps'], needs: ['feetup'], level: 2, avoid: ['overhead'], cue: 'Use the trainer as designed, weight on the shoulders and forearms, neck relaxed; come in and out slowly and stop if your neck, eyes or head hurt.' }),
  E('feetup_entry_exit', 'Headstand entry and exit practice', 'skill', 'skill', { aka: ['controlled entry', 'headstand entry'], primary: ['abs', 'delt_front'], secondary: ['upper_back', 'hip_flexors'], needs: ['feetup'], level: 2, avoid: ['overhead'], cue: 'Practise going up and coming down slowly and under control, a few calm repetitions.' }),
  E('burpee', 'Burpee', 'conditioning', 'conditioning', { aka: ['burpees'], primary: ['quads', 'chest'], secondary: ['abs', 'delt_front', 'triceps', 'glutes'], level: 2, avoid: ['impact', 'wrist'], tags: ['low-priority'], cue: 'A finisher, not a main exercise: squat down, kick back to a push-up, jump up.' }),
];

// ---------------------------------------------------------------- lookups

export const BUILT_IN = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

/** Built-in exercises plus the ones this person added. */
export function allExercises(custom = []) {
  return [...EXERCISES, ...custom.filter((c) => c && c.id && !BUILT_IN[c.id])];
}
export const indexExercises = (list) => Object.fromEntries(list.map((e) => [e.id, e]));

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Everything an exercise can be called, for matching what a person types. */
export const namesOf = (e) => [e.name, ...(e.aka ?? [])].map(norm).filter(Boolean);

/** Equipment the person has, as a set (bodyweight is always there). */
export const haveSet = (have = []) => new Set(['bodyweight', ...have]);

/** Can this exercise be done with this equipment? */
export const doable = (e, have) => (e.needs ?? []).every((n) => have.has(n));

/** Exercises that carry any of the flags the person wants to avoid. */
export const hasAvoided = (e, avoid = []) => (e.avoid ?? []).some((f) => avoid.includes(f));

/**
 * Search the catalogue. Every word must match the name, an alias, a muscle or the slot.
 * @param {object[]} list
 * @param {{q?:string, muscle?:string, equipment?:string, slot?:string, mine?:boolean, have?:Set<string>|null}} [f]
 */
export function searchExercises(list, { q = '', muscle = '', equipment = '', slot = '', mine = false, have = null } = {}) {
  const words = norm(q).split(' ').filter(Boolean);
  return list.filter((e) => {
    if (muscle && ![...e.primary, ...e.secondary].includes(muscle)) return false;
    if (equipment && !(equipment === 'bodyweight' ? (e.needs ?? []).length === 0 : (e.needs ?? []).includes(equipment))) return false;
    if (slot && e.slot !== slot) return false;
    if (mine && have && !doable(e, have)) return false;
    if (!words.length) return true;
    const hay = `${namesOf(e).join(' ')} ${[...e.primary, ...e.secondary].map((m) => MUSCLE_BY_ID[m]?.label ?? m).join(' ').toLowerCase()} ${SLOTS[e.slot]?.label?.toLowerCase() ?? ''} ${(e.tags ?? []).join(' ')}`;
    return words.every((w) => hay.includes(w));
  });
}

/** The progression ladder an exercise belongs to, easiest first (e.g. the pistol squat ladder). */
export function ladderOf(id, list = EXERCISES) {
  const by = indexExercises(list);
  let start = by[id];
  if (!start) return [];
  const seen = new Set();
  while (start.prev && by[start.prev] && !seen.has(start.id)) { seen.add(start.id); start = by[start.prev]; }
  const out = [], guard = new Set();
  for (let e = start; e && !guard.has(e.id); e = by[e.next]) { out.push(e); guard.add(e.id); }
  return out.length > 1 ? out : [];
}

/** What is wrong with an exercise definition (empty when it is fine). Used on the built-ins in tests and on custom ones when saving. */
export function problemsWith(e) {
  const out = [];
  if (!e.id || !/^[a-z0-9_]+$/.test(e.id)) out.push('id');
  if (!String(e.name ?? '').trim()) out.push('name');
  if (!SLOTS[e.slot]) out.push('slot');
  if (!(e.type in TYPE_ORDER)) out.push('type');
  if (!['reps', 'time'].includes(e.metric)) out.push('metric');
  if (!(e.primary ?? []).length) out.push('primary');
  for (const m of [...(e.primary ?? []), ...(e.secondary ?? [])]) if (!MUSCLE_BY_ID[m]) out.push(`muscle ${m}`);
  for (const q of [...(e.needs ?? []), ...(e.loads ?? [])]) if (!EQUIPMENT_BY_ID[q]) out.push(`equipment ${q}`);
  for (const f of e.avoid ?? []) if (!AVOID_FLAGS.some((a) => a.id === f)) out.push(`avoid ${f}`);
  if (!(e.level in { 1: 1, 2: 1, 3: 1 })) out.push('level');
  return out;
}

/** An exercise as the person typed it in the form, made safe and complete. */
export function customExercise(input, existingIds = new Set()) {
  const name = String(input.name ?? '').trim().slice(0, 80);
  let base = `my_${norm(name).replace(/ /g, '_').slice(0, 40) || 'exercise'}`;
  let id = input.id || base, n = 2;
  while (!input.id && (existingIds.has(id) || BUILT_IN[id])) id = `${base}_${n++}`;
  const e = E(id, name, input.slot in SLOTS ? input.slot : 'core', input.type in TYPE_ORDER ? input.type : 'accessory', {
    aka: [], primary: (input.primary ?? []).filter((m) => MUSCLE_BY_ID[m]), secondary: (input.secondary ?? []).filter((m) => MUSCLE_BY_ID[m]),
    needs: (input.needs ?? []).filter((q) => EQUIPMENT_BY_ID[q]), loads: [], level: [1, 2, 3].includes(Number(input.level)) ? Number(input.level) : 1,
    unilateral: !!input.unilateral, metric: input.metric === 'time' ? 'time' : 'reps', tags: ['custom'], avoid: (input.avoid ?? []).filter((f) => AVOID_FLAGS.some((a) => a.id === f)),
    cue: String(input.cue ?? '').trim().slice(0, 300), custom: true,
  });
  return e;
}

export { LEVEL_NUM };
