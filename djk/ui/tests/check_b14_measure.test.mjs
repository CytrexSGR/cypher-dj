// Package 1.14 slice 4 (bounce), unit U5a: calibration of the measuring instruments of the real-core acceptance (check/b14_measure.mjs) on synthetic
// data and on model states: every check passes on good input, every negative control trips. No core, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { unterschied, wende } from '../project/patch.ts';
import { bouncePlan, baueBounceProjekt } from '../project/bounce.ts';
import { PAN_MITTE_DB } from '../project/merge.ts';
import { projektSchluessel, klickOnsets, port, nullDifferenz, nullOk, NULL_TOR_DB, versatz } from '../check/b14_measure.mjs';
import * as w7 from '../check/w7_measure.mjs';

const SHA = 'c'.repeat(64);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
function projekt() {
  let p = neuesProjekt('B14');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Klick' }, { befehl: 'spur_neu', art: 'audio', name: 'Sinus' }]);
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA, name: 'k' },
    { befehl: 'clip_neu', spur_id: 's2', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA, name: 's' }]);
  p = lauf(p, [{ befehl: 'take_neu', spur_id: 's1', name: 'Take 1' }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' },
    { befehl: 'return_neu', name: 'Hall' }]);
  return lauf(p, [{ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }]);
}

test('5a.2 re-exports of the w7 null test: the same functions and the same gate', () => {
  assert.equal(nullDifferenz, w7.nullDifferenz); assert.equal(nullOk, w7.nullOk); assert.equal(versatz, w7.versatz);
  assert.equal(NULL_TOR_DB, -90);
});

test('5a.3 projektSchluessel: rev, wiedergabe_rev and dekodiert do not count; a changed take-lane clip field, an automation point and a send do', () => {
  const p = projekt(), k = projektSchluessel(p);
  const q = structuredClone(p); q.rev += 5; q.wiedergabe_rev += 3;
  q.spuren[0].clips[0].dekodiert = 'fertig';
  q.spuren[0].takes = [{ ...q.spuren[0].takes[0], clips: [] }];
  assert.equal(projektSchluessel(q), k, 'rev, wiedergabe_rev and a main dekodiert do not count');
  const t = lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 8, laenge_beats: 4, sha256: SHA, name: 'neu' }]);
  const mitTakeClip = structuredClone(t); mitTakeClip.spuren[0].takes[0].clips.push(structuredClone(mitTakeClip.spuren[0].clips[1]));
  const kt = projektSchluessel(mitTakeClip);
  const dek = structuredClone(mitTakeClip); dek.spuren[0].takes[0].clips[0].dekodiert = 'laeuft';
  assert.equal(projektSchluessel(dek), kt, 'a dekodiert change in a take lane does not count');
  const feld = structuredClone(mitTakeClip); feld.spuren[0].takes[0].clips[0].gain_db = -1;
  assert.notEqual(projektSchluessel(feld), kt, 'negative control: a changed take-lane clip field changes the key');
  const auto = structuredClone(p); auto.spuren[0].automation[0].punkte.push({ beat: 4, wert: -3 });
  assert.notEqual(projektSchluessel(auto), k, 'an automation point counts');
  const send = structuredClone(p); send.spuren[0].sends[0].db = -7;
  assert.notEqual(projektSchluessel(send), k, 'a send level counts');
});

test('5a.3 projektSchluessel: raised id counters do not count; the bounce-shaped undo pair gives equal keys although naechste_id differs', () => {
  const p = projekt();
  const z = structuredClone(p); z.naechste_id = { ...z.naechste_id, take: 99 }; z.naechste_noten_id = 77;
  assert.equal(projektSchluessel(z), projektSchluessel(p));
  // in place: the clip moves to a lane "Before bounce", a new main clip; then undo through the patch of project/patch.ts
  const nach = baueBounceProjekt(p, bouncePlan(p, { art: 'an_ort', spur_id: 's1' }, 'andreas'), { sha256: 'd'.repeat(64), pfad: '/x/bounce/bounce-1.wav' }).projekt;
  assert.equal(nach.spuren[0].clips[0].gain_db, PAN_MITTE_DB);
  const zurueck = wende(structuredClone(nach), unterschied(nach, p));
  assert.notDeepEqual(zurueck.naechste_id, p.naechste_id, 'the counters stay raised after undo (in no patch)');
  assert.equal(projektSchluessel(zurueck), projektSchluessel(p), 'undo gives the state before by the key');
  assert.notEqual(projektSchluessel(nach), projektSchluessel(p), 'negative control: the bounced state differs');
});

