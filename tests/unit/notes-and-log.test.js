// Your own notes and tags shape a video's analysis; "did today" and entries without a video join the training log.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshState, splitState, loadState, mergeImport, addToLibrary, updateLibraryItem, logSession, updateSession, deleteSession, restoreSession,
  inLibrary, reindexAll, mineFor, blockVideo,
} from '../../js/state.js';
import { analyzeVideoText, reanalyze, ANALYSIS_VERSION } from '../../js/analyze.js';
import { rankCandidates, buildModel, areaHeat } from '../../js/model.js';
import { totals, streaks, historyCsv, sessionMinutes } from '../../js/progress.js';

const ID = 'nnnnnnnnnn1';
const base = (id = ID, extra = {}) => {
  const v = { id, title: 'Gentle morning flow', description: 'A calm flow to start the day.', tags: [], channel: 'Calm', durationSec: 900, views: 20000, likes: 1000, embeddable: true, verified: true, ...extra };
  return { ...v, profile: analyzeVideoText(v) };
};
const withVideo = (extra) => { const s = freshState(); s.videos[ID] = base(ID, extra); addToLibrary(s, ID); return s; };
const area = (s, a, id = ID) => s.videos[id].profile.areas[a] ?? 0;

test('what you write about a video counts as evidence for it: note, tags, and what you wrote after doing it', () => {
  const s = withVideo();
  assert.ok(area(s, 'lower_back') < 0.2, 'nothing says lower back yet');
  updateLibraryItem(s, ID, { note: 'This really releases my lower back.' });
  assert.ok(area(s, 'lower_back') >= 0.4, `note: ${area(s, 'lower_back')}`);
  assert.ok(s.videos[ID].profile.sources.mine.lower_back > 0);
  updateLibraryItem(s, ID, { tags: ['hamstrings', 'morning'] });
  assert.ok(area(s, 'hamstrings') >= 0.4, `tag: ${area(s, 'hamstrings')}`);
  logSession(s, { videoId: ID, note: 'Felt it in my calves today' });
  assert.ok(area(s, 'calves') >= 0.3, `after doing it: ${area(s, 'calves')}`);
  assert.deepEqual(mineFor(s, ID), { note: 'This really releases my lower back.', tags: ['hamstrings', 'morning'], sessions: ['Felt it in my calves today'] });
});

test('a note saying it did NOT help never raises that area, and clearing words takes the evidence away again', () => {
  const s = withVideo();
  updateLibraryItem(s, ID, { note: "Didn't help my hamstrings at all. Too hard." });
  assert.ok(area(s, 'hamstrings') < 0.2, `${area(s, 'hamstrings')}`);
  updateLibraryItem(s, ID, { note: 'Great for the shoulders. Not for the knees, it hurt.' });
  assert.ok(area(s, 'shoulders') >= 0.4);
  assert.ok(area(s, 'knees') < 0.2, 'the sentence that says it hurt is skipped');
  updateLibraryItem(s, ID, { note: '' });
  assert.ok(area(s, 'shoulders') < 0.2, 'removing the note removes its influence');
  assert.equal(s.videos[ID].mine, undefined);
  const sess = logSession(s, { videoId: ID, note: 'stretched my neck nicely' });
  assert.ok(area(s, 'neck') >= 0.3);
  deleteSession(s, sess.id);
  assert.ok(area(s, 'neck') < 0.2, 'deleting the entry removes what it said');
  addToLibrary(s, ID); updateLibraryItem(s, ID, { tags: ['chest'] });
  assert.ok(area(s, 'chest') >= 0.4);
});

test('they survive rebuilding the analysis and moving data between copies, and they change the ranking', () => {
  const s = withVideo();
  updateLibraryItem(s, ID, { note: 'my lower back loves this one', tags: ['lower back'] });
  const before = area(s, 'lower_back');
  reindexAll(s);
  assert.equal(area(s, 'lower_back'), before, 'a full re-analysis starts from your profile and gets the same answer');
  // the index can be thrown away; the notes live in the profile and come back with it
  const { profile } = splitState(s);
  const fresh = loadState({ profile: JSON.parse(JSON.stringify(profile)), index: null }).state;
  assert.equal(fresh.library[ID].note, 'my lower back loves this one');
  // merging a backup that has notes teaches the receiving copy
  const target = freshState(); target.videos[ID] = base();
  mergeImport(target, splitState(s));
  assert.ok(area(target, 'lower_back') >= 0.4, 'imported notes count');
  assert.ok(ANALYSIS_VERSION >= 4);
  // ranking: the same video with and without your note
  const noted = withVideo(); updateLibraryItem(noted, ID, { note: 'a lot for my lower back' });
  const plain = withVideo();
  const rank = (st) => rankCandidates({ videos: [st.videos[ID]], filters: { areas: [{ id: 'lower_back', mode: 'tight' }], minMin: 5, maxMin: 40, styles: [], terms: [] }, model: buildModel([], {}) });
  assert.equal(rank(plain).length, 0, 'without the note it does not fit lower back at all');
  assert.equal(rank(noted).length, 1, 'with it, it does');
  assert.ok(rank(noted)[0].reasons.some((r) => /in your own notes/.test(r)), 'and it says why');
});

