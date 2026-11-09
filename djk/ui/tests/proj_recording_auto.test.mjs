// 1.12 automation slice 3 task 8: the take collector (D10 to D16). Session level with a recording kern: the kern events are fed by hand, so beats
// are exact. AK12 with the real hand path is in proj_recording_auto_hand.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefKontext, sitzung, warteBis } from './support/proj_context.mjs';
import { laneWert } from '../project/lane.ts';
import { falscheUhr } from './support/wrong_clock.mjs';

const SPUR_EV = (nr, ziel, beat, wert) => ({ pfad: `spur/${nr}/${ziel}`, projekt_beat: beat, wert });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));   // real time: only where the test simulates a slow core
let uhr = falscheUhr();                                             // the clock of the collector in the running test
const vor = (ms) => uhr.vor(ms);
const OPT = { arrFristMs: 30, autoAufnahme: { ruheMs: 60, sicherungMs: 300, gnadeMs: 25 } };

// a core that answers like the stand-in: the arm of the source cypher is refused with nur_andreas. k.core models what the core holds armed
// (track number -> mode), k.nein(adresse, felder) may refuse a call (returns a receipt) or throw; undefined lets it through
function kern() {
  const k = pruefKontext();
  k.core = new Map(); k.nein = null; k.verloren = null;   // verloren(felder): the core did the arm but the acknowledgement is lost (null, a timeout)
  const setze = (f) => { if (f.spur === 0) k.core.clear(); else if (f.an === 1) k.core.set(f.spur, f.modus); else k.core.delete(f.spur); };
  k.regel = (adresse, f) => {
    if (adresse === '/k/arr/arm' && f.quelle === 'andreas' && k.verloren?.(f)) { setze(f); return null; }
    const nein = k.nein?.(adresse, f);
    if (nein !== undefined) return nein;
    if (adresse === '/k/arr/arm') {
      if (f.quelle !== 'andreas') return { status: 6, grund: 'nur_andreas' };
      setze(f);
    }
    return { status: 3, grund: '' };
  };
  return k;
}
const arr = (status, beat, extra = {}) => ({ nr: 1, status, loop_an: 0, projekt_beat: beat, ursprung_sample: 0n, start_beat: 0, metronom_an: 0, ...extra });

// three tracks; s1 and s2 and s3 each get a flat fader lane at -6 over beats 0..64; the base fader of every track is -3
async function aufbau(t, { lanen = ['s1', 's2', 's3'], opt = {} } = {}) {
  const k = kern();
  uhr = falscheUhr();
  const { s } = sitzung(t, { ...OPT, ...opt, autoAufnahme: { ...OPT.autoAufnahme, ...opt.autoAufnahme, uhr } }, k);
  await s.neu('Take', 'andreas');
  let rev = 0;
  const a = async (befehle, label = 'x') => { rev = (await s.aendern({ rev, label, befehle }, 'andreas')).j.rev; };
  await a([{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }, { befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }, { befehl: 'spur_aendern', spur_id: 's3', fader_db: -3 }]);
  for (const id of lanen) {
    const n = lanen.indexOf(id) + 1;
    await a([{ befehl: 'auto_neu', spur_id: id, ziel: 'fader' },
      { befehl: 'auto_punkte', lane_id: `a${n}`, setze: [{ beat: 0, wert: -6 }, { beat: 64, wert: -6 }], loesche_von: 0, loesche_bis: 100 }]);
  }
  k.leere();
  const lane = (id, ziel = 'fader') => s.aktuell().j.projekt.spuren.find((x) => x.id === id).automation?.find((l) => l.ziel === ziel);
  const wertBei = (id, beat, ziel = 'fader') => laneWert(lane(id, ziel).punkte, beat, ziel);
  const spielt = (beat) => s.ereignis('/zustand/arr', arr(2, beat));
  const stopp = (beat = 0) => s.ereignis('/zustand/arr', arr(0, beat));
  const hand = (nr, ziel, beat, wert) => s.ereignis('/e/auto_punkt', SPUR_EV(nr, ziel, beat, wert));
  const arme = async (id, modus = 'touch') => s.autoArm({ spur_id: id, an: true, modus }, 'andreas');
  const fertig = async () => { await vor(150); await s.aufAuto.fertigGeschrieben(); };
  return { k, s, lane, wertBei, spielt, stopp, hand, arme, fertig, rev: () => rev };
}
const historie = (s) => s.verlaufListe().j.map((e) => e.label);

