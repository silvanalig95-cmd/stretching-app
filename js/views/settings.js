// Settings: YouTube key, how adventurous the app is, backups.

import { h, fill } from '../dom.js';
import { ctx, client, quotaInfo } from '../ctx.js';
import { exportData, mergeImport } from '../state.js';
import { verifyVideos } from '../youtube.js';
import { toast } from '../modal.js';
import { localDate } from '../model.js';

export function mountSettings(root) {
  const { state, store } = ctx;
  const prefs = state.prefs;
  const qi = quotaInfo();

  // ---------------------------------------------------------------- key
  const keyInput = h('input', { type: 'password', id: 'api-key', value: store.config.apiKey, placeholder: 'Paste your YouTube Data API key', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'YouTube API key' });
  const keyStatus = h('p', { class: 'hint', id: 'key-status', 'aria-live': 'polite' }, store.config.apiKey ? 'A key is saved.' : 'No key yet. The app still works from your library, but can’t search the web.');
  const saveKey = async () => {
    store.config.apiKey = keyInput.value.trim();
    await store.saveConfig();
    ctx.state.prefs.searchWeb = !!store.config.apiKey || prefs.searchWeb;
    ctx.ui.verifiedTried = false;
    if (!store.config.apiKey) { keyStatus.textContent = 'Key removed.'; return; }
    keyStatus.textContent = 'Testing…';
    try {
      const api = client();
      const sample = Object.values(state.videos).find((v) => v.source === 'starter');
      await api.videos([sample?.id ?? 'dQw4w9WgXcQ']);
      keyStatus.textContent = '✓ The key works. Web search is on.';
      toast('YouTube key saved and working.', 'success');
    } catch (e) { keyStatus.textContent = `✗ ${e.message}`; }
  };

  const steps = h('details', { class: 'steps' },
    h('summary', null, 'How do I get a key? (free, ~3 minutes)'),
    h('ol', null,
      h('li', null, 'Go to ', h('a', { href: 'https://console.cloud.google.com/', target: '_blank', rel: 'noopener noreferrer' }, 'console.cloud.google.com'), ' and sign in with a Google account. Create a project (any name).'),
      h('li', null, h('strong', null, 'APIs & Services → Library'), ', search for “YouTube Data API v3”, and press ', h('strong', null, 'Enable'), '.'),
      h('li', null, h('strong', null, 'APIs & Services → Credentials → Create credentials → API key'), '. Copy the key.'),
      h('li', null, 'Recommended: click the key, choose “Restrict key”, and allow only “YouTube Data API v3”.'),
      h('li', null, 'Paste it above and press Save. The free allowance is 10,000 units a day; one web search here costs 100 to 400.')));

  // ---------------------------------------------------------------- prefs
  const adv = h('input', { type: 'range', id: 'adventure', min: 0, max: 1, step: 0.05, value: prefs.adventure, 'aria-label': 'Adventurousness',
    oninput: (e) => { prefs.adventure = Number(e.target.value); advLabel.textContent = advText(prefs.adventure); store.save(); } });
  const advText = (x) => (x < 0.2 ? 'mostly my favourites' : x < 0.5 ? 'a mix, leaning familiar' : x < 0.8 ? 'a mix, leaning new' : 'surprise me');
  const advLabel = h('strong', null, advText(prefs.adventure));
  const queries = h('select', { id: 'queries', onchange: (e) => { prefs.queriesPerRun = Number(e.target.value); store.save(); } },
    [1, 2, 3].map((n) => h('option', { value: n, selected: prefs.queriesPerRun === n }, `${n} search${n > 1 ? 'es' : ''} per run (up to ≈${n * 200 + prefs.commentVideos + 6} units)`)));
  const comments = h('input', { type: 'number', id: 'comment-videos', min: 0, max: 25, value: prefs.commentVideos, 'aria-label': 'Videos whose comments to read per search',
    onchange: (e) => { prefs.commentVideos = Math.max(0, Math.min(25, Number(e.target.value) || 0)); store.save(); } });
  const trusted = h('textarea', { id: 'trusted', rows: 6, 'aria-label': 'Trusted teachers, one per line',
    onchange: (e) => { prefs.trusted = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); store.save(); toast('Trusted teachers updated.'); } }, prefs.trusted.join('\n'));

  // ---------------------------------------------------------------- data
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, id: 'import-file', onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'unfurl') throw new Error('This file isn’t an Unfurl backup.');
      const before = state.history.length;
      mergeImport(state, data);
      store.save();
      toast(`Imported. ${state.history.length - before} new history entries.`, 'success');
      mountSettings(root);
    } catch (err) { toast(`Couldn’t import: ${err.message}`, 'error'); }
  } });
  const verifyBtn = h('button', { class: 'btn', type: 'button', disabled: !ctx.hasKey, onclick: async () => {
    verifyBtn.disabled = true;
    try {
      const todo = Object.values(state.videos).filter((v) => !v.verified && !v.broken).slice(0, 100);
      const fixed = await verifyVideos({ client: client(), videos: todo });
      for (const v of fixed) state.videos[v.id] = v;
      store.save();
      toast(`Checked ${fixed.length} videos; ${fixed.filter((v) => v.broken).length} no longer exist.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    verifyBtn.disabled = !ctx.hasKey;
  } }, 'Check unverified videos now');

  fill(root, 
    h('h1', null, 'Settings'),
    h('section', { class: 'panel' },
      h('h2', null, 'YouTube search'),
      h('p', null, 'A free YouTube key lets the app search the whole of YouTube on its own, read each video’s details and its viewer comments, and add what it finds to your library. Your key stays on this computer and is only ever sent to Google’s YouTube API.'),
      h('form', { class: 'key-form', onsubmit: (e) => { e.preventDefault(); saveKey(); } }, keyInput, h('button', { class: 'btn primary', id: 'save-key', type: 'submit' }, 'Save & test')),
      keyStatus, steps,
      h('div', { class: 'quota' }, h('span', null, `Today: ${qi.used.toLocaleString()} of ${qi.limit.toLocaleString()} units used`),
        (() => { const b = h('span', { class: 'bar' }, h('i')); b.firstChild.style.width = `${Math.min(100, (qi.used / qi.limit) * 100)}%`; return b; })())),

    h('section', { class: 'panel' },
      h('h2', null, 'How it searches'),
      h('label', { class: 'field' }, h('span', null, 'Adventurousness: ', advLabel), adv,
        h('small', { class: 'hint' }, 'Higher = more teachers and videos you haven’t tried yet, in searches and in suggestions.')),
      h('label', { class: 'field' }, h('span', null, 'Effort per web search'), queries),
      h('label', { class: 'field' }, h('span', null, 'Videos whose comments are read per search'), comments,
        h('small', { class: 'hint' }, 'Comments are where viewers say which muscles it helped. 1 unit per video.')),
      h('label', { class: 'field' }, h('span', null, 'Trusted teachers (one per line)'), trusted,
        h('small', { class: 'hint' }, 'A small ranking boost, and used to flavour searches. Teachers you rate well earn trust automatically.'))),

    h('section', { class: 'panel' },
      h('h2', null, 'Your data'),
      h('p', null, store.mode === 'server'
        ? 'Saved as files in the app’s userdata folder on this computer (history, library, learned preferences; the key is kept separately).'
        : 'Saved in this browser only. Run serve.py to keep it in files instead; export a backup now and then either way.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', id: 'export', type: 'button', onclick: () => {
          const url = URL.createObjectURL(new Blob([exportData(state)], { type: 'application/json' }));
          const a = h('a', { href: url, download: `unfurl-backup-${localDate()}.json` });
          document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } }, 'Export backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => importInput.click() }, 'Import backup'), importInput,
        verifyBtn,
        h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!confirm('Erase your history, ratings and library and start over? Your API key is kept.')) return;
          await store.replace(null); ctx.ui.ranked = []; ctx.ui.featuredId = null; toast('Everything reset.'); mountSettings(root);
        } }, 'Reset everything')),
      store.lastError ? h('p', { class: 'hint warn' }, store.lastError) : null));
}
