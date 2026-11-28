// PRODUCTION: the chord lane row under the ruler (project field `harmonie`). DOM elements like the marker strip: one <button data-p="harmonie-block">
// per entry in the row `harmonie-zeile`, same column as the ruler, so a block is at beatZuX(st.ansicht, beat). The toggle CHORDS in the toolbar
// shows or hides the row (a view setting of this page, not part of the project).
//   double click on the empty row   a name field at the snapped beat; Enter adds the entry (chord symbol "Am7" or key "A minor"), Escape leaves
//   double click / F2 on a block    the same field to rewrite the entry
//   drag                            from 4 px, snapped to the arrangement GRID, display only until release, then ONE harmonie_setzen
//   Delete / Backspace on a block   removes it (the last one removes the lane: eintraege null)
// Every gesture ends in exactly one harmonie_setzen that carries the whole lane (harmonie_line.js builds the list). Keys act only on a focused block or
// the open field and stop there.
import { harmonieAnzeige, harmonieHinzu, harmonieBewege, harmonieUmschreiben, harmonieLoesche, harmonieBefehl, harmonieSichtbar, HARMONIE_ZEILE_MAX } from './harmonie_line.js';
import { markerZielBeat, markerZugErkannt } from './marker.js';
import { beatZuX, xZuBeat, rasten, rasterBeats, beatsProTakt } from './timeline.js';

export const HARMONIE_LIVE_TEXT = 'The live container has no chord lane';
export const HARMONIE_FEHLER_TEXT = 'Type a chord symbol (Am7, F#m7b5, Bb) or a key (A minor, C major)';

