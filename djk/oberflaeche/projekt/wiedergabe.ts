// Übersetzer Projekt → Wiedergabe cypherdj-arr/1 (Spec 3.2) und Ablage der Wiedergabe-Dateien im Arbeitsordner (Spec 2.9).
// Die Datei heißt wiedergabe-<nr>.json; <nr> ist die Wiedergabe-Nummer der Instanz (Spec 6.1), nicht die Projekt-Revision: der
// WiedergabeZaehler vergibt sie fortlaufend über Projekte hinweg und findet beim Start im Arbeitsordner wieder, wo er stand.
// Die Wiedergabe trägt nur, was der Kern abspielt: absolute Beats, Audio-Clips mit Datei/Frames/Offset, Noten flach je Spur an den
// Clip-Grenzen geschnitten. Mixer-Werte stehen nicht darin (Regler, 2.3), Tempo auch nicht (Beats sind absolut).
import fs from 'node:fs';
import path from 'node:path';
import { MAX_CLIPS, MAX_NOTEN, MAX_SPUREN, SAMPLERATE, type AudioClip, type MidiClip, type Note, type Projekt, type Spur } from './modell.ts';

export const WIEDERGABE_FORMAT = 'cypherdj-arr/1';
export const BEHALTE = 5;                                    // so viele wiedergabe-<nr>.json bleiben, die zuletzt geschriebenen (Spec 6.1)

export class WiedergabeFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; }
}

export interface WAudioClip {
  id: string; start_beat: number; laenge_beats: number; sha256: string; datei: string; frames: number; offset_frames: number;
  gain_db: number; ein_beats: number; aus_beats: number;
}
export interface WNote { id: string; beat: number; laenge: number; ton: number; vel: number }
export type WSpur =
  | { nr: number; art: 'audio'; clips: WAudioClip[] }
  | { nr: number; art: 'intern'; geraet: 'rb338'; parameter: Record<string, number>; noten: WNote[] }
  | { nr: number; art: 'wirt'; slot: number; noten: WNote[] };
export interface Wiedergabe { format: typeof WIEDERGABE_FORMAT; nr: number; spuren: WSpur[] }

export interface UebersetzOptionen {
  nr: number;                                                // Wiedergabe-Nummer (WiedergabeZaehler.naechste())
  audioOrdner: string;                                       // <arbeitsordner>/audio: dort liegt <sha256>.f32
  frames?: (sha256: string) => number | null;                // Stereo-Frames der dekodierten Datei oder null (nicht bereit); Vorgabe: Dateigröße / 8
  arbeitsordner?: string;                                    // nötig, sobald eine Spur eingefroren ist: freeze.datei ist relativ dazu (Spec 6.14, 6.29)
  existiert?: (datei: string) => boolean;                    // Vorgabe fs.existsSync (Haken für Tests)
}

const sortiereNoten = (a: WNote, b: WNote): number => a.beat - b.beat || a.ton - b.ton || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function dateiFrames(audioOrdner: string): (sha: string) => number | null {
  return (sha) => {
    try { const g = fs.statSync(path.join(audioOrdner, `${sha}.f32`)).size; return g >= 8 ? Math.floor(g / 8) : null; } catch { return null; }
  };
}

