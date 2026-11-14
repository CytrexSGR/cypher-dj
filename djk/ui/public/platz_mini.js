// DJ view: the two side columns and the mini view of a Track place (2026-11-14).
// Each side column of the DJ view is a flex column of its own (.seitenspalte in index.html): head and node of the top place, then of the bottom place.
// A place can therefore shrink without touching the mixer strips beside it (they keep their grid rows). The Studio view gives the columns
// display: contents, so its grid areas still see the nodes. Moving a node keeps its listeners and state (canvases size themselves per frame).
// A Track place can fold to a mini view (MINI first in its head, or a double click on the head text): the running waveform, low, with bar and
// time left beside it; everything else folds away. The other place of the column takes the height. The state lives in the browser.
const SCHLUESSEL = 'djk-platz-mini';
export const SPALTEN = { l: [1, 3], r: [2, 4] };

export function ladeMini(speicher) {
  try {
    const a = JSON.parse(speicher?.getItem(SCHLUESSEL) ?? '[]');
    return new Set(Array.isArray(a) ? a.filter((n) => [1, 2, 3, 4].includes(n)) : []);
  } catch { return new Set(); }
}
export function speichereMini(speicher, mini) {
  try { speicher?.setItem(SCHLUESSEL, JSON.stringify([...mini].sort())); } catch { /* private window: the state lives until reload */ }
}

// Moves head and node of every place into its side column, top place first. knotenVon(platz) returns the node shown in that place or null.
export function ordneSpalten($, knotenVon) {
  for (const [seite, plaetze] of Object.entries(SPALTEN)) {
    const spalte = $(`.seitenspalte[data-seite="${seite}"]`);
    if (!spalte || typeof spalte.append !== 'function') continue;   // the fake DOM of the page tests has no append
    for (const p of plaetze) {
      const kopf = $(`.platzkopf[data-platz-kopf="${p}"]`), knoten = knotenVon(p);
      if (kopf) spalte.append(kopf);
      if (knoten) spalte.append(knoten);
    }
  }
}

// Which places are folded: only a place that shows a track can be mini.
export const istMini = (layout, mini, platz) => layout[platz - 1] === 'track' && mini.has(platz);

// Sets .mini on the placed nodes and the MINI key of each head. knotenVon as above; alle = every node that can be a place.
export function wendeMiniAn($, layout, mini, knotenVon, alle) {
  for (const k of alle) k?.classList.remove('mini');
  for (const p of [1, 2, 3, 4]) {
    const an = istMini(layout, mini, p);
    knotenVon(p)?.classList.toggle('mini', an);
    const b = $(`.platzkopf[data-platz-kopf="${p}"] [data-platz-mini]`);
    if (!b) continue;
    b.hidden = layout[p - 1] !== 'track';
    b.classList.toggle('an', an);
    b.setAttribute('aria-pressed', String(an));
    b.textContent = an ? '▾ FULL' : '▴ MINI';
    b.title = an ? 'Unfold: show the full deck again' : 'Fold this deck to one strip: the other place of the column gets the height';
  }
}

export function umschalten(mini, platz) {
  const neu = new Set(mini);
  if (neu.has(platz)) neu.delete(platz); else neu.add(platz);
  return neu;
}
