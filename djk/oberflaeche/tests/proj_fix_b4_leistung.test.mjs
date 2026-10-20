// D1 S2-Integration, Fix-Runde B4 (Spec 6.30, Quality-Befund 4) und zweite Fix-Runde F6 (Spec 6.31): Leistung. Richtgröße D1: 10.000 Noten,
// ein Fader über /proj/aendern im Median unter 30 ms und eine Notenänderung im Median unter 50 ms (Sitzung); 60.000 Noten werden gemessen und
// berichtet (kein Urteil). Die Messwerte stehen in der Testausgabe (# LEISTUNG ...). F6: eine Änderung wird einmal ausgeführt, nicht als Probe
// und im Verlauf noch einmal; vorher lag die Notenänderung bei 10.000 Noten über 50 ms (Quality-Probe p3: 74 ms).
// Fix3 G7 (Spec 6.32): der Wiedergabe-Zähler reserviert Nummern in Blöcken zu 1024 und schreibt seine Datei nur beim Blockwechsel; Ziel im
// Einzellauf: Notenänderung bei 10.000 Noten im Median höchstens 40 ms, damit die 50 ms auch im Suite-Lauf unter Last halten. Die Ausgabe weist
// im Sitzungsrahmen Speichern (project.json), Zähler und Rest getrennt aus (Median je Änderung, aus 40 Fader- und 25 Notenänderungen).
// Zwei Rahmen:
//  - Sitzung (wie Quality-Probe R3): der Weg des Servers ohne Netz, die Kern-Quittung kommt sofort. Das ist der Anteil, den der Server selbst
//    kostet (Befehle, Speichern mit fsync, Verlauf, Wiedergabe, SSE, JSON der Antwort). Hier gelten die Urteile < 30 ms (Fader) und < 50 ms (Note).
//  - Stapel (Seiten-Server + Kern-Attrappe über HTTP und UDP): gemessen und berichtet. Darin steckt das Warten auf die Quittung des /k/teil
//    (Vorlauf 0,1 Beat ab „jetzt“, Spec 3.4 „Regler zuerst, Quittungen abwarten“), das kein Teil von B4 ändert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf } from './hilfen/proj_stapel.mjs';
import { sitzung } from './hilfen/proj_kontext.mjs';

const BLOCK = 10_000;                                                           // Noten je Anfrage (Körper unter 1 MiB)
const noten = (n, ab) => Array.from({ length: n }, (_, i) => ({ beat: ((ab + i) % 4000) / 8, laenge: 0.1, ton: 36 + ((ab + i) % 48), vel: 90 }));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const ms = (x) => +x.toFixed(2);

// aendere(befehle) → Antwort-JSON; baut 2 Spuren und `zahl` Noten in Clips zu je BLOCK, misst dann 40 Fader-Schritte und 25 Notenänderungen
// (eine Note in c1, betrifft die Wiedergabe: neue Wiedergabe-Datei, Zähler, Speichern, /k/arr/laden)
async function lauf(zahl, aendere, rahmen, anteile = null) {
  await aendere([{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'audio' }]);
  for (let ab = 0, c = 0; ab < zahl; ab += BLOCK, c++) {
    await aendere([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: c * 512, laenge_beats: 512, noten: noten(Math.min(BLOCK, zahl - ab), ab) }]);
  }
  // anteile (nur Sitzung): misst je Änderung die Zeit in speichere und im Zähler; der Rest ist gesamt minus beides
  const teile = { fader: { speichere: [], zaehler: [], rest: [] }, note: { speichere: [], zaehler: [], rest: [] } };
  const messe = async (art, befehle) => {
    anteile?.null();
    const t0 = performance.now();
    await aendere(befehle);
    const gesamt = performance.now() - t0;
    if (anteile) {
      const a = anteile.lies();
      teile[art].speichere.push(a.speichere); teile[art].zaehler.push(a.zaehler); teile[art].rest.push(gesamt - a.speichere - a.zaehler);
    }
    return gesamt;
  };
  const zeiten = [];
  for (let i = 0; i < 40; i++) zeiten.push(await messe('fader', [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -(i % 20) - 1 }]));
  const note = [];
  for (let i = 0; i < 25; i++) note.push(await messe('note', [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', vel: 50 + (i % 40) }] }]));
  const m = { rahmen, noten: zahl, wiederholungen: { fader: zeiten.length, note: note.length }, fader_median_ms: ms(median(zeiten)), fader_max_ms: ms(Math.max(...zeiten)),
    note_median_ms: ms(median(note)), note_max_ms: ms(Math.max(...note)) };
  if (anteile) {
    for (const art of ['fader', 'note']) for (const k of ['speichere', 'zaehler', 'rest']) m[`${art}_${k}_median_ms`] = ms(median(teile[art][k]));
  }
  return m;
}

// Zeitanteile über Umhüllen der zwei Werkzeuge der Sitzung (Felder projekte und zaehler; nur gemessen, das Verhalten bleibt)
function anteileVon(s) {
  const acc = { speichere: 0, zaehler: 0 };
  const huelle = (obj, name, k) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { acc[k] += performance.now() - t0; } }; };
  huelle(s.projekte, 'speichere', 'speichere');
  huelle(s.zaehler, 'naechste', 'zaehler');
  return { null: () => { acc.speichere = 0; acc.zaehler = 0; }, lies: () => ({ ...acc }) };
}

