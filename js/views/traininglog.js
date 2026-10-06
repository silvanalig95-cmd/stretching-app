// The training log: when you practised, how it is going against your weekly goal, and what you have achieved.
// Everything shown is worked out from your history (see ../progress.js); the only thing stored is the goal.

import { h, fill, download } from '../dom.js';
import { ctx } from '../ctx.js';
import { localDate } from '../model.js';
import { formatDuration } from '../analyze.js';
import { openFeedback } from './feedback.js';
import { watchLine } from '../practice.js';
import { logSession, deleteSession, restoreSession } from '../state.js';
import { AREAS, areaLabel } from '../lexicon.js';
import { toast } from '../modal.js';
import { play } from '../ctx.js';
import { sessionMinutes } from '../progress.js';
import {
  DEFAULT_WEEKLY_GOAL, totals, streaks, goalProgress, goalStreak, weekly, periods, monthGrid, milestones, areaProgress, encouragement, historyCsv, parseDay,
} from '../progress.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const shortDate = (s) => parseDay(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDate = (s) => parseDay(s).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hoursText = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`);

const cal = { y: null, m: null };   // the month on show; remembered while you move between pages
const sel = { day: null };          // the day whose routines are listed (null = today)

/** @param {()=>void} redraw re-draws the whole Journal (after the history changed) @param {{keep?:boolean}} [o] keep the day and month on show (a redraw, not a fresh visit) */
export function trainingLog(redraw, { keep = false } = {}) {
  const { state, store } = ctx;
  if (!keep) { sel.day = null; cal.y = null; cal.m = null; }
  const today = localDate();
  const goal = state.prefs.weeklyGoal ?? DEFAULT_WEEKLY_GOAL;
  const hist = state.history, vids = state.videos;
  const t = totals(hist, vids, today), s = streaks(hist, today), g = goalProgress(hist, goal, today), gs = goalStreak(hist, goal, today);
  const p = periods(hist, vids, today);
  const now = new Date();
  if (cal.y == null) { cal.y = now.getFullYear(); cal.m = now.getMonth(); }

  const tile = (n, label, extra, id) => h('div', { class: 'tile', id }, h('strong', null, n), h('span', null, label), extra ?? null);
  const barOf = (frac, cls = '') => { const b = h('span', { class: `bar ${cls}` }, h('i')); b.firstChild.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`; return b; };
  const vs = (now_, before, unit) => (before ? `${now_ >= before ? '▲' : '▼'} ${Math.abs(now_ - before)} vs ${unit}` : '');

  // ---------------------------------------------------------------- the headline numbers
  const tiles = h('div', { class: 'tiles', id: 'log-tiles' },
    tile(goal ? `${g.done} / ${goal}` : `${g.done}`, goal ? (g.done === 1 && goal ? 'routine this week (goal)' : 'routines this week (goal)') : (g.done === 1 ? 'routine this week' : 'routines this week'), goal ? barOf(g.done / goal, g.met ? 'met' : '') : null, 'tile-week'),
    tile(s.current, s.current === 1 ? 'day in a row' : 'days in a row', h('small', { class: 'muted' }, `best: ${plural(s.best, 'day', 'days')}`), 'tile-streak'),
    goal ? tile(gs.current, gs.current === 1 ? 'week at your goal in a row' : 'weeks at your goal in a row', h('small', { class: 'muted' }, `best: ${plural(gs.best, 'week', 'weeks')}`), 'tile-weekstreak') : null,
    tile(t.sessions, t.sessions === 1 ? 'routine in total' : 'routines in total', t.since ? h('small', { class: 'muted' }, `since ${shortDate(t.since)} · ${t.perWeek} a week`) : null, 'tile-total'),
    tile(hoursText(t.minutes), 'of practice', h('small', { class: 'muted' }, `${plural(t.activeDays, 'day', 'days')} with a routine`), 'tile-time'),
    tile(p.month.now.sessions, `${p.month.now.sessions === 1 ? 'routine' : 'routines'} in ${MONTHS[now.getMonth()]}`, h('small', { class: 'muted' }, vs(p.month.now.sessions, p.month.before.sessions, 'last month')), 'tile-month'));

  const goalSelect = h('select', { id: 'weekly-goal', 'aria-label': 'Weekly goal', onchange: (e) => { state.prefs.weeklyGoal = Number(e.target.value); store.save(); redraw(); } },
    [0, 1, 2, 3, 4, 5, 6, 7].map((n) => h('option', { value: String(n), selected: n === goal }, n === 0 ? 'no goal' : `${plural(n, 'routine', 'routines')} a week`)));

  // ---------------------------------------------------------------- the last 12 weeks
  const wk = weekly(hist, vids, { today, weeks: 12 });
  const peak = Math.max(goal, ...wk.map((w) => w.sessions), 1);
  const weeksEl = h('ol', { class: 'weekbars', id: 'weekbars', 'aria-label': 'Routines per week, last 12 weeks' }, wk.map((w, i) => {
    const bar = h('i'); bar.style.height = `${Math.round((w.sessions / peak) * 100)}%`;
    return h('li', { class: `${goal && w.sessions >= goal ? 'met' : ''}${i === wk.length - 1 ? ' now' : ''}`, 'data-week': w.start, title: `Week of ${longDate(w.start)}: ${plural(w.sessions, 'routine', 'routines')}${w.minutes ? `, ${w.minutes} min` : ''}` },
      h('span', { class: 'n' }, w.sessions || ''), h('span', { class: 'col' }, bar), h('small', null, i === wk.length - 1 ? 'now' : i % 3 === 0 ? shortDate(w.start) : ''));
  }));

  // ---------------------------------------------------------------- the calendar
  const calSlot = h('div', { class: 'calendar', id: 'calendar' });
  const drawCal = () => {
    const weeks = monthGrid(cal.y, cal.m, hist, vids, today);
    const step = (d) => { const x = new Date(cal.y, cal.m + d, 1); cal.y = x.getFullYear(); cal.m = x.getMonth(); drawCal(); };
    const atNow = cal.y === now.getFullYear() && cal.m === now.getMonth();
    fill(calSlot,
      h('div', { class: 'cal-head' },
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Previous month', id: 'cal-prev', onclick: () => step(-1) }, '‹'),
        h('strong', { id: 'cal-title' }, `${MONTHS[cal.m]} ${cal.y}`),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Next month', id: 'cal-next', disabled: atNow, onclick: () => step(1) }, '›')),
      h('div', { class: 'cal-dows', 'aria-hidden': 'true' }, DOW.map((d) => h('span', null, d))),
      h('ol', { class: 'cal-grid' }, weeks.flat().map((c) => h('li', null, h('button', {
        type: 'button',
        class: `cal-day${c.inMonth ? '' : ' out'}${c.sessions ? ' done' : ''}${c.today ? ' today' : ''}${c.future ? ' future' : ''}${c.date === (sel.day ?? today) ? ' sel' : ''}`,
        'data-date': c.date, 'data-sessions': c.sessions, 'aria-pressed': c.date === (sel.day ?? today), disabled: c.future,
        title: c.sessions ? `${longDate(c.date)}: ${c.titles.join(' · ')}` : longDate(c.date),
        'aria-label': `${longDate(c.date)}${c.sessions ? `: ${plural(c.sessions, 'routine', 'routines')}` : ''}`,
        onclick: () => { sel.day = c.date; const d = parseDay(c.date); cal.y = d.getFullYear(); cal.m = d.getMonth(); drawCal(); drawDay(); },
      }, h('span', { class: 'd', 'aria-hidden': 'true' }, String(Number(c.date.slice(8)))), c.sessions ? h('b', { 'aria-hidden': 'true' }, c.sessions > 1 ? `${c.sessions}×` : '✓') : null)))));
  };
  drawCal();

  // ---------------------------------------------------------------- what you did on a day, and logging more
  const daySlot = h('div', { id: 'day-log' });
  const logSlot = h('div', { id: 'log-routine-slot' });

  const removeWithUndo = (rec) => {
    deleteSession(state, rec.id); store.save();
    const t = toast(`Removed “${rec.title ?? 'that routine'}” from ${rec.date === today ? 'today' : longDate(rec.date)}. `, 'info', 9000);
    t.append(h('button', { class: 'link', type: 'button', onclick: () => { restoreSession(state, rec); store.save(); t.remove(); redraw(); } }, 'Undo'));
    redraw();
  };
  const entryRow = (rec) => {
    const v = rec.videoId ? vids[rec.videoId] : null;
    const rated = Object.entries(rec.ratings ?? {});
    const areas = [...new Set([...(rec.areas ?? []).map((a) => a.id), ...Object.keys(rec.ratings ?? {})])].filter((a) => a !== 'full_body');
    const mins = sessionMinutes(rec, vids);
    return h('li', { class: 'day-entry', 'data-session': rec.id },
      h('div', { class: 'body' },
        h('p', { class: 'ttl' }, v ? h('button', { class: 'link', type: 'button', onclick: () => play(v.id) }, rec.title ?? v.title) : (rec.title ?? 'Something I did'),
          h('small', { class: 'muted' }, ` · ${rec.kind === 'manual' ? 'no video' : (rec.channel ?? v?.channel ?? '')}${mins ? ` · ${mins} min` : ''}`)),
        h('p', { class: 'badges' }, areas.map((a) => h('span', { class: `badge${rec.ratings?.[a] ? ` rate-${rec.ratings[a]}` : ''}` }, `${rec.ratings?.[a] ? { much: '😀 ', some: '🙂 ', none: '😐 ' }[rec.ratings[a]] : ''}${areaLabel(a)}`)),
          rec.intensity ? h('span', { class: 'badge' }, { easy: 'too easy', right: 'just right', hard: 'too hard' }[rec.intensity]) : null),
        rec.watch ? h('p', { class: 'hint watched', title: rec.watch.skipped?.length ? `Skipped: ${rec.watch.skipped.join(', ')}` : '' }, `played ${watchLine(rec.watch, rec.durationSec)}${rec.watch.skipped?.length ? ` · skipped ${rec.watch.skipped.length} section${rec.watch.skipped.length === 1 ? '' : 's'}` : ''}`) : null,
        rec.note ? h('p', { class: 'note-text' }, `“${rec.note}”`) : null),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', type: 'button', 'data-action': 'rate-entry', onclick: () => openFeedback(rec.videoId, { sessionId: rec.id, onDone: (how) => { if (how === 'saved') redraw(); } }) }, rated.length ? 'Edit' : 'How did it go?'),
        h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'remove-entry', 'aria-label': `Remove ${rec.title ?? 'this entry'} from the log`, onclick: () => removeWithUndo(rec) }, 'Remove')));
  };
  const drawDay = () => {
    const day = sel.day ?? today;
    const list = hist.filter((x) => x.date === day).sort((a, b) => (a.at < b.at ? -1 : 1));
    const mins = list.reduce((a, x) => a + sessionMinutes(x, vids), 0);
    fill(daySlot,
      h('h3', null, day === today ? 'Today' : longDate(day), list.length ? h('small', { class: 'muted' }, ` · ${plural(list.length, 'routine', 'routines')}${mins ? `, ${mins} min` : ''}`) : null,
        day !== today ? h('button', { class: 'link', type: 'button', id: 'day-today', onclick: () => { sel.day = null; cal.y = now.getFullYear(); cal.m = now.getMonth(); drawCal(); drawDay(); } }, ' back to today') : null),
      list.length ? h('ul', { class: 'day-entries', id: 'day-entries' }, list.map(entryRow))
        : h('p', { class: 'empty-note', id: 'day-empty' }, day === today ? 'Nothing logged today yet. Press “✓ Did today” on any video, or log something below.' : 'Nothing logged on this day.'));
  };

  const openLogForm = () => {
    const day = sel.day ?? today;
    let mode = 'library';
    const chosen = new Set();
    const draw = () => {
      const ids = Object.keys(state.library).filter((id) => vids[id]);
      const lastDone = new Map(); for (const x of hist) lastDone.set(x.videoId, x.date);
      ids.sort((a, b) => (lastDone.get(b) ?? '') < (lastDone.get(a) ?? '') ? -1 : (lastDone.get(b) ?? '') > (lastDone.get(a) ?? '') ? 1 : (vids[a].title ?? '').localeCompare(vids[b].title ?? ''));
      const date = h('input', { type: 'date', id: 'log-date', value: day, max: today, 'aria-label': 'Day' });
      const tabs = h('div', { class: 'tabs small', role: 'tablist' },
        h('button', { class: `tab${mode === 'library' ? ' on' : ''}`, type: 'button', id: 'log-mode-library', role: 'tab', 'aria-selected': mode === 'library', onclick: () => { mode = 'library'; draw(); } }, 'A video from my library'),
        h('button', { class: `tab${mode === 'other' ? ' on' : ''}`, type: 'button', id: 'log-mode-other', role: 'tab', 'aria-selected': mode === 'other', onclick: () => { mode = 'other'; draw(); } }, 'Something without a video'));
      let body;
      if (mode === 'library') {
        if (!ids.length) body = h('p', { class: 'hint' }, 'Your library is empty. Use “Something without a video”, or press “✓ Did today” on any video in Today or Library.');
        else {
          const pick = h('select', { id: 'log-video', 'aria-label': 'Which routine' }, ids.map((id) => h('option', { value: id }, `${vids[id].title}${vids[id].channel ? ` · ${vids[id].channel}` : ''}${vids[id].durationSec ? ` · ${formatDuration(vids[id].durationSec)}` : ''}`)));
          body = h('div', { class: 'log-form' },
            h('label', null, h('span', null, 'Routine'), pick), h('label', null, h('span', null, 'Day'), date),
            h('button', { class: 'btn primary', type: 'button', id: 'log-continue', onclick: () => { sel.day = date.value || today; openFeedback(pick.value, { date: date.value || today, onDone: (how) => { if (how === 'saved') redraw(); } }); } }, 'Continue'));
        }
      } else {
        const title = h('input', { type: 'text', id: 'other-title', maxlength: 120, placeholder: 'e.g. Yoga class, 10 min on my own, physio exercises', 'aria-label': 'What you did' });
        const minutes = h('input', { type: 'number', id: 'other-minutes', min: 1, max: 600, value: '15', 'aria-label': 'Minutes' });
        const chips = h('div', { class: 'chips', id: 'other-areas' }, AREAS.filter((a) => !a.parent && a.id !== 'full_body').map((a) => h('button', {
          type: 'button', class: `chip${chosen.has(a.id) ? ' on' : ''}`, 'aria-pressed': chosen.has(a.id), 'data-area': a.id,
          onclick: (e) => { if (chosen.has(a.id)) chosen.delete(a.id); else chosen.add(a.id); e.currentTarget.classList.toggle('on'); e.currentTarget.setAttribute('aria-pressed', chosen.has(a.id)); },
        }, a.label)));
        body = h('div', null,
          h('div', { class: 'log-form' },
            h('label', null, h('span', null, 'What did you do?'), title), h('label', null, h('span', null, 'Minutes'), minutes), h('label', null, h('span', null, 'Day'), date)),
          h('p', { class: 'hint' }, 'Which muscles did it work? (optional: it counts toward your “last 4 weeks” map)'), chips,
          h('div', { class: 'actions' },
            h('button', { class: 'btn primary', type: 'button', id: 'other-save', onclick: () => {
              const d = date.value || today;
              if (!title.value.trim()) { title.focus(); return; }
              logSession(state, { videoId: '', title: title.value, minutes: Number(minutes.value), date: d, areas: [...chosen].map((id) => ({ id, mode: 'tight' })) });
              store.save(); sel.day = d; toast('Logged.', 'success'); redraw();
            } }, 'Add to my log')));
      }
      fill(logSlot, h('div', { class: 'log-panel' }, tabs, body, h('button', { class: 'btn small ghost', type: 'button', onclick: () => fill(logSlot) }, 'Close')));
    };
    draw();
  };
  drawDay();

  // ---------------------------------------------------------------- achievements and per-muscle progress
  const ms = milestones(hist, vids, today);
  const ap = areaProgress(hist, { today });
  const TREND = { up: ['↗', 'helping more than at the start', 'up'], steady: ['→', 'helping about as much as before', 'steady'], down: ['↘', 'helping less than at the start; worth trying something different', 'down'] };

  return h('section', { class: 'panel', id: 'training-log' },
    h('h2', null, 'Training log'),
    h('div', { id: 'encouragement' }, encouragement(hist, vids, { goal, today }).map((line) => h('p', { class: 'nudge' }, line))),
    tiles,
    h('div', { class: 'log-tools' },
      h('label', { class: 'inline' }, 'Weekly goal: ', goalSelect),
      h('button', { class: 'btn small', type: 'button', id: 'log-open', onclick: openLogForm }, '＋ Log something I did'),
      h('button', { class: 'btn small ghost', type: 'button', id: 'log-csv', disabled: !hist.length, onclick: () => download(`unfurl-training-log-${today}.csv`, historyCsv(hist, vids), 'text/csv') }, 'Download as spreadsheet (CSV)')),
    logSlot,
    daySlot,
    h('div', { class: 'log-cols' },
      h('div', null, h('h3', null, 'Last 12 weeks'), weeksEl,
        goal ? h('p', { class: 'hint' }, `Green weeks reached your goal of ${plural(goal, 'routine', 'routines')}.`) : null),
      h('div', null, h('h3', null, 'Calendar'), calSlot)),
    h('div', { class: 'log-cols' },
      h('div', { id: 'milestones' },
        h('h3', null, 'Achievements'),
        ms.earned.length
          ? h('ul', { class: 'trophies' }, ms.earned.map((m) => h('li', { 'data-milestone': m.id }, h('span', { class: 'ico', 'aria-hidden': 'true' }, m.icon), h('span', null, m.label, h('small', { class: 'muted' }, ` · ${shortDate(m.date)}`)))))
          : h('p', { class: 'empty-note' }, 'Your first routine earns the first one.'),
        ms.next.length ? h('div', { class: 'upnext' }, h('h4', null, 'Next up'),
          ms.next.map((n) => h('div', { class: 'next-row', 'data-next': n.id }, h('span', null, n.icon, ' ', n.label, h('small', { class: 'muted' }, ` · ${Math.min(n.have, n.need)} of ${n.need} ${n.unit}`)), barOf(n.have / n.need)))) : null),
      h('div', { id: 'area-progress' },
        h('h3', null, 'Progress by muscle'),
        ap.length
          ? h('div', { class: 'prog' }, ap.map((a) => h('div', { class: 'prog-row', 'data-area': a.area },
            h('span', { class: 'c-label' }, a.label),
            h('span', { class: 'muted' }, `${plural(a.sessions, 'routine', 'routines')}${a.helped != null ? `, ${Math.round(a.helped * 100)}% helped` : ''}`),
            a.trend ? h('span', { class: `trend ${a.trend}`, title: `First answers: ${Math.round(a.early * 100)}% helpful; latest: ${Math.round(a.recent * 100)}%` }, `${TREND[a.trend][0]} ${TREND[a.trend][1]}`)
              : h('span', { class: 'muted' }, a.answers ? `${plural(a.answers, 'answer', 'answers')}; a trend shows after 6` : 'no “did it help?” answers yet'))))
          : h('p', { class: 'empty-note' }, 'Once you have done a few routines, you will see here which muscles you work most and whether they are improving.'))));
}
