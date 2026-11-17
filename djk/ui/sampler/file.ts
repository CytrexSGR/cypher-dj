// Sample player stage 1: files of the sample roots as a source of the cut store. The roots (`wurzeln.json` in the sampler folder), the safe resolving of a
// path inside a root, the folder listing and the file name search, the decoding with ffmpeg (48 kHz stereo float32, leading silence trimmed), the preview WAV
// and the root note of a file (pitch detection plus a note name in the file name).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SchnittFehler, MAX_SCHNITT_FRAMES, samplerOrdner, type Ordner, type QuellAudio } from './schnitt.ts';
import { erkenneGrundton, grundVorschlag } from './tone_hoehe.ts';

export const WURZELN_MAX = 16;
export const WURZEL_NAME_MAX = 40;
export const DATEIEN_MAX = 2000;
export const TREFFER_MAX = 300;
export const SUCHE_MS = 3000;
export const VORHOER_S = 30;
/** Digital silence at the start of a file: everything below this is cut off (-80 dBFS). */
export const STILLE_SCHWELLE = 1e-4;
const SR = 48000;
const NAME_MAX = 60;
const ENDUNG = /\.(wav|aif|aiff|flac|ogg)$/i;
const SORT = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const sortiere = <T>(l: T[], f: (x: T) => string): T[] => [...l].sort((a, b) => SORT.compare(f(a), f(b)) || (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0));

export type Wurzel = { name: string; pfad: string };
export type DateiEintrag = { name: string; rel: string; bytes: number };

const nicht = (text: string): SchnittFehler => new SchnittFehler(404, 'quelle_unbekannt', text);

export function wurzelnDatei(o: Ordner = {}): string {
  return path.join(o.ordner ?? samplerOrdner(), 'wurzeln.json');
}

/** The roots of the file: a missing, unreadable or empty file gives none; an entry that is not `{name, pfad}` with a name of 1..40 characters without `/`
 *  that no earlier entry uses and an absolute `pfad` is skipped; at most 16 entries are kept. */
export function leseWurzeln(o: Ordner = {}): Wurzel[] {
  let l: unknown;
  try { l = JSON.parse(fs.readFileSync(wurzelnDatei(o), 'utf8')); } catch { return []; }
  if (!Array.isArray(l)) return [];
  const aus: Wurzel[] = [];
  for (const e of l) {
    if (aus.length >= WURZELN_MAX) break;
    if (typeof e !== 'object' || e === null) continue;
    const { name, pfad } = e as { name?: unknown; pfad?: unknown };
    if (typeof name !== 'string' || name.trim() === '' || name.length > WURZEL_NAME_MAX || name.includes('/')) continue;
    if (typeof pfad !== 'string' || !path.isAbsolute(pfad)) continue;
    if (aus.some((w) => w.name === name)) continue;
    aus.push({ name, pfad });
  }
  return aus;
}

const echt = (p: string): string | null => { try { return fs.realpathSync(p); } catch { return null; } };
const drin = (wurzel: string, p: string): boolean => p === wurzel || p.startsWith(wurzel.endsWith(path.sep) ? wurzel : `${wurzel}${path.sep}`);

/** The real path of the root, or 404 `quelle_unbekannt` when the root is not in the file or not on disk. */
export function wurzelEcht(name: unknown, o: Ordner = {}): string {
  const w = typeof name === 'string' ? leseWurzeln(o).find((x) => x.name === name) : undefined;
  if (!w) throw nicht(`sample root ${String(name)} is not in ${wurzelnDatei(o)}`);
  const r = echt(w.pfad);
  if (r === null) throw nicht(`sample root ${w.name} does not exist on disk`);
  return r;
}

/** Resolves `rel` inside the root with realpath. Refuses (404 `quelle_unbekannt`) a missing entry, an absolute path, a `..` segment and anything that leaves the
 *  real path of the root, a symlink included. Returns the real path. */
