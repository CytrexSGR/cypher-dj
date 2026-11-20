// TRACKER view, the grid (plan 2026-11-18-tracker.md, task 2): the grid itself as DOM rows, the INSTRUMENTS column and the status line.
// The model is grid_model.js (pure projection); this file draws it, moves the cursor and turns the M / S buttons and the column buttons into
// actions. The only write of this task is spur_aendern {mute|solo} through ctx.aendere. The cursor keys are pure functions (bewegeCursor) so a later task can
// extend them; later tasks hang their own keys on ctx.beimTaste (a hook returns true when it used the key).
//
// Markup of the grid host [data-t="raster"] (ctx.zeichne compares ROW BY ROW: the HTML text of every row is kept, only a row whose text changed is made new
// and put in the place of the old element; a change of STRUCTURE (section, row count, columns, number base, track count, LPB) rebuilds everything with one
// innerHTML, scroll position kept. The head is replaced the same way. The cursor, the selection and the play line are classes toggled on the elements,
// never part of the compared text, so they never cause a redraw):
//   .t-kopfzeile        sticky: the track heads (.t-kopf-spur: letter, name, device, M / S, meter, column buttons)
//   .t-zeile[data-z]    one per row, class beat / takt for the emphasised rows, spielt for the play line
//     .t-nr             row number (hex or decimal)
//     .t-spur           one track; .t-nsp one note column; .t-c a cell with data-k="<spur>:<spalte>:<zeile>:<unterspalte>:<fxspalte>"
// A cell class: u-<sub-column>, leer (nothing in it), schief (off the row line, also an effect entry after an LPB change), kurve (a drawn curve),
// ohne (an effect command the device ignores, dimmed), cursor.
import { istTextFeld } from '../production/history_display.js';
import { projiziere, abschnitte, zellText, fxText, statusText } from './grid_model.js';

export const RASTER_TEXT = {
  leer: 'No project is open.',
  mute: 'Mute', unmute: 'Unmute', solo: 'Solo', unsolo: 'Unsolo',
  verdecktTitel: 'More than 8 notes sound at once here; open PRODUCTION to see them',
  notePlus: 'Add a note column', noteMinus: 'Remove a note column', fxPlus: 'Add an effect column', fxMinus: 'Remove an effect column',
};

export const MAX_NOTENSPALTEN = 8;
export const MAX_FXSPALTEN = 8;
const UNTERSPALTEN = ['vol', 'dly', 'chn', 'rpt'];
// the sub-columns of one note column: INS (slot, Task 19) stands right after NOTE on a track whose device has the slot role, always visible there
const unterspaltenVon = (s, spaltenAn) => [...(s.ins ? ['ins'] : []), ...UNTERSPALTEN.filter((u) => spaltenAn?.[u])];
const MIN_SPURBREITE = 17;   // ch: the head (name, buttons) needs room even when the cells are narrow
const AUDIO_BREITE = 9;
const ZEILENHOEHE = 18;      // px, fallback when the browser gives no row height

// --- pure -------------------------------------------------------------------------------------------------------------------------------------
export function zeilenNummer(z, zeilen, zahlen) {
  const letzte = Math.max(0, zeilen - 1);
  if (zahlen === 'dec') return String(z).padStart(Math.max(2, String(letzte).length), '0');
  return z.toString(16).toUpperCase().padStart(Math.max(2, letzte.toString(16).length), '0');
}

// every beat (every lpb rows) and, stronger, every bar (taktBeats beats)
export function zeilenKlasse(z, lpb, taktBeats) {
  if (z % (lpb * taktBeats) === 0) return 'takt';
  return z % lpb === 0 ? 'beat' : '';
}

// width of a sub-column in characters (without the gap)
export const zellBreite = (u, zahlen) => ({ note: 3, vol: zahlen === 'dec' ? 3 : 2, dly: 4, chn: 2, rpt: 1, ins: 2, fx: zahlen === 'dec' ? 7 : 6 })[u] ?? 3;

