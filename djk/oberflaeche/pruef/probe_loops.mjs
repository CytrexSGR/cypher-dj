// Probe MVP 2 am echten Kern (djk-start --instanz i, stumme Senke): Reiter LOOPS, LOAD L1, PLAY, Status und Laufbalken.
import { starteBrowser } from './cdp.mjs';
const URL = process.argv[2] ?? 'http://127.0.0.1:56300/';
const BILD = process.argv[3];
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await starteBrowser();
try {
  await b.oeffne(URL);
  await warte(1500);
  const loops = await (await fetch(URL + 'loops')).json();
  console.log('loops', loops.map((l) => l.name).join(' '));
  await b.klick('[data-reiter="loops"]');
  await warte(400);
  await b.klick('#loopliste tr:first-child button.laden.l1');
  await warte(800);
  console.log('L1 nach LOAD', await b.werte('window.djk.loops[1]?.status'));
  await b.klick('.box[data-box="1"] [data-boxplay]');
  await warte(3000);
  console.log('L1 nach PLAY', await b.werte('window.djk.loops[1]?.status'),
    'Welle', await b.werte(`(() => { const c = document.querySelector('.box[data-box="1"] [data-loopwelle]'); return c ? c.width + 'x' + c.height : 'fehlt'; })()`));
  console.log('nicht-200 Antworten', await b.werte('window.djkGesendet.filter(g => g.code !== 200).length'));
  console.log('konsole', b.konsole.length, JSON.stringify(b.konsole));  // Review: alle Einträge, auch typ 'exception'
  console.log('layout', JSON.stringify(await b.werte('({sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, box: [...document.querySelectorAll(".box")].map(e => e.scrollHeight <= e.clientHeight)})')));  // sh ≤ ih, sw ≤ iw, box alle true
  if (BILD) await b.bild(BILD);
} finally { await b.zu(); }
