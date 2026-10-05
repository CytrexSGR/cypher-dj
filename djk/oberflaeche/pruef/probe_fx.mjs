// Probe Plan 3 (Beat-FX) am laufenden Stapel einer Prüfinstanz, kopflos: die FX-Zeile im Kopf schickt /fx, der Kern
// übernimmt (Quittung, /e/fx), die Seite zeigt den Stand des Kerns; ein zweites Fenster sieht dieselbe Änderung.
// Den Klang (Echo-Abstand am Sample, Fahne nach dem Fader) belegt djk/kern/tests/test_kern_fx.cpp.
// Aufruf: node djk/oberflaeche/pruef/probe_fx.mjs [instanz i] [bildordner]
import path from 'node:path';
import { starteBrowser } from './cdp.mjs';

const I = process.argv[2] ?? 'i';
const BILDER = process.argv[3] ?? '/tmp';
const URL_SEITE = `http://127.0.0.1:${47300 + 1000 * ('abcdefghi'.indexOf(I) + 1)}`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnisse = [];
const pruefe = (name, ok, ist) => { ergebnisse.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} :: ${JSON.stringify(ist)}`); };

const fxe = [];
const ac = new AbortController();
(async () => {
  const r = await fetch(`${URL_SEITE}/strom`, { signal: ac.signal });
  const dec = new TextDecoder();
  let puffer = '';
  for await (const teil of r.body) {
    puffer += dec.decode(teil, { stream: true });
    let i;
    while ((i = puffer.indexOf('\n\n')) >= 0) { const n = JSON.parse(puffer.slice(6, i)); puffer = puffer.slice(i + 2); if (n.a === '/e/fx') fxe.push(n.f); }
  }
})().catch(() => {});

const b = await starteBrowser({ breite: 1920, hoehe: 1080 });
const b2 = await starteBrowser({ breite: 1920, hoehe: 1080 });
const zeile = (x) => x.werte(`({ art: document.querySelector('#fx-1 [data-fx-art]').textContent, param1: document.querySelector('#fx-1 [data-fx-param1-name]').textContent,
  beat: document.querySelector('#fx-1 [data-fx-beat]').textContent, an: document.querySelector('#fx-1 [data-fx-an]').classList.contains('an'),
  zugewiesen_deck1: document.querySelector('.zug[data-deck="1"] [data-fxzuweisung="1"]').classList.contains('an') })`);
try {
  // definierter Anfang: die Einheit steht sonst da, wo der vorige Lauf sie gelassen hat
  await fetch(`${URL_SEITE}/fx`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ einheit: 1, art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: false }) });
  await fetch(`${URL_SEITE}/fx/zuweisung`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ einheit: 1, kanal: 'deck/1', an: false }) });
  await warte(300);
  await b.oeffne(`${URL_SEITE}/`);
  await b2.oeffne(`${URL_SEITE}/`);
  await warte(1000);
  // deck/1 an FX1, zweimal TYPE weiter (PHASER), BEAT ◀ (½), ON
  await b.klick('.zug[data-deck="1"] [data-fxzuweisung="1"]');
  await b.klick('#fx-1 [data-fx-art]'); await b.klick('#fx-1 [data-fx-art]');
  await b.klick('#fx-1 [data-fx-beat-minus]');
  await b.klick('#fx-1 [data-fx-an]');
  await warte(800);
  const z = await zeile(b);
  const e = fxe.at(-1);
  pruefe('Seite: PHASER, RESONANCE, ½, ON, deck/1 zugewiesen', z.art === 'PHASER' && z.param1 === 'RESONANCE' && z.beat === '½' && z.an && z.zugewiesen_deck1, z);
  pruefe('Kern meldet /e/fx mit genau diesem Stand', e && e.einheit === 1 && e.art === 3 && e.beats === 0.5 && e.an === 1, e);
  const z2 = await zeile(b2);
  pruefe('Zweites Fenster zeigt denselben Stand (live über /e/fx, /e/fx/zuweisung)', z2.art === 'PHASER' && z2.an && z2.beat === '½' && z2.zugewiesen_deck1, z2);
  // Review-Fund 2: NEU neu laden (kein /e/fx danach) und prüfen, dass der Anfangsstand (case 'stand') die Zuweisung mitbringt
  await b2.oeffne(`${URL_SEITE}/`);
  await warte(1000);
  const z3 = await zeile(b2);
  pruefe('Nach Neuladen: Zuweisung aus dem Anfangsstand übernommen (nicht dunkel)', z3.zugewiesen_deck1 && z3.an, z3);
  // DEPTH per Mausrad hoch → wet im Kern steigt
  const w0 = e.wet;
  const m = await b.mitte('.fxknopf[data-fx="wet"]');
  for (let k = 0; k < 5; k++) { await b.sende('Input.dispatchMouseEvent', { type: 'mouseWheel', x: m.x, y: m.y, deltaX: 0, deltaY: -100 }); await warte(60); }
  await warte(500);
  pruefe('DEPTH per Mausrad: Kern-Wet steigt um 0,1', Math.abs(fxe.at(-1).wet - (w0 + 0.1)) < 0.011, { vorher: w0, nachher: fxe.at(-1).wet });
  // OFF
  // RESET (S8 FX Button 2): Wet und Parameter zurück auf die Vorgabe, Art/Beat/ON bleiben
  await b.klick('#fx-1 [data-fx-reset]');
  await warte(600);
  pruefe('RESET: Kern-Wet 0,5, Art und ON bleiben', Math.abs(fxe.at(-1).wet - 0.5) < 1e-6 && fxe.at(-1).art === 3 && fxe.at(-1).an === 1, fxe.at(-1));
  await b.klick('#fx-1 [data-fx-an]');
  await warte(600);
  pruefe('OFF: /e/fx an 0, Knopf aus', fxe.at(-1).an === 0 && !(await zeile(b)).an, fxe.at(-1));
  // FX2 unabhängig: deck/2 an FX2, Kern-Stand über GET /fx/zuweisung; FX1-Zuweisung von deck/1 bleibt
  await b.klick('.zug[data-deck="2"] [data-fxzuweisung="2"]');
  await b.klick('#fx-2 [data-fx-an]');
  await warte(800);
  const zw = await (await fetch(`${URL_SEITE}/fx/zuweisung`)).json();
  const fx2 = (await (await fetch(`${URL_SEITE}/fx`)).json())[1];
  pruefe('FX2: deck/2 zugewiesen, FX1 behält deck/1, FX2 an', zw[1]['deck/2'] === true && zw[0]['deck/1'] === true && !zw[0]['deck/2'] && fx2?.an === 1, { zw, fx2 });
  pruefe('FX2-Taste leuchtet in beiden Fenstern', await b2.werte(`document.querySelector('.zug[data-deck="2"] [data-fxzuweisung="2"]').classList.contains('an')`), null);
  // Taste nochmal: Zuweisung ab
  await b.klick('.zug[data-deck="2"] [data-fxzuweisung="2"]');
  await warte(600);
  pruefe('FX2 ab: deck/2 nicht mehr zugewiesen', (await (await fetch(`${URL_SEITE}/fx/zuweisung`)).json())[1]['deck/2'] === false, null);
  // Master: Taste [1] am Master-Block, Kern bestätigt, Taste leuchtet im zweiten Fenster; wieder ab
  await b.klick('.mitte [data-fxzuweisung="1"][data-kanal="master"]');
  await warte(700);
  pruefe('Master an FX1: Kern bestätigt, Taste leuchtet im zweiten Fenster', (await (await fetch(`${URL_SEITE}/fx/zuweisung`)).json())[0].master === true &&
    await b2.werte(`document.querySelector('.mitte [data-fxzuweisung="1"]').classList.contains('an')`), null);
  await b.klick('.mitte [data-fxzuweisung="1"][data-kanal="master"]');
  await warte(600);
  pruefe('Master ab', (await (await fetch(`${URL_SEITE}/fx/zuweisung`)).json())[0].master === false, null);
  await b.bild(path.join(BILDER, 'fx-kopf.png'));
  const fehler = [...(b.konsole ?? []), ...(b2.konsole ?? [])].filter((k) => k.typ === 'error' || k.typ === 'exception');
  pruefe('Konsole ohne Fehler (beide Fenster)', fehler.length === 0, fehler);
} finally {
  ac.abort();
  await b.zu();
  await b2.zu();
}
const n = ergebnisse.filter((x) => !x).length;
console.log(`\n${ergebnisse.length - n}/${ergebnisse.length} OK`);
process.exit(n ? 1 : 0);
