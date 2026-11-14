// Control handles (neuerRegler), their display from the core state, and the send queue (sende, pumpe).
import { art, GRIFF, vorgabe, griffZuMidi, formatiere } from './curves.js';
import { veredleKnopf, bogenPfad } from './mischer_mitte.js';   // mixer middle column, knob look
import { $, $$, melde, zeigePruefmodus, zustand } from './page_state.js';
import { zeigePlaetzeSpaeter } from './slots_view.js';

// ---------- Senden: nacheinander, damit die Reihenfolge Stellung → Wert am Kern gilt ----------
const schlange = [];
let unterwegs = false;
window.djkGesendet = [];   // jede Antwort des Servers (Prüfung)
function sende(pfad, u, stellung = false) {
  const letzte = schlange.at(-1);
  if (!stellung && letzte && letzte.pfad === pfad && !letzte.stellung) letzte.u = u; // Bewegung zusammenfassen
  else schlange.push({ pfad, u, stellung });
  pumpe();
}
async function pumpe() {
  if (unterwegs) return;
  unterwegs = true;
  while (schlange.length) {
    const g = schlange.shift();
    try {
      const r = await fetch('/griff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad: g.pfad, u: g.u }) });
      const j = await r.json();
      window.djkGesendet.push({ ...g, code: r.status, antwort: j });
      if (r.status === 409 && j.fehler === 'pruefmodus_aus') zeigePruefmodus('aus');
      else if (!r.ok) melde(`Rejected: ${g.pfad} (${j.fehler})`, true);
    } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
  }
  unterwegs = false;
}

// ---------- Regler: Knopf (senkrecht ziehen), Fader (senkrecht), Crossfader (waagrecht) ----------
const regler = new Map(); // pfad → { el, x, gegriffen, zeige() }
window.djkRegler = regler; // für die Prüfung (lesen)

function neuerRegler(el) {
  const pfad = el.dataset.pfad;
  const a = art(pfad);
  const r = { el, pfad, a, x: GRIFF[a].stellung(vorgabe(pfad)), gegriffen: false };
  r.zeige = () => zeichne(r);
  regler.set(pfad, r);
  const weg = () => (el.classList.contains('knopf') ? 220 : el.classList.contains('waagrecht') ? $('.bahn', el).clientWidth : $('.bahn', el).clientHeight);
  let start = null;
  const setze = (x) => {
    r.x = Math.max(0, Math.min(1, x));
    r.zeige();
    sende(pfad, griffZuMidi(pfad, r.x));
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    r.gegriffen = true;
    el.classList.add('gegriffen');
    start = { x: r.x, px: e.clientX, py: e.clientY };
    sende(pfad, griffZuMidi(pfad, r.x), true); // Stellung zuerst (§7.3 Punkt 2)
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || !el.hasPointerCapture(e.pointerId)) return;
    const d = el.classList.contains('waagrecht') ? (e.clientX - start.px) : (start.py - e.clientY);
    const fein = e.shiftKey ? 0.2 : 1;
    setze(start.x + (d / weg()) * fein);
  });
  const los = (e) => {
    if (!start) return;
    start = null;
    r.gegriffen = false;
    el.classList.remove('gegriffen');
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    r.x = GRIFF[a].stellung(zustand.regler[pfad] ?? GRIFF[a].wert(r.x)); // Stellung auf den Kern-Wert
    r.zeige();
  };
  el.addEventListener('pointerup', los);
  el.addEventListener('pointercancel', los);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    sende(pfad, griffZuMidi(pfad, r.x), true);
    setze(r.x + (e.deltaY < 0 ? 0.02 : -0.02));
  }, { passive: false });
  el.addEventListener('dblclick', () => {               // zurück auf die Vorgabe (Fader und Pegel bleiben: kein Ruck nach oben)
    if (a === 'fader' || a === 'pegel') return;
    sende(pfad, griffZuMidi(pfad, r.x), true);
    setze(GRIFF[a].stellung(vorgabe(pfad)));
  });
  r.zeige();
}


export function zeichne(r) {
  const { el, x } = r;
  if (el.classList.contains('knopf')) {
    veredleKnopf(el);
    $('.zeiger', el).setAttribute('transform', `rotate(${-135 + 270 * x} 30 30)`);
    $('.bogen', el).setAttribute('d', x > 0.001 ? bogenPfad(x) : '');
  } else if (el.classList.contains('senkrecht')) {
    $('.kappe', el).style.bottom = `${x * 100}%`;
    el.style.setProperty('--k', x.toFixed(3));   // the groove fills up to the cap
  } else {
    $('.kappe', el).style.left = `${x * 100}%`;
  }
  el.setAttribute('aria-valuenow', x.toFixed(3));
}

// Ohne Meldung vom Kern steht die Vorgabe aus §1.5 grau da (der Kern schickt beim Abonnieren keinen Stand)
export function zeigeWert(pfad) {
  zeigePlaetzeSpaeter();
  const bestaetigt = pfad in zustand.regler;
  const w = bestaetigt ? zustand.regler[pfad] : vorgabe(pfad);
  for (const o of $$(`[data-wert="${CSS.escape(pfad)}"]`)) {
    o.textContent = formatiere(pfad, w);
    o.classList.toggle('vorgabe', !bestaetigt);
    o.title = bestaetigt ? 'value reported by the core' : 'default, not yet reported by the core';
  }
  const r = regler.get(pfad);
  if (r && !r.gegriffen && bestaetigt) { r.x = GRIFF[r.a].stellung(w); r.zeige(); }
  for (const b of $$(`.xzuweisung[data-pfad="${CSS.escape(pfad)}"] button`)) {
    b.classList.toggle('an', Number(b.dataset.stufe) === Math.round(w));
    b.classList.toggle('vorgabe', !bestaetigt);
  }
  const k = $(`.schalter[data-pfad="${CSS.escape(pfad)}"]`);
  if (k) k.classList.toggle('an', w >= 0.5);
}

export function bindeKnoepfe() {
  for (const el of $$('.regler[data-pfad]')) neuerRegler(el);
  for (const k of $$('.schalter[data-pfad]')) {   // Kill und PFL: Umschalter
    k.addEventListener('click', () => {
      const pfad = k.dataset.pfad;
      const ist = (zustand.regler[pfad] ?? 0) >= 0.5 ? 1 : 0;
      sende(pfad, ist, true);          // Stellung = jetziger Schalter
      sende(pfad, 1 - ist);
    });
  }
  for (const g of $$('.xzuweisung[data-pfad]')) {   // Crossfader-Zuweisung A/THRU/B (2026-09-27): Stellung = jetzige Seite
    for (const b of $$('button', g)) b.addEventListener('click', () => {
      const pfad = g.dataset.pfad;
      sende(pfad, GRIFF.xseite.stellung(zustand.regler[pfad] ?? vorgabe(pfad)), true);
      sende(pfad, GRIFF.xseite.stellung(Number(b.dataset.stufe)));
    });
  }
  for (const t of $$('[data-taste]')) {
    const pfad = t.dataset.pfad;
    t.addEventListener('pointerdown', (e) => { if (e.button !== 0 || t.disabled) return; t.classList.add('gedrueckt'); sende(pfad, 1); });
    const los = () => { if (!t.classList.contains('gedrueckt')) return; t.classList.remove('gedrueckt'); sende(pfad, 0); };
    t.addEventListener('pointerup', los);
    t.addEventListener('pointerleave', los);
  }
}
