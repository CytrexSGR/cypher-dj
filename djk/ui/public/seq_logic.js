// SEQ deck v2 (spec docs/superpowers/specs/2026-11-14-seq-deck-design.md, sections 3, 4, 6, 7): the pure lane logic. Browser and node, no DOM, no fetch.
// A pattern is an instrument track with one MIDI clip; a lane is a VIEW on its notes and clip envelopes (clip.seq = the view descriptor).
// This module turns a clip into cells and a gesture into a list of project commands. The page and the text of the hand both use it.
// Commands are plain objects of the project model (project/commands.ts): noten_neu, noten_aendern, noten_loeschen, huellkurve_setzen,
// huellkurve_loeschen, clip_neu, clip_aendern (with the field `seq`). A new note has no id (the server assigns it).
// A gesture that cannot be written throws a SeqFehler { grund, message } that names lane and cell; nothing is clamped silently.
import { tonName } from './production/pianoroll.js';

export const TEILER = [1, 0.5, 0.25, 0.125];
export const MAX_ZEILEN = 32;                        // spec 4: at most thirty-two lanes in a stored view descriptor
const ID_MUSTER = /^[a-z][a-z0-9]{0,7}$/;
const EPS = 1e-9;
const LOOP_MIN = 1 / 16;                             // LOOP_MIN of project/model.ts
const KLIPP_BEATS = 64;                              // spec 4: a pattern clip is 64 beats long (the live region)
const VORGABE_LAENGE = 4;                            // spec 4: the first edit creates a clip with loop_beats 4
const VORGABE_TON = 48;                              // a new note of a pitched lane that came without a pitch
const VEL_VORGABE = 100;                             // spec 4: the grid writes velocity 100
const FORMEN = ['linear', 's', 'sprung'];            // AUTO_FORMEN of project/model.ts
const RB_REGLER = ['lautstaerke', 'cutoff', 'resonanz', 'env_mod'];   // RB_ZIELE of project/model.ts
const BK_REGLER_MAX = 64;                            // BK_ZIELE of project/model.ts (k1..k64)

const runde = (x, f = 1e9) => { const r = Math.round(x * f) / f; return r === 0 ? 0 : r; };   // no -0
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const zahlOk = (x) => typeof x === 'number' && Number.isFinite(x);

export class SeqFehler extends Error {
  constructor(grund, text) { super(text); this.name = 'SeqFehler'; this.grund = grund; }
}
const fehler = (text, grund = 'argument_ungueltig') => { throw new SeqFehler(grund, text); };
const wo = (zeile, zelle) => `lane ${zeile?.id ?? '?'}${zelle === undefined ? '' : `, cell ${zelle}`}`;

// ---------- targets and ranges ----------
// HK_BEREICH of project/envelope.ts (stored range of an envelope; a device target stores an offset around the knob)
export function speicherBereich(ziel) {
  if (ziel === 'gain') return { min: -200, max: 0 };
  if (ziel === 'transpose') return { min: -48, max: 48 };
  if (ziel === 'spur_fader') return { min: -60, max: 6 };
  if (ziel === 'spur_pan') return { min: -2, max: 2 };
  return { min: -1, max: 1 };
}
// geraet.k3 -> 3, geraet.cutoff -> 'cutoff', anything else -> null (not a device target)
export function reglerSchluessel(ziel) {
  if (typeof ziel !== 'string') return null;
  const k = /^geraet\.k([1-9][0-9]?)$/.exec(ziel);
  if (k) return Number(k[1]) <= BK_REGLER_MAX ? Number(k[1]) : null;
  const r = /^geraet\.([a-z_]+)$/.exec(ziel);
  return r && RB_REGLER.includes(r[1]) ? r[1] : null;
}
export const reglerZiel = (nr) => `geraet.${typeof nr === 'number' ? `k${nr}` : nr}`;
const istGeraetZiel = (ziel) => reglerSchluessel(ziel) !== null;
// the range a lane shows: a device target is shown absolute on 0..1, vel 1..127, the other targets in their own range
export function anzeigeBereich(ziel) {
  if (ziel === 'vel') return { min: 1, max: 127 };
  if (istGeraetZiel(ziel)) return { min: 0, max: 1 };
  return speicherBereich(ziel);
}
export function geraetArt(spur, info) {
  const g = spur?.geraet;
  if (g?.art === 'intern') { if (g.name === 'bk') return 'bk'; if (g.name === 'kit') return 'kit'; if (g.name === 'rb338') return 'rb338'; }
  return info?.art ?? 'anderes';
}
// which envelope targets the instrument takes: transpose, track level and pan always, the knobs by device
export function zielErlaubt(ziel, spur, info) {
  if (ziel === 'transpose' || ziel === 'spur_fader' || ziel === 'spur_pan') return true;
  const nr = reglerSchluessel(ziel);
  if (nr === null) return false;
  const art = geraetArt(spur, info);
  return typeof nr === 'number' ? art === 'bk' : art === 'rb338';
}
export function reglerBasis(spur, nr, info) {
  const schluessel = typeof nr === 'number' ? `k${nr}` : nr;
  const p = spur?.geraet?.parameter?.[schluessel];
  if (zahlOk(p)) return p;
  const r = (info?.regler ?? []).find((x) => x.nr === nr);
  return r && zahlOk(r.vorgabe) ? r.vorgabe : 0.5;
}
export function zielName(ziel, info) {
  if (ziel === 'vel') return 'velocity';
  if (ziel === 'laenge') return 'length';
  if (ziel === 'transpose') return 'transpose';
  if (ziel === 'spur_fader') return 'track level';
  if (ziel === 'spur_pan') return 'track pan';
  const nr = reglerSchluessel(ziel);
  if (nr === null) return String(ziel);
  return (info?.regler ?? []).find((x) => x.nr === nr)?.name ?? (typeof nr === 'number' ? `k${nr}` : nr);
}
// a knob target the instrument's knob list does not know (the knob lane stays, it moves nothing)
const keinRegler = (ziel, info) => { const nr = reglerSchluessel(ziel); return nr !== null && (info?.regler ?? []).length > 0 && !info.regler.some((r) => r.nr === nr); };
// shown value of a stored envelope value: a device target is base + offset (clamped to 0..1 for display, `roh` keeps the sum), the others as stored
function anzeige(spur, ziel, gespeichert, info) {
  const nr = reglerSchluessel(ziel);
  if (nr === null) return { wert: gespeichert, roh: gespeichert, geklemmt: false };
  const roh = runde(reglerBasis(spur, nr, info) + gespeichert);
  return { wert: klemme(roh, 0, 1), roh, geklemmt: roh < -EPS || roh > 1 + EPS };
}
// stored value of a shown value; refuses a value outside the shown range
function speichern(spur, ziel, gezeigt, info, ort) {
  const b = anzeigeBereich(ziel);
  if (!zahlOk(gezeigt) || gezeigt < b.min - EPS || gezeigt > b.max + EPS) fehler(`${ort}: ${zielName(ziel, info)} takes ${b.min}..${b.max}`);
  const nr = reglerSchluessel(ziel);
  return nr === null ? gezeigt : runde(gezeigt - reglerBasis(spur, nr, info));
}
// a shown value of one target as a fraction of its range and back (for re-assigning an envelope to another target)
const bruch = (ziel, gezeigt) => { const b = anzeigeBereich(ziel); return (gezeigt - b.min) / (b.max - b.min); };
const ausBruch = (ziel, f) => { const b = anzeigeBereich(ziel); return b.min + f * (b.max - b.min); };

