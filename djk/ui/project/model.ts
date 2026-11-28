// Projektmodell D1 (Spec docs/masterplan/D1-SPEC.md 3.3): project.json im Format cypherdj-projekt/2 (/1 wird beim Laden gehoben, 1.10 P3).
// Typen, Prüfung, Erzeugung, IDs.
// Reine Funktionen, keine Datei, kein Server. Die Prüfung ist geschlossen: ein unbekanntes Feld ist ein Fehler (Tippfehler sollen
// auffallen, die Version des Formats ist festgelegt; Erweiterungen bekommen die nächste Nummer).
// Paket 1.13: Audio-Clips dürfen in /2 einen Warp tragen (ein weiteres optionales Feld, keine neue Nummer); in /1 ist warp ein unbekanntes Feld.
import { SEGMENT_BPM_MAX, SEGMENT_BPM_MIN } from './warp.ts';
import type { Punkt } from './lane.ts';
import { BK_INSERT_OPTIONAL, BK_REGLER_MIN, BK_REGLER_ZAHL, bkInsertAuffuellen, pruefeBkListe, type BkKanal } from './modular.ts';
import { INSERT_ARTEN } from './insert_key.ts';
import { insertSpaeterAuffuellen, insertSpaeterNamen } from './insert_spaeter.ts';
import { SCHLUESSEL_DJ, SCHLUESSEL_NUR_ZEILE } from './key_table.ts';
import { ersterUngueltigerSchluessel } from './routing_verdict.ts';
import { huellkurvenPruefung, type Huellkurve } from './envelope.ts';
import { seqPruefung, seqSichtPruefung, type SeqDeck, type SeqSicht } from './seq.ts';   // seq.ts imports only types from this file: no runtime cycle
import { verbundPruefungSpur } from './verbund.ts';   // verbund.ts uses model.ts values only inside functions: the cycle is harmless at load
import { trackerPruefung, type TrackerMarke } from './tracker.ts';   // tracker.ts imports only a type from this file: no runtime cycle
import { werkbankPruefung, type WerkbankMarke } from './werkbank.ts';   // werkbank.ts imports only a type from this file: no runtime cycle
import { tonartFehler, SKALEN, akkordSymbol } from '../public/harmonie.js';
import { metaFehler } from './abgabe_meta.ts';
import { markerFehler } from './marker.ts';
import { audioNotenPruefung, type AudioNotenFeld } from './notes_contract.ts';   // note editor contract (plan A1): imports only node:crypto, no cycle
import { pruefeStammbaum, type Stammbaum } from './sound_runde_contract.ts';   // find sound: contract file, no imports of its own
import { PRESET_ID } from '../presets/preset_id.ts';   // 1.16 rest: zero-import file, keeps this module free of file access
import { stiftFehler, type Stift } from '../steckfeld.ts';   // Kraken patch field: zero-import file too
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
const standardSzene = (n: number): SessionSzene => ({ id: `sz${n}`, name: '', farbe: 0 });
// the eight scenes of a project: the stored ones, else eight defaults (name '', colour 0; ids sz1..sz8). Reading writes nothing.
export function sessionSzenen(p: Projekt | undefined): SessionSzene[] {
  return p?.session?.szenen ?? Array.from({ length: SZENEN_ZEILEN }, (_, i) => standardSzene(i + 1));
}
// the global launch grid: the stored one, else 'takt'
// Without a session block the grid is the one the loop decks already launch on (a project from before the session view), else takt.
export const sessionRaster = (p: Projekt): LoopRaster =>
  p.session?.raster ?? loopDeckGruppe(p, 1)?.loopdeck?.raster ?? loopDeckGruppe(p, 2)?.loopdeck?.raster ?? 'takt';
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

const TAKE_ID = /^t[0-9]{1,15}$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;          // kein „/": Wiedergabe-Noten heißen <clip>/<note>
const FARBE = /^#[0-9a-fA-F]{6}$/;
const SHA = /^[0-9a-f]{64}$/;
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
export function neueId(p: Projekt,
  art: 'spur' | 'clip' | 'gruppe' | 'lane' | 'return' | 'insert' | 'take' | 'verbund' | 'zelle' | 'szene' | 'marker' | 'mod'): string {
  if (art === 'szene') return neueSzenenId(p);
  if (art === 'marker') return neueMarkerId(p);
  if (art === 'mod') return neueModId(p);
  const praefix = art === 'spur' ? 's' : art === 'clip' ? 'c' : art === 'lane' ? 'a' : art === 'return' ? 'r'
    : art === 'insert' ? 'i' : art === 'take' ? 't' : art === 'verbund' ? 'v' : art === 'zelle' ? 'z' : 'g';
  const ids = art === 'spur' ? p.spuren.map((s) => s.id)
    : art === 'clip' ? alleClipIds(p)
      : art === 'take' ? p.spuren.flatMap((s) => (s.takes ?? []).map((t) => t.id))
        : art === 'zelle' ? alleZellenIds(p)
        : art === 'verbund' ? p.spuren.flatMap((s) => s.clips.flatMap((c) => (c.art === 'midi' && c.verbund !== undefined ? [c.verbund] : [])))
        : art === 'lane' ? alleStraenge(p).flatMap((x) => (x.strang.automation ?? []).map((l) => l.id))
          : art === 'return' ? (p.returns ?? []).map((r) => r.id)
            : art === 'insert' ? alleInserts(p).map((x) => x.insert.id) : (p.gruppen ?? []).map((g) => g.id);
  const lebend = hoechste(ids, praefix);
  const n = Math.max(p.naechste_id?.[art] ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, [art]: n + 1 };
  return `${praefix}${n}`;
}
// Scene ids sz<n> (session view): own two-letter prefix, so `hoechste` (one character) does not serve. Like the lane counter, naechste_id.szene
// arises with the first scene command; the defaults of sessionSzenen are sz1..sz8, so the first new id is sz9.
function neueSzenenId(p: Projekt): string {
  let lebend = 0;
  for (const s of sessionSzenen(p)) { const m = /^sz(\d+)$/.exec(s.id); if (m) lebend = Math.max(lebend, Number(m[1])); }
  const n = Math.max(p.naechste_id?.szene ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, szene: n + 1 };
  return `sz${n}`;
}
// Marker ids m<n>: the counter naechste_id.marker arises with the first marker; it never falls, so the id of a deleted marker does not come back.
function neueMarkerId(p: Projekt): string {
  const lebend = hoechste((p.marker ?? []).map((m) => m.id), 'm');
  const n = Math.max(p.naechste_id?.marker ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, marker: n + 1 };
  return `m${n}`;
}
// Strand 6: modulator ids m<n>, the same rule with their own counter naechste_id.mod (it arises with the first modulator and never falls)
function neueModId(p: Projekt): string {
  const lebend = hoechste((p.modulatoren ?? []).map((m) => m.id), 'm');
  const n = Math.max(p.naechste_id?.mod ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, mod: n + 1 };
  return `m${n}`;
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
    ...(z?.verbund !== undefined ? { verbund: z.verbund } : {}),   // tracker patterns: same, it arises with the first link
    ...(z?.zelle !== undefined ? { zelle: z.zelle } : {}),         // loop deck: same, it arises with the first cell
    ...(z?.szene !== undefined ? { szene: z.szene } : {}),         // session view: same, it arises with the first scene command
    ...(z?.marker !== undefined ? { marker: z.marker } : {}),      // arrangement markers: same, it arises with the first marker
    ...(z?.mod !== undefined ? { mod: z.mod } : {}),               // strand 6 modulators: same, it arises with the first modulator
  };
  if (p.naechste_noten_id === undefined) p.naechste_noten_id = notenZaehler(p);
}

