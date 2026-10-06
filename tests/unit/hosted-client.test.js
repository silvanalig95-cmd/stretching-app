// The browser side of hosting: a server-held YouTube key, per-person quota messages, and noticing a new deployed version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeClient, QuotaError, KeyError, PROXY_BASE } from '../../js/youtube.js';
import { Store } from '../../js/store.js';
import { ctx, client, quotaInfo } from '../../js/ctx.js';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
globalThis.location = { href: 'https://unfurl.internal/' };

test('without a key of its own the client calls the server\'s proxy and sends no key', async () => {
  const urls = [];
  const c = new YouTubeClient({ key: '', base: PROXY_BASE, fetchFn: async (u) => { urls.push(u); return json({ items: [] }); } });
  assert.equal(c.proxied, true);
  await c.search({ q: 'hip opener' });
  const u = new URL(urls[0]);
  assert.equal(u.origin + u.pathname, 'https://unfurl.internal/api/yt/search');
  assert.equal(u.searchParams.get('q'), 'hip opener');
  assert.ok(!u.searchParams.has('key'), 'the browser never sends or holds a key in this mode');
  assert.equal(c.spentUnits, 100, 'the person\'s own usage is still counted');
});

test('a client with its own key still talks to Google directly', async () => {
  const urls = [];
  const c = new YouTubeClient({ key: 'MINE', fetchFn: async (u) => { urls.push(u); return json({ items: [] }); } });
  await c.videos(['a']);
  assert.match(urls[0], /^https:\/\/www\.googleapis\.com\/youtube\/v3\/videos\?/);
  assert.match(urls[0], /key=MINE/);
  assert.equal(c.proxied, false);
});

test('the server\'s own "your share is used up" message reaches the person; a broken server key is described honestly', async () => {
  const quota = { error: { code: 403, message: 'Your share of today\'s YouTube allowance on this server is used up.', errors: [{ reason: 'quotaExceeded', domain: 'unfurl' }] } };
  const c = new YouTubeClient({ key: '', base: PROXY_BASE, fetchFn: async () => json(quota, 403) });
  await assert.rejects(() => c.videos(['a']), (e) => e instanceof QuotaError && /share of today/.test(e.message) && /midnight Pacific/.test(e.message));
  const bad = { error: { code: 400, message: 'API key not valid', errors: [{ reason: 'keyInvalid' }] } };
  const k = new YouTubeClient({ key: '', base: PROXY_BASE, fetchFn: async () => json(bad, 400) });
  await assert.rejects(() => k.videos(['a']), (e) => e instanceof KeyError && /kept on this server/.test(e.message));
  const own = new YouTubeClient({ key: 'MINE', fetchFn: async () => json(bad, 400) });
  await assert.rejects(() => own.videos(['a']), (e) => e instanceof KeyError && /isn’t valid\. Check it in Settings/.test(e.message));
  const offline = new YouTubeClient({ key: '', base: PROXY_BASE, fetchFn: async () => { throw new Error('down'); } });
  await assert.rejects(() => offline.videos(['a']), /reach the Olympus server/);
});

function serverStore(ping, fetchExtra = async () => null) {
  let current = ping;
  const fetchFn = async (url, opts = {}) => {
    if (url === '/api/ping') return json(current);
    if (url === '/api/profile') return json({ data: null, recoveredFrom: null });
    if (['/api/index', '/api/config', '/api/legacy'].includes(url)) return json(null);
    return (await fetchExtra(url, opts)) ?? json({ ok: true });
  };
  return { fetchFn, set: (p) => { current = p; } };
}

test('the page learns from the server whether it holds the YouTube key, who you are, and your daily share', async () => {
  const srv = serverStore({ app: 'unfurl', version: '0.3.0', build: 'abc123', pollSeconds: 30, ytProxy: true, ytDailyUnits: 3000, user: 'ana', multiUser: true });
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.deepEqual(store.server, { version: '0.3.0', dataDir: null, build: 'abc123', pollSeconds: 30, ytProxy: true, ytDailyUnits: 3000, user: 'ana', multiUser: true });
  ctx.store = store;
  assert.equal(ctx.hasKey, true, 'searching works with no personal key');
  assert.equal(ctx.usesServerKey, true);
  assert.equal(client().proxied, true);
  assert.equal(quotaInfo().limit, 3000, 'the allowance shown is the person\'s share, not Google\'s 10,000');
  store.config.apiKey = 'MY-OWN';
  assert.equal(ctx.usesServerKey, false);
  assert.equal(client().proxied, false, 'a key the person pasted wins');
  assert.equal(quotaInfo().limit, 10000);
});

test('an older server (or none) simply means no proxy', async () => {
  const srv = serverStore({ app: 'unfurl', version: '0.2.0', dataDir: '/d' });
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  ctx.store = store;
  assert.equal(store.server.ytProxy, false);
  assert.equal(ctx.hasKey, false);
  assert.equal(client(), null);
  assert.equal(store.server.pollSeconds, 0, 'no polling unless the server asks for it');
});

test('currentBuild() sees a deployment, and a restarting server is not an error', async () => {
  const srv = serverStore({ app: 'unfurl', version: '0.3.0', build: 'aaa', pollSeconds: 60 });
  const store = await new Store({ fetchFn: srv.fetchFn }).init();
  assert.equal((await store.currentBuild()).build, 'aaa');
  srv.set({ app: 'unfurl', version: '0.3.1', build: 'bbb', pollSeconds: 60 });
  assert.deepEqual(await store.currentBuild(), { build: 'bbb', version: '0.3.1' });
  store.fetchFn = async () => { throw new Error('connection refused'); };
  assert.equal(await store.currentBuild(), null);
  const local = await new Store({ fetchFn: async () => { throw new Error('no server'); }, storage: null }).init();
  assert.equal(await local.currentBuild(), null);
});

test('when the server refuses the address the page was opened with, the page says so and does not quietly save into the browser', async () => {
  const fetchFn = async (url) => {
    if (url === '/api/ping') return { ok: false, status: 403, json: async () => ({ error: 'forbidden', reason: 'host', host: 'sneaky.example', allowed: ['mypc', '192.168.1.50'] }) };
    return { ok: false, status: 403, json: async () => ({}) };
  };
  const storage = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } };
  const store = await new Store({ fetchFn, storage }).init();
  assert.deepEqual(store.hostProblem, { host: 'sneaky.example', allowed: ['mypc', '192.168.1.50'] });
  assert.equal(store.mode, 'local');
  assert.equal(store.readOnly, true, 'nothing is written');
  store.save(); await store.flush();
  assert.equal(storage.m.size, 0, 'and nothing lands in the browser either');
});

test('an ordinary 403 (or an unreachable server) is not mistaken for a refused address', async () => {
  const a = await new Store({ fetchFn: async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden', reason: 'header' }) }), storage: null }).init();
  assert.equal(a.hostProblem, null);
  const b = await new Store({ fetchFn: async () => { throw new Error('offline'); }, storage: null }).init();
  assert.equal(b.hostProblem, null);
  assert.equal(b.readOnly, false);
});
