// Session column and cell component (session view S1, lane P1; shared by SESSION and the DJ loop deck place).
// Pure view: no fetch of its own; thumbnails come from waves.js (`opt.daumen` replaces it in tests) into the `.mw` and `.jetzt` slots. Cell numbers in the callbacks are 1..8.
// `zeichne` updates the existing nodes in place and only writes what changed (text, classes, colour), so a redraw per event or frame
// never grows the DOM.
import { farbeVon, leerLauf, zellBeats, spielPos } from '../loopdeck/model.js';
import { bindeAblage } from '../loopdeck/drag.js';
import { daumen as daumenStandard } from './waves.js';

const ZELLEN = 8;
const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const istHalten = (z) => !!z && typeof z === 'object' && z.halten === true;
const istZelle = (z) => !!z && typeof z === 'object' && !istHalten(z);

// 'leer' | 'halten' | 'voll' | 'spielt' | 'wartet' | 'stopp_wartet'. A pending start of the cell wins over playing (it replays);
// a pending stop marks the playing cell. A missing or foreign `lauf` reads as idle.
export function zellZustand(spalte, i, beat) {   // eslint-disable-line no-unused-vars
  const z = spalte?.zellen?.[i] ?? null;
  if (istHalten(z)) return 'halten';
  if (!istZelle(z)) return 'leer';
  const nr = i + 1, l = spalte.lauf ?? leerLauf();
  if (l.wartend && l.wartend.zelle === nr) return 'wartet';
  if (l.zelle === nr && !l.verwaist) return l.wartend && l.wartend.zelle === null ? 'stopp_wartet' : 'spielt';
  return 'voll';
}

// Play position 0..1 as `spielPos` of the loop deck model (loops wrap, a one-shot clamps at 1, the length comes from `beats` or
// from `frames` at the cell or passed tempo); 0 when there is nothing to show.
export function spielAnteil(lauf, zelle, beat, bpm) {
  return istZelle(zelle) ? spielPos(lauf, zelle, beat, bpm) ?? 0 : 0;
}

const setzeText = (e, t) => { if (e.textContent !== t) e.textContent = t; };
/** Loop name in a narrow cell: the head gives way with an ellipsis, the last 5 characters always stay ("star…oop3"); the full name is the tooltip. */
const setzeName = (e, t) => {
  if (e.title !== t) e.title = t;
  if (e.dataset.name === t) return;
  e.dataset.name = t;
  const ende = t.length > 8 ? 5 : 0;
  const kopf = document.createElement('span'), schwanz = document.createElement('span');
  kopf.className = 'nm-kopf'; schwanz.className = 'nm-ende';
  kopf.textContent = t.slice(0, t.length - ende); schwanz.textContent = t.slice(t.length - ende);
  e.replaceChildren(kopf, schwanz);
};
const setzeKlasse = (e, k, an) => { if (e.classList.contains(k) !== an) e.classList.toggle(k, an); };
const barsText = (beats) => { const b = beats / 4; return Number.isInteger(b) ? String(b) : b.toFixed(1); };
const ZUSTAENDE = ['leer', 'halten', 'voll', 'spielt', 'wartet', 'stopp_wartet'];

