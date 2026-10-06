// `serve.py --backup FOLDER` / `--restore ZIP`: a dated zip of everybody's data in a normal folder (for a cloud drive or another disk).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `unfurl-${p}-`));
const serve = (...args) => spawnSync('python3', [path.join(ROOT, 'serve.py'), ...args], { encoding: 'utf8', env: { ...process.env, UNFURL_DATA: '', UNFURL_AUTH: '' } });
const write = (dir, rel, text, mtime) => {
  const p = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
  if (mtime) fs.utimesSync(p, mtime, mtime);
  return p;
};
const entries = (zip) => JSON.parse(spawnSync('python3', ['-I', '-c', 'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({i.filename:(i.external_attr>>16)&0o777 for i in z.infolist()}))', zip], { encoding: 'utf8' }).stdout);
const python = (code, ...args) => spawnSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' });
const today = () => { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

/** A data folder like a hosted one: a shared root, two people, rolling backups, and leftovers that must not travel. */
function dataFolder() {
  const d = tmp('data');
  write(d, 'usage.json', '{"day":"x"}');
  for (const who of ['users/anna', 'users/ben-4f2a9c1d03']) {
    write(d, `${who}/profile.json`, JSON.stringify({ schema: 2, who }));
    write(d, `${who}/index.json`, JSON.stringify({ schema: 2, videos: { a: 1 } }));
    write(d, `${who}/config.json`, JSON.stringify({ apiKey: 'K-' + who }));
    fs.chmodSync(path.join(d, ...`${who}/config.json`.split('/')), 0o600);
  }
  for (let i = 1; i <= 6; i++) write(d, `users/anna/backups/profile-2026-03-0${i}.json`, `{"day":${i}}`, new Date(2026, 2, i));
  write(d, 'users/anna/profile.corrupt-20260101.json', 'garbage');
  write(d, 'users/anna/profile.json.123.tmp', 'half');
  write(d, 'users/.hidden/profile.json', '{}');
  write(d, 'users/ANNA/profile.json', '{}');
  return d;
}

test('a backup holds everyone\'s profile, index, key and usage, plus only the newest few rolling copies, and none of the leftovers', () => {
  const data = dataFolder(), dest = tmp('dest');
  const r = serve('--backup', dest, '--data-dir', data);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Saved .*unfurl-backup-\d{4}-\d{2}-\d{2}\.zip/);
  assert.match(r.stdout, /2 people/);
  const zip = path.join(dest, `unfurl-backup-${today()}.zip`);
  const e = entries(zip);
  assert.deepEqual(Object.keys(e).sort(), [
    'MANIFEST.json', 'usage.json',
    'users/anna/backups/profile-2026-03-04.json', 'users/anna/backups/profile-2026-03-05.json', 'users/anna/backups/profile-2026-03-06.json',
    'users/anna/config.json', 'users/anna/index.json', 'users/anna/profile.json',
    'users/ben-4f2a9c1d03/config.json', 'users/ben-4f2a9c1d03/index.json', 'users/ben-4f2a9c1d03/profile.json',
  ].sort());
  assert.equal(e['users/anna/config.json'], 0o600, 'the key file stays private inside the archive');
  const manifest = JSON.parse(python('import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("MANIFEST.json").decode())', zip).stdout);
  assert.equal(manifest.app, 'unfurl');
  assert.equal(manifest.small, false);
  assert.deepEqual(fs.readdirSync(dest), [path.basename(zip)], 'no temporary file is left behind for a sync tool to pick up');
});

test('--small leaves out the rebuildable index; a single-person folder works too; the same day replaces the file', () => {
  const d = tmp('single'), dest = tmp('dest');
  write(d, 'profile.json', '{"schema":2}'); write(d, 'index.json', '{"schema":2,"videos":{}}'); write(d, 'config.json', '{"apiKey":"x"}');
  assert.equal(serve('--backup', dest, '--data-dir', d, '--small').status, 0);
  const zip = path.join(dest, `unfurl-backup-${today()}.zip`);
  assert.deepEqual(Object.keys(entries(zip)).sort(), ['MANIFEST.json', 'config.json', 'profile.json']);
  assert.equal(serve('--backup', dest, '--data-dir', d).status, 0);
  assert.ok('index.json' in entries(zip), 'the second run (full) replaced the first');
  assert.equal(fs.readdirSync(dest).length, 1);
});

test('old archives are pruned beyond --keep, but nothing else in the folder is ever touched', () => {
  const d = tmp('prune'), dest = tmp('dest');
  write(d, 'profile.json', '{"schema":2}');
  for (const n of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']) write(dest, `unfurl-backup-${n}.zip`, 'old');
  write(dest, 'notes.txt', 'mine'); write(dest, 'unfurl-backup-final.zip', 'mine'); write(dest, 'unfurl-backup-2026-01-01.zip.bak', 'mine');
  const r = serve('--backup', dest, '--data-dir', d, '--keep', '3');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(dest).sort(), [`unfurl-backup-${today()}.zip`, 'notes.txt', 'unfurl-backup-2026-01-04.zip', 'unfurl-backup-2026-01-05.zip', 'unfurl-backup-2026-01-01.zip.bak', 'unfurl-backup-final.zip'].sort());
  assert.match(r.stdout, /removed 3 older/);
  assert.notEqual(serve('--backup', dest, '--data-dir', d, '--keep', '0').status, 0);
});

