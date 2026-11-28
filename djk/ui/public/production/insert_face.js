// PRODUCTION: the device faces of the insert stages. The opener (a button on the stage row of the INSERTS panel and a button in the track head), the source object a
// face reads and writes through, and the refresh when the project changes under an open face. A face reads the stage from the project and writes through
// ctx.aendere with the same coalescing key and undo label as the parameter rows of the INSERTS panel: no second path to the project.
import { straenge, ARTEN, KOMP_PARAMETER, SAETT_PARAMETER, LIM_PARAMETER, TRANS_PARAMETER, BILD_PARAMETER, parameterVon, paramBefehl, anBefehl, gemapptVon, makroWert, rackWerte, insGrLesung, insGrLesungArt, insPegelLesung, hatSchluessel } from './inserts.js';
import { hatMod, summeVersatz } from '../mod_display.js';
import { insertModWert } from './mod_line.js';
import { schluesselWert, schluesselLabel } from './key_choice.js';
import { oeffneFace, offenesFace, schliesseFace } from '../face/frame.js';
import { baueKompFace, kompParameterTabelle } from '../face/comp.js';
import { baueSaettFace, saettParameterTabelle } from '../face/sat.js';
import { baueLimiterFace, limParameterTabelle } from '../face/limiter.js';
import { baueEqFace } from '../face/eq.js';
import { baueTransientFace, transParameterTabelle } from '../face/transient.js';
import { baueImagerFace, bildParameterTabelle } from '../face/imager.js';
import { oeffneMenue } from './context_menu.js';
import { oeffneGeraetFenster } from '../device_open.js';
import { stufenBefehle, schluesselMenue } from '../dock/parts.js';

/** The insert kinds that have a face; later faces add their kind name here. */
export const FACE_ARTEN = [
  'komp',
  'saett',
  'lim',
  'eq',
  'trans',
  'bild',
];

const finde = (ctx, strangId, insertId) => {
  const strang = straenge(ctx.st.projekt).find((t) => t.id === strangId);
  const insert = strang?.inserts.find((i) => i.id === insertId) ?? null;
  return { strang, insert };
};

/** strand 6 task 4.4: the `modKnopf(param)` of a face source: the modulated value of a knob (real unit) from the live outputs of the modulators that target
 *  `insert.<stage id>.<param>`, null while they are silent, undefined when none targets it (the knob draws no ring). `liste` = the parameter list of the stage kind,
 *  or a function param -> entry (the EQ has band parameters `b3/freq`, see parameterVon of inserts.js). */
export function insertModKnopf(ctx, strang, insert, liste, jetzt = () => globalThis.performance?.now?.() ?? Date.now()) {
  return (param) => {
    const p = ctx.st.projekt, ziel = `insert.${insert.id}.${param}`;
    if (!hatMod(p, strang.id, ziel)) return undefined;
    const q = typeof liste === 'function' ? liste(param) : liste.find((x) => x.name === param), { insert: i } = finde(ctx, strang.id, insert.id);
    if (!q || !i) return undefined;
    return insertModWert(summeVersatz(p, strang.id, ziel, jetzt()), i.werte?.[param], q);
  };
}

/** The KompQuelle of a compressor stage: values from the stage in the project (a macro-driven parameter gives the macro's value and is blocked), writes through
 *  ctx.aendere with the key `${insert.id}:${param}` and the label of the INSERTS rows. A stage that is gone gets no command. */
