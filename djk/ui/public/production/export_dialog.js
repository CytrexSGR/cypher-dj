// PRODUCTION: the export dialog (EXPORT in the transport bar). Everything that computes is a pure function here (tested in node, no DOM at import);
// bindeExportDialog only builds the native <dialog>, reads the controls into the state and hands the result to the pure functions.
// Request and answer: POST /proj/export {abgabe?, ziel?, ohne_meta?, ausklang_beats?} (djk/ui/areas/proj/output.ts), metadata: the project command
// abgabe_meta_setzen (djk/ui/project/commands_transport.ts). The float master is always written; deliveries and the target check come on top.
// Mode `spuren`: POST /proj/export_spuren {abgabe?} (the mix and every track as its own file, ONE format wav or flac, no target, no metadata, no tail).
import { beatsProTakt } from './timeline.js';
import { loopTakte } from './layout.js';
import { hatHostStufe } from './output.js';
import { waehleOrdner } from '../browser/ordner_dialog.js';

export const SPEICHER_SCHLUESSEL = 'cypherdj.export.v1';
export const ZEILEN_MAX = 4;
export const FORMAT_VORGABEN = {            // the preset select; `eigen` keeps the rows the user edits
  master: [],
  release: [{ format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }],
  promo: [{ format: 'mp3', kbps: 320, rate_hz: 44100 }],
  release_promo: [{ format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }, { format: 'mp3', kbps: 320, rate_hz: 44100 }],
};
export const spurenVorgaben = ['master', 'release', 'eigen'];   // the presets that fit the set: no mp3, one row
export const DOPPELT_TEXT = 'Two formats would write the same file: change the bit depth or the sample rate of one row, or remove it';
export const SPUREN_HOST_TEXT = 'Not available while a plugin stage is on (the per-track export renders offline)';
export const ZIEL_VORGABEN = { aus: null, streaming: { lufs_i: -14, true_peak_dbtp: -1 }, spitze: { true_peak_dbtp: -1 } };
const META_FELDER = ['titel', 'kuenstler', 'album', 'jahr', 'genre', 'isrc'];
const RATEN = [44100, 48000, 88200, 96000];
const BITS = { wav: [16, 24, 32], flac: [16, 24] };
const KBPS = [192, 256, 320];
const kopie = (x) => JSON.parse(JSON.stringify(x));

