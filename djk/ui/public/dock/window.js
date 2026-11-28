// Workbench big view: floating windows inside the page (the "extended view" of a card). A window has a title bar that drags (pointer events, so it works by
// touch too), a close button and a body; several can be open at once. Its position is remembered per kind of device (host.lies / host.merke).
// What a window shows:
//   - an instrument track: the full front panel (bindeGeraetAnsicht, breit: true); for the cut of a sampler track the cut strip and the kit dialog of the
//     SOUND host (sound.js, schnitt_kit.js) sit below the panel. The strip works on the selected track, so the host follows the selection: it sits in the
//     window of the selected track, and without such a window it is hidden in the workbench root (never under the title of another track);
//   - the Hall of a return: the Hall face (baueHallFace) with its ON/OFF;
//   - a Baukasten stage of a track, a return or the master: its panel (baueFrontplatte, breit: true) with ON/OFF, move earlier/later and remove;
//   - a utility, gate, multiband, transient shaper, imager or plugin stage where the host has stufenPopover (PRODUCTION): its parameter popover at the chip, no window; elsewhere a short text.
//   - any other stage: a short text. The native inserts (comp, saturation, limiter, EQ) keep their floating faces: oeffneStufe opens those instead.
// Entry points: montiereFenster(host) returns { fenster: {oeffne(def), schliesse(id), schliesseAlle(), offen()}, oeffneGeraet(spurId), oeffneStufe(strangId, teil) }.
// It talks to its view only through the host object (see dock.js); the cut/kit host of STUDIO hangs on host.spurFensterHaken.
//
// Markup (every element carries data-w): div[data-w="fenster-flaeche"] (the layer over the workbench) holds div[data-w="fenster"][data-fenster-id] with
//   div[data-w="fenster-kopf"] (title bar: b fenster-titel, span fenster-unter, span fenster-leiste (the buttons of the stage: fenster-an, fenster-links,
//   fenster-rechts, fenster-weg), button fenster-zu) and div[data-w="fenster-koerper"].
// UI texts English.
import { bindeGeraetAnsicht, geraetSchluessel } from '../production/device_view.js';
import { straenge, anBefehl, entfernenBefehl, ordnungBefehl, verschoben, baueInsertAdapter, insertLabels, HOST_STATUS_TEXT } from '../production/inserts.js';
import { FACE_ARTEN } from '../production/insert_face.js';
import { returnQuelleHall } from '../production/return_face.js';
import { returnListe } from '../production/routing.js';
import { baueHallFace } from '../face/reverb.js';
import { baueFrontplatte } from '../panel.js';
import { istSpace } from '../panel_kopf.js';
import { baueSpaceKopf } from './space_kopf.js';
import { baueStufenPopover } from '../production/insert_popover.js';
import { geraetText } from '../seq_field.js';
import { effektKachel } from './stages.js';
import { ersatzPanel } from './panel_source.js';
import { hostMitVorgaben } from './dock.js';
import { fokus } from '../controller_fokus.js';
import { kannGeraetFenster, oeffneGeraetFenster, GERAET_FENSTER_TEXT } from '../device_open.js';

// the stage kinds whose parameters are the rows of the popover (no device face, no panel window)
const PARAMETER_ARTEN = ['utility', 'gate', 'mb', 'trans', 'bild', 'host'];

export const FENSTER_TEXT = {
  zu: 'Close this window',
  keinPanel: 'This instrument has no front panel in the workbench.',
  keinFenster: 'This stage has no panel here.',
  nativ: 'NATIVE WINDOW', nativTitel: 'Open the plugin\'s own window on the studio machine',
  liste: 'Show the parameter list of this stage', panel: 'Show the front panel of this stage',
  an: 'Switch this stage on or off', links: 'Move earlier in the chain', rechts: 'Move later in the chain', weg: 'Remove this stage (Undo brings it back)',
};

const el = (tag, klasse, w, text) => {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (w) e.setAttribute('data-w', w);
  if (text !== undefined) e.textContent = text;
  return e;
};
const knopf = (klasse, w, text, titel, klick) => {
  const b = el('button', klasse, w, text); b.type = 'button'; b.title = titel; b.addEventListener('click', klick);
  return b;
};

