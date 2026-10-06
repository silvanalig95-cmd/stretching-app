// "What is in this video?" - turns the analysis the app already does (title, description, chapters, tags,
// named poses, viewer comments) into a plain report a person can read before deciding to keep the video.
// Pure functions: no DOM, no network.

import { AREA_BY_ID, POSE_BY_ID, BENEFITS, STYLES, SPECIFIC_TO_GENERIC } from './lexicon.js';
import { qualityScore, isHiddenGem, likeRatioScore } from './analyze.js';
import { coverage, isTrusted, channelKey } from './model.js';

/** 75 -> "1:15", 3700 -> "1:01:40" (a position in the video, unlike formatDuration's "N min") */
const clock = (sec) => {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};
const LEVELS = { beginner: 'Beginner friendly', intermediate: 'Intermediate', advanced: 'Advanced' };

/** Where, in the video's own words, each muscle area shows up. */
function whyArea(video, a) {
  const p = video.profile ?? {}, src = p.sources ?? {}, bits = [];
  if ((src.title?.[a] ?? 0) >= 0.5) bits.push('named in the title');
  if ((src.chapters?.[a] ?? 0) >= 0.4) bits.push('in the chapter list');
  else if ((src.desc?.[a] ?? 0) >= 0.4) bits.push('described in the description');
  if ((src.tags?.[a] ?? 0) >= 0.4) bits.push('in its tags');
  if ((src.transcript?.[a] ?? 0) >= 0.25) bits.push('the teacher talks about it');
  const moves = (p.poses ?? []).map(({ id, count }) => ({ id, w: (POSE_BY_ID[id]?.areas[a] ?? 0) * count }))
    .filter((x) => x.w >= 0.5).sort((x, y) => y.w - x.w).slice(0, 3).map((x) => POSE_BY_ID[x.id].label);
  if (moves.length) bits.push(`exercises: ${moves.join(', ')}`);
  const m = video.evidence?.mentions?.[a];
  if (m && m.n >= 2) bits.push(`${Math.round(m.pos)} of ${m.n} comments about it are positive`);
  return bits;
}

/** Plain words for how viewers feel, from the comments that took a side. */
function moodOf(ev) {
  const sided = (ev.positive ?? 0) + (ev.negative ?? 0);
  if (ev.n < 5 || sided < 3) return 'too few opinions to say';
  const share = ev.positive / sided;
  const word = share >= 0.75 ? 'mostly positive' : share <= 0.4 ? 'mostly negative' : 'mixed';
  return ev.n < 15 ? `${word} (a small sample)` : word;
}

function summarize(areas, fullBody) {
  const strong = areas.filter((a) => a.score >= 0.5).slice(0, 4).map((a) => a.label.toLowerCase());
  const list = strong.length ? strong : areas.slice(0, 3).map((a) => a.label.toLowerCase());
  if (!list.length) return fullBody ? 'A full-body routine with no single area standing out.' : 'I couldn’t tell which muscles this works from its text.';
  return `${fullBody ? 'A full-body routine that also works' : 'Mostly works'} ${list.join(', ')}.`;
}

/**
 * @param {object} video   a stored video record (with profile, maybe evidence)
 * @param {{state:object, subscribers?:number|null}} ctx
 */
