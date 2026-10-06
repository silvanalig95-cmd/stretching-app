// Following along: what has actually been watched, and which section is on. Pure functions and one small class,
// so they can be tested without a player. The embedded YouTube player only tells us the playback time and whether it
// is playing, nothing about the picture, so "watched" means "the playhead went through it while playing".

/**
 * Records which seconds of a video were played, how often the playhead was moved, and so on.
 * Call `tick(time, playing)` about once a second (and when the state changes).
 */
export class WatchTracker {
  /** @param {number|null} durationSec */
  constructor(durationSec = null) {
    this.duration = durationSec && durationSec > 0 ? durationSec : null;
    this.bins = new Set();      // whole seconds that were played
    this.last = null;           // the previous playback time
    this.forward = 0;           // skips ahead
    this.back = 0;              // jumps back (a replay, or a loop)
    this.startedAt = null;
  }

  setDuration(sec) { if (sec > 0) this.duration = sec; }

  tick(time, playing) {
    if (!Number.isFinite(time) || time < 0) return;
    if (this.last != null) {
      const d = time - this.last;
      if (playing && d >= 0 && d <= 3) {                       // played on from where it was: that stretch was watched
        for (let s = Math.floor(this.last); s <= Math.floor(time); s++) this.bins.add(s);
      } else if (Math.abs(d) > 3) {                            // the playhead was moved
        if (d > 0) this.forward++; else this.back++;
        if (playing) this.bins.add(Math.floor(time));
      } else if (playing) this.bins.add(Math.floor(time));
    } else if (playing) this.bins.add(Math.floor(time));
    if (playing && this.startedAt == null) this.startedAt = Date.now();
    this.last = time;
  }

  get watchedSec() { return this.bins.size; }
  get fraction() { return this.duration ? Math.min(1, this.bins.size / this.duration) : null; }

  /** How much of a time range was played, 0..1. */
  share(from, to) {
    const a = Math.floor(from), b = Math.max(a + 1, Math.ceil(to));
    let n = 0;
    for (let s = a; s < b; s++) if (this.bins.has(s)) n++;
    return n / (b - a);
  }

  /**
   * @param {{t:number,end:number,label:string}[]} [secs]  the routine's sections, if known
   * @returns {{sec:number, fraction:number|null, seeks:number, replays:number, reached:number[], skipped:string[]}}
   */
  summary(secs = []) {
    const reached = [], skipped = [];
    secs.forEach((s, i) => { if (this.share(s.t, s.end) >= 0.5) reached.push(i); else skipped.push(s.label); });
    return {
      sec: this.watchedSec, fraction: this.fraction != null ? Math.round(this.fraction * 100) / 100 : null,
      seeks: this.forward, replays: this.back, reached, skipped: secs.length ? skipped : [],
    };
  }
}

/** What is worth keeping about a viewing in the training log: small and plain. */
export function watchRecord(summary, minSec = 30) {
  if (!summary || summary.sec < minSec) return null;
  return {
    sec: Math.round(summary.sec),
    ...(summary.fraction != null ? { fraction: summary.fraction } : {}),
    ...(summary.skipped?.length ? { skipped: summary.skipped.slice(0, 6).map((l) => String(l).slice(0, 60)) } : {}),
  };
}

/** "12 of 15 min (80%)", or "12 min" when the length is not known. */
export function watchLine(rec, durationSec = null) {
  if (!rec) return '';
  const min = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
  const of = durationSec ? ` of ${min(durationSec)}` : '';
  return `${min(rec.sec)}${of}${rec.fraction != null ? ` (${Math.round(rec.fraction * 100)}%)` : ''}`;
}

/** The playback speeds on offer: the usual ones the player actually supports. */
export function speedChoices(available = []) {
  const usual = [0.75, 1, 1.25, 1.5];
  const ok = usual.filter((r) => !available.length || available.includes(r));
  return ok.length ? ok : [1];
}

/** m:ss for a position in the video. */
export const clock = (sec) => {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};
