// The browser component (browser plan 2, task 3): builds the section list into <aside id="browser"> and keeps it current.
// Docked in PRODUCTION; the drawer of the other views comes with task 5 (until then it stays hidden there). Updates come from the SSE
// event `proj` (forwarded by stream.js as window event djk:ereignis), 300 ms after the last one; there is no polling.
import { holeHost } from './host.js';
import { liesOffen, schalte, tasteB, drawerBreite } from './frame.js';
import { istGrossOffen } from '../seitenrahmen.js';
import { baueProjektAbschnitt } from './sektion_project.js';
import { baueProjekteAbschnitt } from './sektion_projekte.js';
import { baueBibliothekAbschnitt } from './sektion_library.js';
import { baueGeraeteAbschnitt } from './sektion_devices.js';
import { bauePresetsAbschnitt } from './sektion_presets.js';
import { baueKitsAbschnitt } from './sektion_kits.js';
import { baueKollektionenAbschnitt } from './sektion_collections.js';
import { bindeEinwurf } from './einwurf.js';
import { waehleOrdner } from './ordner_dialog.js';
import { baueSuchleiste, filtereZeilen } from './suche.js';
import { ladeVokabular, merke } from './tags_client.js';

export const ABSCHNITTE = [
  { id: 'projekt', titel: 'THIS PROJECT', baue: baueProjektAbschnitt },
  { id: 'projekte', titel: 'PROJECTS', baue: baueProjekteAbschnitt },
  { id: 'bibliothek', titel: 'LIBRARY', baue: baueBibliothekAbschnitt },
  { id: 'geraete', titel: 'INSTRUMENTS AND EFFECTS', baue: baueGeraeteAbschnitt },
  { id: 'presets', titel: 'PRESETS', baue: bauePresetsAbschnitt },
  { id: 'kits', titel: 'KITS', baue: baueKitsAbschnitt },
  { id: 'kollektionen', titel: 'COLLECTIONS', baue: baueKollektionenAbschnitt },
];

const ansichtVon = (body) => ['produktion', 'werkbank', 'tracker'].find((k) => body.classList.contains(k)) ?? 'dj';

