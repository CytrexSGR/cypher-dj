// Plan live-module task 11 (decision 19): key distance of a module to the deck on the master, adapting (MIDI notes and stem clips), idempotent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { baueModul, liveSlots, tonartAbstand, tonartWurzel, passeModulAn } from '../project/live.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { ModulTonart } from '../areas/live/key.ts';
import { liveAufbau } from './support/live_module.mjs';

const HASH = 'c'.repeat(64), D = (n) => ({ sha256: n.repeat(64), pfad: `/x/${n}.wav` });
const herkunft = (extra = {}) => ({ quelle_sha256: HASH, titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120,
  tonart: '8A', datum: '2026-11-12', ...extra });
const LOOP = { ...D('e'), beats: 16, frames: 16 * 24000 };
const live = () => { const p = neuesProjekt('x'); p.live = true; return p; };
const vier = () => ({ drums: D('1'), bass: D('2'), other: D('3'), vocals: D('4') });
const valide = (p) => assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))), JSON.stringify(pruefeProjekt(JSON.parse(JSON.stringify(p)))));
// a module with stems plus a MIDI track in its tree (task 8 brings MIDI clips; every MIDI clip of the tree is moved)
function mitMidi() {
  let p = baueModul(live(), 'A', LOOP, vier(), herkunft());
  const top = liveSlots(p).A;
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'Keys' }]).projekt;
  const sid = p.spuren.at(-1).id;
  p = fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 16,
    noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 57, vel: 100 }, { id: 'n2', beat: 1, laenge: 1, ton: 60, vel: 90 }] },
  { befehl: 'gruppenspur_neu', name: 'Keys', mitglieder: [sid] }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'ziel_setzen', strang_id: p.gruppen.at(-1).id, ausgang: { art: 'gruppe', id: top } }]).projekt;
  return p;
}
const warps = (p) => p.spuren.flatMap((s) => s.clips.filter((c) => c.art === 'audio').map((c) => [s.name, c.warp.modus, c.warp.transpose_st]));
const toene = (p) => p.spuren.flatMap((s) => s.clips.filter((c) => c.art === 'midi').flatMap((c) => c.noten.map((n) => n.ton)));

test('distance: A minor under C minor is +3; Am and C are 0 apart; shortest way in -6..+6, tritone +6; unknown is null', () => {
  assert.equal(tonartAbstand({ tonart: '8A' }, '5A'), 3);
  assert.equal(tonartAbstand({ tonart: '8A' }, '8B'), 0);
  assert.equal(tonartAbstand({ tonart: '5A' }, '8A'), -3);
  assert.equal(tonartAbstand({ tonart: '8B' }, '2B'), 6);
  assert.equal(tonartAbstand({ tonart: '2B' }, '8B'), 6);
  assert.equal(tonartAbstand({ tonart: '8B' }, '9B'), -5);   // C to G is +7, the short way is -5
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) {
    const d = tonartAbstand({ tonart: `${a}A` }, `${b}B`);
    assert.ok(d >= -6 && d <= 6);
    assert.equal((tonartWurzel(`${a}A`) + d + 12) % 12, tonartWurzel(`${b}B`));
  }
  assert.equal(tonartAbstand({ tonart: '' }, '5A'), null);
  assert.equal(tonartAbstand({ tonart: '8A' }, null), null);
  assert.equal(tonartAbstand({ tonart: '13A' }, '5A'), null);
});

test('adapt: MIDI notes +3, transpose_st 3 on the stem clips (drums in repitch stay), idempotent, in range', () => {
  const p0 = mitMidi();
  const top = liveSlots(p0).A;
  const p1 = passeModulAn(p0, top, 3);
  assert.deepEqual(toene(p1), [60, 63]);
  for (const [name, modus, st] of warps(p1)) assert.equal(st, modus === 'repitch' ? 0 : 3, name);
  assert.ok(warps(p1).some(([, m, st]) => m !== 'repitch' && st === 3));
  assert.equal(p1.gruppen.find((g) => g.id === top).modul.transponiert, 3);
  valide(p1);
  const p2 = passeModulAn(p1, top, 3);
  assert.deepEqual(toene(p2), [60, 63]);
  assert.deepEqual(warps(p2), warps(p1));
  // the deck changes: the module goes to -2, not on top of +3
  const p3 = passeModulAn(p2, top, -2);
  assert.deepEqual(toene(p3), [55, 58]);
  for (const [, modus, st] of warps(p3)) assert.equal(st, modus === 'repitch' ? 0 : -2);
  // back to 0: field gone
  const p4 = passeModulAn(p3, top, 0);
  assert.deepEqual(toene(p4), [57, 60]);
  assert.equal('transponiert' in p4.gruppen.find((g) => g.id === top).modul, false);
  assert.deepEqual(p4, passeModulAn(p4, top, 0));
  valide(p4);
});

