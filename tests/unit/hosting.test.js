// Hosting features of serve.py: logins, allowed hosts, per-user folders, proxy-user trust, the shared YouTube key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVE = path.join(ROOT, 'serve.py');
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `unfurl-${p}-`));
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

// Node's fetch refuses to set Host/Origin freely, so talk HTTP directly when a test needs to.
function raw(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  if (payload !== undefined) headers = { ...headers, 'Content-Length': Buffer.byteLength(payload) };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers, setHost: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function start({ env = {}, args = [], dataDir = tmp('host'), expectExit = false } = {}) {
  const port = await freePort();
  const proc = spawn('python3', [SERVE, '--port', String(port), '--no-open', '--data-dir', dataDir, '--legacy-dir', tmp('legacy'), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, UNFURL_BUILD: 'test-build', ...env },
  });
  let out = '', err = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((r) => proc.on('exit', (code) => r(code)));
  if (expectExit) return { code: await exited, out: () => out, err: () => err };
  for (let i = 0; i < 80; i++) {
    try { await raw(port, { path: '/', headers: { Host: `127.0.0.1:${port}` } }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const host = env.__host || `127.0.0.1:${port}`;
  const call = (opts = {}) => raw(port, { ...opts, headers: { Host: host, 'X-Unfurl': '1', ...(opts.headers || {}) } });
  return { port, dataDir, call, out: () => out, err: () => err, stop: () => proc.kill() };
}

test('--hash-password style hashes verify, and wrong passwords do not', () => {
  const py = `
import sys; sys.path.insert(0, ${JSON.stringify(ROOT)})
import serve
h = serve.hash_password("correct horse", iterations=1000)
print(int(serve.check_password(h, "correct horse")), int(serve.check_password(h, "wrong")), int(serve.check_password("plain", "plain")), int(serve.check_password("plain", "plaiN")), int(serve.check_password("pbkdf2_sha256$x$y", "z")))
print(h.split("$")[0])`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [flags, scheme] = r.stdout.trim().split('\n');
  assert.equal(flags, '1 0 1 0 0');
  assert.equal(scheme, 'pbkdf2_sha256');
});

test('refuses to listen on the network without any login, and says how to fix it', async () => {
  const s = await start({ args: ['--host', '0.0.0.0'], expectExit: true });
  assert.notEqual(s.code, 0);
  assert.match(s.err(), /Refusing to listen/);
  assert.match(s.err(), /UNFURL_AUTH/);
});

test('listening on the network is fine once a login is configured; wrong or missing logins are refused', async () => {
  const s = await start({ env: { UNFURL_HOST: '127.0.0.1', UNFURL_AUTH: 'me:s3cret-pass' } });
  try {
    const anon = await s.call({ path: '/api/ping' });
    assert.equal(anon.status, 401);
    assert.match(anon.headers['www-authenticate'], /^Basic /);
    assert.equal((await s.call({ path: '/' , headers: {} })).status, 401, 'the app itself needs the login too');
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('me', 'nope') } })).status, 401);
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('you', 's3cret-pass') } })).status, 401);
    const ok = await s.call({ path: '/api/ping', headers: { Authorization: basic('me', 's3cret-pass') } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user, 'me');
    assert.equal(ok.json.build, 'test-build');
    assert.equal(ok.json.multiUser, false);
  } finally { s.stop(); }
});

