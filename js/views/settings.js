// Settings: YouTube key, how it searches, your standing tight/weak spots, and
// your data (where it lives, backups, versions).

import { h, fill, download } from '../dom.js';
import { ctx, client, quotaInfo, cycleArea } from '../ctx.js';
import { exportData, mergeImport, reindexAll, SCHEMA, unfollowChannel, unblockVideo, unblockChannel, unfavoriteChannel } from '../state.js';
import { verifyVideos, THOROUGHNESS } from '../youtube.js';
import { ANALYSIS_VERSION } from '../analyze.js';
import { parentOf, areaPath } from '../lexicon.js';
import { areaPicker } from './areapicker.js';
import { toast } from '../modal.js';
import { APP_NAME } from '../brand.js';
import { localDate, channelBlocker, channelMatcher, FAVORITE_BOOST } from '../model.js';

const HIDDEN_SHOWN = 40;

/** Channels you love: their videos rank higher when they also fit the request. */
function favoritesPanel() {
  const { state, store } = ctx;
  const redraw = () => { document.getElementById('favorites-panel')?.replaceWith(favoritesPanel()); };
  const list = state.favoriteChannels;
  const countFor = (c) => Object.values(state.videos).filter(channelMatcher([c])).length;
  return h('section', { class: 'panel', id: 'favorites-panel' },
    h('h2', null, 'Favourite channels'),
    h('p', { class: 'hint' }, `Teachers you really enjoy. Their videos get up to ${Math.round(FAVORITE_BOOST * 100)}% more weight when ranking, but only as far as they also fit what you asked for (the muscles, the length, the style); a video that doesn’t fit gains nothing. Mark one with “☆ Favourite channel” on any video.`),
    list.length ? h('ul', { class: 'backups', id: 'favorite-channels' }, list.map((c) => h('li', { 'data-channel': c.key },
      h('span', null, '★ ', c.name, h('small', { class: 'muted' }, ` · ${countFor(c)} known video${countFor(c) === 1 ? '' : 's'}`)),
      h('button', { class: 'btn small ghost', type: 'button', 'data-unfavorite': c.key, onclick: () => { unfavoriteChannel(state, c.key); store.save(); toast(`“${c.name}” is no longer a favourite.`, 'info'); redraw(); } }, 'Remove'))))
      : h('p', { class: 'empty-note', id: 'favorites-empty' }, 'None yet. Press “☆ Favourite channel” next to a video from a teacher you like.'));
}

/** Everything you told the app never to suggest again, each with a way back. */
function hiddenPanel() {
  const { state, store } = ctx;
  const redraw = () => { const next = hiddenPanel(); document.getElementById('hidden-panel')?.replaceWith(next); };
  const channels = state.blockedChannels;
  const videos = state.blocked.map((id) => state.videos[id] ?? { id, title: id, channel: '' });
  const countFor = (c) => Object.values(state.videos).filter(channelBlocker([c])).length;
  const expanded = hiddenPanel.expanded === true;
  return h('section', { class: 'panel', id: 'hidden-panel' },
    h('h2', null, 'Hidden videos & channels'),
    h('p', { class: 'hint' }, `Things you told ${APP_NAME} never to suggest again (“Not for me” on a video, or Hide in the Library). They stay in your library if you added them, but are never offered as a routine.`),
    !channels.length && !videos.length ? h('p', { class: 'empty-note', id: 'hidden-empty' }, 'Nothing is hidden. Use “Not for me ▾” on a suggestion to stop a video, or a whole channel, from coming back.') : null,
    channels.length ? h('div', null, h('h3', null, `Blocked channels (${channels.length})`),
      h('ul', { class: 'backups', id: 'blocked-channels' }, channels.map((c) => h('li', { 'data-channel': c.key },
        h('span', null, c.name, h('small', { class: 'muted' }, ` · ${countFor(c)} known video${countFor(c) === 1 ? '' : 's'}`)),
        h('button', { class: 'btn small ghost', type: 'button', 'data-unblock-channel': c.key, onclick: () => { unblockChannel(state, c.key); store.save(); toast(`“${c.name}” can be suggested again.`, 'success'); redraw(); } }, 'Allow again'))))) : null,
    videos.length ? h('div', null, h('h3', null, `Hidden videos (${videos.length})`),
      h('ul', { class: 'backups', id: 'blocked-videos' }, videos.slice(0, expanded ? undefined : HIDDEN_SHOWN).map((v) => h('li', { 'data-video': v.id },
        h('span', null, v.title, v.channel ? h('small', { class: 'muted' }, ` · ${v.channel}`) : null),
        h('button', { class: 'btn small ghost', type: 'button', 'data-unhide': v.id, onclick: () => { unblockVideo(state, v.id); store.save(); redraw(); } }, 'Allow again')))),
      videos.length > HIDDEN_SHOWN && !expanded ? h('button', { class: 'link', type: 'button', onclick: () => { hiddenPanel.expanded = true; redraw(); } }, `Show all ${videos.length}`) : null) : null);
}

