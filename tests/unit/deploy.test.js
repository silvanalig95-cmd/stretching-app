// The auto-update kit, end to end, against a local git repository standing in for GitHub:
// deploy/update.sh (fetch, prove, switch, health-check, roll back) and deploy/run.sh (supervise + poll).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `unfurl-${p}-`));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A work tree + a bare "origin", seeded with the real app files. */
function makeRemote() {
  const work = tmp('work'), bare = tmp('origin');
  git(bare, 'init', '--bare', '--quiet', '-b', 'main');
  git(work, 'init', '--quiet', '-b', 'main');
  for (const f of ['serve.py', 'index.html', 'favicon.svg', 'css', 'js', 'data', 'deploy']) fs.cpSync(path.join(ROOT, f), path.join(work, f), { recursive: true });
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'first version');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', 'origin', 'main');
  const push = (msg, edit) => {
    edit(work);
    git(work, 'add', '-A'); git(work, 'commit', '-qm', msg); git(work, 'push', '-q', 'origin', 'main');
    return git(work, 'rev-parse', 'HEAD').slice(0, 12);
  };
  return { work, bare, head: () => git(work, 'rev-parse', 'HEAD').slice(0, 12), push };
}
const editFile = (rel, fn) => (dir) => { const f = path.join(dir, rel); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
const goodChange = (n) => editFile('index.html', (t) => t.replace('</footer>', `<!-- v${n} --></footer>`));
const breaksSelftest = () => editFile('index.html', (t) => t.replace(/<title>[^<]*<\/title>/, ''));    // selftest requires a <title>
const breaksStartup = () => editFile('serve.py', (t) => t.replace('    c = build_config(args, env)\n', '    sys.exit("simulated crash on startup")\n    c = build_config(args, env)\n'));

const UPDATE = path.join(ROOT, 'deploy', 'update.sh');
function updater(home, remote, extraEnv = {}) {
  return (...args) => {
    const r = spawnSync('bash', [UPDATE, ...args], {
      encoding: 'utf8', timeout: 90000,
      env: { ...process.env, UNFURL_HOME: home, UNFURL_REPO_URL: remote.bare, UNFURL_BRANCH: 'main', UNFURL_HEALTH_TIMEOUT: '5', ...extraEnv },
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
}
const liveBuild = (home) => { try { return fs.readFileSync(path.join(fs.realpathSync(path.join(home, 'current')), 'BUILD'), 'utf8').trim(); } catch { return null; } };
const readLog = (home) => { try { return fs.readFileSync(path.join(home, 'update.log'), 'utf8'); } catch { return ''; } };

test('first run downloads the branch into a numbered release, proves it, and makes it live', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  const r = run('--no-restart');
  assert.equal(r.code, 0, r.out);
  assert.equal(liveBuild(home), remote.head());
  assert.ok(fs.existsSync(path.join(home, 'releases', remote.head(), 'serve.py')));
  assert.ok(!fs.existsSync(path.join(home, 'releases', remote.head(), '.git')), 'releases are plain files, no git needed at runtime');
  assert.match(run('--status').out, new RegExp(`live: +${remote.head()}`));
});

test('nothing new => silent no-op; --check reports a waiting update with exit code 10', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const logBefore = readLog(home);
  const again = run('--no-restart');
  assert.equal(again.code, 0);
  assert.equal(readLog(home), logBefore, 'quiet when there is nothing to do');
  assert.match(run('--check').out, /up to date/);
  const next = remote.push('v2', goodChange(2));
  const check = run('--check');
  assert.equal(check.code, 10);
  assert.match(check.out, new RegExp(`update available: .* -> ${next}`));
  assert.notEqual(liveBuild(home), next, '--check never changes anything');
});

test('a new commit is applied, the previous release is kept for rollback, and --rollback goes back', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const first = liveBuild(home);
  const second = remote.push('v2', goodChange(2));
  assert.equal(run('--no-restart').code, 0);
  assert.equal(liveBuild(home), second);
  assert.equal(fs.readFileSync(path.join(fs.realpathSync(path.join(home, 'previous')), 'BUILD'), 'utf8').trim(), first);
  assert.equal(run('--rollback', '--no-restart').code, 0);
  assert.equal(liveBuild(home), first);
  assert.equal(fs.readFileSync(path.join(home, 'failed'), 'utf8').trim(), second, 'the version you rolled back from is not re-applied automatically');
  assert.equal(run('--no-restart').code, 0);
  assert.equal(liveBuild(home), first, 'still on the old one');
  assert.equal(run('--no-restart', '--force').code, 0);
  assert.equal(liveBuild(home), second, '--force tries it again');
});

test('a version that fails its self-test is never switched to, and is not retried every minute', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const good = liveBuild(home);
  const bad = remote.push('broken', breaksSelftest());
  const r = run('--no-restart');
  assert.equal(r.code, 1);
  assert.match(r.out, /NOT updating to .*failed its self-test/);
  assert.equal(liveBuild(home), good, 'the live version is untouched');
  assert.equal(fs.readFileSync(path.join(home, 'failed'), 'utf8').trim(), bad);
  const logAfterFirst = readLog(home);
  assert.equal(run('--no-restart').code, 0);
  assert.equal(readLog(home), logAfterFirst, 'no repeated attempts or log spam for the same rejected commit');
  const fixed = remote.push('fixed', (dir) => { fs.writeFileSync(path.join(dir, 'index.html'), fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace('</footer>', '<!-- fixed --></footer>')); });
  assert.equal(run('--no-restart').code, 0);
  assert.equal(liveBuild(home), fixed, 'the next commit is tried as normal');
  assert.ok(!fs.existsSync(path.join(home, 'failed')));
});

