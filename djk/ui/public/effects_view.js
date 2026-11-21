// EFFECTS: the senders, meters and readings of the live tools (gate, utility, bus, master limiter, compressor GR) that the live dock uses (live_dock/),
// the chosen channel (fxGewaehlt, read by PRESETS) and the Cypher Modular knobs of the INSTRUMENTS tab. The tab itself shows the dock (live_dock/host.js).
import { masterLimiterLesung, setzeWerkzeug, werkText, werkzeugKlickNach, limiterZustand, mixAblaufIn, BUS_KANAELE, MIX_FELDER, mixLesung, GATE_KANAELE, GATE_FELDER, GATE_SKALA_DB, werkFeld, htmlText, knobListe } from './effects.js';
import { $, $$, melde, postJson, zustand } from './page_state.js';
import { kompGr, kompWert } from './effects_gemeinsam.js';
import { FX_KANAELE } from './live_kanaele.js';
import { CONTAINER } from './kanaele.js';
import { FX_REITER_SCHLUESSEL, fxReiterAktiv } from './effects_reiter.js';
// A8: the Gate and Utility controls (the popovers and bus windows of the live dock). One handler on a body: sliders send after 40 ms, switches toggle from the live value.
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
/** The channel limiter state of the last /lage (limiterZustand), read by the live dock. */
export function limiterJetzt() { return limiterStand; }
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
// The master limiter: gain reduction of the master limiter from the `limiter_db` of /zustand/arr (the only stream value there is for it; the core holds it
// 0.5 s and sends at 2 Hz idle, up to 50 Hz while the transport waits or plays). No reading (field absent) or none for 3 s: "–".
let masterLimiterTimer = null;
let masterLimiterDb = null;
export function masterLimiterJetzt() { return masterLimiterDb; }
export function zeigeMasterLimiter(arr) {
  const i = $('[data-messer="master|limiter_db"]'), z = $('[data-messer-zahl="master|limiter_db"]');
  const db = arr === null ? null : masterLimiterLesung(arr);
  masterLimiterDb = db;
  if (i && z) {
    i.style.width = `${Math.min(100, ((db ?? 0) / 24) * 100)}%`;
    z.textContent = db === null ? '–' : `${db.toFixed(1)} dB`;
  }
  clearTimeout(masterLimiterTimer);   // the reading falls back to "–" after 3 s also without a meter on the page (the live dock reads masterLimiterJetzt)
  if (db !== null) masterLimiterTimer = setTimeout(() => zeigeMasterLimiter(null), 3000);   // armed by a reading only: the fall back to "–" does not re-arm itself
}
// A6: gate meters of the source channels from /zustand/mix (gate_db), same 500 ms rule and self-scheduled reset as the bus meters.
export const gateMix = {};
export function gateGrJetzt(k) { return mixLesung(gateMix, k, 'gate_db', performance.now()); }
export function busGrJetzt(k, feld) { return mixLesung(busMix, k, feld, performance.now()); }
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
// Show the live control state in a tool body (from /e/regler); a slider under the pointer is not moved.
export function zeigeWerkzeugIn(s, k) {
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
export function zeigeWerkzeug(nur) {
  for (const s of $$('.busstreifen')) {
    const k = s.dataset.kanal;
    if (nur && nur !== k) continue;
    zeigeWerkzeugIn(s, k);
  }
}
// the channel in front (the PRESETS tab works on it): the stored tab, when it is a channel (the channel list comes from the leaf module live_kanaele.js, which is initialised at any import order)
export let fxGewaehlt = (() => { const a = fxReiterAktiv(); return FX_KANAELE.some(([p]) => p === a) ? a : CONTAINER[0].pfad; })();
export const kompVerlauf = {};   // kanal -> letzte 100 Absenkungen (10 Hz)
export function grJetzt(k) { const g = kompGr[k]; return kompWert(k, 'an', 0) >= 0.5 && g && performance.now() - g.t < 400 ? g.db : 0; }
export function setzeFxGewaehlt(k) {
  fxGewaehlt = k;
  try { localStorage.setItem(FX_REITER_SCHLUESSEL, k); } catch { /* without storage the choice lives for this page load */ }
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
