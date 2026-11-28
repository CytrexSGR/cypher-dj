// Pins the split of server.ts (plan 2026-11-15-backlog-tech-release, tasks 9 and 10): the names the file exports, the methods of
// Oberflaeche and the route table (in order: the first match wins) are the ones of main 28e059c68, before any move. The route table now lives in support/routen_golden.json.
// The three arrays were taken from that main: exports with grep -oE on the file, methods with grep -oE on the class, routes from a test instance
// (routen().map(r => r.methode + ' ' + r.pfad), also in ~/messungen/2026-11-17-zettel/schnitt/routen-vorher.json).
// Routes added after the split (GET /proj/steckfeld, the /controller/ group) are inserted at the place where the table registers them; none was removed or moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../server.ts';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { pinText } from './support/pins.mjs';

belegeTestInstanz();

// Methods added after the split (fix-server: audit C00 and card t_7f487235); pinned the same way
const METHODEN_NEU = ['analysePegelAus', 'warteBisAb', 'ladeNeustartStand', 'merkeNeustartStand', 'uebernehmeNeustartStand', 'sichereNeustartStand', 'neustartStandDatei', 'planNachholen', 'planFuerPlatte',
  'boxFxSchnappschuss', 'planWartetFuehren', 'sichereNeustartStandSofort',
  'projektWiederOeffnen', 'offenesProjektDatei', 'leseOffenesProjektDatei', 'merkeOffenesProjekt'];   // card t_4dc80720
const EXPORTE = ['hauptCheckout', 'pythonVorgabe', 'INS_GR_FRIST_MS', 'leseBestand', 'istOffenesDeck', 'Oberflaeche'];   // values; the interfaces and the type are erased
const METHODEN = [
  'abVon',
  'aktiveLoopsDatei',
  'analyseLiveAus',
  'anfrage',
  'anfrageInnen',
  'anschlussAus',
  'bereichKontext',
  'boxFxPlanen',
  'boxFxWieder',
  'constructor',
  'cypherSpurenAbbrechen',
  'datei',
  'deckAb',
  'deckHotcue',
  'deckLoop',
  'deckLoopAusschnitt',
  'deckLoopSichern',
  'deckRaster',
  'deckRasterFix',
  'deckRasterSet',
  'deckScrub',
  'deckSprung',
  'deckStand',
  'deckStartStopp',
  'deckTeil',
  'einsDerFassung',
  'einsZurueck',
  'erzeugerLebt',
  'fassungAus',
  'fragGraphen',
  'fx',
  'fxCypherAuslaufen',
  'fxRiegel',
  'fxRoutingSenden',
  'fxVon',
  'fxZuweisung',
  'graphLaden',
  'graphSetzen',
  'graphWieder',
  'griff',
  'hoerenAus',
  'hoerscheinTakt',
  'hotcueOrdner',
  'hotcuesAus',
  'hotcuesErbeVon',
  'hotcuesWieder',
  'huellenPfad',
  'json',
  'kanalGeoeffnet',
  'katalogEintrag',
  'katalogFehler',
  'kernWeg',
  'klaengeKarte',
  'klaengeSuche',
  'klang',
  'klangSperre',
  'koerper',
  'kollektionSpeicher',
  'ladeAktiveLoops',
  'laden',
  'lage',
  'leseWirtMeldungen',
  'loop',
  'loopAusKatalog',
  'loopKit',
  'loopOrdner',
  'loopRec',
  'loopStartFrame',
  'loopVon',
  'masterTonart',
  'mediathekFehler',
  'mediathekSuche',
  'meldeBereich',
  'merkeGraph',
  'merkeLoop',
  'merkeQuittung',
  'moduleHerkunft',
  'musterOrdner',
  'musterSpeichern',
  'musterTimer',
  'osziAus',
  'planVon',
  'postenTyp',
  'pruefmodusAusKonfig',
  'pumpe',
  'quelle',
  'rasterAus',
  'rasterErbeVon',
  'rasterFassung',
  'rasterGespeichert',
  'rasterOrdner',
  'rasterSenden',
  'rasterWert',
  'rasterWieder',
  'regler',
  'reglerNamen',
  'reihe',
  'routen',
  'routenKopplung',
  'routenOberflaeche',
  'sammlungAnsicht',
  'sammlungRoute',
  'schiebeVorgaben',
  'schleifeBeenden',
  'schleifenHandgriff',
  'schleifenInfo',
  'schleifenSperre',
  'schleifenTakt',
  'schleifenWaechter',
  'schleifeUebernimm',
  'schleifeUeberspringen',
  'sendeDurchlauf',
  'setzeAktivenLoop',
  'setzeGraphenGeladen',
  'setzeKiGestoppt',
  'setzePruefmodus',
  'sichereAktiveLoops',
  'spektrum',
  'spurAbbrechen',
  'spurAbgelehnt',
  'spurAendern',
  'spurenAufraeumen',
  'spurenLaden',
  'spurenSichern',
  'spurListe',
  'spurMuster',
  'spurStart',
  'spurStopp',
  'starte',
  'starteTablet',
  'stoebern',
  'stoebernBaum',
  'stoebernDetail',
  'stoebernFilter',
  'stoebernMuster',
  'stoebernMusterBaum',
  'stoebernQuellen',
  'stoebernTreffer',
  'stoppe',
  'strom',
  'strudel',
  'strudelEins',
  'studioLage',
  'taste',
  'tempo',
  'tonartVon',
  'verteile',
  'vomKern',
  'vorbereiten',
  'vorbereitenStand',
  'vorhoerenAus',
  'warteQuittung',
  'welleAus',
  'wirtBasis',
  'wirtFlugAbwarten',
  'wirtSock',
  'zeitRaster',
  'zieheGeladenNach',
];
const STATISCH = ['deckSchluessel', 'fassungSchluessel', 'filterPruefen', 'loopScharf', 'schutzAus', 'vorrangAn'];   // private static methods
// the router table (method + pattern, first match wins) is pinned once, in support/routen_golden.json (`tabelle`), written by routes_golden.test.mjs
const ROUTEN = JSON.parse(fs.readFileSync(new URL('./support/routen_golden.json', import.meta.url), 'utf8')).tabelle;

