// Shell: loads data, builds the header, switches between views.

import { Store } from './store.js';
import { ctx, initFilters, play, rankNow } from './ctx.js';
import { h } from './dom.js';
import { toast } from './modal.js';
import { mountToday, unmountToday } from './views/today.js';
import { mountLibrary } from './views/library.js';
import { mountJournal } from './views/journal.js';
import { mountSettings } from './views/settings.js';

const TABS = [['today', 'Today', mountToday], ['library', 'Library', mountLibrary], ['journal', 'Journal', mountJournal], ['settings', 'Settings', mountSettings]];
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
  document.title = `${TABS.find(([t]) => t === tab)[1]} · Unfurl`;
}

const tabFromHash = () => (TABS.some(([t]) => t === location.hash.slice(1)) ? location.hash.slice(1) : 'today');

function navigate(tab) {
  show(tab);
  if (location.hash.slice(1) !== tab) location.hash = tab;
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
  if (store.mode === 'local') {
    document.getElementById('storage-note').textContent = 'Saving in this browser only. Run serve.py to keep your data in files.';
  }
  window.__unfurl = Object.assign(ctx, { play, rankNow }); // handy for debugging in the console and for tests
}

main().catch((e) => {
  document.getElementById('main').replaceChildren(h('div', { class: 'panel' }, h('h1', null, 'Something went wrong starting up'), h('pre', null, String(e?.stack ?? e))));
});
