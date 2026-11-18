// Card t_7f487235: what the restore plan after a kern restart is made of (FX type of units 1/2, FX assignments 1-3, the loop boxes with their owners and live
// grid offset, the graphs with their owners) lived only in memory. A restart of the page server dropped it. It now lives in neustart_stand.json next to
// aktive_loops.json (hotcue folder, atomic write) and is read again on start. Servers are built in-process, never started (no port bound); kern.sende is a
// recorder, the kern's words come in through vomKern. The hotcue folder of every test is its own temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { K, TEST_INSTANZ } from './support/instance.mjs';

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function umgebung(t) {
  const alt = process.env.CYPHERDJ_INSTANZ, altBk = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const bk = tmp('ns-bk-');   // the graph library: one effect graph
  fs.writeFileSync(path.join(bk, 'eff.json'), JSON.stringify({ format: 'baukasten/2', name: 'eff', stimmen: 1, regler_namen: { 1: 'Mix' },
    knoten: [{ id: 'e', art: 'eingang' }, { id: 'o', art: 'ausgang' }, { id: 'k1', art: 'regler', nr: 1, min: 0, max: 1, vorgabe: 0.35 }], kanten: [] }));
  fs.mkdirSync(path.join(bk, 'samples'));
  process.env.CYPHERDJ_BK_ORDNER = bk;
  const loops = tmp('ns-loops-'), hotcues = tmp('ns-hc-'), muster = tmp('ns-muster-');
  fs.mkdirSync(path.join(loops, 'x'));
  fs.writeFileSync(path.join(loops, 'x', 'loop.json'), JSON.stringify({ schema: 1, name: 'x', beats: 4, bpm: 128, frames: 90000, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-17 10:00' }));
  fs.writeFileSync(path.join(loops, 'x', 'loop.f32'), Buffer.alloc(90000 * 8));
  fs.writeFileSync(path.join(muster, 'fx_von.json'), JSON.stringify({ 1: { von: 'andreas', zeit: 1 }, 3: { von: 'andreas', zeit: 1 } }));   // who set the FX units (already on disk)
  const alle = [];
  t.after(() => {
    for (const o of alle) { for (const z of ['offenerPlanTimer', 'wiederTimer', 'planTimer']) if (o[z]) clearTimeout(o[z]); try { o.kern.sock.close(); } catch { /* never bound */ } }
    if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt;
    if (altBk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = altBk;
  });
  const neu = (extra = {}) => {
    const log = [];
    const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('ns-bestand-'), arbeitsbestand: tmp('ns-ab-'),
      mutationen: [], loops, kits: tmp('ns-kits-'), welleCache: tmp('ns-welle-'), musterOrdner: muster, hotcueOrdner: hotcues,
      rasterOrdner: tmp('ns-raster-'), huellen: path.join(tmp('ns-huellen-'), 'huellen'), wirtOrdner: tmp('ns-wirt-'), sammlungen: tmp('ns-sets-'),
      musterBibliothek: tmp('ns-mb-'), musterSets: tmp('ns-ms-'), mediathek: path.join(tmp('ns-med-'), 'nix.sqlite'), katalog: path.join(tmp('ns-kat-'), 'nix.sqlite'),
      digitalout: path.join(tmp('ns-do-'), 'nix'), kernPruefmodus: true, log: (z) => log.push(z), ...extra });
    const gesendet = [];
    o.kern.sende = (adresse, felder) => { gesendet.push({ adresse, felder }); };
    alle.push(o);
    return { o, log, gesendet };
  };
  return { neu, hotcues, muster, datei: path.join(hotcues, 'neustart_stand.json') };
}
const willkommen = (o, generation, sample = 1000) => o.vomKern({ adresse: '/k/willkommen', felder: { generation, sample } });   // sample: the kern's sample position of the greeting
const neustart = (o, generation, sample = 1000) => o.vomKern({ adresse: '/e/neustart', felder: { generation, sample } });
const plan = (gesendet) => gesendet.filter((s) => /^\/(k\/(fx|loop|kanal\/graph)|erz\/strom)/.test(s.adresse));   // what a restore sends (the session sends its own words on first contact)
const FX1 = { einheit: 1, art: 2, beats: 1, wet: 0.5, param1: 0.1, param2: 0.2, param3: 0.3, an: 1 };
// the page server of the first run: one kern generation, FX 1 with two assignments, FX 3 with one, box 1 playing loop x (owner andreas, live offset), graph eff on master
async function ersterLauf(u, generation = 3, sample = 1000) {
  const e = u.neu();
  willkommen(e.o, generation, sample);
  e.o.vomKern({ adresse: '/e/fx', felder: FX1 });
  e.o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 1 } });
  e.o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/2', an: 1 } });
  e.o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 3, kanal: 'deck/3', an: 1 } });
  e.o.loopLadung['1'] = { name: 'x', quelle: 'andreas' };
  e.o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'x', beats: 4, fx_art: 0, fx_beats: 1, fx_wet: 0 } });
  e.o.loopRasterLive['1'] = { name: 'x', v: 480 };
  e.o.vomKern({ adresse: '/e/graph', felder: { kanal: 'master', name: 'eff' } });
  e.o.graphBesitzer.master = 'andreas';
  e.o.merkeNeustartStand();
  await warte(450);   // the write is coalesced
  return e;
}

