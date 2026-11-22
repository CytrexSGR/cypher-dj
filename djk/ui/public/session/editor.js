// Clip editor of the loop deck pop-up (V5, D15): the properties of the selected cell and the editor with its inner tab bar. The inner tabs are a
// registry: `registriereTab(name, { passt(zelle), baue(wurzel, ctx) })` is the hook lane E uses for SLICES, WARP and ENVELOPES; in S1 only CLIP
// is registered. A pure view: the writes are passed in by the host (ctx.schreibeZelle -> POST /loopdeck/zelle, ctx.aendere -> POST /proj/aendern);
// each answers a truthy value when the write was taken. ctx.sende(weg, daten) is the generic write
// of the S1b tabs (answer { ok, ... } or { ok: false, text }), ctx.waehle(spur_id, zelle) selects a cell.
import { FARBEN, RASTER } from '../loopdeck/model.js';
import { daumen } from './waves.js';
import { scheibenTab } from './editor_scheiben.js';
import { warpTab } from './editor_warp.js';
import { huellenTab } from './editor_hulls.js';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const taste = (klasse, text, titel) => { const b = el('button', klasse, text); b.type = 'button'; b.setAttribute('type', 'button'); if (titel) b.title = titel; return b; };
const SPAETER_S5 = 'comes with slice S5';
const GRID = [[null, 'GLOBAL'], ...RASTER.map(([w, t]) => [w, w === '4takte' ? '4 BARS' : t])];
const zahlText = (n, stellen = 1) => (Number.isFinite(n) ? String(Math.round(n * 10 ** stellen) / 10 ** stellen) : '');

// ---------- registry ----------
const tabs = [];
export function registriereTab(name, def) {
  const i = tabs.findIndex((t) => t.name === name);
  if (i >= 0) tabs[i] = { name, ...def }; else tabs.push({ name, ...def });
}
export const registrierteTabs = () => tabs.map((t) => t.name);

let instanz = null;   // the editor built last: the module-level zeigeZelle talks to it
export function zeigeZelle(spalte, index) { instanz?.zeigeZelle(spalte, index); }

// A text or number field that commits on Enter or blur once, Escape puts the old text back.
function feld(klasse, wert, beiWert, { art = 'text', titel = '', min, max, schritt, aus = false } = {}) {
  const e = el('input', klasse); e.type = art; e.setAttribute('type', art); e.value = wert; if (titel) e.title = titel;
  if (min !== undefined) e.min = String(min); if (max !== undefined) e.max = String(max); if (schritt !== undefined) e.step = String(schritt);
  if (aus) { e.disabled = true; return e; }
  let alt = wert;
  const commit = async () => {   // a refusal (the write returns null or false) puts the old text back
    if (e.value === alt) return;
    const vorher = alt; alt = e.value;
    const r = await beiWert(e.value);
    if (r === null || r === false) { alt = vorher; e.value = vorher; }
  };
  e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(); else if (ev.key === 'Escape') e.value = alt; });
  e.addEventListener('blur', commit);
  return e;
}
const zeile = (label, ...inhalt) => { const r = el('div', 'pr'); r.append(el('label', '', label), ...inhalt); return r; };
function segment(optionen, aktiv, beiWahl, klasse, aus = null) {
  const s = el('div', `seg ${klasse}`);
  for (const [wert, text] of optionen) {
    const b = taste('seg-b', text, aus ?? ''); b.dataset.wert = wert === null ? 'null' : String(wert);
    if (aus) b.disabled = true; else b.addEventListener('click', () => beiWahl(wert));
    b.classList.toggle('an', wert === aktiv); b.setAttribute('aria-pressed', String(wert === aktiv));
    s.append(b);
  }
  return s;
}
function farben(aktiv, beiWahl) {
  const p = el('div', 'pr-farben');
  FARBEN.forEach((f, i) => {
    const s = taste('pr-swatch', '', `Colour ${i + 1}`); s.dataset.farbe = String(i); s.style.setProperty('--cf', f);
    s.classList.toggle('an', i === aktiv); s.addEventListener('click', () => beiWahl(i));
    p.append(s);
  });
  return p;
}

