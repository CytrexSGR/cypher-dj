// Das offene Projekt des Seiten-Servers (Spec D1 2.1, 3.4): Projektordner, Verlauf, Wiedergabe-Nummer, Abgleich mit dem Kern.
// Die schreibenden Wege der Sitzung laufen nacheinander in einer Kette (seriell). Eine Ausnahme gibt es: uebernimm() (S3, Freeze und
// Export) setzt den Stand synchron, bevor es sich in die Kette stellt, also auch während ein Befehl in der Kette auf Regler-Quittungen
// wartet. Ein Befehl sieht darum nach einem await nicht sicher den Stand, gegen den er geprüft wurde; vollziehe prüft die rev nach dem
// Warten noch einmal (Spec 6.30, 409 rev_veraltet). Der Kern wird nur über KernWeg angesprochen (BereichKontext), Kern-Ereignisse kommen über ereignis().
// Reihenfolge einer Änderung: prüfen (rev, KI-Stopp, Katalog, Freeze-Sperre) → Probe rechnen → Regler setzen und Quittungen abwarten → rev noch
// einmal prüfen (409 rev_veraltet) → echte Ablehnung des Kerns: zurückdrehen, 409 regler_abgelehnt, nichts gespeichert (Quittung null heißt kein Kern:
// angenommen, kern.regler kein_kern) → Wiedergabe schreiben, wenn nötig (Freeze-Sperre erneut geprüft), dann EINMAL speichern und ins Log → laden,
// Loop, Metronom, Tempo nachziehen → SSE proj. Der Rückweg der Hand speichert zusammengefasst (höchstens alle 250 ms, ein Eintrag je Geste).
// Stand Slice 6 (S2-Integration): vollständig. Dazu Transport, Tempo-Regel, Rückweg der Hand, KI-Stopp, KI-Maske (immer spur/0) und der Neustart des Kerns.
import fs from 'node:fs';
import path from 'node:path';
import type { BereichKontext } from '../../http/router.ts';
import { Katalog, type Zeile } from '../../katalog.ts';
import { Projekte, projektWurzelVorgabe } from '../../projekt/ablage.ts';
import { alleAudioClips, fuehreListeAus, laneStart, setzeDekodiert, vergleiche, type PresetInhalt } from '../../projekt/befehle.ts';
import { findeGraph } from '../../graphen.ts';
import { kitDa } from './kits.ts';
import { SurgeSpiegel, surgeBereich } from './surge.ts';
import { surgeParameterVon } from '../../projekt/richtung.ts';
import { TransientenLager } from '../../projekt/transienten.ts';
import { DekodierCache, type DekodierEreignis } from '../../projekt/dekodier.ts';
import {
  HALL_FELDER, MAX_BEAT, kanonisch, sucheClip, sucheSpur, wertImBereich,
  type AudioClip, type Clip, type DekodiertZustand, type Lane, type Projekt, type Spur, type Warp, type Ziel,
} from '../../projekt/modell.ts';
import { laneWert } from '../../projekt/lane.ts';
import { HK_ZIELE, hkWert, type Huellkurve } from '../../projekt/huellkurve.ts';
import { PatchFehler, wende } from '../../projekt/patch.ts';
import {
  WarpFehler, abHierStart, autoWarp, beatBeiQuelle, fensterTempo, handWarp, quantisiere, quellSekunde, segmentBpm, type TempoQuelle,
} from '../../projekt/warp.ts';
import { aendere, rueckgaengig, wiederholen, type Haken, type Meta, type Verlauf, type Wirkung } from '../../projekt/verlauf.ts';
import { WiedergabeFehler, WiedergabeZaehler, schreibeWiedergabe, uebersetze, wiedergabeDatei, type Wiedergabe } from '../../projekt/wiedergabe.ts';
import { ERZ4_NUR_HAND, alleRegler, erz4Soll, istMixerRegler, reglerZuBefehl, type Soll } from './abbildung.ts';
import { arrOrdner, zaehlerDateiVorgabe } from './konfig.ts';
import { grundText } from '../../http/gruende.ts';
import { KernLage } from './lage.ts';
import { leseKarte, leseTraktor, schreibeEinsKorrektur } from './quellen.ts';
import { AnalyseListe, type AnalyseEintrag, type AnalyseEnde, type AnalyseStarter, type Anforderung, type Wunsch } from './analyse.ts';
import { ankunftBefehle, brauchtAnalyse, klingtGerade } from '../../projekt/warp_analyse.ts';
import { analyseVorgabe } from '../../pfade.ts';
import {
  KernWeg, KERN_AUTO_ZIELE, autoAblehnung, istKernAutoZiel, quittungAbgelehnt, quittungOk, type Quelle, type Quittung,
  type ReglerErgebnis } from './kern_weg.ts';
import { ProjBk } from './baukasten.ts';   // S17: sound snapshot
import { GESTE_RUHE_MS } from './zeiten.ts';
// 1.12 slice 3 (task 8): takes into lanes
import { AUFNAHME_ZIELE, AutoAufnahme, modusVon, type AufnahmeZiel, type AutoOptionen, type Modus } from './aufnahme_auto.ts';
import { bkDefVonId } from '../../projekt/baukasten.ts';

export class ProjFehler extends Error {
  readonly code: number;
  readonly fehler: string;
  readonly extra: Record<string, unknown>;
  constructor(code: number, fehler: string, extra: Record<string, unknown> = {}) { super(fehler); this.code = code; this.fehler = fehler; this.extra = extra; }
  get grund(): string { return this.fehler; }   // wie BefehlFehler.grund (S3 liest den Grund so)
}
export interface Antwort { code: number; j: unknown }
export interface ProjOptionen {
  instanz?: string;            // Vorgabe CYPHERDJ_INSTANZ
  wurzel?: string;             // Projektordner-Wurzel (Vorgabe projektWurzelVorgabe(instanz))
  arbeitsordner?: string;      // Arbeitsordner der Wiedergaben (Vorgabe: kern.toml arr_ordner, sonst ~/.cache/cypherdj[-<i>]/arr)
  zaehlerDatei?: string;       // Spec 6.30, 6.31: Zustandsdatei des Wiedergabe-Zählers ausserhalb des Arbeitsordners. Vorgabe: mit ausdrücklichem
                               // arbeitsordner `<arbeitsordner>.zaehler` (je Ordner eine, Test-Server teilen nie eine Datei), sonst
                               // ~/.local/state/cypherdj[-<i>]/wiedergabe-zaehler
  katalog?: string;            // katalog.sqlite (Audio-Quellen nur über den Katalog, Spec 2.11)
  wirtOrdner?: () => string;   // 1.9 (L10): folder of the host status files (wirt-arr<s>.json); proj_lage shows them as `wirte` (server.ts passes its own)
  analyse?: string | null;      // Slice 3a: Analyse-Ablage (Karten); null = aus; Vorgabe nur im Betrieb (pfade.ts analyseVorgabe)
  mediathek?: string | null;    // Slice 3a: mediathek.sqlite, daraus die Traktor-Raster (Tabelle marke); null/fehlt = keine
  bestand?: string | null;      // Slice 3b: Bestand des Decks (bestand/<sha[:16]>/): Eins-Korrekturen lesen, Set 1.1.1 Here zurückschreiben; null = aus
  analysierer?: AnalyseStarter | null;   // Slice 3a: startet die Analyse auf Abruf (server.ts: WerkstattAnalyse); fehlt oder null = keine Aufträge
  analyseWarteMs?: number;   // Slice 3a: Abstand der Wiederholung der Ankunft, solange ein Freeze die Wiedergabe sperrt oder der Clip klingt (Vorgabe 2000)
  ffmpeg?: string[]; ffprobe?: string[]; vorsatz?: string[];   // Dekodier-Cache (Tests)
  kernWeg?: { paket?: number; bisEnde?: boolean };   // test seam (slice 3): packet size and end-status waiting of the controls on open
  arrFristMs?: number;         // P2: so lange wartet oeffne auf /zustand/arr, wenn der Server den Kern-Stand noch nicht kennt (Vorgabe 600 ms)
  rampeWarteMs?: number;       // höchstens so lange wartet ein Transport-Start auf das Ende der Tempo-Rampe (Vorgabe 20 s)
  bkFristMs?: number;          // S17: cap of the sound snapshot restore on open and after a kern restart (default 5000 ms)
  autoAufnahme?: AutoOptionen;   // 1.12 slice 3 test seam: gesture rest, mouse safety net, grace after a stop
  // 1.9 (O28): reads a preset by id for preset_anwenden (server.ts passes the preset store); absent = the command refuses
  presetLies?: (id: string) => PresetInhalt | null;
  uhrStillMs?: number;         // Spec 6.30: läuft /uhr so lange nicht weiter, bricht das Warten auf die Rampe ab (503 kein_kern, Vorgabe 1 s)
}
// merk (Spec 6.30, 6.31): was die Freeze-Sperre aufgeschoben hat und nach der letzten Freigabe nachgeholt wird. Es gehört zum offenen Projekt und
// verfällt mit ihm: ein anderes Projekt lädt beim Öffnen ohnehin seine eigene Wiedergabe.
interface Merk { laden: boolean; loop: boolean; tempo: boolean }
// Spec 6.34: was GET /proj/aktuell als ausgabe_lauf zeigt, solange S3 einen Freeze oder Export fährt (Spur nur beim Freeze)
export type AusgabeLauf = { art: 'freeze'; spur_id: string } | { art: 'export' } | { art: 'lautheit' } | { art: 'merge' }
  | { art: 'bounce' };   // 1.14 slice 4 (spec R11)
// vorhoeren (1.14 comping, spec R8): spur_id -> take_id of the audition. Session state: never saved, never undoable, gone with the open project.
interface Offen { slug: string; projekt: Projekt; verlauf: Verlauf; merk: Merk; vorhoeren: Map<string, string> }
type Koerper = Record<string, unknown>;
interface Hinweis { index: number; hinweis: string }                // Paket 1.13: z. B. kein_tempo (Auto-Warp fand kein Tempo)

const schlaf = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
// Baukasten S20: lookup of a graph in the graph folder for the commands that set a bk device (null = no such graph)
const graphArt = (name: string): 'instrument' | 'effekt' | null => findeGraph(name)?.art ?? null;
const MARKER_TOLERANZ_S = 0.05;   // Rundung zwischen Katalog-Dauer und Dekodierung
// Flache Kopie für proj_lage: MIDI-Clips tragen noten_zahl statt noten, alles andere wird geteilt (nur lesen, nicht verändern)
// Paket 1.13: ein Audio-Clip zeigt seinen Warp ohne Marker-Liste (marker_zahl; die Marker liest proj_warp)
const warpKurz = (w: Warp): unknown => {
  const { marker, ...rest } = w;
  return { ...rest, eins_unsicher: w.eins_unsicher === true, marker_zahl: marker.length };   // Slice 3a: eins_unsicher ist ein festes Feld (auch false)
};
// Automation Slice 1: a track shows its lanes without points (lanes [{id, ziel, punkte_zahl, gesperrt?}], proj_auto reads the points);
// without a lane the shape stays as before
// 1.12 slice 3 (task 4): ueber(spur id, ziel) marks a lane the hand overrides (`uebersteuert: true`, absent otherwise)
type UeberFrage = (spurId: string, ziel: string) => boolean;
const ohneLanePunkte = (s: Spur, ueber?: UeberFrage): Omit<Spur, 'automation'> & { lanes?: unknown } => {
  const { automation, ...rest } = s;
  return automation?.length
    ? { ...rest, lanes: automation.map((l) => ({ id: l.id, ziel: l.ziel, punkte_zahl: l.punkte.length, ...(l.gesperrt ? { gesperrt: true } : {}),
      ...(ueber?.(s.id, l.ziel) ? { uebersteuert: true } : {}) })) }
    : rest;
};
// S17: the sound snapshot shows only {kanal, graph} (the values come with proj_bk lage)
const bkKurz = (p: Projekt): Record<string, unknown> => (p.baukasten
  ? { baukasten: p.baukasten.map((e) => ({ kanal: bkDefVonId(e.id)?.kanal ?? e.id, graph: e.graph })) } : {});
// 1.14: take lanes are reported as a count per track (takes_zahl), not as whole lanes
const ohneTakes = <T extends { takes?: unknown[] }>(s: T): Omit<T, 'takes'> & { takes_zahl?: number } => {
  const { takes, ...rest } = s;
  return takes ? { ...rest, takes_zahl: takes.length } : rest;
};
// 1.12 slice 5 (U11): a clip lists its envelopes without points (huellkurven [{ziel, punkte_zahl, verknuepft?, loop_beats?}]); proj_auto clip_id reads them
export const hkKurz = <T extends { huellkurven?: Huellkurve[] }>(c: T): Omit<T, 'huellkurven'> & { huellkurven?: unknown[] } => {
  const { huellkurven, ...rest } = c;
  return huellkurven?.length
    ? { ...rest, huellkurven: huellkurven.map((h) => ({ ziel: h.ziel, punkte_zahl: h.punkte.length,
      ...(h.verknuepft === false ? { verknuepft: false } : {}), ...(h.loop_beats !== undefined ? { loop_beats: h.loop_beats } : {}) })) }
    : rest;
};
const ohneNoten = (p: Projekt, ueber?: UeberFrage): unknown => ({ ...p, ...bkKurz(p), spuren: p.spuren.map((s) => ({
  ...ohneTakes(ohneLanePunkte(s, ueber)), clips: s.clips.map((c) => {
  if (c.art === 'audio') return c.warp ? { ...hkKurz(c), warp: warpKurz(c.warp) } : hkKurz(c);
  const { noten, ...rest } = hkKurz(c);
  return { ...rest, noten_zahl: noten.length };
}) })) });
// Slice 1 (proj_auto): default number of points per answer; 200 points are about 8 KB in Cypher's context
export const AUTO_PUNKTE_VORGABE = 200;
function laneAnsicht(spurId: string, l: Lane, von: number | null, bis: number | null, bei: number | null, max: number): Record<string, unknown> {
  const passend = l.punkte.filter((q) => (von === null || q.beat >= von) && (bis === null || q.beat <= bis));
  const gezeigt = passend.slice(0, max).map((q) => ({ beat: q.beat, wert: q.wert, form: q.form ?? 'linear' }));
  return { lane_id: l.id, spur_id: spurId, ziel: l.ziel, punkte_zahl: l.punkte.length, ...(l.gesperrt ? { gesperrt: true } : {}),
    punkte_gezeigt: gezeigt.length, punkte: gezeigt,
    ...(passend.length > max ? { weiter_ab_beat: passend[max].beat } : {}),
    ...(bei === null ? {} : { bei: { beat: bei, wert: laneWert(l.punkte, bei, l.ziel) } }) };
}
// 1.12 slice 5 (U11): one clip envelope as proj_auto shows it. Beats are CLIP beats (from the clip start); bei is hkWert, the value the core plays
// (a linked envelope repeats with the clip's loop_beats, an unlinked one with its own).
function huellkurveAnsicht(clipId: string, spurId: string, c: Clip, h: Huellkurve, von: number | null, bis: number | null, bei: number | null,
  max: number): Record<string, unknown> {
  const passend = h.punkte.filter((q) => (von === null || q.beat >= von) && (bis === null || q.beat <= bis));
  const gezeigt = passend.slice(0, max).map((q) => ({ beat: q.beat, wert: q.wert, form: q.form ?? 'linear' }));
  return { clip_id: clipId, spur_id: spurId, ziel: h.ziel, verknuepft: h.verknuepft !== false,
    ...(h.loop_beats !== undefined ? { loop_beats: h.loop_beats } : {}), punkte_zahl: h.punkte.length, punkte_gezeigt: gezeigt.length, punkte: gezeigt,
    ...(passend.length > max ? { weiter_ab_beat: passend[max].beat } : {}),
    ...(bei === null ? {} : { bei: { beat: bei, wert: hkWert(h, bei, c.loop_beats) } }) };
}
// Spec 6.30, 6.31: wie in vollziehe ist nur eine echte Ablehnung des Kerns ein Regler-Fehler; Quittung null heißt kein Kern (keine Antwort bis
// zur Frist), das Projekt bleibt die Wahrheit. Für Antworten und Protokoll getrennt gezählt.
const reglerBefund = (e: ReglerErgebnis[]): { regler_fehler: ReglerErgebnis[]; regler_ohne_kern: number } =>
  ({ regler_fehler: e.filter((r) => quittungAbgelehnt(r.quittung)), regler_ohne_kern: e.filter((r) => r.quittung === null).length });
export const RUECKWEG_MS = 250;     // Spec 6.30: höchstens eine Speicherung des Rückwegs je 250 ms
export { GESTE_RUHE_MS };   // Spec 6.30: so lange Ruhe schließt eine Geste (ein Verlaufseintrag je Geste); the value lives in zeiten.ts

// Gegenprobe W(bei_beat) des Werkzeugs proj_warp: die Quellsekunde, die bei diesem Projekt-Beat wirklich klingt. Maßgeblich ist, was der Übersetzer
// spielt (wiedergabe.ts audioKopien/warpMarker): jede Loop-Kopie beginnt bei versatz_beats von vorn (Clip-Beat c, Kopie k = ⌊c/loop⌋, Beat in der
// Kopie c − k·loop). Klingt dort nichts aus dem Warp, ist quell_s null und warum sagt es: ausserhalb (vor dem Clip oder ab seinem Ende,
// halboffen) oder warp_aus (an false: der Clip spielt ungewarpt über offset_s).
function gegenprobe(c: AudioClip, bei: number): { projekt_beat: number; quell_s: number | null; warum?: 'ausserhalb' | 'warp_aus' } {
  const w = c.warp!, rel = bei - c.start_beat;
  if (rel < 0 || rel >= c.laenge_beats - 1e-9) return { projekt_beat: bei, quell_s: null, warum: 'ausserhalb' };
  if (!w.an) return { projekt_beat: bei, quell_s: null, warum: 'warp_aus' };
  const loop = c.loop_beats ?? null;
  const lokal = loop === null ? rel : Math.max(0, rel - Math.floor(rel / loop + 1e-9) * loop);
  return { projekt_beat: bei, quell_s: quellSekunde(w.marker, w.versatz_beats + lokal) };
}

