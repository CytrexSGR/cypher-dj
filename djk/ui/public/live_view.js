// Live container view: export, transport clock, project read. (The module panel and its faders left the page with loop deck P1.)
import { oeffneLive, kanalKennung } from './live_module.js';   // live modules task 4
import { Kopf } from './wave.js';
import { kopfImLoop } from './production/timeline.js';
import { DECKS } from './curves.js';
import { $$, melde, zustand } from './page_state.js';
import { loopAktiv } from './deck_griffe.js';
import { zeigePlaetzeSpaeter } from './slots_view.js';
import { uhrKopf } from './loop_rec_view.js';
import { zeichneSeq } from './seq_view.js';
import { zeichneStems } from './stems_view.js';
import { zeigeStromZeilen } from './strudel_module.js';
import { beiExportAenderung, setzeLiveHaken, exportBusy, exportZiel, exportiereVonDeck, loopdeckAnzahl, sorgeFuerStand, zeigeLoopdecks } from './loopdeck/view.js';   // loop deck view (loop deck P2)
import { szenenEreignis } from './seq_szenen.js';   // SEQ places (seq-deck-s1 task 7)

// ---------- Live container: EXPORT at the deck loop, LIVE, the project read ----------
export const live = { kanal: '', slug: null, projekt: null, rev: null, stand: {}, stems: null, greift: 0, neuZeichnen: false, pruefen: null, schreiben: new Map(), laeuft: false, seqLaeuft: 0 };   // seqLaeuft: SEQ writes in flight (seq_view.js)
export async function holeJson(weg, daten) {
  try {
    const r = await fetch(weg, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  } catch (e) { return { status: 0, j: { fehler: 'netz', text: `page server unreachable: ${e.message}` } }; }
}
export const liveOffen = () => !!live.projekt?.live;
export function exportTaste(n) {
  const b = document.createElement('button');
  b.textContent = 'EXPORT'; b.dataset.exportloop = String(n); b.className = 'exportknopf';
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    b.disabled = true;
    await exportiereVonDeck(n);   // first empty cell of the target loop deck; the server opens the live container when needed
    zeigeExport(n);
  });
  return b;
}
// EXPORT and the LOOP -> 1..4 row of deck n: on while a loop runs on the deck; the deck toggle shows the target and exists with two loop decks.
export function zeigeExport(n) {
  sorgeFuerStand();   // once: without a loop place nobody else reads the loop deck stand
  const laeuft = exportBusy(n), aus = !loopAktiv(zustand.decks[n]) || laeuft;
  const ziel = exportZiel().deck, zwei = loopdeckAnzahl() > 1;
  const titel = laeuft ? 'Exporting ...' : aus ? 'Needs a running loop: set a loop on this deck first' : null;
  for (const b of $$(`[data-exportloop="${n}"]`)) { b.disabled = aus; b.title = titel ?? `Export the running loop into the first empty cell of loop deck L${ziel}`; }
  for (const b of $$(`.deck[data-deck="${n}"] [data-nachspur]`)) { b.disabled = aus; b.title = titel ?? `Export the running loop into track ${b.dataset.nachspur} of loop deck L${ziel} (the selected cell, else the first empty one)`; }
  for (const b of $$(`.deck[data-deck="${n}"] [data-nachdeck]`)) { b.hidden = !zwei; b.textContent = `LOOP ${ziel}`; b.dataset.nachdeck = String(ziel); }
}
beiExportAenderung(() => { for (const n of DECKS) zeigeExport(n); });
export async function liveOeffnen() {
  const r = await oeffneLive(holeJson, (t) => window.confirm(t));
  if (!r.abgelehnt) melde(r.text, !r.ok);
  pruefeLiveSpaeter(0);
  return r;
}
setzeLiveHaken({ liveOffen, oeffneLive: liveOeffnen });   // the loop deck view opens the container this way after its own question (projekt_offen)
// ---------- Transport clock of the live container (the 'arr' events) ----------
const arrKopf = new Kopf();
let arr = null, arrZeit = 0;
export function merkeArr(f) {
  arr = f; arrZeit = performance.now();
  arrKopf.melde(Number(f.projekt_beat), (uhrKopf.rate * 60000) || live.projekt?.tempo_bpm || 128, arrZeit, f.status === 2);
}
// The transport of the live container runs (status 1 waits for its start, 2 plays) by the last clock event; an event older than 1 s counts as stopped.
export const arrLaeuft = (t) => !!arr && (arr.status === 1 || arr.status === 2) && t - arrZeit <= 1000;
export function arrBeat(t) {
  if (!arr || arr.status !== 2 || t - arrZeit > 1000) return null;   // stale: no playhead rather than a guessed one
  return kopfImLoop(arrKopf.beat(t), live.projekt?.loop, Number(arr.projekt_beat));
}
export function zeichneLive() {
  zeigePlaetzeSpaeter();
  zeichneSeq();   // the SEQ places read their deck from the live project
  zeichneStems();   // the stems places read the tracks of their group from it
  zeigeStromZeilen();   // the Strudel module shows a row per stream track of the project
  zeigeLoopdecks();   // the loop deck places read their own stand (GET /loopdeck/stand)
  live.kanal = kanalKennung(zustand.regler);   // stream.js redraws when this flips
  for (const n of DECKS) zeigeExport(n);
}
// What the server says now: the slug and rev first (cheap), the whole project only when the live container changed
export function pruefeLiveSpaeter(ms = 250) {
  clearTimeout(live.pruefen);
  live.pruefen = setTimeout(pruefeLive, ms);
}
export async function pruefeLive() {
  if (live.schreiben.size || live.laeuft || live.seqLaeuft) { pruefeLiveSpaeter(300); return; }
  try {
    const k = await (await fetch('/proj/aktuell?nur=rev')).json();
    if (k.slug === null || k.slug === undefined) { live.projekt = null; live.rev = null; zeichneLive(); return; }
    if (k.slug === (live.projekt ? live.slug : null) && k.rev === live.rev) return;
    if (k.slug !== 'live' && !live.projekt?.live) { if (live.rev !== null) { live.rev = null; zeichneLive(); } return; }   // a production project is open
    const j = await (await fetch('/proj/aktuell')).json();
    live.slug = j.slug; live.projekt = j.projekt?.live ? j.projekt : null; live.rev = j.projekt?.rev ?? null;
    if (j.stems) live.stems = j.stems;
    if (live.projekt) live.stand = await (await fetch('/modul/stand')).json();
    zeichneLive();
  } catch { /* the next event or reconnect tries again */ }
}
export function liveEreignis(a, f) {
  if (a === 'modul') {   // the event's stand has no key distance: read /modul/stand again (it adds tonart_abstand per slot)
    live.stand = f.stand ?? live.stand; zeichneLive();
    if (f.stand && live.projekt) fetch('/modul/stand').then((r) => r.json()).then((s) => { live.stand = s; zeichneLive(); }, () => undefined);
    return;
  }
  if (a === 'seq') { szenenEreignis(f); if (f?.rev !== live.rev) pruefeLiveSpaeter(0); return; }   // a step write of Cypher or another page: read the project when its revision differs from ours
  if (a !== 'proj') return;
  if (f?.stems) { live.stems = f.stems; if (liveOffen()) zeichneLive(); }
  if (!f?.stems || f.stems.zustand !== 'laeuft') pruefeLiveSpaeter();
}
