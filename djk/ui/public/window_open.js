// The one place that calls window.open for the pages of this app that open in a window of their own: the device and effect windows (device_open.js), the
// Remix window, the tablet page of the Strudel sound column and the Controllers window. They share the size rule, the blocked pop-up message and the focus.
// A leaf on purpose: no imports. UI texts English.

export const FENSTER_GESPERRT = 'The browser blocked the window: allow pop-ups for this page';

/** The size and place of a window: at most `breite` x `hoehe`, never bigger than the screen, centred on it. `klemme0`: the corner is never negative (a window of
 *  a screen left of the primary one keeps its place otherwise). Pure. */
export function fensterMass(schirm, breite, hoehe, klemme0 = false) {
  const w = schirm?.availWidth ?? 1920, h = schirm?.availHeight ?? 1080;
  const B = Math.min(breite, w), H = Math.min(hoehe, h);
  const links = (schirm?.availLeft ?? 0) + (w - B) / 2, oben = (schirm?.availTop ?? 0) + (h - H) / 2;
  return { B, H, x: Math.round(klemme0 ? Math.max(0, links) : links), y: Math.round(klemme0 ? Math.max(0, oben) : oben) };
}

/** Opens `adresse` as a pop-up named `name` and focuses it. Returns the window, or null when the browser blocked it (then `meldung` is said through `melde` as an
 *  error when both are given). `anpassen`: size and place the window again, because a window of the same name keeps the size it had. opt: { schirm, fenster } (tests). */
export function oeffneFensterRoh({ adresse, name, breite, hoehe, melde, meldung, anpassen = false, klemme0 = false, schirm, fenster }) {
  const f = fenster ?? globalThis.window, s = schirm ?? globalThis.screen;
  const { B, H, x, y } = fensterMass(s, breite, hoehe, klemme0);
  const w = f.open(adresse, name, `popup,width=${B},height=${H},left=${x},top=${y}`);
  if (!w) { if (meldung) melde?.(meldung, true); return null; }
  if (anpassen) { try { w.resizeTo(B, H); w.moveTo(x, y); } catch { /* the window manager decides */ } }
  try { w.focus(); } catch { /* the window manager decides */ }
  return w;
}
