// D1 S3, Auftrag 15 (Abnahme A0b: 1 bis 2 Konsolen-Meldungen „409 (Conflict) @/deck/raster?deck=N“). Gemessen (am Stapel der Abnahme, Instanz d,
// Instrument im Handler, ~/messungen/2026-10-15-d1-s3/p15_messung_zusammen.txt): in jedem 409 hatte der Server für das Deck noch KEINEN
// /zustand/deck (z fehlt), die Uhr war da. Die Seite fragt nach /e/geladen (app.js ladeDeckWelle → holeRaster), der Server kennt die Fassung dann
// schon aus /e/geladen (stand.geladen), aber GET /deck/raster ging über deckStand() und verlangte /zustand/deck mit Status ≥ 1 UND die Uhr.
// rasterWert braucht nur das Deck und seine Fassung. Jetzt: geladenes Deck mit Fassung → 200 (auch ohne Uhr, auch vor dem ersten /zustand/deck);
// ein ungeladenes Deck (oder /zustand/deck mit Status 0 für dieselbe Fassung) bleibt 409 kein_kernstand. Server ohne Kern (keine Uhr), kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { baueBestand } from './hilfen/bestand.mjs';
import { schreibeLeerenRing } from './hilfen/ring.mjs';
import { innen } from './hilfen/innen.mjs';
import { K, belegeTestInstanz, serverInstanzSetzen } from './hilfen/instanz.mjs';

belegeTestInstanz();

// Seiten-Server ohne Kern-Attrappe: nie eine Uhr, nie ein /zustand/deck, außer der Test speist es ein
async function ohneKern(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-raster-get-'));
  const d = (n) => { const x = path.join(tmp, n); fs.mkdirSync(x, { recursive: true }); return x; };
  const huellen = path.join(d('h'), 'huellen'); schreibeLeerenRing(huellen);
  serverInstanzSetzen(t);   // I08 Nachzug R2 (m4)
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: baueBestand(d('bestand'), []),
    arbeitsbestand: d('ab'), kernPruefmodus: true, loops: d('loops'), kits: d('kits'), welleCache: d('welle'), musterOrdner: d('muster'), hotcueOrdner: d('hc'),
    rasterOrdner: d('raster'), huellen, wirtOrdner: d('wirt'), mediathek: path.join(tmp, 'keine.sqlite'), katalog: path.join(tmp, 'kein-k.sqlite'),
    proj: { wurzel: d('proj'), arbeitsordner: path.join(tmp, 'arr') }, log: () => {} });
  await o.starte();
  t.after(async () => { await o.stoppe(); fs.rmSync(tmp, { recursive: true, force: true }); });
  return { o, url: `http://127.0.0.1:${47300 + K}` };
}
// connection: close, damit ein zweiter Server auf demselben Port nicht die Keep-alive-Verbindung des vorigen bekommt (UND_ERR_SOCKET other side closed)
const raster = async (url, deck) => {
  const r = await fetch(`${url}/deck/raster?deck=${deck}`, { headers: { connection: 'close' } });
  return { code: r.status, j: await r.json() };
};
const FASSUNG = { material_id: 'f0000000000000a1', basis_bpm: 128, fassung: 1 };