async function sitzungsLauf(t, zahl) {
  const { s } = sitzung(t);
  await s.neu(`Last ${zahl}`, 'andreas');
  let rev = 0;
  const m = await lauf(zahl, async (befehle) => {
    const r = await s.aendern({ rev, label: 'x', befehle }, 'andreas');
    JSON.stringify(r.j);                                                        // was die Route als Antwort serialisiert
    rev = r.j.rev;
  }, 'sitzung', anteileVon(s));
  const t0 = performance.now(); const kurz = JSON.stringify(s.aktuell('noten_zahl').j); const kurzMs = performance.now() - t0;
  const t1 = performance.now(); const voll = JSON.stringify(s.aktuell().j); const vollMs = performance.now() - t1;
  Object.assign(m, { lage_kurz_bytes: kurz.length, lage_kurz_ms: ms(kurzMs), lage_voll_bytes: voll.length, lage_voll_ms: ms(vollMs) });
  console.log(`LEISTUNG ${JSON.stringify(m)}`);
  return m;
}

async function stapelLauf(t, zahl) {
  const { url } = await stapel(t);
  let rev = (await ruf(url, 'POST', '/proj/neu', { name: `Last ${zahl}` })).j.projekt.rev;
  const m = await lauf(zahl, async (befehle) => {
    const r = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'x', befehle });
    assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 300));
    rev = r.j.rev;
  }, 'stapel');
  const t0 = performance.now(); await ruf(url, 'GET', '/proj/aktuell?nur=rev'); m.rev_abfrage_ms = ms(performance.now() - t0);
  console.log(`LEISTUNG ${JSON.stringify(m)}`);
  return m;
}

test('B4/F6 Leistung 10.000 Noten, Sitzung: Fader im Median unter 30 ms, Notenänderung im Median unter 50 ms', { timeout: 300_000 }, async (t) => {
  const m = await sitzungsLauf(t, 10_000);
  assert.ok(m.fader_median_ms < 30, JSON.stringify(m));
  assert.ok(m.note_median_ms < 50, JSON.stringify(m));
  assert.ok(m.lage_kurz_bytes * 10 < m.lage_voll_bytes, 'proj_lage ohne Noten ist ein Bruchteil');
});

test('B4 Leistung 60.000 Noten, Sitzung: gemessen und berichtet', { timeout: 600_000 }, async (t) => { await sitzungsLauf(t, 60_000); });
test('B4 Leistung 10.000 Noten, Stapel mit Kern-Attrappe: gemessen und berichtet', { timeout: 300_000 }, async (t) => { await stapelLauf(t, 10_000); });
test('B4 Leistung 60.000 Noten, Stapel mit Kern-Attrappe: gemessen und berichtet', { timeout: 600_000 }, async (t) => { await stapelLauf(t, 60_000); });