// the controls that apply to one row: a list of choices, or null / false when the control is hidden
export function zeilenSteuerung(z) {
  if (z.format === 'mp3') return { bits: null, dither: false, kbps: KBPS, raten: [44100, 48000] };
  return { bits: BITS[z.format] ?? null, dither: z.bits === 16, kbps: null, raten: RATEN };
}
export function neueZeile(format) {
  if (format === 'mp3') return { format: 'mp3', kbps: 320, rate_hz: 44100 };
  if (format === 'flac') return { format: 'flac', bits: 24, rate_hz: 44100 };
  return { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' };
}
// one change of one row (feld: format | bits | rate_hz | dither | kbps) that leaves the row valid for the server
export function zeileAendern(z, feld, wert) {
  if (feld === 'format') {
    const n = neueZeile(wert);
    if (zeilenSteuerung(n).raten.includes(z.rate_hz)) n.rate_hz = z.rate_hz;
    if (n.format !== 'mp3' && n.bits !== undefined && BITS[n.format].includes(z.bits)) { n.bits = z.bits; if (z.bits === 16) n.dither = z.dither ?? 'tpdf'; else delete n.dither; }
    return n;
  }
  const n = { ...z, [feld]: wert };
  if (feld === 'bits') { if (wert === 16) n.dither = z.dither ?? 'tpdf'; else delete n.dither; }
  return n;
}
// the file name of a row as the server builds it (project/abgabe.ts abgabeName): dither is not part of it
const zeilenSchluessel = (z) => `${z.format}|${z.format === 'mp3' ? z.kbps : z.bits}|${z.rate_hz}`;
export const doppelteZeilen = (zeilen) => new Set(zeilen.map(zeilenSchluessel)).size < zeilen.length;
// the row "+ Add format" appends: the first valid combination no row has yet (rates outer, then WAV 16/24/32, FLAC 16/24); all used: a plain WAV row
export function naechsteZeile(zeilen) {
  const benutzt = new Set(zeilen.map(zeilenSchluessel));
  for (const r of RATEN) for (const f of ['wav', 'flac']) for (const b of BITS[f]) {
    const n = { ...zeileAendern(neueZeile(f), 'bits', b), rate_hz: r };
    if (!benutzt.has(zeilenSchluessel(n))) return n;
  }
  return neueZeile('wav');
}
function zeileGueltig(z) {
  if (typeof z !== 'object' || z === null || Array.isArray(z)) return false;
  const s = z.format === 'wav' || z.format === 'flac' || z.format === 'mp3' ? zeilenSteuerung(z) : null;
  if (!s || !s.raten.includes(z.rate_hz)) return false;
  const erlaubt = new Set(['format', 'rate_hz', ...(s.bits ? ['bits'] : []), ...(s.kbps ? ['kbps'] : []), ...(s.dither ? ['dither'] : [])]);
  if (Object.keys(z).some((k) => !erlaubt.has(k))) return false;
  if (s.bits && !s.bits.includes(z.bits)) return false;
  if (s.kbps && !s.kbps.includes(z.kbps)) return false;
  return !s.dither || z.dither === 'tpdf' || z.dither === 'aus';
}

// the first row the set can write (wav or flac) as a list of one, else []
const spurenZeile = (zeilen) => zeilen.filter((x) => x.format === 'wav' || x.format === 'flac').slice(0, 1);
// the mode changes: { vorgabe, zeilen } that is valid for the new mode. Into the set: one WAV or FLAC row, mp3 presets fall back; back to mix:
// the custom rows remembered before (`eigene`) return. Returns copies.
export function wechselModus(z, modus, eigene) {
  if (modus === 'mix') return z.vorgabe === 'eigen' && eigene ? { vorgabe: 'eigen', zeilen: kopie(eigene) } : { vorgabe: z.vorgabe, zeilen: kopie(z.zeilen) };
  if (z.vorgabe === 'release_promo') return { vorgabe: 'release', zeilen: kopie(FORMAT_VORGABEN.release) };
  if (z.vorgabe === 'promo') return { vorgabe: 'master', zeilen: [] };
  if (z.vorgabe === 'eigen') { const r = spurenZeile(z.zeilen); return r.length ? { vorgabe: 'eigen', zeilen: kopie(r) } : { vorgabe: 'master', zeilen: [] }; }
  return { vorgabe: z.vorgabe, zeilen: kopie(z.zeilen) };
}

// → { vorgabe, zeilen, ziel, ausklang_beats, modus: 'mix' | 'spuren', mit_meta, meta: {titel, kuenstler, album, jahr, genre, isrc} }; `gespeichert` is the parsed
// storage (or null): what does not parse or carries an unknown value is ignored as a whole
export function dialogVorgabe(projekt, gespeichert) {
  const z = { vorgabe: 'master', zeilen: [], ziel: 'aus', ausklang_beats: 0, mit_meta: true };
  const g = gespeichert;
  let kuenstler = '', modus = 'mix';
  const ok = g && typeof g === 'object' && !Array.isArray(g) && g.v === 1
    && (g.vorgabe === 'eigen' || Object.hasOwn(FORMAT_VORGABEN, g.vorgabe))
    && (g.vorgabe !== 'eigen' || (Array.isArray(g.zeilen) && g.zeilen.length >= 1 && g.zeilen.length <= ZEILEN_MAX && g.zeilen.every(zeileGueltig)))
    && Object.hasOwn(ZIEL_VORGABEN, g.ziel)
    && Number.isInteger(g.ausklang_beats) && g.ausklang_beats >= 0 && g.ausklang_beats <= 64
    && typeof g.mit_meta === 'boolean' && typeof g.kuenstler === 'string'
    && (g.modus === undefined || g.modus === 'mix' || (g.modus === 'spuren' && spurenVorgaben.includes(g.vorgabe)
      && (g.vorgabe !== 'eigen' || (g.zeilen.length === 1 && spurenZeile(g.zeilen).length === 1))));   // no modus (state of before the set): mix
  if (ok) {
    z.vorgabe = g.vorgabe; z.zeilen = kopie(g.vorgabe === 'eigen' ? g.zeilen : FORMAT_VORGABEN[g.vorgabe]);
    z.ziel = g.ziel; z.ausklang_beats = g.ausklang_beats; z.mit_meta = g.mit_meta; kuenstler = g.kuenstler;
    if (g.modus === 'spuren' && !hatHostStufe(projekt)) modus = 'spuren';   // the set renders offline: with a plugin stage on it is not available
  }
  const pm = projekt?.abgabe_meta ?? {};
  const meta = {};
  for (const k of META_FELDER) meta[k] = pm[k] === undefined ? '' : String(pm[k]);
  if (meta.kuenstler === '') meta.kuenstler = kuenstler;
  const r = { ...z, modus, meta };
  if (ok && typeof g.ordner === 'string' && g.ordner !== '') r.ordner = g.ordner;   // "Export to": a remembered folder; anything else is no folder
  return r;
}
// what goes into the storage: the settings plus the artist last used (the rest of the metadata lives in the project)
export function speicherInhalt(z) {
  return { v: 1, modus: z.modus === 'spuren' ? 'spuren' : 'mix', vorgabe: z.vorgabe, zeilen: kopie(z.zeilen), ziel: z.ziel, ausklang_beats: z.ausklang_beats, mit_meta: z.mit_meta, kuenstler: String(z.meta?.kuenstler ?? '').trim(),
    ...(typeof z.ordner === 'string' && z.ordner !== '' ? { ordner: z.ordner } : {}) };
}

// → { weg, koerper }: a field only when it differs from today's request. `ordner` (both modes) only when one is chosen and not marked unavailable (`ordnerFehlt`)
const ordnerFeld = (z) => (typeof z.ordner === 'string' && z.ordner !== '' && !z.ordnerFehlt ? { ordner: z.ordner } : {});
export function exportAnfrage(z) {
  if (z.modus === 'spuren') return { weg: '/proj/export_spuren', koerper: { ...(z.zeilen.length > 0 ? { abgabe: kopie(z.zeilen[0]) } : {}), ...ordnerFeld(z) } };   // no tail, target or metadata flag
  const koerper = {};
  if (z.zeilen.length > 0) koerper.abgabe = kopie(z.zeilen);
  if (z.ziel !== 'aus' && ZIEL_VORGABEN[z.ziel]) koerper.ziel = { ...ZIEL_VORGABEN[z.ziel] };
  if (z.ausklang_beats > 0) koerper.ausklang_beats = z.ausklang_beats;
  if (!z.mit_meta) koerper.ohne_meta = true;
  Object.assign(koerper, ordnerFeld(z));
  return { weg: '/proj/export', koerper };
}

// 'de-xxx-26-00001' → 'DEXXX2600001'; null when it is not an ISRC; '' stays ''
export function isrcNormal(text) {
  const t = String(text ?? '').replace(/[\s-]/g, '').toUpperCase();
  return t === '' ? '' : /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(t) ? t : null;
}
// '2026' → 2026; '' stays ''; null when it is not a whole year 1900 to 2100
export function jahrNormal(text) {
  const t = String(text ?? '').trim();
  if (t === '') return '';
  const n = /^[0-9]{4}$/.test(t) ? Number(t) : NaN;
  return n >= 1900 && n <= 2100 ? n : null;
}
export const metaPruefung = (meta) => ({ jahr: jahrNormal(meta?.jahr) !== null, isrc: isrcNormal(meta?.isrc) !== null });

// → { befehl: 'abgabe_meta_setzen', ... } with the fields that differ from the project (emptied: null; all emptied: aus), or null when nothing differs
export function metaBefehl(projekt, z) {
  const alt = projekt?.abgabe_meta ?? {};
  const neu = {};
  for (const k of META_FELDER) {
    const t = String(z.meta?.[k] ?? '').trim();
    const v = k === 'jahr' ? jahrNormal(t) : k === 'isrc' ? isrcNormal(t) : t;
    if (v === null) { if (alt[k] !== undefined) neu[k] = alt[k]; continue; }   // invalid: keep what the project has (startErlaubt blocks before this is sent)
    if (v !== '') neu[k] = v;
  }
  const aenderung = {};
  for (const k of META_FELDER) {
    if (neu[k] === undefined && alt[k] !== undefined) aenderung[k] = null;
    else if (neu[k] !== undefined && neu[k] !== alt[k]) aenderung[k] = neu[k];
  }
  if (Object.keys(aenderung).length === 0) return null;
  if (Object.keys(neu).length === 0) return { befehl: 'abgabe_meta_setzen', aus: true };
  return { befehl: 'abgabe_meta_setzen', ...aenderung };
}

// EXPORT of the dialog: not while a run is going (own or foreign, `lauf` not null) and not with an invalid metadata field
export function startErlaubt(z, lauf) {
  if (lauf) return false;
  if (z.modus === 'spuren') return true;   // one row, the metadata rows are hidden and not used
  if (doppelteZeilen(z.zeilen)) return false;   // the server refuses two rows with one file name
  const p = metaPruefung(z.meta);
  return p.jahr && p.isrc;
}

// the range line: what the server will export (it decides; this mirrors st.projekt.loop)
export function bereichText(projekt) {
  const l = projekt?.loop;
  if (!l?.an) return 'Whole song';
  const t = loopTakte(l, beatsProTakt(projekt.taktart));
  return `Loop bracket, bars ${t.vonTakt} to ${t.bisTakt}`;
}

export const ORDNER_PROJEKT_TEXT = 'Project export folder';
export const ordnerFehltText = (pfad) => `${pfad} is not available, this export goes to the project export folder`;
const HINWEIS_FORMAT = 'The float master (WAV 48 kHz 32 bit float) is always written.';
const MODUS_TEXT = [['mix', 'Mix'], ['spuren', 'Mix and every track as its own file']];
const VORGABE_TEXT = [['master', 'Master only'], ['release', 'Release: WAV 16 bit 44.1 kHz'], ['promo', 'Promo: MP3 320'], ['release_promo', 'Release and promo'], ['eigen', 'Custom']];
const ZIEL_TEXT = [['aus', 'None'], ['streaming', 'Streaming, -14 LUFS and -1 dBTP'], ['spitze', 'True peak -1 dBTP']];
const RATE_TEXT = (r) => `${r / 1000} kHz`;
const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };

