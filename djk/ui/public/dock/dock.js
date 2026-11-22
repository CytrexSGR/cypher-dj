// The DOCK: the device cards under the tracks, shared by the views that show it (STUDIO and PRODUCTION). Spec 2026-11-16-werkbank-dock-sequencer-design.md, A.
// Row SYNTHS: one card per instrument track (the selected one highlighted, a click selects it): letter, name, graph, one chip per insert, + INSERT, CHANGE, OPEN
// and up to six front knobs of the device, then a card + INSTRUMENT TRACK. Row EFFECTS: one card per return (name, up to four front knobs, LEVEL, ON, OPEN,
// delete, a chip FROM naming the tracks that send), a card + LOAD EFFECT, and at the right end the MASTER card (insert chips, + INSERT, LEVEL, meter).
// The knobs of a card are the ones of the full panel: the same adapter (spurAdapter for an instrument, baueInsertAdapter for a stage, the Hall source for a
// Hall), so a change at one place shows at the other with the next project update.
//
// Front knobs: the optional field `front: ["k10", ...]` of the panel file (at most six, each the bind.param of a knob control of that panel); without it
// the first knob controls of the panel in section order; a device without a panel file gets the fallback panel (ersatzPanel).
//
// Markup (every element carries data-w): div[data-w="dock"] with div[data-w="dock-synths"] and div[data-w="dock-fx"] (the card rows).
//   karte-spur[data-spur-id]   synth card: karte-teil[data-teil] (chip per insert; click opens it, right click: ON/OFF, move, remove), karte-plus (+ INSERT),
//                              karte-wechsel (CHANGE), karte-auf (OPEN), karte-knoepfe with karte-knopf[data-param] per front knob
//   karte-spur-neu             the card + INSTRUMENT TRACK
//   karte-fx[data-return-id]   effect card: karte-von (FROM A C), karte-teil / karte-plus (further stages), karte-an (ON), karte-auf, karte-weg, karte-knopf,
//                              karte-level (the return fader as a knob), .meter.senkrecht[data-kanal="ret/<nr>"]
//   fx-laden                   the card + LOAD EFFECT (menu of fxMenue)
//   karte-master               master card: karte-teil, karte-plus, karte-auf, karte-knopf, karte-level, .meter.senkrecht[data-kanal="pm"]
//
// THE HOST OBJECT (D2). The dock and the window layer (window.js) talk to their view only through this object, never through the view's own context.
// Every function of a host is a closure that reads the view's state at call time. Fields:
//   ansicht                 'werkbank' | 'production': the source name for fokus.melde
//   dockEl, flaecheEl       the dock root and the window layer
//   projekt() -> p | null   the open project; aendere(label, befehle, schluessel?, optionen?) -> Promise<boolean>; melde(text, fehler?); frage(text) -> boolean | Promise<boolean>
//   holeGet(weg), holeJson(weg, body), lies(k, v), merke(k, v); fensterSchluessel (prefix of the stored window places)
//   wahl: { lies() -> spurId | null, setze(spurId), beiWechsel(fn) }   the selected track
//   beimProjekt(fn(p, wechsel)), beimEreignis(fn(a, f)), beimBild(fn(t))   hooks of the view (the last two are no-ops where the view has none)
//   zuege(p) -> [{ id, kurz, name, farbe }]   the TRACKS row; kurz(p, strangId) -> string: the short label of a track, a return, a group
//   zeilenTitel: { spuren, gruppen, fx }      the row labels
//   spurNeu?(anker), spurNeuAus?(p) -> boolean   the card + INSTRUMENT TRACK and whether it is disabled
//   fxMenue(p, graphen) -> entries of the card + LOAD EFFECT; plusOptionen; instrumentWechsel?(spurId, anker)
//   oeffneMenue(punkte, x, y); insertFaceOeffnen(strang, insert); panelQuelle (neuePanelQuelle)
//   oeffneStufe?(strangId, teil), oeffneGeraet?(spurId)   the window layer of the view (montiereFenster hands them out)
//   adapterCtx              the view's context, handed ONLY to the shared adapters in production/ that already serve both views
//                           (spurAdapter, baueInsertAdapter, returnQuelleHall, surgeIstEinlesen, bindeGeraetAnsicht)
//   spurFensterHaken?: { offen(spurId, koerper), zu(spurId), wahl() }   the cut/kit host of STUDIO
//   masterSpalte?           true: the MASTER card stands in a column of its own at the right edge of the dock, outside the rows (PRODUCTION); false (default):
//                           it ends the EFFECTS row (STUDIO, unchanged markup). The column is div[data-w="dock-master"], the rows sit in div.w-dock-reihen.
//   einzel?                 'ret:<id>' | 'grp:<id>' | 'master' (dock/target.js text): the dock draws exactly that one strip card, no rows, no + cards (the strip window, target_window.js)
//   alleReturns?            true: the EFFECTS row lists every return of the project, the HALL and DELAY returns of the loop decks too (SESSION); the send
//                           knobs stay with the returns every track may send into. A deck return is labelled FROM L<deck>.
//   spurKnoepfe?(spurId) -> [{ param, name, titel, vorgabe, lies() -> 0..1, setze(k), text(k), ende? }]   front knobs of an AUDIO track card, which has no device panel
//   masterHaken?(karteEl)   called with the MASTER card after it was built (SESSION puts the master strip of the page into it)
//   schalter: { gruppen, sends, mischer, stufenFenster }   switches of the later stages; all false by default
//   hostLage(insertId) -> HostLage | null, grLesung(insert, jetzt), presetMarke(insertId), pluginFenster(insertId), stufenPopover(strang, insert, anker), kopfBeat() -> number | null
//                           the state of the stages (read by the chips and the stage windows of the later tasks; kopfBeat defaults to null)
//   hostLatenzen() -> { insertId: samples } | null, graphLatenzen() -> { graph: samples } | null   the latency data pdcRechnen takes (the latency text of a card)
//
// GENERIC CARDS (plan 2026-11-19-one-dock-stage-5a, D2/D3; allgemein.js). A host that has `modell` is fed with pure card data instead of a project (DJ and LIVE):
//   modell(stand) -> { zeilen: [{ key, titel, w, karten: [Karte] }], master: [Karte] }; gestalt(modell) -> string (the rebuild key); projekt() returns null
//   beimProjekt(fn(stand, wechsel))   the host calls it with its snapshot; null empties the dock (and closes the windows of the layer)
//   aktionen: { wert(id, param) -> 0..1 | null, setze(id, param, k), ende?(id, param), text(id, param, k) -> string, gr(id, teil) -> dB | null,
//               chip(id, teil, anker), chipMenue(id, teil) -> menu entries, plus?(id, anker), wechsel?(id, anker), auf?(id, anker), menue?(id) -> menu entries, vorn(id) }
//   Karte: { id, art: 'kanal' | 'ret' | 'master', kurz, name, farbe, untertitel, untertitelArt: 'instrument' | 'inhalt' | 'effekt' | null, untertitelTitel,
//            inhalt: { text, titel, laeuft } | null, teile: [{ teil, text, titel, an, art, gr, grSkala, abschnitt? }], plus: { aus, titel } | null, wechsel, auf,
//            knoepfe: [{ param, name, titel, vorgabe }], knopfGruppe, meter, pegelText, menue, aktiv }
import { returnListe, sendWert } from '../production/routing.js';
import { straenge } from '../production/inserts.js';
import { oeffneMenue } from '../production/context_menu.js';
import { steuerungen, parameterVon } from '../panel.js';
import { parameterNachName } from '../panel_display.js';
import { geraetSchluessel, spurAdapter, reglerBereiche, surgeIstEinlesen } from '../production/device_view.js';
import { geraetText } from '../seq_field.js';
import { neuePanelQuelle, ersatzPanel } from './panel_source.js';
import { rackTeile, masterTeile } from './stages.js';
import { baueReihen } from './blocks.js';
import { synthKarte, gruppenKarte, fxKarte, masterKarte, neuKarte, neueGruppeKarte } from './karten.js';
import { dockModell, dockGestalt } from './model.js';
import { montiereKarten } from './allgemein.js';
import { parseZiel } from './target.js';

