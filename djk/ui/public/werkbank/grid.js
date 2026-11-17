// Workbench: the pure grid model (stage 1, task 6). Browser and node, no DOM, no fetch.
// The grid shows one track's pattern over the module's bars at 4, 8 or 16 cells per bar (16 = one sixteenth = 0.25 beat; the model stays in sixteenths). This module holds the window over the module's bars, the counting
// rows, the row sets of a drum grid and a pitch grid, the cells and value lanes, and the project commands of a click, a value and a pattern length.
// Commands come from seq_logic.js; a gesture that cannot be written throws a SeqFehler. Nothing here talks to the server.
import { musterLaenge, reglerBasis, SeqFehler } from '../seq_logic.js';
import { tonName } from '../production/pianoroll.js';
import { inSkala, istGrundton, tonartOk } from '../harmonie.js';

export const SCHRITT = 0.25;                 // beats per step
export const SCHRITTE_TAKT = 16;             // steps per bar (the default resolution; the model stays in sixteenths)
export const AUFLOESUNGEN = [4, 8, 16];      // STEPS: cells per bar of the view
export const MAX_TAKTE = 128;                // the longest module
export const weite = (aufl = SCHRITTE_TAKT) => 4 / aufl;   // beats per cell
export const SICHTEN = [1, 2, 4];            // VIEW: bars shown at once
export const TON_MIN = 24;                   // C0
export const TON_MAX = 119;                  // B7
export const FENSTER = 24;                   // rows of a pitch grid (two octaves)
export const RAD = 2;                        // semitones per wheel notch
export const VEL_VORGABE = 100;
export const LAENGE_VORGABE = 1;             // steps
export const PITCH_MIN = -12;               // the PITCH lane of a slice grid: whole semitones of the device knob k3 (Pitch, -12..12)
export const PITCH_MAX = 12;
const RUECK = 64;                            // a slice grid: slice i plays on note i, reversed on note i + 64
const EPS = 1e-9;
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const runde = (x) => Math.round(x * 1e9) / 1e9;
const fehler = (text, grund = 'argument_ungueltig') => { throw new SeqFehler(grund, text); };
const noten = (clip) => clip?.noten ?? [];
const betontNr = (nr) => nr % 4 === 1;       // bars and steps 1, 5, 9, 13

// ---------- window (D9) ----------
// The window over the module's bars: never wider than the module, its start a multiple of its width, clamped to the module. Bars are 0-based.
export function fenster({ sicht, start, aufl } = {}, modulTakte) {
  const s = SICHTEN.includes(sicht) ? sicht : 4;
  const module = Math.max(1, Math.floor(modulTakte) || 1);
  const breite = Math.min(s, module);
  const a = klemme(Math.floor((Number.isFinite(start) ? start : 0) / breite) * breite, 0, module - breite);
  return { sicht: s, breite, start: a, aufl: AUFLOESUNGEN.includes(aufl) ? aufl : SCHRITTE_TAKT, takte: Array.from({ length: breite }, (_, i) => a + i) };
}
export const blaettere = (f, richtung, modulTakte) => fenster({ sicht: f.sicht, aufl: f.aufl, start: f.start + Math.sign(richtung) * f.breite }, modulTakte);
export const taktWahl = (f, takt, modulTakte) => fenster({ sicht: f.sicht, aufl: f.aufl, start: Math.floor(takt / f.breite) * f.breite }, modulTakte);
// The bar strip: one entry per module bar.
export const leiste = (modulTakte, f) => Array.from({ length: Math.max(1, Math.floor(modulTakte) || 1) }, (_, takt) => (
  { takt, nr: takt + 1, betont: betontNr(takt + 1), sichtbar: f.takte.includes(takt) }));
// The BAR row (`schritt` = the absolute first cell of the bar) and the STEP row of the window; a bar has `f.aufl` cells (default 16).
export function zaehlung(f) {
  const A = f.aufl ?? SCHRITTE_TAKT, [von, bis] = fensterSpanne(f);
  return {
    takte: f.takte.map((t) => ({ nr: t + 1, schritt: t * A, spanne: A })),
    schritte: Array.from({ length: bis - von }, (_, i) => ({ nr: (i % A) + 1, betont: betontNr((i % A) + 1) })),
  };
}
// The cells a window shows, [von, bis): its bars at the resolution of the view (cells per bar `f.aufl`, default 16).
export function fensterSpanne(f) {
  const A = f.aufl ?? SCHRITTE_TAKT;
  return [f.takte[0] * A, (f.takte[f.takte.length - 1] + 1) * A];
}

