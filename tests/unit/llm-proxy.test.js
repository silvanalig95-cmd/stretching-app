// The optional AI coach, server side: the browser asks, serve.py holds the Anthropic key and makes the call.
// A fake Anthropic server stands in for api.anthropic.com; no real key or network is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeAnthropic } from '../helpers/fake-anthropic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVE = path.join(ROOT, 'serve.py');
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `unfurl-${p}-`));
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const KEY = 'sk-ant-api03-TEST-ONLY-0123456789abcdefWXYZ';   // not a real key
const OTHER = 'sk-ant-api03-SERVER-SIDE-0123456789abcdefQRST';

function raw(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  if (payload !== undefined) headers = { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers, setHost: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function start({ env = {}, dataDir = tmp('llm') } = {}) {
  const port = await freePort();
  const proc = spawn('python3', [SERVE, '--port', String(port), '--no-open', '--data-dir', dataDir, '--legacy-dir', tmp('legacy')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, UNFURL_BUILD: 'test-build', ...env } });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  for (let i = 0; i < 80; i++) { try { await raw(port, { path: '/', headers: { Host: `127.0.0.1:${port}` } }); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const call = (opts = {}) => raw(port, { ...opts, headers: { Host: `127.0.0.1:${port}`, 'X-Unfurl': '1', ...(opts.headers || {}) } });
  return { port, dataDir, call, err: () => err, stop: () => proc.kill() };
}

const ask = (s, body = {}, headers = {}) => s.call({ method: 'POST', path: '/api/llm', headers, body: { system: 'You build workouts.', prompt: 'A short upper-body workout, please.', schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, ...body } });
const save = (s, body, headers = {}) => s.call({ method: 'PUT', path: '/api/llm/settings', headers, body });

test('with no key anywhere the coach says so and nothing leaves the server', async () => {
  const ai = await fakeAnthropic();
  const s = await start({ env: { UNFURL_ANTHROPIC_BASE: ai.url } });
  try {
    const st = await s.call({ path: '/api/llm/status' });
    assert.equal(st.status, 200);
    assert.equal(st.json.ready, false);
    assert.equal(st.json.source, null);
    assert.deepEqual(st.json.models, ['claude-opus-5-5', 'claude-sonnet-5-5']);
    const r = await ask(s);
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'no_key');
    assert.equal(ai.seen.length, 0);
  } finally { s.stop(); ai.close(); }
});

test('your own key: saved privately, never sent back, used for the call, with the request shaped for current models', async () => {
  const ai = await fakeAnthropic();
  const dataDir = tmp('llm-own');
  const s = await start({ dataDir, env: { UNFURL_ANTHROPIC_BASE: ai.url } });
  try {
    assert.equal((await save(s, { key: 'not-a-key' })).status, 400, 'something that is not an Anthropic key is refused');
    assert.equal((await save(s, { key: 'sk-ant-short' })).status, 400);
    const saved = await save(s, { key: `  ${KEY}  ` });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.ready, true);
    assert.equal(saved.json.source, 'own');
    assert.equal(saved.json.ownKey, '…WXYZ', 'only a hint of the last characters comes back');
    for (const route of ['/api/llm/status', '/api/ping', '/api/config', '/api/profile']) assert.ok(!(await s.call({ path: route })).text.includes('0123456789abcdef'), `${route} must not reveal the key`);
    assert.ok(!saved.text.includes(KEY));
    const file = path.join(dataDir, 'llm.json');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).key, KEY);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'readable by the owner only');

    ai.reply({ text: JSON.stringify({ name: 'Upper A' }) });
    const r = await ask(s);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.result, { name: 'Upper A' });
    assert.equal(r.json.model, 'claude-opus-5-5');
    assert.equal(r.json.stopReason, 'end_turn');
    assert.equal(r.json.usage.input_tokens, 1200);
    const sent = ai.seen[0];
    assert.equal(sent.path, '/v1/messages');
    assert.equal(sent.headers['x-api-key'], KEY);
    assert.equal(sent.headers['anthropic-version'], '2023-06-01');
    assert.equal(sent.body.model, 'claude-opus-5-5');
    assert.equal(sent.body.max_tokens, 8000);
    assert.deepEqual(sent.body.messages, [{ role: 'user', content: 'A short upper-body workout, please.' }]);
    assert.equal(sent.body.output_config.format.type, 'json_schema');
    assert.equal(sent.body.output_config.effort, 'medium');
    assert.deepEqual(sent.body.system, [{ type: 'text', text: 'You build workouts.', cache_control: { type: 'ephemeral' } }], 'the long stable part is marked for caching');
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking', 'budget_tokens']) assert.ok(!(banned in sent.body), `${banned} is rejected by current models, so it is never sent`);

    const cleared = await save(s, { key: '' });
    assert.equal(cleared.json.ready, false);
    assert.ok(!JSON.parse(fs.readFileSync(file, 'utf8')).key);
    assert.equal((await ask(s)).status, 400, 'with the key removed it stops working');
  } finally { s.stop(); ai.close(); }
});