test('a hashed password in UNFURL_AUTH works the same as a plain one', async () => {
  const hashed = spawnSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)}); import serve; print(serve.hash_password("pässwörd-ünï", iterations=2000))`], { encoding: 'utf8' }).stdout.trim();
  const s = await start({ env: { UNFURL_AUTH: `me:${hashed}` } });
  try {
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('me', 'pässwörd-ünï') } })).status, 200);
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('me', hashed) } })).status, 401, 'the hash itself is not a password');
  } finally { s.stop(); }
});

test('five wrong passwords lock that visitor out for a minute — even with the right password', async () => {
  const s = await start({ env: { UNFURL_AUTH: 'me:s3cret-pass' } });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('me', 'bad' + i) } })).status, 401);
    const locked = await s.call({ path: '/api/ping', headers: { Authorization: basic('me', 's3cret-pass') } });
    assert.equal(locked.status, 429);
  } finally { s.stop(); }
});

test('behind a trusted proxy the lock-out counts the visitor\'s real address, not the proxy\'s', async () => {
  const s = await start({ env: { UNFURL_AUTH: 'me:s3cret-pass' } });   // 127.0.0.1 is a trusted proxy by default
  try {
    const bad = (ip) => s.call({ path: '/api/ping', headers: { Authorization: basic('me', 'bad'), 'X-Forwarded-For': ip } });
    for (let i = 0; i < 5; i++) await bad('203.0.113.9');
    assert.equal((await bad('203.0.113.9')).status, 429, 'the attacker is locked out');
    const other = await s.call({ path: '/api/ping', headers: { Authorization: basic('me', 's3cret-pass'), 'X-Forwarded-For': '198.51.100.7' } });
    assert.equal(other.status, 200, 'someone else behind the same proxy is unaffected');
  } finally { s.stop(); }
});

test('only the names in UNFURL_ALLOWED_HOSTS reach the API (DNS-rebinding protection), and other websites are refused', async () => {
  const s = await start({ env: { UNFURL_ALLOWED_HOSTS: 'unfurl.internal,10.0.0.5', __host: 'unfurl.internal' } });
  try {
    assert.equal((await s.call({ path: '/api/ping' })).status, 200);
    assert.equal((await s.call({ path: '/api/ping', headers: { Host: 'unfurl.internal:8765' } })).status, 200, 'a port on an allowed name is fine');
    assert.equal((await s.call({ path: '/api/ping', headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await s.call({ path: '/api/ping', headers: { Origin: 'https://unfurl.internal' } })).status, 200, 'its own origin (via the https proxy) is fine');
    assert.equal((await s.call({ path: '/api/ping', headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await s.call({ path: '/api/ping', headers: { 'X-Unfurl': '' } })).status, 403, 'the app header is still required');
  } finally { s.stop(); }
});

test('several users each get their own library, and one can never read another\'s', async () => {
  const dataDir = tmp('multi');
  const users = path.join(tmp('usersfile'), 'users.txt');
  fs.writeFileSync(users, '# the household\nana:ana-pass\nben:ben-pass\n');
  const s = await start({ dataDir, env: { UNFURL_USERS_FILE: users } });
  try {
    const A = { Authorization: basic('ana', 'ana-pass') }, B = { Authorization: basic('ben', 'ben-pass') };
    assert.equal((await s.call({ method: 'GET', path: '/api/ping', headers: A })).json.multiUser, true);
    assert.equal((await s.call({ path: '/api/ping', headers: A })).json.dataDir, undefined, 'server paths are not shown to users');
    await s.call({ method: 'PUT', path: '/api/profile', headers: { ...A, 'Content-Type': 'application/json' }, body: { schema: 2, owner: 'ana' } });
    await s.call({ method: 'PUT', path: '/api/profile', headers: { ...B, 'Content-Type': 'application/json' }, body: { schema: 2, owner: 'ben' } });
    assert.equal((await s.call({ path: '/api/profile', headers: A })).json.data.owner, 'ana');
    assert.equal((await s.call({ path: '/api/profile', headers: B })).json.data.owner, 'ben');
    assert.ok(fs.existsSync(path.join(dataDir, 'users', 'ana', 'profile.json')));
    assert.ok(fs.existsSync(path.join(dataDir, 'users', 'ben', 'profile.json')));
    assert.ok(!fs.existsSync(path.join(dataDir, 'profile.json')), 'nothing lands in the shared root');
    // a hostile login name can't climb out of the users/ folder
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('../../etc', 'x') } })).status, 401);
  } finally { s.stop(); }
});

test('login names are turned into safe folder names', () => {
  const py = `
