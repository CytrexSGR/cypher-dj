// Probe MVP 2 Scheibe 2 (REC auf C) am echten Kern (djk-start --instanz i, stumme Senke): Längenwahl, REC-Knopf,
// /e/mitschnitt füllt die Bibliothek nach.
import { starteBrowser } from './cdp.mjs';
const URL = process.argv[2] ?? 'http://127.0.0.1:56300/';
const BILD = process.argv[3];
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await starteBrowser();
try {
  await b.oeffne(URL);
  await warte(1500);
  console.log('reclaenge 1 Takt vor Klick', await b.werte(`document.querySelector('[data-recbeats="4"]').className`));
  await b.klick('[data-recbeats="16"]');
  console.log('reclaenge 4 Takte nach Klick', await b.werte(`document.querySelector('[data-recbeats="16"]').className`));
  console.log('reclaenge 1 Takt nach Klick', await b.werte(`document.querySelector('[data-recbeats="4"]').className`));
  await b.klick('[data-recbeats="4"]');  // zurück auf 1 Takt, damit die Aufnahme kurz bleibt
  await b.klick('#rec-knopf');
  console.log('rec-knopf nach Klick', await b.werte(`document.querySelector('#rec-knopf').className`));
  await warte(6000);
  console.log('rec-knopf nach Ende', await b.werte(`document.querySelector('#rec-knopf').className`));
  console.log('loopliste', await b.werte('window.djk.loopliste.map(l => l.name)'));
  console.log('gesendet rec', await b.werte("JSON.stringify(window.djkGesendet.filter(g => g.loop?.aktion === 'rec'))"));
  console.log('nicht-200 Antworten', await b.werte('window.djkGesendet.filter(g => g.code !== 200).length'));
  console.log('konsole', b.konsole.length, JSON.stringify(b.konsole));  // alle Einträge, auch typ 'exception'
  console.log('layout', JSON.stringify(await b.werte('({sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth})')));
  if (BILD) await b.bild(BILD);
} finally { await b.zu(); }
