// Shared app logic used by all views: the current request (filters), ranking,
// the "find my routine" flow (local + live web search), and picking options.
// Views register small hooks (render functions, toast) on `ctx.hooks`.

import { YouTubeClient, discover, verifyVideos, spendQuota, quotaUsed, estimateRunCost, KeyError, QuotaError, DAILY_QUOTA } from './youtube.js';
import { buildModel, rankCandidates, pickRoutine, seededRng, localDate, mulberry32 } from './model.js';
import { applyDiscovery } from './state.js';
import { areaLabel } from './lexicon.js';

export const ctx = {
  store: null,
  hooks: { renderResults() {}, renderFilters() {}, renderLog() {}, toast(msg) { console.log(msg); }, navigate() {} },
  ui: {
    tab: 'today',
    filters: { areas: [], minMin: 10, maxMin: 25, styles: [], hints: [] },
    command: '',
    ranked: [],            // ranked candidates for the current filters
    featuredId: null,
    featuredAreas: [],     // the areas that were being targeted when this video was picked
    shown: new Set(),      // ids already offered this session ("Another one" avoids repeats)
    salt: 0,
    busy: false,
    log: [],
    report: null,
    foundIds: new Set(),   // videos discovered by the most recent web search
    verifiedTried: false,
  },
  get state() { return this.store.state; },
  get hasKey() { return !!this.store.config.apiKey; },
};

export const client = () => (ctx.hasKey
  ? new YouTubeClient({ key: ctx.store.config.apiKey, onSpend: (u) => { spendQuota(ctx.state, u); ctx.store.save(); } })
  : null);

export const quotaInfo = () => ({ used: quotaUsed(ctx.state), limit: DAILY_QUOTA, run: estimateRunCost({ queries: ctx.state.prefs.queriesPerRun, commentVideos: ctx.state.prefs.commentVideos }) });

/** Sync the filters' length with saved preferences (first load). */
export function initFilters() {
  const { prefs } = ctx.state;
  ctx.ui.filters.minMin = prefs.minMin;
  ctx.ui.filters.maxMin = prefs.maxMin;
}

export function describeFilters(f = ctx.ui.filters) {
  const parts = [];
  if (f.areas.length) parts.push(f.areas.map((a) => `${areaLabel(a.id)}${a.mode === 'weak' ? ' (weak)' : ''}`).join(', '));
  parts.push(f.minMin == null && f.maxMin == null ? 'any length' : `${f.minMin ?? 0}–${f.maxMin ?? '∞'} min`);
  if (f.styles.length) parts.push(f.styles.join(', '));
  return parts.join(' · ');
}

export function setLength(minMin, maxMin) {
  const f = ctx.ui.filters;
  f.minMin = minMin; f.maxMin = maxMin;
  ctx.state.prefs.minMin = minMin ?? 3; ctx.state.prefs.maxMin = maxMin ?? 90;
  ctx.store.save();
}

/** Cycle an area: off -> tight -> weak -> off. */
export function cycleArea(id) {
  const f = ctx.ui.filters;
  const i = f.areas.findIndex((a) => a.id === id);
  if (i < 0) f.areas.push({ id, mode: 'tight' });
  else if (f.areas[i].mode === 'tight') f.areas[i].mode = 'weak';
  else f.areas.splice(i, 1);
}

export function applyParsed(parsed) {
  const f = ctx.ui.filters;
  if (parsed.areas.length) f.areas = parsed.areas.map((a) => ({ ...a }));
  if (parsed.minMin != null) setLength(parsed.minMin, parsed.maxMin);
  f.styles = parsed.styles.length ? [...parsed.styles] : f.styles;
  f.hints = parsed.hints;
}

// ---------------------------------------------------------------- ranking & picking

export function rankNow() {
  const { state, ui } = ctx;
  const model = buildModel(state.history, state.videos);
  ui.ranked = rankCandidates({
    videos: Object.values(state.videos), filters: ui.filters, model,
    trusted: state.prefs.trusted, blocked: state.blocked, adventure: state.prefs.adventure,
  });
  return ui.ranked;
}

/** The ranking entry for one video, even when the current filters would exclude it. */
export function entryFor(videoId) {
  const hit = ctx.ui.ranked.find((r) => r.video.id === videoId);
  if (hit) return hit;
  const v = ctx.state.videos[videoId];
  if (!v) return null;
  const model = buildModel(ctx.state.history, ctx.state.videos);
  return rankCandidates({
    videos: [v], filters: { areas: ctx.ui.filters.areas, minMin: 0, maxMin: 999, styles: [] }, model,
    trusted: ctx.state.prefs.trusted, blocked: [], adventure: ctx.state.prefs.adventure,
  })[0] ?? { video: v, score: 0, parts: {}, flags: {}, reasons: [] };
}

