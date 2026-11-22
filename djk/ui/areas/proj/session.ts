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
import { Katalog, type Zeile } from '../../catalog.ts';
import { AblageFehler, Projekte, projektWurzelVorgabe, setzeVorgabenQuelle } from '../../project/storage.ts';
import { kanalOffen } from '../../hand_operation.ts';
import { istStromZeile } from '../../stream_alias.ts';
import { modulAmPlatz, SLOTS, type Slot } from '../../project/live.ts';
import { pultContainerPfad } from '../../../contract/pult.ts';
import { takteProLive } from '../../project/taktart_live.ts';
import { vorlageBefehle, vorlageVon, vorlagenListe } from '../../project/werkbank.ts';
import { sichereWerksProbenImStandardOrdner } from '../../sampler/werksproben.ts';
import { trackerVorlageBefehle, trackerVorlageVon, trackerVorlagenListe } from '../../project/tracker.ts';
import { teileReglerLive, teileStummStart } from '../../project/controls_order.ts';
import { loeseQuelle } from '../../project/source_path.ts';
import type { Einsammler } from '../../project/einsammeln.ts';
import { alleAudioClips, fuehreListeAus, laneStart, setzeDekodiert, vergleiche, type PluginEintrag, type PresetInhalt } from '../../project/commands.ts';
import { findeGraph, vorgabenVon, steckfeldVon } from '../../graphs.ts';
import type { StiftAenderung } from '../../project/commands_helpers.ts';
import type { Stift } from '../../steckfeld.ts';
import { kitDa, kitKlaenge } from './kits.ts';
import { uebersetzeAusCache, ausCache, vorlauf, type Anfrage } from './pattern_run.ts';
import type { MusterMeldung } from '../../project/commands.ts';
import { SurgeSpiegel, surgeBereich } from './surge.ts';
import { surgePatchDatei } from './surge_patches.ts';
const surgePatchDa = (name: string): boolean => surgePatchDatei(name) !== null;
import { SURGE_RICHTUNGEN, nurFilter1, surgeParameterVon } from '../../project/direction.ts';
import { TransientenLager } from '../../project/transients.ts';
import { DekodierCache, type DekodierEreignis } from '../../project/decode.ts';
import { deckleDekodiert } from '../../project/cache_deckel.ts';
import {
  alleInserts, alleStraenge, alleZellen, platzVonGruppe, BK_LIVE_SLOTS, BK_PARAMETER, bkSlot, FADER_MAX, FADER_MIN,
  HALL_FELDER, MAX_BEAT, TEMPO_MIN, TEMPO_MAX, kanonisch, sucheClip, sucheSpur, sucheStrang, wertImBereich,
  type AudioClip, type Clip, type DekodiertZustand, type Lane, type Projekt, type Spur, type Warp, type Ziel,
} from '../../project/model.ts';
import { laneWert } from '../../project/lane.ts';
import { HK_ZIELE, hkWert, type Huellkurve } from '../../project/envelope.ts';
import { PatchFehler, wende } from '../../project/patch.ts';
import {
  WarpFehler, abHierStart, autoWarp, beatBeiQuelle, fensterTempo, handWarp, quantisiere, quellSekunde, segmentBpm, type TempoQuelle,
} from '../../project/warp.ts';
import { aendere, rueckgaengig, wiederholen, type Haken, type Meta, type Verlauf, type Wirkung } from '../../project/history.ts';
import { WiedergabeFehler, WiedergabeZaehler, containerQuellen, schreibeWiedergabe, uebersetze, wiedergabeDatei, type Wiedergabe } from '../../project/playback.ts';
import { geraetFx } from '../../devices_parameter.ts';
import { alleRegler, istMixerRegler, reglerZuBefehl, type Soll } from './mapping.ts';
import { arrOrdner, zaehlerDateiVorgabe } from './config.ts';
import { grundText } from '../../http/reasons.ts';
import { KernLage } from './state.ts';
import { leseKarte, leseTraktor, schreibeEinsKorrektur } from './sources.ts';
import { AnalyseListe, type AnalyseEintrag, type AnalyseEnde, type AnalyseStarter, type Anforderung, type Wunsch } from './analysis.ts';
import { ankunftBefehle, brauchtAnalyse, klingtGerade } from '../../project/warp_analysis.ts';
import { analyseVorgabe } from '../../paths.ts';
import {
  KernWeg, KERN_AUTO_ZIELE, autoAblehnung, istKernAutoZiel, quittungAbgelehnt, quittungOk, type Quelle, type Quittung,
  type ReglerErgebnis } from './core_path.ts';
import { ProjBk } from './modular.ts';   // S17: sound snapshot
import { GESTE_RUHE_MS } from './times.ts';
import { SitzungGeraet } from './session_device.ts';
import { SitzungQuellen } from './session_sources.ts';
import { SitzungVorhoeren } from './session_prelisten.ts';
import { SitzungAuto } from './session_auto.ts';
// 1.12 slice 3 (task 8): takes into lanes
import { AUFNAHME_ZIELE, AutoAufnahme, modusVon, type AufnahmeZiel, type AutoOptionen, type Modus } from './recording_auto.ts';
import { bkDefVonId } from '../../project/modular.ts';
// plan 1.11 task 7: foreign effect plugins (host manager)
import { HostVerwaltung, insertAusfuehren, sockAnfrage, type HostAbhaengig, type HostZeiten } from '../../plugins/hostverwaltung.ts';
import type { SicherGrund } from '../../plugins/state.ts';
import {
  InstrumentWirte, instrumenteStart, wirtSockAnfrage, wirtStandLesen, type InstrumentAbhaengig, type InstrumentZeiten,
} from '../../plugins/instrumentwirte.ts';

/** In-process only (a Symbol cannot come over HTTP): `rev: REV_JETZT` in an aendern body means "the project as it is when this write's turn comes". */
export const REV_JETZT = Symbol('rev_jetzt');
export class ProjFehler extends Error {
  readonly code: number;
  readonly fehler: string;
  readonly extra: Record<string, unknown>;
  constructor(code: number, fehler: string, extra: Record<string, unknown> = {}) { super(fehler); this.code = code; this.fehler = fehler; this.extra = extra; }
  get grund(): string { return this.fehler; }   // wie BefehlFehler.grund (S3 liest den Grund so)
}
export interface Antwort { code: number; j: unknown }
export interface ProjOptionen {
  kanalOffen?: (kanal: string) => boolean;   // DJ view places: the server's view of an open channel pad/N, a planned or running ramp counts (server.ts)
  instanz?: string;            // Vorgabe CYPHERDJ_INSTANZ
  samplerOrdner?: () => string | undefined;   // sample folder (roots file), read at each call: IMPORT MOD reads a module given as <root>/<rel> from there
  wurzel?: string;             // Projektordner-Wurzel (Vorgabe projektWurzelVorgabe(instanz))
  arbeitsordner?: string;      // Arbeitsordner der Wiedergaben (Vorgabe: kern.toml arr_ordner, sonst ~/.cache/cypherdj[-<i>]/arr)
  zaehlerDatei?: string;       // Spec 6.30, 6.31: Zustandsdatei des Wiedergabe-Zählers ausserhalb des Arbeitsordners. Vorgabe: mit ausdrücklichem
                               // arbeitsordner `<arbeitsordner>.zaehler` (je Ordner eine, Test-Server teilen nie eine Datei), sonst
                               // ~/.local/state/cypherdj[-<i>]/wiedergabe-zaehler
  katalog?: string;            // katalog.sqlite (Audio-Quellen nur über den Katalog, Spec 2.11)
  wirtWacheMs?: number;   // audit U07: how often the session looks at the pids of the Surge hosts (default 2000)
  wirtOrdner?: () => string;   // 1.9 (L10): folder of the host status files (wirt-arr<s>.json); proj_lage shows them as `wirte` (server.ts passes its own)
  analyse?: string | null;      // Slice 3a: Analyse-Ablage (Karten); null = aus; Vorgabe nur im Betrieb (paths.ts analyseVorgabe)
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
  // plan 1.11 task 7: the host manager. `abhaengig` replaces parts of the real dependencies (djk-insert, the host socket,
  // the core calls), `zeiten` the time scale
  pluginIndex?: (id: string) => PluginEintrag | null;   // plan 1.11 T10: the plugin index (insert_setzen with plugin_id)
  instrument?: { abhaengig?: Partial<InstrumentAbhaengig>; zeiten?: Partial<InstrumentZeiten> };   // plan 1.11 task 17: the plugin instrument hosts
  host?: { abhaengig?: Partial<HostAbhaengig>; zeiten?: Partial<HostZeiten>; befehl?: string };
  einsammler?: Einsammler;     // storage layout A5: collects sources of a removable disk into the project in the background (server.ts)
  uhrStillMs?: number;         // Spec 6.30: läuft /uhr so lange nicht weiter, bricht das Warten auf die Rampe ab (503 kein_kern, Vorgabe 1 s)
}
// merk (Spec 6.30, 6.31): was die Freeze-Sperre aufgeschoben hat und nach der letzten Freigabe nachgeholt wird. Es gehört zum offenen Projekt und
// verfällt mit ihm: ein anderes Projekt lädt beim Öffnen ohnehin seine eigene Wiedergabe.
// stifte (Kraken patch field): a light pin was accepted since the stored playback file was written; the file does not hold it, so nachNeustart translates fresh
// Merk: reglerNach = live rows that wait for the load; stifte = a light pin was accepted since the stored playback file was written
interface Merk { laden: boolean; loop: boolean; tempo: boolean; reglerNach: Soll[]; stummStart: number[]; stifte: boolean }
// Spec 6.34: was GET /proj/aktuell als ausgabe_lauf zeigt, solange S3 einen Freeze oder Export fährt (Spur nur beim Freeze)
export type AusgabeLauf = { art: 'freeze'; spur_id: string }
  | { art: 'export'; echtzeit?: true; start_ms?: number; dauer_s?: number } | { art: 'lautheit' } | { art: 'analyse' } | { art: 'merge' }
  | { art: 'bounce' }   // 1.14 slice 4 (spec R11)
  | { art: 'resample'; strang_id: string };   // 1.10 slice 7 (T6): the strip being tapped
// Loop deck cell sources of a project: sha -> path hint (the first cell that names one wins). Decoded like clip sources.
function alleZellQuellen(p: Projekt): Map<string, string> {
  const m = new Map<string, string>();
  for (const z of alleZellen(p)) {
    if ((!m.has(z.sha256) || (m.get(z.sha256) === '' && z.pfad_hinweis))) m.set(z.sha256, z.pfad_hinweis ?? '');
  }
  return m;
}
// vorhoeren (1.14 comping, spec R8): spur_id -> take_id of the audition. Session state: never saved, never undoable, gone with the open project.
// a change added or replaced an audio clip: some sha of the new state is not in the old one
function neueQuelle(alt: Projekt, neu: Projekt): boolean {
  const vorher = new Set<string>();
  for (const c of alleAudioClips(alt)) vorher.add(c.quelle.sha256);
  for (const c of alleAudioClips(neu)) if (!vorher.has(c.quelle.sha256)) return true;
  return false;
}
interface Offen { slug: string; projekt: Projekt; verlauf: Verlauf; merk: Merk; vorhoeren: Map<string, string> }
type Koerper = Record<string, unknown>;
interface Hinweis { index: number; hinweis: string; [feld: string]: unknown }                // Paket 1.13: z. B. kein_tempo (Auto-Warp fand kein Tempo)

