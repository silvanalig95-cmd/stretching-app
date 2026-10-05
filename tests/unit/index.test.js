import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchIndex, tokenize, queryTerms, stem, videoFields } from '../../js/index.js';
import { analyzeVideoText, attachComments } from '../../js/analyze.js';

const mk = (id, o) => { const v = { id, ...o }; v.profile = analyzeVideoText(v); return v; };
const videos = Object.fromEntries([
  mk('AAAAAAAAAAA', { title: '20 min Hip Opening Flow', channel: 'Yoga With Kassandra', description: '0:00 Intro\n1:00 Low lunge\n5:00 Pigeon pose\n9:00 Figure four\n12:00 Savasana' }),
  mk('BBBBBBBBBBB', { title: 'Morning neck and shoulder release', channel: 'Yoga With Adriene', description: 'Gentle start to the day.' }),
  mk('CCCCCCCCCCC', { title: 'Calf and ankle mobility', channel: 'Runner Recovery', description: 'For runners with tight calves.' }),
  mk('DDDDDDDDDDD', { title: 'Evening wind down', channel: 'Calm Studio', description: 'Relax before bed.' }),
].map((v) => [v.id, v]));

test('stemming and tokenizing', () => {
  assert.equal(stem('glutes'), 'glute'); assert.equal(stem('calves'), 'calf'); assert.equal(stem('stretching'), 'stretch');
  assert.equal(stem('stress'), 'stress'); assert.equal(stem('hips'), 'hip'); assert.equal(stem('stretches'), 'stretch');
  assert.deepEqual(tokenize('Café Ñandú: Pigeon-Pose!'), ['cafe', 'nandu', 'pigeon', 'pose']);
});

test('queryTerms drops filler words but never returns nothing for a real query', () => {
  assert.deepEqual(queryTerms('please show me the best pigeon pose for my hips'), ['pigeon', 'hip']);
  assert.deepEqual(queryTerms('yoga'), ['yoga'], 'all-stop-word queries fall back to everything');
  assert.deepEqual(queryTerms('15 min Adriene'), ['adriene']);
});

test('finds videos by teacher, by pose in the chapter list, and by muscle the analysis inferred', () => {
  const ix = SearchIndex.fromVideos(videos);
  assert.equal(ix.search('adriene')[0].id, 'BBBBBBBBBBB');
  assert.equal(ix.search('pigeon')[0].id, 'AAAAAAAAAAA', 'pose named only in the chapter list');
  assert.equal(ix.search('glutes')[0].id, 'AAAAAAAAAAA', 'muscle inferred from poses, not in the title');
  assert.equal(ix.search('calves')[0].id, 'CCCCCCCCCCC');
});

test('every term must match when anything matches all of them; otherwise partial matches are returned', () => {
  const ix = SearchIndex.fromVideos(videos);
  assert.deepEqual(ix.search('pigeon kassandra').map((r) => r.id), ['AAAAAAAAAAA']);
  const loose = ix.search('pigeon adriene').map((r) => r.id);
  assert.deepEqual(new Set(loose), new Set(['AAAAAAAAAAA', 'BBBBBBBBBBB']), 'no video has both, so either-term matches come back');
  assert.deepEqual(ix.search('zzzznotaword'), []);
});

test('title matches outrank description matches (field weights)', () => {
  const ix = new SearchIndex([
    { id: 'in-title', fields: { title: 'pigeon pose', description: 'x' } },
    { id: 'in-desc', fields: { title: 'something else entirely', description: 'we do pigeon pose here' } },
  ]);
  assert.deepEqual(ix.search('pigeon').map((r) => r.id), ['in-title', 'in-desc']);
});

test('rarer words count for more (idf)', () => {
  const docs = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `common${i}`, fields: { title: 'hip stretch' } })),
    { id: 'rare', fields: { title: 'hip stretch with sphinx' } },
  ];
  const ix = new SearchIndex(docs);
  assert.equal(ix.search('hip sphinx')[0].id, 'rare');
});

test('as-you-type prefix search', () => {
  const ix = SearchIndex.fromVideos(videos);
  assert.equal(ix.search('kass', { prefix: false }).length, 0);
  assert.equal(ix.search('kass', { prefix: true })[0].id, 'AAAAAAAAAAA');
  assert.equal(ix.search('ab', { prefix: true }).length, 0, 'too short to expand');
});

test('your own tags and notes are searchable, and ids can restrict the search (e.g. to the library)', () => {
  const lib = { DDDDDDDDDDD: { tags: ['sunday', 'recovery'], note: 'good after long runs' } };
  const ix = SearchIndex.fromVideos(videos, lib);
  assert.equal(ix.search('recovery')[0].id, 'DDDDDDDDDDD');
  assert.equal(ix.search('sunday')[0].id, 'DDDDDDDDDDD');
  assert.deepEqual(ix.search('recovery', { ids: new Set(['AAAAAAAAAAA']) }), [], 'restricted to ids');
});

test('what viewers said is searchable', () => {
  const v = attachComments(videos.CCCCCCCCCCC, Array.from({ length: 6 }, () => ({ text: 'The soleus stretch fixed my shin splints, thank you', likes: 4 })));
  const ix = SearchIndex.fromVideos({ ...videos, CCCCCCCCCCC: v });
  assert.equal(ix.search('soleus')[0].id, 'CCCCCCCCCCC');
});

test('relevance() is normalised to the best match', () => {
  const r = SearchIndex.fromVideos(videos).relevance('hip');
  assert.equal(Math.max(...r.values()), 1);
});

test('empty index and empty query are safe', () => {
  assert.deepEqual(new SearchIndex([]).search('hip'), []);
  assert.deepEqual(SearchIndex.fromVideos(videos).search('   '), []);
  assert.equal(videoFields({ id: 'x' }).title, undefined);
});
