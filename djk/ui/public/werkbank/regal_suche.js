// Workbench shelf: one search over everything (media browser B4). A field above the tabs; while it has text the shelf shows the hits of GET /suche
// grouped by kind (a heading with the count, up to five rows, "show all <n>") instead of the tab. The rows are the ones the tabs draw
// (regal.js hands in one builder per kind), so preview, star, TO TRACK, DELETE behave as in the tab. All class names carry the prefix w-such-.
import { istTextFeld } from '../production/history_display.js';

export const SUCHE_TEXT = {
  platzhalter: '🔍 Search everything: kick, hall, bass, …',
  hinweis: 'Searches samples, loops, instruments, devices, presets, modules and cuts at once · / focuses the field · Escape clears it',
  passt: 'FITS',
  passtTitel: 'Only catalogue samples and loops that fit the running music: tempo within 6 percent of the module (or half, or double) and a key next to its key',
  passtKein: 'Open a module first: FITS follows its tempo and key',
  liest: 'Searching…',
  nichts: 'Nothing found',
  alle: (n) => `show all ${n}`,
  gedeckelt: (je, n) => `The first ${je} of ${n}: narrow the search`,
  katalogFehlt: 'The sample catalogue is not available right now',
  quelleFehlt: 'This part of the search could not be read; the other groups are complete',
  netz: 'The search did not answer',
};
export const SUCH_MS = 250;
const JE = 5, JE_ALLE = 50;
const SPEICHER_PASST = 'djk-wb-regal-passt';
// the group of a kind that shows its hits as cards (like the shelf tabs MODULES and CUTS)
const KARTEN = new Set(['module', 'schnitte']);

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const markiere = (e, name) => { e.setAttribute('data-w', name); return e; };
const fehlerText = (code) => (code === 'katalog_fehlt' ? SUCHE_TEXT.katalogFehlt : SUCHE_TEXT.quelleFehlt);

// A row for a hit the tabs have no row for (Baukasten instruments, effect devices, presets): name and one line of facts. Nothing to press: the shelf
// has no action for them (they are placed in PRODUCTION).
export function infoZeile(art, t) {
  const r = markiere(el('div', 'w-such-zeile'), 'suche-info');
  const info = art === 'presets'
    ? [t.geraet, t.herkunft === 'werk' ? 'factory' : 'user', ...(Array.isArray(t.tags) ? t.tags.slice(0, 3) : [])]
    : [t.kategorie, t.text];
  r.setAttribute('title', String(t.name ?? ''));
  r.append(el('span', 'w-such-name', String(t.name ?? '')), el('span', 'w-such-info', info.filter((x) => typeof x === 'string' && x !== '').join(' · ')));
  return r;
}

