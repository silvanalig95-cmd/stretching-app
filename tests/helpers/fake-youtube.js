// TEST FIXTURE ONLY. A stand-in for the YouTube Data API v3 with the same
// response shapes as the real one (search.list, videos.list, commentThreads.list,
// channels.list), so the whole discovery pipeline can be exercised without a key
// or network. All videos/channels/comments below are invented; the ids
// (TESTxxxxxxx) are deliberately not real YouTube ids. Error bodies are copied
// from real API responses.


// topic -> {title, desc, comments[]}
import { STARTER_VIDEOS } from '../../data/starter.js';

// The starter videos "exist" on this fake YouTube (with slightly different lengths, so
// verification visibly corrects them) except GONE, which behave like deleted videos.
export const GONE = new Set(['uQohpNbzyUg', '9GiLEupJq40']);
const STARTER = new Map(STARTER_VIDEOS.map((s) => [s.id, s]));

const T = {
  hips: {
    title: (n) => `${n} Minute Yoga for Tight Hips & Hip Flexors`,
    desc: 'Open up tight hips and release the psoas.\n0:00 Intro\n1:00 Low lunge\n4:00 Pigeon pose\n8:00 Figure four\n12:00 Savasana',
    comments: ['My hip flexors finally feel open, this really helped after a day of sitting!', 'The pigeon pose is where my tight hips let go. Thank you.', 'Too fast for me, I could not keep up.', 'Great for desk workers with stiff hips.'],
  },
  lowerback: {
    title: (n) => `${n} Min Gentle Yoga for Lower Back Pain Relief`,
    desc: 'Soothe an aching lower back. 0:00 Start\n2:00 Cat cow\n5:00 Child pose\n9:00 Knees to chest\n13:00 Supine twist',
    comments: ['My lower back pain is so much better after a week of this.', 'Knees to chest felt amazing on my sore low back.', 'Did not help my sciatica unfortunately.', 'Perfect pace for beginners, love this.'],
  },
  neck: {
    title: (n) => `${n} Minute Neck & Shoulder Stretch for Desk Workers`,
    desc: 'Release neck tension and rounded shoulders from computer work.',
    comments: ['My neck tension is gone, thank you so much!', 'Best stretch for text neck, my shoulders feel loose.', 'Love this routine, so relaxing.'],
  },
  calves: {
    title: (n) => `${n} Min Yoga for Tight Calves, Shins & Ankles`,
    desc: 'Calf stretch and ankle mobility for runners.',
    comments: ['Calf stretch helped my shin splints, amazing.', 'My tight calves loosened up so well.', 'A bit boring honestly.'],
  },
  glutes: {
    title: (n) => `${n} Minute Yoga for Sciatica & Piriformis`,
    desc: 'Stretch the glutes and piriformis to relieve sciatica. Pigeon pose and figure four.',
    comments: ['My sciatica is so much better, the figure four is magic.', 'Piriformis pain relief at last, thank you!', 'Pigeon pose hurts my knees though.'],
  },
  core: {
    title: (n) => `${n} Min Core Strength Yoga Workout`,
    desc: 'Plank, boat pose and dead bug to strengthen your core and abs.',
    comments: ['Felt my abs burning, great workout!', 'Too hard for beginners.', 'Love the boat pose sequence, my core is stronger.'],
  },
  full: {
    title: (n) => `${n} Min Full Body Morning Stretch`,
    desc: 'A full body stretch to wake up.',
    comments: ['Perfect morning routine.', 'Feels good all over, thanks!'],
  },
};