export function insertQuelleKomp(ctx, strang, insert, grStand = () => ({}), pegelStand = () => ({})) {
  const jetzt = () => finde(ctx, strang.id, insert.id);
  const name = ARTEN.komp.name;
  return {
    parameter: kompParameterTabelle(KOMP_PARAMETER),
    knie: 'regler',
    get(param) {
      const { strang: s, insert: i } = jetzt();
      if (!s || !i) return undefined;
      const nr = gemapptVon(s, i.id, param);
      if (nr !== null) { const z = s.rack.makros[nr - 1].ziel.find((y) => y.insert === i.id && y.param === param); return makroWert(z, rackWerte(s)[nr - 1]); }
      return typeof i.werte?.[param] === 'number' ? i.werte[param] : undefined;
    },
    gesperrt(param) { const { strang: s, insert: i } = jetzt(); return !!s && !!i && gemapptVon(s, i.id, param) !== null; },
    modKnopf: insertModKnopf(ctx, strang, insert, KOMP_PARAMETER),
    set(param, v) {
      const { insert: i } = jetzt();
      if (!i) return;   // the stage was removed under the open face: nothing goes out
      const q = KOMP_PARAMETER.find((x) => x.name === param);
      ctx.aendere(`${q?.label ?? param} ${name} on ${strang.name}`, [paramBefehl(i.id, param, v)], `${i.id}:${param}`);
    },
    an: {
      get: () => jetzt().insert?.an !== false,
      set: (b) => { const { insert: i } = jetzt(); if (i) ctx.aendere(`${b ? 'Enable' : 'Bypass'} ${name} on ${strang.name}`, [anBefehl(i.id, b)]); },
    },
    // the key chip: the stage's source as the INSERTS list names it
    schluessel: { text: () => { const { insert: i } = jetzt(); return i ? `KEY: ${schluesselLabel(schluesselWert(i), ctx.st.projekt)}` : ''; } },
    // the gain reduction the INSERTS row shows (the same store, the same 500 ms rule)
    gr: (zeit) => { const { insert: i } = jetzt(); return i ? insGrLesung(grStand(), i.slot, zeit) : null; },
    // T9: the input and output peak of the stage ({ein, aus} in dBFS), the same store and 500 ms rule
    pegel: (zeit) => { const { insert: i } = jetzt(); return i ? insPegelLesung(pegelStand(), `ins/komp/${i.slot}`, zeit) : null; },
  };
}

/** The faces of the stages whose face is a curve or strip plus a plain knob plate (no key): per kind the title, accent, parameter list and builder. */
const faceGeraet = (art) => ({   // a function, not a constant: inserts.js imports this file, the parameter lists are not initialised yet at load time
  saett: { titel: 'SATURATOR', akzent: 'rot', liste: SAETT_PARAMETER, tabelle: saettParameterTabelle, bauen: baueSaettFace },
  lim: { titel: 'LIMITER', akzent: 'tuerkis', liste: LIM_PARAMETER, tabelle: limParameterTabelle, bauen: baueLimiterFace },
  trans: { titel: 'TRANSIENT SHAPER', akzent: 'gruen', liste: TRANS_PARAMETER, tabelle: transParameterTabelle, bauen: baueTransientFace },
  bild: { titel: 'IMAGER', akzent: 'tuerkis', liste: BILD_PARAMETER, tabelle: bildParameterTabelle, bauen: baueImagerFace },
})[art];

/** The source object of such a stage: values from the stage in the project (a macro-driven parameter gives the macro's value and is blocked), writes through
 *  ctx.aendere with the key `${insert.id}:${param}` and the label of the INSERTS rows; a write resolves true when accepted. A stage that is gone gets no command. */
