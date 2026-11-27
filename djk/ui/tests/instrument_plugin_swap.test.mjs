// Swapping the plugin of an instrument track must not lock the new plugin with the old plugin's state file. The state path of a plugin track is
// plugins/<track>.carxs for every plugin it ever hosts; the stand-in host refuses a state file written by another plugin (as host_control.py does
// with zustand_passt_nicht). A device change writes the old plugin's state and puts the file aside, so the next plugin starts clean and a way
// back (undo) finds its own state again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { InstrumentWirte } from '../plugins/instrumentwirte.ts';
import { hostSpec } from '../plugins/hostverwaltung.ts';
import { tmpOrdner } from './support/project.mjs';
import { warteBis } from './support/proj_context.mjs';

const optionen = { quelle: 'andreas', pluginDa: () => true, pluginIndex: () => null };
const lauf = (p, b) => fuehreListeAus(p, [b], optionen).projekt;

function aufbauen(t, extra = {}) {
  const d = tmpOrdner(t, 'djk-tausch-');
  const ordner = path.join(d, 'project');
  fs.mkdirSync(ordner, { recursive: true });
  const pa = path.join(d, 'A.vst3'), pb = path.join(d, 'B.vst3');
  fs.mkdirSync(pa); fs.mkdirSync(pb);
  const stand = new Map();
  const holeVerzoegerung = new Map();   // slot -> ms the stand-in host takes to write a state
  let pid = 1000;
  const dep = {
    start: async (slot, art) => {
      extra.gestartet?.push(art);
      stand.set(slot, { lebt: true, bereit: true, art: art === 'surge' ? 'lv2' : 'plugin', kennung: art.startsWith('plugin:') ? art.slice(7) : null, pid: ++pid });
      return { code: 0, fehler: '' };
    },
    stand: (slot) => stand.get(slot) ?? { lebt: false, bereit: false, art: null, kennung: null, pid: null },
    sock: async (slot, b) => {
      const k = stand.get(slot)?.kennung;
      if (b.befehl === 'zustand_holen' && holeVerzoegerung.get(slot)) await new Promise((ok) => setTimeout(ok, holeVerzoegerung.get(slot)));
      if (b.befehl === 'zustand_holen') { fs.mkdirSync(path.dirname(b.pfad), { recursive: true }); fs.writeFileSync(b.pfad, `PLUGIN=${k}`); return { ok: true }; }
      if (b.befehl === 'zustand_setzen') return fs.readFileSync(b.pfad, 'utf8') === `PLUGIN=${k}` ? { ok: true } : { ok: false, fehler: 'zustand_passt_nicht' };
      if (b.befehl === 'info') return { ok: true, parameter: [], anzeige: true };
      return { ok: true };
    },
    ordner: () => ordner,
    log: () => {},
    ...extra,
  };
  const verw = new InstrumentWirte(dep, { pollMs: 15, zustandRuheMs: 60, fensterMs: 100, endeMs: 300, sockMs: 600 });
  t.after(() => verw.halt());
  const geraetA = { art: 'wirt', name: 'plugin', plugin: { format: 'vst3', pfad: pa, uid: 'A'.repeat(32) } };
  const geraetB = { art: 'wirt', name: 'plugin', plugin: { format: 'vst3', pfad: pb, uid: 'B'.repeat(32) } };
  const lage = () => verw.lage().map((x) => [x.spur_id, x.status, x.grund ?? null]);
  const datei = path.join(ordner, 'plugins', 's1.carxs');
  // moves the project to `geraet` on s1 and waits until the manager has settled
  const wechsle = async (p, geraet) => {
    p = lauf(p, { befehl: 'spur_aendern', spur_id: 's1', geraet });
    verw.abgleich(p);
    await warteBis(() => ['bereit', 'ausfall'].includes(verw.lage()[0]?.status), 3000);
    await verw.slotFertig(1);
    return p;
  };
  const start = async (geraet) => {
    const p = lauf(neuesProjekt('P'), { befehl: 'spur_neu', art: 'instrument', geraet });
    verw.abgleich(p);
    assert.ok(await warteBis(() => verw.lage()[0]?.status === 'bereit'), JSON.stringify(verw.lage()));
    return p;
  };
  return { verw, lage, datei, holeVerzoegerung, wechsle, start, geraetA, geraetB, kennungen: { A: `PLUGIN=${hostSpec(geraetA.plugin)}`, B: `PLUGIN=${hostSpec(geraetB.plugin)}` } };
}

