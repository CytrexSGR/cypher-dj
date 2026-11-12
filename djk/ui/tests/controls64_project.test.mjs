// 64 knobs, page side (Task 4 of the synth build-out): the project format is the one irreversible place. 8- and 32-number projects of a graph
// without `vorgabe` load and are written back byte for byte; fill and trim use the same list, the graph's `vorgabe` per knob.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projekte, setzeVorgabenQuelle } from '../project/storage.ts';
import { pruefeProjekt, pruefeFehler, BK_PARAMETER, BK_ZIELE, AUTO_ZIELE, GLIED_PARAM_BK33, gliedMakroParam } from '../project/model.ts';
import { BK_REGLER_ZAHL, bkReglerAuffuellen, bkReglerKanonisch, bkSetzen } from '../project/modular.ts';
import { vorgabenVon } from '../graphs.ts';
import { INSERT_ARTEN } from '../project/insert_key.ts';
import { HK_GERAET } from '../project/envelope.ts';
import { specProjekt, tmpOrdner } from './support/project.mjs';

test.afterEach(() => setzeVorgabenQuelle(null));

const projekt = (regler, graph = 'juno-pad-dyn') => {
  const p = specProjekt();
  p.format = 'cypherdj-projekt/2'; p.gruppen = []; p.master = { fader_db: 0 };
  p.spuren[2] = { id: 's3', nr: 3, name: 'Pad', farbe: '#9b59d0', art: 'instrument', fader_db: 0, pan: 0, mute: false, solo: false, clips: [],
    geraet: { art: 'intern', name: 'bk', graph: 'juno-pad', parameter: { k1: 0.2, k8: 1 } },
    inserts: [{ id: 'i1', art: 'bk', slot: 1, an: true, graph: 'fx-bandecho', werte: { k1: 0.5, k2: 0.5, k3: 0.5, k4: 0.5, k5: 0.5, k6: 0.5, k7: 0.5, k8: 0.25 } }] };
  p.baukasten = [{ id: 'erz2', graph, regler }];
  return p;
};
const acht = [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.25];
const zweiunddreissig = () => { const r = [...acht, ...Array(24).fill(0.5)]; r[31] = 0.7; return r; };

// (a) the two old formats, hand-written, round trip byte for byte
for (const [name, regler] of [['8 numbers', acht], ['32 numbers, knob 32 at 0.7', zweiunddreissig()]]) {
  test(`${name}: a project of a graph without vorgabe loads and is written back byte for byte`, (t) => {
    const wurzel = tmpOrdner(t);
    const pr = new Projekte(wurzel);
    const { slug } = pr.lege('Alt');
    const datei = path.join(wurzel, slug, 'project.json');
    fs.writeFileSync(datei, JSON.stringify(projekt(regler), null, 1) + '\n');
    const o0 = pr.oeffne(slug); pr.speichere(slug, o0.projekt); o0.verlauf.schliesse();
    const b0 = fs.readFileSync(datei);
    assert.equal(JSON.parse(b0.toString()).baukasten[0].regler.length, regler.length, 'the writer keeps the stored length');
    const o = pr.oeffne(slug);
    assert.deepEqual(o.projekt.baukasten[0].regler, regler);
    assert.equal(bkReglerAuffuellen(o.projekt.baukasten[0].regler).length, 64);
    pr.speichere(slug, o.projekt); o.verlauf.schliesse();
    assert.ok(fs.readFileSync(datei).equals(b0), 'bytes unchanged');
    // the raw bytes of the hand-written file equal the writer's output when it is written in the writer's own form
    assert.deepEqual(JSON.parse(b0.toString()).baukasten[0].regler, regler);
  });
}

