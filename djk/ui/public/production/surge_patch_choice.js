// PRODUCTION: the patch picker of a Surge track. The head menu entry SURGE PATCH opens a small panel with a text field whose suggestion list is the Surge
// patch library (GET /proj/surge_patches?text=, the names `klang liste` prints: own sounds and factory patches). SET stores the name in geraet.patch
// (spur_aendern with the whole device: one undo step, the freeze of the track goes); CLEAR removes it (the host keeps what it plays). The server checks the
// name (patch_unbekannt) and loads the patch into the host of the slot.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// the command of a pick: the whole device of the track with patch set (or without it for CLEAR)
export function patchBefehl(spur, name) {
  const { patch: _alt, ...rest } = spur.geraet;
  return { befehl: 'spur_aendern', spur_id: spur.id, geraet: name ? { ...rest, patch: name } : rest };
}
export const patchLabel = (spur, name) => (name ? `Surge patch ${name} ${spur.id}` : `Clear Surge patch ${spur.id}`);

export function oeffnePatchWahl(ctx, spur, doc = document) {
  doc.querySelector('.p-patchwahl')?.remove();
  const feld = doc.createElement('div');
  feld.className = 'p-patchwahl'; feld.setAttribute('role', 'dialog'); feld.setAttribute('aria-label', 'Surge patch');
  feld.innerHTML = `<label>Surge patch · ${esc(spur.name ?? spur.id)}<br><input type="text" list="p-patchliste" autocomplete="off" spellcheck="false" placeholder="search the library, e.g. Pads/Warm" aria-label="Surge patch name" value="${esc(spur.geraet.patch ?? '')}"></label>
<datalist id="p-patchliste"></datalist>
<div class="p-patchwahl-knoepfe"><button type="button" data-p="setze">SET</button><button type="button" data-p="leer"${spur.geraet.patch === undefined ? ' disabled' : ''}>CLEAR</button><button type="button" data-p="zu">CLOSE</button></div>
<div class="p-patchwahl-hinweis" role="status"></div>`;
  doc.body.append(feld);
  const eingabe = feld.querySelector('input'), liste = feld.querySelector('datalist'), hinweis = feld.querySelector('.p-patchwahl-hinweis');
  let folge = 0;
  const lade = async () => {
    const mein = ++folge;
    const r = await ctx.holeGet(`/proj/surge_patches?text=${encodeURIComponent(eingabe.value.trim())}`);
    if (mein !== folge || !feld.isConnected) return;
    if (r.status !== 200 || !Array.isArray(r.j?.patches)) { hinweis.textContent = ctx.antwortText(r); return; }
    liste.innerHTML = r.j.patches.map((p) => `<option value="${esc(p.name)}" label="${p.art === 'own' ? 'own' : 'factory'}"></option>`).join('');
    hinweis.textContent = r.j.patches.length === 0 ? 'No patch of that name in the library' : `${r.j.patches.length} in the library`;
  };
  let uhr = null;
  eingabe.addEventListener('input', () => { clearTimeout(uhr); uhr = setTimeout(lade, 120); });
  const zu = () => { clearTimeout(uhr); feld.remove(); };
  const setze = async (name) => { const ok = await ctx.aendere(patchLabel(spur, name), [patchBefehl(spur, name)]); if (ok) zu(); else hinweis.textContent = 'Not taken: see the message'; };   // a refusal (patch_unbekannt) is toasted by the writer
  feld.addEventListener('click', (e) => {
    const p = e.target?.dataset?.p;
    if (p === 'zu') zu(); else if (p === 'leer') setze(''); else if (p === 'setze' && eingabe.value.trim()) setze(eingabe.value.trim());
  });
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') zu();
    else if (e.key === 'Enter' && eingabe.value.trim()) setze(eingabe.value.trim());
  });
  lade();
  eingabe.focus({ preventScroll: true }); eingabe.select();
  return feld;
}
