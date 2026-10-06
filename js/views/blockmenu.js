// "Not for me ▾": stop suggesting this video, or everything from its channel. Both can be undone right away
// (the toast) or later (Settings → Hidden videos & channels).

import { h } from '../dom.js';
import { ctx } from '../ctx.js';
import { blockVideo, unblockVideo, blockChannel, unblockChannel } from '../state.js';
import { channelBlocker } from '../model.js';
import { toast } from '../modal.js';

// one listener closes any open menu when you click elsewhere
if (typeof document !== 'undefined' && !globalThis.__unfurlMenuListener) {
  globalThis.__unfurlMenuListener = true;
  document.addEventListener('click', (e) => document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
}

function undoToast(message, undo) {
  const t = toast(`${message} `, 'info', 9000);
  t.append(h('button', { class: 'link', type: 'button', onclick: () => { undo(); ctx.store.save(); t.remove(); } }, 'Undo'));
}

/**
 * @param {object} video
 * @param {{onChange?:()=>void, label?:string, cls?:string}} [o] onChange runs after something was blocked or unblocked
 */
export function blockMenu(video, { onChange = () => {}, label = 'Not for me', cls = 'btn ghost' } = {}) {
  const { state } = ctx;
  const channelName = video.channel || '';
  const channelIsBlocked = channelBlocker(state.blockedChannels)(video);
  const videoIsBlocked = state.blocked.includes(video.id);
  const details = h('details', { class: 'menu', 'data-menu': 'block' },
    h('summary', { class: cls, title: 'Stop suggesting this video, or everything from its channel' }, `${label} ▾`),
    h('div', { class: 'menu-items', role: 'menu' },
      h('p', { class: 'menu-note' }, 'Hide from suggestions:'),
      h('button', { type: 'button', role: 'menuitem', 'data-block': 'video', disabled: videoIsBlocked, onclick: () => {
        details.open = false;
        blockVideo(state, video.id); ctx.store.save();
        undoToast('Won’t suggest this video again.', () => { unblockVideo(state, video.id); onChange(); });
        onChange();
      } }, videoIsBlocked ? 'This video is already hidden' : 'Just this video'),
      h('button', { type: 'button', role: 'menuitem', 'data-block': 'channel', disabled: !channelName || channelIsBlocked, onclick: () => {
        details.open = false;
        const entry = blockChannel(state, video);
        if (!entry) return;
        ctx.store.save();
        const n = Object.values(state.videos).filter(channelBlocker([entry])).length;
        undoToast(`Won’t suggest anything from “${entry.name}” again (${n} video${n === 1 ? '' : 's'} hidden).`, () => { unblockChannel(state, entry.key); onChange(); });
        onChange();
      } }, !channelName ? 'The channel isn’t known yet' : channelIsBlocked ? `“${channelName}” is already blocked` : `Everything from “${channelName}”`),
      h('p', { class: 'menu-note small' }, 'You can change your mind under Settings → Hidden videos & channels.')));
  return details;
}
