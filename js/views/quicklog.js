// "✓ Did today": put a routine in your training log with one click, no questions asked.
// It does not need to be in your library. How it went can be added afterwards (the toast, or the training log).

import { h } from '../dom.js';
import { ctx } from '../ctx.js';
import { logSession, deleteSession, addToLibrary, inLibrary } from '../state.js';
import { localDate } from '../model.js';
import { toast } from '../modal.js';
import { fallbackAreas, openFeedback } from './feedback.js';

/** Log this video for today and offer Undo / "How did it go?". */
export function didToday(video, { onChange = () => {} } = {}) {
  const { state, store } = ctx;
  const targeted = ctx.ui.featuredId === video.id ? ctx.ui.featuredAreas : [];
  const areas = (targeted.length ? targeted : fallbackAreas(video)).map((a) => ({ ...a }));
  const rec = logSession(state, { videoId: video.id, areas }, { library: false });
  store.save();
  const t = toast('Logged for today. ', 'success', 10000);
  const action = (label, fn, extra = {}) => h('button', { class: 'link', type: 'button', ...extra, onclick: () => { t.remove(); fn(); } }, label);
  t.append(
    action('Undo', () => { deleteSession(state, rec.id); store.save(); onChange(); }, { 'data-toast': 'undo-log' }),
    ' · ',
    action('How did it go?', () => openFeedback(video.id, { sessionId: rec.id, onDone: () => onChange() }), { 'data-toast': 'rate-log' }),
    ...(inLibrary(state, video.id) ? [] : [' · ', action('＋ Library', () => { addToLibrary(state, video.id); store.save(); onChange(); })]));
  onChange();
  return rec;
}

/** @param {object} video @param {{onChange?:()=>void, cls?:string}} [o] */
export function didTodayButton(video, { onChange = () => {}, cls = 'btn' } = {}) {
  const today = localDate();
  const n = ctx.state.history.filter((x) => x.videoId === video.id && x.date === today).length;
  return h('button', {
    class: cls, type: 'button', 'data-action': 'did-today', id: ctx.ui.featuredId === video.id && cls === 'btn' ? 'did-today' : undefined,
    title: 'Put it in your training log right now, without questions. You can say how it went afterwards.',
    onclick: () => didToday(video, { onChange }),
  }, n ? `✓ Did today (${n}×)` : '✓ Did today');
}