test('AK13 touch: only the span of the gesture is written; before and after the lane stays; the regulator is given back', async (t) => {
  const { k, s, lane, wertBei, spielt, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch');
  spielt(10);
  const vorher = JSON.stringify(lane('s1').punkte);
  for (let i = 0; i <= 40; i++) hand(1, 'fader', 10 + i * 0.1, -6 - i * 0.35);          // a ramp from -6 down to -20 over beats 10..14
  await fertig();
  const p = lane('s1').punkte;
  console.log(`# touch: 41 raw points -> lane of ${p.length} points`);
  assert.notEqual(JSON.stringify(p), vorher);
  assert.ok(Math.abs(wertBei('s1', 5) - -6) < 1e-9, 'before the span the old lane');
  assert.ok(Math.abs(wertBei('s1', 12) - (-6 - 20 * 0.35)) < 0.31, `inside: ${wertBei('s1', 12)}`);
  assert.ok(Math.abs(wertBei('s1', 13.95) - -20) < 0.31);
  assert.ok(Math.abs(wertBei('s1', 14.001) - -6) < 0.2, 'right after the release the old lane is back');
  assert.ok(Math.abs(wertBei('s1', 30) - -6) < 1e-9, 'after the span the old lane');
  assert.ok(p.length <= 8, `simplified: ${p.length}`);
  assert.deepEqual(historie(s).at(-1), 'Record fader Audio 1', 'one entry');
  const frei = k.an('/k/arr/auto').filter((z) => z.felder.an === 1 && z.felder.spur === 1 && z.felder.ziel === 'fader');
  assert.equal(frei.length, 1, 'the regulator of the take is re-enabled once');
});

test('AK13 touch: an unarmed track records nothing (negative control), a point without arm or while stopped is ignored', async (t) => {
  const { s, lane, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  const vorher = JSON.stringify(lane('s2').punkte), rev0 = s.aktuell().j.projekt.rev;
  await arme('s1');
  stopp(0);
  hand(1, 'fader', 3, -20); await fertig();
  assert.equal(s.aktuell().j.projekt.rev, rev0, 'stopped: nothing');
  spielt(10);
  hand(2, 'fader', 10, -20); hand(2, 'fader', 11, -30); await fertig();
  assert.equal(JSON.stringify(lane('s2').punkte), vorher, 'track 2 is not armed');
  assert.equal(s.aktuell().j.projekt.rev, rev0);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -30); await fertig();
  assert.ok(s.aktuell().j.projekt.rev > rev0, 'the armed track 1 records (the take that had to hit)');
});

test('AK13 latch: after the release the last value holds and is written until the stop; before the stop nothing is written', async (t) => {
  const { s, lane, wertBei, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'latch');
  spielt(10);
  const rev0 = s.aktuell().j.projekt.rev;
  for (let i = 0; i <= 20; i++) hand(1, 'fader', 10 + i * 0.1, -6 - i);                   // down to -26 at beat 12
  await vor(200);                                                                         // the gesture rests: released
  assert.equal(s.aktuell().j.projekt.rev, rev0, 'latch writes at the stop, not at the release');
  s.ereignis('/zustand/arr', arr(2, 20)); await vor(5);
  stopp(20); await fertig();
  assert.ok(Math.abs(wertBei('s1', 5) - -6) < 1e-9, 'before the take the old lane');
  assert.ok(Math.abs(wertBei('s1', 11) - -16) < 0.31, 'inside the gesture');
  assert.ok(Math.abs(wertBei('s1', 16) - -26) < 0.31, 'after the release the last value holds');
  assert.ok(Math.abs(wertBei('s1', 19.9) - -26) < 0.31, 'until the stop');
  assert.ok(Math.abs(wertBei('s1', 40) - -6) < 0.3, 'after the stop the old lane');
  assert.equal(historie(s).at(-1), 'Record fader Audio 1');
});

test('AK13 write: two armed tracks overwrite from start to stop with the base or hand value; the unarmed track stays byte for byte', async (t) => {
  const { k, s, lane, wertBei, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'write'); await arme('s2', 'write');
  const roh3 = JSON.stringify(lane('s3')), roh2 = JSON.stringify(lane('s2').punkte);
  spielt(8);
  for (let i = 0; i <= 10; i++) hand(1, 'fader', 12 + i * 0.1, -3 - i * 1.7);             // track 1 touched: down to -20 at beat 13
  hand(3, 'fader', 12, -40); hand(3, 'fader', 13, -50);                                    // track 3 is not armed
  await vor(150);
  s.ereignis('/zustand/arr', arr(2, 20)); await vor(5);
  stopp(20); await fertig();
  assert.ok(Math.abs(wertBei('s1', 4) - -6) < 1e-9, 'track 1 before the start: the old lane');
  assert.ok(Math.abs(wertBei('s1', 10) - -3) < 0.31, 'track 1 from the start: the base value -3 (not the old lane -6)');
  assert.ok(Math.abs(wertBei('s1', 12.5) - (-3 - 5 * 1.7)) < 0.31, 'track 1 touched');
  assert.ok(Math.abs(wertBei('s1', 18) - -20) < 0.31, 'track 1 holds the hand value to the stop');
  assert.ok(Math.abs(wertBei('s1', 30) - -6) < 0.3, 'track 1 after the stop: the old lane');
  assert.ok(Math.abs(wertBei('s2', 14) - -3) < 0.31, 'track 2 untouched but armed: written with the base value');
  assert.ok(Math.abs(wertBei('s2', 4) - -6) < 1e-9 && Math.abs(wertBei('s2', 30) - -6) < 0.3);
  assert.notEqual(JSON.stringify(lane('s2').punkte), roh2);
  assert.equal(JSON.stringify(lane('s3')), roh3, 'the unarmed track is byte for byte the same');
  assert.equal(k.an('/k/arr/auto').filter((z) => z.felder.an === 1 && z.felder.spur === 3).length, 0, 'track 3 is never touched');
});

test('write: a field without a lane gets one only if it was touched; the take of a new lane is one entry that undo removes whole (D16)', async (t) => {
  const { s, lane, wertBei, spielt, stopp, hand, arme, fertig } = await aufbau(t, { lanen: [] });
  await arme('s1', 'write');
  spielt(0);
  assert.equal(lane('s1'), undefined);
  hand(1, 'pan', 2, 0.5); hand(1, 'pan', 3, -0.5);
  await vor(150);
  s.ereignis('/zustand/arr', arr(2, 6)); await vor(5);
  stopp(6); await fertig();
  assert.equal(lane('s1'), undefined, 'the fader had no lane and was not touched: no lane');
  const pan = lane('s1', 'pan');
  assert.ok(pan, 'the touched pan got a lane');
  assert.ok(Math.abs(wertBei('s1', 2.5, 'pan') - 0) < 0.1 && wertBei('s1', 5, 'pan') < -0.4, 'pan course held to the stop');
  assert.equal(historie(s).at(-1), 'Record pan Audio 1');
  const r = await s.umkehr('undo', { rev: s.aktuell().j.projekt.rev }, 'andreas');
  assert.equal(r.code, 200);
  assert.equal(lane('s1', 'pan'), undefined, 'undo removes lane and points whole');
});

test('AK17: a locked lane refuses the take with lane_gesperrt, shows it, drops nothing silently; the regulator is still given back', async (t) => {
  const { k, s, lane, spielt, hand, arme, fertig } = await aufbau(t);
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Lock', befehle: [{ befehl: 'auto_aendern', lane_id: 'a1', gesperrt: true }] }, 'andreas');
  await arme('s1');
  spielt(10);
  const vorher = JSON.stringify(lane('s1')), rev0 = s.aktuell().j.projekt.rev;
  k.leere();
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -30);
  await fertig();
  assert.equal(JSON.stringify(lane('s1')), vorher, 'the locked lane is unchanged');
  assert.equal(s.aktuell().j.projekt.rev, rev0, 'no history entry');
  const m = k.verteilt.filter((e) => e.f?.auto_aufnahme);
  assert.deepEqual(m.map((e) => e.f.auto_aufnahme), [{ spur_id: 's1', ziel: 'fader', slug: s.aktuell().j.slug, fehler: 'lane_gesperrt', text: 'that automation lane is locked: unlock it with auto_aendern first' }],
    'the refusal is shown');
  assert.equal(k.an('/k/arr/auto').filter((z) => z.felder.an === 1 && z.felder.spur === 1).length, 1, 're-enabled');
  // negative control: unlocked, the same gesture writes
  await s.aendern({ rev: rev0, label: 'Unlock', befehle: [{ befehl: 'auto_aendern', lane_id: 'a1', gesperrt: false }] }, 'andreas');
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -30); await fertig();
  assert.notEqual(JSON.stringify(lane('s1')), vorher);
});

test('a take over the loop seam: later passes overwrite earlier ones where they overlap, the last pass wins', async (t) => {
  const { s, wertBei, spielt, hand, arme, fertig } = await aufbau(t);
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'andreas');
  await arme('s1', 'touch');
  spielt(1);
  for (let b = 2; b <= 6; b += 0.5) hand(1, 'fader', b, -20);                              // pass 1: beats 2..6 at -20
  for (let b = 3; b <= 5; b += 0.5) hand(1, 'fader', b, -10);                              // the beat fell: pass 2 covers 3..5 at -10
  await fertig();
  assert.ok(Math.abs(wertBei('s1', 2.5) - -20) < 0.31, 'only pass 1 there');
  assert.ok(Math.abs(wertBei('s1', 4) - -10) < 0.31, 'overlap: the last pass wins');
  assert.ok(Math.abs(wertBei('s1', 5.75) - -20) < 0.31, 'after pass 2 the earlier pass again');
});

test('a gesture ends through the mouse end events, the safety net, the keyboard rest and the stop (D13)', async (t) => {
  const { k, s, lane, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch');
  spielt(10);
  const geste = (d) => s.autoGeste({ spur_id: 's1', ziel: 'fader', ...d }, 'andreas');
  // (a) mouse: the end event (pointerup, pointercancel, lostpointercapture, window blur) writes at once, long before the safety net
  assert.equal(geste({ wert: -10 }).j.aufgenommen, true);
  geste({ wert: -12 });
  const rev0 = s.aktuell().j.projekt.rev;
  await vor(100);
  assert.equal(s.aktuell().j.projekt.rev, rev0, 'a held mouse button without movement is no end (the net is 300 ms here)');
  geste({ ende: true });
  await s.aufAuto.fertigGeschrieben();
  assert.ok(s.aktuell().j.projekt.rev > rev0, 'blur / pointerup wrote the take');
  // (b) mouse without any end event: the safety net closes it and writes up to the last value
  const rev1 = s.aktuell().j.projekt.rev;
  geste({ wert: -14 });
  await vor(450); await s.aufAuto.fertigGeschrieben();
  assert.ok(s.aktuell().j.projekt.rev > rev1, 'the safety net wrote');
  // (c) keyboard: 60 ms of rest
  const rev2 = s.aktuell().j.projekt.rev;
  geste({ wert: -16, quelle: 'tasten' });
  await vor(120); await s.aufAuto.fertigGeschrieben();
  assert.ok(s.aktuell().j.projekt.rev > rev2, 'keyboard rest wrote');
  // (d) the stop ends every open gesture, and a hand point after the stopped state still belongs to it
  const rev3 = s.aktuell().j.projekt.rev;
  hand(1, 'fader', 14, -18); hand(1, 'fader', 14.5, -19);
  stopp(0);
  hand(1, 'fader', 14.7, -33);                                                              // the held point of the hand arrives after the stop
  await vor(120); await s.aufAuto.fertigGeschrieben();
  assert.ok(s.aktuell().j.projekt.rev > rev3, 'the stop wrote the open gesture');
  assert.ok(lane('s1').punkte.some((p) => p.beat === 14.7 && p.wert === -33), 'the point after the stop is in the take (next to the boundary point of the old lane)');
  // negative control: a point long after the stop is ignored
  const rev4 = s.aktuell().j.projekt.rev;
  hand(1, 'fader', 15, -40); await fertig();
  assert.equal(s.aktuell().j.projekt.rev, rev4);
  assert.equal(k.an('/k/arr/auto').filter((z) => z.felder.an === 0).length, 0, 'the server itself never overrides (the page does, D4)');
});

test('mouse time base (D12): last project beat plus the wall clock at the project tempo, clamped to the loop end', async (t) => {
  const { s, spielt, arme } = await aufbau(t);
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'andreas');
  s.ereignis('/uhr', { beat: 0, bpm: 120 });
  await arme('s1');
  spielt(7);
  await vor(100);                                                                          // 120 bpm: 0.2 beat in 100 ms
  const b = s.autoGeste({ spur_id: 's1', ziel: 'fader', wert: -9 }, 'andreas').j.beat;
  assert.ok(b > 7.15 && b < 7.45, `beat ${b}`);
  await vor(1500);                                                                         // 3 more beats: past the loop end
  assert.equal(s.autoGeste({ spur_id: 's1', ziel: 'fader', wert: -9 }, 'andreas').j.beat, 8, 'clamped to the loop end');
  s.aufAuto.beende();
});

