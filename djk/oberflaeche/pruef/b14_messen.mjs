// Package 1.14 slice 4 (bounce, N08): the arithmetic of the real-core acceptance pruef/abnahme_b14.mjs (U5b), pure and without network. Calibrated in
// tests/pruef_b14_messen.test.mjs (every negative control trips there). Model pruef/w7_messen.mjs, whose null test it re-exports.
import { kanonisch } from '../projekt/modell.ts';

export { nullDifferenz, nullOk, NULL_TOR_DB, versatz } from './w7_messen.mjs';

// Undo comparison key (spec B-AK3): the canonical project without rev, wiedergabe_rev, every dekodiert (main and take clips) and the id counters
// naechste_id and naechste_noten_id. The counters only rise and are in no patch (projekt/patch.ts ZAEHLER), so an undo leaves them raised. Takes,
// automation, sends and every other field count (stronger than w7 standSchluessel).
export function projektSchluessel(p) {
  const q = structuredClone(p);
  delete q.rev; delete q.wiedergabe_rev; delete q.naechste_id; delete q.naechste_noten_id;
  for (const s of q.spuren ?? []) for (const c of [...(s.clips ?? []), ...(s.takes ?? []).flatMap((t) => t.clips ?? [])]) delete c.dekodiert;
  return kanonisch(q);
}

// Frames where an impulse starts: the first sample at or above the threshold after one below it (the click material is a 2-sample impulse per beat)
export function klickOnsets(x, schwelle = 0.25) {
  const aus = [];
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= schwelle && (i === 0 || Math.abs(x[i - 1]) < schwelle)) aus.push(i);
  return aus;
}

// Page port of a test instance (tests/hilfen/instanz.mjs, pruef/stapel.mjs, djk-start): 47300 + 1000 * (letter - 96); c gives 50300, e gives 52300
export function port(instanz) {
  if (!/^[a-z]$/.test(instanz)) throw new Error(`instance '${instanz}': one lower-case letter expected`);
  return 47300 + 1000 * (instanz.charCodeAt(0) - 96);
}

// Case TE (tempo limit): do two onset lists (frames) agree within `tol` frames? Different counts, or two empty lists, are never equal (an empty
// detection would otherwise pass for "the same").
export function onsetsVergleich(a, b, tol = 1) {
  const n = Math.min(a.length, b.length);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return { gleich: a.length > 0 && a.length === b.length && max <= tol, n_a: a.length, n_b: b.length, max_abw: max };
}
