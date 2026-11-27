// NOTEN (note editor, N16): pointer, wheel and key handling of the editor surface on a canvas. It reads and writes only through the adapter
// (contract.js) and draws with zeichnen.js; nothing here knows cypher-dj. One gesture is at most ONE op: a pitch drag shows its preview until the release
// and sends `ton` then, computed from the stand of that moment (a note that is gone by then sends nothing).
//   pointer down on a note selects it (Ctrl or Meta toggles), in empty space it clears the selection
//   a move of more than 3 px starts a pitch drag; release sends the op (Alt: free 0.01 steps, Shift: tones of the key, else whole semitones); Escape cancels
//   double click on a note: reset it; right click: Reset note, Reset all notes, Remove notes from clip
//   wheel: time, Shift+wheel: pitch, Ctrl or Meta+wheel: zoom
import { pruefeAdapter } from './contract.js';
import { TON_HOEHE, neueAnsicht, zoom, scrolle, scrolleTon, trefferNote, zugOp } from './view.js';
import { zeichne } from './zeichnen.js';

export const ZUG_START_PX = 3;
const WHEEL_ZOOM = 1.25;               // per 100 wheel units
const WHEEL_TON = 40;                  // wheel units per row

export function bindeNotenEditor(canvas, adapter, { menue } = {}) {
  const fehlt = pruefeAdapter(adapter);
  if (fehlt.length) throw new TypeError(`note editor adapter lacks: ${fehlt.join(', ')}`);
  if (typeof menue !== 'function') throw new TypeError('note editor needs a menue(punkte, x, y) function');
  const g = canvas.getContext('2d');
  let a = null, quelleS = null, tonBewegt = false, notenZahl = 0, auswahl = [], zug = null, geplant = false, beendet = false;
  let breite = 0, hoehe = 0;

  const modus = (e) => (e.altKey ? 'frei' : e.shiftKey ? 'tonart' : 'halbton');
  const sende = (op) => Promise.resolve().then(() => adapter.schreibe(op)).catch(() => ({ ok: false, grund: 'fehler', text: '' }));
  const x = (e) => e.offsetX, y = (e) => e.offsetY;
  const ids = (sicht) => new Set(sicht.noten.map((n) => n.id));

  // size of the canvas bitmap follows the box on the page; the view starts fitted for a new source and re-centres on the notes when they first appear
  function messe(sicht) {
    const r = canvas.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height);
    if (w === 0 || h === 0) return false;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    breite = w; hoehe = h;
    if (!a || quelleS !== sicht.quelleS) { a = neueAnsicht(sicht, w, h); quelleS = sicht.quelleS; tonBewegt = false; auswahl = []; zug = null; }
    else if (notenZahl === 0 && sicht.noten.length > 0 && !tonBewegt) a = { ...a, tonOben: neueAnsicht(sicht, w, h).tonOben };
    notenZahl = sicht.noten.length;
    return true;
  }
  function zeichneJetzt() {
    if (beendet) return;
    const sicht = adapter.lies();
    if (!messe(sicht)) return;
    const da = ids(sicht);
    auswahl = auswahl.filter((id) => da.has(id));
    const vorschau = zug?.begonnen ? zugOp(sicht.noten, zug.ids, zug.anker, zug.dy, zug.modus, sicht.rasteTonart) : null;
    zeichne(g, a, sicht, { auswahl, zug: vorschau ? { ids: vorschau.ids, um: vorschau.um } : null, breite, hoehe });
  }
  function neu() {
    if (beendet) return;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== 'function') { zeichneJetzt(); return; }
    if (geplant) return;
    geplant = true;
    raf(() => { geplant = false; zeichneJetzt(); });
  }
  const abbestellen = adapter.abonniere(() => neu());

  const klick = (e) => { const sicht = adapter.lies(); return messe(sicht) ? { sicht, treffer: trefferNote(sicht.noten, a, x(e), y(e)) } : null; };

  const mit = (e) => e.ctrlKey || e.metaKey;
  const auf = (e) => {
    if (e.button !== 0) return;
    const k = klick(e);
    if (!k) return;
    const { treffer } = k;
    if (!treffer) { if (!mit(e)) auswahl = []; neu(); return; }
    e.preventDefault?.(); canvas.setPointerCapture?.(e.pointerId); canvas.focus?.({ preventScroll: true });
    if (mit(e)) {
      if (auswahl.includes(treffer)) { auswahl = auswahl.filter((id) => id !== treffer); neu(); return; }
      auswahl = [...auswahl, treffer];
    } else if (!auswahl.includes(treffer)) auswahl = [treffer];
    zug = { anker: treffer, ids: [...auswahl], x0: x(e), y0: y(e), dy: 0, modus: modus(e), begonnen: false };
    neu();
  };
  const bewegt = (e) => {
    if (!zug) return;
    const dx = x(e) - zug.x0, dyPx = y(e) - zug.y0;
    if (!zug.begonnen && Math.hypot(dx, dyPx) <= ZUG_START_PX) return;
    zug.begonnen = true; zug.dy = -dyPx / TON_HOEHE; zug.modus = modus(e);
    neu();
  };
  const los = (e) => {
    if (!zug) return;
    const z = zug; zug = null;
    canvas.releasePointerCapture?.(e.pointerId);
    neu();
    if (e.type === 'pointercancel' || !z.begonnen) return;
    const sicht = adapter.lies();
    const op = zugOp(sicht.noten, z.ids, z.anker, -(y(e) - z.y0) / TON_HOEHE, modus(e), sicht.rasteTonart);
    if (op) sende(op);
  };
  const doppel = (e) => {
    const k = klick(e);
    if (k?.treffer) sende({ art: 'zuruecksetzen', ids: [k.treffer] });
  };
  const kontext = (e) => {
    e.preventDefault?.();
    const k = klick(e);
    if (!k) return;
    if (k.treffer && !auswahl.includes(k.treffer)) { auswahl = [k.treffer]; neu(); }
    const ziel = [...auswahl], leer = k.sicht.noten.length === 0;
    menue([
      { text: 'Reset note', aus: ziel.length === 0, aktion: () => { if (ziel.length) sende({ art: 'zuruecksetzen', ids: ziel }); } },
      { text: 'Reset all notes', aus: leer, aktion: () => { if (!leer) sende({ art: 'zuruecksetzen' }); } },
      { text: 'Remove notes from clip', aus: leer, aktion: () => { if (!leer) sende({ art: 'entfernen' }); } },
    ], e.clientX, e.clientY);
  };
  const rad = (e) => {
    const sicht = adapter.lies();
    if (!messe(sicht)) return;
    e.preventDefault?.();
    if (mit(e)) a = zoom(a, WHEEL_ZOOM ** (-e.deltaY / 100), x(e));
    else if (e.shiftKey) {
      const d = e.deltaY || e.deltaX, schritt = Math.max(1, Math.round(Math.abs(d) / WHEEL_TON));
      if (d !== 0) { a = scrolleTon(a, d > 0 ? -schritt : schritt, hoehe); tonBewegt = true; }
    } else {
      a = scrolle(a, e.deltaX || e.deltaY);
      if (a.s0 > sicht.quelleS) a = { ...a, s0: sicht.quelleS };
    }
    neu();
  };
  const taste = (e) => {
    if (e.key === 'Escape' && zug) { zug = null; neu(); }
    // Slice 1 has no note deletion: the keys must not reach a host's global delete (the page would delete the clip)
    if (e.key === 'Delete' || e.key === 'Backspace') { e.stopPropagation(); e.preventDefault(); }
  };

  const hoerer = [['pointerdown', auf], ['pointermove', bewegt], ['pointerup', los], ['pointercancel', los], ['dblclick', doppel], ['contextmenu', kontext], ['keydown', taste]];
  for (const [n, f] of hoerer) canvas.addEventListener(n, f);
  canvas.addEventListener('wheel', rad, { passive: false });

  return {
    zeige() { zeichneJetzt(); },
    los() {
      beendet = true; zug = null;
      abbestellen();
      for (const [n, f] of hoerer) canvas.removeEventListener?.(n, f);
      canvas.removeEventListener?.('wheel', rad);
    },
  };
}
