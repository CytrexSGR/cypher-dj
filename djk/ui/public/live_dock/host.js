// The live dock host: the EFFECTS tab of the bottom drawer in DJ and LIVE shows the shared dock (plan 2026-11-19-one-dock-stage-5a, task 4).
// The host builds a snapshot of the live state (control values, loaded graphs, what plays) once per tick while the tab is visible, hands it to the dock
// (generic cards, dock/allgemein.js) and to its window layer (dock/window.js), and writes through the existing live senders (/regler, /griff, /graph);
// nothing here is project state and nothing has undo. Imported only by app.js (it imports page modules; nothing under dock/ imports it).
// D6: ONE setInterval of 100 ms per mount; it returns at once while the tab is hidden. Entering the tab runs one tick at once, leaving it empties the
// dock, closes the windows and the popover.
import { $, $$, zustand, melde } from '../page_state.js';
import { fokus } from '../controller_fokus.js';
import { setzeKomp, kompWert } from '../effects_gemeinsam.js';
import { grJetzt, gateGrJetzt, masterLimiterJetzt, limiterJetzt, fxGewaehlt, setzeFxGewaehlt } from '../effects_view.js';
import { fxInhalt } from '../effects_bindung.js';
import { graphenGeladen, graphenInfo, panelVon, holePanel, kanalAdapter, hostNamen } from '../graphs_view.js';
import { sendeGriff, griffStellung } from '../controls_view.js';
import { LIMITER_GRUND } from '../effects.js';
import { KOMP_SECHS } from '../comp_controls_table.js';
import { wertText, vorgabeK, steuerungen } from '../panel.js';
import { montiereDock } from '../dock/dock.js';
import { oeffneMenue } from '../production/context_menu.js';
import { montiereFenster } from '../dock/window.js';
import { frontKnoepfe } from '../dock/blocks.js';
import { liveModell, gestaltLive, knopfBereich, wertVonK, kVonWert, chipPunkte, kartenPunkte, LIVE_KANAELE } from './model.js';
import { stromVonKanal, stromListe } from '../kanaele.js';
import { typVon } from '../slots.js';
import { live } from '../live_view.js';
import { neuesPopover } from './popover.js';
import { werkzeugFlaeche, werkzeugAktion } from './tool.js';
import { kompFlaeche, kompAktion } from './comp.js';
import { wechsel, auf, effektFlaeche, effektAktion, plus } from './graph.js';
import { glueFlaeche, limiterFlaeche, busFlaeche, busAktion, spektrumFenster } from './master.js';

const TICK_MS = 100;
const KOMP_MS = 40;   // the strip sliders send the latest value per path every 40 ms (effects_view.js)
const KANAL_IDS = new Set(LIVE_KANAELE.map(([id]) => id));
const istKarte = (id) => KANAL_IDS.has(id) || stromVonKanal(id) !== null;   // a container, or the alias of a stream of the module
// the streams of the placed Strudel module (its rows: the defaults and every stream track of the group); none while no place holds the module
const modulStroeme = () => ([1, 2, 3, 4].some((n) => typVon(zustand.plaetze, n) === 'strudel') ? stromListe(live.projekt) : []);
const sichtbar = () => { const e = $('#effekte'); return !!e && !e.hidden; };

// ---- snapshot ----------------------------------------------------------------------------------------------------------------------------------------
const frontCache = new Map();   // graph name -> { panel, liste }
const gefragt = new Set();      // graph names whose panel was asked for once
function frontVon(name) {
  const info = panelVon(name);
  if (!info) {
    if (!gefragt.has(name)) { gefragt.add(name); holePanel(name).then(() => {}, () => {}); }
    return null;
  }
  const alt = frontCache.get(name);
  if (alt?.panel === info.panel) return alt;
  const liste = frontKnoepfe(info.panel).map((c) => ({ param: c.bind.param, name: c.label ?? c.bind.param, vorgabe: vorgabeK(c) }));
  const neu = { panel: info.panel, regler: info.regler, liste };
  frontCache.set(name, neu);
  return neu;
}
export function liveStand() {
  const front = {};
  for (const name of new Set(Object.values(graphenGeladen ?? {}))) {
    if (!name) continue;
    const f = frontVon(name);
    if (f) front[name] = f.liste;
  }
  const lim = limiterJetzt?.() ?? null;
  return {
    strome: modulStroeme(),
    regler: zustand.regler ?? {},
    geladen: { ...(graphenGeladen ?? {}) },
    graphen: graphenInfo?.graphen ?? [],
    front,
    hostNamen: { ...hostNamen },
    inhalt: { ...fxInhalt },
    gewaehlt: fxGewaehlt,
    limiter: lim ? { gebaut: !!lim.gebaut, grund: lim.grund ?? LIMITER_GRUND } : { gebaut: false, grund: LIMITER_GRUND },
  };
}