const LIVE_SLUG = 'live';
const liveSlotAntwort = (p: Projekt): Record<Slot, string | null> => Object.fromEntries(SLOTS.map((s) => [s, modulAmPlatz(p, s) ?? null])) as Record<Slot, string | null>;
const schlaf = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
// Baukasten S20: lookup of a graph in the graph folder for the commands that set a bk device (null = no such graph)
const graphArt = (name: string): 'instrument' | 'effekt' | null => findeGraph(name)?.art ?? null;
// Kraken patch field: lookup of the matrix node (labels, default pins) of a graph for the pin commands (null = no such graph or no matrix node)
const steckfeldLookup = (name: string): ReturnType<typeof steckfeldVon> => steckfeldVon(name);
// arr-bk: the bk stages of the project whose graph file is not in the graph folder (the core plays such a stage dry and logs it): [{strang_id, stufe, graph}]
type BkFehlt = { strang_id: string; stufe: string; graph: string };
export function bkGraphenFehlen(p: Projekt, art: (name: string) => 'instrument' | 'effekt' | null = graphArt): BkFehlt[] {
  return alleInserts(p).filter((x) => x.insert.art === 'bk' && art(x.insert.graph!) === null)
    .map((x) => ({ strang_id: x.strangId, stufe: x.insert.id, graph: x.insert.graph! }));
}
const MAX_MUSTER_JE_AUFRUF = 8;   // strudel-clip: clip_aus_muster commands in one call (each can need a child of up to 5 s)
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
// 1.12 slice 6: a group, a return and the master carry lanes too (insert and rack lanes), shown the same way; `id` is the strip's ID ('master' for the master)
const ohneLanePunkte = <T extends { automation?: Lane[] }>(s: T, id: string, ueber?: UeberFrage): Omit<T, 'automation'> & { lanes?: unknown } => {
  const { automation, ...rest } = s;
  return automation?.length
    ? { ...rest, lanes: automation.map((l) => ({ id: l.id, ziel: l.ziel, punkte_zahl: l.punkte.length, ...(l.gesperrt ? { gesperrt: true } : {}),
      ...(ueber?.(id, l.ziel) ? { uebersteuert: true } : {}) })) }
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
const ohneNoten = (p: Projekt, ueber?: UeberFrage): unknown => ({ ...p, ...bkKurz(p),
  ...(p.gruppen?.some((g) => g.automation) ? { gruppen: p.gruppen.map((g) => ohneLanePunkte(g, g.id, ueber)) } : {}),
  ...(p.returns?.some((r) => r.automation) ? { returns: p.returns.map((r) => ohneLanePunkte(r, r.id, ueber)) } : {}),
  ...(p.master?.automation ? { master: ohneLanePunkte(p.master, 'master', ueber) } : {}),
  spuren: p.spuren.map((s) => ({
  ...ohneTakes(ohneLanePunkte(s, s.id, ueber)), clips: s.clips.map((c) => {
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
export { GESTE_RUHE_MS };   // Spec 6.30: so lange Ruhe schließt eine Geste (ein Verlaufseintrag je Geste); the value lives in times.ts

// Gegenprobe W(bei_beat) des Werkzeugs proj_warp: die Quellsekunde, die bei diesem Projekt-Beat wirklich klingt. Maßgeblich ist, was der Übersetzer
// spielt (playback.ts audioKopien/warpMarker): jede Loop-Kopie beginnt bei versatz_beats von vorn (Clip-Beat c, Kopie k = ⌊c/loop⌋, Beat in der
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

const VORZAEHL_BEATS: readonly number[] = [0, 4, 8, 16];   // 1.8 S4b.1a: count-in of 0, 1, 2 or 4 bars in core beats (the internal key of the transport call)
export class ProjSitzung {
  readonly lage = new KernLage();
  readonly arbeitsordner: string;
  private readonly transientenLager: TransientenLager;     // Slice 4: Transienten je Quelle (Quellsekunden), für BEATS und proj_warp
  private readonly transienten = (sha: string): number[] | null => this.transientenLager.fuer(sha);
  private readonly ctx: BereichKontext;
  private readonly kern: KernWeg;
  // Container core M5: what this session last told the core feeds container A..D (null = not told since this server or the core started)
  private containerGesendet: (0 | 1 | 2 | null)[] = [null, null, null, null];
  private readonly bk: ProjBk;   // S17
  private readonly projekte: Projekte;
  private readonly cache: DekodierCache;
  private readonly zaehler: WiedergabeZaehler;
  private readonly katalog: Katalog | null;
  private readonly einsammler: Einsammler | null;
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
  private readonly geraet: SitzungGeraet;
  private readonly quellen: SitzungQuellen;
  private readonly vorhoeren: SitzungVorhoeren;
  private readonly auto: SitzungAuto;
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
  readonly aufAuto: AutoAufnahme;   // 1.12 slice 3 (task 8): arm state and the take collector
  private readonly rueckwegWartend = new Map<string, { wert: number; quelle: Quelle }>();     // Rückweg: letzter Wert je Pfad und wer ihn bewegt hat, noch nicht gespeichert
  private rueckwegTimer: ReturnType<typeof setTimeout> | null = null;
  private wirtWache: ReturnType<typeof setInterval> | null = null;   // audit U07: asks for a Surge sync when a host got a new pid
  private readonly wirtWacheMs: number;
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
  private readonly pluginIndex: ProjOptionen['pluginIndex'];
  private readonly kanalHaken: ProjOptionen['kanalOffen'];
  private liveFaderKette: Promise<unknown> = Promise.resolve();   // the module fader migrations run one after the other
  private readonly liveFaderWartend = new Set<string>();   // module groups at -200 that wait for a closed channel and a stopped live playback
  private readonly liveFaderGemeldet = new Set<string>();   // groups whose refused raise was logged (one entry each)
  private liveFaderLauf: Promise<{ angehoben: string[]; gemeldet: string[] }> | null = null;   // the run that the last open of the live project started
  readonly instrumente: InstrumentWirte;                         // plan 1.11 task 17: the foreign instrument hosts (plugin tracks)
  readonly hosts: HostVerwaltung;                                // plan 1.11 task 7: the foreign effect hosts
  // a host slot never changes strips inside one playback load (kern contract, task 4): what the last written playback holds per slot, when a slot was
  // released, and what the next load has to do first (key: the number of the playback file)
  private hostBelegt = new Map<number, string>();
  private readonly hostFreiMs = new Map<number, number>();
  private readonly hostFreiLatenz = new Map<number, number>();   // samples of the stage that last left a slot
  private readonly hostVorab = new Map<number, { zwischen: number | null; konflikt: number[]; eintritt: number[]; geraeumt: number[];
    span: Map<number, number> }>();

  constructor(ctx: BereichKontext, opt: ProjOptionen = {}) {
    const instanz = opt.instanz ?? process.env.CYPHERDJ_INSTANZ ?? '';
    this.ctx = ctx;
    this.presetLies = opt.presetLies;
    this.wirtWacheMs = opt.wirtWacheMs ?? 2000;
    this.pluginIndex = opt.pluginIndex;
    this.kanalHaken = opt.kanalOffen;
    this.surge = new SurgeSpiegel({ ordner: opt.wirtOrdner, log: (e) => ctx.log(e), slotBereit: (slot) => this.instrumente.slotFertig(slot),
      wirtPid: (slot) => this.instrumente.pid(slot) });
    this.hosts = new HostVerwaltung({
      insert: (a) => insertAusfuehren(a, instanz, opt.host?.befehl),
      sock: sockAnfrage,
      // the flag and the measurement go out as `leitstand`: Stop Cypher never holds them back (a `cypher` source would be refused ki_gestoppt)
      kern: {
        insHost: async (h, g) => { ctx.sende('/k/arr/ins_host', { quelle: 'leitstand', h, gesund: g }); },
        insMess: (h) => { ctx.sende('/k/arr/ins_mess', { quelle: 'leitstand', h }); },
      },
      ordner: () => (this.offen ? path.resolve(this.projekte.wurzelPfad, this.offen.slug) : null),
      transportSteht: () => this.lage.arr !== null && this.lage.arr.status === 0,
      neuLaden: () => this.hostNeuLaden(),
      log: (z) => ctx.log(z),
      ...opt.host?.abhaengig,
    }, opt.host?.zeiten);
    // without a status folder (a session that was not given one) no instrument host is ever started
    const wo = opt.wirtOrdner;
    this.instrumente = new InstrumentWirte({
      start: wo ? instrumenteStart(instanz) : async () => ({ code: 1, fehler: 'no host folder' }),
      stand: (slot) => (wo ? wirtStandLesen(wo(), slot) : { lebt: false, bereit: false, art: null, kennung: null, pid: null }),
      sock: wo ? wirtSockAnfrage(wo) : async () => { throw new Error('sock_verbindung: no host folder'); },
      ordner: () => (this.offen ? path.resolve(this.projekte.wurzelPfad, this.offen.slug) : null),
      log: (z) => ctx.log(z),
      surgeNeu: (slot) => this.surge.vergiss(slot),
      ...opt.instrument?.abhaengig,
    }, opt.instrument?.zeiten);
    this.kern = new KernWeg(ctx, this.lage, { proTakt: () => takteProLive(this.offen?.projekt?.taktart), ...opt.kernWeg });
    this.bk = new ProjBk(ctx, this.lage, this.kern, opt.bkFristMs ?? 5000);
    setzeVorgabenQuelle((name) => vorgabenVon(name));   // the graph's `vorgabe` list: fill and trim of the knob rows of a project use the same one
    this.projekte = new Projekte(opt.wurzel ?? projektWurzelVorgabe(instanz));
    this.arbeitsordner = opt.arbeitsordner ?? arrOrdner(instanz);
    const zaehlerDatei = opt.zaehlerDatei
      ?? (opt.arbeitsordner ? `${path.resolve(opt.arbeitsordner)}.zaehler` : zaehlerDateiVorgabe(instanz));
    this.zaehler = new WiedergabeZaehler(this.arbeitsordner, zaehlerDatei);
    this.cache = new DekodierCache(this.arbeitsordner, { ffmpeg: opt.ffmpeg, ffprobe: opt.ffprobe, vorsatz: opt.vorsatz,
      bei: (e) => this.dekodiertEreignis(e), deckel: (frisch) => this.deckelDekodiert(frisch) });
    this.transientenLager = new TransientenLager(path.join(this.arbeitsordner, 'audio'));
    this.katalog = opt.katalog ? new Katalog(opt.katalog) : null;
    this.einsammler = opt.einsammler ?? null;
    this.analyse = opt.analyse !== undefined ? opt.analyse : analyseVorgabe(instanz);
    this.mediathekPfad = opt.mediathek ?? null;
    this.bestand = opt.bestand ?? null;
    this.analyseWarteMs = opt.analyseWarteMs ?? 2000;
    // Die Meldung läuft ohne neue rev: die Seite lädt bei clip_id nach (production.js)
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
    this.geraet = new SitzungGeraet({ brauchOffen: () => this.brauchOffen(), riegel: (q) => this.riegel(q),
      hosts: this.hosts, instrumente: this.instrumente, surge: this.surge });
    this.quellen = new SitzungQuellen({ analyse: this.analyse, analyseGescheitert: this.analyseGescheitert, analysen: this.analysen,
      bestand: this.bestand, katalog: this.katalog, mediathekPfad: this.mediathekPfad, presetLies: this.presetLies,
      quellPfad: (sha, hinweis) => this.quellPfad(sha, hinweis), transienten: this.transienten });
    const s = this;   // the get members of the hosts read fields that change after the constructor
    this.vorhoeren = new SitzungVorhoeren({ arbeitsordner: this.arbeitsordner, get aufnahmeLauf() { return s.aufnahmeLauf; },
      brauchOffen: () => this.brauchOffen(), ctx: this.ctx, kern: this.kern, ladeWiedergabe: (q, v) => this.ladeWiedergabe(q, v),
      get offen() { return s.offen; }, riegel: (q) => this.riegel(q),
      schreibeVorhoerWiedergabe: (p, v, streng) => this.schreibeVorhoerWiedergabe(p, v, streng), seriell: (f) => this.seriell(f),
      get sperren() { return s.sperren; }, get sperrenAufnahme() { return s.sperrenAufnahme; } });
    this.auto = new SitzungAuto({ aendern: (d, q, erwartet) => this.aendern(d, q, erwartet), aufAuto: this.aufAuto,
      brauchOffen: () => this.brauchOffen(), ctx: this.ctx, kern: this.kern, get offen() { return s.offen; }, riegel: (q) => this.riegel(q),
      uebersteuert: this.uebersteuert });
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
  /** Every stored project that can be read, one at a time (sampler delete: which project still plays a graph). A project file that is broken, invalid or
   *  gone is skipped; the open project is read from its file like the others (the caller decides what counts). */
  *gespeicherte(): Generator<{ slug: string; projekt: Projekt }> {
    for (const e of this.projekte.liste()) {
      if (e.fehler !== undefined) continue;
      let projekt: Projekt;
      try { projekt = this.projekte.lies(e.slug); } catch { continue; }
      yield { slug: e.slug, projekt };
    }
  }
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
    const limiter = a && Number.isFinite(a.limiter_db) ? { limiter_db: a.limiter_db } : {};   // D12: absent without core state or from an older core
    const kern = { rev_geladen: a ? a.nr : null, status: a ? a.status : null, ...limiter, ...(this.lage.insHost ? { ins_host: this.lage.insHost } : {}) };
    // the page (full view) learns the overridden fields from here after a reload (D8); only present when something is overridden
    const ueber = ansicht === 'voll' ? this.uebersteuertListe(o.projekt) : [];
    return { code: 200, j: { slug: o.slug, projekt, kern, ...lauf, ...(an.length ? { analyse: an } : {}),
      ...(o.vorhoeren.size ? { vorhoeren: Object.fromEntries(o.vorhoeren) } : {}),
      // plugins: the T7 name; hosts: the name the plan, the page and proj_lage use
      ...(this.hosts.lage().length ? { plugins: this.hosts.lage(), hosts: this.hosts.lage() } : {}),
      ...(this.instrumente.lage().length ? { instrumente: this.instrumente.lage() } : {}),
      ...(ueber.length ? { auto_uebersteuert: ueber } : {}), ...(this.aufAuto.istArm() ? { auto_arm: this.aufAuto.ansicht() } : {}),
      ...(this.stemsStand && this.stemsStand.slug === o.slug ? { stems: this.stemsStand } : {}) } };
  }
  // plugin and device parameter calls: see session_device.ts
  insertParam(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.insertParam(insertId, d, quelle); }
  insertParameter(insertId: string): Promise<Antwort> { return this.geraet.insertParameter(insertId); }
  insertFenster(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.insertFenster(insertId, d, quelle); }
  geraetParam(spurId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.geraetParam(spurId, d, quelle); }
  geraetIst(spurId: string, namenText: string): Promise<Antwort> { return this.geraet.geraetIst(spurId, namenText); }
  geraetParameter(spurId: string): Promise<Antwort> { return this.geraet.geraetParameter(spurId); }
  geraetFenster(spurId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.geraetFenster(spurId, d, quelle); }
  hostLage(): ReturnType<HostVerwaltung['lage']> { return this.hosts.lage(); }
  hostZustandSichern(grund: SicherGrund): Promise<void> {
    return Promise.all([this.hosts.zustandSichern(grund), this.instrumente.zustandSichern(grund)]).then(() => undefined);
  }
  hostGesundAlterMs(nur?: ReadonlySet<string>): number { return this.hosts.gesundAlterMs(nur); }
  // plan 1.11 task 13: the real-time export plays `p` (host stages live, nothing frozen) as its own playback: written with the next number of the one
  // counter and loaded now. The caller holds sperreLaden and calls ladeLiveNeu() afterwards.
  async ladeEchtzeitSicht(p: Projekt): Promise<{ nr: number; datei: string }> {
    const nr = this.zaehler.naechste();
    const datei = schreibeWiedergabe(this.arbeitsordner, this.uebersetzeFuer(p, nr, undefined, true));
    const q = await this.kern.laden(nr, 'andreas');
    if (quittungAbgelehnt(q)) {
      fs.rmSync(datei, { force: true });
      throw new ProjFehler(409, q.grund || 'nicht_geladen', { kern: { wiedergabe: { nr, quittung: q } } });
    }
    return { nr, datei };
  }
  // the live view again (what the core played before the real-time export)
  ladeLiveNeu(): Promise<void> {
    return this.seriell(async () => { if (this.offen) await this.ladeWiedergabe('andreas'); });
  }
  // The same load for callers that do not hold the lock themselves (the sampler routes after they rewrote a graph): like every other loader it respects
  // sperreLaden. While a freeze, export, recording or resample holds the lock the load would cut it off in the core, so only the wish is kept (merk.laden)
  // and the release loads. true: loaded now (or no project is open); false: deferred. ladeLiveNeu stays unchecked for the real-time export, which
  // holds the lock.
  ladeLiveNeuFrei(): Promise<boolean> {
    return this.seriell(async () => {
      if (!this.offen) return true;
      const r = await this.ladeOderMerke('andreas');
      return r.aufgeschoben !== true;
    });
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
      for (const { strang, strangId } of alleStraenge(o.projekt)) {   // 1.12 slice 6: a lane may sit on a group, a return or the master
        const l = (strang.automation ?? []).find((x) => x.id === laneId);
        if (l) return { code: 200, j: laneAnsicht(strangId, l, von, bis, bei, grenze) };
      }
      throw new ProjFehler(404, 'lane_unbekannt');
    }
    const s = sucheStrang(o.projekt, spurId!);   // a track, group, return or 'master'
    if (!s) throw new ProjFehler(404, 'spur_unbekannt');
    const sid = s === o.projekt.master ? 'master' : (s as { id: string }).id;
    return { code: 200, j: { spur_id: sid, lanes: (s.automation ?? []).map((l) => laneAnsicht(sid, l, von, bis, bei, grenze)) } };
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
  // opt.werkbank / opt.vorlage (workbench stage 1): a module is a project with the marker; a template is applied after the open, as ONE history step
  // through aendern (not inside the serial open: it would wait on itself). Everything is checked before anything is created or opened.
  // opt.tracker (tracker stage 4): the project gets the tracker marker; `vorlage` then names a tracker template (8bit-4kanal, chip); never with werkbank.
  async neu(name: unknown, quelle: Quelle, bestaetigt = false,
    opt: { werkbank?: unknown; vorlage?: unknown; tracker?: unknown } = {}): Promise<Antwort> {
    const tracker = opt.tracker === true;
    const vorlage = opt.vorlage === undefined || tracker ? null : vorlageVon(opt.vorlage);
    const trackerVorlage = opt.vorlage === undefined || !tracker ? null : trackerVorlageVon(opt.vorlage);
    const r = await this.seriell(async () => {
      if (opt.werkbank !== undefined && opt.werkbank !== true) throw new ProjFehler(400, 'argument_ungueltig', { text: 'werkbank: true or absent expected' });
      if (opt.tracker !== undefined && opt.tracker !== true) throw new ProjFehler(400, 'argument_ungueltig', { text: 'tracker: true or absent expected' });
      if (tracker && opt.werkbank !== undefined) throw new ProjFehler(400, 'argument_ungueltig', { text: 'tracker and werkbank exclude each other' });
      if (opt.vorlage !== undefined && opt.werkbank !== true && !tracker) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: 'vorlage needs werkbank: true' });
      }
      if (opt.vorlage !== undefined && !tracker && vorlage === null) {
        throw new ProjFehler(400, 'vorlage_unbekannt', { text: `vorlage: one of ${vorlagenListe().map((v) => v.id).join(' | ')}` });
      }
      if (opt.vorlage !== undefined && tracker && trackerVorlage === null) {
        throw new ProjFehler(400, 'vorlage_unbekannt', { text: `vorlage: one of ${trackerVorlagenListe().map((v) => v.id).join(' | ')}` });
      }
      this.riegel(quelle);
      this.sperreOeffnen();
      this.sperreLiveLaeuft(quelle, bestaetigt);
      this.sperreFremderTransport(quelle);
      if (trackerVorlage !== null) sichereWerksProbenImStandardOrdner();   // the templates play the amiga device: its factory samples must exist
      // a template sets the tempo, which is refused while a deck plays; the open must not leave an empty module behind
      if ((vorlage !== null || trackerVorlage !== null) && this.lage.deckLaeuft()) {
        throw new ProjFehler(409, 'deck_laeuft', { text: 'Stop the decks first: a module sets its own tempo.' });
      }
      return this.oeffnetGerade(() => {
        const { slug } = this.projekte.lege(name as string, opt.werkbank === true ? { werkbank: true } : tracker ? { tracker: true } : {});
        return this.oeffneIntern(slug, quelle);
      });
    });
    const gewaehlt = vorlage !== null ? { name: vorlage.name, befehle: vorlageBefehle(vorlage) }
      : trackerVorlage !== null ? { name: trackerVorlage.name, befehle: trackerVorlageBefehle(trackerVorlage) } : null;
    if (gewaehlt === null || r.code !== 200) return r;
    const o = r.j as { projekt: Projekt };
    const a = await this.aendern({ rev: o.projekt.rev, label: `Template ${gewaehlt.name}`, befehle: gewaehlt.befehle }, quelle);
    return a.code === 200 ? { code: 200, j: { ...(r.j as object), projekt: (a.j as { projekt: Projekt }).projekt } } : a;
  }
  // Workbench shelf (A 2026-11-16): SAVE AS copies a module under a new name (the open one too: its project.json holds every change already), DELETE
  // moves a module that is not open to the bin of the project folder (project/storage.ts entferne), so it can be put back by hand.
  kopie(slug: unknown, name: unknown, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle);
      const r = this.projekte.kopiere(slug as string, name as string);
      return { code: 200, j: { slug: r.slug, name: r.projekt.name } };
    });
  }
  loeschen(slug: unknown, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle);
      if (this.offen?.slug === slug) throw new ProjFehler(409, 'projekt_offen', { text: 'the open module cannot be deleted; open another one first' });
      const r = this.projekte.entferne(slug as string);
      return { code: 200, j: { slug, papierkorb: r.papierkorb } };
    });
  }
  oeffnen(slug: unknown, quelle: Quelle, bestaetigt = false): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle); this.sperreOeffnen(); this.sperreLiveLaeuft(quelle, bestaetigt); this.sperreFremderTransport(quelle);
      return this.oeffnetGerade(() => this.oeffneIntern(slug as string, quelle));
    }).then(async (r) => {
      if (r.code !== 200 || !this.liveFaderLauf) return r;
      const fader = await this.liveFaderErgebnis();
      if (fader.angehoben.length === 0 && fader.gemeldet.length === 0) return r;
      return { code: 200, j: { ...r.j as object, ...(fader.angehoben.length ? { projekt: this.offen?.projekt } : {}), fader } };
    });
  }
  // POST /proj/schliessen: closes the open project on purpose (guarded like an open; a running transport is stopped as on a switch). Nothing open: a no-op.
  schliessen(quelle: Quelle, bestaetigt = false): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle); this.sperreOeffnen(); this.sperreLiveLaeuft(quelle, bestaetigt); this.sperreFremderTransport(quelle);
      const slug = this.offen?.slug ?? null;
      if (slug === null) return { code: 200, j: { slug: null } };
      await this.oeffnetGerade(() => this.schliesseOffen(quelle).then(() => ({ code: 200, j: {} })));
      for (const h of this.offenHaken) try { h(null); } catch (e) { this.ctx.log({ typ: 'proj_offen_haken_fehler', fehler: (e as Error).message }); }
      this.ctx.log({ typ: 'proj_geschlossen', slug, quelle });
      return { code: 200, j: { slug } };
    });
  }
  // POST /live/oeffnen (plan live-module task 1): open the live container (slug `live`), creating it on the first call (flag live, loop region on, 0..64).
  // Already open: nothing is reopened (a reopen would stop the set); the answer is the same. Opening it from another project is guarded like any open.
  // nurWennLeer (loop deck writes): the container is opened or created only if no project is open when this job's turn comes; any other open project
  // (also one that was opened by a job queued before this one) is 409 projekt_offen and nothing changes
  async liveOeffnen(quelle: Quelle, bestaetigt = false, nurWennLeer = false): Promise<Antwort> {
    const r = await this.liveOeffnenOhneTempo(quelle, bestaetigt, nurWennLeer);
    if (r.code === 200) {
      await this.liveTempo(quelle);
      const fader = await this.liveFaderErgebnis();
      if (fader.angehoben.length > 0 || fader.gemeldet.length > 0) return { code: 200, j: { ...r.j as object, fader } };
    }
    return r;
  }
  // The result of the module fader migration for the open that just happened (started by oeffneIntern); a call on the open container runs it again,
  // so a slot that was only reported (channel open, or unknown) is raised as soon as its channel is closed and known.
  private async liveFaderErgebnis(): Promise<{ angehoben: string[]; gemeldet: string[] }> {
    const lauf = this.liveFaderLauf;
    this.liveFaderLauf = null;
    return lauf ? lauf : this.liveModulFader();
  }
  // Is pad/<n> open as the server sees it: the rows of the core (kanalOffen) or a planned or running ramp of Cypher (hook of the server)
  private kanalOffenGesehen(kanal: string): boolean {
    const w = (n: string): number | undefined => this.lage.reglerWert(`${kanal}/${n}`) ?? undefined;
    return kanalOffen({ [`${kanal}/fader`]: w('fader') as number, [`${kanal}/trim`]: w('trim') as number }, kanal) || (this.kanalHaken?.(kanal) ?? false);
  }
  // The strip of a container sounds or is monitored: open by trim + fader or a planned ramp (kanalOffenGesehen), or PFL on (the gate of a place change)
  private kanalBelegtGesehen(kanal: string): boolean {
    return this.kanalOffenGesehen(kanal) || (this.lage.reglerWert(`${kanal}/pfl`) ?? 0) >= 0.5;
  }
  // DJ view places, decision 9: the module group fader is 0 dB from now on, the channel fader of pad/N is the only gain. A live project from before has
  // its module group at -200. The migration happens ONCE per open of the live project: on the open the group goes to 0 dB when pad/N is closed (kanalOffen
  // false, no ramp planned) and its fader is known. Otherwise (channel open, ramping or unknown) the group is remembered as waiting and reported.
  // A row of pad/N (or a call of /live/oeffnen on the open container) raises only waiting groups, only while the live playback is stopped and only when
  // the channel is closed and known then; once raised a group is not waiting any more, so an undo or a deliberate -200 holds. A refused write (a freeze is
  // running) leaves the group waiting, with one log entry per group. One undo step; never fails the open.
  private liveModulFader(modus: 'oeffnen' | 'wartend' = 'wartend'): Promise<{ angehoben: string[]; gemeldet: string[] }> {
    const lauf = this.liveFaderKette.then(() => this.liveModulFaderLauf(modus));
    this.liveFaderKette = lauf.catch(() => undefined);
    return lauf;
  }
  private liveSpielt(): boolean { const a = this.lage.arr; return !!a && (a.status === 1 || a.status === 2); }
  // slot A..D = the container letter of a place (1..4); the channel is the container strip of that place
  private slotGruppe(p: Projekt, slot: Slot): Projekt['gruppen'][number] | undefined {
    const id = modulAmPlatz(p, slot);
    return id === undefined ? undefined : p.gruppen.find((x) => x.id === id);
  }
  private kanalZuUndBekannt(slot: Slot): boolean {
    const p = this.offen?.projekt, g = p && this.slotGruppe(p, slot), platz = p && g ? platzVonGruppe(p, g.id) : null;
    if (platz === null || platz === undefined) return false;
    const kanal = pultContainerPfad[platz - 1];
    return this.lage.reglerWert(`${kanal}/fader`) !== null && !this.kanalOffenGesehen(kanal);
  }
  private liveFaderFaellig(): boolean {
    const o = this.offen;
    if (!o?.projekt.live || this.liveFaderWartend.size === 0 || this.liveSpielt()) return false;
    return SLOTS.some((slot) => {
      const g = this.slotGruppe(o.projekt, slot);
      return !!g && this.liveFaderWartend.has(g.id) && this.kanalZuUndBekannt(slot);
    });
  }
  private async liveModulFaderLauf(modus: 'oeffnen' | 'wartend'): Promise<{ angehoben: string[]; gemeldet: string[] }> {
    const aus = { angehoben: [] as string[], gemeldet: [] as string[] };
    for (let versuch = 0; versuch < 2; versuch++) {
      aus.angehoben.length = 0; aus.gemeldet.length = 0;
      const o = this.offen;
      if (!o?.projekt.live) return aus;
      const befehle: unknown[] = [];
      const hebt: string[] = [];
      for (const slot of SLOTS) {
        const g = this.slotGruppe(o.projekt, slot);
        if (!g) continue;
        if (modus === 'oeffnen' ? g.fader_db === -200 : this.liveFaderWartend.has(g.id)) {
          if (g.fader_db !== -200) { this.liveFaderWartend.delete(g.id); continue; }   // moved by hand meanwhile: nothing to do
          if (this.kanalZuUndBekannt(slot) && (modus === 'oeffnen' || !this.liveSpielt())) {
            befehle.push({ befehl: 'gruppenspur_aendern', gruppe_id: g.id, fader_db: 0 });
            aus.angehoben.push(slot); hebt.push(g.id);
          } else { this.liveFaderWartend.add(g.id); aus.gemeldet.push(slot); }
        }
      }
      if (befehle.length === 0) return aus;
      try {
        await this.aendern({ rev: o.projekt.rev, label: 'Live module fader 0 dB', befehle }, 'andreas');
        for (const id of hebt) this.liveFaderWartend.delete(id);
        return aus;
      } catch (e) {
        if (versuch === 1 || (e as { fehler?: string }).fehler === 'beschaeftigt') {
          for (const id of hebt) {
            this.liveFaderWartend.add(id);
            if (this.liveFaderGemeldet.has(id)) continue;
            this.liveFaderGemeldet.add(id);
            this.ctx.log({ typ: 'live_modul_fader_fehler', gruppe: id, fehler: (e as Error).message });
          }
          return { angehoben: [], gemeldet: aus.gemeldet.concat(aus.angehoben) };
        }
      }
    }
    return aus;
  }
  // The live container follows the core tempo (display and render length only: the project says 120, the core plays 128). Only while no deck plays,
  // because tempo_setzen is refused then; with a playing deck it stays as it is. Never fails the open.
  private async liveTempo(quelle: Quelle): Promise<void> {
    const o = this.offen, bpm = this.lage.uhr?.bpm;
    if (!o?.projekt.live || typeof bpm !== 'number' || !(bpm >= TEMPO_MIN && bpm <= TEMPO_MAX) || this.lage.deckLaeuft()) return;
    if (Math.abs(o.projekt.tempo_bpm - bpm) < 1e-9) return;
    const d = { rev: o.projekt.rev, label: 'Live tempo', befehle: [{ befehl: 'tempo_setzen', bpm }] };
    try { await this.aendern(d, quelle); } catch { /* shown tempo only */ }
  }
  private liveOeffnenOhneTempo(quelle: Quelle, bestaetigt = false, nurWennLeer = false): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle);
      if (this.offen?.projekt.live) return { code: 200, j: { slug: this.offen.slug, slots: liveSlotAntwort(this.offen.projekt) } };
      if (nurWennLeer && this.offen) {
        throw new ProjFehler(409, 'projekt_offen',
          { text: 'A project is open. Open the live container first (LIVE); the loop deck never closes a project by itself.' });
      }
      this.sperreOeffnen(); this.sperreLiveLaeuft(quelle, bestaetigt); this.sperreFremderTransport(quelle);
      return this.oeffnetGerade(async () => {
        try {
          // a project named `live` without the flag is somebody's project: opening it as the container would be opened as the container (nothing is sent before)
          if (this.projekte.lies(LIVE_SLUG).live !== true) {
            throw new ProjFehler(409, 'kein_liveprojekt_flag', { text: 'a project named live exists without the live flag; rename it' });
          }
        } catch (e) {
          if (e instanceof ProjFehler) throw e;
          if (!(e instanceof AblageFehler) || e.fehler !== 'unbekannt') throw e;
          const { slug } = this.projekte.lege('Live', { live: true });
          if (slug !== LIVE_SLUG) throw new ProjFehler(409, 'beschaeftigt', { text: 'the folder for the live container is taken by something else' });
        }
        const r = await this.oeffneIntern(LIVE_SLUG, quelle);
        if (r.code !== 200) return r;
        return { code: 200, j: { slug: LIVE_SLUG, slots: liveSlotAntwort(this.brauchOffen().projekt) } };
      });
    });
  }
  // The live container plays a loop in a set: while its transport runs (status 1 or 2) and a deck plays, opening or creating another project would
  // stop it. Cypher is always refused; Andreas only with bestaetigt (the page's confirm), then the switch goes through and stops the transport as always.
  private sperreLiveLaeuft(quelle: Quelle, bestaetigt: boolean): void {
    const a = this.lage.arr;
    if (!this.offen?.projekt.live || !a || !(a.status === 1 || a.status === 2) || !this.lage.djLaeuft()) return;
    if (quelle === 'andreas' && bestaetigt) return;
    throw new ProjFehler(409, 'live_laeuft', { text: 'the live container is running while a deck plays; opening another project would stop it '
      + '(Andreas must confirm, Cypher cannot)' });
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
    this.gleicheDekodiertAb(projekt, true, slug);   // the slug: this.offen is still the project before
    const merk = { laden: false, loop: false, tempo: false, reglerNach: [], stummStart: [], stifte: false };
      this.offen = { slug, projekt, verlauf: o.verlauf, merk, vorhoeren: new Map() };
    this.liveFaderWartend.clear(); this.liveFaderGemeldet.clear();
    // every open of the live project (queued behind this job)
    this.liveFaderLauf = projekt.live ? Promise.resolve().then(() => this.liveModulFader('oeffnen')) : null;
    this.meldeStand(this.offen);               // 1.8 S3 (D13): the core follows the opened project (tracks of the one before are disarmed)
    this.meldeEinsammeln(this.offen);
    this.hosts.abgleich(projekt);              // plan 1.11 task 7: the hosts start in the background; open never waits for one
    this.instrumente.abgleich(projekt);        // plan 1.11 task 17: the same for the plugin instrument hosts
    this.wacheStart();
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
    const [kern, bk] = await Promise.all([this.synchronisiere(quelle, wieder),
      wieder || !projekt.baukasten ? Promise.resolve(null) : this.bk.wiederherstellen(projekt, quelle, { schonGeladenUeberspringen: true }), autoFrei]);
    if (wieder && projekt.baukasten) kern.baukasten = { uebersprungen: 'wiederanlauf' }; else if (bk) kern.baukasten = bk;
    if (projekt.live) {   // the playback is loaded: now the container sources (a refusal is reported, it never fails the open)
      const abgelehnt = await this.sendeContainer(projekt, 'beide', quelle);
      if (abgelehnt.length) { kern.container_abgelehnt = abgelehnt; this.ctx.log({ typ: 'proj_container_abgelehnt', abgelehnt }); }
    }
    if (wieder) {
      const n = this.uebernimmMixer(this.offen);
      kern.wiederanlauf = true; kern.mixer_uebernommen = n;
    }
    const offenes = this.offen;
    this.ctx.log({ typ: 'proj_offen', slug, nachgezogen: o.nachgezogen, quelle, wiederanlauf: wieder });
    this.ctx.verteile({ a: 'proj', f: { slug, rev: offenes.projekt.rev, label: 'Open', quelle } });
    for (const h of this.offenHaken) try { h(slug); } catch (e) { this.ctx.log({ typ: 'proj_offen_haken_fehler', fehler: (e as Error).message }); }
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
    await this.hostZustandSichern('schliessen');                         // plan 1.11 D8: the plugin states of the closing project (at most 3 s)
    this.rueckwegSpeichern();                                            // audit U03: hand values that came during that await (nothing awaits from here on)
    this.transportQuelle = null;
    this.offen = null;
    this.hosts.abgleich(null);                                           // the hosts of the closed project stop in the background
    this.instrumente.abgleich(null);                                     // first: the swap back to Surge is queued before the mirror asks for the slot
    this.wacheStopp();
    void this.surge.gleiche(null);                                       // 1.9 U5: the hosts go back to the values they had before this project's entries
    try { o.verlauf.schliesse(); } catch (e) { this.ctx.log({ typ: 'proj_verlauf_fehler', slug: o.slug, fehler: (e as Error).message }); }
  }
  // Beim Beenden des Servers: ausstehenden Mixer-Eintrag schreiben, Sperre freigeben
  // plan 1.11 D8: the server ends: the plugin states are written first (at most 3 s), then schliesse()
  async beende(): Promise<void> { await Promise.all([this.hosts.beende(), this.instrumente.beende()]); }
  schliesse(): void {
    this.hosts.halt();
    this.instrumente.halt();
    this.aufAuto.beende();
    this.analysen?.stoppe();
    if (this.rueckwegTimer) { clearTimeout(this.rueckwegTimer); this.rueckwegTimer = null; }
    this.wacheStopp();
    this.rueckwegSpeichern();
    const o = this.offen;
    this.offen = null;
    if (o) try { o.verlauf.schliesse(); } catch { /* der Server endet ohnehin */ }
  }

  // Wiedergabe laden, Mixer-Regler (alle), Loop, Metronom, Leeren der KI-Maske; alles parallel, Quittungen abgewartet
  // wiederanlauf (Spec 6.21, 6.30): der Kern gewinnt ganz. Keine neue Wiedergabe, kein Loop, kein Metronom; von den Spur-Reglern
  // nur die mit unbekanntem Ist-Wert (für genau diese gewinnt das Projekt).
  private async synchronisiere(quelle: Quelle, wiederanlauf = false): Promise<Record<string, unknown>> {
    const o = this.brauchOffen();
    const soll: Soll[] = wiederanlauf ? this.unbekannteSpurRegler(o.projekt)
      : alleRegler(o.projekt);
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
    const bkFehlt = bkGraphenFehlen(o.projekt);   // arr-bk: a stage whose graph file is gone plays dry; the answer says which
    return { wiedergabe, regler: regler.ergebnis.length, regler_nicht_gesendet: regler.nicht_gesendet, ...reglerBefund(regler.ergebnis),
      loop, metronom, ki, ...(bkFehlt.length > 0 ? { bk_graph_fehlt: bkFehlt } : {}) };
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
      this.meldeStand(o);
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: w.projekt.rev, label: meta.label, quelle: 'andreas' } });
      return befehle.length;
    } catch (e) {
      this.ctx.log({ typ: 'proj_wiederanlauf_fehler', slug: o.slug, fehler: (e as Error).message });
      return 0;
    }
  }

  // Container core M5: /k/container/quelle for every container whose source differs from what the core was last told (`alle`: all four, the replay after a
  // core restart). Order (F5): a container that gets a module (art 2) is told AFTER the playback swap (the module exists), every other one BEFORE it (the
  // group is dropped last), so `welche` picks the half. A receipt of status 6 is a refusal and is returned; no receipt (no core) is not told, so the
  // next call sends it again. Production projects have no places: nothing is sent.
  private async sendeContainer(p: Projekt, welche: 'vor' | 'nach' | 'beide', quelle: Quelle, alle = false): Promise<{ container: number; art: number; status: number; grund: string }[]> {
    const soll = containerQuellen(p);
    if (!soll) return [];
    const abgelehnt: { container: number; art: number; status: number; grund: string }[] = [];
    for (let i = 0; i < 4; i++) {
      if (!alle && soll[i] === this.containerGesendet[i]) continue;
      if (welche !== 'beide' && (soll[i] === 2) !== (welche === 'nach')) continue;
      const q = await this.kern.containerQuelle(i + 1, soll[i], quelle);
      if (quittungAbgelehnt(q)) { abgelehnt.push({ container: i + 1, art: soll[i], status: q!.status, grund: q!.grund }); continue; }
      if (q !== null) this.containerGesendet[i] = soll[i];
    }
    return abgelehnt;
  }
  // Spec 6.1: neue Wiedergabe-Nummer, Datei schreiben, /k/arr/laden; project.json führt die Nummer als wiedergabe_rev (ohne neue rev)
  private async ladeWiedergabe(quelle: Quelle, vorhoeren?: ReadonlyMap<string, string>): Promise<Record<string, unknown>> {
    const o = this.brauchOffen();
    try {
      const nr = this.schreibeNeueWiedergabe(o.projekt);
      if (typeof nr !== 'number') return nr;
      this.speichereStand(o);
      const ladeNr = this.schreibeVorhoerWiedergabe(o.projekt, vorhoeren ?? o.vorhoeren) ?? nr;
      return { nr: ladeNr, quittung: await this.ladeNr(ladeNr, quelle, nr) };
    } finally {
      o.merk.stummStart = [];   // the initial mute belongs to this one load (uebernimm); later loads leave the rows as they are
    }
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
  // `live`: the playback goes to the core (the host stages are written from the host manager); the export paths write no host stage as ready
  private uebersetzeFuer(p: Projekt, nr: number, vorhoeren?: ReadonlyMap<string, string>, live = true, ohneHost?: ReadonlySet<number>): Wiedergabe {
    const ohne = new Set([...(ohneHost ?? []), ...this.hosts.ausgelassen()]);   // plus the stages whose latency the core would refuse (latenz_zu_gross)
    return uebersetze(p, {
      geraetFx, nr, audioOrdner: path.join(this.arbeitsordner, 'audio'), frames: (sha) => this.cache.frames(sha),
      transienten: this.transienten,
      arbeitsordner: this.arbeitsordner, ...(vorhoeren ? { vorhoeren } : {}),
      ...(live && this.offen?.merk.stummStart.length ? { stummStart: new Set(this.offen.merk.stummStart) } : {}),
      ...(live ? { host: (slot: number) => this.hosts.stufe(slot), ...(ohne.size ? { ohneHost: ohne } : {}) } : {}) });
  }
  // plan 1.11 task 7: the host manager asks for a new playback (a host became ready, failed or changed its latency)
  private hostNeuLaden(): void {
    void this.seriell(async () => {
      const o = this.offen;
      if (!o) return;
      if (this.sperren > 0) { o.merk.laden = true; return; }
      const w = await this.ladeWiedergabe('andreas');
      if (typeof w.nr !== 'number') this.ctx.log({ typ: 'host_neu_laden_abgelehnt', fehler: w.fehler });
      const q = w.quittung as { status: number; grund: string } | null | undefined;
      if (q && [4, 6, 7, 8].includes(q.status)) this.hosts.ladeAbgelehnt(q.grund);   // pdc_zu_lang: the stage with the most latency leaves the playback
    }).catch((e) => this.ctx.log({ typ: 'host_neu_laden_fehler', fehler: (e as Error).message }));
  }
  // The host slot -> strip map of a project, and the loads a change needs: an entry into a slot another strip held in the last playback (or released
  // less than `latenz + 480` samples ago) waits for a load without that stage first (removal in one load, entry in a later one).
  private hostBelegung(p: Projekt): Map<number, string> {
    return new Map(alleInserts(p).filter((x) => x.insert.art === 'host').map((x) => [x.insert.slot, x.strangId] as const));
  }
  private async ladeNr(ladeNr: number, quelle: Quelle, schluessel: number = ladeNr): Promise<Quittung> {
    const v = this.hostVorab.get(schluessel);
    this.hostVorab.delete(schluessel);
    if (v) {
      if (v.zwischen !== null) {
        await this.kern.laden(v.zwischen, quelle);
        for (const s of v.konflikt) this.hostFreiMs.set(s, Date.now());
      }
      const warte = Math.max(0, ...v.eintritt.map((s) => (this.hostFreiMs.get(s) ?? -Infinity) + (v.span.get(s) ?? 0) - Date.now()));
      if (warte > 0) await schlaf(warte);
    }
    const q = await this.kern.laden(ladeNr, quelle);
    if (v) for (const s of v.geraeumt) this.hostFreiMs.set(s, Date.now());
    return q;
  }
  // Wiedergabe-Datei zum Stand p mit der nächsten Nummer schreiben und p.wiedergabe_rev setzen (ohne Speichern, ohne Laden). Gibt die Nummer zurück
  // oder, wenn der Übersetzer ablehnt, {nr: null, fehler, text}.
  private schreibeNeueWiedergabe(p: Projekt): number | Record<string, unknown> {
    // plan 1.11 task 7: a host slot that would change strips inside this load: first a playback without the entering stage, then this one
    const neuB = this.hostBelegung(p), konflikt = [...neuB].filter(([s, st]) => this.hostBelegt.has(s) && this.hostBelegt.get(s) !== st).map(([s]) => s);
    const eintritt = [...neuB.keys()].filter((s) => this.hostBelegt.get(s) !== neuB.get(s) || this.hostFreiMs.has(s));
    const geraeumt = [...this.hostBelegt.keys()].filter((s) => !neuB.has(s) || konflikt.includes(s));
    // samples -> ms, with a margin
    // the entry wait follows the latency of the stage that LEFT the slot (the one in the hosts map before the abgleich), not of the entering one
    for (const s of geraeumt) this.hostFreiLatenz.set(s, this.hosts.stufe(s).latenz);
    const span = new Map([...neuB.keys(), ...geraeumt].map((s) => [s, ((this.hostFreiLatenz.get(s) ?? this.hosts.stufe(s).latenz) + 480) / 48 + 30] as const));
    this.hosts.extrasSetzen(p);
    const zwischenNr = konflikt.length ? this.zaehler.naechste() : null;
    const nr = this.zaehler.naechste();
    let w;
    try {
      if (zwischenNr !== null) schreibeWiedergabe(this.arbeitsordner, this.uebersetzeFuer(p, zwischenNr, undefined, true, new Set(konflikt)));
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
    if (this.offen) this.offen.merk.stifte = false;   // the new file holds every pin of `p` (Kraken patch field)
    this.hostBelegt = neuB;
    if (neuB.size || geraeumt.length || this.hostFreiMs.size) this.hostVorab.set(nr, { zwischen: zwischenNr, konflikt, eintritt, geraeumt, span });
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

  /** The shas of the audio clips and of the loop deck cells of the open project (the decode cap never removes them). */
  offeneShas(): Set<string> {
    const aus = new Set<string>();
    if (this.offen) {
      for (const c of alleAudioClips(this.offen.projekt)) aus.add(c.quelle.sha256);
      for (const z of alleZellen(this.offen.projekt)) aus.add(z.sha256);
    }
    return aus;
  }
  private readonly deckelGemeldet = new Set<string>();
  private readonly deckelSperre = { bis: 0 };
  private deckelDekodiert(frisch: string | null): void {
    deckleDekodiert({ arbeitsordner: this.arbeitsordner, projekte: this.projekte, offeneShas: () => this.offeneShas(), frisch,
      log: (z) => this.ctx.log(z), gemeldet: this.deckelGemeldet, sperre: this.deckelSperre });
  }

  // --- Dekodier-Cache (Spec 2.8) ----------------------------------------------------------------------------------------
  private zustandVon(sha: string): DekodiertZustand { return this.cache.zustand(sha); }
  // Pfad einer Quelle: über den Katalog (Spec 2.9: sha ist die Identität, der Pfad nur Hinweis); ohne Katalog-Treffer der Hinweis, wenn da.
  private quellPfad(sha: string, hinweis: string, slug: string | null = this.offen?.slug ?? null): string | null {
    let katalogPfad: string | null = null;
    if (this.katalog) {
      try {
        const z = this.katalog.eintrag(sha);
        if (z && z.schutz !== 'ableton' && z.pfad) katalogPfad = z.pfad;
      } catch { /* Katalog fehlt oder ist kaputt: Hinweis versuchen */ }
    }
    return loeseQuelle({ sha256: sha, hinweis, projektOrdner: slug !== null ? path.resolve(this.projekte.wurzelPfad, slug) : null, katalogPfad });
  }
  /** ANALYZE slice 2: the file and the title of a catalogue entry (null: no catalogue, unknown sha, protected entry). */
  katalogQuelle(sha: string): { pfad: string; name?: string } | null {
    if (!this.katalog) return null;
    try {
      const z = this.katalog.eintrag(sha);
      if (!z || z.schutz === 'ableton' || !z.pfad) return null;
      const name = z.titel ?? z.name;
      return { pfad: z.pfad, ...(name ? { name } : {}) };
    } catch { return null; }
  }
  /** The resolver for the collector and the collect route (the same as the session's own). */
  quellePfadVon(sha: string, hinweis: string): string | null { return this.quellPfad(sha, hinweis); }
  // storage layout A5: a removable source is copied into the project folder in the background; once after open, once after a change that
  // adds or replaces an audio clip. The collector drops a second report for the same folder while one waits.
  private meldeEinsammeln(o: Offen): void {
    // fixed slug: a project switch while the job waits must not change the lookup
    const projektOrdner = path.resolve(this.projekte.wurzelPfad, o.slug);
    this.einsammler?.melde({ projekt: o.projekt, projektOrdner, quellPfad: (s, h) => this.quellPfad(s, h, o.slug) });
  }
  // Welle der Seite (S6 Task 14): Pfad einer sha, die ein Audio-Clip des offenen Projekts trägt (Stems, Takes). Der Pfad kommt aus dem
  // Projekt, nie aus der Anfrage; eine sha ohne Clip im offenen Projekt gibt null.
  projektQuellPfad(sha: string): string | null {
    const o = this.offen;
    if (!o) return null;
    for (const c of alleAudioClips(o.projekt)) if (c.quelle.sha256 === sha) return this.quellPfad(sha, c.quelle.pfad_hinweis);   // take clips too (R9)
    const zellHinweis = alleZellQuellen(o.projekt).get(sha);   // a loop deck cell: its project-relative file
    return zellHinweis === undefined ? null : this.quellPfad(sha, zellHinweis);
  }
  // Setzt dekodiert aller Audio-Clips (ohne rev, Spec 6.6) und fordert fehlende Dekodierungen an. fehlerNeu: auch Fehlgeschlagene neu versuchen.
  // Rückgabe: die shas, deren Zustand sich geändert hat (Haupt- und Take-Clips); ob das die Wiedergabe betrifft, sagt betrifftWiedergabe.
  private gleicheDekodiertAb(p: Projekt, fehlerNeu: boolean, slug: string | null = this.offen?.slug ?? null): Set<string> {
    const geaendert = new Set<string>();
    for (const c of alleAudioClips(p)) {
      let z = this.zustandVon(c.quelle.sha256);
      if (z === 'nein' || (fehlerNeu && z === 'fehler')) {
        const pfad = this.quellPfad(c.quelle.sha256, c.quelle.pfad_hinweis, slug);
        z = pfad ? this.cache.fordereAn(c.quelle.sha256, pfad) : 'fehler';
      }
      if (z === 'fertig') this.cache.beruehre(c.quelle.sha256);   // a project uses this decode: the size cap removes the unused ones first
      if (c.dekodiert !== z) { c.dekodiert = z; geaendert.add(c.quelle.sha256); }
    }
    // loop deck cells: decoded like clip sources. A cell carries no state field, so the last seen state per sha is kept here
    const zellShas = alleZellQuellen(p);
    for (const sha of this.zellZustand.keys()) if (!zellShas.has(sha)) this.zellZustand.delete(sha);   // no cell carries it any more
    for (const [sha, hinweis] of zellShas) {
      let z = this.zustandVon(sha);
      if (z === 'nein' || (fehlerNeu && z === 'fehler')) {
        const pfad = this.quellPfad(sha, hinweis, slug);
        z = pfad ? this.cache.fordereAn(sha, pfad) : 'fehler';
      }
      if (z === 'fertig') this.cache.beruehre(sha);
      if (this.zellZustand.get(sha) !== z) { this.zellZustand.set(sha, z); geaendert.add(sha); }
    }
    return geaendert;
  }
  // 1.14 comping: the one place that decides whether a changed decode state reaches the playback. Today only main clips are played, so a take-only
  // sha changes nothing there, unless a track is auditioning that take.
  private betrifftWiedergabe(p: Projekt, geaenderteShas: Iterable<string>): boolean {
    const shas = new Set(geaenderteShas);
    if (shas.size === 0) return false;
    for (const sha of alleZellQuellen(p).keys()) if (shas.has(sha)) return true;   // a loop deck cell is played from its decode
    for (const s of p.spuren) for (const c of s.clips) if (c.art === 'audio' && shas.has(c.quelle.sha256)) return true;
    // 1.14: a take clip counts when a track auditions that take
    for (const [spurId, takeId] of this.offen?.vorhoeren ?? []) {
      const take = p.spuren.find((s) => s.id === spurId)?.takes?.find((x) => x.id === takeId);
      if (take?.clips.some((c) => c.art === 'audio' && shas.has(c.quelle.sha256))) return true;
    }
    return false;
  }
  private readonly zellZustand = new Map<string, DekodiertZustand>();
  private dekodiertEreignis(e: DekodierEreignis): void {
    void this.seriell(async () => {
      const o = this.offen;
      if (!o) return;
      for (const c of alleAudioClips(o.projekt)) {
        if (c.quelle.sha256 !== e.sha || c.dekodiert === e.zustand) continue;
        c.dekodiert = e.zustand;
        this.ctx.verteile({ a: 'proj', f: { clip_id: c.id, dekodiert: e.zustand } });   // ohne neue rev (Festlegung V1)
      }
      if (alleZellQuellen(o.projekt).has(e.sha)) this.zellZustand.set(e.sha, e.zustand);
      if (e.zustand === 'fertig' && this.betrifftWiedergabe(o.projekt, [e.sha])) await this.ladeOderMerke('andreas');
    }).catch((x) => this.ctx.log({ typ: 'proj_dekodier_fehler', sha: e.sha, fehler: (x as Error).message }));
  }

  // --- ändern -----------------------------------------------------------------------------------------------------------
  // source resolution of a command list: see session_sources.ts
  private tempoQuelleFuer(z: Zeile, sha: string): TempoQuelle {
    return this.quellen.tempoQuelleFuer(z, sha);
  }
  private loeseQuellenAuf(befehle: unknown[], projekt: Projekt):
    { befehle: unknown[]; quellen: Map<string, string>; hinweise: Hinweis[]; wuensche: Anforderung[] } {
    return this.quellen.loeseQuellenAuf(befehle, projekt);
  }
  // 1.9 U5 (O28 on Surge): the current host values of the parameters that geraet_richtung commands of this list need and the track's map does not hold
  // yet (one read per slot), and whether filter 1 is on in the patch of each host a filter word goes to (one state read per slot; a word that hangs only
  // on filter 1 does nothing with filter 1 off, richtung_wirkungslos). undefined: nothing to read. A host that does not answer leaves the values out;
  // the command then refuses wirt_wert_unbekannt (a filter state that is not known never blocks).
  private async surgeIstFuer(p: Projekt, befehle: unknown[]):
    Promise<{ ist: (slot: number, name: string) => number | null; filter1An: (slot: number) => boolean | null } | undefined> {
    const noetig = new Map<number, Set<string>>();
    const filterSlots = new Set<number>();
    for (const b of befehle) {
      const x = b as Koerper;
      if (x?.befehl !== 'geraet_richtung' || typeof x.spur_id !== 'string' || typeof x.wort !== 'string') continue;
      const g = sucheSpur(p, x.spur_id)?.geraet;
      if (g?.art !== 'wirt' || g.name !== 'surge') continue;
      if (Object.hasOwn(SURGE_RICHTUNGEN, x.wort) && nurFilter1(x.wort)) filterSlots.add(g.slot);
      for (const n of surgeParameterVon(x.wort)) if (!Object.hasOwn(g.parameter ?? {}, n)) noetig.set(g.slot, (noetig.get(g.slot) ?? new Set<string>()).add(n));
    }
    if (noetig.size === 0 && filterSlots.size === 0) return undefined;
    const gelesen = new Map<string, number>();
    for (const [slot, namen] of noetig) {
      const w = await this.surge.ist(slot, [...namen]);
      if (w) for (const [n, v] of Object.entries(w)) gelesen.set(`${slot}:${n}`, v);
    }
    const filter = new Map<number, boolean>();
    for (const slot of filterSlots) {
      const an = await this.surge.filter1An(slot);
      if (an !== null) filter.set(slot, an);
    }
    return { ist: (slot, name) => gelesen.get(`${slot}:${name}`) ?? null, filter1An: (slot) => filter.get(slot) ?? null };
  }
  private pruefeRev(o: Offen, rev: unknown): void {
    if (rev === REV_JETZT) return;   // an in-process caller (the loop deck writes): the rev of the moment the write runs, read inside the serial chain
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
      const musterBerichte: MusterMeldung[] = [];
      if (befehle.length === 0) {                                   // Slice 3a: alles war ein warp_auto, das nur eine Analyse anstieß
        this.starteAnalysen(o, quelle, wuensche, alt);
        return { code: 200, j: { rev: alt.rev, projekt: alt, hinweise } };
      }
      if (befehle.some((b) => (b as Koerper)?.befehl === 'tempo_setzen') && this.lage.deckLaeuft()) throw new ProjFehler(409, 'deck_laeuft');
      if (this.aufnahmeLauf && befehle.some((b) => (b as Koerper)?.befehl === 'tempo_setzen'))
        throw new ProjFehler(409, 'beschaeftigt', { text: 'a recording is running; the tempo cannot change now' });
      this.pruefeAufnahmeSpuren(o.projekt, befehle);
      // 1.9 U5: a direction word on a Surge track starts from what the host plays now; read before the (synchronous) command run
      const surgeIst = await this.surgeIstFuer(o.projekt, befehle);
      await this.musterVorlauf(befehle, o.projekt);               // strudel-clip: the children run here, async; the command run below only reads the cache
      // the host read is an await: a writer outside the queue (uebernimm: freeze, export, recording, stems) can have replaced the project meanwhile;
      // the caller's rev is checked again (spec 6.31), and the open project must still be the one this call started with
      if (this.offen !== o) throw new ProjFehler(409, 'projekt_gewechselt');
      this.pruefeRev(o, d.rev);
      // quelle: Herkunft für spur_neu (Spec 6.22)
      const probe = fuehreListeAus(o.projekt, befehle, {
        geraetFx, quelle, ordner: path.resolve(this.projekte.wurzelPfad, o.slug), transienten: this.transienten, graphArt, steckfeldVon: steckfeldLookup, kitDa,
        presetLies: this.presetLies, surgeBereich,
        surgePatchDa, pluginDa: (pl) => pl.format !== 'vst3' || fs.existsSync(pl.pfad),
        musterUebersetze: uebersetzeAusCache, kitKlaenge, musterMeldung: (m) => musterBerichte.push(m),
        ...(this.pluginIndex ? { pluginIndex: this.pluginIndex } : {}),
        ...(surgeIst ? { surgeIst: surgeIst.ist, surgeFilter1An: surgeIst.filter1An } : {}) });
      if (probe.vor.length === 0) {
        this.starteAnalysen(o, quelle, wuensche, alt);
        return { code: 200, j: { rev: o.projekt.rev, projekt: o.projekt, ...(hinweise.length ? { hinweise } : {}) } };
      }
      this.pruefeMarkerInQuelle(o.projekt, probe.projekt);
      this.pruefeSperre(o.projekt, probe.projekt, probe.betrifft_wiedergabe);
      // DJ view places (decision 10), by place (container core D3): every change of type or group at place N is refused with kanal_offen while the strip of
      // that container (pultContainerPfad) is open (trim + fader above -26 dB, a planned ramp, or PFL on), whoever sends it and whatever the new type is
      // (strudel, loops, track, leer, stems, seq). One exception, parking: a place that holds a SEQ deck or a loop deck may be switched away (the deck stays
      // in the project, silent; the page mutes it first), except that Cypher never takes a SEQ deck away from an open strip. Step edits, undo, redo and the
      // open of a project are not gated (known limit, AUFRUF.md).
      if (probe.projekt.live) {
        for (const platz of [1, 2, 3, 4] as const) {
          const vor = o.projekt.plaetze?.[platz - 1], nach = probe.projekt.plaetze?.[platz - 1];
          if (!vor || !nach) continue;
          const gleich = vor.typ === nach.typ && ('gruppe' in vor ? 'gruppe' in nach && vor.gruppe === nach.gruppe : !('gruppe' in nach));
          if (gleich) continue;
          const kanal = pultContainerPfad[platz - 1];
          const parken = vor.typ === 'seq' || vor.typ === 'loops';
          if (parken && !(vor.typ === 'seq' && quelle === 'cypher')) continue;
          if (!this.kanalBelegtGesehen(kanal)) continue;
          if (parken) throw new ProjFehler(409, 'kanal_offen', { platz, kanal, text: `the channel ${kanal} of place ${platz} is open; Cypher does not remove a SEQ deck that is playing` });
          throw new ProjFehler(409, 'kanal_offen', { platz, kanal, text: `the channel ${kanal} of place ${platz} is open; close it (fader down, PFL off) before the place changes to ${nach.typ}` });
        }
      }
      // Spec 6.31 (Leistung): die Probe IST die Ausführung; aendere rechnet sie nicht noch einmal. Gültig, weil vollziehe nach dem Warten auf die
      // Quittungen prüft, dass o.projekt noch genau der Stand ist, gegen den sie gerechnet wurde (sonst 409 rev_veraltet).
      const projekt = o.projekt;
      // task 8: the value before a page write of a gesture (not for the take's own write)
      if (erwartet === undefined && quelle === 'andreas') this.aufAuto.merkeBasen(projekt, probe.projekt);
      const antwort = await this.vollziehe(o, quelle, probe.regler_aenderungen,
        (h) => aendere(o.verlauf, projekt, befehle as never, meta, h, { ergebnis: probe }), quellen, probe.betrifft_wiedergabe, probe.stift_aenderungen ?? [], probe.projekt);
      if (antwort.code === 200) this.starteAnalysen(o, quelle, wuensche, alt);
      const alle = antwort.code === 200 ? [...hinweise, ...(probe.hinweise ?? []), ...this.einsRueckweg(o, d.befehle, quelle)] : hinweise;
      const mitMuster = (j: object): object => (musterBerichte.length ? { ...j, muster: musterBerichte } : j);   // strudel-clip: one report per generated clip
      return antwort.code === 200 && (alle.length || musterBerichte.length)
        ? { code: 200, j: mitMuster(alle.length ? { ...(antwort.j as object), hinweise: alle } : (antwort.j as object)) } : antwort;
    });
  }
  // strudel-clip: the Strudel side of every clip_aus_muster is evaluated in child processes BEFORE the synchronous command run, asynchronously, so the
  // server thread never waits for a pattern. First the patterns that are known from the list itself (in parallel, at most MUSTER_KINDER_MAX at a time),
  // then a dry run of the list finds those that depend on earlier commands of the same list (a clip_id whose length an earlier command changes); each
  // round evaluates what the dry run found missing, until it finds nothing. Every outcome (answer, time limit, crash) is cached, so the real run only reads.
  private async musterVorlauf(befehle: unknown[], projekt: Projekt): Promise<void> {
    const muster = befehle.filter((b) => (b as Koerper)?.befehl === 'clip_aus_muster');
    if (muster.length === 0) return;
    if (muster.length > MAX_MUSTER_JE_AUFRUF) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: `at most ${MAX_MUSTER_JE_AUFRUF} clip_aus_muster commands in one call` });
    }
    const bekannt: Anfrage[] = [];
    for (const b of muster) {
      const x = b as Koerper;
      const g = typeof x.clip_id === 'string' ? sucheClip(projekt, x.clip_id) : undefined;
      const code = typeof x.code === 'string' ? x.code : g?.clip.art === 'midi' ? g.clip.muster?.code : undefined;
      const takte = typeof x.takte === 'number' ? x.takte : g ? g.clip.laenge_beats / 4 : null;
      if (typeof code === 'string' && code.trim() !== '' && code.length <= 8192 && (takte === null || (Number.isFinite(takte) && takte > 0))) {
        bekannt.push({ code, takte });
      }
    }
    await vorlauf(bekannt);
    for (let runde = 0; runde <= MAX_MUSTER_JE_AUFRUF; runde++) {
      const fehlend: Anfrage[] = [];
      try {
        fuehreListeAus(projekt, befehle, { transienten: this.transienten, graphArt, steckfeldVon: steckfeldLookup, kitDa, presetLies: this.presetLies,
          surgeBereich, kitKlaenge,
          musterUebersetze: (a) => { const r = ausCache(a); if (!r) fehlend.push(a); return r ?? uebersetzeAusCache(a); } });
      } catch { /* the real run reports its own refusals; here only the missing patterns count */ }
      if (fehlend.length === 0) return;
      await vorlauf(fehlend);
    }
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
      return this.umkehrVollzug(o, art, quelle);
    });
  }
  // The undo/redo step after the checks of the caller (also the roll-back of a change the core refused after the swap, see vollziehe)
  private umkehrVollzug(o: Offen, art: 'undo' | 'redo', quelle: Quelle): Promise<Antwort> {
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
      vergleich.betrifft_wiedergabe, [], probe);
  }

  // Regler zuerst (Quittungen abwarten), dann speichern. Spec 3.4: Ablehnung eines /k/teil setzt die Änderung zurück.
  // Spec 6.30 (Leistung): betrifft die Änderung die Wiedergabe, entsteht diese vor dem Speichern (im Haken speichere), und die EINE Speicherung
  // trägt ihre Nummer schon als wiedergabe_rev. Vorher speicherte ladeWiedergabe den Stand gleich danach ein zweites Mal.
  // Kraken patch field: `stifte` are the live pins of a light pin command; they go out right after the knob rows (/k/arr/stift, packets of
  // REGLER_PAKET) and are handled like
  // them: a stale rev puts the pins back to the OPEN state, a refusal writes nothing and puts the accepted pins back to `alt`.
  private async vollziehe(o: Offen, quelle: Quelle, regler: Soll[], schreibe: (h: Haken) => Wirkung, quellen: Map<string, string>,
    betrifftWiedergabe: boolean, stifte: StiftAenderung[] = [], ziel?: Projekt): Promise<Antwort> {
    const alt = o.projekt;
    const gesetzt = await this.kern.setzeRegler(regler, quelle);
    const stiftQ = stifte.length ? await this.kern.stifte(stifte, quelle) : [];
    const zurueck = async (stand: Projekt): Promise<void> => {
      await this.reglerZurueck(stand, gesetzt, quelle); await this.stifteZurueck(stand, stifte, stiftQ, quelle);
      };
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
    const stiftAbgelehnt = stifte.flatMap((e, i) => (quittungAbgelehnt(stiftQ[i])
      ? [{ spur: e.nr, satz: e.satz, zeile: e.zeile, spalte: e.spalte, grund: stiftQ[i]!.grund, status: stiftQ[i]!.status }] : []));
    if (stiftAbgelehnt.length) {
      await zurueck(alt);
      throw new ProjFehler(409, 'stift_abgelehnt', { stifte: stiftAbgelehnt, kern: stiftAbgelehnt[0].grund });
    }
    // Container core M5: a container that leaves a module (or goes empty) is told before the swap; a refusal changes nothing
    if (ziel?.live) {
      const nein = await this.sendeContainer(ziel, 'vor', quelle);
      if (this.offen !== o || o.projekt !== alt || o.projekt.rev !== alt.rev) {
        await zurueck(o.projekt);
        if (this.offen !== o) throw new ProjFehler(409, 'kein_projekt');
        throw new ProjFehler(409, 'rev_veraltet', { rev: o.projekt.rev });
      }
      if (nein.length) { await zurueck(alt); throw new ProjFehler(409, 'kern_lehnt_ab', { container: nein[0].container, status: nein[0].status, kern: nein[0].grund }); }
    }
    // Haken-Vertrag mit history.ts (speichereDannProtokolliere, Spec 6.31 festgehalten): speichere wird genau einmal mit dem NEUEN Stand gerufen, vor
    // dem Log-Eintrag; nur wenn das Log scheitert, folgt ein zweiter Aufruf mit dem alten Stand (zurückschreiben). vollziehe hängt an genau dieser
    // Reihenfolge: nur der erste Aufruf fordert Dekodieren an, gleicht dekodiert ab und schreibt die Wiedergabe (bereiteWiedergabe prüft die
    // Freeze-Sperre), damit die eine Speicherung die neue wiedergabe_rev trägt. Ruft history.ts speichere anders (öfter, später, mit einem anderen
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
    this.meldeStand(o);                        // 1.8 S3 (D13): also the way of undo and redo
    if (neueQuelle(alt, neu)) this.meldeEinsammeln(o);
    if (vorab.vorhoeren) this.setzeVorhoeren(o, vorab.vorhoeren);
    this.instrumente.abgleich(neu);                                        // plan 1.11 task 17: before the Surge mirror (it waits for a swapped slot)
    void this.surge.gleiche(neu);                                          // 1.9 U5: command, undo and redo (no await: the hosts answer in their own time)
    const kern: Record<string, unknown> = {};
    if (gesetzt.length) kern.regler = gesetzt.some((r) => r.quittung === null) ? 'kein_kern' : 'ok';
    if (stifte.length) {
      kern.stifte = stiftQ.some((q) => q === null) ? 'kein_kern' : 'ok';
      if (stiftQ.some((q) => quittungOk(q))) o.merk.stifte = true;   // the stored playback file lacks these pins: a core restart translates fresh
    }
    // Spec 6.30: die Freeze-Sperre gilt bis zum Laden. bereiteWiedergabe prüfte sie nach den Regler-Quittungen, zwischen dort und /k/arr/laden liegt
    // kein await. War sie gesetzt, bleibt die Änderung gespeichert und das Laden folgt nach der Freigabe.
    const nr = wiedergabe?.nr;
    const ladeNr = typeof wiedergabe?.laden === 'number' ? wiedergabe.laden : nr;   // 1.14: the audition file when one is on
    if (wiedergabe) kern.wiedergabe = typeof nr === 'number' ? { nr: ladeNr, quittung: await this.ladeNr(ladeNr as number, quelle, nr) } : wiedergabe;
    // Spec 6.31: Loop und Tempo sperrt 6.23 wie das Laden. Kam die Änderung vor der Sperre durch die Prüfung, werden sie gemerkt und nach der
    // Freigabe gesendet (holeNach, mit dem Stand von dann). Das Metronom sperrt 6.23 nicht.
    if (kanonisch(alt.loop) !== kanonisch(neu.loop)) {
      if (this.sperren > 0) { o.merk.loop = true; kern.loop = { aufgeschoben: true }; } else kern.loop = await this.kern.loop(neu, quelle);
    }
    if (kanonisch(alt.metronom) !== kanonisch(neu.metronom)) kern.metronom = await this.kern.metronom(neu, quelle);
    // a container that gets a module is told after the swap; a refusal takes the swap back (below); what the core reported stays in /lage
    const nach = neu.live ? await this.sendeContainer(neu, 'nach', quelle) : [];
    if (alt.tempo_bpm !== neu.tempo_bpm) {                                                               // Spec 2.7: ein Tempo-Weg
      if (this.sperren > 0) { o.merk.tempo = true; kern.tempo = { aufgeschoben: true }; } else kern.tempo = await this.kern.tempo(neu.tempo_bpm, quelle);
    }
    this.hosts.abgleich(neu);                  // plan 1.11 task 7: after the playback is loaded (a removed stage is gone from the core before its host stops)
    this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: neu.rev, label: w.eintrag.label, quelle } });
    if (nach.length) {
      // the core refused a container source after the swap: the change is taken back (one undo step), so a refusal never leaves the project changed
      const grund = { fehler: 'kern_lehnt_ab', text: 'the core refused the container change; the project was set back', container: nach[0].container, status: nach[0].status, kern: nach[0].grund };
      try {
        const zu = await this.umkehrVollzug(o, 'undo', quelle);
        return { code: 409, j: { ...grund, rev: o.projekt.rev, projekt: o.projekt, zurueckgenommen: zu.code === 200 } };
      } catch (e) {
        this.ctx.log({ typ: 'proj_kern_lehnt_ab_zurueck_fehler', fehler: (e as Error).message });
        return { code: 409, j: { ...grund, rev: neu.rev, projekt: neu, zurueckgenommen: false } };
      }
    }
    return { code: 200, j: { rev: neu.rev, projekt: neu, kern } };
  }
  // Kraken patch field: the accepted pins of a refused or stale change go back to the value `stand` holds (0 = no pin, also when the track or its
  // list is gone).
  // A track whose device has no `stifte` plays the graph defaults after a rebuild; the pin is then sent as 0, like the plan says (the project is the truth).
  private async stifteZurueck(stand: Projekt, liste: readonly StiftAenderung[], quittungen: readonly Quittung[], quelle: Quelle): Promise<void> {
    const zurueck = liste.flatMap((e, i) => {
      if (!quittungOk(quittungen[i] ?? null)) return [];
      const g = stand.spuren.find((x) => x.nr === e.nr)?.geraet;
      const l: readonly Stift[] = g?.art === 'intern' && g.name === 'bk' ? g.stifte ?? [] : [];
      const alt = l.find((x) => x[0] === e.satz && x[1] === e.zeile && x[2] === e.spalte);
      return [{ ...e, wert: alt ? alt[3] : 0 }];
    });
    if (zurueck.length) await this.kern.stifte(zurueck, quelle);
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
      // Spec 6.37 Nachtrag (Re-Review Fix7 RR7-2, rr7 T_start: der Kern beendet beim Start einen laufenden Lauf, core_arr.cpp:97, und Cypher wurde
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
      // Always the next master bar, also when nothing else plays: the master clock runs on and an immediate start put the project bar one off the
      // master bar one (SEQ deck 0.59 beats behind, 2026-11-14). The core has no way to re-anchor the clock, so the start waits for the one.
      const quant = 2;
      const vorzaehl = d.vorzaehl_beats ?? 0;                            // 1.8 S4b.1a: only the recording area sets it (the HTTP route refuses the key)
      if (!VORZAEHL_BEATS.includes(vorzaehl as number)) throw new ProjFehler(400, 'argument_ungueltig', { text: 'vorzaehl_beats: 0, 4, 8 or 16 expected' });
      // Spec 6.37 (D1 S3 Auftrag 17 b, Re-Review Fix8 Probe K, am Stapel gemessen: mit quant 2 kam die Quittung erst 1,87 s nach dem Absenden, bis
      // dahin galt der Lauf noch als Cyphers, und ein Stop Cypher in diesem Fenster stoppte Andreas' Lauf): der Start gehört ab dem Absenden dem,
      // der ihn sendet (der Kern beendet beim Start den laufenden Lauf, core_arr.cpp:97). Lehnt der Kern ab oder antwortet nicht, gilt wieder der
      // vorige, sofern nichts anderes (Hand-Taste, KI-Stopp, Stopp) inzwischen entschieden hat.
      const vorher = this.transportQuelle;
      this.transportQuelle = quelle;
      const q = await this.kern.start(beat, quant, quelle, vorzaehl as number);
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
    // zwei getrennte Abfragen mit je einem Text-Literal: ein Ternär mit 'aufnahme' in der Bedingung hält tests/proj_reasons_text.test.mjs für
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
      if (this.sperren > 0 || !o || !(o.merk.laden || o.merk.loop || o.merk.tempo || o.merk.reglerNach.length)) return;
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
      if (o.merk.reglerNach.length) {
        const z = o.merk.reglerNach; o.merk.reglerNach = [];
        const w = ergebnis.wiedergabe as { nr?: unknown; quittung?: Quittung };
        // audit U04: same test as uebernimm. A translator refusal ({nr: null, fehler}) has no receipt: the old playback stays, and so do its rows
        if (typeof w.nr === 'number' && !quittungAbgelehnt(w.quittung ?? null)) this.meldeRegler(o, await this.kern.setzeRegler(z, 'andreas'));
        else this.ctx.log({ typ: 'proj_uebernimm_regler_nach_abgelehnt', slug: o.slug, zeilen: z.length });
      }
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
  // Slice 3a (AK2): ein Marker hinter dem Ende der Quelle klingt nie (der Kern liest dort Stille, arr_voices.cpp:197) und ist ein Bedienfehler. Geprüft
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
  // 1.8 T9 (AK2, fourth case): the input or the mode (it is part of the input) of a track the recording holds cannot change during the run; the core would
  // refuse it with aufnahme_laeuft, so the refusal comes before any message. A monitor change passes (D12). While the start is still under way
  // (lock held, run not set yet) every armed track counts as recording.
  private pruefeAufnahmeSpuren(p: Projekt, befehle: readonly unknown[]): void {
    const lauf = this.aufnahmeLauf as { spuren: { id: string }[] } | null;
    if (lauf === null && this.sperrenAufnahme === 0) return;
    for (const b of befehle as Koerper[]) {
      if (b?.befehl !== 'spur_aendern' || b.eingang === undefined) continue;
      const s = sucheSpur(p, b.spur_id as string);
      if (!s?.aufnahme || !(lauf ? lauf.spuren.some((x) => x.id === s.id) : s.aufnahme.scharf)) continue;
      if (kanonisch(b.eingang) === kanonisch(s.aufnahme.eingang)) continue;
      throw new ProjFehler(409, 'aufnahme_laeuft', { text: `${s.name} is recording; its input and mode cannot change until the take is done` });
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
  // pre-listen of takes: see session_prelisten.ts
  private leereVorhoeren(o: Offen): boolean {
    return this.vorhoeren.leereVorhoeren(o);
  }
  private gueltigeVorhoeren(o: Offen, p: Projekt): Map<string, string> {
    return this.vorhoeren.gueltigeVorhoeren(o, p);
  }
  private setzeVorhoeren(o: Offen, neu: ReadonlyMap<string, string>): void {
    this.vorhoeren.setzeVorhoeren(o, neu);
  }
  vorhoerenLage(): Antwort { return this.vorhoeren.vorhoerenLage(); }
  vorhoerenSetzen(d: Koerper, quelle: Quelle): Promise<Antwort> { return this.vorhoeren.vorhoerenSetzen(d, quelle); }
  beendeVorhoeren(): Promise<void> { return this.vorhoeren.beendeVorhoeren(); }

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
  // Read-only: a stored project by slug (the open one as it is now, any other from its file).
  // An unknown slug is AblageFehler `unbekannt`, a bad one `slug_ungueltig`.
  liesProjekt(slug: string): Projekt {
    const o = this.offen;
    return o && o.slug === slug ? o.projekt : this.projekte.lies(slug);
  }
  // FIND SOUND: sets the transient core rows spur/<slot>/bk/<k> of some knobs of a Baukasten track (what the light command geraet_param_setzen sends),
  // without changing the project: no revision, no undo step, no file. The core clears the rows with its next playback build. Without a core
  // (no receipt) it resolves without effect; a refusal of the core (Stop Cypher, hand holds the regulator) is a 409.
  async hoereBk(spurId: string, werte: Readonly<Record<string, number>>, quelle: Quelle, faderDb?: number): Promise<void> {
    const o = this.offen;
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    const slot = bkSlot(o.projekt, spurId);
    if (slot === null) throw new ProjFehler(409, sucheSpur(o.projekt, spurId) ? 'geraet_falsch' : 'spur_unbekannt');
    // the core has the rows spur/<slot>/bk/<k> for the first BK_LIVE_SLOTS bk tracks (= every bk track)
    if (slot > BK_LIVE_SLOTS) {
      throw new ProjFehler(409, 'param_nicht_live', {
        text: `only the first ${BK_LIVE_SLOTS} Baukasten tracks have rows while a knob is dragged; change the track to hear the others`,
      });
    }
    const soll: Soll[] = [];
    for (const [k, v] of Object.entries(werte)) {
      if (!BK_PARAMETER.includes(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: `knob ${k}: only k1..k64 with a value from 0 to 1 exist` });
      }
      soll.push({ pfad: `spur/${slot}/bk/${Number(k.slice(1))}`, wert: v });
    }
    const faderPfad = `spur/${sucheSpur(o.projekt, spurId)!.nr}/fader`;
    if (faderDb !== undefined) {
      if (typeof faderDb !== 'number' || !Number.isFinite(faderDb) || faderDb < FADER_MIN || faderDb > FADER_MAX) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: `faderDb: a value from ${FADER_MIN} to ${FADER_MAX} dB is required` });
      }
      soll.push({ pfad: faderPfad, wert: faderDb });
    }
    if (!soll.length) return;
    const alle = (await this.kern.setzeRegler(soll, quelle)).filter((r) => quittungAbgelehnt(r.quittung));
    // a refused fader row only means the audition plays at its own level: ignored (logged), a refused knob row is the 409
    const abgelehnt = alle.filter((r) => r.pfad !== faderPfad);
    if (alle.length > abgelehnt.length) this.ctx.log({ typ: 'proj_klang_runde_pegel_abgelehnt', pfad: faderPfad });
    if (abgelehnt.length) throw new ProjFehler(409, 'regler_abgelehnt', { regler: abgelehnt });
  }
  // Spec 6.34: S3 meldet Beginn (art, beim Freeze spur_id) und Ende (null) jedes Laufs; nur diese Form geht an die Seite
  setzeAufnahmeLauf(l: unknown): void { this.aufnahmeLauf = l; }
  aufnahmeAktiv(): boolean { return this.aufnahmeLauf !== null || this.sperrenAufnahme > 0; }
  setzeStemsStand(x: Record<string, unknown> | null): void { this.stemsStand = x; }
  private readonly schliessHaken: ((slug: string) => void)[] = [];   // Slice 6 (T7): Läufe, die zum offenen Projekt gehören
  beiSchliessen(f: (slug: string) => void): void { this.schliessHaken.push(f); }
  // The page server remembers the open project across its own restart: f(slug) after every successful open, f(null) after a close on purpose
  private readonly offenHaken: ((slug: string | null) => void)[] = [];
  beiOffen(f: (slug: string | null) => void): void { this.offenHaken.push(f); }
  // 1.8 S3 (D13): listeners that follow the open project (the recording area keeps the core in sync with arm, input, mode and monitor)
  private readonly standHaken: ((p: Projekt) => void)[] = [];
  beiStand(f: (p: Projekt) => void): void { this.standHaken.push(f); }
  private meldeStand(o: Offen): void {
    for (const h of this.standHaken) try { h(o.projekt); } catch (e) { this.ctx.log({ typ: 'proj_stand_haken_fehler', fehler: (e as Error).message }); }
  }
  setzeAusgabeLauf(l: AusgabeLauf | null): void {
    this.ausgabeLauf = l === null ? null : l.art === 'freeze' ? { art: 'freeze', spur_id: l.spur_id }
      : l.art === 'export' && l.echtzeit ? { art: 'export', echtzeit: true, start_ms: l.start_ms, dauer_s: l.dauer_s }
      : l.art === 'resample' ? { art: 'resample', strang_id: l.strang_id } : { art: l.art };
  }
  // Spec 6.25: die nächste Nummer des einen Wiedergabe-Zählers der Instanz (derselbe wie für /k/arr/laden, mit Zustandsdatei, Spec 6.30), für die
  // Freeze-Kennung. Eine Kennung kommt so nie zweimal und nie gleich einer Wiedergabe-Nummer.
  naechsteNummer(): number { return this.zaehler.naechste(); }
  // Wiedergabe-Datei mit der nächsten Nummer des einen Zählers, ohne /k/arr/laden (Plan S3: Freeze, Export)
  schreibeWiedergabeFuer(p: Projekt): { nr: number; datei: string } {
    const nr = this.zaehler.naechste();
    const w = this.uebersetzeFuer(p, nr, undefined, false);
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
    this.meldeStand(o);
    this.instrumente.abgleich(neu);
    void this.surge.gleiche(neu);
    return this.seriell(async () => {
      if (this.offen !== o) return;                                      // inzwischen geschlossen
      // Live container: rows that make something louder wait for the core's receipt of the playback load (project/controls_order.ts)
      const dekodiert = neu.live ? this.betrifftWiedergabe(neu, this.gleicheDekodiertAb(neu, false)) : false;
      const teilen = neu.live === true && (w.betrifft_wiedergabe || dekodiert);
      const geteilt = teilen ? teileReglerLive(alt, w.regler_aenderungen) : { vorher: w.regler_aenderungen, nachher: [] };
      const { vorher } = geteilt;
      // the mute of a track that sounds in the old playback goes into the load (stumm_start), not after its receipt: the stems and the silence of the loop
      // start in one block
      const { stummStart, rest: nachher } = teileStummStart(alt, geteilt.nachher);
      if (stummStart.length) o.merk.stummStart = stummStart;
      this.meldeRegler(o, await this.kern.setzeRegler(vorher, quelle));
      const dekodiertAnders = neu.live ? dekodiert : this.betrifftWiedergabe(neu, this.gleicheDekodiertAb(neu, false));
      if (w.betrifft_wiedergabe || dekodiertAnders) {
        const l = await this.ladeOderMerke(quelle);
        if (nachher.length) {
          if (l.aufgeschoben === true) o.merk.reglerNach.push(...nachher);
          else if (typeof l.nr === 'number' && !quittungAbgelehnt((l.quittung ?? null) as Quittung)) {
            this.meldeRegler(o, await this.kern.setzeRegler(nachher, quelle));
          } else {   // the old playback stays: its rows stay too
            this.ctx.log({ typ: 'proj_uebernimm_regler_nach_abgelehnt', slug: o.slug, zeilen: nachher.length });
          }
        }
      }
      if (kanonisch(alt.loop) !== kanonisch(neu.loop)) await this.loopOderMerke(o, quelle);
      if (kanonisch(alt.metronom) !== kanonisch(neu.metronom)) await this.kern.metronom(neu, quelle);
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: neu.rev, label: w.eintrag.label, quelle } });
    });
  }
  private meldeRegler(o: Offen, regler: ReglerErgebnis[]): void {
    const abgelehnt = regler.filter((r) => quittungAbgelehnt(r.quittung)), keinKern = regler.filter((r) => r.quittung === null);   // Spec 6.31
    if (abgelehnt.length || keinKern.length) {
      this.ctx.log({ typ: 'proj_uebernimm_regler', slug: o.slug, abgelehnt: abgelehnt.map((r) => r.pfad), kein_kern: keinKern.map((r) => r.pfad) });
    }
  }
  // audit U07: a Surge host that systemd restarted plays at its init values; without this watch it would stay there until the next command or freeze
  private wacheStart(): void {
    if (this.wirtWache || !this.surge.an) return;
    this.wirtWache = setInterval(() => {
      const o = this.offen;
      if (o && this.surge.wirtGewechselt()) void this.surge.gleiche(o.projekt);
    }, this.wirtWacheMs);
    this.wirtWache.unref();
  }
  private wacheStopp(): void { if (this.wirtWache) { clearInterval(this.wirtWache); this.wirtWache = null; } }
  // 1.9 U5: brings the hosts to the open project's Surge map and resolves when they answered (the freeze path waits for it). A missing host or an
  // error answer is logged, never thrown, and the entries stay pending; the errors come back as text so the freeze can refuse a sound that would not
  // match the map. Without an open project it only waits for the jobs already queued.
  async wirtSpiegel(): Promise<string[]> {
    const o = this.offen;
    if (o) return (await this.surge.gleiche(o.projekt, false, true)).fehler;   // the patch is loaded again: the host may have been changed by hand
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
  // automation mirror and arm calls: see session_auto.ts
  private istUebersteuert(spurId: string, ziel: string): boolean { return this.auto.istUebersteuert(spurId, ziel); }
  private uebersteuertListe(p: Projekt): { spur_id: string; ziel: string }[] {
    return this.auto.uebersteuertListe(p);
  }
  private raeumeNummern(p: Projekt | undefined): void {
    this.auto.raeumeNummern(p);
  }
  private nimmAuto(f: Record<string, unknown>): void {
    this.auto.nimmAuto(f);
  }
  private async armFreiMitLog(): Promise<void> {
    await this.auto.armFreiMitLog();
  }
  private async schreibeTake(label: string, befehle: Record<string, unknown>[], kennung: Offen): Promise<void> {
    await this.auto.schreibeTake(label, befehle, kennung);
  }
  autoUebersteuern(d: Koerper, quelle: Quelle): Promise<Antwort> { return this.auto.autoUebersteuern(d, quelle); }
  autoReEnable(d: Koerper, quelle: Quelle): Promise<Antwort> { return this.auto.autoReEnable(d, quelle); }
  autoArm(d: Koerper, quelle: Quelle): Promise<Antwort> { return this.auto.autoArm(d, quelle); }
  autoGeste(d: Koerper, quelle: Quelle): Antwort { return this.auto.autoGeste(d, quelle); }

  // --- Kern-Ereignisse (Haken ereignis, Spec 2.10) ---------------------------------------------------------------------
  ereignis(adresse: string, f: Record<string, unknown>): void {
    const vorherGeneration = this.lage.generation;
    this.aufAuto.raeume();                       // a deleted track does not stay armed
    const { neustart } = this.lage.nimm(adresse, f);
    // 1.12 slice 3 (D6/D8): a new core generation clears the mirror (the new core overrides nothing); the first /k/willkommen since this server
    // started ends any override of a core that kept running (AK34, own start). A re-hello of the same generation changes nothing.
    if (adresse === '/e/ins_mess' || adresse === '/zustand/arr') this.hosts.ereignis(adresse, f);   // plan 1.11 task 7
    if (adresse === '/e/auto') this.nimmAuto(f);
    // a channel closed under a module at -200
    const padRegler = adresse === '/e/regler' && /^pad\/[12]\/(fader|trim)$/.test(String(f.pfad));
    if (padRegler && this.liveFaderFaellig()) void this.liveModulFader().catch(() => undefined);
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
    // S1b K2: halter `huelle` is the state mirror of a cell envelope (INTERFACES 5.7): display only, never a hand, a release or a move to store
    const huelleSpiegel = adresse === '/e/regler' && f.halter === 'huelle';
    if (adresse === '/e/regler' && !huelleSpiegel && f.halter !== 'mensch') this.aufAuto.reglerFrei(String(f.pfad));
    if (adresse === '/e/regler' && !huelleSpiegel && this.basisWartend.size) {
      const w = this.basisWartend.get(String(f.pfad));
      if (f.halter === 'mensch') this.basisWartend.delete(String(f.pfad));            // the hand moved it again: its value is the truth now
      else if (w) { this.basisWartend.delete(String(f.pfad)); void this.basisSenden([w]).catch(() => undefined); }   // released: the base value can go
    }
    // D10: an armed track that plays keeps the hand value for the take, not for the project base value
    // M8 / C1: a row of a strom track also follows Cypher's moves (halter cypher, or plan:<id> of a ramp) into the project, coalesced like the hand, so a
    // later playback swap does not reset the fader. The one place where this lane writes a project from a core echo for Cypher.
    const stromHalter = f.halter === 'cypher' || String(f.halter).startsWith('plan:');
    if (adresse === '/e/regler' && (f.halter === 'mensch' || (stromHalter && istStromZeile(this.offen?.projekt ?? null, String(f.pfad))))
      && istMixerRegler(String(f.pfad)) && !this.aufAuto.unterdrueckt(String(f.pfad))) {
      this.rueckweg(String(f.pfad), Number(f.wert), f.halter === 'mensch' ? 'andreas' : 'cypher');   // the follow-up keeps the source of the move that caused it
    }
    // /zustand/arr status 0 setzt transportQuelle bewusst nicht zurück; ein neuer Start überschreibt die Quelle.
    // Spec 6.37 (REVIEW-5-opus M2): die Hand-Taste am Gerät führt der Kern selbst aus (core_arr.cpp arr_hand_start_stopp) und meldet danach
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
    if (neustart) { this.hostBelegt = new Map(); this.hostFreiMs.clear(); this.hostVorab.clear(); this.hosts.kernNeustart(); this.nachNeustart(); }
  }
  // Spec 3.4 Rückweg: Andreas' Hand an spur/<n>/* landet im Projekt (Quelle andreas). Spec 6.30: zusammengefasst. Je Pfad zählt der letzte Wert;
  // gespeichert wird höchstens einmal je RUECKWEG_MS (das erste Ereignis nach einer Pause sofort), und eine Geste ist ein Verlaufseintrag: sie
  // endet nach GESTE_RUHE_MS ohne Ereignis. Vorher speicherte jedes Hand-Ereignis das ganze Projekt.
  private rueckweg(pfad: string, wert: number, quelle: Quelle = 'andreas'): void {
    const o = this.offen;
    if (!o) return;
    const jetzt = Date.now();
    if (this.geste.offen !== o || jetzt - this.geste.letzteMs > GESTE_RUHE_MS) this.geste = { nr: this.geste.nr + 1, letzteMs: jetzt, labels: [], offen: o };
    this.geste.letzteMs = jetzt;
    this.rueckwegWartend.set(pfad, { wert, quelle });
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
    // one change per source (a log entry has one source; only equal sources coalesce within a gesture)
    const quellen = [...new Set(liste.map(([, v]) => v.quelle))];
    const proQuelle = new Map<Quelle, Record<string, unknown>[]>();
    for (const [p, v] of liste) {
      const b = reglerZuBefehl(o.projekt, p, v.wert);
      if (!b) continue;
      proQuelle.set(v.quelle, [...(proQuelle.get(v.quelle) ?? []), b.befehl]);
      if (!g.labels.includes(b.label)) g.labels.push(b.label);
    }
    if (!proQuelle.size) return;
    this.rueckwegGespeichertMs = Date.now();
    const label = (g.labels.length === 1 ? g.labels[0] : `Mixer: ${g.labels.map((l) => l.replace(/^Mixer: /, '')).join(', ')}`).slice(0, 200);
    for (const quelle of quellen) {
      const befehle = proQuelle.get(quelle);
      if (!befehle?.length) continue;
      try {
        const r = aendere(o.verlauf, o.projekt, befehle as never, { quelle, label }, this.haken(o), {
          schluessel: `rueckweg:${g.nr}`, transienten: this.transienten });
        if (!r.eintrag) continue;
        r.projekt.wiedergabe_rev = o.projekt.wiedergabe_rev;
        o.projekt = r.projekt;
        this.meldeStand(o);
        this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: r.projekt.rev, label, quelle } });
      } catch (e) { this.ctx.log({ typ: 'proj_rueckweg_fehler', pfade: liste.map(([p]) => p), fehler: (e as Error).message }); }
    }
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
      const wiedergabe: Record<string, unknown> = !o.merk.laden && !o.merk.stifte && nr > 0 && fs.existsSync(wiedergabeDatei(this.arbeitsordner, nr))
        ? { nr, quittung: await this.kern.laden(nr, 'andreas') } : await this.ladeWiedergabe('andreas');
      if (typeof wiedergabe.nr === 'number' && quittungOk(wiedergabe.quittung as Quittung)) { o.merk.laden = false; o.merk.loop = false; }
      this.transportQuelle = null;
      this.containerGesendet = [null, null, null, null];   // the new core knows nothing of what it was told
      const containerNein = o.projekt.live ? await this.sendeContainer(o.projekt, 'beide', 'andreas', true) : [];   // all four again, like the graphs
      // Spec 6.31, 6.32: wartende Handwerte ins Projekt, unmittelbar vor dem Senden der Regler (nach der Lade-Quittung, kein await dazwischen),
      // damit auch, was während des Ladens kam, an den neuen Kern geht und Kern und Projekt denselben Wert haben
      this.rueckwegSpeichern();
      // No /k/hand/frei here: the cause of a core restart is unknown, and the server must never release Andreas's hand in his name (D9).
      const [regler, loop, metronom, ki] = await Promise.all([this.kern.setzeRegler(alleRegler(o.projekt), 'andreas'),
        this.kern.loop(o.projekt, 'andreas'), this.kern.metronom(o.projekt, 'andreas'), this.leereKiMaske()]);
      // S17: the sound snapshot again (a new kern knows no graph); source andreas like the controls above (Spec 6.35 E-a)
      const baukasten = o.projekt.baukasten ? await this.bk.wiederherstellen(o.projekt, 'andreas', { schonGeladenUeberspringen: false }) : undefined;
      this.ctx.log({ typ: 'proj_neustart', slug: o.slug, wiedergabe, ...(containerNein.length ? { container_abgelehnt: containerNein } : {}), ...reglerBefund(regler), loop, metronom, ki, ...(baukasten ? { baukasten } : {}) });
      this.meldeStand(o);                      // 1.8 S3 (D13): the new core gets arm, input, mode and monitor of every armed track
    }).catch((e) => this.ctx.log({ typ: 'proj_neustart_fehler', fehler: (e as Error).message }));
  }
}
// for the classes split out of ProjSitzung (session_device.ts, session_sources.ts)
export type { Hinweis, Koerper, Offen };
export { graphArt, steckfeldLookup };
