// The exercise catalogue: browse and search every exercise, see how it is done, attach guide videos, add your own.
// Also the picker the workout builder and session logger use to add an exercise.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { openModal, toast } from '../modal.js';
import { searchExercises, ladderOf, doable } from '../strength/catalog.js';
import { MUSCLES, EQUIPMENT, AVOID_FLAGS, SLOTS, TYPE_ORDER } from '../strength/muscles.js';
import { defaultRx, describeRx, summarizeSets } from '../strength/rx.js';
import { lastSets, bestsFor } from '../strength/stats.js';
import { catalogOf, haveOf, addCustomExercise, deleteCustomExercise, addGuide } from '../strength/store.js';
import { parseSourceInput, fetchOEmbed } from '../youtube.js';
import { itemFor } from '../strength/builder.js';
import { guideButton } from './guides.js';
import { S, ui, muscleLine, needsText, rerender, newDraft } from './strength-shared.js';

const LEVEL_TEXT = { 1: 'easy', 2: 'moderate', 3: 'hard' };
const TYPE_TEXT = { compound: 'main lift', accessory: 'accessory', stability: 'stability', core: 'core', skill: 'balance / skill', mobility: 'mobility', conditioning: 'conditioning' };

// ---------------------------------------------------------------- one exercise

/**
 * @param {object} ex
 * @param {{onAdd?:(ex:object)=>void, addLabel?:string, onChange?:()=>void, compact?:boolean}} [o]
 */
export function exerciseCard(ex, { onAdd = null, addLabel = '＋ Add to workout', onChange = () => {}, compact = false } = {}) {
  const { state, store } = ctx;
  const st = S();
  const last = lastSets(state.history, ex.id), best = bestsFor(state.history, ex.id);
  const ladder = ladderOf(ex.id, catalogOf(state));
  const excluded = st.prefs.excluded.includes(ex.id);
  const rx = defaultRx(ex, st.prefs.goal);
  const can = doable(ex, haveOf(state));
  return h('article', { class: `ex-card${can ? '' : ' unavailable'}`, 'data-ex': ex.id },
    h('div', { class: 'ex-head' },
      h('h4', null, ex.name),
      h('span', { class: 'badges' },
        h('span', { class: 'badge' }, TYPE_TEXT[ex.type] ?? ex.type), h('span', { class: `badge lvl${ex.level}` }, LEVEL_TEXT[ex.level]),
        ex.unilateral ? h('span', { class: 'badge' }, 'one side at a time') : null,
        ex.custom ? h('span', { class: 'badge new' }, 'yours') : null,
        !can ? h('span', { class: 'badge warn', title: 'Needs equipment that is not ticked in Setup' }, `needs ${needsText(ex)}`) : null)),
    h('p', { class: 'ex-meta' }, muscleLine(ex), h('small', { class: 'muted' }, ` · ${describeRx(rx)} · ${needsText(ex)}${ex.loads.length ? ` (heavier with ${ex.loads.join(', ').replace('dumbbell', 'dumbbells')})` : ''}`)),
    !compact && ex.cue ? h('p', { class: 'cue' }, ex.cue) : null,
    !compact && ladder.length > 1 ? h('p', { class: 'ladder' }, h('small', { class: 'muted' }, 'Progression: '),
      ladder.map((r, i) => [i ? ' → ' : '', r.id === ex.id ? h('strong', null, r.name.replace(/ \(.*\)/, '')) : h('span', null, r.name.replace(/ \(.*\)/, ''))]).flat()) : null,
    !compact && (last || best) ? h('p', { class: 'hint' }, last ? `Last time: ${summarizeSets(last)}` : '', best?.e1rm ? ` · best estimated max ${best.e1rm} kg` : best?.reps ? ` · best ${best.reps} reps` : best?.secs ? ` · best hold ${best.secs} s` : '') : null,
    h('div', { class: 'row-actions' },
      onAdd ? h('button', { class: 'btn small primary', type: 'button', 'data-action': 'add-ex', onclick: () => onAdd(ex) }, addLabel) : null,
      guideButton(ex, { onChange }),
      !compact ? h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'toggle-exclude', title: 'Hide it from suggestions and templates', onclick: () => {
        st.prefs.excluded = excluded ? st.prefs.excluded.filter((x) => x !== ex.id) : [...st.prefs.excluded, ex.id];
        store.save(); toast(excluded ? `${ex.name} can be suggested again.` : `${ex.name} won’t be suggested.`, 'info'); onChange();
      } }, excluded ? 'Allow in suggestions' : 'Never suggest') : null,
      !compact && ex.custom ? h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'edit-ex', onclick: () => openExerciseForm({ existing: ex, onSaved: onChange }) }, 'Edit') : null,
      !compact && ex.custom ? h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'delete-ex', onclick: () => { if (confirm(`Delete “${ex.name}”? Workouts that use it keep its name but it can no longer be edited.`)) { deleteCustomExercise(state, ex.id); store.save(); onChange(); } } }, 'Delete') : null));
}

