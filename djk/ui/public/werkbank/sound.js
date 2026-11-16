// Workbench region SOUND (plan task 4; task 8 adds the effect tiles): header SOUND + track name, the tile row (INSTRUMENT first) and the device area
// below it. The INSTRUMENT tile shows the wide front panel of the selected track (bindeGeraetAnsicht with breit: true), refreshed on every project
// change and on every selection. A track without a panel view (kit, plug-in host, rack) shows a text.
//
// Markup: h3[data-w="klang-titel"]; div[data-w="kacheln"] with button[data-w="kachel"][data-kachel=<id>] per tile (the INSTRUMENT tile also has
// data-w="kachel-instrument") and span[data-w="kacheln-ende"] as the empty end slot (task 8: the "+" tile); div[data-w="geraet"] with
// div[data-w="geraet-instrument"] (the panel of the instrument) and div[data-w="geraet-weiter"] (host of another tile's panel, shown while another
// tile is selected).
// Extension points on ctx.klang (task 8 uses them, nothing else in this file needs to change):
//   kachel: id of the selected tile ('instrument' by default; reset to it when the track changes)
//   quellen: [fn(spur) -> [{id, titel, text}]] tiles after INSTRUMENT, in the order of the sources
//   beiKachel: [fn(id, weiterHost)] called when a tile was selected; weiterHost is the (emptied) host for a tile that shows its panel below
//   waehle(id), zeichne(): select a tile / redraw the tile row (call zeichne() when a source's list changed)
//   beiZeichnen: [fn(spur, ende)] called after every redraw of the tile row; ende is the end slot (the "+" tile lives there)
// A source entry may carry `klassen` (extra CSS classes of its tile). beiKachel also runs for a click on INSTRUMENT (id 'instrument').
// Task 8 (the insert chain of the selected track) is the second half of this file: bindeKette.
import { bindeGeraetAnsicht } from '../production/device_view.js';
import { geraetText, wechselBefehle } from '../seq_field.js';
import { instrumentMenue } from './tracks.js';
import { oeffneMenue } from '../production/context_menu.js';
import { baueFrontplatte } from '../panel.js';
import {
  ARTEN, MAX_PLAETZE, straenge, neuerInsertBefehl, anBefehl, entfernenBefehl, ordnungBefehl, verschoben, bkZahl, baueInsertAdapter, insGrAufnehmen, insPegelAufnehmen, insertLabels,
} from '../production/inserts.js';
import { bindeInsertFace, FACE_ARTEN } from '../production/insert_face.js';

export const KLANG_TEXT = { titel: 'SOUND', instrument: 'INSTRUMENT', keinPanel: 'This instrument has no front panel in the workbench.', wechsel: '\u21c4 CHANGE', wechselTitel: 'Change the instrument of this track; the notes stay' };

