// Probe Mediathek Slice 1/2 an einer Prüfinstanz (djk-start --instanz i, stumme Senke). Kein Ton.
import { starteBrowser } from './cdp.mjs';
const URL = process.argv[2] ?? 'http://127.0.0.1:56300/';
const TEXT = process.argv[3] ?? 'metal clouds';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await starteBrowser();
let fehl = 0;
const pruefe = (ok, was) => { console.log(`${ok ? 'OK  ' : 'FEHL'} ${was}`); if (!ok) fehl++; };
try {
  await b.oeffne(URL);
  await warte(1500);
  pruefe(await b.werte('!!document.querySelector(\'[data-reiter="library"]\')'), 'Reiter LIBRARY da');
  await b.klick('[data-reiter="library"]');
  await b.werte(`(() => { const i = document.querySelector('#lib-suche'); i.value = ${JSON.stringify(TEXT)};
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
  await warte(1500);
  const n = await b.werte('document.querySelectorAll("#libliste tr").length');
  pruefe(n >= 1, `Treffer in #libliste: ${n}`);
  const knopf = await b.werte('document.querySelector("#libliste tr:first-child td.aktion button")?.textContent ?? ""');
  pruefe(/^(LOAD A|PREPARE|MISSING)$/.test(knopf), `erster Knopf: ${knopf}`);
  pruefe((await b.werte('document.documentElement.scrollWidth <= innerWidth')) === true, 'kein Querscrollen');
  console.log('konsole', JSON.stringify(b.konsole));
  pruefe(b.konsole.filter((k) => k.typ === 'exception' || k.typ === 'error').length === 0, 'keine Fehler in der Konsole');
  if (process.argv[4] === '--vorbereiten') {
    await b.klick('#libliste tr:first-child td.aktion button');
    let k = '';
    for (let i = 0; i < 90 && !/^LOAD A/.test(k); i++) { await warte(2000); k = await b.werte('document.querySelector("#libliste tr:first-child td.aktion button")?.textContent ?? ""'); }
    pruefe(/^LOAD A/.test(k), `nach PREPARE: ${k}`);
    const mid = await b.werte('document.querySelector("#libliste tr:first-child").dataset.material');
    pruefe(await b.werte(`window.djk.bestand.some((e) => e.material_id === ${JSON.stringify(mid)})`), 'Track in TRACKS');
  }
} finally { await b.zu(); }
process.exit(fehl ? 1 : 0);
