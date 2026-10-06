// "Today": say what you need (or tap muscles), get a routine you can play right here.

import { h, fill } from '../dom.js';
import { THOROUGHNESS } from '../youtube.js';
import { ctx, client, quotaInfo, describeFilters, setLength, cycleArea, applyParsed, findRoutine, another, play, entryFor, suggestNow, rankNow, useMySpots, aimAtNeglected, buildCombos, startCombo, advanceCombo, comboKey } from '../ctx.js';
import { STYLES, QUICK_PICKS, areaLabel, parentOf, areaPath } from '../lexicon.js';
import { areaPicker } from './areapicker.js';
import { blockMenu } from './blockmenu.js';
import { favoriteButton } from './favorite.js';
import { notesBlock } from './notes.js';
import { didTodayButton } from './quicklog.js';
import { streaks, goalProgress, DEFAULT_WEEKLY_GOAL, byCategory } from '../progress.js';
import { channelBlocker } from '../model.js';
import { parseCommand, buildQueries, youtubeSearchUrl, youtubeWatchUrl } from '../query.js';
import { mountPlayer } from '../player.js';
import { formatDuration, attachComments } from '../analyze.js';
import { applyPlayerInfo, toggleLibrary, addToLibrary, inLibrary } from '../state.js';
import { mulberry32 } from '../model.js';
import { fmtViews, thumb } from '../dom.js';
import { openFeedback } from './feedback.js';
import { toast } from '../modal.js';

const slots = {};
let playerCtl = null, playerFor = null, playerBox = null, article = null, infoHost = null;

export function unmountToday() {
  playerCtl?.destroy(); playerCtl = null; playerFor = null; playerBox = null; article = null; infoHost = null;
}

export function mountToday(root) {
  unmountToday();
  slots.filters = h('section', { class: 'panel', id: 'filters', 'aria-label': 'What do you need?' });
  slots.log = h('div', { id: 'log-slot' });
  slots.featured = h('div', { id: 'featured-slot' });
  slots.combo = h('div', { id: 'combo-slot' });
  slots.alts = h('div', { id: 'alts-slot' });
  fill(root, 
    h('section', { class: 'hero' },
      h('h1', null, 'What do you need today?'),
      h('p', { class: 'sub' }, 'Say it in your own words, or tap muscles below. I’ll find, read up on, and rank routines for you.'),
      commandBar(),
      h('p', { class: 'week-line', id: 'week-line' })),
    slots.filters,
    h('section', { id: 'results', 'aria-label': 'Routine' }, slots.log, slots.featured, slots.combo, slots.alts));
  Object.assign(ctx.hooks, { renderResults, renderFilters, renderLog });
  renderFilters();
  weekLine();
  if (!ctx.ui.ranked.length && !ctx.ui.busy) { if (ctx.ui.featuredId) rankNow(); else suggestNow(); }
  renderResults();
}

/** One quiet line of motivation under the heading: this week against your goal, and your streak. */
function weekLine() {
  const { state } = ctx;
  const el = document.getElementById('week-line') ?? h('p', { class: 'week-line', id: 'week-line' });
  if (!state.history.length) { el.replaceChildren(); return el; }
  const goal = state.prefs.weeklyGoal ?? DEFAULT_WEEKLY_GOAL, sGoal = state.prefs.strengthGoal ?? 0;
  const g = goalProgress(byCategory(state.history, 'stretch'), goal), gS = goalProgress(byCategory(state.history, 'strength'), sGoal), s = streaks(state.history);
  const showStrength = sGoal > 0 || state.history.some((x) => x.kind === 'strength');
  const part = (label, gp, goal_) => `${label}${gp.done}${goal_ ? ` of ${goal_}${gp.met ? ' ✓' : ''}` : ''}`;
  const bits = [showStrength ? `This week: ${part('stretching ', g, goal)} · ${part('strength ', gS, sGoal)}` : `This week: ${g.done}${goal ? ` of ${goal}${g.met ? ' ✓' : ''}` : ''}`];
  if (s.current >= 2) bits.push(`${s.current} days in a row`);
  fill(el, bits.join(' · '), ' ', h('button', { class: 'link', type: 'button', onclick: () => ctx.hooks.navigate('journal') }, 'Training log'));
  return el;
}

