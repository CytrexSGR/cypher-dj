// Übersetzer Projekt → Wiedergabe cypherdj-arr/1 oder /2 (Spec 3.2; /2 bei Routing, 1.10 P2, oder bei gewarptem Clip, 1.13) und Ablage (Spec 2.9).
// Paket 1.13: ein Audio-Clip mit Warp an trägt `warp: { modus: 0 | 1 | 2 | 3, w: [[beat, frame], …], pitch? }` (je Clip und je Loop-Kopie); ohne Routing und
// ohne Warp bleibt die Datei Zeichen für Zeichen die von /1.
// Die Datei heißt wiedergabe-<nr>.json; <nr> ist die Wiedergabe-Nummer der Instanz (Spec 6.1), nicht die Projekt-Revision: der
// WiedergabeZaehler vergibt sie fortlaufend über Projekte hinweg und findet beim Start im Arbeitsordner wieder, wo er stand.
// Die Wiedergabe trägt nur, was der Kern abspielt: absolute Beats, Audio-Clips mit Datei/Frames/Offset, Noten flach je Spur an den
// Clip-Grenzen geschnitten. Mixer-Werte stehen nicht darin (Regler, 2.3), Tempo auch nicht (Beats sind absolut).
import fs from 'node:fs';
import path from 'node:path';
import { BEATS_VORGABE, MAX_AUTO_PUNKTE, MAX_FX_PUNKTE, ZIEL_BEREICH, MAX_CLIPS, MAX_NOTEN, MAX_SPUREN, SAMPLERATE, insertParamIndex, istKettenZiel,
  istBlendZiel, blendFader, blendPfad, MAX_KETTEN_LANEN, makroVon, pitchFaktor, rackSicht, wirtSlots, zerlegeKettenZiel,
  type InsertPoolArt } from './model.ts';
import { MAX_BEATS_EINHEITEN, beatsEinheiten, beatsEinheitenZahl } from './warp.ts';
import { hkStrecke, hkWert, istModulation, modulationsZiel, type Huellkurve } from './envelope.ts';
import { hatFxArbeit, rolleFxAus, type FxRahmen } from './fx_ausrollen.ts';
import { geraetFx as geraetFxRegister } from '../devices_parameter.ts';   // default device mode of `uebersetze` (a caller cannot forget it)
import { trackerEinstellung } from '../public/tracker/grid_model.js';   // LPB and TICKS of the project (task 1)
import { LOOP_MAX_FRAMES, MAX_RETURNS, loopDeckGruppe, platzVonGruppe, strudelGruppe } from './model.ts';
import type { GliedGeraet, AudioClip, Clip, Insert, InsertTraeger, Lane, Ziel, MidiClip, Note, Projekt, Punkt, Spur, Warp } from './model.ts';
import type { Stift } from '../steckfeld.ts';

export const WIEDERGABE_FORMAT = 'cypherdj-arr/1';
// /2, wenn das Projekt Gruppen hat oder eine Spur nicht auf master zeigt (1.10, P2) oder ein Audio-Clip Warp an trägt (1.13); sonst /1 byteweise wie bisher
export const WIEDERGABE_FORMAT_2 = 'cypherdj-arr/2';
// /3 = /2 plus returns[].auto (the fader lane of a return, return automation slice 2); the format is the version gate: an old core refuses /3 as a whole
export const WIEDERGABE_FORMAT_3 = 'cypherdj-arr/3';
// /4 = /3 plus the strom track source, container outputs 1..4 and up to 8 returns; a live project is always written as /4 with the head flag `live`
export const WIEDERGABE_FORMAT_4 = 'cypherdj-arr/4';
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
  gain_hk?: [number, number, number][];   // 1.12 slice 5 (/2 only, D8): the gain envelope of this copy [copy beat, dB, formcode]
}
// loop deck cell in the playback (index 1.2): modus 2 (complex) for a loop, 0 (repitch, played unstretched) for einmal;
// the core loader wants beats on every cell, 0 for einmal
export interface WZelle { index: number; sha256: string; datei: string; frames: number; beats: number; art: 'loop' | 'einmal'; gain_db: number; modus: 0 | 2 }
export interface WNote { id: string; beat: number; laenge: number; ton: number; vel: number }
export type WZiel = { art: 'gruppe'; nr: number };   // fehlt `ausgang`, zeigt die Spur auf den Produktions-Master
// Automation Slice 1 (nur /2): je Lane Ziel und Punkte [beat, wert dB, formcode], Formcode 0 linear, 1 s, 2 sprung; die Spur trägt `auto` nur mit Lane
// Slice 2: `ziel` is the project string (Ziel: fader, pan, mute, solo, geraet.cutoff ...); mute and solo points always carry formcode 2
// 1.12 slice 5 (D9): relativ marks the merged modulation lane of a track (stacked on the base value or the absolute lane of the same target)
export interface WAuto { ziel: Ziel; punkte: [number, number, number][]; relativ?: true }
// 1.12 slice 6 (only /2): the lanes of a strip's insert stages and rack macros. `stufe` = position of the stage in the strip's chain, `param` = its parameter
// index of the kind (as in the rack mapping table), `makro` = 0..3; points as in `auto`. The core takes at most 64 of them in a playback (ARR_KLANES_MAX).
export type WKettenLane = { stufe: number; param: number; punkte: [number, number, number][] } | { makro: number; punkte: [number, number, number][] };
const FORM_NR: Readonly<Record<string, number>> = { linear: 0, s: 1, sprung: 2 };
// slice 4 (only /2): the insert chain of a strip, in signal order. `an` is the kern's structural flag and is ALWAYS true here: the kern runs a stage when
// this flag AND its row ins/komp/<n>/an are on, and insert_an is a light command that only sends the row, so the bypass must live in the
// row alone (a false flag would make the stage impossible to switch on again until the next structure change)
// slice 5: `key` is the structural sidechain key {q, nr, punkt} (the core's chain[j].key); absent = the row key sc or own signal
// plan 1.11 T7: a host stage carries `latenz` (D4: samples of the round trip, structure); its `an` is the host's readiness
// (false = the strip plays dry, aligned)
export interface WInsert {
  art: Insert['art']; slot: number; an: boolean; key?: { q: 'spur' | 'grp' | 'ret' | 'deck' | 'erz'; nr: number; punkt: 'pre' | 'post' }; latenz?: number;
  graph?: string;   // arr-bk: the effect graph of a bk stage (the core builds the instance off the callback)
}
/** what the translator asks the host manager for one host stage: ready (the stage may play wet) and the latency to write */
export type HostStufe = { an: boolean; latenz: number };
// `stumm_start` (live containers): the track starts this playback muted, the core applies it in the block of the swap (INTERFACES 4.11); written only for
// the load that brings the stems of a module
export type WSpur = WSpurKern & { stumm_start?: true };
type WSpurKern =
  | { nr: number; art: 'audio'; clips: WAudioClip[]; ausgang?: WZiel; auto?: WAuto[]; chain?: WInsert[]; rack?: WRack; chain_auto?: WKettenLane[];
      id?: string; zellen?: WZelle[] }   // id and zellen: only the audio tracks of a loop deck group (index 1.2)
  | { nr: number; art: 'intern'; geraet: 'rb338' | 'bk'; graph?: string; parameter: Record<string, number>; noten: WNote[]; ausgang?: WZiel;
    // Kraken patch field: the pin list of a bk track's matrix block, written only when the device has one (an empty list = all pins zero)
    stifte?: [number, number, number, number][];
    auto?: WAuto[]; chain?: WInsert[]; rack?: WRack; chain_auto?: WKettenLane[];
    // tracker effect commands (/2 only, bk tracks only): [beat, semitones | factor 0..1, glide beats], sorted by beat, written only when non-empty
    bend?: [number, number, number][]; pegel?: [number, number, number][] }
  // 1.9 (L25): no parameter, the kit is the device
  | { nr: number; art: 'intern'; geraet: 'kit'; kit: string; noten: WNote[]; ausgang?: WZiel; auto?: WAuto[]; chain?: WInsert[]; rack?: WRack;
      chain_auto?: WKettenLane[] }
  // container core (/4): a strom track reads the source buffer of its stream; no clips, no device; the loader keys on `quelle.art`
  | { nr: number; art: 'intern'; quelle: { art: 'strom'; strom: number }; ausgang?: WZiel; auto?: WAuto[]; chain?: WInsert[]; rack?: WRack; chain_auto?: WKettenLane[] }
  | { nr: number; art: 'wirt'; slot: number; noten: WNote[]; ausgang?: WZiel; auto?: WAuto[]; chain?: WInsert[]; rack?: WRack; chain_auto?: WKettenLane[] }
  // 1.9 U7 (E9): an instrument rack; zones and gain_db are always written, explicit (the core's contract, arr_playback.cpp geraet_lesen / rack branch)
  | { nr: number; art: 'intern'; geraet: 'rack'; kette: number; glieder: WGlied[]; noten: WNote[]; ausgang?: WZiel; auto?: WAuto[]; chain?: WInsert[];
    rack?: WRack; chain_auto?: WKettenLane[] };
