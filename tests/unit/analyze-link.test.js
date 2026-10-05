// "Look at a video first": paste a link -> a readable report -> only then is anything kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle as fakeApi } from '../helpers/fake-youtube.js';
import { ctx, analyzeLink, commitAnalysis } from '../../js/ctx.js';
import { freshState, logSession, addToLibrary } from '../../js/state.js';
import { buildReport } from '../../js/report.js';

const realFetch = globalThis.fetch;
const calls = [];
function useFakeYouTube() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/oembed')) return { ok: true, status: 200, json: async () => ({ title: 'Oembed Title About Hips', author_name: 'Some Teacher' }) };
    const { status, body } = fakeApi(u);
    calls.push(new URL(u).pathname.split('/').pop());
    return { ok: status < 400, status, json: async () => body };
  };
}
function setup({ key = 'k', state = freshState() } = {}) {
  calls.length = 0;
  const saves = [];
  ctx.store = { state, config: { apiKey: key }, server: { ytProxy: false }, save: () => saves.push(1) };
  ctx.ui.analysis = null;
  return { state, saves };
}
test.after(() => { globalThis.fetch = realFetch; });

test('a pasted link is read and analysed WITHOUT anything being stored', async () => {
  useFakeYouTube();
  const { state, saves } = setup();
  const before = Object.keys(state.videos).length;
  const res = await analyzeLink('https://www.youtube.com/watch?v=TESTvid0001');
  assert.equal(res.error, undefined);
  assert.equal(res.video.id, 'TESTvid0001');
  assert.ok(res.video.evidence?.n > 0, 'comments were read');
  assert.ok(res.video.profile.areas.hip_flexors >= 0.5, 'the hips video is recognised as working the hips');
  assert.ok(['videos', 'commentThreads', 'channels'].every((e) => calls.includes(e)), `API calls: ${calls}`);
  assert.equal(Object.keys(state.videos).length, before, 'the video is not in the index yet');
  assert.equal(state.library.TESTvid0001, undefined, 'nor in the library');
  assert.ok(!Object.values(state.videos).some((v) => v.id === 'TESTvid0001') && !('TESTvid0001' in state.library), 'nothing about it was kept (only the quota counter moves)');
  const r = res.report;
  assert.match(r.summary, /hip/i);
  assert.ok(r.areas.some((a) => a.id === 'hip_flexors' && a.why.length), 'each muscle says why');
  assert.ok(r.poses.some((p) => /pigeon|lunge/i.test(p.label)), 'exercises are named');
  assert.deepEqual(r.chapters.slice(0, 3), [{ at: '0:00', label: 'Intro' }, { at: '1:00', label: 'Low lunge' }, { at: '4:00', label: 'Pigeon pose' }], 'chapter list is shown with real timestamps');
  assert.ok(r.viewers.n > 0 && r.viewers.quotes.length > 0);
  assert.equal(r.quality.hiddenGem, false);
  assert.ok(r.limits.some((l) => /can’t watch the footage/.test(l)), 'the report is honest about what it cannot see');
});

test('adding it keeps the analysis (profile, comments, evidence) and puts it in the library', async () => {
  useFakeYouTube();
  const { state, saves } = setup();
  const res = await analyzeLink('https://youtu.be/TESTvid0002');
  const savesBefore = saves.length;
  commitAnalysis(res.video);
  const v = state.videos.TESTvid0002;
  assert.ok(v, 'stored');
  assert.ok(v.id in state.library, 'in My library');
  assert.equal(v.source, 'manual');
  assert.ok(v.evidence?.n > 0 && v.comments?.length > 0, 'the comment evidence came along');
  assert.deepEqual(v.profile.areas, res.video.profile.areas, 'the same analysis that was shown is what is kept');
  assert.equal(saves.length - savesBefore, 1, 'saved once');
  // looking again afterwards knows it is already yours
  const again = await analyzeLink('https://youtu.be/TESTvid0002');
  assert.equal(again.report.fit.inLibrary, true);
});

test('it speaks to YOUR body: standing spots covered, spots missed, gaps it would fill', async () => {
  useFakeYouTube();
  const state = freshState();
  state.prefs.focus = [{ id: 'hip_flexors', mode: 'tight' }, { id: 'neck', mode: 'weak' }];
  setup({ state });
  const res = await analyzeLink('https://youtu.be/TESTvid0001');
  const fit = res.report.fit;
  assert.deepEqual(fit.coversFocus.map((f) => f.id), ['hip_flexors']);
  assert.deepEqual(fit.missesFocus.map((f) => f.id), ['neck']);
  assert.ok(fit.fillsGaps.some((g) => g.id === 'hip_flexors' && g.have === 0), 'an empty library has a gap there');
});

