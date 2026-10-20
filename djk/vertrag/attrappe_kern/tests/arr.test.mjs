// node --test tests/arr.test.mjs: Arrangement in der Attrappe (SCHNITTSTELLEN §4.11, §5.13; D1 K1). Laden merkt nr
// (Quittung 1 und 3, /zustand/arr), Start ohne Laden nicht_geladen, Start mit Quant 2 setzt auf dem Takt ein
// (Quittung 2 auf dem Einsatz-Sample), Stopp, Bereichsfehler, KI-Stopp für cypher. Paket K3: /k/arr/freeze mit Status 3,
// Quittungen 1, 2, 3, /e/freeze und Datei im Arbeitsordner; Abbruch durch Stopp; ohne Arbeitsordner /e/freeze Status 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fahre } from '../folgen_schnell.mjs';
import { arbeitsbestand, sende, erwarte, q, setNeu } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = { arbeitsbestand: arbeitsbestand() };
const laden = (id, nr, quelle = 'andreas') => ['/k/arr/laden', 'hsi', id, quelle, nr];
const start = (id, beat, quant, quelle = 'andreas') => ['/k/arr/start', 'hsdi', id, quelle, beat, quant];

test('arr: Laden quittiert 1 und 3 und meldet nr in /zustand/arr', () => {
  const r = fahre([
    sende(1000, laden(1, 17)),
    erwarte(3000, q(1, 'andreas', 1)),
    erwarte(3000, q(1, 'andreas', 3)),
    erwarte(3000, ['/zustand/arr', 'iiidhdi', 17, 0, 0, 0, -1, 0, 0]),
  ], { cfg });
  gruen(r);
});

test('arr: Start ohne Laden ist nicht_geladen', () => {
  gruen(fahre([sende(1000, start(2, 0, 0)), erwarte(3000, q(2, 'andreas', 6, null, 'nicht_geladen'))], { cfg }));
});

test('arr: Start auf den Takt (Kern-Beat 4 = 90 000), Quittung 2 dort, Status 2', () => {
  const r = fahre([
    sende(0, laden(3, 1)),
    sende(512, start(4, 0, 2)),
    erwarte(1000, q(4, 'andreas', 1)),
    erwarte(100000, q(4, 'andreas', 2, 90000)),
    erwarte(100000, ['/zustand/arr', 'iiidhdi', 1, 2, 0, 0, 90000, 0, 0]),
  ], { cfg });
  gruen(r);
});

