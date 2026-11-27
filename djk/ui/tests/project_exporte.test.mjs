// Keeping three exports per project (storage layout A5, task 12): raeumeExporteAuf, genannteExporte and the djk-exporte CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BEGLEITER_REST, EXPORT_NAME, raeumeExporteAuf, genannteExporte, baueNachExport } from '../project/exporte.ts';
import { Einsammler } from '../project/einsammeln.ts';
import { abgabeName, leseAbgaben } from '../project/abgabe.ts';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-exporte-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const aufbau = (t, namen) => {
  const d = tmp(t), ex = path.join(d, 'proj', 'export'), bin = path.join(d, '.papierkorb', 'exporte', 'proj');
  fs.mkdirSync(ex, { recursive: true });
  for (const n of namen) { if (n.endsWith('/')) { fs.mkdirSync(path.join(ex, n)); fs.writeFileSync(path.join(ex, n, 'mix.wav'), 'x'); } else fs.writeFileSync(path.join(ex, n), n); }
  return { d, ex, bin };
};
const ls = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);

test('the name pattern', () => {
  for (const n of ['a-20261015-181500.wav', 'a-20261015-181500', 'a-b-20261015-181500-2.wav', 'a-20261015-181500-12']) assert.match(n, EXPORT_NAME, n);
  for (const n of ['notes.txt', 'a-2026-181500.wav', '20261015-181500.wav', 'a-20261015-181500.mp3']) assert.doesNotMatch(n, EXPORT_NAME, n);
});

test('a file without the .wav extension does not count as an export, a folder with mix.wav does', (t) => {
  const a = aufbau(t, ['p-20261001-100000', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav', 'p-20261005-100000.wav']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin });
  assert.deepEqual(r.verschoben, ['p-20261002-100000.wav']);
  assert.ok(ls(a.ex).includes('p-20261001-100000'), 'the file without extension stays untouched');
  const b = aufbau(t, ['q-20261001-100000/', 'q-20261002-100000.wav', 'q-20261003-100000.wav', 'q-20261004-100000.wav']);
  assert.deepEqual(raeumeExporteAuf({ exportOrdner: b.ex, papierkorb: b.bin }).verschoben, ['q-20261001-100000']);
});

test('keeps the three newest by stamp and moves the rest to the bin', (t) => {
  const a = aufbau(t, ['p-20261001-100000.wav', 'p-20261003-100000.wav', 'p-20261002-100000.wav', 'p-20261004-100000.wav', 'p-20261005-100000.wav']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin });
  assert.deepEqual(r.verschoben.sort(), ['p-20261001-100000.wav', 'p-20261002-100000.wav']);
  assert.deepEqual(ls(a.ex), ['p-20261003-100000.wav', 'p-20261004-100000.wav', 'p-20261005-100000.wav']);
  assert.deepEqual(ls(a.bin), ['p-20261001-100000.wav', 'p-20261002-100000.wav']);
  assert.equal(fs.readFileSync(path.join(a.bin, 'p-20261001-100000.wav'), 'utf8'), 'p-20261001-100000.wav', 'moved, not copied or emptied');
  assert.deepEqual(raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin }).verschoben, [], 'a second run changes nothing');
});

test('file and folder exports count together', (t) => {
  const a = aufbau(t, ['p-20261001-100000.wav', 'p-20261002-100000/', 'p-20261003-100000.wav', 'p-20261004-100000/']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin });
  assert.deepEqual(r.verschoben, ['p-20261001-100000.wav']);
  assert.deepEqual(ls(a.ex), ['p-20261002-100000', 'p-20261003-100000.wav', 'p-20261004-100000']);
  assert.deepEqual(raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, behalte: 1 }).verschoben.sort(), ['p-20261002-100000', 'p-20261003-100000.wav']);
});

test('foreign names stay', (t) => {
  const a = aufbau(t, ['notes.txt', 'p-20261001-100000.mp3', 'p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav']);
  assert.deepEqual(raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin }).verschoben, ['p-20261001-100000.wav']);
  assert.deepEqual(ls(a.ex), ['notes.txt', 'p-20261001-100000.mp3', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav']);
  assert.deepEqual(raeumeExporteAuf({ exportOrdner: path.join(a.d, 'gibt-es-nicht'), papierkorb: a.bin }).verschoben, [], 'no export folder is nothing to do');
});

