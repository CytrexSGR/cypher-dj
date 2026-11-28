import type { AudioNotenFeld } from './notes_contract.ts';
import type { BkKanal } from './modular.ts';
import type { Huellkurve } from './envelope.ts';
import { INSERT_ARTEN } from './insert_key.ts';
import type { Punkt } from './lane.ts';
import type { SeqDeck, SeqSicht } from './seq.ts';
import type { Stammbaum } from './sound_runde_contract.ts';
import type { Stift } from '../steckfeld.ts';
import type { TrackerMarke } from './tracker.ts';
import type { WerkbankMarke } from './werkbank.ts';

export type { Punkt, LaneForm } from './lane.ts';

export const FORMAT = 'cypherdj-projekt/3';   // container core: places (plaetze), strudel group, strom tracks, Return.gruppe
export const FORMAT_ALT2 = 'cypherdj-projekt/2';   // lifted in memory to /3 by pruefeProjekt (hebeAufDrei), no rev step
export const FORMAT_ALT = 'cypherdj-projekt/1';   // 1.10 (P3): /1 öffnet weiter und wird beim Laden im Speicher zu /2
export const MAX_SPUREN = 128;         // gleich public/production/limits.js, geprüft von tests/limits.test.mjs
export const MAX_GRUPPEN = 16;         // 1.10 (F1: eigene Plätze neben den 128 Spuren), 16 since nested groups; gleich limits.js
// 1.10 slice 3: returns (own strips next to the 16 groups); equal to public/production/limits.js, checked by tests/limits.test.mjs
export const MAX_RETURNS = 8;   // equal to public/production/limits.js, checked by tests/limits.test.mjs
export const PLAETZE = 4, MAX_STROEME = 16;
// 1.10 slice 4: insert chain per strip (track, group, return, master). The pool sizes equal the generated contract (insert_key.ts),
// pinned by tests/projekt_inserts.test.mjs. `komp` (4a), `eq`, `saett` and `lim` (4b) and `utility` (arr-fx) are accepted
// (INSERT_ARTEN_AKTIV); the sizes of eq and
// saett were decided by the cost measurement (T11, docs/architecture/stand/routing-1-10.md) and live in the contract only: these constants are read from it.
export const MAX_INSERTS_PRO_STRANG = 5;
export const MAX_INS_KOMP = INSERT_ARTEN.komp.instanzen;
export const MAX_INS_EQ = INSERT_ARTEN.eq.instanzen;
export const MAX_INS_SAETT = INSERT_ARTEN.saett.instanzen;
export const MAX_INS_LIM = INSERT_ARTEN.lim.instanzen;
export const MAX_INS_UTIL = INSERT_ARTEN.utility.instanzen;   // arr-fx slice 1
export const MAX_INS_BK = INSERT_ARTEN.bk.instanzen;   // arr-bk slice 3: Baukasten effect stages
export const MAX_INS_GATE = INSERT_ARTEN.gate.instanzen;   // pool slice 4: noise gate stages
export const MAX_INS_MB = INSERT_ARTEN.mb.instanzen;   // pool slice 4: three-band compressor stages
export const MAX_INS_TRANS = INSERT_ARTEN.trans.instanzen;   // strand 5 slice 3: transient shaper stages
export const MAX_INS_BILD = INSERT_ARTEN.bild.instanzen;   // strand 5 slice 3: three-band imager stages
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
export const TAKTART_ZAEHLER_MIN = 2;   // meter [n, 4]: beats per bar (plan production, Task 13); the denominator is always 4
export const TAKTART_ZAEHLER_MAX = 12;
export const taktartOk = (t: unknown): boolean => Array.isArray(t) && t.length === 2 && Number.isInteger(t[0]) && t[0] >= TAKTART_ZAEHLER_MIN
  && t[0] <= TAKTART_ZAEHLER_MAX && t[1] === 4;
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
// tracker effect commands (task 14): pitch and level events of a playback after unrolling, all bk tracks together; equal ARR_FX_PUNKTE_MAX in the core
export const MAX_FX_PUNKTE = 65536;
// gesperrt (slice 2, E4): only `true` is ever written; an unlocked lane has no key, so slice 1 projects stay byte for byte the same
// 1.12 slice 6: a lane may also drive a parameter of an insert stage (`insert.<stage id>.<param>`, the parameter name as in `Insert.werte`, a continuous one)
// or a macro of the rack of the strip (`rack.m1` .. `rack.m4`). Such a lane is stored on the strip that carries the stage or rack (a track, group,
// return or the master: `automation` exists on every strip); its value range is the parameter's own (macro: 0..1), its points are never `sprung`-only.
export type KettenZiel = `insert.${string}.${string}` | `rack.m${1 | 2 | 3 | 4}`;
// Live modules (decision 7): `blend:<group id>` is the blend lane of a stem group (value 0..1, only on that group). The playback expands it into
// the fader lanes of the two tracks of the group (blendFader); the core never sees the target.
export type BlendZiel = `blend:${string}`;
// Send automation: `send.<return id>` is the level of an EXISTING send of a track into that return (dB, the range of send_setzen). Ids never contain a
// dot, so the target is unambiguous; the playback writes it as `send.<return number>` (the core's names send.1 .. send.8, never a project target).
export type SendZiel = `send.${string}`;
// Strand 2 slice 1: `plugin.<stage id>.<index>` is parameter <index> of the plugin in a host stage of the same strip (value 0..1, normalized). The lane
// is project data only: the translator never writes it (it matches no chain target) and a server-side player sends it to the host.
export type PluginZiel = `plugin.${string}.${number}`;
// Strand 6: project-level modulators (LFO; envelope follower from slice 3). A modulator adds an offset to the value a target plays today (base value,
// controller, hand, lanes); the core evaluates it (D1, D3). Top-level key `modulatoren` of /3, absent when empty (old projects stay byte for byte).
// `ziel` is a lane target string valid on the strip `strang_id`; `tiefe` is in the unit of the target (MOD_TIEFE). The check is modulatorenPruefung.
export interface ModZiel { strang_id: string; ziel: string; tiefe: number; polaritaet?: 'uni' }
export interface Modulator {
  id: string;                 // neueId(p, 'mod'): 'm1', 'm2', ...
  nr: number;                 // 1..MAX_MODULATOREN, stable core slot (D11): the lowest free number at creation
  name?: string;              // 1..MOD_NAME_MAX chars
  art: 'lfo' | 'folger';
  form?: ModForm;             // lfo, default 'sinus'
  takt?: number;              // lfo, beats per period, 1/64..256 (exclusive with hz; default 4)
  hz?: number;                // lfo, free rate 0.01..40
  phase?: number;             // 0 <= phase < 1 (the core reads [0, 1)), default 0
  quelle?: string;            // folger: a track id (slice 3)
  angriff_ms?: number;        // folger 0.1..500, default 5
  abfall_ms?: number;         // folger 1..5000, default 150
  empfindlich_db?: number;    // folger -24..24, default 0
  glatt_ms?: number;          // 0..500, default 1
  an?: false;                 // only false is written
  ziele: ModZiel[];           // 1..MAX_MOD_ZIELE
}
export const MAX_MODULATOREN = 16, MAX_MOD_ZIELE = 8, MAX_MOD_FELDER = 32;   // = ARR_MODS, ARR_MOD_ZIELE, ARR_MOD_FELDER in arr_playback.h
export const MOD_FORMEN = ['sinus', 'dreieck', 'saege', 'rechteck', 'zufall'] as const;   // = lfo.rs shapes 0..4
export type ModForm = typeof MOD_FORMEN[number];
export const MOD_NAME_MAX = 32;
export const MOD_TAKT_MIN = 1 / 64, MOD_TAKT_MAX = 256, MOD_HZ_MIN = 0.01, MOD_HZ_MAX = 40, MOD_GLATT_MAX = 500;
export const MOD_TAKT_VORGABE = 4;
// envelope follower (slice 3, D12): attack and release in ms, sensitivity in dB; absent = the default, the translator writes it
export const MOD_ANGRIFF_MIN = 0.1, MOD_ANGRIFF_MAX = 500, MOD_ABFALL_MIN = 1, MOD_ABFALL_MAX = 5000, MOD_EMPFINDLICH_MAX = 24;
export const MOD_ANGRIFF_VORGABE = 5, MOD_ABFALL_VORGABE = 150, MOD_EMPFINDLICH_VORGABE = 0;
/** the fields only one kind of modulator carries (the other kind refuses them; mod_aendern drops them when the kind changes) */
export const MOD_FELDER_NUR = { lfo: ['form', 'takt', 'hz', 'phase'], folger: ['quelle', 'angriff_ms', 'abfall_ms', 'empfindlich_db'] } as const;
// depth range per target kind (D6): fader and send in dB, pan in pan units, every other kind a signed fraction of the target's range
export const MOD_TIEFE = {
  fader: [-24, 24], pan: [-1, 1], geraet: [-1, 1], send: [-24, 24], insert: [-1, 1], rack: [-1, 1], plugin: [-1, 1],
} as const satisfies Record<string, readonly [number, number]>;
/** the depth range of a modulation target, null = no modulation target kind */
export function modTiefeBereich(ziel: string): readonly [number, number] | null {
  if (ziel === 'fader' || ziel === 'pan') return MOD_TIEFE[ziel];
  const art = /^(geraet|send|insert|rack|plugin)\./.exec(ziel)?.[1] as keyof typeof MOD_TIEFE | undefined;
  return art ? MOD_TIEFE[art] : null;
}
export interface Lane { id: string; ziel: Ziel | KettenZiel | BlendZiel | SendZiel | PluginZiel; punkte: Punkt[]; gesperrt?: true }
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
// Halbtöne; Bungee rechnet 2 Oktaven (third_party/bungee/src/Timing.cpp:22, Plan Slice 5 D1); die Spec sagte 48. Nach unten nur
// −12 (D1, Andreas 2026-10-28):
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

