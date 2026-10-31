// Übersetzer Projekt → Wiedergabe cypherdj-arr/1 oder /2 (Spec 3.2; /2 bei Routing, 1.10 P2, oder bei gewarptem Clip, 1.13) und Ablage (Spec 2.9).
// Paket 1.13: ein Audio-Clip mit Warp an trägt `warp: { modus: 0 | 1 | 2 | 3, w: [[beat, frame], …], pitch? }` (je Clip und je Loop-Kopie); ohne Routing und
// ohne Warp bleibt die Datei Zeichen für Zeichen die von /1.
// Die Datei heißt wiedergabe-<nr>.json; <nr> ist die Wiedergabe-Nummer der Instanz (Spec 6.1), nicht die Projekt-Revision: der
// WiedergabeZaehler vergibt sie fortlaufend über Projekte hinweg und findet beim Start im Arbeitsordner wieder, wo er stand.
// Die Wiedergabe trägt nur, was der Kern abspielt: absolute Beats, Audio-Clips mit Datei/Frames/Offset, Noten flach je Spur an den
// Clip-Grenzen geschnitten. Mixer-Werte stehen nicht darin (Regler, 2.3), Tempo auch nicht (Beats sind absolut).
import fs from 'node:fs';
import path from 'node:path';
import { BEATS_VORGABE, MAX_CLIPS, MAX_NOTEN, MAX_SPUREN, SAMPLERATE, pitchFaktor } from './modell.ts';
import { MAX_BEATS_EINHEITEN, beatsEinheiten, beatsEinheitenZahl } from './warp.ts';
import type { AudioClip, MidiClip, Note, Projekt, Spur, Warp } from './modell.ts';

export const WIEDERGABE_FORMAT = 'cypherdj-arr/1';
// /2, wenn das Projekt Gruppen hat oder eine Spur nicht auf master zeigt (1.10, P2) oder ein Audio-Clip Warp an trägt (1.13); sonst /1 byteweise wie bisher
export const WIEDERGABE_FORMAT_2 = 'cypherdj-arr/2';
export const MAX_WARP_PUNKTE = 262_144;                       // Marker aller Clips (und Loop-Kopien) einer Wiedergabe; gleich ARR_WARP_PUNKTE_MAX im Kern
export const WARP_MODUS_NR: Readonly<Record<string, number>> = { repitch: 0, beats: 1, complex: 2, tones: 3 };
// 1 spielt der Callback (Slice 4), 2 und 3 das Warp-Werk des Kerns
const BEATS_LOOP_NR: Readonly<Record<string, number>> = { aus: 0, vor: 1, vor_zurueck: 2 };
export const BEHALTE = 5;                                    // so viele wiedergabe-<nr>.json bleiben, die zuletzt geschriebenen (Spec 6.1)

export class WiedergabeFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; }
}

export interface WAudioClip {
  id: string; start_beat: number; laenge_beats: number; sha256: string; datei: string; frames: number; offset_frames: number;
  gain_db: number; ein_beats: number; aus_beats: number;
  // Paket 1.13 (nur /2): Marker [Clip-Beat der Kopie, Quell-Frame], nur bei Warp an; pitch (Slice 5) nur bei != 1
  warp?: { modus: number; w: [number, number][]; pitch?: number; e?: [number, number][]; loop?: number; huelle?: number };
}
export interface WNote { id: string; beat: number; laenge: number; ton: number; vel: number }
export type WZiel = { art: 'gruppe'; nr: number };   // fehlt `ausgang`, zeigt die Spur auf den Produktions-Master
export type WSpur =
  | { nr: number; art: 'audio'; clips: WAudioClip[]; ausgang?: WZiel }
  | { nr: number; art: 'intern'; geraet: 'rb338'; parameter: Record<string, number>; noten: WNote[]; ausgang?: WZiel }
  | { nr: number; art: 'wirt'; slot: number; noten: WNote[]; ausgang?: WZiel };
export interface WGruppe { nr: number; ausgang: { art: 'master' } }   // Tiefe 1 (P2): eine Gruppe führt immer in den Master
export interface Wiedergabe { format: typeof WIEDERGABE_FORMAT | typeof WIEDERGABE_FORMAT_2; nr: number; spuren: WSpur[]; gruppen?: WGruppe[] }

