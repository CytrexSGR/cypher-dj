// PRODUCTION (1.10 Slice 1): reine Funktionen für Gruppen und das Ziel einer Spur (Browser und node). Das Feld heißt ausgang (Projekt /2):
// fehlt es, spielt die Spur auf den Master; sonst zeigt {art: 'gruppe', id} auf eine Gruppen-Spur.
import { MAX_GRUPPEN, MAX_RETURNS, MAX_SPUREN } from './limits.js';

// ---- nested groups (plan 2026-11-12): the tree of the groups. A group's `ausgang` names its parent group (absent = Master). ------------------------
// Parent id of every group (null = top level). An unknown parent, itself, or a parent that would close a cycle (a damaged file) counts as top level.
export function gruppenEltern(projekt) {
  const gl = projekt?.gruppen ?? [], ids = new Set(gl.map((g) => g.id));
  const roh = new Map(gl.map((g) => [g.id, g.ausgang?.art === 'gruppe' && g.ausgang.id !== g.id && ids.has(g.ausgang.id) ? g.ausgang.id : null]));
  const eltern = new Map();
  for (const g of gl) {
    let zyklus = false;
    for (let n = 0, c = roh.get(g.id); c !== null && c !== undefined && n <= gl.length; n++, c = roh.get(c)) if (c === g.id) { zyklus = true; break; }
    eltern.set(g.id, zyklus ? null : roh.get(g.id));
  }
  return eltern;
}
// The group a track plays into, or null (master or an unknown group)
export const spurGruppe = (projekt, spur) => (spur?.ausgang?.art === 'gruppe' && (projekt?.gruppen ?? []).some((g) => g.id === spur.ausgang.id) ? spur.ausgang.id : null);
// The chain of group ids from the outermost group down to `gruppeId` itself
export function gruppenKette(projekt, gruppeId, eltern = gruppenEltern(projekt)) {
  const k = [];
  for (let c = gruppeId, n = 0; c !== null && c !== undefined && n <= eltern.size; n++, c = eltern.get(c)) k.unshift(c);
  return k;
}
// The ids of all groups below `gruppeId` (not itself)
export function nachkommenGruppen(projekt, gruppeId) {
  const eltern = gruppenEltern(projekt), aus = new Set();
  for (const g of projekt?.gruppen ?? []) if (g.id !== gruppeId && gruppenKette(projekt, g.id, eltern).includes(gruppeId)) aus.add(g.id);
  return aus;
}
// The tracks that play into `gruppeId` directly or through child groups
export function alleSpuren(projekt, gruppeId) {
  const unter = nachkommenGruppen(projekt, gruppeId); unter.add(gruppeId);
  return (projekt?.spuren ?? []).filter((s) => unter.has(spurGruppe(projekt, s)));
}
// Array position of the first track at or below a group (Infinity: no track below it). It orders siblings in the arrangement and in Ctrl+G.
export function gruppenSchluessel(projekt) {
  const eltern = gruppenEltern(projekt), m = new Map((projekt?.gruppen ?? []).map((g) => [g.id, Infinity]));
  (projekt?.spuren ?? []).forEach((s, i) => { for (const id of gruppenKette(projekt, spurGruppe(projekt, s), eltern)) if (i < m.get(id)) m.set(id, i); });
  return m;
}
// The strips of the mixer in tree order (depth first, siblings by group number) with their depth. A flat project: number order, all depth 0.
export function gruppenStreifenFolge(projekt) {
  const gl = [...(projekt?.gruppen ?? [])].sort((a, b) => a.nr - b.nr), eltern = gruppenEltern(projekt), aus = [];
  const gehe = (vater, tiefe) => { for (const g of gl) if (eltern.get(g.id) === vater) { aus.push({ id: g.id, tiefe }); gehe(g.id, tiefe + 1); } };
  gehe(null, 0);
  return aus;
}
// Output choices: Master and the groups. For a group (`gruppeId`) not itself and not a group below it (the server refuses a cycle with routing_zyklus).
export const ausgangOptionen = (projekt, gruppeId = null) => {
  const aus = gruppeId === null ? new Set() : nachkommenGruppen(projekt, gruppeId);
  if (gruppeId !== null) aus.add(gruppeId);
  return [{ wert: 'master', text: 'Master' },
    ...[...(projekt?.gruppen ?? [])].sort((a, b) => a.nr - b.nr).filter((g) => !aus.has(g.id)).map((g) => ({ wert: g.id, text: g.name }))];
};
export const ausgangWert = (spur) => spur?.ausgang?.id ?? 'master';
export const ausgangBefehl = (spurId, wert) => ({ befehl: 'ziel_setzen', strang_id: spurId, ausgang: wert === 'master' ? 'master' : { art: 'gruppe', id: wert } });
export const mitglieder = (projekt, gruppeId) => (projekt?.spuren ?? []).filter((s) => s.ausgang?.id === gruppeId);
export const neueGruppeBefehl = (projekt) => (projekt && (projekt.gruppen?.length ?? 0) < MAX_GRUPPEN ? { befehl: 'gruppenspur_neu' } : null);
export const gruppenLabels = (name) => ({
  mute: `Mute group ${name}`, solo: `Solo group ${name}`, fader: `Volume group ${name}`, pan: `Balance group ${name}`,
  loeschen: `Delete group ${name}`, umbenennen: `Rename group ${name}` });

