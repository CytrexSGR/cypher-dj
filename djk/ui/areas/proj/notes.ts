// Note editor (slice 1, task B2): the area proj-noten. POST /proj/noten/erkennen checks, starts ONE detection run (child processes through NotenLauf)
// and answers at once {auftrag_id}; the progress goes out as SSE {a:'proj', f:{noten}} and as the field `noten` of GET /proj/aktuell. The end is one
// project change (aendereStand + uebernimm, one undo step, label "Detect notes <name>") or a message abgebrochen | veraltet | fehler with a reason.
// The curve of a source is kept in sidecar files `<arbeitsordner>/noten/<sha>.<curve id>.json` (contract djk/contract/notes.md), so a second detection
// of the same source, a render and the page's curve view all read the same file. Own detector first (`cypherdj-noten analyse`, then `pruefe`); the
// network path (werkstatt.noten_netz) only when its runtime answers and the own curve is not bass below 60 Hz (P5, netzPasst). The folder of a run is
// `<arbeitsordner>/noten-<id>/`; the area removes it. Pattern: stems.ts.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { spawn as echtSpawn } from 'node:child_process';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { grundText } from '../../http/reasons.ts';
import { aendereStand } from '../../project/state.ts';
import { herkunft, sucheClip, type AudioClip } from '../../project/model.ts';
import {
  DETEKTOR_VERSION, NOTEN_HOP, NOTEN_SR, SEGMENTIERER_VERSION, kurveDatei, kurvePasstZurQuelle, kurvePruefung, rohPruefung, zeilePruefung,
  type NotenKurve, type NotenKurveRoh,
} from '../../project/notes_contract.ts';
import { NotenAudioFehler, baueNotenFeld, baueNotenProjekt, fertigHinweis, netzPasst, notenNochGleich, notenZeitlimitMs,
  type NotenPlan } from '../../project/notes_audio.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from './area.ts';
import { ProjFehler, type Antwort } from './session.ts';
import { NotenLauf, type NotenErgebnis, type NotenFortschrittZeile } from './notes_run.ts';
import type { RenderZustand } from './notes_render.ts';

export interface NotenOptionen {
  programm: string;                      // cypherdj-noten (one file: the stand-in of a test is an executable script)
  netz: string[] | null;                 // the network module as a command, e.g. [python, '-m', 'werkstatt.notes_net']; null = no network path
  cwd: string;
  zeitlimitMs?: number;                  // default notenZeitlimitMs(frames)
  killMs?: number;                       // SIGTERM to SIGKILL, default 2000
  stemsLaeuft?: () => boolean;           // the heavy stem job; a run refuses to start while it runs (stems_laeuft)
  env?: Record<string, string | undefined>;   // extra environment of the children (a test steers its stand-ins with it)
  cpus?: string;                         // CPU mask instead of CYPHERDJ_STEMS_CPUS (test)
  spawn?: typeof echtSpawn;              // test: look at the command line instead of running it
  render?: { zustand(clipId: string): RenderZustand };   // B4: the render service; the GET field `render` is its state of the clip (null without it)
}
type Zustand = 'laeuft' | 'fertig' | 'abgebrochen' | 'veraltet' | 'fehler';
type Offen = NonNullable<ReturnType<ProjZugang['offen']>>;
interface Lauf { id: number; slug: string; quelle: 'andreas' | 'cypher'; plan: NotenPlan; tmp: string; quellDatei: string;
  prozess: NotenLauf | null; abgebrochen: 'abbruch' | 'noten_zeitlimit' | null; rechnet: boolean; gespeichert: boolean; prozent: number; frist: NodeJS.Timeout }

const FELDER = ['clip_id', 'neu'];
const NETZ_PRUEFEN_MS = 30_000;          // the runtime check imports onnxruntime; longer than this counts as missing
export const CURVE_ID = `${DETEKTOR_VERSION}.${SEGMENTIERER_VERSION}`;
class Abbruch extends Error {}

