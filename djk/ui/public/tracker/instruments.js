// TRACKER view, the INSTRUMENTS column (plan 2026-11-18-tracker.md, task 21; fix round F4): the instrument tracks with their device, and for a track whose
// device has a slot role (the amiga device) its slot bank as a compact list (number, name, rate). No slot is chosen at first, so new notes get no `platz`.
// A click chooses the slot new notes get (st.platz, ctx.platzVon), a second click on the same slot lifts the choice. The editor (LOAD, CLEAR, NAME, LOOP,
// FROM, LEN, LEVEL, FINE) shows only for the track the cursor stands in (or whose slot was clicked last) and only for its chosen slot. LOAD opens the file
// picker as an overlay (GET /sampler/dateien; it closes on Escape and on a click beside it); a file goes into the chosen slot (POST /sampler/platz).
// Every write makes a new bank (the answer carries the project): the fields send on `change` only, never on every key. ctx.platzZahl(spur_id) is the real
// slot count of the track's bank. Like song.js the binder takes its element over: grid_view.js still draws a plain list into the element it found
// first, so this binder puts its own element after it (same data-t) and hides the old one.
// DOM items (data-t): instr (the column), instr-zeile (a track, data-spur), slots (the editor of one track, data-spur), slot (a slot row, data-nr, data-spur),
// slot-laden (LOAD), slot-leeren (CLEAR), slot-name, slot-schleife (LOOP), slot-s-von, slot-s-laenge, slot-pegel (LEVEL %), slot-fein (FINE), slot-picker,
// slot-rate (8363 / 16574 / 22050 / RAW), slot-suche, slot-wurzel (a root, data-name), slot-ordner (a folder, data-rel), slot-datei (a file, data-rel),
// slot-hoch (one folder up), slot-zu. Pure helpers first (tested in Node), the DOM below.
import { krumen, listenUrl, zeilenModell } from '../werkbank/regal_samples.js';
import { rollenVonGraphen } from './grid_model.js';

export const INSTR_TEXT = {
  titel: 'INSTRUMENTS',
  waehle: 'Choose this slot: the notes you type next on this track get it (INS column)',
  laden: 'Load a sample file into the chosen slot (converted to the Amiga form)',
  leeren: 'Empty the chosen slot',
  rate: 'Rate the file is stored at (the hold rate of the sound); RAW keeps 48 kHz at full resolution',
  schleife: 'Loop the slot between loop start and loop length',
  leerSlot: '(empty)',
  neuerSlot: '+ new slot',
  keineWurzeln: 'No sample folders yet: add one in the workbench shelf (SOURCES).',
  leerOrdner: 'No audio files or folders here',
  liest: 'Reading...',
  mehr: 'More files than shown: narrow the search',
};
/** The rates LOAD offers; RAW keeps 48 kHz at full resolution. */
export const RATEN = [{ wert: '8363', text: '8363 Hz' }, { wert: '16574', text: '16574 Hz' }, { wert: '22050', text: '22050 Hz' }, { wert: 'roh', text: 'RAW' }];
export const RATE_VORGABE = '16574';

const pad2 = (n) => String(n).padStart(2, '0');

/** "16574 Hz", RAW for a slot kept at 48000 Hz. */
export const rateText = (rate) => (rate === 48000 ? 'RAW 48000 Hz' : `${rate} Hz`);

/** The rows of the slot list: every slot of the answer of GET /sampler/plaetze, then one empty row (neu: true, shown as "+ new slot") for the next free slot (at most 32 rows in all). */
export function slotZeilen(plaetze) {
  const l = Array.isArray(plaetze) ? plaetze : [];
  const zeilen = l.map((p) => ({ nr: p.nr, name: p.leer ? '' : String(p.name ?? ''), leer: p.leer === true, rate: p.rate, frames: p.frames, p }));
  if (zeilen.length < 32) zeilen.push({ nr: zeilen.length + 1, name: '', leer: true, neu: true, rate: null, frames: 0, p: null });
  return zeilen;
}

/** The body of POST /sampler/platz for a file picked in the picker: `rate` is one of RATEN values. */
export function ladeKoerper({ spur_id, platz, wurzel, rel, rate }) {
  return { spur_id, platz, wurzel, rel, ...(rate === 'roh' ? { roh: true } : { rate: Number(rate) }) };
}

