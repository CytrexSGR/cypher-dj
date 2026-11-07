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
// The pre/post switch of a return is in returns.js (preBefehl lives here with the other command builders).

import { pdcRechnen, latenzZeile, streifenText } from './pdc.js';

export const MAX_PLAETZE = 4;      // equal to projekt/modell.ts MAX_INSERTS_PRO_STRANG, checked by tests/produktion_inserts.test.mjs
export const MAX_KOMP = 12;        // equal to MAX_INS_KOMP
export const MAX_EQ = 2;           // equal to MAX_INS_EQ (pool 2 measured 2026-11-06, routing-1-10.md)
export const MAX_SAETT = 1;        // equal to MAX_INS_SAETT
export const MAX_LIM = 1;          // equal to MAX_INS_LIM
export const MAX_ART = { komp: MAX_KOMP, eq: MAX_EQ, saett: MAX_SAETT, lim: MAX_LIM };
// per kind: the short button text, the name of the stage, the pool-full text
export const ARTEN = {
  komp: { kurz: 'Comp', name: 'compressor', voll: 'No free compressor', neu: 'Add a compressor' },
  eq: { kurz: 'EQ', name: 'EQ', voll: 'No free EQ', neu: 'Add an EQ' },
  saett: { kurz: 'Sat', name: 'saturator', voll: 'No free saturator', neu: 'Add a saturator' },
  lim: { kurz: 'Lim', name: 'limiter', voll: 'No free limiter', neu: 'Add a limiter' },
};
export const KOMP_VOLL_TEXT = 'No free compressor';
export const KOMP_NEU_TEXT = 'Add a compressor';
// The compressor parameters, a literal list on purpose (the page cannot import the generated .ts table); tests/produktion_inserts.test.mjs binds
// name, range, default and unit to djk/oberflaeche/projekt/insert_schluessel.ts. schritt: the slider step; label: the English name on the page.
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

// The saturator and EQ parameters, literal lists like the compressor's (bound to the contract by tests/produktion_inserts.test.mjs).
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
    ...(p.spuren ?? []).map((s) => ({ id: s.id, name: s.name, art: 'spur', inserts: s.inserts ?? [], rack: s.rack })),
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
  return { befehl: 'insert_setzen', strang_id: strangId, pos: s.inserts.length, art };
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
// A reading counts for 500 ms (the same rule as the meters of the mix tools in effekte.js), then the stage shows "-". stand: {slot: {db, t}}.
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
  const n = ARTEN[art].name;
  return {
    neu: `Add ${art === 'eq' ? 'an' : 'a'} ${n} to ${strang}`, an: `Bypass ${n} ${nr} on ${strang}`, name: `${n[0].toUpperCase()}${n.slice(1)} ${nr} on ${strang}: parameters`,
    links: `Move ${n} ${nr} on ${strang} earlier`, rechts: `Move ${n} ${nr} on ${strang} later`, weg: `Remove ${n} ${nr} from ${strang}`,
  };
};

// ---- the rack of a strip (pure; slice 4c) ---------------------------------------------------------------------------------------------------------
export const MAX_RACK = 12;          // equal to projekt/modell.ts MAX_RACK (the contract), checked by tests/produktion_rack.test.mjs
export const MAX_MAKROS = 4;         // macros per rack
export const MAX_MAKRO_ZIELE = 16;   // mappings per strip (= ARR_MAKRO_ZIELE of the core)
export const MAKRO_NAME_MAX = 24;
// can a macro drive this parameter? Continuous ones only: not a switch, not a step list, not the compressor key (the project refuses the rest, param_nicht_stetig)
export const makroFaehig = (q) => !!q && q.typ !== 'schalter' && q.typ !== 'wahl';
// every parameter name of a stage in popover order (the EQ: head rows then the bands)
export function parameterNamen(art) {
  const kopf = KOPF[art].map((q) => q.name);
  if (art !== 'eq') return kopf;
  const baender = [];
  for (let m = 1; m <= EQ_BAENDER; m++) for (const q of EQ_BAND_PARAMETER) baender.push(eqBandName(m, q.name));
  return [...kopf, ...baender];
}
const parameterLabel = (art, name) => {
  const q = parameterVon(art, name), m = /^b([1-8])\//.exec(name);
  return `${m ? `Band ${m[1]} ` : ''}${q.label}`;
};
// the four macros of a strip as the editor sees them: [{name, ziel: [{insert, param, von, bis}]}] (empty ones when the strip has no rack)
export function rackMakros(strang) {
  const r = strang?.rack;
  return Array.from({ length: MAX_MAKROS }, (_, i) => ({ name: r?.namen?.[i] ?? '', ziel: (r?.makros?.[i]?.ziel ?? []).map((z) => ({ ...z })) }));
}
export const rackWerte = (strang) => Array.from({ length: MAX_MAKROS }, (_, i) => strang?.rack?.werte?.[i] ?? 0);
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
// the mapping edits: each returns the new macros array (the caller sends it whole), or null when the edit is not possible
export function zielHinzu(makros, nr, insert, param, q) {
  if (makros.reduce((n, m) => n + m.ziel.length, 0) >= MAX_MAKRO_ZIELE || !q) return null;
  const neu = makros.map((m) => ({ ...m, ziel: m.ziel.map((z) => ({ ...z })) }));
  neu[nr - 1].ziel.push({ insert, param, von: q.min, bis: q.max });
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
  makros: makros.map((m) => ({ ...(m.name ? { name: m.name } : {}), ziel: m.ziel.map((z) => ({ insert: z.insert, param: z.param, von: z.von, bis: z.bis })) })),
});
export const rackMakroBefehl = (strangId, nr, wert) => ({ befehl: 'rack_makro', strang_id: strangId, nr, wert });
export const rackLabels = (strang) => ({
  knopf: `Rack of ${strang}`, regler: (nr, name) => `${name || `Macro ${nr}`} of the rack on ${strang}`, name: (nr) => `Name of macro ${nr} on ${strang}`,
  neu: (nr) => `Add a mapping to macro ${nr} on ${strang}`, wahl: (nr) => `Parameter to add to macro ${nr} on ${strang}`,
  von: (nr, t) => `${t}: value at macro ${nr} = 0`, bis: (nr, t) => `${t}: value at macro ${nr} = 1`, weg: (nr, t) => `Remove ${t} from macro ${nr} on ${strang}`,
});

