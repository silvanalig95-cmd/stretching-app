import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoId, parseCommand, buildQueries } from '../../js/query.js';
import { mulberry32 } from '../../js/model.js';

test('parseVideoId accepts the common URL shapes', () => {
  const id = 'GffXQl3zvUI';
  for (const s of [id, `https://www.youtube.com/watch?v=${id}&t=30s`, `youtu.be/${id}?si=abc`, `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`, `www.youtube.com/live/${id}`]) {
    assert.equal(parseVideoId(s), id, s);
  }
  assert.equal(parseVideoId('https://example.com/watch?v=GffXQl3zvUI'), null);
  assert.equal(parseVideoId('hello world'), null);
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=short'), null);
});

test('parseCommand: lengths', () => {
  const r = (t) => { const c = parseCommand(t); return [c.minMin, c.maxMin]; };
  assert.deepEqual(r('hips, 15-20 min'), [15, 20]);
  assert.deepEqual(r('15 to 25 minutes'), [15, 25]);
  assert.deepEqual(r('under 10 minutes'), [3, 10]);
  assert.deepEqual(r('about 20 min'), [15, 25]);
  assert.deepEqual(r('at least 30 minutes'), [30, 60]);
  assert.deepEqual(r('20 minutes'), [16, 24]);
  assert.deepEqual(r('half an hour'), [25, 35]);
  assert.deepEqual(r('a quick one'), [3, 10]);
  assert.deepEqual(r('tight calves'), [null, null]);
});

test('parseCommand: muscles, conditions and tight vs weak', () => {
  const c = parseCommand('20 min, tight hamstrings and calves, weak glutes and core. desk posture');
  const mode = Object.fromEntries(c.areas.map((a) => [a.id, a.mode]));
  assert.equal(mode.hamstrings, 'tight');
  assert.equal(mode.calves, 'tight');
  assert.equal(mode.glutes, 'weak');
  assert.equal(mode.core, 'weak'); // "weak" carries across "and"
  assert.equal(mode.upper_back, 'tight'); // new sentence resets
  assert.ok(mode.neck && mode.chest);
  assert.equal(c.understood, true);
});

test('parseCommand: styles and hints; "stretch"/"weak" are not style filters', () => {
  assert.deepEqual(parseCommand('yin yoga for sleep').styles.sort(), ['restorative', 'yin']);
  assert.deepEqual(parseCommand('stretch my tight hips').styles, []);
  assert.deepEqual(parseCommand('weak glutes').styles, []);
  assert.deepEqual(parseCommand('strength for my glutes').styles, ['strength']);
  assert.ok(parseCommand('bedtime stretch for back').styles.includes('restorative'));
  assert.ok(parseCommand('morning routine for runners').hints.includes('morning'));
  assert.equal(parseCommand('lorem ipsum').understood, false);
  assert.deepEqual(parseCommand('lorem ipsum').terms, ['lorem', 'ipsum'], 'unknown words are kept as free text');
});

const filters = { areas: [{ id: 'hip_flexors', mode: 'tight' }, { id: 'lower_back', mode: 'tight' }, { id: 'calves', mode: 'tight' }], minMin: 10, maxMin: 20, styles: [] };

test('buildQueries is deterministic for a seed and returns distinct queries', () => {
  const a = buildQueries(filters, { queryLog: {}, rng: mulberry32(7), n: 3 });
  const b = buildQueries(filters, { queryLog: {}, rng: mulberry32(7), n: 3 });
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((q) => q.key)).size, a.length);
  for (const q of a) assert.ok(q.q.length > 5);
  assert.equal(a[0].videoDuration, 'medium'); // 10-20 min maps to YouTube's "medium"
});

test('repeating a search goes new places: used queries are avoided, then paged deeper', () => {
  const log = {};
  const seen = new Set();
  for (let run = 0; run < 6; run++) {
    const qs = buildQueries(filters, { queryLog: log, rng: mulberry32(100 + run), n: 2 });
    for (const q of qs) {
      assert.ok(!seen.has(q.key), `run ${run} repeated "${q.q}"`);
      seen.add(q.key);
      log[q.key] = { count: 1, order: q.order, nextPageToken: null };
    }
  }
  assert.equal(seen.size, 12);

  // When a query's log says there is a next result page, that page is requested (not page one again).
  const probe = buildQueries(filters, { queryLog: {}, rng: mulberry32(42), n: 1 })[0];
  const resumed = buildQueries(filters, { queryLog: { [probe.key]: { count: 0, order: 'rating', nextPageToken: 'TOKEN' } }, rng: mulberry32(42), n: 1 })[0];
  assert.equal(resumed.key, probe.key);
  assert.equal(resumed.pageToken, 'TOKEN');
  assert.equal(resumed.order, 'rating'); // a page token is only valid with the order it came from
});

test('an empty teacher list does not break query building', () => {
  const qs = buildQueries(filters, { queryLog: {}, rng: mulberry32(9), n: 2, teachers: [] });
  assert.equal(qs.length, 2);
});

test('weak areas get strengthening searches, tight areas get stretch searches', () => {
  const weak = buildQueries({ areas: [{ id: 'glutes', mode: 'weak' }] }, { queryLog: {}, rng: mulberry32(5), n: 3 });
  assert.ok(weak.every((q) => /streng|activation/i.test(q.q) || /yoga/i.test(q.q)));
  assert.ok(weak.some((q) => /streng|activation/i.test(q.q)));
});

test('unseen teachers are favoured when adventure is high', () => {
  const teachers = [{ name: 'Known Teacher' }, { name: 'Fresh Teacher' }];
  let fresh = 0, known = 0;
  for (let i = 0; i < 80; i++) {
    for (const q of buildQueries({ areas: [{ id: 'neck', mode: 'tight' }] }, { queryLog: {}, rng: mulberry32(i), n: 3, teachers, knownTeachers: new Set(['knownteacher']), adventure: 1 })) {
      if (/Fresh Teacher/.test(q.q)) fresh++;
      if (/Known Teacher/.test(q.q)) known++;
    }
  }
  assert.ok(fresh > known, `fresh ${fresh} vs known ${known}`);
});

test('parseCommand keeps leftover words as free-text terms (poses, teachers) but not muscles, lengths or filler', () => {
  const c = parseCommand('pigeon pose for tight hips, 20 min');
  assert.deepEqual(c.terms, ['pigeon']);
  assert.equal(c.understood, true);
  assert.deepEqual(parseCommand('Adriene hips 15 minutes').terms, ['adriene']);
  assert.deepEqual(parseCommand('please show me a quick stretch for my neck').terms, []);
  assert.deepEqual(parseCommand('yin for sleep, under 30 minutes').terms, []);
  assert.deepEqual(parseCommand('pigeon').terms, ['pigeon']);
  assert.equal(parseCommand('pigeon').understood, true, 'a named pose counts as understood');
});

test('free-text terms flow into generated searches', () => {
  const qs = buildQueries({ areas: [{ id: 'hip_flexors', mode: 'tight' }], terms: ['pigeon'], minMin: 10, maxMin: 20 }, { queryLog: {}, rng: mulberry32(3), n: 3 });
  assert.ok(qs.every((q) => /pigeon/.test(q.q)), qs.map((q) => q.q).join(' | '));
  const alone = buildQueries({ areas: [], terms: ['sphinx'], minMin: null, maxMin: null }, { queryLog: {}, rng: mulberry32(3), n: 2 });
  assert.ok(alone.every((q) => /sphinx/.test(q.q) && !/full body/.test(q.q)), alone.map((q) => q.q).join(' | '));
});
