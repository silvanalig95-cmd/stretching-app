// Following along: how much of a video was played, which sections were reached, which were skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchTracker, watchRecord, watchLine, speedChoices, clock } from '../../js/practice.js';

const play = (w, from, to, step = 1) => { for (let t = from; t <= to; t += step) w.tick(t, true); };
const secs = [{ t: 0, end: 60, label: 'Intro' }, { t: 60, end: 300, label: 'Pigeon' }, { t: 300, end: 600, label: 'Frog' }];

test('playing straight through counts every second; pausing counts none', () => {
  const w = new WatchTracker(600);
  play(w, 0, 300);
  assert.ok(w.watchedSec >= 300 && w.watchedSec <= 302);
  for (let i = 0; i < 20; i++) w.tick(300, false);   // paused
  assert.ok(w.watchedSec <= 302);
  assert.ok(Math.abs(w.fraction - 0.5) < 0.01);
  assert.equal(w.forward + w.back, 0);
});

test('skipping ahead is not watching; the skipped section is reported, the others are reached', () => {
  const w = new WatchTracker(600);
  play(w, 0, 59); w.tick(300, true); play(w, 301, 599);
  assert.equal(w.forward, 1);
  const s = w.summary(secs);
  assert.deepEqual(s.reached, [0, 2]);
  assert.deepEqual(s.skipped, ['Pigeon']);
  assert.ok(s.fraction > 0.5 && s.fraction < 0.65, `${s.fraction}`);
});

test('going back counts as a replay or a loop, and the replayed seconds are not counted twice', () => {
  const w = new WatchTracker(600);
  play(w, 60, 120); const before = w.watchedSec;
  for (let i = 0; i < 3; i++) { w.tick(60, true); play(w, 61, 120); }
  assert.equal(w.back, 3);
  assert.equal(w.watchedSec, before);
  assert.equal(w.summary(secs).replays, 3);
});

test('a half-watched section counts as reached; a quarter does not', () => {
  const w = new WatchTracker(600);
  play(w, 60, 190);       // 130 of the 240 seconds of the second section
  assert.deepEqual(w.summary(secs).reached, [1]);
  const q = new WatchTracker(600);
  play(q, 60, 110);
  assert.deepEqual(q.summary(secs).reached, []);
});

test('bad input is ignored; an unknown length gives no percentage', () => {
  const w = new WatchTracker(null);
  w.tick(NaN, true); w.tick(-5, true); w.tick(undefined, true);
  play(w, 0, 40);
  assert.equal(w.fraction, null);
  assert.equal(w.summary().fraction, null);
  assert.deepEqual(w.summary().skipped, [], 'nothing to skip when the sections are not known');
  w.setDuration(100);
  assert.ok(w.fraction > 0.3);
});

test('what is kept in the log is small, and only for a real viewing', () => {
  const w = new WatchTracker(600);
  play(w, 0, 20);
  assert.equal(watchRecord(w.summary(secs)), null, 'twenty seconds is not a viewing');
  play(w, 21, 59); w.tick(300, true); play(w, 301, 500);
  const rec = watchRecord(w.summary(secs));
  assert.deepEqual(Object.keys(rec).sort(), ['fraction', 'sec', 'skipped']);
  assert.deepEqual(rec.skipped, ['Pigeon']);
  assert.equal(watchLine(rec, 600), '4 min of 10 min (43%)'.replace('4 min', `${Math.round(rec.sec / 60)} min`).replace('(43%)', `(${Math.round(rec.fraction * 100)}%)`));
  assert.equal(watchLine(null), '');
  assert.equal(watchLine({ sec: 45 }), '45 s');
});

test('speeds offered: the usual ones the player supports; clock formatting', () => {
  assert.deepEqual(speedChoices([0.25, 0.5, 1, 1.5, 2]), [1, 1.5]);
  assert.deepEqual(speedChoices([]), [0.75, 1, 1.25, 1.5]);
  assert.deepEqual(speedChoices([2]), [1]);
  assert.equal(clock(75), '1:15'); assert.equal(clock(3700), '1:01:40'); assert.equal(clock(-3), '0:00');
});

test('a log entry keeps a small, cleaned record of what was played, and nothing for junk', async () => {
  const { freshState, logSession } = await import('../../js/state.js');
  const s = freshState();
  const id = Object.keys(s.videos)[0];
  const rec = logSession(s, { videoId: id, watch: { sec: 305.4, fraction: 0.8123, skipped: ['Pigeon', 'x'.repeat(200)], evil: '<script>' } });
  assert.deepEqual(rec.watch, { sec: 305, fraction: 0.81, skipped: ['Pigeon', 'x'.repeat(60)] });
  assert.ok(!('watch' in logSession(s, { videoId: id, watch: { sec: 0 } })));
  assert.ok(!('watch' in logSession(s, { videoId: id, watch: 'lots' })));
  assert.ok(!('watch' in logSession(s, { videoId: id })));
  assert.ok(!('fraction' in logSession(s, { videoId: id, watch: { sec: 50, fraction: 7 } }).watch), 'a fraction above 1 is dropped');
});
