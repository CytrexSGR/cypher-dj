// Plan live-module task 2: baueModul builds the module tree of decision 2 in one project value (the caller makes it one undo step).
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { baueModul, liveSlots, modulPhase } from '../project/live.ts';
import { fuehreListeAus } from '../project/commands.ts';

const HASH = 'c'.repeat(64), D = (n) => ({ sha256: n.repeat(64), pfad: `/x/${n}.wav` });
const herkunft = (extra = {}) => ({ quelle_sha256: HASH, titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120,
  tonart: '8A', datum: '2026-11-12', ...extra });
const LOOP = { ...D('e'), beats: 16, frames: 16 * 24000 };
const live = () => { const p = neuesProjekt('x'); p.live = true; return p; };
const vier = () => ({ drums: D('1'), bass: D('2'), other: D('3'), vocals: D('4') });
const sechs = () => ({ ...vier(), guitar: D('5'), piano: D('6') });
const kinder = (p, id) => p.gruppen.filter((g) => g.ausgang?.id === id);
const valide = (p) => assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))), JSON.stringify(pruefeProjekt(JSON.parse(JSON.stringify(p)))));

test('baueModul with four stems: top group, Loop muted, four child groups in order with the original tracks at 0 dB', () => {
  const p = baueModul(live(), 'A', LOOP, vier(), herkunft());
  const id = liveSlots(p).A;
  const top = p.gruppen.find((g) => g.id === id);
  assert.equal(top.name, 'A · Song');
  assert.equal(top.fader_db, -200);
  assert.equal(top.modul.slot, 'A');
  assert.equal(top.modul.quelle_sha256, HASH);
  assert.equal(top.ausgang, undefined);
  assert.deepEqual(kinder(p, id).map((g) => g.name), ['Drums', 'Bass', 'Other', 'Vocals']);
  const loop = p.spuren.find((s) => s.name === 'Loop');
  assert.equal(loop.ausgang.id, id);
  assert.equal(loop.mute, true);
  for (const g of kinder(p, id)) {
    const t = p.spuren.filter((s) => s.ausgang?.id === g.id);
    assert.equal(t.length, 1, g.name);
    assert.equal(t[0].name, `${g.name} original`);
    assert.equal(t[0].fader_db, 0);
    assert.equal(t[0].mute, false);
    assert.equal(g.fader_db, 0);
    assert.equal(g.modul, undefined);
  }
  assert.equal(p.spuren.length, 5);
  valide(p);
});

test('baueModul with guitar and piano gives six child groups; without them four', () => {
  const sechsP = baueModul(live(), 'B', LOOP, sechs(), herkunft());
  assert.deepEqual(kinder(sechsP, liveSlots(sechsP).B).map((g) => g.name), ['Drums', 'Bass', 'Other', 'Vocals', 'Guitar', 'Piano']);
  assert.equal(sechsP.gruppen.find((g) => g.id === liveSlots(sechsP).B).name, 'B · Song');
  const nur = baueModul(live(), 'A', LOOP, { ...vier(), guitar: undefined }, herkunft());
  assert.equal(kinder(nur, liveSlots(nur).A).length, 4);
  valide(sechsP);
});

test('baueModul without stems is a loop-only module: Loop unmuted, no child group, fader closed', () => {
  const p = baueModul(live(), 'A', LOOP, {}, herkunft());
  const id = liveSlots(p).A;
  assert.equal(kinder(p, id).length, 0);
  assert.equal(p.spuren.length, 1);
  assert.equal(p.spuren[0].mute, false);
  assert.equal(p.gruppen[0].fader_db, -200);
  valide(p);
});

test('baueModul adds the stems to an existing loop-only module: Loop muted, module fader and group untouched', () => {
  const lo = baueModul(live(), 'A', LOOP, {}, herkunft());
  const offen = fuehreListeAus(lo, [{ befehl: 'gruppenspur_aendern', gruppe_id: liveSlots(lo).A, fader_db: -3 }]).projekt;   // Andreas opened the module
  const p = baueModul(offen, 'A', LOOP, vier(), herkunft());
  const id = liveSlots(p).A;
  assert.equal(liveSlots(p).A, liveSlots(offen).A);
  assert.equal(p.gruppen.find((g) => g.id === id).fader_db, -3);
  assert.equal(kinder(p, id).length, 4);
  assert.equal(p.spuren.find((s) => s.name === 'Loop').mute, true);
  assert.equal(p.spuren.filter((s) => s.name === 'Loop').length, 1, 'no second Loop track');
  assert.throws(() => baueModul(p, 'A', LOOP, vier(), herkunft()), /already has its stems/);
  valide(p);
});