// --- Clip-Loop ausrollen (Spec 6.17): Wiedergabe-Format und Kern bleiben unverändert ---------------------------------------
// Kopien k = 0 .. ⌈laenge/loop⌉ − 1, Start start_beat + k·loop, Länge min(loop, Rest), gleicher Offset; Einblende nur auf Kopie 0,
// Ausblende nur auf der letzten (beide auf die Kopienlänge begrenzt). Ohne Loop genau der Clip selbst mit seiner ID.
export interface AudioKopie { id: string; start_beat: number; laenge_beats: number; ein_beats: number; aus_beats: number }
export function audioKopien(c: AudioClip): AudioKopie[] {
  const loop = c.loop_beats ?? null;
  if (loop === null) return [{ id: c.id, start_beat: c.start_beat, laenge_beats: c.laenge_beats, ein_beats: c.fade_ein_beats, aus_beats: c.fade_aus_beats }];
  const aus: AudioKopie[] = [];
  for (let k = 0; k * loop < c.laenge_beats - 1e-9; k++) {
    const laenge = Math.min(loop, c.laenge_beats - k * loop);
    aus.push({ id: `${c.id}~${k}`, start_beat: c.start_beat + k * loop, laenge_beats: laenge,
      ein_beats: k === 0 ? Math.min(c.fade_ein_beats, laenge) : 0, aus_beats: 0 });
  }
  aus[aus.length - 1].aus_beats = Math.min(c.fade_aus_beats, aus[aus.length - 1].laenge_beats);
  return aus;
}
// Ruft f für jede klingende Note des Clips (absolute Beats, an Clip-Ende und Loop-Ende geschnitten). Mit Loop: nur Noten mit beat < loop,
// je Kopie um k·loop verschoben, ID <clip>~<k>/<note>; Noten ab loop_beats bleiben im Projekt, klingen aber nicht.
export function fuerAusgerollteNoten(c: MidiClip, f: (id: string, beat: number, laenge: number, n: Note) => void): void {
  const ende = c.start_beat + c.laenge_beats;
  const loop = c.loop_beats ?? null;
  if (loop === null) {
    for (const n of c.noten) {
      const beat = c.start_beat + n.beat;
      if (beat < ende) f(`${c.id}/${n.id}`, beat, Math.min(n.laenge, ende - beat), n);   // beginnt am oder hinter dem Clip-Ende: still
    }
    return;
  }
  for (let k = 0; k * loop < c.laenge_beats - 1e-9; k++) {
    const basis = c.start_beat + k * loop, kopieEnde = Math.min(basis + loop, ende);
    for (const n of c.noten) {
      const beat = basis + n.beat;                           // eine Note ab loop_beats liegt hinter kopieEnde: still
      if (beat < kopieEnde) f(`${c.id}~${k}/${n.id}`, beat, Math.min(n.laenge, kopieEnde - beat), n);
    }
  }
}
// Zahl der Clips und Noten nach dem Ausrollen (alle Audio-Clips, gleich ob dekodiert; eine eingefrorene Wirt-Spur zählt einen Clip)
export function zaehleAusgerollt(p: Projekt): { clips: number; noten: number } {
  let clips = 0, noten = 0;
  for (const s of p.spuren) {
    if (s.geraet?.art === 'wirt' && s.freeze) { clips += 1; continue; }
    for (const c of s.clips) {
      if (c.art === 'audio') clips += audioKopien(c).length;
      else fuerAusgerollteNoten(c, () => { noten += 1; });
    }
  }
  return { clips, noten };
}

function audioClips(c: AudioClip, o: Required<Pick<UebersetzOptionen, 'frames'>> & UebersetzOptionen): WAudioClip[] {
  if (c.dekodiert !== 'fertig') return [];                   // Spec 3.2: nur fertig dekodierte Clips
  const frames = o.frames!(c.quelle.sha256);
  if (frames === null) return [];                            // Datei fehlt oder leer: noch nicht spielbar
  const offset = Math.round(c.offset_s * SAMPLERATE);
  if (offset >= frames) return [];                           // hinter dem Dateiende: nichts zu spielen
  const datei = path.join(o.audioOrdner, `${c.quelle.sha256}.f32`);
  return audioKopien(c).map((k) => ({ id: k.id, start_beat: k.start_beat, laenge_beats: k.laenge_beats, sha256: c.quelle.sha256,
    datei, frames, offset_frames: offset, gain_db: c.gain_db, ein_beats: k.ein_beats, aus_beats: k.aus_beats }));
}

function noten(s: Spur): WNote[] {
  const aus: WNote[] = [];
  for (const c of s.clips) {
    if (c.art !== 'midi') continue;
    fuerAusgerollteNoten(c, (id, beat, laenge, n) => { aus.push({ id, beat, laenge, ton: n.ton, vel: n.vel }); });
  }
  return aus.sort(sortiereNoten);
}

