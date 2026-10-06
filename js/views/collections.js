// Collections: your own groups of library videos ("Morning", "After a run", "Desk"). A video can be in several.
// Putting a video in a collection also keeps it in your library; taking it out of the library takes it out of them.

import { h, fill } from '../dom.js';
import { ctx, startCombo } from '../ctx.js';
import { createCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection, moveInCollection, collectionsOf, MAX_COLLECTIONS } from '../state.js';
import { toast } from '../modal.js';

let menuOpenFor = null;   // the video whose menu is open, so a redraw of the list does not close it

/**
 * "Collections ▾" on a video: tick the ones it belongs to, or start a new one.
 * @param {object} video
 * @param {{onChange?:()=>void, cls?:string}} [o]
 */
export function collectionMenu(video, { onChange = () => {}, cls = 'btn small ghost' } = {}) {
  const { state, store } = ctx;
  const itemsEl = h('div', { class: 'menu-items', role: 'menu' });
  const input = h('input', { type: 'text', maxlength: 40, placeholder: 'New collection, e.g. Morning', 'aria-label': 'Name of a new collection', id: 'new-collection-name' });
  const summary = h('summary', { class: cls, title: 'Sort this video into your own collections' });
  const details = h('details', { class: 'menu', 'data-menu': 'collections', open: menuOpenFor === video.id, ontoggle: () => { menuOpenFor = details.open ? video.id : (menuOpenFor === video.id ? null : menuOpenFor); } }, summary, itemsEl);

  const draw = () => {
    const mine = new Set(collectionsOf(state, video.id).map((c) => c.id));
    fill(summary, mine.size ? `Collections (${mine.size}) ▾` : 'Collections ▾');
    fill(itemsEl,
      state.collections.length ? state.collections.map((c) => h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': mine.has(c.id), 'data-collection': c.id, onclick: () => {
        if (mine.has(c.id)) removeFromCollection(state, c.id, video.id); else addToCollection(state, c.id, video.id);
        store.save(); draw(); onChange();
      } }, mine.has(c.id) ? '✓ ' : '', c.name)) : h('p', { class: 'menu-note' }, 'No collections yet. Make one below.'),
      state.collections.length < MAX_COLLECTIONS ? h('form', { class: 'menu-new', onsubmit: (e) => {
        e.preventDefault();
        const c = createCollection(state, input.value);
        if (!c) { toast('Give the collection a name first.', 'error'); return; }
        addToCollection(state, c.id, video.id);
        input.value = ''; store.save(); draw(); onChange();
        toast(`Added to “${c.name}”.`, 'success');
      } }, input, h('button', { class: 'btn small', type: 'submit', id: 'new-collection-add' }, '＋ Add')) : null,
      h('p', { class: 'menu-note small' }, 'A video in a collection stays in your library.'));
  };
  draw();
  return details;
}

/**
 * The collection chips above the Library list, and what you can do with the one you picked.
 * `lf` is the Library's filter state (`lf.collection` is the picked one); `redraw` redraws the list.
 */
