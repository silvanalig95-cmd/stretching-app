// The optional AI helper, server side: the browser asks, serve.py holds the Gemini key and makes the call.
// A fake Gemini server stands in for generativelanguage.googleapis.com; no real key or network is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeGemini } from '../helpers/fake-gemini.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVE = path.join(ROOT, 'serve.py');
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `unfurl-${p}-`));
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const KEY = 'AIzaSy-TEST-ONLY-0123456789abcdefWXYZ00';   // not a real key
const OTHER = 'AIzaSy-SERVER-SIDE-0123456789abcdefQRST';

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

async function start({ env = {}, dataDir = tmp('gem') } = {}) {
  const port = await freePort();
  const proc = spawn('python3', [SERVE, '--port', String(port), '--no-open', '--data-dir', dataDir, '--legacy-dir', tmp('legacy')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, UNFURL_BUILD: 'test-build', ...env } });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  for (let i = 0; i < 80; i++) { try { await raw(port, { path: '/', headers: { Host: `127.0.0.1:${port}` } }); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const call = (opts = {}) => raw(port, { ...opts, headers: { Host: `127.0.0.1:${port}`, 'X-Unfurl': '1', ...(opts.headers || {}) } });
  return { port, dataDir, call, err: () => err, stop: () => proc.kill() };
}

const ask = (s, body = {}, headers = {}) => s.call({ method: 'POST', path: '/api/gemini/generate', headers, body: { system: 'You read yoga videos.', prompt: 'List the sections as JSON.', ...body } });
const save = (s, body, headers = {}) => s.call({ method: 'PUT', path: '/api/gemini/settings', headers, body });
const VID = 'dQw4w9WgXcQ';

test('with no key anywhere the helper says so and nothing leaves the server', async () => {
  const ai = await fakeGemini();
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url } });
  try {
    const st = await s.call({ path: '/api/gemini/status' });
    assert.equal(st.status, 200);
    assert.equal(st.json.ready, false); assert.equal(st.json.source, null);
    assert.equal(st.json.model, 'gemini-flash-latest', 'an alias Google keeps pointing at its newest fast model');
    assert.equal((await ask(s)).json.error, 'no_key');
    assert.equal((await s.call({ path: '/api/gemini/models' })).status, 400);
    assert.equal(ai.seen.length, 0);
  } finally { s.stop(); ai.close(); }
});

test('your own key: saved privately, never sent back, used for the call, with the request shaped the way Google documents it', async () => {
  const ai = await fakeGemini({ keys: [KEY] });
  const dataDir = tmp('gem-own');
  const s = await start({ dataDir, env: { UNFURL_GEMINI_BASE: ai.url } });
  try {
    assert.equal((await save(s, { key: 'short' })).status, 400, 'something that is not shaped like a key is refused');
    assert.equal((await save(s, { key: 'has spaces and !! ' + 'x'.repeat(30) })).status, 400);
    const saved = await save(s, { key: `  ${KEY}  ` });
    assert.equal(saved.status, 200);
    assert.deepEqual([saved.json.ready, saved.json.source, saved.json.ownKey], [true, 'own', '…YZ00'], 'only a hint of the last characters comes back');
    for (const route of ['/api/gemini/status', '/api/ping', '/api/config', '/api/profile']) assert.ok(!(await s.call({ path: route })).text.includes('0123456789abcdef'), `${route} must not reveal the key`);
    assert.ok(!saved.text.includes(KEY));
    const file = path.join(dataDir, 'ai.json');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).key, KEY);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'readable by the owner only');

    ai.reply({ text: JSON.stringify({ sections: [] }) });
    const r = await ask(s);
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.ok, r.json.text, r.json.finishReason], [true, '{"sections":[]}', 'STOP']);
    assert.equal(r.json.usage.totalTokenCount, 5000);
    const sent = ai.seen[0];
    assert.equal(sent.method, 'POST');
    assert.equal(sent.path, '/v1beta/models/gemini-flash-latest:generateContent');
    assert.equal(sent.headers['x-goog-api-key'], KEY, 'the key goes in the header, not the address');
    assert.ok(!sent.path.includes(KEY));
    assert.deepEqual(sent.body.contents, [{ role: 'user', parts: [{ text: 'List the sections as JSON.' }] }]);
    assert.deepEqual(sent.body.systemInstruction, { parts: [{ text: 'You read yoga videos.' }] });
    assert.deepEqual(sent.body.generationConfig, { temperature: 0.2, maxOutputTokens: 8000, responseMimeType: 'application/json' });
    assert.ok(!('tools' in sent.body), 'no search unless asked');

    const cleared = await save(s, { key: '' });
    assert.equal(cleared.json.ready, false);
    assert.ok(!JSON.parse(fs.readFileSync(file, 'utf8')).key);
    assert.equal((await ask(s)).status, 400, 'with the key removed it stops working');
  } finally { s.stop(); ai.close(); }
});

