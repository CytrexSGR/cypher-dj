// The names of the COLOR arts (core control color/art 0..5) and the label the lane strips show. Shared by color_view.js (mixer channels) and the
// loop lane strips (session/strip.js, loopdeck/view.js), which carry `data-colorname` on their COLOR label.
import { zustand } from './page_state.js';

export const COLOR_ARTEN = ['FILTER', 'SPACE', 'DUB ECHO', 'SWEEP', 'NOISE', 'CRUSH'];
export function colorArt() { const w = zustand.regler?.['color/art']; return typeof w === 'number' ? Math.round(w) : 0; }
export const colorName = () => COLOR_ARTEN[colorArt()] ?? 'FILTER';
/** Sets the label of one lane strip COLOR knob to the current art. */
export function zeigeColorName(l) { const n = colorName(); if (l.textContent !== n) l.textContent = n; l.classList.toggle('color-an', colorArt() !== 0); }
