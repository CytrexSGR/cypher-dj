// D1 S2-Integration, dritte Fix-Runde G1 (Spec 6.32): Öffnen gegen Freeze, wer zuerst kommt, gewinnt. /proj/oeffnen und /proj/neu haben
// Wartestellen (Stopp-Quittung des laufenden Projekts, Wiederanlauf-Prüfung auf /zustand/arr); die Sperre am Anfang der Kette (6.31) sah eine
// Sperre nicht, die erst während dieser Wartestellen kam, und das Öffnen lud trotzdem. Jetzt lehnt sperreLaden() mit 409 beschaeftigt ab,
// solange ein Öffnen oder Anlegen läuft; synchronisiere prüft zusätzlich unmittelbar vor Laden und Loop (gesperrt: merken, nicht senden).
// Belege vorher: Spec-Re-Review W1 und W1b (laden_unter_sperre 1), Quality-Re-Review Q1 (laden_waehrend_sperre 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { Projekte } from '../projekt/ablage.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const laeuft = (nr) => ({ nr, status: 2, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0 });

function aufbau(t, opt = {}) {
  const halte = new Set(); const wartend = [];
  const k = pruefKontext({ quittung: (adr) => (halte.has(adr)
    ? new Promise((ok) => wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-g1-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30, ...opt });
  t.after(() => b.sitzung.schliesse());
  const loese = () => { halte.clear(); for (const f of wartend.splice(0)) f(); };
  return { k, b, s: b.sitzung, d, halte, wartend, loese };
}
const n = (e, a) => e.k.an(a).length;
// sperreLaden() wie S3 es ruft: die Freigabe oder der Fehler
const versuche = (e) => { try { return { frei: e.b.zugang.sperreLaden() }; } catch (x) { return { code: x.code, fehler: x.fehler, text: x.extra?.text }; } };

// Öffnen von "zwei", während "eins" läuft: die Stopp-Quittung des laufenden Projekts hängt, bis loese()
async function oeffneMitHaengendemStopp(e) {
  await e.s.neu('Eins', 'andreas');
  new Projekte(path.join(e.d, 'projekte')).lege('Zwei');
  e.s.ereignis('/zustand/arr', laeuft(e.s.aktuell().j.projekt.wiedergabe_rev));
  e.halte.add('/k/arr/stopp');
  e.k.leere();
  const p = e.s.oeffnen('zwei', 'andreas').catch((x) => x);
  assert.ok(await warteBis(() => e.wartend.length > 0, 1000), 'Stopp-Quittung hängt');
  return { p };                                // als Feld: ein zurückgegebenes Promise würde die async-Funktion übernehmen
}

for (const mitSperre of [true, false]) {
  test(`G1/W1 Sperre kommt während der Stopp-Quittung eines Öffnens (mitSperre=${mitSperre}): Öffnen gewinnt, 1x Laden, 1x Loop`, async (t) => {
    const e = aufbau(t);
    const { p } = await oeffneMitHaengendemStopp(e);
    const v = mitSperre ? versuche(e) : null;
    e.loese();
    const r = await p;
    await schlaf(30);
    const m = { mitSperre, sperre: v && (v.frei ? 'gesetzt' : [v.code, v.fehler]), code: r.code ?? r.fehler, laden: n(e, '/k/arr/laden'), loop: n(e, '/k/arr/loop'),
      offen: e.s.aktuell().j.slug };
    if (v?.frei) v.frei();
    console.log(`G1 W1 ${JSON.stringify(m)}`);
    if (mitSperre) {
      assert.deepEqual([v.code, v.fehler], [409, 'beschaeftigt'], 'sperreLaden() lehnt ab, solange ein Öffnen läuft');
      assert.match(v.text, /open/);
    }
    assert.equal(m.code, 200);
    assert.deepEqual([m.laden, m.loop, m.offen], [1, 1, 'zwei'], 'genau 1x Laden und 1x Loop, beides ohne gesetzte Sperre');
    const danach = versuche(e);
    assert.equal(typeof danach.frei, 'function', 'nach dem Öffnen nimmt sperreLaden() wieder an');
    danach.frei();
  });
}

test('G1/W1b Sperre kommt, während istWiederanlauf auf /zustand/arr wartet: 409 beschaeftigt, Öffnen lädt 1x', async (t) => {
  const e = aufbau(t, { arrFristMs: 300 });
  await e.s.neu('Zwei', 'andreas');            // Zwei bekommt eine Wiedergabe-Nummer
  await e.s.neu('Eins', 'andreas');
  e.k.leere();
  const p = e.s.oeffnen('zwei', 'andreas').catch((x) => x);
  await schlaf(60);                            // oeffne wartet bis zu 300 ms auf /zustand/arr
  const v = versuche(e);
  const r = await p;
  const m = { sperre: v.frei ? 'gesetzt' : [v.code, v.fehler], code: r.code ?? r.fehler, laden: n(e, '/k/arr/laden'), loop: n(e, '/k/arr/loop') };
  if (v.frei) v.frei();
  console.log(`G1 W1b ${JSON.stringify(m)}`);
  assert.deepEqual([v.code, v.fehler], [409, 'beschaeftigt']);
  assert.deepEqual([m.code, m.laden, m.loop], [200, 1, 1]);
});

test('G1/Q1 Sperre während eines laufenden Anlegens (/proj/neu): 409 beschaeftigt, kein Laden unter einer Sperre', async (t) => {
  const e = aufbau(t);
  await e.s.neu('Eins', 'andreas');
  e.s.ereignis('/zustand/arr', laeuft(e.s.aktuell().j.projekt.wiedergabe_rev));
  e.halte.add('/k/arr/stopp');
  e.k.leere();
  const p = e.s.neu('Drei', 'andreas');
  assert.ok(await warteBis(() => e.wartend.length > 0, 1000), 'Stopp wartet');
  const v = versuche(e);
  const ladenVorher = n(e, '/k/arr/laden');
  e.loese();
  const r = await p;
  const m = { sperre: v.frei ? 'gesetzt' : [v.code, v.fehler], code: r.code, offen: e.s.aktuell().j.slug, laden: n(e, '/k/arr/laden') - ladenVorher };
  if (v.frei) v.frei();
  console.log(`G1 Q1 ${JSON.stringify(m)}`);
  assert.deepEqual([v.code, v.fehler], [409, 'beschaeftigt']);
  assert.deepEqual([m.code, m.offen, m.laden], [200, 'drei', 1]);
});

test('G1 abgelehnte Sperre hinterlässt nichts: nach dem Öffnen geht eine Notenänderung durch (200), keine Sperre hängt', async (t) => {
  const e = aufbau(t);
  const { p } = await oeffneMitHaengendemStopp(e);
  versuche(e);
  e.loese();
  await p;
  const a = await e.s.aendern({ rev: 0, label: 'A', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  assert.equal(a.code, 200);
  assert.equal(typeof a.j.kern.wiedergabe.nr, 'number', 'geladen, nicht aufgeschoben');
});

// Zweite Linie (Spec 6.32 „synchronisiere prüft zusätzlich direkt vor dem Laden“): kommt eine Sperre doch an der ersten Linie vorbei (hier
// über das innere Feld nachgestellt), sendet synchronisiere weder Laden noch Loop, merkt beides am Offen, und die Freigabe holt es nach.
test('G1 synchronisiere unter gesetzter Sperre: kein Laden, kein Loop, beides gemerkt; nach der Freigabe je 1x', async (t) => {
  const e = aufbau(t);
  const { p } = await oeffneMitHaengendemStopp(e);
  const echt = e.s.oeffnet; e.s.oeffnet = 0;   // erste Linie umgehen
  const frei = e.b.zugang.sperreLaden();
  e.s.oeffnet = echt;
  e.loese();
  const r = await p;
  await schlaf(30);
  const unter = { laden: n(e, '/k/arr/laden'), loop: n(e, '/k/arr/loop'), kern: { wiedergabe: r.j.kern.wiedergabe, loop: r.j.kern.loop } };
  frei();
  assert.ok(await warteBis(() => n(e, '/k/arr/loop') > 0, 1000));
  await schlaf(30);
  const nach = { laden: n(e, '/k/arr/laden'), loop: n(e, '/k/arr/loop') };
  console.log(`G1 zweite Linie ${JSON.stringify({ unter, nach })}`);
  assert.deepEqual([unter.laden, unter.loop], [0, 0]);
  assert.deepEqual(unter.kern, { wiedergabe: { nr: null, aufgeschoben: true }, loop: { aufgeschoben: true } });
  assert.deepEqual(nach, { laden: 1, loop: 1 });
});