// ---------- the clip as a pattern ----------
export const musterLaenge = (clip) => (clip ? clip.loop_beats ?? clip.laenge_beats : VORGABE_LAENGE);
const zellenAnzahl = (laenge, teiler) => Math.max(1, Math.ceil(laenge / teiler - EPS));
const zelleVon = (beat, teiler) => Math.floor(beat / teiler + EPS);
const huellkurveVon = (clip, ziel) => (clip?.huellkurven ?? []).find((h) => h.ziel === ziel) ?? null;
const huellkurveLaenge = (clip, hk) => (hk && hk.verknuepft === false ? hk.loop_beats : musterLaenge(clip));
const kopiePunkte = (p) => p.map((q) => ({ ...q }));

// value of a point list at a beat as the model reads it (project/lane.ts laneWert, plain interpolation): before the first point the first value holds
function wertBei(punkte, beat) {
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

// fingerprint of a point list: a short hash of fixed length (FNV-1a over the points, beat and value rounded to 1e-6, and their form); equal for equal
// points, different when one value moves. The descriptor stores it with a shape, so it must not grow with the number of points (zufall: up to 64 steps).
export function abdruck(punkte) {
  const f = { linear: 'l', s: 's', sprung: 'j' };
  const text = (punkte ?? []).map((p) => `${runde(p.beat, 1e6)}:${runde(p.wert, 1e6)}:${f[p.form ?? 'linear'] ?? '?'}`).join(' ');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ---------- lanes: the descriptor and what the data adds ----------
function reinZeile(z) {
  if (z.art === 'noten') return { id: z.id, art: 'noten', teiler: z.teiler, ...(z.ton !== undefined ? { ton: z.ton } : {}), ...(z.name !== undefined ? { name: z.name } : {}) };
  if (z.art === 'werte') return { id: z.id, art: 'werte', teiler: z.teiler, ziel: z.ziel, ...(z.von !== undefined ? { von: z.von } : {}) };
  if (z.art === 'kurve') return { id: z.id, art: 'kurve', ziel: z.ziel, ...(z.form ? { form: reinForm(z.form) } : {}) };
  return fehler(`${wo(z)}: art noten, werte or kurve expected`);
}
function reinForm(f) {
  const o = { art: f.art, von: f.von, bis: f.bis };
  for (const k of ['phase', 'saat', 'stufen']) if (f[k] !== undefined) o[k] = f[k];
  o.abdruck = f.abdruck;
  return o;
}
const ZIEL_ID = { 'geraet.lautstaerke': 'laut', 'geraet.env_mod': 'envmod', transpose: 'transp', spur_fader: 'fader', spur_pan: 'pan' };
function zielId(ziel) {
  if (ZIEL_ID[ziel]) return ZIEL_ID[ziel];
  const s = String(ziel).replace(/^geraet\./, '').replace(/[^a-z0-9]/g, '');
  return /^[a-z]/.test(s) ? s.slice(0, 8) : `z${s}`.slice(0, 8);
}
// [{ z: SeqZeile, abgeleitet }]: the descriptor's lanes, then the lanes the data needs (spec 4 "Derived lanes"): trigger lanes of a kit (or the pitched
// lane of another instrument) for notes no lane shows, a curve lane for every envelope without a lane. Music is never hidden.
// CONTRACT: the ids of derived lanes are part of the interface (the pattern text and the page name a lane by its id): a trigger lane of a kit is
// `t<note number>` (t36), the pitched lane of another instrument is `noten`, a curve lane carries the short name of its target (`zielId`: laut, envmod,
// transp, fader, pan, else the target without `geraet.`, e.g. k3, cutoff). A clash with an explicit id gets a counter (t362 style, `neueId`).
function zeilenMitHerkunft(spur, clip, info) {
  if (!clip) return [];
  const expl = clip.seq?.zeilen ?? [];
  const aus = expl.map((z) => ({ z, abgeleitet: false }));
  const belegt = new Set(expl.map((z) => z.id));
  const neueId = (id) => {
    let n = id, i = 2;
    while (belegt.has(n)) { n = id.slice(0, 8 - String(i).length) + i; i += 1; }
    belegt.add(n);
    return n;
  };
  const P = musterLaenge(clip);
  const beansprucht = new Set(expl.filter((z) => z.art === 'noten' && z.ton !== undefined).map((z) => z.ton));
  const hatTon = expl.some((z) => z.art === 'noten' && z.ton === undefined);
  const lose = (clip.noten ?? []).filter((n) => !beansprucht.has(n.ton) && n.beat < P - EPS);
  if (!hatTon && lose.length) {
    if (geraetArt(spur, info) === 'kit') {
      for (const ton of [...new Set(lose.map((n) => n.ton))].sort((a, b) => a - b)) aus.push({ z: { id: neueId(`t${ton}`), art: 'noten', teiler: 0.25, ton }, abgeleitet: true });
    } else aus.push({ z: { id: neueId('noten'), art: 'noten', teiler: 0.25 }, abgeleitet: true });
  }
  for (const hk of clip.huellkurven ?? []) {
    if (!expl.some((z) => z.art !== 'noten' && z.ziel === hk.ziel)) aus.push({ z: { id: neueId(zielId(hk.ziel)), art: 'kurve', ziel: hk.ziel }, abgeleitet: true });
  }
  return aus;          // never cut: the limit of 32 is that of the stored descriptor (pruefeZeilen), not of what the view shows
}
// SeqZeile[]: the descriptor's lanes plus the derived ones
export function abgeleiteteZeilen(spur, clip, info) { return zeilenMitHerkunft(spur, clip, info).map((x) => x.z); }
const alleZeilen = (spur, clip, info) => zeilenMitHerkunft(spur, clip, info).map((x) => x.z);

// the notes a note lane shows: a trigger lane the notes of its pitch, the pitched lane every note no trigger lane claims; notes behind the loop are not in a cell
function laneNoten(clip, z, eff) {
  const P = musterLaenge(clip);
  const beansprucht = new Set(eff.filter((x) => x.art === 'noten' && x.ton !== undefined).map((x) => x.ton));
  const sel = z.ton !== undefined ? (clip.noten ?? []).filter((n) => n.ton === z.ton) : (clip.noten ?? []).filter((n) => !beansprucht.has(n.ton));
  return sel.filter((n) => n.beat < P - EPS);
}
// the note lane a `vel`/`laenge` lane reads: `von`, else the only note lane
function quellZeile(eff, z) {
  const ns = eff.filter((x) => x.art === 'noten');
  if (z.von !== undefined) return ns.find((x) => x.id === z.von) ?? null;
  return ns.length === 1 ? ns[0] : null;
}
const nachBeat = (a, b) => a.beat - b.beat || a.ton - b.ton;

// cells of a note lane: { an, noten, vel, ton, versatz, zahl, gebunden }
function notenZellen(noten, teiler, laenge, gebundenZeigen) {
  const n = zellenAnzahl(laenge, teiler);
  const zellen = Array.from({ length: n }, () => ({ an: false, noten: [], vel: null, ton: null, versatz: 0, zahl: 0, gebunden: false }));
  for (const note of [...noten].sort(nachBeat)) zellen[Math.min(n - 1, zelleVon(note.beat, teiler))].noten.push(note);
  zellen.forEach((z, c) => {
    if (!z.noten.length) return;
    // a chord shows its lowest note (and a count); a trigger lane has one pitch, so this is its earliest hit
    const rep = z.noten.reduce((a, b) => (b.ton < a.ton ? b : a));
    z.an = true; z.zahl = z.noten.length; z.vel = rep.vel; z.ton = rep.ton; z.versatz = runde(rep.beat - c * teiler);
  });
  if (gebundenZeigen) {
    for (const note of noten) {
      const ende = note.beat + note.laenge, c0 = Math.min(n - 1, zelleVon(note.beat, teiler));
      for (let c = c0 + 1; c < n && c * teiler < ende - EPS; c++) if (!zellen[c].an) zellen[c].gebunden = true;
    }
  }
  return zellen;
}

// the view of a pattern: { laenge_beats, hinter_loop, zeilen: ZeileSicht[] }
export function folgeSicht(spur, clip, info) {
  const P = musterLaenge(clip);
  const hinter = clip ? (clip.noten ?? []).filter((n) => n.beat >= P - EPS).length : 0;
  const herkunft = zeilenMitHerkunft(spur, clip, info), eff = herkunft.map((x) => x.z);
  const zeilen = herkunft.map(({ z, abgeleitet }) => {
    if (z.art === 'noten') {
      const name = z.name ?? (z.ton !== undefined ? ((info?.klaenge ?? []).find((k) => k.ton === z.ton)?.name ?? tonName(z.ton)) : 'notes');
      return { ...z, abgeleitet, name, laenge_beats: P, eigen_laenge: false, zellen: notenZellen(laneNoten(clip, z, eff), z.teiler, P, z.ton === undefined) };
    }
    if (z.art === 'werte' && (z.ziel === 'vel' || z.ziel === 'laenge')) {
      const q = quellZeile(eff, z);
      const teiler = q ? q.teiler : z.teiler;            // spec 4: the lane uses the grid of its note lane
      const zz = q ? notenZellen(laneNoten(clip, q, eff), q.teiler, P, false) : Array.from({ length: zellenAnzahl(P, teiler) }, () => ({ an: false, noten: [] }));
      const zellen = zz.map((c) => {
        if (!c.an) return { da: false, wert: null, frei: false, geklemmt: false };
        return { da: true, wert: z.ziel === 'vel' ? c.vel : runde(c.noten.find((x) => x.ton === c.ton).laenge / teiler), frei: true, geklemmt: false };
      });
      return { ...z, teiler, abgeleitet, name: zielName(z.ziel, info), laenge_beats: P, eigen_laenge: false, bereich: anzeigeBereich(z.ziel), zellen };
    }
    // envelope lanes (werte on a target, kurve)
    const hk = huellkurveVon(clip, z.ziel), L = huellkurveLaenge(clip, hk) ?? P;
    const kopf = { ...z, abgeleitet, name: zielName(z.ziel, info), laenge_beats: L, eigen_laenge: !!hk && hk.verknuepft === false,
      bereich: anzeigeBereich(z.ziel), hat_huellkurve: !!hk,
      ...(keinRegler(z.ziel, info) ? { kein_regler: true } : {}) };
    if (z.art === 'kurve') {
      const punkte = (hk?.punkte ?? []).map((p) => { const a = anzeige(spur, z.ziel, p.wert, info); return { beat: p.beat, wert: a.wert, form: p.form ?? 'linear', geklemmt: a.geklemmt, ...(a.geklemmt ? { gespeichert: p.wert } : {}) }; });
      if (kopf.form && (!hk || abdruck(hk.punkte) !== kopf.form.abdruck)) delete kopf.form;     // spec 4: points no longer match: the shape is ignored
      return { ...kopf, punkte };
    }
    const n = zellenAnzahl(L, z.teiler), pk = hk?.punkte ?? [];
    const zellen = Array.from({ length: n }, (_, c) => {
      if (!hk) return { da: false, wert: null, frei: true, geklemmt: false };
      const von = c * z.teiler, bis = von + z.teiler;
      const drin = pk.filter((p) => p.beat >= von - EPS && p.beat < bis - EPS);
      // cell 0 without a point of its own shows the value over the seam (the last point: the loop comes back to it) and says so with `naht`; the text
      // writes that value and the writer takes it as "no point here, as the data say"
      const naht = c === 0 && drin.length === 0 && pk.length > 0;
      const a = anzeige(spur, z.ziel, drin.length ? drin[drin.length - 1].wert : naht ? pk[pk.length - 1].wert : wertBei(pk, von), info);
      return { da: drin.length > 0, wert: a.wert, frei: true, geklemmt: a.geklemmt, ...(naht ? { naht: true } : {}) };
    });
    return { ...kopf, zellen };
  });
  return { laenge_beats: P, hinter_loop: hinter, zeilen };
}

// ---------- commands ----------
const klippNeu = (spur, extra) => ({ befehl: 'clip_neu', spur_id: spur.id, art: 'midi', name: spur.name ?? 'Pattern', start_beat: 0, laenge_beats: KLIPP_BEATS, loop_beats: VORGABE_LAENGE, ...extra });
const seqBefehl = (clip, zeilen) => ({ befehl: 'clip_aendern', clip_id: clip.id, seq: zeilen.length ? { schema: 1, zeilen: zeilen.map(reinZeile) } : null });
const hkBefehl = (clip, hk, punkte) => ({ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel: hk.ziel, punkte,
  ...(hk.verknuepft === false ? { verknuepft: false, loop_beats: hk.loop_beats } : {}) });
const hkLoeschen = (clip, ziel) => ({ befehl: 'huellkurve_loeschen', clip_id: clip.id, ziel });
const pruefeZelle = (zeile, zelle, n) => {
  if (!Number.isInteger(zelle) || zelle < 0 || zelle >= n) fehler(`${wo(zeile, zelle)}: the lane has ${n} cells`);
};

// A note lane cell. felder {} toggles; { an } sets the state; { vel }, { ton } (pitched lane, absolute pitch of the lowest note), { laenge } (in cells of the
// lane grid) set a field of every note that starts in the cell, or write a note when the cell is empty. Touches no note outside the cell.
export function zelleBefehle(spur, clip, zeile, zelle, felder = {}) {
  if (zeile?.art !== 'noten') fehler(`${wo(zeile, zelle)}: a note lane is expected`);
  if (!TEILER.includes(zeile.teiler)) fehler(`${wo(zeile, zelle)}: grid ${zeile.teiler} is not one of ${TEILER.join(', ')}`);
  const P = musterLaenge(clip), n = zellenAnzahl(P, zeile.teiler);
  pruefeZelle(zeile, zelle, n);
  const trigger = zeile.ton !== undefined;
  if (trigger && felder.ton !== undefined) fehler(`${wo(zeile, zelle)}: a trigger lane has a fixed pitch`);
  for (const k of Object.keys(felder)) if (!['an', 'vel', 'ton', 'laenge'].includes(k)) fehler(`${wo(zeile, zelle)}: unknown field ${k}`, 'argument_unbekannt');
  if (felder.vel !== undefined && (!Number.isInteger(felder.vel) || felder.vel < 1 || felder.vel > 127)) fehler(`${wo(zeile, zelle)}: velocity takes whole numbers 1..127`);
  if (felder.ton !== undefined && (!Number.isInteger(felder.ton) || felder.ton < 0 || felder.ton > 127)) fehler(`${wo(zeile, zelle)}: pitch takes whole numbers 0..127`);
  if (felder.laenge !== undefined && (!zahlOk(felder.laenge) || felder.laenge <= 0)) fehler(`${wo(zeile, zelle)}: length takes a number of cells above 0`);

  const eff = alleZeilen(spur, clip, undefined);
  const fremd = eff.find((x) => x.art === 'noten' && x.ton !== undefined && x.ton === felder.ton && x.id !== zeile.id);
  if (!trigger && fremd) fehler(`${wo(zeile, zelle)}: note ${felder.ton} belongs to the trigger lane ${fremd.id}`);
  const start = zelle * zeile.teiler, ende = start + zeile.teiler;
  const drin = clip ? laneNoten(clip, zeile, eff).filter((x) => x.beat >= start - EPS && (zelle === n - 1 ? true : x.beat < ende - EPS)).sort(nachBeat) : [];
  const setzt = felder.vel !== undefined || felder.ton !== undefined || felder.laenge !== undefined;
  const an = felder.an ?? (setzt ? true : !drin.length);          // {} toggles
  if (!an) return drin.length ? [{ befehl: 'noten_loeschen', clip_id: clip.id, ids: drin.map((x) => x.id) }] : [];
  if (!drin.length) {
    const note = { beat: start, laenge: runde((felder.laenge ?? (trigger ? 0.5 : 1)) * zeile.teiler), ton: trigger ? zeile.ton : felder.ton ?? VORGABE_TON, vel: felder.vel ?? VEL_VORGABE };
    return [clip ? { befehl: 'noten_neu', clip_id: clip.id, noten: [note] }
      : klippNeu(spur, { noten: [note], seq: { schema: 1, zeilen: [reinZeile(zeile)] } })];
  }
  const delta = felder.ton !== undefined ? felder.ton - Math.min(...drin.map((x) => x.ton)) : 0;
  const aend = [];
  for (const x of drin) {
    const f = { id: x.id };
    if (felder.vel !== undefined && felder.vel !== x.vel) f.vel = felder.vel;
    if (delta !== 0) {
      if (x.ton + delta < 0 || x.ton + delta > 127) fehler(`${wo(zeile, zelle)}: the chord does not fit 0..127 after the move`);
      f.ton = x.ton + delta;
    }
    if (felder.laenge !== undefined) { const l = runde(felder.laenge * zeile.teiler); if (l !== x.laenge) f.laenge = l; }
    if (Object.keys(f).length > 1) aend.push(f);
  }
  return aend.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aend }] : [];
}

