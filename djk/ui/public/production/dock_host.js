// PRODUCTION mounts the shared dock (../dock/) below the arrangement: the card rows TRACKS, GROUPS and EFFECTS with the MASTER card, and the window layer.
// This file builds the host object of PRODUCTION (D2, documented at the top of ../dock/dock.js) from the view context and binds the dock and the window layer.
// Every host function is a closure that reads the ctx at call time, so a part that sets its ctx field later (bindeInsertDienste, bindeSpuren) is still heard.
import { oeffneMenue } from './context_menu.js';
import { produktionKurz, produktionZuege } from '../dock/model.js';
import { montiereDock } from '../dock/dock.js';
import { montiereFenster } from '../dock/window.js';
import { neuePanelQuelle } from '../dock/panel_source.js';
import { fxMenue } from '../werkbank/mix.js';
import { hostLatenzen } from './pdc.js';

/** The host object of PRODUCTION (once per ctx). */
export function produktionDockHost(ctx) {
  return (ctx.dockHost ??= {
    ansicht: 'production',
    masterSpalte: true,
    dockEl: ctx.$('dock-wurzel'), flaecheEl: ctx.$('fenster-flaeche'),
    projekt: () => ctx.st.projekt,
    aendere: (...a) => ctx.aendere(...a),
    melde: (...a) => ctx.melde(...a),
    frage: (t) => globalThis.confirm?.(t) ?? false,
    holeGet: (w) => ctx.holeGet(w), holeJson: (w, k) => ctx.holeJson(w, k),
    lies: (k, v) => ctx.lies(k, v), merke: (k, v) => ctx.merke(k, v),
    fensterSchluessel: 'djk-prod-fenster-',
    wahl: { lies: () => ctx.einzelSpur?.() ?? null, setze: (id) => ctx.waehleSpur?.(id), beiWechsel: (fn) => { ctx.beiWahl.push(fn); } },
    beimProjekt: (fn) => { ctx.beimProjekt.push(fn); },
    beimEreignis: (fn) => { ctx.beimEreignis.push(fn); },
    beimBild: (fn) => { ctx.beimBild.push(fn); },
    zuege: produktionZuege,
    kurz: produktionKurz,
    zeilenTitel: { spuren: 'TRACKS', gruppen: 'GROUPS', fx: 'EFFECTS' },
    // no spurNeu, no instrumentWechsel: PRODUCTION has no instrument exchange and its + buttons are in the arrangement corner (the cards leave both out)
    fxMenue: (p, graphen) => fxMenue(p, graphen),
    plusOptionen: { util: true, zaehler: true, plugins: true, duck: true },   // read from task 9 on
    oeffneMenue: (...a) => (ctx.oeffneMenue ?? oeffneMenue)(...a),
    insertFaceOeffnen: (strang, insert) => ctx.insertFaceOeffnen?.(strang, insert),
    panelQuelle: (ctx.panelQuelle ??= neuePanelQuelle(ctx)),   // one source for the dock and the window layer
    oeffneStufe: (strangId, teil, anker) => ctx.oeffneStufe?.(strangId, teil, anker),
    oeffneGeraet: (spurId) => ctx.oeffneGeraet?.(spurId),
    hostLage: (insertId) => ctx.hostLage?.(insertId) ?? null,
    hostLatenzen: () => hostLatenzen(ctx.hostLagen?.() ?? []),
    graphLatenzen: () => ctx.graphLatenzen ?? null,
    grLesung: (insert, jetzt) => ctx.grLesung?.(insert, jetzt) ?? null,
    presetMarke: (id) => ctx.presetMarke?.('insert', id) ?? null,
    pluginFenster: (insertId) => ctx.pluginFenster?.(insertId),
    stufenPopover: (s, i, a) => ctx.oeffneStufenPopover?.(s, i, a) ?? null,
    kopfBeat: () => ctx.st.kopfBeat ?? null,
    adapterCtx: ctx,
    schalter: { gruppen: true, sends: true, mischer: true, stufenFenster: false },
  });
}

/** Mounts the dock and the window layer; puts ctx.fenster, ctx.oeffneGeraet and ctx.oeffneStufe on the ctx. */
export function bindeDockProduktion(ctx) {
  const host = produktionDockHost(ctx);
  montiereDock(host);
  const { fenster, oeffneGeraet, oeffneStufe } = montiereFenster(host);
  ctx.fenster = fenster; ctx.oeffneGeraet = oeffneGeraet; ctx.oeffneStufe = oeffneStufe;
}