// ---------------------------------------------------------------- command + filters

function commandBar() {
  const input = h('input', {
    type: 'text', id: 'command', value: ctx.ui.command, autocomplete: 'off', spellcheck: 'false',
    placeholder: 'e.g. “15–20 min, tight hips and weak glutes, desk posture”', 'aria-label': 'Describe what you need',
  });
  const note = h('p', { class: 'hint', id: 'cmd-note', 'aria-live': 'polite' });
  const form = h('form', { class: 'command', onsubmit: (e) => {
    e.preventDefault();
    ctx.ui.command = input.value;
    const parsed = parseCommand(input.value);
    if (!parsed.understood && !parsed.terms.length) { note.textContent = 'I couldn’t pick out a muscle, length or style there. Try “tight hamstrings, 20 min”.'; return; }
    applyParsed(parsed);
    renderFilters();
    note.textContent = `Understood: ${describeFilters()}`;
    findRoutine();
  } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Find'), note);
  return form;
}

function chip(label, on, onclick, { cls = '', mode = null, aria } = {}) {
  return h('button', { type: 'button', class: `chip ${cls}${on ? ` on ${mode ?? ''}` : ''}`, 'aria-pressed': on, 'aria-label': aria, onclick },
    label, on && mode ? h('small', { class: 'mode' }, mode === 'weak' ? 'weak' : 'tight') : null);
}

export function renderFilters() {
  const f = ctx.ui.filters;
  const modeOf = (id) => f.areas.find((a) => a.id === id)?.mode;
  const again = () => renderFilters();
  const prefs = ctx.state.prefs;
  const qi = quotaInfo();

  const minIn = h('input', { type: 'number', min: 3, max: 120, id: 'min-len', value: f.minMin ?? '', 'aria-label': 'Shortest length in minutes', placeholder: 'any' });
  const maxIn = h('input', { type: 'number', min: 3, max: 180, id: 'max-len', value: f.maxMin ?? '', 'aria-label': 'Longest length in minutes', placeholder: 'any' });
  const applyLen = () => {
    let a = minIn.value === '' ? null : Math.max(3, Number(minIn.value)), b = maxIn.value === '' ? null : Math.max(3, Number(maxIn.value));
    if (a != null && b != null && a > b) [a, b] = [b, a];
    setLength(a, b); again();
  };
  minIn.addEventListener('change', applyLen); maxIn.addEventListener('change', applyLen);
  const presets = [['Under 10', 3, 10], ['10–20', 10, 20], ['20–30', 20, 30], ['30–45', 30, 45], ['Any', null, null]];

  const hasBodyData = prefs.focus.length || ctx.state.history.length;
  const picker = areaPicker({
    modeOf, showSpecific: !!prefs.showSpecific,
    onToggle: () => { prefs.showSpecific = !prefs.showSpecific; ctx.store.save(); again(); },
    makeChip: (a, m) => chip(a.label, !!m, () => { cycleArea(a.id); again(); }, {
      cls: `area${parentOf(a.id) ? ' sub' : ''}`, mode: m,
      aria: `${areaPath(a.id)}: ${m ? (m === 'weak' ? 'weak spot' : 'tight spot') : 'not selected'}`,
    }),
  });
  fill(slots.filters, 
    f.terms?.length ? h('div', { class: 'row' }, h('div', { class: 'label' }, 'Also matching'),
      h('div', { class: 'chips' }, h('button', { type: 'button', class: 'chip on', id: 'clear-terms', 'aria-label': `Stop matching “${f.terms.join(' ')}”`, onclick: () => { f.terms = []; again(); } }, `“${f.terms.join(' ')}”`, h('small', { class: 'mode' }, '✕')))) : null,
    hasBodyData ? h('div', { class: 'row' },
      h('div', { class: 'label' }, 'Your body'),
      h('div', { class: 'chips' },
        prefs.focus.length ? chip('Use my usual spots', false, () => { useMySpots(); again(); }, { cls: 'quick' }) : null,
        chip('What have I been neglecting?', false, () => {
          const list = aimAtNeglected(2);
          if (!list) { toast('Do a routine or two first, or set your usual spots in Settings.'); return; }
          again();
          toast(`Aiming at ${list.map((x) => `${areaLabel(x.id)}${x.daysAgo == null ? ' (never worked)' : ` (${x.daysAgo} days)`}`).join(' and ')}.`);
          findRoutine();
        }, { cls: 'quick' }))) : null,
    h('div', { class: 'row' },
      h('div', { class: 'label' }, 'Quick picks'),
      h('div', { class: 'chips' }, QUICK_PICKS.map((q) => chip(q.label, false, () => {
        f.areas = q.areas.map((id) => ({ id, mode: q.mode ?? 'tight' }));
        f.styles = q.styles ? [...q.styles] : [];
        again();
      }, { cls: 'quick' })))),
    h('div', { class: 'row' },
      h('div', { class: 'label' }, 'Muscles & spots', h('small', { class: 'hint inline' }, ' tap once = tight (stretch), twice = weak (strengthen), third = off')),
      picker.toggle, picker.groups),
    h('div', { class: 'row inline-row' },
      h('div', null, h('div', { class: 'label' }, 'Length (minutes)'),
        h('div', { class: 'len' }, minIn, h('span', null, 'to'), maxIn),
        h('div', { class: 'chips small' }, presets.map(([l, a, b]) => chip(l, f.minMin === a && f.maxMin === b, () => { setLength(a, b); again(); })))),
      h('div', null, h('div', { class: 'label' }, 'Style (optional)'),
        h('div', { class: 'chips' }, STYLES.map((s) => chip(s.label, f.styles.includes(s.id), () => {
          f.styles = f.styles.includes(s.id) ? f.styles.filter((x) => x !== s.id) : [...f.styles, s.id]; again();
        }))))),
    h('div', { class: 'row' },
      h('label', { class: 'field inline-field' }, h('span', null, 'Pick from'),
        h('select', { id: 'scope', onchange: (e) => { f.source = e.target.value; again(); } },
          [['all', 'Everything I know about'], ['library', 'My library only'], ['discovered', 'Not in my library yet']].map(([v, t]) => h('option', { value: v, selected: f.source === v }, t))))),
    h('div', { class: 'row find-row' },
      h('div', { class: 'web' },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', id: 'web-toggle', checked: prefs.searchWeb && ctx.hasKey, disabled: !ctx.hasKey,
            onchange: (e) => { prefs.searchWeb = e.target.checked; ctx.store.save(); } }),
          ' Search the web for new videos'),
        ctx.hasKey
          ? h('div', { class: 'effort' },
            h('label', { class: 'field inline-field' }, h('span', null, 'Thoroughness'),
              h('select', { id: 'thoroughness', onchange: (e) => { prefs.thoroughness = e.target.value; ctx.store.save(); again(); } },
                Object.entries(THOROUGHNESS).map(([k, e]) => h('option', { value: k, selected: prefs.thoroughness === k }, e.label)))),
            h('small', { class: 'hint' }, `${qi.effort.blurb}. Up to ≈${qi.run.max} of your ${qi.limit.toLocaleString()} free daily units, usually about ${qi.run.typical} (${qi.used.toLocaleString()} used today).`))
          : h('small', { class: 'hint' }, h('a', { href: '#settings' }, 'Add a free YouTube key'), ' to let the app search the whole web for you.')),
      h('button', { class: 'btn primary big', id: 'find', type: 'button', disabled: ctx.ui.busy, onclick: () => findRoutine() }, ctx.ui.busy ? 'Working…' : 'Find my routine')),
  );
}

