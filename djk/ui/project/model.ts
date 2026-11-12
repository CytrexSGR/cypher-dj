// Projektmodell D1 (Spec docs/masterplan/D1-SPEC.md 3.3): project.json im Format cypherdj-projekt/2 (/1 wird beim Laden gehoben, 1.10 P3).
// Typen, Prüfung, Erzeugung, IDs.
// Reine Funktionen, keine Datei, kein Server. Die Prüfung ist geschlossen: ein unbekanntes Feld ist ein Fehler (Tippfehler sollen
// auffallen, die Version des Formats ist festgelegt; Erweiterungen bekommen die nächste Nummer).
// Paket 1.13: Audio-Clips dürfen in /2 einen Warp tragen (ein weiteres optionales Feld, keine neue Nummer); in /1 ist warp ein unbekanntes Feld.
import { SEGMENT_BPM_MAX, SEGMENT_BPM_MIN } from './warp.ts';
import type { Punkt } from './lane.ts';
import { BK_INSERT_OPTIONAL, BK_REGLER_MIN, BK_REGLER_ZAHL, bkInsertAuffuellen, pruefeBkListe, type BkKanal } from './modular.ts';
import { INSERT_ARTEN } from './insert_key.ts';
import { SCHLUESSEL_DJ, SCHLUESSEL_NUR_ZEILE } from './key_table.ts';
import { huellkurvenPruefung, type Huellkurve } from './envelope.ts';
import { PRESET_ID } from '../presets/preset_id.ts';   // 1.16 rest: zero-import file, keeps this module free of file access
export type { Punkt, LaneForm } from './lane.ts';

export const FORMAT = 'cypherdj-projekt/2';
export const FORMAT_ALT = 'cypherdj-projekt/1';   // 1.10 (P3): /1 öffnet weiter und wird beim Laden im Speicher zu /2
export const MAX_SPUREN = 32;          // gleich public/production/limits.js, geprüft von tests/limits.test.mjs
export const MAX_GRUPPEN = 8;          // 1.10 (F1: eigene Plätze neben den 32 Spuren); gleich limits.js
// 1.10 slice 3: returns (own strips next to the 8 groups); equal to public/production/limits.js, checked by tests/limits.test.mjs
export const MAX_RETURNS = 4;
// 1.10 slice 4: insert chain per strip (track, group, return, master). The pool sizes equal the generated contract (insert_key.ts),
// pinned by tests/projekt_inserts.test.mjs. `komp` (4a), `eq`, `saett` and `lim` (4b) and `utility` (arr-fx) are accepted
// (INSERT_ARTEN_AKTIV); the sizes of eq and
// saett were decided by the cost measurement (T11, docs/architecture/stand/routing-1-10.md) and live in the contract only: these constants are read from it.
export const MAX_INSERTS_PRO_STRANG = 4;
export const MAX_INS_KOMP = INSERT_ARTEN.komp.instanzen;
export const MAX_INS_EQ = INSERT_ARTEN.eq.instanzen;
export const MAX_INS_SAETT = INSERT_ARTEN.saett.instanzen;
export const MAX_INS_LIM = INSERT_ARTEN.lim.instanzen;
export const MAX_INS_UTIL = INSERT_ARTEN.utility.instanzen;   // arr-fx slice 1
export const MAX_INS_BK = INSERT_ARTEN.bk.instanzen;   // arr-bk slice 3: Baukasten effect stages
export const MAX_RACK = INSERT_ARTEN.rack.instanzen;
// 1.10 slice 4c: rack macros. Four macros per rack, at most MAX_MAKRO_ZIELE mappings per strip (= ARR_MAKRO_ZIELE of the core, checked by
// tests/project_rack.test.mjs).
export const MAX_MAKROS = 4;
export const MAX_MAKRO_ZIELE = 16;
export const MAKRO_NAME_MAX = 24;
export const WIRT_SLOTS = 2;            // 1.9 (L10): two production hosts (arr1, arr2); the core has the ports for both
export const MAX_CLIPS = 4096;          // Grenzen des Kerns (Spec 3.2)
export const MAX_NOTEN = 65536;
export const TEMPO_MIN = 60;
export const TEMPO_MAX = 200;
export const MAX_BEAT = 100_000;        // Obergrenze für Lagen und Längen: schützt vor Unsinn, ~25 000 Takte
export const FADER_MIN = -200;          // −200 heißt im Stellwerk „aus"
export const GAIN_MIN = -96;           // Spec 6.27: Clip-Gain −96..+24 dB, derselbe Bereich nimmt der Kern an
export const GAIN_MAX = 24;
export const FADER_MAX = 6;            // Spec 6.16: Spur-Fader −200..+6 dB in allen Fundorten
export const SAMPLERATE = 48000;
export const GRUPPE_MAX = 32;          // Paket 1.18 E-c: Länge des Gruppennamens einer Spur (Varianten)
// S18: the recordable internal inputs live in contract/streams.ts next to their kern tap codes (REC_EINGANG)
import { INTERNE_EINGAENGE } from '../../contract/streams.ts';
export { INTERNE_EINGAENGE };
export const MAX_ARM_AUDIO = 8;
// Automation Slice 1 (ADR 032): Lanes sind Projektdaten, ein optionales Feld der Spur in /2 (keine neue Nummer). Gleich arr_playback.h (ARR_AUTO_*).
// Slice 2 (E1): eight targets; of the RB-338 parameters only the four smoothed ones (rb_dsp/src/parameter.rs:76-86) are lane targets
// E2: value range per target (the key order is the order of E1); mute and solo are switches (0 or 1) whose points are always `sprung`
export const ZIEL_BEREICH = {
  fader: { min: FADER_MIN, max: FADER_MAX, nurSprung: false },
  pan: { min: -1, max: 1, nurSprung: false },
  mute: { min: 0, max: 1, nurSprung: true },
  solo: { min: 0, max: 1, nurSprung: true },
  'geraet.lautstaerke': { min: 0, max: 1, nurSprung: false },
  'geraet.cutoff': { min: 0, max: 1, nurSprung: false },
  'geraet.resonanz': { min: 0, max: 1, nurSprung: false },
  'geraet.env_mod': { min: 0, max: 1, nurSprung: false },
  // 1.12 slice 7: the knobs of a Baukasten (bk) track (k1..k8 first, k9..k64 appended)
  'geraet.k1': { min: 0, max: 1, nurSprung: false },
  'geraet.k2': { min: 0, max: 1, nurSprung: false },
  'geraet.k3': { min: 0, max: 1, nurSprung: false },
  'geraet.k4': { min: 0, max: 1, nurSprung: false },
  'geraet.k5': { min: 0, max: 1, nurSprung: false },
  'geraet.k6': { min: 0, max: 1, nurSprung: false },
  'geraet.k7': { min: 0, max: 1, nurSprung: false },
  'geraet.k8': { min: 0, max: 1, nurSprung: false },
  // knobs 9..32
  'geraet.k9': { min: 0, max: 1, nurSprung: false },
  'geraet.k10': { min: 0, max: 1, nurSprung: false },
  'geraet.k11': { min: 0, max: 1, nurSprung: false },
  'geraet.k12': { min: 0, max: 1, nurSprung: false },
  'geraet.k13': { min: 0, max: 1, nurSprung: false },
  'geraet.k14': { min: 0, max: 1, nurSprung: false },
  'geraet.k15': { min: 0, max: 1, nurSprung: false },
  'geraet.k16': { min: 0, max: 1, nurSprung: false },
  'geraet.k17': { min: 0, max: 1, nurSprung: false },
  'geraet.k18': { min: 0, max: 1, nurSprung: false },
  'geraet.k19': { min: 0, max: 1, nurSprung: false },
  'geraet.k20': { min: 0, max: 1, nurSprung: false },
  'geraet.k21': { min: 0, max: 1, nurSprung: false },
  'geraet.k22': { min: 0, max: 1, nurSprung: false },
  'geraet.k23': { min: 0, max: 1, nurSprung: false },
  'geraet.k24': { min: 0, max: 1, nurSprung: false },
  'geraet.k25': { min: 0, max: 1, nurSprung: false },
  'geraet.k26': { min: 0, max: 1, nurSprung: false },
  'geraet.k27': { min: 0, max: 1, nurSprung: false },
  'geraet.k28': { min: 0, max: 1, nurSprung: false },
  'geraet.k29': { min: 0, max: 1, nurSprung: false },
  'geraet.k30': { min: 0, max: 1, nurSprung: false },
  'geraet.k31': { min: 0, max: 1, nurSprung: false },
  'geraet.k32': { min: 0, max: 1, nurSprung: false },
  // knobs 33..64 (appended, Task 4 of the synth build-out)
  'geraet.k33': { min: 0, max: 1, nurSprung: false },
  'geraet.k34': { min: 0, max: 1, nurSprung: false },
  'geraet.k35': { min: 0, max: 1, nurSprung: false },
  'geraet.k36': { min: 0, max: 1, nurSprung: false },
  'geraet.k37': { min: 0, max: 1, nurSprung: false },
  'geraet.k38': { min: 0, max: 1, nurSprung: false },
  'geraet.k39': { min: 0, max: 1, nurSprung: false },
  'geraet.k40': { min: 0, max: 1, nurSprung: false },
  'geraet.k41': { min: 0, max: 1, nurSprung: false },
  'geraet.k42': { min: 0, max: 1, nurSprung: false },
  'geraet.k43': { min: 0, max: 1, nurSprung: false },
  'geraet.k44': { min: 0, max: 1, nurSprung: false },
  'geraet.k45': { min: 0, max: 1, nurSprung: false },
  'geraet.k46': { min: 0, max: 1, nurSprung: false },
  'geraet.k47': { min: 0, max: 1, nurSprung: false },
  'geraet.k48': { min: 0, max: 1, nurSprung: false },
  'geraet.k49': { min: 0, max: 1, nurSprung: false },
  'geraet.k50': { min: 0, max: 1, nurSprung: false },
  'geraet.k51': { min: 0, max: 1, nurSprung: false },
  'geraet.k52': { min: 0, max: 1, nurSprung: false },
  'geraet.k53': { min: 0, max: 1, nurSprung: false },
  'geraet.k54': { min: 0, max: 1, nurSprung: false },
  'geraet.k55': { min: 0, max: 1, nurSprung: false },
  'geraet.k56': { min: 0, max: 1, nurSprung: false },
  'geraet.k57': { min: 0, max: 1, nurSprung: false },
  'geraet.k58': { min: 0, max: 1, nurSprung: false },
  'geraet.k59': { min: 0, max: 1, nurSprung: false },
  'geraet.k60': { min: 0, max: 1, nurSprung: false },
  'geraet.k61': { min: 0, max: 1, nurSprung: false },
  'geraet.k62': { min: 0, max: 1, nurSprung: false },
  'geraet.k63': { min: 0, max: 1, nurSprung: false },
  'geraet.k64': { min: 0, max: 1, nurSprung: false },
} as const satisfies Record<string, { min: number; max: number; nurSprung: boolean }>;
export type Ziel = keyof typeof ZIEL_BEREICH;
// Slice 2 (E1): eight targets; of the RB-338 parameters only the four smoothed ones (rb_dsp/src/parameter.rs:74-87) are lane targets
export const AUTO_ZIELE = Object.keys(ZIEL_BEREICH) as Ziel[];
export const GERAET_PRAEFIX = 'geraet.';
export const istGeraetZiel = (z: string): boolean => z.startsWith(GERAET_PRAEFIX);
// geraet.* lanes address the parameters of the device of the track: the four RB-338 parameters on an RB-338 track, the knobs k1..k64 on a bk track
export const istRbGeraet = (g: unknown): boolean => {
  const d = g as { art?: unknown; name?: unknown } | null | undefined;
  return typeof d === 'object' && d !== null && d.art === 'intern' && d.name === 'rb338';
};
export const istBkGeraet = (g: unknown): boolean => {
  const d = g as { art?: unknown; name?: unknown } | null | undefined;
  return typeof d === 'object' && d !== null && d.art === 'intern' && d.name === 'bk';
};
export const RB_ZIELE: readonly Ziel[] = ['geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod'];
export const BK_ZIELE: readonly Ziel[] = Array.from({ length: 64 }, (_, i) => `geraet.k${i + 1}` as Ziel);
// does the device lane `ziel` belong to the device of this track? (a track without lanes of that kind never asks)
export const passtGeraetZiel = (ziel: string, geraet: unknown): boolean =>
  istRbGeraet(geraet) ? (RB_ZIELE as readonly string[]).includes(ziel) : istBkGeraet(geraet) ? (BK_ZIELE as readonly string[]).includes(ziel) : false;
export const AUTO_FORMEN = ['linear', 's', 'sprung'] as const;
export const MAX_LANES_PRO_SPUR = 12;
// 1.12 slice 6: chain lanes in the whole project = ARR_KLANES_MAX in arr_playback.h (the core refuses more: zu_gross)
export const MAX_KETTEN_LANEN = 64;
export const MAX_TAKES_PRO_SPUR = 32;      // 1.14 comping: take lanes per audio track
export const TAKE_NAME_MAX = 64;
export const MAX_LANE_PUNKTE = 8192;
export const MAX_AUTO_PUNKTE = 65536;
// gesperrt (slice 2, E4): only `true` is ever written; an unlocked lane has no key, so slice 1 projects stay byte for byte the same
// 1.12 slice 6: a lane may also drive a parameter of an insert stage (`insert.<stage id>.<param>`, the parameter name as in `Insert.werte`, a continuous one)
// or a macro of the rack of the strip (`rack.m1` .. `rack.m4`). Such a lane is stored on the strip that carries the stage or rack (a track, group,
// return or the master: `automation` exists on every strip); its value range is the parameter's own (macro: 0..1), its points are never `sprung`-only.
export type KettenZiel = `insert.${string}.${string}` | `rack.m${1 | 2 | 3 | 4}`;
export interface Lane { id: string; ziel: Ziel | KettenZiel; punkte: Punkt[]; gesperrt?: true }
export interface ZielBereich { min: number; max: number; nurSprung: boolean }
// 1.8 Slice 1: optional; fehlt es, ist die Spur nicht scharf und ohne Eingang.
// 1.8 S0: external pairs (audio tracks, slice 2), midi_ein_1 (instrument tracks, slice 5) and the monitor setting. `monitor` absent means auto (Live's default,
// D11); only 'aus' and 'ein' are ever written. The kern ignores it for internal sources.
export type EingangIntern = { art: 'intern'; name: (typeof INTERNE_EINGAENGE)[number] };
export type EingangExtern = { art: 'extern'; paar: 1 | 2 | 3 | 4; modus: 'stereo' | 'links' | 'rechts' | 'summe' };
export type EingangMidi = { art: 'midi' };
export const EXTERN_MODI = ['stereo', 'links', 'rechts', 'summe'] as const;
export interface SpurAufnahme { scharf: boolean; eingang: EingangIntern | EingangExtern | EingangMidi | null; monitor?: 'aus' | 'ein' }
// 1.8 S0 (D17): project level recording settings. The key is written only after the first `aufnahme_setzen`; absent means AUFNAHME_VORGABE.
export interface ProjektAufnahme {
  vorzaehler_takte: 0 | 1 | 2 | 4; punch: { ein: boolean; aus: boolean; von_beat: number; bis_beat: number }; overdub: boolean
}
export const AUFNAHME_VORGABE: Readonly<ProjektAufnahme> = { vorzaehler_takte: 0, punch: { ein: false, aus: false, von_beat: 0, bis_beat: 4 }, overdub: false };
export const VORZAEHLER_WERTE = [0, 1, 2, 4] as const;
export const SPUR_FARBEN = ['#e0563b', '#3b8de0', '#9b59d0', '#3bb07a', '#e0a83b', '#d03b8d', '#3bc7d0', '#8a8f98'];

// --- Warp (Paket 1.13, ADR 031): eine Eigenschaft des Audio-Clips ---------------------------------------------------------------
// marker: [quell_s, beat], beide streng steigend; beat ist Clip-Beat (0 = die Stelle der Quelle, an der 1.1.1 liegt). versatz_beats:
// welcher Clip-Beat am Clip-Anfang spielt (ersetzt offset_s, solange an). Ist `an` falsch, bleibt der Warp erhalten, gilt aber nicht.
// Slice 2: complex und tones (Warp-Werk im Kern); Slice 4: beats (Einheiten im Callback des Kerns, warp.ts beatsEinheiten)
export const WARP_MODI = ['repitch', 'beats', 'complex', 'tones'] as const;
export type WarpModus = (typeof WARP_MODI)[number];
export const WARP_QUELLEN = ['werkstatt', 'traktor', 'mediathek', 'takte', 'hand'] as const;
export type WarpQuelle = (typeof WARP_QUELLEN)[number];
export const MAX_MARKER = 4096;                                // je Clip; der Kern prüft zusätzlich 262 144 in der ganzen Wiedergabe
// Halbtöne; Bungee rechnet 2 Oktaven (third_party/bungee/src/Timing.cpp:22, Plan Slice 5 D1); die Spec sagte 48. Nach unten nur −12 (D1, Andreas 2026-10-28):
// ab −13 st liegt der Anschlag im Arrangement über dem Lage-Gate (gemessen −13 st 26,9 Samples, −24 st 50,9, Gate 25). Der Kern nimmt weiter 0,25 bis 4.
export const TRANSPOSE_MIN = -12;
export const TRANSPOSE_MAX = 24;
export const DETUNE_MAX = 50;
export const GESAMT_CT_MIN = TRANSPOSE_MIN * 100;       // transpose_st · 100 + detune_ct liegt in [MIN, MAX]: pitch 0,5 bis 4
export const GESAMT_CT_MAX = TRANSPOSE_MAX * 100;
// Frequenzfaktor des Warps (Bungee Request.pitch): die einzige Rechnung, der Kern bekommt den Faktor und rechnet nicht aus Halbtönen
export const pitchFaktor = (st: number, ct: number): number => 2 ** (st / 12 + ct / 1200);
export const BEATS_RASTER = ['1/4', '1/8', '1/16', '1/32', 'transienten'] as const;
export const BEATS_LOOP = ['aus', 'vor', 'vor_zurueck'] as const;
export interface BeatsParameter { raster: (typeof BEATS_RASTER)[number]; loop: (typeof BEATS_LOOP)[number]; huelle: number }
// wie Live (Preserve Transients, Loop Forward, Envelope 100)
export const BEATS_VORGABE: Readonly<BeatsParameter> = { raster: 'transienten', loop: 'vor', huelle: 100 };
export interface Warp {
  an: boolean; modus: WarpModus; marker: [number, number][]; versatz_beats: number; quelle: WarpQuelle; eins_unsicher?: boolean;
  transpose_st: number; detune_ct: number;
  beats?: BeatsParameter;   // nur gelesen im Modus beats; bleibt beim Moduswechsel stehen (wie Live)
}

