// The exercise catalogue: browse and search every exercise, see how it is done, attach guide videos, add your own.
// Also the picker the workout builder and session logger use to add an exercise.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { openModal, toast } from '../modal.js';
import { searchExercises, ladderOf, doable } from '../strength/catalog.js';
import { MUSCLES, EQUIPMENT, AVOID_FLAGS, SLOTS, TYPE_ORDER, muscleLabel } from '../strength/muscles.js';
import { defaultRx, describeRx, summarizeSets } from '../strength/rx.js';
import { lastSets, bestsFor } from '../strength/stats.js';
import { catalogOf, haveOf, addCustomExercise, deleteCustomExercise, addGuide, guidesFor } from '../strength/store.js';
import { parseSourceInput, fetchOEmbed } from '../youtube.js';
import { itemFor } from '../strength/builder.js';
import { guideButton } from './guides.js';
import { S, ui, muscleLine, needsText, rerender, newDraft } from './strength-shared.js';

const LEVEL_TEXT = { 1: 'easy', 2: 'moderate', 3: 'hard' };
const TYPE_TEXT = { compound: 'main lift', accessory: 'accessory', stability: 'stability', core: 'core', skill: 'balance / skill', mobility: 'mobility', conditioning: 'conditioning' };

// ---------------------------------------------------------------- one exercise

/** Which rows and which groups are open. Kept while you visit other pages, not saved. */
const openRows = () => (ui().exOpen ??= new Set());
const openGroups = () => (ui().exGroups ??= new Set());

/** One line of facts that fits on a phone: the main muscles and what it takes. */
function oneLine(ex) {
  return h('span', { class: 'sub' }, ex.primary.map(muscleLabel).join(', '), ` · ${needsText(ex)}`, ex.unilateral ? ' · one side at a time' : '');
}

/** Everything else about an exercise. Built the first time a row is opened. */
export function exerciseDetail(ex, { onChange = () => {}, manage = true } = {}) {
  const { state, store } = ctx;
  const st = S();
  const last = lastSets(state.history, ex.id), best = bestsFor(state.history, ex.id);
  const ladder = ladderOf(ex.id, catalogOf(state));
  const excluded = st.prefs.excluded.includes(ex.id);
  const rx = defaultRx(ex, st.prefs.goal);
  return h('div', { class: 'ex-detail' },
    ex.cue ? h('p', { class: 'cue' }, ex.cue) : h('p', { class: 'cue muted' }, 'No description yet.'),
    h('dl', { class: 'ex-facts' },
      h('dt', null, 'Works'), h('dd', null, muscleLine(ex)),
      h('dt', null, 'Kind'), h('dd', null, `${TYPE_TEXT[ex.type] ?? ex.type}, ${LEVEL_TEXT[ex.level]}`),
      h('dt', null, 'Usually'), h('dd', null, describeRx(rx)),
      h('dt', null, 'Needs'), h('dd', null, `${needsText(ex)}${ex.loads.length ? ` (heavier with ${ex.loads.join(', ').replace('dumbbell', 'dumbbells')})` : ''}`),
      ladder.length > 1 ? [h('dt', null, 'Progression'), h('dd', { class: 'ladder' }, ladder.map((r, i) => [i ? ' → ' : '', r.id === ex.id ? h('strong', null, r.name.replace(/ \(.*\)/, '')) : h('span', null, r.name.replace(/ \(.*\)/, ''))]).flat())] : null,
      last || best ? [h('dt', null, 'Your log'), h('dd', null, last ? `Last time: ${summarizeSets(last)}` : '', best?.e1rm ? ` · best estimated max ${best.e1rm} kg` : best?.reps ? ` · best ${best.reps} reps` : best?.secs ? ` · best hold ${best.secs} s` : '')] : null),
    h('div', { class: 'row-actions' },
      guideButton(ex, { onChange, cls: 'btn small' }),
      manage ? h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'toggle-exclude', title: 'Hide it from suggestions and templates', onclick: () => {
        st.prefs.excluded = excluded ? st.prefs.excluded.filter((x) => x !== ex.id) : [...st.prefs.excluded, ex.id];
        store.save(); toast(excluded ? `${ex.name} can be suggested again.` : `${ex.name} won’t be suggested.`, 'info'); onChange();
      } }, excluded ? 'Allow in suggestions' : 'Never suggest') : null,
      manage && ex.custom ? h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'edit-ex', onclick: () => openExerciseForm({ existing: ex, onSaved: onChange }) }, 'Edit') : null,
      manage && ex.custom ? h('button', { class: 'btn small ghost danger', type: 'button', 'data-action': 'delete-ex', onclick: () => { if (confirm(`Delete “${ex.name}”? Workouts that use it keep its name but it can no longer be edited.`)) { deleteCustomExercise(state, ex.id); store.save(); onChange(); } } }, 'Delete') : null));
}