export function loeseAuf(name: unknown, rel: unknown, o: Ordner = {}): string {
  const wurzel = wurzelEcht(name, o);
  if (rel === undefined || rel === null || rel === '') return wurzel;
  if (typeof rel !== 'string' || rel.includes('\0') || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw nicht(`the path ${String(rel)} is not inside the root`);
  const p = echt(path.join(wurzel, rel));
  if (p === null) throw nicht(`${rel} does not exist`);
  if (!drin(wurzel, p)) throw nicht(`the path ${rel} leaves the root`);
  return p;
}

/** The roots for the page: `fehlt: true` for one that is not on disk. */
export function listeWurzeln(o: Ordner = {}): { name: string; fehlt?: true }[] {
  return leseWurzeln(o).map((w) => (echt(w.pfad) === null ? { name: w.name, fehlt: true as const } : { name: w.name }));
}

/** Entries that are never samples: hidden ones (.git, .DS_Store) and the housekeeping folders of Ableton packs (preset previews, project info). */
export const versteckt = (name: string): boolean => name.startsWith('.') || name === 'Ableton Folder Info' || name === 'Ableton Project Info';
/** True for a sample of an Ableton factory pack: AIFF-C with the compression type `able` ("Ableton Content"). Only Live reads its audio, so it is not
 *  listed, counted or found. Reads the first 1024 bytes; any other file, and a file that cannot be read, is not locked. */
export function istGesperrt(pfad: string): boolean {
  if (!/\.aiff?$/i.test(pfad)) return false;
  let fd: number | null = null;
  try {
    fd = fs.openSync(pfad, 'r');
    const b = Buffer.alloc(1024), n = fs.readSync(fd, b, 0, 1024, 0);
    if (n < 40 || b.toString('latin1', 8, 12) !== 'AIFC') return false;
    // walk the chunks: Live writes a chunk `able` (key material) before COMM, and COMM names the compression `able`; a pack sample may carry a large
    // table chunk in between, so COMM itself can lie beyond what is read here
    for (let p = 12; p + 8 <= n;) {
      const id = b.toString('latin1', p, p + 4), len = b.readUInt32BE(p + 4);
      if (id === 'able') return true;
      if (id === 'COMM') return p + 30 <= n && b.toString('latin1', p + 26, p + 30) === 'able';
      p += 8 + len + (len & 1);
    }
    return false;
  } catch { return false; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* nothing to do */ } } }
}
const relVon = (ordner: string, name: string): string => (ordner === '' ? name : `${ordner}/${name}`);
const schlicht = (rel: string): string => rel.split(/[\\/]/).filter((s) => s !== '' && s !== '.').join('/');

/** The sub folders and audio files of a folder of a root, both in natural order; files capped at 2000 (`mehr`). */
export function listeOrdner(wurzel: string, ordner: string, o: Ordner = {}): { ordner: string; ordner_liste: string[]; ordner_zahl: Record<string, number>; dateien: DateiEintrag[]; mehr?: true } {
  const rel = schlicht(ordner);
  const voll = loeseAuf(wurzel, rel, o);
  if (!fs.statSync(voll).isDirectory()) throw nicht(`${rel} is not a folder`);
  const wur = wurzelEcht(wurzel, o);
  const ordnerListe: string[] = [], dateien: DateiEintrag[] = [];
  for (const e of fs.readdirSync(voll, { withFileTypes: true })) {
    if (versteckt(e.name)) continue;   // hidden entries (.git, .DS_Store) are not samples
    const p = path.join(voll, e.name);
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { continue; }
    if (e.isSymbolicLink()) { const r = echt(p); if (r === null || !drin(wur, r)) continue; }
    if (st.isDirectory()) ordnerListe.push(e.name);
    else if (st.isFile() && ENDUNG.test(e.name) && !istGesperrt(p)) dateien.push({ name: e.name, rel: relVon(rel, e.name), bytes: st.size });
  }
  const sortiert = sortiere(dateien, (d) => d.name);
  // Folders without any audio file below them are left out, a chain of folders that only hold one folder is shown as one entry ("Samples/Combined"),
  // and every entry carries the number of audio files below it.
  const zahl = zaehleOrdner(wurzel, o);
  const ordnerZahl: Record<string, number> = {};
  const gezeigt: string[] = [];
  for (const name of sortiere(ordnerListe, (x) => x)) {
    let kette = name, n = zahl.gesamt.get(relVon(rel, kette)) ?? 0;
    if (n === 0) continue;
    for (;;) {
      const k = relVon(rel, kette), kinder = zahl.kinder.get(k) ?? [];
      if ((zahl.direkt.get(k) ?? 0) > 0 || kinder.length !== 1) break;
      kette = `${kette}/${kinder[0]}`;
    }
    n = zahl.gesamt.get(relVon(rel, kette)) ?? n;
    gezeigt.push(kette); ordnerZahl[kette] = n;
  }
  return { ordner: rel, ordner_liste: gezeigt, ordner_zahl: ordnerZahl, dateien: sortiert.slice(0, DATEIEN_MAX), ...(sortiert.length > DATEIEN_MAX ? { mehr: true as const } : {}) };
}