// ---------------------------------------------------------------- results

export function renderResults() {
  if (!slots.featured?.isConnected) return; // another tab is showing
  weekLine();
  renderLog();
  renderFeatured();
  renderCombo();
  renderAlts();
  const btn = document.getElementById('find');
  if (btn) { btn.disabled = ctx.ui.busy; btn.textContent = ctx.ui.busy ? 'Working…' : 'Find my routine'; }
}

export function renderLog() {
  const { busy, log, termsIgnored, filters } = ctx.ui;
  if (!slots.log) return;
  const lines = [...log];   // never mutate the log from a render
  if (!busy && termsIgnored && filters.terms.length) {
    lines.push(`Nothing I know yet mentions “${filters.terms.join(' ')}”, so I ignored it${ctx.hasKey ? ' here (a web search will look for it)' : ''}.`);
  }
  const ignored = !busy && termsIgnored && filters.terms.length > 0;
  fill(slots.log, !busy && !lines.length ? '' : h('details', { class: 'log', open: busy || ignored || lines.some((l) => l.startsWith('⚠')) },
    h('summary', null, busy ? 'Searching…' : 'What I just did'),
    h('ol', null, lines.map((l) => h('li', null, l)))));
}

function destroyPlayer() { playerCtl?.destroy(); playerCtl = null; playerFor = null; playerBox = null; article = null; infoHost = null; }