export type WGliedGeraet =
  | { art: 'intern'; geraet: 'rb338' | 'bk'; graph?: string; parameter: Record<string, number> }
  | { art: 'intern'; geraet: 'kit'; kit: string }
  | { art: 'wirt'; slot: number };
export type WGlied = { id: string; ton: [number, number]; vel: [number, number]; kette: [number, number]; gain_db: number } & WGliedGeraet;
// A group leads into the master or into another group (nested groups); returns always into the master
// Container core: a top group of a live project that sits in place N leads into the DJ output N = container A..D (deck/1, deck/2, pad/1, pad/2);
// the core refuses it elsewhere
export type WDjNr = 1 | 2 | 3 | 4;
export interface WGruppe {
  nr: number; ausgang: { art: 'master' } | { art: 'gruppe'; nr: number } | { art: 'dj'; nr: WDjNr };
  chain?: WInsert[]; rack?: WRack; chain_auto?: WKettenLane[]
}
// slice 4: the send taps before the fader (absent = post)
// auto (only /3): the fader lane of the return, points [beat, dB, formcode] as on a track
export interface WReturn extends Omit<WGruppe, 'ausgang'> { ausgang: { art: 'master' } | { art: 'dj'; nr: WDjNr }; pre?: true; auto?: WAuto[] }
export interface Wiedergabe {
  format: typeof WIEDERGABE_FORMAT | typeof WIEDERGABE_FORMAT_2 | typeof WIEDERGABE_FORMAT_3 | typeof WIEDERGABE_FORMAT_4; nr: number; spuren: WSpur[]; live?: true; gruppen?: WGruppe[];
  // returns (slice 3) like the groups; pm = the production master's chain, the kern's key (slice 4)
  returns?: WReturn[]; pm?: { chain: WInsert[]; rack?: WRack; chain_auto?: WKettenLane[] } }
// slice 4c: the rack of a strip: its pooled slot and the mapping table (`stufe` = position in the chain, `param` = parameter index of the kind, `makro` 0..3)
// 1.9 U8 T7 (E12): a member target has `glied` (the member's position 0..3 in the rack device) instead of `stufe`; its `param` is the core's member index space
// (0..3 RB-338, 8..15 bk k1..k8, 16 gain_db, 17..40 bk k9..k32, 41..72 bk k33..k64)
export interface WRack { slot: number; ziele: ({ makro: number; stufe: number; param: number; von: number; bis: number }
  | { makro: number; glied: number; param: number; von: number; bis: number })[] }
// `eingefroren`: the track goes out as its freeze audio clip, so it has no members; member targets are left out and a rack without an insert target is dropped
let hostHaken: { host?: (slot: number) => HostStufe; ohne?: ReadonlySet<number> } = {};
const kette = (liste0: readonly Insert[] | undefined, strang?: InsertTraeger, eingefroren = false):
  { chain?: WInsert[]; rack?: WRack; chain_auto?: WKettenLane[] } => {
  // a stage the playback leaves out (a host slot that must not change strips inside one load) is not in the chain; the rack mapping follows the chain
  const liste = hostHaken.ohne?.size ? liste0?.filter((i) => !(i.art === 'host' && hostHaken.ohne!.has(i.slot))) : liste0;
  let rack = strang ? rackSicht(liste === liste0 ? strang : { ...strang, inserts: liste } as InsertTraeger) : undefined;
  if (rack && eingefroren) {
    const ziele = rack.ziele.filter((z) => 'stufe' in z);
    rack = ziele.length > 0 && liste?.length ? { slot: rack.slot, ziele } : undefined;
  }
  const ca = strang ? kettenAuto(strang, liste ?? [], rack) : [];
  // 1.9 U8 T7: a rack track without a chain still carries its member targets
  if (!liste?.length) return { ...(rack ? { rack } : {}), ...(ca.length ? { chain_auto: ca } : {}) };
  const stufe = (i: Insert): WInsert => {
    if (i.art === 'host') {
      const h = hostHaken.host?.(i.slot) ?? { an: false, latenz: 0 };
      return { art: 'host', slot: i.slot, an: h.an, latenz: h.latenz };
    }
    const graph = i.art === 'bk' ? { graph: i.graph! } : {};
    return { art: i.art, slot: i.slot, an: true, ...graph, ...(i.key ? { key: { q: i.key.quelle, nr: i.key.nr, punkt: i.key.punkt } } : {}) };
  };
  return { chain: liste.map(stufe), ...(rack ? { rack } : {}), ...(ca.length ? { chain_auto: ca } : {}) };
};
// 1.12 slice 6: the chain lanes of a strip as the playback takes them. A lane whose stage is not in this playback's chain
// (a left-out host slot) or whose rack is not written goes; a lane on a parameter a macro drives goes too
// (the macro wins, as in the core: the project refuses such a lane, this is the safety net).
// Live modules (decision 7): a blend lane of a stem group becomes one fader lane on each of its two tracks (the original audio track and the new
// instrument track) by the equal-power law. A segment that moves is sampled every 1/4 of its length at most 16 steps (the law is not linear in dB);
// a `sprung` point stays one. A track that has a fader lane of its own keeps it (the blend never overrides a hand-drawn lane).
const BLEND_SCHRITTE = 16;
export function blendLanen(lane: Lane, welche: 'original' | 'neu', trim = 0): [number, number, number][] {
  const aus: [number, number, number][] = [];
  const db = (w: number): number => blendFader(w, trim)[welche];
  lane.punkte.forEach((q, i) => {
    const n = lane.punkte[i + 1];
    const form = q.form ?? 'linear';
    aus.push([q.beat, db(q.wert), form === 'sprung' ? FORM_NR.sprung : FORM_NR.linear]);
    if (!n || form === 'sprung' || n.beat <= q.beat || n.wert === q.wert) return;
    const k = Math.min(BLEND_SCHRITTE, Math.max(2, Math.ceil((n.beat - q.beat) * 4)));
    for (let j = 1; j < k; j++) {
      const t = j / k, u = form === 's' ? t * t * (3 - 2 * t) : t;
      aus.push([q.beat + (n.beat - q.beat) * t, db(q.wert + (n.wert - q.wert) * u), FORM_NR.linear]);
    }
  });
  return aus;
}
const kettenPunkte = (k: { chain_auto?: WKettenLane[] }): number =>
  (k.chain_auto ?? []).reduce((n, l) => n + l.punkte.length, 0);
