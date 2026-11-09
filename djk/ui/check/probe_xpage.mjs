// Probe am echten Kern (djk-start --instanz i): Crossfader-Zuweisung A/THRU/B per Klick. Deck 1 spielt, Fader 0 dB;
// Crossfader ganz nach B: mit Zuweisung A verstummt Deck 1 am Master, mit THRU nicht (Negativ-Kontrolle).
import { starteBrowser } from './cdp.mjs';
const URL = process.argv[2] ?? 'http://127.0.0.1:56300/';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, d) => fetch(URL + p.slice(1), { method: 'POST', body: JSON.stringify(d) }).then((r) => r.status);
const b = await starteBrowser();
const master = () => b.werte(`document.querySelector('[data-pegelzahl="master"]')?.textContent ?? 'fehlt'`);
try {
  await b.oeffne(URL);
  await warte(1500);
  const best = await (await fetch(URL + 'bestand')).json();
  await post('/laden', { deck: 1, material_id: best[0].material_id });
  await warte(2500);
  await post('/griff', { pfad: 'deck/1/play', u: 1 }); await post('/griff', { pfad: 'deck/1/play', u: 0 });
  await post('/griff', { pfad: 'deck/1/fader', u: 0.5 }); await post('/griff', { pfad: 'deck/1/fader', u: 1 });
  await warte(1500);
  const lage = async (name) => {
    await b.ziehe('.regler.waagrecht[data-pfad="xfader"] .kappe', 400, 0);   // ganz nach B
    await warte(800);
    const m = await master();
    const x = await b.werte(`document.querySelector('[data-wert="xfader"]').textContent`);
    const an = await b.werte(`[...document.querySelectorAll('.xzuweisung[data-pfad="deck/1/xseite"] button.an')].map(e=>e.textContent).join()`);
    await b.ziehe('.regler.waagrecht[data-pfad="xfader"] .kappe', -400, 0);  // zurück
    await b.ziehe('.regler.waagrecht[data-pfad="xfader"] .kappe', 200, 0);
    console.log(`${name}: Zuweisung Deck 1 "${an}", Crossfader "${x}", Master ${m} dB`);
  };
  await lage('THRU (Negativ-Kontrolle)');
  await b.klick('.xzuweisung[data-pfad="deck/1/xseite"] button[data-stufe="0"]');
  await b.klick('.xzuweisung[data-pfad="deck/2/xseite"] button[data-stufe="2"]');
  await warte(500);
  await lage('A/B');
  await b.bild(process.argv[3]);
  console.log('abgelehnt', await b.werte('window.djkGesendet.filter(g => g.code && g.code !== 200).length'));
} finally { await b.zu(); }
