// Ohr T4: Messung aus dem Hüllkurven-Ring (reine Funktionen). Ring-Datei im Layout aus Task 1 (SCHNITTSTELLEN §6.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BAENDER, K, OhrLeser, miss, ueberdeckung, vergleiche, hoerAntwort, anschlagPhase, sync, urteile } from '../ohr.ts';
import { schreibeRing } from './hilfen/ring.mjs';

function tmpPfad(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ohr-test-')), name);
}

function satz(sample, beat, band, k = 1e-6, spitze = 0, quell = NaN) {
  return { sample, beat, quell, band, k, spitze };
}

test('OhrLeser: liest neue Sätze inkrementell, 0 ohne Neues, 0 bei ungültigem Kopf oder fehlender Datei', () => {
  const pfad = tmpPfad('huellen');
  const n1 = 2000;
  const daten0 = Array.from({ length: n1 }, (_, i) => satz(i * 48, i * 48 / 22500, [0.1, 0, 0, 0, 0, 0]));
  schreibeRing(pfad, { [K.deck1]: daten0 });
  const leser = new OhrLeser(pfad, [K.deck1]);
  assert.equal(leser.lies(), n1);
  assert.equal(leser.lies(), 0);  // zweites Mal ohne neue Sätze
  const daten1 = Array.from({ length: 100 }, (_, i) => satz((n1 + i) * 48, (n1 + i) * 48 / 22500, [0.1, 0, 0, 0, 0, 0]));
  schreibeRing(pfad, { [K.deck1]: daten1 }, { rAb: n1, neu: false });
  assert.equal(leser.lies(), 100);

  // Ungültiger Kopf (Magic XXXX)
  const pfadUngueltig = tmpPfad('huellen_ungueltig');
  schreibeRing(pfadUngueltig, { [K.deck1]: daten0 });
  const fd = fs.openSync(pfadUngueltig, 'r+');
  fs.writeSync(fd, Buffer.from('XXXX'), 0, 4, 0);
  fs.closeSync(fd);
  const leserUngueltig = new OhrLeser(pfadUngueltig, [K.deck1]);
  assert.equal(leserUngueltig.lies(), 0);

  // Fehlende Datei
  const leserFehlt = new OhrLeser(tmpPfad('gibt_es_nicht'), [K.deck1]);
  assert.equal(leserFehlt.lies(), 0);
});

test('miss: Band 0 konstant 0,1 -> baender_db[0] ~ -20; k konstant 1e-2 -> lufs ~ -20,691', () => {
  const saetze = Array.from({ length: 50 }, (_, i) => satz(i * 48, i, [0.1, 0, 0, 0, 0, 0], 1e-2, 0));
  const m = miss(saetze);
  assert.ok(Math.abs(m.baender_db[0] - -20) < 1e-6, `baender_db[0] = ${m.baender_db[0]}`);
  assert.ok(Math.abs(m.lufs - -20.691) < 1e-3, `lufs = ${m.lufs}`);
});

test('ueberdeckung: Dossier 08:206 Soll-Werte (identisch 1,0; -20dB 0,0392; still 0; abwechselnd 0)', () => {
  const T = 16;  // 16 Sechzehntel, ein Satz je Sechzehntel (beat = t/4)
  const a = Array.from({ length: T }, (_, t) => satz(t * 12, t / 4, [0.2, 0, 0, 0, 0, 0]));

  // identisch
  const bIdent = Array.from({ length: T }, (_, t) => satz(t * 12, t / 4, [0.2, 0, 0, 0, 0, 0]));
  assert.ok(Math.abs(ueberdeckung(a, bIdent).sub - 1.0) < 1e-9);

  // Dossier: a,b = Bandleistung (mittel(band²)); "b = a·0.01" heißt Leistungsverhältnis g=0.01, amplitude = a·sqrt(0.01)
  const bLeise = Array.from({ length: T }, (_, t) => satz(t * 12, t / 4, [0.2 * Math.sqrt(0.01), 0, 0, 0, 0, 0]));
  assert.ok(Math.abs(ueberdeckung(a, bLeise).sub - 0.0392) < 1e-4, `${ueberdeckung(a, bLeise).sub}`);

  // b still
  const bStill = Array.from({ length: T }, (_, t) => satz(t * 12, t / 4, [0, 0, 0, 0, 0, 0]));
  assert.equal(ueberdeckung(a, bStill).sub, 0);

  // abwechselnd: a nur in geraden Sechzehnteln, b nur in ungeraden
  const aAbw = Array.from({ length: T / 2 }, (_, i) => satz(i * 24, (2 * i) / 4, [0.2, 0, 0, 0, 0, 0]));
  const bAbw = Array.from({ length: T / 2 }, (_, i) => satz(i * 24 + 12, (2 * i + 1) / 4, [0.2, 0, 0, 0, 0, 0]));
  assert.equal(ueberdeckung(aAbw, bAbw).sub, 0);
});

