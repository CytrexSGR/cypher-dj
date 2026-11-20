// Whether a control of a front panel is heard right now (Andreas 2026-11-18: "das ist nicht zu erkennen wenn man das innenleben nicht kennt, könnte man das
// visuell sichtbar machen?"). A control of the panel file may carry `wirkt`: a condition on other controls of the same panel, and `wirkt_text`: what to do
// to hear it. While the condition is false the renderer greys the cell (panel.js, class fp-ruht) and puts the text in its tooltip; the control still moves.
//
// Conditions (values are the controls' 0..1 values as shown; a selector's value is its option index):
//   { ueber: [id, x] }     the value of control `id` is above x
//   { unter: [id, x] }     the value of control `id` is below x
//   { weg: [id, tol?] }    a bipolar control (off at the middle) is away from the middle by more than tol (default 0.01)
//   { ist: [id, [i...]] }  the selector `id` stands on one of the option indices
//   { alle: [c...] }       every condition holds;  { eine: [c...] }  at least one holds
// An unknown control id, or a condition the panel cannot read, counts as true: a broken rule never greys a control that may be heard.
import { diskretIndex } from './panel_skala.js';

const TOL = 0.01;

/** Evaluates condition `b`. `wert(id)` -> the control's 0..1 value or undefined; `optionen(id)` -> the option count of a selector or 0. Pure. */
export function bedingungGilt(b, wert, optionen) {
  if (!b || typeof b !== 'object') return true;
  if (Array.isArray(b.alle)) return b.alle.every((x) => bedingungGilt(x, wert, optionen));
  if (Array.isArray(b.eine)) return b.eine.some((x) => bedingungGilt(x, wert, optionen));
  const [art] = Object.keys(b);
  const a = b[art];
  if (!Array.isArray(a)) return true;
  const v = wert(a[0]);
  if (typeof v !== 'number' || !Number.isFinite(v)) return true;
  switch (art) {
    case 'ueber': return v > a[1];
    case 'unter': return v < a[1];
    case 'weg': return Math.abs(v - 0.5) > (typeof a[1] === 'number' ? a[1] : TOL);
    case 'ist': { const n = optionen(a[0]); return n > 0 && Array.isArray(a[1]) ? a[1].includes(diskretIndex(v, n)) : true; }
    default: return true;
  }
}

/** For the controls with `wirkt`: { id: text | null } (null = heard; text = greyed, with the hint). `k` = { param: 0..1 } of the panel. Pure. */
export function ruhendeSteuerungen(alle, k) {
  const nachId = new Map(alle.map((c) => [c.id, c]));
  const param = (c) => c?.bind?.param ?? null;
  const wert = (id) => { const p = param(nachId.get(id)); return p === null ? undefined : k[p]; };
  const optionen = (id) => { const c = nachId.get(id); return c?.type === 'selector' ? (c.options?.length ?? 0) : 0; };
  const aus = {};
  for (const c of alle) {
    if (!c.wirkt) continue;
    aus[c.id] = bedingungGilt(c.wirkt, wert, optionen) ? null : (typeof c.wirkt_text === 'string' && c.wirkt_text ? c.wirkt_text : 'Not heard with the current settings');
  }
  return aus;
}
