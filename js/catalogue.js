// The teachers list (data/teachers.js) put to work: who to flavour a search with, and how to browse and filter the list.
// Pure functions: no DOM, no network.

import { CATALOGUE } from '../data/teachers.js';
import { TEACHERS } from './lexicon.js';
import { voiceFit } from './teacher.js';
import { STYLE_BY_ID } from './style.js';
import { parentOf } from './lexicon.js';
import { normName } from './channel.js';

export { CATALOGUE };

/** What the list's "focus" tags are called on screen. */
export const FOCUS_LABELS = {
  beginners: 'Beginners', seniors: 'Seniors', hips: 'Hips', 'lower-back': 'Lower back', back: 'Back', 'neck-shoulders': 'Neck & shoulders', shoulders: 'Shoulders',
  hamstrings: 'Hamstrings', knees: 'Knees', feet: 'Feet', wrists: 'Wrists', posture: 'Posture', 'desk-workers': 'Desk workers', runners: 'Runners', athletes: 'Athletes',
  flexibility: 'Flexibility', strength: 'Strength', balance: 'Balance', sleep: 'Sleep', stress: 'Stress', morning: 'Morning', evening: 'Evening', sciatica: 'Sciatica',
  'pain-relief': 'Pain relief', pregnancy: 'Pregnancy', men: 'Men', 'plus-size': 'Plus-size', adaptive: 'Adaptive', kids: 'Kids',
};
const LEVEL_TEXT = { beginner: 'Beginner-friendly', all: 'All levels', advanced: 'Advanced' };
const LENGTH_TEXT = { short: 'Short videos', mid: 'Mid-length videos', long: 'Long classes', mixed: '' };
const SIZE_TEXT = { large: 'Very large channel', mid: 'Established channel', small: 'Smaller channel' };
export const levelText = (l) => LEVEL_TEXT[l] ?? '';
export const lengthText = (l) => LENGTH_TEXT[l] ?? '';
export const sizeText = (s) => SIZE_TEXT[s] ?? '';

// A muscle area (or its parent) points at these focus tags.
const AREA_FOCUS = {
  neck: ['neck-shoulders', 'posture', 'desk-workers'], shoulders: ['neck-shoulders', 'shoulders', 'desk-workers'], chest: ['posture', 'shoulders'],
  upper_back: ['back', 'posture', 'desk-workers'], lats: ['back', 'shoulders'], arms: ['shoulders'], wrists: ['wrists', 'desk-workers'],
  lower_back: ['lower-back', 'back', 'sciatica', 'pain-relief'], spine: ['back', 'lower-back', 'posture'], core: ['strength', 'lower-back'],
  hip_flexors: ['hips', 'runners', 'desk-workers'], glutes: ['hips', 'sciatica', 'runners'], outer_hip: ['hips', 'runners'], adductors: ['hips', 'flexibility'],
  hamstrings: ['hamstrings', 'flexibility', 'runners'], quads: ['knees', 'runners'], knees: ['knees', 'runners'], calves: ['feet', 'runners'], feet: ['feet', 'balance'],
  full_body: ['flexibility', 'morning', 'beginners'],
};
/** The focus tags that fit the muscles asked for. */
export function focusTagsFor(areas = []) {
  const tags = new Set();
  for (const a of areas) for (const t of AREA_FOCUS[a.id] ?? AREA_FOCUS[parentOf(a.id)] ?? []) tags.add(t);
  return tags;
}

/**
 * The teachers to flavour searches with ("Yoga With Adriene hips 15 minute"): everyone in the list, narrowed toward what was
 * asked for while enough teachers are left to keep it varied. Falls back to the short built-in list when there is no data.
 * @param {{voice?:string, styles?:string[], areas?:{id:string}[]}} [filters]
 */
export function teacherPool(filters = {}, list = CATALOGUE) {
  let pool = list.filter((t) => t.name && t.active !== false);
  if (!pool.length) return TEACHERS;
  const wanted = filters.voice === 'female' || filters.voice === 'male' ? filters.voice : '';
  const narrow = (test, min) => { const sub = pool.filter(test); if (sub.length >= min) pool = sub; };
  if (wanted) {
    pool = pool.filter((t) => voiceFit(wanted, t.voice ? { gender: t.voice } : null) !== 'no');
    narrow((t) => t.voice === wanted || t.voice === 'mixed', 6);   // teachers known to fit come first; unknown ones only when there are too few
  }
  if (filters.styles?.length) narrow((t) => t.styles?.some((s) => filters.styles.includes(s)), 5);
  const tags = focusTagsFor(filters.areas);
  if (tags.size) narrow((t) => t.focus?.some((f) => tags.has(f)), 8);
  return pool;
}

/**
 * Filter and order the list for browsing.
 * @param {{q?:string, style?:string, voice?:string, focus?:string, level?:string, sort?:'name'|'size'}} f   voice: female | male | mixed | unknown
 * @param {(t:object)=>({gender:string}|null)} [voiceOf]  who teaches, as the app sees it (defaults to what the list says)
 */
export function searchCatalogue(f = {}, voiceOf = (t) => (t.voice ? { gender: t.voice } : null), list = CATALOGUE) {
  const q = normalize(f.q);
  let out = list.filter((t) => {
    if (f.style && !t.styles?.includes(f.style)) return false;
    if (f.focus && !t.focus?.includes(f.focus)) return false;
    if (f.level && t.level !== f.level && t.level !== 'all') return false;
    if (f.voice) {
      const who = voiceOf(t);
      if (f.voice === 'unknown' ? who : f.voice === 'mixed' ? who?.gender !== 'mixed' : voiceFit(f.voice, who) !== 'yes' || !who) return false;
    }
    if (q) {
      const hay = normalize(`${t.name} ${t.note ?? ''} ${(t.styles ?? []).map((s) => STYLE_BY_ID[s]?.name ?? s).join(' ')} ${(t.focus ?? []).map((x) => FOCUS_LABELS[x] ?? x).join(' ')}`);
      if (!q.split(' ').every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const size = { large: 0, mid: 1, small: 2 };
  out = out.slice().sort(f.sort === 'size'
    ? (a, b) => (size[a.size] ?? 3) - (size[b.size] ?? 3) || a.name.localeCompare(b.name)
    : (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return out;
}
const normalize = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The list's entry for a channel name, or null. */
export const catalogueEntry = (channel, list = CATALOGUE) => (channel ? list.find((t) => normName(t.name) === normName(channel)) ?? null : null);