export function bindeKlang(ctx) {
  const { st, $ } = ctx;
  const host = $('klang');
  host.innerHTML = `<h3 class="w-titel" data-w="klang-titel"></h3>
<div class="w-kacheln" data-w="kacheln"></div>
<div class="w-effekt-leiste" data-w="effekt-leiste" hidden></div>
<div class="w-geraet" data-w="geraet"><div class="w-geraet-instrument" data-w="geraet-instrument"></div><div class="w-geraet-weiter" data-w="geraet-weiter" hidden></div></div>`;
  const titel = $('klang-titel'), leiste = $('kacheln'), instrumentHost = $('geraet-instrument'), weiterHost = $('geraet-weiter');
  const ansicht = bindeGeraetAnsicht(ctx, instrumentHost, { breit: true });
  const klang = ctx.klang = { kachel: 'instrument', quellen: [], beiKachel: [], beiZeichnen: [], waehle: (id) => waehle(id), zeichne: () => zeichneKacheln() };
  let spurId = null;
  const spurJetzt = () => (st.projekt?.spuren ?? []).find((s) => s.id === st.wahl && s.art === 'instrument') ?? null;

  function kachel(id, t, text, klassen = []) {
    const b = document.createElement('button');
    b.className = 'w-kachel'; b.setAttribute('data-w', 'kachel'); b.setAttribute('data-kachel', id);
    const a = document.createElement('span'); a.className = 'w-kachel-t'; a.textContent = t;
    const v = document.createElement('span'); v.className = 'w-kachel-v'; v.textContent = text;
    b.append(a, v);
    b.classList.toggle('aktiv', klang.kachel === id);
    for (const k of klassen) b.classList.add(k);
    b.addEventListener('click', () => waehle(id));
    return b;
  }
  function zeichneKacheln() {
    const spur = spurJetzt();
    titel.textContent = spur ? `${KLANG_TEXT.titel} · ${spur.name}` : KLANG_TEXT.titel;
    const teile = [];
    if (spur) {
      const i = kachel('instrument', KLANG_TEXT.instrument, geraetText(spur));
      i.setAttribute('data-w', 'kachel-instrument');
      teile.push(i);
      const wb = document.createElement('button');
      wb.type = 'button'; wb.className = 'w-kachel w-kachel-wechsel'; wb.setAttribute('data-w', 'instrument-wechsel');
      wb.textContent = KLANG_TEXT.wechsel; wb.title = KLANG_TEXT.wechselTitel;
      wb.addEventListener('click', () => wechselMenue(wb));
      teile.push(wb);
      for (const q of klang.quellen) for (const k of q(spur) ?? []) teile.push(kachel(k.id, k.titel, k.text, k.klassen));
    }
    const ende = document.createElement('span'); ende.setAttribute('data-w', 'kacheln-ende');
    leiste.replaceChildren(...teile, ende);
    instrumentHost.hidden = klang.kachel !== 'instrument';
    weiterHost.hidden = klang.kachel === 'instrument';
    for (const h of klang.beiZeichnen) h(spur, ende);
  }
  // Instrument exchange (the SEQ deck's wechselBefehle): the notes of the pattern clip stay; knob lanes the new device does not have go after a question.
  async function wechselMenue(knopf) {
    const spur = spurJetzt(); if (!spur) return;
    const r = knopf.getBoundingClientRect();
    const [g, kits] = await Promise.all([ctx.holeGet('/graphen'), ctx.holeGet('/proj/kits')]);
    const alt = spur.geraet;
    const punkte = instrumentMenue(g?.j?.graphen, kits?.j?.kits, alt?.art === 'intern' && alt.name === 'bk' ? alt.graph : undefined, (e) => tausche(spur.id, e));
    (ctx.oeffneMenue ?? oeffneMenue)(punkte, r.left, r.bottom);
  }
  async function tausche(id, eintrag) {
    const spur = (st.projekt?.spuren ?? []).find((s) => s.id === id); if (!spur) return;
    const clip = (spur.clips ?? []).find((c) => c.art === 'midi') ?? null;
    const w = wechselBefehle(spur, clip, eintrag.geraet, ctx.info?.(spur) ?? null);
    if (w.meldung) { ctx.melde(w.meldung, true); return; }
    if (!w.befehle.length) return;
    if (w.frage && !(await ctx.frage(w.frage))) return;
    await ctx.aendere(`Instrument ${spur.name}: ${eintrag.text}`, w.befehle);
  }
  function waehle(id) {
    klang.kachel = id;
    zeichneKacheln();
    if (id !== 'instrument') weiterHost.replaceChildren();
    for (const h of klang.beiKachel) h(id, weiterHost);
  }
  function zeige() {
    const spur = spurJetzt();
    if (spur?.id !== spurId) { spurId = spur?.id ?? null; klang.kachel = 'instrument'; weiterHost.replaceChildren(); }
    zeichneKacheln();
    if (ansicht.zeige(spur)) return;
    if (spur) { const p = document.createElement('p'); p.textContent = KLANG_TEXT.keinPanel; instrumentHost.replaceChildren(p); }
  }
  bindeKette(ctx, klang, $('effekt-leiste'), weiterHost, spurJetzt);
  ctx.beimProjekt.push(() => zeige());
  ctx.beiWahl.push(() => zeige());
  zeige();
}

