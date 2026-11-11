// Standard MIDI File reader (format 0 and 1) for the MIDI import (docs/superpowers/specs/2026-11-10-midi-import.md).
// Pure: bytes in, a plain description out. No file access, no project, no dependency.
//
// What it reads: note on/off (running status, note-on with velocity 0 as note-off), program changes, the meta events track name, tempo, time signature and
// end of track. Everything else (controllers, pitch bend, aftertouch, sysex, other meta events) is skipped and only COUNTED in `ignoriert`, so the import
// can say what it did not carry over.
// What it refuses, with a reason that names the cause: not an SMF, format 2 (independent sequences), SMPTE time base, a damaged header.
// What it tolerates and reports in `hinweise`: a truncated or damaged track chunk (the events read so far are kept), notes still open at the end of the
// track (closed there), a note-off without a note-on (dropped), a zero-length note (one tick), more or fewer track chunks than the header says.
//
// Time stays in ticks here; `ticksProViertel` converts to beats exactly (beat = tick / ticksProViertel, a division of two integers).

export class SmfFehler extends Error {
  grund: 'smf_kein_smf' | 'smf_format2' | 'smf_smpte' | 'smf_beschaedigt' | 'smf_leer';
  constructor(grund: 'smf_kein_smf' | 'smf_format2' | 'smf_smpte' | 'smf_beschaedigt' | 'smf_leer', message: string) {
    super(message);
    this.name = 'SmfFehler';
    this.grund = grund;
  }
}

export interface SmfNote { tick: number; dauer: number; ton: number; vel: number }
/** the notes of one MIDI channel on one MIDI track: the unit the import turns into one project track */
export interface SmfTeil {
  spur: number;                 // index of the MTrk chunk (0-based)
  kanal: number;                // 0..15 (channel 10 of the standard = 9 here)
  name: string | null;          // the track name meta event of the chunk (shared by all channels of the chunk)
  programm: number | null;      // GM program 0..127 in force when the first note starts (null = never set)
  programme: number[];          // every distinct program the part used, in order of appearance
  noten: SmfNote[];             // sorted by tick, then pitch
}
export interface SmfTempo { tick: number; us: number; bpm: number }
export interface SmfTaktart { tick: number; zaehler: number; nenner: number }
export interface SmfHinweis { code: string; text: string }
export interface SmfDatei {
  format: 0 | 1;
  ticksProViertel: number;
  spurenImKopf: number;         // what the header announces
  spurenGelesen: number;        // MTrk chunks actually found
  spurNamen: (string | null)[]; // per chunk
  teile: SmfTeil[];             // only parts with at least one note
  tempi: SmfTempo[];            // sorted by tick; empty when the file sets none (the SMF default is 120)
  taktarten: SmfTaktart[];
  endeTick: number;             // last event of any track
  notenZahl: number;
  ignoriert: { controller: number; pitchbend: number; aftertouch: number; sysex: number; meta: number };
  hinweise: SmfHinweis[];
}

export const GM_PROGRAMME: readonly string[] = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar',
  'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];
export const gmProgrammName = (p: number): string => GM_PROGRAMME[p] ?? `Program ${p}`;

const MAX_BYTES = 16 * 1024 * 1024;

