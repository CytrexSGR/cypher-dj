// Workbench DOCK (spec 2026-11-16-werkbank-dock-sequencer-design.md, A): the host file of STUDIO. The dock itself (the device cards under the tracks and the
// notes) and the window layer live in ../dock/ and are shared with PRODUCTION; they talk to their view only through a host object (documented at the top of
// ../dock/dock.js). This file builds that host for STUDIO from the view context (werkbankDockHost, once per ctx) and binds the dock (bindeDock).
import { sendWert } from '../production/routing.js';
import { oeffneMenue } from '../production/context_menu.js';
import { montiereDock } from '../dock/dock.js';
import { MAX_SPUREN_MODUL } from './tracks.js';
import { mixZuege, fxMenue } from './mix.js';
import { neuePanelQuelle } from '../dock/panel_source.js';

/** The letters of the tracks that send into the return (send above -60 dB). */
export function sendeVon(p, returnId) {
  const spuren = p?.spuren ?? [];
  return mixZuege(p).filter((z) => sendWert(spuren.find((s) => s.id === z.id), returnId) > -60).map((z) => z.buchstabe);
}

/** The host object of STUDIO (D2): every function reads the ctx at call time, so a test that replaces ctx.oeffneMenue after binding is still heard. */
export function werkbankDockHost(ctx) {
  return (ctx.dockHost ??= {
    ansicht: 'werkbank',
    dockEl: ctx.$('dock'), flaecheEl: ctx.$('fenster-flaeche'),
    projekt: () => ctx.st.projekt,
    aendere: (...a) => ctx.aendere(...a),
    melde: (...a) => ctx.melde(...a),
    frage: (t) => ctx.frage(t),
    holeGet: (w) => ctx.holeGet(w), holeJson: (w, k) => ctx.holeJson(w, k),
    lies: (k, v) => ctx.lies(k, v), merke: (k, v) => ctx.merke(k, v),
    fensterSchluessel: 'djk-wb-fenster-',
    wahl: { lies: () => ctx.st.wahl, setze: (id) => ctx.waehle(id), beiWechsel: (fn) => { ctx.beiWahl.push(fn); } },
    beimProjekt: (fn) => { ctx.beimProjekt.push(fn); },
    beimEreignis: (fn) => { ctx.beimEreignis.push(fn); },
    beimBild: () => {},
    zuege: (p) => mixZuege(p).map((z) => ({ id: z.id, kurz: z.buchstabe, name: z.name, farbe: z.farbe })),
    kurz: (p, strangId) => {
      const z = mixZuege(p).find((x) => x.id === strangId);
      if (z) return z.buchstabe;
      const r = (p?.returns ?? []).find((x) => x.id === strangId);
      return r ? `FX${r.nr}` : '';
    },
    zeilenTitel: { spuren: 'SYNTHS', gruppen: 'GROUPS', fx: 'EFFECTS' },
    spurNeu: (anker) => ctx.spurNeuMenue?.(anker),
    spurNeuAus: (p) => (p?.spuren ?? []).filter((s) => s.art === 'instrument').length >= MAX_SPUREN_MODUL,
    fxMenue: (p, graphen) => fxMenue(p, graphen),
    instrumentWechsel: (spurId, anker) => ctx.instrumentWechsel?.(spurId, anker),
    oeffneMenue: (...a) => (ctx.oeffneMenue ?? oeffneMenue)(...a),
    insertFaceOeffnen: (strang, insert) => ctx.insertFaceOeffnen?.(strang, insert),
    panelQuelle: (ctx.panelQuelle ??= neuePanelQuelle(ctx)),
    oeffneStufe: (strangId, teil) => ctx.oeffneStufe?.(strangId, teil),
    oeffneGeraet: (spurId) => ctx.oeffneGeraet?.(spurId),
    adapterCtx: ctx,
    schalter: { gruppen: false, sends: false, mischer: false, stufenFenster: false },
  });
}

export function bindeDock(ctx) {
  montiereDock(werkbankDockHost(ctx));
}
