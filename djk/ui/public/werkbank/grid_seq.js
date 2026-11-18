// Workbench sequencer logic (strand C): pure functions, no DOM. What a gesture or a key turns into as project commands: paint, erase, fill, line, selection,
// duplicate, value drag, ramp, row settings, pattern length in steps, loop range. The view (grid_view.js) only collects the cells a gesture touched
// and calls these once at the end of the gesture, so one gesture is one history step.
// A target is { ton, quelle }: the row and the step of the row's own period (a pale repeat names the step it repeats).
import { SeqFehler } from '../seq_logic.js';
import { SCHRITT, SCHRITTE_TAKT, AUFLOESUNGEN, VEL_VORGABE, imSchritt, musterSchritte, periodeZellen, quelleZelle, weite, deckung } from './grid.js';
import { akkord, arpeggio, inTonart, transponiere, transponiereStufen, umkehrung, passendeTonarten, tonartOk, tonartText, ARP_MODI } from '../harmonie.js';

export const STEPS_WAHL = AUFLOESUNGEN;   // STEPS: cells per bar of the view (4, 8, 16); a view state, no command
export const WERKZEUGE = ['draw', 'erase', 'fill'];
export const WERKZEUGE_NOTE = ['draw', 'chord', 'erase', 'fill'];   // the note grid also stamps chords
export const FUELL_SCHRITTE = [1, 2, 4];
// The value tabs that write a note field. `spanne` = pixels of dragging for the whole range.
export const WERT_FELDER = {
  vel: { min: 1, max: 127, vorgabe: VEL_VORGABE, name: 'velocity' },
  laenge: { min: 1, max: 16, vorgabe: 1, name: 'length' },
  chance: { min: 1, max: 100, vorgabe: 100, name: 'chance' },
  versatz: { min: -95, max: 95, vorgabe: 0, name: 'offset' },
  wdh: { min: 1, max: 8, vorgabe: 1, name: 'roll' },
};
export const SPANNE_PX = 120;
const EPS = 1e-9;
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const runde = (x) => Math.round(x * 1e9) / 1e9;
const fehler = (text, grund = 'argument_ungueltig') => { throw new SeqFehler(grund, text); };
const schluessel = (z) => `${z.ton}:${z.quelle}`;
const einmalig = (ziele) => { const gesehen = new Set(); return ziele.filter((z) => { const k = schluessel(z); if (gesehen.has(k)) return false; gesehen.add(k); return true; }); };

// ---------- rows ----------
// The period of a row in beats: its own length (stored in sixteenths), else the pattern length. A slice grid has no own row lengths.
export const zeilenBeats = (clip, ton, art = null) => {
  const own = art === 'slice' ? null : clip?.zeilen?.[ton]?.schritte ?? null;
  return own !== null ? own * SCHRITT : musterSchritte(clip) * SCHRITT;
};
// Cells of a row at the resolution `aufl`.
export const zeilenSchritte = (clip, ton, art = null, aufl = SCHRITTE_TAKT) => periodeZellen(zeilenBeats(clip, ton, art), aufl);
export const zeileDaten = (clip, ton) => clip?.zeilen?.[ton] ?? {};
export const quelleVon = (clip, ton, schritt, art = null, aufl = SCHRITTE_TAKT) => quelleZelle(zeilenBeats(clip, ton, art), schritt, aufl);
// A row length typed in cells of the view -> sixteenths of the model (4, 8 and 16 cells per bar always give whole sixteenths).
export function zeilenLaengeAusZellen(zellenAnzahl, aufl = SCHRITTE_TAKT) {
  const n = Number(zellenAnzahl);
  if (!Number.isInteger(n) || n < 1) fehler('row length takes whole numbers of steps');
  return n * SCHRITTE_TAKT / aufl;
}
export const zeilenLaengeInZellen = (schritte, aufl = SCHRITTE_TAKT) => schritte * aufl / SCHRITTE_TAKT;