export function buildReport(video, { state, subscribers = video.subscribers ?? null }) {
  const p = video.profile ?? { areas: {}, poses: [], chapters: [], styles: {} };
  const ev = video.evidence ?? null;
  const prefs = state.prefs ?? {};

  const all = Object.entries(p.areas ?? {}).filter(([a, s]) => s >= 0.3 && a !== 'full_body' && AREA_BY_ID[a]);
  // Show "Core" separately only when the video says something about it beyond what its specific parts already imply.
  const merely = (a, s) => all.some(([c, cs]) => AREA_BY_ID[c].parent === a && s <= SPECIFIC_TO_GENERIC * cs + 0.01);
  const areas = all.filter(([a, s]) => !merely(a, s))
    .sort((x, y) => y[1] - x[1]).slice(0, 8)
    .map(([id, score]) => ({ id, label: AREA_BY_ID[id].label, score, strength: score >= 0.7 ? 'clearly' : score >= 0.5 ? 'probably' : 'a little', why: whyArea(video, id) }));
  const fullBody = (p.areas?.full_body ?? 0) >= 0.5;

  const poses = (p.poses ?? []).slice(0, 12).map(({ id, count }) => ({ id, count, label: POSE_BY_ID[id]?.label ?? id, mode: POSE_BY_ID[id]?.mode ?? 'stretch' }));
  const chapters = (p.chapters ?? []).slice(0, 14).map((c) => ({ at: clock(c.t), label: c.label }));
  const styles = Object.entries(p.styles ?? {}).filter(([, s]) => s >= 0.3).sort((a, b) => b[1] - a[1]).map(([id]) => STYLES.find((s) => s.id === id)?.label ?? id);

  const benefits = Object.entries(ev?.benefits ?? {}).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => ({ label: BENEFITS.find((b) => b.id === id)?.label ?? id, n }));
  const viewers = ev ? { n: ev.n, mood: moodOf(ev), benefits, quotes: (ev.quotes ?? []).slice(0, 3) } : null;

  const trusted = isTrusted(video, prefs.trusted ?? []);
  const chKey = channelKey(video);
  const seenChannel = (state.history ?? []).some((h) => { const hv = state.videos?.[h.videoId]; return hv && channelKey(hv) === chKey && h.completed !== false; });
  const quality = {
    score: qualityScore(video, { teacherTrust: trusted ? 0.9 : 0.5 }),
    likePct: video.likes != null && video.views ? Math.round((1000 * video.likes) / video.views) / 10 : null,
    likeRatio: video.likes != null && (video.views ?? 0) >= 200 ? likeRatioScore(video) : null,
    views: video.views ?? null,
    hiddenGem: isHiddenGem(video, subscribers),
    trusted,
    newTeacher: !!chKey && !seenChannel && !trusted,
  };

  // How it sits with what you already have and what you've said you want to work on.
  const have = coverage(Object.keys(state.library ?? {}).map((id) => state.videos[id]).filter(Boolean), state.blocked);
  const inLib = video.id in (state.library ?? {});
  const worked = new Set(areas.filter((a) => a.score >= 0.5).map((a) => a.id));
  const focus = prefs.focus ?? [];
  const fit = {
    coversFocus: focus.filter((f) => worked.has(f.id)).map((f) => ({ id: f.id, label: AREA_BY_ID[f.id]?.label ?? f.id, mode: f.mode })),
    missesFocus: focus.filter((f) => !worked.has(f.id)).map((f) => ({ id: f.id, label: AREA_BY_ID[f.id]?.label ?? f.id, mode: f.mode })),
    fillsGaps: areas.filter((a) => a.score >= 0.5 && (have[a.id] ?? 0) < 3).map((a) => ({ id: a.id, label: a.label, have: have[a.id] ?? 0 })),
    duplicateOf: null,
    inLibrary: inLib,
  };

  const spoken = p.transcript ? {
    words: p.transcript.words, lines: p.transcript.lines,
    timeline: (p.transcript.timeline ?? []).slice(0, 12).map(({ id, t }) => ({ at: clock(t), label: POSE_BY_ID[id]?.label ?? id })),
    heard: Object.entries(p.sources?.transcript ?? {}).filter(([a, s]) => s >= 0.3 && AREA_BY_ID[a]).sort((x, y) => y[1] - x[1]).slice(0, 5)
      .map(([id, score]) => ({ id, label: AREA_BY_ID[id].label, score })),
  } : null;

  const limits = [];
  if (!spoken) limits.push('No transcript was read. Paste one (below) and the analysis gets much sharper, because it then knows what the teacher says each move is for.');
  if (!video.evidence) limits.push('No viewer comments were read, so what viewers say it does is unknown.');
  else if (video.evidence.n < 10) limits.push(`Only ${video.evidence.n} comments could be read; treat what viewers say as an early signal.`);
  if (!video.verified) limits.push('The length and channel are unverified (no YouTube key was used).');
  if (!(video.description ?? '').trim() && !chapters.length) limits.push('The video has no description or chapter list, so the muscles are guessed from the title alone.');
  limits.push('This is read from the title, description, chapters, tags and comments. I can’t watch the footage itself, so muscle tags are inferred, not verified.');

  return {
    id: video.id, title: video.title, channel: video.channel || '', durationSec: video.durationSec ?? null, durationApprox: !!video.durationApprox,
    level: LEVELS[p.level] ?? null, styles, areas, fullBody, poses, chapters, transcript: spoken, viewers, quality, fit, limits,
    summary: summarize(areas, fullBody),
  };
}
