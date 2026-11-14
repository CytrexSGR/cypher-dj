// Loop automation view, preset panel glue and the EFFECTS binding (bindeEffekte).
import { AUTO_VORLAGEN, AUTO_BEREICH, punktAusStelle, vorlagePunkte, limiterZustand, fxInhaltText, GRAPH_KANAL_ART } from './effects.js';
import { kanalPlanHolen, bauePresetPanel, hostWechsel, istKernGeraet, kernGeraetWerte, presetAusKernKomp, kernGeraetAnfragen } from './presets.js';   // 1.16: preset browser
import { bindeInstrumente } from './instruments_view.js';
import { GERAETEKNOPF } from './panel_kopf.js';
import { $, $$, zustand } from './page_state.js';
import { baueFxStreifen, bindeBus, bindeWerkzeug, fxGewaehlt, grJetzt, kompVerlauf, sendeWerkzeug, waehleFx, zeigeKomp, zeigeLimiter } from './effects_view.js';
import { FX_KANAELE, istGeraeteseite, kompWert, setzeBereich, setzeGeraeteseite, spektrumLeihe } from './effects_gemeinsam.js';
import { produktion } from './seitenrahmen.js';
import { graphVon, graphenGeladen, holeBk, holeGraphen, holeHostNamen, hostNamen, instrDurchsucht, merkeInstrKat, speichereSound, waehleGraph, zeigeGraphWahl } from './graphs_view.js';
import { bindeBkKnobs, holeLernen, lernAbbrechenFuer, lernSchicken, lernen } from './learn_view.js';
export let instrumenteAnsicht = null;   // INSTRUMENTS area (instruments_view.js), bound in bindeEffekte
// Schritt 4: Automation je Loop. Daten aus GET /loop/automation, Bearbeiten im Feld, SAVE schreibt sie in loop.json
let autoDaten = [];        // [{pfad, punkte}] des Loops in der gewählten Box
let autoLoop = { name: '', beats: 0 };
export function bindeAutomation(d, box) {
  const svg = d.querySelector('.autospur');
  const sel = d.querySelector('.autopfad');
  const lsel = d.querySelector('.autolaenge');
  const vsel = d.querySelector('.autovorlage');
  const vorlagenFuellen = () => {
    vsel.innerHTML = `<option value="">Template…</option>${(AUTO_VORLAGEN[sel.value] ?? []).map((v, i) => `<option value="${i}">${v.name}</option>`).join('')}`;
  };
  const status = d.querySelector('.autostatus');
  const l = zustand.loops[box];
  autoLoop = { name: l?.name ?? '', beats: Number(l?.beats) || 0 };
  d.querySelector('.autoname').textContent = autoLoop.name ? `${autoLoop.name} (${autoLoop.beats} beats)` : 'no loop in this box';
  autoDaten = [];
  const spur = () => { let s = autoDaten.find((x) => x.pfad === sel.value); if (!s) { s = { pfad: sel.value, punkte: [], durchgaenge: 1 }; autoDaten.push(s); } return s; };
  const laenge = () => (autoLoop.beats || 4) * (spur().durchgaenge ?? 1);
  const zeichne = () => {
    const b = laenge(), lb = autoLoop.beats || 4, [lo, hi] = AUTO_BEREICH[sel.value];
    lsel.value = String(spur().durchgaenge ?? 1);
    const px = (beat) => (beat / b) * 480, py = (w) => 120 - ((w - lo) / (hi - lo)) * 120;
    const p = spur().punkte;
    let html = '';
    const schritt = b > 32 ? 4 : 1;   // lange Spuren: Linien je Takt, kräftig an den Loop-Grenzen
    for (let i = 0; i <= b; i += schritt) html += `<line class="${i % lb === 0 ? 'schwelle' : 'achse'}" x1="${px(i)}" y1="0" x2="${px(i)}" y2="120"/>`;
    if (p.length) {
      const pts = [...p.map(([x, y]) => `${px(x)},${py(y)}`), `${px(b + p[0][0])},${py(p[0][1])}`];
      html += `<polyline class="kurve" points="${p.length > 1 ? pts.join(' ') : `${px(p[0][0])},${py(p[0][1])} ${px(b)},${py(p[0][1])}`}"/>`;
      html += p.map(([x, y], i) => `<circle data-i="${i}" cx="${px(x)}" cy="${py(y)}" r="5" class="autopunkt"/>`).join('');
    }
    svg.innerHTML = html;
  };
  const stelle = (e) => { const r = svg.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 480, ((e.clientY - r.top) / r.height) * 120]; };
  const sortiere = (s) => { s.punkte.sort((a, b) => a[0] - b[0]); s.punkte = s.punkte.filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0]); };
  let zieht = null;
  svg.addEventListener('pointerdown', (e) => {
    if (!autoLoop.beats) return;
    const c = e.target.closest('circle');
    if (c) { zieht = Number(c.dataset.i); svg.setPointerCapture(e.pointerId); return; }
    const s = spur();
    if (s.punkte.length >= 64) return;
    s.punkte.push(punktAusStelle(...stelle(e), 480, 120, laenge(), AUTO_BEREICH[sel.value]));
    sortiere(s); status.textContent = 'not saved'; zeichne();
  });
  svg.addEventListener('pointermove', (e) => {
    if (zieht === null) return;
    const s = spur();
    s.punkte[zieht] = punktAusStelle(...stelle(e), 480, 120, laenge(), AUTO_BEREICH[sel.value]);
    status.textContent = 'not saved'; zeichne();
  });
  svg.addEventListener('pointerup', () => { if (zieht !== null) { sortiere(spur()); zieht = null; zeichne(); } });
  svg.addEventListener('dblclick', (e) => {
    const c = e.target.closest('circle');
    if (!c) return;
    spur().punkte.splice(Number(c.dataset.i), 1); status.textContent = 'not saved'; zeichne();
  });
  sel.addEventListener('change', () => { vorlagenFuellen(); zeichne(); });
  vorlagenFuellen();
  vsel.addEventListener('change', () => {
    const v = AUTO_VORLAGEN[sel.value]?.[Number(vsel.value)];
    vsel.value = '';
    if (!v || !autoLoop.beats) return;
    spur().punkte = vorlagePunkte(v, laenge());
    status.textContent = 'not saved'; zeichne();
  });
  lsel.addEventListener('change', () => {
    const s = spur(), alt = laenge();
    s.durchgaenge = Number(lsel.value);
    const neu = laenge();
    s.punkte = s.punkte.map(([x, y]) => [Math.round((x / alt) * neu * 4) / 4, y]).filter(([x], i, a) => x < neu && (i === 0 || x !== a[i - 1][0]));   // Kurve mitstrecken
    status.textContent = 'not saved'; zeichne();
  });
  d.querySelector('.autoleeren').addEventListener('click', () => { spur().punkte = []; status.textContent = 'not saved'; zeichne(); });
  d.querySelector('.autospeichern').addEventListener('click', async () => {
    if (!autoLoop.name) return;
    const automation = autoDaten.filter((s) => s.punkte.length).map((s) => ({ pfad: s.pfad, punkte: s.punkte, ...((s.durchgaenge ?? 1) > 1 ? { durchgaenge: s.durchgaenge } : {}) }));
    try {
      const r = await fetch('/loop/automation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: autoLoop.name, automation }) });
      const j = await r.json();
      status.textContent = r.status === 200 ? 'saved' : `refused: ${j.text ?? j.fehler}`;
    } catch (e) { status.textContent = `unreachable: ${e.message}`; }
  });
  if (autoLoop.name) {
    fetch(`/loop/automation?name=${encodeURIComponent(autoLoop.name)}`).then((r) => r.json()).then((j) => {
      autoDaten = (j.automation ?? []).map((s) => ({ pfad: s.pfad, punkte: s.punkte.map((p) => [...p]), durchgaenge: s.durchgaenge ?? 1 }));
      if (autoDaten.length) sel.value = autoDaten[0].pfad;
      vorlagenFuellen();
      zeichne();
    }).catch(() => zeichne());
  } else zeichne();
}