// ---------- row settings (LENGTH, SWING, direction) ----------
// `feld` schritte (1..128), swing (1..100) or richtung ('pendel'); null or '' removes it. No change: an empty list.
export function zeileBefehle(clip, ton, feld, wert) {
  if (!clip) fehler('the pattern has no clip yet');
  if (!Number.isInteger(ton)) fehler('a row is expected');
  let neu = wert === '' || wert === undefined ? null : wert;
  if (feld === 'schritte' || feld === 'swing') {
    if (neu !== null) {
      neu = Number(neu);
      const max = feld === 'schritte' ? 128 : 100;
      if (!Number.isInteger(neu) || neu < 1 || neu > max) fehler(`${feld === 'schritte' ? 'row length' : 'swing'} takes whole numbers 1..${max}`);
    }
  } else if (feld === 'richtung') {
    if (neu !== null && neu !== 'pendel') fehler('direction takes pendel or nothing');
  } else fehler(`unknown row field ${feld}`, 'argument_unbekannt');
  if ((clip.zeilen?.[ton]?.[feld] ?? null) === neu) return [];
  return [{ befehl: 'zeile_setzen', clip_id: clip.id, ton, [feld]: neu }];
}

// SHIFT of a row: every hit of the pitch moves by `richtung` (+1 / -1) steps of the view and wraps inside the row's own period (its LENGTH, else the
// pattern). One noten_aendern; an empty row or a period without a whole step: an empty list.
export function schiebeBefehle(clip, ton, richtung, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  if (!Number.isInteger(ton)) fehler('a row is expected');
  const schritte = clip.zeilen?.[ton]?.schritte;
  const periode = schritte != null ? schritte / 4 : (clip.loop_beats ?? clip.laenge_beats);
  const weit = 4 / aufl;
  if (!(periode > 0) || periode < weit) return [];
  const aend = [];
  for (const n of clip.noten ?? []) {
    if (n.ton !== ton || n.beat >= periode - 1e-9) continue;
    let beat = (n.beat + Math.sign(richtung) * weit) % periode;
    if (beat < -1e-9) beat += periode;
    beat = Math.round(beat * 1e6) / 1e6;
    if (beat >= periode - 1e-9) beat = 0;
    if (Math.abs(beat - n.beat) > 1e-9) aend.push({ id: n.id, beat });
  }
  return aend.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aend }] : [];
}

// ---------- targets of a gesture ----------
// Every step of a row between two absolute steps (the line), as steps of the row's period.
export function linieZiele(clip, ton, s0, s1, art = null, aufl = SCHRITTE_TAKT) {
  const aus = [];
  for (let s = Math.min(s0, s1); s <= Math.max(s0, s1); s++) aus.push({ ton, quelle: quelleVon(clip, ton, s, art, aufl) });
  return einmalig(aus);
}
// FILL: every n-th step from the lower end of the range.
export function fuellZiele(clip, ton, s0, s1, n, art = null, aufl = SCHRITTE_TAKT) {
  if (!FUELL_SCHRITTE.includes(n)) fehler('fill takes every 1st, 2nd or 4th step');
  const aus = [];
  for (let s = Math.min(s0, s1); s <= Math.max(s0, s1); s += n) aus.push({ ton, quelle: quelleVon(clip, ton, s, art, aufl) });
  return einmalig(aus);
}
// The rectangle between two cells: `toene` = the row pitches top to bottom, rows and absolute steps inclusive.
export function rechteckZiele(clip, toene, ton0, s0, ton1, s1, art = null, aufl = SCHRITTE_TAKT) {
  const i0 = toene.indexOf(ton0), i1 = toene.indexOf(ton1);
  if (i0 < 0 || i1 < 0) return [];
  const aus = [];
  for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) for (let s = Math.min(s0, s1); s <= Math.max(s0, s1); s++) aus.push({ ton: toene[i], quelle: quelleVon(clip, toene[i], s, art, aufl) });
  return einmalig(aus);
}
// Ctrl-click: a step joins the selection or leaves it.
export function auswahlUmschalten(auswahl, ziel) {
  const k = schluessel(ziel);
  return auswahl.some((z) => schluessel(z) === k) ? auswahl.filter((z) => schluessel(z) !== k) : [...auswahl, { ton: ziel.ton, quelle: ziel.quelle }];
}
export const notenAn = (clip, ziel, art = null, aufl = SCHRITTE_TAKT) => imSchritt(clip, ziel.ton, ziel.quelle, art, aufl);