const kettenAuto = (strang: InsertTraeger, liste: readonly Insert[], rack: WRack | undefined): WKettenLane[] => {
  const aus: WKettenLane[] = [];
  for (const l of strang.automation ?? []) {
    if (!istKettenZiel(l.ziel)) continue;
    const k = zerlegeKettenZiel(l.ziel)!;
    const punkte = tripel(l.punkte);
    if ('makro' in k) { if (rack) aus.push({ makro: k.makro - 1, punkte }); continue; }
    const stufe = liste.findIndex((x) => x.id === k.insert);
    if (stufe < 0 || makroVon(strang, k.insert, k.param)) continue;
    aus.push({ stufe, param: insertParamIndex(liste[stufe].art as InsertPoolArt, k.param), punkte });
  }
  return aus;
};

export interface UebersetzOptionen {
  nr: number;                                                // Wiedergabe-Nummer (WiedergabeZaehler.naechste())
  audioOrdner: string;                                       // <arbeitsordner>/audio: dort liegt <sha256>.f32
  frames?: (sha256: string) => number | null;                // Stereo-Frames der dekodierten Datei oder null (nicht bereit); Vorgabe: Dateigröße / 8
  arbeitsordner?: string;                                    // nötig, sobald eine Spur eingefroren ist: freeze.datei ist relativ dazu (Spec 6.14, 6.29)
  existiert?: (datei: string) => boolean;                    // Vorgabe fs.existsSync (Haken für Tests)
  transienten?: (sha256: string) => number[] | null;         // Slice 4: Transienten einer Quelle in Sekunden, aufsteigend; fehlt sie, gilt null (Raster 1/16)
  // 1.14 comping (spec R8): spur_id -> take_id. The live translator only: a listed track plays the clips of that take instead of its main lane.
  // Export, loudness and merge never pass it. An unknown track or take id is ignored (the track plays its main lane).
  vorhoeren?: ReadonlyMap<string, string>;
  // plan 1.11 T7: the host manager's answer per host stage (slot = host number h). Absent = no host is ready (the export path): every host stage `an: false`.
  host?: (slot: number) => HostStufe;
  stummStart?: ReadonlySet<number>;   // track numbers that start this playback muted (`stumm_start`, live containers: the loop track when the stems arrive)
  ohneHost?: ReadonlySet<number>;   // host slots left out of this playback (the split of a slot that would change strips inside one load)
  // tracker effect commands (task 14): how a bk device runs its effects (register entry); absent: the register (devices_parameter.ts); unknown graph: smooth
  geraetFx?: GeraetFxFn;
}
export type GeraetFx = Pick<FxRahmen, 'stufig' | 'rollen'>;
export type GeraetFxFn = (graph: string) => GeraetFx;

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
  if (c.zeilen !== undefined || c.noten.some((n) => n.chance !== undefined || n.wdh !== undefined ||
    n.versatz !== undefined)) { fuerAusgerollteNotenZeilen(c, f); return; }
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
// Workbench rows and note fields (chance, wdh, versatz, MidiClip.zeilen). Only clips that carry one of them come here; every other clip takes the
// loop above, unchanged.
// Per note the pass period P is: the row length schritte / 4 (independent of loop_beats), else loop_beats, else none (one pass, the clip). The passes
// restart with the clip. In a pass: a note with beat >= P is silent; "pendel" mirrors every odd pass (step i sounds at step schritte - 1 - i, the
// part inside the step stays); the odd steps of the pass sounding position are delayed by swing / 100 * 0.125; versatz moves by versatz / 100 * 0.25
// (copy 0 never before the clip start); wdh splits the note into hits over max(0.25, laenge). A copy is cut at its pass end (hits behind it are
// silent). ids: <clip>~<pass>/<note>, or <clip>/<note> without passes, hits 2.. get ".<h-1>".
const hash32 = (t: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
// one draw in [0, 1) of a copy: seeded from clip id, note id and copy index only (same in playback, render and export, stable under unrelated edits)
const zug = (clip: string, note: string, k: number): number => {
  let t = (hash32(`${clip}|${note}|${k}`) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function fuerAusgerollteNotenZeilen(c: MidiClip, f: (id: string, beat: number, laenge: number, n: Note) => void): void {
  const ende = c.start_beat + c.laenge_beats, loop = c.loop_beats ?? null;
  for (const n of c.noten) {
    const z = c.zeilen?.[String(n.ton)];
    const periode = z?.schritte !== undefined ? z.schritte / 4 : loop;
    const pendel = z?.richtung === 'pendel' && periode !== null;
    const stufe = (beat: number): number => Math.floor(beat * 4 + 1e-9);
    for (let k = 0; periode === null ? k === 0 : k * periode < c.laenge_beats - 1e-9; k++) {
      const basis = periode === null ? c.start_beat : c.start_beat + k * periode;
      const kopieEnde = periode === null ? ende : Math.min(basis + periode, ende);
      let pos = n.beat;
      if (periode !== null) {
        if (!(n.beat < periode)) continue;                                  // a note from the pass length on stays in the project but never sounds
        if (pendel && k % 2 === 1) { const i = stufe(n.beat); pos = (periode * 4 - 1 - i) / 4 + (n.beat - i / 4); }
      }
      if (z?.swing !== undefined && stufe(pos) % 2 === 1) pos += z.swing / 100 * 0.125;
      let beat = basis + pos + (n.versatz !== undefined ? n.versatz / 100 * 0.25 : 0);
      if (k === 0 && beat < c.start_beat) beat = c.start_beat;
      if (n.chance !== undefined && !(zug(c.id, n.id, k) * 100 < n.chance)) continue;
      const id = periode === null ? `${c.id}/${n.id}` : `${c.id}~${k}/${n.id}`;
      const treffer = n.wdh ?? 1, teil = Math.max(0.25, n.laenge) / treffer;
      for (let h = 0; h < treffer; h++) {
        const b = beat + (treffer === 1 ? 0 : h * teil);
        if (!(b < kopieEnde)) break;
        f(h === 0 ? id : `${id}.${h}`, b, treffer === 1 ? Math.min(n.laenge, kopieEnde - b) : Math.min(teil, kopieEnde - b), n);
      }
    }
  }
}
// Zahl der Clips und Noten nach dem Ausrollen (alle Audio-Clips, gleich ob dekodiert; eine eingefrorene Wirt-Spur zählt einen Clip)
export function zaehleAusgerollt(p: Projekt): { clips: number; noten: number } {
  let clips = 0, noten = 0;
  for (const s of p.spuren) {
    if (wirtSlots(s).length > 0 && s.freeze) { clips += 1; continue; }
    for (const c of s.clips) {
      if (c.art === 'audio') clips += audioKopien(c).length;
      else if (c.fx?.length) rolleFxAus(c, fxRahmen(p, s), () => { noten += 1; });   // GLD removes and RTG adds notes
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

// 1.14 comping (R8): the clips a track plays live: its main lane, or the clips of the auditioned take when the map names a take the track has
const spurClips = (s: Spur, vorhoeren?: ReadonlyMap<string, string>): readonly Clip[] => {
  const id = vorhoeren?.get(s.id);
  return id === undefined ? s.clips : s.takes?.find((t) => t.id === id)?.clips ?? s.clips;
};

// The cells of a loop deck track for the snapshot (index 1.2): only filled cells whose decoded frames are known. Undefined for every other track
// (they get neither `id` nor `zellen`). The filter is a control row and is not written here.
function deckZellen(s: Spur, o: Required<Pick<UebersetzOptionen, 'frames'>> & UebersetzOptionen): WZelle[] | undefined {
  if (s.zellen === undefined) return undefined;
  const aus: WZelle[] = [];
  s.zellen.forEach((z, i) => {
    if (!z) return;
    const frames = o.frames!(z.sha256);
    if (frames === null || frames > LOOP_MAX_FRAMES) return;   // not decoded yet, or longer than the core takes (index 1.2)
    aus.push({ index: i + 1, sha256: z.sha256, datei: path.join(o.audioOrdner, `${z.sha256}.f32`), frames,
      beats: z.beats ?? 0, art: z.art, gain_db: z.gain_db, modus: z.art === 'loop' ? 2 : 0 });
  });
  return aus;
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
  const hk = c.huellkurven?.find((h) => h.ziel === 'gain');
  return audioKopien(c).map((k) => ({ id: k.id, start_beat: k.start_beat, laenge_beats: k.laenge_beats, sha256: c.quelle.sha256,
    datei, frames, offset_frames: offset, gain_db: c.gain_db, ein_beats: k.ein_beats, aus_beats: k.aus_beats,
    ...(marker ? { warp: { modus: WARP_MODUS_NR[c.warp!.modus], w: marker.map((m): [number, number] => [m[0], m[1]]),
      ...pitchFeld(c.warp!), ...bf } } : {}),
    ...(hk ? { gain_hk: tripel(hkStrecke(hk, k.start_beat - c.start_beat, k.laenge_beats, c.loop_beats)) } : {}) }));
}
// 1.12 slice 5: points as playback triples [beat, wert, formcode]
const tripel = (p: readonly Punkt[]): [number, number, number][] => p.map((q) => [q.beat, q.wert, FORM_NR[q.form ?? 'linear']]);
// The loop copies of any clip as [clip beat of the copy start, length] (audio and MIDI follow the same rule, audioKopien)
const kopienVon = (c: Clip): [number, number][] => (c.loop_beats == null ? [[0, c.laenge_beats]]
  : Array.from({ length: Math.ceil(c.laenge_beats / c.loop_beats - 1e-9) },
    (_, k): [number, number] => [k * c.loop_beats!, Math.min(c.loop_beats!, c.laenge_beats - k * c.loop_beats!)]));
// 1.12 slice 5 (D7): the gain_hk points the translator writes for a clip, summed over its loop copies (the command check counts these)
export function gainHkPunkte(c: Clip): number {
  const hk = c.art === 'audio' && !c.stumm ? c.huellkurven?.find((h) => h.ziel === 'gain') : undefined;
  return hk ? kopienVon(c).reduce((n, [k0, laenge]) => n + hkStrecke(hk, k0, laenge, c.loop_beats).length, 0) : 0;
}
// 1.12 slice 5 (D9): the modulation envelopes of a track's clips merged into one relative lane per target: 0 outside the clip spans, a jump pair at
// every copy edge (two points at one beat at most: of a run at one beat the first and the last stay). Muted clips do not modulate.
// Clips may overlap on a track: the copy that starts later takes the modulation over from its start (the earlier one is cut there), so the beats rise.
// The copies of all clips of a target are ordered by their absolute start for this, a loop copy of an earlier clip included.
export function relativeLanen(clips: readonly Clip[]): WAuto[] {
  type Kopie = { a: number; k0: number; laenge: number; hk: Huellkurve; loop: number | null | undefined };
  const kopienJeZiel = new Map<string, Kopie[]>();
  const sortiert = [...clips].sort((a, b) => a.start_beat - b.start_beat);
  for (const c of sortiert) {
    if (c.art === 'audio' && c.stumm) continue;
    for (const hk of c.huellkurven ?? []) {
      if (!istModulation(hk.ziel)) continue;
      const ziel = modulationsZiel(hk.ziel), liste = kopienJeZiel.get(ziel) ?? [];
      for (const [k0, laenge] of kopienVon(c)) liste.push({ a: c.start_beat + k0, k0, laenge, hk, loop: c.loop_beats });
      kopienJeZiel.set(ziel, liste);
    }
  }
  const proZiel = new Map<string, Punkt[]>();
  for (const [ziel, kopien] of kopienJeZiel) {
    kopien.sort((x, y) => x.a - y.a);          // stable: copies that start together keep their clip order; every later start takes over
    const liste: Punkt[] = [];
    kopien.forEach(({ a, k0, laenge: voll, hk, loop }, i) => {
      const laenge = i + 1 < kopien.length ? Math.min(voll, kopien[i + 1].a - a) : voll;
      if (!(laenge > 1e-12)) return;
      liste.push({ beat: a, wert: 0 });
      hkStrecke(hk, k0, laenge, loop).forEach((q, j) => liste.push({ ...q, beat: a + q.beat, ...(j === 0 ? { form: 'sprung' as const } : {}) }));
      liste.push({ beat: a + laenge, wert: 0, form: 'sprung' });
    });
    proZiel.set(ziel, liste);
  }
  return [...proZiel].map(([ziel, liste]) => {
    const aus: Punkt[] = [];
    for (let i = 0; i < liste.length; i++) {
      let j = i;
      while (j + 1 < liste.length && liste[j + 1].beat === liste[i].beat) j++;
      aus.push(liste[i]);
      if (j > i && liste[j].wert !== liste[i].wert) aus.push({ ...liste[j], form: 'sprung' });
      i = j;
    }
    return { ziel: ziel as Ziel, punkte: tripel(aus), relativ: true as const };
  });
}

// Zahl der Warp-Marker aller Audio-Clips nach dem Ausrollen der Loops (jede Kopie trägt ihre Liste); der Kern lehnt über MAX_WARP_PUNKTE ab
// Slice 4: ein BEATS-Clip zählt zusätzlich seine Einheiten (e) je Kopie; wirft nie (D9). `o` liefert die Transienten, ohne gilt das Raster.
export function zaehleWarpMarker(p: Projekt, o?: Pick<UebersetzOptionen, 'transienten' | 'vorhoeren'>): number {
  let n = 0;
  for (const s of p.spuren) {
    for (const c of spurClips(s, o?.vorhoeren)) {
      if (c.art !== 'audio' || !c.warp?.an) continue;
      const k = audioKopien(c).length;
      n += c.warp.marker.length * k;
      if (c.warp.modus === 'beats') n += beatsEinheitenZahl(c.warp, c.loop_beats ?? c.laenge_beats, transientenFuer(c, o?.transienten)) * k;
    }
  }
  return n;
}

// --- tracker effect commands (task 14, ADR 040) -----------------------------------------------------------------------------
const GLATT: GeraetFx = { stufig: false, rollen: {} };
const bkGraph = (s: Spur): string | null => (s.geraet?.art === 'intern' && s.geraet.name === 'bk' ? s.geraet.graph : null);
// The timing of a track's effects: LPB and TICKS of the project, the device mode of a bk track (every other device runs smooth and has no roles)
export function fxRahmen(p: Projekt, s: Spur, gf?: GeraetFxFn): FxRahmen {
  // a pattern of a SEQ deck that came from a tracker section carries its frame on the deck marker (the live container has no tracker marker)
  const deck = s.ausgang?.art === 'gruppe' ? p.gruppen?.find((x) => x.id === s.ausgang!.id)?.seq : undefined;
  const e = trackerEinstellung(p);
  if (deck?.lpb !== undefined) e.lpb = deck.lpb;
  if (deck?.ticks !== undefined) e.ticks = deck.ticks;
  const graph = bkGraph(s), g = graph !== null && gf ? gf(graph) : GLATT;
  const k = s.geraet?.art === 'intern' && g.rollen.slot !== undefined ? (s.geraet.parameter as Record<string, number>)[`k${g.rollen.slot}`] : undefined;
  // the slot knob stands on the track's knob value (0 when the track holds none: the graph default is not reachable from here), clamped 0..1
  const slotBasis = g.rollen.slot === undefined ? {} : { slotBasis: Math.min(1, Math.max(0, typeof k === 'number' ? k : 0)) };
  return { lpb: e.lpb, ticks: e.ticks, stufig: g.stufig, rollen: g.rollen, ...slotBasis };
}
// What the effect commands of all clips of a track roll out to (absolute beats). `pan`: one span per clip, from its first PAN to the clip end.
interface SpurFx {
  bend: [number, number, number][]; pegel: [number, number, number][];
  regler: Map<number, [number, number][]>; pan: { von: number; bis: number; punkte: [number, number][] }[];
}
const EPS_FX = 1e-9;
// The clips run one after the other: the pitch, level, start and reverse state of a clip ends with the clip (a neutral point at its end, when it
// ends otherwise), so the notes of the next clip start clean. Panning returns at the clip end, see `fxLanen`.
function sammleFx(fx: SpurFx, c: MidiClip, a: ReturnType<typeof rolleFxAus>, rahmen: FxRahmen): void {
  const ende = c.start_beat + c.laenge_beats;
  fx.bend.push(...a.bend); fx.pegel.push(...a.pegel);
  if (a.bend.length && a.bend[a.bend.length - 1][1] !== 0) fx.bend.push([ende, 0, 0]);
  if (a.pegel.length && a.pegel[a.pegel.length - 1][1] !== 1) fx.pegel.push([ende, 1, 0]);
  for (const [knopf, l] of a.regler) {
    const liste = fx.regler.get(knopf) ?? [];
    liste.push(...l);
    if ((knopf === rahmen.rollen.start || knopf === rahmen.rollen.rueckwaerts) && l.length && l[l.length - 1][1] !== 0) liste.push([ende, 0]);
    fx.regler.set(knopf, liste);
  }
  if (a.pan.length) fx.pan.push({ von: a.pan[0][0], bis: ende, punkte: a.pan });
}
// The notes of a track (sorted) and, when a clip carries effect commands, their events. A clip without `fx` is unrolled as before.
function noten(s: Spur, rahmen: FxRahmen): { noten: WNote[]; fx: SpurFx | null } {
  const aus: WNote[] = [];
  const fx: SpurFx = { bend: [], pegel: [], regler: new Map(), pan: [] };
  let hat = false;
  for (const c of [...s.clips].sort((a, b) => a.start_beat - b.start_beat)) {
    if (c.art !== 'midi') continue;
    // 1.12 slice 5 (D10): a transpose envelope moves the pitch, read at the note start in the clip and rounded; the same id
    const hk = c.huellkurven?.find((h) => h.ziel === 'transpose');
    const ton = (n: Note, beat: number): number => (hk ? Math.min(127, Math.max(0, n.ton + Math.round(hkWert(hk, beat - c.start_beat, c.loop_beats)))) : n.ton);
    const ruf = (id: string, beat: number, laenge: number, n: Note): void => { aus.push({ id, beat, laenge, ton: ton(n, beat), vel: n.vel }); };
    if (!hatFxArbeit(c, rahmen)) { fuerAusgerollteNoten(c, ruf); continue; }
    hat = true;
    sammleFx(fx, c, rolleFxAus(c, rahmen, ruf), rahmen);
  }
  if (!hat) return { noten: aus.sort(sortiereNoten), fx: null };
  if (bkGraph(s) === null) { fx.bend.length = 0; fx.pegel.length = 0; fx.regler.clear(); }   // spec 6: no pitch, level or role effect off the Baukasten
  const nachBeat = (x: { 0: number }, y: { 0: number }): number => x[0] - y[0];   // Array.sort is stable: equal beats keep the order of the clips
  fx.bend.sort(nachBeat); fx.pegel.sort(nachBeat);
  for (const l of fx.regler.values()) l.sort(nachBeat);
  return { noten: aus.sort(sortiereNoten), fx };
}
// Value of a lane (points [beat, value, formcode]) at a beat: as the core reads it (the form belongs to the segment that ends at a point)
function laneWert(l: readonly [number, number, number][], beat: number): number {
  if (!(beat + EPS_FX >= l[0][0])) return l[0][1];
  let i = 0;
  while (i + 1 < l.length && l[i + 1][0] <= beat + EPS_FX) i++;
  if (i === l.length - 1 || beat <= l[i][0]) return l[i][1];
  const [a, b] = [l[i], l[i + 1]];
  if (b[2] === FORM_NR.sprung) return a[1];
  const u = (beat - a[0]) / (b[0] - a[0]), g = b[2] === FORM_NR.s ? u * u * (3 - 2 * u) : u;
  return a[1] + (b[1] - a[1]) * g;
}
// The absolute lanes a track's effect commands add to its own absolute lanes (D22): `pan` and one `geraet.k<n>` per role knob, all jump points.
// A role lane replaces a lane of the same target. PAN goes from the row to the clip end and then back to the track's own value (its lane value at that
// beat, else its pan setting); inside that span it wins over a pan lane of the track, outside the lane stays. A later clip takes over from its start.
function fxLanen(panWert: number, lanen: WAuto[], fx: SpurFx): WAuto[] {
  let aus = lanen;
  const setze = (l: WAuto): void => {
    const i = aus.findIndex((x) => x.ziel === l.ziel);
    aus = i >= 0 ? aus.map((x, k) => (k === i ? l : x)) : [...aus, l];
  };
  if (fx.pan.length) {
    const alt = lanen.find((l) => l.ziel === 'pan')?.punkte;
    const basis = (b: number): number => (alt ? laneWert(alt, b) : panWert);
    const spannen = [...fx.pan].sort((x, y) => x.von - y.von).map((x, i, l) => ({ ...x, bis: i + 1 < l.length ? Math.min(x.bis, l[i + 1].von) : x.bis }));
    const punkte: [number, number, number][] = (alt ?? []).filter((q) => !spannen.some((x) => q[0] >= x.von - EPS_FX && q[0] < x.bis - EPS_FX));
    for (const x of spannen) {
      for (const [beat, wert] of x.punkte) if (beat < x.bis - EPS_FX) punkte.push([beat, wert, FORM_NR.sprung]);
      punkte.push([x.bis, basis(x.bis), FORM_NR.sprung]);
    }
    punkte.sort((x, y) => x[0] - y[0]);
    if (punkte[0][0] > EPS_FX) punkte.unshift([0, basis(0), FORM_NR.sprung]);
    setze({ ziel: 'pan', punkte });
  }
  for (const [knopf, l] of [...fx.regler].sort((x, y) => x[0] - y[0])) {
    const ziel = `geraet.k${knopf}` as Ziel;
    if (l.length && ZIEL_BEREICH[ziel] !== undefined) setze({ ziel, punkte: l.map(([beat, wert]): [number, number, number] => [beat, wert, FORM_NR.sprung]) });
  }
  return aus;
}
// The lanes the project itself holds for a track, as the playback writes them (mute and solo always jump)
const eigeneLanen = (s: Spur): WAuto[] => (s.automation ?? []).filter((l) => !istKettenZiel(l.ziel)).map((l) => {
  const sprung = ZIEL_BEREICH[l.ziel as Ziel].nurSprung;
  const form = (q: { form?: string }): number => (sprung ? FORM_NR.sprung : FORM_NR[q.form ?? 'linear']);
  return { ziel: l.ziel as Ziel, punkte: l.punkte.map((q): [number, number, number] => [q.beat, q.wert, form(q)]) };
});
/** The pitch and level events of one track's effect commands (absolute beats, as the playback writes them); null without any (or off the Baukasten). */
export function fxEreignisse(p: Projekt, s: Spur, gf?: GeraetFxFn): { bend: [number, number, number][]; pegel: [number, number, number][] } | null {
  const rahmen = fxRahmen(p, s, gf);
  const fx = s.clips.some((c) => c.art === 'midi' && hatFxArbeit(c, rahmen)) ? noten(s, rahmen).fx : null;
  return fx && (fx.bend.length || fx.pegel.length) ? { bend: fx.bend, pegel: fx.pegel } : null;
}
/** What the effect commands of a project add to a playback, counted the way `uebersetze` writes it (the command check uses this, at the end of every
 *  list; a project without `fx` costs one pass over its clips). events: bend and pegel events; lanePunkte: points of the generated lanes beyond the
 *  tracks' own; breit: the widest generated lane. */
export function zaehleFx(
  p: Projekt, gf: GeraetFxFn = geraetFxRegister,
): { events: number; lanePunkte: number; breit: { spur: string; ziel: string; n: number } | null } {
  let events = 0, lanePunkte = 0, breit: { spur: string; ziel: string; n: number } | null = null;
  for (const s of p.spuren) {
    const rahmen = fxRahmen(p, s, gf);
    if (!s.clips.some((c) => c.art === 'midi' && hatFxArbeit(c, rahmen))) continue;
    const fx = noten(s, rahmen).fx;
    if (!fx) continue;
    events += fx.bend.length + fx.pegel.length;
    const eigen = eigeneLanen(s), neu = fxLanen(s.pan, eigen, fx);
    const summe = (l: WAuto[]): number => l.reduce((n, x) => n + x.punkte.length, 0);
    lanePunkte += Math.max(0, summe(neu) - summe(eigen));
    for (const l of neu) {
      if (eigen.includes(l)) continue;
      if (l.punkte.length > (breit?.n ?? 0)) breit = { spur: s.id, ziel: l.ziel, n: l.punkte.length };
    }
  }
  return { events, lanePunkte, breit };
}

/** The role lanes (`geraet.k<n>`) that the effect commands of a track would write over a lane the track already holds, as "spur_id/ziel" keys.
 *  The playback lets the role lane win (D22); the command list check refuses a list that creates such a clash instead of silencing the project lane. */
export function fxKollisionen(p: Projekt, gf: GeraetFxFn = geraetFxRegister): Set<string> {
  const aus = new Set<string>();
  for (const s of p.spuren) {
    const rahmen = fxRahmen(p, s, gf);
    if (!s.clips.some((c) => c.art === 'midi' && hatFxArbeit(c, rahmen))) continue;
    const fx = noten(s, rahmen).fx;
    if (!fx || fx.regler.size === 0) continue;
    for (const [knopf, l] of fx.regler) {
      const ziel = `geraet.k${knopf}`;
      if (l.length && (s.automation ?? []).some((x) => x.ziel === ziel && x.punkte.length > 0)) aus.add(`${s.id}/${ziel}`);
    }
  }
  return aus;
}

// 1.9 U7: the device part of a rack member, the same fields a track of that device carries (no notes)
const gliedGeraet = (g: GliedGeraet): WGliedGeraet => (g.art === 'wirt' ? { art: 'wirt', slot: g.slot }
  : g.name === 'bk' ? { art: 'intern', geraet: 'bk', graph: g.graph, parameter: { ...g.parameter } }
    : g.name === 'kit' ? { art: 'intern', geraet: 'kit', kit: g.kit } : { art: 'intern', geraet: 'rb338', parameter: { ...g.parameter } });

export function uebersetze(p: Projekt, opt: UebersetzOptionen): Wiedergabe {
  hostHaken = { host: opt.host, ohne: opt.ohneHost };
  try { return uebersetzeIntern(p, opt); } finally { hostHaken = {}; }
}
// The top group (no `ausgang`) a group id leads up to; undefined for an unknown id or none
function spitze(p: Projekt, id: string | undefined): string | undefined {
  const gl = p.gruppen ?? [];
  for (let g = gl.find((x) => x.id === id), n = 0; g && n <= gl.length; n++) {
    if (!g.ausgang) return g.id;
    g = gl.find((x) => x.id === g!.ausgang!.id);
  }
  return undefined;
}

/** Container number 1..4 of a top group of a live project (the place that holds it); null = parked or not a live project */
export function containerNr(p: Projekt, g: { id: string }): 1 | 2 | 3 | 4 | null {
  return p.live === true ? platzVonGruppe(p, g.id) : null;
}

/** What feeds each container of a live project (F5): 0 empty, 1 the player (a track place), 2 the module of the arrangement engine (every other place type).
 *  null = no places (a production project): nothing is sent. */
export function containerQuellen(p: Projekt): [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] | null {
  if (p.live !== true || !p.plaetze) return null;
  const art = (t: string): 0 | 1 | 2 => (t === 'leer' ? 0 : t === 'track' ? 1 : 2);
  const [a, b, c, d] = p.plaetze;
  return [art(a.typ), art(b.typ), art(c.typ), art(d.typ)];
}

// The top group that owns a return of a live project: its stored owner, else the deck or the strudel module it belongs to
function returnEigner(p: Projekt, r: NonNullable<Projekt['returns']>[number]): string | undefined {
  if (r.gruppe !== undefined) return r.gruppe;
  if (r.loopdeck) return loopDeckGruppe(p, r.loopdeck.platz)?.id;
  if (r.strudel) return strudelGruppe(p)?.id;
  return undefined;
}

// send_ausser_modul: a send must stay inside its module. A track or group whose top group differs from the owner of the return it sends into is refused.
function pruefeSendModule(p: Projekt, geparkt: (id: string | undefined) => boolean): void {
  const eigner = new Map((p.returns ?? []).map((r) => [r.id, returnEigner(p, r)] as const));
  const pruefe = (wer: string, spitzeId: string | undefined, sends: { id: string }[] | undefined): void => {
    for (const sd of sends ?? []) {
      const e = eigner.get(sd.id);
      if (e !== undefined && spitzeId !== undefined && e !== spitzeId) {
        throw new WiedergabeFehler('send_ausser_modul', `${wer} sends into the return ${sd.id}, which belongs to the module ${e}`);
      }
    }
  };
  for (const s of p.spuren) if (!geparkt(s.ausgang?.id)) pruefe(s.id, spitze(p, s.ausgang?.id), s.sends);
  for (const g of p.gruppen ?? []) if (!geparkt(g.id)) pruefe(g.id, spitze(p, g.id), g.sends);
}

/**
 * The loader invariants of a live playback (the core refuses these with the same reasons): `dj_doppelt` (two top groups on one DJ output) and
 * `live_ohne_container` (a track or a return that does not end in a top group with a DJ output, or a track whose output is the production master).
 */
export function pruefeLiveWiedergabe(w: Wiedergabe): void {
  const gruppen = new Map((w.gruppen ?? []).map((g) => [g.nr, g] as const));
  const benutzt = new Set<number>();
  for (const g of w.gruppen ?? []) {
    if (g.ausgang.art !== 'dj') continue;
    if (benutzt.has(g.ausgang.nr)) throw new WiedergabeFehler('dj_doppelt', `two groups lead into the DJ output ${g.ausgang.nr}`);
    benutzt.add(g.ausgang.nr);
  }
  const imContainer = (ziel: { art: string; nr?: number } | undefined): boolean => {
    for (let z = ziel, n = 0; z && n <= gruppen.size; n++) {
      if (z.art === 'dj') return true;
      if (z.art !== 'gruppe') return false;
      z = gruppen.get(z.nr!)?.ausgang;
    }
    return false;
  };
  for (const s of w.spuren) if (!imContainer(s.ausgang)) throw new WiedergabeFehler('live_ohne_container', `track ${s.nr} does not play into a container`);
  for (const r of w.returns ?? []) if (!imContainer(r.ausgang)) throw new WiedergabeFehler('live_ohne_container', `return ${r.nr} does not play into a container`);
}

function uebersetzeIntern(p: Projekt, opt: UebersetzOptionen): Wiedergabe {
  if (!Number.isInteger(opt.nr) || opt.nr < 1) throw new WiedergabeFehler('nr_ungueltig', `Wiedergabe-Nummer ${opt.nr}`);
  if (p.spuren.length > MAX_SPUREN) throw new WiedergabeFehler('zu_gross', `spuren: ${p.spuren.length} > ${MAX_SPUREN}`);
  const o = { ...opt, frames: opt.frames ?? dateiFrames(opt.audioOrdner) };
  let clips = 0, nZahl = 0, fxEvents = 0;
  const fxJe = new Map<string, SpurFx>();   // the effect events of the tracks that carry effect commands
  const ohneZiel = (s: Spur): WSpur => {
    if (s.art === 'strom') return { nr: s.nr, art: 'intern', quelle: { art: 'strom', strom: s.strom! } };
    if (s.art === 'audio') {
      const cs = spurClips(s, o.vorhoeren).flatMap((c) => (c.art === 'audio' ? audioClips(c, o) : []))
        .sort((a, b) => a.start_beat - b.start_beat || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      clips += cs.length;
      const zellen = deckZellen(s, o);
      return { nr: s.nr, art: 'audio', clips: cs, ...(zellen ? { id: s.id, zellen } : {}) };
    }
    const g = s.geraet!;
    if (wirtSlots(s).length > 0 && s.freeze) {            // 1.9 U7 T4: a frozen rack with a Surge member is its audio clip too
      if (!o.arbeitsordner) throw new WiedergabeFehler('arbeitsordner_fehlt', `Spur ${s.id} ist eingefroren`);
      const datei = path.join(o.arbeitsordner, s.freeze.datei);
      if (!(o.existiert ?? fs.existsSync)(datei)) throw new WiedergabeFehler('datei_fehlt', datei);
      clips += 1;                                            // die sha256 steht im Projekt (beim Einfrieren berechnet, Spec 6.2): die Datei wird nicht gelesen
      const laenge = s.freeze.frames / SAMPLERATE * p.tempo_bpm / 60;
      return { nr: s.nr, art: 'audio', clips: [{ id: `${s.id}/freeze`, start_beat: s.freeze.von_beat ?? 0, laenge_beats: laenge,
        sha256: s.freeze.sha256, datei, frames: s.freeze.frames, offset_frames: 0, gain_db: 0, ein_beats: 0, aus_beats: 0 }] };
    }
    const { noten: n, fx } = noten(s, fxRahmen(p, s, opt.geraetFx ?? geraetFxRegister)); nZahl += n.length;
    if (fx) { fxJe.set(s.id, fx); fxEvents += fx.bend.length + fx.pegel.length; }
    if (g.art === 'rack') {
      const gl = g.glieder.map((m): WGlied => ({ id: m.id, ...gliedGeraet(m.geraet), ton: m.ton ?? [0, 127], vel: m.vel ?? [1, 127], kette: m.kette ?? [0, 127],
        gain_db: m.gain_db ?? 0 }));
      return { nr: s.nr, art: 'intern', geraet: 'rack', kette: g.kette, glieder: gl, noten: n };
    }
    return g.art === 'intern'
      ? (g.name === 'bk'                                        // Baukasten S20: the graph name goes to the kern, which builds the graph off the callback
        ? { nr: s.nr, art: 'intern', geraet: 'bk', graph: g.graph, parameter: { ...g.parameter },
          ...(g.stifte ? { stifte: g.stifte.map((e) => [...e] as Stift) } : {}), noten: n,
          ...(fx?.bend.length ? { bend: fx.bend } : {}), ...(fx?.pegel.length ? { pegel: fx.pegel } : {}) }
        : g.name === 'kit'                                      // 1.9 (L25): the kern loads <kit folder>/<kit> in its loader thread
          ? { nr: s.nr, art: 'intern', geraet: 'kit', kit: g.kit, noten: n }
          : { nr: s.nr, art: 'intern', geraet: 'rb338', parameter: { ...g.parameter }, noten: n })
      : { nr: s.nr, art: 'wirt', slot: g.slot, noten: n };
  };
  // 1.10 (P2): Ziel je Spur; die Gruppen-Nummer, nicht die ID, steht in der Wiedergabe (der Kern kennt nur Nummern)
  const nrVon = new Map((p.gruppen ?? []).map((g) => [g.id, g.nr] as const));
  let autoPunkte = 0;
  // container core: in a live project a top group that no place holds is parked, so it and everything below it (tracks, groups) and the returns it owns are
  // left out of the playback; their stored nr values stay as they are (the core accepts gaps)
  const live = p.live === true;
  const spitzeVon = (id: string | undefined): string | undefined => spitze(p, id);
  const geparkt = (id: string | undefined): boolean => { const t = spitzeVon(id); return live && t !== undefined && platzVonGruppe(p, t) === null; };
  const spuren: WSpur[] = [...p.spuren].filter((s) => !geparkt(s.ausgang?.id)).sort((a, b) => a.nr - b.nr).map((s): WSpur => {
    const w0 = ohneZiel(s);
    let w: WSpur = w0;
    if (opt.stummStart?.has(s.nr)) w = { ...w0, stumm_start: true };
    if (s.ausgang) {
      const nr = nrVon.get(s.ausgang.id);
      if (nr === undefined) throw new WiedergabeFehler('ziel_unbekannt', `Spur ${s.id} zeigt auf ${s.ausgang.id}`);
      w = { ...w, ausgang: { art: 'gruppe' as const, nr } };
    }
    const lanes = (s.automation ?? []).filter((l) => !istKettenZiel(l.ziel));
    const gr = s.ausgang ? (p.gruppen ?? []).find((g) => g.id === s.ausgang!.id) : undefined;
    const bl = gr?.automation?.find((l) => istBlendZiel(l.ziel) && l.ziel === `blend:${gr.id}`);
    if (bl && !lanes.some((l) => l.ziel === 'fader') && (s.art === 'audio' || s.art === 'instrument')) {
      const pf = blendPfad(p, gr!.id);
      const welche = pf?.original === s ? 'original' : pf?.neu === s ? 'neu' : null;
      if (welche) {
        const punkte = blendLanen(bl, welche, gr!.neu_trim_db ?? 0);
        autoPunkte += punkte.length;
        w = { ...w, auto: [{ ziel: 'fader' as Ziel, punkte }] };
      }
    }
    // Automation: `auto` only with a lane, else the file stays the previous one. Effect commands add pan and role lanes (task 14)
    const fxS = fxJe.get(s.id);
    const absolut = fxS ? fxLanen(s.pan, eigeneLanen(s), fxS) : eigeneLanen(s);
    if (absolut.length) {
      autoPunkte += absolut.reduce((n, l) => n + l.punkte.length, 0);
      w = { ...w, auto: [...(w.auto ?? []), ...absolut] };
    }
    const relativ = relativeLanen(spurClips(s, o.vorhoeren));   // 1.12 slice 5 (D9): modulation envelopes, after the absolute lanes
    if (relativ.length) {
      autoPunkte += relativ.reduce((n, l) => n + l.punkte.length, 0);
      w = { ...w, auto: [...(w.auto ?? []), ...relativ] };
    }
    if (w.art === 'audio') autoPunkte += w.clips.reduce((n, c) => n + (c.gain_hk?.length ?? 0), 0);   // gain_hk counts with the lanes (D7)
    const ke = kette(s.inserts, s, s.art === 'instrument' && wirtSlots(s).length > 0 && !!s.freeze);
    autoPunkte += kettenPunkte(ke);
    return { ...w, ...ke };
  });
  // groups, returns and the PM (slice 6: their chain lanes count with the others and go to the core, at most ARR_KLANES_MAX of them in all)
  const gruppenNr = new Map((p.gruppen ?? []).map((g) => [g.id, g.nr]));
  const gruppenW = [...(p.gruppen ?? [])].filter((g) => !geparkt(g.id)).sort((a, b) => a.nr - b.nr).map((g) => {
    const ziel = g.ausgang ? gruppenNr.get(g.ausgang.id) : undefined;
    if (g.ausgang && ziel === undefined) throw new WiedergabeFehler('ziel_unbekannt', `Gruppe ${g.id} zeigt auf ${g.ausgang.id}`);
    // container core: the top group of a live project that sits in place N (`plaetze`) plays into container N
    const dj = live && ziel === undefined ? (containerNr(p, g) ?? 0) : 0;
    const ausgang = dj ? { art: 'dj' as const, nr: dj as WDjNr }
      : ziel === undefined ? { art: 'master' as const } : { art: 'gruppe' as const, nr: ziel };
    return { nr: g.nr, ausgang, ...kette(g.inserts, g) };
  });
  // return automation slice 2: the fader lane of a return goes to the core as returns[].auto (the same conversion as on a track); only `fader` is legal there
  const returnsW: WReturn[] = [...(p.returns ?? [])].filter((r) => !(live && returnEigner(p, r) !== undefined && geparkt(returnEigner(p, r)))).sort((a, b) => a.nr - b.nr).map((r) => {
    const rl = (r.automation ?? []).filter((l) => l.ziel === 'fader');
    autoPunkte += rl.reduce((n, l) => n + l.punkte.length, 0);
    const auto = rl.map((l): WAuto => ({ ziel: 'fader', punkte: l.punkte.map((q) => [q.beat, q.wert, FORM_NR[q.form ?? 'linear']]) }));
    // a return sounds in the container of the module that owns it (live project only); a production return goes to the master as before
    const eigner = live ? returnEigner(p, r) : undefined;
    const rOrt = eigner !== undefined ? containerNr(p, { id: eigner }) : null;
    return { nr: r.nr, ausgang: rOrt !== null ? { art: 'dj' as const, nr: rOrt as WDjNr } : { art: 'master' as const },
      ...(r.pre ? { pre: true as const } : {}), ...(auto.length ? { auto } : {}),
      ...kette(r.inserts, r) };
  });
  const pmW = p.master?.inserts?.length ? kette(p.master.inserts, p.master) as { chain: WInsert[]; rack?: WRack; chain_auto?: WKettenLane[] } : undefined;
  const streifen: { chain_auto?: WKettenLane[] }[] = [...gruppenW, ...returnsW, ...(pmW ? [pmW] : [])];
  for (const k of streifen) autoPunkte += kettenPunkte(k);   // the tracks were counted above
  const kettenLanen = [...spuren as { chain_auto?: WKettenLane[] }[], ...streifen].reduce((n, k) => n + (k.chain_auto?.length ?? 0), 0);
  if (kettenLanen > MAX_KETTEN_LANEN) throw new WiedergabeFehler('zu_gross', `insert and rack lanes: ${kettenLanen} > ${MAX_KETTEN_LANEN}`);
  if (autoPunkte > MAX_AUTO_PUNKTE) throw new WiedergabeFehler('zu_gross', `auto-punkte: ${autoPunkte} > ${MAX_AUTO_PUNKTE}`);
  if (clips > MAX_CLIPS) throw new WiedergabeFehler('zu_gross', `clips: ${clips} > ${MAX_CLIPS}`);
  if (nZahl > MAX_NOTEN) throw new WiedergabeFehler('zu_gross', `noten: ${nZahl} > ${MAX_NOTEN}`);
  if (fxEvents > MAX_FX_PUNKTE) throw new WiedergabeFehler('zu_gross', `after unrolling ${fxEvents} pitch and level events (at most ${MAX_FX_PUNKTE})`);
  const routing = spuren.some((s) => s.ausgang) || (p.gruppen ?? []).length > 0;
  if (returnsW.length > MAX_RETURNS) throw new WiedergabeFehler('zu_gross', `returns: ${returnsW.length} > ${MAX_RETURNS}`);
  const hatReturns = returnsW.length > 0;                          // slice 3: returns need /2 (the kern refuses them in /1)
  // Paket 1.13: ein gewarpter Clip braucht /2 (der Kern lehnt warp in /1 ab); gruppen steht dann immer da, auch leer
  const gewarpt = spuren.some((sp) => sp.art === 'audio' && sp.clips.some((c) => c.warp !== undefined));
  if (gewarpt && zaehleWarpMarker(p, opt) > MAX_WARP_PUNKTE) throw new WiedergabeFehler('zu_gross', `warp-marker: > ${MAX_WARP_PUNKTE}`);
  const eingefuegt = (p.spuren.some((sp) => sp.inserts?.length) || (p.gruppen ?? []).some((g) => g.inserts?.length)
    || (p.returns ?? []).some((r) => r.inserts?.length || r.pre) || !!p.master?.inserts?.length);   // slice 4: a chain or pre needs /2
  const automatisiert = spuren.some((sp) => sp.auto !== undefined);       // Automation braucht /2 (der Kern lehnt auto in /1 ab)
  const hatRack = spuren.some((sp) => sp.art === 'intern' && sp.geraet === 'rack');   // 1.9 U7: the core refuses geraet rack in /1
  const stummig = spuren.some((sp) => (sp as { stumm_start?: true }).stumm_start === true);   // the core knows stumm_start from /2 only
  const huellen = spuren.some((sp) => sp.art === 'audio' && sp.clips.some((c) => c.gain_hk !== undefined));   // 1.12 slice 5: gain_hk is /2 only
  // bend and pegel are /2 only
  const fxDa = spuren.some((sp) => sp.art === 'intern' && sp.geraet === 'bk' && (sp.bend !== undefined || sp.pegel !== undefined));
  if (live) {                                                              // a live project is always /4 with the head flag `live`
    pruefeSendModule(p, geparkt);
    const w4: Wiedergabe = { format: WIEDERGABE_FORMAT_4, nr: opt.nr, spuren, live: true, gruppen: gruppenW,
      ...(hatReturns ? { returns: returnsW } : {}), ...(pmW ? { pm: pmW } : {}) };
    pruefeLiveWiedergabe(w4);
    return w4;
  }
  // ohne Routing, Warp und Lane byteweise die alte Datei (AK3)
  if (!routing && !gewarpt && !automatisiert && !hatReturns && !eingefuegt && !huellen && !hatRack && !stummig && !fxDa) {
    return { format: WIEDERGABE_FORMAT, nr: opt.nr, spuren };
  }
  const retLane = returnsW.some((r) => r.auto !== undefined);              // return automation slice 2: a return lane needs /3 (the version gate)
  return { format: retLane ? WIEDERGABE_FORMAT_3 : WIEDERGABE_FORMAT_2, nr: opt.nr, spuren,
    gruppen: gruppenW,
    ...(hatReturns ? { returns: returnsW } : {}),
    ...(pmW ? { pm: pmW } : {}) };
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
// Spec 6.31: haltbar wie project.json (storage.ts): Inhalt mit fsync auf die Temp-Datei, rename, fsync auf den Ordner. Ohne fsync kann nach
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
