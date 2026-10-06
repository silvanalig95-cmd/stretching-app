// The name lives in one place; the Greek touches are wired; nothing in the visible text still says the old name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, APP_NAME_GREEK, SECTION_GREEK } from '../../js/brand.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('the name, its Greek spelling and a Greek word for every page', () => {
  assert.equal(APP_NAME, 'Palaestra');
  assert.equal(APP_NAME_GREEK, 'ΠΑΛΑΙΣΤΡΑ');
  for (const tab of ['today', 'strength', 'library', 'journal', 'settings']) assert.match(SECTION_GREEK[tab], /^[Ͱ-Ͽἀ-῿]+$/, tab);
  const html = read('index.html');
  assert.match(html, /<title>Palaestra<\/title>/);
  assert.ok(html.includes('class="meander"') && html.includes('id="kicker"'), 'the meander and the Greek kicker are in the page');
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

test('the stylesheet carries both themes and the Greek touches', () => {
  const css = read('css/style.css');
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /--meander:/);
  assert.match(css, /\.kicker/);
  assert.match(css, /Palatino/);
});
