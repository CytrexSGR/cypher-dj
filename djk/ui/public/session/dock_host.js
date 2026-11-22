// SESSION is a host of the shared dock (ADR 041, D16): the DEVICES tab shows the cards TRACKS (one per grid column), EFFECTS (the returns of the live project,
// the loop deck returns too, and the MASTER card at the right end). This file builds the host object (documented at the top of ../dock/dock.js) from a small
// context of the view and mounts the dock; cards, chips, + INSERT, + LOAD EFFECT and the knobs come from dock/ and are not drawn here.
//
// ctx: { dockEl, flaecheEl?, projekt() -> the live project | null, spalten() -> the columns of the grid stand in grid order ({ spur_id, kurz, name }),
//        aendere(label, befehle) -> Promise<boolean> (the serial writer of the view), melde(text, fehler?), holeGet(weg), holeJson(weg, body),
//        spaltenWahl: { lies() -> spur_id | null, setze(spur_id) }, oeffneFenster?(ziel), lies?, merke?, masterHaken?(karteEl) }
// Returns { host, projekt(p, wechsel), wahl(), bild(t), ereignis(a, f) }: the view calls them when its project, its selection, its frame or the page events change.
import { oeffneGeraetFenster } from '../device_open.js';
import { KERN, kernZuX, kernAusX } from '../curves.js';
import { montiereDock } from '../dock/dock.js';
import { neuePanelQuelle } from '../dock/panel_source.js';
import { fxMenue } from '../werkbank/mix.js';

const BAENDER = [['tief', 'LO'], ['mitte', 'MID'], ['hoch', 'HI']];
const zeigeDb = (db) => (db <= -100 ? 'kill' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);

/** The short label of a strip: a column's label from the grid stand (C1..D4), R<nr> for a return, G<nr> for a group, else ''. */
export function sessionKurz(spalten, p, id) {
  const sp = (spalten ?? []).find((s) => s.spur_id === id);
  if (sp) return String(sp.kurz ?? '');
  const r = (p?.returns ?? []).find((x) => x.id === id);
  if (r) return `R${r.nr}`;
  const g = (p?.gruppen ?? []).find((x) => x.id === id);
  return g ? `G${g.nr}` : '';
}