test('vergleiche: EQ-Vorschlag aus der Abweichung vom Median (nicht LUFS-normiert)', () => {
  const T = 32;
  // neu: Tief-Bereich (sub+tief) +6 dB gegenüber laufend, sonst gleiche Neigung und gleiche Lautheit
  const g6 = Math.pow(10, 6 / 20);  // amplitude für +6 dB Leistung? Leistung +6dB -> amplitude * sqrt(2^... )
  // +6 dB Leistung: p2 = p1 * 10^(6/10); amplitude-Faktor = sqrt(10^0.6)
  const fLeistung6 = Math.sqrt(Math.pow(10, 0.6));
  const laufend = Array.from({ length: T }, (_, t) => satz(t * 48, t / 4, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], 6e-2, 0.3));
  const neu = Array.from({ length: T }, (_, t) =>
    satz(t * 48, t / 4, [0.1 * fLeistung6, 0.1 * fLeistung6, 0.1, 0.1, 0.1, 0.1], 6e-2, 0.3));
  const v = vergleiche(neu, laufend);
  assert.ok(Math.abs(v.eq_vorschlag.tief - -6) < 0.6, `tief=${v.eq_vorschlag.tief}`);
  assert.equal(v.eq_vorschlag.mitte, 0);
  assert.equal(v.eq_vorschlag.hoch, 0);

  // Negativ-Kontrolle: neu insgesamt 6 dB lauter (alle Bänder gleich angehoben), gleiche Neigung
  const neuLauter = Array.from({ length: T }, (_, t) =>
    satz(t * 48, t / 4, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1].map((x) => x * fLeistung6), 6e-2 * Math.pow(10, 0.6), 0.3));
  const v2 = vergleiche(neuLauter, laufend);
  assert.equal(v2.eq_vorschlag.tief, 0);
  assert.equal(v2.eq_vorschlag.mitte, 0);
  assert.equal(v2.eq_vorschlag.hoch, 0);
  assert.ok(Math.abs(v2.pegel_diff_db - 6) < 0.5, `pegel_diff_db=${v2.pegel_diff_db}`);
});

test('vergleiche: Summenspitze je Fenster (nicht Maximum plus Maximum)', () => {
  const T = 20;
  const neu = Array.from({ length: T }, (_, t) => satz(t * 48, t / 4, [0, 0, 0, 0, 0, 0], 1e-6, 0.6));
  const laufend = Array.from({ length: T }, (_, t) => satz(t * 48, t / 4, [0, 0, 0, 0, 0, 0], 1e-6, 0.6));
  const v = vergleiche(neu, laufend);
  assert.equal(v.summe.clip_anteil, 1);
  assert.ok(Math.abs(v.summe.spitze_obergrenze_db - 1.58) < 0.05, `${v.summe.spitze_obergrenze_db}`);

  // laufend 0,6 nur in geraden Fenstern, neu 0,6 nur in ungeraden: Maximum+Maximum hätte fälschlich geclippt
  const neu2 = Array.from({ length: T }, (_, t) => satz(t * 48, t / 4, [0, 0, 0, 0, 0, 0], 1e-6, t % 2 === 1 ? 0.6 : 0));
  const laufend2 = Array.from({ length: T }, (_, t) => satz(t * 48, t / 4, [0, 0, 0, 0, 0, 0], 1e-6, t % 2 === 0 ? 0.6 : 0));
  const v2 = vergleiche(neu2, laufend2);
  assert.equal(v2.summe.clip_anteil, 0);
});

