// node --test tests/rec.test.mjs: Aufnahme in der Attrappe (§4.12, §5.14, 1.8 Slice 1). Spur scharf, Start wartet auf den Einsatz des Arrangements, Quittung 2 dort,
// Ende mit dem Stopp: Quittung 3, /e/aufnahme, Datei aufnahme-<spur>-<kennung>.f32 mit dem Prüfmuster im Arbeitsordner; Ablehnungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fahre } from '../sequences_fast.mjs';
import { arbeitsbestand, sende, erwarte, q, S } from './help.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const spur = (id, nr, scharf, eingang, quelle = 'andreas', modus = 0, monitor = 1) => ['/k/rec/spur', 'hsiiiii', id, quelle, nr, scharf, eingang, modus, monitor];   // 1.8 S0: seven fields
const rstart = (id, kennung, quelle = 'andreas', frist = 0, vorzaehler = 0) => ['/k/rec/start', 'hsiiii', id, quelle, kennung, 0, frist, vorzaehler];   // frist 0: Vorgabe 96000
const laden = (id, nr) => ['/k/arr/laden', 'hsi', id, 'andreas', nr];
const astart = (id) => ['/k/arr/start', 'hsdi', id, 'andreas', 0, 0];
const astopp = (id) => ['/k/arr/stopp', 'hsi', id, 'andreas', 0];

test('rec: eine ganze Aufnahme, Datei mit dem Prüfmuster, /e/aufnahme', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-'));
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 3, 1, 11)),
    erwarte(2000, q(2, 'andreas', 3)),
    sende(2100, rstart(3, 7)),
    erwarte(3000, q(3, 'andreas', 1)),
    sende(3100, astart(4)),
    erwarte(100000, q(3, 'andreas', 2)),             // Quittung 2 am Einsatz des Arrangements
    sende(100000, astopp(5)),
    erwarte(110000, q(3, 'andreas', 3)),
    erwarte(110000, ['/e/aufnahme', 'iiihhii', 3, 7, 0, null, null, 0, 0]),   // 1.8 S0: art 0 (audio)
  ], { cfg }));
  const roh = fs.readFileSync(path.join(ordner, 'aufnahme-3-7.f32'));
  assert.ok(roh.length > 0 && roh.length % 8 === 0, 'ganze Frames');
  assert.equal(roh.readFloatLE(4), -roh.readFloatLE(0), 'R = −L im Prüfmuster');
  assert.ok(fs.existsSync(path.join(ordner, 'aufnahme-3-7.json')));
});

test('rec: Ablehnungen: ohne scharfe Spur kein_eingang, scharf ohne Eingang, Spur 33, wartender Transport ueberlappung', () => {
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec2-')) };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, rstart(2, 1)),
    erwarte(2000, q(2, 'andreas', 6, null, 'kein_eingang')),
    sende(2100, spur(3, 1, 1, 0)),
    erwarte(3000, q(3, 'andreas', 6, null, 'kein_eingang')),
    sende(3100, spur(4, 33, 1, 11)),
    erwarte(4000, q(4, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(4100, spur(5, 1, 1, 11)),
    erwarte(5000, q(5, 'andreas', 3)),
    sende(5100, astart(6)),
    sende(5300, rstart(7, 2)),                              // 1.8 S4b: the transport WAITS (entry about 800 samples after the start): still ueberlappung
    erwarte(6000, q(7, 'andreas', 6, null, 'ueberlappung')),
  ], { cfg }));
});

test('rec: Stopp vor dem Einsatz bricht den Start ab (Quittung 7), keine Datei', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec3-'));
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 1, 1, 12)),
    sende(2100, rstart(3, 9)),
    sende(2600, ['/k/rec/stopp', 'hs', 4, 'andreas']),
    erwarte(4000, q(3, 'andreas', 7, null, 'abbruch')),
    erwarte(4000, q(4, 'andreas', 3)),
  ], { cfg }));
  assert.deepEqual(fs.readdirSync(ordner), []);
});

// --- Nachbesserung 1 -----------------------------------------------------------------------------------------------------------------------
test('rec: Eingang 20 (Master, später) ist eingang_fehlt wie im Kern, 14 ist ausserhalb_bereich (m8)', () => {
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec4-')) };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 1, 1, 20)),
    erwarte(2000, q(2, 'andreas', 6, null, 'eingang_fehlt')),
    sende(2100, spur(3, 1, 1, 14)),
    erwarte(3000, q(3, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(3100, spur(4, 1, 0, 20)),                       // entschärfen mit Eingang 20 ist harmlos (der Kern prüft nur scharf == 1)
    erwarte(4000, q(4, 'andreas', 3)),
  ], { cfg }));
});