export function mountSettings(root) {
  const { state, store } = ctx;
  const prefs = state.prefs;
  const qi = quotaInfo();
  let backupsSlot;

  // ---------------------------------------------------------------- key
  const keyNote = () => (store.config.apiKey ? 'A key is saved.'
    : ctx.usesServerKey ? `✓ This server provides the YouTube connection, so you don’t need a key${store.server.ytDailyUnits ? ` (your share is ${store.server.ytDailyUnits.toLocaleString()} units a day)` : ''}. Paste your own below only if you want a separate allowance.`
      : 'No key yet. The app still works from what it already knows, but can’t search the web.');
  const keyInput = h('input', { type: 'password', id: 'api-key', value: store.config.apiKey, placeholder: 'Paste your YouTube Data API key', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'YouTube API key' });
  const keyStatus = h('p', { class: 'hint', id: 'key-status', 'aria-live': 'polite' }, keyNote());
  const saveKey = async () => {
    store.config.apiKey = keyInput.value.trim();
    await store.saveConfig();
    ctx.state.prefs.searchWeb = !!store.config.apiKey || prefs.searchWeb;
    ctx.ui.verifiedTried = false;
    if (!store.config.apiKey) { keyStatus.textContent = `Key removed. ${ctx.usesServerKey ? 'The server’s shared connection is used instead.' : ''}`.trim(); return; }
    keyStatus.textContent = 'Testing…';
    try {
      const api = client();
      const sample = Object.values(state.videos).find((v) => v.source === 'suggestion');
      await api.videos([sample?.id ?? 'dQw4w9WgXcQ']);
      keyStatus.textContent = '✓ The key works. Web search is on.';
      toast('YouTube key saved and working.', 'success');
    } catch (e) { keyStatus.textContent = `✗ ${e.message}`; }
  };

  const steps = h('details', { class: 'steps' },
    h('summary', null, ctx.usesServerKey ? 'Want your own YouTube key instead? (optional, free, ~3 minutes)' : 'How do I get a key? (free, ~3 minutes)'),
    h('ol', null,
      h('li', null, 'Go to ', h('a', { href: 'https://console.cloud.google.com/', target: '_blank', rel: 'noopener noreferrer' }, 'console.cloud.google.com'), ' and sign in with a Google account. Create a project (any name).'),
      h('li', null, h('strong', null, 'APIs & Services → Library'), ', search for “YouTube Data API v3”, and press ', h('strong', null, 'Enable'), '.'),
      h('li', null, h('strong', null, 'APIs & Services → Credentials → Create credentials → API key'), '. Copy the key.'),
      h('li', null, 'Under “API restrictions” choose ', h('strong', null, 'Restrict key → YouTube Data API v3'), '. Leave “Application restrictions” on None.'),
      h('li', null, 'Paste it above and press Save. The free allowance is 10,000 units a day; one web search here costs 100 to 400.')));

  // ---------------------------------------------------------------- prefs
  const adv = h('input', { type: 'range', id: 'adventure', min: 0, max: 1, step: 0.05, value: prefs.adventure, 'aria-label': 'Adventurousness',
    oninput: (e) => { prefs.adventure = Number(e.target.value); advLabel.textContent = advText(prefs.adventure); store.save(); } });
  const advText = (x) => (x < 0.2 ? 'mostly my favourites' : x < 0.5 ? 'a mix, leaning familiar' : x < 0.8 ? 'a mix, leaning new' : 'surprise me');
  const advLabel = h('strong', null, advText(prefs.adventure));
  const effortSel = h('select', { id: 'thoroughness', onchange: (e) => { prefs.thoroughness = e.target.value; store.save(); effortHint.textContent = hintFor(e.target.value); } },
    Object.entries(THOROUGHNESS).map(([k, e]) => h('option', { value: k, selected: prefs.thoroughness === k }, e.label)));
  const hintFor = (k) => `${THOROUGHNESS[k].blurb}. Up to ≈${THOROUGHNESS[k].budget} units per search (usually about ${Math.round(THOROUGHNESS[k].budget * 0.45)}); reads comments on up to ${THOROUGHNESS[k].commentVideos} videos.`;
  const effortHint = h('small', { class: 'hint' }, hintFor(prefs.thoroughness));
  const trusted = h('textarea', { id: 'trusted', rows: 6, 'aria-label': 'Trusted teachers, one per line',
    onchange: (e) => { prefs.trusted = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); store.save(); toast('Trusted teachers updated.'); } }, prefs.trusted.join('\n'));
  const quality = h('input', { type: 'checkbox', id: 'best-quality', checked: prefs.bestQuality !== false, onchange: (e) => { prefs.bestQuality = e.target.checked; store.save(); } });
  const auto = h('input', { type: 'checkbox', id: 'auto-library', checked: prefs.autoLibrary, onchange: (e) => { prefs.autoLibrary = e.target.checked; store.save(); } });

  // ---------------------------------------------------------------- body profile
  const spotsSlot = h('div', { id: 'spots' });
  const renderSpots = () => {
    const picker = areaPicker({
      skipWhole: true, showSpecific: !!prefs.showSpecific, modeOf: (id) => prefs.focus.find((f) => f.id === id)?.mode,
      onPick: (id) => { cycleArea(id, prefs.focus); store.save(); renderSpots(); },
      onToggle: () => { prefs.showSpecific = !prefs.showSpecific; store.save(); renderSpots(); },
      makeChip: (a, m) => h('button', { type: 'button', class: `chip area${parentOf(a.id) ? ' sub' : ''}${m ? ` on ${m}` : ''}`, 'aria-pressed': !!m, 'aria-label': `${areaPath(a.id)}: ${m ? (m === 'weak' ? 'weak spot' : 'tight spot') : 'not set'}`,
        onclick: () => { cycleArea(a.id, prefs.focus); store.save(); renderSpots(); } },
      a.label, m ? h('small', { class: 'mode' }, m === 'weak' ? 'weak' : 'tight') : null),
    });
    fill(spotsSlot, picker.toggle, picker.groups, picker.map);
  };

  // ---------------------------------------------------------------- data
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, id: 'import-file', onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'unfurl') throw new Error(`This file isn’t a ${APP_NAME} backup.`);
      await store.snapshot('before-import');
      const before = state.history.length;
      mergeImport(state, data);
      store.save();
      toast(`Imported. ${state.history.length - before} new history entries.`, 'success');
      mountSettings(root);
    } catch (err) { toast(`Couldn’t import: ${err.message}`, 'error'); }
  } });
  const verifyBtn = h('button', { class: 'btn', type: 'button', disabled: !ctx.hasKey || store.readOnly, onclick: async () => {
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

  const fmtDate = (t) => new Date(t * 1000).toLocaleString();
  async function renderBackups() {
    const list = await store.listBackups();
    fill(backupsSlot, store.mode !== 'server'
      ? h('p', { class: 'hint' }, 'Automatic backups need the local server (serve.py). Export a backup file now and then instead.')
      : list.length
        ? h('details', { class: 'steps' }, h('summary', null, `${list.length} automatic backup${list.length > 1 ? 's' : ''} (daily, plus one before every data-format upgrade)`),
          h('ul', { class: 'backups' }, list.slice(0, 40).map((b) => h('li', null, h('span', null, b.name, h('small', { class: 'muted' }, ` · ${fmtDate(b.modified)}`)),
            h('button', { class: 'btn small', type: 'button', 'data-restore': b.name, onclick: async () => {
              if (!confirm(`Restore your library and history from “${b.name}”? What you have now is saved as a backup first.`)) return;
              if (await store.restoreBackup(b.name)) { toast('Restored. Reloading…', 'success'); setTimeout(() => location.reload(), 600); } else toast('Couldn’t restore that backup.', 'error');
            } }, 'Restore')))))
        : h('p', { class: 'hint' }, 'No backups yet; the first is made the next time your data changes.'));
  }

  const dataPanel = h('section', { class: 'panel', id: 'data-panel' },
    h('h2', null, 'Your data'),
    store.readOnly ? h('p', { class: 'banner' }, store.notes.find((n) => /newer version/.test(n)) ?? 'Read-only.') : null,
    h('dl', { class: 'facts' },
      h('dt', null, 'Saved'), h('dd', { id: 'data-where' }, store.mode === 'server' ? (store.server.dataDir ? `In files on this computer: ${store.server.dataDir}` : `In files on the ${APP_NAME} server${store.server.user ? `, in ${store.server.user}’s own folder` : ''}`) : 'In this browser only (run serve.py to keep it in files).'),
      h('dt', null, 'Versions'), h('dd', { id: 'versions' }, `${APP_NAME} ${store.server.version ?? '(browser mode)'}${store.server.build ? ` (build ${store.server.build.slice(0, 7)})` : ''} · data format ${SCHEMA} · analysis v${ANALYSIS_VERSION}`),
      h('dt', null, 'Kept apart'), h('dd', null, 'Your library, history and ratings (“profile”) are saved separately from the videos the app has discovered (“index”). The index can always be rebuilt; the profile is what\'s backed up. Your API key is in a third, private file.')),
    h('p', { class: 'hint' }, 'Updating or replacing the app never touches this folder. When a new version changes how data is stored, it upgrades yours automatically and keeps a backup of the old format.'),
    backupsSlot = h('div', { id: 'backups-slot' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', id: 'export', type: 'button', onclick: () => download(`unfurl-backup-${localDate()}.json`, exportData(state), 'application/json') }, 'Export backup'),
      h('button', { class: 'btn', type: 'button', disabled: store.readOnly, onclick: () => importInput.click() }, 'Import backup'), importInput,
      h('button', { class: 'btn', id: 'reanalyze', type: 'button', disabled: store.readOnly, onclick: () => { reindexAll(state); store.save(); toast(`Re-analysed ${Object.keys(state.videos).length} videos from their stored text and comments.`, 'success'); } }, 'Re-analyse everything'),
      verifyBtn,
      h('button', { class: 'btn danger', id: 'reset', type: 'button', disabled: store.readOnly, title: store.readOnly ? 'Disabled: this data came from a newer version' : undefined, onclick: async () => {
        if (!confirm('Erase your library, history and ratings and start over? A backup is kept first, and your API key stays.')) return;
        await store.snapshot('before-reset');
        await store.replace(null); ctx.ui.ranked = []; ctx.ui.featuredId = null; toast('Everything reset (a backup was kept).'); mountSettings(root);
      } }, 'Reset everything')),
    store.lastError ? h('p', { class: 'hint warn' }, store.lastError) : null);

  fill(root,
    h('h1', null, 'Settings'),
    h('section', { class: 'panel' },
      h('h2', null, 'YouTube search'),
      h('p', null, 'A free YouTube key lets the app search the whole of YouTube on its own, import whole teachers and playlists, read each video’s details and its viewer comments, and add what it finds to your index. Your key stays on this computer and is only ever sent to Google’s YouTube API.'),
      h('form', { class: 'key-form', onsubmit: (e) => { e.preventDefault(); saveKey(); } }, keyInput, h('button', { class: 'btn primary', id: 'save-key', type: 'submit' }, 'Save & test')),
      keyStatus, steps,
      h('div', { class: 'quota' }, h('span', null, `Today: ${qi.used.toLocaleString()} of ${qi.limit.toLocaleString()} units used`),
        (() => { const b = h('span', { class: 'bar' }, h('i')); b.firstChild.style.width = `${Math.min(100, (qi.used / qi.limit) * 100)}%`; return b; })())),

    h('section', { class: 'panel' },
      h('h2', null, 'My body'),
      h('p', null, 'Your standing tight and weak spots. Tap once for tight (needs stretching), twice for weak (needs strengthening). Today can start from these, and the Journal tells you which have gone quiet.'),
      spotsSlot),

    h('section', { class: 'panel' },
      h('h2', null, 'Library & searching'),
      h('label', { class: 'check block' }, auto, ' Add everything a web search finds to my library automatically',
        h('small', { class: 'hint' }, 'Off by default: your library stays what you chose. Finds still go to “Discovered” and are used for suggestions either way.')),
      h('label', { class: 'field' }, h('span', null, 'Adventurousness: ', advLabel), adv,
        h('small', { class: 'hint' }, 'Higher = more teachers and videos you haven’t tried yet, in searches and in suggestions.')),
      h('label', { class: 'field' }, h('span', null, 'Search thoroughness'), effortSel, effortHint,
        h('small', { class: 'hint' }, 'A search works in rounds: it looks at many videos, learns from the best fits (their poses and teachers), and searches again until it has found enough strong fits or reached the unit budget. Comments are cheap (1 unit each), so they are read on the best few dozen.')),
      h('label', { class: 'field' }, h('span', null, 'Trusted teachers (one per line)'), trusted,
        h('small', { class: 'hint' }, 'A small ranking boost, and used to flavour searches. Teachers you rate well earn trust automatically.')),
      state.following.length ? h('div', null, h('h3', null, 'Teachers you follow'),
        h('ul', { class: 'backups' }, state.following.map((f) => h('li', null, f.name, h('button', { class: 'btn small ghost', type: 'button', onclick: () => { unfollowChannel(state, f.channelId); store.save(); mountSettings(root); } }, 'Unfollow'))))) : null),
    h('section', { class: 'panel', id: 'video-panel' },
      h('h2', null, 'Video'),
      h('label', { class: 'check block' }, quality, ' Ask YouTube for the highest picture quality',
        h('small', { class: 'hint' }, 'Sent once, when a video starts playing. YouTube decides in the end: it looks at how big the player is, your connection and your own choice, and its embedded player may ignore the request. Under the player you can see what you actually get.')),
      h('p', { class: 'hint' }, 'To fix the quality for good: start a video, open the ⚙ in the player, choose Quality and pick the highest number (1080p or more). YouTube remembers that for this page. A bigger player helps too: “Focus view” makes it as large as the screen allows. Videos that were only uploaded in 720p can’t go higher.')),
    favoritesPanel(),
    hiddenPanel(),
    dataPanel);
  renderSpots();
  renderBackups();
}
