import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../js/store.js';
import { SCHEMA, freshState, splitState, addToLibrary, logSession } from '../../js/state.js';

// An in-memory stand-in for serve.py's API.
function fakeServer({ profile = null, index = null, config = null, legacy = null, recoveredFrom = null } = {}) {
  const db = { profile, index, config, legacy };
  const puts = [], backupCalls = [];
  const fetchFn = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url === '/api/ping') return json({ app: 'unfurl', version: '9.9.9', dataDir: '/data' });
    if (url === '/api/backups') return json([{ name: 'profile-2026-10-04.json', size: 10, modified: 1 }]);
    if (url === '/api/backups/snapshot') { backupCalls.push(['snapshot', JSON.parse(opts.body).label]); return json({ ok: true, name: 'profile-x-20261005-101010.json' }); }
    if (url === '/api/backups/restore') { backupCalls.push(['restore', JSON.parse(opts.body).name]); return json({ ok: true }); }
    const key = { '/api/profile': 'profile', '/api/index': 'index', '/api/config': 'config', '/api/legacy': 'legacy' }[url];
    if (!key) return json({}, 404);
    if (method === 'PUT') { db[key] = JSON.parse(opts.body); puts.push(key); if (key === 'profile') db.legacy = null; return json({ ok: true }); }
    return json(key === 'profile' ? { data: db.profile, recoveredFrom } : db[key]);
  };
  return { fetchFn, db, puts, backupCalls };
}
const memStorage = (limit = Infinity) => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { if ([...m.values()].join('').length + v.length > limit) throw new Error('QuotaExceededError'); m.set(k, v); } };
};

test('first run on the server: empty library, suggestions seeded, both documents written once', async () => {
  const srv = fakeServer();
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.equal(store.mode, 'server'); assert.equal(store.server.dataDir, '/data'); assert.equal(store.server.version, '9.9.9');
  assert.deepEqual(store.state.library, {});
  assert.deepEqual(srv.puts.sort(), ['index', 'profile']);
  assert.equal(srv.db.profile.schema, SCHEMA);
  assert.ok(Object.keys(srv.db.index.videos).length > 40);
});

test('nothing changed => nothing written; one change => only that file is written', async () => {
  const s0 = freshState(); const { profile, index } = splitState(s0);
  const srv = fakeServer({ profile: JSON.parse(JSON.stringify(profile)), index: JSON.parse(JSON.stringify(index)) });
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.deepEqual(srv.puts, [], 'a clean load writes nothing');
  await store.flush();
  assert.deepEqual(srv.puts, []);
  store.state.prefs.adventure = 0.9;             // profile-only change
  await store.flush();
  assert.deepEqual(srv.puts, ['profile']);
  store.state.queryLog.x = { count: 1 };         // index-only change
  await store.flush();
  assert.deepEqual(srv.puts, ['profile', 'index']);
});

test('an old single-file state.json is upgraded on first load and saved in the new layout', async () => {
  const legacy = { version: 1, videos: { AAAAAAAAAAA: { id: 'AAAAAAAAAAA', title: 'T', source: 'manual' } }, history: [], saved: ['AAAAAAAAAAA'], blocked: [] };
  const srv = fakeServer({ legacy });
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.ok(store.state.library.AAAAAAAAAAA);
  assert.ok(store.notes.some((n) => /Upgraded/.test(n)));
  assert.equal(srv.db.profile.schema, SCHEMA);
  assert.ok(srv.db.profile.library.AAAAAAAAAAA);
});

test('data from a newer version is never written to (read-only)', async () => {
  const srv = fakeServer({ profile: { app: 'unfurl', schema: SCHEMA + 1, library: {}, history: [], blocked: [], prefs: {} }, index: { schema: SCHEMA + 1, videos: {} } });
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.equal(store.readOnly, true);
  assert.match(store.notes[0], /newer version/);
  store.state.prefs.adventure = 0.1; store.save(); await store.flush();
  assert.deepEqual(srv.puts, []);
  assert.equal(srv.db.profile.schema, SCHEMA + 1, 'untouched');
});

test('recovery from a damaged file is reported to the user', async () => {
  const s0 = freshState();
  const srv = fakeServer({ profile: splitState(s0).profile, index: splitState(s0).index, recoveredFrom: 'profile-2026-10-04.json' });
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.ok(store.notes.some((n) => /restored from the backup “profile-2026-10-04.json”/.test(n)));
});