// S15: provenance of a Baukasten stream take (graph, the eight knob values, Strudel code), optional on audio clips of /2
// same rule as GRAPH_NAME in graphs.ts (kept apart: the model does not import node:fs); a test pins both
export const ENTSTEHUNG_GRAPH = /^[a-z0-9_-]{1,32}$/;
export const ENTSTEHUNG_CODE_MAX = 20000;
export type DekodiertZustand = 'nein' | 'laeuft' | 'fertig' | 'fehler';
export const DEKODIERT: readonly DekodiertZustand[] = ['nein', 'laeuft', 'fertig', 'fehler'];

// S15: provenance of a take recorded from a Baukasten stream: the graph on the stream, its eight knob values (0..1, as far as the page
// server knew them), the Strudel code and the project tempo. art leaves room for other origins (a native bk device on a track).
export interface Entstehung { art: 'strom'; strom: 2 | 3; graph: string; regler: number[]; code: string; bpm: number }

export interface Note { id: string; beat: number; laenge: number; ton: number; vel: number }
// loop_beats (Spec 6.17): null oder fehlend = kein Loop; sonst wiederholt sich [0, loop_beats) bis laenge_beats (1/16 ≤ loop_beats ≤ laenge_beats)
export interface AudioClip {
  id: string; art: 'audio'; name: string; start_beat: number; laenge_beats: number; loop_beats?: number | null;
  stumm?: boolean;   // Slice 6 (D12): true = der Übersetzer lässt den Clip weg (Live und Export); fehlt = hörbar
  quelle: { sha256: string; pfad_hinweis: string }; dekodiert: DekodiertZustand;
  offset_s: number; gain_db: number; fade_ein_beats: number; fade_aus_beats: number;
  warp?: Warp | null;                                          // Paket 1.13 (nur /2): fehlt oder null = ohne Warp (das Verhalten von /1)
  entstehung?: Entstehung;                                     // S15 (nur /2): where a stream take came from; absent in every older file, never null
  huellkurven?: Huellkurve[];                                  // 1.12 slice 5 (/2 only, D7): clip envelopes, absent when none (project/envelope.ts)
}
// naechste_noten_id am Clip: nur noch in Dateien des ersten S2int-Baus (Spec 6.28 Nachsatz zu 6.26); pruefeProjekt übernimmt ihn ins Projekt
export interface MidiClip {
  id: string; art: 'midi'; name: string; start_beat: number; laenge_beats: number; loop_beats?: number | null; naechste_noten_id?: number; noten: Note[];
  huellkurven?: Huellkurve[];                                  // 1.12 slice 5 (/2 only, D7): clip envelopes, absent when none
  muster?: MusterHerkunft;                                     // strudel-clip (/2 only): the Strudel pattern the notes were generated from; absent when none
}
// strudel-clip: where the notes of a generated clip came from. code is the pattern text; ohne_ziel the Strudel fields that
// have no target here (reported, not applied).
// Not playback (spurSicht lists only the fields it knows). clip_aus_muster with the clip_id alone generates the clip again from `code`.
export const MUSTER_CODE_MAX = 8192;
// abdruck: fingerprint of the notes and envelopes as the pattern made them (pattern_clip.ts musterAbdruck); a later difference means hand work
export interface MusterHerkunft { code: string; ohne_ziel?: string[]; abdruck?: string }
export function musterPruefung(x: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(x)) return ab('argument_ungueltig', 'muster: object expected');
  for (const k of Object.keys(x)) if (k !== 'code' && k !== 'ohne_ziel' && k !== 'abdruck') return ab('argument_unbekannt', `muster.${k}`);
  if (typeof x.code !== 'string' || x.code.trim().length < 1 || x.code.length > MUSTER_CODE_MAX) {
    return ab('argument_ungueltig', `muster.code: text of 1..${MUSTER_CODE_MAX} characters expected`);
  }
  if ('ohne_ziel' in x && (!Array.isArray(x.ohne_ziel) || x.ohne_ziel.length < 1 || x.ohne_ziel.length > 64
    || !x.ohne_ziel.every((f) => typeof f === 'string' && f.length >= 1 && f.length <= 64))) {
    return ab('argument_ungueltig', 'muster.ohne_ziel: a non-empty list of field names expected (absent when none)');
  }
  if ('abdruck' in x && (typeof x.abdruck !== 'string' || !/^[0-9a-f]{16,64}$/.test(x.abdruck))) {
    return ab('argument_ungueltig', 'muster.abdruck: 16 to 64 hex characters expected');
  }
  return null;
}
export type Clip = AudioClip | MidiClip;
// 1.14 comping: a take is a named lane of audio clips below its track; it is never played itself (the comp copies clips into the track).
// art 'original' marks the lane that holds the clips the track had before the first take (the only value). Id t<n>, project wide.
export interface Take { id: string; name: string; art?: 'original'; clips: AudioClip[] }
// preset (1.16 rest, F8): the register id of the preset last applied (presets/preset_id.ts); not playback (spurSicht strips it), absent in older files
export interface InternGeraet { art: 'intern'; name: 'rb338'; parameter: Record<string, number>; preset?: string }
// Baukasten S20: an instrument graph of the kern's graph folder as the device; parameter holds the knobs k1..k64 that were set (absent = 0.5)
export interface BkGeraet { art: 'intern'; name: 'bk'; graph: string; parameter: Record<string, number>; preset?: string }
// 1.9 (L25): a core kit (ADR 024) as the device of an instrument track. One-shot, no device parameter: the kit is the whole device.
export interface KitGeraet { art: 'intern'; name: 'kit'; kit: string }
// 1.9 U5 (O28 on Surge, spec E7): `parameter` is a SPARSE map of Surge display values (names and ranges of hosts/carla/surge_bereiche.json); the server
// mirrors it into the host of the slot. Absent = the host keeps the sound it was loaded with; the key is never written when there is no entry.
// `patch` (optional): the library name of the Surge patch the track plays ("Pads/Warm Pad" of the factory folder, or an own sound),
// as `klang liste` prints it. The server resolves it to a file and loads it into the host of the slot (areas/proj/surge_patches.ts, the mirror
// in surge.ts). Absent = the host keeps what it plays.
// plan 1.11 task 17: name 'plugin' is a foreign instrument plugin in the host of the slot (djk-instrumente start arrN plugin:<format>:<pfad>#<uid>).
// `plugin` is its identity, `zustand` the state file relative to the project folder (plugins/<track id>.carxs, fixed at creation). Such a device holds no
// `parameter` and no `patch`: the plugin keeps its parameters in itself and in the state file, never in the project.
export interface WirtGeraet {
  art: 'wirt'; name: 'surge' | 'plugin'; slot: number; parameter?: Record<string, number>; patch?: string; plugin?: HostPlugin; zustand?: string;
}
// a library name: 1..128 characters, no control characters or backslash, no empty, '.' or '..' segment, no leading slash
export const istPatchName = (n: unknown): n is string => typeof n === 'string' && n.length >= 1 && n.length <= 128
  && !/[\\\u0000-\u001f]/.test(n) && n.split('/').every((x) => x !== '' && x !== '.' && x !== '..');
export const SURGE_NAME = /^[a-z][a-z0-9_]{0,47}$/;
export const SURGE_PARAMETER_MAX = 32;
// 1.9 U7 (spec E9, E10): an instrument rack, up to MAX_GLIEDER members (each a device with a key, velocity and chain zone and a gain) on one track.
// Not to be confused with MAX_RACK / the strand field `rack` (the S4c effect rack). A member holds no rack; `kette` is the rack's own chain value.
// A zone is an inclusive pair [lo, hi]; absent = the whole range. gain_db absent = 0.
export type GliedGeraet = InternGeraet | BkGeraet | KitGeraet | WirtGeraet;
export interface Glied { id: string; geraet: GliedGeraet; ton?: [number, number]; vel?: [number, number]; kette?: [number, number]; gain_db?: number }
export interface RackGeraet { art: 'rack'; glieder: Glied[]; kette: number }
export type Geraet = InternGeraet | BkGeraet | KitGeraet | WirtGeraet | RackGeraet;
export const istRack = (s: { geraet?: Geraet }): s is { geraet: RackGeraet } => s.geraet?.art === 'rack';
export const glieder = (s: { geraet?: Geraet }): Glied[] => (s.geraet?.art === 'rack' ? s.geraet.glieder : []);
// 1.9 U8 T7: the macro parameters of a member by device, with the parameter index the translator writes (the core's index space:
// 0..3 = RB-338 in the order of the geraet.* rows of AUTO_ZIELE = ARR_GERAET_PARAM_NAME, 8..15 = bk k1..k8, 16 = gain_db,
// 17..40 = bk k9..k32, 41..72 = bk k33..k64, the same space as the kern)
// and the range of von/bis. A Surge member takes none; a kit only gain_db.
export const GLIED_PARAM_BK0 = 8;
export const GLIED_PARAM_GAIN_DB = 16;
export const GLIED_PARAM_BK9 = 17;   // k9..k32 = 17..40 (gain_db sits at 16 and keeps its index)
export const GLIED_PARAM_BK33 = 41;  // k33..k64 = 41..72
export const GLIED_RB_MAKRO_PARAMETER: readonly string[] = RB_ZIELE.map((z) => z.slice(GERAET_PRAEFIX.length));
export function gliedMakroParam(g: GliedGeraet, name: string): { index: number; min: number; max: number } | undefined {
  if (g.art === 'wirt') return undefined;
  if (name === 'gain_db') return { index: GLIED_PARAM_GAIN_DB, min: -60, max: 12 };
  if (g.name === 'rb338') { const i = GLIED_RB_MAKRO_PARAMETER.indexOf(name); return i < 0 ? undefined : { index: i, min: 0, max: 1 }; }
  if (g.name === 'bk') {
    const i = BK_PARAMETER.indexOf(name);
    return i < 0 ? undefined : { index: i < 8 ? GLIED_PARAM_BK0 + i : i < 32 ? GLIED_PARAM_BK9 + (i - 8) : GLIED_PARAM_BK33 + (i - 32), min: 0, max: 1 };
  }
  return undefined;
}
// 1.9 U7 T4 (spec 4.4): the Surge production slots a track uses, its own or its members' (an instrument track only; a rack may hold two)
export const wirtSlots = (s: { art?: string; geraet?: Geraet }): number[] => {
  if (s.art !== undefined && s.art !== 'instrument') return [];
  const g = s.geraet;
  if (g?.art === 'wirt') return [g.slot];
  return g?.art === 'rack' ? g.glieder.flatMap((m) => (m.geraet.art === 'wirt' ? [m.geraet.slot] : [])) : [];
};
// kennung: ganze Zahl (Spec 3.1 und 6.2, wie /k/arr/freeze). sha256: Inhalts-Hash der Datei, beim Einfrieren berechnet (6.2); der Übersetzer liest
// die Datei dafür nicht neu. von_beat: Ankerpunkt der Freeze-Datei im Projekt (Ergänzung zur Spec); fehlt das Feld, gilt 0.
export interface Freeze { datei: string; frames: number; kennung: number; sha256: string; von_beat?: number }
// von (Spec 6.22): wer die Spur angelegt hat, gesetzt bei spur_neu aus der Quelle, in D1 unveränderlich; fehlt es (älteres Projekt), gilt andreas
export type Herkunft = 'andreas' | 'cypher';
export const herkunft = (s: { von?: Herkunft }): Herkunft => s.von ?? 'andreas';
// gruppe (Paket 1.18, E-c): optional; Spuren mit demselben Text sind Varianten (Befehl variante_waehlen), der Text hat 1 bis GRUPPE_MAX Zeichen
// 1.10 Slice 1: Ziel einer Spur. Fehlt das Feld, gilt master (es wird nie gespeichert); sonst die Gruppen-Spur mit dieser ID.
export interface AusgangGruppe { art: 'gruppe'; id: string }
// 1.10 slice 3: a send is an entry of a track or group, id = the return it feeds. Absent = off; db > -200 (-200 removes the entry), -200..+6 dB like a fader.
export interface Send { id: string; db: number }
export interface Gruppe {
  id: string; nr: number; name: string; farbe: string; fader_db: number; pan: number; mute: boolean; solo: boolean; gefaltet: boolean;
  sends?: Send[]; inserts?: Insert[]; rack?: Rack; automation?: Lane[];
}
// Hall of a return: all values normalised 0..1 (the mapping to units lives in the core and in the page); defaults = the stellwerk defaults
export interface ReturnHall { an: boolean; pre: number; decay: number; groesse: number; tief: number; highcut: number; fahne: number }
export const HALL_VORGABE: Readonly<ReturnHall> = { an: true, pre: 0.04, decay: 0.5252, groesse: 0.282, tief: 0.5658, highcut: 0.8039, fahne: 0.66667 };
export const HALL_FELDER = ['pre', 'decay', 'groesse', 'tief', 'highcut', 'fahne'] as const;
// 1.10 slice 4: one stage of the insert chain. `slot` = the pooled instance (ins/<art>/<slot>/*), unique per kind in the whole project and chosen by the
// project (lowest free). `werte` holds every parameter of the kind except the stage switch `an` and `sc` (real units, plugin ranges; the EQ band parameters are
// 'b1/freq' ... 'b8/platz', the band switch is 'b<m>/an'); `sc` (komp only): 0 or absent = own signal, n = input of track number n.
// `bk` (arr-bk slice 3): a Baukasten effect graph as a stage; `graph` is its file name in the graph folder (an effect graph, one with an
// `eingang` node), `werte` the knobs k1..k64 (0..1).
export type InsertSorte = 'komp' | 'eq' | 'saett' | 'lim' | 'utility' | 'bk' | 'host';
// 1.10 slice 5 (plan E8): the sidechain key of a `komp` stage has two writers. A track `pre` key stays the field `sc` (4a, row `ins/komp/<slot>/sc`, a
// control).
// Every other source is structure: `key` {quelle, nr, punkt} (playback `chain[j].key`). A stage carries at most one of the two; `key` is never {spur, pre}.
// deck/erz keys have the point 'post' (a DJ input has no pre and post; the point is stored for one shape).
export type SchluesselQuelle = 'spur' | 'grp' | 'ret' | 'deck' | 'erz';
export interface InsertSchluessel { quelle: SchluesselQuelle; nr: number; punkt: 'pre' | 'post' }
export const SCHLUESSEL_QUELLEN: readonly SchluesselQuelle[] = ['spur', 'grp', 'ret', 'deck', 'erz'];
// Plan 1.11 task 7: a foreign effect plugin in its own host process. `slot` is the host number h (pool ins/host/<h>, 1..MAX_HOST), `werte` stays empty (the
// plugin parameters live in the plugin and its state file, never in the project), `zustand` is the state file relative to the project folder, fixed at
// creation (`plugins/<id>.carxs`), `latenz_extra` (0..MAX_LATENZ_EXTRA samples, absent = 0) is the user's addition to the measured latency.
export interface HostPlugin { format: 'vst3' | 'lv2'; pfad: string; uid: string; name: string }
export const MAX_HOST = INSERT_ARTEN.host.instanzen;
export const MAX_LATENZ_EXTRA = 4096;
export interface Insert {
  id: string; art: InsertSorte; slot: number; an: boolean; werte: Record<string, number>; sc?: number; key?: InsertSchluessel; graph?: string; preset?: string;
  plugin?: HostPlugin; zustand?: string; latenz_extra?: number;
}
export const INSERT_ARTEN_AKTIV: readonly InsertSorte[] = ['komp', 'eq', 'saett', 'lim', 'utility', 'bk'];
export const MAX_INS: Readonly<Record<string, number>> = {
  komp: MAX_INS_KOMP, eq: MAX_INS_EQ, saett: MAX_INS_SAETT, lim: MAX_INS_LIM, utility: MAX_INS_UTIL, bk: MAX_INS_BK, host: MAX_HOST,
};
export type InsertPoolArt = 'komp' | 'eq' | 'saett' | 'lim' | 'utility' | 'bk' | 'host';
const insertParameter = (art: InsertPoolArt) => INSERT_ARTEN[art].parameter;
/** the contract parameters of a kind that `Insert.werte` holds: all except the stage switch `an` (and the key `sc`, which has its own field) */
export const insertWertParameter = (art: InsertPoolArt) => insertParameter(art).filter((q) => q.name !== 'an' && q.name !== 'sc');
/** the names of `Insert.werte` of a kind */
export const insertWertNamen = (art: InsertPoolArt): readonly string[] => insertWertParameter(art).map((q) => q.name);
/** the names of `Insert.werte` of the compressor (4a name, kept) */
export const INSERT_WERT_NAMEN: readonly string[] = insertWertNamen('komp');
/** the defaults of `Insert.werte` of a kind (a fresh object each call) */
export const insertVorgabe = (art: InsertPoolArt = 'komp'): Record<string, number> =>
  Object.fromEntries(insertWertParameter(art).map((q) => [q.name, q.vorgabe]));