// Value of a cell. vel / laenge lanes set a field of the notes that start in the cell (a cell without a note refuses); an envelope lane writes a `sprung`
// point on the grid and sends the WHOLE envelope; wert null removes the point. Cell 0 always carries a point (seam rule, spec 4): when the edit leaves
// none there, one is written with the value of the last point. The last point removed is huellkurve_loeschen.
export function wertBefehle(spur, clip, zeile, zelle, wert, info) {
  if (zeile?.art !== 'werte') fehler(`${wo(zeile, zelle)}: a value lane is expected`);
  if (!clip) fehler(`${wo(zeile, zelle)}: the pattern has no clip yet`);
  const ort = wo(zeile, zelle);
  if (zeile.ziel === 'vel' || zeile.ziel === 'laenge') {
    const eff = alleZeilen(spur, clip, info), q = quellZeile(eff, zeile);
    if (!q) fehler(`${ort}: no note lane to read (name it with von)`);
    const P = musterLaenge(clip);
    pruefeZelle(zeile, zelle, zellenAnzahl(P, q.teiler));
    if (wert === null) fehler(`${ort}: a ${zielName(zeile.ziel)} cannot be removed, delete the note`);
    if (!zahlOk(wert)) fehler(`${ort}: a number is expected`);
    const von = zelle * q.teiler, bis = von + q.teiler, n = zellenAnzahl(P, q.teiler);
    const drin = laneNoten(clip, q, eff).filter((x) => x.beat >= von - EPS && (zelle === n - 1 || x.beat < bis - EPS));
    if (!drin.length) fehler(`${ort}: no note starts in this cell`);
    let feld, wertNeu;
    if (zeile.ziel === 'vel') {
      wertNeu = Math.round(wert);
      if (wertNeu < 1 || wertNeu > 127) fehler(`${ort}: velocity takes 1..127`);
      feld = 'vel';
    } else {
      wertNeu = runde(wert * q.teiler);
      if (!(wertNeu > 0)) fehler(`${ort}: length takes a number of cells above 0`);
      feld = 'laenge';
    }
    const aend = drin.filter((x) => x[feld] !== wertNeu).map((x) => ({ id: x.id, [feld]: wertNeu }));
    return aend.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten: aend }] : [];
  }
  // envelope target
  if (!TEILER.includes(zeile.teiler)) fehler(`${ort}: grid ${zeile.teiler} is not one of ${TEILER.join(', ')}`);
  const hk = huellkurveVon(clip, zeile.ziel), L = huellkurveLaenge(clip, hk) ?? musterLaenge(clip);
  const n = zellenAnzahl(L, zeile.teiler);
  pruefeZelle(zeile, zelle, n);
  const gespeichert = wert === null ? null : speichern(spur, zeile.ziel, wert, info, ort);
  const von = zelle * zeile.teiler, bis = von + zeile.teiler;
  const imZelle = (p) => p.beat >= von - EPS && p.beat < bis - EPS;
  const alt = hk ? kopiePunkte(hk.punkte) : [];
  const neu = alt.filter((p) => !imZelle(p));
  let eigener = null;
  if (gespeichert !== null) {
    eigener = { beat: von, wert: gespeichert, form: 'sprung' };
    const nach = neu.findIndex((p) => p.beat > von);
    neu.splice(nach < 0 ? neu.length : nach, 0, eigener);
  }
  if (!neu.length) return hk ? [hkLoeschen(clip, zeile.ziel)] : [];
  if (!neu.some((p) => p.beat < zeile.teiler - EPS)) neu.unshift({ beat: 0, wert: neu[neu.length - 1].wert });       // the seam point
  if (eigener && neu[0] === eigener) delete eigener.form;                                                           // a first point has no segment before it
  if (hk && abdruck(neu) === abdruck(hk.punkte)) return [];
  return [hkBefehl(clip, hk ?? { ziel: zeile.ziel }, neu)];
}

