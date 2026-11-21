// FX3 (2026-11-14, Andreas: "fx3 remix effekt einbauen richtig als verwendbaren 3 fx im mischpult"): the third FX unit of the DJ mixer.
// It is an insert on a group: the channels assigned to unit 3 (key 3 on their strip, POST /fx/zuweisung einheit 3) leave the master sum after
// fader and crossfader, pass the device on the send return fx/3 together, and its output joins the master. The device is a Baukasten graph
// loaded on fx/3 (default fx-remix); a channel leaving unit 3 lets the device's tail ring out. Pure logic, no DOM, so it runs in node tests.
import { CONTAINER, containerName } from './kanaele.js';

export const PLATZ = 'fx/3';
export const GERAET = 'fx-remix';
// Channels that carried the device as a channel insert before FX3 existed (the old Remix target choice).
const ALTE_ZIELE = ['master', ...CONTAINER.map((c) => c.pfad)];

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

// The channels the page offers for unit 3, in mixer order: the four container strips A..D (a module reaches the master only through its container).
export const kanaele = () => CONTAINER.map((c) => c.pfad);

// The short text of the FX3 unit in the mixer: which channels pass the device.
export function zugewieseneText(zuweisung) {
  const an = kanaele().filter((k) => zuweisung?.[k]);
  return an.length ? an.map((k) => kurzName(k)).join(' ') : '–';
}
export const kurzName = (k) => containerName(k) ?? k;