export function collectionBar(lf, redraw) {
  const { state, store } = ctx;
  const el = h('div', { id: 'collections-bar', class: 'collections' });
  let naming = false, renaming = false;
  const input = h('input', { type: 'text', maxlength: 40, id: 'collection-name', 'aria-label': 'Collection name', placeholder: 'e.g. Morning' });

  const draw = () => {
    if (lf.collection && !state.collections.some((c) => c.id === lf.collection)) lf.collection = '';
    const picked = state.collections.find((c) => c.id === lf.collection) ?? null;
    const count = (c) => c.videoIds.filter((id) => state.videos[id]).length;
    fill(el,
      h('div', { class: 'chips' },
        h('span', { class: 'label inline' }, 'Collections'),
        state.collections.length ? h('button', { type: 'button', class: `chip${lf.collection ? '' : ' on'}`, 'aria-pressed': !lf.collection, 'data-collection': '', onclick: () => { lf.collection = ''; lf.show = 30; renaming = false; draw(); redraw(); } }, 'All') : null,
        state.collections.map((c) => h('button', { type: 'button', class: `chip${lf.collection === c.id ? ' on' : ''}`, 'aria-pressed': lf.collection === c.id, 'data-collection': c.id,
          onclick: () => { lf.collection = c.id; lf.show = 30; renaming = false; draw(); redraw(); } }, `${c.name} `, h('small', { class: 'count' }, String(count(c))))),
        naming
          ? h('form', { class: 'name-form', onsubmit: (e) => {
            e.preventDefault();
            const c = createCollection(state, input.value);
            if (!c) { toast('Give it a name first.', 'error'); return; }
            lf.collection = c.id; naming = false; store.save(); draw(); redraw();
          } }, input, h('button', { class: 'btn small primary', type: 'submit', id: 'collection-create' }, 'Create'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { naming = false; draw(); } }, 'Cancel'))
          : state.collections.length < MAX_COLLECTIONS ? h('button', { type: 'button', class: 'chip quick', id: 'new-collection', onclick: () => { naming = true; input.value = ''; draw(); input.focus(); } }, '＋ New collection') : null),
      !state.collections.length && !naming ? h('p', { class: 'hint' }, 'Sort your videos into your own groups, like “Morning”, “After a run” or “Desk”: use “Collections ▾” on any video. Then you can ask for a routine from just one of them, or play one from start to finish.') : null,
      picked ? h('div', { class: 'coll-tools', id: 'collection-tools' },
        renaming
          ? h('form', { class: 'name-form', onsubmit: (e) => { e.preventDefault(); if (!renameCollection(state, picked.id, input.value)) { toast('That name is empty or already used.', 'error'); return; } renaming = false; store.save(); draw(); redraw(); } },
            input, h('button', { class: 'btn small primary', type: 'submit' }, 'Rename'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { renaming = false; draw(); } }, 'Cancel'))
          : [
            h('button', { class: 'btn small primary', type: 'button', id: 'play-collection', disabled: !playable(picked).length, onclick: () => playInOrder(picked) }, '▶ Play in order'),
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => { renaming = true; input.value = picked.name; draw(); input.focus(); input.select(); } }, 'Rename'),
            h('button', { class: 'btn small ghost danger', type: 'button', id: 'delete-collection', onclick: () => {
              const was = { ...picked, videoIds: [...picked.videoIds] };
              deleteCollection(state, picked.id); lf.collection = ''; store.save(); draw(); redraw();
              const t = toast(`Deleted “${was.name}”. Its videos are still in your library. `, 'info', 9000);
              t.append(h('button', { class: 'link', type: 'button', onclick: () => { state.collections.push(was); store.save(); t.remove(); draw(); redraw(); } }, 'Undo'));
            } }, 'Delete collection'),
            h('small', { class: 'muted' }, `${count(picked)} video${count(picked) === 1 ? '' : 's'}. Use ▲ ▼ on a video to change the order.`)])
        : null);
  };
  draw();
  return { el, redraw: draw };
}

const playable = (c) => c.videoIds.map((id) => ctx.state.videos[id]).filter((v) => v && !v.broken && v.embeddable !== false && !ctx.state.blocked.includes(v.id));

/** Play the videos of a collection one after the other (Today's "combo" mechanism: after each one you say how it went). */
export function playInOrder(c) {
  const vids = playable(c);
  if (!vids.length) return;
  const totalMin = Math.round(vids.reduce((a, v) => a + (v.durationSec ?? 0), 0) / 60);
  ctx.hooks.navigate('today');
  startCombo({ parts: vids.map((video) => ({ video })), totalMin });
  toast(`Playing “${c.name}” in order: ${vids.length} video${vids.length === 1 ? '' : 's'}.`, 'success');
}

/** ▲ ▼ for a video inside the picked collection. */
export function orderButtons(video, collectionId, { onChange = () => {} } = {}) {
  const { state, store } = ctx;
  const c = state.collections.find((x) => x.id === collectionId);
  if (!c) return null;
  const i = c.videoIds.indexOf(video.id);
  const move = (d) => { if (moveInCollection(state, c.id, video.id, d)) { store.save(); onChange(); } };
  return [
    h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'move-up', 'aria-label': `Move ${video.title} earlier`, disabled: i <= 0, onclick: () => move(-1) }, '▲'),
    h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'move-down', 'aria-label': `Move ${video.title} later`, disabled: i < 0 || i >= c.videoIds.length - 1, onclick: () => move(1) }, '▼'),
  ];
}

