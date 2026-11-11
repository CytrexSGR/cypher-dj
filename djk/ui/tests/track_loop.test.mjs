// 1.12 S7 (M13) "track band loop", plan PLAN-1.12-slices4-5-7 U12/U13 (outside the repo; source: the Studio S8 plan
// docs/superpowers/plans/2026-09-29-djk-studio-s8-schleife.md and spec docs/superpowers/specs/2026-10-22-1.12-automation.md, with the review findings MAJOR 1 to 4 and MINOR 5 to 7 folded in).
// The page server against the core mock (128 BPM: one bar is 1.875 s). Own file, so that server.test.mjs stays untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz, serverInstanzSetzen } from './support/instance.mjs';
import { pruefeWirtOrdner } from './support/instrument_host_sock.mjs';

belegeTestInstanz();
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-sl-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const CYPHER = { 'x-djk-quelle': 'cypher' };
const postJson = (url, pfad, daten, kopf = {}) => fetch(url + pfad, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf },
  body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
const liste = async (url) => (await fetch(`${url}/spur`)).json();

// Server plus core mock, like stapel() in server.test.mjs (reduced). Every log line carries the core beat the server saw when it was written
// (`_beat`), so a test can tell whether a part was sent before its start.
async function stapel(t, { wirtOrdner } = {}) {
  const tmp = fs.mkdtempSync(path.join(TMP, 'st-'));
  const tmpd = (n) => fs.mkdtempSync(path.join(tmp, `${n}-`));
  const ab = path.join(fs.mkdtempSync('/dev/shm/djk-sl-test-'), 'material');
  fs.mkdirSync(ab, { recursive: true });
  const konfig = path.join(tmp, 'kern.toml');
  fs.writeFileSync(konfig, `arr_ordner = ${JSON.stringify(path.join(tmp, 'arr'))}\n`);
  const att = spawn(process.execPath, [path.join(REPO, 'djk/contract/mock_core.mjs'), '--frisch', '--arbeitsbestand', ab, '--konfig', konfig,
    '--zustand', path.join(tmp, 'zustand.json')], { env: { ...process.env, CYPHERDJ_INSTANZ: TEST_INSTANZ }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, f) => { att.stdout.once('data', ok); att.once('exit', (c) => f(new Error(`attrappe rc ${c}`))); });
  let laufend = null;
  t.after(async () => {
    if (laufend) await laufend.stoppe();
    if (att.exitCode === null && att.signalCode === null) { const zu = new Promise((r) => att.once('exit', r)); att.kill('SIGTERM'); await zu; }
    fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.dirname(ab), { recursive: true, force: true });
  });
  const log = [];
  const huellen = path.join(tmpd('huellen'), 'huellen'); schreibeLeerenRing(huellen);
  serverInstanzSetzen(t);
  let o = null;
  o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmpd('bestand'), arbeitsbestand: ab,
    mutationen: [], loops: tmpd('loops'), kits: tmpd('kits'), welleCache: tmpd('welle'), musterOrdner: tmpd('muster'), hotcueOrdner: tmpd('hc'),
    rasterOrdner: tmpd('raster'), huellen, wirtOrdner: wirtOrdner ?? tmpd('wirt'), baukastenOrdner: tmpd('baukasten'),
    log: (z) => log.push({ ...z, _beat: o?.kern.uhr?.beat ?? null }) });
  await o.starte();
  laufend = o;
  for (let i = 0; i < 100 && o.kern.zustand !== 'verbunden'; i++) await warte(20);
  assert.equal(o.kern.zustand, 'verbunden');
  for (let i = 0; i < 100 && !o.kern.uhr; i++) await warte(20);
  return { o, log, url: `http://127.0.0.1:${47300 + K}` };
}

// Restart of the page server on the same options (pattern of neustart() in server.test.mjs)
async function neustart(t, o, pauseMs = 0) {
  await o.stoppe();
  await warte(pauseMs);
  const log = [];
  let o2 = null;
  o2 = new Oberflaeche({ ...o.opt, log: (z) => log.push({ ...z, _beat: o2?.kern.uhr?.beat ?? null }) });
  await o2.starte();
  for (let i = 0; i < 100 && o2.kern.zustand !== 'verbunden'; i++) await warte(20);
  for (let i = 0; i < 100 && !o2.kern.uhr; i++) await warte(20);
  t.after(() => o2.stoppe());
  return { o2, log };
}

// Fake wirt whose answer is decided per command line: antwort(zeile, nummer) → answer object or a promise of one (a held answer)
async function fakeWirt(t, ordner, gruppe, antwort = () => ({ ok: true })) {
  pruefeWirtOrdner(ordner);
  const zeilen = [];
  const srv = net.createServer((c) => {
    let d = '';
    c.on('data', async (b) => {
      d += b;
      if (!d.endsWith('\n')) return;
      const z = JSON.parse(d); zeilen.push(z);
      const a = await antwort(z, zeilen.length - 1);
      if (!c.destroyed) c.end(JSON.stringify(a) + '\n');
    });
    c.on('error', () => {});
  });
  await new Promise((ok) => srv.listen(path.join(ordner, `wirt-${gruppe}.sock`), ok));
  t.after(() => srv.close());
  return zeilen;
}