// Slice 3a (T13): Vorgabe des Werkzeugs proj_warp. 200 Marker · 86 Byte = 17 KB; die ganze Liste einer Karte (bis 4096) wären 359 KB in Cyphers Kontext.
export const MARKER_VORGABE = 200;
export const TRANSIENTEN_VORGABE = 4096;   // Slice 4: transienten_max, höchstens TRANSIENTEN_MAX
export const TRANSIENTEN_MAX = 32768;
const rund2 = (x: number): number => Math.round(x * 100) / 100;
function tempoUebersicht(m: readonly (readonly [number, number])[]): { mittel_bpm: number; min_bpm: number; max_bpm: number } {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i + 1 < m.length; i++) { const b = segmentBpm(m, i); if (b < min) min = b; if (b > max) max = b; }
  return { mittel_bpm: rund2(60 * (m[m.length - 1][1] - m[0][1]) / (m[m.length - 1][0] - m[0][0])), min_bpm: rund2(min), max_bpm: rund2(max) };
}

export class ProjSitzung {
  readonly lage = new KernLage();
  readonly arbeitsordner: string;
  private readonly transientenLager: TransientenLager;     // Slice 4: Transienten je Quelle (Quellsekunden), für BEATS und proj_warp
  private readonly transienten = (sha: string): number[] | null => this.transientenLager.fuer(sha);
  private readonly ctx: BereichKontext;
  private readonly kern: KernWeg;
  private readonly bk: ProjBk;   // S17
  private readonly projekte: Projekte;
  private readonly cache: DekodierCache;
  private readonly zaehler: WiedergabeZaehler;
  private readonly katalog: Katalog | null;
  private readonly analyse: string | null;
  private readonly mediathekPfad: string | null;
  private readonly bestand: string | null;
  private readonly analysen: AnalyseListe | null;
  private readonly analyseWarteMs: number;
  private readonly analyseGescheitert = new Set<string>();   // D1: shas, deren Analyse scheiterte oder keine Karte brachte (bis zum Neustart)
  private readonly arrFristMs: number;
  private readonly rampeWarteMs: number;
  private readonly uhrStillMs: number;
  private offen: Offen | null = null;
  private transportQuelle: Quelle | null = null;     // wer den laufenden Transport gestartet hat (Spec 2.12)
  // 1.12 slice 3 (task 4, D8): the fields the hand overrides, by track id then field name; fed only from /e/auto, never written into the project.
  // /e/auto carries the track number `nr`, which stays with a track over moves (spur_verschieben changes only the position), so it maps to the id
  // at the moment the event arrives. Cleared on a new core generation and on open or new.
  // Each entry remembers its track number: the core reports the end of an override of a deleted track (zustand 0 at the snapshot swap) only AFTER
  // the server removed the track, and the entry must still clear then (else an undo of the delete would show a stale mark).
  private readonly uebersteuert = new Map<string, { nr: number; ziele: Set<string> }>();
  private kette: Promise<unknown> = Promise.resolve();
  // F1: the base value after a take that the core refused because the hand still holds the regulator (regler_beim_menschen, stellwerk hand.cpp
  // mensch_bei: the holder stays `mensch` up to 32 beats without a grip). It waits here by regulator path and is sent when the holder is released.
  private readonly basisWartend = new Map<string, { spurId: string; ziel: AufnahmeZiel }>();
  private armKette: Promise<void> = Promise.resolve();   // task 8: the arm calls, one at a time
  readonly aufAuto: AutoAufnahme;   // 1.12 slice 3 (task 8): arm state and the take collector
  private readonly rueckwegWartend = new Map<string, number>();     // Rückweg: letzter Wert je Pfad, noch nicht gespeichert
  private rueckwegTimer: ReturnType<typeof setTimeout> | null = null;
  private rueckwegGespeichertMs = -Infinity;                         // Zeit der letzten Speicherung des Rückwegs
  private geste: { nr: number; letzteMs: number; labels: string[]; offen: Offen | null } = { nr: 0, letzteMs: -Infinity, labels: [], offen: null };
  private sperren = 0;          // P4 (Spec 6.23): offene sperreLaden()-Freigaben
  private sperrenAufnahme = 0;   // 1.8: davon die Sperre der Aufnahme (höchstens eine; sie darf den eigenen Transport-Start)
  private aufnahmeLauf: unknown = null;   // 1.8: laufende Aufnahme (sperrt Tempo-Änderungen)
  private oeffnet = 0;          // Spec 6.32: laufende /proj/oeffnen und /proj/neu (in der Kette); solange > 0 lehnt sperreLaden() ab
  private stemsStand: Record<string, unknown> | null = null;   // Slice 6 (P6): letzter Stems-Stand, GET /proj/aktuell stems
  private ausgabeLauf: AusgabeLauf | null = null;   // Spec 6.34: laufender Freeze oder Export (Paket S3), GET /proj/aktuell ausgabe_lauf

  private readonly presetLies: ProjOptionen['presetLies'];   // 1.9 (O28)
  private readonly surge: SurgeSpiegel;                        // 1.9 U5: the Surge parameter map of the project mirrored into the hosts

  constructor(ctx: BereichKontext, opt: ProjOptionen = {}) {
    const instanz = opt.instanz ?? process.env.CYPHERDJ_INSTANZ ?? '';
    this.ctx = ctx;
    this.presetLies = opt.presetLies;
    this.surge = new SurgeSpiegel({ ordner: opt.wirtOrdner, log: (e) => ctx.log(e) });
    this.kern = new KernWeg(ctx, this.lage, opt.kernWeg);
    this.bk = new ProjBk(ctx, this.lage, this.kern, opt.bkFristMs ?? 5000);
    this.projekte = new Projekte(opt.wurzel ?? projektWurzelVorgabe(instanz));
    this.arbeitsordner = opt.arbeitsordner ?? arrOrdner(instanz);
    const zaehlerDatei = opt.zaehlerDatei
      ?? (opt.arbeitsordner ? `${path.resolve(opt.arbeitsordner)}.zaehler` : zaehlerDateiVorgabe(instanz));
    this.zaehler = new WiedergabeZaehler(this.arbeitsordner, zaehlerDatei);
    this.cache = new DekodierCache(this.arbeitsordner, { ffmpeg: opt.ffmpeg, ffprobe: opt.ffprobe, vorsatz: opt.vorsatz,
      bei: (e) => this.dekodiertEreignis(e) });
    this.transientenLager = new TransientenLager(path.join(this.arbeitsordner, 'audio'));
    this.katalog = opt.katalog ? new Katalog(opt.katalog) : null;
    this.analyse = opt.analyse !== undefined ? opt.analyse : analyseVorgabe(instanz);
    this.mediathekPfad = opt.mediathek ?? null;
    this.bestand = opt.bestand ?? null;
    this.analyseWarteMs = opt.analyseWarteMs ?? 2000;
    // Die Meldung läuft ohne neue rev: die Seite lädt bei clip_id nach (produktion.js)
    this.analysen = this.analyse && opt.analysierer
      ? new AnalyseListe(opt.analysierer, (sha, ei, ende) => this.analyseEnde(sha, ei, ende),
        (w, status) => this.ctx.verteile({ a: 'proj', f: { clip_id: w.clip_id, analyse: status } }))
      : null;
    this.arrFristMs = opt.arrFristMs ?? 600;
    this.rampeWarteMs = opt.rampeWarteMs ?? 20_000;
    this.uhrStillMs = opt.uhrStillMs ?? 1000;
    this.aufAuto = new AutoAufnahme({
      projekt: () => this.offen?.projekt ?? null, slug: () => this.offen?.slug ?? null, kennung: () => this.offen,
      bpm: () => this.lage.uhr?.bpm ?? this.offen?.projekt.tempo_bpm ?? 128,
      schreibe: (label, befehle, kennung) => this.schreibeTake(label, befehle, kennung as Offen),
      autoAn: async (nr, ziel) => this.kern.auto(nr, ziel, 1, 'andreas'),
      basis: (felder) => this.basisSenden(felder),
      entwaffne: async (nr) => {
        const q = await this.kern.arm(nr, 0, this.aufAuto.modusNr(), 'andreas');
        if (q === null || quittungAbgelehnt(q)) this.ctx.log({ typ: 'proj_arm_frei_fehler', nr, quittung: q });
      },
      verteile: (f) => this.ctx.verteile(f), log: (z) => this.ctx.log(z),
    }, opt.autoAufnahme);
  }

  // The base value of the project for fields of armed tracks (D10/D13a), through the same queue as every regulator write of the page (aendern, uebernimm):
  // two /k/teil of one regulator at one moment would overlap in the core. The value is read from the project when its turn comes. A refusal is logged;
  // one because of the hand is kept until the holder is released (see basisWartend).
  private basisSenden(felder: { spurId: string; ziel: AufnahmeZiel }[]): Promise<void> {
    return this.seriell(async () => {
      const p = this.offen?.projekt, soll: Soll[] = [], von = new Map<string, { spurId: string; ziel: AufnahmeZiel }>();
      for (const f of felder) {
        const sp = p?.spuren.find((x) => x.id === f.spurId);
        if (!sp) continue;
        const pfad = `spur/${sp.nr}/${f.ziel}`;
        soll.push({ pfad, wert: laneStart(sp, f.ziel) }); von.set(pfad, f);
      }
      if (!soll.length) return;
      for (const r of await this.kern.setzeRegler(soll, 'andreas')) {
        if (r.quittung !== null && !quittungAbgelehnt(r.quittung)) continue;
        const grund = r.quittung === null ? 'kein_kern' : r.quittung.grund;
        this.ctx.log({ typ: 'proj_basis_abgelehnt', pfad: r.pfad, grund });
        if (grund === 'regler_beim_menschen') this.basisWartend.set(r.pfad, von.get(r.pfad) as { spurId: string; ziel: AufnahmeZiel });
      }
    });
  }

  // Ein schreibender Weg zur Zeit; ein Fehler bricht die Kette nicht.
  private seriell<T>(f: () => Promise<T>): Promise<T> {
    const p = this.kette.then(f, f);
    this.kette = p.catch(() => undefined);
    return p;
  }
  private brauchOffen(): Offen {
    if (!this.offen) throw new ProjFehler(409, 'kein_projekt');
    return this.offen;
  }
  // Spec 3.5 / 2.12: bei KI-Stopp schreibt Cypher nichts
  private riegel(quelle: Quelle): void {
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
  }
  private haken(o: Offen): Haken {
    return { speichere: (p) => this.projekte.speichere(o.slug, p), dekodiert: (sha) => this.zustandVon(sha) };
  }
  private speichereStand(o: Offen): void {
    try { this.projekte.speichere(o.slug, o.projekt); } catch (e) {
      this.ctx.log({ typ: 'proj_speichern_fehler', slug: o.slug, fehler: (e as Error).message });
    }
  }

  // --- lesen ----------------------------------------------------------------------------------------------------------
  liste(): Antwort { return { code: 200, j: this.projekte.liste() }; }
  // ansicht (Spec 6.30, Leistung): 'voll' (die Seite), 'noten_zahl' (Werkzeug proj_lage: je MIDI-Clip noten_zahl statt noten), 'rev' ({slug, rev}
  // für das Werkzeug, bevor es schreibt)
  aktuell(ansicht: 'voll' | 'noten_zahl' | 'rev' = 'voll'): Antwort {
    const o = this.offen;
    if (ansicht === 'rev') return { code: 200, j: { slug: o?.slug ?? null, rev: o?.projekt.rev ?? null } };
    // Spec 6.34: die Seite (ansicht voll) bekommt immer ausgabe_lauf, damit ein Reload mitten in einem Freeze oder Export ihn sieht
    const lauf = ansicht === 'voll' ? { ausgabe_lauf: this.ausgabeLauf } : {};
    if (!o) return { code: 200, j: { slug: null, projekt: null, kern: null, ...lauf } };
    const a = this.lage.arr;
    this.raeumeNummern(o.projekt);
    const projekt = ansicht === 'noten_zahl' ? ohneNoten(o.projekt, (sid, ziel) => this.istUebersteuert(sid, ziel)) : o.projekt;
    // Slice 3a (T8): laufende Analysen dieses Projekts, flüchtig (nie im Projekt); nur wenn welche laufen, damit sich sonst nichts an der Antwort ändert
    const an = this.analysen?.stand(o.slug) ?? [];
    const kern = { rev_geladen: a ? a.nr : null, status: a ? a.status : null };
    // the page (full view) learns the overridden fields from here after a reload (D8); only present when something is overridden
    const ueber = ansicht === 'voll' ? this.uebersteuertListe(o.projekt) : [];
    return { code: 200, j: { slug: o.slug, projekt, kern, ...lauf, ...(an.length ? { analyse: an } : {}),
      ...(o.vorhoeren.size ? { vorhoeren: Object.fromEntries(o.vorhoeren) } : {}),
      ...(ueber.length ? { auto_uebersteuert: ueber } : {}), ...(this.aufAuto.istArm() ? { auto_arm: this.aufAuto.ansicht() } : {}),
      ...(this.stemsStand && this.stemsStand.slug === o.slug ? { stems: this.stemsStand } : {}) } };
  }
  // zeit in Millisekunden seit 1970 (Festlegung V1, Seite rechnet damit), volle Liste
  verlaufListe(): Antwort {
    const o = this.brauchOffen();
    return { code: 200, j: o.verlauf.liste().map((e) => ({ ...e, zeit: Date.parse(e.zeit) })) };
  }

  // Paket 1.13 (proj_warp): der Warp eines Audio-Clips mit Marker-Liste, Segment-Tempo und der Gegenprobe W(bei_beat). Beats in der Antwort:
  // beat = Clip-Beat des Markers, projekt_beat = wo er im ersten Durchlauf des Clips liegt; von_beat, bis_beat und bei_beat sind Projekt-Beats.
  // Slice 3a: höchstens max (Vorgabe MARKER_VORGABE) Marker, die Antwort sagt marker_zahl (im Clip), marker_gezeigt und weiter_ab_projekt_beat.
  warpLage(clipId: string | null, von: number | null, bis: number | null, bei: number | null, max: number | null = null,
    transMax: number | null = null, quelleGanz = false): Antwort {
    const o = this.brauchOffen();
    if (!clipId) throw new ProjFehler(400, 'argument_ungueltig', { text: 'clip_id: an audio clip id is required' });
    const g = sucheClip(o.projekt, clipId);
    if (!g) throw new ProjFehler(404, 'clip_unbekannt');
    if (g.clip.art !== 'audio') throw new ProjFehler(409, 'feld_nur_audio');
    const c = g.clip, w = c.warp;
    if (!w) return { code: 200, j: { clip_id: c.id, start_beat: c.start_beat, laenge_beats: c.laenge_beats, warp: null } };
    const m = w.marker, grenze = max ?? MARKER_VORGABE;
    const passend = m.map(([quellS, beat], i) => ({ quell_s: quellS, beat, projekt_beat: c.start_beat + beat - w.versatz_beats,
      segment_bpm: i + 1 < m.length ? segmentBpm(m, i) : null }))
      .filter((x) => (von === null || x.projekt_beat >= von) && (bis === null || x.projekt_beat <= bis));
    const marker = passend.slice(0, grenze);
    // Slice 4: Transienten der Quelle (Quellsekunden). transienten_zahl = im Bereich des Clips (die Länge einer Kopie), null = Quelle nicht
    // dekodiert; transienten = die im Fenster von_beat..bis_beat (Projekt-Beats der ersten Kopie), gedeckelt durch transienten_max
    const tAlle = this.transientenLager.fuer(c.quelle.sha256);
    const bereichEnde = w.versatz_beats + (c.loop_beats ?? c.laenge_beats);
    const tBereich = tAlle === null ? null : tAlle.filter((q) => { const b = beatBeiQuelle(m, q); return b >= w.versatz_beats && b < bereichEnde; });
    const tFenster = (tBereich ?? []).filter((q) => {
      const pb = c.start_beat + beatBeiQuelle(m, q) - w.versatz_beats;
      return (von === null || pb >= von) && (bis === null || pb <= bis);
    });
    // quelleGanz (Schlussrunde): alle Transienten der Quelle, ohne Marker, Bereich und Fenster; der Editor bildet sie selbst über seine aktuellen Marker ab
    const tGezeigt = (quelleGanz ? tAlle ?? [] : tFenster).slice(0, transMax ?? TRANSIENTEN_VORGABE);
    const { marker: _alle, ...kopf } = w;
    return { code: 200, j: { clip_id: c.id, start_beat: c.start_beat, laenge_beats: c.laenge_beats,
      warp: { ...kopf, eins_unsicher: w.eins_unsicher === true, marker_zahl: m.length, marker_gezeigt: marker.length,
        transienten_zahl: tBereich === null ? null : tBereich.length, transienten: tGezeigt, transienten_gezeigt: tGezeigt.length,
        ...(passend.length > grenze ? { weiter_ab_projekt_beat: passend[grenze].projekt_beat } : {}),
        tempo: tempoUebersicht(m), erster_marker: { quell_s: m[0][0], beat: m[0][1] }, marker },
      ...(bei === null ? {} : { bei: gegenprobe(c, bei) }) } };
  }

