import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchIndex, parseSearch, editDistance } from '../../js/index.js';
import { analyzeVideoText } from '../../js/analyze.js';

const mk = (id, o) => { const v = { id, durationSec: (o.min ?? 15) * 60, ...o }; v.profile = analyzeVideoText(v); return v; };
const V = [
  mk('PIGEONHIP01', { title: '20 Min Hip Opening Flow', channel: 'Yoga With Kassandra', min: 20, description: '0:00 Intro\n1:00 Low lunge\n5:00 Pigeon pose\n9:00 Figure four\n12:00 Savasana', tags: ['hip opener'] }),
  mk('LOWBACK0001', { title: 'Gentle relief for an aching low back', channel: 'Back Care Yoga', min: 12, description: 'Cat cow, child pose and knees to chest for lower back pain.' }),
  mk('NECKROUTINE', { title: 'Morning neck and shoulder release', channel: 'Yoga With Adriene', min: 10, description: 'Start the day gently.' }),
  mk('CALVES00001', { title: 'Calf and ankle mobility for runners', channel: 'Runner Recovery', min: 8, description: 'Tight calves after a run.' }),
  mk('YINWIND0001', { title: 'Evening wind down yin yoga for hips', channel: 'Calm Studio', min: 30, description: 'Long holds, relax before bed. Sleeping pigeon is included.' }),
  mk('GLUTESONLY1', { title: 'Strong glutes workout', channel: 'Strong Flow', min: 25, description: 'Glute bridge, fire hydrant, clamshell and squats.' }),
];
const lib = { NECKROUTINE: { tags: ['morning', 'daily'], note: 'my go-to' }, CALVES00001: { tags: ['running'] } };
const ix = SearchIndex.fromVideos(Object.fromEntries(V.map((v) => [v.id, v])), lib);
const ids = (q, o) => ix.query(q, o).results.map((r) => r.id);

test('parseSearch: words, phrases, exclusions, fields and length', () => {
  const p = parseSearch('hips "low lunge" -yin -"wind down" channel:adriene tag:"after run" pose:pigeon area:glutes len:10-20');
  assert.deepEqual(p.terms, ['hip', 'low', 'lunge']);
  assert.deepEqual(p.phrases, ['low lunge']);
  assert.deepEqual(p.exclude, { terms: ['yin'], phrases: ['wind down'] });
  assert.deepEqual(p.filters, [{ field: 'channel', value: 'adriene' }, { field: 'tag', value: 'after run' }, { field: 'pose', value: 'pigeon' }, { field: 'area', value: 'glutes' }]);
  assert.deepEqual(p.len, { min: 10, max: 20, exMin: false, exMax: false });
  assert.deepEqual(parseSearch('len:<15').len, { min: null, max: 15, exMin: false, exMax: true });
  assert.deepEqual(parseSearch('len:>25').len, { min: 25, max: null, exMin: true, exMax: false });
  assert.deepEqual(parseSearch('len:15').len, { min: 12, max: 18, exMin: false, exMax: false });
});

test('parseSearch: odd input is just words, never an error', () => {
  assert.deepEqual(parseSearch('10:30 hips').terms, ['hip']);
  assert.deepEqual(parseSearch('unknown:thing').terms, ['unknown', 'thing'].map((x) => x), 'an unknown "field:" is plain text');
  assert.deepEqual(parseSearch('"pigeon"').phrases, [], 'a quoted single word is just a word');
  assert.deepEqual(parseSearch('yoga').terms, ['yoga'], 'all stop words still search');
  assert.deepEqual(parseSearch('').terms, []);
  assert.doesNotThrow(() => parseSearch('"unterminated quote -- : :: ---'));
  assert.deepEqual(parseSearch('Café ñandú').terms, ['cafe', 'nandu']);
});

test('exact phrases must appear together', () => {
  assert.deepEqual(ids('"hip opening"'), ['PIGEONHIP01']);
  assert.ok(ids('hip opening').includes('PIGEONHIP01') && ids('"opening hip"').length === 0, 'order matters inside quotes');
  assert.deepEqual(ids('"low lunge"'), ['PIGEONHIP01'], 'phrases found in chapter lists too');
});