test('Gemini can be handed a YouTube video, and only a YouTube video: the link is built here from an id', async () => {
  const ai = await fakeGemini();
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url, UNFURL_GEMINI_KEY: OTHER } });
  try {
    ai.reply({ text: '{"ok":1}' });
    assert.equal((await ask(s, { video: VID })).status, 200);
    const sent = ai.seen[0].body;
    assert.deepEqual(sent.contents[0].parts, [{ file_data: { file_uri: `https://www.youtube.com/watch?v=${VID}` } }, { text: 'List the sections as JSON.' }], 'the video comes first, then the question');
    assert.equal(sent.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW', 'a yoga class needs the poses, not fine detail');
    ai.reply({ text: '{"ok":1}' });
    await ask(s, { video: VID, lowRes: false });
    assert.ok(!('mediaResolution' in ai.seen[1].body.generationConfig));
    for (const bad of ['x', 'https://evil.example/v.mp4', `${VID}x`, '../../etc/passwd', '', 5, {}, ['a']]) assert.equal((await ask(s, { video: bad })).status, 400, `video ${JSON.stringify(bad)}`);
    assert.equal(ai.seen.length, 2, 'nothing but a video id ever becomes a link');
    // a model that does not take the setting: ask again without it
    ai.reply({ status: 400, message: 'Invalid JSON payload received. Unknown name "mediaResolution" at \'generation_config\': Cannot find field.' });
    ai.reply({ text: '{"ok":2}' });
    const retried = await ask(s, { video: VID });
    assert.equal(retried.status, 200); assert.equal(retried.json.text, '{"ok":2}');
    assert.ok('mediaResolution' in ai.seen[2].body.generationConfig && !('mediaResolution' in ai.seen[3].body.generationConfig), 'retried once, without it');
  } finally { s.stop(); ai.close(); }
});

test('a search-grounded answer is plain text, and brings its sources and queries back', async () => {
  const ai = await fakeGemini();
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url, UNFURL_GEMINI_KEY: OTHER } });
  try {
    ai.reply({ text: 'Teacher A (https://x)', grounding: { webSearchQueries: ['best yin yoga channels'], groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'A list' } }, { web: { uri: 'javascript:alert(1)', title: 'bad' } }, { web: { title: 'no link' } }, {}] } });
    const r = await ask(s, { search: true });
    assert.equal(r.status, 200);
    assert.deepEqual(ai.seen[0].body.tools, [{ google_search: {} }]);
    assert.ok(!('responseMimeType' in ai.seen[0].body.generationConfig), 'JSON mode and search together are not reliable, so only one is asked for');
    assert.deepEqual(r.json.sources, [{ uri: 'https://example.com/a', title: 'A list' }], 'only real web links are passed on');
    assert.deepEqual(r.json.queries, ['best yin yoga channels']);
  } finally { s.stop(); ai.close(); }
});

test('the models list comes from Google: only Gemini models that can generate, across pages, sorted', async () => {
  const ai = await fakeGemini({ keys: [KEY], pageSize: 2 });
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url } });
  try {
    await save(s, { key: KEY });
    const r = await s.call({ path: '/api/gemini/models' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.models.map((m) => m.id), ['gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'], 'no embedding model, no non-Gemini model');
    assert.equal(r.json.models[3].displayName, 'Gemini Flash Latest');
    assert.ok(ai.seen.length >= 3, 'it followed the pages');
    assert.ok(ai.seen.every((x) => x.headers['x-goog-api-key'] === KEY && !x.path.includes(KEY)));
    await save(s, { key: 'WRONGKEY-0123456789abcdefghij' });
    const bad = await s.call({ path: '/api/gemini/models' });
    assert.equal(bad.status, 502); assert.equal(bad.json.error, 'invalid_key');
  } finally { s.stop(); ai.close(); }
});