test('a taken name in the bin gets .2', (t) => {
  const a = aufbau(t, ['p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav']);
  fs.mkdirSync(a.bin, { recursive: true });
  fs.writeFileSync(path.join(a.bin, 'p-20261001-100000.wav'), 'old');
  fs.writeFileSync(path.join(a.bin, 'p-20261001-100000.wav.2'), 'older');
  raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin });
  assert.deepEqual(ls(a.bin), ['p-20261001-100000.wav', 'p-20261001-100000.wav.2', 'p-20261001-100000.wav.3']);
  assert.equal(fs.readFileSync(path.join(a.bin, 'p-20261001-100000.wav'), 'utf8'), 'old', 'nothing in the bin is replaced');
  assert.equal(fs.readFileSync(path.join(a.bin, 'p-20261001-100000.wav.3'), 'utf8'), 'p-20261001-100000.wav');
});

test('a name in a .md of genannt stays and does not count', (t) => {
  const a = aufbau(t, ['p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav', 'p-20261005-100000.wav']);
  const g = path.join(a.d, 'hoerbogen', 'unter');
  fs.mkdirSync(g, { recursive: true });
  fs.writeFileSync(path.join(g, 'bogen.md'), 'Take `p-20261001-100000.wav`, not p-20261009-999999.\nSee export/p-20261002-100000.wav. (p-20261099-1)');
  fs.writeFileSync(path.join(g, 'bogen.txt'), 'p-20261003-100000.wav');
  const genannt = genannteExporte([path.join(a.d, 'hoerbogen'), path.join(a.d, 'gibt-es-nicht')]);
  assert.deepEqual([...genannt].sort(), ['p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261009-999999']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, genannt });
  assert.deepEqual(r.verschoben, [], 'two named, three others kept: nothing moves');
  assert.equal(raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, genannt, behalte: 2 }).verschoben.join(), 'p-20261003-100000.wav');
  assert.ok(ls(a.ex).includes('p-20261001-100000.wav') && ls(a.ex).includes('p-20261002-100000.wav'));
});

test('the 8 exports of a real project', (t) => {
  // the shape of a real project: wav files, one folder export, a tie with -2 in the same second
  const s = 'dress-rehearsal-1-deep';
  const namen = [`${s}-20261108-143012.wav`, `${s}-20261108-190501.wav`, `${s}-20261109-101010.wav`, `${s}-20261109-101010-2.wav`,
    `${s}-20261110-081530/`, `${s}-20261110-225959.wav`, `${s}-20261111-120000.wav`, `${s}-20261112-093000/`];
  const a = aufbau(t, namen);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin });
  assert.deepEqual(r.verschoben.sort(), [`${s}-20261108-143012.wav`, `${s}-20261108-190501.wav`, `${s}-20261109-101010.wav`, `${s}-20261109-101010-2.wav`,
    `${s}-20261110-081530`].sort());
  assert.deepEqual(ls(a.ex), [`${s}-20261110-225959.wav`, `${s}-20261111-120000.wav`, `${s}-20261112-093000`]);
  // the tie: with three kept in a tie situation the -2 counts as newer than the plain name
  const b = aufbau(t, [`${s}-20261109-101010.wav`, `${s}-20261109-101010-2.wav`, `${s}-20261109-101010-3.wav`, `${s}-20261109-101011.wav`]);
  raeumeExporteAuf({ exportOrdner: b.ex, papierkorb: b.bin });
  assert.deepEqual(ls(b.bin), [`${s}-20261109-101010.wav`]);
});

