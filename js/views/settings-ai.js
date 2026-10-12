// Settings → AI helper (Gemini): add a key, pick a model, see today's use. The key goes to the server and stays there.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { aiStatus, aiSave, aiModels, askGemini, forgetAiStatus } from '../gemini.js';
import { offerModels, pickModel } from '../ai.js';
import { toast } from '../modal.js';

export function aiPanel() {
  const el = h('section', { class: 'panel', id: 'ai-panel' }, h('h2', null, 'AI helper (Gemini)'), h('p', { class: 'hint' }, 'Loading…'));
  let models = [];

  const keyInput = h('input', { type: 'password', id: 'ai-key', placeholder: 'Paste your API key', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Gemini API key' });
  const status = h('p', { class: 'hint', id: 'ai-status', 'aria-live': 'polite' });
  const say = (t) => { status.textContent = t; };

  async function draw() {
    const st = await aiStatus({ fresh: true });
    const chosen = st?.chosenModel ?? '';
    const pick = models.length ? pickModel(models) : null;
    fill(el,
      h('h2', null, 'AI helper (Gemini)'),
      h('p', null, 'Let Google’s Gemini help the app learn about videos and teachers. It can ', h('strong', null, 'watch a public YouTube video'), ' and tell the app its sections, poses and kind (so “Follow along” works even for videos with no chapter list), read what is known about a video, and look for more teachers. Nothing happens until you press one of its buttons.'),
      !st
        ? h('p', { class: 'hint', id: 'ai-needs-server' }, `The AI helper needs the ${ctx.store?.mode === 'server' ? 'server (it couldn’t be reached just now)' : 'server (start.bat or Docker), because the key is kept there and never in the page'}.`)
        : [
          st.source === 'server' && !st.ownKey ? h('p', { class: 'hint' }, `✓ This server already has a Gemini key, so you don’t need one. Paste your own below only if you want a separate allowance.`) : null,
          h('form', { class: 'key-form', onsubmit: async (e) => {
            e.preventDefault();
            const key = keyInput.value.trim();
            if (!key) { say('Paste a key first.'); return; }
            say('Saving and testing…');
            try {
              await aiSave({ key });
              keyInput.value = '';
              models = await aiModels();
              toast('Gemini key saved and working.', 'success');
              await draw();
            } catch (err) { say(`✗ ${err.message}`); await aiSave({ key: '' }).catch(() => {}); forgetAiStatus(); }
          } }, keyInput, h('button', { class: 'btn primary', id: 'ai-save', type: 'submit' }, 'Save & test')),
          status,
          st.ownKey ? h('p', { class: 'hint', id: 'ai-own' }, `A key ending in ${st.ownKey} is saved on the server. `, h('button', { class: 'link', type: 'button', id: 'ai-remove', onclick: async () => {
            await aiSave({ key: '', model: '' }); models = []; toast('Key removed.', 'info'); await draw();
          } }, 'Remove it')) : null,
          st.ready ? h('div', { class: 'ai-model' },
            h('label', { class: 'inline-field' }, h('span', null, 'Model'),
              h('select', { id: 'ai-model', onchange: async (e) => { try { await aiSave({ model: e.target.value }); say(e.target.value ? `Using ${e.target.value}.` : 'Choosing automatically.'); } catch (err) { say(`✗ ${err.message}`); } } },
                h('option', { value: '', selected: !chosen }, pick ? `Choose automatically (now: ${pick})` : `Choose automatically (now: ${st.model})`),
                ...offerModels(models).map((m) => h('option', { value: m.id, selected: m.id === chosen }, m.displayName ? `${m.displayName} (${m.id})` : m.id)))),
            h('p', { class: 'ai-links' }, h('button', { class: 'link', type: 'button', id: 'ai-list', onclick: async () => { say('Asking Google which models this key can use…'); try { models = await aiModels(); say(`${models.length} models found.`); await draw(); } catch (err) { say(`✗ ${err.message}`); } } }, models.length ? 'Refresh the list' : 'Show the models Google offers'),
            ' · ', h('button', { class: 'link', type: 'button', id: 'ai-test', onclick: async () => {
              say('Asking Gemini a tiny question…');
              try { const r = await askGemini({ prompt: 'Reply with exactly this JSON and nothing else: {"ok": true}', maxTokens: 256 }); say(/"ok"\s*:\s*true/.test(r.text) ? `✓ It answered (${r.model}).` : `It answered, but oddly: ${r.text.slice(0, 80)}`); await draw(); }
              catch (err) { say(`✗ ${err.message}`); }
            } }, 'Test it'))) : null,
          st.ready && st.dailyCap ? h('div', { class: 'quota', id: 'ai-quota' }, h('span', null, `Today: ${st.usedToday} of ${st.dailyCap} requests`),
            (() => { const b = h('span', { class: 'bar' }, h('i')); b.firstChild.style.width = `${Math.min(100, (st.usedToday / st.dailyCap) * 100)}%`; return b; })()) : null,
          h('details', { class: 'steps' }, h('summary', null, 'How do I get a key? (free, ~2 minutes)'),
            h('ol', null,
              h('li', null, 'Open ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'aistudio.google.com/apikey'), ' and sign in with a Google account.'),
              h('li', null, 'Press ', h('strong', null, 'Create API key'), ' and copy it.'),
              h('li', null, 'Paste it above and press Save & test. Google’s free tier has daily and per-minute limits (and a daily cap on YouTube video); when one is reached the app says so and you can try again later.'))),
          h('details', { class: 'steps', id: 'ai-privacy' }, h('summary', null, 'What is sent to Google, and who keeps the key?'),
            h('ul', null,
              h('li', null, 'The key is kept on the server (never in this page, never in the backup file you export here, never sent back to the browser) and only used to talk to Google.'),
              h('li', null, 'Only public things are sent: a video’s YouTube link (so Gemini can watch it), its public title, description and comments, a transcript you pasted, and the questions the app asks. Never your history, ratings, notes, tags or library.'),
              h('li', null, 'Google’s terms for the free tier let it use what is submitted to improve its products; the paid tier does not. If that matters to you, use a paid key, or leave the helper off.'),
              h('li', null, 'Gemini can be wrong. Everything it says is checked against what the app knows, shown as Gemini’s reading, and can be removed again.')))],
    );
  }
  draw();
  return el;
}
