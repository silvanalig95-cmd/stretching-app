// Library: YOURS (videos you chose to keep), plus what the app has discovered and
// its starter suggestions. You build it up; nothing lands in "My library" unless
// you put it there (or you did the routine, or you turned on auto-add).

import { h, fill, thumb, fmtViews } from '../dom.js';
import { ctx, play, growLibrary, importInputs, refreshFollowedNow } from '../ctx.js';
import { AREAS, areaLabel } from '../lexicon.js';
import { formatDuration, qualityScore } from '../analyze.js';
import { toggleLibrary, blockVideo, unblockVideo, updateLibraryItem, allTags, unfollowChannel, saveSearch, deleteSavedSearch } from '../state.js';
import { buildModel, coverage } from '../model.js';
import { SearchIndex } from '../index.js';
import { toast } from '../modal.js';
import { analyzePanel } from './analyze.js';

const LEN = { '': null, short: [0, 10], mid: [10, 20], long: [20, 30], xl: [30, 999] };
const TABS = [['mine', 'My library'], ['discovered', 'Discovered'], ['suggestions', 'Suggestions']];

export function mountLibrary(root) {
  const lf = (ctx.ui.lib ??= { tab: 'mine', q: '', area: '', len: '', tag: '', sort: 'auto', status: '', show: 30 });
  const listSlot = h('div', { id: 'lib-list' });
  const covSlot = h('details', { id: 'coverage', class: 'panel' });
  const tabsSlot = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Library sections' });
  const followSlot = h('div', { id: 'follow-slot' });
  const heading = h('p', { class: 'sub', id: 'lib-summary' });
  let index = null, editing = null;

  const buckets = () => {
    const { videos, library } = ctx.state;
    const all = Object.values(videos);
    return {
      mine: all.filter((v) => v.id in library),
      discovered: all.filter((v) => !(v.id in library) && v.source !== 'suggestion'),
      suggestions: all.filter((v) => v.source === 'suggestion'),
    };
  };
  const rebuild = () => { index = SearchIndex.fromVideos(ctx.state.videos, ctx.state.library); };
  const rerender = () => { rebuild(); renderHeader(); renderCoverage(); renderSaved(); renderList(); renderFollowing(); };

  // ---------------------------------------------------------------- add / import
  const addText = h('textarea', { id: 'add-text', rows: 3, 'aria-label': 'Links, playlists or teachers to add', spellcheck: 'false',
    placeholder: 'Paste YouTube links (one per line), a playlist, or a teacher: a channel link, @handle, or just their name' });
  const toLib = h('input', { type: 'checkbox', id: 'import-to-library' });
  const follow = h('input', { type: 'checkbox', id: 'import-follow', checked: true });
  const addBtn = h('button', { class: 'btn primary', type: 'submit', id: 'add-btn' }, 'Add');
  const addStatus = h('p', { class: 'hint', id: 'add-status', 'aria-live': 'polite' });
  const addForm = h('form', { class: 'add-form stack', onsubmit: async (e) => {
    e.preventDefault();
    addBtn.disabled = true; addStatus.textContent = 'Working…';
    try {
      const r = await importInputs(addText.value, { toLibrary: toLib.checked, follow: follow.checked, progress: (m) => { addStatus.textContent = m; } });
      const bits = [];
      if (r.videos) bits.push(`${r.videos} video${r.videos > 1 ? 's' : ''} added to your library`);
      if (r.imported) bits.push(`${r.imported} video${r.imported > 1 ? 's' : ''} imported from ${r.names.join(', ')} (${toLib.checked ? 'into your library' : 'into Discovered'})`);
      if (r.followed.length) bits.push(`following ${r.followed.join(', ')}`);
      addStatus.textContent = [...bits, ...r.problems].join(' · ') || 'Nothing was added.';
      if (bits.length) { addText.value = ''; toast(bits.join('; ') + '.', 'success', 6000); }
      else if (r.problems.length) toast(r.problems[0], 'error');
    } catch (err) { addStatus.textContent = err.message; toast(err.message, 'error'); }
    addBtn.disabled = false;
    rerender();
  } },
  addText,
  h('div', { class: 'options' },
    h('label', { class: 'check' }, toLib, ' Put imported playlists and teacher catalogues straight into my library'),
    h('label', { class: 'check' }, follow, ' Follow imported teachers (so I can check for their new uploads)')),
  h('div', { class: 'actions' }, addBtn,
    h('a', { class: 'btn ghost', href: 'https://www.youtube.com/results?search_query=yoga+stretch+routine+follow+along', target: '_blank', rel: 'noopener noreferrer' }, 'Browse YouTube ↗')),
  addStatus,
  h('p', { class: 'hint' }, ctx.hasKey
    ? 'Single videos are added to your library. A teacher or playlist brings in their whole catalogue for about 1 quota unit per 50 videos, far cheaper than searching.'
    : 'Single video links work without a key. Playlists and teachers need a free YouTube key (Settings).'));

  function renderFollowing() {
    const list = ctx.state.following;
    fill(followSlot, list.length ? h('div', { class: 'following' },
      h('h3', null, 'Teachers you follow'),
      h('div', { class: 'chips' }, list.map((f) => h('span', { class: 'chip on' }, f.name,
        h('button', { class: 'link', type: 'button', 'aria-label': `Unfollow ${f.name}`, onclick: () => { unfollowChannel(ctx.state, f.channelId); ctx.store.save(); renderFollowing(); } }, '✕')))),
      h('button', { class: 'btn small', type: 'button', id: 'refresh-following', disabled: !ctx.hasKey, onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Checking…';
        try {
          const r = await refreshFollowedNow();
          toast(r.added ? `${r.added} new video${r.added > 1 ? 's' : ''} from ${r.checked} teacher${r.checked > 1 ? 's' : ''}, in Discovered.` : 'Nothing new from the teachers you follow.', 'success');
        } catch (err) { toast(err.message, 'error'); }
        rerender();
      } }, 'Check for new uploads')) : '');
  }

  // ---------------------------------------------------------------- grow
  const growBtn = h('button', { class: 'btn', type: 'button', id: 'grow', disabled: !ctx.hasKey, onclick: async () => {
    const cov = coverage(buckets().mine, ctx.state.blocked);
    const known = coverage(Object.values(ctx.state.videos), ctx.state.blocked);
    // aim where YOUR library is thinnest, but prefer areas the whole index is also thin on
    const thin = Object.keys(cov).filter((a) => a !== 'full_body').sort((a, b) => cov[a] - cov[b] || known[a] - known[b] || Math.random() - 0.5).slice(0, 2);
    growBtn.disabled = true; growBtn.textContent = 'Searching…';
    try {
      const { added, report } = await growLibrary(thin);
      toast(`Found ${added} new videos for ${thin.map(areaLabel).join(' & ')} (in Discovered); read ${report.commentsRead} comments.`, 'success', 7000);
    } catch (err) { toast(err.message, 'error'); }
    growBtn.disabled = !ctx.hasKey; growBtn.textContent = 'Search for the muscles I have least of';
    rerender();
  } }, 'Search for the muscles I have least of');

  // ---------------------------------------------------------------- header, tabs
  function renderHeader() {
    const b = buckets();
    heading.textContent = `${b.mine.length} in your library · ${b.discovered.length} discovered · ${b.suggestions.length} suggestions`;
    fill(tabsSlot, TABS.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', id: `tab-${id}`, class: `tab${lf.tab === id ? ' on' : ''}`, 'aria-selected': lf.tab === id,
      onclick: () => { lf.tab = id; lf.show = 30; lf.tag = ''; editing = null; rerender(); },
    }, label, h('span', { class: 'count' }, b[id].length))));
  }

  // ---------------------------------------------------------------- coverage
  function renderCoverage() {
    const items = buckets()[lf.tab];
    const cov = coverage(items, ctx.state.blocked);
    const max = Math.max(5, ...Object.values(cov));
    covSlot.hidden = !items.length;
    fill(covSlot,
      h('summary', null, `Coverage by muscle (${lf.tab === 'mine' ? 'your library' : lf.tab})`),
      h('p', { class: 'hint' }, 'Videos that clearly work each area. Short bars are where more videos would help.'),
      h('div', { class: 'cov' }, AREAS.filter((a) => a.id !== 'full_body').map((a) => {
        const bar = h('span', { class: 'bar' }, h('i'));
        bar.firstChild.style.width = `${Math.max(3, (cov[a.id] / max) * 100)}%`;
        return h('button', { type: 'button', class: `cov-row${lf.area === a.id ? ' on' : ''}${cov[a.id] < 3 ? ' thin' : ''}`, 'aria-pressed': lf.area === a.id,
          onclick: () => { lf.area = lf.area === a.id ? '' : a.id; document.getElementById('lib-area').value = lf.area; renderCoverage(); renderList(); } },
        h('span', { class: 'c-label' }, a.label), bar, h('span', { class: 'c-n' }, cov[a.id]));
      })));
  }

  // ---------------------------------------------------------------- controls
  const sel = (id, label, opts, key, extra = {}) => h('label', { class: 'field', hidden: extra.hidden }, h('span', null, label),
    h('select', { id, onchange: (e) => { lf[key] = e.target.value; lf.show = 30; renderCoverage(); renderList(); } },
      opts.map(([v, t]) => h('option', { value: v, selected: lf[key] === v }, t))));
  const suggestList = h('datalist', { id: 'lib-suggest' });
  const search = h('input', { type: 'search', id: 'lib-q', value: lf.q, list: 'lib-suggest', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Search titles, teachers, poses, comments, your tags…', 'aria-label': 'Search library',
    oninput: (e) => {
      lf.q = e.target.value; lf.show = 30;
      fill(suggestList, (index?.suggest(lf.q, 8) ?? []).map((v) => h('option', { value: v })));
      renderList();
    } });
  const controls = h('div', { class: 'controls' },
    h('label', { class: 'field grow' }, h('span', null, 'Search'), search, suggestList),
    sel('lib-area', 'Muscle', [['', 'Any'], ...AREAS.map((a) => [a.id, a.label])], 'area'),
    sel('lib-len', 'Length', [['', 'Any'], ['short', 'Under 10'], ['mid', '10–20'], ['long', '20–30'], ['xl', '30+']], 'len'),
    sel('lib-status', 'Show', [['', 'Available'], ['new', 'Not done yet'], ['done', 'Done before'], ['blocked', 'Hidden by me'], ['broken', 'Unavailable']], 'status'),
    sel('lib-sort', 'Sort', [['auto', 'Best match'], ['quality', 'Best quality'], ['fit', 'Best for muscle'], ['helpful', 'Most helpful to me'], ['new', 'Newest added'], ['short', 'Shortest'], ['long', 'Longest']], 'sort'));
  const interpSlot = h('div', { id: 'interp', 'aria-live': 'polite' });
  const savedSlot = h('div', { id: 'saved-searches' });
  const nameInput = h('input', { type: 'text', id: 'saved-name', maxlength: 40, 'aria-label': 'Name for this search', placeholder: 'Name this search' });
  let naming = false;
  const TIPS = [
    ['"exact phrase"', '"low lunge"'], ['leave out', 'hips -yin'], ['teacher', 'channel:adriene'], ['your tag', 'tag:morning'],
    ['exercise inside', 'pose:pigeon'], ['muscle it works', 'area:glutes'], ['length', 'len:10-20'], ['shorter than', 'len:<15'],
  ];
  const tips = h('details', { class: 'tips' }, h('summary', null, 'Search tips'),
    h('p', { class: 'hint' }, 'Combine them freely. Typos, plurals and muscle names ("lumbar" finds low-back videos) are handled for you.'),
    h('div', { class: 'chips' }, TIPS.map(([label, ex]) => h('button', { type: 'button', class: 'chip tip', title: label, onclick: () => {
      lf.q = `${lf.q.trim()} ${ex}`.trim(); search.value = lf.q; search.focus(); renderList();
    } }, ex))));
  const tagSlot = h('div', { id: 'tag-slot' });

  // ---------------------------------------------------------------- explaining the query, saved searches
  function renderInterpretation(info, count) {
    if (!info) { fill(interpSlot, ''); return; }
    const bits = [];
    const fixes = Object.entries(info.corrections);
    if (fixes.length) bits.push(h('span', { class: 'interp-fix' }, 'Showing results for ', fixes.map(([typed, fixed]) => h('strong', null, `“${fixed}”`)), ' (you typed ', fixes.map(([typed]) => `“${typed}”`).join(', '), ').'));
    if (info.concepts.length) bits.push(h('span', null, 'Also matching videos that work: ', h('strong', null, info.concepts.join(', ')), '.'));
    if (info.excluded.length) bits.push(h('span', null, 'Leaving out: ', info.excluded.join(', '), '.'));
    if (info.filters.length) bits.push(h('span', null, info.filters.map((f) => `${f.field}: ${f.value}`).join(' · '), '.'));
    if (info.len) bits.push(h('span', null, `Length ${info.len.min != null ? `${info.len.exMin ? '>' : '≥'} ${info.len.min}` : ''}${info.len.min != null && info.len.max != null ? ', ' : ''}${info.len.max != null ? `${info.len.exMax ? '<' : '≤'} ${info.len.max}` : ''} min.`));
    if (info.partial) bits.push(h('span', { class: 'interp-warn' }, 'No video matches every word, so these are the closest.'));
    if (count === 0) bits.push(h('span', { class: 'interp-warn' }, 'No matches. Try fewer words, or search the web from Today.'));
    fill(interpSlot, bits.length ? h('p', { class: 'hint interp' }, bits.flatMap((b, i) => (i ? [' ', b] : [b]))) : '');
  }

  function renderSaved() {
    const list = ctx.state.savedSearches;
    fill(savedSlot, h('div', { class: 'chips saved' },
      list.length ? h('span', { class: 'label inline' }, 'Saved') : null,
      list.map((x) => h('span', { class: 'chip on' },
        h('button', { class: 'link', type: 'button', 'data-saved': x.name, onclick: () => applySaved(x) }, x.name),
        h('button', { class: 'link', type: 'button', 'aria-label': `Delete saved search ${x.name}`, onclick: () => { deleteSavedSearch(ctx.state, x.id); ctx.store.save(); renderSaved(); } }, '✕'))),
      naming
        ? h('form', { class: 'name-form', onsubmit: (e) => {
          e.preventDefault();
          const rec = saveSearch(ctx.state, { name: nameInput.value, q: lf.q, area: lf.area, len: lf.len, tag: lf.tag, tab: lf.tab });
          if (!rec) { toast('Give it a name first (and have a search or a filter set).', 'error'); return; }
          naming = false; ctx.store.save(); renderSaved(); toast(`Saved “${rec.name}”.`, 'success');
        } }, nameInput, h('button', { class: 'btn small primary', type: 'submit', id: 'saved-confirm' }, 'Save'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { naming = false; renderSaved(); } }, 'Cancel'))
        : h('button', { class: 'btn small ghost', type: 'button', id: 'save-search', onclick: () => {
          naming = true; nameInput.value = lf.q.trim().slice(0, 30); renderSaved(); nameInput.focus(); nameInput.select();
        } }, '＋ Save this search')));
  }

  function applySaved(x) {
    Object.assign(lf, { q: x.q, area: x.area, len: x.len, tag: x.tag, tab: x.tab, show: 30 });
    search.value = lf.q;
    document.getElementById('lib-area').value = lf.area;
    document.getElementById('lib-len').value = lf.len;
    rerender();
  }

  // ---------------------------------------------------------------- list
  function renderList() {
    const model = buildModel(ctx.state.history, ctx.state.videos);
    const { blocked, library } = ctx.state;
    const range = LEN[lf.len];
    const helpful = (v) => {
      let s = 0, n = 0;
      for (const [k, e] of model.videoArea) if (k.startsWith(`${v.id}|`)) { s += e.sum; n += e.n; }
      return n ? s / n : null;
    };
    const res = lf.q.trim() ? index.query(lf.q, { prefix: true, limit: 5000 }) : null;
    const top = res?.results[0]?.score || 1;
    const relevance = res ? new Map(res.results.map((r) => [r.id, r.score / top])) : null;
    renderInterpretation(res?.interpretation, res ? res.results.length : null);

    const tags = allTags(ctx.state);
    fill(tagSlot, lf.tab === 'mine' && tags.length ? h('div', { class: 'chips tagbar' }, h('span', { class: 'label inline' }, 'Tags'),
      tags.map((t) => h('button', { type: 'button', class: `chip${lf.tag === t ? ' on' : ''}`, 'aria-pressed': lf.tag === t, onclick: () => { lf.tag = lf.tag === t ? '' : t; lf.show = 30; renderList(); } }, t))) : '');

    let list = buckets()[lf.tab].filter((v) => {
      const isBlocked = blocked.includes(v.id);
      if (lf.status === 'blocked') return isBlocked;
      if (lf.status === 'broken') return v.broken || v.embeddable === false;
      if (isBlocked || v.broken || v.embeddable === false) return false;
      if (lf.status === 'done' && !model.doneCount.has(v.id)) return false;
      if (lf.status === 'new' && model.doneCount.has(v.id)) return false;
      if (relevance && !relevance.has(v.id)) return false;
      if (lf.tag && !(library[v.id]?.tags ?? []).includes(lf.tag)) return false;
      if (lf.area && (v.profile?.areas?.[lf.area] ?? 0) < 0.45) return false;
      if (range) { const m = (v.durationSec ?? 0) / 60; if (v.durationSec == null || m < range[0] || m >= range[1]) return false; }
      return true;
    });
    const sortKey = lf.sort === 'auto' ? (relevance ? 'relevance' : 'quality') : lf.sort;
    const key = {
      relevance: (v) => (relevance?.get(v.id) ?? 0) + 0.12 * qualityScore(v), quality: (v) => qualityScore(v), fit: (v) => v.profile?.areas?.[lf.area] ?? 0, helpful: (v) => helpful(v) ?? -1,
      new: (v) => v.addedAt ?? 0, short: (v) => -(v.durationSec ?? 1e9), long: (v) => v.durationSec ?? 0,
    }[sortKey];
    list.sort((a, b) => key(b) - key(a));
    const total = list.length;
    list = list.slice(0, lf.show);

    const empty = {
      mine: h('div', { class: 'empty-note' }, h('strong', null, 'Your library is empty, and it’s yours to build.'),
        h('ul', null,
          h('li', null, 'Paste links, a playlist or a teacher into the box above.'),
          h('li', null, 'Press “＋ Add to library” on anything you like in Today or in ', h('button', { class: 'link', type: 'button', onclick: () => { lf.tab = 'suggestions'; rerender(); } }, 'Suggestions'), '.'),
          h('li', null, 'Routines you finish are added automatically.'))),
      discovered: h('p', { class: 'empty-note' }, 'Nothing here yet. Web searches and teacher imports collect their finds here; promote the ones you like to your library.'),
      suggestions: h('p', { class: 'empty-note' }, 'No suggestions match.'),
    }[lf.tab];
    fill(listSlot,
      h('p', { class: 'hint', 'aria-live': 'polite' }, `${total} video${total === 1 ? '' : 's'}`),
      total ? h('div', { class: 'rows' }, list.map((v) => row(v, model, helpful(v)))) : (buckets()[lf.tab].length ? h('p', { class: 'empty-note' }, 'Nothing matches those filters.') : empty),
      total > list.length ? h('button', { class: 'btn', type: 'button', onclick: () => { lf.show += 30; renderList(); } }, `Show more (${total - list.length} left)`) : null);
  }

  function row(v, model, help) {
    const done = model.doneCount.get(v.id) ?? 0;
    const lib = ctx.state.library[v.id];
    const topAreas = Object.entries(v.profile?.areas ?? {}).filter(([a, s]) => s >= 0.5 && a !== 'full_body').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
    const isBlocked = ctx.state.blocked.includes(v.id);
    return h('article', { class: 'row-card', 'data-video': v.id },
      h('button', { class: 'thumb', type: 'button', onclick: () => play(v.id), 'aria-label': `Play ${v.title}` },
        h('img', { src: thumb(v.id), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }),
        h('span', { class: 'len' }, v.durationSec == null ? '?' : `${v.durationApprox ? '~' : ''}${formatDuration(v.durationSec)}`)),
      h('div', { class: 'body' },
        h('h4', null, v.title),
        h('p', { class: 'meta' }, v.channel || 'channel unknown', fmtViews(v.views) && ` · ${fmtViews(v.views)}`,
          done ? ` · done ${done}×${help != null ? `, ${Math.round(help * 100)}% helpful` : ''}` : ''),
        h('div', { class: 'badges' },
          topAreas.map((a) => h('span', { class: 'badge' }, areaLabel(a))),
          (lib?.tags ?? []).map((t) => h('span', { class: 'badge tag' }, `#${t}`)),
          !v.verified && h('span', { class: 'badge warn', title: 'Not yet checked against YouTube' }, 'unverified'),
          v.evidence?.n >= 5 && h('span', { class: 'badge' }, `${v.evidence.n} comments read`),
          lf.tab === 'suggestions' && lib && h('span', { class: 'badge new' }, '✓ in your library')),
        lib?.note && editing !== v.id ? h('p', { class: 'note-text' }, `“${lib.note}”`) : null,
        editing === v.id ? editor(v, lib) : null),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small primary', type: 'button', onclick: () => play(v.id) }, 'Play'),
        h('button', { class: 'btn small', type: 'button', 'data-action': 'toggle-library', onclick: () => { toggleLibrary(ctx.state, v.id); ctx.store.save(); rerender(); } }, lib ? 'Remove' : '＋ Library'),
        lib ? h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'edit', onclick: () => { editing = editing === v.id ? null : v.id; renderList(); } }, 'Tags & note') : null,
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { (isBlocked ? unblockVideo : blockVideo)(ctx.state, v.id); ctx.store.save(); rerender(); } }, isBlocked ? 'Unhide' : 'Hide')));
  }

  function editor(v, lib) {
    const tags = h('input', { type: 'text', 'aria-label': 'Tags, comma separated', value: (lib.tags ?? []).join(', '), placeholder: 'tags, e.g. morning, after running' });
    const note = h('textarea', { rows: 2, maxlength: 500, 'aria-label': 'Note', placeholder: 'A note to yourself…' });
    note.value = lib.note ?? '';
    return h('div', { class: 'editor' }, tags, note,
      h('div', { class: 'actions' },
        h('button', { class: 'btn small primary', type: 'button', 'data-action': 'save-edit', onclick: () => {
          updateLibraryItem(ctx.state, v.id, { tags: tags.value.split(','), note: note.value }); ctx.store.save(); editing = null; rerender();
        } }, 'Save'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { editing = null; renderList(); } }, 'Cancel')));
  }

  fill(root,
    h('h1', null, 'Library'), heading,
    h('section', { class: 'panel' },
      h('div', { class: 'two' },
        h('div', null, h('h3', null, 'Add to your library'), addForm, followSlot),
        h('div', null, h('h3', null, 'Let the app go looking'), growBtn,
          h('p', { class: 'hint' }, ctx.hasKey ? 'Searches for the muscle areas your library covers least, using your search thoroughness setting. Finds go to Discovered; promote the ones you like.' : 'Needs a free YouTube key (Settings).')))),
    analyzePanel({ onChange: () => rerender() }),
    tabsSlot, covSlot, h('section', { class: 'panel' }, controls, tips, interpSlot, savedSlot, tagSlot), listSlot);
  rerender();
}