export const DOCK_TEXT = {
  synths: 'SYNTHS', fx: 'EFFECTS', neueSpur: '+ INSTRUMENT TRACK', neueSpurTitel: 'Add an instrument track to the module',
  plus: '+ INSERT', plusTitel: 'Insert: add an effect stage on this track only (to share one effect between tracks use + LOAD EFFECT)', auf: 'OPEN ↗', aufTitel: 'Open the full device here in the page (WINDOW opens it as a separate browser window)', fenster: 'WINDOW ↗',
  chipTitel: 'Click: open · right click: ON/OFF, move, remove', level: 'LEVEL', an: 'ON', anTitel: 'Effect on or off (off mutes the return)',
  weg: '✕', wegTitel: 'Remove this effect from the rack', keineSends: 'NO SENDS', von: (l) => `FROM ${l.join(' ')}`,
  vonTitel: 'The tracks that send into this effect (turn the small knobs of a track to change it)', master: 'MASTER',
  wechsel: '⇄ CHANGE', wechselTitel: 'Change the instrument of this track; the notes stay',
  anTitelMischer: 'Main effect on or off', neueGruppe: '+ GROUP', neueGruppeTitel: 'Add a group track', gruppenVoll: (n) => `All ${n} groups are used`,
  neuEffekt: '+ LOAD EFFECT', wegFrage: (name) => `Remove the effect ${name} from the rack? The sends into it go too (Undo brings both back).`,
};

