// PRODUCTION V1: Lage im Arrangement (reine Funktionen)
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPUR_HOEHE, linealZone, spurIndexBei, clipKasten, sichtbar, quellSpalten, notenKaesten, klammerGriff, zieheKlammer }
  from '../oeffentlich/produktion/layout.js';

const A = { beat0: 4, pxProBeat: 10 };

test('V1 Layout: Spur unter y, Lineal-Zonen', () => {
  assert.equal(SPUR_HOEHE, 64);
  assert.equal(spurIndexBei(0, 3), 0);
  assert.equal(spurIndexBei(130, 3), 2);
  assert.equal(spurIndexBei(200, 3), -1, 'unter der letzten Spur');
  assert.equal(spurIndexBei(-1, 3), -1);
  assert.equal(linealZone(3), 'loop');
  assert.equal(linealZone(20), 'position');
});

test('V1 Layout: Clip-Kasten und Sichtbarkeit', () => {
  const k = clipKasten(A, 1, { start_beat: 8, laenge_beats: 2 });
  assert.deepEqual(k, { x: 40, y: 65, w: 20, h: 62 });
  assert.equal(sichtbar(k, 30), false);
  assert.equal(sichtbar(k, 100), true);
  assert.equal(sichtbar(clipKasten(A, 0, { start_beat: 0, laenge_beats: 2 }), 100), false, 'ganz links außerhalb');
});

test('V1 Layout: Quell-Spalten der Welle (Sekunden unverändert, Offset zählt)', () => {
  // 120 BPM: 1 Beat = 0,5 s; 10 px je Beat: 1 px = 0,05 s = 2400 Frames = 9,375 Spalten bei hop 256
  const [a, b] = quellSpalten({ offset_s: 0 }, 120, 256, 10, 0);
  assert.equal(a, 0);
  assert.equal(b, 9.375);
  const [c] = quellSpalten({ offset_s: 1 }, 120, 256, 10, 0);
  assert.equal(c, 187.5, 'offset 1 s = 48000/256 Spalten');
  const [d] = quellSpalten({ offset_s: 0 }, 60, 256, 10, 10);
  assert.equal(d, 187.5, '60 BPM: Pixel 10 = Beat 1 = 1 s');
});

test('V1 Layout: Notenvorschau (hoch oben, Länge am Clip-Ende gekappt)', () => {
  const clip = { laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 36 }, { beat: 1, laenge: 8, ton: 48 }, { beat: 5, laenge: 1, ton: 40 }] };
  const k = { x: 100, y: 0, w: 40, h: 62 };
  const r = notenKaesten(clip, k, 10);
  assert.equal(r.length, 2, 'Note hinter dem Clip-Ende fällt weg');
  assert.ok(r[1].y < r[0].y, 'Ton 48 liegt über Ton 36');
  assert.equal(r[0].x, 100);
  assert.equal(r[1].w, 30, 'Länge bis Clip-Ende (Beat 4)');
  assert.deepEqual(notenKaesten({ laenge_beats: 4, noten: [] }, k, 10), []);
});

test('V1 Layout: Griff der Loop-Klammer', () => {
  const loop = { an: true, von_beat: 8, bis_beat: 16 };   // x 40 .. 120
  assert.equal(klammerGriff(A, loop, 42), 'von');
  assert.equal(klammerGriff(A, loop, 118), 'bis');
  assert.equal(klammerGriff(A, loop, 80), 'mitte');
  assert.equal(klammerGriff(A, loop, 200), null);
  assert.equal(klammerGriff(A, null, 80), null);
});