test('nothing to back up is said plainly, and a damaged profile is still saved with a warning', () => {
  const empty = tmp('empty'), dest = tmp('dest');
  const r = serve('--backup', dest, '--data-dir', empty);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Nothing to back up/);
  assert.deepEqual(fs.readdirSync(dest), [], 'and no empty archive is made');
  const d = tmp('damaged');
  write(d, 'profile.json', '{not json'); write(d, 'backups/profile-2026-03-01.json', '{"schema":2}');
  const w = serve('--backup', dest, '--data-dir', d);
  assert.equal(w.status, 0);
  assert.match(w.stdout, /WARNING: profile\.json is damaged/);
  assert.ok('backups/profile-2026-03-01.json' in entries(path.join(dest, `unfurl-backup-${today()}.zip`)), 'the app\'s own copy travels with it');
});

test('restore brings back exactly what was saved, byte for byte, into an empty folder', () => {
  const data = dataFolder(), dest = tmp('dest'), fresh = tmp('fresh');
  serve('--backup', dest, '--data-dir', data);
  const zip = path.join(dest, `unfurl-backup-${today()}.zip`);
  const r = serve('--restore', zip, '--data-dir', fresh);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Restored 10 files for 2 people/);
  for (const rel of ['users/anna/profile.json', 'users/anna/index.json', 'users/anna/config.json', 'users/ben-4f2a9c1d03/profile.json', 'usage.json', 'users/anna/backups/profile-2026-03-06.json']) {
    assert.equal(fs.readFileSync(path.join(fresh, ...rel.split('/')), 'utf8'), fs.readFileSync(path.join(data, ...rel.split('/')), 'utf8'), rel);
  }
  assert.equal(fs.statSync(path.join(fresh, 'users/anna/config.json')).mode & 0o777, 0o600, 'the key file is private again');
  assert.ok(!fs.existsSync(path.join(fresh, 'users/anna/profile.corrupt-20260101.json')));
});

test('restore never overwrites existing data unless told to, and then moves it aside instead of deleting it', () => {
  const data = dataFolder(), dest = tmp('dest'), target = tmp('target');
  serve('--backup', dest, '--data-dir', data);
  const zip = path.join(dest, `unfurl-backup-${today()}.zip`);
  write(target, 'profile.json', '{"mine":"precious"}');
  const refused = serve('--restore', zip, '--data-dir', target);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /already holds data/);
  assert.equal(fs.readFileSync(path.join(target, 'profile.json'), 'utf8'), '{"mine":"precious"}', 'untouched');
  const forced = serve('--restore', zip, '--data-dir', target, '--force');
  assert.equal(forced.status, 0, forced.stderr);
  const aside = fs.readdirSync(target).find((n) => n.startsWith('before-restore-'));
  assert.ok(aside, 'the old files are kept');
  assert.equal(fs.readFileSync(path.join(target, aside, 'profile.json'), 'utf8'), '{"mine":"precious"}');
  assert.ok(fs.existsSync(path.join(target, 'users/anna/profile.json')));
});

test('restore refuses archives that are not Unfurl backups, or that try to write outside the data folder', () => {
  const bad = tmp('bad'), target = tmp('target');
  const make = (name, files) => {
    const zip = path.join(bad, name);
    python('import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor n,t in json.loads(sys.argv[2]).items(): z.writestr(n,t)\nz.close()', zip, JSON.stringify(files));
    return zip;
  };
  for (const [name, files] of Object.entries({
    'dots.zip': { 'profile.json': '{}', '../escaped.json': '{}' },
    'dots2.zip': { 'profile.json': '{}', 'users/../../escaped/profile.json': '{}' },
    'abs.zip': { 'profile.json': '{}', '/etc/cron.d/x': 'boom' },
    'other.zip': { 'profile.json': '{}', 'serve.py': 'print(1)' },
    'upper.zip': { 'users/ANNA/profile.json': '{}' },
    'dot-user.zip': { 'users/.git/profile.json': '{}' },
    'noprofile.zip': { 'index.json': '{}' },
  })) {
    const r = serve('--restore', make(name, files), '--data-dir', target);
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr, /Nothing was changed/, name);
  }
  assert.deepEqual(fs.readdirSync(target), [], 'nothing was written anywhere');
  assert.ok(!fs.existsSync(path.join(bad, 'escaped.json')) && !fs.existsSync(path.join(os.tmpdir(), 'escaped')));
  const notZip = path.join(bad, 'plain.zip'); fs.writeFileSync(notZip, 'not a zip');
  assert.match(serve('--restore', notZip, '--data-dir', target).stderr, /Can't read/);
  assert.match(serve('--restore', path.join(bad, 'missing.zip'), '--data-dir', target).stderr, /Can't read/);
});

test('--backup and --restore cannot be combined', () => {
  const r = serve('--backup', tmp('x'), '--restore', 'a.zip', '--data-dir', tmp('y'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /one at a time/);
});
