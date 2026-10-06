// The "did it help?" dialog. This is where the app learns: each answer is
// credited to the muscle area, and (through the video's profile) to the poses,
// teacher and style involved. See model.js.

import { h, fill } from '../dom.js';
import { openModal, toast } from '../modal.js';
import { ctx, rankNow } from '../ctx.js';
import { logSession } from '../state.js';
import { AREAS, AREA_BY_ID, POSE_BY_ID, areaLabel, areaPath } from '../lexicon.js';

const RATINGS = [['much', '😀', 'Much better'], ['some', '🙂', 'A little'], ['none', '😐', 'Not really']];
const INTENSITY = [['easy', 'Too easy'], ['right', 'Just right'], ['hard', 'Too hard']];

/** Areas worth asking about when none were targeted: the video's strongest. */
function fallbackAreas(video) {
  const ranked = Object.entries(video.profile?.areas ?? {})
    .filter(([a, s]) => s >= 0.5 && a !== 'full_body' && AREA_BY_ID[a])
    .sort((a, b) => b[1] - a[1]).map(([id]) => id);
  // "Lower abdomen" and "Core" would be the same question twice: keep the specific one when the video has it.
  const picked = ranked.filter((id) => !ranked.some((other) => other !== id && AREA_BY_ID[other]?.parent === id));
  return picked.slice(0, 3).map((id) => ({ id, mode: 'tight' }));
}

/** @param {{onDone?: (how:'saved'|'dismissed')=>void}} [opts] onDone runs once the dialog is closed, e.g. to move on to the next part of a combo. */
export function openFeedback(videoId, { onDone = null } = {}) {
  const video = ctx.state.videos[videoId];
  if (!video) return;
  const targeted = ctx.ui.featuredId === videoId ? ctx.ui.featuredAreas : [];
  const areas = (targeted.length ? targeted : fallbackAreas(video)).map((a) => ({ ...a }));
  const ratings = {};
  let intensity = null, repeat = null;

  const body = h('div', { class: 'feedback' });
  let modal, finished = false;
  const finish = (how) => { if (finished) return; finished = true; onDone?.(how); };

  const group = (label, options, get, set, extraClass = '') => h('div', { class: `choice-row ${extraClass}`, role: 'radiogroup', 'aria-label': label },
    options.map(([value, a, b]) => {
      const emoji = b ? a : '';
      const text = b ?? a;
      const on = get() === value;
      return h('button', {
        type: 'button', class: `choice${on ? ' on' : ''}`, role: 'radio', 'aria-checked': on,
        onclick: () => { set(on ? null : value); render(); },
      }, emoji && h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), text);
    }));

  const render = () => {
    const unused = AREAS.filter((a) => !areas.some((x) => x.id === a.id) && a.id !== 'full_body');
    const note = body.querySelector('textarea')?.value ?? '';
    fill(body, 
      h('p', { class: 'lead' }, h('strong', null, video.title)),
      h('h3', null, 'Did it help?'),
      areas.length
        ? areas.map((a) => h('div', { class: 'rate-row' },
          h('div', { class: 'rate-label' }, areaLabel(a.id), h('small', { class: `mode ${a.mode}` }, a.mode === 'weak' ? 'weak spot' : 'tight spot'),
            h('button', { type: 'button', class: 'link', 'aria-label': `Remove ${areaLabel(a.id)}`, onclick: () => { areas.splice(areas.indexOf(a), 1); delete ratings[a.id]; render(); } }, 'remove')),
          group(`How did your ${areaLabel(a.id)} feel`, RATINGS, () => ratings[a.id], (v) => { if (v) ratings[a.id] = v; else delete ratings[a.id]; })))
        : h('p', { class: 'hint' }, 'No muscle areas picked. Add one below so the app can learn what works for it.'),
      unused.length ? h('label', { class: 'add-area' }, 'Also rate: ',
        h('select', { onchange: (e) => { if (e.target.value) { areas.push({ id: e.target.value, mode: 'tight' }); render(); } } },
          h('option', { value: '' }, 'add a muscle area…'), unused.map((a) => h('option', { value: a.id }, areaPath(a.id))))) : null,
      h('h3', null, 'How was the intensity?'),
      group('Intensity', INTENSITY, () => intensity, (v) => { intensity = v; }),
      h('h3', null, 'Show it to me again?'),
      group('Repeat', [['yes', 'Yes, sometime'], ['no', 'Never show again']], () => repeat, (v) => { repeat = v; }),
      h('label', { class: 'note' }, h('span', null, 'Notes (optional)'), h('textarea', { rows: 2, maxlength: 500, placeholder: 'e.g. pigeon pose was the one that finally released it' }, note)),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => modal.close() }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', id: 'save-feedback', onclick: save }, 'Save')),
    );
    const ta = body.querySelector('textarea');
    if (ta) ta.value = note;
  };

  const save = () => {
    const note = body.querySelector('textarea')?.value ?? '';
    logSession(ctx.state, { videoId, areas, ratings, intensity, repeat, note });
    ctx.store.save();
    finished = true;      // the close below must not also report 'dismissed'
    modal.close();
    rankNow();
    ctx.hooks.renderResults();
    toast(learningSummary(video, ratings) || 'Saved. This will shape your next suggestions.', 'success', 6000);
    if (repeat === 'no') toast('Won’t show that one again.', 'info');
    onDone?.('saved');
  };

  modal = openModal({ title: 'How did it go?', body, onClose: () => finish('dismissed') });
  render();
}

/** One line telling the user what the app just learned. */
function learningSummary(video, ratings) {
  const verb = { much: 'helped', some: 'helped a little with', none: 'didn’t do much for' };
  const bits = Object.entries(ratings).map(([area, r]) => {
    const poses = (video.profile?.poses ?? [])
      .filter(({ id }) => (POSE_BY_ID[id]?.areas[area] ?? 0) >= 0.5)
      .slice(0, 2).map(({ id }) => POSE_BY_ID[id].label);
    return `${poses.length ? poses.join(' + ') : video.channel || 'This video'} ${verb[r]} your ${areaLabel(area)}`;
  });
  return bits.length ? `Noted: ${bits.slice(0, 2).join('; ')}.` : '';
}
