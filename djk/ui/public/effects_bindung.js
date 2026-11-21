// Preset panel glue and the EFFECTS binding (bindeEffekte).
import { limiterZustand, fxInhaltText, GRAPH_KANAL_ART } from './effects.js';
import { kanalAnwenden, bauePresetPanel, hostWechsel, istKernGeraet, kernGeraetWerte, presetAusKernKomp, kernGeraetAnfragen } from './presets.js';   // 1.16: preset browser
import { bindeInstrumente } from './instruments_view.js';
import { leseAchse, merkeAchse } from './instrument_groups.js';
import { GERAETEKNOPF } from './panel_kopf.js';
import { $, $$, zustand } from './page_state.js';
import { fxGewaehlt, grJetzt, kompVerlauf, sendeWerkzeug, zeigeLimiter } from './effects_view.js';
import { FX_KANAELE, istGeraeteseite, instrumenteSichtbar, kompWert, setzeBereich, setzeGeraeteseite, spektrumLeihe } from './effects_gemeinsam.js';
import { fokus } from './controller_fokus.js';
import { produktion } from './seitenrahmen.js';
import { graphVon, graphenGeladen, holeBk, holeGraphen, holeHostNamen, hostNamen, instrDurchsucht, merkeInstrKat, speichereSound, waehleGraph, zeigeGraphWahl } from './graphs_view.js';
import { bindeBkKnobs, holeLernen, lernAbbrechenFuer, lernSchicken, lernen } from './learn_view.js';
export let instrumenteAnsicht = null;   // INSTRUMENTS area (instruments_view.js), bound in bindeEffekte
export function zeichneVerlaufIn(c, k) {
  const v = kompVerlauf[k] ?? [];
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--warn') || '#e8a33c';
  g.lineWidth = 2;
  g.beginPath();
  v.forEach((db, i) => { const x = (i / 99) * c.width, y = Math.min(c.height, (db / 24) * c.height); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
}

// 1.16 preset browser (public/presets.js). The page reads and sets the kern's channel compressor (komp) and, since A8, the kern mix tools
// (Gate, Utility; Multiband and Limiter only on buses, which have their own panel since A8b but are not in fxGewaehlt) of the channel picked in EFFECTS (fxGewaehlt), so that is
// what SAVE CURRENT and APPLY reach; the plugin devices are browsable, not applicable.
export let presetPanel = null;
export const presetSenden = async (pfad, daten) => { const r = await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten ?? {}) }); return { code: r.status, j: await r.json().catch(() => ({})) }; };
// 1.16 U3b: apply a preset to a channel. The server computes the requests (POST /presets/anwenden, target kanal); the page sends them one by one and stops at the first refusal.
// D28: a sound of another instrument asks once, then sends the graph first (the knobs follow only after the core accepted it): presets.js kanalAnwenden.
// Used by the EFFECTS preset browser and by the preset header of an instrument panel. Returns {ok, text}.
export async function wendeKanalPresetAn(id, kanal, opt = {}) {
  const name = FX_KANAELE.find(([p]) => p === kanal)?.[1] ?? kanal;
  return kanalAnwenden({ senden: presetSenden, regler: sendeWerkzeug, id, kanal, kanalName: name, presetName: opt.presetName, bestaetige: opt.bestaetige });
}
const presetGeraet = (id) => presetPanel?.z.geraete.find((x) => x.id === id);
export function zeigePresets() {
  if (presetPanel) { presetPanel.lade(); return; }
  // 1.16 rest U7: the same panel sits in the PRODUCTION browser; while the page is in PRODUCTION the production host answers (hostWechsel)
  presetPanel = bauePresetPanel($('#presets'), hostWechsel({
    geraet: 'komp',
    aktuell: (g) => {
      const d = presetGeraet(g);
      if (istKernGeraet(d)) return kernGeraetWerte(d, fxGewaehlt, (pfad) => zustand.regler?.[pfad]);
      return g === 'komp' ? presetAusKernKomp((feld) => kompWert(fxGewaehlt, feld, undefined)) : null;
    },
    // a Baukasten sound goes on the instrument channel chosen in INSTRUMENTS (not on the EFFECTS channel): it loads its instrument there when another one
    // (or none) plays, after one question (D28)
    kannAnwenden: (g) => g === 'komp' || (g === 'baukasten' ? !!instrumenteAnsicht : kernGeraetAnfragen(presetGeraet(g), {}, fxGewaehlt).fehler === undefined),
    anwenden: (preset, g, id) => wendeKanalPresetAn(id, preset?.geraet === 'baukasten' ? instrumenteAnsicht.gewaehlt() : fxGewaehlt, { presetName: preset?.name }),   // g is the device object here, the preset names its device
  }, () => produktion?.presetHost, () => document.body.classList.contains('produktion')));
}

