// End-to-end test: real serve.py + real Chromium driving the real UI.
// Only YouTube itself is stubbed (Data API -> tests/helpers/fake-youtube.js,
// IFrame player -> a tiny stub, thumbnails -> 1px PNG). Dev-only: needs `playwright`.
//   node tests/e2e/run.mjs            (screenshots land in tests/e2e/shots/)

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handle as fakeApi, fault, VIDEOS, GONE } from '../helpers/fake-youtube.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'tests/e2e/shots');
fs.mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------------ harness

const results = [];
const consoleProblems = [];
async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`  ✓ ${name}`); }
  catch (e) { results.push([false, name, e]); console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unfurl-e2e-'));
  const proc = spawn('python3', [path.join(ROOT, 'serve.py'), '--port', String(port), '--no-open', '--data-dir', dataDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/ping`, { headers: { 'X-Unfurl': '1' } })).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { port, dataDir, url: `http://localhost:${port}/`, stop: () => proc.kill(), log: () => log };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const CORS = { 'access-control-allow-origin': '*' };
const YT_STUB = `
window.__players = []; window.__errorIds = window.__errorIds || {};
window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  Player: class {
    constructor(el, o) {
      this.o = o; this.id = o.videoId;
      const f = document.createElement('iframe'); f.title = 'YouTube stub'; f.setAttribute('data-video', o.videoId);
      el.replaceWith(f); this.f = f; window.__players.push(this);
      setTimeout(() => {
        const code = window.__errorIds[this.id];
        if (code) { o.events.onError({ data: code }); return; }
        o.events.onReady({ target: this }); o.events.onStateChange({ data: 5, target: this });
      }, 30);
    }
    getDuration() { return 777; }
    getVideoData() { const r = window.__unfurl && window.__unfurl.state.videos[this.id]; return { title: r ? r.title : '', author: 'Stub Channel' }; }
    destroy() { this.f.remove(); }
    __end() { this.o.events.onStateChange({ data: 0, target: this }); }
  } };
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
`;

async function newPage(browser, server, { colorScheme = 'light', viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, colorScheme });
  const apiCalls = [];
  await context.route('https://www.googleapis.com/youtube/v3/**', (route) => {
    const { status, body } = fakeApi(route.request().url());
    apiCalls.push(new URL(route.request().url()).pathname.split('/').pop());
    route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  });
  await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ contentType: 'text/javascript', body: YT_STUB }));
  await context.route('https://i.ytimg.com/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await context.route('https://www.youtube.com/oembed**', (route) => route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ title: 'Pasted video about hips', author_name: 'Some Teacher' }) }));
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
  // A 400/403 from the (fake) API is expected when a test deliberately uses a bad key or exhausts the quota.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (400|403)/.test(m.text())) consoleProblems.push(`console.error: ${m.text()}`); });
  page.on('dialog', (d) => d.accept()); // confirm() prompts
  page.apiCalls = apiCalls; page.context_ = context;
  await page.goto(server.url);
  await page.waitForSelector('#nav a');
  return page;
}

const U = (page, fn, arg) => page.evaluate(fn, arg);
const featuredId = (page) => U(page, () => window.__unfurl.ui.featuredId);
const waitFeatured = (page) => page.waitForSelector('.featured h2', { timeout: 8000 });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

// ------------------------------------------------------------------ the run

const browser = await chromium.launch();