// the columns a track shows: what the project needs, at least what the person asked for (D5), never more than the limit
export function spaltenAnzahl(s, gespeichert) {
  const bedarfN = Math.max(1, s.notenspalten?.length ?? 1), bedarfF = Math.max(1, s.fxspalten?.length ?? 1);
  const n = Number.isInteger(gespeichert?.n) ? gespeichert.n : 1, f = Number.isInteger(gespeichert?.f) ? gespeichert.f : 1;
  return { n: Math.min(MAX_NOTENSPALTEN, Math.max(bedarfN, n, 1)), f: Math.min(MAX_FXSPALTEN, Math.max(bedarfF, f, 1)) };
}

const schluessel = (c) => `${c.spur}:${c.spalte}:${c.zeile}:${c.unterspalte}:${c.fxspalte ?? ''}`;
export const zellSchluessel = (spur, spalte, zeile, unterspalte, fxspalte) => schluessel({ spur, spalte, zeile, unterspalte, fxspalte });
export function schluesselZuCursor(text) {
  const [s, sp, z, u, f] = String(text).split(':');
  return u === 'fx' ? { spur: Number(s), spalte: 0, zeile: Number(z), unterspalte: 'fx', fxspalte: Number(f) }
    : { spur: Number(s), spalte: Number(sp), zeile: Number(z), unterspalte: u };
}

// the places the cursor can stand on in one track, left to right; opt: { spaltenAn, audioAn, anzahl(spur) -> {n, f} }
export function spurPositionen(s, si, opt) {
  if (s.art === 'audio') return opt.audioAn ? [{ spur: si, spalte: 0, unterspalte: 'note' }] : [];
  const a = opt.anzahl(s);
  const aus = [];
  for (let sp = 0; sp < a.n; sp++) {
    aus.push({ spur: si, spalte: sp, unterspalte: 'note' });
    for (const u of unterspaltenVon(s, opt.spaltenAn)) aus.push({ spur: si, spalte: sp, unterspalte: u });
  }
  if (opt.spaltenAn?.fx) for (let f = 0; f < a.f; f++) aus.push({ spur: si, spalte: 0, unterspalte: 'fx', fxspalte: f });
  return aus;
}

const gleicherOrt = (a, b) => a.spur === b.spur && a.spalte === b.spalte && a.unterspalte === b.unterspalte && a.fxspalte === b.fxspalte;
const mitZeile = (pos, zeile) => ({ ...pos, zeile });

// a cursor that lies on the grid: the track, the row and the sub-column exist (a vanished sub-column falls back to the note of its column)
export function klemmeCursor(raster, c, opt) {
  const alle = raster.spuren.map((s, i) => spurPositionen(s, i, opt));
  const sichtbar = alle.map((l, i) => (l.length > 0 ? i : -1)).filter((i) => i >= 0);
  if (sichtbar.length === 0) return { spur: 0, spalte: 0, zeile: 0, unterspalte: 'note' };
  const zeile = Math.min(Math.max(0, raster.zeilen - 1), Math.max(0, Math.trunc(c.zeile) || 0));
  let spur = sichtbar.includes(c.spur) ? c.spur : (sichtbar.filter((i) => i <= c.spur).at(-1) ?? sichtbar[0]);
  const liste = alle[spur];
  const genau = sichtbar.includes(c.spur) ? liste.find((p) => gleicherOrt(p, c)) : undefined;
  const sonst = genau ?? liste.find((p) => p.unterspalte === 'note' && p.spalte === Math.min(c.spalte ?? 0, liste.filter((x) => x.unterspalte === 'note').length - 1)) ?? liste[0];
  return mitZeile(sonst, zeile);
}

const TASTEN = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'PageUp', 'PageDown', 'Home', 'End']);
export const istNavigationsTaste = (key) => TASTEN.has(key);