test('the CLI dry run moves nothing and sees linked projects', (t) => {
  const d = tmp(t), heim = path.join(d, 'heim'), wurzel = path.join(d, 'projekte'), aussen = path.join(d, 'aussen');
  const mach = (basis, namen) => { fs.mkdirSync(path.join(basis, 'export'), { recursive: true }); for (const n of namen) fs.writeFileSync(path.join(basis, 'export', n), n); };
  const fuenf = ['p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav', 'p-20261005-100000.wav'];
  mach(path.join(wurzel, 'eins'), fuenf);
  mach(path.join(aussen, 'verlinkt'), fuenf.slice(0, 4));
  fs.symlinkSync(path.join(aussen, 'verlinkt'), path.join(wurzel, 'verlinkt'));
  fs.mkdirSync(path.join(wurzel, '.papierkorb'), { recursive: true });
  fs.mkdirSync(path.join(d, 'bogen'), { recursive: true });
  fs.writeFileSync(path.join(d, 'bogen', 'a.md'), 'p-20261001-100000.wav');
  const cli = path.join(import.meta.dirname, '..', 'project', 'exporte_cli.ts');
  const lauf = (...arg) => spawnSync(process.execPath, [cli, '--wurzel', wurzel, ...arg], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d, CYPHERDJ_HEIM: heim } });
  const vorher = [ls(path.join(wurzel, 'eins', 'export')), ls(path.join(aussen, 'verlinkt', 'export'))];
  const r = lauf();
  assert.equal(r.status, 0, r.stderr);
  const zeilen = r.stdout.split('\n').filter((z) => /^(eins|verlinkt)\s/.test(z)).map((z) => z.trim().split(/\s+/));
  assert.deepEqual(zeilen, [['eins', '3', '2'], ['verlinkt', '3', '1']]);
  assert.deepEqual([ls(path.join(wurzel, 'eins', 'export')), ls(path.join(aussen, 'verlinkt', 'export'))], vorher, 'the dry run moved nothing');
  assert.ok(!fs.existsSync(path.join(wurzel, '.papierkorb', 'exporte')));
  const e = lauf('--ausfuehren', '--genannt-in', path.join(d, 'bogen'));
  assert.equal(e.status, 0, e.stderr);
  assert.deepEqual(ls(path.join(wurzel, 'eins', 'export')), fuenf.slice(0, 1).concat(fuenf.slice(2)));
  assert.deepEqual(ls(path.join(wurzel, '.papierkorb', 'exporte', 'eins')), ['p-20261002-100000.wav']);
  assert.equal(ls(path.join(aussen, 'verlinkt', 'export')).length, 4, 'the named one stays, the other three are kept');
  assert.equal(lauf('--gibt-es-nicht').status, 2);
});

test('a slug that ends in a stamp: the stamp at the end of the name counts', (t) => {
  const s = 'mix-20261101-120000';
  const a = aufbau(t, [1, 2, 3, 4, 5].map((n) => `${s}-20261101-1${n}0000.wav`));
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin });
  assert.deepEqual(r.verschoben.sort(), [`${s}-20261101-110000.wav`, `${s}-20261101-120000.wav`]);
  assert.deepEqual(ls(a.ex), [3, 4, 5].map((n) => `${s}-20261101-1${n}0000.wav`));
});

test('the export just written stays although its stamp is older (clock set back)', (t) => {
  const a = aufbau(t, ['p-20261105-100000.wav', 'p-20261106-100000.wav', 'p-20261107-100000.wav', 'p-20261001-100000.wav']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, neu: 'p-20261001-100000.wav' });
  assert.deepEqual(r.verschoben, []);
  assert.equal(ls(a.ex).length, 4);
});

test('MIDI export folders neither count nor move', (t) => {
  const a = aufbau(t, ['p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000/']);
  fs.mkdirSync(path.join(a.ex, 'p-20261005-100000')); fs.writeFileSync(path.join(a.ex, 'p-20261005-100000', 'p.mid'), 'm');
  fs.mkdirSync(path.join(a.ex, 'p-20261006-100000')); fs.writeFileSync(path.join(a.ex, 'p-20261006-100000', 'p.mid'), 'm');
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin });
  assert.deepEqual(r.verschoben, ['p-20261001-100000.wav']);
  assert.ok(ls(a.ex).includes('p-20261005-100000') && ls(a.ex).includes('p-20261006-100000'));
});

