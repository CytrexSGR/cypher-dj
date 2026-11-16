// Workbench DOCK (spec 2026-11-16-werkbank-dock-sequencer-design.md, A): the device cards under the tracks and the notes. It replaces the SOUND column and the
// MIX view of stage 1; their code lives on here (the knobs, the effect menu, the "+" menu of the stage chains) or in window.js (the big view).
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
import { posVonDb } from '../production/fader_curve.js';
import { returnListe, sendWert, hallText } from '../production/routing.js';
import { straenge, anBefehl, entfernenBefehl, ordnungBefehl, verschoben, baueInsertAdapter, insertLabels } from '../production/inserts.js';
import { FACE_ARTEN } from '../production/insert_face.js';
import { returnQuelleHall } from '../production/return_face.js';
import { HALL_NORM_VORGABE } from '../face/reverb.js';
import { oeffneMenue } from '../production/context_menu.js';
import { steuerungen, parameterVon, wertText, vorgabeK } from '../panel.js';
import { parameterNachName } from '../panel_display.js';
import { geraetSchluessel, spurAdapter, reglerBereiche, surgeIstEinlesen } from '../production/device_view.js';
import { geraetText } from '../seq_field.js';
import { faderText, MAX_SPUREN_MODUL } from './tracks.js';
import { mixZuege, fxMenue, rackTeile, masterTeile, neuerDrehknopf, sendPos, sendDb, MIX_TEXT } from './mix.js';
import { effektKachel, plusEintraege, neuePanelQuelle, ersatzPanel, KLANG_TEXT } from './sound.js';

export const DOCK_TEXT = {
  synths: 'SYNTHS', fx: 'EFFECTS', neueSpur: '+ INSTRUMENT TRACK', neueSpurTitel: 'Add an instrument track to the module',
  plus: '+ INSERT', plusTitel: 'Add an effect stage to this strip', auf: 'OPEN ↗', aufTitel: 'Open the full device in a window',
  chipTitel: 'Click: open · right click: ON/OFF, move, remove', level: 'LEVEL', an: 'ON', anTitel: 'Effect on or off (off mutes the return)',
  weg: '✕', wegTitel: 'Remove this effect from the rack', keineSends: 'NO SENDS', von: (l) => `FROM ${l.join(' ')}`,
  vonTitel: 'The tracks that send into this effect (turn the small knobs of a track to change it)', master: 'MASTER',
};
const MAX_FRONT = 6;
const HALL_FRONT = [['groesse', 'Size'], ['decay', 'Decay'], ['highcut', 'High cut'], ['pre', 'Pre-delay']];

/** The knob controls shown on a card: the `front` list of the panel (params in that order), else the first knob controls in section order. */
export function frontKnoepfe(panel, max = MAX_FRONT) {
  const knoepfe = steuerungen(panel).filter((c) => c.type === 'knob' && typeof c.bind?.param === 'string' && c.bind.param !== '');
  const front = Array.isArray(panel?.front) ? panel.front : null;
  const wahl = front ? front.map((p) => knoepfe.find((c) => c.bind.param === p)).filter(Boolean) : knoepfe;
  return wahl.slice(0, max);
}

/** The letters of the tracks that send into the return (send above -60 dB). */
export function sendeVon(p, returnId) {
  const spuren = p?.spuren ?? [];
  return mixZuege(p).filter((z) => sendWert(spuren.find((s) => s.id === z.id), returnId) > -60).map((z) => z.buchstabe);
}

const anfrage = (g) => {
  const s = geraetSchluessel(g);
  if (s === 'surge') return '/geraete/panel?art=surge';
  if (s === 'rb338') return '/geraete/panel?art=rb338';
  return `/geraete/panel?art=bk&graph=${encodeURIComponent(g.graph)}`;
};
const mk = (tag, klasse, w, text) => {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (w) e.setAttribute('data-w', w);
  if (text !== undefined) e.textContent = text;
  return e;
};
const knopfEl = (klasse, w, text, titel) => { const b = mk('button', klasse, w, text); b.type = 'button'; if (titel) b.title = titel; return b; };
const meter = (kanal) => { const m = mk('div', 'meter senkrecht'); m.setAttribute('data-kanal', kanal); m.append(document.createElement('i')); return m; };
const pegelPos = (db) => posVonDb(db);