// ---- the insert chain (task 8) -------------------------------------------------------------------------------------------------------------------

/** The panel of a Baukasten effect that has no sidecar: sections of eight knobs (`KNOBS 1–8`, `KNOBS 9–16`, ...), bkZahl(reglerNamen) knobs, param k<n>. */
export function ersatzPanel(graph, reglerNamen, regler) {
  const n = bkZahl(reglerNamen), sections = [];
  for (let a = 1; a <= n; a += 8) {
    const b = Math.min(a + 7, n), controls = [];
    for (let k = a; k <= b; k++) {
      const v = regler?.[k]?.vorgabe;
      controls.push({ id: `k${k}`, type: 'knob', label: String(reglerNamen?.[k] || `K${k}`).slice(0, 24), bind: { param: `k${k}` }, default: typeof v === 'number' ? v : 0.5 });
    }
    sections.push({ id: `s${sections.length + 1}`, title: `KNOBS ${a}–${b}`, cols: Math.min(4, controls.length), controls });
  }
  return { format: 'cypherdj-panel/2', geraet: { art: 'bk', graph }, title: graph, akzent: 'orange', sections };
}

const KACHEL_TEXT = { komp: 'COMPRESSOR', eq: 'EQ', saett: 'SATURATION', lim: 'LIMITER', utility: 'UTILITY' };
/** The tile of one insert stage: { titel: 'EFFECT', text, an }. */
export function effektKachel(insert) {
  const text = insert.art === 'bk' ? String(insert.graph ?? 'EFFECT') : insert.art === 'host' ? String(insert.plugin?.name ?? 'PLUGIN') : KACHEL_TEXT[insert.art] ?? String(insert.art).toUpperCase();
  return { titel: 'EFFECT', text, an: insert.an !== false };
}

const PLUS_ARTEN = [['komp', 'Compressor'], ['eq', 'EQ'], ['saett', 'Saturator'], ['lim', 'Limiter']];
export const PLUS_VOLL_TEXT = `The strip holds ${MAX_PLAETZE} stages`;
/** The entries of the "+" menu: [{text, befehl | null, grund?}]; befehl is null (with the reason) when the strip is full or the pool of that kind is empty. */
export function plusEintraege(p, strangId, graphen) {
  const strang = straenge(p).find((s) => s.id === strangId);
  const voll = !strang || strang.inserts.length >= MAX_PLAETZE;
  const eintrag = (text, art, graph) => {
    const b = voll ? null : neuerInsertBefehl(p, strangId, art);
    if (!b) return { text, befehl: null, grund: voll ? PLUS_VOLL_TEXT : ARTEN[art].voll };
    return { text, befehl: art === 'bk' ? { ...b, graph } : b };
  };
  return [
    ...PLUS_ARTEN.map(([art, text]) => eintrag(text, art)),
    ...(graphen ?? []).filter((g) => g?.art === 'effekt' && typeof g.name === 'string').map((g) => eintrag(g.name, 'bk', g.name)),
  ];
}

