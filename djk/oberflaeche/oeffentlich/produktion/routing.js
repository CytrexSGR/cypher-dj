// PRODUCTION (1.10 Slice 1): reine Funktionen für Gruppen und das Ziel einer Spur (Browser und node). Das Feld heißt ausgang (Projekt /2):
// fehlt es, spielt die Spur auf den Master; sonst zeigt {art: 'gruppe', id} auf eine Gruppen-Spur.
import { MAX_GRUPPEN } from './grenzen.js';

export const ausgangOptionen = (projekt) => [{ wert: 'master', text: 'Master' },
  ...[...(projekt?.gruppen ?? [])].sort((a, b) => a.nr - b.nr).map((g) => ({ wert: g.id, text: g.name }))];
export const ausgangWert = (spur) => spur?.ausgang?.id ?? 'master';
export const ausgangBefehl = (spurId, wert) => ({ befehl: 'ziel_setzen', strang_id: spurId, ausgang: wert === 'master' ? 'master' : { art: 'gruppe', id: wert } });
export const mitglieder = (projekt, gruppeId) => (projekt?.spuren ?? []).filter((s) => s.ausgang?.id === gruppeId);
export const neueGruppeBefehl = (projekt) => (projekt && (projekt.gruppen?.length ?? 0) < MAX_GRUPPEN ? { befehl: 'gruppenspur_neu' } : null);
export const gruppenLabels = (name) => ({
  mute: `Mute group ${name}`, solo: `Solo group ${name}`, fader: `Volume group ${name}`, pan: `Balance group ${name}`,
  loeschen: `Delete group ${name}`, umbenennen: `Rename group ${name}` });
