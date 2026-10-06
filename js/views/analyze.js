// "Look at a video first": paste one YouTube link, read the app's analysis of what's in it, then decide
// whether to keep it. Nothing is stored until you press Add.

import { h, fill, thumb, fmtViews } from '../dom.js';
import { ctx, play, analyzeLink, commitAnalysis, addTranscriptToAnalysis } from '../ctx.js';
import { toast } from '../modal.js';
import { areaLabel } from '../lexicon.js';
import { youtubeWatchUrl } from '../query.js';

const badge = (text, cls = '', title) => h('span', { class: `badge ${cls}`, title }, text);
const section = (title, ...body) => h('div', { class: 'a-section' }, h('h4', null, title), ...body);

export function analyzePanel({ onChange = () => {} } = {}) {
  const input = h('input', { type: 'text', id: 'analyze-input', placeholder: 'Paste one YouTube video link', 'aria-label': 'YouTube video link to analyze', spellcheck: 'false', autocomplete: 'off' });
  const btn = h('button', { class: 'btn primary', type: 'submit', id: 'analyze-btn' }, 'Analyze');
  const status = h('p', { class: 'hint', id: 'analyze-status', 'aria-live': 'polite' });
  const slot = h('div', { id: 'analysis-slot' });

  const showCurrent = () => fill(slot, ctx.ui.analysis ? reportCard(ctx.ui.analysis, { onChange: () => { showCurrent(); onChange(); } }) : '');

  const form = h('form', { class: 'analyze-form', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; status.textContent = 'Working…';
    try {
      const res = await analyzeLink(input.value, { progress: (m) => { status.textContent = m; } });
      if (res.error) { status.textContent = res.error; return; }
      ctx.ui.analysis = res;
      status.textContent = res.notes.join(' ');
      showCurrent();
      slot.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    } catch (err) { status.textContent = err.message; toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  } }, input, btn);

  showCurrent();
  return h('section', { class: 'panel', id: 'analyze-panel' },
    h('h3', null, 'Look at a video first'),
    h('p', { class: 'hint' }, 'Paste a video link and I’ll read it — title, description, chapters, tags, and what viewers say in the comments — and show which muscles it works, which exercises it contains, and how it fits what you’re after. Then you decide whether to add it to your library.'),
    form, status, slot);
}

