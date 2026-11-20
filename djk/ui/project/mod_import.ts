// Tracker stage 6, task 25: the ProTracker module parser. Pure: bytes in, a tracker project plus sample data plus a report out.
// No DOM, no I/O, no clock. The bank itself (graph file, sample files) is written by the caller (task 26) from `samples`.
//
// Note names (the rule of this file): ProTracker names the lowest octave C-1 (period 856), the middle one C-2 (428) and the top one C-3 (214).
// This project names MIDI 60 `C-3` (piano roll), one octave up from ProTracker: PT C-1 (856) = MIDI 48 = `C-2`, PT C-2 (428) = MIDI 60 = `C-3`,
// PT C-3 (214) = MIDI 72 = `C-4`. The period table below holds the finetune 0 row, index i is MIDI 48 + i.
//
// Pitch of the samples: ProTracker plays a sample (finetune 0) at C-2 (period 428) with the Paula clock of the PAL machine over the period:
// 3546895 / 428 = 8287 Hz. The slot stores the frames at `rate` = 8287 Hz and `grund` = the frequency of MIDI 60 (261.6256 Hz); the device steps
// through the data at `hz / grund * rate / fs` frames, so MIDI 60 plays the data at 8287 Hz, as ProTracker does, and every note keeps its octave.
// The finetune of the sample goes to `fein` (eighths of a semitone), it is not folded into `rate`.
//
// Mapping of one module: the song is the course ProTracker plays (see the course block in `lese`): one section per run of rows, rows of 1/4 beat at
// LPB 4; `Dxx` and `Bxx` move the play position (a section ends after the row, the rows after it are not read), `E6x` loops are written out, the project
// tempo keeps the length of a song that changes its tempo; every pattern and channel gives one clip per section, clips with equal content from the same
// pattern share a `verbund`. Per channel one `amiga` track. Modules with 15 samples (no signature) are read too.
import {
  neuesProjekt, SPUR_FARBEN, type FxEintrag, type MidiClip, type Note, type Projekt, type Spur,
} from './model.ts';

export class ModFehler extends Error {
  grund = 'mod_ungueltig' as const;
  offset: number;
  constructor(offset: number, text: string) {
    super(`mod_ungueltig at byte ${offset}: ${text}`);
    this.name = 'ModFehler';
    this.offset = offset;
  }
}

export interface ModSample {
  nr: number; name?: string; daten: Float32Array; rate: number; grund: number; schleife: 0 | 1; s_von: number; s_laenge: number; pegel: number; fein: number;
}
export interface ModBericht {
  kanaele: number; muster: number; positionen: number; samples: number;
  weggelassen: { tempo_wechsel: number; sprung: number; muster_schleife: number; unbekannt: Record<string, number> };
  tempo_gemittelt?: true;   // the song changes its tempo or speed: the project tempo is the average that keeps the length
  unerreicht?: number;      // song positions the course of the song never plays (behind a jump), not imported
}
export interface ModErgebnis { projekt: Projekt; bericht: ModBericht; samples: ModSample[] }

// the finetune 0 row of the ProTracker period table, PT C-1 .. B-3 = MIDI 48 .. 83
export const MOD_PERIODEN: readonly number[] = [
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
  428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
  214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
];
const TON_UNTEN = 24;       // the lowest note that can be typed in the tracker (D1)
const TON_OBEN = 127;
const MOD_C2_PERIODE = 428;
export const MOD_RATE = 8287;
export const MOD_GRUND = 440 * 2 ** ((60 - 69) / 12);

/** The MIDI note of a period: the table of finetune 0 first, any other period (finetuned, extended range) by the nearest semitone. null = no note. */
export function periodeZuTon(p: number): number | null {
  if (!Number.isFinite(p) || p <= 0) return null;
  const i = MOD_PERIODEN.indexOf(p);
  if (i >= 0) return 48 + i;
  return Math.round(60 + 12 * Math.log2(MOD_C2_PERIODE / p));
}

const KOPF = 1084, ZEILEN = 64, MAX_DATEI = 32 * 1024 * 1024;
const PANS = [-1, 1, 1, -1];
const TEMPO_VON = 60, TEMPO_BIS = 200, TICKS_BIS = 24;

