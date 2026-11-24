// Workbench region SHELF (plan task 3: the empty state, task 10: the shelf strip below the three columns, sampler A1 task 5: the second tab LOOPS, D13; 2026-11-16: the third tab CUTS). The empty state sits in the `leer` host: the text, one button per
// template, "+ empty module" (a name field, Enter creates) and "Open module…" (a select of the modules). Opening or creating is the person's click and
// goes through ctx.oeffneModul / ctx.neuesModul (live-container confirmation, nothing else). Lists are fetched on show and after a module change.
import { WERKBANK_TEXT } from './werkbank.js';
import { SAMPLES_TEXT } from './regal_samples.js';
import { bindeSamplesReiter } from './regal_samples_modus.js';
import { bindeInstrumente, INSTRUMENTE_TEXT } from './regal_instruments.js';
import { bindeSuche } from './regal_suche.js';
import { datumText, zaehlText } from '../format_text.js';

// liste: GET /proj/liste (an array); vorlagen: GET /proj/werkbank/vorlagen ({vorlagen: [...]}) or the array; slug: the open module.
export function regalEintraege(liste, vorlagen, slug) {
  // a broken entry (fehler) has no marker to read: it is kept so the person sees it, disabled
  const module = (Array.isArray(liste) ? liste : []).filter((x) => x?.werkbank === true || x?.fehler)
    .map((x) => ({
      slug: x.slug, name: x.name, offen: x.slug === slug,
      ...(x.geaendert ? { geaendert: x.geaendert } : {}), ...(x.fehler ? { fehler: x.fehler, text: x.text ?? x.fehler } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const v = Array.isArray(vorlagen) ? vorlagen : Array.isArray(vorlagen?.vorlagen) ? vorlagen.vorlagen : [];
  return { module, vorlagen: v.map(({ id, name, text }) => ({ id, name, text })) };
}

const REGAL_HINT = 'click = open the module · every change is saved at once · SAVE AS keeps a copy under a new name';
const LOOPS_HINT = 'SLICE TO TRACK cuts the loop into slices and puts them on a new track in their original order';
const SCHEIBEN_WAHL = ['auto', 'hits', '4', '8', '16', '32', '64'];   // `auto` sends no `scheiben`: the server picks the grid; `hits` cuts at the hits (method anschlag, no count)
export const MODUL_TEXT = {
  kopie: 'SAVE AS', kopieTitel: 'Save a copy of this module under a new name (the module itself saves every change as you make it)',
  weg: 'DELETE', wegTitel: 'Delete this module (it moves to the bin of the project folder)',
  wegFrage: (name) => `Delete the module "${name}"? It moves to the bin of the project folder and leaves the shelf.`,
  kopiert: (name) => `Saved as ${name}.`,
};
const CUTS_HINT = 'TO TRACK puts a cut on a new track in its original order · DELETE removes a cut that no track plays';
const KEIN_MODUL = 'Open a module first.';
const STUMM = 'This loop is silent: there is nothing to cut';
const FIT_AUS = "Tempo is out of FIT's range: SPEED stays at 1.";
const grossAnfang = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const karteBau = (klasse, name, zeile, marke) => {
  const k = el('button', `w-karte ${klasse}`);
  // the mark is the first line of the card, in normal flow (not w-marke: that is the marker of the cut strip, sound.css draws a line under it)
  if (marke) k.append(el('i', 'w-karte-marke', marke));
  const titel = el('b', '', name); titel.setAttribute('title', name);   // cut with an ellipsis: the full name stays readable
  const z = el('span', '', zeile); if (zeile) z.setAttribute('title', zeile);   // cut with an ellipsis: the full line stays readable
  k.append(titel, z);
  return k;
};

// a function: werkbank.js imports this file and WERKBANK_TEXT is not defined yet while this file is evaluated
const leerGeruest = () => `
<p class="w-leer-text" data-w="leer-text"></p>
<div class="w-vorlagen" data-w="vorlagen"></div>
<div class="w-leer-zeile">
  <button data-w="leer-neu">${WERKBANK_TEXT.leeresModul}</button>
  <input data-w="leer-name" placeholder="${WERKBANK_TEXT.neuerName}" maxlength="60" aria-label="New module name" hidden>
  <select data-w="leer-oeffnen" aria-label="Open module"><option value="">${WERKBANK_TEXT.oeffnen}</option></select>
</div>
`;

export function bindeRegal(ctx) {
  const { st, $ } = ctx;
  const leer = $('leer');
  leer.innerHTML = leerGeruest();
  const zeigeText = () => { $('leer-text').textContent = st.fremd ? WERKBANK_TEXT.keinWerkbank : WERKBANK_TEXT.keinModul; };
  zeigeText();

  // The shelf strip: header (label, the tabs MODULES and LOOPS, hint, the SLICES choice of LOOPS) and the cards. One fetch feeds the strip and the empty state (no second list code).
  const regal = $('regal');
  // the search field sits above the tabs; its hits replace the tab content (the card host) while it has text
  const sucheKopf = el('div', 'w-such-kopf'), sucheHost = el('div', 'w-such-host');
  sucheHost.hidden = true; sucheHost.setAttribute('data-w', 'suche-host');
  regal.replaceChildren(sucheKopf, el('div', 'w-regal-kopf'), el('div', 'w-karten'), sucheHost);
  const kopfZeile = regal.children[1];
  const tabKnopf = (name) => { const b = el('button', 'w-tab', name); b.type = 'button'; return b; };
  const tabModule = tabKnopf('MODULES'), tabLoops = tabKnopf('LOOPS'), tabCuts = tabKnopf('CUTS'), tabSamples = tabKnopf('SAMPLES'), tabInstrumente = tabKnopf('INSTRUMENTS');
  const hinweis = el('span', 'w-hinweis', REGAL_HINT);
  const scheibenLbl = el('span', 'w-lbl-klein', 'SLICES');
  const scheibenWahl = el('select', 'w-scheiben');
  scheibenWahl.setAttribute('data-w', 'regal-scheiben'); scheibenWahl.setAttribute('aria-label', 'SLICES');
  scheibenWahl.setAttribute('title', 'How SLICE TO TRACK cuts: auto picks the finest grid of 1/16 to 1 beat that gives at most 64 slices, hits cuts at the hits of the audio, a number cuts that many equal slices');
  for (const n of SCHEIBEN_WAHL) { const o = el('option', '', n); o.value = n; scheibenWahl.append(o); }
  const gemerkt = ctx.lies('djk-wb-scheiben', 'auto');
  scheibenWahl.value = SCHEIBEN_WAHL.includes(gemerkt) ? gemerkt : 'auto';
  scheibenWahl.addEventListener('change', () => ctx.merke('djk-wb-scheiben', scheibenWahl.value));
  kopfZeile.append(el('span', 'w-lbl', 'SHELF'), tabModule, tabLoops, tabCuts, tabSamples, tabInstrumente, hinweis, scheibenLbl, scheibenWahl);
  const kartenHost = regal.children[2];
  let stand = { liste: null, vorlagen: null };
  let tab = ['loops', 'cuts', 'samples', 'instrumente'].includes(ctx.lies('djk-wb-regal-tab', 'module')) ? ctx.lies('djk-wb-regal-tab', 'module') : 'module';
  const zeigeTab = () => {
    tabModule.classList.toggle('on', tab === 'module'); tabLoops.classList.toggle('on', tab === 'loops'); tabCuts.classList.toggle('on', tab === 'cuts');
    tabSamples.classList.toggle('on', tab === 'samples'); tabInstrumente.classList.toggle('on', tab === 'instrumente');
    const innen = tab === 'samples' || tab === 'instrumente';   // both tabs scroll their own list inside the shelf
    regal.classList.toggle('w-smp-an', innen); kartenHost.classList.toggle('w-smp-host', innen); sucheHost.classList.toggle('w-such-innen', innen);
    hinweis.textContent = tab === 'loops' ? LOOPS_HINT : tab === 'cuts' ? CUTS_HINT : tab === 'samples' ? SAMPLES_TEXT.hint : tab === 'instrumente' ? INSTRUMENTE_TEXT.hint : REGAL_HINT;
    scheibenLbl.hidden = scheibenWahl.hidden = tab !== 'loops';
  };
  zeigeTab();

  // one card of a module (`m` as regalEintraege gives it); the search view draws the same card
  function karteModul(m) {
    const k = karteBau(m.fehler ? 'kaputt' : m.offen ? 'offen' : 'modul', m.name, m.fehler ? 'unreadable' : m.geaendert ? datumText(m.geaendert) : '', m.offen ? 'open' : '');
    if (m.offen || m.fehler) k.disabled = true;
    if (m.fehler) k.setAttribute('title', m.text);
    // the click re-checks the live state: a card drawn before a change must not reopen the open module
    k.addEventListener('click', () => { if (!m.fehler && m.slug !== st.slug) aktion(() => ctx.oeffneModul(m.slug)); });
    if (m.fehler) return k;
    // SAVE AS and DELETE sit on the card (siblings of its button: a button inside a button is invalid); the open module has no DELETE
    const huelle = el('div', 'w-karte-huelle');
    const knoepfe = el('div', 'w-karte-knoepfe');
    const kopie = el('button', 'w-karte-knopf', MODUL_TEXT.kopie); kopie.type = 'button'; kopie.setAttribute('data-w', 'modul-kopie');
    kopie.setAttribute('title', MODUL_TEXT.kopieTitel);
    kopie.addEventListener('click', () => frageKopie(m, knoepfe));
    knoepfe.append(kopie);
    if (!m.offen) {
      const weg = el('button', 'w-karte-knopf', MODUL_TEXT.weg); weg.type = 'button'; weg.setAttribute('data-w', 'modul-weg');
      weg.setAttribute('title', MODUL_TEXT.wegTitel);
      weg.addEventListener('click', () => loescheModul(m));
      knoepfe.append(weg);
    }
    huelle.append(k, knoepfe);
    return huelle;
  }
  function zeichneKarten(e) {
    const karten = e.module.map(karteModul);
    const vorlagen = e.vorlagen.map((v) => {
      const k = karteBau('vorlage', v.name, v.text ?? '', 'template');
      k.setAttribute('title', 'Makes a new module from this template');
      // a second module from one template gets " 2", " 3" ...: two cards of one name cannot be told apart
      const frei = () => { const da = new Set(e.module.map((m) => String(m.name).toLowerCase())); for (let n = 1; ; n++) { const z = n === 1 ? v.name : `${v.name} ${n}`; if (!da.has(z.toLowerCase())) return z; } };
      k.addEventListener('click', () => aktion(() => ctx.neuesModul({ name: frei(), vorlage: v.id })));
      return k;
    });
    // a div, not a button: an input inside a button is invalid and does not take clicks in every browser
    const neu = el('div', 'w-karte neu'); neu.setAttribute('role', 'button'); neu.setAttribute('tabindex', '0');
    neu.append(el('b', '', WERKBANK_TEXT.leeresModul));
    const feld = el('input', 'w-karte-name');
    feld.setAttribute('data-w', 'regal-name'); feld.setAttribute('placeholder', WERKBANK_TEXT.neuerName);
    feld.setAttribute('maxlength', '60'); feld.setAttribute('aria-label', 'New module name'); feld.hidden = true;
    const frageName = () => { feld.hidden = false; feld.value = ''; feld.focus?.(); };
    neu.addEventListener('click', frageName);
    neu.addEventListener('keydown', (ev) => { if (ev.target === neu && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); frageName(); } });
    feld.addEventListener('click', (ev) => ev.stopPropagation());
    feld.addEventListener('keydown', (ev) => {
      ev.stopPropagation();   // the library keys of the page stay out of the field
      if (ev.key === 'Escape') { feld.hidden = true; return; }
      if (ev.key !== 'Enter' || feld.value.trim() === '') return;
      const name = feld.value.trim();
      feld.hidden = true;
      aktion(() => ctx.neuesModul({ name }));
    });
    neu.append(feld);
    kartenHost.replaceChildren(...karten, ...vorlagen, neu);
  }
  // open or create, then fetch the shelf again (the open mark and the dates move)
  async function aktion(tue) { await tue(); await lade(); }
  // SAVE AS: the buttons of the card give way to a name field (the name proposed with " copy"); Enter copies (POST /proj/kopie), Escape gives up.
  // The open module stays open; the copy is a module of its own on the shelf.
  function frageKopie(m, knoepfe) {
    const feld = el('input', 'w-karte-name');
    feld.setAttribute('data-w', 'modul-kopie-name'); feld.setAttribute('maxlength', '80'); feld.setAttribute('aria-label', MODUL_TEXT.kopieTitel);
    feld.value = `${m.name} copy`.slice(0, 80);
    knoepfe.classList.add('name');
    knoepfe.replaceChildren(feld);
    feld.focus?.(); feld.select?.();
    feld.addEventListener('click', (ev) => ev.stopPropagation());
    feld.addEventListener('keydown', async (ev) => {
      ev.stopPropagation();   // the library keys of the page stay out of the field
      if (ev.key === 'Escape') { await lade(); return; }
      if (ev.key !== 'Enter' || feld.value.trim() === '') return;
      feld.disabled = true;
      const r = await ctx.holeJson('/proj/kopie', { slug: m.slug, name: feld.value.trim() });
      if (r.status === 200) ctx.melde(MODUL_TEXT.kopiert(r.j?.name ?? feld.value.trim()));
      else ctx.melde(refusalText(r), true);
      await lade();
    });
  }
  // DELETE: after a confirm the module moves to the bin of the project folder (POST /proj/loeschen); the open module has no DELETE.
  async function loescheModul(m) {
    if (!ctx.frage(MODUL_TEXT.wegFrage(m.name))) return;
    const r = await ctx.holeJson('/proj/loeschen', { slug: m.slug });
    if (r.status !== 200) ctx.melde(refusalText(r), true);
    await lade();
  }

  function zeichne(liste, vorlagen) {
    stand = { liste, vorlagen };
    const e = regalEintraege(liste, vorlagen, st.slug);
    if (tab === 'module') zeichneKarten(e);
    const host = $('vorlagen');
    host.replaceChildren(...e.vorlagen.map((v) => {
      const b = document.createElement('button');
      b.className = 'w-vorlage'; b.title = v.text ?? ''; b.textContent = v.name;
      b.addEventListener('click', () => ctx.neuesModul({ name: v.name, vorlage: v.id }));
      return b;
    }));
    const s = $('leer-oeffnen');
    s.replaceChildren(...[['', WERKBANK_TEXT.oeffnen], ...e.module.map((m) => [m.slug, m.fehler ? `${m.name} (unreadable)` : m.name])].map(([wert, text]) => {
      const o = document.createElement('option'); o.value = wert; o.textContent = text; return o;
    }));
    for (const m of e.module) if (m.fehler) { const o = [...s.children].find((x) => x.value === m.slug); if (o) o.disabled = true; }
  }
  let unterwegs = null, nochmal = false;
  function lade() {
    if (unterwegs) { nochmal = true; return unterwegs; }   // a request in flight may predate the change: fetch once more after it
    unterwegs = (async () => {
      do {
        nochmal = false;
        const [l, v] = await Promise.all([ctx.holeGet('/proj/liste'), ctx.holeGet('/proj/werkbank/vorlagen')]);
        zeichne(l.status === 200 ? l.j : null, v.status === 200 ? v.j : null);
        ctx.suche?.neu();   // a card of the search view may show the open mark of a module
      } while (nochmal);
    })().finally(() => { unterwegs = null; });
    return unterwegs;
  }

  $('leer-neu').addEventListener('click', () => { const f = $('leer-name'); f.hidden = false; f.value = ''; f.focus(); });
  $('leer-name').addEventListener('keydown', async (e) => {
    e.stopPropagation();   // the library keys of the page stay out of the field
    const f = $('leer-name');
    if (e.key === 'Escape') { f.hidden = true; return; }
    if (e.key !== 'Enter' || f.value.trim() === '') return;
    const name = f.value.trim();
    f.hidden = true;
    await ctx.neuesModul({ name });
  });
  $('leer-oeffnen').addEventListener('change', async () => {
    const s = $('leer-oeffnen'), slug = s.value;
    s.value = '';
    if (slug) await ctx.oeffneModul(slug);
  });

  // --- tab LOOPS (sampler A1 task 5): library loops and the audio of modules, each with SLICE TO TRACK ---
  let quellen = null, quellenFehler = null, quellenNr = 0, schneidet = false;
  const hosts = () => [kartenHost, sucheHost];   // the cards of the search view take the same state
  const alle = (sel) => hosts().flatMap((h) => [...h.querySelectorAll(sel)]);
  const zeigeKnoepfe = () => {
    for (const b of alle('[data-w="slice-spur"]')) {
      const stumm = b.hasAttribute('data-stumm');
      b.disabled = !st.projekt || schneidet || stumm;
      b.setAttribute('title', stumm ? STUMM : st.projekt ? 'Cut this loop into slices and put it on a new track' : KEIN_MODUL);
    }
    for (const b of alle('[data-w="schnitt-spur"]')) {
      b.disabled = !st.projekt || schneidet;
      b.setAttribute('title', st.projekt ? 'Put this cut on a new track in its original order' : KEIN_MODUL);
    }
    for (const b of alle('[data-w="schnitt-weg"]')) b.disabled = schneidet;
  };
  function zeichneLoops() {
    if (!quellen) { kartenHost.replaceChildren(el('span', 'w-karten-leer', quellenFehler ?? 'Reading the loops…')); return; }
    const karte = (name, beats, quelle, stumm = false) => {
      const k = el('div', `w-karte schnitt${stumm ? ' stumm' : ''}`);
      k.append(el('b', '', name), el('span', '', typeof beats === 'number' ? `${beats} beats` : ''));
      if (stumm) { k.prepend(el('i', 'w-karte-marke', 'silent')); k.setAttribute('title', STUMM); }
      const b = el('button', 'w-schnitt-knopf', 'SLICE TO TRACK'); b.type = 'button'; b.setAttribute('data-w', 'slice-spur');
      if (stumm) b.setAttribute('data-stumm', '');
      b.addEventListener('click', () => schneide(quelle));
      k.append(b);
      return k;
    };
    const karten = [
      ...quellen.loops.map((l) => karte(l.name, l.beats, { art: 'loop', ref: l.name }, l.stumm === true)),
      ...quellen.module.flatMap((m) => m.audio.map((a) => karte(`${m.titel} · ${a.stem ? grossAnfang(a.stem) : 'Loop'}`, m.beats,
        { art: 'modul', ref: m.id, ...(a.stem ? { stem: a.stem } : {}) }))),
    ];
    kartenHost.replaceChildren(...(karten.length ? karten : [el('span', 'w-karten-leer', 'No loops or module audio yet')]));
    zeigeKnoepfe();
  }
  async function ladeQuellen() {
    const nr = ++quellenNr;
    const r = await ctx.holeGet('/sampler/quellen');
    if (nr !== quellenNr) return;   // a newer request is on its way
    const ok = r.status === 200 && Array.isArray(r.j?.loops) && Array.isArray(r.j?.module);
    quellen = ok ? { loops: r.j.loops, module: r.j.module } : quellen;
    quellenFehler = ok ? null : refusalText(r);
    if (tab === 'loops') zeichneLoops();
  }
  // a reason the page has no text for (the sampler routes carry their own English text) shows the text of the answer
  function refusalText(r) {
    const t = ctx.antwortText(r);
    return t.startsWith('Rejected:') && typeof r?.j?.text === 'string' && r.j.text !== '' ? grossAnfang(r.j.text) : t;
  }
  // One click, one request: a second click while it runs sends nothing. A refusal changes neither the project nor the selection.
  // `koerper` is {quelle, ...} of a loop card or {id} of a cut card
  async function schneide(quelle, koerper = null) {
    if (schneidet || !st.projekt) return;
    const slug = st.slug;
    schneidet = true; zeigeKnoepfe();
    try {
      const n = scheibenWahl.value;
      const r = await ctx.holeJson('/sampler/spur', koerper ?? { quelle, ...(n === 'hits' ? { methode: 'anschlag' } : n !== 'auto' ? { scheiben: Number(n) } : {}) });
      if (r.status !== 200 || !r.j?.projekt) { ctx.melde(refusalText(r), true); return; }
      if (st.slug !== slug) { ctx.melde('The track was added to the module you just left.'); return; }
      ctx.uebernimm(slug, r.j.projekt);
      if (typeof r.j.spur_id === 'string') ctx.waehle(r.j.spur_id);
      const texte = [
        ...(typeof r.j.modul_takte === 'number' ? [`The module is now ${r.j.modul_takte} bars long, so the whole loop plays.`] : []),
        ...(r.j.fit === null ? [FIT_AUS] : []),
      ];
      if (texte.length) ctx.melde(texte.join(' '));
    } finally {
      schneidet = false; zeigeKnoepfe();
      if (tab === 'loops') ladeQuellen();
      if (tab === 'cuts') ladeSchnitte();
    }
  }

  // --- tab CUTS: the stored cuts, each with TO TRACK and DELETE (a cut still played somewhere is refused by the server, with the places) ---
  let schnitte = null, schnitteFehler = null, schnitteNr = 0;
  // one card of a stored cut (`s` as GET /sampler/liste gives it); the search view draws the same card
  function karteSchnitt(s) {
    const k = el('div', 'w-karte schnitt');
    const bt = el('b', '', s.name); bt.setAttribute('title', s.name);
    k.append(bt, el('span', '', `${zaehlText(s.scheiben, 'slice')} · ${s.beats} beats`));
    k.setAttribute('title', s.id);
    const zeile = el('div', 'w-schnitt-zeile');
    const spur = el('button', 'w-schnitt-knopf', 'TO TRACK'); spur.type = 'button'; spur.setAttribute('data-w', 'schnitt-spur');
    spur.addEventListener('click', () => schneide(null, { id: s.id }));
    const weg = el('button', 'w-schnitt-knopf', 'DELETE'); weg.type = 'button'; weg.setAttribute('data-w', 'schnitt-weg');
    weg.setAttribute('title', 'Delete this cut with its audio and its tones');
    weg.addEventListener('click', () => loesche(s));
    zeile.append(spur, weg);
    k.append(zeile);
    return k;
  }
  function zeichneSchnitte() {
    if (!schnitte) { kartenHost.replaceChildren(el('span', 'w-karten-leer', schnitteFehler ?? 'Reading the cuts…')); return; }
    const karten = schnitte.map(karteSchnitt);
    kartenHost.replaceChildren(...(karten.length ? karten : [el('span', 'w-karten-leer', 'No cuts yet: SLICE TO TRACK in LOOPS makes one')]));
    zeigeKnoepfe();
  }
  async function ladeSchnitte() {
    const nr = ++schnitteNr;
    const r = await ctx.holeGet('/sampler/liste');
    if (nr !== schnitteNr) return;   // a newer request is on its way
    const ok = r.status === 200 && Array.isArray(r.j?.schnitte);
    schnitte = ok ? r.j.schnitte : schnitte;
    schnitteFehler = ok ? null : refusalText(r);
    if (tab === 'cuts') zeichneSchnitte();
  }
  async function loesche(s) {
    if (schneidet || !ctx.frage(`Delete the cut "${s.name}" (${zaehlText(s.scheiben, 'slice')})? This cannot be undone.`)) return;
    schneidet = true; zeigeKnoepfe();
    try {
      const r = await ctx.holeJson('/sampler/loeschen', { id: s.id });
      if (r.status !== 200) ctx.melde(refusalText(r), true);
    } finally {
      schneidet = false; zeigeKnoepfe();
      if (tab === 'cuts') ladeSchnitte();
      ctx.suche?.neu();
    }
  }
  // tab SAMPLES lives in regal_samples.js; it draws into the card host while its tab is shown
  const samples = bindeSamplesReiter(ctx, { host: kartenHost, setzeHinweis: (t) => { hinweis.textContent = t ?? SAMPLES_TEXT.hint; }, refusalText });
  const instrumente = bindeInstrumente(ctx, { host: kartenHost, setzeHinweis: (t) => { hinweis.textContent = t ?? INSTRUMENTE_TEXT.hint; }, refusalText });
  // the search over everything: the rows are the ones of the tabs, "show all" of SAMPLES moves into the tab's own search field
  const sucheRow = (t) => samples.katalogZeile(t, sucheHost);
  const suche = bindeSuche(ctx, {
    kopf: sucheKopf, host: sucheHost, tabHost: kartenHost,
    bauer: {
      samples: sucheRow, loops: sucheRow, instrumente: (t) => instrumente.zeileFuer(t, sucheHost), schnitte: karteSchnitt,
      module: (t) => { const m = regalEintraege([t], [], st.slug).module[0]; return m ? karteModul(m) : null; },
    },
    zeigeAlle: (art, q, passt) => {
      if (art !== 'samples' || passt) return false;   // the other tabs have no search field of their own: the group opens in place (so does SAMPLES with FITS on: the tab search carries only text)
      samples.sucheAlle(q);
      if (tab === 'samples') samples.zeige(); else setzeTab('samples');
      return true;
    },
    eingeblendet: () => !regal.hidden, imRegal: (z) => regal.contains(z),
    knoepfe: () => { zeigeKnoepfe(); samples.katalogKnoepfe(); instrumente.zeigeKnoepfe(); },
    stopp: () => samples.katalogStopp(),
  });
  ctx.beiInstrumentGeaendert = () => suche.neu();
  ctx.suche = suche;
  document.addEventListener('keydown', (e) => { suche.taste(e); });
  if (tab === 'samples') samples.zeige();
  if (tab === 'instrumente') instrumente.zeige();
  function setzeTab(neu) {
    if (neu === tab) return;
    if (tab === 'samples') samples.verberge();
    if (tab === 'instrumente') instrumente.verberge();
    tab = neu; ctx.merke('djk-wb-regal-tab', tab); zeigeTab();
    if (tab === 'loops') { zeichneLoops(); ladeQuellen(); }
    else if (tab === 'cuts') { zeichneSchnitte(); ladeSchnitte(); }
    else if (tab === 'samples') samples.zeige();
    else if (tab === 'instrumente') instrumente.zeige();
    else if (stand.liste || stand.vorlagen) zeichneKarten(regalEintraege(stand.liste, stand.vorlagen, st.slug));
    else kartenHost.replaceChildren();
  }
  tabModule.addEventListener('click', () => setzeTab('module'));
  tabLoops.addEventListener('click', () => setzeTab('loops'));
  tabCuts.addEventListener('click', () => setzeTab('cuts'));
  tabSamples.addEventListener('click', () => setzeTab('samples'));
  tabInstrumente.addEventListener('click', () => setzeTab('instrumente'));

  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar) { lade(); if (tab === 'loops') ladeQuellen(); if (tab === 'cuts') ladeSchnitte(); } });
  ctx.beimProjekt.push((p, wechsel) => {
    zeigeText();
    if (!st.sichtbar) return;
    if (wechsel) lade();
    if (tab !== 'module') zeigeKnoepfe();
    else if (!wechsel && (stand.liste || stand.vorlagen)) zeichneKarten(regalEintraege(stand.liste, stand.vorlagen, st.slug));
  });
}

