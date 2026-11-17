// ANALYZE window, slice 2: references on the page server. A reference is measured without a project: an audio file (a library track by catalogue sha, or an
// absolute path) is decoded to float32 stereo 48 kHz in a temporary folder, a range of it is chosen (fixed, the loudest window, or the whole file) and
// analysed by the worker of the strips (sound_factory.ts) and by ffmpeg (loudness). A measured range can be stored as a reference curve, one JSON file per
// reference in the references folder; deleting moves the file to `.papierkorb/`, nothing is ever unlinked. The route layer is in output.ts.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AusgabeFehler } from './output.ts';
import { analysiereImWerk, lautheitswerte, type WerkAuftrag, type WerkErgebnis } from './sound_analysis.ts';
import { wavKopf } from '../../project/recording.ts';
import { messeLautheit } from '../../project/loudness.ts';
import { leseWavF32Bloecke } from '../../sampler/wav.ts';
import { RATE, ROLLEN, type Lautheitswerte, type RefBereich, type RefMessung, type RefQuelle, type ReferenzZeile, type Spektrum, type Stereo }
  from '../../project/sound_contract.ts';

export interface KlangReferenzOptionen {
  /** The folder of the stored references (created at the first store), or a function that gives it. */
  ordner: string | (() => string);
  /** A catalogue sha to its file (and its title, when the catalogue has one); null: unknown. */
  katalogPfad: (sha: string) => { pfad: string; name?: string } | null;
  ffmpeg?: string[];
  ffprobe?: string[];
  lruGroesse?: number;
  /** What measures the WAV range; default: the worker of the strips. */
  analysiere?: (d: WerkAuftrag) => Promise<WerkErgebnis>;
  messungModul?: string;
}

export const REF_DAUER_MAX_S = 900;   // at most this much of a file is decoded
export const REF_MIN_S = 1;
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9-]+-[0-9a-f]{6}$/;
const SCHRITT = 4800;                 // frames of one step of the loudest-window search (0.1 s)

const fehl: (grund: string, text?: string, detail?: string) => never = (grund, text = '', detail = '') => { throw new AusgabeFehler(grund, text, detail); };
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const zahl = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const runde = (x: number): number => Math.round(x * 1000) / 1000;

/** Reads a RefQuelle of a request body; refuses unknown fields and unusable combinations (argument_ungueltig). */
export function refQuelleLesen(v: unknown, feld: string): RefQuelle {
  if (!obj(v)) return fehl('argument_ungueltig', `${feld}: an object {art, ...} is required`);
  if (v.art === 'referenz') {
    for (const k of Object.keys(v)) if (k !== 'art' && k !== 'id') fehl('argument_ungueltig', `${feld}: unknown field ${k}`);
    if (typeof v.id !== 'string' || v.id === '') return fehl('argument_ungueltig', `${feld}.id: the id of a stored reference is required`);
    return { art: 'referenz', id: v.id };
  }
  if (v.art !== 'datei') return fehl('argument_ungueltig', `${feld}.art: a reference is a file or a stored reference curve`);
  for (const k of Object.keys(v)) if (!['art', 'sha', 'pfad', 'von_s', 'bis_s'].includes(k)) fehl('argument_ungueltig', `${feld}: unknown field ${k}`);
  if ((v.sha === undefined) === (v.pfad === undefined)) return fehl('argument_ungueltig', `${feld}: exactly one of sha and pfad is required`);
  if (v.sha !== undefined && (typeof v.sha !== 'string' || !SHA.test(v.sha))) {
    return fehl('argument_ungueltig', `${feld}.sha: 64 lowercase hex characters expected`);
  }
  if (v.pfad !== undefined && (typeof v.pfad !== 'string' || !path.isAbsolute(v.pfad))) {
    return fehl('argument_ungueltig', `${feld}.pfad: an absolute path is required`);
  }
  if ((v.von_s === undefined) !== (v.bis_s === undefined)) return fehl('argument_ungueltig', `${feld}: von_s and bis_s are given together or not at all`);
  if (v.von_s !== undefined && (!zahl(v.von_s) || !zahl(v.bis_s))) return fehl('argument_ungueltig', `${feld}: von_s and bis_s must be numbers`);
  return { art: 'datei', ...(v.sha !== undefined ? { sha: v.sha as string } : { pfad: v.pfad as string }),
    ...(v.von_s !== undefined ? { von_s: v.von_s as number, bis_s: v.bis_s as number } : {}) };
}