test('a shell script with a syntax error is caught before it can be deployed', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const good = liveBuild(home);
  remote.push('oops', editFile('deploy/run.sh', (t) => t + '\nif then fi fi\n'));
  const r = run('--no-restart');
  assert.equal(r.code, 1);
  assert.match(r.out, /run\.sh has a syntax error/);
  assert.equal(liveBuild(home), good);
});

test('an unreachable repository is reported once and does no harm', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const good = liveBuild(home);
  const broken = updater(home, { bare: path.join(os.tmpdir(), 'unfurl-does-not-exist.git') });
  const first = broken('--no-restart');
  assert.equal(first.code, 3);
  assert.match(first.out, /couldn't fetch main/);
  const lines = readLog(home).split('\n').filter((l) => /couldn't fetch/.test(l)).length;
  broken('--no-restart'); broken('--no-restart');
  assert.equal(readLog(home).split('\n').filter((l) => /couldn't fetch/.test(l)).length, lines, 'the same error is logged once, not every minute');
  assert.equal(liveBuild(home), good);
  assert.equal(run('--no-restart').code, 0, 'and it recovers by itself when the repository is back');
});

test('only one updater runs at a time; a lock left by a dead process does not block updates', async () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const second = remote.push('v2', goodChange(2));
  const holder = spawn('bash', ['-c', 'exec -a update.sh sleep 30']);   // looks like a running updater
  try {
    fs.mkdirSync(path.join(home, '.update.lock'));
    fs.writeFileSync(path.join(home, '.update.lock', 'pid'), String(holder.pid));
    const blocked = run('--no-restart');
    assert.equal(blocked.code, 0);
    assert.match(blocked.out, /another update is already running/);
    assert.notEqual(liveBuild(home), second);
  } finally { holder.kill(); }
  await sleep(100);
  const stale = run('--no-restart');   // holder is dead now, its pid file is stale
  assert.equal(stale.code, 0, stale.out);
  assert.equal(liveBuild(home), second);
  assert.ok(!fs.existsSync(path.join(home, '.update.lock')), 'the lock is released');
});

test('old releases are cleaned up, but the live one and the fallback never are', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote, { UNFURL_KEEP_RELEASES: '2' });
  run('--no-restart');
  for (let i = 2; i <= 6; i++) { remote.push(`v${i}`, goodChange(i)); run('--no-restart'); }
  const releases = fs.readdirSync(path.join(home, 'releases'));
  assert.ok(releases.length <= 4, `kept ${releases.length}: ${releases}`);   // 2 extra + live + previous
  assert.ok(releases.includes(liveBuild(home)));
  assert.ok(fs.existsSync(path.join(home, 'previous')) && fs.existsSync(fs.realpathSync(path.join(home, 'previous'))));
});

// ---------------------------------------------------------------- the whole thing running

