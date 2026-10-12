// What the AI helper does with the app's own data (js/aiwork.js): which videos are worth asking about, reading one and keeping
// the answer, reading many (and when it stops by itself), and keeping teachers. Google is never contacted: fetch is a stand-in
// for the app's own /api/gemini routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ctx } from '../../js/ctx.js';
import { freshState } from '../../js/state.js';
import { analyzeVideoText } from '../../js/analyze.js';
import { aiCandidates, askAboutVideo, readStoredVideo, removeReading, readMany, keepTeacher, dropTeacher, suggestTeachers, MAX_MY_TEACHERS } from '../../js/aiwork.js';

const vid = (id, extra = {}) => { const v = { id, title: `Hip stretch ${id}`, channel: 'Some Yoga', description: 'a stretch', tags: [], durationSec: 600, ...extra }; return { ...v, profile: analyzeVideoText(v) }; };
const ANSWER = JSON.stringify({ summary: 'Slow hips.', kind: { id: 'yin', confidence: 0.8, evidence: ['long holds'] }, level: 'beginner', pace: 'slow', props: [], areas: { hip_flexors: 0.9 },
  sections: [{ t: '0:00', label: 'Intro' }, { t: '1:00', label: 'Low lunge' }, { t: '3:00', label: 'Pigeon pose' }, { t: '6:00', label: 'Child pose' }], cautions: [] });

let saves = 0;
const calls = [];
/** Answers /api/gemini/generate with whatever is queued (a string is a model's text; an object is an error body with a status). */
function stub(...replies) {
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const r = replies.length > 1 ? replies.shift() : replies[0];
    if (typeof r === 'string') return { ok: true, status: 200, json: async () => ({ ok: true, text: r, model: 'gemini-test', sources: [], queries: [] }) };
    return { ok: false, status: r.status ?? 502, json: async () => ({ ok: false, error: r.error, message: r.message }) };
  };
}
function setup(videos = [], library = []) {
  saves = 0;
  ctx.store = { state: freshState(), save: () => { saves++; } };   // (ctx.state is read from the store)
  for (const v of videos) ctx.state.videos[v.id] = v;
  for (const id of library) ctx.state.library[id] = { addedAt: 1, tags: [], note: '', snapshot: {} };
}

test('which videos are worth asking about: yours, without chapters or a reading, playable and not too long', () => {
  const chapters = vid('chap0000001', { description: '0:00 Intro\n1:00 A\n2:00 B\n3:00 C' });
  const read = { ...vid('read0000001'), ai: { v: 1, sections: [], areas: {}, props: [], cautions: [] } };
  setup([vid('plain000001'), chapters, read, vid('long0000001', { durationSec: 3 * 3600 }), vid('broken00001', { broken: true }), vid('noembed0001', { embeddable: false }), vid('blocked0001'), vid('notmine0001'), vid('nolen000001', { durationSec: 0 }),
    vid('talk0000001', { comments: [{ t: 'her voice is calm' }] })], ['plain000001', 'chap0000001', 'read0000001', 'long0000001', 'broken00001', 'noembed0001', 'blocked0001', 'nolen000001', 'talk0000001']);
  ctx.state.blocked.push('blocked0001');
  assert.deepEqual(aiCandidates('video').sort(), ['plain000001', 'talk0000001'], 'watched: a library video with no chapter list, no reading, a length, playable, not blocked');
  assert.ok(!aiCandidates('video').includes('notmine0001'), 'never a video you did not choose');
  assert.ok(aiCandidates('text').includes('chap0000001') && aiCandidates('text').includes('talk0000001'), 'read: anything with text to read');
  assert.ok(!aiCandidates('text').includes('read0000001'), 'but not what was already read');
});

test('watching a video sends only its id; reading its text sends the public text and none of your own', async () => {
  setup([vid('watch000001', { description: 'Gentle hip openers', comments: [{ t: 'love this' }] })], ['watch000001']);
  ctx.state.library.watch000001.note = 'PRIVATE-NOTE'; ctx.state.library.watch000001.tags = ['PRIVATE-TAG'];
  ctx.state.history.push({ id: 'h1', kind: 'video', videoId: 'watch000001', note: 'PRIVATE-SESSION', date: '2026-10-01', ratings: {} });
  stub(ANSWER);
  const a = await askAboutVideo(ctx.state.videos.watch000001, { mode: 'video' });
  assert.equal(calls[0].body.video, 'watch000001'); assert.equal(a.mode, 'video'); assert.equal(a.sections.length, 4);
  const b = await askAboutVideo(ctx.state.videos.watch000001, { mode: 'text' });
  assert.equal(calls[1].body.video, null); assert.equal(b.mode, 'text');
  assert.ok(calls[1].body.prompt.includes('Gentle hip openers') && calls[1].body.prompt.includes('love this'));
  assert.ok(!JSON.stringify(calls).match(/PRIVATE-/), 'none of your notes, tags or what you wrote after a session');
  await assert.rejects(askAboutVideo(null), /no video/i);
});

