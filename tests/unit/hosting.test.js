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
legacy = "pbkdf2_sha256$" + h.split(":", 1)[1].replace(":", "$")
print(int(serve.check_password(h, "correct horse")), int(serve.check_password(h, "wrong")), int(serve.check_password("plain", "plain")), int(serve.check_password("plain", "plaiN")), int(serve.check_password("pbkdf2-sha256:x:y", "z")), int(serve.check_password(legacy, "correct horse")))
print(h.split(":")[0], "$" in h)`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [flags, scheme] = r.stdout.trim().split('\n');
  assert.equal(flags, '1 0 1 0 0 1', 'right/wrong/plain/malformed, and the older $-separated spelling still works');
  assert.equal(scheme, 'pbkdf2-sha256 False', 'the hash contains no $, which docker compose and shells would mangle');
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
for n in ["ana", "../../etc", "a/b", "..", "", "Jörg Müller", "x"*200, "Ana"]:
    print(serve.safe_user_dir(n))`;
  const out = spawnSync('python3', ['-c', py], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.equal(out[0], 'ana', 'a plain name is used as it is');
  for (const n of out) assert.match(n, /^[A-Za-z0-9._-]{1,64}$/);
  assert.ok(!out.some((n) => n.includes('/') || n === '..' || n === '.'));
  assert.equal(new Set(out).size, out.length, 'different logins never share a folder');
  const clash = spawnSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)}); import serve; print(serve.safe_user_dir("a b"), serve.safe_user_dir("a_b"), serve.safe_user_dir("Ana"), serve.safe_user_dir("ana"))`], { encoding: 'utf8' }).stdout.trim().split(' ');
  assert.equal(new Set(clash).size, 4, `look-alike names stay apart: ${clash}`);
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
    const folder = fs.readdirSync(path.join(s.dataDir, 'users')).find((n) => n.startsWith('dana_example.com-'));
    assert.ok(folder && fs.existsSync(path.join(s.dataDir, 'users', folder, 'profile.json')), `per-person folder: ${fs.readdirSync(path.join(s.dataDir, 'users'))}`);
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

test('encoded "../" can never climb out of the public folders (this once served serve.py and the data folder)', async () => {
  const s = await start({ env: { UNFURL_AUTH: 'me:pw-pw-pw' } });
  const auth = { Authorization: basic('me', 'pw-pw-pw') };
  try {
    const attempts = [
      '/css/%2e%2e/serve.py', '/css/%2E%2E/serve.py', '/css/..%2fserve.py', '/css/..%2Fserve.py', '/js/%2e%2e/%2e%2e/etc/passwd',
      '/css/%252e%252e/serve.py', '/css/%252e%252e%252fserve.py', '/%2e%2e/serve.py', '/css/%5c..%5cserve.py', '/css/..%00/serve.py',
      '/css/%2e%2e/deploy/update.sh', '/css/%2e%2e/.git/config', '/js/%2e%2e/tests/unit/server.test.js', '/css/%2e%2e/userdata/config.json',
      '/serve.py', '/deploy/update.sh', '/.git/config', '/BUILD', '/package.json', '//serve.py', '/./serve.py', '/css/../serve.py',
    ];
    for (const p of attempts) {
      for (const method of ['GET', 'HEAD']) {
        const r = await raw(s.port, { method, path: p, headers: { Host: `127.0.0.1:${s.port}`, ...auth } });
        assert.equal(r.status, 404, `${method} ${p} must not be served (got ${r.status})`);
        assert.ok(!r.text.includes('class Handler') && !r.text.includes('Unfurl\'s small server'), `${p} leaked source`);
      }
    }
    for (const ok of ['/', '/index.html', '/css/style.css', '/js/app.js', '/data/suggestions.js', '/favicon.svg', '/js/views/today.js']) {
      assert.equal((await raw(s.port, { path: ok, headers: { Host: `127.0.0.1:${s.port}`, ...auth } })).status, 200, `${ok} still works`);
    }
  } finally { s.stop(); }
});


test('an empty or malformed UNFURL_AUTH is refused outright (it used to log in with an empty password)', async () => {
  for (const bad of ['me:', ':pw', 'justaname']) {
    const s = await start({ env: { UNFURL_AUTH: bad }, expectExit: true });
    assert.notEqual(s.code, 0, `UNFURL_AUTH=${bad}`);
    assert.match(s.err(), /UNFURL_AUTH must look like/, bad);
  }
  const unset = await start({ env: { UNFURL_AUTH: '' } });   // genuinely unset: no login, loopback only: fine
  try { assert.equal((await unset.call({ path: '/api/ping' })).status, 200); } finally { unset.stop(); }
});

test('a login proxy can be required to prove itself with a shared secret, not just by address', async () => {
  const s = await start({ env: { UNFURL_TRUST_PROXY_USER: 'X-Forwarded-User', UNFURL_PROXY_SECRET: 'proxy-secret-1' } });
  try {
    const hdr = { 'X-Forwarded-User': 'dana' };
    assert.equal((await s.call({ path: '/api/ping', headers: hdr })).status, 403, 'right address, no secret');
    assert.equal((await s.call({ path: '/api/ping', headers: { ...hdr, 'X-Unfurl-Proxy-Secret': 'guess' } })).status, 403);
    const ok = await s.call({ path: '/api/ping', headers: { ...hdr, 'X-Unfurl-Proxy-Secret': 'proxy-secret-1' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user, 'dana');
  } finally { s.stop(); }
});

test('repeat requests from a logged-in browser do not re-run the slow password hash every time', async () => {
  const hashed = spawnSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)}); import serve; print(serve.hash_password("pw-pw-pw", iterations=300000))`], { encoding: 'utf8' }).stdout.trim();
  const s = await start({ env: { UNFURL_AUTH: `me:${hashed}` } });
  try {
    const auth = { Authorization: basic('me', 'pw-pw-pw') };
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) assert.equal((await s.call({ path: '/api/ping', headers: auth })).status, 200);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 2500, `40 requests took ${elapsed} ms (an uncached 300,000-round hash each would take many seconds)`);
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('me', 'wrong') } })).status, 401, 'a wrong password is still refused');
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('nobody', 'pw-pw-pw') } })).status, 401);
  } finally { s.stop(); }
});