// ---------------------------------------------------------------- the filters shared by the page and the picker

function filterBar(f, onChange) {
  const sel = (id, label, options, key) => h('label', { class: 'filter' }, h('span', null, label),
    h('select', { id, onchange: (e) => { f[key] = e.target.value; onChange(); } }, [h('option', { value: '' }, 'any'), ...options.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l))]));
  return h('div', { class: 'ex-filters' },
    h('input', { type: 'search', id: 'ex-search', placeholder: 'Search: “pull”, “glutes”, “bands”, “plank”…', 'aria-label': 'Search exercises', value: f.q, oninput: (e) => { f.q = e.target.value; onChange(true); } }),
    sel('ex-muscle', 'Muscle', MUSCLES.map((m) => [m.id, m.label]), 'muscle'),
    sel('ex-equipment', 'Equipment', [['bodyweight', 'none (bodyweight)'], ...EQUIPMENT.filter((e) => !e.always).map((e) => [e.id, e.label.replace(/ \(.*\)/, '')])], 'equipment'),
    sel('ex-slot', 'Kind', Object.entries(SLOTS).map(([id, s]) => [id, s.label.replace(/ \(.*\)/, '')]), 'slot'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'ex-doable', checked: f.doable, onchange: (e) => { f.doable = e.target.checked; onChange(); } }), ' only what my equipment allows'));
}
const sorted = (list) => [...list].sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.name.localeCompare(b.name));

// ---------------------------------------------------------------- the catalogue page

export function exercisesPage() {
  const f = ui().filters;
  const listSlot = h('div', { id: 'ex-list' });
  const draw = (keepFocus) => {
    const all = catalogOf(ctx.state);
    const found = sorted(searchExercises(all, { q: f.q, muscle: f.muscle, equipment: f.equipment, slot: f.slot, mine: f.doable, have: haveOf(ctx.state) }));
    const showing = found.slice(0, f.show);
    fill(listSlot,
      h('p', { class: 'hint', 'aria-live': 'polite', id: 'ex-count' }, `${found.length} exercise${found.length === 1 ? '' : 's'}${f.doable ? ' you can do with your equipment' : ''}`),
      found.length ? h('div', { class: 'ex-grid' }, showing.map((ex) => exerciseCard(ex, {
        onAdd: (e) => { const u = ui(); u.editor ??= newDraft(); u.editor.items.push({ exId: e.id, ...itemDefaults(e) }); toast(`Added ${e.name} to “${u.editor.name || 'the workout you are building'}”. See it under ✎ Building.`, 'success'); rerender(); },
        addLabel: '＋ Add to a workout', onChange: () => draw(),
      }))) : h('p', { class: 'empty-note' }, f.doable ? 'Nothing matches with your equipment. Untick “only what my equipment allows”, or change the filters.' : 'Nothing matches.'),
      found.length > showing.length ? h('button', { class: 'btn', type: 'button', onclick: () => { f.show += 40; draw(); } }, `Show more (${found.length - showing.length} left)`) : null);
    if (keepFocus) document.getElementById('ex-search')?.focus();
  };
  const page = h('div', { id: 'ex-page' },
    h('p', { class: 'hint' }, `${catalogOf(ctx.state).length} exercises, built around dumbbells, a cable station, a pull-up bar, loop bands and bodyweight. Add your own below; attach YouTube guides to any of them.`),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', id: 'new-exercise', onclick: () => openExerciseForm({ onSaved: () => draw() }) }, '＋ New exercise')),
    filterBar(f, (typing) => { f.show = 40; draw(typing); }), listSlot);
  draw();
  return page;
}

