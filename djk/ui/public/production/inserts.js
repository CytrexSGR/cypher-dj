// PRODUCTION: the insert chain of every strip (track, group, return, master), without a view of its own since plan 1.11 task 14. The dock (../dock/) shows
// the stages; this file holds what stays: the pure helpers (pools, limits, parameter tables, command builders, rack macro helpers, gain reduction
// and level stores), the Baukasten panel adapter, and `bindeInsertDienste`, which binds the services behind the dock: the gain reduction and level
// readings, the plugin host state and window, the graph latency list, the device faces, the stage popover and the rack window.
// Every write goes through ctx.aendere to POST /proj/aendern (insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung,
// rack_makro, rack_setzen, makro_variation_*), so it lands in the project and in the undo history.

import { geraetName } from './rack_device.js';
import { bindeInsertFace } from './insert_face.js';
import { bindeStufenPopover, stufenZustand } from './insert_popover.js';
import { bindeRackFenster } from './rack_panel.js';

export const MAX_PLAETZE = 5;      // equal to project/model.ts MAX_INSERTS_PRO_STRANG, checked by tests/production_inserts.test.mjs
export const MAX_KOMP = 160;       // equal to INSERT_ARTEN.komp.instanzen (160 since the 128-track pool, one per strip)
export const MAX_EQ = 160;         // equal to INSERT_ARTEN.eq.instanzen (160 since the 128-track pool; 8 since arr-fx slice 2)
export const MAX_SAETT = 32;       // equal to MAX_INS_SAETT (4 since arr-fx slice 2, 32 since strand 5 slice 3)
export const MAX_LIM = 8;          // equal to MAX_INS_LIM (8 since strand 1 slice 4)
export const MAX_UTIL = 8;         // equal to MAX_INS_UTIL (arr-fx)
export const MAX_BK = 8;           // equal to MAX_INS_BK (arr-bk)
export const MAX_GATE = 16;        // equal to MAX_INS_GATE (strand 1 slice 4)
export const MAX_MB = 8;           // equal to MAX_INS_MB (strand 1 slice 4)
export const MAX_TRANS = 32;       // equal to MAX_INS_TRANS (strand 5 slice 3)
export const MAX_BILD = 16;        // equal to MAX_INS_BILD (strand 5 slice 3)
export const MAX_VARIATIONEN = 8;     // equal to MAX_VARIATIONEN of project/model.ts (tests/production_rack.test.mjs)
export const VARIATION_NAME_MAX = 32;  // equal to VARIATION_NAME_MAX
export const MAX_ART = { komp: MAX_KOMP, eq: MAX_EQ, saett: MAX_SAETT, lim: MAX_LIM, utility: MAX_UTIL, bk: MAX_BK, gate: MAX_GATE, mb: MAX_MB, trans: MAX_TRANS, bild: MAX_BILD };
// arr-bk: the graph the `+ Fx` button puts on a strip; another effect graph is chosen with insert_setzen (replace) from the Hand or the graphen list
export const BK_STANDARD_GRAPH = 'fx-delay-sync';
// per kind: the short button text, the name of the stage, the pool-full text
export const ARTEN = {
  komp: { kurz: 'Comp', name: 'compressor', voll: 'No free compressor', neu: 'Add a compressor' },
  eq: { kurz: 'EQ', name: 'EQ', voll: 'No free EQ', neu: 'Add an EQ' },
  saett: { kurz: 'Sat', name: 'saturator', voll: 'No free saturator', neu: 'Add a saturator' },
  lim: { kurz: 'Lim', name: 'limiter', voll: 'No free limiter', neu: 'Add a limiter' },
  utility: { kurz: 'Util', name: 'utility', voll: 'No free utility', neu: 'Add a utility (width, bass mono, gain, balance)' },
  gate: { kurz: 'Gate', name: 'gate', voll: 'No free gate', neu: 'Add a noise gate' },
  mb: { kurz: 'MB', name: 'multiband', voll: 'No free multiband compressor', neu: 'Add a three-band compressor (Low, Mid, High)' },
  trans: { kurz: 'Trans', name: 'transient shaper', voll: 'No free transient shaper', neu: 'Add a transient shaper (attack, sustain)' },
  bild: { kurz: 'Width', name: 'imager', voll: 'No free imager', neu: 'Add a three-band imager' },
  bk: { kurz: 'Fx', name: 'effect', voll: 'No free effect stage', neu: 'Add a Cypher Modular effect (the tempo-synchronous delay; other graphs through the Hand)' },
};
// Plan 1.11 task 11: a plugin (host) stage. Not in ARTEN (those are the kinds with a button "+ ..." and a pool the page counts); added by the PLUGINS list.
export const HOST_ART = { kurz: 'Plugin', name: 'plugin', voll: 'No free plugin host', neu: 'Add a plugin' };
export const HOST_STATUS_TEXT = { startet: 'Starting', bereit: 'Ready', fehlt: 'Missing', ausfall: 'Failed' };
export const HOST_FENSTER_TEXT = { kein_fenster: 'This plugin has no window', keine_anzeige: 'The studio machine has no display for a plugin window' };
export const HOST_POLL_MS = { warten: 1000, ruhe: 4000 };
export const hostName = (i) => i.plugin?.name ?? 'Plugin';
export function hostDotTitel(h) {
  if (!h) return 'Waiting for the plugin host';
  return `${HOST_STATUS_TEXT[h.status] ?? h.status}${h.grund ? `: ${h.grund}` : ''}`;
}
export const KOMP_VOLL_TEXT = 'No free compressor';
export const KOMP_NEU_TEXT = 'Add a compressor';
// The compressor parameters, a literal list on purpose (the page cannot import the generated .ts table); tests/production_inserts.test.mjs binds
// name, range, default and unit to djk/ui/project/insert_schluessel.ts. schritt: the slider step; label: the English name on the page.
export const KOMP_PARAMETER = [
  { name: 'schwelle', label: 'Threshold', einheit: 'dB', min: -60, max: 0, vorgabe: -18, schritt: 0.5 },
  { name: 'ratio', label: 'Ratio', einheit: '', min: 1, max: 20, vorgabe: 4, schritt: 0.1 },
  { name: 'knie', label: 'Knee', einheit: 'dB', min: 0, max: 24, vorgabe: 6, schritt: 0.5 },
  { name: 'attack', label: 'Attack', einheit: 'ms', min: 0.1, max: 100, vorgabe: 10, schritt: 0.1 },
  { name: 'release', label: 'Release', einheit: 'ms', min: 10, max: 1000, vorgabe: 120, schritt: 1 },
  { name: 'makeup', label: 'Makeup', einheit: 'dB', min: 0, max: 24, vorgabe: 0, schritt: 0.5 },
  { name: 'mix', label: 'Mix', einheit: '', min: 0, max: 1, vorgabe: 1, schritt: 0.01 },
  { name: 'schp', label: 'Key high-pass', einheit: 'Hz', min: 0, max: 300, vorgabe: 0, schritt: 1 },
  // strand 13 slice 1: the glue character (stepped ratio, attack, release in the DSP) and the auto release
  { name: 'glue', label: 'Glue', einheit: '', min: 0, max: 1, vorgabe: 0, typ: 'schalter' },
  { name: 'auto', label: 'Auto release', einheit: '', min: 0, max: 1, vorgabe: 0, typ: 'schalter' },
];
// The glue steps of comp_dsp (D3); with glue on the DSP snaps ratio, attack and release to the nearest step (log domain, a tie goes to the lower step).
export const GLUE_RATIO = [1.5, 2, 4, 10];
export const GLUE_ATTACK = [0.1, 0.3, 1, 3, 10, 30];
export const GLUE_RELEASE = [100, 200, 400, 800, 1200];
/** The step of `liste` (ascending) nearest to v in the log domain; a tie goes to the lower step (the rule of comp_dsp `naechste_stufe`). */
export function glueStufe(liste, v) {
  const lv = Math.log(Math.max(v, 1e-9));
  let best = liste[0], bd = Math.abs(lv - Math.log(best));
  for (const s of liste.slice(1)) { const d = Math.abs(lv - Math.log(s)); if (d < bd - 1e-12) { best = s; bd = d; } }
  return best;
}
/** The Cypher Glue starting points (D6): the values of the compressor parameters a recipe sets. `auto` is always listed (0 or 1) so a recipe leaves no auto release behind. */
export const GLUE_VORLAGEN = {
  bus: { text: 'Bus', werte: { schwelle: -16, ratio: 2, attack: 10, auto: 1, knie: 4, makeup: 2, mix: 1, schp: 60 } },
  drums: { text: 'Drums', werte: { schwelle: -18, ratio: 4, attack: 30, release: 100, auto: 0, knie: 4, makeup: 3, mix: 1, schp: 90 } },
  master: { text: 'Master', werte: { schwelle: -10, ratio: 1.5, attack: 30, auto: 1, knie: 6, makeup: 1, mix: 1, schp: 40 } },
  smash: { text: 'Smash', werte: { schwelle: -30, ratio: 10, attack: 0.1, release: 100, auto: 0, knie: 0, makeup: 8, mix: 0.4, schp: 0 } },
};
export function paramText(name, v) {
  const q = KOMP_PARAMETER.find((x) => x.name === name);
  if (!q) throw new Error(`unknown compressor parameter ${name}`);
  if (q.typ === 'schalter') return v >= 0.5 ? 'on' : 'off';
  if (name === 'ratio') return `${v.toFixed(1)}:1`;
  if (name === 'mix') return `${Math.round(v * 100)} %`;
  if (q.einheit === 'Hz') return v < 1 ? 'off' : `${Math.round(v)} Hz`;
  if (q.einheit === 'ms') return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ms`;
  return `${v.toFixed(1)} ${q.einheit}`;
}

// The saturator and EQ parameters, literal lists like the compressor's (bound to the contract by tests/production_inserts.test.mjs).
// typ: 'regler' (slider), 'schalter' (checkbox), 'wahl' (select with names). skala 'log': the slider runs 0..1000 and maps logarithmically onto min..max.
export const SAETT_PARAMETER = [
  { name: 'drive', label: 'Drive', einheit: 'dB', min: 0, max: 36, vorgabe: 12, schritt: 0.5 },
  { name: 'out', label: 'Output', einheit: 'dB', min: -24, max: 12, vorgabe: -6, schritt: 0.5 },
  { name: 'mix', label: 'Mix', einheit: '', min: 0, max: 1, vorgabe: 1, schritt: 0.01 },
  // strand 5 slice 1: the face curve (0 Tanh, 1 Soft clip, 2 Hard clip) and the ceiling; curve 1 and 2 are the Cypher Clipper
  { name: 'kurve', label: 'Curve', einheit: '', min: 0, max: 2, vorgabe: 0, typ: 'wahl', optionen: ['Tanh', 'Soft clip', 'Hard clip'] },
  { name: 'decke', label: 'Ceiling', einheit: 'dB', min: -24, max: 0, vorgabe: 0, schritt: 0.1 },
  // strand 13: the soft corner of the Hard clip curve (0 = the plain hard corner); no effect on Tanh and Soft clip
  { name: 'knie', label: 'Knee', einheit: 'dB', min: 0, max: 12, vorgabe: 0, schritt: 0.5 },
];
export const LIM_PARAMETER = [
  { name: 'decke', label: 'Ceiling', einheit: 'dB', min: -60, max: 0, vorgabe: -1, schritt: 0.1 },
  { name: 'abklingen', label: 'Release', einheit: 'ms', min: 1, max: 2000, vorgabe: 80, schritt: 1 },
];
// arr-fx: the utility stage (stereo width, bass mono, gain, balance); literal like the others, bound to the contract by tests/production_inserts.test.mjs
export const UTIL_PARAMETER = [
  { name: 'breite', label: 'Width', einheit: '', min: 0, max: 4, vorgabe: 1, schritt: 0.01 },
  { name: 'mono_unter', label: 'Mono below', einheit: 'Hz', min: 0, max: 500, vorgabe: 0, schritt: 1 },
  { name: 'gain', label: 'Gain', einheit: 'dB', min: -60, max: 24, vorgabe: 0, schritt: 0.1 },
  { name: 'balance', label: 'Balance', einheit: '', min: -1, max: 1, vorgabe: 0, schritt: 0.01 },
];
// strand 1 slice 4: the noise gate and the three-band compressor; literal like the others, bound to the contract by tests/production_inserts.test.mjs
export const GATE_PARAMETER = [
  { name: 'schwelle', label: 'Threshold', einheit: 'dB', min: -90, max: 0, vorgabe: -40, schritt: 0.5 },
  { name: 'hysterese', label: 'Hysteresis', einheit: 'dB', min: 0, max: 24, vorgabe: 4, schritt: 0.5 },
  { name: 'ratio', label: 'Ratio', einheit: '', min: 1, max: 100, vorgabe: 100, schritt: 0.5 },
  { name: 'bereich', label: 'Range', einheit: 'dB', min: -120, max: 0, vorgabe: -80, schritt: 0.5 },
  { name: 'attack', label: 'Attack', einheit: 'ms', min: 0.1, max: 500, vorgabe: 1, schritt: 0.1 },
  { name: 'hold', label: 'Hold', einheit: 'ms', min: 0, max: 2000, vorgabe: 20, schritt: 1 },
  { name: 'release', label: 'Release', einheit: 'ms', min: 1, max: 5000, vorgabe: 100, schritt: 1 },
];
// the multiband: two crossover rows, then the same seven rows for each of the three bands (full names 'b1/schwelle' ... 'b3/umgehen')
export const MB_KOPF_PARAMETER = [
  { name: 'grenze_tief', label: 'Low / Mid crossover', einheit: 'Hz', min: 20, max: 20000, vorgabe: 200, skala: 'log' },
  { name: 'grenze_hoch', label: 'Mid / High crossover', einheit: 'Hz', min: 20, max: 20000, vorgabe: 2000, skala: 'log' },
];
export const MB_BAENDER = 3;
export const MB_BAND_NAMEN = ['Low', 'Mid', 'High'];
export const MB_BAND_PARAMETER = [
  { name: 'schwelle', label: 'Threshold', einheit: 'dB', min: -60, max: 0, vorgabe: 0, schritt: 0.5 },
  { name: 'ratio', label: 'Ratio', einheit: '', min: 1, max: 20, vorgabe: 1, schritt: 0.1 },
  { name: 'attack', label: 'Attack', einheit: 'ms', min: 0.1, max: 500, vorgabe: 10, schritt: 0.1 },
  { name: 'release', label: 'Release', einheit: 'ms', min: 1, max: 5000, vorgabe: 100, schritt: 1 },
  { name: 'knie', label: 'Knee', einheit: 'dB', min: 0, max: 24, vorgabe: 0, schritt: 0.5 },
  { name: 'makeup', label: 'Makeup', einheit: 'dB', min: -24, max: 24, vorgabe: 0, schritt: 0.1 },
  { name: 'umgehen', label: 'Bypass', einheit: '', min: 0, max: 1, vorgabe: 0, typ: 'schalter' },
];
// strand 5 slice 3: the transient shaper (attack and sustain in dB, speed in ms) and the three-band imager (widths 0..1 / 0..2 = 0..100 % / 0..200 %)
export const TRANS_PARAMETER = [
  { name: 'angriff', label: 'Attack', einheit: 'dB', min: -24, max: 24, vorgabe: 0, schritt: 0.5 },
  { name: 'halten', label: 'Sustain', einheit: 'dB', min: -24, max: 24, vorgabe: 0, schritt: 0.5 },
  { name: 'tempo', label: 'Speed', einheit: 'ms', min: 1, max: 100, vorgabe: 15, schritt: 0.5 },
  { name: 'out', label: 'Output', einheit: 'dB', min: -24, max: 12, vorgabe: 0, schritt: 0.5 },
  { name: 'mix', label: 'Mix', einheit: '', min: 0, max: 1, vorgabe: 1, schritt: 0.01 },
];
export const BILD_PARAMETER = [
  { name: 'grenze_tief', label: 'Low / Mid crossover', einheit: 'Hz', min: 40, max: 1000, vorgabe: 150, skala: 'log' },
  { name: 'grenze_hoch', label: 'Mid / High crossover', einheit: 'Hz', min: 1000, max: 12000, vorgabe: 4000, skala: 'log' },
  { name: 'breite_tief', label: 'Low width', einheit: '', min: 0, max: 1, vorgabe: 1, schritt: 0.01 },
  { name: 'breite_mitte', label: 'Mid width', einheit: '', min: 0, max: 2, vorgabe: 1, schritt: 0.01 },
  { name: 'breite_hoch', label: 'High width', einheit: '', min: 0, max: 2, vorgabe: 1, schritt: 0.01 },
  { name: 'mono_unter', label: 'Mono below', einheit: 'Hz', min: 0, max: 300, vorgabe: 0, schritt: 1 },
];
// strand 13 slice 4: the upward group of each band (`u1/schwelle` ... `u3/bereich`): ratio 1 = off, the lift is capped at `bereich`
export const MB_UP_PARAMETER = [
  { name: 'schwelle', label: 'Upward threshold', einheit: 'dB', min: -80, max: 0, vorgabe: -40, schritt: 0.5 },
  { name: 'ratio', label: 'Upward ratio', einheit: '', min: 1, max: 4, vorgabe: 1, schritt: 0.1 },
  { name: 'bereich', label: 'Upward range', einheit: 'dB', min: 0, max: 24, vorgabe: 6, schritt: 0.5 },
];
export const mbBandName = (m, name) => `b${m}/${name}`;
export const mbUpName = (m, name) => `u${m}/${name}`;
// the name of a band group as the popover and the labels say it: the EQ counts "Band 3", the multiband names "Low band"
export const bandText = (art, m) => (art === 'mb' ? `${MB_BAND_NAMEN[m - 1]} band` : `Band ${m}`);
// arr-bk: the 64 knobs of a Baukasten effect stage (0..1, the graph maps them; the names come from the graph, the page shows K1..K64).
// The popover lists as many as the graph defines (bkZahl), at least the first eight.
export const BK_ZAHL_MIN = 8;
export const bkZahl = (reglerNamen) => {
  let n = BK_ZAHL_MIN;
  if (typeof reglerNamen === 'object' && reglerNamen !== null) for (const k of Object.keys(reglerNamen)) { const nr = Number(k); if (Number.isInteger(nr) && nr > n && nr <= 64) n = nr; }
  return n;
};
export const BK_PARAMETER = Array.from({ length: 64 }, (_, i) => ({ name: `k${i + 1}`, label: `K${i + 1}`, einheit: '', min: 0, max: 1, vorgabe: 0.5, schritt: 0.01 }));
export const EQ_KOPF_PARAMETER = [
  { name: 'out', label: 'Output', einheit: 'dB', min: -24, max: 24, vorgabe: 0, schritt: 0.1 },
  { name: 'propq', label: 'Proportional Q', einheit: '', min: 0, max: 1, vorgabe: 0, typ: 'schalter' },
];
export const EQ_BAENDER = 8;
export const EQ_TYPEN = ['Bell', 'Low shelf', 'High shelf', 'Low cut', 'High cut', 'Notch', 'Band pass'];
export const EQ_STEIL = ['12 dB/oct', '24 dB/oct', '36 dB/oct', '48 dB/oct'];
export const EQ_PLATZ = ['Stereo', 'Mid', 'Side'];
// the defaults of type and frequency differ per band (the plugin's): bands 1 to 8
export const EQ_BAND_TYP_VORGABE = [3, 1, 0, 0, 0, 0, 2, 4];
export const EQ_BAND_FREQ_VORGABE = [30, 100, 250, 800, 2500, 6000, 10000, 18000];
// the parameters of ONE band (name without the 'b<m>/' prefix); typ and freq defaults are those of band 1, the page reads the others from the lists above
export const EQ_BAND_PARAMETER = [
  { name: 'an', label: 'On', einheit: '', min: 0, max: 1, vorgabe: 0, typ: 'schalter' },
  { name: 'typ', label: 'Type', einheit: '', min: 0, max: 6, vorgabe: 3, typ: 'wahl', optionen: EQ_TYPEN },
  { name: 'freq', label: 'Frequency', einheit: 'Hz', min: 10, max: 22000, vorgabe: 30, skala: 'log' },
  { name: 'gain', label: 'Gain', einheit: 'dB', min: -24, max: 24, vorgabe: 0, schritt: 0.1 },
  { name: 'q', label: 'Q', einheit: '', min: 0.1, max: 18, vorgabe: 0.707, schritt: 0.01 },
  { name: 'steil', label: 'Slope', einheit: '', min: 0, max: 3, vorgabe: 0, typ: 'wahl', optionen: EQ_STEIL },
  { name: 'platz', label: 'Placement', einheit: '', min: 0, max: 2, vorgabe: 0, typ: 'wahl', optionen: EQ_PLATZ },
];
// every parameter row of an EQ stage in `Insert.werte` naming: 'out', 'propq', 'b1/an' ... 'b8/platz', then the dynamic rows 'd1/dyn' ... 'd8/bereich' and 'dyn_attack', 'dyn_release'
export const eqBandName = (m, name) => `b${m}/${name}`;
// strand 5 slice 2 (EQ Pro): the dynamic rows of ONE band (name without the 'd<m>/' prefix; the mode is a step list, so no macro or lane target) and the two stage rows
export const EQ_DYN_MODI = ['Off', 'Above', 'Below', 'Above (key)', 'Below (key)'];
export const EQ_DYN_PARAMETER = [
  { name: 'dyn', label: 'Dynamics', einheit: '', min: 0, max: 4, vorgabe: 0, typ: 'wahl', optionen: EQ_DYN_MODI },
  { name: 'schwelle', label: 'Threshold', einheit: 'dB', min: -60, max: 0, vorgabe: -24, schritt: 0.5 },
  { name: 'bereich', label: 'Range', einheit: 'dB', min: -24, max: 24, vorgabe: 0, schritt: 0.1 },
];
export const EQ_DYN_KOPF = [
  { name: 'dyn_attack', label: 'Attack', einheit: 'ms', min: 0.1, max: 100, vorgabe: 5, schritt: 0.1 },
  { name: 'dyn_release', label: 'Release', einheit: 'ms', min: 5, max: 1000, vorgabe: 80, schritt: 1 },
];
export const eqDynName = (m, name) => `d${m}/${name}`;
// the band types that have a dynamic part (Bell, Low shelf, High shelf; the other types ignore `dyn`)
export const EQ_DYN_TYPEN = new Set([0, 1, 2]);
export const EQ_DYN_HINWEIS = 'Acts as Above or Below until a key is chosen';
// the note shows for a key mode (3, 4) of a stage that has no key yet; with a key chosen (row sc or structural key) the mode listens to it and the note falls away
export const eqDynHinweisSichtbar = (dynModus, mitSchluessel) => Number(dynModus) >= 3 && !mitSchluessel;
export const hatSchluessel = (insert) => !!insert && (insert.sc > 0 || !!insert.key);
// the stage's title: "Cypher EQ Pro" when any band runs dynamic
export const eqDynAktiv = (werte) => { for (let m = 1; m <= EQ_BAENDER; m++) if (Number(werte?.[eqDynName(m, 'dyn')]) > 0) return true; return false; };
export const eqTitel = (werte) => (eqDynAktiv(werte) ? 'Cypher EQ Pro' : 'Cypher EQ');
// slider position <-> value for the logarithmic frequency slider (0..1000)
export const POS_MAX = 1000;
export const freqVonPos = (pos, q = EQ_BAND_PARAMETER[2]) => q.min * (q.max / q.min) ** (Math.min(Math.max(pos, 0), POS_MAX) / POS_MAX);
export const posVonFreq = (f, q = EQ_BAND_PARAMETER[2]) => Math.round(POS_MAX * Math.log(Math.min(Math.max(f, q.min), q.max) / q.min) / Math.log(q.max / q.min));
// the descriptor of a parameter by its full name in `Insert.werte`, or null
export function parameterVon(art, name) {
  if (art === 'komp') return KOMP_PARAMETER.find((x) => x.name === name) ?? null;
  if (art === 'saett') return SAETT_PARAMETER.find((x) => x.name === name) ?? null;
  if (art === 'lim') return LIM_PARAMETER.find((x) => x.name === name) ?? null;
  if (art === 'utility') return UTIL_PARAMETER.find((x) => x.name === name) ?? null;
  if (art === 'bk') return BK_PARAMETER.find((x) => x.name === name) ?? null;
  if (art === 'trans') return TRANS_PARAMETER.find((x) => x.name === name) ?? null;
  if (art === 'bild') return BILD_PARAMETER.find((x) => x.name === name) ?? null;
  if (art === 'gate') return GATE_PARAMETER.find((x) => x.name === name) ?? null;
  if (art === 'mb') {
    const mu = /^u([1-3])\/([a-z]+)$/.exec(name);
    if (mu) return MB_UP_PARAMETER.find((x) => x.name === mu[2]) ?? null;
    const mm = /^b([1-3])\/([a-z]+)$/.exec(name);
    return mm ? MB_BAND_PARAMETER.find((x) => x.name === mm[2]) ?? null : MB_KOPF_PARAMETER.find((x) => x.name === name) ?? null;
  }
  const m = /^b([1-8])\/([a-z]+)$/.exec(name);
  if (m) {
    const q = EQ_BAND_PARAMETER.find((x) => x.name === m[2]);
    if (!q) return null;
    const b = Number(m[1]) - 1;
    return m[2] === 'typ' ? { ...q, vorgabe: EQ_BAND_TYP_VORGABE[b] } : m[2] === 'freq' ? { ...q, vorgabe: EQ_BAND_FREQ_VORGABE[b] } : q;
  }
  const d = /^d([1-8])\/([a-z]+)$/.exec(name);
  if (d) return EQ_DYN_PARAMETER.find((x) => x.name === d[2]) ?? null;
  return EQ_KOPF_PARAMETER.find((x) => x.name === name) ?? EQ_DYN_KOPF.find((x) => x.name === name) ?? null;
}
// the text of a value for the readout next to a control
export function wertText(art, name, v) {
  const q = parameterVon(art, name);
  if (!q) throw new Error(`unknown ${art} parameter ${name}`);
  if (q.typ === 'schalter') return v >= 0.5 ? 'on' : 'off';
  if (q.typ === 'wahl') return q.optionen[Math.round(v)] ?? String(v);
  if (art === 'komp') return paramText(name, v);
  if ((art === 'gate' || art === 'mb') && name.endsWith('ratio')) return `${v.toFixed(1)}:1`;
  if (art === 'gate' && (name === 'hold' || name === 'attack' || name === 'release')) return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ms`;
  if (art === 'trans' && name === 'tempo') return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ms`;
  if (art === 'bild') {   // widths as percentages (100 % = unchanged), mono below as a frequency or off
    if (name.startsWith('breite')) return `${Math.round(v * 100)} %`;
    if (name === 'mono_unter') return v < 1 ? 'off' : `${Math.round(Math.max(v, 20))} Hz`;
  }
  if (art === 'lim' && name === 'abklingen') return `${Math.round(v)} ms`;
  if (art === 'utility') {   // width as a percentage (100 % = unchanged), mono below as a frequency or off, balance as a side and an amount
    if (name === 'breite') return `${Math.round(v * 100)} %`;
    if (name === 'mono_unter') return v < 1 ? 'off' : `${Math.round(Math.max(v, 20))} Hz`;
    if (name === 'balance') return Math.abs(v) < 0.005 ? 'centre' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)} %`;
  }
  if (art === 'eq' && q.einheit === 'ms') return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ms`;
  if (art === 'mb' && q.einheit === 'ms') return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ms`;
  if (q.einheit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v.toFixed(v >= 100 ? 0 : 1)} Hz`;
  if (name === 'mix') return `${Math.round(v * 100)} %`;
  if (name.endsWith('q')) return v.toFixed(2);
  return `${v.toFixed(1)} ${q.einheit}`;
}

// ---- the strips and their chains (pure) ---------------------------------------------------------------------------------------------------------
// [{id, name, art: 'spur'|'grp'|'ret'|'pm', inserts}] in page order: tracks, groups by number, returns by number, the master last
export function straenge(p) {
  if (!p) return [];
  const nachNr = (l) => [...(l ?? [])].sort((a, b) => a.nr - b.nr);
  return [
    ...(p.spuren ?? []).map((s) => ({ id: s.id, name: s.name, art: 'spur', inserts: s.inserts ?? [], rack: s.rack, geraet: s.geraet })),
    ...nachNr(p.gruppen).map((g) => ({ id: g.id, name: `Group ${g.name}`, art: 'grp', inserts: g.inserts ?? [], rack: g.rack })),
    ...nachNr(p.returns).map((r) => ({ id: r.id, name: `Return ${r.name}`, art: 'ret', inserts: r.inserts ?? [], rack: r.rack })),
    { id: 'master', name: 'Master', art: 'pm', inserts: p.master?.inserts ?? [], rack: p.master?.rack },
  ];
}
export const anzahl = (p, art) => straenge(p).reduce((n, s) => n + s.inserts.filter((i) => i.art === art).length, 0);
export const frei = (p, art) => MAX_ART[art] - anzahl(p, art);
export const anzahlKomp = (p) => anzahl(p, 'komp');
export const freieKomp = (p) => frei(p, 'komp');
// the five places of a strip: the stages in order, then null for the free ones
export const plaetze = (strang) => Array.from({ length: MAX_PLAETZE }, (_, i) => strang?.inserts?.[i] ?? null);
// the command of the add button, or null when the chain has five stages or the pool of that kind is empty
export function neuerInsertBefehl(p, strangId, art = 'komp') {
  const s = straenge(p).find((x) => x.id === strangId);
  if (!s || !MAX_ART[art] || s.inserts.length >= MAX_PLAETZE || frei(p, art) <= 0) return null;
  return { befehl: 'insert_setzen', strang_id: strangId, pos: s.inserts.length, art, ...(art === 'bk' ? { graph: BK_STANDARD_GRAPH } : {}) };
}
export const paramBefehl = (insertId, param, wert) => ({ befehl: 'insert_param_setzen', insert_id: insertId, param, wert });
export const anBefehl = (insertId, an) => ({ befehl: 'insert_an', insert_id: insertId, an });
export const entfernenBefehl = (insertId) => ({ befehl: 'insert_entfernen', insert_id: insertId });
export const ordnungBefehl = (strangId, reihenfolge) => ({ befehl: 'insert_ordnung', strang_id: strangId, reihenfolge });
export const preBefehl = (returnId, pre) => ({ befehl: 'return_aendern', return_id: returnId, pre });
// the order after moving the stage at `von` by `schritt` (-1 left, +1 right); null at the edge
export function verschoben(ids, von, schritt) {
  const nach = von + schritt;
  if (von < 0 || von >= ids.length || nach < 0 || nach >= ids.length) return null;
  const r = [...ids]; [r[von], r[nach]] = [r[nach], r[von]];
  return r;
}
// ---- the gain-reduction readings (pure) -----------------------------------------------------------------------------------------------------------
// /e/ins_gr ,sf (kanal `ins/komp/<n>`, gr_db >= 0) comes at 20 Hz for every stage that computed in the last block and stops when it does not (bypass, removed).
// A reading counts for 500 ms (the same rule as the meters of the mix tools in effects.js), then the stage shows "-". stand: {slot: {db, t}}.
export const INS_GR_FRIST_MS = 500;
// the key of a reading in the store: the compressor keeps its plain number, the other kinds are `saett<n>` (the clipper's clip amount), `lim<n>`, `gate<n>`, `mb<n>`, `trans<n>` (the transient shaper's largest gain change)
const grSchluessel = (art, n) => (art === 'komp' ? n : `${art}${n}`);
export function insGrAufnehmen(stand, f, jetzt) {
  const kanal = typeof f?.kanal === 'string' ? f.kanal : '';
  const band = /^ins\/mb\/([0-9]+)\/b([1-3])$/.exec(kanal);   // strand 13 slice 4: the per-band reading of an mb stage, signed (positive = reduction, negative = lift), stored as `mb<n>/b<m>`
  if (band) {
    const n = Number(band[1]), w = f?.gr_db;
    if (n < 1 || n > MAX_ART.mb || typeof w !== 'number' || !Number.isFinite(w)) return false;
    stand[`${grSchluessel('mb', n)}/b${band[2]}`] = { db: w, t: jetzt };
    return true;
  }
  const m = /^ins\/(komp|saett|lim|gate|mb|trans|eq)\/([0-9]+)$/.exec(kanal);
  const n = m ? Number(m[2]) : 0;
  const w = f?.gr_db;
  if (n < 1 || n > (m ? MAX_ART[m[1]] : 0) || typeof w !== 'number' || !Number.isFinite(w)) return false;
  stand[grSchluessel(m[1], n)] = { db: m[1] === 'eq' ? w : Math.max(0, w), t: jetzt };   // strand 5: an EQ stage with a dynamic band reports its deepest change, signed (positive = cut, negative = boost)   // T8: the limiter stages report on ins/lim/<n>, stored as `lim<n>` (the compressor keeps its plain number)
  return true;
}
export function insGrLesung(stand, slot, jetzt) {
  const g = stand?.[slot];
  return g && jetzt - g.t < INS_GR_FRIST_MS ? g.db : null;
}
/** The reading of a stage of kind `art` ('komp', 'saett', 'lim', 'gate' or 'mb') and slot, or null (the 500 ms rule). */
export const insGrLesungArt = (stand, art, slot, jetzt) => insGrLesung(stand, grSchluessel(art, slot), jetzt);
// milliseconds until the next fresh reading expires, or null when none is fresh (the page schedules its reset with it)
export function insGrAblaufIn(stand, jetzt) {
  let m = null;
  for (const g of Object.values(stand ?? {})) if (jetzt - g.t < INS_GR_FRIST_MS) m = m === null ? g.t + INS_GR_FRIST_MS - jetzt : Math.min(m, g.t + INS_GR_FRIST_MS - jetzt);
  return m;
}
// ---- the input and output level readings (pure; device faces T9) ----------------------------------------------------------------------------------
// /e/stufe_pegel ,sff (kanal `ins/komp/<n>` or `ins/lim/<n>`, ein_db, aus_db: peak in dBFS since the previous report, -200 for silence) comes at 20 Hz for every compressor or limiter stage
// that computed in the last block. The same 500 ms freshness rule as the gain reduction. stand: {kanal: {ein, aus, t}}. The channel compressor's reports (`komp/<channel>`) are refused here.
export function insPegelAufnehmen(stand, f, jetzt) {
  const m = /^ins\/(komp|lim|gate|mb)\/([0-9]+)$/.exec(typeof f?.kanal === 'string' ? f.kanal : '');
  const n = m ? Number(m[2]) : 0;
  if (n < 1 || n > (m ? MAX_ART[m[1]] : 0) || typeof f.ein_db !== 'number' || typeof f.aus_db !== 'number' || !Number.isFinite(f.ein_db) || !Number.isFinite(f.aus_db)) return false;
  stand[f.kanal] = { ein: f.ein_db, aus: f.aus_db, t: jetzt };
  return true;
}
export function insPegelLesung(stand, kanal, jetzt) {
  const g = stand?.[kanal];
  return g && jetzt - g.t < INS_GR_FRIST_MS ? { ein: g.ein, aus: g.aus } : null;
}
export const insGrText = (db) => (db === null ? '–' : `${db.toFixed(1)} dB`);
export const insertLabels = (strang, nr, art = 'komp') => {
  const n = (ARTEN[art] ?? HOST_ART).name;
  return {
    neu: `Add ${art === 'eq' ? 'an' : 'a'} ${n} to ${strang}`, an: `Bypass ${n} ${nr} on ${strang}`, name: `${n[0].toUpperCase()}${n.slice(1)} ${nr} on ${strang}: parameters`,
    links: `Move ${n} ${nr} on ${strang} earlier`, rechts: `Move ${n} ${nr} on ${strang} later`, weg: `Remove ${n} ${nr} from ${strang}`,
  };
};

// ---- the rack of a strip (pure; slice 4c) ---------------------------------------------------------------------------------------------------------
export const MAX_RACK = 12;          // equal to project/model.ts MAX_RACK (the contract), checked by tests/production_rack.test.mjs
export const MAX_MAKROS = 4;         // macros per rack
export const MAX_MAKRO_ZIELE = 16;   // mappings per strip (= ARR_MAKRO_ZIELE of the core)
export const MAKRO_NAME_MAX = 24;
// can a macro drive this parameter? Continuous ones only: not a switch, not a step list, not the compressor key (the project refuses the rest, param_nicht_stetig)
export const makroFaehig = (q) => !!q && q.typ !== 'schalter' && q.typ !== 'wahl';
// every parameter name of a stage in popover order (the EQ: head rows then the bands)
export function parameterNamen(art) {
  if (art === 'host') return [];   // a plugin's parameters are not macro targets (task 11)
  const kopf = KOPF[art].map((q) => q.name);
  if (art === 'mb') return [...kopf, ...Array.from({ length: MB_BAENDER }, (_, i) => MB_BAND_PARAMETER.map((q) => mbBandName(i + 1, q.name))).flat(),
    ...Array.from({ length: MB_BAENDER }, (_, i) => MB_UP_PARAMETER.map((q) => mbUpName(i + 1, q.name))).flat()];
  if (art !== 'eq') return kopf;
  const baender = [];
  for (let m = 1; m <= EQ_BAENDER; m++) for (const q of EQ_BAND_PARAMETER) baender.push(eqBandName(m, q.name));
  for (let m = 1; m <= EQ_BAENDER; m++) for (const q of EQ_DYN_PARAMETER) baender.push(eqDynName(m, q.name));
  return [...kopf, ...baender, ...EQ_DYN_KOPF.map((q) => q.name)];
}
export const parameterLabel = (art, name) => {
  const q = parameterVon(art, name), m = /^[bdu]([1-8])\//.exec(name);
  return `${m ? `${bandText(art, Number(m[1]))} ` : ''}${q.label}`;
};
// the four macros of a strip as the editor sees them: [{name, ziel: [{insert, param, von, bis}]}] (empty ones when the strip has no rack)
export function rackMakros(strang) {
  const r = strang?.rack;
  return Array.from({ length: MAX_MAKROS }, (_, i) => ({ name: r?.namen?.[i] ?? '', ziel: (r?.makros?.[i]?.ziel ?? []).map((z) => ({ ...z })) }));
}
export const rackWerte = (strang) => Array.from({ length: MAX_MAKROS }, (_, i) => strang?.rack?.werte?.[i] ?? 0);
// a strip can have macros when it has a chain or an instrument rack with a member parameter to drive
export const hatRack = (strang) => (strang?.inserts?.length ?? 0) > 0 || gliedZiele(strang).length > 0;
export const rackZiele = (strang) => rackMakros(strang).reduce((n, m) => n + m.ziel.length, 0);
// the macro (1-based) that drives a parameter of a stage of this strip, or null
export function gemapptVon(strang, insertId, param) {
  const m = rackMakros(strang);
  for (let i = 0; i < m.length; i++) if (m[i].ziel.some((z) => z.insert === insertId && z.param === param)) return i + 1;
  return null;
}
// the value a macro at position `m` (0..1) gives the parameter of a mapping
export const makroWert = (z, m) => z.von + Math.min(Math.max(m, 0), 1) * (z.bis - z.von);
// the parameters of the strip's stages a mapping can still be added for: [{insert, art, param, text}] (continuous, not mapped yet)
export function freieZiele(strang) {
  const aus = [];
  (strang?.inserts ?? []).forEach((st, pos) => {
    for (const name of parameterNamen(st.art)) {
      if (!makroFaehig(parameterVon(st.art, name)) || gemapptVon(strang, st.id, name) !== null) continue;
      aus.push({ insert: st.id, art: st.art, param: name, text: `${ARTEN[st.art].kurz} ${pos + 1} · ${parameterLabel(st.art, name)}` });
    }
  });
  return aus;
}
// 1.9 U8 T11: the member parameters a macro may drive (E12; the twin of gliedMakroParam in project/model.ts): RB-338 four smoothed ones, bk k1..k64, gain_db of any
// member but Surge. [{glied, param, text}] in member order; a strip without a rack device offers none.
const GLIED_RB_PARAMETER = [['lautstaerke', 'Volume'], ['cutoff', 'Cutoff'], ['resonanz', 'Resonance'], ['env_mod', 'Env mod']];
const GLIED_BK_PARAMETER = Array.from({ length: 64 }, (_, i) => [`k${i + 1}`, `K${i + 1}`]);
const GLIED_GAIN = ['gain_db', 'Gain'];
export function gliedParameter(g) {
  if (!g || g.art === 'wirt') return [];
  const eigene = g.art === 'intern' && g.name === 'rb338' ? GLIED_RB_PARAMETER : g.art === 'intern' && g.name === 'bk' ? GLIED_BK_PARAMETER : [];
  return [...eigene, GLIED_GAIN];
}
export function gliedZiele(strang) {
  if (strang?.geraet?.art !== 'rack') return [];
  return strang.geraet.glieder.flatMap((m) => gliedParameter(m.geraet).map(([param, name]) => ({ glied: m.id, param, text: `${m.id.toUpperCase()} ${geraetName(m.geraet)} · ${name}` })));
}
// {min, max, einheit, schritt} of a member parameter (the range the project checks von/bis against), or null
export function gliedZielBereich(strang, gliedId, param) {
  const m = strang?.geraet?.art === 'rack' ? strang.geraet.glieder.find((x) => x.id === gliedId) : null;
  if (!m || !gliedParameter(m.geraet).some(([n]) => n === param)) return null;
  return param === 'gain_db' ? { min: -60, max: 12, einheit: 'dB', schritt: 0.5 } : { min: 0, max: 1, einheit: '', schritt: 0.01 };
}
export const gemapptGliedVon = (strang, gliedId, param) => rackMakros(strang).some((m) => m.ziel.some((z) => z.glied === gliedId && z.param === param));
export const freieGliedZiele = (strang) => gliedZiele(strang).filter((f) => !gemapptGliedVon(strang, f.glied, f.param));
// the mapping edits: each returns the new macros array (the caller sends it whole), or null when the edit is not possible
export function zielHinzu(makros, nr, insert, param, q) {
  if (makros.reduce((n, m) => n + m.ziel.length, 0) >= MAX_MAKRO_ZIELE || !q) return null;
  const neu = makros.map((m) => ({ ...m, ziel: m.ziel.map((z) => ({ ...z })) }));
  neu[nr - 1].ziel.push({ insert, param, von: q.min, bis: q.max });
  return neu;
}
export function zielHinzuGlied(makros, nr, glied, param, q) {
  if (makros.reduce((n, m) => n + m.ziel.length, 0) >= MAX_MAKRO_ZIELE || !q) return null;
  const neu = makros.map((m) => ({ ...m, ziel: m.ziel.map((z) => ({ ...z })) }));
  neu[nr - 1].ziel.push({ glied, param, von: q.min, bis: q.max });
  return neu;
}
export function zielWeg(makros, nr, k) {
  if (!makros[nr - 1]?.ziel[k]) return null;
  const neu = makros.map((m) => ({ ...m, ziel: m.ziel.map((z) => ({ ...z })) }));
  neu[nr - 1].ziel.splice(k, 1);
  return neu;
}
export function zielWerte(makros, nr, k, von, bis) {
  if (!makros[nr - 1]?.ziel[k] || !Number.isFinite(von) || !Number.isFinite(bis)) return null;
  const neu = makros.map((m) => ({ ...m, ziel: m.ziel.map((z) => ({ ...z })) }));
  Object.assign(neu[nr - 1].ziel[k], { von, bis });
  return neu;
}
export function makroName(makros, nr, name) {
  if (!makros[nr - 1] || name.length > MAKRO_NAME_MAX) return null;
  const neu = makros.map((m) => ({ ...m, ziel: m.ziel.map((z) => ({ ...z })) }));
  neu[nr - 1].name = name;
  return neu;
}
// the commands (names stay out of the command when empty)
export const rackSetzenBefehl = (strangId, makros) => ({
  befehl: 'rack_setzen', strang_id: strangId,
  makros: makros.map((m) => ({ ...(m.name ? { name: m.name } : {}),
    ziel: m.ziel.map((z) => ('glied' in z ? { glied: z.glied, param: z.param, von: z.von, bis: z.bis } : { insert: z.insert, param: z.param, von: z.von, bis: z.bis })) })),
});
// the stored variations of a strip's rack [{name, werte}] and the three commands (one /proj/aendern body each; null for an unknown kind or a bad name)
export const rackVariationen = (strang) => (strang?.rack?.variationen ?? []).map((v) => ({ name: v.name, werte: [...v.werte] }));
const VARIATION_ART = { speichern: 'makro_variation_speichern', laden: 'makro_variation_laden', loeschen: 'makro_variation_loeschen' };
export function variationBefehl(strangId, art, name) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!VARIATION_ART[art] || n.length < 1 || n.length > VARIATION_NAME_MAX) return null;
  return { befehl: VARIATION_ART[art], strang_id: strangId, name: n };
}
export const rackMakroBefehl = (strangId, nr, wert) => ({ befehl: 'rack_makro', strang_id: strangId, nr, wert });
export const rackLabels = (strang) => ({
  knopf: `Rack of ${strang}`, regler: (nr, name) => `${name || `Macro ${nr}`} of the rack on ${strang}`, name: (nr) => `Name of macro ${nr} on ${strang}`,
  neu: (nr) => `Add a mapping to macro ${nr} on ${strang}`, wahl: (nr) => `Parameter to add to macro ${nr} on ${strang}`,
  von: (nr, t) => `${t}: value at macro ${nr} = 0`, bis: (nr, t) => `${t}: value at macro ${nr} = 1`, weg: (nr, t) => `Remove ${t} from macro ${nr} on ${strang}`,
});

// ---- the page ----------------------------------------------------------------------------------------------------------------------------------
// the parameter descriptors of a kind in popover order (the EQ: the head rows, then bands)
export const KOPF = { komp: KOMP_PARAMETER, saett: SAETT_PARAMETER, lim: LIM_PARAMETER, utility: UTIL_PARAMETER, bk: BK_PARAMETER, gate: GATE_PARAMETER, mb: MB_KOPF_PARAMETER, trans: TRANS_PARAMETER, bild: BILD_PARAMETER, eq: EQ_KOPF_PARAMETER };
/** Panel adapter of one bk stage: values from the stage in the project, writes as insert_param_setzen through the coalescing writer of the K rows. */
export const baueInsertAdapter = (ctx, s, insertId) => ({
  // a parameter a rack macro drives (slice 4c, like the K rows): its value is what the macro gives, and the control is blocked (no param_gemappt refusals)
  get: (param) => {
    const strang = straenge(ctx.st.projekt).find((t) => t.id === s.id);
    const x = (strang?.inserts ?? []).find((y) => y.id === insertId);
    const nr = strang && x ? gemapptVon(strang, insertId, param) : null;
    if (nr !== null) { const z = strang.rack.makros[nr - 1].ziel.find((y) => y.insert === insertId && y.param === param); return makroWert(z, rackWerte(strang)[nr - 1]); }
    return typeof x?.werte?.[param] === 'number' ? x.werte[param] : undefined;
  },
  gesperrt: (param) => { const strang = straenge(ctx.st.projekt).find((t) => t.id === s.id); return !!strang && gemapptVon(strang, insertId, param) !== null; },
  set: (param, v) => ctx.aendere(`${param.toUpperCase()} ${ARTEN.bk.name} on ${s.name}`, [paramBefehl(insertId, param, v)], `${insertId}:${param}`),
});

export function bindeInsertDienste(ctx) {
  const { greift, graphNamen, graphLatenzen, schl, ladeGraphNamen } = stufenZustand(ctx);   // shared with the floating popovers (insert_popover.js)
  bindeStufenPopover(ctx);
  bindeRackFenster(ctx);
  let graphenGeholt = false;    // the list is fetched once for the latency text when a project uses a Baukasten graph
  const lage = new Map();      // insert id -> HostLage {status, latenz, gemessen, grund?, fenster?} of the plugin stages (polled while the project has any)
  let lageTimer = null;
  const pegel = {};            // {kanal: {ein, aus, t}} the readings of /e/stufe_pegel (compressor and limiter stages), read by the device faces
  const gr = {};               // {slot: {db, t}} the readings of /e/ins_gr (compressor slots as numbers, limiter slots as `lim<n>`: the EQ and the saturator report none)
  const faces = bindeInsertFace(ctx, () => gr, () => pegel);   // the device faces (insert_face.js): the opener below, the project listener and the head hooks live there
  // what the shared dock (dock_host.js) reads from here
  ctx.insertFaceOeffnen = (s, i) => faces.oeffne(s, i);
  ctx.hostLage = (id) => lage.get(id) ?? null;
  ctx.hostLagen = () => [...lage.values()];
  ctx.grLesung = (insert, jetzt) => insGrLesungArt(gr, insert.art, insert.slot, jetzt);
  ctx.graphLatenzen = graphLatenzen;
  ctx.pluginFenster = (insertId) => pluginFenster(insertId);

  // the plugin window of a stage: the dock chip menu and the window button share this
  async function pluginFenster(insertId) {
    const h = lage.get(insertId);
    const r = await ctx.holeJson(`/proj/insert/${encodeURIComponent(insertId)}/fenster`, { an: !h?.fenster });
    if (r.status !== 200) { ctx.melde(ctx.antwortText(r), true); return; }
    if (r.j?.fenster === false && r.j.grund) ctx.melde(HOST_FENSTER_TEXT[r.j.grund] ?? r.j.grund, true);
    if (r.j && typeof r.j.fenster === 'boolean') lage.set(insertId, { ...(h ?? {}), fenster: r.j.fenster });   // the dock redraws on its own tick
  }
  // the state of the hosts: GET /proj/aktuell `hosts`, every second while one is not ready, else every 4 s; no plugin stage in the project: no request at all
  async function holeHosts() {
    clearTimeout(lageTimer); lageTimer = null;
    const p = ctx.st.projekt;
    if (!p || !straenge(p).some((x) => x.inserts.some((y) => y.art === 'host'))) { lage.clear(); return; }
    const r = await ctx.holeGet('/proj/aktuell');
    if (r.status === 200 && Array.isArray(r.j?.hosts)) { lage.clear(); for (const h of r.j.hosts) lage.set(h.insert_id, h); }
    const noch = [...lage.values()].some((h) => h.status === 'startet') || lage.size === 0;
    lageTimer = setTimeout(holeHosts, noch ? HOST_POLL_MS.warten : HOST_POLL_MS.ruhe);
  }

  ctx.beimEreignis.push((a, f) => { if (a === '/e/ins_gr') insGrAufnehmen(gr, f, performance.now()); });
  ctx.beimEreignis.push((a, f) => { if (a === '/e/stufe_pegel') insPegelAufnehmen(pegel, f, performance.now()); });   // only an open face reads the store
  ctx.beimProjekt.push((p) => {
    if (p && !graphenGeholt && [...(p.spuren ?? []), ...(p.gruppen ?? []), ...(p.returns ?? []), p.master].some((x) => x?.geraet?.name === 'bk' || (x?.inserts ?? []).some((i) => i.art === 'bk'))) {
      graphenGeholt = true;
      ladeGraphNamen();
    }
    if (p && straenge(p).some((x) => x.inserts.some((y) => y.art === 'host'))) { if (!lageTimer) holeHosts(); } else { clearTimeout(lageTimer); lageTimer = null; lage.clear(); }
  });
}
