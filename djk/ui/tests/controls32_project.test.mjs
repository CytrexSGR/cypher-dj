// 32 knobs, page side: stored projects are the one irreversible place. An old project (8 numbers per channel snapshot, k1..k8 on a
// bk track and on a bk insert stage) loads unchanged, is padded to 32 with the kern default 0.5 and is written back in the old shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Projekte, setzeVorgabenQuelle } from '../project/storage.ts';
import { pruefeProjekt, pruefeFehler, BK_PARAMETER, BK_ZIELE, AUTO_ZIELE, GLIED_PARAM_BK0, GLIED_PARAM_BK9, GLIED_PARAM_GAIN_DB, gliedMakroParam } from '../project/model.ts';
import { BK_REGLER_ZAHL, BK_REGLER_MIN, bkReglerAuffuellen, bkReglerKanonisch, bkSetzen } from '../project/modular.ts';
import { INSERT_ARTEN } from '../project/insert_key.ts';
import { specProjekt, tmpOrdner } from './support/project.mjs';

// A project file as the pre-32 build wrote it: the literal old format, nothing generated from the current tables.
const altesProjekt = () => {
  const p = specProjekt();
  p.format = 'cypherdj-projekt/2'; p.gruppen = []; p.master = { fader_db: 0 };
  p.spuren[2] = { id: 's3', nr: 3, name: 'Pad', farbe: '#9b59d0', art: 'instrument', fader_db: 0, pan: 0, mute: false, solo: false, clips: [],
    geraet: { art: 'intern', name: 'bk', graph: 'juno-pad', parameter: { k1: 0.2, k8: 1 } },
    inserts: [{ id: 'i1', art: 'bk', slot: 1, an: true, graph: 'fx-bandecho',
      werte: { k1: 0.5, k2: 0.5, k3: 0.5, k4: 0.5, k5: 0.5, k6: 0.5, k7: 0.5, k8: 0.25 } }] };
  p.baukasten = [{ id: 'erz2', graph: 'juno-pad-dyn', regler: [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.25] }];
  return p;
};

test('32 knobs: the generated insert table has k1..k32 and the model constants agree', () => {
  assert.equal(BK_REGLER_ZAHL, 64); assert.equal(BK_REGLER_MIN, 8);
  assert.deepEqual(INSERT_ARTEN.bk.parameter.map((q) => q.name), ['an', ...Array.from({ length: 64 }, (_, i) => `k${i + 1}`)]);
  assert.equal(BK_PARAMETER.length, 64);
  assert.deepEqual([...BK_ZIELE], BK_PARAMETER.map((k) => `geraet.${k}`));
  for (const k of ['geraet.k9', 'geraet.k32']) assert.ok(AUTO_ZIELE.includes(k), `${k} is a lane target`);
  assert.ok(!AUTO_ZIELE.includes('geraet.k65'));
});

test('32 knobs: member parameter indices keep 8..15 and gain_db 16, k9..k32 take 17..40', () => {
  const g = { art: 'intern', name: 'bk', graph: 'x', parameter: {} };
  assert.equal(GLIED_PARAM_BK0, 8); assert.equal(GLIED_PARAM_GAIN_DB, 16); assert.equal(GLIED_PARAM_BK9, 17);
  assert.equal(gliedMakroParam(g, 'k1').index, 8);
  assert.equal(gliedMakroParam(g, 'k8').index, 15);
  assert.equal(gliedMakroParam(g, 'gain_db').index, 16);
  assert.equal(gliedMakroParam(g, 'k9').index, 17);
  assert.equal(gliedMakroParam(g, 'k32').index, 40);
  assert.equal(gliedMakroParam(g, 'k65'), undefined);
});

test('32 knobs: snapshot regler 8..64 numbers are valid, 7 and 65 are not, values stay 0..1', () => {
  for (const n of [8, 9, 32, 64]) {
    const p = altesProjekt(); p.baukasten[0].regler = Array(n).fill(0.4);
    assert.equal(pruefeFehler(p), null, `${n} numbers`);
  }
  for (const n of [7, 65]) {
    const p = altesProjekt(); p.baukasten[0].regler = Array(n).fill(0.4);
    assert.match(pruefeFehler(p) ?? '', /baukasten.*8\.\.64 numbers expected/, `${n} numbers refused`);
  }
  const p = altesProjekt(); p.baukasten[0].regler = Array(64).fill(0.5); p.baukasten[0].regler[63] = 1.5;
  assert.match(pruefeFehler(p) ?? '', /regler\[63\]/);
});

test('32 knobs: pad and canonical form of the snapshot array', () => {
  const alt = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const L = Array(64).fill(0.5);   // a known graph without vorgabe
  const voll = bkReglerAuffuellen(alt);
  assert.equal(voll.length, 64); assert.deepEqual(voll.slice(0, 8), alt); assert.ok(voll.slice(8).every((w) => w === 0.5));
  assert.deepEqual(bkReglerKanonisch(alt, L), alt, 'an old array stays at 8');
  assert.deepEqual(bkReglerKanonisch(voll, L), alt, 'padded array goes back to 8');
  const k9 = [...alt, 0.9]; assert.equal(bkReglerKanonisch(k9, L).length, 9, 'knob 9 touched: 9 numbers');
  const k32 = bkReglerAuffuellen(alt); k32[31] = 0.1; assert.equal(bkReglerKanonisch(k32, L).length, 32, 'knob 32 touched: 32 numbers');
  assert.equal(bkReglerKanonisch(Array(64).fill(0.5), L).length, 8, 'all default: the minimum of 8, never shorter');
  const mitte = Array(64).fill(0.5); mitte[11] = 0.7; assert.equal(bkReglerKanonisch(mitte, L).length, 12, 'trailing 0.5 are cut, inner ones stay');
  // bk_setzen writes the canonical form (graph known)
  setzeVorgabenQuelle(() => L);
  try {
  const r = bkSetzen([], { kanal: 'erz/2', graph: 'x', regler: Array(64).fill(0.5) });
  assert.equal(r.liste[0].regler.length, 8);
  const r2 = bkSetzen([], { kanal: 'erz/2', graph: 'x' });
  assert.equal(r2.liste[0].regler.length, 8); assert.ok(r2.liste[0].regler.every((w) => w === 0.5));
  } finally { setzeVorgabenQuelle(null); }
});

