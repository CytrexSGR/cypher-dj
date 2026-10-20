// PRODUCTION (D1 V1): Zeitachse des Arrangements in Projekt-Beats (L2: alles spricht in Beats). Reine Funktionen,
// laufen im Browser und in node (Tests, Muster spurband.js). Ansicht = { beat0, pxProBeat }: beat0 ist der Beat am
// linken Rand der Spurfläche, pxProBeat der Zoom. Taktart fest 4/4 (Spec 2.7).

export const PX_PRO_BEAT_MIN = 0.5;
export const PX_PRO_BEAT_MAX = 400;
export const PX_PRO_BEAT_VORGABE = 24;

// Raster (Transportleiste GRID): Wert für localStorage, Text der Oberfläche, Schritt in Beats (0 = kein Rasten)
export const RASTER = [
  { wert: 'sechzehntel', text: '1/16', beats: 0.25 },
  { wert: 'achtel', text: '1/8', beats: 0.5 },
  { wert: 'beat', text: '1/4', beats: 1 },
  { wert: 'takt', text: 'BAR', beats: 4 },
  { wert: 'aus', text: 'OFF', beats: 0 },
];
export const RASTER_VORGABE = 'beat';
export const rasterBeats = (wert) => RASTER.find((r) => r.wert === wert)?.beats ?? 1;

export const neueAnsicht = () => ({ beat0: 0, pxProBeat: PX_PRO_BEAT_VORGABE });
export const beatZuX = (a, beat) => (beat - a.beat0) * a.pxProBeat;
export const xZuBeat = (a, x) => a.beat0 + x / a.pxProBeat;
const zoomGrenze = (px) => Math.min(PX_PRO_BEAT_MAX, Math.max(PX_PRO_BEAT_MIN, px));

// Rasten auf den nächsten Rasterpunkt; raster 0 (OFF) lässt den Beat unverändert
export function rasten(beat, raster) {
  if (!(raster > 0)) return beat;
  return Math.round(beat / raster) * raster;
}

// Zoom um die Pixelstelle x: der Beat unter x bleibt stehen, solange beat0 nicht unter 0 fiele (dann beat0 = 0)
export function zoomUm(a, faktor, x) {
  const beat = xZuBeat(a, x);
  const px = zoomGrenze(a.pxProBeat * faktor);
  return { beat0: Math.max(0, beat - x / px), pxProBeat: px };
}

// Waagrecht scrollen um dx Pixel (Rad, Ziehen); nie vor Beat 0
export const scrolle = (a, dx) => ({ ...a, beat0: Math.max(0, a.beat0 + dx / a.pxProBeat) });

// Lineal: Hauptlinien (beschriftet) mindestens 60 px auseinander, Nebenlinien mindestens 8 px
const STUFEN = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
export function linealStufen(pxProBeat) {
  const haupt = STUFEN.find((s) => s * pxProBeat >= 60) ?? STUFEN.at(-1);
  const neben = STUFEN.find((s) => s * pxProBeat >= 8) ?? haupt;
  return { haupt, neben };
}
const vielfaches = (x, s) => Math.abs(x / s - Math.round(x / s)) < 1e-9;

// Position Takt.Schlag.Sechzehntel, 1-basiert: Beat 0 = 1.1.1, Beat 5.25 = 2.2.2
export function positionText(beat) {
  const b = Math.max(0, beat);
  const takt = Math.floor(b / 4) + 1, schlag = Math.floor(b % 4) + 1, sech = Math.floor((b % 1) * 4 + 1e-9) + 1;
  return `${takt}.${schlag}.${sech}`;
}
// Lineal-Beschriftung: ab Hauptstufe 4 nur der Takt, ab 1 Takt.Schlag, darunter voll
export function linealText(beat, haupt) {
  const p = positionText(beat).split('.');
  return haupt >= 4 ? p[0] : haupt >= 1 ? `${p[0]}.${p[1]}` : p.join('.');
}

// Linien im sichtbaren Bereich [0, breite): { beat, x, haupt, takt, text }
export function linien(a, breite) {
  const { haupt, neben } = linealStufen(a.pxProBeat);
  const ende = xZuBeat(a, breite);
  const aus = [];
  for (let k = Math.max(0, Math.ceil(a.beat0 / neben - 1e-9)); k * neben <= ende; k++) {   // max: nie -0 (Test 5)
    const beat = k * neben, h = vielfaches(beat, haupt);
    aus.push({ beat, x: beatZuX(a, beat), haupt: h, takt: vielfaches(beat, 4), text: h ? linealText(beat, haupt) : null });
  }
  return aus;
}

// Abspielkopf in der Loop-Klammer: zwischen zwei /zustand/arr-Meldungen läuft die Hochrechnung über bis hinaus; gezeigt
// wird der gefaltete Beat. Der Kern springt aber nur „beim Erreichen von bis“ (Spec 2.2): lag das letzte gemeldete projekt_beat
// (letzterBeat) schon bei oder hinter bis (Start hinter der Klammer), erreicht er bis nie und läuft ungefaltet weiter; dann
// würde Falten den Kopf dauerhaft an die falsche Stelle setzen. Unbekanntes letzterBeat (noch keine Meldung): nicht falten.
// Vor von wird nicht gefaltet.
export function kopfImLoop(beat, loop, letzterBeat) {
  if (!loop?.an) return beat;
  const l = loop.bis_beat - loop.von_beat;
  if (!(l > 0) || beat < loop.bis_beat) return beat;
  if (!(typeof letzterBeat === 'number' && letzterBeat < loop.bis_beat)) return beat;   // typeof: null < 32 wäre in JS wahr
  return loop.von_beat + ((beat - loop.von_beat) % l);
}

// FOLLOW: Seite umblättern, wenn der Kopf das sichtbare Fenster verlässt oder 90 % erreicht; null = nichts zu tun
export function folgeSeite(a, kopfBeat, breite) {
  const sicht = breite / a.pxProBeat;
  if (kopfBeat >= a.beat0 && kopfBeat <= a.beat0 + sicht * 0.9) return null;
  return Math.max(0, kopfBeat - sicht * 0.1);
}
