// Shelf tab SAMPLES, mode LIBRARY: the sample catalog (GET /stoebern) with a text search, one button per instrument class, reachable files
// first (the server orders them), missing disks named. Preview and TO TRACK go by the catalog sha. All class names carry the prefix w-kat-.
import { naechsteZeile } from './regal_samples.js';
import { spurAusSha } from './catalog_storage.js';
import { sternKnopf } from '../usage.js';
import { ZIEH_TYP, nutzlast } from '../production/drag.js';

export const KATALOG_TEXT = {
  hint: 'click plays a sample · arrow keys move and play · Enter or TO TRACK puts it on a new track · drag it onto TRACKS, or onto a row of a kit track',
  alle: 'ALL',
  andere: 'OTHER',
  fehltZeile: 'Not reachable: its disk or folder is missing',
  platte: (name, n) => `${name}: disk not mounted · ${n.toLocaleString('en')} samples not reachable`,
  katalogFehlt: 'The sample catalog is not available right now. FOLDERS still works.',
  leer: 'Nothing found',
  mehr: 'MORE',
  liest: 'Reading…',
  keinModul: 'Open a module first.',
  spurTitel: 'Put this sample on a new instrument track that plays it across the keys',
  vorhoerFehler: 'This file cannot be previewed',
  keinAudio: 'Preview is not available in this browser',
};
export const KATALOG_SPEICHER = 'djk-wb-regal-katalog';
const SUCH_MS = 300;
const ALLE = '*';   // data-wert of the ALL button; the empty value belongs to OTHER

