// node --test stellwerk.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lauf, verriegelung, gruppe, HANDGRIFF, HANDGRIFF_RELATIV, T } from './szenario.mjs';

const nah = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const wert = (v, s, r) => v.sw.beobachtet[s][r];

test('Negativ-Kontrolle: ohne Handgriff laeuft der Plan vollstaendig', () => {
  const v = lauf({ name: 'neg' });
  assert.equal(v.plan_status, 'vollstaendig');
  nah(wert(v, T(17), 'A.gain'), 0.8);
  nah(wert(v, T(19), 'A.gain'), 0.6);
  nah(wert(v, T(21), 'A.gain'), 0.4);
  nah(wert(v, T(25), 'A.gain'), 0.0);
  nah(wert(v, T(27), 'A.gain'), 0.0);
  assert.equal(wert(v, T(21) - 1, 'A.bass'), 1);
  assert.equal(wert(v, T(21), 'A.bass'), 0);            // Bass aus genau auf Takt 21
  assert.ok(v.max_sprung_gain.d < 2e-6);                // keine Stufe in der Rampe
});

test('Handgriff bei Takt 19: Gain-A-Teil endet am selben Sample, Bass A laeuft weiter', () => {
  const v = lauf({ name: 'hand', hand: HANDGRIFF });
  const ab = v.ereignisse.filter((e) => e.typ === 'plan_teil_abgebrochen');
  assert.equal(ab.length, 1);
  assert.equal(ab[0].sample, T(19));                    // 0 Samples Verzug
  assert.deepEqual(ab[0].regler, ['A.gain']);           // nur dieser Regler
  nah(ab[0].werte['A.gain'], 0.6);                      // Wert, den der Plan an diesem Sample hatte
  nah(wert(v, T(19) - 1, 'A.gain'), 0.6, 2e-6);         // davor: Planrampe
  assert.ok(wert(v, T(21), 'A.gain') > 0.79);           // danach: Hand, nicht Plan (Plan waere 0,4)
  assert.ok(wert(v, T(25), 'A.gain') > 0.79);           // Plan waere 0
  assert.equal(wert(v, T(21) - 1, 'A.bass'), 1);
  assert.equal(wert(v, T(21), 'A.bass'), 0);            // anderer Teil unberuehrt, sample-genau
  assert.equal(v.plan_status, 'teilweise');
  assert.ok(v.max_sprung_gain.d <= 0.020001);           // kein Sprung beim Uebernehmen (nur Handschritte)
});

test('Vergleich naiv: Blockraster verschiebt Bass-aus und Handgriff um bis zu einen Block', () => {
  const v = lauf({ name: 'block', hand: HANDGRIFF, optionen: { quantisierung: 'block' } });
  const bass = v.stufen.find((s) => s.regler === 'A.bass');
  assert.equal(bass.sample, 1800192);                   // 192 Samples = 4,0 ms zu spaet
  const ab = v.ereignisse.find((e) => e.typ === 'plan_teil_abgebrochen');
  assert.equal(ab.sample, 1620224);                     // 224 Samples = 4,67 ms zu spaet
});

test('Vergleich naiv: ohne Schiedsrichter ueberschreibt der Plan die Hand', () => {
  const v = lauf({ name: 'kampf', hand: HANDGRIFF, optionen: { schiedsrichter: false } });
  assert.equal(v.ereignisse.filter((e) => e.typ === 'hand').length, 10);   // Hand kam an ...
  nah(wert(v, T(21), 'A.gain'), 0.4);                                      // ... und wirkt nicht
  nah(wert(v, T(25), 'A.gain'), 0.0);
});

test('Vergleich naiv: Hand bricht ganzen Plan ab, Bass A bleibt an', () => {
  const v = lauf({ name: 'ganz', hand: HANDGRIFF, optionen: { abbruch: 'plan' } });
  assert.equal(wert(v, T(21), 'A.bass'), 1);
  assert.equal(v.stufen.filter((s) => s.regler === 'A.bass').length, 0);
});

