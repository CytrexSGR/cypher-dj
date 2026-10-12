// Kindprozess für den Sperr-Test: legt N Tracks in dieselbe Liste (Aufruf: node sammlung_schreiber.mjs <ordner> <slug> <präfix-hex> <n>).
// Die Sperre wartet nie (Re-Review N1): bei 409 liste_busy wiederholt DIESER Prozess nach kurzer Pause, wie die Seite es täte.
import { Sammlungen } from '../../sammlung.ts';
const [ordner, slug, praefix, n] = process.argv.slice(2);
const s = new Sammlungen(ordner);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < Number(n); i++) {
  for (let versuch = 0; ; versuch++) {
    try { s.legeHinzu(slug, 'track', `${praefix}${i.toString(16).padStart(14, '0')}`); break; }
    catch (e) { if (e.fehler !== 'liste_busy' || versuch > 2000) throw e; await pause(1 + Math.random() * 3); }
  }
}