test('profile saves are checked against the version the page last saw (409 + the current data when it moved on)', async () => {
  const s = await start();
  try {
    const put = (body, ifMatch) => s.call({ method: 'PUT', path: '/api/profile', headers: { 'Content-Type': 'application/json', ...(ifMatch === undefined ? {} : { 'If-Match': ifMatch }) }, body });
    const first = await put({ schema: 2, n: 1 }, 'none');
    assert.equal(first.status, 200);
    const rev1 = first.json.rev;
    assert.match(rev1, /^[0-9a-f]{16}$/);
    assert.equal((await s.call({ path: '/api/profile' })).json.rev, rev1, 'GET reports the same revision');
    const second = await put({ schema: 2, n: 2 }, rev1);
    assert.equal(second.status, 200);
    assert.notEqual(second.json.rev, rev1);
    const stale = await put({ schema: 2, n: 99 }, rev1);                      // a tab that never saw n:2
    assert.equal(stale.status, 409);
    assert.equal(stale.json.data.n, 2, 'the conflict response carries what is really saved');
    assert.equal(stale.json.rev, second.json.rev);
    assert.equal((await s.call({ path: '/api/profile' })).json.data.n, 2, 'and nothing was overwritten');
    assert.equal((await put({ schema: 2, n: 3 })).status, 200, 'a save without If-Match (reset, restore, older pages) is still allowed');
    assert.equal((await put({ schema: 2, n: 4 }, 'none')).status, 409, '"I expect no file" is wrong once there is one');
  } finally { s.stop(); }
});

test('manual snapshots are capped, so pressing a button forever cannot fill the disk; upgrade backups are never pruned', async () => {
  const s = await start();
  try {
    await s.call({ method: 'PUT', path: '/api/profile', headers: { 'Content-Type': 'application/json' }, body: { schema: 1, n: 0 } });
    await s.call({ method: 'PUT', path: '/api/profile', headers: { 'Content-Type': 'application/json' }, body: { schema: 2, n: 1 } });   // makes a pre-schema backup
    for (let i = 0; i < 32; i++) await s.call({ method: 'POST', path: '/api/backups/snapshot', headers: { 'Content-Type': 'application/json' }, body: { label: `snap${i}` } });
    const names = fs.readdirSync(path.join(s.dataDir, 'backups'));
    const snaps = names.filter((n) => /^profile-snap\d+-/.test(n));
    assert.ok(snaps.length <= 25, `${snaps.length} snapshots kept`);
    assert.ok(names.some((n) => /^profile-pre-schema1-to-2-/.test(n)), 'the upgrade backup is still there');
    assert.ok(names.some((n) => /^profile-\d{4}-\d\d-\d\d\.json$/.test(n)), 'and the daily one');
    assert.ok(!names.some((n) => n.endsWith('.tmp')), 'no half-written leftovers');
    for (const n of names) JSON.parse(fs.readFileSync(path.join(s.dataDir, 'backups', n), 'utf8'));   // every backup is complete, valid JSON
  } finally { s.stop(); }
});