test('32 knobs: an old project loads as is and is written back byte for byte in the old shape', (t) => {
  const wurzel = tmpOrdner(t);
  const pr = new Projekte(wurzel);
  const { slug } = pr.lege('Alt');
  const datei = path.join(wurzel, slug, 'project.json');
  fs.writeFileSync(datei, JSON.stringify(altesProjekt(), null, 1) + '\n');
  // the writer's own form is the baseline: save once, then reopen and save again
  const o0 = pr.oeffne(slug); pr.speichere(slug, o0.projekt); o0.verlauf.schliesse();
  const b0 = fs.readFileSync(datei);
  const o = pr.oeffne(slug);
  const p = o.projekt;
  // loaded: the snapshot array is as stored, the readers pad; the bk stage holds 32 values in memory
  assert.equal(p.baukasten[0].regler.length, 8);
  assert.equal(bkReglerAuffuellen(p.baukasten[0].regler).length, 64);
  const stufe = p.spuren[2].inserts[0];
  assert.equal(Object.keys(stufe.werte).length, 64, 'stage values padded to k1..k64 in memory');
  assert.equal(stufe.werte.k8, 0.25); assert.equal(stufe.werte.k9, 0.5); assert.equal(stufe.werte.k32, 0.5); assert.equal(stufe.werte.k64, 0.5);
  assert.deepEqual(p.spuren[2].geraet.parameter, { k1: 0.2, k8: 1 });
  pr.speichere(slug, p);
  o.verlauf.schliesse();
  assert.ok(fs.readFileSync(datei).equals(b0), 'bytes unchanged');
  const roh = JSON.parse(b0.toString());
  assert.equal(roh.baukasten[0].regler.length, 8, 'written: 8 numbers');
  assert.deepEqual(Object.keys(roh.spuren[2].inserts[0].werte).sort(), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'], 'written: stage k1..k8 only');
});

test('32 knobs: a touched knob 9 and 32 are written and read back', (t) => {
  const wurzel = tmpOrdner(t);
  const pr = new Projekte(wurzel);
  const { slug } = pr.lege('Neu');
  const datei = path.join(wurzel, slug, 'project.json');
  setzeVorgabenQuelle(() => Array(64).fill(0.5)); t.after(() => setzeVorgabenQuelle(null));   // a known graph without vorgabe
  const x = altesProjekt();
  x.baukasten[0].regler = bkReglerAuffuellen(x.baukasten[0].regler); x.baukasten[0].regler[8] = 0.9; x.baukasten[0].regler[31] = 0.1;
  x.spuren[2].geraet.parameter.k9 = 0.3; x.spuren[2].geraet.parameter.k32 = 0.7;
  x.spuren[2].inserts[0].werte.k9 = 0.8; x.spuren[2].inserts[0].werte.k32 = 0.2;
  fs.writeFileSync(datei, JSON.stringify(x, null, 1) + '\n');
  const o = pr.oeffne(slug); pr.speichere(slug, o.projekt); o.verlauf.schliesse();
  const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.equal(roh.baukasten[0].regler.length, 32); assert.equal(roh.baukasten[0].regler[8], 0.9); assert.equal(roh.baukasten[0].regler[31], 0.1);
  assert.equal(roh.spuren[2].geraet.parameter.k32, 0.7);
  const w = roh.spuren[2].inserts[0].werte;
  assert.deepEqual(Object.keys(w).filter((k) => /^k(9|[1-5][0-9]|6[0-4])$/.test(k)).sort(), ['k32', 'k9']);
  const o2 = pr.oeffne(slug);
  assert.equal(o2.projekt.spuren[2].inserts[0].werte.k32, 0.2);
  assert.equal(o2.projekt.spuren[2].inserts[0].werte.k10, 0.5);
  o2.verlauf.schliesse();
});

test('32 knobs: bk track and stage refuse knob 65, 0 and 09', () => {
  for (const k of ['k65', 'k0', 'k09']) {
    const p = altesProjekt(); p.spuren[2].geraet.parameter[k] = 0.5;
    assert.notEqual(pruefeFehler(p), null, `track parameter ${k}`);
    const q = altesProjekt(); q.spuren[2].inserts[0].werte[k] = 0.5;
    assert.notEqual(pruefeFehler(q), null, `stage value ${k}`);
  }
  const ok = altesProjekt(); ok.spuren[2].geraet.parameter.k32 = 1;
  assert.ok('projekt' in pruefeProjekt(ok));
});

test('32 knobs: a lane on geraet.k9 and geraet.k32 of a bk track is valid, k65 is not', () => {
  const lane = (ziel) => ({ id: 'a1', ziel, punkte: [{ beat: 0, wert: 0.2 }, { beat: 4, wert: 0.8 }] });
  for (const z of ['geraet.k9', 'geraet.k32']) {
    const p = altesProjekt(); p.spuren[2].automation = [lane(z)];
    assert.equal(pruefeFehler(p), null, z);
  }
  const p = altesProjekt(); p.spuren[2].automation = [lane('geraet.k65')];
  assert.notEqual(pruefeFehler(p), null);
});