type Zelle = { periode: number; sample: number; eff: number; par: number };
type SampleKopf = { name: string; bytes: number; fein: number; vol: number; schleifeVon: number; schleifeLang: number };
type Inhalt = { laenge_beats: number; noten: Omit<Note, 'id'>[]; fx: FxEintrag[] };

const ascii = (b: Uint8Array, von: number, n: number): string => {
  let s = '';
  for (let i = 0; i < n && b[von + i] !== 0; i++) { const c = b[von + i]; s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' '; }
  return s.trim();
};
const sechzehntel = (semis: number): number => Math.max(1, Math.min(255, Math.round(semis * 16)));
const velVon = (v: number): number => Math.max(1, Math.round(v * 127 / 64));

function kanaeleVon(sig: string): { kanaele: number; flt8: boolean } | null {
  if (sig === 'M.K.' || sig === 'M!K!' || sig === 'FLT4' || sig === '4CHN') return { kanaele: 4, flt8: false };
  if (sig === '6CHN') return { kanaele: 6, flt8: false };
  if (sig === '8CHN') return { kanaele: 8, flt8: false };
  if (sig === 'FLT8') return { kanaele: 8, flt8: true };
  return null;
}

/** Read a ProTracker module. Throws `ModFehler` (grund `mod_ungueltig`, byte `offset`, English text) for a file that cannot be read; nothing else. */
export function leseMod(bytes: Uint8Array): ModErgebnis {
  try {
    return lese(bytes);
  } catch (e) {
    if (e instanceof ModFehler) throw e;
    throw new ModFehler(0, `the file could not be read (${e instanceof Error ? e.message : String(e)})`);
  }
}

/** A Soundtracker module with 15 samples has no signature: the header is 600 bytes (title, 15 sample headers, length, restart, 128 orders). It is
 *  recognised by plausibility only (printable title and sample names, volumes up to 64, length 1..128, a restart byte, orders below 64, the pattern data
 *  present), because nothing else marks it. */
function istSoundtracker15(b: Uint8Array): boolean {
  if (b.length < 600) return false;
  const druckbar = (von: number, n: number): boolean => {
    for (let i = 0; i < n; i++) { const c = b[von + i]; if (c !== 0 && (c < 32 || c > 126)) return false; }
    return true;
  };
  if (!druckbar(0, 20)) return false;
  for (let i = 0; i < 15; i++) {
    const o = 20 + i * 30;
    if (!druckbar(o, 22) || b[o + 25] > 64) return false;
    if ((((b[o + 22] << 8) | b[o + 23]) * 2) > b.length) return false;
  }
  if (b[470] < 1 || b[470] > 128 || b[471] > 127) return false;
  let hoechste = 0;
  for (let i = 0; i < 128; i++) { if (b[472 + i] > 63) return false; hoechste = Math.max(hoechste, b[472 + i]); }
  return b.length >= 600 + (hoechste + 1) * ZEILEN * 16;
}