test('rec: ohne Transportstart endet der wartende Start nach der Frist mit zu_spaet (Vorgabe 96000 Samples, M1)', () => {
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec5-')) };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 1, 1, 11)),
    sende(2100, rstart(3, 7)),
    erwarte(2100 + 96000 + 3000, q(3, 'andreas', 7, null, 'zu_spaet')),
  ], { cfg }));
});

test('rec: die Frist endet, sobald das Arrangement wartet: Quant 2 mit dem Einsatz hinter der Frist bricht nicht ab (M1, Fehlerfall der Prüfung)', () => {
  assert.ok(S(5) > 2100 + 96000, 'Vorbedingung des Falls: Einsatz bei Beat 5 liegt hinter der Frist');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec6-'));
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 3, 1, 11)),
    erwarte(2000, q(2, 'andreas', 3)),
    sende(2100, rstart(3, 7)),
    sende(70000, ['/k/arr/start', 'hsdi', 4, 'andreas', 1, 2]),         // Quant 2, Raster ab Beat 1: Einsatz bei Beat 5 (S(5) = 112500 bei 128 BPM)
    erwarte(S(5) + 3000, q(3, 'andreas', 2)),                           // Einsatz-Quittung des Rec-Befehls, kein Abbruch davor
    sende(S(5) + 3100, astopp(5)),
    erwarte(S(5) + 20000, q(3, 'andreas', 3)),
  ], { cfg }));
  assert.ok(fs.existsSync(path.join(ordner, 'aufnahme-3-7.f32')), 'der Take ist geschrieben');
});

test('rec: frist_samples ausserhalb 0 oder 48000 bis 1440000 wird abgelehnt', () => {
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec7-')) };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 1, 1, 11)),
    sende(2100, rstart(3, 1, 'andreas', 100)),
    erwarte(3000, q(3, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(3100, rstart(4, 1, 'andreas', 1500000)),
    erwarte(4000, q(4, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(4100, rstart(5, 1, 'andreas', 48000)),
    erwarte(5000, q(5, 'andreas', 1)),
  ], { cfg }));
});

// --- Nachzug Task 19 (Review r1, Testlücke): Messwerte statt Quittungen allein --------------------------------------------------------------
const N = (v) => (typeof v === 'bigint' ? Number(v) : v);
const quitt = (r, id, status) => r.log.find((m) => m.adresse === '/q' && N(m.werte[0]) === id && N(m.werte[2]) === status);
const zustand = (r) => r.log.filter((m) => m.adresse === '/zustand/rec').map((m) => m.werte.map(N));
const aufn = (r) => r.log.filter((m) => m.adresse === '/e/aufnahme').map((m) => m.werte.map(N));
const nichts = (bis) => erwarte(bis, ['/nie']);   // läuft die Uhr bis `bis`; der Fehlschlag dieses Schritts ist erwartet und wird ausgefiltert
const gruenOhneNie = (r) => assert.deepEqual(r.fehler.filter((f) => !f.includes('"/nie"')), [], r.fehler.join('\n'));

for (const quant of [0, 1]) test(`rec: Messwerte (Quant ${quant}): start_sample = Sample der Quittung 2, frames = Dateilänge = Ende − Einsatz, Muster am Kern-Sample, Begleitdatei, /zustand/rec 3 dann 0`, () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec8-'));
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner };
  // Since the host lead is 2n (2026-11-10, was 2n + 25) a start at quant 0 lands on a block boundary; quant 1 (next beat) puts the Einsatz inside a block.
  // The take must begin at the Einsatz sample in both cases: on the boundary and inside the block (the case the old +25 phase used to cover).
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, rstart(3, 7)), sende(3100, ['/k/arr/start', 'hsdi', 4, 'andreas', 0, quant]),
    sende(100000, astopp(5)), nichts(130000),
  ], { cfg });
  gruenOhneNie(r);
  const s2 = N(quitt(r, 3, 2).werte[3]), s3 = N(quitt(r, 3, 3).werte[3]);
  assert.ok(s2 > 3100 && s2 < 100000, `Einsatz-Sample ${s2}`);
  const sArr = N(quitt(r, 4, 2).werte[3]);
  assert.equal(s2, sArr, 'der Take beginnt am Einsatz-Sample des Arrangements (Quittung 2 von /k/arr/start), nicht am Blockanfang');
  if (quant === 1) assert.notEqual(s2 % 256, 0, 'Vorbedingung: der Einsatz liegt nicht auf einer Blockgrenze');
  else assert.equal(s2 % 256, 0, 'quant 0: the Einsatz sits on a block boundary (host lead 2n, start rule 3n)');
  const e = aufn(r);
  assert.equal(e.length, 1);
  const [sp, kennung, st, frames, start] = e[0];
  assert.deepEqual([sp, kennung, st], [3, 7, 0]);
  assert.equal(start, s2, 'start_sample = Sample der Quittung 2');
  assert.equal(frames, s3 - s2, 'frames = Ende − Einsatz');
  const roh = fs.readFileSync(path.join(ordner, 'aufnahme-3-7.f32'));
  assert.equal(roh.length / 8, frames, 'Dateilänge = frames');
  assert.ok(frames > 1000, 'der Take ist länger als eine Musterperiode');
  assert.equal(roh.readFloatLE(0), Math.fround((s2 % 1000) / 1000), 'erstes Sample L = Kern-Sample mod 1000 / 1000');
  const l = frames - 1;
  assert.equal(roh.readFloatLE(l * 8), Math.fround(((s2 + l) % 1000) / 1000), 'letztes Sample am Kern-Sample');
  assert.equal(roh.readFloatLE(l * 8 + 4), -roh.readFloatLE(l * 8), 'R = −L');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ordner, 'aufnahme-3-7.json'), 'utf8')),
    { spur: 3, kennung: 7, eingang: 11, start_sample: s2, frames, luecken: 0, status: 'fertig' });
  const z = zustand(r);
  const nimmt = z.filter((w) => w[0] === 3);
  assert.ok(nimmt.length >= 5, `Zustand 3 während des Takes (${nimmt.length})`);
  assert.ok(nimmt.every((w) => w[1] === 7 && w[2] === 1), 'Kennung und Zahl scharfer Spuren');
  assert.ok(nimmt.every((w, i) => w[4] > 0 && (i === 0 || w[4] > nimmt[i - 1][4])), 'Projekt-Beat läuft während des Takes');
  assert.equal(z[z.length - 1][0], 0, 'danach Zustand 0');
  assert.equal(z[z.length - 1][4], 0, 'ohne Take kein Projekt-Beat');
});

