// FX3 (2026-11-14, Andreas: "fx3 remix effekt einbauen richtig als verwendbaren 3 fx im mischpult"): the third FX unit of the DJ mixer.
// It is an insert on a group: the channels assigned to unit 3 (key 3 on their strip, POST /fx/zuweisung einheit 3) leave the master sum after
// fader and crossfader, pass the device on the send return fx/3 together, and its output joins the master. The device is a Baukasten graph
// loaded on fx/3 (default fx-remix); a channel leaving unit 3 lets the device's tail ring out. Pure logic, no DOM, so it runs in node tests.
import { streifen, zielName } from './slots.js';

export const PLATZ = 'fx/3';
export const GERAET = 'fx-remix';
// Channels that carried the device as a channel insert before FX3 existed (the old Remix target choice).
const ALTE_ZIELE = ['master', 'deck/1', 'deck/2', 'deck/3', 'deck/4', 'pad/1', 'pad/2', 'erz/1', 'erz/2', 'erz/3'];

export const geladen = (graphen) => graphen?.[PLATZ] === GERAET;
// The graph on fx/3 when it is not the device ('' when free or the device).
export const fremd = (graphen) => { const n = graphen?.[PLATZ]; return n && n !== GERAET ? n : ''; };
// Channels that still carry the device as an old-style insert.
export const altlasten = (graphen) => ALTE_ZIELE.filter((k) => graphen?.[k] === GERAET);

// The POSTs /graph that put the device on fx/3: old-style inserts come off first (the device would otherwise run twice), then fx/3 is loaded.
export function ladeSchritte(graphen) {
  if (geladen(graphen)) return [];
  return [...altlasten(graphen).map((kanal) => ({ kanal, name: '' })), { kanal: PLATZ, name: GERAET }];
}
export const entladeSchritte = (graphen) => (geladen(graphen) ? [{ kanal: PLATZ, name: '' }] : []);

// The channels the page offers for unit 3, in mixer order: the strips of the four places, the loop strips L1 and L2 (always in the mixer, whether a
// Loops place shows the deck or not), then the Strudel streams when a place shows Strudel.
export function kanaele(layout) {
  const k = [1, 2, 3, 4].flatMap((p) => streifen(layout, p).map((s) => s.kanal));
  k.push('pad/1', 'pad/2');
  if (layout.includes('strudel')) k.push('erz/1', 'erz/2', 'erz/3');
  return k;
}

// The short text of the FX3 unit in the mixer: which channels pass the device.
export function zugewieseneText(zuweisung, layout) {
  const an = kanaele(layout).filter((k) => zuweisung?.[k]);
  return an.length ? an.map((k) => kurzName(k)).join(' ') : '–';
}
const KURZ = { 'pad/1': 'L1', 'pad/2': 'L2', 'erz/1': 'DR', 'erz/2': 'BA', 'erz/3': 'ME' };
export const kurzName = (k) => KURZ[k] ?? (/^deck\/[1-4]$/.test(k) ? ['A', 'B', 'D3', 'D4'][Number(k.slice(5)) - 1] : zielName(k));
