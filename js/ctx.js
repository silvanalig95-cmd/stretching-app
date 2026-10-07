// Shared app logic used by all views: the current request (filters), ranking,
// the "find my routine" flow (local + live web search), importing sources,
// following teachers, and picking options. Views register small hooks (render
// functions, toast) on `ctx.hooks`.

import {
  YouTubeClient, discover, verifyVideos, readCommentsFor, needsComments, spendQuota, quotaUsed, estimateRunCost, effortFor, parseSourceInput, importSource, refreshFollowed,
  fetchOEmbed, KeyError, QuotaError, DAILY_QUOTA, PROXY_BASE,
} from './youtube.js';
import { buildModel, rankCandidates, pickRoutine, seededRng, localDate, mulberry32, neglectedAreas, composeCombos } from './model.js';
import { applyDiscovery, addManualVideo, addAnalyzedVideo, importRecords, followChannel, setStyleFix } from './state.js';
import { attachComments, analyzeVideoText, attachTranscript, cleanTranscript, reanalyze } from './analyze.js';
import { buildReport } from './report.js';
import { SearchIndex } from './index.js';
import { areaLabel } from './lexicon.js';
import { voiceText } from './teacher.js';

export const ctx = {
  store: null,
  hooks: { renderResults() {}, renderFilters() {}, renderLog() {}, toast(msg) { console.log(msg); }, navigate() {} },
  ui: {
    tab: 'today',
    filters: { areas: [], minMin: 10, maxMin: 25, styles: [], hints: [], terms: [], source: 'all', voice: '' },
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
    combos: null,          // the last combo search: {combos, bestSingle} or null
    combo: null,           // the combo being followed: {ids, index, title}
    verifiedTried: false,
    analysis: null,        // the video last looked at in Library > "Look at a video first": {video, report, notes}
  },
  get state() { return this.store.state; },
  /** True when searching YouTube is possible: either the person's own key, or one the server keeps for everybody. */
  get hasKey() { return !!this.store.config.apiKey || !!this.store.server.ytProxy; },
  /** A key the person pasted themselves wins over the server's shared one (it has its own, bigger allowance). */
  get usesServerKey() { return !this.store.config.apiKey && !!this.store.server.ytProxy; },
};

const withAppHeader = (url) => fetch(url, { headers: { 'X-Unfurl': '1' } });

export const client = () => {
  const onSpend = (u) => { spendQuota(ctx.state, u); ctx.store.save(); };
  if (ctx.store.config.apiKey) return new YouTubeClient({ key: ctx.store.config.apiKey, onSpend });
  if (ctx.store.server.ytProxy) return new YouTubeClient({ key: '', base: PROXY_BASE, fetchFn: withAppHeader, onSpend });
  return null;
};

export const quotaInfo = () => {
  const used = quotaUsed(ctx.state);
  const limit = ctx.usesServerKey && ctx.store.server.ytDailyUnits ? ctx.store.server.ytDailyUnits : DAILY_QUOTA;
  return { used, limit, left: limit - used, run: estimateRunCost(ctx.state.prefs.thoroughness), effort: effortFor(ctx.state.prefs.thoroughness) };
};

/** Options for one discovery run, capped so it can never spend more than what is left of today's allowance. */
export function runOptions(name = ctx.state.prefs.thoroughness) {
  const effort = effortFor(name);
  return { ...effort, budget: Math.min(effort.budget, quotaInfo().left - 20) };
}

/** Sync the filters' length with saved preferences (first load). */
export function initFilters() {
  const { prefs } = ctx.state;
  ctx.ui.filters.minMin = prefs.minMin;
  ctx.ui.filters.maxMin = prefs.maxMin;
  ctx.ui.filters.voice = prefs.voice === 'female' || prefs.voice === 'male' ? prefs.voice : '';   // a standing wish for a female or male teacher
}

/** "Pick from: Morning": the ids in that collection (null when the request is not limited to one). */
export function sourceCollection(f) {
  const id = typeof f.source === 'string' && f.source.startsWith('collection:') ? f.source.slice(11) : null;
  const c = id ? ctx.state.collections.find((x) => x.id === id) : null;
  return id ? new Set(c?.videoIds ?? []) : null;
}

