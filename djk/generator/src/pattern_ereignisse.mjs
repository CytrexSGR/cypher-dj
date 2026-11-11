// Strudel pattern -> the events of a clip (strudel-clip, spec docs/superpowers/specs/2026-11-10-strudel-clip.md).
// Pure and target-agnostic: code and length in, events with their Strudel fields out. Which field becomes a velocity, a kit note or an
// envelope is the business of the project layer (ui/project/pattern_clip.ts); this file only knows Strudel.
// 1 cycle = 1 bar = 4 beats (like the live studio, planner.mjs). Random patterns are frozen by asking Strudel: its randomness is a pure
// function of the cycle position, so the same query always gives the same events.
//
// Result: { ok: true, takte, laenge_beats, loop_beats, periode_takte, ereignisse, stetig, komplex, hinweise }
//      or { ok: false, grund, fehler: 'Zeile N: ...' }
import { SCOPE, SCOPE_NAMEN, acorn } from './strudel.mjs';
import { midiNote } from './window.mjs';

const P = process.env.STRUDEL_PAKETE ?? `${process.env.HOME}/strudel/packages`;
const core = await import(`${P}/core/index.mjs`);
const mini = await import(`${P}/mini/index.mjs`);

export const BEATS_JE_ZYKLUS = 4;
export const DECKEL_ZYKLEN = 64;          // cycles asked for when the length is open (repetition search); a period is only believed up to half of it
export const OHNE_WIEDERHOLUNG_TAKTE = 16; // clip length when the pattern does not repeat inside DECKEL_ZYKLEN / 2 cycles
export const MAX_EREIGNISSE = 20000;
export const MAX_TAKTE = 1024;

const r6 = (x) => Math.round(x * 1e6) / 1e6;

// --- steady fields: a control whose argument is a continuous signal (no whole), found while the code is evaluated ---------------------------
// The control functions of Strudel are wrapped once; the collector is only set during one evaluation, outside it they pass through unchanged.
let sammler = null;
const hauptName = (name) => {
  try { return Object.keys(core.controls[name](0).queryArc(0, 1)[0].value)[0] ?? name; } catch { return name; }
};
const istStetig = (arg) => {
  try {
    // a string is mini notation (steps with a whole), a number is a constant: only a pattern object can be a signal. A signal has no whole in ANY
    // slice, so a tiny slice is enough (and does not expand a dense pattern such as "bd*1000000" that is handed over as an argument).
    if (arg === undefined || arg === null || typeof arg !== 'object') return false;
    return core.reify(arg).queryArc(0, 2 ** -10).some((h) => h.whole === undefined);
  } catch { return false; }
};
function pruefeArg(name, arg) {
  if (sammler && istStetig(arg)) sammler.add(hauptName(name));
}
// cpm changes the tempo (cycles per minute), which is the project's here: during an evaluation it is recorded and does nothing, so the
// events stay at the project tempo; the clip reports it as a field without target (komplex) with a hint.
let tempoSammler = null;
const TEMPO_NAMEN = ['cpm'];
const GEWICKELT = Symbol.for('djk.muster_ereignisse.gewickelt');
function wickle() {
  if (core.Pattern.prototype[GEWICKELT]) return;
  core.Pattern.prototype[GEWICKELT] = true;
  for (const name of TEMPO_NAMEN) {
    const alt = core.Pattern.prototype[name];
    if (typeof alt !== 'function') continue;
    core.Pattern.prototype[name] = function (...a) {
      if (!tempoSammler) return alt.apply(this, a);
      tempoSammler.add(name);
      return this;
    };
  }
  for (const name of Object.keys(core.controls)) {
    const alt = core.Pattern.prototype[name];
    if (typeof alt !== 'function') continue;
    core.Pattern.prototype[name] = function (value, ...rest) { pruefeArg(name, value); return alt.call(this, value, ...rest); };
  }
}
wickle();
const SCOPE_GEWICKELT = { ...SCOPE };
for (const name of TEMPO_NAMEN) {
  const alt = SCOPE[name];
  if (typeof alt !== 'function') continue;
  // cpm(120) is a function that waits for the pattern (or takes it as a second argument)
  SCOPE_GEWICKELT[name] = (n, p) => {
    if (!tempoSammler) return alt(n, p);
    tempoSammler.add(name);
    return p === undefined ? (x) => x : p;
  };
}
for (const name of Object.keys(core.controls)) {
  const alt = SCOPE[name];
  if (typeof alt !== 'function') continue;
  SCOPE_GEWICKELT[name] = (value, ...rest) => { pruefeArg(name, value); return alt(value, ...rest); };
}

