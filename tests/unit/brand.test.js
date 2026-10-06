// The name lives in one place and matches the page; the Strength section and everything that went with it is gone.
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
  assert.equal(APP_NAME, 'Olympus');
  const html = read('index.html');
  assert.match(html, new RegExp(`<title>${APP_NAME}</title>`));
  assert.ok(html.includes(`aria-label="${APP_NAME} home"`), 'the brand link');
  assert.ok(/<a class="brand"[\s\S]*?<\/svg>\s*Olympus\s*<\/a>/.test(html), 'the brand text');
  assert.ok(html.includes(`<noscript><p>${APP_NAME} needs JavaScript.`), 'the noscript note');
  assert.match(read('favicon.svg'), /id="mark"/);
});

test('no visible text still carries the old name; only technical names keep it', () => {
  for (const f of [...walk('js'), 'index.html', 'css/style.css'].filter((x) => !x.endsWith('brand.js'))) {   // brand.js explains the technical names, so it has to say them
    read(f).split('\n').forEach((line, i) => {
      const bare = line.replace(/X-Unfurl/g, '').replace(/'unfurl'/g, '').replace(/unfurl\.(profile|index|config|state)/g, '').replace(/__unfurl/g, '').replace(/UNFURL_[A-Z_]+/g, '').replace(/unfurl\.env|unfurl-[a-z]+/g, '');
      assert.ok(!/unfurl/i.test(bare), `${f}:${i + 1} still says Unfurl: ${line.trim().slice(0, 100)}`);
    });
  }
});

test('the Strength section and the AI coach are gone: no files, no tab, no endpoints', () => {
  for (const gone of ['js/strength', 'js/llm.js', 'js/views/strength.js', 'js/views/guides.js', 'js/views/settings-ai.js', 'tests/helpers/fake-anthropic.js']) assert.ok(!fs.existsSync(path.join(ROOT, gone)), `${gone} should be gone`);
  assert.deepEqual([...read('js/app.js').matchAll(/\['(\w+)', '(\w+)', mount/g)].map((m) => m[2]), ['Today', 'Library', 'Journal', 'Settings']);
  const server = read('serve.py');
  for (const word of ['/api/llm', 'ANTHROPIC', 'llm.json']) assert.ok(!server.includes(word), `serve.py still mentions ${word}`);
  for (const f of walk('js')) assert.ok(!/strength\/|mountStrength|\/api\/llm|normalizeStrength|logStrength/.test(read(f)), `${f} still refers to the Strength section`);
});

test('the Olympus mark is a self-contained SVG that reads as a mountain, a sun and clouds, in the app\'s own colours', () => {
  const svg = read('favicon.svg');
  assert.match(svg, /<symbol id="mark" viewBox="0 0 32 32">/);
  assert.ok(!/<(script|image|foreignObject)\b|href="(?!#)/.test(svg), 'no scripts, no pictures, no outside references (it is used as a tab icon and with <use>)');
  for (const colour of ['#3f7a5a', '#f2c879', '#fff']) assert.ok(svg.includes(colour), `uses ${colour}`);
  assert.ok((svg.match(/<path\b/g) ?? []).length >= 4, 'peak, shaded side and cloud layers');
});

test('the one bundled typeface ships with its licence and is what the stylesheet asks for first', () => {
  const css = read('css/style.css');
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*"Inter"[^}]*url\("fonts\/inter-latin-wght-normal\.woff2"\)/);
  assert.match(css, /--font:\s*"Inter",\s*system-ui/);
  assert.ok(fs.statSync(path.join(ROOT, 'css/fonts/inter-latin-wght-normal.woff2')).size > 10_000, 'the font file is there');
  assert.match(read('css/fonts/Inter-LICENSE.txt'), /SIL Open Font License/);
  assert.ok(walk('css').every((f) => !/\.(ttf|otf|woff)$/.test(f)), 'only the one woff2 is bundled');
});

test('the stylesheet loads nothing from outside (the page only allows its own files)', () => {
  const css = read('css/style.css');
  assert.ok(!/https?:\/\//.test(css.replace(/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/g, '')), 'no http(s) address in the CSS');
  assert.ok(!/@import/.test(css));
});
