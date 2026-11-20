// Tracker stage 3 (ADR 040): pure unrolling of the effect commands of a MIDI clip into note calls and event lists.
// Next to `fuerAusgerollteNoten` (playback.ts): playback, offline render and export all take their notes and effect events from here.
// No DOM, no I/O, deterministic. A clip without `fx` calls `fuerAusgerollteNoten` unchanged and returns empty lists.
import type { FxEintrag, MidiClip, Note } from './model.ts';
import { fuerAusgerollteNoten } from './playback.ts';

// ticks: effect ticks per row; stufig: the device runs its effects as jumps per tick (`fx_stufig`); rollen: knob numbers of the roles of the device;
// slotBasis: the value 0..1 the slot knob stands on (the track's own knob value), what a note without `platz` plays when its clip uses `platz`
export interface FxRahmen { lpb: number; ticks: number; stufig: boolean; rollen: { slot?: number; start?: number; rueckwaerts?: number }; slotBasis?: number }
// All beats absolute. bend: [beat, semitones, glide beats]; pegel: [beat, factor 0..1, glide beats]; regler: knob number to [beat, value 0..1] jump
// points; pan: [beat, -1..1] (valid from the beat to the end of the clip copy; the consumer returns it, D22).
export interface FxAus {
  bend: [number, number, number][]; pegel: [number, number, number][];
  regler: Map<number, [number, number][]>; pan: [number, number][];
}

const EPS = 1e-9;
const ZEIT_EPS = 1e-7;
type FNote = { id: string; beat: number; laenge: number; n: Note; weg: boolean; retrig: boolean; eltern?: FNote };
type Zeile = { beat: number; e: FxEintrag[]; gld: { ziel: number } | 'fort' | null; neu: boolean };
type FxClip = MidiClip & { fx?: FxEintrag[] };

const leer = (): FxAus => ({ bend: [], pegel: [], regler: new Map(), pan: [] });
const klemme = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const spalteVon = (n: Note): number => n.spalte ?? 0;

// Absolute entries of a clip: every loop copy repeats the entries with beat < loop_beats (as notes do); an entry at or behind the end of its copy is silent.
function absoluteEintraege(c: FxClip, fx: FxEintrag[]): FxEintrag[] {
  const aus: FxEintrag[] = [], ende = c.start_beat + c.laenge_beats, loop = c.loop_beats ?? null;
  const kopien = loop === null ? 1 : Math.ceil(c.laenge_beats / loop - 1e-9);
  for (let k = 0; k < kopien; k++) {
    const basis = loop === null ? c.start_beat : c.start_beat + k * loop;
    const kopieEnde = loop === null ? ende : Math.min(basis + loop, ende);
    for (const e of fx) {
      const beat = basis + e.beat;
      if (e.beat < 0 || !(beat < kopieEnde - EPS) || (loop !== null && !(e.beat < loop))) continue;
      aus.push({ beat, spalte: e.spalte, code: e.code, wert: Math.trunc(e.wert) });
    }
  }
  return aus;
}

// Index of the first entry of a list sorted by `beat` with beat >= x
function ab(l: { beat: number }[], x: number): number {
  let lo = 0, hi = l.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (l[m].beat < x) lo = m + 1; else hi = m; }
  return lo;
}

// A clip needs this unrolling (instead of fuerAusgerollteNoten alone) when it holds effect commands, or notes with a slot on a device with the slot role.
export const hatFxArbeit = (c: MidiClip, rahmen: Pick<FxRahmen, 'rollen'>): boolean =>
  (c as FxClip).fx?.length ? true : rahmen.rollen.slot !== undefined && c.noten.some((n) => n.platz !== undefined);