test('Uebernahme: sprung springt, pickup haengt, relativ und skaliert folgen ohne Sprung', () => {
  const sprung = lauf({ name: 's', hand: HANDGRIFF, optionen: { uebernahme: 'sprung' } });
  nah(sprung.max_sprung_gain.d, 0.21, 1e-5);
  const pickup = lauf({ name: 'p', hand: HANDGRIFF, optionen: { uebernahme: 'pickup' } });
  nah(wert(pickup, T(25), 'A.gain'), 0.6);              // Knopf dreht weg vom Wert, rastet nie ein
  const rel = lauf({ name: 'r', hand: HANDGRIFF_RELATIV, optionen: { uebernahme: 'relativ' } });
  nah(wert(rel, T(25), 'A.gain'), 0.7);
  const sk = lauf({ name: 'k', hand: HANDGRIFF });
  nah(wert(sk, T(25), 'A.gain'), 0.8);                  // (1-w)/(1-p) bleibt 2: bei p=0,9 ist w=0,8
});

test('Tempo 132 ab Takt 18: Bass-aus und Rampenende bleiben auf ihrem Takt', () => {
  const v = lauf({ name: 't', tempo: { sample: T(18), bpm: 132 } });
  assert.equal(wert(v, 1791818, 'A.bass'), 1);
  assert.equal(wert(v, 1791819, 'A.bass'), 0);          // 1.530.000 + 12 * 21818,18 aufgerundet
  const ende = v.ereignisse.find((e) => e.typ === 'plan_teil_fertig' && e.regler === 'A.gain');
  assert.equal(ende.sample, 2140910);                   // 1.530.000 + 28 * 21818,18 aufgerundet
  assert.equal(ende.takt, 25);
});

test('Verriegelung A4: nichts wird ungehoert hoerbar', () => {
  const v = verriegelung();
  assert.equal(v.ohne_hoerschein.antwort.status, 'verriegelt');
  assert.equal(v.ohne_hoerschein.B_gain_bei_takt_25, 0);
  assert.equal(v.mit_hoerschein.antwort.status, 'angenommen');
  assert.equal(v.mit_hoerschein.B_gain_bei_takt_25, 0.8);
  assert.equal(v.hoerschein_bei_126_bpm.antwort.gruende[0].grund, 'hoerschein_anderes_tempo');
  assert.equal(v.hoerschein_falsches_material.antwort.gruende[0].grund, 'hoerschein_anderes_material');
  assert.equal(v.hoerschein_abgelaufen.antwort.gruende[0].grund, 'hoerschein_abgelaufen');
  assert.equal(v.zu_spaet.antwort.gruende[0].grund, 'zu_spaet');
  assert.equal(v.zweitpruefung_tempo_geaendert.antwort.status, 'angenommen');
  assert.equal(v.zweitpruefung_tempo_geaendert.B_gain_bei_takt_25, 0);    // am Start verriegelt
  assert.equal(v.nur_leiser_ohne_hoerschein.antwort.status, 'angenommen'); // Negativ-Kontrolle
  assert.equal(v.sub_doppelt.antwort.gruende[0].grund, 'sub_doppelt');
  assert.equal(v.basstausch_sauber.antwort.status, 'angenommen');
});

test('Kopplung: Hand an Bass A nimmt den gekoppelten Bass-B-Einsatz mit, Hand an Gain A nicht', () => {
  const b = gruppe('A.bass');
  assert.equal(b.bei_takt_22['B.bass'], 0);             // kein Sub doppelt
  assert.deepEqual(b.abgebrochen[0].regler, ['A.bass', 'B.bass']);
  const g = gruppe('A.gain');
  assert.equal(g.bei_takt_22['B.bass'], 1);             // Basstausch lief
  assert.equal(g.bei_takt_22['A.bass'], 0);
});