// A curve: the whole point list in shown values (a device target: absolute on the knob). An empty list removes the envelope. `form` (optional, without
// abdruck) is the shape that wrote the points: the descriptor then keeps it with the fingerprint of the stored points; without it a shape the lane had
// is dropped as soon as the points no longer match. `eigen` is the length of the envelope: undefined keeps what it has, a number in beats gives it a
// length of its own (`verknuepft: false`, the length of `je 3/4bar`), null links it to the pattern loop. huellkurve_setzen replaces the whole envelope,
// so the command always carries the length again.
export function kurveBefehle(spur, clip, zeile, punkte, info, form, eigen) {
  if (zeile?.art !== 'kurve') fehler(`${wo(zeile)}: a curve lane is expected`);
  if (!clip) fehler(`${wo(zeile)}: the pattern has no clip yet`);
  const hk = huellkurveVon(clip, zeile.ziel);
  const eigenNeu = eigen === undefined ? (hk && hk.verknuepft === false ? hk.loop_beats : null) : eigen;
  if (eigenNeu !== null && (!zahlOk(eigenNeu) || eigenNeu < LOOP_MIN - EPS || eigenNeu > clip.laenge_beats + EPS)) {
    fehler(`${wo(zeile)}: a length of ${LOOP_MIN}..${clip.laenge_beats} beats is expected`);
  }
  const L = eigenNeu ?? musterLaenge(clip);
  const roh = Array.isArray(punkte) ? punkte : fehler(`${wo(zeile)}: a list of points is expected`);
  const stabil = roh.map((p, i) => ({ p, i })).sort((a, b) => a.p.beat - b.p.beat || a.i - b.i).map((x) => x.p);
  const gespeichert = stabil.map((p, i) => {
    const ort = `${wo(zeile)}, point ${i}`;
    if (!zahlOk(p?.beat) || p.beat < 0 || p.beat > L + EPS) fehler(`${ort}: beat 0..${L} expected`);
    if (p.form !== undefined && !FORMEN.includes(p.form)) fehler(`${ort}: form ${FORMEN.join(' | ')} expected`);
    return { beat: runde(p.beat), wert: zahlOk(p.gespeichert) ? p.gespeichert : speichern(spur, zeile.ziel, p.wert, info, ort), ...(p.form !== undefined ? { form: p.form } : {}) };
  });
  const befehle = [];
  const eigenAlt = hk && hk.verknuepft === false ? hk.loop_beats : null;
  if (!gespeichert.length) { if (hk) befehle.push(hkLoeschen(clip, zeile.ziel)); }
  else if (!hk || abdruck(gespeichert) !== abdruck(hk.punkte) || eigenNeu !== eigenAlt) {
    befehle.push({ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel: zeile.ziel, punkte: gespeichert, ...(eigenNeu !== null ? { verknuepft: false, loop_beats: eigenNeu } : {}) });
  }
  const expl = clip.seq?.zeilen ?? [], eigenZeile = expl.find((z) => z.id === zeile.id);
  const nach = gespeichert.length ? abdruck(gespeichert) : null;
  if (form) {
    const neuForm = reinForm({ ...form, abdruck: nach ?? '' });
    if (!(eigenZeile?.form && JSON.stringify(reinForm(eigenZeile.form)) === JSON.stringify(neuForm))) {
      const zeilen = alleZeilen(spur, clip, info).map((z) => (z.id === zeile.id ? { ...z, form: neuForm } : z));
      if (!zeilen.some((z) => z.id === zeile.id)) fehler(`${wo(zeile)}: no such lane`);
      befehle.push(seqBefehl(clip, zeilen));
    }
  } else if (eigenZeile?.form && eigenZeile.form.abdruck !== nach) {
    befehle.push(seqBefehl(clip, expl.map((z) => (z.id === zeile.id ? { ...z, form: undefined } : z))));
  }
  return befehle;
}

