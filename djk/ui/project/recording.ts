// 1.8 Slice 1: reine Teile der Take-Übernahme. Rohdatei (f32 verschränkt, 48 kHz, Stereo) -> WAV (IEEE float, Kopf 58 Byte wie core/include/cypherdj/wav.h),
// und der Clip auf der Spur nach der Ersetzen-Regel (Spec 1.8 R7) mit den vorhandenen Befehlen, damit ein Verlaufseintrag entsteht.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BefehlFehler, compFade, fuehreListeAus, pruefeGrenzen, teileClipsAn } from './commands.ts';
import { MAX_CLIPS, MAX_TAKES_PRO_SPUR, neueId, sucheSpur, type AudioClip, type Clip, type MidiClip, type Projekt } from './model.ts';
import { istMidiTakeKopie, istTakeKopie, klingtGleich, TAKE_KOPIE_EPS } from './takes.ts';
import { REC_EINGANG } from '../../contract/streams.ts';

export class TakeFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; }
}
const RATE = 48000;

export function eingangsCode(name: string): number {
  const code = (REC_EINGANG as Record<string, number>)[name];   // S18: explicit table, no longer 11 + index (erz/4 and erz/8 have no tap)
  if (code === undefined) throw new TakeFehler('eingang_fehlt', name);
  return code;
}

export function wavKopf(frames: number): Buffer {
  const daten = frames * 8;
  const k = Buffer.alloc(58);
  k.write('RIFF', 0, 'ascii'); k.writeUInt32LE(50 + daten, 4); k.write('WAVE', 8, 'ascii');
  k.write('fmt ', 12, 'ascii'); k.writeUInt32LE(18, 16); k.writeUInt16LE(3, 20); k.writeUInt16LE(2, 22); k.writeUInt32LE(RATE, 24);
  k.writeUInt32LE(RATE * 8, 28); k.writeUInt16LE(8, 32); k.writeUInt16LE(32, 34); k.writeUInt16LE(0, 36);
  k.write('fact', 38, 'ascii'); k.writeUInt32LE(4, 42); k.writeUInt32LE(frames, 46);
  k.write('data', 50, 'ascii'); k.writeUInt32LE(daten, 54);
  return k;
}

// Streamt Rohdatei -> WAV (nie ersetzen: Öffnen mit 'wx') und rechnet die sha256 über die ganze WAV. Sync: eine Aufnahme ist nach dem Ende abgeschlossen.
export function schreibeWavAusF32(quelle: string, ziel: string): { frames: number; sha256: string } {
  const frames = Math.floor(fs.statSync(quelle).size / 8);
  // R1: RIFF-Größe ist 32 Bit (ab 3 h 6 min); vor dem Öffnen, es bleibt keine leere Datei
  if (50 + frames * 8 > 0xFFFFFFFF) throw new TakeFehler('take_zu_lang', `${frames} Frames`);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  const aus = fs.openSync(ziel, 'wx');
  const ein = fs.openSync(quelle, 'r');
  try {
    const h = crypto.createHash('sha256');
    const kopf = wavKopf(frames);
    h.update(kopf);
    fs.writeSync(aus, kopf);
    const puf = Buffer.allocUnsafe(1 << 20);
    let rest = frames * 8;
    while (rest > 0) {
      const n = fs.readSync(ein, puf, 0, Math.min(puf.length, rest), null);
      if (n <= 0) break;
      h.update(puf.subarray(0, n));
      fs.writeSync(aus, puf, 0, n);
      rest -= n;
    }
    fs.fsyncSync(aus);
    return { frames, sha256: h.digest('hex') };
  } catch (e) { fs.rmSync(ziel, { force: true }); throw e; }   // R1: keine halbe WAV zurücklassen ('wx': die Datei ist unsere)
  finally { fs.closeSync(ein); fs.closeSync(aus); }
}