test('"did today": logging does not need the library; the longer way still adds it', () => {
  const s = freshState();
  s.videos[ID] = base();
  const quick = logSession(s, { videoId: ID, areas: [{ id: 'hamstrings', mode: 'tight' }] }, { library: false });
  assert.equal(inLibrary(s, ID), false, 'not added');
  assert.equal(quick.durationSec, 900);
  assert.equal(quick.title, 'Gentle morning flow');
  assert.equal(s.history.length, 1);
  logSession(s, { videoId: ID });
  assert.equal(inLibrary(s, ID), true, 'the dialog path adds it, as before');
  assert.equal(totals(s.history, s.videos).sessions, 2);
});

test('rating an entry later: same entry, changed answers, and "never again" still blocks', () => {
  const s = freshState(); s.videos[ID] = base();
  const rec = logSession(s, { videoId: ID }, { library: false });
  const same = updateSession(s, rec.id, { ratings: { hamstrings: 'much' }, intensity: 'right', note: 'lovely' });
  assert.equal(same.id, rec.id);
  assert.equal(s.history.length, 1, 'updated, not duplicated');
  assert.deepEqual(s.history[0].ratings, { hamstrings: 'much' });
  assert.equal(inLibrary(s, ID), true, 'rating it adds it, like the dialog always did');
  updateSession(s, rec.id, { repeat: 'no' });
  assert.deepEqual(s.blocked, [ID]);
  assert.equal(inLibrary(s, ID), false);
  assert.equal(updateSession(s, 'missing', { note: 'x' }), null);
  updateSession(s, rec.id, { date: '2999-01-01' });
  assert.notEqual(s.history[0].date, '2999-01-01', 'never a future day');
});

test('removing an entry can be undone, and comes back in its place', () => {
  const s = freshState(); s.videos[ID] = base();
  const a = logSession(s, { videoId: ID, date: '2026-03-01' }), b = logSession(s, { videoId: ID, date: '2026-03-02' });
  a.at = '2026-03-01T08:00:00.000Z'; b.at = '2026-03-02T08:00:00.000Z';
  deleteSession(s, a.id);
  assert.deepEqual(s.history.map((x) => x.id), [b.id]);
  restoreSession(s, a);
  assert.deepEqual(s.history.map((x) => x.id), [a.id, b.id]);
  restoreSession(s, a);
  assert.equal(s.history.length, 2, 'restoring twice does not duplicate');
});

test('something you did without a video: it is in the log, the stats, the muscle map and the CSV, but never in the library or the ranking', () => {
  const s = freshState();
  const today = new Date(); const p = (x) => String(x).padStart(2, '0'); const ymd = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  const rec = logSession(s, { videoId: '', title: '=SUM(1), a yoga class', minutes: 45, areas: [{ id: 'hamstrings', mode: 'tight' }, { id: 'lower_back', mode: 'tight' }] });
  assert.deepEqual({ kind: rec.kind, videoId: rec.videoId, date: rec.date, min: sessionMinutes(rec, s.videos) }, { kind: 'manual', videoId: '', date: ymd, min: 45 });
  assert.deepEqual(Object.keys(s.library), []);
  assert.deepEqual(s.blocked, []);
  assert.equal(logSession(s, { videoId: '' }).title, 'Something I did', 'a name is optional');
  const t = totals(s.history, s.videos);
  assert.deepEqual({ n: t.sessions, m: t.minutes }, { n: 2, m: 45 });
  assert.equal(streaks(s.history).current, 1);
  const heat = areaHeat(s.history, { days: 28 });
  assert.equal(heat.hamstrings.sessions, 1, 'it counts toward the muscle map');
  const csv = historyCsv(s.history, s.videos);
  assert.ok(csv.includes(`"'=SUM(1), a yoga class"`) && !csv.includes('watch?v='), 'a formula in a title is defused, and there is no video link');
  // survives saving and loading (an empty video id is a valid entry)
  const { profile, index } = splitState(s);
  const back = loadState({ profile: JSON.parse(JSON.stringify(profile)), index: JSON.parse(JSON.stringify(index)) }).state;
  assert.equal(back.history.length, 2);
  assert.equal(back.history[0].kind, 'manual');
  // editing the title and minutes of such an entry
  updateSession(back, back.history[0].id, { title: 'Evening class', minutes: 60, ratings: { hamstrings: 'much' } });
  assert.deepEqual({ t: back.history[0].title, m: sessionMinutes(back.history[0], back.videos) }, { t: 'Evening class', m: 60 });
  deleteSession(back, back.history[0].id);
  assert.equal(back.history.length, 1);
  blockVideo(back, 'x'); // unrelated state is untouched by any of this
  assert.deepEqual(back.blocked, ['x']);
});
