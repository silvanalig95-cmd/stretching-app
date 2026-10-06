// The name lives in one place and matches the page; the look is the light-blue/grey theme with the bundled font.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME } from '../../js/brand.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('the name in index.html matches the one constant', () => {
  const html = read('index.html');
  assert.match(html, new RegExp(`<title>${APP_NAME}</title>`));
  assert.ok(html.includes(`aria-label="${APP_NAME} home"`), 'the brand link');
  assert.ok(html.includes(`<span class="brand-name">${APP_NAME}</span>`), 'the brand text');
  assert.ok(html.includes(`<noscript><p>${APP_NAME} needs JavaScript.`), 'the noscript note');
  assert.match(read('favicon.svg'), /id="mark"/);
});

test('no visible text still carries the old name; only technical names keep it', () => {
  const files = [...walk('js'), 'index.html', 'css/style.css'];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      const bare = line.replace(/X-Unfurl/g, '').replace(/'unfurl'/g, '');
      assert.ok(!/Unfurl/.test(bare), `${f}:${i + 1} still says Unfurl: ${line.trim().slice(0, 100)}`);
    });
  }
});

test('the stylesheet: light-blue/grey in light and dark, one modern bundled font, no leftovers of the old look', () => {
  const css = read('css/style.css');
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /--accent: #2b6cb0/);
  assert.match(css, /--font: "Inter", system-ui/);
  assert.match(css, /fonts\/inter-latin-wght-normal\.woff2/);
  assert.ok(fs.statSync(path.join(ROOT, 'css/fonts/inter-latin-wght-normal.woff2')).size > 10000, 'the font file is bundled');
  assert.ok(fs.existsSync(path.join(ROOT, 'css/fonts/Inter-LICENSE.txt')), 'its licence travels with it');
  for (const gone of ['Palatino', 'serif)', '--meander', '.kicker', '--gold']) assert.ok(!css.includes(gone), `${gone} should be gone`);
  const html = read('index.html');
  assert.ok(!html.includes('meander') && !html.includes('kicker'));
  // the Content-Security-Policy has no font-src, so fonts fall back to default-src 'self': the bundled file is allowed, remote ones are not
  assert.ok(!/font-src/.test(html) && /default-src 'self'/.test(html));
});
