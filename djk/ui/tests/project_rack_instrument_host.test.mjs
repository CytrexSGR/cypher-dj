// Package 1.9 U7 T4 (spec E3, E10, E15, 4.4): a Surge member of a rack uses a production slot: slot accounting over tracks and members, freeze,
// export and the host check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { pruefeProjekt, pruefeFehler, wirtSlots } from '../project/model.ts';
import { brauchtFreeze, istWirt } from '../project/freeze.ts';
import { wende } from '../project/patch.ts';
import { uebersetze } from '../project/playback.ts';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { alsAntwort, exportSicht } from '../areas/proj/output.ts';
import { starteWirtProzess, schreibeWirtStatus } from './support/instrument_host_process.mjs';
import { specProjekt } from './support/project.mjs';

const zwei = () => { const p = specProjekt(); p.format = 'cypherdj-projekt/2'; p.gruppen = []; p.master = { fader_db: 0 }; p.spuren = []; return p; };
const rb = (parameter = {}) => ({ art: 'intern', name: 'rb338', parameter });
const surge = (slot) => ({ art: 'wirt', name: 'surge', ...(slot ? { slot } : {}) });
const rackG = (glieder) => ({ art: 'rack', glieder, kette: 0 });
const spurMit = (i, geraet, extra = {}) => ({ id: `r${i}`, nr: i, name: `Rack ${i}`, farbe: '#3b8de0', art: 'instrument', geraet, fader_db: 0, pan: 0,
  mute: false, solo: false, clips: [], ...extra });
const mitSpuren = (...spuren) => { const p = zwei(); p.spuren = spuren; return p; };
const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const aendere = (p, ...b) => fuehreListeAus(p, b);
const json = (x) => JSON.stringify(x);
const noten = (n = 1) => ({ id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: Array.from({ length: n }, (_, i) => ({ id: `n${i + 1}`, beat: i, laenge: 1, ton: 60, vel: 90 })) });
const rackMitSurge = (extra = {}) => spurMit(1, rackG([{ id: 'g1', geraet: rb() }, { id: 'g2', geraet: surge(2) }]), { freeze: null, ...extra });

test('T4 slots: two Surge tracks + a Surge member -> slot_belegt; one track + one member get slots 1 and 2; undo restores', () => {
  const zweiSurge = aendere(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } }, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } });
  const r = aendere(zweiSurge.projekt, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: rb() }] } }).projekt;
  const rackId = r.spuren.at(-1).id;
  lehntAb(() => aendere(r, { befehl: 'rack_glied_setzen', spur_id: rackId, glied: { geraet: { art: 'wirt' } } }), 'slot_belegt');
  lehntAb(() => aendere(r, { befehl: 'rack_glied_setzen', spur_id: rackId, glied: { geraet: { art: 'wirt', slot: 1 } } }), 'slot_belegt');
  // one Surge track and a rack with a Surge member
  const p = aendere(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } },
    { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: rb() }, { id: 'g2', geraet: { art: 'wirt' } }] } }).projekt;
  const s = p.spuren.at(-1);
  assert.deepEqual([p.spuren.at(-2).geraet.slot, s.geraet.glieder[1].geraet.slot], [1, 2]);
  assert.equal(s.freeze, null, 'a rack with a Surge member carries the freeze field');
  assert.ok('projekt' in pruefeProjekt(JSON.parse(json(p))));
  // a third Surge anywhere: a new track
  lehntAb(() => aendere(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } }), 'slot_belegt');
  // a second member in the same rack list takes the other slot (siblings count)
  const zweiGl = aendere(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: { art: 'wirt' } }, { id: 'g2', geraet: { art: 'wirt' } }] } }).projekt;
  assert.deepEqual(zweiGl.spuren[0].geraet.glieder.map((m) => m.geraet.slot), [1, 2]);
  lehntAb(() => aendere(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: surge(1) }, { id: 'g2', geraet: surge(1) }] } }), 'slot_belegt');
  // replacing the member that holds slot 2 keeps its slot available; converting the rack to a plain device frees both
  const ersetzt = aendere(p, { befehl: 'rack_glied_setzen', spur_id: s.id, glied: { id: 'g2', geraet: { art: 'wirt' } } });
  assert.equal(ersetzt.projekt.spuren.at(-1).geraet.glieder[1].geraet.slot, 2);
  const roh = aendere(p, { befehl: 'spur_aendern', spur_id: s.id, geraet: rb() });
  assert.equal(roh.projekt.spuren.at(-1).freeze, undefined, 'no Surge slot left: the freeze field goes');
  assert.deepEqual(wende(roh.projekt, roh.zurueck), p, 'undo restores the project (key order of freeze aside)');
  assert.equal(wirtSlots(roh.projekt.spuren.at(-1)).length, 0);
  // the new track after the conversion may take slot 2
  assert.equal(aendere(roh.projekt, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } }).projekt.spuren.at(-1).geraet.slot, 2);
});