const teileVon = (log, name) => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && z.felder.plan === `spur:${name}`);
const bis = async (fn, ms = 15000) => { const ende = Date.now() + ms; while (!fn() && Date.now() < ende) await warte(25); return fn(); };
const fader = (name, n = 1, nach = -30) => ({ name, schleife_takte: n, fahrten: [
  { ziel: 'erz/2/fader', ab_takt: 1, nach: 0 }, { ziel: 'erz/2/fader', ab_takt: 1, takte: n, nach, form: 'linear' }] });

test('S7 loop T12.3 AK30: passes follow without gap, parts consecutive, spacing 4n beats, STOP ends everything', async (t) => {
  const { url, log } = await stapel(t);
  const r = await postJson(url, '/spur', { spur: fader('band-2-fader') });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.ende_beat - r.j.anker_beat, 4, 'the answer names the end of pass 0');
  await bis(() => teileVon(log, 'band-2-fader').length >= 8);
  const tt = teileVon(log, 'band-2-fader');
  assert.ok(tt.length >= 8, `only ${tt.length} parts`);
  assert.deepEqual(tt.slice(0, 8).map((z) => z.felder.ab_beat - r.j.anker_beat), [0, 0, 4, 4, 8, 8, 12, 12]);
  assert.deepEqual(tt.slice(0, 8).map((z) => z.felder.teil), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(tt.every((z) => z._beat < z.felder.ab_beat), 'every part leaves before its start');
  const [s] = await liste(url);
  assert.equal(s.schleife_takte, 1); assert.ok(s.durchlauf >= 1, JSON.stringify(s));
  assert.equal(s.ende_beat - s.anker_beat, 4, 'GET /spur names the running pass');
  assert.equal((await postJson(url, '/spur/stopp', { name: 'band-2-fader' })).code, 200);
  const n = teileVon(log, 'band-2-fader').length;
  await warte(2500);
  assert.equal(teileVon(log, 'band-2-fader').length, n, 'no pass after STOP');
  assert.deepEqual(await liste(url), []);
});

test('S7 loop T12.3 AK30 before case: without schleife_takte the track ends after its length + 1 and nothing follows', async (t) => {
  const { url, log } = await stapel(t);
  const { schleife_takte, ...einmal } = fader('einmal');
  assert.equal(schleife_takte, 1);
  const r = await postJson(url, '/spur', { spur: einmal });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  for (let i = 0; i < 400 && (await liste(url)).length; i++) await warte(50);
  assert.deepEqual(await liste(url), [], 'gone after the end');
  await warte(2000);
  assert.equal(teileVon(log, 'einmal').length, 2, 'exactly the two parts of one pass');
});

test('S7 loop T12.3 AK31 (1): the watcher is serial (a slow wirt plans no pass twice), STOP during an await, wirt error ends the loop', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { url, log } = await stapel(t, { wirtOrdner: wo });
  // every fahre is answered after 600 ms: twelve ticks of the watcher fall into one await
  const bass = await fakeWirt(t, wo, 'bass', async (z) => { if (z.befehl === 'fahre') await warte(600); return { ok: true }; });
  const spur = { name: 'cut', schleife_takte: 1, fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 },
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] };
  const r = await postJson(url, '/spur', { spur }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  await bis(() => teileVon(log, 'cut').length >= 4);
  const fahre = () => bass.filter((z) => z.befehl === 'fahre');
  const ab = fahre().map((z) => z.ab);
  assert.equal(new Set(ab).size, ab.length, `a pass went to the wirt twice: ${ab}`);
  const kern = teileVon(log, 'cut').map((z) => z.felder.ab_beat);
  assert.equal(new Set(kern).size, kern.length, `a pass went to the core twice: ${kern}`);
  assert.deepEqual(kern.slice(0, 4).map((b) => b - r.j.anker_beat), [0, 4, 8, 12]);
  // STOP while the watcher waits for the wirt: wait until a fahre for the next pass is pending, then stop
  const nWirt = fahre().length, nKern = teileVon(log, 'cut').length;
  await bis(() => fahre().length > nWirt);
  assert.equal(teileVon(log, 'cut').length, nKern, 'the core part of that pass waits behind the wirt');
  assert.equal((await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER)).code, 200);
  await warte(2500);
  assert.equal(teileVon(log, 'cut').length, nKern, 'no core part after STOP');
  assert.equal(fahre().length, nWirt + 1, 'no further fahre after STOP');
  assert.equal(bass.at(-1).befehl, 'halte', 'the wirt is held after the late answer');
  assert.deepEqual(await liste(url), []);
});

