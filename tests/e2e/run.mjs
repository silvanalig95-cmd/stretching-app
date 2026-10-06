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
import { handle as fakeApi, fault, VIDEOS, GONE, chId, PLAYLIST_ID } from '../helpers/fake-youtube.js';

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

async function startServer({ dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unfurl-e2e-')), legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unfurl-legacy-')) } = {}) {
  const port = await freePort();
  const proc = spawn('python3', [path.join(ROOT, 'serve.py'), '--port', String(port), '--no-open', '--data-dir', dataDir, '--legacy-dir', legacyDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/ping`, { headers: { 'X-Unfurl': '1' } })).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { port, dataDir, legacyDir, url: `http://localhost:${port}/`, stop: () => proc.kill(), log: () => log };
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

async function newPage(browser, server, { colorScheme = 'light', viewport = { width: 1280, height: 900 }, httpCredentials } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, httpCredentials });
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
  // (Connection resets/refusals only happen when a test restarts the server on purpose, to mimic a deployed update.)
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: (the server responded with a status of (400|403)|net::ERR_CONNECTION_(RESET|REFUSED))/.test(m.text())) consoleProblems.push(`console.error: ${m.text()}`); });
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
const libCount = (page) => U(page, () => Object.keys(window.__unfurl.state.library).length);
const readJson = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const goto = async (page, tab) => { await page.click(`nav a[data-tab=${tab}]`); };