test('a failing move leaves the file, logs once and leaves no empty bin', (t) => {
  const a = aufbau(t, ['p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav', 'p-20261005-100000.wav']);
  const log = [];
  const umbenenne = () => { throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' }); };
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, umbenenne, log: (z) => log.push(z) });
  assert.deepEqual(r.verschoben, []);
  assert.equal(ls(a.ex).length, 5);
  assert.equal(log.length, 1);
  assert.equal(log[0].typ, 'export_aufraeumen_fehler');
  assert.ok(!fs.existsSync(a.bin), 'no empty bin folder is left');
});

// a real second file system: /dev/shm is another device than the temp folder (a linked project on another disk has its bin elsewhere)
const andereDisk = (() => { try { return fs.statSync('/dev/shm').dev !== fs.statSync(os.tmpdir()).dev; } catch { return false; } })();
test('a real cross-device move fails with EXDEV: the file stays, one log line, no empty bin', { skip: !andereDisk && 'no second file system' }, (t) => {
  const shm = fs.mkdtempSync('/dev/shm/djk-exporte-'); t.after(() => fs.rmSync(shm, { recursive: true, force: true }));
  const bin = path.join(tmp(t), '.papierkorb', 'exporte', 'proj');
  const ex = path.join(shm, 'export'); fs.mkdirSync(ex);
  for (let n = 1; n <= 5; n++) fs.writeFileSync(path.join(ex, `p-2026100${n}-100000.wav`), 'x');
  const log = [];
  const r = raeumeExporteAuf({ exportOrdner: ex, papierkorb: bin, log: (z) => log.push(z) });
  assert.deepEqual(r.verschoben, []);
  assert.equal(fs.readdirSync(ex).length, 5);
  assert.equal(log.length, 1);
  assert.match(log[0].fehler, /EXDEV/);
  assert.ok(!fs.existsSync(bin));
});

test('the hook tidies nothing and logs once when a genannt folder is missing', (t) => {
  const a = aufbau(t, ['p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav']);
  const log = [];
  const haken = baueNachExport({ einsammler: new Einsammler({ wechselplatte: () => null, frei: () => true }), offen: () => null, quellPfad: () => null,
    log: (z) => log.push(z) });
  const alt = process.env.CYPHERDJ_EXPORT_GENANNT;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_EXPORT_GENANNT; else process.env.CYPHERDJ_EXPORT_GENANNT = alt; });
  const fehlt = path.join(a.d, 'weg');
  process.env.CYPHERDJ_EXPORT_GENANNT = fehlt;
  const proj = path.join(a.d, 'proj');
  haken({ slug: 'proj', ordner: proj }); haken({ slug: 'proj', ordner: proj });
  assert.equal(ls(a.ex).length, 4, 'nothing was tidied');
  assert.deepEqual(log, [{ typ: 'export_genannt_ordner_fehlt', ordner: fehlt }], 'logged once per start');
  fs.mkdirSync(fehlt);
  haken({ slug: 'proj', ordner: proj });
  assert.equal(ls(a.ex).length, 3, 'with the folder back the rule runs');
});

test('the CLI reads CYPHERDJ_EXPORT_GENANNT, --genannt-in wins, a missing folder is exit 2', (t) => {
  const d = tmp(t), wurzel = path.join(d, 'projekte'), ex = path.join(wurzel, 'eins', 'export');
  fs.mkdirSync(ex, { recursive: true });
  const fuenf = ['p-20261001-100000.wav', 'p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav', 'p-20261005-100000.wav'];
  for (const n of fuenf) fs.writeFileSync(path.join(ex, n), n);
  fs.mkdirSync(path.join(d, 'bogen')); fs.mkdirSync(path.join(d, 'leer'));
  fs.writeFileSync(path.join(d, 'bogen', 'a.md'), 'p-20261001-100000.wav');
  const cli = path.join(import.meta.dirname, '..', 'project', 'exporte_cli.ts');
  const lauf = (env, ...arg) => spawnSync(process.execPath, [cli, '--wurzel', wurzel, ...arg], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d, CYPHERDJ_HEIM: path.join(d, 'heim'), ...env } });
  const zeile = (r) => r.stdout.split('\n').find((z) => z.startsWith('eins')).trim().split(/\s+/).join(' ');
  assert.equal(zeile(lauf({ CYPHERDJ_EXPORT_GENANNT: path.join(d, 'bogen') })), 'eins 4 1', 'the variable protects the named export');
  assert.equal(zeile(lauf({ CYPHERDJ_EXPORT_GENANNT: path.join(d, 'bogen') }, '--genannt-in', path.join(d, 'leer'))), 'eins 3 2', '--genannt-in wins');
  assert.equal(zeile(lauf({ CYPHERDJ_EXPORT_GENANNT: '' })), 'eins 3 2', 'empty counts as unset');
  const fehlt = lauf({ CYPHERDJ_EXPORT_GENANNT: path.join(d, 'weg') });
  assert.equal(fehlt.status, 2);
  assert.match(fehlt.stderr, /does not exist/);
  assert.equal(lauf({}, '--genannt-in', path.join(d, 'weg')).status, 2);
  assert.equal(ls(ex).length, 5, 'nothing moved');
});

