// The opener side of the device window (device_window.js, target_window.js): the address, the texts and the one function every OPEN ↗ / WINDOW ↗ control calls. A leaf on
// purpose (it imports only device_view.js, dock/target.js and window_open.js): production/detail.js, track_heads.js, the workbench, the dock and the SEQ deck import it,
// and the window modes themselves import production/produktion.js. UI texts English.
import { kannGeraetAnsicht } from './production/device_view.js';
import { parseZiel, zielAusHash, zielHash, zielName } from './dock/target.js';
import { fensterMass, oeffneFensterRoh, FENSTER_GESPERRT } from './window_open.js';

export const GERAET_FENSTER_TEXT = {
  knopf: 'OPEN ↗',
  titel: 'Open this instrument in its own window',
  titelZiel: 'Open this in its own window',
  gesperrt: FENSTER_GESPERRT,
  keinProjekt: 'No project is open',
  anderesProjekt: (name) => `Another project is open. This window belongs to "${name}"`,
  spurWeg: 'This track is not in the project any more',
  stufeWeg: 'This stage is not in the project any more',
  rueckWeg: 'This return is not in the project any more',
  gruppeWeg: 'This group is not in the project any more',
  offline: 'The project server does not answer: this is the last state it sent',
};

// ---------- the hash ----------
// The grammar is dock/target.js (`#geraet=<track id | ins:<id> | ret:<id> | grp:<id> | master>`).
/** The track id a window address names (`#geraet=s3`), or null when the address is not the window of a TRACK's instrument (another target, another window). */
export function geraetFensterSpur(hash) {
  const z = zielAusHash(hash);
  return z?.art === 'spur' ? z.id : null;
}
/** The target of THIS page when it is a device window of any kind, else null. Read once at load like `remixFenster` (a window does not turn into another mode by itself). */
export const geraetFensterZiel = zielAusHash(globalThis.location?.hash);
/** The track of THIS page when it is the instrument window, else null. */
export const geraetFensterSpurId = geraetFensterZiel?.art === 'spur' ? geraetFensterZiel.id : null;
/** Is this page a device window of any kind (instrument, stage, strip)? The main views are not built there. */
export const geraetFensterAn = geraetFensterZiel !== null;

// ---------- the opener ----------
/** Has the device of this track a view the window can show? Baukasten, RB-338, Surge quick panel (device_view.js) and the rack panel. */
export const kannGeraetFenster = (spur) => kannGeraetAnsicht(spur) || spur?.geraet?.art === 'rack';

/** The window size: the instrument window is the synth window of strudel_sound.js (1100 x 880) but wide (1500 x 880), every other target 1100 x 760; up to the screen. */
export function geraetFensterMass(schirm, art = 'spur') {
  return fensterMass(schirm, art === 'spur' ? 1500 : 1100, art === 'spur' ? 880 : 760);
}
// One window for every track: it follows the synth in front (device_window.js FOLLOW), and OPEN ↗ of another track turns it by the address. Every other target has a window of its own.
export const geraetFensterName = (ziel = 'spur') => zielName(typeof ziel === 'string' ? (parseZiel(ziel) ?? { art: 'spur', text: ziel }) : ziel);

/** Opens (or focuses) the device window of a target: a track id (the instrument), `ins:<stage id>`, `ret:<id>`, `grp:<id>` or `master`. `melde(text, fehler)` says that the
 *  browser blocked it. Returns the window or null (an empty or unknown target opens nothing). */
export function oeffneGeraetFenster(ziel, melde, opt = {}) {
  const z = typeof ziel === 'string' ? parseZiel(ziel) : (ziel && parseZiel(ziel.text));
  if (!z) return null;
  const { B, H } = geraetFensterMass(opt.schirm ?? globalThis.screen, z.art);
  return oeffneFensterRoh({ adresse: `/${zielHash(z)}`, name: zielName(z), breite: B, hoehe: H, melde, meldung: GERAET_FENSTER_TEXT.gesperrt, schirm: opt.schirm, fenster: opt.fenster });
}
