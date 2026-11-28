import {
  ARP_RATEN, type AudioClip, type Clip, type Lane, type MidiStufe, type Projekt, type Warp, alleInserts, alleZellen,
} from '../../project/model.ts';
import type { AnalyseStarter } from './analysis.ts';
import type { AutoOptionen } from './recording_auto.ts';
import type { Einsammler } from '../../project/einsammeln.ts';
import { GESTE_RUHE_MS } from './times.ts';
import type { HostAbhaengig, HostZeiten } from '../../plugins/hostverwaltung.ts';
import { type Huellkurve, hkWert } from '../../project/envelope.ts';
import type { InstrumentAbhaengig, InstrumentZeiten } from '../../plugins/instrumentwirte.ts';
import type { MidiZaehler } from './state.ts';
import { type PluginEintrag, type PresetInhalt, alleAudioClips } from '../../project/commands.ts';
import { type ReglerErgebnis, quittungAbgelehnt } from './core_path.ts';
import { SLOTS, type Slot, modulAmPlatz } from '../../project/live.ts';
import type { Soll } from './mapping.ts';
import type { Verlauf } from '../../project/history.ts';
import { bkDefVonId } from '../../project/modular.ts';
import { findeGraph, steckfeldVon } from '../../graphs.ts';
import { kanalOffen } from '../../hand_operation.ts';
import { laneWert } from '../../project/lane.ts';
import { quellSekunde, segmentBpm } from '../../project/warp.ts';
import { surgePatchDatei } from './surge_patches.ts';

export const surgePatchDa = (name: string): boolean => surgePatchDatei(name) !== null;
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
export function alleZellQuellen(p: Projekt): Map<string, string> {
  const m = new Map<string, string>();
  for (const z of alleZellen(p)) {
    if ((!m.has(z.sha256) || (m.get(z.sha256) === '' && z.pfad_hinweis))) m.set(z.sha256, z.pfad_hinweis ?? '');
  }
  return m;
}
// vorhoeren (1.14 comping, spec R8): spur_id -> take_id of the audition. Session state: never saved, never undoable, gone with the open project.
// a change added or replaced an audio clip: some sha of the new state is not in the old one
export function neueQuelle(alt: Projekt, neu: Projekt): boolean {
  const vorher = new Set<string>();
  for (const c of alleAudioClips(alt)) vorher.add(c.quelle.sha256);
  for (const c of alleAudioClips(neu)) if (!vorher.has(c.quelle.sha256)) return true;
  return false;
}
export interface Offen { slug: string; projekt: Projekt; verlauf: Verlauf; merk: Merk; vorhoeren: Map<string, string> }
export type Koerper = Record<string, unknown>;
export interface Hinweis { index: number; hinweis: string; [feld: string]: unknown }                // Paket 1.13: z. B. kein_tempo (Auto-Warp fand kein Tempo)

export const LIVE_SLUG = 'live';
export const liveSlotAntwort = (p: Projekt): Record<Slot, string | null> =>
  Object.fromEntries(SLOTS.map((s) => [s, modulAmPlatz(p, s) ?? null])) as Record<Slot,
  string | null>;