test('hoerAntwort: 4 Takte volle Sätze -> 200 mit 6 Bändern; 2 Takte -> 409 zu_wenig_gehoert; ungeladen -> 409 kein_kernstand', () => {
  const bpm = 128, uhrBeat = 64, takte = 4;
  const erwartet = ((4 * takte * 60) / bpm) * 1000;  // 7500
  assert.ok(Math.abs(erwartet - 7500) < 1e-9);

  // voller Fall: erwartet Sätze über das ganze Fenster [48, 64)
  const pfadVoll = tmpPfad('huellen_voll');
  const nVoll = erwartet;
  const daten = (offset) =>
    Array.from({ length: nVoll }, (_, i) => satz(i * 48, 48 + (i / nVoll) * 16, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], 1e-3, 0.2 + offset));
  schreibeRing(pfadVoll, { [K.deck1]: daten(0), [K.master]: daten(0) });
  const lVoll = new OhrLeser(pfadVoll, [K.deck1, K.master]);
  lVoll.lies();
  const rVoll = hoerAntwort(lVoll, { deck: 1, geladen: true, laeuft: true, offen: false }, uhrBeat, bpm, takte);
  assert.equal(rVoll.code, 200);
  if (rVoll.code === 200) assert.equal(rVoll.j.vergleich.neu.baender_db.length, 6);

  // nur 2 Takte Sätze im Fenster (Rest fehlt) -> 409 zu_wenig_gehoert
  const pfadWenig = tmpPfad('huellen_wenig');
  const nWenig = Math.round(erwartet / 2);
  const datenWenig = Array.from({ length: nWenig }, (_, i) => satz(i * 48, 56 + (i / nWenig) * 8, [0.1, 0, 0, 0, 0, 0], 1e-3, 0.2));
  schreibeRing(pfadWenig, { [K.deck1]: datenWenig, [K.master]: datenWenig });
  const lWenig = new OhrLeser(pfadWenig, [K.deck1, K.master]);
  lWenig.lies();
  const rWenig = hoerAntwort(lWenig, { deck: 1, geladen: true, laeuft: true, offen: false }, uhrBeat, bpm, takte);
  assert.equal(rWenig.code, 409);
  if (rWenig.code === 409) {
    assert.equal(rWenig.j.fehler, 'zu_wenig_gehoert');
    assert.ok(Math.abs((rWenig.j.erwartet ?? 0) - 7500) < 1e-6);
  }

  // ungeladen -> 409 kein_kernstand
  const rUngeladen = hoerAntwort(lVoll, { deck: 1, geladen: false, laeuft: false, offen: false }, uhrBeat, bpm, takte);
  assert.equal(rUngeladen.code, 409);
  if (rUngeladen.code === 409) assert.equal(rUngeladen.j.fehler, 'kein_kernstand');
});

// Ohr T7: Anschlag-Phase (log-Fluss über sechs Bänder ohne Glättung, Viertelfenster um den Schlag). Synthetisch,
// 128 BPM, 16 Schläge. `beatMs` = Millisekunden je Beat; 1-ms-Satzraster (entspricht 48 Samples bei 48 kHz).
function bandWert(tMs, beatMs, beats, offsetMs, decayMs, amplitude = 0.3, baseline = 1e-4) {
  const nRoh = Math.floor((tMs - offsetMs) / beatMs);
  const n = Math.min(Math.max(nRoh, 0), beats - 1);
  const sprungT = n * beatMs + offsetMs;
  if (tMs < sprungT) return baseline;
  const dt = tMs - sprungT;
  return baseline + amplitude * Math.exp(-dt / decayMs);
}

// erzeugt ein durchgehendes 1-ms-Satzraster; `bandAktiv` wählt, welche der 6 Bänder den Sprung tragen (Rest bleibt
// auf `baseline`); `zusatz(tMs)` liefert optional pro Zeitpunkt einen Zusatzwert je Band (rollender Bass, Test 4).
function genSaetze({ bpm = 128, beats = 16, offsetMs = 5, decayMs = 20, bandAktiv = [0, 1, 2, 3, 4, 5],
  amplitude = 0.3, baseline = 1e-4, puffer = 100, zusatz = null }) {
  const beatMs = 60000 / bpm;
  const saetze = [];
  for (let tMs = -puffer; tMs <= beats * beatMs + puffer; tMs += 1) {
    const band = new Array(6).fill(baseline);
    for (const b of bandAktiv) band[b] = bandWert(tMs, beatMs, beats, offsetMs, decayMs, amplitude, baseline);
    if (zusatz) {
      const extra = zusatz(tMs, beatMs);
      if (extra) for (const b of [0, 1]) band[b] += extra;
    }
    saetze.push(satz(Math.round(tMs * 48), tMs / beatMs, band));
  }
  return saetze;
}