test('a key kept on the server works for everyone; a person\'s own key wins; the model can be chosen', async () => {
  const ai = await fakeGemini();
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url, UNFURL_GEMINI_KEY: OTHER } });
  try {
    assert.equal((await s.call({ path: '/api/gemini/status' })).json.source, 'server');
    ai.reply({ text: '{"a":1}' });
    assert.equal((await ask(s)).status, 200);
    assert.equal(ai.seen[0].headers['x-goog-api-key'], OTHER);
    assert.ok(!(await s.call({ path: '/api/ping' })).text.includes('SERVER-SIDE') && !(await s.call({ path: '/api/gemini/status' })).text.includes('SERVER-SIDE'), 'the shared key is never revealed');
    await save(s, { key: KEY });
    ai.reply({ text: '{"a":1}' }); await ask(s);
    assert.equal(ai.seen[1].headers['x-goog-api-key'], KEY, 'their own key is used instead');
    for (const bad of ['gpt-4', 'gemini/../../x', 'gemini-', 'Gemini-Flash', 5]) assert.equal((await save(s, { model: bad })).status, 400, `model ${JSON.stringify(bad)}`);
    const chosen = await save(s, { model: 'gemini-3-flash-preview' });
    assert.deepEqual([chosen.json.model, chosen.json.chosenModel], ['gemini-3-flash-preview', 'gemini-3-flash-preview']);
    ai.reply({ text: '{"a":1}' }); await ask(s);
    assert.equal(ai.seen[2].path, '/v1beta/models/gemini-3-flash-preview:generateContent');
    await save(s, { key: '', model: '' });
    ai.reply({ text: '{"a":1}' }); await ask(s);
    assert.equal(ai.seen[3].headers['x-goog-api-key'], OTHER, 'without their own key the server\'s one is used again');
    assert.equal(ai.seen[3].path, '/v1beta/models/gemini-flash-latest:generateContent');
  } finally { s.stop(); ai.close(); }
});

test('the server\'s default model can be set, and a nonsense value stops the server with a clear message', async () => {
  const ai = await fakeGemini();
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url, UNFURL_GEMINI_KEY: OTHER, UNFURL_GEMINI_MODEL: 'gemini-3.1-flash-lite' } });
  try {
    assert.equal((await s.call({ path: '/api/gemini/status' })).json.model, 'gemini-3.1-flash-lite');
    ai.reply({ text: '{"a":1}' }); await ask(s);
    assert.equal(ai.seen[0].path, '/v1beta/models/gemini-3.1-flash-lite:generateContent');
  } finally { s.stop(); ai.close(); }
  const bad = spawnSync('python3', [SERVE, '--no-open', '--port', String(await freePort()), '--data-dir', tmp('bad-model')], { encoding: 'utf8', env: { ...process.env, UNFURL_GEMINI_MODEL: 'not a model!' }, timeout: 20000 });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /UNFURL_GEMINI_MODEL/);
});