function renderFeatured() {
  const { ui } = ctx;
  if (!slots.featured) return;
  if (ui.busy) {
    destroyPlayer();
    fill(slots.featured, h('div', { class: 'card busy', 'aria-busy': 'true' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, 'Looking for the right routine…')));
    return;
  }
  const entry = ui.featuredId ? entryFor(ui.featuredId) : null;
  if (!entry) { destroyPlayer(); fill(slots.featured, emptyState()); return; }
  const v = entry.video;

  // The player node is kept as-is while the same video is showing (moving an
  // iframe in the DOM would reload it and restart the video).
  if (playerFor !== v.id || !article?.isConnected) {
    destroyPlayer();
    playerBox = h('div', { class: 'player', role: 'region', 'aria-label': 'Video player' }, h('p', { class: 'hint center' }, 'Loading player…'));
    infoHost = h('div', { class: 'info' });
    article = h('article', { class: 'card featured', 'data-video': v.id }, playerBox, infoHost);
    fill(slots.featured, article);
    playerFor = v.id;
    playerCtl = mountPlayer(playerBox, v.id, {
      onInfo: (info) => { if (applyPlayerInfo(ctx.state, v.id, info)) { ctx.store.save(); renderFeaturedInfo(); } },
      onEnded: () => finishVideo(v.id),
      onError: (code, msg) => {
        const rec = ctx.state.videos[v.id];
        if (code === 100 && rec) rec.broken = true;
        if ((code === 101 || code === 150) && rec) rec.embeddable = false;
        ctx.store.save();
        playerProblem(v, msg);
      },
      onUnavailable: () => playerProblem(v, 'The YouTube player couldn’t load (you may be offline, or it’s blocked). You can still open it on YouTube.'),
    });
  }
  renderFeaturedInfo();
}

function renderFeaturedInfo() {
  if (!infoHost || !ctx.ui.featuredId) return;
  const entry = entryFor(ctx.ui.featuredId);
  if (entry) fill(infoHost, ...featuredInfo(entry));
}

function playerProblem(v, message) {
  if (!playerBox || playerFor !== v.id) return;
  fill(playerBox, h('div', { class: 'player-problem' },
    h('p', null, message),
    h('div', { class: 'actions' },
      h('a', { class: 'btn primary', href: youtubeWatchUrl(v.id), target: '_blank', rel: 'noopener noreferrer' }, 'Watch on YouTube ↗'),
      h('button', { class: 'btn', type: 'button', onclick: () => another() }, 'Pick another'))));
}

/** Ask how it went; if this is a part of a combo, move on to the next one afterwards. */
function finishVideo(id) { openFeedback(id, { onDone: () => advanceCombo(id) }); }

