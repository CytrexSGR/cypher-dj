// Workbench: the pure grid model (stage 1, task 6). Browser and node, no DOM, no fetch.
// The grid shows one track's pattern as 16 steps per bar (step = 1/16 note = 0.25 beat). This module holds the window over the module's bars, the counting
// rows, the row sets of a drum grid and a pitch grid, the cells and value lanes, and the project commands of a click, a value and a pattern length.
// Commands come from seq_logic.js; a gesture that cannot be written throws a SeqFehler. Nothing here talks to the server.
import { musterLaenge, zelleBefehle, laengeBefehle, folgeEditierbar, SeqFehler } from '../seq_logic.js';
import { tonName } from '../production/pianoroll.js';
import { LAENGEN_TAKTE } from '../seq_field.js';

export const SCHRITT = 0.25;                 // beats per step
export const SCHRITTE_TAKT = 16;             // steps per bar
export const SICHTEN = [1, 2, 4];            // VIEW: bars shown at once
export const TON_MIN = 24;                   // C0
export const TON_MAX = 119;                  // B7
export const FENSTER = 24;                   // rows of a pitch grid (two octaves)
export const RAD = 2;                        // semitones per wheel notch
export const VEL_VORGABE = 100;
export const LAENGE_VORGABE = 1;             // steps
const EPS = 1e-9;
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const runde = (x) => Math.round(x * 1e9) / 1e9;
const fehler = (text, grund = 'argument_ungueltig') => { throw new SeqFehler(grund, text); };
const noten = (clip) => clip?.noten ?? [];
const betontNr = (nr) => nr % 4 === 1;       // bars and steps 1, 5, 9, 13

// ---------- window (D9) ----------
// The window over the module's bars: never wider than the module, its start a multiple of its width, clamped to the module. Bars are 0-based.
export function fenster({ sicht, start } = {}, modulTakte) {
  const s = SICHTEN.includes(sicht) ? sicht : 4;
  const module = Math.max(1, Math.floor(modulTakte) || 1);
  const breite = Math.min(s, module);
  const a = klemme(Math.floor((Number.isFinite(start) ? start : 0) / breite) * breite, 0, module - breite);
  return { sicht: s, breite, start: a, takte: Array.from({ length: breite }, (_, i) => a + i) };
}
export const blaettere = (f, richtung, modulTakte) => fenster({ sicht: f.sicht, start: f.start + Math.sign(richtung) * f.breite }, modulTakte);
export const taktWahl = (f, takt, modulTakte) => fenster({ sicht: f.sicht, start: Math.floor(takt / f.breite) * f.breite }, modulTakte);
// The bar strip: one entry per module bar.
export const leiste = (modulTakte, f) => Array.from({ length: Math.max(1, Math.floor(modulTakte) || 1) }, (_, takt) => (
  { takt, nr: takt + 1, betont: betontNr(takt + 1), sichtbar: f.takte.includes(takt) }));
// The BAR row (`schritt` = the absolute first step of the bar) and the STEP row of the window.
export function zaehlung(f) {
  return {
    takte: f.takte.map((t) => ({ nr: t + 1, schritt: t * SCHRITTE_TAKT })),
    schritte: f.takte.flatMap(() => Array.from({ length: SCHRITTE_TAKT }, (_, i) => ({ nr: i + 1, betont: betontNr(i + 1) }))),
  };
}

// ---------- rows (D8) ----------
// Drum rows: the sounds of the instrument info in their order, then every pitch the pattern holds that no sound names.
export function drumZeilen(clip, info) {
  const zeilen = (info?.klaenge ?? []).map((k) => ({ ton: k.ton, name: k.name }));
  const fremd = [...new Set(noten(clip).map((n) => n.ton))].filter((t) => !zeilen.some((z) => z.ton === t)).sort((a, b) => a - b);
  return [...zeilen, ...fremd.map((ton) => ({ ton, name: tonName(ton) }))];
}
const schwarz = (t) => [1, 3, 6, 8, 10].includes(t % 12);
// Pitch rows, top row first: the window of 24 rows below `oben`, or with `fold` only the pitches the pattern uses (no notes: fold changes nothing).
export function tonZeilen(oben, fold, clip) {
  const benutzt = [...new Set(noten(clip).map((n) => n.ton))];
  const toene = fold && benutzt.length
    ? benutzt.sort((a, b) => b - a)
    : Array.from({ length: FENSTER }, (_, i) => oben - i).filter((t) => t >= 0 && t <= 127);
  return toene.map((ton) => ({ ton, name: tonName(ton), schwarz: schwarz(ton), c: ton % 12 === 0 }));
}
const klemmeOben = (oben) => klemme(oben, TON_MIN + FENSTER - 1, TON_MAX);
// The first window of a pitch grid: the octave C of the lowest pitch plus 23 (no notes: 59).
export function startOben(clip) {
  const n = noten(clip);
  if (!n.length) return 59;
  return klemmeOben(Math.floor(Math.min(...n.map((x) => x.ton)) / 12) * 12 + FENSTER - 1);
}
// The wheel: a negative deltaY (wheel up) raises the window by RAD semitones, a positive one lowers it; the window stays within C0..B7.
export const radOben = (oben, deltaY) => klemmeOben(oben - Math.sign(deltaY) * RAD);
// The octave bar, 7 down to 0. Octave o spans C(o)..B(o+1) when clicked (`oben`); R9: the top never exceeds B7, so octave 7 shows 96..119.
export function oktavLeiste(oben, clip) {
  const unten = oben - FENSTER + 1;
  const benutzt = noten(clip).map((n) => n.ton);
  return Array.from({ length: 8 }, (_, i) => 7 - i).map((oktave) => {
    const lo = (oktave + 2) * 12, hi = lo + 11;
    return { oktave, sichtbar: lo <= oben && hi >= unten, noten: benutzt.some((t) => t >= lo && t <= hi), oben: klemmeOben(lo + FENSTER - 1) };
  });
}