test('rec: /k/rec/stopp beendet einen laufenden Take, das Arrangement läuft weiter; ein neuer Start beginnt (S4b, D8) am naechsten Takt des laufenden Transports', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec9-'));
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner };
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, rstart(3, 7)), sende(3100, astart(4)),
    sende(50000, ['/k/rec/stopp', 'hs', 5, 'andreas']), sende(80000, rstart(6, 8)), nichts(100000),
  ], { cfg });
  gruenOhneNie(r);
  assert.equal(N(quitt(r, 3, 3).werte[3]), N(quitt(r, 5, 3).werte[3]), 'Take und Stopp enden am selben Sample');
  assert.ok(N(quitt(r, 5, 3).werte[3]) < 51000, 'der Take endet am Stopp, nicht am Ende des Arrangements');
  assert.equal(aufn(r).length, 1);
  assert.equal(aufn(r)[0][3], N(quitt(r, 3, 3).werte[3]) - N(quitt(r, 3, 2).werte[3]));
  assert.equal(r.kern.arr.status, 2, 'das Arrangement spielt weiter');
  assert.equal(quitt(r, 6, 6), undefined, 'S4b: a running transport no longer refuses with ueberlappung');
  assert.ok(quitt(r, 6, 1), 'the new start is accepted');
  assert.ok(zustand(r).some((w) => w[0] === 3), 'Zustand 3 (the first take)');
});

test('rec: endet das Arrangement im Take, endet der Take mit; ohne Einsatz bricht ein gestopptes wartendes Arrangement den Start ab (abbruch)', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec10-'));
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, rstart(3, 7)), sende(3100, astart(4)),
    sende(60000, astopp(5)), nichts(90000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner } });
  gruenOhneNie(r);
  assert.ok(quitt(r, 3, 3), 'Quittung 3 am Ende des Arrangements');
  assert.equal(aufn(r).length, 1);
  const o2 = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec11-'));
  const r2 = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 1, 1, 11)), sende(2100, rstart(3, 7)), sende(5000, ['/k/arr/start', 'hsdi', 4, 'andreas', 1, 2]),
    sende(20000, astopp(5)), nichts(60000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: o2 } });
  gruenOhneNie(r2);
  assert.equal(quitt(r2, 3, 7).werte[5], 'abbruch', 'Arrangement endet vor dem Einsatz: Start abgebrochen');
  assert.deepEqual(fs.readdirSync(o2), [], 'keine Datei');
  assert.equal(aufn(r2).length, 0);
});

