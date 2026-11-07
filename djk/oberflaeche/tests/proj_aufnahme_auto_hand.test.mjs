// 1.12 automation slice 3 task 8, AK12: a touch take through /test/hand (the whole hand path: server route /griff, the stand-in's hand, its /e/auto_punkt
// at 50 Hz with the trailing point, the server's collector, the simplification, one aendern). Real time: two bars at 128 bpm are 3.75 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { bis, ruf, sse, warte } from './hilfen/proj_stapel.mjs';
import { laneWert } from '../projekt/lane.ts';

const BEAT_MS = 60000 / 128, SAMPLES_PRO_BEAT = 48000 * 60 / 128;
const u = (db) => (db + 200) / 206;                              // the stand-in maps the fader linearly over -200..6 dB (vertrag.mjs REGLER)

test('AK12: a touch take 0 -> -12 -> 0 dB over two bars hits the gesture within 0.5 dB and 1/16 beat, has <= 40 points, one entry Record, undo removes it whole', async (t) => {
  const { url } = await stapel(t);
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'AK12' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Setup', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: 128 }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const strom = sse(url);
  t.after(() => strom.zu());
  const arm = await ruf(url, 'POST', '/proj/auto/arm', { spur_id: 's1', an: true, modus: 'touch' });
  assert.equal(arm.code, 200, JSON.stringify(arm.j));
  assert.deepEqual(arm.j.auto_arm, { modus: 'touch', spuren: ['s1'] });
  const start = await ruf(url, 'POST', '/proj/transport', { aktion: 'start', beat: 0 });
  assert.equal(start.code, 200, JSON.stringify(start.j));
  const arrEv = () => strom.ereignisse.filter((e) => e.a === '/zustand/arr' && e.f.status === 2).at(-1)?.f;
  assert.ok(await bis(() => arrEv()), 'the transport plays');
  const griff = (db) => ruf(url, 'POST', '/griff', { pfad: 'spur/1/fader', u: u(db) });
  assert.equal((await griff(0)).code, 200);                      // the first hand value is only the position
  await warte(200);
  const t0 = Date.now();
  let n = 0;
  for (;;) {
    const b = (Date.now() - t0) / BEAT_MS;
    if (b > 8) break;
    const db = -12 * (1 - Math.abs(b - 4) / 4);
    assert.equal((await griff(db)).code, 200);
    n++;
    await warte(12);
  }
  await griff(0);
  assert.ok(n > 150, `${n} hand values sent`);
  // the gesture ends after 500 ms without a value; then the take is written
  const ok = await bis(() => strom.ereignisse.some((e) => e.a === 'proj' && e.f.auto_aufnahme), 4000);
  assert.ok(ok, 'the take was written');
  const lage = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const lane = lage.spuren[0].automation[0];
  console.log(`# AK12: ${n} hand values -> ${lane.punkte.length} lane points`);
  assert.equal(lane.ziel, 'fader');
  assert.ok(lane.punkte.length <= 40, `${lane.punkte.length} points`);
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j.at(-1).label, 'Record fader Audio 1', 'one entry');
  // the reference: what the stand-in's hand reported itself (/e/hand: value and sample of the grip); the project beat comes from the stand-in's start
  const arrF = arrEv();
  const ursprung = Number(arrF.ursprung_sample), startBeat = Number(arrF.start_beat);
  const refs = strom.ereignisse.filter((e) => e.a === '/e/hand' && e.f.pfad === 'spur/1/fader')
    .map((e) => ({ beat: startBeat + (Number(e.f.sample) - ursprung) / SAMPLES_PRO_BEAT, db: Number(e.f.wert) }))
    .filter((r) => r.beat > 0.5);
  assert.ok(refs.length > 40, `${refs.length} references`);
  let maxDb = 0;
  for (const r of refs) maxDb = Math.max(maxDb, Math.abs(laneWert(lane.punkte, r.beat, 'fader') - r.db));
  console.log(`# AK12: max deviation to ${refs.length} references: ${maxDb.toFixed(3)} dB`);
  assert.ok(maxDb <= 0.5, `${maxDb} dB`);
  // the beat error: where the course crosses -6 dB, falling and rising (the bottom is flat, its lowest sample is no timing evidence)
  const quer = (f, richtung) => {                                                    // f(beat) sampled on a fine grid between the references
    const von = refs[0].beat, bis_ = refs.at(-1).beat;
    for (let b = von; b < bis_; b += 0.001) if (richtung < 0 ? f(b) > -6 && f(b + 0.001) <= -6 : f(b) < -6 && f(b + 0.001) >= -6) return b;
    return null;
  };
  const refWert = (b) => { const i = refs.findIndex((r) => r.beat >= b); if (i <= 0) return refs[0].db; const p = refs[i - 1], q = refs[i];
    return p.db + (q.db - p.db) * (b - p.beat) / (q.beat - p.beat); };
  const laneF = (b) => laneWert(lane.punkte, b, 'fader');
  const fall = [quer(refWert, -1), quer(laneF, -1)], steig = [quer(refWert, 1), quer(laneF, 1)];
  assert.ok(fall.every((x) => x !== null) && steig.every((x) => x !== null), `crossings ${fall} ${steig}`);
  const fehler = Math.max(Math.abs(fall[0] - fall[1]), Math.abs(steig[0] - steig[1]));
  const tiefster = lane.punkte.reduce((m, p) => (p.wert < m.wert ? p : m));
  console.log(`# AK12: -6 dB crossing falling at ${fall[1].toFixed(4)} (reference ${fall[0].toFixed(4)}), rising at ${steig[1].toFixed(4)} (reference ${steig[0].toFixed(4)}); beat error ${fehler.toFixed(4)}; lowest ${tiefster.wert.toFixed(2)} dB`);
  assert.ok(fehler <= 1 / 16, `beat error ${fehler}`);
  assert.ok(Math.abs(tiefster.wert - -12) <= 0.5, 'the gesture reaches -12 dB');
  // the base value of the project did not move while the take played (D10), and the lane is overridden no more
  assert.equal(lage.spuren[0].fader_db, 0);
  // undo removes the take whole
  const undo = await ruf(url, 'POST', '/proj/undo', { rev: lage.rev });
  assert.equal(undo.code, 200, JSON.stringify(undo.j));
  const nach = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(nach.spuren[0].automation, undefined, 'lane and points are gone');
  await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' });
});