// chance (1..99 percent), wdh (2..8 hits in the step), versatz (-95..95 without 0, percent of one sixteenth): optional, never written with their default
// spalte (2..8): the tracker note column of the note; absent = column 1 (1 is never written). Playback never reads it.
// platz (1..32, tracker task 19): the slot of a device with a slot role (spec 7); absent = the slot the knob stands on, never written with a default.
export interface Note {
  id: string; beat: number; laenge: number; ton: number; vel: number; chance?: number; wdh?: number; versatz?: number; spalte?: number; platz?: number;
}
// Row settings of a MIDI clip, per pitch (key = the pitch as a decimal string); an entry without any field does not exist
export interface Zeile { schritte?: number; swing?: number; richtung?: 'pendel' }
export const MAX_ZEILEN = 128;
// loop_beats (Spec 6.17): null oder fehlend = kein Loop; sonst wiederholt sich [0, loop_beats) bis laenge_beats (1/16 ≤ loop_beats ≤ laenge_beats)
export interface AudioClip {
  id: string; art: 'audio'; name: string; start_beat: number; laenge_beats: number; loop_beats?: number | null;
  stumm?: boolean;   // Slice 6 (D12): true = der Übersetzer lässt den Clip weg (Live und Export); fehlt = hörbar
  quelle: { sha256: string; pfad_hinweis: string }; dekodiert: DekodiertZustand;
  offset_s: number; gain_db: number; fade_ein_beats: number; fade_aus_beats: number;
  warp?: Warp | null;                                          // Paket 1.13 (nur /2): fehlt oder null = ohne Warp (das Verhalten von /1)
  entstehung?: Entstehung;                                     // S15 (nur /2): where a stream take came from; absent in every older file, never null
  audio_noten?: AudioNotenFeld;                                // note editor (/2 and /3 only): detected notes with pitch targets; absent when none, never null
  huellkurven?: Huellkurve[];                                  // 1.12 slice 5 (/2 only, D7): clip envelopes, absent when none (project/envelope.ts)
}
// naechste_noten_id am Clip: nur noch in Dateien des ersten S2int-Baus (Spec 6.28 Nachsatz zu 6.26); pruefeProjekt übernimmt ihn ins Projekt
export interface MidiClip {
  id: string; art: 'midi'; name: string; start_beat: number; laenge_beats: number; loop_beats?: number | null; naechste_noten_id?: number; noten: Note[];
  huellkurven?: Huellkurve[];                                  // 1.12 slice 5 (/2 only, D7): clip envelopes, absent when none
  muster?: MusterHerkunft;                                     // strudel-clip (/2 only): the Strudel pattern the notes were generated from; absent when none
  zeilen?: Record<string, Zeile>;                              // workbench row settings per pitch; absent when none
  seq?: SeqSicht;                                              // SEQ deck v2 (/2 only): view of the lanes in the SEQ place, no music, absent when none
  // tracker patterns (/2 only, ADR 039): clips of one track with the same value are linked copies; absent when unlinked
  verbund?: string;
  // tracker effect commands (/2 only, task 12): sorted by beat then column, one entry per (beat, column), never an empty list; absent when none
  fx?: FxEintrag[];
}
// beat: start of the row in clip beats (0 <= beat < laenge_beats when written; an entry behind a shortened clip stays and is silent, as a note is)
export const FX_CODES = ['ARP', 'SLU', 'SLD', 'GLD', 'VIB', 'TRM', 'VSL', 'LVL', 'RTG', 'PAN', 'OFS', 'REV'] as const;
export type FxEintrag = { beat: number; spalte: 0 | 1 | 2 | 3; code: string; wert: number };
export const FX_MAX_EINTRAEGE = 4096;
const FX_FELDER = ['beat', 'spalte', 'code', 'wert'];
/** The check of a stored `fx` list: non-empty, entries {beat, spalte, code, wert} sorted by beat then column, one per (beat, column). */
export function fxPruefung(x: unknown): { grund: 'fx_ungueltig'; text: string } | null {
  const ab = (text: string) => ({ grund: 'fx_ungueltig' as const, text });
  if (!Array.isArray(x) || x.length < 1 || x.length > FX_MAX_EINTRAEGE) return ab(`fx: a list of 1..${FX_MAX_EINTRAEGE} entries expected (absent when none)`);
  let vor: FxEintrag | null = null;
  for (let i = 0; i < x.length; i++) {
    const r = x[i];
    if (!istObjekt(r) || Object.keys(r).some((k) => !FX_FELDER.includes(k))) return ab(`fx[${i}]: entry {beat, spalte, code, wert} expected`);
    if (typeof r.beat !== 'number' || !Number.isFinite(r.beat) || r.beat < 0 || r.beat > MAX_BEAT) return ab(`fx[${i}].beat: number 0..${MAX_BEAT} expected`);
    if (!Number.isInteger(r.spalte) || (r.spalte as number) < 0 || (r.spalte as number) > 3) return ab(`fx[${i}].spalte: 0..3 expected`);
    if (typeof r.code !== 'string' || !(FX_CODES as readonly string[]).includes(r.code)) return ab(`fx[${i}].code: one of ${FX_CODES.join(' ')} expected`);
    if (!Number.isInteger(r.wert) || (r.wert as number) < 0 || (r.wert as number) > 255) return ab(`fx[${i}].wert: whole number 0..255 expected`);
    const e = r as unknown as FxEintrag;
    if (vor && (e.beat < vor.beat || (e.beat === vor.beat && e.spalte <= vor.spalte))) return ab(`fx[${i}]: entries sorted by beat then column, one per cell`);
    vor = e;
  }
  return null;
}
export const VERBUND_ID = /^v[0-9]{1,9}$/;
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
// D10 (strand 7): clips are AudioClip on an audio track, MidiClip on an instrument track (pruefeTake checks them against the track art)
export interface Take { id: string; name: string; art?: 'original'; clips: AudioClip[] | MidiClip[] }
// preset (1.16 rest, F8): the register id of the preset last applied (presets/preset_id.ts); not playback (spurSicht strips it), absent in older files
export interface InternGeraet { art: 'intern'; name: 'rb338'; parameter: Record<string, number>; preset?: string }
// Baukasten S20: an instrument graph of the kern's graph folder as the device; parameter holds the knobs k1..k64 that were set (absent = 0.5)
// Kraken patch field (task 4): `stifte` is the pin list of the graph's matrix block ([satz, zeile, spalte, wert], normal form of steckfeld.ts).
// Absent = the graph's own default pins play; present (also empty) replaces them entirely. Format /2 only, never on a rack member.
export interface BkGeraet { art: 'intern'; name: 'bk'; graph: string; parameter: Record<string, number>; preset?: string; stifte?: Stift[] }
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
  // nested groups: the group this one outputs into. Absent = master (never written for master, so a flat project file is unchanged).
  ausgang?: AusgangGruppe;
  // live modules (plan live-module, decision 15): the origin of a module group and its live slot; absent on every other group, never written then
  modul?: ModulHerkunft;   // placement is `Projekt.plaetze` (typ 'stems'), not a slot field
  blend?: number;   // 0..1 blend position of a module group; absent = not set, never written then
  neu_trim_db?: number;   // level offset of the new path against the original (dB, measured by the render after the MIDI); absent = 0
  // SEQ deck (spec 2026-11-14-seq-deck-design, project/seq.ts): the step document of a top group of the live container; absent on every other group,
  // never written then. Not playback: playback.ts does not read it. A group has this or `modul`, never both.
  seq?: SeqDeck;
  // loop deck (index 1.1, plan loop-deck M1): a top group of the live container that holds 4 audio tracks with 8 cells each; absent on every
  // other group, never written then. A group has this, `modul` or `seq`, never two of them.
  loopdeck?: LoopDeck;
  // strudel module (container core): the one top group of the live container whose members are `strom` tracks (one per stream); `{}` is the whole
  // marker. A group has this, `seq`, `loopdeck` or `modul`, never two of them.
  strudel?: Record<string, never>;
}
// Loop deck (two decks, 4 tracks of 8 cells each). Grid = the quantum a cell start waits for, in beats (LOOP_RASTER_BEATS).
export type LoopRaster = '1/4' | '1/2' | '1' | 'takt' | '4takte';
export const LOOP_RASTER_BEATS: Readonly<Record<LoopRaster, number>> = { '1/4': 0.25, '1/2': 0.5, '1': 1, takt: 4, '4takte': 16 };
export const LOOP_ZELLEN = 8, LOOP_SPUREN = 4, LOOP_FARBEN = 16, LOOP_MAX_FRAMES = 2_880_000;
// platz = the deck identity (LOOP 1, LOOP 2). The container the deck sounds in is `Projekt.plaetze` (typ 'loops'), a deck no place holds is parked.
export interface LoopDeck { platz: 1 | 2; raster: LoopRaster }
export interface Zelle {
  id: string; name: string; farbe: number; art: 'loop' | 'einmal'; sha256: string;
  beats?: number; bpm?: number; gain_db: number; pfad_hinweis?: string;
  raster?: LoopRaster;   // session view: this cell's own launch grid, wins over the global grid ('ende' comes in S2); absent = the global grid
  // session view S1b (index 2.1): the clip editor fields. All absent by default; the translator writes them only when present.
  transponieren?: number;   // semitones, integer -24..24, never 0; only art 'loop' with keylock on (nur_keylock otherwise)
  rueckwaerts?: true;       // play backwards
  blende?: true;            // fade at the launch onset and at the loop seam
  scheiben?: ZellScheiben;  // slot map: slot k starts at grenzen[k] (cell beats) and plays source slot folge[k] (1-based)
  keylock?: false;          // loop only: follows the tempo as re-pitch; absent = keylock on (true is never stored)
  huellen?: ZellHuelle[];   // at most 4, one per target; absolute values replace the control while the cell plays
}
export const ZELL_TEILUNGEN = ['1/16', '1/8', 'takt', 'transienten'] as const;
export interface ZellScheiben { teilung: (typeof ZELL_TEILUNGEN)[number]; grenzen: number[]; folge: number[] }
export type ZellZiel = 'gain' | 'filter' | 'send.hall' | 'send.delay';
export const ZELL_ZIELE: readonly ZellZiel[] = ['gain', 'filter', 'send.hall', 'send.delay'];
export interface ZellHuelle { ziel: ZellZiel; punkte: Punkt[] }
// the limits of the core loader (zell_map.h: ZELL_SCHEIBEN_MAX, ZELL_HUELLEN_MAX, ZELL_PUNKTE_MAX, ZELL_SLOT_MIN)
export const ZELL_SCHEIBEN_MAX = 64, ZELL_HUELLEN_MAX = 4, ZELL_PUNKTE_MAX = 64, ZELL_SLOT_MIN = 192, ZELL_TRANSPONIEREN_MAX = 24;
// the value range of an envelope target (the loader's: gain and sends dB, filter -1..1); undefined for a target a cell has no envelope for
export function ZELL_ZIEL_BEREICH(ziel: string): { min: number; max: number } | undefined {
  if (ziel === 'filter') return { min: -1, max: 1 };
  return ziel === 'gain' || ziel === 'send.hall' || ziel === 'send.delay' ? { min: -200, max: 0 } : undefined;
}
// A source slot or played slot must hold at least ZELL_SLOT_MIN frames after rounding; the model checks it with 2 frames of margin from the beats
// and the source tempo (frames = beats * 60 / bpm * 48000). The translator checks again with the decoded frames.
const ZELL_SLOT_RAND = 2;
// Everything the core loader refuses about the S1b fields of one cell, as { grund, text }, or null. Shared by the commands and the project check.
// Shape and range errors are argument_ungueltig; nur_keylock, scheiben_ungueltig and huelle_ungueltig are the named refusals (index 2.4).
export function zellFehler(z: Zelle): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  const r = z as unknown as Record<string, unknown>;
  const loop = z.art === 'loop';
  if ('keylock' in r && r.keylock !== false) return ab('argument_ungueltig', 'keylock: only false is stored (absent = keylock on)');
  if ('rueckwaerts' in r && r.rueckwaerts !== true) return ab('argument_ungueltig', 'rueckwaerts: true or absent');
  if ('blende' in r && r.blende !== true) return ab('argument_ungueltig', 'blende: true or absent');
  if ('transponieren' in r) {
    const t = r.transponieren;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < -ZELL_TRANSPONIEREN_MAX || t > ZELL_TRANSPONIEREN_MAX || t === 0) {
      return ab('argument_ungueltig', `transponieren: integer -${ZELL_TRANSPONIEREN_MAX}..${ZELL_TRANSPONIEREN_MAX} (not 0) expected`);
    }
    if (!loop || r.keylock === false) return ab('nur_keylock', 'transponieren needs a loop cell with keylock on');
  }
  if ('keylock' in r && !loop && !('transponieren' in r)) return ab('argument_ungueltig',
    'keylock: false applies to loop cells only (a one-shot plays unstretched)');
  const beats = typeof z.beats === 'number' ? z.beats : 0;
  if ('scheiben' in r) {
    const bad = (text: string) => ab('scheiben_ungueltig', text);
    const s = r.scheiben;
    if (!istObjekt(s) || Object.keys(s).some((k) => k !== 'teilung' && k !== 'grenzen' && k !== 'folge') || !('grenzen' in s) || !('folge' in s) ||
      !('teilung' in s)) {
      return bad('scheiben: {teilung, grenzen, folge} expected');
    }
    if (!(ZELL_TEILUNGEN as readonly unknown[]).includes(s.teilung)) return bad(`scheiben.teilung: ${ZELL_TEILUNGEN.join(' | ')} expected`);
    const g = s.grenzen, f = s.folge;
    if (!Array.isArray(g) || !Array.isArray(f) || g.length < 1 || g.length > ZELL_SCHEIBEN_MAX) return bad(`scheiben: 1..${ZELL_SCHEIBEN_MAX} slots expected`);
    if (!(beats > 0)) return bad('scheiben need the cell length: set beats first');
    if (f.length !== g.length) return bad('scheiben.folge: as many entries as grenzen expected');
    for (let i = 0; i < g.length; i++) {
      if (!zahl(g[i])) return bad(`scheiben.grenzen[${i}]: number expected`);
      if (i === 0 ? g[i] !== 0 : !(g[i] > g[i - 1])) return bad(i === 0 ?
        'scheiben.grenzen: the first boundary is 0' : `scheiben.grenzen[${i}]: rising expected`);
      if (!(g[i] < beats)) return bad(`scheiben.grenzen[${i}]: below the cell length (${beats} beats) expected`);
      if (!Number.isInteger(f[i]) || f[i] < 1 || f[i] > g.length) return bad(`scheiben.folge[${i}]: integer 1..${g.length} expected`);
    }
    if (typeof z.bpm === 'number') {
      const min = (ZELL_SLOT_MIN + ZELL_SLOT_RAND) * z.bpm / 60 / SAMPLERATE;   // beats of the shortest slot
      for (let i = 0; i < g.length; i++) {
        if ((i + 1 < g.length ? g[i + 1] : beats) - g[i] < min) return bad(`scheiben.grenzen[${i}]: slot shorter than ${ZELL_SLOT_MIN} frames at ${z.bpm} bpm`);
      }
    }
  }
  if ('huellen' in r) {
    const bad = (text: string) => ab('huelle_ungueltig', text);
    const h = r.huellen;
    if (!Array.isArray(h) || h.length < 1 ||
      h.length > ZELL_HUELLEN_MAX) return bad(`huellen: 1..${ZELL_HUELLEN_MAX} envelopes expected (absent when there are none)`);
    const gesehen = new Set<string>();
    for (let hi = 0; hi < h.length; hi++) {
      const e = h[hi] as unknown;
      if (!istObjekt(e) || Object.keys(e).some((k) => k !== 'ziel' && k !== 'punkte')) return bad(`huellen[${hi}]: {ziel, punkte} expected`);
      const bereich = typeof e.ziel === 'string' ? ZELL_ZIEL_BEREICH(e.ziel) : undefined;
      if (!bereich) return bad(`huellen[${hi}].ziel: ${ZELL_ZIELE.join(' | ')} expected`);
      if (gesehen.has(e.ziel as string)) return bad(`huellen[${hi}].ziel: one envelope per target (${e.ziel})`);
      gesehen.add(e.ziel as string);
      const pk = e.punkte;
      if (!Array.isArray(pk) || pk.length < 1 || pk.length > ZELL_PUNKTE_MAX) return bad(`huellen[${hi}].punkte: 1..${ZELL_PUNKTE_MAX} points expected`);
      if (!(beats > 0)) return bad('huellen need the cell length: set beats first');
      for (let i = 0; i < pk.length; i++) {
        const q = pk[i] as unknown, wp = `huellen[${hi}].punkte[${i}]`;
        if (!istObjekt(q) || Object.keys(q).some((k) => k !== 'beat' && k !== 'wert' && k !== 'form')) return bad(`${wp}: {beat, wert, form?} expected`);
        if (!zahl(q.beat) || q.beat < 0 || !(q.beat < beats)) return bad(`${wp}.beat: 0 up to the cell length (${beats} beats) expected`);
        if (!zahl(q.wert) || q.wert < bereich.min || q.wert > bereich.max) return bad(`${wp}.wert: number ${bereich.min}..${bereich.max} expected`);
        if ('form' in q && !(AUTO_FORMEN as readonly unknown[]).includes(q.form)) return bad(`${wp}.form: ${AUTO_FORMEN.join(' | ')} expected`);
        if (i > 0) {
          const v = pk[i - 1] as { beat: number };
          if (q.beat < v.beat) return bad(`${wp}.beat: rising expected`);
          if (i > 1 && q.beat === v.beat && q.beat === (pk[i - 2] as { beat: number }).beat) return bad(`${wp}.beat: at most two points at one beat`);
        }
      }
    }
  }
  return null;
}
// Session view (index 1.1). An empty slot that a scene leaves alone: `{ halten: true }` (D6). It is no cell: it has no id, no audio and never
// reaches the translator, the budget, the id counter or a loop set (a set stores it as null).
export type Halten = { halten: true };
export type ZellSlot = Zelle | null | Halten;
export const istHalten = (z: unknown): z is Halten => istObjekt(z) && Object.keys(z).length === 1 && z.halten === true;
// One scene = one row of the session grid (row i+1 = entry i). The list lives in Projekt.session, not Projekt.szenen (that name holds the SEQ mute images).
// Named SessionSzene because `Szene` below is the SEQ mute image (index 1.1 calls this interface `Szene`; the main instance decides on the rename).
export interface SessionSzene {
  id: string;      // neueId(p, 'szene'): sz<n>
  name: string;    // 0..32 characters
  farbe: number;   // 0..LOOP_FARBEN-1
  bpm?: number;    // TEMPO_MIN..TEMPO_MAX: launching the scene ramps the tempo here
  takte?: number;  // 1..SZENE_TAKTE_MAX, shown; used by follow actions in S5
  folge?: 'loop' | 'weiter' | 'stopp' | { sprung: number };   // stored and shown, runs in S5
}
export interface SessionEinstellung { raster: LoopRaster; szenen: SessionSzene[] }
export const SZENEN_ZEILEN = 8, SZENE_NAME_MAX = 32, SZENE_TAKTE_MAX = 256;
// Where a live module comes from: one loop of a deck rendering, split into stems. von_beat is on the beat axis of the rendering.
export interface ModulHerkunft {
  quelle_sha256: string; titel: string; fassung: string; basis_bpm: number; von_beat: number; laenge_beats: number;
  bpm: number; set?: string; datum: string;
  kuenstler?: string; tonart?: string;   // absent when the track has no tag or analysis (never written empty)
  id?: string;   // the store id, given once at export (project/module_storage.ts); absent on a group without origin id: the content hash is used
  eins_beat?: number;   // first downbeat of the rendering on its beat axis (bar phase of the source = (von_beat - eins_beat) mod 4); absent = 0
  quelle?: 'mitschnitt';   // DJ view places task 10: a recorded library loop (no catalogue origin; quelle_sha256 is the placeholder); absent otherwise
  transponiert?: number;   // task 11: semitones the module was adapted to the deck key (-12..12); absent = 0, never written at 0
}
// Hall of a return: all values normalised 0..1 (the mapping to units lives in the core and in the page); defaults = the stellwerk defaults
export interface ReturnHall { an: boolean; pre: number; decay: number; groesse: number; tief: number; highcut: number; fahne: number }
export const HALL_VORGABE: Readonly<ReturnHall> = { an: true, pre: 0.04, decay: 0.5252, groesse: 0.282, tief: 0.5658, highcut: 0.8039, fahne: 0.66667 };
export const HALL_FELDER = ['pre', 'decay', 'groesse', 'tief', 'highcut', 'fahne'] as const;
// 1.10 slice 4: one stage of the insert chain. `slot` = the pooled instance (ins/<art>/<slot>/*), unique per kind in the whole project and chosen by the
// project (lowest free). `werte` holds every parameter of the kind except the stage switch `an` and `sc` (real units, plugin ranges; the EQ band parameters are
// 'b1/freq' ... 'b8/platz', the band switch is 'b<m>/an'); `sc` (komp and eq only): 0 or absent = own signal, n = input of track number n.
// `bk` (arr-bk slice 3): a Baukasten effect graph as a stage; `graph` is its file name in the graph folder (an effect graph, one with an
// `eingang` node), `werte` the knobs k1..k64 (0..1).
export type InsertSorte = 'komp' | 'eq' | 'saett' | 'lim' | 'utility' | 'bk' | 'gate' | 'mb' | 'trans' | 'bild' | 'host';
// 1.10 slice 5 (plan E8): the sidechain key of a `komp` stage has two writers. A track `pre` key stays the field `sc` (4a, row `ins/komp/<slot>/sc`, a
// control).
// Every other source is structure: `key` {quelle, nr, punkt} (playback `chain[j].key`). A stage carries at most one of the two; `key` is never {spur, pre}.
// Strand 2 task 3.4: a host stage carries `key` too (never `sc`), when its plugin has 4 audio inputs (the key pair is inputs 3 and 4).
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
  regler?: (number | null)[];   // strand 2 task 2.2: host stages only, see MAX_PLUGIN_REGLER
}
export const INSERT_ARTEN_AKTIV: readonly InsertSorte[] = ['komp', 'eq', 'saett', 'lim', 'utility', 'bk', 'gate', 'mb', 'trans', 'bild'];
export const MAX_INS: Readonly<Record<string, number>> = {
  komp: MAX_INS_KOMP, eq: MAX_INS_EQ, saett: MAX_INS_SAETT, lim: MAX_INS_LIM, utility: MAX_INS_UTIL, bk: MAX_INS_BK,
  gate: MAX_INS_GATE, mb: MAX_INS_MB, trans: MAX_INS_TRANS, bild: MAX_INS_BILD, host: MAX_HOST,
};
export type InsertPoolArt = 'komp' | 'eq' | 'saett' | 'lim' | 'utility' | 'bk' | 'gate' | 'mb' | 'trans' | 'bild' | 'host';
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
  loopdeck?: ReturnLoopdeck;   // the HALL or DELAY return of a loop deck; only in a project with live: true, unique per (platz, art)
  strudel?: ReturnStrudel;     // the HALL or DELAY return of the strudel module; only with a strudel group, unique per art
  gruppe?: string;             // owner top group (D-M3); required for every return of a live project, absent otherwise
}
export interface ReturnStrudel { art: 'hall' | 'delay' }
// A return that belongs to a loop deck place and sounds inside that deck's DJ channel (the translator writes the DJ output for it)
export interface ReturnLoopdeck { platz: 1 | 2; art: 'hall' | 'delay' }
export const LOOP_SEND_MAX = 0;   // the send range of a loop deck track is -200..0 dB
export interface Master { fader_db: number; inserts?: Insert[]; rack?: Rack; automation?: Lane[] }
export interface Spur {
  id: string; von?: Herkunft; gruppe?: string; nr: number; name: string; farbe: string; art: 'audio' | 'instrument' | 'strom';
  strom?: number;   // 'strom' tracks: the stream 1..MAX_STROEME the track reads; unique, only inside the strudel group
  geraet?: Geraet; freeze?: Freeze | null; aufnahme?: SpurAufnahme; ausgang?: AusgangGruppe; automation?: Lane[]; takes?: Take[];
  midi?: MidiStufe;   // MIDI stage chain (instrument tracks, /2 only): written to the playback key `midi` while it has a stage and is not `aus`
  stammbaum?: Stammbaum;   // find sound: the family tree of a Baukasten track (instrument tracks only); project data, not playback (spurSicht omits it)
  fader_db: number; pan: number; mute: boolean; solo: boolean; clips: Clip[]; sends?: Send[]; inserts?: Insert[]; rack?: Rack;
  zellen?: ZellSlot[];   // loop deck: exactly LOOP_ZELLEN entries (a cell, null, or the slot { halten: true }); only on the audio tracks of a loopdeck group
  filter?: number;             // loop deck: -1..+1, absent = 0; same tracks as `zellen`
  eq?: Partial<Record<EqBand, number>>;     // loop deck: -200..+6 dB per band, absent band = 0; same tracks as `zellen`
  kill?: Partial<Record<EqBand, true>>;     // loop deck: a band that is killed (absent = off, never stored as false); same tracks as `zellen`
  // loop deck: the FX 1 2 3 (Remix) assignment, like the 1 2 3 keys of a mixer channel (absent = all off; the commands store only true); same tracks as
  // `zellen`
  fx?: Partial<Record<FxNr, boolean>>;
}
export type FxNr = '1' | '2' | '3';
export const FX_NUMMERN: readonly FxNr[] = ['1', '2', '3'];
// the core row value of the FX u key of a track (spur/<n>/fx/<u>, a switch 0/1)
export const fxZeilenWert = (s: { fx?: Partial<Record<FxNr, boolean>> } | undefined, u: FxNr): number => (s?.fx?.[u] ? 1 : 0);
// The 3-band isolator EQ of a loop deck track. A kill is model state; the one place it meets the core is the row value (the band's EQ row gets -200).
export type EqBand = 'tief' | 'mitte' | 'hoch';
export const EQ_BAENDER: readonly EqBand[] = ['tief', 'mitte', 'hoch'];
export const EQ_MIN = -200, EQ_MAX = 6;
export const eqZeilenWert = (s: { eq?: Partial<Record<EqBand, number>>; kill?: Partial<Record<EqBand, true>> } | undefined, b: EqBand): number =>
  (s?.kill?.[b] ? -200 : (s?.eq?.[b] ?? 0));
