// Picture quality: which level to ask for, how it is shown, and that the player only asks once, politely.
import test from 'node:test';
import assert from 'node:assert/strict';

// player.js touches `window` and `document` only inside functions, so it can be imported here.
const { bestQuality, qualityLabel, belowBest, mountPlayer } = await import('../../js/player.js');

test('the best level is the highest real one; auto and unknown names never win', () => {
  assert.equal(bestQuality(['hd720', 'hd1080', 'large', 'auto']), 'hd1080');
  assert.equal(bestQuality(['auto', 'tiny', 'small']), 'small');
  assert.equal(bestQuality(['hd2160', 'hd1440', 'hd1080']), 'hd2160');
  assert.equal(bestQuality(['highres', 'hd2160']), 'highres');
  assert.equal(bestQuality(['auto']), null);
  assert.equal(bestQuality([]), null);
  assert.equal(bestQuality(undefined), null);
  assert.equal(bestQuality(['somethingnew']), null);
});

test('levels read as people say them', () => {
  assert.equal(qualityLabel('hd1080'), '1080p');
  assert.equal(qualityLabel('large'), '480p');
  assert.equal(qualityLabel('hd2160'), '2160p (4K)');
  assert.equal(qualityLabel('auto'), '');
  assert.equal(qualityLabel(null), '');
});

test('"below the best" compares real levels only', () => {
  assert.equal(belowBest('hd720', 'hd1080'), true);
  assert.equal(belowBest('hd1080', 'hd1080'), false);
  assert.equal(belowBest('hd1080', 'hd720'), false);
  assert.equal(belowBest('auto', 'hd1080'), false);
  assert.equal(belowBest(null, 'hd1080'), false);
  assert.equal(belowBest('hd720', null), false);
});

// A tiny stand-in for the browser and the YouTube player.
function withFakeYouTube(run) {
  const prev = { window: globalThis.window, document: globalThis.document, YT: globalThis.YT };
  const made = [];
  globalThis.window = globalThis;
  globalThis.document = { createElement: () => ({ }), head: { append() {} } };
  globalThis.location = { origin: 'http://localhost' };
  globalThis.YT = {
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
    Player: class {
      constructor(_el, o) { this.o = o; this.calls = []; this.levels = ['hd1080', 'hd720', 'large', 'auto']; made.push(this); }
      getAvailableQualityLevels() { return this.levels; }
      getPlaybackQuality() { return 'large'; }
      setPlaybackQuality(q) { this.calls.push(['setPlaybackQuality', q]); }
      setPlaybackQualityRange(a, b) { this.calls.push(['setPlaybackQualityRange', a, b]); }
      getDuration() { return 100; }
      getVideoData() { return {}; }
      destroy() {}
    },
  };
  const container = { replaceChildren() {} };
  return Promise.resolve(run({ made, container })).finally(() => { Object.assign(globalThis, prev); });
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('the player asks for the best picture once, when playing starts, and reads back what it got', async () => {
  await withFakeYouTube(async ({ made, container }) => {
    const remote = mountPlayer(container, 'abc', {});
    await tick();
    const p = made[0];
    p.o.events.onReady();
    assert.deepEqual(p.calls, [], 'nothing is asked before the video plays');
    p.o.events.onStateChange({ data: 1 });
    p.o.events.onStateChange({ data: 1 });
    assert.deepEqual(p.calls, [['setPlaybackQualityRange', 'hd1080', 'hd1080'], ['setPlaybackQuality', 'hd1080']], 'once, not on every state change');
    assert.deepEqual(remote.quality(), { current: 'large', best: 'hd1080' });
    remote.destroy();
  });
});

test('it does not ask when the setting is off, and it copes with a player that has no such calls', async () => {
  await withFakeYouTube(async ({ made, container }) => {
    const remote = mountPlayer(container, 'abc', {}, { bestQuality: false });
    await tick();
    made[0].o.events.onStateChange({ data: 1 });
    assert.deepEqual(made[0].calls, []);
    remote.destroy();
  });
  await withFakeYouTube(async ({ made, container }) => {
    const remote = mountPlayer(container, 'abc', {});
    await tick();
    const p = made[0];
    p.setPlaybackQualityRange = undefined; p.setPlaybackQuality = () => { throw new Error('refused'); };
    assert.doesNotThrow(() => p.o.events.onStateChange({ data: 1 }));
    p.levels = []; assert.deepEqual(remote.quality(), { current: 'large', best: null });
    remote.destroy();
  });
});