test('it notices a teacher you have already done a routine with, and a trusted one', async () => {
  useFakeYouTube();
  const state = freshState();
  setup({ state });
  const first = await analyzeLink('https://youtu.be/TESTvid0001');
  assert.equal(first.report.quality.newTeacher, true);
  commitAnalysis(first.video);
  logSession(state, { videoId: 'TESTvid0001', date: '2026-10-01', areas: [{ id: 'hip_flexors', mode: 'tight' }], completed: true, ratings: { hip_flexors: 'much' }, intensity: 'right', again: true });
  const second = await analyzeLink('https://youtu.be/TESTvid0003');
  const sameChannel = second.video.channel === first.video.channel;
  assert.equal(second.report.quality.newTeacher, !sameChannel);
  state.prefs.trusted = [first.video.channel];
  assert.equal(buildReport(first.video, { state }).quality.trusted, true);
});

test('things that are not a single video get a helpful message instead of an analysis', async () => {
  useFakeYouTube();
  setup();
  for (const [text, re] of [['', /Paste a YouTube video link/], ['hello there', /doesn’t look like a YouTube video link/], ['https://www.youtube.com/playlist?list=PLabcdefghijk', /playlist or a teacher/], ['https://www.youtube.com/@SomeTeacher', /playlist or a teacher/]]) {
    const res = await analyzeLink(text);
    assert.match(res.error ?? '', re, text);
    assert.equal(res.video, undefined);
  }
  const gone = await analyzeLink('https://youtu.be/NOSUCHVID01');
  assert.match(gone.error ?? '', /No public video was found/);
});

test('without a YouTube key it still works from the title, and says plainly that it is thin', async () => {
  useFakeYouTube();
  const { state } = setup({ key: '' });
  const known = Object.keys(state.videos).length;
  const res = await analyzeLink('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(res.error, undefined);
  assert.equal(res.video.title, 'Oembed Title About Hips');
  assert.ok(res.report.areas.some((a) => a.id === 'hip_flexors' || a.id === 'glutes'), 'the title alone still says hips');
  assert.equal(res.video.evidence, undefined);
  assert.match(res.notes.join(' '), /Without a YouTube key/);
  assert.ok(res.report.limits.some((l) => /No viewer comments/.test(l)));
  assert.equal(calls.length, 0, 'no API calls without a key');
  assert.equal(Object.keys(state.videos).length, known, 'and nothing was stored');
});

test('a video without any text says it is guessing, rather than inventing muscles', () => {
  const state = freshState();
  const v = { id: 'blank000001', title: 'Morning', channel: '', description: '', tags: [], profile: { areas: {}, poses: [], chapters: [], styles: {}, sources: {} } };
  const r = buildReport(v, { state });
  assert.deepEqual(r.areas, []);
  assert.match(r.summary, /couldn’t tell which muscles/);
  assert.ok(r.limits.some((l) => /no description or chapter list/.test(l)));
});

test('the report reflects what the library already has (gap detection counts only your library)', () => {
  const state = freshState();
  const mk = (id, areas) => ({ id, title: id, profile: { areas, poses: [], chapters: [], styles: {}, sources: {} } });
  for (let i = 0; i < 4; i++) { state.videos[`lib${i}`] = mk(`lib${i}`, { glutes: 0.9 }); addToLibrary(state, `lib${i}`); }
  state.videos.found = mk('found', { glutes: 0.9 });          // discovered, not yours: must not count
  const cand = { id: 'cand', title: 'cand', description: 'x', profile: { areas: { glutes: 0.8, neck: 0.8 }, poses: [], chapters: [], styles: {}, sources: {} } };
  const r = buildReport(cand, { state });
  assert.deepEqual(r.fit.fillsGaps.map((g) => g.id), ['neck'], 'glutes are well covered (4), neck is not');
});

test('how viewers feel is put in plain words, and small samples are labelled as such', () => {
  const state = freshState();
  const base = { id: 'mood0000001', title: 'x', description: 'x', profile: { areas: {}, poses: [], chapters: [], styles: {}, sources: {} } };
  const mood = (ev) => buildReport({ ...base, evidence: { benefits: {}, quotes: [], mentions: {}, sentiment: 0, ...ev } }, { state }).viewers.mood;
  assert.equal(mood({ n: 3, positive: 3, negative: 0 }), 'too few opinions to say');
  assert.equal(mood({ n: 40, positive: 20, negative: 2 }), 'mostly positive');
  assert.equal(mood({ n: 9, positive: 6, negative: 1 }), 'mostly positive (a small sample)');
  assert.equal(mood({ n: 40, positive: 5, negative: 12 }), 'mostly negative');
  assert.equal(mood({ n: 40, positive: 10, negative: 8 }), 'mixed');
});

test('chapter times read like a video player ("1:05", "1:01:40"), not like durations', () => {
  const state = freshState();
  const v = { id: 'chap0000001', title: 'x', description: 'x', profile: { areas: {}, poses: [], styles: {}, sources: {}, chapters: [{ t: 0, label: 'a' }, { t: 65, label: 'b' }, { t: 3700, label: 'c' }] } };
  assert.deepEqual(buildReport(v, { state }).chapters.map((c) => c.at), ['0:00', '1:05', '1:01:40']);
});
