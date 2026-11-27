// Channel strip row (strand 11, task 8.2): one big cell per stream of the Strudel module, readable from two metres.
// Number, label (`bezeichnung`, else the pattern start, dimmed), a level meter (filled by deck_view.js zeigePegel like every other meter),
// an activity blink, and the running Cypher arc on top (GET /spur `bogen`, computed by the server: no arc logic here).
import { $, el } from './page_state.js';
import { stromKanal, stromName } from './kanaele.js';
import { beiPegel } from './deck_view.js';
import { beiSpurListe } from './track_tape_view.js';
import { instanzen } from './instanzen.js';

const BLINK_DB = 6, BLINK_MS = 160, BODEN_DB_PRO_S = 1, BODEN_ABSTAND_MAX_DB = 30, STILLE_DB = -90;
const strom = new Map();   // n → { bezeichnung, text }
const boden = new Map();   // kanal → { db, t } the running floor of the level
const blinker = new Map(); // kanal → timer
let bogen = null;
let jetzt = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** Test seam: replaces the clock (ms). */
export function setzeUhr(f) { jetzt = f; boden.clear(); }

const wurzel = () => $('#kanalband');
const zelle = (n) => $(`.kanalzelle[data-strom="${n}"]`, wurzel());

/** The streams to show: those that have a row in the Strudel module. */
const strome = () => [...instanzen.keys()].sort((a, b) => a - b);
const anfang = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

function baueZelle(n) {
  const z = el('div', 'kanalzelle'); z.dataset.strom = String(n);
  const nr = el('span', 'kanalnr', String(n));
  const name = el('span', 'kanalname');
  const meter = el('div', 'meter waagrecht'); meter.dataset.kanal = stromKanal(n); meter.append(document.createElement('i'));
  z.append(nr, name, meter);
  z.title = stromName(n);
  return z;
}
function zeigeName(n, z) {
  const s = strom.get(n) ?? {}, t = $('.kanalname', z);
  const bez = typeof s.bezeichnung === 'string' && s.bezeichnung ? s.bezeichnung : null;
  const text = bez ?? (anfang(s.text) || 'silent');
  t.textContent = text;
  t.classList.toggle('ohne-bezeichnung', bez === null);
}
/** Redraws the cells for the streams that have a row (cells keep their node, so the meter and the blink survive). */
export function zeigeKanalband() {
  const w = wurzel();
  if (!w) return;
  const soll = strome();
  const zeile = $('.kanalzellen', w) ?? (() => { const x = el('div', 'kanalzellen'); w.append(x); return x; })();
  for (const n of soll) {
    let z = zelle(n);
    if (!z) { z = baueZelle(n); const nach = [...zeile.children].find((c) => Number(c.dataset.strom) > n); if (nach) zeile.insertBefore(z, nach); else zeile.append(z); }
    zeigeName(n, z);
  }
  for (const z of [...zeile.children]) if (!soll.includes(Number(z.dataset.strom))) z.remove();
}
/** Hand-over from instanzen.js: the answer of GET /strudel?strom=n. */
export function meldeStrom(n, bezeichnung, text) {
  strom.set(n, { bezeichnung, text });
  const z = zelle(n);
  if (z) zeigeName(n, z); else zeigeKanalband();
}

/** The arc line from the GET /spur list: the first run that carries a `bogen`. */
export function zeigeBogen(liste) {
  const b = (Array.isArray(liste) ? liste : []).find((l) => l?.bogen)?.bogen ?? null;
  bogen = b;
  const w = wurzel();
  if (!w) return;
  let k = $('.kanalbogen', w);
  if (!k) { k = el('div', 'kanalbogen'); w.prepend(k); }
  k.hidden = !b;
  if (!b) { k.textContent = ''; return; }
  const im = b.takt_im_bogen > 0 ? `${b.takt_im_bogen}/${b.takte}` : `–/${b.takte}`;
  const n = b.naechste;
  const danach = n ? `in ${n.in_takten} ${n.in_takten === 1 ? 'bar' : 'bars'}: ${n.text}` : 'last section';
  k.textContent = `${b.name}  ${im}  ·  ${danach}`;
}

/** One level event: the floor follows down at once and rises 1 dB/s, but never sits more than 30 dB below the level; 6 dB above it blinks the cell.
 *  From silence (floor at or below -90 dB) the first audible level blinks once and becomes the floor, so a steady level does not keep blinking. */
export function pegelEreignis(kanal, db) {
  const m = /^erz\/(\d+)$/.exec(kanal);
  if (!m || !Number.isFinite(db)) return;
  const t = jetzt(), b = boden.get(kanal);
  const ausStille = !!b && b.db <= STILLE_DB && db > STILLE_DB;
  const fl = !b || ausStille ? db : Math.max(db - BODEN_ABSTAND_MAX_DB, Math.min(db, b.db + ((t - b.t) / 1000) * BODEN_DB_PRO_S));
  boden.set(kanal, { db: fl, t });
  if (db <= -199 || (!ausStille && db - fl < BLINK_DB)) return;
  const z = zelle(Number(m[1]));
  if (!z) return;
  z.classList.add('blinkt');
  clearTimeout(blinker.get(kanal));
  blinker.set(kanal, setTimeout(() => z.classList.remove('blinkt'), BLINK_MS));
}

export const kanalbandSichtbar = () => { const w = wurzel(); return !!w && !w.hidden && w.offsetParent !== null; };
export function bindeKanalband() {
  beiPegel(pegelEreignis);
  beiSpurListe(zeigeBogen, kanalbandSichtbar);
  zeigeKanalband();
  setInterval(zeigeKanalband, 500);   // rows come and go with the project; cheap and idempotent
}
export const stand = () => ({ bogen, strome: strome() });