test('a key kept on the server works for everyone; a person\'s own key wins; the model can be chosen from a short list', async () => {
  const ai = await fakeAnthropic();
  const s = await start({ env: { UNFURL_ANTHROPIC_BASE: ai.url, UNFURL_ANTHROPIC_KEY: OTHER } });
  try {
    assert.equal((await s.call({ path: '/api/llm/status' })).json.source, 'server');
    ai.reply({ text: '{"name":"x"}' });
    assert.equal((await ask(s)).status, 200);
    assert.equal(ai.seen[0].headers['x-api-key'], OTHER);
    assert.ok(!(await s.call({ path: '/api/ping' })).text.includes('SERVER-SIDE'), 'the shared key is never revealed');

    await save(s, { key: KEY });
    ai.reply({ text: '{"name":"x"}' });
    await ask(s);
    assert.equal(ai.seen[1].headers['x-api-key'], KEY, 'their own key is used instead');

    assert.equal((await save(s, { model: 'gpt-4' })).status, 400);
    assert.equal((await save(s, { model: 'claude-sonnet-5-5' })).json.model, 'claude-sonnet-5-5');
    ai.reply({ text: '{"name":"x"}' });
    await ask(s);
    assert.equal(ai.seen[2].body.model, 'claude-sonnet-5-5');
    await save(s, { key: '' });
    ai.reply({ text: '{"name":"x"}' });
    await ask(s);
    assert.equal(ai.seen[3].headers['x-api-key'], OTHER, 'without their own key the server\'s one is used again');
  } finally { s.stop(); ai.close(); }
});

test('the model the server defaults to can be set, and a nonsense value stops the server with a clear message', async () => {
  const ai = await fakeAnthropic();
  const s = await start({ env: { UNFURL_ANTHROPIC_BASE: ai.url, UNFURL_ANTHROPIC_KEY: OTHER, UNFURL_LLM_MODEL: 'claude-sonnet-5-5' } });
  try {
    assert.equal((await s.call({ path: '/api/llm/status' })).json.model, 'claude-sonnet-5-5');
    ai.reply({ text: '{"name":"x"}' });
    await ask(s);
    assert.equal(ai.seen[0].body.model, 'claude-sonnet-5-5');
  } finally { s.stop(); ai.close(); }
  const bad = spawnSync('python3', [SERVE, '--no-open', '--port', String(await freePort()), '--data-dir', tmp('bad-model')], { encoding: 'utf8', env: { ...process.env, UNFURL_LLM_MODEL: 'not a model!' }, timeout: 15000 });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /UNFURL_LLM_MODEL/);
});

