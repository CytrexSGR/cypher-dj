// Strudel-Kern in Node ohne Browser (ADR 017): nur Muster zu Ereignissen (queryArc). Pakete aus STRUDEL_PAKETE
// (Vorgabe ~/strudel/packages, 1.2.6). acorn aus dem Transpiler-Paket prüft die Syntax mit Zeilennummer.
const P = process.env.STRUDEL_PAKETE ?? `${process.env.HOME}/strudel/packages`;
const core = await import(`${P}/core/index.mjs`);
const mini = await import(`${P}/mini/index.mjs`);
const tonal = await import(`${P}/tonal/index.mjs`);  // Studio S5: scale(), Notennamen (Erhebung: queryArc gemessen)
await core.evalScope(core, mini, tonal);
mini.miniAllStrings();
export const SCOPE = { ...core, ...core.controls, ...tonal };
export const SCOPE_NAMEN = Object.keys(SCOPE).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
export const acorn = await import(`${P}/transpiler/node_modules/acorn/dist/acorn.mjs`);
