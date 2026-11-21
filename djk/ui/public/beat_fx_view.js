// Beat FX units: display, sending, routing and channel assignment.
import { $, $$ } from './page_state.js';
import { zeichne } from './controls_view.js';
import { deckPost } from './deck_griffe.js';
// AUFTRAG 2026-09-28: zwei Beat-FX-Einheiten, drei Parameter je Einheit (S8-Layout). fxStand/fxZuweisung sind je
// Einheit (Index 0 = FX1, 1 = FX2). Nur param1 wirkt im Kern (Vorgabe je Art, aus S8-Abgleich).
const FX_ARTEN = [{ art: 1, name: 'ECHO', param1: 'FEEDBACK' }, { art: 2, name: 'FLANGER', param1: 'FEEDBACK' },
  { art: 3, name: 'PHASER', param1: 'RESONANCE' }, { art: 4, name: 'FILTER', param1: 'Q' },
  { art: 5, name: 'REVERB', param1: 'SIZE' }, { art: 6, name: 'DELAY', param1: 'TONE' },
  { art: 7, name: 'PING PONG', param1: 'FEEDBACK' }, { art: 8, name: 'TRANS', param1: 'DUTY' },
  { art: 9, name: 'ROLL', param1: '-' }, { art: 10, name: 'SLIP ROLL', param1: '-' }, { art: 11, name: 'VINYL BRAKE', param1: '-' },
  { art: 12, name: 'SPIRAL', param1: 'FEEDBACK' }];
const FX_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16];
const FX_VORGABE = { wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5 };   // RESET setzt hierauf zurück (nicht art/beats/an)
const fxStand = [
  { art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: false, gegriffen: false },
  { art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: false, gegriffen: false },
];
const fxZuweisung = [{}, {}, {}];   // fxZuweisung[u][kanal] = true/false; u = 2 is FX3 (the group insert with the Remix, fx3.js)
export const fx3Zuweisung = () => fxZuweisung[2];
let beiZuweisung = () => {};   // FX3 unit and Remix window follow the assignment (remix_window.js)
export function folgeZuweisung(f) { beiZuweisung = f; }

