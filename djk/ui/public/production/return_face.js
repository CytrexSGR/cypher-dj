// PRODUCTION: the Hall face of a return. The opener lives in the return header (returns.js); this file holds the source object the face reads and writes through
// and the refresh when the project changes under an open face. A face reads the return from the project and writes through ctx.aendere with the same coalescing
// key and undo label as the Hall sliders of the return strip: no second path to the project. The Hall has no live value, so the face has no frame function.
import { oeffneFace, offenesFace, schliesseFace } from '../face/frame.js';
import { baueHallFace } from '../face/reverb.js';
import { returnListe } from './routing.js';

const finde = (ctx, id) => returnListe(ctx.st.projekt).find((r) => r.id === id) ?? null;

/** The source of a Hall face: norms 0..1 from the return in the project, writes through return_aendern (a return that is gone gets no command). */
export function returnQuelleHall(ctx, ret) {
  const id = ret.id;
  return {
    get: (feld) => finde(ctx, id)?.hall?.[feld],
    set(feld, norm) {
      const r = finde(ctx, id);
      if (!r) return Promise.resolve(false);
      return ctx.aendere(`Hall ${feld} return ${r.name}`, [{ befehl: 'return_aendern', return_id: id, hall: { [feld]: norm } }], `${id}:hall:${feld}`);
    },
    an: {
      get: () => finde(ctx, id)?.hall?.an !== false,
      set: (b) => { const r = finde(ctx, id); if (r) ctx.aendere(`Hall ${b ? 'on' : 'off'} return ${r.name}`, [{ befehl: 'return_aendern', return_id: id, hall: { an: b } }]); },
    },
  };
}

/** Registers the opener hook and the project listener. ctx.returnFaceOeffnen(id) opens (or closes) the face of a return. */
export function bindeReturnFace(ctx) {
  let aktuell = null;   // {id, face} of the open Hall face
  ctx.returnFaceOeffnen = (id) => {
    const ret = finde(ctx, id);
    if (!ret || ret.effekt !== undefined) return null;
    const quelle = returnQuelleHall(ctx, ret);
    const f = oeffneFace({
      id: `hall:${id}`, titel: 'HALL', untertitel: `return ${ret.name}`, akzent: 'tuerkis', an: quelle.an,
      bauen: (inhalt) => baueHallFace(inhalt, quelle),
    });
    aktuell = f ? { id, face: f } : null;
    return f;
  };
  ctx.beimProjekt.push((p) => {
    const o = offenesFace();
    if (!o || !aktuell || o.id !== `hall:${aktuell.id}`) return;
    if (!p || !finde(ctx, aktuell.id)) { schliesseFace(); aktuell = null; return; }
    aktuell.face.aktualisiere();
  });
}
