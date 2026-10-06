// The vocabulary of the strength section: muscles (each linked to the body areas the stretching side already uses),
// equipment, goals and the "avoid" flags. Kept apart from the exercises so both can be read and tested on their own.

/** Muscles worked in strength training. `area` is the body area of the stretching side, so one body map can show both. */
export const MUSCLES = [
  { id: 'chest', label: 'Chest', area: 'chest', group: 'push' },
  { id: 'delt_front', label: 'Front shoulders', area: 'shoulders', group: 'push' },
  { id: 'delt_side', label: 'Side shoulders', area: 'shoulders', group: 'push' },
  { id: 'triceps', label: 'Triceps', area: 'triceps', group: 'push' },
  { id: 'lats', label: 'Lats', area: 'lats', group: 'pull' },
  { id: 'upper_back', label: 'Upper back', area: 'upper_back', group: 'pull' },
  { id: 'delt_rear', label: 'Rear shoulders', area: 'shoulders', group: 'pull' },
  { id: 'traps', label: 'Traps', area: 'upper_traps', group: 'pull' },
  { id: 'biceps', label: 'Biceps', area: 'biceps', group: 'pull' },
  { id: 'forearms', label: 'Forearms & grip', area: 'wrists', group: 'pull' },
  { id: 'abs', label: 'Abs', area: 'core', group: 'core' },
  { id: 'obliques', label: 'Obliques', area: 'obliques', group: 'core' },
  { id: 'lower_back', label: 'Lower back', area: 'lower_back', group: 'core' },
  { id: 'glutes', label: 'Glutes', area: 'glutes', group: 'legs' },
  { id: 'glute_med', label: 'Hip stabilisers (glute medius)', area: 'outer_hip', group: 'legs' },
  { id: 'quads', label: 'Quads', area: 'quads', group: 'legs' },
  { id: 'hamstrings', label: 'Hamstrings', area: 'hamstrings', group: 'legs' },
  { id: 'adductors', label: 'Inner thighs', area: 'adductors', group: 'legs' },
  { id: 'calves', label: 'Calves', area: 'calves', group: 'legs' },
  { id: 'hip_flexors', label: 'Hip flexors', area: 'hip_flexors', group: 'legs' },
];
export const MUSCLE_BY_ID = Object.fromEntries(MUSCLES.map((m) => [m.id, m]));
export const muscleLabel = (id) => MUSCLE_BY_ID[id]?.label ?? id;
/** Body areas (the ones the stretching side knows) that a set of muscles works. */
export const areasOfMuscles = (ids) => [...new Set(ids.map((m) => MUSCLE_BY_ID[m]?.area).filter(Boolean))];

/** What can be owned. `always` ones need no ticking. The cable station is a whole family of exercises, not one machine. */
export const EQUIPMENT = [
  { id: 'bodyweight', label: 'Bodyweight (floor, a step or chair)', always: true },
  { id: 'dumbbell', label: 'Dumbbells' },
  { id: 'bench', label: 'Bench (or the station’s bench)' },
  { id: 'cable_station', label: 'Cable / weight station (e.g. HAMMER Ferrum TX2)' },
  { id: 'pullup_bar', label: 'Pull-up bar' },
  { id: 'band_loop', label: 'Loop resistance bands' },
  { id: 'feetup', label: 'Inversion / headstand trainer (e.g. FeetUp)' },
];
export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e]));
export const equipmentLabel = (id) => EQUIPMENT_BY_ID[id]?.label ?? id;

export const GOALS = [
  { id: 'strength', label: 'Get stronger', blurb: 'Heavier, fewer reps on the main lifts.' },
  { id: 'muscle', label: 'Build muscle', blurb: 'Moderate weights, 8–12 reps, enough sets per muscle.' },
  { id: 'running', label: 'Strength for running', blurb: 'Single-leg strength, hips, calves, core; moderate loads that leave you fresh to run.' },
  { id: 'endurance', label: 'Muscular endurance', blurb: 'Lighter loads, 12–20 reps.' },
  { id: 'general', label: 'General fitness', blurb: 'A balanced mix.' },
];
export const LEVELS = [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']];
export const LEVEL_NUM = { beginner: 1, intermediate: 2, advanced: 3 };

/** Movement flags a person may want to avoid (sore shoulder, knee, wrist, back, no jumping). Exercises carry the ones that apply. */
export const AVOID_FLAGS = [
  { id: 'overhead', label: 'Overhead movements (shoulder)' },
  { id: 'knee', label: 'Deep knee bending (knee)' },
  { id: 'wrist', label: 'Weight on the wrists' },
  { id: 'lowback', label: 'Loaded hinging / spinal loading (lower back)' },
  { id: 'impact', label: 'Jumping and impact' },
  { id: 'hanging', label: 'Hanging from the bar (shoulder, grip)' },
];

/** Coarse slots a balanced workout draws from. `group` = which side of the body it belongs to. */
export const SLOTS = {
  pull_v: { label: 'Pulling from above (pull-ups, pulldowns)', group: 'upper' },
  pull_h: { label: 'Rowing (pulling toward you)', group: 'upper' },
  push_h: { label: 'Pressing forward (bench, push-ups)', group: 'upper' },
  push_v: { label: 'Pressing overhead', group: 'upper' },
  rear: { label: 'Rear shoulders and upper back', group: 'upper' },
  shoulder_iso: { label: 'Shoulder raises', group: 'upper' },
  arms: { label: 'Arms (biceps, triceps)', group: 'upper' },
  squat: { label: 'Squatting and lunging (knee-dominant)', group: 'lower' },
  hinge: { label: 'Hinging and glute work (hip-dominant)', group: 'lower' },
  hip_stab: { label: 'Hip and pelvis stability', group: 'lower' },
  calf: { label: 'Calves', group: 'lower' },
  knee_iso: { label: 'Knee extension / flexion', group: 'lower' },
  core: { label: 'Core', group: 'core' },
  carry: { label: 'Carries', group: 'core' },
  skill: { label: 'Balance and inversion', group: 'core' },
  conditioning: { label: 'Conditioning', group: 'lower' },
};
export const slotLabel = (s) => SLOTS[s]?.label ?? s;

/** What each exercise type is for, and the order a workout runs in. */
export const TYPE_ORDER = { compound: 0, accessory: 1, stability: 2, core: 3, skill: 3, mobility: 4, conditioning: 5 };
