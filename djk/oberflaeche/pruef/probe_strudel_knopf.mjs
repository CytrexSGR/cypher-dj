// Probe MVP 2 Scheibe 3 (→ STRUDEL) am echten Kern (djk-start --instanz i): Reiter LOOPS, Knopf der ersten Zeile,
// Text am Knopf danach (s("rec0") erwartet), zweiter Klick auf denselben Loop ergibt rec1.
import { starteBrowser } from './cdp.mjs';
const URL = process.argv[2] ?? 'http://127.0.0.1:56300/';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await starteBrowser();
try {
  await b.oeffne(URL);
  await warte(1500);
  await b.klick('[data-reiter="loops"]');
  await warte(800);
  console.log('zeilen', await b.werte('document.querySelectorAll("#loopliste tr").length'));
  await b.klick('#loopliste tr .zustrudel');
  await warte(800);
  console.log('knopf nach klick', await b.werte('(() => { const k = document.querySelector("#loopliste tr .zustrudel"); return k.className + " | " + k.textContent; })()'));
  console.log('gesendet', await b.werte("JSON.stringify(window.djkGesendet.filter(g => g.loop?.aktion === 'kit'))"));
  console.log('konsole', b.konsole.length, JSON.stringify(b.konsole));
} finally { await b.zu(); }