import sys; sys.path.insert(0, ${JSON.stringify(ROOT)})
import serve
for n in ["ana", "../../etc", "a/b", "..", "", "Jörg Müller", "x"*200]:
    print(serve.safe_user_dir(n))`;
  const out = spawnSync('python3', ['-c', py], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.equal(out[0], 'ana');
  for (const n of out) assert.match(n, /^[A-Za-z0-9._-]{1,64}$/);
  assert.ok(!out.some((n) => n.includes('/') || n === '..' || n === '.'));
});

test('with a login proxy in front, the user comes from its header — but only if the request really came from the proxy', async () => {
  const s = await start({ env: { UNFURL_TRUST_PROXY_USER: 'X-Forwarded-User' } });
  try {
    assert.equal((await s.call({ path: '/api/ping' })).status, 401, 'no user named by the proxy');
    const ok = await s.call({ path: '/api/ping', headers: { 'X-Forwarded-User': 'dana@example.com' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user, 'dana@example.com');
    assert.equal(ok.json.multiUser, true);
    await s.call({ method: 'PUT', path: '/api/profile', headers: { 'X-Forwarded-User': 'dana@example.com', 'Content-Type': 'application/json' }, body: { schema: 2, mine: true } });
    assert.ok(fs.existsSync(path.join(s.dataDir, 'users', 'dana_example.com', 'profile.json')));
  } finally { s.stop(); }
  // the same header from a machine that is NOT the proxy is ignored
  const strangers = await start({ env: { UNFURL_TRUST_PROXY_USER: 'X-Forwarded-User', UNFURL_PROXY_IPS: '10.99.0.0/16' } });
  try {
    assert.equal((await strangers.call({ path: '/api/ping', headers: { 'X-Forwarded-User': 'admin' } })).status, 403);
  } finally { strangers.stop(); }
});

test('without a key on the server the YouTube proxy says so; browsers are told the proxy is off', async () => {
  const s = await start();
  try {
    assert.equal((await s.call({ path: '/api/ping' })).json.ytProxy, false);
    assert.equal((await s.call({ path: '/api/yt/search?q=yoga' })).status, 404);
  } finally { s.stop(); }
});

// ---- the shared YouTube key
async function fakeYouTube() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    const u = new URL(req.url, 'http://x');
    if (u.searchParams.get('q') === 'boom') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 400, message: 'bad', errors: [{ reason: 'badRequest' }] } })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: [], echo: u.pathname, key: u.searchParams.get('key') }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${server.address().port}/youtube/v3`, close: () => server.close() };
}

test('shared YouTube key: the server adds it, strips any key the browser sent, and never reveals it', async () => {
  const yt = await fakeYouTube();
  const s = await start({ env: { UNFURL_YOUTUBE_KEY: 'SERVER-KEY', UNFURL_YT_UPSTREAM: yt.url } });
  try {
    assert.equal((await s.call({ path: '/api/ping' })).json.ytProxy, true);
    const r = await s.call({ path: '/api/yt/search?q=hip+stretch&key=BROWSER-KEY&part=snippet' });
    assert.equal(r.status, 200);
    assert.equal(r.json.echo, '/youtube/v3/search');
    assert.equal(r.json.key, 'SERVER-KEY');
    assert.ok(yt.seen[0].includes('q=hip+stretch') && yt.seen[0].includes('part=snippet'));
    assert.ok(!yt.seen[0].includes('BROWSER-KEY'));
    for (const route of ['/api/ping', '/api/config', '/api/profile']) assert.ok(!(await s.call({ path: route })).text.includes('SERVER-KEY'), `${route} must not leak the key`);
    assert.equal((await s.call({ path: '/api/yt/captions?videoId=x' })).status, 404, 'only the endpoints the app uses are forwarded');
    assert.equal((await s.call({ path: '/api/yt/../../etc/passwd' })).status, 404);
    const bad = await s.call({ path: '/api/yt/search?q=boom' });
    assert.equal(bad.status, 400, 'Google\'s own errors pass straight through');
    assert.equal(bad.json.error.errors[0].reason, 'badRequest');
  } finally { s.stop(); yt.close(); }
});