// naechste_id (Spec 6.26): Zähler je Art (spur, clip, gruppe); naechste_noten_id (Spec 6.28 Nachsatz zu 6.26): EIN Noten-Zähler für alle Clips.
// Alle steigen nur und stehen in keinem Patch, Undo und Redo setzen sie nicht zurück.
// The key of a project: the root as a pitch class (C = 0) and a scale name of public/harmonie.js SKALEN. View and editing help only, playback never reads it.
export interface Tonart { grundton: number; skala: string }
export const ARP_MUSTER = ['up', 'down', 'updown', 'downup', 'played', 'random', 'chord'] as const;
export type ArpMuster = typeof ARP_MUSTER[number];
/** Arp rate names of the project (note lengths), and their length in beats. */
export const ARP_RATEN = { '1/2': 2, '1/4': 1, '1/4t': 2 / 3, '1/8': 0.5, '1/8t': 1 / 3, '1/16': 0.25, '1/16t': 1 / 6, '1/32': 0.125 } as const;
export type ArpRate = keyof typeof ARP_RATEN;
/** The MIDI stage chain of an instrument track (Chord, Scale, Arp, Velocity, Chance in this order); every stage optional, `aus` bypasses the whole chain. */
export interface MidiStufe {
  aus?: true;
  akkord?: { intervalle: number[] };
  skala?: { quelle: 'projekt' } | { grundton: number; skala: string };
  arp?: { muster: ArpMuster; sync: true; rate: ArpRate; oktaven: 1 | 2 | 3 | 4; gate: number }
    | { muster: ArpMuster; sync: false; hz: number; oktaven: 1 | 2 | 3 | 4; gate: number };
  velocity?: { kurve: number; zufall: number; fest?: number };
  chance?: number;
  saat?: number;
}
/** One entry of the production harmony lane: from `beat` on the key is grundton + skala; `akkord` is the chord symbol shown on the lane (display only). */
export interface HarmonieEintrag { beat: number; grundton: number; skala: string; akkord?: string }
export interface Harmonie { eintraege: HarmonieEintrag[] }
export const HARMONIE_MAX = 512;