export function insertQuelleGeraet(ctx, strang, insert, liste, tabelle, grStand = () => ({}), pegelStand = () => ({})) {
  const jetzt = () => finde(ctx, strang.id, insert.id);
  const name = ARTEN[insert.art].name;
  return {
    // T8: the limiter's gain reduction (/e/ins_gr `ins/lim/<n>`, the same store and 500 ms rule as the compressor's); the other kinds have none
    ...(insert.art === 'saett' ? {   // strand 5: the clip amount of the stage (/e/ins_gr `ins/saett/<n>`: how far it goes over its ceiling), same store and 500 ms rule
      gr: (zeit) => { const { insert: i } = jetzt(); return i ? insGrLesungArt(grStand(), 'saett', i.slot, zeit) : null; },
    } : {}),
    ...(insert.art === 'trans' ? {   // strand 5 slice 3: the largest gain change of the shaper (/e/ins_gr `ins/trans/<n>`), same store and 500 ms rule
      gr: (zeit) => { const { insert: i } = jetzt(); return i ? insGrLesungArt(grStand(), 'trans', i.slot, zeit) : null; },
    } : {}),
    ...(insert.art === 'lim' ? {
      gr: (zeit) => { const { insert: i } = jetzt(); return i ? insGrLesungArt(grStand(), 'lim', i.slot, zeit) : null; },
      pegel: (zeit) => { const { insert: i } = jetzt(); return i ? insPegelLesung(pegelStand(), `ins/lim/${i.slot}`, zeit) : null; },   // T9
    } : {}),
    parameter: tabelle(liste),
    get(param) {
      const { strang: s, insert: i } = jetzt();
      if (!s || !i) return undefined;
      const nr = gemapptVon(s, i.id, param);
      if (nr !== null) { const z = s.rack.makros[nr - 1].ziel.find((y) => y.insert === i.id && y.param === param); return makroWert(z, rackWerte(s)[nr - 1]); }
      return typeof i.werte?.[param] === 'number' ? i.werte[param] : undefined;
    },
    gesperrt(param) { const { strang: s, insert: i } = jetzt(); return !!s && !!i && gemapptVon(s, i.id, param) !== null; },
    modKnopf: insertModKnopf(ctx, strang, insert, liste),
    set(param, v) {
      const { insert: i } = jetzt();
      if (!i) return undefined;   // the stage was removed under the open face: nothing goes out
      const q = liste.find((x) => x.name === param);
      return ctx.aendere(`${q?.label ?? param} ${name} on ${strang.name}`, [paramBefehl(i.id, param, v)], `${i.id}:${param}`);
    },
    an: {
      get: () => jetzt().insert?.an !== false,
      set: (b) => { const { insert: i } = jetzt(); if (i) ctx.aendere(`${b ? 'Enable' : 'Bypass'} ${name} on ${strang.name}`, [anBefehl(i.id, b)]); },
    },
  };
}

/** The source of an EQ stage: the same reading and writing rules as the compressor's (a macro-driven parameter gives the macro's value and is blocked; writes carry the
 *  key `${insert.id}:${param}` and the label of the INSERTS rows). griff(m, werte, einschalten) is one handle move: ONE batch of the same insert_param_setzen
 *  commands (plus the band's switch when the band was off), key `${insert.id}:b${m}:griff`, label `Band ${m} EQ on ${strip}`; it returns the writer's promise
 *  (true: accepted). A stage that is gone gets no command. */
export function insertQuelleEq(ctx, strang, insert, stand = { band: 1 }, grStand = () => ({})) {
  const jetzt = () => finde(ctx, strang.id, insert.id);
  const name = ARTEN.eq.name;
  const wertVon = (param) => {
    const { strang: s, insert: i } = jetzt();
    if (!s || !i) return undefined;
    const nr = gemapptVon(s, i.id, param);
    if (nr !== null) { const z = s.rack.makros[nr - 1].ziel.find((y) => y.insert === i.id && y.param === param); return makroWert(z, rackWerte(s)[nr - 1]); }
    return typeof i.werte?.[param] === 'number' ? i.werte[param] : undefined;
  };
  return {
    get: wertVon,
    gr: (zeit) => { const { insert: i } = jetzt(); return i ? insGrLesungArt(grStand(), 'eq', i.slot, zeit) : null; },   // strand 5: the deepest dynamic change of the stage (/e/ins_gr `ins/eq/<n>`), same store and 500 ms rule
    gesperrt(param) { const { strang: s, insert: i } = jetzt(); return !!s && !!i && gemapptVon(s, i.id, param) !== null; },
    modKnopf: insertModKnopf(ctx, strang, insert, (param) => parameterVon('eq', param)),   // strand 6: the ring of a modulated EQ knob
    set(param, v) {
      const { insert: i } = jetzt();
      if (!i) return Promise.resolve(false);   // the stage was removed under the open face: nothing goes out
      const q = parameterVon('eq', param), m = /^b([1-8])\//.exec(param);
      return ctx.aendere(`${m ? `Band ${m[1]} ` : ''}${q?.label ?? param} ${name} on ${strang.name}`, [paramBefehl(i.id, param, v)], `${i.id}:${param}`);
    },
    griff(m, werte, einschalten) {
      const { insert: i } = jetzt();
      if (!i) return Promise.resolve(false);
      const batch = [...(einschalten ? [paramBefehl(i.id, `b${m}/an`, 1)] : []), ...Object.entries(werte).map(([param, v]) => paramBefehl(i.id, param, v))];
      return ctx.aendere(`Band ${m} ${name} on ${strang.name}`, batch, `${i.id}:b${m}:griff`);
    },
    schluessel: () => hatSchluessel(jetzt().insert),
    waehleBand(m) { stand.band = m; },
    band: () => stand.band,
    an: {
      get: () => jetzt().insert?.an !== false,
      set: (b) => { const { insert: i } = jetzt(); if (i) ctx.aendere(`${b ? 'Enable' : 'Bypass'} ${name} on ${strang.name}`, [anBefehl(i.id, b)]); },
    },
  };
}