// 1.10 slice 4c (spec D13): the rack of a strip = four macro knobs and their mapping table. `slot` = the pooled rack (rack/<slot>/m1..m4), unique in the whole
// project and chosen by the project (lowest free). `makros[i].ziel` lists the parameters macro i+1 drives: the stage `insert` (an ID of the
// SAME strip's chain),
// the parameter name `param` as in `Insert.werte` (a continuous one), and the values `von` (macro at 0) and `bis` (macro at 1) in the real
// unit of the parameter
// (`von` may be above `bis`: an inverted knob). While a parameter is mapped its own row is ignored; the project refuses to set it (`param_gemappt`).
// `werte` are the live macro values 0..1 (a control: it travels as rack/<slot>/m<n>, not as playback structure); `namen` are the page's labels ('' = default).
// 1.9 U8 T7 (spec E12): a second target kind, a parameter of a MEMBER of the instrument rack of the same track (`glied` = a member id g1..g4). Only on a rack
// track strip. Member params: RB-338 lautstaerke, cutoff, resonanz, env_mod and bk k1..k64 (von/bis 0..1), gain_db of any internal member (-60..+12 dB).
export interface InsertZiel { insert: string; param: string; von: number; bis: number }
export interface GliedZiel { glied: string; param: string; von: number; bis: number }
export type RackZiel = InsertZiel | GliedZiel
export const istGliedZiel = (z: RackZiel): z is GliedZiel => 'glied' in z;
export const istInsertZiel = (z: RackZiel): z is InsertZiel => 'insert' in z;
// 1.9 T10 (E13): `variationen` = named snapshots of the 4 live macro values (max MAX_VARIATIONEN, name 1..VARIATION_NAME_MAX); never written when empty
export const MAX_VARIATIONEN = 8;
export const VARIATION_NAME_MAX = 32;
export interface Rack {
  slot: number; namen: string[]; makros: { ziel: RackZiel[] }[]; werte: number[]; variationen?: { name: string; werte: number[] }[];
}
/** a parameter a macro can drive: continuous (not a switch or a step list) and not the stage switch */
export const makroFaehig = (art: InsertPoolArt, name: string): boolean => {
  const q = INSERT_ARTEN[art].parameter.find((x) => x.name === name);
  return !!q && q.name !== 'an' && q.kurve === 'linear';
};
/** the index of a parameter in the parameter list of its kind (= the parameter index the core uses; the stage switch is 0) */
export const insertParamIndex = (art: InsertPoolArt, name: string): number => INSERT_ARTEN[art].parameter.findIndex((x) => x.name === name);
export interface Return {
  id: string; nr: number; name: string; farbe: string; fader_db: number; pan: number; mute: boolean; solo: boolean; hall: ReturnHall;
  pre?: true; inserts?: Insert[]; rack?: Rack; automation?: Lane[];
}
export interface Master { fader_db: number; inserts?: Insert[]; rack?: Rack; automation?: Lane[] }
export interface Spur {
  id: string; von?: Herkunft; gruppe?: string; nr: number; name: string; farbe: string; art: 'audio' | 'instrument';
  geraet?: Geraet; freeze?: Freeze | null; aufnahme?: SpurAufnahme; ausgang?: AusgangGruppe; automation?: Lane[]; takes?: Take[];
  fader_db: number; pan: number; mute: boolean; solo: boolean; clips: Clip[]; sends?: Send[]; inserts?: Insert[]; rack?: Rack;
}
// naechste_id (Spec 6.26): Zähler je Art (spur, clip, gruppe); naechste_noten_id (Spec 6.28 Nachsatz zu 6.26): EIN Noten-Zähler für alle Clips.
// Alle steigen nur und stehen in keinem Patch, Undo und Redo setzen sie nicht zurück.
export interface Projekt {
  format: typeof FORMAT; name: string; rev: number; wiedergabe_rev: number; tempo_bpm: number; taktart: [number, number];
  naechste_id?: { spur?: number; clip?: number; gruppe?: number; lane?: number; return?: number; insert?: number; take?: number }; naechste_noten_id?: number;
  loop: { an: boolean; von_beat: number; bis_beat: number };
  metronom: { an: boolean; pegel_db: number; ziel: 'master' | 'cue' };
  aufnahme?: ProjektAufnahme;   // 1.8 S0 (D17): only in /2, written after the first aufnahme_setzen
  spuren: Spur[];
  gruppen: Gruppe[]; master: Master;   // 1.10 (P3): ab /2 Pflicht
  // 1.10 slice 3: only in /2 and only with at least one return (absent otherwise: projects without returns stay byte-identical)
  returns?: Return[];
  baukasten?: BkKanal[];   // S17: sound snapshot (project/modular.ts), only in /2, absent when empty
}

export const aufnahmeVon = (p: Projekt): ProjektAufnahme => p.aufnahme ?? structuredClone(AUFNAHME_VORGABE);

const TAKE_ID = /^t[0-9]{1,15}$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;          // kein „/": Wiedergabe-Noten heißen <clip>/<note>
const FARBE = /^#[0-9a-fA-F]{6}$/;
const SHA = /^[0-9a-f]{64}$/;
// Parameter des RB-338 (Spec 2.4 und 6.4, aus rb_dsp::parameter::IDS). Alles andere lehnen Befehle als argument_unbekannt ab.
export const RB_PARAMETER: readonly string[] = ['lautstaerke', 'wellenform', 'cutoff', 'resonanz', 'env_mod', 'decay', 'accent'];
// Baukasten S20: a graph as the device of an instrument track. Knobs k1..k64 (0..1; absent = the graph's `vorgabe`). The graph name rule equals
// GRAPH_NAME in graphs.ts and kit_name_ok in the kern (pinned by tests/project_bk_device.test.mjs). MAX_BK_SPUREN equals ARR_BK_MAX in
// kern/include/cypherdj/arr_wiedergabe.h.
export const BK_PARAMETER: readonly string[] = Array.from({ length: 64 }, (_, i) => `k${i + 1}`);
export const BK_KNOPF_VORGABE = 0.5;   // an untouched knob (the core plays 0.5 for a knob the playback does not name)
export const BK_GRAPH_NAME = /^[a-z0-9_-]{1,32}$/;
export const MAX_BK_SPUREN = 8;
// 1.9 (L25): the kit folder name rule = BK_GRAPH_NAME = kit_name_ok in the kern; at most 8 kit devices (spec E15, the kern's ARR_KIT_MAX)
export const KIT_NAME = /^[a-z0-9_-]{1,32}$/;
export const MAX_KIT_GERAETE = 8;
// 1.9 U7 (E10, E15): equal to ARR_RACK_MAX, ARR_RACK_GLIEDER and ARR_GLIED_PLAETZE of core/include/cypherdj/arr_playback.h (pinned by a test)
export const MAX_RACK_GERAETE = 8;
export const MAX_GLIEDER = 4;
export const MAX_GLIED_PLAETZE = 32;
export const GLIED_ID = /^g[1-4]$/;
export const GLIED_GAIN_MIN = -60;
export const GLIED_GAIN_MAX = 12;
// Normalised (0..1) defaults of the four lane parameters, the start values of auto_neu when the track has no value of its own. Inverse of
// rb_dsp/src/parameter.rs Def::wert (:47-52, Schief: norm^(1/faktor)·(max−min)+min) for the defaults of defs() (:72, entries :74-87):
// cutoff 800 Hz on Schief 40..5000 with faktor 2^-2, lautstaerke −12 dB on Schief 10^(−48/20)..1 with faktor schief_pegel(−48, 0)
// (:63-69; db_zu_faktor :58, schief :61); resonanz and env_mod are Linear 0..1, so their defaults 0.3 and 0.4 are already normalised.
const dbFaktor = (db: number): number => 10 ** (db / 20);
const pegelSchief = Math.log(0.5) / Math.log((dbFaktor(-24) - dbFaktor(-48)) / (1 - dbFaktor(-48)));
export const RB_VORGABE_NORM: Readonly<Record<'lautstaerke' | 'cutoff' | 'resonanz' | 'env_mod', number>> = {
  lautstaerke: ((dbFaktor(-12) - dbFaktor(-48)) / (1 - dbFaktor(-48))) ** pegelSchief,
  cutoff: ((800 - 40) / (5000 - 40)) ** 0.25,
  resonanz: 0.3,
  env_mod: 0.4,
};
export const KENNUNG_MAX = 2 ** 31 - 1;                 // /k/arr/freeze trägt die Kennung als int32
export const LOOP_MIN = 1 / 16;                         // Spec 6.17: kürzester Clip-Loop

export const istObjekt = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const zahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ganz = (x: unknown): x is number => Number.isInteger(x);

// Zahlen wie JSON.stringify (-0 → 0, 1.0 → 1) und Schlüssel tief sortiert (Spec A8). Array-Reihenfolge bleibt.
export function sortiert<T>(x: T): T {
  if (Array.isArray(x)) return x.map(sortiert) as unknown as T;
  if (x !== null && typeof x === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x as object).sort()) o[k] = sortiert((x as Record<string, unknown>)[k]);
    return o as T;
  }
  return (typeof x === 'number' && Object.is(x, -0) ? 0 : x) as T;
}
export const kanonisch = (x: unknown): string => JSON.stringify(sortiert(x));

export function neuesProjekt(name: string): Projekt {
  return {
    format: FORMAT, name, rev: 0, wiedergabe_rev: 0, tempo_bpm: 120, taktart: [4, 4],
    loop: { an: false, von_beat: 0, bis_beat: 32 },
    metronom: { an: false, pegel_db: -12, ziel: 'master' },
    spuren: [], naechste_id: { spur: 1, clip: 1, gruppe: 1 }, naechste_noten_id: 1,    // Spec 6.26, 6.35: ein neues Projekt führt seine Zähler von Anfang an
    gruppen: [], master: { fader_db: 0 },                                              // 1.10 (F3): ein neues Projekt hat keine Gruppen, der PM steht bei 0 dB
  };
}

// --- IDs ------------------------------------------------------------------------------------------------------------
const ZIFFERN = /^\d+$/;
// ids of all clips of the project, main clips and take clips
const alleClipIds = (p: Projekt): string[] => p.spuren.flatMap((s) => [...s.clips, ...(s.takes ?? []).flatMap((t) => t.clips)].map((c) => c.id));
export function hoechste(ids: Iterable<string>, praefix: string): number {
  let m = 0;
  for (const id of ids) if (id.length > 1 && id[0] === praefix && ZIFFERN.test(id.slice(1))) m = Math.max(m, Number(id.slice(1)));
  return m;
}
// Spur-IDs s<n>, Clip-IDs c<n> projektweit, Noten-IDs n<n> aus einem Zähler für alle Clips (eindeutig sind sie je Clip). Eine ID wird nie
// wiederverwendet (Spec 6.26): Löschen ist eine Vorwärts-Änderung, und ein spätes Ereignis (Dekodieren, Kern-Quittung) darf nie das falsche Objekt
// treffen. Das Projekt führt dazu den Zähler naechste_id je Art und naechste_noten_id; sie steigen nur und stehen in keinem Patch (patch.ts),
// Undo und Redo lassen sie also stehen. Der Noten-Zähler liegt im Projekt, nicht im Clip (Spec 6.28): ein Clip ist Teil der Undo-Patches, ein
// Redo brachte seinen Zählerstand von damals mit. Fehlt ein Zähler (älteres Projekt), gilt das Maximum der vorhandenen IDs plus 1, beim
// Noten-Zähler auch ein alter Clip-Zähler. Die Funktionen ändern den Zähler an `p` selbst: sie gehören auf den Entwurf eines Befehls.
// Lane-IDs a<n> (Automation Slice 1): der Zähler naechste_id.lane entsteht erst mit der ersten Lane (wie naechste_noten_id), damit Projekte ohne Lane
// Byte für Byte gleich bleiben und ein älterer Stand sie weiter liest; setzeFehlendeZaehler fasst ihn nicht an.
// Return-IDs r<n> (slice 3): like the lane counter, naechste_id.return arises with the first return. Insert IDs i<n> (slice 4): the same, with the first stage.
// Take ids t<n> (1.14): like the lane counter, naechste_id.take arises with the first use. Clip ids are project wide over main AND take clips.
export function neueId(p: Projekt, art: 'spur' | 'clip' | 'gruppe' | 'lane' | 'return' | 'insert' | 'take'): string {
  const praefix = art === 'spur' ? 's' : art === 'clip' ? 'c' : art === 'lane' ? 'a' : art === 'return' ? 'r'
    : art === 'insert' ? 'i' : art === 'take' ? 't' : 'g';
  const ids = art === 'spur' ? p.spuren.map((s) => s.id)
    : art === 'clip' ? alleClipIds(p)
      : art === 'take' ? p.spuren.flatMap((s) => (s.takes ?? []).map((t) => t.id))
        : art === 'lane' ? alleStraenge(p).flatMap((x) => (x.strang.automation ?? []).map((l) => l.id))
          : art === 'return' ? (p.returns ?? []).map((r) => r.id)
            : art === 'insert' ? alleInserts(p).map((x) => x.insert.id) : (p.gruppen ?? []).map((g) => g.id);
  const lebend = hoechste(ids, praefix);
  const n = Math.max(p.naechste_id?.[art] ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, [art]: n + 1 };
  return `${praefix}${n}`;
}
// Stand des Noten-Zählers: der Projekt-Zähler, sonst das Maximum aller Noten-IDs und alter Clip-Zähler (Spec 6.28) plus 1
export function notenZaehler(p: Projekt): number {
  if (p.naechste_noten_id !== undefined) return p.naechste_noten_id;
  let m = 1;
  for (const s of p.spuren) {
    for (const c of s.clips) if (c.art === 'midi') m = Math.max(m, hoechste(c.noten.map((x) => x.id), 'n') + 1, c.naechste_noten_id ?? 1);
  }
  return m;
}
export function neueNotenId(p: Projekt): string {
  const n = notenZaehler(p);
  p.naechste_noten_id = n + 1;
  return `n${n}`;
}
// Nummer einer Noten-ID der Form n<ziffern>, sonst null (eine eigene ID wie „kick“ zählt nicht)
export const notenNummer = (id: string): number | null => (id.length > 1 && id[0] === 'n' && ZIFFERN.test(id.slice(1)) ? Number(id.slice(1)) : null);
// Spec 6.28: alte Clip-Zähler (erster S2int-Bau) ins Projekt übernehmen (Maximum) und am Clip entfernen. Ändert `p` selbst.
export function uebernimmNotenZaehler(p: Projekt): void {
  let alt = false;
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'midi' && c.naechste_noten_id !== undefined) alt = true;
  if (!alt) return;
  const projektweit = p.naechste_noten_id;
  delete p.naechste_noten_id;
  p.naechste_noten_id = Math.max(projektweit ?? 1, notenZaehler(p));
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'midi') delete c.naechste_noten_id;
}

// Spec 6.35 (zu 6.26): fehlen einem älteren Projekt die Zähler, setzt sie schon das Öffnen auf das Maximum der vorhandenen IDs plus 1, nicht
// erst das erste Anlegen (neueId rechnet sonst mit den lebenden IDs, und eine vorher gelöschte höchste ID käme wieder). Ein vorhandener Zähler
// bleibt, wie er ist (er steigt nur). Ändert `p` selbst.
export function setzeFehlendeZaehler(p: Projekt): void {
  const z = p.naechste_id;
  p.naechste_id = {
    spur: z?.spur ?? hoechste(p.spuren.map((s) => s.id), 's') + 1,
    clip: z?.clip ?? hoechste(alleClipIds(p), 'c') + 1,
    gruppe: z?.gruppe ?? hoechste((p.gruppen ?? []).map((g) => g.id), 'g') + 1,
    ...(z?.lane !== undefined ? { lane: z.lane } : {}),     // nur ein vorhandener Lane-Zähler bleibt, angelegt wird er hier nie
    ...(z?.return !== undefined ? { return: z.return } : {}),   // slice 3: same for the return counter
    ...(z?.insert !== undefined ? { insert: z.insert } : {}),   // slice 4: and for the insert counter
    ...(z?.take !== undefined ? { take: z.take } : {}),         // 1.14: same for the take counter
  };
  if (p.naechste_noten_id === undefined) p.naechste_noten_id = notenZaehler(p);
}

export function sucheSpur(p: Projekt, id: string): Spur | undefined { return p.spuren.find((s) => s.id === id); }
export function sucheGruppe(p: Projekt, id: string): Gruppe | undefined { return (p.gruppen ?? []).find((g) => g.id === id); }
// slice 4: every stage of the project with the strip that carries it. `strang` is the owner object, `id` its ID ('master' for the master).
export type InsertTraeger = Spur | Gruppe | Return | Master;
export function alleInserts(p: Projekt): { strang: InsertTraeger; strangId: string; insert: Insert }[] {
  const aus: { strang: InsertTraeger; strangId: string; insert: Insert }[] = [];
  const von = (st: InsertTraeger, id: string): void => { for (const insert of st.inserts ?? []) aus.push({ strang: st, strangId: id, insert }); };
  for (const s of p.spuren) von(s, s.id);
  for (const g of p.gruppen ?? []) von(g, g.id);
  for (const r of p.returns ?? []) von(r, r.id);
  if (p.master) von(p.master, 'master');
  return aus;
}
/** the pooled rows ins/<art>/<slot>/* of a stage with its values (komp 10, eq 59, saett 4, lim 3, utility 5): values first, the key (komp),
 * the switch `an` LAST
 *  (a stage never sounds half set) */
