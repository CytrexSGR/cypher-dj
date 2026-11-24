// PRODUCTION (D1 V1): Undo/Redo (Knöpfe, Strg+Z, Strg+Umschalt+Z, Strg+Y) und Verlaufsanzeige HISTORY (Spec 3.3/3.4,
// A8-Bedienung). Der Verlauf kommt nach jedem neuen Stand frisch aus GET /proj/verlauf; Quelle Cypher ist sichtbar (A9).
import { undoStand, verlaufZeilen, labelText } from './history.js';
import { nurJuengste } from './load.js';

// Strg+Z/Strg+Y gehören dem Feld, solange darin Text steht: Text-, Zahl- und Auswahlfelder behalten ihr eigenes Zurück.
// Regler (type=range: Fader, Pan) schreiben keinen Text; mit der Hand am Fader soll Strg+Z das Projekt zurücknehmen.
export function istTextFeld(z) {
  if (!z) return false;
  const tag = String(z.tagName ?? '').toUpperCase();
  if (tag === 'INPUT') return String(z.type ?? 'text').toLowerCase() !== 'range';
  return tag === 'TEXTAREA' || tag === 'SELECT' || z.isContentEditable === true;
}

export function bindeVerlauf(ctx) {
  const { st, $ } = ctx;
  st.verlauf = [];
  function zeige() {
    const u = undoStand(st.verlauf);
    $('undo').disabled = !st.projekt || !u.undo; $('undo').title = u.undo ? `Undo: ${labelText(u.undo.label)} (Ctrl+Z)` : 'Nothing to undo';
    $('redo').disabled = !st.projekt || !u.redo; $('redo').title = u.redo ? `Redo: ${labelText(u.redo.label)} (Ctrl+Shift+Z)` : 'Nothing to redo';
    const ol = $('verlauf-liste'); ol.textContent = '';
    for (const z of verlaufZeilen(st.verlauf)) {
      const li = document.createElement('li'); li.className = `p-verlauf-${z.art}`; li.dataset.rev = String(z.rev);
      li.textContent = `${z.zeit}  ${z.text}  · ${z.quelle}`; ol.append(li);
    }
  }
  // Überlappende Abrufe (Antwort und SSE kurz hintereinander): nur die jüngste Antwort gilt
  const holeVerlauf = nurJuengste(() => ctx.holeGet('/proj/verlauf'));
  async function lade() {
    if (!st.slug) { st.verlauf = []; zeige(); return; }
    const { gilt, r } = await holeVerlauf();
    if (gilt && r.status === 200 && Array.isArray(r.j)) { st.verlauf = r.j; zeige(); }
  }
  ctx.nachLaden.push(lade);
  ctx.beimProjekt.push((p, wechsel) => { if (wechsel) { st.verlauf = []; zeige(); schliesse(); } });
  $('undo').addEventListener('click', () => ctx.schreiber.undo());
  $('redo').addEventListener('click', () => ctx.schreiber.redo());
  // UI polish T7 (Nr. 19): the list closes on Escape, on a click outside it and its key, and when the project or the view changes
  const setzeOffen = (an) => { const l = $('verlauf-liste'); l.hidden = !an; $('verlauf').setAttribute('aria-expanded', String(an)); };
  const schliesse = () => { if (!$('verlauf-liste').hidden) setzeOffen(false); };
  $('verlauf').addEventListener('click', (e) => { e?.stopPropagation?.(); setzeOffen($('verlauf-liste').hidden); });
  document.addEventListener('click', (e) => { const z = e.target; if (z?.closest?.('#verlauf-liste') || z?.closest?.('#verlauf')) return; schliesse(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliesse(); });
  window.addEventListener('hashchange', schliesse);
  let war = document.body?.classList?.contains('produktion');
  if (typeof MutationObserver === 'function' && document.body) new MutationObserver(() => { const ist = document.body.classList.contains('produktion'); if (ist !== war) { war = ist; schliesse(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', (e) => {
    if (!st.sichtbar || !st.projekt || istTextFeld(e.target)) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); ctx.schreiber.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); ctx.schreiber.redo(); }
  });
}
