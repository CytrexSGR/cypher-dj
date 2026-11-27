// PRODUCTION (D1 V1): Zeitachse des Arrangements in Projekt-Beats (L2: alles spricht in Beats). Reine Funktionen,
// laufen im Browser und in node (Tests, Muster track_tape.js). Ansicht = { beat0, pxProBeat }: beat0 ist der Beat am
// linken Rand der Spurfläche, pxProBeat der Zoom. Taktart: [n, 4] per project (beatsProTakt), default 4/4.

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
// Beats per bar of a project meter [n, 4]; a project without the field (or nonsense) is 4/4. The BAR step of the raster is one bar.
export const beatsProTakt = (taktart) => (Array.isArray(taktart) && Number.isInteger(taktart[0]) && taktart[0] >= 2 && taktart[0] <= 12 ? taktart[0] : 4);
export const rasterBeats = (wert, beatsProTakt = 4) => (wert === 'takt' ? beatsProTakt : RASTER.find((r) => r.wert === wert)?.beats ?? 1);

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

// Sichtbare Scrollleiste (Andreas 2026-10-30: „ich kann in der ansicht nicht vorscrollen“). Der Inhalt reicht vom Beat 0 bis hinter das Projektende
// plus eine Bildbreite, damit das Ende an den linken Rand rollt; liegt die Ansicht schon weiter rechts, wächst er mit (die Leiste klemmt nie zurück).
export const projektEnde = (p) => Math.max(0, ...(p?.spuren ?? []).flatMap((s) => s.clips.map((c) => c.start_beat + c.laenge_beats)));
export function leiste(a, endeBeat, breitePx) {
  const links = a.beat0 * a.pxProBeat;
  return { inhaltPx: Math.ceil(Math.max(endeBeat * a.pxProBeat, links) + breitePx), links };
}
export const ausLeiste = (a, links) => ({ ...a, beat0: Math.max(0, links / a.pxProBeat) });

// Lineal: Hauptlinien (beschriftet) mindestens 60 px auseinander, Nebenlinien mindestens 8 px
const STUFEN = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
// beatsProTakt other than 4: a step of one bar or more becomes a whole number of bars (1, 2, 4, 8 ... bars), so the labelled lines are bar starts
export function linealStufen(pxProBeat, beatsProTakt = 4) {
  const stufe = (px) => {
    const s = STUFEN.find((x) => x * pxProBeat >= px) ?? STUFEN.at(-1);
    if (beatsProTakt === 4) return s;
    if (s < beatsProTakt) return beatsProTakt % s === 0 ? s : 1;   // a step must divide the bar, or the bar lines fall between the grid lines
    return beatsProTakt * (STUFEN.find((k) => k >= 1 && k * beatsProTakt * pxProBeat >= px) ?? STUFEN.at(-1));
  };
  const haupt = stufe(60);
  return { haupt, neben: Math.min(stufe(8), haupt) };
}
const vielfaches = (x, s) => Math.abs(x / s - Math.round(x / s)) < 1e-9;

// Position Takt.Schlag.Sechzehntel, 1-basiert: Beat 0 = 1.1.1, Beat 5.25 = 2.2.2
export function positionText(beat, beatsProTakt = 4) {
  const b = Math.max(0, beat);
  const takt = Math.floor(b / beatsProTakt) + 1, schlag = Math.floor(b % beatsProTakt) + 1, sech = Math.floor((b % 1) * 4 + 1e-9) + 1;
  return `${takt}.${schlag}.${sech}`;
}
// Lineal-Beschriftung: ab Hauptstufe 4 nur der Takt, ab 1 Takt.Schlag, darunter voll
export function linealText(beat, haupt, beatsProTakt = 4) {
  const p = positionText(beat, beatsProTakt).split('.');
  return haupt >= beatsProTakt ? p[0] : haupt >= 1 ? `${p[0]}.${p[1]}` : p.join('.');
}

// Linien im sichtbaren Bereich [0, breite): { beat, x, haupt, takt, text }
// raster (optional, the piano roll): the minor lines follow this step in beats, also finer than a sixteenth and triplets, when they are at least 6 px apart;
// otherwise (no raster, 0, or too fine) the lines are the default ones. Beats are rounded to 1e-9 then (1/3 steps).
export const LINIEN_MIN_PX = 6;
export function linien(a, breite, beatsProTakt = 4, raster = null) {
  const stufen = linealStufen(a.pxProBeat, beatsProTakt), haupt = stufen.haupt;
  const eigen = raster > 0 && raster * a.pxProBeat >= LINIEN_MIN_PX - 1e-9;
  const neben = eigen ? Math.min(raster, haupt) : stufen.neben;
  const ende = xZuBeat(a, breite);
  const aus = [];
  for (let k = Math.max(0, Math.ceil(a.beat0 / neben - 1e-9)); k * neben <= ende; k++) {   // max: nie -0 (Test 5)
    const beat = eigen ? Math.round(k * neben * 1e9) / 1e9 : k * neben, h = vielfaches(beat, haupt);
    aus.push({ beat, x: beatZuX(a, beat), haupt: h, takt: vielfaches(beat, beatsProTakt), text: h ? linealText(beat, haupt, beatsProTakt) : null });
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
