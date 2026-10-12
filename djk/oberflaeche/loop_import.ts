// Loop aus dem Katalog in die Loop-Bibliothek (Plan 2026-10-10-mediathek-browser, S6). Die Box nimmt nur 128 BPM und genau
// beats · 22 500 Frames (loops.ts loopGrund). Dafür wird die Datei mit ffmpeg dekodiert (stereo, 48 kHz), mit Rubber Band R3
// offline auf beats · 60/128 s gedehnt, auf die exakte Frame-Zahl geschnitten bzw. aufgefüllt und atomar abgelegt
// (Arbeitsordner .import-<pid>-… → name), wie schreibeLoopAusFassung.
//
// Der Import läuft neben dem Audio des Betriebs und darf es nicht stören (S6-Auftrag):
//  - alle Werkzeuge unter nice 19 und ionice idle (wie die Wellen-Dekodierung in welle_cache.ts),
//  - höchstens ein Import gleichzeitig je Prozess (ein zweiter wird mit 429 abgewiesen, nicht eingereiht),
//  - Längengrenze: die Box nimmt höchstens 32 Beats (8 Takte); die Quelle darf darum höchstens MAX_QUELLE_S lang sein
//    (32 Beats bei der kleinsten erlaubten Tempo-Angabe 60 BPM sind 32 s, dazu eine halbe Beat-Toleranz). Die Dekodierung
//    bricht bei MAX_QUELLE_S + 2 s ab (ffmpeg -t): eine 2-h-Datei kostet nicht mehr als eine 42-s-Datei.
//  - Zeitlimit für den ganzen Import (ZEITLIMIT_MS); danach werden die Prozesse samt Gruppe beendet,
//  - Naht: ein Loop wird als Schleife gedehnt (Kontext), nicht als Datei: vor und hinter den Loop kommt je 1 s von seinem eigenen
//    Anfang/Ende (zyklisch), gedehnt wird das Ganze, der Loop ist die Mitte. Bleibt am Umlauf trotzdem ein Sprung (gemessen: tonales
//    Material, dessen Phase beim Dehnen nicht aufgeht), wird der Anfang eines gedehnten Loops IMMER über 10 ms in die Fortsetzung
//    des Endes übergeblendet (die Überblendung hat nie mehr Hochton als der durchgehende Strom, Review S6: 9/9). Eine Schwelle auf der
//    Naht-Metrik wäre an leisen Stellen blind. Quellen, die schon 128 BPM haben (±4 Frames Rundung), werden nur geschnitten/aufgefüllt.
//  - keine liegengebliebenen Zwischendateien: alles in EINEM Arbeitsordner, der im finally verschwindet; ein Server-Absturz
//    hinterlässt ihn, raeumeImportReste() (beim Start) holt ihn nach.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LOOP_NAME, leseLoops } from './loops.ts';

export const BEATS_ERLAUBT = [1, 2, 4, 8, 16, 32];
export const FRAMES_PRO_BEAT = 22500;   // 48 kHz bei 128 BPM
export const MAX_QUELLE_S = 40;
export const ZEITLIMIT_MS = 60_000;

export class LoopImportFehler extends Error {
  readonly code: number; readonly fehler: string; readonly text: string;
  constructor(code: number, fehler: string, text = '') { super(text || fehler); this.code = code; this.fehler = fehler; this.text = text; }
}

// Beats aus der Mediathek: takte · 4 (4/4), sonst gerundet aus Dauer · BPM / 60. Passt die Dauer nicht zu den Takten
// (mehr als ein halber Beat daneben), ist der Loop nicht sicher geschnitten: lieber ablehnen als falsch dehnen.
// Ohne BPM kein Import: auch mit Takten bleibt offen, in welchem Tempo die Quelle gespielt wurde (Messung 2026-10-11 am echten
// Katalog: 973 Loops ohne BPM, keiner davon mit Takten; Raten hieße falsch dehnen).
export function beatsVon(z: { takte: number | null; bpm: number | null; dauer_s: number | null }): number {
  if (z.bpm === null || !(z.bpm >= 60 && z.bpm <= 200)) throw new LoopImportFehler(409, 'bpm_unbekannt');
  if (z.dauer_s !== null && z.dauer_s > MAX_QUELLE_S) throw new LoopImportFehler(409, 'zu_lang');
  const ausDauer = z.dauer_s !== null ? (z.dauer_s * z.bpm) / 60 : null;
  const b = z.takte !== null ? z.takte * 4 : ausDauer !== null ? Math.round(ausDauer) : NaN;
  if (b > Math.max(...BEATS_ERLAUBT)) throw new LoopImportFehler(409, 'zu_lang');
  if (!BEATS_ERLAUBT.includes(b) || (ausDauer !== null && Math.abs(ausDauer - b) > 0.5)) throw new LoopImportFehler(409, 'takte_unklar');
  return b;
}

