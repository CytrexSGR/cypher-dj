// Favourites and recently used, from the page: two fixed collections under /kollektionen (media browser B2).
// `post` is any (url, body) => Promise<{status, j}>, in the workbench ctx.holeJson.
export const FAVORITEN_SLUG = 'favourites';
export const ZULETZT_SLUG = 'recently-used';
const FEHLER_FAVORIT = 'The favourites could not be changed';
const posten = (sha) => ({ art: 'sample', sha });
const serverText = (r, vorgabe) => (typeof r?.j?.text === 'string' && r.j.text !== '' ? `${r.j.text.charAt(0).toUpperCase()}${r.j.text.slice(1)}` : vorgabe);

// an: true adds the sample to the favourites, false removes it
export async function setzeFavorit(post, sha, an) {
  let r;
  try { r = await post(`/kollektionen/${FAVORITEN_SLUG}/posten`, an ? { hinzu: [posten(sha)] } : { weg: [posten(sha)] }); }
  catch (e) { return { ok: false, text: FEHLER_FAVORIT }; }
  if (r?.status === 200) return { ok: true };
  return { ok: false, text: serverText(r, FEHLER_FAVORIT) };
}

// remove then add in one request: the sample moves to the front. Never throws; the caller does not wait for it.
export async function merkeBenutzt(post, sha) {
  try { await post(`/kollektionen/${ZULETZT_SLUG}/posten`, { weg: [posten(sha)], hinzu: [posten(sha)] }); } catch { /* recently used is a convenience */ }
}

// t: a catalog row {sha, favorit}. Flips at once; a refusal flips it back and calls melde(text, true).
export function sternKnopf(t, post, melde) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'w-kat-stern'; b.setAttribute('data-w', 'stern');
  const zeige = () => {
    const an = t.favorit === true;
    b.textContent = an ? '★' : '☆';
    b.setAttribute('aria-pressed', an ? 'true' : 'false');
    b.setAttribute('title', an ? 'Remove from favourites' : 'Mark as favourite');
    b.classList.toggle('an', an);
  };
  let laeuft = false;
  b.addEventListener('click', async (ev) => {
    ev.stopPropagation?.();
    if (laeuft) return;
    laeuft = true;
    const neu = t.favorit !== true;
    t.favorit = neu; zeige();
    try {
      const r = await setzeFavorit(post, t.sha, neu);
      if (!r.ok) { t.favorit = !neu; zeige(); melde(r.text, true); }
    } finally { laeuft = false; }
  });
  zeige();
  return b;
}