async function holeGet(weg) {
  try { const r = await fetch(weg); let j = null; try { j = await r.json(); } catch { /* no body */ } return { status: r.status, j }; } catch { return { status: 0, j: null }; }
}
const lies = (k, v) => { try { const x = localStorage.getItem(k); return x === null ? v : x; } catch { return v; } };
const merke = (k, v) => { try { localStorage.setItem(k, v); } catch { /* without storage the place lives for this page load */ } };

/** The host object of the live dock (D2 of the plan). `haken` collects the beimProjekt hooks of the dock and of the window layer. */
export function liveDockHost(opt = {}) {
  const haken = [];
  let stand = null;
  const adapter = new Map();        // card id -> kanalAdapter
  const kompWarte = new Map();      // path -> { uhr, wert }
  let griffZug = false;             // a GLUE gesture is running (the first move sends the position)
  const adapterVon = (id) => { if (!adapter.has(id)) adapter.set(id, kanalAdapter(id)); return adapter.get(id); };
  const kompRow = (feld) => KOMP_SECHS.find((r) => r.feld === feld);
  const sendeKomp = (pfad, w) => {
    const x = kompWarte.get(pfad);
    if (x) { x.wert = w; return; }
    const neu = { wert: w, uhr: null };
    kompWarte.set(pfad, neu);
    neu.uhr = setTimeout(() => { kompWarte.delete(pfad); setzeKomp(pfad, neu.wert); }, KOMP_MS);
  };
  const ctrl = (id, p) => {
    const g = graphenGeladen?.[id];
    const info = g ? frontVon(g) : null;
    return info ? { c: steuerungen(info.panel).find((x) => x.bind?.param === p) ?? null, regler: info.regler } : null;
  };

  const host = {
    ansicht: 'effekte',
    dockEl: opt.dockEl ?? $('#live-dock'),
    flaecheEl: opt.flaecheEl ?? $('#live-fenster'),
    masterSpalte: true,
    projekt: () => null,
    modell: liveModell,
    gestalt: gestaltLive,
    melde: (t, f) => melde(t, f),
    holeGet,
    lies, merke,
    fensterSchluessel: 'djk-live-fenster-',
    beimProjekt: (fn) => { haken.push(fn); },
    oeffneMenue,   // set here, not only by hostMitVorgaben: the surface modules read ctx.host, the raw object
    wahl: { lies: () => null, setze: () => {}, beiWechsel: () => {} },
    zuege: () => [],
    kurz: () => '',
    aktionen: null,   // set below (needs ctx)
  };
  const ctx = {
    host,
    fenster: null,
    popover: opt.popover ?? neuesPopover(document),
    tick: () => opt.tick?.(),
    stand: () => stand,
    karte: (id) => { const m = stand ? liveModell(stand) : null; return m ? [...m.zeilen.flatMap((z) => z.karten), ...m.master].find((k) => k.id === id) ?? null : null; },
  };
  const ankerVon = (id, teil) => host.dockEl?.querySelector?.(`[data-strang="${CSS.escape(id)}"] [data-teil="${CSS.escape(teil)}"]`) ?? null;

  function punktAus(id, teil, p) {
    const a = p.aktion;
    if (a === 'gate-an' || a === 'util-schalter') return werkzeugAktion(ctx, id, p);
    if (a.startsWith('komp-')) return kompAktion(ctx, id, p);
    if (a.startsWith('effekt-')) return effektAktion(ctx, id, p, ankerVon(id, teil));
    if (a.startsWith('bus-')) return busAktion(ctx, teil, p);
    if (a === 'spektrum') return spektrumFenster(ctx, id);
    return undefined;
  }
  const alsMenue = (id, teil, punkte) => punkte.map((p) => (p.gruppe ? p : { text: p.text, aus: !!p.aus, titel: p.titel, aktion: () => punktAus(id, teil, p) }));

  host.aktionen = {
    wert(id, param) {
      if (param.startsWith('komp/')) { const f = param.slice(5); const r = kompRow(f); return kVonWert(param, kompWert(id, f, r?.vorgabe ?? 0)); }
      if (param.startsWith('bk:')) { const v = adapterVon(id).get(param.slice(3)); return typeof v === 'number' ? v : null; }
      if (param === 'kleber') return griffStellung('master/kleber');
      return null;
    },
    setze(id, param, k) {
      if (param.startsWith('komp/')) return sendeKomp(`${id}/${param}`, wertVonK(param, k));
      if (param.startsWith('bk:')) return adapterVon(id).set(param.slice(3), k);
      if (param === 'kleber') { sendeGriff('master/kleber', k, !griffZug); griffZug = true; }
      return undefined;
    },
    ende(id, param) { if (param === 'kleber') griffZug = false; },
    text(id, param, k) {
      if (param.startsWith('komp/') || param === 'kleber') { const b = knopfBereich(param); return b ? b.text(wertVonK(param, k)) : k.toFixed(2); }
      if (param.startsWith('bk:')) { const p = param.slice(3); const x = ctrl(id, p); return x?.c ? wertText(x.c, p, k, x.regler) : k.toFixed(2); }
      return k.toFixed(2);
    },
    gr(id, teil) {
      if (teil === 'komp') { const db = grJetzt(id); return db ? db : null; }
      if (teil === 'gate') return gateGrJetzt(id);
      if (teil === 'limiter') return masterLimiterJetzt();
      return null;
    },
    chip(id, teil, anker) {
      if (teil === 'gate' || teil === 'util') return werkzeugFlaeche(ctx, id, teil, anker);
      if (teil === 'komp') return kompFlaeche(ctx, id);
      if (teil === 'insert') return effektFlaeche(ctx, id, anker);
      if (teil === 'glue') return glueFlaeche(ctx, anker);
      if (teil === 'limiter') return limiterFlaeche(ctx, anker);
      if (teil.startsWith('bus/')) return busFlaeche(ctx, teil);
      return undefined;
    },
    chipMenue(id, teil) { const k = ctx.karte(id); return k && stand ? alsMenue(id, teil, chipPunkte(k, teil, stand)) : []; },
    plus: (id, anker) => plus(ctx, id, anker),
    wechsel: (id, anker) => { const k = ctx.karte(id); if (k) wechsel(ctx, k, anker); },
    auf: (id) => { if (id === 'master') return spektrumFenster(ctx); const k = ctx.karte(id); return k ? auf(ctx, k) : undefined; },
    menue(id) { const k = ctx.karte(id); return k ? alsMenue(id, null, kartenPunkte(k)) : []; },
    vorn(id) {
      if (!istKarte(id)) return;
      setzeFxGewaehlt(id);   // the PRESETS tab works on the card in front
      fokus.melde({ kanal: id }, 'effekte');
      ctx.tick();
    },
  };
  return { host, ctx, haken, setzeStand: (s) => { stand = s; } };
}

