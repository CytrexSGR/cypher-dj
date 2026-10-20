// PRODUCTION (D1 V2): Piano-Roll im Detailbereich (Spec A3, 3.4 noten_*). Reine Funktionen, Browser und node.
// Fläche (Canvas-Pixel): links die Klaviatur (TASTEN_BREITE), rechts das Notenraster, unten die Velocity-Spur (VEL_HOEHE).
// Ansicht = { beat0, pxProBeat, tonOben }: beat0 ist der Clip-Beat am linken Rand des Rasters (Noten-beat ist relativ zum
// Clip, Spec 3.3), tonOben der Ton der obersten Zeile. Noten-IDs vergibt die Seite selbst nach dem Zähler von S2 (modell.ts
// notenZaehler: EIN Zähler je Projekt, Spec 6.28 Nachsatz zu 6.26), damit eine neue Note sofort gewählt und weitergezogen werden kann;
// eine ID unter dem Zähler lehnte S2 mit id_belegt ab (Spec 6.30).
import { rasten } from './zeitachse.js';

export const TASTEN_BREITE = 40;
export const TON_HOEHE = 9;
export const VEL_HOEHE = 44;
export const NOTE_GRIFF = 5;          // rechter Rand einer Note: Länge ziehen
export const VEL_VORGABE = 100;
export const QUANT = 0.25;            // Spec A3: auf 1/16 quantisieren
export const MIN_NOTE = 1 / 64;       // kürzeste Note bei SNAP OFF
export const LAENGEN = [
  { wert: 0.25, text: '1/16' }, { wert: 0.5, text: '1/8' }, { wert: 1, text: '1/4' }, { wert: 2, text: '1/2' }, { wert: 4, text: '1 BAR' },
];
const NAMEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const runde = (x) => Math.round(x * 1e9) / 1e9;
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const tonName = (t) => `${NAMEN[t % 12]}${Math.floor(t / 12) - 2}`;   // Schreibweise wie Ableton: 60 = C3
export const istSchwarz = (t) => [1, 3, 6, 8, 10].includes(t % 12);
export const zeilen = (hoehe) => Math.max(1, Math.floor((hoehe - VEL_HOEHE) / TON_HOEHE));

export const beatZuRx = (a, beat) => TASTEN_BREITE + (beat - a.beat0) * a.pxProBeat;
export const rxZuBeat = (a, x) => a.beat0 + (x - TASTEN_BREITE) / a.pxProBeat;
export const tonZuY = (a, ton) => (a.tonOben - ton) * TON_HOEHE;
export const yZuTon = (a, y) => a.tonOben - Math.floor(y / TON_HOEHE);
export const imRaster = (x, y, hoehe) => x >= TASTEN_BREITE && y >= 0 && y < hoehe - VEL_HOEHE;
export const inVelSpur = (x, y, hoehe) => x >= TASTEN_BREITE && y >= hoehe - VEL_HOEHE && y < hoehe;

// Ansicht für einen Clip: ganze Clip-Länge sichtbar (mindestens ein Takt), Töne um die Mitte der Noten (ohne Noten C2..)
export function neueRollAnsicht(clip, breite, hoehe) {
  const n = clip.noten ?? [];
  const mitte = n.length ? Math.round((Math.min(...n.map((x) => x.ton)) + Math.max(...n.map((x) => x.ton))) / 2) : 48;
  const z = zeilen(hoehe);
  return { beat0: 0, pxProBeat: Math.max(1, (breite - TASTEN_BREITE) / Math.max(4, clip.laenge_beats)), tonOben: klemme(mitte + Math.floor(z / 2), z - 1, 127) };
}
export const scrolleTon = (a, dTon, hoehe) => ({ ...a, tonOben: klemme(a.tonOben + dTon, zeilen(hoehe) - 1, 127) });
export const scrolleBeat = (a, dx) => ({ ...a, beat0: Math.max(0, a.beat0 + dx / a.pxProBeat) });
export function zoomRoll(a, faktor, x) {
  const beat = rxZuBeat(a, x), px = klemme(a.pxProBeat * faktor, 2, 800);
  return { ...a, pxProBeat: px, beat0: Math.max(0, beat - (x - TASTEN_BREITE) / px) };
}