// (b) knob 33 and 64 touched
test('knob 33 and 64 touched: 64 numbers are written and read back identically; 7 and 65 are refused', (t) => {
  const wurzel = tmpOrdner(t);
  const pr = new Projekte(wurzel);
  const { slug } = pr.lege('Neu');
  const datei = path.join(wurzel, slug, 'project.json');
  const r = bkReglerAuffuellen(acht); r[32] = 0.1; r[63] = 0.9;
  fs.writeFileSync(datei, JSON.stringify(projekt(r), null, 1) + '\n');
  const o = pr.oeffne(slug); pr.speichere(slug, o.projekt); o.verlauf.schliesse();
  const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.equal(roh.baukasten[0].regler.length, 64);
  assert.deepEqual(roh.baukasten[0].regler, r);
  const o2 = pr.oeffne(slug); assert.deepEqual(o2.projekt.baukasten[0].regler, r); o2.verlauf.schliesse();
  assert.equal(pruefeFehler(projekt(Array(64).fill(0.4))), null);
  for (const n of [7, 65]) assert.match(pruefeFehler(projekt(Array(n).fill(0.4))) ?? '', /baukasten.*8\.\.64 numbers expected/, `${n} numbers`);
});

// (c) graph-aware fill and trim
const FIX = Array(64).fill(0.5); FIX[39] = 0; FIX[27] = 0.25;
test('graph-aware: an 8-number array reads back with the vorgabe of the graph; trim and fill use the same list', () => {
  assert.deepEqual(bkReglerAuffuellen(acht, FIX).slice(8, 28), [...Array(19).fill(0.5), 0.25]);
  assert.equal(bkReglerAuffuellen(acht, FIX)[39], 0);
  assert.equal(bkReglerAuffuellen(acht, FIX).length, 64);
  // a stored 0.5 on knob 40 (vorgabe 0) is data: written, not trimmed, and read back as 0.5
  const r = bkReglerAuffuellen(acht, FIX); r[39] = 0.5;
  const k = bkReglerKanonisch(r, FIX);
  assert.equal(k.length, 40); assert.equal(k[39], 0.5);
  assert.deepEqual(bkReglerAuffuellen(k, FIX), r, 'read back as stored');
  // a stored 0 on knob 40 is the default and is trimmed; knob 28 at 0.25 is trimmed too; so the untouched array goes back to 8
  assert.deepEqual(bkReglerKanonisch(bkReglerAuffuellen(acht, FIX), FIX), acht);
  const s = bkReglerAuffuellen(acht, FIX); s[27] = 0.5; assert.equal(bkReglerKanonisch(s, FIX).length, 28, 'knob 28 at 0.5 differs from its 0.25');
  // an unknown graph (null): reading pads with 0.5; writing does NOT cut (the array may have been stored against a vorgabe list)
  assert.deepEqual(bkReglerAuffuellen(acht, null).slice(8), Array(56).fill(0.5));
  assert.deepEqual(bkReglerAuffuellen(acht), bkReglerAuffuellen(acht, null));
  assert.deepEqual(bkReglerKanonisch(Array(64).fill(0.5), null), Array(64).fill(0.5), 'not cut without a list');
  assert.deepEqual(bkReglerKanonisch(acht, null), acht, 'an 8-number array stays as it is');
  assert.deepEqual(bkReglerKanonisch([0.1, 0.2], null), [0.1, 0.2, ...Array(6).fill(0.5)], 'at least 8 numbers');
  const z = Array(64).fill(0.5); z[39] = 0; assert.equal(bkReglerKanonisch(z, null).length, 64);
});