export function insertZeilen(i: Insert): Record<string, number> {
  const r: Record<string, number> = {};
  const art = i.art as InsertPoolArt;
  for (const k of insertWertNamen(art)) r[`ins/${i.art}/${i.slot}/${k}`] = i.werte[k];
  if (art === 'komp') r[`ins/${i.art}/${i.slot}/sc`] = i.sc ?? 0;
  r[`ins/${i.art}/${i.slot}/an`] = i.an ? 1 : 0;
  return r;
}
/** every rack of the project with the strip that carries it */
export function alleRacks(p: Projekt): { strang: InsertTraeger; strangId: string; rack: Rack }[] {
  return alleStraenge(p).filter((x) => x.strang.rack).map((x) => ({ strang: x.strang, strangId: x.strangId, rack: x.strang.rack! }));
}
export function alleStraenge(p: Projekt): { strang: InsertTraeger; strangId: string }[] {
  return [
    ...p.spuren.map((s) => ({ strang: s as InsertTraeger, strangId: s.id })),
    ...(p.gruppen ?? []).map((g) => ({ strang: g as InsertTraeger, strangId: g.id })),
    ...(p.returns ?? []).map((r) => ({ strang: r as InsertTraeger, strangId: r.id })),
    ...(p.master ? [{ strang: p.master as InsertTraeger, strangId: 'master' }] : []),
  ];
}
/** the pooled rows rack/<slot>/m1..m4 of a rack with its live macro values */
export function rackZeilen(r: Rack): Record<string, number> {
  const z: Record<string, number> = {};
  for (let i = 0; i < MAX_MAKROS; i++) z[`rack/${r.slot}/m${i + 1}`] = r.werte[i];
  return z;
}
/** the macro (1-based) and rack that drive a parameter of a stage, or undefined */
export function makroVon(strang: InsertTraeger, insertId: string, param: string): { nr: number; ziel: InsertZiel } | undefined {
  const rack = strang.rack;
  if (!rack) return undefined;
  for (let i = 0; i < rack.makros.length; i++) {
    const ziel = rack.makros[i].ziel.find((z) => istInsertZiel(z) && z.insert === insertId && z.param === param);
    if (ziel) return { nr: i + 1, ziel: ziel as InsertZiel };
  }
  return undefined;
}
/** the mapping table of a rack as the playback sees it: the stage by its position in the chain, the parameter by its index */
export type RackSichtZiel = { makro: number; stufe: number; param: number; von: number; bis: number }
  | { makro: number; glied: number; param: number; von: number; bis: number };   // 1.9 U8 T7: `glied` = position of the member in the rack device
export type RackSicht = { slot: number; ziele: RackSichtZiel[] };
export function rackSicht(strang: InsertTraeger): RackSicht | undefined {
  const rack = strang.rack, kette = strang.inserts ?? [];
  if (!rack) return undefined;
  const ziele: RackSichtZiel[] = [];
  const mitglieder = glieder(strang as Spur);
  rack.makros.forEach((m, i) => {
    for (const z of m.ziel) {
      if (istGliedZiel(z)) {
        const gi = mitglieder.findIndex((x) => x.id === z.glied), q = gi >= 0 ? gliedMakroParam(mitglieder[gi].geraet, z.param) : undefined;
        if (q) ziele.push({ makro: i, glied: gi, param: q.index, von: z.von, bis: z.bis });
        continue;
      }
      const stufe = kette.findIndex((x) => x.id === z.insert);
      if (stufe >= 0) ziele.push({ makro: i, stufe, param: insertParamIndex(kette[stufe].art as InsertPoolArt, z.param), von: z.von, bis: z.bis });
    }
  });
  return { slot: rack.slot, ziele };
}
/** the strip with this ID: a track, a group, a return or 'master' */
export function sucheStrang(p: Projekt, id: string): InsertTraeger | undefined {
  return id === 'master' ? p.master : sucheSpur(p, id) ?? sucheGruppe(p, id) ?? (p.returns ?? []).find((r) => r.id === id);
}
export function sucheClip(p: Projekt, id: string): { spur: Spur; clip: Clip } | undefined {
  for (const spur of p.spuren) { const clip = spur.clips.find((c) => c.id === id); if (clip) return { spur, clip }; }
  return undefined;
}

export function sucheTakeClip(p: Projekt, clipId: string): { spur: Spur; take: Take; clip: AudioClip } | null {
  for (const spur of p.spuren) {
    for (const take of spur.takes ?? []) { const clip = take.clips.find((c) => c.id === clipId); if (clip) return { spur, take, clip }; }
  }
  return null;
}
// 1.14: an empty takes list is never written (old files stay byte for byte). The load drops it;
// every command that can leave an empty list must call this on its draft. Changes `p` itself.
export function entferneLeereTakes(p: Projekt): void {
  for (const s of p.spuren) if (s.takes !== undefined && s.takes.length === 0) delete s.takes;
}

// --- Prüfung --------------------------------------------------------------------------------------------------------
type Ergebnis<T> = { wert: T } | { fehler: string };
class Fehl extends Error {}
const werfe = (wo: string, was: string): never => { throw new Fehl(`${wo}: ${was}`); };

function felder(o: unknown, wo: string, pflicht: string[], optional: string[] = []): Record<string, unknown> {
  if (!istObjekt(o)) return werfe(wo, 'Objekt erwartet');
  for (const k of pflicht) if (!(k in o)) werfe(`${wo}.${k}`, 'fehlt');
  for (const k of Object.keys(o)) if (!pflicht.includes(k) && !optional.includes(k)) werfe(`${wo}.${k}`, 'unbekanntes Feld');
  return o;
}
const zahlIn = (x: unknown, wo: string, min: number, max: number, istGanz = false): number => {
  if (!zahl(x) || x < min || x > max || (istGanz && !ganz(x))) werfe(wo, `${istGanz ? 'ganze ' : ''}Zahl ${min}..${max} erwartet`);
  return x as number;
};
const boolean = (x: unknown, wo: string): boolean => (typeof x === 'boolean' ? x : werfe(wo, 'true/false erwartet'));
const text = (x: unknown, wo: string, max: number): string => (
  typeof x === 'string' && x.length >= 1 && x.length <= max ? x : werfe(wo, `Text 1..${max} Zeichen erwartet`));

export function beatsPruefung(x: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(x)) return ab('argument_ungueltig', 'warp.beats: Objekt erwartet');
  for (const k of Object.keys(x)) if (!['raster', 'loop', 'huelle'].includes(k)) return ab('argument_unbekannt', `warp.beats.${k}`);
  if (!(BEATS_RASTER as readonly unknown[]).includes(x.raster)) return ab('argument_ungueltig', `warp.beats.raster: ${BEATS_RASTER.join(' | ')} erwartet`);
  if (!(BEATS_LOOP as readonly unknown[]).includes(x.loop)) return ab('argument_ungueltig', `warp.beats.loop: ${BEATS_LOOP.join(' | ')} erwartet`);
  if (!ganz(x.huelle) || x.huelle < 0 || x.huelle > 100) return ab('argument_ungueltig', 'warp.beats.huelle: ganze Zahl 0..100 erwartet');
  return null;
}

// S15: check of an entstehung object (model and commands share it): null = valid, else the reason (the command's reason) and a text.
export function entstehungPruefung(x: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(x)) return ab('argument_ungueltig', 'entstehung: object expected');
  const pflicht = ['art', 'strom', 'graph', 'regler', 'code', 'bpm'];
  for (const k of Object.keys(x)) if (!pflicht.includes(k)) return ab('argument_unbekannt', `entstehung.${k}`);
  for (const k of pflicht) if (!(k in x)) return ab('argument_ungueltig', `entstehung.${k}: missing`);
  if (x.art !== 'strom') return ab('argument_ungueltig', "entstehung.art: 'strom' expected");
  if (x.strom !== 2 && x.strom !== 3) return ab('argument_ungueltig', 'entstehung.strom: 2 or 3 expected');
  if (typeof x.graph !== 'string' || !ENTSTEHUNG_GRAPH.test(x.graph)) {
    return ab('argument_ungueltig', 'entstehung.graph: graph name expected (a-z 0-9 _ -, 1..32)');
  }
  if (!Array.isArray(x.regler) || x.regler.length < BK_REGLER_MIN || x.regler.length > BK_REGLER_ZAHL || !x.regler.every((v) => zahl(v) && v >= 0 && v <= 1)) {
    return ab('argument_ungueltig', `entstehung.regler: ${BK_REGLER_MIN}..${BK_REGLER_ZAHL} numbers 0..1 expected`);
  }
  if (typeof x.code !== 'string' || x.code.length < 1 || x.code.length > ENTSTEHUNG_CODE_MAX) {
    return ab('argument_ungueltig', `entstehung.code: text of 1..${ENTSTEHUNG_CODE_MAX} characters expected`);
  }
  if (!zahl(x.bpm) || x.bpm < TEMPO_MIN || x.bpm > TEMPO_MAX) return ab('argument_ungueltig', `entstehung.bpm: number ${TEMPO_MIN}..${TEMPO_MAX} expected`);
  return null;
}

// Prüfung eines Warp-Objekts (Modell und Befehle teilen sie): null = gültig, sonst Grund (der Befehls-Grund) und Text.
export function warpPruefung(w: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(w)) return ab('argument_ungueltig', 'warp: Objekt erwartet');
  const pflicht = ['an', 'modus', 'marker', 'versatz_beats', 'quelle', 'transpose_st', 'detune_ct'];
  for (const k of Object.keys(w)) if (!pflicht.includes(k) && k !== 'eins_unsicher' && k !== 'beats') return ab('argument_unbekannt', `warp.${k}`);
  for (const k of pflicht) if (!(k in w)) return ab('argument_ungueltig', `warp.${k}: fehlt`);
  if (typeof w.an !== 'boolean') return ab('argument_ungueltig', 'warp.an: true oder false erwartet');
  if ('eins_unsicher' in w && typeof w.eins_unsicher !== 'boolean') {
    return ab('argument_ungueltig', 'warp.eins_unsicher: true oder false erwartet');
  }
  if ('beats' in w) { const f = beatsPruefung(w.beats); if (f) return f; }
  if (!(WARP_MODI as readonly unknown[]).includes(w.modus)) return ab('warp_modus', `warp.modus: ${WARP_MODI.join(' | ')} erwartet`);
  if (!(WARP_QUELLEN as readonly unknown[]).includes(w.quelle)) {
    return ab('argument_ungueltig', `warp.quelle: ${WARP_QUELLEN.join(' | ')} erwartet`);
  }
  if (!zahl(w.versatz_beats) || Math.abs(w.versatz_beats) > MAX_BEAT) {
    return ab('argument_ungueltig', `warp.versatz_beats: Zahl von −${MAX_BEAT} bis ${MAX_BEAT} erwartet`);
  }
  if (!ganz(w.transpose_st) || w.transpose_st < TRANSPOSE_MIN || w.transpose_st > TRANSPOSE_MAX) {
    return ab('argument_ungueltig', `warp.transpose_st: ganze Zahl ${TRANSPOSE_MIN}..${TRANSPOSE_MAX} erwartet`);
  }
  if (!zahl(w.detune_ct) || Math.abs(w.detune_ct) > DETUNE_MAX) {
    return ab('argument_ungueltig', `warp.detune_ct: Zahl ${-DETUNE_MAX}..${DETUNE_MAX} erwartet`);
  }
  if ((w.modus === 'repitch' || w.modus === 'beats') && (w.transpose_st !== 0 || w.detune_ct !== 0)) {   // D6b: BEATS wie RE-PITCH
    return ab('transpose_repitch', 'RE-PITCH und BEATS folgen dem Tempo; Transpose und Detune gibt es dort nicht');
  }
  const gesamt = w.transpose_st * 100 + w.detune_ct;
  if (gesamt < GESAMT_CT_MIN || gesamt > GESAMT_CT_MAX) {
    return ab('argument_ungueltig', `warp: transpose_st · 100 + detune_ct ${GESAMT_CT_MIN}..${GESAMT_CT_MAX} Cent`);
  }
  const m = w.marker;
  if (!Array.isArray(m) || m.length < 2 || m.length > MAX_MARKER) return ab('warp_marker', `warp.marker: 2 bis ${MAX_MARKER} Marker erwartet`);
  for (let i = 0; i < m.length; i++) {
    const p = m[i];
    if (!Array.isArray(p) || p.length !== 2 || !zahl(p[0]) || !zahl(p[1])) return ab('warp_marker', `warp.marker[${i}]: [quell_s, beat] erwartet`);
    if (p[0] < 0 || p[0] > 1e7) return ab('warp_marker', `warp.marker[${i}]: quell_s 0..1e7 erwartet`);
    if (Math.abs(p[1]) > MAX_BEAT) return ab('warp_marker', `warp.marker[${i}]: beat von −${MAX_BEAT} bis ${MAX_BEAT} erwartet`);
    if (i > 0 && !(p[0] > m[i - 1][0] && p[1] > m[i - 1][1])) {
      return ab('warp_marker', `warp.marker[${i}]: quell_s und beat müssen streng steigen`);
    }
    // so sieht sie der Kern (Frames = quell_s · 48 000, Beat minus Versatz): zwei Doubles, die danach gleich sind, lehnt er mit format ab
    if (i > 0 && !(p[0] * SAMPLERATE > m[i - 1][0] * SAMPLERATE && p[1] - w.versatz_beats > m[i - 1][1] - w.versatz_beats)) {
      return ab('warp_marker', `warp.marker[${i}]: nach der Umrechnung (Frames, Beat minus Versatz) nicht mehr streng steigend`);
    }
  }
  for (let i = 0; i + 1 < m.length; i++) {
    const bpm = 60 * (m[i + 1][1] - m[i][1]) / (m[i + 1][0] - m[i][0]);
    if (!(bpm >= SEGMENT_BPM_MIN && bpm <= SEGMENT_BPM_MAX)) {
      return ab('warp_faktor', `warp.marker[${i}]: Segment-Tempo ${Math.round(bpm * 100) / 100} BPM, erlaubt ${SEGMENT_BPM_MIN}..${SEGMENT_BPM_MAX}`);
    }
  }
  return null;
}

// 1.12 slice 6: the target of a chain lane. `insert.<stage id>.<param>` (the parameter name has at most one `/`, as `b1/freq`) or `rack.m1` .. `rack.m4`.
const KETTEN_ZIEL = /^(?:insert\.([A-Za-z][A-Za-z0-9_-]{0,31})\.([a-z0-9_]{1,16}(?:\/[a-z0-9_]{1,16})?)|rack\.m([1-4]))$/;
export const istKettenZiel = (z: unknown): z is KettenZiel => typeof z === 'string' && KETTEN_ZIEL.test(z);
/** a chain target taken apart: the stage and parameter, or the macro number 1..4 */
export function zerlegeKettenZiel(z: string): { insert: string; param: string } | { makro: number } | null {
  const m = KETTEN_ZIEL.exec(z);
  if (!m) return null;
  return m[3] !== undefined ? { makro: Number(m[3]) } : { insert: m[1], param: m[2] };
}
/** the strip's own target of a chain lane: the stage must be in its chain and a continuous parameter of a built-in kind (not `an`, not `sc`, not a host
 *  stage), or the strip must have a rack (the macro value is 0..1). Null = the target does not exist on this strip. */
