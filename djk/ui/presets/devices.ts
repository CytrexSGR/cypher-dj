// Presets (package 1.16 "Browser"): catalogue of the devices a preset may belong to, with their parameters.
// Source of truth are the nih-plug parameter IDs in djk/instruments/<geraet>/src/lib.rs (#[id = "..."]). These IDs are what the
// host stores in its own state, so they are stable across plugin versions; display names ("Threshold") and indices are not.
// Ranges are copied from the FloatRange of each parameter (plain values, not normalised 0..1). The test presets_devices.test.mjs
// reads the Rust sources and fails when an ID here is missing there or the other way round. The four kern devices at the end are
// checked against the header of the controller table instead (same test file).
// Nested array (EQ bands, #[nested(array, group = "Band")]): nih-plug appends _1.._N to the IDs of the inner struct.
// Enums are stored by the #[name = "..."] text of the variant (the text the host shows), see DECISIONS.md, open question F3.

// Second kind of device (A8, ENTSCHEIDUNGEN D22): the mix tools of the kern. They have no plugin and no #[id]; their parameters are
// rows of the controller table (djk/core/signalbox/include/cypherdj/signalbox/tool_controls.h, one `{...}` row per line), set
// per channel through POST /regler <channel>/<pfad>. `pfad` is the table suffix, `kanalArten` the channel kinds that carry the rows.
export type GeraetHerkunft = 'plugin' | 'kern';
export type KanalArt = 'quelle' | 'bus';
export type GeraetTyp = 'effekt' | 'instrument';
export type ParamArt =
  | { art: 'zahl'; min: number; max: number; einheit?: string }
  | { art: 'schalter' }
  | { art: 'auswahl'; werte: readonly string[] };
export interface ParamDef { name: string; titel: string; def: ParamArt; pfad?: string; ganz?: true }   // ganz: integer value, no ramp (switch or steps)
export interface GeraetDef {
  id: string; typ: GeraetTyp; titel: string; quelle: string; parameter: readonly ParamDef[];
  herkunft?: GeraetHerkunft;                  // absent = 'plugin'
  kanalArten?: readonly KanalArt[];      // only for 'kern'
}

const zahl = (name: string, titel: string, min: number, max: number, einheit?: string): ParamDef =>
  ({ name, titel, def: einheit ? { art: 'zahl', min, max, einheit } : { art: 'zahl', min, max } });
const schalter = (name: string, titel: string): ParamDef => ({ name, titel, def: { art: 'schalter' } });
const auswahl = (name: string, titel: string, werte: readonly string[]): ParamDef => ({ name, titel, def: { art: 'auswahl', werte } });

// util::db_to_gain(-48.0) .. db_to_gain(0.0): the volume of rb338 and baukasten is a linear gain, not dB
const GAIN_MIN = 10 ** (-48 / 20);
export const EQ_BAENDER = 8;   // eq_dsp::BAENDER
const EQ_ARTEN = ['Bell', 'Low Shelf', 'High Shelf', 'Low Cut', 'High Cut', 'Notch', 'Band Pass'] as const;
const EQ_STEIL = ['12 dB/oct', '24 dB/oct', '36 dB/oct', '48 dB/oct'] as const;
const EQ_KANAL = ['Stereo', 'Mid', 'Side'] as const;
const HALL_RAHMEN = ['512 (grainy)', '1024', '2048', '4096', '8192 (smooth)'] as const;

function eqBand(n: number): ParamDef[] {
  return [
    schalter(`on_${n}`, `Band ${n} On`),
    auswahl(`type_${n}`, `Band ${n} Type`, EQ_ARTEN),
    zahl(`freq_${n}`, `Band ${n} Freq`, 10, 22000, 'Hz'),
    zahl(`gain_${n}`, `Band ${n} Gain`, -24, 24, 'dB'),
    zahl(`q_${n}`, `Band ${n} Q`, 0.1, 18),
    auswahl(`slope_${n}`, `Band ${n} Slope`, EQ_STEIL),
    auswahl(`place_${n}`, `Band ${n} Placement`, EQ_KANAL),
  ];
}

