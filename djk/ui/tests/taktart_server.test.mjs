// Plan studio-taktart T2: the page server quantises to bars of the open project's meter n/4 and publishes the meter
// (stream folder file `taktart`, SSE event `taktart`, key `taktart` of /lage). 4/4 and no project: nothing of it (see taktart_4_server.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel, post, hole } from './support/media_library.mjs';
import { sse, bis } from './support/proj_stack.mjs';
import { TEST_INSTANZ } from './support/instance.mjs';
import { tempoRampe, abBeatVon } from '../tempo_ramp.ts';
import { veroeffentlicheTaktart } from '../areas/proj/taktart_output.ts';

const STROEME = [1, 2, 3, 5, 6, 7, 9, 10];
const CYPHER = { 'x-djk-quelle': 'cypher' };

async function aufbau(t, opt = {}) {
  const s = await stapel(t, opt);
  const uhr = { beat: 10.3, bpm: 120, mono_ns: 0 };
  Object.defineProperty(s.o.kern, 'uhr', { get: () => uhr, set: () => {}, configurable: true });
  s.uhr = uhr;
  s.ordner = (st) => s.o.musterOrdner(st);
  s.dateien = () => STROEME.map((st) => path.join(s.ordner(st), 'taktart')).filter((p) => fs.existsSync(p));
  s.aendern = async (taktart, rev) => (await post(s.url, '/proj/aendern', { rev, label: 'meter', befehle: [{ befehl: 'taktart_setzen', taktart }] })).j;
  return s;
}
const oeffne = async (s, meter) => {
  const neu = await post(s.url, '/proj/neu', { name: 'Takt' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  if (meter) { const r = await s.aendern(meter, neu.j.projekt.rev); assert.ok(r.rev, JSON.stringify(r)); return r.rev; }
  return neu.j.projekt.rev;
};

test('3/4 open: /regler ab=takt sends ab_beat on a multiple of 3, ab=phrase on a multiple of 24, takte means bars of 3', async (t) => {
  const s = await aufbau(t);
  await oeffne(s, [3, 4]);
  s.uhr.beat = 13.3;   // here the 3-grid (15) and the 4-grid (16) differ
  const a = await post(s.url, '/regler', { pfad: 'master/pegel', nach: -3 });
  assert.equal(a.j.felder.ab_beat, 15, 'beat 13.3 + lead-in on the raster 3 (the 4-grid would give 16)');
  const b = await post(s.url, '/regler', { pfad: 'master/pegel', nach: -4, ab: 'phrase' });
  assert.equal(b.j.felder.ab_beat, 24, 'the 4-grid would give 32');
  const c = await post(s.url, '/regler', { pfad: 'master/pegel', nach: -5, ab: 'schlag', takte: 2 });
  assert.equal(c.j.felder.dauer_beats, 6, 'two bars of 3 beats');
});

test('3/4 open: /lage uhr takt and schlag count 3 (beat 7.5: takt 3, schlag 2); 4/4: 2 and 4', async (t) => {
  const s = await aufbau(t);
  s.uhr.beat = 7.5;
  const keins = (await hole(s.url, '/lage')).j.uhr;
  assert.deepEqual([keins.takt, keins.schlag], [2, 4], 'no project: 4');
  const rev = await oeffne(s, [3, 4]);
  const drei = (await hole(s.url, '/lage')).j.uhr;
  assert.deepEqual([drei.takt, drei.schlag], [3, 2]);
  assert.ok(rev >= 1);
});

test('/lage carries taktart [3,4] in 3/4; the key is absent in 4/4 and with no project open', async (t) => {
  const s = await aufbau(t);
  assert.ok(!('taktart' in (await hole(s.url, '/lage')).j), 'no project');
  const rev = await oeffne(s);
  assert.ok(!('taktart' in (await hole(s.url, '/lage')).j), '4/4');
  await s.aendern([3, 4], rev);
  assert.deepEqual((await hole(s.url, '/lage')).j.taktart, [3, 4]);
});

test('SSE taktart {proTakt:3} after taktart_setzen [3,4], {proTakt:4} after undo, no taktart event in a 4/4 session', async (t) => {
  const s = await aufbau(t);
  const strom = sse(s.url); t.after(() => strom.zu());
  const rev = await oeffne(s);
  await post(s.url, '/regler', { pfad: 'master/pegel', nach: -3 });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(strom.ereignisse.filter((e) => e.a === 'taktart'), [], '4/4 session: no event');
  const r = await s.aendern([3, 4], rev);
  assert.ok(await bis(() => strom.ereignisse.some((e) => e.a === 'taktart')));
  assert.deepEqual(strom.ereignisse.filter((e) => e.a === 'taktart').map((e) => e.f), [{ proTakt: 3 }]);
  const u = await post(s.url, '/proj/undo', { rev: r.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.ok(await bis(() => strom.ereignisse.filter((e) => e.a === 'taktart').length === 2));
  assert.deepEqual(strom.ereignisse.filter((e) => e.a === 'taktart').map((e) => e.f), [{ proTakt: 3 }, { proTakt: 4 }]);
});

test('stream folders: file 3 in all of {1,2,3,5,6,7,9,10} after taktart_setzen [3,4]; none after undo and after close', async (t) => {
  const s = await aufbau(t);
  const rev = await oeffne(s);
  assert.deepEqual(s.dateien(), [], '4/4 open: nothing written');
  const r = await s.aendern([3, 4], rev);
  assert.ok(await bis(() => s.dateien().length === STROEME.length));
  for (const st of STROEME) assert.equal(fs.readFileSync(path.join(s.ordner(st), 'taktart'), 'utf8'), '3');
  const u = await post(s.url, '/proj/undo', { rev: r.rev });
  assert.ok(await bis(() => s.dateien().length === 0), 'undo removes the files');
  await s.aendern([5, 4], u.j.rev);
  await bis(() => s.dateien().length === STROEME.length);
  const zu = await post(s.url, '/proj/schliessen', {});
  assert.equal(zu.code, 200, JSON.stringify(zu.j));
  assert.ok(await bis(() => s.dateien().length === 0), 'close removes the files');
});

test('4/4 and no-project sessions: the folders look the same before and after open, close and taktart_setzen [4,4]', async (t) => {
  const s = await aufbau(t);
  const liste = () => STROEME.map((st) => (fs.existsSync(s.ordner(st)) ? fs.readdirSync(s.ordner(st)).sort() : null));
  const vorher = liste();
  const rev = await oeffne(s);
  await s.aendern([4, 4], rev);
  await post(s.url, '/proj/schliessen', {});
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(liste(), vorher);
});

test('stale file from a crash is removed at starte() with no project open', async (t) => {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-taktart-'));
  t.after(() => fs.rmSync(basis, { recursive: true, force: true }));
  const ordnerVon = (st) => (st === 1 ? `${basis}/m` : `${basis}/m${st}`);
  for (const st of STROEME) { fs.mkdirSync(ordnerVon(st), { recursive: true }); fs.writeFileSync(path.join(ordnerVon(st), 'taktart'), '3'); }
  const s = await stapel(t, { musterOrdner: `${basis}/m` });
  for (const st of STROEME) assert.ok(!fs.existsSync(path.join(s.o.musterOrdner(st), 'taktart')), `stream ${st}`);
});

test('tempo ramp in 3/4 starts on a multiple of 3 and lasts RAMPE_BEATS (4)', async (t) => {
  const s = await aufbau(t);
  await oeffne(s, [3, 4]);
  s.uhr.beat = 13.3;   // 3-grid 15, 4-grid 16
  const r = await post(s.url, '/tempo', { bpm: 130 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.ab_beat % 3, 0);
  assert.equal(r.j.felder.ab_beat, 15, 'the 4-grid would give 16');
  assert.equal(r.j.felder.dauer_beats, 4);
  void CYPHER;
});

test('tempoRampe and abBeatVon: proTakt 3 puts the ramp on the bar of 3, the default stays 4', () => {
  assert.equal(tempoRampe(10.3, 120, 130).ab_beat, 12);
  assert.equal(tempoRampe(13.3, 120, 130, 3).ab_beat, 15);
  assert.equal(tempoRampe(13.3, 120, 130).ab_beat, 16);
  assert.equal(abBeatVon(13.3, 120, 'phrase', 3), 24);
  assert.equal(abBeatVon(13.3, 120, 'phrase'), 32);
});

test('veroeffentlicheTaktart: 4 never creates anything, 3 writes the file into every folder, a failing folder does not stop the others', () => {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-taktart-u-'));
  try {
    const ordner = [`${basis}/a`, `${basis}/b`];
    veroeffentlicheTaktart(ordner, 4);
    assert.deepEqual(fs.readdirSync(basis), []);
    const fehler = [];
    const schreibe = (o, n) => { if (o.endsWith('/a')) throw new Error('kaputt'); fs.mkdirSync(o); fs.writeFileSync(`${o}/taktart`, String(n)); };
    veroeffentlicheTaktart(ordner, 3, schreibe, (o, e) => fehler.push([o, e.message]));
    assert.deepEqual(fehler, [[`${basis}/a`, 'kaputt']]);
    assert.equal(fs.readFileSync(`${basis}/b/taktart`, 'utf8'), '3');
  } finally { fs.rmSync(basis, { recursive: true, force: true }); }
});

// A restart of the page server must not flip running n/4 generators to 4: with a remembered project the stale file stays until the reopen
// publishes the meter itself; only when nothing comes back (no project, failed reopen) the stale file goes.
async function neustart(t, s, vorher) {
  await s.o.stoppe();
  const { Oberflaeche } = await import('../server.ts');
  // the server of this second life must never be the live studio: stapel(t) set the test instance for this test, keep it so (pin: stack_instance.test.mjs)
  if (process.env.CYPHERDJ_INSTANZ !== TEST_INSTANZ) process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const o = new Oberflaeche({ ...s.optionen });
  const proto = Object.getPrototypeOf(o);
  const orig = proto.projektWiederOeffnen;
  const gesehen = [];
  proto.projektWiederOeffnen = function (...a) { gesehen.push(vorher()); return orig.apply(this, a); };
  t.after(() => { proto.projektWiederOeffnen = orig; });
  await o.starte();
  t.after(() => o.stoppe());
  await o.projektWieder;
  return { o, gesehen };
}

test('restart with a remembered 3/4 project: the meter files are NOT removed before the reopen, and hold 3 after it', async (t) => {
  const s = await aufbau(t);
  await oeffne(s, [3, 4]);
  const dateien = () => STROEME.map((st) => path.join(s.ordner(st), 'taktart')).filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p, 'utf8').trim());
  assert.ok(dateien().length > 0);
  const r = await neustart(t, s, dateien);
  assert.deepEqual(r.gesehen[0], dateien().map(() => '3'), 'files still there when the reopen starts');
  assert.deepEqual([...new Set(dateien())], ['3']);
});

test('restart whose remembered project cannot be reopened: the stale meter files are removed after the failure', async (t) => {
  const s = await aufbau(t);
  await oeffne(s, [3, 4]);
  await s.o.stoppe();
  fs.rmSync(path.join(s.optionen.proj.wurzel, 'takt'), { recursive: true, force: true });
  const dateien = () => STROEME.map((st) => path.join(s.ordner(st), 'taktart')).filter((p) => fs.existsSync(p));
  assert.ok(dateien().length > 0);
  await neustart(t, s, dateien);
  assert.deepEqual(dateien(), []);
});

// ---- track planner (track.ts): bars follow the meter, 4 stays byte-identical ----
import { plane, planeDurchlauf } from '../track.ts';
const SPUR = { name: 'x', fahrten: [{ ziel: 'deck/1/filter', ab_takt: 2, takte: 2, nach: -6 }, { ziel: 'master/pegel', ab_takt: 4, nach: -3 }] };

test('plane/planeDurchlauf: default and proTakt 4 are identical, proTakt 3 counts bars of 3 beats', () => {
  assert.deepEqual(plane(SPUR, 8), plane(SPUR, 8, 4));
  assert.deepEqual(planeDurchlauf({ ...SPUR, schleife_takte: 4 }, 8, 1, 0), planeDurchlauf({ ...SPUR, schleife_takte: 4 }, 8, 1, 0, 4));
  const g = plane(SPUR, 9, 3);
  assert.deepEqual(g.teile.map((x) => [x.pfad, x.ab_beat, x.dauer_beats]), [['deck/1/filter', 12, 6], ['master/pegel', 18, 0]]);
  assert.equal(g.ende_beat, 18);
  const d = planeDurchlauf({ ...SPUR, schleife_takte: 4 }, 9, 0, 0, 3);
  assert.deepEqual([d.anfang_beat, d.ende_beat], [9, 21]);
  assert.equal(planeDurchlauf({ ...SPUR, schleife_takte: 4 }, 9, 1, 0, 3).anfang_beat, 21);
});

test('3/4 open: POST /spur answers with bars of 3 (anker on a multiple of 3, end after 3 beats per bar)', async (t) => {
  const s = await aufbau(t);
  await oeffne(s, [3, 4]);
  const r = await post(s.url, '/spur', { spur: { name: 'b3', fahrten: [{ ziel: 'deck/1/filter', ab_takt: 3, takte: 1, nach: -6 }] } });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.anker_beat % 3, 0);
  assert.equal(r.j.ende_beat - r.j.anker_beat, 9, 'start of bar 3 = 6 beats, plus 1 bar of 3 beats');
  await post(s.url, '/spur/stopp', { name: 'b3' });
});

test('3/4 open: a loop track repeats every 3n beats and GET /spur names n bars', async (t) => {
  const s = await aufbau(t);
  await oeffne(s, [3, 4]);
  const r = await post(s.url, '/spur', { spur: { name: 'l3', schleife_takte: 2, fahrten: [{ ziel: 'deck/1/filter', ab_takt: 1, takte: 1, nach: -6 }] } });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.ende_beat - r.j.anker_beat, 6);
  const l = (await hole(s.url, '/spur')).j.find((x) => x.name === 'l3');
  assert.equal(l.schleife_takte, 2);
  assert.equal(l.ende_beat - l.anker_beat, 6);
  await post(s.url, '/spur/stopp', { name: 'l3' });
});