/** dauer_s of a request: absent or a number of 4..900 seconds. */
export function dauerLesen(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  if (!zahl(v) || v < 4 || v > REF_DAUER_MAX_S) return fehl('argument_ungueltig', `dauer_s: a number of 4 to ${REF_DAUER_MAX_S} seconds is required`);
  return v;
}

/** name 1..60 characters after trimming, rolle one of ROLLEN; answers the trimmed name. */
export function nameRolleLesen(name: unknown, rolle: unknown): { name: string; rolle: string } {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
    return fehl('argument_ungueltig', 'name: 1 to 60 characters are required');
  }
  if (typeof rolle !== 'string' || !(ROLLEN as readonly string[]).includes(rolle)) {
    return fehl('argument_ungueltig', `rolle: one of ${ROLLEN.join(', ')} is required`);
  }
  return { name: name.trim(), rolle };
}

const slug = (name: string): string => {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  return s === '' ? 'ref' : s;
};

// frames of the data chunk of a WAV that ffmpeg wrote (the chunk walk of sampler/wav.ts is private there)
function wavFrames(pfad: string): number {
  const fd = fs.openSync(pfad, 'r');
  try {
    const gr = fs.fstatSync(fd).size;
    const kopf = Buffer.alloc(Math.min(gr, 4096));
    fs.readSync(fd, kopf, 0, kopf.length, 0);
    let pos = 12;
    while (pos + 8 <= kopf.length) {
      const id = kopf.toString('ascii', pos, pos + 4), n = kopf.readUInt32LE(pos + 4);
      if (id === 'data') return Math.floor(Math.min(n, gr - pos - 8) / 8);
      pos += 8 + n + (n % 2);
    }
  } finally { fs.closeSync(fd); }
  return fehl('format_falsch', 'the decoded audio has no data chunk');
}

// The window of `dauerS` seconds with the highest RMS, searched in steps of 0.1 s in one streaming pass over the WAV. Returns the start in seconds.
export function lautestesFenster(wav: string, dauerS: number): number {
  const energie: number[] = [];
  leseWavF32Bloecke(wav, SCHRITT, (b) => {
    if (b.length < SCHRITT * 2) return;            // a partial last step is no candidate
    let s = 0;
    for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    energie.push(s);
  });
  const w = Math.max(1, Math.round(dauerS * 10));
  if (energie.length <= w) return 0;
  let summe = 0, best = -1, bestI = 0;
  for (let i = 0; i < energie.length; i++) {
    summe += energie[i];
    if (i >= w) summe -= energie[i - w];
    if (i >= w - 1 && summe > best) { best = summe; bestI = i - w + 1; }
  }
  return bestI / 10;
}

type Kern = { stumm: boolean; lautheit: Lautheitswerte; stereo: Stereo; spektrum: Spektrum; bereich: RefBereich };

export class KlangReferenz {
  private readonly o: KlangReferenzOptionen;
  private readonly lru = new Map<string, Kern>();
  private readonly imFlug = new Map<string, Promise<Kern>>();
  private kette: Promise<unknown> = Promise.resolve();   // one decode at a time

  constructor(o: KlangReferenzOptionen) { this.o = o; }

  private ordner(): string { return typeof this.o.ordner === 'function' ? this.o.ordner() : this.o.ordner; }

  // ---- the store ----

  private datei(id: string): string {
    if (!ID.test(id)) return fehl('referenz_unbekannt', `there is no stored reference ${id}`);
    return path.join(this.ordner(), `${id}.json`);
  }