test('plugin A -> plugin B on the same track: B becomes ready (not ausfall zustand_passt_nicht)', async (t) => {
  const z = aufbauen(t);
  const p = await z.start(z.geraetA);
  await z.wechsle(p, z.geraetB);
  assert.deepEqual(z.lage(), [['s1', 'bereit', null]], 'the new plugin B must not be locked by the state file plugin A left at the shared path');
});

test('plugin A -> Surge -> plugin B: B becomes ready', async (t) => {
  const z = aufbauen(t);
  let p = await z.start(z.geraetA);
  p = lauf(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'wirt' } });   // Surge
  z.verw.abgleich(p);
  await warteBis(() => z.verw.lage().length === 0, 3000);
  await z.verw.slotFertig(1);
  p = lauf(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: z.geraetB });
  z.verw.abgleich(p);
  assert.ok(await warteBis(() => z.verw.lage()[0]?.status === 'bereit' || z.verw.lage()[0]?.status === 'ausfall', 3000));
  await z.verw.slotFertig(1);
  assert.deepEqual(z.lage(), [['s1', 'bereit', null]]);
});

test('plugin A -> B -> A: the state of A comes back (a way back keeps the sound), B and a third swap stay free', async (t) => {
  const z = aufbauen(t);
  let p = await z.start(z.geraetA);
  p = await z.wechsle(p, z.geraetB);
  assert.deepEqual(z.lage(), [['s1', 'bereit', null]]);
  assert.ok(!fs.existsSync(z.datei) || fs.readFileSync(z.datei, 'utf8') !== z.kennungen.A, 'the file of A was put aside, not handed to B');
  p = await z.wechsle(p, z.geraetA);
  assert.deepEqual(z.lage(), [['s1', 'bereit', null]]);
  assert.equal(fs.readFileSync(z.datei, 'utf8'), z.kennungen.A, 'A got its own state file back');
  p = await z.wechsle(p, z.geraetB);
  assert.deepEqual(z.lage(), [['s1', 'bereit', null]]);
});

test('closing the project is not a device change: nothing is put aside', async (t) => {
  const z = aufbauen(t);
  await z.start(z.geraetA);
  z.verw.abgleich(null);
  await z.verw.slotFertig(1);
  assert.ok(!fs.existsSync(path.dirname(z.datei)) || fs.readdirSync(path.dirname(z.datei)).every((f) => !f.endsWith('.alt')));
});

test('the same plugin moved to another slot: the state file stays in place (nothing is put aside, a late save of the old slot cannot rename it away)', async (t) => {
  const z = aufbauen(t);
  let p = await z.start(z.geraetA);
  z.holeVerzoegerung.set(1, 250);   // the old slot's save of a large state outlasts the start on the new slot
  p = lauf(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: { ...z.geraetA, slot: 2 } });
  z.verw.abgleich(p);
  assert.ok(await warteBis(() => z.verw.lage()[0]?.slot === 2 && z.verw.lage()[0]?.status === 'bereit', 3000), JSON.stringify(z.verw.lage()));
  await z.verw.slotFertig(1);
  await z.verw.slotFertig(2);
  assert.deepEqual(z.lage(), [['s1', 'bereit', null]]);
  assert.equal(fs.readFileSync(z.datei, 'utf8'), z.kennungen.A, 'the track keeps its state file at the path the project names');
  assert.deepEqual(fs.readdirSync(path.dirname(z.datei)).filter((f) => f.endsWith('.alt')), [], 'no file was put aside');
});

test('a later VST3 class starts its host with @<klasse>', async (t) => {
  const gestartet = [];
  const z = aufbauen(t, { klasse: () => 5, gestartet });
  await z.start(z.geraetA);
  assert.deepEqual(z.lage(), [['s1', 'bereit', null]]);
  assert.deepEqual(gestartet, [`plugin:${hostSpec(z.geraetA.plugin)}@5`]);
});
