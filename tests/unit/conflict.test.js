// Two tabs or devices on the same account must never silently erase each other's work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Store } from '../../js/store.js';
import { SCHEMA, freshState, splitState, addToLibrary, logSession } from '../../js/state.js';

const rev = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16);
/** A tiny stand-in for serve.py's revision-checked profile endpoint. */
function revisionServer(initial) {
  const db = { text: initial ? JSON.stringify(initial) : null, index: null, puts: [], conflicts: 0 };
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetchFn = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    if (url === '/api/ping') return json({ app: 'unfurl', version: 't' });
    if (url === '/api/profile' && method === 'GET') return json({ data: db.text ? JSON.parse(db.text) : null, recoveredFrom: null, rev: db.text ? rev(db.text) : null });
    if (url === '/api/profile' && method === 'PUT') {
      const want = opts.headers['If-Match'], have = db.text ? rev(db.text) : 'none';
      db.puts.push({ want, have });
      if (want !== undefined && want !== have) { db.conflicts++; return json({ error: 'conflict', rev: db.text ? have : null, data: db.text ? JSON.parse(db.text) : null }, 409); }
      db.text = opts.body;
      return json({ ok: true, rev: rev(db.text) });
    }
    if (url === '/api/index') return method === 'PUT' ? ((db.index = opts.body), json({ ok: true })) : json(db.index ? JSON.parse(db.index) : null);
    if (url === '/api/config' || url === '/api/legacy') return json(null);
    return json({}, 404);
  };
  return { db, fetchFn, doc: () => JSON.parse(db.text) };
}
const open = (srv) => new Store({ fetchFn: srv.fetchFn, retryBaseMs: 10 }).init();
const entry = (id, videoId) => ({ id, videoId, at: `2026-10-0${id.slice(-1)}T10:00:00.000Z`, date: `2026-10-0${id.slice(-1)}`, areas: [{ id: 'neck', mode: 'tight' }], completed: true, ratings: { neck: 'much' }, intensity: 'right', again: true });

test('saves carry the revision they were based on, and move it forward', async () => {
  const srv = revisionServer(null);
  const store = await open(srv);                      // first run writes the profile
  assert.equal(srv.db.puts[0].want, undefined, 'the very first write, on an empty server, is unconditional');
  addToLibrary(store.state, 'aaaaaaaaaaa');
  await store.flush();
  assert.notEqual(srv.db.puts.at(-1).want, 'none', 'later saves quote the previous version');
  assert.equal(srv.db.puts.at(-1).want, srv.db.puts.at(-1).have, 'and it matched');
  assert.ok(srv.doc().library.aaaaaaaaaaa);
});

test('a stale tab merges what the other tab saved instead of overwriting it', async () => {
  const srv = revisionServer(null);
  const tabA = await open(srv);
  const tabB = await open(srv);                        // opened at the same moment, same starting point
  let merged = 0; tabB.onMerged = () => { merged++; };

  addToLibrary(tabA.state, 'aaaaaaaaaaa', { tags: ['from-a'] });
  logSession(tabA.state, { videoId: 'aaaaaaaaaaa', date: '2026-10-01', areas: [{ id: 'neck', mode: 'tight' }], completed: true, ratings: { neck: 'much' }, intensity: 'right', again: true });
  assert.equal(await tabA.flush(), true);

  addToLibrary(tabB.state, 'bbbbbbbbbbb', { tags: ['from-b'] });          // B never saw A's work
  assert.equal(await tabB.flush(), true, 'B still manages to save');

  const saved = srv.doc();
  assert.ok(saved.library.aaaaaaaaaaa, 'A\'s video survived B\'s save');
  assert.ok(saved.library.bbbbbbbbbbb, 'and B\'s is there too');
  assert.equal(saved.history.length, 1, 'A\'s history entry survived');
  assert.equal(merged, 1, 'B was told');
  assert.ok(tabB.state.library.aaaaaaaaaaa, 'B now holds A\'s work as well');
  assert.equal(srv.db.conflicts, 1, 'exactly one rejected attempt, then it went through');
});

test('after merging, the next save is a normal one (no endless conflicts)', async () => {
  const srv = revisionServer(null);
  const a = await open(srv), b = await open(srv);
  addToLibrary(a.state, 'aaaaaaaaaaa'); await a.flush();
  addToLibrary(b.state, 'bbbbbbbbbbb'); await b.flush();
  const rejected = () => srv.db.conflicts;
  const before = rejected();
  addToLibrary(b.state, 'ccccccccccc'); await b.flush();
  assert.equal(rejected(), before);
  assert.deepEqual(Object.keys(srv.doc().library).sort(), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
});

test('two tabs logging routines at once keep both entries', async () => {
  const srv = revisionServer(null);
  const a = await open(srv), b = await open(srv);
  a.state.history.push(entry('s1', 'aaaaaaaaaaa')); await a.flush();
  b.state.history.push(entry('s2', 'bbbbbbbbbbb')); await b.flush();
  assert.deepEqual(srv.doc().history.map((h) => h.id).sort(), ['s1', 's2']);
});

test('data written by a NEWER version is never merged into or overwritten', async () => {
  const srv = revisionServer(null);
  const store = await open(srv);
  srv.db.text = JSON.stringify({ app: 'unfurl', schema: SCHEMA + 1, library: { future: {} }, history: [], prefs: {} });
  addToLibrary(store.state, 'aaaaaaaaaaa');
  assert.equal(await store.flush(), false);
  assert.equal(store.readOnly, true);
  assert.equal(JSON.parse(srv.db.text).schema, SCHEMA + 1, 'the newer data is untouched');
  assert.ok(store.notes.some((n) => /newer version/.test(n)));
});

test('"reset" and restores are deliberate: they replace the saved profile without being merged back', async () => {
  const srv = revisionServer(null);
  const a = await open(srv), b = await open(srv);
  addToLibrary(a.state, 'aaaaaaaaaaa'); await a.flush();
  await b.replace({ profile: splitState(freshState()).profile, index: splitState(freshState()).index });
  assert.deepEqual(Object.keys(srv.doc().library), [], 'the reset stuck');
  assert.equal(srv.db.puts.at(-1).want, undefined, 'it was sent unconditionally');
});

test('a profile deleted on the server while a page is open is simply recreated', async () => {
  const srv = revisionServer(null);
  const a = await open(srv);
  srv.db.text = null;
  addToLibrary(a.state, 'aaaaaaaaaaa');
  assert.equal(await a.flush(), true);
  assert.ok(srv.doc().library.aaaaaaaaaaa);
});