test('5a.3 klickOnsets: the first frame of each 2-sample impulse; a shift by one sample is found', () => {
  const x = new Float32Array(48000);
  for (const i of [100, 24100, 47000]) { x[i] = 0.5; x[i + 1] = 0.5; }
  assert.deepEqual(klickOnsets(x, 0.25), [100, 24100, 47000]);
  const y = new Float32Array(48000);
  for (const i of [101, 24100, 47000]) { y[i] = 0.5; y[i + 1] = 0.5; }
  const a = klickOnsets(x, 0.25), b = klickOnsets(y, 0.25);
  assert.deepEqual(b.map((v, i) => v - a[i]), [1, 0, 0], 'one sample later on the first click');
  assert.deepEqual(klickOnsets(new Float32Array(1000), 0.25), [], 'silence: no onset');
  const leise = new Float32Array(1000); leise[10] = 0.1;
  assert.deepEqual(klickOnsets(leise, 0.25), [], 'below the threshold: no onset');
});

test('5a.3 NK1 on synthetic arrays: B equal passes, B shifted by one sample and B at -3.0103 dB both fail the gate', () => {
  let s = 12345;
  const a = Float32Array.from({ length: 48000 }, () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return 0.5 * (s / 0x3fffffff - 1); });
  assert.ok(nullOk(nullDifferenz(a, Float32Array.from(a))), 'N0: the same export twice');
  const versetzt = new Float32Array(a.length); versetzt.set(a.subarray(0, a.length - 1), 1);
  assert.ok(!nullOk(nullDifferenz(a, versetzt)), 'one sample shift');
  const g = 10 ** (-PAN_MITTE_DB / 20);
  const r = nullDifferenz(a, a.map((v) => v * g));
  assert.ok(!nullOk(r) && r.spitze_db > NULL_TOR_DB, `-3.0103 dB: ${r.spitze_db}`);
});

test('5a.2 port(): 47300 + 1000 * (letter - 96)', () => {
  assert.equal(port('c'), 50300);
  assert.equal(port('e'), 52300);
  assert.throws(() => port('ee')); assert.throws(() => port('E'));
});

// ---- U5b: helper of the real-core acceptance (check/acceptance_b14.mjs) ----
import { spawnSync } from 'node:child_process';
import { onsetsVergleich } from '../check/b14_measure.mjs';

test('5b onsetsVergleich: equal lists pass, one sample off passes within the tolerance, two samples off and a different count fail', () => {
  const a = [0, 24000, 48000, 72000];
  assert.deepEqual(onsetsVergleich(a, [0, 24000, 48000, 72000]), { gleich: true, n_a: 4, n_b: 4, max_abw: 0 });
  assert.deepEqual(onsetsVergleich(a, [0, 24001, 48000, 71999]), { gleich: true, n_a: 4, n_b: 4, max_abw: 1 });
  assert.equal(onsetsVergleich(a, [0, 24002, 48000, 72000]).gleich, false, 'two samples off is outside the +-1 tolerance');
  assert.equal(onsetsVergleich(a, [0, 24000, 48000]).gleich, false, 'a missing onset is a difference, not a shorter equal list');
  assert.equal(onsetsVergleich([], []).gleich, false, 'two empty lists prove nothing');
});