export function notenKasten(a, n) {
  return { x: beatZuRx(a, n.beat), y: tonZuY(a, n.ton), w: Math.max(2, n.laenge * a.pxProBeat), h: TON_HOEHE - 1 };
}
// Note unter (x, y): { note, zone: 'rand' | 'mitte' } oder null; die zuletzt gezeichnete gewinnt
export function trefferNote(clip, a, x, y) {
  for (let i = clip.noten.length - 1; i >= 0; i--) {
    const n = clip.noten[i], k = notenKasten(a, n);
    if (x < k.x || x > k.x + k.w || y < k.y || y > k.y + k.h) continue;
    return { note: n, zone: x >= k.x + k.w - Math.min(NOTE_GRIFF, k.w / 3) ? 'rand' : 'mitte' };
  }
  return null;
}
// Velocity-Spur: Note, deren Stiel unter x liegt (gewählte zuerst), und die Abbildung y ↔ vel
export function trefferVel(clip, a, x, auswahl = []) {
  const unter = clip.noten.filter((n) => { const k = notenKasten(a, n); return x >= k.x - 3 && x <= k.x + Math.max(6, Math.min(k.w, 12)); });
  return unter.find((n) => auswahl.includes(n.id)) ?? unter.at(-1) ?? null;
}
export const velZuY = (vel, hoehe) => hoehe - 2 - (vel / 127) * (VEL_HOEHE - 6);
export const yZuVel = (y, hoehe) => klemme(Math.round(((hoehe - 2 - y) / (VEL_HOEHE - 6)) * 127), 1, 127);

// IDs neuer Noten nach dem Zähler von S2 (modell.ts notenZaehler): naechste_noten_id des Projekts, sonst das Maximum aller Noten-IDs
// n<Zahl> über alle MIDI-Clips (und alter Clip-Zähler) plus 1; dann weiter
export function notenZaehler(projekt) {
  if (Number.isInteger(projekt?.naechste_noten_id)) return projekt.naechste_noten_id;
  let m = 1;
  for (const s of projekt?.spuren ?? []) for (const c of s.clips ?? []) {
    if (c.art !== 'midi') continue;
    if (Number.isInteger(c.naechste_noten_id)) m = Math.max(m, c.naechste_noten_id);
    for (const n of c.noten ?? []) if (/^n\d+$/.test(n.id)) m = Math.max(m, Number(n.id.slice(1)) + 1);
  }
  return m;
}
export function naechsteNotenIds(projekt, anzahl) {
  const m = notenZaehler(projekt);
  return Array.from({ length: anzahl }, (_, i) => `n${m + i}`);
}

// Note setzen: Anfang auf den Rasterschritt, in den geklickt wurde (abgerundet); Ton der Zeile; Länge aus der Werkzeugleiste; ID aus dem Projekt
export function neueNote(projekt, beat, ton, raster, laenge, vel = VEL_VORGABE) {
  const start = raster > 0 ? Math.floor(beat / raster + 1e-9) * raster : beat;
  return { id: naechsteNotenIds(projekt, 1)[0], beat: runde(Math.max(0, start)), laenge, ton: klemme(Math.round(ton), 0, 127), vel };
}