  private lies(pfad: string): { id: string; name: string; rolle: string; erstellt: string; herkunft: string; messung: Record<string, unknown> } | null {
    try {
      const j = JSON.parse(fs.readFileSync(pfad, 'utf8')) as Record<string, unknown>;
      const m = j.messung;
      if (!obj(j) || j.version !== 1 || typeof j.id !== 'string' || typeof j.name !== 'string' || typeof j.rolle !== 'string' ||
        typeof j.erstellt !== 'string' || typeof j.herkunft !== 'string' || !obj(m) || !obj(m.lautheit) || !obj(m.stereo) || !obj(m.spektrum)) return null;
      // a file edited by hand or cut short: the curves and the stereo bands must be complete, or the comparison would fail later
      const zahlen = (x: unknown, n: number): boolean => Array.isArray(x) && x.length === n && x.every((y) => typeof y === 'number' && Number.isFinite(y));
      const sp = m.spektrum as Record<string, unknown>, st = m.stereo as Record<string, unknown>;
      if (!zahlen(sp.hz, 120) || !zahlen(sp.mittel_db, 120) || !zahlen(sp.max_db, 120) || !Array.isArray(st.baender) || st.baender.length !== 4) return null;
      return j as never;
    } catch { return null; }
  }

  liste(): ReferenzZeile[] {
    let namen: string[];
    try { namen = fs.readdirSync(this.ordner()); } catch { return []; }
    const aus: ReferenzZeile[] = [];
    for (const n of namen) {
      if (n.startsWith('.') || !n.endsWith('.json')) continue;
      const j = this.lies(path.join(this.ordner(), n));
      if (!j || `${j.id}.json` !== n) continue;
      const l = (j.messung.lautheit as Record<string, unknown>).lufs_i;
      aus.push({ id: j.id, name: j.name, rolle: j.rolle, erstellt: j.erstellt, herkunft: j.herkunft, lufs_i: zahl(l) ? l : null });
    }
    const rang = (r: string): number => { const i = (ROLLEN as readonly string[]).indexOf(r); return i < 0 ? ROLLEN.length : i; };
    return aus.sort((a, b) => rang(a.rolle) - rang(b.rolle) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Stores a measured range. A silent one is refused: a reference without level has nothing to compare against. */
  merke(a: { name: string; rolle: string; messung: RefMessung; herkunft: string }): ReferenzZeile {
    const { name, rolle } = nameRolleLesen(a.name, a.rolle);
    if (a.messung.stumm) return fehl('argument_ungueltig', 'the range is silent; there is nothing to store as a reference');
    let id = `${slug(name)}-${crypto.randomBytes(3).toString('hex')}`;
    while (fs.existsSync(path.join(this.ordner(), `${id}.json`))) id = `${slug(name)}-${crypto.randomBytes(3).toString('hex')}`;   // never replace one
    const erstellt = new Date().toISOString();
    const herkunft = String(a.herkunft).replace(/[\r\n]+/g, ' ').slice(0, 200);
    const { lautheit, stereo, spektrum, bereich } = a.messung;
    const inhalt = { version: 1, id, name, rolle, erstellt, herkunft, messung: { lautheit, stereo, spektrum, ...(bereich ? { bereich } : {}) } };
    const ziel = this.datei(id), teil = path.join(this.ordner(), `.${id}.${process.pid}.tmp`);
    try {
      fs.mkdirSync(this.ordner(), { recursive: true });
      fs.writeFileSync(teil, JSON.stringify(inhalt));
      fs.renameSync(teil, ziel);
    } catch (e) {
      try { fs.rmSync(teil, { force: true }); } catch { /* the temporary file is the only thing that can be left */ }
      return fehl('speichern_fehler', 'the reference could not be stored', (e as Error).message);
    }
    return { id, name, rolle, erstellt, herkunft, lufs_i: lautheit.lufs_i };
  }

  loesche(id: string): void {
    const von = this.datei(id);
    if (!fs.existsSync(von)) return fehl('referenz_unbekannt', `there is no stored reference ${id}`);
    const korb = path.join(this.ordner(), '.papierkorb');
    try {
      fs.mkdirSync(korb, { recursive: true });
      fs.renameSync(von, path.join(korb, `${id}.${Date.now()}.json`));
    } catch (e) { fehl('speichern_fehler', 'the reference could not be moved to the bin', (e as Error).message); }
  }

  lade(id: string): RefMessung {
    const j = this.lies(this.datei(id));
    if (!j || j.id !== id) return fehl('referenz_unbekannt', `there is no stored reference ${id}`);
    const m = j.messung as unknown as { lautheit: Lautheitswerte; stereo: Stereo; spektrum: Spektrum; bereich?: RefBereich };
    return { quelle: { art: 'referenz', id }, name: j.name, rolle: j.rolle, stumm: false, lautheit: m.lautheit, stereo: m.stereo, spektrum: m.spektrum,
      ...(m.bereich ? { bereich: m.bereich } : {}) };
  }

  /** What a cached answer that used this reference is keyed by: the file as it is now (real path, change time, size), so a replaced file or a removed
   *  reference is never answered from a cache. Refuses like messe() when the reference is gone. */
  stempel(q: RefQuelle): string {
    const quelle = refQuelleLesen(q, 'quelle');
    let pfad: string;
    if (quelle.art === 'referenz') pfad = this.datei(quelle.id as string);
    else if (quelle.sha !== undefined) {
      let z: { pfad: string; name?: string } | null = null;
      try { z = this.o.katalogPfad(quelle.sha); } catch { z = null; }
      if (!z) return fehl('quelle_unbekannt', `the catalogue has no file for ${quelle.sha}`);
      pfad = z.pfad;
    } else pfad = quelle.pfad as string;
    try {
      const st = fs.statSync(pfad);
      return `${fs.realpathSync(pfad)}|${st.mtimeMs}|${st.size}`;
    } catch {
      return quelle.art === 'referenz' ? fehl('referenz_unbekannt', `there is no stored reference ${quelle.id}`)
        : fehl('quelle_unbekannt', `audio file is missing: ${pfad}`);
    }
  }

  // ---- measuring ----

  /** Measures a reference: a stored one is read, a file range is decoded and analysed (see the header). `dauerS` is the length of the analysed range
   *  of the strip, which the loudest window of a longer file matches. */
  async messe(q: RefQuelle, dauerS?: number): Promise<RefMessung> {
    const quelle = refQuelleLesen(q, 'quelle');
    const dauer = dauerLesen(dauerS);
    if (quelle.art === 'referenz') return this.lade(quelle.id as string);
    let pfad: string, katName: string | undefined;
    if (quelle.sha !== undefined) {
      let z: { pfad: string; name?: string } | null = null;
      try { z = this.o.katalogPfad(quelle.sha); } catch { z = null; }
      if (!z) return fehl('quelle_unbekannt', `the catalogue has no file for ${quelle.sha}`);
      pfad = z.pfad; katName = z.name;
    } else pfad = quelle.pfad as string;
    let st: fs.Stats;
    try { st = fs.statSync(pfad); } catch { return fehl('quelle_unbekannt', `audio file is missing: ${pfad}`); }
    if (!st.isFile()) return fehl('quelle_unbekannt', `not a regular file: ${pfad}`);
    const schl = [fs.realpathSync(pfad), st.mtimeMs, st.size, quelle.von_s ?? '', quelle.bis_s ?? '', quelle.von_s === undefined ? dauer ?? '' : ''].join('|');
    let kern = this.lru.get(schl);
    if (kern) { this.lru.delete(schl); this.lru.set(schl, kern); } else {
      let lauf = this.imFlug.get(schl);
      if (!lauf) {
        lauf = this.einreihen(() => this.messeDatei(pfad, quelle, dauer)).finally(() => { this.imFlug.delete(schl); });
        this.imFlug.set(schl, lauf);
      }
      kern = await lauf;
      this.lru.delete(schl);
      this.lru.set(schl, kern);
      while (this.lru.size > (this.o.lruGroesse ?? 16)) this.lru.delete(this.lru.keys().next().value as string);
    }
    const name = katName && katName.trim() ? katName.trim() : path.basename(pfad, path.extname(pfad));
    return { quelle, name, stumm: kern.stumm, lautheit: { ...kern.lautheit }, stereo: kern.stereo, spektrum: kern.spektrum, bereich: { ...kern.bereich } };
  }

  private einreihen<T>(f: () => Promise<T>): Promise<T> {
    const lauf = this.kette.then(f, f);
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }

  private async messeDatei(pfad: string, q: RefQuelle, dauerS: number | undefined): Promise<Kern> {
    const { dauer: dateiS, kanaele } = await this.sonde(pfad);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-referenz-'));
    try {
      const geholt = Math.min(dateiS, REF_DAUER_MAX_S);
      const wav = path.join(tmp, 'ref.wav');
      let von: number, bis: number, wahl: RefBereich['wahl'];
      if (q.von_s !== undefined) {
        von = q.von_s; bis = q.bis_s as number; wahl = 'fest';
        if (von < 0 || bis - von < REF_MIN_S) return fehl('argument_ungueltig', `von_s and bis_s: at least ${REF_MIN_S} s starting at 0 or later are required`);
        if (bis > dateiS + 0.001) return fehl('argument_ungueltig', `bis_s: the file is ${runde(dateiS)} s long`);
        if (bis > geholt + 0.001) return fehl('argument_ungueltig', `bis_s: only the first ${REF_DAUER_MAX_S} s of a file can be measured`);
      }
      await this.dekodiere(pfad, wav, kanaele, geholt);
      const frames = wavFrames(wav);
      if (frames < 1) return fehl('format_falsch', 'the file has no audio to measure');
      const gesamtS = frames / RATE;
      // the container may be longer than its audio (a video file): a fixed range has to lie inside what was decoded
      if (q.von_s !== undefined && (q.bis_s as number) > gesamtS + 0.05) {
        return fehl('argument_ungueltig', `bis_s: the audio of the file ends at ${runde(gesamtS)} s`);
      }
      if (q.von_s === undefined) {
        if (dauerS !== undefined && dateiS > 2 * dauerS) { von = lautestesFenster(wav, dauerS); bis = von + dauerS; wahl = 'laut'; }
        else { von = 0; bis = runde(gesamtS); wahl = 'ganz'; }
      }
      const vFrames = Math.min(Math.round(von! * RATE), frames - 1);
      const n = Math.max(1, Math.min(Math.round((bis! - von!) * RATE), frames - vFrames));
      const analyse = this.o.analysiere ?? ((x: WerkAuftrag) => analysiereImWerk(x, this.o.messungModul));
      const [l, w] = await Promise.all([
        messeLautheit(wav, this.o.ffmpeg, 120_000, { maxima: true, von_s: vFrames / RATE, dauer_s: n / RATE }),
        analyse({ quelle: wav, frames: [n], versatz: [vFrames] }).catch((e: unknown) => {
          if (e instanceof AusgabeFehler) throw e;
          throw new AusgabeFehler('messung_fehler', 'the analysis failed', (e as Error)?.message ?? String(e));
        }),
      ]);
      if (l.loudness_fehler) throw new AusgabeFehler('messung_fehler', `the loudness measurement failed: ${l.loudness_fehler}`);
      const t = w.quelle;
      return { stumm: t.stumm, lautheit: lautheitswerte(t, l), stereo: t.stereo, spektrum: t.spektrum,
        bereich: { von_s: runde(von!), bis_s: wahl! === 'fest' ? bis! : runde(Math.min(bis!, (vFrames + n) / RATE)), datei_s: runde(dateiS), wahl: wahl! } };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // duration and channel count of the first audio stream; no audio stream: format_falsch
  private async sonde(pfad: string): Promise<{ dauer: number; kanaele: number }> {
    const [prog, ...vor] = this.o.ffprobe ?? ['ffprobe'];
    const r = await lauf(prog, [...vor, '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels:format=duration', '-of', 'json', pfad],
      60_000);
    if (r.fehlt) return fehl('messung_fehler', 'ffprobe could not be started', r.fehlt);
    let j: { streams?: { channels?: number }[]; format?: { duration?: string } } = {};
    try { j = JSON.parse(r.aus); } catch { /* answered below */ }
    const dauer = Number(j.format?.duration), kanaele = j.streams?.[0]?.channels;
    if (r.code !== 0 || !j.streams?.length || !Number.isFinite(dauer) || dauer <= 0 || !kanaele) return fehl('format_falsch', `not an audio file: ${pfad}`);
    return { dauer, kanaele };
  }

  // float32 stereo 48 kHz WAV of the first `sek` seconds; mono is doubled without level loss (as project/decode.ts), more than two channels are mixed.
  // ffmpeg writes raw f32le to its stdout (its own WAV muxer writes an extensible header that sampler/wav.ts refuses); the header of
  // project/recording.ts is put in front and corrected at the end.
  private async dekodiere(pfad: string, wav: string, kanaele: number, sek: number): Promise<void> {
    const kanal = kanaele === 1 ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : kanaele > 2 ? ['-ac', '2'] : [];
    const [prog, ...vor] = this.o.ffmpeg ?? ['ffmpeg'];
    const fd = fs.openSync(wav, 'w');
    let bytes = 0, schreibFehler = '';
    try {
      const kopf = wavKopf(0);
      fs.writeSync(fd, kopf);
      const r = await lauf('nice', ['-n', '19', prog, ...vor, '-nostdin', '-v', 'error', '-i', pfad, '-map', '0:a:0', ...kanal, '-ar', String(RATE),
        '-t', String(sek + 0.5), '-f', 'f32le', '-'], 300_000, (b) => {
        if (schreibFehler) return;
        try { fs.writeSync(fd, b); bytes += b.length; } catch (e) { schreibFehler = (e as Error).message; }
      });
      if (schreibFehler) return fehl('messung_fehler', 'the decoded audio could not be written', schreibFehler);
      if (r.fehlt || r.code === 127 || r.code === 126) return fehl('messung_fehler', 'ffmpeg could not be started', r.fehlt || prog);
      if (r.code !== 0) return fehl('format_falsch', `the file could not be decoded: ${pfad}`, r.fehler.trim().split('\n').at(-1)?.slice(0, 200));
      const frames = Math.floor(bytes / 8);
      fs.writeSync(fd, wavKopf(frames), 0, 58, 0);
      fs.ftruncateSync(fd, 58 + frames * 8);
    } finally { fs.closeSync(fd); }
  }
}

// one child process; waits for 'close' so the output is complete; a limit kills it
type LaufErgebnis = { code: number | null; aus: string; fehler: string; fehlt: string };
function lauf(prog: string, args: string[], limitMs: number, daten?: (b: Buffer) => void): Promise<LaufErgebnis> {
  return new Promise((ok) => {
    const k = spawn(prog, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let aus = '', fehler = '', fehlt = '';
    k.stdout.on('data', (b: Buffer) => { if (daten) daten(b); else aus = (aus + b).slice(0, 65536); });
    k.stderr.on('data', (b: Buffer) => { fehler = (fehler + b).slice(-4096); });
    const uhr = setTimeout(() => { fehlt = `time limit ${limitMs} ms`; k.kill('SIGKILL'); }, limitMs);
    k.once('error', (e) => { clearTimeout(uhr); ok({ code: -1, aus, fehler, fehlt: e.message }); });
    k.once('close', (code) => { clearTimeout(uhr); ok({ code, aus, fehler, fehlt }); });
  });
}
