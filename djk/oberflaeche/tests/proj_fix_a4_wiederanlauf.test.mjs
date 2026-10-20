// D1 S2-Integration, Fix-Runde A4 (Spec 6.30 zu 6.21, Quality-Review R6, Spec-Review P2/R2): Wiederanlauf präzisiert.
// - Die Wiedergabe-Nummern einer Instanz werden nie wiederverwendet: der Zähler steht zusätzlich in einer Zustandsdatei ausserhalb des
//   Cache-Ordners (Nummer = Maximum aus Datei und Arbeitsordner plus 1). Ein geleerter Arbeitsordner führt nicht zu einem falschen Wiederanlauf.
// - Bei gleicher Nummer gewinnt der Kern ganz: der Server setzt weder erz/4 noch Loop oder Metronom neu.
// - Ist der Ist-Wert eines Spur-Reglers unbekannt, gewinnt für genau diesen Regler das Projekt (er wird gesendet, nicht übernommen).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pruefKontext, sitzung, neustart, arrNr, ist } from './hilfen/proj_kontext.mjs';
import { ProjSitzung } from '../bereiche/proj/sitzung.ts';
import { WiedergabeZaehler } from '../projekt/wiedergabe.ts';
import { tmpOrdner } from './hilfen/projekt.mjs';

const laeuft = (nr) => ({ nr, status: 2, loop_an: 0, projekt_beat: 0, ursprung_sample: 0, start_beat: 0, metronom_an: 0 });