function renderCombo() {
  const { ui } = ctx;
  if (!slots.combo) return;
  const f = ui.filters;
  if (ui.busy || f.areas.length < 2) { fill(slots.combo, ''); return; }
  const res = ui.combos?.key === comboKey(f) ? ui.combos : null;   // a combo built for a different request is stale
  const useful = res?.combos.filter((c) => c.gain >= 0.05 || !res.bestSingle) ?? [];
  const covLabel = (c) => `${Math.round(c.coverage * 100)}% of your muscles covered`;
  fill(slots.combo, h('section', { class: 'panel combos', id: 'combos' },
    h('div', { class: 'combo-head' },
      h('div', null, h('h3', null, 'Cover all of it in one session'),
        h('p', { class: 'hint' }, `No single video usually covers ${f.areas.length} muscle areas well. A combo chains short, well-fitting videos into one ${f.minMin ?? 10}–${f.maxMin ?? 45} minute session.`)),
      h('button', { class: 'btn', id: 'build-combo', type: 'button', onclick: () => { buildCombos(); renderCombo(); } }, res ? 'Rebuild combos' : 'Build a combo')),
    res && !useful.length ? h('p', { class: 'hint', id: 'combo-none' }, res.bestSingle
      ? `Nothing beats the best single video for this: “${res.bestSingle.entry.video.title}” (${Math.round(res.bestSingle.coverage * 100)}% covered).`
      : 'I couldn’t find videos that combine into that length. Try a wider time range or fewer muscles.') : null,
    h('div', { class: 'combo-list' }, useful.map((c, ci) => h('article', { class: 'combo', 'data-combo': ci },
      h('h4', null, `Combo ${ci + 1}`, h('span', { class: 'combo-meta' }, ` ${c.totalMin} min · ${covLabel(c)}${res.bestSingle ? ` (best single video: ${Math.round(res.bestSingle.coverage * 100)}%)` : ''}`)),
      h('ol', { class: 'parts' }, c.parts.map((p, pi) => {
        const v = p.video;
        const areas = f.areas.filter((a) => (v.profile?.areas?.[a.id] ?? 0) >= 0.45).map((a) => areaLabel(a.id));
        return h('li', null,
          h('span', { class: 'part-title' }, v.title), ' ',
          h('small', { class: 'muted' }, `${v.channel || 'unknown channel'} · ${lengthText(v)}${areas.length ? ` · ${areas.join(', ')}` : ''}`),
          h('button', { class: 'btn small ghost', type: 'button', 'data-part': pi, onclick: () => play(v.id, { navigate: false }) }, 'Play'));
      })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary small', type: 'button', 'data-start': ci, onclick: () => { startCombo(c); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Start this combo'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { for (const p of c.parts) addToLibrary(ctx.state, p.video.id); ctx.store.save(); toast(`Added ${c.parts.length} videos to your library.`, 'success'); renderFeaturedInfo(); renderAlts(); } }, 'Add all to library'))))),
    ));
}

function badge(text, cls = '', title) { return h('span', { class: `badge ${cls}`, title }, text); }

function lengthText(v) { return v.durationSec == null ? 'length unknown' : `${v.durationApprox ? '~' : ''}${formatDuration(v.durationSec)}`; }

