// Collecting sources into the project folder (storage layout A5, task 11): loeseQuelle, einsammelName, kopiereGeprueft, sammleEin, Einsammler.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loeseQuelle, einsammelName, kopiereGeprueft, sammleEin, Einsammler } from '../project/einsammeln.ts';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-einsammeln-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const clip = (id, s, hinweis) => ({ id, art: 'audio', name: id, start_beat: 0, laenge_beats: 4, quelle: { sha256: s, pfad_hinweis: hinweis }, dekodiert: 'nein',
  offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
const projektMit = (...clips) => ({ spuren: [{ id: 's1', clips, takes: [] }] });
// the session's resolver stand-in: catalog path = the file itself
const aufloeser = (karte) => (s, hinweis) => karte[s] ?? (hinweis && fs.existsSync(hinweis) ? hinweis : null);

function aufbau(t, name = 'Kick Drum.wav', inhalt = 'kick-bytes') {
  const d = tmp(t);
  const proj = path.join(d, 'proj'), draussen = path.join(d, 'platte', 'HomeLW', '01 MP3');
  fs.mkdirSync(proj, { recursive: true }); fs.mkdirSync(draussen, { recursive: true });
  const datei = path.join(draussen, name);
  fs.writeFileSync(datei, inhalt);
  return { d, proj, datei, s: sha(inhalt) };
}

test('collect copies an outside source into audio/<name>-<sha8>.<ext> and checks the sha', async (t) => {
  const a = aufbau(t);
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.deepEqual([b.kopiert, b.schon_da, b.fehlt, b.abweichend, b.aufgeschoben], [1, 0, [], [], 0]);
  assert.deepEqual(b.fehlt_grund, {});
  assert.equal(b.bytes, 10);
  const ziel = path.join(a.proj, 'audio', `kick-drum-${a.s.slice(0, 8)}.wav`);
  assert.equal(fs.readFileSync(ziel, 'utf8'), 'kick-bytes');
  assert.deepEqual(fs.readdirSync(path.join(a.proj, 'audio')), [path.basename(ziel)], 'no temp file is left');
  assert.ok(fs.existsSync(a.datei), 'the source stays');
});

test('sources inside the project are left alone', async (t) => {
  const a = aufbau(t);
  const innen = path.join(a.proj, 'audio', 'meins.wav');
  fs.mkdirSync(path.dirname(innen)); fs.writeFileSync(innen, 'kick-bytes');
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, innen)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.equal(b.kopiert, 0);
  assert.deepEqual(fs.readdirSync(path.join(a.proj, 'audio')), ['meins.wav']);
  // a link into the project folder from outside counts as inside by its real path
  const link = path.join(a.d, 'link.wav'); fs.symlinkSync(innen, link);
  const c = await sammleEin({ projekt: projektMit(clip('c1', a.s, link)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.equal(c.kopiert, 0);
});

test('a second collect copies nothing (schon_da)', async (t) => {
  const a = aufbau(t);
  const o = { projekt: projektMit(clip('c1', a.s, a.datei), clip('c2', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) };
  assert.equal((await sammleEin(o)).kopiert, 1, 'one sha is copied once');
  const zwei = await sammleEin(o);
  assert.deepEqual([zwei.kopiert, zwei.schon_da, zwei.bytes], [0, 1, 0]);
});

test('a missing source is reported in fehlt', async (t) => {
  const a = aufbau(t);
  const weg = sha('gone');
  const b = await sammleEin({ projekt: projektMit(clip('c1', weg, path.join(a.d, 'nicht-da.wav')), clip('c2', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.deepEqual([b.kopiert, b.fehlt, b.fehlt_grund], [1, [weg], { [weg]: 'source_missing' }], 'the rest is still collected');
});

test('a take clip counts like a main clip', async (t) => {
  const a = aufbau(t);
  const p = { spuren: [{ id: 's1', clips: [], takes: [{ id: 't1', clips: [clip('c1', a.s, a.datei)] }] }] };
  assert.equal((await sammleEin({ projekt: p, projektOrdner: a.proj, quellPfad: aufloeser({}) })).kopiert, 1);
});

test('a copy with another sha is removed and reported abweichend', async (t) => {
  const a = aufbau(t);
  const falsch = sha('other');   // the clip claims another content than the file holds
  const b = await sammleEin({ projekt: projektMit(clip('c1', falsch, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.deepEqual([b.kopiert, b.abweichend], [0, [falsch]]);
  assert.deepEqual(fs.existsSync(path.join(a.proj, 'audio')) ? fs.readdirSync(path.join(a.proj, 'audio')) : [], [], 'neither copy nor temp file');
});

test('loeseQuelle finds the copy when catalog path and hint are gone', (t) => {
  const a = aufbau(t);
  const ziel = path.join(a.proj, 'audio', einsammelName(a.datei, a.s));
  fs.mkdirSync(path.dirname(ziel)); fs.writeFileSync(ziel, 'kick-bytes');
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: path.join(a.d, 'weg.wav'), projektOrdner: a.proj, katalogPfad: path.join(a.d, 'auch-weg.wav') }), ziel);
  assert.equal(loeseQuelle({ sha256: sha('x'), hinweis: path.join(a.d, 'weg.wav'), projektOrdner: a.proj }), null, 'another sha finds nothing');
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: '', projektOrdner: null }), null, 'without a project folder there is no copy to find');
});

test('loeseQuelle order: catalog path, absolute hint, relative hint, the copy', (t) => {
  const a = aufbau(t);
  const kat = path.join(a.d, 'kat.wav'); fs.writeFileSync(kat, 'k');
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: a.datei, projektOrdner: a.proj, katalogPfad: kat }), kat);
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: a.datei, projektOrdner: a.proj, katalogPfad: path.join(a.d, 'nope.wav') }), a.datei);
  fs.mkdirSync(path.join(a.proj, 'material')); fs.writeFileSync(path.join(a.proj, 'material', 'r.wav'), 'r');
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: 'material/r.wav', projektOrdner: a.proj }), path.join(a.proj, 'material', 'r.wav'));
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: 'material/r.wav', projektOrdner: null }), null, 'a relative hint needs the project folder');
});

