// Workbench big view: the floating windows inside the page (the "extended view" of a card). The window layer itself lives in ../dock/window.js and is shared
// with PRODUCTION; this file binds it to STUDIO: it mounts it on the STUDIO host (dock.js, werkbankDockHost), puts its entry points on ctx
// (ctx.fenster = {oeffne(def), schliesse(id), schliesseAlle(), offen()}, ctx.oeffneGeraet(spurId), ctx.oeffneStufe(strangId, teil)) and implements the cut/kit
// hook of the track window: the SOUND host (cut strip, kit dialog, ROOT box) works on the selected track (st.wahl). It sits in the window of that track when
// it is open; otherwise it is hidden in the workbench root. Runs at every selection, after a window opened or closed. The strip draws for the selected track
// in any case: it is redrawn when the host moved, because a hidden canvas has no size.
import { montiereFenster } from '../dock/window.js';
import { werkbankDockHost } from './dock.js';

export { FENSTER_TEXT } from '../dock/window.js';

export function bindeFenster(ctx) {
  const { st } = ctx;
  const host = werkbankDockHost(ctx);
  const koerper = new Map();   // track id -> body of its open window
  const wurzel = () => host.flaecheEl.parentNode ?? host.flaecheEl.parent;
  function stelleKlangHost() {
    const h = ctx.klangHost;
    if (!h) return;
    const k = st.wahl !== null && st.wahl !== undefined ? koerper.get(st.wahl) : undefined;
    if (k) {
      const bewegt = !k.contains(h) || h.hidden;
      if (!k.contains(h)) k.append(h);
      h.hidden = false;
      if (bewegt) ctx.zeichneSchnitt?.();
      return;
    }
    h.hidden = true;
    const w = wurzel();
    if (w && (h.parentNode ?? h.parent) !== w) w.append(h);
  }
  host.spurFensterHaken = {
    offen: (spurId, k) => { koerper.set(spurId, k); stelleKlangHost(); },
    zu: (spurId) => { koerper.delete(spurId); stelleKlangHost(); },
    wahl: () => st.wahl,
  };
  const { fenster, oeffneGeraet, oeffneStufe } = montiereFenster(host);
  ctx.fenster = fenster; ctx.oeffneGeraet = oeffneGeraet; ctx.oeffneStufe = oeffneStufe;
  ctx.beiWahl.push(stelleKlangHost);
}
