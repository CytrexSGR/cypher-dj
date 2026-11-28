// Strand 6 task 2.1: the shared modulation formula against the reference vectors, the live /zustand/mod output in the lage and in the
// GET /proj/auto?mod_id answer (the session, fed by hand: the core event comes from task 1.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modVersatz, modWert } from '../project/mod_formula.ts';
import { KernLage } from '../areas/proj/state.ts';
import { sitzung } from './support/proj_context.mjs';

const REF = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'contract', 'mod_ref.json'), 'utf8'));
const mod = (s, nr, wert) => s.ereignis('/zustand/mod', { nr, wert });

test('modVersatz equals the reference rows; modWert clamps once at the end', () => {
  assert.ok(REF.versatz.length >= 6);
  for (const [out, tiefe, uni, erwartet] of REF.versatz) assert.ok(Math.abs(modVersatz(out, tiefe, uni) - erwartet) < 1e-6, `${out} ${tiefe} ${uni}`);
  const b = { min: -200, max: 6 };
  assert.equal(modWert(-3, -6, b), -9);
  assert.equal(modWert(4, 3, b), 6, 'clamped to the maximum');
  assert.equal(modWert(-199, -6, b), -200, 'clamped to the minimum');
});

test('KernLage keeps the latest output per nr and forgets it on a new core generation', () => {
  const l = new KernLage();
  assert.equal(l.modAusgang(1), null);
  l.nimm('/k/willkommen', { generation: 1 });
  l.nimm('/zustand/mod', { nr: 1, wert: 0.5 }); l.nimm('/zustand/mod', { nr: 1, wert: -0.25 }); l.nimm('/zustand/mod', { nr: 2, wert: 1 });
  assert.equal(l.modAusgang(1), -0.25); assert.equal(l.modAusgang(2), 1);
  l.nimm('/e/neustart', { generation: 1, sample: 0n }); assert.equal(l.modAusgang(1), -0.25, 'same generation: kept');
  l.nimm('/e/neustart', { generation: 2, sample: 0n }); assert.equal(l.modAusgang(1), null, 'new generation: cleared');
});

test('proj_lage lists ausgang (null without a core event, the fed value after one); GET /proj/auto?mod_id gives base, offset and clamped value', async (t) => {
  const { s } = sitzung(t);
  await s.neu('Mod Lage', 'andreas');
  const r = await s.aendern({ rev: 0, label: 'Mod', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }, { befehl: 'return_neu', name: 'Hall' },
    { befehl: 'mod_neu', takt: 4, ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -6 }, { strang_id: 's2', ziel: 'pan', tiefe: 1, polaritaet: 'uni' },
      { strang_id: 'r1', ziel: 'fader', tiefe: 12 }] }] }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const lage = () => s.aktuell('noten_zahl').j.modulatoren[0];
  // no core event: null everywhere
  assert.equal(lage().ausgang, null);
  let a = s.modAutoLage('m1').j;
  assert.equal(a.ausgang, null); assert.equal(a.nr, 1); assert.equal(a.mod_id, 'm1');
  assert.deepEqual(a.ziele.map((z) => [z.versatz, z.wert]), [[null, null], [null, null], [null, null]]);
  assert.deepEqual(a.ziele.map((z) => z.basis), [0, 0, 0], 'the base is the project value');
  // out 0.5: fader -3 dB, pan unipolar 1 * 0.75, return fader +6 dB
  mod(s, 1, 0.5);
  assert.equal(lage().ausgang, 0.5);
  a = s.modAutoLage('m1').j;
  assert.equal(a.ausgang, 0.5);
  assert.deepEqual(a.ziele.map((z) => [z.strang_id, z.ziel, z.einheit, z.basis, z.versatz, z.wert, z.tiefe, z.polaritaet]),
    [['s1', 'fader', 'dB', 0, -3, -3, -6, 'bi'], ['s2', 'pan', 'pan', 0, 0.75, 0.75, 1, 'uni'], ['r1', 'fader', 'dB', 0, 6, 6, 12, 'bi']]);
  // base from the last /e/regler row; the offset stays on top and the result is clamped to the fader maximum (+6)
  s.ereignis('/e/regler', { pfad: 'ret/1/fader', wert: 3, halter: 'mensch', sample: 0n, beat: 0 });
  a = s.modAutoLage('m1').j;
  assert.deepEqual([a.ziele[2].basis, a.ziele[2].versatz, a.ziele[2].wert], [3, 6, 6], 'clamped');
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -10, halter: 'mensch', sample: 0n, beat: 0 });
  assert.equal(s.modAutoLage('m1').j.ziele[0].wert, -13, 'fader row moves the base');
  // unknown modulator
  assert.throws(() => s.modAutoLage('m9'), (e) => e.code === 404 && e.fehler === 'mod_unbekannt', 'mod_unbekannt');
});

test('a follower is listed with its own fields and unipolar targets; /proj/auto computes tiefe * envelope (core reports 2*out-1)', async (t) => {
  const { s } = sitzung(t);
  await s.neu('Folger Lage', 'andreas');
  const r = await s.aendern({ rev: 0, label: 'Folger', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'mod_neu', art: 'folger', quelle: 's1', angriff_ms: 2, abfall_ms: 80, empfindlich_db: 3, ziele: [{ strang_id: 's2', ziel: 'fader', tiefe: -12 }] }] }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const m = s.aktuell('noten_zahl').j.modulatoren[0];
  assert.equal(m.art, 'folger');
  assert.deepEqual([m.quelle, m.angriff_ms, m.abfall_ms, m.empfindlich_db], ['s1', 2, 80, 3]);
  for (const k of ['form', 'takt', 'hz', 'phase']) assert.ok(!(k in m), `no LFO field ${k}`);
  assert.equal(m.ziele[0].polaritaet, 'uni');
  mod(s, 1, -1);   // silence
  assert.ok(Math.abs(s.modAutoLage('m1').j.ziele[0].versatz) < 1e-9);
  mod(s, 1, 0);    // envelope 0.5
  let z = s.modAutoLage('m1').j.ziele[0];
  assert.deepEqual([z.versatz, z.polaritaet], [-6, 'uni']);
  mod(s, 1, 1);    // full envelope
  assert.equal(s.modAutoLage('m1').j.ziele[0].versatz, -12);
});
