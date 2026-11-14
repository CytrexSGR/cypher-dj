// REMIX place (DJ view): the pure logic of the fourth place type. No DOM here, so it runs in node tests.
// The fx-remix device sits on ONE target: the DJ master, deck 1..4, the loop slots L1, L2 or one of the three Strudel streams (graph channels `master`,
// `deck/1`..`deck/4`, `pad/1`, `pad/2`, `erz/1`..`erz/3`; on a source channel it is an insert before the fader). The place does not keep its own
// memory of that: the target is read off the core state (`graphen` = { channel: graph name }, the page's graphenGeladen), so a reload of the page
// or a load by Cypher's tools shows up the same way.
import { zielName } from './slots.js';

export const GERAET = 'fx-remix';
export const ZIELE = ['master', 'deck/1', 'deck/2', 'deck/3', 'deck/4', 'pad/1', 'pad/2', 'erz/1', 'erz/2', 'erz/3'];
// Targets whose stream may play an instrument graph: there the core keeps one graph per channel, so a replacement takes the other graph off first.
const QUELLEN = ['pad/1', 'pad/2', 'erz/1', 'erz/2', 'erz/3'];

// The target that currently carries the device, or null (OFF). With several (should not happen) the first in ZIELE order wins.
export const aktuellesZiel = (graphen) => ZIELE.find((k) => graphen?.[k] === GERAET) ?? null;

// The graph that sits on `ziel` and is not the device itself ('' when the target is free or carries the device).
export const fremderGraph = (graphen, ziel) => { const n = graphen?.[ziel]; return n && n !== GERAET ? n : ''; };

// The buttons of the target choice: OFF is `ziel: null`. `fremd` names the other graph a target already carries.
export function zielWahl(graphen) {
  const jetzt = aktuellesZiel(graphen);
  return [...ZIELE, null].map((ziel) => ({ ziel, name: ziel ? zielName(ziel) : 'OFF', aktuell: ziel === jetzt, fremd: ziel ? fremderGraph(graphen, ziel) : '' }));
}

// The lock on leaving REMIX: while the device is on a target the place may not change type (an effect running hidden on the master would be invisible).
export function typSperre(graphen) {
  const z = aktuellesZiel(graphen);
  return z ? { gesperrt: true, text: `remix is on ${zielName(z)}: set target OFF first` } : { gesperrt: false, text: '' };
}

// What a click on a target does. `offen` is the target that already asked for a confirmation (or null). Result:
//  { art: 'nichts' }                        the click changes nothing (target already chosen, or OFF while off)
//  { art: 'bestaetigen', ziel, name }       another graph sits there: ask once more ("REPLACE <name>"), then call again with offen = ziel
//  { art: 'schritte', schritte: [{ kanal, name }] }  the POSTs /graph in order: take the device off its old target first, then load it
export function zielKlick(graphen, ziel, offen = null) {
  const jetzt = aktuellesZiel(graphen);
  if (ziel === (jetzt ?? null)) return { art: 'nichts' };
  if (ziel === null) return { art: 'schritte', schritte: [{ kanal: jetzt, name: '' }] };
  if (!ZIELE.includes(ziel)) return { art: 'nichts' };
  const fremd = fremderGraph(graphen, ziel);
  if (fremd && offen !== ziel) return { art: 'bestaetigen', ziel, name: fremd };
  const schritte = [];
  if (jetzt) schritte.push({ kanal: jetzt, name: '' });
  if (fremd && QUELLEN.includes(ziel)) schritte.push({ kanal: ziel, name: '' });
  schritte.push({ kanal: ziel, name: GERAET });
  return { art: 'schritte', schritte };
}

// The panel line under the target choice.
export function hinweis(graphen) {
  const z = aktuellesZiel(graphen);
  if (!z) return 'choose where the effect sits: INSERT ON';
  return `an effect on ${zielName(z)}: it shapes what plays there${z === 'master' ? '' : ' (before the channel fader)'}; the PAD voices sound on their own`;
}

// The text of a refusal of POST /graph (answer of the page server): the reason as one short line.
export function ablehnung(r) {
  if (!r) return 'no answer';
  if (!r.ok) return String(r.j?.text ?? r.j?.fehler ?? r.code);
  if (r.j?.quittung?.status === 6) return String(r.j.quittung.grund ?? 'refused');
  if (!r.j?.quittung) return 'no answer from the core yet';
  return '';
}