// ---------- paint and erase ----------
const neueNote = (art, ton, quelle, info, aufl = SCHRITTE_TAKT) => {
  const beat = runde(quelle * weite(aufl));
  if (art === 'slice') {
    const beats = info?.schnitt?.laengen_beats?.[ton];
    const schritte = Number.isFinite(beats) ? klemme(Math.round(beats / SCHRITT), 1, 16) : 1;
    return { beat, laenge: runde(schritte * SCHRITT), ton, vel: VEL_VORGABE };
  }
  return { beat, laenge: art === 'drum' ? 0.125 : weite(aufl), ton, vel: VEL_VORGABE };
};
// Set every target on (`an` true: the ones without a note get one) or off (every note that starts in it is deleted). A target past the end of its row is skipped.
export function setzeBefehle(clip, art, info, ziele, an, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  const loeschen = [], neu = [];
  for (const z of einmalig(ziele)) {
    if (!Number.isInteger(z.ton)) fehler('a pitch row is expected');
    if (!Number.isInteger(z.quelle) || z.quelle < 0 || z.quelle >= zeilenSchritte(clip, z.ton, art, aufl)) continue;
    const drin = notenAn(clip, z, art, aufl);
    if (an) { if (!drin.length) neu.push(neueNote(art, z.ton, z.quelle, info, aufl)); } else loeschen.push(...drin.map((n) => n.id));
  }
  return [
    ...(loeschen.length ? [{ befehl: 'noten_loeschen', clip_id: clip.id, ids: [...new Set(loeschen)] }] : []),
    ...(neu.length ? [{ befehl: 'noten_neu', clip_id: clip.id, noten: neu }] : []),
  ];
}