  // Automation Slice 1 (proj_auto): the points of one lane (lane_id) or of all lanes of a track (spur_id), plus the lane value at bei_beat
  // (dB for fader, the raw value for the other targets; the same laneWert the core computes).
  // von_beat/bis_beat are project beats, inclusive; at most max points (default AUTO_PUNKTE_VORGABE).
  autoLage(laneId: string | null, spurId: string | null, von: number | null, bis: number | null, bei: number | null, max: number | null,
    clipId: string | null = null, ziel: string | null = null): Antwort {
    const o = this.brauchOffen();
    if (clipId) {   // 1.12 slice 5: the envelopes of one clip (clip beats), one target or all
      if (laneId || spurId) throw new ProjFehler(400, 'argument_ungueltig', { text: 'clip_id comes alone: not together with lane_id or spur_id' });
      if (ziel !== null && !HK_ZIELE.includes(ziel)) throw new ProjFehler(400, 'huellkurve_ziel', { text: `ziel: ${HK_ZIELE.join(' | ')}` });
      const g = sucheClip(o.projekt, clipId);
      if (!g) throw new ProjFehler(404, 'clip_unbekannt');
      const grenzeC = max ?? AUTO_PUNKTE_VORGABE;
      if (ziel === null) {
        return { code: 200, j: { clip_id: g.clip.id, spur_id: g.spur.id,
          huellkurven: (g.clip.huellkurven ?? []).map((h) => huellkurveAnsicht(g.clip.id, g.spur.id, g.clip, h, von, bis, bei, grenzeC)) } };
      }
      const h = (g.clip.huellkurven ?? []).find((x) => x.ziel === ziel);
      if (!h) throw new ProjFehler(404, 'huellkurve_unbekannt', { text: `${g.clip.id} has no ${ziel} envelope` });
      return { code: 200, j: huellkurveAnsicht(g.clip.id, g.spur.id, g.clip, h, von, bis, bei, grenzeC) };
    }
    if (ziel !== null) throw new ProjFehler(400, 'argument_ungueltig', { text: 'ziel belongs to clip_id' });
    if (!laneId && !spurId) throw new ProjFehler(400, 'argument_ungueltig', { text: 'lane_id, spur_id or clip_id is required' });
    const grenze = max ?? AUTO_PUNKTE_VORGABE;
    if (laneId) {
      for (const s of o.projekt.spuren) {
        const l = (s.automation ?? []).find((x) => x.id === laneId);
        if (l) return { code: 200, j: laneAnsicht(s.id, l, von, bis, bei, grenze) };
      }
      throw new ProjFehler(404, 'lane_unbekannt');
    }
    const s = sucheSpur(o.projekt, spurId!);
    if (!s) throw new ProjFehler(404, 'spur_unbekannt');
    return { code: 200, j: { spur_id: s.id, lanes: (s.automation ?? []).map((l) => laneAnsicht(s.id, l, von, bis, bei, grenze)) } };
  }

