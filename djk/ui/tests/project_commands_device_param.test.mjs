// Production plan task 9: the light command geraet_param_setzen {spur_id, param: k1..k32, wert 0..1}. One knob of a Baukasten track is written by the project path without
// a playback rebuild; the core row spur/<slot>/bk/<k> carries the value to the instance while the knob is dragged (task 8). Pure calculation: no server, no core.
// The slot of a track is its running number among the tracks with the device bk in ascending track number (nr), counted by device name; the core counts the same way
// (djk/core/tests/test_arr_bk_controls.cpp case 10 pins the same example: bk on 3, 7 and 9, an RB-338 on 5: slots 1, 2, 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { bkSlot, bkLive, BK_LIVE_SLOTS, MAX_BK_SPUREN } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { alleRegler } from '../areas/proj/mapping.ts';
import { specProjekt, kopie, tmpOrdner } from './support/project.mjs';

const BK_ZEILE = /^spur\/\d+\/bk\//;
const bk = (parameter = {}) => ({ art: 'intern', name: 'bk', graph: 'juno-pad', parameter });
const rb = () => ({ art: 'intern', name: 'rb338', parameter: {} });
const spur = (id, nr, geraet) => ({ id, nr, name: id, farbe: '#3b8de0', art: 'instrument', geraet, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
// the track list is NOT in ascending order of nr: the slot comes from nr, not from the position
const projekt = () => { const p = specProjekt(); p.spuren = [spur('s9', 9, bk()), spur('s3', 3, bk({ k5: 0.25 })), spur('s5', 5, rb()), spur('s7', 7, bk())]; return p; };
const zwei = () => { const p = specProjekt(); p.spuren = [spur('s7', 7, bk()), spur('s3', 3, bk({ k5: 0.25 }))]; return p; };
const setze = (spurId, param, wert) => ({ befehl: 'geraet_param_setzen', spur_id: spurId, param, wert });
const lehntAb = (p, b, grund) => assert.throws(() => fuehreListeAus(p, [b]), (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund} for ${JSON.stringify(b)}`);
const spurVon = (p, id) => p.spuren.find((s) => s.id === id);
const A = { quelle: 'andreas', label: 'x' };

test('bkSlot: the running number among the bk tracks in ascending track number, by device name; null for anything else', () => {
  const z = zwei();
  assert.equal(bkSlot(z, 's3'), 1);
  assert.equal(bkSlot(z, 's7'), 2);
  const p = projekt();   // an RB-338 on 5 does not count, another bk on 9 is slot 3
  assert.equal(bkSlot(p, 's3'), 1);
  assert.equal(bkSlot(p, 's7'), 2);
  assert.equal(bkSlot(p, 's9'), 3);
  assert.equal(bkSlot(p, 's5'), null);
  assert.equal(bkSlot(p, 'x'), null);
  const ohne3 = kopie(p); ohne3.spuren = ohne3.spuren.filter((s) => s.id !== 's3');
  assert.equal(bkSlot(ohne3, 's7'), 1, 'removing a bk track shifts the slots above it');
});

test('geraet_param_setzen is light, writes the knob and names exactly one row', () => {
  const p = zwei();
  const r = fuehreListeAus(p, [setze('s7', 'k5', 0.8)]);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.equal(spurVon(r.projekt, 's7').geraet.parameter.k5, 0.8);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'spur/2/bk/5', wert: 0.8 }]);
  const r1 = fuehreListeAus(p, [setze('s3', 'k32', 0.1)]);
  assert.deepEqual(r1.regler_aenderungen, [{ pfad: 'spur/1/bk/32', wert: 0.1 }]);
  const r64 = fuehreListeAus(p, [setze('s7', 'k64', 0.2)]);
  assert.deepEqual(r64.regler_aenderungen, [{ pfad: 'spur/2/bk/64', wert: 0.2 }], 'k64 names its core row');
  assert.equal(spurVon(p, 's7').geraet.parameter.k5, undefined, 'the project the command started from is not mutated');
  assert.equal(spurVon(p, 's3').geraet.parameter.k32, undefined);
});

test('the patches add, replace and remove only geraet/parameter/<param>; the back patch restores the old parameter object, also an absent knob', () => {
  const p = zwei();
  const vorher = kopie(p);
  const neu = fuehreListeAus(p, [setze('s7', 'k5', 0.8)]);   // k5 absent before
  assert.deepEqual(neu.vor, [{ op: 'add', pfad: '/spuren/s7/geraet/parameter/k5', wert: 0.8 }]);
  assert.deepEqual(neu.zurueck, [{ op: 'remove', pfad: '/spuren/s7/geraet/parameter/k5' }], 'absent before: removed again, not set to a default');
  assert.deepEqual(spurVon(wende(neu.projekt, neu.zurueck), 's7').geraet.parameter, {});
  assert.deepEqual(wende(neu.projekt, neu.zurueck).spuren, vorher.spuren);
  const alt = fuehreListeAus(p, [setze('s3', 'k5', 0.9)]);   // k5 = 0.25 before
  assert.deepEqual(alt.vor, [{ op: 'replace', pfad: '/spuren/s3/geraet/parameter/k5', wert: 0.9 }]);
  assert.deepEqual(alt.zurueck, [{ op: 'replace', pfad: '/spuren/s3/geraet/parameter/k5', wert: 0.25 }]);
  assert.deepEqual(spurVon(wende(alt.projekt, alt.zurueck), 's3').geraet.parameter, { k5: 0.25 });
  for (const r of [neu, alt]) {   // the fast path and the general path give the same
    const voll = fuehreListeAus(p, [r === neu ? setze('s7', 'k5', 0.8) : setze('s3', 'k5', 0.9)], { voll: true });
    assert.deepEqual([voll.vor, voll.zurueck], [r.vor, r.zurueck]);
    assert.deepEqual(voll.projekt.spuren, r.projekt.spuren);
  }
  assert.deepEqual(p, vorher, 'the input project is untouched by every path');
});

test('undo and redo are playback builds: no knob row travels, the core clears the written row with the build', (t) => {
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  let q = aendere(w, zwei(), [setze('s7', 'k5', 0.8)], A);
  assert.equal(q.betrifft_wiedergabe, false);
  assert.deepEqual(q.regler_aenderungen, [{ pfad: 'spur/2/bk/5', wert: 0.8 }]);
  const u = rueckgaengig(w, q.projekt, { quelle: 'andreas' });
  assert.equal(u.betrifft_wiedergabe, true, 'the undo reloads the playback');
  assert.ok(u.regler_aenderungen.every((x) => !BK_ZEILE.test(x.pfad)), JSON.stringify(u.regler_aenderungen));
  assert.equal(spurVon(u.projekt, 's7').geraet.parameter.k5, undefined);
  const r = wiederholen(w, u.projekt, { quelle: 'andreas' });
  assert.equal(r.betrifft_wiedergabe, true, 'the redo reloads the playback');
  assert.ok(r.regler_aenderungen.every((x) => !BK_ZEILE.test(x.pfad)), JSON.stringify(r.regler_aenderungen));
  assert.equal(spurVon(r.projekt, 's7').geraet.parameter.k5, 0.8);
});

test('every other cause of a stale row is a playback build and emits no knob row: device swap, track delete, hand and preset spur_aendern', () => {
  const p = zwei();
  const swap = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's7', geraet: bk({ k5: 0.1 }) }]);   // the same device, another knob value: the hand and preset command (presets/apply.ts)
  assert.equal(swap.betrifft_wiedergabe, true);
  assert.ok(swap.regler_aenderungen.every((x) => !BK_ZEILE.test(x.pfad)));
  const andere = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's7', geraet: { ...bk(), graph: 'other-pad' } }]);   // another graph
  assert.equal(andere.betrifft_wiedergabe, true);
  const rb338 = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's7', geraet: rb() }]);   // another device
  assert.equal(rb338.betrifft_wiedergabe, true);
  assert.ok(rb338.regler_aenderungen.every((x) => !BK_ZEILE.test(x.pfad)));
  const weg = fuehreListeAus(p, [{ befehl: 'spur_loeschen', spur_id: 's7' }]);
  assert.equal(weg.betrifft_wiedergabe, true);
  assert.ok(weg.regler_aenderungen.every((x) => !BK_ZEILE.test(x.pfad)));
});

test('open: alleRegler names no knob row, also for a project that holds bk tracks with parameters', () => {
  const p = projekt();
  const liste = alleRegler(p);
  assert.ok(liste.length > 0);
  assert.ok(liste.every((x) => !BK_ZEILE.test(x.pfad)), 'the rows are transient: opening or switching a project never writes one');
  assert.equal(spurVon(p, 's3').geraet.parameter.k5, 0.25, 'control: the project does hold a knob value');
});

test('two moves of the same knob within the window are one history entry; another knob is a second entry', (t) => {
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const start = zwei();
  let q = start;
  uhr.t += 5000;
  for (const v of [0.2, 0.3, 0.4, 0.5]) { uhr.t += 100; q = aendere(w, q, [setze('s7', 'k5', v)], A).projekt; }
  uhr.t += 100; q = aendere(w, q, [setze('s7', 'k6', 0.9)], A).projekt;   // another knob: its own step
  uhr.t += 100; q = aendere(w, q, [setze('s3', 'k5', 0.6)], A).projekt;   // another track: its own step
  const u1 = rueckgaengig(w, q, { quelle: 'andreas' });
  assert.equal(spurVon(u1.projekt, 's3').geraet.parameter.k5, 0.25, 'one undo: the other track back');
  const u2 = rueckgaengig(w, u1.projekt, { quelle: 'andreas' });
  assert.equal(spurVon(u2.projekt, 's7').geraet.parameter.k6, undefined, 'one undo: the other knob back');
  assert.equal(spurVon(u2.projekt, 's7').geraet.parameter.k5, 0.5, 'the sweep is still there');
  const u3 = rueckgaengig(w, u2.projekt, { quelle: 'andreas' });
  assert.equal(spurVon(u3.projekt, 's7').geraet.parameter.k5, undefined, 'one undo takes the whole sweep back to where it began');
});

test('refusals: spur_unbekannt, geraet_falsch (RB-338), argument_ungueltig, argument_unbekannt; a lane on the knob answers lane_treibt and the write is kept', () => {
  const p = projekt();
  lehntAb(p, setze('nope', 'k5', 0.5), 'spur_unbekannt');
  lehntAb(p, setze('s5', 'k5', 0.5), 'geraet_falsch');
  for (const k of ['k33', 'k64']) assert.doesNotThrow(() => fuehreListeAus(p, [setze('s7', k, 0.5)]), `${k} is live`);
  for (const wert of [1.5, -0.1, '0.5', NaN, null, undefined]) lehntAb(p, setze('s7', 'k5', wert), 'argument_ungueltig');
  lehntAb(p, setze('s7', 'k65', 0.5), 'argument_unbekannt');
  lehntAb(p, setze('s7', 'cutoff', 0.5), 'argument_unbekannt');
  lehntAb(p, { ...setze('s7', 'k5', 0.5), extra: 1 }, 'argument_unbekannt');
  Object.assign(p, { format: 'cypherdj-projekt/2', gruppen: [], master: { fader_db: 0 } });   // lanes exist from format 2
  const mitLane = fuehreListeAus(p, [{ befehl: 'auto_neu', spur_id: 's7', ziel: 'geraet.k5' }]).projekt;
  const r = fuehreListeAus(mitLane, [setze('s7', 'k5', 0.7)]);
  assert.equal(r.hinweise?.[0]?.hinweis, 'lane_treibt');
  assert.equal(spurVon(r.projekt, 's7').geraet.parameter.k5, 0.7, 'the write is kept as the rest value');
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'spur/2/bk/5', wert: 0.7 }]);
  const kein = fuehreListeAus(mitLane, [setze('s7', 'k6', 0.7)]);   // negative control: another knob has no hint
  assert.equal(kein.hinweise, undefined);
});

// ARR_BK_MAX = MAX_BK_SPUREN = BK_LIVE_SLOTS = 16: every bk track has override rows
const sechzehn = () => { const p = specProjekt(); p.spuren = Array.from({ length: MAX_BK_SPUREN }, (_, i) => spur(`t${i + 1}`, i + 1, bk())); return p; };

test('tracks 1..16: bkSlot counts on, bkLive is true for all, geraet_param_setzen stays light (row spur/<slot>/bk/<k>, no rebuild)', () => {
  const p = sechzehn();
  assert.equal(BK_LIVE_SLOTS, MAX_BK_SPUREN);
  for (let i = 1; i <= MAX_BK_SPUREN; i += 1) {
    assert.equal(bkSlot(p, `t${i}`), i, `slot of t${i}`);
    assert.equal(bkLive(p, `t${i}`), true, `live t${i}`);
  }
  assert.equal(bkLive(p, 'nix'), false);
  for (const i of [9, 12, 16]) {
    const r = fuehreListeAus(p, [setze(`t${i}`, 'k5', 0.8)]);
    assert.equal(r.betrifft_wiedergabe, false, `t${i}: no rebuild`);
    assert.deepEqual(r.regler_aenderungen, [{ pfad: `spur/${i}/bk/5`, wert: 0.8 }], `t${i}: the row`);
    assert.equal(spurVon(p, `t${i}`).geraet.parameter.k5, undefined, 'the input project is untouched');
  }
});

test('slot 8 is still light: spur/8/bk/<k>, no rebuild; a command for an unknown or an RB-338 track still raises the old error', () => {
  const p = sechzehn();
  const r = fuehreListeAus(p, [setze('t8', 'k5', 0.8)]);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'spur/8/bk/5', wert: 0.8 }]);
  lehntAb(p, setze('nix', 'k5', 0.5), 'spur_unbekannt');
  const q = sechzehn(); q.spuren[0] = spur('t1', 1, rb());
  lehntAb(q, setze('t1', 'k5', 0.5), 'geraet_falsch');
});