// ---------- long notes (note grid, 2026-11-17) ----------
// The cell the note of a cell starts in: the cell itself when a note starts there, the head of the note that sounds through it (note grid), null when empty.
export function kopfZelle(clip, ton, quelle, art = null, aufl = SCHRITTE_TAKT) {
  if (notenAn(clip, { ton, quelle }, art, aufl).length) return quelle;
  if (art !== 'note') return null;
  return deckung(clip, ton, zeilenSchritte(clip, ton, art, aufl), aufl).get(quelle)?.kopf ?? null;
}
// What a note over the cells a..b of a row pushes aside: notes of the row that start in (a, b] go (`weg`), a note that starts before `a` and sounds into
// it ends in front of it (`kuerzen`).
function raeume(clip, ton, a, b, art, aufl) {
  const w = weite(aufl), weg = [], kuerzen = [];
  for (const n of clip.noten ?? []) {
    if (n.ton !== ton) continue;
    const kopf = Math.floor(n.beat / w + EPS);
    if (kopf > a && kopf <= b) weg.push(n.id);
    else if (kopf < a && kopf + Math.max(1, Math.round(n.laenge / w)) > a) kuerzen.push({ id: n.id, laenge: runde((a - kopf) * w) });
  }
  return { weg, kuerzen };
}
const alsBefehle = (clip, weg, aendern, neu) => [
  ...(weg.length ? [{ befehl: 'noten_loeschen', clip_id: clip.id, ids: [...new Set(weg)] }] : []),
  ...(aendern.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aendern }] : []),
  ...(neu.length ? [{ befehl: 'noten_neu', clip_id: clip.id, noten: neu }] : []),
];
// Dragging the end of a note: the notes that start in cell `kopf` of the row end with cell `ende` (inclusive): at least one cell, at most to the end of the
// row. Notes the longer note runs over are deleted. No change: an empty list.
export function laengeBefehle(clip, art, ton, kopf, ende, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  const Z = zeilenSchritte(clip, ton, art, aufl), w = weite(aufl);
  if (!Number.isInteger(kopf) || kopf < 0 || kopf >= Z) return [];
  const zellen = klemme(ende - kopf + 1, 1, Z - kopf), laenge = runde(zellen * w);
  const eigene = notenAn(clip, { ton, quelle: kopf }, art, aufl);
  if (!eigene.length) return [];
  const aend = eigene.filter((n) => Math.abs(n.laenge - laenge) > EPS).map((n) => ({ id: n.id, laenge }));
  const { weg } = raeume(clip, ton, kopf, kopf + zellen - 1, art, aufl);
  return alsBefehle(clip, weg, aend, []);
}
// One new note over the cells q0..q1 of a row (either order), from the start of the first cell to the end of the last.
const langeNote = (clip, art, ton, q0, q1, aufl) => {
  const Z = zeilenSchritte(clip, ton, art, aufl), w = weite(aufl);
  const a = klemme(Math.min(q0, q1), 0, Z - 1), b = klemme(Math.max(q0, q1), 0, Z - 1);
  const drin = notenAn(clip, { ton, quelle: a }, art, aufl).map((n) => n.id);
  const { weg, kuerzen } = raeume(clip, ton, a, b, art, aufl);
  return { weg: [...drin, ...weg], kuerzen, neu: { beat: runde(a * w), laenge: runde((b - a + 1) * w), ton, vel: VEL_VORGABE } };
};
export function langeNoteBefehle(clip, art, ton, q0, q1, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  if (!Number.isInteger(ton)) fehler('a pitch row is expected');
  const r = langeNote(clip, art, ton, q0, q1, aufl);
  return alsBefehle(clip, r.weg, r.kuerzen, [r.neu]);
}
// CHORD: the chord on the pitch of the row (thirds of the key, a minor triad without a key) over the cells q0..q1, one history step.
export function akkordBefehle(clip, art, ton, q0, q1, tonart = null, aufl = SCHRITTE_TAKT, anzahl = 3) {
  if (!clip) fehler('the pattern has no clip yet');
  if (!Number.isInteger(ton)) fehler('a pitch row is expected');
  const weg = [], kuerzen = [], neu = [];
  for (const t of akkord(ton, tonartOk(tonart) ? tonart : null, anzahl)) {
    const r = langeNote(clip, art, t, q0, q1, aufl);
    weg.push(...r.weg); kuerzen.push(...r.kuerzen); neu.push(r.neu);
  }
  return alsBefehle(clip, weg, kuerzen, neu);
}

// ---------- move (note grid, 2026-11-17) ----------
// Dragging a note: the notes that start in the targets move by `dSchritt` cells of the view and `dTon` semitones, all by the same amount. The shift is
// cut so that every note stays inside the pattern and inside 0..127. A note that does not move and starts where a moved one lands (same row, same cell) is
// deleted. -> { befehle, auswahl: the targets after the move, zellen: [{ ton, quelle, laenge }] the cells the moved notes cover (for the preview) }
export function schiebeNotenBefehle(clip, art, ziele, dSchritt, dTon, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  const w = weite(aufl), Z = periodeZellen(musterSchritte(clip) * SCHRITT, aufl);
  const noten = new Map();
  for (const z of ziele) for (const n of notenAn(clip, z, art, aufl)) noten.set(n.id, n);
  const liste = [...noten.values()];
  if (!liste.length) return { befehle: [], auswahl: [], zellen: [] };
  const kopf = (n) => Math.floor(n.beat / w + EPS);
  const dS = klemme(dSchritt, -Math.min(...liste.map(kopf)), Z - 1 - Math.max(...liste.map(kopf)));
  const dT = klemme(dTon, -Math.min(...liste.map((n) => n.ton)), 127 - Math.max(...liste.map((n) => n.ton)));
  const zellen = liste.map((n) => ({ ton: n.ton + dT, quelle: kopf(n) + dS, laenge: Math.min(Math.max(1, Math.round(n.laenge / w)), Z - kopf(n) - dS) }));
  const auswahl = einmalig(zellen.map((z) => ({ ton: z.ton, quelle: z.quelle })));
  if (dS === 0 && dT === 0) return { befehle: [], auswahl, zellen };
  const aend = liste.map((n) => ({ id: n.id, ...(dS ? { beat: runde(n.beat + dS * w) } : {}), ...(dT ? { ton: n.ton + dT } : {}) }));
  const landet = new Set(auswahl.map(schluessel));
  const weg = (clip.noten ?? []).filter((n) => !noten.has(n.id) && landet.has(`${n.ton}:${kopf(n)}`)).map((n) => n.id);
  return { befehle: alsBefehle(clip, weg, aend, []), auswahl, zellen };
}

