// EFFECTS area strips: tools, bus, gate, compressor, meters and the detail view.
import { sendRueckHtml, busPanelHtml, GRAPH_KANAL_ART, werkzeugStreifenHtml, setzeWerkzeug, werkText, werkzeugKlickNach, limiterZustand, mixAblaufIn, BUS_KANAELE, MIX_FELDER, mixLesung, GATE_KANAELE, GATE_FELDER, GATE_SKALA_DB, werkFeld, KOMP_SCHLUESSEL, KOMP_PRESETS, KNOB_GRUPPE, bkKnobListe, htmlText, AUTO_BEREICH, DURCHGAENGE, knobListe } from './effects.js';
import { $, $$, melde, postJson, zustand } from './page_state.js';
import { graphMitBereich, graphVon, zeigeGraphWahl } from './graphs_view.js';
import { baueSendKnobs, bindeBkKnobs, zeigeFxDetail } from './learn_view.js';
import { FX_INDEX, FX_KANAELE, KOMP_REGLER, kompGr, kompWert, setzeKomp } from './effects_gemeinsam.js';
import { bindeAutomation } from './effects_bindung.js';
export function baueFxStreifen() {
  const reihe = $('#fxstreifen');
  reihe.replaceChildren();
  for (const [k, name] of FX_KANAELE) {
    const s = document.createElement('div');
    s.className = 'fxstreifen';
    s.dataset.kanal = k;
    s.innerHTML = `<div class="fxname"><span>${name}</span><button class="komp-an" title="Compressor on/off (${k})">COMP</button></div>`
      + `<div class="fxinhalt" data-fxinhalt="${k}" title="What plays on this channel">–</div>`
      + (GRAPH_KANAL_ART[k] ? `<div class="graphplatz" data-graphplatz="${k}"></div>` : '')
      + `<div class="fxpegel"><div class="meter waagrecht" data-kanal="${k}"><i></i></div><span data-fxpegel="${k}">−∞</span></div>`
      + KOMP_REGLER.map((r) => `<label>${r.name}<input type="range" data-komp-feld="${r.feld}" min="${r.min}" max="${r.max}" step="${r.schritt}" aria-label="${name} compressor ${r.name}"><output></output></label>`).join('')
      + '<div class="gr" title="Gain reduction"><i></i></div><div class="grzahl">GR –</div>'
      + werkzeugStreifenHtml(k, name);   // A8: GATE and UTIL strips (<k>/gate/*, <k>/util/*); nothing is sent while building
    s.querySelector('.komp-an').addEventListener('click', () => setzeKomp(`${k}/komp/an`, kompWert(k, 'an', 0) >= 0.5 ? 0 : 1));
    for (const inp of s.querySelectorAll('input[data-komp-feld]')) {
      let warte = null;
      inp.addEventListener('input', () => {
        s.querySelector(`input[data-komp-feld="${inp.dataset.kompFeld}"] + output`).textContent = KOMP_REGLER.find((r) => r.feld === inp.dataset.kompFeld).text(Number(inp.value));
        if (warte) return;
        warte = setTimeout(() => { warte = null; setzeKomp(`${k}/komp/${inp.dataset.kompFeld}`, Number(inp.value)); }, 40);
      });
    }
    reihe.append(s);
  }
  const send = document.createElement('div');   // SEND RETURNS: graph picker and the knobs fx/<n>/bk/1..64 (S14)
  send.className = 'sendrueck';
  send.innerHTML = sendRueckHtml();
  reihe.append(send);
  const bus = document.createElement('div');   // A8b: BUS panel (multiband, limiter, utility per bus); its controls use the same handlers as the strips
  bus.className = 'buspanel';
  bus.innerHTML = busPanelHtml();
  reihe.append(bus);
  zeigeGraphWahl();
  baueSendKnobs();
  zeigeKomp();
  zeigeWerkzeug();
  zeigeLimiter(limiterStand);
  zeigeBusMesser();
}
// A8: the Gate and Utility strips. One handler on the strip row: sliders send after 40 ms like the compressor, switches toggle from the live value.
export async function sendeWerkzeug(pfad, nach) {
  const r = await setzeWerkzeug(fetch, pfad, nach);
  if (!r.ok) melde(r.text, true);
  return r;
}
const werkWarte = new Map();
export function bindeWerkzeug(reihe) {
  reihe.addEventListener('input', (e) => {
    const inp = e.target.closest?.('input[data-werk-pfad]');
    if (!inp) return;
    if (inp.disabled) return;   // A8b: the limiter controls while the limiter is not built
    const pfad = inp.dataset.werkPfad, feld = pfad.split('/').slice(2).join('/');
    inp.nextElementSibling.textContent = werkText(feld, Number(inp.value));
    if (werkWarte.has(pfad)) return;
    werkWarte.set(pfad, setTimeout(() => { werkWarte.delete(pfad); sendeWerkzeug(pfad, Number(inp.value)); }, 40));
  });
  reihe.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-werk-pfad]');
    if (b?.disabled) return;
    if (b) { b.blur(); sendeWerkzeug(b.dataset.werkPfad, werkzeugKlickNach(zustand.regler, b.dataset.werkPfad)); }
  });
}
// A8b: folding of the BUS panel and of the per-band block of a bus (both collapsed state is the page's, nothing is sent)
export function bindeBus(reihe) {
  reihe.addEventListener('click', (e) => {
    const p = e.target.closest?.('button.bus-panel-knopf');
    if (p) {
      const zu = p.getAttribute('aria-expanded') === 'true';
      p.setAttribute('aria-expanded', String(!zu));
      p.textContent = zu ? 'BUS ▸' : 'BUS ▾';
      reihe.querySelector('.busreihe').hidden = zu;
      return;
    }
    const b = e.target.closest?.('button[data-baender-knopf]');
    if (b) {
      const k = b.dataset.baenderKnopf, offen = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', String(!offen));
      b.textContent = offen ? 'BANDS ▸' : 'BANDS ▾';
      reihe.querySelector(`[data-baender="${k}"]`).hidden = offen;
    }
  });
}
// A8b: the channel limiter exists only when the kern built it (kern.toml kanal_limiter_vorhalt_ms > 0); /lage says so in kanal_limiter.
// Absent or not built: lim/an, lim/decke and lim/abklingen are disabled and the reason is shown. Built: enabled, latency shown if known.
let limiterStand = limiterZustand(null);
export function zeigeLimiter(z) {
  limiterStand = z;
  for (const s of $$('.busstreifen')) {
    for (const c of s.querySelectorAll('.fxwerk-lim [data-werk-pfad]')) c.disabled = !z.gebaut;
    const g = s.querySelector('[data-lim-grund]');
    g.textContent = z.gebaut ? (z.latenzSamples === null ? '' : `latency ${z.latenzSamples} samples`) : z.grund;
    g.hidden = z.gebaut && z.latenzSamples === null;
  }
}
// A8b: gain-reduction meters of the buses from /zustand/mix (D10). A reading counts for 500 ms; the reset to "no reading" is scheduled
// for the moment the next reading expires, so a meter falls back without any event.
export const busMix = {};
let busMesserTimer = null;
export function zeigeBusMesser() {
  const jetzt = performance.now();
  for (const k of BUS_KANAELE) for (const feld of MIX_FELDER) {
    const db = mixLesung(busMix, k, feld, jetzt);
    const i = $(`[data-messer="${k}|${feld}"]`), z = $(`[data-messer-zahl="${k}|${feld}"]`);
    if (!i || !z) continue;
    i.style.width = `${Math.min(100, ((db ?? 0) / 24) * 100)}%`;
    z.textContent = db === null ? '–' : `${db.toFixed(1)} dB`;
  }
  clearTimeout(busMesserTimer);
  const warte = mixAblaufIn(busMix, jetzt);
  busMesserTimer = warte === null ? null : setTimeout(zeigeBusMesser, warte + 5);
}
// A6: gate meters of the source channels from /zustand/mix (gate_db), same 500 ms rule and self-scheduled reset as the bus meters.
export const gateMix = {};
let gateMesserTimer = null;
export function zeigeGateMesser() {
  const jetzt = performance.now();
  for (const k of GATE_KANAELE) {
    const db = mixLesung(gateMix, k, 'gate_db', jetzt);
    const i = $(`[data-messer="${k}|gate_db"]`), z = $(`[data-messer-zahl="${k}|gate_db"]`);
    if (!i || !z) continue;   // not every source channel has a strip on the page
    i.style.width = `${Math.min(100, ((db ?? 0) / GATE_SKALA_DB) * 100)}%`;
    z.textContent = db === null ? '–' : `${db.toFixed(1)} dB`;
  }
  clearTimeout(gateMesserTimer);
  const warte = mixAblaufIn(gateMix, jetzt, GATE_KANAELE, GATE_FELDER);
  gateMesserTimer = warte === null ? null : setTimeout(zeigeGateMesser, warte + 5);
}
// Show the live control state in the strips (from /e/regler); a slider under the pointer is not moved.
export function zeigeWerkzeug(nur) {
  for (const s of $$('.fxstreifen, .busstreifen')) {
    const k = s.dataset.kanal;
    if (nur && nur !== k) continue;
    for (const b of s.querySelectorAll('button[data-werk-pfad]')) {
      const an = (zustand.regler?.[b.dataset.werkPfad] ?? 0) >= 0.5;
      b.classList.toggle('an', an);
      b.setAttribute('aria-pressed', String(an));
    }
    for (const inp of s.querySelectorAll('input[data-werk-pfad]')) {
      const feld = inp.dataset.werkPfad.slice(k.length + 1), w = zustand.regler?.[inp.dataset.werkPfad];
      const v = typeof w === 'number' ? w : werkFeld(feld).vorgabe;
      if (document.activeElement !== inp) inp.value = String(v);
      inp.nextElementSibling.textContent = werkText(feld, v);
    }
  }
}
export function zeigeKomp(nur) {
  for (const s of $$('.fxstreifen')) {
    const k = s.dataset.kanal;
    if (nur && nur !== k) continue;
    const an = kompWert(k, 'an', 0) >= 0.5;
    const b = s.querySelector('.komp-an');
    b.classList.toggle('an', an);
    b.setAttribute('aria-pressed', String(an));
    for (const r of KOMP_REGLER) {
      const inp = s.querySelector(`input[data-komp-feld="${r.feld}"]`);
      const w = kompWert(k, r.feld, r.vorgabe);
      if (document.activeElement !== inp) inp.value = String(w);
      inp.nextElementSibling.textContent = r.text(w);
    }
    const g = kompGr[k];
    const db = an && g && performance.now() - g.t < 400 ? g.db : 0;
    s.querySelector('.gr i').style.width = `${Math.min(100, (db / 24) * 100)}%`;
    const sc = kompWert(k, 'sc', 0), scName = KOMP_SCHLUESSEL.find(([w]) => w === sc)?.[1];
    s.querySelector('.grzahl').textContent = an ? `GR ${db.toFixed(1)} dB${sc ? ` · KEY ${scName ?? sc}` : ''}` : 'GR –';
  }
}
// Schritt 3: aufgeklappt (⤢) das Detail des gewählten Kanals: alle Regler, Presets, Kennlinie, Verlauf der Absenkung (10 s)
export const KOMP_DETAIL = [
  { feld: 'schwelle', name: 'THRESHOLD', min: -60, max: 0, schritt: 0.5, vorgabe: -18, text: (w) => `${w.toFixed(1)} dB` },
  { feld: 'ratio', name: 'RATIO', min: 1, max: 20, schritt: 0.1, vorgabe: 4, text: (w) => `${w.toFixed(1)}:1` },
  { feld: 'attack', name: 'ATTACK', min: 0.1, max: 100, schritt: 0.1, vorgabe: 10, text: (w) => `${w.toFixed(1)} ms` },
  { feld: 'release', name: 'RELEASE', min: 10, max: 1000, schritt: 1, vorgabe: 120, text: (w) => `${Math.round(w)} ms` },
  { feld: 'makeup', name: 'MAKEUP', min: 0, max: 24, schritt: 0.1, vorgabe: 0, text: (w) => `+${w.toFixed(1)} dB` },
  { feld: 'mix', name: 'MIX', min: 0, max: 1, schritt: 0.01, vorgabe: 1, text: (w) => `${Math.round(w * 100)}%` },
];
export let fxGewaehlt = 'erz/1';
export const kompVerlauf = {};   // kanal -> letzte 100 Absenkungen (10 Hz)
export function grJetzt(k) { const g = kompGr[k]; return kompWert(k, 'an', 0) >= 0.5 && g && performance.now() - g.t < 400 ? g.db : 0; }
export function waehleFx(k) {
  fxGewaehlt = k;
  for (const s of $$('.fxstreifen')) s.classList.toggle('gewaehlt', s.dataset.kanal === k);
  baueFxDetail();
}
export function baueFxDetail() {
  const d = $('#fxdetail');
  const k = fxGewaehlt;
  const name = FX_KANAELE.find(([p]) => p === k)?.[1] ?? k;
  d.innerHTML = `<div class="fxkopf"><b>${name}</b><span class="klein">${k}</span><button class="komp-an" title="Compressor on/off">COMP</button>
      <select class="preset" aria-label="Preset"><option value="">Preset…</option>${Object.keys(KOMP_PRESETS).map((n) => `<option>${n}</option>`).join('')}</select>
      <label class="klein">KEY <select class="schluessel" title="Sidechain: the detector listens to this channel's input (Kick Sidechain: DRUMS)">${KOMP_SCHLUESSEL.filter(([w]) => w === 0 || w !== FX_INDEX[k] + 1).map(([w, n]) => `<option value="${w}">${n}</option>`).join('')}</select></label></div>
    ${GRAPH_KANAL_ART[k] ? `<div class="graphplatz graphdetail" data-graphplatz="${k}"></div>` : ''}
    <div class="regler-liste">${KOMP_DETAIL.map((r) => `<label>${r.name}<input type="range" data-komp-feld="${r.feld}" min="${r.min}" max="${r.max}" step="${r.schritt}"><output></output></label>`).join('')}
      ${KNOB_GRUPPE[k] && !graphVon(k) ? '<div class="knobbereich"><span class="bildtitel">INSTRUMENT KNOBS <b class="knobstatus">…</b></span><div class="knobliste"></div></div>' : ''}
      ${bkKnobListe(k, {}, { graph: graphMitBereich(k) }).length ? `<div class="knobbereich"><span class="bildtitel">GRAPH KNOBS <b>${graphVon(k) ? htmlText(graphVon(k).name) : 'Knobs of the loaded graph'}</b></span><div class="bkliste"></div></div>` : ''}</div>
    <div class="bilder"><span class="bildtitel">TRANSFER CURVE (knee 6 dB)</span>
      <svg viewBox="0 0 240 168" aria-label="Transfer curve"><line class="achse" x1="0" y1="168" x2="240" y2="48"/><line class="schwelle"/><path class="kurve"/></svg>
      <span class="bildtitel">GAIN REDUCTION, LAST 10 S</span><canvas width="480" height="100" aria-label="Gain reduction history"></canvas></div>
    ${k.startsWith('pad/') ? `<div class="autobereich"><span class="bildtitel">AUTOMATION OF THE LOOP <b class="autoname">–</b> · saved with the loop, plays on every pass ·
      click: add point · drag: move · double click: remove</span>
      <div class="autokopf"><select class="autopfad" aria-label="Automated control">${Object.keys(AUTO_BEREICH).map((p) => `<option>${p}</option>`).join('')}</select>
      <label class="klein">LENGTH <select class="autolaenge" title="Lane length in loop passes; long lanes start on a multiple of their length (phrase)">${DURCHGAENGE.map((d) => `<option value="${d}">${d}× loop</option>`).join('')}</select></label>
      <select class="autovorlage" aria-label="Template for this lane"></select>
      <button class="autospeichern">SAVE</button><button class="autoleeren">CLEAR LANE</button><span class="autostatus"></span></div>
      <svg class="autospur" viewBox="0 0 480 120" aria-label="Automation lane"></svg></div>` : ''}`;
  d.querySelector('.komp-an').addEventListener('click', () => setzeKomp(`${k}/komp/an`, kompWert(k, 'an', 0) >= 0.5 ? 0 : 1));
  d.querySelector('.schluessel').addEventListener('change', (e) => setzeKomp(`${k}/komp/sc`, Number(e.target.value)));
  d.querySelector('.preset').addEventListener('change', async (e) => {
    const p = KOMP_PRESETS[e.target.value];
    e.target.value = '';
    if (!p) return;
    for (const [feld, w] of Object.entries(p)) await setzeKomp(`${k}/komp/${feld}`, w);
  });
  for (const inp of d.querySelectorAll('input[data-komp-feld]')) {
    let warte = null;
    inp.addEventListener('input', () => {
      inp.nextElementSibling.textContent = KOMP_DETAIL.find((r) => r.feld === inp.dataset.kompFeld).text(Number(inp.value));
      if (warte) return;
      warte = setTimeout(() => { warte = null; setzeKomp(`${k}/komp/${inp.dataset.kompFeld}`, Number(inp.value)); }, 40);
    });
  }
  if (k.startsWith('pad/')) bindeAutomation(d, Number(k.slice(4)));
  if (KNOB_GRUPPE[k] && !graphVon(k)) bindeKnobs(d, KNOB_GRUPPE[k]);
  bindeBkKnobs(d, k);
  zeigeGraphWahl();
  zeigeFxDetail();
}
// Baukasten S2: die acht Knobs von Cypher Modular (POST /klang params/param). Ein Surge-Wirt meldet keine Knobs; dann steht das da.
export async function bindeKnobs(d, gruppe) {
  const status = d.querySelector('.knobstatus'), liste = d.querySelector('.knobliste');
  let r;
  try { r = await postJson('/klang', { gruppe, aktion: 'params' }); } catch (e) { status.textContent = `page server unreachable: ${e.message}`; return; }
  if (!d.isConnected) return;   // inzwischen ein anderer Kanal gewählt
  const knobs = r.ok ? knobListe(r.j.params, r.j.namen) : [];
  // Surge und der SFZ-Wirt kennen params nicht („unbekannter Befehl“): ein Instrument ohne Knobs, kein Fehler
  if (!r.ok && !/unbekannter Befehl/.test(r.j?.text ?? '')) { status.textContent = `no instrument host (${r.j?.text ?? r.code})`; return; }
  if (!knobs.length) { status.textContent = 'this instrument has no knobs (Cypher Modular only)'; return; }
  status.textContent = `Cypher Modular · ${gruppe}`;
  liste.innerHTML = knobs.map((x) => `<label title="${x.param}">${htmlText(x.name)}<input type="range" min="0" max="1" step="0.001" value="${x.wert}" data-knob="${x.param}" aria-label="${gruppe} ${htmlText(x.name)}"><output>${x.wert.toFixed(2)}</output></label>`).join('');
  for (const inp of liste.querySelectorAll('input[data-knob]')) {
    let warte = null;
    inp.addEventListener('input', () => {
      inp.nextElementSibling.textContent = Number(inp.value).toFixed(2);
      if (warte) return;
      warte = setTimeout(async () => {
        warte = null;
        let a;
        try { a = await postJson('/klang', { gruppe, aktion: 'param', name: inp.dataset.knob, wert: Number(inp.value) }); } catch (e) { melde(`Knob not sent: ${e.message}`, true); return; }
        window.djkGesendet.push({ knob: inp.dataset.knob, wert: Number(inp.value), code: a.code, antwort: a.j });
        if (!a.ok) melde(`Knob refused: ${a.j?.text ?? a.j?.fehler ?? a.code}`, true);
      }, 40);
    });
  }
}