// What a run may leave behind in the working folder of a crashed server: child processes (any whose command line holds a path under
// <arbeitsordner>/noten-<n>/ get SIGKILL) and the folders noten-<n>. The sidecars in noten/ stay: they are the cache.
export function raeumeNotenReste(arbeitsordner: string, log: (z: Record<string, unknown>) => void = () => {}, proc = '/proc'): { prozesse: number[];
  ordner: string[] } {
  const praefix = path.join(arbeitsordner, 'noten-');
  const prozesse: number[] = [];
  for (const d of fs.existsSync(proc) ? fs.readdirSync(proc) : []) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
    let arg: string[];
    try { arg = fs.readFileSync(path.join(proc, d, 'cmdline'), 'utf8').split('\0'); } catch { continue; }
    if (arg.some((a) => a.startsWith(praefix) && /^\d+\//.test(a.slice(praefix.length)))) {
      try { process.kill(Number(d), 'SIGKILL'); prozesse.push(Number(d)); } catch { /* already gone */ }
    }
  }
  const ordner = fs.existsSync(arbeitsordner) ? fs.readdirSync(arbeitsordner).filter((f) => /^noten-\d+$/.test(f)) : [];
  for (const f of ordner) fs.rmSync(path.join(arbeitsordner, f), { recursive: true, force: true });
  if (prozesse.length || ordner.length) log({ typ: 'noten_reste', prozesse, ordner });
  return { prozesse, ordner };
}

// A sidecar of this source with this curve id, checked against the contract; null when it is missing, unreadable, broken or of another source
export function leseKurve(pfad: string, sha: string, frames: number, id: string): NotenKurve | null {
  let x: unknown;
  try { x = JSON.parse(fs.readFileSync(pfad, 'utf8')); } catch { return null; }
  if (kurvePruefung(x) !== null) return null;
  const sd = x as NotenKurve;
  return sd.quelle === sha && sd.kurve === id && kurvePasstZurQuelle(sd, frames) === null ? sd : null;
}