// ---------- cells ----------
// 'muster': editable with a clip; 'kein_clip': editable, the first edit creates the clip; 'gesperrt': not a pattern (read-only, never sends a command).
export function zustand(spur) {
  if (!folgeEditierbar(spur)) return 'gesperrt';
  return (spur.clips ?? []).length === 0 ? 'kein_clip' : 'muster';
}
export const musterTakte = (clip) => musterLaenge(clip) / 4;
export const zuLang = (clip, modulTakte) => musterLaenge(clip) > modulTakte * 4 + EPS;

const musterSchritte = (clip) => Math.max(1, Math.round(musterLaenge(clip) / SCHRITT));
// the notes that start in pattern step `quelle` (pitch `ton`, null = any), lowest first
const imSchritt = (clip, ton, quelle) => {
  const von = quelle * SCHRITT, bis = von + SCHRITT;
  return noten(clip).filter((n) => (ton === null || ton === undefined || n.ton === ton) && n.beat >= von - EPS && n.beat < bis - EPS).sort((a, b) => a.ton - b.ton);
};
const schrittLaenge = (n) => Math.max(1, Math.round(n.laenge / SCHRITT));
// every visible step of the window: `schritt` absolute in the module, `quelle` the pattern step it repeats
export function zellen(clip, ton, f) {
  const P = musterSchritte(clip), aus = [];
  for (let schritt = f.takte[0] * SCHRITTE_TAKT; schritt < (f.takte[f.takte.length - 1] + 1) * SCHRITTE_TAKT; schritt++) {
    const quelle = schritt % P, n = imSchritt(clip, ton, quelle)[0];
    aus.push({ schritt, quelle, an: !!n, vel: n ? n.vel : null, laenge: n ? schrittLaenge(n) : null, wiederholung: schritt >= P });
  }
  return aus;
}
// the value lane under the grid: `feld` 'vel' or 'laenge' (in steps); `anders` = differs from the default
export function wertZellen(clip, ton, f, feld) {
  if (feld !== 'vel' && feld !== 'laenge') fehler(`value field: vel or laenge is expected, not ${feld}`);
  const vorgabe = feld === 'vel' ? VEL_VORGABE : LAENGE_VORGABE;
  return zellen(clip, ton, f).map((z) => {
    const wert = z.an ? z[feld] : null;
    return { schritt: z.schritt, quelle: z.quelle, da: z.an, wert, anders: z.an && wert !== vorgabe, wiederholung: z.wiederholung };
  });
}

// ---------- commands ----------
// A click on a step. The step is read as a trigger lane of the row's pitch (synthetic, so no stored lane is needed). drum: toggles; note: an empty step
// writes a one-step note, a full one is deleted.
export function klickBefehle(spur, clip, ton, quelle, art) {
  if (zustand(spur) === 'gesperrt') fehler('this track is not a pattern, it can only be edited in PRODUCTION', 'nicht_editierbar');
  if (!clip) fehler('the pattern has no clip yet');
  if (!Number.isInteger(ton)) fehler('a pitch row is expected');
  const zeile = { id: `t${ton}`, art: 'noten', teiler: SCHRITT, ton };
  const felder = art === 'drum' ? {} : imSchritt(clip, ton, quelle).length ? { an: false } : { an: true, laenge: 1 };
  return zelleBefehle(spur, clip, zeile, quelle, felder);
}
// A value for the notes that start in pattern step `quelle` (pitch `ton`, null = every pitch): one noten_aendern. vel: whole 1..127; laenge: whole steps
// 1..16, written as beats. A note that already has the value is left out (then the list is empty).
export function wertBefehle(clip, ton, quelle, feld, wert) {
  if (feld !== 'vel' && feld !== 'laenge') fehler(`value field: vel or laenge is expected, not ${feld}`);
  if (!clip) fehler('the pattern has no clip yet');
  if (!Number.isInteger(quelle) || quelle < 0 || quelle >= musterSchritte(clip)) fehler(`step ${quelle}: the pattern has ${musterSchritte(clip)} steps`);
  const [min, max, name] = feld === 'vel' ? [1, 127, 'velocity'] : [1, 16, 'length'];
  if (!Number.isInteger(wert) || wert < min || wert > max) fehler(`${name} takes whole numbers ${min}..${max}${feld === 'laenge' ? ' (steps)' : ''}`);
  const drin = imSchritt(clip, ton, quelle);
  if (!drin.length) fehler(`step ${quelle + 1}: no note starts in this step`);
  const neu = feld === 'vel' ? wert : runde(wert * SCHRITT);
  const aend = drin.filter((n) => n[feld] !== neu).map((n) => ({ id: n.id, [feld]: neu }));
  return aend.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aend }] : [];
}
// The pattern length in bars (1, 2, 4, 8, 16) with the number of notes it deletes (shortening deletes what lies behind the new end).
export function musterLaengeBefehle(spur, clip, takte) {
  if (!LAENGEN_TAKTE.includes(takte)) fehler(`pattern length: ${LAENGEN_TAKTE.join(', ')} bars are possible`);
  const befehle = laengeBefehle(spur, clip, takte * 4);
  const geloescht = befehle.filter((b) => b.befehl === 'noten_loeschen').reduce((s, b) => s + b.ids.length, 0);
  return { befehle, geloescht };
}