test('requests are checked and clamped before anything is sent; thinking is not part of the answer', async () => {
  const ai = await fakeGemini();
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url, UNFURL_GEMINI_KEY: OTHER } });
  try {
    for (const bad of [{ prompt: '' }, { prompt: '   ' }, { prompt: 5 }, { system: 5 }, { prompt: 'x'.repeat(60001) }, { system: 'x'.repeat(60001) }, { maxTokens: 'lots' }, { maxTokens: true }, { search: 'yes' }, { json: 1 }, { lowRes: null }]) {
      assert.equal((await ask(s, bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
    assert.equal((await s.call({ method: 'POST', path: '/api/gemini/generate', body: 'not json' })).status, 400);
    assert.equal(ai.seen.length, 0, 'none of that reached Google');
    ai.reply({ text: '{"a":1}', thought: 'let me think about this…' });
    const r = await ask(s, { maxTokens: 999999, system: '' });
    assert.equal(ai.seen[0].body.generationConfig.maxOutputTokens, 16000, 'the answer size is capped by the server');
    assert.ok(!('systemInstruction' in ai.seen[0].body), 'no instructions: none are sent');
    assert.equal(r.json.text, '{"a":1}', 'the model\'s thinking is left out');
    ai.reply({ text: 'plain words' });
    const plain = await ask(s, { json: false });
    assert.equal(plain.json.text, 'plain words');
    assert.ok(!('responseMimeType' in ai.seen[1].body.generationConfig));
  } finally { s.stop(); ai.close(); }
});

test('each person has a daily cap; requests that got no answer are not counted', async () => {
  const ai = await fakeGemini();
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url, UNFURL_GEMINI_KEY: OTHER, UNFURL_USER_DAILY_AI_CALLS: '2' } });
  try {
    ai.reply({ status: 429, message: 'Resource has been exhausted (e.g. check quota).', errorStatus: 'RESOURCE_EXHAUSTED' });
    const busy = await ask(s);
    assert.equal(busy.status, 502); assert.equal(busy.json.error, 'busy');
    assert.match(busy.json.message, /rate limit|allowance/);
    assert.equal((await s.call({ path: '/api/gemini/status' })).json.usedToday, 0, 'a rate-limited request costs nothing');
    ai.reply({ text: '{"a":1}' }); ai.reply({ text: '{"a":2}' });
    assert.equal((await ask(s)).status, 200);
    assert.equal((await ask(s)).status, 200);
    const st = (await s.call({ path: '/api/gemini/status' })).json;
    assert.deepEqual([st.usedToday, st.dailyCap], [2, 2]);
    const blocked = await ask(s);
    assert.equal(blocked.status, 429); assert.equal(blocked.json.error, 'daily_cap');
    assert.equal(ai.seen.length, 3, 'a refused request is never sent on');
  } finally { s.stop(); ai.close(); }
  const ai2 = await fakeGemini();
  const free = await start({ env: { UNFURL_GEMINI_BASE: ai2.url, UNFURL_GEMINI_KEY: OTHER, UNFURL_USER_DAILY_AI_CALLS: '0' } });
  try { for (let i = 0; i < 4; i++) { ai2.reply({ text: '{"a":1}' }); assert.equal((await ask(free)).status, 200, '0 means no cap'); } } finally { free.stop(); ai2.close(); }
});

test('what goes wrong becomes a plain message, and the key is never echoed', async () => {
  const ai = await fakeGemini();
  const s = await start({ env: { UNFURL_GEMINI_BASE: ai.url } });
  try {
    await save(s, { key: KEY });
    ai.reply({ status: 400, message: `API key not valid. Please pass a valid API key. (${KEY})`, errorStatus: 'INVALID_ARGUMENT' });
    const bad = await ask(s);
    assert.equal(bad.status, 502); assert.equal(bad.json.error, 'invalid_key');
    assert.ok(!bad.text.includes(KEY) && !bad.text.includes('0123456789'));
    ai.reply({ status: 403, message: 'Gemini API has not been used in project 123 before or it is disabled.' });
    assert.equal((await ask(s)).json.error, 'invalid_key');
    ai.reply({ status: 404, message: 'models/gemini-x is not found' });
    assert.equal((await ask(s)).json.error, 'model');
    ai.reply({ status: 400, message: `Video unavailable or private (${KEY})` });
    const rejected = await ask(s, { video: VID });
    assert.equal(rejected.json.error, 'rejected'); assert.match(rejected.json.message, /Video unavailable or private/);
    assert.ok(!rejected.text.includes(KEY), 'a key inside an upstream message is scrubbed');
    ai.reply({ status: 503, message: 'The model is overloaded.' });
    assert.equal((await ask(s)).json.error, 'busy');
    ai.reply({ blockReason: 'PROHIBITED_CONTENT' });
    const blocked = await ask(s);
    assert.equal(blocked.status, 422); assert.equal(blocked.json.error, 'refused');
    ai.reply({ text: 'x', finish: 'SAFETY' });
    assert.equal((await ask(s)).json.error, 'refused');
    ai.reply({ text: '{"na', finish: 'MAX_TOKENS' });
    assert.equal((await ask(s)).json.error, 'too_long', 'a cut-off JSON answer is no answer');
    ai.reply({ text: 'a long grounded answer, cut off', finish: 'MAX_TOKENS' });
    assert.equal((await ask(s, { search: true })).status, 200, 'but cut-off prose is still useful');
    ai.reply({ text: undefined, thought: 'thinking…', finish: 'MAX_TOKENS' });
    assert.equal((await ask(s)).json.error, 'too_long', 'all the allowance spent thinking');
    ai.reply({ text: '' });
    assert.equal((await ask(s)).json.error, 'empty');
    ai.reply({ raw: '<html>gateway</html>' });
    const garbled = await ask(s);
    assert.equal(garbled.status, 502, 'a garbled upstream body does not crash the server');
    assert.equal((await s.call({ path: '/api/ping' })).status, 200);
  } finally { s.stop(); ai.close(); }
  const down = await start({ env: { UNFURL_GEMINI_BASE: 'http://127.0.0.1:1', UNFURL_GEMINI_KEY: OTHER } });
  try {
    const r = await ask(down);
    assert.equal(r.status, 502); assert.equal(r.json.error, 'unreachable');
    assert.equal((await down.call({ path: '/api/gemini/status' })).json.usedToday, 0);
    assert.equal((await down.call({ path: '/api/gemini/models' })).json.error, 'unreachable');
  } finally { down.stop(); }
});