// Review rest 1: STOP and an immediate new PLAY of the same name during the old pass's wirt await. The wirt must see, in this order:
// old fahre, halte (compensation of the old run), new fahre. A new run waits (bounded by the wirtRuf timeout) until the in-flight wirt call
// of the previous run of that name has settled. (A halte skipped for the new run's sake is wrong: host_control.py replaces only ramps with
// t0 >= the new ab, an orphaned older ramp would survive.)
test('S7 loop review rest 1 (a): STOP + new PLAY during the old pass\'s wirt await: old fahre, halte, new fahre, nothing halted afterwards', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { url, log } = await stapel(t, { wirtOrdner: wo });
  let nFahre = 0;
  const bass = await fakeWirt(t, wo, 'bass', async (z) => { if (z.befehl === 'fahre' && nFahre++ === 1) await warte(1800); return { ok: true }; });
  const spur = { name: 'cut', schleife_takte: 1, fahrten: [{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] };
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).code, 200);
  await bis(() => bass.filter((z) => z.befehl === 'fahre').length >= 2);   // the old pass 1 is now pending at the wirt
  assert.equal((await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER)).code, 200);
  const von = bass.length;   // after the old pass-1 fahre and the STOP's halte
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).code, 200);   // the page's PLAY on a running loop: STOP, then POST /spur
  assert.deepEqual(bass.slice(von - 1, von + 2).map((z) => z.befehl), ['halte', 'halte', 'fahre'], 'STOP halte, compensating halte, new fahre');
  await warte(800);
  assert.deepEqual(bass.slice(von + 2).filter((z) => z.befehl === 'halte'), [], 'nothing halts the new run');
  assert.equal((await liste(url)).length, 1, 'the new loop is running');
  assert.equal((await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER)).code, 200);
  assert.equal(log.filter((z) => z.typ === 'spur_wirt_fehler').length, 0);
});

// Review rest 1 (b): the wirt implements the real replace rule (host_control.py: a fahre keeps ramps with t0 < ab, drops those with t0 >= ab;
// halte drops every ramp of that spur). The old pass starts before the new run's pass 0, so only the halte can remove the old ramp.
test('S7 loop review rest 1 (b): old fahre ab < new ab: after the sequence no ramp of the old run is left', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { url } = await stapel(t, { wirtOrdner: wo });
  const rampen = [];
  let nFahre = 0, altAb = null, neuAb = null;
  const bass = await fakeWirt(t, wo, 'bass', async (z) => {
    if (z.befehl === 'fahre') {
      const nr = nFahre++;
      if (nr === 1) { altAb = z.ab; await warte(2800); }   // the wirt is busy: it takes the old fahre late
      if (nr === 2) neuAb = z.ab;
      for (let i = rampen.length - 1; i >= 0; i--) if (rampen[i].t0 >= z.ab) rampen.splice(i, 1);
      rampen.push({ t0: z.ab, spur: z.spur });
    } else if (z.befehl === 'halte') {
      for (let i = rampen.length - 1; i >= 0; i--) if (rampen[i].spur === z.spur) rampen.splice(i, 1);
    }
    return { ok: true };
  });
  const spur = { name: 'cut', schleife_takte: 1, fahrten: [{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] };
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).code, 200);
  await bis(() => bass.filter((z) => z.befehl === 'fahre').length >= 2);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER)).code, 200);
  await warte(1500);   // the new run's anker lies behind the old pass 1
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).code, 200);
  await warte(3500);   // the old fahre is taken by the wirt (late) in this time
  assert.ok(altAb !== null && neuAb !== null && altAb < neuAb, `precondition: old ab ${altAb} < new ab ${neuAb}`);
  assert.ok(rampen.some((r) => r.t0 === neuAb), 'the new run\'s ramp is there');
  assert.equal(rampen.filter((r) => r.t0 === altAb).length, 0, `a ramp of the old run is left: ${JSON.stringify(rampen)}`);
  assert.ok(bass.length > 0);
  await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER);
});

// Review rest 1, negative control: a new PLAY with no old run in flight starts at once
test('S7 loop review rest 1 control: PLAY after a clean STOP is not delayed', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { url } = await stapel(t, { wirtOrdner: wo });
  await fakeWirt(t, wo, 'bass');
  const spur = { name: 'cut', schleife_takte: 1, fahrten: [{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] };
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER)).code, 200);
  const t0 = Date.now();
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).code, 200);
  const ms = Date.now() - t0;
  console.log(`# PLAY without flight took ${ms} ms`);
  assert.ok(ms < 300, `PLAY took ${ms} ms`);
  await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER);
});

// Review rest 1, negative control: without a new run the late halte still comes (the existing STOP test also pins it)
test('S7 loop review rest 1 control: STOP without a new PLAY: the late fahre is still held', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { url } = await stapel(t, { wirtOrdner: wo });
  let nFahre = 0;
  const bass = await fakeWirt(t, wo, 'bass', async (z) => { if (z.befehl === 'fahre' && nFahre++ === 1) await warte(1500); return { ok: true }; });
  const spur = { name: 'cut', schleife_takte: 1, fahrten: [{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] };
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).code, 200);
  await bis(() => bass.filter((z) => z.befehl === 'fahre').length >= 2);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER)).code, 200);
  const n = bass.length;
  await bis(() => bass.length > n, 3000);
  assert.equal(bass.at(-1).befehl, 'halte', 'the late fahre is held again');
});

