// The tracks the APC20 drives in PRODUCTION (its bank of eight), marked on their heads with an orange bar at the right edge (2026-11-18). The page server sends
// the event `pult` ({ produktion, bank, banken, ids }) when the view, the bank or the tracks change (areas/controller/pult_production.ts); GET /controller/pult
// answers the same at load. One generated style rule on the track ids, so the mark survives every rebuild of the heads.

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** The CSS for the bank: nothing outside PRODUCTION. Pure. */
export function apcBankStil(stand) {
  const ids = stand?.produktion ? (stand.ids ?? []).filter((i) => typeof i === 'string' && ID.test(i)) : [];
  if (!ids.length) return '';
  const sel = ids.map((i) => `.p-kopf[data-spur="${i}"]`).join(', ');
  return `${sel} { background-image: linear-gradient(to right, transparent calc(100% - 4px), #ff9f0a calc(100% - 4px)); }\n`;
}

/** The ids of the bank from GET /controller/pult (spalten) or the event (ids). Pure. */
export const apcBankStand = (j) => (j && Array.isArray(j.spalten) ? { produktion: j.produktion, ids: j.spalten.filter(Boolean).map((s) => s.id) } : j);

export function zeigeApcBank(stand, dok = globalThis.document) {
  if (!dok?.head) return;
  let e = dok.getElementById('apc-bank-marke');
  if (!e) { e = dok.createElement('style'); e.id = 'apc-bank-marke'; dok.head.append(e); }
  const css = apcBankStil(apcBankStand(stand));
  if (e.textContent !== css) e.textContent = css;
}
