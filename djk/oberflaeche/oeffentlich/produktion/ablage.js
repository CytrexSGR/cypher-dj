// PRODUCTION (D1 V1): Ziehen aus LIBRARY auf eine Audio-Spur (Spec 2.11, A2). Die Zeilen des vorhandenen Browsers
// (#libliste, app.js stoebernZeile) bekommen nur in PRODUCTION draggable, und nur, wenn nutzlast() sie annimmt; die
// DJ-Ansicht bleibt unverändert. Ablegen schickt clip_neu mit dem Katalog-sha (Pfad löst der Server).
import { ZIEH_TYP, nutzlast, ablageBefehl, ABLAGE_TEXT } from './ziehen.js';
import { xZuBeat, rasterBeats } from './zeitachse.js';
import { spurIndexBei } from './layout.js';

export function bindeAblage(ctx) {
  const { st, $ } = ctx;
  const liste = document.querySelector('#libliste');
  const zeileZu = (tr) => ctx.stoebern()?.treffer?.[Number(tr?.dataset.i)];
  function markiere() {
    if (!liste) return;
    for (const tr of liste.rows) {
      if (st.sichtbar && nutzlast(zeileZu(tr))) { if (!tr.draggable) { tr.draggable = true; tr.dataset.prodZieh = '1'; } }
      else if (tr.dataset.prodZieh) { tr.draggable = false; delete tr.dataset.prodZieh; }
    }
  }
  if (liste) {
    new MutationObserver(markiere).observe(liste, { childList: true });
    liste.addEventListener('dragstart', (e) => {
      if (!st.sichtbar) return;
      const n = nutzlast(zeileZu(e.target.closest?.('tr')));
      if (n) { e.dataTransfer.setData(ZIEH_TYP, JSON.stringify(n)); e.dataTransfer.effectAllowed = 'copy'; }
    });
  }
  ctx.beimSichtwechsel.push(markiere);
  const ueber = $('ueber');
  ueber.addEventListener('dragover', (e) => {
    if (!st.projekt || !e.dataTransfer.types.includes(ZIEH_TYP)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    st.geist = { x: e.offsetX, spur: spurIndexBei(e.offsetY, st.projekt.spuren.length) };
  });
  ueber.addEventListener('dragleave', () => { st.geist = null; });
  ueber.addEventListener('drop', (e) => {
    st.geist = null;
    if (!st.projekt || !e.dataTransfer.types.includes(ZIEH_TYP)) return;
    e.preventDefault();
    let n = null; try { n = JSON.parse(e.dataTransfer.getData(ZIEH_TYP)); } catch { return; }
    const i = spurIndexBei(e.offsetY, st.projekt.spuren.length), beat = xZuBeat(st.ansicht, e.offsetX), raster = rasterBeats(st.raster);
    const r = ablageBefehl(st.projekt, n, i, beat, raster);
    if (r.fehler) { ctx.melde(ABLAGE_TEXT[r.fehler], true); return; }
    // V2 Fix-Runde 2 H1 (Spec 6.34): die Spur, auf die die Person gezeigt hat, bleibt fest; die Länge in Beats folgt aus dem Tempo im Stand beim
    // Senden (ctx.aendereAus), nicht beim Ablegen: ein TEMPO davor, der noch unterwegs ist, zählt mit
    const spurId = r.befehl.spur_id;
    ctx.aendereAus((p) => {
      const x = ablageBefehl(p, n, p.spuren.findIndex((s) => s.id === spurId), beat, raster);
      return x.befehl ? { label: 'Add clip', befehle: [x.befehl] } : null;
    });
  });
}
