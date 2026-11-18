// The opener side of the device window (device_window.js): the address, the texts and the one function every OPEN ↗ control calls. A leaf on purpose (it imports only
// device_view.js): production/detail.js, track_heads.js, the workbench and the SEQ deck import it, and the window mode itself imports production/produktion.js.
// UI texts English.
import { kannGeraetAnsicht } from './production/device_view.js';

export const GERAET_FENSTER_TEXT = {
  knopf: 'OPEN ↗',
  titel: 'Open this instrument in its own window',
  gesperrt: 'The browser blocked the window: allow pop-ups for this page',
  keinProjekt: 'No project is open',
  anderesProjekt: (name) => `Another project is open. This window belongs to "${name}"`,
  spurWeg: 'This track is not in the project any more',
  offline: 'The project server does not answer: this is the last state it sent',
};

// ---------- the hash ----------
const HASH = /^#geraet=(.+)$/;
/** The track id a window address names (`#geraet=s3`), or null when the address is not a device window (or names no track). */
export function geraetFensterSpur(hash) {
  const m = HASH.exec(typeof hash === 'string' ? hash : '');
  if (!m) return null;
  let id;
  try { id = decodeURIComponent(m[1]).trim(); } catch { return null; }
  return id === '' ? null : id;
}
/** The track of THIS page when it is a device window, else null. Read once at load like `remixFenster` (a window does not turn into another mode by itself). */
export const geraetFensterSpurId = geraetFensterSpur(globalThis.location?.hash);

// ---------- the opener ----------
/** Has the device of this track a view the window can show? Baukasten, RB-338, Surge quick panel (device_view.js) and the rack panel. */
export const kannGeraetFenster = (spur) => kannGeraetAnsicht(spur) || spur?.geraet?.art === 'rack';

/** The window size: the synth window of strudel_sound.js (1100 x 880) but wide, up to the screen. */
export function geraetFensterMass(schirm) {
  const w = schirm?.availWidth ?? 1920, h = schirm?.availHeight ?? 1080;
  const B = Math.min(1500, w), H = Math.min(880, h);
  return { B, H, x: Math.round((schirm?.availLeft ?? 0) + (w - B) / 2), y: Math.round((schirm?.availTop ?? 0) + (h - H) / 2) };
}
// One window for every track: it follows the synth in front (device_window.js FOLLOW), and OPEN ↗ of another track turns it by the address.
export const geraetFensterName = () => 'djk-geraet';

/** Opens (or focuses) the device window of a project track. `melde(text, fehler)` says that the browser blocked it. Returns the window or null. */
export function oeffneGeraetFenster(spurId, melde, opt = {}) {
  const fenster = opt.fenster ?? globalThis.window, schirm = opt.schirm ?? globalThis.screen;
  if (!spurId) return null;
  const { B, H, x, y } = geraetFensterMass(schirm);
  const w = fenster.open(`/#geraet=${encodeURIComponent(spurId)}`, geraetFensterName(spurId), `popup,width=${B},height=${H},left=${x},top=${y}`);
  if (!w) { melde?.(GERAET_FENSTER_TEXT.gesperrt, true); return null; }
  try { w.focus(); } catch { /* the window manager decides */ }
  return w;
}