// Review MINOR 5 (Slice 6): dasselbe in Stücken von 1 MiB über fs.promises, die Ereignisschleife bleibt frei (bei 600 s sind es 4 x 230 MB)
export async function schreibeWavAusF32Stueckweise(quelle: string, ziel: string, ordnerAnlegen = true): Promise<{ frames: number; sha256: string }> {
  const frames = Math.floor(fs.statSync(quelle).size / 8);
  if (50 + frames * 8 > 0xFFFFFFFF) throw new TakeFehler('take_zu_lang', `${frames} Frames`);
  if (ordnerAnlegen) fs.mkdirSync(path.dirname(ziel), { recursive: true });
  const aus = await fs.promises.open(ziel, 'wx');
  try {
    const ein = await fs.promises.open(quelle, 'r');
    try {
      const h = crypto.createHash('sha256');
      const kopf = wavKopf(frames);
      h.update(kopf);
      await aus.write(kopf);
      const puf = Buffer.allocUnsafe(1 << 20);
      let rest = frames * 8;
      while (rest > 0) {
        const { bytesRead: n } = await ein.read(puf, 0, Math.min(puf.length, rest), null);
        if (n <= 0) break;
        h.update(puf.subarray(0, n));
        await aus.write(puf, 0, n);
        rest -= n;
      }
      await aus.sync();
      return { frames, sha256: h.digest('hex') };
    } finally { await ein.close(); }
  } catch (e) { await aus.close().catch(() => {}); fs.rmSync(ziel, { force: true }); throw e; }
  finally { await aus.close().catch(() => {}); }
}

// 1.8 S2b (D9): laengeBeats is the length of the WHOLE raw take (pass plus tail). versatzSamples is the own latency offset of the track (default 0),
// nachlaufSamples the one tail of the run (nachlauf_lauf, default 0), abgebrochen marks a take that ended early (no tail exists). The clip gets
// offset_s = versatz / 48000 and the length of the pass: laengeBeats - nachlauf, or for an early-ended take laengeBeats - own versatz.
// Both zero: byte-identical to slice 1.
//
// 1.8 S4b.2 (D6, D18): punch is cut here, not in the core. `punch` is the range [von_beat, bis_beat) AFTER the ein/aus resolution of the caller (both:
// the project range; only ein: from its von_beat to the end of the take; only aus: from the start of the take to its bis_beat). Only [von, bis) of the
// take is placed; the clip gets offset_s = take offset + (von - take start) in seconds. Where the range cuts into the take (not at the take's own start
// or end) and a main-lane clip touches the new clip there, both get a PUNCH_FADE_SAMPLES fade (capped at half the shorter clip); an edge to silence gets
// none. A take outside the range places nothing
// (punch_leer, the raw file stays). Without `punch` every result is the slice 1 result.
export interface TakeAngabe {
  spurId: string; startBeat: number; laengeBeats: number; sha256: string; pfadHinweis: string; name: string;
  versatzSamples?: number; nachlaufSamples?: number; abgebrochen?: boolean;
  punch?: { von_beat: number; bis_beat: number };
}
export const PUNCH_FADE_SAMPLES = 96;   // AK20: ARR_NAHT of the core (2 ms at 48 kHz)
const EPS = 1e-9;
const lauf = (p: Projekt, b: unknown): Projekt => fuehreListeAus(p, [b]).projekt;
export const ORIGINAL_NAME = 'Original';   // 1.14 comping (spec R3): the lane that keeps what a recording overwrote