test('the stand is written next to aktive_loops.json: FX units, assignments, loop boxes, owners, graphs, generation', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u);
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  assert.equal(j.generation, 3);
  assert.equal(j.fx[0].art, 2);
  assert.deepEqual(j.fxZuweisung, [{ 'deck/1': true, 'deck/2': true }, {}, { 'deck/3': true }]);
  assert.equal(j.loops['1'].name, 'x');
  assert.deepEqual(j.loopBesitzer, { 1: 'andreas' });
  assert.deepEqual(j.loopRasterLive, { 1: { name: 'x', v: 480 } });
  assert.deepEqual(j.graphBesitzer, { master: 'andreas' });
  assert.deepEqual(j.graphen_geladen, { master: 'eff' });
  assert.deepEqual(fs.readdirSync(u.hotcues).filter((n) => n.endsWith('.neu')), [], 'atomic: no temp file left');
});

test('page restart AND kern restart: the new page server restores FX, assignments, box and graph of the old kern into the new one', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const { o, log, gesendet } = u.neu();   // the page server that comes up again; the kern came up as generation 4 meanwhile
  o.ladeNeustartStand();
  willkommen(o, 4, 1_000_000 + 48000);   // the real order: /k/willkommen with the present sample, /e/neustart with the first sample of the generation
  neustart(o, 4, 1_000_000);
  await warte(800);
  const an = (a) => gesendet.filter((s) => s.adresse === a).map((s) => s.felder);
  assert.deepEqual(an('/k/fx').map((f) => [f.einheit, f.art, f.quelle]), [[1, 2, 'andreas']], 'FX 1 comes back with its type');
  assert.deepEqual(an('/k/fx/zuweisung').map((f) => [f.einheit, f.kanal]).sort(), [[1, 'deck/1'], [1, 'deck/2'], [3, 'deck/3']]);
  assert.deepEqual(an('/k/loop/laden').map((f) => [f.box, f.name, f.quelle]), [[1, 'x', 'andreas']]);
  assert.deepEqual(an('/k/loop/start').map((f) => f.box), [1]);
  assert.deepEqual(an('/k/loop/raster').map((f) => [f.box, f.versatz_frames]), [[1, 480]]);
  assert.deepEqual(an('/k/kanal/graph').map((f) => [f.kanal, f.name, f.quelle]), [['master', 'eff', 'andreas']]);
  assert.ok(log.some((z) => z.typ === 'wiederherstellung'));
});

test('page restart with the same kern: the stand comes back, nothing is sent to the kern', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const { o, gesendet } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 3);
  neustart(o, 3);   // the kern announces itself to a new subscriber in the same generation
  await warte(800);
  assert.deepEqual(plan(gesendet), [], 'a kern that kept its state gets nothing again');
  assert.equal(o.stand.fx[0].art, 2);
  assert.deepEqual(o.stand.fxZuweisung[0], { 'deck/1': true, 'deck/2': true });
  assert.equal(o.stand.loops['1'].name, 'x');
  assert.equal(o.loopBesitzer['1'], 'andreas');
  assert.equal(o.graphBesitzer.master, 'andreas');
  assert.equal(o.stand.graphen_geladen.master, 'eff');
  assert.deepEqual(o.loopRasterLive['1'], { name: 'x', v: 480 });
});