// the remembered state {modus, instrument}; instrument: null = ALL, '' = OTHER
export function leseKatalogStand(ctx) {
  try { const j = JSON.parse(ctx.lies(KATALOG_SPEICHER, 'null')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
export function schreibeKatalogStand(ctx, teil) { ctx.merke(KATALOG_SPEICHER, JSON.stringify({ ...leseKatalogStand(ctx), ...teil })); }

// --- pure helpers ---
export function katalogUrl({ text = '', instrument = null, seite = 0 } = {}) {
  let u = '/stoebern?typ=oneshot&schutz=aus&vorrang=1&limit=100';
  if (text) u += `&text=${encodeURIComponent(text)}`;
  if (typeof instrument === 'string') u += `&feld=instrument&wert=${encodeURIComponent(instrument)}`;
  if (seite > 0) u += `&seite=${seite}`;
  return u;
}
// ALL first, then the facet entries in served order; the empty value reads OTHER
export function instrumentKnoepfe(baum) {
  const f = Array.isArray(baum?.facetten?.instrument) ? baum.facetten.instrument : [];
  return [{ wert: null, text: KATALOG_TEXT.alle }, ...f.filter((x) => x && typeof x.wert === 'string' && typeof x.n === 'number')
    .map((x) => ({ wert: x.wert, n: x.n, text: `${x.wert === '' ? KATALOG_TEXT.andere : x.wert.toUpperCase()} ${x.n.toLocaleString('en')}` }))];
}
export function fehlendeQuellen(quellen) {
  return (Array.isArray(quellen) ? quellen : []).filter((q) => q && q.da === false && typeof q.name === 'string')
    .map((q) => KATALOG_TEXT.platte(q.name, typeof q.n === 'number' ? q.n : 0));
}

// The folder of a file for the row: the last part of `ordner`, the last two when the last says nothing (no word of three letters, like "4'" or "01").
// Cut in the middle past ORDNER_MAX. A known source replaces the absolute prefix: "Source/…/Folder"; the title is the whole logical place.
const ORDNER_MAX = 34;
const mitteKuerzen = (t) => (t.length <= ORDNER_MAX ? t : `${t.slice(0, Math.ceil((ORDNER_MAX - 1) / 2))}…${t.slice(t.length - Math.floor((ORDNER_MAX - 1) / 2))}`);
export function ordnerKurz(ordner, quellen = []) {
  if (typeof ordner !== 'string' || ordner === '') return { text: '', title: '' };
  let rest = ordner, name = null, best = -1;
  for (const q of Array.isArray(quellen) ? quellen : []) {
    if (typeof q?.pfad !== 'string' || typeof q.name !== 'string' || q.pfad === '') continue;
    const pf = q.pfad.replace(/\/+$/, '');
    if ((ordner === pf || ordner.startsWith(`${pf}/`)) && pf.length > best) { best = pf.length; name = q.name; rest = ordner.slice(pf.length); }
  }
  const teile = rest.split('/').filter((x) => x !== '');
  const sagt = (x) => /\p{L}{3,}/u.test(x);
  const n = teile.length > 1 && !sagt(teile[teile.length - 1]) ? 2 : 1;
  const hinten = teile.slice(-n).join('/');
  const kurz = name === null ? hinten : teile.length > n ? `${name}/…/${hinten}` : teile.length ? `${name}/${hinten}` : name;
  return { text: mitteKuerzen(kurz), title: name === null ? ordner : [name, ...teile].join('/') };
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const markiere = (e, name) => { e.setAttribute('data-w', name); return e; };
const dauerText = (s) => (typeof s === 'number' && Number.isFinite(s) ? `${s.toFixed(1)} s` : '');

// --- the binder ---
export function bindeKatalog(ctx, { host, setzeHinweis = () => {}, refusalText = (r) => ctx.antwortText(r) }) {
  const { st } = ctx;
  const hinweisNormal = () => setzeHinweis(KATALOG_TEXT.hint);
  let aktiv = false, nr = 0, ladeNr = 0, macht = false, mehrLaeuft = false;
  let text = '', suchUhr = null, seite = 0, gesamt = 0, zeilen = [], cursor = -1, spielt = null;   // spielt: {sha, audio}
  const gemerkt = leseKatalogStand(ctx);
  let instrument = typeof gemerkt.instrument === 'string' ? gemerkt.instrument : null;
  let baum = null, fehler = null, quellenListe = [];

  const wurzelEl = el('div', 'w-kat');
  const kopf = el('div', 'w-kat-kopf');
  const feld = markiere(el('input', 'w-kat-suche'), 'katalog-suche');
  feld.setAttribute('placeholder', '🔍 Search all samples: kick 909, snare, …'); feld.setAttribute('aria-label', 'Search the sample catalog'); feld.setAttribute('maxlength', '80');
  const knoepfe = el('div', 'w-kat-knoepfe');
  kopf.append(feld, knoepfe);
  const platten = el('div', 'w-kat-platten');
  const liste = el('div', 'w-kat-liste');
  liste.setAttribute('tabindex', '0'); liste.setAttribute('role', 'listbox'); liste.setAttribute('aria-label', 'Catalog samples');
  wurzelEl.append(kopf, platten, liste);

  // The search view (regal_suche.js) draws catalogue rows of this binder into its own host: preview marks and the TO TRACK state follow them too.
  const fremde = new Set();
  const alleZeilen = (sel) => [liste, ...fremde].flatMap((h) => [...h.querySelectorAll(sel)]);

  // ---- preview ----
  function stoppe() {
    const s = spielt; spielt = null;
    if (s) { try { s.audio.pause?.(); } catch { /* already gone */ } }
    markiereSpielt();
  }
  function markiereSpielt() {
    for (const z of alleZeilen('[data-w="katalog-datei"]')) {
      const an = spielt !== null && z.getAttribute('data-sha') === spielt.sha;
      z.classList.toggle('spielt', an);
      const m = z.querySelector('.w-kat-marke');
      if (m) m.textContent = an ? '■' : '▶';
    }
  }
  function spiele(z) {
    if (z.pfad_da !== true) { setzeHinweis(KATALOG_TEXT.fehltZeile); return; }
    if (spielt?.sha === z.sha) { stoppe(); hinweisNormal(); return; }   // a second click stops it
    stoppe(); hinweisNormal();
    const Audio_ = ctx.Audio ?? globalThis.Audio;
    if (typeof Audio_ !== 'function') { setzeHinweis(KATALOG_TEXT.keinAudio); return; }
    let audio;
    try { audio = new Audio_(`/sampler/datei/hoer?sha=${encodeURIComponent(z.sha)}`); } catch { setzeHinweis(KATALOG_TEXT.vorhoerFehler); return; }
    const s = { sha: z.sha, audio };
    spielt = s;
    const aus = () => { if (spielt === s) { spielt = null; markiereSpielt(); } };
    const fehlschlag = () => { aus(); setzeHinweis(KATALOG_TEXT.vorhoerFehler); };
    audio.addEventListener?.('error', fehlschlag);
    audio.addEventListener?.('ended', aus);
    try { const p = audio.play?.(); if (p && typeof p.catch === 'function') p.catch((e) => { if (e?.name !== 'AbortError') fehlschlag(); }); } catch { fehlschlag(); }
    markiereSpielt();
  }

  // ---- TO TRACK ----
  const zeigeKnoepfe = () => {
    markiereSpielt();   // rows drawn anew (the search view) take the mark of a running preview too
    for (const b of alleZeilen('[data-w="katalog-spur"]')) {
      b.disabled = !st.projekt || macht;
      b.setAttribute('title', st.projekt ? KATALOG_TEXT.spurTitel : KATALOG_TEXT.keinModul);
    }
  };
  async function zuSpur(z) {
    if (macht || z.pfad_da !== true) return;
    macht = true; zeigeKnoepfe();
    try { await spurAusSha(ctx, z.sha); } finally { macht = false; zeigeKnoepfe(); }
  }

  // ---- drawing ----
  function zeichneKnoepfe() {
    knoepfe.replaceChildren(...instrumentKnoepfe(baum).map((k) => {
      const an = k.wert === instrument;
      const b = el('button', `w-kat-knopf${an ? ' an' : ''}`, k.text); b.type = 'button';
      markiere(b, 'katalog-instrument'); b.setAttribute('data-wert', k.wert === null ? ALLE : k.wert);
      b.addEventListener('click', () => { if (an) return; instrument = k.wert; schreibeKatalogStand(ctx, { instrument }); stoppe(); zeichneKnoepfe(); ladeErste(); });
      return b;
    }));
  }
  function zeichnePlatten(quellen) {
    platten.replaceChildren(...fehlendeQuellen(quellen).map((t) => markiere(el('div', 'w-kat-platte', t), 'katalog-platte')));
  }
  function setzeCursor(i, spiel) {
    cursor = i;
    const rows = liste.querySelectorAll('.w-kat-zeile');
    rows.forEach((r, k) => r.classList.toggle('cursor', k === i));
    rows[i]?.scrollIntoView?.({ block: 'nearest' });
    if (spiel && zeilen[i]) { if (zeilen[i].pfad_da === true && spielt?.sha !== zeilen[i].sha) spiele(zeilen[i]); else if (zeilen[i].pfad_da !== true) stoppe(); }
  }
  // one row of a catalogue sample; `i` is its place in the list of the tab (the cursor), absent for a row of the search view
  function baueZeile(z, i) {
    const da = z.pfad_da === true;
    const r = el('div', `w-kat-zeile${da ? '' : ' fehlt'}`);
    r.setAttribute('role', 'option'); markiere(r, 'katalog-datei'); r.setAttribute('data-sha', z.sha); r.setAttribute('title', z.name);
    r.treffer = z;   // the whole hit stays with the row
    const nutz = nutzlast(z);
    if (nutz) {   // only a reachable, unprotected sample with a length is dragged; its payload is the one PRODUCTION uses
      r.setAttribute('draggable', 'true');
      r.addEventListener('dragstart', (ev) => {
        if (!ev.dataTransfer) return;
        ev.dataTransfer.setData(ZIEH_TYP, JSON.stringify(nutz)); ev.dataTransfer.effectAllowed = 'copy';
      });
      r.addEventListener('dragend', () => { for (const m of document.querySelectorAll('.w-drop')) m.classList.remove('w-drop'); });
    }
    const ord = ordnerKurz(z.ordner, quellenListe);
    const ordEl = el('span', 'w-kat-ordner', ord.text); if (ord.title) ordEl.setAttribute('title', ord.title);
    r.append(el('span', 'w-kat-marke', '▶'), sternKnopf(z, ctx.holeJson, ctx.melde), el('span', 'w-kat-name', z.name), ordEl, el('span', 'w-kat-instr', z.instrument ?? ''),
      el('span', 'w-kat-pack', z.pack ?? ''), el('span', 'w-kat-dauer', dauerText(z.dauer_s)));
    if (da) {
      const b = el('button', 'w-kat-spur', 'TO TRACK'); b.type = 'button'; markiere(b, 'katalog-spur');
      b.addEventListener('click', (ev) => { ev.stopPropagation?.(); zuSpur(z); });
      r.append(b);
    }
    r.addEventListener('click', (ev) => {
      if (ev.target?.closest?.('button')) return;
      if (i !== undefined) setzeCursor(i, false);
      spiele(z);
    });
    return r;
  }
  function zeichneListe(meldungText) {
    if (meldungText !== undefined) { liste.replaceChildren(el('div', 'w-kat-leer', meldungText)); return; }
    const rows = zeilen.map((z, i) => baueZeile(z, i));
    if (zeilen.length < gesamt) {
      const m = el('button', 'w-kat-mehr', KATALOG_TEXT.mehr); m.type = 'button'; markiere(m, 'katalog-mehr');
      m.addEventListener('click', () => { ladeMehr(); });
      rows.push(m);
    }
    if (!zeilen.length) rows.push(el('div', 'w-kat-leer', KATALOG_TEXT.leer));
    liste.replaceChildren(...rows);
    if (cursor >= 0) liste.querySelectorAll('.w-kat-zeile')[cursor]?.classList.add('cursor');
    markiereSpielt(); zeigeKnoepfe();
  }
  const fehlerText = (r) => (r.status === 503 && r.j?.fehler === 'katalog_fehlt' ? KATALOG_TEXT.katalogFehlt : refusalText(r));

  // ---- loading: a newer request wins over an older answer ----
  async function ladeErste() {
    const mein = ++nr;
    seite = 0; cursor = -1; mehrLaeuft = false;
    zeichneListe(KATALOG_TEXT.liest);
    const r = await ctx.holeGet(katalogUrl({ text, instrument, seite: 0 }));
    if (mein !== nr) return;
    if (r.status !== 200 || !Array.isArray(r.j?.treffer)) { zeilen = []; gesamt = 0; fehler = fehlerText(r); zeichneListe(fehler); return; }
    fehler = null; zeilen = r.j.treffer.filter((t) => typeof t?.sha === 'string'); gesamt = typeof r.j.gesamt === 'number' ? r.j.gesamt : zeilen.length;
    zeichneListe();
  }
  async function ladeMehr() {
    if (mehrLaeuft) return;
    mehrLaeuft = true;
    const mein = ++nr, neu = seite + 1;
    const r = await ctx.holeGet(katalogUrl({ text, instrument, seite: neu }));
    if (mein !== nr) return;
    mehrLaeuft = false;
    if (r.status !== 200 || !Array.isArray(r.j?.treffer)) { setzeHinweis(fehlerText(r)); return; }
    const mehr = r.j.treffer.filter((t) => typeof t?.sha === 'string' && !zeilen.some((z) => z.sha === t.sha));
    seite = neu; zeilen = [...zeilen, ...mehr];
    if (typeof r.j.gesamt === 'number') gesamt = r.j.gesamt;
    if (!mehr.length) gesamt = Math.min(gesamt, zeilen.length);   // nothing new came: stop offering MORE
    zeichneListe();
  }
  // facets and sources load once per zeige(); a failure only leaves ALL / no source lines
  async function ladeKopf() {
    const mein = ++ladeNr;
    const [b, q] = await Promise.all([ctx.holeGet('/stoebern/baum?typ=oneshot&schutz=aus'), ctx.holeGet('/stoebern/quellen?typ=oneshot&schutz=aus')]);
    if (mein !== ladeNr) return;
    baum = b.status === 200 ? b.j : null; zeichneKnoepfe();
    quellenListe = q.status === 200 && Array.isArray(q.j?.quellen) ? q.j.quellen : [];
    zeichnePlatten(quellenListe);
    if (zeilen.length && fehler === null) zeichneListe();   // rows drawn before the sources arrived get their source names
  }
  function starte() { ladeKopf(); ladeErste(); }

  // ---- search and keys ----
  const sucheJetzt = () => { clearTimeout(suchUhr); suchUhr = null; const neu = feld.value.trim(); if (neu === text) return; text = neu; stoppe(); ladeErste(); };
  feld.addEventListener('input', () => { clearTimeout(suchUhr); suchUhr = setTimeout(sucheJetzt, ctx.suchMs ?? SUCH_MS); suchUhr?.unref?.(); });
  feld.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { feld.value = ''; sucheJetzt(); }
    else if (ev.key === 'Enter') sucheJetzt();
    else if (ev.key === 'ArrowDown') { ev.preventDefault?.(); liste.focus?.(); setzeCursor(naechsteZeile(zeilen, cursor, 'ArrowDown'), true); }
  });
  liste.addEventListener('keydown', (ev) => {
    if (ev.target?.matches?.('button')) { ev.stopPropagation?.(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault?.(); ev.stopPropagation?.();
      setzeCursor(naechsteZeile(zeilen, cursor, ev.key), true);
    } else if (ev.key === 'Enter') {
      ev.preventDefault?.(); ev.stopPropagation?.();
      const z = zeilen[cursor];
      if (z) zuSpur(z);
    }
  });

  ctx.beimProjekt.push(() => { if (aktiv) zeigeKnoepfe(); });
  ctx.beimSichtwechsel.push((sichtbar) => { if (!sichtbar) stoppe(); else if (aktiv) { host.replaceChildren(wurzelEl); starte(); } });

  zeichneKnoepfe();
  return {
    // the search view: a row of the catalogue sample `z` for `suchHost`, with the preview and TO TRACK of this binder; stoppe ends a running preview
    zeileFuer(z, suchHost) { fremde.add(suchHost); return baueZeile(z); },
    zeigeKnoepfe, stoppe,
    // the query of the tab's own search field ("show all" of the search view); the tab loads it when it is shown
    // (the instrument button goes back to ALL: the tab then shows the same hits as the search did)
    setzeText(t) { feld.value = t; text = t; instrument = null; schreibeKatalogStand(ctx, { instrument }); zeichneKnoepfe(); },
    zeige() {
      aktiv = true; hinweisNormal(); host.replaceChildren(wurzelEl);
      if (st.sichtbar) starte(); else zeichneListe(KATALOG_TEXT.liest);
    },
    verberge() { aktiv = false; stoppe(); setzeHinweis(null); },
  };
}