export interface UebersetzOptionen {
  nr: number;                                                // Wiedergabe-Nummer (WiedergabeZaehler.naechste())
  audioOrdner: string;                                       // <arbeitsordner>/audio: dort liegt <sha256>.f32
  frames?: (sha256: string) => number | null;                // Stereo-Frames der dekodierten Datei oder null (nicht bereit); Vorgabe: Dateigröße / 8
  arbeitsordner?: string;                                    // nötig, sobald eine Spur eingefroren ist: freeze.datei ist relativ dazu (Spec 6.14, 6.29)
  existiert?: (datei: string) => boolean;                    // Vorgabe fs.existsSync (Haken für Tests)
  transienten?: (sha256: string) => number[] | null;         // Slice 4: Transienten einer Quelle in Sekunden, aufsteigend; fehlt sie, gilt null (Raster 1/16)
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

// Marker der Wiedergabe: Clip-Beat der Kopie (der Marker-Beat minus versatz_beats, jede Kopie beginnt wieder bei versatz_beats) und Quell-Frame
function warpMarker(c: AudioClip): [number, number][] | null {
  if (!c.warp?.an) return null;
  return c.warp.marker.map(([quellS, beat]) => [beat - c.warp!.versatz_beats, quellS * SAMPLERATE]);
}

// Slice 5: pitch nur bei Transpose oder Detune (ohne bleibt die Datei Zeichen für Zeichen wie vor Slice 5)
const pitchFeld = (w: Warp): { pitch?: number } => { const p = pitchFaktor(w.transpose_st, w.detune_ct); return p === 1 ? {} : { pitch: p }; };

// Transienten nur holen, wenn das Raster sie braucht (die erste Abfrage einer Quelle rechnet synchron)
const transientenFuer = (c: AudioClip, quelle?: (sha256: string) => number[] | null): number[] | null =>
  (c.warp?.beats ?? BEATS_VORGABE).raster === 'transienten' ? quelle?.(c.quelle.sha256) ?? null : null;

// Slice 4: Einheiten, Lückenmodus und Hülle eines BEATS-Clips; einmal je Clip, nicht je Loop-Kopie (jede Kopie trägt dieselbe Liste)
function beatsFeld(c: AudioClip, o: UebersetzOptionen, frames: number): { e?: [number, number][]; loop?: number; huelle?: number } {
  if (c.warp!.modus !== 'beats') return {};
  const b = c.warp!.beats ?? BEATS_VORGABE;
  const roh = beatsEinheiten(c.warp!, c.loop_beats ?? c.laenge_beats, transientenFuer(c, o.transienten));
  if (roh.length > MAX_BEATS_EINHEITEN) throw new WiedergabeFehler('beats_einheiten', `${c.id}: mehr als ${MAX_BEATS_EINHEITEN} Einheiten`);
  // Frames nach dem Runden streng steigend (der Kern lehnt sonst die ganze Wiedergabe mit format ab) und innerhalb der Quelle; mindestens eine Einheit bleibt
  const alle = roh.map(([beat, s]): [number, number] => [beat - c.warp!.versatz_beats, Math.round(s * SAMPLERATE)]);
  const e: [number, number][] = [];
  for (const u of alle) if (u[1] < frames && (e.length === 0 || u[1] > e[e.length - 1][1])) e.push(u);
  if (e.length === 0) e.push([alle[0][0], Math.max(0, Math.min(alle[0][1], frames - 1))]);
  return { e, loop: BEATS_LOOP_NR[b.loop], huelle: b.huelle };
}

function audioClips(c: AudioClip, o: Required<Pick<UebersetzOptionen, 'frames'>> & UebersetzOptionen): WAudioClip[] {
  if (c.stumm) return [];   // Slice 6 (D12): stumm, Live und Export gleich
  if (c.dekodiert !== 'fertig') return [];                   // Spec 3.2: nur fertig dekodierte Clips
  const frames = o.frames!(c.quelle.sha256);
  if (frames === null) return [];                            // Datei fehlt oder leer: noch nicht spielbar
  const marker = warpMarker(c);
  const offset = marker ? 0 : Math.round(c.offset_s * SAMPLERATE);   // gewarpt liest der Kern nicht über offset_frames
  if (offset >= frames) return [];                           // hinter dem Dateiende: nichts zu spielen
  const datei = path.join(o.audioOrdner, `${c.quelle.sha256}.f32`);
  const bf = marker ? beatsFeld(c, o, frames) : {};
  return audioKopien(c).map((k) => ({ id: k.id, start_beat: k.start_beat, laenge_beats: k.laenge_beats, sha256: c.quelle.sha256,
    datei, frames, offset_frames: offset, gain_db: c.gain_db, ein_beats: k.ein_beats, aus_beats: k.aus_beats,
    ...(marker ? { warp: { modus: WARP_MODUS_NR[c.warp!.modus], w: marker.map((m): [number, number] => [m[0], m[1]]),
      ...pitchFeld(c.warp!), ...bf } } : {}) }));
}

// Zahl der Warp-Marker aller Audio-Clips nach dem Ausrollen der Loops (jede Kopie trägt ihre Liste); der Kern lehnt über MAX_WARP_PUNKTE ab
// Slice 4: ein BEATS-Clip zählt zusätzlich seine Einheiten (e) je Kopie; wirft nie (D9). `o` liefert die Transienten, ohne gilt das Raster.
export function zaehleWarpMarker(p: Projekt, o?: Pick<UebersetzOptionen, 'transienten'>): number {
  let n = 0;
  for (const s of p.spuren) {
    for (const c of s.clips) {
      if (c.art !== 'audio' || !c.warp?.an) continue;
      const k = audioKopien(c).length;
      n += c.warp.marker.length * k;
      if (c.warp.modus === 'beats') n += beatsEinheitenZahl(c.warp, c.loop_beats ?? c.laenge_beats, transientenFuer(c, o?.transienten)) * k;
    }
  }
  return n;
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
  const ohneZiel = (s: Spur): WSpur => {
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
  };
  // 1.10 (P2): Ziel je Spur; die Gruppen-Nummer, nicht die ID, steht in der Wiedergabe (der Kern kennt nur Nummern)
  const nrVon = new Map((p.gruppen ?? []).map((g) => [g.id, g.nr] as const));
  const spuren: WSpur[] = [...p.spuren].sort((a, b) => a.nr - b.nr).map((s): WSpur => {
    const w = ohneZiel(s);
    if (!s.ausgang) return w;
    const nr = nrVon.get(s.ausgang.id);
    if (nr === undefined) throw new WiedergabeFehler('ziel_unbekannt', `Spur ${s.id} zeigt auf ${s.ausgang.id}`);
    return { ...w, ausgang: { art: 'gruppe' as const, nr } };
  });
  if (clips > MAX_CLIPS) throw new WiedergabeFehler('zu_gross', `clips: ${clips} > ${MAX_CLIPS}`);
  if (nZahl > MAX_NOTEN) throw new WiedergabeFehler('zu_gross', `noten: ${nZahl} > ${MAX_NOTEN}`);
  const routing = spuren.some((s) => s.ausgang) || (p.gruppen ?? []).length > 0;
  // Paket 1.13: ein gewarpter Clip braucht /2 (der Kern lehnt warp in /1 ab); gruppen steht dann immer da, auch leer
  const gewarpt = spuren.some((sp) => sp.art === 'audio' && sp.clips.some((c) => c.warp !== undefined));
  if (gewarpt && zaehleWarpMarker(p, opt) > MAX_WARP_PUNKTE) throw new WiedergabeFehler('zu_gross', `warp-marker: > ${MAX_WARP_PUNKTE}`);
  if (!routing && !gewarpt) return { format: WIEDERGABE_FORMAT, nr: opt.nr, spuren };   // ohne Routing und Warp byteweise die alte Datei (AK3)
  return { format: WIEDERGABE_FORMAT_2, nr: opt.nr, spuren,
    gruppen: [...(p.gruppen ?? [])].sort((a, b) => a.nr - b.nr).map((g) => ({ nr: g.nr, ausgang: { art: 'master' as const } })) };
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