// Review rest 2: the skip guard after the wirt awaits. The wirt answers pass 1 after 1.2 s (> 2 beats at 128 BPM = 0.94 s lead plus the
// pass start), so the start of the pass has passed when the core parts would go out.
test('S7 loop review rest 2: a wirt answering after the start of the pass: its core parts are skipped and logged', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { url, log } = await stapel(t, { wirtOrdner: wo });
  let nFahre = 0;
  await fakeWirt(t, wo, 'bass', async (z) => { if (z.befehl === 'fahre' && nFahre++ === 1) await warte(2000); return { ok: true }; });
  const spur = { name: 'cut', schleife_takte: 1, fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 },
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] };
  const r = await postJson(url, '/spur', { spur }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const pass1 = r.j.anker_beat + 4;
  await bis(() => log.some((z) => z.typ === 'spur_schleife_uebersprungen'), 8000);
  const u = log.find((z) => z.typ === 'spur_schleife_uebersprungen');
  assert.ok(u, 'skipped pass is logged');
  assert.equal(u.ab_beat, pass1);
  assert.ok(u.beat >= pass1, `the wirt answered after the start (beat ${u.beat} vs ${pass1})`);
  await bis(() => teileVon(log, 'cut').some((z) => z.felder.ab_beat > pass1), 8000);   // the loop goes on with pass 2
  const teile = teileVon(log, 'cut');
  assert.equal(teile.filter((z) => z.felder.ab_beat === pass1).length, 0, 'no core part of the skipped pass');
  for (const z of teile) assert.ok(z._beat < z.felder.ab_beat, `part ab_beat ${z.felder.ab_beat} sent at beat ${z._beat}`);
  await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER);
});

test('S7 loop T12.3 AK31 (1): a wirt error in a later pass ends the loop with a log entry', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { url, log } = await stapel(t, { wirtOrdner: wo });
  let n = 0;
  await fakeWirt(t, wo, 'bass', (z) => (z.befehl === 'fahre' && ++n === 2 ? { ok: false, fehler: 'kaputt' } : { ok: true }));
  const spur = { name: 'cut2', schleife_takte: 1, fahrten: [{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] };
  assert.equal((await postJson(url, '/spur', { spur })).code, 200);
  const z = await bis(() => log.find((x) => x.typ === 'spur_schleife_ende' && x.name === 'cut2'));
  assert.ok(z, 'no spur_schleife_ende');
  assert.equal(z.grund, 'wirt'); assert.equal(z.text, 'kaputt');
  assert.deepEqual(await liste(url), []);
  assert.ok(log.some((x) => x.typ === 'an_kern' && x.adresse === '/k/abbruch' && x.felder.plan === 'spur:cut2'));
});

test('S7 loop T12.3 AK31 (2): core clock away 3 s, after its return no part starts in the past (missed passes skipped)', async (t) => {
  const { o, url, log } = await stapel(t);
  const r = await postJson(url, '/spur', { spur: fader('weg') });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  await bis(() => teileVon(log, 'weg').length >= 4);
  // the server sees a frozen clock for 3 s (no /uhr reaches it); afterwards the real one again, about 6.4 beats later
  const echt = Object.getOwnPropertyDescriptor(o.kern, 'uhr');
  const fest = o.kern.uhr;
  let neu = fest;
  Object.defineProperty(o.kern, 'uhr', { configurable: true, get: () => fest, set: (v) => { neu = v; } });
  const vorher = teileVon(log, 'weg').length;
  await warte(3000);
  Object.defineProperty(o.kern, 'uhr', echt);
  o.kern.uhr = neu;
  const zurueck = Date.now();
  await bis(() => teileVon(log, 'weg').length >= vorher + 4);
  const nach = teileVon(log, 'weg').slice(vorher);
  assert.ok(nach.length >= 4, `only ${nach.length} parts after the return`);
  for (const z of nach) assert.ok(z._beat < z.felder.ab_beat, `part ${z.felder.teil} sent at beat ${z._beat} for ${z.felder.ab_beat}`);
  const starts = [...new Set(teileVon(log, 'weg').map((z) => z.felder.ab_beat))];
  assert.ok(starts.every((b) => (b - r.j.anker_beat) % 4 === 0), `starts off the grid: ${starts}`);
  assert.ok(log.some((x) => x.typ === 'spur_schleife_uebersprungen' && x.name === 'weg'), 'the skip is logged');
  assert.ok(Date.now() - zurueck < 15000);
  await postJson(url, '/spur/stopp', { name: 'weg' });
});

test('S7 loop T12.3 MAJOR 3: D8 for Cypher\'s loop at the start covers the seam (a fade-out reopened by the next pass)', async (t) => {
  const { o, url, log } = await stapel(t);
  for (const [pfad, wert] of [['deck/1/fader', 0], ['deck/1/trim', 0]]) o.vomKern({ adresse: '/e/regler', felder: { pfad, wert, halter: 'frei', sample: 0, beat: 0 } });
  const aus = { name: 'aus', schleife_takte: 1, fahrten: [{ ziel: 'deck/1/fader', ab_takt: 1, nach: 0 }, { ziel: 'deck/1/fader', ab_takt: 1, takte: 1, nach: -40 }] };
  const x = await postJson(url, '/spur', { spur: aus }, CYPHER);
  assert.equal(x.code, 409, JSON.stringify(x.j)); assert.equal(x.j.fehler, 'kein_hoerschein');
  assert.equal(teileVon(log, 'aus').length, 0, 'nothing went to the core');
  // negative controls: the same lines once (no seam) for Cypher, and the loop for Andreas
  const { schleife_takte, ...einmal } = aus;
  assert.equal(schleife_takte, 1);
  assert.equal((await postJson(url, '/spur', { spur: einmal }, CYPHER)).code, 200);
  await postJson(url, '/spur/stopp', { name: 'aus' }, CYPHER);
  assert.equal((await postJson(url, '/spur', { spur: aus })).code, 200);
  await postJson(url, '/spur/stopp', { name: 'aus' });
});

