// Page frame: tabs, drawer, view switch, tablet mode, pattern field.
import { ordneMitte } from './mischer_mitte.js';   // mixer middle column, knob look
import { $, $$, zustand } from './page_state.js';
import { ladeLoops } from './loop_rec_view.js';
import { inSet, stoebernLaden, stz } from './browse_table.js';
import { ladeBaum, zeigeDetail } from './browse_detail.js';
import { ladeSetListe } from './library_view.js';
import { istGeraeteseite, setzeBereich, setzeGeraeteseite } from './effects_gemeinsam.js';
import { lernen } from './learn_view.js';
import { hoerId, vorhoeren, vorhoerenSpringe, vorhoerenStopp } from './prelisten_view.js';
import { instanzen, neueInstanz, waehleRolle } from './instanzen.js';
// Tablet view (#tablet, task 10): the device page is the whole page and has no way out; bindeTablet() sets it, setzeGeraeteseite keeps the layer open.
export let tabletModus = false;

export function zeigeReiterInfo() {
  if (!$('[data-tabelle="sets"]').hidden) { $('#bestand-info').textContent = 'Sets: a free collection, prepared ahead'; return; }
  if (!$('[data-tabelle="library"]').hidden) { $('#bestand-info').textContent = zustand.libraryInfo ?? 'Browse the whole library'; return; }
  const loops = !$('[data-tabelle="loops"]').hidden;
  $('#bestand-info').textContent = loops ? `${zustand.loopliste.length} ${zustand.loopliste.length === 1 ? 'loop' : 'loops'}, stored at 128 BPM, played at master tempo`
    : `${zustand.bestand.length} versions, all rendered at 128 BPM`;
}

export function bindeReiter() {
  for (const b of $$('[data-reiter]')) b.addEventListener('click', () => {
    if (document.body.classList.contains('lib-zu')) schublade(true);   // Reiter bei eingeklappter Schublade: aufklappen statt still nichts zeigen
    for (const x of $$('[data-reiter]')) x.classList.toggle('an', x === b);
    for (const t of $$('[data-tabelle]')) t.hidden = t.dataset.tabelle !== b.dataset.reiter;
    if (b.dataset.reiter === 'loops') ladeLoops(); else if (b.dataset.reiter === 'library') { if (!stz.treffer.length) { stoebernLaden(); ladeBaum(); } zeigeReiterInfo(); $('#lib-suche').focus(); } else if (b.dataset.reiter === 'sets') { ladeSetListe(); zeigeReiterInfo(); } else zeigeReiterInfo();
  });
}

