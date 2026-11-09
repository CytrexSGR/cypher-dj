// PRODUCTION (D1 V1): Projekt neu (NEW, Name eintippen, Enter) und öffnen (OPEN…, Liste aus GET /proj/liste), Spec 3.4.
// Löschen gibt es hier nicht (G3: Löschen gehört Andreas, und die Spec kennt keine Route dafür).
export function bindeProjektwahl(ctx) {
  const { $ } = ctx;
  $('neu').addEventListener('click', () => { const f = $('neu-name'); f.hidden = false; f.value = ''; f.focus(); });
  $('neu-name').addEventListener('keydown', async (e) => {
    e.stopPropagation();                                  // L, G, Esc der Library-Tasten nicht auslösen
    const f = $('neu-name');
    if (e.key === 'Escape') { f.hidden = true; return; }
    if (e.key !== 'Enter' || f.value.trim() === '') return;
    f.hidden = true;
    const r = await ctx.holeJson('/proj/neu', { name: f.value.trim() });
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
    const r = await ctx.holeJson('/proj/oeffnen', { slug });
    if (r.status === 200 && r.j?.projekt) ctx.uebernimm(r.j.slug, r.j.projekt); else ctx.melde(ctx.antwortText(r), true);
  });
}