export function uebersetze(p: Projekt, opt: UebersetzOptionen): Wiedergabe {
  if (!Number.isInteger(opt.nr) || opt.nr < 1) throw new WiedergabeFehler('nr_ungueltig', `Wiedergabe-Nummer ${opt.nr}`);
  if (p.spuren.length > MAX_SPUREN) throw new WiedergabeFehler('zu_gross', `spuren: ${p.spuren.length} > ${MAX_SPUREN}`);
  const o = { ...opt, frames: opt.frames ?? dateiFrames(opt.audioOrdner) };
  let clips = 0, nZahl = 0;
  const spuren: WSpur[] = [...p.spuren].sort((a, b) => a.nr - b.nr).map((s): WSpur => {
    if (s.art === 'audio') {
      const cs = s.clips.flatMap((c) => (c.art === 'audio' ? audioClips(c, o) : []))
        .sort((a, b) => a.start_beat - b.start_beat || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      clips += cs.length;
      return { nr: s.nr, art: 'audio', clips: cs };
    }
    const g = s.geraet!;
    if (g.art === 'wirt' && s.freeze) {
      if (!o.arbeitsordner) throw new WiedergabeFehler('arbeitsordner_fehlt', `Spur ${s.id} ist eingefroren`);
      const datei = path.join(o.arbeitsordner, s.freeze.datei);
      if (!(o.existiert ?? fs.existsSync)(datei)) throw new WiedergabeFehler('datei_fehlt', datei);
      clips += 1;                                            // die sha256 steht im Projekt (beim Einfrieren berechnet, Spec 6.2): die Datei wird nicht gelesen
      const laenge = s.freeze.frames / SAMPLERATE * p.tempo_bpm / 60;
      return { nr: s.nr, art: 'audio', clips: [{ id: `${s.id}/freeze`, start_beat: s.freeze.von_beat ?? 0, laenge_beats: laenge,
        sha256: s.freeze.sha256, datei, frames: s.freeze.frames, offset_frames: 0, gain_db: 0, ein_beats: 0, aus_beats: 0 }] };
    }
    const n = noten(s); nZahl += n.length;
    return g.art === 'intern'
      ? { nr: s.nr, art: 'intern', geraet: 'rb338', parameter: { ...g.parameter }, noten: n }
      : { nr: s.nr, art: 'wirt', slot: g.slot, noten: n };
  });
  if (clips > MAX_CLIPS) throw new WiedergabeFehler('zu_gross', `clips: ${clips} > ${MAX_CLIPS}`);
  if (nZahl > MAX_NOTEN) throw new WiedergabeFehler('zu_gross', `noten: ${nZahl} > ${MAX_NOTEN}`);
  return { format: WIEDERGABE_FORMAT, nr: opt.nr, spuren };
}

export const wiedergabeDatei = (arbeitsordner: string, nr: number): string => path.join(arbeitsordner, `wiedergabe-${nr}.json`);

const DATEI_NR = /^wiedergabe-(\d+)\.json$/;
const nummern = (arbeitsordner: string): number[] => {
  try {
    return fs.readdirSync(arbeitsordner).map((n) => DATEI_NR.exec(n)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
  } catch { return []; }
};

// Vergibt die Wiedergabe-Nummern einer Instanz: fortlaufend, über Projekte hinweg eindeutig, beim Start aus dem Arbeitsordner
// wiederhergestellt (die höchste vorhandene Datei; die zuletzt geschriebene bleibt immer, siehe schreibeWiedergabe). Fremde Namen zählen nicht.
// Spec 6.30: Nummern werden nie wiederverwendet, auch nicht nach dem Leeren des Arbeitsordners (Cache). Mit `zustand` steht der Zähler
// zusätzlich in dieser Datei ausserhalb des Arbeitsordners; beim Start gilt das Maximum aus Datei und Arbeitsordner.
// Spec 6.32 (Leistung): Nummern werden in Blöcken zu ZAEHLER_BLOCK reserviert. Die Datei hält die obere Grenze des laufenden Blocks und wird nur
// beim Blockwechsel geschrieben, dann haltbar (Spec 6.31: Temp mit fsync, rename, fsync auf den Ordner); im Block kostet eine Nummer kein
// Schreiben. Nach einem Neustart beginnt der Zähler an der gespeicherten Grenze: Lücken sind erlaubt, eine Nummer zweimal nie. Niemand setzt
// aufeinanderfolgende Nummern voraus (der Wiederanlauf vergleicht /zustand/arr.nr mit wiedergabe_rev des Projekts, nicht mit dem Zähler; Kern und
// Attrappe adressieren die Datei nur über die Nummer). Ein Zähler je Instanz (der Server); eine fehlende oder unlesbare Datei zählt als 0;
// scheitert das Schreiben, wirft naechste() und die Nummer gilt als nicht vergeben.
export const ZAEHLER_BLOCK = 1024;
export class WiedergabeZaehler {
  private zuletzt: number;
  private grenze: number;                                    // höchste reservierte Nummer (steht so in der Datei)
  private readonly zustand: string | null;
  constructor(arbeitsordner: string, zustand: string | null = null) {
    this.zustand = zustand;
    this.zuletzt = Math.max(nummern(arbeitsordner).reduce((m, n) => Math.max(m, n), 0), this.ausDatei());
    this.grenze = this.zuletzt;                              // noch kein Block dieses Laufs: die erste Nummer reserviert einen
  }
  private ausDatei(): number {
    if (!this.zustand) return 0;
    try {
      const n = Number(fs.readFileSync(this.zustand, 'utf8').trim());
      return Number.isSafeInteger(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }
  naechste(): number {
    const nr = this.zuletzt + 1;
    if (this.zustand && nr > this.grenze) {
      const grenze = this.zuletzt + ZAEHLER_BLOCK;
      schreibeHaltbar(this.zustand, `${grenze}\n`);
      this.grenze = grenze;
    }
    this.zuletzt = nr;
    return nr;
  }
}
// Spec 6.31: haltbar wie project.json (ablage.ts): Inhalt mit fsync auf die Temp-Datei, rename, fsync auf den Ordner. Ohne fsync kann nach
// einem Stromausfall eine leere Datei stehen, und der Zähler fiele auf den Arbeitsordner zurück (Quality-Probe Z2).
function schreibeHaltbar(ziel: string, inhalt: string): void {
  const ordner = path.dirname(ziel), tmp = `${ziel}.${process.pid}.teil`;
  fs.mkdirSync(ordner, { recursive: true });
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, inhalt); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, ziel);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  const dfd = fs.openSync(ordner, 'r');
  try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
}

// Schreibt <arbeitsordner>/wiedergabe-<nr>.json (Temp + rename) und räumt alle bis auf die letzten BEHALTE weg. Weil die Nummern steigen,
// sind das die zuletzt geschriebenen; die gerade geschriebene Datei bleibt in jedem Fall. Fremde Dateien im Ordner (audio/,
// freeze-*.f32, andere Namen) bleiben unberührt.
export function schreibeWiedergabe(arbeitsordner: string, w: Wiedergabe): string {
  fs.mkdirSync(arbeitsordner, { recursive: true });
  const ziel = wiedergabeDatei(arbeitsordner, w.nr), tmp = `${ziel}.${process.pid}.teil`;
  try { fs.writeFileSync(tmp, JSON.stringify(w)); fs.renameSync(tmp, ziel); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  const alle = nummern(arbeitsordner).sort((a, b) => b - a);
  const behalten = new Set([w.nr, ...alle.slice(0, BEHALTE)]);
  for (const n of alle) if (!behalten.has(n)) fs.rmSync(wiedergabeDatei(arbeitsordner, n), { force: true });
  return ziel;
}