export function kettenZielBereich(strang: { inserts?: Insert[]; rack?: Rack }, ziel: string): ZielBereich | null {
  const z = zerlegeKettenZiel(ziel);
  if (!z) return null;
  if ('makro' in z) return strang.rack ? { min: 0, max: 1, nurSprung: false } : null;
  const st = (strang.inserts ?? []).find((x) => x.id === z.insert);
  if (!st || st.art === 'host' || z.param === 'sc') return null;
  const q = INSERT_ARTEN[st.art as InsertPoolArt].parameter.find((x) => x.name === z.param);
  return q && makroFaehig(st.art as InsertPoolArt, z.param) ? { min: q.min, max: q.max, nurSprung: false } : null;
}
/** the range of any lane target on a strip: a device target of the fixed table, or a chain target of this strip (null = does not exist) */
export function zielBereichVon(ziel: string, strang?: { inserts?: Insert[]; rack?: Rack }): ZielBereich | null {
  if (Object.hasOwn(ZIEL_BEREICH, ziel)) return ZIEL_BEREICH[ziel as Ziel];
  return strang ? kettenZielBereich(strang, ziel) : null;
}
const kettenLanen_ = (st: { automation?: Lane[] }): number => (st.automation ?? []).filter((l) => istKettenZiel(l.ziel)).length;
/** the lanes of a strip that drive its chain or rack */
export const kettenLanen = (strang: { automation?: Lane[] }): Lane[] => (strang.automation ?? []).filter((l) => istKettenZiel(l.ziel));
// Prüfung einer Lane (Modell und Befehle teilen sie): null = gültig, sonst Grund (der Befehls-Grund) und Text.
// `strang` (1.12 slice 6): the strip that carries the lane; a chain target needs it (the stage and its parameter are looked up there)
export function lanePruefung(l: unknown, strang?: { inserts?: Insert[]; rack?: Rack }): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(l)) return ab('argument_ungueltig', 'lane: Objekt erwartet');
  for (const k of Object.keys(l)) if (k !== 'id' && k !== 'ziel' && k !== 'punkte' && k !== 'gesperrt') return ab('argument_unbekannt', `lane.${k}`);
  for (const k of ['id', 'ziel', 'punkte']) if (!(k in l)) return ab('argument_ungueltig', `lane.${k}: fehlt`);
  if (typeof l.id !== 'string' || !ID.test(l.id)) return ab('argument_ungueltig', 'lane.id: ID erwartet');
  let bereich: ZielBereich | undefined;
  if (istKettenZiel(l.ziel)) {
    const b = strang ? kettenZielBereich(strang, l.ziel) : null;
    if (!b) return ab('ziel_unbekannt', `lane.ziel: ${l.ziel} is no stage parameter or macro of this strip`);
    bereich = b;
  } else if (!(AUTO_ZIELE as readonly unknown[]).includes(l.ziel)) {
    return ab('ziel_unbekannt', `lane.ziel: ${AUTO_ZIELE.join(' | ')} or insert.<id>.<param> or rack.m1..m4 expected`);
  }
  if ('gesperrt' in l && l.gesperrt !== true) return ab('argument_ungueltig', 'lane.gesperrt: true expected (an unlocked lane has no key)');
  return punktePruefung(l.punkte, l.ziel as string, bereich);
}
// E2: a point on a mute/solo lane without `form` is `sprung`; fader, pan and geraet.* points are left as they are
export function normalisiereLane(l: Lane): void {
  if (Object.hasOwn(ZIEL_BEREICH, l.ziel) && ZIEL_BEREICH[l.ziel as Ziel].nurSprung) for (const q of l.punkte) q.form ??= 'sprung';
}
// the one range rule of a lane value (used by the lane check below and by the take entry of the session): switches take 0 or 1 only
export const wertImBereich = (ziel: string, wert: unknown, bereich: ZielBereich = ZIEL_BEREICH[ziel as Ziel]): boolean => {
  const { min, max, nurSprung } = bereich;
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= min && wert <= max && (!nurSprung || wert === 0 || wert === 1);
};
export function punktePruefung(pk: unknown, ziel: string, bereich: ZielBereich = ZIEL_BEREICH[ziel as Ziel]): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!Array.isArray(pk) || pk.length < 1) return ab('punkte_ungueltig', 'punkte: mindestens ein Punkt erwartet (use auto_loeschen)');
  if (pk.length > MAX_LANE_PUNKTE) return ab('zu_gross', `punkte: höchstens ${MAX_LANE_PUNKTE} je Lane`);
  const { min, max, nurSprung } = bereich;
  let gleich = 0;
  for (let i = 0; i < pk.length; i++) {
    const x = pk[i];
    if (!istObjekt(x)) return ab('argument_ungueltig', `punkte[${i}]: Objekt erwartet`);
    for (const k of Object.keys(x)) if (k !== 'beat' && k !== 'wert' && k !== 'form') return ab('argument_unbekannt', `punkte[${i}].${k}`);
    if (!zahl(x.beat) || x.beat < 0 || x.beat > MAX_BEAT) return ab('argument_ungueltig', `punkte[${i}].beat: Zahl 0..${MAX_BEAT} erwartet`);
    if (!zahl(x.wert) || !wertImBereich(ziel, x.wert, bereich)) {
      return ab('argument_ungueltig', `punkte[${i}].wert: ${nurSprung ? '0 or 1' : `number ${min}..${max}`} expected`);
    }
    if ('form' in x && !(AUTO_FORMEN as readonly unknown[]).includes(x.form)) {
      return ab('argument_ungueltig', `punkte[${i}].form: ${AUTO_FORMEN.join(' | ')} erwartet`);
    }
    if (nurSprung && 'form' in x && x.form !== 'sprung') return ab('punkte_ungueltig', `punkte[${i}].form: ${ziel} points are always sprung`);
    if (i > 0) {
      const v = pk[i - 1] as Record<string, number>;
      if (x.beat < v.beat) return ab('punkte_ungueltig', `punkte[${i}].beat: aufsteigend erwartet`);
      gleich = x.beat === v.beat ? gleich + 1 : 0;
      if (gleich >= 2) return ab('punkte_ungueltig', `punkte[${i}].beat: höchstens zwei Punkte am gleichen Beat`);
    }
  }
  return null;
}

function pruefeNote(n: unknown, wo: string): Note {
  const o = felder(n, wo, ['id', 'beat', 'laenge', 'ton', 'vel']);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.beat, `${wo}.beat`, 0, MAX_BEAT);
  if (!zahl(o.laenge) || o.laenge <= 0 || o.laenge > MAX_BEAT) werfe(`${wo}.laenge`, 'Zahl > 0 erwartet');
  zahlIn(o.ton, `${wo}.ton`, 0, 127, true); zahlIn(o.vel, `${wo}.vel`, 1, 127, true);
  return o as unknown as Note;
}

// 1.16 rest (F8): a preset origin is a register id
const presetIdIn = (x: unknown, wo: string): void => {
  if (typeof x !== 'string' || !PRESET_ID.test(x)) werfe(wo, 'preset id <werk|nutzer>:<geraet>/<slug> expected');
};
// 1.9 U7: the zone pair [lo, hi] of a rack member, whole numbers lo <= hi inside min..max
function pruefeZone(x: unknown, wo: string, min: number, max: number): void {
  if (!Array.isArray(x) || x.length !== 2) werfe(wo, 'pair [lo, hi] expected');
  const [lo, hi] = x as unknown[];
  zahlIn(lo, `${wo}[0]`, min, max, true); zahlIn(hi, `${wo}[1]`, min, max, true);
  if ((lo as number) > (hi as number)) werfe(wo, `lo <= hi expected (${lo} > ${hi})`);
}
function pruefeRackGeraet(g: unknown, wo: string, neu2: boolean): RackGeraet {
  const r = felder(g, wo, ['art', 'glieder', 'kette']);
  if (!neu2) werfe(`${wo}.art`, `rack devices exist only from ${FORMAT} on`);
  zahlIn(r.kette, `${wo}.kette`, 0, 127, true);
  if (!Array.isArray(r.glieder) || r.glieder.length < 1 || r.glieder.length > MAX_GLIEDER) werfe(`${wo}.glieder`, `1..${MAX_GLIEDER} members expected`);
  const ids = new Set<string>();
  (r.glieder as unknown[]).forEach((gx, i) => {
    const w = `${wo}.glieder[${i}]`;
    const m = felder(gx, w, ['id', 'geraet'], ['ton', 'vel', 'kette', 'gain_db']);
    if (typeof m.id !== 'string' || !GLIED_ID.test(m.id)) werfe(`${w}.id`, 'member id g1..g4 expected');
    if (ids.has(m.id)) werfe(`${w}.id`, `duplicate (${m.id})`);
    ids.add(m.id);
    if (istObjekt(m.geraet) && m.geraet.art === 'rack') werfe(`${w}.geraet`, 'a rack does not nest');
    if (istObjekt(m.geraet) && m.geraet.art === 'wirt' && 'parameter' in m.geraet) {
      werfe(`${w}.geraet.parameter`, 'surge member parameters are not mirrored in 1.9');
    }
    if (istObjekt(m.geraet) && m.geraet.art === 'wirt' && m.geraet.name === 'plugin') werfe(`${w}.geraet`, 'a plugin instrument is no rack member');
    if (istObjekt(m.geraet) && m.geraet.art === 'wirt' && 'patch' in m.geraet) werfe(`${w}.geraet.patch`, 'a surge member does not take a patch in 1.9');
    pruefeGeraet(m.geraet, `${w}.geraet`, neu2);
    if ('ton' in m) pruefeZone(m.ton, `${w}.ton`, 0, 127);
    if ('vel' in m) pruefeZone(m.vel, `${w}.vel`, 1, 127);
    if ('kette' in m) pruefeZone(m.kette, `${w}.kette`, 0, 127);
    if ('gain_db' in m) zahlIn(m.gain_db, `${w}.gain_db`, GLIED_GAIN_MIN, GLIED_GAIN_MAX);
  });
  return r as unknown as RackGeraet;
}
// plan 1.11 task 17: the device of a plugin instrument track (format /2 only, like the other devices that came after /1)
function pruefePluginGeraet(g: Record<string, unknown>, wo: string, neu2: boolean): Geraet {
  if (!neu2) werfe(`${wo}.name`, `unbekanntes Feld (Plugin-Instrumente gibt es erst ab ${FORMAT})`);
  const o = felder(g, wo, ['art', 'name', 'slot', 'plugin', 'zustand']);
  zahlIn(o.slot, `${wo}.slot`, 1, WIRT_SLOTS, true);
  pruefeHostPlugin(o.plugin, `${wo}.plugin`);
  if (typeof o.zustand !== 'string' || !/^plugins\/s[0-9]+\.carxs$/.test(o.zustand)) werfe(`${wo}.zustand`, 'plugins/<track id>.carxs expected');
  return o as unknown as Geraet;
}
function pruefeGeraet(g: unknown, wo: string, neu2: boolean): Geraet {
  if (!istObjekt(g)) return werfe(wo, 'Objekt erwartet');
  if (g.art === 'rack') return pruefeRackGeraet(g, wo, neu2);
  if (g.art === 'intern') {
    if (g.name === 'kit') {                                                    // 1.9 (L25): /2 only, like takes and warp
      const k = felder(g, wo, ['art', 'name', 'kit']);
      if (!neu2) werfe(`${wo}.name`, `kit devices exist only from ${FORMAT} on`);
      if (typeof k.kit !== 'string' || !KIT_NAME.test(k.kit)) werfe(`${wo}.kit`, 'kit name expected ([a-z0-9_-], 1..32 characters)');
      return k as unknown as Geraet;
    }
    if (g.name === 'bk') {                                                     // Baukasten S20
      const b = felder(g, wo, ['art', 'name', 'graph', 'parameter'], ['preset']);
      if ('preset' in b) presetIdIn(b.preset, `${wo}.preset`);
      if (typeof b.graph !== 'string' || !BK_GRAPH_NAME.test(b.graph)) werfe(`${wo}.graph`, 'graph name expected ([a-z0-9_-], 1..32 characters)');
      if (!istObjekt(b.parameter)) werfe(`${wo}.parameter`, 'Objekt erwartet');
      for (const [k, v] of Object.entries(b.parameter as Record<string, unknown>)) {
        if (!BK_PARAMETER.includes(k)) werfe(`${wo}.parameter.${k}`, `unknown knob (allowed: ${BK_PARAMETER.join(', ')})`);
        zahlIn(v, `${wo}.parameter.${k}`, 0, 1);
      }
      return b as unknown as Geraet;
    }
    const o = felder(g, wo, ['art', 'name', 'parameter'], ['preset']);
    if (o.name !== 'rb338') werfe(`${wo}.name`, 'rb338, bk or kit expected');
    if ('preset' in o) presetIdIn(o.preset, `${wo}.preset`);
    if (!istObjekt(o.parameter)) werfe(`${wo}.parameter`, 'Objekt erwartet');
    for (const [k, v] of Object.entries(o.parameter as Record<string, unknown>)) {
      if (!RB_PARAMETER.includes(k)) werfe(`${wo}.parameter.${k}`, `unbekannter Parameter (erlaubt: ${RB_PARAMETER.join(', ')})`);
      zahlIn(v, `${wo}.parameter.${k}`, 0, 1);
    }
    return o as unknown as Geraet;
  }
  if (g.art === 'wirt') {
    if (istObjekt(g) && g.name === 'plugin') return pruefePluginGeraet(g, wo, neu2);
    const o = felder(g, wo, ['art', 'name', 'slot'], ['parameter', 'patch']);
    if (o.name !== 'surge') werfe(`${wo}.name`, 'surge erwartet');
    zahlIn(o.slot, `${wo}.slot`, 1, WIRT_SLOTS, true);
    if ('patch' in o) {                                                        // optional like parameter: the format stays /2, a /1 file never carries it
      if (!neu2) werfe(`${wo}.patch`, `unbekanntes Feld (Surge-Patch gibt es erst ab ${FORMAT})`);
      if (!istPatchName(o.patch)) werfe(`${wo}.patch`, 'library name of a Surge patch expected');
    }
    if ('parameter' in o) {                                                    // 1.9 U5: /2 only, like takes, warp and kit devices
      if (!neu2) werfe(`${wo}.parameter`, `unbekanntes Feld (Surge-Parameter gibt es erst ab ${FORMAT})`);
      if (!istObjekt(o.parameter) || Array.isArray(o.parameter)) werfe(`${wo}.parameter`, 'Objekt erwartet');
      const eintraege = Object.entries(o.parameter as Record<string, unknown>);
      if (eintraege.length > SURGE_PARAMETER_MAX) werfe(`${wo}.parameter`, `at most ${SURGE_PARAMETER_MAX} entries`);
      for (const [k, v] of eintraege) {
        if (!SURGE_NAME.test(k)) werfe(`${wo}.parameter.${k}`, 'Surge parameter name expected ([a-z][a-z0-9_], 1..48 characters)');
        if (!zahl(v)) werfe(`${wo}.parameter.${k}`, 'endliche Zahl erwartet');
      }
    }
    return o as unknown as Geraet;
  }
  return werfe(`${wo}.art`, 'intern, wirt or rack expected');
}

function pruefeFreeze(f: unknown, wo: string): void {
  const o = felder(f, wo, ['datei', 'frames', 'kennung', 'sha256'], ['von_beat']);
  if (typeof o.datei !== 'string' || !o.datei || o.datei.startsWith('/') || o.datei.split('/').includes('..')) {
    werfe(`${wo}.datei`, 'relativer Pfad im Arbeitsordner erwartet');
  }
  zahlIn(o.frames, `${wo}.frames`, 1, 2 ** 40, true);
  zahlIn(o.kennung, `${wo}.kennung`, 0, KENNUNG_MAX, true);
  if (typeof o.sha256 !== 'string' || !SHA.test(o.sha256)) werfe(`${wo}.sha256`, '64 Hex-Zeichen (klein) erwartet');
  if ('von_beat' in o) zahlIn(o.von_beat, `${wo}.von_beat`, 0, MAX_BEAT);
}

function pruefeLoop(o: Record<string, unknown>, wo: string): void {
  if (!('loop_beats' in o) || o.loop_beats === null) return;
  if (!zahl(o.loop_beats) || o.loop_beats < LOOP_MIN || o.loop_beats > (o.laenge_beats as number) + 1e-9) {
    werfe(`${wo}.loop_beats`, 'null oder Zahl von 1/16 bis laenge_beats erwartet');
  }
}

