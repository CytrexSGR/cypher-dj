// D1 S2-Integration, zweite Fix-Runde F2 (Spec 6.31): /proj/oeffnen und /proj/neu antworten während eines Freeze mit 409 beschaeftigt. Öffnen
// lädt die Wiedergabe des Projekts in den Kern, und jedes Laden bricht den Freeze ab (Spec 6.23). Beleg: Quality-Probe p1 R3 (200, 1x Laden).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { Projekte } from '../projekt/ablage.ts';
import { pruefKontext } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

function aufbau(t) {
  const k = pruefKontext();
  const d = tmpOrdner(t, 'djk-f2-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  return { k, b, s: b.sitzung, d };
}
const fehlerVon = async (p) => { try { return { code: (await p).code }; } catch (e) { return { code: e.code, fehler: e.fehler, text: e.extra?.text }; } };

test('F2 Öffnen eines anderen Projekts während der Freeze-Sperre (Quality R3): 409 beschaeftigt, kein Laden, das laufende bleibt offen', async (t) => {
  const e = aufbau(t);
  await e.s.neu('Eins', 'andreas');
  new Projekte(path.join(e.d, 'projekte')).lege('Zwei');
  e.k.leere();
  const frei = e.b.zugang.sperreLaden();
  const r = await fehlerVon(e.s.oeffnen('zwei', 'andreas'));
  const n = e.k.an('/k/arr/laden').length;
  frei();
  console.log(`F2 oeffnen ${JSON.stringify({ ...r, laden: n, offen: e.s.aktuell().j.slug })}`);
  assert.deepEqual([r.code, r.fehler], [409, 'beschaeftigt']);
  assert.match(r.text, /freeze/);
  assert.equal(n, 0, 'kein /k/arr/laden unter der Sperre');
  assert.equal(e.s.aktuell().j.slug, 'eins', 'das laufende Projekt bleibt offen');
});

test('F2 Neues Projekt während der Freeze-Sperre: 409 beschaeftigt, kein Laden, kein Projektordner angelegt', async (t) => {
  const e = aufbau(t);
  await e.s.neu('Eins', 'andreas');
  e.k.leere();
  const frei = e.b.zugang.sperreLaden();
  const r = await fehlerVon(e.s.neu('Drei', 'andreas'));
  const n = e.k.an('/k/arr/laden').length;
  frei();
  console.log(`F2 neu ${JSON.stringify({ ...r, laden: n })}`);
  assert.deepEqual([r.code, r.fehler], [409, 'beschaeftigt']);
  assert.equal(n, 0);
  assert.equal(fs.existsSync(path.join(e.d, 'projekte', 'drei')), false, 'kein Ordner für das abgelehnte Projekt');
  assert.equal(e.s.aktuell().j.slug, 'eins');
});

test('F2 Negativ-Kontrolle: nach der Freigabe öffnen und anlegen wie gewohnt (200, je 1x Laden)', async (t) => {
  const e = aufbau(t);
  await e.s.neu('Eins', 'andreas');
  new Projekte(path.join(e.d, 'projekte')).lege('Zwei');
  e.b.zugang.sperreLaden()();
  e.k.leere();
  assert.equal((await e.s.oeffnen('zwei', 'andreas')).code, 200);
  assert.equal((await e.s.neu('Drei', 'andreas')).code, 200);
  assert.equal(e.k.an('/k/arr/laden').length, 2);
  assert.equal(e.s.aktuell().j.slug, 'drei');
});
