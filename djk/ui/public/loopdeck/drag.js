// Loop deck drag and drop (plan loop deck P4). Two kinds of drag end on a cell:
//   a library row or module entry   dataTransfer `application/x-djk-loopquelle`, JSON of the `quelle` ({ sha } | { loop } | { modul, stem? } ...)
//   a filled cell of any loop deck  dataTransfer `application/x-djk-loopzelle`, JSON { deck, spur, zelle }
// This module only reads and writes the transfer; what a drop does is the caller's (view.js posts the routes).
export const TYP_QUELLE = 'application/x-djk-loopquelle';
export const TYP_ZELLE = 'application/x-djk-loopzelle';

const ganz = (x) => Number.isInteger(x) && x >= 1;
const typen = (e) => [...(e?.dataTransfer?.types ?? [])];

/** Makes a library row / module entry a drag source for `quelle`. */
export function quelleZiehbar(knoten, quelle) {
  knoten.draggable = true; knoten.setAttribute('draggable', 'true');
  knoten.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData(TYP_QUELLE, JSON.stringify(quelle));
    e.dataTransfer?.setData('text/plain', JSON.stringify(quelle));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  });
}
/** Writes the transfer of a cell drag. */
export function schreibeZelle(e, koord) {
  e.dataTransfer?.setData(TYP_ZELLE, JSON.stringify({ deck: koord.deck, spur: koord.spur, zelle: koord.zelle }));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
/** What a drop carries: { art: 'quelle', quelle } | { art: 'zelle', von: { deck, spur, zelle } } | null (something else, or malformed). */
export function leseAblage(e) {
  const dt = e?.dataTransfer;
  if (!dt) return null;
  try {
    const z = dt.getData(TYP_ZELLE);
    if (z) { const v = JSON.parse(z); return ganz(v?.deck) && ganz(v?.spur) && ganz(v?.zelle) ? { art: 'zelle', von: { deck: v.deck, spur: v.spur, zelle: v.zelle } } : null; }
    const q = dt.getData(TYP_QUELLE);
    if (q) { const v = JSON.parse(q); return v && typeof v === 'object' && !Array.isArray(v) ? { art: 'quelle', quelle: v } : null; }
  } catch { /* not ours */ }
  return null;
}
/** Does the drag in flight look like one of ours (dragover has no data yet, only the types)? */
export const istUnserer = (e) => { const t = typen(e); return t.includes(TYP_QUELLE) || t.includes(TYP_ZELLE); };

/** Makes `knoten` (a cell) a drop target. beiAblage(inhalt) gets what leseAblage returned; the target highlight is the class `ablage`. */
export function bindeAblage(knoten, beiAblage) {
  const aus = () => knoten.classList.remove('ablage');
  const ueber = (e) => { if (!istUnserer(e)) return; e.preventDefault?.(); knoten.classList.add('ablage'); if (e.dataTransfer) e.dataTransfer.dropEffect = typen(e).includes(TYP_ZELLE) ? 'move' : 'copy'; };
  knoten.addEventListener('dragenter', ueber);
  knoten.addEventListener('dragover', ueber);
  knoten.addEventListener('dragleave', aus);
  knoten.addEventListener('drop', (e) => {
    aus();
    const inhalt = leseAblage(e);
    if (!inhalt) return;
    e.preventDefault?.();
    beiAblage(inhalt);
  });
}
