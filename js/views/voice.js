// Who teaches: a badge ("Female teacher", with the evidence as its tooltip) and a small menu to tell the app, once, who
// teaches on a channel. What you say always wins over what the app reads from the words around the video.

import { h } from '../dom.js';
import { ctx } from '../ctx.js';
import { markTeacher, markedVoice } from '../state.js';
import { voiceResolver, voiceText, voiceNote } from '../teacher.js';
import { toast } from '../modal.js';

let cache = null;   // the resolver, reused for a moment: a page of cards asks about each of them
/** Who teaches this video: {gender, certainty, source, evidence} or null. */
export function voiceFor(video) {
  const { state } = ctx;
  if (!cache || cache.marks !== state.teacherVoices || cache.videos !== state.videos || Date.now() - cache.at > 1500) {
    cache = { at: Date.now(), marks: state.teacherVoices, videos: state.videos, of: voiceResolver({ marks: state.teacherVoices, videos: Object.values(state.videos) }) };
  }
  return cache.of(video);
}

/** "Female teacher" / "Male teacher" / "Several teachers", with a "?" when it is only a reading of the words. Nothing when unknown. */
export function voiceBadge(video) {
  const v = voiceFor(video);
  if (!v) return null;
  const unsure = v.certainty !== 'sure';
  return h('span', { class: `badge voice${unsure ? ' unsure' : ''}${v.source === 'you' ? ' fixed' : ''}`, title: voiceNote(v), 'data-voice': v.gender }, `${voiceText(v.gender)}${unsure ? '?' : ''}`);
}

const CHOICES = [['female', 'A woman'], ['male', 'A man'], ['mixed', 'Both, or several teachers']];

/**
 * "Teacher ▾": say who teaches on this video's channel (it applies to all of its videos).
 * @param {object} video
 * @param {{onChange?:()=>void, cls?:string}} [o] onChange runs after the answer changed
 */
export function voiceMenu(video, { onChange = () => {}, cls = 'btn small ghost' } = {}) {
  const { state, store } = ctx;
  const name = video.channel || '';
  const mark = markedVoice(state, video);
  const guess = voiceFor(video);
  const pick = (voice) => {
    const entry = markTeacher(state, video, voice);
    store.save();
    toast(voice ? `Noted: ${entry?.name ?? name} — ${voiceText(voice).toLowerCase()}. It applies to all its videos.` : `Back to the app’s own reading for “${name}”.`, voice ? 'success' : 'info');
    onChange();
  };
  const summary = h('summary', { class: cls, title: name ? 'Who teaches here? You tell the app once; it applies to the whole channel' : 'The channel isn’t known yet' }, mark ? `Teacher: ${{ female: 'woman', male: 'man', mixed: 'both' }[mark]} ▾` : 'Teacher ▾');
  const items = h('div', { class: 'menu-items', role: 'menu' },
    h('p', { class: 'menu-note' }, name ? `Who teaches on “${name}”?` : 'Who teaches here?'),
    CHOICES.map(([voice, label]) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': mark === voice, 'data-voice': voice, onclick: () => pick(voice) }, mark === voice ? '✓ ' : '', label)),
    h('button', { type: 'button', role: 'menuitem', 'data-voice': '', disabled: !mark, onclick: () => pick(null) }, 'Not sure: let the app read it'),
    h('p', { class: 'menu-note small' }, guess && !mark ? `The app’s reading: ${voiceNote(guess)}.` : mark ? 'This is what you told the app.' : 'The app can’t tell from what it has read.'));
  return h('details', { class: 'menu', 'data-menu': 'voice', ...(name ? {} : { inert: true }) }, summary, items);
}