test('D13a: the take is written, the new playback acknowledged, then the regulator is given back, then the base value is sent', async (t) => {
  const { k, s, spielt, hand, arme, fertig } = await aufbau(t);
  await arme('s1');
  spielt(10);
  let ackLaden = false, ackZeit = 0, autoAckVorLaden = null, teilVorAuto = null;
  const alteRegel = k.regel;
  k.regel = (adresse, f) => {
    if (adresse === '/k/arr/laden') return new Promise((ok) => setTimeout(() => { ackLaden = true; ackZeit = Date.now(); ok({ status: 3, grund: '' }); }, 80));
    return alteRegel(adresse, f);
  };
  const alteSende = k.sende;
  k.sende = (adresse, felder) => {
    if (adresse === '/k/arr/auto' && felder.an === 1 && felder.spur === 1) autoAckVorLaden = !ackLaden;
    if (adresse === '/k/teil' && felder.pfad === 'spur/1/fader') teilVorAuto = !k.gesendet.some((z) => z.adresse === '/k/arr/auto' && z.felder.an === 1 && z.felder.spur === 1);
    return alteSende(adresse, felder);
  };
  k.leere();
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -25);
  await fertig(); await warte(100);
  const reihe = k.gesendet.map((z) => z.adresse + (z.adresse === '/k/arr/auto' ? `:${z.felder.an}` : z.adresse === '/k/teil' ? `:${z.felder.pfad}=${z.felder.nach}` : ''));
  console.log(`# order: ${reihe.join(' > ')}`);
  const iLaden = reihe.indexOf('/k/arr/laden'), iAuto = reihe.indexOf('/k/arr/auto:1'), iTeil = reihe.indexOf('/k/teil:spur/1/fader=-3');
  assert.ok(iLaden >= 0 && iAuto > iLaden && iTeil > iAuto, `laden < auto an 1 < teil (base -3): ${reihe.join(' ')}`);
  assert.equal(autoAckVorLaden, false, 'an 1 went out only after the acknowledgement of the new playback');
  assert.equal(teilVorAuto, false, 'the base value went out only after an 1');
  assert.ok(ackZeit > 0);
});

test('D10: an armed track that plays keeps the hand value out of the base value; an unarmed track and a stopped transport do not (negative controls)', async (t) => {
  const { s, spielt, stopp, arme } = await aufbau(t);
  const fader = (id) => s.aktuell().j.projekt.spuren.find((x) => x.id === id).fader_db;
  const regler = (nr, wert) => s.ereignis('/e/regler', { pfad: `spur/${nr}/fader`, wert, halter: 'mensch', sample: 0n, beat: 0 });
  await arme('s1');
  spielt(10);
  regler(1, -20); regler(2, -22);
  await warte(500); await s.aufAuto.fertigGeschrieben();
  assert.equal(fader('s1'), -3, 'armed and playing: the base value stays');
  assert.equal(fader('s2'), -22, 'unarmed: the return path writes it as before');
  stopp(0); await vor(120);
  regler(1, -30); await warte(500);
  assert.equal(fader('s1'), -30, 'armed but stopped (after the grace): the return path as before');
});

test('D6/D11: arm goes to the core with the source; only Andreas arms; opening a project disarms in the core and in the session; a mode switch re-arms', async (t) => {
  const { k, s, arme } = await aufbau(t);
  await arme('s1', 'latch'); await arme('s2', 'latch');
  assert.deepEqual(k.an('/k/arr/arm').map((z) => [z.felder.spur, z.felder.an, z.felder.modus, z.felder.quelle]), [[1, 1, 1, 'andreas'], [2, 1, 1, 'andreas']]);
  assert.deepEqual(s.aktuell().j.auto_arm, { modus: 'latch', spuren: ['s1', 's2'] }, 'the page learns the arm state after a reload');
  k.leere();
  await s.autoArm({ modus: 'write' }, 'andreas');
  assert.deepEqual(k.an('/k/arr/arm').map((z) => [z.felder.spur, z.felder.modus]), [[1, 2], [2, 2]], 'the mode switch sends the arm again for every armed track');
  assert.equal(s.aktuell().j.auto_arm.modus, 'write');
  k.leere();
  const e = await s.autoArm({ spur_id: 's3', an: true }, 'cypher').catch((x) => x);
  assert.deepEqual([e.code, e.fehler], [403, 'nur_andreas'], 'Cypher may not arm (D9)');
  assert.equal(s.aktuell().j.auto_arm.spuren.includes('s3'), false, 'a refused arm leaves no mark');
  k.ki = true;
  const ki = await s.autoArm({ spur_id: 's3', an: true }, 'cypher').catch((x) => x);
  assert.equal(ki.fehler, 'ki_gestoppt'); k.ki = false;
  k.leere();
  const bad = await s.autoArm({ spur_id: 's1', an: true, modus: 'dance' }, 'andreas').catch((x) => x);
  assert.equal(bad.code, 400);
  await s.neu('Zwei', 'andreas');
  const frei = k.an('/k/arr/arm').filter((z) => z.felder.spur === 0 && z.felder.an === 0);
  assert.equal(frei.length, 1, 'project new disarms in the core');
  assert.equal(frei[0].felder.quelle, 'andreas', 'with the source andreas, else the core refuses it');
  assert.equal(s.aktuell().j.auto_arm, undefined, 'and in the session');
});

test('a new core generation clears the arm state and discards open takes; disarm writes what the player did', async (t) => {
  const { k, s, spielt, hand, arme, fertig, lane } = await aufbau(t);
  await arme('s1', 'latch'); spielt(10);
  hand(1, 'fader', 10, -20);
  s.ereignis('/e/neustart', { generation: 99 });
  assert.equal(s.aktuell().j.auto_arm, undefined);
  assert.ok(k.verteilt.some((e) => e.f?.auto_arm?.spuren?.length === 0), 'the page is told');
  const rev0 = s.aktuell().j.projekt.rev;
  await fertig();
  assert.equal(s.aktuell().j.projekt.rev, rev0, 'nothing of the old core is written');
  // disarm while playing writes the take
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  await s.autoArm({ spur_id: 's1', an: false }, 'andreas');
  await s.aufAuto.fertigGeschrieben();
  assert.ok(s.aktuell().j.projekt.rev > rev0, 'disarm wrote the gesture');
  assert.ok(lane('s1').punkte.length >= 3);
});

test('AK17: a locked lane next to an unlocked one in the same take: the unlocked one is written, the locked one is refused and shown', async (t) => {
  const { s, lane, spielt, stopp, hand, arme, fertig, k } = await aufbau(t);
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Lock', befehle: [{ befehl: 'auto_aendern', lane_id: 'a2', gesperrt: true }] }, 'andreas');
  await arme('s1', 'latch'); await arme('s2', 'latch');
  const gesperrt = JSON.stringify(lane('s2')), frei = JSON.stringify(lane('s1'));
  spielt(10);
  hand(1, 'fader', 10, -20); hand(2, 'fader', 10, -20);
  await vor(150);
  s.ereignis('/zustand/arr', arr(2, 14)); await vor(5);
  stopp(14); await fertig();
  assert.notEqual(JSON.stringify(lane('s1')), frei, 'track 1 written');
  assert.equal(JSON.stringify(lane('s2')), gesperrt, 'the locked lane is untouched');
  assert.ok(k.verteilt.some((e) => e.f?.auto_aufnahme?.fehler === 'lane_gesperrt' && e.f.auto_aufnahme.spur_id === 's2'));
});

// --- fix round 1 ---------------------------------------------------------------------------------------------------------------------------