// ---------- transformations of the selection (note grid) ----------
// The notes a transformation works on: the notes of the selected steps; without a selection every note of the pattern.
export function wirkNoten(clip, art, auswahl, aufl = SCHRITTE_TAKT) {
  if (!auswahl.length) { const ende = musterSchritte(clip) * SCHRITT; return (clip?.noten ?? []).filter((n) => n.beat < ende - EPS); }
  const aus = new Map();
  for (const z of auswahl) for (const n of notenAn(clip, z, art, aufl)) aus.set(n.id, n);
  return [...aus.values()];
}
// A list of pitch changes [{ id, ton }] as one noten_aendern, and the selection after it: every selected step follows its note to the new row.
function tonErgebnis(clip, art, auswahl, aend, aufl) {
  const neuTon = new Map(aend.map((x) => [x.id, x.ton]));
  const neueAuswahl = einmalig(auswahl.flatMap((z) => {
    const ns = notenAn(clip, z, art, aufl);
    return ns.length ? ns.map((n) => ({ ton: neuTon.get(n.id) ?? n.ton, quelle: z.quelle })) : [z];
  }));
  return { befehle: aend.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aend }] : [], auswahl: neueAuswahl };
}
// `was`: 'halb' (semitones `n`), 'stufe' (steps of the key `n`), 'umkehr' (inversion, `n` > 0 up), 'tonart' (snap to the key). -> { befehle, auswahl }
export function formeBefehle(clip, art, auswahl, was, n, tonart = null, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  const noten = wirkNoten(clip, art, auswahl, aufl), key = tonartOk(tonart) ? tonart : null;
  if ((was === 'stufe' || was === 'tonart') && !key) fehler('set a key first (KEY in the head of the grid)');
  const aend = was === 'halb' ? transponiere(noten, n) : was === 'stufe' ? transponiereStufen(noten, key, n)
    : was === 'umkehr' ? umkehrung(noten, n) : was === 'tonart' ? inTonart(noten, key) : fehler(`unknown transformation ${was}`, 'argument_unbekannt');
  return tonErgebnis(clip, art, auswahl, aend, aufl);
}
// ARP: every chord of the working notes becomes single steps of the view, one after the other for the length of the chord. -> { befehle, auswahl }
export function arpBefehle(clip, art, auswahl, modus = 'up', aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  if (!ARP_MODI.includes(modus)) fehler(`arpeggio takes ${ARP_MODI.join(', ')}`);
  const w = weite(aufl), ende = musterSchritte(clip) * SCHRITT;
  const r = arpeggio(wirkNoten(clip, art, auswahl, aufl), w, modus);
  const neu = r.neu.filter((n) => n.beat < ende - EPS);
  if (!r.loeschen.length) return { befehle: [], auswahl };
  return { befehle: alsBefehle(clip, r.loeschen, [], neu), auswahl: einmalig(neu.map((n) => ({ ton: n.ton, quelle: Math.floor(n.beat / w + EPS) }))) };
}
// FIND: the key that fits the notes of the pattern best, as the command that sets it and a sentence for the message line. No notes: null.
export function findeTonart(clip) {
  const ende = musterSchritte(clip) * SCHRITT;
  const erg = passendeTonarten((clip?.noten ?? []).filter((n) => n.beat < ende - EPS), 3);
  if (!erg.length) return null;
  const [beste, ...rest] = erg, name = (x) => tonartText({ grundton: x.grundton, skala: x.skala });
  const auch = rest.filter((x) => x.anteil >= beste.anteil - 1e-9).map(name);
  return {
    tonart: { grundton: beste.grundton, skala: beste.skala },
    befehl: { befehl: 'tonart_setzen', grundton: beste.grundton, skala: beste.skala },
    text: `Key set to ${name(beste)}: ${Math.round(beste.anteil * 100)} % of the notes fit${auch.length ? ` (fits as well: ${auch.join(', ')})` : ''}`,
  };
}