// ---------- shapes ----------
const MAX_STUFEN = 64;
function zufallsFolge(saat) {                          // mulberry32: the same seed gives the same dice (D13)
  let a = saat >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// The points of a shape over one period (= the lane length), in shown values. sinus and dreieck write low, high and a closing point at the period end (the
// envelope holds its last value, so without it the second half would not come back); saege, saege_ab, rampe two points over the period; rechteck two
// `sprung` points; zufall `stufen` `sprung` points from `saat`.
export function formPunkte(form, laenge_beats) {
  const L = laenge_beats, { art, von, bis } = form ?? {};
  if (!zahlOk(L) || L <= 0) fehler('shape: a period above 0 is expected');
  if (!zahlOk(von) || !zahlOk(bis)) fehler('shape: von and bis must be numbers');
  if (form.phase !== undefined && form.phase !== 0) fehler('shape: phase is not written by this slice', 'argument_unbekannt');
  const P = (u, wert, f) => ({ beat: runde(u * L), wert, form: f });
  switch (art) {
    case 'sinus': return [P(0, von, 's'), P(0.5, bis, 's'), P(1, von, 's')];
    case 'dreieck': return [P(0, von, 'linear'), P(0.5, bis, 'linear'), P(1, von, 'linear')];
    case 'saege': case 'rampe': return [P(0, von, 'linear'), P(1, bis, 'linear')];
    case 'saege_ab': return [P(0, bis, 'linear'), P(1, von, 'linear')];
    case 'rechteck': return [P(0, von, 'sprung'), P(0.5, bis, 'sprung')];
    case 'zufall': {
      const stufen = form.stufen ?? 8;
      if (!Number.isInteger(stufen) || stufen < 1 || stufen > MAX_STUFEN) fehler(`shape: stufen takes whole numbers 1..${MAX_STUFEN}`);
      if (form.saat !== undefined && !Number.isInteger(form.saat)) fehler('shape: saat takes a whole number');
      const rnd = zufallsFolge(form.saat ?? 1), lo = Math.min(von, bis), hi = Math.max(von, bis);
      return Array.from({ length: stufen }, (_, i) => P(i / stufen, runde(lo + (hi - lo) * rnd(), 1e6), 'sprung'));
    }
    default: return fehler(`shape: art sinus, dreieck, saege, saege_ab, rechteck, rampe or zufall expected`);
  }
}

// ---------- lanes: add, remove, change ----------
function pruefeZeilen(zeilen) {
  if (zeilen.length > MAX_ZEILEN) fehler(`the pattern would have ${zeilen.length} lanes; at most ${MAX_ZEILEN} are stored`, 'zu_gross');
  const ids = new Set(), tone = new Set(), ziele = new Set();
  let tonlos = 0;
  for (const z of zeilen) {
    if (!ID_MUSTER.test(z.id ?? '')) fehler(`${wo(z)}: id like ${ID_MUSTER} expected`);
    if (ids.has(z.id)) fehler(`${wo(z)}: lane id twice`);
    ids.add(z.id);
    if (z.art !== 'kurve' && !TEILER.includes(z.teiler)) fehler(`${wo(z)}: grid ${z.teiler} is not one of ${TEILER.join(', ')}`);
    if (z.art === 'noten') {
      if (z.ton === undefined) { tonlos += 1; if (tonlos > 1) fehler(`${wo(z)}: a pattern has one pitched lane`); }
      else {
        if (!Number.isInteger(z.ton) || z.ton < 0 || z.ton > 127) fehler(`${wo(z)}: pitch takes whole numbers 0..127`);
        if (tone.has(z.ton)) fehler(`${wo(z)}: note ${z.ton} has a lane already`);
        tone.add(z.ton);
      }
    } else if (z.art === 'werte' || z.art === 'kurve') {
      if (typeof z.ziel !== 'string') fehler(`${wo(z)}: target expected`);
      if (ziele.has(z.ziel)) fehler(`${wo(z)}: target ${z.ziel} has a lane already`);
      ziele.add(z.ziel);
    } else fehler(`${wo(z)}: art noten, werte or kurve expected`);
  }
}
function frischeId(zeile, vorhandene) {
  const basis = zeile.art === 'noten' ? (zeile.ton !== undefined ? `t${zeile.ton}` : 'noten') : zielId(zeile.ziel);
  const belegt = new Set(vorhandene.map((z) => z.id));
  let id = basis, i = 2;
  while (belegt.has(id)) { id = basis.slice(0, 8 - String(i).length) + i; i += 1; }
  return id;
}
// Appends a lane to the descriptor; derived lanes are made explicit first. A pattern without a clip gets the clip with the descriptor in one command.
export function zeileNeuBefehle(spur, clip, zeile, info) {
  const bisher = alleZeilen(spur, clip, info);
  if ((zeile.art === 'werte' || zeile.art === 'kurve') && zeile.ziel !== 'vel' && zeile.ziel !== 'laenge' && !zielErlaubt(zeile.ziel, spur, info)) {
    fehler(`${wo(zeile)}: this instrument has no target ${zeile.ziel}`, 'huellkurve_ziel');
  }
  const neu = { ...zeile, id: zeile.id ?? frischeId(zeile, bisher) };
  if (neu.art === 'werte' && (neu.ziel === 'vel' || neu.ziel === 'laenge') && neu.von === undefined && bisher.filter((z) => z.art === 'noten').length > 1) {
    fehler(`${wo(neu)}: von names the note lane when the pattern has several`);
  }
  const zeilen = [...bisher, neu];
  pruefeZeilen(zeilen);
  return [clip ? seqBefehl(clip, zeilen) : klippNeu(spur, { seq: { schema: 1, zeilen: zeilen.map(reinZeile) } })];
}
// Removes a lane. An envelope lane takes its envelope along, a note lane its notes (the notes of the pitched lane: every note no trigger lane claims, else the
// lane would come back as a derived one), a lane that reads a removed note lane goes too.
export function zeileWegBefehle(spur, clip, zeileId) {
  if (!clip) fehler(`lane ${zeileId}: the pattern has no clip`);
  const eff = alleZeilen(spur, clip, undefined), z = eff.find((x) => x.id === zeileId);
  if (!z) fehler(`lane ${zeileId}: no such lane`);
  const befehle = [];
  const weg = new Set([zeileId]);
  if (z.art === 'noten') {
    const ids = laneNoten(clip, z, eff).map((n) => n.id);
    if (ids.length) befehle.push({ befehl: 'noten_loeschen', clip_id: clip.id, ids });
    for (const x of eff) if (x.art === 'werte' && (x.ziel === 'vel' || x.ziel === 'laenge') && quellZeile(eff, x)?.id === zeileId) weg.add(x.id);
  } else if (huellkurveVon(clip, z.ziel)) befehle.push(hkLoeschen(clip, z.ziel));
  const expl = clip.seq?.zeilen ?? [];
  if (expl.some((x) => weg.has(x.id))) befehle.push(seqBefehl(clip, expl.filter((x) => !weg.has(x.id))));
  return befehle;
}
// felder: { teiler }, { ziel } (an envelope moves to the new target with the same shown values; note fields vel <-> laenge), { eigen_laenge } (beats, or null
// for linked to the clip loop; needs an envelope).
export function zeileAendernBefehle(spur, clip, zeileId, felder, info) {
  if (!clip) fehler(`lane ${zeileId}: the pattern has no clip`);
  const eff = alleZeilen(spur, clip, info), alt = eff.find((x) => x.id === zeileId);
  if (!alt) fehler(`lane ${zeileId}: no such lane`);
  for (const k of Object.keys(felder)) if (!['teiler', 'ziel', 'eigen_laenge'].includes(k)) fehler(`${wo(alt)}: unknown field ${k}`, 'argument_unbekannt');
  let neu = { ...alt };
  const hkAlt = alt.art !== 'noten' ? huellkurveVon(clip, alt.ziel) : null;
  let h = hkAlt ? { ...hkAlt, punkte: kopiePunkte(hkAlt.punkte) } : null;
  if (felder.teiler !== undefined) {
    if (alt.art === 'kurve') fehler(`${wo(alt)}: a curve lane has no grid`);
    if (!TEILER.includes(felder.teiler)) fehler(`${wo(alt)}: grid ${felder.teiler} is not one of ${TEILER.join(', ')}`);
    neu.teiler = felder.teiler;
  }
  if (felder.ziel !== undefined && felder.ziel !== alt.ziel) {
    if (alt.art === 'noten') fehler(`${wo(alt)}: a note lane has no target`);
    const feldAlt = alt.ziel === 'vel' || alt.ziel === 'laenge', feldNeu = felder.ziel === 'vel' || felder.ziel === 'laenge';
    if (feldAlt !== feldNeu || (feldAlt && alt.art !== 'werte')) fehler(`${wo(alt)}: a lane moves between envelope targets or between vel and laenge, add a new lane for the rest`);
    if (eff.some((x) => x.id !== alt.id && x.ziel === felder.ziel)) fehler(`${wo(alt)}: target ${felder.ziel} has a lane already`);
    if (!feldNeu && !zielErlaubt(felder.ziel, spur, info)) fehler(`${wo(alt)}: this instrument has no target ${felder.ziel}`, 'huellkurve_ziel');
    if (h) {
      h.ziel = felder.ziel;
      h.punkte = h.punkte.map((p) => {
        const a = anzeige(spur, alt.ziel, p.wert, info).wert;
        const gezeigt = istGeraetZiel(alt.ziel) && istGeraetZiel(felder.ziel) ? a : ausBruch(felder.ziel, bruch(alt.ziel, a));
        return { ...p, wert: speichern(spur, felder.ziel, gezeigt, info, `${wo(alt)}, point at beat ${p.beat}`) };
      });
    }
    neu.ziel = felder.ziel;
  }
  if (felder.eigen_laenge !== undefined) {
    if (alt.art === 'noten' || alt.ziel === 'vel' || alt.ziel === 'laenge') fehler(`${wo(alt)}: only envelope lanes have a length of their own`);
    if (!h) fehler(`${wo(alt)}: no envelope yet, set a value first`);
    if (felder.eigen_laenge === null) { delete h.verknuepft; delete h.loop_beats; }
    else {
      if (!zahlOk(felder.eigen_laenge) || felder.eigen_laenge < LOOP_MIN || felder.eigen_laenge > clip.laenge_beats + EPS) {
        fehler(`${wo(alt)}: a length of ${LOOP_MIN}..${clip.laenge_beats} beats is expected`);
      }
      h.verknuepft = false; h.loop_beats = felder.eigen_laenge;
    }
  }
  const befehle = [];
  if (h && (h.ziel !== hkAlt.ziel || h.verknuepft !== hkAlt.verknuepft || h.loop_beats !== hkAlt.loop_beats || abdruck(h.punkte) !== abdruck(hkAlt.punkte))) {
    if (h.ziel !== hkAlt.ziel) befehle.push(hkLoeschen(clip, hkAlt.ziel));
    befehle.push(hkBefehl(clip, h, h.punkte));
  }
  let formNeu = false;
  if (neu.form && h && neu.form.abdruck !== abdruck(h.punkte)) { neu.form = { ...neu.form, abdruck: abdruck(h.punkte) }; formNeu = true; }   // the shape stays the shape on the new base
  if (neu.teiler !== alt.teiler || neu.ziel !== alt.ziel || formNeu) {
    const zeilen = eff.map((x) => (x.id === zeileId ? neu : x));
    pruefeZeilen(zeilen);
    befehle.push(seqBefehl(clip, zeilen));
  }
  return befehle;
}
// Pattern length (loop_beats of the clip, a multiple of 0.125 beat). Shortening also deletes the notes and the points of linked envelopes that fall
// behind the new end (only what the old end still contained), in the same list.
export function laengeBefehle(spur, clip, beats) {
  if (!zahlOk(beats) || beats < 0.125 || Math.abs(Math.round(beats / 0.125) * 0.125 - beats) > EPS) fehler('pattern length: a multiple of 0.125 beat from 0.125 is expected');
  if (!clip) return [klippNeu(spur, { loop_beats: beats })];
  if (beats > clip.laenge_beats + EPS) fehler(`pattern length: at most the clip length, ${clip.laenge_beats} beats`);
  const alt = musterLaenge(clip);
  if (Math.abs(beats - alt) < EPS && clip.loop_beats != null) return [];
  const befehle = [];
  if (beats < alt - EPS) {
    const ids = (clip.noten ?? []).filter((n) => n.beat >= beats - EPS && n.beat < alt - EPS).map((n) => n.id);
    if (ids.length) befehle.push({ befehl: 'noten_loeschen', clip_id: clip.id, ids });
    for (const hk of clip.huellkurven ?? []) {
      if (hk.verknuepft === false) continue;
      const rest = hk.punkte.filter((p) => !(p.beat > beats + EPS && p.beat <= alt + EPS));
      if (rest.length === hk.punkte.length) continue;
      befehle.push(rest.length ? hkBefehl(clip, hk, kopiePunkte(rest)) : hkLoeschen(clip, hk.ziel));
    }
  }
  befehle.push({ befehl: 'clip_aendern', clip_id: clip.id, loop_beats: beats });
  return befehle;
}

// ---------- whole lanes (the pattern text writes a lane at a time) ----------
// Rule D8 exactly (project/seq.ts seqFolgen `editierbar`): an instrument track with no clip or exactly one MIDI clip from beat 0 over the whole region.
export function folgeEditierbar(spur) {
  const clips = spur?.clips ?? [];
  if (spur?.art !== 'instrument') return false;
  if (clips.length === 0) return true;
  const c = clips[0];
  return clips.length === 1 && c.art === 'midi' && Math.abs(c.start_beat) < EPS && Math.abs(c.laenge_beats - KLIPP_BEATS) < EPS;
}

// A lane id that is free in `vorhandene` for a new lane (a trigger lane `t<note>`, the pitched lane `noten`, an envelope lane the short target name).
export const neueZeilenId = (zeile, vorhandene) => frischeId(zeile, vorhandene);

// The whole lane list of a pattern as the descriptor: ONE command, [] when the list equals the lanes the clip already shows (explicit plus derived), so a
// text that says nothing new writes nothing. Derived lanes are made explicit when the list differs. A pattern without a clip gets the clip with it.
export function zeilenSetzenBefehle(spur, clip, zeilen, info) {
  const jetzt = clip ? alleZeilen(spur, clip, info) : [];
  const neuText = JSON.stringify(zeilen.map(reinZeile));
  if (neuText === JSON.stringify(jetzt.map(reinZeile)) || neuText === JSON.stringify((clip?.seq?.zeilen ?? []).map(reinZeile))) return [];   // nothing new to store
  pruefeZeilen(zeilen);
  return [clip ? seqBefehl(clip, zeilen) : klippNeu(spur, { seq: { schema: 1, zeilen: zeilen.map(reinZeile) } })];
}

// Writes one whole lane from its cells and matches it with the data: what the cells say the same is left untouched. The pattern text uses it; every cell
// is accounted for, so a lane line is the whole lane.
//  note lane: zellen[c] is undefined/null (leave the cell), { an: false } (no note starts in the cell afterwards), or
//    { an: true, toene?, vel?, laenge? }: the notes that start in the cell have exactly the pitches `toene` (a trigger lane: its own pitch; a pitched lane:
//    a list, a chord has several); notes of those pitches that are there stay as they are (an off-grid start too), the others go, new ones start on the
//    cell start. `vel` and `laenge` (in cells of the lane grid) are set on the notes of the cell when they differ; a new note gets velocity 100 and
//    half a cell (trigger) or one cell (pitched) without them. { nurFelder: true, vel?, laenge? } sets those fields on the notes that are there and
//    refuses an empty cell.
//  werte lane on an envelope target: zellen[c] is a shown value or null (no point in the cell). A cell whose last point shows the same value to two
//    decimals keeps its points; else the cell holds one `sprung` point on its start. The seam rule (spec 4): the first cell always carries a point. The
//    last point removed removes the envelope. opt.eigen_laenge: undefined keeps the envelope's length, a number in beats gives it its own, null links it.
//  A werte lane on vel or laenge is not written here: those values are fields of the notes of a note lane (give them as `vel`/`laenge` of its cells).
export function zeileBefehle(spur, clip, zeile, zellen, info, opt = {}) {
  if (!clip) fehler(`${wo(zeile)}: the pattern has no clip yet`);
  if (zeile?.art === 'noten') return notenZeileBefehle(spur, clip, zeile, zellen, info);
  if (zeile?.art === 'werte' && zeile.ziel !== 'vel' && zeile.ziel !== 'laenge') return werteZeileBefehle(spur, clip, zeile, zellen, info, opt);
  return fehler(`${wo(zeile)}: a note lane or a value lane on an envelope target is expected (vel and laenge are fields of the note cells)`);
}

function notenZeileBefehle(spur, clip, zeile, zellen, info) {
  if (!TEILER.includes(zeile.teiler)) fehler(`${wo(zeile)}: grid ${zeile.teiler} is not one of ${TEILER.join(', ')}`);
  const P = musterLaenge(clip), n = zellenAnzahl(P, zeile.teiler);
  if (!Array.isArray(zellen) || zellen.length !== n) fehler(`${wo(zeile)}: ${Array.isArray(zellen) ? zellen.length : 'no'} cells found, ${n} expected`);
  const eff = alleZeilen(spur, clip, info), trigger = zeile.ton !== undefined;
  const lane = laneNoten(clip, zeile, eff);
  const fremd = new Map(eff.filter((x) => x.art === 'noten' && x.ton !== undefined && x.id !== zeile.id).map((x) => [x.ton, x.id]));
  const weg = [], aend = [], neu = [];
  zellen.forEach((s, c) => {
    if (s === undefined || s === null) return;
    const start = c * zeile.teiler, ende = start + zeile.teiler;
    const drin = lane.filter((x) => x.beat >= start - EPS && (c === n - 1 || x.beat < ende - EPS)).sort(nachBeat);
    const ort = wo(zeile, c);
    if (s.an === false) { for (const x of drin) weg.push(x.id); return; }
    if (s.vel !== undefined && (!Number.isInteger(s.vel) || s.vel < 1 || s.vel > 127)) fehler(`${ort}: velocity takes whole numbers 1..127`);
    if (s.laenge !== undefined && (!zahlOk(s.laenge) || !(s.laenge > 0))) fehler(`${ort}: length takes a number of cells above 0`);
    let gewollt;
    if (s.nurFelder) {
      if (!drin.length) fehler(`${ort}: no note starts in this cell`);
      gewollt = [...new Set(drin.map((x) => x.ton))];
    } else if (trigger) gewollt = [zeile.ton];
    else {
      gewollt = s.toene;
      if (!Array.isArray(gewollt) || !gewollt.length) fehler(`${ort}: a pitch is expected`);
      for (const t of gewollt) {
        if (!Number.isInteger(t) || t < 0 || t > 127) fehler(`${ort}: pitch takes whole numbers 0..127`);
        if (fremd.has(t)) fehler(`${ort}: note ${t} belongs to the trigger lane ${fremd.get(t)}`);
      }
      gewollt = [...new Set(gewollt)];
    }
    // A value that equals what the cell shows (the velocity of its lowest note, the length of that note in cells to two decimals) says nothing new: no note
    // of the cell is touched (a chord of velocities 90 and 40 reads as 90 and stays as it is). A really different value is set on every note of the cell.
    const zeigt = drin.length ? drin.reduce((a, b) => (b.ton < a.ton ? b : a)) : null;
    const velGleich = s.vel !== undefined && zeigt !== null && Math.round(zeigt.vel) === s.vel;
    const laengeGleich = s.laenge !== undefined && zeigt !== null && Math.round(s.laenge * 100) === Math.round(zeigt.laenge / zeile.teiler * 100);
    for (const x of drin) {
      if (!gewollt.includes(x.ton)) { weg.push(x.id); continue; }
      const f = { id: x.id };
      if (s.vel !== undefined && !velGleich && s.vel !== x.vel) f.vel = s.vel;
      if (s.laenge !== undefined && !laengeGleich) { const l = runde(s.laenge * zeile.teiler); if (l !== x.laenge) f.laenge = l; }
      if (Object.keys(f).length > 1) aend.push(f);
    }
    for (const t of gewollt) {
      if (drin.some((x) => x.ton === t)) continue;
      neu.push({ beat: runde(start), laenge: runde((s.laenge ?? (trigger ? 0.5 : 1)) * zeile.teiler), ton: t, vel: s.vel ?? VEL_VORGABE });
    }
  });
  const befehle = [];
  if (weg.length) befehle.push({ befehl: 'noten_loeschen', clip_id: clip.id, ids: weg });
  if (aend.length) befehle.push({ befehl: 'noten_aendern', clip_id: clip.id, noten: aend });
  if (neu.length) befehle.push({ befehl: 'noten_neu', clip_id: clip.id, noten: neu });
  return befehle;
}

function werteZeileBefehle(spur, clip, zeile, zellen, info, opt) {
  if (!TEILER.includes(zeile.teiler)) fehler(`${wo(zeile)}: grid ${zeile.teiler} is not one of ${TEILER.join(', ')}`);
  const hk = huellkurveVon(clip, zeile.ziel), P = musterLaenge(clip);
  const eigen = opt.eigen_laenge;
  if (eigen !== undefined && eigen !== null && (!zahlOk(eigen) || eigen < LOOP_MIN - EPS || eigen > clip.laenge_beats + EPS)) {
    fehler(`${wo(zeile)}: a length of ${LOOP_MIN}..${clip.laenge_beats} beats is expected`);
  }
  const eigenAlt = hk && hk.verknuepft === false ? hk.loop_beats : null;
  const eigenNeu = eigen === undefined ? eigenAlt : eigen;
  const L = eigenNeu ?? P, t = zeile.teiler, n = zellenAnzahl(L, t);
  if (!Array.isArray(zellen) || zellen.length !== n) fehler(`${wo(zeile)}: ${Array.isArray(zellen) ? zellen.length : 'no'} cells found, ${n} expected`);
  const alt = hk ? kopiePunkte(hk.punkte) : [];
  const gleich2 = (a, b) => Math.round(a * 100) === Math.round(b * 100);
  const neu = [];
  let ersterEigener = null, naht0Gleich = false;
  zellen.forEach((v, c) => {
    const von = c * t, bis = von + t;
    const drin = alt.filter((p) => p.beat >= von - EPS && p.beat < bis - EPS);
    if (v === null || v === undefined) return;
    const ort = wo(zeile, c);
    const gespeichert = speichern(spur, zeile.ziel, v, info, ort);
    // cell 0 without a point shows the value over the seam: a text that says that value says "no point here", as the data do
    if (c === 0 && !drin.length && alt.length && gleich2(anzeige(spur, zeile.ziel, alt[alt.length - 1].wert, info).wert, v)) { naht0Gleich = true; return; }
    if (drin.length && gleich2(anzeige(spur, zeile.ziel, drin[drin.length - 1].wert, info).wert, v)) { neu.push(...drin); return; }
    const p = { beat: von, wert: gespeichert, form: 'sprung' };
    if (neu.length === 0) ersterEigener = p;
    neu.push(p);
  });
  for (const p of alt) if (p.beat >= n * t - EPS || p.beat >= L - EPS) { if (!neu.includes(p)) neu.push(p); }   // points on or behind the end are in no cell: stay
  neu.sort((a, b) => a.beat - b.beat);
  if (!neu.length) return hk ? [hkLoeschen(clip, zeile.ziel)] : [];
  if (naht0Gleich && hk && abdruck(neu) === abdruck(hk.punkte) && eigenNeu === eigenAlt) return [];                  // nothing else changed: the seam stays as it is
  if (!neu.some((p) => p.beat < t - EPS)) neu.unshift({ beat: 0, wert: neu[neu.length - 1].wert });                 // the seam point
  if (neu[0] === ersterEigener) delete ersterEigener.form;                                                           // a first point has no segment before it
  if (hk && abdruck(neu) === abdruck(hk.punkte) && eigenNeu === eigenAlt) return [];
  return [{ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel: zeile.ziel, punkte: neu, ...(eigenNeu !== null ? { verknuepft: false, loop_beats: eigenNeu } : {}) }];
}