/** The title bar buttons of a face (task 12): ◀ Move earlier, ▶ Move later, ✕ Remove (closes the face) and for a compressor or an EQ KEY (the key source menu at the button).
 *  The commands and labels are the chip menu's (stufenBefehle, schluesselMenue of dock/parts.js). */
function kopfKnoepfe(ctx, steuer, strangId, insertId, schliesse) {
  const d = steuer.ownerDocument ?? globalThis.document;
  const knopf = (text, titel, fn) => {
    const b = d.createElement('button'); b.type = 'button'; b.className = 'p-face-knopf'; b.textContent = text; b.title = titel; b.setAttribute('aria-label', titel);
    b.addEventListener('click', fn); return b;
  };
  const jetzt = () => finde(ctx, strangId, insertId);
  const tu = (wahl) => { const { strang, insert } = jetzt(); if (!strang || !insert) return null; const x = stufenBefehle(strang, insert)[wahl]; return x ? ctx.aendere(x.label, x.befehle) : null; };
  const knoepfe = [
    knopf('◀', 'Move earlier', () => tu('links')),
    knopf('▶', 'Move later', () => tu('rechts')),
    knopf('✕', 'Remove this stage', () => { Promise.resolve(tu('weg')).then((ok) => { if (ok !== false && ok !== null) schliesse(); }); }),
  ];
  const { insert } = jetzt();
  if (insert?.art === 'komp' || insert?.art === 'eq') {
    knoepfe.unshift(knopf('KEY', insert.art === 'eq' ? 'Key source of this EQ (for its dynamic bands)' : 'Key source of this compressor', (ev) => {
      const { strang, insert: i } = jetzt(); if (!strang || !i) return;
      const q = ev.currentTarget.getBoundingClientRect();
      schluesselMenue({ holeGet: (w) => ctx.holeGet(w), aendere: (...a) => ctx.aendere(...a), melde: (...a) => ctx.melde(...a), fehlerText: ctx.fehlerText,
        oeffneMenue: (...a) => (ctx.oeffneMenue ?? oeffneMenue)(...a), projekt: () => ctx.st.projekt }, strang, i, q.left, q.bottom);
    }));
  }
  if (ctx.dockHost?.schalter?.stufenFenster && !ctx.faceEinbettung) knoepfe.push(knopf('WINDOW ↗', 'Open this stage in its own window', () => oeffneGeraetFenster(`ins:${insertId}`, (...a) => ctx.melde(...a))));
  steuer.prepend(...knoepfe);
}

/** Registers the project listener and the two hooks of the track head. ctx.faceEinbettung (an element, set by a stage window) draws the face into it instead of the floating overlay. oeffne(strang, insert) opens (or closes) the face of a stage, verfuegbar(art) says whether
 *  a kind has one. grStand() is the store of /e/ins_gr readings of the INSERTS panel. */