const NICHTS = () => {};
const ZEILEN_TITEL = { spuren: 'SYNTHS', gruppen: 'GROUPS', fx: 'EFFECTS' };
const SCHALTER = { gruppen: false, sends: false, mischer: false, stufenFenster: false };

/** The host with the defaults filled in: all switches off, no-op hooks, the row labels, the context menu and a panel source of its own. */
export function hostMitVorgaben(host) {
  const h = { ...host };
  h.schalter = { ...SCHALTER, ...(host.schalter ?? {}) };
  h.zeilenTitel = { ...ZEILEN_TITEL, ...(host.zeilenTitel ?? {}) };
  h.masterSpalte ??= false;
  h.beimBild ??= NICHTS;
  h.beimEreignis ??= NICHTS;
  h.kopfBeat ??= () => null;
  h.oeffneMenue ??= oeffneMenue;
  h.panelQuelle ??= neuePanelQuelle(h);
  return h;
}

const anfrage = (g) => {
  const s = geraetSchluessel(g);
  if (s === 'surge') return '/geraete/panel?art=surge';
  if (s === 'rb338') return '/geraete/panel?art=rb338';
  return `/geraete/panel?art=bk&graph=${encodeURIComponent(g.graph)}`;
};

export function montiereDock(hostRoh) {
  const host = hostMitVorgaben(hostRoh);
  const T = DOCK_TEXT;
  if (typeof host.modell === 'function') return montiereKarten(host, T);   // a live host: generic cards from its snapshot (allgemein.js)
  const dockEl = host.dockEl;
  const zeilen = [{ key: 'spuren', titel: host.zeilenTitel.spuren, w: 'dock-synths' }]
    .concat(host.schalter.gruppen ? [{ key: 'gruppen', titel: host.zeilenTitel.gruppen, w: 'dock-grp' }] : [])
    .concat([{ key: 'fx', titel: host.zeilenTitel.fx, w: 'dock-fx' }]);
  const einzel = host.einzel ? parseZiel(host.einzel) : null;   // one strip card instead of the rows
  const rahmen = einzel ? null : baueReihen(dockEl, zeilen, !!host.masterSpalte);
  const reiheMaster = rahmen?.master;
  const reiheSynth = rahmen?.reihen.spuren, reiheGrp = rahmen?.reihen.gruppen ?? null, reiheFx = rahmen?.reihen.fx;
  const quelle = host.panelQuelle;
  let gebaut = null;
  const geraete = new Map();   // "<track id>|<device key>" -> Promise<{panel, regler, parameter, adapter} | null>
  // the state the card builders share (karten.js, parts.js, plus.js): the generation of the last rebuild and the refresh functions of the cards
  const werk = {
    host, T, quelle, gen: 0, frisch: [], modell: null, vorn: null, setzeVorn: () => setzeVorn(),
    strangVon: (id) => straenge(host.projekt()).find((s) => s.id === id) ?? null,
    returnVon: (id) => returnListe(host.projekt(), { mitLoopdeck: true }).find((r) => r.id === id) ?? null,
    // the labels of the tracks that send into the return (send above -60 dB)
    sendeVon: (p, returnId) => {
      const spuren = p?.spuren ?? [];
      return host.zuege(p).filter((z) => sendWert(spuren.find((s) => s.id === z.id), returnId) > -60).map((z) => z.kurz);
    },
    geraetInfo,
  };
  const frischAlle = () => { for (const f of werk.frisch) f(); };

  // ---- the device of an instrument track (panel, ranges, adapter), loaded once per track and device ------------------------------------------------------
  function geraetInfo(spur) {
    const sk = geraetSchluessel(spur.geraet);
    if (!sk) return Promise.resolve(null);
    const key = `${spur.id}|${sk}`;
    if (!geraete.has(key)) {
      geraete.set(key, (async () => {
        const r = await host.holeGet(anfrage(spur.geraet));
        const j = r?.j;
        if (r?.status !== 200 || !j) return null;
        let panel = j.panel;
        if (!panel && sk.startsWith('bk:')) { const g = (await quelle.graphen()).find((x) => x.name === spur.geraet.graph); panel = ersatzPanel(spur.geraet.graph, g?.regler_namen, reglerBereiche(j.parameter)); }
        if (!panel) return null;
        const namen = {};
        for (const c of steuerungen(panel)) for (const pn of parameterVon(c)) namen[pn] ??= c.label ?? c.id;
        let tabelle = j.parameter ?? [];
        if (sk === 'surge') tabelle = await surgeIstEinlesen(host.adapterCtx, spur, tabelle, Object.keys(namen));
        const adapter = spurAdapter(host.adapterCtx, spur, tabelle, { label: (pn) => namen[pn] ?? pn, melde: (t, f) => { if (t) host.melde(t, f); }, beiFertig: () => frischAlle() });
        return { panel, regler: reglerBereiche(j.parameter), parameter: sk.startsWith('bk:') ? undefined : parameterNachName(j.parameter), adapter };
      })().then((x) => { if (!x) geraete.delete(key); return x; }, () => { geraete.delete(key); return null; }));
    }
    return geraete.get(key);
  }

  // the card in front among group, return and master cards (a click on a free spot, karten.js); dock state only
  function setzeVorn() {
    if (!host.schalter.mischer) return;
    for (const k of dockEl.querySelectorAll('[data-strang]')) if (k.getAttribute('data-w') !== 'karte-spur') k.classList.toggle('aktiv', k.getAttribute('data-strang') === werk.vorn);
  }
  // what decides a rebuild: the card model (tracks, groups, returns, master with their stages) and the device of every track
  const gestalt = (m, p) => dockGestalt(m) + JSON.stringify(m.spuren.map((z) => geraetSchluessel(p.spuren.find((x) => x.id === z.id)?.geraet)));
  let wahlVorher = null;
  function zeichne(erzwingen = false) {
    const p = host.projekt();
    if (!p) return;
    const m = dockModell(p, { zuege: host.zuege, kurz: host.kurz, schalter: host.schalter, alleReturns: host.alleReturns === true, hostLage: host.hostLatenzen?.() ?? null, graphLatenzen: host.graphLatenzen?.() ?? null });
    werk.modell = m;
    const g = gestalt(m, p);
    // a card name is being typed (task 8): no rebuild under the input; the next project update after it closed builds again
    const tippt = !erzwingen && dockEl.querySelector('input.p-namefeld');
    if (einzel) {   // the strip window: the card of that one strip, rebuilt when the model changes, gone when the strip is gone
      if (!tippt && (erzwingen || g !== gebaut)) {
        gebaut = g; werk.frisch = []; werk.gen += 1;
        const meine = werk.gen;
        const karte = einzel.art === 'grp' ? (m.gruppen.find((k) => k.id === einzel.id) ? gruppenKarte(werk, m.gruppen.find((k) => k.id === einzel.id), meine) : null)
          : einzel.art === 'ret' ? (returnListe(p, { mitLoopdeck: true }).find((r) => r.id === einzel.id) ? fxKarte(werk, returnListe(p, { mitLoopdeck: true }).find((r) => r.id === einzel.id), meine) : null)
          : einzel.art === 'master' ? masterKarte(werk, meine) : null;
        dockEl.replaceChildren(...(karte ? [karte] : []));
      }
      frischAlle();
      return;
    }
    if (!tippt && (erzwingen || g !== gebaut)) {
      gebaut = g; werk.frisch = []; werk.gen += 1;
      const meine = werk.gen;
      const spuren = host.zuege(p).map((z) => synthKarte(werk, z, p.spuren.find((s) => s.id === z.id), meine));
      const neu = host.spurNeu ? neuKarte('karte-spur-neu', T.neueSpur, T.neueSpurTitel, (ev) => { ev.stopPropagation?.(); host.spurNeu?.(neu); }) : null;
      if (neu) neu.disabled = host.spurNeuAus?.(p) ?? false;
      reiheSynth.replaceChildren(...spuren, ...(neu ? [neu] : []));
      reiheGrp?.replaceChildren(...m.gruppen.map((k) => gruppenKarte(werk, k, meine)), neueGruppeKarte(werk));
      const laden = neuKarte('fx-laden', T.neuEffekt, 'Load a send effect: every track can then send into it with its small knobs (an insert sits on one track only)', async () => {
        const punkte = host.fxMenue(host.projekt(), await quelle.graphen(true)).map((x) => (x.gruppe ? x : { text: x.text, aus: x.befehl === null, titel: x.grund,
          aktion: () => host.aendere(`Add effect ${x.befehl.name}`, [x.befehl]) }));
        const q = laden.getBoundingClientRect();
        host.oeffneMenue(punkte, q.left, q.bottom);
      });
      const master = masterKarte(werk, meine);
      reiheFx.replaceChildren(...returnListe(p, { mitLoopdeck: host.alleReturns === true }).map((r) => fxKarte(werk, r, meine)), laden, ...(reiheMaster ? [] : [master]));
      reiheMaster?.replaceChildren(master);
      setzeVorn();
    }
    frischAlle();
    const wahl = host.wahl.lies();
    for (const k of reiheSynth.querySelectorAll('[data-w="karte-spur"]')) k.classList.toggle('aktiv', k.getAttribute('data-spur-id') === wahl);
    // PRODUCTION and SESSION: the card of the selected track scrolls into view
    if ((host.ansicht === 'production' || host.ansicht === 'session') && wahl && wahl !== wahlVorher) {
      [...reiheSynth.querySelectorAll('[data-w="karte-spur"]')].find((k) => k.getAttribute('data-spur-id') === wahl)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    wahlVorher = wahl;
  }

  host.beimProjekt((p, wechsel) => {
    if (wechsel) { geraete.clear(); gebaut = null; }
    if (p) zeichne(); else { reiheSynth?.replaceChildren(); reiheGrp?.replaceChildren(); reiheFx?.replaceChildren(); reiheMaster?.replaceChildren(); if (einzel) dockEl.replaceChildren(); werk.modell = null; werk.frisch = []; gebaut = null; werk.gen += 1; }
  });
  host.wahl.beiWechsel(() => zeichne());
  // the latency text follows the plugin state and the graph list, which arrive without a project update: refresh about once a second (no-op where the view has no frame hook)
  let zuletzt = 0;
  host.beimBild((t) => { if (t - zuletzt > 1000) { zuletzt = t; zeichne(); } });
}
