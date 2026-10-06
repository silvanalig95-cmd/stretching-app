// Shell: loads data, builds the header, switches between views.

import { Store } from './store.js';
import { ctx, initFilters, play, rankNow, enrichTop, findRoutine } from './ctx.js';
import { h } from './dom.js';
import { toast } from './modal.js';
import { mountToday, unmountToday } from './views/today.js';
import { mountLibrary } from './views/library.js';
import { mountJournal } from './views/journal.js';
import { mountStrength } from './views/strength.js';
import { APP_NAME, SECTION_GREEK } from './brand.js';
import { mountSettings } from './views/settings.js';

const TABS = [['today', 'Stretch', mountToday], ['strength', 'Strength', mountStrength], ['library', 'Library', mountLibrary], ['journal', 'Journal', mountJournal], ['settings', 'Settings', mountSettings]];
let mounted = null;

function show(tab) {
  if (tab === mounted) return;
  if (mounted === 'today') unmountToday();
  mounted = tab;
  ctx.ui.tab = tab;
  for (const a of document.querySelectorAll('nav a')) a.toggleAttribute('aria-current', a.dataset.tab === tab);
  const main = document.getElementById('main');
  main.replaceChildren();
  TABS.find(([t]) => t === tab)[2](main);
  document.title = `${TABS.find(([t]) => t === tab)[1]} · ${APP_NAME}`;
  const kicker = document.getElementById('kicker');
  if (kicker) kicker.replaceChildren(h('span', { class: 'greek' }, SECTION_GREEK[tab] ?? ''), h('span', { class: 'latin' }, ` · ${TABS.find(([t]) => t === tab)[1]}`));
}

const tabFromHash = () => (TABS.some(([t]) => t === location.hash.slice(1)) ? location.hash.slice(1) : 'today');

function navigate(tab) {
  show(tab);
  if (location.hash.slice(1) !== tab) location.hash = tab;
}

/** When the server is updated (a new build is deployed), say so and offer a reload; nothing is lost because everything is already saved. */
function watchForUpdates(store) {
  const seconds = store.server.pollSeconds;
  if (store.mode !== 'server' || !seconds || !store.server.build) return;
  const shown = { value: false };
  const check = async () => {
    if (shown.value || document.visibilityState === 'hidden') return;
    const now = await store.currentBuild();
    if (!now?.build || now.build === store.server.build) return;
    shown.value = true;
    document.getElementById('banner').append(h('p', { class: 'banner update', role: 'status', id: 'update-banner' },
      `A new version of ${APP_NAME} is ready (${now.version}). `,
      h('button', { class: 'link', type: 'button', id: 'update-reload', onclick: async () => {
        if (!(await store.flushReliably())) { toast('The latest changes aren’t saved on the server yet, so I haven’t reloaded. Try again in a moment.', 'error'); return; }
        location.reload();
      } }, 'Reload to use it'),
      ' — your data is already saved.'));
  };
  setInterval(check, seconds * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}

async function main() {
  const store = await new Store().init();
  ctx.store = store;
  initFilters();
  ctx.hooks.toast = toast;
  ctx.hooks.navigate = navigate;

  document.getElementById('nav').replaceChildren(...TABS.map(([t, label]) =>
    h('a', { href: `#${t}`, 'data-tab': t, onclick: (e) => { e.preventDefault(); navigate(t); } }, label)));

  window.addEventListener('hashchange', () => show(tabFromHash()));
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });

  show(tabFromHash());
  const where = store.mode === 'server' ? `${APP_NAME} ${store.server.version}${store.server.build ? ` · build ${store.server.build.slice(0, 7)}` : ''}${store.server.user ? ` · signed in as ${store.server.user}` : ''}` : 'Saving in this browser only. Run serve.py to keep your data in files.';
  document.getElementById('storage-note').textContent = where;
  if (store.hostProblem) {
    const { host, allowed } = store.hostProblem;
    document.getElementById('banner').replaceChildren(h('p', { class: 'banner', role: 'alert', id: 'host-banner' },
      `You opened ${APP_NAME} as “${host || 'this address'}”, which the server doesn’t accept, so nothing you do here can be saved on the server. `,
      allowed.length ? `Open it with one of these instead: ${allowed.join(', ')}. ` : '',
      'Or add that name to UNFURL_ALLOWED_HOSTS in the server’s settings (network-settings.bat or unfurl.env), then restart it.'));
  } else if (store.readOnly) {
    document.getElementById('banner').replaceChildren(h('p', { class: 'banner', role: 'alert' }, store.notes.find((n) => /newer version/.test(n)) ?? 'Your data is read-only.'));
  } else {
    for (const note of store.notes) toast(note, 'success', 9000);   // upgrades and recoveries are said out loud, once
  }
  if (store.lastError) toast(store.lastError, 'error');
  watchForUpdates(store);
  store.onMerged = () => toast('Changes you made in another tab or on another device were merged into this page. Reload to see them everywhere.', 'info', 9000);
  store.onSaveState = (ok, message) => {
    const banner = document.getElementById('banner');
    banner.querySelector('#save-banner')?.remove();
    if (!ok) banner.append(h('p', { class: 'banner', role: 'alert', id: 'save-banner' }, `${message} Nothing is lost while this page stays open.`));
    else toast('Saved. The server is back.', 'success');
  };
  window.__unfurl = Object.assign(ctx, { play, rankNow, enrichTop, findRoutine }); // handy for debugging in the console and for tests
}

main().catch((e) => {
  document.getElementById('main').replaceChildren(h('div', { class: 'panel' }, h('h1', null, 'Something went wrong starting up'), h('pre', null, String(e?.stack ?? e))));
});