const FX = 'fx:';
function bindeKette(ctx, klang, leiste, weiterHost, spurJetzt) {
  const { st } = ctx;
  const gr = {}, pegel = {};   // the readings of /e/ins_gr and /e/stufe_pegel, read by an open device face
  const faces = bindeInsertFace(ctx, () => gr, () => pegel);
  ctx.beimEreignis.push((a, f) => {
    if (a === '/e/ins_gr') insGrAufnehmen(gr, f, performance.now());
    else if (a === '/e/stufe_pegel') insPegelAufnehmen(pegel, f, performance.now());
  });
  let wahl = null;       // insert id of the selected EFFECT tile (its controls show in the strip below the tiles)
  let gezeigt = 'instrument';   // what the device area shows: 'instrument' or the id of a Baukasten stage tile
  let plusOffen = false, graphen = null, panel = null;
  const panelCache = new Map();   // graph -> {panel, regler} | null

  const strangVon = (spur) => (spur ? straenge(st.projekt).find((s) => s.id === spur.id) ?? null : null);
  const finde = (spur, id) => { const s = strangVon(spur); const i = s?.inserts.find((x) => FX + x.id === id) ?? null; return i ? { strang: s, insert: i, pos: s.inserts.indexOf(i) } : null; };
  async function graphenHolen() {
    if (graphen) return graphen;
    const r = await ctx.holeGet('/graphen');
    const l = r.status === 200 && Array.isArray(r.j?.graphen) ? r.j.graphen.filter((g) => g && typeof g.name === 'string') : [];
    if (r.status === 200) graphen = l;
    return l;
  }
  async function panelVon(graph) {
    if (panelCache.has(graph)) return panelCache.get(graph);
    const r = await ctx.holeGet(`/graphen/panel?name=${encodeURIComponent(graph)}`);
    const regler = r.j?.regler ?? {};
    let aus = r.status === 200 && r.j?.panel ? { panel: r.j.panel, regler } : null;
    if (!aus) { const g = (await graphenHolen()).find((x) => x.name === graph); aus = { panel: ersatzPanel(graph, g?.regler_namen, regler), regler }; }
    if (r.status === 200) panelCache.set(graph, aus);
    return aus;
  }
  async function zeigeBk(id) {
    const x = finde(spurJetzt(), id);
    if (!x || x.insert.art !== 'bk') return;
    const info = await panelVon(x.insert.graph);
    if (klang.kachel !== id || !finde(spurJetzt(), id)) return;   // another tile was chosen meanwhile
    weiterHost.replaceChildren();
    panel = baueFrontplatte(weiterHost, { panel: info.panel, regler: info.regler, adapter: baueInsertAdapter(ctx, { id: x.strang.id, name: x.strang.name }, x.insert.id) });
  }
  const zurueck = () => { klang.kachel = gezeigt; if (gezeigt !== 'instrument') zeigeBk(gezeigt); };

  klang.quellen.push((spur) => {
    const s = strangVon(spur);
    const ids = (s?.inserts ?? []).map((i) => FX + i.id);
    if (wahl && !ids.includes(FX + wahl)) wahl = null;
    if (klang.kachel.startsWith(FX) && !ids.includes(klang.kachel)) { klang.kachel = 'instrument'; panel = null; weiterHost.replaceChildren(); }   // the stage went away elsewhere
    return (s?.inserts ?? []).map((i) => {
      const k = effektKachel(i);
      return { id: FX + i.id, titel: k.titel, text: k.text, klassen: [...(wahl === i.id ? ['gewaehlt'] : []), ...(k.an ? [] : ['aus'])] };
    });
  });
  klang.beiKachel.push((id) => {
    if (id === 'instrument') { wahl = null; gezeigt = 'instrument'; panel = null; weiterHost.replaceChildren(); klang.zeichne(); return; }
    const x = finde(spurJetzt(), id);
    if (!x) return;
    wahl = x.insert.id;
    if (x.insert.art === 'bk') { gezeigt = id; zeigeBk(id); }
    else { if (FACE_ARTEN.includes(x.insert.art)) faces.oeffne(x.strang, x.insert); zurueck(); }   // a face floats: the device area stays as it was
    klang.zeichne();
  });
  ctx.beimProjekt.push(() => panel?.aktualisiere?.());

  async function schreibe(spur, label, befehle) {
    const vorher = new Set((strangVon(spur)?.inserts ?? []).map((i) => i.id));
    const ok = await ctx.aendere(label, befehle);
    return { ok, vorher };
  }
  function zeichneLeiste(spur) {
    const x = wahl ? finde(spur, FX + wahl) : null;
    leiste.hidden = !x;
    if (!x) { leiste.replaceChildren(); return; }
    const { strang, insert, pos } = x, ids = strang.inserts.map((i) => i.id);
    const name = (ARTEN[insert.art]?.name ?? 'stage'), L = insertLabels(strang.name, pos + 1, insert.art);
    const knopf = (w, text, titel, klick, aus = false) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'w-effekt-knopf'; b.setAttribute('data-w', w); b.textContent = text; b.title = titel; b.disabled = aus;
      b.addEventListener('click', klick);
      return b;
    };
    const links = verschoben(ids, pos, -1), rechts = verschoben(ids, pos, 1), an = insert.an !== false;
    const bewege = (neu, label) => { if (neu) ctx.aendere(label, [ordnungBefehl(strang.id, neu)]); };
    const aus = knopf('fx-an', an ? 'ON' : 'OFF', `${an ? 'Bypass' : 'Enable'} the ${name}`, () => ctx.aendere(`${an ? 'Bypass' : 'Enable'} ${name} ${pos + 1} on ${strang.name}`, [anBefehl(insert.id, !an)]));
    aus.setAttribute('aria-pressed', String(an));
    leiste.replaceChildren(
      knopf('fx-links', '◀', 'Move earlier in the chain', () => bewege(links, L.links), !links),
      knopf('fx-rechts', '▶', 'Move later in the chain', () => bewege(rechts, L.rechts), !rechts),
      aus,
      knopf('fx-weg', '✕', `Remove the ${name} (Undo brings it back)`, () => ctx.aendere(L.weg, [entfernenBefehl(insert.id)])),
    );
  }
  async function waehleNeu(spur, vorher) {
    const s = strangVon(spur);
    const neu = (s?.inserts ?? []).find((i) => !vorher.has(i.id));
    if (!neu) return;
    if (neu.art === 'bk') klang.waehle(FX + neu.id);
    else { wahl = neu.id; klang.zeichne(); }
  }
  function zeichnePlus(spur, ende) {
    ende.className = 'w-plus-wrap';
    if (!spur) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'w-kachel w-plus'; b.setAttribute('data-w', 'plus'); b.textContent = '+'; b.title = 'Add an effect to this track';
    b.setAttribute('aria-expanded', String(plusOffen));
    b.addEventListener('click', async () => { plusOffen = !plusOffen; if (plusOffen) await graphenHolen(); klang.zeichne(); });
    ende.replaceChildren(b);
    if (!plusOffen) return;
    const menue = document.createElement('div');
    menue.className = 'w-plus-menue'; menue.setAttribute('data-w', 'plus-menue');
    for (const e of plusEintraege(st.projekt, spur.id, graphen)) {
      const m = document.createElement('button');
      m.type = 'button'; m.className = 'w-plus-eintrag'; m.setAttribute('data-w', 'plus-eintrag'); m.textContent = e.text; m.disabled = e.befehl === null;
      if (e.grund) m.title = e.grund;
      m.addEventListener('click', async () => {
        if (!e.befehl) return;
        plusOffen = false;
        const strang = strangVon(spur);
        const label = e.befehl.art === 'bk' ? `Add ${e.befehl.graph} to ${strang.name}` : insertLabels(strang.name, strang.inserts.length + 1, e.befehl.art).neu;
        const { ok, vorher } = await schreibe(spur, label, [e.befehl]);
        if (ok) await waehleNeu(spur, vorher); else klang.zeichne();
      });
      menue.append(m);
    }
    ende.append(menue);
  }
  klang.beiZeichnen.push((spur, ende) => {
    if (klang.kachel === 'instrument') gezeigt = 'instrument';
    if (klang.kachel === 'instrument' && weiterHost.children.length) { panel = null; weiterHost.replaceChildren(); }
    zeichneLeiste(spur);
    zeichnePlus(spur, ende);
  });
}