test('V1 Layout: Klammer ziehen hält bis − von ≥ 1 und rastet', () => {
  const s = { von_beat: 8, bis_beat: 16 };
  assert.deepEqual(zieheKlammer(s, 'bis', 16, 40.3, 4), { von_beat: 8, bis_beat: 40 });
  assert.deepEqual(zieheKlammer(s, 'bis', 16, -50, 4), { von_beat: 8, bis_beat: 9 }, 'nie kürzer als 1 Beat');
  assert.deepEqual(zieheKlammer(s, 'von', 8, 30, 1), { von_beat: 15, bis_beat: 16 });
  assert.deepEqual(zieheKlammer(s, 'von', 8, -30, 1), { von_beat: 0, bis_beat: 16 });
  assert.deepEqual(zieheKlammer(s, 'mitte', 10, 13.2, 1), { von_beat: 11, bis_beat: 19 });
  assert.deepEqual(zieheKlammer(s, 'neu', 33, 0.4, 4), { von_beat: 0, bis_beat: 32 }, 'rückwärts gezogen');
  assert.deepEqual(zieheKlammer(s, 'neu', 5, 5.1, 4), { von_beat: 4, bis_beat: 8 }, 'Klick ohne Zug: ein Rasterschritt');
  // Negativ-Kontrolle: Raster aus, Zug um 0 lässt die Klammer, wie sie war
  assert.deepEqual(zieheKlammer(s, 'mitte', 10, 10, 0), { von_beat: 8, bis_beat: 16 });
});

// Fix 10: ein Zug endet mit pointerup, pointercancel oder lostpointercapture, genau einmal, und räumt alle Hörer ab
import { zugVerfolgen, ZUG_ENDEN } from '../oeffentlich/produktion/layout.js';
test('V1 Layout: Zug endet bei pointerup, pointercancel und lostpointercapture (einmal, Hörer abgeräumt)', () => {
  assert.deepEqual([...ZUG_ENDEN].sort(), ['lostpointercapture', 'pointercancel', 'pointerup']);
  for (const ende of ZUG_ENDEN) {
    const ziel = new EventTarget(), log = [];
    zugVerfolgen(ziel, () => log.push('bewegt'), () => log.push('ende'));
    ziel.dispatchEvent(new Event('pointermove')); ziel.dispatchEvent(new Event('pointermove'));
    ziel.dispatchEvent(new Event(ende));
    ziel.dispatchEvent(new Event('pointermove'));                                   // nach dem Ende bewegt sich nichts mehr
    for (const n of ZUG_ENDEN) ziel.dispatchEvent(new Event(n));                    // auch kein zweites Ende (pointerup löst danach lostpointercapture aus)
    assert.deepEqual(log, ['bewegt', 'bewegt', 'ende'], ende);
  }
  // Negativ-Kontrolle: ein fremdes Ereignis beendet den Zug nicht
  const ziel = new EventTarget(), log = [];
  zugVerfolgen(ziel, () => log.push('bewegt'), () => log.push('ende'));
  ziel.dispatchEvent(new Event('pointerenter')); ziel.dispatchEvent(new Event('pointermove'));
  assert.deepEqual(log, ['bewegt']);
});

// Fix 11: Text nur bei Änderung schreiben (jedes Schreiben in textContent ersetzt den Textknoten, im Bildtakt 60 mal je Sekunde)
import { setzeText } from '../oeffentlich/produktion/layout.js';
const zaehlend = () => ({ schreibungen: 0, _t: '', get textContent() { return this._t; }, set textContent(v) { this._t = v; this.schreibungen++; } });
test('V1 Layout: setzeText schreibt nur, wenn sich der Text ändert', () => {
  const el = zaehlend();
  for (let i = 0; i < 100; i++) setzeText(el, '1.1.1');
  assert.equal(el.schreibungen, 1, 'hundert Bilder, ein Schreiben');
  setzeText(el, '1.2.1'); setzeText(el, '1.2.1');
  assert.equal(el.schreibungen, 2);
  assert.equal(el.textContent, '1.2.1');
  // Negativ-Kontrollen: ein Wechsel zurück wird geschrieben; was anderer Code dazwischen schrieb, wird nachgezogen
  setzeText(el, '1.1.1');
  assert.equal(el.schreibungen, 3);
  el._t = 'fremd';
  setzeText(el, '1.1.1');
  assert.equal(el.textContent, '1.1.1');
  assert.equal(el.schreibungen, 4, 'der Knoten zeigte etwas anderes: nachgezogen');
});