/** The host object of SESSION. */
export function sessionDockHost(ctx, haken) {
  const melde = (...a) => ctx.melde?.(...a);
  const fenster = (ziel) => (ctx.oeffneFenster ? ctx.oeffneFenster(ziel) : oeffneGeraetFenster(ziel, melde));
  // a write with a key: one in flight, the newest waits (a knob drag is one request per turn, not one per move)
  const flug = new Map();
  function aendere(label, befehle, schluessel = null) {
    if (schluessel === null) return Promise.resolve(ctx.aendere(label, befehle));
    const e = flug.get(schluessel);
    if (e) { e.wartet = { label, befehle }; return e.ende; }
    const neu = { wartet: null, ende: null };
    neu.ende = (async () => {
      let ok = false, nimm = { label, befehle };
      try { while (nimm) { neu.wartet = null; ok = await ctx.aendere(nimm.label, nimm.befehle); nimm = neu.wartet; } } finally { flug.delete(schluessel); }
      return ok;
    })();
    flug.set(schluessel, neu);
    return neu.ende;
  }
  async function holeGet(weg) {
    try { const r = await (ctx.holeGetRoh ?? fetch)(weg); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }
    catch (e) { return { status: 0, j: { fehler: 'netz', text: e.message } }; }
  }
  const adapterCtx = {
    st: { get projekt() { return ctx.projekt(); } },
    aendere, holeGet: ctx.holeGet ?? holeGet, holeJson: (w, k) => ctx.holeJson(w, k), melde,
    beimEreignis: [], beimProjekt: [], beiWahl: [],
  };
  const spur = (id) => (ctx.projekt()?.spuren ?? []).find((s) => s.id === id) ?? null;
  // the front knobs of a loop deck column: FILTER and the isolator (LO MID HI), written like the strip of the column
  function spurKnoepfe(spurId) {
    if (spur(spurId)?.zellen === undefined) return [];
    const name = () => spur(spurId)?.name ?? spurId;
    const filter = {
      param: 'filter', name: 'FILTER', titel: 'Filter: left low pass, right high pass (double click: off)', vorgabe: 0.5,
      lies: () => { const s = spur(spurId); return s ? ((Number(s.filter) || 0) + 1) / 2 : null; },
      setze: (k) => { const f = Math.round((2 * k - 1) * 1000) / 1000; aendere(`Filter ${name()}`, [{ befehl: 'spur_aendern', spur_id: spurId, filter: Math.abs(f) < 0.02 ? 0 : f }], `${spurId}:filter`); },
      text: (k) => { const f = 2 * k - 1; return Math.abs(f) < 0.02 ? 'off' : f.toFixed(2); },
    };
    const band = ([b, text]) => ({
      param: `eq.${b}`, name: text, titel: `Isolator ${text}: band gain in dB (double click: 0 dB)`, vorgabe: kernZuX(KERN.eq, 0),
      lies: () => { const s = spur(spurId); return s ? kernZuX(KERN.eq, Number.isFinite(s.eq?.[b]) ? s.eq[b] : 0) : null; },
      setze: (k) => { aendere(`Isolator ${text} ${name()}`, [{ befehl: 'spur_aendern', spur_id: spurId, eq: { [b]: kernAusX(KERN.eq, k) } }], `${spurId}:eq:${b}`); },
      text: (k) => zeigeDb(kernAusX(KERN.eq, k)),
    });
    return [filter, ...BAENDER.map(band)];
  }
  const host = {
    ansicht: 'session',
    dockEl: ctx.dockEl, flaecheEl: ctx.flaecheEl ?? ctx.dockEl,
    projekt: () => ctx.projekt(),
    aendere, melde,
    frage: (t) => globalThis.confirm?.(t) ?? false,
    holeGet: adapterCtx.holeGet, holeJson: (w, k) => ctx.holeJson(w, k),
    lies: (k, v) => ctx.lies?.(k, v) ?? v, merke: (k, v) => ctx.merke?.(k, v),
    fensterSchluessel: 'djk-session-fenster-',
    wahl: { lies: () => ctx.spaltenWahl.lies(), setze: (id) => ctx.spaltenWahl.setze(id), beiWechsel: (fn) => { haken.wahl.push(fn); } },
    beimProjekt: (fn) => { haken.projekt.push(fn); },
    beimEreignis: (fn) => { haken.ereignis.push(fn); },
    beimBild: (fn) => { haken.bild.push(fn); },
    zuege: (p) => (ctx.spalten() ?? []).flatMap((c) => { const s = (p?.spuren ?? []).find((x) => x.id === c.spur_id); return s ? [{ id: s.id, kurz: String(c.kurz ?? ''), name: c.name ?? s.name, farbe: s.farbe ?? '' }] : []; }),
    kurz: (p, id) => sessionKurz(ctx.spalten(), p, id),
    zeilenTitel: { spuren: 'TRACKS', fx: 'EFFECTS' },
    alleReturns: true,
    fxMenue: (p, graphen) => fxMenue(p, graphen),
    plusOptionen: { util: true, zaehler: true, plugins: true, duck: true },
    // the stages and the instrument open in the browser window of the device (the window layer of PRODUCTION is not part of this page)
    oeffneStufe: (strangId, teil) => fenster(teil === 'hall' ? `ret:${strangId}` : `ins:${teil}`),
    oeffneGeraet: (spurId) => fenster(spurId),
    oeffneMenue: ctx.oeffneMenue,   // undefined: the shared context menu
    adapterCtx,
    spurKnoepfe,
    masterHaken: (k) => ctx.masterHaken?.(k),
    schalter: { gruppen: false, sends: true, mischer: true, stufenFenster: true },
  };
  host.panelQuelle = neuePanelQuelle(host);
  return host;
}

/** Mounts the dock in `ctx.dockEl`. The view calls the returned functions when its state changes (the dock follows). */
export function montiereSessionDock(ctx) {
  const haken = { projekt: [], wahl: [], ereignis: [], bild: [] };
  const host = sessionDockHost(ctx, haken);
  montiereDock(host);
  return {
    host,
    projekt: (p, wechsel = false) => { for (const f of haken.projekt) f(p, wechsel); },
    wahl: () => { for (const f of haken.wahl) f(); },
    bild: (t) => { for (const f of haken.bild) f(t); },
    ereignis: (a, f) => { for (const h of haken.ereignis) h(a, f); },
  };
}