export function describeFilters(f = ctx.ui.filters) {
  const parts = [];
  if (f.areas.length) parts.push(f.areas.map((a) => `${areaLabel(a.id)}${a.mode === 'weak' ? ' (weak)' : ''}`).join(', '));
  if (f.terms?.length) parts.push(`“${f.terms.join(' ')}”`);
  parts.push(f.minMin == null && f.maxMin == null ? 'any length' : `${f.minMin ?? 0}–${f.maxMin ?? '∞'} min`);
  if (f.styles.length) parts.push(f.styles.join(', '));
  if (f.voice) parts.push(voiceText(f.voice).toLowerCase());
  if (f.source === 'library') parts.push('my library only');
  if (typeof f.source === 'string' && f.source.startsWith('collection:')) parts.push(`from “${ctx.state.collections.find((c) => `collection:${c.id}` === f.source)?.name ?? 'a collection'}”`);
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

/**
 * A typed request replaces the earlier muscle picks, styles and words (it is a complete statement of what
 * you want now). A length-only command ("20 min") keeps them and just changes the time.
 */
export function applyParsed(parsed) {
  const f = ctx.ui.filters;
  if (parsed.areas.length || parsed.terms.length || parsed.styles.length) {
    f.areas = parsed.areas.map((a) => ({ ...a }));
    f.styles = [...parsed.styles];
    f.terms = [...parsed.terms];
  }
  f.hints = parsed.hints;
  if (parsed.voice) f.voice = parsed.voice;   // typed "a female teacher": for this search (the standing choice is the chips)
  if (parsed.minMin != null) setLength(parsed.minMin, parsed.maxMin);
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
    videos: Object.values(state.videos), filters: ui.filters, model, textScores, libraryIds: libraryIds(), collectionIds: sourceCollection(ui.filters),
    trusted: state.prefs.trusted, blocked: state.blocked, blockedChannels: state.blockedChannels, favoriteChannels: state.favoriteChannels, teacherVoices: state.teacherVoices, adventure: state.prefs.adventure,
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
    trusted: ctx.state.prefs.trusted, blocked: [], favoriteChannels: ctx.state.favoriteChannels, adventure: ctx.state.prefs.adventure,
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
      const opts = runOptions();
      if (opts.budget < 120) throw new Error(`Only ${quotaInfo().left} units of today’s YouTube allowance are left, not enough for a search. It resets at midnight Pacific time.`);
      const res = await discover({ client: api, filters: ui.filters, state, rng: freshRng(), progress: say, opts });
      const before = new Set(Object.keys(state.videos));
      applyDiscovery(state, res);
      ui.foundIds = new Set(res.records.filter((r) => !before.has(r.id)).map((r) => r.id));
      ui.report = res.report;
      const r = res.report;
      say(`Done: looked at ${r.examined} videos over ${r.rounds} round${r.rounds > 1 ? 's' : ''} (${r.strong} strong fit${r.strong === 1 ? '' : 's'}${r.stopped === 'enough' ? ', so I stopped early' : r.stopped === 'budget' ? ', stopped at the budget' : ''}); ${ui.foundIds.size} are new to you${r.newChannels ? ` from ${r.newChannels} channels` : ''}; read ${r.commentsRead} viewer comments; used ${r.spent} units.`);
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

export async function growLibrary(areaIds) {
  const prev = { ...ctx.ui.filters, areas: ctx.ui.filters.areas.map((a) => ({ ...a })) };
  ctx.ui.filters = { areas: areaIds.map((id) => ({ id, mode: 'tight' })), minMin: null, maxMin: null, styles: [], hints: [], terms: [], source: 'all', voice: '' };
  const api = client();
  if (!api) { ctx.ui.filters = prev; throw new Error('Add a YouTube key in Settings first.'); }
  ctx.ui.log = [];
  try {
    const res = await discover({ client: api, filters: ctx.ui.filters, state: ctx.state, rng: freshRng(), progress: say, opts: runOptions() });
    const added = applyDiscovery(ctx.state, res);
    ctx.store.save();
    return { added, report: res.report };
  } finally {
    ctx.ui.filters = prev;
  }
}

// ---------------------------------------------------------------- bringing things in

/** Split pasted text into items: one per line (names have spaces), or several links on one line. */
/**
 * Look at ONE pasted video link without keeping anything: read its details, its chapters and (with a key)
 * its comments, analyse them, and return a report. Nothing is stored until commitAnalysis().
 * @returns {Promise<{error?:string, video?:object, report?:object, notes:string[]}>}
 */
export async function analyzeLink(text, { progress = () => {} } = {}) {
  const input = String(text ?? '').trim();
  const notes = [];
  if (!input) return { error: 'Paste a YouTube video link first.', notes };
  const src = parseSourceInput(input);
  if (src.type !== 'video') {
    return { error: src.type === 'search' ? 'That doesn’t look like a YouTube video link. Paste the address of one video (youtube.com/watch?v=… or youtu.be/…).' : 'That’s a playlist or a teacher, not a single video. Use “Add videos, playlists or teachers” below for those.', notes };
  }
  const id = src.value;
  const known = ctx.state.videos[id];
  const api = client();
  let video, subscribers = null;
  if (api) {
    progress('Reading the video…');
    const [rec] = await api.videos([id]);
    if (!rec) return { error: 'No public video was found at that link (it may be private, deleted or not embeddable).', notes };
    let comments = [];
    progress('Reading what viewers say…');
    try { comments = await api.comments(id); } catch (e) { if (e instanceof QuotaError || e instanceof KeyError) throw e; notes.push('The comments couldn’t be read.'); }
    video = attachComments({ ...rec, source: 'manual' }, comments);
    if (rec.channelId) {
      try { const ch = (await api.channels([rec.channelId]))[rec.channelId]; subscribers = ch?.subscribers ?? null; if (subscribers != null) video.subscribers = subscribers; } catch (e) { if (e instanceof QuotaError || e instanceof KeyError) throw e; }
    }
  } else {
    progress('Reading the title…');
    const meta = await fetchOEmbed(id);
    video = { id, title: meta?.title || known?.title || 'Video (title unknown)', channel: meta?.channel || known?.channel || '', description: known?.description ?? '', tags: known?.tags ?? [], durationSec: known?.durationSec ?? null, views: known?.views ?? null, likes: known?.likes ?? null, embeddable: true, verified: false, source: 'manual' };
    video.profile = analyzeVideoText(video);
    notes.push('Without a YouTube key I can only read the title, so this analysis is thin. Add a free key in Settings for chapters, tags, length and viewer comments.');
  }
  return { video, report: buildReport(video, { state: ctx.state, subscribers }), notes };
}

/** Re-do the analysis currently on screen with a pasted transcript (empty text removes it). Nothing is stored. */
export function addTranscriptToAnalysis(raw) {
  const a = ctx.ui.analysis;
  if (!a) return null;
  if (String(raw ?? '').trim() && !cleanTranscript(raw).lines) return null;   // nothing readable: leave what is there alone
  a.video = attachTranscript(a.video, raw);
  a.report = buildReport(a.video, { state: ctx.state, subscribers: a.video.subscribers ?? null });
  return a;
}

/** "This is really Pilates": remember what kind of routine a video is, for a stored video or the analysis on screen. `null` takes it back. */
export function fixStyle(videoId, styleId) {
  if (!setStyleFix(ctx.state, videoId, styleId)) return false;
  const a = ctx.ui.analysis;
  if (a?.video.id === videoId) {
    const v = { ...a.video };
    if (styleId) v.styleFix = styleId; else delete v.styleFix;
    a.video = reanalyze(v);
    a.report = buildReport(a.video, { state: ctx.state, subscribers: a.video.subscribers ?? null });
  }
  ctx.store.save();
  return true;
}

/** Keep an analysed video (see analyzeLink): into the index, and into the library unless told otherwise. */
export function commitAnalysis(video, { toLibrary = true } = {}) {
  const rec = addAnalyzedVideo(ctx.state, video, { toLibrary });
  ctx.store.save();
  return rec;
}

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
const IMPORT_COMMENTS_MAX = 300;   // comments read per import (1 unit each); the Library's "Read missing comments" does more

/** How many known videos still have no comments read, and could. */
export const missingCommentsCount = () => Object.values(ctx.state.videos).filter(needsComments).length;

/** Read comments for videos that never had them (your library first). Returns what happened. */
export async function readMissingComments({ max = 300, progress = () => {} } = {}) {
  const api = client();
  if (!api) throw new Error('Reading comments needs a YouTube key (Settings), or the server’s shared one.');
  const { state } = ctx;
  const res = await readCommentsFor({ client: api, state, ids: Object.keys(state.videos), max, budget: quotaInfo().left - 20, priority: new Set(Object.keys(state.library)), progress });
  if (res.read) { ctx.store.save(); ctx.hooks.renderResults?.(); }
  return res;
}

export async function importInputs(text, { toLibrary = false, follow = false, progress = () => {} } = {}) {
  const { state } = ctx;
  const items = splitInputs(text);
  const out = { videos: 0, imported: 0, followed: [], names: [], problems: [], commentsRead: 0 };
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
        if (!rec.comments) { try { state.videos[r.id] = attachComments(rec, await api.comments(r.id)); out.commentsRead++; } catch { /* comments are a bonus */ } }
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
      // Always read what viewers say about what was just imported: that is where the muscle evidence comes from.
      const cr = await readCommentsFor({ client: api, state, ids: res.records.map((r) => r.id), max: IMPORT_COMMENTS_MAX, budget: quotaInfo().left - 20, priority: libraryIds(), progress });
      out.commentsRead += cr.read;
      if (cr.stopped === 'quota' || cr.stopped === 'budget') out.problems.push(`Today’s YouTube allowance ran out after reading comments on ${cr.read} videos; “Read missing comments” in the Library finishes the rest tomorrow (${cr.remaining} left).`);
      else if (cr.stopped === 'cap') out.problems.push(`Read comments on ${cr.read} videos; ${cr.remaining} more are waiting (“Read missing comments” in the Library).`);
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

// ---------------------------------------------------------------- combos

/** What a combo search depended on: if any of it changes, the old combos no longer answer the question. */
export const comboKey = (f) => JSON.stringify([f.areas, f.minMin, f.maxMin, f.styles, f.source, f.voice ?? '']);

/** Look for sequences of videos that together cover all the chosen muscles in the chosen time. */
export function buildCombos() {
  const { state, ui } = ctx;
  const f = ui.filters;
  const hi = f.maxMin ?? 45;
  const model = buildModel(state.history, state.videos);
  // rank with a loose minimum length: the parts are SHORTER than the whole session
  const cands = rankCandidates({
    videos: Object.values(state.videos), filters: { ...f, minMin: 3, maxMin: hi, terms: [] }, model, libraryIds: libraryIds(), collectionIds: sourceCollection(f),
    trusted: state.prefs.trusted, blocked: state.blocked, blockedChannels: state.blockedChannels, favoriteChannels: state.favoriteChannels, teacherVoices: state.teacherVoices, adventure: state.prefs.adventure,
  });
  ui.combos = { ...composeCombos(cands, f, { minTotal: f.minMin ?? 10, maxTotal: hi }), key: comboKey(f) };
  return ui.combos;
}

export function startCombo(combo) {
  const ids = combo.parts.map((p) => p.video.id);
  ctx.ui.combo = { ids, index: 0, totalMin: combo.totalMin };
  play(ids[0], { navigate: false });
}

/** After finishing a part, move on to the next one (if you are following a combo). */
export function advanceCombo(finishedId) {
  const c = ctx.ui.combo;
  if (!c || c.ids[c.index] !== finishedId) return false;
  if (c.index + 1 < c.ids.length) {
    c.index++;
    ctx.hooks.toast(`Combo: on to part ${c.index + 1} of ${c.ids.length}.`, 'success');
    play(c.ids[c.index], { navigate: false });
    return true;
  }
  ctx.hooks.toast(`Combo complete: ${c.ids.length} videos, about ${c.totalMin} minutes. Well done!`, 'success', 7000);
  ctx.ui.combo = null;
  ctx.hooks.renderResults();
  return false;
}