test('S7 loop T12.3: a loop is never cleaned up as expired (the end of its last sent pass lies far behind the core beat)', async (t) => {
  const { o, url } = await stapel(t);
  assert.equal((await postJson(url, '/spur', { spur: fader('lang') })).code, 200);
  const s = o.spuren.get('lang').schleife;
  // the clock jumps 100 bars ahead, half a beat after a pass start: the next start is 3.5 beats away, outside the 2-beat lead, so no pass
  // is sent before the list is read and the end of the last sent pass stays far behind
  const echt = Object.getOwnPropertyDescriptor(o.kern, 'uhr');
  const u = { ...o.kern.uhr, beat: s.anker_naechster + 400 + 0.5 };
  Object.defineProperty(o.kern, 'uhr', { configurable: true, get: () => u, set: () => {} });
  t.after(() => Object.defineProperty(o.kern, 'uhr', echt));
  assert.deepEqual((await liste(url)).map((x) => x.name), ['lang']);
  assert.ok(o.spuren.get('lang').ende + 1 < u.beat, 'the end lies behind the beat (the case under test)');
  // negative control: a track without schleife_takte with the same end is cleaned up
  assert.equal((await postJson(url, '/spur', { spur: { name: 'einmal', fahrten: [{ ziel: 'erz/3/filter', ab_takt: 1, takte: 1, nach: -0.6 }] } })).code, 200);
  o.spuren.get('einmal').ende = o.spuren.get('lang').ende;
  assert.deepEqual((await liste(url)).map((x) => x.name), ['lang']);
});

test('S7 loop T12.3 AK31 (3): a hand grip on a target ends Cypher\'s loop; another path or Andreas\' loop is untouched', async (t) => {
  const { o, url, log } = await stapel(t);
  assert.equal((await postJson(url, '/spur', { spur: fader('c2') }, CYPHER)).code, 200);
  const andreas = { ...fader('a3'), fahrten: fader('a3').fahrten.map((f) => ({ ...f, ziel: 'erz/3/fader' })) };
  assert.equal((await postJson(url, '/spur', { spur: andreas })).code, 200);
  const griff = (pfad) => o.vomKern({ adresse: '/e/halter', felder: { pfad, halter: 'mensch', sample: 0, beat: o.kern.uhr.beat } });
  griff('erz/1/fader');   // negative control: a path no loop moves
  griff('erz/2/fader');
  griff('erz/3/fader');   // Andreas' own loop: his hand on his own lane does not end it
  await bis(() => log.some((x) => x.typ === 'spur_schleife_ende'));
  assert.deepEqual((await liste(url)).map((x) => x.name), ['a3']);
  const z = log.find((x) => x.typ === 'spur_schleife_ende');
  assert.deepEqual([z.name, z.grund, z.pfad], ['c2', 'hand', 'erz/2/fader']);
  await postJson(url, '/spur/stopp', { name: 'a3' });
});

test('S7 loop T12.3 AK31 (3): AUTO off ends Cypher\'s loop at the next pass; Andreas\' loop on the same stream keeps running', async (t) => {
  const { url, log } = await stapel(t);
  assert.equal((await postJson(url, '/spur', { spur: fader('c2') }, CYPHER)).code, 200);
  const andreas = { ...fader('a2'), fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 }] };
  assert.equal((await postJson(url, '/spur', { spur: andreas })).code, 200);
  await bis(() => teileVon(log, 'c2').length >= 4);
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const z = await bis(() => log.find((x) => x.typ === 'spur_schleife_ende' && x.name === 'c2'), 6000);
  assert.ok(z, 'Cypher\'s loop did not end');
  assert.equal(z.grund, 'auto_aus'); assert.equal(z.strom, 2);
  const n = teileVon(log, 'a2').length;
  await bis(() => teileVon(log, 'a2').length > n, 5000);
  assert.ok(teileVon(log, 'a2').length > n, 'Andreas\' loop goes on');
  assert.deepEqual((await liste(url)).map((x) => x.name), ['a2']);
  await postJson(url, '/spur/stopp', { name: 'a2' });
});

test('S7 loop T12.3 MINOR 6: ids/teile keep the last two passes, spuren.json is written at most once per pass', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { o, url, log } = await stapel(t, { wirtOrdner: wo });
  assert.equal((await postJson(url, '/spur', { spur: fader('band-2-fader') })).code, 200);
  await bis(() => teileVon(log, 'band-2-fader').length >= 2 * 2);
  let geschrieben = 0;
  const sichern = o.spurenSichern.bind(o);
  o.spurenSichern = () => { geschrieben++; sichern(); };
  const p0 = teileVon(log, 'band-2-fader').length / 2;
  await bis(() => teileVon(log, 'band-2-fader').length >= 2 * (p0 + 3));
  const passes = teileVon(log, 'band-2-fader').length / 2 - p0;
  assert.ok(geschrieben <= passes, `${geschrieben} writes for ${passes} passes`);
  const dat = JSON.parse(fs.readFileSync(path.join(wo, 'spuren.json'), 'utf8'));
  const e = dat.find((x) => x.name === 'band-2-fader');
  assert.ok(e.teile.length <= 4 && e.ids.length <= 4, `teile ${e.teile.length}, ids ${e.ids.length}`);
  assert.equal(e.schleife.anker_naechster - e.schleife.durchlaeufe.at(-1).ende, 0, 'one field name: anker_naechster');
  await postJson(url, '/spur/stopp', { name: 'band-2-fader' });
});