  // --- S17: sound snapshot ------------------------------------------------------------------------------------------------
  // GET /proj/bk: saved against live for every channel of the table
  bkLage(): Antwort {
    const o = this.brauchOffen();
    return { code: 200, j: this.bk.ansicht(o.projekt, o.slug) };
  }
  // POST /proj/bk/merken {kanaele?, rev?}: ONE aendern call (one undo step). Runs outside `seriell` because aendern is serialised itself.
  async bkMerken(d: Koerper, quelle: Quelle): Promise<Antwort> {
    const o = this.brauchOffen();
    this.riegel(quelle);
    const { befehle, unbekannt, gemerkt } = this.bk.befehleZumMerken(o.projekt, d.kanaele);
    const r = await this.aendern({ rev: d.rev ?? o.projekt.rev, befehle, label: 'Baukasten: save sound' }, quelle);
    return r.code === 200 ? { code: 200, j: { ...(r.j as object), bk: { gemerkt, unbekannt } } } : r;
  }
  // POST /proj/bk/laden {kanaele?}: apply the saved sound now; an explicit load always sends the graph again
  bkLaden(d: Koerper, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      const o = this.brauchOffen();
      this.riegel(quelle);
      const nur = this.bk.kanaeleArg(d.kanaele);
      const baukasten = await this.bk.wiederherstellen(o.projekt, quelle, { schonGeladenUeberspringen: false, nur });
      return { code: 200, j: { slug: o.slug, baukasten } };
    });
  }

  // --- öffnen ---------------------------------------------------------------------------------------------------------
  neu(name: unknown, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle);
      this.sperreOeffnen();
      this.sperreFremderTransport(quelle);
      return this.oeffnetGerade(() => {
        const { slug } = this.projekte.lege(name as string);
        return this.oeffneIntern(slug, quelle);
      });
    });
  }
  oeffnen(slug: unknown, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle); this.sperreOeffnen(); this.sperreFremderTransport(quelle);
      return this.oeffnetGerade(() => this.oeffneIntern(slug as string, quelle));
    });
  }
  // Spec 6.31: Öffnen lädt die Wiedergabe des Projekts in den Kern, und jedes Laden bricht einen laufenden Freeze ab (6.23). Geprüft in der
  // Kette, also gegen die Sperre zu dem Zeitpunkt, an dem das Öffnen wirklich läuft; vor lege(), damit ein abgelehntes neu() keinen Ordner anlegt.
  private sperreOeffnen(): void {
    if (this.sperren > 0) throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; opening or creating a project waits until it is done' });
  }
  // Spec 6.37 (Andreas F13, REVIEW-5-opus M1: schliesseOffen stoppte jeden laufenden Transport mit der Quelle des Wechsels): Cypher öffnet oder
  // legt kein Projekt an, solange ein Transport läuft, den sie nicht selbst gestartet hat (auch unbekannt, etwa nach einem Server-Neustart, und
  // Andreas' Hand-Taste); nichts wird gestoppt. Andreas' eigener Wechsel stoppt wie bisher, Cyphers Wechsel über ihren eigenen Lauf stoppt ihren.
  // Geprüft in der Kette vor lege() und vor jedem await des Öffnens, also unmittelbar vor dem Stopp in schliesseOffen.
  private sperreFremderTransport(quelle: Quelle): void {
    if (!this.fremderLauf(quelle)) return;
    throw new ProjFehler(409, 'transport_laeuft', { text: 'a transport Andreas started is running; Cypher opens or creates a project only after it stops' });
  }
  // Spec 6.37: läuft oder wartet ein Transport (status 1 oder 2), den nicht Cypher gestartet hat, während Cypher (Quelle cypher) handeln will?
  // Andreas' Seite, seine Hand-Taste und ein unbekannter Starter (null, etwa nach einem Server-Neustart) zählen als seiner.
  private fremderLauf(quelle: Quelle): boolean {
    const a = this.lage.arr;
    return quelle === 'cypher' && !!a && (a.status === 1 || a.status === 2) && this.transportQuelle !== 'cypher';
  }
  // Spec 6.32: zwischen Öffnen und Freeze gewinnt, wer zuerst kommt. Öffnen und Anlegen haben Wartestellen (Stopp-Quittung des laufenden Projekts,
  // Wiederanlauf-Prüfung); solange sie laufen, lehnt sperreLaden() ab. Zählt nur, was in der Kette schon läuft: ein wartendes Öffnen prüft die
  // Sperre selbst, wenn es dran ist (sperreOeffnen).
  private async oeffnetGerade(f: () => Promise<Antwort>): Promise<Antwort> {
    this.oeffnet += 1;
    try { return await f(); } finally { this.oeffnet -= 1; }
  }
  private async oeffneIntern(slug: string, quelle: Quelle): Promise<Antwort> {
    // Spec 6.30: erst das neue Projekt öffnen, dann das laufende schliessen. Ein unbekannter, gesperrter oder kaputter Slug wirft in oeffne(),
    // und das laufende Projekt bleibt offen. Dasselbe Projekt noch einmal: zuerst schliessen, sonst hielte es seine eigene Sperre (projekt_busy).
    if (this.offen?.slug === slug) await this.schliesseOffen(quelle);
    // Spec 6.12: nur über oeffne() (zieht ein vorauslaufendes Log nach)
    const o = this.projekte.oeffne(slug, { beiFehler: (e) => this.ctx.log({ typ: 'proj_verlauf_fehler', slug, fehler: e.message }) });
    try { await this.schliesseOffen(quelle); } catch (e) {
      try { o.verlauf.schliesse(); } catch { /* der erste Fehler zählt */ }
      throw e;
    }
    const projekt = structuredClone(o.projekt);
    this.gleicheDekodiertAb(projekt, true);
    this.offen = { slug, projekt, verlauf: o.verlauf, merk: { laden: false, loop: false, tempo: false }, vorhoeren: new Map() };
    void this.surge.gleiche(projekt, true);                       // 1.9 U5: the Surge map of the opened project goes to the hosts (all entries)
    // AK34 / D6: a project open or new ends every override in the core (the override is never part of a project); the mirror starts empty
    this.uebersteuert.clear();
    this.aufAuto.verwirf();                    // D6: no track stays armed, no open take reaches the new project
    this.basisWartend.clear();
    // source andreas like nachNeustart: server housekeeping, Stop Cypher does not hold it back
    const autoFrei = Promise.all([this.autoFreiMitLog(), this.armFreiMitLog()]);
    // Spec 6.21: die Wiedergabe-Nummer entscheidet, wer beim Mixer gewinnt (gleiche Nummer: Wiederanlauf, die Spur-Regler des Kerns gewinnen)
    const wieder = await this.istWiederanlauf(projekt);
    // S17: the saved sound goes back while the controls are synchronised (not after a page server restart in front of a running kern: it kept everything)
    const [kern, bk] = await Promise.all([this.synchronisiere(quelle, true, wieder),
      wieder || !projekt.baukasten ? Promise.resolve(null) : this.bk.wiederherstellen(projekt, quelle, { schonGeladenUeberspringen: true }), autoFrei]);
    if (wieder && projekt.baukasten) kern.baukasten = { uebersprungen: 'wiederanlauf' }; else if (bk) kern.baukasten = bk;
    if (wieder) {
      const n = this.uebernimmMixer(this.offen);
      kern.wiederanlauf = true; kern.mixer_uebernommen = n;
    }
    const offenes = this.offen;
    this.ctx.log({ typ: 'proj_offen', slug, nachgezogen: o.nachgezogen, quelle, wiederanlauf: wieder });
    this.ctx.verteile({ a: 'proj', f: { slug, rev: offenes.projekt.rev, label: 'Open', quelle } });
    return { code: 200, j: { slug, projekt: offenes.projekt, kern } };
  }
  private async schliesseOffen(quelle: Quelle): Promise<void> {
    const o = this.offen;
    if (!o) return;
    this.aufAuto.verwirf();
    this.leereVorhoeren(o);                                              // 1.14: the audition ends with the project (event {}, the new project loads its own)
    for (const h of this.schliessHaken) try { h(o.slug); } catch (e) { this.ctx.log({ typ: 'proj_schliess_haken_fehler', fehler: (e as Error).message }); }
    this.rueckwegSpeichern();                                            // Spec 6.30: wartende Rückweg-Werte gehören diesem Projekt
    if (this.lage.arr && (this.lage.arr.status === 1 || this.lage.arr.status === 2)) await this.kern.stopp(quelle);
    this.rueckwegSpeichern();                                            // Spec 6.31: auch, was während des Stopps kam (nach dem letzten await)
    this.transportQuelle = null;
    this.offen = null;
    void this.surge.gleiche(null);                                       // 1.9 U5: the hosts go back to the values they had before this project's entries
    try { o.verlauf.schliesse(); } catch (e) { this.ctx.log({ typ: 'proj_verlauf_fehler', slug: o.slug, fehler: (e as Error).message }); }
  }
  // Beim Beenden des Servers: ausstehenden Mixer-Eintrag schreiben, Sperre freigeben
  schliesse(): void {
    this.aufAuto.beende();
    this.analysen?.stoppe();
    if (this.rueckwegTimer) { clearTimeout(this.rueckwegTimer); this.rueckwegTimer = null; }
    this.rueckwegSpeichern();
    const o = this.offen;
    this.offen = null;
    if (o) try { o.verlauf.schliesse(); } catch { /* der Server endet ohnehin */ }
  }

  // Wiedergabe laden, Mixer-Regler (alle), auf Wunsch erz/4 neutral, Loop, Metronom, Leeren der KI-Maske; alles parallel, Quittungen abgewartet
  // wiederanlauf (Spec 6.21, 6.30): der Kern gewinnt ganz. Keine neue Wiedergabe, kein erz/4, kein Loop, kein Metronom; von den Spur-Reglern
  // nur die mit unbekanntem Ist-Wert (für genau diese gewinnt das Projekt).
  private async synchronisiere(quelle: Quelle, erz4: boolean, wiederanlauf = false): Promise<Record<string, unknown>> {
    const o = this.brauchOffen();
    const soll: Soll[] = wiederanlauf ? this.unbekannteSpurRegler(o.projekt)
      : [...(erz4 ? erz4Soll(quelle) : []), ...alleRegler(o.projekt)];
    // A switch is a fresh start (Andreas, 2026-11-02): the hand holder of the regulators written below ends first, in the same order as the writes.
    // Not on a restart of the page server in front of a running core (wiederanlauf): there the core wins. Only Andreas's own switch breaks his hand (D9):
    // when Cypher opens or creates, nothing is sent and the core's refusal stays visible in kern.regler_fehler.
    if (!wiederanlauf && quelle === 'andreas') await this.handFreiMitLog(soll, quelle);
    // Spec 6.32: die Sperre zusätzlich unmittelbar vor Laden und Loop (gesperrt: am Offen merken, nicht senden; die Freigabe holt es nach).
    // Die erste Linie ist sperreLaden(), das während eines Öffnens ablehnt; dies ist die zweite.
    const [wiedergabe, regler, loop, metronom, ki] = await Promise.all([
      wiederanlauf ? Promise.resolve({ nr: o.projekt.wiedergabe_rev, quittung: null, wiederanlauf: true }) : this.ladeOderMerke(quelle),
      this.kern.setzeReglerPakete(soll, quelle),
      wiederanlauf ? Promise.resolve(null) : this.loopOderMerke(o, quelle),
      wiederanlauf ? Promise.resolve(null) : this.kern.metronom(o.projekt, quelle), this.leereKiMaske()]);
    // P6: nur bei Quelle cypher werden ziel und xseite nicht gesendet (der Kern lehnt nur_hand ab) und als Meldung geführt
    const nurHand = erz4 && !wiederanlauf && quelle === 'cypher'
      ? ERZ4_NUR_HAND.filter((r) => { const ist = this.lage.reglerWert(r.pfad); return ist !== null && ist !== r.wert; })
      .map((r) => ({ pfad: r.pfad, soll: r.wert, ist: this.lage.reglerWert(r.pfad) })) : [];
    return { wiedergabe, regler: regler.ergebnis.length, regler_nicht_gesendet: regler.nicht_gesendet, ...reglerBefund(regler.ergebnis),
      loop, metronom, ki, erz4_nur_hand: nurHand };
  }

  // Spec 6.21: gleicht /zustand/arr.nr der wiedergabe_rev des Projekts, spielt der Kern genau dessen letzte Wiedergabe. Kennt der Server den
  // Kern-Stand noch nicht (Start), wartet er höchstens arrFristMs auf /zustand/arr (der Kern meldet es mindestens mit 2 Hz); danach gilt: verschieden.
  private async istWiederanlauf(p: Projekt): Promise<boolean> {
    if (p.wiedergabe_rev <= 0) return false;
    for (let t0 = Date.now(); !this.lage.arr && Date.now() - t0 < this.arrFristMs;) await schlaf(10);
    return this.lage.arr !== null && this.lage.arr.nr === p.wiedergabe_rev;
  }
  // Spec 6.30: Spur-Regler, deren Ist-Wert der Server nicht kennt (der Kern schickt den Regler-Stand nur beim ersten Hallo einer Generation;
  // ein Server, der binnen 5 s neu startet, bekommt ihn nicht). Für genau diese gewinnt beim Wiederanlauf das Projekt.
  private unbekannteSpurRegler(p: Projekt): Soll[] {
    return alleRegler(p).filter((r) => this.lage.reglerWert(r.pfad) === null);
  }
  // Ist-Werte der Spur-Regler, die der Kern gemeldet hat, als EINE Änderung ins Projekt (Quelle andreas, undo-fähig). Unbekannte Werte
  // bleiben. Entscheidung E-a: der KI-Stopp senkt keinen Fader, jeder Ist-Wert ist eine Handbewegung oder der Projektstand.
  private uebernimmMixer(o: Offen): number {
    const befehle: Record<string, unknown>[] = [];
    const pfade = [
      ...o.projekt.spuren.flatMap((s) => (['fader', 'pan', 'mute', 'solo'] as const).map((k) => `spur/${s.nr}/${k}`)),
      ...(o.projekt.gruppen ?? []).flatMap((g) => (['fader', 'pan', 'mute', 'solo'] as const).map((k) => `grp/${g.nr}/${k}`)),
      'pm/fader',
      // 1.10 slice 3: the sends of every existing track and group, and all controls of every existing return (Hall included)
      ...[...o.projekt.spuren.map((s) => `spur/${s.nr}`), ...(o.projekt.gruppen ?? []).map((g) => `grp/${g.nr}`)]
        .flatMap((st) => [1, 2, 3, 4].map((r) => `${st}/send/${r}`)),
      ...(o.projekt.returns ?? []).flatMap((r) => [...(['fader', 'pan', 'mute', 'solo'] as const).map((k) => `ret/${r.nr}/${k}`),
        ...['an', ...HALL_FELDER].map((k) => `ret/${r.nr}/hall/${k}`)])];
    for (const pfad of pfade) {
      const wert = this.lage.reglerWert(pfad);
      const b = wert === null ? null : reglerZuBefehl(o.projekt, pfad, wert);
      if (b) befehle.push(b.befehl);
    }
    if (!befehle.length) return 0;
    const meta = { quelle: 'andreas' as const, label: 'Mixer nach Wiederanlauf' };
    try {
      const w = aendere(o.verlauf, o.projekt, befehle as never, meta, this.haken(o), { transienten: this.transienten });
      if (!w.eintrag) return 0;
      w.projekt.wiedergabe_rev = o.projekt.wiedergabe_rev;
      o.projekt = w.projekt;
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: w.projekt.rev, label: meta.label, quelle: 'andreas' } });
      return befehle.length;
    } catch (e) {
      this.ctx.log({ typ: 'proj_wiederanlauf_fehler', slug: o.slug, fehler: (e as Error).message });
      return 0;
    }
  }

  // Spec 6.1: neue Wiedergabe-Nummer, Datei schreiben, /k/arr/laden; project.json führt die Nummer als wiedergabe_rev (ohne neue rev)
  private async ladeWiedergabe(quelle: Quelle, vorhoeren?: ReadonlyMap<string, string>): Promise<Record<string, unknown>> {
    const o = this.brauchOffen();
    const nr = this.schreibeNeueWiedergabe(o.projekt);
    if (typeof nr !== 'number') return nr;
    this.speichereStand(o);
    const ladeNr = this.schreibeVorhoerWiedergabe(o.projekt, vorhoeren ?? o.vorhoeren) ?? nr;
    return { nr: ladeNr, quittung: await this.kern.laden(ladeNr, quelle) };
  }
  // 1.14 comping (R8): while an audition is on, the core plays a second file next to the main playback. The main playback is written as always and is
  // the only one that becomes p.wiedergabe_rev (restart guard: a core restart and a page-server restart both fall back to it). The audition file
  // takes its own number from the same counter (the core addresses files by number: wiedergabe-<nr>.json), nobody keeps that number.
  // null: no audition, or the translator refused it (then the main playback is loaded; the refusal is logged).
  // `streng`: a refusal of the translator throws ProjFehler (the audition request answers with the reason) instead of falling back to the main playback.
  private schreibeVorhoerWiedergabe(p: Projekt, vorhoeren: ReadonlyMap<string, string>, streng = false): number | null {
    if (vorhoeren.size === 0) return null;
    const nr = this.zaehler.naechste();
    try {
      schreibeWiedergabe(this.arbeitsordner, this.uebersetzeFuer(p, nr, vorhoeren));
      return nr;
    } catch (e) {
      if (!(e instanceof WiedergabeFehler)) throw e;
      this.ctx.log({ typ: 'proj_vorhoeren_wiedergabe_fehler', grund: e.grund });
      if (streng) throw new ProjFehler(409, e.grund, { detail: e.message });
      return null;
    }
  }
  // The one place that sets the translator options of the live playback and of the export paths; only the live ones pass `vorhoeren`.
  private uebersetzeFuer(p: Projekt, nr: number, vorhoeren?: ReadonlyMap<string, string>): Wiedergabe {
    return uebersetze(p, { nr, audioOrdner: path.join(this.arbeitsordner, 'audio'), frames: (sha) => this.cache.frames(sha), transienten: this.transienten,
      arbeitsordner: this.arbeitsordner, ...(vorhoeren ? { vorhoeren } : {}) });
  }
  // Wiedergabe-Datei zum Stand p mit der nächsten Nummer schreiben und p.wiedergabe_rev setzen (ohne Speichern, ohne Laden). Gibt die Nummer zurück
  // oder, wenn der Übersetzer ablehnt, {nr: null, fehler, text}.
  private schreibeNeueWiedergabe(p: Projekt): number | Record<string, unknown> {
    const nr = this.zaehler.naechste();
    let w;
    try {
      w = this.uebersetzeFuer(p, nr);                                       // Spec 6.14, 6.29: freeze.datei ist relativ zum Arbeitsordner
    } catch (e) {
      if (e instanceof WiedergabeFehler) {
        this.ctx.log({ typ: 'proj_wiedergabe_fehler', grund: e.grund });
        return { nr: null, fehler: e.grund, text: grundText(e.grund), detail: e.message };   // Spec 6.34: text englisch
      }
      throw e;
    }
    schreibeWiedergabe(this.arbeitsordner, w);
    p.wiedergabe_rev = nr;
    return nr;
  }
  // Für vollziehe, unmittelbar vor der einen Speicherung: während der Freeze-Sperre (Spec 6.23, 6.30) merken statt schreiben, sonst die Wiedergabe
  // zum neuen Stand schreiben. Rückgabe: {nr} zum Laden nach dem Speichern, {nr: null, aufgeschoben} oder {nr: null, fehler, text}.
  private bereiteWiedergabe(o: Offen, p: Projekt, vorhoeren: ReadonlyMap<string, string>): Record<string, unknown> {
    if (this.sperren > 0) { o.merk.laden = true; return { nr: null, aufgeschoben: true }; }
    const nr = this.schreibeNeueWiedergabe(p);
    if (typeof nr !== 'number') return nr;
    const v = this.schreibeVorhoerWiedergabe(p, vorhoeren);
    return v === null ? { nr } : { nr, laden: v };
  }
  // Entscheidung E-a (2026-10-20): der KI-Stopp senkt keinen Fader mehr, Cyphers Spuren stehen in keiner Maske. Beim Öffnen und nach einem
  // Neustart des Kerns geht trotzdem spur/0 hinaus: ein Kern, der von einem früheren Server noch eine Spur-Maske trägt, verliert sie. Absender ist
  // der Server (andreas), die Maske gehört dem Leitstand, nicht der KI.
  private async leereKiMaske(): Promise<Record<string, unknown>> {
    const q = await this.kern.kiSpur('spur/0', 'andreas');
    return { kanaele: 'spur/0', quittung: q };
  }

  // --- Dekodier-Cache (Spec 2.8) ----------------------------------------------------------------------------------------
  private zustandVon(sha: string): DekodiertZustand { return this.cache.zustand(sha); }
  // Pfad einer Quelle: über den Katalog (Spec 2.9: sha ist die Identität, der Pfad nur Hinweis); ohne Katalog-Treffer der Hinweis, wenn da.
  private quellPfad(sha: string, hinweis: string): string | null {
    if (this.katalog) {
      try {
        const z = this.katalog.eintrag(sha);
        if (z && z.schutz !== 'ableton' && z.pfad && fs.existsSync(z.pfad)) return z.pfad;
      } catch { /* Katalog fehlt oder ist kaputt: Hinweis versuchen */ }
    }
    return hinweis && fs.existsSync(hinweis) ? hinweis : null;
  }
  // Welle der Seite (S6 Task 14): Pfad einer sha, die ein Audio-Clip des offenen Projekts trägt (Stems, Takes). Der Pfad kommt aus dem
  // Projekt, nie aus der Anfrage; eine sha ohne Clip im offenen Projekt gibt null.
  projektQuellPfad(sha: string): string | null {
    const o = this.offen;
    if (!o) return null;
    for (const c of alleAudioClips(o.projekt)) if (c.quelle.sha256 === sha) return this.quellPfad(sha, c.quelle.pfad_hinweis);   // take clips too (R9)
    return null;
  }
  // Setzt dekodiert aller Audio-Clips (ohne rev, Spec 6.6) und fordert fehlende Dekodierungen an. fehlerNeu: auch Fehlgeschlagene neu versuchen.
  // Rückgabe: die shas, deren Zustand sich geändert hat (Haupt- und Take-Clips); ob das die Wiedergabe betrifft, sagt betrifftWiedergabe.
  private gleicheDekodiertAb(p: Projekt, fehlerNeu: boolean): Set<string> {
    const geaendert = new Set<string>();
    for (const c of alleAudioClips(p)) {
      let z = this.zustandVon(c.quelle.sha256);
      if (z === 'nein' || (fehlerNeu && z === 'fehler')) {
        const pfad = this.quellPfad(c.quelle.sha256, c.quelle.pfad_hinweis);
        z = pfad ? this.cache.fordereAn(c.quelle.sha256, pfad) : 'fehler';
      }
      if (c.dekodiert !== z) { c.dekodiert = z; geaendert.add(c.quelle.sha256); }
    }
    return geaendert;
  }
  // 1.14 comping: the one place that decides whether a changed decode state reaches the playback. Today only main clips are played, so a take-only
  // sha changes nothing there, unless a track is auditioning that take.
  private betrifftWiedergabe(p: Projekt, geaenderteShas: Iterable<string>): boolean {
    const shas = new Set(geaenderteShas);
    if (shas.size === 0) return false;
    for (const s of p.spuren) for (const c of s.clips) if (c.art === 'audio' && shas.has(c.quelle.sha256)) return true;
    // 1.14: a take clip counts when a track auditions that take
    for (const [spurId, takeId] of this.offen?.vorhoeren ?? []) {
      const take = p.spuren.find((s) => s.id === spurId)?.takes?.find((x) => x.id === takeId);
      if (take?.clips.some((c) => c.art === 'audio' && shas.has(c.quelle.sha256))) return true;
    }
    return false;
  }
  private dekodiertEreignis(e: DekodierEreignis): void {
    void this.seriell(async () => {
      const o = this.offen;
      if (!o) return;
      for (const c of alleAudioClips(o.projekt)) {
        if (c.quelle.sha256 !== e.sha || c.dekodiert === e.zustand) continue;
        c.dekodiert = e.zustand;
        this.ctx.verteile({ a: 'proj', f: { clip_id: c.id, dekodiert: e.zustand } });   // ohne neue rev (Festlegung V1)
      }
      if (e.zustand === 'fertig' && this.betrifftWiedergabe(o.projekt, [e.sha])) await this.ladeOderMerke('andreas');
    }).catch((x) => this.ctx.log({ typ: 'proj_dekodier_fehler', sha: e.sha, fehler: (x as Error).message }));
  }

  // --- ändern -----------------------------------------------------------------------------------------------------------
  // Slice 3a: die Tempo-Angaben des Katalogs plus die Werkstatt-Karte zur sha des Clips; die Dauer fällt auf die der Karte zurück, wenn der Katalog keine hat
  private tempoQuelleFuer(z: Zeile, sha: string): TempoQuelle {
    const k = leseKarte(this.analyse, sha, this.bestand);
    // auch bei einer Karte: sie kann unbrauchbar sein (karten_hinweis)
    const t = z.typ === 'track' || z.typ === 'loop' ? leseTraktor(this.mediathekPfad, sha) : null;
    return { typ: z.typ, bpm: z.bpm, takte: z.takte, dauer_s: z.dauer_s ?? k?.dauer_s ?? null, instrument: z.instrument, kategorie: z.kategorie,
      ...(k ? { karte: k.karte } : {}), ...(t ? { traktor: t } : {}) };
  }
  // Audio-Clips nur aus dem Katalog (Spec 2.11): sha256 → Pfad; Ableton-geschützt, Datei fehlt, unbekannt werden abgelehnt.
  // Paket 1.13: dasselbe Wissen löst den Auto-Warp auf (Reihenfolge werkstatt > traktor > takte > mediathek, tempoQuelleFuer). clip_neu mit warp
  // 'auto' bekommt Warp und Länge in Beats, laenge_beats des Aufrufers ist der Rückfall für Typen und Einträge ohne Tempo (Hinweis kein_tempo);
  // warp_auto auf einem vorhandenen Clip wird zu warp_setzen (Länge bleibt). Slice 3a (D1, F2): braucht ein langer Track eine Analyse
  // (brauchtAnalyse, nicht für eine sha, deren Analyse scheiterte), bekommt der Clip trotzdem sofort den Warp der besten Quelle (ohne jedes Tempo
  // keinen); die Auflösung merkt sich einen Wunsch (die Aufträge starten erst nach dem erfolgreichen Schreiben, starteAnalysen) und sagt es in
  // hinweise. Ein warp_auto ohne Tempo, das nur eine Analyse anstößt, fällt aus der Liste (T6).
  private loeseQuellenAuf(befehle: unknown[], projekt: Projekt):
    { befehle: unknown[]; quellen: Map<string, string>; hinweise: Hinweis[]; wuensche: Anforderung[] } {
    const quellen = new Map<string, string>();
    const hinweise: Hinweis[] = [];
    const wuensche: Anforderung[] = [];
    const analyseHinweis = (index: number, sha: string): void => {
      hinweise.push({ index, hinweis: this.analysen?.laeuft(sha) ? 'analyse_laeuft' : 'analyse_angefordert' });
    };
    const brauchtSie = (q: Parameters<typeof brauchtAnalyse>[0], r: Parameters<typeof brauchtAnalyse>[1], sha: string): boolean =>
      this.analysen !== null && !this.analyseGescheitert.has(sha) && brauchtAnalyse(q, r);
    // Slice 3b: der Stand, den ein Befehl an dieser Stelle sieht (die Befehle davor sind schon aufgelöst). Scheitert einer davon, rechnet der Lauf
    // ohnehin dieselbe Ablehnung.
    const bisher: unknown[] = [];
    const standVor = (): Projekt => {
      const davor = bisher.filter((v) => v !== null);
      if (davor.length === 0) return projekt;
      try {
        return fuehreListeAus(projekt, davor, { transienten: this.transienten, graphArt, kitDa, presetLies: this.presetLies, surgeBereich }).projekt;
      } catch { return projekt; }
    };
    const loese = (b: unknown, index: number): unknown => {
      const x = b as Koerper;
      if (x && typeof x === 'object' && x.befehl === 'tempo_vom_clip') {
        const nurId = Object.keys(x).every((k) => k === 'befehl' || k === 'clip_id');
        const g = nurId && typeof x.clip_id === 'string' ? sucheClip(standVor(), x.clip_id) : undefined;
        if (g?.clip.art !== 'audio' || !g.clip.warp) return b;      // der Baustein meldet clip_unbekannt, feld_nur_audio, kein_warp, argument_unbekannt
        return { befehl: 'tempo_setzen', bpm: fensterTempo(g.clip.warp, g.clip.loop_beats ?? g.clip.laenge_beats) };
      }
      if (x && typeof x === 'object' && x.befehl === 'warp_ab_hier' && x.art === 'start' && typeof x.clip_id === 'string' && typeof x.beat === 'number') {
        const g = Object.keys(x).every((k) => ['befehl', 'clip_id', 'beat', 'art'].includes(k)) ? sucheClip(standVor(), x.clip_id) : undefined;
        if (g?.clip.art !== 'audio' || !g.clip.warp) return b;                   // der Baustein meldet die Ablehnung
        if (!this.katalog) throw new ProjFehler(503, 'katalog_fehlt', { index });
        const z = this.katalog.eintrag(g.clip.quelle.sha256);
        if (!z) throw new ProjFehler(404, 'sha_unbekannt', { index });
        const r = autoWarp(this.tempoQuelleFuer(z, g.clip.quelle.sha256));
        if (r === null || 'hinweis' in r) throw new ProjFehler(409, 'kein_tempo', { index });
        const marker = abHierStart(g.clip.warp.marker, x.beat, r.warp.marker);
        if (marker === null) throw new ProjFehler(409, 'kein_tempo', { index, text: 'the auto warp has no marker behind that beat' });
        return { befehl: 'warp_setzen', clip_id: x.clip_id, warp: handWarp(g.clip.warp, marker) };
      }
      // Slice 4 (D8): Quantize Audio. Je Transient im Bereich ein Hand-Marker auf dem Raster; die Grenzen (800 BPM, 4096 Marker) prüft warp_setzen und lehnt ab
      if (x && typeof x === 'object' && x.befehl === 'audio_quantisieren' && typeof x.clip_id === 'string') {
        const felder = ['befehl', 'clip_id', 'raster', 'staerke', 'von_beat', 'bis_beat'];
        const g = Object.keys(x).every((k) => felder.includes(k)) ? sucheClip(standVor(), x.clip_id) : undefined;
        if (g?.clip.art !== 'audio' || !g.clip.warp) return b;                   // der Baustein meldet die Ablehnung
        const r = ({ '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 } as Record<string, number | undefined>)[String(x.raster)];
        const falsch = (detail: string): never => { throw new ProjFehler(400, 'argument_ungueltig', { index, detail }); };
        if (r === undefined) falsch('raster: 1/4 | 1/8 | 1/16 | 1/32');
        const staerke = x.staerke === undefined ? 1 : x.staerke;
        if (typeof staerke !== 'number' || !(staerke >= 0 && staerke <= 1)) falsch('staerke: 0..1');
        for (const k of ['von_beat', 'bis_beat']) {
          const v = x[k];
          if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_BEAT)) falsch(`${k}: a clip beat (number)`);
        }
        const t = this.transienten(g.clip.quelle.sha256);
        if (t === null) throw new ProjFehler(409, 'transienten_fehlen', { index });
        let marker: [number, number][];
        // D13/Fix 2: Standardbereich = der Bereich des Clips (Randtempo außerhalb der Marker), Raster im Projekt (erste Kopie)
        const c = g.clip, versatz = c.warp!.versatz_beats;
        const laenge = c.loop_beats ?? c.laenge_beats;
        const bereich = { von_beat: (x.von_beat as number | undefined) ?? versatz, bis_beat: (x.bis_beat as number | undefined) ?? versatz + laenge,
          off: c.start_beat - versatz };
        try { marker = quantisiere(g.clip.warp.marker, t, r!, staerke as number, bereich); }
        catch (e) { if (e instanceof WarpFehler) throw new ProjFehler(409, e.grund, { index }); throw e; }
        return { befehl: 'warp_setzen', clip_id: x.clip_id, warp: handWarp(g.clip.warp, marker) };
      }
      if (x && typeof x === 'object' && x.befehl === 'warp_auto' && typeof x.clip_id === 'string') {
        const g = sucheClip(projekt, x.clip_id);
        if (!g && befehle.slice(0, index).some((v) => (v as Koerper)?.befehl === 'clip_neu')) throw new ProjFehler(409, 'warp_auto_neuer_clip', { index });
        if (g?.clip.art !== 'audio') return b;                                   // der Baustein meldet clip_unbekannt bzw. feld_nur_audio
        if (!this.katalog) throw new ProjFehler(503, 'katalog_fehlt', { index });
        const sha = g.clip.quelle.sha256;
        const z = this.katalog.eintrag(sha);
        if (!z) throw new ProjFehler(404, 'sha_unbekannt', { index });
        const q = this.tempoQuelleFuer(z, sha), r = autoWarp(q);
        const pfad = brauchtSie(q, r, sha) ? this.quellPfad(sha, g.clip.quelle.pfad_hinweis) : null;
        if (pfad !== null) { wuensche.push({ sha, pfad, clip_id: x.clip_id }); analyseHinweis(index, sha); }
        if (r === null || 'hinweis' in r) {
          if (pfad !== null) return null;                          // kein Tempo, die Analyse ist unterwegs: der Befehl tut nichts und lehnt nicht ab
          throw new ProjFehler(409, 'kein_tempo', { index });
        }
        const { clip_id, ...rest } = x;
        return { ...rest, befehl: 'warp_setzen', clip_id, warp: r.warp };
      }
      if (!x || typeof x !== 'object' || x.befehl !== 'clip_neu' || x.art !== 'audio' || typeof x.sha256 !== 'string') return b;
      if (!this.katalog) throw new ProjFehler(503, 'katalog_fehlt', { index });
      const z = this.katalog.eintrag(x.sha256);
      if (!z) throw new ProjFehler(404, 'sha_unbekannt', { index });
      if (z.schutz === 'ableton') throw new ProjFehler(409, 'nur_live', { index });
      if (!z.pfad || !fs.existsSync(z.pfad)) throw new ProjFehler(409, 'quelle_fehlt', { index });
      quellen.set(z.sha, z.pfad);
      let warpTeil: Koerper = {};
      if (x.warp === 'auto') {
        const q = this.tempoQuelleFuer(z, z.sha), r = autoWarp(q);
        const analyse = brauchtSie(q, r, z.sha);
        if (analyse) { wuensche.push({ sha: z.sha, pfad: z.pfad }); analyseHinweis(index, z.sha); }   // D1: die Karte kommt nebenher
        if (r !== null && 'warp' in r) {
          warpTeil = { warp: r.warp, laenge_beats: r.laenge_beats };
          if (r.karten_hinweis) hinweise.push({ index, hinweis: r.karten_hinweis });   // T3: eine bessere Quelle war da, taugte aber nicht
        } else {
          warpTeil = { warp: 'aus' };
          if (r !== null && !analyse) hinweise.push({ index, hinweis: r.hinweis });    // mit Analyse sagt analyse_angefordert mehr als kein_tempo
        }
      }
      return { ...x, sha256: z.sha, pfad_hinweis: z.pfad, ...warpTeil };
    };
    const aus = befehle.map((b, index) => { const r = loese(b, index); bisher.push(r); return r; });
    return { befehle: aus.filter((b) => b !== null), quellen, hinweise, wuensche };
  }
  // 1.9 U5 (O28 on Surge): the current host values of the parameters that geraet_richtung commands of this list need and the track's map does not hold
  // yet (one read per slot). undefined: nothing to read. A host that does not answer leaves the values out; the command then refuses wirt_wert_unbekannt.
  private async surgeIstFuer(p: Projekt, befehle: unknown[]): Promise<((slot: number, name: string) => number | null) | undefined> {
    const noetig = new Map<number, Set<string>>();
    for (const b of befehle) {
      const x = b as Koerper;
      if (x?.befehl !== 'geraet_richtung' || typeof x.spur_id !== 'string' || typeof x.wort !== 'string') continue;
      const g = sucheSpur(p, x.spur_id)?.geraet;
      if (g?.art !== 'wirt') continue;
      for (const n of surgeParameterVon(x.wort)) if (!Object.hasOwn(g.parameter ?? {}, n)) noetig.set(g.slot, (noetig.get(g.slot) ?? new Set<string>()).add(n));
    }
    if (noetig.size === 0) return undefined;
    const gelesen = new Map<string, number>();
    for (const [slot, namen] of noetig) {
      const w = await this.surge.ist(slot, [...namen]);
      if (w) for (const [n, v] of Object.entries(w)) gelesen.set(`${slot}:${n}`, v);
    }
    return (slot, name) => gelesen.get(`${slot}:${name}`) ?? null;
  }
  private pruefeRev(o: Offen, rev: unknown): void {
    if (rev !== o.projekt.rev) throw new ProjFehler(409, 'rev_veraltet', { rev: o.projekt.rev });
  }

  // `erwartet`: the project the caller means (the take collector); checked inside the serialized write, where the open project cannot change any more
  aendern(d: Koerper, quelle: Quelle, erwartet?: Offen): Promise<Antwort> {
    return this.seriell(async () => {
      const o = this.brauchOffen();
      if (erwartet !== undefined && o !== erwartet) throw new ProjFehler(409, 'projekt_gewechselt');
      this.riegel(quelle);
      this.pruefeRev(o, d.rev);
      if (!Array.isArray(d.befehle) || d.befehle.length === 0) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: 'befehle: a non-empty list of commands is required' });
      }
      const meta = { quelle, label: d.label as string };
      o.verlauf.pruefeMeta(meta);
      const { befehle, quellen, hinweise, wuensche } = this.loeseQuellenAuf(d.befehle, o.projekt);
      const alt = o.projekt;
      if (befehle.length === 0) {                                   // Slice 3a: alles war ein warp_auto, das nur eine Analyse anstieß
        this.starteAnalysen(o, quelle, wuensche, alt);
        return { code: 200, j: { rev: alt.rev, projekt: alt, hinweise } };
      }
      if (befehle.some((b) => (b as Koerper)?.befehl === 'tempo_setzen') && this.lage.deckLaeuft()) throw new ProjFehler(409, 'deck_laeuft');
      if (this.aufnahmeLauf && befehle.some((b) => (b as Koerper)?.befehl === 'tempo_setzen'))
        throw new ProjFehler(409, 'beschaeftigt', { text: 'a recording is running; the tempo cannot change now' });
      // 1.9 U5: a direction word on a Surge track starts from what the host plays now; read before the (synchronous) command run
      const surgeIst = await this.surgeIstFuer(o.projekt, befehle);
      // the host read is an await: a writer outside the queue (uebernimm: freeze, export, recording, stems) can have replaced the project meanwhile;
      // the caller's rev is checked again (spec 6.31), and the open project must still be the one this call started with
      if (this.offen !== o) throw new ProjFehler(409, 'projekt_gewechselt');
      this.pruefeRev(o, d.rev);
      // quelle: Herkunft für spur_neu (Spec 6.22)
      const probe = fuehreListeAus(o.projekt, befehle, { quelle, transienten: this.transienten, graphArt, kitDa, presetLies: this.presetLies, surgeBereich,
        ...(surgeIst ? { surgeIst } : {}) });
      if (probe.vor.length === 0) {
        this.starteAnalysen(o, quelle, wuensche, alt);
        return { code: 200, j: { rev: o.projekt.rev, projekt: o.projekt, ...(hinweise.length ? { hinweise } : {}) } };
      }
      this.pruefeMarkerInQuelle(o.projekt, probe.projekt);
      this.pruefeSperre(o.projekt, probe.projekt, probe.betrifft_wiedergabe);
      // Spec 6.31 (Leistung): die Probe IST die Ausführung; aendere rechnet sie nicht noch einmal. Gültig, weil vollziehe nach dem Warten auf die
      // Quittungen prüft, dass o.projekt noch genau der Stand ist, gegen den sie gerechnet wurde (sonst 409 rev_veraltet).
      const projekt = o.projekt;
      // task 8: the value before a page write of a gesture (not for the take's own write)
      if (erwartet === undefined && quelle === 'andreas') this.aufAuto.merkeBasen(projekt, probe.projekt);
      const antwort = await this.vollziehe(o, quelle, probe.regler_aenderungen,
        (h) => aendere(o.verlauf, projekt, befehle as never, meta, h, { ergebnis: probe }), quellen, probe.betrifft_wiedergabe);
      if (antwort.code === 200) this.starteAnalysen(o, quelle, wuensche, alt);
      const alle = antwort.code === 200 ? [...hinweise, ...this.einsRueckweg(o, d.befehle, quelle)] : hinweise;
      return alle.length && antwort.code === 200 ? { code: 200, j: { ...(antwort.j as object), hinweise: alle } } : antwort;
    });
  }
  // Slice 3b (D3, F6): Set 1.1.1 Here geht als Zeile art = eins in die Korrekturen des Decks, wenn der Bestand den Track kennt. Das Projekt ist da
  // schon geändert; ein Schreibfehler kippt es nicht, er kommt als Hinweis eins_rueckweg_fehler. Ohne Rückweg sagt eins_nur_hier, dass nur der Clip
  // sich änderte.
  private einsRueckweg(o: Offen, roh: unknown[], quelle: Quelle): Hinweis[] {
    const aus: Hinweis[] = [];
    roh.forEach((b, index) => {
      const x = b as Koerper;
      if (x?.befehl !== 'eins_hier' || typeof x.clip_id !== 'string' || typeof x.quell_s !== 'number') return;
      const g = sucheClip(o.projekt, x.clip_id);
      if (g?.clip.art !== 'audio') return;
      const sha = g.clip.quelle.sha256;
      try {
        const r = schreibeEinsKorrektur(this.bestand, sha, x.quell_s);
        aus.push({ index, hinweis: r.status === 'geschrieben' ? 'eins_gemeldet' : 'eins_nur_hier' });
        if (r.status === 'geschrieben') this.ctx.log({ typ: 'eins_korrektur', sha, ab_quell_beat: r.ab_quell_beat, quelle });
      } catch (e) {
        aus.push({ index, hinweis: 'eins_rueckweg_fehler' });
        this.ctx.log({ typ: 'eins_korrektur_fehler', sha, fehler: (e as Error).message });
      }
    });
    return aus;
  }
  // Slice 3a: nach dem Schreiben die Aufträge anfordern. clip_neu-Wünsche (ohne clip_id) gelten allen neuen Clips dieser sha; der Stand beim Auftrag
  // (Warp, Länge) ist, was der Clip jetzt hat (T11).
  private starteAnalysen(o: Offen, quelle: Quelle, wuensche: Anforderung[], alt: Projekt): void {
    if (this.analysen === null || wuensche.length === 0) return;
    const vorhanden = new Set(alt.spuren.flatMap((s) => s.clips.map((c) => c.id)));
    for (const w of wuensche) {
      for (const s of o.projekt.spuren) for (const c of s.clips) {
        if (c.art !== 'audio' || c.quelle.sha256 !== w.sha) continue;
        if (w.clip_id !== undefined ? c.id !== w.clip_id : vorhanden.has(c.id)) continue;
        this.analysen.anfordern(w.sha, w.pfad, { slug: o.slug, clip_id: c.id, quelle, vorher: c.warp ?? null, laenge_beats: c.laenge_beats });
      }
    }
  }
  // Das Ende einer Analyse: bei Fehler die sha als gescheitert merken und melden, bei Erfolg jeden wartenden Clip umschalten (ankunft) und melden
  private analyseEnde(sha: string, ei: AnalyseEintrag, ende: AnalyseEnde): void {
    this.ctx.log({ typ: 'analyse_ende', sha, ok: ende.ok, grund: ende.grund ?? null, clips: ei.wuensche.length });
    if (!ende.ok) this.analyseGescheitert.add(sha);   // D1: warp_auto und neues Ablegen warpen diese sha ab jetzt sofort aus Traktor, Takten oder BPM
    for (const w of ei.wuensche) {
      if (!ende.ok) { this.ctx.verteile({ a: 'proj', f: { clip_id: w.clip_id, analyse: 'fehler', grund: ende.grund ?? 'unbekannt' } }); continue; }
      void this.ankunft(sha, w).then((e) => {
        if (e === 'keine_karte') this.analyseGescheitert.add(sha);   // ok, aber keine brauchbare Karte in der Ablage: derselbe Fall
        const f = e === 'ok' ? { analyse: 'fertig' } : { analyse: 'verworfen', grund: e };
        this.ctx.verteile({ a: 'proj', f: { clip_id: w.clip_id, ...f } });
      }).catch((x) => this.ctx.log({ typ: 'analyse_ankunft_fehler', sha, clip_id: w.clip_id, fehler: (x as Error).message }));
    }
  }
  // Ankunft der Karte für einen Clip (T10, T11). Läuft ausserhalb der seriellen Kette und schreibt über aendern() (rev-Prüfung, Riegel,
  // Freeze-Sperre, Verlauf, SSE); gelesen wird synchron vor dem Aufruf, rev_veraltet wiederholt. 'ok' oder der Grund, aus dem nichts geschrieben wurde.
  // D1: klingt der Clip (klingtGerade), wartet sie, ohne Versuchsgrenze; jeder Durchgang liest Projekt, Clip und Warp neu, ein Wechsel oder ein
  // Eingriff beendet das Warten (schliesse() setzt offen auf null: auch der Serverstop beendet es).
  private async ankunft(sha: string, w: Wunsch): Promise<string> {
    let veraltet = 0, beschaeftigt = 0, gemeldet = false;
    for (;;) {
      const o = this.offen;
      if (!o || o.slug !== w.slug) return 'projekt_weg';
      const g = sucheClip(o.projekt, w.clip_id);
      if (!g || g.clip.art !== 'audio' || g.clip.quelle.sha256 !== sha) return 'clip_weg';
      const z = this.katalog?.eintrag(sha) ?? null;
      if (!z) return 'katalog_weg';
      const a = ankunftBefehle(g.clip, { warp: w.vorher, laenge_beats: w.laenge_beats }, this.tempoQuelleFuer(z, sha));
      if ('lassen' in a) return a.lassen;   // Auto-Warp bleibt aus (interner Grund, nie an die Seite)
      if (klingtGerade(this.lage.arr, g.clip)) {                  // D1: ein klingender Clip wird nicht umgeschaltet
        if (!gemeldet) { gemeldet = true; this.ctx.verteile({ a: 'proj', f: { clip_id: w.clip_id, analyse: 'karte_bereit' } }); }
        await schlaf(this.analyseWarteMs);
        continue;
      }
      try {
        await this.aendern({ rev: o.projekt.rev, label: 'Auto-Warp', befehle: a.befehle }, w.quelle);
        return 'ok';
      } catch (e) {
        const grund = (e as { grund?: string })?.grund ?? null;
        if (grund === 'rev_veraltet' && ++veraltet < 5) continue;
        if (grund === 'beschaeftigt' && ++beschaeftigt < 150) { await schlaf(this.analyseWarteMs); continue; }
        if (grund !== 'ki_gestoppt') this.ctx.log({ typ: 'analyse_ankunft_abgelehnt', sha, clip_id: w.clip_id, grund, fehler: (e as Error)?.message });
        return grund ?? 'fehler';
      }
    }
  }

  umkehr(art: 'undo' | 'redo', d: Koerper, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      const o = this.brauchOffen();
      this.riegel(quelle);
      this.pruefeRev(o, d.rev);
      const ziel = art === 'undo' ? o.verlauf.naechstesUndo() : o.verlauf.naechstesRedo();
      let probe: Projekt;
      try { probe = wende(o.projekt, art === 'undo' ? ziel.zurueck : ziel.vor); } catch (e) {
        if (e instanceof PatchFehler) throw new ProjFehler(409, 'verlauf_inkonsistent', { detail: e.message });   // R2: deutsche Meldung nur als detail
        throw e;
      }
      setzeDekodiert(probe, (sha) => this.zustandVon(sha));
      if (probe.tempo_bpm !== o.projekt.tempo_bpm && this.lage.deckLaeuft()) throw new ProjFehler(409, 'deck_laeuft');
      const vergleich = vergleiche(o.projekt, probe);
      this.pruefeSperre(o.projekt, probe, vergleich.betrifft_wiedergabe);
      const f = art === 'undo' ? rueckgaengig : wiederholen;
      // Spec 6.31 (Leistung): die Probe ist der Stand; der Verlauf wendet den Patch nicht noch einmal an (gültig wie in aendern, über die rev-Prüfung)
      const projekt = o.projekt;
      return this.vollziehe(o, quelle, vergleich.regler_aenderungen, (h) => f(o.verlauf, projekt, { quelle }, h, { ziel, stand: probe, vergleich }), new Map(),
        vergleich.betrifft_wiedergabe);
    });
  }

  // Regler zuerst (Quittungen abwarten), dann speichern. Spec 3.4: Ablehnung eines /k/teil setzt die Änderung zurück.
  // Spec 6.30 (Leistung): betrifft die Änderung die Wiedergabe, entsteht diese vor dem Speichern (im Haken speichere), und die EINE Speicherung
  // trägt ihre Nummer schon als wiedergabe_rev. Vorher speicherte ladeWiedergabe den Stand gleich danach ein zweites Mal.
  private async vollziehe(o: Offen, quelle: Quelle, regler: Soll[], schreibe: (h: Haken) => Wirkung, quellen: Map<string, string>,
    betrifftWiedergabe: boolean): Promise<Antwort> {
    const alt = o.projekt;
    const gesetzt = await this.kern.setzeRegler(regler, quelle);
    const zurueck = (stand: Projekt): Promise<void> => this.reglerZurueck(stand, gesetzt, quelle);
    // Spec 6.30: nach dem await die rev noch einmal gegen den offenen Stand. S3 setzt ihn über uebernimm() synchron, auch während diese
    // Änderung auf ihre Quittungen wartet; geprüft wurde sie gegen alt. Ihre Regler gehen dann auf den offenen Stand zurück.
    if (this.offen !== o || o.projekt !== alt || o.projekt.rev !== alt.rev) {
      await zurueck(o.projekt);
      if (this.offen !== o) throw new ProjFehler(409, 'kein_projekt');
      throw new ProjFehler(409, 'rev_veraltet', { rev: o.projekt.rev });
    }
    // Spec 6.30: nur eine echte Ablehnung dreht zurück. Ohne Kern (Quittung null) gilt die Änderung wie eine Noten-Änderung (kern.regler: kein_kern).
    const abgelehnt = gesetzt.filter((r) => quittungAbgelehnt(r.quittung));
    if (abgelehnt.length) {
      await zurueck(alt);
      throw new ProjFehler(409, 'regler_abgelehnt', { regler: abgelehnt });
    }
    // Haken-Vertrag mit verlauf.ts (speichereDannProtokolliere, Spec 6.31 festgehalten): speichere wird genau einmal mit dem NEUEN Stand gerufen, vor
    // dem Log-Eintrag; nur wenn das Log scheitert, folgt ein zweiter Aufruf mit dem alten Stand (zurückschreiben). vollziehe hängt an genau dieser
    // Reihenfolge: nur der erste Aufruf fordert Dekodieren an, gleicht dekodiert ab und schreibt die Wiedergabe (bereiteWiedergabe prüft die
    // Freeze-Sperre), damit die eine Speicherung die neue wiedergabe_rev trägt. Ruft verlauf.ts speichere anders (öfter, später, mit einem anderen
    // Stand zuerst), entstünde die Wiedergabe zum falschen Stand; Tests: proj_fix_b4_speichern, projekt_verlauf.
    const vorab: { wiedergabe: Record<string, unknown> | null; erster: boolean; vorhoeren: Map<string, string> | null } =
      { wiedergabe: null, erster: true, vorhoeren: null };
    const haken: Haken = { ...this.haken(o), speichere: (p) => {
      if (vorab.erster) {
        vorab.erster = false;
        for (const [sha, pfad] of quellen) {
          try { this.cache.fordereAn(sha, pfad); } catch (e) { this.ctx.log({ typ: 'proj_dekodier_fehler', sha, fehler: (e as Error).message }); }
        }
        const dekodiertAnders = this.betrifftWiedergabe(p, this.gleicheDekodiertAb(p, false));
        // 1.14: a gone track or take ends its audition and the map change always reloads. The map itself changes only after the entry is logged.
        vorab.vorhoeren = this.gueltigeVorhoeren(o, p);
        if (betrifftWiedergabe || dekodiertAnders || vorab.vorhoeren.size !== o.vorhoeren.size) {
          vorab.wiedergabe = this.bereiteWiedergabe(o, p, vorab.vorhoeren);
        }
      }
      this.projekte.speichere(o.slug, p);
    } };
    let w: Wirkung;
    try { w = schreibe(haken); } catch (e) { await zurueck(alt); throw e; }
    if (!w.eintrag) return { code: 200, j: { rev: alt.rev, projekt: alt } };
    const neu = w.projekt;
    const wiedergabe = vorab.wiedergabe;
    if (typeof wiedergabe?.nr !== 'number') neu.wiedergabe_rev = alt.wiedergabe_rev;   // ohne neue Wiedergabe gilt die alte Nummer
    o.projekt = neu;
    if (vorab.vorhoeren) this.setzeVorhoeren(o, vorab.vorhoeren);
    void this.surge.gleiche(neu);                                          // 1.9 U5: command, undo and redo (no await: the hosts answer in their own time)
    const kern: Record<string, unknown> = {};
    if (gesetzt.length) kern.regler = gesetzt.some((r) => r.quittung === null) ? 'kein_kern' : 'ok';
    // Spec 6.30: die Freeze-Sperre gilt bis zum Laden. bereiteWiedergabe prüfte sie nach den Regler-Quittungen, zwischen dort und /k/arr/laden liegt
    // kein await. War sie gesetzt, bleibt die Änderung gespeichert und das Laden folgt nach der Freigabe.
    const nr = wiedergabe?.nr;
    const ladeNr = typeof wiedergabe?.laden === 'number' ? wiedergabe.laden : nr;   // 1.14: the audition file when one is on
    if (wiedergabe) kern.wiedergabe = typeof nr === 'number' ? { nr: ladeNr, quittung: await this.kern.laden(ladeNr as number, quelle) } : wiedergabe;
    // Spec 6.31: Loop und Tempo sperrt 6.23 wie das Laden. Kam die Änderung vor der Sperre durch die Prüfung, werden sie gemerkt und nach der
    // Freigabe gesendet (holeNach, mit dem Stand von dann). Das Metronom sperrt 6.23 nicht.
    if (kanonisch(alt.loop) !== kanonisch(neu.loop)) {
      if (this.sperren > 0) { o.merk.loop = true; kern.loop = { aufgeschoben: true }; } else kern.loop = await this.kern.loop(neu, quelle);
    }
    if (kanonisch(alt.metronom) !== kanonisch(neu.metronom)) kern.metronom = await this.kern.metronom(neu, quelle);
    if (alt.tempo_bpm !== neu.tempo_bpm) {                                                               // Spec 2.7: ein Tempo-Weg
      if (this.sperren > 0) { o.merk.tempo = true; kern.tempo = { aufgeschoben: true }; } else kern.tempo = await this.kern.tempo(neu.tempo_bpm, quelle);
    }
    this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: neu.rev, label: w.eintrag.label, quelle } });
    return { code: 200, j: { rev: neu.rev, projekt: neu, kern } };
  }
  // Angenommene Regler einer abgelehnten Änderung auf den alten Stand zurück.
  private async reglerZurueck(alt: Projekt, ergebnis: ReglerErgebnis[], quelle: Quelle): Promise<void> {
    const vorher = new Map(alleRegler(alt).map((r) => [r.pfad, r.wert] as const));
    const zurueck = ergebnis.filter((r) => r.ok && vorher.has(r.pfad)).map((r) => ({ pfad: r.pfad, wert: vorher.get(r.pfad) as number }));
    if (zurueck.length) await this.kern.setzeRegler(zurueck, quelle);
  }

  // --- Transport (Spec 2.2, 2.7) -----------------------------------------------------------------------------------------
  transport(d: Koerper, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      const o = this.brauchOffen();
      this.riegel(quelle);
      if (d.aktion === 'stopp') {
        // Spec 6.37 (Andreas 16.10.: „Cypher stoppt nur einen Transport, den sie selbst gestartet hat“): Cyphers Stopp über Andreas' Lauf wird
        // abgelehnt, nichts gestoppt. Andreas' Stopp stoppt immer. Ohne Lauf (status 0) geht Cyphers Stopp durch, er ist ohne Wirkung.
        if (this.fremderLauf(quelle)) {
          throw new ProjFehler(409, 'transport_laeuft', { text: 'a transport Andreas started is running; Cypher stops only a transport she started' });
        }
        const q = await this.kern.stopp(quelle);
        if (quittungOk(q)) this.transportQuelle = null;
        return { code: 200, j: { ok: quittungOk(q), quittung: q } };
      }
      if (d.aktion !== 'start') throw new ProjFehler(400, 'aktion_unbekannt');
      const beat = d.beat === undefined ? 0 : d.beat;
      if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0 || beat > MAX_BEAT) throw new ProjFehler(400, 'beat_ungueltig');
      // Spec 6.37 Nachtrag (Re-Review Fix7 RR7-2, rr7 T_start: der Kern beendet beim Start einen laufenden Lauf, kern_arr.cpp:97, und Cypher wurde
      // Starterin; ihr Stopp ging danach durch): Cyphers Start über Andreas' Lauf (oder einen unbekannten) wird abgelehnt, nichts gesendet. Geprüft
      // vor der Tempo-Rampe und noch einmal unmittelbar vor /k/arr/start (Andreas kann während der Rampe am Gerät starten).
      this.sperreFremderStart(quelle);
      this.sperreTransport();                                            // Spec 6.32: vor der Tempo-Rampe
      const tempo = await this.tempoVorStart(o.projekt.tempo_bpm, quelle);
      // Paket 1.18, E-a (Entscheidung von Cypher 2026-10-20, Andreas kann umstellen): fällt Stop Cypher in die Wartezeit auf die Tempo-Rampe, beendet der Kern
      // Cyphers Rampe mit 7 ki_stopp. Dann dieselbe Antwort wie beim verworfenen wartenden Start (200, ok false, 7 ki_stopp) statt 409 tempo_abgelehnt; es ging
      // kein Start hinaus, und transportQuelle ist unberührt.
      const tq = tempo.quittung as { status?: number; grund?: string } | null | undefined;
      if (tempo.fehler === 'tempo_abgelehnt' && tq?.status === 7 && tq.grund === 'ki_stopp') return { code: 200, j: { ok: false, quittung: tq, tempo } };
      if (tempo.fehler) throw new ProjFehler(tempo.fehler === 'kein_kern' ? 503 : 409, tempo.fehler as string, { tempo });
      // Review 9a: fiel Stop Cypher in die schon laufende Rampe, geht Cyphers Start nicht mehr hinaus (dieselbe Antwort, kein 6 ki_gestoppt vom Kern)
      if (quelle === 'cypher' && this.ctx.kiGestoppt()) {
        const quittung = { status: 7, grund: 'ki_stopp', text: 'Stop Cypher was pressed; the start was dropped and nothing was started' };
        return { code: 200, j: { ok: false, quittung, tempo } };
      }
      this.sperreFremderStart(quelle);
      this.sperreTransport();                                            // und unmittelbar vor /k/arr/start (die Sperre kann während der Rampe kommen)
      const quant = this.lage.djLaeuft() ? 2 : 0;
      // Spec 6.37 (D1 S3 Auftrag 17 b, Re-Review Fix8 Probe K, am Stapel gemessen: mit quant 2 kam die Quittung erst 1,87 s nach dem Absenden, bis
      // dahin galt der Lauf noch als Cyphers, und ein Stop Cypher in diesem Fenster stoppte Andreas' Lauf): der Start gehört ab dem Absenden dem,
      // der ihn sendet (der Kern beendet beim Start den laufenden Lauf, kern_arr.cpp:97). Lehnt der Kern ab oder antwortet nicht, gilt wieder der
      // vorige, sofern nichts anderes (Hand-Taste, KI-Stopp, Stopp) inzwischen entschieden hat.
      const vorher = this.transportQuelle;
      this.transportQuelle = quelle;
      const q = await this.kern.start(beat, quant, quelle);
      if (!quittungOk(q) && this.transportQuelle === quelle) this.transportQuelle = vorher;
      return { code: 200, j: { ok: quittungOk(q), quittung: q, quant, start_beat: beat, tempo } };
    });
  }
  // Spec 6.37 Nachtrag: Cyphers Start, solange ein Transport läuft oder wartet, den sie nicht selbst gestartet hat (fremderLauf)
  private sperreFremderStart(quelle: Quelle): void {
    if (!this.fremderLauf(quelle)) return;
    throw new ProjFehler(409, 'transport_laeuft', {
      text: 'a transport Andreas started is running; Cypher starts the transport only when none of his is running',
    });
  }
  // Spec 6.32: ein Freeze ist ein Transport-Lauf; Start und Tempo-Rampe brechen ihn ab oder verändern die Datei. Stopp bleibt erlaubt.
  private sperreTransport(): void {
    if (this.sperren > this.sperrenAufnahme) throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; transport start waits until it is done' });
  }
  // Spec 6.32: für POST /tempo des Seiten-Servers (Studio-Route und Werkzeug tempo): läuft gerade eine Freeze-Sperre?
  ladenGesperrt(): boolean { return this.sperren > 0; }
  // Spec 2.7: Projekttempo beim Start setzen, wenn das Master-Tempo abweicht und kein Deck läuft; der Start wartet das Rampen-Ende ab.
  // Spec 6.30: läuft /uhr uhrStillMs lang nicht weiter (kein Kern), bricht das Warten mit kein_kern ab, statt die Kette zu halten.
  private async tempoVorStart(ziel: number, quelle: Quelle): Promise<Record<string, unknown>> {
    const u = this.lage.uhr;
    if (!u || Math.abs(u.bpm - ziel) < 0.005) return { gesetzt: false };
    if (this.lage.deckLaeuft()) return { gesetzt: false, grund: 'deck_laeuft', text: grundText('deck_laeuft'), master_bpm: u.bpm };
    const r = await this.kern.tempo(ziel, quelle);
    if (!r || !quittungOk(r.quittung)) return { gesetzt: false, fehler: 'tempo_abgelehnt', text: grundText('tempo_abgelehnt'), quittung: r?.quittung ?? null };
    const ende = r.ab_beat + r.dauer_beats, t0 = Date.now();
    let beat = this.lage.uhr?.beat ?? -Infinity, seit = t0;
    while (!(this.lage.uhr && this.lage.uhr.beat >= ende)) {
      if (quelle === 'cypher' && this.ctx.kiGestoppt()) break;          // Stop Cypher: nicht bis zum Rampenende warten, die Start-Route verwirft
      const jetzt = Date.now(), b = this.lage.uhr?.beat ?? -Infinity;
      if (b > beat) { beat = b; seit = jetzt; } else if (jetzt - seit > this.uhrStillMs) {
        return { gesetzt: true, fehler: 'kein_kern', text: grundText('kein_kern'), ab_beat: r.ab_beat };
      }
      if (jetzt - t0 > this.rampeWarteMs) return { gesetzt: true, fehler: 'rampe_haengt', text: grundText('rampe_haengt'), ab_beat: r.ab_beat };
      await schlaf(20);
    }
    return { gesetzt: true, ziel_bpm: r.ziel_bpm, ab_beat: r.ab_beat };
  }

  // --- Sperre (P4, Spec 6.23) und Zugang für S3 (P5) ---------------------------------------------------------------------------------------
  // Während eines Freeze lädt der Server nicht neu: jedes Laden bricht den Echtzeit-Durchlauf im Kern ab. Gesperrt sind Änderungen, die die
  // Wiedergabe berühren (Noten, Clips, Spuren anlegen, löschen, verschieben, Gerät, Tempo, Loop); Mixer (Regler) bleibt frei.
  // Spec 6.32: solange ein Öffnen oder Anlegen läuft, 409 beschaeftigt (wer zuerst kommt, gewinnt; S3 startet den Freeze dann nicht).
  sperreLaden(fuer?: 'aufnahme'): () => void {
    if (this.oeffnet > 0) throw new ProjFehler(409, 'beschaeftigt', { text: 'a project is being opened; a freeze waits until it is open' });
    // Aufnahme und Freeze fahren beide den Transport: wer zuerst kommt, gewinnt (Nachbesserung 1, B1)
    // zwei getrennte Abfragen mit je einem Text-Literal: ein Ternär mit 'aufnahme' in der Bedingung hält tests/proj_gruende_text.test.mjs für
    // einen Text aus einer Variablen (Probelauf, N9)
    if (fuer === 'aufnahme' && this.sperren > 0) {
      throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze, an export or another recording holds the lock; a recording waits until it is done' });
    }
    if (fuer !== 'aufnahme' && this.sperrenAufnahme > 0) {
      throw new ProjFehler(409, 'beschaeftigt', { text: 'a recording is running; a freeze waits until it is done' });
    }
    this.sperren += 1;
    if (fuer === 'aufnahme') this.sperrenAufnahme += 1;
    let frei = false;
    return () => {
      if (frei) return;
      frei = true;
      this.sperren -= 1;
      if (fuer === 'aufnahme') this.sperrenAufnahme -= 1;
      const o = this.offen;
      if (this.sperren > 0 || !o || !(o.merk.laden || o.merk.loop || o.merk.tempo)) return;
      // Spec 6.31: das Nachholen läuft in der Kette, also später. Ist das Projekt bis dahin geschlossen, verfällt es; setzt S3 inzwischen eine
      // neue Sperre (nächster Freeze), prüft holeNach sie direkt vor jedem Senden und lässt den Rest gemerkt bis zu deren Freigabe.
      void this.seriell(async () => { if (this.offen === o) await this.holeNach(o); })
        .catch((x) => this.ctx.log({ typ: 'proj_nachladen_fehler', fehler: (x as Error).message }));
    };
  }
  private async holeNach(o: Offen): Promise<void> {
    const ergebnis: Record<string, unknown> = {};
    if (o.merk.laden) {
      if (this.sperren > 0) return;
      ergebnis.wiedergabe = await this.ladeWiedergabe('andreas');
      o.merk.laden = false;                                              // erst nach dem gelungenen Laden: wirft es, bleibt es gemerkt (Fix3 G9)
    }
    if (o.merk.loop) {
      if (this.sperren > 0 || this.offen !== o) return;
      o.merk.loop = false;
      ergebnis.loop = await this.kern.loop(o.projekt, 'andreas');
    }
    if (o.merk.tempo) {
      if (this.sperren > 0 || this.offen !== o) return;
      o.merk.tempo = false;
      ergebnis.tempo = await this.kern.tempo(o.projekt.tempo_bpm, 'andreas');
    }
    this.ctx.log({ typ: 'proj_nachgeholt', slug: o.slug, ...ergebnis });
  }
  // Slice 3a (AK2): ein Marker hinter dem Ende der Quelle klingt nie (der Kern liest dort Stille, arr_stimmen.cpp:197) und ist ein Bedienfehler. Geprüft
  // wird nur, wo sich der letzte Marker eines Warps geändert hat (die früheren sind kleiner); die Dauer ist die des Katalogs, die für denselben Clip
  // schon Auto-Warp und Länge bestimmt.
  private pruefeMarkerInQuelle(alt: Projekt, neu: Projekt): void {
    if (!this.katalog) return;
    const vorher = new Map<string, number | undefined>();
    for (const s of alt.spuren) for (const c of s.clips) if (c.art === 'audio') vorher.set(c.id, c.warp?.marker[c.warp.marker.length - 1]?.[0]);
    for (const s of neu.spuren) for (const c of s.clips) {
      if (c.art !== 'audio' || !c.warp) continue;
      const letzter = c.warp.marker[c.warp.marker.length - 1][0];
      if (vorher.get(c.id) === letzter) continue;
      let dauer: number | null = null;
      try { dauer = this.katalog.eintrag(c.quelle.sha256)?.dauer_s ?? null; } catch { dauer = null; }
      if (dauer !== null && letzter > dauer + MARKER_TOLERANZ_S) {
        throw new ProjFehler(400, 'warp_marker', { text: `warp marker at ${letzter} s lies behind the end of the source (${dauer} s)`, clip_id: c.id });
      }
    }
  }
  private pruefeSperre(alt: Projekt, neu: Projekt, betrifftWiedergabe: boolean): void {
    if (this.sperren === 0) return;
    if (betrifftWiedergabe || alt.tempo_bpm !== neu.tempo_bpm || kanonisch(alt.loop) !== kanonisch(neu.loop)) {
      throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; changes to the playback wait until it is done' });
    }
  }
  // Laden, außer während der Sperre: dann merken und bei der letzten Freigabe nachholen
  private async ladeOderMerke(quelle: Quelle): Promise<Record<string, unknown>> {
    if (this.sperren > 0) { this.brauchOffen().merk.laden = true; return { nr: null, aufgeschoben: true }; }
    return this.ladeWiedergabe(quelle);
  }
  // --- 1.14 comping: audition (spec R8) -------------------------------------------------------------------------------------------------
  private meldeVorhoeren(o: Offen): void { this.ctx.verteile({ a: 'take_vorhoeren', f: { vorhoeren: Object.fromEntries(o.vorhoeren) } }); }
  // Empties the map (event only when it was not empty). No reload: the callers load the main playback themselves or the project goes away.
  private leereVorhoeren(o: Offen): boolean {
    if (o.vorhoeren.size === 0) return false;
    o.vorhoeren.clear();
    this.meldeVorhoeren(o);
    return true;
  }
  // The audition map without the entries whose track or take no longer exists in p (the state after a command, undo or redo).
  private gueltigeVorhoeren(o: Offen, p: Projekt): Map<string, string> {
    return new Map([...o.vorhoeren].filter(([spurId, takeId]) => p.spuren.find((s) => s.id === spurId)?.takes?.some((t) => t.id === takeId)));
  }
  // Replaces the map; one event when it changed.
  private setzeVorhoeren(o: Offen, neu: ReadonlyMap<string, string>): void {
    if (neu.size === o.vorhoeren.size && [...neu].every(([k, v]) => o.vorhoeren.get(k) === v)) return;
    o.vorhoeren = new Map(neu);
    this.meldeVorhoeren(o);
  }
  vorhoerenLage(): Antwort { return { code: 200, j: { vorhoeren: Object.fromEntries(this.offen?.vorhoeren ?? []) } }; }
  // POST /proj/take_vorhoeren {spur_id, take_id | null}: one take per track, several tracks at once. A change reloads the playback once.
  vorhoerenSetzen(d: Koerper, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      const o = this.brauchOffen();
      this.riegel(quelle);
      if (typeof d.spur_id !== 'string' || !(d.take_id === null || typeof d.take_id === 'string')) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: 'spur_id: a track id is required; take_id: a take id, or null to switch the audition off' });
      }
      if (this.aufnahmeLauf || this.sperrenAufnahme > 0) throw new ProjFehler(409, 'aufnahme_laeuft');
      const spur = sucheSpur(o.projekt, d.spur_id);
      if (!spur) throw new ProjFehler(404, 'spur_unbekannt');
      const vorher = new Map(o.vorhoeren), neu = new Map(o.vorhoeren);
      if (d.take_id === null) neu.delete(spur.id);
      else {
        if (!spur.takes?.some((t) => t.id === d.take_id)) throw new ProjFehler(404, 'take_unbekannt');
        neu.set(spur.id, d.take_id);
      }
      const antwort = (kern?: Record<string, unknown>): Antwort =>
        ({ code: 200, j: { vorhoeren: Object.fromEntries(o.vorhoeren), ...(kern ? { kern } : {}) } });
      if (neu.size === vorher.size && [...neu].every(([k, v]) => vorher.get(k) === v)) return antwort();
      // Under a lock (freeze, export) the load waits: the map stays set and the answer says so, like the other write paths
      if (this.sperren > 0) {
        this.setzeVorhoeren(o, neu); o.merk.laden = true;
        return antwort({ wiedergabe: { nr: null, aufgeschoben: true } });
      }
      let wiedergabe: Record<string, unknown>;
      try { wiedergabe = await this.ladeVorhoerenStand(o, neu, quelle); } catch (e) {
        if (e instanceof ProjFehler) throw e;
        this.ctx.log({ typ: 'proj_vorhoeren_laden_fehler', fehler: (e as Error).message });
        throw e;
      }
      this.setzeVorhoeren(o, neu);
      return antwort({ wiedergabe });
    });
  }
  // Loads the playback of the audition map `neu`: the audition file when it is not empty, else the main playback (its file, or a fresh one when that
  // is missing or stale). The map is not touched here. A refusal of the translator or of the core throws ProjFehler, so the caller keeps the old map:
  // the reason is the core's own (q.grund), 409 like every other refusal of the core (recording, regulators, tempo). No core (null) is not a refusal.
  private async ladeVorhoerenStand(o: Offen, neu: ReadonlyMap<string, string>, quelle: Quelle): Promise<Record<string, unknown>> {
    const rev = o.projekt.wiedergabe_rev;
    let nr: number;
    if (neu.size > 0) nr = this.schreibeVorhoerWiedergabe(o.projekt, neu, true) as number;
    else if (!o.merk.laden && rev > 0 && fs.existsSync(wiedergabeDatei(this.arbeitsordner, rev))) nr = rev;
    else {
      const w = await this.ladeWiedergabe(quelle, neu);
      if (typeof w.nr !== 'number') throw new ProjFehler(409, (w.fehler as string) ?? 'nicht_geladen', { detail: w.detail, kern: { wiedergabe: w } });
      if (quittungAbgelehnt(w.quittung as Quittung)) throw new ProjFehler(409, (w.quittung as Quittung).grund || 'nicht_geladen', { kern: { wiedergabe: w } });
      return w;
    }
    const quittung = await this.kern.laden(nr, quelle);
    if (quittungAbgelehnt(quittung)) throw new ProjFehler(409, quittung.grund || 'nicht_geladen', { kern: { wiedergabe: { nr, quittung } } });
    if (neu.size === 0) o.merk.laden = false;
    return { nr, quittung };
  }
  // For a caller that holds the load lock itself (recording start, freeze start): ends the audition and loads the main playback now, because the
  // transport or the freeze needs the core to play wiedergabe_rev. A second lock holder (a running freeze) defers the load to its release instead.
  beendeVorhoeren(): Promise<void> {
    return this.seriell(async () => {
      const o = this.offen;
      if (!o || !this.leereVorhoeren(o)) return;
      if (this.sperren > 1) { o.merk.laden = true; return; }
      await this.ladeWiedergabe('andreas');
    });
  }

  // Loop ebenso (Spec 6.31, 6.32): während der Sperre gemerkt, nach der Freigabe mit dem Stand von dann gesendet
  private async loopOderMerke(o: Offen, quelle: Quelle): Promise<unknown> {
    if (this.sperren > 0) { o.merk.loop = true; return { aufgeschoben: true }; }
    return this.kern.loop(o.projekt, quelle);
  }

  zugangOffen(): { slug: string; ordner: string; projekt: Projekt; verlauf: Verlauf } | null {
    const o = this.offen;
    return o ? { slug: o.slug, ordner: path.resolve(this.projekte.wurzelPfad, o.slug), projekt: o.projekt, verlauf: o.verlauf } : null;
  }
  zugangHaken(): Haken { return this.haken(this.brauchOffen()); }
  // Spec 6.34: S3 meldet Beginn (art, beim Freeze spur_id) und Ende (null) jedes Laufs; nur diese Form geht an die Seite
  setzeAufnahmeLauf(l: unknown): void { this.aufnahmeLauf = l; }
  setzeStemsStand(x: Record<string, unknown> | null): void { this.stemsStand = x; }
  private readonly schliessHaken: ((slug: string) => void)[] = [];   // Slice 6 (T7): Läufe, die zum offenen Projekt gehören
  beiSchliessen(f: (slug: string) => void): void { this.schliessHaken.push(f); }
  setzeAusgabeLauf(l: AusgabeLauf | null): void {
    this.ausgabeLauf = l === null ? null : l.art === 'freeze' ? { art: 'freeze', spur_id: l.spur_id } : { art: l.art };
  }
  // Spec 6.25: die nächste Nummer des einen Wiedergabe-Zählers der Instanz (derselbe wie für /k/arr/laden, mit Zustandsdatei, Spec 6.30), für die
  // Freeze-Kennung. Eine Kennung kommt so nie zweimal und nie gleich einer Wiedergabe-Nummer.
  naechsteNummer(): number { return this.zaehler.naechste(); }
  // Wiedergabe-Datei mit der nächsten Nummer des einen Zählers, ohne /k/arr/laden (Plan S3: Freeze, Export)
  schreibeWiedergabeFuer(p: Projekt): { nr: number; datei: string } {
    const nr = this.zaehler.naechste();
    const w = this.uebersetzeFuer(p, nr);
    return { nr, datei: schreibeWiedergabe(this.arbeitsordner, w) };
  }
  // Was /proj/aendern nach aendere() tut, für einen Schreiber außerhalb (S3): Stand synchron setzen, dann nachziehen. Die Freeze-Sperre lehnt hier
  // nichts ab (der Stand ist schon gesetzt), aber sie gilt für das Senden (Spec 6.32): unmittelbar vor Laden und Loop wird sie geprüft wie in holeNach;
  // gesperrt (auch die eigene des Aufrufers oder die des nächsten Freeze) bleibt beides am Offen gemerkt und folgt nach der letzten Freigabe.
  uebernimm(w: Wirkung, meta: Meta): Promise<void> {
    const o = this.brauchOffen();
    if (!w.eintrag) return Promise.resolve();
    const alt = o.projekt, neu = w.projekt, quelle = meta.quelle;
    neu.wiedergabe_rev = alt.wiedergabe_rev;
    o.projekt = neu;                                                     // synchron, vor dem ersten await
    void this.surge.gleiche(neu);
    return this.seriell(async () => {
      if (this.offen !== o) return;                                      // inzwischen geschlossen
      const regler = await this.kern.setzeRegler(w.regler_aenderungen, quelle);
      const abgelehnt = regler.filter((r) => quittungAbgelehnt(r.quittung)), keinKern = regler.filter((r) => r.quittung === null);   // Spec 6.31
      if (abgelehnt.length || keinKern.length) {
        this.ctx.log({ typ: 'proj_uebernimm_regler', slug: o.slug, abgelehnt: abgelehnt.map((r) => r.pfad), kein_kern: keinKern.map((r) => r.pfad) });
      }
      const dekodiertAnders = this.betrifftWiedergabe(neu, this.gleicheDekodiertAb(neu, false));
      if (w.betrifft_wiedergabe || dekodiertAnders) await this.ladeOderMerke(quelle);
      if (kanonisch(alt.loop) !== kanonisch(neu.loop)) await this.loopOderMerke(o, quelle);
      if (kanonisch(alt.metronom) !== kanonisch(neu.metronom)) await this.kern.metronom(neu, quelle);
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: neu.rev, label: w.eintrag.label, quelle } });
    });
  }
  // 1.9 U5: brings the hosts to the open project's Surge map and resolves when they answered (the freeze path waits for it). A missing host or an
  // error answer is logged, never thrown, and the entries stay pending; the errors come back as text so the freeze can refuse a sound that would not
  // match the map. Without an open project it only waits for the jobs already queued.
  async wirtSpiegel(): Promise<string[]> {
    const o = this.offen;
    if (o) return (await this.surge.gleiche(o.projekt)).fehler;
    await this.surge.fertig();
    return [];
  }
  // Projekttempo an den Master auf dem einen Tempo-Weg (Spec 2.7), zurück erst nach dem Rampen-Ende. deck_laeuft nur, wenn das Master-Tempo
  // abweicht UND ein Deck läuft.
  async tempoAnMaster(): Promise<void> {
    const o = this.brauchOffen();
    const t = await this.tempoVorStart(o.projekt.tempo_bpm, 'andreas');
    const grund = (t.fehler ?? t.grund) as string | undefined;
    if (grund) throw new ProjFehler(grund === 'kein_kern' ? 503 : 409, grund, { tempo: t });
  }

  // --- 1.12 slice 3 (task 4): overridden lanes ---------------------------------------------------------------------------
  // AK34: the release of every override; a refusal, no core or an error is logged, never thrown (open must not fail because of it)
  // The regulator groups ("spur/", "grp/", ...) the writes touch, as prefixes for /k/hand/frei; source andreas like the rest of the housekeeping
  private async handFreiMitLog(soll: readonly Soll[], quelle: Quelle): Promise<void> {
    // Exactly what the switch writes: spur/, grp/, ret/ as prefixes, one erz channel (erz/4/, never erz/ whole: instruments and pads stay), else the path
    const teil = (p: string): string => {
      const s = p.split('/');
      return ['spur', 'grp', 'ret'].includes(s[0]) ? `${s[0]}/` : s[0] === 'erz' ? `erz/${s[1]}/` : p;
    };
    // ins/* and rack/* rows are project-only (POST /regler answers 409 ueber_projekt), the hand never holds them: 231 single paths would overflow the list
    const pfade = [...new Set(soll.filter((r) => !r.pfad.startsWith('ins/') && !r.pfad.startsWith('rack/')).map((r) => teil(r.pfad)))].join(',');
    if (!pfade) return;
    try {
      const q = await this.kern.handFrei(pfade, quelle);
      if (q === null) this.ctx.log({ typ: 'proj_hand_frei_ohne_quittung', pfade });
      else if (quittungAbgelehnt(q)) this.ctx.log({ typ: 'proj_hand_frei_fehler', quittung: q });
    } catch (e) { this.ctx.log({ typ: 'proj_hand_frei_fehler', fehler: (e as Error).message }); }
  }
  private async autoFreiMitLog(): Promise<void> {
    try {
      const q = await this.kern.autoFrei();
      if (q === null || quittungAbgelehnt(q)) this.ctx.log({ typ: 'proj_auto_frei_fehler', quittung: q });
    } catch (e) { this.ctx.log({ typ: 'proj_auto_frei_fehler', fehler: (e as Error).message }); }
  }
  private istUebersteuert(spurId: string, ziel: string): boolean { return this.uebersteuert.get(spurId)?.ziele.has(ziel) === true; }
  // The overridden fields of tracks that still exist, in track order: [{spur_id, ziel}] (stale entries of deleted tracks are not shown)
  private uebersteuertListe(p: Projekt): { spur_id: string; ziel: string }[] {
    const liste: { spur_id: string; ziel: string }[] = [];
    for (const s of p.spuren) for (const z of KERN_AUTO_ZIELE) if (this.istUebersteuert(s.id, z)) liste.push({ spur_id: s.id, ziel: z });
    return liste;
  }
  // Track numbers are reused (a new track takes the lowest free nr): an entry that remembers a number now held by ANOTHER track is the mark of a
  // deleted track and is dropped, so an undo of the delete cannot bring it back. Called before the mirror is read or fed.
  private raeumeNummern(p: Projekt | undefined): void {
    if (!p || !this.uebersteuert.size) return;
    for (const [id, e] of this.uebersteuert) if (p.spuren.some((x) => x.nr === e.nr && x.id !== id)) this.uebersteuert.delete(id);
  }
  // /e/auto spur(1..32 = track number nr), ziel, zustand: idempotent (the core repeats the full state after an event overflow)
  private nimmAuto(f: Record<string, unknown>): void {
    const nr = Number(f.spur), ziel = String(f.ziel), an = Number(f.zustand) === 1;
    if (!istKernAutoZiel(ziel)) return;
    this.raeumeNummern(this.offen?.projekt);
    const s = this.offen?.projekt.spuren.find((x) => x.nr === nr);
    // the id of the track with this number: from the project, or (a deleted track) from the mirror entry that remembered it
    const id = s?.id ?? [...this.uebersteuert].find(([, e]) => e.nr === nr)?.[0];
    if (id === undefined) return;                                            // no such track and nothing remembered: nothing to mirror
    const e = this.uebersteuert.get(id) ?? { nr, ziele: new Set<string>() };
    if (an) { if (!s) return; e.ziele.add(ziel); } else e.ziele.delete(ziel);   // a mark is only set for a track that exists
    if (e.ziele.size) this.uebersteuert.set(id, e); else this.uebersteuert.delete(id);
  }
  private autoZiel(d: Koerper): string {
    if (!istKernAutoZiel(d.ziel)) throw new ProjFehler(400, 'auto_ziel_unbekannt');
    return d.ziel;
  }
  private autoSpur(d: Koerper): Spur {
    if (typeof d.spur_id !== 'string') throw new ProjFehler(400, 'argument_ungueltig', { text: 'spur_id: a track id is required' });
    const s = sucheSpur(this.brauchOffen().projekt, d.spur_id);
    if (!s) throw new ProjFehler(404, 'spur_unbekannt');
    return s;
  }
  // The core's answer to a /k/arr/auto: a refusal becomes an error (nur_andreas for Cypher's override, D9), no core is 503. The mirror is not
  // touched here: it follows /e/auto only (D5: while the transport stops, `an 0` is acknowledged and nothing changes).
  private autoAntwort(q: Quittung, extra: Record<string, unknown>): Antwort {
    if (q === null) throw new ProjFehler(503, 'kein_kern');
    if (quittungAbgelehnt(q)) { const [code, fehler] = autoAblehnung(q.grund); throw new ProjFehler(code, fehler, { kern: q }); }
    return { code: 200, j: { ok: true, quittung: q, ...extra } };
  }
  // D4: the page (pointerdown, keydown on a range) asks for the override of one field of one track; `an 0` goes to the core with the real source
  async autoUebersteuern(d: Koerper, quelle: Quelle): Promise<Antwort> {
    this.riegel(quelle);
    const s = this.autoSpur(d), ziel = this.autoZiel(d);
    return this.autoAntwort(await this.kern.auto(s.nr, ziel, 0, quelle), { spur_id: s.id, ziel });
  }
  // `{alle: true}` gives every lane back (spur 0), `{spur_id, ziel}` one; allowed for both sources
  async autoReEnable(d: Koerper, quelle: Quelle): Promise<Antwort> {
    this.riegel(quelle);
    if (d.alle === true) return this.autoAntwort(await this.kern.auto(0, 'fader', 1, quelle), { alle: true });
    if (d.alle !== undefined && d.alle !== false) throw new ProjFehler(400, 'argument_ungueltig', { text: 'alle: true, or spur_id and ziel' });
    const s = this.autoSpur(d), ziel = this.autoZiel(d);
    return this.autoAntwort(await this.kern.auto(s.nr, ziel, 1, quelle), { spur_id: s.id, ziel });
  }

  // --- 1.12 slice 3 (task 8): arm and takes -------------------------------------------------------------------------------
  private async armFreiMitLog(): Promise<void> {
    try {
      const q = await this.kern.armFrei();
      if (q === null || quittungAbgelehnt(q)) this.ctx.log({ typ: 'proj_arm_frei_fehler', quittung: q });
    } catch (e) { this.ctx.log({ typ: 'proj_arm_frei_fehler', fehler: (e as Error).message }); }
  }
  // D16: one aendern with the label `Record ...` (one undo step); rev_veraltet is read again, the rest is thrown to the collector
  private async schreibeTake(label: string, befehle: Record<string, unknown>[], kennung: Offen): Promise<void> {
    for (let versuch = 0; ; versuch++) {
      if (this.offen !== kennung) throw new ProjFehler(409, 'projekt_gewechselt');
      try { await this.aendern({ rev: kennung.projekt.rev, label, befehle }, 'andreas', kennung); return; } catch (e) {
        if ((e as { grund?: string }).grund === 'rev_veraltet' && versuch < 4) continue;
        throw e;
      }
    }
  }
  private armAnsicht(): { modus: string; spuren: string[] } { return this.aufAuto.ansicht(); }
  private armMelden(): void { this.ctx.verteile({ a: 'proj', f: { auto_arm: this.armAnsicht() } }); }
  // POST /proj/auto/arm. {spur_id, an: true|false, modus?}: arm or disarm one track; {alle: true}: disarm all; {modus} alone: switch the mode and send the
  // arm again for every armed track (D11). Only Andreas arms: the core refuses the source cypher with nur_andreas (D9 style); the AI stop comes first.
  // The arm calls run one at a time (their own chain): two overlapping calls would interleave their core calls and leave core and server different.
  autoArm(d: Koerper, quelle: Quelle): Promise<Antwort> {
    const p = this.armKette.then(() => this.autoArmEins(d, quelle));
    this.armKette = p.then(() => undefined, () => undefined);
    return p;
  }
  private async autoArmEins(d: Koerper, quelle: Quelle): Promise<Antwort> {
    this.riegel(quelle);
    // D9: only Andreas arms. Refused here, before any state changes, for every body form (the core refuses the source too)
    if (quelle !== 'andreas') throw new ProjFehler(403, 'nur_andreas');
    const m = d.modus === undefined ? null : modusVon(d.modus);
    if (d.modus !== undefined && m === null) throw new ProjFehler(400, 'argument_ungueltig', { text: 'modus: touch, latch, write (or 0, 1, 2) expected' });
    const alt = this.aufAuto.modusNr(), modus = m ?? alt;
    const offen = this.offen;                                       // the project this call means; checked again after every wait for the core
    const q0: Quittung[] = [];
    const pruefe = (q: Quittung): void => {
      if (q === null) throw new ProjFehler(503, 'kein_kern');
      if (quittungAbgelehnt(q)) { const [code, fehler] = autoAblehnung(q.grund); throw new ProjFehler(code, fehler, { kern: q }); }
      q0.push(q);
    };
    const gleich = (): void => {
      if (this.offen === offen) return;
      void this.armFreiMitLog();                                    // the open ended every arm; a late acknowledgement must not leave one behind
      throw new ProjFehler(409, 'projekt_gewechselt');
    };
    if (d.alle === true) {
      pruefe(await this.kern.arm(0, 0, modus, quelle));
      gleich();
      this.aufAuto.alleFrei();
    } else if (d.spur_id !== undefined || m !== null) {
      // the steps: the named track (arm or disarm), and with a mode every other armed track again in the new mode. Each step remembers the state
      // before it, so a failure halfway rolls the steps already done back; if that fails too, everything is disarmed in core and session (equal)
      const schritte: { nr: number; an: boolean; id: string; vorher: { an: boolean; modus: Modus } }[] = [];
      let ziel: { id: string; nr: number; an: boolean } | null = null;
      if (d.spur_id !== undefined) {
        const s = this.autoSpur(d), an = d.an !== false;
        if (typeof d.an !== 'boolean' && d.an !== undefined) throw new ProjFehler(400, 'argument_ungueltig', { text: 'an: true or false expected' });
        ziel = { id: s.id, nr: s.nr, an };
        schritte.push({ nr: s.nr, an, id: s.id, vorher: { an: this.aufAuto.armiert(s.id), modus: alt } });
      }
      // a mode alone re-sends the arm of every armed track even if the mode did not change (a resync); with a named track only a change does
      if (m !== null && (m !== alt || d.spur_id === undefined)) {
        for (const a of this.aufAuto.armiertListe()) if (a.id !== ziel?.id) schritte.push({ nr: a.nr, an: true, id: a.id, vorher: { an: true, modus: alt } });
      }
      const getan: typeof schritte = [];
      try {
        for (const x of schritte) {
          const q = await this.kern.arm(x.nr, x.an ? 1 : 0, modus, quelle);
          if (q === null) getan.push(x);      // no acknowledgement: the outcome is unknown, so the step is rolled back too
          pruefe(q);
          if (q !== null) getan.push(x);
          gleich();
        }
      } catch (e) {
        if ((e as { grund?: string }).grund !== 'projekt_gewechselt') await this.armZurueck(getan);
        throw e;
      }
      if (m !== null) this.aufAuto.setzeModus(m);   // the mode changes only after the core acknowledged
      if (ziel) this.aufAuto.armiereNur(ziel.id, ziel.nr, ziel.an);
    } else throw new ProjFehler(400, 'argument_ungueltig', { text: 'spur_id and an, or alle: true, or modus' });
    this.armMelden();
    return { code: 200, j: { ok: true, quittung: q0.at(-1) ?? null, auto_arm: this.armAnsicht() } };
  }
  // Roll the arm calls already acknowledged back to the state before them (the server never changed). A rollback the core refuses leaves core and
  // server different, so then everything is disarmed on both sides: unequal states are the one result this must not give.
  private async armZurueck(getan: { nr: number; an: boolean; vorher: { an: boolean; modus: Modus } }[]): Promise<void> {
    try {
      for (const x of [...getan].reverse()) {
        const q = await this.kern.arm(x.nr, x.vorher.an ? 1 : 0, x.vorher.modus, 'andreas');
        if (q === null || quittungAbgelehnt(q)) throw new Error('rollback refused');
      }
    } catch (e) {
      this.ctx.log({ typ: 'proj_arm_zurueck_fehler', fehler: (e as Error).message });
      await this.armFreiMitLog();
      this.aufAuto.alleFrei();
      this.armMelden();
    }
  }
  // POST /proj/auto/geste: a mouse or keyboard value of one field of an armed track while the transport plays (D12 mouse time base).
  // {spur_id, ziel, wert?, ende?: true, quelle?: "maus"|"tasten"}. ende closes the gesture (pointerup, pointercancel, lostpointercapture, window blur).
  autoGeste(d: Koerper, quelle: Quelle): Antwort {
    this.riegel(quelle);
    if (quelle !== 'andreas') throw new ProjFehler(403, 'nur_andreas');
    const s = this.autoSpur(d);
    if (!(AUFNAHME_ZIELE as readonly unknown[]).includes(d.ziel)) throw new ProjFehler(400, 'auto_ziel_unbekannt');
    if (d.wert !== undefined && (typeof d.wert !== 'number' || !Number.isFinite(d.wert))) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'wert: a number expected' });
    }
    if (d.wert !== undefined && !wertImBereich(d.ziel as Ziel, d.wert)) {            // the range of a lane value (one rule: modell.ts), refused at the entry
      throw new ProjFehler(400, 'argument_ungueltig', { text: `wert: ${d.ziel} is out of range` });
    }
    if (d.wert === undefined && d.ende !== true) throw new ProjFehler(400, 'argument_ungueltig', { text: 'wert, or ende: true' });
    if (d.quelle !== undefined && d.quelle !== 'maus' && d.quelle !== 'tasten') {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'quelle: maus or tasten' });
    }
    const wert = d.wert === undefined ? null : Number(d.wert);
    const r = this.aufAuto.mausPunkt(s.id, d.ziel as AufnahmeZiel, wert, d.ende === true, d.quelle === 'tasten' ? 'tasten' : 'maus');
    return { code: 200, j: { ok: true, aufgenommen: r.aufgenommen, beat: r.beat } };
  }

  // --- Kern-Ereignisse (Haken ereignis, Spec 2.10) ---------------------------------------------------------------------
  ereignis(adresse: string, f: Record<string, unknown>): void {
    const vorherGeneration = this.lage.generation;
    this.aufAuto.raeume();                       // a deleted track does not stay armed
    const { neustart } = this.lage.nimm(adresse, f);
    // 1.12 slice 3 (D6/D8): a new core generation clears the mirror (the new core overrides nothing); the first /k/willkommen since this server
    // started ends any override of a core that kept running (AK34, own start). A re-hello of the same generation changes nothing.
    if (adresse === '/e/auto') this.nimmAuto(f);
    if (neustart || (adresse === '/k/willkommen' && vorherGeneration !== null && Number(f.generation) !== vorherGeneration)) {
      this.uebersteuert.clear();
      if (this.aufAuto.istArm()) this.ctx.verteile({ a: 'proj', f: { auto_arm: { modus: 'touch', spuren: [] } } });   // D11: the new core starts unarmed
      this.aufAuto.verwirf(); this.basisWartend.clear();
    }
    if (adresse === '/k/willkommen' && vorherGeneration === null) {
      void this.autoFreiMitLog();
      void this.armFreiMitLog();   // AK34 / D6: a core that kept running over a server restart is disarmed
    }
    // 1.12 slice 3 (task 8): the take collector. /zustand/arr (start, seam, stop), the hand points, the release of the hand
    if (adresse === '/zustand/arr') this.aufAuto.zustand(f);
    if (adresse === '/e/auto_punkt') this.aufAuto.handPunkt(f);
    if (adresse === '/e/regler' && f.halter !== 'mensch') this.aufAuto.reglerFrei(String(f.pfad));
    if (adresse === '/e/regler' && this.basisWartend.size) {
      const w = this.basisWartend.get(String(f.pfad));
      if (f.halter === 'mensch') this.basisWartend.delete(String(f.pfad));            // the hand moved it again: its value is the truth now
      else if (w) { this.basisWartend.delete(String(f.pfad)); void this.basisSenden([w]).catch(() => undefined); }   // released: the base value can go
    }
    // D10: an armed track that plays keeps the hand value for the take, not for the project base value
    if (adresse === '/e/regler' && f.halter === 'mensch' && istMixerRegler(String(f.pfad)) && !this.aufAuto.unterdrueckt(String(f.pfad))) {
      this.rueckweg(String(f.pfad), Number(f.wert));
    }
    // /zustand/arr status 0 setzt transportQuelle bewusst nicht zurück; ein neuer Start überschreibt die Quelle.
    // Spec 6.37 (REVIEW-5-opus M2): die Hand-Taste am Gerät führt der Kern selbst aus (kern_arr.cpp arr_hand_start_stopp) und meldet danach
    // /e/hand arr/start_stopp mit wert 1 (nur beim Druck; die Attrappe meldet auch das Loslassen mit 0). Ein Start oder Stopp dort gehört
    // Andreas: Cypher bedient ihn danach nicht (fremderLauf), bis Andreas stoppt und Cypher selbst wieder startet.
    if (adresse === '/e/hand' && f.pfad === 'arr/start_stopp' && Number(f.wert) >= 0.5) this.transportQuelle = 'andreas';
    // Entscheidung E-a (Andreas 2026-10-20: „stop cypher sollte nicht alles stoppen weil ich ja übernehme, du solltest dann nur nicht mehr eingreifen“):
    // Stop Cypher stoppt auch Cyphers eigenen laufenden Transport nicht mehr (vorher Spec 6.37: kiStoppTransport, /k/arr/stopp als andreas), der Kern
    // beendet ihn auch nicht (Arrangement::ki_stopp). Er gehört ab dem Stopp Andreas: Cypher bedient ihn danach nicht mehr, im Stopp nicht (Riegel,
    // ki_gestoppt), nach der Freigabe nicht (fremderLauf, transport_laeuft), bis Andreas ihn stoppt und Cypher neu startet. Ein noch WARTENDER Start von
    // Cypher (status 1) wird übergeben wie ein laufender, der Kern verwirft ihn aber (Quittung 7 ki_stopp, wie wartende Deck-Befehle): danach meldet
    // er status 0, und fremderLauf (nur status 1 oder 2) sperrt nichts mehr. Zweiter Weg, falls /e/ki verloren geht: das periodische /zustand/kern
    // (ki_gestoppt), aus dem auch server.ts den Riegel nachführt.
    const kiAn = adresse === '/e/ki' ? f.gestoppt : adresse === '/zustand/kern' ? f.ki_gestoppt : undefined;
    if (Number(kiAn) === 1 && this.transportQuelle === 'cypher') this.transportQuelle = 'andreas';
    if (neustart) this.nachNeustart();
  }
  // Spec 3.4 Rückweg: Andreas' Hand an spur/<n>/* landet im Projekt (Quelle andreas). Spec 6.30: zusammengefasst. Je Pfad zählt der letzte Wert;
  // gespeichert wird höchstens einmal je RUECKWEG_MS (das erste Ereignis nach einer Pause sofort), und eine Geste ist ein Verlaufseintrag: sie
  // endet nach GESTE_RUHE_MS ohne Ereignis. Vorher speicherte jedes Hand-Ereignis das ganze Projekt.
  private rueckweg(pfad: string, wert: number): void {
    const o = this.offen;
    if (!o) return;
    const jetzt = Date.now();
    if (this.geste.offen !== o || jetzt - this.geste.letzteMs > GESTE_RUHE_MS) this.geste = { nr: this.geste.nr + 1, letzteMs: jetzt, labels: [], offen: o };
    this.geste.letzteMs = jetzt;
    this.rueckwegWartend.set(pfad, wert);
    if (this.rueckwegTimer) return;
    this.rueckwegTimer = setTimeout(() => {
      this.rueckwegTimer = null;
      void this.seriell(async () => this.rueckwegSpeichern()).catch((e) => this.ctx.log({ typ: 'proj_rueckweg_fehler', fehler: (e as Error).message }));
    }, Math.max(0, this.rueckwegGespeichertMs + RUECKWEG_MS - jetzt));
    this.rueckwegTimer.unref();
  }
  // Die wartenden Werte als EINE Änderung der laufenden Geste (synchron: auch beim Schliessen des Projekts, damit der letzte Wert nicht verloren geht)
  private rueckwegSpeichern(): void {
    const liste = [...this.rueckwegWartend];
    this.rueckwegWartend.clear();
    const o = this.offen, g = this.geste;
    if (!o || g.offen !== o || !liste.length) return;
    const befehle: Record<string, unknown>[] = [];
    for (const [p, w] of liste) {
      const b = reglerZuBefehl(o.projekt, p, w);
      if (!b) continue;
      befehle.push(b.befehl);
      if (!g.labels.includes(b.label)) g.labels.push(b.label);
    }
    if (!befehle.length) return;
    this.rueckwegGespeichertMs = Date.now();
    const label = (g.labels.length === 1 ? g.labels[0] : `Mixer: ${g.labels.map((l) => l.replace(/^Mixer: /, '')).join(', ')}`).slice(0, 200);
    try {
      const r = aendere(o.verlauf, o.projekt, befehle as never, { quelle: 'andreas', label }, this.haken(o), {
        schluessel: `rueckweg:${g.nr}`, transienten: this.transienten });
      if (!r.eintrag) return;
      r.projekt.wiedergabe_rev = o.projekt.wiedergabe_rev;
      o.projekt = r.projekt;
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: r.projekt.rev, label, quelle: 'andreas' } });
    } catch (e) { this.ctx.log({ typ: 'proj_rueckweg_fehler', pfade: liste.map(([p]) => p), fehler: (e as Error).message }); }
  }

  // Spec 2.12: nach /e/neustart (neue Generation) die letzte Wiedergabe neu laden, Spur-Regler, Loop, Metronom und KI-Maske neu setzen.
  // Spec 6.32, Ausnahme Kern-Neustart: nachNeustart lädt IMMER, auch während der Freeze-Sperre. Ein Neustart beendet jeden Freeze im Kern, es gibt
  // nichts mehr abzubrechen, und ohne Laden spielte der neue Kern nichts. Pflicht für S3: kommt während eines Freeze ein Kern-Neustart oder geht
  // der Kern verloren, endet der Freeze mit freeze_fehler und gibt die Sperre frei; einen neuen Freeze startet S3 nicht von selbst.
  // Ist das Laden gemerkt (eine Änderung kam während der Sperre durch), ist die Datei zu wiedergabe_rev veraltet: dann eine neue schreiben.
  // Nach dem gelungenen Laden sind die Merk-Flags erledigt (Laden und Loop gehen hier mit dem Stand von jetzt an den Kern), damit die Freigabe nicht
  // noch einmal lädt. Das gemerkte Tempo bleibt: nachNeustart sendet kein Tempo, holeNach tut es nach der Freigabe.
  // Spec 6.35 (E-a): nachNeustart setzt alle Spur-Regler aus dem Projekt, auch im KI-Stopp; Cyphers Spuren sind nicht ausgenommen.
  private nachNeustart(): void {
    void this.seriell(async () => {
      const o = this.offen;
      if (!o) return;
      this.leereVorhoeren(o);                      // 1.14: the new core plays the main lane; wiedergabe_rev already holds every comp made during an audition
      const nr = o.projekt.wiedergabe_rev;
      const wiedergabe: Record<string, unknown> = !o.merk.laden && nr > 0 && fs.existsSync(wiedergabeDatei(this.arbeitsordner, nr))
        ? { nr, quittung: await this.kern.laden(nr, 'andreas') } : await this.ladeWiedergabe('andreas');
      if (typeof wiedergabe.nr === 'number' && quittungOk(wiedergabe.quittung as Quittung)) { o.merk.laden = false; o.merk.loop = false; }
      this.transportQuelle = null;
      // Spec 6.31, 6.32: wartende Handwerte ins Projekt, unmittelbar vor dem Senden der Regler (nach der Lade-Quittung, kein await dazwischen),
      // damit auch, was während des Ladens kam, an den neuen Kern geht und Kern und Projekt denselben Wert haben
      this.rueckwegSpeichern();
      // No /k/hand/frei here: the cause of a core restart is unknown, and the server must never release Andreas's hand in his name (D9).
      const [regler, loop, metronom, ki] = await Promise.all([this.kern.setzeRegler(alleRegler(o.projekt), 'andreas'),
        this.kern.loop(o.projekt, 'andreas'), this.kern.metronom(o.projekt, 'andreas'), this.leereKiMaske()]);
      // S17: the sound snapshot again (a new kern knows no graph); source andreas like the controls above (Spec 6.35 E-a)
      const baukasten = o.projekt.baukasten ? await this.bk.wiederherstellen(o.projekt, 'andreas', { schonGeladenUeberspringen: false }) : undefined;
      this.ctx.log({ typ: 'proj_neustart', slug: o.slug, wiedergabe, ...reglerBefund(regler), loop, metronom, ki, ...(baukasten ? { baukasten } : {}) });
    }).catch((e) => this.ctx.log({ typ: 'proj_neustart_fehler', fehler: (e as Error).message }));
  }
}
