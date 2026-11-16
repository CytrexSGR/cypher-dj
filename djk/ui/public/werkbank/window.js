// Workbench big view: floating windows inside the page (the "extended view" of a card). A window has a title bar that drags (pointer events, so it works by
// touch too), a close button and a body; several can be open at once. Its position is remembered per kind of device (ctx.lies / ctx.merke).
// What a window shows:
//   - an instrument track: the full front panel (bindeGeraetAnsicht, breit: true); for the cut of a sampler track the cut strip and the kit dialog of the
//     SOUND host (sound.js, schnitt_kit.js) sit below the panel (the host moves into the window and back);
//   - the Hall of a return: the Hall face (baueHallFace) with its ON/OFF;
//   - a Baukasten stage of a track, a return or the master: its panel (baueFrontplatte, breit: true) with ON/OFF, move earlier/later and remove;
//   - any other stage: a short text. The native inserts (comp, saturation, limiter, EQ) keep their floating faces: ctx.oeffneStufe opens those instead.
// Entry points on ctx: ctx.fenster = {oeffne(def), schliesse(id), schliesseAlle(), offen()}, ctx.oeffneGeraet(spurId), ctx.oeffneStufe(strangId, teil).
//
// Markup (every element carries data-w): div[data-w="fenster-flaeche"] (the layer over the workbench) holds div[data-w="fenster"][data-fenster-id] with
//   div[data-w="fenster-kopf"] (title bar: b fenster-titel, span fenster-unter, span fenster-leiste (the buttons of the stage: fenster-an, fenster-links,
//   fenster-rechts, fenster-weg), button fenster-zu) and div[data-w="fenster-koerper"].
// UI texts English.
import { bindeGeraetAnsicht, geraetSchluessel } from '../production/device_view.js';
import { straenge, anBefehl, entfernenBefehl, ordnungBefehl, verschoben, baueInsertAdapter, insertLabels } from '../production/inserts.js';
import { FACE_ARTEN } from '../production/insert_face.js';
import { returnQuelleHall } from '../production/return_face.js';
import { returnListe } from '../production/routing.js';
import { baueHallFace } from '../face/reverb.js';
import { baueFrontplatte } from '../panel.js';
import { geraetText } from '../seq_field.js';
import { effektKachel, neuePanelQuelle } from './sound.js';
import { mixZuege } from './mix.js';

export const FENSTER_TEXT = {
  zu: 'Close this window',
  keinPanel: 'This instrument has no front panel in the workbench.',
  keinFenster: 'This stage has no panel here.',
  an: 'Switch this stage on or off', links: 'Move earlier in the chain', rechts: 'Move later in the chain', weg: 'Remove this stage (Undo brings it back)',
};
const KEY = 'djk-wb-fenster-';

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