// --- errors with a place ------------------------------------------------------------------------------------------------------------------
// A mini-notation error names only the line inside the string; the place in the code is found by parsing each string literal on its own.
function miniStelle(quelle) {
  try {
    const baum = acorn.parse(`(\n${quelle}\n)`, { ecmaVersion: 2022, locations: true });
    const stack = [baum];
    const treffer = [];
    while (stack.length) {
      const n = stack.pop();
      if (n && typeof n === 'object') {
        if (n.type === 'Literal' && typeof n.value === 'string') treffer.push(n);
        for (const k of Object.keys(n)) if (k !== 'loc') { const v = n[k]; if (Array.isArray(v)) stack.push(...v); else if (v && typeof v === 'object') stack.push(v); }
      }
    }
    treffer.sort((a, b) => a.start - b.start);
    for (const n of treffer) {
      try { mini.parse(`"${n.value}"`); } catch (e) {
        // the parser error knows the place inside the string; a literal with a line break adds its own lines
        const l = e.location?.start;
        const innen = n.value.slice(0, (l?.offset ?? 1) - 1).split('\n');
        return { zeile: n.loc.start.line - 1 + innen.length - 1, spalte: innen.length > 1 ? innen.at(-1).length + 1 : n.loc.start.column + 2 + (innen[0].length) };
      }
    }
  } catch { /* the syntax check already ran */ }
  return null;
}

// Strudel reports a problem it survives (e.g. "Can't do arithmetic on control pattern": the add is skipped) only through its logger, which writes to
// console.log with a %c style marker. The lines are collected during one run and returned as hinweise, so the skipped add is not silent.
export function mitStrudelLog(f) {
  const zeilen = [];
  const alt = console.log;
  console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('%c')) { const z = a[0].slice(2); if (!zeilen.includes(z)) zeilen.push(z); } };
  try { return { wert: f(), zeilen }; } finally { console.log = alt; }
}
const TEMPO_HINWEIS = ' (the tempo is the project\'s: leave out setcps/setcpm, change the tempo of the project instead)';
const tempoHinweis = (quelle) => (/\bsetcp[sm]\s*\(/.test(quelle) ? TEMPO_HINWEIS : '');
const STRING_HINWEIS = ' (a plain string is not a pattern here: start with a pattern function, e.g. seq("0 2").add(...) or n("0 2").add(...))';

export function kompiliereMuster(text) {
  const quelle = String(text ?? '').trim();
  if (!quelle) return { ok: false, grund: 'muster_fehler', fehler: 'Zeile 1: empty pattern' };
  try {
    acorn.parse(`(\n${quelle}\n)`, { ecmaVersion: 2022 });   // line 1 of the pattern is line 2 here
  } catch (e) {
    const zeile = Math.min(quelle.split('\n').length, Math.max(1, (e.loc?.line ?? 2) - 1));
    return { ok: false, grund: 'muster_fehler', fehler: `Zeile ${zeile}: ${String(e.message).replace(/ \(\d+:\d+\)$/, '')}${tempoHinweis(quelle)}` };
  }
  const stetig = new Set();
  // musterZuEreignissen keeps the tempo collector for the whole run (a cpm inside a callback runs while the events are queried)
  const eigenerTempoSammler = tempoSammler === null;
  const tempo = eigenerTempoSammler ? new Set() : tempoSammler;
  sammler = stetig;
  tempoSammler = tempo;
  try {
    const muster = new Function(...SCOPE_NAMEN, `"use strict"; return (\n${quelle}\n);`)(...SCOPE_NAMEN.map((k) => SCOPE_GEWICKELT[k]));
    if (!muster || typeof muster.queryArc !== 'function') return { ok: false, grund: 'muster_fehler', fehler: 'Zeile 1: not a Strudel pattern (queryArc is missing)' };
    // the probe also forces errors that sit inside lazily evaluated parts; it stops early on a pattern that is far over the event limit
    if (zuDicht(muster, 1)) return { ok: false, grund: 'muster_zu_gross', fehler: `the pattern has more than ${MAX_EREIGNISSE} events in a bar: make it smaller` };
    return { ok: true, muster, stetig, tempo };
  } catch (e) {
    const msg = String(e.message);
    if (/^\[mini\]/.test(msg)) {
      const s = miniStelle(quelle);
      const kurz = msg.replace(/^\[mini\] /, '').replace(/ at line \d+/, '');
      return { ok: false, grund: 'muster_fehler', fehler: s ? `Zeile ${s.zeile}, Spalte ${s.spalte}: mini notation: ${kurz}` : `Zeile 1: mini notation: ${kurz}` };
    }
    // a JavaScript error inside the code: the stack of a new Function names <anonymous>:LINE:COL, the code starts on line 4 of it (2 header lines + 'return (')
    const m = /<anonymous>:(\d+):(\d+)/.exec(String(e.stack ?? ''));
    const zeile = m ? Math.min(quelle.split('\n').length, Math.max(1, Number(m[1]) - 3)) : 1;
    const hinweis = /^"[^"]*"\.\w+ is not a function/.test(msg) || /^'[^']*'\.\w+ is not a function/.test(msg) ? STRING_HINWEIS : '';
    return { ok: false, grund: 'muster_fehler', fehler: `Zeile ${zeile}${m ? `, Spalte ${m[2]}` : ''}: ${msg.slice(0, 300)}${hinweis}${tempoHinweis(quelle)}` };
  } finally {
    sammler = null;
    if (eigenerTempoSammler) tempoSammler = null;
  }
}