/**
 * A compact row: name, main muscles, what it takes, difficulty and an add button. Tap the name to see the rest.
 * @param {object} ex
 * @param {{onAdd?:(ex:object)=>void, addLabel?:string, onChange?:()=>void}} [o]
 */
export function exerciseCard(ex, { onAdd = null, addLabel = '＋ Add', onChange = () => {} } = {}) {
  const { state } = ctx;
  const st = S();
  const can = doable(ex, haveOf(state));
  const guides = guidesFor(state, ex.id).length;
  const excluded = st.prefs.excluded.includes(ex.id);
  const open = openRows();
  const detail = h('div', { class: 'ex-more', hidden: !open.has(ex.id) });
  const toggle = h('button', { class: 'ex-toggle', type: 'button', 'aria-expanded': open.has(ex.id), 'aria-label': `${ex.name}: show details`, onclick: () => {
    const now = detail.hidden;
    detail.hidden = !now;
    toggle.setAttribute('aria-expanded', String(now));
    if (now) { open.add(ex.id); if (!detail.firstChild) detail.append(exerciseDetail(ex, { onChange })); } else open.delete(ex.id);
  } }, h('span', { class: 'chev', 'aria-hidden': 'true' }, '▸'), h('span', { class: 'ex-title' }, h('strong', { class: 'nm' }, ex.name), oneLine(ex)));
  if (open.has(ex.id)) detail.append(exerciseDetail(ex, { onChange }));
  return h('div', { class: `ex-card ex-row${can ? '' : ' unavailable'}`, 'data-ex': ex.id },
    h('div', { class: 'ex-line' }, toggle,
      h('span', { class: 'ex-side' },
        ex.custom ? h('span', { class: 'badge new' }, 'yours') : null,
        excluded ? h('span', { class: 'badge warn', title: 'Never suggested' }, 'hidden') : null,
        !can ? h('span', { class: 'badge warn', title: 'Needs equipment that is not ticked in Setup' }, 'no kit') : null,
        guides ? h('span', { class: 'badge', title: `${guides} guide video${guides === 1 ? '' : 's'} attached` }, `▶ ${guides}`) : null,
        h('span', { class: `badge lvl${ex.level}` }, LEVEL_TEXT[ex.level]),
        onAdd ? h('button', { class: 'btn small primary', type: 'button', 'data-action': 'add-ex', 'aria-label': `Add ${ex.name}`, onclick: () => onAdd(ex) }, addLabel) : null)),
    detail);
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

const BODY_PARTS = { upper: 'Upper body', lower: 'Lower body', core: 'Core and balance' };
/** Group a list of exercises by the movement they train, in the order the slots are declared. Empty groups are left out. */
export function groupBySlot(list) {
  const groups = [];
  for (const [slot, def] of Object.entries(SLOTS)) {
    const items = sorted(list.filter((e) => e.slot === slot));
    if (items.length) groups.push({ slot, label: def.label, part: def.group, items });
  }
  const known = new Set(Object.keys(SLOTS));
  const rest = list.filter((e) => !known.has(e.slot));
  if (rest.length) groups.push({ slot: 'other', label: 'Other', part: 'core', items: sorted(rest) });
  return groups;
}

// ---------------------------------------------------------------- the catalogue page

export function exercisesPage() {
  const f = ui().filters;
  const listSlot = h('div', { id: 'ex-list' });
  const draw = (keepFocus) => {
    const all = catalogOf(ctx.state);
    const found = searchExercises(all, { q: f.q, muscle: f.muscle, equipment: f.equipment, slot: f.slot, mine: f.doable, have: haveOf(ctx.state) });
    const groups = groupBySlot(found);
    const filtering = Boolean(f.q.trim() || f.muscle || f.equipment || f.slot);   // while searching, everything that matched is open
    const addTo = (e) => { const u = ui(); u.editor ??= newDraft(); u.editor.items.push({ exId: e.id, ...itemDefaults(e) }); toast(`Added ${e.name} to “${u.editor.name || 'the workout you are building'}”. See it under ✎ Building.`, 'success'); rerender(); };
    const section = (g) => {
      const body = h('div', { class: 'ex-rows' });
      const isOpen = filtering || openGroups().has(g.slot);
      const d = h('details', { class: 'ex-group', 'data-slot': g.slot, open: isOpen, ontoggle: () => { if (!filtering) { if (d.open) openGroups().add(g.slot); else openGroups().delete(g.slot); } if (d.open && !body.firstChild) fillRows(); } },
        h('summary', null, h('span', { class: 'chev', 'aria-hidden': 'true' }, '▸'), h('span', { class: 'g-name' }, g.label.replace(/ \(.*\)/, ''), g.label.includes('(') ? h('small', { class: 'muted' }, ` ${g.label.match(/\((.*)\)/)[1]}`) : null), h('span', { class: 'count' }, g.items.length)),
        body);
      const fillRows = () => fill(body, g.items.map((ex) => exerciseCard(ex, { onAdd: addTo, addLabel: '＋ Add', onChange: () => draw() })));
      if (isOpen) fillRows();
      return d;
    };
    const parts = Object.entries(BODY_PARTS).map(([part, title]) => [title, groups.filter((g) => g.part === part)]).filter(([, gs]) => gs.length);
    fill(listSlot,
      h('div', { class: 'ex-bar' },
        h('p', { class: 'hint', 'aria-live': 'polite', id: 'ex-count' }, `${found.length} exercise${found.length === 1 ? '' : 's'}${f.doable ? ' you can do with your equipment' : ''}`),
        groups.length > 1 && !filtering ? h('span', { class: 'ex-bulk' },
          h('button', { class: 'link', type: 'button', id: 'ex-expand-all', onclick: () => { for (const g of groups) openGroups().add(g.slot); draw(); } }, 'Open all groups'), ' · ',
          h('button', { class: 'link', type: 'button', id: 'ex-collapse-all', onclick: () => { openGroups().clear(); draw(); } }, 'Close all')) : null),
      groups.length ? parts.map(([title, gs]) => h('section', { class: 'ex-part' }, h('h3', null, title), gs.map(section)))
        : h('p', { class: 'empty-note' }, f.doable ? 'Nothing matches with your equipment. Untick “only what my equipment allows”, or change the filters.' : 'Nothing matches.'));
    if (keepFocus) document.getElementById('ex-search')?.focus();
  };
  const page = h('div', { id: 'ex-page' },
    h('p', { class: 'hint' }, `${catalogOf(ctx.state).length} exercises, grouped by the movement they train. Open a group, then tap an exercise for how it is done, its guide videos and more. Add your own; attach YouTube guides to any of them.`),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', id: 'new-exercise', onclick: () => openExerciseForm({ onSaved: () => draw() }) }, '＋ New exercise')),
    filterBar(f, (typing) => draw(typing)), listSlot);
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
    fill(listSlot, found.length ? found.map((ex) => {
      const more = h('div', { class: 'ex-more', hidden: true });
      const info = h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'info', 'aria-expanded': 'false', 'aria-label': `More about ${ex.name}`, title: 'How it is done, guide videos', onclick: () => {
        more.hidden = !more.hidden; info.setAttribute('aria-expanded', String(!more.hidden));
        if (!more.hidden && !more.firstChild) more.append(exerciseDetail(ex, { manage: false, onChange: () => {} }));
      } }, 'ⓘ');
      return h('div', { class: 'picker-item', 'data-ex': ex.id }, h('div', { class: 'picker-row', 'data-ex': ex.id },
        h('div', { class: 'p-body' }, h('strong', null, ex.name), h('div', null, oneLine(ex))),
        h('span', { class: 'ex-side' }, info,
          h('button', { class: `btn small${has(ex.id) ? ' ghost' : ' primary'}`, type: 'button', 'data-action': 'pick', onclick: (e) => { onPick(ex); e.currentTarget.textContent = '✓ Added'; e.currentTarget.className = 'btn small ghost'; } }, has(ex.id) ? '＋ Again' : '＋ Add'))), more);
    })
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

