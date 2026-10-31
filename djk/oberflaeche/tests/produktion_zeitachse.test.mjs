// PRODUCTION V1: Zeitachse (reine Funktionen). Rot → grün → Mutation: pruef/mutiere.mjs, Befehle im Plan d1-v1-seite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RASTER, rasterBeats, neueAnsicht, beatZuX, xZuBeat, rasten, zoomUm, scrolle, linealStufen, positionText, linealText,
  linien, kopfImLoop, folgeSeite, PX_PRO_BEAT_MAX, PX_PRO_BEAT_MIN } from '../oeffentlich/produktion/zeitachse.js';

test('V1 Zeitachse: Beat ↔ Pixel hin und zurück', () => {
  const a = { beat0: 8, pxProBeat: 20 };
  assert.equal(beatZuX(a, 8), 0);
  assert.equal(beatZuX(a, 12), 80);
  assert.equal(xZuBeat(a, 80), 12);
  assert.deepEqual(neueAnsicht(), { beat0: 0, pxProBeat: 24 });
});

test('V1 Zeitachse: Raster-Werte und Rasten (OFF lässt den Beat stehen)', () => {
  assert.deepEqual(RASTER.map((r) => r.text), ['1/16', '1/8', '1/4', 'BAR', 'OFF']);
  assert.equal(rasterBeats('takt'), 4);
  assert.equal(rasterBeats('unbekannt'), 1, 'unbekannter Wert: Vorgabe 1/4');
  assert.equal(rasten(4.3, 1), 4);
  assert.equal(rasten(4.6, 1), 5);
  assert.equal(rasten(5.9, 4), 4);
  assert.equal(rasten(6.1, 4), 8);
  assert.equal(rasten(1.13, 0.25), 1.25);
  // Negativ-Kontrolle: Raster aus und ein Beat, der schon auf dem Raster liegt, bleiben unverändert
  assert.equal(rasten(4.37, 0), 4.37);
  assert.equal(rasten(12, 4), 12);
});

test('V1 Zeitachse: Zoom um den Mauszeiger lässt den Beat unter dem Zeiger stehen', () => {
  const a = { beat0: 16, pxProBeat: 20 };
  for (const [f, x] of [[2, 300], [0.5, 300], [1.25, 7], [3, 999]]) {
    const b = zoomUm(a, f, x);
    assert.ok(Math.abs(xZuBeat(b, x) - xZuBeat(a, x)) < 1e-9, `Faktor ${f} an x ${x}`);
    assert.equal(b.pxProBeat, 20 * f);
  }
  // an der linken Kante: beat0 fiele unter 0 → 0, der Beat unter dem Zeiger darf dann wandern
  const z = zoomUm({ beat0: 0, pxProBeat: 20 }, 0.5, 400);
  assert.equal(z.beat0, 0);
  assert.equal(zoomUm(a, 1e6, 0).pxProBeat, PX_PRO_BEAT_MAX);
  assert.equal(zoomUm(a, 1e-6, 0).pxProBeat, PX_PRO_BEAT_MIN);
});

test('V1 Zeitachse: Scrollen nie vor Beat 0', () => {
  assert.equal(scrolle({ beat0: 4, pxProBeat: 10 }, 40).beat0, 8);
  assert.equal(scrolle({ beat0: 4, pxProBeat: 10 }, -400).beat0, 0);
});

test('V1 Zeitachse: Lineal-Stufen, Positionstext, Linien', () => {
  assert.deepEqual(linealStufen(24), { haupt: 4, neben: 0.5 });
  assert.deepEqual(linealStufen(2), { haupt: 32, neben: 4 });
  assert.deepEqual(linealStufen(400), { haupt: 0.25, neben: 0.25 });
  assert.equal(positionText(0), '1.1.1');
  assert.equal(positionText(5.25), '2.2.2');
  assert.equal(positionText(31.75), '8.4.4');
  assert.equal(linealText(32, 4), '9');
  assert.equal(linealText(5, 1), '2.2');
  const l = linien({ beat0: 0, pxProBeat: 24 }, 200);
  assert.equal(l[0].beat, 0);
  assert.ok(l.every((x) => x.x >= 0 && x.x <= 200));
  assert.deepEqual(l.filter((x) => x.haupt).map((x) => x.text), ['1', '2', '3'], '200 px bei 24 px/Beat: Beat 0, 4, 8');
  assert.ok(l.filter((x) => x.takt).every((x) => x.beat % 4 === 0));
  const versetzt = linien({ beat0: 3.9, pxProBeat: 24 }, 100);
  assert.ok(versetzt[0].beat >= 3.9, 'keine Linie links vom Rand');
});