type Zaehlung = { zeit: number; gesamt: Map<string, number>; direkt: Map<string, number>; kinder: Map<string, string[]> };
const ZAEHL_MS = 10 * 60 * 1000;
const zaehlungen = new Map<string, Zaehlung>();
/** Audio files per folder of a root (below it, in it) and the sub folders that hold any; one walk of the root, kept for ten minutes. Hidden entries and
 *  symlinked folders are not followed, as in the search. */
export function zaehleOrdner(wurzel: string, o: Ordner = {}): Zaehlung {
  const wur = wurzelEcht(wurzel, o);
  const alt = zaehlungen.get(wur);
  if (alt && Date.now() - alt.zeit < ZAEHL_MS) return alt;
  const z: Zaehlung = { zeit: Date.now(), gesamt: new Map(), direkt: new Map(), kinder: new Map() };
  const geh = (voll: string, r: string): number => {
    let eintraege: fs.Dirent[];
    try { eintraege = fs.readdirSync(voll, { withFileTypes: true }); } catch { return 0; }
    let direkt = 0, gesamt = 0;
    const kinder: string[] = [];
    for (const e of eintraege) {
      if (versteckt(e.name)) continue;
      if (e.isDirectory()) { const n = geh(path.join(voll, e.name), relVon(r, e.name)); if (n > 0) { kinder.push(e.name); gesamt += n; } }
      else if ((e.isFile() || e.isSymbolicLink()) && ENDUNG.test(e.name) && !istGesperrt(path.join(voll, e.name))) direkt++;
    }
    gesamt += direkt;
    z.gesamt.set(r, gesamt); z.direkt.set(r, direkt); z.kinder.set(r, kinder);
    return gesamt;
  };
  geh(wur, '');
  zaehlungen.set(wur, z);
  return z;
}

/** Recursive search below `ordner`: every word of `suche` (case-insensitive) must occur in the path of a file from the root; at most 300 hits and `ms` milliseconds of walking
 *  (`mehr` when either stops it). Symlinked folders are not followed. */
export function sucheDateien(wurzel: string, ordner: string, suche: string, o: Ordner = {}, ms = SUCHE_MS): { ordner: string; dateien: DateiEintrag[]; mehr?: true } {
  const rel = schlicht(ordner);
  const start = loeseAuf(wurzel, rel, o);
  const woerter = suche.toLowerCase().split(/\s+/).filter((w) => w !== '');
  const ende = Date.now() + ms;
  const treffer: DateiEintrag[] = [];
  let mehr = false;
  const geh = (voll: string, r: string): void => {
    if (mehr) return;
    let eintraege: fs.Dirent[];
    try { eintraege = fs.readdirSync(voll, { withFileTypes: true }); } catch { return; }
    eintraege.sort((a, b) => SORT.compare(a.name, b.name));
    const ordnerNamen: string[] = [];
    for (const e of eintraege) {
      if (Date.now() > ende) { mehr = true; return; }
      if (versteckt(e.name)) continue;
      if (e.isDirectory()) { ordnerNamen.push(e.name); continue; }
      if (!e.isFile() && !e.isSymbolicLink()) continue;
      if (!ENDUNG.test(e.name)) continue;
      const kl = relVon(r, e.name).toLowerCase();   // the path from the root counts: "synth note bass" finds "One Shots/Synth Note/Bass CD 1.wav"
      if (!woerter.every((w) => kl.includes(w))) continue;
      const p = path.join(voll, e.name);
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.isFile() || istGesperrt(p)) continue;
      if (e.isSymbolicLink()) { const x = echt(p); if (x === null || !drin(wurzelEcht(wurzel, o), x)) continue; }
      if (treffer.length >= TREFFER_MAX) { mehr = true; return; }
      treffer.push({ name: e.name, rel: relVon(r, e.name), bytes: st.size });
    }
    for (const n of ordnerNamen) { geh(path.join(voll, n), relVon(r, n)); if (mehr) return; }
  };
  geh(start, rel);
  return { ordner: rel, dateien: treffer, ...(mehr ? { mehr: true as const } : {}) };
}

