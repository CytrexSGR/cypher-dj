// The project of a device window page (the instrument window device_window.js and the stage and strip windows target_window.js): loaded like PRODUCTION loads it
// (GET /proj/aktuell; an older state of the same project is dropped) and written like PRODUCTION writes it (the coalescing writer, undo labels). Extracted from
// bindeGeraetFenster so both window modes use the one code. UI texts English.
import { neuerLader, neuerNachlader, offlineNach } from './production/load.js';
import { neuerSchreiber } from './production/writer.js';
import { antwortText, meldeNachSchreiben } from './production/production.js';

/**
 * opt: { post (POST helper, jsonPost), holeGet? (tests), zeitgeber? (setTimeout/clearTimeout), zeigeMeldung(text, fehler) (the message line of the window),
 *        beiAenderung() (the project, the offline flag or the message base changed: draw again), beiProjekt?(p, wechsel) (a new state of the project; `wechsel`: another project) }.
 * Returns { st, ctx, melde, holeJson, holeGet, lade, nachlader, slug0() } with ctx = { st, melde, holeJson, holeGet, schreiber, aendere, aendereAus }.
 */
export function neuesFensterProjekt(opt) {
  const { post } = opt, zeitgeber = opt.zeitgeber ?? globalThis, beiAenderung = () => opt.beiAenderung?.();
  const st = { slug: null, projekt: null, getrennt: false };
  let slug0 = null, meldeUhr = null;
  const melde = (text, fehler = false) => {
    opt.zeigeMeldung?.(text, fehler);
    zeitgeber.clearTimeout(meldeUhr); meldeUhr = zeitgeber.setTimeout(() => { opt.zeigeMeldung?.('', false); }, 6000);
  };
  const merkeAntwort = (r) => { const o = offlineNach(r); if (o !== null && o !== st.getrennt) { st.getrennt = o; beiAenderung(); } return r; };
  const holeJson = async (weg, koerper) => {
    try { const r = await post(weg, koerper); let j = null; try { j = await r.json(); } catch { /* empty */ } return merkeAntwort({ status: r.status, j }); }
    catch (e) { return merkeAntwort({ status: 0, j: { fehler: 'netz', text: e.message } }); }
  };
  const holeGet = opt.holeGet ?? (async (weg) => {
    try { const r = await fetch(weg); let j = null; try { j = await r.json(); } catch { /* empty */ } return merkeAntwort({ status: r.status, j }); }
    catch (e) { return merkeAntwort({ status: 0, j: { fehler: 'netz', text: e.message } }); }
  });
  const ctx = { st, melde, holeJson, holeGet };

  const uebernimm = (slug, p) => {
    if (slug !== null && slug === st.slug && st.projekt && p && p.rev < st.projekt.rev) return;
    const wechsel = slug !== st.slug;
    st.slug = slug; st.projekt = p;
    if (slug !== null) ctx.schreiber.setze(slug, p.rev);
    if (slug0 === null && slug !== null) slug0 = slug;   // the project this window was opened for
    opt.beiProjekt?.(p, wechsel);
    beiAenderung();
  };
  const lade = neuerLader({
    hole: () => holeGet('/proj/aktuell'),
    uebernimm: (slug, p) => uebernimm(slug, p),
    leere: () => uebernimm(null, null),
    beiWeg: (r) => melde(antwortText(r), true),
    beiDa: () => { if (st.getrennt) { st.getrennt = false; beiAenderung(); } },
  });
  const nachlader = neuerNachlader(lade, 30);
  ctx.schreiber = neuerSchreiber({
    holeJson,
    beiProjekt: (slug, p, rev, j) => { uebernimm(slug, p); meldeNachSchreiben(j, melde); },
    beiFehler: (a, r) => { melde(antwortText(r), true); if (r.status === 409 && r.j?.fehler === 'rev_veraltet') return nachlader.starte(); },
    beiWiederhole: async () => { nachlader.starte(); await nachlader.fertig(); },
    beiFremdeRev: () => nachlader.plane(),
    beiVerworfen: (n) => melde(`The project changed elsewhere: reloaded, ${n} waiting change${n === 1 ? '' : 's'} dropped, please repeat`, true),
  });
  ctx.aendere = (label, befehle, schluessel, optionen) => ctx.schreiber.aendere(label, befehle, schluessel, optionen);
  ctx.aendereAus = (rechne) => {   // the command is computed when its turn comes, from the project as it is then (like PRODUCTION)
    const slug = st.slug;
    return ctx.schreiber.aendereMit(() => {
      const p = st.projekt;
      if (!p || st.slug !== slug) return null;
      const x = rechne(p);
      return x ? { ...x, rev: p.rev } : null;
    });
  };
  return { st, ctx, melde, holeJson, holeGet, lade, nachlader, slug0: () => slug0 };
}
