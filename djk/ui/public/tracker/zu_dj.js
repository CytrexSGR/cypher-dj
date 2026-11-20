// TRACKER view, TO DJ (plan 2026-11-18-tracker.md, task 24): the section the cursor is in becomes patterns of a SEQ deck of the DJ view. The place (1..4) is the
// select of the bar (kopf.js), the button is the one of the bar; this module only wires them. On a click: the usual confirmation of the live container
// (opening LIVE closes the open project), POST /live/oeffnen, POST /seq/modul {slug, platz, abschnitt}, then the DJ view. The project itself is not changed.
// The length is checked here first, so a section that cannot go does not even close the project.
import { abschnitte } from './grid_model.js';
import { modulZuSeq } from '../module_after_seq.js';

export const SEQ_BEATS = 64;   // the region of a SEQ pattern (project/seq.ts)
export const ZU_DJ_TEXT = { knopf: 'TO DJ', laeuft: 'SENDING…' };
const zwei = (n) => String(n).padStart(2, '0');

// The refusal text of a section that is too long (the same words as the server), or null. Pure.
export function zuDjVorab(projekt, abschnittId) {
  const a = projekt ? abschnitte(projekt).find((x) => x.id === abschnittId) : undefined;
  if (!a) return 'That section does not exist';
  const n = Math.round(a.laenge_beats * 1e9) / 1e9;
  return n > SEQ_BEATS ? `section ${zwei(a.nr)} is ${n} beats long, a SEQ deck takes at most ${SEQ_BEATS}` : null;
}

export function bindeZuDj(ctx) {
  const { st, $ } = ctx;
  const knopf = $('zu-dj'), wahl = $('zu-dj-platz');
  if (!knopf || !wahl) return;
  let laeuft = false;
  const zeige = () => { knopf.disabled = !st.projekt || st.abschnitt_id === null || laeuft; wahl.disabled = !st.projekt || laeuft; knopf.classList.toggle('laeuft', laeuft); };
  ctx.beimProjekt.push(zeige);
  ctx.beimZeichnen.push(zeige);
  knopf.addEventListener('click', async () => {
    if (laeuft || !st.projekt || st.abschnitt_id === null) return;
    const vorab = zuDjVorab(st.projekt, st.abschnitt_id);
    if (vorab !== null) { ctx.melde(`Send refused: ${vorab}`, true); return; }
    const slug = st.slug, abschnitt = st.abschnitt_id, platz = Number(wahl.value);
    laeuft = true; knopf.textContent = ZU_DJ_TEXT.laeuft; zeige();
    try {
      const r = await modulZuSeq(slug, platz, ctx.holeJson, (t) => ctx.frage(t), abschnitt);
      if (r.abgelehnt) return;
      ctx.melde(r.text, !r.ok);
      if (r.ok) ctx.zeigeDj?.();
    } finally { laeuft = false; knopf.textContent = ZU_DJ_TEXT.knopf; zeige(); }
  });
}