// Plan Oberfläche T7: Library klappbar (L, Esc, Knopf), Suche nach Titel und Key; Zustand je Betrachter im localStorage
export function filtere() {
  const s = ($('#suche')?.value ?? '').trim().toLowerCase();
  for (const tr of $$('#liste tr, #loopliste tr')) {        // nur Titel (1. Zelle) und Key (2. Zelle, Tracks), Spec E2
    const text = `${tr.cells[0]?.textContent ?? ''} ${tr.closest('#liste') ? tr.cells[1]?.textContent ?? '' : ''}`.toLowerCase();
    tr.hidden = s !== '' && !text.includes(s);
  }
}
// Großer Modus (Plan 2.4): gilt nur jetzt, kein localStorage
function gross(an) {
  document.body.classList.toggle('lib-gross', an);
  if (an) schublade(true);                                  // groß heißt offen
  $('#gross').setAttribute('aria-pressed', String(an));
}
function schublade(auf) {
  if (!auf) { document.body.classList.remove('lib-gross'); $('#gross').setAttribute('aria-pressed', 'false'); }   // zu heißt nicht mehr groß
  document.body.classList.toggle('lib-zu', !auf);
  $('#schublade').textContent = auf ? '▾' : '▸';
  try { localStorage.setItem('djk-lib', auf ? 'auf' : 'zu'); } catch { /* ohne Speicher: nur jetzt */ }
}
export function bindeSchublade() {
  $('#schublade').addEventListener('click', () => schublade(document.body.classList.contains('lib-zu')));
  $('#gross').addEventListener('click', () => gross(!document.body.classList.contains('lib-gross')));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, [contenteditable]')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;          // Review: Strg+L u. a. bleiben beim Browser
    if (e.key === 'Escape' && istGeraeteseite()) { if (!lernen.wartet) { e.preventDefault(); setzeGeraeteseite(false); } return; }   // an armed learn: Escape only cancels that (listener in bindeEffekte); the production selection skips an Escape the page used   // the device page first, then the library branches below
    if (e.key === 'l' || e.key === 'L') schublade(document.body.classList.contains('lib-zu'));
    if (e.key === 'g' || e.key === 'G') gross(!document.body.classList.contains('lib-gross'));
    // Detail-Spalte (S5): ↑/↓ wählen die Zeile, S legt sie ins aktive Set. Nur bei sichtbarer Library (Reiter LIBRARY, oder PRODUCTION: dort zeigt sie
    // production.css, das hidden-Attribut bleibt vom DJ-Reiter bestimmt) und offener Schublade.
    if ((!$('[data-tabelle="library"]').hidden || document.body.classList.contains('produktion')) && !document.body.classList.contains('lib-zu') && $('#listen-menue').hidden && stz.treffer.length && !e.target.closest('select')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); zeigeDetail(Math.min(stz.treffer.length - 1, stz.wahl + 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); zeigeDetail(Math.max(0, stz.wahl - 1)); return; }
      if ((e.key === 's' || e.key === 'S') && stz.wahl >= 0) { inSet(stz.treffer[stz.wahl]); return; }
      if (e.key === ' ' && stz.wahl >= 0) { e.preventDefault(); const t = stz.treffer[stz.wahl]; if (t.typ === 'strudel') return; stz.hoert === hoerId(t) ? vorhoerenStopp() : vorhoeren(t); return; }
      if (e.key === 'ArrowRight' && stz.hoert) { e.preventDefault(); vorhoerenSpringe(1); return; }
      if (e.key === 'ArrowLeft' && stz.hoert) { e.preventDefault(); vorhoerenSpringe(-1); return; }
    }
    if (e.key === 'Escape') { if (document.body.classList.contains('lib-gross')) gross(false); else schublade(false); }
  });
  $('#suche').addEventListener('input', filtere);
  let gespeichert = 'auf';
  try { gespeichert = localStorage.getItem('djk-lib') ?? 'auf'; } catch { /* leer */ }
  schublade(gespeichert !== 'zu');
}
// Studio S1: Ansicht DJ | STUDIO; wechselt nur die Sicht, nie den Klang. Gemerkt pro Browser (nur Bequemlichkeit).
// D1 V1: dritter Wert PRODUCTION (Modul production/production.js, gekapselt wie die Spurbänder)
const ANSICHTEN = ['dj', 'studio', 'produktion', 'werkbank'];
export let produktion = null;
export let werkbank = null;   // the workbench view (werkbank/werkbank.js), the fourth value: label STUDIO, value werkbank
export function setzeAnsicht(a) {
  setzeGeraeteseite(false);   // the layer sits on the page of one view; another view never keeps it
  for (const k of ['studio', 'produktion', 'werkbank']) document.body.classList.toggle(k, a === k);
  for (const b of $$('[data-ansicht]')) { const an = b.dataset.ansicht === a; b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); }
  try { localStorage.setItem('djk-ansicht', a); } catch { /* ohne Speicher: DJ */ }
  if (a === 'produktion') produktion?.zeige(); else produktion?.verberge();
  if (a === 'werkbank') werkbank?.zeige(); else werkbank?.verberge();
  ordneMitte(a);
}
export function bindeTablet() {
  const pruefe = () => {
    const an = location.hash === '#tablet';
    if (an === tabletModus) return;
    tabletModus = an;
    document.body.classList.toggle('tablet', an);
    if (an) { setzeBereich('instrumente'); setzeGeraeteseite(true); } else setzeGeraeteseite(false);
  };
  window.addEventListener('hashchange', pruefe);
  pruefe();
}
export function bindeAnsicht() {
  for (const b of $$('[data-ansicht]')) b.addEventListener('click', () => setzeAnsicht(b.dataset.ansicht));
  let a = 'dj';
  try { const g = localStorage.getItem('djk-ansicht'); a = ANSICHTEN.includes(g) ? g : 'dj'; } catch { /* Vorgabe */ }
  setzeAnsicht(a);
}
export function bindeMusterFeld() {
  for (const w of $$('#deck-c .instanz')) instanzen.set(Number(w.dataset.strom), neueInstanz(w));
  for (const b of $$('.rollen [data-rolle]')) b.addEventListener('click', () => waehleRolle(Number(b.dataset.rolle)));
  let gemerkt = 1;
  try { gemerkt = Number(localStorage.getItem('djk-rolle')) || 1; } catch { /* Vorgabe */ }
  waehleRolle([1, 2, 3].includes(gemerkt) ? gemerkt : 1);
  const alle = () => { for (const i of instanzen.values()) i.hole(); };
  setInterval(alle, 1000);
  alle();
}
export function setzeProduktion(p) { produktion = p; }
export function setzeWerkbank(w) { werkbank = w; }