test('shared YouTube key: each person has a daily cap in quota units, with a Google-shaped quota error when it is used up', async () => {
  const yt = await fakeYouTube();
  const s = await start({ env: { UNFURL_AUTH: 'me:pw-pw-pw', UNFURL_YOUTUBE_KEY: 'K', UNFURL_YT_UPSTREAM: yt.url, UNFURL_USER_DAILY_UNITS: '205' } });
  try {
    const auth = { Authorization: basic('me', 'pw-pw-pw') };
    assert.equal((await s.call({ path: '/api/yt/search?q=a', headers: auth })).status, 200);   // 100
    assert.equal((await s.call({ path: '/api/yt/search?q=b', headers: auth })).status, 200);   // 200
    assert.equal((await s.call({ path: '/api/yt/videos?id=1', headers: auth })).status, 200);  // 201
    const blocked = await s.call({ path: '/api/yt/search?q=c', headers: auth });               // would be 301
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.errors[0].reason, 'quotaExceeded');
    assert.equal(yt.seen.length, 3, 'a refused call is never sent to YouTube');
    assert.equal((await s.call({ path: '/api/yt/videos?id=2', headers: auth })).status, 200, 'cheap calls still fit');
  } finally { s.stop(); yt.close(); }
});

test('a YouTube outage becomes a clear error, not a crash', async () => {
  const s = await start({ env: { UNFURL_YOUTUBE_KEY: 'K', UNFURL_YT_UPSTREAM: 'http://127.0.0.1:1/none' } });
  try {
    const r = await s.call({ path: '/api/yt/videos?id=1' });
    assert.equal(r.status, 502);
    assert.match(r.json.error.message, /couldn't reach YouTube/);
    assert.equal((await s.call({ path: '/api/ping' })).status, 200, 'the server keeps running');
  } finally { s.stop(); }
});

test('--selftest passes on this checkout and does not touch real data', () => {
  const r = spawnSync('python3', [SERVE, '--selftest'], { encoding: 'utf8', env: { ...process.env, UNFURL_DATA: tmp('selftest-must-stay-empty') } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest ok/);
  assert.deepEqual(fs.readdirSync(process.env.UNFURL_DATA || os.tmpdir()).filter((n) => n === 'profile.json'), []);
});

test('security headers are on every answer', async () => {
  const s = await start();
  try {
    for (const p of ['/', '/api/ping', '/js/app.js']) {
      const r = await s.call({ path: p });
      assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
      assert.equal(r.headers['x-frame-options'], 'DENY', p);
      assert.equal(r.headers['cache-control'], 'no-store', p);
      assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin', p);
    }
  } finally { s.stop(); }
});

test('the daily allowance survives a restart (every update restarts the server)', async () => {
  const yt = await fakeYouTube();
  const dataDir = tmp('usage');
  const env = { UNFURL_YOUTUBE_KEY: 'K', UNFURL_YT_UPSTREAM: yt.url, UNFURL_USER_DAILY_UNITS: '150' };
  const first = await start({ dataDir, env });
  try { assert.equal((await first.call({ path: '/api/yt/search?q=a' })).status, 200); } finally { first.stop(); }
  await new Promise((r) => setTimeout(r, 300));
  const second = await start({ dataDir, env });
  try {
    assert.equal((await second.call({ path: '/api/yt/search?q=b' })).status, 403, '100 of 150 units were already spent before the restart');
    assert.equal((await second.call({ path: '/api/yt/videos?id=1' })).status, 200, 'but small calls still fit');
    assert.equal((await second.call({ path: '/api/ping' })).json.ytDailyUnits, 150, 'the page is told its daily share');
  } finally { second.stop(); yt.close(); }
});