export const schlaf = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
// Baukasten S20: lookup of a graph in the graph folder for the commands that set a bk device (null = no such graph)
export const graphArt = (name: string): 'instrument' | 'effekt' | null => findeGraph(name)?.art ?? null;
// Kraken patch field: lookup of the matrix node (labels, default pins) of a graph for the pin commands (null = no such graph or no matrix node)
export const steckfeldLookup = (name: string): ReturnType<typeof steckfeldVon> => steckfeldVon(name);
// arr-bk: the bk stages of the project whose graph file is not in the graph folder (the core plays such a stage dry and logs it): [{strang_id, stufe, graph}]
type BkFehlt = { strang_id: string; stufe: string; graph: string };
export function bkGraphenFehlen(p: Projekt, art: (name: string) => 'instrument' | 'effekt' | null = graphArt): BkFehlt[] {
  return alleInserts(p).filter((x) => x.insert.art === 'bk' && art(x.insert.graph!) === null)
    .map((x) => ({ strang_id: x.strangId, stufe: x.insert.id, graph: x.insert.graph! }));
}
export const MAX_MUSTER_JE_AUFRUF = 8;   // strudel-clip: clip_aus_muster commands in one call (each can need a child of up to 5 s)
export const MARKER_TOLERANZ_S = 0.05;   // Rundung zwischen Katalog-Dauer und Dekodierung
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
// Strand 7 task 1.6: the MIDI stage of an instrument track in real units (step and gate in ms, steps per bar), as proj_lage shows it
const rund1 = (x: number): number => Math.round(x * 10) / 10;
// zaehler (strand 7 task 3.3): the core's counters of that track (/zustand/arr/midi), null while none came; absent: the member is left out
export function midiLage(m: MidiStufe, bpm: number, taktart: [number, number], zaehler?: MidiZaehler | null): Record<string, unknown> {
  const kette = (['akkord', 'skala', 'arp', 'velocity', 'chance'] as const).filter((k) => m[k] !== undefined);
  const aus: Record<string, unknown> = { ...(m.aus ? { aus: true } : {}), kette };
  if (m.arp) {
    const a = m.arp;
    const rate = a.sync ? a.rate : null;
    const beats = a.sync ? ARP_RATEN[a.rate] : null;
    const schritt = a.sync ? (beats as number) * 60000 / bpm : 1000 / a.hz;
    aus.arp = { muster: a.muster, rate: a.sync ? rate : `${a.hz} Hz`, schritt_ms: rund1(schritt),
      schritte_je_takt: a.sync ? Math.round(taktart[0] / (beats as number) * 100) / 100 : null,
      oktaven: a.oktaven, gate_ms: rund1(a.gate * schritt) };
  }
  if (zaehler !== undefined) aus.zaehler = zaehler;
  return aus;
}
export const ohneNoten = (p: Projekt, ueber?: UeberFrage, zaehler?: (nr: number) => MidiZaehler | null): unknown => ({ ...p, ...bkKurz(p),
  ...(p.gruppen?.some((g) => g.automation) ? { gruppen: p.gruppen.map((g) => ohneLanePunkte(g, g.id, ueber)) } : {}),
  ...(p.returns?.some((r) => r.automation) ? { returns: p.returns.map((r) => ohneLanePunkte(r, r.id, ueber)) } : {}),
  ...(p.master?.automation ? { master: ohneLanePunkte(p.master, 'master', ueber) } : {}),
  spuren: p.spuren.map((s) => ({
  ...ohneTakes(ohneLanePunkte(s, s.id, ueber)),
  ...(s.midi ? { midi: midiLage(s.midi, p.tempo_bpm, p.taktart, zaehler ? zaehler(s.nr) : undefined) } : {}), clips: s.clips.map((c) => {
  if (c.art === 'audio') return c.warp ? { ...hkKurz(c), warp: warpKurz(c.warp) } : hkKurz(c);
  const { noten, ...rest } = hkKurz(c);
  return { ...rest, noten_zahl: noten.length };
}) })) });
// Slice 1 (proj_auto): default number of points per answer; 200 points are about 8 KB in Cypher's context
export const AUTO_PUNKTE_VORGABE = 200;
export function laneAnsicht(spurId: string, l: Lane, von: number | null, bis: number | null, bei: number | null, max: number): Record<string, unknown> {
  const passend = l.punkte.filter((q) => (von === null || q.beat >= von) && (bis === null || q.beat <= bis));
  const gezeigt = passend.slice(0, max).map((q) => ({ beat: q.beat, wert: q.wert, form: q.form ?? 'linear' }));
  return { lane_id: l.id, spur_id: spurId, ziel: l.ziel, punkte_zahl: l.punkte.length, ...(l.gesperrt ? { gesperrt: true } : {}),
    punkte_gezeigt: gezeigt.length, punkte: gezeigt,
    ...(passend.length > max ? { weiter_ab_beat: passend[max].beat } : {}),
    ...(bei === null ? {} : { bei: { beat: bei, wert: laneWert(l.punkte, bei, l.ziel) } }) };
}
// 1.12 slice 5 (U11): one clip envelope as proj_auto shows it. Beats are CLIP beats (from the clip start); bei is hkWert, the value the core plays
// (a linked envelope repeats with the clip's loop_beats, an unlinked one with its own).
export function huellkurveAnsicht(clipId: string, spurId: string, c: Clip, h: Huellkurve, von: number | null, bis: number | null, bei: number | null,
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
export const reglerBefund = (e: ReglerErgebnis[]): { regler_fehler: ReglerErgebnis[]; regler_ohne_kern: number } =>
  ({ regler_fehler: e.filter((r) => quittungAbgelehnt(r.quittung)), regler_ohne_kern: e.filter((r) => r.quittung === null).length });
export const RUECKWEG_MS = 250;     // Spec 6.30: höchstens eine Speicherung des Rückwegs je 250 ms
export { GESTE_RUHE_MS };   // Spec 6.30: so lange Ruhe schließt eine Geste (ein Verlaufseintrag je Geste); the value lives in times.ts

// Gegenprobe W(bei_beat) des Werkzeugs proj_warp: die Quellsekunde, die bei diesem Projekt-Beat wirklich klingt. Maßgeblich ist, was der Übersetzer
// spielt (playback.ts audioKopien/warpMarker): jede Loop-Kopie beginnt bei versatz_beats von vorn (Clip-Beat c, Kopie k = ⌊c/loop⌋, Beat in der
// Kopie c − k·loop). Klingt dort nichts aus dem Warp, ist quell_s null und warum sagt es: ausserhalb (vor dem Clip oder ab seinem Ende,
// halboffen) oder warp_aus (an false: der Clip spielt ungewarpt über offset_s).
export function gegenprobe(c: AudioClip, bei: number): { projekt_beat: number; quell_s: number | null; warum?: 'ausserhalb' | 'warp_aus' } {
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
export function tempoUebersicht(m: readonly (readonly [number, number])[]): { mittel_bpm: number; min_bpm: number; max_bpm: number } {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i + 1 < m.length; i++) { const b = segmentBpm(m, i); if (b < min) min = b; if (b > max) max = b; }
  return { mittel_bpm: rund2(60 * (m[m.length - 1][1] - m[0][1]) / (m[m.length - 1][0] - m[0][0])), min_bpm: rund2(min), max_bpm: rund2(max) };
}

// 1.8 S4b.1a: count-in of 0, 1, 2 or 4 bars in core beats (the internal key of the transport call)
export const VORZAEHL_BEATS: readonly number[] = [0, 4, 8, 16];
