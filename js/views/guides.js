// Guide videos for an exercise: YouTube videos you attach so you can watch the form before you train.
// They are kept in your profile (strength.guides), for built-in and for your own exercises alike.

import { h, fill, thumb } from '../dom.js';
import { ctx, client, quotaInfo } from '../ctx.js';
import { openModal, toast } from '../modal.js';
import { mountPlayer } from '../player.js';
import { parseSourceInput, fetchOEmbed } from '../youtube.js';
import { addGuide, removeGuide, guidesFor, catalogById } from '../strength/store.js';

export const searchUrl = (ex) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to ${ex.name.replace(/\s*\(.*?\)/g, '')} proper form`)}`;

/** A small button that opens the guides for an exercise; says how many are attached. */
export function guideButton(ex, { cls = 'btn small ghost', onChange = () => {} } = {}) {
  const n = guidesFor(ctx.state, ex.id).length;
  return h('button', { class: cls, type: 'button', 'data-action': 'guides', 'aria-label': `Guide videos for ${ex.name}`, title: n ? `${n} guide video${n === 1 ? '' : 's'} attached` : 'Watch how it is done, or attach a guide video',
    onclick: () => openGuides(ex.id, { onChange }) }, n ? `▶ ${n}` : '▶ Guide');
}

/** The dialog: watch, add (link, library, search), remove. */
export function openGuides(exId, { onChange = () => {} } = {}) {
  const { state, store } = ctx;
  const ex = catalogById(state)[exId];
  if (!ex) return;
  const player = h('div', { class: 'guide-player', id: 'guide-player' });
  const list = h('ul', { class: 'guide-list', id: 'guide-list' });
  const status = h('p', { class: 'hint', id: 'guide-status', 'aria-live': 'polite' });
  const found = h('div', { id: 'guide-found' });
  let live = null;
  const play = (id) => {
    live?.destroy();
    fill(player, h('div', { class: 'player-box' }));
    live = mountPlayer(player.firstChild, id, { onUnavailable: () => fill(player, h('p', { class: 'hint' }, 'The video player could not load. ', h('a', { href: `https://www.youtube.com/watch?v=${id}`, target: '_blank', rel: 'noopener noreferrer' }, 'Watch it on YouTube ↗'))) });
  };

  const draw = () => {
    const guides = guidesFor(state, exId);
    fill(list, guides.length ? guides.map((g) => h('li', { 'data-guide': g.id },
      h('img', { src: thumb(g.id), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }),
      h('div', { class: 'g-body' }, h('strong', null, g.title || 'YouTube video'), h('small', { class: 'muted' }, g.channel ? ` · ${g.channel}` : '')),
      h('button', { class: 'btn small', type: 'button', 'data-action': 'watch-guide', onclick: () => play(g.id) }, '▶ Watch'),
      h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'remove-guide', 'aria-label': `Remove ${g.title || 'this video'}`, onclick: () => { removeGuide(state, exId, g.id); store.save(); draw(); onChange(); } }, 'Remove')))
      : h('li', { class: 'empty-note' }, 'No guide video attached yet. Add one below, or search YouTube.'));
  };

  const attach = async (id, known = {}) => {
    let meta = known;
    if (!meta.title) {
      try {
        const api = client();
        meta = api ? (await api.videos([id]))[0] ?? {} : (await fetchOEmbed(id)) ?? {};
      } catch { meta = {}; }
    }
    const ok = addGuide(state, exId, { id, title: meta.title ?? '', channel: meta.channel ?? '' });
    if (!ok) { status.textContent = guidesFor(state, exId).some((g) => g.id === id) ? 'That video is already attached.' : 'Could not attach it (a handful of videos per exercise).'; return false; }
    store.save(); draw(); onChange(); play(id);
    status.textContent = `Attached${meta.title ? `: ${meta.title}` : ''}.`;
    return true;
  };

  // paste a link
  const url = h('input', { type: 'text', id: 'guide-url', placeholder: 'Paste a YouTube link', 'aria-label': 'YouTube link', spellcheck: 'false', autocomplete: 'off' });
  const addForm = h('form', { class: 'guide-add', onsubmit: async (e) => {
    e.preventDefault();
    const parsed = parseSourceInput(url.value);
    if (parsed.type !== 'video') { status.textContent = 'That is not a link to a single YouTube video. Paste the address of one video.'; return; }
    status.textContent = 'Adding…';
    if (await attach(parsed.value)) url.value = '';
  } }, url, h('button', { class: 'btn primary', type: 'submit', id: 'guide-add' }, 'Add'));

  // from the video library
  const libIds = Object.keys(state.library).filter((id) => state.videos[id]);
  const fromLib = libIds.length ? h('div', { class: 'guide-add' },
    h('select', { id: 'guide-library', 'aria-label': 'A video from your library' }, libIds.map((id) => h('option', { value: id }, `${state.videos[id].title}${state.videos[id].channel ? ` · ${state.videos[id].channel}` : ''}`))),
    h('button', { class: 'btn', type: 'button', id: 'guide-attach-library', onclick: () => { const id = document.getElementById('guide-library').value; const v = state.videos[id]; attach(id, { title: v.title, channel: v.channel }); } }, 'Attach')) : null;

  // look for guides (costs YouTube quota, so only on request)
  const api = client();
  const findBtn = h('button', { class: 'btn', type: 'button', id: 'guide-find', disabled: !api || quotaInfo().left < 150, title: api ? '' : 'Needs a YouTube key (Settings)', onclick: async () => {
    findBtn.disabled = true; status.textContent = 'Searching YouTube…';
    try {
      const res = await client().search({ q: `how to ${ex.name.replace(/\s*\(.*?\)/g, '')} proper form`, maxResults: 6 });
      status.textContent = res.items.length ? 'Pick the ones you like:' : 'Nothing found.';
      fill(found, res.items.map((it) => h('div', { class: 'guide-result', 'data-found': it.id },
        h('img', { src: thumb(it.id), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }),
        h('div', { class: 'g-body' }, h('strong', null, it.title), h('small', { class: 'muted' }, ` · ${it.channel}`)),
        h('button', { class: 'btn small', type: 'button', onclick: () => attach(it.id, { title: it.title, channel: it.channel }) }, 'Use this'))));
    } catch (err) { status.textContent = err.message; }
    findBtn.disabled = false;
  } }, 'Find guides here (100 units)');

  const body = h('div', { class: 'guides' },
    ex.cue ? h('p', { class: 'cue' }, ex.cue) : null,
    player, list,
    h('h3', null, 'Add a guide video'),
    addForm, fromLib,
    h('div', { class: 'guide-add' }, findBtn, h('a', { class: 'btn ghost', href: searchUrl(ex), target: '_blank', rel: 'noopener noreferrer' }, 'Search YouTube ↗')),
    status, found);
  const modal = openModal({ title: `${ex.name}: guide videos`, body, wide: true, onClose: () => { live?.destroy(); onChange(); } });
  draw();
  const first = guidesFor(state, exId)[0];
  if (first) play(first.id);
  return modal;
}
