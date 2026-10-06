// "What happens when": the sections of a routine in order, so the app can say which pose is on now and what is next.
//
// There is no way to look at the footage, so the order comes from the words around it, best source first:
//   1. the chapter list in the description ("2:10 Pigeon pose")
//   2. what the teacher says, when a transcript with times was added (the first time each pose is named)
//   3. viewers' comments that name a time ("12:30 pigeon is where it clicked")
// Pure functions: no DOM, no network.

import { scan, POSE_TERMS, POSE_BY_ID } from './lexicon.js';

const STAMP = /(?:^|[\s(\[@])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s)\]:.,;!?-])/g;
const seconds = (ts) => String(ts).split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
const firstPose = (text) => scan(POSE_TERMS, text)[0]?.entry.id ?? null;

/** Moments viewers point at: [{t, poseId, label, count}], clusters of comments naming the same pose at about the same time. */
export function commentMoments(comments, durationSec = null) {
  const raw = [];
  for (const c of comments ?? []) {
    const text = typeof c === 'string' ? c : c?.t ?? c?.text ?? '';
    for (const m of text.matchAll(STAMP)) {
      const t = seconds(m[1]);
      if (!Number.isFinite(t) || t > (durationSec ? durationSec + 5 : 4 * 3600)) continue;
      // the pose named closest to the time stamp, on either side of it
      const at = m.index + m[0].indexOf(m[1]);
      const near = scan(POSE_TERMS, text).map((p) => ({ id: p.entry.id, d: Math.abs(p.index - at) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d <= 120) raw.push({ t, poseId: near.id });
    }
  }
  const clusters = [];
  for (const r of raw.sort((a, b) => a.t - b.t)) {
    const c = clusters.find((x) => x.poseId === r.poseId && Math.abs(x.t - r.t) <= 25);
    if (c) { c.ts.push(r.t); c.t = c.ts[Math.floor(c.ts.length / 2)]; } else clusters.push({ t: r.t, poseId: r.poseId, ts: [r.t] });
  }
  return clusters.map((c) => ({ t: c.t, poseId: c.poseId, label: POSE_BY_ID[c.poseId]?.label ?? c.poseId, count: c.ts.length })).sort((a, b) => a.t - b.t).slice(0, 30);
}

/**
 * The best ordered list of sections there is for a video, or null.
 * @param {{chapters?:{t:number,label:string}[], transcriptTimeline?:{id:string,t:number}[], comments?:any[], durationSec?:number|null}} src
 * @returns {{source:'chapters'|'transcript'|'comments', items:{t:number,label:string,poseId:string|null,count?:number}[]}|null}
 */
export function buildTimeline({ chapters = [], transcriptTimeline = [], comments = [], durationSec = null } = {}) {
  if (chapters.length >= 3) return { source: 'chapters', items: chapters.slice(0, 40).map((c) => ({ t: c.t, label: c.label, poseId: firstPose(c.label) })) };
  if (transcriptTimeline.length >= 3) return { source: 'transcript', items: transcriptTimeline.slice(0, 30).map(({ id, t }) => ({ t, label: POSE_BY_ID[id]?.label ?? id, poseId: id })) };
  const moments = commentMoments(comments, durationSec);
  if (moments.length >= 2) return { source: 'comments', items: moments };
  return null;
}

/** The sections of a stored profile. Chapters are not stored twice: a timeline from chapters is rebuilt from them. */
export function timelineOf(profile) {
  if (profile?.timeline?.items?.length) return profile.timeline;
  const ch = profile?.chapters ?? [];
  return ch.length >= 3 ? buildTimeline({ chapters: ch }) : null;
}

/** Sections with their end times: [{t, end, label, poseId}]. Each runs until the next one starts (the last until the end). */
export function sections(timeline, durationSec = null) {
  const items = (timeline?.items ?? []).slice().sort((a, b) => a.t - b.t);
  return items.map((it, i) => ({ ...it, end: items[i + 1]?.t ?? (durationSec && durationSec > it.t ? durationSec : it.t + 60) }));
}

/** Which section is playing at time `t` (-1 before the first one). A hair before a section starts already counts as it, unless `slack` is 0. */
export function sectionIndexAt(secs, t, slack = 0.5) {
  let at = -1;
  for (let i = 0; i < secs.length; i++) if (t >= secs[i].t - slack) at = i; else break;
  return at;
}