// ---- delivery files (export delivery plan, task 2) ---------------------------------------------------------------------------------
test('delivery files move to the bin with their master and never count', (t) => {
  const a = aufbau(t, ['s-20261101-100000.wav', 's-20261102-100000.wav', 's-20261102-100000.16bit-44k.wav', 's-20261102-100000.320kbps-44k.mp3',
    's-20261103-100000.wav', 's-20261104-100000.wav']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, behalte: 3 });
  assert.deepEqual(r.verschoben, ['s-20261101-100000.wav']);
  assert.equal(r.behalten, 3);
  fs.writeFileSync(path.join(a.ex, 's-20261105-100000.wav'), 'x');
  const r2 = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, behalte: 3 });
  assert.deepEqual(r2.verschoben, ['s-20261102-100000.wav', 's-20261102-100000.16bit-44k.wav', 's-20261102-100000.320kbps-44k.mp3']);
  assert.equal(r2.behalten, 3);
  assert.deepEqual(ls(a.bin), ['s-20261101-100000.wav', 's-20261102-100000.16bit-44k.wav', 's-20261102-100000.320kbps-44k.mp3', 's-20261102-100000.wav']);
  assert.deepEqual(ls(a.ex), ['s-20261103-100000.wav', 's-20261104-100000.wav', 's-20261105-100000.wav']);
});

test('a master that stays keeps its companions (among the newest, genannt, neu)', (t) => {
  const a = aufbau(t, ['s-20261101-100000.wav', 's-20261101-100000.16bit-44k.wav', 's-20261102-100000.wav', 's-20261103-100000.wav', 's-20261104-100000.wav',
    's-20261105-100000.wav', 's-20261105-100000.320kbps-44k.mp3']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, behalte: 3, genannt: new Set(['s-20261101-100000.wav']) });
  assert.deepEqual(r.verschoben, ['s-20261102-100000.wav']);
  assert.ok(ls(a.ex).includes('s-20261101-100000.16bit-44k.wav'), 'a master named in genannt keeps its companions');
  assert.ok(ls(a.ex).includes('s-20261105-100000.320kbps-44k.mp3'), 'the newest keeps its companions');
  // neu: the export just written stays although it would be old by stamp
  const b = aufbau(t, ['s-20261001-100000.wav', 's-20261001-100000.16bit-44k.wav', 's-20261102-100000.wav', 's-20261103-100000.wav', 's-20261104-100000.wav']);
  const r2 = raeumeExporteAuf({ exportOrdner: b.ex, papierkorb: b.bin, behalte: 3, neu: 's-20261001-100000.wav' });
  assert.deepEqual(r2.verschoben, []);
  assert.ok(ls(b.ex).includes('s-20261001-100000.16bit-44k.wav'));
});

test('dry run lists the companions too and moves nothing', (t) => {
  const a = aufbau(t, ['s-20261101-100000.wav', 's-20261101-100000.16bit-44k.wav', 's-20261102-100000.wav', 's-20261103-100000.wav', 's-20261104-100000.wav']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, behalte: 3, trocken: true });
  assert.deepEqual(r.verschoben, ['s-20261101-100000.wav', 's-20261101-100000.16bit-44k.wav']);
  assert.equal(r.behalten, 3);
  assert.equal(ls(a.ex).length, 5);
});