test('server.ts exports the same values as before the split', () => {
  assert.deepEqual(Object.keys(S).sort(), [...EXPORTE].sort());
  assert.equal(typeof S.hauptCheckout, 'function');
  assert.equal(typeof S.pythonVorgabe, 'function');
  assert.equal(typeof S.leseBestand, 'function');
  assert.equal(typeof S.istOffenesDeck, 'function');
  assert.equal(S.INS_GR_FRIST_MS, 500);
});

test('Oberflaeche.prototype has every method name of the old class', () => {
  const fehlt = [...METHODEN, ...METHODEN_NEU].filter((m) => typeof S.Oberflaeche.prototype[m] !== 'function');
  assert.deepEqual(fehlt, []);
  assert.deepEqual(STATISCH.filter((m) => typeof S.Oberflaeche[m] !== 'function'), []);
});

test('the route table is unchanged, in order', () => {
  const zahlen = JSON.parse(fs.readFileSync(new URL('../../tests/zaehlstaende.json', import.meta.url), 'utf8'));
  assert.equal(ROUTEN.length, zahlen.routen_tabelle, pinText('route count differs from tests/zaehlstaende.json'));
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const alt = process.env.CYPHERDJ_INSTANZ;
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  try {
    const o = new S.Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('zl-b-'), arbeitsbestand: tmp('zl-a-'),
      mutationen: [], loops: tmp('zl-l-'), kits: tmp('zl-k-'), welleCache: tmp('zl-w-'), musterOrdner: tmp('zl-m-'), hotcueOrdner: tmp('zl-h-'), rasterOrdner: tmp('zl-r-'),
      huellen: path.join(tmp('zl-hu-'), 'huellen'), wirtOrdner: tmp('zl-wi-'), sammlungen: tmp('zl-s-'), musterBibliothek: tmp('zl-mb-'), musterSets: tmp('zl-ms-'), musterStarter: '',
      mediathek: path.join(tmp('zl-me-'), 'x.sqlite'), katalog: path.join(tmp('zl-ka-'), 'x.sqlite'), kernPruefmodus: true,
      geraete: { konfigPfad: path.join(tmp('zl-g-'), 'g.json'), kantenPfad: path.join(tmp('zl-g-'), 'k'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
      lernen: { ordner: path.join(tmp('zl-le-'), 'c'), geraeteKonfig: path.join(tmp('zl-le-'), 'g.json') }, log: () => {} });
    assert.deepEqual(o.routen().map((r) => r.methode + ' ' + r.pfad), ROUTEN, pinText('router table differs from support/routen_golden.json (tabelle)'));
  } finally { if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt; }
});