const ausEnde = (b: Buffer | null | undefined): string => (b ? b.toString('utf8').trim().slice(0, 200) : '');

/** Decodes the first `sekunden` of an audio file to 48 kHz stereo float32 (interleaved) with ffmpeg: a mono file plays on both sides at its own level, more
 *  than two channels are mixed down. `format_falsch` when ffmpeg cannot read the file. */
export function dekodiereDatei(pfad: string, sekunden: number): Float32Array {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', pfad], { encoding: 'utf8', timeout: 15000 });
  const kanaele = Number.parseInt(String(probe.stdout ?? '').trim(), 10);
  if (istGesperrt(pfad)) throw new SchnittFehler(422, 'format_falsch', `${path.basename(pfad)} is a protected sample of an Ableton pack: only Live can read it`);
  if (probe.status !== 0 || !(kanaele >= 1)) throw new SchnittFehler(422, 'format_falsch', `ffmpeg cannot read ${path.basename(pfad)} as audio${ausEnde(probe.stderr as Buffer | null) ? `: ${ausEnde(probe.stderr as Buffer | null)}` : ''}`);
  const filter = kanaele === 1 ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : [];
  const max = Math.ceil(sekunden * SR) * 8;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', pfad, '-vn', '-t', String(sekunden), ...filter, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'],
    { maxBuffer: max + (1 << 20), timeout: 60000 });
  if (r.status !== 0 && !(r.error && (r.error as NodeJS.ErrnoException).code === 'ENOBUFS')) {
    throw new SchnittFehler(422, 'format_falsch', `ffmpeg cannot read ${path.basename(pfad)} as audio: ${ausEnde(r.stderr)}`);
  }
  const roh = r.stdout as Buffer;
  const frames = Math.min(Math.floor(roh.length / 8), Math.ceil(sekunden * SR));
  const daten = new Float32Array(frames * 2);
  new Uint8Array(daten.buffer).set(roh.subarray(0, frames * 8));
  return daten;
}


// ---- asynchronous decoding (instruments) ----
export const FFMPEG_GLEICHZEITIG = 4;
const ASYNC_S_MAX = 600;
let ffAktiv = 0;
const ffWarte: (() => void)[] = [];
async function ffSlot<T>(f: () => Promise<T>): Promise<T> {
  if (ffAktiv >= FFMPEG_GLEICHZEITIG) await new Promise<void>((ok) => ffWarte.push(ok));   // the slot is handed over by the one that leaves
  else ffAktiv++;
  try { return await f(); } finally { const w = ffWarte.shift(); if (w) w(); else ffAktiv--; }
}
const lauf = (cmd: string, args: string[], maxBytes: number, ms: number): Promise<{ status: number | null; out: Buffer; err: string; voll: boolean }> => new Promise((ok) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const teile: Buffer[] = []; let n = 0, voll = false, err = '';
  const uhr = setTimeout(() => p.kill('SIGKILL'), ms);
  p.stdout.on('data', (b: Buffer) => { if (n < maxBytes) { teile.push(b); n += b.length; } else if (!voll) { voll = true; p.kill('SIGKILL'); } });
  p.stderr.on('data', (b: Buffer) => { if (err.length < 400) err += b.toString('utf8'); });
  p.on('error', (e) => { clearTimeout(uhr); ok({ status: -1, out: Buffer.alloc(0), err: String(e), voll }); });
  p.on('close', (c) => { clearTimeout(uhr); ok({ status: c, out: Buffer.concat(teile), err: err.trim().slice(0, 200), voll }); });
});

