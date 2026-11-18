// Workbench top bar: TO SEQ DECK with a choice of the place 1 to 4. The open module becomes a SEQ deck of the DJ view (one pattern per instrument track, same
// instrument, same notes, same knob values). On a click: the usual confirmation of the live container (opening LIVE closes the module), POST /live/oeffnen,
// POST /seq/modul, then the DJ view. A refusal, or what the load left out, is one readable line. It appends to the top bar, so it runs after bindeKopf.
import { modulZuSeq, PLAETZE } from '../module_after_seq.js';

export const ZU_SEQ_TEXT = {
  knopf: 'TO SEQ DECK',
  titel: 'Open the live container and load this module as a SEQ deck of the DJ view (the module closes; open it again from the shelf)',
  platz: 'SEQ place',
  laeuft: 'LOADING…',
};

export function bindeZuSeq(ctx) {
  const { st, $ } = ctx;
  const kopf = $('kopf');
  const wahl = document.createElement('select');
  wahl.dataset.w = 'zu-seq-platz'; wahl.className = 'w-zu-seq-platz'; wahl.title = ZU_SEQ_TEXT.platz; wahl.setAttribute('aria-label', ZU_SEQ_TEXT.platz);
  for (const n of PLAETZE) { const o = document.createElement('option'); o.value = String(n); o.textContent = `SEQ ${n}`; wahl.append(o); }
  const knopf = document.createElement('button');
  knopf.type = 'button'; knopf.dataset.w = 'zu-seq'; knopf.className = 'w-export w-zu-seq'; knopf.textContent = ZU_SEQ_TEXT.knopf; knopf.title = ZU_SEQ_TEXT.titel;
  knopf.disabled = true;
  kopf.append(wahl, knopf);

  let laeuft = false;
  const zeige = () => { knopf.disabled = !st.projekt || laeuft; wahl.disabled = laeuft; knopf.classList.toggle('laeuft', laeuft); };
  ctx.beimProjekt.push(zeige);

  knopf.addEventListener('click', async () => {
    if (laeuft || !st.projekt) return;
    const slug = st.slug, platz = Number(wahl.value);
    laeuft = true; knopf.textContent = ZU_SEQ_TEXT.laeuft; zeige();
    try {
      const r = await modulZuSeq(slug, platz, ctx.holeJson, (t) => ctx.frage(t));
      if (r.abgelehnt) return;
      ctx.melde(r.text, !r.ok);
      if (r.ok) ctx.zeigeDj?.();
    } finally { laeuft = false; knopf.textContent = ZU_SEQ_TEXT.knopf; zeige(); }
  });
}