// [id, topic, minutes, channel, views, likes, subscribers, extra keywords]
const ROWS = [
  ['TESTvid0001', 'hips', 15, 'Calm Hips Studio', 1200000, 52000, 800000],
  ['TESTvid0002', 'hips', 20, 'Tiny Yoga Room', 18000, 1100, 4200],
  ['TESTvid0003', 'hips', 12, 'Big Channel Yoga', 4000000, 90000, 3000000],
  ['TESTvid0004', 'hips', 30, 'Hip Therapy PT', 90000, 4200, 51000],
  ['TESTvid0005', 'hips', 10, 'Quick Stretch Daily', 250000, 3000, 120000],
  ['TESTvid0006', 'lowerback', 15, 'Back Care Yoga', 600000, 25000, 300000],
  ['TESTvid0007', 'lowerback', 22, 'Tiny Yoga Room', 9000, 700, 4200],
  ['TESTvid0008', 'lowerback', 10, 'Physio Moves', 150000, 6000, 90000],
  ['TESTvid0009', 'lowerback', 35, 'Big Channel Yoga', 2000000, 60000, 3000000],
  ['TESTvid0010', 'neck', 10, 'Desk Yoga Co', 300000, 12000, 150000],
  ['TESTvid0011', 'neck', 15, 'Calm Hips Studio', 70000, 2900, 800000],
  ['TESTvid0012', 'neck', 8, 'Neck Notes', 12000, 800, 2500],
  ['TESTvid0013', 'calves', 10, 'Runner Recovery', 85000, 4000, 40000],
  ['TESTvid0014', 'calves', 12, 'Tiny Yoga Room', 7000, 520, 4200],
  ['TESTvid0015', 'glutes', 15, 'Sciatica Relief Yoga', 410000, 17000, 200000],
  ['TESTvid0016', 'glutes', 20, 'Hip Therapy PT', 33000, 1500, 51000],
  ['TESTvid0017', 'core', 15, 'Strong Flow', 220000, 7000, 95000],
  ['TESTvid0018', 'core', 20, 'Big Channel Yoga', 900000, 30000, 3000000],
  ['TESTvid0019', 'full', 15, 'Big Channel Yoga', 5000000, 120000, 3000000],
  ['TESTvid0020', 'full', 25, 'Morning Movers', 60000, 3000, 22000],
];

// Pad the catalog to 80 videos with deterministic variety (real YouTube is effectively unbounded).
{
  const topics = Object.keys(T), mins = [8, 10, 12, 15, 18, 20, 25, 30];
  for (let i = 21; i <= 80; i++) {
    const topic = topics[i % topics.length];
    const views = Math.round(2000 * 1.35 ** (i % 17)), likeRatio = 0.012 + ((i * 7) % 30) / 1000;
    ROWS.push([`TESTvid${String(i).padStart(4, '0')}`, topic, mins[i % mins.length], i % 3 === 0 ? `Small Channel ${i}` : ['Calm Hips Studio', 'Big Channel Yoga', 'Tiny Yoga Room', 'Desk Yoga Co'][i % 4],
      views, Math.round(views * likeRatio), i % 3 === 0 ? 1500 + i * 120 : 300000]);
  }
}

export const CHANNELS = Object.fromEntries(ROWS.map((r) => [`UC_${r[3].replace(/\W/g, '')}`, { title: r[3], subs: r[6] }]));
const chId = (name) => `UC_${name.replace(/\W/g, '')}`;

export const VIDEOS = ROWS.map(([id, topic, min, channel, views, likes]) => ({
  id, topic, min, channel, views, likes, channelId: chId(channel),
  title: T[topic].title(min), desc: T[topic].desc, comments: T[topic].comments,
}));

const KEYWORDS = {
  hips: ['hip', 'hips', 'flexor', 'flexors', 'psoas', 'opener'],
  lowerback: ['back', 'lower', 'low', 'lumbar', 'spine'],
  neck: ['neck', 'shoulder', 'shoulders', 'desk', 'posture', 'upper'],
  calves: ['calf', 'calves', 'ankle', 'ankles', 'shin', 'runner', 'runners', 'feet'],
  glutes: ['glute', 'glutes', 'sciatica', 'piriformis', 'pigeon'],
  core: ['core', 'abs', 'strength', 'strengthen', 'plank', 'stability'],
  full: ['full', 'body', 'morning', 'total', 'stretch'],
};

const ok = (body) => ({ status: 200, body });
const err = (status, reason, message, detailReason) => ({
  status,
  body: { error: { code: status, message, errors: [{ message, domain: 'global', reason }], status: 'ERR', ...(detailReason ? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: detailReason, domain: 'googleapis.com' }] } : {}) } },
});

const starterItem = (s) => ({
  kind: 'youtube#video', id: s.id,
  snippet: { publishedAt: '2022-01-01T00:00:00Z', channelId: 'UC_Starter', title: s.title, description: '', channelTitle: s.channel || 'Verified Channel', liveBroadcastContent: 'none' },
  contentDetails: { duration: `PT${s.durationSec / 60 + 1}M0S` },
  status: { embeddable: true },
  statistics: { viewCount: '50000', likeCount: '2000', commentCount: '10' },
});

/** Test switches: set from a test to simulate failures. */
export const fault = { quota: false, commentsOff: new Set(), calls: [] };