/** Channels and duration (seconds) of the first audio stream; `format_falsch` when ffprobe cannot read the file. At most 4 ffmpeg/ffprobe processes run at a time. */
export function probeDateiAsync(pfad: string): Promise<{ kanaele: number; dauer: number }> {
  return ffSlot(async () => {
    if (istGesperrt(pfad)) throw new SchnittFehler(422, 'format_falsch', `${path.basename(pfad)} is a protected sample of an Ableton pack: only Live can read it`);
    const r = await lauf('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels:format=duration', '-of', 'json', pfad], 1 << 20, 15000);
    let j: { streams?: { channels?: number }[]; format?: { duration?: string } } = {};
    try { j = JSON.parse(r.out.toString('utf8')); } catch { /* handled below */ }
    const kanaele = j.streams?.[0]?.channels ?? 0, dauer = Number(j.format?.duration ?? 0);
    if (r.status !== 0 || !(kanaele >= 1)) throw new SchnittFehler(422, 'format_falsch', `ffmpeg cannot read ${path.basename(pfad)} as audio${r.err ? `: ${r.err}` : ''}`);
    return { kanaele, dauer: Number.isFinite(dauer) ? dauer : 0 };
  });
}

/** Like `dekodiereDatei`, without blocking the server: the first `sekunden` (at most 600) of a file as 48 kHz stereo float32 (interleaved). At most 4
 *  ffmpeg processes run at a time, across all callers. */
export async function dekodiereDateiAsync(pfad: string, sekunden: number, kanaele?: number): Promise<Float32Array> {
  const k = kanaele ?? (await probeDateiAsync(pfad)).kanaele;
  const s = Math.min(sekunden, ASYNC_S_MAX);
  return ffSlot(async () => {
    const filter = k === 1 ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : [];
    const r = await lauf('ffmpeg', ['-v', 'error', '-nostdin', '-i', pfad, '-vn', '-t', String(s), ...filter, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], Math.ceil(s * SR) * 8 + (1 << 20), 120000);
    if (r.status !== 0 && !r.voll) throw new SchnittFehler(422, 'format_falsch', `ffmpeg cannot read ${path.basename(pfad)} as audio: ${r.err}`);
    const frames = Math.min(Math.floor(r.out.length / 8), Math.ceil(s * SR));
    const daten = new Float32Array(frames * 2);
    new Uint8Array(daten.buffer).set(r.out.subarray(0, frames * 8));
    return daten;
  });
}

/** The first frame whose sample reaches STILLE_SCHWELLE, -1 when the audio is silent throughout. */
export function ersterTon(daten: Float32Array): number {
  for (let i = 0; i < daten.length; i++) if (Math.abs(daten[i]) >= STILLE_SCHWELLE) return i >> 1;
  return -1;
}

/** `Ordner.dateiMaxFrames` or the 60 s limit of the sampler block. */
const grenze = (o: Ordner): number => o.dateiMaxFrames ?? MAX_SCHNITT_FRAMES;

/** The audio of `<root name>/<rel>` as a cut source: decoded, leading silence trimmed, at most 60 s (`zu_lang`, nothing is cut off silently; a file that is
 *  longer than the limit plus 2 s is refused before its end is decoded), not silent (`format_falsch`). `bpm` is `o.tempo` (default 120), `beats` the length
 *  at that tempo rounded to 1/8 beat, at least 1/8. */
export function ladeDatei(ref: string, o: Ordner = {}): QuellAudio {
  const i = ref.indexOf('/');
  const rel = i < 0 ? '' : ref.slice(i + 1);
  return ladeDateiPfad(loeseAuf(i < 0 ? ref : ref.slice(0, i), rel, o), o);   // a ref without a known root name is `quelle_unbekannt`
}

