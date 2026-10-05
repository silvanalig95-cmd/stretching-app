// Library: everything the app knows about. It grows every time you search the web.

import { h, fill, thumb, fmtViews } from '../dom.js';
import { ctx, client, play, growLibrary } from '../ctx.js';
import { AREAS, areaLabel } from '../lexicon.js';
import { parseVideoId, youtubeSearchUrl } from '../query.js';
import { formatDuration, qualityScore, analyzeComments, applyComments } from '../analyze.js';
import { addManualVideo, toggleSaved, blockVideo, unblockVideo } from '../state.js';
import { fetchOEmbed } from '../youtube.js';
import { buildModel, coverage } from '../model.js';
import { toast } from '../modal.js';

const LEN = { '': null, short: [0, 10], mid: [10, 20], long: [20, 30], xl: [30, 999] };

export function mountLibrary(root) {
  const lf = (ctx.ui.lib ??= { q: '', area: '', len: '', sort: 'quality', status: '', show: 30 });
  const listSlot = h('div', { id: 'lib-list' });
  const covSlot = h('section', { id: 'coverage', class: 'panel' });
  const heading = h('p', { class: 'sub' });

  const rerender = () => { renderHeading(); renderCoverage(); renderList(); };
  const renderHeading = () => {
    const n = Object.keys(ctx.state.videos).length;
    heading.textContent = `${n} videos known. Every web search adds what it finds, so this keeps growing.`;
  };

  // ---- add by link
  const linkInput = h('input', { type: 'text', id: 'add-link', placeholder: 'Paste a YouTube link you found…', 'aria-label': 'YouTube link', autocomplete: 'off' });
  const addBtn = h('button', { class: 'btn', type: 'submit', id: 'add-btn' }, 'Add');
  const addForm = h('form', { class: 'add-form', onsubmit: async (e) => {
    e.preventDefault();
    const id = parseVideoId(linkInput.value);
    if (!id) { toast('That doesn’t look like a YouTube video link.', 'error'); return; }
    addBtn.disabled = true;
    try { await addByLink(id); linkInput.value = ''; rerender(); } finally { addBtn.disabled = false; }
  } }, linkInput, addBtn);

  // ---- grow
  const growBtn = h('button', { class: 'btn', type: 'button', id: 'grow', disabled: !ctx.hasKey, onclick: async () => {
    const cov = coverage(Object.values(ctx.state.videos), ctx.state.blocked);
    const thin = Object.entries(cov).filter(([a]) => a !== 'full_body').sort((a, b) => a[1] - b[1] || Math.random() - 0.5).slice(0, 2).map(([a]) => a);
    growBtn.disabled = true; growBtn.textContent = 'Searching…';
    try {
      const { added, report } = await growLibrary(thin, { queries: 3 });
      toast(`Added ${added} new videos for ${thin.map(areaLabel).join(' & ')}; read ${report.commentsRead} comments.`, 'success', 7000);
    } catch (err) { toast(err.message, 'error'); }
    growBtn.disabled = !ctx.hasKey; growBtn.textContent = 'Grow library where it’s thin';
    rerender();
  } }, 'Grow library where it’s thin');

  // ---- filters
  const sel = (id, label, opts, key) => h('label', { class: 'field' }, h('span', null, label),
    h('select', { id, onchange: (e) => { lf[key] = e.target.value; lf.show = 30; renderList(); renderCoverage(); } },
      opts.map(([v, t]) => h('option', { value: v, selected: lf[key] === v }, t))));
  const search = h('input', { type: 'search', id: 'lib-q', value: lf.q, placeholder: 'Search titles & channels', 'aria-label': 'Search library',
    oninput: (e) => { lf.q = e.target.value; lf.show = 30; renderList(); } });
  const controls = h('div', { class: 'controls' },
    h('label', { class: 'field grow' }, h('span', null, 'Search'), search),
    sel('lib-area', 'Muscle', [['', 'Any'], ...AREAS.map((a) => [a.id, a.label])], 'area'),
    sel('lib-len', 'Length', [['', 'Any'], ['short', 'Under 10'], ['mid', '10–20'], ['long', '20–30'], ['xl', '30+']], 'len'),
    sel('lib-status', 'Show', [['', 'Available'], ['new', 'Not done yet'], ['done', 'Done before'], ['saved', 'Saved'], ['blocked', 'Hidden by me'], ['broken', 'Unavailable']], 'status'),
    sel('lib-sort', 'Sort', [['quality', 'Best quality'], ['fit', 'Best for muscle'], ['helpful', 'Most helpful to me'], ['new', 'Newest added'], ['short', 'Shortest'], ['long', 'Longest']], 'sort'));

  // ---- coverage strip
  function renderCoverage() {
    const cov = coverage(Object.values(ctx.state.videos), ctx.state.blocked);
    const max = Math.max(5, ...Object.values(cov));
    fill(covSlot, 
      h('h3', null, 'Coverage by muscle'),
      h('p', { class: 'hint' }, 'Videos that clearly work each area. Short bars are where the next web search can help most.'),
      h('div', { class: 'cov' }, AREAS.filter((a) => a.id !== 'full_body').map((a) => {
        const bar = h('span', { class: 'bar' }, h('i'));
        bar.firstChild.style.width = `${Math.max(3, (cov[a.id] / max) * 100)}%`;
        return h('button', { type: 'button', class: `cov-row${lf.area === a.id ? ' on' : ''}${cov[a.id] < 3 ? ' thin' : ''}`, 'aria-pressed': lf.area === a.id,
          onclick: () => { lf.area = lf.area === a.id ? '' : a.id; document.getElementById('lib-area').value = lf.area; renderCoverage(); renderList(); } },
        h('span', { class: 'c-label' }, a.label), bar, h('span', { class: 'c-n' }, cov[a.id]));
      })));
  }

  // ---- list
  function renderList() {
    const model = buildModel(ctx.state.history, ctx.state.videos);
    const { videos, blocked, saved } = ctx.state;
    const words = lf.q.toLowerCase().split(/\s+/).filter(Boolean);
    const range = LEN[lf.len];
    const helpful = (v) => {
      let s = 0, n = 0;
      for (const [k, e] of model.videoArea) if (k.startsWith(`${v.id}|`)) { s += e.sum; n += e.n; }
      return n ? s / n : null;
    };
    let list = Object.values(videos).filter((v) => {
      const isBlocked = blocked.includes(v.id);
      if (lf.status === 'blocked') return isBlocked;
      if (lf.status === 'broken') return v.broken || v.embeddable === false;
      if (isBlocked || v.broken || v.embeddable === false) return false;
      if (lf.status === 'done' && !model.doneCount.has(v.id)) return false;
      if (lf.status === 'new' && model.doneCount.has(v.id)) return false;
      if (lf.status === 'saved' && !saved.includes(v.id)) return false;
      if (words.length && !words.every((w) => `${v.title} ${v.channel}`.toLowerCase().includes(w))) return false;
      if (lf.area && (v.profile?.areas?.[lf.area] ?? 0) < 0.45) return false;
      if (range) { const m = (v.durationSec ?? 0) / 60; if (v.durationSec == null || m < range[0] || m >= range[1]) return false; }
      return true;
    });
    const key = {
      quality: (v) => qualityScore(v), fit: (v) => v.profile?.areas?.[lf.area] ?? 0, helpful: (v) => helpful(v) ?? -1,
      new: (v) => v.addedAt ?? 0, short: (v) => -(v.durationSec ?? 1e9), long: (v) => v.durationSec ?? 0,
    }[lf.sort];
    list.sort((a, b) => key(b) - key(a));
    const total = list.length;
    list = list.slice(0, lf.show);

    fill(listSlot, 
      h('p', { class: 'hint', 'aria-live': 'polite' }, `${total} video${total === 1 ? '' : 's'}`),
      total ? h('div', { class: 'rows' }, list.map((v) => row(v, model, helpful(v)))) : h('p', { class: 'empty-note' }, 'Nothing matches. Loosen the filters, or search the web from the Today tab.'),
      total > list.length ? h('button', { class: 'btn', type: 'button', onclick: () => { lf.show += 30; renderList(); } }, `Show more (${total - list.length} left)`) : null);
  }

  function row(v, model, help) {
    const done = model.doneCount.get(v.id) ?? 0;
    const topAreas = Object.entries(v.profile?.areas ?? {}).filter(([a, s]) => s >= 0.5 && a !== 'full_body').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
    const isBlocked = ctx.state.blocked.includes(v.id), saved = ctx.state.saved.includes(v.id);
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
          !v.verified && h('span', { class: 'badge warn', title: 'Not yet checked against YouTube' }, 'unverified'),
          v.evidence?.n >= 5 && h('span', { class: 'badge' }, `${v.evidence.n} comments read`),
          v.source === 'search' && h('span', { class: 'badge' }, 'found by search'))),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small primary', type: 'button', onclick: () => play(v.id) }, 'Play'),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-pressed': saved, onclick: () => { toggleSaved(ctx.state, v.id); ctx.store.save(); renderList(); } }, saved ? '★' : '☆'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { (isBlocked ? unblockVideo : blockVideo)(ctx.state, v.id); ctx.store.save(); rerender(); } }, isBlocked ? 'Unhide' : 'Hide')));
  }

  fill(root, 
    h('h1', null, 'Library'), heading,
    h('section', { class: 'panel' },
      h('div', { class: 'two' },
        h('div', null, h('h3', null, 'Add a video you found'), addForm,
          h('p', { class: 'hint' }, 'No key? ', h('a', { href: youtubeSearchUrl('yoga stretch routine follow along'), target: '_blank', rel: 'noopener noreferrer' }, 'Search YouTube yourself ↗'), ' and paste links here; the app reads the rest when you play them.')),
        h('div', null, h('h3', null, 'Let the app go looking'), growBtn,
          h('p', { class: 'hint' }, ctx.hasKey ? 'Searches the muscle areas you have the fewest videos for (≈320 units).' : 'Needs a free YouTube key (Settings).')))),
    covSlot, h('section', { class: 'panel' }, controls), listSlot);
  rerender();
}

/** Add one video by id: full details via the API if we have a key, otherwise whatever oEmbed gives. */
async function addByLink(id) {
  const api = client();
  try {
    if (api) {
      const [rec] = await api.videos([id]);
      if (!rec) { toast('YouTube has no public video with that id.', 'error'); return; }
      const saved = addManualVideo(ctx.state, rec);
      const comments = await api.comments(id);
      saved.evidence = analyzeComments(comments);
      saved.profile = applyComments(saved.profile, saved.evidence);
      toast(`Added “${saved.title}” and read ${saved.evidence.n} comments.`, 'success');
    } else {
      const meta = await fetchOEmbed(id);
      const saved = addManualVideo(ctx.state, { id, title: meta?.title || 'Video (title loads when played)', channel: meta?.channel || '' });
      toast(`Added “${saved.title}”. Its length is filled in when you play it.`, 'success');
    }
    ctx.store.save();
  } catch (e) { toast(e.message, 'error'); }
}