// The shelf is a drawer over the dock: the SHELF button of the top bar opens and closes it. Closed by default once a module is open (the choice is
// remembered); open while no module is open, because the empty state needs it. Appended to the top bar after the export buttons.
export function bindeRegalSchublade(ctx) {
  const { st, $ } = ctx;
  const regal = $('regal');
  const knopf = el('button', 'w-regal-auf', 'SHELF ▾');
  knopf.type = 'button'; knopf.setAttribute('data-w', 'regal-auf'); knopf.title = 'Open or close the shelf of modules, loops and cuts';
  $('kopf').append(knopf);
  const gemerkt = () => ctx.lies('djk-wb-regal-auf', '0') === '1';
  const zeige = () => {
    const auf = !st.projekt || gemerkt();
    regal.hidden = !auf;
    knopf.setAttribute('aria-pressed', String(auf)); knopf.classList.toggle('an', auf);
    knopf.textContent = auf ? 'SHELF ▴' : 'SHELF ▾';
    messe();
  };
  // The open shelf lies over the lower part of the track list and the grid. Both get that much room at their end, so their last rows scroll clear of it.
  const wb = regal.parentElement, spuren = $('spuren');
  const messe = () => {
    if (!wb || !spuren || typeof spuren.getBoundingClientRect !== 'function') return;
    const ueber = regal.hidden ? 0 : Math.max(0, Math.round(spuren.getBoundingClientRect().bottom - regal.getBoundingClientRect().top));
    wb.style.setProperty('--regal-ueber', `${ueber}px`);
    // Height of the open shelf; on low windows the grid makes room for it (werkbank.css), so the instrument controls stay reachable.
    wb.style.setProperty('--regal-hoehe', regal.hidden ? '0px' : `${Math.round(regal.getBoundingClientRect().height)}px`);
  };
  // next frame: messe changes the grid, which must not resize an observed box in the same pass (else "ResizeObserver loop" errors)
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => requestAnimationFrame(messe)); ro.observe(regal); if (spuren) ro.observe(spuren); }
  knopf.addEventListener('click', () => { ctx.merke('djk-wb-regal-auf', st.projekt && gemerkt() ? '0' : '1'); zeige(); });
  ctx.beimProjekt.push(() => zeige());
  zeige();
}
