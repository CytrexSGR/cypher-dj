// Probe am echten Kern (djk-start --instanz i, stumme Senke): Laden, Play, Fader ziehen per Maus, Kern-Wert gegen Anzeige.
import { starteBrowser } from './cdp.mjs';
import { GRIFF, art } from '../oeffentlich/kurven.js';
const URL = process.argv[2] ?? 'http://127.0.0.1:56300/';
const BILD = process.argv[3];
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, d) => fetch(URL + p.slice(1), { method: 'POST', body: JSON.stringify(d) }).then(async (r) => [r.status, await r.json()]);
const b = await starteBrowser();
try {
  await b.oeffne(URL);
  await warte(1500);
  const bestand = await (await fetch(URL + 'bestand')).json();
  console.log('bestand', bestand.length);
  const m1 = bestand[0].material_id, m2 = bestand[1].material_id;
  console.log('laden 1', (await post('/laden', { deck: 1, material_id: m1 }))[0], 'laden 2', (await post('/laden', { deck: 2, material_id: m2 }))[0]);
  await warte(2500);
  console.log('play 1', (await post('/griff', { pfad: 'deck/1/play', u: 1 }))[0]); await post('/griff', { pfad: 'deck/1/play', u: 0 });
  await warte(1500);
  const lies = (pfad) => b.werte(`(() => { const r = window.djkRegler.get(${JSON.stringify(pfad)}); return { x: r.x, kern: (window.djkZustand ?? {}).regler?.[${JSON.stringify(pfad)}] }; })()`);
  const kernwert = async (pfad) => b.werte(`document.querySelector('[data-wert="${pfad}"]')?.textContent`);
  for (const [pfad, dx, dy] of [['deck/1/fader', 0, 120], ['deck/1/fader', 0, -60], ['deck/1/fader', 0, -200], ['deck/1/eq/tief', 0, 60], ['xfader', -80, 0]]) {
    const sel = pfad === 'xfader' ? '.regler.waagrecht[data-pfad="xfader"] .kappe' : pfad.includes('fader') ? `.regler.senkrecht[data-pfad="${pfad}"] .kappe` : `.regler[data-pfad="${pfad}"]`;
    const vor = await lies(pfad); const tv = await kernwert(pfad);
    await b.ziehe(sel, dx, dy);
    await warte(800);
    const nach = await lies(pfad); const tn = await kernwert(pfad);
    const a = art(pfad);
    console.log(pfad, `zug ${dx},${dy}`, `x ${vor.x.toFixed(3)} -> ${nach.x.toFixed(3)}`, `Anzeige Kern "${tv}" -> "${tn}"`);
  }
  const gesendet = await b.werte('window.djkGesendet.filter(g => g.code !== 200).length');
  console.log('nicht-200 Antworten', gesendet);
  const pegel = await b.werte(`[...document.querySelectorAll('[data-pegel], .pegel')].slice(0,4).map(e => e.textContent || e.getAttribute('data-pegel')).join(' | ')`);
  console.log('pegel', pegel);
  console.log('konsole-fehler', JSON.stringify(b.konsole?.filter?.((k) => k.typ === 'error') ?? 'n/a'));
  if (BILD) await b.bild(BILD);
} finally { await b.zu(); }