export function loopNameVon(roh: string, dir: string): string {
  const basis = roh.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'loop';
  let name = basis;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${basis}-${i}`;
  if (!LOOP_NAME.test(name)) throw new LoopImportFehler(500, 'name_ungueltig');
  return name;
}

// Hat diese Quelle (sha) schon einen ladbaren Loop? Dann wird nicht noch einmal gerechnet und kein Doppelgänger angelegt.
export function findeImport(dir: string, sha: string): { name: string; beats: number } | null {
  for (const l of leseLoops(dir)) {
    if (!l.ladbar) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, l.name, 'loop.json'), 'utf8')) as { herkunft?: { sha?: unknown } };
      if (j.herkunft?.sha === sha) return { name: l.name, beats: l.beats };
    } catch { /* unlesbar: zählt nicht */ }
  }
  return null;
}

const ARBEIT = /^\.import-(\d+)-/;
// Arbeitsordner toter Prozesse (Absturz mitten im Import) wegräumen. Lebende (anderer Server auf demselben Ordner) bleiben.
export function raeumeImportReste(dir: string): number {
  let namen: string[];
  try { namen = fs.readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const name of namen) {
    const m = ARBEIT.exec(name);
    if (!m) continue;
    try { process.kill(Number(m[1]), 0); continue; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EPERM') continue; }
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); n++; } catch { /* weg oder nicht lesbar */ }
  }
  return n;
}

// Naht des Loops: der Sprung vom letzten zum ersten Frame (größter Kanal) im Verhältnis zum 99. Perzentil der Schritte von
// Frame zu Frame. Unter 1 ist der Umlauf nicht lauter als das Material selbst (kein Klick), weit darüber springt er.
export function nahtVon(x: Float32Array): { sprung: number; typisch: number; verhaeltnis: number } {
  const n = Math.floor(x.length / 2);
  if (n < 2) return { sprung: 0, typisch: 0, verhaeltnis: 0 };
  const sprung = Math.max(Math.abs(x[0] - x[2 * (n - 1)]), Math.abs(x[1] - x[2 * (n - 1) + 1]));
  const d = new Float32Array(Math.ceil((n - 1) / 2));   // jeder zweite Schritt genügt für das Perzentil und halbiert die Sortierung
  for (let i = 0, k = 0; i < n - 1; i += 2, k++) d[k] = Math.max(Math.abs(x[2 * i + 2] - x[2 * i]), Math.abs(x[2 * i + 3] - x[2 * i + 1]));
  d.sort();
  const typisch = d[Math.floor((d.length - 1) * 0.99)];
  return { sprung, typisch, verhaeltnis: sprung / Math.max(typisch, 1e-9) };
}
// Naht am LOKALEN Pegel: der Sprung am Umlauf gegen das 99. Perzentil der Schritte in ±50 ms um die Naht (letzte und erste 2 400 Frames,
// der Nahtschritt selbst zählt nicht mit). Das globale p99 übersieht Klicks an leisen Stellen eines insgesamt lauten Loops (Review S6 B1).
export const NAHT_FENSTER = 2400;
export function nahtLokal(x: Float32Array, fenster = NAHT_FENSTER): { sprung: number; typisch: number; verhaeltnis: number } {
  const n = Math.floor(x.length / 2), f = Math.min(fenster, Math.floor(n / 2));
  if (f < 2) return { sprung: 0, typisch: 0, verhaeltnis: 0 };
  const kanal = (i: number, c: number): number => x[2 * i + c];
  const sprung = Math.max(Math.abs(kanal(0, 0) - kanal(n - 1, 0)), Math.abs(kanal(0, 1) - kanal(n - 1, 1)));
  const d: number[] = [];
  for (let i = n - f; i < n - 1; i++) d.push(Math.max(Math.abs(kanal(i + 1, 0) - kanal(i, 0)), Math.abs(kanal(i + 1, 1) - kanal(i, 1))));
  for (let i = 0; i < f - 1; i++) d.push(Math.max(Math.abs(kanal(i + 1, 0) - kanal(i, 0)), Math.abs(kanal(i + 1, 1) - kanal(i, 1))));
  d.sort((p, q) => p - q);
  const typisch = d[Math.floor((d.length - 1) * 0.99)];
  return { sprung, typisch, verhaeltnis: sprung / Math.max(typisch, 1e-9) };
}
const alsFloat = (b: Buffer): Float32Array => (b.byteOffset % 4 === 0 ? new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)) : new Float32Array(Uint8Array.from(b).buffer));
export function nahtSprung(f32: string): { sprung: number; typisch: number; verhaeltnis: number } { return nahtVon(alsFloat(fs.readFileSync(f32))); }

// frames Frames ab Position von (darf negativ sein oder über das Ende gehen) aus q (n Frames, stereo float32), zyklisch gelesen
function zyklisch(q: Buffer, n: number, von: number, frames: number): Buffer {
  const aus = Buffer.alloc(frames * 8);
  for (let i = 0, p = ((von % n) + n) % n; i < frames;) {
    const k = Math.min(n - p, frames - i);
    q.copy(aus, i * 8, p * 8, (p + k) * 8);
    i += k; p = 0;
  }
  return aus;
}
// WAV (float32, stereo, 48 kHz) um rohe Frames — rubberband liest Wav
function wavVon(daten: Buffer): Buffer {
  const kopf = Buffer.alloc(44);
  kopf.write('RIFF', 0, 'latin1'); kopf.writeUInt32LE(36 + daten.length, 4); kopf.write('WAVEfmt ', 8, 'latin1');
  kopf.writeUInt32LE(16, 16); kopf.writeUInt16LE(3, 20); kopf.writeUInt16LE(2, 22); kopf.writeUInt32LE(48000, 24); kopf.writeUInt32LE(48000 * 8, 28);
  kopf.writeUInt16LE(8, 32); kopf.writeUInt16LE(32, 34); kopf.write('data', 36, 'latin1'); kopf.writeUInt32LE(daten.length, 40);
  return Buffer.concat([kopf, daten]);
}
export const KONTEXT_FRAMES = 48000;   // 1 s Kontext vor und hinter dem Loop beim Dehnen
export const UEBERBLENDEN_FRAMES = 480;   // 10 ms
export const RUNDUNG_FRAMES = 4;   // so viel Abweichung wird geschnitten/aufgefüllt statt gedehnt

let laeuft = false;   // höchstens ein Import gleichzeitig

export interface ImportOptionen {
  pfad: string; beats: number; name: string; dir: string; herkunft: Record<string, unknown>;
  bpm?: number | null;                                        // Tempo der Quelle: prüft die GEMESSENE Länge gegen die Beats
  werkzeug?: { ffmpeg?: string[]; rubberband?: string[] };    // Tests: Attrappen davor
  zeitlimitMs?: number;
  bericht?: (b: { naht_vorher: number; naht_nachher: number; naht_lokal_vorher: number; naht_lokal_nachher: number; repariert: boolean; gedehnt: boolean }) => void;   // Messwerte der Naht (Log, Tests)
}

function starte(befehl: string[], args: string[], signal: AbortSignal, fehlerName: string): Promise<void> {
  return new Promise((ok, fehler) => {
    // nice/ionice exec'en das Werkzeug: die PID ist die des Werkzeugs; detached → eigene Gruppe, kill(-pid) trifft auch Kinder
    const p = spawn('nice', ['-n', '19', 'ionice', '-c', '3', ...befehl, ...args], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-300); });
    const ab = (): void => { try { process.kill(-(p.pid as number), 'SIGKILL'); } catch { /* schon weg */ } };
    signal.addEventListener('abort', ab, { once: true });
    p.once('error', (e) => { signal.removeEventListener('abort', ab); fehler(new LoopImportFehler(422, fehlerName, e.message)); });
    p.once('exit', (c) => {
      signal.removeEventListener('abort', ab);
      if (signal.aborted) return fehler(new LoopImportFehler(504, 'zeitlimit'));
      if (c === 0) ok(); else fehler(new LoopImportFehler(422, fehlerName, err.trim() || `rc ${c}`));
    });
  });
}

export async function importiereLoop(o: ImportOptionen): Promise<string> {
  if (!LOOP_NAME.test(o.name)) throw new LoopImportFehler(400, 'name_ungueltig');
  if (laeuft) throw new LoopImportFehler(429, 'import_laeuft');
  laeuft = true;
  const frames = o.beats * FRAMES_PRO_BEAT;
  const ffmpeg = o.werkzeug?.ffmpeg ?? ['ffmpeg'], rubberband = o.werkzeug?.rubberband ?? ['rubberband'];
  const signal = AbortSignal.timeout(o.zeitlimitMs ?? ZEITLIMIT_MS);
  let arbeit = '';
  try {
    fs.mkdirSync(o.dir, { recursive: true });
    arbeit = fs.mkdtempSync(path.join(o.dir, `.import-${process.pid}-`));
    const roh = path.join(arbeit, 'roh.f32'), ein = path.join(arbeit, 'ein.wav'), gedehnt = path.join(arbeit, 'gedehnt.wav'), f32 = path.join(arbeit, 'gedehnt.f32');
    await starte(ffmpeg, ['-nostdin', '-v', 'error', '-y', '-i', o.pfad, '-map', '0:a:0', '-t', String(MAX_QUELLE_S + 2), '-ac', '2', '-ar', '48000', '-f', 'f32le', roh], signal, 'dekodierung');
    const quelle = fs.readFileSync(roh), n = Math.floor(quelle.length / 8), dauer = n / 48000;
    if (dauer > MAX_QUELLE_S) throw new LoopImportFehler(409, 'zu_lang');
    if (dauer < 0.05) throw new LoopImportFehler(422, 'dekodierung', 'kein Audio');
    if (o.bpm) {   // gemessen statt geglaubt: der Katalog kann die Dauer nicht kennen oder falsch haben
      const beat = 60 / o.bpm;
      if (Math.abs(dauer - o.beats * beat) > 0.5 * beat) throw new LoopImportFehler(409, 'takte_unklar');
    }
    let buf: Buffer, fortsetzung: Buffer | null = null;
    if (Math.abs(n - frames) <= RUNDUNG_FRAMES) {   // schon 128 BPM: eine Rundung des Dekodierens (44,1 → 48 kHz: ±1–2 Frames) ist keine Dehnung
      buf = n >= frames ? Buffer.from(quelle.subarray(0, frames * 8)) : Buffer.concat([quelle.subarray(0, n * 8), zyklisch(quelle, n, 0, frames - n)]);   // zu kurz: mit dem Anfang des Loops auffüllen (Umlauf)
    }
    else {
      const k = KONTEXT_FRAMES, gesamt = n + 2 * k;
      fs.writeFileSync(ein, wavVon(zyklisch(quelle, n, -k, gesamt)));
      await starte(rubberband, ['-3', '-q', '-D', String((gesamt * frames) / n / 48000), ein, gedehnt], signal, 'dehnung');
      await starte(ffmpeg, ['-nostdin', '-v', 'error', '-y', '-i', gedehnt, '-ac', '2', '-ar', '48000', '-f', 'f32le', f32], signal, 'dekodierung');
      const aus = fs.readFileSync(f32), von = Math.round((k * frames) / n);   // Anfang des Loops im gedehnten Strom
      buf = Buffer.alloc(frames * 8);
      aus.copy(buf, 0, von * 8, Math.min(aus.length, (von + frames) * 8));
      fortsetzung = Buffer.alloc(UEBERBLENDEN_FRAMES * 8);
      aus.copy(fortsetzung, 0, Math.min(aus.length, (von + frames) * 8), Math.min(aus.length, (von + frames + UEBERBLENDEN_FRAMES) * 8));
    }
    // Naht messen; ein Sprung wird über die Fortsetzung des Endes aufgelöst: Frame 0 ist dann der Nachfolger des letzten Frames
    const x = alsFloat(buf), vorher = nahtVon(x), lokalVorher = nahtLokal(x);
    let repariert = false;
    if (fortsetzung) {   // gedehnte Loops IMMER überblenden (Review S6 B1): kein Schwellwert, der an leisen Stellen blind sein kann
      const f = alsFloat(fortsetzung);
      for (let i = 0; i < UEBERBLENDEN_FRAMES; i++) {
        const w = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / UEBERBLENDEN_FRAMES);   // 0 → 1
        x[2 * i] = w * x[2 * i] + (1 - w) * f[2 * i];
        x[2 * i + 1] = w * x[2 * i + 1] + (1 - w) * f[2 * i + 1];
      }
      repariert = true;
    }
    o.bericht?.({ naht_vorher: vorher.verhaeltnis, naht_nachher: repariert ? nahtVon(x).verhaeltnis : vorher.verhaeltnis, naht_lokal_vorher: lokalVorher.verhaeltnis, naht_lokal_nachher: repariert ? nahtLokal(x).verhaeltnis : lokalVorher.verhaeltnis, repariert, gedehnt: fortsetzung !== null });
    const neu = path.join(arbeit, 'neu');
    fs.mkdirSync(neu);
    fs.writeFileSync(path.join(neu, 'loop.f32'), buf);
    const j = new Date(), z = (n: number): string => String(n).padStart(2, '0');
    fs.writeFileSync(path.join(neu, 'loop.json'), JSON.stringify({ schema: 1, name: o.name, beats: o.beats, bpm: 128, frames, datei: 'loop.f32',
      quelle: 'mediathek', erstellt: `${j.getFullYear()}-${z(j.getMonth() + 1)}-${z(j.getDate())} ${z(j.getHours())}:${z(j.getMinutes())}`, herkunft: o.herkunft }));
    try { fs.renameSync(neu, path.join(o.dir, o.name)); }
    catch (e) { if (['EEXIST', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code ?? '')) throw new LoopImportFehler(409, 'name_vergeben'); throw e; }
    return o.name;
  } finally {
    if (arbeit) fs.rmSync(arbeit, { recursive: true, force: true });
    laeuft = false;
  }
}
