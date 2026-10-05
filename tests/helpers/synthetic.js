// A believable, deterministic, LARGE library for performance checks. Texts are built from the real lexicon,
// so analysis, search and ranking do the same work they would on real YouTube data.
import { AREAS, POSES } from '../../js/lexicon.js';
import { analyzeVideoText, attachComments, formatDuration } from '../../js/analyze.js';
import { mulberry32 } from '../../js/model.js';
import { freshState, addToLibrary, logSession } from '../../js/state.js';

const TEACHERS = ['Calm Flow Yoga', 'Mobility Lab', 'Desk Relief', 'Sunrise Stretch', 'The Hip Doctor', 'Loose Limbs', 'Gentle Moves', 'Runner Recovery', 'Back Care Club', 'Evening Unwind',
  'Posture Pro', 'Slow Burn Yoga', 'Neck & Shoulders Daily', 'Flex Friday', 'Stretch Break', 'Yoga With Ana', 'Ben Mobility', 'Core and Calm', 'Joint Joy', 'Wake Up Body'];
const FRAMES = ['{n} min {a} stretch for beginners', 'Release tight {a} | {n} minute routine', '{a} mobility flow ({n} min)', 'Daily {a} relief - {n} min yoga', 'Do this for {a} pain every morning', '{n} Minute {a} and {b} yoga', 'Deep {a} opener, gentle and slow', 'Fix {a} tightness (follow along)'];
const GOOD = ['this really helped my {a}, thank you so much', 'my {a} feels so much looser after this', 'best {a} stretch ever, pain is gone', 'i do this every day and my {a} is better'];
const BAD = ['did not help my {a} at all', 'too intense for my {a}, hurt a bit', 'not for beginners, my {a} was sore'];
const NOISE = ['great video', 'love your voice', 'what mat is that?', 'first!', 'thanks for sharing', 'who is here in 2025'];

export function makeVideos(n, seed = 7) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const areaLabels = AREAS.filter((a) => a.id !== 'full_body');
  const videos = {};
  for (let i = 0; i < n; i++) {
    const a = pick(areaLabels), b = pick(areaLabels);
    const mins = 4 + Math.floor(rnd() * 46);
    const poses = Array.from({ length: 3 + Math.floor(rnd() * 6) }, () => pick(POSES));
    let t = 0;
    const chapters = poses.map((p) => { const line = `${formatDuration(t)} ${pick(p.phrases)}`; t += 60 + Math.floor(rnd() * 240); return line; });
    const teacher = pick(TEACHERS);
    const id = `v${String(i).padStart(9, '0')}`.slice(0, 11).padEnd(11, 'x');
    let v = {
      id, title: pick(FRAMES).replace('{n}', mins).replace('{a}', pick(a.say)).replace('{b}', pick(b.say)),
      channelId: `UC${TEACHERS.indexOf(teacher)}`, channel: teacher,
      description: `Follow along with ${teacher}. ${pick(a.say)} and ${pick(b.say)}.\n\nChapters:\n0:00 Intro\n${chapters.join('\n')}\n\nSubscribe for more! #yoga #stretching`,
      tags: ['yoga', 'stretching', pick(a.say), pick(b.say)],
      publishedAt: new Date(Date.UTC(2020 + Math.floor(rnd() * 6), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27))).toISOString(),
      durationSec: mins * 60, views: Math.floor(1000 * 10 ** (rnd() * 4)), likes: 0, commentCount: 40, embeddable: true, live: false, verified: true, source: 'search', addedAt: 1,
    };
    v.likes = Math.floor(v.views * (0.01 + rnd() * 0.04));
    v.profile = analyzeVideoText(v);
    if (i % 4 === 0) {   // a quarter have had their comments read
      const comments = Array.from({ length: 50 }, () => {
        const r = rnd();
        const text = r < 0.35 ? pick(GOOD).replace('{a}', pick(a.say)) : r < 0.45 ? pick(BAD).replace('{a}', pick(a.say)) : pick(NOISE);
        return { text, likes: Math.floor(rnd() * 30) };
      });
      v = attachComments(v, comments);
    }
    videos[id] = v;
  }
  return videos;
}

/** A state like a heavy user's: n videos known, a library, some months of history. */
export function makeState(n = 2000, { library = 200, sessions = 150, seed = 7 } = {}) {
  const rnd = mulberry32(seed + 1);
  const state = freshState();
  state.videos = makeVideos(n, seed);
  const ids = Object.keys(state.videos);
  for (const id of ids.slice(0, library)) addToLibrary(state, id, { tags: rnd() < 0.2 ? ['morning'] : [], note: rnd() < 0.1 ? 'felt great for my hips' : '' });
  const areaIds = AREAS.map((a) => a.id).filter((x) => x !== 'full_body');
  for (let s = 0; s < sessions; s++) {
    const id = ids[Math.floor(rnd() * ids.length)];
    const areas = [areaIds[Math.floor(rnd() * areaIds.length)], areaIds[Math.floor(rnd() * areaIds.length)]];
    logSession(state, { videoId: id, date: new Date(Date.UTC(2026, 5, 1 + (s % 120))).toISOString().slice(0, 10), areas: areas.map((a) => ({ id: a, mode: 'tight' })), completed: true,
      ratings: Object.fromEntries(areas.map((a) => [a, rnd() < 0.6 ? 'much' : rnd() < 0.5 ? 'some' : 'none'])), intensity: 'right', again: true });
  }
  return state;
}