// 1.14 comping (spec R3): the take replaces the range [start, start + length) of the main lane as before, but nothing is lost any more.
// The take clip also goes into a take lane (the newest one without a clip in the range, else a new "Take <n>"). Overlapped main clips are cut at the
// range edges (shared with comp_waehlen); parts inside that are copies of a take clip (R6) are dropped, all others move into the Original lane.
// Pure: the input is never touched; every failure throws before anything is returned (takes_voll, zu_gross, ersetzen_loop, veraltet_spur).
export function nehmeTakeAuf(projekt: Projekt, a: TakeAngabe): Projekt {
  if (!sucheSpur(projekt, a.spurId)) throw new TakeFehler('veraltet_spur', a.spurId);
  try { return nehme(projekt, a); } catch (e) {
    if (e instanceof BefehlFehler && e.grund === 'zu_gross') throw new TakeFehler('zu_gross', e.detail);   // MAX_CLIPS: report the reason
    throw e;
  }
}
function nehme(projekt: Projekt, a: TakeAngabe): Projekt {
  const versatz = a.versatzSamples ?? 0, nachlauf = a.nachlaufSamples ?? 0;
  const proSample = projekt.tempo_bpm / 60 / RATE;                       // beats per sample
  const abzug = a.abgebrochen ? versatz : nachlauf;                      // D9: a take with a tail loses the tail, an early-ended one its own offset
  const laenge = abzug === 0 ? a.laengeBeats : Math.max(0, a.laengeBeats - abzug * proSample);
  if (!(laenge > 0)) throw new TakeFehler('leer', 'the take holds no audio after the latency offset');
  const takeVon = a.startBeat, takeBis = a.startBeat + laenge;
  const von = a.punch ? Math.max(takeVon, a.punch.von_beat) : takeVon, bis = a.punch ? Math.min(takeBis, a.punch.bis_beat) : takeBis;
  if (!(bis - von > EPS)) throw new TakeFehler('punch_leer', `punch ${a.punch?.von_beat}..${a.punch?.bis_beat} against the take ${takeVon}..${takeBis}`);
  const schnittVorn = a.punch !== undefined && a.punch.von_beat > takeVon + EPS, schnittHinten = a.punch !== undefined && a.punch.bis_beat < takeBis - EPS;
  const schneidet = (c: { start_beat: number; laenge_beats: number }, t: number) => c.start_beat < t - EPS && c.start_beat + c.laenge_beats > t + EPS;
  const ueberlappt = (c: { start_beat: number; laenge_beats: number }) => c.start_beat < bis - EPS && c.start_beat + c.laenge_beats > von + EPS;
  let p = structuredClone(projekt);
  let spur = sucheSpur(p, a.spurId)!;
  // Loop clips cannot be split (clip_teilen); they may only be covered completely or untouched
  for (const c of spur.clips) {
    if (c.loop_beats != null && (schneidet(c, von) || schneidet(c, bis))) throw new TakeFehler('ersetzen_loop', c.id);
  }
  teileClipsAn(p, spur, [von, bis]);
  // what the range overwrites: a part that is a copy of a take clip (inside its range) is dropped, every other part is kept in the Original lane
  const alleTakeClips = (spur.takes ?? []).flatMap((t) => t.clips);
  const istKopie = (c: Clip): boolean => c.art === 'audio' && alleTakeClips.some((t) => klingtGleich(c, t, p.tempo_bpm)
    && c.start_beat >= t.start_beat - TAKE_KOPIE_EPS && c.start_beat + c.laenge_beats <= t.start_beat + t.laenge_beats + TAKE_KOPIE_EPS);
  const drin = spur.clips.filter(ueberlappt);
  const zuOriginal = drin.filter((c) => !istKopie(c)) as AudioClip[];
  // lane choice: the newest take lane (never the Original lane) without a clip in the range, else a new one
  const takeLanes = (spur.takes ?? []).filter((t) => t.art === undefined);
  const neueste = takeLanes.at(-1);
  const wiederverwenden = neueste !== undefined && !neueste.clips.some(ueberlappt);
  const hatOriginal = (spur.takes ?? []).some((t) => t.art === 'original');
  const noetig = (wiederverwenden ? 0 : 1) + (zuOriginal.length > 0 && !hatOriginal ? 1 : 0);
  if ((spur.takes ?? []).length + noetig > MAX_TAKES_PRO_SPUR) throw new TakeFehler('takes_voll', `${(spur.takes ?? []).length} lanes + ${noetig}`);
  const verschoben = structuredClone(zuOriginal);
  spur.clips = spur.clips.filter((c) => !drin.includes(c));
  if (!wiederverwenden) p = lauf(p, { befehl: 'take_neu', spur_id: a.spurId });
  if (verschoben.length > 0 && !hatOriginal) {
    p = lauf(p, { befehl: 'take_neu', spur_id: a.spurId, name: ORIGINAL_NAME });
    sucheSpur(p, a.spurId)!.takes!.at(-1)!.art = 'original';
  }
  spur = sucheSpur(p, a.spurId)!;
  const original = spur.takes?.find((t) => t.art === 'original');
  if (original) {
    original.clips.push(...verschoben);
    original.clips.sort((x, y) => x.start_beat - y.start_beat);
  }
  // MAX_CLIPS counts main and take clips; the recording adds two (main and take lane). Named here so the reason is zu_gross, not a model error.
  const vorhanden = p.spuren.reduce((n, x) => n + x.clips.length + (x.takes ?? []).reduce((m, t) => m + t.clips.length, 0), 0);
  if (vorhanden + 2 > MAX_CLIPS) throw new TakeFehler('zu_gross', `${vorhanden + 2} clips (at most ${MAX_CLIPS})`);
  const vorher = new Set(spur.clips.map((c) => c.id));
  // laenge_beats: slice 1: the length as it was, bit for bit
  p = lauf(p, { befehl: 'clip_neu', spur_id: a.spurId, art: 'audio', start_beat: von, laenge_beats: a.punch ? bis - von : laenge,
    
    sha256: a.sha256, pfad_hinweis: a.pfadHinweis, name: a.name });
  spur = sucheSpur(p, a.spurId)!;
  const haupt = spur.clips.find((c) => !vorher.has(c.id)) as AudioClip;
  // the sample the player's signal begins at (the latency offset) plus the part of the take in front of the punch-in; the lane copy below carries it
  const versatzS = versatz / RATE + (von - takeVon) * 60 / projekt.tempo_bpm;
  if (versatzS !== 0) haupt.offset_s = versatzS;
  if (schnittVorn || schnittHinten) {   // seam fades, only where a main-lane clip touches the new clip at a cut edge
    const fade = (PUNCH_FADE_SAMPLES / RATE) * projekt.tempo_bpm / 60;
    const ende = (c: Clip): number => c.start_beat + c.laenge_beats;
    for (const m of spur.clips.filter((c): c is AudioClip => c.art === 'audio' && c !== haupt)) {
      const ziel = Math.min(fade, Math.min(m.laenge_beats, haupt.laenge_beats) / 2);
      if (schnittVorn && Math.abs(ende(m) - von) <= EPS) { compFade(m, 'fade_aus_beats', ziel); compFade(haupt, 'fade_ein_beats', ziel); }
      if (schnittHinten && Math.abs(m.start_beat - bis) <= EPS) { compFade(haupt, 'fade_aus_beats', ziel); compFade(m, 'fade_ein_beats', ziel); }
    }
  }
  const lane = spur.takes!.filter((t) => t.art === undefined).at(-1)!;
  lane.clips.push({ ...structuredClone(haupt), id: neueId(p, 'clip') });
  pruefeGrenzen(p);
  return p;
}