const zahlOrNull = (t) => { const s = String(t).trim(); return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null; };
/** The body of POST /sampler/platz/aendern for a field the person edited; null (with a text) when the value does not parse. `wert` is the text of the input. */
export function felderKoerper(spur_id, platz, feld, wert) {
  const basis = { spur_id, platz };
  if (feld === 'name') { const t = String(wert).trim(); return t === '' || t.length > 22 ? { fehler: 'The name takes 1..22 characters' } : { koerper: { ...basis, name: t } }; }
  if (feld === 'schleife') return { koerper: { ...basis, schleife: wert ? 1 : 0 } };
  const n = zahlOrNull(wert);
  if (feld === 's_von' || feld === 's_laenge') return n === null || !Number.isInteger(n) || n < 0 ? { fehler: 'A whole number of frames, 0 or more, is expected' } : { koerper: { ...basis, [feld]: n } };
  if (feld === 'pegel') return n === null || n < 0 || n > 100 ? { fehler: 'The level is 0..100 %' } : { koerper: { ...basis, pegel: n / 100 } };
  if (feld === 'fein') return n === null || !Number.isInteger(n) || n < -8 || n > 7 ? { fehler: 'Finetune is a whole number -8..7 (eighths of a semitone)' } : { koerper: { ...basis, fein: n } };
  return { fehler: 'Unknown field' };
}

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CSS = `
#tracker .t-slots { margin: 2px 0 8px 14px; border-left: 2px solid var(--line); padding-left: 8px; }
#tracker .t-slot { display: flex; gap: 8px; padding: 0 4px; cursor: pointer; font-family: ui-monospace, monospace; font-size: 11px; line-height: 15px; border-radius: 4px; }
#tracker .t-slot-rate { color: var(--dim); font-size: 10px; white-space: nowrap; }
#tracker .t-slot.an .t-slot-rate { color: inherit; }
#tracker .t-slot.neu .t-slot-name { font-style: italic; }
#tracker .t-slot:hover { background: var(--panel2); }
#tracker .t-slot.an { background: var(--d3); color: #0b0d12; }
#tracker .t-slot.leer .t-slot-name { opacity: .5; }
#tracker .t-slot-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#tracker .t-slot-felder { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
#tracker .t-slot-felder .t-eingabe { width: 7ch; }
#tracker .t-slot-felder .t-name-feld { width: 16ch; text-align: left; }
#tracker .t-slot-felder select.t-eingabe { width: auto; min-width: 11ch; }
/* the file picker is an overlay over the right half of the grid area, under the bar; it does not cover the column heads for good (Escape, a click beside it) */
#tracker .t-picker-ueber { grid-area: grid; justify-self: end; align-self: start; z-index: 6; box-sizing: border-box; width: min(420px, 100%); max-height: 100%; overflow: auto;
  background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; box-shadow: 0 6px 18px rgba(0, 0, 0, .45); }
#tracker .t-picker .t-zeile { display: flex; gap: 6px; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
#tracker .t-picker .t-zeile:hover { background: var(--panel); }
#tracker .t-picker .t-zeile span { color: var(--dim); }
`;