test('the API key is kept in config, never in profile or index', async () => {
  const srv = fakeServer();
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  store.config.apiKey = 'SECRETKEY'; await store.saveConfig();
  assert.equal(srv.db.config.apiKey, 'SECRETKEY');
  addToLibrary(store.state, 'zPzSkLHp9ws'); await store.flush();
  assert.ok(!JSON.stringify(srv.db.profile).includes('SECRETKEY') && !JSON.stringify(srv.db.index).includes('SECRETKEY'));
});

test('without a server it falls back to browser storage, with the same layout', async () => {
  const storage = memStorage();
  const down = async () => { throw new Error('connection refused'); };
  let store = await new Store({ fetchFn: down, storage }).init();
  assert.equal(store.mode, 'local');
  logSession(store.state, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'much' } });
  await store.flush();
  assert.ok(storage.m.has('unfurl.profile') && storage.m.has('unfurl.index'));
  store = await new Store({ fetchFn: down, storage }).init();
  assert.equal(store.state.history.length, 1);
  assert.ok(store.state.library.zPzSkLHp9ws);
});

test('browser-storage mode upgrades a version-1 save in place and keeps the old key as a backup', async () => {
  const storage = memStorage();
  storage.setItem('unfurl.state', JSON.stringify({ version: 1, videos: {}, history: [{ id: 'h1', videoId: 'BBBBBBBBBBB', at: '2026-10-01T00:00:00Z', date: '2026-10-01', ratings: {} }], saved: [], blocked: [] }));
  const store = await new Store({ fetchFn: async () => { throw new Error('down'); }, storage }).init();
  assert.equal(store.state.history.length, 1);
  assert.ok(store.state.library.BBBBBBBBBBB, 'done videos join the library');
  assert.ok(storage.m.has('unfurl.profile'));
  assert.ok(storage.m.has('unfurl.state'), 'old data left in place');
});

test('when browser storage is too small, the index is slimmed (raw comments dropped) rather than losing data', async () => {
  const s = freshState();
  for (let i = 0; i < 60; i++) s.videos[`BIG${String(i).padStart(8, '0')}`] = { id: `BIG${i}`, title: 'Hip stretch', source: 'search', description: 'd'.repeat(1500), comments: Array.from({ length: 50 }, () => ({ t: 'comment text '.repeat(10), l: 1 })), profile: {} };
  const { profile, index } = splitState(s);
  const full = JSON.stringify(index).length;
  const storage = memStorage(Math.round(full * 0.45));
  const store = new Store({ fetchFn: async () => { throw new Error('down'); }, storage });
  store.state = s; store.mode = 'local';
  await store.flush();
  const saved = JSON.parse(storage.m.get('unfurl.index'));
  assert.ok(storage.m.has('unfurl.profile'));
  assert.ok(Object.keys(saved.videos).length >= 60, 'every video kept');
  assert.ok(!Object.values(saved.videos).some((v) => v.comments), 'bulky raw comments dropped to fit');
  assert.equal(store.lastError, null);
});

test('replace() resets to an empty library with suggestions', async () => {
  const srv = fakeServer();
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  logSession(store.state, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'much' } }); await store.flush();
  assert.equal(srv.db.profile.history.length, 1);
  await store.replace(null);
  assert.equal(srv.db.profile.history.length, 0);
  assert.deepEqual(srv.db.profile.library, {});
});

test('backup helpers: list, snapshot (flushes first), restore; harmless without a server', async () => {
  const srv = fakeServer();
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.equal((await store.listBackups())[0].name, 'profile-2026-10-04.json');
  logSession(store.state, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'much' } });
  const name = await store.snapshot('before-reset');
  assert.match(name, /^profile-/);
  assert.equal(srv.db.profile.history.length, 1, 'unsaved changes were flushed before the snapshot');
  assert.deepEqual(srv.backupCalls, [['snapshot', 'before-reset']]);
  assert.equal(await store.restoreBackup('profile-2026-10-04.json'), true);
  const local = await new Store({ fetchFn: async () => { throw new Error('down'); }, storage: memStorage() }).init();
  assert.deepEqual(await local.listBackups(), []);
  assert.equal(await local.snapshot('x'), null);
  assert.equal(await local.restoreBackup('x'), false);
});

