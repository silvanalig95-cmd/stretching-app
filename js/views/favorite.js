// "☆ Favourite channel": a teacher you really enjoy. Their videos rank higher whenever they also fit what you asked for
// (the muscles, the length, the style); a video that doesn't fit gains nothing.

import { h } from '../dom.js';
import { ctx } from '../ctx.js';
import { favoriteChannel, unfavoriteChannel, isFavoriteChannel } from '../state.js';
import { channelMatcher } from '../model.js';
import { toast } from '../modal.js';

/**
 * @param {object} video
 * @param {{onChange?:()=>void, cls?:string}} [o] onChange runs after the flag changed
 */
export function favoriteButton(video, { onChange = () => {}, cls = 'btn ghost' } = {}) {
  const { state, store } = ctx;
  const name = video.channel || '';
  const on = isFavoriteChannel(state, video);
  return h('button', {
    class: cls, type: 'button', 'data-action': 'favorite-channel', 'aria-pressed': on, disabled: !name,
    title: !name ? 'The channel isn’t known yet' : on ? `“${name}” is a favourite: its videos rank higher when they fit. Click to undo.` : `Rank videos from “${name}” higher when they fit what you asked for`,
    onclick: () => {
      const unblocked = channelMatcher(state.blockedChannels)(video);
      if (on) {
        const entry = state.favoriteChannels.find((c) => channelMatcher([c])(video));
        if (entry) unfavoriteChannel(state, entry.key);
        toast(`“${name}” is no longer a favourite.`, 'info');
      } else {
        const entry = favoriteChannel(state, video);
        if (!entry) return;
        toast(unblocked ? `★ “${entry.name}” is a favourite now (and no longer blocked).` : `★ “${entry.name}” is a favourite: its videos rank higher when they fit.`, 'success');
      }
      store.save();
      onChange();
    },
  }, on ? '★ Favourite channel' : '☆ Favourite channel');
}
