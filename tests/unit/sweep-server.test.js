// The nightly sweep on the server: its settings, when it starts by itself (only inside the chosen window, only once a day, only when nobody
// is using the app), "Run it now", who it works for, and what a real run does to the data. serve.py is started for real; the sweep it
// launches is the real sweep.mjs under Node; YouTube is a stand-in behind a real port. Nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeYouTubeServer } from '../helpers/fake-youtube-server.js';
import { VIDEOS, chId } from '../helpers/fake-youtube.js';
import { freshState, addToLibrary, splitState } from '../../js/state.js';
import { analyzeVideoText } from '../../js/analyze.js';
import { quotaDay } from '../../js/youtube.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVE = path.join(ROOT, 'serve.py');
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `unfurl-${p}-`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const CALM = chId('Calm Hips Studio'), BIG = chId('Big Channel Yoga');

function raw(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) headers = { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, 'X-Unfurl': '1', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, json, text }); });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** Saved data for someone: a small library, a followed teacher, a key, and most of today's allowance already used. */
function seed(dir, { used = 9400, key = 'TESTKEY' } = {}) {
  const st = freshState();
  for (const v of VIDEOS.filter((x) => x.channelId === CALM).slice(0, 3)) {
    const rec = { id: v.id, title: 'Hip opener flow', channel: v.channel, channelId: v.channelId, description: 'a stretch', tags: [], durationSec: 600, verified: true, source: 'search', embeddable: true };
    st.videos[v.id] = { ...rec, profile: analyzeVideoText(rec) };
    addToLibrary(st, v.id);
  }
  st.following = [{ channelId: BIG, name: 'Big Channel Yoga', addedAt: 1, lastChecked: null }];
  st.quota = { day: quotaDay(), used };
  const { profile, index } = splitState(st);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(profile));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  if (key) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: key }), { mode: 0o600 });
  return { library: Object.keys(st.library) };
}
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const exists = (dir, name) => fs.existsSync(path.join(dir, name));

async function start({ env = {}, dataDir = tmp('sweep'), yt = null } = {}) {
  const port = await freePort();
  const proc = spawn('python3', [SERVE, '--port', String(port), '--no-open', '--data-dir', dataDir, '--legacy-dir', tmp('legacy')], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, UNFURL_BUILD: 'test-build', UNFURL_SWEEP_TICK: '1', ...(yt ? { UNFURL_YT_UPSTREAM: yt.url } : {}), ...env },
  });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  for (let i = 0; i < 80; i++) { try { await raw(port, { path: '/api/ping' }); break; } catch { await sleep(100); } }
  const call = (opts = {}) => raw(port, opts);
  const status = async (headers = {}) => (await call({ path: '/api/sweep', headers })).json;
  const finished = async (headers = {}, ms = 30000) => { const end = Date.now() + ms; for (;;) { const s = await status(headers); if (!s.busy && s.last) return s; if (Date.now() > end) throw new Error(`the sweep did not finish: ${JSON.stringify(s)} ${err}`); await sleep(250); } };
  return { port, dataDir, call, status, finished, err: () => err, stop: () => proc.kill() };
}