test('requests are checked and clamped before anything is sent', async () => {
  const ai = await fakeAnthropic();
  const s = await start({ env: { UNFURL_ANTHROPIC_BASE: ai.url, UNFURL_ANTHROPIC_KEY: OTHER } });
  try {
    for (const bad of [{ prompt: '' }, { prompt: 5 }, { system: 5 }, { prompt: 'x'.repeat(60001) }, { system: 'x'.repeat(60001) }, { schema: 'nope' }, { schema: { type: 'object', pad: 'x'.repeat(20001) } }, { maxTokens: 'lots' }, { maxTokens: true }]) {
      assert.equal((await ask(s, bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
    assert.equal((await s.call({ method: 'POST', path: '/api/llm', body: 'not json' })).status, 400);
    assert.equal(ai.seen.length, 0, 'none of that reached Anthropic');
    ai.reply({ text: '{"name":"x"}' });
    await ask(s, { maxTokens: 999999 });
    assert.equal(ai.seen[0].body.max_tokens, 12000, 'the answer size is capped by the server');
    ai.reply({ text: 'plain words' });
    const plain = await ask(s, { schema: undefined, system: '' });
    assert.equal(plain.json.text, 'plain words');
    assert.equal(plain.json.result, null);
    assert.ok(!('system' in ai.seen[1].body) && !('format' in ai.seen[1].body.output_config), 'no schema and no instructions: neither is sent');
  } finally { s.stop(); ai.close(); }
});

test('each person has a daily cap; requests that got no answer are not counted', async () => {
  const ai = await fakeAnthropic();
  const s = await start({ env: { UNFURL_ANTHROPIC_BASE: ai.url, UNFURL_ANTHROPIC_KEY: OTHER, UNFURL_USER_DAILY_LLM_CALLS: '2' } });
  try {
    ai.reply({ status: 529, errorType: 'overloaded_error', message: 'Overloaded' });
    const busy = await ask(s);
    assert.equal(busy.status, 502);
    assert.equal(busy.json.error, 'busy');
    assert.equal((await s.call({ path: '/api/llm/status' })).json.usedToday, 0, 'an overloaded API costs nothing');
    ai.reply({ text: '{"name":"a"}' }); ai.reply({ text: '{"name":"b"}' });
    assert.equal((await ask(s)).status, 200);
    assert.equal((await ask(s)).status, 200);
    const st = (await s.call({ path: '/api/llm/status' })).json;
    assert.equal(st.usedToday, 2); assert.equal(st.dailyCap, 2);
    const blocked = await ask(s);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error, 'daily_cap');
    assert.equal(ai.seen.length, 3, 'a refused request is never sent on');
  } finally { s.stop(); ai.close(); }
  const ai2 = await fakeAnthropic();
  const free = await start({ env: { UNFURL_ANTHROPIC_BASE: ai2.url, UNFURL_ANTHROPIC_KEY: OTHER, UNFURL_USER_DAILY_LLM_CALLS: '0' } });
  try { for (let i = 0; i < 4; i++) { ai2.reply({ text: '{"name":"z"}' }); assert.equal((await ask(free)).status, 200, '0 means no cap'); } } finally { free.stop(); ai2.close(); }
});

test('what goes wrong becomes a plain message, and the key is never echoed', async () => {
  const ai = await fakeAnthropic();
  const s = await start({ env: { UNFURL_ANTHROPIC_BASE: ai.url } });
  try {
    await save(s, { key: KEY });
    ai.reply({ status: 401, errorType: 'authentication_error', message: `invalid x-api-key ${KEY}` });
    const bad = await ask(s);
    assert.equal(bad.status, 502); assert.equal(bad.json.error, 'invalid_key');
    assert.ok(!bad.text.includes(KEY) && !bad.text.includes('0123456789'));
    ai.reply({ status: 400, message: `Your credit balance is too low (${KEY})` });
    const poor = await ask(s);
    assert.equal(poor.json.error, 'rejected');
    assert.match(poor.json.message, /credit balance is too low/);
    assert.ok(!poor.text.includes(KEY), 'a key inside an upstream message is scrubbed');
    ai.reply({ text: '', stop: 'refusal' });
    const refused = await ask(s);
    assert.equal(refused.status, 422); assert.equal(refused.json.error, 'refused');
    ai.reply({ text: '{"na', stop: 'max_tokens' });
    assert.equal((await ask(s)).json.error, 'too_long');
    ai.reply({ text: 'this is not json' });
    assert.equal((await ask(s)).json.error, 'bad_answer');
    ai.reply({ raw: '<html>gateway</html>' });
    const garbled = await ask(s);
    assert.equal(garbled.status, 502, 'a garbled upstream body does not crash the server');
    assert.equal(garbled.json.error, 'bad_answer');
    assert.equal((await s.call({ path: '/api/ping' })).status, 200);
  } finally { s.stop(); ai.close(); }
  const down = await start({ env: { UNFURL_ANTHROPIC_BASE: 'http://127.0.0.1:1', UNFURL_ANTHROPIC_KEY: OTHER } });
  try {
    const r = await ask(down);
    assert.equal(r.status, 502); assert.equal(r.json.error, 'unreachable');
    assert.equal((await down.call({ path: '/api/llm/status' })).json.usedToday, 0);
  } finally { down.stop(); }
});

test('it needs the app header and a login, and each login keeps its own key', async () => {
  const ai = await fakeAnthropic();
  const users = path.join(tmp('llm-users'), 'users.txt');
  fs.writeFileSync(users, 'ana:ana-pass\nben:ben-pass\n');
  const dataDir = tmp('llm-multi');
  const s = await start({ dataDir, env: { UNFURL_ANTHROPIC_BASE: ai.url, UNFURL_USERS_FILE: users } });
  try {
    const A = { Authorization: basic('ana', 'ana-pass') }, B = { Authorization: basic('ben', 'ben-pass') };
    assert.equal((await s.call({ path: '/api/llm/status' })).status, 401, 'no login, no coach');
    assert.equal((await raw(s.port, { method: 'POST', path: '/api/llm', headers: { Host: `127.0.0.1:${s.port}`, ...A }, body: { prompt: 'x' } })).status, 403, 'without the app header another website could have sent it');
    await save(s, { key: KEY }, A);
    assert.equal((await s.call({ path: '/api/llm/status', headers: A })).json.ready, true);
    assert.equal((await s.call({ path: '/api/llm/status', headers: B })).json.ready, false, 'Ben does not get to use Ana\'s key');
    assert.ok(fs.existsSync(path.join(dataDir, 'users', 'ana', 'llm.json')) && !fs.existsSync(path.join(dataDir, 'users', 'ben', 'llm.json')));
    assert.equal((await ask(s, {}, B)).status, 400);
    ai.reply({ text: '{"name":"x"}' });
    assert.equal((await ask(s, {}, A)).status, 200);
    assert.equal((await s.call({ path: '/api/llm/status', headers: A })).json.usedToday, 1);
    assert.equal((await s.call({ path: '/api/llm/status', headers: B })).json.usedToday, 0, 'caps are counted per person');
  } finally { s.stop(); ai.close(); }
});

test('the key travels with a backup and comes back with a restore, readable by its owner only', () => {
  const data = tmp('llm-bk'), dest = tmp('llm-bk-dest'), back = tmp('llm-bk-back');
  fs.writeFileSync(path.join(data, 'profile.json'), '{"schema":2}');
  fs.writeFileSync(path.join(data, 'llm.json'), JSON.stringify({ key: KEY, model: 'claude-sonnet-5-5' }));
  const run = (...args) => spawnSync('python3', [SERVE, ...args], { encoding: 'utf8' });
  const made = run('--backup', dest, '--data-dir', data);
  assert.equal(made.status, 0, made.stderr);
  const zip = fs.readdirSync(dest).find((f) => f.endsWith('.zip'));
  const listing = spawnSync('python3', ['-c', 'import zipfile,sys; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', path.join(dest, zip)], { encoding: 'utf8' }).stdout;
  assert.match(listing, /^llm\.json$/m);
  const restored = run('--restore', path.join(dest, zip), '--data-dir', back);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(back, 'llm.json'), 'utf8')).key, KEY);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(back, 'llm.json')).mode & 0o077, 0);
});
