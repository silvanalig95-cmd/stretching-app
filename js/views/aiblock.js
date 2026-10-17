// The AI helper's buttons and what it leaves on a video: "✨ Ask Gemini" on Today and in "Look at a video first", Gemini's reading
// of a video, and the Library's "let Gemini read my videos". Nothing here runs by itself: each thing is one press.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { aiStatusNow } from '../gemini.js';
import { readingLine } from '../ai.js';
import { aiCandidates, readMany } from '../aiwork.js';
import { toast } from '../modal.js';

/** null: no server to hold a key (the helper can't exist); 'setup': there is no key yet; 'ready'. */
export function aiGate() {
  const st = aiStatusNow();
  return !st ? null : st.ready ? 'ready' : 'setup';
}

const sayDone = (video, ai) => `Gemini ${ai.mode === 'video' ? 'watched' : 'read'} “${video.title}”: ${ai.sections.length ? `${ai.sections.length} sections, ` : ''}${Object.keys(ai.areas).length} muscle areas${ai.kind ? `, ${ai.kind.id}` : ''}.`;

/**
 * "✨ Ask Gemini ▾": watch the video (timeline, poses, kind) or read its text (cheaper, no timeline). `read(mode)` does the work and
 * resolves to the reading; `onDone` redraws.
 * @param {{id:string,title:string}} video
 * @param {{read:(mode:'video'|'text')=>Promise<object>, onDone?:()=>void, cls?:string}} o
 */
export function aiMenu(video, { read, onDone = () => {}, cls = 'btn ghost' }) {
  const gate = aiGate();
  if (!gate) return null;
  if (gate === 'setup') return h('a', { class: cls, href: '#settings', id: 'ai-setup', title: 'Let Google’s Gemini watch videos for you. It needs a free key: set it up in Settings.', onclick: (e) => { e.preventDefault(); ctx.hooks.navigate('settings'); } }, '✨ Set up the AI helper');
  const summary = h('summary', { class: cls, title: 'Gemini can watch this public video and tell the app its sections, poses and kind' }, '✨ Ask Gemini ▾');
  const details = h('details', { class: 'menu', 'data-menu': 'ai' }, summary);
  const run = async (mode) => {
    details.open = false;
    summary.textContent = mode === 'video' ? '✨ Gemini is watching… (up to a minute or two)' : '✨ Gemini is reading…';
    details.classList.add('busy');
    try {
      const ai = await read(mode);
      toast(sayDone(video, ai), 'success', 6000);
    } catch (e) { toast(e.message, 'error', 9000); }
    details.classList.remove('busy');
    onDone();
  };
  fill(details, summary, h('div', { class: 'menu-items', role: 'menu' },
    h('button', { type: 'button', role: 'menuitem', 'data-ai': 'video', onclick: () => run('video') }, 'Watch the video (best: sections and poses)'),
    h('button', { type: 'button', role: 'menuitem', 'data-ai': 'text', onclick: () => run('text') }, 'Read its text only (quicker, no sections)'),
    h('p', { class: 'menu-note small' }, 'Only the public video and its public text are sent to Google. Gemini can be wrong: its reading is shown as such, and can be removed.')));
  return details;
}

/** What Gemini made of a video, in a few lines, with a way to take it away. Nothing when it was never asked. */
export function aiReadingBlock(video, { onRemove = () => {} } = {}) {
  const ai = video?.ai;
  if (!ai || ai.v !== 1) return null;
  return h('div', { class: 'ai-block', id: 'ai-reading' },
    h('h3', null, '✨ Gemini’s reading'),
    h('p', { class: 'hint' }, readingLine(ai), ai.model ? ` · ${ai.model}` : ''),
    ai.summary ? h('p', null, ai.summary) : null,
    ai.cautions?.length ? h('ul', { class: 'ai-cautions' }, ai.cautions.map((c) => h('li', null, '⚠ ', c))) : null,
    h('p', { class: 'hint' }, 'An estimate by an AI: it can misjudge a pose or a time. It only adds to what the words say, and never overrides a kind you set yourself.',
      ' ', h('button', { class: 'link', type: 'button', id: 'ai-remove-reading', onclick: onRemove }, 'Remove this reading')));
}

/**
 * "Let Gemini read my videos": the videos worth asking about, run a few at a time, with a Stop. The Library uses it for your own videos
 * (inside the add menu); a teacher's page uses it for that teacher's.
 * @param {{onDone?:()=>void, candidates?:(mode:'video'|'text')=>string[], title?:string, rootId?:string, perWatch?:number, perRead?:number}} [o]
 */
export function aiLibrarySection({ onDone = () => {}, candidates = (mode) => aiCandidates(mode), title = 'Let Gemini read my videos', rootId = 'ai-library', perWatch = 25, perRead = 60 } = {}) {
  const gate = aiGate();
  if (!gate) return null;
  const root = h('div', { class: 'ai-library', id: rootId });
  let stop = false, busy = false;
  const draw = () => {
    if (gate === 'setup') { fill(root, h('h3', null, title), h('p', { class: 'hint' }, 'Gemini can watch the videos that have no chapter list and give them sections and poses. ', h('a', { href: '#settings', onclick: (e) => { e.preventDefault(); ctx.hooks.navigate('settings'); } }, 'Set up the AI helper'), ' first (it is free).')); return; }
    const watch = candidates('video'), text = candidates('text');
    const mins = Math.round(watch.slice(0, perWatch).reduce((a, id) => a + (ctx.state.videos[id]?.durationSec ?? 0), 0) / 60);
    const go = async (mode, ids, per) => {
      if (busy) return;
      busy = true; stop = false; draw();
      const progress = document.getElementById('ai-progress');
      const res = await readMany(ids.slice(0, per), { mode, progress: (m) => { if (progress) progress.textContent = m; }, shouldStop: () => stop });
      busy = false;
      toast(`Gemini ${mode === 'video' ? 'watched' : 'read'} ${res.done} video${res.done === 1 ? '' : 's'}${res.failed.length ? `; ${res.failed.length} could not be read` : ''}${res.stopped && res.stopped !== 'you' ? `. Stopped early: ${res.message}` : ''}.`, res.stopped && res.stopped !== 'you' ? 'error' : 'success', 9000);
      draw(); onDone();
    };
    fill(root, h('h3', null, title),
      h('p', { class: 'hint' }, 'Gemini adds a timeline, poses and a kind to videos that the words alone can’t describe. A few at a time, so you stay inside Google’s free limits; you can stop at any point.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', id: 'ai-watch-all', disabled: busy || !watch.length, title: 'Watches each video (Google’s free tier covers about 8 hours of YouTube video a day)', onclick: () => go('video', watch, perWatch) },
          watch.length ? `Watch ${Math.min(perWatch, watch.length)} of ${watch.length} videos without chapters (about ${mins} min of video)` : 'No video here is missing its chapters'),
        h('button', { class: 'btn', type: 'button', id: 'ai-read-all', disabled: busy || !text.length, onclick: () => go('text', text, perRead) },
          text.length ? `Read the text of ${Math.min(perRead, text.length)} of ${text.length} videos` : 'Every video has been read'),
        busy ? h('button', { class: 'btn ghost', type: 'button', id: 'ai-stop', onclick: () => { stop = true; } }, 'Stop') : null),
      h('p', { class: 'hint', id: 'ai-progress', 'aria-live': 'polite' }, busy ? 'Starting…' : ''));
  };
  draw();
  return root;
}
