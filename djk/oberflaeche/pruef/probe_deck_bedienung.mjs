// Probe Plan E9 (Deck-Bedienung) am laufenden Stapel einer Prüfinstanz, kopflos: Sprung per Übersicht (stehend: eingerastet
// ab der Takt-Eins; laufend: Phase bleibt), Cue-Pads (setzen, spielen, SHOT/LOOP, löschen), LOOP an/aus, Ziehen.
// Aufruf: node djk/oberflaeche/pruef/probe_deck_bedienung.mjs [instanz i] [bildordner]
import fs from 'node:fs';
import path from 'node:path';
import { starteBrowser } from './cdp.mjs';

const I = process.argv[2] ?? 'i';
const BILDER = process.argv[3] ?? '/tmp';
const K = 'abcdefghi'.indexOf(I) + 1;
const URL_SEITE = `http://127.0.0.1:${47300 + 1000 * K}`;
const NIGHTSHIFT = '1ac28792d355a38b';
// Review E9 F3: die Prüfinstanz hat ihren eigenen Hotcue-Ordner (/dev/shm), die Probe fasst den Betrieb nie an
const HOTCUES = path.join(`/dev/shm/cypherdj-${I}/hotcues`, `${NIGHTSHIFT}_128000_r1.json`);
if (!I) throw new Error('Probe nur gegen eine Prüfinstanz');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnisse = [];
const pruefe = (name, ok, ist) => { ergebnisse.push({ name, ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} :: ${JSON.stringify(ist)}`); };

// Kern-Stand über den Ereignisstrom der Seite (/strom): letzter /zustand/deck von Deck 1 und letzte /uhr
const stand = { deck: null, uhr: null };
const ac = new AbortController();
(async () => {
  const r = await fetch(`${URL_SEITE}/strom`, { signal: ac.signal });
  const dec = new TextDecoder();
  let puffer = '';
  for await (const teil of r.body) {
    puffer += dec.decode(teil, { stream: true });
    let i;
    while ((i = puffer.indexOf('\n\n')) >= 0) {
      const n = JSON.parse(puffer.slice(6, i)); puffer = puffer.slice(i + 2);
      if (n.a === '/zustand/deck' && n.f.deck === 1) stand.deck = n.f;
      if (n.a === '/uhr') stand.uhr = n.f;
    }
  }
})().catch(() => {});
const bis = async (pruef, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { if (stand.deck && pruef(stand.deck)) return true; await warte(50); } return false; };
const phase = () => stand.deck.quell_beat - stand.uhr.beat;   // läuft das Deck, ist das konstant bis auf Sprünge
// /zustand/deck und /uhr kommen über den Server getrennt gedrosselt (100/50 ms): ein Paar rauscht bis ~0,2 Beat. Median aus 20.
const phaseMedian = async () => {
  const w = [];
  for (let k = 0; k < 20; k++) { w.push(phase()); await warte(55); }
  w.sort((x, y) => x - y);
  return (w[9] + w[10]) / 2;
};
const post = (p, d) => fetch(URL_SEITE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => r.json());

try { fs.rmSync(HOTCUES); } catch { /* frisch */ }
const eins = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../../bestand', NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8')).erste_eins_quell_beat;
const b = await starteBrowser({ breite: 1920, hoehe: 1080 });
try {
  await b.oeffne(`${URL_SEITE}/`);
  await warte(800);
  await post('/laden', { deck: 1, material_id: NIGHTSHIFT });
  pruefe('Laden: Deck 1 geladen', await bis((z) => z.status === 1 && z.material_id === NIGHTSHIFT), stand.deck?.status);
  await warte(1500);   // Welle und Hotcues der Seite
  await b.bild(path.join(BILDER, 'deck-1-geladen.png'));

  // 1) stehend, Raster BAR: Klick bei 50 % der Übersicht → Position auf eins + 4k
  const ueber = await b.mitte('.deck[data-deck="1"] [data-ueber]');
  await b.klick('.deck[data-deck="1"] [data-ueber]');
  const ok1 = await bis((z) => z.quell_beat > 20);
  const q1 = stand.deck.quell_beat;
  pruefe('Sprung stehend: eingerastet auf eine Takt-Eins', ok1 && Math.abs(((q1 - eins) % 4 + 4) % 4) < 1e-6 && stand.deck.status === 1, { q1, eins, breite: ueber.w });

  // 2) Play, dann Klick bei 25 %: laufend springt das Deck um ein Vielfaches von 4 gegen den Master
  await b.klick('.deck[data-deck="1"] .taste.play');
  pruefe('Play: läuft', await bis((z) => z.status === 2), stand.deck.status);
  await warte(600);
  const ph0 = await phaseMedian();
  await b.werte(`(() => { const c = document.querySelector('.deck[data-deck="1"] [data-ueber]'); const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width * 0.25, clientY: r.top + r.height / 2, bubbles: true })); })()`);
  await warte(2500);   // Raster BAR: bis zu 4 Beats Warten auf die nächste Takt-Eins
  const dph = (await phaseMedian()) - ph0;
  pruefe('Sprung laufend: Phase verschoben um ein Vielfaches von 4', Math.abs(dph) > 3 && Math.abs(dph - 4 * Math.round(dph / 4)) < 0.05 && stand.deck.status === 2, { dph });

  // 3) Pad 1 setzen (leer) und spielen
  await b.klick('.deck[data-deck="1"] .pad[data-nr="1"]');
  await warte(600);
  const h1 = JSON.parse(fs.readFileSync(HOTCUES, 'utf8'))['1'];
  const padKlasse = await b.werte(`document.querySelector('.deck[data-deck="1"] .pad[data-nr="1"]').className`);
  pruefe('Pad 1 gesetzt: Datei, auf einer Takt-Eins, grün', h1 && Math.abs(((h1.quell_beat - eins) % 4 + 4) % 4) < 1e-6 && /shot/.test(padKlasse), { h1, padKlasse });
  await warte(3000);   // weiterlaufen lassen, damit der Sprung zurück messbar ist
  await b.klick('.deck[data-deck="1"] .pad[data-nr="1"]');
  await warte(2500);
  const z3 = stand.deck, u3 = stand.uhr;
  // phasentreu: danach ist quell − hc ≡ beat − (Ausführungs-Beat) mod 1 … einfacher: die Position liegt kurz hinter dem Hotcue
  pruefe('Pad 1 spielen: Position kurz hinter dem Hotcue', z3.quell_beat >= h1.quell_beat - 0.5 && z3.quell_beat < h1.quell_beat + 6, { q: z3.quell_beat, hc: h1.quell_beat, beat: u3.beat });
  await b.bild(path.join(BILDER, 'deck-2-hotcue.png'));

  // 4) LOOP an (4 Beats) → Status 3, Position bleibt im Fenster; aus → 2
  await b.klick('.deck[data-deck="1"] [data-loopan]');
  const loopAn = await bis((z) => z.status === 3, 5000);
  const qs = [];
  for (let k = 0; k < 12; k++) { qs.push(stand.deck.quell_beat); await warte(250); }
  const spanne = Math.max(...qs) - Math.min(...qs);
  const knopfAn = await b.werte(`document.querySelector('.deck[data-deck="1"] [data-loopan]').classList.contains('an')`);
  pruefe('LOOP an: Status 3, Position bleibt in 4 Beats (3 s gemessen)', loopAn && spanne < 4 && knopfAn, { spanne, knopfAn });
  await b.bild(path.join(BILDER, 'deck-3-loop.png'));
  await b.klick('.deck[data-deck="1"] [data-loopan]');
  pruefe('LOOP aus: Status 2', await bis((z) => z.status === 2, 5000), stand.deck.status);

  // 5) Shift+Klick: Pad 1 wird LOOP; Klick → Status 3
  await b.werte(`document.querySelector('.deck[data-deck="1"] .pad[data-nr="1"]').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }))`);
  await warte(600);
  const h1b = JSON.parse(fs.readFileSync(HOTCUES, 'utf8'))['1'];
  pruefe('Shift+Klick: Pad 1 LOOP, Stelle unverändert', h1b.art === 'loop' && h1b.laenge === 4 && h1b.quell_beat === h1.quell_beat, h1b);
  await b.klick('.deck[data-deck="1"] .pad[data-nr="1"]');
  pruefe('Pad 1 (LOOP) spielen: Status 3', await bis((z) => z.status === 3, 5000), stand.deck.status);
  await b.klick('.deck[data-deck="1"] [data-loopan]');
  await bis((z) => z.status === 2, 5000);

  // 6) Stopp, dann Ziehen um ¼ der Breite nach rechts → Position um −(takte·4)/4 Beats
  await b.klick('.deck[data-deck="1"] .taste.play');
  await bis((z) => z.status === 1);
  await warte(300);
  const q6 = stand.deck.quell_beat;
  const lauf = await b.mitte('.deck[data-deck="1"] [data-lauf]');
  const takte = await b.werte(`16`);
  await b.ziehe('.deck[data-deck="1"] [data-lauf]', lauf.w / 4, 0);
  await warte(1000);
  const dq = stand.deck.quell_beat - q6;
  pruefe('Ziehen stehend: Position um −¼ Fenster (16 Takte → −16 Beats)', Math.abs(dq + takte) < 0.3, { dq, erwartet: -takte });

  // 7) Rechtsklick löscht Pad 1
  await b.werte(`document.querySelector('.deck[data-deck="1"] .pad[data-nr="1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
  await warte(600);
  const nachher = JSON.parse(fs.readFileSync(HOTCUES, 'utf8'));
  const klasse7 = await b.werte(`document.querySelector('.deck[data-deck="1"] .pad[data-nr="1"]').className`);
  pruefe('Rechtsklick: Pad 1 gelöscht', !nachher['1'] && /leer/.test(klasse7), { nachher, klasse7 });

  const fehler = (b.konsole ?? []).filter((k) => k.typ === 'error' || k.typ === 'exception');
  pruefe('Konsole ohne Fehler', fehler.length === 0, fehler);
} finally {
  ac.abort();
  await b.zu();
}
const n = ergebnisse.filter((e) => !e.ok).length;
console.log(`\n${ergebnisse.length - n}/${ergebnisse.length} OK`);
process.exit(n ? 1 : 0);