test('S7 loop T12.4: a restart of the page server resumes from the next unsent pass, no ab_beat twice (MINOR 7)', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { o, url, log } = await stapel(t, { wirtOrdner: wo });
  const r = await postJson(url, '/spur', { spur: fader('band-2-fader') });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  await bis(() => teileVon(log, 'band-2-fader').length >= 4);
  const vorher = teileVon(log, 'band-2-fader').map((z) => [z.felder.ab_beat, z.felder.teil]);
  // down for 3 s (6.4 beats): longer than one pass + 1 beat, so the end of the last sent pass lies in the past at the restart
  const { log: log2 } = await neustart(t, o, 3000);
  assert.deepEqual((await liste(url)).map((x) => x.name), ['band-2-fader'], 'a loop is never cleaned up as expired');
  await bis(() => teileVon(log2, 'band-2-fader').length >= 4);
  const nachher = teileVon(log2, 'band-2-fader').map((z) => [z.felder.ab_beat, z.felder.teil]);
  assert.ok(nachher.length >= 4, `only ${nachher.length} parts after the restart`);
  const alle = [...vorher, ...nachher];
  const paare = alle.map(([b, k]) => `${b}:${k}`);
  assert.equal(new Set(alle.map(([, k]) => k)).size, alle.length, `a part number twice: ${paare}`);
  const jeBeat = {};
  for (const [b] of alle) jeBeat[b] = (jeBeat[b] ?? 0) + 1;
  assert.ok(Object.values(jeBeat).every((x) => x === 2), `an ab_beat twice (two parts per pass): ${JSON.stringify(jeBeat)}`);
  assert.ok(nachher[0][0] > vorher.at(-1)[0], 'resumes after the last sent pass');
  assert.ok(log2.some((x) => x.typ === 'spur_schleife_uebersprungen'), 'the passes missed while down are skipped');
  assert.ok(teileVon(log2, 'band-2-fader').every((z) => z._beat < z.felder.ab_beat), 'nothing in the past after the restart');
  const [s] = await liste(url);
  assert.equal(s.schleife_takte, 1);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'band-2-fader' })).code, 200);
});

// ---- U13: a change applies from the next pass (S8 plan tasks 6 to 8, MAJOR 3 ownership) ----

test('S7 loop T13.1 AK32: /spur/aendern applies from the next unplanned pass, exactly at the announced ab_beat; error cases', async (t) => {
  const { url, log } = await stapel(t);
  const alt = fader('band-2-fader', 1, -30), neu = fader('band-2-fader', 1, -10);
  const r = await postJson(url, '/spur', { spur: alt });
  assert.equal(r.code, 200);
  const a = await postJson(url, '/spur/aendern', { name: 'band-2-fader', spur: neu });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.ok(a.j.ab_beat > r.j.anker_beat); assert.equal(a.j.ab_takt, Math.floor(a.j.ab_beat / 4) + 1);
  assert.equal(a.j.uebernaechster, false);
  assert.equal((await liste(url))[0].naechste, true, 'GET /spur shows the waiting change');
  await bis(() => teileVon(log, 'band-2-fader').some((z) => z.felder.nach === -10));
  const erst = teileVon(log, 'band-2-fader').find((z) => z.felder.nach === -10);
  assert.ok(erst, 'the change was never planned');
  assert.equal(erst.felder.ab_beat, a.j.ab_beat, 'it applies exactly from the announced pass');
  assert.ok(teileVon(log, 'band-2-fader').filter((z) => z.felder.ab_beat < a.j.ab_beat).every((z) => z.felder.nach !== -10), 'before it the old line');
  assert.equal((await liste(url))[0].naechste, false, 'once planned, the change is taken over');
  // error cases
  assert.equal((await postJson(url, '/spur/aendern', { name: 'gibtsnicht', spur: { ...neu, name: 'gibtsnicht' } })).code, 404);
  assert.equal((await postJson(url, '/spur/aendern', { name: 'band-2-fader', spur: { ...neu, schleife_takte: 0 } })).code, 400);
  const ohne = await postJson(url, '/spur/aendern', { name: 'band-2-fader', spur: { name: 'band-2-fader', fahrten: neu.fahrten } });
  assert.equal(ohne.code, 400, 'a change of a loop stays a loop'); assert.match(ohne.j.text, /schleife_takte/);
  assert.equal((await postJson(url, '/spur/aendern', { name: 'band-2-fader', spur: { ...neu, name: 'andere' } })).code, 400, 'the name is the loop\'s');
  assert.equal((await postJson(url, '/spur/aendern', { name: '../x', spur: neu })).code, 400);
  await postJson(url, '/spur', { spur: { name: 'einmal', fahrten: neu.fahrten.map((f) => ({ ...f, ziel: 'erz/3/fader' })) } });
  const e = await postJson(url, '/spur/aendern', { name: 'einmal', spur: { name: 'einmal', schleife_takte: 1, fahrten: neu.fahrten } });
  assert.equal(e.code, 409); assert.equal(e.j.fehler, 'keine_schleife');
  await postJson(url, '/spur/stopp', { name: 'band-2-fader' });
});

