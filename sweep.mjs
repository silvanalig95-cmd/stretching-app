// The nightly sweep, run headless: the same code as the page (js/autopilot.js) with no page around it.
// serve.py starts it near the end of YouTube's day (or when "Run it now" is pressed in Settings):
//   node sweep.mjs --base http://127.0.0.1:8765 [--user NAME] [--reserve 300] [--ai 1] [--max-minutes 90]
// It talks to the running server like the page does (loading and saving your data the same careful way), proving who it is with a secret
// that only the server and this process know (UNFURL_SWEEP_TOKEN, loopback only). The last line it prints is `SWEEP_RESULT {json}`.

import { Store } from './js/store.js';
import { ctx } from './js/ctx.js';
import { runAutopilot, sweepSummary } from './js/autopilot.js';

const args = process.argv.slice(2);
const arg = (name, fallback = '') => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; };
const base = arg('--base').replace(/\/+$/, '');
const user = arg('--user');
const reserve = Math.max(0, Number(arg('--reserve', '300')) || 0);
const ai = arg('--ai', '1') !== '0';
const maxMs = Math.max(1, Number(arg('--max-minutes', '90')) || 90) * 60 * 1000;
const token = process.env.UNFURL_SWEEP_TOKEN ?? '';
const ytBase = (process.env.UNFURL_SWEEP_YT_BASE ?? '').replace(/\/+$/, '');   // (tests point YouTube at a stand-in)
const YT_API = 'https://www.googleapis.com/youtube/v3';

const done = (result, code) => { console.log(`SWEEP_RESULT ${JSON.stringify(result)}`); process.exit(code); };
if (!base || !token) done({ ok: false, error: 'Needs --base and the UNFURL_SWEEP_TOKEN secret: the server starts this, not a person.' }, 2);

// What the page's relative addresses mean here, and who is asking. The secret goes to our own server only, never to YouTube or Google.
const realFetch = globalThis.fetch;
globalThis.location = { href: `${base}/` };
globalThis.fetch = (input, init = {}) => {
  let url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url.startsWith('/')) url = base + url;
  const headers = { ...(init.headers ?? {}) };
  if (url === base || url.startsWith(`${base}/`)) {
    headers['X-Unfurl'] = '1'; headers['X-Unfurl-Internal'] = token;
    if (user) headers['X-Unfurl-User'] = user;
  } else if (ytBase && url.startsWith(YT_API)) url = ytBase + url.slice(YT_API.length);
  return realFetch(url, { ...init, headers });
};

try {
  const store = await new Store({ storage: null, retryBaseMs: 500 }).init();
  if (store.mode !== 'server') done({ ok: false, error: 'The server did not answer as Olympus.' }, 1);
  if (store.readOnly) done({ ok: false, error: 'Your data is read-only right now (it was saved by a newer version, or could not be read), so nothing was changed.' }, 1);
  ctx.store = store;
  const report = await runAutopilot({ reserve, ai, maxMs, progress: () => {} });
  const saved = await store.flushReliably(60000);
  if (!saved) done({ ok: false, error: 'The results could not be saved to the server.', report }, 1);
  report.summary = sweepSummary(report);
  done({ ok: report.stopped !== 'error' && report.stopped !== 'key' && report.stopped !== 'no_key', error: report.stopped === 'no_key' ? report.notes[0] ?? 'No YouTube key.' : report.stopped === 'error' || report.stopped === 'key' ? report.notes.at(-1) ?? '' : '', report }, 0);
} catch (e) {
  done({ ok: false, error: String(e?.message ?? e).slice(0, 400) }, 1);
}