// 1.12 slice 5 (D7): clip envelopes, /2 only; spur (when known) for the RB-338 rule of geraet.* envelopes
function pruefeHuellkurven(o: Record<string, unknown>, wo: string, warpErlaubt: boolean, spur: { art: string; geraet?: unknown } | null): void {
  if (!('huellkurven' in o)) return;
  if (!warpErlaubt) werfe(`${wo}.huellkurven`, `unknown field (huellkurven exist only from ${FORMAT} on)`);
  const f = huellkurvenPruefung(o.huellkurven, o as { art: string; laenge_beats: number }, spur);
  if (f) werfe(`${wo}.huellkurven`, f.text);
}
function pruefeClip(c: unknown, wo: string, spurArt: string, warpErlaubt: boolean, spur: { art: string; geraet?: unknown } | null = null): Clip {
  if (!istObjekt(c)) return werfe(wo, 'Objekt erwartet');
  if (c.art !== (spurArt === 'audio' ? 'audio' : 'midi')) werfe(`${wo}.art`, `passt nicht zur ${spurArt}-Spur`);
  const basis = ['id', 'art', 'name', 'start_beat', 'laenge_beats'];
  if (c.art === 'audio') {
    const o = felder(c, wo, [...basis, 'quelle', 'dekodiert', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats'],
      ['loop_beats', 'warp', 'stumm', 'entstehung', 'huellkurven']);
    if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
    text(o.name, `${wo}.name`, 80);
    zahlIn(o.start_beat, `${wo}.start_beat`, 0, MAX_BEAT);
    if (!zahl(o.laenge_beats) || o.laenge_beats <= 0 || o.laenge_beats > MAX_BEAT) werfe(`${wo}.laenge_beats`, 'Zahl > 0 erwartet');
    const q = felder(o.quelle, `${wo}.quelle`, ['sha256', 'pfad_hinweis']);
    if (typeof q.sha256 !== 'string' || !SHA.test(q.sha256)) werfe(`${wo}.quelle.sha256`, '64 Hex-Zeichen (klein) erwartet');
    if (typeof q.pfad_hinweis !== 'string' || q.pfad_hinweis.length > 4096) werfe(`${wo}.quelle.pfad_hinweis`, 'Text erwartet');
    if (!DEKODIERT.includes(o.dekodiert as DekodiertZustand)) werfe(`${wo}.dekodiert`, `${DEKODIERT.join('|')} erwartet`);
    zahlIn(o.offset_s, `${wo}.offset_s`, 0, 1e7); zahlIn(o.gain_db, `${wo}.gain_db`, GAIN_MIN, GAIN_MAX);
    const ein = zahlIn(o.fade_ein_beats, `${wo}.fade_ein_beats`, 0, MAX_BEAT), aus = zahlIn(o.fade_aus_beats, `${wo}.fade_aus_beats`, 0, MAX_BEAT);
    if (ein + aus > (o.laenge_beats as number) + 1e-9) werfe(`${wo}.fade`, 'Ein- plus Ausblende länger als der Clip');
    pruefeLoop(o, wo);
    if (o.stumm !== undefined && typeof o.stumm !== 'boolean') werfe(`${wo}.stumm`, 'true oder false erwartet');
    if ('warp' in o) {                                          // in /1 ist jedes warp-Feld unbekannt, auch null (N4-6)
      if (!warpErlaubt) werfe(`${wo}.warp`, `unbekanntes Feld (Warp gibt es erst ab ${FORMAT})`);
      const f = o.warp === null ? null : warpPruefung(o.warp);
      if (f) werfe(`${wo}.warp`, f.text);
    }
    if ('entstehung' in o) {                                    // S15: like warp, /2 only
      if (!warpErlaubt) werfe(`${wo}.entstehung`, `unbekanntes Feld (entstehung gibt es erst ab ${FORMAT})`);
      const f = entstehungPruefung(o.entstehung);
      if (f) werfe(`${wo}.entstehung`, f.text);
    }
    pruefeHuellkurven(o, wo, warpErlaubt, spur);
    return o as unknown as Clip;
  }
  const o = felder(c, wo, [...basis, 'noten'], ['loop_beats', 'naechste_noten_id', 'huellkurven', 'muster']);
  if ('muster' in o) {                                          // strudel-clip: like huellkurven, /2 only
    if (!warpErlaubt) werfe(`${wo}.muster`, `unknown field (muster exists only from ${FORMAT} on)`);
    const f = musterPruefung(o.muster);
    if (f) werfe(`${wo}.muster`, f.text);
  }
  if ('naechste_noten_id' in o) zahlIn(o.naechste_noten_id, `${wo}.naechste_noten_id`, 1, Number.MAX_SAFE_INTEGER, true);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  text(o.name, `${wo}.name`, 80);
  zahlIn(o.start_beat, `${wo}.start_beat`, 0, MAX_BEAT);
  if (!zahl(o.laenge_beats) || o.laenge_beats <= 0 || o.laenge_beats > MAX_BEAT) werfe(`${wo}.laenge_beats`, 'Zahl > 0 erwartet');
  pruefeLoop(o, wo);
  if (!Array.isArray(o.noten)) werfe(`${wo}.noten`, 'Liste erwartet');
  const ids = new Set<string>();
  (o.noten as unknown[]).forEach((n, i) => {
    const note = pruefeNote(n, `${wo}.noten[${i}]`);
    if (ids.has(note.id)) werfe(`${wo}.noten[${i}].id`, `doppelt (${note.id})`);
    ids.add(note.id);
  });
  pruefeHuellkurven(o, wo, warpErlaubt, spur);
  return o as unknown as MidiClip;
}

// 1.10 slice 3: sends of a track or group (only /2): a non-empty list, one entry per return, db > -200 up to +6, the id syntax checked here and the
// reference to an existing return in pruefeAlles
function pruefeSends(x: unknown, wo: string, erlaubt: boolean): Send[] {
  if (!erlaubt) return werfe(wo, `unbekanntes Feld (Sends gibt es erst ab ${FORMAT})`);
  if (!Array.isArray(x) || x.length < 1) return werfe(wo, 'nicht leere Liste erwartet (fehlt bei keinem Send)');
  if (x.length > MAX_RETURNS) werfe(wo, `höchstens ${MAX_RETURNS} Sends`);
  const ids = new Set<string>();
  x.forEach((sx, i) => {
    const o = felder(sx, `${wo}[${i}]`, ['id', 'db']);
    if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}[${i}].id`, 'ID erwartet');
    if (ids.has(o.id as string)) werfe(`${wo}[${i}].id`, `doppelt (${o.id})`);
    ids.add(o.id as string);
    if (!zahl(o.db) || o.db <= FADER_MIN || o.db > FADER_MAX) {
      werfe(`${wo}[${i}].db`, `Zahl über ${FADER_MIN} bis ${FADER_MAX} erwartet (${FADER_MIN} entfernt den Eintrag)`);
    }
  });
  return x as Send[];
}

// 1.10 slice 5: the structural key of a stage, closed fields. Form only: the number ranges and the DJ list; the references are checked in pruefeAlles,
// the rules (zyklus, spaet, quelle)
// by the commands (project/routing_rules.ts).
function pruefeSchluessel(x: unknown, wo: string, art: InsertPoolArt, hatSc: boolean): void {
  if (art !== 'komp') werfe(wo, 'unknown field (only the compressor has a key)');
  if (hatSc) werfe(wo, 'sc and key exclude each other (a stage has one key at most)');
  const k = felder(x, wo, ['quelle', 'nr', 'punkt']);
  if (!(SCHLUESSEL_QUELLEN as readonly unknown[]).includes(k.quelle)) werfe(`${wo}.quelle`, `${SCHLUESSEL_QUELLEN.join(' | ')} expected`);
  if (k.punkt !== 'pre' && k.punkt !== 'post') werfe(`${wo}.punkt`, 'pre | post expected');
  const quelle = k.quelle as SchluesselQuelle;
  const max = quelle === 'spur' ? MAX_SPUREN : quelle === 'grp' ? MAX_GRUPPEN : quelle === 'ret' ? MAX_RETURNS : 0;
  if (max > 0) zahlIn(k.nr, `${wo}.nr`, 1, max, true);
  else {                                                  // DJ input: only what the generated rules list as 'ja', and its point is 'post'
    zahlIn(k.nr, `${wo}.nr`, 1, 99, true);
    const nr = k.nr as number;
    if (!SCHLUESSEL_DJ.some((e) => e.quelle === quelle && nr >= e.von && nr <= e.bis && e.antwort === 'ja')) werfe(wo, `${quelle}/${nr} cannot be a key`);
    if (k.punkt !== 'post') werfe(`${wo}.punkt`, 'a DJ input has the point post only');
  }
  if (SCHLUESSEL_NUR_ZEILE.some((z) => z.quelle === quelle && z.punkt === k.punkt)) {
    werfe(wo, `${quelle} ${k.punkt} is the row sc, not a key (one writer per pair)`);
  }
}

// plan 1.11 task 7: the identity and files of a host stage. The path may hold any character but a control character (it travels on a command line as
// <format>:<path>#<uid>), the uid any printable text
// but '#' (a VST3 class id or a plugin label such as "A/B Tester x2 Mono"; it may be empty for LV2, where the path is the URI).
export const HOST_PFAD_ZEICHEN = /^[^\u0000-\u001f\u007f]{1,1024}$/;
export const HOST_UID_ZEICHEN = /^[^\u0000-\u001f\u007f#]{0,256}$/;   // any printable text but '#': the spec is split at the LAST '#'
function pruefeHostPlugin(x: unknown, wo: string): void {
  const pl = felder(x, wo, ['format', 'pfad', 'uid', 'name']);
  if (pl.format !== 'vst3' && pl.format !== 'lv2') werfe(`${wo}.format`, 'vst3 | lv2 erwartet');
  if (typeof pl.pfad !== 'string' || !HOST_PFAD_ZEICHEN.test(pl.pfad)) werfe(`${wo}.pfad`, 'Pfad ohne Steuerzeichen erwartet');
  if (typeof pl.uid !== 'string' || !HOST_UID_ZEICHEN.test(pl.uid) || (pl.format === 'vst3' && pl.uid === '')) werfe(`${wo}.uid`, 'uid erwartet');
  text(pl.name, `${wo}.name`, 128);
}
function pruefeHostFelder(o: Record<string, unknown>, w: string): void {
  pruefeHostPlugin(o.plugin, `${w}.plugin`);
  if (o.zustand !== `plugins/${String(o.id)}.carxs`) werfe(`${w}.zustand`, `plugins/<id>.carxs erwartet`);
  if (Object.keys(o.werte as object).length) werfe(`${w}.werte`, 'eine Host-Stufe hat keine Werte');
  if ('latenz_extra' in o) zahlIn(o.latenz_extra, `${w}.latenz_extra`, 1, MAX_LATENZ_EXTRA, true);   // 0 is stored as an absent field
  if ('sc' in o || 'key' in o) werfe(`${w}.sc`, 'unbekanntes Feld (nur der Kompressor hat einen Schlüssel)');
}

// 1.10 slice 4: the chain of a strip (only /2): a non-empty list of at most MAX_INSERTS_PRO_STRANG stages with closed fields. Uniqueness of IDs and
// slots over the whole project is checked in pruefeAlles.
function pruefeInserts(x: unknown, wo: string, erlaubt: boolean): Insert[] {
  if (!erlaubt) return werfe(wo, `unbekanntes Feld (Inserts gibt es erst ab ${FORMAT})`);
  if (!Array.isArray(x) || x.length < 1) return werfe(wo, 'nicht leere Liste erwartet (fehlt bei keiner Stufe)');
  if (x.length > MAX_INSERTS_PRO_STRANG) werfe(wo, `höchstens ${MAX_INSERTS_PRO_STRANG} Stufen`);
  x.forEach((ix, i) => {
    const w = `${wo}[${i}]`;
    const o = felder(ix, w, ['id', 'art', 'slot', 'an', 'werte'], ['sc', 'key', 'preset', 'plugin', 'zustand', 'latenz_extra', 'graph']);
    if ('preset' in o) presetIdIn(o.preset, `${w}.preset`);
    if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${w}.id`, 'ID erwartet');
    if (o.art !== 'host' && !(INSERT_ARTEN_AKTIV as readonly unknown[]).includes(o.art)) {
      werfe(`${w}.art`, `${[...INSERT_ARTEN_AKTIV, 'host'].join(' | ')} erwartet`);
    }
    if (o.art === 'host') pruefeHostFelder(o, w);
    else for (const k of ['plugin', 'zustand', 'latenz_extra']) if (k in o) werfe(`${w}.${k}`, 'unbekanntes Feld (nur eine Host-Stufe)');
    zahlIn(o.slot, `${w}.slot`, 1, MAX_INS[o.art as string], true);
    boolean(o.an, `${w}.an`);
    if (o.art === 'bk') {   // arr-bk: the graph is part of the stage
      if (typeof o.graph !== 'string' || !BK_GRAPH_NAME.test(o.graph)) werfe(`${w}.graph`, 'graph name expected ([a-z0-9_-], 1..32 characters)');
    } else if ('graph' in o) werfe(`${w}.graph`, 'unknown field (only a bk stage carries a graph)');
    const art = o.art as InsertPoolArt;
    if (art === 'host') { felder(o.werte, `${w}.werte`, []); return; }
    // a bk stage: k9..k64 are optional (an older project stores k1..k8 only, see modular.ts)
    const opt = art === 'bk' ? BK_INSERT_OPTIONAL : [];
    const ws = felder(o.werte, `${w}.werte`, insertWertNamen(art).filter((n) => !opt.includes(n)), [...opt]);
    for (const q of insertWertParameter(art)) if (q.name in ws) zahlIn(ws[q.name], `${w}.werte.${q.name}`, q.min, q.max, q.ganz);
    if ('sc' in o) {
      if (art !== 'komp') werfe(`${w}.sc`, 'unbekanntes Feld (nur der Kompressor hat einen Schlüssel)');
      zahlIn(o.sc, `${w}.sc`, 1, MAX_SPUREN, true);   // 0 is stored as an absent key
    }
    if ('key' in o) pruefeSchluessel(o.key, `${w}.key`, art, 'sc' in o);
  });
  return x as Insert[];
}

// 1.10 slice 4c: the rack of a strip, closed fields. The references into the chain, the uniqueness of the slot and the limits are checked in pruefeAlles.
function pruefeRack(x: unknown, wo: string): Rack {
  const o = felder(x, wo, ['slot', 'namen', 'makros', 'werte'], ['variationen']);
  zahlIn(o.slot, `${wo}.slot`, 1, MAX_RACK, true);
  if ('variationen' in o) {
    const v = o.variationen;
    if (!Array.isArray(v) || v.length < 1 || v.length > MAX_VARIATIONEN) werfe(`${wo}.variationen`, `1..${MAX_VARIATIONEN} variations expected`);
    const namen = new Set<string>();
    (v as unknown[]).forEach((e, i) => {
      const w = `${wo}.variationen[${i}]`;
      const vo = felder(e, w, ['name', 'werte']);
      if (typeof vo.name !== 'string' || vo.name.length < 1 || vo.name.length > VARIATION_NAME_MAX) {
        werfe(`${w}.name`, `text 1..${VARIATION_NAME_MAX} characters expected`);
      }
      if (namen.has(vo.name as string)) werfe(`${w}.name`, `duplicate (${vo.name as string})`);
      namen.add(vo.name as string);
      if (!Array.isArray(vo.werte) || vo.werte.length !== MAX_MAKROS) werfe(`${w}.werte`, `${MAX_MAKROS} numbers expected`);
      (vo.werte as unknown[]).forEach((n, k) => zahlIn(n, `${w}.werte[${k}]`, 0, 1));
    });
  }
  if (!Array.isArray(o.namen) || o.namen.length !== MAX_MAKROS) werfe(`${wo}.namen`, `${MAX_MAKROS} Texte erwartet`);
  o.namen.forEach((n, i) => {
    if (typeof n !== 'string' || n.length > MAKRO_NAME_MAX) werfe(`${wo}.namen[${i}]`, `Text 0..${MAKRO_NAME_MAX} Zeichen erwartet`);
  });
  if (!Array.isArray(o.werte) || o.werte.length !== MAX_MAKROS) werfe(`${wo}.werte`, `${MAX_MAKROS} Zahlen erwartet`);
  o.werte.forEach((v, i) => zahlIn(v, `${wo}.werte[${i}]`, 0, 1));
  if (!Array.isArray(o.makros) || o.makros.length !== MAX_MAKROS) werfe(`${wo}.makros`, `${MAX_MAKROS} Makros erwartet`);
  o.makros.forEach((m, i) => {
    const mo = felder(m, `${wo}.makros[${i}]`, ['ziel']);
    if (!Array.isArray(mo.ziel)) werfe(`${wo}.makros[${i}].ziel`, 'Liste erwartet');
    mo.ziel.forEach((z, k) => {
      const wz = `${wo}.makros[${i}].ziel[${k}]`;
      const zo = istObjekt(z) && 'glied' in z ? felder(z, wz, ['glied', 'param', 'von', 'bis']) : felder(z, wz, ['insert', 'param', 'von', 'bis']);
      if ('glied' in zo) {
        if (typeof zo.glied !== 'string' || !GLIED_ID.test(zo.glied)) werfe(`${wz}.glied`, 'member id g1..g4 expected');
      } else if (typeof zo.insert !== 'string' || !ID.test(zo.insert)) werfe(`${wz}.insert`, 'ID erwartet');
      if (typeof zo.param !== 'string') werfe(`${wo}.makros[${i}].ziel[${k}].param`, 'Text erwartet');
      if (!zahl(zo.von)) werfe(`${wo}.makros[${i}].ziel[${k}].von`, 'Zahl erwartet');
      if (!zahl(zo.bis)) werfe(`${wo}.makros[${i}].ziel[${k}].bis`, 'Zahl erwartet');
    });
  });
  return x as Rack;
}

function pruefeReturn(g: unknown, wo: string): Return {
  const o = felder(g, wo, ['id', 'nr', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'hall'], ['pre', 'inserts', 'rack', 'automation']);
  if ('pre' in o && o.pre !== true) werfe(`${wo}.pre`, 'true erwartet (fehlt bei post)');
  if ('inserts' in o) pruefeInserts(o.inserts, `${wo}.inserts`, true);   // returns exist only in /2
  if ('rack' in o) pruefeRack(o.rack, `${wo}.rack`);
  // after the chain and rack checks: it looks them up
  if ('automation' in o) pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack }, undefined, false);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.nr, `${wo}.nr`, 1, MAX_RETURNS, true);
  text(o.name, `${wo}.name`, 80);
  if (typeof o.farbe !== 'string' || !FARBE.test(o.farbe)) werfe(`${wo}.farbe`, '#rrggbb erwartet');
  zahlIn(o.fader_db, `${wo}.fader_db`, FADER_MIN, FADER_MAX); zahlIn(o.pan, `${wo}.pan`, -1, 1);
  boolean(o.mute, `${wo}.mute`); boolean(o.solo, `${wo}.solo`);
  const h = felder(o.hall, `${wo}.hall`, ['an', ...HALL_FELDER]);
  boolean(h.an, `${wo}.hall.an`);
  for (const k of HALL_FELDER) zahlIn(h[k], `${wo}.hall.${k}`, 0, 1);
  return o as unknown as Return;
}

function pruefeTake(t: unknown, wo: string, warpErlaubt: boolean): Take {
  const o = felder(t, wo, ['id', 'name', 'clips'], ['art']);
  if (typeof o.id !== 'string' || !TAKE_ID.test(o.id)) werfe(`${wo}.id`, 't<n> expected');
  text(o.name, `${wo}.name`, TAKE_NAME_MAX);
  if ('art' in o && o.art !== 'original') werfe(`${wo}.art`, "'original' expected");
  if (!Array.isArray(o.clips)) werfe(`${wo}.clips`, 'list expected');
  (o.clips as unknown[]).forEach((c, i) => pruefeClip(c, `${wo}.clips[${i}]`, 'audio', warpErlaubt));
  return o as unknown as Take;
}

