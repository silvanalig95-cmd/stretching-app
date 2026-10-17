// The quota sweep: spend what is left of today's YouTube allowance (and the AI helper's requests) on widening and reading the library,
// so a day's free allowance isn't simply lost when it resets. It only does things the app already does by hand, in turn, and keeps a
// reserve of units untouched:
//   - check followed teachers for new uploads (a few units each)
//   - read the viewer comments of library videos that have none (1 unit each: this is where the muscle evidence comes from)
//   - read more of the channels you like (favourites, followed, most of your library): their newest 150 uploads, later up to 500
//   - search for the muscle areas the library covers least
//   - read the rest of the comments of videos found so far
//   - then, if the AI helper is set up, let Gemini read library videos with what is left of its allowance
// The work is shared out in turns, so a big job (a long upload list) can't use up everything before the others get a go.
// Runs in the page ("Run it now") and headless on the server (sweep.mjs, at the time you chose).

import { ctx, quotaInfo, growLibrary, readMissingComments, importInputs, refreshFollowedNow, client } from './ctx.js';
import { coverage } from './model.js';
import { needsComments, QuotaError, KeyError } from './youtube.js';
import { parentOf, areaLabel } from './lexicon.js';
import { channelMatcher, normName } from './channel.js';
import { aiStatus } from './gemini.js';
import { aiCandidates, readMany } from './aiwork.js';

export const SWEEP_DEFAULTS = { enabled: false, hoursBefore: 2, reserve: 300, ai: true };

// ---------------------------------------------------------------- what is worth doing (pure: these only read the state)

/**
 * Channels worth reading more of, best first: [{id, name, why, max}]. Only channels whose id is known (finding one by name costs a
 * search). A channel is read to 150 uploads first and, when that came back nearly full, once more to 500; after that it is done.
 */