export const KERN_KOPF = 'djk/core/signalbox/include/cypherdj/signalbox/tool_controls.h';
// A kern parameter: name = the table suffix without the tool prefix, "/" as "_" (mb/tief/schwelle -> tief_schwelle); pfad = the suffix
const kz = (pfad: string, titel: string, min: number, max: number, einheit?: string): ParamDef =>
  ({ ...zahl(pfad.split('/').slice(1).join('_'), titel, min, max, einheit), pfad });
const ks = (pfad: string, titel: string): ParamDef => ({ ...schalter(pfad.split('/').slice(1).join('_'), titel), pfad, ganz: true });
const kst = (pfad: string, titel: string, min: number, max: number): ParamDef => ({ ...kz(pfad, titel, min, max), ganz: true });   // steps
const kern = (id: string, titel: string, kanalArten: readonly KanalArt[], parameter: readonly ParamDef[]): GeraetDef =>
  ({ id, typ: 'effekt', titel, quelle: KERN_KOPF, herkunft: 'kern', kanalArten, parameter });
const mbBand = (b: 'tief' | 'mitte' | 'hoch', n: string): ParamDef[] => [
  kz(`mb/${b}/schwelle`, `${n} Threshold`, -60, 0, 'dB'), kz(`mb/${b}/ratio`, `${n} Ratio`, 1, 20),
  kz(`mb/${b}/attack`, `${n} Attack`, 0.1, 500, 'ms'), kz(`mb/${b}/release`, `${n} Release`, 1, 5000, 'ms'),
  kz(`mb/${b}/knie`, `${n} Knee`, 0, 24, 'dB'), kz(`mb/${b}/makeup`, `${n} Makeup trim`, -24, 24, 'dB'), ks(`mb/${b}/umgehen`, `${n} Bypass`),
];