// ---- Slice 3: returns, sends and the Hall values ----------------------------------------------------------------------------------------------
export const returnListe = (projekt) => [...(projekt?.returns ?? [])].sort((a, b) => a.nr - b.nr);
// the dB of the send of a strand (track or group) to a return; -200 = off (no entry)
export const sendWert = (strang, returnId) => (strang?.sends ?? []).find((x) => x.id === returnId)?.db ?? -200;
export const sendBefehl = (strangId, returnId, db) => ({ befehl: 'send_setzen', strang_id: strangId, return_id: returnId, db });
export const neuerReturnBefehl = (projekt) => (projekt && (projekt.returns?.length ?? 0) < MAX_RETURNS ? { befehl: 'return_neu' } : null);
export const returnLabels = (name) => ({
  mute: `Mute return ${name}`, solo: `Solo return ${name}`, fader: `Volume return ${name}`, pan: `Balance return ${name}`,
  loeschen: `Delete return ${name}`, umbenennen: `Rename return ${name}`, hall: `Hall on or off, return ${name}` });
export const sendLabel = (strangName, returnName) => `Send ${strangName} to ${returnName}`;

// The Hall controls are 0..1; the unit comes from ONE table that the kern reads too (djk/core/tests/data/hall_abbildung_ref.json).
// Field of the project -> name in that table. Curves: linear y0 + (y1 - y0) x, log y0 (y1 / y0)^x.
export const HALL_TABELLE = {
  pre: { name: 'pre', einheit: 'ms', kurve: 'linear', y0: 0, y1: 250 },
  decay: { name: 'decay', einheit: 's', kurve: 'log', y0: 0.1, y1: 30 },
  groesse: { name: 'size', einheit: 'ms', kurve: 'linear', y0: 5, y1: 200 },
  tief: { name: 'low', einheit: 'x', kurve: 'log', y0: 0.25, y1: 4 },
  highcut: { name: 'highcut', einheit: 'Hz', kurve: 'log', y0: 1000, y1: 22000 },
  fahne: { name: 'tail', einheit: 'dB', kurve: 'linear', y0: -24, y1: 12 },
};
export function hallEinheit(feld, x) {
  const t = HALL_TABELLE[feld];
  if (!t) throw new Error(`unknown Hall field ${feld}`);
  const u = Math.min(1, Math.max(0, x));
  return t.kurve === 'linear' ? t.y0 + (t.y1 - t.y0) * u : t.y0 * (t.y1 / t.y0) ** u;
}
export function hallText(feld, x) {
  const v = hallEinheit(feld, x), e = HALL_TABELLE[feld].einheit;
  if (e === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
  if (e === 'dB') return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
  if (e === 'x') return `x${v.toFixed(2)}`;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(2)} ${e}`;
}
export const HALL_FELDER_ANZEIGE = [['pre', 'Pre-Delay'], ['groesse', 'Size'], ['decay', 'Decay'], ['tief', 'Low Decay'], ['highcut', 'High Cut'], ['fahne', 'Level']];

// ---- 1.10 slice 6: groups in the arrangement ------------------------------------------------------------------------------------------------
// What a folded group header must still show (review focus 1): dots for armed, solo, muted and an open lane among everything below it, tracks and
// child groups at any depth. `offen`: the set of track ids with an open lane row (page state, not in the project). `mitglieder` counts the tracks below.
export function gruppenKopfZustand(projekt, gruppeId, offen = new Set()) {
  const g = (projekt?.gruppen ?? []).find((x) => x.id === gruppeId), m = alleSpuren(projekt, gruppeId);
  const unter = (projekt?.gruppen ?? []).filter((x) => nachkommenGruppen(projekt, gruppeId).has(x.id));
  return { gefaltet: !!g?.gefaltet, mitglieder: m.length, armiert: m.some((s) => !!s.aufnahme?.scharf), solo: m.some((s) => !!s.solo) || unter.some((x) => !!x.solo),
    stumm: m.some((s) => !!s.mute) || unter.some((x) => !!x.mute), lane: m.some((s) => offen.has(s.id)) };
}
// The body of Ctrl+G: ONE gruppenspur_neu with the selected tracks and group heads that exist (array position of the first track, no duplicates). A
// selected thing below a selected group stays where it is (it moves with that group). null: nothing usable selected or all groups used.
export function gruppeAusWahl(projekt, ids) {
  if (!projekt || (projekt.gruppen?.length ?? 0) >= MAX_GRUPPEN) return null;
  const wahl = new Set(ids ?? []), eltern = gruppenEltern(projekt), schluessel = gruppenSchluessel(projekt);
  const unterWahl = (gruppe) => gruppe !== null && gruppenKette(projekt, gruppe, eltern).slice(0, -1).some((x) => wahl.has(x));   // a selected group above `gruppe`
  const teile = [
    ...(projekt.spuren ?? []).map((s, i) => ({ id: s.id, pos: i, ueber: spurGruppe(projekt, s) })).filter((x) => wahl.has(x.id) && !(x.ueber !== null && (wahl.has(x.ueber) || unterWahl(x.ueber)))),
    ...(projekt.gruppen ?? []).map((g) => ({ id: g.id, pos: schluessel.get(g.id), nr: g.nr, ueber: eltern.get(g.id) })).filter((x) => wahl.has(x.id) && !(x.ueber !== null && (wahl.has(x.ueber) || unterWahl(x.ueber)))),
  ].sort((a, b) => a.pos - b.pos || (a.nr ?? 0) - (b.nr ?? 0));
  const m = teile.map((x) => x.id).slice(0, MAX_SPUREN);
  return m.length ? { befehl: 'gruppenspur_neu', mitglieder: m } : null;
}