test('anschlagPhase: Sprung in allen Bändern genau 5 ms nach jedem Schlag -> 5 ± 1 ms, n = 16', () => {
  const s = genSaetze({ offsetMs: 5, decayMs: 20 });
  const r = anschlagPhase(s, 128);
  assert.ok(Math.abs(r.anschlag_ms - 5) < 1, `anschlag_ms=${r.anschlag_ms}`);
  assert.equal(r.n, 16);
});

test('anschlagPhase: Sprung 3 ms VOR dem Schlag -> -3 ± 1 ms', () => {
  const s = genSaetze({ offsetMs: -3, decayMs: 20 });
  const r = anschlagPhase(s, 128);
  assert.ok(Math.abs(r.anschlag_ms - -3) < 1, `anschlag_ms=${r.anschlag_ms}`);
});

test('sync: gleiche Anstiegszeit, unterschiedliches Abklingen -> |deck_gegen_deck_ms| <= 1', () => {
  const partner = genSaetze({ offsetMs: 0, decayMs: 30, bandAktiv: [0, 1] });
  const neu = genSaetze({ offsetMs: 0, decayMs: 200, bandAktiv: [0, 1] });
  const r = sync(neu, partner, 128);
  assert.ok(Math.abs(r.deck_gegen_deck_ms) <= 1, `deck_gegen_deck_ms=${r.deck_gegen_deck_ms}`);
});

test('anschlagPhase: rollender Bass auf Phase 0,25/0,5/0,75 ändert das Ergebnis um höchstens 0,5 ms', () => {
  const basis = genSaetze({ offsetMs: 5, decayMs: 20 });
  const rBasis = anschlagPhase(basis, 128);
  const zusatz = (tMs, beatMs) => {
    const phase = (tMs / beatMs) - Math.floor(tMs / beatMs);
    for (const p of [0.25, 0.5, 0.75]) {
      const dphi = Math.abs(phase - p);
      if (dphi < 0.02) return 0.05 * (1 - dphi / 0.02);
    }
    return 0;
  };
  const mit = genSaetze({ offsetMs: 5, decayMs: 20, zusatz });
  const rMit = anschlagPhase(mit, 128);
  assert.ok(Math.abs(rMit.anschlag_ms - rBasis.anschlag_ms) <= 0.5,
    `basis=${rBasis.anschlag_ms} mit_rollbass=${rMit.anschlag_ms}`);
});

test('anschlagPhase: Stille -> n=0, anschlag_ms NaN', () => {
  const s = genSaetze({ offsetMs: 5, decayMs: 20, amplitude: 0 });
  const r = anschlagPhase(s, 128);
  assert.equal(r.n, 0);
  assert.ok(Number.isNaN(r.anschlag_ms), `anschlag_ms=${r.anschlag_ms}`);
});

// Ohr T9: Urteil (reine Funktion). Baseline-Vergleich: neutral (pegel_diff_db 0, kein Clip, kein Basstausch).
function vergleichFest(over = {}) {
  return {
    neu: { baender_db: [-20, -20, -20, -20, -20, -20], lufs: -20, spitze_db: -10 },
    laufend: { baender_db: [-20, -20, -20, -20, -20, -20], lufs: -20, spitze_db: -10 },
    pegel_diff_db: 0,
    ueberdeckung: { sub: 0.1, tief: 0.1, tiefmitte: 0.1, mitte: 0.1, praesenz: 0.1, hoch: 0.1 },
    summe: { lufs_schaetzung: -17, spitze_obergrenze_db: -6, clip_anteil: 0 },
    laufend_baender_db: [-20, -20, -20, -20, -20, -20],
    eq_vorschlag: { tief: 0, mitte: 0, hoch: 0 },
    bass_tausch: false,
    ...over,
  };
}
const syncFest = (over = {}) => ({ sync_ms: NaN, deck_gegen_deck_ms: NaN, n: 10, ...over });

