// PRODUCTION (1.10 Slice 1): reine Funktionen für Gruppen und das Ziel einer Spur (Browser und node). Das Feld heißt ausgang (Projekt /2):
// fehlt es, spielt die Spur auf den Master; sonst zeigt {art: 'gruppe', id} auf eine Gruppen-Spur.
import { MAX_GRUPPEN, MAX_RETURNS, MAX_SPUREN } from './limits.js';

export const ausgangOptionen = (projekt) => [{ wert: 'master', text: 'Master' },
  ...[...(projekt?.gruppen ?? [])].sort((a, b) => a.nr - b.nr).map((g) => ({ wert: g.id, text: g.name }))];
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
// What a folded group header must still show (review focus 1): dots for armed, solo, muted and an open lane among the members. `offen`: the set of track
// ids with an open lane row (page state, not in the project).
export function gruppenKopfZustand(projekt, gruppeId, offen = new Set()) {
  const g = (projekt?.gruppen ?? []).find((x) => x.id === gruppeId), m = mitglieder(projekt, gruppeId);
  return { gefaltet: !!g?.gefaltet, mitglieder: m.length, armiert: m.some((s) => !!s.aufnahme?.scharf), solo: m.some((s) => !!s.solo),
    stumm: m.some((s) => !!s.mute), lane: m.some((s) => offen.has(s.id)) };
}
// The body of Ctrl+G: ONE gruppenspur_neu with the selected tracks that exist (project order, no duplicates). null: nothing usable selected or all groups used.
export function gruppeAusWahl(projekt, ids) {
  if (!projekt || (projekt.gruppen?.length ?? 0) >= MAX_GRUPPEN) return null;
  const wahl = new Set(ids ?? []), m = projekt.spuren.filter((s) => wahl.has(s.id)).map((s) => s.id).slice(0, MAX_SPUREN);
  return m.length ? { befehl: 'gruppenspur_neu', mitglieder: m } : null;
}