export function bindeInsertFace(ctx, grStand, pegelStand = () => ({})) {
  let aktuell = null;   // {strangId, insertId} of the open face
  const oeffne = (strang, insert) => {
    if (!FACE_ARTEN.includes(insert.art)) return null;
    if (insert.art === 'eq') return oeffneEq(strang, insert);
    const geraet = faceGeraet(insert.art);
    const quelle = geraet ? insertQuelleGeraet(ctx, strang, insert, geraet.liste, geraet.tabelle, grStand, pegelStand) : insertQuelleKomp(ctx, strang, insert, grStand, pegelStand);
    const pos = strang.inserts.findIndex((i) => i.id === insert.id);
    let bau = null;
    const f = oeffneFace({
      id: `face:${insert.id}`, titel: geraet?.titel ?? 'COMPRESSOR', untertitel: `${strang.name} · stage ${pos + 1}`, akzent: geraet?.akzent ?? 'orange', an: quelle.an, einbetten: ctx.faceEinbettung ?? null,
      bauen: (inhalt, steuer) => { kopfKnoepfe(ctx, steuer, strang.id, insert.id, () => schliesseFace()); bau = geraet ? geraet.bauen(inhalt, quelle) : baueKompFace(inhalt, quelle); return bau; },
      live: geraet && !['lim', 'saett', 'trans'].includes(insert.art) ? undefined : (zeit) => bau?.live(zeit) ?? false,   // the frame loop runs while this face is open and nowhere else; a face without a live value has none
    });
    aktuell = f ? { strangId: strang.id, insertId: insert.id, face: f } : null;
    return f;
  };
  const oeffneEq = (strang, insert) => {
    let bau = null;
    const quelle = insertQuelleEq(ctx, strang, insert, { band: 1 }, grStand);
    const pos = strang.inserts.findIndex((i) => i.id === insert.id);
    const f = oeffneFace({
      id: `face:${insert.id}`, titel: 'EQ', untertitel: `${strang.name} · stage ${pos + 1}`, akzent: 'orange', an: quelle.an, einbetten: ctx.faceEinbettung ?? null,
      bauen: (inhalt, steuer) => { kopfKnoepfe(ctx, steuer, strang.id, insert.id, () => schliesseFace()); bau = baueEqFace(inhalt, quelle); return bau; },
      live: (zeit) => bau?.live(zeit) ?? false,   // the frame loop runs while this face is open: the dynamic readout
    });
    aktuell = f ? { strangId: strang.id, insertId: insert.id, face: f } : null;
    return f;
  };
  // the project changed under an open face: it follows, and it closes when its stage or strip is gone
  ctx.beimProjekt.push((p) => {
    const o = offenesFace();
    if (!o || !aktuell || o.id !== `face:${aktuell.insertId}`) return;
    const { insert } = p ? finde(ctx, aktuell.strangId, aktuell.insertId) : { insert: null };
    if (!insert) { schliesseFace(); aktuell = null; return; }
    aktuell.face.aktualisiere();
  });
  ctx.faceVerfuegbar = (spur) => (spur?.inserts ?? []).some((i) => FACE_ARTEN.includes(i.art));
  ctx.faceOeffnen = (spurId, x, y) => {
    const strang = straenge(ctx.st.projekt).find((t) => t.id === spurId);
    const dienend = (strang?.inserts ?? []).filter((i) => FACE_ARTEN.includes(i.art));
    if (!dienend.length) return;
    if (dienend.length === 1) { oeffne(strang, dienend[0]); return; }
    oeffneMenue(dienend.map((i) => ({ text: `Stage ${strang.inserts.indexOf(i) + 1} ${ARTEN[i.art].name}`, aktion: () => oeffne(strang, i) })), x, y);
  };
  return { oeffne, verfuegbar: (art) => FACE_ARTEN.includes(art) };
}