test('5b acceptance_b14.mjs refuses every instance except b, d and e with exit 2 before it touches the network', () => {
  for (const i of ['c', 'f', 'g']) {
    const r = spawnSync(process.execPath, ['check/acceptance_b14.mjs', '--instanz', i, '--aufbau', '/nonexistent.json', '--bau', '/nonexistent'],
      { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 2, `instance ${i}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /only b, d or e/, `instance ${i}`);
  }
  const ohne = spawnSync(process.execPath, ['check/acceptance_b14.mjs'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', timeout: 20000 });
  assert.equal(ohne.status, 2, 'no arguments is a usage error');
});

// ---- U5b review fixes: the verdict logic of the script (check/b14_verdict.mjs) ----
import { urteil, schluss, tabelle, sensZuordnung, wiederholbarkeit } from '../check/b14_verdict.mjs';
const neuesUrteil = () => { const zeilen = []; const u = urteil({ notiere: (kz, ok, t) => zeilen.push(`${ok ? 'OK' : 'FEHL'} ${kz}: ${t}`), info: (t) => zeilen.push(`INFO ${t}`) }); return { ...u, zeilen }; };

test('5b verdict: FINDING is sticky, an OK line before or after it cannot turn it back into OK (review finding 1: N2S read OK)', () => {
  const vorher = neuesUrteil();
  vorher.pr('N2S', true, 'structure line');                 // exactly what pruefeN2 does before tor()
  vorher.finding('N2S', 'gate not met');
  assert.equal(vorher.ergebnis.N2S, 'FINDING', 'finding after an OK line overwrites OK');
  const nachher = neuesUrteil();
  nachher.finding('N2S', 'gate not met');
  nachher.pr('N2S', true, 'a later OK line');
  assert.equal(nachher.ergebnis.N2S, 'FINDING', 'an OK line after a finding does not downgrade it');
  const harmlos = neuesUrteil();                             // negative control: no finding, only OK lines
  harmlos.pr('N2', true, 'a'); harmlos.pr('N2', true, 'b');
  assert.equal(harmlos.ergebnis.N2, 'OK');
});

test('5b verdict: FEHL beats FINDING and OK in every order; NICHT_PRUEFBAR never hides a FINDING or a FEHL, and OK never hides NICHT_PRUEFBAR', () => {
  for (const reihe of [['pr0', 'finding'], ['finding', 'pr0'], ['pr1', 'pr0', 'finding'], ['finding', 'npb', 'pr0'], ['npb', 'pr0'], ['pr0', 'npb']]) {
    const u = neuesUrteil();
    for (const x of reihe) { if (x === 'pr0') u.pr('X', false, 'bad'); else if (x === 'pr1') u.pr('X', true, 'good'); else if (x === 'npb') u.npb('X', 'why'); else u.finding('X', 'f'); }
    assert.equal(u.ergebnis.X, 'FEHL', reihe.join(','));
  }
  const a = neuesUrteil(); a.finding('X', 'f'); a.npb('X', 'why');
  assert.equal(a.ergebnis.X, 'FINDING');
  const b = neuesUrteil(); b.pr('X', true, 'ok'); b.npb('X', 'why');
  assert.equal(b.ergebnis.X, 'NICHT_PRUEFBAR', 'a case that was only partly checkable does not read OK');
  const c = neuesUrteil(); c.npb('X', 'why'); c.pr('X', true, 'ok');
  assert.equal(c.ergebnis.X, 'NICHT_PRUEFBAR');
  const d = neuesUrteil(); d.gut('K'); assert.equal(d.ergebnis.K, 'OK');
});

test('5b verdict: exit 1 on a FEHL, exit 0 on FINDING and NICHT_PRUEFBAR, but "ALLES OK" only when there is neither; the headline names the finding', () => {
  const u = neuesUrteil();
  u.pr('N1', true, 'ok'); u.pr('N2', true, 'ok');
  assert.deepEqual(schluss(u.ergebnis, 0, u.findings), { text: 'ALLES OK', exit: 0 }, 'negative control: all OK');
  u.pr('N2S', true, 'structure'); u.finding('N2S', 'long line with numbers', 'plan-literal N2 gate NOT met (sine as S), N2 substituted by clicks');
  const s = schluss(u.ergebnis, 0, u.findings);
  assert.equal(s.exit, 0, 'a FINDING is not a FEHL');
  assert.notEqual(s.text, 'ALLES OK');
  assert.match(s.text, /FINDING N2S: plan-literal N2 gate NOT met/);
  u.npb('V', 'answered 200 too early');
  assert.match(schluss(u.ergebnis, 0, u.findings).text, /NICHT_PRUEFBAR V/);
  u.pr('B1', false, 'gate missed');
  assert.deepEqual(schluss(u.ergebnis, 1, u.findings), { text: 'FEHL 1 (B1)', exit: 1 }, 'a failing gate gives exit 1');
  assert.equal(schluss({ N1: 'OK' }, 1).exit, 1, 'a counted FEHL line without a case id (cleanup) still gives exit 1');
});

test('5b verdict: the result table prints FINDING for the plan N2 row and "not run" for a case that did not run', () => {
  const u = neuesUrteil();
  u.pr('N2S', true, 'structure'); u.finding('N2S', 'x');
  u.pr('N1', true, 'ok');
  const t = tabelle([['N1', 'B-AK5', 'one source'], ['N2S', 'B-AK5', 'plan N2'], ['P', 'B-AK6', 'paste']], u.ergebnis);
  assert.match(t, /\| N1 \| B-AK5 \| one source \| OK \|/);
  assert.match(t, /\| N2S \| B-AK5 \| plan N2 \| FINDING \|/);
  assert.match(t, /\| P \| B-AK6 \| paste \| not run \|/);
});

test('5b sensZuordnung: HALL only when S without a send stays smooth and with the send steps; a step without the send is a gain-path suspect', () => {
  const T = -90;
  assert.equal(sensZuordnung({ ohneSendBasis0: -140, mitSendBasis0: -57, ohneSendBasisM1: -139, mitSendBasisM1: -56 }, T).urteil, 'HALL');
  assert.equal(sensZuordnung({ ohneSendBasis0: -57, mitSendBasis0: -57, ohneSendBasisM1: -139, mitSendBasisM1: -56 }, T).urteil, 'GAIN_PFAD', 'step at base 0 dB without a send');
  assert.equal(sensZuordnung({ ohneSendBasis0: -140, mitSendBasis0: -57, ohneSendBasisM1: -60, mitSendBasisM1: -56 }, T).urteil, 'GAIN_PFAD', 'step at base -1 dB without a send');
  assert.equal(sensZuordnung({ ohneSendBasis0: -140, mitSendBasis0: -57, ohneSendBasisM1: -139, mitSendBasisM1: -130 }, T).urteil, 'NICHT_ISOLIERT', 'with the send smooth at the non-zero base: not a Hall step in general');
  assert.equal(sensZuordnung({ ohneSendBasis0: -100, mitSendBasis0: -57, ohneSendBasisM1: -139, mitSendBasisM1: -56 }, T).urteil, 'NICHT_ISOLIERT', 'grey zone between -120 and -90');
  assert.equal(sensZuordnung({ ohneSendBasis0: -Infinity, mitSendBasis0: -57, ohneSendBasisM1: -Infinity, mitSendBasisM1: -56 }, T).urteil, 'HALL', 'bit-identical export is a valid smooth value');
  assert.equal(sensZuordnung({ ohneSendBasis0: -140, mitSendBasis0: -57 }, T).urteil, 'NICHT_ISOLIERT', 'missing set-ups are not isolated');
});

test('6 wiederholbarkeit (review U6 finding 1): the mix itself must repeat before a step can be called sensitivity; a failing plain repeat is non-determinism', () => {
  const T = -90;
  assert.equal(wiederholbarkeit({ zweiter: -Infinity, dritter: -Infinity, hinUndZurueck: -Infinity }, T).urteil, 'WIEDERHOLBAR', 'bit-identical exports');
  assert.equal(wiederholbarkeit({ zweiter: -140, dritter: -141, hinUndZurueck: -139 }, T).urteil, 'WIEDERHOLBAR', 'negative control: harmless noise far below the gate');
  assert.equal(wiederholbarkeit({ zweiter: -57, dritter: -58, hinUndZurueck: -57 }, T).urteil, 'NICHT_WIEDERHOLBAR', 'two untouched exports differ by -57 dBFS');
  assert.equal(wiederholbarkeit({ zweiter: -Infinity, dritter: -57, hinUndZurueck: -Infinity }, T).urteil, 'NICHT_WIEDERHOLBAR', 'only the third export differs');
  assert.equal(wiederholbarkeit({ zweiter: -Infinity, dritter: -Infinity, hinUndZurueck: -57 }, T).urteil, 'ZUSTANDSABHAENGIG', 'plain repeats equal, change-and-revert differs');
  assert.equal(wiederholbarkeit({ zweiter: -Infinity, dritter: -Infinity }, T).urteil, 'NICHT_GEMESSEN', 'missing measurement');
  assert.equal(wiederholbarkeit({ zweiter: NaN, dritter: -Infinity, hinUndZurueck: -Infinity }, T).urteil, 'NICHT_GEMESSEN', 'NaN is not a measurement');
});