function featuredInfo(entry) {
  const v = entry.video, f = entry.flags ?? {}, ev = v.evidence;
  const state = ctx.state;
  const saved = inLibrary(state, v.id);
  const likePct = v.likes != null && v.views ? `${(100 * v.likes / v.views).toFixed(1)}% like it` : '';
  const wanted = new Set(ctx.ui.featuredAreas.map((a) => a.id));
  const quotes = (ev?.quotes ?? []).slice().sort((a, b) => (b.areas.some((x) => wanted.has(x)) ? 1 : 0) - (a.areas.some((x) => wanted.has(x)) ? 1 : 0));

  return [
    ctx.ui.combo && ctx.ui.combo.ids.includes(v.id) ? h('p', { class: 'combo-progress', id: 'combo-progress' }, `Combo: part ${ctx.ui.combo.ids.indexOf(v.id) + 1} of ${ctx.ui.combo.ids.length}`,
      ctx.ui.combo.ids.indexOf(v.id) + 1 < ctx.ui.combo.ids.length ? h('button', { class: 'link', type: 'button', onclick: () => advanceCombo(v.id) }, ' skip to the next part') : null) : null,
    h('h2', null, v.title),
    h('p', { class: 'meta' },
      v.channel ? h('span', { class: 'channel' }, v.channel) : h('span', { class: 'channel muted' }, 'channel not checked yet'),
      h('span', null, lengthText(v)), fmtViews(v.views) && h('span', null, fmtViews(v.views)), likePct && h('span', null, likePct)),
    h('div', { class: 'badges' },
      saved && badge('✓ In your library', 'lib'),
      f.suggestion && !saved && badge('Suggested', '', 'A recommended starting point; add it to your library if you like it'),
      ctx.ui.foundIds.has(v.id) && badge('✨ Just found', 'new'),
      f.newChannel && badge('New teacher for you', 'new', 'You haven’t done a routine from this channel yet'),
      f.hiddenGem && badge('Hidden gem', 'gem', 'Well liked relative to its views'),
      f.favorite && badge('★ Favourite channel', 'fav', 'You marked this channel as a favourite'),
      f.trusted && badge('Trusted teacher', '', 'On your trusted list'),
      f.commentsRead && badge(`${ev.n} comments read`, '', 'Viewer comments were analysed for what it did for people'),
      !v.verified && badge('Details unverified', 'warn', 'Length and channel come from a guess; they’ll be checked when you add a YouTube key or play it')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', id: 'did-it', type: 'button', onclick: () => finishVideo(v.id) }, 'I did it ✓'),
      didTodayButton(v, { onChange: () => { weekLine(); renderFeaturedInfo(); renderAlts(); } }),
      h('button', { class: 'btn', id: 'another', type: 'button', onclick: () => another() }, 'Another one ↻'),
      h('button', { class: 'btn ghost', id: 'lib-toggle', type: 'button', 'aria-pressed': saved, onclick: () => { toggleLibrary(state, v.id); ctx.store.save(); renderFeaturedInfo(); renderAlts(); } }, saved ? '✓ In library' : '＋ Add to library'),
      favoriteButton(v, { onChange: () => { rankNow(); renderFeaturedInfo(); renderAlts(); } }),
      blockMenu(v, { onChange: () => { rankNow(); if (ctx.state.blocked.includes(v.id) || channelBlocker(ctx.state.blockedChannels)(v)) another(); else { renderFeaturedInfo(); renderAlts(); } } }),
      h('a', { class: 'btn ghost', href: youtubeWatchUrl(v.id), target: '_blank', rel: 'noopener noreferrer' }, 'YouTube ↗')),
    notesBlock(v, { onChange: () => { rankNow(); renderFeaturedInfo(); renderAlts(); } }),
    reasonsBlock(entry, wanted),
    quotes.length ? h('div', { class: 'quotes' }, h('h3', null, 'What viewers say'),
      quotes.slice(0, 3).map((q) => h('blockquote', null, `“${q.text}”`, h('footer', null, q.areas.map(areaLabel).slice(0, 3).join(', '), q.likes ? ` · ${q.likes} 👍` : '')))) : null,
    !ev && ctx.hasKey ? h('p', { class: 'hint' }, 'I haven’t read the comments on this one yet. ', h('button', { class: 'link', type: 'button', onclick: (e) => readComments(v.id, e.target) }, 'Read them now (1 unit)')) : null,
  ];
}

function reasonsBlock(entry, wanted) {
  const p = entry.parts ?? {};
  const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const lines = entry.reasons ?? [];
  return h('div', { class: 'why' },
    h('h3', null, 'Why this one'),
    lines.length ? h('ul', null, lines.map((r) => h('li', null, r)))
      : h('p', { class: 'hint' }, wanted.size ? 'A loose match: the title and description don’t say much about those muscles yet.' : 'A well-liked all-rounder.'),
    h('details', { class: 'score' }, h('summary', null, 'How it was scored'),
      h('div', { class: 'meters' },
        meter('Matches your muscles', p.match, pct), meter('Quality (likes, views, comments)', p.quality, pct),
        meter('Predicted from your history', p.learned, pct, p.confidence != null ? `${Math.round((p.confidence ?? 0) * 100)}% confidence` : ''), meter('Length fit', p.fit, pct))));
}

