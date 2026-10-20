// D1 S2-Integration, zweite Fix-Runde F1 (Spec 6.31): Die Freeze-Sperre gilt für jeden Weg zum Kern-Laden, auch für das Laden, das nach der
// Freigabe nachgeholt wird. Es prüft die Sperre direkt vor dem Laden; ist inzwischen eine zweite Sperre gesetzt (S3 friert die nächste Spur ein),
// wird es wieder gemerkt und folgt erst nach deren Freigabe. Belege: Re-Review rr_freigabe, Quality-Probe p1 R1/R2.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
function aufbau(t) {
  const halte = new Set(); const wartend = [];
  const k = pruefKontext({ quittung: (adr) => (halte.has(adr)
    ? new Promise((ok) => wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-f1-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const frei = () => { halte.clear(); for (const f of wartend.splice(0)) f(); };
  const haengt = async () => { for (let i = 0; i < 200 && wartend.length === 0; i++) await schlaf(5); assert.ok(wartend.length > 0, 'Änderung hängt'); };
  return { k, b, s: b.sitzung, d, halte, frei, haengt };
}
// Ein gemerktes Laden herstellen: Spur-Anlage wartet auf /k/teil, die Sperre kommt dazwischen → aufgeschoben
async function gemerkt(e) {
  e.halte.add('/k/teil');
  const p = e.s.aendern({ rev: e.s.aktuell().j.projekt.rev, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await e.haengt();
  const frei1 = e.b.zugang.sperreLaden();
  e.frei();
  const r = await p;
  assert.deepEqual(r.j.kern.wiedergabe, { nr: null, aufgeschoben: true });
  return frei1;
}
const laden = (e) => e.k.an('/k/arr/laden').length;

test('F1 Freigabe und im selben Tick die zweite Sperre (Quality R1): 0x Laden unter Sperre 2, 1x nach Freigabe 2', async (t) => {
  const e = aufbau(t);
  await e.s.neu('R', 'andreas');
  const frei1 = await gemerkt(e);
  e.k.leere();
  frei1();
  const frei2 = e.b.zugang.sperreLaden();
  await schlaf(100);
  const unter2 = laden(e);
  frei2();
  assert.ok(await warteBis(() => laden(e) > 0, 500), 'nach Freigabe 2 wird geladen');
  await schlaf(50);
  console.log(`F1 R1 ${JSON.stringify({ unter2, nach2: laden(e) })}`);
  assert.equal(unter2, 0, 'kein /k/arr/laden während der zweiten Sperre');
  assert.equal(laden(e), 1, 'genau einmal nach der Freigabe der zweiten Sperre');
});

test('F1 Freigabe bei belegter Kette, dann die zweite Sperre (Re-Review rr_freigabe, Quality R2): 0x unter Sperre 2, 1x danach', async (t) => {
  const e = aufbau(t);
  await e.s.neu('R', 'andreas');
  const frei1 = await gemerkt(e);
  e.halte.add('/k/teil');
  const p = e.s.aendern({ rev: 1, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }] }, 'andreas');
  await e.haengt();
  e.k.leere();
  frei1();                                                   // das Nachladen stellt sich hinter die wartende Fader-Änderung
  const frei2 = e.b.zugang.sperreLaden();                    // zweiter Freeze beginnt, bevor die Kette frei ist
  e.frei();
  assert.equal((await p).code, 200);
  await schlaf(100);
  const unter2 = laden(e);
  frei2();
  assert.ok(await warteBis(() => laden(e) > 0, 500), 'nach Freigabe 2 wird geladen');
  await schlaf(50);
  console.log(`F1 R2 ${JSON.stringify({ unter2, nach2: laden(e) })}`);
  assert.equal(unter2, 0, 'kein /k/arr/laden während der zweiten Sperre');
  assert.equal(laden(e), 1);
});

test('F1 Negativ-Kontrolle: Freigabe ohne zweite Sperre lädt genau einmal, mit der Nummer, die das Projekt danach trägt', async (t) => {
  const e = aufbau(t);
  await e.s.neu('R', 'andreas');
  const frei1 = await gemerkt(e);
  e.k.leere();
  frei1();
  assert.ok(await warteBis(() => laden(e) > 0, 500));
  await schlaf(50);
  assert.equal(laden(e), 1);
  assert.equal(e.k.an('/k/arr/laden')[0].felder.nr, e.s.aktuell().j.projekt.wiedergabe_rev);
});