test('V1 Zeitachse: Kopf in der Loop-Klammer gefaltet, aber nur wenn das letzte projekt_beat unter bis lag (Spec 2.2)', () => {
  const loop = { an: true, von_beat: 0, bis_beat: 32 };
  assert.equal(kopfImLoop(33.5, loop, 31.9), 1.5);
  assert.equal(kopfImLoop(31.9, loop, 31), 31.9);
  assert.equal(kopfImLoop(65, loop, 30), 1);
  assert.equal(kopfImLoop(-2, { an: true, von_beat: 4, bis_beat: 8 }, 0), -2, 'vor von: nicht falten');
  // Start hinter bis: der Kern springt „beim Erreichen von bis“, hier erreicht er es nie, also läuft er ungefaltet weiter
  assert.equal(kopfImLoop(40.5, loop, 40), 40.5, 'letzte Meldung hinter bis: nicht falten');
  assert.equal(kopfImLoop(40.5, loop, 32), 40.5, 'letzte Meldung genau auf bis: der Kern ist schon darüber');
  // noch keine Meldung: nichts erfinden, nicht falten
  assert.equal(kopfImLoop(33.5, loop, null), 33.5);
  assert.equal(kopfImLoop(33.5, loop, undefined), 33.5);
  // Negativ-Kontrolle: Loop aus oder fehlend
  assert.equal(kopfImLoop(33.5, { ...loop, an: false }, 31), 33.5);
  assert.equal(kopfImLoop(33.5, null, 31), 33.5);
});

test('V1 Zeitachse: FOLLOW blättert erst ab 90 % oder außerhalb', () => {
  const a = { beat0: 0, pxProBeat: 10 };   // 100 Beats sichtbar bei 1000 px
  assert.equal(folgeSeite(a, 50, 1000), null);
  assert.equal(folgeSeite(a, 95, 1000), 85);
  assert.equal(folgeSeite({ beat0: 40, pxProBeat: 10 }, 10, 1000), 0);
});

// Andreas 2026-10-30: „ich kann in der ansicht nicht vorscrollen“ (nur Rad, keine sichtbare Leiste). Leiste unter dem Arrangement.
test('Scrollleiste: Inhalt reicht über das Projektende hinaus, Lage folgt beat0, zurück ohne Verlust', async () => {
  const { projektEnde, leiste, ausLeiste } = await import('../oeffentlich/produktion/zeitachse.js');
  const p = { spuren: [{ clips: [{ start_beat: 0, laenge_beats: 32 }, { start_beat: 352, laenge_beats: 32 }] }, { clips: [] }] };
  assert.equal(projektEnde(p), 384);
  assert.equal(projektEnde(null), 0);
  const a = { beat0: 100, pxProBeat: 4 };
  const l = leiste(a, 384, 800);
  assert.ok(l.inhaltPx >= 384 * 4 + 800, `Inhalt ${l.inhaltPx}: das Ende muss an den linken Rand scrollbar sein`);
  assert.equal(l.links, 400);
  assert.deepEqual(ausLeiste(a, 1000), { beat0: 250, pxProBeat: 4 });
  assert.equal(ausLeiste(a, -5).beat0, 0, 'nie vor Beat 0');
  // ein leeres Projekt und eine Ansicht hinter dem Ende: die Leiste klemmt die Ansicht nicht zurück
  assert.ok(leiste({ beat0: 500, pxProBeat: 4 }, 0, 800).inhaltPx >= 500 * 4 + 800);
});
