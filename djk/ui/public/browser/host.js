// Per-view host of the browser (browser plan 2, task 3): everything that differs between PRODUCTION, DJ, STUDIO and TRACKER.
// A view registers what it has (registriereHost); holeHost fills the rest with page-wide defaults. Nothing here touches the DOM at import time.
import { mitBestaetigung } from '../production/project_choice.js';

const eingetragen = new Map();

export function registriereHost(ansicht, teile) { eingetragen.set(ansicht, { ...(eingetragen.get(ansicht) ?? {}), ...teile }); }

const lies = async (r) => { try { return await r.json(); } catch { return null; } };
const standardGet = async (url) => {
  try { const r = await fetch(url); return { status: r.status, j: await lies(r) }; } catch (e) { return { status: 0, j: { fehler: 'netz', text: e.message } }; }
};
const standardJson = async (url, body) => {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, j: await lies(r) };
  } catch (e) { return { status: 0, j: { fehler: 'netz', text: e.message } }; }
};
const standardMelde = (text, fehler = false) => {
  const m = globalThis.document?.querySelector('#meldung');
  if (!m) return;
  m.textContent = text; m.className = fehler ? 'fehler' : 'ok';
};

export function standardHost(ansicht, teile = {}) {
  const h = { ansicht, holeGet: standardGet, holeJson: standardJson, melde: standardMelde, projekt: () => null, nachWechsel: () => {}, ...teile };
  const ergebnis = (r) => (r.abgelehnt ? { ok: false } : r.status === 200 ? { ok: true } : { ok: false, text: r.j?.text ?? 'The request failed' });
  const frage = (t) => globalThis.confirm?.(t) ?? false;
  h.neu ??= async (name) => { const r = await mitBestaetigung(h.holeJson, '/proj/neu', { name }, frage); const e = ergebnis(r); if (e.ok) h.nachWechsel(); return e; };
  h.oeffne ??= async (slug) => { const r = await mitBestaetigung(h.holeJson, '/proj/oeffnen', { slug }, frage); const e = ergebnis(r); if (e.ok) h.nachWechsel(); return e; };
  h.vorhoeren ??= async (row) => { const m = await import('../prelisten_view.js'); m.vorhoeren(row); };
  h.stoppeVorhoeren ??= async () => { const m = await import('../prelisten_view.js'); m.vorhoerenStopp(); };
  return h;
}

export function holeHost(ansicht) { return standardHost(ansicht, eingetragen.get(ansicht) ?? {}); }