// opt: { spaltenAn, audioAn, anzahl, taktBeats, shift }; returns the new cursor (the same values when it cannot move), never leaves the section
export function bewegeCursor(raster, cursor, taste, opt) {
  const c = klemmeCursor(raster, cursor, opt);
  const letzte = raster.zeilen - 1, takt = Math.max(1, raster.lpb * (opt.taktBeats ?? 4));
  switch (taste) {
    case 'ArrowUp': return { ...c, zeile: Math.max(0, c.zeile - 1) };
    case 'ArrowDown': return { ...c, zeile: Math.min(letzte, c.zeile + 1) };
    case 'PageUp': return { ...c, zeile: Math.max(0, c.zeile - takt) };
    case 'PageDown': return { ...c, zeile: Math.min(letzte, c.zeile + takt) };
    case 'Home': return { ...c, zeile: 0 };
    case 'End': return { ...c, zeile: Math.max(0, letzte) };
    case 'ArrowLeft': case 'ArrowRight': {
      const flach = raster.spuren.flatMap((s, i) => spurPositionen(s, i, opt));
      const i = flach.findIndex((p) => gleicherOrt(p, c));
      const j = Math.min(flach.length - 1, Math.max(0, i + (taste === 'ArrowRight' ? 1 : -1)));
      return mitZeile(flach[j], c.zeile);
    }
    case 'Tab': {
      const sichtbar = raster.spuren.map((s, i) => (spurPositionen(s, i, opt).length > 0 ? i : -1)).filter((i) => i >= 0);
      const ziel = opt.shift ? sichtbar.filter((i) => i < c.spur).at(-1) : sichtbar.find((i) => i > c.spur);
      if (ziel === undefined) return c;
      const liste = spurPositionen(raster.spuren[ziel], ziel, opt);
      const pos = liste.find((p) => p.unterspalte === c.unterspalte && p.spalte === c.spalte && p.fxspalte === c.fxspalte)
        ?? liste.find((p) => p.unterspalte === c.unterspalte) ?? liste[0];
      return mitZeile(pos, c.zeile);
    }
    default: return c;
  }
}

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// --- the view ---------------------------------------------------------------------------------------------------------------------------------
export function bindeRaster(ctx) {
  const { st, $ } = ctx;
  const grid = $('raster'), instr = $('instr'), status = $('status'), kopfzeile = () => grid.querySelector('.t-kopfzeile');
  let raster = null;       // the projection that is drawn
  let zeilenEls = [];      // the row elements of the drawn section
  let zeilenText = [];     // the HTML text each row element was made from (without cursor, selection and play line)
  let strukturSig = null;  // what the whole grid depends on; a change rebuilds everything
  let kopfText = '';
  ctx.zeichneStand = { voll: 0, zeilen: 0, ms: null };   // for the tests and the measuring: full rebuilds, rows replaced, the milliseconds of the last draw by part
  let spielZeile = -1;
  let anzahlen = new Map();

  const anzahlSchluessel = (id) => `djk-tr-spalten-${st.slug}-${id}`;
  function gespeichert(id) {
    try { return JSON.parse(ctx.lies(anzahlSchluessel(id), 'null')); } catch { return null; }
  }
  const anzahl = (s) => anzahlen.get(s.spur_id) ?? spaltenAnzahl(s, gespeichert(s.spur_id));
  const optionen = () => ({ spaltenAn: st.spaltenAn, audioAn: st.audioAn, anzahl, taktBeats: st.projekt?.taktart?.[0] ?? 4, shift: false });
  ctx.raster = () => raster;
  ctx.beimSpurwechsel = [];   // hooks: the cursor moved to another track (no redraw of the grid)
  ctx.optionen = optionen;

  function zeigeStatus() {
    const sp = raster?.spuren?.[st.cursor.spur];
    status.textContent = raster ? statusText(raster, st.cursor, st.zahlen, { platzZahl: sp ? ctx.platzZahl?.(sp.spur_id) : undefined }) : '';
  }
  ctx.zeigeStatus = zeigeStatus;

  // --- drawing ---
  function zellHtml(s, si, sp, z, u, fx) {
    const zelle = u === 'fx' ? s.fxspalten[fx]?.[z] ?? null : s.notenspalten[sp]?.[z] ?? null;
    const text = u === 'fx' ? fxText(zelle, st.zahlen) : zellText(zelle, u, st.zahlen);
    const klassen = ['t-c', `u-${u}`];
    if (u === 'fx' ? zelle === null : (u === 'note' ? !zelle?.note && !zelle?.aus : !zelle?.note)) klassen.push('leer');
    if (u === 'fx' && zelle?.kurve) klassen.push('kurve');
    if (zelle?.schief) klassen.push('schief');
    if (u === 'fx' && zelle?.ohne) klassen.push('ohne');           // a command the device of the track ignores
    const key = zellSchluessel(si, u === 'fx' ? 0 : sp, z, u, u === 'fx' ? fx : undefined);
    return `<span class="${klassen.join(' ')}" data-k="${key}" style="width:${zellBreite(u, st.zahlen)}ch">${esc(text)}</span>`;
  }

  function spurBreite(s) {
    if (s.art === 'audio') return AUDIO_BREITE;
    const a = anzahl(s);
    let b = 0;
    for (let sp = 0; sp < a.n; sp++) {
      b += zellBreite('note', st.zahlen) + 1;
      for (const u of unterspaltenVon(s, st.spaltenAn)) b += zellBreite(u, st.zahlen) + 1;
      b += 1;   // a gap after the note column
    }
    if (st.spaltenAn.fx) b += a.f * (zellBreite('fx', st.zahlen) + 1);
    return Math.max(MIN_SPURBREITE, b);
  }

  function kopfHtml(s, si) {
    const p = st.projekt;
    const spur = p.spuren.find((x) => x.id === s.spur_id) ?? {};
    const b = spurBreite(s);
    const id = esc(s.spur_id);
    const sw = (a, text, titel, an) => `<button type="button" data-a="${a}" data-spur="${id}" aria-pressed="${an}" title="${titel}">${text}</button>`;
    const klein = (a, text, titel) => `<button type="button" data-a="${a}" data-spur="${id}" title="${titel}">${text}</button>`;
    let html = `<span class="t-kopf-spur${s.art === 'audio' ? ' t-audio' : ''}" style="width:${b}ch"><span class="t-kopf-zeile1"><span class="t-buchstabe">${s.buchstabe}</span><span class="t-name">${esc(s.name)}</span></span>`;
    html += `<span class="t-geraet">${esc(s.art === 'audio' ? 'audio' : s.geraet_text)}</span>`;
    if (s.verdeckt > 0) html += `<span class="t-verdeckt" title="${esc(RASTER_TEXT.verdecktTitel)}">+${s.verdeckt} hidden</span>`;
    html += `<span class="t-knoepfe">${sw('mute', 'M', RASTER_TEXT.mute, spur.mute === true)}${sw('solo', 'S', RASTER_TEXT.solo, spur.solo === true)}</span>`;
    html += `<div class="meter waagrecht" data-kanal="spur/${Number(spur.nr) || 0}"><i></i></div>`;
    if (s.art !== 'audio') {
      html += `<span class="t-spaltenknoepfe"><span>N ${klein('note-minus', '-', RASTER_TEXT.noteMinus)}${klein('note-plus', '+', RASTER_TEXT.notePlus)}</span>`
        + `<span>FX ${klein('fx-minus', '-', RASTER_TEXT.fxMinus)}${klein('fx-plus', '+', RASTER_TEXT.fxPlus)}</span></span>`;
    }
    return `${html}</span>`;
  }

  function zeileHtml(z) {
    const klasse = zeilenKlasse(z, raster.lpb, optionen().taktBeats);
    let html = `<div class="t-zeile${klasse ? ` ${klasse}` : ''}" data-z="${z}"><span class="t-nr">${zeilenNummer(z, raster.zeilen, st.zahlen)}</span>`;
    raster.spuren.forEach((s, si) => {
      if (s.art === 'audio') {
        if (!st.audioAn) return;
        const c = s.clips.find((x) => x.zeile === z);
        const key = zellSchluessel(si, 0, z, 'note');
        html += `<span class="t-spur t-audio" style="width:${AUDIO_BREITE}ch"><span class="t-c u-audio${c ? '' : ' leer'}" data-k="${key}">${esc(c?.name ?? '')}</span></span>`;
        return;
      }
      const a = anzahl(s);
      html += `<span class="t-spur" style="width:${spurBreite(s)}ch">`;
      for (let sp = 0; sp < a.n; sp++) {
        html += '<span class="t-nsp">' + zellHtml(s, si, sp, z, 'note');
        for (const u of unterspaltenVon(s, st.spaltenAn)) html += zellHtml(s, si, sp, z, u);
        html += '</span>';
      }
      if (st.spaltenAn.fx) for (let f = 0; f < a.f; f++) html += zellHtml(s, si, 0, z, 'fx', f);
      html += '</span>';
    });
    return `${html}</div>`;
  }

  function zeichneInstrumente() {
    instr.innerHTML = '<div class="t-titel">INSTRUMENTS</div>' + raster.spuren.filter((s) => s.art === 'instrument').map((s) =>
      `<div class="t-instr-zeile"><span class="t-buchstabe">${s.buchstabe}</span><span class="t-name">${esc(s.name)}</span><span class="t-geraet">${esc(s.geraet_text)}</span></div>`).join('');
  }

  // the structure of the drawn grid: when this text changes the rows are not comparable any more
  function strukturVon() {
    return JSON.stringify([st.abschnitt_id, raster.zeilen, raster.lpb, optionen().taktBeats, st.zahlen, st.spaltenAn, st.audioAn,
      raster.spuren.map((s) => [s.spur_id, s.art, s.ins === true, anzahl(s)])]);
  }
  const kopfHtmlGanz = () => `<div class="t-kopfzeile"><span class="t-nr-kopf"></span>${raster.spuren.map((s, si) => (s.art === 'audio' && !st.audioAn ? '' : kopfHtml(s, si))).join('')}</div>`;
  const huelle = document.createElement('div');
  // elements made from HTML text (one parse for all of them)
  const elemente = (html, klasse) => { huelle.innerHTML = html; return Array.from(huelle.querySelectorAll(klasse)); };
  const zelleEl = (c) => zeilenEls[c.zeile]?.querySelector(`[data-k="${schluessel(c)}"]`) ?? null;
  ctx.zelleEl = zelleEl;
  let cursorEl = null;     // the cell that carries the class `cursor`
  const markiereCursor = () => { cursorEl?.classList.remove('cursor'); cursorEl = zelleEl(st.cursor); cursorEl?.classList.add('cursor'); };
  ctx.zeilenEl = (z) => zeilenEls[z] ?? null;

  function zeichne() {
    const p = st.projekt;
    if (!p || st.abschnitt_id === null) { raster = null; zeilenEls = []; zeilenText = []; strukturSig = null; kopfText = ''; spielZeile = -1; cursorEl = null; grid.innerHTML = ''; instr.innerHTML = ''; status.textContent = ''; return; }
    const t0 = performance.now();
    raster = projiziere(p, { abschnitt_id: st.abschnitt_id, rollen: ctx.rollenVon });   // ctx.rollenVon(geraet): the roles of a device (set by tracker.js from GET /graphen)
    anzahlen = new Map(raster.spuren.map((s) => [s.spur_id, spaltenAnzahl(s, gespeichert(s.spur_id))]));
    st.cursor = klemmeCursor(raster, st.cursor, optionen());
    const t1 = performance.now();
    const sig = strukturVon();
    const neuText = [];
    for (let z = 0; z < raster.zeilen; z++) neuText.push(zeileHtml(z));
    const kopfNeu = kopfHtmlGanz();
    const t2 = performance.now();
    if (sig !== strukturSig || zeilenEls.length !== raster.zeilen || !kopfzeile()) {
      const links = grid.scrollLeft, oben = grid.scrollTop;
      grid.innerHTML = kopfNeu + neuText.join('');
      zeilenEls = Array.from(grid.querySelectorAll('.t-zeile'));
      zeilenText = neuText; strukturSig = sig; kopfText = kopfNeu;
      spielZeile = -1; cursorEl = null;
      ctx.zeichneStand.voll++;
      markiereCursor();
      if (Number.isFinite(links)) grid.scrollLeft = links;
      if (Number.isFinite(oben)) grid.scrollTop = oben;
    } else {
      if (kopfNeu !== kopfText) { const [k] = elemente(kopfNeu, '.t-kopfzeile'); const alt = kopfzeile(); grid.insertBefore(k, alt); alt.remove(); kopfText = kopfNeu; }
      const geaendert = [];
      for (let z = 0; z < neuText.length; z++) if (neuText[z] !== zeilenText[z]) geaendert.push(z);
      if (geaendert.length > 0) {
        const neu = elemente(geaendert.map((z) => neuText[z]).join(''), '.t-zeile');
        geaendert.forEach((z, i) => {
          const alt = zeilenEls[z];
          grid.insertBefore(neu[i], alt); alt.remove();
          zeilenEls[z] = neu[i]; zeilenText[z] = neuText[z];
          if (z === spielZeile) neu[i].classList.add('spielt');
        });
        ctx.zeichneStand.zeilen += geaendert.length;
        markiereCursor();
      }
    }
    const t3 = performance.now();
    zeichneInstrumente(); zeigeStatus();
    ctx.zeichneStand.ms = { projektion: t1 - t0, text: t2 - t1, dom: t3 - t2, summe: performance.now() - t0 };
    try { for (const [n, a, b] of [['projektion', t0, t1], ['text', t1, t2], ['dom', t2, t3]]) performance.measure(`tracker-zeichne-${n}`, { start: a, end: b }); } catch { /* no timeline */ }
  }
  ctx.beimZeichnen.push(zeichne);

  // --- cursor ---
  function halteSichtbar(zeile) {
    const el = zeilenEls[zeile]; if (!el) return;
    const h = el.offsetHeight || ZEILENHOEHE, kopfH = kopfzeile()?.offsetHeight || 0;
    const oben = Number.isFinite(el.offsetTop) ? el.offsetTop : kopfH + zeile * h;
    const sicht = grid.clientHeight || 0;
    if (oben - kopfH < grid.scrollTop) grid.scrollTop = Math.max(0, oben - kopfH);
    else if (sicht > 0 && oben + h > grid.scrollTop + sicht) grid.scrollTop = oben + h - sicht;
  }
  // c: a cursor (clamped to the grid); the cell class and the status line follow, no redraw
  ctx.setzeCursor = (c, { sichtbar = true } = {}) => {
    if (!raster) return;
    const alt = schluessel(st.cursor), altSpur = st.cursor.spur;
    st.cursor = klemmeCursor(raster, c, optionen());
    const neu = schluessel(st.cursor);
    if (alt !== neu) markiereCursor();
    if (altSpur !== st.cursor.spur) for (const h of ctx.beimSpurwechsel) h();   // the INSTRUMENTS editor follows the cursor's track
    zeigeStatus();
    if (sichtbar && !(st.follow && spielZeile >= 0)) halteSichtbar(st.cursor.zeile);
  };

  // a key the grid uses is consumed here: the page's own handlers (library drawer, LIBRARY selection, other views) never see it
  const verbraucht = (e) => { e.preventDefault?.(); e.stopPropagation?.(); };
  grid.addEventListener('keydown', (e) => {
    if (!st.sichtbar || istTextFeld(e.target)) return;   // a hidden view or a field with the focus: the keys are not ours
    for (const h of ctx.beimTaste) if (h(e)) { verbraucht(e); return; }
    if (!raster || e.ctrlKey || e.metaKey || e.altKey || !istNavigationsTaste(e.key)) return;
    if (e.shiftKey && e.key !== 'Tab') return;   // shift + arrows are the selection of a later task
    const neu = bewegeCursor(raster, st.cursor, e.key, { ...optionen(), shift: e.shiftKey });
    if (e.key === 'Tab' && schluessel(neu) === schluessel(klemmeCursor(raster, st.cursor, optionen()))) return;   // no track further: the focus leaves the grid
    verbraucht(e);
    ctx.setzeCursor(neu);
  });

  function aktion(knopf) {
    const p = st.projekt, id = knopf.getAttribute('data-spur'), a = knopf.getAttribute('data-a');
    const spur = p?.spuren.find((x) => x.id === id);
    const s = raster?.spuren.find((x) => x.spur_id === id);
    if (!spur || !s) return;
    if (a === 'mute' || a === 'solo') {
      const feld = a === 'mute' ? 'mute' : 'solo', jetzt = spur[feld] !== true;
      ctx.aendere(`${jetzt ? (a === 'mute' ? RASTER_TEXT.mute : RASTER_TEXT.solo) : (a === 'mute' ? RASTER_TEXT.unmute : RASTER_TEXT.unsolo)} ${spur.name}`,
        [{ befehl: 'spur_aendern', spur_id: id, [feld]: jetzt }]);
      return;
    }
    // column counts are a view setting (D5): localStorage per project and track, never in the project
    const bedarf = spaltenAnzahl(s, null), jetzt = anzahl(s);
    const neu = { ...jetzt };
    if (a === 'note-plus') neu.n = Math.min(MAX_NOTENSPALTEN, jetzt.n + 1);
    else if (a === 'note-minus') neu.n = Math.max(bedarf.n, jetzt.n - 1);
    else if (a === 'fx-plus') neu.f = Math.min(MAX_FXSPALTEN, jetzt.f + 1);
    else if (a === 'fx-minus') neu.f = Math.max(bedarf.f, jetzt.f - 1);
    else return;
    if (neu.n === jetzt.n && neu.f === jetzt.f) return;
    ctx.merke(anzahlSchluessel(id), JSON.stringify(neu));
    ctx.zeichne();
  }

  grid.addEventListener('click', (e) => {
    const knopf = e.target.closest?.('[data-a]');
    if (knopf) { aktion(knopf); return; }
    const c = e.target.closest?.('[data-k]');
    if (c) { ctx.setzeCursor(schluesselZuCursor(c.getAttribute('data-k'))); grid.focus?.({ preventScroll: true }); }
  });

  // --- play line and FOLLOW, once per frame ---
  function scrollMitte(zeile) {
    const el = zeilenEls[zeile]; if (!el) return;
    const h = el.offsetHeight || ZEILENHOEHE, kopfH = kopfzeile()?.offsetHeight || 0;
    const oben = Number.isFinite(el.offsetTop) ? el.offsetTop : kopfH + zeile * h;
    const ziel = Math.max(0, oben - ((grid.clientHeight || 0) - kopfH) / 2 - kopfH + h / 2);
    if (Math.abs(grid.scrollTop - ziel) > 1) grid.scrollTop = ziel;
  }
  ctx.vorBild.push((t) => {
    const p = st.projekt;
    if (!p || !raster) return;
    const beat = ctx.kopfBeat(t);   // null while the transport stands or its state is unknown
    if (beat !== null && st.follow) {
      const ab = abschnitte(p).find((a) => beat >= a.von_beat && beat < a.von_beat + a.laenge_beats);
      if (ab && ab.id !== st.abschnitt_id) ctx.waehleAbschnitt(ab.id);
    }
    let zeile = -1;
    if (beat !== null && raster) {
      const rel = beat - raster.abschnitt.von_beat;
      if (rel >= 0 && rel < raster.abschnitt.laenge_beats) zeile = Math.min(raster.zeilen - 1, Math.floor(rel * raster.lpb + 1e-9));
    }
    if (zeile !== spielZeile) {
      zeilenEls[spielZeile]?.classList.remove('spielt');
      zeilenEls[zeile]?.classList.add('spielt');
      spielZeile = zeile;
    }
    if (st.follow && zeile >= 0) scrollMitte(zeile);
  });
}
