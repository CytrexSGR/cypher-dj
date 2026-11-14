// Sound color FX (zeigeColor, bindeColor).
import { colorKnopf } from './mischer_mitte.js';   // mixer middle column, knob look
import { $, $$, melde, zustand } from './page_state.js';

// SOUND COLOR FX (2026-10-11, wie am XDJ-XZ): Art und PARAMETER global über /regler (sofort, Quelle andreas), angezeigt aus
// /e/regler. Der COLOR-Regler jedes Kanals ist `filter`; seine Beschriftung zeigt die gewählte Art.
const COLOR_ARTEN = ['FILTER', 'SPACE', 'DUB ECHO', 'SWEEP', 'NOISE', 'CRUSH'];
function colorArt() { const w = zustand.regler?.['color/art']; return typeof w === 'number' ? Math.round(w) : 0; }
export function zeigeColor() {
  const a = colorArt();
  for (const b of $$('[data-colorart]')) { const an = Number(b.dataset.colorart) === a; b.classList.toggle('an', an); b.setAttribute('aria-checked', String(an)); }
  for (const l of $$('.knopf[data-teil="filter"] + .beschrift label')) { l.textContent = COLOR_ARTEN[a] ?? 'FILTER'; l.classList.toggle('color-an', a !== 0); }
  const p = zustand.regler?.['color/param'];
  const s = $('#colorparam');
  if (s && typeof p === 'number' && !document.querySelector('.colorknopf.gegriffen')) { s.value = String(p); zeichneColorKnopf(); }
  const o = $('[data-colorparam]');
  if (o) o.textContent = `${Math.round((typeof p === 'number' ? p : Number(s?.value ?? 0.5)) * 100)}%`;
  $('#colorfx')?.classList.toggle('filter-art', a === 0);   // PARAMETER does nothing on FILTER (colorfx.cpp): shown dimmed with a note
}
let zeichneColorKnopf = () => {};
async function setzeColor(pfad, nach) {
  try {
    const r = await fetch('/regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad, nach, ab: 'jetzt' }) });
    const j = await r.json();
    window.djkGesendet.push({ [pfad]: nach, code: r.status, antwort: j });
    if (r.status !== 200) melde(`Color FX refused: ${j?.fehler ?? r.status}`, true);
    else if (j?.quittung?.status === 6) melde(`Color FX refused: ${j.quittung.grund}`, true);
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}
export function bindeColor() {
  for (const b of $$('[data-colorart]')) {
    b.addEventListener('click', () => {
      const n = Number(b.dataset.colorart);
      setzeColor('color/art', n === colorArt() ? 0 : n);   // wie am Pult: die leuchtende Taste noch einmal = zurück auf FILTER
    });
  }
  const s = $('#colorparam');
  zeichneColorKnopf = colorKnopf(s);
  let warte = null;
  s?.addEventListener('input', () => {
    const o = $('[data-colorparam]'); if (o) o.textContent = `${Math.round(Number(s.value) * 100)}%`;
    if (warte) return;
    warte = setTimeout(() => { warte = null; setzeColor('color/param', Number(s.value)); }, 40);
  });
  zeigeColor();
}