test('exclusions remove videos with that word or phrase', () => {
  assert.ok(ids('hips').includes('YINWIND0001'));
  assert.ok(!ids('hips -yin').includes('YINWIND0001'));
  assert.ok(!ids('hips -"wind down"').includes('YINWIND0001'));
  assert.ok(ids('hips -yin').includes('PIGEONHIP01'));
  assert.ok(!ids('hips -channel:calm').includes('YINWIND0001'), 'negative field filters work too');
});

test('field filters: channel, tag (your own tags), pose, area, title, length', () => {
  assert.deepEqual(ids('channel:adriene'), ['NECKROUTINE']);
  assert.deepEqual(ids('channel:"yoga with kassandra"'), ['PIGEONHIP01']);
  assert.deepEqual(ids('teacher:kassandra'), ['PIGEONHIP01'], 'aliases');
  assert.deepEqual(ids('tag:morning'), ['NECKROUTINE']);
  assert.deepEqual(ids('tag:run'), ['CALVES00001']);
  assert.deepEqual(new Set(ids('pose:pigeon')), new Set(['PIGEONHIP01', 'YINWIND0001']));
  assert.ok(ids('area:glutes').includes('GLUTESONLY1') && ids('area:glutes').includes('PIGEONHIP01'));
  assert.ok(!ids('area:glutes').includes('NECKROUTINE'));
  assert.deepEqual(ids('title:neck'), ['NECKROUTINE']);
  assert.deepEqual(new Set(ids('len:10-20')), new Set(['LOWBACK0001', 'NECKROUTINE', 'PIGEONHIP01']));
  assert.deepEqual(new Set(ids('len:<10')), new Set(['CALVES00001']), '"<10" is strictly under: the 10-minute video is out');
  assert.ok(ids('len:10-10').includes('NECKROUTINE'), 'ranges are inclusive');
  assert.deepEqual(new Set(ids('len:>25')), new Set(['YINWIND0001']));
});

test('filters combine with words and each other', () => {
  assert.deepEqual(ids('hips len:>25'), ['YINWIND0001']);
  assert.deepEqual(ids('area:glutes len:20-30 -hips'), ['GLUTESONLY1']);
  assert.deepEqual(ids('channel:adriene pose:pigeon'), []);
  assert.deepEqual(ids('channel:calm', { ids: new Set(['PIGEONHIP01']) }), [], 'restricting to ids still applies');
});

test('concepts: a word that names a muscle finds videos that work it, even if they never use the word', () => {
  const r = ix.query('lumbar');
  assert.deepEqual(r.results.map((x) => x.id)[0], 'LOWBACK0001');
  assert.ok(r.interpretation.concepts.includes('Lower back'));
  assert.ok(ids('sciatica').includes('PIGEONHIP01'), 'sciatica -> glutes -> the pigeon pose video');
  assert.ok(ids('pigeon')[0] === 'PIGEONHIP01' || ids('pigeon').includes('YINWIND0001'));
  assert.ok(ids('gluteal').includes('GLUTESONLY1'), 'synonym of glutes');
});

test('a muscle concept only satisfies the words it covers (it cannot stand in for other words)', () => {
  // "pigeon glutes": GLUTESONLY1 works the glutes but has no pigeon pose -> it must not count as a full match
  const full = ix.query('pigeon glutes');
  assert.equal(full.interpretation.partial, false, 'a video with both exists');
  assert.deepEqual(new Set(full.results.map((r) => r.id)), new Set(['PIGEONHIP01', 'YINWIND0001']), 'the two videos with pigeon pose that work the glutes');
  assert.ok(!full.results.map((r) => r.id).includes('GLUTESONLY1'), 'glute-only video is not a full match for "pigeon glutes"');
  const none = SearchIndex.fromVideos({ G: V.find((v) => v.id === 'GLUTESONLY1') }).query('pigeon glutes');
  assert.equal(none.interpretation.partial, true, 'only partial matches exist when no video has pigeon');
});