test('S7 loop T13.1 AK32: a change during the sending of the next pass applies from the pass after, and the answer says so', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { o, url, log } = await stapel(t, { wirtOrdner: wo });
  let halten = false;
  const bass = await fakeWirt(t, wo, 'bass', async (z) => { if (z.befehl === 'fahre' && halten) await warte(500); return { ok: true }; });
  const mk = (nach) => ({ name: 'cut', schleife_takte: 1, fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach },
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] });
  const r = await postJson(url, '/spur', { spur: mk(-0.6) });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  halten = true;
  const n = bass.length;
  await bis(() => bass.length > n);   // the watcher waits for the wirt: the next pass is being sent
  const imFlug = o.spuren.get('cut').schleife.anker_naechster;
  const a = await postJson(url, '/spur/aendern', { name: 'cut', spur: mk(-0.2) });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.uebernaechster, true);
  assert.equal(a.j.ab_beat, imFlug + 4, 'the pass after the one in flight');
  halten = false;
  await bis(() => teileVon(log, 'cut').some((z) => z.felder.nach === -0.2));
  const erst = teileVon(log, 'cut').find((z) => z.felder.nach === -0.2);
  assert.equal(erst?.felder.ab_beat, a.j.ab_beat);
  assert.equal(teileVon(log, 'cut').find((z) => z.felder.ab_beat === imFlug)?.felder.nach, -0.6, 'the pass in flight keeps the old line');
  // negative control: a change while nothing is in flight applies from the next pass (uebernaechster false)
  await bis(() => !o.spuren.get('cut').planend);
  const b = await postJson(url, '/spur/aendern', { name: 'cut', spur: mk(-0.4) });
  assert.equal(b.j.uebernaechster, false); assert.equal(b.j.ab_beat, o.spuren.get('cut').schleife.anker_naechster);
  await postJson(url, '/spur/stopp', { name: 'cut' });
});

test('S7 loop T13.1: a change may change the length; later passes follow the new n', async (t) => {
  const { url, log } = await stapel(t);
  const r = await postJson(url, '/spur', { spur: fader('band-2-fader', 1, -30) });
  assert.equal(r.code, 200);
  const a = await postJson(url, '/spur/aendern', { name: 'band-2-fader', spur: fader('band-2-fader', 2, -20) });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  await bis(() => teileVon(log, 'band-2-fader').filter((z) => z.felder.ab_beat >= a.j.ab_beat).length >= 4, 20000);
  const starts = [...new Set(teileVon(log, 'band-2-fader').map((z) => z.felder.ab_beat))].filter((b) => b >= a.j.ab_beat);
  assert.deepEqual(starts.slice(0, 2).map((b) => b - a.j.ab_beat), [0, 8], 'two-bar passes from the change on');
  const [l] = await liste(url);
  if (l.anker_beat >= a.j.ab_beat) assert.equal(l.schleife_takte, 2, 'GET /spur names the length of the running pass');
  await postJson(url, '/spur/stopp', { name: 'band-2-fader' });
});

