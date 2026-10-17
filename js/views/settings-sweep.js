// Settings → Use up the day's leftover allowance: near the end of YouTube's day, the server spends what is left of the daily YouTube
// allowance (and the AI helper's requests) on widening and reading the library. This panel switches it on, says when it will run, can
// run it now, and shows what the last run did. The work itself is js/autopilot.js, run by the server with Node (sweep.mjs).

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { toast } from '../modal.js';

const HEADERS = { 'X-Unfurl': '1', 'Content-Type': 'application/json' };
const api = async (method, path, body) => {
  try {
    const r = await fetch(path, { method, headers: HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const json = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json };
  } catch { return { ok: false, status: 0, json: null }; }
};

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const when = (iso) => {
  const d = new Date(iso), now = new Date();
  const day = d.toDateString() === now.toDateString() ? 'today' : d.toDateString() === new Date(now.getTime() + 864e5).toDateString() ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'long' });
  return `${day} at ${clock(iso)}`;
};
const HOURS = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
const WHY = { done: 'it ran out of useful things to do', budget: 'it reached the reserve', quota: 'YouTube said the day’s allowance was used up', time: 'it ran out of time', you: 'it was stopped', no_key: 'there is no YouTube key', key: 'the key was refused', error: 'an error stopped it' };

export function sweepPanel() {
  const el = h('section', { class: 'panel', id: 'sweep-panel' }, h('h2', null, 'Use up the day’s leftover allowance'), h('p', { class: 'hint' }, 'Loading…'));
  let timer = null, sawRunning = false;   // sawRunning: a run finished while this page was open, so the page doesn't know what it found yet

  async function draw() {
    clearTimeout(timer);
    const res = await api('GET', '/api/sweep');
    const st = res.ok ? res.json : null;
    const head = [h('h2', null, 'Use up the day’s leftover allowance'),
      h('p', null, 'YouTube’s free allowance (10,000 units a day) starts again at midnight in California, and whatever is left until then is simply lost. Olympus can spend it for you shortly before that on what it does by hand: reading the comments of videos that have none, reading more of the teachers you like, searching for the muscles your library covers least, and (if the AI helper is set up) letting Gemini read videos with its leftover requests. It keeps a reserve and only uses what you haven’t.')];
    if (!st) { fill(el, ...head, h('p', { class: 'hint', id: 'sweep-needs-server' }, 'This needs the server (start.bat or Docker): it runs there, at the chosen time, whether or not this page is open.')); return; }
    const s = st.settings;
    const patch = async (change) => { const r = await api('PUT', '/api/sweep', change); if (!r.ok) toast(r.json?.message ?? 'Couldn’t save that.', 'error'); await draw(); };
    const last = st.last;
    if (st.running || (st.busy && !last)) { timer = setTimeout(draw, 3000); sawRunning = true; }   // a run is under way: keep looking
    fill(el, ...head,
      !st.available ? h('p', { class: 'warn-note', id: 'sweep-unavailable' }, st.reason) : null,
      h('label', { class: 'check sweep-main' }, h('input', { type: 'checkbox', id: 'sweep-on', checked: s.enabled, disabled: !st.available, onchange: (e) => patch({ enabled: e.target.checked }) }), ' Run it automatically every day'),
      h('div', { class: 'sweep-opts' },
        h('label', { class: 'field inline-field' }, h('span', null, 'Start'),
          h('select', { id: 'sweep-hours', onchange: (e) => patch({ hoursBefore: Number(e.target.value) }) },
            HOURS.map((x) => h('option', { value: x, selected: x === s.hoursBefore }, `${x === 1 ? '1 hour' : `${x} hours`} before it starts again (${clock(new Date(Date.parse(st.resetAt) - x * 3600e3).toISOString())})`)))),
        h('label', { class: 'field inline-field' }, h('span', null, 'Keep'),
          h('input', { type: 'number', id: 'sweep-reserve', min: 0, max: 9000, step: 50, value: s.reserve, 'aria-label': 'Units to keep untouched', onchange: (e) => patch({ reserve: Math.max(0, Math.min(9000, Math.round(Number(e.target.value) || 0))) }) }), h('span', { class: 'hint' }, 'units untouched')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'sweep-ai', checked: s.ai, onchange: (e) => patch({ ai: e.target.checked }) }), ' Let Gemini read videos with its leftover requests too (needs the AI helper)')),
      h('p', { class: 'hint', id: 'sweep-next' }, !s.enabled ? `Off. YouTube’s allowance next starts again ${when(st.resetAt)}.`
        : !st.scheduled ? 'It can’t run by itself on this server (people are identified by a login proxy, so it can’t know whose library to use). “Run it now” still works.'
          : `Next run ${when(st.nextRunAt)}${st.nextRunAt && Date.parse(st.nextRunAt) <= Date.now() + 6e4 ? ', as soon as nobody has used Olympus for ten minutes' : ''}. Your allowance starts again ${when(st.resetAt)}.`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', id: 'sweep-run', disabled: !st.available || st.busy, title: 'Spends what is above the reserve right now, on this account’s own YouTube key (or the server’s)', onclick: async () => {
          const r = await api('POST', '/api/sweep/run');
          if (!r.ok) toast(r.json?.message ?? 'Couldn’t start it.', 'error'); else toast('Started. It runs on the server, and takes a few minutes.', 'info');
          await draw();
        } }, st.running ? 'Running…' : 'Run it now')),
      last ? h('div', { class: 'sweep-last', id: 'sweep-last' },
        h('h3', null, 'The last run'),
        h('p', null, `${last.trigger === 'schedule' ? 'Automatic' : 'By hand'}, ${when(last.at)} · took ${last.seconds >= 90 ? `${Math.round(last.seconds / 60)} min` : `${last.seconds} s`}`),
        last.ok && last.report ? h('p', { id: 'sweep-summary' }, last.report.summary ?? '') : h('p', { class: 'warn-note', id: 'sweep-error' }, last.error || 'It did not finish.'),
        last.report?.steps?.length ? h('details', { class: 'steps' }, h('summary', null, `What it did (${last.report.steps.length} steps)`),
          h('ul', null, last.report.steps.map((x) => h('li', null, `${x.name}${x.units ? ` — ${x.units.toLocaleString()} units` : ''}${x.detail ? `: ${x.detail}` : ''}`)))) : null,
        sawRunning && !st.running && last.ok ? h('p', null, 'It finished while this page was open. ', h('button', { class: 'btn small', type: 'button', id: 'sweep-reload', onclick: async () => { await ctx.store.flushReliably(); location.reload(); } }, 'Reload to see what it found')) : null,
        last.report?.stopped && last.report.stopped !== 'done' ? h('p', { class: 'hint' }, `It stopped because ${WHY[last.report.stopped] ?? last.report.stopped}.`) : null,
        last.report?.notes?.length ? h('ul', { class: 'hint' }, last.report.notes.map((n) => h('li', null, n))) : null) : null,
      h('details', { class: 'steps' }, h('summary', null, 'How it works, and what to know'),
        h('ul', null,
          h('li', null, 'It runs on the server with the YouTube key saved there (yours, or the shared one, whose per-person share still applies), so the server has to be on at that time. It never starts while somebody is using Olympus (it waits until nobody has for ten minutes), and runs once a day.'),
          h('li', null, 'YouTube’s day ends at midnight in California, which is why the start is “hours before it starts again”: that moment is shown in your own time. If you stretch around then, choose an earlier start or a bigger reserve, because the sweep leaves nothing for after it.'),
          h('li', null, 'Everything it finds goes to “Discovered” (nothing is added to your library by itself) and is analysed as usual. Your own data is saved the same careful way as when you use the page.'),
          h('li', null, 'It needs Node.js 18 or newer next to the server. The Docker version includes it; with start.bat, install Node from nodejs.org.'),
          h('li', null, ctx.hasKey ? 'A YouTube key is set up.' : 'There is no YouTube key yet (see the first panel above): without one the sweep has nothing to spend.'))));
  }
  draw();
  return el;
}