function zeichneVerlauf() {
  const c = $('#fxdetail canvas');
  if (!c) return;
  const v = kompVerlauf[fxGewaehlt] ?? [];
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
// Used by the EFFECTS preset browser and by the preset header of an instrument panel. Returns {ok, text}.
export async function wendeKanalPresetAn(id, kanal) {
  const name = FX_KANAELE.find(([p]) => p === kanal)?.[1] ?? kanal;
  const plan = await kanalPlanHolen(presetSenden, id, kanal);
  if (!plan.ok) return { ok: false, text: plan.text };
  for (const a of plan.anfragen) { const r = await sendeWerkzeug(a.pfad, a.nach); if (!r.ok) return { ok: false, text: r.text }; }
  const uebrig = plan.uebersprungen;
  return { ok: true, text: `channel ${name}${uebrig.length ? `; not in the table: ${uebrig.join(', ')}` : ''}` };
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
    kannAnwenden: (g) => g === 'komp' || kernGeraetAnfragen(presetGeraet(g), {}, fxGewaehlt).fehler === undefined,
    anwenden: (preset, g, id) => wendeKanalPresetAn(id, fxGewaehlt),
  }, () => produktion?.presetHost, () => document.body.classList.contains('produktion')));
}

// Was auf jedem Kanal läuft, aus /lage (dieselbe Quelle wie Cyphers Hand): Deck-Titel, Strudel-Muster und Klang, Loop der Box.
// Nur abgefragt, solange die Effekt-Sektion offen ist (alle 2 s).
export async function holeFxInhalt() {
  if ($('#effekte').hidden) return;
  try {
    const lage = await (await fetch('/lage')).json();
    zeigeLimiter(limiterZustand(lage));   // A8b, before the loop: a missing deck field there must not leave the limiter state stale
    for (const [k] of FX_KANAELE) {
      const el = $(`[data-fxinhalt="${CSS.escape(k)}"]`);
      if (el) { const t = fxInhaltText(k, lage); el.textContent = t; el.title = t; el.classList.toggle('laeuft', t.startsWith('▶')); }
    }
  } catch { /* Seite gleich wieder */ }
}

