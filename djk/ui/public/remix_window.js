// Remix plate and Remix window. Since 2026-11-14 the Remix is FX3: one device on the send return fx/3, the channels with key 3 lit pass it
// together (fx3.js). The mixer's FX3 unit names those channels and opens the window; the window shows the plate and a row of channel keys.
import { GERAET as REMIX_GERAET, PLATZ as FX3_PLATZ, geladen as fx3Geladen, fremd as fx3Fremd, ladeSchritte, entladeSchritte, kanaele as fx3Kanaele, zugewieseneText, kurzName } from './fx3.js';
import { ablehnung as remixAblehnung } from './remix_platz.js';
import { baueFrontplatte, vorgaben as panelVorgaben } from './panel.js';
import { remixFenster } from './effects_gemeinsam.js';
import { oeffneFensterRoh } from './window_open.js';
import { $, $$, melde, postJson } from './page_state.js';
import { graphenGeladen, graphenInfo, holePanel, kanalAdapter, schickeVorgaben } from './graphs_view.js';
import { zeigePlaetze } from './slots_view.js';
import { fx3Zuweisung, sendeFxZuweisung, folgeZuweisung } from './beat_fx_view.js';
// #tablet: the device page only, channel tabs on top (panel.css body.tablet). Entered by the address, left by changing it; nothing of the page header is reachable.
// The Remix window (#remix): the page shows only the Remix plate with its channel row; the mixer's FX3 unit opens it. It is a full page
// instance like the tablet, so it follows the core on its own.
export function bindeRemixFenster() {
  document.body.classList.toggle('remix-fenster', remixFenster);
  if (remixFenster) { document.title = 'djk Remix'; $('#platz-remix').hidden = false; zeigeRemix(); }
  for (const b of $$('[data-remix-oeffnen]')) b.addEventListener('click', () => {
    // a window just big enough for the whole plate at zoom 1 (plate 1060 x 686 plus head and browser bars), not a full screen (Andreas 2026-11-14): size it on open and again on reuse (a window of the same name keeps its old size)
    oeffneFensterRoh({ adresse: '/#remix', name: 'djk-remix', breite: 1100, hoehe: 880, melde, meldung: 'The browser blocked the Remix window: allow pop-ups for this page', anpassen: true, klemme0: true });
  });
  for (const b of $$('[data-fx3-alle]')) b.addEventListener('click', () => {   // master key 3: every channel on FX3, or all off when all are on
    const k = fx3Kanaele(), z = fx3Zuweisung(), alle = k.length > 0 && k.every((x) => z[x]);
    for (const x of k) if (!!z[x] === alle) sendeFxZuweisung(2, x, !alle);
  });
  folgeZuweisung(zeigeRemix);
}
// The plate is built once from the device's panel file; its adapter is the knob rows of fx/3 (`fx/3/bk/<n>`), greyed while FX3 holds no Remix.
export let remixFp = null, remixBaut = false, remixFehler = '', remixBusy = false;
const fx3Adapter = kanalAdapter(FX3_PLATZ);
const remixAdapter = {
  get: (param) => (fx3Geladen(graphenGeladen) ? fx3Adapter.get(param) : undefined),
  set: (param, v) => { if (fx3Geladen(graphenGeladen)) fx3Adapter.set(param, v); },
  gesperrt: () => !fx3Geladen(graphenGeladen),
};
async function remixPanelBauen() {
  if (remixFp || remixBaut) return;
  remixBaut = true;
  const feld = $('#platz-remix .remix-feld');
  const info = await holePanel(REMIX_GERAET);
  remixBaut = false;
  if (!info) { if (graphenInfo.graphen.length) feld.textContent = `${REMIX_GERAET} is not available on this core`; return; }
  feld.replaceChildren();
  remixFp = baueFrontplatte(feld, { panel: info.panel, regler: info.regler, adapter: remixAdapter, breit: true });
  remixFp.aktualisiere();
  for (const b of document.querySelectorAll('#platz-remix [data-remix-seite]')) b.addEventListener('click', () => { remixSeite = Number(b.dataset.remixSeite); remixEinpassen(); });
  remixEinpassen();
  new ResizeObserver(remixEinpassen).observe(feld);
}
// The plate is laid out wide (modules side by side, as on the device page) and scaled as a whole into the place, so nothing scrolls. Its two rows (the effect
// sections with the lever, and the pad) fit together only in a tall place; below REMIX_ZOOM_MIN the place shows one row at a time, chosen with FX / PAD.
const REMIX_ZOOM_MIN = 0.7;
let remixSeite = 0;
function remixEinpassen() {
  const wurzel = $('#platz-remix'), feld = $('.remix-feld', wurzel), platte = feld?.firstElementChild;
  if (!platte || !feld.clientWidth || !feld.clientHeight) return;
  const reihen = [...platte.querySelectorAll('.fp-reihe')];
  const gross = remixFenster ? 2.5 : 1;   // in its own window the plate grows with the window, in a place it only shrinks
  const mass = () => { platte.style.zoom = '1'; return Math.min(gross, feld.clientWidth / platte.scrollWidth, feld.clientHeight / platte.scrollHeight); };
  for (const r of reihen) r.style.display = '';
  let z = mass();
  const geteilt = reihen.length > 1 && z < REMIX_ZOOM_MIN;
  if (geteilt) { reihen.forEach((r, i) => { r.style.display = i === remixSeite ? '' : 'none'; }); z = mass(); }
  platte.style.zoom = String(Math.max(0.3, z));
  const seiten = $('.remix-seiten', wurzel);
  seiten.hidden = !geteilt;
  seiten.querySelectorAll('button').forEach((b, i) => { b.classList.toggle('an', i === remixSeite); b.setAttribute('aria-pressed', String(i === remixSeite)); });
}
export function zeigeRemix() {
  const da = fx3Geladen(graphenGeladen), z = fx3Zuweisung();
  for (const e of $$('[data-remix-ziel]')) {   // the FX3 unit of the mixer: the channels on 3, or what keeps FX3 from working
    e.textContent = da ? zugewieseneText(z) : fx3Fremd(graphenGeladen) || 'NO REMIX';
    e.classList.toggle('an', da && fx3Kanaele().some((k) => z[k]));
  }
  for (const b of $$('[data-fx3-alle]')) { const k = fx3Kanaele(); b.classList.toggle('an', da && k.length > 0 && k.every((x) => z[x])); }
  if (!remixFenster) return;   // the Remix plate lives in its own window (#remix)
  const wurzel = $('#platz-remix');
  const ziele = $('.remix-ziele', wurzel);
  ziele.replaceChildren();
  const etikett = document.createElement('span');
  etikett.className = 'remix-etikett';
  etikett.textContent = 'FX3 ON';
  ziele.append(etikett);
  for (const k of fx3Kanaele()) {
    const b = document.createElement('button');
    b.textContent = kurzName(k);
    b.classList.toggle('an', !!z[k]);
    b.setAttribute('aria-pressed', String(!!z[k]));
    b.disabled = !da;
    b.title = z[k] ? `${kurzName(k)} passes the Remix: click to take it off` : `Send ${kurzName(k)} through the Remix`;
    b.addEventListener('click', () => sendeFxZuweisung(2, k));
    ziele.append(b);
  }
  const lade = document.createElement('button');
  lade.textContent = da ? 'UNLOAD' : 'LOAD';
  lade.disabled = remixBusy;
  lade.title = da ? 'Take the Remix out of FX3 (the channels on 3 then play dry)' : 'Load the Remix into FX3';
  lade.addEventListener('click', () => remixSchritte(da ? entladeSchritte(graphenGeladen) : ladeSchritte(graphenGeladen)));
  ziele.append(lade);
  $('.remix-zeile', wurzel).textContent = remixFehler || (da ? 'FX3: the channels lit here (key 3 on their strip) pass the Remix together, after fader and crossfader' : 'FX3 holds no Remix: LOAD');
  $('.remix-zeile', wurzel).classList.toggle('ruhig', !remixFehler && da);
  $('.remix-feld', wurzel).classList.toggle('remix-aus', !da);
  if (remixFp) remixFp.aktualisiere(); else remixPanelBauen();
}
async function remixSchritte(schritte) {
  if (remixBusy || !schritte.length) return;
  remixFehler = ''; remixBusy = true; zeigeRemix();
  for (const sch of schritte) {
    let grund;
    try {
      // the panel's start values first, then the graph (as the effects view does): the switches of the device start off
      if (sch.name) { const info = await holePanel(sch.name); if (info) await schickeVorgaben(sch.kanal, panelVorgaben(info.panel)); }
      const r = await postJson('/graph', { kanal: sch.kanal, name: sch.name }); window.djkGesendet?.push({ graph: sch, code: r.code, antwort: r.j }); grund = remixAblehnung(r);
    }
    catch (e) { grund = `page server unreachable: ${e.message}`; }
    if (grund) { remixFehler = `${sch.kanal} ${sch.name ? 'load' : 'unload'} refused: ${grund}`; melde(remixFehler, true); break; }
  }
  remixBusy = false;
  zeigeRemix(); zeigePlaetze();
}
