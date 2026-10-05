// Shared app logic used by all views: the current request (filters), ranking,
// the "find my routine" flow (local + live web search), importing sources,
// following teachers, and picking options. Views register small hooks (render
// functions, toast) on `ctx.hooks`.

import {
  YouTubeClient, discover, verifyVideos, spendQuota, quotaUsed, estimateRunCost, parseSourceInput, importSource, refreshFollowed,
  fetchOEmbed, KeyError, QuotaError, DAILY_QUOTA,
} from './youtube.js';
import { buildModel, rankCandidates, pickRoutine, seededRng, localDate, mulberry32, neglectedAreas } from './model.js';
import { applyDiscovery, addManualVideo, importRecords, followChannel } from './state.js';
import { attachComments } from './analyze.js';
import { SearchIndex } from './index.js';
import { areaLabel } from './lexicon.js';

export const ctx = {
  store: null,
  hooks: { renderResults() {}, renderFilters() {}, renderLog() {}, toast(msg) { console.log(msg); }, navigate() {} },
  ui: {
    tab: 'today',
    filters: { areas: [], minMin: 10, maxMin: 25, styles: [], hints: [], terms: [], source: 'all' },
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
    termsIgnored: false,   // typed words that nothing in the library mentions
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
  if (f.terms?.length) parts.push(`“${f.terms.join(' ')}”`);
  parts.push(f.minMin == null && f.maxMin == null ? 'any length' : `${f.minMin ?? 0}–${f.maxMin ?? '∞'} min`);
  if (f.styles.length) parts.push(f.styles.join(', '));
  if (f.source === 'library') parts.push('my library only');
  return parts.join(' · ');
}

export function setLength(minMin, maxMin) {
  const f = ctx.ui.filters;
  f.minMin = minMin; f.maxMin = maxMin;
  ctx.state.prefs.minMin = minMin ?? 3; ctx.state.prefs.maxMin = maxMin ?? 90;
  ctx.store.save();
}

/** Cycle an area: off -> tight -> weak -> off. */
export function cycleArea(id, list = ctx.ui.filters.areas) {
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) list.push({ id, mode: 'tight' });
  else if (list[i].mode === 'tight') list[i].mode = 'weak';
  else list.splice(i, 1);
}

export function applyParsed(parsed) {
  const f = ctx.ui.filters;
  if (parsed.areas.length) f.areas = parsed.areas.map((a) => ({ ...a }));
  if (parsed.minMin != null) setLength(parsed.minMin, parsed.maxMin);
  f.styles = parsed.styles.length ? [...parsed.styles] : f.styles;
  f.hints = parsed.hints;
  f.terms = parsed.terms ?? [];
}

// ---------------------------------------------------------------- ranking & picking

const libraryIds = () => new Set(Object.keys(ctx.state.library));

export function rankNow() {
  const { state, ui } = ctx;
  const model = buildModel(state.history, state.videos);
  let textScores = null;
  ui.termsIgnored = false;
  if (ui.filters.terms?.length) {
    const rel = SearchIndex.fromVideos(state.videos, state.library).relevance(ui.filters.terms, {});
    if (rel.size) textScores = rel; else ui.termsIgnored = true;   // nothing known mentions it: don't let it empty the results
  }
  ui.ranked = rankCandidates({
    videos: Object.values(state.videos), filters: ui.filters, model, textScores, libraryIds: libraryIds(),
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
    videos: [v], filters: { areas: ctx.ui.filters.areas, minMin: 0, maxMin: 999, styles: [] }, model, libraryIds: libraryIds(),
    trusted: ctx.state.prefs.trusted, blocked: [], adventure: ctx.state.prefs.adventure,
  })[0] ?? { video: v, score: 0, parts: {}, flags: { inLibrary: libraryIds().has(videoId), suggestion: v.source === 'suggestion' }, reasons: [] };
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

/** First visit / after changes: rank what we know and pick, without searching the web. */
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
 * for new candidates first. New finds are saved to the index for good (and to the
 * library too if "auto-add" is on).
 */
export async function findRoutine({ web = ctx.state.prefs.searchWeb } = {}) {
  const { ui, state, store } = ctx;
  if (ui.busy) return;
  ui.busy = true; ui.log = []; ui.report = null; ui.foundIds = new Set(); ui.salt = 0; ui.shown.clear();
  ctx.hooks.renderResults();

  const api = web ? client() : null;
  if (web && !api) say('No YouTube key yet, so showing what’s already known. Add a key in Settings to search the web.');
  if (api) {
    try {
      await verifySuggestions(api);
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
      if (e instanceof KeyError || e instanceof QuotaError) ctx.hooks.toast(e.message, 'error');
      else ctx.hooks.toast(`Web search failed: ${e.message}. Showing what’s already known instead.`, 'error');
    }
    store.save();
  }

  rankNow();
  if (ctx.hasKey) await enrichTop();
  if (!pick(false)) ui.featuredId = null;
  ui.busy = false;
  ctx.hooks.renderResults();
}

/**
 * Read comments for the best few results that haven't had theirs read yet (1 unit
 * each), then re-rank. This is how videos imported in bulk (no comments read) earn
 * their "what viewers say" evidence, only when they actually become contenders.
 */
export async function enrichTop(n = ctx.state.prefs.enrichTop) {
  const api = client();
  if (!api || !n) return 0;
  const todo = ctx.ui.ranked.map((r) => r.video).filter((v) => !v.comments && !(v.evidence?.n > 0) && v.verified).slice(0, n);
  let done = 0;
  for (const v of todo) {
    try {
      ctx.state.videos[v.id] = attachComments(ctx.state.videos[v.id], await api.comments(v.id));
      done++;
    } catch (e) { if (e instanceof QuotaError || e instanceof KeyError) break; }
  }
  if (done) { ctx.store.save(); rankNow(); say(`Read comments on the top ${done} result${done > 1 ? 's' : ''}.`); }
  return done;
}

/** First time we have a key, correct the suggested videos' guessed metadata. */
async function verifySuggestions(api) {
  const { state, ui } = ctx;
  if (ui.verifiedTried) return;
  const todo = Object.values(state.videos).filter((v) => v.source === 'suggestion' && !v.verified && !v.broken).slice(0, 50);
  ui.verifiedTried = true;
  if (!todo.length) return;
  say(`Checking ${todo.length} suggested videos against YouTube…`);
  const fixed = await verifyVideos({ client: api, videos: todo });
  for (const v of fixed) state.videos[v.id] = v;
  const gone = fixed.filter((v) => v.broken).length;
  if (gone) say(`${gone} suggested video(s) no longer exist and were removed.`);
}

export async function growLibrary(areaIds, { queries = 3 } = {}) {
  const prev = { ...ctx.ui.filters, areas: ctx.ui.filters.areas.map((a) => ({ ...a })) };
  ctx.ui.filters = { areas: areaIds.map((id) => ({ id, mode: 'tight' })), minMin: null, maxMin: null, styles: [], hints: [], terms: [], source: 'all' };
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

// ---------------------------------------------------------------- bringing things in

/** Split pasted text into items: one per line (names have spaces), or several links on one line. */
export function splitInputs(text) {
  const items = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[\s,]+/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => parseSourceInput(p).type !== 'search')) items.push(...parts);
    else items.push(t.replace(/,$/, ''));
  }
  return [...new Set(items)];
}