test('page restart with the same kern, /e/neustart arrives before /k/willkommen: still nothing is sent', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const { o, gesendet } = u.neu();
  o.ladeNeustartStand();
  neustart(o, 3);
  willkommen(o, 3);
  await warte(800);
  assert.deepEqual(plan(gesendet), []);
  assert.equal(o.stand.fx[0].art, 2);
});

test('a kern with a smaller generation (brake, no continuation): the old stand is dropped, nothing is restored', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const { o, gesendet } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 0);
  await warte(800);
  assert.deepEqual(plan(gesendet), []);
  assert.equal(o.stand.fx[0], null);
  assert.deepEqual(o.stand.loops, {});
});

test('Stop Cypher still holds Cypher\'s pieces back after a page restart (B12)', async (t) => {
  const u = umgebung(t);
  const e = u.neu();
  willkommen(e.o, 3);
  e.o.loopLadung['1'] = { name: 'x', quelle: 'cypher' };
  e.o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'x', beats: 4, fx_art: 0, fx_beats: 1, fx_wet: 0 } });
  e.o.vomKern({ adresse: '/e/graph', felder: { kanal: 'master', name: 'eff' } });
  e.o.graphBesitzer.master = 'cypher';
  e.o.merkeNeustartStand();
  await warte(450);
  const { o, gesendet, log } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 4);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1, grund: 'test', sample: 0 } });
  neustart(o, 4);
  await warte(800);
  assert.deepEqual(plan(gesendet), []);
  assert.ok(log.some((z) => z.typ === 'box_wieder_ausgelassen' && z.grund === 'ki_gestoppt'));
  assert.ok(log.some((z) => z.typ === 'graph_wieder_ausgelassen' && z.grund === 'ki_gestoppt'));
});

test('a missing, corrupt or wrongly shaped file is an empty stand, never a crash', async (t) => {
  const u = umgebung(t);
  for (const inhalt of [null, '{not json', '[]', '"x"', JSON.stringify({ v: 1, generation: 'x' }), JSON.stringify({ v: 1, generation: 3, fx: 5, fxZuweisung: 'a', loops: [], loopBesitzer: 7, graphBesitzer: { a: 1 } }), JSON.stringify({ v: 9, generation: 3 })]) {
    if (inhalt === null) fs.rmSync(u.datei, { force: true }); else fs.writeFileSync(u.datei, inhalt);
    const { o, gesendet } = u.neu();
    assert.doesNotThrow(() => o.ladeNeustartStand(), String(inhalt));
    willkommen(o, 4);
    neustart(o, 4);
    await warte(600);
    assert.deepEqual(plan(gesendet), [], `nothing to restore from ${inhalt}`);
    assert.equal(o.stand.fx[0], null);
  }
});

test('the guard time keeps the old file until the restore ran, so a crash in between loses nothing', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const { o } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 4, 1_048_000); neustart(o, 4, 1_000_000);   // kern restarted 1 s ago: the plan is made, the stand is cleared, the restore is 500 ms away
  o.merkeNeustartStand();
  await warte(400);
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  assert.equal(j.generation, 3, 'still the stand of the old kern');
  assert.equal(j.fx[0].art, 2);
});

// Blocking review point 1: the same generation number is not the same running kern. A kern without saved state starts at generation 0 again (after every PC
// reboot: its state lives in /dev/shm; the crash brake also starts at 0), but its sample position starts small too. A smaller greeting sample in the same
// generation is another kern life: the file is yesterday's and must not be taken for the present.
test('the same generation from another kern life (smaller greeting sample): the file is dropped, a later kern crash restores nothing of it', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 0, 5_000_000);   // yesterday evening: generation 0, box 1 plays loop x, FX 1, a graph; the kern had run for a long time
  const { o, log, gesendet } = u.neu();   // today: PC rebooted, the kern greets with generation 0 and a small sample position
  o.ladeNeustartStand();
  willkommen(o, 0, 3000);
  neustart(o, 0, 3000);
  await warte(100);
  assert.equal(o.stand.fx[0], null, 'FX 1 of yesterday is not the present');
  assert.deepEqual(o.stand.loops, {}, 'box 1 of yesterday is not the present');
  assert.deepEqual(o.loopBesitzer, {});
  assert.deepEqual(o.graphBesitzer, {});
  assert.ok(log.some((z) => z.typ === 'neustart_stand_verworfen'), 'the drop is logged');
  neustart(o, 1, 4000); willkommen(o, 1, 4000);   // the first kern crash of the day (the kern says /e/neustart first)
  await warte(800);
  assert.deepEqual(plan(gesendet), [], 'nothing of yesterday is loaded or started');
});