export class NotenAnalyse {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly o: NotenOptionen;
  private lauf: Lauf | null = null;
  private naechste = 1;
  private netzVersion: string | null | undefined;     // undefined = not asked yet; null = no runtime (asked once per server life)
  private aktuellerStand: Record<string, unknown> | null = null;
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: NotenOptionen) {
    this.ctx = ctx; this.zugang = zugang; this.o = o;
    raeumeNotenReste(zugang.arbeitsordner(), ctx.log);
    // a run belongs to the project it was started in; closing or switching it stops the run while a child computes (later the fresh check says veraltet)
    zugang.beiSchliessen((slug) => { const l = this.lauf; if (l && l.rechnet && l.slug === slug) this.bricheAb(l, 'abbruch'); });
  }

  laeuft(): boolean { return this.lauf !== null; }
  private notenOrdner(): string { return path.join(this.zugang.arbeitsordner(), 'noten'); }

  starte(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Antwort {
    for (const k of Object.keys(d)) if (!FELDER.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    if (typeof d.clip_id !== 'string' || d.clip_id === '') throw new ProjFehler(400, 'argument_ungueltig', { text: 'clip_id: a clip id is required' });
    if (d.neu !== undefined && typeof d.neu !== 'boolean') throw new ProjFehler(400, 'argument_ungueltig', { text: 'neu: true or false expected' });
    const o = this.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    const g = sucheClip(o.projekt, d.clip_id);
    if (!g) throw new ProjFehler(404, 'clip_unbekannt', { clip_id: d.clip_id });
    if (g.clip.art !== 'audio') throw new ProjFehler(409, 'feld_nur_audio', { clip_id: d.clip_id });
    const clip: AudioClip = g.clip;
    const quellDatei = path.join(this.zugang.arbeitsordner(), 'audio', `${clip.quelle.sha256}.f32`);
    if (clip.dekodiert !== 'fertig' || !fs.existsSync(quellDatei)) throw new ProjFehler(409, 'audio_fehlt');
    if (this.lauf) throw new ProjFehler(409, 'noten_laeuft', { auftrag_id: this.lauf.id });
    if (this.o.stemsLaeuft?.()) throw new ProjFehler(409, 'stems_laeuft');
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    if (quelle === 'cypher' && herkunft(g.spur) === 'andreas') throw new ProjFehler(409, 'nur_andreas_spur',
      { text: 'this track belongs to Andreas; Cypher may not detect notes on it' });
    if (clip.audio_noten && clip.audio_noten.liste.length > 0 && d.neu !== true) throw new ProjFehler(409, 'noten_vorhanden', { clip_id: clip.id });
    if (this.o.programm.includes('/') && !fs.existsSync(this.o.programm)) throw new ProjFehler(503, 'noten_programm_fehlt');
    const frames = Math.floor(fs.statSync(quellDatei).size / 8);
    return this.beginne(o.slug, { clipId: clip.id, sha256: clip.quelle.sha256, frames, vorher: clip.audio_noten ? structuredClone(clip.audio_noten) : null,
      name: clip.name },
      quelle, quellDatei);
  }

  private beginne(slug: string, plan: NotenPlan, quelle: 'andreas' | 'cypher', quellDatei: string): Antwort {
    const id = this.naechste++;
    const tmp = path.join(this.zugang.arbeitsordner(), `noten-${id}`);
    fs.mkdirSync(tmp, { recursive: true });
    const l: Lauf = { id, slug, quelle, plan, tmp, quellDatei, prozess: null, abgebrochen: null, rechnet: true, gespeichert: false, prozent: 0,
      frist: setTimeout(() => { if (l.rechnet) this.bricheAb(l, 'noten_zeitlimit'); }, this.o.zeitlimitMs ?? notenZeitlimitMs(plan.frames)) };
    this.lauf = l;
    this.stand({ zustand: 'laeuft', stufe: null, prozent: 0 }, true, true);
    void this.beende(l);
    return { code: 200, j: { auftrag_id: id } };
  }

  private bricheAb(l: Lauf, grund: 'abbruch' | 'noten_zeitlimit'): void {
    l.abgebrochen ??= grund;                                                    // the first reason counts
    l.prozess?.abbrechen(this.o.killMs ?? 2000);                                // SIGTERM, SIGKILL after killMs
  }
  abbrechen(d: Record<string, unknown>): Antwort {
    const l = this.lauf;
    if (!l || l.id !== d.auftrag_id) throw new ProjFehler(404, 'kein_auftrag', { auftrag_id: d.auftrag_id ?? null,
      text: 'no note detection with this id is running' });
    // the result is already placed
    if (l.gespeichert) throw new ProjFehler(409, 'zu_spaet', { auftrag_id: l.id, text: 'the notes are already placed; use undo to remove them' });
    this.bricheAb(l, 'abbruch');
    return { code: 200, j: { auftrag_id: l.id, zustand: 'abbrechen' } };
  }

  // ---- state for /proj/aktuell and SSE ---------------------------------------------------------------------------------------------

  /** The last state of a run of this clip in the open project, for GET /proj/noten */
  standFuer(slug: string, clipId: string): Record<string, unknown> | null {
    const s = this.aktuellerStand;
    return s && s.slug === slug && s.clip_id === clipId ? s : null;
  }
  private stand(teil: Record<string, unknown>, sse: boolean, neu = false): void {
    const l = this.lauf;
    if (!l) return;
    const basis = neu ? { slug: l.slug, auftrag_id: l.id, clip_id: l.plan.clipId } : (this.aktuellerStand ?? {});
    this.aktuellerStand = { ...basis, ...teil };
    this.zugang.notenStand(this.aktuellerStand);
    if (sse) this.ctx.verteile({ a: 'proj', f: { noten: this.aktuellerStand } });
  }
  // The prozent of a child inside its band of the whole run (the child reports stufe k of n and prozent p of that stage)
  private melde(l: Lauf, f: NotenFortschrittZeile, band: [number, number]): void {
    const anteil = Math.min(1, Math.max(0, (f.stufe - 1 + (f.prozent ?? 0) / 100) / f.von));
    const prozent = Math.round(band[0] + (band[1] - band[0]) * anteil);
    if (prozent < l.prozent) return;
    l.prozent = prozent;
    this.stand({ stufe: f.name, prozent }, true);
  }
  private ruecke(l: Lauf, prozent: number): void {
    if (prozent <= l.prozent) return;
    l.prozent = prozent;
    this.stand({ prozent }, true);
  }
  // every literal with a grund carries its English text itself (tests/proj_reasons_text.test.mjs); grundText only as the fallback
  private endStand(l: Lauf, e: { zustand: Zustand; grund?: string; text?: string; detail?: string } & Record<string, unknown>): void {
    this.stand({ ...e, ...(e.grund && !e.text ? { text: grundText(e.grund) } : {}) }, true);
    clearTimeout(l.frist);
    this.lauf = null;
  }
  private abbruchStand(l: Lauf): void {
    if (l.abgebrochen === 'noten_zeitlimit') this.endStand(l, { zustand: 'abgebrochen', grund: 'noten_zeitlimit',
      text: 'the note detection took too long and was cancelled' });
    else this.endStand(l, { zustand: 'abgebrochen', grund: 'abbruch', text: 'the note detection was cancelled' });
  }

  // ---- the run -----------------------------------------------------------------------------------------------------------------------

  private async beende(l: Lauf): Promise<void> {
    try {
      const r = await this.rechne(l);
      l.rechnet = false;
      if (l.abgebrochen) { this.abbruchStand(l); return; }
      if (r.sd.mono?.mehrstimmig) {                                             // more than one note at a time: nothing is placed
        this.endStand(l, { zustand: 'fehler', grund: 'noten_mehrstimmig',
          text: 'More than one note at a time. Separate stems first, then detect notes on a stem.' });
        return;
      }
      const feld = baueNotenFeld(r.sd, l.plan.frames);                          // a note beyond the source ends the run with noten_fehler (catch below)
      const o = this.zugang.offen();                                            // fresh; no await from here to aendereStand
      const alt = this.hinfaellig(o, l);
      if (alt) { this.endStand(l, { zustand: 'veraltet', grund: 'veraltet', text: 'the clip changed while the notes were detected; nothing was placed' });
        return; }
      if (l.quelle === 'cypher' && this.ctx.kiGestoppt()) {                     // Stop Cypher at the end: discard
        this.endStand(l, { zustand: 'veraltet', grund: 'ki_gestoppt', text: 'Stop Cypher is set; the result was discarded' }); return;
      }
      const meta = { quelle: l.quelle, label: `Detect notes ${l.plan.name}`.slice(0, 200) };
      const w = aendereStand(o!.verlauf, o!.projekt, baueNotenProjekt(o!.projekt, l.plan.clipId, feld), meta, this.zugang.haken());
      l.gespeichert = true;
      if (w.eintrag !== null) await this.zugang.uebernimm(w, meta);
      this.endStand(l, { zustand: 'fertig', noten: feld.liste.length, detektor: r.sd.detektor, sekunden: Math.round(r.sekunden * 1000) / 1000,
        ...(fertigHinweis(r.sd.stimmhaft_anteil, feld.liste.length, r.netzFehler) ?? {}) });
    } catch (x) {
      l.rechnet = false;
      if (x instanceof Abbruch || l.abgebrochen) { this.abbruchStand(l); return; }
      const detail = (x as Error)?.message ?? String(x);
      this.ctx.log({ typ: 'noten_fehler', clip_id: l.plan.clipId, fehler: detail });
      this.endStand(l, l.gespeichert
        ? { zustand: 'fehler', grund: 'noten_fehler', text: 'the notes were saved, but loading them failed', detail }
        : { zustand: 'fehler', grund: 'noten_fehler', text: 'the note detection failed; nothing was changed', detail });
    } finally {
      fs.rmSync(l.tmp, { recursive: true, force: true });
    }
  }

  // null = the run may place its result; else the project is not the one it started in
  private hinfaellig(o: Offen | null, l: Lauf): 'veraltet' | null {
    if (!o || o.slug !== l.slug) return 'veraltet';
    return notenNochGleich(o.projekt, l.plan);
  }

  // One child: waits for it, throws Abbruch when the run was cancelled meanwhile (before it starts, too)
  private async kind(l: Lauf, befehl: string[], omp: number, band: [number, number]): Promise<NotenErgebnis> {
    if (l.abgebrochen) throw new Abbruch();
    const p = new NotenLauf(befehl, { cwd: this.o.cwd, omp, ...(this.o.env ? { env: this.o.env } : {}), ...(this.o.cpus !== undefined
      ? { cpus: this.o.cpus } : {}),
      ...(this.o.spawn ? { spawn: this.o.spawn } : {}) }, (f) => this.melde(l, f, band));
    l.prozess = p;
    const e = await p.fertig;
    l.prozess = null;
    if (l.abgebrochen) throw new Abbruch();
    return e;
  }
  // The result line of a finished command, checked against the contract; returns its CPU seconds
  private zeile(e: NotenErgebnis, was: string): number {
    const z = e.zeile;
    if (e.rc === 0 && z && z.status === 'ok' && zeilePruefung(z) === null) return typeof z.sekunden === 'number' ? z.sekunden : 0;
    const grund = z?.status === 'fehler' ? `${String(z.fehler)}: ${String(z.text)}` : (e.signal ?? (e.rc === null
      ? e.fehl : `no valid result line, exit ${e.rc}`));
    throw new NotenAudioFehler(`${was} failed (${grund})`);
  }
  // The file a command wrote, read and checked: the curve of this source with this id
  private ausgabe(pfad: string, l: Lauf, id: string, was: string, mitMono: boolean): NotenKurve {
    const sd = leseKurve(pfad, l.plan.sha256, l.plan.frames, id);
    if (!sd) throw new NotenAudioFehler(`${was} wrote no valid curve ${id} for this source`);
    if (mitMono && !sd.mono) throw new NotenAudioFehler(`${was} wrote a curve without the monophonic check`);
    return sd;
  }
  // `pruefe` on a sidecar (in place: the program writes <file>.tmp and renames it)
  private async pruefe(l: Lauf, pfad: string, id: string, band: [number, number]): Promise<{ sd: NotenKurve; sekunden: number }> {
    const e = await this.kind(l, [this.o.programm, 'pruefe', l.quellDatei, pfad], 1, band);
    const sekunden = this.zeile(e, 'the monophonic check');
    return { sd: this.ausgabe(pfad, l, id, 'the monophonic check', true), sekunden };
  }
  private nimmInsOrdner(von: string, nach: string): void {
    fs.mkdirSync(path.dirname(nach), { recursive: true });
    fs.renameSync(von, nach);
  }

  private async rechne(l: Lauf): Promise<{ sd: NotenKurve; sekunden: number; netzFehler: boolean }> {
    const prog = this.o.programm;
    let sekunden = 0;
    // 1. the own curve: reused when it is there and checked, else analysed and checked in the folder of the run, then moved into noten/
    const eigenPfad = path.join(this.notenOrdner(), kurveDatei(l.plan.sha256, CURVE_ID));
    let eigen = leseKurve(eigenPfad, l.plan.sha256, l.plan.frames, CURVE_ID);
    if (!eigen) {
      const tmp = path.join(l.tmp, 'eigen.json');
      sekunden += this.zeile(await this.kind(l, [prog, 'analyse', l.quellDatei, tmp], 1, [0, 40]), 'the analysis');
      this.ausgabe(tmp, l, CURVE_ID, 'the analysis', false);
      const p = await this.pruefe(l, tmp, CURVE_ID, [40, 50]);
      sekunden += p.sekunden;
      this.nimmInsOrdner(tmp, eigenPfad);
      eigen = p.sd;
    } else if (!eigen.mono) {
      const p = await this.pruefe(l, eigenPfad, CURVE_ID, [0, 50]);
      sekunden += p.sekunden; eigen = p.sd;
    }
    this.ruecke(l, 50);
    // 2. the network path: only for a voice-range curve (P5), only when the runtime answered; any failure here falls back to the own curve
    let sd = eigen, netzFehler = false;
    if (this.o.netz && (this.o.env?.CYPHERDJ_NOTEN_NETZ ?? process.env.CYPHERDJ_NOTEN_NETZ) !== 'aus' && netzPasst(eigen)) {
      try {
        const version = await this.netzLaeuft(l);
        if (version) { const n = await this.netzKurve(l, version); sd = n.sd; sekunden += n.sekunden; }
      } catch (x) {
        if (x instanceof Abbruch || l.abgebrochen) throw x;
        this.ctx.log({ typ: 'noten_netz_fehler', clip_id: l.plan.clipId, fehler: (x as Error)?.message ?? String(x) });
        netzFehler = true; sd = eigen;
      }
    }
    this.ruecke(l, 100);
    return { sd, sekunden, netzFehler };
  }

  // `<netz> --pruefen` once per server life: the version string (netz-<n>) or null when there is no runtime. An aborted check is not remembered.
  private async netzLaeuft(l: Lauf): Promise<string | null> {
    if (this.netzVersion !== undefined) return this.netzVersion;
    if (l.abgebrochen) throw new Abbruch();
    const p = new NotenLauf([...this.o.netz!, '--pruefen'], { cwd: this.o.cwd, omp: 2, ...(this.o.env ? { env: this.o.env } : {}),
      ...(this.o.cpus !== undefined ? { cpus: this.o.cpus } : {}), ...(this.o.spawn ? { spawn: this.o.spawn } : {}) }, () => {});
    l.prozess = p;
    const zu = setTimeout(() => p.abbrechen(this.o.killMs ?? 2000), NETZ_PRUEFEN_MS);
    const e = await p.fertig;
    clearTimeout(zu);
    l.prozess = null;
    if (l.abgebrochen) throw new Abbruch();
    const z = e.zeile;
    this.netzVersion = e.rc === 0 && z && z.status === 'ok' && z.netz === true && typeof z.version === 'string' && /^netz-[0-9]+$/.test(z.version)
      ? z.version : null;
    return this.netzVersion;
  }

  // The sidecar of the network curve: reused when there, else raw curve, cut into notes, checked, moved into noten/
  private async netzKurve(l: Lauf, version: string): Promise<{ sd: NotenKurve; sekunden: number }> {
    const prog = this.o.programm;
    const id = `${version}.${SEGMENTIERER_VERSION}`;
    const pfad = path.join(this.notenOrdner(), kurveDatei(l.plan.sha256, id));
    const da = leseKurve(pfad, l.plan.sha256, l.plan.frames, id);
    if (da?.mono) return { sd: da, sekunden: 0 };
    if (da) return this.pruefe(l, pfad, id, [90, 100]);
    let sekunden = 0;
    const roh = path.join(l.tmp, 'roh.json');
    const n = await this.kind(l, [...this.o.netz!, '--quelle', l.quellDatei, '--aus', roh], 2, [50, 80]);
    if (n.rc !== 0 || n.zeile?.status !== 'ok')
      throw new NotenAudioFehler(`the network detector failed (${String(n.zeile?.grund ?? n.signal ?? `exit ${n.rc}`)})`);
    let r: unknown;
    try { r = JSON.parse(fs.readFileSync(roh, 'utf8')); } catch { throw new NotenAudioFehler('the network detector wrote no readable curve'); }
    const bef = rohPruefung(r);
    if (bef) throw new NotenAudioFehler(`the network curve is invalid: ${bef.text}`);
    if ((r as NotenKurveRoh).frames !== l.plan.frames) throw new NotenAudioFehler('the network curve is for another length of source');
    const tmp = path.join(l.tmp, 'netz.json');
    sekunden += this.zeile(await this.kind(l, [prog, 'segment', l.quellDatei, roh, tmp], 1, [80, 90]), 'the segmentation');
    this.ausgabe(tmp, l, id, 'the segmentation', false);
    const p = await this.pruefe(l, tmp, id, [90, 100]);
    this.nimmInsOrdner(tmp, pfad);
    return { sd: p.sd, sekunden: sekunden + p.sekunden };
  }

  schliesse(): void {
    const l = this.lauf;
    if (!l) return;
    l.abgebrochen ??= 'abbruch';                                                // beende() reports abgebrochen and removes the folder
    l.prozess?.toete();                                                         // server stop: SIGKILL at once, no orphan
    clearTimeout(l.frist);
  }
}

// ---- the area ------------------------------------------------------------------------------------------------------------------------

export function notenBereich(ctx: BereichKontext, zugang: ProjZugang, o: NotenOptionen): Bereich & { analyse: NotenAnalyse } {
  const an = new NotenAnalyse(ctx, zugang, o);
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  // the audio clip a GET asks about, or the refusal
  const audioClip = (url: URL): { o: Offen; clip: AudioClip } => {
    const id = url.searchParams.get('clip_id') ?? '';
    if (id === '') throw new ProjFehler(400, 'argument_ungueltig', { text: 'clip_id: a clip id is required' });
    const offen = zugang.offen();
    if (!offen) throw new ProjFehler(409, 'kein_projekt');
    const g = sucheClip(offen.projekt, id);
    if (!g) throw new ProjFehler(404, 'clip_unbekannt', { clip_id: id });
    if (g.clip.art !== 'audio') throw new ProjFehler(409, 'feld_nur_audio', { clip_id: id });
    return { o: offen, clip: g.clip };
  };
  // the sidecar of the curve the clip's field points at (null: no field, or the file is gone or broken)
  const kurveDes = (clip: AudioClip): NotenKurve | null => {
    const f = clip.audio_noten;
    if (!f) return null;
    const frames = (() => { try { return Math.floor(fs.statSync(path.join(zugang.arbeitsordner(), 'audio', `${clip.quelle.sha256}.f32`)).size / 8);
      } catch { return -1; } })();
    const pfad = path.join(zugang.arbeitsordner(), 'noten', kurveDatei(clip.quelle.sha256, f.kurve));
    if (frames >= 0) return leseKurve(pfad, clip.quelle.sha256, frames, f.kurve);
    // the decoded source is gone: the sidecar alone is still a curve of this source
    let x: unknown;
    try { x = JSON.parse(fs.readFileSync(pfad, 'utf8')); } catch { return null; }
    return kurvePruefung(x) === null && (x as NotenKurve).quelle === clip.quelle.sha256 ? (x as NotenKurve) : null;
  };
  const routen = (): Route[] => [
    { methode: 'POST', pfad: '/proj/noten/erkennen', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                               // before the await (pattern stems.ts)
      await antworte(r, async () => an.starte(await leseKoerper(q), quelle));
    } },
    { methode: 'POST', pfad: '/proj/noten/abbrechen', schutz: 'fremdePost', handler: async (q, r) => {
      await antworte(r, async () => an.abbrechen(await leseKoerper(q)));
    } },
    { methode: 'GET', pfad: '/proj/noten', schutz: 'offen', handler: (_q, r, url) => antworte(r, () => {
      const { o: offen, clip } = audioClip(url);
      const sd = kurveDes(clip);
      return { code: 200, j: { clip_id: clip.id, quelle_sha: clip.quelle.sha256,
        kurve: sd ? { id: sd.kurve, detektor: sd.detektor, stimmhaft_anteil: sd.stimmhaft_anteil, mono: sd.mono ?? null } : null,
        noten: clip.audio_noten ? clip.audio_noten.liste : null, analyse: an.standFuer(offen.slug, clip.id), render: o.render
          ? o.render.zustand(clip.id) : null } };
    }) },
    { methode: 'GET', pfad: '/proj/noten/kurve', schutz: 'offen', handler: (_q, r, url) => antworte(r, () => {
      const { o: offen, clip } = audioClip(url);
      const sd = kurveDes(clip);
      if (!sd) throw new ProjFehler(404, 'noten_unbekannt', { clip_id: clip.id });
      return { code: 200, j: { kurve: sd.kurve, hop_s: NOTEN_HOP / NOTEN_SR, ct: sd.f0_ct.map((v) => Math.round(v * 10) / 10) } };
    }) },
  ];
  return { name: 'proj-noten', analyse: an, routen };
}