// every filled cell of the project (all tracks)
export function* alleZellen(p: Projekt): Generator<Zelle> {
  for (const s of p.spuren) for (const z of s.zellen ?? []) if (z && !istHalten(z)) yield z;
}
// every cell id of the project (all tracks)
function alleZellenIds(p: Projekt): string[] {
  return p.spuren.flatMap((s) => (s.zellen ?? []).flatMap((z) => (z && !istHalten(z) ? [z.id] : [])));
}
// The loop deck group of a place (1 = deck A, 2 = deck B): the top group whose `loopdeck.platz` is `platz`
export function loopDeckGruppe(p: Projekt, platz: 1 | 2): Gruppe | null {
  return (p.gruppen ?? []).find((g) => g.loopdeck?.platz === platz && !g.ausgang) ?? null;
}
// The place (container 1..4 = A..D) a top group sits in; null = parked (a live top group no place holds) or no live project
export function platzVonGruppe(p: Projekt, gruppeId: string): 1 | 2 | 3 | 4 | null {
  const i = (p.plaetze ?? []).findIndex((x) => 'gruppe' in x && x.gruppe === gruppeId);
  return i < 0 ? null : (i + 1) as 1 | 2 | 3 | 4;
}
// The first place a new group may take without displacing anything: a `leer` or `track` place, scanning 3, 4, 1, 2 (the old defaults first); null = none free
export function ersterFreierPlatz(p: Projekt): 1 | 2 | 3 | 4 | null {
  for (const n of [3, 4, 1, 2] as const) { const t = p.plaetze?.[n - 1]?.typ; if (t === 'leer' || t === 'track') return n; }
  return null;
}
// The strudel group of the project (placed or parked), if any
export const strudelGruppe = (p: Projekt): Gruppe | null => (p.gruppen ?? []).find((g) => g.strudel !== undefined && !g.ausgang) ?? null;
// The strom track that reads stream `strom`, if any
export const stromSpur = (p: Projekt, strom: number): Spur | null => p.spuren.find((s) => s.art === 'strom' && s.strom === strom) ?? null;
// Live top groups that hold a deck, a module or the strudel marker but sit in no place (parked: silent, nothing deleted)
export function geparkteGruppen(p: Projekt): Gruppe[] {
  if (p.live !== true) return [];
  return (p.gruppen ?? []).filter((g) => !g.ausgang && (g.seq || g.loopdeck || g.modul || g.strudel) && platzVonGruppe(p, g.id) === null);
}
// The 4 tracks of a loop deck group in member order (the order of the track list)
export function loopDeckSpuren(p: Projekt, g: Gruppe): Spur[] {
  return p.spuren.filter((s) => s.ausgang?.id === g.id);
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
/** the pooled rows ins/<art>/<slot>/* of a stage with its values (komp 10, eq 86, saett 6, lim 3, utility 5): values first, the key (komp, eq),
 * the switch `an` LAST
 *  (a stage never sounds half set) */
export function insertZeilen(i: Insert): Record<string, number> {
  const r: Record<string, number> = {};
  const art = i.art as InsertPoolArt;
  for (const k of insertWertNamen(art)) r[`ins/${i.art}/${i.slot}/${k}`] = i.werte[k];
  if (art === 'komp' || art === 'eq') r[`ins/${i.art}/${i.slot}/sc`] = i.sc ?? 0;
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

export function sucheTakeClip(p: Projekt, clipId: string): { spur: Spur; take: Take; clip: Clip } | null {
  for (const spur of p.spuren) {
    for (const take of spur.takes ?? []) { const clip = (take.clips as Clip[]).find((c) => c.id === clipId); if (clip) return { spur, take, clip }; }
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
const SEND_ZIEL = /^send\.([A-Za-z][A-Za-z0-9_-]{0,31})$/;
export const istSendZiel = (z: unknown): z is SendZiel => typeof z === 'string' && SEND_ZIEL.test(z);
/** the return id a send target names, or null */
export const sendZielVon = (z: string): string | null => SEND_ZIEL.exec(z)?.[1] ?? null;
export const sendZielName = (returnId: string): SendZiel => `send.${returnId}`;
/** the dB range of a send lane = the range of send_setzen (-200 is silence) */
export const SEND_BEREICH: ZielBereich = { min: FADER_MIN, max: FADER_MAX, nurSprung: false };
/** the send lane targets a strip may be offered: one per send it has, in the order of the sends (by return number). The page lists exactly these. */
export const sendZiele = (strang: { sends?: Send[] }): SendZiel[] => (strang.sends ?? []).map((x) => sendZielName(x.id));
/** the range of a send target on this strip: it exists while the strip has a send into that return (null = it does not) */
export const sendZielBereich = (strang: { sends?: Send[] }, ziel: string): ZielBereich | null => {
  const id = sendZielVon(ziel);
  return id !== null && (strang.sends ?? []).some((x) => x.id === id) ? SEND_BEREICH : null;
};
// Strand 2 slice 1: a plugin parameter of a host stage. The index has no leading zeros, so one parameter has one target string.
const PLUGIN_ZIEL = /^plugin\.([A-Za-z][A-Za-z0-9_-]{0,31})\.(0|[1-9][0-9]{0,4})$/;   // equal public/production/lanes.js
export const istPluginZiel = (z: unknown): z is PluginZiel => typeof z === 'string' && PLUGIN_ZIEL.test(z);
/** a plugin target taken apart: the host stage id and the parameter index, or null */
export const pluginZielVon = (z: string): { insert: string; index: number } | null => {
  const m = PLUGIN_ZIEL.exec(z);
  return m ? { insert: m[1], index: Number(m[2]) } : null;
};
// per host stage; plugin lanes never reach the core, so ARR_KLANES_MAX does not bound them (plan strand 2 section 0.3). Equal public/production/lanes.js
export const MAX_PLUGIN_LANEN = 16;
export const PLUGIN_BEREICH: ZielBereich = { min: 0, max: 1, nurSprung: false };
/** the range of a plugin target on this strip: it exists while the strip carries a host stage of that id (null = it does not) */
export const pluginZielBereich = (strang: { inserts?: Insert[] }, ziel: string): ZielBereich | null => {
  const z = pluginZielVon(ziel);
  return z && (strang.inserts ?? []).some((x) => x.id === z.insert && x.art === 'host') ? PLUGIN_BEREICH : null;
};
/** the plugin lanes of a strip that drive the host stage `insertId` */
export const pluginLanen = (strang: { automation?: Lane[] }, insertId: string): Lane[] =>
  (strang.automation ?? []).filter((l) => pluginZielVon(l.ziel)?.insert === insertId);
/** the range of any lane target on a strip: a device target of the fixed table, or a chain, send or plugin target of this strip (null = does not exist) */
export function zielBereichVon(ziel: string, strang?: { inserts?: Insert[]; rack?: Rack; sends?: Send[] }): ZielBereich | null {
  if (Object.hasOwn(ZIEL_BEREICH, ziel)) return ZIEL_BEREICH[ziel as Ziel];
  if (istBlendZiel(ziel)) return BLEND_BEREICH;
  if (istSendZiel(ziel)) return strang ? sendZielBereich(strang, ziel) : null;
  if (istPluginZiel(ziel)) return strang ? pluginZielBereich(strang, ziel) : null;
  return strang ? kettenZielBereich(strang, ziel) : null;
}
export const istBlendZiel = (z: unknown): z is BlendZiel => typeof z === 'string' && z.startsWith('blend:') && ID.test(z.slice(6));
export const BLEND_BEREICH: ZielBereich = { min: 0, max: 1, nurSprung: false };
// Decision 7: the equal-power law of a blend value 0..1 as the two track faders in dB (0 = original 0 dB and new closed, 1 = the other way round,
// between them cos and sin); "closed" is -200 (the fader floor). `trim` is the level offset of the new path (Gruppe.neu_trim_db): the new fader at
// blend 1 sits at `trim`, so the new path is as loud as the original at 0 dB; the fader maximum caps it.
export const NEU_TRIM_MIN = -60, NEU_TRIM_MAX = 24;
export function blendFader(wert: number, trim = 0): { original: number; neu: number } {
  const w = Math.min(1, Math.max(0, wert)) * Math.PI / 2;
  const db = (x: number): number => (x < 1e-10 ? -200 : Math.max(-200, Math.round(20 * Math.log10(x) * 1e6) / 1e6));
  const neu = db(Math.sin(w));
  return { original: db(Math.cos(w)), neu: neu <= -200 ? -200 : Math.min(FADER_MAX, Math.max(-200, Math.round((neu + trim) * 1e6) / 1e6)) };
}
// the two tracks a stem group blends: its audio track (the original) and its instrument track (the new path); null while the group lacks either
export function blendPfad(p: { spuren: Spur[] }, gruppeId: string): { original: Spur; neu: Spur } | null {
  const kinder = p.spuren.filter((s) => s.ausgang?.id === gruppeId);
  const original = kinder.find((s) => s.art === 'audio'), neu = kinder.find((s) => s.art === 'instrument');
  return original && neu ? { original, neu } : null;
}
const kettenLanen_ = (st: { automation?: Lane[] }): number => (st.automation ?? []).filter((l) => istKettenZiel(l.ziel)).length;
/** the lanes of a strip that drive its chain or rack */
export const kettenLanen = (strang: { automation?: Lane[] }): Lane[] => (strang.automation ?? []).filter((l) => istKettenZiel(l.ziel));
// Prüfung einer Lane (Modell und Befehle teilen sie): null = gültig, sonst Grund (der Befehls-Grund) und Text.
// `strang` (1.12 slice 6): the strip that carries the lane; a chain target needs it (the stage and its parameter are looked up there)
export function lanePruefung(l: unknown, strang?: { inserts?: Insert[]; rack?: Rack; sends?: Send[] }): { grund: string; text: string } | null {
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
  } else if (istBlendZiel(l.ziel)) {
    bereich = BLEND_BEREICH;
  } else if (istSendZiel(l.ziel)) {
    const b = strang ? sendZielBereich(strang, l.ziel) : null;
    if (!b) return ab('ziel_unbekannt', `lane.ziel: ${l.ziel}: this strip has no send into the return ${sendZielVon(l.ziel)}`);
    bereich = b;
  } else if (istPluginZiel(l.ziel)) {
    const b = strang ? pluginZielBereich(strang, l.ziel) : null;
    if (!b) return ab('ziel_unbekannt', `lane.ziel: ${l.ziel}: this strip has no host stage ${pluginZielVon(l.ziel)!.insert}`);
    bereich = b;
  } else if (!(AUTO_ZIELE as readonly unknown[]).includes(l.ziel)) {
    return ab('ziel_unbekannt',
      `lane.ziel: ${AUTO_ZIELE.join(' | ')} or insert.<id>.<param> or rack.m1..m4 or send.<return id> or plugin.<host stage id>.<index> expected`);
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

// MidiClip.zeilen: {"<pitch>": {schritte?: 1..128, swing?: 1..100, richtung?: "pendel"}}, at most MAX_ZEILEN entries, no entry without a field,
// never an empty object
function pruefeZeilen(x: unknown, wo: string): void {
  if (!istObjekt(x) || Array.isArray(x)) werfe(wo, 'object expected');
  const ks = Object.keys(x as object);
  if (ks.length < 1 || ks.length > MAX_ZEILEN) werfe(wo, `1..${MAX_ZEILEN} entries expected (absent when there are none)`);
  for (const k of ks) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(k) || Number(k) > 127) werfe(`${wo}.${k}`, 'pitch 0..127 as the key expected');
    const o = felder((x as Record<string, unknown>)[k], `${wo}.${k}`, [], ['schritte', 'swing', 'richtung']);
    if (Object.keys(o).length === 0) werfe(`${wo}.${k}`, 'an entry without a field does not exist');
    if ('schritte' in o) zahlIn(o.schritte, `${wo}.${k}.schritte`, 1, 128, true);
    if ('swing' in o) zahlIn(o.swing, `${wo}.${k}.swing`, 1, 100, true);
    if ('richtung' in o && o.richtung !== 'pendel') werfe(`${wo}.${k}.richtung`, '"pendel" expected');
  }
}

function pruefeNote(n: unknown, wo: string): Note {
  const o = felder(n, wo, ['id', 'beat', 'laenge', 'ton', 'vel'], ['chance', 'wdh', 'versatz', 'spalte', 'platz']);
  if ('spalte' in o) zahlIn(o.spalte, `${wo}.spalte`, 2, 8, true);
  if ('platz' in o) zahlIn(o.platz, `${wo}.platz`, 1, 32, true);
  if ('chance' in o) zahlIn(o.chance, `${wo}.chance`, 1, 99, true);
  if ('wdh' in o) zahlIn(o.wdh, `${wo}.wdh`, 2, 8, true);
  if ('versatz' in o) { zahlIn(o.versatz, `${wo}.versatz`, -95, 95, true); if (o.versatz === 0) werfe(`${wo}.versatz`,
    'whole number -95..95 without 0 expected'); }
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
    pruefeGeraet(m.geraet, `${w}.geraet`, neu2, true);
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
function pruefeGeraet(g: unknown, wo: string, neu2: boolean, imGlied = false): Geraet {
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
      const b = felder(g, wo, ['art', 'name', 'graph', 'parameter'], ['preset', 'stifte']);
      if ('preset' in b) presetIdIn(b.preset, `${wo}.preset`);
      if ('stifte' in b) {   // Kraken patch field: /2 only, a track device only (a rack member plays the graph defaults)
        if (!neu2) werfe(`${wo}.stifte`, `unbekanntes Feld (Steckfeld-Stifte gibt es erst ab ${FORMAT})`);
        if (imGlied) werfe(`${wo}.stifte`, 'pins are not stored on a rack member (it plays the graph default pins)');
        const f = stiftFehler(b.stifte);
        if (f !== null) werfe(`${wo}.stifte`, f);
      }
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
      ['loop_beats', 'warp', 'stumm', 'entstehung', 'huellkurven', 'audio_noten']);
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
    if ('audio_noten' in o) {                                   // note editor: like entstehung, /2 and /3 only (an older build refuses it as an unknown field)
      if (!warpErlaubt) werfe(`${wo}.audio_noten`, `unbekanntes Feld (audio_noten gibt es erst ab ${FORMAT_ALT2})`);
      const f = audioNotenPruefung(o.audio_noten);
      if (f) werfe(`${wo}.audio_noten`, f.text);
    }
    pruefeHuellkurven(o, wo, warpErlaubt, spur);
    return o as unknown as Clip;
  }
  const o = felder(c, wo, [...basis, 'noten'], ['loop_beats', 'naechste_noten_id', 'huellkurven', 'muster', 'seq', 'zeilen', 'verbund', 'fx']);
  if ('verbund' in o) {                                         // tracker patterns: /2 only, like seq
    if (!warpErlaubt) werfe(`${wo}.verbund`, `unknown field (verbund exists only from ${FORMAT} on)`);
    if (typeof o.verbund !== 'string' || !VERBUND_ID.test(o.verbund)) werfe(`${wo}.verbund`, 'v<1..9 digits> expected');
  }
  if ('fx' in o) {                                              // tracker effect commands: /2 only, like verbund
    if (!warpErlaubt) werfe(`${wo}.fx`, `unknown field (fx exists only from ${FORMAT} on)`);
    const f = fxPruefung(o.fx);
    if (f) werfe(`${wo}.fx`, f.text);
  }
  if ('zeilen' in o) pruefeZeilen(o.zeilen, `${wo}.zeilen`);
  if ('seq' in o) {                                             // SEQ view descriptor: like muster, /2 only
    if (!warpErlaubt) werfe(`${wo}.seq`, `unknown field (seq exists only from ${FORMAT} on)`);
    const f = seqSichtPruefung(o.seq);
    if (f) werfe(`${wo}.seq`, f.text);
  }
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
  if (art !== 'komp' && art !== 'eq' && art !== 'host') werfe(wo, 'unknown field (only the compressor, the EQ and a host stage have a key)');
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
  if ('regler' in o) pruefePluginRegler(o.regler, `${w}.regler`);
  if ('sc' in o) werfe(`${w}.sc`, 'unbekanntes Feld (nur der Kompressor hat einen Zeilenschlüssel)');
  if ('key' in o) pruefeSchluessel(o.key, `${w}.key`, 'host', false);   // strand 2 task 3.4: the plugin's inputs 3 and 4 (the command checks the index)
}
// strand 2 task 2.2: the knobs of a host stage. regler[m-1] is the plugin parameter index that knob m (core row plug/<slot>/k<m>) drives, null = knob m
// is free. At most MAX_PLUGIN_REGLER entries, no index twice, canonical form: never empty, never a trailing null (absent = no knobs, so an untouched
// stage keeps its bytes). The knob moves reach the plugin through the page server, never through the core.
export const MAX_PLUGIN_REGLER = 16;
export const MAX_PLUGIN_INDEX = 99999;
function pruefePluginRegler(x: unknown, wo: string): void {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_PLUGIN_REGLER) werfe(wo, `list of 1..${MAX_PLUGIN_REGLER} entries expected`);
  const arr = x as unknown[];
  if (arr[arr.length - 1] === null) werfe(wo, 'no trailing null (an unassigned last knob is left out)');
  const da = new Set<number>();
  arr.forEach((v, i) => {
    if (v === null) return;
    zahlIn(v, `${wo}[${i}]`, 0, MAX_PLUGIN_INDEX, true);
    if (da.has(v as number)) werfe(`${wo}[${i}]`, `index ${String(v)} has another knob already`);
    da.add(v as number);
  });
}

// 1.10 slice 4: the chain of a strip (only /2): a non-empty list of at most MAX_INSERTS_PRO_STRANG stages with closed fields. Uniqueness of IDs and
// slots over the whole project is checked in pruefeAlles.
function pruefeInserts(x: unknown, wo: string, erlaubt: boolean): Insert[] {
  if (!erlaubt) return werfe(wo, `unbekanntes Feld (Inserts gibt es erst ab ${FORMAT})`);
  if (!Array.isArray(x) || x.length < 1) return werfe(wo, 'nicht leere Liste erwartet (fehlt bei keiner Stufe)');
  if (x.length > MAX_INSERTS_PRO_STRANG) werfe(wo, `höchstens ${MAX_INSERTS_PRO_STRANG} Stufen`);
  x.forEach((ix, i) => {
    const w = `${wo}[${i}]`;
    const o = felder(ix, w, ['id', 'art', 'slot', 'an', 'werte'], ['sc', 'key', 'preset', 'plugin', 'zustand', 'latenz_extra', 'graph', 'regler']);
    if ('preset' in o) presetIdIn(o.preset, `${w}.preset`);
    if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${w}.id`, 'ID erwartet');
    if (o.art !== 'host' && !(INSERT_ARTEN_AKTIV as readonly unknown[]).includes(o.art)) {
      werfe(`${w}.art`, `${[...INSERT_ARTEN_AKTIV, 'host'].join(' | ')} erwartet`);
    }
    if (o.art === 'host') pruefeHostFelder(o, w);
    else for (const k of ['plugin', 'zustand', 'latenz_extra', 'regler']) if (k in o) werfe(`${w}.${k}`, 'unbekanntes Feld (nur eine Host-Stufe)');
    zahlIn(o.slot, `${w}.slot`, 1, MAX_INS[o.art as string], true);
    boolean(o.an, `${w}.an`);
    if (o.art === 'bk') {   // arr-bk: the graph is part of the stage
      if (typeof o.graph !== 'string' || !BK_GRAPH_NAME.test(o.graph)) werfe(`${w}.graph`, 'graph name expected ([a-z0-9_-], 1..32 characters)');
    } else if ('graph' in o) werfe(`${w}.graph`, 'unknown field (only a bk stage carries a graph)');
    const art = o.art as InsertPoolArt;
    if (art === 'host') { felder(o.werte, `${w}.werte`, []); return; }
    // a bk stage: k9..k64 are optional (an older project stores k1..k8 only, see modular.ts)
    const opt = art === 'bk' ? BK_INSERT_OPTIONAL : insertSpaeterNamen(art);   // bk k9..k64; eq dynamic bands and saett kurve/decke (insert_spaeter.ts)
    const ws = felder(o.werte, `${w}.werte`, insertWertNamen(art).filter((n) => !opt.includes(n)), [...opt]);
    for (const q of insertWertParameter(art)) if (q.name in ws) zahlIn(ws[q.name], `${w}.werte.${q.name}`, q.min, q.max, q.ganz);
    if ('sc' in o) {
      if (art !== 'komp' && art !== 'eq') werfe(`${w}.sc`, 'unbekanntes Feld (nur Kompressor und EQ haben einen Schlüssel)');
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
  const o = felder(g, wo, ['id', 'nr', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'hall'], ['pre', 'inserts', 'rack', 'automation', 'loopdeck',
    'strudel', 'gruppe']);
  if ('strudel' in o) {
    const l = felder(o.strudel, `${wo}.strudel`, ['art']);
    if (l.art !== 'hall' && l.art !== 'delay') werfe(`${wo}.strudel.art`, 'hall or delay expected');
    if ('loopdeck' in o) werfe(`${wo}.strudel`, 'a return belongs to a loop deck or to the strudel module, not both');
  }
  if ('gruppe' in o && (typeof o.gruppe !== 'string' || !ID.test(o.gruppe))) werfe(`${wo}.gruppe`, 'ID expected');
  if ('loopdeck' in o) {
    const l = felder(o.loopdeck, `${wo}.loopdeck`, ['platz', 'art']);
    if (l.platz !== 1 && l.platz !== 2) werfe(`${wo}.loopdeck.platz`, '1 or 2 expected');
    if (l.art !== 'hall' && l.art !== 'delay') werfe(`${wo}.loopdeck.art`, 'hall or delay expected');
  }
  if ('pre' in o && o.pre !== true) werfe(`${wo}.pre`, 'true erwartet (fehlt bei post)');
  if ('inserts' in o) pruefeInserts(o.inserts, `${wo}.inserts`, true);   // returns exist only in /2
  if ('rack' in o) pruefeRack(o.rack, `${wo}.rack`);
  // after the chain and rack checks: it looks them up
  if ('automation' in o) pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack }, undefined, 'return');
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

function pruefeTake(t: unknown, wo: string, warpErlaubt: boolean, spurArt = 'audio'): Take {
  const o = felder(t, wo, ['id', 'name', 'clips'], ['art']);
  if (typeof o.id !== 'string' || !TAKE_ID.test(o.id)) werfe(`${wo}.id`, 't<n> expected');
  text(o.name, `${wo}.name`, TAKE_NAME_MAX);
  if ('art' in o && o.art !== 'original') werfe(`${wo}.art`, "'original' expected");
  if (!Array.isArray(o.clips)) werfe(`${wo}.clips`, 'list expected');
  (o.clips as unknown[]).forEach((c, i) => pruefeClip(c, `${wo}.clips[${i}]`, spurArt, warpErlaubt));
  return o as unknown as Take;
}

// The lane list of a strip (a track, group, return or the master): not empty, at most MAX_LANES_PRO_SPUR, every lane valid on THIS strip, no target twice.
// slice 2 (E3, 1.12): geraet.* only on tracks whose device owns the parameter (`geraet`; slice 7: RB-338 or bk);
// 1.12 slice 6: a chain target needs its stage or rack on this strip, and the
// parameter of a stage a macro drives has one writer (the macro), so it takes no lane (param_gemappt)
// Return fader lane (return automation slice 2): a return also takes its own `fader` lane (the volume of the return strip); the master and a group take no
// volume curve and no other device target, only chain lanes (and a stem group its blend lane)
export type StrangArt = 'spur' | 'return' | 'gruppe' | 'master';
type LaneStrang = { inserts?: Insert[]; rack?: Rack; sends?: Send[] };
function pruefeLanen(automation: unknown, wo: string, strang: LaneStrang, geraet: unknown, art: StrangArt = 'spur'): void {
  const istSpur = art === 'spur';
  if (!Array.isArray(automation) || automation.length < 1) werfe(`${wo}.automation`, 'non-empty list expected (absent when there is no lane)');
  // plugin lanes never reach the core: they count against MAX_PLUGIN_LANEN per host stage (below), not against the strip's MAX_LANES_PRO_SPUR
  const kernLanen = (automation as unknown[]).filter((l) => !istPluginZiel((l as { ziel?: unknown } | null)?.ziel)).length;
  if (kernLanen > MAX_LANES_PRO_SPUR) werfe(`${wo}.automation`, `at most ${MAX_LANES_PRO_SPUR} lanes per track`);
  const ziele = new Set<unknown>();
  (automation as unknown[]).forEach((lx, i) => {
    const f = lanePruefung(lx, strang);
    if (f) werfe(`${wo}.automation[${i}]`, f.text);
    const ziel = (lx as Lane).ziel;
    if (istBlendZiel(ziel)) {
      if (istSpur || ziel !== `blend:${(strang as { id?: string }).id}`) {
        werfe(`${wo}.automation[${i}].ziel`, `${ziel}: only on the stem group it names (ziel_unbekannt)`);
      }
    } else if (!istSpur && !istKettenZiel(ziel) && !istPluginZiel(ziel) && !(art === 'return' && ziel === 'fader')) {   // (a send lane is a track's)
      werfe(`${wo}.automation[${i}].ziel`, ziel === 'fader'
        ? 'fader: the master and groups take no volume curve (ziel_unbekannt)'
        : `${ziel}: a group or master takes insert and rack lanes only, a return insert, rack and fader lanes (ziel_unbekannt)`);
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
  for (const st of strang.inserts ?? []) {
    if (st.art === 'host' && pluginLanen({ automation: automation as Lane[] }, st.id).length > MAX_PLUGIN_LANEN) {
      werfe(`${wo}.automation`, `at most ${MAX_PLUGIN_LANEN} plugin lanes per host stage (${st.id}, plugin_lanen_voll)`);
    }
  }
}

const SHA_HEX = /^[0-9a-f]{64}$/;
function loopRasterPruefen(x: unknown, wo: string): void {
  if (typeof x !== 'string' || !Object.hasOwn(LOOP_RASTER_BEATS, x)) werfe(wo, "'1/4', '1/2', '1', 'takt' or '4takte' expected");
}
// session settings: the global grid and exactly 8 scenes (row i+1 = entry i); ids unique
function pruefeSession(x: unknown): void {
  const o = felder(x, 'session', ['raster', 'szenen']);
  loopRasterPruefen(o.raster, 'session.raster');
  if (!Array.isArray(o.szenen) || o.szenen.length !== SZENEN_ZEILEN) werfe('session.szenen', `array of ${SZENEN_ZEILEN} scenes expected`);
  const ids = new Set<string>();
  (o.szenen as unknown[]).forEach((e, i) => {
    const wo = `session.szenen[${i}]`;
    const s = felder(e, wo, ['id', 'name', 'farbe'], ['bpm', 'takte', 'folge']);
    if (typeof s.id !== 'string' || !/^sz[1-9][0-9]{0,14}$/.test(s.id)) werfe(`${wo}.id`, 'sz<n> expected');
    if (ids.has(s.id)) werfe(`${wo}.id`, `duplicate (${s.id})`);
    ids.add(s.id);
    if (typeof s.name !== 'string' || s.name.length > SZENE_NAME_MAX) werfe(`${wo}.name`, `text 0..${SZENE_NAME_MAX} characters expected`);
    zahlIn(s.farbe, `${wo}.farbe`, 0, LOOP_FARBEN - 1, true);
    if ('bpm' in s) zahlIn(s.bpm, `${wo}.bpm`, TEMPO_MIN, TEMPO_MAX);
    if ('takte' in s) zahlIn(s.takte, `${wo}.takte`, 1, SZENE_TAKTE_MAX, true);
    if ('folge' in s) {
      const f = s.folge;
      if (f === 'loop' || f === 'weiter' || f === 'stopp') return;
      const sp = istObjekt(f) && Object.keys(f).length === 1 && 'sprung' in f ? f.sprung : undefined;
      if (!zahl(sp) || !ganz(sp) || sp < 1 || sp > SZENEN_ZEILEN) werfe(`${wo}.folge`, "'loop', 'weiter', 'stopp' or { sprung: 1..8 } expected");
    }
  });
}
// one cell of a loop deck track (the id is checked for uniqueness by pruefeAlles)
function pruefeZelle(x: unknown, wo: string): void {
  const o = felder(x, wo, ['id', 'name', 'farbe', 'art', 'sha256', 'gain_db'], ['beats', 'bpm', 'pfad_hinweis', 'raster', 'transponieren', 'rueckwaerts',
    'blende', 'scheiben', 'keylock', 'huellen']);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  text(o.name, `${wo}.name`, 64);
  if ((o.name as string).trim() === '') werfe(`${wo}.name`, 'a cell name of spaces only is not a name');
  zahlIn(o.farbe, `${wo}.farbe`, 0, LOOP_FARBEN - 1, true);
  if (o.art !== 'loop' && o.art !== 'einmal') werfe(`${wo}.art`, "'loop' or 'einmal' expected");
  if (typeof o.sha256 !== 'string' || !SHA_HEX.test(o.sha256)) werfe(`${wo}.sha256`, '64 hex characters expected');
  zahlIn(o.gain_db, `${wo}.gain_db`, -60, 12);
  if (o.art === 'loop') {
    if (!('beats' in o)) werfe(`${wo}.beats`, 'fehlt (a loop cell needs beats)');
    if (!('bpm' in o)) werfe(`${wo}.bpm`, 'fehlt (a loop cell needs bpm)');
  }
  if ('beats' in o) {
    const b = zahlIn(o.beats, `${wo}.beats`, 0.25, 64);
    if (!ganz(b * 4)) werfe(`${wo}.beats`, 'a multiple of 0.25 expected');
  }
  if ('bpm' in o) zahlIn(o.bpm, `${wo}.bpm`, TEMPO_MIN, TEMPO_MAX);
  if ('raster' in o) loopRasterPruefen(o.raster, `${wo}.raster`);
  const zf = zellFehler(o as unknown as Zelle);
  if (zf) werfe(wo, `${zf.grund}: ${zf.text}`);
  if ('pfad_hinweis' in o) {
    const h = text(o.pfad_hinweis, `${wo}.pfad_hinweis`, 1024);
    if (h.startsWith('/') || h.includes('\\') || h.includes('\0') || h.split('/').some((t) => t === '..' || t === '')) {
      werfe(`${wo}.pfad_hinweis`, 'a relative path without .. expected');
    }
  }
}
function pruefeZellen(x: unknown, wo: string): void {
  if (!Array.isArray(x) || x.length !== LOOP_ZELLEN) werfe(wo, `array of ${LOOP_ZELLEN} entries expected`);
  (x as unknown[]).forEach((z, i) => {
    if (z === null) return;
    if (istObjekt(z) && 'halten' in z) {   // the slot { halten: true } and nothing else
      if (!istHalten(z)) werfe(`${wo}[${i}]`, 'the slot is exactly { halten: true }');
      return;
    }
    pruefeZelle(z, `${wo}[${i}]`);
  });
}

// the first field of a track that only a loop deck track may carry, or null
const deckFeld = (s: Spur): string | null => (['zellen', 'filter', 'eq', 'kill', 'fx'] as const).find((k) => s[k] !== undefined) ?? null;

// MIDI stage of a track (plan strand 7, 3.3): every rule names its field
export function pruefeMidiStufe(x: unknown, wo: string): MidiStufe {
  const o = felder(x, wo, [], ['aus', 'akkord', 'skala', 'arp', 'velocity', 'chance', 'saat']);
  if ('aus' in o && o.aus !== true) werfe(`${wo}.aus`, 'true expected (absent when the chain is on)');
  if ('akkord' in o) {
    const a = felder(o.akkord, `${wo}.akkord`, ['intervalle']);
    const iv = a.intervalle;
    if (!Array.isArray(iv) || iv.length < 1 || iv.length > 6) werfe(`${wo}.akkord.intervalle`, '1..6 entries expected');
    (iv as unknown[]).forEach((v, i) => { zahlIn(v, `${wo}.akkord.intervalle[${i}]`, -24, 24, true);
      if (v === 0) werfe(`${wo}.akkord.intervalle[${i}]`, 'not 0 expected'); });
    if (new Set(iv as unknown[]).size !== (iv as unknown[]).length) werfe(`${wo}.akkord.intervalle`, 'distinct entries expected');
  }
  if ('skala' in o) {
    if (istObjekt(o.skala) && 'quelle' in o.skala) {
      const k = felder(o.skala, `${wo}.skala`, ['quelle']);
      if (k.quelle !== 'projekt') werfe(`${wo}.skala.quelle`, "'projekt' expected");
    } else {
      const k = felder(o.skala, `${wo}.skala`, ['grundton', 'skala']);
      zahlIn(k.grundton, `${wo}.skala.grundton`, 0, 11, true);
      if (typeof k.skala !== 'string' || !Object.hasOwn(SKALEN, k.skala)) werfe(`${wo}.skala.skala`, `one of ${Object.keys(SKALEN).join(', ')} expected`);
    }
  }
  if ('arp' in o) {
    const a0 = istObjekt(o.arp) ? o.arp : werfe(`${wo}.arp`, 'Objekt erwartet');
    if (a0.sync !== true && a0.sync !== false) werfe(`${wo}.arp.sync`, 'true/false expected');
    const a = felder(a0, `${wo}.arp`, ['muster', 'sync', 'oktaven', 'gate', a0.sync ? 'rate' : 'hz']);
    if (!(ARP_MUSTER as readonly unknown[]).includes(a.muster)) werfe(`${wo}.arp.muster`, `one of ${ARP_MUSTER.join(', ')} expected`);
    if (a.sync) { if (typeof a.rate !== 'string' || !Object.hasOwn(ARP_RATEN, a.rate))
      werfe(`${wo}.arp.rate`, `one of ${Object.keys(ARP_RATEN).join(', ')} expected`); }
    else zahlIn(a.hz, `${wo}.arp.hz`, 0.5, 40);
    zahlIn(a.oktaven, `${wo}.arp.oktaven`, 1, 4, true);
    zahlIn(a.gate, `${wo}.arp.gate`, 0.05, 1);
  }
  if ('velocity' in o) {
    const v = felder(o.velocity, `${wo}.velocity`, ['kurve', 'zufall'], ['fest']);
    zahlIn(v.kurve, `${wo}.velocity.kurve`, -1, 1); zahlIn(v.zufall, `${wo}.velocity.zufall`, 0, 64, true);
    if ('fest' in v) zahlIn(v.fest, `${wo}.velocity.fest`, 1, 127, true);
  }
  if ('chance' in o) zahlIn(o.chance, `${wo}.chance`, 0, 100, true);
  if ('saat' in o) zahlIn(o.saat, `${wo}.saat`, 0, 4294967295, true);
  return o as MidiStufe;
}
export function midiStufeFehler(x: unknown): string | null {
  try { pruefeMidiStufe(x, 'midi'); return null; } catch (e) { if (e instanceof Fehl) return e.message; throw e; }
}

// Production harmony lane (plan strand 7, 5.1): {eintraege: [{beat, grundton, skala, akkord?}]}, sorted by beat, one entry per beat, 1..HARMONIE_MAX.
export function harmonieFehler(x: unknown): string | null {
  if (!istObjekt(x)) return 'harmonie: object {eintraege} expected';
  for (const k of Object.keys(x)) if (k !== 'eintraege') return `harmonie.${k}: unknown field`;
  const e = x.eintraege;
  if (!Array.isArray(e)) return 'harmonie.eintraege: list expected';
  if (e.length < 1) return 'harmonie.eintraege: not empty expected (absent when there is no lane)';
  if (e.length > HARMONIE_MAX) return `harmonie.eintraege: at most ${HARMONIE_MAX} entries`;
  let vorher = -Infinity;
  for (let i = 0; i < e.length; i += 1) {
    const wo = `harmonie.eintraege[${i}]`, z: unknown = e[i];
    if (!istObjekt(z)) return `${wo}: object expected`;
    for (const k of Object.keys(z)) if (!['beat', 'grundton', 'skala', 'akkord'].includes(k)) return `${wo}.${k}: unknown field`;
    if (typeof z.beat !== 'number' || !Number.isFinite(z.beat) || z.beat < 0 || z.beat > MAX_BEAT) return `${wo}.beat: number 0..${MAX_BEAT} expected`;
    if (z.beat <= vorher) return `${wo}.beat: ascending beats, one entry per beat expected`;
    vorher = z.beat;
    const f = tonartFehler({ grundton: z.grundton, skala: z.skala });
    if (f) return `${wo}.${f.replace(/^tonart\.?/, '')}`;
    if ('akkord' in z) {
      if (typeof z.akkord !== 'string') return `${wo}.akkord: chord symbol text expected`;
      try { akkordSymbol(z.akkord); } catch (err) { return `${wo}.akkord: ${(err as Error).message.replace(/^akkord:\s*/, '')}`; }
    }
  }
  return null;
}

function pruefeSpur(s: unknown, wo: string, warpErlaubt: boolean): Spur {
  if (!istObjekt(s)) return werfe(wo, 'Objekt erwartet');
  const basis = ['id', 'nr', 'name', 'farbe', 'art', 'fader_db', 'pan', 'mute', 'solo', 'clips'];
  if (s.art !== 'audio' && s.art !== 'instrument' && s.art !== 'strom') werfe(`${wo}.art`, 'audio, instrument or strom expected');
  const o = s.art === 'strom'
    ? felder(s, wo, [...basis, 'strom'], ['von', 'gruppe', 'ausgang', 'automation', 'sends', 'inserts', 'rack', 'filter', 'eq', 'kill', 'fx'])
    : s.art === 'audio'
    ? felder(s, wo, basis, ['von', 'gruppe', 'aufnahme', 'ausgang', 'automation', 'sends', 'inserts', 'rack', 'takes', 'zellen', 'filter', 'eq', 'kill', 'fx'])
    : felder(s, wo, [...basis, 'geraet'], ['freeze', 'von', 'gruppe', 'ausgang', 'automation', 'sends', 'inserts', 'rack',
      'aufnahme', 'stammbaum', 'takes', 'midi']);
  if (s.art === 'strom') {
    zahlIn(o.strom, `${wo}.strom`, 1, MAX_STROEME, true);
    if (!Array.isArray(o.clips) || o.clips.length > 0) werfe(`${wo}.clips`, 'a strom track has no clips');
    if (!('ausgang' in o)) werfe(`${wo}.ausgang`, 'a strom track sits inside the strudel group');
  }
  if ('zellen' in o) pruefeZellen(o.zellen, `${wo}.zellen`);
  if ('filter' in o) zahlIn(o.filter, `${wo}.filter`, -1, 1);
  if ('eq' in o) {
    const e = istObjekt(o.eq) ? o.eq : werfe(`${wo}.eq`, 'Objekt erwartet');
    for (const k of Object.keys(e)) {
      if (!EQ_BAENDER.includes(k as EqBand)) werfe(`${wo}.eq.${k}`, 'unknown band');
      zahlIn(e[k], `${wo}.eq.${k}`, EQ_MIN, EQ_MAX);
    }
  }
  if ('kill' in o) {
    const e = istObjekt(o.kill) ? o.kill : werfe(`${wo}.kill`, 'Objekt erwartet');
    for (const k of Object.keys(e)) {
      if (!EQ_BAENDER.includes(k as EqBand)) werfe(`${wo}.kill.${k}`, 'unknown band');
      if (e[k] !== true) werfe(`${wo}.kill.${k}`, 'true expected');
    }
  }
  if ('fx' in o) {
    const e = istObjekt(o.fx) ? o.fx : werfe(`${wo}.fx`, 'Objekt erwartet');
    for (const k of Object.keys(e)) {
      if (!FX_NUMMERN.includes(k as FxNr)) werfe(`${wo}.fx.${k}`, 'unknown FX (1, 2, 3)');
      boolean(e[k], `${wo}.fx.${k}`);
    }
  }
  if ('midi' in o) { if (!warpErlaubt) werfe(`${wo}.midi`, `unknown field (midi stages exist only from ${FORMAT} on)`); pruefeMidiStufe(o.midi, `${wo}.midi`); }
  if ('stammbaum' in o) { const f = pruefeStammbaum(o.stammbaum, `${wo}.stammbaum`); if (f.length) werfe(`${wo}.stammbaum`, f[0]); }
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
    pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack; sends?: Send[] }, o.art === 'instrument' ? o.geraet : undefined);
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
    (o.takes as unknown[]).forEach((t, i) => pruefeTake(t, `${wo}.takes[${i}]`, warpErlaubt, o.art as string));
  }
  return o as unknown as Spur;
}

function pruefeModul(m: unknown, wo: string): void {
  const o = felder(m, wo, ['quelle_sha256', 'titel', 'fassung', 'basis_bpm', 'von_beat', 'laenge_beats', 'bpm', 'datum'],
    ['set', 'eins_beat', 'transponiert', 'kuenstler', 'tonart', 'id', 'quelle']);
  if ('quelle' in o && o.quelle !== 'mitschnitt') werfe(`${wo}.quelle`, "'mitschnitt' expected");
  if ('id' in o && (typeof o.id !== 'string' || !/^[0-9a-f]{16}$/.test(o.id))) werfe(`${wo}.id`, '16 hex characters expected');
  if ('transponiert' in o && (!ganz(o.transponiert) || o.transponiert < -12 || o.transponiert > 12 || o.transponiert === 0)) {
    werfe(`${wo}.transponiert`, 'integer -12..12 except 0 expected');
  }
  if ('eins_beat' in o) zahlIn(o.eins_beat, `${wo}.eins_beat`, -MAX_BEAT, MAX_BEAT);
  if (typeof o.quelle_sha256 !== 'string' || !SHA.test(o.quelle_sha256)) werfe(`${wo}.quelle_sha256`, 'sha256 (64 hex characters) expected');
  for (const k of ['titel', 'fassung', 'datum']) text(o[k], `${wo}.${k}`, 200);
  for (const k of ['kuenstler', 'tonart']) if (k in o) text(o[k], `${wo}.${k}`, 200);
  if ('set' in o) text(o.set, `${wo}.set`, 200);
  zahlIn(o.basis_bpm, `${wo}.basis_bpm`, 1, 1000); zahlIn(o.bpm, `${wo}.bpm`, 1, 1000);
  zahlIn(o.von_beat, `${wo}.von_beat`, 0, MAX_BEAT);
  if (!zahl(o.laenge_beats) || o.laenge_beats <= 0 || o.laenge_beats > MAX_BEAT) {
    werfe(`${wo}.laenge_beats`, `number above 0 up to ${MAX_BEAT} expected`);
  }
}

// The check of a module record as a message (null = fine), for the command modul_setzen
export function pruefeModulFehler(m: unknown): string | null {
  try { pruefeModul(m, 'modul'); return null; } catch (e) { if (e instanceof Fehl) return e.message; throw e; }
}

function pruefeGruppe(g: unknown, wo: string): Gruppe {
  const o = felder(g, wo, ['id', 'nr', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet'],
    ['sends', 'inserts', 'rack', 'automation', 'ausgang', 'modul', 'blend', 'neu_trim_db', 'seq', 'loopdeck', 'strudel']);
  if ('modul' in o) pruefeModul(o.modul, `${wo}.modul`);
  if ('strudel' in o) {
    felder(o.strudel, `${wo}.strudel`, []);
    for (const k of ['modul', 'seq', 'loopdeck']) if (k in o) werfe(`${wo}.strudel`,
      'a group holds a strudel marker, a loop deck, a module or a SEQ deck, not several');
    if ('ausgang' in o) werfe(`${wo}.strudel`, 'the strudel module sits on a top group, not on a nested one');
  }
  if ('loopdeck' in o) {
    const d = felder(o.loopdeck, `${wo}.loopdeck`, ['platz', 'raster']);
    if (d.platz !== 1 && d.platz !== 2) werfe(`${wo}.loopdeck.platz`, '1 or 2 expected');
    if (typeof d.raster !== 'string' || !Object.hasOwn(LOOP_RASTER_BEATS, d.raster)) {
      werfe(`${wo}.loopdeck.raster`, "'1/4', '1/2', '1', 'takt' or '4takte' expected");
    }
    if ('modul' in o) werfe(`${wo}.loopdeck`, 'a group holds a loop deck, a module or a SEQ deck, not several');
    if ('seq' in o) werfe(`${wo}.loopdeck`, 'a group holds a loop deck, a module or a SEQ deck, not several');
    if ('ausgang' in o) werfe(`${wo}.loopdeck`, 'a loop deck sits on a top group, not on a nested one');
  }
  if ('seq' in o) {
    const f = seqPruefung(o.seq);
    if (f) werfe(`${wo}.seq`, f.text);
    if ('modul' in o) werfe(`${wo}.seq`, 'a group holds a SEQ deck or a module, not both');
    if ('ausgang' in o) werfe(`${wo}.seq`, 'a SEQ deck sits on a top group, not on a nested one');
  }
  if ('blend' in o) zahlIn(o.blend, `${wo}.blend`, 0, 1);
  if ('neu_trim_db' in o) zahlIn(o.neu_trim_db, `${wo}.neu_trim_db`, NEU_TRIM_MIN, NEU_TRIM_MAX);
  if ('ausgang' in o) {   // master is never stored
    const au = felder(o.ausgang, `${wo}.ausgang`, ['art', 'id']);
    if (au.art !== 'gruppe') werfe(`${wo}.ausgang.art`, 'gruppe erwartet (master steht nie in der Datei)');
    if (typeof au.id !== 'string' || !ID.test(au.id)) werfe(`${wo}.ausgang.id`, 'ID erwartet');
  }
  if ('sends' in o) pruefeSends(o.sends, `${wo}.sends`, true);
  if ('inserts' in o) pruefeInserts(o.inserts, `${wo}.inserts`, true);
  if ('rack' in o) pruefeRack(o.rack, `${wo}.rack`);
  // after the chain and rack checks: it looks them up
  if ('automation' in o) pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack }, undefined, 'gruppe');
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
  for (const { strang } of alleStraenge(p)) {
    for (const i of strang.inserts ?? []) {
      if (i.art === 'bk') bkInsertAuffuellen(i.werte); else if (i.art !== 'host') insertSpaeterAuffuellen(i.art, i.werte);   // eq d1..d8, saett kurve/decke
    }
  }
}
// --- Upgrade /2 -> /3 -----------------------------------------------------------------------------------------------
const STANDARD_PLAETZE: readonly PlatzTyp[] = ['track', 'track', 'strudel', 'loops'];
const oberste = (gruppen: Gruppe[], id: string | undefined): Gruppe | undefined => {
  let g = gruppen.find((x) => x.id === id);
  for (let n = 0; g?.ausgang && n <= gruppen.length; n++) { const z = g.ausgang.id; g = gruppen.find((x) => x.id === z); }
  return g && !g.ausgang ? g : undefined;
};
/**
 * Lifts a /2 project to /3 in place (no rev step). The removed fields (seq.platz, loopdeck.ausgang_platz, modul.slot) are dropped; a live project
 * gets `plaetze` and `Return.gruppe` derived in this order, a place is claimed by the first claimant and a later claimant is parked, never dropped:
 * 1. a SEQ deck claims `seq.platz`; 2. a loop deck claims `ausgang_platz`, absent = deck 1 -> 3, deck 2 -> 4; 3. a module claims 3 for slot A and
 * 4 for slot B (no slot: parked); 4. unclaimed places take the default layout `track, track, strudel, loops` where that type is free (strudel
 * once, creating the empty STRUDEL group; loops only while no loops place exists, filled by a parked loop deck, else track); 5. return owners.
 * A production project only changes its format string.
 */
export function hebeAufDrei(p: Projekt): void {
  (p as unknown as { format: string }).format = FORMAT;
  const gruppen = p.gruppen ?? [];
  // read the removed fields first, then drop them
  const alt = new Map<string, { seq?: number; ort?: number; slot?: 'A' | 'B' }>();
  for (const g of gruppen) {
    const e: { seq?: number; ort?: number; slot?: 'A' | 'B' } = {};
    if (istObjekt(g.seq)) { e.seq = (g.seq as { platz?: number }).platz; delete (g.seq as { platz?: number }).platz; }
    if (istObjekt(g.loopdeck)) { e.ort = (g.loopdeck as { ausgang_platz?: number }).ausgang_platz;
      delete (g.loopdeck as { ausgang_platz?: number }).ausgang_platz; }
    if (istObjekt(g.modul)) { e.slot = (g.modul as { slot?: 'A' | 'B' }).slot; delete (g.modul as { slot?: string }).slot; }
    alt.set(g.id, e);
  }
  if (p.live !== true) return;
  const spitzen = gruppen.filter((g) => !g.ausgang);
  const plaetze: (Platz | null)[] = [null, null, null, null];
  const belege = (i: number | undefined, platz: Platz): boolean => {
    if (i === undefined || !Number.isInteger(i) || i < 1 || i > PLAETZE || plaetze[i - 1] !== null) return false;
    plaetze[i - 1] = platz; return true;
  };
  for (const g of spitzen) if (g.seq) belege(alt.get(g.id)?.seq, { typ: 'seq', gruppe: g.id });
  for (const g of spitzen) if (g.loopdeck) belege(alt.get(g.id)?.ort ?? (g.loopdeck.platz === 1 ? 3 : 4), { typ: 'loops', gruppe: g.id });
  for (const g of spitzen) if (g.modul) { const s = alt.get(g.id)?.slot; belege(s === 'A' ? 3 : s === 'B' ? 4 : undefined, { typ: 'stems', gruppe: g.id }); }
  const belegt = (g: Gruppe): boolean => plaetze.some((e) => e !== null && 'gruppe' in e && e.gruppe === g.id);
  const hatStrudel = (): boolean => gruppen.some((g) => g.strudel) || plaetze.some((e) => e?.typ === 'strudel');
  for (let i = 0; i < PLAETZE; i++) {
    if (plaetze[i] !== null) continue;
    const wunsch = STANDARD_PLAETZE[i];
    if (wunsch === 'strudel' && !hatStrudel() && gruppen.length < MAX_GRUPPEN) {
      const nrs = new Set(gruppen.map((g) => g.nr));
      let nr = 1; while (nrs.has(nr)) nr++;
      const id = neueId(p, 'gruppe');
      gruppen.push({ id, nr, name: 'STRUDEL', farbe: '#8a8f98', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false, strudel: {} });
      plaetze[i] = { typ: 'strudel', gruppe: id };
    } else if (wunsch === 'loops' && !plaetze.some((e) => e?.typ === 'loops')) {
      const frei = spitzen.filter((g) => g.loopdeck && !belegt(g)).sort((a, b) => a.loopdeck!.platz - b.loopdeck!.platz)[0];
      plaetze[i] = frei ? { typ: 'loops', gruppe: frei.id } : { typ: 'track' };
    } else plaetze[i] = { typ: 'track' };
  }
  p.gruppen = gruppen;
  p.plaetze = plaetze as [Platz, Platz, Platz, Platz];
  // return owners
  const returns = p.returns ?? [];
  if (!returns.length) return;
  const strudel = gruppen.find((g) => g.strudel);
  const platz1 = (p.plaetze[0] as { gruppe?: string }).gruppe;
  const standard = gruppen.find((g) => g.id === platz1) ?? strudel ?? [...spitzen].sort((a, b) => a.nr - b.nr)[0];
  const behalten: Return[] = [];
  const neue: Return[] = [];
  for (const r of returns) {
    if (r.loopdeck && !loopDeckGruppe(p, r.loopdeck.platz)) delete r.loopdeck;
    if (r.loopdeck) { r.gruppe = loopDeckGruppe(p, r.loopdeck.platz)!.id; behalten.push(r); continue; }
    const sender: string[] = [];   // top groups that send into the return, in group order
    const spitze = (id: string | undefined): string | undefined => oberste(gruppen, id)?.id;
    const sendet = new Set<string>();
    for (const s of p.spuren) if ((s.sends ?? []).some((x) => x.id === r.id)) { const o = spitze(s.ausgang?.id); if (o) sendet.add(o); }
    for (const g of gruppen) if ((g.sends ?? []).some((x) => x.id === r.id)) { const o = spitze(g.id); if (o) sendet.add(o); }
    for (const g of spitzen) if (sendet.has(g.id)) sender.push(g.id);
    if (sender.length === 0) {
      if (!r.inserts?.length && !r.rack || !standard) continue;   // nothing hears it and it holds nothing: dropped
      r.gruppe = standard.id; behalten.push(r); continue;
    }
    r.gruppe = sender[0]; behalten.push(r);
    for (const gid of sender.slice(1)) {
      const kopieR = structuredClone(r) as Return;
      delete kopieR.inserts; delete kopieR.rack; delete kopieR.automation;
      kopieR.id = ''; kopieR.gruppe = gid;
      kopieR.name = `${r.name} ${gruppen.find((g) => g.id === gid)!.name}`.slice(0, 80);
      neue.push(Object.assign(kopieR, { __von: r.id }) as Return);
    }
  }
  p.returns = behalten;
  if (behalten.length + neue.length > MAX_RETURNS) throw new Fehl('returns: returns_voll (the upgrade needs more than ' + MAX_RETURNS + ' returns)');
  for (const n of neue) {
    const von = (n as unknown as { __von: string }).__von;
    delete (n as unknown as { __von?: string }).__von;
    n.id = neueId({ ...p, returns: p.returns } as Projekt, 'return');
    p.naechste_id = { ...p.naechste_id, return: Number(n.id.slice(1)) + 1 };
    const nrs = new Set(p.returns!.map((q) => q.nr));
    let nr = 1; while (nrs.has(nr)) nr++;
    n.nr = nr;
    p.returns!.push(n);
    const umlenken = (x: { sends?: Send[] }): void => { for (const sd of x.sends ?? []) if (sd.id === von) sd.id = n.id; };
    for (const s of p.spuren) if (oberste(gruppen, s.ausgang?.id)?.id === n.gruppe) umlenken(s);
    for (const g of gruppen) if (oberste(gruppen, g.id)?.id === n.gruppe) umlenken(g);
  }
  if (neue.length) p.returns.sort((a, b) => a.nr - b.nr);
}

export function pruefeProjekt(x: unknown): { projekt: Projekt } | { fehler: string } {
  const fehler = pruefeFehler(x);
  if (fehler !== null) return { fehler };
  const p = structuredClone(x) as Projekt;
  // 1.10 (P3): /1 → /2, kein rev-Schritt. Paket 1.13: ein /1-Projekt hat keinen Warp (die Prüfung lehnt ihn dort ab), die Hebung setzt keinen
  if ((p as { format: string }).format === FORMAT_ALT) { p.format = FORMAT; p.gruppen = []; p.master = { fader_db: 0 }; }
  if ((p as { format: string }).format === FORMAT_ALT2) hebeAufDrei(p);   // container core: /2 -> /3, places derived, no rev step
  for (const s of p.spuren) for (const l of s.automation ?? []) normalisiereLane(l);   // slice 2 (E2): mute/solo points without form are sprung
  bkInsertWerteAuffuellen(p);                                                        // a bk stage of an older project: k9..k64 = 0.5
  for (const s of p.spuren) s.von = herkunft(s);                                     // Spec 6.22: fehlt von (älteres Projekt), gilt andreas
  uebernimmNotenZaehler(p);                                                          // Spec 6.28: alte Clip-Zähler ins Projekt
  entferneLeereTakes(p);                                                             // 1.14: an empty takes list is not written
  setzeFehlendeZaehler(p);                                                           // Spec 6.35: fehlende Zähler schon beim Öffnen
  return { projekt: p };
}

function pruefeSzenen(x: unknown): void {
  if (!Array.isArray(x) || x.length !== SZENEN_SLOTS) werfe('szenen', `array of ${SZENEN_SLOTS} entries expected`);
  (x as unknown[]).forEach((e, i) => {
    if (e === null) return;
    const o = felder(e, `szenen[${i}]`, ['an', 'aus']);
    for (const k of ['an', 'aus']) {
      const l = o[k];
      if (!Array.isArray(l) || l.some((id) => typeof id !== 'string' || id === '')) werfe(`szenen[${i}].${k}`, 'list of ids expected');
    }
  });
}

function pruefeAlles(x: unknown): void {
  // Format zuerst (Prüfung 2, C1): ein fremdes Format, auch eines mit gruppen und master, ist der Fehler „format“
  // und scheitert nicht an „unbekanntes Feld“.
  // Ein fehlendes Format bleibt Sache von `felder` („projekt.format: fehlt“).
  if (istObjekt(x) && 'format' in x && x.format !== FORMAT && x.format !== FORMAT_ALT2 && x.format !== FORMAT_ALT) {
    werfe('format', `${FORMAT}, ${FORMAT_ALT2} or ${FORMAT_ALT} expected`);
  }
  // a /2 file is checked as its lift: the /3 rules applied to a copy that hebeAufDrei changed (a /2 file never holds plaetze)
  if (istObjekt(x) && x.format === FORMAT_ALT2) {
    if ('plaetze' in x) werfe('plaetze', `unknown field (places exist only from ${FORMAT} on)`);
    const k = structuredClone(x) as unknown as Projekt;
    try { hebeAufDrei(k); } catch (e) {
      if (e instanceof Fehl) throw e;
      k.format = FORMAT;   // malformed input: let the /3 check name the problem
    }
    return pruefeAlles(k);
  }
  const neu2 = istObjekt(x) && x.format === FORMAT;   // /2 verlangt gruppen und master, /1 hat sie nicht
  const pflicht = ['format', 'name', 'rev', 'wiedergabe_rev', 'tempo_bpm', 'taktart', 'loop', 'metronom', 'spuren', ...(neu2 ? ['gruppen', 'master'] : [])];
  // returns, baukasten in /1: unknown field
  const nur2 = ['returns', 'baukasten', 'aufnahme', 'live', 'werkbank', 'tracker', 'tonart',
    'harmonie', 'abgabe_meta', 'marker', 'szenen', 'plaetze', 'session',
    'modulatoren'];
  const o = felder(x, 'projekt', pflicht, ['naechste_id', 'naechste_noten_id', ...(neu2 ? nur2 : [])]);
  if ('szenen' in o) pruefeSzenen(o.szenen);
  if ('session' in o) {
    if (o.live !== true) werfe('session', 'unknown field (the session settings exist only in the live container)');
    pruefeSession(o.session);
  }
  const tf = 'tonart' in o ? tonartFehler(o.tonart) : null;
  if (tf) werfe('tonart', tf.replace(/^tonart[.:]?\s*/, ''));
  const hf = 'harmonie' in o ? harmonieFehler(o.harmonie) : null;
  if (hf) throw new Fehl(hf);
  const mf = 'abgabe_meta' in o ? metaFehler(o.abgabe_meta) : null;
  if (mf) throw new Fehl(mf);
  if ('marker' in o) {
    const f = markerFehler(o.marker, MAX_BEAT);
    if (f) throw new Fehl(f);
    if (o.live === true) werfe('marker', 'unknown field (the live container has no markers)');
  }
  if ('live' in o && o.live !== true) werfe('live', 'true expected (absent when not a live container)');
  if ('plaetze' in o && o.live !== true) werfe('plaetze', 'unknown field (places exist only in the live container)');
  if (o.live === true && !('plaetze' in o)) werfe('plaetze', 'fehlt (a live project holds its four places)');
  if ('werkbank' in o) {
    const w = werkbankPruefung(o.werkbank);
    if (w) werfe('werkbank', w.text);
    if ('live' in o) werfe('werkbank', 'a workbench module is never the live container');
  }
  if ('tracker' in o) {
    const t = trackerPruefung(o.tracker);
    if (t) werfe('tracker', t.text);
    if ('live' in o) werfe('tracker', 'the live container has no tracker view');
    if ('werkbank' in o) werfe('tracker', 'a workbench module has no tracker view');
  }
  if ('naechste_noten_id' in o) zahlIn(o.naechste_noten_id, 'naechste_noten_id', 1, Number.MAX_SAFE_INTEGER, true);
  if ('naechste_id' in o) {
    const zaehler = ['spur', 'clip', 'gruppe', 'lane', 'return', 'insert', 'take', 'verbund', 'zelle', 'szene', 'marker', 'mod'];
    const z = felder(o.naechste_id, 'naechste_id', [], zaehler);
    for (const k of zaehler) {
      if (k in z) zahlIn(z[k], `naechste_id.${k}`, 1, Number.MAX_SAFE_INTEGER, true);
    }
  }
  text(o.name, 'name', 80);
  zahlIn(o.rev, 'rev', 0, Number.MAX_SAFE_INTEGER, true); zahlIn(o.wiedergabe_rev, 'wiedergabe_rev', 0, Number.MAX_SAFE_INTEGER, true);
  zahlIn(o.tempo_bpm, 'tempo_bpm', TEMPO_MIN, TEMPO_MAX);
  if (!taktartOk(o.taktart)) werfe('taktart', `[n, 4] with n = ${TAKTART_ZAEHLER_MIN}..${TAKTART_ZAEHLER_MAX} expected`);
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
      if (d?.art === 'intern' && d.name === 'bk' && ++bkSpuren > MAX_BK_SPUREN) werfe('spuren', `at most ${MAX_BK_SPUREN} Cypher Modular tracks (bk)`);
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
    const vf = verbundPruefungSpur(s);                       // tracker patterns: the members of one pattern on this track must be equal
    if (vf) werfe(`spuren[${i}].clips`, vf.text);
    (s.takes ?? []).forEach((t, k) => {                      // 1.14: take ids and take clip ids are project wide, take clips count against MAX_CLIPS
      if (takeIds.has(t.id)) werfe(`spuren[${i}].takes[${k}].id`, `duplicate (${t.id})`);
      takeIds.add(t.id);
      t.clips.forEach((c, m) => {
        if (clipIds.has(c.id)) werfe(`spuren[${i}].takes[${k}].clips[${m}].id`, `duplicate (${c.id})`);
        clipIds.add(c.id); clips++;
      });
    });
  });
  const gruppenIds = new Set<string>(), gruppenNrs = new Set<number>(), deckPlaetze = new Set<number>();
  if (neu2) {
    if (!Array.isArray(o.gruppen)) werfe('gruppen', 'Liste erwartet');
    if ((o.gruppen as unknown[]).length > MAX_GRUPPEN) werfe('gruppen', `höchstens ${MAX_GRUPPEN}`);
    (o.gruppen as unknown[]).forEach((gx, i) => {
      const g = pruefeGruppe(gx, `gruppen[${i}]`);
      if (gruppenIds.has(g.id)) werfe(`gruppen[${i}].id`, `doppelt (${g.id})`);
      if (gruppenNrs.has(g.nr)) werfe(`gruppen[${i}].nr`, `doppelt (${g.nr})`);
      gruppenIds.add(g.id); gruppenNrs.add(g.nr);
      laneZaehle(g, `gruppen[${i}]`);
      // the patterns are the tracks that output into the group
      if (g.seq && o.live !== true) werfe(`gruppen[${i}].seq`, 'a SEQ deck exists only in the live container');
      if (g.strudel && o.live !== true) werfe(`gruppen[${i}].strudel`, 'the strudel module exists only in the live container');
      if (g.strudel && (o.gruppen as unknown[]).slice(0, i).some((m) => (m as Gruppe).strudel)) werfe(`gruppen[${i}].strudel`,
        'strudel is unique: the project has one strudel group');
      if (g.loopdeck) {   // loop deck: live container only, one group per deck identity
        if (o.live !== true) werfe(`gruppen[${i}].loopdeck`, 'a loop deck exists only in the live container');
        if (deckPlaetze.has(g.loopdeck.platz)) werfe(`gruppen[${i}].loopdeck.platz`,
          `duplicate (${g.loopdeck.platz}): the project already holds this loop deck`);
        deckPlaetze.add(g.loopdeck.platz);
      }
    });
    // group targets: a known group, not itself, and the tree has no cycle
    const ziel = new Map<string, string>();
    (o.gruppen as Gruppe[]).forEach((g, i) => {
      if (!g.ausgang) return;
      if (!gruppenIds.has(g.ausgang.id)) werfe(`gruppen[${i}].ausgang.id`, `unbekannte Gruppe ${g.ausgang.id}`);
      if (g.ausgang.id === g.id) werfe(`gruppen[${i}].ausgang.id`, 'Zyklus: eine Gruppe kann nicht in sich selbst spielen (cycle)');
      ziel.set(g.id, g.ausgang.id);
    });
    (o.gruppen as Gruppe[]).forEach((g, i) => {
      for (let x = g.id, n = 0; ziel.has(x); x = ziel.get(x)!) {
        if (++n > ziel.size) werfe(`gruppen[${i}].ausgang`, 'Zyklus: die Gruppen bilden einen Kreis (cycle)');
      }
    });
    const ms = felder(o.master, 'master', ['fader_db'], ['inserts', 'rack', 'automation']);
    zahlIn(ms.fader_db, 'master.fader_db', FADER_MIN, FADER_MAX);
    if ('inserts' in ms) pruefeInserts(ms.inserts, 'master.inserts', true);
    if ('rack' in ms) pruefeRack(ms.rack, 'master.rack');
    if ('automation' in ms) pruefeLanen(ms.automation, 'master', ms as { inserts?: Insert[]; rack?: Rack }, undefined, 'master');
    laneZaehle(ms as { automation?: Lane[] }, 'master');
  }
  // loop deck: 4 audio member tracks without clips; cells and filter only on those tracks; cell ids unique over the project
  if (neu2) {
    (o.gruppen as Gruppe[]).forEach((g, i) => {
      if (!g.loopdeck) return;
      const mitglieder = (o.spuren as Spur[]).filter((s) => s.ausgang?.id === g.id);
      if (mitglieder.length !== LOOP_SPUREN || (o.gruppen as Gruppe[]).some((m) => m.ausgang?.id === g.id)) {
        werfe(`gruppen[${i}].loopdeck`, `a loop deck group has exactly ${LOOP_SPUREN} member tracks and no nested group`);
      }
      for (const s of mitglieder) {
        if (s.art !== 'audio') werfe(`gruppen[${i}].loopdeck`, `track ${s.id} is not an audio track`);
        if (s.clips.length > 0) werfe(`gruppen[${i}].loopdeck`, `track ${s.id} has clips: a loop deck track holds cells only`);
      }
    });
    const deckGruppen = new Set((o.gruppen as Gruppe[]).filter((g) => g.loopdeck).map((g) => g.id));
    (o.spuren as Spur[]).forEach((s, i) => {
      if (deckFeld(s) !== null && s.art !== 'strom' && !(s.ausgang && deckGruppen.has(s.ausgang.id))) {
        werfe(`spuren[${i}].${deckFeld(s)}`, 'only on a track of a loop deck group');
      }
    });
  } else {
    (o.spuren as Spur[]).forEach((s, i) => { if (deckFeld(s) !== null && s.art !== 'strom') werfe(`spuren[${i}].zellen`,
      'only on a track of a loop deck group'); });
  }
  const zellenIds = new Set<string>();
  (o.spuren as Spur[]).forEach((s, i) => (s.zellen ?? []).forEach((z, k) => {
    if (!z || istHalten(z)) return;
    if (zellenIds.has(z.id)) werfe(`spuren[${i}].zellen[${k}].id`, `duplicate (${z.id})`);
    zellenIds.add(z.id);
  }));
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
  // loop deck returns: only in the live container, one per (place, art), sends only from the track of the same deck
  {
    const loopRet = new Map<string, ReturnLoopdeck>();
    const gruppen = (o.gruppen ?? []) as Gruppe[];
    ((o.returns ?? []) as Return[]).forEach((r, i) => {
      if (!r.loopdeck) return;
      if (o.live !== true) werfe(`returns[${i}].loopdeck`, 'only in the live container');
      const k = `${r.loopdeck.platz}/${r.loopdeck.art}`;
      if (loopRet.has(k)) werfe(`returns[${i}].loopdeck`, `duplicate (place ${r.loopdeck.platz}, ${r.loopdeck.art})`);
      loopRet.set(r.id, r.loopdeck); loopRet.set(k, r.loopdeck);
    });
    const platzVon = (s: Spur): number | null => gruppen.find((g) => g.id === s.ausgang?.id)?.loopdeck?.platz ?? null;
    const pruefe = (liste: { sends?: Send[] }[], wo: string, platz: (e: never) => number | null): void => liste.forEach((e, i) =>
      (e.sends ?? []).forEach((sd, k) => {
        const l = loopRet.get(sd.id);
        if (l && platz(e as never) !== l.platz) werfe(`${wo}[${i}].sends[${k}]`, 'a loop deck return takes sends only from its own deck');
      }));
    pruefe(o.spuren as Spur[], 'spuren', platzVon as (e: never) => number | null);
    pruefe(gruppen, 'gruppen', () => null);
  }
  // container core: places, the strudel group, strom tracks and the owner of every return
  {
    const gruppen = (o.gruppen ?? []) as Gruppe[], spuren = o.spuren as Spur[], returns = (o.returns ?? []) as Return[];
    const top = new Map(gruppen.filter((g) => !g.ausgang).map((g) => [g.id, g] as const));
    const strudel = gruppen.find((g) => g.strudel);
    const stroeme = new Set<number>();
    spuren.forEach((s, i) => {
      if (s.art === 'strom') {
        if (stroeme.has(s.strom!)) werfe(`spuren[${i}].strom`, `duplicate (${s.strom})`);
        stroeme.add(s.strom!);
        if (!strudel || s.ausgang?.id !== strudel.id) werfe(`spuren[${i}].ausgang`, 'a strom track sits inside the strudel group');
      } else if (strudel && s.ausgang?.id === strudel.id) werfe(`spuren[${i}].ausgang`, 'the strudel group holds strom tracks only');
    });
    if (strudel) gruppen.forEach((g, i) => { if (g.ausgang?.id === strudel.id) werfe(`gruppen[${i}].ausgang`, 'the strudel group holds strom tracks only'); });
    if (o.live === true) {
      const pl = o.plaetze;
      if (!Array.isArray(pl) || pl.length !== PLAETZE) werfe('plaetze', `array of ${PLAETZE} entries expected`);
      const belegt = new Set<string>(), zaehl = { strudel: 0, loops: 0, stems: 0 };
      (pl as unknown[]).forEach((e, i) => {
        const wo = `plaetze[${i}]`;
        if (!istObjekt(e)) return werfe(wo, 'Objekt erwartet');
        if (!(PLATZ_TYPEN as readonly unknown[]).includes(e.typ)) werfe(`${wo}.typ`, `one of ${PLATZ_TYPEN.join(' | ')} expected`);
        if (e.typ === 'leer' || e.typ === 'track') { felder(e, wo, ['typ']); return; }
        felder(e, wo, ['typ', 'gruppe']);
        const g = typeof e.gruppe === 'string' ? top.get(e.gruppe) : undefined;
        if (!g) return werfe(`${wo}.gruppe`, `no top group ${String(e.gruppe)}`);
        const art = e.typ === 'strudel' ? g.strudel : e.typ === 'seq' ? g.seq : e.typ === 'loops' ? g.loopdeck : g.modul;
        if (!art) werfe(`${wo}.gruppe`, `group ${g.id} is not a ${e.typ as string} group`);
        if (belegt.has(g.id)) werfe(`${wo}.gruppe`, `group ${g.id} already sits in another place`);
        belegt.add(g.id);
        if (e.typ === 'strudel' && ++zaehl.strudel > 1) werfe(`${wo}.typ`, 'strudel is unique: one strudel place at most');
        if (e.typ === 'loops' && ++zaehl.loops > 2) werfe(`${wo}.typ`, 'at most two loops places (one per loop deck)');
        if (e.typ === 'stems' && ++zaehl.stems > 2) werfe(`${wo}.typ`, 'at most two stems places');
      });
    }
    const strRet = new Set<string>();
    returns.forEach((r, i) => {
      const wo = `returns[${i}]`;
      if (o.live === true) { if (r.gruppe === undefined) werfe(`${wo}.gruppe`, 'fehlt (owner top group of a live return)'); }
      else if (r.gruppe !== undefined) werfe(`${wo}.gruppe`, 'unknown field (only in the live container)');
      const eigner = r.gruppe === undefined ? undefined : top.get(r.gruppe);
      if (r.gruppe !== undefined && !eigner) werfe(`${wo}.gruppe`, `no top group ${r.gruppe}`);
      if (r.loopdeck && eigner?.loopdeck?.platz !== r.loopdeck.platz) werfe(`${wo}.gruppe`, `a loop deck return is owned by its loop deck ${r.loopdeck.platz}`);
      if (r.strudel) {
        if (!strudel) werfe(`${wo}.strudel`, 'only with a strudel group');
        if (strRet.has(r.strudel.art)) werfe(`${wo}.strudel`, `duplicate (${r.strudel.art})`);
        strRet.add(r.strudel.art);
        if (eigner !== strudel) werfe(`${wo}.gruppe`, 'a strudel return is owned by the strudel group');
      }
    });
  }
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
  // nested groups: a stage key must be valid for the group tree of this file (a retarget can invalidate it; the core refuses such a playback)
  const ungueltig = ersterUngueltigerSchluessel(o as unknown as Projekt, true);
  if (ungueltig) werfe(`${ungueltig.strangId}.inserts`, `${ungueltig.ablehnung.grund}: ${ungueltig.ablehnung.text}`);
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
  if ('modulatoren' in o) {   // strand 6: last, every strip and stage is checked by now
    const f = modulatorenPruefung(o.modulatoren, o as unknown as Projekt);
    if (f) werfe('modulatoren', `${f.text} (${f.grund})`);
  }
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
    nr: s.nr, art: s.art, ...(s.strom !== undefined ? { strom: s.strom } : {}), geraet: ohnePreset(s.geraet) ?? null,
    // MIDI stage: changes the notes the device plays (so it also drops a freeze); absent adds no key
    ...(s.midi ? { midi: s.midi } : {}),
      ...(mitFreeze ? { freeze: s.freeze ?? null } : {}),
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
    // loop deck cells: only what the snapshot is built from (sha, kind, beats, gain, the slot); a rename or a recolour is no new playback. Absent adds no key.
    // `filter` is a control row (spur/<n>/filter), not playback
    // S1b: the editor fields change the snapshot too (added only when present, so a cell without them keeps its view); bpm only where it stands in for a
    // missing beats
    ...(s.zellen ? { zellen: s.zellen.map((z) => (z && !istHalten(z)
      ? { sha256: z.sha256, art: z.art, beats: z.beats ?? null, gain_db: z.gain_db,
        ...(z.beats === undefined && z.bpm !== undefined && (z.scheiben || z.huellen) ? { bpm: z.bpm } : {}),
        ...(z.transponieren !== undefined ? { transponieren: z.transponieren } : {}), ...(z.rueckwaerts ? { rueckwaerts: true } : {}),
        ...(z.blende ? { blende: true } : {}), ...(z.keylock === false ? { keylock: false } : {}),
        ...(z.scheiben ? { scheiben: z.scheiben.grenzen.map((g, k) => [g, z.scheiben!.folge[k]]) } : {}),
        ...(z.huellen ? { huellen: z.huellen.map((h) => ({ ziel: h.ziel, punkte: h.punkte.map((q) => [q.beat, q.wert, q.form ?? 'linear']) })) } : {}) }
      : null)) } : {}),
    clips: s.clips.map((c) => (c.art === 'audio'
      ? { id: c.id, art: c.art, sha256: c.quelle.sha256, dekodiert: c.dekodiert, start_beat: c.start_beat, laenge_beats: c.laenge_beats,
        loop_beats: c.loop_beats ?? null, offset_s: c.offset_s, gain_db: c.gain_db, fade_ein_beats: c.fade_ein_beats, fade_aus_beats: c.fade_aus_beats,
        warp: c.warp?.an ? c.warp : null, ...(c.stumm ? { stumm: true } : {}) }   // Paket 1.13: ein Warp an ändert den Klang, ein Warp aus nicht
      : { id: c.id, art: c.art, start_beat: c.start_beat, laenge_beats: c.laenge_beats, loop_beats: c.loop_beats ?? null, noten: c.noten,
        ...(c.zeilen ? { zeilen: c.zeilen } : {}),   // row settings change the unrolling; absent: the view stays byte for byte the same
        ...(c.huellkurven?.some((h) => h.ziel === 'transpose') ? { transpose: c.huellkurven.find((h) => h.ziel === 'transpose') } : {}) })),
  };
}
// 1.12 slice 6: the lanes of a group, return or the master change the playback like those of a track (spurSicht); absent lanes add no key
const laneSicht = (st: { automation?: Lane[] }): { automation?: unknown } => st.automation?.length
  ? { automation: st.automation.map((l) => ({ ziel: l.ziel, punkte: l.punkte.map((q) => [q.beat, q.wert, q.form ?? 'linear']) })) } : {};
export const wiedergabeSicht = (p: Projekt): unknown => ({
  spuren: [...p.spuren].sort((a, b) => a.nr - b.nr).map((s) => spurSicht(s)),
  // a scale stage that follows the project key reads it: a key change is a new playback (only then; absent adds no key)
  ...(p.tonart && p.spuren.some((s) => s.midi?.skala && 'quelle' in s.midi.skala) ? { midi_tonart: p.tonart } : {}),
  // the production lane reaches the playback only through tracks whose scale follows the project (plan strand 7, 5.1): a lane edit is then a new playback
  ...(p.harmonie && p.spuren.some((s) => s.midi?.skala && 'quelle' in s.midi.skala) ?
    { midi_harmonie: p.harmonie.eintraege.map((e) => [e.beat, e.grundton, e.skala]) } : {}),
  // 1.10: die Topologie nur, wenn es welche gibt (neutral: wie vorher)
  ...((p.gruppen ?? []).length ? { gruppen: [...p.gruppen].sort((a, b) => a.nr - b.nr)
    .map((g) => ({ id: g.id, nr: g.nr, ...(g.ausgang ? { ausgang: g.ausgang.id } : {}),
      // live: the place of a top group decides the container it plays into (absent = parked); the grid (`raster`) is server business and stays out
      ...(platzVonGruppe(p, g.id) !== null ? { dj: platzVonGruppe(p, g.id) } : {}),
      ...(g.inserts?.length ? { inserts: kettenSicht(g.inserts) } : {}), ...(g.rack ? { rack: rackSicht(g) } : {}),
      ...laneSicht(g) })) } : {}),
  // 1.10 slice 3: the return topology (id, nr) only when there are returns; sends and hall values are controls, not part of the view
  ...((p.returns ?? []).length ? { returns: [...(p.returns ?? [])].sort((a, b) => a.nr - b.nr).map((r) => ({ id: r.id, nr: r.nr,
    // the owner's place decides the DJ output
    ...(r.pre ? { pre: true } : {}), ...(r.gruppe !== undefined && platzVonGruppe(p, r.gruppe) !== null ? { dj: platzVonGruppe(p, r.gruppe) } : {}),
    ...(r.inserts?.length ? { inserts: kettenSicht(r.inserts) } : {}), ...(r.rack ? { rack: rackSicht(r) } : {}),
    ...laneSicht(r) })) } : {}),
  // slice 4: only with a chain on the master
  ...(p.master?.inserts?.length
    ? { master: { inserts: kettenSicht(p.master.inserts), ...(p.master.rack ? { rack: rackSicht(p.master) } : {}), ...laneSicht(p.master) } }
    : {}),
  // strand 6: the switched-on modulators change the playback (the name does not); none: no key, the view stays byte for byte the same
  ...((p.modulatoren ?? []).some((m) => m.an !== false)
    ? { modulatoren: p.modulatoren!.filter((m) => m.an !== false).map(({ name: _n, ...m }) => m) } : {}),
});

// --- Strand 6: modulators (check, cleanup) -----------------------------------------------------------------------------
type ModAblehnung = { grund: string; text: string };
const MOD_FELDER_GEMEINSAM = ['id', 'nr', 'name', 'art', 'glatt_ms', 'an', 'ziele'];
const MOD_ZIEL_FELDER = ['strang_id', 'ziel', 'tiefe', 'polaritaet'];
// is `ziel` a target a modulator takes on the strip `strangId` (null = yes): fader and pan of a track, the fader of a return, a geraet.* parameter that
// the track's device carries, send.<return id> of a send the track has (the core takes send targets on tracks only), insert.<stage id>.<param> of a
// continuous parameter of a built-in stage and rack.m1..m4 on any strip that carries the stage or rack, plugin.<host stage id>.<index> of a host stage
// of the strip (task 4.2). A stage parameter a rack macro drives is refused (param_gemappt): the core refuses it, the macro is its one writer.
function modZielFehler(p: Projekt, strangId: string, ziel: string): ModAblehnung | null {
  const nein = (text: string): ModAblehnung => ({ grund: 'mod_ziel_unbekannt', text });
  const strang = sucheStrang(p, strangId);
  if (!strang) return nein(`${strangId} is no track, group, return or master of this project`);
  const spur = sucheSpur(p, strangId), ret = (p.returns ?? []).find((r) => r.id === strangId);
  if (!zielBereichVon(ziel, strang)) return nein(`${ziel} is no target of ${strangId}`);
  if (istPluginZiel(ziel)) return null;
  const k = istKettenZiel(ziel) ? zerlegeKettenZiel(ziel) : null;
  if (k && 'insert' in k) {
    const m = makroVon(strang, k.insert, k.param);
    return m ? { grund: 'param_gemappt', text: `${ziel} on ${strangId} is driven by macro ${m.nr} of the rack; modulate the macro (rack.m${m.nr})` } : null;
  }
  if (k) return null;
  if (istSendZiel(ziel)) return spur ? null : nein(`${ziel} on ${strangId}: only the send of a track is modulated`);
  if (ret) return ziel === 'fader' ? null : nein(`${ziel} on ${strangId}: a return takes fader, insert.* and rack.* only`);
  if (!spur) return nein(`${ziel} on ${strangId}: a group or the master takes insert.*, rack.* and plugin.* only`);
  if (ziel === 'fader' || ziel === 'pan') return null;
  if (istGeraetZiel(ziel)) {
    return spur.art === 'instrument' && passtGeraetZiel(ziel, spur.geraet) ? null
      : nein(`${ziel} on ${strangId}: only on a track whose device has that parameter (RB-338 lautstaerke, cutoff, resonanz, env_mod; bk k1 to k64)`);
  }
  return nein(`${ziel} on ${strangId}: a modulator takes fader, pan, geraet.*, send.*, insert.*, rack.* or plugin.*`);
}
/** check of one modulator against the project it sits in (model and commands share it): null = valid */
export function modulatorPruefung(x: unknown, p: Projekt): ModAblehnung | null {
  const ab = (grund: string, text: string): ModAblehnung => ({ grund, text });
  const ug = (text: string): ModAblehnung => ab('argument_ungueltig', text);
  const istZahl = (v: unknown, min: number, max: number): boolean => zahl(v) && v >= min && v <= max;
  if (!istObjekt(x)) return ug('modulator: object expected');
  if (x.art !== 'lfo' && x.art !== 'folger') return ug(`art: lfo | folger expected (got ${JSON.stringify(x.art)})`);
  const eigene: readonly string[] = MOD_FELDER_NUR[x.art];
  for (const k of Object.keys(x)) {
    if (!MOD_FELDER_GEMEINSAM.includes(k) && !eigene.includes(k)) return ab('argument_unbekannt', `modulator.${k} (not a field of ${x.art})`);
  }
  for (const k of ['id', 'nr', 'art', 'ziele']) if (!(k in x)) return ug(`modulator.${k}: missing`);
  if (typeof x.id !== 'string' || !ID.test(x.id)) return ug('id: id expected');
  if (!ganz(x.nr) || x.nr < 1 || x.nr > MAX_MODULATOREN) return ug(`nr: whole number 1..${MAX_MODULATOREN} expected`);
  if ('name' in x && !(typeof x.name === 'string' && x.name.trim().length >= 1 && x.name.length <= MOD_NAME_MAX)) {
    return ug(`name: text of 1 to ${MOD_NAME_MAX} characters expected`);
  }
  if ('form' in x && !(MOD_FORMEN as readonly unknown[]).includes(x.form)) return ug(`form: ${MOD_FORMEN.join(' | ')} expected`);
  if ('takt' in x && 'hz' in x) return ug('takt and hz: give one of them (beats per period or a free rate)');
  if ('takt' in x && !istZahl(x.takt, MOD_TAKT_MIN, MOD_TAKT_MAX)) return ug(`takt: beats per period 1/64..${MOD_TAKT_MAX} expected`);
  if ('hz' in x && !istZahl(x.hz, MOD_HZ_MIN, MOD_HZ_MAX)) return ug(`hz: ${MOD_HZ_MIN}..${MOD_HZ_MAX} expected`);
  // the core reads phase in [0, 1) (arr_playback.cpp): 1 is the position of 0, so it is refused rather than written twice
  if ('phase' in x && !(istZahl(x.phase, 0, 1) && (x.phase as number) < 1)) return ug('phase: 0 up to below 1 expected');
  if ('glatt_ms' in x && !istZahl(x.glatt_ms, 0, MOD_GLATT_MAX)) return ug(`glatt_ms: 0..${MOD_GLATT_MAX} expected`);
  if ('an' in x && x.an !== false) return ug('an: only false is written (absent = on)');
  if (x.art === 'folger') {
    // the source is a track id; a switched-off follower keeps the id of a deleted track (modulatorenBereinigen)
    if (typeof x.quelle !== 'string' || x.quelle === '') return ug('quelle: the id of the source track expected');
    if (x.an !== false && !sucheSpur(p, x.quelle)) return ab('spur_unbekannt', `quelle: ${x.quelle} is no track of this project`);
    if ('angriff_ms' in x && !istZahl(x.angriff_ms, MOD_ANGRIFF_MIN, MOD_ANGRIFF_MAX)) return ug(`angriff_ms: ${MOD_ANGRIFF_MIN}..${MOD_ANGRIFF_MAX} expected`);
    if ('abfall_ms' in x && !istZahl(x.abfall_ms, MOD_ABFALL_MIN, MOD_ABFALL_MAX)) return ug(`abfall_ms: ${MOD_ABFALL_MIN}..${MOD_ABFALL_MAX} expected`);
    if ('empfindlich_db' in x && !istZahl(x.empfindlich_db, -MOD_EMPFINDLICH_MAX, MOD_EMPFINDLICH_MAX)) {
      return ug(`empfindlich_db: -${MOD_EMPFINDLICH_MAX}..${MOD_EMPFINDLICH_MAX} expected`);
    }
  }
  if (!Array.isArray(x.ziele) || x.ziele.length < 1 || x.ziele.length > MAX_MOD_ZIELE) return ug(`ziele: list of 1 to ${MAX_MOD_ZIELE} targets expected`);
  const gesehen = new Set<string>();
  for (const [i, z] of (x.ziele as unknown[]).entries()) {
    const wo = `ziele[${i}]`;
    if (!istObjekt(z)) return ug(`${wo}: object expected`);
    for (const k of Object.keys(z)) if (!MOD_ZIEL_FELDER.includes(k)) return ab('argument_unbekannt', `${wo}.${k}`);
    if (typeof z.strang_id !== 'string' || z.strang_id === '') return ug(`${wo}.strang_id: id expected`);
    if (typeof z.ziel !== 'string' || z.ziel === '') return ug(`${wo}.ziel: target expected`);
    const f = modZielFehler(p, z.strang_id, z.ziel);
    if (f) return ab(f.grund, `${wo}: ${f.text}`);
    const [mn, mx] = modTiefeBereich(z.ziel)!;
    if (!istZahl(z.tiefe, mn, mx)) return ug(`${wo}.tiefe: ${mn}..${mx} expected for ${z.ziel}`);
    if ('polaritaet' in z && z.polaritaet !== 'uni') return ug(`${wo}.polaritaet: uni expected (absent = bipolar)`);
    const k = `${z.strang_id}/${z.ziel}`;
    if (gesehen.has(k)) return ug(`${wo}: ${z.strang_id} ${z.ziel} twice in one modulator`);
    // a follower does not move its own source track (fader, pan or device): another modulator may
    if (x.art === 'folger' && z.strang_id === x.quelle) return ug(`${wo}: ${z.strang_id} is the source track of this follower`);
    gesehen.add(k);
  }
  return null;
}
/** check of the whole list `modulatoren` (model and commands share it): null = valid */
export function modulatorenPruefung(x: unknown, p: Projekt): ModAblehnung | null {
  if (!Array.isArray(x) || x.length < 1) return { grund: 'argument_ungueltig', text: 'non-empty list expected (absent when there is no modulator)' };
  if (x.length > MAX_MODULATOREN) return { grund: 'mod_voll', text: `at most ${MAX_MODULATOREN} modulators per project` };
  const ids = new Set<string>(), nrs = new Set<number>(), felder = new Set<string>();
  for (const [i, m] of (x as unknown[]).entries()) {
    const f = modulatorPruefung(m, p);
    if (f) return { grund: f.grund, text: `[${i}] ${f.text}` };
    const mod = m as Modulator;
    if (ids.has(mod.id)) return { grund: 'argument_ungueltig', text: `[${i}].id: duplicate (${mod.id})` };
    if (nrs.has(mod.nr)) return { grund: 'argument_ungueltig', text: `[${i}].nr: duplicate (${mod.nr})` };
    ids.add(mod.id); nrs.add(mod.nr);
    for (const z of mod.ziele) if (z.ziel === 'fader' || z.ziel === 'pan') felder.add(`${z.strang_id}/${z.ziel}`);
  }
  if (felder.size > MAX_MOD_FELDER) {
    return { grund: 'zu_gross', text: `${felder.size} distinct fader and pan targets under modulation (at most ${MAX_MOD_FELDER} in the project)` };
  }
  return null;
}
// does the strip and the stage, host stage, return or rack a target names still exist (the target may be invalid for other reasons: the check says so)
function modZielLebt(p: Projekt, z: ModZiel): boolean {
  const strang = sucheStrang(p, z.strang_id);
  if (!strang) return false;
  const plugin = pluginZielVon(z.ziel);
  if (plugin) return (strang.inserts ?? []).some((x) => x.id === plugin.insert && x.art === 'host');
  if (istSendZiel(z.ziel)) return (p.returns ?? []).some((r) => r.id === sendZielVon(z.ziel));
  const k = istKettenZiel(z.ziel) ? zerlegeKettenZiel(z.ziel) : null;
  if (k && 'makro' in k) return strang.rack !== undefined;
  if (k) return (strang.inserts ?? []).some((x) => x.id === k.insert);
  return true;
}
/** Strand 6 cleanup after a strip or stage went: drop the targets on it, drop a modulator without targets, turn off a follower whose source track
 *  went (it is kept). Changes `p` itself (a command draft); new objects for every changed modulator. */
export function modulatorenBereinigen(p: Projekt): void {
  if (!p.modulatoren) return;
  const rest: Modulator[] = [];
  for (const m of p.modulatoren) {
    const ziele = m.ziele.filter((z) => modZielLebt(p, z));
    if (ziele.length === 0) continue;
    let n = ziele.length === m.ziele.length ? m : { ...m, ziele };
    if (n.quelle !== undefined && n.an !== false && !sucheSpur(p, n.quelle)) n = { ...n, an: false };
    rest.push(n);
  }
  if (rest.length) p.modulatoren = rest; else delete p.modulatoren;
}
/** the modulator `nachher` has and `vorher` has not (the answer of mod_neu: handlers return nothing, the caller compares) */
export function neuerModulator(vorher: Projekt, nachher: Projekt): { mod_id: string; nr: number } | null {
  const alt = new Set((vorher.modulatoren ?? []).map((m) => m.id));
  const m = (nachher.modulatoren ?? []).find((x) => !alt.has(x.id));
  return m ? { mod_id: m.id, nr: m.nr } : null;
}
