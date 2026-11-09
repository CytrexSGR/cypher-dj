// Probe REC-Anzeige (Hörtest 2026-09-27: Warten und Aufnahme sahen gleich aus, Fertigmeldung fern von C):
// tastet den Knopf alle 250 ms ab. Erwartet: WAIT n (blinkt) -> REC n (fest) -> SAVED (grün) -> REC.
import { starteBrowser } from './cdp.mjs';
const URL = process.argv[2] ?? 'http://127.0.0.1:56300/';
const BEATS = process.argv[3] ?? '4';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await starteBrowser();
try {
  await b.oeffne(URL);
  await warte(1500);
  await b.klick(`[data-recbeats="${BEATS}"]`);
  await b.klick('#rec-knopf');
  let vorher = '';
  for (let i = 0; i < 80; i++) {
    const z = await b.werte(`(() => { const k = document.querySelector('#rec-knopf'); return k.className + ' | ' + k.textContent; })()`);
    const beat = await b.werte(`document.querySelector('#takt').textContent`);
    if (z !== vorher) { console.log(`${(i * 0.25).toFixed(2)}s takt ${beat}: ${z}`); vorher = z; }
    await warte(250);
  }
  console.log('konsole', b.konsole.length, JSON.stringify(b.konsole));
} finally { await b.zu(); }