test('urteile: takte_am_stueck < 4 -> unsicher (zu_kurz), trumpft alles andere', () => {
  const r = urteile(vergleichFest(), syncFest(), 2);
  assert.equal(r.urteil, 'unsicher');
  assert.ok(r.gruende.includes('zu_kurz'), JSON.stringify(r.gruende));
});

test('urteile: summe.clip_anteil > 0,01 -> zu_laut (summe_clippt)', () => {
  const r = urteile(vergleichFest({ summe: { lufs_schaetzung: -10, spitze_obergrenze_db: 2, clip_anteil: 0.02 } }), syncFest(), 4);
  assert.equal(r.urteil, 'zu_laut');
  assert.ok(r.gruende.includes('summe_clippt'), JSON.stringify(r.gruende));
});

test('urteile: pegel_diff_db > 3 -> zu_laut', () => {
  const r = urteile(vergleichFest({ pegel_diff_db: 5 }), syncFest(), 4);
  assert.equal(r.urteil, 'zu_laut');
  assert.ok(r.gruende.includes('zu_laut'), JSON.stringify(r.gruende));
});

test('urteile: pegel_diff_db < -3 -> zu_leise', () => {
  const r = urteile(vergleichFest({ pegel_diff_db: -5 }), syncFest(), 4);
  assert.equal(r.urteil, 'zu_leise');
  assert.ok(r.gruende.includes('zu_leise'), JSON.stringify(r.gruende));
});

test('urteile: ok-Fall (nichts trifft), ohne Sync-Grund wenn sync_ms NaN', () => {
  const r = urteile(vergleichFest(), syncFest(), 4);
  assert.equal(r.urteil, 'ok');
  assert.deepEqual(r.gruende, []);
});

test('urteile Rev.4: sync_ms/deck_gegen_deck_ms gehen NICHT ins Urteil (nur Grund sync_unvalidiert, s.n < 8 ist kein unsicher)', () => {
  // großer Sync-Versatz und wenige Anschläge dürften das Urteil (Rev. 4) NICHT kippen, nur als Grund erscheinen
  const r = urteile(vergleichFest(), syncFest({ sync_ms: 42, deck_gegen_deck_ms: 99, n: 1 }), 4);
  assert.equal(r.urteil, 'ok', JSON.stringify(r));
  assert.ok(r.gruende.includes('sync_unvalidiert:42'), JSON.stringify(r.gruende));
});

test('urteile: bass_tausch erscheint als Grund ohne Urteilswirkung', () => {
  const r = urteile(vergleichFest({ bass_tausch: true }), syncFest(), 4);
  assert.equal(r.urteil, 'ok');
  assert.ok(r.gruende.includes('bass_tausch'), JSON.stringify(r.gruende));
});

// ---------- Ohr T10: Hörschein je Takt (Hoerscheinstelle) ----------
function saetzeVoll(vonBeat, bisBeat, bpm, { amp = 0.1, k = 1e-2, spitze = 0.1, quellVon = vonBeat, sprung = null } = {}) {
  const beatMs = 60000 / bpm;
  const n = Math.round((bisBeat - vonBeat) * beatMs);
  const saetze = [];
  for (let i = 0; i <= n; ++i) {
    const beat = vonBeat + i / beatMs;
    let quell = quellVon + (beat - vonBeat);
    if (sprung && beat >= sprung.beiBeat) quell += sprung.delta;
    saetze.push(satz(Math.round(i * 48), beat, [amp, amp, amp, amp, amp, amp], k, spitze, quell));
  }
  return saetze;
}
function saetzeMasterVoll(vonBeat, bisBeat, bpm, { amp = 0.1, spitze = 0.1 } = {}) {
  return saetzeVoll(vonBeat, bisBeat, bpm, { amp, spitze }).map((s) => ({ ...s, quell: NaN }));
}
const INHALT2 = 'deadbeefdeadbeef/128000_r1';