test('Gleichzeitig: Hand und Planschritt am selben Sample, die Hand gewinnt', () => {
  const v = lauf({ name: 'gleich', hand: [{ sample: T(21), regler: 'A.bass', art: 'bewegung', wert: 0.99 }] });
  const ab = v.ereignisse.find((e) => e.typ === 'plan_teil_abgebrochen' && e.regler.includes('A.bass'));
  assert.ok(ab, 'Bass-Teil muss abgebrochen sein');
  assert.equal(ab.sample, T(21));
  nah(wert(v, T(21), 'A.bass'), 0.99);                  // Hand, nicht Plan (Plan waere 0)
  nah(wert(v, T(25), 'A.gain'), 0.0);                   // Gain-Rampe unberuehrt
  assert.equal(v.plan_status, 'teilweise');
});

import { neuesStellwerk, laufeBis, PLAN } from './szenario.mjs';
const HS1 = (over = {}) => ({ H12: { id: 'H12', deck: 'B', material: 'ki-song-7', bpm: 128, sync_fehler_ms: 0.4, gueltig_bis_schlag: 160, ...over } });
const EIN_B = { id: 'pB', hoerschein: 'H12', teile: [{ regler: 'B.gain', art: 'rampe', ab: { takt: 17 }, dauer: { takte: 8 }, nach: 0.8 }] };
const grund = (sw, plan) => sw.einreichen(plan).gruende?.map((g) => g.grund) ?? [];

test('Verriegelung: die uebrigen Gruende treffen einzeln', () => {
  let sw = neuesStellwerk({}, { hoerscheine: HS1({ sync_fehler_ms: 3.5 }) }); laufeBis(sw, T(9));
  assert.deepEqual(grund(sw, EIN_B), ['hoerschein_nicht_sync']);
  sw = neuesStellwerk({}, { hoerscheine: HS1({ deck: 'A' }) }); laufeBis(sw, T(9));
  assert.deepEqual(grund(sw, EIN_B), ['hoerschein_anderes_deck']);
  sw = neuesStellwerk(); laufeBis(sw, T(9));
  assert.deepEqual(grund(sw, { id: 'pX', teile: [{ regler: 'C.gain', art: 'setze', ab: { takt: 17 }, nach: 0.5 }] }), ['unbekannter_regler']);
  sw = neuesStellwerk(); laufeBis(sw, T(9));
  assert.equal(sw.einreichen(PLAN).status, 'angenommen');
  assert.deepEqual(grund(sw, { id: 'p2', teile: [{ regler: 'A.gain', art: 'rampe', ab: { takt: 20 }, dauer: { takte: 4 }, nach: 0.5 }] }), ['regler_verplant']);
  sw = neuesStellwerk(); laufeBis(sw, T(9));
  sw.hand({ sample: T(9) + 5000, regler: 'A.gain', art: 'bewegung', wert: 0.81 });
  laufeBis(sw, T(10));
  assert.deepEqual(grund(sw, PLAN), ['regler_beim_menschen']);
  // Negativ-Kontrolle: derselbe Plan ohne Hand wird angenommen
  sw = neuesStellwerk(); laufeBis(sw, T(10));
  assert.equal(sw.einreichen(PLAN).status, 'angenommen');
});

test('Rampe startet am Ist-Wert, nicht am Planwert (kein Sprung), und meldet die Abweichung', () => {
  const sw = neuesStellwerk(); laufeBis(sw, T(9));
  sw.einreichen({ id: 'pv', teile: [{ regler: 'A.gain', art: 'rampe', ab: { takt: 17 }, dauer: { takte: 8 }, von: 0.5, nach: 0 }] });
  laufeBis(sw, T(18));
  const e = sw.ereignisse.find((x) => x.typ === 'startwert_angepasst');
  assert.ok(e, 'Abweichung muss gemeldet werden');
  assert.equal(e.plan_von, 0.5); nah(e.ist, 0.8);
  assert.ok(sw.maxSprung['A.gain'].d < 2e-6);          // kein Sprung auf 0,5
  const t17 = sw.ereignisse.find((x) => x.typ === 'takt' && x.takt === 17);
  nah(t17.regler['A.gain'].wert, 0.8);
});
