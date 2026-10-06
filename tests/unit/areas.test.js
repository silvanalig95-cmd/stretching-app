// Specific muscle areas (lower abdomen, side abs, psoas, knees ...) next to the general ones (core, hip flexors, calves ...).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AREAS, AREA_BY_ID, GROUPS, POSES, QUICK_PICKS, AREA_TERMS, COMMAND_ONLY_TERMS, parentOf, childrenOf, rootOf, areaPath, scan,
} from '../../js/lexicon.js';
import { analyzeVideoText, ANALYSIS_VERSION } from '../../js/analyze.js';
import { parseCommand, buildQueries } from '../../js/query.js';
import { rankCandidates, areaHeat, buildModel, mulberry32 } from '../../js/model.js';
import { loadState } from '../../js/state.js';

const profileOf = (title, description = '') => ({ id: title.slice(0, 11).padEnd(11, 'x'), title, description, tags: [], durationSec: 900, views: 50000, likes: 2500, embeddable: true, verified: true, profile: analyzeVideoText({ title, description, tags: [] }) });
const areas = (v) => v.profile.areas;
const ids = (text) => parseCommand(text).areas.map((a) => a.id);

test('the lexicon hangs together: every reference points at a real area, every specific area has a real general parent in the same group', () => {
  const known = new Set(AREAS.map((a) => a.id));
  assert.equal(known.size, AREAS.length, 'no duplicate ids');
  for (const a of AREAS) {
    assert.ok(a.say.length >= 2, `${a.id} has search phrases`);
    assert.ok(GROUPS.some((g) => g.id === a.group), `${a.id} has a real group`);
    if (a.parent) {
      assert.ok(known.has(a.parent) && !AREA_BY_ID[a.parent].parent, `${a.id}: parent ${a.parent} is a general area`);
      assert.equal(a.group, AREA_BY_ID[a.parent].group, `${a.id} sits in its parent's group`);
    }
  }
  for (const p of POSES) for (const a of Object.keys(p.areas)) assert.ok(known.has(a), `pose ${p.id} -> ${a}`);
  for (const q of QUICK_PICKS) for (const a of q.areas) assert.ok(known.has(a), `quick pick ${q.id} -> ${a}`);
  for (const compiled of [AREA_TERMS, COMMAND_ONLY_TERMS]) for (const entry of new Set(compiled.map.values())) for (const a of Object.keys(entry.map)) assert.ok(known.has(a), `term ${entry.phrases[0]} -> ${a}`);
  for (const parent of ['core', 'hip_flexors', 'glutes', 'calves', 'feet', 'lower_back', 'upper_back', 'arms', 'shoulders', 'neck']) assert.ok(childrenOf(parent).length >= 1, `${parent} has specific parts`);
  assert.deepEqual(childrenOf('core').map((a) => a.id), ['abs_upper', 'abs_lower', 'obliques', 'deep_core', 'pelvic_floor']);
  assert.equal(areaPath('abs_lower'), 'Core › Lower abdomen');
  assert.equal(areaPath('core'), 'Core');
  assert.equal(rootOf('obliques'), 'core');
});

test('typing a specific muscle selects exactly that muscle; typing the general word selects the general area', () => {
  assert.deepEqual(ids('lower abs, 15 min'), ['abs_lower']);
  assert.deepEqual(ids('side abs and love handles'), ['obliques']);
  assert.deepEqual(ids('deep core and pelvic floor'), ['deep_core', 'pelvic_floor']);
  assert.deepEqual(ids('tight psoas'), ['psoas']);
  assert.deepEqual(ids('piriformis'), ['piriformis']);
  assert.deepEqual(ids('my knees hurt'), ['knees']);
  assert.deepEqual(ids('shin splints and achilles'), ['shins', 'achilles']);
  assert.deepEqual(ids('sprained ankle'), ['ankles']);
  assert.deepEqual(ids('plantar fasciitis'), ['arches']);
  assert.deepEqual(ids('tight traps'), ['upper_traps']);
  assert.deepEqual(ids('between the shoulder blades'), ['rhomboids']);
  assert.deepEqual(ids('core strength'), ['core']);
  assert.deepEqual(ids('tight calves'), ['calves']);
  const mixed = parseCommand('tight hip flexors but weak lower abs').areas;
  assert.deepEqual(mixed, [{ id: 'hip_flexors', mode: 'tight' }, { id: 'abs_lower', mode: 'weak' }]);
});

test('words that mean something else are not read as muscles ("knees to chest", "arch your back", "sit up straight")', () => {
  const videoOf = (t) => areas(profileOf(t));
  assert.equal(videoOf('Knees to chest relief').knees ?? 0, 0, 'a pose name is not a knee problem');
  assert.equal(videoOf('Arch your back gently').arches ?? 0, 0);
  assert.equal(videoOf('Sit up straight: posture reset').abs_upper ?? 0, 0);
  assert.deepEqual(scan(AREA_TERMS, 'knees').map((m) => m.phrase), [], 'as evidence in a title/comment');
  assert.ok(ids('knees').includes('knees'), 'but as a request it is clear');
});

