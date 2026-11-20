// PRODUCTION: the source object of a Hall face. The dock (dock/karten.js, dock/window.js) opens the face in the window layer; the face reads the return
// from the project and writes through ctx.aendere with the coalescing key and undo label of the Hall knobs: no second path to the project.
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
