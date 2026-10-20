// D1 S2-Integration, dritte Fix-Runde G7 (Spec 6.32, Leistung): Der Wiedergabe-Zähler reserviert Nummern in Blöcken zu 1024. Die Zustandsdatei
// hält die obere Grenze des Blocks und wird nur beim Blockwechsel haltbar geschrieben (fsync auf Datei und Ordner wie bisher); nach einem Neustart
// beginnt der Zähler an dieser Grenze. Lücken sind erlaubt, eine Nummer zweimal nie. Vorher schrieb jede Nummer die Datei mit zwei fsync
// (Quality-Re-Review: 9,7 ms von 42 ms einer Notenänderung bei 10.000 Noten).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjSitzung } from '../bereiche/proj/sitzung.ts';
import * as wiedergabe from '../projekt/wiedergabe.ts';
import { pruefKontext } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const { WiedergabeZaehler } = wiedergabe;
const ZAEHLER_BLOCK = wiedergabe.ZAEHLER_BLOCK ?? 1024;                  // Spec 6.32; der Test läuft so auch gegen den Stand vor dem Block (Rot-Beleg)
const lies = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null);
// Wie oft wird die Zustandsdatei geschrieben? Gezählt am rename auf genau diesen Pfad (Temp + rename, schreibeHaltbar)
function schreibZaehlung(ziel, f) {
  const { renameSync } = fs;
  let n = 0;
  fs.renameSync = (a, b) => { if (path.resolve(String(b)) === path.resolve(ziel)) n++; return renameSync(a, b); };
  try { f(); } finally { fs.renameSync = renameSync; }
  return n;
}

test('G7 Blockgröße 1024', () => { assert.equal(wiedergabe.ZAEHLER_BLOCK, 1024); });

test('G7 Neustart mitten im Block vergibt keine Nummer zweimal; nach dem Neustart beginnt der Zähler an der gespeicherten Grenze', (t) => {
  const d = tmpOrdner(t, 'djk-g7a-');
  const arr = path.join(d, 'arr'), datei = path.join(d, 'zustand', 'zaehler');
  const vergeben = [];
  const z1 = new WiedergabeZaehler(arr, datei);
  for (let i = 0; i < 10; i++) vergeben.push(z1.naechste());
  const nachZ1 = lies(datei);
  const z2 = new WiedergabeZaehler(arr, datei);                     // Neustart mitten im ersten Block
  const erste2 = z2.naechste(); vergeben.push(erste2);
  for (let i = 0; i < 5; i++) vergeben.push(z2.naechste());
  const nachZ2 = lies(datei);
  const z3 = new WiedergabeZaehler(arr, datei);                     // und noch einmal
  const erste3 = z3.naechste(); vergeben.push(erste3);
  const m = { nachZ1, erste2, nachZ2, erste3, doppelt: vergeben.length - new Set(vergeben).size };
  console.log(`G7 Neustart ${JSON.stringify(m)}`);
  assert.deepEqual(vergeben.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'im Block fortlaufend');
  assert.equal(nachZ1, '1024', 'die Datei hält die obere Grenze des Blocks');
  assert.equal(erste2, 1025, 'nach dem Neustart beginnt der Zähler an der gespeicherten Grenze');
  assert.equal(nachZ2, '2048');
  assert.equal(erste3, 2049);
  assert.equal(m.doppelt, 0, 'keine Nummer zweimal');
});

test('G7 1024 Vergaben schreiben die Datei genau einmal, die 1025. öffnet den nächsten Block (zweites Schreiben)', (t) => {
  const d = tmpOrdner(t, 'djk-g7b-');
  const datei = path.join(d, 'zaehler');
  const z = new WiedergabeZaehler(path.join(d, 'arr'), datei);
  let letzte = 0;
  const block1 = schreibZaehlung(datei, () => { for (let i = 0; i < 1024; i++) letzte = z.naechste(); });
  const stand1 = lies(datei);
  const block2 = schreibZaehlung(datei, () => { letzte = z.naechste(); });
  console.log(`G7 Schreibzaehlung ${JSON.stringify({ block1, stand1, block2, stand2: lies(datei), letzte })}`);
  assert.equal(block1, 1, '1024 Nummern, ein Schreiben');
  assert.equal(stand1, '1024');
  assert.equal(block2, 1);
  assert.equal(lies(datei), '2048');
  assert.equal(letzte, 1025);
});

test('G7 Start: das Maximum aus Datei und Arbeitsordner zählt (eine höhere Wiedergabe-Datei im Ordner überholt die Grenze)', (t) => {
  const d = tmpOrdner(t, 'djk-g7c-');
  const arr = path.join(d, 'arr'), datei = path.join(d, 'zaehler');
  fs.mkdirSync(arr); fs.writeFileSync(path.join(arr, 'wiedergabe-1500.json'), '{}');
  fs.writeFileSync(datei, '1024\n');
  const z = new WiedergabeZaehler(arr, datei);
  assert.equal(z.naechste(), 1501);
  assert.equal(lies(datei), String(1500 + ZAEHLER_BLOCK));
});

test('G7 Negativ-Kontrolle: ohne Zustandsdatei kein Block, fortlaufend aus dem Arbeitsordner wie bisher', (t) => {
  const d = tmpOrdner(t, 'djk-g7neg-');
  fs.mkdirSync(path.join(d, 'arr')); fs.writeFileSync(path.join(d, 'arr', 'wiedergabe-5.json'), '{}');
  const z = new WiedergabeZaehler(path.join(d, 'arr'));
  assert.deepEqual([z.naechste(), z.naechste()], [6, 7]);
  assert.deepEqual(fs.readdirSync(d), ['arr'], 'keine Datei angelegt');
});

test('G7 Sitzung: Projekt ändern, Server-Neustart, weiter ändern: jede geladene Wiedergabe-Nummer ist neu, die Dateien liegen da', async (t) => {
  const d = tmpOrdner(t, 'djk-g7s-');
  const opt = { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 };
  const k1 = pruefKontext();
  const s1 = new ProjSitzung(k1, opt);
  await s1.neu('Z', 'andreas');
  let rev = 0;
  for (let i = 0; i < 3; i++) rev = (await s1.aendern({ rev, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas')).j.rev;
  s1.schliesse();
  const k2 = pruefKontext();
  const s2 = new ProjSitzung(k2, opt);                                 // Server-Neustart auf denselben Ordnern
  t.after(() => s2.schliesse());
  await s2.oeffnen('z', 'andreas');
  for (let i = 0; i < 2; i++) rev = (await s2.aendern({ rev, label: 'y', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas')).j.rev;
  const nrs = [...k1.an('/k/arr/laden'), ...k2.an('/k/arr/laden')].map((x) => x.felder.nr);
  console.log(`G7 Sitzung ${JSON.stringify({ nrs, datei: lies(`${opt.arbeitsordner}.zaehler`) })}`);
  assert.equal(nrs.length, new Set(nrs).size, 'keine Nummer zweimal geladen');
  assert.ok(nrs.slice(4).every((n) => n > ZAEHLER_BLOCK), `nach dem Neustart aus dem nächsten Block: ${nrs}`);
  for (const n of nrs.slice(-5)) assert.ok(fs.existsSync(path.join(opt.arbeitsordner, `wiedergabe-${n}.json`)), `wiedergabe-${n}.json`);
});