// ---- 1.8 T8: the MIDI take (eingang 30, midi_ein_1) ------------------------------------------------------------------------------------------
// The core writes midi-<kennung>.bin: records of 12 bytes, little endian: i64 sample (core sample, absolute), u8 status, u8 d1, u8 d2, u8 pad
// (T7a, recording_thread.cpp).
export interface MidiEreignis { sample: number; status: number; d1: number; d2: number }
const MIDI_SATZ = 12;
export function leseMidiDatei(roh: Buffer): MidiEreignis[] {
  const n = Math.floor(roh.length / MIDI_SATZ);   // a torn last record (the core died mid-write) is dropped
  return Array.from({ length: n }, (_, i) => ({ sample: Number(roh.readBigInt64LE(i * MIDI_SATZ)), status: roh[i * MIDI_SATZ + 8],
    d1: roh[i * MIDI_SATZ + 9], d2: roh[i * MIDI_SATZ + 10] }));
}

export interface MidiTakeAngabe {
  spurIds: string[];                                   // the instrument tracks that took part in the run; every one gets the same notes
  startBeat: number; bpm: number; startSample: number; // project beat of the take start, project tempo (constant during a run), core sample of the take start
  ereignisse: MidiEreignis[];                          // in file order (time order)
  versatzSamples?: number;                             // ausgang_vorhalt + midi.versatz_samples: how late the player's notes are against the music he heard
  overdub: boolean;                                    // R7: true adds the notes to the clips of the range, false replaces the range
  endeBeat: number;                                    // end of the take (the pass without the tail); a note still open there ends there
  punch?: { von_beat: number; bis_beat: number };      // the range after the ein/aus resolution of the caller, as for audio
  name?: string;
  // 4.2: the loop of the run (project.loop at the start, only when on); replace mode keeps every pass as a take
  loop?: { von_beat: number; bis_beat: number };
}
interface MidiNote { start: number; ende: number; ton: number; vel: number }
const runde9 = (x: number): number => Math.round(x * 1e9) / 1e9;