// ---------- duplicate ----------
// The selected notes once more behind the selection: the shift is the width of the selection (first to last step, all rows). A copy keeps every note field,
// lands only on a step that exists and has no note yet. `auswahl` is the new selection (the copied steps).
export function dupliziereBefehle(clip, art, auswahl, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  if (!auswahl.length) return { befehle: [], auswahl: [] };
  const qs = auswahl.map((z) => z.quelle), breite = Math.max(...qs) - Math.min(...qs) + 1;
  const neu = [], neueAuswahl = [], belegt = new Set();
  for (const z of auswahl) {
    const q = z.quelle + breite;
    if (q >= zeilenSchritte(clip, z.ton, art, aufl) || belegt.has(schluessel({ ton: z.ton, quelle: q }))) continue;
    belegt.add(schluessel({ ton: z.ton, quelle: q }));
    neueAuswahl.push({ ton: z.ton, quelle: q });
    if (notenAn(clip, { ton: z.ton, quelle: q }, art, aufl).length) continue;
    const w = weite(aufl), ende = zeilenBeats(clip, z.ton, art);
    for (const n of notenAn(clip, z, art, aufl)) {
      const { id, beat, ...rest } = n;
      // a slice hit in the last half cell of the pattern is drawn on cell 0 (the upbeat of the next pass): it moves from in front of the pattern end to in front of the target cell
      const vor = art === 'slice' && z.quelle === 0 && beat >= ende - w / 2 - EPS ? ende : 0;
      neu.push({ ...rest, beat: runde(beat - vor + breite * w) });
    }
  }
  return { befehle: neu.length ? [{ befehl: 'noten_neu', clip_id: clip.id, noten: neu }] : [], auswahl: neueAuswahl };
}

// ---------- values ----------
export function noteWert(n, feld, aufl = SCHRITTE_TAKT) {
  const f = WERT_FELDER[feld];
  if (feld === 'vel') return n.vel;
  if (feld === 'laenge') return klemme(Math.max(1, Math.round(n.laenge / weite(aufl))), f.min, f.max);   // in cells of the view
  return n[feld] ?? f.vorgabe;
}
// the stored form: the default is no field (null removes it)
const speicher = (feld, wert, aufl = SCHRITTE_TAKT) => {
  if (feld === 'laenge') return runde(wert * weite(aufl));
  if (feld === 'vel') return wert;
  return wert === WERT_FELDER[feld].vorgabe ? null : wert;
};
const wertAendern = (clip, werte, feld, aufl = SCHRITTE_TAKT) => {
  const aend = [];
  for (const { n, wert } of werte) if (noteWert(n, feld, aufl) !== wert) aend.push({ id: n.id, [feld]: speicher(feld, wert, aufl) });
  return aend.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aend }] : [];
};
const pruefeWertFeld = (feld) => { if (!WERT_FELDER[feld]) fehler(`value field: ${Object.keys(WERT_FELDER).join(', ')} is expected, not ${feld}`); };
// Dragging up and down: `dy` pixels (positive = down) move the value of every note in the targets by the same amount (SPANNE_PX = the whole range).
export function ziehWerte(clip, art, feld, ziele, dy, aufl = SCHRITTE_TAKT) {
  pruefeWertFeld(feld);
  const f = WERT_FELDER[feld], delta = Math.round(-dy / SPANNE_PX * (f.max - f.min));
  const aus = [], gesehen = new Set();
  for (const z of ziele) for (const n of notenAn(clip, z, art, aufl)) {
    if (gesehen.has(n.id)) continue;
    gesehen.add(n.id);
    aus.push({ n, ton: z.ton, quelle: z.quelle, wert: klemme(noteWert(n, feld, aufl) + delta, f.min, f.max) });
  }
  return aus;
}
export function ziehBefehle(clip, art, feld, ziele, dy, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  return wertAendern(clip, ziehWerte(clip, art, feld, ziele, dy, aufl), feld, aufl);
}
// A ramp along one row from step s0 (absolute) to step s1: the value of the first step to the value of the last (plus the vertical drag `dy` on the end),
// written to the notes that lie between. No note in the first step: the default starts it; none in the last: the start value ends it.
export function rampeWerte(clip, art, ton, feld, s0, s1, dy = 0, aufl = SCHRITTE_TAKT) {
  pruefeWertFeld(feld);
  if (s0 === s1) return [];
  const f = WERT_FELDER[feld];
  const wertBei = (s) => { const n = notenAn(clip, { ton, quelle: quelleVon(clip, ton, s, art, aufl) }, art, aufl)[0]; return n ? noteWert(n, feld, aufl) : null; };
  const v0 = wertBei(s0) ?? f.vorgabe;
  const v1 = klemme((wertBei(s1) ?? v0) + Math.round(-dy / SPANNE_PX * (f.max - f.min)), f.min, f.max);
  const aus = [], gesehen = new Set();
  for (let s = Math.min(s0, s1); s <= Math.max(s0, s1); s++) {
    const q = quelleVon(clip, ton, s, art, aufl);
    for (const n of notenAn(clip, { ton, quelle: q }, art, aufl)) {
      if (gesehen.has(n.id)) continue;
      gesehen.add(n.id);
      aus.push({ n, ton, quelle: q, wert: klemme(Math.round(v0 + (v1 - v0) * (s - s0) / (s1 - s0)), f.min, f.max) });
    }
  }
  return aus;
}
export function rampeBefehle(clip, art, ton, feld, s0, s1, dy = 0, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  return wertAendern(clip, rampeWerte(clip, art, ton, feld, s0, s1, dy, aufl), feld, aufl);
}