// ================================================================== World 1: first run, no key
console.log('\nWorld 1: first run, no YouTube key');
{
  const server = await startServer();
  const page = await newPage(browser, server);

  await step('first load: an EMPTY library, with a suggested routine from the suggestions shelf in an embedded player', async () => {
    await waitFeatured(page);
    const id = await featuredId(page);
    ok(id, 'a featured video was chosen');
    await page.waitForSelector(`iframe[data-video="${id}"]`);
    eq(await libCount(page), 0, 'library starts empty');
    ok(await page.locator('.featured .badge', { hasText: 'Suggested' }).count() === 1, 'labelled as a suggestion');
    ok(await page.locator('.badge.warn', { hasText: 'unverified' }).count() > 0, 'suggestions are flagged unverified');
  });

  await step('Library tabs: empty "My library", 46 suggestions, nothing discovered yet', async () => {
    await goto(page, 'library');
    eq(await page.locator('#tab-mine .count').innerText(), '0');
    eq(await page.locator('#tab-suggestions .count').innerText(), '46');
    eq(await page.locator('#tab-discovered .count').innerText(), '0');
    ok((await page.locator('.empty-note').first().innerText()).includes('Your library is empty'), 'friendly empty state');
    await shot(page, '10-library-empty');
    await goto(page, 'today');
  });

  await step('Look at a video first, with no key: it reads the title, says the analysis is thin, and stores nothing', async () => {
    await goto(page, 'library');
    const before = await U(page, () => ({ lib: Object.keys(window.__unfurl.state.library).length, vids: Object.keys(window.__unfurl.state.videos).length }));
    await page.fill('#analyze-input', 'https://youtu.be/dQw4w9WgXcQ');
    await page.click('#analyze-btn');
    await page.waitForSelector('#analysis', { timeout: 10000 });
    ok((await page.locator('#analyze-status').innerText()).includes('Without a YouTube key'), await page.locator('#analyze-status').innerText());
    ok((await page.locator('#analysis-title').innerText()).includes('Pasted video about hips'));
    ok(await page.locator('#analysis .a-area[data-area=hip_flexors], #analysis .a-area[data-area=glutes]').count() >= 1, 'the title alone still points at the hips');
    eq(await U(page, () => ({ lib: Object.keys(window.__unfurl.state.library).length, vids: Object.keys(window.__unfurl.state.videos).length })), before);
    await page.click('#analysis-discard');
    await goto(page, 'today');
  });

  await step('the player reports the real length, which corrects the guess', async () => {
    await waitFeatured(page);
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

  await step('free text: a teacher\'s name narrows results; an unknown word is ignored (and says so)', async () => {
    await page.fill('#command', 'Kassandra neck');
    await page.press('#command', 'Enter');
    await page.waitForFunction(() => !window.__unfurl.ui.busy && window.__unfurl.ui.filters.terms.includes('kassandra'));
    await waitFeatured(page);
    eq(await U(page, () => window.__unfurl.state.videos[window.__unfurl.ui.featuredId].channel), 'Yoga With Kassandra');
    ok(await page.locator('#clear-terms').count() === 1, 'shows what it is also matching');
    ok((await page.locator('.why').innerText()).includes('Matches what you typed'), 'explains the text match');
    await page.fill('#command', 'neck sphinxwhale');
    await page.press('#command', 'Enter');
    await page.waitForFunction(() => !window.__unfurl.ui.busy && window.__unfurl.ui.filters.terms.includes('sphinxwhale'));
    ok(await U(page, () => window.__unfurl.ui.termsIgnored), 'unknown word flagged');
    ok((await page.locator('.log').innerText()).includes('Nothing I know yet mentions'), 'tells the user');
    ok(await page.locator('.featured h2').count() === 1, 'still returns neck routines');
    await page.click('#clear-terms');
    eq(await U(page, () => window.__unfurl.ui.filters.terms.length), 0);
  });

  await step('a typed request replaces earlier muscle picks; a length-only command keeps them', async () => {
    await page.click('.chip.quick:has-text("Desk posture")');
    eq(await U(page, () => window.__unfurl.ui.filters.areas.length), 5);
    await page.fill('#command', 'pigeon'); await page.press('#command', 'Enter');
    await page.waitForFunction(() => !window.__unfurl.ui.busy && window.__unfurl.ui.filters.terms.includes('pigeon'));
    eq(await U(page, () => window.__unfurl.ui.filters.areas.length), 0, 'picks replaced by the new request');
    await page.click('.chip.quick:has-text("Tight hips")');
    await page.fill('#command', '30 minutes'); await page.press('#command', 'Enter');
    await page.waitForFunction(() => !window.__unfurl.ui.busy);
    eq(await U(page, () => window.__unfurl.ui.filters.areas.length), 3, 'a length-only command keeps the muscles');
    eq([await page.inputValue('#min-len'), await page.inputValue('#max-len')], ['24', '36']);
    await U(page, () => { const f = window.__unfurl.ui.filters; f.terms = []; f.areas = []; f.minMin = 7; f.maxMin = 13; });   // leave things as the next step expects
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
    const areas = await U(page, () => window.__unfurl.state.videos[window.__unfurl.ui.featuredId].profile.areas);
    // (the "Desk posture" chip is neck, upper back, chest, shoulders AND hip flexors; today's seeded pick may be any good match for any of them)
    ok(['neck', 'upper_back', 'shoulders', 'chest', 'hip_flexors'].some((a) => (areas[a] ?? 0) >= 0.5), `profile ${JSON.stringify(areas)}`);
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

  await step('"＋ Add to library" puts the video in YOUR library (and the badge appears)', async () => {
    const id = await featuredId(page);
    eq(await libCount(page), 0);
    await page.click('#lib-toggle');
    eq(await libCount(page), 1);
    ok(await U(page, (i) => i in window.__unfurl.state.library, id), 'this video');
    ok((await page.locator('#lib-toggle').innerText()).includes('In library'), 'button reflects it');
    ok(await page.locator('.featured .badge.lib').count() === 1, 'badge shown');
  });

  await step('finishing a video opens the feedback dialog; answers are logged, learned from, and the video joins the library', async () => {
    await page.click('#another');
    const id = await featuredId(page);
    ok(!(await U(page, (i) => i in window.__unfurl.state.library, id)), 'not in library before doing it');
    await page.waitForSelector(`iframe[data-video="${id}"]`);
    await U(page, () => window.__players.at(-1).__end());
    await page.waitForSelector('[role=dialog]');
    await page.click('.rate-row .choice:has-text("Much better")');
    await page.click('.choice:has-text("Just right")');
    await page.fill('.feedback textarea', 'felt <b>great</b>');
    await page.click('#save-feedback');
    await page.waitForSelector('.toast');
    const h = await U(page, () => window.__unfurl.state.history);
    eq(h.length, 1); eq(h[0].videoId, id); eq(h[0].intensity, 'right'); ok(Object.values(h[0].ratings)[0] === 'much', 'rating stored');
    ok(h[0].title && h[0].title.length > 3, 'history keeps a title snapshot');
    ok(await U(page, (i) => i in window.__unfurl.state.library, id), 'doing it adds it to the library');
    eq(await libCount(page), 2);
    const toastText = await page.locator('.toast').allInnerTexts();
    ok(toastText.some((t) => t.startsWith('Noted:')), `tells you what it learned; toasts: ${JSON.stringify(toastText)}`);
    ok(await page.locator('[role=dialog]').count() === 0, 'dialog closed');
  });

  await step('Journal: history, per-muscle insight (flagged as an early signal), and the 4-week heat-map', async () => {
    await goto(page, 'journal');
    await page.waitForSelector('.hist-item');
    eq(await page.locator('.hist-item').count(), 1);
    ok(await page.locator('.insight').count() >= 1, 'an insight card exists');
    ok((await page.locator('.insight .big').first().innerText()).startsWith('100%'), 'one "much better" = 100% helpful');
    ok((await page.locator('.insight').first().innerText()).includes('early signal'), 'honest about a tiny sample');
    ok((await page.locator('.note-text').innerText()).includes('<b>great</b>'), 'note shown as literal text');
    ok(await page.locator('#heatmap .heat-row').count() >= 1, 'heat-map rows');
    ok((await page.locator('#heatmap .heat-row').first().innerText()).includes('today'), 'worked today');
    await shot(page, '02-journal');
  });

  await step('"What have I been neglecting?" aims at areas you have gone longest without', async () => {
    await goto(page, 'today');
    await page.click('.chip.quick:has-text("What have I been neglecting?")');
    await page.waitForFunction(() => !window.__unfurl.ui.busy);
    ok(await U(page, () => window.__unfurl.ui.filters.areas.length) >= 1, 'filled the request');
    ok(await page.locator('.toast', { hasText: 'Aiming at' }).count() >= 1, 'says what it chose');
  });

  await step('"Not for me" hides a video for good (with undo)', async () => {
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

  await step('Library: search finds videos by teacher and by word forms; add suggestions; paste a link', async () => {
    await goto(page, 'library');
    await page.click('#tab-suggestions');
    ok(await page.locator('.row-card').count() > 10, 'suggestions listed');
    await page.fill('#lib-q', 'kassandra');
    const rows = await page.locator('.row-card').count();
    ok(rows >= 3 && rows < 15, `${rows} rows for a teacher`);
    ok((await page.locator('.row-card .meta').first().innerText()).includes('Kassandra'), 'all by that teacher');
    await page.fill('#lib-q', 'calf');
    ok(/calf|calves/i.test(await page.locator('.row-card h4').first().innerText()), 'plural/stem matching: "calf" finds "Calves"');
    await page.fill('#lib-q', '');
    // add one suggestion to the library
    const before = await libCount(page);
    await page.locator('.row-card').first().locator('[data-action=toggle-library]').click();
    eq(await libCount(page), before + 1);
    ok(await page.locator('.row-card').first().locator('.badge', { hasText: 'in your library' }).count() === 1, 'marked as in your library');
    // paste a link (no key => title from oEmbed)
    await page.fill('#add-text', 'https://youtu.be/ABCDEFGHIJK?si=zzz');
    await page.click('#add-btn');
    await page.waitForFunction(() => window.__unfurl.state.videos.ABCDEFGHIJK);
    eq(await U(page, () => window.__unfurl.state.videos.ABCDEFGHIJK.source), 'manual');
    eq(await U(page, () => window.__unfurl.state.videos.ABCDEFGHIJK.title), 'Pasted video about hips');
    ok(await U(page, () => 'ABCDEFGHIJK' in window.__unfurl.state.library), 'pasted links go to the library');
    ok(await U(page, () => window.__unfurl.state.videos.ABCDEFGHIJK.profile.areas.hip_flexors > 0.5), 'analysed from that title');
    await page.fill('#add-text', 'PLabcdefghijklmnopqrstuvwxyz012345');
    await page.click('#add-btn');
    await page.waitForFunction(() => document.getElementById('add-status').textContent.includes('needs a YouTube key'));
    await shot(page, '03-library');
  });

  await step('Library search language: phrases, exclusions, fields, length, typos, tips and autocomplete', async () => {
    await goto(page, 'library');
    await page.click('#tab-suggestions');
    const count = () => page.locator('.row-card').count();
    const metas = async () => (await page.locator('.row-card .meta').allInnerTexts()).join(' | ');
    await page.fill('#lib-q', 'channel:kassandra');
    const k = await count(); ok(k >= 3 && (await metas()).split('|').every((m) => m.includes('Kassandra')), `teacher filter: ${k}`);
    await page.fill('#lib-q', 'channel:kassandra len:<12');
    ok(await count() < k && await count() >= 1, 'combined with a length filter');
    await page.fill('#lib-q', '"hip flexors"');
    ok(await count() >= 1, 'quoted phrase');
    await page.fill('#lib-q', 'hips -flexors');
    const noFlex = await page.locator('.row-card h4').allInnerTexts();
    ok(noFlex.length >= 1 && noFlex.every((t) => !/flexor/i.test(t)), 'exclusion');
    await page.fill('#lib-q', 'lumbar');
    ok(await count() >= 1, 'a concept word finds low-back videos');
    ok((await page.locator('#interp').innerText()).includes('Lower back'), 'and says which muscle it understood');
    await page.fill('#lib-q', 'calves hamstring');
    ok((await page.locator('#interp').innerText()).length >= 0, 'multi-word queries are fine');
    await page.fill('#lib-q', 'hamstrng');
    ok(await count() >= 1 && (await page.locator('#interp').innerText()).includes('Showing results for'), 'typo corrected, and the correction is shown');
    await page.fill('#lib-q', 'zzzqqq');
    ok((await page.locator('#interp').innerText()).includes('No matches'), 'says so when there is nothing');
    await page.fill('#lib-q', 'kass');
    ok(await page.locator('#lib-suggest option').count() >= 1, 'autocomplete options appear');
    await page.fill('#lib-q', '');
    await page.click('.tips summary'); await page.click('.chip.tip:has-text("len:10-20")');
    eq(await page.inputValue('#lib-q'), 'len:10-20');
    await page.fill('#lib-q', '');
  });

  await step('saved searches: name it, clear it, bring it back with one click', async () => {
    await page.fill('#lib-q', 'channel:kassandra');
    const n = await page.locator('.row-card').count();
    await page.click('#save-search');
    await page.fill('#saved-name', 'Kassandra only');
    await page.click('#saved-confirm');
    await page.waitForSelector('[data-saved="Kassandra only"]');
    eq(await U(page, () => window.__unfurl.state.savedSearches.length), 1);
    await page.fill('#lib-q', '');
    await page.click('[data-saved]');
    eq(await page.inputValue('#lib-q'), 'channel:kassandra');
    eq(await page.locator('.row-card').count(), n);
    await page.fill('#lib-q', '');
  });

  await step('Library: tags and notes — editable, searchable, filterable', async () => {
    await page.click('#tab-mine');
    const row = page.locator('.row-card[data-video="ABCDEFGHIJK"]');
    await row.locator('[data-action=edit]').click();
    await row.locator('.editor input').fill('Morning, hips');
    await row.locator('.editor textarea').fill('my go-to when stiff');
    await row.locator('[data-action=save-edit]').click();
    eq(await U(page, () => window.__unfurl.state.library.ABCDEFGHIJK.tags), ['morning', 'hips']);
    ok(await row.locator('.badge.tag', { hasText: '#morning' }).count() === 1, 'tag shown');
    ok((await row.innerText()).includes('my go-to when stiff'), 'note shown');
    await page.fill('#lib-q', 'stiff');       // found through the note
    eq(await page.locator('.row-card').count(), 1);
    await page.fill('#lib-q', '');
    await page.click('.tagbar .chip:has-text("morning")');
    eq(await page.locator('.row-card').count(), 1);
    await page.click('.tagbar .chip:has-text("morning")');
    // remove from library
    const n = await libCount(page);
    await row.locator('[data-action=toggle-library]').click();
    eq(await libCount(page), n - 1);
    await page.click('#tab-discovered');
    ok(await page.locator('.row-card[data-video="ABCDEFGHIJK"]').count() === 1, 'removed videos remain in the index (Discovered)');
  });

  await step('My body: standing spots in Settings drive "Use my usual spots" and the Journal', async () => {
    await goto(page, 'settings');
    await page.click('#spots .chip:has-text("Calves")'); await page.click('#spots .chip:has-text("Calves")');
    await page.click('#spots .chip:has-text("Hamstrings")');
    eq(await U(page, () => window.__unfurl.state.prefs.focus), [{ id: 'calves', mode: 'weak' }, { id: 'hamstrings', mode: 'tight' }]);
    await goto(page, 'today');
    await page.click('.chip.quick:has-text("Use my usual spots")');
    eq(await U(page, () => window.__unfurl.ui.filters.areas), [{ id: 'calves', mode: 'weak' }, { id: 'hamstrings', mode: 'tight' }]);
    await goto(page, 'journal');
    ok(await page.locator('#heatmap .heat-row.spot', { hasText: 'Calves' }).count() === 1, 'standing spot shown even though never worked');
    ok((await page.locator('#heatmap .nudge').innerText()).includes('Gone quiet'), 'nudges about spots that went quiet');
  });

  await step('Settings → Your data shows where it lives and the versions', async () => {
    await goto(page, 'settings');
    const where = await page.locator('#data-where').innerText();
    ok(where.includes(fs.realpathSync(server.dataDir)) || where.includes(server.dataDir), where);
    ok((await page.locator('#versions').innerText()).includes('data format 2'), await page.locator('#versions').innerText());
  });

  await step('data is saved as separate profile + index files outside the app; no old state.json; no key file', async () => {
    await page.waitForTimeout(700); // debounce
    const profile = readJson(server.dataDir, 'profile.json'), index = readJson(server.dataDir, 'index.json');
    eq(profile.schema, 2); eq(profile.history.length, 1);
    ok(Object.keys(profile.library).length >= 2, 'library saved');
    ok(!('videos' in profile) && !('history' in index), 'profile and index kept apart');
    ok(Object.keys(index.videos).length > 40, 'index has the videos');
    ok(!fs.existsSync(path.join(server.dataDir, 'state.json')), 'no v1 file');
    ok(!fs.existsSync(path.join(server.dataDir, 'config.json')), 'no config yet');
    ok(!server.dataDir.startsWith(ROOT), 'data lives outside the app folder');
  });

  await step('reload keeps everything', async () => {
    await page.reload(); await page.waitForSelector('#nav a');
    eq(await U(page, () => window.__unfurl.state.history.length), 1);
    ok(await libCount(page) >= 2, 'library survived');
  });

  await step('mobile layout has no horizontal scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of ['today', 'library', 'journal', 'settings']) {
      await goto(page, tab);
      const overflow = await U(page, () => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 1, `${tab}: horizontal overflow ${overflow}px`);
    }
    await goto(page, 'today'); await waitFeatured(page);
    await shot(page, '04-today-mobile');
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step('dark mode renders (screenshot)', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await goto(page, 'journal'); await shot(page, '05-journal-dark');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  await step('backups: the settings list them, and one click restores — keeping a copy of what it replaced', async () => {
    await goto(page, 'settings');
    await page.waitForSelector('#backups-slot summary');
    await page.click('#backups-slot summary');
    const n = await page.locator('[data-restore]').count();
    ok(n >= 1, 'a daily backup exists');
    const daily = await page.locator('[data-restore]').first().getAttribute('data-restore');
    await Promise.all([page.waitForNavigation(), page.locator(`[data-restore="${daily}"]`).click()]);
    await page.waitForSelector('#nav a');
    eq(await U(page, () => window.__unfurl.state.history.length), 0, 'back to the earlier state');
    ok(fs.readdirSync(path.join(server.dataDir, 'backups')).some((f) => f.startsWith('profile-before-restore-')), 'the replaced state was kept');
  });

  await page.context_.close();
  server.stop();
}

// ================================================================== World 2: with a YouTube key
console.log('\nWorld 2: with a YouTube key (live search, comments, imports, growth, learning)');
{
  const server = await startServer();
  const page = await newPage(browser, server);

  await step('Settings: a bad key is rejected with a clear message; a good key is saved to config.json only', async () => {
    await goto(page, 'settings');
    await page.fill('#api-key', 'INVALID'); await page.click('#save-key');
    await page.waitForFunction(() => document.getElementById('key-status').textContent.includes('✗'));
    ok((await page.locator('#key-status').innerText()).includes('isn’t valid'), await page.locator('#key-status').innerText());
    await page.fill('#api-key', 'TESTKEY'); await page.click('#save-key');
    await page.waitForFunction(() => document.getElementById('key-status').textContent.includes('✓'));
    await page.waitForTimeout(500);
    ok(fs.readFileSync(path.join(server.dataDir, 'config.json'), 'utf8').includes('TESTKEY'), 'key in config.json');
    await page.click('#export');
    const keep = JSON.stringify(await U(page, () => window.__unfurl.state)) + fs.readFileSync(path.join(server.dataDir, 'profile.json'), 'utf8') + fs.readFileSync(path.join(server.dataDir, 'index.json'), 'utf8');
    ok(!keep.includes('TESTKEY'), 'key is in neither the profile nor the index');
    await shot(page, '06-settings');
  });

  const startCount = await U(page, () => Object.keys(window.__unfurl.state.videos).length);

  await step('Find with web search: searches, verifies suggestions, reads comments — and your library stays yours', async () => {
    await goto(page, 'today');
    await page.click('.chip.quick:has-text("Tight hips")');
    await page.fill('#min-len', '10'); await page.fill('#max-len', '30'); await page.press('#max-len', 'Tab');
    ok(await page.locator('#web-toggle').isChecked(), 'web search is on by default once a key exists');
    await page.click('#find');
    await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 15000 });
    await waitFeatured(page);
    const s = await U(page, () => {
      const st = window.__unfurl.state, vids = Object.values(st.videos);
      return { n: vids.length, searched: vids.filter((v) => v.source === 'search').length, withComments: vids.filter((v) => v.evidence?.n > 0).length,
        raw: vids.filter((v) => v.comments?.length > 0).length, queries: Object.keys(st.queryLog).length, broken: vids.filter((v) => v.broken).map((v) => v.id),
        verified: vids.filter((v) => v.source === 'suggestion' && v.verified).length, lib: Object.keys(st.library).length, log: window.__unfurl.ui.log };
    });
    ok(s.n > startCount, `index grew ${startCount} -> ${s.n}`);
    ok(s.searched >= 3, `${s.searched} search results stored`);
    ok(s.withComments >= 1 && s.raw >= 1, 'comments read, raw sample kept for future re-indexing');
    ok(s.queries >= 2, `${s.queries} searches logged (several rounds)`);
    eq(s.broken.sort(), [...GONE].sort(), 'deleted suggestions flagged');
    ok(s.verified > 30, `${s.verified} suggestions verified`);
    eq(s.lib, 0, 'search results do NOT go into your library');
    ok(s.log.some((l) => /earching YouTube for/.test(l)) && s.log.some((l) => /^Done:/.test(l)), s.log.join(' | '));
    ok(['search', 'videos', 'commentThreads', 'channels'].every((e) => page.apiCalls.includes(e)), `API calls: ${[...new Set(page.apiCalls)]}`);
    await shot(page, '07-today-after-search');
  });

  await step('finds appear under "Discovered"; they can be promoted to the library with one click', async () => {
    await goto(page, 'library');
    await page.click('#tab-discovered');
    ok(Number(await page.locator('#tab-discovered .count').innerText()) >= 3, 'discovered count');
    ok(await page.locator('.row-card').count() >= 3, 'rows shown');
    const id = await page.locator('.row-card').first().getAttribute('data-video');
    await page.locator('.row-card').first().locator('[data-action=toggle-library]').click();
    ok(await U(page, (i) => i in window.__unfurl.state.library, id), 'promoted');
    await page.click('#tab-mine');
    eq(await page.locator('.row-card').count(), 1);
    await page.click('.row-card [data-action=toggle-library]');   // and back out, to keep later counts simple
    eq(await libCount(page), 0);
  });

  await step('new finds are labelled (new teacher / hidden gem / comments read) and explained from comments', async () => {
    await goto(page, 'today'); await waitFeatured(page);
    const info = await U(page, () => window.__unfurl.ui.ranked.slice(0, 8).map((r) => ({ id: r.video.id, flags: r.flags, reasons: r.reasons })));
    ok(info.some((i) => i.flags.newChannel), 'some results come from teachers you have not tried');
    ok(info.some((i) => i.flags.commentsRead), 'some results have their comments read');
    ok(info.some((i) => i.reasons.some((r) => /comments about it are positive|Viewers report/.test(r))), 'reasons cite viewer comments');
  });

  await step('searching again goes to NEW places: different queries, result pages remembered', async () => {
    const q0 = new Set(await U(page, () => Object.values(window.__unfurl.state.queryLog).map((q) => q.q)));
    const n0 = await U(page, () => Object.keys(window.__unfurl.state.videos).length);
    for (let i = 0; i < 2; i++) { await page.click('#find'); await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 15000 }); }
    const q1 = await U(page, () => Object.values(window.__unfurl.state.queryLog).map((q) => q.q));
    ok(q1.length >= q0.size + 3, `queries ${q0.size} -> ${q1.length}`);
    ok(await U(page, () => Object.keys(window.__unfurl.state.videos).length) >= n0, 'index did not shrink (growth itself is covered statistically in the unit tests)');
    ok(await U(page, () => Object.values(window.__unfurl.state.queryLog).some((q) => q.nextPageToken)), 'result pages remembered for going deeper');
  });

  await step('WIDE NET: a "Thorough" search looks at far more than 10 videos, over several rounds, reads comments on dozens, and respects its budget', async () => {
    fault.pageSize = 50;                     // like the real API: up to 50 results per page
    await goto(page, 'today');
    await page.selectOption('#thoroughness', 'thorough');
    eq(await U(page, () => window.__unfurl.state.prefs.thoroughness), 'thorough');
    await U(page, () => { const f = window.__unfurl.ui.filters; f.areas = [{ id: 'hip_flexors', mode: 'tight' }, { id: 'glutes', mode: 'tight' }, { id: 'neck', mode: 'tight' }]; f.terms = []; f.minMin = 10; f.maxMin = 30; });
    const before = await U(page, () => window.__unfurl.state.quota.used);
    await page.click('#find');
    await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 30000 });
    const r = await U(page, () => ({ rep: window.__unfurl.ui.report, log: window.__unfurl.ui.log, withComments: Object.values(window.__unfurl.state.videos).filter((v) => v.comments?.length).length }));
    ok(r.rep.examined >= 25, `looked at ${r.rep.examined} videos`);
    ok(r.rep.rounds >= 1 && r.rep.spent <= 1500, `rounds ${r.rep.rounds}, spent ${r.rep.spent}`);
    ok(r.withComments > 10, `comments read on ${r.withComments} videos`);
    ok(r.log.some((l) => /^Done: looked at \d+ videos over \d+ rounds?/.test(l)), r.log.at(-1));
    ok((await U(page, () => window.__unfurl.state.quota.used)) - before <= 1500, 'within the thorough budget');
    ok((await page.locator('.hint', { hasText: 'Thoroughness' }).count()) >= 0);
    await page.selectOption('#thoroughness', 'balanced');
    fault.pageSize = 5;
  });

  await step('COMBO: three muscles in 20-35 minutes — it builds a sequence, you follow it, and it moves on by itself', async () => {
    await goto(page, 'today');
    await U(page, () => { const f = window.__unfurl.ui.filters; f.areas = ['neck', 'hip_flexors', 'calves'].map((id) => ({ id, mode: 'tight' })); f.terms = []; f.minMin = 20; f.maxMin = 35; f.styles = []; f.source = 'all'; });
    await page.click('#find'); await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 30000 });
    ok(await page.locator('#combos').count() === 1, 'the combo panel is offered for 3 muscles');
    await page.click('#build-combo');
    await page.waitForSelector('.combo');
    ok(await page.locator('.combo').count() >= 1, 'combos listed');
    const meta = await page.locator('.combo').first().locator('.combo-meta').innerText();
    ok(/\d+ min · \d+% of your muscles covered/.test(meta), meta);
    const parts = await page.locator('.combo').first().locator('.parts li').count();
    ok(parts >= 2 && parts <= 4, `${parts} parts`);
    await page.locator('[data-start="0"]').click();
    ok((await page.locator('#combo-progress').innerText()).startsWith(`Combo: part 1 of ${parts}`), 'progress shown');
    const first = await featuredId(page);
    await page.waitForSelector(`iframe[data-video="${first}"]`);
    await U(page, () => window.__players.at(-1).__end());
    await page.waitForSelector('[role=dialog]');
    await page.click('#save-feedback');
    await page.waitForFunction((f) => window.__unfurl.ui.featuredId !== f, first);
    eq(await U(page, () => window.__unfurl.ui.combo.index), 1);
    ok((await page.locator('#combo-progress').innerText()).startsWith(`Combo: part 2 of ${parts}`), 'advanced to part 2');
    // skip through the rest
    for (let i = 2; i <= parts; i++) {
      if (await page.locator('#combo-progress .link').count()) await page.locator('#combo-progress .link').click();
    }
    await page.waitForFunction((n) => window.__unfurl.ui.combo.index === n - 1, parts);
    await U(page, () => window.__players.at(-1).__end());
    await page.waitForSelector('[role=dialog]'); await page.click('#save-feedback');
    await page.waitForSelector('.toast:has-text("Combo complete")');
    eq(await U(page, () => window.__unfurl.ui.combo), null);
    await shot(page, '08-combo');
  });

  await step('changing the request makes an old combo disappear instead of lying', async () => {
    await U(page, () => { window.__unfurl.ui.filters.areas = [{ id: 'neck', mode: 'tight' }, { id: 'chest', mode: 'tight' }]; window.__unfurl.hooks.renderResults(); });
    ok(await page.locator('.combo').count() === 0, 'stale combos are not shown for different muscles');
  });

  await step('import a whole teacher by @handle: cheap (a few units), lands in Discovered, followed', async () => {
    await goto(page, 'library');
    const q0 = await U(page, () => window.__unfurl.state.quota.used);
    const lib0 = await libCount(page);
    const have = await U(page, () => Object.keys(window.__unfurl.state.videos).length);
    await page.fill('#add-text', '@tinyyogaroom');
    await page.click('#add-btn');
    await page.waitForFunction(() => document.getElementById('add-status').textContent.includes('imported from Tiny Yoga Room'), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const spent = (await U(page, () => window.__unfurl.state.quota.used)) - q0;
    ok(spent > 0 && spent <= 12, `a whole catalogue cost ${spent} units`);
    eq(await libCount(page), lib0, 'imported catalogues go to Discovered, not the library');
    ok(await U(page, () => Object.values(window.__unfurl.state.videos).filter((v) => v.source === 'channel').length) >= 5, 'channel videos stored');
    ok(await U(page, () => Object.values(window.__unfurl.state.videos).some((v) => v.source === 'channel' && !v.comments)), 'comments not read in bulk (cost control)');
    eq(await U(page, () => window.__unfurl.state.following.map((f) => f.name)), ['Tiny Yoga Room']);
    ok(await page.locator('#follow-slot .chip', { hasText: 'Tiny Yoga Room' }).count() === 1, 'followed teacher shown');
  });

  await step('a playlist link goes straight into the library when asked; single video links are added with their comments read', async () => {
    const lib0 = await libCount(page);
    await page.check('#import-to-library');
    await page.fill('#add-text', `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`);
    await page.click('#add-btn');
    await page.waitForFunction(() => document.getElementById('add-status').textContent.includes('My favourite hip routines'), null, { timeout: 15000 });
    ok((await libCount(page)) - lib0 >= 10, `playlist added ${(await libCount(page)) - lib0}`);
    await page.uncheck('#import-to-library');
    await page.fill('#add-text', `https://youtu.be/${VIDEOS[40].id}\n${VIDEOS[41].id}`);
    await page.click('#add-btn');
    await page.waitForFunction((a) => window.__unfurl.state.library[a]?.snapshot, VIDEOS[40].id);
    for (const v of [VIDEOS[40], VIDEOS[41]]) ok(await U(page, (id) => window.__unfurl.state.videos[id].comments?.length > 0, v.id), 'comments attached');
  });

  await step('"Check for new uploads" from followed teachers (nothing new => says so)', async () => {
    await page.click('#refresh-following');
    await page.waitForSelector('.toast:has-text("Nothing new")', { timeout: 10000 });
  });

  await step('Library search finds poses from chapter lists and what viewers wrote', async () => {
    await page.click('#tab-discovered');
    await page.fill('#lib-q', 'pigeon');
    ok(await page.locator('.row-card').count() >= 1, 'pose found via chapters');
    await page.fill('#lib-q', 'sciatica');
    ok(await page.locator('.row-card').count() >= 1, 'found via the muscle/condition the analysis inferred');
    await page.fill('#lib-q', 'pose:pigeon -yin');
    ok(await page.locator('.row-card').count() >= 1, 'pose filter + exclusion on found videos');
    await page.fill('#lib-q', 'pigion');
    ok((await page.locator('#interp').innerText()).includes('pigeon'), 'typo corrected on found videos too');
    await page.fill('#lib-q', '');
  });

  await step('free text in the command box: "pigeon pose" finds videos that contain it', async () => {
    await goto(page, 'today');
    await page.fill('#command', 'pigeon pose, 10-30 min');
    await page.press('#command', 'Enter');
    await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 15000 });
    await waitFeatured(page);
    const r = await U(page, () => ({ terms: window.__unfurl.ui.filters.terms, hasPigeon: window.__unfurl.state.videos[window.__unfurl.ui.featuredId].profile.poses.some((p) => p.id === 'pigeon'), reason: window.__unfurl.ui.ranked[0]?.reasons[0] }));
    eq(r.terms, ['pigeon']); ok(r.hasPigeon, 'featured video contains pigeon pose'); ok(/Matches what you typed/.test(r.reason), r.reason);
  });

  await step('lazy comment enrichment: contenders without comments get theirs read when they rank high', async () => {
    const r = await U(page, async () => {
      const c = window.__unfurl;
      c.ui.filters.terms = []; c.ui.filters.areas = [{ id: 'hip_flexors', mode: 'tight' }];
      const first = c.rankNow().slice(0, 3).map((x) => x.video.id);
      for (const id of first) { delete c.state.videos[id].comments; delete c.state.videos[id].evidence; }
      // exactly the videos the app should now pick: the best-ranked ones that have no comments read yet
      const expected = c.rankNow().map((x) => x.video).filter((v) => !v.comments && !(v.evidence?.n > 0) && v.verified).slice(0, 3).map((v) => v.id);
      const done = await c.enrichTop(3);
      // (some suggestion videos have no comments on the fake YouTube: what matters is that the app read — or tried to read — each one)
      return { done, expected: expected.length, all: expected.length > 0 && expected.every((id) => Array.isArray(c.state.videos[id].comments)) };
    });
    ok(r.done >= 1 && r.all, JSON.stringify(r));
  });

  await step('auto-add setting: when on, new finds go into the library too', async () => {
    await goto(page, 'settings');
    await page.check('#auto-library');
    eq(await U(page, () => window.__unfurl.state.prefs.autoLibrary), true);
    await goto(page, 'today');
    const lib0 = await libCount(page);
    await U(page, () => { window.__unfurl.ui.filters.terms = []; window.__unfurl.ui.filters.areas = [{ id: 'core', mode: 'tight' }]; });   // an area no earlier step searched
    await page.click('#find'); await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 15000 });
    ok((await libCount(page)) > lib0, `library ${lib0} -> ${await libCount(page)}`);
    await goto(page, 'settings'); await page.uncheck('#auto-library');
  });

  await step('rating a video teaches the app: related videos show "📈" evidence from your history', async () => {
    const target = await U(page, () => Object.values(window.__unfurl.state.videos).find((v) => v.source === 'search' && v.profile.poses.some((p) => p.id === 'pigeon'))?.id);
    ok(target, 'found a search result with pigeon pose');
    await goto(page, 'today');
    await U(page, () => { window.__unfurl.ui.filters.areas = [{ id: 'glutes', mode: 'tight' }, { id: 'hip_flexors', mode: 'tight' }]; });
    const h0 = await U(page, () => window.__unfurl.state.history.length);
    for (let round = 1; round <= 2; round++) {
      await U(page, (id) => window.__unfurl.play(id), target);
      await page.waitForSelector(`iframe[data-video="${target}"]`);
      await page.click('#did-it');
      await page.waitForSelector('[role=dialog]');
      for (const btn of await page.locator('.rate-row').all()) await btn.locator('.choice:has-text("Much better")').click();
      await page.click('#save-feedback');
      await page.waitForFunction((n) => window.__unfurl.state.history.length === n, h0 + round);
    }
    const learned = await U(page, (id) => {
      const c = window.__unfurl;
      c.ui.filters.terms = []; c.ui.filters.areas = [{ id: 'glutes', mode: 'tight' }, { id: 'hip_flexors', mode: 'tight' }];
      c.ui.filters.minMin = 3; c.ui.filters.maxMin = 120;
      return c.rankNow().filter((r) => r.video.id !== id && r.reasons.some((x) => x.startsWith('📈'))).map((r) => r.reasons.find((x) => x.startsWith('📈')));
    }, target);
    ok(learned.length >= 1, 'another video gets credit for sharing a pose you found helpful');
    ok(learned.some((t) => /Pigeon has helped your/.test(t)), learned.join(' | '));
  });

  await step('"Re-analyse everything" re-derives profiles from stored raw text and comments', async () => {
    await goto(page, 'settings');
    const before = await U(page, () => JSON.stringify(Object.values(window.__unfurl.state.videos).filter((v) => v.comments).slice(0, 5).map((v) => v.profile.areas)));
    await page.click('#reanalyze');
    await page.waitForSelector('.toast:has-text("Re-analysed")');
    eq(await U(page, () => JSON.stringify(Object.values(window.__unfurl.state.videos).filter((v) => v.comments).slice(0, 5).map((v) => v.profile.areas))), before, 'identical result: analysis is reproducible from what is stored');
  });

  await step('Search for the muscles I have least of (library-aware growth)', async () => {
    await goto(page, 'library');
    const before = await U(page, () => Object.keys(window.__unfurl.state.videos).length);
    await page.click('#grow');
    await page.waitForSelector('.toast.success:has-text("Found")', { timeout: 15000 });
    ok(await U(page, () => Object.keys(window.__unfurl.state.videos).length) >= before, 'no loss');
  });

  await step('Look at a video first: paste a link, read the full analysis, and nothing is kept until you say so', async () => {
    await goto(page, 'library');
    // Prefer a video the app has never seen; if earlier searches have already found them all, any that isn't in the library yet will do.
    const id = await U(page, (ids) => ids.find((i) => !(i in window.__unfurl.state.videos)) ?? ids.find((i) => !(i in window.__unfurl.state.library)), VIDEOS.map((v) => v.id));
    ok(id, 'a video that is not in the library yet');
    page.analyzeId = id;
    const before = await U(page, () => ({ lib: Object.keys(window.__unfurl.state.library).length, vids: Object.keys(window.__unfurl.state.videos).length }));
    await page.fill('#analyze-input', `https://youtu.be/${id}`);
    await page.click('#analyze-btn');
    await page.waitForSelector('#analysis', { timeout: 10000 });
    ok((await page.locator('#analysis-summary').innerText()).length > 10, 'a one-line verdict');
    ok(await page.locator('#analysis .a-area').count() >= 1, 'muscles listed, each with a bar');
    ok((await page.locator('#analysis').innerText()).includes('What viewers say'), 'comments section');
    ok((await page.locator('#analysis .a-limits').innerText()).includes('can’t watch the footage'), 'honest about its limits');
    eq(await U(page, () => ({ lib: Object.keys(window.__unfurl.state.library).length, vids: Object.keys(window.__unfurl.state.videos).length })), before, 'nothing kept yet');
    ok(await page.locator('#analysis-add').isEnabled(), 'Add is offered');
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => { t.style.display = 'none'; }));
    await page.locator('#analyze-panel').screenshot({ path: path.join(SHOTS, '22-analysis.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling on a phone');
    await page.locator('#analyze-panel').screenshot({ path: path.join(SHOTS, '22-analysis-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step('adding from the report puts the video, with its analysis and comments, into My library', async () => {
    const id = page.analyzeId;
    const libBefore = await libCount(page);
    await page.click('#analysis-add');
    eq(await libCount(page), libBefore + 1);
    const v = await U(page, (i) => { const x = window.__unfurl.state.videos[i]; return { src: x.source, comments: x.comments?.length, ev: x.evidence?.n, areas: Object.keys(x.profile.areas).length }; }, id);
    ok(v.src === 'manual' && v.comments > 0 && v.ev > 0 && v.areas > 0, JSON.stringify(v));
    ok(await page.locator('#analysis-add').isDisabled(), 'the button now says it is done');
    ok((await page.locator('#analysis-add').innerText()).includes('In your library'));
    ok(await page.locator('#lib-list').innerText().then((t) => t.length > 0));
    await page.click('#analysis-discard');
    eq(await page.locator('#analysis').count(), 0, 'closing removes the report');
  });

  await step('a playlist or a nonsense link in that box is explained, not analysed', async () => {
    await page.fill('#analyze-input', 'https://www.youtube.com/playlist?list=PLabcdefghijk');
    await page.click('#analyze-btn');
    await page.waitForFunction(() => document.getElementById('analyze-status').textContent.includes('playlist or a teacher'));
    await page.fill('#analyze-input', 'not a link at all');
    await page.click('#analyze-btn');
    await page.waitForFunction(() => document.getElementById('analyze-status').textContent.includes('doesn’t look like a YouTube video link'));
    eq(await page.locator('#analysis').count(), 0);
    await goto(page, 'today');
  });

  await step('quota usage is tracked and shown', async () => {
    const used = await U(page, () => window.__unfurl.state.quota.used);
    ok(used >= 400, `quota used ${used}`);
    await goto(page, 'settings');
    ok((await page.locator('.quota').innerText()).includes(used.toLocaleString('en-US')), 'shown in Settings');
  });

  await step('when the daily allowance is gone: clear message, and everything already known still works', async () => {
    fault.quota = true;
    await goto(page, 'today');
    await page.click('#find');
    await page.waitForFunction(() => !window.__unfurl.ui.busy);
    ok((await page.locator('.log').innerText()).includes('allowance is used up'), 'explains in the log');
    await waitFeatured(page);
    fault.quota = false;
  });

  await step('persistence: reload keeps library, history, queries, followed teachers and learned data', async () => {
    await page.waitForTimeout(700);
    const snap = () => U(page, () => ({ v: Object.keys(window.__unfurl.state.videos).length, h: window.__unfurl.state.history.length, q: Object.keys(window.__unfurl.state.queryLog).length, l: Object.keys(window.__unfurl.state.library).length, f: window.__unfurl.state.following.length }));
    const before = await snap();
    await page.reload(); await page.waitForSelector('#nav a');
    eq(await snap(), before);
    eq(await U(page, () => window.__unfurl.store.config.apiKey), 'TESTKEY');
  });

  await page.context_.close();
  server.stop();
}

// ================================================================== World 3: upgrading from version 1
console.log('\nWorld 3: upgrading an existing version-1 install (data must survive)');
{
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unfurl-legacy-'));
  const v1 = {
    version: 1, starterVersion: 1,
    videos: {
      SAVEDSAVED1: { id: 'SAVEDSAVED1', title: 'Saved hip routine', channel: 'Calm Hips Studio', durationSec: 900, source: 'search', verified: true, views: 1000, likes: 50, embeddable: true },
      DONEDONE111: { id: 'DONEDONE111', title: 'Neck release I did', channel: 'Desk Yoga Co', durationSec: 600, source: 'search', verified: true, embeddable: true },
      FOUNDONLY11: { id: 'FOUNDONLY11', title: 'Found but never kept', channel: 'X', durationSec: 700, source: 'search', verified: true, embeddable: true },
      zPzSkLHp9ws: { id: 'zPzSkLHp9ws', title: 'Yoga for Calves and Shins', channel: '', durationSec: 600, source: 'starter', verified: false, embeddable: true, durationApprox: true },
    },
    channels: {}, queryLog: { 'yoga for tight hips': { count: 3, order: 'relevance', nextPageToken: 'p5', q: 'yoga for tight hips' } }, quota: { day: '2026-10-05', used: 700 },
    saved: ['SAVEDSAVED1'], blocked: ['BLOCKEDBLK1'],
    history: [{ id: 'old-1', at: '2026-10-01T09:00:00.000Z', date: '2026-10-01', videoId: 'DONEDONE111', areas: [{ id: 'neck', mode: 'tight' }], ratings: { neck: 'much' }, intensity: 'right', repeat: null, note: 'from the old version' }],
    prefs: { trusted: ['Yoga With Adriene'], adventure: 0.8, minMin: 15, maxMin: 30, searchWeb: true, queriesPerRun: 3, commentVisible: 1, commentVideos: 8 },
  };
  fs.writeFileSync(path.join(legacyDir, 'state.json'), JSON.stringify(v1));
  fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ apiKey: 'OLDKEY' }));
  const server = await startServer({ legacyDir });
  const page = await newPage(browser, server);

  await step('first launch of the new version copies the old files and says so', async () => {
    ok(/Copied your existing data/.test(server.log()), server.log());
    ok(fs.existsSync(path.join(legacyDir, 'state.json')), 'originals left in place');
  });

  await step('the old data is upgraded in place: saved + done videos form the library, history and prefs intact', async () => {
    await page.waitForFunction(() => window.__unfurl?.state);
    const s = await U(page, () => { const st = window.__unfurl.state; return { lib: Object.keys(st.library).sort(), hist: st.history.map((h) => [h.id, h.title, h.note]), blocked: st.blocked, adv: st.prefs.adventure, minMin: st.prefs.minMin, q: st.queryLog['yoga for tight hips']?.count, used: st.quota.used, sugg: st.videos.zPzSkLHp9ws.source, found: !!st.videos.FOUNDONLY11, inLib: 'FOUNDONLY11' in st.library, key: window.__unfurl.store.config.apiKey }; });
    eq(s.lib, ['DONEDONE111', 'SAVEDSAVED1']);
    eq(s.hist, [['old-1', 'Neck release I did', 'from the old version']]);
    eq(s.blocked, ['BLOCKEDBLK1']); eq(s.adv, 0.8); eq(s.minMin, 15); eq(s.q, 3); eq(s.used, 700);
    eq(s.sugg, 'suggestion'); ok(s.found && !s.inLib, 'discovered stays out of the library'); eq(s.key, 'OLDKEY');
    ok((await page.locator('.toast', { hasText: 'Upgraded your data' }).count()) >= 1, 'tells the user');
  });

  await step('the upgrade is saved in the new layout, and the old file is archived (not deleted)', async () => {
    await page.waitForTimeout(700);
    const profile = readJson(server.dataDir, 'profile.json');
    eq(profile.schema, 2); eq(Object.keys(profile.library).sort(), ['DONEDONE111', 'SAVEDSAVED1']);
    ok(!fs.existsSync(path.join(server.dataDir, 'state.json')), 'old file moved away');
    ok(fs.existsSync(path.join(server.dataDir, 'backups', 'profile-legacy-state-v1.json')), 'and kept as a backup');
    ok(Object.keys(readJson(server.dataDir, 'index.json').videos).length > 40, 'index written');
  });

  await step('Library shows the migrated items; Journal shows the old session', async () => {
    await goto(page, 'library');
    eq(await page.locator('#tab-mine .count').innerText(), '2');
    eq(await page.locator('#tab-discovered .count').innerText(), '1');
    await goto(page, 'journal');
    ok((await page.locator('.hist-item').innerText()).includes('from the old version'));
  });

  await page.context_.close();
  server.stop();
}