// ---------- rows (D8) ----------
// Drum rows: the sounds of the instrument info in their order, then every pitch the pattern holds that no sound names.
export function drumZeilen(clip, info) {
  const zeilen = (info?.klaenge ?? []).map((k) => ({ ton: k.ton, name: k.name }));
  const fremd = [...new Set(noten(clip).map((n) => n.ton))].filter((t) => !zeilen.some((z) => z.ton === t)).sort((a, b) => a - b);
  return [...zeilen, ...fremd.map((ton) => ({ ton, name: tonName(ton) }))];
}
// Slice rows (D11): the slices of the cut in order (note i = slice i, named i + 1), then every pitch below 64 the pattern holds that no slice names. A
// reversed hit (note i + 64) lives on the row of its slice.
export function sliceZeilen(clip, info) {
  const zeilen = (info?.klaenge ?? []).map((k) => ({ ton: k.ton, name: k.name }));
  const fremd = [...new Set(noten(clip).map((n) => n.ton))].filter((t) => t < RUECK && !zeilen.some((z) => z.ton === t)).sort((a, b) => a - b);
  return [...zeilen, ...fremd.map((ton) => ({ ton, name: tonName(ton) }))];
}
const schwarz = (t) => [1, 3, 6, 8, 10].includes(t % 12);
// Pitch rows, top row first: the window of 24 rows below `oben`, or with `fold` only the pitches the pattern uses (no notes: fold changes nothing).
// With a key (`tonart`, public/harmonie.js) every row says whether its pitch lies in the key (`inskala`) and whether it is the root (`grundton`).
// `nurSkala` (SCALE, needs a key): the window holds 24 pitches of the key below `oben`, plus every pitch between them that the pattern uses, so no note
// is hidden.
export function tonZeilen(oben, fold, clip, tonart = null, nurSkala = false) {
  const benutzt = [...new Set(noten(clip).map((n) => n.ton))];
  const key = tonartOk(tonart) ? tonart : null;
  let toene;
  if (fold && benutzt.length) toene = benutzt.sort((a, b) => b - a);
  else if (nurSkala && key) {
    toene = [];
    let zahl = 0;
    for (let t = Math.min(oben, 127); t >= 0 && zahl < FENSTER; t--) {
      if (inSkala(t, key)) { toene.push(t); zahl += 1; } else if (benutzt.includes(t)) toene.push(t);
    }
  } else toene = Array.from({ length: FENSTER }, (_, i) => oben - i).filter((t) => t >= 0 && t <= 127);
  return toene.map((ton) => ({ ton, name: tonName(ton), schwarz: schwarz(ton), c: ton % 12 === 0, ...(key ? { inskala: inSkala(ton, key), grundton: istGrundton(ton, key) } : {}) }));
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
// A pattern track is an instrument track with no clip or exactly one MIDI clip from beat 0 that is at least 64 beats long (a module of more than 16 bars
// grows its clip past the 64 beats of the SEQ deck).
const KLIPP_MIN = 64;
export function folgeEditierbar(spur) {
  const clips = spur?.clips ?? [];
  if (spur?.art !== 'instrument') return false;
  if (clips.length === 0) return true;
  const c = clips[0];
  return clips.length === 1 && c.art === 'midi' && Math.abs(c.start_beat) < EPS && c.laenge_beats >= KLIPP_MIN - EPS;
}
export function zustand(spur) {
  if (!folgeEditierbar(spur)) return 'gesperrt';
  return (spur.clips ?? []).length === 0 ? 'kein_clip' : 'muster';
}
export const musterTakte = (clip) => musterLaenge(clip) / 4;
export const zuLang = (clip, modulTakte) => musterLaenge(clip) > modulTakte * 4 + EPS;

export const musterSchritte = (clip) => Math.max(1, Math.round(musterLaenge(clip) / SCHRITT));
// The cells of a period of `beats` at the resolution `aufl` (cells per bar), and the source cell of an absolute cell: the cell the same beat has inside the period.
export const periodeZellen = (beats, aufl = SCHRITTE_TAKT) => Math.max(1, Math.ceil(beats / weite(aufl) - EPS));
export const musterZellen = (clip, aufl = SCHRITTE_TAKT) => periodeZellen(musterSchritte(clip) * SCHRITT, aufl);
export const quelleZelle = (beats, schritt, aufl = SCHRITTE_TAKT) => {
  const w = weite(aufl), b = runde(schritt * w);
  return Math.floor(runde(b - Math.floor(b / beats + EPS) * beats) / w + EPS);
};
// the notes that start in cell `quelle` of the resolution `aufl` (pitch `ton`, null = any), lowest first; in a slice grid a row holds `ton` and `ton + 64`.
// DRUM and NOTE grids take the notes that start in [cell, cell + 1). A slice grid takes a hit to its NEAREST cell, [cell - 1/2, cell + 1/2): hits sit a few
// milliseconds in front of their step (a cut at the hits, a rounded slice bound) and still belong to it. A hit in the last half cell of the pattern is the
// upbeat of the next pass and belongs to cell 0.
export const imSchritt = (clip, ton, quelle, art = null, aufl = SCHRITTE_TAKT) => {
  const slice = art === 'slice', w = weite(aufl);
  const von = quelle * w - (slice ? w / 2 : 0), bis = von + w, ende = musterSchritte(clip) * SCHRITT;
  const zeile = (n) => ton === null || ton === undefined || n.ton === ton || (slice && n.ton === ton + RUECK);
  const drin = (n) => (n.beat >= von - EPS && n.beat < bis - EPS) || (slice && quelle === 0 && n.beat >= ende - w / 2 - EPS && n.beat < ende - EPS);
  return noten(clip).filter((n) => zeile(n) && drin(n)).sort((a, b) => a.ton - b.ton);
};
const schrittLaenge = (n, w) => Math.max(1, Math.round(n.laenge / w));
// every visible cell of the window: `schritt` absolute in the module, `quelle` the pattern cell it repeats (the pattern repeats inside a longer module as pale
// cells). With `art` 'slice' a cell also says whether its hit is reversed (`rueck`); the other kinds have no such key. `laenge` is in cells.
export function zellen(clip, ton, f, art = null) {
  // a row with its own length (clip.zeilen[ton].schritte, in sixteenths) repeats after that long instead of the pattern length; its last cell carries `ende`
  const aufl = f.aufl ?? SCHRITTE_TAKT, w = weite(aufl);
  const eigeneL = ton === null || ton === undefined ? null : clip?.zeilen?.[ton]?.schritte ?? null;
  const Pb = eigeneL !== null ? eigeneL * SCHRITT : musterSchritte(clip) * SCHRITT, Z = periodeZellen(Pb, aufl), aus = [], slice = art === 'slice';
  const decke = art === 'note' ? deckung(clip, ton, Z, aufl) : null;
  for (let [schritt, bis] = fensterSpanne(f); schritt < bis; schritt++) {
    const quelle = quelleZelle(Pb, schritt, aufl), n = imSchritt(clip, ton, quelle, art, aufl)[0];
    const extra = {};
    if (decke?.has(quelle)) { const d = decke.get(quelle); if (!n) { extra.fort = true; extra.kopf = d.kopf; } if (d.letzte) extra.griff = true; }
    if (n?.chance != null) extra.chance = n.chance;
    if (n?.wdh != null) extra.wdh = n.wdh;
    if (n?.versatz != null) extra.versatz = n.versatz;
    if (eigeneL !== null && quelle === Z - 1) extra.ende = true;
    aus.push({ schritt, quelle, an: !!n, vel: n ? n.vel : null, laenge: n ? schrittLaenge(n, w) : null, wiederholung: runde(schritt * w) >= Pb - EPS, ...(slice ? { rueck: !!n && n.ton >= RUECK } : {}), ...extra });
  }
  return aus;
}
// Note grid: which cells of a row a note sounds through. cell -> { kopf: the cell the note starts in, letzte: true on the last cell of the note }. A note
// ends at the end of the row's period (`Z` cells) at the latest; where two notes overlap the later one owns the cell.
export function deckung(clip, ton, Z, aufl = SCHRITTE_TAKT) {
  const w = weite(aufl), aus = new Map();
  const zeile = noten(clip).filter((n) => n.ton === ton && n.beat < Z * w - EPS).sort((a, b) => a.beat - b.beat);
  for (const n of zeile) {
    const kopf = Math.floor(n.beat / w + EPS), len = Math.min(schrittLaenge(n, w), Z - kopf);
    for (let j = 0; j < len; j++) aus.set(kopf + j, { kopf, letzte: j === len - 1 });
  }
  return aus;
}
const WERT_FELDER = ['vel', 'laenge', 'rueck'];
const pruefeFeld = (feld, art) => {
  if (!WERT_FELDER.includes(feld) || (feld === 'rueck' && art !== 'slice')) {
    fehler(`value field: ${art === 'slice' ? 'vel, laenge or rueck' : 'vel or laenge'} is expected, not ${feld}`);
  }
};
// the value lane under the grid: `feld` 'vel' or 'laenge' (in steps), in a slice grid also 'rueck' (1 = reversed); `anders` = differs from the default
export function wertZellen(clip, ton, f, feld, art = null) {
  pruefeFeld(feld, art);
  const vorgabe = feld === 'vel' ? VEL_VORGABE : feld === 'laenge' ? LAENGE_VORGABE : 0;
  return zellen(clip, ton, f, art).map((z) => {
    const wert = !z.an ? null : feld === 'rueck' ? (z.rueck ? 1 : 0) : z[feld];
    return { schritt: z.schritt, quelle: z.quelle, da: z.an, wert, anders: z.an && wert !== vorgabe, wiederholung: z.wiederholung };
  });
}

// ---------- commands ----------
// A click on a step. The step is read as a trigger lane of the row's pitch (synthetic, so no stored lane is needed). drum: toggles; note: an empty step
// writes a one-step note, a full one is deleted.
// slice: an empty step writes a hit of the slice's length (whole steps, 1..16, D11), a step with hits deletes every hit of the row that starts in it, forward or reversed.
export function klickBefehle(spur, clip, ton, quelle, art, info = null, aufl = SCHRITTE_TAKT) {
  if (zustand(spur) === 'gesperrt') fehler('this track is not a pattern, it can only be edited in PRODUCTION', 'nicht_editierbar');
  if (!clip) fehler('the pattern has no clip yet');
  if (!Number.isInteger(ton)) fehler('a pitch row is expected');
  if (art === 'slice') {
    if (!Number.isInteger(quelle) || quelle < 0 || quelle >= musterZellen(clip, aufl)) fehler(`step ${quelle}: the pattern has ${musterZellen(clip, aufl)} steps`);
    const drin = imSchritt(clip, ton, quelle, 'slice', aufl);
    if (drin.length) return [{ befehl: 'noten_loeschen', clip_id: clip.id, ids: drin.map((n) => n.id) }];
    const beats = info?.schnitt?.laengen_beats?.[ton];
    const schritte = Number.isFinite(beats) ? klemme(Math.round(beats / SCHRITT), 1, 16) : 1;
    return [{ befehl: 'noten_neu', clip_id: clip.id, noten: [{ beat: runde(quelle * weite(aufl)), laenge: runde(schritte * SCHRITT), ton, vel: VEL_VORGABE }] }];
  }
  // drum and note grids: a cell is on when a note of the row starts inside it; a click turns it off (every note that starts in it goes) or writes one note
  // on the start of the cell (drum: an eighth of a beat as the 909 takes it, note grid: the length of one cell)
  const n = musterZellen(clip, aufl);
  if (!Number.isInteger(quelle) || quelle < 0 || quelle >= n) fehler(`lane t${ton}, cell ${quelle}: the lane has ${n} cells`);
  const drin = imSchritt(clip, ton, quelle, null, aufl);
  if (drin.length) return [{ befehl: 'noten_loeschen', clip_id: clip.id, ids: drin.map((x) => x.id) }];
  return [{ befehl: 'noten_neu', clip_id: clip.id, noten: [{ beat: runde(quelle * weite(aufl)), laenge: art === 'drum' ? 0.125 : weite(aufl), ton, vel: VEL_VORGABE }] }];
}
// A value for the notes that start in pattern step `quelle` (pitch `ton`, null = every pitch): one noten_aendern. vel: whole 1..127; laenge: whole steps
// 1..16, written as beats. A note that already has the value is left out (then the list is empty).
// Slice grid (`art` 'slice'): a row is `ton` and `ton + 64`; feld 'rueck' takes 1 (reversed) or 0 (forward) and writes the pitch change of the hits that are not so yet.
export function wertBefehle(clip, ton, quelle, feld, wert, art = null, aufl = SCHRITTE_TAKT) {
  pruefeFeld(feld, art);
  if (!clip) fehler('the pattern has no clip yet');
  if (!Number.isInteger(quelle) || quelle < 0 || quelle >= musterZellen(clip, aufl)) fehler(`step ${quelle}: the pattern has ${musterZellen(clip, aufl)} steps`);
  if (feld === 'rueck') {
    if (wert !== 0 && wert !== 1) fehler('reverse takes 0 (forward) or 1 (reversed)');
    const hits = imSchritt(clip, ton, quelle, art, aufl);
    if (!hits.length) fehler(`step ${quelle + 1}: no note starts in this step`);
    const aend = hits.filter((n) => (n.ton >= RUECK) !== (wert === 1)).map((n) => ({ id: n.id, ton: wert === 1 ? n.ton + RUECK : n.ton - RUECK }));
    return aend.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aend }] : [];
  }
  const [min, max, name] = feld === 'vel' ? [1, 127, 'velocity'] : [1, 16, 'length'];
  if (!Number.isInteger(wert) || wert < min || wert > max) fehler(`${name} takes whole numbers ${min}..${max}${feld === 'laenge' ? ' (steps)' : ''}`);
  const drin = imSchritt(clip, ton, quelle, art, aufl);
  if (!drin.length) fehler(`step ${quelle + 1}: no note starts in this step`);
  const neu = feld === 'vel' ? wert : runde(wert * weite(aufl));
  const aend = drin.filter((n) => n[feld] !== neu).map((n) => ({ id: n.id, [feld]: neu }));
  return aend.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aend }] : [];
}
// REVERSE on a step of a slice grid: the hits of the row that start in it all become reversed, or all forward when they all are reversed already (one noten_aendern;
// a step without a hit refuses).
export function rueckBefehle(clip, ton, quelle, aufl = SCHRITTE_TAKT) {
  if (!clip) fehler('the pattern has no clip yet');
  const drin = imSchritt(clip, ton, quelle, 'slice', aufl);
  if (!drin.length) fehler(`step ${quelle + 1}: no note starts in this step`);
  return wertBefehle(clip, ton, quelle, 'rueck', drin.every((n) => n.ton >= RUECK) ? 0 : 1, 'slice', aufl);
}
// ---------- PITCH lane of a slice grid (A2 E9, step lock) ----------
// A step lane over all rows (not one row) on the envelope of the device knob k3 (Pitch), a STEP LOCK: a value on step s holds for the hits of step s only,
// every other step plays the track knob (offset 0). The window of a step is the one of the slice grid, [s - 1/2, s + 1/2) steps (a hit sits a little in
// front of its step), and the core evaluates the lane at the beat of each note. A value is whole semitones -12..12, absolute at write time (knob position
// (s + 12) / 24); the envelope stores it as an offset from the track knob (like seq_logic.js). A step is "its own" when the envelope at the beat of the
// step carries an offset other than 0, so a value equal to the track knob is no value. The lane is rebuilt from the set of own steps after every change
// (`pitchPunkte`). The value of step s is read as the value of the envelope at beat s * SCHRITT, which is how a drawn envelope reads too.
const PITCH_ZIEL = 'geraet.k3';
const OFFSET_EPS = 1e-6;
const halbVon = (knopf) => Math.round(PITCH_MIN + knopf * (PITCH_MAX - PITCH_MIN)) + 0;   // + 0: no -0
// value of a point list at a beat as the model reads it (project/lane.ts laneWert, as seq_logic.js wertBei): before the first point the first value holds
function kurveWert(punkte, beat) {
  const n = punkte.length;
  if (n === 0) return 0;
  if (!(beat >= punkte[0].beat)) return punkte[0].wert;
  let i = 0;
  while (i + 1 < n && punkte[i + 1].beat <= beat) i += 1;
  const a = punkte[i];
  if (i === n - 1 || beat === a.beat) return a.wert;
  const b = punkte[i + 1], form = b.form ?? 'linear';
  if (form === 'sprung') return a.wert;
  const u = (beat - a.beat) / (b.beat - a.beat);
  return a.wert + (b.wert - a.wert) * (form === 's' ? u * u * (3 - 2 * u) : u);
}
// The envelope on k3, its step count (the loop of the envelope in steps), the offset of every step { step -> offset } (0 where it has none) and the own
// steps { step -> offset }.
const pitchEigene = (clip) => eigeneVon(clip, PITCH_ZIEL);
function eigeneVon(clip, ziel) {
  const hk = (clip?.huellkurven ?? []).find((h) => h.ziel === ziel) ?? null;
  const laenge = hk && hk.verknuepft === false ? hk.loop_beats : musterLaenge(clip);
  const n = Math.max(1, Math.ceil(laenge / SCHRITT - EPS)), eigen = new Map(), versatz = [];
  const punkte = [...(hk?.punkte ?? [])].sort((a, b) => a.beat - b.beat);
  for (let s = 0; s < n; s++) {
    const w = runde(kurveWert(punkte, s * SCHRITT));
    versatz.push(w);
    if (Math.abs(w) > OFFSET_EPS) eigen.set(s, w);
  }
  return { hk, n, eigen, versatz };
}
// The point list of a set of own steps ({ step -> offset }, not empty) over `n` steps: the value of step 0 at beat 0, then at each border half a step
// before step j (beat (j - 1/2) * SCHRITT) a `sprung` point with the value of step j wherever it differs from step j - 1 (a step without a value of its
// own has offset 0), and at the last border (n - 1/2) * SCHRITT the value of step 0 again when it differs from step n - 1 (the upbeat of the next pass).
// The first point has no `form` (no segment before it), as in wertBefehle.
export function pitchPunkte(eigen, n) {
  const wert = (s) => eigen.get(s) ?? 0;
  const anders = (a, b) => Math.abs(a - b) > OFFSET_EPS;
  const punkte = [{ beat: 0, wert: wert(0) }];
  for (let j = 1; j < n; j++) if (anders(wert(j), wert(j - 1))) punkte.push({ beat: runde((j - 0.5) * SCHRITT), wert: wert(j), form: 'sprung' });
  if (n > 1 && anders(wert(0), wert(n - 1))) punkte.push({ beat: runde((n - 0.5) * SCHRITT), wert: wert(0), form: 'sprung' });
  return punkte;
}
// Every visible step of the window with the semitones the hit of that step plays (track knob plus the envelope at the step beat, as the engine adds them
// and clamps to the knob) and whether the step is its own (offset other than 0). `quelle` is the pattern step the step repeats, `wiederholung` says it is a repeat.
export function pitchZellen(spur, clip, f, info) {
  const P = musterSchritte(clip);
  const basis = klemme(reglerBasis(spur, 3, info), 0, 1);
  const { n, eigen, versatz } = pitchEigene(clip);
  const aus = [];
  for (let [schritt, bis] = fensterSpanne(f); schritt < bis; schritt++) {
    const quelle = schritt % P, s = quelle % n;
    aus.push({ schritt, quelle, halb: halbVon(klemme(runde(basis + versatz[s]), 0, 1)), eigen: eigen.has(s), wiederholung: schritt >= P });
  }
  return aus;
}
// Write `halb` (a whole number -12..12) on pattern step `quelle`, or remove the step's own value with null (the track knob's own value is no value of the
// step either). No change (nothing to remove, the same value again): an empty list. Otherwise one huellkurve_setzen with the whole point list of
// `pitchPunkte` in the format of seq_logic.js (`verknuepft`, `loop_beats` of an envelope with a length of its own are kept), or huellkurve_loeschen when
// no own step is left. A value outside the range or not whole is a SeqFehler, nothing is clamped.
export function pitchBefehle(spur, clip, quelle, halb, info) {
  if (halb !== null && (!Number.isInteger(halb) || halb < PITCH_MIN || halb > PITCH_MAX)) fehler(`pitch takes whole semitones ${PITCH_MIN}..${PITCH_MAX}`);
  if (!clip) fehler('the pattern has no clip yet');
  const { hk, n, eigen } = pitchEigene(clip);
  if (!Number.isInteger(quelle) || quelle < 0 || quelle >= n) fehler(`step ${quelle}: the pattern has ${n} steps`);
  const versatz = halb === null ? 0 : runde((halb - PITCH_MIN) / (PITCH_MAX - PITCH_MIN) - reglerBasis(spur, 3, info));
  const neuEigen = Math.abs(versatz) > OFFSET_EPS ? versatz : null, alt = eigen.get(quelle) ?? null;
  if (neuEigen === null ? alt === null : alt !== null && Math.abs(alt - neuEigen) <= OFFSET_EPS) return [];
  const neu = new Map(eigen);
  if (neuEigen === null) neu.delete(quelle); else neu.set(quelle, neuEigen);
  if (!neu.size) return hk ? [{ befehl: 'huellkurve_loeschen', clip_id: clip.id, ziel: PITCH_ZIEL }] : [];
  return [{ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel: PITCH_ZIEL, punkte: pitchPunkte(neu, n), ...(hk?.verknuepft === false ? { verknuepft: false, loop_beats: hk.loop_beats } : {}) }];
}

