// Strudel place, SOUND column (2026-11-14, Andreas: "weiß auch nicht wie ich da jetzt ein instrument wählen würde"): per stream the instrument
// picker and the first four knobs of the instrument it plays, right beside the pattern editor. The picker is the shared graph picker
// (a [data-graphplatz] element, filled by zeigeGraphWahl, changed through the page-wide select.graphwahl handler); the knobs drive the
// knob rows <channel>/bk/1..4 through the same adapter as the INSTRUMENTS area. DRUMS plays the sample kit, which has no instrument to pick.
import { $, $$, melde } from './page_state.js';
import { oeffneFensterRoh, FENSTER_GESPERRT } from './window_open.js';
import { graphenGeladen, graphenInfo, kanalAdapter } from './graphs_view.js';
import { zeichne } from './controls_view.js';
import { knopfNamen } from './effects.js';

const STIMMEN = [['erz/1', 'DRUMS'], ['erz/2', 'BASS'], ['erz/3', 'MELODY']];
const KNOPF_SVG = '<svg viewBox="0 0 60 60"><circle class="ring" cx="30" cy="30" r="24"/><path class="bogen"/><line class="zeiger" x1="30" y1="30" x2="30" y2="10"/></svg>';
const adapter = new Map();
const adapterVon = (k) => { if (!adapter.has(k)) adapter.set(k, kanalAdapter(k)); return adapter.get(k); };

function baueKnoepfe(feld, k) {
  const name = graphenGeladen[k] ?? '';
  if (feld.dataset.fuer === name) return;
  feld.dataset.fuer = name;
  const namen = knopfNamen(graphenInfo.graphen, name);
  if (!namen) { feld.innerHTML = `<span class="sound-hinweis">${k === 'erz/1' ? 'sample kit: the pattern names the sounds' : 'host instrument: its panel is under INSTRUMENTS'}</span>`; return; }
  feld.innerHTML = namen.map(([nr, n]) => `<div class="sound-knopf"><div class="knopf" data-bk="k${nr}" role="slider" tabindex="0" aria-label="${n}" title="${n} · drag up/down, wheel, shift = fine">${KNOPF_SVG}</div><span>${n}</span></div>`).join('');
  for (const el of $$('.knopf', feld)) bindeKnopf(el, k);
  zeigeWerte(feld, k);
}
function bindeKnopf(el, k) {
  const param = el.dataset.bk, a = () => adapterVon(k);
  const setze = (v) => { const x = Math.max(0, Math.min(1, v)); a().set(param, x); zeichne({ el, x }); };
  let start = null;
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; el.setPointerCapture(e.pointerId); start = { x: a().get(param) ?? 0.5, y: e.clientY }; e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (start) setze(start.x + (start.y - e.clientY) / 220 * (e.shiftKey ? 0.2 : 1)); });
  const los = () => { start = null; };
  el.addEventListener('pointerup', los);
  el.addEventListener('pointercancel', los);
  el.addEventListener('wheel', (e) => { e.preventDefault(); setze((a().get(param) ?? 0.5) + (e.deltaY < 0 ? 0.02 : -0.02)); }, { passive: false });
}
function zeigeWerte(feld, k) {
  for (const el of $$('.knopf[data-bk]', feld)) { const v = adapterVon(k).get(el.dataset.bk); zeichne({ el, x: typeof v === 'number' ? v : 0.5 }); }
}

// Builds the column once into the Strudel place and keeps it following the loaded instruments and the knob values (4 times a second, cheap).
export function bindeStrudelSound() {
  const platz = $('#deck-c');
  if (!platz || $('.soundspalte', platz)) return;
  const spalte = document.createElement('div');
  spalte.className = 'soundspalte';
  spalte.setAttribute('aria-label', 'Sound of the Strudel streams');
  spalte.innerHTML = STIMMEN.map(([k, n], i) => `<div class="sound-stimme" data-sound="${k}" style="--farbe:var(--c${i ? i + 1 : ''})"><div class="sound-kopf">${n}`
    + (k === 'erz/1' ? '' : `<button type="button" data-synth-oeffnen="${k}" title="Open the full panel of this instrument in its own window">OPEN ↗</button>`) + '</div>'
    + (k === 'erz/1' ? '' : `<div class="graphplatz" data-graphplatz="${k}"></div>`) + '<div class="sound-knoepfe"></div></div>').join('');
  platz.append(spalte);
  // OPEN: the device page (#tablet) of this stream in its own window. The page opens on the channel stored as the chosen instrument tab.
  for (const b of $$('[data-synth-oeffnen]', spalte)) b.addEventListener('click', () => {
    const k = b.dataset.synthOeffnen;
    try { localStorage.setItem('djk-instrument', k); } catch { /* the window opens on its first tab */ }
    oeffneFensterRoh({ adresse: '/#tablet', name: `djk-synth-${k.replace('/', '-')}`, breite: 1100, hoehe: 880, melde, meldung: FENSTER_GESPERRT, anpassen: true });   // the one opener helper (window_open.js)
  });
  const auffrischen = () => {
    if (spalte.offsetParent === null) return;   // hidden (Studio view, or the place shows something else)
    for (const s of $$('.sound-stimme', spalte)) { const f = $('.sound-knoepfe', s); baueKnoepfe(f, s.dataset.sound); zeigeWerte(f, s.dataset.sound); }
  };
  setInterval(auffrischen, 250);
  auffrischen();
}
