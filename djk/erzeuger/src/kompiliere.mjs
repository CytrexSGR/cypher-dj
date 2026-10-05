// Mustertext → { muster } oder { fehler: 'Zeile N: …' } (Plan 2026-09-27). Ein Strudel-Ausdruck, darf über mehrere
// Zeilen gehen. Syntax prüft acorn (mit Zeile), dann wird der Ausdruck mit dem Strudel-Scope ausgewertet und einmal
// abgefragt, damit auch Fehler der Mini-Notation hier und nicht erst im Takt auffallen.
import { SCOPE, SCOPE_NAMEN, acorn } from './strudel.mjs';

export function kompiliere(text) {
  const quelle = String(text ?? '').trim();
  if (!quelle) return { fehler: 'Zeile 1: leeres Muster' };
  try {
    acorn.parse(`(\n${quelle}\n)`, { ecmaVersion: 2022 });   // Zeile 1 des Musters ist Zeile 2 hier
  } catch (e) {
    const zeile = Math.min(quelle.split('\n').length, Math.max(1, (e.loc?.line ?? 2) - 1));  // Fehler am Ende: letzte Zeile
    return { fehler: `Zeile ${zeile}: ${String(e.message).replace(/ \(\d+:\d+\)$/, '')}` };
  }
  let m;
  try {
    m = new Function(...SCOPE_NAMEN, `"use strict"; return (\n${quelle}\n);`)(...SCOPE_NAMEN.map((k) => SCOPE[k]));
    if (!m || typeof m.queryArc !== 'function') return { fehler: 'Zeile 1: kein Strudel-Muster (queryArc fehlt)' };
    m.queryArc(0, 1);
  } catch (e) {
    return { fehler: `Zeile 1: ${e.message}` };
  }
  return { muster: m };
}
