// PRODUCTION (D1 V1): Wellenformen der Audio-Clips über das vorhandene GET /welle?sha= (Spec 2.11), je sha einmal
// geholt und behalten. hole() liefert sofort den Eintrag { welle, fehler }; ist er neu, kommt die Welle später und
// wenn() wird gerufen (die Seite zeichnet dann neu).
import { leseWelle } from '../welle.js';

export function neueWellen(holen = (url) => fetch(url)) {
  const cache = new Map();
  return {
    hole(sha, wenn) {
      let e = cache.get(sha);
      if (e) return e;
      e = { welle: null, fehler: null };
      cache.set(sha, e);
      holen(`/welle?sha=${encodeURIComponent(sha)}`)
        .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); e.welle = leseWelle(await r.arrayBuffer()); })
        .catch((x) => { e.fehler = x.message; })
        .finally(() => wenn?.());
      return e;
    },
    get groesse() { return cache.size; },
  };
}
