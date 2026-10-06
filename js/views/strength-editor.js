// The workout builder: put exercises together, see what is still missing, ask for more ideas, save and reuse.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { toast } from '../modal.js';
import { catalogById, saveWorkout } from '../strength/store.js';
import { suggestMore, fillWorkout, orderWorkout, missingNeeds, itemFor } from '../strength/builder.js';
import { describeRx, defaultRx } from '../strength/rx.js';
import { ladderOf } from '../strength/catalog.js';
import { GOALS } from '../strength/muscles.js';
import { builderCtx, minutesOf, musclesOfItems, muscleLine, ui, rerender, S, newDraft } from './strength-shared.js';
import { openPicker } from './strength-exercises.js';
import { guideButton } from './guides.js';
import { startSession } from './strength-session.js';

/** Open the builder with a draft. */
export function openEditor(draft = {}) {
  ui().page = 'build';
  ui().editor = newDraft(draft);
  rerender();
}

const num = (v, lo, hi, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== '' ? Math.min(hi, Math.max(lo, n)) : fb; };

export function editorView() {
  const ed = ui().editor;
  const st = S();
  const by = catalogById(ctx.state);
  const listSlot = h('div', { id: 'ed-items' }), summary = h('p', { class: 'ed-summary', id: 'ed-summary', 'aria-live': 'polite' }), sugSlot = h('div', { id: 'ed-suggestions' });

  const replaceAt = (i, exId) => { const ex = by[exId]; const { exId: _, ...rest } = itemFor(ex, st.prefs.goal); ed.items[i] = { exId, ...rest, ...(ed.items[i].anchor ? { anchor: true } : {}) }; };
  const addItem = (ex) => { ed.items.push(itemFor(ex, st.prefs.goal)); ed.suggestions = null; draw(); };

  const drawSummary = () => {
    const m = musclesOfItems(ed.items, by).slice(0, 6);
    const missing = missingNeeds(ed.items, { catalog: builderCtx().catalog, goal: st.prefs.goal });
    fill(summary,
      h('strong', null, `${ed.items.length} exercise${ed.items.length === 1 ? '' : 's'} · about ${minutesOf(ed.items)} min`),
      m.length ? h('span', { class: 'muted' }, ` · works ${m.join(', ').toLowerCase()}`) : null,
      missing.length ? h('span', { class: 'ed-missing' }, ` · still missing: ${missing.join('; ')}`) : (ed.items.length >= 3 ? h('span', { class: 'ed-balanced' }, ' · well balanced') : null));
  };

  const itemRow = (it, i) => {
    const ex = by[it.exId];
    if (!ex) return h('li', { class: 'ed-item missing' }, h('span', null, `${it.exId} (no longer in your catalogue)`), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { ed.items.splice(i, 1); draw(); } }, 'Remove'));
    const ladder = ladderOf(ex.id, builderCtx().catalog);
    const isTime = !!it.secs;
    const range = isTime ? it.secs : it.reps ?? defaultRx(ex).reps;
    const setRange = (k, v) => { const r = [...range]; r[k] = num(v, 1, 300, r[k]); const sorted = r.sort((a, b) => a - b); if (isTime) it.secs = sorted; else it.reps = sorted; drawSummary(); };
    const input = (label, value, min, max, onchange, id) => h('label', { class: 'mini' }, h('span', null, label), h('input', { type: 'number', min, max, value: String(value), id, onchange: (e) => onchange(e.target.value), 'aria-label': `${ex.name} ${label}` }));
    return h('li', { class: 'ed-item', 'data-ex': ex.id },
      h('div', { class: 'ed-main' },
        h('div', { class: 'ed-title' }, h('strong', null, ex.name), it.anchor ? h('span', { class: 'badge', title: 'A main lift: keep it the same for 6–8 weeks so progress shows' }, '★ stays') : null,
          ed.why[ex.id] ? h('small', { class: 'why' }, ` ${ed.why[ex.id]}`) : null),
        h('div', { class: 'muted small' }, muscleLine(ex)),
        h('div', { class: 'ed-inputs' },
          input('sets', it.sets, 1, 12, (v) => { it.sets = num(v, 1, 12, it.sets); drawSummary(); }, `sets-${i}`),
          input(isTime ? 'from (s)' : 'reps from', range[0], 1, 300, (v) => setRange(0, v), `lo-${i}`),
          input(isTime ? 'to (s)' : 'to', range[1], 1, 300, (v) => setRange(1, v), `hi-${i}`),
          ex.unilateral ? h('small', { class: 'muted' }, 'per side') : null,
          h('input', { type: 'text', class: 'ed-note', maxlength: 200, placeholder: 'note (optional)', value: it.note ?? '', 'aria-label': `${ex.name} note`, onchange: (e) => { it.note = e.target.value || undefined; } }))),
      h('div', { class: 'ed-tools' },
        ladder.length > 1 && ex.prev && by[ex.prev] ? h('button', { class: 'btn small ghost', type: 'button', title: `Easier: ${by[ex.prev].name}`, 'data-action': 'easier', onclick: () => { replaceAt(i, ex.prev); draw(); } }, '◀ easier') : null,
        ladder.length > 1 && ex.next && by[ex.next] ? h('button', { class: 'btn small ghost', type: 'button', title: `Harder: ${by[ex.next].name}`, 'data-action': 'harder', onclick: () => { replaceAt(i, ex.next); draw(); } }, 'harder ▶') : null,
        h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'swap', title: 'Swap for another exercise of the same kind', onclick: () => { const m = openPicker({ title: `Swap ${ex.name}`, slot: ex.slot, onPick: (e) => { replaceAt(i, e.id); m.close(); draw(); } }); } }, '⇄ swap'),
        h('button', { class: `btn small ghost${it.anchor ? ' on' : ''}`, type: 'button', 'aria-pressed': !!it.anchor, title: 'Mark as a main lift to keep stable', 'data-action': 'anchor', onclick: () => { it.anchor = it.anchor ? undefined : true; draw(); } }, '★'),
        guideButton(ex, { onChange: () => draw() }),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Move ${ex.name} up`, disabled: i === 0, onclick: () => { [ed.items[i - 1], ed.items[i]] = [ed.items[i], ed.items[i - 1]]; draw(); } }, '▲'),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Move ${ex.name} down`, disabled: i === ed.items.length - 1, onclick: () => { [ed.items[i + 1], ed.items[i]] = [ed.items[i], ed.items[i + 1]]; draw(); } }, '▼'),
        h('button', { class: 'btn small ghost danger', type: 'button', 'aria-label': `Remove ${ex.name}`, 'data-action': 'remove', onclick: () => { ed.items.splice(i, 1); ed.suggestions = null; draw(); } }, '✕')));
  };

  const drawSuggestions = () => {
    if (!ed.suggestions) { fill(sugSlot); return; }
    fill(sugSlot, h('div', { class: 'suggest' },
      h('h3', null, 'Ideas that would fit'),
      ed.suggestions.length ? h('ul', { class: 'sug-list' }, ed.suggestions.map((s) => h('li', { 'data-ex': s.ex.id },
        h('div', { class: 'sug-body' }, h('strong', null, s.ex.name), h('small', { class: 'muted' }, ` · ${describeRx(defaultRx(s.ex, st.prefs.goal))}`), h('div', { class: 'muted small' }, muscleLine(s.ex)), h('div', { class: 'why' }, s.why.join(' · '))),
        h('button', { class: 'btn small primary', type: 'button', 'data-action': 'add-suggestion', onclick: () => { ed.why[s.ex.id] = s.why[0] ?? ''; addItem(s.ex); ed.suggestions = suggestMore(ed.items, builderCtx({ count: 6 })); drawSuggestions(); } }, '＋ Add'))))
        : h('p', { class: 'empty-note' }, 'Nothing more to suggest with your equipment and settings. You can still add anything from the catalogue.'),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => { ed.suggestions = null; drawSuggestions(); } }, 'Hide')));
  };

  const draw = () => {
    fill(listSlot, ed.items.length ? h('ol', { class: 'ed-list' }, ed.items.map(itemRow)) : h('p', { class: 'empty-note', id: 'ed-empty' }, 'No exercises yet. Add a few (or describe the workout on the previous page) and ask for ideas.'));
    drawSummary(); drawSuggestions();
  };

  const minutesInput = h('input', { type: 'number', id: 'ed-minutes', min: 10, max: 120, value: String(st.prefs.minutes), 'aria-label': 'Minutes available', onchange: (e) => { st.prefs.minutes = num(e.target.value, 10, 120, 45); ctx.store.save(); } });
  const goalSelect = h('select', { id: 'ed-goal', 'aria-label': 'Goal', onchange: (e) => { st.prefs.goal = e.target.value; ctx.store.save(); ed.suggestions = null; draw(); } }, GOALS.map((g) => h('option', { value: g.id, selected: g.id === st.prefs.goal }, g.label)));
  const tired = h('input', { type: 'checkbox', id: 'ed-tired', checked: st.prefs.legsFatigued, onchange: (e) => { st.prefs.legsFatigued = e.target.checked; ctx.store.save(); ed.suggestions = null; draw(); } });

  const name = h('input', { type: 'text', id: 'ed-name', maxlength: 80, value: ed.name, placeholder: 'Name this workout, e.g. “Upper A”', 'aria-label': 'Workout name', onchange: (e) => { ed.name = e.target.value; } });
  const save = () => {
    ed.name = name.value.trim() || 'My workout';
    if (!ed.items.length) { toast('Add at least one exercise first.', 'error'); return null; }
    const w = saveWorkout(ctx.state, { id: ed.id ?? undefined, name: ed.name, note: ed.note, items: ed.items, template: ed.template ?? undefined });
    if (!w) { toast('Could not save (the list of saved workouts is full).', 'error'); return null; }
    ed.id = w.id; ctx.store.save();
    return w;
  };

  const page = h('section', { class: 'panel', id: 'editor' },
    h('div', { class: 'ed-head' }, h('h2', null, ed.id ? 'Edit workout' : 'Build a workout'), name),
    ed.interpretation ? h('p', { class: 'hint', id: 'ed-interpretation' }, ed.interpretation) : null,
    ed.notes.length ? h('ul', { class: 'hint' }, ed.notes.map((n) => h('li', null, n))) : null,
    summary, listSlot,
    h('div', { class: 'ed-actions' },
      h('button', { class: 'btn', type: 'button', id: 'ed-add', onclick: () => openPicker({ title: 'Add exercises', has: (id) => ed.items.some((i) => i.exId === id), onPick: (ex) => { addItem(ex); } }) }, '＋ Add exercise'),
      h('button', { class: 'btn', type: 'button', id: 'ed-suggest', onclick: () => { ed.suggestions = suggestMore(ed.items, builderCtx({ count: 6 })); drawSuggestions(); } }, '✨ Suggest more'),
      h('label', { class: 'mini inline' }, h('span', null, 'fill to'), minutesInput, h('span', null, 'min')),
      h('button', { class: 'btn', type: 'button', id: 'ed-fill', onclick: () => {
        const r = fillWorkout(ed.items, builderCtx({ minutes: num(minutesInput.value, 10, 120, 45) }));
        r.added.forEach((a) => { ed.why[a.exId] = a.why[0] ?? ''; });
        ed.items = r.items; ed.suggestions = null; draw();
        toast(r.added.length ? `Added ${r.added.length} exercise${r.added.length === 1 ? '' : 's'}: about ${r.minutes} minutes now.` : 'Nothing more fits.', r.added.length ? 'success' : 'info');
      } }, 'Fill the rest'),
      h('button', { class: 'btn ghost', type: 'button', id: 'ed-tidy', title: 'Heavy lifts first, then accessories, stability, core', onclick: () => { ed.items = orderWorkout(ed.items, by); draw(); } }, 'Tidy order')),
    h('div', { class: 'ed-context hint' }, 'For ideas I use: goal ', goalSelect, h('label', { class: 'check inline' }, tired, ' my legs are tired from a hard run')),
    sugSlot,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', id: 'ed-save', onclick: () => { const w = save(); if (w) { ui().editor = null; ui().page = 'workouts'; toast(`Saved “${w.name}”.`, 'success'); rerender(); } } }, 'Save workout'),
      h('button', { class: 'btn primary', type: 'button', id: 'ed-start', onclick: () => { const w = save(); if (w) { ui().editor = null; startSession({ title: w.name, workoutId: w.id, items: w.items }); } } }, 'Save and start'),
      h('button', { class: 'btn ghost', type: 'button', id: 'ed-discard', onclick: () => { if (!ed.items.length || confirm('Throw this draft away?')) { ui().editor = null; ui().page = 'workouts'; rerender(); } } }, 'Close without saving')));
  draw();
  return page;
}

