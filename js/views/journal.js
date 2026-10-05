// Journal: your history, and what the app has learned from it.

import { h, fill } from '../dom.js';
import { ctx, play } from '../ctx.js';
import { areaLabel } from '../lexicon.js';
import { buildModel, insights, localDate } from '../model.js';
import { deleteSession } from '../state.js';
import { formatDuration } from '../analyze.js';

const FACE = { much: ['😀', 'much better'], some: ['🙂', 'a little'], none: ['😐', 'not really'] };

function streak(history) {
  const days = new Set(history.map((s) => s.date));
  let n = 0;
  const d = new Date();
  if (!days.has(localDate(d))) d.setDate(d.getDate() - 1); // today not done yet doesn't break it
  while (days.has(localDate(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function mountJournal(root) {
  const { state } = ctx;
  const model = buildModel(state.history, state.videos);
  const ins = insights(model, state.videos);
  const minutes = Math.round(state.history.reduce((s, x) => s + (state.videos[x.videoId]?.durationSec ?? 0), 0) / 60);
  const tile = (n, label) => h('div', { class: 'tile' }, h('strong', null, n), h('span', null, label));
  const poseCount = new Set([...model.pose.keys()].map((k) => k.split('|')[1])).size;

  fill(root, 
    h('h1', null, 'Journal'),
    h('p', { class: 'sub' }, 'Everything you’ve done, and what the app is learning about what works for your body.'),
    h('div', { class: 'tiles' },
      tile(state.history.length, 'routines done'), tile(`${minutes}`, 'minutes of practice'), tile(streak(state.history), 'day streak'),
      tile(model.channelDone.size, 'teachers tried'), tile(model.ratings, '“did it help?” answers'), tile(poseCount, 'exercises learned')),

    h('section', { class: 'panel' },
      h('h2', null, 'What’s working for you'),
      ins.length
        ? h('div', { class: 'insights' }, ins.map((i) => h('article', { class: 'insight' },
          h('h3', null, areaLabel(i.area)),
          h('p', { class: 'big' }, `${Math.round((i.helped ?? 0) * 100)}%`, h('small', null, ` helpful over ${i.ratings} rating${i.ratings === 1 ? '' : 's'}${i.ratings < 3 ? ' · early signal, needs a few more' : ''}`)),
          i.poses.length ? h('p', null, h('strong', null, 'Exercises that help: '), i.poses.map((p) => `${p.label} (${Math.round(p.helped * 100)}%)`).join(', ')) : null,
          i.teachers.length ? h('p', null, h('strong', null, 'Teachers: '), i.teachers.map((t) => `${t.name} (${Math.round(t.helped * 100)}%)`).join(', ')) : null,
          i.videos.length ? h('p', null, h('strong', null, 'Best videos: '), i.videos.map((v) => h('button', { class: 'link', type: 'button', onclick: () => play(v.id) }, v.title)).flatMap((b, k) => (k ? [', ', b] : [b]))) : null)))
        : h('p', { class: 'empty-note' }, 'Nothing yet. After a routine, tap “I did it” and tell me whether it helped. Patterns (which exercises and teachers work for which muscles) appear here and steer your suggestions.')),

    h('section', { class: 'panel' },
      h('h2', null, 'History'),
      state.history.length
        ? h('ol', { class: 'history' }, [...state.history].reverse().map((s) => {
          const v = state.videos[s.videoId];
          return h('li', { class: 'hist-item', 'data-session': s.id },
            h('div', null,
              h('p', { class: 'when' }, s.date),
              h('p', null, v ? h('button', { class: 'link', type: 'button', onclick: () => play(v.id) }, v.title) : 'Video no longer in library',
                v ? h('small', { class: 'muted' }, ` · ${v.channel || 'unknown'} · ${v.durationSec ? formatDuration(v.durationSec) : ''}`) : null),
              h('p', { class: 'rates' }, Object.entries(s.ratings).map(([a, r]) => h('span', { class: `badge rate-${r}`, title: FACE[r][1] }, `${FACE[r][0]} ${areaLabel(a)}`)),
                s.intensity ? h('span', { class: 'badge' }, { easy: 'too easy', right: 'just right', hard: 'too hard' }[s.intensity]) : null),
              s.note ? h('p', { class: 'note-text' }, `“${s.note}”`) : null),
            h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Delete this entry', onclick: () => {
              if (!confirm('Delete this entry? The app will also forget what it learned from it.')) return;
              deleteSession(state, s.id); ctx.store.save(); mountJournal(root);
            } }, 'Delete'));
        }))
        : h('p', { class: 'empty-note' }, 'No routines logged yet.')));
}
