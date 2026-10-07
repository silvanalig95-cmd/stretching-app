// Which channel a video is from: the one definition of "same channel" that blocking, favourites and teacher marks all use.

export const channelKey = (v) => (v.channelId || v.channel || '').toLowerCase();

/** A test for "is this video from one of these channels?" (the blocked list, the favourites list). Entries look like {key, name, channelId?}. */
export function channelMatcher(channels = []) {
  const ids = new Set(), keys = new Set(), names = new Set();
  for (const c of channels) {
    if (c.channelId) ids.add(c.channelId);
    if (c.key) keys.add(c.key);
    if (c.name) names.add(normName(c.name));
  }
  if (!ids.size && !keys.size && !names.size) return () => false;
  // by id when YouTube gave one, else by the channel's name (the starter suggestions only know the name)
  return (v) => !!((v.channelId && ids.has(v.channelId)) || keys.has(channelKey(v)) || (v.channel && names.has(normName(v.channel))));
}
export const channelBlocker = channelMatcher;
export const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
