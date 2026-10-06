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
 * Returns the player's remote control: destroy(), time(), duration(), playing(), seekTo(sec), play(), pause(), rate(), rates(), setRate(r).
 */
export function mountPlayer(container, videoId, handlers = {}) {
  let dead = false, player = null, gotDuration = false;

  const info = () => {
    if (dead || !player) return;
    try {
      const duration = player.getDuration?.() ?? 0;
      const data = player.getVideoData?.() ?? {};
      if (duration > 0 && !gotDuration) { gotDuration = true; handlers.onInfo?.({ duration, title: data.title, author: data.author }); }
    } catch { /* player not ready yet */ }
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
          if (e.data === YT.PlayerState.PLAYING) handlers.onPlaying?.();
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
  };
}