test('rec: aufnahme_laeuft für Spur und Start während eines wartenden Starts; zu_viele_scharf ab der neunten; dieselbe Spur erneut und Entschärfen zählen richtig', () => {
  const s = [sende(0, laden(1, 1))];
  for (let i = 1; i <= 9; i++) s.push(sende(100 + i * 10, spur(10 + i, i, 1, 11)));
  s.push(sende(300, spur(30, 8, 1, 12)));
  s.push(sende(310, spur(31, 8, 0, 0)));
  s.push(sende(320, spur(32, 9, 1, 11)));
  s.push(sende(2100, rstart(40, 1)));
  s.push(sende(2200, spur(41, 1, 0, 0)));
  s.push(sende(2300, rstart(42, 2)));
  s.push(nichts(12000));
  const r = fahre(s, { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec12-')) } });
  gruenOhneNie(r);
  assert.equal(quitt(r, 19, 6).werte[5], 'zu_viele_scharf');
  for (const id of [11, 12, 13, 14, 15, 16, 17, 18, 30, 31, 32]) assert.ok(quitt(r, id, 3), `Spur-Befehl ${id} angenommen`);
  assert.equal(quitt(r, 41, 6).werte[5], 'aufnahme_laeuft', 'Spur während des wartenden Starts');
  assert.equal(quitt(r, 42, 6).werte[5], 'aufnahme_laeuft', 'zweiter Start');
  assert.equal(zustand(r).at(-1)[2], 8, 'acht Spuren scharf (neun scharf, eine entschärft, die neunte nach dem Entschärfen)');
});

test('rec: Entschärfen nimmt die Spur wirklich heraus: danach ohne scharfe Spur kein_eingang', () => {
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 4, 1, 11)), sende(400, spur(3, 4, 0, 0)), sende(2100, rstart(4, 1)), nichts(4000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec13-')) } });
  gruenOhneNie(r);
  assert.equal(quitt(r, 4, 6).werte[5], 'kein_eingang');
});

test('rec: im KI-Stopp bleibt /k/rec/stopp von cypher erlaubt (wie /k/arr/stopp; Kern: Anhalten ist die sichere Richtung), /k/rec/start nicht', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec14-'));
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, rstart(3, 7)), sende(3100, astart(4)),
    sende(30000, ['/k/ki/stopp', 'hs', 5, 'leitstand']),
    sende(40000, ['/k/rec/start', 'hsiiii', 6, 'cypher', 9, 0, 0, 0]),
    sende(50000, ['/k/rec/stopp', 'hs', 7, 'cypher']), nichts(70000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner } });
  gruenOhneNie(r);
  assert.equal(quitt(r, 6, 6).werte[5], 'ki_gestoppt');
  assert.ok(quitt(r, 7, 1) && quitt(r, 7, 3), 'Stopp von cypher angenommen und ausgeführt');
  assert.ok(!r.log.some((m) => m.adresse === '/q' && N(m.werte[0]) === 7 && N(m.werte[2]) === 6), 'nicht abgelehnt');
  assert.equal(aufn(r).length, 1, 'der Take ist beendet und gemeldet');
  assert.ok(quitt(r, 3, 3));
});

test('rec: Schreibfehler enden wie im Kern: /e/aufnahme Status 3 mit frames 0, Begleitdatei "kein_platz" wo ein Ordner da ist, die vorhandene Rohdatei bleibt', () => {
  // vorhandene Rohdatei (zweiter Take mit derselben Kennung)
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec15-'));
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)),
    sende(2100, rstart(3, 7)), sende(3100, astart(4)), sende(40000, astopp(5)),
    sende(60000, rstart(6, 7)), sende(61000, astart(7)), sende(100000, astopp(8)), nichts(130000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner } });
  gruenOhneNie(r);
  const e = aufn(r);
  assert.equal(e.length, 2);
  assert.equal(e[0][2], 0);
  assert.deepEqual([e[1][0], e[1][1], e[1][2], e[1][3]], [3, 7, 3, 0], 'zweiter Take: Status 3, frames 0');
  assert.ok(e[1][4] > 60000, 'start_sample ist trotzdem gemeldet');
  assert.equal(fs.readFileSync(path.join(ordner, 'aufnahme-3-7.f32')).length / 8, e[0][3], 'die erste Rohdatei bleibt unberührt');
  const j = JSON.parse(fs.readFileSync(path.join(ordner, 'aufnahme-3-7.json'), 'utf8'));
  assert.deepEqual([j.status, j.frames], ['kein_platz', 0]);
  // ohne Arbeitsordner: keine Datei, trotzdem Status 3
  const r2 = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, rstart(3, 7)), sende(3100, astart(4)), sende(40000, astopp(5)), nichts(70000),
  ], { cfg: { arbeitsbestand: arbeitsbestand() } });
  gruenOhneNie(r2);
  assert.deepEqual(aufn(r2).map((w) => [w[2], w[3]]), [[3, 0]]);
});