/** The same for a resolved file path (a root file after `loeseAuf`, a catalog file after the catalog lookup): not a file is 404 `quelle_unbekannt`. */
export function ladeDateiPfad(pfad: string, o: Ordner = {}): QuellAudio {
  let datei = false;
  try { datei = fs.statSync(pfad).isFile(); } catch { /* gone between lookup and load */ }
  if (!datei) throw nicht(`${path.basename(pfad)} is not a file`);
  if (!ENDUNG.test(pfad)) throw new SchnittFehler(422, 'format_falsch', `${path.basename(pfad)} is not one of the audio file types (wav, aif, aiff, flac, ogg)`);
  const max = grenze(o), deckel = max + 2 * SR;
  const roh = dekodiereDatei(pfad, deckel / SR);
  const start = ersterTon(roh);
  if (start < 0) throw new SchnittFehler(422, 'format_falsch', `${path.basename(pfad)} is silent throughout (nothing above -80 dBFS)`);
  const frames = roh.length / 2 - start;
  if (roh.length / 2 >= deckel || frames > max) {
    throw new SchnittFehler(422, 'zu_lang', `${path.basename(pfad)} is longer than ${Math.round(max / SR * 10) / 10} s; the sampler block holds at most that much`);
  }
  const tempo = o.tempo ?? 120;
  const beats = Math.max(0.125, Math.round(frames / SR * tempo / 60 * 8) / 8);
  return { daten: roh.slice(start * 2), frames, bpm: tempo, beats, name: dateiName(pfad) };
}

/** The file name without its extension, within the name limit of a cut. */
export function dateiName(pfad: string): string {
  const n = path.basename(pfad).replace(ENDUNG, '').trim();
  return (n === '' ? 'sample' : n).slice(0, NAME_MAX).trim();
}

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;
const NOTE_IM_NAMEN = /(?<![^ _.\-])([A-Ga-g])([#bs])?([_-]?)(\d)(?![^ _.\-])/g;

/** A note name in a file name (`C3`, `F#2`, `Gs4`, `Bb1`, `As_1`; delimited by space, `_`, `-`, `.` or the ends; `_` or `-` before the digit makes the octave
 *  negative): pitch class 0..11 and the MIDI note counted scientific (C4 = 60). null when the name has none. */
export function noteAusDateiname(name: string): { klasse: number; note: number } | null {
  const ohne = name.replace(ENDUNG, '');
  for (const m of ohne.matchAll(NOTE_IM_NAMEN)) {
    const klasse = ((PC[m[1].toUpperCase() as keyof typeof PC] + (m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0)) % 12 + 12) % 12;
    const oktave = (m[3] === '' ? 1 : -1) * Number(m[4]);
    const grundton = PC[m[1].toUpperCase() as keyof typeof PC];
    const accid = m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0;
    return { klasse, note: 12 * (oktave + 1) + grundton + accid };
  }
  return null;
}

const GRUND_MIN = 16, GRUND_MAX = 95;
const ins = (n: number): number => { while (n > GRUND_MAX) n -= 12; while (n < GRUND_MIN) n += 12; return n; };

/** The root note of a file (rule 4 of the spec): the pitch detection of sampler C (`erkenneGrundton`, `grundVorschlag`); a note name in the file name decides
 *  the pitch class, at the octave nearest to the detected pitch, or alone (C4 = 60) when nothing was detected; neither gives 60. Always inside 16..95. */
export function grundVonDatei(daten: Float32Array, dateiname: string): { note: number; herkunft: 'erkannt' | 'dateiname' | 'vorgabe' } {
  const e = erkenneGrundton(daten, 0, daten.length / 2);
  const v = grundVorschlag(e);
  const n = noteAusDateiname(dateiname);
  if (v.quelle === 'erkannt') {
    if (n === null || n.klasse === ((v.note % 12) + 12) % 12) return { note: ins(v.note), herkunft: 'erkannt' };
    const d = ((n.klasse - v.note) % 12 + 18) % 12 - 6;   // -6..5 semitones to the nearest note of that class
    return { note: ins(v.note + d), herkunft: 'dateiname' };
  }
  if (n !== null) return { note: ins(n.note), herkunft: 'dateiname' };
  return { note: 60, herkunft: 'vorgabe' };
}

/** A 16 bit stereo 48 kHz WAV of the first `VORHOER_S` seconds of the file, for the browser preview. */
export function vorhoerWav(pfad: string): Buffer {
  const f = dekodiereDatei(pfad, VORHOER_S);
  const frames = f.length / 2, bytes = frames * 4;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + bytes, 4); b.write('WAVEfmt ', 8, 'ascii'); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(bytes, 40);
  for (let i = 0; i < f.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767))), 44 + 2 * i);
  return b;
}

export { ENDUNG as AUDIO_ENDUNG };
