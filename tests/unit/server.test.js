// Integration tests for serve.py's storage layer (needs python3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = { 'X-Unfurl': '1' };
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `unfurl-${p}-`));

async function start({ dataDir = tmp('data'), legacyDir = tmp('legacy') } = {}) {
  const port = await freePort();
  const proc = spawn('python3', [path.join(ROOT, 'serve.py'), '--port', String(port), '--no-open', '--data-dir', dataDir, '--legacy-dir', legacyDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/ping`, { headers: H })).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const api = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { ...H, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { base, port, dataDir, legacyDir, api, out: () => out, stop: () => proc.kill() };
}

test('ping reports version and where the data lives', async () => {
  const s = await start();
  try {
    const { json } = await s.api('GET', '/api/ping');
    assert.equal(json.app, 'unfurl');
    assert.match(json.version, /^\d+\.\d+\.\d+$/);
    assert.equal(fs.realpathSync(json.dataDir), fs.realpathSync(s.dataDir));
  } finally { s.stop(); }
});

test('profile/index/config round-trip; config is private (0600) and kept apart from the profile', async () => {
  const s = await start();
  try {
    assert.deepEqual((await s.api('GET', '/api/profile')).json, { data: null, recoveredFrom: null, rev: null });
    await s.api('PUT', '/api/profile', { schema: 2, history: [1] });
    await s.api('PUT', '/api/index', { videos: { a: 1 } });
    await s.api('PUT', '/api/config', { apiKey: 'SECRET' });
    assert.deepEqual((await s.api('GET', '/api/profile')).json.data, { schema: 2, history: [1] });
    assert.deepEqual((await s.api('GET', '/api/index')).json, { videos: { a: 1 } });
    assert.equal((await s.api('GET', '/api/config')).json.apiKey, 'SECRET');
    if (process.platform !== 'win32') assert.equal((fs.statSync(path.join(s.dataDir, 'config.json')).mode & 0o777).toString(8), '600');
    assert.ok(!fs.readFileSync(path.join(s.dataDir, 'profile.json'), 'utf8').includes('SECRET'));
  } finally { s.stop(); }
});

test('a daily backup is taken before overwriting, and a dedicated one before a data-format change', async () => {
  const s = await start();
  try {
    await s.api('PUT', '/api/profile', { schema: 1, n: 1 });
    await s.api('PUT', '/api/profile', { schema: 1, n: 2 });
    let b = (await s.api('GET', '/api/backups')).json;
    assert.equal(b.length, 1, 'one daily backup');
    assert.match(b[0].name, /^profile-\d{4}-\d\d-\d\d\.json$/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'backups', b[0].name), 'utf8')).n, 1, 'holds the state from BEFORE the day\'s later writes');
    await s.api('PUT', '/api/profile', { schema: 2, n: 3 });
    b = (await s.api('GET', '/api/backups')).json;
    const pre = b.find((x) => /pre-schema1-to-2/.test(x.name));
    assert.ok(pre, `pre-migration backup exists: ${b.map((x) => x.name)}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'backups', pre.name), 'utf8')).n, 2);
  } finally { s.stop(); }
});

test('a corrupt profile is quarantined (not deleted) and the newest good backup is restored', async () => {
  const s = await start();
  try {
    await s.api('PUT', '/api/profile', { schema: 2, n: 1 });
    await s.api('PUT', '/api/profile', { schema: 2, n: 2 });  // makes the daily backup (n:1)
    fs.writeFileSync(path.join(s.dataDir, 'profile.json'), '{"schema": 2, "n": ');  // simulate a crash mid-write
    const r = (await s.api('GET', '/api/profile')).json;
    assert.equal(r.data.n, 1);
    assert.match(r.recoveredFrom, /^profile-/);
    assert.ok(fs.readdirSync(s.dataDir).some((f) => f.startsWith('profile.corrupt-')), 'corrupt file kept for inspection');
    assert.equal((await s.api('GET', '/api/profile')).json.recoveredFrom, null, 'only reported once');
  } finally { s.stop(); }
});

test('restore from a listed backup works, keeps what it replaces, and rejects anything else', async () => {
  const s = await start();
  try {
    await s.api('PUT', '/api/profile', { schema: 2, n: 1 });
    await s.api('PUT', '/api/profile', { schema: 2, n: 2 });
    const name = (await s.api('GET', '/api/backups')).json[0].name;
    assert.equal((await s.api('POST', '/api/backups/restore', { name })).status, 200);
    assert.equal((await s.api('GET', '/api/profile')).json.data.n, 1);
    assert.ok((await s.api('GET', '/api/backups')).json.some((b) => b.name.startsWith('profile-before-restore-')));
    for (const bad of ['../config.json', '../../etc/passwd', 'profile-x/../../config.json', 'config.json', 'profile-nope.json']) {
      assert.equal((await s.api('POST', '/api/backups/restore', { name: bad })).status, 400, bad);
    }
  } finally { s.stop(); }
});