// D14: the fall of the project beat arrives as /zustand/arr BEFORE the next points (the real core sends it at 50 Hz): every mode cuts a pass there
for (const modus of ['touch', 'latch', 'write']) {
  for (const zustandZuerst of [true, false]) {
    test(`loop seam, ${modus}, ${zustandZuerst ? 'the fall comes as /zustand/arr first' : 'the fall is seen in the points only'}: the last pass wins where they overlap`, async (t) => {
      const { s, k, lane, wertBei, stopp, hand, arme, fertig } = await aufbau(t);
      k.leere();
      await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'andreas');
      await arme('s1', modus);
      s.ereignis('/zustand/arr', arr(2, 1, { loop_an: 1 }));
      for (let b = 2; b <= 6; b += 0.5) hand(1, 'fader', b, -20);               // pass 1: beats 2..6 at -20
      if (zustandZuerst) { s.ereignis('/zustand/arr', arr(2, 7.9, { loop_an: 1 })); s.ereignis('/zustand/arr', arr(2, 0.1, { loop_an: 1 })); }
      for (let b = 3; b <= 5; b += 0.5) hand(1, 'fader', b, -10);               // pass 2: beats 3..5 at -10
      if (modus === 'touch') await vor(150);
      else { await vor(150); s.ereignis('/zustand/arr', arr(2, 7)); await vor(3); stopp(7); }
      await fertig();
      const p = lane('s1').punkte;
      const monoton = p.every((q, i) => i === 0 || q.beat >= p[i - 1].beat);
      assert.ok(monoton, JSON.stringify(p));
      assert.ok(Math.abs(wertBei('s1', 2.5) - -20) < 0.31, `@2.5 ${wertBei('s1', 2.5)}`);
      assert.ok(Math.abs(wertBei('s1', 4) - -10) < 0.31, `@4 ${wertBei('s1', 4)} (pass 2 wins)`);
      assert.ok(Math.abs(wertBei('s1', 3.25) - -10) < 0.31, `@3.25 ${wertBei('s1', 3.25)} (inside pass 2, no zigzag)`);
      if (modus === 'touch') assert.ok(Math.abs(wertBei('s1', 5.75) - -20) < 0.31, `@5.75 ${wertBei('s1', 5.75)} (pass 1 again)`);
    });
  }
}

test('a mouse take across the seam is cut into passes too (state first)', async (t) => {
  const { s, lane, wertBei, arme, fertig } = await aufbau(t);
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'andreas');
  await arme('s1', 'touch');
  s.ereignis('/uhr', { beat: 0, bpm: 120 });
  s.ereignis('/zustand/arr', arr(2, 6, { loop_an: 1 }));
  const g = (wert) => s.autoGeste({ spur_id: 's1', ziel: 'fader', wert }, 'andreas').j.beat;
  g(-20);                                                                        // beat ~6
  s.ereignis('/zustand/arr', arr(2, 7.95, { loop_an: 1 })); s.ereignis('/zustand/arr', arr(2, 0.05, { loop_an: 1 }));   // the seam
  g(-10);                                                                        // beat ~0.05, a new pass
  s.autoGeste({ spur_id: 's1', ziel: 'fader', ende: true }, 'andreas');
  await fertig();
  const p = lane('s1').punkte;
  assert.ok(p.every((q, i) => i === 0 || q.beat >= p[i - 1].beat), JSON.stringify(p));
  assert.ok(p.some((q) => q.wert === -20 && q.beat > 5.9 && q.beat < 6.5), `pass 1 point near beat 6: ${JSON.stringify(p)}`);
  assert.ok(Math.abs(wertBei('s1', 0.06) - -10) < 0.31, 'pass 2 near beat 0');
});

test('fix 2: Cypher is refused before any state changes (every body form); for Andreas the mode changes only after the core acknowledged', async (t) => {
  const { k, s, arme } = await aufbau(t);
  await arme('s1', 'touch');
  k.leere();
  for (const body of [{ spur_id: 's1', an: true, modus: 'write' }, { modus: 'write' }, { spur_id: 's2', an: true }, { alle: true }]) {
    const e = await s.autoArm(body, 'cypher').catch((x) => x);
    assert.deepEqual([e.code, e.fehler], [403, 'nur_andreas'], JSON.stringify(body));
    assert.deepEqual(s.aktuell().j.auto_arm, { modus: 'touch', spuren: ['s1'] }, `state unchanged after ${JSON.stringify(body)}`);
  }
  assert.equal(k.an('/k/arr/arm').length, 0, 'nothing went to the core');
  const g = (() => { try { s.autoGeste({ spur_id: 's1', ziel: 'fader', wert: -3 }, 'cypher'); return null; } catch (x) { return x; } })();
  assert.deepEqual([g.code, g.fehler], [403, 'nur_andreas'], 'the gesture route refuses Cypher');
  // Andreas: a refused core answer leaves the mode alone
  const alteRegel = k.regel;
  k.regel = (a, f) => (a === '/k/arr/arm' ? { status: 6, grund: 'format' } : alteRegel(a, f));
  await s.autoArm({ spur_id: 's1', an: true, modus: 'write' }, 'andreas').catch(() => {});
  assert.equal(s.aktuell().j.auto_arm.modus, 'touch', 'the core refused: the mode stays');
  k.regel = alteRegel;
  await s.autoArm({ spur_id: 's1', an: true, modus: 'write' }, 'andreas');
  assert.equal(s.aktuell().j.auto_arm.modus, 'write', 'acknowledged: the mode changes');
});

test('fix 2: Cypher with nothing armed gets 403 and arms nothing', async (t) => {
  const { k, s } = await aufbau(t);
  k.leere();
  const e = await s.autoArm({ spur_id: 's1', an: true, modus: 'latch' }, 'cypher').catch((x) => x);
  assert.deepEqual([e.code, e.fehler], [403, 'nur_andreas']);
  assert.equal(s.aktuell().j.auto_arm, undefined);
  assert.equal(k.an('/k/arr/arm').length, 0);
});

test('fix 3: write holds the base value up to the first grip, then steps to the hand value (first grip differs from the base)', async (t) => {
  const { s, wertBei, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'write');
  spielt(8);
  hand(1, 'fader', 14, -6); hand(1, 'fader', 15, -6);                              // base is -3; the first grip at beat 14 is -6
  await vor(150);
  s.ereignis('/zustand/arr', arr(2, 20)); await vor(5);
  stopp(20); await fertig();
  assert.ok(Math.abs(wertBei('s1', 10) - -3) < 0.01, `@10 ${wertBei('s1', 10)} holds the base (not a ramp: -4.0)`);
  assert.ok(Math.abs(wertBei('s1', 13.9) - -3) < 0.01, `@13.9 ${wertBei('s1', 13.9)}`);
  assert.ok(Math.abs(wertBei('s1', 14.1) - -6) < 0.01, `@14.1 ${wertBei('s1', 14.1)} the step`);
  assert.ok(Math.abs(wertBei('s1', 18) - -6) < 0.01, 'held to the stop');
});

test('a hand release (/e/regler with halter not mensch) ends the gesture at once; a release of another track does not', async (t) => {
  const { s, spielt, hand, arme, fertig } = await aufbau(t, { opt: { autoAufnahme: { ruheMs: 5000, sicherungMs: 5000, gnadeMs: 25 } } });
  await arme('s1', 'touch'); await arme('s2', 'touch');
  spielt(10);
  const rev0 = s.aktuell().j.projekt.rev;
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  s.ereignis('/e/regler', { pfad: 'spur/2/fader', wert: -9, halter: 'frei', sample: 0n, beat: 0 });
  await vor(100);
  assert.equal(s.aktuell().j.projekt.rev, rev0, 'another track\'s release does not end it (the rest is 5 s)');
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -22, halter: 'frei', sample: 0n, beat: 0 });
  await fertig();
  assert.ok(s.aktuell().j.projekt.rev > rev0, 'the release wrote the take long before the rest');
});

// --- fix round 2 ---------------------------------------------------------------------------------------------------------------------------

const meldungen = (k) => k.verteilt.filter((e) => e.f?.auto_aufnahme).map((e) => e.f.auto_aufnahme);
const verzoegert = (k, adresse, ms) => {
  const alt = k.regel;
  k.regel = (a, f) => (a === adresse ? new Promise((ok) => setTimeout(() => ok(alt(a, f)), ms)) : alt(a, f));
  return () => { k.regel = alt; };
};