async function bring({ extraEnv = {}, data = tmp('data') } = {}) {
  const remote = makeRemote(), home = tmp('home'), port = await freePort();
  const env = {
    ...process.env, UNFURL_HOME: home, UNFURL_REPO_URL: remote.bare, UNFURL_BRANCH: 'main', UNFURL_PORT: String(port), UNFURL_DATA: data,
    UNFURL_UPDATE_INTERVAL: '1', UNFURL_HEALTH_TIMEOUT: '8', UNFURL_ALLOWED_HOSTS: '', ...extraEnv,
  };
  const proc = spawn('bash', [path.join(ROOT, 'deploy', 'run.sh')], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const build = async () => { try { return (await (await fetch(`${base}/healthz`)).json()).build; } catch { return null; } };
  const until = async (pred, ms = 40000, what = 'condition') => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await pred(); if (v) return v; await sleep(250); }
    throw new Error(`timed out waiting for ${what}\n--- run.sh output ---\n${log}\n--- update.log ---\n${readLog(home)}`);
  };
  const stop = async () => {
    proc.kill('SIGTERM');
    await Promise.race([new Promise((r) => proc.on('exit', r)), sleep(8000)]);
    try { process.kill(Number(fs.readFileSync(path.join(home, 'server.pid'), 'utf8')), 'SIGKILL'); } catch { /* already gone */ }   // never leave a stray server behind
  };
  return { remote, home, port, base, build, until, stop, log: () => log, proc, data };
}

test('running: the server starts from the branch, then follows new commits by itself, and your data stays put', async () => {
  const s = await bring();
  try {
    const first = s.remote.head();
    await s.until(async () => (await s.build()) === first, 40000, `server to come up on ${first}`);
    const H = { 'X-Unfurl': '1', 'Content-Type': 'application/json' };
    await fetch(`${s.base}/api/profile`, { method: 'PUT', headers: H, body: JSON.stringify({ schema: 2, marker: 'survives-updates' }) });
    const page1 = await (await fetch(`${s.base}/`)).text();
    assert.ok(!page1.includes('v2-marker'));

    const second = s.remote.push('v2', editFile('index.html', (t) => t.replace('</footer>', '<!-- v2-marker --></footer>')));
    await s.until(async () => (await s.build()) === second, 40000, `server to move to ${second}`);
    assert.ok((await (await fetch(`${s.base}/`)).text()).includes('v2-marker'), 'the new page is what is served');
    assert.equal((await (await fetch(`${s.base}/api/profile`, { headers: H })).json()).data.marker, 'survives-updates', 'data written before the update is still there');
    const ping = await (await fetch(`${s.base}/api/ping`, { headers: H })).json();
    assert.equal(ping.build, second, 'open pages can see the build change and offer a reload');
    await s.until(() => new RegExp(`update to ${second} is live and healthy`).test(readLog(s.home)), 10000, 'the updater to confirm the update');
  } finally { await s.stop(); }
});

test('running: a version that passes its self-test but cannot start is rolled back automatically', async () => {
  const s = await bring({ extraEnv: { UNFURL_HEALTH_TIMEOUT: '6' } });
  try {
    const good = s.remote.head();
    await s.until(async () => (await s.build()) === good, 40000, 'first start');
    const bad = s.remote.push('boom', breaksStartup());
    await s.until(() => /putting .* back/.test(readLog(s.home)), 40000, 'the health check to give up on the new version');
    await s.until(async () => (await s.build()) === good, 40000, 'the old version to come back');
    assert.equal(liveBuild(s.home), good);
    await s.until(() => fs.existsSync(path.join(s.home, 'failed')), 10000, 'the rejected build to be recorded');
    assert.equal(fs.readFileSync(path.join(s.home, 'failed'), 'utf8').trim(), bad);
    await sleep(3000);
    assert.equal(await s.build(), good, 'and it stays on the good version instead of retrying the bad one');
    const attempts = readLog(s.home).split('\n').filter((l) => new RegExp(`switched .* -> ${bad}`).test(l)).length;
    assert.equal(attempts, 1, 'tried exactly once');
    const next = s.remote.push('v3: fixed', (dir) => fs.copyFileSync(path.join(ROOT, 'serve.py'), path.join(dir, 'serve.py')));   // the fix for the crash
    await s.until(async () => (await s.build()) === next, 40000, 'a later, fixed commit to be picked up');
  } finally { await s.stop(); }
});