// ---------- keyboard ----------
// The cursor { ton, schritt } after an arrow key; `toene` = the rows top to bottom, `schritte` = the steps of the module. Other keys: unchanged.
export function cursorBewegung(cursor, taste, toene, schritte) {
  const i = Math.max(0, toene.indexOf(cursor.ton));
  switch (taste) {
    case 'ArrowLeft': return { ...cursor, schritt: Math.max(0, cursor.schritt - 1) };
    case 'ArrowRight': return { ...cursor, schritt: Math.min(schritte - 1, cursor.schritt + 1) };
    case 'ArrowUp': return { ...cursor, ton: toene[Math.max(0, i - 1)] ?? cursor.ton };
    case 'ArrowDown': return { ...cursor, ton: toene[Math.min(toene.length - 1, i + 1)] ?? cursor.ton };
    default: return cursor;
  }
}

// ---------- loop range ----------
// The loop range of the module: `gesetzt` while the project remembers the module length (werkbank.laenge_beats), then the project loop is the range.
export function bereichDaten(p) {
  const gesetzt = Number.isFinite(p?.werkbank?.laenge_beats);
  const modul = gesetzt ? p.werkbank.laenge_beats : p?.loop?.an === true ? p.loop.bis_beat : null;
  return { gesetzt, modul, von: gesetzt ? p.loop?.von_beat ?? 0 : 0, bis: gesetzt ? p.loop?.bis_beat ?? modul : modul };
}
// A drag over the ruler from step s0 to step s1 (absolute): whole beats, at least one, inside the module. A range that is the whole module clears it.
export function bereichBefehl(s0, s1, modulBeats, gesetzt = false, aufl = SCHRITTE_TAKT) {
  if (!(modulBeats >= 1)) return null;
  const zb = aufl / 4;   // cells per beat
  const von = Math.max(0, Math.floor(Math.min(s0, s1) / zb + EPS)), bis = Math.min(modulBeats, Math.floor(Math.max(s0, s1) / zb + EPS) + 1);
  if (bis - von < 1) return null;
  if (von === 0 && bis === modulBeats) return gesetzt ? { befehl: 'werkbank_bereich', aus: true } : null;
  return { befehl: 'werkbank_bereich', von_beat: von, bis_beat: bis };
}
export const bereichAusBefehl = () => ({ befehl: 'werkbank_bereich', aus: true });
export { SCHRITTE_TAKT };