test('T4 a Surge track converts to a rack with the Surge as g1 (keeps its slot, gets the freeze field)', () => {
  const p = aendere(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } }).projekt;
  const e = aendere(p, { befehl: 'spur_aendern', spur_id: p.spuren[0].id, geraet: { art: 'rack' } });
  const s = e.projekt.spuren[0];
  assert.deepEqual([s.geraet.art, s.geraet.glieder[0].id, s.geraet.glieder[0].geraet.slot], ['rack', 'g1', 1]);
  assert.equal(s.freeze, null);
  assert.deepEqual(wende(e.projekt, e.zurueck), p);
  assert.ok('projekt' in pruefeProjekt(JSON.parse(json(e.projekt))));
});

test('T4 model: the same slot twice in a file is refused across tracks and members; wirtSlots/istWirt/brauchtFreeze', () => {
  const doppelt = mitSpuren(spurMit(1, surge(1), { freeze: null }), spurMit(2, rackG([{ id: 'g1', geraet: surge(1) }]), { freeze: null }));
  assert.match(pruefeFehler(doppelt) ?? '', /doppelt/);
  const zwei2 = mitSpuren(spurMit(1, rackG([{ id: 'g1', geraet: surge(2) }, { id: 'g2', geraet: surge(2) }]), { freeze: null }));
  assert.match(pruefeFehler(zwei2) ?? '', /doppelt/);
  assert.equal(pruefeFehler(mitSpuren(spurMit(1, surge(1), { freeze: null }), spurMit(2, rackG([{ id: 'g1', geraet: surge(2) }]), { freeze: null }))), null);
  // the freeze field: required with a Surge member, refused without
  assert.match(pruefeFehler(mitSpuren(spurMit(1, rackG([{ id: 'g1', geraet: surge(1) }])))) ?? '', /freeze/);
  assert.match(pruefeFehler(mitSpuren(spurMit(1, rackG([{ id: 'g1', geraet: rb() }]), { freeze: null }))) ?? '', /freeze/);
  assert.equal(pruefeFehler(mitSpuren(spurMit(1, rackG([{ id: 'g1', geraet: rb() }])))), null);
  // member parameters
  assert.match(pruefeFehler(mitSpuren(spurMit(1, rackG([{ id: 'g1', geraet: { ...surge(1), parameter: { cutoff: 1 } } }]), { freeze: null }))) ?? '',
    /surge member parameters are not mirrored in 1\.9/);
  // accounting helpers
  const r = rackMitSurge();
  assert.deepEqual(wirtSlots(r), [2]);
  assert.deepEqual(wirtSlots(spurMit(2, surge(1), { freeze: null })), [1]);
  assert.deepEqual(wirtSlots(spurMit(3, rb())), []);
  assert.equal(istWirt(r), true); assert.equal(istWirt(spurMit(3, rb())), false);
  assert.equal(istWirt(spurMit(3, rackG([{ id: 'g1', geraet: rb() }]))), false);
  const mitNoten = { ...r, clips: [noten()] };
  assert.equal(brauchtFreeze(mitNoten), true, 'a rack with a Surge member and notes needs a freeze');
  assert.equal(brauchtFreeze(r), false, 'silent');
  assert.equal(brauchtFreeze({ ...spurMit(1, rackG([{ id: 'g1', geraet: rb() }, { id: 'g2', geraet: rb() }])), clips: [noten()] }), false, 'no Surge member: no freeze');
  assert.equal(brauchtFreeze({ ...mitNoten, freeze: { datei: 'x', sha256: 'a'.repeat(64), frames: 1, von_beat: 0 } }), false, 'already frozen');
});

test('T4 error case: a Surge member with parameter is refused argument_ungueltig, text says so; the mirror is not touched', () => {
  const p = mitSpuren(spurMit(1, rackG([{ id: 'g1', geraet: rb() }])));
  for (const b of [
    { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: { art: 'wirt', parameter: { cutoff: 1 } } } },
    { befehl: 'spur_aendern', spur_id: 'r1', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: { art: 'wirt', parameter: { cutoff: 1 } } }] } },
    { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: { art: 'wirt', parameter: { cutoff: 1 } } }] } },
  ]) {
    assert.throws(() => aendere(p, b), (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig' && /surge member parameters are not mirrored in 1\.9/.test(e.message + (e.text ?? '')));
  }
});

