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
const BATS = ['start.bat', 'start-network.bat', 'network-settings.example.bat', 'install-autostart.bat', 'rebuild-docker.bat'];

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
    assert.equal(await get('/api/ping', { ...auth, Host: `192.168.1.77:${port}` }), 200, 'with a login on, any home-network number is fine without listing it');
    assert.equal(await get('/api/ping', { ...auth, Host: `evil.example:${port}` }), 403, 'but a public-looking name is refused');
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

test('the home-network setup defaults to port 80 (no ":8765" to type), and Docker publishes both 80 and 8765', () => {
  const settings = parseSettings('network-settings.example.bat', { COMPUTERNAME: 'MYPC' });
  assert.equal(settings.UNFURL_PORT, '80');
  const bat = read('start-network.bat').toString();
  assert.match(bat, /if "%UNFURL_PORT%"=="80" set "PORTSUFFIX="/);
  const compose = read('deploy/docker-compose.yml').toString();
  assert.match(compose, /- "80:8765"/);
  assert.match(compose, /- "8765:8765"/);
  assert.match(read('deploy/unfurl.service').toString(), /AmbientCapabilities=CAP_NET_BIND_SERVICE/);
});

test('rebuild-docker.bat only touches the recipe: it never reads or writes the settings file or the data, and honours the branch you set', () => {
  const bat = read('rebuild-docker.bat').toString();
  assert.match(bat, /findstr \/b "UNFURL_BRANCH=" deploy\\unfurl\.env/, 'reads only the branch from the settings');
  assert.ok(!/\b(del|erase|rmdir|rd)\b|compose[^\n]*\bdown\b|volume (rm|prune)|prune/i.test(bat), 'nothing destructive on the app folder or the volumes');
  assert.deepEqual([...bat.matchAll(/Remove-Item (\S+)/g)].map((m) => m[1]), ['$env:OUT'], 'the only thing it deletes is its own temporary download');
  assert.match(bat, /docker compose -f deploy\/docker-compose\.yml up -d --build/);
  assert.match(bat, /archive\/refs\/heads\/%BRANCH%\.zip/);
  const zipHasNoEnv = !fs.existsSync(path.join(ROOT, 'deploy', 'unfurl.env'));
  assert.ok(zipHasNoEnv, 'the repository never contains a real settings file, so copying its files over a folder cannot overwrite yours');
});

test('the guide for friends only mentions settings that exist, and the hash command it gives really works', async () => {
  const guide = read('deploy/EXTERNAL.md').toString();
  const code = ['serve.py', 'deploy/run.sh', 'deploy/update.sh'].map((f) => read(f).toString()).join('\n');
  for (const name of new Set(guide.match(/UNFURL_[A-Z_]+/g))) assert.ok(code.includes(name), `${name} is a real setting`);
  assert.match(guide, /--entrypoint python3 unfurl \/opt\/unfurl-seed\/serve\.py --hash-password/);
  assert.match(read('deploy/Dockerfile').toString(), /\/opt\/unfurl-seed/, 'the path in that command is where the image keeps the app');
  assert.match(read('deploy/Dockerfile').toString(), /COPY[^\n]*serve\.py[^\n]*\/opt\/unfurl-seed\//);
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('python3', [path.join(ROOT, 'serve.py'), '--hash-password'], { input: 'a long test passphrase\na long test passphrase\n', encoding: 'utf8' });
  // getpass reads the terminal when there is one; with piped input it falls back to stdin
  assert.match(r.stdout + r.stderr, /pbkdf2-sha256:\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/, r.stderr);
  for (const f of ['WINDOWS.md', 'EXTERNAL.md']) assert.ok(read(`deploy/${f}`).toString().includes('rebuild') || f === 'EXTERNAL.md');
});

test('the backup scripts: Windows line endings, they only write into the folder you chose, and the guide\'s commands match them', () => {
  const backup = read('backup-docker.bat').toString(), schedule = read('schedule-backup.bat').toString(), guide = read('deploy/BACKUP.md').toString();
  for (const [name, text] of [['backup-docker.bat', backup], ['schedule-backup.bat', schedule]]) assert.ok(!/(^|[^\r])\n/.test(text), `${name} uses CRLF`);
  // the scheduled run never waits for a person
  assert.match(backup, /if \/i "%MODE%"=="auto" \(\s+call :go >"%LOG%" 2>&1\s+exit \/b/);
  assert.match(backup, /run --rm -T --no-deps -v "!DEST!:\/backup" --entrypoint python3 unfurl \/srv\/unfurl\/current\/serve\.py --backup \/backup/);
  assert.ok(!/\b(del|erase|rmdir|rd)\b|compose[^\n]*\bdown\b|volume (rm|prune)|prune/i.test(backup), 'nothing destructive');
  assert.deepEqual([...backup.matchAll(/^\s*copy [^\n]*/gm)].map((m) => m[0].trim()), ['copy /y deploy\\unfurl.env "!DEST!\\unfurl.env" >nul'], 'the only file it copies is the settings file, to the chosen folder');
  assert.match(schedule, /StartWhenAvailable/, 'a missed run (PC off) happens when you are back');
  assert.match(schedule, /'%~dp0backup-docker\.bat' -Argument 'auto'/);
  // the two commands in the guide are the ones the script runs, and the thing they call exists in the server
  assert.ok(guide.includes('--entrypoint python3 unfurl /srv/unfurl/current/serve.py --restore /backup/'), 'restore command');
  const server = read('serve.py').toString();
  for (const flag of ['--backup', '--restore', '--force', '--keep', '--small']) assert.ok(server.includes(`"${flag}"`), `${flag} exists`);
  assert.match(read('deploy/run.sh').toString(), /current/, 'the supervisor keeps the live release under "current"');
  assert.match(read('.gitignore').toString(), /deploy\/backup-folder\.txt/, 'where your backups go is never committed');
  for (const f of ['README.md', 'deploy/README.md', 'deploy/WINDOWS.md']) assert.ok(read(f).toString().includes('BACKUP.md'), `${f} links to the guide`);
});