async function aufbauSpielt(t, { loop = null } = {}) {
  const { url } = await stapel(t);
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'Seam' });
  const befehle = [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: 128 }];
  if (loop) befehle.push({ befehl: 'loop_setzen', an: true, von_beat: loop[0], bis_beat: loop[1] });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Setup', befehle });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const strom = sse(url);
  t.after(() => strom.zu());
  // time-stamp every event as it arrives (5 ms resolution), for the reference of the mouse time base
  const zeiten = new WeakMap();
  const uhr = setInterval(() => { for (const e of strom.ereignisse) if (!zeiten.has(e)) zeiten.set(e, Date.now()); }, 5);
  t.after(() => clearInterval(uhr));
  assert.equal((await ruf(url, 'POST', '/proj/auto/arm', { spur_id: 's1', an: true, modus: 'touch' })).code, 200);
  assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'start', beat: 0 })).code, 200);
  const arrEv = () => strom.ereignisse.filter((e) => e.a === '/zustand/arr' && e.f.status === 2).at(-1)?.f;
  assert.ok(await bis(() => arrEv()), 'the transport plays');
  return { url, strom, arrEv, zeiten };
}

test('fix 1: a touch take across the loop seam through /test/hand (the stand-in wraps the loop): passes cut at the seam, the last pass wins, <= 40 points', async (t) => {
  const { url, strom, arrEv } = await aufbauSpielt(t, { loop: [0, 4] });
  const griff = (db) => ruf(url, 'POST', '/griff', { pfad: 'spur/1/fader', u: u(db) });
  await griff(0); await warte(200);
  const t0 = Date.now();
  for (;;) {
    const b = (Date.now() - t0) / BEAT_MS;
    if (b > 10) break;
    const ph = b % 4;
    await griff(-12 * (1 - Math.abs(ph - 2) / 2) - 2 * Math.floor(b / 4));   // every lap 2 dB lower: the passes differ, the last one must win
    await warte(12);
  }                                                                                // no release value: the gesture just rests
  assert.ok(await bis(() => strom.ereignisse.some((e) => e.a === 'proj' && e.f.auto_aufnahme), 4000), 'the take was written');
  const lage = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const lane = lage.spuren[0].automation[0];
  const arrF = arrEv(), ursprung = Number(arrF.ursprung_sample), start = Number(arrF.start_beat);
  const wrap = (b) => 0 + ((b % 4) + 4) % 4;
  const refs = strom.ereignisse.filter((e) => e.a === '/e/hand' && e.f.pfad === 'spur/1/fader')
    .map((e) => ({ roh: start + (Number(e.f.sample) - ursprung) / SAMPLES_PRO_BEAT, db: Number(e.f.wert) }))
    .filter((r) => r.roh > 0.5).map((r) => ({ beat: wrap(r.roh), db: r.db, roh: r.roh, runde: Math.floor(r.roh / 4) }));
  const naehte = refs.filter((r, i) => i > 0 && r.beat < refs[i - 1].beat).length;
  const punkte = lane.punkte;
  let maxDb = 0;
  // the last pass wins: only the references of the last lap count, except near a step of the driver's own lap change
  const letzte = Math.max(...refs.map((r) => r.runde));
  const schritt = (r, i) => [refs[i - 1], refs[i + 1]].some((n) => n && Math.abs(n.db - r.db) > 1.2);
  for (const [i, r] of refs.entries()) if (r.runde === letzte && r.beat > 0.15 && r.beat < 3.85 && !schritt(r, i)) maxDb = Math.max(maxDb, Math.abs(laneWert(punkte, r.beat, 'fader') - r.db));
  console.log(`# seam: ${naehte} seams crossed, ${refs.length} references -> ${punkte.length} lane points, max deviation ${maxDb.toFixed(3)} dB`);
  assert.ok(naehte >= 2, `${naehte} seams`);
  assert.ok(punkte.length <= 40, `${punkte.length} points`);
  assert.ok(punkte.every((p, i) => i === 0 || p.beat >= punkte[i - 1].beat) && punkte.every((p) => p.beat <= 4.0001), 'beats rise, inside the loop');
  assert.ok(maxDb <= 0.5, `${maxDb} dB`);
  await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' });
});

