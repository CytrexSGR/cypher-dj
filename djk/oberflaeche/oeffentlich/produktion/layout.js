// PRODUCTION (D1 V1): Lage der Dinge im Arrangement (reine Funktionen, Browser und node). Spuren sind Zeilen fester Höhe
// in Array-Reihenfolge des Projekts (Spec 3.3: Anzeigereihenfolge = Array-Reihenfolge). Das Lineal hat oben die
// Loop-Zone (Klammer ziehen) und unten die Positions-Zone (Startposition setzen).
import { beatZuX, rasten } from './zeitachse.js';
import { quellSekunde, warpAn } from './warp.js';

export const SPUR_HOEHE = 64;
export const LINEAL_HOEHE = 28;
export const LOOP_ZONE = 12;            // y < 12 im Lineal: Loop-Klammer; darunter: Startposition
export const CLIP_KOPF = 14;            // Namenszeile eines Clips
export const FARBEN = ['#e0563b', '#e0a33e', '#d6c94a', '#58d66b', '#2fd6c3', '#3b8de0', '#8c9bff', '#9b59d0', '#e08cff'];

export const linealZone = (y) => (y < LOOP_ZONE ? 'loop' : 'position');
export function spurIndexBei(y, anzahl) {
  const i = Math.floor(y / SPUR_HOEHE);
  return y >= 0 && i < anzahl ? i : -1;
}

// Rechteck eines Clips in der Spurfläche (Pixel), 1 px Luft oben und unten
export function clipKasten(a, spurIndex, clip) {
  return { x: beatZuX(a, clip.start_beat), y: spurIndex * SPUR_HOEHE + 1, w: clip.laenge_beats * a.pxProBeat, h: SPUR_HOEHE - 2 };
}
export const sichtbar = (k, breite) => k.x + k.w >= 0 && k.x <= breite;

// Audio-Clip: Quell-Spalten [a, b) der Welle (DJKW, hop Frames je Spalte) für die Pixelspalte rx..rx+1 im Clip.
// Länge in Sekunden unverändert (kein Warp in D1, Spec 5): Sekunde im Clip = Beat im Clip · 60 / Projekttempo.
// Paket 1.13: ist der Clip gewarpt, liegt die Welle über W(b) (Marker, versatz_beats; mit Loop wiederholt sich jede Kopie), nicht über Sekunden.
export function quellSpalten(clip, bpm, hop, pxProBeat, rx, sr = 48000) {
  if (warpAn(clip)) {
    const lb = clip.loop_beats ?? null, b0 = clip.warp.versatz_beats + (lb ? (rx / pxProBeat) % lb : rx / pxProBeat);
    return [(quellSekunde(clip.warp.marker, b0) * sr) / hop, (quellSekunde(clip.warp.marker, b0 + 1 / pxProBeat) * sr) / hop];
  }
  const sek = (px) => (clip.offset_s ?? 0) + (px / pxProBeat) * 60 / bpm;
  return [(sek(rx) * sr) / hop, (sek(rx + 1) * sr) / hop];
}

// Paket 1.13 (Prüfung 2, MINOR 7): was die Zeichenschleife mit der Pixelspalte rx tut: [a, b) zeichnen, 'leer' (Stille: überspringen) oder 'ende' (Schleife beenden).
// Hinter dem Ende der Quelle (mit negativem Versatz auch vor ihrem Anfang) liegt Stille. Ein gewarpter Loop-Clip fängt in der nächsten Kopie wieder vorn an,
// dort darf die Schleife nicht enden; ungewarpt gilt wie bisher: hinter dem Ende der Quelle ist Schluss.
export function welleSpalteFuer(clip, bpm, hop, pxProBeat, rx, spaltenZahl) {
  const [a, b] = quellSpalten(clip, bpm, hop, pxProBeat, rx), gewarpt = warpAn(clip);
  if (gewarpt && b <= 0) return 'leer';
  if (a >= spaltenZahl) return gewarpt ? 'leer' : 'ende';
  return [a, b];
}

