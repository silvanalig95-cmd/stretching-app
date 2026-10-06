// The Windows helpers can't be run here, so check everything about them that CAN be checked:
// line endings (a batch file with bare LFs misbehaves; a shell script with CRs won't start in Docker),
// that the example settings really produce a working, login-protected server, and that the files they name exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const BATS = ['start.bat', 'start-network.bat', 'network-settings.example.bat', 'install-autostart.bat'];

test('batch files use Windows line endings throughout and plain ASCII', () => {
  for (const f of BATS) {
    const buf = read(f);
    const text = buf.toString('latin1');
    assert.ok(!/[^\r]\n/.test(text) && !/^\n/.test(text), `${f} has a bare LF`);
    assert.ok(text.includes('\r\n'), `${f} has CRLF`);
    assert.ok([...buf].every((b) => b < 128), `${f} is ASCII-only (cmd.exe reads it in the console code page)`);
  }
});

test('scripts that run on Linux (servers, Docker) never contain carriage returns', () => {
  const files = [...fs.readdirSync(path.join(ROOT, 'deploy')).filter((n) => /\.(sh|service)$|^Dockerfile$/.test(n)).map((n) => `deploy/${n}`), 'serve.py'];
  for (const f of files) assert.ok(!read(f).includes(13), `${f} contains a CR`);
});

test('.gitattributes pins both rules, so a Windows checkout cannot break either kind of file', () => {
  const attrs = read('.gitattributes').toString();
  assert.match(attrs, /^\*\.bat\s+text eol=crlf$/m);
  assert.match(attrs, /^\*\.sh\s+text eol=lf$/m);
  assert.match(attrs, /^Dockerfile\s+text eol=lf$/m);
});

test('start-network.bat only relies on files that exist, and refuses the placeholder password', () => {
  const bat = read('start-network.bat').toString();
  for (const f of ['serve.py', 'network-settings.example.bat']) {
    assert.ok(bat.includes(f) && fs.existsSync(path.join(ROOT, f)), f);
  }
  assert.match(bat, /find "CHANGE-THIS"/);
  assert.match(read('network-settings.example.bat').toString(), /CHANGE-THIS-PASSWORD/);
  assert.match(bat, /UNFURL_AUTO_PULL/);
  assert.match(bat, /python --version/);
  assert.match(bat, /py -3/);
  assert.match(read('install-autostart.bat').toString(), /start-network\.bat/);
});

/** Read a batch settings file the way cmd.exe would (set "NAME=value", %COMPUTERNAME% expanded). */
function parseSettings(file, vars) {
  const out = {};
  for (const line of read(file).toString().split(/\r?\n/)) {
    const m = line.match(/^set "([A-Z_]+)=(.*)"$/);
    if (m) out[m[1]] = m[2].replace(/%([A-Z_]+)%/g, (_, n) => vars[n] ?? `%${n}%`);
  }
  return out;
}

test('the example network settings start a server that demands a login and answers to the names in them', async () => {
  const s = parseSettings('network-settings.example.bat', { COMPUTERNAME: 'MYPC' });
  assert.equal(s.UNFURL_HOST, '0.0.0.0');
  assert.equal(s.UNFURL_ALLOWED_HOSTS, 'MYPC,192.168.1.50');
  const port = await freePort();
  const env = { ...process.env, ...s, UNFURL_AUTH: 'me:a-real-password', UNFURL_PORT: String(port), UNFURL_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'unfurl-win-')) };
  // the template's placeholder password must be refused by the launcher, not by the server; here we use a real one
  const proc = spawn('python3', [path.join(ROOT, 'serve.py'), '--no-open'], { env, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { await fetch(`http://127.0.0.1:${port}/healthz`); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.ok(up, 'server came up with the template settings');
    const get = (p, headers = {}) => new Promise((resolve, reject) => {
      import('node:http').then(({ default: http }) => {
        const req = http.request({ host: '127.0.0.1', port, path: p, headers, setHost: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject); req.end();
      });
    });
    const auth = { Authorization: `Basic ${Buffer.from('me:a-real-password').toString('base64')}`, 'X-Unfurl': '1' };
    assert.equal(await get('/', { Host: `MYPC:${port}` }), 401, 'a login is required from the network');
    assert.equal(await get('/api/ping', { ...auth, Host: `MYPC:${port}` }), 200, 'the PC name works (upper case, as Windows writes it)');
    assert.equal(await get('/api/ping', { ...auth, Host: `192.168.1.50:${port}` }), 200, 'so does its address');
    assert.equal(await get('/api/ping', { ...auth, Host: `192.168.1.77:${port}` }), 403, 'any other name is refused');
  } finally { proc.kill(); }
});

test('the Windows guide mentions every helper file and no file that does not exist', () => {
  const guide = read('deploy/WINDOWS.md').toString();
  for (const f of ['start.bat', 'start-network.bat', 'install-autostart.bat', 'network-settings.bat']) assert.ok(guide.includes(f), `${f} is explained`);
  for (const m of guide.matchAll(/`((?:deploy\/|deploy\\)[\w./\\-]+)`|(deploy[\\/][\w.-]+\.(?:yml|example|md))/g)) {
    const rel = (m[1] || m[2]).replace(/\\/g, '/').replace(/\.env$/, '.env.example');
    if (/unfurl\.env$|unfurl\.env\.example$/.test(rel)) continue;
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} exists`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'deploy/docker-compose.yml')));
});