// DOM: builds the <dialog> on the first open; starte(anfrage) runs the export. Returns { oeffne() }.
export function bindeExportDialog(ctx, starte) {
  const { st } = ctx;
  let dlg = null, z = null, eigeneZeilen = null, beschaeftigt = false, waehlerOffen = false, anfrageNr = 0;
  const d = {};   // the controls by name
  const reihe = {};   // the rows that the mode spuren hides: tail, loudness target, metadata
  const spuren = () => z?.modus === 'spuren';

  function lade() {
    let g = null;
    try { g = JSON.parse(localStorage.getItem(SPEICHER_SCHLUESSEL)); } catch { g = null; }
    return dialogVorgabe(st.projekt, g);
  }
  function speichere() {
    try { localStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(speicherInhalt(z))); } catch { /* storage may be blocked: the dialog works without it */ }
  }
  function zeile(label, ...inhalt) {
    const r = el('div', 'p-export-zeile'), l = el('label', 'p-export-label', label);
    const f = el('div', 'p-export-feld'); f.append(...inhalt);
    r.append(l, f);
    return { r, l, f };
  }
  function auswahl(daten, wert, aend, name) {
    const s = el('select'); if (name) s.dataset.p = name;
    for (const [w, t] of daten) { const o = el('option', '', t); o.value = String(w); s.append(o); }
    s.value = String(wert);
    s.addEventListener('change', () => aend(s.value));
    return s;
  }
  function zeichneZeilen() {
    d.zeilen.replaceChildren();
    d.zeilen.hidden = z.vorgabe !== 'eigen';
    if (z.vorgabe !== 'eigen') { sperre(); return; }
    const formate = spuren() ? [['wav', 'WAV'], ['flac', 'FLAC']] : [['wav', 'WAV'], ['flac', 'FLAC'], ['mp3', 'MP3']];   // the set has no mp3
    z.zeilen.forEach((zl, i) => {
      const s = zeilenSteuerung(zl), r = el('div', 'p-export-abgabe');
      r.dataset.p = 'export-abgabe';
      const setze = (feld, w) => { z.zeilen[i] = zeileAendern(z.zeilen[i], feld, w); eigeneZeilen = kopie(z.zeilen); zeichneZeilen(); };
      r.append(auswahl(formate, zl.format, (w) => setze('format', w), 'export-format'));
      if (s.bits) r.append(auswahl(s.bits.map((b) => [b, `${b} bit`]), zl.bits, (w) => setze('bits', Number(w)), 'export-bits'));
      r.append(auswahl(s.raten.map((x) => [x, RATE_TEXT(x)]), zl.rate_hz, (w) => setze('rate_hz', Number(w)), 'export-rate'));
      if (s.dither) r.append(auswahl([['tpdf', 'Dither TPDF'], ['aus', 'No dither']], zl.dither, (w) => setze('dither', w), 'export-dither'));
      if (s.kbps) r.append(auswahl(s.kbps.map((k) => [k, `${k} kbit/s`]), zl.kbps, (w) => setze('kbps', Number(w)), 'export-kbps'));
      if (z.zeilen.length > 1 && !spuren()) {
        const x = el('button', 'p-export-klein', '×'); x.type = 'button'; x.title = 'Remove this row'; x.dataset.p = 'export-zeile-weg';
        x.addEventListener('click', () => { z.zeilen.splice(i, 1); eigeneZeilen = kopie(z.zeilen); zeichneZeilen(); });
        r.append(x);
      }
      d.zeilen.append(r);
    });
    if (z.zeilen.length < ZEILEN_MAX && !spuren()) {   // the set takes one row
      const p = el('button', 'p-export-klein', '+ Add format'); p.type = 'button'; p.dataset.p = 'export-zeile-neu';
      p.addEventListener('click', () => { z.zeilen.push(naechsteZeile(z.zeilen)); eigeneZeilen = kopie(z.zeilen); zeichneZeilen(); });
      d.zeilen.append(p);
    }
    const doppelt = doppelteZeilen(z.zeilen);
    if (doppelt) d.zeilen.append(el('div', 'p-export-fehler', DOPPELT_TEXT));
    sperre();
  }
  function waehleVorgabe(v) {
    if (z.vorgabe === 'eigen') eigeneZeilen = kopie(z.zeilen);
    if (v === 'eigen') z.zeilen = kopie(eigeneZeilen ?? (z.zeilen.length ? z.zeilen : FORMAT_VORGABEN.release));   // the rows of the last preset are the start of a custom set
    else z.zeilen = kopie(FORMAT_VORGABEN[v]);
    if (v === 'eigen' && spuren()) z.zeilen = wechselModus({ vorgabe: 'eigen', zeilen: z.zeilen }, 'spuren', null).zeilen;
    if (v === 'eigen' && z.zeilen.length === 0) z.zeilen = kopie(FORMAT_VORGABEN.release);
    z.vorgabe = v;
    zeichneZeilen();
  }
  // the mode: the preset list, the rows and the hidden rows follow it; with a plugin stage on the set is not offered
  function zeigeModus() {
    const host = hatHostStufe(st.projekt), s = spuren();
    d.modus.value = z.modus;
    for (const o of d.modus.options) if (o.value === 'spuren') o.disabled = host;
    d.modusHinweis.textContent = host ? SPUREN_HOST_TEXT : '';
    d.modusHinweis.hidden = !host;
    d.vorgabe.replaceChildren(...VORGABE_TEXT.filter(([w]) => !s || spurenVorgaben.includes(w)).map(([w, t]) => { const o = el('option', '', t); o.value = w; return o; }));
    d.vorgabe.value = z.vorgabe;
    for (const k of ['ausklang', 'ziel', 'meta']) reihe[k].hidden = s;
    d.hinweisFormat.textContent = s ? 'Every file of the set is written in this format instead of the float WAV (no metadata).' : HINWEIS_FORMAT;
    zeichneZeilen();
  }
  function waehleModus(m) {
    if (m === 'spuren' && hatHostStufe(st.projekt)) { d.modus.value = z.modus; return; }
    if (z.vorgabe === 'eigen' && !spuren()) eigeneZeilen = kopie(z.zeilen);   // the custom rows of the mix survive a round trip through the set
    Object.assign(z, wechselModus(z, m, eigeneZeilen));
    z.modus = m;
    zeigeModus();
  }
  function lies() {
    z.ausklang_beats = Math.min(64, Math.max(0, Math.round(Number(d.ausklang.value) || 0)));
    z.ziel = d.ziel.value; z.mit_meta = d.mitMeta.checked;
    for (const k of META_FELDER) z.meta[k] = d[k].value;
    return z;
  }
  function markiere() {
    const p = metaPruefung(lies().meta);
    let erstes = null;
    for (const k of ['jahr', 'isrc']) {
      d[k].classList.toggle('fehler', !p[k]); d[k].setAttribute('aria-invalid', String(!p[k]));
      if (!p[k] && !erstes) erstes = d[k];
    }
    d.meldung.textContent = !p.jahr ? 'Year: a whole year from 1900 to 2100' : !p.isrc ? 'ISRC: 12 characters like DEXXX2600001' : '';
    erstes?.focus();
  }
  function sperre() {
    if (!d.start) return;
    const doppelt = z && !spuren() && doppelteZeilen(z.zeilen);
    d.start.disabled = !!ctx.laufJetzt() || beschaeftigt || doppelt;
    d.start.title = doppelt ? DOPPELT_TEXT : '';
  }
  async function los() {
    if (beschaeftigt) return;
    if (!spuren() && doppelteZeilen(z.zeilen)) { d.meldung.textContent = DOPPELT_TEXT; return; }
    if (!startErlaubt(lies(), ctx.laufJetzt())) { markiere(); return; }
    if (spuren() && hatHostStufe(st.projekt)) { d.meldung.textContent = SPUREN_HOST_TEXT; return; }   // a stage was switched on meanwhile
    if (!spuren()) markiere();
    const befehl = spuren() ? null : metaBefehl(st.projekt, z);   // the set carries no tags: the metadata stays as it is
    if (befehl) {
      beschaeftigt = true; sperre();
      let ok = false;
      try { ok = await ctx.aendere('Release metadata', [befehl]); } finally { beschaeftigt = false; sperre(); }
      if (!dlg.open) return;                                   // another project was opened meanwhile
      if (ok !== true) { dlg.close(); return; }                // the page's message line carries the reason
      if (ctx.laufJetzt()) { dlg.close(); return; }
    }
    speichere();
    dlg.close();
    starte(exportAnfrage(z));
  }
  // the row "Export to": the chosen folder as text, PROJECT FOLDER only while one is chosen
  function zeigeOrdner() {
    const o = z?.ordner;
    d.ordnerText.textContent = !o ? ORDNER_PROJEKT_TEXT : z.ordnerFehlt ? ordnerFehltText(o) : o;
    d.ordnerText.classList.toggle('p-export-fehler', !!o && !!z.ordnerFehlt);
    d.ordnerProjekt.hidden = !o;
  }
  // a remembered folder is asked for once on open; a refusal (gone disk, outside the roots) marks it, the request then omits it
  async function pruefeOrdner() {
    const o = z.ordner, zz = z, nr = ++anfrageNr;
    if (!o) return;
    let r = null;
    try { r = await ctx.holeGet(`/dateisystem/ordner?pfad=${encodeURIComponent(o)}`); } catch { r = null; }
    if (nr !== anfrageNr || z !== zz || z.ordner !== o) return;   // closed, reopened or changed meanwhile
    if (r && r.status !== 200 && r.status !== 0) { z.ordnerFehlt = true; zeigeOrdner(); }   // no connection (0) is no verdict: the server refuses a bad folder itself
  }
  async function waehle() {
    if (waehlerOffen) return;
    waehlerOffen = true;
    let pfad = null;
    try { pfad = await waehleOrdner({ titel: 'Export to', host: ctx, start: z.ordner && !z.ordnerFehlt ? z.ordner : '', in: dlg }); }
    finally { waehlerOffen = false; }
    if (pfad === null || pfad === undefined || pfad === '') { d.ordnerWahl.focus(); return; }
    z.ordner = pfad; z.ordnerFehlt = false; anfrageNr++;
    speichere();   // kept at once, also when the dialog is cancelled afterwards
    zeigeOrdner(); d.ordnerWahl.focus();
  }
  function baue() {
    dlg = el('dialog', 'p-export'); dlg.dataset.p = 'export-dialog';
    dlg.setAttribute('aria-label', 'Export');
    const kopf = el('h3', 'p-export-kopf', 'Export');
    d.bereich = el('div', 'p-export-text'); d.bereich.dataset.p = 'export-bereich';
    d.ausklang = el('input'); d.ausklang.type = 'number'; d.ausklang.min = '0'; d.ausklang.max = '64'; d.ausklang.step = '1'; d.ausklang.dataset.p = 'export-ausklang';
    d.vorgabe = auswahl(VORGABE_TEXT, 'master', waehleVorgabe, 'export-vorgabe');
    d.zeilen = el('div', 'p-export-zeilen');
    d.zeilen.dataset.p = 'export-abgaben';
    d.ziel = auswahl(ZIEL_TEXT, 'aus', () => {}, 'export-ziel');
    const hinweisFormat = el('div', 'p-export-hinweis', HINWEIS_FORMAT); d.hinweisFormat = hinweisFormat;
    d.modus = auswahl(MODUS_TEXT, 'mix', waehleModus, 'export-modus');
    d.modusHinweis = el('div', 'p-export-hinweis'); d.modusHinweis.dataset.p = 'export-modus-hinweis'; d.modusHinweis.hidden = true;
    const hinweisZiel = el('div', 'p-export-hinweis', 'Nothing is normalised: the export is checked, not changed.');
    const felder = el('div', 'p-export-meta');
    const meta = [['titel', 'Title'], ['kuenstler', 'Artist'], ['album', 'Album'], ['jahr', 'Year'], ['genre', 'Genre'], ['isrc', 'ISRC']];
    for (const [k, t] of meta) {
      const i = el('input'); i.type = 'text'; i.dataset.p = `export-${k}`; i.autocomplete = 'off'; i.maxLength = k === 'jahr' ? 4 : k === 'isrc' ? 20 : 200;
      i.setAttribute('aria-label', t); i.placeholder = t;
      i.addEventListener('input', () => { i.classList.remove('fehler'); i.removeAttribute('aria-invalid'); d.meldung.textContent = ''; });
      d[k] = i; felder.append(i);
    }
    d.mitMeta = el('input'); d.mitMeta.type = 'checkbox'; d.mitMeta.dataset.p = 'export-mit-meta';
    const mm = el('label', 'p-export-haken'); mm.append(d.mitMeta, document.createTextNode(' Write metadata into the delivery files'));
    d.meldung = el('div', 'p-export-fehler'); d.meldung.dataset.p = 'export-meldung'; d.meldung.setAttribute('role', 'alert');
    d.start = el('button', 'p-export-start', 'EXPORT'); d.start.type = 'button'; d.start.dataset.p = 'export-start';
    d.abbruch = el('button', '', 'Cancel'); d.abbruch.type = 'button'; d.abbruch.dataset.p = 'export-abbruch';
    const knoepfe = el('div', 'p-export-knoepfe'); knoepfe.append(d.abbruch, d.start);
    d.ordnerText = el('div', 'p-export-ordner'); d.ordnerText.dataset.p = 'export-ordner';
    d.ordnerWahl = el('button', '', 'CHOOSE…'); d.ordnerWahl.type = 'button'; d.ordnerWahl.dataset.p = 'export-ordner-wahl';
    d.ordnerProjekt = el('button', '', 'PROJECT FOLDER'); d.ordnerProjekt.type = 'button'; d.ordnerProjekt.dataset.p = 'export-ordner-projekt';
    const ordnerKnoepfe = el('div', 'p-export-abgabe'); ordnerKnoepfe.append(d.ordnerWahl, d.ordnerProjekt);
    d.ordnerWahl.addEventListener('click', () => { waehle(); });
    d.ordnerProjekt.addEventListener('click', () => { delete z.ordner; delete z.ordnerFehlt; anfrageNr++; speichere(); zeigeOrdner(); });
    reihe.ausklang = zeile('Tail (beats)', d.ausklang).r;
    reihe.ziel = zeile('Loudness target', d.ziel, hinweisZiel).r;
    reihe.meta = zeile('Metadata', felder, mm).r;
    dlg.append(kopf,
      zeile('Range', d.bereich).r,
      zeile('Mode', d.modus, d.modusHinweis).r,
      zeile('Export to', d.ordnerText, ordnerKnoepfe).r,
      reihe.ausklang,
      zeile('Format', d.vorgabe, hinweisFormat, d.zeilen).r,
      reihe.ziel, reihe.meta,
      d.meldung, knoepfe);
    d.start.addEventListener('click', () => { los(); });
    d.abbruch.addEventListener('click', () => dlg.close());
    // Enter exports (not from a select or a button other than EXPORT), Esc is the native cancel; the page's own key handlers never see a key typed here
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !waehlerOffen && !e.isComposing && e.target?.tagName !== 'SELECT' && e.target !== d.abbruch && e.target?.tagName !== 'BUTTON') { e.preventDefault(); los(); }
      e.stopPropagation();
    });
    // Escape in the folder picker closes the picker only: its capture listener stops the key; should the browser still raise the native cancel, it is held here
    dlg.addEventListener('cancel', (e) => { if (waehlerOffen) e.preventDefault(); });
    // the dialog closes with the picker open (another project was opened): the picker goes too, or its Escape listener would outlive it
    dlg.addEventListener('close', () => { dlg.querySelector('.b-dialog-huelle')?.click(); });
    (document.body ?? document.documentElement).append(dlg);
  }
  function oeffne() {
    if (!dlg) baue();
    if (dlg.open) return;
    z = lade(); eigeneZeilen = z.vorgabe === 'eigen' ? kopie(z.zeilen) : null; beschaeftigt = false;
    d.bereich.textContent = bereichText(st.projekt);
    d.ausklang.value = String(z.ausklang_beats); d.ziel.value = z.ziel; d.mitMeta.checked = z.mit_meta;
    for (const k of META_FELDER) { d[k].value = z.meta[k]; d[k].classList.remove('fehler'); d[k].removeAttribute('aria-invalid'); }
    d.titel.placeholder = st.projekt?.name || 'Title';
    d.meldung.textContent = '';
    zeigeModus(); zeigeOrdner(); sperre();   // zeigeModus fills the preset list, sets it and draws the rows
    dlg.showModal();
    d.start.focus();
    pruefeOrdner();
  }
  ctx.vorBild.push(() => { if (dlg?.open) sperre(); });
  ctx.beimProjekt.push((p, wechsel) => { if (wechsel && dlg?.open) dlg.close(); });
  return { oeffne };
}
