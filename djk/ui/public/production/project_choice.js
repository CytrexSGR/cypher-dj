// PRODUCTION (D1 V1): Projekt neu (NEW, Name eintippen, Enter) und öffnen (OPEN…, Liste aus GET /proj/liste), Spec 3.4.
// Löschen gibt es hier nicht (G3: Löschen gehört Andreas, und die Spec kennt keine Route dafür).
// Spec 6.2: opening or creating a project while the live container plays stops its modules. The server answers 409 live_laeuft until Andreas confirms;
// then the same request goes again with bestaetigt: true. `abgelehnt` in the result = he said no (nothing to report).
export const LIVE_LAEUFT_FRAGE = 'Modules are playing in the live container. Opening another project stops them. Open anyway?';
export async function mitBestaetigung(holeJson, pfad, koerper, frage) {
  const r = await holeJson(pfad, koerper);
  if (r.status !== 409 || r.j?.fehler !== 'live_laeuft') return r;
  if (!frage(LIVE_LAEUFT_FRAGE)) return { ...r, abgelehnt: true };
  return holeJson(pfad, { ...koerper, bestaetigt: true });
}
const frageAndreas = (t) => globalThis.confirm?.(t) ?? false;

export function bindeProjektwahl(ctx) {
  const { $ } = ctx;
  $('neu').addEventListener('click', () => { const f = $('neu-name'); f.hidden = false; f.value = ''; f.focus(); });
  $('neu-name').addEventListener('keydown', async (e) => {
    e.stopPropagation();                                  // L, G, Esc der Library-Tasten nicht auslösen
    const f = $('neu-name');
    if (e.key === 'Escape') { f.hidden = true; return; }
    if (e.key !== 'Enter' || f.value.trim() === '') return;
    f.hidden = true;
    const r = await mitBestaetigung(ctx.holeJson, '/proj/neu', { name: f.value.trim() }, frageAndreas);
    if (r.abgelehnt) return;
    if (r.status === 200 && r.j?.projekt) ctx.uebernimm(r.j.slug, r.j.projekt); else ctx.melde(ctx.antwortText(r), true);   // H5: 5xx ohne Grund wie der Schreibweg
  });
  async function fuelleListe() {
    const r = await ctx.holeGet('/proj/liste');
    if (r.status !== 200 || !Array.isArray(r.j)) return;
    const s = $('oeffnen');
    s.length = 1;
    for (const x of r.j) { const o = document.createElement('option'); o.value = x.slug; o.textContent = x.name; s.append(o); }
  }
  $('oeffnen').addEventListener('pointerdown', fuelleListe);
  $('oeffnen').addEventListener('focus', fuelleListe);
  $('oeffnen').addEventListener('change', async () => {
    const slug = $('oeffnen').value;
    $('oeffnen').value = '';
    if (!slug) return;
    const r = await mitBestaetigung(ctx.holeJson, '/proj/oeffnen', { slug }, frageAndreas);
    if (r.abgelehnt) return;
    if (r.status === 200 && r.j?.projekt) ctx.uebernimm(r.j.slug, r.j.projekt); else ctx.melde(ctx.antwortText(r), true);
  });
}
