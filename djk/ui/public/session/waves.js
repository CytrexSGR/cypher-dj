// Waveform thumbnails and the shared animation loop of the session columns (session view S1, lane P2).
// One copy of the waveform fetch and drawing; the loop deck place (loopdeck/view.js) only uses `leereWellen` and `starteTakt` of it.
import { leseWelle, spalten, zeichneSpalte } from '../wave.js';

const wellen = new Map(), daumen_ = new Map();
export const wellenEinstellung = { backoffMs: 400, versuche: 6 };   // pause and number of retries after a displaced request (429); tests shorten them

// The server decodes one /welle at a time plus one waiting and answers 429 `verdraengt` to the rest (wave_cache.ts), so the page asks for
// thumbnails through one queue with one request in flight: the playing strips first, then the cells in the order they were asked for.
// A displaced request (429) goes to the back of the queue after a short pause; any other failure resolves null at once. Nothing failed is
// remembered: the next ladeWelle of that sha asks again.
const warteschlange = [];   // { sha, vorrang, versuche, loese }
let pumpt = false;
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function holeEinmal(sha) {
  try {
    const r = await fetch(`/welle?sha=${encodeURIComponent(sha)}`);
    if (r.status === 429) return { verdraengt: true, welle: null };
    if (!r.ok) return { verdraengt: false, welle: null };
    return { verdraengt: false, welle: leseWelle(await r.arrayBuffer()) };
  } catch { return { verdraengt: false, welle: null }; }
}
async function pumpe() {
  if (pumpt) return;
  pumpt = true;
  try {
    while (warteschlange.length) {
      const i = warteschlange.findIndex((e) => e.vorrang);
      const e = warteschlange.splice(i < 0 ? 0 : i, 1)[0];
      const r = await holeEinmal(e.sha);
      if (r.verdraengt && e.versuche < wellenEinstellung.versuche) { e.versuche++; await pause(wellenEinstellung.backoffMs); warteschlange.push(e); continue; }
      e.loese(r.welle);
    }
  } finally { pumpt = false; }
}
// The decoded waveform of `sha`, or null (none, refused, unreachable, not a DJKW file). `vorrang`: wanted before the cells (the playing strip).
export function ladeWelle(sha, vorrang = false) {
  if (wellen.has(sha)) {
    if (vorrang) { const e = warteschlange.find((x) => x.sha === sha); if (e) e.vorrang = true; }
    return wellen.get(sha);
  }
  let loese;
  const p = new Promise((ok) => { loese = ok; });
  warteschlange.push({ sha, vorrang, versuche: 0, loese });
  wellen.set(sha, p);
  p.then((w) => { if (!w && wellen.get(sha) === p) wellen.delete(sha); });
  pumpe();
  return p;
}

// Forgets every waveform and thumbnail (tests of the places start clean).
export function leereWellen() { wellen.clear(); daumen_.clear(); warteschlange.length = 0; }

// Draws the decoded waveform `w` over the whole canvas.
export function zeichneWelle(leinwand, w) {
  const g = leinwand.getContext('2d'), B = leinwand.width, H = leinwand.height;
  g.clearRect(0, 0, B, H);
  for (let x = 0; x < B; x++) zeichneSpalte(g, x, H / 2, spalten(w, x * w.spalten / B, (x + 1) * w.spalten / B), w.gain);
}

// A canvas with the waveform of `sha` at the given size, or null (nothing drawn). The drawing happens once per (sha, size); every call
// gets its own copy, since one canvas can sit in one place only.
export function daumen(sha, breite, hoehe, vorrang = false) {
  if (!sha) return Promise.resolve(null);
  const schluessel = `${sha}|${breite}x${hoehe}`;
  if (!daumen_.has(schluessel)) {
    const p = ladeWelle(sha, vorrang).then((w) => {
      if (!w) return null;
      const k = document.createElement('canvas'); k.width = breite; k.height = hoehe;
      zeichneWelle(k, w);
      return k;
    });
    daumen_.set(schluessel, p);
    p.then((k) => { if (!k && daumen_.get(schluessel) === p) daumen_.delete(schluessel); });
  }
  if (vorrang) ladeWelle(sha, true);
  return daumen_.get(schluessel).then((master) => {
    if (!master) return null;
    const k = document.createElement('canvas'); k.width = breite; k.height = hoehe;
    k.getContext('2d').drawImage(master, 0, 0);
    return k;
  });
}

// One requestAnimationFrame loop for every playhead: f(ms) runs once per frame while subscribed; the loop stops with the last subscriber.
// Returns the unsubscribe function.
const abonnenten = new Set();
let schleife = false;
function schritt(t) {
  for (const f of [...abonnenten]) f(t);
  if (abonnenten.size) requestAnimationFrame(schritt); else schleife = false;
}
export function starteTakt(f) {
  abonnenten.add(f);
  if (!schleife && typeof requestAnimationFrame === 'function') { schleife = true; requestAnimationFrame(schritt); }
  return () => { abonnenten.delete(f); };
}