test('round 2 (riss1): a take queued behind a write never lands in a project opened meanwhile; the page is told which project it was', async (t) => {
  const { k, s, spielt, hand, arme } = await aufbau(t);
  const slugA = s.aktuell().j.slug, revA = s.aktuell().j.projekt.rev;
  const zwei = await s.neu('Zwei', 'andreas');            // a second project with the same ids s1 / a1 (ids are per project)
  let rev = zwei.j.projekt.rev;
  rev = (await s.aendern({ rev, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas')).j.rev;
  rev = (await s.aendern({ rev, label: 'x', befehle: [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }] }, 'andreas')).j.rev;
  // the revision of B is what A has when take 2 is written (A + take 1): the revision check alone cannot tell the projects apart
  while (rev < revA + 1) rev = (await s.aendern({ rev, label: 'x', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -rev }] }, 'andreas')).j.rev;
  const slugB = s.aktuell().j.slug;
  const laneB = () => JSON.stringify(s.aktuell().j.projekt.spuren.find((x) => x.id === 's1').automation[0].punkte);
  const vorB = laneB(), revB = s.aktuell().j.projekt.rev;
  await s.oeffnen(slugA, 'andreas');
  await arme('s1', 'touch'); spielt(10);
  const zurueck1 = verzoegert(k, '/k/arr/stopp', 300), zurueck2 = verzoegert(k, '/k/arr/laden', 100);   // the close of A and the write of take 1 are slow
  const geste = (d) => s.autoGeste({ spur_id: 's1', ziel: 'fader', ...d }, 'andreas');
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22); geste({ ende: true });      // take 1 ends: its write holds the session
  await warte(20);
  hand(1, 'fader', 12, -40); hand(1, 'fader', 13, -41);
  const offen = s.oeffnen(slugB, 'andreas');                                          // the user opens the other project meanwhile
  geste({ ende: true });                                                              // take 2 ends: queued behind the open
  await offen; zurueck1(); zurueck2(); await s.aufAuto.fertigGeschrieben();
  assert.equal(s.aktuell().j.slug, slugB);
  assert.equal(laneB(), vorB, 'project B: the lane is untouched by a take of project A');
  assert.equal(s.aktuell().j.projekt.rev, revB, 'project B: no history entry');
  const verloren = meldungen(k).filter((m) => m.fehler === 'projekt_gewechselt');
  assert.ok(verloren.length >= 1 && verloren.every((m) => m.slug === slugA && m.spur_id === 's1' && m.ziel === 'fader' && m.text), JSON.stringify(meldungen(k)));
});

test('round 2 (riss1): the slug is in the auto_aufnahme payload of a written take (negative control: same project, nothing dropped)', async (t) => {
  const { k, s, spielt, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  await fertig();
  assert.deepEqual(meldungen(k).map((m) => [m.spur_id, m.ziel, m.slug, m.fehler]), [['s1', 'fader', s.aktuell().j.slug, undefined]]);
});

test('round 2 (riss3): a value out of range is refused at the entry with argument_ungueltig, with the range of the lane itself', async (t) => {
  const { s, spielt, arme } = await aufbau(t);
  await arme('s1', 'write'); spielt(10);
  const geste = (ziel, wert) => { try { return s.autoGeste({ spur_id: 's1', ziel, wert }, 'andreas'); } catch (e) { return e; } };
  for (const [ziel, wert] of [['pan', 99], ['pan', -1.01], ['fader', 12], ['fader', -500], ['mute', 0.5], ['solo', 2]]) {
    const e = geste(ziel, wert);
    assert.deepEqual([e.code, e.fehler], [400, 'argument_ungueltig'], `${ziel} ${wert}`);
  }
  for (const [ziel, wert] of [['pan', 0.5], ['pan', -1], ['fader', -20], ['mute', 1], ['solo', 0]]) {   // negative controls: in range, recorded
    assert.equal(geste(ziel, wert).j?.aufgenommen, true, `${ziel} ${wert}`);
  }
});

test('round 2 (riss3): one bad field cannot sink the batch: the others are written, the bad one is refused and shown', async (t) => {
  const { k, s, lane, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch'); await arme('s2', 'touch'); spielt(10);
  const vorher = JSON.stringify(lane('s1'));
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  hand(2, 'pan', 10, 99); hand(2, 'pan', 11, 98);                    // the core reported a pan far out of range (the page entry cannot see these)
  stopp(12); await fertig();
  assert.notEqual(JSON.stringify(lane('s1')), vorher, 'the good field is written');
  assert.equal(lane('s2', 'pan'), undefined, 'the bad field is not');
  const m = meldungen(k);
  assert.ok(m.some((x) => x.spur_id === 's2' && x.ziel === 'pan' && x.fehler && x.text), `the bad field is shown: ${JSON.stringify(m)}`);
  assert.ok(m.some((x) => x.spur_id === 's1' && x.ziel === 'fader' && x.punkte > 0), 'the good one is reported as written');
  assert.deepEqual(historie(s).filter((l) => l.startsWith('Record')), ['Record fader Audio 1']);
});

test('round 2 (riss2): a write does not give a field back while a new take of it is open; that take gives it back at its own end', async (t) => {
  const { k, s, spielt, hand, arme } = await aufbau(t);
  await arme('s1', 'touch'); spielt(10);
  const zurueck = verzoegert(k, '/k/arr/laden', 200);
  k.leere();
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -22, halter: 'frei', sample: 0n, beat: 0 });   // take 1 ends, its write waits for the core
  await warte(40);
  hand(1, 'fader', 12, -40); hand(1, 'fader', 12.5, -41);                                         // the hand grips again: take 2 is open
  await warte(300);                                                                                  // write 1 is through
  const frei = () => k.gesendet.filter((z) => (z.adresse === '/k/arr/auto' && z.felder.an === 1) || (z.adresse === '/k/teil' && z.felder.pfad === 'spur/1/fader'));
  assert.equal(s.aufAuto.felder.has('s1/fader'), true, 'take 2 is open');
  assert.deepEqual(frei(), [], 'neither the lane is switched on nor the base value sent while the hand holds the field');
  zurueck();
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -41, halter: 'frei', sample: 0n, beat: 0 });   // take 2 ends
  await s.aufAuto.fertigGeschrieben();
  assert.deepEqual(frei().map((z) => z.adresse), ['/k/arr/auto', '/k/teil'], 'the end of take 2 gave it back once, then the base value');
});

test('round 2: a deleted track is not armed any more; the number it held belongs to the next track; the core is told', async (t) => {
  const { k, s, spielt, arme } = await aufbau(t);
  await arme('s1', 'touch'); await arme('s2', 'touch'); spielt(10);
  assert.equal(s.aufAuto.unterdrueckt('spur/2/fader'), true, 'armed and playing: suppressed');
  k.leere();
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Del', befehle: [{ befehl: 'spur_loeschen', spur_id: 's2' }, { befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const neu = s.aktuell().j.projekt.spuren.find((x) => x.nr === 2);
  assert.ok(neu && neu.id !== 's2', 'the new track took the number 2');
  assert.equal(s.aufAuto.unterdrueckt('spur/2/fader'), false, 'the new track is not suppressed');
  assert.deepEqual(s.aufAuto.armiertListe(), [{ id: 's1', nr: 1 }], 'and not armed again');
  assert.deepEqual(s.aktuell().j.auto_arm.spuren, ['s1']);
  await warte(10);
  assert.deepEqual(k.an('/k/arr/arm').map((z) => [z.felder.spur, z.felder.an, z.felder.quelle]), [[2, 0, 'andreas']], 'the core got the disarm of the number');
  assert.equal(k.core.has(2), false);
  assert.equal(s.aufAuto.unterdrueckt('spur/1/fader'), true, 'negative control: the armed track is still suppressed');
});

test('round 2: arm calls run one at a time (the second waits for the core acknowledgement of the first)', async (t) => {
  const { k, s } = await aufbau(t);
  const sende = k.sende, reihe = [];
  k.sende = (a, f) => { if (a === '/k/arr/arm') reihe.push(`send ${f.spur}`); return sende(a, f); };
  const alt = k.regel;
  k.regel = (a, f) => (a === '/k/arr/arm' ? new Promise((ok) => setTimeout(() => { reihe.push(`ack ${f.spur}`); ok(alt(a, f)); }, 60)) : alt(a, f));
  await Promise.all([s.autoArm({ spur_id: 's1', an: true }, 'andreas'), s.autoArm({ spur_id: 's2', an: true }, 'andreas')]);
  assert.deepEqual(reihe, ['send 1', 'ack 1', 'send 2', 'ack 2']);
  assert.deepEqual([...k.core.keys()], [1, 2]);
});

test('round 2: an arm whose project closed meanwhile ends unarmed in the core and the session', async (t) => {
  const { k, s, spielt } = await aufbau(t);
  const slugA = s.aktuell().j.slug;
  const zurueck = verzoegert(k, '/k/arr/arm', 80);
  const arm = s.autoArm({ spur_id: 's1', an: true }, 'andreas').catch((e) => e);
  await warte(10);
  await s.neu('Zwei', 'andreas');                                                 // the project is closed while the core acknowledges
  const e = await arm; zurueck();
  await warte(120);
  assert.equal(e.fehler, 'projekt_gewechselt');
  assert.equal(s.aufAuto.istArm(), false);
  assert.equal(k.core.size, 0, 'the core holds nothing armed');
  assert.notEqual(s.aktuell().j.slug, slugA); void spielt;
});