test('fix: the mouse time base across a tempo ramp, measured against the stand-in /uhr', async (t) => {
  const { url, strom, arrEv, zeiten } = await aufbauSpielt(t);
  // truth: the kern beat of /uhr (latest event plus the wall time since it arrived at its bpm) minus the kern beat at the transport start
  const a0 = arrEv(), startSample = Number(a0.ursprung_sample), startBeat = Number(a0.start_beat);
  const uhren = () => strom.ereignisse.filter((e) => e.a === '/uhr');
  assert.ok(await bis(() => uhren().some((e) => Number(e.f.sample) >= startSample)), 'a /uhr event after the start sample');
  const kernBeatBeiSample = (smp) => {                                       // linear between the two /uhr events around the sample (constant tempo before the ramp)
    const l = uhren(); const i = l.findIndex((e) => Number(e.f.sample) >= smp);
    if (i <= 0) return null;
    const p = l[i - 1].f, q = l[i].f;
    return Number(p.beat) + (Number(q.beat) - Number(p.beat)) * (smp - Number(p.sample)) / (Number(q.sample) - Number(p.sample));
  };
  const kernBeat0 = kernBeatBeiSample(startSample);
  assert.ok(kernBeat0 !== null, 'the start sample lies between two /uhr events');
  assert.equal((await ruf(url, 'POST', '/tempo', { bpm: 180 })).code, 200);
  const fehler = [], bpms = [];
  const bisZeit = Date.now() + 7000;
  while (Date.now() < bisZeit) {
    const r = await ruf(url, 'POST', '/proj/auto/geste', { spur_id: 's1', ziel: 'fader', wert: -3 });
    const jetzt = Date.now(), e = uhren().at(-1);
    if (r.j.aufgenommen && e && zeiten.has(e)) {
      const wahr = startBeat + Number(e.f.beat) + (jetzt - zeiten.get(e)) / 60000 * Number(e.f.bpm) - kernBeat0;
      fehler.push(Math.abs(r.j.beat - wahr)); bpms.push(Number(e.f.bpm));
    }
    await warte(20);
  }
  await ruf(url, 'POST', '/proj/auto/geste', { spur_id: 's1', ziel: 'fader', ende: true });
  const inRampe = fehler.filter((_, i) => bpms[i] > 130 && bpms[i] < 178);
  const max = Math.max(...fehler), maxR = Math.max(...inRampe);
  console.log(`# mouse beat vs /uhr: ${fehler.length} samples, max error ${max.toFixed(3)} beat, ${inRampe.length} inside the ramp (bpm ${Math.min(...bpms).toFixed(0)}..${Math.max(...bpms).toFixed(0)}), max error there ${maxR.toFixed(3)} beat`);
  assert.ok(inRampe.length > 10, 'samples inside the ramp');
  assert.ok(Math.max(...bpms) > 170, 'the ramp reached its target');
  assert.ok(maxR <= 0.1, `error inside the ramp ${maxR} beat`);
  await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' });
});