// Verschieben: der gegriffene Note (anker) rastet, alle gewählten folgen; keine vor Beat 0, keine aus 0..127
export function verschiebeNoten(clip, ids, ankerId, dBeat, dTon, raster) {
  const ns = clip.noten.filter((n) => ids.includes(n.id)), anker = ns.find((n) => n.id === ankerId);
  if (!anker) return [];
  let d = rasten(anker.beat + dBeat, raster) - anker.beat;
  d = Math.max(d, -Math.min(...ns.map((n) => n.beat)));
  const t = klemme(Math.round(dTon), -Math.min(...ns.map((n) => n.ton)), 127 - Math.max(...ns.map((n) => n.ton)));
  return ns.map((n) => {
    const x = { id: n.id };
    if (runde(n.beat + d) !== n.beat) x.beat = runde(n.beat + d);
    if (t !== 0) x.ton = n.ton + t;
    return x;
  }).filter((x) => Object.keys(x).length > 1);
}
// Länge ziehen: das Ende der Anker-Note rastet, alle gewählten ändern ihre Länge um denselben Betrag, keine unter einen Schritt
export function dehneNoten(clip, ids, ankerId, dBeat, raster) {
  const ns = clip.noten.filter((n) => ids.includes(n.id)), anker = ns.find((n) => n.id === ankerId);
  if (!anker) return [];
  const min = raster > 0 ? raster : MIN_NOTE;
  const dl = Math.max(min, rasten(anker.beat + anker.laenge + dBeat, raster) - anker.beat) - anker.laenge;
  return ns.map((n) => ({ id: n.id, laenge: runde(Math.max(Math.min(min, n.laenge), n.laenge + dl)) })).filter((x, i) => x.laenge !== ns[i].laenge);
}
// Velocity: die Anker-Note bekommt den Wert unter dem Zeiger, die übrigen gewählten ändern sich um denselben Betrag
export function velocityNoten(clip, ids, ankerId, velAnker) {
  const ns = clip.noten.filter((n) => ids.includes(n.id) || n.id === ankerId), anker = ns.find((n) => n.id === ankerId);
  if (!anker) return [];
  const d = klemme(Math.round(velAnker), 1, 127) - anker.vel;
  const aus = ns.map((n) => ({ id: n.id, vel: klemme(n.vel + d, 1, 127) })).filter((x, i) => x.vel !== ns[i].vel);
  return ids.includes(ankerId) ? aus : aus.filter((x) => x.id === ankerId);
}
// Quantisieren (Spec A3: 1/16): Anfang auf den nächsten Rasterpunkt, Länge bleibt; ohne Auswahl alle Noten
export function quantisiere(clip, ids, raster = QUANT) {
  const ns = ids.length ? clip.noten.filter((n) => ids.includes(n.id)) : clip.noten;
  return ns.map((n) => ({ id: n.id, beat: runde(Math.max(0, rasten(n.beat, raster))) })).filter((x, i) => x.beat !== ns[i].beat);
}
// Rechteck aufziehen: alle Noten, deren Kasten das Rechteck berührt
export function rechteckAuswahl(clip, a, x0, y0, x1, y1) {
  const l = Math.min(x0, x1), r = Math.max(x0, x1), o = Math.min(y0, y1), u = Math.max(y0, y1);
  return clip.noten.filter((n) => { const k = notenKasten(a, n); return k.x <= r && k.x + k.w >= l && k.y <= u && k.y + k.h >= o; }).map((n) => n.id);
}
// Pfeiltasten: ←/→ ein Rasterschritt (bei OFF 1/16), ↑/↓ ein Halbton, mit Umschalt eine Oktave
export function tastenSchritt(key, shift, raster) {
  const g = raster > 0 ? raster : QUANT;
  if (key === 'ArrowLeft') return { dBeat: -g, dTon: 0 };
  if (key === 'ArrowRight') return { dBeat: g, dTon: 0 };
  if (key === 'ArrowUp') return { dBeat: 0, dTon: shift ? 12 : 1 };
  if (key === 'ArrowDown') return { dBeat: 0, dTon: shift ? -12 : -1 };
  return null;
}
// Werkzeugleiste VEL: gemeinsamer Wert der Auswahl, '' bei keiner, '–' bei verschiedenen
export function auswahlVel(clip, ids) {
  const v = [...new Set(clip.noten.filter((n) => ids.includes(n.id)).map((n) => n.vel))];
  return v.length === 0 ? '' : v.length === 1 ? String(v[0]) : '–';
}
export const notenLabel = (was, n) => `${was} ${n === 1 ? 'note' : `${n} notes`}`;