test('running: if the live version starts crashing on its own, the supervisor falls back to the previous one', async () => {
  const s = await bring({ extraEnv: { UNFURL_CRASH_LIMIT: '2', UNFURL_UPDATE_INTERVAL: '0' } });   // no polling: we break it by hand
  try {
    const good = s.remote.head();
    await s.until(async () => (await s.build()) === good, 40000, 'first start');
    const bad = s.remote.push('boom', breaksStartup());
    const manual = spawnSync('bash', [UPDATE, '--no-restart'], { encoding: 'utf8', env: { ...process.env, UNFURL_HOME: s.home, UNFURL_REPO_URL: s.remote.bare, UNFURL_BRANCH: 'main' } });
    assert.equal(manual.status, 0, manual.stdout + manual.stderr);
    assert.equal(liveBuild(s.home), bad, 'switched on disk, server still running the old code');
    process.kill(Number(fs.readFileSync(path.join(s.home, 'server.pid'), 'utf8')), 'SIGKILL');   // a crash, not a deliberate restart
    await s.until(async () => (await s.build()) === good, 60000, 'the fallback to the previous version');
    assert.equal(liveBuild(s.home), good);
    assert.match(s.log(), /keeps failing right after starting/);
  } finally { await s.stop(); }
});

test('running: stopping the service stops the server too', async () => {
  const s = await bring({ extraEnv: { UNFURL_UPDATE_INTERVAL: '0' } });
  await s.until(async () => (await s.build()) === s.remote.head(), 40000, 'start');
  const pid = Number(fs.readFileSync(path.join(s.home, 'server.pid'), 'utf8'));
  s.proc.kill('SIGTERM');
  await new Promise((r) => s.proc.on('exit', r));
  await sleep(300);
  assert.throws(() => process.kill(pid, 0), 'the server process is gone');
  assert.equal(await s.build(), null);
});

test('running from a built-in copy (the Docker case) works with no repository at all', async () => {
  const seed = tmp('seed');
  for (const f of ['serve.py', 'index.html', 'favicon.svg', 'css', 'js', 'data', 'deploy']) fs.cpSync(path.join(ROOT, f), path.join(seed, f), { recursive: true });
  fs.writeFileSync(path.join(seed, 'BUILD'), 'baked-1\n');
  const home = tmp('home'), port = await freePort();
  const proc = spawn('bash', [path.join(ROOT, 'deploy', 'run.sh')], {
    env: { ...process.env, UNFURL_HOME: home, UNFURL_SEED: seed, UNFURL_PORT: String(port), UNFURL_DATA: tmp('data'), UNFURL_REPO_URL: '', UNFURL_UPDATE_INTERVAL: '1' }, stdio: 'ignore',
  });
  try {
    let got = null;
    for (let i = 0; i < 100 && got !== 'baked-1'; i++) { try { got = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).build; } catch { await sleep(200); } }
    assert.equal(got, 'baked-1');
    await sleep(2500);   // a couple of update ticks with nothing configured must be harmless
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).build, 'baked-1');
  } finally { proc.kill('SIGTERM'); await sleep(500); }
});