// --- Review-Nachzug Teil B (MAJOR 1) -------------------------------------------------------------------------------------------------------
test('rec: mit Loop-Klammer endet der Take am ersten Wrap, ohne Stopp (Spec 1.8 F2, ein Durchgang)', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec6-'));
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(100, ['/k/arr/loop', 'hsidd', 9, 'andreas', 1, 0.0, 2.0]),   // Klammer 0..2 Beats = 45 000 Samples bei 128 BPM
    sende(300, spur(2, 3, 1, 11)),
    erwarte(2000, q(2, 'andreas', 3)),
    sende(2100, rstart(3, 7)),
    sende(3100, astart(4)),
    erwarte(100000, q(3, 'andreas', 2)),
    erwarte(60000, q(3, 'andreas', 3)),                // Quittung 3 ohne /k/rec/stopp: nach einem Durchgang (Einsatz um 3 700 + 45 000 < 60 000)
  ], { cfg }));
  const roh = fs.readFileSync(path.join(ordner, 'aufnahme-3-7.f32'));
  const frames = roh.length / 8;
  assert.ok(frames > 40000 && frames <= 45000, `ein Durchgang, nicht mehr: ${frames} Frames`);
});

// --- 1.8 S0: the new contract fields (modus, monitor, vorzaehler_takte, ausgang_vorhalt, quantum, art) --------------------------------------
test('rec S2a: ein_1..4 are taps with a channel mode; the master stays eingang_fehlt, midi (T8) is armed; a mode on an internal code is ausserhalb_bereich like the core', () => {
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-s0a-')) };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 1, 1, 1)), erwarte(2000, q(2, 'andreas', 1)), erwarte(2000, q(2, 'andreas', 3)),            // ein_1: a tap since slice 2
    sende(2100, spur(3, 2, 1, 4, 'andreas', 3)), erwarte(3000, q(3, 'andreas', 1)), erwarte(3000, q(3, 'andreas', 3)), // ein_4 with modus summe
    sende(3100, spur(4, 3, 1, 30)), erwarte(4000, q(4, 'andreas', 1)), erwarte(4000, q(4, 'andreas', 3)),            // midi_ein_1: armed since 1.8 T8
    sende(4100, spur(5, 3, 1, 20)), erwarte(5000, q(5, 'andreas', 6, null, 'eingang_fehlt')),                       // master before the fader: later
    sende(5100, spur(6, 3, 1, 20, 'andreas', 2)), erwarte(6000, q(6, 'andreas', 6, null, 'eingang_fehlt')),        // also with a modus, like the core
    sende(6100, spur(7, 3, 1, 5)), erwarte(7000, q(7, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(7100, spur(8, 3, 1, 31)), erwarte(8000, q(8, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(8100, spur(9, 3, 1, 11, 'andreas', 1)), erwarte(9000, q(9, 'andreas', 6, null, 'ausserhalb_bereich')),   // modus links on an internal code
    sende(9100, spur(10, 3, 0, 22, 'andreas', 2)), erwarte(10000, q(10, 'andreas', 6, null, 'ausserhalb_bereich')), // also when disarming
    sende(10100, spur(11, 3, 1, 11, 'andreas', 4)), erwarte(11000, q(11, 'andreas', 6, null, 'ausserhalb_bereich')), // modus beyond [0, 3]
    sende(11100, spur(12, 3, 1, 11, 'andreas', 0, 3)), erwarte(12000, q(12, 'andreas', 6, null, 'ausserhalb_bereich')), // monitor beyond [0, 2]
    sende(12100, spur(13, 3, 0, 1)), erwarte(13000, q(13, 'andreas', 3)),                                            // disarming never needs the tap
    sende(13200, spur(14, 3, 1, 11)), erwarte(14000, q(14, 'andreas', 1)), erwarte(14000, q(14, 'andreas', 3)),     // negative control: an internal tap with modus 0 still arms
  ], { cfg }));
});

test('rec S0: monitor 0, 1, 2 are accepted and ignored for an internal source (D11); the recording is unchanged', () => {
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-s0b-')) };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 1, 1, 11, 'andreas', 0, 2)), erwarte(2000, q(2, 'andreas', 3)),
    sende(2100, spur(3, 2, 1, 12, 'andreas', 0, 0)), erwarte(3000, q(3, 'andreas', 3)),
    sende(3100, spur(4, 3, 1, 13, 'andreas', 0, 1)), erwarte(4000, q(4, 'andreas', 3)),
  ], { cfg }));
});

