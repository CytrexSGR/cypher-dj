// Shelf tab SAMPLES: the mode switch. LIBRARY (the catalog, regal_catalog.js) and FOLDERS (the folder browser, regal_samples.js, unchanged).
// regal.js builds the tab button and calls bindeSamplesReiter; only the active mode is shown and loaded. The choice is remembered.
import { bindeSamples } from './regal_samples.js';
import { bindeKatalog, leseKatalogStand, schreibeKatalogStand } from './regal_catalog.js';

export const MODUS_TEXT = {
  katalog: 'Search the sample catalog',
  ordner: 'Browse the sample folders; a folder can become an instrument',
};

export function bindeSamplesReiter(ctx, { host, setzeHinweis = () => {}, refusalText = (r) => ctx.antwortText(r) }) {
  let modus = leseKatalogStand(ctx).modus === 'ordner' ? 'ordner' : 'katalog';
  let aktiv = false;
  const el = (tag, klasse) => { const e = document.createElement(tag); e.className = klasse; return e; };
  const wurzelEl = el('div', 'w-kat-reiter');
  const leiste = el('div', 'w-kat-modi');
  const katalogHost = el('div', 'w-kat-modus');
  const ordnerHost = el('div', 'w-kat-modus');
  const knoepfe = {};
  for (const [name, text] of [['katalog', 'LIBRARY'], ['ordner', 'FOLDERS']]) {
    const b = el('button', 'w-kat-modus-knopf'); b.type = 'button'; b.textContent = text;
    b.setAttribute('data-w', 'samples-modus'); b.setAttribute('data-modus', name); b.setAttribute('title', MODUS_TEXT[name]);
    b.addEventListener('click', () => setzeModus(name));
    knoepfe[name] = b; leiste.append(b);
  }
  wurzelEl.append(leiste, katalogHost, ordnerHost);
  const katalog = bindeKatalog(ctx, { host: katalogHost, setzeHinweis, refusalText });
  const ordner = bindeSamples(ctx, { host: ordnerHost, setzeHinweis, refusalText });
  const binder = { katalog, ordner };

  function zeichne() {
    for (const n of ['katalog', 'ordner']) knoepfe[n].classList.toggle('an', n === modus);
    katalogHost.hidden = modus !== 'katalog'; ordnerHost.hidden = modus !== 'ordner';
  }
  function setzeModus(neu) {
    if (neu === modus) return;
    binder[modus].verberge();
    modus = neu; schreibeKatalogStand(ctx, { modus });
    zeichne();
    if (aktiv) binder[modus].zeige();
  }
  zeichne();
  return {
    // "show all" of the search view: LIBRARY mode with `q` in its search field; call it before zeige()
    sucheAlle(q) {
      if (modus !== 'katalog') { if (aktiv) binder[modus].verberge(); modus = 'katalog'; schreibeKatalogStand(ctx, { modus }); zeichne(); }
      katalog.setzeText(q);
    },
    // the search view's rows (catalogue samples and loops)
    katalogZeile: (z, suchHost) => katalog.zeileFuer(z, suchHost),
    katalogKnoepfe: () => katalog.zeigeKnoepfe(),
    katalogStopp: () => katalog.stoppe(),
    zeige() { aktiv = true; host.replaceChildren(wurzelEl); zeichne(); binder[modus].zeige(); },
    verberge() { aktiv = false; binder[modus].verberge(); },
  };
}