// ---------- knob lanes (2026-11-16): any knob of a Baukasten device as a step lane ----------
// The same storage as PITCH: an envelope on `geraet.k<nr>` that holds an offset from the track knob per step, 0 where the step plays the knob. A knob that
// is not latched moves when the lane says so, so the value of step j starts at the beat of the step (PITCH jumps half a step earlier, because its knob is
// read at the note and a hit may sit a little in front of its step). Shown and written values are the absolute knob position 0..1.
export const knopfZiel = (nr) => `geraet.k${nr}`;
// The knob numbers that have a lane in the clip, ascending. `ohne` leaves numbers out (the slice grid shows k3 as PITCH).
export function knopfSpuren(clip, ohne = []) {
  const aus = [];
  for (const h of clip?.huellkurven ?? []) {
    const m = /^geraet\.k(\d+)$/.exec(h.ziel ?? '');
    if (m && !ohne.includes(Number(m[1]))) aus.push(Number(m[1]));
  }
  return [...new Set(aus)].sort((a, b) => a - b);
}
export function knopfPunkte(eigen, n) {
  const wert = (s) => eigen.get(s) ?? 0;
  const punkte = [{ beat: 0, wert: wert(0) }];
  for (let j = 1; j < n; j++) if (Math.abs(wert(j) - wert(j - 1)) > OFFSET_EPS) punkte.push({ beat: runde(j * SCHRITT), wert: wert(j), form: 'sprung' });
  return punkte;
}
// Every visible step with the knob position it plays (0..1) and whether the value is the step's own.
export function knopfZellen(spur, clip, f, info, nr) {
  const P = musterSchritte(clip);
  const basis = klemme(reglerBasis(spur, nr, info), 0, 1);
  const { n, eigen, versatz } = eigeneVon(clip, knopfZiel(nr));
  const aus = [];
  for (let [schritt, bis] = fensterSpanne(f); schritt < bis; schritt++) {
    const quelle = schritt % P, s = quelle % n;
    aus.push({ schritt, quelle, wert: klemme(runde(basis + versatz[s]), 0, 1), eigen: eigen.has(s), wiederholung: schritt >= P });
  }
  return aus;
}
// Write the knob position `wert` (0..1) on pattern step `quelle`, or remove the step's own value with null. No change: an empty list. The last own step
// removed deletes the envelope.
export function knopfBefehle(spur, clip, quelle, wert, info, nr) {
  if (wert !== null && !(typeof wert === 'number' && wert >= 0 && wert <= 1)) fehler('a knob lane takes values 0..1');
  if (!clip) fehler('the pattern has no clip yet');
  const ziel = knopfZiel(nr);
  const { hk, n, eigen } = eigeneVon(clip, ziel);
  if (!Number.isInteger(quelle) || quelle < 0 || quelle >= n) fehler(`step ${quelle}: the pattern has ${n} steps`);
  const versatz = wert === null ? 0 : runde(wert - klemme(reglerBasis(spur, nr, info), 0, 1));
  const neuEigen = Math.abs(versatz) > OFFSET_EPS ? versatz : null, alt = eigen.get(quelle) ?? null;
  if (neuEigen === null ? alt === null : alt !== null && Math.abs(alt - neuEigen) <= OFFSET_EPS) return [];
  const neu = new Map(eigen);
  if (neuEigen === null) neu.delete(quelle); else neu.set(quelle, neuEigen);
  if (!neu.size) return hk ? [{ befehl: 'huellkurve_loeschen', clip_id: clip.id, ziel }] : [];
  return [{ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel, punkte: knopfPunkte(neu, n), ...(hk?.verknuepft === false ? { verknuepft: false, loop_beats: hk.loop_beats } : {}) }];
}