test('a relative hint with .. is refused', (t) => {
  const a = aufbau(t);
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: path.join('..', 'platte', 'HomeLW', '01 MP3', 'Kick Drum.wav'), projektOrdner: a.proj }), null);
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: 'a/../../platte/HomeLW/01 MP3/Kick Drum.wav', projektOrdner: a.proj }), null);
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: a.datei, projektOrdner: a.proj }), a.datei, 'positive control: the absolute path is fine');
});

test('einsammelName: readable name, sha8, lower case extension', () => {
  const s = 'ab12cd34' + '0'.repeat(56);
  assert.equal(einsammelName('/x/Kick Drum.WAV', s), 'kick-drum-ab12cd34.wav');
  assert.equal(einsammelName('/x/Müller Straße.Flac', s), 'mueller-strasse-ab12cd34.flac');
  assert.equal(einsammelName('/x/noext', s), 'noext-ab12cd34.wav');
  assert.equal(einsammelName('/x/!!!.mp3', s), 'quelle-ab12cd34.mp3', 'nothing readable left');
});

test('path with spaces', async (t) => {
  const a = aufbau(t, 'Track 01 (Mix).wav');
  const proj = path.join(a.d, 'My Project'); fs.mkdirSync(proj);
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: proj, quellPfad: aufloeser({}) });
  assert.equal(b.kopiert, 1);
  assert.deepEqual(fs.readdirSync(path.join(proj, 'audio')), [`track-01-mix-${a.s.slice(0, 8)}.wav`]);
});

test('the copy runs as nice 19 ionice idle', async (t) => {
  const a = aufbau(t);
  const aufrufe = [];
  const lauf = async (cmd, args) => {
    aufrufe.push([cmd, ...args]);
    if (args.includes('cp')) { fs.copyFileSync(args.at(-2), args.at(-1)); return { code: 0, stdout: '' }; }
    return { code: 0, stdout: `${sha(fs.readFileSync(args.at(-1)))}  ${args.at(-1)}\n` };
  };
  const nach = path.join(a.d, 'ziel.tmp');
  assert.equal(await kopiereGeprueft(a.datei, nach, { lauf, ionice: true }), a.s);
  assert.deepEqual(aufrufe[0], ['nice', '-n', '19', 'ionice', '-c', '3', 'cp', '--', a.datei, nach]);
  assert.deepEqual(aufrufe[1], ['nice', '-n', '19', 'ionice', '-c', '3', 'sha256sum', '--', nach]);
  aufrufe.length = 0;
  await kopiereGeprueft(a.datei, nach, { lauf, ionice: false });
  assert.deepEqual(aufrufe[0], ['nice', '-n', '19', 'cp', '--', a.datei, nach], 'without ionice the call drops it');
});