test('T4 translator: unfrozen rack keeps the Surge member live; frozen it is replaced by its audio clip', () => {
  const r = rackMitSurge({ clips: [noten()] });
  const p = mitSpuren(r);
  const opt = { nr: 1, frames: 0, audioOrdner: undefined, arbeitsordner: '/arbeit', existiert: () => true };
  const live = uebersetze(p, opt).spuren[0];
  assert.equal(live.geraet, 'rack');
  assert.equal(live.glieder[1].slot, 2);
  const f = mitSpuren({ ...r, freeze: { datei: 'freeze-1-5.f32', sha256: 'a'.repeat(64), frames: 48000, von_beat: 0 } });
  const w = uebersetze(f, opt);
  assert.equal(w.spuren[0].art, 'audio');
  assert.equal(w.spuren[0].clips[0].id, 'r1/freeze');
});

// --- host check and export (the real Ausgabe against the core stand-in) -----------------------------------------------------------------------
const ruf = async (f) => { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } };
// the standard project has an RB-338 bass s2 and a Surge lead s3 (slot 1). Turn s3 into a rack track [RB-338, Surge slot 2] with a note.
async function rackAufbau(t, opt = {}) {
  const a = await aufbau(t, { tempo: 120, mitWirt: false, ...opt });
  await a.aendern([
    { befehl: 'spur_loeschen', spur_id: 's3' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Rack', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: rb() }, { id: 'g2', geraet: { art: 'wirt' } }] } },
  ], 'rack');
  const id = a.projekt().spuren.at(-1).id;
  await a.aendern([{ befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: 8, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] }], 'note');
  assert.equal(a.projekt().spuren.at(-1).geraet.glieder[1].geraet.slot, 1, 'the freed slot 1 is taken');
  assert.ok(await warteBis(() => a.zustand.kernNr === a.projekt().wiedergabe_rev, 5000));
  a.protokoll.gesendet.length = 0; a.protokoll.reihenfolge.length = 0;
  return { a, id };
}

test('T4 host check names the slot of the Surge member; freeze and export of the rack go through with the host', async (t) => {
  const { a, id } = await rackAufbau(t);
  const r = await ruf(() => a.ausgabe.freeze({ spur_id: id, an: true }));
  assert.deepEqual([r.code, r.body.fehler], [409, 'wirt_fehlt']);
  assert.match(r.body.text, /production slot 1 is not running; start it with djk-instrumente --arr1$/);
  assert.equal(a.freezes().length, 0, 'refused before any core command');
  const ex = await ruf(() => a.ausgabe.exportiere({}));
  assert.deepEqual([ex.code, ex.body.fehler], [409, 'wirt_fehlt'], 'an unfrozen rack with a Surge member is refused like a Surge track');
  assert.equal(a.freezes().length, 0);
  schreibeWirtStatus(a.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
  const ok = await ruf(() => a.ausgabe.freeze({ spur_id: id, an: true }));
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.ok(a.projekt().spuren.at(-1).freeze, 'frozen');
  // frozen: the export needs no further freeze and the translator emits the audio clip instead of the rack
  const n = a.freezes().length;
  const ex2 = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(ex2.code, 200, JSON.stringify(ex2.body));
  assert.equal(a.freezes().length, n, 'no second freeze');
  assert.ok(a.protokoll.wiedergaben.length > 0, 'the export wrote its playback');
  const sicht = exportSicht(a.projekt()).spuren.map((x) => x.id);
  assert.ok(sicht.includes(id), 'the frozen rack stays in the export view');
  assert.ok(!exportSicht({ ...a.projekt(), spuren: a.projekt().spuren.map((x) => (x.id === id ? { ...x, freeze: null } : x)) }).spuren.some((x) => x.id === id),
    'an unfrozen rack with a Surge member is left out of the export view like a Surge track');
  // an edit of the rack unfreezes it again
  await a.aendern([{ befehl: 'rack_kette', spur_id: id, kette: 3 }], 'kette');
  assert.deepEqual(a.projekt().spuren.at(-1).freeze, null);
});

test('T4 export of an unfrozen rack without a Surge member needs no host (negative control)', async (t) => {
  const a = await aufbau(t, { tempo: 120, mitWirt: false });
  await a.aendern([
    { befehl: 'spur_loeschen', spur_id: 's3' },
    { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: rb() }, { id: 'g2', geraet: rb() }] } },
  ], 'rack');
  const ex = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(ex.code, 200, JSON.stringify(ex.body));
  assert.equal(fs.existsSync(a.wirtDir), true);
});