const MODUS_NR = { touch: 0, latch: 1, write: 2 };
test('round 2: a mode switch that fails halfway is rolled back: core and server end up equal', async (t) => {
  const { k, s } = await aufbau(t);
  await s.autoArm({ spur_id: 's1', an: true, modus: 'touch' }, 'andreas'); await s.autoArm({ spur_id: 's2', an: true }, 'andreas');
  await s.autoArm({ spur_id: 's3', an: true }, 'andreas');
  const gleich = () => {
    const server = Object.fromEntries(s.aufAuto.armiertListe().map((a) => [a.nr, MODUS_NR[s.aufAuto.ansicht().modus]]));
    return JSON.stringify([server, Object.fromEntries(k.core)]);
  };
  const [vorS, vorK] = JSON.parse(gleich());
  assert.deepEqual(vorS, vorK);
  k.nein = (a, f) => (a === '/k/arr/arm' && f.spur === 3 && f.modus === 2 ? { status: 6, grund: 'ungueltig' } : undefined);   // the third track refuses write
  const e = await s.autoArm({ modus: 'write' }, 'andreas').catch((x) => x);
  assert.ok(e.code >= 400, 'the switch failed');
  const [nachS, nachK] = JSON.parse(gleich());
  assert.deepEqual(nachS, nachK, 'core and server are equal');
  assert.equal(s.aufAuto.ansicht().modus, 'touch', 'the server kept the old mode');
  assert.deepEqual(nachK, { 1: 0, 2: 0, 3: 0 }, 'and the core was rolled back to it');
  // a rollback the core refuses too: everything is disarmed on both sides
  k.nein = (a, f) => (a === '/k/arr/arm' && f.spur !== 0 && f.an === 1 && f.modus === 2 ? { status: 6, grund: 'ungueltig' } : a === '/k/arr/arm' && f.spur === 2 && f.modus === 0 && f.an === 1 ? { status: 6, grund: 'ungueltig' } : undefined);
  const e2 = await s.autoArm({ modus: 'write' }, 'andreas').catch((x) => x);
  assert.ok(e2.code >= 400);
  const [s2, k2] = JSON.parse(gleich());
  assert.deepEqual(s2, k2, 'equal after a failed rollback too');
});

test('round 3: a mode switch whose acknowledgement is lost (null) is rolled back too: core and server end up equal', async (t) => {
  const { k, s } = await aufbau(t);
  await s.autoArm({ spur_id: 's1', an: true }, 'andreas'); await s.autoArm({ spur_id: 's2', an: true }, 'andreas');
  k.verloren = (f) => f.spur === 2 && f.modus === 2 && f.an === 1;
  const e = await s.autoArm({ modus: 'write' }, 'andreas').catch((x) => x);
  assert.ok(e.code >= 400, 'the switch failed');
  k.verloren = null;
  assert.equal(s.aufAuto.ansicht().modus, 'touch');
  assert.deepEqual(Object.fromEntries(k.core), { 1: 0, 2: 0 }, 'the core holds the old mode for the track whose acknowledgement was lost too');
  // a lost acknowledgement of a plain arm: the track is not armed in the server, so it must not stay armed in the core
  k.verloren = (f) => f.spur === 3 && f.an === 1;
  const e3 = await s.autoArm({ spur_id: 's3', an: true }, 'andreas').catch((x) => x);
  k.verloren = null;
  assert.ok(e3.code >= 400);
  assert.equal(s.aufAuto.armiert('s3'), false);
  assert.equal(k.core.has(3), false, 'and not in the core');
});

test('round 3: a mode alone sends the arm again for every armed track even when the mode is unchanged (resync)', async (t) => {
  const { k, s } = await aufbau(t);
  await s.autoArm({ spur_id: 's1', an: true, modus: 'latch' }, 'andreas'); await s.autoArm({ spur_id: 's2', an: true }, 'andreas');
  k.leere();
  await s.autoArm({ modus: 'latch' }, 'andreas');
  assert.deepEqual(k.an('/k/arr/arm').map((z) => [z.felder.spur, z.felder.an, z.felder.modus]), [[1, 1, 1], [2, 1, 1]]);
});

test('round 3: the base value goes only to fields whose lane switch-on was acknowledged (throw, null, refused)', async (t) => {
  const varianten = { throw: () => { throw new Error('core gone'); }, null: () => null, refused: () => ({ status: 6, grund: 'ungueltig' }) };
  for (const [name, antwort] of Object.entries(varianten)) {
    const { k, s, spielt, stopp, hand, arme, fertig } = await aufbau(t);
    await arme('s1', 'touch'); await arme('s2', 'touch'); spielt(10);
    hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22); hand(2, 'fader', 10, -20); hand(2, 'fader', 11, -22);
    k.nein = (a, f) => (a === '/k/arr/auto' && f.an === 1 && f.spur === 2 ? antwort() : undefined);
    k.leere();
    stopp(12); await fertig();
    const teil = k.gesendet.filter((z) => z.adresse === '/k/teil').map((z) => z.felder.pfad);
    assert.deepEqual(teil, ['spur/1/fader'], `${name}: the base value only for the track that was given back`);
    const m = meldungen(k);
    assert.ok(m.some((x) => x.spur_id === 's2' && x.fehler === 'aufnahme_fehler' && x.text), `${name}: reported ${JSON.stringify(m)}`);
    assert.ok(m.some((x) => x.spur_id === 's1' && x.punkte > 0 && !x.fehler), `${name}: the good field is reported as written`);
  }
});

test('round 3: a refused disarm of a pruned number is logged', async (t) => {
  const { k, s, spielt, arme } = await aufbau(t);
  await arme('s2', 'touch'); spielt(10);
  k.nein = (a, f) => (a === '/k/arr/arm' && f.spur === 2 && f.an === 0 ? { status: 6, grund: 'ungueltig' } : undefined);
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Del', befehle: [{ befehl: 'spur_loeschen', spur_id: 's2' }] }, 'andreas');
  s.aufAuto.raeume(); await warte(20);
  assert.ok(k.protokoll.some((z) => z.typ === 'proj_arm_frei_fehler'), JSON.stringify(k.protokoll.slice(-3)));
});