// The lane list of a strip (a track, group, return or the master): not empty, at most MAX_LANES_PRO_SPUR, every lane valid on THIS strip, no target twice.
// slice 2 (E3, 1.12): geraet.* only on tracks whose device owns the parameter (`geraet`; slice 7: RB-338 or bk);
// 1.12 slice 6: a chain target needs its stage or rack on this strip, and the
// parameter of a stage a macro drives has one writer (the macro), so it takes no lane (param_gemappt)
function pruefeLanen(automation: unknown, wo: string, strang: { inserts?: Insert[]; rack?: Rack }, geraet: unknown, istSpur = true): void {
  if (!Array.isArray(automation) || automation.length < 1) werfe(`${wo}.automation`, 'non-empty list expected (absent when there is no lane)');
  if ((automation as unknown[]).length > MAX_LANES_PRO_SPUR) werfe(`${wo}.automation`, `at most ${MAX_LANES_PRO_SPUR} lanes per track`);
  const ziele = new Set<unknown>();
  (automation as unknown[]).forEach((lx, i) => {
    const f = lanePruefung(lx, strang);
    if (f) werfe(`${wo}.automation[${i}]`, f.text);
    const ziel = (lx as Lane).ziel;
    if (!istSpur && !istKettenZiel(ziel)) {
      werfe(`${wo}.automation[${i}].ziel`, `${ziel}: a group, return or master takes insert and rack lanes only (ziel_unbekannt)`);
    }
    if (istGeraetZiel(ziel) && !passtGeraetZiel(ziel, geraet)) {
      werfe(`${wo}.automation[${i}].ziel`, `${ziel}: only on a track with the device it belongs to (RB-338 parameters, bk k1 to k64)`);
    }
    const k = zerlegeKettenZiel(ziel);
    if (k && 'insert' in k && makroVon(strang as InsertTraeger, k.insert, k.param)) {
      werfe(`${wo}.automation[${i}].ziel`, `${ziel}: the parameter is driven by a rack macro (param_gemappt)`);
    }
    if (ziele.has(ziel)) werfe(`${wo}.automation[${i}].ziel`, `doppelt (${ziel})`);
    ziele.add(ziel);
  });
}

function pruefeSpur(s: unknown, wo: string, warpErlaubt: boolean): Spur {
  if (!istObjekt(s)) return werfe(wo, 'Objekt erwartet');
  const basis = ['id', 'nr', 'name', 'farbe', 'art', 'fader_db', 'pan', 'mute', 'solo', 'clips'];
  if (s.art !== 'audio' && s.art !== 'instrument') werfe(`${wo}.art`, 'audio oder instrument erwartet');
  const o = s.art === 'audio' ? felder(s, wo, basis, ['von', 'gruppe', 'aufnahme', 'ausgang', 'automation', 'sends', 'inserts', 'rack', 'takes'])
    : felder(s, wo, [...basis, 'geraet'], ['freeze', 'von', 'gruppe', 'ausgang', 'automation', 'sends', 'inserts', 'rack', 'aufnahme']);
  if ('sends' in o) pruefeSends(o.sends, `${wo}.sends`, warpErlaubt);
  if ('inserts' in o) pruefeInserts(o.inserts, `${wo}.inserts`, warpErlaubt);
  if ('rack' in o) { if (!warpErlaubt) werfe(`${wo}.rack`, `unbekanntes Feld (Racks gibt es erst ab ${FORMAT})`); pruefeRack(o.rack, `${wo}.rack`); }
  if ('von' in o && o.von !== 'andreas' && o.von !== 'cypher') werfe(`${wo}.von`, 'andreas oder cypher erwartet');
  // ohne Leerzeichen am Rand, wie die Befehle (Review S2)
  if ('gruppe' in o && text(o.gruppe, `${wo}.gruppe`, GRUPPE_MAX).trim() !== o.gruppe) werfe(`${wo}.gruppe`, 'ohne Leerzeichen am Rand erwartet');
  if ('aufnahme' in o) {
    const a = felder(o.aufnahme, `${wo}.aufnahme`, ['scharf', 'eingang'], ['monitor']);
    boolean(a.scharf, `${wo}.aufnahme.scharf`);
    if ('monitor' in a && a.monitor !== 'aus' && a.monitor !== 'ein') werfe(`${wo}.aufnahme.monitor`, "'aus' or 'ein' expected (auto is written as no key)");
    if (a.eingang !== null) {
      if (o.art === 'instrument') {   // instrument tracks: only midi_ein_1
        const e = felder(a.eingang, `${wo}.aufnahme.eingang`, ['art']);
        if (e.art !== 'midi') werfe(`${wo}.aufnahme.eingang`, "{art: 'midi'} or null expected on an instrument track");
      } else {
        const e = istObjekt(a.eingang) ? a.eingang : werfe(`${wo}.aufnahme.eingang`, 'Objekt erwartet');
        if (e.art === 'extern') {
          felder(e, `${wo}.aufnahme.eingang`, ['art', 'paar', 'modus']);
          if (e.paar !== 1 && e.paar !== 2 && e.paar !== 3 && e.paar !== 4) werfe(`${wo}.aufnahme.eingang.paar`, '1, 2, 3 or 4 expected');
          if (!(EXTERN_MODI as readonly unknown[]).includes(e.modus)) werfe(`${wo}.aufnahme.eingang.modus`, 'stereo, links, rechts or summe expected');
        } else {
          felder(e, `${wo}.aufnahme.eingang`, ['art', 'name']);
          if (e.art !== 'intern' || !(INTERNE_EINGAENGE as readonly unknown[]).includes(e.name)) {
            werfe(`${wo}.aufnahme.eingang`, 'intern input of the table (erz/1..3, erz/5..7, pad/1..2), {art: extern, paar, modus} or null expected');
          }
        }
      }
    }
    if (a.scharf === true && a.eingang === null) werfe(`${wo}.aufnahme.scharf`, 'scharf braucht einen Eingang');
  }
  if ('ausgang' in o) {   // 1.10: master steht nie in der Datei
    const au = felder(o.ausgang, `${wo}.ausgang`, ['art', 'id']);
    if (au.art !== 'gruppe') werfe(`${wo}.ausgang.art`, 'gruppe erwartet (master steht nie in der Datei)');
    if (typeof au.id !== 'string' || !ID.test(au.id)) werfe(`${wo}.ausgang.id`, 'ID erwartet');
  }
  if ('automation' in o) {          // in /1 ist jedes automation-Feld unbekannt (wie warp)
    if (!warpErlaubt) werfe(`${wo}.automation`, `unbekanntes Feld (Automation gibt es erst ab ${FORMAT})`);
    pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack }, o.art === 'instrument' ? o.geraet : undefined);
  }
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.nr, `${wo}.nr`, 1, MAX_SPUREN, true);
  text(o.name, `${wo}.name`, 80);
  if (typeof o.farbe !== 'string' || !FARBE.test(o.farbe)) werfe(`${wo}.farbe`, '#rrggbb erwartet');
  zahlIn(o.fader_db, `${wo}.fader_db`, FADER_MIN, FADER_MAX); zahlIn(o.pan, `${wo}.pan`, -1, 1);
  boolean(o.mute, `${wo}.mute`); boolean(o.solo, `${wo}.solo`);
  if (o.art === 'instrument') {
    const g = pruefeGeraet(o.geraet, `${wo}.geraet`, warpErlaubt);
    if (wirtSlots({ art: 'instrument', geraet: g }).length > 0) {      // 1.9 U7 T4: a rack with a Surge member freezes like a Surge track
      if (!('freeze' in o)) werfe(`${wo}.freeze`, 'fehlt (null oder Objekt)');
      if (o.freeze !== null) pruefeFreeze(o.freeze, `${wo}.freeze`);
    } else if ('freeze' in o) werfe(`${wo}.freeze`, 'nur bei Wirt-Geräten');
  }
  if (!Array.isArray(o.clips)) werfe(`${wo}.clips`, 'Liste erwartet');
  (o.clips as unknown[]).forEach((c, i) => pruefeClip(c, `${wo}.clips[${i}]`, o.art as string, warpErlaubt, o as { art: string; geraet?: unknown }));
  if ('takes' in o) {               // 1.14: like warp, /2 only; an empty list is valid on load (the load drops it)
    if (!warpErlaubt) werfe(`${wo}.takes`, `unknown field (takes exist only from ${FORMAT} on)`);
    if (!Array.isArray(o.takes)) werfe(`${wo}.takes`, 'list expected');
    if ((o.takes as unknown[]).length > MAX_TAKES_PRO_SPUR) werfe(`${wo}.takes`, `at most ${MAX_TAKES_PRO_SPUR} takes per track`);
    (o.takes as unknown[]).forEach((t, i) => pruefeTake(t, `${wo}.takes[${i}]`, warpErlaubt));
  }
  return o as unknown as Spur;
}

function pruefeGruppe(g: unknown, wo: string): Gruppe {
  const o = felder(g, wo, ['id', 'nr', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet'], ['sends', 'inserts', 'rack', 'automation']);
  if ('sends' in o) pruefeSends(o.sends, `${wo}.sends`, true);
  if ('inserts' in o) pruefeInserts(o.inserts, `${wo}.inserts`, true);
  if ('rack' in o) pruefeRack(o.rack, `${wo}.rack`);
  // after the chain and rack checks: it looks them up
  if ('automation' in o) pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack }, undefined, false);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.nr, `${wo}.nr`, 1, MAX_GRUPPEN, true);
  text(o.name, `${wo}.name`, 80);
  if (typeof o.farbe !== 'string' || !FARBE.test(o.farbe)) werfe(`${wo}.farbe`, '#rrggbb erwartet');
  zahlIn(o.fader_db, `${wo}.fader_db`, FADER_MIN, FADER_MAX); zahlIn(o.pan, `${wo}.pan`, -1, 1);
  boolean(o.mute, `${wo}.mute`); boolean(o.solo, `${wo}.solo`); boolean(o.gefaltet, `${wo}.gefaltet`);
  return o as unknown as Gruppe;
}

// Prüft ohne Kopie: null = gültig, sonst der Fehlertext. Der Befehlsweg braucht nur das Urteil (kein structuredClone des ganzen Projekts).
export function pruefeFehler(x: unknown): string | null {
  try {
    pruefeAlles(x);
    return null;
  } catch (e) {
    if (e instanceof Fehl) return e.message;
    throw e;
  }
}

// every insert stage of the project (tracks, groups, returns, master) that is a bk stage gets k9..k64 = 0.5 where the file had none
function bkInsertWerteAuffuellen(p: Projekt): void {
  for (const { strang } of alleStraenge(p)) for (const i of strang.inserts ?? []) if (i.art === 'bk') bkInsertAuffuellen(i.werte);
}
export function pruefeProjekt(x: unknown): { projekt: Projekt } | { fehler: string } {
  const fehler = pruefeFehler(x);
  if (fehler !== null) return { fehler };
  const p = structuredClone(x) as Projekt;
  // 1.10 (P3): /1 → /2, kein rev-Schritt. Paket 1.13: ein /1-Projekt hat keinen Warp (die Prüfung lehnt ihn dort ab), die Hebung setzt keinen
  if ((p as { format: string }).format === FORMAT_ALT) { p.format = FORMAT; p.gruppen = []; p.master = { fader_db: 0 }; }
  for (const s of p.spuren) for (const l of s.automation ?? []) normalisiereLane(l);   // slice 2 (E2): mute/solo points without form are sprung
  bkInsertWerteAuffuellen(p);                                                        // a bk stage of an older project: k9..k64 = 0.5
  for (const s of p.spuren) s.von = herkunft(s);                                     // Spec 6.22: fehlt von (älteres Projekt), gilt andreas
  uebernimmNotenZaehler(p);                                                          // Spec 6.28: alte Clip-Zähler ins Projekt
  entferneLeereTakes(p);                                                             // 1.14: an empty takes list is not written
  setzeFehlendeZaehler(p);                                                           // Spec 6.35: fehlende Zähler schon beim Öffnen
  return { projekt: p };
}