test('genannteExporte: a delivery file named in a notes file names its master', (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'notes.md'), 'sent s-20261102-100000.320kbps-44k.mp3 to the label, and `x-20261001-090000.16bit-48k.flac`.\n');
  const g = genannteExporte([d]);
  assert.ok(g.has('s-20261102-100000.wav'));
  assert.ok(g.has('x-20261001-090000.wav'));
  assert.ok(!g.has('s-20261102-100000.320kbps-44k.mp3'));
});

test('only names that abgabeName can produce are companions: notes, .asd and a leftover .teil stay when the master goes to the bin', (t) => {
  const m = 's-20261101-100000';
  const a = aufbau(t, [`${m}.wav`, `${m}.16bit-44k.wav`, `${m}.notes.txt`, `${m}.wav.asd`, `${m}.16bit-44k.wav.12345.teil`,
    's-20261102-100000.wav', 's-20261103-100000.wav', 's-20261104-100000.wav']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, behalte: 3 });
  assert.deepEqual(r.verschoben, [`${m}.wav`, `${m}.16bit-44k.wav`]);
  assert.deepEqual(ls(a.ex), [`${m}.16bit-44k.wav.12345.teil`, `${m}.notes.txt`, `${m}.wav.asd`, 's-20261102-100000.wav', 's-20261103-100000.wav', 's-20261104-100000.wav']);
  assert.deepEqual(ls(a.bin), [`${m}.16bit-44k.wav`, `${m}.wav`]);
});

test('every name abgabeName produces for a valid entry is recognised as a companion', (t) => {
  const eintraege = [];
  for (const rate_hz of [44100, 48000, 88200, 96000]) {
    for (const bits of [16, 24, 32]) eintraege.push({ format: 'wav', bits, rate_hz, ...(bits === 16 ? { dither: 'aus' } : {}) });
    for (const bits of [16, 24]) eintraege.push({ format: 'flac', bits, rate_hz, ...(bits === 16 ? { dither: 'aus' } : {}) });
    if (rate_hz <= 48000) for (const kbps of [192, 256, 320]) eintraege.push({ format: 'mp3', kbps, rate_hz });
  }
  const m = 's-20261101-100000', namen = [];
  for (const e of eintraege) {
    const [gueltig] = leseAbgaben([e]);
    const name = path.basename(abgabeName(`/x/${m}.wav`, gueltig));
    assert.ok(name.startsWith(`${m}.`) && BEGLEITER_REST.test(name.slice(m.length + 1)), name);
    namen.push(name);
  }
  assert.equal(new Set(namen).size, namen.length);
  const a = aufbau(t, [`${m}.wav`, ...namen, 's-20261102-100000.wav', 's-20261103-100000.wav', 's-20261104-100000.wav']);
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin, behalte: 3 });
  assert.deepEqual(r.verschoben, [`${m}.wav`, ...[...namen].sort()]);
  assert.equal(r.behalten, 3);
});

test('a per-track folder with mix.flac counts as an export in the clean-up', (t) => {
  const a = aufbau(t, ['p-20261002-100000.wav', 'p-20261003-100000.wav', 'p-20261004-100000.wav']);
  const f = path.join(a.ex, 'p-20261001-100000');
  fs.mkdirSync(f); fs.writeFileSync(path.join(f, 'mix.flac'), 'x');
  const r = raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin });
  assert.deepEqual(r.verschoben, ['p-20261001-100000'], 'the oldest export is the flac folder');
  assert.deepEqual(ls(a.bin), ['p-20261001-100000']);
  // a folder without mix.wav and mix.flac (MIDI export) still does not count
  const m = path.join(a.ex, 'p-20260901-100000'); fs.mkdirSync(m); fs.writeFileSync(path.join(m, 'p.mid'), 'x');
  assert.deepEqual(raeumeExporteAuf({ exportOrdner: a.ex, papierkorb: a.bin }).verschoben, []);
  assert.ok(ls(a.ex).includes('p-20260901-100000'));
});