// --- Zähler -----------------------------------------------------------------------------------------------------------------------
test('A4 Zähler: Arbeitsordner geleert → neue Nummer grösser als alle früheren (Zustandsdatei ausserhalb des Arbeitsordners)', async (t) => {
  const d = tmpOrdner(t, 'djk-fixa4-'), opt = { wurzel: path.join(d, 'p'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 };
  const s1 = new ProjSitzung(pruefKontext(), opt);
  const frueher = [];
  frueher.push((await s1.neu('Q', 'andreas')).j.projekt.wiedergabe_rev);
  for (let i = 0; i < 3; i++) {
    const r = await s1.aendern({ rev: i, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
    frueher.push(r.j.kern.wiedergabe.nr);
  }
  s1.schliesse();
  assert.deepEqual(frueher, [1, 2, 3, 4]);
  const datei = `${opt.arbeitsordner}.zaehler`;                                    // Spec 6.31: <arbeitsordner>.zaehler
  assert.equal(fs.readFileSync(datei, 'utf8').trim(), '1024', 'Zustandsdatei neben dem Arbeitsordner, nicht darin (Spec 6.32: hält die Blockgrenze)');
  fs.rmSync(opt.arbeitsordner, { recursive: true, force: true });
  const s2 = new ProjSitzung(pruefKontext(), opt); t.after(() => s2.schliesse());
  const neu = (await s2.neu('R', 'andreas')).j.projekt.wiedergabe_rev;
  assert.ok(neu > Math.max(...frueher), `neue Nummer ${neu} > ${Math.max(...frueher)}`);
});

test('A4 Zähler: Nummer = Maximum aus Datei und Arbeitsordner plus 1; die Datei hält die Grenze des reservierten Blocks (Spec 6.32)', (t) => {
  const d = tmpOrdner(t, 'djk-fixa4z-'), arr = path.join(d, 'arr'), datei = path.join(d, 'zustand', 'zaehler');
  fs.mkdirSync(arr, { recursive: true }); fs.writeFileSync(path.join(arr, 'wiedergabe-7.json'), '{}');
  assert.equal(new WiedergabeZaehler(arr, datei).naechste(), 8, 'Ordner 7, keine Datei → 8');
  assert.equal(fs.readFileSync(datei, 'utf8').trim(), String(7 + 1024));
  fs.writeFileSync(datei, '20\n');
  const z = new WiedergabeZaehler(arr, datei);
  assert.deepEqual([z.naechste(), z.naechste()], [21, 22], 'Datei 20, Ordner 7 → 21, 22');
  assert.equal(fs.readFileSync(datei, 'utf8').trim(), String(20 + 1024), 'ein Block für beide Nummern');
  fs.writeFileSync(datei, 'kaputt');
  assert.equal(new WiedergabeZaehler(arr, datei).naechste(), 8, 'unlesbare Datei zählt als 0, der Ordner trägt');
});

// Probe R6 des Quality-Reviews (review-qual/probe_r6.test.mjs) mit Behauptung: nach dem Leeren bekommt R keine Nummer, die Q schon trug
for (const wischen of [true, false]) test(`A4 Probe R6: Arbeitsordner gewischt=${wischen} → kein falscher Wiederanlauf beim Öffnen von Q`, async (t) => {
  const d = tmpOrdner(t, 'djk-fixa4r6-'), opt = { wurzel: path.join(d, 'p'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 50 };
  const s1 = new ProjSitzung(pruefKontext(), opt);
  await s1.neu('Q', 'andreas'); s1.schliesse();
  if (wischen) fs.rmSync(opt.arbeitsordner, { recursive: true, force: true });
  const k2 = pruefKontext(); const s2 = new ProjSitzung(k2, opt); t.after(() => s2.schliesse());
  const r = await s2.neu('R', 'andreas');
  s2.ereignis('/zustand/arr', laeuft(r.j.projekt.wiedergabe_rev));   // der Kern spielt R
  k2.leere();
  const o = await s2.oeffnen('q', 'andreas');
  assert.notEqual(r.j.projekt.wiedergabe_rev, 1, 'R trägt nicht die Nummer von Q');
  assert.equal(o.j.kern.wiederanlauf, undefined, 'kein Wiederanlauf: Q gewinnt nicht die Regler von R');
  assert.equal(k2.an('/k/arr/laden').length, 1, 'Q wird neu geladen');
});

// --- Wiederanlauf: Kern gewinnt ganz ---------------------------------------------------------------------------------------------------
test('A4 Wiederanlauf: weder erz/4 noch Loop noch Metronom neu gesetzt; die KI-Maske wird geleert (E-a: spur/0)', async (t) => {
  const { z, nr } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(nr));
  for (const n of [1, 2]) for (const [f, w] of [['fader', 0], ['pan', 0], ['mute', 0], ['solo', 0]]) ist(z.s, `spur/${n}/${f}`, w);
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(r.j.kern.wiederanlauf, true);
  assert.equal(z.k.teile(/^erz\/4\//).length, 0, 'kein erz/4');
  assert.equal(z.k.an('/k/arr/loop').length, 0, 'kein Loop'); assert.equal(z.k.an('/k/arr/metronom').length, 0, 'kein Metronom');
  assert.equal(z.k.an('/k/arr/laden').length, 0, 'keine neue Wiedergabe');
  assert.deepEqual(z.k.an('/k/ki/spur').map((x) => x.felder.kanaele), ['spur/0']);
});

test('A4 Negativ-Kontrolle: verschiedene Nummer → erz/4, Loop, Metronom und alle 32 Spur-Regler werden gesetzt', async (t) => {
  const { z, nr } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(nr + 1));
  await z.s.oeffnen('wa', 'andreas');
  assert.equal(z.k.teile(/^erz\/4\//).length, 16); assert.equal(z.k.an('/k/arr/loop').length, 1); assert.equal(z.k.an('/k/arr/metronom').length, 1);
  assert.equal(z.k.teile(/^spur\//).length, 32);
});

test('A4 unbekannter Ist-Wert: Kern liefert nur spur/1, Projekt hat spur/1 und spur/2 → spur/2 aus dem Projekt gesendet, spur/1 übernommen', async (t) => {
  const { z, nr } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(nr));
  ist(z.s, 'spur/1/fader', -12); ist(z.s, 'spur/1/pan', 0.5); ist(z.s, 'spur/1/mute', 1); ist(z.s, 'spur/1/solo', 0);
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(r.j.kern.wiederanlauf, true);
  assert.equal(z.k.teile(/^spur\/1\//).length, 0, 'spur/1 bekannt: nichts gesendet');
  assert.deepEqual(z.k.teile(/^spur\/2\//).map((x) => [x.felder.pfad, x.felder.nach]),
    [['spur/2/fader', 0], ['spur/2/pan', 0], ['spur/2/mute', 0], ['spur/2/solo', 0]], 'spur/2 unbekannt: Projektwerte gesendet');
  assert.equal(z.k.teile(/^spur\/[3-8]\//).length, 24, 'freie Slots unbekannt: Vorgabe gesendet');
  const sp = r.j.projekt.spuren;
  assert.deepEqual([sp[0].fader_db, sp[0].pan, sp[0].mute, sp[1].fader_db], [-12, 0.5, true, 0], 'spur/1 übernommen, spur/2 bleibt');
});

test('A4 unbekannter Fader einer Cypher-Spur während des KI-Stopps (E-a): wird wie jeder andere aus dem Projekt gesendet', async (t) => {
  const { z, nr } = neustart(t);
  z.k.ki = true;
  z.s.ereignis('/zustand/arr', arrNr(nr));
  await z.s.oeffnen('wa', 'andreas');
  assert.equal(z.k.teile(/^spur\/2\/fader$/).length, 1, 'spur/2 gehört cypher, der Stopp senkt sie nicht');
  assert.equal(z.k.teile(/^spur\/1\/fader$/).length, 1);
  assert.equal(z.k.teile(/^spur\/2\/pan$/).length, 1);
});