function reportCard({ video, report: r, notes }, { onChange }) {
  const inLib = video.id in ctx.state.library;
  const len = r.durationSec != null ? `${r.durationApprox ? '~' : ''}${Math.round(r.durationSec / 60)} min` : 'length unknown';
  const q = r.quality;

  const addBtn = h('button', { class: 'btn primary', type: 'button', id: 'analysis-add', disabled: inLib, onclick: () => {
    commitAnalysis(video);
    toast(`Added “${video.title}” to your library.`, 'success');
    onChange();
  } }, inLib ? '✓ In your library' : '＋ Add to my library');

  const fitLines = [];
  if (r.fit.coversFocus.length) fitLines.push(`Works ${r.fit.coversFocus.map((f) => `${f.label.toLowerCase()} (your ${f.mode === 'weak' ? 'weak' : 'tight'} spot)`).join(', ')}.`);
  if (r.fit.missesFocus.length && r.areas.length) fitLines.push(`Doesn’t clearly cover ${r.fit.missesFocus.map((f) => f.label.toLowerCase()).join(', ')}, which you’ve said you want to work on.`);
  if (r.fit.fillsGaps.length) fitLines.push(`Fills a gap: your library has few videos for ${r.fit.fillsGaps.map((g) => `${g.label.toLowerCase()} (${g.have})`).join(', ')}.`);
  if (q.newTeacher) fitLines.push('A teacher you haven’t done a routine with yet.');
  if (!fitLines.length) fitLines.push(ctx.state.prefs.focus?.length ? 'Nothing stands out against your standing spots.' : 'Set your usual tight and weak spots in Settings and I’ll tell you how each video fits them.');

  return h('article', { class: 'analysis', id: 'analysis', 'data-video': video.id },
    h('div', { class: 'a-head' },
      h('img', { class: 'a-thumb', src: thumb(video.id), alt: '', width: 160, height: 90, loading: 'lazy' }),
      h('div', null,
        h('h3', { id: 'analysis-title' }, r.title),
        h('p', { class: 'meta' }, r.channel ? h('span', { class: 'channel' }, r.channel) : null, h('span', null, len), fmtViews(q.views) && h('span', null, fmtViews(q.views)), q.likePct != null && h('span', null, `${q.likePct}% like it`)),
        h('div', { class: 'badges' },
          inLib && badge('✓ In your library', 'lib'),
          r.level && badge(r.level), ...r.styles.map((s) => badge(s)),
          q.trusted && badge('Trusted teacher'), q.hiddenGem && badge('Hidden gem', 'gem', 'Well liked relative to its views'),
          video.evidence ? badge(`${video.evidence.n} comments read`) : badge('Comments not read', 'warn')))),
    h('p', { class: 'a-summary', id: 'analysis-summary' }, r.summary),

    section('Muscles it works',
      r.areas.length
        ? h('div', { class: 'a-areas' }, r.areas.map((a) => {
          const bar = h('span', { class: 'bar' }, h('i')); bar.firstChild.style.width = `${Math.max(4, Math.round(a.score * 100))}%`;
          return h('div', { class: 'a-area', 'data-area': a.id }, h('span', { class: 'c-label' }, a.label), bar,
            h('span', { class: 'a-strength' }, a.strength), a.why.length ? h('small', { class: 'a-why' }, a.why.join(' · ')) : null);
        }))
        : h('p', { class: 'hint' }, r.fullBody ? 'No single area stands out; it reads as a whole-body routine.' : 'Nothing in the text says which muscles it works.')),

    r.poses.length ? section('Exercises I found in it', h('div', { class: 'chips' }, r.poses.map((p) =>
      h('span', { class: 'chip static', title: p.mode === 'strength' ? 'strengthening' : p.mode === 'both' ? 'stretch and strengthen' : 'stretch' }, p.label, p.count > 1 ? ` ×${p.count}` : '')))) : null,

    r.chapters.length ? h('details', { class: 'a-section' }, h('summary', null, `Chapters (${r.chapters.length})`),
      h('ol', { class: 'a-chapters' }, r.chapters.map((c) => h('li', null, h('span', { class: 'at' }, c.at), ' ', c.label)))) : null,

    section('What viewers say',
      r.viewers
        ? h('div', null,
          h('p', null, `${r.viewers.n} comments read — ${r.viewers.mood}.`),
          r.viewers.benefits.length ? h('div', { class: 'chips' }, r.viewers.benefits.map((b) => h('span', { class: 'chip static' }, `${b.label} (${b.n})`))) : null,
          h('div', { class: 'quotes' }, r.viewers.quotes.map((qt) => h('blockquote', null, `“${qt.text}”`, h('footer', null, qt.areas.slice(0, 3).map(areaLabel).join(', '))))))
        : h('p', { class: 'hint' }, 'Comments weren’t read for this video.')),

    transcriptSection(r, onChange),

    section('How it fits you', h('ul', { class: 'a-fit' }, fitLines.map((l) => h('li', null, l)))),

    h('p', { class: 'a-limits' }, [...notes, ...r.limits].join(' ')),
    h('div', { class: 'actions' }, addBtn,
      h('button', { class: 'btn', type: 'button', id: 'analysis-add-play', onclick: () => { if (!inLib) commitAnalysis(video); onChange(); play(video.id); } }, inLib ? 'Do it now' : 'Add and do it now'),
      h('a', { class: 'btn ghost', href: youtubeWatchUrl(video.id), target: '_blank', rel: 'noopener noreferrer' }, 'Watch on YouTube ↗'),
      h('button', { class: 'btn ghost', type: 'button', id: 'analysis-discard', onclick: () => { ctx.ui.analysis = null; onChange(); } }, 'Close')));
}

const HOW_TO_COPY = 'On YouTube, open the video, click “…more” under the player, then “Show transcript”. Select the text, copy it, and paste it here. (YouTube doesn’t let other programs fetch transcripts of other people’s videos, so this is the way.)';

function transcriptSection(r, onChange) {
  const box = h('textarea', { id: 'analysis-transcript', rows: 6, 'aria-label': 'Transcript', placeholder: 'Paste the transcript here (timestamps are fine)…', spellcheck: 'false' });
  const status = h('p', { class: 'hint', id: 'transcript-status', 'aria-live': 'polite' });
  const apply = () => {
    const a = addTranscriptToAnalysis(box.value);
    if (!a) { status.textContent = 'I couldn’t read any text there, so nothing was changed. Paste the transcript as copied from YouTube.'; return; }
    onChange();
  };
  const t = r.transcript;
  return h('div', { class: 'a-section', id: 'analysis-transcript-section' },
    h('h4', null, 'What the teacher says'),
    t ? h('div', null,
      h('p', null, `Read ${t.words.toLocaleString()} spoken words.`),
      t.heard.length ? h('p', null, 'Talks most about: ', t.heard.map((x) => x.label).join(', '), '.') : h('p', { class: 'hint' }, 'The teacher doesn’t name muscles much; the exercises are what counts.'),
      t.timeline.length ? h('details', null, h('summary', null, `Exercises by time (${t.timeline.length})`),
        h('ol', { class: 'a-chapters' }, t.timeline.map((x) => h('li', null, h('span', { class: 'at' }, x.at), ' ', x.label)))) : null)
      : h('p', { class: 'hint' }, 'No transcript yet. A transcript is the richest source there is for what each exercise is good for.'),
    h('details', { class: 'transcript-box' },
      h('summary', null, t ? 'Replace the transcript' : 'Add the transcript (optional)'),
      h('p', { class: 'hint' }, HOW_TO_COPY), box,
      h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', id: 'transcript-apply', onclick: apply }, 'Update the analysis'),
        t ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { box.value = ''; apply(); } }, 'Remove it') : null),
      status));
}