export function bindeInstrumente(ctx) {
  const { st, $ } = ctx;
  const alt = $('instr');
  const instr = document.createElement('div');
  instr.className = 't-instr';
  instr.setAttribute('data-t', 'instr');
  instr.setAttribute('aria-label', 'Instruments');
  if (alt) { alt.setAttribute('data-t', 'instr-alt'); alt.hidden = true; alt.after(instr); }
  // the file picker is its own overlay element (the column scrolls and clips); it stands after the column and takes the grid area on the right
  const ueber = document.createElement('div');
  ueber.className = 't-picker-ueber';
  ueber.setAttribute('data-t', 'slot-ueber');
  ueber.hidden = true;
  instr.after(ueber);
  try {
    if (document.head && !document.getElementById?.('t-instrumente-css')) {
      const s = document.createElement('style'); s.id = 't-instrumente-css'; s.textContent = CSS; document.head.appendChild(s);
    }
  } catch { /* without a head the pane is unstyled */ }

  const gewaehlt = new Map();   // spur_id -> the slot number the track's new notes get (no entry: none chosen)
  const bestand = new Map();    // spur_id -> { key, plaetze } the slots of the track as the server listed them
  const holt = new Set();       // keys being fetched
  let offenerPicker = null;     // { spur_id, platz, wurzeln | null, wurzel, ordner, suche, antwort | null, laedt }
  let signatur = '', ueberSig = '';
  let fokusSpur = null, letzteCursorSpur = null;   // the track whose editor shows: the cursor's track, or the one whose slot was clicked last
  const cursorSpurId = () => ctx.raster?.()?.spuren?.[st.cursor?.spur]?.spur_id ?? null;

  // what a track's new notes get: the chosen slot while the track still has a slot role (the page passes it to noteSchreiben as `platz`)
  const rolleSlot = (spur) => (spur?.art === 'instrument' && typeof ctx.rollenVon === 'function' ? ctx.rollenVon(spur.geraet)?.slot : undefined);
  ctx.platzVon = (spur_id) => {
    const spur = st.projekt?.spuren?.find((s) => s.id === spur_id);
    return rolleSlot(spur) !== undefined ? gewaehlt.get(spur_id) : undefined;
  };
  // a click chooses the slot; the same slot again lifts the choice (the notes then get no slot). The editor moves to this track; an open picker belongs to the old slot and closes.
  const waehle = (spur_id, nr) => {
    if (gewaehlt.get(spur_id) === nr) { gewaehlt.delete(spur_id); if (st.platzSpur === spur_id) { st.platz = undefined; st.platzSpur = undefined; } }
    else { gewaehlt.set(spur_id, nr); st.platz = nr; st.platzSpur = spur_id; }
    fokusSpur = spur_id; offenerPicker = null;
  };
  // the real number of slots of the track's bank (the status line names it), undefined while the list is not known
  ctx.platzZahl = (spur_id) => bestand.get(spur_id)?.plaetze?.length || undefined;

  const key = (spur) => `${spur.id}:${spur.geraet?.graph ?? ''}`;
  async function holeSlots(spur, erzwinge = false) {
    const k = key(spur);
    if (!erzwinge && (bestand.get(spur.id)?.key === k || holt.has(k))) return;
    holt.add(k);
    const r = await ctx.holeGet(`/sampler/plaetze?spur_id=${encodeURIComponent(spur.id)}`);
    holt.delete(k);
    if (r.status === 200 && Array.isArray(r.j?.plaetze)) bestand.set(spur.id, { key: k, plaetze: r.j.plaetze });
    else bestand.set(spur.id, { key: k, plaetze: [] });
    ctx.zeichne();
  }

  const spurListe = () => {
    const p = st.projekt;
    if (!p) return [];
    const raster = ctx.raster?.()?.spuren;
    return p.spuren.map((s, i) => {
      const rs = raster?.find((x) => x.spur_id === s.id);
      return { spur: s, buchstabe: rs?.buchstabe ?? String.fromCharCode(65 + i), geraet_text: rs?.geraet_text ?? (s.geraet?.graph ?? '') };
    }).filter((x) => x.spur.art === 'instrument');
  };

  // ---- drawing ----
  function slotHtml(spur, aktiv) {
    const b = bestand.get(spur.id);
    if (!b) return `<div class="t-slots" data-t="slots" data-spur="${esc(spur.id)}">${INSTR_TEXT.liest}</div>`;
    const zeilen = slotZeilen(b.plaetze);
    const nr = gewaehlt.get(spur.id);
    const zeile = nr === undefined ? undefined : zeilen.find((z) => z.nr === nr);
    const p = zeile?.p;
    const text = (z) => (z.neu ? INSTR_TEXT.neuerSlot : z.leer ? INSTR_TEXT.leerSlot : z.name || `Slot ${z.nr}`);
    const liste = zeilen.map((z) => `<div class="t-slot${z.nr === nr ? ' an' : ''}${z.leer ? ' leer' : ''}${z.neu ? ' neu' : ''}" data-t="slot" data-nr="${z.nr}" data-spur="${esc(spur.id)}" role="button"`
      + ` tabindex="0" title="${esc(INSTR_TEXT.waehle)}"><span class="t-slot-nr">${pad2(z.nr)}</span><span class="t-slot-name">${esc(text(z))}</span>`
      + `<span class="t-slot-rate">${z.rate ? esc(rateText(z.rate)) : ''}</span></div>`).join('');
    if (!aktiv || !zeile) return `<div class="t-slots" data-t="slots" data-spur="${esc(spur.id)}">${liste}</div>`;
    const dis = !p || zeile.leer ? ' disabled' : '';
    const wert = (v) => esc(v ?? '');
    const felder = `<div class="t-slot-felder" data-spur="${esc(spur.id)}">`
      + `<button type="button" class="t-knopf" data-t="slot-laden" title="${esc(INSTR_TEXT.laden)}">LOAD</button>`
      + `<button type="button" class="t-knopf" data-t="slot-leeren" title="${esc(INSTR_TEXT.leeren)}"${dis}>CLEAR</button>`
      + `<label class="t-feld">NAME <input class="t-eingabe t-name-feld" data-t="slot-name" type="text" maxlength="22" value="${wert(p && !zeile.leer ? p.name : '')}"${dis}></label>`
      + `<button type="button" class="t-knopf${p?.schleife ? ' an' : ''}" data-t="slot-schleife" title="${esc(INSTR_TEXT.schleife)}"${dis}>LOOP</button>`
      + `<label class="t-feld">FROM <input class="t-eingabe" data-t="slot-s-von" type="text" value="${wert(p?.s_von)}"${dis}></label>`
      + `<label class="t-feld">LEN <input class="t-eingabe" data-t="slot-s-laenge" type="text" value="${wert(p?.s_laenge)}"${dis}></label>`
      + `<label class="t-feld">LEVEL <input class="t-eingabe" data-t="slot-pegel" type="text" value="${p ? Math.round((p.pegel ?? 1) * 100) : ''}"${dis}></label>`
      + `<label class="t-feld">FINE <input class="t-eingabe" data-t="slot-fein" type="text" value="${wert(p?.fein)}"${dis}></label></div>`;
    return `<div class="t-slots" data-t="slots" data-spur="${esc(spur.id)}">${liste}${felder}</div>`;
  }

  function pickerHtml() {
    const pk = offenerPicker;
    if (!pk) return '';
    const raten = RATEN.map((r) => `<option value="${r.wert}"${r.wert === (pk.rate ?? RATE_VORGABE) ? ' selected' : ''}>${r.text}</option>`).join('');
    const kopf = `<div class="t-slot-felder"><span>Slot ${pad2(pk.platz)} :</span><label class="t-feld">RATE <select class="t-eingabe" data-t="slot-rate" title="${esc(INSTR_TEXT.rate)}">${raten}</select></label>`
      + `<input class="t-eingabe t-name-feld" data-t="slot-suche" type="text" placeholder="search" value="${esc(pk.suche)}">`
      + `<button type="button" class="t-knopf" data-t="slot-zu">CLOSE</button></div>`;
    let inhalt = '';
    if (pk.wurzel === null) {
      const w = pk.wurzeln;
      inhalt = w === null ? INSTR_TEXT.liest : w.length === 0 ? INSTR_TEXT.keineWurzeln
        : w.map((x) => `<div class="t-zeile" data-t="slot-wurzel" data-name="${esc(x.name)}">${esc(x.name)}${x.fehlt ? ' (not on disk)' : ''}</div>`).join('');
    } else {
      const krume = `<div class="t-zeile" data-t="slot-hoch" data-rel="">${esc(pk.wurzel)}${krumen(pk.ordner).map((k) => ` / ${esc(k.name)}`).join('')}  (up)</div>`;
      if (pk.antwort === null) inhalt = krume + INSTR_TEXT.liest;
      else {
        const m = zeilenModell(pk.antwort, { suche: pk.suche !== '' });
        const z = m.zeilen.map((r) => (r.art === 'ordner'
          ? `<div class="t-zeile" data-t="slot-ordner" data-rel="${esc(r.rel)}">[${esc(r.name)}]${r.zahl !== undefined ? ` ${r.zahl}` : ''}</div>`
          : `<div class="t-zeile" data-t="slot-datei" data-rel="${esc(r.rel)}">${esc(r.name)} <span>${esc(r.groesse)}${r.ort ? ` · ${esc(r.ort)}` : ''}</span></div>`)).join('');
        inhalt = krume + (z === '' ? INSTR_TEXT.leerOrdner : z) + (m.mehr ? `<div>${INSTR_TEXT.mehr}</div>` : '');
      }
    }
    return `<div class="t-picker" data-t="slot-picker">${kopf}${inhalt}</div>`;
  }

  function zeichne() {
    const p = st.projekt;
    if (!p) { instr.innerHTML = ''; signatur = ''; ueber.innerHTML = ''; ueber.hidden = true; ueberSig = ''; return; }
    const liste = spurListe();
    for (const { spur } of liste) if (rolleSlot(spur) !== undefined) holeSlots(spur);
    const cs = cursorSpurId();
    if (cs !== letzteCursorSpur) { letzteCursorSpur = cs; if (cs !== null) fokusSpur = cs; }
    const html = `<div class="t-titel">${INSTR_TEXT.titel}</div>` + liste.map(({ spur, buchstabe, geraet_text }) =>
      `<div class="t-instr-zeile" data-t="instr-zeile" data-spur="${esc(spur.id)}"><span class="t-buchstabe">${esc(buchstabe)}</span><span class="t-name">${esc(spur.name)}</span>`
      + `<span class="t-geraet">${esc(geraet_text)}</span></div>${rolleSlot(spur) !== undefined ? slotHtml(spur, spur.id === fokusSpur) : ''}`).join('');
    const aktiv = document.activeElement;
    const imEdit = (el) => !!aktiv && aktiv !== el && el.contains?.(aktiv) && /^(input|select)$/i.test(aktiv.tagName ?? '') && !aktiv.getAttribute?.('data-t')?.startsWith('slot-suche');
    if (html !== signatur && !imEdit(instr)) { signatur = html; instr.innerHTML = html; }   // an edit under way is not overwritten
    const pk = pickerHtml();
    if (pk !== ueberSig && !imEdit(ueber)) { ueberSig = pk; ueber.innerHTML = pk; ueber.hidden = pk === ''; }
  }
  ctx.beimZeichnen.push(zeichne);
  ctx.beimSpurwechsel?.push(zeichne);

  // ---- the server ----
  async function neuErmitteln() {
    const r = await ctx.holeGet('/graphen');
    if (r.status === 200) ctx.rollenVon = rollenVonGraphen(r.j?.graphen);
  }
  // a write that changed the project (first use of a bank switches the track): take the project over; every write: list the slots again
  async function nachSchreiben(r, spur_id) {
    if (r.status !== 200) { ctx.melde(ctx.antwortText(r), true); return false; }
    if (r.j?.projekt) { await neuErmitteln(); ctx.uebernimm(st.slug, r.j.projekt); }   // every write made a new bank: the tracks play it now
    const spur = st.projekt?.spuren?.find((s) => s.id === spur_id);
    if (spur) await holeSlots(spur, !r.j?.projekt);   // with the project the new key already started the listing
    if (r.j?.neu_laden_fehler) ctx.melde(r.j.neu_laden_fehler, true);
    else if (r.j?.text) ctx.melde(r.j.text);
    signatur = ''; ueberSig = '';
    ctx.zeichne();
    return true;
  }
  const schreibe = async (weg, koerper) => nachSchreiben(await ctx.holeJson(weg, koerper), koerper.spur_id);

  async function ladePicker() {
    const pk = offenerPicker;
    if (!pk) return;
    if (pk.wurzel === null) {
      const r = await ctx.holeGet('/sampler/dateien');
      if (offenerPicker !== pk) return;
      pk.wurzeln = r.status === 200 && Array.isArray(r.j?.wurzeln) ? r.j.wurzeln : [];
    } else {
      pk.antwort = null; signatur = ''; ctx.zeichne();
      const r = await ctx.holeGet(listenUrl(pk.wurzel, pk.ordner, pk.suche));
      if (offenerPicker !== pk) return;
      if (r.status !== 200) { ctx.melde(ctx.antwortText(r), true); pk.antwort = { ordner: pk.ordner, ordner_liste: [], dateien: [] }; }
      else pk.antwort = r.j;
    }
    signatur = '';
    ctx.zeichne();
  }

  // ---- events ----
  const spurVon = (e) => e.target.closest?.('[data-spur]')?.getAttribute('data-spur') ?? null;
  const gewaehlteNr = (spur_id) => gewaehlt.get(spur_id);   // undefined: none chosen (the editor is not drawn then)
  const klickAuf = async (e) => {
    const z = e.target.closest?.('[data-t]');
    if (!z) return;
    const t = z.getAttribute('data-t'), spur_id = spurVon(e);
    if (t === 'slot') { waehle(spur_id, Number(z.getAttribute('data-nr'))); signatur = ''; ctx.zeichne(); return; }
    if (t === 'slot-laden') {
      if (gewaehlteNr(spur_id) === undefined) return;
      offenerPicker = { spur_id, platz: gewaehlteNr(spur_id), wurzeln: null, wurzel: null, ordner: '', suche: '', antwort: null, rate: RATE_VORGABE };
      signatur = ''; ctx.zeichne(); await ladePicker(); return;
    }
    if (t === 'slot-zu') { offenerPicker = null; signatur = ''; ctx.zeichne(); return; }
    if (t === 'slot-leeren') { if (gewaehlteNr(spur_id) !== undefined) await schreibe('/sampler/platz/leeren', { spur_id, platz: gewaehlteNr(spur_id) }); return; }
    if (t === 'slot-schleife') {
      if (gewaehlteNr(spur_id) === undefined) return;
      const p = bestand.get(spur_id)?.plaetze.find((x) => x.nr === gewaehlteNr(spur_id));
      const f = felderKoerper(spur_id, gewaehlteNr(spur_id), 'schleife', !(p?.schleife === 1));
      await schreibe('/sampler/platz/aendern', f.koerper);
      return;
    }
    const pk = offenerPicker;
    if (!pk) return;
    if (t === 'slot-wurzel') { pk.wurzel = z.getAttribute('data-name'); pk.ordner = ''; pk.suche = ''; await ladePicker(); }
    else if (t === 'slot-ordner') { pk.ordner = z.getAttribute('data-rel'); pk.suche = ''; await ladePicker(); }
    else if (t === 'slot-hoch') {
      if (pk.suche !== '') pk.suche = '';
      else if (pk.ordner !== '') pk.ordner = pk.ordner.split('/').slice(0, -1).join('/');
      else { pk.wurzel = null; pk.antwort = null; }
      await ladePicker();
    } else if (t === 'slot-datei') {
      const koerper = ladeKoerper({ spur_id: pk.spur_id, platz: pk.platz, wurzel: pk.wurzel, rel: z.getAttribute('data-rel'), rate: pk.rate ?? RATE_VORGABE });
      offenerPicker = null; signatur = ''; ctx.melde('Loading and converting the file...');
      await schreibe('/sampler/platz', koerper);
    }
  };
  instr.addEventListener('click', klickAuf);
  ueber.addEventListener('click', klickAuf);
  instr.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const z = e.target.closest?.('[data-t="slot"]');
    if (z) { e.preventDefault?.(); waehle(spurVon(e), Number(z.getAttribute('data-nr'))); signatur = ''; ctx.zeichne(); }
  });
  const aendereAuf = async (e) => {
    const z = e.target;
    const t = z.getAttribute?.('data-t'), spur_id = spurVon(e);
    if (t === 'slot-rate') { if (offenerPicker) offenerPicker.rate = z.value; return; }
    const feld = { 'slot-name': 'name', 'slot-s-von': 's_von', 'slot-s-laenge': 's_laenge', 'slot-pegel': 'pegel', 'slot-fein': 'fein' }[t];
    if (!feld) return;
    if (gewaehlteNr(spur_id) === undefined) return;
    const f = felderKoerper(spur_id, gewaehlteNr(spur_id), feld, z.value);
    if (f.fehler) { ctx.melde(f.fehler, true); signatur = ''; ctx.zeichne(); return; }
    await schreibe('/sampler/platz/aendern', f.koerper);
  };
  // the fields send on `change` only (leaving the field or Enter), never on every key: every write makes a new bank
  instr.addEventListener('change', aendereAuf);
  ueber.addEventListener('change', aendereAuf);
  let suchUhr = null;
  ueber.addEventListener('input', (e) => {
    if (e.target.getAttribute?.('data-t') !== 'slot-suche' || !offenerPicker || offenerPicker.wurzel === null) return;
    const pk = offenerPicker, text = e.target.value;
    clearTimeout(suchUhr);
    suchUhr = setTimeout(() => { if (offenerPicker === pk) { pk.suche = text.trim(); ladePicker(); } }, 300);
    suchUhr?.unref?.();
  });

  ctx.beimProjekt.push((p, wechsel) => {
    if (wechsel) { gewaehlt.clear(); bestand.clear(); offenerPicker = null; fokusSpur = null; letzteCursorSpur = null; st.platz = undefined; st.platzSpur = undefined; }
    signatur = '';
  });
  ctx.beimEreignis.push(() => {});

  // the picker closes on Escape and on a click beside it (the LOAD button that opens it does not count as beside)
  ctx.beiAussen?.([ueber], () => offenerPicker !== null, () => { offenerPicker = null; ctx.zeichne(); }, (e) => !!e.target?.closest?.('[data-t="slot-laden"]'));
}
