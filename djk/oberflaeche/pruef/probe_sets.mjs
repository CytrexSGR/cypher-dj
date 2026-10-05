// Probe Sets an einer Prüfinstanz (djk-start --instanz i). Legt ein Set „probe-<zeit>" an, legt den ersten LIBRARY-Treffer
// hinein und prüft den Reiter SETS. Kein Ton. Aufruf: node pruef/probe_sets.mjs [URL] [Suchtext]
import { starteBrowser } from './cdp.mjs';
const FLAGGEN = process.argv.slice(2).filter((a) => a.startsWith('--'));
const POS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ALLE = FLAGGEN.includes('--alle');   // --alle TEXT1 TEXT2: zwei (kurze!) Treffer, PREPARE ALL, wartet bis 180 s (Werkstatt-Läufe!)
const IMPORT = FLAGGEN.includes('--import');   // importiert die kleinste Traktor-Liste, zählt, löscht das Set wieder
const URL = (ALLE ? null : POS[0]) ?? 'http://127.0.0.1:56300/';
const TEXT = (ALLE ? POS[0] : POS[1]) ?? 'tech';
const NAME = `probe-${Date.now()}`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let fehl = 0;
const pruefe = (ok, was) => { console.log(`${ok ? 'OK  ' : 'FEHL'} ${was}`); if (!ok) fehl++; };
const b = await starteBrowser();
try {
  await b.oeffne(URL);
  await warte(1500);
  pruefe(await b.werte('!!document.querySelector(\'[data-reiter="sets"]\')'), 'Reiter SETS da');
  if (IMPORT) {
    await b.klick('[data-reiter="sets"]');
    await warte(800);
    const liste = JSON.parse(await b.werte('fetch("/mediathek/listen").then((r) => r.json()).then(JSON.stringify)'));
    const klein = liste.reduce((m, l) => (l.n < m.n ? l : m));
    console.log(`kleinste Liste: ${klein.name} (${klein.n})`);
    pruefe(await b.werte(`!!document.querySelector('#set-import option[value="${klein.id}"]')`), 'Option für die Liste da');
    await b.werte(`(() => { const s = document.querySelector('#set-import'); s.value = "${klein.id}"; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await warte(4000);
    const zeilen = await b.werte('document.querySelectorAll("#setliste tr").length');
    pruefe(zeilen > 0 && zeilen <= klein.n, `Zeilen ${zeilen} (Liste ${klein.n}, Doppel fallen weg)`);
    pruefe((await b.werte('document.querySelector("#set-wahl").selectedOptions[0]?.textContent ?? ""')).includes(klein.name), 'importiertes Set ist gewählt');
    pruefe((await b.werte('document.querySelector("#set-import").value')) === '', 'Auswahl zurück');
    console.log(`Zusammenfassung: ${await b.werte('document.querySelector("#set-zusammenfassung").textContent')}`);
    await b.werte('(() => { window.confirm = () => true; document.querySelector("#set-loeschen").click(); return 1; })()');
    await warte(1000);
    pruefe((await b.werte(`[...document.querySelectorAll("#set-wahl option")].some((o) => o.textContent.includes(${JSON.stringify(klein.name)}))`)) === false, 'Set gelöscht');
    pruefe(b.konsole.filter((k) => k.typ === 'exception' || k.typ === 'error').length === 0, `Konsole sauber ${JSON.stringify(b.konsole)}`);
    await b.zu();
    process.exit(fehl ? 1 : 0);
  }
  if (ALLE) {
    await b.klick('[data-reiter="sets"]');
    await b.werte(`(() => { document.querySelector('#set-name').value = ${JSON.stringify(NAME)}; document.querySelector('#set-neu').click(); return 1; })()`);
    await warte(800);
    for (const text of [POS[0], POS[1]]) {
      await b.klick('[data-reiter="library"]');
      await b.werte(`(() => { const i = document.querySelector('#lib-suche'); i.value = ${JSON.stringify(text)};
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
      await warte(1500);
      await b.klick('#libliste tr:first-child button.in-set');
      await warte(600);
    }
    await b.klick('[data-reiter="sets"]');
    await warte(800);
    pruefe((await b.werte('document.querySelectorAll("#setliste tr").length')) === 2, 'zwei Posten im Set');
    const t0 = Date.now();
    await b.klick('#set-alle');
    let st = [];
    while (Date.now() - t0 < 180000) {
      await warte(3000);
      st = JSON.parse(await b.werte('JSON.stringify([...document.querySelectorAll("#setliste tr td.status")].map((x) => x.textContent))'));
      if (st.length === 2 && st.every((x) => x === 'READY' || x === 'FAILED' || x === 'MISSING')) break;
    }
    console.log(`Dauer ${Math.round((Date.now() - t0) / 1000)} s, Status ${JSON.stringify(st)}`);
    pruefe(st.length === 2 && st.every((x) => x === 'READY'), 'beide READY');
    pruefe((await b.werte('document.querySelectorAll("#setliste tr button.laden.a").length')) === 2, 'LOAD-Knöpfe da');
    pruefe(b.konsole.filter((k) => k.typ === 'exception' || k.typ === 'error').length === 0, `Konsole sauber ${JSON.stringify(b.konsole)}`);
    console.log('set', NAME);
    await b.zu();
    process.exit(fehl ? 1 : 0);
  }
  await b.klick('[data-reiter="sets"]');
  await b.werte(`(() => { document.querySelector('#set-name').value = ${JSON.stringify(NAME)}; document.querySelector('#set-neu').click(); return 1; })()`);
  await warte(800);
  pruefe((await b.werte('document.querySelector("#set-wahl").selectedOptions[0]?.textContent ?? ""')) === NAME, 'neues Set ist gewählt');
  await b.klick('[data-reiter="library"]');
  await b.werte(`(() => { const i = document.querySelector('#lib-suche'); i.value = ${JSON.stringify(TEXT)};
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
  await warte(1500);
  const titel = await b.werte('document.querySelector("#libliste tr:first-child td.titelzelle")?.textContent ?? ""');
  await b.klick('#libliste tr:first-child button.in-set');
  await warte(600);
  await b.klick('[data-reiter="sets"]');
  await warte(800);
  const zeilen = await b.werte('document.querySelectorAll("#setliste tr").length');
  pruefe(zeilen === 1, `Posten im Set: ${zeilen}`);
  pruefe((await b.werte('document.querySelector("#setliste tr td.titelzelle")?.textContent ?? ""')) === titel, `Titel gleich: ${titel}`);
  pruefe(/^(READY|PREPARE|MISSING|QUEUED|PREPARING…|FAILED)$/.test(await b.werte('document.querySelector("#setliste tr td.status")?.textContent ?? ""')), 'Status-Zelle');
  pruefe((await b.werte('document.documentElement.scrollWidth <= innerWidth')) === true, 'kein Querscrollen');
  pruefe(b.konsole.filter((k) => k.typ === 'exception' || k.typ === 'error').length === 0, `Konsole sauber ${JSON.stringify(b.konsole)}`);
  const zus = await b.werte('document.querySelector("#set-zusammenfassung").textContent');
  pruefe(/\d+ tracks? · \d+:\d\d/.test(zus), `Zusammenfassung: ${zus}`);
  await b.klick('#setliste tr:first-child button.weg');
  await warte(600);
  pruefe((await b.werte('document.querySelectorAll("#setliste tr").length')) === 0, 'Posten entfernt');
  console.log('set', NAME);
} finally { await b.zu(); }
process.exit(fehl ? 1 : 0);