/** Mount the live dock into the EFFECTS tab: the dock, its window layer, the popover and the one tick (D6). */
export function bindeLiveDock() {
  if (!$('#live-dock') || !$('#live-fenster')) return null;
  let n = 0, warSichtbar = false;
  const popover = neuesPopover(document, $('#live-fenster'));
  const lebend = liveDockHost({ popover, tick: () => tick(true) });
  const { host, ctx, haken } = lebend;
  montiereDock(host);
  const dockHaken = haken.splice(0);
  const f = montiereFenster(host);
  ctx.fenster = f.fenster;
  const fensterHaken = haken.splice(0);
  const alle = (s) => { for (const h of [...dockHaken, ...fensterHaken]) h(s, false); };

  function tick(sofort = false) {
    const an = sichtbar();
    if (!an) {
      if (warSichtbar) { warSichtbar = false; lebend.setzeStand(null); alle(null); popover.schliesse(); }
      return;
    }
    const neuSichtbar = !warSichtbar;
    warSichtbar = true;
    const s = liveStand();
    lebend.setzeStand(s);
    for (const h of dockHaken) h(s, false);
    n += 1;
    if (sofort || neuSichtbar || n % 3 === 0) { for (const h of fensterHaken) h(s, false); popover.aktualisiere(); }
  }
  fokus.registriere('effekte', () => (sichtbar() ? { kanal: fxGewaehlt } : null));
  // entering or leaving the tab shows at once (the area buttons switch synchronously; the tick runs after their handler)
  for (const t of $$('[data-bereich]')) t.addEventListener('click', () => queueMicrotask(() => tick()));
  setInterval(() => tick(), TICK_MS);
  tick();
  return { host, ctx, tick };
}