test('Hoerscheinstelle: Ausstellung je Takt (§4.5 Feldreihenfolge), Rücknahme bei Kippen, Sprung bricht ab, gueltig() prüft Inhalt', async () => {
  const { Hoerscheinstelle } = await import('../ohr.ts');
  const hs = new Hoerscheinstelle();
  const decks2 = [
    { deck: 1, laeuft: false, inhalt: '', bpm: 128 },
    { deck: 2, laeuft: true, inhalt: INHALT2, bpm: 128 },
  ];
  const keineOffen = () => false;

  // (a) erster Takt bei Beat 64, Fenster [48,64): ok-Fall -> genau eine /k/hoerschein-Aktion
  const pfadA = tmpPfad('huellen_hs_a');
  schreibeRing(pfadA, { [K.deck2]: saetzeVoll(48, 64, 128, { quellVon: 48 }), [K.master]: saetzeMasterVoll(48, 64, 128) });
  const lA = new OhrLeser(pfadA, [K.deck1, K.deck2, K.master]);
  lA.lies();
  const aktA = hs.takt(lA, 64, 128, decks2, keineOffen);
  assert.equal(aktA.length, 1, JSON.stringify(aktA));
  assert.equal(aktA[0].adresse, '/k/hoerschein');
  assert.ok(String(aktA[0].felder.hs_id).startsWith('ohr-2-'), aktA[0].felder.hs_id);
  assert.deepEqual(Object.keys(aktA[0].felder),
    ['hs_id', 'kanal', 'inhalt', 'urteil', 'bpm_messung', 'gueltig_bis_beat', 'quell_von', 'quell_bis', 'sync_ms', 'pegel_diff_db', 'lufs_kurz']);
  assert.equal(aktA[0].felder.urteil, 'ok');
  assert.equal(aktA[0].felder.gueltig_bis_beat, 128);
  assert.equal(hs.letzter(2).urteil, 'ok');

  // (d, positiv) gueltig() mit demselben Inhalt -> der Schein
  assert.ok(hs.gueltig('deck/2', INHALT2, 64), 'gueltig() findet den ok-Schein bei gleichem Inhalt');
  // (d) gueltig() für einen ANDEREN Inhalt -> null
  assert.equal(hs.gueltig('deck/2', 'andereid0000000/128000_r1', 64), null);

  // (b) nächster Takt bei Beat 68, Fenster [52,68): Deck 2 jetzt +6 dB lauter als der Master -> zu_laut -> /k/hoerschein/weg
  const pfadB = tmpPfad('huellen_hs_b');
  const fLeistung6 = Math.sqrt(Math.pow(10, 0.6));
  schreibeRing(pfadB, { [K.deck2]: saetzeVoll(52, 68, 128, { amp: 0.1 * fLeistung6, k: 1e-2 * Math.pow(10, 0.6), quellVon: 52 }), [K.master]: saetzeMasterVoll(52, 68, 128) });
  const lB = new OhrLeser(pfadB, [K.deck1, K.deck2, K.master]);
  lB.lies();
  const aktB = hs.takt(lB, 68, 128, decks2, keineOffen);
  assert.equal(aktB.length, 1, JSON.stringify(aktB));
  assert.equal(aktB[0].adresse, '/k/hoerschein/weg');
  assert.equal(aktB[0].felder.hs_id, aktA[0].felder.hs_id);
  assert.equal(hs.letzter(2).urteil, 'zu_laut');

  // (c) frische Hoerscheinstelle: Sprung im Quell-Beat mitten im Fenster -> unsicher (zu_kurz), keine Aktion
  const hs2 = new Hoerscheinstelle();
  const pfadC = tmpPfad('huellen_hs_c');
  schreibeRing(pfadC, {
    [K.deck2]: saetzeVoll(48, 64, 128, { quellVon: 48, sprung: { beiBeat: 56, delta: 50 } }),
    [K.master]: saetzeMasterVoll(48, 64, 128),
  });
  const lC = new OhrLeser(pfadC, [K.deck1, K.deck2, K.master]);
  lC.lies();
  const aktC = hs2.takt(lC, 64, 128, decks2, keineOffen);
  assert.equal(aktC.length, 0, JSON.stringify(aktC));
  assert.equal(hs2.letzter(2).urteil, 'unsicher');
  assert.ok(hs2.letzter(2).gruende.includes('zu_kurz'), JSON.stringify(hs2.letzter(2).gruende));
});