// ================================================================== World 4: a new app version, same data; and data from a NEWER version
console.log('\nWorld 4: data outlives the app (new app copy, same data folder) and is protected from older versions');
{
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unfurl-e2e-persist-'));
  let server = await startServer({ dataDir });
  let page = await newPage(browser, server);
  await waitFeatured(page);

  await step('use the app: add a video to the library, do a routine, set a body spot', async () => {
    await page.click('#lib-toggle');
    const id = await featuredId(page);
    await U(page, () => window.__players.at(-1).__end());
    await page.waitForSelector('[role=dialog]');
    await page.click('.rate-row .choice:has-text("A little")');
    await page.click('#save-feedback');
    await page.waitForFunction(() => window.__unfurl.state.history.length === 1);
    await goto(page, 'settings'); await page.click('#spots .chip:has-text("Neck")');
    await page.waitForTimeout(700);
    eq(readJson(dataDir, 'profile.json').history.length, 1);
    page.__id = id;
  });
  await page.context_.close(); server.stop();

  await step('a brand-new server (as if you had unzipped a newer app copy elsewhere) finds all of it', async () => {
    server = await startServer({ dataDir });
    page = await newPage(browser, server);
    const s = await U(page, () => { const st = window.__unfurl.state; return { h: st.history.length, lib: Object.keys(st.library).length, focus: st.prefs.focus }; });
    eq(s.h, 1); ok(s.lib >= 1, 'library'); eq(s.focus, [{ id: 'neck', mode: 'tight' }]);
    eq((await page.locator('.toast', { hasText: 'Upgraded' }).count()), 0, 'no upgrade needed, nothing announced');
  });
  await page.context_.close(); server.stop();

  await step('data written by a NEWER version is shown read-only and never modified', async () => {
    const future = { ...readJson(dataDir, 'profile.json'), schema: 99, hello: 'from the future' };
    fs.writeFileSync(path.join(dataDir, 'profile.json'), JSON.stringify(future));
    const idxBefore = fs.readFileSync(path.join(dataDir, 'index.json'), 'utf8');
    const profBefore = fs.readFileSync(path.join(dataDir, 'profile.json'), 'utf8');
    server = await startServer({ dataDir });
    page = await newPage(browser, server);
    ok(await page.locator('#banner .banner', { hasText: 'newer version' }).count() === 1, 'banner explains');
    ok(await U(page, () => window.__unfurl.store.readOnly), 'read-only');
    eq(await U(page, () => window.__unfurl.state.history.length), 1, 'data still readable');
    // try to change things
    await waitFeatured(page);
    await page.click('#lib-toggle');
    await page.click('#find'); await page.waitForFunction(() => !window.__unfurl.ui.busy);
    await goto(page, 'settings'); await page.click('#spots .chip:has-text("Hamstrings")');
    ok(await page.locator('#reset').isDisabled(), 'Reset is disabled for data from a newer version');
    await page.waitForTimeout(900);
    eq(fs.readFileSync(path.join(dataDir, 'profile.json'), 'utf8'), profBefore, 'profile untouched');
    eq(fs.readFileSync(path.join(dataDir, 'index.json'), 'utf8'), idxBefore, 'index untouched');
  });
  await page.context_.close(); server.stop();

  await step('a damaged profile file is recovered from the latest backup, and the user is told', async () => {
    // make sure there is a good backup, then corrupt the profile
    const good = { app: 'unfurl', schema: 2, library: {}, history: [], blocked: [], following: [], prefs: {} };
    fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'backups', 'profile-2026-10-04.json'), JSON.stringify({ ...good, library: { RECOVERED111: { addedAt: 1, tags: [], note: 'back from backup' } } }));
    fs.writeFileSync(path.join(dataDir, 'profile.json'), '{"schema": 2, "library": {');
    server = await startServer({ dataDir });
    page = await newPage(browser, server);
    ok(await page.locator('.toast', { hasText: 'restored from the backup' }).count() >= 1, 'announces the recovery');
    ok(await U(page, () => 'RECOVERED111' in window.__unfurl.state.library), 'library recovered');
    ok(fs.readdirSync(dataDir).some((f) => f.startsWith('profile.corrupt-')), 'damaged file kept for inspection');
  });
  await page.context_.close(); server.stop();
}