export function bindeBrowser(opt = {}) {
  const wurzel = document.getElementById('browser');
  const hole = opt.hole ?? holeHost;
  if (!wurzel) return { zeige() {}, verberge() {}, aktualisiere() {}, waehleDateien() {}, waehleOrdner: async () => null };
  let letzte = null;
  // the drop zone and the upload queue: one for the whole drawer; its host always points at the view that is current
  const lazy = { holeGet: (...a) => hole(letzte).holeGet(...a), holeJson: (...a) => hole(letzte).holeJson(...a), melde: (...a) => hole(letzte).melde(...a) };
  const einwurf = bindeEinwurf({ wurzel, host: lazy, beiBatch: () => lade() });
  let gebaut = null;   // the view the sections were built for
  let sektionen = [];
  // plan 7 vocabulary: undefined = not asked yet, null = the route is not there (no chips, no RELATED, no multi-select; the field still filters by name)
  let vokabular, vokLaeuft = null;
  let leiste = null, suchStand = { text: '', tags: [] };
  const wende = () => {
    for (const x of sektionen) {
      if (x.id === 'bibliothek') x.s.filtere?.(suchStand.text, suchStand.tags);
      else filtereZeilen(x.s.wurzel, suchStand.text);
    }
  };
  // the sections fill their rows asynchronously: every change of a section body re-applies the name filter (one observer, no polling)
  let beobachter = null, wendeUhr = 0;
  const beobachte = () => {
    beobachter?.disconnect();
    if (typeof MutationObserver === 'undefined') return;
    beobachter = new MutationObserver(() => { if (!suchStand.text.trim()) return; clearTimeout(wendeUhr); wendeUhr = setTimeout(() => { for (const x of sektionen) if (x.id !== 'bibliothek') filtereZeilen(x.s.wurzel, suchStand.text); }, 30); });
    for (const x of sektionen) if (x.id !== 'bibliothek') beobachter.observe(x.s.wurzel, { childList: true, subtree: true });
  };
  // a row of the browser by name (RELATED: a click on a related item scrolls to it where it is listed, else only its name shows)
  const zeigeItem = (item, text) => {
    for (const z of wurzel.querySelectorAll('.b-zeile')) {
      const t = z.querySelector(':scope > .b-text');
      if (t && t.textContent === text) { z.closest('.b-abschnitt')?.classList.remove('zu'); z.scrollIntoView({ block: 'center' }); z.classList.add('b-blitz'); setTimeout(() => z.classList.remove('b-blitz'), 1200); return true; }
    }
    hole(letzte).melde(text, false);
    return false;
  };
  const speichereSuche = async (st) => {
    const name = globalThis.prompt?.('Name of this saved search (1 to 40 characters)', '');
    if (!name?.trim()) return;
    try { await merke({ name: name.trim(), tags: st.tags, text: st.text }); hole(letzte).melde('Search saved under COLLECTIONS, SMART', false); lade('kollektionen'); }
    catch (e) { hole(letzte).melde(e.text ?? 'The search was not saved', true); }
  };
  function baue(ansicht) {
    for (const x of sektionen) x.s.ab?.();   // listeners of the old sections (page-wide ones) go before they are built anew
    const host = hole(ansicht);
    wurzel.textContent = '';
    const dienste = { vokabular: vokabular ?? null, zeigeItem, setzeSuche: (st) => leiste?.setze(st), waehleDateien: einwurf.waehleDateien, waehleOrdner: (start) => waehleOrdner({ host: lazy, titel: 'Choose a folder', start }), aktualisiere: (id) => lade(id) };
    sektionen = ABSCHNITTE.map((a) => ({ id: a.id, s: a.baue(host, dienste) }));
    wurzel.append(einwurf.ziel());   // the upload status line stays on top
    leiste = baueSuchleiste({ vokabular: vokabular ?? null, beiAenderung: (st) => { suchStand = st; wende(); }, speichere: vokabular ? speichereSuche : null });
    wurzel.append(leiste.wurzel);
    for (const x of sektionen) wurzel.append(x.s.wurzel);
    if (suchStand.text || suchStand.tags.length) leiste.setze(suchStand);
    beobachte();
    gebaut = ansicht;
  }
  const lade = (nur) => { for (const x of sektionen) if (!nur || x.id === nur) x.s.laden().catch((e) => console.error(`Browser section ${x.id}:`, e)); };
  // the drawer of DJ, STUDIO and TRACKER: fixed at the left under the header, as wide as drawerBreite allows (it must not cover the master strip)
  const sichtbar = (el) => { const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? r : null; };
  function lageDrawer() {
    if (wurzel.hidden || document.body.classList.contains('produktion')) return;
    const kopf = document.getElementById('kopf')?.getBoundingClientRect();
    const oben = Math.round((kopf?.bottom ?? 0) + 8);
    const sperr = [];
    for (const el of [document.querySelector('.uhr'), document.querySelector('[data-pfad="master/pegel"]')]) {
      const r = sichtbar(el);
      if (r && r.bottom > oben) sperr.push(r.left);   // only what reaches into the drawer's height
    }
    wurzel.style.setProperty('--browser-oben', `${oben}px`);
    wurzel.style.setProperty('--browser-breite', `${drawerBreite({ fenster: window.innerWidth, sperrLinks: sperr })}px`);
  }
  const knopf = document.getElementById('browser-knopf');
  function zeige(ansicht) {
    const an = liesOffen(globalThis.localStorage, ansicht);
    document.body.classList.toggle('browser-zu', ansicht === 'produktion' && !an);
    document.body.classList.toggle('browser-offen', ansicht !== 'produktion' && an);
    knopf?.setAttribute('aria-pressed', String(an));
    wurzel.hidden = !an;
    if (!an) return;
    if (vokabular === undefined) {   // asked once before the first build, so the chip row, RELATED and multi-select exist from the start
      vokLaeuft ??= ladeVokabular().then((v) => { vokabular = v; }, () => { vokabular = null; });
      vokLaeuft.then(() => { if (letzte === ansicht) zeige(ansicht); });
      return;
    }
    if (gebaut !== ansicht) baue(ansicht);
    lageDrawer();
    lade();
  }
  function verberge() { wurzel.hidden = true; }
  function umschalten() { const a = ansichtVon(document.body); schalte(a, !liesOffen(globalThis.localStorage, a)); zeige(a); }
  knopf?.addEventListener('click', umschalten);
  document.addEventListener('keydown', (e) => {
    if (istGrossOffen()) return;   // the loop deck pop-up owns the keys while it is open
    if (document.querySelector('.b-dialog-huelle')) return;   // a modal (the folder picker) is open
    if (tasteB(e)) { e.preventDefault(); umschalten(); return; }
    // Esc closes the drawer only when focus sits in the drawer, and in no field
    if (e.key === 'Escape' && !wurzel.hidden && ansichtVon(document.body) !== 'produktion' && wurzel.contains(e.target) && !e.target?.closest?.('input, textarea, select, [contenteditable]')) umschalten();
  });
  window.addEventListener('resize', lageDrawer);
  function aktualisiere(abschnitt) { if (!wurzel.hidden) lade(abschnitt); }

  // the view switch sets a class on body (setzeAnsicht); watching it needs no edit of the shared view code
  const pruefe = () => { const a = ansichtVon(document.body); if (a === letzte) return; letzte = a; zeige(a); };
  new MutationObserver(pruefe).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  let uhr = 0, letzterSlug = null;
  window.addEventListener('djk:ereignis', (e) => {
    if (e.detail?.a !== 'proj') return;
    clearTimeout(uhr);
    uhr = setTimeout(() => {
      aktualisiere('projekt');
      const slug = hole(letzte).projekt?.()?.slug ?? null;   // the project list only changes when another project becomes the open one
      if (slug !== letzterSlug) { letzterSlug = slug; aktualisiere('projekte'); aktualisiere('presets'); }   // the save targets of PRESETS follow the open project
    }, 300);
  });
  pruefe();
  return { zeige, verberge, aktualisiere, waehleDateien: einwurf.waehleDateien, waehleOrdner: (start) => waehleOrdner({ host: lazy, titel: 'Choose a folder', start }) };
}