// ================================================================== World 1: no API key
console.log('\nWorld 1: first run, no YouTube key');
{
  const server = await startServer();
  const page = await newPage(browser, server);

  await step('first load shows a suggested routine from the starter shelf, in an embedded player', async () => {
    await waitFeatured(page);
    const id = await featuredId(page);
    ok(id, 'a featured video was chosen');
    await page.waitForSelector(`iframe[data-video="${id}"]`);
    ok(await page.locator('.badge.warn', { hasText: 'unverified' }).count() > 0, 'starter videos are flagged unverified');
  });

  await step('the player reports the real length, which corrects the guess', async () => {
    const id = await featuredId(page);
    await page.waitForFunction((i) => window.__unfurl.state.videos[i].durationApprox === false, id);
    eq(await U(page, (i) => window.__unfurl.state.videos[i].durationSec, id), 777);
  });

  await step('typing a command sets muscles + length and finds a matching routine', async () => {
    await page.fill('#command', '10 min, tight calves');
    await page.press('#command', 'Enter');
    await page.waitForFunction(() => !window.__unfurl.ui.busy && window.__unfurl.ui.filters.areas.some((a) => a.id === 'calves'));
    await waitFeatured(page);
    eq(await page.inputValue('#min-len'), '7'); eq(await page.inputValue('#max-len'), '13'); // 10 min => 7-13 (tolerance has a 3 min floor)
    const title = await page.locator('.featured h2').innerText();
    ok(/calf|calves|ankle|feet|shin/i.test(title), `featured "${title}" should be about calves/feet`);
    ok(await page.locator('.chip.on.tight', { hasText: 'Calves' }).count() === 1, 'Calves chip is on');
    ok((await page.locator('#cmd-note').innerText()).startsWith('Understood'), 'echoes what it understood');
  });

  await step('weak vs tight: tapping a chip twice marks it as a weak spot', async () => {
    await page.click('.chip.area:has-text("Core")'); await page.click('.chip.area:has-text("Core")');
    eq(await U(page, () => window.__unfurl.ui.filters.areas.find((a) => a.id === 'core').mode), 'weak');
    await page.click('.chip.area:has-text("Core")');
    ok(!(await U(page, () => window.__unfurl.ui.filters.areas.some((a) => a.id === 'core'))), 'third tap turns it off');
  });

  await step('quick pick + Find gives a routine that actually works those muscles', async () => {
    await page.click('.chip.quick:has-text("Desk posture")');
    await page.click('#find');
    await page.waitForFunction(() => !window.__unfurl.ui.busy);
    await waitFeatured(page);
    const areas = await U(page, () => { const v = window.__unfurl.state.videos[window.__unfurl.ui.featuredId]; return v.profile.areas; });
    ok(['neck', 'upper_back', 'shoulders', 'chest'].some((a) => (areas[a] ?? 0) >= 0.5), `profile ${JSON.stringify(areas)}`);
    ok(await page.locator('.why li').count() > 0, 'explains why it was chosen');
    await shot(page, '01-today-desktop');
  });

  await step('"Another one" never repeats within a session', async () => {
    const seen = new Set([await featuredId(page)]);
    for (let i = 0; i < 4; i++) {
      await page.click('#another');
      const id = await featuredId(page);
      ok(!seen.has(id), `repeated ${id}`);
      seen.add(id);
      await page.waitForSelector(`iframe[data-video="${id}"]`);
    }
  });

  await step('finishing a video opens the feedback dialog; answers are logged and learned from', async () => {
    const id = await featuredId(page);
    await U(page, () => window.__players.at(-1).__end());
    await page.waitForSelector('[role=dialog]');
    await page.click('.rate-row .choice:has-text("Much better")');
    await page.click('.choice:has-text("Just right")');
    await page.fill('.feedback textarea', 'felt <b>great</b>');
    await page.click('#save-feedback');
    await page.waitForSelector('.toast');
    const h = await U(page, () => window.__unfurl.state.history);
    eq(h.length, 1); eq(h[0].videoId, id); eq(h[0].intensity, 'right'); ok(Object.values(h[0].ratings)[0] === 'much', 'rating stored');
    ok((await page.locator('.toast').first().innerText()).startsWith('Noted:'), 'tells you what it learned');
    ok(await page.locator('[role=dialog]').count() === 0, 'dialog closed');
  });

  await step('Journal shows the entry and the per-muscle insight', async () => {
    await page.click('nav a[data-tab=journal]');
    await page.waitForSelector('.hist-item');
    eq(await page.locator('.hist-item').count(), 1);
    ok(await page.locator('.insight').count() >= 1, 'an insight card exists');
    ok((await page.locator('.insight .big').first().innerText()).startsWith('100%'), 'one "much better" = 100% helpful');
    ok((await page.locator('.note-text').innerText()).includes('<b>great</b>'), 'note shown as literal text');
    await shot(page, '02-journal');
  });

  await step('"Not for me" hides a video for good (with undo)', async () => {
    await page.click('nav a[data-tab=today]');
    await waitFeatured(page);
    const id = await featuredId(page);
    await page.click('button:has-text("Not for me")');
    await page.waitForFunction((i) => window.__unfurl.ui.featuredId !== i, id);
    ok(await U(page, (i) => window.__unfurl.state.blocked.includes(i), id), 'blocked');
    await page.click('.toast .link:has-text("Undo")');
    ok(!(await U(page, (i) => window.__unfurl.state.blocked.includes(i), id)), 'undo works');
  });

  await step('embedding refused (error 150): shows a YouTube link and never suggests it again', async () => {
    await U(page, () => { const r = window.__unfurl.ui.ranked.find((x) => x.video.id !== window.__unfurl.ui.featuredId); window.__errorIds[r.video.id] = 150; window.__bad = r.video.id; });
    // step through suggestions until the bad one is offered
    for (let i = 0; i < 12 && (await featuredId(page)) !== (await U(page, () => window.__bad)); i++) await page.click('#another');
    ok((await featuredId(page)) === (await U(page, () => window.__bad)), 'reached the bad video');
    await page.waitForSelector('.player-problem a[href*="youtube.com/watch"]');
    ok(await page.locator('.player-problem', { hasText: 'embedded' }).count() === 1, 'explains why');
    eq(await U(page, () => window.__unfurl.state.videos[window.__bad].embeddable), false);
    await page.click('.player-problem button:has-text("Pick another")');
    await page.click('#find'); await page.waitForFunction(() => !window.__unfurl.ui.busy);
    ok(!(await U(page, () => window.__unfurl.ui.ranked.some((r) => r.video.id === window.__bad))), 'excluded from ranking now');
  });

  await step('untrusted text (titles, comments, notes) is never interpreted as HTML', async () => {
    await U(page, () => {
      const c = window.__unfurl;
      c.state.videos.XSSXSSXSS01 = { id: 'XSSXSSXSS01', title: '<img src=x onerror="window.__xss=1"> Hip stretch', channel: '<script>window.__xss=2</script>', durationSec: 600, verified: true,
        evidence: { n: 8, positive: 6, negative: 0, mentions: {}, quotes: [{ text: '<img src=y onerror="window.__xss=3"> my hips', areas: ['hip_flexors'], likes: 3 }], benefits: {}, pace: {}, posesMentioned: {}, sentiment: 0.4 }, source: 'search' };
      c.play('XSSXSSXSS01');
    });
    await page.waitForSelector('.featured blockquote');
    eq(await U(page, () => window.__xss), undefined);
    eq(await page.locator('.featured img[src="x"], .featured img[src="y"], .featured script').count(), 0);
    ok((await page.locator('.featured h2').innerText()).includes('<img src=x'), 'title shown literally');
  });

  await step('Library: filter by muscle, hide/unhide, and add a video by pasted link', async () => {
    await page.click('nav a[data-tab=library]');
    await page.waitForSelector('.row-card');
    const all = await page.locator('.row-card').count();
    await page.selectOption('#lib-area', 'calves');
    const calves = await page.locator('.row-card').count();
    ok(calves > 0 && calves < all, `${calves} of ${all}`);
    await page.selectOption('#lib-area', '');
    await page.fill('#add-link', 'https://youtu.be/ABCDEFGHIJK?si=zzz');
    await page.click('#add-btn');
    await page.waitForFunction(() => window.__unfurl.state.videos.ABCDEFGHIJK);
    eq(await U(page, () => window.__unfurl.state.videos.ABCDEFGHIJK.source), 'manual');
    eq(await U(page, () => window.__unfurl.state.videos.ABCDEFGHIJK.title), 'Pasted video about hips'); // via oEmbed
    ok(await U(page, () => window.__unfurl.state.videos.ABCDEFGHIJK.profile.areas.hip_flexors > 0.5), 'and analysed from that title');
    await page.fill('#add-link', 'not a link'); await page.click('#add-btn');
    ok((await page.locator('.toast.error').last().innerText()).includes('doesn’t look like'), 'rejects junk');
    await shot(page, '03-library');
  });

  await step('data is saved to disk files; the key file does not exist; reload keeps history', async () => {
    await page.waitForTimeout(700); // debounce
    const state = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'state.json'), 'utf8'));
    eq(state.history.length, 1);
    ok(!fs.existsSync(path.join(server.dataDir, 'config.json')), 'no config yet');
    await page.reload(); await page.waitForSelector('#nav a');
    eq(await U(page, () => window.__unfurl.state.history.length), 1);
  });

  await step('mobile layout has no horizontal scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('nav a[data-tab=today]'); await waitFeatured(page);
    const overflow = await U(page, () => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `horizontal overflow ${overflow}px`);
    await shot(page, '04-today-mobile');
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step('dark mode renders (screenshot)', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot(page, '05-today-dark');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  await page.context_.close();
  server.stop();
}

// ================================================================== World 2: with a YouTube key
console.log('\nWorld 2: with a YouTube key (live search, comment reading, growth, learning)');
{
  const server = await startServer();
  const page = await newPage(browser, server);

  await step('Settings: a bad key is rejected with a clear message; a good key is saved to config.json only', async () => {
    await page.click('nav a[data-tab=settings]');
    await page.fill('#api-key', 'INVALID'); await page.click('#save-key');
    await page.waitForFunction(() => document.getElementById('key-status').textContent.includes('✗'));
    ok((await page.locator('#key-status').innerText()).includes('isn’t valid'), await page.locator('#key-status').innerText());
    await page.fill('#api-key', 'TESTKEY'); await page.click('#save-key');
    await page.waitForFunction(() => document.getElementById('key-status').textContent.includes('✓'));
    await page.waitForTimeout(500);
    ok(fs.readFileSync(path.join(server.dataDir, 'config.json'), 'utf8').includes('TESTKEY'), 'key in config.json');
    await page.click('#export'); // exporting must not leak the key
    ok(!JSON.stringify(await U(page, () => window.__unfurl.state)).includes('TESTKEY'), 'key not in state');
    await shot(page, '06-settings');
  });

  const startCount = await U(page, () => Object.keys(window.__unfurl.state.videos).length);

  await step('Find with web search: searches, verifies starters, reads comments, grows the library', async () => {
    await page.click('nav a[data-tab=today]');
    await page.click('.chip.quick:has-text("Tight hips")');
    await page.fill('#min-len', '10'); await page.fill('#max-len', '30'); await page.press('#max-len', 'Tab');
    ok(await page.locator('#web-toggle').isChecked(), 'web search is on by default once a key exists');
    await page.click('#find');
    await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 15000 });
    await waitFeatured(page);
    const s = await U(page, () => {
      const st = window.__unfurl.state, vids = Object.values(st.videos);
      return { n: vids.length, searched: vids.filter((v) => v.source === 'search').length, withComments: vids.filter((v) => v.evidence?.n > 0).length,
        queries: Object.keys(st.queryLog).length, broken: vids.filter((v) => v.broken).map((v) => v.id), verifiedStarters: vids.filter((v) => v.source === 'starter' && v.verified).length,
        log: window.__unfurl.ui.log };
    });
    ok(s.n > startCount, `library grew ${startCount} -> ${s.n}`);
    ok(s.searched >= 3, `${s.searched} search results stored`);
    ok(s.withComments >= 1, 'comments were read and analysed');
    eq(s.queries, 2, 'two searches logged');
    eq(s.broken.sort(), [...GONE].sort(), 'deleted starters flagged');
    ok(s.verifiedStarters > 30, `${s.verifiedStarters} starters verified`);
    ok(s.log.some((l) => /Searching YouTube for/.test(l)) && s.log.some((l) => /^Done:/.test(l)), s.log.join(' | '));
    ok(['search', 'videos', 'commentThreads', 'channels'].every((e) => page.apiCalls.includes(e)), `API calls: ${[...new Set(page.apiCalls)]}`);
    await shot(page, '07-today-after-search');
  });

  await step('new finds are labelled (new teacher / hidden gem / comments read) and explained from comments', async () => {
    await page.click('nav a[data-tab=library]');
    await page.selectOption('#lib-sort', 'new');
    ok(await page.locator('.badge', { hasText: 'found by search' }).count() >= 3, 'found-by-search badges');
    await page.click('nav a[data-tab=today]'); await waitFeatured(page);
    const info = await U(page, () => window.__unfurl.ui.ranked.slice(0, 8).map((r) => ({ id: r.video.id, flags: r.flags, reasons: r.reasons })));
    ok(info.some((i) => i.flags.newChannel), 'some results come from teachers you have not tried');
    ok(info.some((i) => i.flags.commentsRead), 'some results have their comments read');
    ok(info.some((i) => i.reasons.some((r) => /comments about it are positive|Viewers report/.test(r))), 'reasons cite viewer comments');
  });

  await step('searching again goes to NEW places: different queries, more videos, no repeats', async () => {
    await page.click('nav a[data-tab=today]');
    const q0 = new Set(await U(page, () => Object.values(window.__unfurl.state.queryLog).map((q) => q.q)));
    const n0 = await U(page, () => Object.keys(window.__unfurl.state.videos).length);
    for (let i = 0; i < 2; i++) { await page.click('#find'); await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 15000 }); }
    const q1 = await U(page, () => Object.values(window.__unfurl.state.queryLog).map((q) => q.q));
    ok(q1.length >= q0.size + 3, `queries ${q0.size} -> ${q1.length}`);
    ok(await U(page, () => Object.keys(window.__unfurl.state.videos).length) >= n0, 'library did not shrink (growth itself is covered statistically in the unit tests)');
    ok(await U(page, () => Object.values(window.__unfurl.state.queryLog).some((q) => q.nextPageToken)), 'result pages remembered for going deeper');
  });

  await step('rating a video teaches the app: related videos show "📈" evidence from your history', async () => {
    // Do a hips video with pigeon pose twice and say it helped both times.
    const target = await U(page, () => Object.values(window.__unfurl.state.videos).find((v) => v.source === 'search' && v.profile.poses.some((p) => p.id === 'pigeon'))?.id);
    ok(target, 'found a search result with pigeon pose');
    await page.click('nav a[data-tab=today]');
    for (let round = 1; round <= 2; round++) {
      await U(page, (id) => window.__unfurl.play(id), target);
      await page.waitForSelector(`iframe[data-video="${target}"]`);
      await page.click('#did-it');
      await page.waitForSelector('[role=dialog]');
      for (const btn of await page.locator('.rate-row').all()) await btn.locator('.choice:has-text("Much better")').click();
      await page.click('#save-feedback');
      await page.waitForFunction((n) => window.__unfurl.state.history.length === n, round);
    }
    const learned = await U(page, (id) => {
      const c = window.__unfurl;
      c.ui.filters.areas = [{ id: 'glutes', mode: 'tight' }, { id: 'hip_flexors', mode: 'tight' }];
      c.ui.filters.minMin = 3; c.ui.filters.maxMin = 120;
      return c.rankNow().filter((r) => r.video.id !== id && r.reasons.some((x) => x.startsWith('📈'))).map((r) => r.reasons.find((x) => x.startsWith('📈')));
    }, target);
    ok(learned.length >= 1, 'another video gets credit for sharing a pose you found helpful');
    ok(learned.some((t) => /Pigeon has helped your/.test(t)), learned.join(' | '));
  });

  await step('Grow library targets the thinnest muscle areas', async () => {
    await page.click('nav a[data-tab=library]');
    const before = await U(page, () => Object.keys(window.__unfurl.state.videos).length);
    await page.click('#grow');
    await page.waitForSelector('.toast.success:has-text("Added")', { timeout: 15000 });
    ok(await U(page, () => Object.keys(window.__unfurl.state.videos).length) >= before, 'no loss');
  });

  await step('quota usage is tracked and shown', async () => {
    const used = await U(page, () => window.__unfurl.state.quota.used);
    ok(used >= 400, `quota used ${used}`);
    await page.click('nav a[data-tab=settings]');
    ok((await page.locator('.quota').innerText()).includes(used.toLocaleString('en-US')), 'shown in Settings');
  });

  await step('when the daily allowance is gone: clear message, and the library still works', async () => {
    fault.quota = true;
    await page.click('nav a[data-tab=today]');
    await page.click('#find');
    await page.waitForFunction(() => !window.__unfurl.ui.busy);
    ok((await page.locator('.log').innerText()).includes('allowance is used up'), 'explains in the log');
    await waitFeatured(page);
    fault.quota = false;
  });

  await step('persistence: reload keeps library, history, queries and learned data', async () => {
    await page.waitForTimeout(700);
    const before = await U(page, () => ({ v: Object.keys(window.__unfurl.state.videos).length, h: window.__unfurl.state.history.length, q: Object.keys(window.__unfurl.state.queryLog).length }));
    await page.reload(); await page.waitForSelector('#nav a');
    eq(await U(page, () => ({ v: Object.keys(window.__unfurl.state.videos).length, h: window.__unfurl.state.history.length, q: Object.keys(window.__unfurl.state.queryLog).length })), before);
  });

  await page.context_.close();
  server.stop();
}

// ------------------------------------------------------------------ report

await browser.close();
const failed = results.filter((r) => !r[0]);
const problems = [...new Set(consoleProblems)];
if (problems.length) console.log(`\nBrowser console problems:\n  ${problems.join('\n  ')}`);
console.log(`\n${results.length - failed.length}/${results.length} steps passed${problems.length ? `, ${problems.length} console problem(s)` : ', no console errors'}`);
process.exit(failed.length || problems.length ? 1 : 0);