test('graph-aware: bk_setzen and the storage layer write against the graph from the injected source', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vorgaben-t4-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const knoten = [{ id: 'a', art: 'regler', nr: 40, min: 0, max: 1, vorgabe: 0 }, { id: 'b', art: 'regler', nr: 28, min: 0, max: 1, vorgabe: 0.25 }];
  fs.writeFileSync(path.join(dir, 'fix-vorgabe.json'), JSON.stringify({ format: 'baukasten/2', name: 'fix-vorgabe', stimmen: 1, knoten, kanten: [] }));
  setzeVorgabenQuelle((n) => vorgabenVon(n, dir));
  const v = vorgabenVon('fix-vorgabe', dir);
  assert.equal(v.length, 64); assert.equal(v[39], 0); assert.equal(v[27], 0.25);
  // bk_setzen: a stored 0.5 on knob 40 survives, a 0 on it is trimmed
  const r = bkReglerAuffuellen(acht, v); r[39] = 0.5;
  const a = bkSetzen([], { kanal: 'erz/2', graph: 'fix-vorgabe', regler: r });
  assert.equal(a.liste[0].regler.length, 40); assert.equal(a.liste[0].regler[39], 0.5);
  const b = bkSetzen([], { kanal: 'erz/2', graph: 'fix-vorgabe', regler: bkReglerAuffuellen(acht, v) });
  assert.deepEqual(b.liste[0].regler, acht);
  const c = bkSetzen([], { kanal: 'erz/2', graph: 'fix-vorgabe' });
  assert.deepEqual(c.liste[0].regler, Array(8).fill(0.5), 'regler omitted: the graph default, written as the minimum');
  const d = bkSetzen([], { kanal: 'erz/2', graph: 'unbekannt-xyz', regler: Array(64).fill(0.5) });
  assert.equal(d.liste[0].regler.length, 64, 'unknown graph: stored as given, not cut');
  // graph change without regler: the old values are filled with the OLD graph's list, then cut against the new one
  const e0 = bkSetzen([], { kanal: 'erz/2', graph: 'fix-vorgabe', regler: a.liste[0].regler });   // k40 = 0.5 stored against vorgabe 0
  const e1 = bkSetzen(e0.liste, { kanal: 'erz/2', graph: 'unbekannt-xyz' });
  assert.equal(e1.liste[0].regler[39], 0.5, 'the stored 0.5 on knob 40 survives a switch to a graph without a list');
  assert.equal(e1.liste[0].regler.length, 40);
  const e2 = bkSetzen(e1.liste, { kanal: 'erz/2', graph: 'fix-vorgabe' });
  assert.deepEqual(bkReglerAuffuellen(e2.liste[0].regler, v)[39], 0.5, 'and reads back as 0.5 with the graph');
  // the storage layer: save, reopen
  const wurzel = tmpOrdner(t);
  const pr = new Projekte(wurzel);
  const { slug } = pr.lege('Vorgabe');
  const datei = path.join(wurzel, slug, 'project.json');
  const x = projekt(a.liste[0].regler, 'fix-vorgabe');
  fs.writeFileSync(datei, JSON.stringify(x, null, 1) + '\n');
  const o = pr.oeffne(slug); pr.speichere(slug, o.projekt); o.verlauf.schliesse();
  const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.equal(roh.baukasten[0].regler.length, 40); assert.equal(roh.baukasten[0].regler[39], 0.5);
  const o2 = pr.oeffne(slug); assert.deepEqual(bkReglerAuffuellen(o2.projekt.baukasten[0].regler, v), r); o2.verlauf.schliesse();
  // the repro: the graph file is missing at save time; nothing is lost, with the graph back k40 is still 0.5
  setzeVorgabenQuelle(() => null);
  const o4 = pr.oeffne(slug); pr.speichere(slug, o4.projekt); o4.verlauf.schliesse();
  assert.equal(JSON.parse(fs.readFileSync(datei, 'utf8')).baukasten[0].regler[39], 0.5, 'written without the graph: not cut');
  setzeVorgabenQuelle((n) => vorgabenVon(n, dir));
  const o5 = pr.oeffne(slug); assert.equal(bkReglerAuffuellen(o5.projekt.baukasten[0].regler, v)[39], 0.5); o5.verlauf.schliesse();
  // a project of the same graph that never stored the knobs reads them at the vorgabe
  const y = projekt(acht, 'fix-vorgabe');
  fs.writeFileSync(datei, JSON.stringify(y, null, 1) + '\n');
  const o3 = pr.oeffne(slug);
  assert.equal(bkReglerAuffuellen(o3.projekt.baukasten[0].regler, vorgabenVon('fix-vorgabe', dir))[39], 0);
  pr.speichere(slug, o3.projekt); o3.verlauf.schliesse();
  assert.equal(JSON.parse(fs.readFileSync(datei, 'utf8')).baukasten[0].regler.length, 8);
});