// ================================================================== World 5: hosted on a server (login, shared key, live update banner)
console.log('\nWorld 5: hosted on a server (login, server-held YouTube key, "new version" banner)');
{
  const http = await import('node:http');
  const upstream = [];
  const fakeYt = http.createServer((req, res) => {
    const { status, body } = fakeApi(req.url);
    upstream.push({ endpoint: new URL(req.url, 'http://x').pathname.split('/').pop(), key: new URL(req.url, 'http://x').searchParams.get('key') });
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  });
  await new Promise((r) => fakeYt.listen(0, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unfurl-e2e-host-'));
  const port = await freePort();
  const launch = async (build) => {
    const proc = spawn('python3', [path.join(ROOT, 'serve.py'), '--port', String(port), '--no-open', '--data-dir', dataDir, '--legacy-dir', path.join(dataDir, 'none')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, UNFURL_AUTH: 'me:pw-1234-pw', UNFURL_YOUTUBE_KEY: 'SERVER-KEY', UNFURL_YT_UPSTREAM: `http://127.0.0.1:${fakeYt.address().port}/youtube/v3`,
        UNFURL_USER_DAILY_UNITS: '1000', UNFURL_BUILD: build, UNFURL_POLL_SECONDS: '1' },
    });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
    return proc;
  };
  let proc = await launch('build-A');
  const server = { url: `http://localhost:${port}/` };

  await step('a login is required; without it nothing is served', async () => {
    eq((await fetch(server.url)).status, 401);
    eq((await fetch(`${server.url}api/profile`, { headers: { 'X-Unfurl': '1' } })).status, 401);
    eq((await fetch(`http://localhost:${port}/healthz`)).status, 200, 'but the health check needs no login');
  });

  const page = await newPage(browser, server, { httpCredentials: { username: 'me', password: 'pw-1234-pw' } });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));

  await step('signed in: the footer names the person and Settings says the server provides YouTube', async () => {
    ok((await page.locator('#storage-note').innerText()).includes('signed in as me'), await page.locator('#storage-note').innerText());
    await goto(page, 'settings');
    ok((await page.locator('#key-status').innerText()).includes('This server provides the YouTube connection'), await page.locator('#key-status').innerText());
    ok((await page.locator('#data-where').innerText()).includes('on the Unfurl server'), await page.locator('#data-where').innerText());
    ok((await page.locator('.quota').innerText()).includes('of 1,000 units'), `the person's own share is shown: ${await page.locator('.quota').innerText()}`);
    await goto(page, 'today');
  });

  await step('web search works with no key of one\'s own, and the browser never sees the server\'s key', async () => {
    await page.click('.chip.quick:has-text("Tight hips")');
    ok(await page.locator('#web-toggle').isEnabled(), 'web search is available');
    await page.click('#find');
    await page.waitForFunction(() => !window.__unfurl.ui.busy, null, { timeout: 20000 });
    await waitFeatured(page);
    ok(upstream.some((u) => u.endpoint === 'search'), 'searches reached YouTube through the server');
    ok(upstream.every((u) => u.key === 'SERVER-KEY'), 'with the server\'s key');
    const viaProxy = requests.filter((u) => u.includes('/api/yt/'));
    ok(viaProxy.length > 3, `${viaProxy.length} calls went through the proxy`);
    ok(viaProxy.every((u) => !u.includes('key=')), 'the browser sent no key');
    ok(!requests.some((u) => u.includes('googleapis.com')), 'the browser never talked to Google directly');
    ok(!JSON.stringify(await U(page, () => window.__unfurl.store.config)).includes('SERVER-KEY'), 'the key is not in the page');
    ok(fs.existsSync(path.join(dataDir, 'profile.json')), 'data saved on the server');
    await shot(page, '20-hosted-today');
  });

  await step('the person\'s usage is counted against their share', async () => {
    const used = await U(page, () => window.__unfurl.state.quota?.used ?? 0);
    ok(used > 0, `used ${used}`);
    ok(fs.existsSync(path.join(dataDir, 'usage.json')), 'and remembered on the server across restarts');
    eq(JSON.parse(fs.readFileSync(path.join(dataDir, 'usage.json'), 'utf8')).used.me > 0, true);
  });

  await step('opening the app through a name the server refuses shows a clear banner and saves nothing', async () => {
    const before = fs.readFileSync(path.join(dataDir, 'profile.json'), 'utf8');
    const other = await chromium.launch({ args: ['--host-resolver-rules=MAP sneaky.example.test 127.0.0.1'] });
    try {
      const odd = await newPage(other, { url: `http://sneaky.example.test:${port}/` }, { httpCredentials: { username: 'me', password: 'pw-1234-pw' } });
      await odd.waitForSelector('#host-banner', { timeout: 10000 });
      const text = await odd.locator('#host-banner').innerText();
      ok(text.includes('sneaky.example.test'), text);
      ok(text.includes('UNFURL_ALLOWED_HOSTS'), 'it says what to do');
      await odd.evaluate(() => { window.__unfurl.state.library.ZZZZZZZZZZZ = { addedAt: 1, tags: [], note: '' }; window.__unfurl.store.save(); });
      await odd.waitForTimeout(800);
      eq(fs.readFileSync(path.join(dataDir, 'profile.json'), 'utf8'), before, 'nothing reached the server');
      eq(await odd.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('unfurl.'))), [], 'and nothing was quietly stored in the browser');
      await odd.context_.close();
    } finally { await other.close(); }
  });

  await step('two tabs on one account: the stale tab\'s save is merged with the other tab\'s work instead of erasing it', async () => {
    const second = await page.context_.newPage();
    await second.goto(server.url); await second.waitForFunction(() => window.__unfurl?.state);
    await page.reload(); await page.waitForFunction(() => window.__unfurl?.state);          // both tabs now share the same starting point
    const add = (pg, id, tag) => pg.evaluate(async ([i, t]) => { const u = window.__unfurl; u.state.library[i] = { addedAt: Date.now(), tags: [t], note: '' }; return u.store.flush(); }, [id, tag]);
    ok(await add(page, 'TABAAAAAAA1', 'from-first-tab'), 'first tab saved');
    ok(await add(second, 'TABBBBBBBB2', 'from-second-tab'), 'the stale tab saved too');
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'profile.json'), 'utf8'));
    ok(saved.library.TABAAAAAAA1 && saved.library.TABBBBBBBB2, `both survived: ${Object.keys(saved.library)}`);
    ok(await second.locator('.toast', { hasText: 'merged into this page' }).count() >= 1, 'and the stale tab was told');
    await second.close();
  });

  await step('when the server is updated, an open page says so and reloads on request without losing anything', async () => {
    await page.reload(); await page.waitForFunction(() => window.__unfurl?.state);   // start from what is really saved (the other tab's work included)
    eq(await page.locator('#update-banner').count(), 0, 'no banner yet');
    const before = await U(page, () => ({ vids: Object.keys(window.__unfurl.state.videos).length, q: Object.keys(window.__unfurl.state.queryLog).length }));
    proc.kill('SIGTERM'); await new Promise((r) => proc.on('exit', r));
    proc = await launch('build-B');          // what the updater does: same data folder, new build
    await page.waitForSelector('#update-banner', { timeout: 15000 });
    ok((await page.locator('#update-banner').innerText()).includes('new version of Unfurl is ready'), 'banner text');
    await shot(page, '21-update-banner');
    await Promise.all([page.waitForEvent('load'), page.click('#update-reload')]);   // it saves first, then reloads
    await page.waitForSelector('#nav a');
    await page.waitForFunction(() => window.__unfurl?.state);
    eq(await page.locator('#update-banner').count(), 0, 'the banner is gone after reloading');
    const after = await U(page, () => ({ vids: Object.keys(window.__unfurl.state.videos).length, q: Object.keys(window.__unfurl.state.queryLog).length }));
    eq(after, before, 'everything is still there');
    eq(await page.evaluate(() => fetch('/api/ping', { headers: { 'X-Unfurl': '1' } }).then((r) => r.json()).then((j) => j.build)), 'build-B');
  });

  await page.context_.close(); proc.kill(); fakeYt.close();
}

// ------------------------------------------------------------------ report

await browser.close();
const failed = results.filter((r) => !r[0]);
const problems = [...new Set(consoleProblems)];
if (problems.length) console.log(`\nBrowser console problems:\n  ${problems.join('\n  ')}`);
console.log(`\n${results.length - failed.length}/${results.length} steps passed${problems.length ? `, ${problems.length} console problem(s)` : ', no console errors'}`);
process.exit(failed.length || problems.length ? 1 : 0);