test('SAFETY: if the server cannot be read, nothing is ever written (a failed read is not "no data")', async () => {
  const s0 = freshState(); logSession(s0, { videoId: 'zPzSkLHp9ws', ratings: { calves: 'much' } });
  const real = splitState(s0);
  for (const failing of ['/api/profile', '/api/index']) {
    const srv = fakeServer({ profile: real.profile, index: real.index });
    const flaky = async (url, opts) => { if (url === failing && !opts?.method) { const e = new Error('boom'); throw e; } return srv.fetchFn(url, opts); };
    const store = await new Store({ fetchFn: flaky }).init();
    assert.equal(store.readOnly, true, failing);
    assert.ok(store.notes.some((n) => /Couldn’t read your saved data/.test(n)));
    store.state.prefs.adventure = 0.1; store.save(); await store.flush();
    assert.deepEqual(srv.puts, [], `${failing}: wrote nothing`);
    assert.equal(srv.db.profile.history.length, 1, 'real data untouched');
  }
  const http500 = fakeServer({ profile: real.profile, index: real.index });
  const store = await new Store({ fetchFn: async (u, o) => (u === '/api/profile' ? { ok: false, status: 500, json: async () => null } : http500.fetchFn(u, o)) }).init();
  assert.equal(store.readOnly, true);
});

test('an empty server (no files yet) is NOT unreadable: it starts fresh and saves', async () => {
  const srv = fakeServer();
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.equal(store.readOnly, false);
  assert.deepEqual(srv.puts.sort(), ['index', 'profile']);
});

test('SAFETY: damaged browser-storage data is set aside, not overwritten', async () => {
  const storage = memStorage();
  storage.setItem('unfurl.profile', '{"schema":2,"library":{');
  const store = await new Store({ fetchFn: async () => { throw new Error('down'); }, storage }).init();
  assert.ok([...storage.m.keys()].some((k) => k.startsWith('unfurl.profile.damaged-')), 'copy kept');
  assert.ok(store.notes.some((n) => /damaged/.test(n)), 'user told');
  assert.deepEqual(store.state.library, {});
});

test('a save that fails because the server is restarting is retried, not forgotten', async () => {
  const srv = fakeServer();
  let down = false;
  const flaky = async (url, opts) => { if (down && opts?.method === 'PUT') throw new Error('connection refused'); return srv.fetchFn(url, opts); };
  const store = await new Store({ fetchFn: flaky, retryBaseMs: 20 }).init();
  const states = [];
  store.onSaveState = (ok) => states.push(ok);
  addToLibrary(store.state, 'abc12345678');
  down = true;
  assert.equal(await store.flush(), false, 'reports that it did not get stored');
  assert.match(store.lastError, /Couldn’t save to the server/);
  assert.equal(srv.db.profile.library?.abc12345678, undefined, 'nothing reached the server yet');
  assert.deepEqual(states, [false], 'the page is told, once');
  down = false;
  for (let i = 0; i < 50 && !srv.db.profile.library?.abc12345678; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(srv.db.profile.library.abc12345678, 'the background retry stored it once the server was back');
  assert.equal(store.lastError, null);
  assert.deepEqual(states, [false, true], 'and the page is told it recovered');
});

test('flushReliably waits out a short outage, and says false if the server never comes back', async () => {
  const srv = fakeServer();
  let failures = 3;
  const flaky = async (url, opts) => { if (opts?.method === 'PUT' && failures > 0) { failures--; throw new Error('down'); } return srv.fetchFn(url, opts); };
  const store = await new Store({ fetchFn: flaky, retryBaseMs: 20 }).init();
  addToLibrary(store.state, 'def12345678');
  assert.equal(await store.flushReliably(3000), true);
  assert.ok(srv.db.profile.library.def12345678);
  const dead = await new Store({ fetchFn: srv.fetchFn, retryBaseMs: 20 }).init();
  dead.fetchFn = async () => { throw new Error('gone'); };
  addToLibrary(dead.state, 'ghi12345678');
  assert.equal(await dead.flushReliably(150), false);
  clearTimeout(dead.retryTimer);
});
