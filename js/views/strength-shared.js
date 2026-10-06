// Small things the strength pages share: where the page state lives, the context the builder needs, little renderers.

import { h } from '../dom.js';
import { ctx } from '../ctx.js';
import { catalogOf, catalogById, haveOf, recentExercises } from '../strength/store.js';
import { muscleLabel, equipmentLabel, MUSCLE_BY_ID } from '../strength/muscles.js';
import { estimateMinutes } from '../strength/rx.js';
import { localDate } from '../model.js';

export const S = () => ctx.state.strength;

/** The strength page's own state: which page, the workout being built, the session in progress. Kept while you visit other tabs. */
export function ui() {
  return (ctx.ui.strength ??= { page: 'workouts', editor: null, session: null, filters: { q: '', muscle: '', equipment: '', slot: '', doable: true, show: 40 }, mounted: null, done: null });
}
/** An empty workout draft for the builder. */
export const newDraft = (d = {}) => ({ id: d.id ?? null, name: d.name ?? '', note: d.note ?? '', items: (d.items ?? []).map((i) => ({ ...i })), template: d.template ?? null, interpretation: d.interpretation ?? '', notes: d.notes ?? [], suggestions: null, why: d.why ?? {} });

/** Re-draw the strength page (set by the page itself). */
export const rerender = () => ui().mounted?.();
export function go(page) { ui().page = page; rerender(); }

/** What the builder and templates need to know about you. */
export function builderCtx(extra = {}) {
  const st = S();
  return {
    catalog: catalogOf(ctx.state), have: haveOf(ctx.state), goal: st.prefs.goal, level: st.prefs.level, avoid: st.prefs.avoid,
    weakAreas: ctx.state.prefs.focus.filter((f) => f.mode === 'weak').map((f) => f.id), recent: recentExercises(ctx.state),
    exclude: new Set(st.prefs.excluded), legsFatigued: st.prefs.legsFatigued, minutes: st.prefs.minutes, ...extra,
  };
}

export const exName = (id) => catalogById(ctx.state)[id]?.name ?? id;
export const minutesOf = (items) => estimateMinutes(items, catalogById(ctx.state));
export const todayStr = () => localDate();

/** "Lats, biceps" with the helpers in a lighter tone. */
export function muscleLine(ex) {
  return h('span', { class: 'muscles' },
    ex.primary.map(muscleLabel).join(', '),
    ex.secondary.length ? h('small', { class: 'muted' }, ` + ${ex.secondary.slice(0, 3).map(muscleLabel).join(', ').toLowerCase()}`) : null);
}
export const needsText = (ex) => (ex.needs.length ? ex.needs.map(equipmentLabel).map((l) => l.replace(/ \(.*\)/, '')).join(' + ') : 'no equipment');

/** The muscles a list of items works, most-worked first. */
export function musclesOfItems(items, byId) {
  const n = new Map();
  for (const it of items) for (const m of byId[it.exId]?.primary ?? []) n.set(m, (n.get(m) ?? 0) + (it.sets || 1));
  return [...n].sort((a, b) => b[1] - a[1]).map(([m]) => MUSCLE_BY_ID[m]?.label).filter(Boolean);
}

/** Remember an unfinished session across a reload (a gym is a place where pages get reloaded). */
const DRAFT = 'strength-session-draft';
export const saveDraft = (session) => { try { if (session) localStorage.setItem(DRAFT, JSON.stringify(session)); else localStorage.removeItem(DRAFT); } catch { /* private window: no draft */ } };
export const loadDraft = () => { try { const raw = localStorage.getItem(DRAFT); return raw ? JSON.parse(raw) : null; } catch { return null; } };