/** A named point on the arrangement timeline (project/marker.ts): stored sorted by beat, one per beat, ids m<n>. */
export interface Marker { id: string; beat: number; name: string; farbe?: number }
export interface AbgabeMeta { titel?: string; kuenstler?: string; album?: string; jahr?: number; genre?: string; isrc?: string }
export interface Projekt {
  format: typeof FORMAT; name: string; rev: number; wiedergabe_rev: number; tempo_bpm: number; taktart: [number, number];
  naechste_id?: { spur?: number; clip?: number; gruppe?: number; lane?: number; return?: number; insert?: number; take?: number; verbund?: number;
    zelle?: number; szene?: number; marker?: number; mod?: number };
  naechste_noten_id?: number;
  loop: { an: boolean; von_beat: number; bis_beat: number };
  metronom: { an: boolean; pegel_db: number; ziel: 'master' | 'cue' };
  aufnahme?: ProjektAufnahme;   // 1.8 S0 (D17): only in /2, written after the first aufnahme_setzen
  spuren: Spur[];
  gruppen: Gruppe[]; master: Master;   // 1.10 (P3): ab /2 Pflicht
  // 1.10 slice 3: only in /2 and only with at least one return (absent otherwise: projects without returns stay byte-identical)
  returns?: Return[];
  plaetze?: [Platz, Platz, Platz, Platz];   // live project: what sits in containers A..D; required iff live, absent otherwise
  baukasten?: BkKanal[];   // S17: sound snapshot (project/modular.ts), only in /2, absent when empty
  live?: true;             // the live container (plan live-module): the one project that runs during a DJ set; never written when absent
  tracker?: TrackerMarke;   // tracker view marker (project/tracker.ts): only in /2, never together with live or werkbank; never written when absent
  werkbank?: WerkbankMarke;   // loop workbench module (project/werkbank.ts): only in /2, never together with live; never written when absent
  // production harmony lane (plan strand 7, 5.1): only in /2, never empty, absent without a lane;
  // playback reads it only for tracks whose stage follows the project
  harmonie?: Harmonie;
  tonart?: Tonart;          // key of the project (public/harmonie.js): the note editors mark and fold by it; only in /2, absent without a key
  abgabe_meta?: AbgabeMeta;   // release metadata for the tags of delivery files (project/abgabe.ts): only in /2, never empty, absent when no field is set
  session?: SessionEinstellung;   // session view: global grid and the 8 scenes; only in a live project, written with the first session command
  marker?: Marker[];        // arrangement markers (project/marker.ts): current format /3, not in the live container, never empty; no part of the playback
  szenen?: (Szene | null)[];   // SEQ scenes (project/commands_szenen.ts): exactly SZENEN_SLOTS entries when present, absent until the first save; only in /2
  modulatoren?: Modulator[];   // strand 6: project-level modulators (commands_auto.ts mod_*), current format /3 only, never empty
}