// ---- the page ----------------------------------------------------------------------------------------------------------------------------------
const SC_EIGEN = 'Own signal';
// the parameter descriptors of a kind in popover order (the EQ: the head rows, then bands)
const KOPF = { komp: KOMP_PARAMETER, saett: SAETT_PARAMETER, lim: LIM_PARAMETER, eq: EQ_KOPF_PARAMETER };
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
export function bindeInserts(ctx) {
  const { $ } = ctx;
  const block = $('inserts'), liste = $('inserts-liste'), titel = $('inserts-titel');
  const offen = new Set();     // the stages whose popover is open
  const rackOffen = new Set(); // the strips whose rack panel is open
  const greift = new Set();    // `${insert}:${param}` while the hand is on a slider
  let schluessel = '';
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
    const A = ARTEN[i.art];
    const L = insertLabels(s.name, pos + 1, i.art);
    const el = document.createElement('span');
    el.className = 'p-platz p-stufe'; el.dataset.insert = i.id; el.dataset.pos = String(pos); el.dataset.slot = String(i.slot); el.dataset.art = i.art;
    el.innerHTML = `<button class="p-ins-an" aria-pressed="true">ON</button><button class="p-ins-name" aria-expanded="false">${A.kurz.toUpperCase()}</button>`
      + (i.art === 'komp' ? '<span class="p-ins-gr" title="Gain reduction of this compressor right now">–</span>' : '')
      + '<button class="p-ins-links" title="Move earlier in the chain">◀</button><button class="p-ins-rechts" title="Move later in the chain">▶</button>'
      + `<button class="p-ins-weg" title="Remove the ${A.name} (Undo brings it back)">✕</button>`;
    const q = (x) => el.querySelector(x);
    q('.p-ins-an').setAttribute('aria-label', L.an); q('.p-ins-name').setAttribute('aria-label', L.name);
    q('.p-ins-links').setAttribute('aria-label', L.links); q('.p-ins-rechts').setAttribute('aria-label', L.rechts); q('.p-ins-weg').setAttribute('aria-label', L.weg);
    q('.p-ins-an').addEventListener('click', () => ctx.aendereAus((pr) => {
      const x = straenge(pr).flatMap((t) => t.inserts).find((y) => y.id === i.id);
      return x ? { label: `${x.an ? 'Bypass' : 'Enable'} ${A.name} on ${s.name}`, befehle: [anBefehl(i.id, !x.an)] } : null;
    }));
    q('.p-ins-name').addEventListener('click', () => { if (offen.has(i.id)) offen.delete(i.id); else offen.add(i.id); zeige(ctx.st.projekt, true); });
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
    const L = rackLabels(s.name), makros = rackMakros(s), frei = freieZiele(s), voll = rackZiele(s) >= MAX_MAKRO_ZIELE;
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
        const st = s.inserts.findIndex((x) => x.id === z.insert), stufeX = s.inserts[st];
        if (!stufeX) return;
        const pq = parameterVon(stufeX.art, z.param), t = `${ARTEN[stufeX.art].kurz} ${st + 1} · ${parameterLabel(stufeX.art, z.param)}`;
        const row = document.createElement('div');
        row.className = 'p-ziel'; row.dataset.insert = z.insert; row.dataset.param = z.param;
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
      wahl.disabled = neu.disabled = voll || frei.length === 0;
      neu.title = voll ? `The strip has ${MAX_MAKRO_ZIELE} mappings, the most there are` : frei.length === 0 ? 'Every continuous parameter of this chain is mapped' : 'Map the chosen parameter to this macro';
      neu.addEventListener('click', () => {
        const [insert, param] = wahl.value.split('|'), cur = straenge(ctx.st.projekt).find((x) => x.id === s.id);
        const stX = cur?.inserts.find((x) => x.id === insert);
        if (!stX) return;
        rackAendere(s, `Map ${param} to macro ${nr} on ${s.name}`, zielHinzu(rackMakros(cur), nr, insert, param, parameterVon(stX.art, param)));
      });
      el.append(b);
    }
    const info = document.createElement('div');
    info.className = 'p-rack-info';
    info.textContent = `${rackZiele(s)} of ${MAX_MAKRO_ZIELE} mappings. A mapped parameter is driven by its macro; its own control is greyed.`;
    el.append(info);
    return el;
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
    let html = KOPF[i.art].map((q) => zeileHtml(i.art, q, q.name, q.label)).join('');
    if (i.art === 'komp') html += `<label class="p-ins-zeile">Key<select class="p-ins-sc" aria-label="Sidechain key of the compressor on ${s.name}"></select><output></output></label>`;
    if (i.art === 'eq') {
      for (let m = 1; m <= EQ_BAENDER; m++) {
        html += `<div class="p-ins-band" data-band="${m}"><span class="p-ins-band-kopf">Band ${m}</span>`
          + EQ_BAND_PARAMETER.map((q) => { const n = eqBandName(m, q.name); return zeileHtml('eq', parameterVon('eq', n), n, q.label); }).join('') + '</div>';
      }
    }
    el.innerHTML = html;
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
    if (sc) sc.addEventListener('change', (e) => ctx.aendere(`Key compressor on ${s.name}`, [paramBefehl(i.id, 'sc', Number(e.target.value))]));
    return el;
  }

  function werte(el, s, i, p) {
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
    const opts = [[0, SC_EIGEN], ...(p.spuren ?? []).map((s) => [s.nr, `Track ${s.nr} ${s.name}`])];
    const sig = JSON.stringify(opts);
    if (sc.dataset.sig !== sig) { sc.dataset.sig = sig; sc.textContent = ''; for (const [v, t] of opts) { const o = document.createElement('option'); o.value = String(v); o.textContent = t; sc.append(o); } }
    sc.value = String(i.sc ?? 0);
  }

  function zeige(p, neuBauen = false) {
    block.hidden = !p;
    if (!p) { liste.textContent = ''; schluessel = ''; return; }
    const str = straenge(p), f = Object.fromEntries(Object.keys(MAX_ART).map((a) => [a, frei(p, a)]));
    const ids = new Set(str.flatMap((s) => s.inserts.map((i) => i.id)));
    for (const id of [...offen]) if (!ids.has(id)) offen.delete(id);
    for (const id of [...rackOffen]) if (!str.some((x) => x.id === id && x.inserts.length > 0)) rackOffen.delete(id);
    // the header: the compressor count as in 4a, then the EQ and the saturator; every full pool is said in words too (a tooltip does not exist on a phone)
    titel.textContent = `INSERTS (${anzahl(p, 'komp')}/${MAX_KOMP})` + ` · EQ ${anzahl(p, 'eq')}/${MAX_EQ} · Sat ${anzahl(p, 'saett')}/${MAX_SAETT}` + ` · Lim ${anzahl(p, 'lim')}/${MAX_LIM}`
      + Object.keys(MAX_ART).filter((a) => f[a] <= 0).map((a) => ` · ${ARTEN[a].voll}`).join('')
      + (latenzZeile(p) ? ` · ${latenzZeile(p)}` : '');
    const pdc = pdcRechnen(p);
    const neu = JSON.stringify([str.map((s) => [s.id, s.name, s.inserts.map((i) => [i.id, i.an]), s.rack ? [s.rack.slot, s.rack.namen, s.rack.makros] : null]), f, [...offen].sort(), [...rackOffen].sort(), (p.spuren ?? []).map((s) => [s.nr, s.name]), pdc.streifen, pdc.gesamt]);
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
        if (s.inserts.length > 0) {
          const rb = document.createElement('button');
          rb.className = 'p-rack-knopf'; rb.dataset.strang = s.id; rb.textContent = rackZiele(s) > 0 ? `Rack ${rackZiele(s)}` : 'Rack';
          rb.title = 'Four macro knobs that drive parameters of this chain'; rb.setAttribute('aria-label', rackLabels(s.name).knopf); rb.setAttribute('aria-expanded', String(rackOffen.has(s.id)));
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
  ctx.beimMarken?.push(() => zeige(ctx.st.projekt));   // a preset mark arrived or changed (preset_marke.js)
  ctx.beimEreignis.push((a, f) => { if (a === '/e/ins_gr' && insGrAufnehmen(gr, f, performance.now())) zeigeGr(); });
  // a project that has inserts opens the block; an empty one keeps it closed (the arrangement needs the height)
  ctx.beimProjekt.push((p, wechsel) => { if (wechsel && p) block.open = straenge(p).some((s) => s.inserts.length > 0); zeige(p); });
}
