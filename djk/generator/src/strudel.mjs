// Strudel-Kern in Node ohne Browser (ADR 017): nur Muster zu Ereignissen (queryArc). Pakete aus STRUDEL_PAKETE
// (default: the Strudel folder of contract/orte.ts, <root>/strudel or ~/strudel, 1.2.6). acorn aus dem Transpiler-Paket prüft die Syntax mit Zeilennummer.
import { strudelOrdner } from '../../contract/orte.ts';
let P = process.env.STRUDEL_PAKETE;
if (!P) {
  try { P = `${strudelOrdner()}/packages`; }
  catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }   // 2: a unit with RestartPreventExitStatus=2 does not restart in a loop
}
const core = await import(`${P}/core/index.mjs`);
const mini = await import(`${P}/mini/index.mjs`);
const tonal = await import(`${P}/tonal/index.mjs`);  // Studio S5: scale(), Notennamen (Erhebung: queryArc gemessen)
await core.evalScope(core, mini, tonal);
mini.miniAllStrings();

// Anchor of the pattern being compiled (cycle in which it starts to apply). kompiliere() sets it for the synchronous
// evaluation; .rein()/.raus() capture it at call time, so later compiles do not change an older pattern.
let anker = 0;
export const setzeAnker = (a) => { anker = Number.isFinite(a) ? a : 0; };

// Level of one hap, scaled by f: `gain` if the pattern set one, else `velocity`, else a new gain (MIDI streams multiply
// velocity (0.9) by gain, kit streams read gain ?? velocity ?? 1, so each field the stream reads is the one that is scaled).
const skaliere = (v, f) => {
  if (v == null || typeof v !== 'object') return v;
  if (v.gain !== undefined) return { ...v, gain: Number(v.gain) * f };
  if (v.velocity !== undefined) return { ...v, velocity: Number(v.velocity) * f };
  return { ...v, gain: f };
};
const faktor = (hap, a, n, rein) => {
  const k = Math.min(1, Math.max(0, (Number((hap.whole ?? hap.part).begin) - a) / n));
  return rein ? k * k : (1 - k) * (1 - k);
};
// schon: bars of the fade that already elapsed before this pattern starts (time zero = anchor - schon).
const blende = (muster, n, rein, schon = 0) => {
  const bars = Number(n);
  const name = rein ? 'rein' : 'raus';
  if (!(bars > 0)) throw new Error(`${name}(n): n must be > 0 bars`);
  const s = Number(schon);
  if (!Number.isFinite(s) || s < 0 || s >= bars) throw new Error(`${name}(n, schon): schon must be >= 0 and < n (${bars}), got ${schon}`);
  const a = anker - s;
  return muster.withHap((h) => h.withValue((v) => skaliere(v, faktor(h, a, bars, rein))));
};
core.Pattern.prototype.rein = function (n, schon) { return blende(this, n, true, schon ?? 0); };
core.Pattern.prototype.raus = function (n, schon) { return blende(this, n, false, schon ?? 0); };

export const SCOPE = { ...core, ...core.controls, ...tonal, ANKER: 0 };
export const SCOPE_NAMEN = Object.keys(SCOPE).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
export const acorn = await import(`${P}/transpiler/node_modules/acorn/dist/acorn.mjs`);