export function bindeHarmonie(ctx) {
  const { st, $ } = ctx;
  const zeile = $('harmonie-zeile'), knopf = $('harmonie-an');
  const bloecke = new Map();   // beat -> button
  let gezeichnet = null;       // JSON of the list the buttons show
  let lage = null;             // key of the last positioning (view, width, drag)
  let feld = null;             // { feld, beat, neu } while the text field is open
  let zug = null;              // { beat0, x0, aktiv } between pointerdown and pointerup
  let nachZug = false;
  st.harmonieEntwurf = null;   // { beat0, beat }: the beat a dragged block shows (display only)

  const schritt = () => rasterBeats(st.raster, beatsProTakt(st.projekt?.taktart));
  const liste = () => (st.projekt && !st.projekt.live ? st.projekt.harmonie?.eintraege ?? [] : []);
  const index = (beat) => liste().findIndex((e) => Math.abs(e.beat - beat) < 1e-9);
  const schicke = (label, neu) => ctx.aendere(label, [harmonieBefehl(neu)]);

  function schliesseFeld() {
    if (!feld) return;
    const f = feld.feld;
    feld = null; lage = null;
    f.remove();
  }
  function bestaetige() {
    if (!feld) return;
    const { feld: f, beat, neu } = feld, l = liste(), text = f.value.trim();
    const i = index(beat);
    if (!neu && i >= 0 && text === harmonieAnzeige(l[i])) { schliesseFeld(); return; }
    const ergebnis = neu ? harmonieHinzu(l, beat, text) : (i >= 0 ? harmonieUmschreiben(l, i, text) : null);
    if (!ergebnis) {
      ctx.melde(neu && index(beat) >= 0 ? 'A chord already sits on that beat' : l.length >= HARMONIE_ZEILE_MAX && neu ? `A lane holds at most ${HARMONIE_ZEILE_MAX} entries` : HARMONIE_FEHLER_TEXT, true);
      return;   // the field stays open: the typed text is not lost
    }
    schliesseFeld();
    schicke(neu ? 'Add chord' : 'Edit chord', ergebnis);
  }
  function oeffneFeld(beat, neu) {
    schliesseFeld();
    const i = index(beat);
    if (!neu && i < 0) return;
    const f = document.createElement('input');
    f.setAttribute('type', 'text'); f.className = 'p-harmonie-feld'; f.setAttribute('maxlength', '16'); f.setAttribute('aria-label', 'Chord or key');
    f.value = neu ? '' : harmonieAnzeige(liste()[i]);
    f.addEventListener('keydown', (e) => {
      e.stopPropagation();   // typing never reaches the page shortcuts
      if (e.key === 'Enter') { e.preventDefault(); bestaetige(); } else if (e.key === 'Escape') { e.preventDefault(); schliesseFeld(); }
    });
    f.addEventListener('blur', () => { if (feld?.feld === f) schliesseFeld(); });
    zeile.append(f);
    feld = { feld: f, beat, neu }; lage = null;
    bloecke.get(beat)?.setAttribute('hidden', '');
    f.focus();
    f.select?.();
  }

  function zugEnde(e, abbruch) {
    const z = zug;
    zug = null;
    if (!z?.aktiv) return;
    nachZug = true;
    setTimeout(() => { nachZug = false; }, 0);
    const ziel = abbruch ? z.beat0 : markerZielBeat(z.beat0, (e.clientX ?? z.x0) - z.x0, st.ansicht.pxProBeat, schritt());
    const i = index(z.beat0);
    if (ziel === z.beat0 || i < 0) { st.harmonieEntwurf = null; return; }
    const neu = harmonieBewege(liste(), i, ziel);
    if (!neu) { st.harmonieEntwurf = null; ctx.melde('A chord already sits on that beat', true); return; }
    st.harmonieEntwurf = { beat0: z.beat0, beat: ziel };   // stays shown until the answer is in: no flicker back
    Promise.resolve(schicke('Move chord', neu)).finally(() => { if (st.harmonieEntwurf?.beat0 === z.beat0) st.harmonieEntwurf = null; });
  }

  function baueBlock(beat) {
    const b = document.createElement('button');
    b.setAttribute('type', 'button'); b.className = 'p-harmonie-block'; b.setAttribute('data-p', 'harmonie-block');
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      nachZug = false;
      zug = { beat0: beat, x0: e.clientX, aktiv: false };
      try { b.setPointerCapture?.(e.pointerId); } catch { /* no capture: the move events stop at the edge */ }
    });
    b.addEventListener('pointermove', (e) => {
      if (!zug || zug.beat0 !== beat) return;
      const dx = e.clientX - zug.x0;
      if (!zug.aktiv && markerZugErkannt(dx)) zug.aktiv = true;
      if (zug.aktiv) st.harmonieEntwurf = { beat0: beat, beat: markerZielBeat(beat, dx, st.ansicht.pxProBeat, schritt()) };
    });
    b.addEventListener('pointerup', (e) => zugEnde(e, false));
    b.addEventListener('pointercancel', (e) => zugEnde(e, true));
    b.addEventListener('click', () => { if (nachZug) nachZug = false; });
    b.addEventListener('dblclick', () => oeffneFeld(beat, false));
    b.addEventListener('keydown', (e) => {
      const i = index(beat);
      if ((e.key === 'Delete' || e.key === 'Backspace') && i >= 0) { e.preventDefault(); e.stopPropagation(); schicke('Delete chord', harmonieLoesche(liste(), i)); }
      else if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); oeffneFeld(beat, false); }
      else if (e.key === ' ') e.preventDefault();
    });
    return b;
  }
  function baueNeu(l) {
    const beats = new Set(l.map((e) => e.beat));
    for (const [beat, b] of bloecke) if (!beats.has(beat)) { b.remove(); bloecke.delete(beat); }
    for (const e of l) {
      let b = bloecke.get(e.beat);
      if (!b) { b = baueBlock(e.beat); bloecke.set(e.beat, b); zeile.append(b); }
      b.textContent = harmonieAnzeige(e);   // text, never markup
      b.title = `${harmonieAnzeige(e)} (double click: edit, drag: move, Delete: remove)`;
      if (feld?.beat === e.beat && !feld.neu) b.setAttribute('hidden', '');
    }
  }
  function setzeLage(l) {
    const a = st.ansicht, breite = ctx.breite(), e = st.harmonieEntwurf;
    const schluessel = `${a.beat0}|${a.pxProBeat}|${breite}|${e ? `${e.beat0}:${e.beat}` : ''}`;
    if (schluessel === lage) return;
    lage = schluessel;
    for (const x of l) {
      const b = bloecke.get(x.beat), zieht = !!e && e.beat0 === x.beat, px = beatZuX(a, zieht ? e.beat : x.beat);
      b.style.left = `${px}px`;
      b.hidden = !harmonieSichtbar(px, breite) || (!!feld && !feld.neu && feld.beat === x.beat);
      b.classList.toggle('zieht', zieht);
    }
    if (feld) { const px = beatZuX(a, feld.beat); feld.feld.style.left = `${px}px`; feld.feld.hidden = !harmonieSichtbar(px, breite); }
  }
  function zeichne() {
    const l = liste();
    const json = JSON.stringify(l);
    if (json !== gezeichnet) {
      gezeichnet = json; lage = null;
      baueNeu(l);
      if (feld && !feld.neu && index(feld.beat) < 0) schliesseFeld();   // the entry is gone (deleted elsewhere, undone)
    }
    setzeLage(l);
  }

  zeile.hidden = true;
  zeile.setAttribute('role', 'group'); zeile.setAttribute('aria-label', 'Chord lane');
  zeile.addEventListener('dblclick', (e) => {
    if (e.target !== zeile || !st.projekt || st.projekt.live) return;   // only the empty row: a block has its own double click
    oeffneFeld(Math.max(0, rasten(xZuBeat(st.ansicht, e.offsetX), schritt())), true);
  });
  knopf.addEventListener('click', () => {
    const an = zeile.hidden;
    zeile.hidden = !an;
    knopf.setAttribute('aria-pressed', String(an));
    if (!an) schliesseFeld();
    lage = null;
  });
  ctx.beimProjekt.push((p) => {
    knopf.disabled = !p || !!p.live;
    knopf.title = p?.live ? HARMONIE_LIVE_TEXT : 'Show or hide the chord lane under the ruler';
  });
  ctx.beimBild.push(zeichne);
}