test('rec S0/S4b: vorzaehler_takte 0, 1, 2, 4 are accepted, 3 and anything outside [0, 4] are ausserhalb_bereich', () => {
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-s0c-')) };
  gruen(fahre([
    sende(0, laden(1, 1)),
    sende(300, spur(2, 1, 1, 11)), erwarte(2000, q(2, 'andreas', 3)),
    sende(2100, rstart(3, 1, 'andreas', 0, 3)), erwarte(3000, q(3, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(3100, rstart(4, 1, 'andreas', 0, 5)), erwarte(4000, q(4, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(4100, rstart(5, 1, 'andreas', 0, -1)), erwarte(5000, q(5, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(5100, rstart(6, 1, 'andreas', 0, 4)), erwarte(6000, q(6, 'andreas', 1)),                 // S4b: 4 is a valid count-in now
  ], { cfg }));
});

test('rec S0: /zustand/rec carries ausgang_vorhalt 0 and quantum 256 (documented mock values) in eight fields, rec_midi_scharf 0 (1.8 T7a)', () => {
  const r = fahre([sende(0, laden(1, 1)), nichts(60000)], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-s0d-')) } });
  gruenOhneNie(r);
  const z = zustand(r);
  assert.ok(z.length >= 1, 'at least one /zustand/rec');
  for (const w of z) { assert.equal(w.length, 8); assert.equal(w[5], 0); assert.equal(w[6], 256); assert.equal(w[7], 0); }
});

// --- 1.8 S4b: count-in and a take inside a running transport (the stand-in learns what the core learned in S4a) -----------------------------------------------
const aufnahmeCfg = (n) => ({ arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), `attrappe-rec-s4b${n}-`)) });
const beatVon = (m) => m.werte[4];
test('rec S4b: a count-in of 1 bar moves the entry of the waiting transport by 4 beats and /zustand/rec reports status 1 while it counts (negative control: count-in 0)', () => {
  const lauf = (vorzaehler, id0) => fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, rstart(3, 7, 'andreas', 0, vorzaehler)), sende(3100, astart(4)), sende(S(12), astopp(5)), nichts(S(12) + 4000),
  ], { cfg: aufnahmeCfg(id0) });
  const a = lauf(0, 'a'), b = lauf(1, 'b');
  gruenOhneNie(a); gruenOhneNie(b);
  const e0 = N(quitt(a, 3, 2).werte[3]), e1 = N(quitt(b, 3, 2).werte[3]);
  assert.ok(Math.abs(e1 - e0 - S(4)) <= 1, `the entry (receipt 2) lies 4 beats later with a count-in of 1 bar (${e1 - e0} vs ${S(4)})`);
  assert.ok(zustand(b).some((w) => w[0] === 1), 'status 1 (counting in) is reported');
  assert.ok(!zustand(a).some((w) => w[0] === 1), 'negative control: no status 1 without a count-in');
  assert.equal(zustand(b).findIndex((w) => w[0] === 3) > zustand(b).findIndex((w) => w[0] === 1), true, 'status 1 comes before status 3');
});
test('rec S4b: a take inside a running transport begins at the next project bar, receipt 2 carries the project beat, the transport keeps playing', () => {
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, astart(3)),
    sende(S(5.3), rstart(4, 7, 'andreas', 0, 4)),             // the count-in is ignored in a running transport (D7)
    sende(S(14), ['/k/rec/stopp', 'hs', 5, 'andreas']), nichts(S(16)),
  ], { cfg: aufnahmeCfg('c') });
  gruenOhneNie(r);
  const q2 = quitt(r, 4, 2);
  assert.ok(q2, 'receipt 2 of the REC id');
  const ursprung = r.kern.arr.ursprung;
  assert.equal(beatVon(q2), 8, 'project beat of the take start: the next bar after beat 5.3');
  assert.equal(N(q2.werte[3]), Math.round((r.kern.uhr.sample(ursprung + 8))), 'the start sample is the sample of project beat 8');
  assert.equal(r.kern.arr.status, 2, 'the transport keeps playing');
  assert.equal(aufn(r).length, 1);
  assert.ok(!zustand(r).some((w) => w[0] === 1), 'no status 1: the count-in has no effect in a running transport');
  // negative control: beat 7.99 with fewer than one cycle left goes to the following bar
  // (the simulation is deterministic: the first run gives the core beat the project starts at, so the second can send 0.002 project beats before bar 8, less than one cycle of 256 samples = 0.0107 beats)
  const schritte = (an) => [sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, astart(3)), sende(an, rstart(4, 7)), sende(S(14), ['/k/rec/stopp', 'hs', 5, 'andreas']), nichts(S(16))];
  const u0 = r.kern.arr.ursprung;
  const r2 = fahre(schritte(Math.round(r.kern.uhr.sample(u0 + 7.998))), { cfg: aufnahmeCfg('d') });
  gruenOhneNie(r2);
  assert.equal(beatVon(quitt(r2, 4, 2)), 12, 'never a start in the past: 0.002 beats before bar 8 is less than one cycle');
  const r3 = fahre(schritte(Math.round(r.kern.uhr.sample(u0 + 7.5))), { cfg: aufnahmeCfg('f') });
  gruenOhneNie(r3);
  assert.equal(beatVon(quitt(r3, 4, 2)), 8, 'negative control: half a beat before bar 8 still starts at bar 8');
});
test('rec S4b: with the loop brace on and the next bar behind the brace end, the take starts at the seam and ends at the following seam (one whole pass)', () => {
  const r = fahre([
    sende(0, laden(1, 1)), sende(200, spur(2, 3, 1, 11)), sende(300, ['/k/arr/loop', 'hsidd', 9, 'andreas', 1, 0, 8]), sende(2100, astart(3)),
    sende(S(7.5), rstart(4, 7)), nichts(S(21)),
  ], { cfg: aufnahmeCfg('e') });
  gruenOhneNie(r);
  const q2 = quitt(r, 4, 2), q3 = quitt(r, 4, 3);
  assert.ok(q2 && q3, 'receipt 2 and 3');
  assert.equal(beatVon(q2), 0, 'the seam: the project beat wraps to the brace start');
  assert.equal(N(q3.werte[3]) - N(q2.werte[3]), S(8), 'the take is one whole pass of 8 beats');
  assert.equal(aufn(r)[0][3], S(8), 'frames == 8 beats');
});