test('round 2: errors in roh and in autoAn reach the page and the others are still given back', async (t) => {
  const { k, s, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch'); await arme('s2', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22); hand(2, 'fader', 10, -20); hand(2, 'fader', 11, -22);
  const rohAlt = s.aufAuto.roh.bind(s.aufAuto);
  s.aufAuto.roh = (f, b) => { if (f.spurId === 's1') throw new Error('boom'); return rohAlt(f, b); };
  k.nein = (a, f) => { if (a === '/k/arr/auto' && f.spur === 2) throw new Error('core gone'); return undefined; };
  k.leere();
  stopp(12); await fertig();
  const m = meldungen(k);
  assert.ok(m.some((x) => x.spur_id === 's1' && x.fehler === 'aufnahme_fehler' && x.text), `roh: ${JSON.stringify(m)}`);
  assert.ok(m.some((x) => x.spur_id === 's2' && x.fehler === 'aufnahme_fehler' && x.text), `autoAn: ${JSON.stringify(m)}`);
  assert.equal(k.an('/k/arr/auto').filter((z) => z.felder.an === 1 && z.felder.spur === 1).length, 1, 'the field whose take failed in roh is given back');
  assert.ok(k.gesendet.some((z) => z.adresse === '/k/teil' && z.felder.pfad === 'spur/1/fader'), 'and the base value still went out');
});

test('round 2: the lane switch-on of one take goes out in parallel (128 fields)', async (t) => {
  const k = kern();
  const { s } = sitzung(t, { ...OPT, autoAufnahme: { ...OPT.autoAufnahme, uhr: (uhr = falscheUhr()) } }, k);
  await s.neu('Viele', 'andreas');
  const ZIELE = ['fader', 'pan', 'mute', 'solo'];
  let rev = (await s.aendern({ rev: 0, label: 'x', befehle: Array.from({ length: 32 }, () => ({ befehl: 'spur_neu', art: 'audio' })) }, 'andreas')).j.rev;
  const bef = [];
  for (let n = 1; n <= 32; n++) for (const z of ZIELE) bef.push({ befehl: 'auto_neu', spur_id: `s${n}`, ziel: z });
  rev = (await s.aendern({ rev, label: 'x', befehle: bef }, 'andreas')).j.rev;
  for (let n = 1; n <= 32; n++) await s.autoArm({ spur_id: `s${n}`, an: true, modus: 'write' }, 'andreas');
  s.ereignis('/zustand/arr', arr(2, 4));
  let laufend = 0, hoechstens = 0;                       // calls sent and not yet acknowledged
  const alt = k.regel;
  k.regel = (a, f) => (a === '/k/arr/auto' && f.an === 1
    ? new Promise((ok) => { hoechstens = Math.max(hoechstens, ++laufend); setTimeout(() => { laufend--; ok(alt(a, f)); }, 5); }) : alt(a, f));
  k.leere();
  s.ereignis('/zustand/arr', arr(0, 8));
  await vor(100); await s.aufAuto.fertigGeschrieben();
  assert.equal(k.an('/k/arr/auto').filter((z) => z.felder.an === 1).length, 128, 'every field is given back');
  assert.equal(hoechstens, 128, `all 128 calls were in flight together (a sequential send would show 1): ${hoechstens}`);
});

// --- the survivors of the mutation review: each of these goes red when its line is taken out -------------------------------------------------

test('mutant (a): a project switch leaves no open take behind (verwirf clears the fields) and tells the page nothing', async (t) => {
  const { k, s, spielt, hand, arme } = await aufbau(t);
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  assert.equal(s.aufAuto.felder.size, 1);
  await s.neu('Zwei', 'andreas');
  assert.equal(s.aufAuto.felder.size, 0, 'no open take');
  await vor(1000); await s.aufAuto.fertigGeschrieben();
  assert.deepEqual(meldungen(k), [], 'nothing was written and nothing refused: the take was never queued');
});

test('mutant (b): a project open takes the arm of a call that finished while the old project was closing', async (t) => {
  const { k, s, spielt } = await aufbau(t);
  const slugA = s.aktuell().j.slug;
  spielt(10);
  const zurueck = verzoegert(k, '/k/arr/stopp', 150);
  const offen = s.oeffnen(slugA, 'andreas');                   // the same project again: same ids, so nothing could prune the arm
  await warte(30);
  await s.autoArm({ spur_id: 's1', an: true }, 'andreas');     // the old project is still open: the arm goes through
  await offen; zurueck();
  assert.equal(s.aktuell().j.auto_arm, undefined, 'the opened project starts unarmed');
  assert.equal(s.aufAuto.istArm(), false);
});

test('mutant (c): takes are written one after the other: the second is built on the lane the first created', async (t) => {
  const { k, s, lane, spielt, hand, arme } = await aufbau(t, { lanen: [] });
  await arme('s1', 'touch'); spielt(10);
  const zurueck = verzoegert(k, '/k/arr/laden', 60);
  const ende = () => s.ereignis('/e/regler', { pfad: 'spur/1/pan', wert: 0, halter: 'frei', sample: 0n, beat: 0 });
  hand(1, 'pan', 10, 0.5); hand(1, 'pan', 11, 0.6); ende();
  hand(1, 'pan', 13, -0.5); hand(1, 'pan', 14, -0.6); ende();
  await s.aufAuto.fertigGeschrieben(); zurueck();
  const lanen = s.aktuell().j.projekt.spuren.find((x) => x.id === 's1').automation.filter((l) => l.ziel === 'pan');
  assert.equal(lanen.length, 1, 'one pan lane');
  assert.ok(lanen[0].punkte.some((p) => p.beat === 10) && lanen[0].punkte.some((p) => p.beat === 14), 'both takes are in it');
  assert.deepEqual(historie(s).filter((l) => l.startsWith('Record')), ['Record pan Audio 1', 'Record pan Audio 1']);
});

test('mutant (d): the end of a stale field object does not close the new field of the same key', async (t) => {
  const { s, spielt, hand, arme } = await aufbau(t);
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  const alt = s.aufAuto.felder.get('s1/fader');
  await s.autoArm({ spur_id: 's1', an: false }, 'andreas');       // the disarm closes the first take
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 12, -30);
  const neu = s.aufAuto.felder.get('s1/fader');
  assert.ok(neu && neu !== alt);
  s.aufAuto.geschenEnde(alt);                                      // a late end of the old one
  assert.equal(s.aufAuto.felder.get('s1/fader'), neu, 'the new take is still open');
});

test('mutant (e): the loop seam alone (no new point) cuts the pass: a held value goes on into the next pass', async (t) => {
  const { s, wertBei, hand, arme, stopp, fertig } = await aufbau(t);
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'andreas');
  await arme('s1', 'latch');
  s.ereignis('/zustand/arr', arr(2, 4, { loop_an: 1 }));
  hand(1, 'fader', 5, -20);                                         // one grip, then the hand rests
  s.ereignis('/zustand/arr', arr(2, 7.9, { loop_an: 1 })); s.ereignis('/zustand/arr', arr(2, 0.1, { loop_an: 1 }));   // the seam
  s.ereignis('/zustand/arr', arr(2, 3, { loop_an: 1 }));
  stopp(3); await fertig();
  assert.ok(Math.abs(wertBei('s1', 7) - -20) < 0.31, `@7 ${wertBei('s1', 7)}: held to the loop end`);
  assert.ok(Math.abs(wertBei('s1', 1) - -20) < 0.31, `@1 ${wertBei('s1', 1)}: held from the loop start on`);
  assert.ok(Math.abs(wertBei('s1', 2.9) - -20) < 0.31, `@2.9 ${wertBei('s1', 2.9)}: to the stop`);
});

test('mutant (f): a stop takes the rest timers of the fields: a point in the grace joins the same take, one write', async (t) => {
  const { s, lane, spielt, stopp, hand, arme } = await aufbau(t);
  await arme('s1', 'touch'); spielt(10);
  const rev0 = s.aktuell().j.projekt.rev;
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  await vor(50);                                                    // the rest (60) would be due 10 ms after the stop below
  stopp(11.2);
  await vor(10);                                                    // the rest timer of the field is due now; the grace (25) is not over
  hand(1, 'fader', 11.3, -40);                                      // the held point of the hand, inside the grace
  await vor(100); await s.aufAuto.fertigGeschrieben();
  assert.deepEqual(historie(s).filter((l) => l.startsWith('Record')), ['Record fader Audio 1'], 'one take');
  assert.ok(s.aktuell().j.projekt.rev > rev0);
  assert.ok(lane('s1').punkte.some((p) => p.beat === 11.3 && p.wert === -40), 'with the point of the grace');
  assert.equal(uhr.offen(), 0, 'no timer is left');
});

test('mutant (g): a take write retries when the revision moved under it (rev_veraltet)', async (t) => {
  const { k, s, lane, spielt, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  const rev = s.aktuell().j.projekt.rev;
  const user = s.aendern({ rev, label: 'User edit', befehle: [{ befehl: 'spur_aendern', spur_id: 's3', fader_db: -9 }] }, 'andreas');   // queued first
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -22, halter: 'frei', sample: 0n, beat: 0 });                      // the take is written behind it
  await user; await s.aufAuto.fertigGeschrieben();
  assert.deepEqual(historie(s).slice(-2), ['User edit', 'Record fader Audio 1'], 'both landed, the take on the new revision');
  assert.deepEqual(meldungen(k).map((m) => m.fehler), [undefined], 'nothing refused'); void lane; void fertig;
});

// --- fix round 4: one queue for regulator writes --------------------------------------------------------------------------------------------