/**
 * Import whatever was pasted: video links, playlists, teachers (channel link, @handle or name).
 * Single videos go to the library; teachers' catalogues and playlists go to "Discovered" unless toLibrary.
 */
export async function importInputs(text, { toLibrary = false, follow = false, progress = () => {} } = {}) {
  const { state } = ctx;
  const items = splitInputs(text);
  const out = { videos: 0, imported: 0, followed: [], names: [], problems: [] };
  if (!items.length) { out.problems.push('Nothing to add yet. Paste a YouTube link, playlist, or teacher.'); return out; }
  const api = client();
  const classified = items.map((i) => ({ raw: i, ...parseSourceInput(i) }));

  // single videos: one batched call (or oEmbed one by one without a key)
  const vids = classified.filter((c) => c.type === 'video');
  if (vids.length) {
    if (api) {
      progress(`Reading ${vids.length} video${vids.length > 1 ? 's' : ''}…`);
      const records = await api.videos(vids.map((v) => v.value));
      const found = new Set(records.map((r) => r.id));
      for (const r of records) {
        const rec = addManualVideo(state, { ...r, source: 'manual' });
        if (!rec.comments) { try { state.videos[r.id] = attachComments(rec, await api.comments(r.id)); } catch { /* comments are a bonus */ } }
      }
      out.videos += records.length;
      for (const v of vids) if (!found.has(v.value)) out.problems.push(`No public video found for ${v.value}.`);
    } else {
      for (const v of vids.slice(0, 20)) {
        progress(`Adding ${v.value}…`);
        const meta = await fetchOEmbed(v.value);
        addManualVideo(state, { id: v.value, title: meta?.title || 'Video (title loads when played)', channel: meta?.channel || '' });
        out.videos++;
      }
      if (vids.length > 20) out.problems.push('Without a YouTube key only the first 20 links are added at once.');
    }
  }

  // playlists and teachers: need the API
  for (const c of classified.filter((x) => x.type !== 'video')) {
    if (!api) { out.problems.push(`“${c.raw}” needs a YouTube key (Settings) to import.`); continue; }
    try {
      const res = await importSource({ client: api, input: c, state, progress });
      importRecords(state, res.records, { toLibrary });
      Object.assign(state.channels, res.channels);
      out.imported += res.records.length; out.names.push(res.title);
      if (!res.records.length) out.problems.push(`“${res.title || c.raw}” had no usable videos (too short, live, or not embeddable).`);
      if (follow && res.channel) { followChannel(state, { channelId: res.channel.id, name: res.channel.name }); out.followed.push(res.channel.name); }
    } catch (e) { out.problems.push(e.message); }
  }
  ctx.store.save();
  return out;
}

export async function refreshFollowedNow(progress = () => {}) {
  const api = client();
  if (!api) throw new Error('Add a YouTube key in Settings first.');
  const res = await refreshFollowed({ client: api, state: ctx.state, progress });
  const added = importRecords(ctx.state, res.records);
  for (const u of res.updated) {
    const f = ctx.state.following.find((x) => x.channelId === u.channelId);
    if (f) Object.assign(f, { uploads: u.uploads, lastChecked: u.lastChecked });
  }
  ctx.store.save();
  return { added, checked: res.updated.length, records: res.records };
}

// ---------------------------------------------------------------- your body

/** Fill the request from your standing tight/weak spots. */
export function useMySpots() {
  const spots = ctx.state.prefs.focus;
  if (!spots.length) return false;
  ctx.ui.filters.areas = spots.map((s) => ({ ...s }));
  return true;
}

/** Aim at the standing spots (or most-worked areas) you've gone longest without working. */
export function aimAtNeglected(n = 2) {
  const list = neglectedAreas(ctx.state.prefs.focus, ctx.state.history, { n });
  if (!list.length) return null;
  ctx.ui.filters.areas = list.map(({ id, mode }) => ({ id, mode }));
  return list;
}