test('module clips: two warp markers, repeat to fill 64 beats, bar phase kept by a lead-in clip (decision 17)', () => {
  const p = baueModul(live(), 'A', LOOP, vier(), herkunft({ von_beat: 5 }));   // 5 mod 4 = 1
  for (const s of p.spuren) {
    assert.equal(s.clips.length, 2, s.name);
    const [kopf, haupt] = s.clips.sort((a, b) => a.start_beat - b.start_beat);
    assert.deepEqual([kopf.start_beat, kopf.laenge_beats, kopf.warp.versatz_beats, kopf.loop_beats], [0, 1, 15, undefined], s.name);
    assert.deepEqual([haupt.start_beat, haupt.laenge_beats, haupt.loop_beats, haupt.warp.versatz_beats], [1, 63, 16, 0], s.name);
    for (const c of [kopf, haupt]) {
      assert.deepEqual(c.warp.marker, [[0, 0], [16 * 24000 / 48000, 16]]);
      assert.equal(c.warp.an, true);
    }
    // the lead-in plays the tail of the loop, the main clip's last copy ends at 64 on the loop end: 63 = 3 * 16 + 15
    assert.equal((haupt.laenge_beats % haupt.loop_beats) + 1, 16);
  }
  assert.equal(p.spuren.find((s) => s.name === 'Drums original').clips[1].warp.modus, 'repitch');
  const flach = baueModul(live(), 'A', LOOP, vier(), herkunft({ von_beat: 8 }));   // on a downbeat: one clip, 64 long, looping every 16
  for (const s of flach.spuren) { assert.equal(s.clips.length, 1); assert.deepEqual([s.clips[0].start_beat, s.clips[0].laenge_beats, s.clips[0].loop_beats], [0, 64, 16]); }
  valide(p); valide(flach);
});

test('module clip phase: p = von_beat mod 4, none below 4 beats, none for a loop of 64', () => {
  assert.equal(modulPhase(5, 16), 1);
  assert.equal(modulPhase(6.5, 8), 2.5);
  assert.equal(modulPhase(7, 2), 0);
  assert.equal(modulPhase(-1, 4), 3);
  assert.equal(modulPhase(8, 16), 0);
  const kurz = baueModul(live(), 'A', { ...LOOP, beats: 2, frames: 48000 }, {}, herkunft({ von_beat: 5, laenge_beats: 2 }));
  assert.deepEqual(kurz.spuren[0].clips.map((c) => [c.start_beat, c.laenge_beats, c.loop_beats]), [[0, 64, 2]]);
  const voll = baueModul(live(), 'A', { ...LOOP, beats: 64, frames: 64 * 24000 }, {}, herkunft({ von_beat: 5, laenge_beats: 64 }));
  assert.deepEqual(voll.spuren[0].clips.map((c) => [c.start_beat, c.laenge_beats, c.loop_beats, c.warp.versatz_beats]), [[0, 1, undefined, 63], [1, 63, undefined, 0]]);
});

test('modul_setzen: one module per slot, only on a top group, valid record', () => {
  const p = baueModul(live(), 'A', LOOP, vier(), herkunft());
  const kind = p.gruppen.find((g) => g.name === 'Drums');
  const b = (gruppe_id, modul) => () => fuehreListeAus(p, [{ befehl: 'modul_setzen', gruppe_id, modul }]);
  assert.throws(b(kind.id, { ...herkunft(), slot: 'B' }), (e) => e.grund === 'argument_ungueltig');
  assert.throws(b(liveSlots(p).A, { ...herkunft(), slot: 'C' }), (e) => e.grund === 'argument_ungueltig');
  const zwei = baueModul(p, 'B', LOOP, {}, herkunft());
  assert.throws(() => fuehreListeAus(zwei, [{ befehl: 'modul_setzen', gruppe_id: liveSlots(zwei).B, modul: { ...herkunft(), slot: 'A' } }]), (e) => e.grund === 'slot_belegt');
});

test('a project without modules is untouched by the module code (no modul or live key appears)', () => {
  const p = fuehreListeAus(neuesProjekt('x'), [{ befehl: 'gruppenspur_neu', name: 'G' }]).projekt;
  assert.equal('live' in p, false);
  assert.equal('modul' in p.gruppen[0], false);
});

test('bar phase counts from the first downbeat of the rendering: eins 1 and von_beat 1 gives p 0 (one clip), eins 1 and von_beat 3 gives p 2 (lead-in)', () => {
  const L8 = { ...LOOP, beats: 8, frames: 8 * 24000 };
  const a = baueModul(live(), 'A', L8, {}, herkunft({ von_beat: 1, eins_beat: 1, laenge_beats: 8 }));
  assert.deepEqual(a.spuren[0].clips.map((c) => [c.start_beat, c.laenge_beats, c.loop_beats]), [[0, 64, 8]]);
  const b = baueModul(live(), 'A', L8, {}, herkunft({ von_beat: 3, eins_beat: 1, laenge_beats: 8 }));
  const [kopf, haupt] = b.spuren[0].clips.sort((x, y) => x.start_beat - y.start_beat);
  assert.deepEqual([kopf.start_beat, kopf.laenge_beats, kopf.warp.versatz_beats], [0, 2, 6]);
  assert.deepEqual([haupt.start_beat, haupt.laenge_beats, haupt.loop_beats], [2, 62, 8]);
  assert.equal(b.gruppen[0].modul.eins_beat, 1);
  valide(b);
  // without eins the old rule: von_beat mod 4
  const c = baueModul(live(), 'A', L8, {}, herkunft({ von_beat: 3, laenge_beats: 8 }));
  assert.equal(c.spuren[0].clips.find((x) => x.start_beat > 0).start_beat, 3);
  assert.equal('eins_beat' in c.gruppen[0].modul, false);
  assert.equal(modulPhase(3, 8, 1), 2);
  assert.equal(modulPhase(1, 8, 1), 0);
  assert.equal(modulPhase(0, 8, 1), 3);
});