export const GERAETE: readonly GeraetDef[] = [
  { id: 'eq', typ: 'effekt', titel: 'Cypher EQ', quelle: 'djk/instruments/eq/src/lib.rs', parameter: [
    ...Array.from({ length: EQ_BAENDER }, (_, i) => eqBand(i + 1)).flat(),
    zahl('out', 'Output', -24, 24, 'dB'),
    schalter('propq', 'Proportional Q'),
  ] },
  { id: 'komp', typ: 'effekt', titel: 'Cypher Komp', quelle: 'djk/instruments/comp/src/lib.rs', parameter: [
    zahl('thresh', 'Threshold', -60, 0, 'dB'),
    zahl('ratio', 'Ratio', 1, 20),
    zahl('knee', 'Knee', 0, 24, 'dB'),
    zahl('attack', 'Attack', 0.1, 100, 'ms'),
    zahl('release', 'Release', 10, 1000, 'ms'),
    zahl('makeup', 'Makeup', 0, 24, 'dB'),
    zahl('mix', 'Mix', 0, 1),
    schalter('extsc', 'External SC'),
    zahl('schp', 'SC High-Pass', 0, 300, 'Hz'),
  ] },
  { id: 'hall', typ: 'effekt', titel: 'Cypher Hall', quelle: 'djk/instruments/reverb/src/lib.rs', parameter: [
    zahl('mix', 'Mix', 0, 1),
    zahl('early', 'Early', 0, 1),
    zahl('tail', 'Tail Level', -24, 12, 'dB'),
    zahl('pre', 'Pre-Delay', 0, 250, 'ms'),
    zahl('size', 'Size', 5, 200, 'ms'),
    zahl('decay', 'Decay', 0.1, 30, 's'),
    zahl('lowx', 'Low Decay', 0.25, 4),
    zahl('highx', 'High Decay', 0.1, 2),
    zahl('lowcut', 'Low Cut', 10, 1000, 'Hz'),
    zahl('highcut', 'High Cut', 1000, 22000, 'Hz'),
    zahl('diff', 'Diffusion', 0, 1),
    zahl('width', 'Width', 0, 1),
    zahl('duck', 'Spectral Duck', 0, 1),
    schalter('freeze', 'Freeze'),
    schalter('kill', 'Kill'),
    auswahl('fft', 'FFT Size', HALL_RAHMEN),
  ] },
  { id: 'saett', typ: 'effekt', titel: 'Cypher Saett', quelle: 'djk/instruments/sat/src/lib.rs', parameter: [
    zahl('drive', 'Drive', 0, 36, 'dB'),
    zahl('out', 'Output', -24, 12, 'dB'),
    zahl('mix', 'Mix', 0, 1),
  ] },
  { id: 'rb338', typ: 'instrument', titel: 'RB-338', quelle: 'djk/instruments/rb338/src/lib.rs', parameter: [
    zahl('lautstaerke', 'Volume', GAIN_MIN, 1, 'gain'),
    schalter('wellenform', 'Square'),
    zahl('cutoff', 'Cutoff', 40, 5000, 'Hz'),
    zahl('resonanz', 'Resonance', 0, 1),
    zahl('env_mod', 'Env Mod', 0, 1),
    zahl('decay', 'Decay', 0.2, 2, 's'),
    zahl('accent', 'Accent', 0, 1),
  ] },
  { id: 'baukasten', typ: 'instrument', titel: 'Cypher Modular', quelle: 'djk/instruments/modular/src/lib.rs', parameter: [
    zahl('lautstaerke', 'Volume', GAIN_MIN, 1, 'gain'),
    ...Array.from({ length: 8 }, (_, i) => zahl(`knob${i + 1}`, `Knob ${i + 1}`, 0, 1)),
  ] },
  kern('gate', 'Channel Gate', ['quelle'], [
    ks('gate/an', 'On'), kz('gate/schwelle', 'Threshold', -90, 0, 'dB'), kz('gate/hysterese', 'Hysteresis', 0, 24, 'dB'),
    kz('gate/ratio', 'Ratio', 1, 100), kz('gate/bereich', 'Range', -120, 0, 'dB'), kz('gate/attack', 'Attack', 0.1, 500, 'ms'),
    kz('gate/hold', 'Hold', 0, 2000, 'ms'), kz('gate/release', 'Release', 1, 5000, 'ms'), kst('gate/sc', 'Sidechain source', 0, 14),
  ]),
  kern('utility', 'Channel Utility', ['quelle', 'bus'], [
    kz('util/balance', 'Balance', -1, 1), kz('util/breite', 'Width', 0, 200, '%'), kz('util/bassmono', 'Bass Mono', 0, 500, 'Hz'),
    ks('util/phase_l', 'Phase L'), ks('util/phase_r', 'Phase R'), ks('util/tausch', 'Swap L/R'), ks('util/dc', 'DC Block'),
  ]),
  kern('multiband', 'Bus Multiband', ['bus'], [
    ks('mb/an', 'On'), kz('mb/grenze_tief', 'Low Crossover', 20, 20000, 'Hz'), kz('mb/grenze_hoch', 'High Crossover', 20, 20000, 'Hz'),
    ...mbBand('tief', 'Low'), ...mbBand('mitte', 'Mid'), ...mbBand('hoch', 'High'),
  ]),
  kern('kanal-limiter', 'Bus Limiter', ['bus'], [
    ks('lim/an', 'On'), kz('lim/decke', 'Ceiling', -60, 0, 'dB'), kz('lim/abklingen', 'Release', 1, 2000, 'ms'),
  ]),
];

export const GERAET_IDS: readonly string[] = GERAETE.map((g) => g.id);
export const geraetVon = (id: string): GeraetDef | undefined => GERAETE.find((g) => g.id === id);
export function paramVon(g: GeraetDef, name: string): ParamDef | undefined { return g.parameter.find((p) => p.name === name); }