// Pairs note on and note off by pitch alone into notes in beats, as the core recorder builds the file (T7a, recording_thread.cpp midi_ereignis: l.an[ton]; the
// channel is only remembered to label its synthetic Off). An Off of any channel closes the open pitch; an Off without an On inside the take (held from before,
// or its On was refused by a full ring) is dropped; an On without an Off ends at endeBeat; a repeated On on an open pitch, on any channel, ends the old note at
// the new onset. Keying by channel too would leave a note hanging when a channel rotation (MPE) re-strikes a pitch on another channel. Control change and
// every other message is not a note. Notes of no length are dropped.
function paareNoten(a: MidiTakeAngabe): MidiNote[] {
  const proSample = a.bpm / (60 * RATE), versatz = a.versatzSamples ?? 0;
  const beat = (sample: number): number => runde9(a.startBeat + (sample - a.startSample - versatz) * proSample);
  const offen = new Map<number, { start: number; vel: number }>();   // by pitch
  const fertig: MidiNote[] = [];
  const schliesse = (ton: number, ende: number): void => {
    const o = offen.get(ton)!;
    offen.delete(ton);
    if (ende - o.start > EPS) fertig.push({ start: o.start, ende, ton, vel: o.vel });
  };
  for (const e of a.ereignisse) {
    const art = e.status & 0xF0, ton = e.d1 & 0x7F;
    const ein = art === 0x90 && e.d2 > 0, ab = art === 0x80 || (art === 0x90 && e.d2 === 0);
    if (ein) {
      if (offen.has(ton)) schliesse(ton, beat(e.sample));
      offen.set(ton, { start: beat(e.sample), vel: e.d2 });
    } else if (ab && offen.has(ton)) schliesse(ton, beat(e.sample));
  }
  for (const k of [...offen.keys()]) schliesse(k, a.endeBeat);
  return fertig;
}

