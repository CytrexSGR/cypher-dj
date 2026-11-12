// 1.10 slice 5 (plan E3, E5, E8, E20, section 3.1): which sidechain key a compressor stage may listen to. The cell table, the DJ list and the reason of
// each answer come from the
// generated `key_table.ts` (docs/interfaces/schluessel_regeln.json, the same file the core loader reads); the dynamic rules that need the
// project sit here and in the core
// (arr_key.h): a strip keyed by its own output, a member track keyed by its own group, a cycle of tracks keyed by each other's post.
//
// `pruefeSchluessel` refuses with the reason literal the reason scanner sees (tests/support/reasons.mjs); a test pins the three literals to
// SCHLUESSEL_GRUND. `schluesselErlaubt` is the
// same question without a throw, for the matrix and the page.
import { BefehlFehler } from './commands.ts';
import type { Insert, Projekt } from './model.ts';
import { bewerte, ersterUngueltigerSchluessel, type Ablehnung, type SchluesselFrage } from './routing_verdict.ts';
export { vorfahren, nachkommen, ersterUngueltigerSchluessel } from './routing_verdict.ts';
export type { Ablehnung, SchluesselFrage } from './routing_verdict.ts';

/** Throws the BefehlFehler of the rules (sidechain_spaet, sidechain_zyklus, sidechain_quelle) when the stage on `traegerId` may not listen to `key`. */
export function pruefeSchluessel(p: Projekt, traegerId: string, key: SchluesselFrage, ausser?: Insert): void {
  const a = bewerte(p, traegerId, key, ausser);
  if (!a) return;
  switch (a.grund) {
    case 'sidechain_spaet': throw new BefehlFehler('sidechain_spaet', a.text);
    case 'sidechain_zyklus': throw new BefehlFehler('sidechain_zyklus', a.text);
    default: throw new BefehlFehler('sidechain_quelle', a.text);
  }
}

/** The same question without a throw: null = allowed, else the reason and its English text. */
export function schluesselErlaubt(p: Projekt, traegerId: string, key: SchluesselFrage, ausser?: Insert): Ablehnung | null {
  try {
    pruefeSchluessel(p, traegerId, key, ausser);
    return null;
  } catch (e) {
    if (e instanceof BefehlFehler) return { grund: e.grund as Ablehnung['grund'], text: e.detail ?? e.message };
    throw e;
  }
}

/** After a change of the group tree: every stage key of the project must still be valid. Refuses with the reason of the first key that is not
 *  (sidechain_zyklus, sidechain_spaet), naming the keyed strip; the caller changes nothing then. */
export function pruefeAlleSchluessel(p: Projekt): void {
  const u = ersterUngueltigerSchluessel(p);
  if (!u) return;
  const text = `${u.ablehnung.text} (stage ${u.insert.id} on ${u.strangId})`;
  throw new BefehlFehler(u.ablehnung.grund, text);
}