export function channelsToRead(state, { limit = 12 } = {}) {
  const byId = new Map();   // channel id -> {name, score, why[]}
  const add = (id, name, score, why) => {
    if (!id) return;
    const e = byId.get(id) ?? { id, name: name || state.channels?.[id]?.name || '', score: 0, why: [] };
    e.score += score; if (why && !e.why.includes(why)) e.why.push(why);
    if (!e.name && name) e.name = name;
    byId.set(id, e);
  };
  const idOf = (name) => Object.values(state.videos).find((v) => v.channelId && v.channel && normName(v.channel) === normName(name))?.channelId ?? null;
  for (const c of state.favoriteChannels ?? []) add(c.channelId || idOf(c.name), c.name, 3, 'a favourite');
  for (const f of state.following ?? []) add(f.channelId, f.name, 2, 'followed');
  const inLibrary = new Map();   // channel id -> {name, n}: how many of your library videos are from it
  for (const id of Object.keys(state.library ?? {})) { const v = state.videos[id]; if (v?.channelId) inLibrary.set(v.channelId, { name: v.channel, n: (inLibrary.get(v.channelId)?.n ?? 0) + 1 }); }
  for (const [id, { name, n }] of inLibrary) add(id, name, Math.min(n, 5) * 0.3, `${n} in your library`);
  const blocked = channelMatcher(state.blockedChannels ?? []);
  const out = [];
  for (const e of byId.values()) {
    if (blocked({ channelId: e.id, channel: e.name })) continue;
    const swept = state.channels?.[e.id]?.swept;
    const max = !swept ? 150 : swept.max === 150 && swept.got >= 120 ? 500 : 0;
    if (max) out.push({ ...e, max, why: e.why.join(', ') });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

/** The muscle areas the library covers least (general ones), two at a time, rotating so every round aims somewhere new. */
export function thinAreas(state, round = 0, n = 2) {
  const cov = coverage(Object.keys(state.library).map((id) => state.videos[id]).filter(Boolean), state.blocked);
  const known = coverage(Object.values(state.videos), state.blocked);
  const order = Object.keys(cov).filter((a) => a !== 'full_body' && !parentOf(a)).sort((a, b) => cov[a] - cov[b] || known[a] - known[b] || a.localeCompare(b));
  if (!order.length) return [];
  return Array.from({ length: Math.min(n, order.length) }, (_, i) => order[(round * n + i) % order.length]);
}

// ---------------------------------------------------------------- the run

/**
 * @param {{reserve?:number, ai?:boolean, progress?:(m:string)=>void, shouldStop?:()=>boolean, maxMs?:number, clock?:()=>number, maxPasses?:number}} [o]
 *   reserve: units of today's allowance to leave untouched
 * @returns {Promise<{startedLeft:number, left:number, spent:number, steps:{name:string, units:number, detail:string}[], added:number, commentsRead:number,
 *   channelsRead:number, searches:number, aiRead:number, stopped:string, notes:string[]}>}
 */
export async function runAutopilot({ reserve = SWEEP_DEFAULTS.reserve, ai = true, progress = () => {}, shouldStop = () => false, maxMs = 90 * 60 * 1000, clock = Date.now, maxPasses = 80 } = {}) {
  const { state } = ctx;
  const t0 = clock();
  const out = { startedLeft: quotaInfo().left, left: 0, spent: 0, steps: [], added: 0, commentsRead: 0, channelsRead: 0, searches: 0, aiRead: 0, stopped: '', notes: [] };
  const finish = () => { out.left = quotaInfo().left; out.spent = out.startedLeft - out.left; return out; };
  if (!client()) { out.stopped = 'no_key'; out.notes.push('There is no YouTube key to use (Settings), and the server has no shared one.'); return finish(); }

  const free = () => quotaInfo().left - reserve;
  const over = () => shouldStop() || clock() - t0 > maxMs;
  const log = (name, units, detail) => { if (units || detail) out.steps.push({ name, units, detail }); };
  const spentSince = (before) => before - quotaInfo().left;
  const failed = new Set();   // tasks that found nothing to do (or nothing new): not tried again
  let round = 0, noNewSearches = 0;

  // each task returns false when it had nothing to do
  const tasks = {
    followed: async () => {
      const n = state.following?.length ?? 0;
      if (!n || free() < 2 * n + 30) return false;
      const before = quotaInfo().left;
      const r = await refreshFollowedNow(() => {});
      out.added += r.added ?? 0;
      log('Followed teachers', spentSince(before), `${r.checked} checked, ${r.added ?? 0} new videos`);
      return false;   // once is enough
    },
    libraryComments: async () => {
      const todo = Object.keys(state.library).map((id) => state.videos[id]).filter((v) => v && needsComments(v)).length;
      if (!todo || free() < 20) return false;
      const before = quotaInfo().left;
      const r = await readMissingComments({ max: Math.min(150, todo), keep: reserve, onlyLibrary: true });
      out.commentsRead += r.read;
      log('Comments on your videos', spentSince(before), `${r.read} read`);
      return r.read > 0;
    },
    deepen: async () => {
      const next = channelsToRead(state, { limit: 1 })[0];
      if (!next || free() < 60) return false;
      const max = Math.min(next.max, Math.max(50, Math.floor((free() - 10) / 2)));
      const before = quotaInfo().left;
      progress(`Reading ${next.name || next.id}…`);
      const res = await importInputs(next.id, { maxVideos: max, keep: reserve });
      const got = res.imported ?? 0;
      if (max >= next.max) state.channels[next.id] = { ...(state.channels[next.id] ?? { id: next.id, name: next.name }), swept: { at: Date.now(), max: next.max, got } };   // (a read cut short by the budget is tried again another day)
      ctx.store.save();
      out.added += got; out.channelsRead++;
      log(`Teacher: ${next.name || next.id}`, spentSince(before), `${got} videos (${next.why})${res.problems?.length && !got ? `: ${res.problems[0]}` : ''}`);
      return true;
    },
    grow: async () => {
      if (free() < 250) return false;
      const areas = thinAreas(state, round++);
      if (!areas.length) return false;
      const before = quotaInfo().left;
      progress(`Searching for ${areas.map(areaLabel).join(' & ')}…`);
      const { added, report } = await growLibrary(areas, { keep: reserve });
      out.added += added; out.searches += report.queries?.length ?? 1; out.commentsRead += report.commentsRead ?? 0;
      log(`Search: ${areas.map(areaLabel).join(' & ')}`, spentSince(before), `${added} new videos, ${report.commentsRead ?? 0} comments read`);
      noNewSearches = added ? 0 : noNewSearches + 1;
      return noNewSearches < 2;   // two empty searches in a row: more of the same would only repeat itself
    },
    anyComments: async () => {
      if (free() < 20 || !Object.values(state.videos).some(needsComments)) return false;
      const before = quotaInfo().left;
      const r = await readMissingComments({ max: Math.min(150, Math.max(0, free())), keep: reserve });
      out.commentsRead += r.read;
      log('Comments on other videos', spentSince(before), `${r.read} read`);
      return r.read > 0;
    },
  };
  const order = ['followed', 'libraryComments', 'deepen', 'grow', 'anyComments'];

  try {
    for (let pass = 0; pass < maxPasses && !over(); pass++) {
      let did = false;
      for (const name of order) {
        if (failed.has(name) || over()) continue;
        const before = quotaInfo().left;
        const more = await tasks[name]();
        if (more === false) failed.add(name);
        if (more || quotaInfo().left < before) did = true;
      }
      if (!did) break;
    }
  } catch (e) {
    if (e instanceof QuotaError) { out.stopped = 'quota'; out.notes.push('YouTube says today’s allowance is used up.'); }
    else if (e instanceof KeyError) { out.stopped = 'key'; out.notes.push(e.message); }
    else { out.stopped = 'error'; out.notes.push(e.message); }
  }
  if (!out.stopped) out.stopped = over() ? (shouldStop() ? 'you' : 'time') : free() < 250 ? 'budget' : 'done';

  // the AI helper has its own daily allowance (and Google's video-hours limit): a few videos watched, then the rest read
  if (ai && !shouldStop() && out.stopped !== 'key') {
    try {
      const st = await aiStatus({ fresh: true });
      if (st?.ready) {
        const allowed = Math.max(0, (st.dailyCap || 60) - (st.usedToday || 0) - 2);
        const watch = aiCandidates('video').slice(0, Math.min(6, allowed));
        let used = 0;
        if (watch.length) { const r = await readMany(watch, { mode: 'video', shouldStop: over, pauseMs: 0, progress }); used += r.done + r.failed.length; out.aiRead += r.done; log('Gemini watched videos', 0, `${r.done} watched${r.stopped ? ` (stopped: ${r.stopped})` : ''}`); if (r.stopped && r.stopped !== 'you') out.notes.push(r.message ?? `Gemini stopped: ${r.stopped}`); }
        const text = aiCandidates('text').slice(0, Math.max(0, allowed - used));
        if (text.length && !over()) { const r = await readMany(text, { mode: 'text', shouldStop: over, progress }); out.aiRead += r.done; log('Gemini read videos', 0, `${r.done} read${r.stopped ? ` (stopped: ${r.stopped})` : ''}`); if (r.stopped && r.stopped !== 'you') out.notes.push(r.message ?? `Gemini stopped: ${r.stopped}`); }
      }
    } catch (e) { out.notes.push(`The AI helper: ${e.message}`); }
  }
  ctx.store.save();
  return finish();
}

/** A few words for a toast or a log line. */
export function sweepSummary(r) {
  const bits = [`${r.spent.toLocaleString()} YouTube units used`, r.added ? `${r.added} new videos` : null, r.commentsRead ? `${r.commentsRead} comments read` : null, r.channelsRead ? `${r.channelsRead} teachers read` : null,
    r.searches ? `${r.searches} searches` : null, r.aiRead ? `${r.aiRead} videos read by Gemini` : null].filter(Boolean);
  const why = { done: 'nothing left to do', budget: 'the reserve was reached', quota: 'the day’s allowance ran out', time: 'out of time', you: 'stopped', no_key: 'no YouTube key', key: 'the key was refused', error: 'stopped by an error' }[r.stopped] ?? r.stopped;
  return `${bits.join(', ')} (${why}).`;
}
