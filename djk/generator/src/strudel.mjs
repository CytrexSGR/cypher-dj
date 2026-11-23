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
export const SCOPE = { ...core, ...core.controls, ...tonal };
export const SCOPE_NAMEN = Object.keys(SCOPE).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
export const acorn = await import(`${P}/transpiler/node_modules/acorn/dist/acorn.mjs`);
