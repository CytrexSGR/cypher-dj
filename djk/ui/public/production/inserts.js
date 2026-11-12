// PRODUCTION (1.10 Slice 4a/4b): the insert chain of every strip (track, group, return, master). One row per strip in the INSERTS block under the returns:
// four places, the stages in signal order from the left, the first free place offers a compressor, an EQ and a saturator (+ Comp, + EQ, + Sat, + Lim), each stage
// has a bypass button, a name button that opens the parameter popover, arrows to reorder and a remove button. The compressor popover is a slider list with
// the key; the EQ popover has the output gain, the proportional-Q switch and eight bands (switch, type, frequency, gain, Q, slope, placement); the saturator
// has drive, output and mix. Each strip row says its chain latency and the delay the core adds to keep it in time (pdc.js, slice 4b T13), the header the largest path latency. Every operation goes through ctx.aendere to POST /proj/aendern
// (insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung), so it lands in the project and in the undo history. A knob or a
// bypass is live only (the server sends control changes, no new playback); add, remove and reorder are structure changes (a swap in the core).
// Slice 4c: a strip with a chain can have a rack of four macro knobs (button "Rack" on the strip row). A macro drives parameters of the strip's stages
// from a `from` to a `to` value; while a parameter is mapped, its own control is greyed and shows the value the macro produces. The knob moves send
// rack_makro (a control change, no new playback), the mapping editor sends rack_setzen with the whole table (the pure helpers below build it).
// 1.9 U8 T11 (spec E12, E13): a macro can also drive a parameter of a MEMBER of the strip's instrument rack (target {glied, param, von, bis}); the editor reads,
// shows and writes back both target kinds. The variations list (up to 8 named snapshots of the four macro values) sends makro_variation_*.
// The pre/post switch of a return is in returns.js (preBefehl lives here with the other command builders).

import { pdcRechnen, latenzZeile, streifenText, hostLatenzen, msText } from './pdc.js';
import { baueParameterListe } from './plugin_parameter.js';
import { SC_EIGEN, schluesselGruppen, schluesselBefehl, schluesselWert, schluesselLabel, duckBefehl, duckKicks } from './key_choice.js';
import { geraetName } from './rack_device.js';
import { baueFrontplatte } from '../panel.js';