test('the same life of the kern (equal or larger greeting sample) keeps the file', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 0, 5_000);
  const { o, gesendet } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 0, 9_000_000); neustart(o, 0, 9_000_000);
  await warte(300);
  assert.equal(o.stand.loops['1'].name, 'x');
  assert.deepEqual(plan(gesendet), []);
});

// Blocking review point 2: a kern restart that came within the guard time waits for its delayed restore. The page server must keep the stand of the wait on
// disk with the current generation and the part of the plan that Andreas did not touch meanwhile, so a page restart inside the wait arms the same delayed,
// filtered restore (the touched marks are gone with the old process) and does not read a lower generation as a kern restart of its own absence.
test('page restart inside the guard time: the stand of the wait is adopted, the delayed restore runs once and leaves what Andreas touched alone', async (t) => {
  const sperre0 = Oberflaeche.BOX_FX_SPERRE_MS;
  Oberflaeche.BOX_FX_SPERRE_MS = 1500;   // the 30 s of production, shortened
  t.after(() => { Oberflaeche.BOX_FX_SPERRE_MS = sperre0; });
  const u = umgebung(t);
  await ersterLauf(u, 3, 1000);
  const p2 = u.neu();
  p2.o.ladeNeustartStand();
  willkommen(p2.o, 4, 2000); neustart(p2.o, 4, 2000);   // restart 1: restored 500 ms later
  await warte(700);
  assert.ok(p2.log.some((z) => z.typ === 'wiederherstellung'), 'restart 1 restored');
  const echo = (o) => {   // the kern answers the restore: box, FX, assignments
    o.loopLadung['1'] = { name: 'x', quelle: 'andreas' };
    o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'x', beats: 4, fx_art: 0, fx_beats: 1, fx_wet: 0 } });
    o.vomKern({ adresse: '/e/fx', felder: FX1 });
    o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 3, kanal: 'deck/3', an: 1 } });
    o.vomKern({ adresse: '/e/graph', felder: { kanal: 'master', name: 'eff' } });
    o.graphBesitzer.master = 'andreas';
  };
  echo(p2.o);
  neustart(p2.o, 5, 3000); willkommen(p2.o, 5, 3000);   // restart 2 inside the guard time: its restore waits
  assert.ok(p2.o.offenerPlanTimer, 'the restore waits for the guard time');
  p2.o.loopLadung['1'] = { name: 'y', quelle: 'andreas' };   // Andreas loads loop y into box 1 and sets FX 1 meanwhile
  p2.o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'y', beats: 4, fx_art: 0, fx_beats: 1, fx_wet: 0 } });
  p2.o.vomKern({ adresse: '/e/fx', felder: { ...FX1, art: 5 } });
  await warte(450);   // the write is coalesced
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  assert.equal(j.generation, 5, 'the file is written during the wait, with the current generation');
  assert.equal(j.loops['1'].name, 'y');
  assert.deepEqual(j.plan.boxen, [], 'the plan in the file lacks the box Andreas touched');
  assert.deepEqual(j.plan.fx, [], 'and the FX unit he touched');
  assert.deepEqual(j.plan.graphen.map((g) => g.kanal), ['master']);
  // the page server restarts inside the wait; the kern is still generation 5
  p2.o.planTimer && clearTimeout(p2.o.planTimer);
  const p3 = u.neu();
  p3.o.ladeNeustartStand();
  willkommen(p3.o, 5, 3500); neustart(p3.o, 5, 3500);
  assert.equal(p3.o.stand.loops['1'].name, 'y', 'what Andreas set is the present');
  assert.equal(p3.o.stand.fx[0].art, 5);
  await warte(200);
  assert.deepEqual(plan(p3.gesendet), [], 'nothing is restored at once');
  await warte(2600);   // the delayed restore of the same plan, once
  const an = (a) => p3.gesendet.filter((s) => s.adresse === a).map((s) => s.felder);
  assert.deepEqual(an('/k/loop/laden'), [], 'box 1 keeps loop y');
  assert.deepEqual(an('/k/fx').filter((f) => f.einheit === 1), [], 'FX 1 keeps its type');
  assert.deepEqual(an('/k/kanal/graph').map((f) => [f.kanal, f.name]), [['master', 'eff']], 'the untouched graph comes back once');
  assert.deepEqual(an('/k/fx/zuweisung').map((f) => [f.einheit, f.kanal]), [[3, 'deck/3']], 'the untouched FX 3 assignment too');
  assert.equal(p3.o.offenerPlanTimer, null);
});