// --- events ------------------------------------------------------------------------------------------------------------------------------
const ZAHL_STELLEN = 8;
const rund = (x) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toPrecision(ZAHL_STELLEN)) : x);
const schluessel = (wert) => JSON.stringify(Object.keys(wert).sort().map((k) => [k, rund(wert[k])]));

function flach(value) {
  const werte = {};
  const komplex = [];
  if (value === null || typeof value !== 'object') return { werte: { value }, komplex };
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('_')) continue;   // Strudel internal (_slices ...)
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') werte[k] = v;
    else komplex.push(k);
  }
  return { werte, komplex };
}

// Cheap guard BEFORE the full query: ask ever larger slices from the start of the first cycle (16 times wider each step). A pattern whose density
// would make the real query huge (s("bd*1000000"), fast(1e9)) is over the limit in one of the small slices, which cost at most about 16 x the limit.
// A density that only rises in a later cycle passes this guard; the child limits (time, memory) catch it.
const SONDEN_BREITEN = [2 ** -24, 2 ** -20, 2 ** -16, 2 ** -12, 2 ** -8, 2 ** -4, 1];
export function zuDicht(muster, bis) {
  for (const w of SONDEN_BREITEN) {
    if (w > bis) break;
    if (muster.queryArc(0, w).length > MAX_EREIGNISSE) return true;
  }
  return false;
}

export function ereignisseVon(muster, von, bis) {
  const aus = [];
  const komplex = new Set();
  // cycle by cycle, so that the count stops the work as soon as it is over the limit (the events of a cycle are the haps whose onset lies in it)
  for (let c = Math.floor(von); c < bis; c++) {
    for (const h of muster.queryArc(Math.max(c, von), Math.min(c + 1, bis))) {
      if (!h.hasOnset()) continue;
      const beginn = Number(h.whole.begin), ende = Number(h.whole.end);
      const { werte, komplex: k } = flach(h.value);
      for (const x of k) komplex.add(x);
      aus.push({ zyklus: Math.floor(beginn + 1e-9), beat: beginn * BEATS_JE_ZYKLUS, laenge: (ende - beginn) * BEATS_JE_ZYKLUS, werte });
    }
    if (aus.length > MAX_EREIGNISSE) return { zuviele: true, ereignisse: aus, komplex };
  }
  aus.sort((a, b) => a.beat - b.beat);
  return { ereignisse: aus, komplex };
}

// The smallest period p (in cycles) with sig[c] == sig[c + p] for every cycle c that has a partner inside the asked range, or null.
function kleinsteStetigkeit(sig, hoechstens) {
  for (let p = 1; p <= hoechstens; p++) {
    let ok = true;
    for (let c = 0; c + p < sig.length && ok; c++) ok = sig[c] === sig[c + p];
    if (ok) return p;
  }
  return null;
}