export const MAX_PLAETZE = 4;      // equal to project/model.ts MAX_INSERTS_PRO_STRANG, checked by tests/production_inserts.test.mjs
export const MAX_KOMP = 12;        // equal to MAX_INS_KOMP
export const MAX_EQ = 8;           // equal to MAX_INS_EQ (pool 2 measured 2026-11-06, routing-1-10.md; 8 since arr-fx slice 2)
export const MAX_SAETT = 4;        // equal to MAX_INS_SAETT (4 since arr-fx slice 2)
export const MAX_LIM = 2;          // equal to MAX_INS_LIM (2 since arr-fx slice 2)
export const MAX_UTIL = 8;         // equal to MAX_INS_UTIL (arr-fx)
export const MAX_BK = 8;           // equal to MAX_INS_BK (arr-bk)
export const MAX_VARIATIONEN = 8;     // equal to MAX_VARIATIONEN of project/model.ts (tests/production_rack.test.mjs)
export const VARIATION_NAME_MAX = 32;  // equal to VARIATION_NAME_MAX
export const MAX_ART = { komp: MAX_KOMP, eq: MAX_EQ, saett: MAX_SAETT, lim: MAX_LIM, utility: MAX_UTIL, bk: MAX_BK };
// arr-bk: the graph the `+ Fx` button puts on a strip; another effect graph is chosen with insert_setzen (replace) from the Hand or the graphen list
export const BK_STANDARD_GRAPH = 'fx-delay-sync';
// per kind: the short button text, the name of the stage, the pool-full text
export const ARTEN = {
  komp: { kurz: 'Comp', name: 'compressor', voll: 'No free compressor', neu: 'Add a compressor' },
  eq: { kurz: 'EQ', name: 'EQ', voll: 'No free EQ', neu: 'Add an EQ' },
  saett: { kurz: 'Sat', name: 'saturator', voll: 'No free saturator', neu: 'Add a saturator' },
  lim: { kurz: 'Lim', name: 'limiter', voll: 'No free limiter', neu: 'Add a limiter' },
  utility: { kurz: 'Util', name: 'utility', voll: 'No free utility', neu: 'Add a utility (width, bass mono, gain, balance)' },
  bk: { kurz: 'Fx', name: 'effect', voll: 'No free effect stage', neu: 'Add a Baukasten effect (the tempo-synchronous delay; other graphs through the Hand)' },
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
];
export function paramText(name, v) {
  const q = KOMP_PARAMETER.find((x) => x.name === name);
  if (!q) throw new Error(`unknown compressor parameter ${name}`);
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
// every parameter row of an EQ stage in `Insert.werte` naming: 'out', 'propq', 'b1/an' ... 'b8/platz'
export const eqBandName = (m, name) => `b${m}/${name}`;
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
  const m = /^b([1-8])\/([a-z]+)$/.exec(name);
  if (m) {
    const q = EQ_BAND_PARAMETER.find((x) => x.name === m[2]);
    if (!q) return null;
    const b = Number(m[1]) - 1;
    return m[2] === 'typ' ? { ...q, vorgabe: EQ_BAND_TYP_VORGABE[b] } : m[2] === 'freq' ? { ...q, vorgabe: EQ_BAND_FREQ_VORGABE[b] } : q;
  }
  return EQ_KOPF_PARAMETER.find((x) => x.name === name) ?? null;
}
// the text of a value for the readout next to a control
export function wertText(art, name, v) {
  const q = parameterVon(art, name);
  if (!q) throw new Error(`unknown ${art} parameter ${name}`);
  if (q.typ === 'schalter') return v >= 0.5 ? 'on' : 'off';
  if (q.typ === 'wahl') return q.optionen[Math.round(v)] ?? String(v);
  if (art === 'komp') return paramText(name, v);
  if (art === 'lim' && name === 'abklingen') return `${Math.round(v)} ms`;
  if (art === 'utility') {   // width as a percentage (100 % = unchanged), mono below as a frequency or off, balance as a side and an amount
    if (name === 'breite') return `${Math.round(v * 100)} %`;
    if (name === 'mono_unter') return v < 1 ? 'off' : `${Math.round(Math.max(v, 20))} Hz`;
    if (name === 'balance') return Math.abs(v) < 0.005 ? 'centre' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)} %`;
  }
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
// the four places of a strip: the stages in order, then null for the free ones
export const plaetze = (strang) => Array.from({ length: MAX_PLAETZE }, (_, i) => strang?.inserts?.[i] ?? null);
// the command of the add button, or null when the chain has four stages or the pool of that kind is empty
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
export function insGrAufnehmen(stand, f, jetzt) {
  const m = /^ins\/komp\/([0-9]+)$/.exec(typeof f?.kanal === 'string' ? f.kanal : '');
  const n = m ? Number(m[1]) : 0;
  const w = f?.gr_db;
  if (n < 1 || n > MAX_KOMP || typeof w !== 'number' || !Number.isFinite(w)) return false;
  stand[n] = { db: Math.max(0, w), t: jetzt };
  return true;
}
export function insGrLesung(stand, slot, jetzt) {
  const g = stand?.[slot];
  return g && jetzt - g.t < INS_GR_FRIST_MS ? g.db : null;
}
// milliseconds until the next fresh reading expires, or null when none is fresh (the page schedules its reset with it)
export function insGrAblaufIn(stand, jetzt) {
  let m = null;
  for (const g of Object.values(stand ?? {})) if (jetzt - g.t < INS_GR_FRIST_MS) m = m === null ? g.t + INS_GR_FRIST_MS - jetzt : Math.min(m, g.t + INS_GR_FRIST_MS - jetzt);
  return m;
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
  if (art !== 'eq') return kopf;
  const baender = [];
  for (let m = 1; m <= EQ_BAENDER; m++) for (const q of EQ_BAND_PARAMETER) baender.push(eqBandName(m, q.name));
  return [...kopf, ...baender];
}
export const parameterLabel = (art, name) => {
  const q = parameterVon(art, name), m = /^b([1-8])\//.exec(name);
  return `${m ? `Band ${m[1]} ` : ''}${q.label}`;
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
const KOPF = { komp: KOMP_PARAMETER, saett: SAETT_PARAMETER, lim: LIM_PARAMETER, utility: UTIL_PARAMETER, bk: BK_PARAMETER, eq: EQ_KOPF_PARAMETER };
const zeileHtml = (art, q, name, beschriftung) => {
  const wahl = q.typ === 'wahl', schalter = q.typ === 'schalter';
  const titel = `Double click: ${wertText(art, name, q.vorgabe)}`;
  let steuer;
  if (schalter) steuer = `<input class="p-ins-param" data-param="${name}" type="checkbox">`;
  else if (wahl) steuer = `<select class="p-ins-param" data-param="${name}">${q.optionen.map((o, k) => `<option value="${k}">${o}</option>`).join('')}</select>`;
  else if (q.skala === 'log') steuer = `<input class="p-ins-param" data-param="${name}" data-skala="log" type="range" min="0" max="${POS_MAX}" step="1" title="${titel}">`;
  else steuer = `<input class="p-ins-param" data-param="${name}" type="range" min="${q.min}" max="${q.max}" step="${q.schritt}" title="${titel}">`;
  return `<label class="p-ins-zeile">${beschriftung}${steuer}<output class="p-ins-wert" data-param="${name}"></output></label>`;
};
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

export function bindeInserts(ctx) {
  const { $ } = ctx;
  const block = $('inserts'), liste = $('inserts-liste'), titel = $('inserts-titel');
  const offen = new Set();     // the stages whose popover is open
  const rackOffen = new Set(); // the strips whose rack panel is open
  const greift = new Set();    // `${insert}:${param}` while the hand is on a slider
  const graphNamen = new Map(); // graph name -> regler_namen (GET /graphen): how many knob rows a bk popover shows
  const ladeGraphNamen = async () => {
    // a plain fetch: a missing list must neither throw nor change the connection state the project calls keep (holeGet does)
    let j = null;
    try { const r = await fetch('/graphen'); if (r.ok) j = await r.json(); } catch { /* no list: the popover shows k1..k8 */ }
    for (const g of j?.graphen ?? []) if (g && typeof g.name === 'string') graphNamen.set(g.name, g.regler_namen);
  };
  const panelCache = new Map(); // graph name -> {panel, regler} or null (no panel / unreachable); a bk stage with a panel shows it instead of the K rows
  const panelHol = new Set();
  const listeOffen = new Set(); // the bk stages that show the K rows although their graph has a panel (the List toggle)
  const holePanel = async (name) => {
    if (typeof name !== 'string' || panelCache.has(name) || panelHol.has(name)) return;
    panelHol.add(name);
    let aus = null, antwort = false;   // antwort: the server answered; a network failure or an error status is not cached (the next open asks again)
    try {
      const r = await fetch(`/graphen/panel?name=${encodeURIComponent(name)}`);
      if (r.ok) { const j = await r.json(); aus = j.panel ? { panel: j.panel, regler: j.regler ?? {} } : null; antwort = true; }
    } catch { /* no panel for now: the K rows */ }
    panelHol.delete(name);
    if (antwort) panelCache.set(name, aus);
    if (aus) zeige(ctx.st.projekt, true);
  };
  /** Panel adapter of one bk stage: values from the stage in the project, writes as insert_param_setzen through the coalescing writer of the K rows. */
  const insertAdapter = (s, insertId) => baueInsertAdapter(ctx, s, insertId);
  const schl = new Map();      // insert id -> {gruppen} (the server's key options of the stage) or {fehler} (why they are not available)
  let schluessel = '';
  const lage = new Map();      // insert id -> HostLage {status, latenz, gemessen, grund?, fenster?} of the plugin stages (polled while the project has any)
  let lageTimer = null;
  const gr = {};               // {slot: {db, t}} the readings of /e/ins_gr (compressor slots only: the EQ and the saturator report none)
  let grTimer = null;

  // the gain reduction on every compressor stage: a fresh reading shows its dB, a stage that sent nothing for 500 ms goes back to "–"
  function zeigeGr() {
    const jetzt = performance.now();
    for (const el of liste.querySelectorAll('.p-stufe[data-art="komp"][data-slot]')) {
      const db = insGrLesung(gr, Number(el.dataset.slot), jetzt), z = el.querySelector('.p-ins-gr');
      z.textContent = insGrText(db);
      z.classList.toggle('wirkt', db !== null && db >= 0.05);
    }
    clearTimeout(grTimer);
    const warte = insGrAblaufIn(gr, jetzt);
    grTimer = warte === null ? null : setTimeout(zeigeGr, warte + 5);
  }

  function stufe(s, i, pos, p) {
    const host = i.art === 'host';
    const A = host ? { ...HOST_ART, kurz: hostName(i) } : ARTEN[i.art];
    const L = insertLabels(s.name, pos + 1, i.art);
    const el = document.createElement('span');
    el.className = 'p-platz p-stufe'; el.dataset.insert = i.id; el.dataset.pos = String(pos); el.dataset.slot = String(i.slot); el.dataset.art = i.art;
    el.innerHTML = `<button class="p-ins-an" aria-pressed="true">ON</button>`
      + (host ? '<span class="p-host-punkt" role="img"></span>' : '')
      + `<button class="p-ins-name" aria-expanded="false"${host ? ` title="${hostName(i).replace(/"/g, '&quot;')}"` : ''}></button>`
      + (host ? '<span class="p-host-latenz"></span><button class="p-host-fenster" aria-label="Open plugin window" title="Open plugin window">UI</button>' : '')
      + (i.art === 'komp' ? '<span class="p-ins-gr" title="Gain reduction of this compressor right now">–</span>' : '')
      + '<button class="p-ins-links" title="Move earlier in the chain">◀</button><button class="p-ins-rechts" title="Move later in the chain">▶</button>'
      + `<button class="p-ins-weg" title="Remove the ${A.name} (Undo brings it back)">✕</button>`;
    const q = (x) => el.querySelector(x);
    q('.p-ins-name').textContent = host ? hostName(i) : A.kurz.toUpperCase();
    if (host) {
      q('.p-ins-name').setAttribute('aria-label', `${hostName(i)} on ${s.name}: parameters`);
      q('.p-host-fenster').addEventListener('click', async () => {
        const h = lage.get(i.id);
        const r = await ctx.holeJson(`/proj/insert/${encodeURIComponent(i.id)}/fenster`, { an: !h?.fenster });
        if (r.status !== 200) { ctx.melde(ctx.antwortText(r), true); return; }
        if (r.j?.fenster === false && r.j.grund) ctx.melde(HOST_FENSTER_TEXT[r.j.grund] ?? r.j.grund, true);
        if (r.j && typeof r.j.fenster === 'boolean') { lage.set(i.id, { ...(h ?? {}), fenster: r.j.fenster }); zeige(ctx.st.projekt); }
      });
    }
    q('.p-ins-an').setAttribute('aria-label', L.an); q('.p-ins-name').setAttribute('aria-label', L.name);
    q('.p-ins-links').setAttribute('aria-label', L.links); q('.p-ins-rechts').setAttribute('aria-label', L.rechts); q('.p-ins-weg').setAttribute('aria-label', L.weg);
    q('.p-ins-an').addEventListener('click', () => ctx.aendereAus((pr) => {
      const x = straenge(pr).flatMap((t) => t.inserts).find((y) => y.id === i.id);
      return x ? { label: `${x.an ? 'Bypass' : 'Enable'} ${A.name} on ${s.name}`, befehle: [anBefehl(i.id, !x.an)] } : null;
    }));
    q('.p-ins-name').addEventListener('click', () => {
      if (offen.has(i.id)) offen.delete(i.id);
      else {
        offen.add(i.id);
        // the popover opens at once with the knobs known so far; the graph list arrives later and rebuilds it with as many rows as the graph defines
        if (i.art === 'bk' && !graphNamen.has(i.graph)) ladeGraphNamen().then(() => { if (graphNamen.has(i.graph) && offen.has(i.id)) zeige(ctx.st.projekt, true); });
      }
      zeige(ctx.st.projekt, true);
    });
    for (const [k, schritt] of [['.p-ins-links', -1], ['.p-ins-rechts', 1]]) {
      q(k).addEventListener('click', () => ctx.aendereAus((pr) => {
        const t = straenge(pr).find((y) => y.id === s.id);
        const r = t ? verschoben(t.inserts.map((y) => y.id), t.inserts.findIndex((y) => y.id === i.id), schritt) : null;
        return r ? { label: `Reorder inserts on ${s.name}`, befehle: [ordnungBefehl(s.id, r)] } : null;
      }));
    }
    q('.p-ins-weg').addEventListener('click', () => { offen.delete(i.id); ctx.aendere(`Remove ${A.name} from ${s.name}`, [entfernenBefehl(i.id)]); });
    return el;
  }

  // the value a control carries: a log slider maps its position, a checkbox is 0/1, everything else is the number in it
  const lies = (r, q) => (r.type === 'checkbox' ? (r.checked ? 1 : 0) : r.dataset.skala === 'log' ? freqVonPos(Number(r.value), q) : Number(r.value));
  const setze = (r, q, v) => {
    if (r.type === 'checkbox') r.checked = v >= 0.5;
    else if (r.dataset.skala === 'log') r.value = String(posVonFreq(v, q));
    else r.value = String(v);
  };

  // ---- the rack panel of a strip (slice 4c) ---------------------------------------------------------------------------------------------------
  const rackAendere = (s, label, makros) => { if (makros) ctx.aendere(label, [rackSetzenBefehl(s.id, makros)]); };
  function rackPanel(s) {
    const el = document.createElement('div');
    el.className = 'p-ins-popover p-rack'; el.dataset.strang = s.id;
    const L = rackLabels(s.name), makros = rackMakros(s), frei = freieZiele(s), freiGlied = freieGliedZiele(s), voll = rackZiele(s) >= MAX_MAKRO_ZIELE;
    for (let nr = 1; nr <= MAX_MAKROS; nr++) {
      const m = makros[nr - 1], b = document.createElement('div');
      b.className = 'p-makro p-ins-band'; b.dataset.makro = String(nr);
      b.innerHTML = '<div class="p-makro-kopf"><input class="p-makro-name" type="text" maxlength="' + MAKRO_NAME_MAX + '" placeholder="Macro ' + nr + '">'
        + '<input class="p-makro-regler" type="range" min="0" max="1" step="0.001" title="Double click: 0"><output class="p-ins-wert p-makro-wert"></output></div>'
        + '<div class="p-makro-ziele"></div><div class="p-makro-neu"><select class="p-ziel-wahl"></select><button class="p-ziel-neu">+ Map</button></div>';
      const q = (x) => b.querySelector(x);
      q('.p-makro-name').value = m.name; q('.p-makro-name').setAttribute('aria-label', L.name(nr));
      const regler = q('.p-makro-regler'), kk = `rack:${s.id}:${nr}`;
      regler.setAttribute('aria-label', L.regler(nr, m.name)); regler.disabled = !s.rack;
      const sende = () => {
        q('.p-makro-wert').textContent = `${Math.round(Number(regler.value) * 100)} %`;
        ctx.aendere(`${m.name || `Macro ${nr}`} on ${s.name}`, [rackMakroBefehl(s.id, nr, Number(regler.value))], kk);
      };
      regler.addEventListener('input', sende);
      regler.addEventListener('pointerdown', () => greift.add(kk));
      regler.addEventListener('change', () => greift.delete(kk));
      regler.addEventListener('pointerup', () => greift.delete(kk));
      regler.addEventListener('dblclick', () => { regler.value = '0'; sende(); greift.delete(kk); });
      q('.p-makro-name').addEventListener('change', (e) => rackAendere(s, `Name macro ${nr} on ${s.name}`, makroName(rackMakros(ctx.st.projekt && straenge(ctx.st.projekt).find((x) => x.id === s.id)), nr, e.target.value.trim())));
      m.ziel.forEach((z, k) => {
        // the two target kinds: a stage parameter (insert) or a member parameter (glied, 1.9 U8 T11); pq = {min, max, einheit, schritt}, t = the row text
        let pq, t;
        if ('glied' in z) {
          pq = gliedZielBereich(s, z.glied, z.param);
          const gl = gliedZiele(s).find((x) => x.glied === z.glied && x.param === z.param);
          if (!pq || !gl) return;
          t = gl.text;
        } else {
          const st = s.inserts.findIndex((x) => x.id === z.insert), stufeX = s.inserts[st];
          if (!stufeX) return;
          pq = parameterVon(stufeX.art, z.param); t = `${ARTEN[stufeX.art].kurz} ${st + 1} · ${parameterLabel(stufeX.art, z.param)}`;
        }
        const row = document.createElement('div');
        row.className = 'p-ziel'; if ('glied' in z) row.dataset.glied = z.glied; else row.dataset.insert = z.insert; row.dataset.param = z.param;
        row.innerHTML = `<span class="p-ziel-text"></span><input class="p-ziel-von" type="number" step="${pq.schritt ?? 'any'}"><input class="p-ziel-bis" type="number" step="${pq.schritt ?? 'any'}"><button class="p-ziel-weg">✕</button>`;
        row.querySelector('.p-ziel-text').textContent = t;
        const von = row.querySelector('.p-ziel-von'), bis = row.querySelector('.p-ziel-bis');
        von.value = String(z.von); bis.value = String(z.bis);
        von.setAttribute('aria-label', L.von(nr, t)); bis.setAttribute('aria-label', L.bis(nr, t));
        von.title = `Value when the macro is at 0 (${pq.min} to ${pq.max}${pq.einheit ? ` ${pq.einheit}` : ''})`; bis.title = `Value when the macro is at 1 (${pq.min} to ${pq.max}${pq.einheit ? ` ${pq.einheit}` : ''})`;
        const aendern = () => {
          const v = Number(von.value), bb = Number(bis.value);
          const ok = Number.isFinite(v) && Number.isFinite(bb) && v >= pq.min && v <= pq.max && bb >= pq.min && bb <= pq.max;
          von.classList.toggle('falsch', !ok); bis.classList.toggle('falsch', !ok);
          if (ok) rackAendere(s, `Range of ${t} on ${s.name}`, zielWerte(rackMakros(straenge(ctx.st.projekt).find((x) => x.id === s.id)), nr, k, v, bb));
        };
        von.addEventListener('change', aendern); bis.addEventListener('change', aendern);
        const weg = row.querySelector('.p-ziel-weg');
        weg.setAttribute('aria-label', L.weg(nr, t)); weg.title = 'Remove this mapping (the parameter is free again)';
        weg.addEventListener('click', () => rackAendere(s, `Remove ${t} from macro ${nr} on ${s.name}`, zielWeg(rackMakros(straenge(ctx.st.projekt).find((x) => x.id === s.id)), nr, k)));
        q('.p-makro-ziele').append(row);
      });
      const wahl = q('.p-ziel-wahl'), neu = q('.p-ziel-neu');
      wahl.setAttribute('aria-label', L.wahl(nr)); neu.setAttribute('aria-label', L.neu(nr));
      for (const f of frei) { const o = document.createElement('option'); o.value = `${f.insert}|${f.param}`; o.textContent = f.text; wahl.append(o); }
      for (const f of freiGlied) { const o = document.createElement('option'); o.value = `g|${f.glied}|${f.param}`; o.textContent = f.text; wahl.append(o); }
      wahl.disabled = neu.disabled = voll || frei.length + freiGlied.length === 0;
      neu.title = voll ? `The strip has ${MAX_MAKRO_ZIELE} mappings, the most there are` : frei.length + freiGlied.length === 0 ? 'Every continuous parameter of this chain and rack is mapped' : 'Map the chosen parameter to this macro';
      neu.addEventListener('click', () => {
        const cur = straenge(ctx.st.projekt).find((x) => x.id === s.id);
        if (wahl.value.startsWith('g|')) {
          const [, glied, param] = wahl.value.split('|');
          rackAendere(s, `Map ${param} of member ${glied} to macro ${nr} on ${s.name}`, zielHinzuGlied(rackMakros(cur), nr, glied, param, gliedZielBereich(cur, glied, param)));
          return;
        }
        const [insert, param] = wahl.value.split('|');
        const stX = cur?.inserts.find((x) => x.id === insert);
        if (!stX) return;
        rackAendere(s, `Map ${param} to macro ${nr} on ${s.name}`, zielHinzu(rackMakros(cur), nr, insert, param, parameterVon(stX.art, param)));
      });
      el.append(b);
    }
    el.append(variationen(s));
    const info = document.createElement('div');
    info.className = 'p-rack-info';
    info.textContent = `${rackZiele(s)} of ${MAX_MAKRO_ZIELE} mappings. A mapped parameter is driven by its macro; its own control is greyed.`;
    el.append(info);
    return el;
  }
  // the variations of the rack (1.9 U8 T11, E13): named snapshots of the four macro values; save under a name (an existing name is replaced), load, delete
  function variationen(s) {
    const b = document.createElement('div'), liste = rackVariationen(s);
    b.className = 'p-variationen';
    b.innerHTML = '<div class="p-variationen-kopf">Variations</div><div class="p-variationen-liste"></div>'
      + `<div class="p-variation-neu"><input class="p-variation-name" type="text" maxlength="${VARIATION_NAME_MAX}" placeholder="Name"><button class="p-variation-speichern">Save</button></div>`;
    const lst = b.querySelector('.p-variationen-liste');
    if (liste.length === 0) lst.textContent = 'None saved yet';
    for (const v of liste) {
      const r = document.createElement('div');
      r.className = 'p-variation'; r.dataset.name = v.name;
      r.innerHTML = '<span class="p-variation-text"></span><button class="p-variation-laden">Load</button><button class="p-variation-loeschen">✕</button>';
      r.querySelector('.p-variation-text').textContent = `${v.name} · ${v.werte.map((w) => Math.round(w * 100)).join(' / ')}`;
      const ld = r.querySelector('.p-variation-laden'), lo = r.querySelector('.p-variation-loeschen');
      ld.setAttribute('aria-label', `Load variation ${v.name} on ${s.name}`); ld.title = 'Set the four macros to this variation (a live change, Undo brings the old values back)';
      lo.setAttribute('aria-label', `Delete variation ${v.name} on ${s.name}`); lo.title = 'Delete this variation';
      ld.addEventListener('click', () => { const c = variationBefehl(s.id, 'laden', v.name); if (c) ctx.aendere(`Load variation ${v.name} on ${s.name}`, [c]); });
      lo.addEventListener('click', () => { const c = variationBefehl(s.id, 'loeschen', v.name); if (c) ctx.aendere(`Delete variation ${v.name} on ${s.name}`, [c]); });
      lst.append(r);
    }
    const name = b.querySelector('.p-variation-name'), sp = b.querySelector('.p-variation-speichern');
    name.setAttribute('aria-label', `Name of the variation to save on ${s.name}`); sp.setAttribute('aria-label', `Save variation on ${s.name}`);
    sp.disabled = !s.rack;
    sp.title = !s.rack ? 'Map a parameter first: a variation stores the macro values of the rack' : 'Save the four macro values under this name (an existing name is replaced)';
    sp.addEventListener('click', () => {
      const n = name.value.trim(), c = variationBefehl(s.id, 'speichern', n);
      if (!c) { ctx.melde?.(`A variation name has 1 to ${VARIATION_NAME_MAX} characters`, true); return; }
      if (liste.length >= MAX_VARIATIONEN && !liste.some((v) => v.name === n)) { ctx.melde?.(`A rack holds at most ${MAX_VARIATIONEN} variations: delete one first`, true); return; }
      ctx.aendere(`Save variation ${n} on ${s.name}`, [c]);
    });
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sp.click(); });
    return b;
  }
  // the live macro values on an open panel (a knob under the hand keeps its position)
  function rackWerteZeigen(el, s) {
    const w = rackWerte(s);
    el.querySelectorAll('.p-makro').forEach((b) => {
      const nr = Number(b.dataset.makro), r = b.querySelector('.p-makro-regler');
      if (!greift.has(`rack:${s.id}:${nr}`)) r.value = String(w[nr - 1]);
      r.disabled = !s.rack;
      b.querySelector('.p-makro-wert').textContent = `${Math.round(w[nr - 1] * 100)} %`;
    });
  }

  function popover(s, i, p) {
    const el = document.createElement('div');
    el.className = `p-ins-popover p-ins-${i.art}`; el.dataset.insert = i.id;
    if (i.art === 'host') {   // the generic parameter list of a plugin: its own module, the values live in the plugin
      const weg = `/proj/insert/${encodeURIComponent(i.id)}`;
      baueParameterListe(el, { holeListe: () => ctx.holeGet(`${weg}/parameter`), sende: (w) => ctx.holeJson(`${weg}/param`, { werte: w }), fehler: (r) => ctx.melde(ctx.antwortText(r), true) });
      return el;
    }
    let umschalter = null;
    if (i.art === 'bk') {
      holePanel(i.graph);
      const info = panelCache.get(i.graph);
      if (info) {   // the front panel in place of the K rows, with a List toggle for the rows
        umschalter = document.createElement('button');
        umschalter.type = 'button'; umschalter.className = 'p-ins-liste';
        const liste = listeOffen.has(i.id);
        umschalter.textContent = liste ? 'Panel' : 'List';
        umschalter.setAttribute('aria-label', `${liste ? 'Show the front panel' : 'Show the parameter list'} of the effect on ${s.name}`);
        umschalter.addEventListener('click', () => { if (listeOffen.has(i.id)) listeOffen.delete(i.id); else listeOffen.add(i.id); zeige(ctx.st.projekt, true); });
        if (!liste) {
          el.append(umschalter);
          const host = document.createElement('div');
          el.append(host);
          el.panel = baueFrontplatte(host, { panel: info.panel, regler: info.regler, adapter: insertAdapter(s, i.id) });
          return el;
        }
      }
    }
    const kopf = i.art === 'bk' ? BK_PARAMETER.slice(0, bkZahl(graphNamen.get(i.graph))) : KOPF[i.art];
    let html = kopf.map((q) => zeileHtml(i.art, q, q.name, q.label)).join('');
    if (i.art === 'komp') html += `<label class="p-ins-zeile">Key<select class="p-ins-sc" aria-label="Sidechain key of the compressor on ${s.name}"></select><output></output></label>`;
    if (i.art === 'eq') {
      for (let m = 1; m <= EQ_BAENDER; m++) {
        html += `<div class="p-ins-band" data-band="${m}"><span class="p-ins-band-kopf">Band ${m}</span>`
          + EQ_BAND_PARAMETER.map((q) => { const n = eqBandName(m, q.name); return zeileHtml('eq', parameterVon('eq', n), n, q.label); }).join('') + '</div>';
      }
    }
    el.innerHTML = html;
    if (umschalter) el.prepend(umschalter);   // the K rows of a graph that has a panel: back to the panel
    for (const r of el.querySelectorAll('.p-ins-param')) {
      const name = r.dataset.param, k = `${i.id}:${name}`, q = parameterVon(i.art, name);
      const m = /^b([1-8])\//.exec(name);
      r.closest('.p-ins-zeile').dataset.name = name;
      r.setAttribute('aria-label', `${m ? `Band ${m[1]} ` : ''}${q.label} of the ${ARTEN[i.art].name} on ${s.name}`);
      const sende = () => {
        const v = lies(r, q);
        el.querySelector(`.p-ins-wert[data-param="${name}"]`).textContent = wertText(i.art, name, v);
        ctx.aendere(`${m ? `Band ${m[1]} ` : ''}${q.label} ${ARTEN[i.art].name} on ${s.name}`, [paramBefehl(i.id, name, v)], k);
      };
      const stetig = r.type === 'range';
      r.addEventListener(stetig ? 'input' : 'change', sende);
      if (stetig) {
        r.addEventListener('pointerdown', () => greift.add(k));
        r.addEventListener('change', () => greift.delete(k));
        r.addEventListener('pointerup', () => greift.delete(k));
        r.addEventListener('dblclick', () => { setze(r, q, q.vorgabe); sende(); greift.delete(k); });
      }
    }
    const sc = el.querySelector('.p-ins-sc');
    if (sc) {
      sc.addEventListener('change', (e) => ctx.aendere(`Key compressor on ${s.name}`, [schluesselBefehl(i.id, e.target.value)]));
      ladeOptionen(s, i, el);
    }
    return el;
  }

  // the key options of one stage come from the server (every cell answered by its rules); the select shows the offline fallback until they arrive
  async function ladeOptionen(s, i, el) {
    schl.delete(i.id);
    const r = await ctx.holeGet(`/proj/routing?optionen=${encodeURIComponent(i.id)}`);
    const o = r.status === 200 ? r.j?.straenge?.flatMap((x) => x.stufen).find((x) => x.insert_id === i.id)?.optionen : null;
    schl.set(i.id, o ? { gruppen: schluesselGruppen(o, ctx.st.projekt) } : { fehler: `Key options not available: ${ctx.fehlerText(r)}` });
    const jetzt = straenge(ctx.st.projekt).flatMap((x) => x.inserts).find((x) => x.id === i.id);
    if (el.isConnected && jetzt) werte(el, s, jetzt, ctx.st.projekt);
  }

  function werte(el, s, i, p) {
    el.panel?.aktualisiere();
    const strang = straenge(p).find((x) => x.id === s.id), mw = rackWerte(strang);
    for (const r of el.querySelectorAll('.p-ins-param')) {
      const name = r.dataset.param, q = parameterVon(i.art, name);
      // slice 4c: a mapped parameter is driven by its macro; its own control is greyed and shows what the macro gives (Q4: the own row is ignored)
      const nr = gemapptVon(strang, i.id, name), zeile = r.closest('.p-ins-zeile');
      let v = i.werte[name];
      if (nr !== null) { const z = strang.rack.makros[nr - 1].ziel.find((x) => x.insert === i.id && x.param === name); v = makroWert(z, mw[nr - 1]); }
      r.disabled = nr !== null;
      zeile.classList.toggle('gemappt', nr !== null);
      zeile.title = nr !== null ? `Driven by macro ${nr}${strang.rack.namen?.[nr - 1] ? ` (${strang.rack.namen[nr - 1]})` : ''} of the rack on ${s.name}: remove the mapping to use this control` : '';
      if (!greift.has(`${i.id}:${name}`)) setze(r, q, v);
      el.querySelector(`.p-ins-wert[data-param="${name}"]`).textContent = (nr !== null ? `M${nr} ` : '') + wertText(i.art, name, v);
    }
    const sc = el.querySelector('.p-ins-sc');
    if (!sc) return;
    const info = schl.get(i.id), jetzt = schluesselWert(i);
    // before the server answers (or when it cannot): own signal and the tracks' pre keys, the offline fallback
    let gr = info?.gruppen ?? [{ titel: 'Tracks', eintraege: [{ label: SC_EIGEN, wert: 'own', gesperrt: false },
      ...(p.spuren ?? []).map((x) => ({ label: `Track ${x.nr} ${x.name}`, wert: `spur:${x.nr}:pre`, gesperrt: false }))] }];
    // a stage whose key is not in the list (stored before the rules changed) still shows what it holds
    if (!gr.some((g) => g.eintraege.some((e) => e.wert === jetzt))) gr = [...gr, { titel: 'Current', eintraege: [{ label: schluesselLabel(jetzt, p), wert: jetzt, gesperrt: false }] }];
    const sig = JSON.stringify(gr);
    if (sc.dataset.sig !== sig) {
      sc.dataset.sig = sig; sc.textContent = '';
      for (const g of gr) {
        const og = document.createElement('optgroup'); og.label = g.titel;
        for (const e of g.eintraege) {
          const o = document.createElement('option'); o.value = e.wert; o.textContent = e.label; o.disabled = e.gesperrt; if (e.text) o.title = e.text;
          og.append(o);
        }
        sc.append(og);
      }
    }
    sc.value = jetzt;
    sc.disabled = !!info?.fehler;
    sc.closest('label').querySelector('output').textContent = info?.fehler ?? '';
  }

  // the status dot, the latency and the window button of one plugin stage from its HostLage
  function zeigeHost(el, i) {
    const h = lage.get(i.id), punkt = el.querySelector('.p-host-punkt');
    const status = h?.status ?? 'unbekannt';
    punkt.className = `p-host-punkt ${status}`; punkt.dataset.status = status; punkt.title = hostDotTitel(h); punkt.setAttribute('aria-label', hostDotTitel(h));
    const l = el.querySelector('.p-host-latenz');
    l.textContent = h && Number.isFinite(h.latenz) ? msText(h.latenz) : '';
    l.title = h ? (h.gemessen ? 'Latency the plugin reports' : 'Estimated latency: not measured yet') : '';
    const f = el.querySelector('.p-host-fenster');
    f.classList.toggle('an', !!h?.fenster); f.setAttribute('aria-label', h?.fenster ? 'Close plugin window' : 'Open plugin window'); f.title = f.getAttribute('aria-label');
  }
  // the state of the hosts: GET /proj/aktuell `hosts`, every second while one is not ready, else every 4 s; no plugin stage in the project: no request at all
  async function holeHosts() {
    clearTimeout(lageTimer); lageTimer = null;
    const p = ctx.st.projekt;
    if (!p || !straenge(p).some((x) => x.inserts.some((y) => y.art === 'host'))) { lage.clear(); return; }
    const r = await ctx.holeGet('/proj/aktuell');
    if (r.status === 200 && Array.isArray(r.j?.hosts)) {
      const alt = JSON.stringify([...lage.entries()]);
      lage.clear(); for (const h of r.j.hosts) lage.set(h.insert_id, h);
      if (JSON.stringify([...lage.entries()]) !== alt) zeige(ctx.st.projekt);
    }
    const noch = [...lage.values()].some((h) => h.status === 'startet') || lage.size === 0;
    lageTimer = setTimeout(holeHosts, noch ? HOST_POLL_MS.warten : HOST_POLL_MS.ruhe);
  }

  function zeige(p, neuBauen = false) {
    block.hidden = !p;
    if (!p) { liste.textContent = ''; schluessel = ''; return; }
    const str = straenge(p), f = Object.fromEntries(Object.keys(MAX_ART).map((a) => [a, frei(p, a)]));
    const ids = new Set(str.flatMap((s) => s.inserts.map((i) => i.id)));
    for (const id of [...offen]) if (!ids.has(id)) offen.delete(id);
    for (const id of [...rackOffen]) if (!str.some((x) => x.id === id && hatRack(x))) rackOffen.delete(id);
    // the header: the compressor count as in 4a, then the EQ, the saturator, the limiter and the utility; every full pool is said in words too (a tooltip does not exist on a phone)
    titel.textContent = `INSERTS (${anzahl(p, 'komp')}/${MAX_KOMP})` + ` · EQ ${anzahl(p, 'eq')}/${MAX_EQ} · Sat ${anzahl(p, 'saett')}/${MAX_SAETT}` + ` · Lim ${anzahl(p, 'lim')}/${MAX_LIM}` + ` · Util ${anzahl(p, 'utility')}/${MAX_UTIL}` + ` · Fx ${anzahl(p, 'bk')}/${MAX_BK}`
      + Object.keys(MAX_ART).filter((a) => f[a] <= 0).map((a) => ` · ${ARTEN[a].voll}`).join('')
      + (latenzZeile(p, hostLatenzen([...lage.values()])) ? ` · ${latenzZeile(p, hostLatenzen([...lage.values()]))}` : '');
    const pdc = pdcRechnen(p, hostLatenzen([...lage.values()]));
    const neu = JSON.stringify([str.map((s) => [s.id, s.name, s.inserts.map((i) => [i.id, i.an]), s.rack ? [s.rack.slot, s.rack.namen, s.rack.makros, s.rack.variationen] : null, s.geraet?.art === 'rack' ? s.geraet.glieder : null]), f, [...offen].sort(), [...rackOffen].sort(), (p.spuren ?? []).map((s) => [s.nr, s.name]), (p.gruppen ?? []).map((g) => [g.nr, g.name]), (p.returns ?? []).map((r) => [r.nr, r.name]), pdc.streifen, pdc.gesamt]);
    if (neu !== schluessel || neuBauen) {
      schluessel = neu;
      liste.textContent = '';
      for (const s of str) {
        const zeile = document.createElement('div');
        zeile.className = 'p-kette'; zeile.dataset.strang = s.id;
        const n = document.createElement('span');
        n.className = 'p-kette-name'; n.textContent = s.name;
        zeile.append(n);
        const lt = streifenText(pdc.streifen[s.id]);
        if (lt) {
          const l = document.createElement('span');
          l.className = 'p-kette-latenz'; l.textContent = lt;
          zeile.append(l);
        }
        const first = s.inserts.length;
        plaetze(s).forEach((i, pos) => {
          if (i) { const e = stufe(s, i, pos, p); zeile.append(e); return; }
          const e = document.createElement('span');
          e.className = 'p-platz leer'; e.dataset.pos = String(pos);
          if (pos === first && first < MAX_PLAETZE) {
            for (const art of Object.keys(ARTEN)) {   // the first free place offers every kind: + Comp, + EQ, + Sat, + Lim
              const b = document.createElement('button');
              b.className = 'p-ins-neu'; b.dataset.art = art; b.textContent = `+ ${ARTEN[art].kurz}`;
              b.disabled = f[art] <= 0; b.title = f[art] <= 0 ? ARTEN[art].voll : ARTEN[art].neu;
              b.setAttribute('aria-label', insertLabels(s.name, 0, art).neu);
              b.addEventListener('click', () => { const c = neuerInsertBefehl(ctx.st.projekt, s.id, art); if (c) ctx.aendere(`Add ${ARTEN[art].name} to ${s.name}`, [c]); });
              e.append(b);
            }
          }
          zeile.append(e);
        });
        const kicks = s.art === 'spur' && s.inserts.length < MAX_PLAETZE && f.komp > 0 ? duckKicks(p, s.id) : [];
        if (kicks.length > 0) {   // Duck by Kick: one compressor with the Kick Sidechain values, keyed by the chosen track
          const d = document.createElement('select');
          d.className = 'p-duck'; d.dataset.strang = s.id; d.title = 'Add a compressor keyed by a kick track (Kick Sidechain values)';
          d.setAttribute('aria-label', `Duck ${s.name} by a kick track`);
          d.append(new Option('Duck by Kick…', ''), ...kicks.map((k) => new Option(`Track ${k.nr} ${k.name}`, k.id)));
          d.addEventListener('change', () => { const k = d.value; d.value = ''; if (k) ctx.aendere(`Duck ${s.name} by ${kicks.find((x) => x.id === k).name}`, [duckBefehl(s.id, k)]); });
          zeile.append(d);
        }
        if (hatRack(s)) {
          const rb = document.createElement('button');
          rb.className = 'p-rack-knopf'; rb.dataset.strang = s.id; rb.textContent = rackZiele(s) > 0 ? `Rack ${rackZiele(s)}` : 'Rack';
          rb.title = 'Four macro knobs that drive parameters of this chain and of the rack members'; rb.setAttribute('aria-label', rackLabels(s.name).knopf); rb.setAttribute('aria-expanded', String(rackOffen.has(s.id)));
          rb.addEventListener('click', () => { if (rackOffen.has(s.id)) rackOffen.delete(s.id); else rackOffen.add(s.id); zeige(ctx.st.projekt, true); });
          zeile.append(rb);
        }
        for (const i of s.inserts) if (offen.has(i.id)) zeile.append(popover(s, i, p));
        if (rackOffen.has(s.id)) zeile.append(rackPanel(s));
        liste.append(zeile);
      }
    }
    for (const s of str) {
      const zeile = liste.querySelector(`.p-kette[data-strang="${s.id}"]`);
      const rp = zeile.querySelector('.p-rack');
      if (rp) rackWerteZeigen(rp, s);
      for (const i of s.inserts) {
        const st = zeile.querySelector(`.p-stufe[data-insert="${i.id}"]`);
        st.classList.toggle('aus', !i.an);
        if (i.art === 'host') zeigeHost(st, i);
        const an = st.querySelector('.p-ins-an');
        an.classList.toggle('an', i.an); an.setAttribute('aria-pressed', String(i.an)); an.textContent = i.an ? 'ON' : 'OFF';
        // 1.16 rest U7 (F8): the origin mark of a stage set by a preset; a stage without `preset` gets no element at all
        const m = i.preset ? ctx.presetMarke?.('insert', i.id) ?? null : null;
        let tag = st.querySelector('.p-ins-preset');
        if (m) {
          if (!tag) { tag = document.createElement('span'); tag.className = 'p-ins-preset'; st.querySelector('.p-ins-name').after(tag); }
          tag.textContent = m.text; tag.title = m.titel; tag.classList.toggle('geaendert', m.geaendert);
        } else tag?.remove();
        const pop = zeile.querySelector(`.p-ins-popover[data-insert="${i.id}"]`);
        st.querySelector('.p-ins-name').setAttribute('aria-expanded', String(!!pop));
        if (pop) werte(pop, s, i, p);
      }
    }
    zeigeGr();
  }
  ctx.beimMarken?.push(() => zeige(ctx.st.projekt));   // a preset mark arrived or changed (preset_marker.js)
  ctx.beimEreignis.push((a, f) => { if (a === '/e/ins_gr' && insGrAufnehmen(gr, f, performance.now())) zeigeGr(); });
  // a project that has inserts opens the block; an empty one keeps it closed (the arrangement needs the height)
  ctx.beimProjekt.push((p, wechsel) => {
    if (wechsel && p) block.open = straenge(p).some((s) => s.inserts.length > 0);
    zeige(p);
    if (p && straenge(p).some((x) => x.inserts.some((y) => y.art === 'host'))) { if (!lageTimer) holeHosts(); } else { clearTimeout(lageTimer); lageTimer = null; lage.clear(); }
  });
}