// 1.8 T8 (spec 4.4 "taking over a take", R7): the notes of the MIDI take go onto the instrument tracks `spurIds`. Replace (overdub false): clips are cut at the
// range edges, what lies inside goes, one new clip covers the range. Overdub: nothing is cut; the notes join the clip that covers their onset, and
// every stretch of the range that no clip covers gets a clip of its own. Note ids come from the one project counter (spec 6.26): an id is never
// reused, also not after undo.
// Pure and all or nothing: the input is never touched, every failure throws before anything is returned (veraltet_spur, art_passt_nicht,
// keine_noten, punch_leer, leer, ersetzen_loop, zu_gross). A loop clip cannot be cut (as for audio), and notes added to one would repeat:
// both give ersetzen_loop.
export function nehmeMidiAuf(projekt: Projekt, a: MidiTakeAngabe): Projekt {
  for (const id of a.spurIds) {
    const s = sucheSpur(projekt, id);
    if (!s) throw new TakeFehler('veraltet_spur', id);
    if (s.art !== 'instrument') throw new TakeFehler('art_passt_nicht', `${id} is not an instrument track`);
  }
  const durch = durchlaeufe(a);
  if (durch !== null) return nehmeDurchlaeufe(projekt, a, durch);
  const { von, bis, noten } = fasseNoten(a);
  let p = structuredClone(projekt);
  try { for (const id of a.spurIds) p = a.overdub ? ueberspiele(p, id, noten, von, bis, a.name) : ersetze(p, id, noten, von, bis, a.name); } catch (e) {
    if (e instanceof BefehlFehler && e.grund === 'zu_gross') throw new TakeFehler('zu_gross', e.detail);
    throw e;
  }
  pruefeGrenzen(p);
  return p;
}
// The number of notes the take places per track (for the answer); throws what nehmeMidiAuf throws about the take itself (leer, punch_leer, keine_noten)
export const midiTakeNoten = (a: MidiTakeAngabe): number => {
  const d = durchlaeufe(a);
  return d === null ? fasseNoten(a).noten.length : d.reduce((n, x) => n + x.noten.length, 0);
};
// 4.2: the passes of a replace-mode run over a loop. null = the old path without takes (overdub or punch). No loop or a start outside it is one pass.
export interface Durchlauf { k: number; von: number; bis: number; noten: MidiNote[]; voll: boolean }   // von/bis and the notes in PROJECT beats
function durchlaeufe(a: MidiTakeAngabe): Durchlauf[] | null {
  if (a.overdub || a.punch) return null;
  if (!(a.endeBeat - a.startBeat > EPS)) throw new TakeFehler('leer', `range ${a.startBeat}..${a.endeBeat}`);
  let l = a.loop;
  // no loop, a degenerate one, or a start outside it: one pass over the whole take (the loop is the pass length only when the run starts inside it)
  if (!l || !(l.bis_beat - l.von_beat > EPS) || a.startBeat < l.von_beat - EPS ||
    a.startBeat >= l.bis_beat - EPS) l = { von_beat: a.startBeat, bis_beat: a.endeBeat };
  const L = l.bis_beat - l.von_beat;
  const rohe = paareNoten(a);
  const grenze = (k: number): { von: number; bis: number } => ({ von: k === 0 ? a.startBeat : l.von_beat, bis: Math.min(l.bis_beat, a.endeBeat - k * L) });
  const aus: Durchlauf[] = [];
  for (let k = 0; ; k++) {
    const g = grenze(k);
    if (!(g.bis - g.von > EPS)) break;
    aus.push({ k, von: g.von, bis: g.bis, noten: [], voll: g.von <= l.von_beat + EPS && g.bis >= l.bis_beat - EPS });
  }
  for (const n of rohe) {   // a note belongs to the pass of its onset and ends at the end of that pass
    const k = Math.min(aus.length - 1, Math.max(0, n.start < l.bis_beat ? 0 : 1 + Math.floor((n.start - l.bis_beat) / L + EPS)));
    const d = aus[k];
    const start = runde9(Math.max(n.start - k * L, d.von)), ende = runde9(Math.min(n.ende - k * L, d.bis));
    if (ende - start > EPS && start < d.bis - EPS) d.noten.push({ start, ende, ton: n.ton, vel: n.vel });
  }
  for (const d of aus) d.noten.sort((x, y) => x.start - y.start || x.ton - y.ton);
  if (aus.every((d) => d.noten.length === 0)) throw new TakeFehler('keine_noten', 'the take holds no complete note inside the range');
  return aus;
}
// Per track: how many take lanes the run adds and how many passes with notes did not get one (takes_verworfen). Same arithmetic as nehmeDurchlaeufe.
export function midiDurchlaufZahlen(projekt: Projekt, a: MidiTakeAngabe, spurId: string): { takes: number; verworfen: number } | null {
  const d = durchlaeufe(a);
  const s = sucheSpur(projekt, spurId);
  if (d === null || !s) return null;
  const mit = d.filter((x) => x.noten.length > 0);
  const platz = takePlatz(s, d);
  return { takes: Math.min(mit.length, platz), verworfen: Math.max(0, mit.length - platz) };
}
// how many take lanes fit next to the existing ones (the Original lane is reserved when the main pass overwrites something)
function takePlatz(spur: { takes?: { art?: string }[]; clips: { start_beat: number; laenge_beats: number }[] }, d: Durchlauf[]): number {
  const h = hauptDurchlauf(d);
  const vorhanden = (spur.takes ?? []).length;
  const braucht = !(spur.takes ?? []).some((t) => t.art === 'original') && spur.clips.some((c) => imBereich(c, h.von, h.bis));
  return Math.max(0, MAX_TAKES_PRO_SPUR - vorhanden - (braucht ? 1 : 0));
}
function hauptDurchlauf(d: Durchlauf[]): Durchlauf {
  const mit = d.filter((x) => x.noten.length > 0);
  return mit.filter((x) => x.voll).at(-1) ?? mit.at(-1)!;
}
// 4.2: every pass with notes becomes a take lane "Take <n>" (newest last) with one MIDI clip over its pass range; the main lane gets the last complete
// pass (else the last pass with notes); what the main pass overwrites moves into the Original lane. All or nothing.
function nehmeDurchlaeufe(projekt: Projekt, a: MidiTakeAngabe, d: Durchlauf[]): Projekt {
  let p = structuredClone(projekt);
  const haupt = hauptDurchlauf(d);
  const name = a.name ?? 'MIDI take';
  try {
    for (const id of a.spurIds) {
      const platz = takePlatz(sucheSpur(p, id)!, d);
      const mit = d.filter((x) => x.noten.length > 0);
      const behalten = mit.slice(Math.max(0, mit.length - platz));   // the oldest passes drop out when the lanes run out
      // the main pass first: loop clips cannot be cut, and what it overwrites goes to the Original lane
      const spur = sucheSpur(p, id)!;
      for (const c of spur.clips) {
        const schneidet = (t: number): boolean => c.start_beat < t - EPS && c.start_beat + c.laenge_beats > t + EPS;
        if (c.loop_beats != null && (schneidet(haupt.von) || schneidet(haupt.bis))) throw new TakeFehler('ersetzen_loop', c.id);
      }
      teileClipsAn(p, spur, [haupt.von, haupt.bis]);
      const alle = (spur.takes ?? []).flatMap((t) => t.clips as MidiClip[]);
      const drin = spur.clips.filter((c) => imBereich(c, haupt.von, haupt.bis));
      const kopie = (c: Clip): boolean => c.art === 'midi' && alle.some((t) => t.start_beat <= c.start_beat + EPS
        && t.start_beat + t.laenge_beats >= c.start_beat + c.laenge_beats - EPS && istMidiTakeKopie(c, t));
      const retten = drin.filter((c) => !kopie(c)) as MidiClip[];
      spur.clips = spur.clips.filter((c) => !drin.includes(c));
      if (retten.length > 0) {
        if (!(spur.takes ?? []).some((t) => t.art === 'original')) {
          p = lauf(p, { befehl: 'take_neu', spur_id: id, name: ORIGINAL_NAME });
          sucheSpur(p, id)!.takes!.at(-1)!.art = 'original';
        }
        const o = sucheSpur(p, id)!.takes!.find((t) => t.art === 'original')!;
        (o.clips as MidiClip[]).push(...retten);
        o.clips.sort((x, y) => x.start_beat - y.start_beat);
      }
      // the main clip first: its note ids are the ones a run without takes would have given
      p = lauf(p, { befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: haupt.von, laenge_beats: runde9(haupt.bis - haupt.von), name,
        noten: alsNoten(haupt.noten, haupt.von, haupt.bis) });
      for (const x of behalten) {
        p = lauf(p, { befehl: 'take_neu', spur_id: id });
        const vorher = new Set(sucheSpur(p, id)!.clips.map((c) => c.id));
        p = lauf(p, { befehl: 'clip_neu', spur_id: id, art: 'midi',
          start_beat: x.von, laenge_beats: runde9(x.bis - x.von), name, noten: alsNoten(x.noten, x.von, x.bis) });
        const s2 = sucheSpur(p, id)!;
        const neu = s2.clips.find((c) => !vorher.has(c.id)) as MidiClip;
        s2.clips = s2.clips.filter((c) => c !== neu);   // the take clip lives in its lane only
        (s2.takes!.filter((t) => t.art === undefined).at(-1)!.clips as MidiClip[]).push(neu);
      }
    }
  } catch (e) {
    if (e instanceof BefehlFehler && e.grund === 'zu_gross') throw new TakeFehler('zu_gross', e.detail);
    throw e;
  }
  pruefeGrenzen(p);
  return p;
}
// The range [von, bis) the take covers and its notes cut to it; one that begins before the range (the offset) or ends after it keeps its part inside
function fasseNoten(a: MidiTakeAngabe): { von: number; bis: number; noten: MidiNote[] } {
  const von = a.punch ? Math.max(a.startBeat, a.punch.von_beat) : a.startBeat, bis = a.punch ? Math.min(a.endeBeat, a.punch.bis_beat) : a.endeBeat;
  if (!(bis - von > EPS)) {
    throw new TakeFehler(a.punch ? 'punch_leer' : 'leer', `range ${von}..${bis} against the take ${a.startBeat}..${a.endeBeat}`);
  }
  const noten = paareNoten(a).map((n) => ({ ...n, start: Math.max(n.start, von), ende: Math.min(n.ende, bis) }))
    .filter((n) => n.ende - n.start > EPS).sort((x, y) => x.start - y.start || x.ton - y.ton);
  if (noten.length === 0) throw new TakeFehler('keine_noten', 'the take holds no complete note inside the range');
  return { von, bis, noten };
}
const imBereich = (c: { start_beat: number; laenge_beats: number }, von: number, bis: number): boolean =>
  c.start_beat < bis - EPS && c.start_beat + c.laenge_beats > von + EPS;