export function baueSpalte(wurzel, opt = {}) {
  const { beiStart, beiStopp, beiWahl, beiAblegen, beiWelleKlick, beiMenue, beiZiehen } = opt, daumen = opt.daumen ?? daumenStandard;
  const variante = opt.variante === 'kompakt' ? 'kompakt' : 'voll';
  const spalteKnoten = el('div', 'spalte'); spalteKnoten.dataset.variante = variante;
  const kopf = el('div', 'kopf-spalte');
  const art = el('span', 'ki', '♪'), tname = el('span', 'tname', ''), kurz = el('span', 'kurz', '');
  kopf.append(art, tname, kurz);
  const streifenH = variante === 'kompakt' ? 14 : 50, zellH = variante === 'kompakt' ? 15 : 22;
  const jetzt = el('div', 'jetzt'), leinwandSlot = el('div', 'jetzt-wv'), ph = el('div', 'kopf-ph');
  ph.hidden = true;
  jetzt.append(leinwandSlot);
  for (let i = 1; i < 8; i++) { const m = el('span', 'marke'); m.style.left = `${i * 12.5}%`; jetzt.append(m); }   // slice boundaries of an eight-slice loop
  jetzt.append(ph);
  jetzt.addEventListener('click', (e) => {
    const r = jetzt.getBoundingClientRect(), w = r.width;
    if (!beiWelleKlick || !(w > 0)) return;
    beiWelleKlick(Math.min(1, Math.max(0, ((e.clientX ?? 0) - r.left) / w)));
  });
  const zellenKnoten = el('div', 'zellen'), zellen = [];
  for (let i = 0; i < ZELLEN; i++) {
    const k = el('div', 'zelle leer'); k.dataset.zelle = String(i + 1);
    const go = el('button', 'go', ''), mw = el('div', 'mw'), art = el('span', 'art', ''), nm = el('span', 'nm', ''), kd = el('span', 'kd', ''), prog = el('div', 'prog');
    const griff = el('span', 'griff', '⋮'); griff.title = 'Cell menu'; griff.hidden = true;
    go.type = 'button'; go.setAttribute('type', 'button');
    k.append(go, mw, art, nm, kd, griff, prog);
    // One handler per cell for click and for Enter or Space. `kompakt` (loop deck place): the play area (and a filled cell's background) starts,
    // the name selects, an empty cell selects wherever it is hit. `voll` (SESSION, the tabs below follow the selection): a click on the body
    // selects, the play button starts, a double click on the body starts, Enter or Space starts a filled cell. The handle is the cell menu's.
    // A launch on the playing cell stops its track instead (toggle, Andreas 2026-11-22: a second tap stops the clip); a pending stop or a
    // pending start launches again.
    const starte = () => { if (zellen[i].zustand === 'spielt') beiStopp?.(); else beiStart?.(i + 1); };
    const aktiviere = (ziel, taste) => {
      const in_ = (sel) => !!ziel?.closest?.(sel), zu = zellen[i].zustand;
      if (in_('.griff') || zu === 'halten') return;
      if (variante === 'voll') {
        if (zu === 'leer' || (!in_('.go') && !taste)) { beiWahl?.(i + 1); return; }
        starte(); return;
      }
      if (in_('.nm') || zu === 'leer') { beiWahl?.(i + 1); return; }
      starte();
    };
    k.addEventListener('click', (e) => aktiviere(e.target));
    k.addEventListener('dblclick', (e) => {
      if (variante !== 'voll' || e.target?.closest?.('.griff') || e.target?.closest?.('.go') || !istZelle(aktuell?.zellen?.[i])) return;
      starte();
    });
    k.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); aktiviere(k, true); } });
    k.tabIndex = 0; k.setAttribute('tabindex', '0');
    k.addEventListener('contextmenu', (e) => { e.preventDefault?.(); if (beiMenue && istZelle(aktuell?.zellen?.[i])) beiMenue(i + 1, k); });   // caught on empty cells too, as on main
    griff.addEventListener('click', (e) => { e.stopPropagation?.(); beiMenue?.(i + 1, k); });
    k.addEventListener('dragstart', (e) => {   // a filled cell can be dragged, an empty one cannot; what the drag carries is the host's
      if (!istZelle(aktuell?.zellen?.[i])) { e.preventDefault?.(); return; }
      beiZiehen?.(i + 1, e);
    });
    bindeAblage(k, (inhalt) => { if (beiAblegen) beiAblegen(i + 1, inhalt); });
    zellenKnoten.append(k);
    zellen.push({ k, go, mw, art, nm, kd, griff, prog, zustand: 'leer', farbe: null, sha: null });
  }
  const stopp = el('button', 'stopp', 'STOP'); stopp.type = 'button'; stopp.setAttribute('type', 'button'); stopp.title = 'Stop this track on the next grid point';
  stopp.addEventListener('click', () => { if (beiStopp) beiStopp(); });
  const zugSlot = el('div', 'zug-slot');
  spalteKnoten.append(kopf, jetzt, zellenKnoten, stopp, zugSlot);
  wurzel.append(spalteKnoten);

  let aktuell = null, bpmZuletzt;   // the column drawn last and its tempo, for position()
  let streifenSha = null;           // sha shown in the strip
  let spielKey = null;              // which cell plays: a change hides the playhead until the next position()

  // Puts the thumbnail of `sha` into `slot`; `gilt()` says whether the answer is still wanted when it arrives.
  // A thumbnail that could not be had (`null`) is forgotten by `vergiss`, so the next zeichne asks again.
  function fuelle(slot, sha, b, h, gilt, vergiss, vorrang = false) {
    slot.replaceChildren();
    if (!sha) return;
    daumen(sha, b, h, vorrang).then((k) => { if (!gilt()) return; if (k) slot.replaceChildren(k); else vergiss(); }, () => { if (gilt()) vergiss(); });
  }

  function zeichne(spalte, wahl, bpm) {
    if (Number.isFinite(bpm)) bpmZuletzt = bpm;
    aktuell = spalte && typeof spalte === 'object' ? spalte : null;
    const s = aktuell ?? { zellen: [], lauf: null };
    setzeText(tname, s.name ?? ''); setzeText(kurz, s.kurz ?? '');
    let stoppWartet = false;
    for (let i = 0; i < ZELLEN; i++) {
      const c = zellen[i], z = s.zellen?.[i] ?? null, zu = zellZustand(s, i, null);
      c.zustand = zu;
      for (const n of ZUSTAENDE) setzeKlasse(c.k, n, n === zu || (n === 'voll' && (zu === 'spielt' || zu === 'wartet' || zu === 'stopp_wartet')));
      setzeKlasse(c.k, 'gewaehlt', wahl === i + 1);
      const gefuellt = istZelle(z);
      setzeName(c.nm, gefuellt ? (z.name ?? '') : '');
      setzeText(c.art, gefuellt ? (z.art === 'einmal' ? '▪' : '↻') : '');
      c.griff.hidden = !gefuellt;
      setzeKlasse(c.k, 'laedt', gefuellt && z.frames === null);   // the stand says `frames: null` until the audio is decoded
      c.k.draggable = gefuellt; c.k.setAttribute('draggable', String(gefuellt));
      const titel = !gefuellt ? (zu === 'halten' ? 'Hold: this column keeps playing when the scene starts' : 'Empty: click to select it as load target (or drop a loop here)')
        : `${z.name}: click launches on the next grid point${z.frames === null ? ' (still loading: a launch is refused until it is decoded)' : ''}; drag to move it`;
      if (c.k.title !== titel) c.k.title = titel;
      const n = gefuellt ? zellBeats(z, bpmZuletzt) : null;
      setzeText(c.kd, n ? barsText(n) : '');
      const sha = gefuellt ? z.sha256 ?? null : null;
      if (c.sha !== sha) { c.sha = sha; fuelle(c.mw, sha, 120, zellH, () => c.sha === sha, () => { c.sha = null; }); }
      const farbe = gefuellt ? farbeVon(z.farbe) : '';
      if (c.farbe !== farbe) { c.farbe = farbe; c.k.style.setProperty('--cf', farbe); }
      c.go.disabled = !gefuellt;
      setzeText(c.go, gefuellt ? '▶' : '');   // playing shows by colour and class; a click restarts
      // the bar of a cell that still plays stays while a new launch of it is pending (no flicker between ticks)
      const laeuft = s.lauf?.zelle === i + 1 && !s.lauf?.verwaist && gefuellt;
      if (!laeuft && c.prog.style.width !== '0') c.prog.style.width = '0';
      if (zu === 'stopp_wartet') stoppWartet = true;
    }
    setzeKlasse(stopp, 'wartet', stoppWartet);
    const gn = s.lauf?.zelle, gz = gn && !s.lauf.verwaist ? s.zellen?.[gn - 1] : null;
    const shaJetzt = istZelle(gz) ? gz.sha256 ?? null : null;
    if (shaJetzt !== streifenSha) { streifenSha = shaJetzt; fuelle(leinwandSlot, shaJetzt, 240, streifenH, () => streifenSha === shaJetzt, () => { streifenSha = null; }, true); }
    const key = istZelle(gz) ? `${gn}:${gz.id ?? gz.sha256 ?? ''}` : null;
    setzeKlasse(jetzt, 'einmal', istZelle(gz) && gz.art === 'einmal');   // a one-shot has no slices
    if (key !== spielKey) { spielKey = key; ph.hidden = true; }   // another cell or silence: no playhead at the old place
  }

  // The playhead and progress bar of the playing cell at `beat` (the host calls it per frame; P2 drives it from one loop).
  function position(beat, bpm) {
    const s = aktuell, l = s?.lauf, n = l?.zelle;
    const z = n ? s.zellen?.[n - 1] : null;
    const a = istZelle(z) && !l.verwaist ? spielPos(l, z, beat, Number.isFinite(bpm) ? bpm : bpmZuletzt) : null;
    ph.hidden = a === null;
    if (a === null) return;
    ph.style.left = `${a * 100}%`;
    zellen[n - 1].prog.style.width = `${a * 100}%`;
  }

  function entferne() { spalteKnoten.remove(); aktuell = null; spielKey = null; }

  return { zeichne, position, entferne };
}
