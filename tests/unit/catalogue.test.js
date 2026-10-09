// The teachers list: its data is sound and honest about where it came from, and it is put to work (search flavouring, browsing, voices).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOGUE, CATALOGUE_DATE } from '../../data/teachers.js';
import { teacherPool, searchCatalogue, focusTagsFor, catalogueEntry, FOCUS_LABELS, levelText, sizeText } from '../../js/catalogue.js';
import { STYLE_BY_ID } from '../../js/style.js';
import { buildQueries } from '../../js/query.js';
import { TEACHERS } from '../../js/lexicon.js';
import { normName } from '../../js/channel.js';
import { voiceResolver, KNOWN_VOICES } from '../../js/teacher.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every entry is well-formed and nothing is listed twice', () => {
  assert.ok(CATALOGUE.length >= 150, `${CATALOGUE.length} teachers`);
  assert.match(CATALOGUE_DATE, /^\d{4}-\d{2}-\d{2}$/);
  const seen = new Set();
  for (const t of CATALOGUE) {
    const where = `“${t.name}”`;
    assert.ok(typeof t.name === 'string' && t.name.trim().length >= 2, `${where}: a name`);
    const k = normName(t.name);
    assert.ok(!seen.has(k), `${where} is listed twice`); seen.add(k);
    assert.ok(Array.isArray(t.styles) && t.styles.length && t.styles.every((s) => STYLE_BY_ID[s]), `${where}: styles ${t.styles}`);
    assert.ok((t.focus ?? []).every((x) => FOCUS_LABELS[x]), `${where}: focus ${t.focus}`);
    assert.ok(['beginner', 'all', 'advanced'].includes(t.level), `${where}: level`);
    assert.ok(['short', 'mid', 'long', 'mixed'].includes(t.length), `${where}: length`);
    assert.ok(t.size === undefined || ['large', 'mid', 'small'].includes(t.size), `${where}: size`);
    assert.ok(t.active === undefined || typeof t.active === 'boolean', `${where}: active`);
    assert.ok(t.handle === undefined || /^@[\w.-]+$/.test(t.handle), `${where}: handle ${t.handle}`);
    assert.ok((t.note ?? '').length <= 110, `${where}: note too long`);
    assert.ok(t.source === undefined || /^https:\/\//.test(t.source), `${where}: source`);
  }
});

test('a voice is only ever set with the source that said so, and its certainty; never without', () => {
  const voiced = CATALOGUE.filter((t) => t.voice);
  assert.ok(voiced.length >= 40);
  for (const t of CATALOGUE) {
    if (t.voice) {
      assert.ok(['female', 'male', 'mixed'].includes(t.voice), `${t.name}: voice`);
      assert.ok(['sure', 'probable'].includes(t.voiceBy), `${t.name}: voiceBy`);
      assert.ok(typeof t.voiceSource === 'string' && t.voiceSource.length > 8, `${t.name}: the evidence for its voice`);
    } else assert.ok(t.voiceBy === undefined && t.voiceSource === undefined, `${t.name}: a certainty without a voice`);
  }
  assert.ok(voiced.filter((t) => t.voice === 'male').length >= 10, 'enough men to make “male teacher” useful');
  assert.ok(voiced.filter((t) => t.voice === 'female').length >= 25, 'and enough women');
});

test('the file says plainly how it was made and what it cannot promise', () => {
  const text = fs.readFileSync(path.join(ROOT, 'data/teachers.js'), 'utf8').split('export const')[0];
  assert.match(text, /web SEARCH RESULTS/);
  assert.match(text, /never from a[\s/]+name/i);
  assert.match(text, /not a guarantee/);
});

test('the voices in the list are what the app uses for well-known teachers', () => {
  for (const t of CATALOGUE.filter((x) => x.voice)) {
    const got = voiceResolver({ videos: [] })({ id: 'x', channel: t.name });
    assert.equal(got?.gender, t.voice, t.name);
    assert.equal(got.source, 'known');
  }
  assert.equal(Object.keys(KNOWN_VOICES).length, new Set(CATALOGUE.filter((t) => t.voice).map((t) => normName(t.name))).size);
});

test('flavouring searches with teachers: the voice asked for narrows the pool, a known teacher of the other voice never appears', () => {
  const all = teacherPool({});
  assert.equal(all.length, CATALOGUE.filter((t) => t.active !== false).length);
  const f = teacherPool({ voice: 'female' }), m = teacherPool({ voice: 'male' });
  assert.ok(f.length >= 6 && m.length >= 6);
  assert.ok(f.every((t) => t.voice !== 'male'), 'no known man in the women pool');
  assert.ok(m.every((t) => t.voice !== 'female'), 'no known woman in the men pool');
  assert.ok(m.every((t) => t.voice === 'male' || t.voice === 'mixed'), 'enough men are known, so unknown teachers are left out of the pool');
  assert.deepEqual(teacherPool({ voice: 'nonsense' }), all, 'not a choice: no narrowing');
  const yin = teacherPool({ styles: ['yin'] });
  assert.ok(yin.length < all.length && yin.every((t) => t.styles.includes('yin')));
  assert.equal(teacherPool({ styles: ['no-such-style'] }).length, all.length, 'too few matches: stay varied');
  const back = teacherPool({ areas: [{ id: 'lower_back' }] });
  assert.ok(back.length < all.length && back.every((t) => t.focus?.some((x) => ['lower-back', 'back', 'sciatica', 'pain-relief'].includes(x))));
  assert.deepEqual(teacherPool({}, []), TEACHERS, 'with no data at all, the short built-in list');
  assert.deepEqual([...focusTagsFor([{ id: 'psoas' }])].sort(), [...focusTagsFor([{ id: 'hip_flexors' }])].sort(), 'a specific muscle points where its parent does');
});