export function bindeEffekte() {
  for (const t of $$('[data-bereich]')) t.addEventListener('click', () => setzeBereich(t.dataset.bereich));
  $('#instrumente').addEventListener('click', (e) => { if (e.target.closest(GERAETEKNOPF)) setzeGeraeteseite(!istGeraeteseite()); });   // the button in a plate's title bar (panel_kopf.js)
  window.addEventListener('resize', () => { if (istGeraeteseite()) setzeGeraeteseite(true); });   // re-measure the header; no rebuild (an equals war)
  instrumenteAnsicht = bindeInstrumente({ beiWechsel: (alt, neu) => { lernAbbrechenFuer(alt); if (istGeraeteseite()) spektrumLeihe.oeffnen(neu); }, kanaele: Object.keys(GRAPH_KANAL_ART).filter((k) => GRAPH_KANAL_ART[k] === 'instrument'), graphVon,
    hostNameVon: (k) => (graphVon(k) ? null : hostNamen[k] ?? null), bindeKnobs: bindeBkKnobs, zeigeGraphWahl, geraeteseite: istGeraeteseite });
  baueFxStreifen();
  bindeWerkzeug($('#fxstreifen'));
  bindeBus($('#fxstreifen'));
  $('#fxstreifen').addEventListener('click', (e) => {
    const s = e.target.closest('.fxstreifen');
    if (s && !e.target.closest('button, input, select')) waehleFx(s.dataset.kanal);
  });
  document.addEventListener('change', (e) => {   // S12: graph pickers (strips, detail, send returns)
    const kat = e.target.closest?.('select.graphkat');
    if (kat) {   // category browsed to: remember it, show its instruments (the channel keeps what is loaded)
      const k = kat.dataset.graphkat;
      instrDurchsucht[k] = { kat: kat.value, fuer: graphenGeladen[k] ?? '' };
      merkeInstrKat(k, kat.value);
      kat.blur();
      zeigeGraphWahl();
      return;
    }
    const sel = e.target.closest?.('select.graphwahl');
    if (sel) waehleGraph(sel.dataset.graphwahl, sel.value);
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
  waehleFx(fxGewaehlt);
  setInterval(() => {   // 10 Hz: Verlauf der Absenkung aller Kanäle mitschreiben, das Detail zeichnen
    for (const [k] of FX_KANAELE) { const v = (kompVerlauf[k] ??= []); v.push(grJetzt(k)); if (v.length > 100) v.shift(); }
    if (document.body.classList.contains('lib-gross') && !$('#effekte').hidden) zeichneVerlauf();
  }, 100);
  let b = 'library';
  try { b = localStorage.getItem('djk-bereich') || 'library'; } catch { /* ohne Speicher: Library */ }
  setzeBereich(b === 'effekte' || b === 'presets' || b === 'instrumente' ? b : 'library');
  setInterval(() => { if (!$('#effekte').hidden) zeigeKomp(); }, 250);   // GR fällt ohne Meldung auf 0
  setInterval(holeFxInhalt, 2000);
}