// The core state lives in /dev/shm: neither a PC reboot nor djk-stop leaves a core life behind that a file of before could belong to. The file carries the
// time it was written; one from before the system boot (or without a time) is dropped whatever generation the kern greets with. The boot time is an option
// of the server (systemstartMs) so the test does not depend on the machine.
test('a higher generation, but the file is from before the system boot: nothing is restored', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  assert.ok(Math.abs(j.geschrieben - Date.now()) < 5000, 'the file carries its write time (epoch ms)');
  const { o, log, gesendet } = u.neu({ systemstartMs: j.geschrieben + 60_000 });   // the machine booted a minute after the file was written
  o.ladeNeustartStand();
  neustart(o, 4); willkommen(o, 4);
  await warte(800);
  assert.deepEqual(plan(gesendet), [], 'nothing of the file is loaded or started');
  assert.deepEqual(o.stand.loops, {});
  assert.deepEqual(log.filter((z) => z.typ === 'neustart_stand_verworfen').map((z) => z.grund), ['vor_systemstart']);
});

test('a file from before the system boot is dropped on the same generation too, one written after the boot is kept', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  const alt = u.neu({ systemstartMs: j.geschrieben + 60_000 });
  alt.o.ladeNeustartStand(); willkommen(alt.o, 3); neustart(alt.o, 3);
  assert.deepEqual(alt.o.stand.loops, {}, 'before the boot: dropped');
  const neu = u.neu({ systemstartMs: j.geschrieben - 60_000 });
  neu.o.ladeNeustartStand(); willkommen(neu.o, 3); neustart(neu.o, 3);
  assert.equal(neu.o.stand.loops['1'].name, 'x', 'after the boot: kept');
  const knapp = u.neu({ systemstartMs: j.geschrieben + 3000 });   // the clock was stepped a few seconds: inside the tolerance
  knapp.o.ladeNeustartStand(); willkommen(knapp.o, 3); neustart(knapp.o, 3);
  assert.equal(knapp.o.stand.loops['1'].name, 'x', 'a few seconds of clock difference are tolerated');
});

test('a file of the old format (no write time) is dropped, logged ohne_zeit', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  delete j.geschrieben;
  fs.writeFileSync(u.datei, JSON.stringify(j));
  const { o, log, gesendet } = u.neu();
  o.ladeNeustartStand(); neustart(o, 4); willkommen(o, 4);
  await warte(800);
  assert.deepEqual(plan(gesendet), []);
  assert.deepEqual(log.filter((z) => z.typ === 'neustart_stand_verworfen').map((z) => z.grund), ['ohne_zeit']);
});

// Second review, blocking 1: a waiting plan has a due time. A page server that comes back long after it must not send that plan 500 ms later: the moment
// is gone, the kern that waited for it has had its quiet minutes or is another one by now. Only the owners are adopted, nothing is sent.
async function wartenderPlan(u, faelligVor) {
  await ersterLauf(u, 5, 1000);
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  const vor = Date.now() - faelligVor - 20_000;   // written 20 s before the plan became due
  j.geschrieben = vor; j.loops = {}; j.fx = [null, null]; j.fxZuweisung = [{}, {}, {}];   // the stand of the wait: cleared by the second restart
  j.plan = { faellig: vor + 20_000, boxen: [{ box: 1, name: 'x', status: 3, besitzer: 'andreas' }],
    fx: [{ einheit: 1, felder: FX1, zuweisung: ['deck/1'], besitzer: 'andreas' }], fx3: null, graphen: [] };
  fs.writeFileSync(u.datei, JSON.stringify(j));
}

test('a waiting plan whose due time is long past is not sent when the page comes back, only the owners are adopted', async (t) => {
  const u = umgebung(t);
  await wartenderPlan(u, 600_000);   // due 10 minutes ago
  const { o, log, gesendet } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 5, 30_000_000); neustart(o, 5, 1000);   // the same kern life, ten minutes later
  await warte(900);
  assert.deepEqual(plan(gesendet), [], 'no loop, no FX of ten minutes ago');
  assert.equal(o.loopBesitzer['1'], 'andreas', 'the owners are adopted');
  assert.ok(log.some((z) => z.typ === 'neustart_plan_verworfen' && z.grund === 'ueberfaellig'), JSON.stringify(log.map((z) => z.typ)));
  assert.equal(o.offenerPlan, null, 'and no plan is left to fire at a later kern restart');
});