// (d) track parameters
test('a bk track parameter k33 and k64 is valid, k65 and k0 are refused', () => {
  for (const k of ['k33', 'k64']) { const p = projekt(acht); p.spuren[2].geraet.parameter[k] = 0.3; assert.equal(pruefeFehler(p), null, k); }
  for (const k of ['k65', 'k0', 'k033']) { const p = projekt(acht); p.spuren[2].geraet.parameter[k] = 0.3; assert.notEqual(pruefeFehler(p), null, k); }
});

// (e) insert stage
test('a bk insert stage: k1..k64 optional above k8, 0.5 is not written', (t) => {
  assert.deepEqual(INSERT_ARTEN.bk.parameter.map((q) => q.name), ['an', ...Array.from({ length: 64 }, (_, i) => `k${i + 1}`)]);
  const wurzel = tmpOrdner(t);
  const pr = new Projekte(wurzel);
  const { slug } = pr.lege('Stufe');
  const datei = path.join(wurzel, slug, 'project.json');
  const x = projekt(acht);
  x.spuren[2].inserts[0].werte.k33 = 0.8; x.spuren[2].inserts[0].werte.k64 = 0.2; x.spuren[2].inserts[0].werte.k40 = 0.5;
  fs.writeFileSync(datei, JSON.stringify(x, null, 1) + '\n');
  const o = pr.oeffne(slug);
  assert.equal(Object.keys(o.projekt.spuren[2].inserts[0].werte).length, 64);
  pr.speichere(slug, o.projekt); o.verlauf.schliesse();
  const w = JSON.parse(fs.readFileSync(datei, 'utf8')).spuren[2].inserts[0].werte;
  assert.deepEqual(Object.keys(w).filter((k) => Number(k.slice(1)) > 8).sort(), ['k33', 'k64']);
  const bad = projekt(acht); bad.spuren[2].inserts[0].werte.k65 = 0.5;
  assert.notEqual(pruefeFehler(bad), null);
});

// (f) lanes
test('a lane on geraet.k33 and geraet.k64 of a bk track is valid; geraet.k65 and geraet.k033 are not', () => {
  const lane = (ziel) => ({ id: 'a1', ziel, punkte: [{ beat: 0, wert: 0.2 }, { beat: 4, wert: 0.8 }] });
  for (const z of ['geraet.k33', 'geraet.k64']) { const p = projekt(acht); p.spuren[2].automation = [lane(z)]; assert.equal(pruefeFehler(p), null, z); }
  for (const z of ['geraet.k65', 'geraet.k033']) { const p = projekt(acht); p.spuren[2].automation = [lane(z)]; assert.notEqual(pruefeFehler(p), null, z); }
  assert.equal(BK_ZIELE.length, 64); assert.equal(BK_PARAMETER.length, 64); assert.equal(BK_REGLER_ZAHL, 64);
  assert.ok(AUTO_ZIELE.includes('geraet.k64')); assert.ok(!AUTO_ZIELE.includes('geraet.k65'));
  assert.equal(HK_GERAET.length, 4 + 64);
});

// (g) member parameter indices
test('gliedMakroParam: k32 -> 40 as before, k33 -> 41, k64 -> 72', () => {
  const g = { art: 'intern', name: 'bk', graph: 'x', parameter: {} };
  assert.equal(GLIED_PARAM_BK33, 41);
  assert.equal(gliedMakroParam(g, 'k32').index, 40);
  assert.equal(gliedMakroParam(g, 'k33').index, 41);
  assert.equal(gliedMakroParam(g, 'k64').index, 72);
  assert.equal(gliedMakroParam(g, 'k65'), undefined);
});