test('kopiereGeprueft with the real tools and a failing cp', async (t) => {
  const a = aufbau(t);
  const nach = path.join(a.d, 'real.tmp');
  assert.equal(await kopiereGeprueft(a.datei, nach), a.s);
  await assert.rejects(kopiereGeprueft(path.join(a.d, 'nicht-da'), path.join(a.d, 'x.tmp')), /cp failed/);
});

test('a 256 MB source is copied without growing the heap', async (t) => {
  const d = tmp(t);
  const proj = path.join(d, 'proj'); fs.mkdirSync(proj);
  const gross = path.join(d, 'gross.wav');
  fs.closeSync(fs.openSync(gross, 'w')); fs.truncateSync(gross, 256 * 1024 * 1024);   // sparse: no disk use
  const s = await new Promise((ok, f) => { const h = crypto.createHash('sha256'); fs.createReadStream(gross).on('data', (x) => h.update(x)).on('end', () => ok(h.digest('hex'))).on('error', f); });
  global.gc?.();
  const vor = process.memoryUsage();
  const b = await sammleEin({ projekt: projektMit(clip('c1', s, gross)), projektOrdner: proj, quellPfad: aufloeser({}) });
  const nach = process.memoryUsage();
  assert.equal(b.kopiert, 1);
  assert.ok(nach.heapUsed - vor.heapUsed < 32 * 1024 * 1024, `heap grew by ${nach.heapUsed - vor.heapUsed}`);
  assert.ok(nach.arrayBuffers - vor.arrayBuffers < 32 * 1024 * 1024, `arrayBuffers grew by ${nach.arrayBuffers - vor.arrayBuffers}`);
});

test('nur filters what is collected', async (t) => {
  const a = aufbau(t);
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}), nur: () => false });
  assert.deepEqual([b.kopiert, b.fehlt, b.aufgeschoben], [0, [], 0]);
  assert.ok(!fs.existsSync(path.join(a.proj, 'audio')));
});

test('no copy starts while the transport runs', async (t) => {
  const a = aufbau(t);
  let frei = false;
  const o = { projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}), frei: () => frei };
  const b = await sammleEin(o);
  assert.deepEqual([b.kopiert, b.aufgeschoben], [0, 1]);
  assert.ok(!fs.existsSync(path.join(a.proj, 'audio')), 'nothing copied');
  // the background job waits and continues once it is free
  const e = new Einsammler({ wechselplatte: () => true, frei: () => frei, warteMs: 20 });
  e.melde({ projekt: o.projekt, projektOrdner: a.proj, quellPfad: o.quellPfad });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(!fs.existsSync(path.join(a.proj, 'audio')), 'still waiting');
  frei = true;
  await e.leer();
  assert.equal(fs.readdirSync(path.join(a.proj, 'audio')).length, 1);
  await e.schliesse();
});

test('Einsammler: auto-collect only takes removable sources, alles takes everything, the flag wins over the path rule', async (t) => {
  const a = aufbau(t);   // the source lies in a tmp folder: not removable by path
  const o = { projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) };
  const e1 = new Einsammler({ wechselplatte: () => null, frei: () => true });
  e1.melde(o); await e1.leer();
  assert.ok(!fs.existsSync(path.join(a.proj, 'audio')), 'null falls back to the path rule: not removable');
  const e2 = new Einsammler({ wechselplatte: () => false, frei: () => true });
  e2.melde({ ...o, alles: true }); await e2.leer();
  assert.equal(fs.readdirSync(path.join(a.proj, 'audio')).length, 1, 'alles collects regardless');
  fs.rmSync(path.join(a.proj, 'audio'), { recursive: true });
  const e3 = new Einsammler({ wechselplatte: () => true, frei: () => true });
  e3.melde(o); await e3.leer();
  assert.equal(fs.readdirSync(path.join(a.proj, 'audio')).length, 1, 'the flag true wins over the path');
});

test('Einsammler: a second report for the same folder while one waits is dropped', async (t) => {
  const a = aufbau(t);
  const e = new Einsammler({ wechselplatte: () => true, frei: () => true });
  let n = 0;
  const qp = (s, h) => { n += 1; return h; };
  const o = { projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: qp };
  e.melde(o); e.melde(o); e.melde(o);
  await e.leer();
  assert.ok(n <= 3, `resolver calls ${n}`);   // the first runs, the second waits, the third is dropped
  assert.equal(fs.readdirSync(path.join(a.proj, 'audio')).length, 1);
});