// --- 1.8 T8: eingang 30 (midi_ein_1) in the stand-in: instrument-only runs and the deterministic MIDI take file -------------------------------------------------------
const lies = (ordner, datei) => fs.readFileSync(path.join(ordner, datei));
const satz = (puf, i) => ({ sample: Number(puf.readBigInt64LE(i * 12)), status: puf[i * 12 + 8], d1: puf[i * 12 + 9], d2: puf[i * 12 + 10], pad: puf[i * 12 + 11] });

test('rec T8: an instrument-only run (eingang 30 only) records: midi-<kennung>.bin in the core layout, sidecar, /e/aufnahme spur 0 art 1, no audio file', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-t8a-'));
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 5, 1, 30)), sende(2100, rstart(3, 11)), sende(3100, astart(4)), sende(100000, astopp(5)), nichts(130000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner } });
  gruenOhneNie(r);
  assert.ok(quitt(r, 2, 3), 'the MIDI arm is accepted');
  assert.equal(quitt(r, 3, 6), undefined, 'no kein_eingang: a MIDI arm alone is a run');
  const s2 = N(quitt(r, 3, 2).werte[3]), s3 = N(quitt(r, 3, 3).werte[3]);
  assert.deepEqual(fs.readdirSync(ordner).sort(), ['midi-11.bin', 'midi-11.json'], 'one MIDI take, no audio file');
  const puf = lies(ordner, 'midi-11.bin');
  assert.equal(puf.length % 12, 0, 'whole records of 12 bytes');
  const n = puf.length / 12;
  const e = aufn(r);
  assert.deepEqual(e.map((w) => [w[0], w[1], w[2], w[3], w[4], w[5], w[6]]), [[0, 11, 0, n, s2, 0, 1]], '/e/aufnahme: spur 0, art 1, frames = event count');
  const ev = Array.from({ length: n }, (_, i) => satz(puf, i));
  assert.deepEqual(ev[0], { sample: s2 + 500, status: 0xB0, d1: 1, d2: 64, pad: 0 }, 'the control change comes first');
  assert.deepEqual(ev.slice(1, 3), [{ sample: s2 + 1000, status: 0x90, d1: 48, d2: 64, pad: 0 }, { sample: s2 + 2500, status: 0x80, d1: 48, d2: 0, pad: 0 }], 'note 0');
  assert.equal(ev.filter((x) => x.status === 0x90).length, 16, 'sixteen notes in a take of this length');
  assert.ok(ev.every((x, i) => i === 0 || x.sample >= ev[i - 1].sample), 'time order');
  assert.ok(ev.every((x) => x.sample >= s2 && x.sample <= s3), 'inside the take');
  assert.deepEqual(JSON.parse(lies(ordner, 'midi-11.json').toString()), { art: 'midi', spur: 0, kennung: 11, eingang: 30, start_sample: s2, ende_sample: s3, ereignisse: n, abgelehnt: 0, status: 'fertig' });
});