export function montiereFenster(hostRoh) {
  const host = hostMitVorgaben(hostRoh);
  const flaeche = host.flaecheEl;
  const KEY = host.fensterSchluessel;
  const offene = new Map();   // id -> {def, e, koerper, leiste, handle, zu}
  let oben = 20, versatz = 0;
  const quelle = host.panelQuelle;

  // ---- the window frame --------------------------------------------------------------------------------------------------------------------------
  const lageVon = (art) => {
    const m = /^(-?\d+),(-?\d+)$/.exec(host.lies(KEY + art, '') ?? '');
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  function setzeLage(f, x, y) {
    const r = flaeche.getBoundingClientRect();
    const breite = r.width || 1200, hoehe = r.height || 700;
    f.x = Math.min(Math.max(0, x), Math.max(0, breite - 80));
    f.y = Math.min(Math.max(0, y), Math.max(0, hoehe - 40));
    f.e.style.left = `${f.x}px`; f.e.style.top = `${f.y}px`;
  }
  const nachVorn = (f) => { oben += 1; f.e.style.zIndex = String(oben); if (f.def?.spurId !== undefined) fokus.melde({ spur_id: f.def.spurId }, host.ansicht); };   // the large view in front is the synth in front

  function oeffne(def) {
    const alt = offene.get(def.id);
    if (alt) { nachVorn(alt); return alt; }
    const e = el('div', def.voll ? 'w-fenster w-fenster-voll' : 'w-fenster', 'fenster');   // voll: the window page of a stage (target_window.js): fills the page, no drag, no close
    e.setAttribute('data-fenster-id', def.id); e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', def.titel);
    const kopf = el('div', 'w-fenster-kopf', 'fenster-kopf');
    const leiste = el('span', 'w-fenster-leiste', 'fenster-leiste');
    const f = { def, e, koerper: el('div', 'w-fenster-koerper', 'fenster-koerper'), leiste, handle: null, zu: false, x: 0, y: 0, frisch: [] };
    const zu = knopf('w-fenster-zu', 'fenster-zu', '✕', FENSTER_TEXT.zu, () => schliesse(def.id));
    kopf.append(el('b', 'w-fenster-titel', 'fenster-titel', def.titel), el('span', 'w-fenster-unter', 'fenster-unter', def.untertitel ?? ''), leiste, ...(def.voll ? [] : [zu]));
    e.append(kopf, f.koerper);
    if (def.voll) { flaeche.append(e); offene.set(def.id, f); f.handle = def.bauen(f.koerper, leiste, f) ?? null; return f; }
    // drag by the title bar
    let griff = null;
    kopf.addEventListener('pointerdown', (ev) => {
      if (ev.target?.closest?.('button')) return;
      griff = { dx: (ev.clientX ?? 0) - f.x, dy: (ev.clientY ?? 0) - f.y };
      kopf.setPointerCapture?.(ev.pointerId); ev.preventDefault?.(); nachVorn(f);
    });
    kopf.addEventListener('pointermove', (ev) => { if (griff) setzeLage(f, (ev.clientX ?? 0) - griff.dx, (ev.clientY ?? 0) - griff.dy); });
    const los = () => { if (!griff) return; griff = null; host.merke(KEY + def.art, `${Math.round(f.x)},${Math.round(f.y)}`); };
    kopf.addEventListener('pointerup', los); kopf.addEventListener('pointercancel', los);
    e.addEventListener('pointerdown', () => nachVorn(f));
    const lage = lageVon(def.art) ?? { x: 330 + 28 * (versatz % 6), y: 60 + 28 * (versatz % 6) };
    versatz += 1;
    setzeLage(f, lage.x, lage.y); nachVorn(f);
    flaeche.append(e);
    offene.set(def.id, f);
    f.handle = def.bauen(f.koerper, leiste, f) ?? null;
    return f;
  }
  function schliesse(id) {
    const f = offene.get(id);
    if (!f) return;
    offene.delete(id); f.zu = true;
    f.handle?.zerstoere?.();
    f.def.nachSchliessen?.();
    f.e.remove();
  }
  const schliesseAlle = () => { for (const id of [...offene.keys()]) schliesse(id); };
  const fenster = { oeffne, schliesse, schliesseAlle, offen: () => [...offene.keys()] };

  host.beimProjekt((p, wechsel) => {
    if (!p || wechsel) { schliesseAlle(); return; }
    for (const [id, f] of [...offene]) {
      if (f.def.pruefe && !f.def.pruefe()) { schliesse(id); continue; }
      for (const g of f.frisch) g();
      f.handle?.aktualisiere?.();
    }
  });

  // ---- the stage buttons in the title bar ---------------------------------------------------------------------------------------------------------
  const strangVon = (id) => straenge(host.projekt()).find((s) => s.id === id) ?? null;
  // ON/OFF, earlier, later and remove of an insert stage; the Hall of a return only has ON/OFF. Returns the refresh function.
  function stufenLeiste(leiste, strangId, teil, voll = false) {
    const jetzt = () => {
      const s = strangVon(strangId);
      if (!s) return null;
      if (teil === 'hall') { const r = returnListe(host.projekt(), { mitLoopdeck: true }).find((x) => x.id === strangId); return r ? { s, r, hall: true } : null; }
      const pos = s.inserts.findIndex((i) => i.id === teil);
      return pos < 0 ? null : { s, insert: s.inserts[pos], pos, ids: s.inserts.map((i) => i.id) };
    };
    const L = () => { const x = jetzt(); return x?.insert ? insertLabels(x.s.name, x.pos + 1, x.insert.art) : null; };
    const an = knopf('w-effekt-knopf', 'fenster-an', 'ON', FENSTER_TEXT.an, () => {
      const x = jetzt(); if (!x) return;
      if (x.hall) { const aus = x.r.hall?.an !== false; host.aendere(`Hall ${aus ? 'off' : 'on'} return ${x.r.name}`, [{ befehl: 'return_aendern', return_id: x.r.id, hall: { an: !aus } }]); return; }
      const ist = x.insert.an !== false;
      host.aendere(`${ist ? 'Bypass' : 'Enable'} ${effektKachel(x.insert).text} on ${x.s.name}`, [anBefehl(x.insert.id, !ist)]);
    });
    leiste.append(an);
    let links = null, rechts = null;
    if (teil !== 'hall') {
      const bewege = (schritt, text) => () => {
        const x = jetzt(); if (!x) return;
        const neu = verschoben(x.ids, x.pos, schritt);
        if (neu) host.aendere(L()[text], [ordnungBefehl(x.s.id, neu)]);
      };
      links = knopf('w-effekt-knopf', 'fenster-links', '◀', FENSTER_TEXT.links, bewege(-1, 'links'));
      rechts = knopf('w-effekt-knopf', 'fenster-rechts', '▶', FENSTER_TEXT.rechts, bewege(1, 'rechts'));
      const weg = knopf('w-effekt-knopf', 'fenster-weg', '✕', FENSTER_TEXT.weg, () => { const x = jetzt(); if (x) host.aendere(L().weg, [entfernenBefehl(x.insert.id)]); });
      leiste.append(links, rechts, weg);
    }
    if (!voll && teil !== 'hall' && host.schalter?.stufenFenster && !host.einzel) leiste.append(knopf('w-effekt-knopf', 'fenster-zielfenster', 'WINDOW ↗', 'Open this stage in its own window', () => oeffneGeraetFenster(`ins:${teil}`, host.melde)));
    return () => {
      const x = jetzt(); if (!x) return;
      const ist = x.hall ? x.r.hall?.an !== false : x.insert.an !== false;
      an.textContent = ist ? 'ON' : 'OFF'; an.setAttribute('aria-pressed', String(ist));
      if (links) { links.disabled = !verschoben(x.ids, x.pos, -1); rechts.disabled = !verschoben(x.ids, x.pos, 1); }
    };
  }

  // ---- what a window shows -------------------------------------------------------------------------------------------------------------------------
  const oeffneGeraet = (spurId) => {
    const p = host.projekt();
    const spur = (p?.spuren ?? []).find((s) => s.id === spurId && s.art === 'instrument');
    if (!spur) return null;
    if (host.wahl.lies() !== spurId) host.wahl.setze(spurId);   // the cut strip works on the selected track
    else fokus.melde({ spur_id: spurId }, host.ansicht);   // the large view of the track already selected: it is in front all the same (a change went through beiWahl)
    const buchstabe = host.kurz(p, spurId) ?? '';
    const jetztSpur = () => (host.projekt()?.spuren ?? []).find((s) => s.id === spurId && s.art === 'instrument') ?? null;
    const f = oeffne({
      id: `spur:${spurId}`, spurId, titel: `${buchstabe} · ${spur.name}`.trim(), untertitel: geraetText(spur), art: geraetSchluessel(spur.geraet) ?? String(spur.geraet?.name ?? 'instrument'),
      pruefe: () => jetztSpur() !== null,
      bauen: (koerper, leiste) => {
        if (kannGeraetFenster(spur)) leiste.append(knopf('w-effekt-knopf', 'fenster-fenster', GERAET_FENSTER_TEXT.knopf, GERAET_FENSTER_TEXT.titel, () => oeffneGeraetFenster(spurId, host.melde)));   // OPEN ↗: its own browser window
        const panelHost = el('div', 'w-fenster-geraet', 'fenster-geraet');
        koerper.append(panelHost);
        const ansicht = bindeGeraetAnsicht(host.adapterCtx, panelHost, { breit: true });
        const zeige = () => {
          const s = jetztSpur();
          if (ansicht.zeige(s) || !s) return;
          panelHost.replaceChildren(el('p', '', null, FENSTER_TEXT.keinPanel));
        };
        zeige();
        return { aktualisiere: zeige, zerstoere: () => ansicht.zeige(null) };
      },
      nachSchliessen: () => host.spurFensterHaken?.zu(spurId),
    });
    host.spurFensterHaken?.offen(spurId, f.koerper);   // an existing window is only brought to the front: the cut/kit host still has to come to it
    return f;
  };
  function hallFenster(r) {
    const ret = () => returnListe(host.projekt(), { mitLoopdeck: true }).find((x) => x.id === r.id) ?? null;
    return oeffne({
      id: `stufe:${r.id}:hall`, titel: `${host.kurz(host.projekt(), r.id)} · ${r.name}`, untertitel: 'HALL', art: 'hall',
      pruefe: () => ret() !== null,
      bauen: (koerper, leiste, f) => {
        const frisch = stufenLeiste(leiste, r.id, 'hall');
        f.frisch.push(frisch); frisch();
        const platz = el('div', 'w-fenster-geraet', 'fenster-geraet');
        koerper.append(platz);
        const x = ret();
        return x ? baueHallFace(platz, returnQuelleHall(host.adapterCtx, x)) : null;
      },
    });
  }
  // The parameter panel of a utility or a plugin stage in a window page (the rows of the floating popover, embedded). A plugin stage also gets the status of its host
  // and NATIVE WINDOW (the plugin's own window on the studio machine: the same call as the chip menu entry).
  function parameterFenster(platz, leiste, strang, insert) {
    const strangKopf = { id: strang.id, name: strang.name };
    const ins = () => strangVon(strang.id)?.inserts.find((i) => i.id === insert.id) ?? null;
    const liste = baueStufenPopover(host.adapterCtx, strangKopf, insert, { liste: false });
    platz.append(liste.el); liste.aktualisiere(host.projekt());
    let zeigeStatus = () => {};
    if (insert.art === 'host' && typeof host.pluginFenster === 'function') {
      const punkt = el('span', 'w-fenster-status', 'fenster-status', '');
      const nativ = knopf('w-effekt-knopf', 'fenster-nativ', FENSTER_TEXT.nativ, FENSTER_TEXT.nativTitel, () => host.pluginFenster(insert.id));
      leiste.prepend(punkt, nativ);
      zeigeStatus = () => {
        const l = host.hostLage?.(insert.id) ?? null;
        punkt.textContent = l ? (HOST_STATUS_TEXT[l.status] ?? l.status) : '';
        punkt.setAttribute('data-status', l?.status ?? '');
        nativ.setAttribute('aria-pressed', String(!!l?.fenster));
      };
      zeigeStatus();
    }
    return { aktualisiere: () => { if (ins()) liste.aktualisiere(host.projekt()); zeigeStatus(); }, zerstoere: () => liste.zerstoere() };
  }
  function stufenFenster(strang, insert, voll = false) {
    const aktuell = () => { const s = strangVon(strang.id); return s?.inserts.find((i) => i.id === insert.id) ?? null; };
    const kopf = effektKachel(insert).text;
    return oeffne({
      id: `stufe:${strang.id}:${insert.id}`, titel: `${strang.name} · ${kopf}`, untertitel: insert.art === 'bk' ? 'Cypher Modular' : String(insert.art).toUpperCase(), voll,
      art: insert.art === 'bk' ? `bk:${insert.graph}` : String(insert.art),
      pruefe: () => aktuell() !== null,
      bauen: (koerper, leiste, f) => {
        const frisch = stufenLeiste(leiste, strang.id, insert.id, voll);
        f.frisch.push(frisch); frisch();
        const platz = el('div', 'w-fenster-geraet', 'fenster-geraet');
        koerper.append(platz);
        if (voll && PARAMETER_ARTEN.includes(insert.art)) return parameterFenster(platz, leiste, strang, insert);   // the window page of a util or plugin stage
        if (insert.art !== 'bk') { platz.append(el('p', '', null, FENSTER_TEXT.keinFenster)); return null; }
        // PRODUCTION (host.stufenPopover is its hook): a title-bar switch swaps the front panel for the K rows; a graph without a panel file shows the rows and no switch.
        // STUDIO has no such hook and keeps the plain panel window.
        const mitListe = typeof host.stufenPopover === 'function';
        let panel = null, liste = null, weg = false, zeigtListe = false, schalter = null, info = null, kopfWeg = null;
        const strangKopf = { id: strang.id, name: strang.name };
        const raeume = () => { kopfWeg?.(); kopfWeg = null; panel?.zerstoere?.(); panel = null; liste?.zerstoere(); liste = null; platz.textContent = ''; };
        const baueListe = () => {
          raeume(); zeigtListe = true;
          const ins = aktuell();
          if (ins) { liste = baueStufenPopover(host.adapterCtx, strangKopf, ins, { liste: true }); platz.append(liste.el); liste.aktualisiere(host.projekt()); }
        };
        const baueTafel = (i) => {
          raeume(); zeigtListe = false;
          // Cypher Space: the room selector and LOAD IR swap this stage to another graph; the stage then has a new id, so its window opens again on the new one
          const raumKopf = istSpace(insert.graph) ? (kz) => { kopfWeg = baueSpaceKopf(host, kz, { strangId: strang.id, insertId: insert.id, panel: i.panel, beiGetauscht: (neu) => { oeffneStufe(strang.id, neu.id); } }).zerstoere; } : undefined;
          panel = baueFrontplatte(platz, { panel: i.panel, regler: i.regler, breit: true, adapter: baueInsertAdapter(host.adapterCtx, strangKopf, insert.id), ...(raumKopf ? { kopf: raumKopf } : {}) });
        };
        const schalterText = () => {
          schalter.textContent = zeigtListe ? 'Panel' : 'List';
          schalter.title = zeigtListe ? FENSTER_TEXT.panel : FENSTER_TEXT.liste;
          schalter.setAttribute('aria-pressed', String(zeigtListe));
        };
        if (mitListe) {
          schalter = knopf('w-effekt-knopf', 'fenster-liste', 'List', FENSTER_TEXT.liste, () => { if (!info) return; if (zeigtListe) baueTafel(info); else baueListe(); schalterText(); });
          schalter.setAttribute('aria-pressed', 'false'); schalter.hidden = true;
          leiste.append(schalter);
        }
        quelle.panelVon(insert.graph).then((i) => {
          if (weg || !aktuell()) return;
          info = i;
          const g = (quelle.bekannt?.() ?? []).find((x) => x.name === insert.graph);
          const ohneDatei = mitListe && JSON.stringify(i.panel) === JSON.stringify(ersatzPanel(insert.graph, g?.regler_namen, i.regler));   // panelVon made it up
          if (ohneDatei) { baueListe(); return; }
          baueTafel(i);
          if (schalter) { schalter.hidden = false; schalterText(); }
        });
        return { aktualisiere: () => { panel?.aktualisiere?.(); liste?.aktualisiere(host.projekt()); }, zerstoere: () => { weg = true; kopfWeg?.(); panel?.zerstoere?.(); liste?.zerstoere(); } };
      },
    });
  }
  // A stage of a strip: the Hall of a return, a native insert (its floating face) or a Baukasten stage (a window). Returns the window, the face or null.
  const oeffneStufe = (strangId, teil, anker) => {   // anker: the element that was clicked (a chip, OPEN); the parameter popover floats at it
    const strang = strangVon(strangId);
    if (!strang) return null;
    if (teil === 'hall') {
      const r = returnListe(host.projekt(), { mitLoopdeck: true }).find((x) => x.id === strangId);
      return r ? hallFenster(r) : null;
    }
    const insert = strang.inserts.find((i) => i.id === teil);
    if (!insert) return null;
    if (FACE_ARTEN.includes(insert.art)) return host.insertFaceOeffnen?.(strang, insert) ?? null;
    if (PARAMETER_ARTEN.includes(insert.art) && typeof host.stufenPopover === 'function') return host.stufenPopover(strang, insert, anker) ?? null;   // PRODUCTION: the parameter popover at the chip
    return stufenFenster(strang, insert);
  };
  // The window page of a stage (target_window.js): the same content as the floating window or popover, filling the page. The native faces are drawn there by the face builder.
  const oeffneStufeVoll = (strangId, teil) => {
    const strang = strangVon(strangId);
    const insert = strang?.inserts.find((i) => i.id === teil);
    return insert ? stufenFenster(strang, insert, true) : null;
  };
  return { fenster, oeffneGeraet, oeffneStufe, oeffneStufeVoll };
}