// A SEQ scene: the pattern tracks (ids) that are ON and those that are OFF at the moment of saving. A pattern in neither list is left alone by a launch.
// What sits in a container of the live console. `gruppe` names the top group of the matching kind (strudel, seq, loopdeck, modul).
export type PlatzTyp = 'leer' | 'track' | 'strudel' | 'seq' | 'loops' | 'stems';
export type Platz = { typ: 'leer' } | { typ: 'track' } | { typ: 'strudel' | 'seq' | 'loops' | 'stems'; gruppe: string };
export const PLATZ_TYPEN: readonly PlatzTyp[] = ['leer', 'track', 'strudel', 'seq', 'loops', 'stems'];
export type Szene = { an: string[]; aus: string[] };
export const SZENEN_SLOTS = 8;

export const aufnahmeVon = (p: Projekt): ProjektAufnahme => p.aufnahme ?? structuredClone(AUFNAHME_VORGABE);

export const TAKE_ID = /^t[0-9]{1,15}$/;
export const ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;          // kein „/": Wiedergabe-Noten heißen <clip>/<note>
export const FARBE = /^#[0-9a-fA-F]{6}$/;
export const SHA = /^[0-9a-f]{64}$/;
// Parameter des RB-338 (Spec 2.4 und 6.4, aus rb_dsp::parameter::IDS). Alles andere lehnen Befehle als argument_unbekannt ab.
export const RB_PARAMETER: readonly string[] = ['lautstaerke', 'wellenform', 'cutoff', 'resonanz', 'env_mod', 'decay', 'accent'];
// Baukasten S20: a graph as the device of an instrument track. Knobs k1..k64 (0..1; absent = the graph's `vorgabe`). The graph name rule equals
// GRAPH_NAME in graphs.ts and kit_name_ok in the kern (pinned by tests/project_bk_device.test.mjs). MAX_BK_SPUREN equals ARR_BK_MAX in
// core/include/cypherdj/arr_playback.h (pinned by tests/project_bk_device.test.mjs, regex on the header; 8 until 2026-11-18).
export const BK_PARAMETER: readonly string[] = Array.from({ length: 64 }, (_, i) => `k${i + 1}`);
export const BK_KNOPF_VORGABE = 0.5;   // an untouched knob (the core plays 0.5 for a knob the playback does not name)
export const BK_GRAPH_NAME = /^[a-z0-9_-]{1,32}$/;
export const MAX_BK_SPUREN = 16;
// = SPUR_BK_SLOTS in core/signalbox/include/cypherdj/signalbox/controls.h (pinned by tests/project_bk_device.test.mjs): every bk track (MAX_BK_SPUREN)
// has the core rows spur/<slot>/bk/<k> (8 until 2026-11-21); a slot beyond it would be changed through the general path (a playback rebuild), see bkLive.
export const BK_LIVE_SLOTS = MAX_BK_SPUREN;
// Production plan task 9 (D10): the slot of a Baukasten track in the core rows spur/<slot>/bk/<k> is its running number among the tracks with the device bk,
// in ascending track number (nr), counted from 1, tracks only (a rack member does not count), by device name.
// The core derives the same number from the playback snapshot
// (Arrangement::tausche, bk_slot_; djk/core/tests/test_arr_bk_controls.cpp case 10 pins the same example). null: not a bk track or unknown id.
export function bkSlot(projekt: Projekt, spurId: string): number | null {
  const bk = projekt.spuren.filter((s) => s.geraet?.art === 'intern' && s.geraet.name === 'bk').sort((a, b) => a.nr - b.nr);
  const i = bk.findIndex((s) => s.id === spurId);
  return i < 0 ? null : i + 1;
}
// true: the track is a bk track whose slot has core rows spur/<slot>/bk/<k> (every bk track up to BK_LIVE_SLOTS), so a knob of it can move live.
export const bkLive = (projekt: Projekt, spurId: string): boolean => {
  const slot = bkSlot(projekt, spurId);
  return slot !== null && slot <= BK_LIVE_SLOTS;
};
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
export const zahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const ganz = (x: unknown): x is number => Number.isInteger(x);

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