function pick(excludeShown) {
  const { ui } = ctx;
  const pool = excludeShown ? ui.ranked.filter((r) => !ui.shown.has(r.video.id)) : ui.ranked;
  const choice = pickRoutine(pool, seededRng(localDate(), ui.salt));
  if (!choice) return false;
  setFeatured(choice.video.id);
  return true;
}

export function setFeatured(id) {
  const { ui } = ctx;
  ui.featuredId = id;
  ui.featuredAreas = ui.filters.areas.map((a) => ({ ...a }));
  ui.shown.add(id);
}

/** First visit / after changes: rank the library and pick, without searching the web. */
export function suggestNow() {
  rankNow();
  return pick(false);
}

/** "Another one": next good option, never one already offered this session. */
export function another() {
  ctx.ui.salt++;
  if (!pick(true)) { ctx.ui.shown.clear(); if (!pick(false)) return false; ctx.hooks.toast('That’s everything that matches. Starting over.'); }
  ctx.hooks.renderResults();
  return true;
}

export function play(videoId, { navigate = true } = {}) {
  setFeatured(videoId);
  if (navigate) ctx.hooks.navigate('today');
  ctx.hooks.renderResults();
}

// ---------------------------------------------------------------- the main flow

const freshRng = () => mulberry32((Math.random() * 2 ** 32) >>> 0);
const say = (line) => { ctx.ui.log.push(line); ctx.hooks.renderLog(); };

/**
 * Find a routine: rank what we know, and (unless web=false) go and search YouTube
 * for new candidates first. New finds are saved to the library for good.
 */
export async function findRoutine({ web = ctx.state.prefs.searchWeb } = {}) {
  const { ui, state, store } = ctx;
  if (ui.busy) return;
  ui.busy = true; ui.log = []; ui.report = null; ui.foundIds = new Set(); ui.salt = 0; ui.shown.clear();
  ctx.hooks.renderResults();

  const api = web ? client() : null;
  if (web && !api) say('No YouTube key yet, so showing your library. Add a key in Settings to search the web.');
  if (api) {
    try {
      await verifyStarters(api);
      const res = await discover({
        client: api, filters: ui.filters, state, rng: freshRng(), progress: say,
        opts: { queries: state.prefs.queriesPerRun, commentVideos: state.prefs.commentVideos },
      });
      const before = new Set(Object.keys(state.videos));
      applyDiscovery(state, res);
      ui.foundIds = new Set(res.records.filter((r) => !before.has(r.id)).map((r) => r.id));
      ui.report = res.report;
      const r = res.report;
      say(`Done: ${ui.foundIds.size} new videos${r.newChannels ? ` from ${r.newChannels} channels you haven’t seen` : ''}; read ${r.commentsRead} viewer comments.`);
      for (const w of r.warnings) say(`⚠ ${w}`);
    } catch (e) {
      say(`⚠ ${e.message}`);
      if (e instanceof KeyError) ctx.hooks.toast(e.message, 'error');
      else if (e instanceof QuotaError) ctx.hooks.toast(e.message, 'error');
      else ctx.hooks.toast(`Web search failed: ${e.message}. Showing your library instead.`, 'error');
    }
    store.save();
  }

  rankNow();
  if (!pick(false)) ui.featuredId = null;
  ui.busy = false;
  ctx.hooks.renderResults();
}

/** First time we have a key, correct the starter videos' guessed metadata. */
async function verifyStarters(api) {
  const { state, ui } = ctx;
  if (ui.verifiedTried) return;
  const todo = Object.values(state.videos).filter((v) => v.source === 'starter' && !v.verified && !v.broken).slice(0, 50);
  ui.verifiedTried = true;
  if (!todo.length) return;
  say(`Checking ${todo.length} starter videos against YouTube…`);
  const fixed = await verifyVideos({ client: api, videos: todo });
  for (const v of fixed) state.videos[v.id] = v;
  const gone = fixed.filter((v) => v.broken).length;
  if (gone) say(`${gone} starter video(s) no longer exist and were removed from suggestions.`);
}

export async function growLibrary(areaIds, { queries = 3 } = {}) {
  const prev = { ...ctx.ui.filters, areas: ctx.ui.filters.areas.map((a) => ({ ...a })) };
  ctx.ui.filters = { areas: areaIds.map((id) => ({ id, mode: 'tight' })), minMin: null, maxMin: null, styles: [], hints: [] };
  const api = client();
  if (!api) { ctx.ui.filters = prev; throw new Error('Add a YouTube key in Settings first.'); }
  ctx.ui.log = [];
  try {
    const res = await discover({
      client: api, filters: ctx.ui.filters, state: ctx.state, rng: freshRng(), progress: say,
      opts: { queries, commentVideos: ctx.state.prefs.commentVideos },
    });
    const added = applyDiscovery(ctx.state, res);
    ctx.store.save();
    return { added, report: res.report };
  } finally {
    ctx.ui.filters = prev;
  }
}