test('first run with a new data folder adopts (copies) the old ./userdata files', async () => {
  const legacyDir = tmp('legacy');
  fs.writeFileSync(path.join(legacyDir, 'state.json'), JSON.stringify({ version: 1, history: [{ id: 'h1' }] }));
  fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ apiKey: 'OLDKEY' }));
  const s = await start({ legacyDir });
  try {
    assert.match(s.out(), /Copied your existing data/);
    assert.equal((await s.api('GET', '/api/legacy')).json.history[0].id, 'h1');
    assert.equal((await s.api('GET', '/api/config')).json.apiKey, 'OLDKEY');
    assert.ok(fs.existsSync(path.join(legacyDir, 'state.json')), 'originals left in place');
    // first profile write archives the v1 file out of the way
    await s.api('PUT', '/api/profile', { schema: 2 });
    assert.equal((await s.api('GET', '/api/legacy')).json, null);
    assert.ok(fs.existsSync(path.join(s.dataDir, 'backups', 'profile-legacy-state-v1.json')));
  } finally { s.stop(); }
});

test('existing data in the new folder is never overwritten by the legacy copy', async () => {
  const legacyDir = tmp('legacy'), dataDir = tmp('data');
  fs.writeFileSync(path.join(legacyDir, 'state.json'), '{"old":true}');
  fs.writeFileSync(path.join(dataDir, 'profile.json'), '{"schema":2,"mine":true}');
  const s = await start({ legacyDir, dataDir });
  try {
    assert.doesNotMatch(s.out(), /Copied/);
    assert.equal((await s.api('GET', '/api/profile')).json.data.mine, true);
  } finally { s.stop(); }
});

test('access rules: needs the header, matching Host/Origin, no preflights, only app files are served', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/api/profile`)).status, 403);
    assert.equal((await fetch(`${s.base}/api/profile`, { headers: { ...H, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${s.base}/api/profile`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 405);
    assert.equal((await fetch(`${s.base}/api/profile`, { method: 'PUT', headers: H, body: 'not json' })).status, 400);
    for (const p of ['/serve.py', '/package.json', '/.git/config', '/tests/unit/server.test.js', '/userdata/config.json', '/css/']) {
      assert.equal((await fetch(s.base + p)).status, 404, p);
    }
    assert.equal((await fetch(`${s.base}/js/app.js`)).status, 200);
    assert.equal((await fetch(`${s.base}/`)).status, 200);
  } finally { s.stop(); }
});

test('default data dir is outside the app folder', async () => {
  const out = await new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)}); import serve; print(serve.default_data_dir())`], { env: { ...process.env, UNFURL_DATA: '', XDG_DATA_HOME: '' } });
    let o = ''; p.stdout.on('data', (d) => { o += d; }); p.on('close', () => resolve(o.trim()));
  });
  assert.ok(!out.startsWith(ROOT), out);
  assert.match(out, /unfurl|Unfurl/i);
  const viaEnv = await new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)}); import serve; print(serve.default_data_dir())`], { env: { ...process.env, UNFURL_DATA: '/tmp/my-unfurl-data' } });
    let o = ''; p.stdout.on('data', (d) => { o += d; }); p.on('close', () => resolve(o.trim()));
  });
  assert.equal(viaEnv, '/tmp/my-unfurl-data');
});

test('snapshot endpoint keeps a labelled copy of the profile (used before destructive actions)', async () => {
  const s = await start();
  try {
    assert.equal((await s.api('POST', '/api/backups/snapshot', { label: 'before-reset' })).json.name, null, 'nothing to copy yet');
    await s.api('PUT', '/api/profile', { schema: 2, precious: true });
    const { json } = await s.api('POST', '/api/backups/snapshot', { label: 'Before Reset!!../' });
    assert.match(json.name, /^profile-beforereset-\d{8}-\d{6}\.json$/, json.name);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'backups', json.name), 'utf8')).precious, true);
    await s.api('PUT', '/api/profile', { schema: 2, precious: false });
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'backups', json.name), 'utf8')).precious, true, 'later writes do not alter it');
  } finally { s.stop(); }
});

test('the bundled font is served as a font and may be cached; everything else is never cached (the app updates itself)', async () => {
  const s = await start();
  try {
    const font = await fetch(`${s.base}/css/fonts/inter-latin-wght-normal.woff2`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.match(font.headers.get('cache-control'), /max-age=\d+/);
    assert.equal((await font.arrayBuffer()).byteLength, fs.statSync(path.join(ROOT, 'css/fonts/inter-latin-wght-normal.woff2')).size);
    for (const p of ['/', '/js/app.js', '/css/style.css', '/favicon.svg']) assert.equal((await fetch(s.base + p)).headers.get('cache-control'), 'no-store', p);
    assert.equal((await fetch(`${s.base}/css/fonts/../../serve.py`)).status, 404);
  } finally { s.stop(); }
});