// the notes with onset in [von, bis), relative to `von` and cut at `bis`, as the arguments of noten_neu / clip_neu
const alsNoten = (noten: MidiNote[], von: number, bis: number) => noten.filter((n) => n.start >= von - EPS && n.start < bis - EPS)
  .map((n) => ({ beat: runde9(n.start - von), laenge: runde9(Math.min(n.ende, bis) - n.start), ton: n.ton, vel: n.vel }));

function ersetze(p0: Projekt, spurId: string, noten: MidiNote[], von: number, bis: number, name = 'MIDI take'): Projekt {
  let p = p0;
  const spur = sucheSpur(p, spurId)!;
  for (const c of spur.clips) {
    const schneidet = (t: number): boolean => c.start_beat < t - EPS && c.start_beat + c.laenge_beats > t + EPS;
    if (c.loop_beats != null && (schneidet(von) || schneidet(bis))) throw new TakeFehler('ersetzen_loop', c.id);
  }
  teileClipsAn(p, spur, [von, bis]);
  spur.clips = spur.clips.filter((c) => !imBereich(c, von, bis));
  p = lauf(p, { befehl: 'clip_neu', spur_id: spurId, art: 'midi', start_beat: von, laenge_beats: runde9(bis - von), name, noten: alsNoten(noten, von, bis) });
  return p;
}