test('arr: Stopp, Bereichsfehler (auch freeze), cypher bei KI-Stopp abgelehnt', () => {
  const r = fahre([
    sende(0, laden(5, 1)),
    sende(512, ['/k/arr/stopp', 'hsi', 6, 'andreas', 0]),
    erwarte(2000, q(6, 'andreas', 3)),
    sende(2048, ['/k/arr/loop', 'hsidd', 7, 'andreas', 1, 4.0, 4.5]),
    erwarte(4000, q(7, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(4096, ['/k/arr/metronom', 'hsifi', 8, 'andreas', 1, -61.0, 0]),
    erwarte(6000, q(8, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(6144, ['/k/arr/freeze', 'hsiddi', 9, 'andreas', 1, 0.0, 0.5, 1]),
    erwarte(8000, q(9, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(8192, ['/k/ki/stopp', 'hs', 10, 'andreas']),
    sende(9000, laden(11, 2, 'cypher')),
    erwarte(12000, q(11, 'cypher', 6, null, 'ki_gestoppt')),
  ], { cfg });
  gruen(r);
});

const freeze = (id, spur, von, bis, kennung, quelle = 'andreas') => ['/k/arr/freeze', 'hsiddi', id, quelle, spur, von, bis, kennung];

test('arr: freeze läuft mit Status 3, endet nach bis − von + 2 Beats mit /e/freeze und Datei', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-arr-'));
  const r = fahre([
    sende(1000, freeze(20, 1, 0.0, 4.0, 7)),
    erwarte(3000, q(20, 'andreas', 6, null, 'nicht_geladen')),
    sende(4000, laden(21, 1)),
    sende(8000, freeze(22, 1, 0.0, 4.0, 7)),
    erwarte(9000, q(22, 'andreas', 1)),
    erwarte(9000, ['/zustand/arr', 'iiidhdi', 1, 3, 0, 0, null, 0, 0]),
    erwarte(10000, q(22, 'andreas', 2)),
    erwarte(150000, q(22, 'andreas', 3)),
    erwarte(150000, ['/e/freeze', 'iiih', 1, 7, 0, 135000]),
  ], { cfg: { ...cfg, arr_ordner: ordner } });
  gruen(r);
  assert.equal(fs.statSync(path.join(ordner, 'freeze-1-7.f32')).size, 135000 * 8);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('arr: freeze bricht bei Stopp ab (7 abbruch, /e/freeze 1); ohne Arbeitsordner /e/freeze 2', () => {
  const r = fahre([
    sende(0, laden(30, 1)),
    sende(4000, freeze(31, 2, 0.0, 4.0, 1)),
    sende(30000, ['/k/arr/stopp', 'hsi', 32, 'andreas', 0]),
    erwarte(32000, q(31, 'andreas', 7, null, 'abbruch')),
    erwarte(32000, ['/e/freeze', 'iiih', 2, 1, 1, 0]),
    sende(40000, freeze(33, 2, 0.0, 1.0, 2)),
    erwarte(120000, ['/e/freeze', 'iiih', 2, 2, 2, 0]),
  ], { cfg });
  gruen(r);
});

// Entscheidung E-a (2026-10-20): der KI-Stopp beendet einen LAUFENDEN Transport nicht mehr, auch keinen von Cypher gestarteten (einen noch wartenden
// Start von Cypher verwirft er weiter, 7 ki_stopp: der nächste Fall). Vorher (Spec 2.12) meldete der letzte erwarte-Schritt dieses Tests /zustand/arr
// mit status 0; er hätte aber jede frühere Meldung mit status 0 (nach dem Stopp 23) verbraucht, der Test war für das KI-Stopp-Ende nicht bindend.
// Jetzt zählt das Protokoll nach dem KI-Stopp: jede /zustand/arr ab Sample 21 000 sagt status 2.
const zustandNach = (r, ab, bis) => r.log.filter((m) => m.adresse === '/zustand/arr' && m.s > ab && m.s <= bis).map((m) => m.werte[1]);

test('arr: wartender Start endet mit 7 (zweiter Start abbruch, Stopp abbruch); der KI-Stopp beendet Cyphers laufenden Transport nicht (E-a)', () => {
  const r = fahre([
    sende(0, laden(20, 1)),
    sende(512, start(21, 0, 2)),            // wartet auf den Takt (90 000)
    sende(2048, start(22, 0, 2)),           // löst 21 ab
    erwarte(4000, q(21, 'andreas', 7, null, 'abbruch')),
    sende(4096, ['/k/arr/stopp', 'hsi', 23, 'andreas', 0]),
    erwarte(6000, q(22, 'andreas', 7, null, 'abbruch')),
    erwarte(6000, q(23, 'andreas', 3)),
    sende(8192, start(24, 0, 0, 'cypher')),
    erwarte(12000, q(24, 'cypher', 2)),
    sende(20000, ['/k/ki/stopp', 'hs', 25, 'andreas']),
    erwarte(40000, ['/e/ki', 'ish', 1, 'ki_stopp', null]),
  ], { cfg });
  gruen(r);
  const nach = zustandNach(r, 21000, 40000);
  assert.ok(nach.length >= 10, `Positiv-Kontrolle: Meldungen nach dem KI-Stopp gesehen (${nach.length})`);
  assert.deepEqual([...new Set(nach)], [2], 'Cyphers Transport läuft nach dem KI-Stopp weiter');
});

// E-a (2026-10-20), Fall unverändert: was noch nicht klingt, verwirft der KI-Stopp weiter (wie wartende Deck-Befehle von Cypher); Gegenstück: der vorige Fall.
test('arr: KI-Stopp beendet einen wartenden Start von Cypher mit 7 ki_stopp, einen von Andreas nicht', () => {
  const r = fahre([
    sende(0, laden(30, 1)),
    sende(512, start(31, 0, 2, 'cypher')),
    sende(2048, ['/k/ki/stopp', 'hs', 32, 'andreas']),
    erwarte(4000, q(31, 'cypher', 7, null, 'ki_stopp')),
    sende(4096, start(33, 0, 2)),
    erwarte(100000, q(33, 'andreas', 2, 90000)),
  ], { cfg });
  gruen(r);
});

// K1-Fix 12: die Antworten der Attrappe auf /k/arr/* (/q) und /zustand/arr gegen den erzeugten Vertrag
// (djk/vertrag/osc_adressen.ts: Typen, Feldnamen, Bereiche, Gründe), nicht gegen eine Liste von Hand. Die Befehle entstehen
// aus den Feldnamen des Vertrags; jede Meldung wird nach Feldnamen gelesen und geprüft.
test('arr: /q auf /k/arr/* und /zustand/arr passen zu osc_adressen.ts (Typen, Felder, Bereiche, Gründe)', async () => {
  const { ADRESSEN, GRUENDE, STATUS } = await import('../../osc_adressen.ts');
  let id = 900;
  const befehl = (adresse, werte) => {
    const def = ADRESSEN[adresse];
    const v = def.felder.map((n) => (n === 'id' ? ++id : werte[n]));
    assert.ok(v.every((x) => x !== undefined), `${adresse}: ${def.felder.join(' ')}`);
    return [adresse, def.typen, ...v];
  };
  const r = fahre([
    sende(0, befehl('/k/arr/laden', { quelle: 'andreas', nr: 7 })),
    sende(1024, befehl('/k/arr/loop', { quelle: 'andreas', an: 1, von_beat: 0, bis_beat: 4 })),
    sende(2048, befehl('/k/arr/metronom', { quelle: 'andreas', an: 1, pegel_db: -12, ziel: 0 })),
    sende(3072, befehl('/k/arr/start', { quelle: 'andreas', start_beat: 0, quant: 0 })),
    sende(8192, befehl('/k/arr/stopp', { quelle: 'andreas', quant: 0 })),
    sende(9216, befehl('/k/arr/loop', { quelle: 'andreas', an: 1, von_beat: 4, bis_beat: 4.5 })),
    sende(10240, ['/k/ki/stopp', 'hs', ++id, 'andreas']),
    sende(11264, befehl('/k/arr/start', { quelle: 'cypher', start_beat: 0, quant: 0 })),
    erwarte(20000, ['/zustand/arr', null]),
  ], { cfg });
  const typOk = { i: Number.isInteger, h: (x) => typeof x === 'bigint', d: (x) => typeof x === 'number', f: (x) => typeof x === 'number', s: (x) => typeof x === 'string' };
  const fehler = [];
  const gelesen = { '/q': [], '/zustand/arr': [] };
  for (const m of r.log.filter((x) => x.adresse in gelesen)) {
    const def = ADRESSEN[m.adresse];
    const typen = def.typen.slice(1);
    if (m.typen !== typen) fehler.push(`${m.adresse}: Typen ${m.typen} statt ${typen}`);
    if (m.werte.length !== def.felder.length) { fehler.push(`${m.adresse}: ${m.werte.length} Werte statt ${def.felder.length} (${def.felder.join(' ')})`); continue; }
    const f = {};
    def.felder.forEach((n, i) => {
      const w = m.werte[i];
      if (!typOk[typen[i]](w)) fehler.push(`${m.adresse}.${n}: ${String(w)} passt nicht zu Typ ${typen[i]}`);
      const b = def.bereiche?.[n];
      if (b && ((b[0] !== null && Number(w) < b[0]) || (b[1] !== null && Number(w) > b[1]))) fehler.push(`${m.adresse}.${n}: ${w} außerhalb [${b}]`);
      f[n] = w;
    });
    if (m.adresse === '/q' && f.grund !== '' && !GRUENDE.includes(f.grund)) fehler.push(`/q.grund ${f.grund} nicht in GRUENDE`);
    if (m.adresse === '/q' && !Object.values(STATUS).includes(f.status)) fehler.push(`/q.status ${f.status} unbekannt`);
    gelesen[m.adresse].push(f);
  }
  assert.deepEqual(fehler, []);
  const z = gelesen['/zustand/arr'];
  assert.ok(z.some((f) => f.nr === 7 && f.status === 2 && f.loop_an === 1 && f.metronom_an === 1), 'gespielt mit Loop und Metronom');
  assert.ok(z.some((f) => f.nr === 7 && f.status === 0), 'gestoppt');
  const q = gelesen['/q'];
  assert.ok(q.some((f) => f.grund === 'ausserhalb_bereich' && f.status === STATUS.abgelehnt));
  assert.ok(q.some((f) => f.quelle === 'cypher' && f.grund === 'ki_gestoppt'));
  assert.ok(q.some((f) => f.status === STATUS.gestartet && f.quelle === 'andreas'));
});

const rampe = (id, ab, ziel, dauer, quelle = 'leitstand') => ['/k/tempo/rampe', 'hsddd', id, quelle, ab, ziel, dauer];

// Spec 6.33 wie im Kern (test_kern_arr_freeze Fall 7): (a) eine angenommene Rampe, deren Einsatz an der Takt-Eins noch
// aussteht, lehnt den Freeze ab (6 tempo_rampe); (c) nach dem Rampen-Ende angenommen und fertig; (d) eine Rampe, gleich von
// welcher Quelle, bricht einen wartenden und einen laufenden Freeze ab (7 abbruch, /e/freeze 1, keine Datei).
// Mutationen arr_freeze_ohne_rampenpruefung ((a) rot) und arr_freeze_rampe_ohne_abbruch ((d) rot).
test('arr: freeze gegen Tempo-Rampe (Spec 6.33): tempo_rampe, danach angenommen, Rampe bricht ab', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-arr-'));
  const r = fahre([
    sende(0, laden(40, 1)),
    sende(1000, rampe(41, 4, 120, 4)),                // Einsatz Beat 4 (Sample 90 000), Ende Beat 8 (rund 182 900)
    erwarte(2000, q(41, 'leitstand', 1)),
    sende(4000, freeze(42, 1, 0.0, 1.0, 1)),          // (a) die Rampe wartet noch
    erwarte(6000, q(42, 'andreas', 6, null, 'tempo_rampe')),
    erwarte(200000, q(41, 'leitstand', 3)),
    sende(200000, freeze(43, 1, 0.0, 1.0, 2)),        // (c) keine Rampe offen
    erwarte(202000, q(43, 'andreas', 1)),
    erwarte(300000, q(43, 'andreas', 3)),
    erwarte(300000, ['/e/freeze', 'iiih', 1, 2, 0, null]),
    sende(320000, freeze(44, 1, 0.0, 4.0, 3)),        // (d) wartend: Einsatz bei 320 256 + 537 + 256
    erwarte(320300, q(44, 'andreas', 1)),       // Stempel des Blocks, in dem er ankommt (320 256)
    sende(320256, rampe(45, 20, 130, 4, 'andreas')),
    erwarte(322000, q(44, 'andreas', 7, null, 'abbruch')),
    erwarte(322000, ['/e/freeze', 'iiih', 1, 3, 1, 0]),
    erwarte(700000, q(45, 'andreas', 3)),
    sende(700000, freeze(46, 1, 0.0, 8.0, 4)),        // (d) laufend
    erwarte(702000, q(46, 'andreas', 2)),
    sende(720000, rampe(47, 40, 128, 4, 'cypher')),
    erwarte(722000, q(46, 'andreas', 7, null, 'abbruch')),
    erwarte(722000, ['/e/freeze', 'iiih', 1, 4, 1, 0]),
  ], { cfg: { ...cfg, arr_ordner: ordner } });
  const dateien = fs.readdirSync(ordner);
  fs.rmSync(ordner, { recursive: true, force: true });
  gruen(r);
  assert.deepEqual(dateien, ['freeze-1-2.f32']);
});

// Wie der Kern: Laden und die Hand-Taste arr/start_stopp brechen einen Freeze ab (7 abbruch, /e/freeze 1); ein KI-Stopp
// bricht Cyphers Freeze ab (7 ki_stopp), Andreas' nicht; eine vorhandene Freeze-Datei wird nie ersetzt (Spec 6.25,
// /e/freeze 2, Inhalt bleibt).
test('arr: freeze bricht bei Laden, Hand-Taste und KI-Stopp (Cypher) ab; Datei nie ersetzt', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-arr-'));
  fs.writeFileSync(path.join(ordner, 'freeze-1-9.f32'), Buffer.from('alt'));
  const r = fahre([
    sende(0, laden(50, 1)),
    sende(4000, freeze(51, 1, 0.0, 4.0, 5)),
    erwarte(8000, q(51, 'andreas', 2)),
    sende(20000, laden(52, 2)),
    erwarte(22000, q(51, 'andreas', 7, null, 'abbruch')),
    erwarte(22000, ['/e/freeze', 'iiih', 1, 5, 1, 0]),
    sende(30000, freeze(53, 1, 0.0, 4.0, 6)),
    erwarte(34000, q(53, 'andreas', 2)),
    { t: 'hand', sample: 40000, pfad: 'arr/start_stopp', midi_roh: 1.0 },
    erwarte(42000, q(53, 'andreas', 7, null, 'abbruch')),
    erwarte(42000, ['/e/freeze', 'iiih', 1, 6, 1, 0]),
    sende(50000, freeze(54, 1, 0.0, 4.0, 7, 'cypher')),
    erwarte(54000, q(54, 'cypher', 2)),
    sende(60000, ['/k/ki/stopp', 'hs', 55, 'andreas']),
    erwarte(64000, q(54, 'cypher', 7, null, 'ki_stopp')),
    erwarte(64000, ['/e/freeze', 'iiih', 1, 7, 1, 0]),
    sende(70000, freeze(56, 1, 0.0, 1.0, 9)),
    erwarte(150000, ['/e/freeze', 'iiih', 1, 9, 2, 0]),
  ], { cfg: { ...cfg, arr_ordner: ordner } });
  const alt = fs.readFileSync(path.join(ordner, 'freeze-1-9.f32'), 'utf8');
  const dateien = fs.readdirSync(ordner).sort();
  fs.rmSync(ordner, { recursive: true, force: true });
  gruen(r);
  assert.equal(alt, 'alt');
  assert.deepEqual(dateien, ['freeze-1-9.f32']);
});

// Fix L1 wie im Kern (test_kern_arr_freeze Fall 8): /k/set/neu bricht einen laufenden und einen wartenden Freeze ab
// (7 abbruch am Sample 0 der neuen Achse, /e/freeze 1, keine Datei); danach läuft ein Freeze durch (Negativ-Kontrolle).
// Mutation arr_freeze_set_neu_bleibt macht den Test rot.
test('arr: /k/set/neu bricht einen laufenden und einen wartenden Freeze ab (7 abbruch, /e/freeze 1, keine Datei)', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-arr-'));
  const r = fahre([
    sende(0, laden(60, 1)),
    sende(4000, freeze(61, 1, 0.0, 8.0, 21)),
    erwarte(8000, q(61, 'andreas', 2)),
    sende(30000, setNeu(62, 100)),                   // laufend; die neue Achse beginnt im nächsten Block bei 0
    erwarte(31000, q(62, 'leitstand', 2, 0)),
    erwarte(31000, q(61, 'andreas', 7, 0, 'abbruch')),
    erwarte(31000, ['/e/freeze', 'iiih', 1, 21, 1, 0]),
    sende(32000, freeze(63, 1, 0.0, 4.0, 22)),       // wartend: Einsatz rund 793 Samples nach dem Annahme-Block
    erwarte(32300, q(63, 'andreas', 1)),
    sende(32300, setNeu(64)),
    erwarte(33000, q(64, 'leitstand', 2, 0)),
    erwarte(33000, q(63, 'andreas', 7, 0, 'abbruch')),
    erwarte(33000, ['/e/freeze', 'iiih', 1, 22, 1, 0]),
    sende(34000, freeze(65, 1, 0.0, 1.0, 23)),       // Negativ-Kontrolle: ohne /k/set/neu fertig
    erwarte(150000, q(65, 'andreas', 3)),
    erwarte(150000, ['/e/freeze', 'iiih', 1, 23, 0, null]),
  ], { cfg: { ...cfg, arr_ordner: ordner } });
  const dateien = fs.readdirSync(ordner);
  fs.rmSync(ordner, { recursive: true, force: true });
  const st = (id) => r.log.filter((m) => m.adresse === '/q' && m.werte[0] === BigInt(id)).map((m) => m.werte[2]);
  gruen(r);
  assert.deepEqual(st(61), [1, 2, 7]);
  assert.deepEqual(st(63), [1, 7]);
  assert.deepEqual(dateien, ['freeze-1-23.f32']);
});