const itemDefaults = (ex) => { const { exId, ...rest } = itemFor(ex, S().prefs.goal); return rest; };

// ---------------------------------------------------------------- the picker (used by the builder and the session)

/**
 * Choose exercises to add. `onPick(ex)` runs for each one; the dialog stays open so several can be added.
 * @param {{title?:string, onPick:(ex:object)=>void, has?:(id:string)=>boolean, slot?:string}} o
 */
export function openPicker({ title = 'Add an exercise', onPick, has = () => false, slot = '' }) {
  const f = { q: '', muscle: '', equipment: '', slot, doable: true };
  const listSlot = h('div', { id: 'picker-list' });
  const draw = (keepFocus) => {
    const found = sorted(searchExercises(catalogOf(ctx.state), { q: f.q, muscle: f.muscle, equipment: f.equipment, slot: f.slot, mine: f.doable, have: haveOf(ctx.state) })).slice(0, 60);
    fill(listSlot, found.length ? found.map((ex) => h('div', { class: 'picker-row', 'data-ex': ex.id },
      h('div', { class: 'p-body' }, h('strong', null, ex.name), h('small', { class: 'muted' }, ` · ${needsText(ex)}`), h('div', null, muscleLine(ex))),
      h('button', { class: `btn small${has(ex.id) ? ' ghost' : ' primary'}`, type: 'button', 'data-action': 'pick', onclick: (e) => { onPick(ex); e.currentTarget.textContent = '✓ Added'; e.currentTarget.className = 'btn small ghost'; } }, has(ex.id) ? '＋ Again' : '＋ Add')))
      : h('p', { class: 'empty-note' }, 'Nothing matches.'));
    if (keepFocus) document.getElementById('ex-search')?.focus();
  };
  const body = h('div', { class: 'picker' }, filterBar(f, (typing) => draw(typing)), listSlot,
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', id: 'picker-new', onclick: () => openExerciseForm({ onSaved: (e) => { onPick(e); draw(); } }) }, '＋ New exercise'), h('button', { class: 'btn primary', type: 'button', id: 'picker-done', onclick: () => modal.close() }, 'Done')));
  const modal = openModal({ title, body, wide: true });
  draw();
  return modal;
}

// ---------------------------------------------------------------- adding or editing your own exercise

export function openExerciseForm({ existing = null, onSaved = () => {} } = {}) {
  const { state, store } = ctx;
  const e = existing ?? { name: '', slot: 'core', type: 'accessory', metric: 'reps', level: 1, unilateral: false, primary: [], secondary: [], needs: [], avoid: [], cue: '' };
  const primary = new Set(e.primary), secondary = new Set(e.secondary), needs = new Set(e.needs), avoid = new Set(e.avoid);
  const name = h('input', { type: 'text', id: 'nx-name', maxlength: 80, value: e.name, placeholder: 'e.g. Sled push', 'aria-label': 'Name' });
  const select = (id, options, value) => h('select', { id }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  const slot = select('nx-slot', Object.entries(SLOTS).map(([id, s]) => [id, s.label]), e.slot);
  const type = select('nx-type', Object.entries(TYPE_TEXT).map(([id, l]) => [id, l]), e.type);
  const metric = select('nx-metric', [['reps', 'counted in reps'], ['time', 'held for time']], e.metric);
  const level = select('nx-level', [[1, 'easy'], [2, 'moderate'], [3, 'hard']], e.level);
  const uni = h('input', { type: 'checkbox', id: 'nx-uni', checked: e.unilateral });
  const chips = (items, set, id) => h('div', { class: 'chips', id }, items.map(([v, l]) => h('button', { type: 'button', class: `chip${set.has(v) ? ' on' : ''}`, 'aria-pressed': set.has(v), 'data-value': v,
    onclick: (ev) => { if (set.has(v)) set.delete(v); else set.add(v); ev.currentTarget.classList.toggle('on'); ev.currentTarget.setAttribute('aria-pressed', set.has(v)); } }, l)));
  const cue = h('textarea', { id: 'nx-cue', rows: 2, maxlength: 300, placeholder: 'How it is done, in a sentence or two (optional)' }); cue.value = e.cue;
  const guide = h('input', { type: 'text', id: 'nx-guide', placeholder: 'A YouTube guide video (optional): paste its link', spellcheck: 'false' });
  const msg = h('p', { class: 'hint', id: 'nx-msg', 'aria-live': 'polite' });
  const body = h('form', { class: 'ex-form', onsubmit: async (ev) => {
    ev.preventDefault();
    const saved = addCustomExercise(state, {
      id: existing?.id, name: name.value, slot: slot.value, type: type.value, metric: metric.value, level: Number(level.value), unilateral: uni.checked,
      primary: [...primary], secondary: [...secondary].filter((m) => !primary.has(m)), needs: [...needs], avoid: [...avoid], cue: cue.value,
    });
    if (!saved) { msg.textContent = 'Give it a name and pick at least one main muscle.'; return; }
    const parsed = parseSourceInput(guide.value);
    if (guide.value.trim() && parsed.type === 'video') { const meta = (await fetchOEmbed(parsed.value)) ?? {}; addGuide(state, saved.id, { id: parsed.value, title: meta.title ?? '', channel: meta.channel ?? '' }); }
    store.save(); modal.close(); toast(existing ? 'Saved.' : `Added “${saved.name}” to your catalogue.`, 'success'); onSaved(saved);
  } },
    h('label', null, h('span', null, 'Name'), name),
    h('div', { class: 'form-row' }, h('label', null, h('span', null, 'Kind'), slot), h('label', null, h('span', null, 'Type'), type), h('label', null, h('span', null, 'Counted'), metric), h('label', null, h('span', null, 'Difficulty'), level)),
    h('label', { class: 'check' }, uni, ' done one side at a time'),
    h('p', { class: 'label inline' }, 'Main muscles (tap)'), chips(MUSCLES.map((m) => [m.id, m.label]), primary, 'nx-primary'),
    h('p', { class: 'label inline' }, 'Helping muscles (optional)'), chips(MUSCLES.map((m) => [m.id, m.label]), secondary, 'nx-secondary'),
    h('p', { class: 'label inline' }, 'Needs (leave empty for no equipment)'), chips(EQUIPMENT.filter((q) => !q.always).map((q) => [q.id, q.label.replace(/ \(.*\)/, '')]), needs, 'nx-needs'),
    h('p', { class: 'label inline' }, 'Loads these (optional flags)'), chips(AVOID_FLAGS.map((a) => [a.id, a.label.replace(/ \(.*\)/, '')]), avoid, 'nx-avoid'),
    h('label', null, h('span', null, 'Cue'), cue), existing ? null : h('label', null, h('span', null, 'Guide video'), guide), msg,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit', id: 'nx-save' }, existing ? 'Save' : 'Add exercise'), h('button', { class: 'btn ghost', type: 'button', onclick: () => modal.close() }, 'Cancel')));
  const modal = openModal({ title: existing ? `Edit ${existing.name}` : 'New exercise', body, wide: true });
  return modal;
}