test('einsammelText: one line for the output next to the buttons', async () => {
  const { einsammelText } = await import('../public/production/output.js');
  assert.deepEqual(einsammelText({ kopiert: 2, schon_da: 1, fehlt: [], abweichend: [], bytes: 3 * 1048576, aufgeschoben: 0 }),
    { text: 'Collected 2 files (3 MB) · 1 already in the project', titel: '', warnung: false });
  const f = einsammelText({ kopiert: 0, schon_da: 0, fehlt: ['a'], abweichend: ['b'], bytes: 0, aufgeschoben: 0 });
  assert.equal(f.text, 'Collected 0 files · 0 already in the project · 1 missing (disk not mounted?) · 1 copied wrongly and removed');
  assert.equal(f.warnung, true);
});

// --- fix round 1: music, hanging copies, durability, small points ------------------------------------------------------------------------

// a stand-in cp that writes a partial temp file and then hangs until it is told to stop
const haengendesCp = (gestartet) => (cmd, args, o = {}) => new Promise((_ok, f) => {
  const ziel = args.at(-1);
  if (args.includes('cp')) { fs.writeFileSync(ziel, 'partial'); gestartet?.(ziel); }
  o.signal?.addEventListener('abort', () => f(new Error('aborted')), { once: true });
});

test('a hanging cp is stopped after its time limit: the file counts as fehlt with a reason, the temp file is gone', async (t) => {
  const a = aufbau(t);
  const grenzen = [];
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}), lauf: haengendesCp(),
    zeit: (bytes) => { grenzen.push(bytes); return 60; } });
  assert.deepEqual([b.kopiert, b.fehlt, b.fehlt_grund], [0, [a.s], { [a.s]: 'timeout' }]);
  assert.deepEqual(grenzen, [10], 'the limit is asked with the size of the file');
  assert.ok(!fs.existsSync(path.join(a.proj, 'audio')), 'no temp file and no empty folder is left');
});

test('a runner that ignores the signal is left behind at the limit', async (t) => {
  const a = aufbau(t);
  const t0 = Date.now();
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}), lauf: () => new Promise(() => {}), zeit: () => 60 });
  assert.equal(b.fehlt_grund[a.s], 'timeout');
  assert.ok(Date.now() - t0 < 2000);
});

test('the time limit is at least 120 s and 1 s per MB', async () => {
  const { zeitLimitMs } = await import('../project/einsammeln.ts');
  assert.equal(zeitLimitMs(0), 120_000);
  assert.equal(zeitLimitMs(50 * 1048576), 120_000);
  assert.equal(zeitLimitMs(500 * 1048576), 500_000);
});

