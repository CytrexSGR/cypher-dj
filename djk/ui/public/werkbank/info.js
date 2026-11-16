// Workbench: the instrument info cache (plan task 4). GET /seq/geraet?spur_id=<id> answers {art, regler: [{nr, name, vorgabe}], klaenge: [{ton, name}]} for
// the device of a track (a sampler cut adds `schnitt: {id, scheiben, laengen_beats}`). The info belongs to the device, not to the track: one request per device key at a time ('bk:<graph>', 'kit:<kit>', 'rb338',
// 'anderes:<track id>'). info(spur) never waits: it returns the known info, or null while the first answer is on its way (and starts the request).
// A failed answer is kept as an empty info for INFO_WARTEN_MS, then asked again (the stale empty info stays visible meanwhile).
import { geraetArt } from '../seq_logic.js';

export const INFO_WARTEN_MS = 5000;

export function geraetSchluessel(spur) {
  const g = spur?.geraet;
  if (g?.art === 'intern') {
    if (g.name === 'bk') return `bk:${g.graph}`;
    if (g.name === 'kit') return `kit:${g.kit}`;
    if (g.name === 'rb338') return 'rb338';
  }
  return `anderes:${spur?.id}`;
}

// holeGet(weg) -> {status, j}; beiNeu(): called after every answer (the page redraws what depends on the info).
export function neuerInfoSpeicher(holeGet, beiNeu, jetzt = Date.now) {
  const eintraege = new Map();   // key -> { info, bis (retry time of a failed info, else 0), laeuft }
  let epoche = 0;                // vergiss() makes answers of requests started earlier obsolete
  function frage(schluessel, spur, e) {
    e.laeuft = true;
    const meine = epoche;
    let anfrage;
    try { anfrage = Promise.resolve(holeGet(`/seq/geraet?spur_id=${encodeURIComponent(spur.id)}`)); } catch { anfrage = Promise.resolve(null); }
    anfrage.then((r) => r, () => null).then((r) => {
      if (meine !== epoche) return;
      e.laeuft = false;
      const j = r?.j;
      if (r?.status === 200 && j && typeof j.art === 'string') {
        e.info = { art: j.art, regler: Array.isArray(j.regler) ? j.regler : [], klaenge: Array.isArray(j.klaenge) ? j.klaenge : [],
          ...(j.schnitt && typeof j.schnitt === 'object' ? { schnitt: j.schnitt } : {}) };
        e.bis = 0;
      } else {
        e.info = { art: geraetArt(spur, null), regler: [], klaenge: [] };
        e.bis = jetzt() + INFO_WARTEN_MS;
      }
      beiNeu();
    });
  }
  return {
    info(spur) {
      if (!spur) return null;
      const k = geraetSchluessel(spur);
      let e = eintraege.get(k);
      if (!e) { e = { info: null, bis: 0, laeuft: false }; eintraege.set(k, e); }
      if (!e.laeuft && (e.info === null || (e.bis > 0 && jetzt() >= e.bis))) frage(k, spur, e);
      return e.info;
    },
    vergiss() { epoche++; eintraege.clear(); },
  };
}