// ---------- the CLIP tab ----------
registriereTab('CLIP', {
  passt: (z) => !!z,
  baue(wurzel, ctx) {
    const z = ctx.zelle;
    const transponierbar = z.art !== 'einmal' && z.keylock !== false;   // transpose rides on the keylock pass
    const kopf = el('div', 'ed-zeile');
    kopf.append(
      zeile('GAIN', feld('ed-gain', zahlText(z.gain_db ?? 0), (w) => { const n = Number(w); if (Number.isFinite(n)) ctx.schreibe({ gain_db: Math.max(-60, Math.min(12, n)) }); },
        { art: 'number', min: -60, max: 12, schritt: 0.5, titel: 'Cell gain in dB' }), el('span', 'ed-einheit', 'dB')),
      zeile('TRANSPOSE', feld('ed-transponieren', String(z.transponieren ?? 0), (w) => {
        const n = Math.round(Number(w));
        if (!Number.isFinite(n)) return false;
        return ctx.sendeZelle({ transponieren: n === 0 ? null : Math.max(-24, Math.min(24, n)) });
      }, { art: 'number', min: -24, max: 24, schritt: 1, aus: !transponierbar, titel: transponierbar ? 'Transpose in semitones' : 'needs keylock' }), el('span', 'ed-einheit', 'st')),
      zeile('START', el('b', 'ed-start', '1.1.1')),
      zeile('LOOP', feld('ed-loop-laenge', zahlText(z.beats, 2), (w) => { const n = Number(w); if (Number.isFinite(n) && n > 0) ctx.schreibe({ beats: n }); },
        { art: 'number', min: 0.25, max: 64, schritt: 0.25, titel: 'Loop length in beats' }), el('span', 'ed-einheit', 'beats')),
    );
    const schalter = el('div', 'ed-zeile');
    for (const [feldName, text, klasse] of [['rueckwaerts', 'REVERSE', 'ed-rueckwaerts'], ['blende', 'FADE', 'ed-blende']]) {
      const an = z[feldName] === true, b = taste(`ed-schalter ${klasse}`, text, feldName === 'blende' ? 'Fade at launch and at the loop seam' : 'Play backwards');
      b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an));
      b.addEventListener('click', () => ctx.sendeZelle({ [feldName]: an ? null : true }));
      schalter.append(b);
    }
    const wv = el('div', 'ed-welle'); wv.dataset.sha = z.sha256 ?? '';
    const schleife = el('i', 'ed-schleife'); schleife.title = 'Loop range';
    wv.append(schleife);
    if (z.art !== 'einmal') for (let i = 1; i < 8; i++) { const m = el('i', 'ed-marke'); m.style.left = `${i / 8 * 100}%`; m.dataset.slice = String(i + 1); wv.append(m); }
    if (z.sha256) daumen(z.sha256, 480, 70).then((k) => { if (k && wv.isConnected !== false) wv.prepend(k); }, () => {});
    wurzel.append(kopf, schalter, wv);
  },
});

// the tabs of lane E, in the order of the bar: CLIP first, then the S1b tabs
registriereTab('SLICES', scheibenTab);
registriereTab('WARP', warpTab);
registriereTab('ENVELOPES', huellenTab);