test('a waiting plan that is only a little late (the page was away a second or two) is still sent', async (t) => {
  const u = umgebung(t);
  await wartenderPlan(u, 2_000);   // due 2 s ago
  const { o, gesendet } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 5, 30_000_000); neustart(o, 5, 1000);
  await warte(900);
  assert.deepEqual(plan(gesendet).filter((s) => s.adresse === '/k/loop/start').map((s) => s.felder.box), [1]);
  assert.deepEqual(plan(gesendet).filter((s) => s.adresse === '/k/fx').map((s) => s.felder.einheit), [1]);
});

// Second review, blocking 2: a higher generation only says that the kern restarted while the page was away, not when. The kern says it: /e/neustart carries the
// first sample of the new generation, /k/willkommen the present one (net.cpp: neustart_sample_, stand_sample_), and /e/neustart follows /k/willkommen.
// Restore only if the kern has just restarted; a kern that restarted an hour ago has had its own set since.
const MIN30 = 30 * 48000;
test('a higher generation, but the kern restarted long before the page came back: nothing of the old file is restored, the owners are adopted', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3, 1000);
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  j.geschrieben = Date.now() - 3_600_000;   // a quiet set writes nothing for long: the write time is no age limit, the samples are
  fs.writeFileSync(u.datei, JSON.stringify(j));
  const { o, log, gesendet } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 4, 200_000_000);   // an hour and more after the continuation
  neustart(o, 4, 1_000_000);
  await warte(900);
  assert.deepEqual(plan(gesendet), [], 'no loop is started in box 1, no FX comes back');
  assert.equal(o.loopBesitzer['1'], 'andreas');
  assert.ok(log.some((z) => z.typ === 'wiederherstellung_uebersprungen' && z.grund === 'kern_laenger_neu'), JSON.stringify(log.map((z) => z.typ)));
  assert.equal(o.offenerPlan, null);
});

test('a higher generation, the kern restarted a few seconds ago (the real order: /k/willkommen first, /e/neustart with the smaller sample after): restored', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3, 1000);
  const { o, gesendet } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 4, 5_000_000 + 10 * 48000);   // 10 s after the continuation
  neustart(o, 4, 5_000_000);
  await warte(900);
  assert.deepEqual(plan(gesendet).filter((s) => s.adresse === '/k/loop/start').map((s) => s.felder.box), [1]);
  assert.deepEqual(plan(gesendet).filter((s) => s.adresse === '/k/fx').map((s) => s.felder.einheit), [1]);
});

test('the limit lies at 30 s between the two samples, in either order of the two words', async (t) => {
  for (const [dauer, erwartet, neustartZuerst] of [[MIN30 - 48000, 1, false], [MIN30 + 48000, 0, false], [MIN30 - 48000, 1, true], [MIN30 + 48000, 0, true]]) {
    const u = umgebung(t);
    await ersterLauf(u, 3, 1000);
    const { o, gesendet } = u.neu();
    o.ladeNeustartStand();
    if (neustartZuerst) { neustart(o, 4, 7_000_000); willkommen(o, 4, 7_000_000 + dauer); } else { willkommen(o, 4, 7_000_000 + dauer); neustart(o, 4, 7_000_000); }
    await warte(800);
    assert.equal(plan(gesendet).filter((s) => s.adresse === '/k/loop/start').length, erwartet, `${dauer} frames, ${neustartZuerst ? 'neustart first' : 'willkommen first'}`);
  }
});

// Second review, point 3: stoppe() wrote the file only at its very start. HTTP and the kern client run on for seconds (the project session ends, the previewer
// stops), so an FX assignment taken off in that window was missing on disk and a later kern restart put it back. One more write directly before the kern client stops.
const ZUWEISUNG_AUS = { adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 0 } };
const waehrendStoppe = (o, wort) => {   // the echo arrives while stoppe() waits for the previewer
  const ende = o.vorhoeren.ende.bind(o.vorhoeren);
  o.vorhoeren.ende = async () => { o.vomKern(wort); await ende(); };
};
test('stoppe() writes the file once more before the kern client stops: an assignment taken off meanwhile is not on disk any more', async (t) => {
  const u = umgebung(t);
  const e = await ersterLauf(u, 3);
  waehrendStoppe(e.o, ZUWEISUNG_AUS);
  await e.o.stoppe();
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  assert.deepEqual(j.fxZuweisung[0], { 'deck/1': false, 'deck/2': true }, JSON.stringify(j.fxZuweisung));
});

