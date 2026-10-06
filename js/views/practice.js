// Follow along: under the player, the routine's sections (from its chapters, or what the teacher says, or what viewers
// wrote), which one is on and what comes next, jump to a section, repeat one, slow down, keep the screen awake, and a
// calm "focus view". It also notes which parts you actually played, so "I did it" can say so.
//
// It only knows the playback time (that is all the embedded YouTube player tells us), so "now" is the section the
// playhead is in, as listed by the video's own chapters.

import { h, fill } from '../dom.js';
import { WatchTracker, speedChoices, clock } from '../practice.js';
import { sections, sectionIndexAt, timelineOf } from '../timeline.js';

const SOURCE_TEXT = { chapters: 'The sections come from the video’s chapter list.', transcript: 'The sections come from what the teacher says (the transcript you added).', comments: 'The video has no chapter list, so these times come from viewers’ comments. They are approximate.' };

/**
 * @param {{id:string}} video
 * @param {{getVideo:()=>object, remote:object, onFinish:()=>void}} o   remote = what mountPlayer returns
 * @returns {{el:HTMLElement, destroy:()=>void, watch:()=>object}}
 */
export function practicePanel(video, { getVideo, remote, onFinish }) {
  const tracker = new WatchTracker(getVideo()?.durationSec ?? null);
  let secs = [], sig = '', loop = false, loopIdx = null, awake = false, focus = false, lock = null, idx = -2, timer = null;

  const nowEl = h('p', { class: 'pr-now', id: 'pr-now', 'aria-live': 'polite' });
  const clockEl = h('span', { class: 'pr-clock', id: 'pr-clock' }, '0:00');
  const listEl = h('ol', { class: 'pr-list', id: 'pr-list' });
  const hint = h('p', { class: 'hint', id: 'pr-hint' });
  const btn = (label, id, onclick, extra = {}) => h('button', { class: 'btn small', type: 'button', id, onclick, ...extra }, label);
  const toggle = (label, id, get, set, extra = {}) => {
    const b = h('button', { class: `btn small${get() ? ' on' : ''}`, type: 'button', id, 'aria-pressed': get(), ...extra, onclick: () => { set(!get()); b.classList.toggle('on', get()); b.setAttribute('aria-pressed', String(get())); } }, label);
    return b;
  };

  const go = (t) => { remote.seekTo(t); poll(); };
  const section = (i) => secs[Math.max(0, Math.min(secs.length - 1, i))];
  const jump = (d) => {
    if (!secs.length) return;
    const cur = Math.max(0, sectionIndexAt(secs, remote.time()));
    // "back" goes to the start of this section first, and only then to the one before (like a music player)
    if (d < 0 && remote.time() - secs[cur].t > 3) go(secs[cur].t); else go(section(cur + d).t);
  };

  const setAwake = async (on) => {
    awake = on;
    if (on) {
      try { lock = await navigator.wakeLock.request('screen'); } catch { awake = false; hint.textContent = 'Couldn’t keep the screen on (the browser said no).'; document.getElementById('pr-awake')?.classList.remove('on'); }
    } else { try { await lock?.release(); } catch { /* already released */ } lock = null; }
  };
  const onVisible = () => { if (awake && document.visibilityState === 'visible' && !lock) setAwake(true); };
  const setFocus = (on) => { focus = on; document.body.classList.toggle('focus-view', on); };

  const speeds = h('select', { id: 'pr-speed', 'aria-label': 'Playback speed', onchange: (e) => remote.setRate(Number(e.target.value)) });
  const awakeBtn = typeof navigator !== 'undefined' && navigator.wakeLock
    ? toggle('Keep screen on', 'pr-awake', () => awake, (v) => setAwake(v))
    : h('button', { class: 'btn small', type: 'button', id: 'pr-awake', disabled: true, title: 'Your browser only allows this on https:// pages or on this computer (localhost).' }, 'Keep screen on');

  const controls = h('div', { class: 'pr-controls' },
    btn('⏮ Section', 'pr-prev', () => jump(-1), { title: 'Back to the start of this section, or the one before' }),
    btn('−10 s', 'pr-back10', () => go(Math.max(0, remote.time() - 10))),
    btn('⏯ Play / pause', 'pr-toggle', () => (remote.playing() ? remote.pause() : remote.play())),
    btn('+10 s', 'pr-fwd10', () => go(remote.time() + 10)),
    btn('Section ⏭', 'pr-next', () => jump(1), { title: 'Skip to the next section' }),
    h('label', { class: 'inline-field pr-speed' }, h('span', null, 'Speed'), speeds),
    toggle('Repeat this section', 'pr-loop', () => loop, (v) => { loop = v; loopIdx = null; }),
    awakeBtn,
    toggle('Focus view', 'pr-focus', () => focus, setFocus),
    h('button', { class: 'btn small primary', type: 'button', id: 'pr-done', onclick: () => onFinish() }, 'I did it ✓'));

  const el = h('section', { class: 'practice', id: 'practice', 'aria-label': 'Follow along' },
    h('div', { class: 'pr-top' }, nowEl, clockEl), controls, hint,
    h('details', { class: 'pr-sections', id: 'pr-sections', open: true }, h('summary', null, 'Sections'), listEl));

  /** (Re)build the section list when the video's sections or length change. */
  function refresh() {
    const v = getVideo() ?? video;
    const dur = remote.duration() || v.durationSec || 0;
    if (dur) tracker.setDuration(dur);
    const tl = timelineOf(v.profile);
    const next = sections(tl, dur);
    const nextSig = `${tl?.source}|${dur}|${next.map((s) => `${s.t}:${s.label}`).join(',')}`;
    if (nextSig === sig) return;
    sig = nextSig; secs = next; idx = -2;
    fill(listEl, secs.map((s, i) => h('li', { 'data-i': i }, h('button', { class: 'pr-sec', type: 'button', onclick: () => go(s.t) }, h('span', { class: 'at' }, clock(s.t)), ' ', s.label, h('span', { class: 'tick', 'aria-hidden': 'true' })))));
    hint.textContent = secs.length ? SOURCE_TEXT[tl.source] : 'No chapter list was found for this video, so there is no order to follow. Paste its transcript (Library → Tags & note, or “Look at a video first”) and the sections appear.';
    el.querySelector('#pr-sections').hidden = !secs.length;
  }

  function poll() {
    if (!remote.ready) return;
    refresh();
    const t = remote.time(), playing = remote.playing();
    tracker.tick(t, playing);
    clockEl.textContent = `${clock(t)}${remote.duration() ? ` / ${clock(remote.duration())}` : ''}`;
    if (!speeds.options.length) {
      const rates = speedChoices(remote.rates());
      fill(speeds, rates.map((r) => h('option', { value: r, selected: r === 1 }, r === 1 ? 'Normal' : `${r}×`)));
    }
    speeds.value = String(remote.rate());
    const i = sectionIndexAt(secs, t);
    if (loop && playing && secs.length) {
      // Repeat the section you were in when you switched it on (and move to another one if you jump there yourself).
      const here = sectionIndexAt(secs, t, 0);
      if (loopIdx == null || here < 0) loopIdx = here;
      const s = secs[loopIdx];
      const early = 0.2 + 0.5 * remote.rate();   // a poll is half a second apart; at double speed that is a second of video
      if (s && (t >= s.end - early || (here === loopIdx + 1 && t - secs[here].t < 1.5))) { remote.seekTo(s.t); return; }
      if (here !== loopIdx && here >= 0) loopIdx = here;
    }
    if (i !== idx) {
      idx = i;
      const cur = secs[i], nxt = secs[i + 1];
      fill(nowEl, secs.length
        ? [h('span', { class: 'lbl' }, 'Now: '), h('strong', { id: 'pr-now-label' }, cur ? cur.label : 'before the first section'), cur ? h('small', { class: 'muted' }, ` ${clock(cur.t)}–${clock(cur.end)}`) : null,
          nxt ? [h('span', { class: 'lbl next' }, ' · Next: '), h('span', { id: 'pr-next-label' }, nxt.label)] : h('span', { class: 'lbl next' }, ' · last section')]
        : h('span', { class: 'muted' }, 'Follow along'));
      for (const li of listEl.children) {
        const n = Number(li.dataset.i);
        const b = li.firstChild;
        if (n === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      }
    }
    for (const li of listEl.children) li.classList.toggle('reached', tracker.share(secs[Number(li.dataset.i)].t, secs[Number(li.dataset.i)].end) >= 0.5);
  }

  document.addEventListener('visibilitychange', onVisible);
  el.__poll = poll;   // (so a test can drive it without waiting)
  timer = setInterval(poll, 500);
  refresh();
  poll();

  return {
    el,
    watch: () => tracker.summary(secs),
    destroy() { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); setFocus(false); if (awake) setAwake(false); },
  };
}