// ---------- Beat-FX (AUFTRAG 2026-09-28): zwei Einheiten (u = 0 FX1, 1 FX2), S8-Layout WET/P1/P2/P3/ON/RESET ----------
const fxBeatText = (b) => (b === 0.25 ? '¼' : b === 0.5 ? '½' : String(b));
const fxBlock = (u) => $(`#fx-${u + 1}`);
function zeigeFx(u) {
  const bl = fxBlock(u);
  if (!bl) return;   // Slice 1: Block für u=1 (FX2) existiert erst ab Slice 2
  const t = FX_ARTEN.find((x) => x.art === fxStand[u].art) ?? FX_ARTEN[0];
  $('[data-fx-art]', bl).textContent = t.name;
  $('[data-fx-param1-name]', bl).textContent = t.param1;
  $('[data-fx-beat]', bl).textContent = fxBeatText(fxStand[u].beats);
  $('[data-fx-an]', bl).classList.toggle('an', fxStand[u].an);
  for (const k of $$('.fxknopf', bl)) zeichne({ el: k, x: fxStand[u][k.dataset.fx] });
  zeigeZuweisung(u);
}
function zeigeZuweisung(u) {   // the keys 1 2 3 of every strip; unit 3 has no beat FX block, so this runs on its own too
  for (const b of $$(`[data-fxzuweisung="${u + 1}"]`)) b.classList.toggle('an', !!fxZuweisung[u][b.dataset.kanal]);
  if (u === 2) beiZuweisung();
}
export function fxVomKern(u, f) {   // /e/fx: der Kern hat es übernommen (auch von der Welle); beim Greifen gilt die Hand
  if (fxStand[u].gegriffen) return;
  Object.assign(fxStand[u], { art: f.art || fxStand[u].art, beats: f.beats, wet: f.wet, param1: f.param1, param2: f.param2, param3: f.param3, an: f.an === 1 });
  zeigeFx(u);
}
export function fxZuweisungVomKern(u, kanal, an) {   // /e/fx/zuweisung
  if (!fxZuweisung[u]) return;
  fxZuweisung[u][kanal] = an === 1;
  zeigeFx(u); zeigeZuweisung(u);
}
const fxWartet = [null, null];
function sendeFx(u) {   // gedrosselt wie die Griffe: höchstens alle 30 ms eine Anfrage, die letzte gewinnt
  zeigeFx(u);
  if (fxWartet[u]) return;
  fxWartet[u] = setTimeout(async () => {
    fxWartet[u] = null;
    const { art, beats, wet, param1, param2, param3, an } = fxStand[u];
    const r3 = (x) => Math.round(x * 1000) / 1000;
    await deckPost('/fx', { einheit: u + 1, art, beats, wet: r3(wet), param1: r3(param1), param2: r3(param2), param3: r3(param3), an }, `FX${u + 1}`);
  }, 30);
}
export function sendeFxZuweisung(u, kanal, an = !fxZuweisung[u][kanal]) {
  fxZuweisung[u][kanal] = an;   // optimistisch zeigen, /e/fx/zuweisung bestätigt
  zeigeFx(u); zeigeZuweisung(u);
  deckPost('/fx/zuweisung', { einheit: u + 1, kanal, an }, `FX${u + 1} assign`);
}
function bindeFxEinheit(u) {
  const bl = fxBlock(u);
  if (!bl) return;   // Slice 1: nur u=0 (FX1) vorhanden
  const artSchritt = (d) => { const i = FX_ARTEN.findIndex((x) => x.art === fxStand[u].art); fxStand[u].art = FX_ARTEN[(i + d + FX_ARTEN.length) % FX_ARTEN.length].art; sendeFx(u); };
  $('[data-fx-art]', bl).addEventListener('click', () => artSchritt(1));
  $('[data-fx-art]', bl).addEventListener('contextmenu', (e) => { e.preventDefault(); artSchritt(-1); });
  $('[data-fx-art]', bl).addEventListener('wheel', (e) => { e.preventDefault(); artSchritt(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  const beat = (d) => { const i = FX_BEATS.indexOf(fxStand[u].beats); fxStand[u].beats = FX_BEATS[Math.max(0, Math.min(FX_BEATS.length - 1, i + d))]; sendeFx(u); };
  $('[data-fx-beat-minus]', bl).addEventListener('click', () => beat(-1));
  $('[data-fx-beat-plus]', bl).addEventListener('click', () => beat(1));
  $('[data-fx-an]', bl).addEventListener('click', () => { fxStand[u].an = !fxStand[u].an; sendeFx(u); });
  $('[data-fx-reset]', bl).addEventListener('click', () => {   // S8 FX Button 2: alle Parameter auf Vorgabe (nicht art/beats/an)
    Object.assign(fxStand[u], FX_VORGABE);
    sendeFx(u);
  });
  for (const k of $$('.fxknopf', bl)) {   // senkrecht ziehen wie die Kanalknöpfe (220 px für den ganzen Weg), Umschalt = fein
    let start = null;
    k.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; k.setPointerCapture(e.pointerId); fxStand[u].gegriffen = true; start = { x: fxStand[u][k.dataset.fx], py: e.clientY }; e.preventDefault(); });
    k.addEventListener('pointermove', (e) => {
      if (!start) return;
      fxStand[u][k.dataset.fx] = Math.max(0, Math.min(1, start.x + (start.py - e.clientY) / 220 * (e.shiftKey ? 0.2 : 1)));
      sendeFx(u);
    });
    const los = () => { start = null; fxStand[u].gegriffen = false; };
    k.addEventListener('pointerup', los);
    k.addEventListener('pointercancel', los);
    k.addEventListener('wheel', (e) => { e.preventDefault(); fxStand[u][k.dataset.fx] = Math.max(0, Math.min(1, fxStand[u][k.dataset.fx] + (e.deltaY < 0 ? 0.02 : -0.02))); sendeFx(u); }, { passive: false });
  }
  zeigeFx(u);
}
export function bindeFx() { for (let u = 0; u < 2; u++) bindeFxEinheit(u); bindeFxRouting(); }
// Ohr T18: Taste FX-Routing (eine für beide Einheiten und alle Kanalzüge). Die Anzeige folgt allein dem Kern
// (/e/fx/routing, auch aus einem zweiten Fenster); der Klick bittet nur darum.
let fxRoutingInsert = false;
function zeigeFxRouting() {
  const b = $('#fx-routing');
  if (!b) return;
  b.textContent = fxRoutingInsert ? 'INSERT' : 'POST FADER';
  b.classList.toggle('an', fxRoutingInsert);
  b.setAttribute('aria-pressed', String(fxRoutingInsert));
}
export function fxRoutingVomKern(routing) { fxRoutingInsert = routing === 1; zeigeFxRouting(); }
function bindeFxRouting() {
  const b = $('#fx-routing');
  if (!b) return;
  b.addEventListener('click', () => deckPost('/fx/routing', { routing: fxRoutingInsert ? 'post_fader' : 'insert' }, 'FX routing'));
  zeigeFxRouting();
}
export function bindeFxZuweisung(wurzel = document) {   // Tasten [1] [2] je Kanalzug (wie an der S8: links FX1, rechts FX2); `wurzel`: a Strudel row built later
  for (const b of $$('[data-fxzuweisung]', wurzel)) {
    if (b.dataset.gebunden) continue;
    b.dataset.gebunden = '1';
    const u = Number(b.dataset.fxzuweisung) - 1;
    b.addEventListener('click', () => sendeFxZuweisung(u, b.dataset.kanal));
  }
}