test('odd request bodies get an answer, not a dropped connection', async () => {
  const s = await start();
  try {
    for (const body of ['[]', '"x"', '12', 'null']) {
      const snap = await s.call({ method: 'POST', path: '/api/backups/snapshot', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(snap.status, 200, `snapshot with ${body}`);
      const rest = await s.call({ method: 'POST', path: '/api/backups/restore', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(rest.status, 400, `restore with ${body}`);
    }
  } finally { s.stop(); }
});

test('/healthz answers HEAD as well as GET, with no login', async () => {
  const s = await start({ env: { UNFURL_AUTH: 'me:pw-pw-pw' } });
  try {
    assert.equal((await raw(s.port, { method: 'HEAD', path: '/healthz', headers: { Host: `127.0.0.1:${s.port}` } })).status, 200);
    assert.equal((await raw(s.port, { method: 'GET', path: '/healthz', headers: { Host: `127.0.0.1:${s.port}` } })).status, 200);
  } finally { s.stop(); }
});

test('with several users, existing single-user data is flagged at startup instead of silently ignored', async () => {
  const dataDir = tmp('upgrade-multi');
  fs.writeFileSync(path.join(dataDir, 'profile.json'), JSON.stringify({ schema: 2, library: {} }));
  const users = path.join(tmp('uf'), 'users.txt');
  fs.writeFileSync(users, 'ana:ana-pass\nben:ben-pass\n');
  const s = await start({ dataDir, env: { UNFURL_USERS_FILE: users } });
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.match(s.err(), /holds data from a single-user setup/);
    assert.match(s.err(), /UNFURL_ADOPT_ROOT_DATA_FOR/, 'and says how to keep it');
  } finally { s.stop(); }
});

test('behind a login, names that can only exist on a private network work without being listed; public-looking names still must be', async () => {
  const s = await start({ env: { UNFURL_AUTH: 'me:pw-pw-pw', UNFURL_ALLOWED_HOSTS: 'unfurl.example.org,*.fritz.box', __host: 'x' } });
  const auth = { Authorization: basic('me', 'pw-pw-pw') };
  const status = async (host, extra = {}) => (await raw(s.port, { path: '/api/ping', headers: { Host: host, 'X-Unfurl': '1', ...auth, ...extra } })).status;
  try {
    for (const ok of ['192.168.1.50', '192.168.1.50:80', '10.0.0.7:8765', '[fe80::1]:8765', 'MYPC', 'mypc:8765', 'MyPc.local', 'nas.lan:8765', 'printer.home.arpa', 'unfurl.example.org', 'pc.fritz.box:80', 'localhost']) {
      assert.equal(await status(ok), 200, `${ok} should be accepted`);
    }
    for (const bad of ['evil.example', 'evil.example:8765', 'unfurl.example.org.evil.example', 'notfritz.box', 'fritz.box.evil.example', '']) {
      assert.equal(await status(bad), 403, `${JSON.stringify(bad)} should be refused`);
    }
    assert.equal(await status('MYPC', { Origin: 'https://evil.example' }), 403, 'a page from a public site still cannot use it, even via a good name');
    assert.equal(await status('MYPC', { Origin: 'http://mypc' }), 200);
  } finally { s.stop(); }
});

test('without a login the strict list still applies (private names are NOT automatically trusted on an open server)', async () => {
  const s = await start({ env: { __host: '127.0.0.1' } });
  try {
    assert.equal((await raw(s.port, { path: '/api/ping', headers: { Host: `127.0.0.1:${s.port}`, 'X-Unfurl': '1' } })).status, 200);
    assert.equal((await raw(s.port, { path: '/api/ping', headers: { Host: `mypc:${s.port}`, 'X-Unfurl': '1' } })).status, 403);
    assert.equal((await raw(s.port, { path: '/api/ping', headers: { Host: `192.168.1.50:${s.port}`, 'X-Unfurl': '1' } })).status, 403);
  } finally { s.stop(); }
});

test('a refused name is explained in the answer, so the page can tell the person what to do', async () => {
  const s = await start({ env: { UNFURL_AUTH: 'me:pw-pw-pw', UNFURL_ALLOWED_HOSTS: 'unfurl.example.org' } });
  try {
    const auth = { Authorization: basic('me', 'pw-pw-pw'), 'X-Unfurl': '1' };
    const r = await raw(s.port, { path: '/api/ping', headers: { Host: 'sneaky.example:80', ...auth } });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: 'forbidden', reason: 'host', host: 'sneaky.example:80', allowed: ['unfurl.example.org'] });
    const noHeader = await raw(s.port, { path: '/api/ping', headers: { Host: '192.168.1.5', Authorization: auth.Authorization } });
    assert.equal(noHeader.json.reason, 'header');
  } finally { s.stop(); }
});

test('a server can listen on port 80 and be reached without typing a port', async () => {
  // (port 80 itself may not be allowed in a test sandbox; the Host header without a port is what matters)
  const s = await start({ env: { UNFURL_AUTH: 'me:pw-pw-pw', UNFURL_ALLOWED_HOSTS: 'mypc' } });
  try {
    const r = await raw(s.port, { path: '/api/ping', headers: { Host: 'mypc', 'X-Unfurl': '1', Authorization: basic('me', 'pw-pw-pw') } });
    assert.equal(r.status, 200);
    assert.equal((await raw(s.port, { path: '/', headers: { Host: '192.168.1.50', Authorization: basic('me', 'pw-pw-pw') } })).status, 200);
  } finally { s.stop(); }
});

test('a second copy on the same port refuses to start and says why (on Windows two programs could otherwise share a port silently)', async () => {
  const first = await start();
  try {
    const second = await new Promise((resolve) => {
      const proc = spawn('python3', [SERVE, '--port', String(first.port), '--no-open', '--data-dir', tmp('dup'), '--legacy-dir', tmp('legacy')], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = ''; proc.stderr.on('data', (d) => { err += d; });
      proc.on('exit', (code) => resolve({ code, err }));
    });
    assert.notEqual(second.code, 0);
    assert.match(second.err, /already being used by another program/);
    assert.match(second.err, /Docker/);
    assert.equal((await first.call({ path: '/api/ping' })).status, 200, 'the first copy is unharmed');
  } finally { first.stop(); }
});

test('names typed into UNFURL_HOST (the listen address) are caught with an explanation', async () => {
  const s = await start({ env: { UNFURL_HOST: 'OLYMPUS,192.168.1.127', UNFURL_AUTH: 'me:pw-pw-pw' }, expectExit: true });
  assert.notEqual(s.code, 0);
  assert.match(s.err(), /UNFURL_HOST is the single address the server listens on/);
  assert.match(s.err(), /UNFURL_ALLOWED_HOSTS/);
});

test('the "no login" message also warns that the last assignment in a settings file wins', async () => {
  const s = await start({ args: ['--host', '0.0.0.0'], expectExit: true });
  assert.match(s.err(), /LAST one wins/);
});

test('UNFURL_USERS gives several people logins in one setting, plain or hashed, each with their own library', async () => {
  const hashed = spawnSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)}); import serve; print(serve.hash_password("ben-long-passphrase", iterations=2000))`], { encoding: 'utf8' }).stdout.trim();
  const dataDir = tmp('multi-env');
  const s = await start({ dataDir, env: { UNFURL_USERS: `anna:anna-long-passphrase;ben:${hashed}\n  cara : cara-long-passphrase `.replace('cara :', 'cara:') } });
  try {
    const login = (u, p) => ({ Authorization: basic(u, p) });
    assert.equal((await s.call({ path: '/api/ping', headers: login('anna', 'anna-long-passphrase') })).json.user, 'anna');
    assert.equal((await s.call({ path: '/api/ping', headers: login('ben', 'ben-long-passphrase') })).json.user, 'ben');
    assert.equal((await s.call({ path: '/api/ping', headers: login('cara', 'cara-long-passphrase') })).json.user, 'cara');
    assert.equal((await s.call({ path: '/api/ping', headers: login('ben', hashed) })).status, 401, 'the hash is not a password');
    assert.equal((await s.call({ path: '/api/ping', headers: login('anna', 'ben-long-passphrase') })).status, 401);
    for (const [u, p] of [['anna', 'anna-long-passphrase'], ['ben', 'ben-long-passphrase']]) {
      await s.call({ method: 'PUT', path: '/api/profile', headers: { ...login(u, p), 'Content-Type': 'application/json' }, body: { schema: 2, owner: u } });
    }
    assert.equal((await s.call({ path: '/api/profile', headers: login('anna', 'anna-long-passphrase') })).json.data.owner, 'anna');
    assert.equal((await s.call({ path: '/api/profile', headers: login('ben', 'ben-long-passphrase') })).json.data.owner, 'ben');
    assert.equal((await s.call({ path: '/api/ping', headers: login('anna', 'anna-long-passphrase') })).json.multiUser, true);
  } finally { s.stop(); }
});

test('UNFURL_USERS and UNFURL_AUTH work together (you plus your friends)', async () => {
  const s = await start({ env: { UNFURL_AUTH: 'me:my-long-passphrase', UNFURL_USERS: 'friend:friend-long-passphrase' } });
  try {
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('me', 'my-long-passphrase') } })).json.user, 'me');
    assert.equal((await s.call({ path: '/api/ping', headers: { Authorization: basic('friend', 'friend-long-passphrase') } })).json.user, 'friend');
  } finally { s.stop(); }
});

test('a malformed UNFURL_USERS entry stops the server with a clear message instead of leaving someone without a password', async () => {
  for (const bad of ['anna:ok-passphrase;ben', 'anna:ok-passphrase;ben:', ':nobody']) {
    const s = await start({ env: { UNFURL_USERS: bad }, expectExit: true });
    assert.notEqual(s.code, 0, bad);
    assert.match(s.err(), /UNFURL_USERS has an entry that doesn't look like/, bad);
  }
});

test('moving from one shared login to several: UNFURL_ADOPT_ROOT_DATA_FOR gives the existing library to one person, once, by copying', async () => {
  const dataDir = tmp('adopt');
  fs.writeFileSync(path.join(dataDir, 'profile.json'), JSON.stringify({ schema: 2, owner: 'old-me', library: {} }));
  fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify({ videos: { a: 1 } }));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ apiKey: 'MY-KEY' }));
  const env = { UNFURL_AUTH: 'me:my-long-passphrase', UNFURL_USERS: 'friend:friend-long-passphrase', UNFURL_ADOPT_ROOT_DATA_FOR: 'me' };
  const first = await start({ dataDir, env });
  try {
    const mine = await s_get(first, 'me', 'my-long-passphrase');
    assert.equal(mine.profile.data.owner, 'old-me', 'my library came along');
    assert.equal(mine.config.apiKey, 'MY-KEY', 'and my YouTube key');
    const friend = await s_get(first, 'friend', 'friend-long-passphrase');
    assert.equal(friend.profile.data, null, 'the friend starts empty and sees none of it');
    assert.ok(fs.existsSync(path.join(dataDir, 'profile.json')), 'the originals are still where they were');
    assert.match(first.out(), /Gave the existing data/);
    if (process.platform !== 'win32') assert.equal((fs.statSync(path.join(dataDir, 'users', 'me', 'config.json')).mode & 0o777).toString(8), '600');
    await first.call({ method: 'PUT', path: '/api/profile', headers: { Authorization: basic('me', 'my-long-passphrase'), 'Content-Type': 'application/json' }, body: { schema: 2, owner: 'new-me' } });
  } finally { first.stop(); }
  await new Promise((r) => setTimeout(r, 300));
  const again = await start({ dataDir, env });
  try {
    assert.equal((await s_get(again, 'me', 'my-long-passphrase')).profile.data.owner, 'new-me', 'a restart never overwrites what they have done since');
  } finally { again.stop(); }

  const wrong = await start({ dataDir: tmp('adopt2'), env: { ...env, UNFURL_ADOPT_ROOT_DATA_FOR: 'nobody' }, expectExit: true });
  assert.notEqual(wrong.code, 0);
  assert.match(wrong.err(), /not one of the logins/);
});

async function s_get(server, user, pass) {
  const h = { Authorization: basic(user, pass) };
  return { profile: (await server.call({ path: '/api/profile', headers: h })).json, config: (await server.call({ path: '/api/config', headers: h })).json ?? {} };
}