test('stoppe() inside the 500 ms before an accepted restore leaves the old stand on disk (the restore that never ran must survive)', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const { o } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 4, 1_048_000); neustart(o, 4, 1_000_000);   // plan made, stand cleared, restore 500 ms away
  assert.ok(o.wiederTimer, 'the restore is pending');
  await o.stoppe();
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  assert.equal(j.generation, 3, 'still the stand of the old kern');
  assert.equal(j.loops['1'].name, 'x');
});

test('stoppe() during the wait for the guard time keeps the waiting plan in the file', async (t) => {
  const sperre0 = Oberflaeche.BOX_FX_SPERRE_MS; Oberflaeche.BOX_FX_SPERRE_MS = 1500;
  t.after(() => { Oberflaeche.BOX_FX_SPERRE_MS = sperre0; });
  const u = umgebung(t);
  await ersterLauf(u, 3, 1000);
  const p = u.neu();
  p.o.ladeNeustartStand();
  willkommen(p.o, 4, 2000); neustart(p.o, 4, 2000);
  await warte(700);
  p.o.vomKern({ adresse: '/e/fx', felder: FX1 });
  p.o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 1 } });
  neustart(p.o, 5, 3000); willkommen(p.o, 5, 3000);   // restart 2 inside the guard time: the restore waits
  assert.ok(p.o.offenerPlanTimer);
  p.o.merkeNeustartStand();
  await warte(450);
  await p.o.stoppe();
  const j = JSON.parse(fs.readFileSync(u.datei, 'utf8'));
  assert.equal(j.generation, 5);
  assert.ok(j.plan && j.plan.fx.length === 1, `the plan is still in the file: ${JSON.stringify(j.plan)}`);
});

// Second review, point 4: after a restore was sent the file is written at once, not after the 300 ms of coalescing. Until then it still holds the OLD
// generation: a crash of the page server without a proper stop would read it as "kern restarted again" and run the same restore twice.
test('right after the restore was sent the file carries the new generation (no 300 ms coalescing)', async (t) => {
  const u = umgebung(t);
  await ersterLauf(u, 3);
  const { o, log } = u.neu();
  o.ladeNeustartStand();
  willkommen(o, 4, 1_048_000); neustart(o, 4, 1_000_000);
  await warte(560);   // the restore ran at 500 ms; the coalesced write would come at 800 ms
  assert.ok(log.some((z) => z.typ === 'wiederherstellung'), 'the restore ran');
  assert.equal(JSON.parse(fs.readFileSync(u.datei, 'utf8')).generation, 4);
});

test('right after the delayed restore was sent the plan is gone from the file (no 300 ms coalescing)', async (t) => {
  const sperre0 = Oberflaeche.BOX_FX_SPERRE_MS; Oberflaeche.BOX_FX_SPERRE_MS = 1500;
  t.after(() => { Oberflaeche.BOX_FX_SPERRE_MS = sperre0; });
  const u = umgebung(t);
  await ersterLauf(u, 3, 1000);
  const p = u.neu();
  p.o.ladeNeustartStand();
  willkommen(p.o, 4, 2000); neustart(p.o, 4, 2000);
  await warte(700);
  p.o.vomKern({ adresse: '/e/fx', felder: FX1 });
  p.o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 1 } });
  neustart(p.o, 5, 3000); willkommen(p.o, 5, 3000);   // restart 2 inside the guard time: the restore waits
  await warte(450);   // the plan is in the file
  assert.ok(JSON.parse(fs.readFileSync(u.datei, 'utf8')).plan, 'the waiting plan is on disk');
  await warte(p.o.offenerPlanFaellig - Date.now() + 80);
  assert.ok(p.log.some((z) => z.typ === 'wiederherstellung_nachgeholt'), 'the delayed restore ran');
  assert.equal(JSON.parse(fs.readFileSync(u.datei, 'utf8')).plan, null);
});
