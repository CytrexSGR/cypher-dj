// Controller focus: which synth is in front, told to the page server (POST /controller/fokus) so a controller place that follows can load its assignments.
// This module owns the sending and nothing else: no DOM, no imports. Every selection source (INSTRUMENTS and the device page, the workbench, PRODUCTION, a SEQ
// deck) calls fokus.melde(selection, sourceId); app.js connects the real send function. The server derives graph and base itself and answers with the reason
// when the selection has none, so a source that cannot tell whether its selection is a synth sends it anyway.

const KANAL = /^[a-z]+\/\d+$/;   // a live channel path: erz/5, pad/1 (a project track id is s3 and the like)

/** The message body for a selection: { kanal } | { spur_id } | null (nothing: no synth in front, send nothing).
 *  A selection is { kanal } or { spur_id } (spurId too), or a plain string (a channel path or a track id). A selection may carry `seite`, the page of
 *  the synth's panel that is shown (main, mod, fx ...): it goes along, so a following controller takes the mapping of that page. */
export function fokusVon(auswahl) {
  const wie = (s) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
  if (typeof auswahl === 'string') { const s = wie(auswahl); return s ? (KANAL.test(s) ? { kanal: s } : { spur_id: s }) : null; }
  if (!auswahl || typeof auswahl !== 'object' || Array.isArray(auswahl)) return null;
  const seite = /^[a-z0-9_-]{1,24}$/.test(auswahl.seite ?? '') ? { seite: auswahl.seite } : {};
  const kanal = wie(auswahl.kanal);
  if (kanal) return { kanal, ...seite };
  const spur = wie(auswahl.spur_id) ?? wie(auswahl.spurId);
  return spur ? { spur_id: spur, ...seite } : null;
}

/** The selection to send when the window gets the focus: the source that spoke last first, then the others in order; one that shows nothing is skipped. */
export function waehleQuelle(quellen, zuletzt) {
  const reihe = [...quellen.filter(([id]) => id === zuletzt), ...quellen.filter(([id]) => id !== zuletzt)];
  for (const [, f] of reihe) {
    let a = null;
    try { a = f(); } catch { /* a source that fails shows nothing */ }
    if (fokusVon(a)) return a;
  }
  return null;
}

const schluessel = (f) => JSON.stringify(f);
/** `opt.senden(body) -> Promise<{status}>` (a fetch Response will do). */
export function neuerFokusSender(opt = {}) {
  let senden = opt.senden ?? null;
  let letzte = null;        // key of the focus the server has (sent by this page, or reported by controller_fokus)
  let fehlt = false;        // the server answered 404: it does not know the route
  let wartet = null;        // a selection made before a send function was connected
  let zuletzt = null;       // id of the source that spoke last
  const quellen = [];
  function schick(f) {
    if (!senden) { wartet = f; return true; }
    letzte = schluessel(f);
    Promise.resolve().then(() => senden(f)).then((r) => {
      fehlt = r?.status === 404;
      if (fehlt) letzte = null;
    }, () => { letzte = null; });   // a failed send is tried again at the next change
    return true;
  }
  return {
    /** A selection changed. Sends when it names a synth and differs from the last focus; returns whether something went out. */
    melde(auswahl, quelle = null) {
      const f = fokusVon(auswahl);
      if (!f) return false;
      if (quelle) zuletzt = quelle;
      if (fehlt) return false;                    // no spam against a server that does not know the route; erneut() asks again
      if (schluessel(f) === letzte) return false;
      return schick(f);
    },
    /** The window got the browser focus (or loaded): send what this page shows, whatever was sent last (another window may have moved the focus). */
    erneut() {
      const f = fokusVon(waehleQuelle(quellen, zuletzt));
      if (!f) return false;
      return schick(f);
    },
    /** controller_fokus event or GET /controller/fokus: what the server has now. */
    vomServer(stand) {
      const f = stand?.fokus;
      const k = f ? fokusVon({ kanal: f.kanal, spur_id: f.spur_id }) : null;
      letzte = k ? schluessel(k) : null;
    },
    registriere(id, auswahl) { quellen.push([id, auswahl]); },
    verbinde(f) { senden = f; if (wartet) { const w = wartet; wartet = null; schick(w); } },
    fehlt: () => fehlt,
  };
}

/** The one sender of the page. */
export const fokus = neuerFokusSender();

/** window focus and load: the page sends what it shows now. */
export function bindeFensterFokus(fenster = globalThis.window, dok = globalThis.document) {
  if (!fenster?.addEventListener) return;
  fenster.addEventListener('focus', () => fokus.erneut());
  if (dok?.readyState === 'complete') fokus.erneut(); else fenster.addEventListener('load', () => fokus.erneut());
}
