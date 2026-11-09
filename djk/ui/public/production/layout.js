// PRODUCTION (D1 V1): Lage der Dinge im Arrangement (reine Funktionen, Browser und node). Spuren sind Zeilen fester Höhe
// in Array-Reihenfolge des Projekts (Spec 3.3: Anzeigereihenfolge = Array-Reihenfolge). Das Lineal hat oben die
// Loop-Zone (Klammer ziehen) und unten die Positions-Zone (Startposition setzen).
import { beatZuX, rasten } from './timeline.js';
import { quellSekunde, warpAn } from './warp.js';

export const SPUR_HOEHE = 64;
export const LINEAL_HOEHE = 28;
export const LOOP_ZONE = 12;            // y < 12 im Lineal: Loop-Klammer; darunter: Startposition
export const CLIP_KOPF = 14;            // Namenszeile eines Clips
export const FARBEN = ['#e0563b', '#e0a33e', '#d6c94a', '#58d66b', '#2fd6c3', '#3b8de0', '#8c9bff', '#9b59d0', '#e08cff'];

export const LANE_HOEHE = 48;           // Automation Slice 1: height of the lane row under a track (the row exists only while the lane is open)
export const GRUPPEN_HOEHE = 28;        // 1.10 T3: height of a group header row in the arrangement
export const TAKE_HOEHE = 40;           // 1.14 Comping: height of a take row (one per take of a track whose T button is on); the CSS head has the same 40 px

export const linealZone = (y) => (y < LOOP_ZONE ? 'loop' : 'position');
export function spurIndexBei(y, anzahl) {
  const i = Math.floor(y / SPUR_HOEHE);
  return y >= 0 && i < anzahl ? i : -1;
}

// Row table (AK28): a track row of SPUR_HOEHE, then its take rows (TAKE_HOEHE each, 1.14), then its lane row of LANE_HOEHE when the lane of that track is open.
// offen: indices of the tracks with an open lane (array or Set). takeZeilen: Map track index -> number of visible take rows (takes.js takeZeilenVon).
// Without open lanes and take rows the table is the old fixed grid: row i starts at i * SPUR_HOEHE. The ORDER (track, takes, lane) is written once, here;
// the heads (track_heads.js zeige) follow it.
export function zeilenTabelle(anzahl, offen = [], takeZeilen = new Map(), layout = null) {
  const o = offen instanceof Set ? offen : new Set(offen), z = [];
  let y = 0;
  // 1.10 T3: with a layout (gruppenLayout) the order is the derived display order; without one it is the array order of today (byte-equal rows).
  const folge = layout ? layout.folge : Array.from({ length: anzahl }, (_, i) => ({ art: 'spur', spur: i }));
  for (const f of folge) {
    if (f.art === 'gruppe') { z.push({ art: 'gruppe', gruppe: f.gruppe, y, h: GRUPPEN_HOEHE }); y += GRUPPEN_HOEHE; continue; }
    const i = f.spur;
    if (f.verborgen) { z.push({ art: 'spur', spur: i, y, h: 0, tiefe: f.tiefe, verborgen: true }); continue; }   // folded member: no row, no take rows, no lane row
    z.push(layout ? { art: 'spur', spur: i, y, h: SPUR_HOEHE, tiefe: f.tiefe, verborgen: false } : { art: 'spur', spur: i, y, h: SPUR_HOEHE });
    y += SPUR_HOEHE;
    for (let t = 0, n = takeZeilen.get(i) ?? 0; t < n; t++) { z.push({ art: 'take', spur: i, take: t, y, h: TAKE_HOEHE }); y += TAKE_HOEHE; }
    if (o.has(i)) { z.push({ art: 'lane', spur: i, y, h: LANE_HOEHE }); y += LANE_HOEHE; }
  }
  return z;
}
// 1.10 T3 (plan D3): the display order of tracks and group header rows, derived from the project. A group with at least one member gets ONE header row at
// the array position of its first member; all its members follow it in array order (tiefe 1), other tracks keep array order (tiefe 0). A track whose
// ausgang names an unknown group counts as ungrouped. A folded group marks its members verborgen. Array order and spur_verschieben are unchanged.
// Indices point into projekt.gruppen and projekt.spuren.
export function gruppenLayout(projekt) {
  const spuren = projekt?.spuren ?? [], gruppen = projekt?.gruppen ?? [], folge = [];
  const gIndex = new Map(gruppen.map((g, i) => [g.id, i]));
  const von = (s) => (s.ausgang?.art === 'gruppe' ? gIndex.get(s.ausgang.id) : undefined);
  const gesetzt = new Set();
  spuren.forEach((s, i) => {
    const g = von(s);
    if (g === undefined) { folge.push({ art: 'spur', spur: i, tiefe: 0, verborgen: false }); return; }
    if (gesetzt.has(g)) return;
    gesetzt.add(g);
    folge.push({ art: 'gruppe', gruppe: g });
    spuren.forEach((m, k) => { if (von(m) === g) folge.push({ art: 'spur', spur: k, tiefe: 1, verborgen: !!gruppen[g].gefaltet }); });
  });
  return { folge };
}
// The row table of a project as the page uses it: the layout only when at least one group has members (else exactly the old table)
export function zeilenFuer(projekt, offen = [], takeZeilen = new Map()) {
  const n = projekt?.spuren?.length ?? 0, l = gruppenLayout(projekt);
  return zeilenTabelle(n, offen, takeZeilen, l.folge.some((f) => f.art === 'gruppe') ? l : null);
}
export const zeilenHoehe = (tabelle) => (tabelle.length ? tabelle[tabelle.length - 1].y + tabelle[tabelle.length - 1].h : 0);
// The row at height y, or null (above the first row, below the last one, or y is not a number)
export function zeileBei(tabelle, y) {
  if (!(y >= 0)) return null;
  let lo = 0, hi = tabelle.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, z = tabelle[mid];
    if (y < z.y) hi = mid - 1; else if (y >= z.y + z.h) lo = mid + 1; else return z;
  }
  return null;
}
// Index of the TRACK under y when the row is a track row; a lane row (or nothing) gives -1, so a click in a lane never hits a clip
export function spurIndexBeiTabelle(tabelle, y) {
  const z = zeileBei(tabelle, y);
  return z && z.art === 'spur' ? z.spur : -1;
}
export const spurZeile = (tabelle, spur) => tabelle.find((z) => z.art === 'spur' && z.spur === spur) ?? null;
export const laneZeile = (tabelle, spur) => tabelle.find((z) => z.art === 'lane' && z.spur === spur) ?? null;
export const takeZeile = (tabelle, spur, take) => tabelle.find((z) => z.art === 'take' && z.spur === spur && z.take === take) ?? null;

// Rechteck eines Clips in der Spurfläche (Pixel), 1 px Luft oben und unten. y0: Oberkante der Spurzeile (Zeilentabelle); ohne: das feste Raster
export function clipKasten(a, spurIndex, clip, y0 = spurIndex * SPUR_HOEHE) {
  return { x: beatZuX(a, clip.start_beat), y: y0 + 1, w: clip.laenge_beats * a.pxProBeat, h: SPUR_HOEHE - 2 };
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