// ---------- the editor ----------
export function baueEditor(wurzel, ctx) {
  const props = el('div', 'props'), ed = el('div', 'ed');
  wurzel.append(props, ed);
  let auswahl = null, signatur = '', innen = 'CLIP';
  // The view of the cell being edited: its scroll position and the state each tab keeps (pad page ...). A redraw of the same cell and tab (every
  // write ends in one) keeps both; another cell, or another tab, starts at the top.
  let ansicht = { schluessel: '', scroll: 0, scrollTab: '', zustand: {} };

  const leer = (text) => { const p = el('div', 'ed-leer', text); return p; };
  // The redraw lock is for fields where text is being typed; a focused button (GRID, a colour) must not freeze the editor.
  const textFeld = (a) => {
    const t = String(a.tagName ?? '').toUpperCase(), art = String(a.type ?? a.getAttribute?.('type') ?? 'text').toLowerCase();
    if (t === 'TEXTAREA') return true;
    if (t === 'INPUT') return ['text', 'number', 'search', 'email', 'url', 'tel', 'password', ''].includes(art);
    const ce = a.getAttribute?.('contenteditable');
    return ce !== null && ce !== undefined && ce !== 'false';
  };
  const fokus = () => { const a = globalThis.document?.activeElement; return !!a && a !== globalThis.document.body && (props.contains?.(a) || ed.contains?.(a)) && textFeld(a); };

  function zeichneZelle(spalte, index) {
    const z = spalte.zellen?.[index - 1];
    const schluessel = `${spalte.spur_id}/${index}`;
    const koerperAlt = ed.querySelector?.('.ed-koerper');
    if (schluessel === ansicht.schluessel) { if (koerperAlt) { ansicht.scroll = koerperAlt.scrollTop ?? 0; ansicht.scrollTab = innen; } }
    else ansicht = { schluessel, scroll: 0, scrollTab: '', zustand: {} };
    props.replaceChildren(); ed.replaceChildren();
    if (!z || typeof z !== 'object' || z.halten) { props.append(leer('Empty cell')); ed.append(leer('Empty cell')); return; }
    const schreibe = (felder) => ctx.schreibeZelle(spalte, index, felder);
    const kopf = el('h3', 'pr-kopf'); const chip = el('i', 'pr-chip'); chip.style.setProperty('--cf', FARBEN[z.farbe] ?? FARBEN[0]);
    kopf.append(chip, el('span', 'pr-titel', `${spalte.kurz ?? ''} · cell ${index}`));
    props.append(kopf,
      zeile('NAME', feld('pr-name', z.name ?? '', (w) => schreibe({ name: w.trim().slice(0, 64) }), { titel: 'Cell name' })),
      zeile('COLOUR', farben(Number.isInteger(z.farbe) ? z.farbe : 0, (i) => schreibe({ farbe: i }))),
      zeile('GRID', segment(GRID, z.raster ?? null, (w) => ctx.aendere(`Set cell grid`, [{ befehl: 'zelle_aendern', spur_id: spalte.spur_id, index, raster: w }]), 'pr-raster')),
      zeile('LENGTH', feld('pr-laenge', zahlText(z.beats, 2), (w) => { const n = Number(w); if (Number.isFinite(n) && n > 0) schreibe({ beats: n }); },
        { art: 'number', min: 0.25, max: 64, schritt: 0.25, titel: 'Cell length in beats' }), el('span', 'ed-einheit', 'beats')),
      zeile('LAUNCH', segment([['trigger', 'TRIGGER'], ['gate', 'GATE'], ['toggle', 'TOGGLE']], 'trigger', null, 'pr-start', SPAETER_S5)),
      zeile('THEN', segment([['loop', 'LOOP'], ['next', 'NEXT'], ['stop', 'STOP']], 'loop', null, 'pr-dann', SPAETER_S5)),
    );
    // sende(weg, daten): a POST of the page server with this cell's spur_id and zelle added; the host answers { ok, ... } or { ok: false, text },
    // a refusal is shown here. sendeZelle(felder): /session/zelle. Both resolve the answer, or null when refused (a field then puts its old text back).
    const sende = async (weg, daten = {}) => {
      if (!ctx.sende) return null;
      const r = await ctx.sende(weg, { spur_id: spalte.spur_id, zelle: index, ...daten });
      if (!r || r.ok === false) { ctx.melde?.(r?.text ?? `${weg} refused`, true); return null; }
      return r;
    };
    innenTabs(z, { zustand: ansicht.zustand, zelle: z, spalte, index, schreibe, sende, sendeZelle: (felder) => sende('/session/zelle', felder), melde: ctx.melde, waehle: ctx.waehle });
  }

  function innenTabs(z, c) {
    const passend = tabs.filter((t) => t.passt(z));
    if (!passend.some((t) => t.name === innen)) innen = passend[0]?.name ?? '';
    const leiste = el('div', 'tabs ed-tabs');
    for (const t of passend) {
      const b = taste('ed-tab', t.name); b.dataset.tab = t.name; b.classList.toggle('an', t.name === innen);
      b.addEventListener('click', () => { innen = t.name; ansicht.scroll = 0; ansicht.scrollTab = ''; ed.replaceChildren(); innenTabs(z, c); });
      leiste.append(b);
    }
    const koerper = el('div', 'ed-koerper');
    ed.replaceChildren(leiste, koerper);
    c.zustand = c.zustand ?? {};
    passend.find((t) => t.name === innen)?.baue(koerper, { ...c, zustand: (c.zustand[innen] ??= {}) });
    if (ansicht.scrollTab === innen && ansicht.scroll) koerper.scrollTop = ansicht.scroll;
  }

  // `wahl`: { spalte, index } | null. A redraw with the same content is skipped, and never while a field of the editor has the focus.
  function zeige(wahl, erzwingen = false) {
    auswahl = wahl;
    const sig = !wahl ? '' : JSON.stringify(['z', wahl.spalte.spur_id, wahl.index, wahl.spalte.zellen?.[wahl.index - 1] ?? null, wahl.spalte.kurz]);
    if (!erzwingen && (sig === signatur || fokus())) return;
    signatur = sig;
    if (!wahl) { props.replaceChildren(leer('Select a cell')); ed.replaceChildren(leer('Select a cell')); return; }
    zeichneZelle(wahl.spalte, wahl.index);
  }
  zeige(null, true);

  const api = { zeige, zeigeZelle: (spalte, index) => zeige({ spalte, index }, true), auswahl: () => auswahl, props, ed };
  instanz = api;
  return api;
}
