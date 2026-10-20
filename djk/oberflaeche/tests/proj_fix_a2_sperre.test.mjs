// D1 S2-Integration, Fix-Runde A2 (Spec 6.30 zu 6.23, Spec-Review P4/R3, Quality-Review R2): die Freeze-Sperre gilt bis zum Laden.
// vollziehe prüft sie unmittelbar vor dem Laden der Wiedergabe noch einmal. Wird sie gesetzt, während eine Änderung auf ihre
// Regler-Quittungen wartet, bleibt die Änderung gespeichert, das Laden wird gemerkt und folgt genau einmal nach der Freigabe.
// Aufbau wie ~/messungen/2026-10-15-d1-s2-integration/review-spec/p4_rennen.test.mjs (verzögerte Quittung, sperreLaden() dazwischen).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
function aufbau(t) {
  let halte = false; const wartend = [];
  const k = pruefKontext({ quittung: (adr) => (adr === '/k/teil' && halte
    ? new Promise((ok) => wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-fixa2-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  return { k, b, s: b.sitzung, halten: (x) => { halte = x; }, wartend };
}
// startet lauf(), wartet bis eine /k/teil-Quittung hängt, setzt die Sperre, gibt die Quittungen frei; liefert Antwort und Ladezahlen
async function rennen(e, lauf, sperren = true) {
  e.halten(true); e.k.leere();
  const p = lauf();
  for (let i = 0; i < 200 && e.wartend.length === 0; i++) await schlaf(5);
  assert.ok(e.wartend.length > 0, 'die Änderung wartet auf Regler-Quittungen');
  const frei = sperren ? e.b.zugang.sperreLaden() : () => {};
  e.halten(false); for (const f of e.wartend.splice(0)) f();
  const r = await p;
  const waehrend = e.k.an('/k/arr/laden').length;
  const revNachAntwort = e.s.aktuell().j.projekt.rev;
  frei();
  await warteBis(() => e.k.an('/k/arr/laden').length > waehrend, 500);
  await schlaf(30);
  return { r, waehrend, nach: e.k.an('/k/arr/laden').length - waehrend, revNachAntwort };
}

test('A2 aendern: sperreLaden() während der Regler-Quittungen einer Spur-Anlage → 200, gespeichert, 0x laden während der Sperre, 1x nach Freigabe', async (t) => {
  const e = aufbau(t);
  await e.s.neu('R', 'andreas');
  const x = await rennen(e, () => e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas'));
  assert.equal(x.r.code, 200);
  assert.equal(x.revNachAntwort, 1, 'die Änderung ist gespeichert');
  assert.deepEqual(x.r.j.kern.wiedergabe, { nr: null, aufgeschoben: true });
  assert.equal(x.waehrend, 0, 'kein /k/arr/laden während der Sperre');
  assert.equal(x.nach, 1, 'genau ein /k/arr/laden nach der Freigabe');
  assert.equal(e.k.an('/k/arr/laden')[0].felder.nr, e.s.aktuell().j.projekt.wiedergabe_rev, 'geladen wird die Wiedergabe des Projekts');
});

test('A2 undo: dieselbe Lücke im Rückgängig-Weg (umkehr) → 0x laden während der Sperre, 1x nach Freigabe', async (t) => {
  const e = aufbau(t);
  await e.s.neu('R', 'andreas');
  await e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const x = await rennen(e, () => e.s.umkehr('undo', { rev: 1 }, 'andreas'));
  assert.equal(x.r.code, 200); assert.equal(e.s.aktuell().j.projekt.spuren.length, 0);
  assert.equal(x.waehrend, 0, 'kein /k/arr/laden während der Sperre');
  assert.equal(x.nach, 1, 'genau ein /k/arr/laden nach der Freigabe');
});

test('A2 Negativ-Kontrolle: ohne Sperre lädt dieselbe Änderung sofort (1x), nach der Antwort nichts mehr', async (t) => {
  const e = aufbau(t);
  await e.s.neu('R', 'andreas');
  const x = await rennen(e, () => e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas'), false);
  assert.equal(x.r.code, 200); assert.equal(x.waehrend, 1); assert.equal(x.nach, 0);
  assert.equal(x.r.j.kern.wiedergabe.nr, e.s.aktuell().j.projekt.wiedergabe_rev);
});

test('A2 Negativ-Kontrolle: Sperre vor der Änderung → 409 beschaeftigt, nichts gespeichert, kein Laden', async (t) => {
  const e = aufbau(t);
  await e.s.neu('R', 'andreas'); e.k.leere();
  const frei = e.b.zugang.sperreLaden();
  let f = null; try { await e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas'); } catch (x) { f = x; }
  frei();
  assert.equal(f?.fehler, 'beschaeftigt'); assert.equal(e.k.an('/k/arr/laden').length, 0); assert.equal(e.s.aktuell().j.projekt.rev, 0);
});
