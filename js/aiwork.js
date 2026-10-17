// What the AI helper does with the app's own data: read one video (watching it, or reading its text) and keep the answer with it,
// read many, and look for more teachers. The calls are in gemini.js, the words and the careful reading in ai.js.
// Everything is opt-in: nothing here runs unless a person pressed a button.

import { ctx } from './ctx.js';
import { reanalyze } from './analyze.js';
import { askGemini, AIError } from './gemini.js';
import { videoPrompt, textPrompt, teacherPrompt, readVideoAnswer, parseTeachers } from './ai.js';
import { CATALOGUE } from './catalogue.js';

export const MAX_MY_TEACHERS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What is known about a video as the text for Gemini to read (never your own notes, tags or ratings: only what is public). */
const textOf = (video) => ({
  title: video.title, channel: video.channel, durationSec: video.durationSec, description: video.description ?? '',
  chapters: video.profile?.chapters ?? [], comments: (video.comments ?? []).slice(0, 40).map((c) => c.t ?? c.text ?? c), transcript: video.transcript ?? '',
});

/**
 * Ask Gemini about one video. mode 'video': it watches the public video (needs only the id); 'text': it reads what is known.
 * Returns the checked reading ({v:1, ...}); throws AIError or AIParseError with a message a person can read.
 */
export async function askAboutVideo(video, { mode = 'video' } = {}) {
  if (!video?.id) throw new AIError('There is no video to look at.', 'rejected');
  const p = mode === 'video' ? videoPrompt(video) : textPrompt(textOf(video));
  const res = await askGemini({ system: p.system, prompt: p.prompt, maxTokens: p.maxTokens, video: mode === 'video' ? video.id : null, json: true, lowRes: true });
  return readVideoAnswer(res.text, { durationSec: video.durationSec ?? null, model: res.model, mode });
}

/** The same, kept: the reading is stored with the video and its profile re-derived. */
export async function readStoredVideo(videoId, opts) {
  const video = ctx.state.videos[videoId];
  if (!video) throw new AIError('That video isn’t known to the app any more.', 'rejected');
  const ai = await askAboutVideo(video, opts);
  const now = ctx.state.videos[videoId] ?? video;   // (it may have been updated while Gemini was working)
  ctx.state.videos[videoId] = reanalyze({ ...now, ai });
  ctx.store.save();
  return ai;
}

/** Take a reading away again (the profile goes back to what the words alone say). */
export function removeReading(videoId) {
  const v = ctx.state.videos[videoId];
  if (!v?.ai) return false;
  const { ai, ...rest } = v;
  void ai;
  ctx.state.videos[videoId] = reanalyze(rest);
  ctx.store.save();
  return true;
}

/** Which stored videos are worth asking about (`only` limits it to some ids). 'video': library videos with no chapter list and no reading yet. 'text': any with comments or a transcript and no reading. */
export function aiCandidates(mode = 'video', { state = ctx.state, only = null } = {}) {
  const allowed = new Set(only ?? Object.keys(state.library));   // `only`: just these videos (a teacher's page), library or not
  const hasChapters = (v) => (v.profile?.chapters?.length ?? 0) >= 3;
  return Object.values(state.videos).filter((v) => allowed.has(v.id) && !v.ai && !v.broken && v.embeddable !== false && !state.blocked.includes(v.id)
    && (mode === 'video' ? !hasChapters(v) && (v.durationSec ?? 0) > 0 && (v.durationSec ?? 0) <= 90 * 60 : !!(v.comments?.length || v.transcript || v.description))).map((v) => v.id);
}

/**
 * Ask about many videos one after the other. It stops by itself when Gemini says it is busy or the day's allowance is used up,
 * and whenever `shouldStop()` says so. Returns what happened.
 */
export async function readMany(ids, { mode = 'video', progress = () => {}, shouldStop = () => false, pauseMs = mode === 'video' ? 0 : 4000 } = {}) {
  const out = { done: 0, failed: [], stopped: null };
  for (const [i, id] of ids.entries()) {
    if (shouldStop()) { out.stopped = 'you'; break; }
    progress(`${i + 1} of ${ids.length}: ${ctx.state.videos[id]?.title ?? id}`);
    try { await readStoredVideo(id, { mode }); out.done++; }
    catch (e) {
      if (['daily_cap', 'busy', 'invalid_key', 'no_key', 'offline', 'unreachable', 'model'].includes(e.code)) { out.stopped = e.code; out.message = e.message; break; }
      out.failed.push({ id, message: e.message });
    }
    if (pauseMs && i < ids.length - 1) await sleep(pauseMs);
  }
  return out;
}

/**
 * Ask Gemini (with Google Search) for teachers that are not in the list yet. The answer is checked and marked unverified.
 * @returns {Promise<{teachers:object[], sources:{uri:string,title:string}[], queries:string[]}>}
 */
export async function suggestTeachers({ styles = [], focus = [], voice = '', count = 8 } = {}) {
  const mine = ctx.state.myTeachers ?? [];
  const known = [...CATALOGUE.map((t) => t.name), ...mine.map((t) => t.name)];
  const p = teacherPrompt({ styles, focus, voice, exclude: known, count });
  const res = await askGemini({ system: p.system, prompt: p.prompt, maxTokens: p.maxTokens, search: true, json: false });
  return { teachers: parseTeachers(res.text, { known }), sources: res.sources ?? [], queries: res.queries ?? [] };
}

/** Keep a suggested teacher in your own list. */
export function keepTeacher(entry) {
  const list = (ctx.state.myTeachers ??= []);
  const key = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (list.some((t) => t.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === key)) return false;
  if (list.length >= MAX_MY_TEACHERS) list.shift();
  list.push(entry);
  ctx.store.save();
  return true;
}
export function dropTeacher(name) {
  const before = (ctx.state.myTeachers ?? []).length;
  ctx.state.myTeachers = (ctx.state.myTeachers ?? []).filter((t) => t.name !== name);
  if (ctx.state.myTeachers.length !== before) ctx.store.save();
}