test('settings: off by default, validated, kept in a private file, and the window is shown in real times', async () => {
  const s = await start();
  try {
    const st = await s.status();
    assert.equal(st.available, true, st.reason);
    assert.deepEqual(st.settings, { enabled: false, hoursBefore: 2, reserve: 300, ai: true });
    assert.equal(st.nextRunAt, null, 'off: nothing is planned');
    assert.equal(Date.parse(st.resetAt) - Date.parse(st.startsAt), 2 * 3600 * 1000, 'it starts two hours before YouTube’s day ends');
    assert.ok(Date.parse(st.resetAt) > Date.now() && Date.parse(st.resetAt) - Date.now() <= 24 * 3600 * 1000 + 1000);
    const on = await s.call({ method: 'PUT', path: '/api/sweep', body: { enabled: true, hoursBefore: 3.5, reserve: 500, ai: false } });
    assert.equal(on.status, 200);
    assert.deepEqual(on.json.settings, { enabled: true, hoursBefore: 3.5, reserve: 500, ai: false });
    assert.ok(on.json.nextRunAt, 'on: the next run is shown');
    assert.equal(fs.statSync(path.join(s.dataDir, 'sweep.json')).mode & 0o077, 0, 'private file');
    for (const bad of [{ hoursBefore: 0 }, { hoursBefore: 13 }, { hoursBefore: 'soon' }, { reserve: -1 }, { reserve: 20000 }, { reserve: 1.5 }, { enabled: 'yes' }, { ai: 1 }, { nonsense: true }]) {
      assert.equal((await s.call({ method: 'PUT', path: '/api/sweep', body: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await s.call({ method: 'PUT', path: '/api/sweep', body: [] })).status, 400);
    assert.deepEqual((await s.status()).settings, { enabled: true, hoursBefore: 3.5, reserve: 500, ai: false }, 'bad requests changed nothing');
    assert.equal((await s.call({ method: 'PUT', path: '/api/sweep', body: { hoursBefore: 2.74 } })).json.settings.hoursBefore, 2.5, 'steps of half an hour');
    assert.equal((await s.call({ path: '/api/sweep', headers: { 'X-Unfurl': '' } })).status, 403, 'like every /api route it needs the app’s header');
  } finally { s.stop(); }
});

test('without Node it says so plainly and does not pretend', async () => {
  const s = await start({ env: { UNFURL_NODE: '/nonexistent/node' } });
  try {
    const st = await s.status();
    assert.equal(st.available, false); assert.match(st.reason, /Couldn.t run Node|not found/);
    const run = await s.call({ method: 'POST', path: '/api/sweep/run' });
    assert.equal(run.status, 409); assert.equal(run.json.error, 'unavailable');
    await s.call({ method: 'PUT', path: '/api/sweep', body: { enabled: true } });
    assert.equal((await s.status()).nextRunAt, null, 'nothing is scheduled that cannot run');
  } finally { s.stop(); }
});

test('"Run it now": a real run widens and reads the library, spends only what is above the reserve, and leaves your data whole', async () => {
  const yt = await fakeYouTubeServer();
  const dir = tmp('sweep-now');
  const { library } = seed(dir, { used: 9400 });
  const s = await start({ dataDir: dir, yt });
  try {
    const before = read(dir, 'index.json');
    const run = await s.call({ method: 'POST', path: '/api/sweep/run' });
    assert.equal(run.status, 202);
    const st = await s.finished();
    assert.equal(st.last.ok, true, JSON.stringify(st.last));
    assert.equal(st.last.trigger, 'manual');
    assert.ok(st.last.report.spent > 0 && st.last.report.spent <= 300, `spent ${st.last.report.spent}: only what is above the 300 kept back`);
    assert.ok(st.last.report.added > 0 && st.last.report.commentsRead > 0, JSON.stringify(st.last.report));
    assert.match(st.last.report.summary, /YouTube units used/);
    assert.equal(st.scheduledDayFor, undefined);
    const after = read(dir, 'index.json');
    assert.ok(Object.keys(after.videos).length > Object.keys(before.videos).length, 'videos were added to what the app knows');
    assert.ok(after.quota.used > 9400 && after.quota.used <= 9700, `the day’s count includes what the sweep spent: ${after.quota.used}`);
    assert.deepEqual(Object.keys(read(dir, 'profile.json').library).sort(), library.sort(), 'your library is exactly as it was');
    assert.ok(yt.calls.length > 0, 'it went to (the stand-in) YouTube');
    assert.ok(!fs.readFileSync(path.join(dir, 'sweep.json'), 'utf8').includes('TESTKEY'), 'no key in the report');
    assert.equal(fs.readdirSync(dir).filter((f) => f.includes('tmp')).length, 0, 'no stray files');
  } finally { s.stop(); yt.close(); }
});

test('a run in progress says so, and a second one is refused until it is done', async () => {
  const yt = await fakeYouTubeServer();
  const dir = tmp('sweep-busy');
  seed(dir);
  const slow = path.join(tmp('slow'), 'slow-node.sh');
  fs.writeFileSync(slow, `#!/bin/sh\nsleep 2\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  const s = await start({ dataDir: dir, yt, env: { UNFURL_NODE: slow } });
  try {
    assert.equal((await s.call({ method: 'POST', path: '/api/sweep/run' })).status, 202);
    const mid = await s.status();
    assert.deepEqual([mid.running, mid.busy], [true, true]);
    const again = await s.call({ method: 'POST', path: '/api/sweep/run' });
    assert.deepEqual([again.status, again.json.error], [409, 'busy']);
    assert.equal((await s.finished()).last.ok, true);
    assert.equal((await s.status()).running, false);
  } finally { s.stop(); yt.close(); }
});

test('no YouTube key: the run ends with a clear reason and changes nothing', async () => {
  const yt = await fakeYouTubeServer();
  const dir = tmp('sweep-nokey');
  seed(dir, { key: '' });
  const s = await start({ dataDir: dir, yt });
  try {
    const before = fs.readFileSync(path.join(dir, 'index.json'), 'utf8');
    await s.call({ method: 'POST', path: '/api/sweep/run' });
    const st = await s.finished();
    assert.equal(st.last.ok, false); assert.match(st.last.error, /YouTube key/);
    assert.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'), before, 'untouched');
    assert.equal(yt.calls.length, 0);
  } finally { s.stop(); yt.close(); }
});

test('scheduled: starts inside the window, once a day, and never outside it', async () => {
  const yt = await fakeYouTubeServer();
  const inside = tmp('sweep-in'), outside = tmp('sweep-out');
  seed(inside); seed(outside);
  // 06:30 UTC in October is 23:30 the evening before in Pacific time, half an hour before YouTube’s day ends (07:00 UTC)
  const a = await start({ dataDir: inside, yt, env: { UNFURL_SWEEP_NOW: '2026-10-17T06:30:00', UNFURL_SWEEP_IDLE: '0' } });
  const b = await start({ dataDir: outside, yt, env: { UNFURL_SWEEP_NOW: '2026-10-17T12:00:00', UNFURL_SWEEP_IDLE: '0' } });
  try {
    await a.call({ method: 'PUT', path: '/api/sweep', body: { enabled: true, hoursBefore: 2 } });
    await b.call({ method: 'PUT', path: '/api/sweep', body: { enabled: true, hoursBefore: 2 } });
    const st = await a.finished();
    assert.equal(st.last.trigger, 'schedule'); assert.equal(st.last.ok, true, JSON.stringify(st.last));
    assert.equal(read(inside, 'sweep.json').scheduledDay, '2026-10-16', 'the Pacific day it was for');
    assert.ok(Date.parse(st.nextRunAt) > Date.parse('2026-10-17T06:30:00Z'), 'tomorrow’s run is next');
    const calls = yt.calls.length;
    await sleep(3500);
    assert.equal((await a.status()).last.at, st.last.at, 'not run a second time the same day');
    const bs = await b.status();
    assert.equal(bs.last, null, 'outside the window nothing started');
    assert.equal(bs.nextRunAt, bs.startsAt, 'it is planned for the start of the window');
    assert.ok(yt.calls.length >= calls);
  } finally { a.stop(); b.stop(); yt.close(); }
});

test('scheduled: waits while the app is being used, then runs', async () => {
  const yt = await fakeYouTubeServer();
  const dir = tmp('sweep-idle');
  seed(dir);
  const s = await start({ dataDir: dir, yt, env: { UNFURL_SWEEP_NOW: '2026-10-17T06:30:00', UNFURL_SWEEP_IDLE: '4' } });
  try {
    const t0 = Date.now();
    await s.call({ method: 'PUT', path: '/api/sweep', body: { enabled: true } });   // (this is use of the app)
    await sleep(2500);
    for (let i = 0; i < 3; i++) { await s.call({ path: '/api/ping' }); await sleep(100); }   // an open page only polls /api/ping: that is not use
    assert.equal(exists(dir, 'sweep.json') && read(dir, 'sweep.json').last, undefined, 'still within the quiet time: not started');
    let last;
    while (!(last = read(dir, 'sweep.json').last)) { if (Date.now() - t0 > 40000) throw new Error(`never ran ${s.err()}`); await sleep(250); }   // (not through the API: asking would count as use)
    assert.equal(last.trigger, 'schedule');
    assert.ok(Date.now() - t0 >= 3500, `it waited for the quiet time (${Date.now() - t0} ms)`);
  } finally { s.stop(); yt.close(); }
});

test('several people: each sweep works only for its own person, their data and their key', async () => {
  const yt = await fakeYouTubeServer();
  const dir = tmp('sweep-users');
  seed(path.join(dir, 'users', 'ana'), { key: 'ANAKEY' }); seed(path.join(dir, 'users', 'ben'), { key: 'BENKEY' });
  const users = path.join(tmp('sweep-users-file'), 'users.txt');
  fs.writeFileSync(users, 'ana:ana-pass\nben:ben-pass\n');
  const s = await start({ dataDir: dir, yt, env: { UNFURL_USERS_FILE: users } });
  const ana = { Authorization: basic('ana', 'ana-pass') }, ben = { Authorization: basic('ben', 'ben-pass') };
  try {
    assert.equal((await s.call({ path: '/api/sweep' })).status, 401, 'a login is still required');
    assert.equal((await s.call({ path: '/api/sweep', headers: { 'X-Unfurl-Internal': 'guess', 'X-Unfurl-User': 'ana' } })).status, 401, 'the sweep’s secret cannot be guessed');
    const beforeBen = fs.readFileSync(path.join(dir, 'users', 'ben', 'index.json'), 'utf8');
    assert.equal((await s.call({ method: 'POST', path: '/api/sweep/run', headers: ana })).status, 202);
    const st = await s.finished(ana);
    assert.equal(st.last.ok, true, JSON.stringify(st.last));
    assert.ok(exists(path.join(dir, 'users', 'ana'), 'sweep.json') && !exists(path.join(dir, 'users', 'ben'), 'sweep.json'), 'only ana has a report');
    assert.equal(fs.readFileSync(path.join(dir, 'users', 'ben', 'index.json'), 'utf8'), beforeBen, 'ben’s data was not touched');
    assert.equal((await s.status(ben)).last ?? null, null);
    assert.ok(Object.keys(read(path.join(dir, 'users', 'ana'), 'index.json').videos).length > 3);
  } finally { s.stop(); yt.close(); }
});