test('Auftrag 15: GET /deck/raster für ein geladenes Deck vor dem ersten /zustand/deck und ohne Uhr 200, ungeladen 409', async (t) => {
  const { o, url } = await ohneKern(t);
  const i = innen(o);
  assert.equal(i.kern.uhr ?? null, null, 'kein Kern: keine Uhr');
  assert.deepEqual([(await raster(url, 1)).code, (await raster(url, 1)).j.fehler], [409, 'kein_kernstand'], 'Negativ-Kontrolle: ungeladenes Deck');
  i.vomKern('/e/geladen', { deck: 1, ...FASSUNG });                    // wie im Wettlauf der Abnahme: /e/geladen da, /zustand/deck noch nicht
  const g = await raster(url, 1);
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.deepEqual(Object.keys(g.j).sort(), ['gespeichert_frames', 'versatz_frames']);
  assert.equal(typeof g.j.versatz_frames, 'number');
  assert.equal((await raster(url, 2)).code, 409, 'das andere Deck bleibt ungeladen');
  // /zustand/deck derselben Fassung mit Status 0: das Deck ist leer → 409; mit Status 1 → 200 (ohne Uhr)
  i.vomKern('/zustand/deck', { deck: 1, status: 0, ...FASSUNG, quell_beat: 0, beats_bis_ende: 0, faktor: 1, vorlauf_ms: 0 });
  assert.equal((await raster(url, 1)).code, 409, 'Status 0 derselben Fassung: leer');
  i.vomKern('/zustand/deck', { deck: 1, status: 1, ...FASSUNG, quell_beat: 0, beats_bis_ende: 64, faktor: 1, vorlauf_ms: 0 });
  assert.equal((await raster(url, 1)).code, 200, '/zustand/deck mit Status 1, keine Uhr');
  // ein neues Laden (andere Fassung) gewinnt gegen einen /zustand/deck, der noch die alte meldet
  i.vomKern('/e/geladen', { deck: 1, material_id: 'f0000000000000b2', basis_bpm: 120, fassung: 2 });
  assert.equal((await raster(url, 1)).code, 200);
  assert.deepEqual([(await raster(url, 9)).code, (await raster(url, 'x')).code], [409, 409], 'Negativ-Kontrolle: kein Deck 1 oder 2');
});

// Fix-Runde S3, R8: stand.geladen wurde nie nachgezogen. Meldet /zustand/deck (bestätigt) ein anderes Material als das letzte /e/geladen, gilt das
// gemeldete; meldet es ein leeres Deck, gilt keins. Ein /zustand/deck, der im Wettlauf noch das VORIGE Material meldet, ändert nichts (Auftrag 15).
test('R8: GET /deck/raster folgt einem Materialwechsel aus /zustand/deck und einem Entladen; der Wettlauf nach /e/geladen bleibt beim neuen Laden', async (t) => {
  const { schreibeRaster, rasterDatei } = await import('../deck_bedienung.ts');
  const { o, url } = await ohneKern(t);
  const i = innen(o);
  const A = FASSUNG, B = { material_id: 'f0000000000000b2', basis_bpm: 120, fassung: 2 }, C = { material_id: 'f0000000000000c3', basis_bpm: 126, fassung: 1 };
  schreibeRaster(rasterDatei(o.opt.rasterOrdner, A), 111); schreibeRaster(rasterDatei(o.opt.rasterOrdner, B), 222); schreibeRaster(rasterDatei(o.opt.rasterOrdner, C), 333);
  const zd = (f, status) => i.vomKern('/zustand/deck', { deck: 1, status, ...f, quell_beat: 0, beats_bis_ende: 64, faktor: 1, vorlauf_ms: 0 });
  const v = async () => { const r = await raster(url, 1); return r.code === 200 ? r.j.gespeichert_frames : r.code; };
  i.vomKern('/e/geladen', { deck: 1, ...A });
  assert.equal(await v(), 111, 'Positiv-Kontrolle: die gespeicherten Versätze unterscheiden die Fassungen');
  zd(A, 1);
  assert.equal(await v(), 111);
  zd(B, 1);                                                             // das Deck spielt jetzt B, ein /e/geladen B kam nicht an
  assert.equal(await v(), 222, 'die Route folgt dem gemeldeten Material, nicht dem alten /e/geladen');
  assert.equal(o.stand.geladen['1'].material_id, B.material_id, 'stand.geladen nachgezogen (Neustart sendet Hotcues und Raster für B)');
  zd({ material_id: '', basis_bpm: 0, fassung: 0 }, 0);                 // entladen
  assert.equal(await v(), 409, 'leeres Deck: 409');
  assert.equal(o.stand.geladen['1'], undefined, 'entladen: stand.geladen leer');
  // Negativ-Kontrolle Wettlauf (Auftrag 15): /e/geladen C, /zustand/deck meldet noch das vorige (leer) und dann B nicht: C bleibt bis zur Bestätigung
  zd(B, 1);
  i.vomKern('/e/geladen', { deck: 1, ...C });
  zd(B, 1);                                                             // noch das vorige Material
  assert.equal(await v(), 333, 'Wettlauf: das neue Laden gilt, solange /zustand/deck das vorige meldet');
  zd(C, 1);
  assert.equal(await v(), 333);
});