test('validator: transponiert is optional, an integer -12..12, never 0', () => {
  const p = baueModul(live(), 'A', LOOP, {}, herkunft());
  const top = liveSlots(p).A;
  const setze = (t) => () => fuehreListeAus(p, [{ befehl: 'modul_setzen', gruppe_id: top, modul: { ...herkunft(), slot: 'A', transponiert: t } }]);
  setze(3)();
  for (const t of [0, 1.5, 13, '3']) assert.throws(setze(t), (e) => e.grund === 'argument_ungueltig', String(t));
});

// the Bereich: the master source is a double
async function aufbauMitMaster(t, master) {
  const z = await liveAufbau(t);
  await z.exportiere('A');
  const tonart = new ModulTonart(z.ctx, z.zugang, master);
  return { z, tonart };
}
test('POST /modul/tonart: +3 under 5A, one undo step for all clips, second call changes nothing, stand shows the rest', async (t) => {
  const quelle = { m: { deck: 2, tonart: '5A' } };
  const { z, tonart } = await aufbauMitMaster(t, () => quelle.m);
  const gid = liveSlots(z.projekt()).A;
  assert.equal(tonart.stand(gid).tonart_abstand, 3);
  const a = await tonart.passeAn({ slot: 'A' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual([a.j.abstand, a.j.bewegt, a.j.deck], [3, 3, 2]);
  const p = z.projekt();
  assert.equal(p.gruppen.find((g) => g.id === gid).modul.transponiert, 3);
  for (const [, modus, st] of warps(p)) assert.equal(st, modus === 'repitch' ? 0 : 3);
  assert.equal(tonart.stand(gid).tonart_abstand, 0);
  const rev = p.rev;
  const b = await tonart.passeAn({ slot: 'A' }, 'andreas');
  assert.equal(b.code, 200); assert.equal(b.j.bewegt, 0);
  assert.equal(z.projekt().rev, rev, 'no second step');
  // undo: ONE step brings back every clip and the module field
  const u = await z.s.umkehr('undo', { rev }, 'andreas');
  assert.equal(u.code, 200, JSON.stringify(u.j));
  for (const [, , st] of warps(z.projekt())) assert.equal(st, 0);
  assert.equal(z.projekt().gruppen.find((g) => g.id === gid).modul.transponiert, undefined);
  quelle.m = { deck: 1, tonart: '11A' };
  assert.equal(tonart.stand(gid).tonart_abstand, -3);
});

test('POST /modul/tonart refusals: no deck, unknown key, empty slot, no live project, bad arguments', async (t) => {
  const q = { m: { code: 409, fehler: 'kein_deck' } };
  const { z, tonart } = await aufbauMitMaster(t, () => q.m);
  const f = (d) => z.fehl(() => tonart.passeAn(d, 'andreas'));
  assert.deepEqual(await f({ slot: 'A' }), { code: 409, fehler: 'kein_deck' });
  q.m = { deck: 1, tonart: null };
  assert.deepEqual(await f({ slot: 'A' }), { code: 409, fehler: 'tonart_unbekannt' });
  q.m = { deck: 1, tonart: '5A' };
  assert.deepEqual(await f({ slot: 'B' }), { code: 409, fehler: 'slot_leer' });
  assert.deepEqual(await f({ slot: 'C' }), { code: 400, fehler: 'argument_ungueltig' });
  assert.deepEqual(await f({ slot: 'A', x: 1 }), { code: 400, fehler: 'argument_unbekannt' });
  assert.equal(toene(z.projekt()).length, 0);
  assert.equal(z.projekt().gruppen.find((g) => g.modul).modul.transponiert, undefined, 'nothing changed');
});