test('rec T8: the pattern closes a note that is still sounding at the end and plays none that would begin after it (midiMuster, 1:1 note on / note off)', async () => {
  const { midiMuster } = await import('../rec.mjs');
  const e = midiMuster(10000, 10000 + 1000 + 3000 * 2 + 700);   // note 0 and 1 complete, note 2 begins 700 samples before the end
  const an = e.filter((x) => x[1] === 0x90), aus = e.filter((x) => x[1] === 0x80);
  assert.equal(an.length, 3);
  assert.equal(aus.length, 3, 'every note on has its note off');
  assert.deepEqual(aus[2].slice(0, 2), [10000 + 1000 + 6000 + 700, 0x80], 'the third note ends at the end sample');
  assert.equal(midiMuster(10000, 10400).filter((x) => x[1] === 0x90).length, 0, 'nothing but the control change before the first note');
});

test('rec T8: rec_midi_scharf in /zustand/rec counts the MIDI arms, scharf stays audio only; an audio arm or a disarm clears the MIDI bit of a track', () => {
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 1, 1, 30)), sende(400, spur(3, 2, 1, 30)), sende(500, spur(4, 3, 1, 11)), nichts(30000),
    sende(30100, spur(5, 1, 1, 11)), nichts(60000),             // track 1: audio arm takes the track away from MIDI
    sende(60100, spur(6, 2, 0, 0)), nichts(90000),              // track 2: disarm clears its MIDI bit
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-t8b-')) } });
  gruenOhneNie(r);
  const z = zustand(r);
  assert.ok(z.every((w) => w.length === 8));
  assert.deepEqual(z.find((w) => w[2] === 1 && w[7] === 2).slice(2, 8), [1, 0, 0, 0, 256, 2], 'scharf 1 (track 3, audio), rec_midi_scharf 2 (tracks 1 and 2)');
  assert.deepEqual([z.at(-1)[2], z.at(-1)[7]], [2, 0], 'after both: tracks 1 and 3 are audio, no MIDI arm');
});

test('rec T8: a channel mode on a MIDI arm is ausserhalb_bereich (like the core), disarming with eingang 30 is harmless, a MIDI arm while recording is refused unless it is already armed', () => {
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 1, 1, 30, 'andreas', 1)), sende(400, spur(3, 1, 0, 30, 'andreas', 0)), sende(500, spur(4, 2, 1, 30)),
    sende(2100, rstart(5, 3)), sende(2200, spur(6, 3, 1, 30)), sende(2300, spur(7, 2, 1, 30)), nichts(8000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-t8c-')) } });
  gruenOhneNie(r);
  assert.equal(quitt(r, 2, 6).werte[5], 'ausserhalb_bereich');
  assert.ok(quitt(r, 3, 3) && quitt(r, 4, 3));
  assert.ok(quitt(r, 5, 1), 'the run starts on the MIDI arm alone');
  assert.equal(quitt(r, 6, 6).werte[5], 'aufnahme_laeuft', 'a new MIDI arm while a run waits');
  assert.ok(quitt(r, 7, 3), 'the same arm again changes nothing and passes');
});

test('rec T8: a mixed run writes the audio file and the MIDI file with the same kennung and reports both takes', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-t8d-'));
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(400, spur(3, 5, 1, 30)), sende(2100, rstart(4, 6)), sende(3100, astart(5)), sende(100000, astopp(6)), nichts(130000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner } });
  gruenOhneNie(r);
  assert.deepEqual(fs.readdirSync(ordner).sort(), ['aufnahme-3-6.f32', 'aufnahme-3-6.json', 'midi-6.bin', 'midi-6.json']);
  assert.deepEqual(aufn(r).map((w) => [w[0], w[6]]).sort(), [[0, 1], [3, 0]], 'spur 0 art 1 and spur 3 art 0');
});

test('rec T8: cfg.rec_midi replaces the pattern; an existing file is never replaced (status 3, kein_platz, the note count reported is 0)', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec-t8e-'));
  fs.writeFileSync(path.join(ordner, 'midi-9.bin'), 'x');
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 1, 1, 30)), sende(2100, rstart(3, 9)), sende(3100, astart(4)), sende(50000, astopp(5)), nichts(80000),
  ], { cfg: { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner, rec_midi: (start) => [[start + 10, 0x90, 60, 100], [start + 20, 0x80, 60, 0]] } });
  gruenOhneNie(r);
  assert.deepEqual(aufn(r).map((w) => [w[0], w[2], w[3], w[6]]), [[0, 3, 0, 1]]);
  assert.equal(lies(ordner, 'midi-9.bin').toString(), 'x', 'the old file is untouched');
  assert.equal(JSON.parse(lies(ordner, 'midi-9.json').toString()).status, 'kein_platz');
});