/**
 * @param {{code: string, takte?: number|null}} a  takte: clip length in bars (cycles), null = until the pattern repeats (capped)
 */
export function musterZuEreignissen(a) {
  const { wert, zeilen } = mitStrudelLog(() => musterZuEreignissen1(a));
  if (wert.ok) wert.hinweise.push(...zeilen.slice(0, 5).map((z) => `Strudel: ${z}`));
  return wert;
}
function musterZuEreignissen1(a) {
  tempoSammler = new Set();
  try { return musterZuEreignissen2(a); } finally { tempoSammler = null; }
}
function musterZuEreignissen2({ code, takte = null }) {
  const k = kompiliereMuster(code);
  if (!k.ok) return k;
  if (takte !== null && takte !== undefined && !(typeof takte === 'number' && Number.isFinite(takte) && takte > 0 && takte <= MAX_TAKTE)) {
    return { ok: false, grund: 'argument_ungueltig', fehler: `takte: a number in (0, ${MAX_TAKTE}] expected` };
  }
  const offen = takte === null || takte === undefined;
  const frage = offen ? DECKEL_ZYKLEN : takte;
  let roh;
  try {
    if (zuDicht(k.muster, frage)) roh = { zuviele: true };
    else roh = ereignisseVon(k.muster, 0, frage);
  } catch (e) {
    return { ok: false, grund: 'muster_fehler', fehler: `Zeile 1: ${String(e.message).slice(0, 300)}` };
  }
  if (roh.zuviele) return { ok: false, grund: 'muster_zu_gross', fehler: `the pattern has more than ${MAX_EREIGNISSE} events in ${frage} bars: make it smaller` };
  const hinweise = [];
  // signature of each whole cycle: where inside the cycle, how long, which values (rounded: a sine is not bit-equal one cycle later)
  const volle = Math.floor(frage + 1e-9);
  const sig = Array.from({ length: volle }, () => []);
  for (const e of roh.ereignisse) if (e.zyklus < volle) sig[e.zyklus].push(`${r6(e.beat - e.zyklus * BEATS_JE_ZYKLUS)}|${r6(e.laenge)}|${schluessel(e.werte)}`);
  const sigText = sig.map((l) => l.sort().join(';'));
  const p = kleinsteStetigkeit(sigText, offen ? Math.floor(volle / 2) : volle - 1);
  let laengeTakte, loopTakte = null;
  if (offen) {
    if (p !== null) laengeTakte = p;
    else {
      laengeTakte = OHNE_WIEDERHOLUNG_TAKTE;
      hinweise.push(`no repetition within ${Math.floor(volle / 2)} bars: the clip is ${OHNE_WIEDERHOLUNG_TAKTE} bars long, pass takte for another length`);
    }
  } else {
    laengeTakte = takte;
    if (p !== null && Number.isInteger(takte) && p < takte) loopTakte = p;
  }
  const quellEnde = (loopTakte ?? laengeTakte) * BEATS_JE_ZYKLUS;
  const ereignisse = roh.ereignisse.filter((e) => e.beat < quellEnde - 1e-9).map((e) => {
    const m = midiNote(e.werte);
    // beat and end are rounded together: the end is the rounded end, so a note that ends where the next begins touches it exactly (no 1e-6 overlap)
    const beat = r6(e.beat);
    return { beat, laenge: r6(r6(e.beat + e.laenge) - beat), ton: m, werte: e.werte };
  });
  if (ereignisse.length === 0) hinweise.push(`the pattern has no events in ${laengeTakte} bar${laengeTakte === 1 ? '' : 's'}: the clip stays empty`);
  const tempoGenutzt = [...(k.tempo ?? [])].sort();
  if (tempoGenutzt.length) hinweise.push(`${tempoGenutzt.join(', ')} is ignored: the tempo is the project's (1 cycle = 1 bar)`);
  return {
    ok: true, takte: laengeTakte, laenge_beats: r6(laengeTakte * BEATS_JE_ZYKLUS),
    loop_beats: loopTakte === null ? null : loopTakte * BEATS_JE_ZYKLUS, periode_takte: p,
    ereignisse, stetig: [...k.stetig].sort(), komplex: [...new Set([...roh.komplex, ...tempoGenutzt])].sort(), hinweise,
  };
}