export function rolleFxAus(c: MidiClip, rahmen: FxRahmen, f: (id: string, beat: number, laenge: number, n: Note) => void): FxAus {
  const fx = (c as FxClip).fx ?? [];
  if (!hatFxArbeit(c, rahmen)) { fuerAusgerollteNoten(c, f); return leer(); }
  const { lpb, ticks, stufig } = rahmen, zeilenLaenge = 1 / lpb, tk = 1 / (lpb * ticks);
  const aus = leer();

  // 1. the notes as they sound, in the call order of fuerAusgerollteNoten
  const reihe: FNote[] = [];
  fuerAusgerollteNoten(c, (id, beat, laenge, n) => { reihe.push({ id, beat, laenge, n, weg: false, retrig: false }); });
  const sortiert = reihe.slice().sort((a, b) => a.beat - b.beat);   // stable: ties keep the call order

  // 2. rows: entries grouped by row beat
  const zeilen: Zeile[] = [];
  for (const e of absoluteEintraege(c, fx).sort((a, b) => a.beat - b.beat || a.spalte - b.spalte)) {
    const z = zeilen[zeilen.length - 1];
    if (z !== undefined && Math.abs(z.beat - e.beat) < ZEIT_EPS) z.e.push(e);
    else zeilen.push({ beat: e.beat, e: [e], gld: null, neu: false });
  }
  const imFenster = (r: number): FNote[] => {       // live notes whose sounding start lies in the row [r, r + row length)
    const l: FNote[] = [];
    for (let i = ab(sortiert, r - ZEIT_EPS); i < sortiert.length && sortiert[i].beat < r + zeilenLaenge - ZEIT_EPS; i++) {
      if (!sortiert[i].weg) l.push(sortiert[i]);
    }
    return l;
  };
  const ersteNote = (l: FNote[]): FNote | undefined =>
    l.filter((x) => !x.retrig).sort((a, b) => spalteVon(a.n) - spalteVon(b.n) || a.beat - b.beat)[0];

  // 3. GLD (the note of the row does not start; the sounding note is lengthened) and RTG (more starts), row by row in time order
  for (const z of zeilen) {
    const gld = z.e.some((e) => e.code === 'GLD');
    if (gld) {
      const rem = ersteNote(imFenster(z.beat));
      if (rem === undefined) z.gld = 'fort';
      else {
        let s: FNote | undefined;
        for (let i = ab(sortiert, rem.beat - ZEIT_EPS) - 1; i >= 0; i--) {   // latest earlier note of the same column
          if (sortiert[i].weg || spalteVon(sortiert[i].n) !== spalteVon(rem.n)) continue;
          s = sortiert[i]; break;
        }
        if (s !== undefined && s.beat + s.laenge >= rem.beat - 1e-6) {
          rem.weg = true;
          s.laenge = Math.max(s.laenge, rem.beat + rem.laenge - s.beat);
          z.gld = { ziel: rem.n.ton - s.n.ton };
        }
      }
    }
    const rtg = z.e.filter((e) => e.code === 'RTG').pop();
    const y = rtg === undefined ? 0 : rtg.wert & 15;
    if (y > 0) {
      const zEnde = z.beat + zeilenLaenge;
      // the notes sounding at the row start: they start again every y ticks inside the row; the last piece keeps the old note end
      for (let i = 0; i < ab(sortiert, z.beat + ZEIT_EPS); i++) {
        const o = sortiert[i];
        const oEnde = o.beat + o.laenge;
        if (o.weg || !(oEnde > z.beat + ZEIT_EPS)) continue;
        const starts: number[] = [];
        for (let j = 1; z.beat + j * y * tk < Math.min(zEnde, oEnde) - ZEIT_EPS; j++) starts.push(z.beat + j * y * tk);
        if (starts.length === 0) continue;
        o.laenge = starts[0] - o.beat;
        starts.forEach((b, j) => {
          const p: FNote = {
            id: `${o.id}.r${j + 1}`, beat: b, laenge: (j + 1 < starts.length ? starts[j + 1] : oEnde) - b, n: o.n, weg: false, retrig: true,
            eltern: o.eltern ?? o,
          };
          sortiert.splice(ab(sortiert, b + ZEIT_EPS), 0, p);
          reihe.splice(reihe.indexOf(o) + 1 + j, 0, p);
        });
      }
    }
  }

  // 4. the calls (the notes that start; GLD removed some, RTG added some)
  for (const x of reihe) if (!x.weg) f(x.id, x.beat, x.laenge, x.n);

  // 5. state pass in time order: resets at note starts, the commands of each row
  type Zustand = {
    bend: number; pegel: number; vibT: number; trmT: number; vibX: number; vibY: number; trmX: number; trmY: number; gldV: number; ziel: number | null;
  };
  const st: Zustand = { bend: 0, pegel: 1, vibT: 0, trmT: 0, vibX: 0, vibY: 0, trmX: 0, trmY: 0, gldV: 0, ziel: null };
  let letzterBend = 0, letzterPegel = 1;
  const setzeBend = (beat: number, v: number, gleit: number): void => {
    if (Math.abs(v - letzterBend) < EPS) return;
    aus.bend.push([beat, v, gleit]); letzterBend = v;
  };
  const setzePegel = (beat: number, v: number, gleit: number): void => {
    if (Math.abs(v - letzterPegel) < EPS) return;
    aus.pegel.push([beat, v, gleit]); letzterPegel = v;
  };
  const zuruecksetzen = (beat: number): void => {
    st.bend = 0; st.pegel = 1; st.vibT = 0; st.trmT = 0; st.ziel = null;
    setzeBend(beat, 0, 0); setzePegel(beat, 1, 0);
  };
  const reiheZ = zeilen;   // sorted by beat
  const zeileZu = (b: number): Zeile | undefined => {
    const i = ab(reiheZ, b - zeilenLaenge + ZEIT_EPS);
    for (let j = i; j < reiheZ.length && reiheZ[j].beat <= b + ZEIT_EPS; j++) {
      if (b >= reiheZ[j].beat - ZEIT_EPS && b < reiheZ[j].beat + zeilenLaenge - ZEIT_EPS) return reiheZ[j];
    }
    return undefined;
  };
  type Moment = { beat: number; z?: Zeile };
  const momente: Moment[] = zeilen.map((z) => ({ beat: z.beat, z }));
  const gruppen = new Set<number>();
  for (const x of sortiert) {
    if (x.weg || x.retrig) continue;
    const z = zeileZu(x.beat);
    if (z !== undefined) z.neu = true;
    else { const key = Math.round(x.beat * 1e6); if (!gruppen.has(key)) { gruppen.add(key); momente.push({ beat: x.beat }); } }
  }
  momente.sort((a, b) => a.beat - b.beat);

  for (const m of momente) {
    if (m.z === undefined) { zuruecksetzen(m.beat); continue; }
    const z = m.z, r = z.beat;
    if (z.neu) zuruecksetzen(r);
    const nib = (w: number): [number, number] => [w >> 4, w & 15];
    let slu = 0, sld = 0, arp: [number, number] | null = null, vsl = 0, lvl: number | null = null, gldAn = false;
    let vibAn = false, trmAn = false;
    for (const e of z.e) {
      const w = e.wert & 255;
      if (e.code === 'SLU') slu += w / 16;
      else if (e.code === 'SLD') sld += w / 16;
      else if (e.code === 'ARP') arp = nib(w);
      else if (e.code === 'GLD') {
        if (z.gld !== null) { gldAn = true; if (w > 0) st.gldV = w / 16; }
        if (typeof z.gld === 'object' && z.gld !== null) st.ziel = z.gld.ziel;
      } else if (e.code === 'VIB') { const [x, y] = nib(w); if (x > 0) st.vibX = x; if (y > 0) st.vibY = y; vibAn = true; }
      else if (e.code === 'TRM') { const [x, y] = nib(w); if (x > 0) st.trmX = x; if (y > 0) st.trmY = y; trmAn = true; }
      else if (e.code === 'VSL') { const [x, y] = nib(w); vsl = x > 0 ? x / 64 : -y / 64; }
      else if (e.code === 'LVL') lvl = w / 255;
      else if (e.code === 'PAN') aus.pan.push([r, w === 255 ? 1 : (w - 128) / 128]);
    }
    if (lvl !== null) st.pegel = lvl;
    const T = ticks, vibV = st.vibX / 64, trmV = st.trmX / 64;
    const hp: number[] = [st.bend], hl: number[] = [st.pegel];
    for (let k = 1; k <= T; k++) {
      let p = hp[k - 1] + slu - sld;
      if (gldAn && st.ziel !== null && st.gldV > 0) p += klemme(st.ziel - p, -st.gldV, st.gldV);
      hp.push(p);
      hl.push(klemme(hl[k - 1] + vsl, 0, 1));
    }
    // smooth glides: when the next row continues VIB (TRM), the last glide of this row aims at the modulation value the next row has at its tick 0
    const folge = zeilen.find((q) => Math.abs(q.beat - (r + zeilenLaenge)) < 1e-6 && !q.neu);
    const folgeLetzter = (code: string): FxEintrag | undefined => folge?.e.filter((x) => x.code === code).pop();
    const P: number[] = [], L: number[] = [];
    for (let k = 0; k <= T; k++) {
      const hin = k < T;   // tick T is the next row: the per-tick modulation is over
      const mp = !hin ? 0 : (arp !== null ? [0, arp[0], arp[1]][k % 3] : 0) + (vibAn ? st.vibY / 8 * Math.sin(2 * Math.PI * (st.vibT + k * vibV)) : 0);
      const ml = !hin || !trmAn ? 0 : st.trmY / 16 * Math.sin(2 * Math.PI * (st.trmT + k * trmV));
      P.push(hp[k] + mp); L.push(klemme(hl[k] + ml, 0, 1));
    }
    const vibF = vibAn ? folgeLetzter('VIB') : undefined, trmF = trmAn ? folgeLetzter('TRM') : undefined;
    const tiefeF = (f: FxEintrag, alt: number): number => ((f.wert & 15) > 0 ? f.wert & 15 : alt);
    const pEnde = vibF === undefined ? P[T] : hp[T] + tiefeF(vibF, st.vibY) / 8 * Math.sin(2 * Math.PI * (st.vibT + T * vibV));
    const lFolge = folgeLetzter('LVL');
    const lEnde = trmF === undefined ? L[T]
      : klemme((lFolge === undefined ? hl[T] : (lFolge.wert & 255) / 255) + tiefeF(trmF, st.trmY) / 16 * Math.sin(2 * Math.PI * (st.trmT + T * trmV)), 0, 1);
    const ersterZeitpunkt = (h: number[]): number => {   // first tick at which a held series has reached its end value
      for (let k = 1; k <= T; k++) if (Math.abs(h[k] - h[T]) < EPS) return k;
      return T;
    };
    // pitch
    if (stufig || arp !== null) { for (let k = 0; k <= T; k++) setzeBend(r + k * tk, P[k], 0); }
    else if (vibAn) {
      setzeBend(r, P[0], 0);
      for (let k = 0; k < T; k++) setzeBend(r + k * tk, k + 1 < T ? P[k + 1] : pEnde, tk);
    } else if (Math.abs(hp[T] - letzterBend) > EPS) setzeBend(r, hp[T], ersterZeitpunkt(hp) * tk);
    // level
    if (stufig) { for (let k = 0; k <= T; k++) setzePegel(r + k * tk, L[k], 0); }
    else if (trmAn) {
      setzePegel(r, L[0], 0);
      for (let k = 0; k < T; k++) setzePegel(r + k * tk, k + 1 < T ? L[k + 1] : lEnde, tk);
    } else {
      setzePegel(r, hl[0], 0);
      if (Math.abs(hl[T] - hl[0]) > EPS) setzePegel(r, hl[T], ersterZeitpunkt(hl) * tk);
    }
    st.bend = hp[T]; st.pegel = hl[T];
    if (vibAn) st.vibT += T * vibV;
    if (trmAn) st.trmT += T * trmV;
  }

  // 6. role values at the sounding start of notes (the start of a note is its beat from the callback, versatz included)
  const rollen = rahmen.rollen;
  const punkt = (knob: number | undefined, beat: number, v: number): void => {
    if (knob === undefined) return;
    let l = aus.regler.get(knob);
    if (l === undefined) { l = []; aus.regler.set(knob, l); }
    l.push([beat, v]);
  };
  const reihenEintrag = (z: Zeile, code: string): FxEintrag | undefined => z.e.filter((e) => e.code === code).pop();
  const nutztPlatz = c.noten.some((n) => n.platz !== undefined);
  const nutztOfs = zeilen.some((z) => z.e.some((e) => e.code === 'OFS'));
  const nutztRev = zeilen.some((z) => z.e.some((e) => e.code === 'REV'));
  const ofsBei = new Map<FNote, number>(), revBei = new Map<FNote, number>();
  for (const z of zeilen) {
    const o = reihenEintrag(z, 'OFS'), v = reihenEintrag(z, 'REV');
    if (o === undefined && v === undefined) continue;
    const x = ersteNote(imFenster(z.beat));
    if (x === undefined) continue;
    if (o !== undefined) ofsBei.set(x, (o.wert & 255) / 256);
    if (v !== undefined) revBei.set(x, v.wert === 1 ? 1 : 0);
  }
  for (const x of sortiert) {
    if (x.weg) continue;
    const q = x.eltern ?? x;
    // with any OFS in the clip every note that starts writes its offset (0 without OFS), else the knob would stay on the value of the earlier note;
    // a retrigger piece writes nothing: it plays on the offset of its note
    if (nutztOfs && !x.retrig) punkt(rollen.start, x.beat, ofsBei.get(q) ?? 0);
    if (nutztRev) punkt(rollen.rueckwaerts, x.beat, revBei.get(q) ?? 0);
    if (!nutztPlatz) continue;
    const platz = x.n.platz;   // a note without platz stands on the knob; without a known knob value nothing is claimed for it
    if (platz !== undefined) punkt(rollen.slot, x.beat, (platz - 1) / 31);
    else if (rahmen.slotBasis !== undefined) punkt(rollen.slot, x.beat, rahmen.slotBasis);
  }
  const slotListe = rollen.slot === undefined ? undefined : aus.regler.get(rollen.slot);
  // the clip ends with the slot it set: the next clip (or a clip without platz) finds the knob where the panel has it
  if (slotListe?.length && rahmen.slotBasis !== undefined && slotListe[slotListe.length - 1][1] !== rahmen.slotBasis) {
    slotListe.push([c.start_beat + c.laenge_beats, rahmen.slotBasis]);
  }
  for (const l of aus.regler.values()) l.sort((a, b) => a[0] - b[0]);
  aus.pan.sort((a, b) => a[0] - b[0]);
  return aus;
}