test('it needs the app header and a login, and each login keeps its own key', async () => {
  const ai = await fakeGemini();
  const users = path.join(tmp('gem-users'), 'users.txt');
  fs.writeFileSync(users, 'ana:ana-pass\nben:ben-pass\n');
  const dataDir = tmp('gem-multi');
  const s = await start({ dataDir, env: { UNFURL_GEMINI_BASE: ai.url, UNFURL_USERS_FILE: users } });
  try {
    const A = { Authorization: basic('ana', 'ana-pass') }, B = { Authorization: basic('ben', 'ben-pass') };
    assert.equal((await s.call({ path: '/api/gemini/status' })).status, 401, 'no login, no helper');
    assert.equal((await raw(s.port, { method: 'POST', path: '/api/gemini/generate', headers: { Host: `127.0.0.1:${s.port}`, ...A }, body: { prompt: 'x' } })).status, 403, 'without the app header another website could have used your login');
    await save(s, { key: KEY }, A);
    assert.equal((await s.call({ path: '/api/gemini/status', headers: A })).json.ready, true);
    assert.equal((await s.call({ path: '/api/gemini/status', headers: B })).json.ready, false, 'Ben does not get to use Ana\'s key');
    assert.ok(fs.existsSync(path.join(dataDir, 'users', 'ana', 'ai.json')) && !fs.existsSync(path.join(dataDir, 'users', 'ben', 'ai.json')));
    assert.equal((await ask(s, {}, B)).status, 400);
    ai.reply({ text: '{"a":1}' });
    assert.equal((await ask(s, {}, A)).status, 200);
    assert.equal((await s.call({ path: '/api/gemini/status', headers: A })).json.usedToday, 1);
    assert.equal((await s.call({ path: '/api/gemini/status', headers: B })).json.usedToday, 0, 'caps are counted per person');
  } finally { s.stop(); ai.close(); }
});

test('the key travels with a backup and comes back with a restore, readable by its owner only', () => {
  const data = tmp('gem-bk'), dest = tmp('gem-bk-dest'), back = tmp('gem-bk-back');
  fs.writeFileSync(path.join(data, 'profile.json'), '{"schema":2}');
  fs.writeFileSync(path.join(data, 'ai.json'), JSON.stringify({ key: KEY, model: 'gemini-flash-latest' }));
  const run = (...args) => spawnSync('python3', [SERVE, ...args], { encoding: 'utf8' });
  const made = run('--backup', dest, '--data-dir', data);
  assert.equal(made.status, 0, made.stderr);
  const zip = fs.readdirSync(dest).find((f) => f.endsWith('.zip'));
  const listing = spawnSync('python3', ['-c', 'import zipfile,sys; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', path.join(dest, zip)], { encoding: 'utf8' }).stdout;
  assert.match(listing, /^ai\.json$/m);
  const restored = run('--restore', path.join(dest, zip), '--data-dir', back);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(back, 'ai.json'), 'utf8')).key, KEY);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(back, 'ai.json')).mode & 0o077, 0);
});