// MIDI-Clip: Notenvorschau als Rechtecke unter der Namenszeile; höchster Ton oben, Tonumfang mindestens eine Oktave
export function notenKaesten(clip, kasten, pxProBeat) {
  const n = clip.noten ?? [];
  if (n.length === 0) return [];
  let lo = Math.min(...n.map((x) => x.ton)), hi = Math.max(...n.map((x) => x.ton));
  if (hi - lo < 12) { const m = (hi + lo) / 2; lo = Math.floor(m - 6); hi = lo + 12; }
  const oben = kasten.y + CLIP_KOPF, hoehe = kasten.h - CLIP_KOPF - 2, zeile = hoehe / (hi - lo + 1);
  return n.filter((x) => x.beat < clip.laenge_beats).map((x) => ({
    x: kasten.x + x.beat * pxProBeat,
    y: oben + (hi - x.ton) * zeile,
    w: Math.max(1, Math.min(x.laenge, clip.laenge_beats - x.beat) * pxProBeat),
    h: Math.max(1, zeile - 1),
  }));
}

// Loop-Klammer im Lineal: welcher Griff liegt unter x (Toleranz 5 px)? 'von' | 'bis' | 'mitte' | null
export function klammerGriff(a, loop, x, toleranz = 5) {
  if (!loop) return null;
  const xv = beatZuX(a, loop.von_beat), xb = beatZuX(a, loop.bis_beat);
  if (Math.abs(x - xv) <= toleranz) return 'von';
  if (Math.abs(x - xb) <= toleranz) return 'bis';
  if (x > xv && x < xb) return 'mitte';
  return null;
}

// Ziehen an der Klammer: start = Loop bei Zugbeginn, griff wie klammerGriff oder 'neu' (Zug im Leeren).
// Ergebnis immer bis − von ≥ 1 (Spec 3.1 /k/arr/loop), von ≥ 0, gerastet.
export function zieheKlammer(start, griff, beatStart, beatJetzt, raster) {
  const d = beatJetzt - beatStart;
  if (griff === 'von') return { von_beat: Math.min(Math.max(0, rasten(start.von_beat + d, raster)), start.bis_beat - 1), bis_beat: start.bis_beat };
  if (griff === 'bis') return { von_beat: start.von_beat, bis_beat: Math.max(rasten(start.bis_beat + d, raster), start.von_beat + 1) };
  if (griff === 'mitte') {
    const l = start.bis_beat - start.von_beat, von = Math.max(0, rasten(start.von_beat + d, raster));
    return { von_beat: von, bis_beat: von + l };
  }
  const p = Math.max(0, rasten(beatStart, raster)), q = Math.max(0, rasten(beatJetzt, raster));
  const von = Math.min(p, q);
  return { von_beat: von, bis_beat: Math.max(Math.max(p, q), von + Math.max(1, raster)) };
}

// Ein Zug (Loop-Klammer ziehen): Bewegungen melden, bis pointerup, pointercancel oder lostpointercapture kommt; dann einmal beiEnde und
// alle Hörer ab. pointercancel (System nimmt dem Zeiger die Geste) und lostpointercapture ließen den Zug sonst hängen.
export const ZUG_ENDEN = ['pointerup', 'pointercancel', 'lostpointercapture'];
export function zugVerfolgen(ziel, beiBewegung, beiEnde) {
  const ende = () => {
    ziel.removeEventListener('pointermove', beiBewegung);
    for (const n of ZUG_ENDEN) ziel.removeEventListener(n, ende);
    beiEnde();
  };
  ziel.addEventListener('pointermove', beiBewegung);
  for (const n of ZUG_ENDEN) ziel.addEventListener(n, ende);
}

// Text nur bei Änderung schreiben: textContent ersetzt jedes Mal den Textknoten (und kostet im Bildtakt unnötig Layout)
export function setzeText(el, text) { if (el.textContent !== text) el.textContent = text; }
