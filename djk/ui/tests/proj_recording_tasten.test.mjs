// Plan addendum N1: the keys follow the focus. The reconciler of the recording area treats the track of the TastenArm as MIDI-armed for the core (/k/rec/spur,
// eingang 30) in addition to the arms of the project: added and taken back with the focus, the owner's own arm untouched, nothing sent during a run, the
// project (revision, file) never touched. Mock core context, as in proj_recording_sync.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../areas/proj/area.ts';
import { aufnahmeBereich } from '../areas/proj/recording.ts';
import { neuerTastenArm, tastenSenke } from '../areas/controller/tasten.ts';
import { pruefKontext, warteBis } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';

const ok = { status: 3, grund: '' };

// Tracks: [0] instrument (internal device), [1] instrument, [2] audio. e.abgelehnt as in the sync test.
async function bereit(t, { rec = [{ status: 1, grund: '' }, { status: 2, grund: '' }] } = {}) {
  const k = pruefKontext();
  k.regel = () => ok;
  const roh = k.warteQuittung.bind(k), zaehler = new Map();
  k.warteQuittung = async (id) => {
    const g = k.gesendet.find((x) => x.id === id);
    if (g?.adresse !== '/k/rec/start') return roh(id);
    const n = (zaehler.get(id) ?? 0) + 1;
    zaehler.set(id, n);
    return rec[Math.min(n, rec.length) - 1];
  };
  const d = tmpOrdner(t, 'djk-tasten-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const tasten = neuerTastenArm();
  const br = aufnahmeBereich(k, b.zugang, { fristMs: 60, tasten });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung, a = br.aufnahme;
  await s.neu('T', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  for (const art of ['instrument', 'instrument', 'audio']) {
    await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Spur', befehle: [{ befehl: 'spur_neu', art, name: `${art}${s.aktuell().j.projekt.spuren.length}` }] }, 'andreas');
  }
  await a.abgeglichen();
  k.leere();
  const spur = (i) => s.aktuell().j.projekt.spuren[i];
  const aendere = async (befehle, label = 'x') => {
    const r = await s.aendern({ rev: s.aktuell().j.projekt.rev, label, befehle }, 'andreas');
    await a.abgeglichen();
    return r;
  };
  const fokus = async (id) => { tasten.setze(id); await a.abgeglichen(); };
  const msgs = () => k.an('/k/rec/spur').map((m) => [m.felder.spur, m.felder.scharf, m.felder.eingang, m.felder.modus, m.felder.monitor]);
  const projektDatei = () => { const o = b.zugang.offen(); return JSON.stringify(o.projekt); };
  const kern = (adr, f) => { b.ereignis(adr, f); a.ereignis(adr, f); };
  return { k, b, s, a, d, kern, tasten, spur, aendere, fokus, msgs, projektDatei };
}

test('tastenSenke mirrors the sinks of the core: internal device and rack yes, host track only with a slot, audio no', () => {
  assert.equal(tastenSenke({ art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'g', parameter: {} } }), true);
  assert.equal(tastenSenke({ art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'k' } }), true);
  assert.equal(tastenSenke({ art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } }), true);
  assert.equal(tastenSenke({ art: 'instrument', geraet: { art: 'rack', glieder: [], kette: 0 } }), true);
  assert.equal(tastenSenke({ art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 2 } }), true);
  assert.equal(tastenSenke({ art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 3 } }), false, 'slot beyond the host ports');
  assert.equal(tastenSenke({ art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }), false, 'no slot');
  assert.equal(tastenSenke({ art: 'instrument' }), false, 'no device');
  assert.equal(tastenSenke({ art: 'audio' }), false);
});