test('schliesse kills a running copy and removes its temp file; the wait is short', async (t) => {
  const a = aufbau(t);
  let temp = null;
  const e = new Einsammler({ wechselplatte: () => true, frei: () => true, lauf: haengendesCp((z) => { temp = z; }) });
  e.melde({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  for (let i = 0; i < 100 && temp === null; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(temp && fs.existsSync(temp), 'the copy started');
  const t0 = Date.now();
  await e.schliesse();
  assert.ok(Date.now() - t0 < 1500, 'schliesse does not wait for the full limit');
  assert.ok(!fs.existsSync(temp), 'temp file removed');
  assert.ok(!fs.existsSync(path.join(a.proj, 'audio')));
});

test('a run removes leftover .q-*.tmp-* files of the project audio folder and nothing else', async (t) => {
  const a = aufbau(t);
  const audio = path.join(a.proj, 'audio'); fs.mkdirSync(audio);
  for (const n of ['.q-alt-12345678.wav.tmp-ab12cd34', 'take-1.wav', '.q-fremd.wav', 'x.tmp-ab12', '.other.tmp-ab12']) fs.writeFileSync(path.join(audio, n), 'z');
  const alt = new Date(Date.now() - 2 * 3600_000);
  fs.utimesSync(path.join(audio, '.q-alt-12345678.wav.tmp-ab12cd34'), alt, alt);   // a leftover is old; a fresh one may belong to another process
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.equal(b.kopiert, 1);
  assert.deepEqual(fs.readdirSync(audio).sort(), ['.other.tmp-ab12', '.q-fremd.wav', `kick-drum-${a.s.slice(0, 8)}.wav`, 'take-1.wav', 'x.tmp-ab12'].sort());
});

test('a fresh leftover (a second process on the same project) stays; an old one goes', async (t) => {
  const a = aufbau(t);
  const audio = path.join(a.proj, 'audio'); fs.mkdirSync(audio);
  const frisch = '.q-x-12345678.wav.tmp-ab12cd34', alt = '.q-y-12345678.wav.tmp-ab12cd35';
  fs.writeFileSync(path.join(audio, frisch), 'z'); fs.writeFileSync(path.join(audio, alt), 'z');
  const vor = new Date(Date.now() - 3 * 3600_000);
  fs.utimesSync(path.join(audio, alt), vor, vor);
  await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.ok(fs.existsSync(path.join(audio, frisch)), 'fresh stays');
  assert.ok(!fs.existsSync(path.join(audio, alt)), 'old goes');
});

test('a source whose name ends in a dot is found again as a copy', async (t) => {
  const a = aufbau(t, 'track.', 'dot-bytes');
  const o = { projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) };
  assert.equal(einsammelName(a.datei, a.s), `track-${a.s.slice(0, 8)}.wav`);
  assert.equal((await sammleEin(o)).kopiert, 1);
  assert.notEqual(loeseQuelle({ sha256: a.s, hinweis: '', projektOrdner: a.proj }), null, 'the copy is found');
  const b = await sammleEin(o);
  assert.deepEqual([b.kopiert, b.schon_da], [0, 1]);
});

test('the sync does not block the event loop (the async fsync is used)', async (t) => {
  const a = aufbau(t);
  const orig = fs.fsyncSync;
  let blockierend = 0;
  fs.fsyncSync = (fd) => { blockierend += 1; return orig(fd); };
  t.after(() => { fs.fsyncSync = orig; });
  await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.equal(blockierend, 0);
});

test('a run does not remove the temp file of a copy that is running right now', async (t) => {
  const a = aufbau(t);
  let temp = null, frei = null;
  const lauf = (cmd, args, o) => (args.includes('cp') && temp === null ? new Promise((ok) => { temp = args.at(-1); fs.writeFileSync(temp, 'x'); frei = ok; }) : haengendesCp()(cmd, args, o));
  const eins = sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}), lauf });
  for (let i = 0; i < 100 && temp === null; i++) await new Promise((r) => setTimeout(r, 10));
  const zwei = await sammleEin({ projekt: projektMit(clip('c2', sha('other'), path.join(a.d, 'nicht-da'))), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.equal(zwei.fehlt.length, 1);
  assert.ok(fs.existsSync(temp), 'the second run left the running copy alone');
  frei({ code: 1, stdout: '' });
  await eins;
});

test('an empty file is no copy: it is replaced; a real copy is never overwritten', async (t) => {
  const a = aufbau(t);
  const audio = path.join(a.proj, 'audio'); fs.mkdirSync(audio);
  const ziel = path.join(audio, einsammelName(a.datei, a.s));
  fs.writeFileSync(ziel, '');
  assert.equal(loeseQuelle({ sha256: a.s, hinweis: '', projektOrdner: a.proj }), null, 'findeKopie skips the empty file');
  const o = { projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) };
  assert.equal((await sammleEin(o)).kopiert, 1, 'copied again');
  assert.equal(fs.readFileSync(ziel, 'utf8'), 'kick-bytes', 'the empty one was replaced');
  // a real copy stays, even when the source now holds other bytes
  fs.writeFileSync(a.datei, 'changed');
  const b = await sammleEin(o);
  assert.deepEqual([b.kopiert, b.schon_da], [0, 1]);
  assert.equal(fs.readFileSync(ziel, 'utf8'), 'kick-bytes', 'not overwritten');
});

test('the copy is synced before it gets its name (file, then folder)', async (t) => {
  const a = aufbau(t);
  const fsyncs = [];
  const orig = fs.fsync;
  fs.fsync = (fd, cb) => { fsyncs.push(fs.fstatSync(fd).isDirectory() ? 'dir' : 'file'); return orig(fd, cb); };
  t.after(() => { fs.fsync = orig; });
  await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}) });
  assert.deepEqual(fsyncs, ['file', 'dir']);
});

test('while music plays the source is not resolved at all (the disk is not touched)', async (t) => {
  const a = aufbau(t);
  let gefragt = 0;
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: () => { gefragt += 1; return a.datei; }, frei: () => false });
  assert.deepEqual([gefragt, b.aufgeschoben, b.kopiert], [0, 1, 0]);
});

test('no empty audio folder is left after a failed copy', async (t) => {
  const a = aufbau(t);
  const b = await sammleEin({ projekt: projektMit(clip('c1', a.s, a.datei)), projektOrdner: a.proj, quellPfad: aufloeser({}), lauf: async () => ({ code: 1, stdout: '' }) });
  assert.deepEqual([b.kopiert, b.fehlt_grund[a.s]], [0, 'copy_failed']);
  assert.ok(!fs.existsSync(path.join(a.proj, 'audio')));
});