function pruefeAlles(x: unknown): void {
  // Format zuerst (Prüfung 2, C1): ein fremdes Format, auch eines mit gruppen und master, ist der Fehler „format“
  // und scheitert nicht an „unbekanntes Feld“.
  // Ein fehlendes Format bleibt Sache von `felder` („projekt.format: fehlt“).
  if (istObjekt(x) && 'format' in x && x.format !== FORMAT && x.format !== FORMAT_ALT) werfe('format', `${FORMAT} oder ${FORMAT_ALT} erwartet`);
  const neu2 = istObjekt(x) && x.format === FORMAT;   // /2 verlangt gruppen und master, /1 hat sie nicht
  const pflicht = ['format', 'name', 'rev', 'wiedergabe_rev', 'tempo_bpm', 'taktart', 'loop', 'metronom', 'spuren', ...(neu2 ? ['gruppen', 'master'] : [])];
  // returns, baukasten in /1: unknown field
  const o = felder(x, 'projekt', pflicht, ['naechste_id', 'naechste_noten_id', ...(neu2 ? ['returns', 'baukasten', 'aufnahme'] : [])]);
  if ('naechste_noten_id' in o) zahlIn(o.naechste_noten_id, 'naechste_noten_id', 1, Number.MAX_SAFE_INTEGER, true);
  if ('naechste_id' in o) {
    const z = felder(o.naechste_id, 'naechste_id', [], ['spur', 'clip', 'gruppe', 'lane', 'return', 'insert', 'take']);
    for (const k of ['spur', 'clip', 'gruppe', 'lane', 'return', 'insert', 'take']) {
      if (k in z) zahlIn(z[k], `naechste_id.${k}`, 1, Number.MAX_SAFE_INTEGER, true);
    }
  }
  text(o.name, 'name', 80);
  zahlIn(o.rev, 'rev', 0, Number.MAX_SAFE_INTEGER, true); zahlIn(o.wiedergabe_rev, 'wiedergabe_rev', 0, Number.MAX_SAFE_INTEGER, true);
  zahlIn(o.tempo_bpm, 'tempo_bpm', TEMPO_MIN, TEMPO_MAX);
  if (!Array.isArray(o.taktart) || o.taktart.length !== 2 || o.taktart[0] !== 4 || o.taktart[1] !== 4) werfe('taktart', 'nur [4,4] (Spec 2.7)');
  const l = felder(o.loop, 'loop', ['an', 'von_beat', 'bis_beat']);
  boolean(l.an, 'loop.an'); zahlIn(l.von_beat, 'loop.von_beat', 0, MAX_BEAT); zahlIn(l.bis_beat, 'loop.bis_beat', 0, MAX_BEAT);
  if ((l.bis_beat as number) - (l.von_beat as number) < 1) werfe('loop', 'bis_beat − von_beat muss mindestens 1 sein');
  const m = felder(o.metronom, 'metronom', ['an', 'pegel_db', 'ziel']);
  boolean(m.an, 'metronom.an'); zahlIn(m.pegel_db, 'metronom.pegel_db', -60, 0);
  if (m.ziel !== 'master' && m.ziel !== 'cue') werfe('metronom.ziel', 'master oder cue erwartet');
  if ('aufnahme' in o) {   // 1.8 S0 (D17): all keys once the field exists; counts 0, 1, 2, 4 (the page choice, spec 4.5)
    const au = felder(o.aufnahme, 'aufnahme', ['vorzaehler_takte', 'punch', 'overdub']);
    if (!(VORZAEHLER_WERTE as readonly unknown[]).includes(au.vorzaehler_takte)) werfe('aufnahme.vorzaehler_takte', '0, 1, 2 or 4 expected');
    boolean(au.overdub, 'aufnahme.overdub');
    const pu = felder(au.punch, 'aufnahme.punch', ['ein', 'aus', 'von_beat', 'bis_beat']);
    boolean(pu.ein, 'aufnahme.punch.ein'); boolean(pu.aus, 'aufnahme.punch.aus');
    zahlIn(pu.von_beat, 'aufnahme.punch.von_beat', 0, MAX_BEAT); zahlIn(pu.bis_beat, 'aufnahme.punch.bis_beat', 0, MAX_BEAT);
    if ((pu.bis_beat as number) <= (pu.von_beat as number)) werfe('aufnahme.punch', 'bis_beat muss größer als von_beat sein');
  }
  if (!Array.isArray(o.spuren)) werfe('spuren', 'Liste erwartet');
  if ((o.spuren as unknown[]).length > MAX_SPUREN) werfe('spuren', `höchstens ${MAX_SPUREN}`);
  const refs: [number, string][] = [];
  const takeIds = new Set<string>();
  const spurIds = new Set<string>(), nrs = new Set<number>(), clipIds = new Set<string>(), slots = new Set<number>();
  let clips = 0, noten = 0, autoPunkte = 0, bkSpuren = 0, kitGeraete = 0, racks = 0;
  const laneIds = new Set<string>();
  // lane IDs are unique over the whole project (every strip: track, group, return, master); the points of all lanes count against MAX_AUTO_PUNKTE
  const laneZaehle = (st: { automation?: Lane[] }, wo: string): void => (st.automation ?? []).forEach((l, k) => {
    if (laneIds.has(l.id)) werfe(`${wo}.automation[${k}].id`, `doppelt (${l.id})`);
    laneIds.add(l.id); autoPunkte += l.punkte.length;
  });
  (o.spuren as unknown[]).forEach((sx, i) => {
    const s = pruefeSpur(sx, `spuren[${i}]`, neu2);   // Paket 1.13: warp nur in /2
    if (!neu2 && s.ausgang) werfe(`spuren[${i}].ausgang`, 'gibt es erst in /2');
    if (s.ausgang) refs.push([i, s.ausgang.id]);
    if (spurIds.has(s.id)) werfe(`spuren[${i}].id`, `doppelt (${s.id})`);
    if (nrs.has(s.nr)) werfe(`spuren[${i}].nr`, `doppelt (${s.nr})`);
    spurIds.add(s.id); nrs.add(s.nr);
    laneZaehle(s, `spuren[${i}]`);
    // 1.9 U7: the kit and bk limits count tracks plus rack members (the core counts every device it builds); racks have their own limit
    if (istRack(s) && ++racks > MAX_RACK_GERAETE) werfe('spuren', `at most ${MAX_RACK_GERAETE} rack devices`);
    for (const d of [s.geraet, ...glieder(s).map((m) => m.geraet)]) {
      if (d?.art === 'intern' && d.name === 'bk' && ++bkSpuren > MAX_BK_SPUREN) werfe('spuren', `at most ${MAX_BK_SPUREN} Baukasten tracks (bk)`);
      if (d?.art === 'intern' && d.name === 'kit' && ++kitGeraete > MAX_KIT_GERAETE) werfe('spuren', `at most ${MAX_KIT_GERAETE} kit devices`);
    }
    const wirtAn = (slot: number, wo: string): void => {      // one slot, one Surge: over tracks and rack members
      if (slots.has(slot)) werfe(`spuren[${i}].${wo}.slot`, `doppelt (${slot})`);
      slots.add(slot);
    };
    if (s.geraet?.art === 'wirt') wirtAn(s.geraet.slot, 'geraet');
    glieder(s).forEach((m, k) => { if (m.geraet.art === 'wirt') wirtAn(m.geraet.slot, `geraet.glieder[${k}].geraet`); });
    s.clips.forEach((c, k) => {
      if (clipIds.has(c.id)) werfe(`spuren[${i}].clips[${k}].id`, `doppelt (${c.id})`);
      clipIds.add(c.id); clips++; if (c.art === 'midi') noten += c.noten.length;
    });
    (s.takes ?? []).forEach((t, k) => {                      // 1.14: take ids and take clip ids are project wide, take clips count against MAX_CLIPS
      if (takeIds.has(t.id)) werfe(`spuren[${i}].takes[${k}].id`, `duplicate (${t.id})`);
      takeIds.add(t.id);
      t.clips.forEach((c, m) => {
        if (clipIds.has(c.id)) werfe(`spuren[${i}].takes[${k}].clips[${m}].id`, `duplicate (${c.id})`);
        clipIds.add(c.id); clips++;
      });
    });
  });
  const gruppenIds = new Set<string>(), gruppenNrs = new Set<number>();
  if (neu2) {
    if (!Array.isArray(o.gruppen)) werfe('gruppen', 'Liste erwartet');
    if ((o.gruppen as unknown[]).length > MAX_GRUPPEN) werfe('gruppen', `höchstens ${MAX_GRUPPEN}`);
    (o.gruppen as unknown[]).forEach((gx, i) => {
      const g = pruefeGruppe(gx, `gruppen[${i}]`);
      if (gruppenIds.has(g.id)) werfe(`gruppen[${i}].id`, `doppelt (${g.id})`);
      if (gruppenNrs.has(g.nr)) werfe(`gruppen[${i}].nr`, `doppelt (${g.nr})`);
      gruppenIds.add(g.id); gruppenNrs.add(g.nr);
      laneZaehle(g, `gruppen[${i}]`);
    });
    const ms = felder(o.master, 'master', ['fader_db'], ['inserts', 'rack', 'automation']);
    zahlIn(ms.fader_db, 'master.fader_db', FADER_MIN, FADER_MAX);
    if ('inserts' in ms) pruefeInserts(ms.inserts, 'master.inserts', true);
    if ('rack' in ms) pruefeRack(ms.rack, 'master.rack');
    if ('automation' in ms) pruefeLanen(ms.automation, 'master', ms as { inserts?: Insert[]; rack?: Rack }, undefined, false);
    laneZaehle(ms as { automation?: Lane[] }, 'master');
  }
  for (const [i, id] of refs) if (!gruppenIds.has(id)) werfe(`spuren[${i}].ausgang.id`, `unbekannte Gruppe ${id}`);
  // 1.10 slice 3: returns and the references of the sends
  const returnIds = new Set<string>(), returnNrs = new Set<number>();
  if ('returns' in o) {
    if (!Array.isArray(o.returns) || o.returns.length < 1) werfe('returns', 'nicht leere Liste erwartet (fehlt bei keinem Return)');
    if ((o.returns as unknown[]).length > MAX_RETURNS) werfe('returns', `höchstens ${MAX_RETURNS}`);
    (o.returns as unknown[]).forEach((rx, i) => {
      const r = pruefeReturn(rx, `returns[${i}]`);
      if (returnIds.has(r.id)) werfe(`returns[${i}].id`, `doppelt (${r.id})`);
      if (returnNrs.has(r.nr)) werfe(`returns[${i}].nr`, `doppelt (${r.nr})`);
      returnIds.add(r.id); returnNrs.add(r.nr);
      laneZaehle(r, `returns[${i}]`);
    });
  }
  if ('baukasten' in o) { const f = pruefeBkListe(o.baukasten); if (f) werfe(f.wo, f.text); }   // S17
  const sendRefs = (liste: { sends?: Send[] }[], wo: string) => liste.forEach((e, i) => (e.sends ?? []).forEach((sd, k) => {
    if (!returnIds.has(sd.id)) werfe(`${wo}[${i}].sends[${k}].id`, `unbekannter Return ${sd.id}`);
  }));
  sendRefs(o.spuren as { sends?: Send[] }[], 'spuren');
  if (neu2) sendRefs(o.gruppen as { sends?: Send[] }[], 'gruppen');
  // slice 4: stage IDs and pooled slots are unique over the whole project
  const insertIds = new Set<string>(), insertSlots = new Set<string>();
  for (const { strangId, insert } of alleInserts(o as unknown as Projekt)) {
    if (insertIds.has(insert.id)) werfe(`${strangId}.inserts`, `ID doppelt (${insert.id})`);
    const slot = `${insert.art}/${insert.slot}`;
    if (insertSlots.has(slot)) werfe(`${strangId}.inserts`, `Slot doppelt (${slot})`);
    insertIds.add(insert.id); insertSlots.add(slot);
    // the key names an existing track, like the command insert_setzen demands (a dangling key would bind silently to a later spur_neu)
    if (insert.sc !== undefined && insert.sc > 0 && !nrs.has(insert.sc)) werfe(`${strangId}.inserts`, `sc: Spur ${insert.sc} existiert nicht`);
    // slice 5: a structural key names an existing strip, like sc (a dangling key would bind silently to a later spur_neu)
    const kq = insert.key;
    if (kq && ((kq.quelle === 'spur' && !nrs.has(kq.nr)) || (kq.quelle === 'grp' && !gruppenNrs.has(kq.nr))
      || (kq.quelle === 'ret' && !returnNrs.has(kq.nr)))) {
      werfe(`${strangId}.inserts`, `key: ${kq.quelle} ${kq.nr} does not exist`);
    }
  }
  // slice 4c: racks. The slot is unique over the project; a rack sits on a strip with a chain; every target is a stage of that chain and a
  // continuous parameter in
  // its range; a parameter has one macro at most; at most MAX_MAKRO_ZIELE targets per rack
  const rackSlots = new Set<number>();
  for (const { strang, strangId, rack } of alleRacks(o as unknown as Projekt)) {
    if (rackSlots.has(rack.slot)) werfe(`${strangId}.rack`, `Slot doppelt (${rack.slot})`);
    rackSlots.add(rack.slot);
    const rackSpur = 'art' in strang && strang.art === 'instrument' && strang.geraet?.art === 'rack';   // 1.9 U8 T7: its members are targets, no chain needed
    if (!strang.inserts?.length && !rackSpur) werfe(`${strangId}.rack`, 'ein Rack braucht eine Kette (rack_ohne_kette)');
    const ziele = rack.makros.flatMap((m) => m.ziel);
    if (ziele.length === 0) werfe(`${strangId}.rack`, 'kein Ziel: ein Rack ohne Zuordnung gibt es nicht (rack_leer)');
    if (ziele.length > MAX_MAKRO_ZIELE) werfe(`${strangId}.rack`, `höchstens ${MAX_MAKRO_ZIELE} Ziele (makro_voll)`);
    const gesehen = new Set<string>();
    for (const z of ziele) {
      if (istGliedZiel(z)) {   // 1.9 U8 T7: a target on a member of the rack device of this track
        if (!rackSpur) werfe(`${strangId}.rack`, `target ${z.glied}: only on a rack track (glied_ohne_rack)`);
        const m = glieder(strang as Spur).find((x) => x.id === z.glied);
        if (!m) werfe(`${strangId}.rack`, `target ${z.glied}: no member of this track (glied_unbekannt)`);
        const q = gliedMakroParam(m!.geraet, z.param);
        if (!q) werfe(`${strangId}.rack`, `target ${z.glied}.${z.param}: parameter not allowed for this device (makro_ziel_wirt, argument_unbekannt)`);
        if (z.von < q!.min || z.von > q!.max || z.bis < q!.min || z.bis > q!.max) {
          werfe(`${strangId}.rack`, `target ${z.glied}.${z.param}: von/bis outside ${q!.min}..${q!.max}`);
        }
        const gk = `${z.glied}/${z.param}`;
        if (gesehen.has(gk)) werfe(`${strangId}.rack`, `target ${gk} twice (ziel_doppelt)`);
        gesehen.add(gk);
        continue;
      }
      const st = (strang.inserts ?? []).find((x) => x.id === z.insert);
      if (!st) werfe(`${strangId}.rack`, `Ziel ${z.insert}: keine Stufe dieser Kette`);
      const art = st!.art as InsertPoolArt;
      const q = INSERT_ARTEN[art].parameter.find((x) => x.name === z.param);
      if (!q || !makroFaehig(art, z.param)) werfe(`${strangId}.rack`, `Ziel ${z.insert}.${z.param}: kein stetiger Parameter`);
      if (z.von < q!.min || z.von > q!.max || z.bis < q!.min || z.bis > q!.max) {
        werfe(`${strangId}.rack`, `Ziel ${z.insert}.${z.param}: von/bis ausserhalb ${q!.min}..${q!.max}`);
      }
      const key = `${z.insert}/${z.param}`;
      if (gesehen.has(key)) werfe(`${strangId}.rack`, `Ziel ${key} doppelt (ziel_doppelt)`);
      gesehen.add(key);
    }
  }
  if (clips > MAX_CLIPS) werfe('spuren', `höchstens ${MAX_CLIPS} Clips`);
  if (noten > MAX_NOTEN) werfe('noten', `höchstens ${MAX_NOTEN} Noten`);
  const kettenLanen = alleStraenge(o as unknown as Projekt).reduce((n, x) => n + kettenLanen_(x.strang), 0);
  if (kettenLanen > MAX_KETTEN_LANEN) werfe('automation', `at most ${MAX_KETTEN_LANEN} insert and rack lanes in the project (zu_gross)`);
  if (autoPunkte > MAX_AUTO_PUNKTE) werfe('automation', `höchstens ${MAX_AUTO_PUNKTE} Punkte im Projekt`);
}

// --- Wiedergabe-Sicht -----------------------------------------------------------------------------------------------
// Alles, was den Klang des Kerns bestimmt, und nichts sonst. Zwei Stände mit gleicher Sicht brauchen keine neue Wiedergabe
// (Mixer, Namen, Farben, Tempo, Loop und Metronom laufen über eigene Wege); `betrifft_wiedergabe` der Befehle und das Verwerfen
// eines Freeze beruhen darauf.
type KettenStufe = { art: InsertSorte; slot: number; key?: InsertSchluessel; plugin?: string; latenz_extra?: number; graph?: string };
export const kettenSicht = (liste: readonly Insert[]): KettenStufe[] =>
  // slice 5: a structural key is playback structure
  liste.map((i) => ({ art: i.art, slot: i.slot, ...(i.key ? { key: { quelle: i.key.quelle, nr: i.key.nr, punkt: i.key.punkt } } : {}),
    ...(i.art === 'bk' ? { graph: i.graph! } : {}),   // arr-bk: another graph is another stage (structure)
    // plan 1.11 task 7 (D4): the extra latency is structure (it is in the playback file); a host stage of another plugin is another stage
    ...(i.art === 'host' ? { plugin: `${i.plugin!.format}:${i.plugin!.pfad}#${i.plugin!.uid}`,
      ...(i.latenz_extra ? { latenz_extra: i.latenz_extra } : {}) } : {}) }));
// 1.16 rest T2.5: the preset origin of a device is not playback (no new playback, no dropped freeze when only it changes)
const ohnePreset = (g: Geraet | undefined): Geraet | undefined => {
  if (g?.art === 'rack') return { ...g, glieder: g.glieder.map((m) => ({ ...m, geraet: ohnePreset(m.geraet) as GliedGeraet })) };   // members too (U7)
  if (!g || !('preset' in g)) return g;
  const { preset: _p, ...rest } = g;
  return rest as Geraet;
};
export function spurSicht(s: Spur, mitFreeze = true): unknown {
  return {
    nr: s.nr, art: s.art, geraet: ohnePreset(s.geraet) ?? null, ...(mitFreeze ? { freeze: s.freeze ?? null } : {}),
    // 1.10: das Ziel gehört zur Wiedergabe, nicht zum Freeze (ein Ziel-Wechsel verwirft keinen Freeze)
    ...(mitFreeze && s.ausgang ? { ausgang: s.ausgang.id } : {}),
    // slice 4: the chain is playback structure (art and slot: `an`, the values and the row key `sc` are controls; slice 5: a structural `key` is part of it),
    // not part of a freeze
    // (D12: the freeze tap is before the chain)
    ...(mitFreeze && s.inserts?.length ? { inserts: kettenSicht(s.inserts) } : {}),
    ...(mitFreeze && s.rack ? { rack: rackSicht(s) } : {}),   // slice 4c: the mapping table is playback structure (the macro values are controls)
    // Automation Slice 1: die Lane ändert die Wiedergabe, aber keinen Freeze (Spec 1.12); fehlt sie, bleibt die Sicht bit-gleich
    ...(mitFreeze && s.automation?.length
      ? { automation: s.automation.map((l) => ({ ziel: l.ziel, punkte: l.punkte.map((q) => [q.beat, q.wert, q.form ?? 'linear']) })) } : {}),
    // 1.12 slice 5 (D14): gain and modulation envelopes change the playback, not a freeze; transpose envelopes sit in the MIDI clip entry below (they
    // change the host notes, so they also drop a freeze). Absent envelopes add no key: the view stays byte for byte the same
    ...(mitFreeze && s.clips.some((c) => (c.huellkurven ?? []).some((h) => h.ziel !== 'transpose'))
      ? { huellkurven: s.clips.flatMap((c) => (c.huellkurven ?? []).filter((h) => h.ziel !== 'transpose').map((h) => ({ clip: c.id, ...h }))) } : {}),
    clips: s.clips.map((c) => (c.art === 'audio'
      ? { id: c.id, art: c.art, sha256: c.quelle.sha256, dekodiert: c.dekodiert, start_beat: c.start_beat, laenge_beats: c.laenge_beats,
        loop_beats: c.loop_beats ?? null, offset_s: c.offset_s, gain_db: c.gain_db, fade_ein_beats: c.fade_ein_beats, fade_aus_beats: c.fade_aus_beats,
        warp: c.warp?.an ? c.warp : null, ...(c.stumm ? { stumm: true } : {}) }   // Paket 1.13: ein Warp an ändert den Klang, ein Warp aus nicht
      : { id: c.id, art: c.art, start_beat: c.start_beat, laenge_beats: c.laenge_beats, loop_beats: c.loop_beats ?? null, noten: c.noten,
        ...(c.huellkurven?.some((h) => h.ziel === 'transpose') ? { transpose: c.huellkurven.find((h) => h.ziel === 'transpose') } : {}) })),
  };
}
// 1.12 slice 6: the lanes of a group, return or the master change the playback like those of a track (spurSicht); absent lanes add no key
const laneSicht = (st: { automation?: Lane[] }): { automation?: unknown } => st.automation?.length
  ? { automation: st.automation.map((l) => ({ ziel: l.ziel, punkte: l.punkte.map((q) => [q.beat, q.wert, q.form ?? 'linear']) })) } : {};
export const wiedergabeSicht = (p: Projekt): unknown => ({
  spuren: [...p.spuren].sort((a, b) => a.nr - b.nr).map((s) => spurSicht(s)),
  // 1.10: die Topologie nur, wenn es welche gibt (neutral: wie vorher)
  ...((p.gruppen ?? []).length ? { gruppen: [...p.gruppen].sort((a, b) => a.nr - b.nr)
    .map((g) => ({ id: g.id, nr: g.nr, ...(g.inserts?.length ? { inserts: kettenSicht(g.inserts) } : {}), ...(g.rack ? { rack: rackSicht(g) } : {}),
      ...laneSicht(g) })) } : {}),
  // 1.10 slice 3: the return topology (id, nr) only when there are returns; sends and hall values are controls, not part of the view
  ...((p.returns ?? []).length ? { returns: [...(p.returns ?? [])].sort((a, b) => a.nr - b.nr).map((r) => ({ id: r.id, nr: r.nr,
    ...(r.pre ? { pre: true } : {}), ...(r.inserts?.length ? { inserts: kettenSicht(r.inserts) } : {}), ...(r.rack ? { rack: rackSicht(r) } : {}),
    ...laneSicht(r) })) } : {}),
  // slice 4: only with a chain on the master
  ...(p.master?.inserts?.length
    ? { master: { inserts: kettenSicht(p.master.inserts), ...(p.master.rack ? { rack: rackSicht(p.master) } : {}), ...laneSicht(p.master) } }
    : {}),
});