export function bindeDock(ctx) {
  const { st, $ } = ctx;
  const host = $('dock');
  host.innerHTML = `<div class="w-dock-zeile"><span class="w-dock-etikett">${DOCK_TEXT.synths}</span><div class="w-dock-karten" data-w="dock-synths"></div></div>`
    + `<div class="w-dock-zeile"><span class="w-dock-etikett">${DOCK_TEXT.fx}</span><div class="w-dock-karten" data-w="dock-fx"></div></div>`;
  const reiheSynth = $('dock-synths'), reiheFx = $('dock-fx');
  const quelle = ctx.panelQuelle ??= neuePanelQuelle(ctx);
  let gen = 0, gebaut = null, frisch = [];
  const geraete = new Map();   // "<track id>|<device key>" -> Promise<{panel, regler, parameter, adapter} | null>
  const strangVon = (id) => straenge(st.projekt).find((s) => s.id === id) ?? null;
  const returnVon = (id) => returnListe(st.projekt).find((r) => r.id === id) ?? null;
  const frischAlle = () => { for (const f of frisch) f(); };

  // ---- the device of an instrument track (panel, ranges, adapter), loaded once per track and device ------------------------------------------------------
  function geraetInfo(spur) {
    const sk = geraetSchluessel(spur.geraet);
    if (!sk) return Promise.resolve(null);
    const key = `${spur.id}|${sk}`;
    if (!geraete.has(key)) {
      geraete.set(key, (async () => {
        const r = await ctx.holeGet(anfrage(spur.geraet));
        const j = r?.j;
        if (r?.status !== 200 || !j) return null;
        let panel = j.panel;
        if (!panel && sk.startsWith('bk:')) { const g = (await quelle.graphen()).find((x) => x.name === spur.geraet.graph); panel = ersatzPanel(spur.geraet.graph, g?.regler_namen, reglerBereiche(j.parameter)); }
        if (!panel) return null;
        const namen = {};
        for (const c of steuerungen(panel)) for (const pn of parameterVon(c)) namen[pn] ??= c.label ?? c.id;
        let tabelle = j.parameter ?? [];
        if (sk === 'surge') tabelle = await surgeIstEinlesen(ctx, spur, tabelle, Object.keys(namen));
        const adapter = spurAdapter(ctx, spur, tabelle, { label: (pn) => namen[pn] ?? pn, melde: (t, f) => { if (t) ctx.melde(t, f); }, beiFertig: () => frischAlle() });
        return { panel, regler: reglerBereiche(j.parameter), parameter: sk.startsWith('bk:') ? undefined : parameterNachName(j.parameter), adapter };
      })().then((x) => { if (!x) geraete.delete(key); return x; }, () => { geraete.delete(key); return null; }));
    }
    return geraete.get(key);
  }
  // front knobs of a panel on a card; `adapter` reads and writes like the full panel
  function panelKnoepfe(ziel, info, adapter, farbe, max, meine) {
    if (meine !== gen) return;
    for (const c of frontKnoepfe(info.panel, max)) {
      const param = c.bind.param;
      const k = neuerDrehknopf({
        w: 'karte-knopf', name: c.label ?? param, titel: c.label ?? param, farbe,
        lies: () => { const v = adapter.get(param); return typeof v === 'number' ? v : vorgabeK(c); },
        setze: (v) => adapter.set(param, v), ende: () => adapter.ende?.(),
        text: (v) => wertText(c, param, v, info.regler, info.parameter), vorgabe: vorgabeK(c),
      });
      k.setAttribute('data-param', param);
      frisch.push(k.frisch); k.frisch(); ziel.append(k);
    }
  }
  function hallKnoepfe(ziel, r, farbe) {
    const q = returnQuelleHall(ctx, r);
    for (const [feld, name] of HALL_FRONT) {
      const k = neuerDrehknopf({
        w: 'karte-knopf', name, titel: `${name} (Hall of ${r.name})`, farbe,
        lies: () => { const v = q.get(feld); return typeof v === 'number' ? v : HALL_NORM_VORGABE[feld]; },
        setze: (v) => { q.set(feld, v); }, text: (v) => hallText(feld, v), vorgabe: HALL_NORM_VORGABE[feld],
      });
      k.setAttribute('data-param', feld);
      frisch.push(k.frisch); k.frisch(); ziel.append(k);
    }
  }
  // the knobs of the first Baukasten stage of a strip (an effect card, the master card)
  function stufenKnoepfe(ziel, strangId, insert, farbe, meine) {
    quelle.panelVon(insert.graph).then((info) => {
      const s = strangVon(strangId);
      if (meine !== gen || !s) return;
      panelKnoepfe(ziel, info, baueInsertAdapter(ctx, { id: s.id, name: s.name }, insert.id), farbe, 4, meine);
    });
  }
  // the LEVEL knob: a fader on the taper of the fader, written like the fader of the strip
  function levelKnopf(titel, lies, schreibe, farbe) {
    const k = neuerDrehknopf({
      w: 'karte-level', name: DOCK_TEXT.level, titel, farbe, lies: () => { const db = lies(); return db === null ? null : pegelPos(db); },
      setze: (pos) => schreibe(sendDb(pos)), text: (pos) => faderText(sendDb(pos)), vorgabe: pegelPos(0),
    });
    frisch.push(k.frisch);
    return k;
  }

  // ---- the stages: chips, the "+" menu, the menu of a chip ---------------------------------------------------------------------------------------------
  async function plusMenue(id, anker) {
    const s = strangVon(id);
    if (!s) return;
    const graphen = await quelle.graphen(true);
    const vorher = new Set(s.inserts.map((i) => i.id)), name = s.name;
    const schreibe = async (label, befehl) => {
      if (!(await ctx.aendere(label, [befehl]))) return;
      const neu = strangVon(id)?.inserts.find((i) => !vorher.has(i.id));
      if (neu) ctx.oeffneStufe?.(id, neu.id); else if (returnVon(id)) ctx.oeffneStufe?.(id, 'hall');
    };
    const punkte = [
      ...(returnVon(id)?.hall?.an === false ? [{ text: 'Hall', aktion: () => schreibe(`Hall on return ${returnVon(id).name}`, { befehl: 'return_aendern', return_id: id, hall: { an: true } }) }] : []),
      ...plusEintraege(st.projekt, id, graphen).map((e) => ({ text: e.text, aus: e.befehl === null, titel: e.grund,
        aktion: () => schreibe(e.befehl.art === 'bk' ? `Add ${e.befehl.graph} to ${name}` : insertLabels(name, s.inserts.length + 1, e.befehl.art).neu, e.befehl) })),
    ];
    const q = anker.getBoundingClientRect();
    (ctx.oeffneMenue ?? oeffneMenue)(punkte, q.left, q.bottom);
  }
  function teilMenue(strangId, insertId, ev) {
    const s = strangVon(strangId), pos = s?.inserts.findIndex((i) => i.id === insertId) ?? -1;
    if (!s || pos < 0) return;
    ev.preventDefault?.();
    const i = s.inserts[pos], ids = s.inserts.map((x) => x.id), L = insertLabels(s.name, pos + 1, i.art), an = i.an !== false;
    const links = verschoben(ids, pos, -1), rechts = verschoben(ids, pos, 1);
    (ctx.oeffneMenue ?? oeffneMenue)([
      { text: an ? 'Bypass' : 'Enable', aktion: () => ctx.aendere(L.an, [anBefehl(i.id, !an)]) },
      { text: 'Move earlier', aus: !links, aktion: () => ctx.aendere(L.links, [ordnungBefehl(s.id, links)]) },
      { text: 'Move later', aus: !rechts, aktion: () => ctx.aendere(L.rechts, [ordnungBefehl(s.id, rechts)]) },
      { text: 'Remove', aktion: () => ctx.aendere(L.weg, [entfernenBefehl(i.id)]) },
    ], ev.clientX ?? 0, ev.clientY ?? 0);
  }
  function teilChip(strangId, t) {
    const b = knopfEl(`w-chip-teil${t.an ? '' : ' aus'}`, 'karte-teil', t.text, DOCK_TEXT.chipTitel);
    b.setAttribute('data-teil', t.teil);
    b.addEventListener('click', (e) => { e.stopPropagation?.(); ctx.oeffneStufe?.(strangId, t.teil); });
    if (t.teil !== 'hall') b.addEventListener('contextmenu', (e) => teilMenue(strangId, t.teil, e));
    return b;
  }
  function plusKnopf(strangId) {
    const b = knopfEl('w-chip-teil w-chip-plus', 'karte-plus', DOCK_TEXT.plus, DOCK_TEXT.plusTitel);
    b.addEventListener('click', (e) => { e.stopPropagation?.(); plusMenue(strangId, b); });
    return b;
  }
  const aufKnopf = (klick, aus = false) => {
    const b = knopfEl('w-karte-auf', 'karte-auf', DOCK_TEXT.auf, DOCK_TEXT.aufTitel);
    b.disabled = aus; b.addEventListener('click', klick);
    return b;
  };

  // ---- the cards ---------------------------------------------------------------------------------------------------------------------------------------
  function synthKarte(z, spur, meine) {
    const e = mk('div', 'w-karte-dock', 'karte-spur');
    e.setAttribute('data-spur-id', z.id); e.style.setProperty('--farbe', z.farbe);
    const kopf = mk('div', 'w-karte-kopf');
    const b = mk('span', 'w-buchstabe', null, z.buchstabe); b.style.background = z.farbe;
    const wechsel = knopfEl('w-karte-knopf', 'karte-wechsel', KLANG_TEXT.wechsel, KLANG_TEXT.wechselTitel);
    wechsel.addEventListener('click', (ev) => { ev.stopPropagation?.(); ctx.instrumentWechsel?.(z.id, wechsel); });
    kopf.append(b, mk('b', 'w-karte-name', null, z.name), mk('span', 'w-karte-geraet', null, geraetText(spur)), mk('span', 'w-sp'),
      ...(spur.inserts ?? []).map((i) => teilChip(z.id, { teil: i.id, ...effektKachel(i) })), plusKnopf(z.id), wechsel, aufKnopf(() => ctx.oeffneGeraet?.(z.id)));
    const knoepfe = mk('div', 'w-karte-knoepfe', 'karte-knoepfe');
    e.append(kopf, knoepfe);
    e.addEventListener('click', () => ctx.waehle(z.id));
    geraetInfo(spur).then((info) => { if (info) panelKnoepfe(knoepfe, info, info.adapter, z.farbe, MAX_FRONT, meine); });
    return e;
  }
  function fxKarte(r, meine) {
    const ret = () => returnVon(r.id);
    const e = mk('div', 'w-karte-dock', 'karte-fx');
    e.setAttribute('data-return-id', r.id); e.style.setProperty('--farbe', r.farbe);
    const teile = rackTeile(r), haupt = teile[0];
    const hauptInsert = haupt && haupt.teil !== 'hall' ? (r.inserts ?? []).find((i) => i.id === haupt.teil) : null;
    const von = mk('span', 'w-chip-teil', 'karte-von'); von.title = DOCK_TEXT.vonTitel;
    const an = knopfEl('w-karte-knopf', 'karte-an', DOCK_TEXT.an, DOCK_TEXT.anTitel);
    an.addEventListener('click', (ev) => { ev.stopPropagation?.(); const x = ret(); if (x) ctx.aendere(`${x.mute ? 'Unmute' : 'Mute'} return ${x.name}`, [{ befehl: 'return_aendern', return_id: r.id, mute: !x.mute }]); });
    const weg = knopfEl('w-karte-knopf', 'karte-weg', DOCK_TEXT.weg, DOCK_TEXT.wegTitel);
    weg.addEventListener('click', async (ev) => {
      ev.stopPropagation?.();
      const x = ret(); if (!x) return;
      if (!(await ctx.frage(MIX_TEXT.weg(x.name)))) return;
      ctx.aendere(`Delete return ${x.name}`, [{ befehl: 'return_loeschen', return_id: r.id }]);
    });
    const kopf = mk('div', 'w-karte-kopf');
    kopf.append(mk('b', 'w-karte-name', null, `FX${r.nr} · ${r.name}`), mk('span', 'w-karte-geraet', null, hauptInsert ? String(hauptInsert.graph ?? hauptInsert.art) : 'hall'), mk('span', 'w-sp'),
      von, ...teile.slice(1).map((t) => teilChip(r.id, t)), plusKnopf(r.id), an, aufKnopf(() => { if (haupt) ctx.oeffneStufe?.(r.id, haupt.teil); }, !haupt), weg);
    const zeile = mk('div', 'w-karte-zeile');
    const knoepfe = mk('div', 'w-karte-knoepfe', 'karte-knoepfe');
    zeile.append(knoepfe, levelKnopf(`Level of ${r.name}`, () => ret()?.fader_db ?? null,
      (db) => { const x = ret(); if (x) ctx.aendere(`Volume return ${x.name}`, [{ befehl: 'return_aendern', return_id: r.id, fader_db: db }], `${r.id}:fader_db`, { wiederhole: true }); }, r.farbe), meter(`ret/${r.nr}`));
    e.append(kopf, zeile);
    if (haupt?.teil === 'hall') hallKnoepfe(knoepfe, r, r.farbe);
    else if (hauptInsert?.art === 'bk') stufenKnoepfe(knoepfe, r.id, hauptInsert, r.farbe, meine);
    frisch.push(() => {
      const x = ret(); if (!x) return;
      const l = sendeVon(st.projekt, r.id);
      von.textContent = l.length ? DOCK_TEXT.von(l) : DOCK_TEXT.keineSends;
      an.setAttribute('aria-pressed', String(x.mute !== true)); an.classList.toggle('an', x.mute !== true);
    });
    return e;
  }
  function masterKarte(meine) {
    const e = mk('div', 'w-karte-dock w-karte-master', 'karte-master');
    e.style.setProperty('--farbe', '#cfd5e3');
    const teile = masterTeile(st.projekt), erstes = (st.projekt?.master?.inserts ?? []).find((i) => i.art === 'bk');
    const kopf = mk('div', 'w-karte-kopf');
    kopf.append(mk('b', 'w-karte-name', null, DOCK_TEXT.master), mk('span', 'w-sp'), ...teile.map((t) => teilChip('master', t)), plusKnopf('master'),
      aufKnopf(() => { if (teile[0]) ctx.oeffneStufe?.('master', teile[0].teil); }, !teile.length));
    const zeile = mk('div', 'w-karte-zeile');
    const knoepfe = mk('div', 'w-karte-knoepfe', 'karte-knoepfe');
    zeile.append(knoepfe, levelKnopf('Master volume', () => (st.projekt ? st.projekt.master?.fader_db ?? 0 : null),
      (db) => ctx.aendere('Volume master', [{ befehl: 'master_aendern', fader_db: db }], 'master:fader', { wiederhole: true }), '#cfd5e3'), meter('pm'));
    e.append(kopf, zeile);
    if (erstes) stufenKnoepfe(knoepfe, 'master', erstes, '#cfd5e3', meine);
    return e;
  }
  const neuKarte = (w, text, titel, klick) => { const b = knopfEl('w-karte-dock w-karte-neu', w, text, titel); b.addEventListener('click', klick); return b; };

  // what decides a rebuild: the tracks with their devices and stages, the returns with their stages, the master stages
  const gestalt = (p) => JSON.stringify([
    mixZuege(p).map((z) => { const s = p.spuren.find((x) => x.id === z.id); return [z, geraetText(s), geraetSchluessel(s.geraet), (s.inserts ?? []).map((i) => [i.id, i.art, i.graph, i.an])]; }),
    returnListe(p).map((r) => [r.id, r.nr, r.name, r.farbe, rackTeile(r)]), masterTeile(p),
  ]);
  function zeichne(erzwingen = false) {
    const p = st.projekt;
    if (!p) return;
    const g = gestalt(p);
    if (erzwingen || g !== gebaut) {
      gebaut = g; frisch = []; gen += 1;
      const meine = gen;
      const spuren = mixZuege(p).map((z) => synthKarte(z, p.spuren.find((s) => s.id === z.id), meine));
      const neu = neuKarte('karte-spur-neu', DOCK_TEXT.neueSpur, DOCK_TEXT.neueSpurTitel, (ev) => { ev.stopPropagation?.(); ctx.spurNeuMenue?.(neu); });
      neu.disabled = (p.spuren ?? []).filter((s) => s.art === 'instrument').length >= MAX_SPUREN_MODUL;
      reiheSynth.replaceChildren(...spuren, neu);
      const laden = neuKarte('fx-laden', MIX_TEXT.neu, 'Load an effect: every track can then send into it', async () => {
        const punkte = fxMenue(st.projekt, await quelle.graphen(true)).map((x) => (x.gruppe ? x : { text: x.text, aus: x.befehl === null, titel: x.grund,
          aktion: () => ctx.aendere(`Add effect ${x.befehl.name}`, [x.befehl]) }));
        const q = laden.getBoundingClientRect();
        (ctx.oeffneMenue ?? oeffneMenue)(punkte, q.left, q.bottom);
      });
      reiheFx.replaceChildren(...returnListe(p).map((r) => fxKarte(r, meine)), laden, masterKarte(meine));
    }
    frischAlle();
    for (const k of reiheSynth.querySelectorAll('[data-w="karte-spur"]')) k.classList.toggle('aktiv', k.getAttribute('data-spur-id') === st.wahl);
  }

  ctx.beimProjekt.push((p, wechsel) => {
    if (wechsel) { geraete.clear(); gebaut = null; }
    if (p) zeichne(); else { reiheSynth.replaceChildren(); reiheFx.replaceChildren(); frisch = []; gebaut = null; gen += 1; }
  });
  ctx.beiWahl.push(() => zeichne());
}
