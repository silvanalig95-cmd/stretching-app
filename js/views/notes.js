// Your own words about a video, on the video itself: tags, your note, and what you wrote after doing it.
// They are kept in your library, and the analysis reads them (see mineEvidence in analyze.js), so what you
// say a video does for you shapes which muscles it is suggested for.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { addToLibrary, updateLibraryItem, inLibrary } from '../state.js';
import { toast } from '../modal.js';

/** @param {object} video @param {{onChange?:()=>void}} [o] onChange runs after a save (the ranking may change) */
export function notesBlock(video, { onChange = () => {} } = {}) {
  const { state, store } = ctx;
  const root = h('div', { class: 'my-notes', id: 'my-notes' });
  let editing = false;

  const draw = () => {
    const lib = state.library[video.id];
    const sessions = state.history.filter((x) => x.videoId === video.id && x.note).slice(-3).reverse();
    const has = !!(lib?.note || lib?.tags?.length || sessions.length);
    if (editing) {
      const tags = h('input', { type: 'text', id: 'my-tags', 'aria-label': 'Tags, comma separated', value: (lib?.tags ?? []).join(', '), placeholder: 'tags, e.g. morning, hips, after running', spellcheck: 'false' });
      const note = h('textarea', { rows: 3, id: 'my-note', maxlength: 500, 'aria-label': 'Your note', placeholder: 'What this video does for you, e.g. “the pigeon part finally releases my right hip”' });
      note.value = lib?.note ?? '';
      fill(root,
        h('h3', null, 'Your notes'),
        tags, note,
        h('p', { class: 'hint' }, 'Muscles you mention here count as evidence for this video (a line saying it did not help is ignored).'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small primary', type: 'button', id: 'my-save', onclick: () => {
            const wasIn = inLibrary(state, video.id);
            if (!wasIn) addToLibrary(state, video.id);
            updateLibraryItem(state, video.id, { tags: tags.value.split(','), note: note.value });
            store.save();
            toast(wasIn ? 'Saved your note.' : 'Saved your note, and added the video to your library.', 'success');
            editing = false;
            onChange();
            draw();
          } }, 'Save'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => { editing = false; draw(); } }, 'Cancel')));
      note.focus();
      return;
    }
    fill(root,
      has ? h('h3', null, 'Your notes') : null,
      lib?.tags?.length ? h('p', { class: 'badges' }, lib.tags.map((t) => h('span', { class: 'badge tag' }, `#${t}`))) : null,
      lib?.note ? h('blockquote', { class: 'my-note' }, lib.note) : null,
      sessions.length ? h('ul', { class: 'my-sessions' }, sessions.map((x) => h('li', null, h('small', { class: 'muted' }, `${x.date} · `), x.note))) : null,
      h('button', { class: 'link', type: 'button', id: 'my-edit', onclick: () => { editing = true; draw(); } }, has ? '✎ Edit note & tags' : '✎ Add a note or tags'));
  };
  draw();
  return root;
}