test('a reading is kept with the video (saved), changes its analysis, and removing it restores the old one', async () => {
  setup([vid('keep0000001')], ['keep0000001']);
  const before = ctx.state.videos.keep0000001.profile;
  stub(ANSWER);
  const ai = await readStoredVideo('keep0000001', { mode: 'video' });
  const now = ctx.state.videos.keep0000001;
  assert.equal(now.ai, ai); assert.equal(saves, 1);
  assert.ok(now.profile.areas.hip_flexors > (before.areas.hip_flexors ?? 0), 'the muscles it named count');
  assert.equal(now.profile.timeline?.source ?? now.profile.timeline?.[0] ? 'ai' : 'none', 'ai', 'and the sections became its timeline');
  assert.equal(removeReading('keep0000001'), true);
  assert.equal('ai' in ctx.state.videos.keep0000001, false); assert.equal(saves, 2);
  assert.deepEqual(ctx.state.videos.keep0000001.profile.areas, before.areas, 'the analysis is what the words alone said');
  assert.equal(removeReading('keep0000001'), false, 'nothing to remove the second time');
  await assert.rejects(readStoredVideo('unknown0001', {}), /isn’t known/);
});

test('a nonsense answer stores nothing and says why', async () => {
  setup([vid('nons0000001')]);
  stub('I cannot help with that.');
  await assert.rejects(readStoredVideo('nons0000001', { mode: 'video' }), /form I could read/);
  assert.equal('ai' in ctx.state.videos.nons0000001, false); assert.equal(saves, 0);
  stub(JSON.stringify({ summary: '', areas: { not_a_muscle: 1 }, sections: [] }));
  await assert.rejects(readStoredVideo('nons0000001', { mode: 'video' }));
  assert.equal(saves, 0);
});

test('reading many: counts what worked, skips what failed, and stops by itself when Google says to', async () => {
  const ids = ['m0000000001', 'm0000000002', 'm0000000003', 'm0000000004'];
  setup(ids.map((i) => vid(i)), ids);
  stub(ANSWER);
  const progress = [];
  const ok = await readMany(ids, { mode: 'video', pauseMs: 0, progress: (m) => progress.push(m) });
  assert.deepEqual([ok.done, ok.failed.length, ok.stopped], [4, 0, null]);
  assert.equal(progress.length, 4); assert.match(progress[0], /^1 of 4/);

  for (const code of ['daily_cap', 'busy', 'invalid_key', 'no_key', 'model']) {
    setup(ids.map((i) => vid(i)), ids);
    stub(ANSWER, { error: code, message: `stop: ${code}` }, ANSWER);
    const res = await readMany(ids, { mode: 'video', pauseMs: 0 });
    assert.deepEqual([res.done, res.stopped, res.message], [1, code, `stop: ${code}`], `${code} ends the run after the first video`);
    assert.equal(calls.length, 2, 'and no further request is made');
  }

  setup(ids.map((i) => vid(i)), ids);
  stub(ANSWER, 'not json at all', ANSWER);
  const mixed = await readMany(ids, { mode: 'video', pauseMs: 0 });
  assert.deepEqual([mixed.done, mixed.failed.length, mixed.stopped], [3, 1, null], 'one unreadable answer does not stop the run');
  assert.equal(mixed.failed[0].id, 'm0000000002');

  setup(ids.map((i) => vid(i)), ids);
  stub(ANSWER);
  let n = 0;
  const stopped = await readMany(ids, { mode: 'video', pauseMs: 0, shouldStop: () => n++ >= 2 });
  assert.deepEqual([stopped.done, stopped.stopped], [2, 'you'], 'the Stop button ends it between videos');
});

test('teachers from Gemini: asked about with the list excluded, checked, kept once, capped, and removable', async () => {
  setup();
  stub('Here you go:\n```json\n' + JSON.stringify([{ name: 'Quiet Hips Studio', styles: ['yin'], voice: 'female', voiceSource: 'her About page says she teaches', url: 'https://example.com/a' }, { name: 'Yoga With Adriene', styles: ['yoga'] }]) + '\n```');
  const res = await suggestTeachers({ styles: ['yin'], focus: ['hips'], voice: 'female' });
  assert.deepEqual(res.teachers.map((t) => t.name), ['Quiet Hips Studio'], 'a teacher the list already has is left out');
  assert.equal(calls[0].body.search, true); assert.equal(calls[0].body.json, false);
  assert.ok(calls[0].body.prompt.includes('Yoga With Adriene'), 'and the known ones are named so Gemini skips them');
  const t = res.teachers[0];
  assert.equal(keepTeacher(t), true); assert.equal(keepTeacher({ ...t, name: 'quiet hips  STUDIO' }), false, 'kept once, however it is spelled');
  assert.deepEqual(ctx.state.myTeachers.map((x) => x.name), ['Quiet Hips Studio']); assert.equal(saves, 1);
  const again = await suggestTeachers({}).catch(() => null);
  void again;
  dropTeacher('Quiet Hips Studio');
  assert.deepEqual(ctx.state.myTeachers, []); assert.equal(saves, 2);
  dropTeacher('Nobody'); assert.equal(saves, 2, 'dropping what is not there saves nothing');
  for (let i = 0; i < MAX_MY_TEACHERS + 5; i++) keepTeacher({ name: `Teacher ${i}`, styles: ['yoga'] });
  assert.equal(ctx.state.myTeachers.length, MAX_MY_TEACHERS); assert.equal(ctx.state.myTeachers.at(-1).name, `Teacher ${MAX_MY_TEACHERS + 4}`, 'the oldest make room for the newest');
});