test('searches that name a teacher never name a known man when a woman is asked for, and vice versa', () => {
  const knownMen = CATALOGUE.filter((t) => t.voice === 'male').map((t) => t.name.toLowerCase());
  const knownWomen = CATALOGUE.filter((t) => t.voice === 'female').map((t) => t.name.toLowerCase());
  let named = 0;
  for (let seed = 1; seed <= 120; seed++) {
    let a = seed;
    const rng = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (const [voice, banned] of [['female', knownMen], ['male', knownWomen]]) {
      const qs = buildQueries({ areas: [{ id: 'hip_flexors', mode: 'tight' }], minMin: 10, maxMin: 20, styles: [], voice }, { queryLog: {}, rng: (() => { const r = rng; return r; })(), n: 5 }).map((q) => q.q.toLowerCase());
      for (const q of qs) { if (CATALOGUE.some((t) => q.includes(t.name.toLowerCase()))) named++; assert.ok(!banned.some((n) => q.includes(n)), `“${q}” names the wrong voice for ${voice}`); }
    }
  }
  assert.ok(named > 20, `teacher-flavoured searches do occur (${named})`);
});

test('browsing: words, style, focus, level, who teaches, and the order', () => {
  const n = (f) => searchCatalogue(f).length;
  assert.equal(n({}), CATALOGUE.length);
  assert.ok(n({ q: 'adriene' }) >= 1 && searchCatalogue({ q: 'adriene' })[0].name.toLowerCase().includes('adriene'));
  assert.equal(n({ q: 'zzzzzz' }), 0);
  assert.ok(searchCatalogue({ q: 'yin yoga' }).length >= 3, 'every word has to appear somewhere (name, note, style or focus)');
  assert.ok(searchCatalogue({ style: 'yin' }).every((t) => t.styles.includes('yin')));
  assert.ok(searchCatalogue({ focus: 'hips' }).every((t) => t.focus.includes('hips')));
  const beginner = searchCatalogue({ level: 'beginner' });
  assert.ok(beginner.every((t) => t.level === 'beginner' || t.level === 'all'), 'all-level teachers suit a beginner too');
  assert.ok(searchCatalogue({ level: 'advanced' }).every((t) => t.level === 'advanced' || t.level === 'all'));
  const women = searchCatalogue({ voice: 'female' }), men = searchCatalogue({ voice: 'male' }), several = searchCatalogue({ voice: 'mixed' }), unknown = searchCatalogue({ voice: 'unknown' });
  assert.ok(women.every((t) => t.voice === 'female' || t.voice === 'mixed') && men.every((t) => t.voice === 'male' || t.voice === 'mixed'));
  assert.ok(several.every((t) => t.voice === 'mixed') && unknown.every((t) => !t.voice));
  assert.equal(unknown.length + CATALOGUE.filter((t) => t.voice).length, CATALOGUE.length);
  // the app's own reading (your marks, the comments) can replace the list's
  assert.equal(searchCatalogue({ voice: 'male' }, () => ({ gender: 'male' })).length, CATALOGUE.length);
  assert.equal(searchCatalogue({ voice: 'unknown' }, () => ({ gender: 'male' })).length, 0);
  const byName = searchCatalogue({}).map((t) => t.name), bySize = searchCatalogue({ sort: 'size' });
  assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  const rank = { large: 0, mid: 1, small: 2 };
  assert.ok(bySize.every((t, i) => i === 0 || (rank[bySize[i - 1].size] ?? 3) <= (rank[t.size] ?? 3)), 'biggest first, unknown last');
});

test('a channel name finds its entry however it is written; the words for the screen exist', () => {
  assert.equal(catalogueEntry('yoga with ADRIENE')?.name.toLowerCase().includes('adriene'), true);
  assert.equal(catalogueEntry('Sarah Beth Yoga')?.name.replace(/ /g, '').toLowerCase(), 'sarahbethyoga');
  assert.equal(catalogueEntry('nobody at all'), null);
  assert.equal(catalogueEntry(''), null);
  assert.equal(levelText('beginner'), 'Beginner-friendly'); assert.equal(sizeText('large'), 'Very large channel'); assert.equal(levelText('x'), '');
});
