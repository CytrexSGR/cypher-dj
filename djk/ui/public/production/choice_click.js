// Does a document click count as a click "elsewhere", so that it clears the track selection (production.js)?
const BLEIBT = '.p-dock, .w-fenster-flaeche, .p-face, .p-menue, .p-ins-schwebend';
const WAHL = '.p-arr-name, .p-arr-gruppe .p-ausgang, .p-kopf[data-spur], [data-p="gruppieren"]';

/** `ziel`: the click target. A target that is already detached (the X of a floating window, a menu entry, the X of a popover remove their element while the
 *  click is still on its way) says nothing about where the click was: it keeps the selection. */
export function klickDaneben(ziel) {
  if (!ziel || ziel.isConnected === false) return false;
  if (ziel.closest?.(BLEIBT)) return false;   // a click in the dock, a window, a device face, a menu or a floating popover keeps the selection (Escape still clears it)
  if (ziel.closest?.(WAHL)) return false;     // a click on a track head selects there (track_heads.js: plain, Ctrl, Shift), on a group head name or output select
  return true;
}