test('typo tolerance with a visible correction; short words are never "corrected"', () => {
  const r = ix.query('pigion');
  assert.deepEqual(r.interpretation.corrections, { pigion: 'pigeon' });
  assert.ok(r.results.map((x) => x.id).includes('PIGEONHIP01'));
  assert.ok(ids('adrienne').includes('NECKROUTINE'), 'teacher name misspelt');
  assert.ok(ids('shoulderr').includes('NECKROUTINE'));
  assert.deepEqual(ids('zzzqqqxxx'), []);
  assert.deepEqual(ix.query('hop').interpretation.corrections, {}, '3-letter words are left alone');
  assert.deepEqual(ix.query('pigeon').interpretation.corrections, {}, 'correct spellings are not "corrected"');
  assert.deepEqual(ix.query('pigion', { fuzzy: false }).results, []);
});

test('word forms: plurals and -ing', () => {
  assert.ok(ids('calf').includes('CALVES00001'));
  assert.ok(ids('calves').includes('CALVES00001'));
  assert.ok(ids('stretching hips').length > 0);
});

test('ranking: phrase in the title beats phrase buried in the text; words said AND worked beat worked-only', () => {
  const docs = SearchIndex.fromVideos({
    A: mk('AAAAAAAAAAA', { title: 'Something else', channel: 'X', description: 'We do hip opening for a while.' }),
    B: mk('BBBBBBBBBBB', { title: 'Hip opening in 10 minutes', channel: 'Y', description: 'x' }),
  });
  assert.deepEqual(docs.query('"hip opening"').results.map((r) => r.id), ['BBBBBBBBBBB', 'AAAAAAAAAAA']);
  const r = ix.query('glutes').results.map((x) => x.id);
  assert.equal(r[0], 'GLUTESONLY1', 'says glutes in the title and works them');
});

test('interpretation tells the UI what was understood', () => {
  const i = ix.query('lumbar "low lunge" -yin channel:calm len:<40').interpretation;
  assert.deepEqual([i.phrases, i.excluded, i.filters.length, i.len.max, i.len.exMax], [['low lunge'], ['yin'], 1, 40, true]);
  assert.equal(i.partial, false);
});

test('autocomplete: words, poses, teachers and field values; keeps the rest of the query', () => {
  assert.ok(ix.suggest('pig').includes('pose:pigeon'));
  assert.ok(ix.suggest('kass').includes('channel:"Yoga With Kassandra"'));
  assert.ok(ix.suggest('channel:ad').includes('channel:"Yoga With Adriene"'));
  assert.ok(ix.suggest('pose:pi').some((s) => s === 'pose:Pigeon'));
  assert.ok(ix.suggest('area:glu').includes('area:"Glutes & piriformis"'));
  assert.ok(ix.suggest('tag:mo').includes('tag:morning'));
  assert.ok(ix.suggest('hips pig').every((s) => s.startsWith('hips ')), 'keeps the rest of the query');
  assert.deepEqual(ix.suggest('h'), [], 'waits for two letters');
  assert.deepEqual(ix.suggest('hips '), [], 'nothing to complete after a space');
  assert.ok(ix.suggest('calv').some((s) => /calf|calv/.test(s)) || ix.suggest('cal').length > 0);
});

test('editDistance: substitutions, insertions, deletions and swaps; bails out early', () => {
  assert.equal(editDistance('pigeon', 'pigion'), 1);
  assert.equal(editDistance('pigeon', 'pigoen'), 1, 'adjacent swap counts as one');
  assert.equal(editDistance('adriene', 'adrienne'), 1);
  assert.equal(editDistance('abc', 'xyzxyz', 2), 3, 'gives up beyond max');
  assert.equal(editDistance('same', 'same'), 0);
});

test('search() and relevance() keep working for older callers', () => {
  assert.ok(Array.isArray(ix.search('hips')));
  assert.equal(Math.max(...ix.relevance('hips').values()), 1);
  assert.deepEqual(ix.search(['pigeon']).map((r) => r.id).includes('PIGEONHIP01'), true, 'arrays of pre-stemmed terms');
});