export function bindeFenster(ctx) {
  const { st, $ } = ctx;
  const flaeche = $('fenster-flaeche');
  const offene = new Map();   // id -> {def, e, koerper, leiste, handle, zu}
  let oben = 20, versatz = 0;
  const quelle = ctx.panelQuelle ??= neuePanelQuelle(ctx);

  // ---- the window frame --------------------------------------------------------------------------------------------------------------------------
  const lageVon = (art) => {
    const m = /^(-?\d+),(-?\d+)$/.exec(ctx.lies(KEY + art, '') ?? '');
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  function setzeLage(f, x, y) {
    const r = flaeche.getBoundingClientRect();
    const breite = r.width || 1200, hoehe = r.height || 700;
    f.x = Math.min(Math.max(0, x), Math.max(0, breite - 80));
    f.y = Math.min(Math.max(0, y), Math.max(0, hoehe - 40));
    f.e.style.left = `${f.x}px`; f.e.style.top = `${f.y}px`;
  }
  const nachVorn = (f) => { oben += 1; f.e.style.zIndex = String(oben); };

  function oeffne(def) {
    const alt = offene.get(def.id);
    if (alt) { nachVorn(alt); return alt; }
    const e = el('div', 'w-fenster', 'fenster');
    e.setAttribute('data-fenster-id', def.id); e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', def.titel);
    const kopf = el('div', 'w-fenster-kopf', 'fenster-kopf');
    const leiste = el('span', 'w-fenster-leiste', 'fenster-leiste');
    const f = { def, e, koerper: el('div', 'w-fenster-koerper', 'fenster-koerper'), leiste, handle: null, zu: false, x: 0, y: 0, frisch: [] };
    const zu = knopf('w-fenster-zu', 'fenster-zu', '✕', FENSTER_TEXT.zu, () => schliesse(def.id));
    kopf.append(el('b', 'w-fenster-titel', 'fenster-titel', def.titel), el('span', 'w-fenster-unter', 'fenster-unter', def.untertitel ?? ''), leiste, zu);
    e.append(kopf, f.koerper);
    // drag by the title bar
    let griff = null;
    kopf.addEventListener('pointerdown', (ev) => {
      if (ev.target?.closest?.('button')) return;
      griff = { dx: (ev.clientX ?? 0) - f.x, dy: (ev.clientY ?? 0) - f.y };
      kopf.setPointerCapture?.(ev.pointerId); ev.preventDefault?.(); nachVorn(f);
    });
    kopf.addEventListener('pointermove', (ev) => { if (griff) setzeLage(f, (ev.clientX ?? 0) - griff.dx, (ev.clientY ?? 0) - griff.dy); });
    const los = () => { if (!griff) return; griff = null; ctx.merke(KEY + def.art, `${Math.round(f.x)},${Math.round(f.y)}`); };
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
  ctx.fenster = { oeffne, schliesse, schliesseAlle, offen: () => [...offene.keys()] };

  ctx.beimProjekt.push((p, wechsel) => {
    if (!p || wechsel) { schliesseAlle(); return; }
    for (const [id, f] of [...offene]) {
      if (f.def.pruefe && !f.def.pruefe()) { schliesse(id); continue; }
      for (const g of f.frisch) g();
      f.handle?.aktualisiere?.();
    }
  });

  // ---- the stage buttons in the title bar ---------------------------------------------------------------------------------------------------------
  const strangVon = (id) => straenge(st.projekt).find((s) => s.id === id) ?? null;
  // ON/OFF, earlier, later and remove of an insert stage; the Hall of a return only has ON/OFF. Returns the refresh function.
  function stufenLeiste(leiste, strangId, teil) {
    const jetzt = () => {
      const s = strangVon(strangId);
      if (!s) return null;
      if (teil === 'hall') { const r = returnListe(st.projekt).find((x) => x.id === strangId); return r ? { s, r, hall: true } : null; }
      const pos = s.inserts.findIndex((i) => i.id === teil);
      return pos < 0 ? null : { s, insert: s.inserts[pos], pos, ids: s.inserts.map((i) => i.id) };
    };
    const L = () => { const x = jetzt(); return x?.insert ? insertLabels(x.s.name, x.pos + 1, x.insert.art) : null; };
    const an = knopf('w-effekt-knopf', 'fenster-an', 'ON', FENSTER_TEXT.an, () => {
      const x = jetzt(); if (!x) return;
      if (x.hall) { const aus = x.r.hall?.an !== false; ctx.aendere(`Hall ${aus ? 'off' : 'on'} return ${x.r.name}`, [{ befehl: 'return_aendern', return_id: x.r.id, hall: { an: !aus } }]); return; }
      const ist = x.insert.an !== false;
      ctx.aendere(`${ist ? 'Bypass' : 'Enable'} ${effektKachel(x.insert).text} on ${x.s.name}`, [anBefehl(x.insert.id, !ist)]);
    });
    leiste.append(an);
    let links = null, rechts = null;
    if (teil !== 'hall') {
      const bewege = (schritt, text) => () => {
        const x = jetzt(); if (!x) return;
        const neu = verschoben(x.ids, x.pos, schritt);
        if (neu) ctx.aendere(L()[text], [ordnungBefehl(x.s.id, neu)]);
      };
      links = knopf('w-effekt-knopf', 'fenster-links', '◀', FENSTER_TEXT.links, bewege(-1, 'links'));
      rechts = knopf('w-effekt-knopf', 'fenster-rechts', '▶', FENSTER_TEXT.rechts, bewege(1, 'rechts'));
      const weg = knopf('w-effekt-knopf', 'fenster-weg', '✕', FENSTER_TEXT.weg, () => { const x = jetzt(); if (x) ctx.aendere(L().weg, [entfernenBefehl(x.insert.id)]); });
      leiste.append(links, rechts, weg);
    }
    return () => {
      const x = jetzt(); if (!x) return;
      const ist = x.hall ? x.r.hall?.an !== false : x.insert.an !== false;
      an.textContent = ist ? 'ON' : 'OFF'; an.setAttribute('aria-pressed', String(ist));
      if (links) { links.disabled = !verschoben(x.ids, x.pos, -1); rechts.disabled = !verschoben(x.ids, x.pos, 1); }
    };
  }

  // ---- what a window shows -------------------------------------------------------------------------------------------------------------------------
  ctx.oeffneGeraet = (spurId) => {
    const spur = (st.projekt?.spuren ?? []).find((s) => s.id === spurId && s.art === 'instrument');
    if (!spur) return null;
    if (st.wahl !== spurId) ctx.waehle(spurId);   // the cut strip works on the selected track
    const buchstabe = mixZuege(st.projekt).find((z) => z.id === spurId)?.buchstabe ?? '';
    const jetztSpur = () => (st.projekt?.spuren ?? []).find((s) => s.id === spurId && s.art === 'instrument') ?? null;
    return oeffne({
      id: `spur:${spurId}`, titel: `${buchstabe} · ${spur.name}`.trim(), untertitel: geraetText(spur), art: geraetSchluessel(spur.geraet) ?? String(spur.geraet?.name ?? 'instrument'),
      pruefe: () => jetztSpur() !== null,
      bauen: (koerper) => {
        const panelHost = el('div', 'w-fenster-geraet', 'fenster-geraet');
        koerper.append(panelHost);
        if (ctx.klangHost) { ctx.klangHost.hidden = false; koerper.append(ctx.klangHost); }
        const ansicht = bindeGeraetAnsicht(ctx, panelHost, { breit: true });
        const zeige = () => {
          const s = jetztSpur();
          if (ansicht.zeige(s) || !s) return;
          panelHost.replaceChildren(el('p', '', null, FENSTER_TEXT.keinPanel));
        };
        zeige();
        return { aktualisiere: zeige, zerstoere: () => ansicht.zeige(null) };
      },
      nachSchliessen: () => {
        // the SOUND host goes back to the workbench root unless another window took it meanwhile
        const h = ctx.klangHost;
        if (h && !offeneMitKlang()) { h.hidden = true; $('fenster-flaeche').parent?.append(h); }
      },
    });
  };
  const offeneMitKlang = () => !!ctx.klangHost && [...offene.values()].some((f) => f.koerper.contains(ctx.klangHost));

  function hallFenster(r) {
    const ret = () => returnListe(st.projekt).find((x) => x.id === r.id) ?? null;
    return oeffne({
      id: `stufe:${r.id}:hall`, titel: `FX${r.nr} · ${r.name}`, untertitel: 'HALL', art: 'hall',
      pruefe: () => ret() !== null,
      bauen: (koerper, leiste, f) => {
        const frisch = stufenLeiste(leiste, r.id, 'hall');
        f.frisch.push(frisch); frisch();
        const host = el('div', 'w-fenster-geraet', 'fenster-geraet');
        koerper.append(host);
        const x = ret();
        return x ? baueHallFace(host, returnQuelleHall(ctx, x)) : null;
      },
    });
  }
  function stufenFenster(strang, insert) {
    const aktuell = () => { const s = strangVon(strang.id); return s?.inserts.find((i) => i.id === insert.id) ?? null; };
    const kopf = effektKachel(insert).text;
    return oeffne({
      id: `stufe:${strang.id}:${insert.id}`, titel: `${strang.name} · ${kopf}`, untertitel: insert.art === 'bk' ? 'Baukasten' : String(insert.art).toUpperCase(),
      art: insert.art === 'bk' ? `bk:${insert.graph}` : String(insert.art),
      pruefe: () => aktuell() !== null,
      bauen: (koerper, leiste, f) => {
        const frisch = stufenLeiste(leiste, strang.id, insert.id);
        f.frisch.push(frisch); frisch();
        const host = el('div', 'w-fenster-geraet', 'fenster-geraet');
        koerper.append(host);
        if (insert.art !== 'bk') { host.append(el('p', '', null, FENSTER_TEXT.keinFenster)); return null; }
        let panel = null, weg = false;
        quelle.panelVon(insert.graph).then((info) => {
          if (weg || !aktuell()) return;
          panel = baueFrontplatte(host, { panel: info.panel, regler: info.regler, breit: true, adapter: baueInsertAdapter(ctx, { id: strang.id, name: strang.name }, insert.id) });
        });
        return { aktualisiere: () => panel?.aktualisiere?.(), zerstoere: () => { weg = true; panel?.zerstoere?.(); } };
      },
    });
  }
  // A stage of a strip: the Hall of a return, a native insert (its floating face) or a Baukasten stage (a window). Returns the window, the face or null.
  ctx.oeffneStufe = (strangId, teil) => {
    const strang = strangVon(strangId);
    if (!strang) return null;
    if (teil === 'hall') {
      const r = returnListe(st.projekt).find((x) => x.id === strangId);
      return r ? hallFenster(r) : null;
    }
    const insert = strang.inserts.find((i) => i.id === teil);
    if (!insert) return null;
    if (FACE_ARTEN.includes(insert.art)) return ctx.insertFaceOeffnen?.(strang, insert) ?? null;
    return stufenFenster(strang, insert);
  };
}
