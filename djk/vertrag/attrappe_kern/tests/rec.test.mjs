// node --test tests/rec.test.mjs: Aufnahme in der Attrappe (§4.12, §5.14, 1.8 Slice 1). Spur scharf, Start wartet auf den Einsatz des Arrangements, Quittung 2 dort,
// Ende mit dem Stopp: Quittung 3, /e/aufnahme, Datei aufnahme-<spur>-<kennung>.f32 mit dem Prüfmuster im Arbeitsordner; Ablehnungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fahre } from '../folgen_schnell.mjs';
import { arbeitsbestand, sende, erwarte, q, S } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const spur = (id, nr, scharf, eingang, quelle = 'andreas') => ['/k/rec/spur', 'hsiii', id, quelle, nr, scharf, eingang];
const rstart = (id, kennung, quelle = 'andreas', frist = 0) => ['/k/rec/start', 'hsiii', id, quelle, kennung, 0, frist];   // frist 0: Vorgabe 96000
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
    erwarte(110000, ['/e/aufnahme', 'iiihhi', 3, 7, 0, null, null, 0]),
  ], { cfg }));
  const roh = fs.readFileSync(path.join(ordner, 'aufnahme-3-7.f32'));
  assert.ok(roh.length > 0 && roh.length % 8 === 0, 'ganze Frames');
  assert.equal(roh.readFloatLE(4), -roh.readFloatLE(0), 'R = −L im Prüfmuster');
  assert.ok(fs.existsSync(path.join(ordner, 'aufnahme-3-7.json')));
});

test('rec: Ablehnungen: ohne scharfe Spur kein_eingang, scharf ohne Eingang, Spur 33, laufender Transport ueberlappung', () => {
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
    sende(8000, rstart(7, 2)),
    erwarte(9000, q(7, 'andreas', 6, null, 'ueberlappung')),
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

test('rec: Messwerte: start_sample = Sample der Quittung 2, frames = Dateilänge = Ende − Einsatz, Muster am Kern-Sample, Begleitdatei, /zustand/rec 3 dann 0', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-rec8-'));
  const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: ordner };
  const r = fahre([
    sende(0, laden(1, 1)), sende(300, spur(2, 3, 1, 11)), sende(2100, rstart(3, 7)), sende(3100, astart(4)),
    sende(100000, astopp(5)), nichts(130000),
  ], { cfg });
  gruenOhneNie(r);
  const s2 = N(quitt(r, 3, 2).werte[3]), s3 = N(quitt(r, 3, 3).werte[3]);
  assert.ok(s2 > 3100 && s2 < 100000, `Einsatz-Sample ${s2}`);
  const sArr = N(quitt(r, 4, 2).werte[3]);
  assert.equal(s2, sArr, 'der Take beginnt am Einsatz-Sample des Arrangements (Quittung 2 von /k/arr/start), nicht am Blockanfang');
  assert.notEqual(s2 % 256, 0, 'Vorbedingung: der Einsatz liegt nicht auf einer Blockgrenze');
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

test('rec: /k/rec/stopp beendet einen laufenden Take, das Arrangement läuft weiter; neuer Start dann ueberlappung', () => {
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
  assert.equal(N(quitt(r, 6, 6).werte[2]), 6);
  assert.equal(quitt(r, 6, 6).werte[5], 'ueberlappung');
  assert.ok(zustand(r).some((w) => w[0] === 3) && zustand(r).at(-1)[0] === 0, 'Zustand 3 und danach 0');
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
    sende(40000, ['/k/rec/start', 'hsiii', 6, 'cypher', 9, 0, 0]),
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