// opt.kopf: the element that takes the field and the FITS toggle; opt.host: where the groups are drawn; opt.tabHost: the tab content (hidden while searching);
// opt.bauer: {art: (hit) => element|null} for samples, loops, instrumente (stored sampler instruments), module, schnitte; the other hits get infoZeile;
// opt.zeigeAlle(art, q, passt): true when the kind has a tab with a search field of its own and moved there (the search view is left; with FITS on it stays: the tab has no FITS);
// opt.eingeblendet(): the shelf is open (the `/` and Escape keys do nothing in a closed drawer); opt.beiAus(): the search view was left;
// opt.imRegal(el): the element is inside the shelf (Escape clears the search while the focus is there; default: the field and the hits);
// opt.knoepfe(): the buttons of the drawn rows take the state of the open module again; opt.stopp(): a running preview ends.
export function bindeSuche(ctx, { kopf, host, tabHost, bauer, zeigeAlle = () => false, eingeblendet = () => true, imRegal = null, beiAus = () => {}, knoepfe = () => {}, stopp = () => {} }) {
  const { st } = ctx;
  let q = '', nr = 0, uhr = null, aktiv = false, gruppen = [], laedt = false, fehlerNetz = false;
  let passt = ctx.lies(SPEICHER_PASST, '0') === '1';
  const erweitert = new Set();   // the kinds shown with up to 50 hits (kept while the query text stays)
  const offen = new Set();       // the kinds whose "show all" is on its way

  const feld = markiere(el('input', 'w-such-feld'), 'suche-feld');
  feld.setAttribute('placeholder', SUCHE_TEXT.platzhalter); feld.setAttribute('aria-label', 'Search the shelf'); feld.setAttribute('maxlength', '120');
  feld.setAttribute('title', SUCHE_TEXT.hinweis);
  host.setAttribute('tabindex', '-1'); host.style.outline = 'none';   // a click on a row that takes no focus itself leaves the focus in the hits: Escape still reaches the search
  const inRegal = (z) => (imRegal ? imRegal(z) : kopf.contains(z) || host.contains(z));
  const knopf = markiere(el('button', 'w-such-passt', SUCHE_TEXT.passt), 'suche-passt'); knopf.type = 'button';
  kopf.append(feld, knopf);
  // FITS counts only while a module is open (the server has nothing to fit to without one): the toggle and the query both use this
  const passtAn = () => passt && !!st.projekt;
  let angefragtPasst = false;   // what the last query asked for
  const zeigePasst = () => {
    knopf.classList.toggle('an', passtAn()); knopf.setAttribute('aria-pressed', String(passtAn()));
    knopf.disabled = !st.projekt;
    knopf.setAttribute('title', st.projekt ? SUCHE_TEXT.passtTitel : SUCHE_TEXT.passtKein);
  };
  zeigePasst();

  const url = (art = null) => `/suche?q=${encodeURIComponent(q)}&passt=${passtAn() ? 1 : 0}${art ? `&arten=${art}&je=${JE_ALLE}` : `&je=${JE}`}`;

  // ---- drawing ----
  const zeile = (art, t) => {
    const eigene = art === 'instrumente' ? typeof t.id === 'string' : art === 'samples' || art === 'loops' || art === 'module' || art === 'schnitte';
    return (eigene ? bauer[art]?.(t, host) : null) ?? infoZeile(art, t);
  };
  function zeichneGruppe(g) {
    const sicht = markiere(el('div', 'w-such-gruppe'), 'suche-gruppe'); sicht.setAttribute('data-art', g.art);
    const kopfzeile = el('div', 'w-such-gruppenkopf');
    kopfzeile.append(markiere(el('span', 'w-such-titel', `${String(g.name).toUpperCase()} ${g.zahl.toLocaleString('en')}`), 'suche-titel'));
    if (g.treffer.length < g.zahl && !g.fehler) {
      const alle = markiere(el('button', 'w-such-alle', SUCHE_TEXT.alle(g.zahl)), 'suche-alle'); alle.type = 'button'; alle.setAttribute('data-art', g.art);
      alle.addEventListener('click', () => zeigeAlleVon(g.art));
      kopfzeile.append(alle);
    }
    sicht.append(kopfzeile);
    if (g.fehler) { sicht.append(markiere(el('div', 'w-such-leer', fehlerText(g.fehler)), 'suche-fehler')); return sicht; }
    if (g.treffer.length === 0) { sicht.append(el('div', 'w-such-leer', SUCHE_TEXT.nichts)); return sicht; }
    const zeilen = el('div', KARTEN.has(g.art) ? 'w-such-karten' : 'w-such-zeilen');
    for (const t of g.treffer) zeilen.append(zeile(g.art, t));
    sicht.append(zeilen);
    if (g.treffer.length < g.zahl && erweitert.has(g.art)) sicht.append(el('div', 'w-such-leer', SUCHE_TEXT.gedeckelt(g.treffer.length, g.zahl)));
    return sicht;
  }
  // a group that cannot be drawn (a hit without its count, a row builder that throws) shows the error line of a failed group; the others stay
  function zeichneSicher(g) {
    try { return zeichneGruppe(g); } catch {
      const sicht = markiere(el('div', 'w-such-gruppe'), 'suche-gruppe'); sicht.setAttribute('data-art', String(g?.art ?? ''));
      const kopfzeile = el('div', 'w-such-gruppenkopf');
      kopfzeile.append(markiere(el('span', 'w-such-titel', String(g?.name ?? g?.art ?? '').toUpperCase()), 'suche-titel'));
      sicht.append(kopfzeile, markiere(el('div', 'w-such-leer', fehlerText('suche_quelle')), 'suche-fehler'));
      return sicht;
    }
  }
  // the rows are replaced as a whole: a focus on one of them would fall to the page, so it goes back to the field
  function setze(kinder) {
    const ac = document.activeElement;
    const hatteFokus = !!ac && ac !== feld && host.contains(ac);
    host.replaceChildren(...kinder);
    if (hatteFokus) feld.focus?.();
  }
  function zeichne() {
    if (fehlerNetz && gruppen.length === 0) { setze([el('div', 'w-such-leer', SUCHE_TEXT.netz)]); return; }
    if (laedt && gruppen.length === 0) { setze([el('div', 'w-such-leer', SUCHE_TEXT.liest)]); return; }
    // a kind with hits first would reorder the groups under the eye: the order is the server's (samples ... cuts), empty ones stay as a heading
    const sichtbar = gruppen.length ? gruppen.map(zeichneSicher) : [el('div', 'w-such-leer', SUCHE_TEXT.nichts)];
    if (fehlerNetz) sichtbar.unshift(el('div', 'w-such-leer', SUCHE_TEXT.netz));   // part of the answer did not come
    setze(sichtbar);
    try { knoepfe(); } catch { /* a row that cannot take the module state stays as it is */ }
  }

  // ---- loading: an answer to an older query never overwrites a newer one ----
  // One loader for everything, so no reply can invalidate another: the first page of every kind (je=5) and, in parallel, the kinds that are
  // open (erweitert) or were just asked for (offen) with up to 50 hits. A newer load makes the older one's replies void.
  async function lade() {
    const mein = ++nr;
    angefragtPasst = passtAn();
    laedt = true; fehlerNetz = false;
    try {
      if (gruppen.length === 0) zeichne();
      const arten = [...new Set([...erweitert, ...offen])];
      const [r, ...mehr] = await Promise.all([ctx.holeGet(url()), ...arten.map((a) => ctx.holeGet(url(a)))]);
      if (mein !== nr) return;
      if (r.status !== 200 || !Array.isArray(r.j?.gruppen)) { gruppen = []; erweitert.clear(); offen.clear(); fehlerNetz = true; return; }
      gruppen = r.j.gruppen;
      arten.forEach((art, i) => {
        const neu = mehr[i].status === 200 && Array.isArray(mehr[i].j?.gruppen) ? mehr[i].j.gruppen.find((x) => x?.art === art) : null;
        if (neu) { erweitert.add(art); gruppen = gruppen.map((g) => (g?.art === art ? neu : g)); }
        else { erweitert.delete(art); fehlerNetz = true; }   // the hits drawn stay, the line above them says the rest did not come
      });
      offen.clear();
    } finally {
      if (mein === nr) { laedt = false; zeichne(); }
    }
  }
  const ladeAlle = (art) => { offen.add(art); return lade(); };
  function zeigeAlleVon(art) {
    const frage = q;
    if (zeigeAlle(art, frage, passtAn())) { leere(); return; }
    ladeAlle(art);
  }

  // ---- entering and leaving the search view ----
  function betreten() {
    if (aktiv) return;
    aktiv = true; gruppen = [];
    tabHost.hidden = true; host.hidden = false;
  }
  function verlasse() {
    nr++; laedt = false;   // an answer on its way is for a query nobody asks any more
    clearTimeout(uhr); uhr = null;
    q = ''; gruppen = []; erweitert.clear(); offen.clear();
    if (!aktiv) return;
    stopp();
    aktiv = false;
    host.hidden = true; host.replaceChildren(); tabHost.hidden = false;
    beiAus();
  }
  function leere() { feld.value = ''; verlasse(); }
  function sucheJetzt() {
    clearTimeout(uhr); uhr = null;
    const neu = feld.value.trim();
    if (neu === '') { verlasse(); return; }
    if (neu === q && aktiv && !fehlerNetz) return;   // the same text asks again only when the last answer failed
    if (neu !== q) { erweitert.clear(); offen.clear(); }
    q = neu; betreten(); lade();
  }
  feld.addEventListener('input', () => { clearTimeout(uhr); uhr = setTimeout(sucheJetzt, ctx.suchMs ?? SUCH_MS); uhr?.unref?.(); });
  feld.addEventListener('keydown', (ev) => {
    ev.stopPropagation?.();   // the keys of the page stay out of the field
    if (ev.key === 'Escape') { leere(); }
    else if (ev.key === 'Enter') sucheJetzt();
  });
  knopf.addEventListener('click', () => {
    if (knopf.disabled) return;
    passt = !passt; ctx.merke(SPEICHER_PASST, passt ? '1' : '0'); zeigePasst();
    if (aktiv) lade();
  });
  ctx.beimProjekt.push(() => {
    zeigePasst();
    if (!aktiv) return;
    if (passtAn() !== angefragtPasst) lade();   // a module opened or closed while FITS is on: the hits change with it
    else knoepfe();
  });

  return {
    // the search view draws again with the same query (a card changed something it shows)
    neu() { if (aktiv && q !== '') lade(); },
    aktiv: () => aktiv,
    // `/` focuses the field when no input has the focus; returns true when it did
    taste(ev) {
      if (ev?.key === 'Escape') {
        // Escape leaves the search view from anywhere in the shelf (the field handles its own Escape); not from another text field, not from elsewhere on the page
        const z = document.activeElement;
        if (ev.ctrlKey || ev.metaKey || ev.altKey || !aktiv || !st.sichtbar || !eingeblendet() || !z || z === feld || istTextFeld(z) || !inRegal(z)) return false;
        ev.preventDefault?.(); leere();
        return true;
      }
      if (ev?.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
      if (!st.sichtbar || !eingeblendet() || istTextFeld(ev.target) || istTextFeld(document.activeElement)) return false;
      ev.preventDefault?.(); feld.focus?.();
      return true;
    },
    leere,
  };
}