/** Handle one API request URL; returns {status, body}. */
export function handle(urlString) {
  const url = new URL(urlString, 'http://fake.local');
  const endpoint = url.pathname.split('/').pop();
  const p = (k) => url.searchParams.get(k);
  fault.calls.push({ endpoint, params: Object.fromEntries(url.searchParams) });

  if (p('key') === 'INVALID') {
    return err(400, 'badRequest', 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID');
  }
  if (fault.quota) return err(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.');

  if (endpoint === 'search') {
    const terms = (p('q') ?? '').toLowerCase().split(/\W+/).filter(Boolean);
    let hits = VIDEOS.map((v) => {
      const words = new Set([...KEYWORDS[v.topic], v.channel.toLowerCase().split(/\W+/)].flat());
      const score = terms.filter((t) => words.has(t)).length;
      return { v, score };
    }).filter((x) => x.score > 0);
    const order = p('order') ?? 'relevance';
    hits.sort((a, b) => (order === 'viewCount' ? b.v.views - a.v.views : order === 'rating' ? b.v.likes / b.v.views - a.v.likes / a.v.views : b.score - a.score) || a.v.id.localeCompare(b.v.id));
    const dur = p('videoDuration');
    if (dur === 'medium') hits = hits.filter((x) => x.v.min >= 4 && x.v.min <= 20);
    if (dur === 'long') hits = hits.filter((x) => x.v.min > 20);
    const start = Number((p('pageToken') ?? 'p0').slice(1)) || 0;
    const size = Math.min(5, Number(p('maxResults') ?? 5));
    const page = hits.slice(start, start + size);
    return ok({
      kind: 'youtube#searchListResponse',
      ...(start + size < hits.length ? { nextPageToken: `p${start + size}` } : {}),
      items: page.map(({ v }) => ({
        kind: 'youtube#searchResult', id: { kind: 'youtube#video', videoId: v.id },
        snippet: { channelId: v.channelId, channelTitle: v.channel.replace('&', '&amp;'), title: v.title.replace('&', '&amp;'), publishedAt: '2023-04-01T10:00:00Z' },
      })),
    });
  }

  if (endpoint === 'videos') {
    const ids = (p('id') ?? '').split(',');
    return ok({
      kind: 'youtube#videoListResponse',
      items: [...ids.filter((id) => STARTER.has(id) && !GONE.has(id)).map((id) => starterItem(STARTER.get(id))),
        ...ids.map((id) => VIDEOS.find((v) => v.id === id)).filter(Boolean).map((v) => ({
        kind: 'youtube#video', id: v.id,
        snippet: { publishedAt: '2023-04-01T10:00:00Z', channelId: v.channelId, title: v.title, description: v.desc, channelTitle: v.channel, tags: [v.topic], liveBroadcastContent: 'none' },
        contentDetails: { duration: `PT${v.min}M0S` },
        status: { embeddable: true },
        statistics: { viewCount: String(v.views), likeCount: String(v.likes), commentCount: String(v.comments.length) },
      }))],
    });
  }

  if (endpoint === 'commentThreads') {
    const v = VIDEOS.find((x) => x.id === p('videoId'));
    if (!v && STARTER.has(p('videoId'))) return ok({ kind: 'youtube#commentThreadListResponse', items: [] });
    if (!v) return err(404, 'videoNotFound', 'The video identified by the videoId parameter could not be found.');
    if (fault.commentsOff.has(v.id)) return err(403, 'commentsDisabled', 'The video identified by the videoId parameter has disabled comments.');
    return ok({
      kind: 'youtube#commentThreadListResponse',
      // real videos have hundreds; repeat the fixture comments so there's enough to analyse
      items: [...v.comments, ...v.comments, ...v.comments].map((text, i) => ({ snippet: { topLevelComment: { snippet: { textDisplay: text, textOriginal: text, likeCount: 20 - i * 3 } } } })),
    });
  }

  if (endpoint === 'channels') {
    const ids = (p('id') ?? '').split(',');
    return ok({
      items: ids.filter((id) => CHANNELS[id]).map((id) => ({
        kind: 'youtube#channel', id, snippet: { title: CHANNELS[id].title },
        statistics: { subscriberCount: String(CHANNELS[id].subs), hiddenSubscriberCount: false },
      })),
    });
  }
  return err(404, 'notFound', `Unknown endpoint ${endpoint}`);
}

/** fetch()-compatible wrapper for unit tests. */
export const fakeFetch = async (url) => {
  const { status, body } = handle(String(url));
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};