function lese(b: Uint8Array): ModErgebnis {
  if (!(b instanceof Uint8Array)) throw new ModFehler(0, 'a Uint8Array with the bytes of the module is expected');
  if (b.length > MAX_DATEI) throw new ModFehler(0, `the file is larger than ${MAX_DATEI} bytes`);
  const sig = b.length >= KOPF ? String.fromCharCode(b[1080], b[1081], b[1082], b[1083]) : '';
  let art = b.length >= KOPF ? kanaeleVon(sig) : null;
  const unbekannt: Record<string, number> = {};
  const zaehle = (k: string): void => { unbekannt[k] = (unbekannt[k] ?? 0) + 1; };
  const alt15 = art === null && istSoundtracker15(b);
  if (alt15) { art = { kanaele: 4, flt8: false }; zaehle('15 sample module, effects read as ProTracker'); }
  if (art === null) {
    if (b.length < KOPF) throw new ModFehler(b.length, `the file ends before the header: at least ${KOPF} bytes are needed`);
    throw new ModFehler(1080, `unknown signature "${sig.replace(/[^ -~]/g, '?')}" (M.K. M!K! FLT4 4CHN 6CHN 8CHN FLT8 expected)`);
  }
  const { kanaele, flt8 } = art;
  const nSamples = alt15 ? 15 : 31, kopf = alt15 ? 600 : KOPF, posLaenge = alt15 ? 470 : 950, posListe = alt15 ? 472 : 952;
  const laengeSong = b[posLaenge];
  if (laengeSong < 1 || laengeSong > 128) throw new ModFehler(posLaenge, `song length ${laengeSong} is not in 1..128`);
  const ord: number[] = [];
  let hoechste = 0;
  for (let i = 0; i < 128; i++) {
    const v = b[posListe + i];
    if (i < laengeSong && v > 127) throw new ModFehler(posListe + i, `order position ${i} names pattern ${v}, at most 127 is possible`);
    if (v <= 127) hoechste = Math.max(hoechste, v);
    if (i < laengeSong) ord.push(flt8 ? v >> 1 : v);
  }
  const muster = flt8 ? (hoechste >> 1) + 1 : hoechste + 1;
  const blockKanaele = flt8 ? 4 : kanaele, bloecke = flt8 ? muster * 2 : muster;
  const datenAb = kopf + bloecke * ZEILEN * blockKanaele * 4;
  if (b.length < datenAb) {
    throw new ModFehler(b.length, `pattern data is incomplete: ${muster} patterns of ${kanaele} channels need ${datenAb} bytes`);
  }
  const zelleVon = (pat: number, zeile: number, ch: number): Zelle => {
    const blk = flt8 ? pat * 2 + (ch >= 4 ? 1 : 0) : pat, k = flt8 ? ch % 4 : ch;
    const o = kopf + ((blk * ZEILEN + zeile) * blockKanaele + k) * 4;
    return { periode: ((b[o] & 15) << 8) | b[o + 1], sample: (b[o] & 0xf0) | (b[o + 2] >> 4), eff: b[o + 2] & 15, par: b[o + 3] };
  };

  // samples: header, then the data in order behind the patterns
  const koepfe: (SampleKopf | null)[] = [];
  const samples: ModSample[] = [];
  let off = datenAb;
  for (let i = 0; i < nSamples; i++) {
    const o = 20 + i * 30;
    const wort = (b[o + 22] << 8) | b[o + 23], ft = alt15 ? 0 : b[o + 24] & 15;   // the finetune byte of a 15 sample module is not a finetune
    const k: SampleKopf = {
      name: ascii(b, o, 22), bytes: wort * 2, fein: ft < 8 ? ft : ft - 16, vol: Math.min(b[o + 25], 64),
      schleifeVon: ((b[o + 26] << 8) | b[o + 27]) * 2, schleifeLang: ((b[o + 28] << 8) | b[o + 29]) * 2,
    };
    const daten0 = off;
    off += k.bytes;
    if (wort <= 1) { koepfe.push(null); continue; }   // one word or none is an empty slot
    koepfe.push(k);
    const daten = new Float32Array(k.bytes * 2);
    const da = Math.max(0, Math.min(k.bytes, b.length - daten0));
    if (da < k.bytes) zaehle('sample data truncated');
    for (let j = 0; j < da; j++) { const v = ((b[daten0 + j] << 24) >> 24) / 128; daten[2 * j] = v; daten[2 * j + 1] = v; }
    const schleife = k.schleifeLang > 2 && k.schleifeVon < k.bytes;
    samples.push({
      nr: i + 1, ...(k.name !== '' ? { name: k.name } : {}), daten, rate: MOD_RATE, grund: MOD_GRUND,
      schleife: schleife ? 1 : 0, s_von: schleife ? k.schleifeVon : 0, s_laenge: schleife ? Math.min(k.schleifeLang, k.bytes - k.schleifeVon) : 0,
      pegel: 1, fein: k.fein,   // the volume of the sample is carried by the velocity of the notes (see velVon), the slot plays at full level
    });
  }

  // The course of the song, row by row as ProTracker plays it: Bxx and Dxx move the play position, E6x loops a part of a pattern, Fxx sets speed and tempo.
  // A section is a run of rows without a jump: the order position ends at the pattern end or at a break, a jump starts a new one. The rows of a pattern
  // loop are written out (the section holds each pass), positions the course never reaches are not imported. The song ends where it runs into a row it
  // has already played (a Bxx back to the start is the loop point of the song, not more music) or at the end of the order list.
  const weg = { tempo_wechsel: 0, sprung: 0, muster_schleife: 0, unbekannt };
  const abschnitte: { pat: number; zeilen: number[] }[] = [];
  let speed = 6, tempo = 125, ticksStart = 6, sekunden = 0, zeilenZahl = 0, unerreicht = 0, hatEE = false;
  {
    const gespielt = new Set<number>(), erreicht = new Set<number>();
    const schleifeVon = new Array<number>(kanaele).fill(0), schleifeRest = new Array<number>(kanaele).fill(0);
    let pos = 0, row = 0, neu = true, erste = true;
    const GRENZE = 128 * ZEILEN * 8;   // a safety cap against loops that never end
    while (pos < ord.length && zeilenZahl < GRENZE) {
      const schluessel = pos * ZEILEN + row;
      if (gespielt.has(schluessel)) break;
      gespielt.add(schluessel); erreicht.add(pos);
      if (neu) { abschnitte.push({ pat: ord[pos], zeilen: [] }); neu = false; }
      abschnitte[abschnitte.length - 1].zeilen.push(row);
      zeilenZahl++;
      let b = -1, d = -1, verzoegerung = 0, schleifeZu = -1;
      for (let c = 0; c < kanaele; c++) {
        const z = zelleVon(ord[pos], row, c), x = z.par >> 4, y = z.par & 15;
        if (z.eff === 0xf) {
          if (z.par === 0) zaehle('F00');
          else if (z.par >= 32) { if (!erste && z.par !== tempo) weg.tempo_wechsel++; tempo = z.par; }
          else { if (!erste && z.par !== speed) weg.tempo_wechsel++; speed = z.par; }
        } else if (z.eff === 0xb) b = z.par;
        else if (z.eff === 0xd) d = z.par;
        else if (z.eff === 0xe && x === 6) {
          if (y === 0) schleifeVon[c] = row;
          else {
            if (schleifeRest[c] === 0) schleifeRest[c] = y; else schleifeRest[c]--;
            if (schleifeRest[c] > 0) schleifeZu = schleifeVon[c];
          }
        } else if (z.eff === 0xe && x === 0xe) { verzoegerung = Math.max(verzoegerung, y); hatEE = true; }
      }
      if (erste) { ticksStart = speed; erste = false; }
      sekunden += speed * (1 + verzoegerung) * 2.5 / tempo;
      // a pattern loop on the row wins over Bxx/Dxx on the same row (the jump counts on the pass that ends the loop)
      if (schleifeZu >= 0) {
        for (let r = schleifeZu; r <= row; r++) gespielt.delete(pos * ZEILEN + r);
        row = schleifeZu;
        continue;
      }
      if (b >= 0 || d >= 0) {
        const dez = (d >> 4) * 10 + (d & 15), nr = d >= 0 && dez < ZEILEN ? dez : 0;
        const np = b >= 0 ? b : pos + 1;
        if (b >= 0 && (np >= ord.length || gespielt.has(np * ZEILEN + nr))) { weg.sprung++; break; }   // the loop point of the song, or a jump out of the list
        pos = np; row = nr; neu = true;
        continue;
      }
      row++;
      if (row >= ZEILEN) { row = 0; pos++; neu = true; }
    }
    if (zeilenZahl >= GRENZE) weg.muster_schleife++;
    unerreicht = ord.length - erreicht.size;
  }

  // tempo: a row lasts speed ticks of 2.5 / tempo seconds; at LPB 4 one row lasts 15 / BPM seconds, so BPM = tempo * 6 / speed and ticks = speed. The project
  // has one tempo and no tempo map: with changes in the song (Fxx, EEx) the BPM is the one that keeps the length of the song (rows * 15 / seconds played),
  // the ticks stay the start speed. The project tempo is limited to 60..200: a song faster than that is read at 8 rows per beat (half the BPM), a slower one
  // at 2 rows per beat (double the BPM), so the rows keep their length in time.
  const mittel = weg.tempo_wechsel > 0 || hatEE;
  const bpm4 = zeilenZahl * 15 / sekunden;
  const lpb = bpm4 > TEMPO_BIS ? 8 : bpm4 < TEMPO_VON ? 2 : 4;
  let bpm = Math.round(bpm4 * 4 / lpb * 1000) / 1000;
  if (bpm < TEMPO_VON || bpm > TEMPO_BIS) { bpm = Math.min(TEMPO_BIS, Math.max(TEMPO_VON, bpm)); zaehle('tempo outside 60..200'); }
  let ticks = ticksStart;
  if (ticks > TICKS_BIS) { ticks = TICKS_BIS; zaehle('speed above 24'); }

  // channel by channel through the song: notes, effects and the running state of ProTracker (sample, volume, period)
  const inhalte: (Inhalt | null)[][] = [];
  for (let c = 0; c < kanaele; c++) {
    let sample = 0, vol = 64, periode = MOD_C2_PERIODE;
    const spur: (Inhalt | null)[] = [];
    abschnitte.forEach((ab) => {
      const noten: Omit<Note, 'id'>[] = [], fx: FxEintrag[] = [];
      for (let ri = 0; ri < ab.zeilen.length; ri++) {
        const z = zelleVon(ab.pat, ab.zeilen[ri], c), beat = ri / lpb;
        const e = (spalte: 0 | 1, code: string, wert: number): void => { fx.push({ beat, spalte, code, wert }); };
        if (z.sample > 0) { sample = z.sample; vol = koepfe[z.sample - 1]?.vol ?? 64; }
        if (z.eff === 0xc) vol = Math.min(z.par, 64);
        let hatNote = false;
        const periodeVor = periode;   // a glide speed is read at the pitch the glide starts from
        if (z.periode > 0) {
          const t = periodeZuTon(z.periode);
          if (t === null || t < TON_UNTEN || t > TON_OBEN) zaehle('period out of range');
          else if (sample === 0) zaehle('note without sample');
          else if (koepfe[sample - 1] === null) zaehle('note on empty sample');
          else { noten.push({ beat, laenge: 0, ton: t, vel: velVon(vol), platz: sample }); hatNote = true; periode = z.periode; }
        }
        const x = z.par >> 4, y = z.par & 15;
        switch (z.eff) {
          case 0: if (z.par !== 0) e(0, 'ARP', z.par); break;
          case 1: if (z.par !== 0) e(0, 'SLU', sechzehntel(12 * Math.log2(periode / Math.max(periode - z.par, 1)))); break;
          case 2: if (z.par !== 0) e(0, 'SLD', sechzehntel(12 * Math.log2((periode + z.par) / periode))); break;
          case 3: e(0, 'GLD', z.par === 0 ? 0 : sechzehntel(12 * Math.log2(periodeVor / Math.max(periodeVor - z.par, 1)))); break;
          case 4: e(0, 'VIB', (x << 4) | vibTiefe(y, periode)); break;
          case 5: e(0, 'GLD', 0); if (z.par !== 0) e(1, 'VSL', z.par); break;
          case 6: e(0, 'VIB', 0); if (z.par !== 0) e(1, 'VSL', z.par); break;
          case 7: e(0, 'TRM', z.par); break;
          case 8: e(0, 'PAN', z.par); break;
          case 9:
            if (z.par === 0) break;
            if (!hatNote) { zaehle('9xx without note'); break; }
            e(0, 'OFS', Math.min(255, Math.max(1, Math.round(z.par * 256 * 256 / (koepfe[sample - 1]?.bytes ?? 1)))));
            break;
          case 0xa: if (z.par !== 0) e(0, 'VSL', z.par); break;
          case 0xb: case 0xd: break;   // the course of the song (above)
          case 0xc: if (!hatNote) e(0, 'LVL', Math.round(Math.min(z.par, 64) * 255 / 64)); break;
          case 0xe:
            if (x === 9) { if (y > 0) e(0, 'RTG', y); } else if (x === 6) break;   // E6x: unrolled in the course
            else zaehle(`E${x.toString(16).toUpperCase()}`);
            break;
          default: break;   // 0xf: speed and tempo, see the course of the song and the project tempo
        }
      }
      const rows = ab.zeilen.length;
      noten.forEach((n, i) => { n.laenge = (i + 1 < noten.length ? noten[i + 1].beat : rows / lpb) - n.beat; });
      spur.push(noten.length > 0 ? { laenge_beats: rows / lpb, noten, fx } : null);
    });
    inhalte.push(spur);
  }

  // the project: clips with equal content of one pattern on one channel are linked; ids come from the counters of the project
  const p = neuesProjekt(ab2name(b));
  p.tempo_bpm = bpm;
  let noteNr = 1, clipNr = 1, verbundNr = 0, summe = 0;
  // -6 dB per channel at four channels (as before); more channels add up louder (6CHN of a real module peaked at +1.4 dB), so the fader follows the count
  const faderDb = Math.round((-6 - 20 * Math.log10(kanaele / 4)) * 10) / 10;
  const abLaengen = abschnitte.map((a) => a.zeilen.length / lpb);
  const starts: number[] = [];
  abLaengen.forEach((l, i) => { starts.push(i === 0 ? 0 : starts[i - 1] + abLaengen[i - 1]); summe += l; });
  for (let c = 0; c < kanaele; c++) {
    const schluessel = inhalte[c].map((h, pos) => (h === null ? null : `${abschnitte[pos].pat}|${JSON.stringify(h)}`));
    const zahl = new Map<string, number>();
    schluessel.forEach((k) => { if (k !== null) zahl.set(k, (zahl.get(k) ?? 0) + 1); });
    const gruppe = new Map<string, { noten: Note[]; verbund?: string }>();
    const clips: MidiClip[] = [];
    inhalte[c].forEach((h, pos) => {
      const k = schluessel[pos];
      if (h === null || k === null) return;
      let g = gruppe.get(k);
      if (g === undefined) {
        g = { noten: h.noten.map((n) => ({ id: `n${noteNr++}`, ...n })) };
        if ((zahl.get(k) ?? 0) > 1) g.verbund = `v${++verbundNr}`;
        gruppe.set(k, g);
      }
      const clip: MidiClip = {
        id: `c${clipNr++}`, art: 'midi', name: `P${String(abschnitte[pos].pat).padStart(2, '0')}`, start_beat: starts[pos], laenge_beats: h.laenge_beats,
        noten: structuredClone(g.noten), ...(h.fx.length > 0 ? { fx: structuredClone(h.fx) } : {}), ...(g.verbund !== undefined ? { verbund: g.verbund } : {}),
      };
      clips.push(clip);
    });
    const s: Spur = {
      id: `s${c + 1}`, nr: c + 1, name: `Ch ${c + 1}`, farbe: SPUR_FARBEN[c % SPUR_FARBEN.length], art: 'instrument',
      geraet: { art: 'intern', name: 'bk', graph: 'amiga', parameter: {} }, fader_db: faderDb, pan: PANS[c % 4], mute: false, solo: false, clips,
    };
    p.spuren.push(s);
  }
  p.naechste_id = { spur: kanaele + 1, clip: clipNr, gruppe: 1, ...(verbundNr > 0 ? { verbund: verbundNr + 1 } : {}) };
  p.naechste_noten_id = noteNr;
  p.loop = { an: false, von_beat: 0, bis_beat: summe };
  p.tracker = {
    schema: 1, ...(lpb !== 4 ? { lpb } : {}), ...(ticks !== 6 ? { ticks } : {}),
    abschnitte: abschnitte.map((a, i) => ({ id: `a${i + 1}`, name: `P${String(a.pat).padStart(2, '0')}`, laenge_beats: abLaengen[i] })),
  };
  return {
    projekt: p, samples,
    bericht: { kanaele, muster, positionen: ord.length, samples: samples.length, weggelassen: weg,
      ...(mittel ? { tempo_gemittelt: true } : {}), ...(unerreicht > 0 ? { unerreicht } : {}) },
  };
}

// vibrato depth: ProTracker moves the period by up to (255 * y) >> 7 units; this tracker's depth is y / 8 semitone
function vibTiefe(y: number, periode: number): number {
  if (y === 0) return 0;
  const spitze = (255 * y) >> 7;
  return Math.max(1, Math.min(15, Math.round(12 * Math.log2((periode + spitze) / periode) * 8)));
}
const ab2name = (b: Uint8Array): string => ascii(b, 0, 20) || 'MOD import';