function ueberspiele(p0: Projekt, spurId: string, noten: MidiNote[], von: number, bis: number, name = 'MIDI take'): Projekt {
  let p = p0;
  const darin = (sucheSpur(p, spurId)!.clips.filter((c) => imBereich(c, von, bis)) as MidiClip[]).sort((x, y) => x.start_beat - y.start_beat);
  const schleife = darin.find((c) => c.loop_beats != null);
  if (schleife) throw new TakeFehler('ersetzen_loop', schleife.id);
  // the targets in time order: the clips of the range and the stretches between and around them
  const ziele: { von: number; bis: number; clip: string | null }[] = [];
  let weiter = von;
  for (const c of darin) {
    if (c.start_beat > weiter + EPS) ziele.push({ von: weiter, bis: c.start_beat, clip: null });
    ziele.push({ von: c.start_beat, bis: c.start_beat + c.laenge_beats, clip: c.id });
    weiter = Math.max(weiter, c.start_beat + c.laenge_beats);
  }
  if (bis > weiter + EPS) ziele.push({ von: weiter, bis, clip: null });
  for (const z of ziele) {
    const f = alsNoten(noten, z.von, Math.min(z.bis, bis));   // a target begins inside the range or reaches into it; notes exist only inside
    if (z.clip !== null) { if (f.length > 0) p = lauf(p, { befehl: 'noten_neu', clip_id: z.clip, noten: f }); }
    else {
      p = lauf(p, { befehl: 'clip_neu', spur_id: spurId, art: 'midi', start_beat: z.von, laenge_beats: runde9(z.bis - z.von), name,
        ...(f.length > 0 ? { noten: f } : {}) });
    }
  }
  return p;
}
export type { AudioClip };