// the core refuses a second /k/teil of a regulator while another one of it is still open (ueberlappung; stellwerk/einsortieren.cpp, stand-in controls.mjs)
function ueberlappungsKern(k) {
  const offen = new Set(), abgelehnt = [], reihe = [];
  const alt = k.regel;
  k.regel = (a, f) => {
    if (a !== '/k/teil') return alt(a, f);
    if (offen.has(f.pfad)) { abgelehnt.push(f.pfad); return { status: 6, grund: 'ueberlappung' }; }
    offen.add(f.pfad); reihe.push([f.pfad, f.nach]);
    return new Promise((ok) => setTimeout(() => { offen.delete(f.pfad); ok({ status: 3, grund: '' }); }, 25));
  };
  return { abgelehnt, reihe };
}
async function basisGegenSeite(t, seitenSpur) {
  const { k, s, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  const m = ueberlappungsKern(k);
  const regel = k.regel;
  let seite = null;
  // the page writes its regulator at the moment the server switches the lane on again: the base value follows right behind
  k.regel = (a, f) => {
    if (a === '/k/arr/auto' && f.an === 1 && seite === null) {
      seite = s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Page', befehle: [{ befehl: 'spur_aendern', spur_id: seitenSpur, fader_db: -10 }] }, 'andreas');
    }
    return regel(a, f);
  };
  stopp(12); await fertig(); await seite;
  return { k, s, m };
}
test('round 4: the page writes the regulator of the base value at the same moment: neither is refused, the later one in send order wins', async (t) => {
  const { s, m } = await basisGegenSeite(t, 's1');
  assert.deepEqual(m.abgelehnt, [], 'no ueberlappung');
  const fader1 = m.reihe.filter(([p]) => p === 'spur/1/fader');
  assert.equal(fader1.length, 2, 'the page value and the base value were both sent');
  assert.equal(fader1.at(-1)[1], -10, 'the last value sent is the project value (the base value is read when its turn comes)');
  assert.equal(s.aktuell().j.projekt.spuren.find((x) => x.id === 's1').fader_db, -10);
});
test('round 4: negative control: the page writes another regulator; both go out, nothing is refused', async (t) => {
  const { m } = await basisGegenSeite(t, 's2');
  assert.deepEqual(m.abgelehnt, []);
  assert.deepEqual(m.reihe.map(([p]) => p).sort(), ['spur/1/fader', 'spur/2/fader']);
});

// task 10 fixup: the first transport state of a start may carry a project beat a hair below 0 (clock fit, sample rounding). A write take that seeded its first point
// there was refused as a whole with argument_ungueltig (point beat below 0), the lane stayed untouched ("geschrieben 0", 1 of 3 stand-in runs of the acceptance script).
test('fixup: a first state with a project beat just below 0 does not sink a write take (beats are clamped to 0)', async (t) => {
  const { s, lane, wertBei, spielt, stopp, arme, fertig } = await aufbau(t);
  await arme('s1', 'write');
  const rev0 = s.aktuell().j.projekt.rev;
  spielt(-0.002);
  s.ereignis('/zustand/arr', arr(2, 3)); await vor(5);
  stopp(6); await fertig();
  assert.ok(s.aktuell().j.projekt.rev > rev0, 'the take was written');
  assert.ok(lane('s1').punkte.every((q) => q.beat >= 0), `no point below beat 0: ${JSON.stringify(lane('s1').punkte.slice(0, 3))}`);
  assert.ok(Math.abs(wertBei('s1', 2) - -3) < 0.01, `write fills with the base value: ${wertBei('s1', 2)}`);
});

// --- wave B fixup: base captured at take start; pass not ended past the seam; base refusal logged ----------------------------------------------

// F3: a mouse take on a track WITHOUT a lane. The page writes the gesture into the project value (spur_aendern) as well as sending it as /geste;
// the order of the two requests at the server is not fixed. The lane must play the value from before the gesture outside it, and the project value
// goes back to it in the same entry.
for (const modus of ['touch', 'latch']) {
  for (const reihenfolge of ['geste first', 'write first']) {
    test(`F3 ${modus}, ${reihenfolge}: no lane yet, the mouse writes the project value too: the lane plays -3 outside the take, the project value is -3 after it`, async (t) => {
      const { s, lane, wertBei, spielt, stopp, arme, fertig } = await aufbau(t, { lanen: [] });
      const fader = () => s.aktuell().j.projekt.spuren.find((x) => x.id === 's1').fader_db;
      s.ereignis('/uhr', { beat: 0, bpm: 120 });
      await arme('s1', modus); spielt(10);
      const rev0 = s.aktuell().j.projekt.rev, eintraege0 = historie(s).length;
      for (const v of [-5, -8, -12, -20]) {
        const g = () => s.autoGeste({ spur_id: 's1', ziel: 'fader', wert: v }, 'andreas');
        const w = () => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Volume', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: v }] }, 'andreas');
        if (reihenfolge === 'geste first') { g(); await w(); } else { await w(); g(); }
        await vor(100);
      }
      assert.equal(fader(), -20, 'while the mouse holds it the project value follows (the page writes it)');
      if (modus === 'touch') s.autoGeste({ spur_id: 's1', ziel: 'fader', ende: true }, 'andreas');
      else { s.ereignis('/zustand/arr', arr(2, 14)); stopp(14); }
      await fertig();
      assert.ok(lane('s1'), 'the take made a lane');
      assert.ok(Math.abs(wertBei('s1', 2) - -3) < 0.01, `@2 ${wertBei('s1', 2)}: before the gesture the lane plays the value from before it`);
      assert.ok(Math.abs(wertBei('s1', 9.9) - -3) < 0.01, `@9.9 ${wertBei('s1', 9.9)}`);
      assert.ok(wertBei('s1', 10.5) < -4, `@10.5 ${wertBei('s1', 10.5)}: inside the take`);
      if (modus === 'touch') assert.ok(Math.abs(wertBei('s1', 30) - -3) < 0.01, `@30 ${wertBei('s1', 30)}: after the take`);
      else assert.ok(Math.abs(wertBei('s1', 13.5) - -20) < 0.31, `@13.5 ${wertBei('s1', 13.5)}: latch holds the last value to the stop`);
      assert.equal(fader(), -3, 'the project value goes back: it belongs to the take (D10)');
      assert.ok(s.aktuell().j.projekt.rev > rev0);
      const neu = historie(s).slice(eintraege0).filter((l) => l.startsWith('Record'));
      assert.equal(neu.length, 1, 'one entry for lane and restore');
    });
  }
}
test('F3 negative control: a hand take (the project value never changes) writes no restore, an unarmed page write notes nothing', async (t) => {
  const { s, spielt, stopp, hand, arme, fertig } = await aufbau(t, { lanen: [] });
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Volume', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -9 }] }, 'andreas');   // unarmed track
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  stopp(12); await fertig();
  assert.equal(s.aktuell().j.projekt.spuren.find((x) => x.id === 's1').fader_db, -3);
  assert.equal(s.aktuell().j.projekt.spuren.find((x) => x.id === 's2').fader_db, -9, 'the unarmed track keeps its write');
  assert.equal(s.aufAuto.basen.size, 0);
});

// F2: the first point behind the loop seam arrives BEFORE the /zustand/arr that shows the beat fall
for (const modus of ['latch', 'write']) {
  test(`F2 ${modus}: a point behind the seam before the state of the fall: the new pass is not ended again`, async (t) => {
    const { s, wertBei, hand, arme, stopp, fertig } = await aufbau(t);
    await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'andreas');
    await arme('s1', modus);
    s.ereignis('/zustand/arr', arr(2, 1, { loop_an: 1 }));
    for (let b = 2; b <= 7.5; b += 0.5) hand(1, 'fader', b, -20);        // pass 1
    hand(1, 'fader', 0.05, -10);                                           // the first point of pass 2 comes first
    s.ereignis('/zustand/arr', arr(2, 0.1, { loop_an: 1 }));               // the state of the fall comes second
    s.ereignis('/zustand/arr', arr(2, 3.2, { loop_an: 1 }));
    stopp(3.2); await fertig();
    for (const b of [3.5, 5, 7.5]) assert.ok(Math.abs(wertBei('s1', b) - -20) < 0.31, `@${b} ${wertBei('s1', b)}: pass 1 where pass 2 does not reach`);
    assert.ok(Math.abs(wertBei('s1', 1) - -10) < 0.31, `@1 ${wertBei('s1', 1)}: pass 2 holds its value to the stop`);
  });
}

// F1: the core refuses the base value while the hand holds the regulator; it is sent when the holder is released
test('F1: a refused base value is logged and sent when the holder is released; a new grip drops it (negative control: other path untouched)', async (t) => {
  const { k, s, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch'); await arme('s2', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22); hand(2, 'fader', 10, -20); hand(2, 'fader', 11, -22);
  k.nein = (a, f) => (a === '/k/teil' && f.pfad === 'spur/1/fader' ? { status: 6, grund: 'regler_beim_menschen' } : undefined);
  k.leere();
  stopp(12); await fertig();
  assert.ok(k.protokoll.some((z) => z.typ === 'proj_basis_abgelehnt' && z.pfad === 'spur/1/fader' && z.grund === 'regler_beim_menschen'), 'logged');
  assert.equal(k.protokoll.filter((z) => z.typ === 'proj_basis_abgelehnt').length, 1, 'the other track was not refused');
  k.nein = null; k.leere();
  s.ereignis('/e/regler', { pfad: 'spur/2/fader', wert: -3, halter: 'frei', sample: 0n, beat: 0 });
  await warte(20);
  assert.deepEqual(k.teile(), [], 'the release of another regulator sends nothing');
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -22, halter: 'frei', sample: 0n, beat: 0 });
  await warte(40);
  assert.deepEqual(k.teile().map((z) => [z.felder.pfad, z.felder.nach]), [['spur/1/fader', -3]], 'released: the base value goes');
  k.leere();
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -22, halter: 'frei', sample: 0n, beat: 0 });
  await warte(20);
  assert.deepEqual(k.teile(), [], 'and only once');
});
test('F1: a grip after the refusal drops the waiting base value', async (t) => {
  const { k, s, spielt, stopp, hand, arme, fertig } = await aufbau(t);
  await arme('s1', 'touch'); spielt(10);
  hand(1, 'fader', 10, -20); hand(1, 'fader', 11, -22);
  k.nein = (a, f) => (a === '/k/teil' ? { status: 6, grund: 'regler_beim_menschen' } : undefined);
  stopp(12); await fertig();
  k.nein = null; k.leere();
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -30, halter: 'mensch', sample: 0n, beat: 0 });
  s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: -30, halter: 'frei', sample: 0n, beat: 0 });
  await warte(30);
  assert.deepEqual(k.teile(), [], 'the hand value is the truth now');
});