test('S7 loop T13.2 MAJOR 3: only the owner changes a loop; Cypher\'s change obeys Stop Cypher, AUTO and D8', async (t) => {
  const { o, url, log } = await stapel(t);
  assert.equal((await postJson(url, '/spur', { spur: fader('a2') })).code, 200);
  assert.equal((await postJson(url, '/spur', { spur: { ...fader('c3'), fahrten: fader('c3').fahrten.map((f) => ({ ...f, ziel: 'erz/3/fader' })) } }, CYPHER)).code, 200);
  const c3 = (nach) => ({ ...fader('c3', 1, nach), fahrten: fader('c3', 1, nach).fahrten.map((f) => ({ ...f, ziel: 'erz/3/fader' })) });
  let x = await postJson(url, '/spur/aendern', { name: 'a2', spur: fader('a2', 1, -10) }, CYPHER);
  assert.equal(x.code, 403); assert.equal(x.j.fehler, 'nur_andreas');
  x = await postJson(url, '/spur/aendern', { name: 'c3', spur: c3(-10) });
  assert.equal(x.code, 403); assert.equal(x.j.fehler, 'nur_cypher');
  // negative controls: each owner changes his own loop
  assert.equal((await postJson(url, '/spur/aendern', { name: 'a2', spur: fader('a2', 1, -10) })).code, 200);
  assert.equal((await postJson(url, '/spur/aendern', { name: 'c3', spur: c3(-12) }, CYPHER)).code, 200);
  // AUTO off on stream 3: Cypher's change is refused like a start
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 3 })).code, 200);
  x = await postJson(url, '/spur/aendern', { name: 'c3', spur: c3(-14) }, CYPHER);
  // (if the watcher planned a pass in the few ms between the two requests, it ended the loop for the same reason: also correct)
  const geendet = log.some((z) => z.typ === 'spur_schleife_ende' && z.name === 'c3' && z.grund === 'auto_aus');
  assert.ok((x.code === 409 && x.j.fehler === 'auto_aus') || (x.code === 404 && geendet), JSON.stringify(x));
  assert.equal((await postJson(url, '/strudel/autonom', { an: true, strom: 3 })).code, 200);
  if (geendet) assert.equal((await postJson(url, '/spur', { spur: c3(-12) }, CYPHER)).code, 200);
  // D8: a change of Cypher's deck loop that reopens a closed channel at the seam
  for (const [pfad, wert] of [['deck/1/fader', 0], ['deck/1/trim', 0]]) o.vomKern({ adresse: '/e/regler', felder: { pfad, wert, halter: 'frei', sample: 0, beat: 0 } });
  const deck = (nach) => ({ name: 'd1', schleife_takte: 1, fahrten: [{ ziel: 'deck/1/fader', ab_takt: 1, nach: 0 }, { ziel: 'deck/1/fader', ab_takt: 1, takte: 1, nach }] });
  assert.equal((await postJson(url, '/spur', { spur: deck(-10) }, CYPHER)).code, 200);
  x = await postJson(url, '/spur/aendern', { name: 'd1', spur: deck(-40) }, CYPHER);
  assert.equal(x.code, 409); assert.equal(x.j.fehler, 'kein_hoerschein');
  // Stop Cypher (through the core, as Andreas presses it): Cypher's loops end, a change of his is refused with ki_gestoppt
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });
  await bis(() => o.kiGestoppt, 3000);
  x = await postJson(url, '/spur/aendern', { name: 'c3', spur: c3(-16) }, CYPHER);
  assert.ok(x.code === 409 && x.j.fehler === 'ki_gestoppt', JSON.stringify(x));
  assert.deepEqual((await liste(url)).map((l) => l.name), ['a2'], 'Stop Cypher ended Cypher\'s loops, Andreas\' stays');
  await postJson(url, '/spur/stopp', { name: 'a2' });
});

test('S7 loop T13.1: a loop with a waiting change survives a restart of the page server; the change arrives, numbers continue', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { o, url, log } = await stapel(t, { wirtOrdner: wo });
  const r = await postJson(url, '/spur', { spur: fader('band-2-fader', 4, -30) });   // 16 beats per pass: time for the restart
  assert.equal(r.code, 200);
  const a = await postJson(url, '/spur/aendern', { name: 'band-2-fader', spur: fader('band-2-fader', 4, -10) });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const vorher = teileVon(log, 'band-2-fader').map((z) => z.felder.teil);
  const { log: log2 } = await neustart(t, o);
  assert.equal((await liste(url))[0].naechste, true, 'the waiting change survives (spuren.json)');
  await bis(() => teileVon(log2, 'band-2-fader').some((z) => z.felder.nach === -10), 20000);
  const erst = teileVon(log2, 'band-2-fader').find((z) => z.felder.nach === -10);
  assert.equal(erst?.felder.ab_beat, a.j.ab_beat);
  const nr = [...vorher, ...teileVon(log2, 'band-2-fader').map((z) => z.felder.teil)];
  assert.equal(new Set(nr).size, nr.length, `a part number twice: ${nr}`);
  await postJson(url, '/spur/stopp', { name: 'band-2-fader' });
});

// Adversarial review (timing) 1: STOP while POST /spur still waits for the wirt answer of pass 0. The STOP deletes the run before the
// group is recorded, so its halte misses the wirt; the late fahre must be held and no core part may follow the /k/abbruch.
test('S7 loop review timing 1: STOP during the pass-0 wirt await of POST /spur: no core part after the abort, the late fahre is held', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'w-'));
  const { url, log } = await stapel(t, { wirtOrdner: wo });
  let nFahre = 0;
  const bass = await fakeWirt(t, wo, 'bass', async (z) => { if (z.befehl === 'fahre' && nFahre++ === 0) await warte(800); return { ok: true }; });
  const spur = { name: 'cut', schleife_takte: 1, fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 },
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0, von: -40 }] };
  const play = postJson(url, '/spur', { spur }, CYPHER);
  await bis(() => bass.some((z) => z.befehl === 'fahre'));
  assert.equal((await postJson(url, '/spur/stopp', { name: 'cut' }, CYPHER)).code, 200);
  const p = await play;
  await warte(1500);
  const abbruch = log.findIndex((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch');
  assert.ok(abbruch >= 0, 'the STOP aborted in the core');
  const spaet = log.slice(abbruch).filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && z.felder.plan === 'spur:cut');
  assert.equal(spaet.length, 0, `core parts after the STOP: ${spaet.length}`);
  assert.equal(bass.at(-1).befehl, 'halte', `the late fahre is held: ${bass.map((z) => z.befehl)}`);
  assert.notEqual(p.code, 200, `PLAY answered ${p.code} ${JSON.stringify(p.j)} although it was stopped`);
  assert.deepEqual(await liste(url), []);
});