test('install.sh prepares a folder, writes a settings file once with a generated login, and is safe to re-run', () => {
  const remote = makeRemote(), home = tmp('inst'), data = tmp('inst-data'), envFile = path.join(tmp('inst-env'), 'unfurl.env');
  const args = [path.join(ROOT, 'deploy', 'install.sh'), '--repo', remote.bare, '--branch', 'main', '--host', 'unfurl.internal', '--port', '9123', '--home', home, '--data', data, '--env-file', envFile, '--no-service'];
  const first = spawnSync('bash', args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const env = fs.readFileSync(envFile, 'utf8');
  assert.match(env, new RegExp(`^UNFURL_REPO_URL=${remote.bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(env, /^UNFURL_PORT=9123$/m);
  assert.match(env, /^UNFURL_ALLOWED_HOSTS=unfurl\.internal$/m);
  const login = env.match(/^UNFURL_AUTH=unfurl:([A-Za-z0-9_-]{16,})$/m);
  assert.ok(login, 'a random password was generated');
  assert.ok(first.stdout.includes(login[1]), 'and shown once');
  assert.equal(liveBuild(home), remote.head());
  assert.equal((fs.statSync(envFile).mode & 0o777).toString(8), '600', 'secrets are private');
  const second = spawnSync('bash', args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(fs.readFileSync(envFile, 'utf8'), env, 'an existing settings file is never overwritten');
  assert.match(second.stdout, /Keeping your existing/);
  // the generated settings file can be sourced by a shell exactly like systemd/Docker would read it
  const sourced = spawnSync('bash', ['-c', `set -a; . '${envFile}'; set +a; echo "$UNFURL_HOST|$UNFURL_PORT|$UNFURL_BRANCH"`], { encoding: 'utf8' });
  assert.equal(sourced.stdout.trim(), '0.0.0.0|9123|main');
});

test('the systemd unit only contains placeholders that install.sh knows how to fill', () => {
  const unit = fs.readFileSync(path.join(ROOT, 'deploy', 'unfurl.service'), 'utf8');
  const installer = fs.readFileSync(path.join(ROOT, 'deploy', 'install.sh'), 'utf8');
  for (const ph of new Set(unit.match(/@[A-Z]+@/g))) assert.ok(installer.includes(ph), `${ph} is substituted by install.sh`);
  assert.match(unit, /ExecStart=@HOME@\/current\/deploy\/run\.sh/);
  assert.match(unit, /ReadWritePaths=@HOME@ @DATA@/);
});

test('the settings template has no same-line comments (systemd and docker would read them as part of the value)', () => {
  for (const line of fs.readFileSync(path.join(ROOT, 'deploy', 'unfurl.env.example'), 'utf8').split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    assert.match(line, /^[A-Z_]+=[^\s#]*$/, `bad line: ${line}`);
  }
});


// ---------------------------------------------------------------- fixes from the independent review

test('a self-test that dies silently (killed, crashed) still blocks the update', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const good = liveBuild(home);
  remote.push('silent death', editFile('serve.py', (t) => t.replace('    if args.selftest:\n        sys.exit(selftest())', '    if args.selftest:\n        os._exit(3)')));
  const r = run('--no-restart');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /exited with status 3 and no message/);
  assert.equal(liveBuild(home), good);
});

test('a JavaScript syntax error in the app is caught before it can be deployed (when node is available)', { skip: spawnSync('node', ['--version']).status !== 0 }, () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const good = liveBuild(home);
  remote.push('broken script', editFile('js/app.js', (t) => `${t}\nconst oops = ;\n`));
  const r = run('--no-restart');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /js\/app\.js has a JavaScript syntax error/);
  assert.equal(liveBuild(home), good);
});

test('the status never prints an access token that is part of the repository address; the folder is private', () => {
  const remote = makeRemote(), home = tmp('home');
  updater(home, remote)('--no-restart');
  const withToken = updater(home, { bare: 'https://x-access-token:ghp_SECRETSECRET@github.com/you/repo.git' });
  const r = withToken('--status');
  assert.ok(!r.out.includes('SECRETSECRET'), r.out);
  assert.match(r.out, /https:\/\/\*\*\*@github\.com\/you\/repo\.git/);
  assert.equal((fs.statSync(home).mode & 0o077), 0, 'the app folder is not readable by other accounts');
  assert.equal((fs.statSync(path.join(home, 'repo', 'config')).mode & 0o077), 0, 'nor is the repository config');
});

test('after a failed update the earlier fallback is still the fallback (and a missing one is not invented)', () => {
  const remote = makeRemote(), home = tmp('home');
  const run = updater(home, remote);
  run('--no-restart');
  const a = liveBuild(home);
  const b = remote.push('b', goodChange(2));
  run('--no-restart');
  assert.equal(liveBuild(home), b);
  // a failing update with a health check that cannot succeed (restart is "fine", nothing ever answers on that port)
  const c = remote.push('c', goodChange(3));
  const failing = updater(home, remote, { UNFURL_RESTART_CMD: 'true', UNFURL_HEALTH_URL: 'http://127.0.0.1:9/healthz', UNFURL_HEALTH_TIMEOUT: '2' })();
  assert.equal(failing.code, 1, failing.out);
  assert.match(failing.out, /did not come up healthy/);
  assert.equal(liveBuild(home), b, 'back on the version that was live');
  assert.equal(fs.readFileSync(path.join(fs.realpathSync(path.join(home, 'previous')), 'BUILD'), 'utf8').trim(), a, 'the fallback is still the one before it');
  assert.equal(fs.readFileSync(path.join(home, 'failed'), 'utf8').trim(), c);
  assert.equal(run('--rollback', '--no-restart').code, 0, 'so a rollback still works');
  assert.equal(liveBuild(home), a);
});

test('a first update that fails leaves no bogus fallback pointing at the live version', () => {
  const remote = makeRemote(), home = tmp('home');
  updater(home, remote)('--no-restart');
  remote.push('b', goodChange(2));
  updater(home, remote, { UNFURL_RESTART_CMD: 'true', UNFURL_HEALTH_URL: 'http://127.0.0.1:9/healthz', UNFURL_HEALTH_TIMEOUT: '2' })();
  assert.ok(!fs.existsSync(path.join(home, 'previous')), 'nothing to roll back to, and it says so rather than pointing at itself');
});

test('running: an http_proxy setting on the machine does not break the health check (every update used to be rolled back)', async () => {
  const s = await bring({ extraEnv: { http_proxy: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', UNFURL_HEALTH_TIMEOUT: '10' } });
  try {
    const first = s.remote.head();
    await s.until(async () => (await s.build()) === first, 40000, 'first start');
    const second = s.remote.push('v2', goodChange(2));
    await s.until(async () => (await s.build()) === second, 40000, 'the update to go through');
    await s.until(() => new RegExp(`update to ${second} is live and healthy`).test(readLog(s.home)), 15000, 'the updater to confirm it');
    assert.ok(!fs.existsSync(path.join(s.home, 'failed')));
  } finally { await s.stop(); }
});

test('running: a build id set in the environment cannot blind the updater to a new version', async () => {
  const s = await bring({ extraEnv: { UNFURL_BUILD: 'my-own-label' } });
  try {
    const first = s.remote.head();
    await s.until(async () => (await s.build()) === first, 40000, 'the release\'s own build id wins over the environment');
  } finally { await s.stop(); }
});

test('running: a version that worked before and now cannot start (settings problem) is NOT swapped for an older one', async () => {
  const blocker = net.createServer();
  const remote = makeRemote(), home = tmp('home'), port = await freePort();
  const run = updater(home, remote);
  run('--no-restart');
  remote.push('v2', goodChange(2));
  run('--no-restart');
  const b = liveBuild(home);
  fs.writeFileSync(path.join(home, 'healthy'), `${b}\n`);               // v2 has run fine here before
  await new Promise((r) => blocker.listen(port, '127.0.0.1', r));        // ... and now its port is taken
  const proc = spawn('bash', [path.join(ROOT, 'deploy', 'run.sh')], { env: { ...process.env, UNFURL_HOME: home, UNFURL_REPO_URL: '', UNFURL_PORT: String(port), UNFURL_DATA: tmp('data'), UNFURL_UPDATE_INTERVAL: '0', UNFURL_CRASH_LIMIT: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 120 && !/This version ran fine before/.test(log); i++) await sleep(250);
    assert.match(log, /This version ran fine before/, log);
    assert.equal(liveBuild(home), b, 'still on the version that was live');
    assert.ok(!fs.existsSync(path.join(home, 'failed')), 'and it was not blacklisted');
    await new Promise((r) => blocker.close(r));                          // the problem is fixed
    let got = null;
    for (let i = 0; i < 160 && got !== b; i++) { try { got = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).build; } catch { await sleep(250); } }
    assert.equal(got, b, 'it comes up by itself once the port is free');
  } finally { proc.kill('SIGTERM'); await sleep(500); try { process.kill(Number(fs.readFileSync(path.join(home, 'server.pid'), 'utf8')), 'SIGKILL'); } catch { /* gone */ } blocker.close(); }
});

test('running from a built-in copy: rebuilding the image brings the new copy in when no repository is followed', async () => {
  const mkSeed = (build) => {
    const seed = tmp('seed');
    for (const f of ['serve.py', 'index.html', 'favicon.svg', 'css', 'js', 'data', 'deploy']) fs.cpSync(path.join(ROOT, f), path.join(seed, f), { recursive: true });
    fs.writeFileSync(path.join(seed, 'BUILD'), `${build}\n`);
    return seed;
  };
  const home = tmp('home'), port = await freePort(), data = tmp('data');
  const start = (seed) => spawn('bash', [path.join(ROOT, 'deploy', 'run.sh')], { env: { ...process.env, UNFURL_HOME: home, UNFURL_SEED: seed, UNFURL_PORT: String(port), UNFURL_DATA: data, UNFURL_REPO_URL: '', UNFURL_UPDATE_INTERVAL: '0' }, stdio: 'ignore' });
  const buildNow = async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).build; } catch { return null; } };
  const until = async (want) => { for (let i = 0; i < 100; i++) { if ((await buildNow()) === want) return true; await sleep(200); } return false; };
  let proc = start(mkSeed('image-1'));
  try {
    assert.ok(await until('image-1'));
    proc.kill('SIGTERM'); await sleep(800);
    proc = start(mkSeed('image-2'));              // "docker compose up --build": same volume, newer image
    assert.ok(await until('image-2'), 'the volume\'s old copy was replaced');
  } finally { proc.kill('SIGTERM'); await sleep(500); }
});
