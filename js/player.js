// Embedded YouTube player via the official IFrame Player API.
// After the player loads we also read the real length/title from it, which
// corrects any guessed metadata (the starter videos, pasted links).

let apiPromise = null;

export function loadYouTubeApi(timeoutMs = 10000) {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const fail = (why) => { clearTimeout(timer); apiPromise = null; reject(new Error(why)); };
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => fail('blocked');
    document.head.append(s);
  });
  return apiPromise;
}

// Picture quality. YouTube chooses it itself (from the size of the player, the connection and the viewer's own choice in the
// player's gear menu), and its embedded player no longer promises to obey "play this in 1080p". So the app only asks politely,
// once the video is playing, and then reads back what it really got so the page can say so honestly.
const QUALITY_ORDER = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
const QUALITY_LABEL = { highres: '4320p', hd2880: '2880p', hd2160: '2160p (4K)', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p' };
const rank = (q) => { const i = QUALITY_ORDER.indexOf(q); return i < 0 ? Infinity : i; };

/** The best of the quality levels YouTube lists for this video ('auto' and unknown names do not count), or null. */
export const bestQuality = (levels) => (Array.isArray(levels) ? levels : []).filter((q) => rank(q) !== Infinity).sort((a, b) => rank(a) - rank(b))[0] ?? null;
/** "1080p" for a level name, or '' when it is not a real level (auto, unknown). */
export const qualityLabel = (q) => QUALITY_LABEL[q] ?? '';
/** True when `current` is a lower picture than `best` (both level names). */
export const belowBest = (current, best) => rank(current) !== Infinity && rank(best) !== Infinity && rank(current) > rank(best);

export const PLAYER_ERRORS = {
  2: 'YouTube says this video link is invalid.',
  5: 'The video player hit an error.',
  100: 'This video was removed or made private.',
  101: 'The uploader doesn’t allow this video to be embedded.',
  150: 'The uploader doesn’t allow this video to be embedded.',
  153: 'YouTube refused to embed the video. Open the app at http://localhost:8765 (not as a file), or watch it on YouTube.',
};

/**
 * Mount a player into `container`. Handlers: onInfo({duration,title,author}), onEnded, onPlaying, onError(code, message), onUnavailable().
 * Options: bestQuality (default true) asks YouTube for the highest picture it has once the video plays.
 * Returns the player's remote control: destroy(), time(), duration(), playing(), seekTo(sec), play(), pause(), rate(), rates(), setRate(r), quality().
 */
export function mountPlayer(container, videoId, handlers = {}, { bestQuality: wantBest = true } = {}) {
  let dead = false, player = null, gotDuration = false, asked = false;

  const info = () => {
    if (dead || !player) return;
    try {
      const duration = player.getDuration?.() ?? 0;
      const data = player.getVideoData?.() ?? {};
      if (duration > 0 && !gotDuration) { gotDuration = true; handlers.onInfo?.({ duration, title: data.title, author: data.author }); }
    } catch { /* player not ready yet */ }
  };

  // Ask for the best picture, once the video has started (before that YouTube lists no levels). Both calls are the ones
  // the YouTube site's own player understands; the embedded one may ignore them, and nothing here relies on it obeying.
  const askForBest = () => {
    if (asked || dead || !player || !wantBest) return;
    try {
      const best = bestQuality(player.getAvailableQualityLevels?.());
      if (!best) return;
      asked = true;
      player.setPlaybackQualityRange?.(best, best);
      player.setPlaybackQuality?.(best);
    } catch { /* the player did not take it */ }
  };

  loadYouTubeApi().then((YT) => {
    if (dead) return;
    const holder = document.createElement('div');
    container.replaceChildren(holder);
    player = new YT.Player(holder, {
      videoId, width: '100%', height: '100%',
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => info(),
        onStateChange: (e) => {
          info();
          if (e.data === YT.PlayerState.ENDED) handlers.onEnded?.();
          if (e.data === YT.PlayerState.PLAYING) { askForBest(); handlers.onPlaying?.(); }
        },
        onError: (e) => handlers.onError?.(e.data, PLAYER_ERRORS[e.data] ?? `The player reported error ${e.data}.`),
      },
    });
  }).catch(() => { if (!dead) handlers.onUnavailable?.(); });

  // What a person following along needs from the player. Every call is safe before the player is ready.
  const call = (fn, fallback = null) => { try { return player?.[fn] ? player[fn]() : fallback; } catch { return fallback; } };
  return {
    destroy() { dead = true; try { player?.destroy?.(); } catch { /* already gone */ } },
    get ready() { return !!player && typeof player.getCurrentTime === 'function'; },
    time: () => Number(call('getCurrentTime', 0)) || 0,
    duration: () => Number(call('getDuration', 0)) || 0,
    playing: () => call('getPlayerState', -1) === 1,
    seekTo(sec) { try { player?.seekTo?.(Math.max(0, sec), true); } catch { /* not ready */ } },
    play() { try { player?.playVideo?.(); } catch { /* not ready */ } },
    pause() { try { player?.pauseVideo?.(); } catch { /* not ready */ } },
    rate: () => Number(call('getPlaybackRate', 1)) || 1,
    rates: () => call('getAvailablePlaybackRates', []) ?? [],
    setRate(r) { try { player?.setPlaybackRate?.(r); } catch { /* not ready */ } },
    /** What YouTube is really showing: {current, best} as level names ('hd720' ...), or nulls while it does not know. */
    quality() {
      const current = call('getPlaybackQuality', null);
      return { current: rank(current) === Infinity ? null : current, best: bestQuality(call('getAvailableQualityLevels', [])) };
    },
  };
}
