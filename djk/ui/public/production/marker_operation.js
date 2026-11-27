// PRODUCTION: the marker strip above the ruler. DOM elements (not canvas): one <button data-p="marker" data-id> per marker of the project field `marker`,
// sitting in the strip `marker-leiste` (16 px, directly above the ruler, same column, so a flag is at beatZuX(st.ansicht, beat) like the ruler marks and clips).
// The strip follows scroll and zoom through the frame hook (ctx.beimBild): it draws again only when the marker list changed and moves the flags only when
// the view, the width or a drag changed.
//   click          start marker at the beat of the marker (ctx.springeZu of transport.js: the same function the ruler click uses)
//   Shift click    loop_setzen {an, von_beat, bis_beat} from the marker to the next one (markerBereich), the export range follows the loop
//   double click   rename in place (Enter keeps, Escape leaves); double click on the empty strip: a new marker at the snapped beat
//   drag           from 4 px, snapped to the arrangement GRID, display only until release, then ONE marker_setzen {id, beat}
//   Delete/Backspace on a focused flag, context menu (Rename, Delete marker): marker_loeschen
// Keys act only on a focused flag or the open name field and stop there; Space on a flag does not click it (the library preview owns Space).
import { markerBereich, markerNameFehler, markerVorgabeName, markerZielBeat, markerZugErkannt, markerSichtbar, MARKER_NAME_MAX } from './marker.js';
import { beatZuX, xZuBeat, rasten, rasterBeats, beatsProTakt } from './timeline.js';
import { oeffneMenue } from './context_menu.js';
import { KABEL_FARBEN } from '../panel.js';

export const KEIN_BEREICH_TEXT = 'No range behind this marker';
export const LIVE_TEXT = 'The live container has no markers';
export const NEU_TEXT = 'Add a marker at the start marker (double click on the strip adds one anywhere)';

