// Journal: your history, and what the app has learned from it.

import { h, fill } from '../dom.js';
import { ctx, play } from '../ctx.js';
import { areaLabel } from '../lexicon.js';
import { buildModel, insights, areaHeat, neglectedAreas } from '../model.js';
import { deleteSession } from '../state.js';
import { trainingLog } from './traininglog.js';
import { sessionMinutes } from '../progress.js';

const FACE = { much: ['😀', 'much better'], some: ['🙂', 'a little'], none: ['😐', 'not really'] };

/** @param {{keep?:boolean}} [o] keep: a redraw after you changed something (stay on the same day and month) rather than arriving on the page */
export function mountJournal(root, { keep = false } = {}) {
  const { state } = ctx;
  const model = buildModel(state.history, state.videos);
  const ins = insights(model, state.videos);
  const tile = (n, label) => h('div', { class: 'tile' }, h('strong', null, n), h('span', null, label));
  const poseCount = new Set([...model.pose.keys()].map((k) => k.split('|')[1])).size;

  fill(root, 
    h('h1', null, 'Journal'),
    h('p', { class: 'sub' }, 'Your training log, and what the app is learning about what works for your body.'),

    trainingLog(() => mountJournal(root, { keep: true }), { keep }),

    heatmap(state),

    h('section', { class: 'panel' },
      h('h2', null, 'What’s working for you'),
      h('div', { class: 'tiles' }, tile(model.channelDone.size, 'teachers tried'), tile(model.ratings, '“did it help?” answers'), tile(poseCount, 'exercises learned')),
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
        ? h('ol', { class: 'history' }, [...state.history].sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1)).map((s) => {
          const v = s.videoId ? state.videos[s.videoId] : null;
          return h('li', { class: 'hist-item', 'data-session': s.id },
            h('div', null,
              h('p', { class: 'when' }, s.date),
              h('p', null, v ? h('button', { class: 'link', type: 'button', onclick: () => play(v.id) }, v.title) : (s.kind === 'manual' ? (s.title ?? 'Something I did') : (s.title ? `${s.title} (video no longer in your data)` : 'Video no longer in library')),
                v || s.kind === 'manual' ? h('small', { class: 'muted' }, ` · ${s.kind === 'manual' ? 'no video' : (v.channel || 'unknown')}${sessionMinutes(s, state.videos) ? ` · ${sessionMinutes(s, state.videos)} min` : ''}`) : null),
              h('p', { class: 'rates' }, Object.entries(s.ratings).map(([a, r]) => h('span', { class: `badge rate-${r}`, title: FACE[r][1] }, `${FACE[r][0]} ${areaLabel(a)}`)),
                s.intensity ? h('span', { class: 'badge' }, { easy: 'too easy', right: 'just right', hard: 'too hard' }[s.intensity]) : null),
              s.note ? h('p', { class: 'note-text' }, `“${s.note}”`) : null),
            h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Delete this entry', onclick: () => {
              if (!confirm('Delete this entry? The app will also forget what it learned from it.')) return;
              deleteSession(state, s.id); ctx.store.save(); mountJournal(root, { keep: true });
            } }, 'Delete'));
        }))
        : h('p', { class: 'empty-note' }, 'No routines logged yet.')));
}

/** Which muscles you've been working lately, and which of your standing spots have gone quiet. */
function heatmap(state) {
  const focus = state.prefs.focus;
  if (!state.history.length && !focus.length) return '';
  const heat = areaHeat(state.history, { days: 28 });
  const ids = [...new Set([...focus.map((f) => f.id), ...Object.keys(heat)])].filter((a) => a !== 'full_body');
  if (!ids.length) return '';
  const rows = ids.map((id) => ({ id, ...(heat[id] ?? { sessions: 0, daysAgo: null, helped: null }), spot: focus.find((f) => f.id === id) }))
    .sort((a, b) => (b.sessions - a.sessions) || ((b.daysAgo ?? 1e6) - (a.daysAgo ?? 1e6)));
  const max = Math.max(3, ...rows.map((r) => r.sessions));
  const quiet = neglectedAreas(focus, state.history, { n: 3 }).filter((n) => n.daysAgo == null || n.daysAgo >= 7);
  return h('section', { class: 'panel', id: 'heatmap' },
    h('h2', null, 'Your body, last 4 weeks'),
    quiet.length ? h('p', { class: 'nudge' }, 'Gone quiet: ', quiet.map((n) => `${areaLabel(n.id)} (${n.daysAgo == null ? 'never worked' : `${n.daysAgo} days`})`).join(', '), '.') : null,
    h('div', { class: 'heat' }, rows.map((r) => {
      const bar = h('span', { class: 'bar' }, h('i'));
      bar.firstChild.style.width = `${Math.max(r.sessions ? 6 : 0, (r.sessions / max) * 100)}%`;
      return h('div', { class: `heat-row${r.spot ? ' spot' : ''}`, 'data-area': r.id },
        h('span', { class: 'c-label' }, areaLabel(r.id), r.spot ? h('small', { class: `mode ${r.spot.mode}` }, r.spot.mode === 'weak' ? 'weak spot' : 'tight spot') : null),
        bar,
        h('span', { class: 'c-n' }, `${r.sessions}×`),
        h('span', { class: 'heat-last' }, r.daysAgo == null ? 'never' : r.daysAgo === 0 ? 'today' : `${r.daysAgo}d ago`),
        h('span', { class: 'heat-help' }, r.helped == null ? '' : `${Math.round(r.helped * 100)}% helped`));
    })));
}