// text of a meta event: UTF-8 when it is valid UTF-8, else Latin-1 (most old files); control characters out, trimmed; empty = null
function metaText(b: Uint8Array): string | null {
  let s: string;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { s = new TextDecoder('latin1').decode(b); }
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

interface Offen { tick: number; vel: number }

export function leseSmf(roh: Uint8Array): SmfDatei {
  if (roh.length > MAX_BYTES) throw new SmfFehler('smf_beschaedigt', `file is ${roh.length} bytes (at most ${MAX_BYTES})`);
  let b = roh;
  const hinweise: SmfHinweis[] = [];
  const hinweis = (code: string, text: string): void => { hinweise.push({ code, text }); };
  const ascii = (o: number, n: number): string => String.fromCharCode(...b.subarray(o, o + n));
  // RIFF RMID wrapper (.rmi): the SMF is the data chunk
  if (b.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'RMID') {
    let o = 12, gefunden = false;
    while (o + 8 <= b.length) {
      const n = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
      if (ascii(o, 4) === 'data') { b = b.subarray(o + 8, Math.min(b.length, o + 8 + n)); gefunden = true; break; }
      o += 8 + n + (n & 1);
    }
    if (!gefunden) throw new SmfFehler('smf_kein_smf', 'RIFF/RMID file without a data chunk');
  }
  if (b.length < 14 || ascii(0, 4) !== 'MThd') throw new SmfFehler('smf_kein_smf', 'not a Standard MIDI File (no MThd header)');
  const u16 = (o: number): number => (b[o] << 8) | b[o + 1];
  const u32 = (o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const kopfLaenge = u32(4);
  if (kopfLaenge < 6 || 8 + kopfLaenge > b.length) throw new SmfFehler('smf_beschaedigt', `header length ${kopfLaenge} is invalid`);
  const formatRoh = u16(8), spurenImKopf = u16(10), division = u16(12);
  if (formatRoh === 2) throw new SmfFehler('smf_format2', 'format 2 (several independent sequences) is not supported; convert the file to format 0 or 1');
  if (formatRoh !== 0 && formatRoh !== 1) throw new SmfFehler('smf_beschaedigt', `unknown format ${formatRoh}`);
  if ((division & 0x8000) !== 0) throw new SmfFehler('smf_smpte',
    'SMPTE time base (frames per second) is not supported; the import needs ticks per quarter note');
  if (division === 0) throw new SmfFehler('smf_beschaedigt', 'ticks per quarter note is 0');
  const tpq = division;

  const teile: SmfTeil[] = [];
  const spurNamen: (string | null)[] = [];
  const tempi: SmfTempo[] = [];
  const taktarten: SmfTaktart[] = [];
  const ignoriert = { controller: 0, pitchbend: 0, aftertouch: 0, sysex: 0, meta: 0 };
  let endeTick = 0, spurIndex = 0, verwaist = 0, offenAmEnde = 0, nullLang = 0, notenZahl = 0;

  let pos = 8 + kopfLaenge;
  while (pos + 8 <= b.length) {
    const typ = ascii(pos, 4);
    let n = u32(pos + 4);
    const von = pos + 8;
    if (von + n > b.length) {
      if (typ === 'MTrk') hinweis('smf_abgeschnitten', `track chunk ${spurIndex} is cut off (${b.length - von} of ${n} bytes present)`);
      n = b.length - von;
    }
    pos = von + n;
    if (typ !== 'MTrk') continue;   // unknown chunks are skipped as the standard demands

    // --- one track chunk ---
    const t = b.subarray(von, von + n);
    const spur = spurIndex++;
    let p = 0, tick = 0, status = 0, name: string | null = null, defekt = false;
    const offen = new Map<number, Offen[]>();                 // key = channel * 128 + pitch
    const kanalProgramm: (number | null)[] = Array(16).fill(null);
    const teil = new Map<number, { noten: SmfNote[]; programme: number[]; erstProgramm: number | null; ersteNote: boolean }>();
    const teilVon = (k: number) => {
      let x = teil.get(k);
      if (!x) { x = { noten: [], programme: [], erstProgramm: null, ersteNote: false }; teil.set(k, x); }
      return x;
    };
    const vlq = (): number => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        if (p >= t.length) throw new RangeError('vlq');
        const c = t[p++];
        v = (v << 7) | (c & 0x7f);
        if ((c & 0x80) === 0) return v >>> 0;
      }
      throw new RangeError('vlq too long');
    };
    const schliesse = (k: number, ton: number, bis: number): boolean => {
      const l = offen.get(k * 128 + ton);
      const o = l?.shift();
      if (!o) return false;
      if (l!.length === 0) offen.delete(k * 128 + ton);
      let dauer = bis - o.tick;
      if (dauer < 1) { dauer = 1; nullLang++; }
      teilVon(k).noten.push({ tick: o.tick, dauer, ton, vel: o.vel });
      return true;
    };
    try {
      while (p < t.length) {
        tick += vlq();
        let s = t[p];
        if (s === undefined) throw new RangeError('eof');
        if (s >= 0x80) { p++; if (s < 0xf0) status = s; } else if (status === 0) throw new RangeError('data byte without running status');
        else s = status;
        if (s === 0xff) {                                      // meta
          const typM = t[p++]; const len = vlq();
          if (p + len > t.length) throw new RangeError('meta past end');
          const d = t.subarray(p, p + len); p += len;
          if (typM === 0x2f) { break; }                          // end of track
          else if (typM === 0x03) { if (name === null) name = metaText(d); }
          else if (typM === 0x51 && len === 3) {
            const us = (d[0] << 16) | (d[1] << 8) | d[2];
            if (us > 0) tempi.push({ tick, us, bpm: 60_000_000 / us });
            else hinweis('smf_tempo_null', `tempo of 0 microseconds per quarter at tick ${tick} ignored`);
          } else if (typM === 0x58 && len >= 2) taktarten.push({ tick, zaehler: d[0], nenner: 2 ** d[1] });
          else ignoriert.meta++;
          continue;
        }
        if (s === 0xf0 || s === 0xf7) {
          const len = vlq();
          if (p + len > t.length) throw new RangeError('sysex past end');
          p += len; ignoriert.sysex++; status = 0;
          continue;
        }
        if (s >= 0xf0) throw new RangeError(`system message 0x${s.toString(16)} in a track`);
        const kanal = s & 0x0f, art = s & 0xf0;
        const d1 = t[p++];
        if (d1 === undefined || d1 > 0x7f) throw new RangeError('bad data byte');
        if (art === 0xc0 || art === 0xd0) {                    // one data byte
          if (art === 0xc0) {
            kanalProgramm[kanal] = d1;
            const x = teilVon(kanal);
            if (!x.programme.includes(d1)) x.programme.push(d1);
            if (!x.ersteNote && x.erstProgramm === null) x.erstProgramm = d1;
            else if (!x.ersteNote) x.erstProgramm = d1;       // the last change before the first note wins
          } else ignoriert.aftertouch++;
          continue;
        }
        const d2 = t[p++];
        if (d2 === undefined || d2 > 0x7f) throw new RangeError('bad data byte');
        if (art === 0x90 && d2 > 0) {
          const x = teilVon(kanal);
          if (!x.ersteNote) { x.ersteNote = true; if (x.erstProgramm === null && kanalProgramm[kanal] !== null) x.erstProgramm = kanalProgramm[kanal]; }
          const k = kanal * 128 + d1;
          const l = offen.get(k);
          if (l) l.push({ tick, vel: d2 }); else offen.set(k, [{ tick, vel: d2 }]);
        } else if (art === 0x80 || art === 0x90) {
          if (!schliesse(kanal, d1, tick)) verwaist++;
        } else if (art === 0xa0) ignoriert.aftertouch++;
        else if (art === 0xb0) ignoriert.controller++;
        else if (art === 0xe0) ignoriert.pitchbend++;
      }
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      defekt = true;
      hinweis('smf_spur_beschaedigt', `track chunk ${spur} is damaged near byte ${p} (${(e as Error).message}); the events before that point are kept`);
    }
    endeTick = Math.max(endeTick, tick);
    for (const [k, l] of offen) for (const o of l) {          // notes still sounding: they end where the track ends
      const kanal = Math.floor(k / 128);
      teilVon(kanal).noten.push({ tick: o.tick, dauer: Math.max(1, tick - o.tick), ton: k % 128, vel: o.vel });
      offenAmEnde++;
    }
    void defekt;
    spurNamen.push(name);
    for (const [kanal, x] of [...teil.entries()].sort((a, c) => a[0] - c[0])) {
      if (x.noten.length === 0) continue;
      x.noten.sort((a, c) => a.tick - c.tick || a.ton - c.ton || a.vel - c.vel);
      notenZahl += x.noten.length;
      teile.push({ spur, kanal, name, programm: x.erstProgramm, programme: x.programme, noten: x.noten });
    }
  }
  if (spurIndex === 0) throw new SmfFehler('smf_leer', 'the file holds no track chunk');
  if (spurIndex !== spurenImKopf) hinweis('smf_spurzahl', `the header announces ${spurenImKopf} tracks, the file holds ${spurIndex}`);
  if (verwaist > 0) hinweis('smf_note_off_ohne_on', `${verwaist} note-off events without a note-on dropped`);
  if (offenAmEnde > 0) hinweis('smf_offene_noten', `${offenAmEnde} notes had no note-off and end with their track`);
  if (nullLang > 0) hinweis('smf_nulldauer', `${nullLang} notes of length 0 were set to one tick`);
  tempi.sort((a, c) => a.tick - c.tick);
  taktarten.sort((a, c) => a.tick - c.tick);
  return { format: formatRoh as 0 | 1, ticksProViertel: tpq, spurenImKopf, spurenGelesen: spurIndex, spurNamen, teile, tempi, taktarten, endeTick, notenZahl,
    ignoriert, hinweise };
}