export function bindeMarker(ctx) {
  const { st, $ } = ctx;
  const leiste = $('marker-leiste'), neu = $('marker-neu');
  const flaggen = new Map();      // marker id -> button
  let gezeichnet = null;          // JSON of the marker list the buttons show
  let lage = null;                // key of the last positioning (view, width, drag)
  let bearbeitet = null;          // { id, feld } while a name field is open
  let zug = null;                 // { id, x0, beat0, aktiv } between pointerdown and pointerup
  let nachZug = false;            // the click that follows the end of a drag is not a click
  st.markerEntwurf = null;        // { id, beat }: the beat a dragged flag shows (display only)

  const schritt = () => rasterBeats(st.raster, beatsProTakt(st.projekt?.taktart));
  const liste = () => (st.projekt && !st.projekt.live ? st.projekt.marker ?? [] : []);
  const marker = (id) => liste().find((m) => m.id === id) ?? null;
  const loesche = (id) => ctx.aendere('Delete marker', [{ befehl: 'marker_loeschen', id }]);

  function schliesseFeld(zurueck) {
    if (!bearbeitet) return;
    const { id, feld } = bearbeitet;
    bearbeitet = null; lage = null;
    feld.remove();
    const f = flaggen.get(id);
    if (f) { f.hidden = false; if (zurueck) f.focus({ preventScroll: true }); }
  }
  function bestaetige() {
    if (!bearbeitet) return;
    const { id, feld } = bearbeitet, m = marker(id), name = feld.value.trim();
    if (!m || name === m.name) { schliesseFeld(true); return; }
    const fehler = markerNameFehler(name);
    if (fehler) { ctx.melde(fehler, true); return; }   // the field stays open: the typed text is not lost
    schliesseFeld(true);
    ctx.aendere('Rename marker', [{ befehl: 'marker_setzen', id, name }]);
  }
  function oeffneFeld(id) {
    const m = marker(id);
    if (!m) return;
    schliesseFeld(false);
    const feld = document.createElement('input');
    feld.setAttribute('type', 'text'); feld.className = 'p-marker-feld'; feld.setAttribute('maxlength', String(MARKER_NAME_MAX));
    feld.setAttribute('aria-label', 'Marker name'); feld.value = m.name;
    feld.addEventListener('keydown', (e) => {
      e.stopPropagation();   // typing never reaches the page shortcuts (Delete, Space, Ctrl+Z, B, R ...)
      if (e.key === 'Enter') { e.preventDefault(); bestaetige(); } else if (e.key === 'Escape') { e.preventDefault(); schliesseFeld(true); }
    });
    feld.addEventListener('blur', () => { if (bearbeitet?.feld === feld) schliesseFeld(false); });
    leiste.append(feld);
    bearbeitet = { id, feld }; lage = null;
    flaggen.get(id)?.setAttribute('hidden', '');
    feld.focus();
    feld.select?.();
  }

  // a new marker at `beat` with the default name, then its name field opens (the project of the answer is in st.projekt when the change resolves)
  async function erzeuge(beat) {
    const p = st.projekt;
    if (!p || p.live) return;
    const belegt = (p.marker ?? []).find((m) => Math.abs(m.beat - beat) < 1e-9);
    if (belegt) { ctx.melde(`The marker "${belegt.name}" already sits on that beat`, true); return; }
    const name = markerVorgabeName(p.marker);
    if (!await ctx.aendere('Add marker', [{ befehl: 'marker_setzen', beat, name }])) return;
    const m = (st.projekt?.marker ?? []).find((x) => Math.abs(x.beat - beat) < 1e-9 && x.name === name);
    if (m) oeffneFeld(m.id);
  }

  function klick(id, e) {
    if (nachZug) { nachZug = false; return; }
    const m = marker(id);
    if (!m) return;
    if (e.shiftKey) {
      const b = markerBereich(st.projekt, id);
      if (!b) { ctx.melde(KEIN_BEREICH_TEXT, true); return; }
      ctx.aendere('Loop from marker', [{ befehl: 'loop_setzen', an: true, von_beat: b.von_beat, bis_beat: b.bis_beat }]);
      return;
    }
    ctx.springeZu(m.beat, { exakt: true });
  }
  function zugEnde(e, abbruch) {
    const z = zug;
    zug = null;
    if (!z?.aktiv) return;
    nachZug = true;
    setTimeout(() => { nachZug = false; }, 0);   // the click of the drag's own release comes right after pointerup; a later (keyboard) click is a real click
    const ziel = abbruch ? z.beat0 : markerZielBeat(z.beat0, (e.clientX ?? z.x0) - z.x0, st.ansicht.pxProBeat, schritt());
    if (ziel === z.beat0) { st.markerEntwurf = null; return; }
    st.markerEntwurf = { id: z.id, beat: ziel };   // stays shown until the answer is in: no flicker back to the old beat
    Promise.resolve(ctx.aendere('Move marker', [{ befehl: 'marker_setzen', id: z.id, beat: ziel }]))
      .finally(() => { if (st.markerEntwurf?.id === z.id) st.markerEntwurf = null; });   // a refusal: the flag is back at its stored beat
  }

  function baueFlagge(m) {
    const b = document.createElement('button');
    b.setAttribute('type', 'button'); b.className = 'p-marker'; b.setAttribute('data-p', 'marker'); b.setAttribute('data-id', m.id);
    const id = m.id;
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const a = marker(id);
      if (!a) return;
      nachZug = false;
      zug = { id, x0: e.clientX, beat0: a.beat, aktiv: false };
      try { b.setPointerCapture?.(e.pointerId); } catch { /* no capture: the move events stop at the edge */ }
    });
    b.addEventListener('pointermove', (e) => {
      if (!zug || zug.id !== id) return;
      const dx = e.clientX - zug.x0;
      if (!zug.aktiv && markerZugErkannt(dx)) zug.aktiv = true;
      if (zug.aktiv) st.markerEntwurf = { id, beat: markerZielBeat(zug.beat0, dx, st.ansicht.pxProBeat, schritt()) };
    });
    b.addEventListener('pointerup', (e) => zugEnde(e, false));
    b.addEventListener('pointercancel', (e) => zugEnde(e, true));
    b.addEventListener('click', (e) => klick(id, e));
    b.addEventListener('dblclick', () => oeffneFeld(id));
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); loesche(id); }
      else if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); oeffneFeld(id); }
      else if (e.key === ' ') e.preventDefault();   // Space does not "click" the flag (keyup clicks in Chrome, keydown in Firefox); on this page it belongs to the library preview (seitenrahmen.js)
    });
    b.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      oeffneMenue([{ text: 'Rename', aktion: () => oeffneFeld(id) }, { text: 'Delete marker', aktion: () => loesche(id) }], e.clientX, e.clientY);
    });
    return b;
  }
  function beschrifte(b, m) {
    b.textContent = m.name;   // text, never markup
    b.title = m.name;
    b.style.borderLeftColor = m.farbe === undefined ? '' : KABEL_FARBEN[m.farbe % KABEL_FARBEN.length];
  }
  function baueNeu(l) {
    const aktiv = typeof document !== 'undefined' ? document.activeElement : null;
    const ids = new Set(l.map((m) => m.id));
    for (const [id, b] of flaggen) if (!ids.has(id)) { b.remove(); flaggen.delete(id); }
    for (const m of l) {
      let b = flaggen.get(m.id);
      if (!b) { b = baueFlagge(m); flaggen.set(m.id, b); leiste.append(b); }
      beschrifte(b, m);
      if (bearbeitet?.id === m.id) b.setAttribute('hidden', '');
    }
    // the document order follows the beat order (tab order); a flag that has the focus is put back after the move
    const soll = l.map((m) => flaggen.get(m.id));
    const ist = leiste.querySelectorAll('[data-p="marker"]');
    if (soll.some((b, i) => b !== ist[i])) { for (const b of soll) leiste.append(b); if (aktiv && soll.includes(aktiv)) aktiv.focus({ preventScroll: true }); }
  }
  function setzeLage(l) {
    const a = st.ansicht, breite = ctx.breite(), e = st.markerEntwurf;
    const schluessel = `${a.beat0}|${a.pxProBeat}|${breite}|${e ? `${e.id}:${e.beat}` : ''}`;
    if (schluessel === lage) return;
    lage = schluessel;
    const x = (m) => beatZuX(a, e && e.id === m.id ? e.beat : m.beat);
    for (const m of l) {
      const b = flaggen.get(m.id), px = x(m);
      b.style.left = `${px}px`;
      b.hidden = !markerSichtbar(px, breite) || bearbeitet?.id === m.id;
      b.classList.toggle('zieht', !!e && e.id === m.id);
    }
    if (bearbeitet) {
      const m = marker(bearbeitet.id);
      if (m) { const px = beatZuX(a, m.beat); bearbeitet.feld.style.left = `${px}px`; bearbeitet.feld.hidden = !markerSichtbar(px, breite); }
    }
  }
  function zeichne() {
    const l = liste();
    const json = JSON.stringify(l);
    if (json !== gezeichnet) {
      gezeichnet = json; lage = null;
      baueNeu(l);
      if (bearbeitet && !marker(bearbeitet.id)) schliesseFeld(false);   // the marker is gone (deleted elsewhere, undone)
    }
    setzeLage(l);
  }

  leiste.setAttribute('role', 'group'); leiste.setAttribute('aria-label', 'Markers');
  leiste.addEventListener('dblclick', (e) => {
    if (e.target !== leiste || !st.projekt || st.projekt.live) return;   // only the empty strip: a flag has its own double click
    erzeuge(Math.max(0, rasten(xZuBeat(st.ansicht, e.offsetX), schritt())));
  });
  neu.addEventListener('click', () => erzeuge(st.start));
  ctx.beimProjekt.push((p) => {
    neu.disabled = !p || !!p.live;
    neu.title = p?.live ? LIVE_TEXT : NEU_TEXT;
  });
  ctx.beimBild.push(zeichne);
}