test('the focus arm: one /k/rec/spur for the focused instrument track, the old one is taken back when the focus moves; project and revision stay untouched', async (t) => {
  const e = await bereit(t);
  const rev = e.s.aktuell().j.projekt.rev, vorher = e.projektDatei();
  await e.fokus(e.spur(0).id);
  assert.deepEqual(e.msgs(), [[1, 1, 30, 0, 1]]);
  assert.deepEqual(e.a.imKernStand(1), { eingang: 30, modus: 0, monitor: 1 });
  e.k.leere();
  await e.fokus(e.spur(1).id);
  assert.deepEqual(e.msgs().sort((x, y) => x[0] - y[0]), [[1, 0, 0, 0, 1], [2, 1, 30, 0, 1]], 'the old arm goes, the new one comes');
  assert.equal(e.a.imKernStand(1), null);
  e.k.leere();
  await e.fokus(null);
  assert.deepEqual(e.msgs(), [[2, 0, 0, 0, 1]], 'no focus: the arm is taken back');
  assert.equal(e.s.aktuell().j.projekt.rev, rev, 'no project revision');
  assert.equal(e.projektDatei(), vorher, 'nothing written into the project');
  assert.equal(e.s.aktuell().j.projekt.spuren.some((s) => s.aufnahme?.scharf), false, 'no track is armed in the project');
});

test('a track without a sink (audio) or a focus on a track that does not exist sends nothing', async (t) => {
  const e = await bereit(t);
  await e.fokus(e.spur(2).id);
  await e.fokus('s99');
  assert.deepEqual(e.msgs(), []);
});

test('the owner\'s own arm is never taken away and nothing extra is sent for it; when he disarms while it is in front the focus arm takes over', async (t) => {
  const e = await bereit(t);
  const id = e.spur(0).id;
  await e.aendere([{ befehl: 'spur_aendern', spur_id: id, eingang: { art: 'midi' }, arm: true }], 'Arm');
  assert.deepEqual(e.msgs(), [[1, 1, 30, 0, 1]]);
  e.k.leere();
  await e.fokus(id);
  assert.deepEqual(e.msgs(), [], 'already armed by the project: nothing extra');
  await e.fokus(e.spur(1).id);
  assert.deepEqual(e.msgs(), [[2, 1, 30, 0, 1]], 'the owner arm of track 1 stays armed when the focus leaves it');
  assert.deepEqual(e.a.imKernStand(1), { eingang: 30, modus: 0, monitor: 1 });
  e.k.leere();
  await e.aendere([{ befehl: 'spur_aendern', spur_id: id, arm: false }], 'Disarm');
  assert.deepEqual(e.msgs(), [[1, 0, 0, 0, 1]], 'a track that is not in front goes unarmed with the owner');
});

test('a deleted focus track drops the arm', async (t) => {
  const e = await bereit(t);
  await e.fokus(e.spur(1).id);
  e.k.leere();
  await e.aendere([{ befehl: 'spur_loeschen', spur_id: e.spur(1).id }], 'Delete');
  assert.deepEqual(e.msgs(), [[2, 0, 0, 0, 1]]);
  assert.deepEqual(e.a.schmutzig(), []);
});

test('during a recording run nothing moves; the focus arm is not part of the take, is taken back before it and goes out again after the run', async (t) => {
  const e = await bereit(t);
  const keys = e.spur(0).id, owner = e.spur(2).id;   // the owner records the audio track
  await e.aendere([{ befehl: 'spur_aendern', spur_id: owner, eingang: { art: 'intern', name: 'erz/1' }, arm: true }], 'Arm');
  await e.fokus(keys);
  assert.deepEqual(e.a.imKernStand(1), { eingang: 30, modus: 0, monitor: 1 });
  e.k.leere();
  const r = await e.a.start({ von_beat: 0 }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.deepEqual(r.j.spuren.map((x) => x.id), [owner], 'the take lists the owner\'s track only');
  assert.deepEqual(e.msgs().filter((m) => m[0] === 1), [[1, 0, 0, 0, 1]], 'the focus arm is taken back before the take');
  assert.equal(e.a.imKernStand(1), null);
  e.k.leere();
  await e.fokus(e.spur(1).id);
  await e.fokus(null);
  await e.fokus(keys);
  assert.deepEqual(e.msgs(), [], 'during the run the focus moves nothing');
  assert.deepEqual(e.a.schmutzig(), [1], 'the focus track waits');
  const kennung = r.j.kennung;
  const f = path.join(e.b.zugang.arbeitsordner(), `aufnahme-3-${kennung}.f32`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(4800 * 8, 1));
  e.kern('/e/aufnahme', { spur: 3, kennung, status: 0, frames: 4800, start_sample: 0n, luecken: 0 });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 2000), 'the run is over');
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs(), [[1, 1, 30, 0, 1]], 'after the run the arm of the focus track goes out');
  assert.deepEqual(e.a.schmutzig(), []);
});
