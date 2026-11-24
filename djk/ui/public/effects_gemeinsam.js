// EFFECTS area basics: channel lists, spectrum views, the device page switch, plate building.
import { spektrumFlaeche, SpektrumLeihe, SpektrumAnsicht, SPEKTRUM_FRIST_MS } from './spectrum.js';   // 1.15 A7b: spectrum view
import { GRAPH_KANAL_ART } from './effects.js';
import { geraeteseiteKlasse, instrumentLabel } from './instruments_view.js';
import { baueFrontplatte } from './panel.js';
import { geraeteknopfHtml } from './panel_kopf.js';
import { $, $$, melde, zustand } from './page_state.js';
import { holeFxInhalt, instrumenteAnsicht, zeigePresets } from './effects_bindung.js';
import { sendeWerkzeug } from './effects_view.js';
import { tabletModus } from './seitenrahmen.js';
import { holeLernen, lernAbbrechenFuer, lernSchicken, lernen } from './learn_view.js';
import { zeigeRegister } from './register_view.js';
import { fokus } from './controller_fokus.js';
import { FX_KANAELE, FX_INDEX } from './live_kanaele.js';
import { oeffneFensterRoh } from './window_open.js';
export { FX_KANAELE, FX_INDEX };

// Effekt-Sektion (Plan 2026-10-11-effekt-sektion.md, Andreas: „tauschoberfläche gegen die libary unten“): unten LIBRARY |
// EFFECTS; EFFECTS zeigt je Quellkanal einen Streifen mit dem Kompressor (<k>/komp/*), Bedienung über /regler (sofort),
// Absenkung aus /zustand/komp (10 Hz je aktivem Kompressor). Der gewählte Bereich gilt je Betrachter (localStorage).
export const KOMP_REGLER = [
  { feld: 'schwelle', name: 'THR', min: -60, max: 0, schritt: 0.5, vorgabe: -18, text: (w) => `${w.toFixed(1)}` },
  { feld: 'ratio', name: 'RATIO', min: 1, max: 20, schritt: 0.1, vorgabe: 4, text: (w) => `${w.toFixed(1)}:1` },
  { feld: 'mix', name: 'MIX', min: 0, max: 1, schritt: 0.01, vorgabe: 1, text: (w) => `${Math.round(w * 100)}%` },
];
export const kompGr = {};   // kanal -> { db, t }
export const kompPegel = {};   // kanal -> { ein, aus, t }: the input and output peak of the channel compressor (/e/stufe_pegel, T9), read by the face
export function kompWert(k, feld, vor) { const w = zustand.regler?.[`${k}/komp/${feld}`]; return typeof w === 'number' ? w : vor; }
export function instrumenteSichtbar() { return !!instrumenteAnsicht && !$('#instrumente').hidden; }
// Device page: the INSTRUMENTS element itself, enlarged as a fixed layer (panel.css body.geraeteseite). One host, no second plate; this function is the only way in and out.
let geraeteseiteAn = false;
export const remixFenster = location.hash === '#remix';   // the Remix window (bindeRemixFenster)
// The Controllers window (#controller): a page instance of its own that shows only the controller register, full height (Andreas 2026-11-18:
// the bottom panel is too small to find a control in). The CONTROLLERS tab of the main page opens it.
export const controllerFenster = location.hash === '#controller';
function oeffneControllerFenster() {
  return oeffneFensterRoh({ adresse: '/#controller', name: 'djk-controller', breite: 1500, hoehe: 1000, klemme0: true }) !== null;   // blocked: the caller shows the panel in the page instead
}
// The spectrum views on the page: the EFFECTS one and, on the device page, the plate cell or the strip. All are fed by the same frames (one global source).
export const spektrumAnsichten = new Set();
function spektrumAnmelden(a) {
  for (const x of spektrumAnsichten) if (x.l && x.l.isConnected === false) spektrumAnsichten.delete(x);   // views of rebuilt plates
  spektrumAnsichten.add(a);
  a.setzeQuelle(zustand.regler?.['spektrum/kanal'] ?? 0);
  spektrumNachsehen();
}
function spektrumAbmelden() {   // every view but the EFFECTS one: those of plates that are gone (rebuild, close)
  for (const x of spektrumAnsichten) if (x !== spektrumAnsicht) spektrumAnsichten.delete(x);
}
function spektrumStreifen(liste) {
  const { wurzel, ansicht } = spektrumFlaeche(document);
  wurzel.classList.add('fp-spektrumstreifen');
  liste.append(wurzel);
  spektrumAnmelden(ansicht);
}
export const spektrumLeihe = new SpektrumLeihe({ speicher: (() => { try { return window.sessionStorage; } catch { return null; } })(), kanaele: Object.keys(GRAPH_KANAL_ART).filter((k) => GRAPH_KANAL_ART[k] === 'instrument'),
  aktuell: () => zustand.regler?.['spektrum/kanal'], sende: (p, n) => sendeWerkzeug(p, n),
  beacon: (pfad, nach) => { const body = JSON.stringify({ pfad, nach, ab: 'jetzt' }); try { if (navigator.sendBeacon('/regler', new Blob([body], { type: 'application/json' }))) return; } catch { /* fetch below */ } try { fetch('/regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }); } catch { /* page is gone */ } },
  neuGeladen: (() => { try { return performance.getEntriesByType('navigation')[0]?.type === 'reload'; } catch { return false; } })() });   // a duplicated tab is not a reload: it must not undo the original's lease
window.addEventListener('pagehide', () => spektrumLeihe.seiteVerlassen());
export function istGeraeteseite() { return geraeteseiteAn; }
export function setzeGeraeteseite(an, neuBauen = true) {
  an = (!!an || tabletModus) && instrumenteSichtbar();
  const war = geraeteseiteAn;
  geraeteseiteAn = an;
  const klassen = geraeteseiteKlasse(an, document.body.classList.contains('produktion'));
  for (const k of ['geraeteseite', 'geraeteseite-produktion']) document.body.classList.toggle(k, klassen.includes(k));
  if (an && tabletModus) document.body.style.setProperty('--geraete-oben', '0px');   // no page header on the tablet
  else if (an) {   // the layer starts under the page header, whatever height the header has in this mode
    const kopf = $('#kopf')?.getBoundingClientRect?.();
    document.body.style.setProperty('--geraete-oben', `${Math.max(0, Math.round(kopf?.bottom ?? 64)) + 6}px`);
  } else document.body.style.removeProperty('--geraete-oben');
  if (an !== war) {   // transitions only (a resize call keeps the source); the spectrum row is borrowed while the page is open and restored on every way out
    if (an) spektrumLeihe.oeffnen(instrumenteAnsicht.gewaehlt()); else { spektrumLeihe.schliessen(); spektrumAbmelden(); }
  }
  if (neuBauen && an !== war && instrumenteSichtbar()) instrumenteAnsicht.neuBauen();   // the plate is rebuilt wide (an) or narrow (closed); same host
}
/** Whether a plate in `liste` is built wide: only inside the INSTRUMENTS area while the device page is open (the EFFECTS plates never). */
function breitFuer(liste) { return istGeraeteseite() && !!liste.closest('#instrumente'); }
/** The one place that builds a front plate for the page: `breit` from the page state, the device page button in the title bar of every plate in INSTRUMENTS (bk, Surge, host). */
export function platteBauen(liste, opt) {
  const breit = breitFuer(liste);
  spektrumAbmelden();   // the views of the plates this build replaces
  let spektren = 0;
  const fp = baueFrontplatte(liste, { ...opt, breit, ...(breit ? { beiSpektrum: (a) => { spektren++; spektrumAnmelden(a); } } : {}) });
  if (breit && !spektren) spektrumStreifen(liste);   // a panel without a spektrum control: the channel spectrum in a strip under the plate
  if (liste.closest('#instrumente') && !istGeraeteseite()) liste.querySelector('.fp-kopf')?.insertAdjacentHTML('beforeend', geraeteknopfHtml(false));   // opens; the closer sits in the tab strip
  return fp;
}
export const FENSTER_GESPERRT_TEXT = 'Your browser blocked the controller window; showing the list here.';
function registerHinweis(text) {   // one line above the register while it stands in for the blocked window; every other call removes it
  const reg = $('#register');
  reg?.parentElement?.querySelector?.('[data-register-hinweis]')?.remove();
  if (!text || !reg?.parentElement) return;
  const p = document.createElement('p');
  p.className = 'st-hinweis';
  p.setAttribute('data-register-hinweis', '');
  p.textContent = text;
  reg.parentElement.insertBefore(p, reg);
}
export function setzeBereich(b) {
  registerHinweis('');
  let gesperrt = false;
  if (controllerFenster) {   // this page instance is the Controllers window: only the register, whatever area was stored
    document.body.classList.add('controller-fenster');
    document.title = 'djk Controllers';
    $('#register').hidden = false;
    zeigeRegister($('#register'), { stand: () => lernen, schicken: lernSchicken, hole: holeLernen }, { kanalName: instrumentLabel });
    return;
  }
  if (b === 'controller') {   // the register lives in its own window; the panel shows it only when the browser blocks the window on a click
    const klick = navigator.userActivation?.isActive === true;
    if (!klick) b = 'library';                 // a restored area never opens a window
    else if (oeffneControllerFenster()) return;   // the panel stays on what it showed
    else gesperrt = true;
  }
  setzeGeraeteseite(false, false);   // another area (or a restore) never keeps the layer; the rebuild below (INSTRUMENTS) or later (reopen) builds narrow
  if (b !== 'instrumente' && instrumenteSichtbar()) lernAbbrechenFuer(instrumenteAnsicht.gewaehlt());
  document.body.classList.toggle('bereich-effekte', b === 'effekte');
  for (const t of $$('[data-bereich]')) { const an = t.dataset.bereich === b; t.classList.toggle('an', an); t.setAttribute('aria-selected', String(an)); }
  $('#effekte').hidden = b !== 'effekte';
  if (b === 'effekte') holeFxInhalt();
  document.body.classList.toggle('bereich-presets', b === 'presets');   // 1.16
  $('#presets').hidden = b !== 'presets';
  if (b === 'presets') zeigePresets();
  document.body.classList.toggle('bereich-instrumente', b === 'instrumente');   // INSTRUMENTS area
  $('#instrumente').hidden = b !== 'instrumente';
  if (b === 'instrumente') { instrumenteAnsicht?.baue(); if (instrumenteAnsicht) fokus.melde({ kanal: instrumenteAnsicht.gewaehlt() }, 'instrumente'); }   // entering the area (or the device page at load): its chosen channel is in front
  document.body.classList.toggle('bereich-controller', b === 'controller');   // CONTROLLERS area (read-only register)
  $('#register').hidden = b !== 'controller';
  if (b === 'controller') { if (gesperrt) registerHinweis(FENSTER_GESPERRT_TEXT); zeigeRegister($('#register'), { stand: () => lernen, schicken: lernSchicken, hole: holeLernen }, { kanalName: instrumentLabel }); }
  try { localStorage.setItem('djk-bereich', b); } catch { /* ohne Speicher: nur jetzt */ }
}
export async function setzeKomp(pfad, nach) {
  try {
    const r = await fetch('/regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad, nach, ab: 'jetzt' }) });
    const j = await r.json();
    window.djkGesendet.push({ [pfad]: nach, code: r.status, antwort: j });
    if (r.status !== 200) melde(`Compressor refused: ${j?.fehler ?? r.status}`, true);
    else if (j?.quittung?.status === 6) melde(`Compressor refused: ${j.quittung.grund}`, true);
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}
// 1.15 A7b: the spectrum view in the EFFECTS panel. The selector is the kern's row spektrum/kanal (echo /e/regler, state snapshot); frames come as /zustand/spektrum.
const spektrumAnsicht = new SpektrumAnsicht({ leinwand: $('#spektrum-leinwand'), wahl: $('#spektrum-quelle'), info: $('#spektrum-info'), sende: sendeWerkzeug });
spektrumAnsichten.add(spektrumAnsicht);
let spektrumTimer = null;
export function spektrumNachsehen() {   // after the last frame the plot must go empty by itself (no event arrives then)
  clearTimeout(spektrumTimer);
  spektrumTimer = setTimeout(() => { for (const a of spektrumAnsichten) a.zeichne(); }, SPEKTRUM_FRIST_MS + 30);
}