// Was auf jedem Kanal läuft, aus /lage (dieselbe Quelle wie Cyphers Hand): Deck-Titel, Strudel-Muster und Klang, Loop der Box.
// Nur abgefragt, solange die Effekt-Sektion offen ist (alle 2 s).
export const fxInhalt = {};   // channel -> the text last shown on its strip
export async function holeFxInhalt() {
  if ($('#effekte').hidden) return;
  try {
    const lage = await (await fetch('/lage')).json();
    zeigeLimiter(limiterZustand(lage));   // A8b, before the loop: a missing deck field there must not leave the limiter state stale
    for (const [k] of FX_KANAELE) {
      const el = $(`[data-fxinhalt="${CSS.escape(k)}"]`);
      const t = fxInhaltText(k, lage);
      fxInhalt[k] = t;
      if (el) { el.textContent = t; el.title = t; el.classList.toggle('laeuft', t.startsWith('▶')); }
    }
  } catch { /* Seite gleich wieder */ }
}

export function bindeEffekte() {
  for (const t of $$('[data-bereich]')) t.addEventListener('click', () => setzeBereich(t.dataset.bereich));
  $('#instrumente').addEventListener('click', (e) => { if (e.target.closest(GERAETEKNOPF)) setzeGeraeteseite(!istGeraeteseite()); });   // the button in a plate's title bar (panel_kopf.js)
  window.addEventListener('resize', () => { if (istGeraeteseite()) setzeGeraeteseite(true); });   // re-measure the header; no rebuild (an equals war)
  instrumenteAnsicht = bindeInstrumente({ beiWechsel: (alt, neu) => { lernAbbrechenFuer(alt); if (istGeraeteseite()) spektrumLeihe.oeffnen(neu); fokus.melde({ kanal: neu }, 'instrumente'); },   // the chosen channel tab is the synth in front (controller follow)
    kanaele: Object.keys(GRAPH_KANAL_ART).filter((k) => GRAPH_KANAL_ART[k] === 'instrument'), graphVon,
    hostNameVon: (k) => (graphVon(k) ? null : hostNamen[k] ?? null), bindeKnobs: bindeBkKnobs, zeigeGraphWahl, geraeteseite: istGeraeteseite });
  fokus.registriere('instrumente', () => (instrumenteSichtbar() ? { kanal: instrumenteAnsicht.gewaehlt() } : null));   // window focus: the INSTRUMENTS area or the device page, while it is visible
  document.addEventListener('change', (e) => {   // S12: graph pickers (INSTRUMENTS, the windows of the live dock, the Strudel sound column)
    const kat = e.target.closest?.('select.graphkat');
    if (kat) {   // group browsed to: remember it for this axis, show its instruments (the channel keeps what is loaded)
      const k = kat.dataset.graphkat, achse = leseAchse();
      instrDurchsucht[k] = { kat: kat.value, fuer: graphenGeladen[k] ?? '', achse };
      merkeInstrKat(k, kat.value, achse);
      kat.blur();
      zeigeGraphWahl();
      return;
    }
    const sel = e.target.closest?.('select.graphwahl');
    if (sel) waehleGraph(sel.dataset.graphwahl, sel.value);
  });
  document.addEventListener('click', (e) => {   // TYPE / ROLE: the page-wide grouping of the instrument pickers; it only redraws, nothing goes to the server
    const b = e.target.closest?.('button.graphachse');
    if (!b) return;
    b.blur();   // the picker it sits in is skipped by the redraw while it holds the focus
    merkeAchse(b.dataset.achse);
    zeigeGraphWahl();
  });
  document.addEventListener('click', (e) => {   // S17: SAVE SOUND
    const b = e.target.closest?.('button[data-bkmerken]');
    if (b) { const k = b.dataset.bkmerken; b.blur(); speichereSound(k); }
  });
  holeBk();
  holeHostNamen();
  holeGraphen();
  holeLernen();   // S19
  document.addEventListener('click', (e) => {   // S19: learn button (arm / cancel) and remove control of a learned knob
    const lb = e.target.closest?.('button[data-lern]'), wb = e.target.closest?.('button[data-lern-weg]');
    if (lb) lernSchicken('/lernen', { pfad: lernen.wartet?.pfad === lb.dataset.lern ? null : lb.dataset.lern });
    else if (wb) lernSchicken('/lernen/loeschen', { pfad: wb.dataset.lernWeg });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lernen.wartet) lernSchicken('/lernen', { pfad: null }); });
  setInterval(() => {   // 10 Hz: the gain reduction history of every channel (drawn by the history window of the live dock, live_dock/comp.js)
    for (const [k] of FX_KANAELE) { const v = (kompVerlauf[k] ??= []); v.push(grJetzt(k)); if (v.length > 100) v.shift(); }
  }, 100);
  let b = 'library';
  try { b = localStorage.getItem('djk-bereich') || 'library'; } catch { /* ohne Speicher: Library */ }
  setzeBereich(b === 'effekte' || b === 'presets' || b === 'instrumente' || b === 'controller' ? b : 'library');
  setInterval(holeFxInhalt, 2000);
}