function meter(label, value, pct, extra = '') {
  const bar = h('span', { class: 'bar' }, h('i'));
  bar.firstChild.style.width = `${Math.round((value ?? 0) * 100)}%`;
  return h('div', { class: 'meter' }, h('span', { class: 'm-label' }, label, extra && h('small', null, ` · ${extra}`)), bar, h('span', { class: 'm-val' }, pct(value)));
}

async function readComments(id, btn) {
  const api = client();
  if (!api) return;
  btn.disabled = true; btn.textContent = 'Reading…';
  try {
    const v = ctx.state.videos[id];
    ctx.state.videos[id] = attachComments(v, await api.comments(id));
    ctx.store.save();
    renderFeaturedInfo(); renderAlts();
    const ev = ctx.state.videos[id].evidence;
    toast(ev.n ? `Read ${ev.n} comments.` : 'This video has no readable comments.');
  } catch (e) { btn.disabled = false; btn.textContent = 'Read them now'; toast(e.message, 'error'); }
}

function emptyState() {
  const { filters } = ctx.ui;
  const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
  const queries = buildQueries(filters, { queryLog: ctx.state.queryLog, rng, n: 3 }).map((q) => q.q);
  return h('div', { class: 'card empty' },
    h('h2', null, 'Nothing in your library fits that yet'),
    h('p', null, `Looking for: ${describeFilters()}.`),
    h('ul', null,
      h('li', null, 'Try a wider length range or fewer muscles.'),
      ctx.hasKey ? h('li', null, h('button', { class: 'link', type: 'button', onclick: () => findRoutine({ web: true }) }, 'Search the web for it'), ' (the app reads details and comments, then adds what it finds to your library).')
        : h('li', null, h('a', { href: '#settings' }, 'Add a free YouTube key'), ' and I’ll search the web for you.')),
    h('p', { class: 'hint' }, 'Or search YouTube yourself and paste a link into ', h('a', { href: '#library' }, 'the Library'), ':'),
    h('ul', { class: 'links' }, queries.map((q) => h('li', null, h('a', { href: youtubeSearchUrl(q), target: '_blank', rel: 'noopener noreferrer' }, q, ' ↗')))));
}

function renderAlts() {
  const { ui } = ctx;
  if (!slots.alts) return;
  if (ui.busy || !ui.ranked.length) { slots.alts.replaceChildren(); return; }
  const rest = ui.ranked.filter((r) => r.video.id !== ui.featuredId).slice(0, 9);
  if (!rest.length) { slots.alts.replaceChildren(); return; }
  fill(slots.alts, 
    h('h3', { class: 'section-title' }, 'More that fit'),
    h('div', { class: 'grid' }, rest.map((r) => videoCard(r))));
}

function videoCard(r) {
  const v = r.video, f = r.flags;
  return h('button', { class: 'vcard', type: 'button', onclick: () => { play(v.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }, 'aria-label': `Play ${v.title}` },
    h('span', { class: 'thumb' }, h('img', { src: thumb(v.id), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }), h('span', { class: 'len' }, lengthText(v))),
    h('span', { class: 'vtitle' }, v.title),
    h('span', { class: 'vmeta' }, v.channel || 'unknown channel', ' · fit ', `${Math.round((r.parts.match ?? 0) * 100)}%`),
    h('span', { class: 'badges' },
      inLibrary(ctx.state, v.id) && badge('In library', 'lib'), f.suggestion && !inLibrary(ctx.state, v.id) && badge('Suggested'),
      ctx.ui.foundIds.has(v.id) && badge('Just found', 'new'),
      f.favorite && badge('★ Favourite', 'fav'), f.newChannel && badge('New teacher', 'new'), f.hiddenGem && badge('Hidden gem', 'gem')));
}