test('a video that works a specific part counts for the general area, but not for its siblings', () => {
  const v = profileOf('10 min lower abs workout', 'Dead bug, leg raises and flutter kicks for your lower belly');
  assert.ok(areas(v).abs_lower >= 0.8, `lower abs ${areas(v).abs_lower}`);
  assert.ok(areas(v).core >= 0.7 && areas(v).core <= areas(v).abs_lower, `core ${areas(v).core}`);
  assert.ok((areas(v).obliques ?? 0) < 0.3 && (areas(v).abs_upper ?? 0) < 0.3, 'siblings are not lent strength');
  const side = profileOf('Side abs and love handles', 'Russian twists and side plank for your obliques');
  assert.ok(areas(side).obliques >= 0.8 && areas(side).core >= 0.7 && (areas(side).abs_lower ?? 0) < 0.3);
});

test('a video that only says "core" is a weak, never a strong, match for each specific part', () => {
  const v = profileOf('15 min core workout', 'Strengthen your core');
  assert.ok(areas(v).core >= 0.8);
  for (const c of ['abs_upper', 'abs_lower', 'obliques', 'deep_core', 'pelvic_floor']) {
    assert.ok(areas(v)[c] > 0.2 && areas(v)[c] < 0.5, `${c}: ${areas(v)[c]}`);
  }
});

test('asking for lower abs ranks the lower-abs video above the generic core video above an unrelated one; asking for core likes both', () => {
  const lower = profileOf('10 min lower abs workout', 'Dead bug, leg raises, flutter kicks');
  const generic = profileOf('15 min core workout', 'Strengthen your core with plank and boat pose');
  const neck = profileOf('Neck stretch for desk workers', 'neck roll and chin tuck');
  const rank = (selected) => rankCandidates({ videos: [lower, generic, neck], filters: { areas: selected, minMin: null, maxMin: null, styles: [], hints: [], terms: [] }, model: buildModel([], {}) }).map((r) => r.video.title);
  assert.deepEqual(rank([{ id: 'abs_lower', mode: 'weak' }]).slice(0, 2), [lower.title, generic.title]);
  assert.equal(rank([{ id: 'abs_lower', mode: 'weak' }])[2] ?? null, neck.title === rank([{ id: 'abs_lower', mode: 'weak' }])[2] ? neck.title : null, 'unrelated is last if shown at all');
  const forCore = rank([{ id: 'core', mode: 'weak' }]);
  assert.ok(forCore.slice(0, 2).includes(lower.title) && forCore.slice(0, 2).includes(generic.title));
});

test('a generalist is damped by how many DIFFERENT things it claims, not by how many parts of one thing', () => {
  const focused = profileOf('Core blast: lower abs, side abs, upper abs and deep core', 'Crunches, russian twists, leg raises, hollow hold');
  assert.ok(areas(focused).abs_upper >= 0.7 && areas(focused).obliques >= 0.7 && areas(focused).abs_lower >= 0.7, JSON.stringify(areas(focused)));
  const everything = profileOf('Neck, shoulders, hips, calves, core and wrists all in one', '');
  const strongest = Math.max(...['neck', 'shoulders', 'calves', 'core', 'wrists'].map((a) => areas(everything)[a] ?? 0));
  const single = profileOf('Neck stretches', '');
  assert.ok(strongest < areas(single).neck, 'a do-everything video is below a focused one');
});

test('working a specific area counts toward the general one in the heat map, and its rating is carried up', () => {
  const history = [
    { id: 'a', date: '2026-10-01', areas: [{ id: 'abs_lower', mode: 'weak' }], ratings: { abs_lower: 'much' }, videoId: 'x' },
    { id: 'b', date: '2026-10-02', areas: [{ id: 'core', mode: 'weak' }], ratings: {}, videoId: 'y' },
  ];
  const heat = areaHeat(history, { today: '2026-10-05' });
  assert.equal(heat.abs_lower.sessions, 1);
  assert.equal(heat.core.sessions, 2, 'both sessions count for the general area');
  assert.equal(heat.core.helped, 1, 'and the specific rating is carried up');
  assert.equal(heat.core.daysAgo, 3);
  assert.equal(heat.obliques, undefined, 'siblings are untouched');
});

test('search queries for a specific muscle use its own phrases', () => {
  const qs = buildQueries({ areas: [{ id: 'abs_lower', mode: 'weak' }], minMin: 10, maxMin: 20, styles: [], hints: [], terms: [] }, { queryLog: {}, rng: mulberry32(3), n: 3 });
  assert.ok(qs.some((q) => /lower (abs|belly|abdominals)/i.test(q.q)), qs.map((q) => q.q).join(' | '));
});

test('stored videos are re-analysed once, so existing libraries gain the specific areas', () => {
  assert.ok(ANALYSIS_VERSION >= 3);
  const old = { id: 'lowerabs001', title: '10 min lower abs workout', description: 'leg raises and flutter kicks', tags: [], durationSec: 600, source: 'search', embeddable: true, verified: true, profile: { areas: { core: 0.8 }, poses: [], chapters: [], styles: {}, sources: {} } };
  const { state } = loadState({ profile: { app: 'unfurl', schema: 2, library: {}, history: [], blocked: [], following: [], prefs: {} }, index: { app: 'unfurl', schema: 2, analysisVersion: 2, suggestionsVersion: 99, videos: { lowerabs001: old }, channels: {}, queryLog: {}, quota: { day: '', used: 0 } } });
  assert.ok(state.videos.lowerabs001.profile.areas.abs_lower >= 0.8, JSON.stringify(state.videos.lowerabs001.profile.areas));
});
