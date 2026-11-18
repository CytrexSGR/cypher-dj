// Workbench SOUND region, sampler A1 task 8 and A2 task 4: the cut strip. It is shown while the selected track's instrument is a sampler cut (info.schnitt, task 6):
// the waveform of the cut audio (GET /welle?schnitt=), a numbered slice per boundary (index + 1, D7), click to hear (POST /sampler/hoeren),
// a selection of slices, FIT (POST /sampler/fit) and the buttons that later plans attach. A2 adds the edit of the cut itself: method, count and
// sensitivity with CUT AGAIN (POST /sampler/neu_schneiden), WRITE ORIGINAL ORDER (POST /sampler/ursprung), and the markers (POST /sampler/marke):
// a handle per interior bound is dragged to move it, a double click on a handle removes it, a double click on a slice adds one.
//
// Markup: div[data-w="schnitt"] (the host, hidden unless the track has a cut) holding a head and the field.
//   Head: span[data-w="schnitt-titel"]; span[data-w="schnitt-steuer"] with select[data-w="schnitt-methode"] (GRID, HITS, and HAND shown disabled while the cut
//   is a hand cut), select[data-w="schnitt-zahl"] (GRID only), input[data-w="schnitt-empf"] range 0..1 (HITS only), button[data-w="schnitt-neu"] CUT AGAIN
//   (CONFIRM for 3 s after the first click on a hand cut); the buttons FIT [data-w="schnitt-fit"] and one button[data-w="schnitt-aktion"] per entry of
//   ctx.schnittAktionen. p[data-w="schnitt-text"]: loading or refusal text of the cut, or the text of the last answer of an edit, then with
//   button[data-w="schnitt-ursprung"] WRITE ORIGINAL ORDER after CUT AGAIN. Field: div[data-w="schnitt-feld"] with the canvas, a span[data-w="schnitt-treffer"]
//   per stored hit, one button[data-w="schnitt-scheibe"][data-scheibe=<0-based index>] per slice (holding span[data-w="schnitt-nr"] (index + 1) and, for a
//   measured marker, span[data-w="schnitt-guete"][data-marke=<index>]) and one button[data-w="schnitt-marke"][data-marke=<bound index 1..n-1>] per
//   interior bound; the class `bewegt` (amber) marks a bound that is not in the cut's `ursprung`, `ohne-treffer` a marker with no hit within reach.
//   Marker 0 is the start of the audio: the detector never finds a hit at frame 0, so its strength 0 is not drawn.
//
// A changed cut (E10): every answer that carries one replaces the cached cut, resets the selection to [], calls ctx.vergissInfo() and takes over `projekt`.
// The strip also reads the cut again on a track selection and when the server reports a change of it (event `schnitt` {id, geaendert}, also for a cut made by a hand
// without a project step) and treats a changed `geaendert` the same way.
//
// The contract for the later plans (A2, B, C), all on ctx:
//   schnittWahl: { spur_id, schnitt_id, scheiben: number[] } | null   0-based, ascending; reset to [] when the track or its cut changes; null without a cut
//   beiSchnittWahl: [fn(wahl)]            called with the new value whenever it changed (a fresh object each time)
//   beiSchnittGeaendert: [fn(schnitt_id)] called when the cut of that id was replaced by another (also with the same id); the selection is [] then
//   waehleScheiben(indizes)               sets the selection (sorted, deduplicated, indices outside the cut dropped)
//   schnittAktionen: [{ id, text, titel, aktiv(wahl) -> boolean, lauf(wahl) -> Promise }]   read on every draw; buttons after FIT, disabled while aktiv is false
//   zeichneSchnitt()                      redraw (call it after changing schnittAktionen)
import { leseWelle, spalten, zeichneSpalte } from '../wave.js';

export const SCHNITT_TEXT = {
  fit: 'FIT', fitTitel: 'Set SPEED so that the cut plays at the project tempo',
  laedt: 'Reading the cut…',
  hoerenTitel: 'Click to hear · shift-click adds or removes the slice from the selection · double-click adds a marker here (hold Alt: no snap)',
  methodeTitel: 'How CUT AGAIN cuts the audio: GRID in equal slices, HITS at the hits of the audio',
  zahlTitel: 'Number of equal slices (GRID)', empfTitel: 'Sensitivity of the hit detection (HITS): higher finds more hits',
  neu: 'CUT AGAIN', neuTitel: 'Cut the same audio again with this method; the patterns keep their slice numbers',
  neuBestaetigen: 'CONFIRM', neuBestaetigenTitel: 'Your marker edits of this cut are replaced by the new cut: click again within 3 s to confirm',
  ursprung: 'WRITE ORIGINAL ORDER', ursprungTitel: 'Replace the notes of this track by one note per slice, in the original order of the audio',
};
export const ZAHLEN = [4, 8, 16, 32, 64];       // the counts the grid method accepts (RASTER_ZAHLEN of the server)
export const BESTAETIGEN_MS = 3000;
const VORGABE_EMPF = 0.5;
const ZUG_PX = 3;                                // a pointer that moved this far or less is a click, not a drag

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const markiere = (e, name) => { e.setAttribute('data-w', name); return e; };
const prozent = (x) => `${+(x * 100).toFixed(4)}%`;
const grossAnfang = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
// a reason the page has no text for (the sampler routes carry their own English text) shows the text of the answer, as the shelf does
const refusalText = (ctx, r) => {
  const t = ctx.antwortText(r);
  return t.startsWith('Rejected:') && typeof r?.j?.text === 'string' && r.j.text !== '' ? grossAnfang(r.j.text) : t;
};
const gleich = (a, b) => (a === null || b === null) ? a === b
  : a.spur_id === b.spur_id && a.schnitt_id === b.schnitt_id && a.scheiben.length === b.scheiben.length && a.scheiben.every((x, i) => x === b.scheiben[i]);
const gleicheGrenzen = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const naechste = (n) => ZAHLEN.reduce((b, z) => (Math.abs(z - n) < Math.abs(b - n) ? z : b), ZAHLEN[0]);
// the hover text of a marker: its strength and its distance from the grid (E3), and what the mouse does
function markeTitel(k, g) {
  const t = [`Marker ${k}`];
  if (typeof g?.staerke === 'number') t.push(g.staerke > 0 ? `strength ${g.staerke.toFixed(2)}` : 'no hit here');
  const d = g?.raster_abstand_beats;
  if (typeof d === 'number') t.push(d === 0 ? 'on the grid' : `${Math.abs(d).toFixed(3)} beat ${d > 0 ? 'after' : 'before'} the grid`);
  return `${t.join(' · ')}. Drag to move (hold Alt: no snap), double-click to remove.`;
}

export function bindeSchnittStreifen(ctx, host) {
  const { st } = ctx;
  ctx.schnittWahl = null;
  ctx.beiSchnittWahl = [];
  ctx.schnittAktionen = [];
  ctx.beiSchnittGeaendert = [];   // [fn(schnitt_id)]: the cut of that id was replaced by another one (an edit here, or another hand); the selection is [] then
  host.hidden = true;

  const titel = markiere(el('span', 'w-schnitt-titel'), 'schnitt-titel');
  // the controls of the cut live as long as the strip: they are only synchronised when another cut object arrives, so a pending choice survives a redraw
  const methode = markiere(el('select', 'w-schnitt-wahl'), 'schnitt-methode');
  const zahl = markiere(el('select', 'w-schnitt-wahl'), 'schnitt-zahl');
  const empf = markiere(el('input', 'w-schnitt-empf'), 'schnitt-empf');
  const empfWert = markiere(el('span', 'w-schnitt-empfwert'), 'schnitt-empf-wert');
  const neu = markiere(el('button', 'w-effekt-knopf', SCHNITT_TEXT.neu), 'schnitt-neu');
  methode.setAttribute('title', SCHNITT_TEXT.methodeTitel); methode.setAttribute('aria-label', 'Method');
  zahl.setAttribute('title', SCHNITT_TEXT.zahlTitel); zahl.setAttribute('aria-label', 'Slices');
  empf.type = 'range'; empf.setAttribute('type', 'range'); empf.setAttribute('min', '0'); empf.setAttribute('max', '1'); empf.setAttribute('step', '0.05');
  empf.setAttribute('title', SCHNITT_TEXT.empfTitel); empf.setAttribute('aria-label', 'Sensitivity');
  neu.type = 'button';
  const steuer = markiere(el('span', 'w-schnitt-steuer'), 'schnitt-steuer');
  steuer.append(methode, zahl, empf, empfWert, neu);
  const knoepfe = markiere(el('span', 'w-schnitt-knoepfe'), 'schnitt-knoepfe');
  const kopf = el('div', 'w-schnitt-kopf');
  kopf.append(titel, steuer, knoepfe);
  const text = markiere(el('p', 'w-schnitt-text'), 'schnitt-text');
  const feld = markiere(el('div', 'w-schnitt-feld'), 'schnitt-feld');
  const canvas = el('canvas', 'w-schnitt-welle');
  host.replaceChildren(kopf, text, feld);

  const cache = new Map();   // cut id -> { schnitt, welle, fehler, welleFehler, ladeS, ladeW, anfrageFuer, stand }
  let gezeigteInfo = null;
  let zeigtSpur = null;      // the track the strip shows: while its info is on its way (after vergissInfo) the strip keeps what it shows
  let gebaut = null;         // the cut object the slice elements were built from
  let abgeglichen = null;    // the cut object the controls were last set from
  let gezeichnet = '';       // what the canvas shows: cut id|width|height
  let hoerNr = 0, fitLaeuft = false;
  let schreibt = false;      // a request that changes the cut or the project is on its way: no second one starts
  let stumm = 0;             // > 0 while the strip hands a project to the page: its own project event does not read the cut again
  let bewaffnet = false, uhr = null;   // CUT AGAIN on a hand cut waits for its second click
  let hinweis = null;        // { spur_id, schnitt_id, text, ursprung }: the text of the last answer of an edit
  let zug = null;            // a marker drag: { k, x0, h, links }
  const spurJetzt = () => (st.projekt?.spuren ?? []).find((s) => s.id === st.wahl && s.art === 'instrument') ?? null;
  const ziel = () => {
    const spur = spurJetzt();
    if (!spur) return null;
    const info = ctx.info?.(spur) ?? null, sc = info?.schnitt;
    if (sc && typeof sc.id === 'string') return { spur, sc, info };
    if (!info && zeigtSpur === spur.id && ctx.schnittWahl?.spur_id === spur.id) return { spur, sc: { id: ctx.schnittWahl.schnitt_id, scheiben: null }, info: null };
    return null;
  };

  // ---- loading ----
  async function ladeSchnitt(id, e, scheiben, nachlesen = false) {
    e.ladeS = true;
    if (!nachlesen) e.anfrageFuer = scheiben;
    const stand = e.stand;
    const r = await ctx.holeGet(`/sampler/schnitt?id=${encodeURIComponent(id)}`);
    e.ladeS = false;
    const nochmal = e.nochmal; e.nochmal = false;
    const s = r.j?.schnitt;
    if (r.status === 200 && s && Array.isArray(s.grenzen) && s.grenzen.length >= 2) {
      if (!e.schnitt) { e.schnitt = s; e.fehler = null; }
      else if (stand === e.stand && (s.geaendert !== e.schnitt.geaendert || !gleicheGrenzen(s.grenzen, e.schnitt.grenzen))) uebernimmAenderung(s, { info: nachlesen });   // another hand changed it; a read that started before our own change is stale
    } else if (!e.schnitt) e.fehler = refusalText(ctx, r);
    zeichne();
    if (nochmal) ladeSchnitt(id, e, null, true);   // the cut changed again while this read was on its way
  }
  async function ladeWelle(id, e) {
    e.ladeW = true;
    try {
      const r = await fetch(`/welle?schnitt=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      e.welle = leseWelle(await r.arrayBuffer());
    } catch { e.welleFehler = true; }   // without a wave the slices still work
    e.ladeW = false;
    zeichne();
  }
  function eintrag(sc) {
    let e = cache.get(sc.id);
    if (!e) { e = { schnitt: null, welle: null, fehler: null, welleFehler: false, ladeS: false, ladeW: false, anfrageFuer: null, stand: 0 }; cache.set(sc.id, e); }
    // the cut changed under its id (the info counts another number of slices than the cut read): read it once more for that count
    if (!e.ladeS && !e.fehler && (!e.schnitt || (sc.scheiben !== null && e.schnitt.grenzen.length - 1 !== sc.scheiben && e.anfrageFuer !== sc.scheiben))) ladeSchnitt(sc.id, e, sc.scheiben);
    if (!e.welle && !e.ladeW && !e.welleFehler) ladeWelle(sc.id, e);
    return e;
  }
  // A changed cut (E10): the new one replaces the cached one, the selection is empty, the info of the track is asked again (`info`), the project is taken over.
  // The wave stays: the audio never changes.
  function uebernimmAenderung(neu, { projekt = null, slug = st.slug, info = true } = {}) {
    let e = cache.get(neu.id);
    if (!e) { e = { schnitt: null, welle: null, fehler: null, welleFehler: false, ladeS: false, ladeW: false, anfrageFuer: null, stand: 0 }; cache.set(neu.id, e); }
    e.schnitt = neu; e.fehler = null; e.anfrageFuer = null; e.stand++;
    hoerNr++;   // the answer of a click that started before the change belongs to the old cut
    for (const h of [...ctx.beiSchnittGeaendert]) { try { h(neu.id); } catch (x) { console.error('beiSchnittGeaendert', x); } }   // after e.schnitt and the stand are new
    const wahl = ctx.schnittWahl;
    if (wahl && wahl.schnitt_id === neu.id) setzeWahl({ ...wahl, scheiben: [] });
    if (info) ctx.vergissInfo?.();
    if (projekt && st.slug === slug) { stumm++; try { ctx.uebernimm(slug, projekt); } finally { stumm--; } }
  }
  // the cached cut of the shown track is read again (selection, project event); a cut that is being read right now is not asked twice
  function nachlesen() {
    if (stumm > 0) return;
    const a = ziel();
    if (!a) return;
    const e = cache.get(a.sc.id);
    if (!e?.schnitt || e.ladeS) return;
    ladeSchnitt(a.sc.id, e, null, true);
  }

  // ---- selection ----
  function setzeWahl(neu) {
    if (gleich(ctx.schnittWahl, neu)) return;
    ctx.schnittWahl = neu;
    zeichneWahl();
    for (const h of [...ctx.beiSchnittWahl]) { try { h(neu); } catch (e) { console.error('beiSchnittWahl', e); } }
  }
  ctx.waehleScheiben = (indizes) => {
    const wahl = ctx.schnittWahl;
    if (!wahl) return;
    const n = (cache.get(wahl.schnitt_id)?.schnitt?.grenzen.length ?? 0) - 1;
    const neu = [...new Set((Array.isArray(indizes) ? indizes : []).filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
    setzeWahl({ ...wahl, scheiben: neu });
  };

  // ---- click, FIT ----
  async function klick(i, ev) {
    const wahl = ctx.schnittWahl;
    if (!wahl) return;
    if (ev?.shiftKey) {
      const s = wahl.scheiben.includes(i) ? wahl.scheiben.filter((x) => x !== i) : [...wahl.scheiben, i].sort((a, b) => a - b);
      setzeWahl({ ...wahl, scheiben: s });
      return;
    }
    if ((ev?.detail ?? 1) >= 2) return;   // the second click of a double click: the first one has heard the slice, the double click adds a marker
    const nr = ++hoerNr;
    const r = await ctx.holeJson('/sampler/hoeren', { spur_id: wahl.spur_id, scheibe: i });
    if (r.status !== 200) { ctx.melde(refusalText(ctx, r), true); return; }   // a refusal keeps the selection as it was
    const jetzt = ctx.schnittWahl;
    if (nr !== hoerNr || !jetzt || jetzt.spur_id !== wahl.spur_id || jetzt.schnitt_id !== wahl.schnitt_id) return;   // a later click, a changed cut or another track
    setzeWahl({ ...jetzt, scheiben: [i] });
  }
  async function fit() {
    const wahl = ctx.schnittWahl;
    if (!wahl || fitLaeuft) return;
    const slug = st.slug;
    fitLaeuft = true; zeichneWahl();
    try {
      const r = await ctx.holeJson('/sampler/fit', { spur_id: wahl.spur_id });
      if (r.status !== 200 || !r.j?.projekt) { ctx.melde(refusalText(ctx, r), true); return; }
      if (st.slug === slug) ctx.uebernimm(slug, r.j.projekt);
    } finally { fitLaeuft = false; zeichneWahl(); }
  }
  async function aktion(a) {
    const wahl = ctx.schnittWahl;
    if (!wahl || !a.aktiv(wahl)) return;
    try { await a.lauf({ ...wahl, scheiben: [...wahl.scheiben] }); } catch (e) { ctx.melde(String(e?.message ?? e), true); }
  }

  // ---- editing the cut ----
  const schnittJetzt = () => (ctx.schnittWahl ? cache.get(ctx.schnittWahl.schnitt_id)?.schnitt ?? null : null);
  // one request that changes the cut (cut again, marker edit); returns true when the cut changed. A refusal keeps everything and shows its text; the strip is
  // drawn from the cut again, which puts a dragged handle back.
  async function aendereSchnitt(weg, koerper, { ursprungAngebot = false } = {}) {
    const wahl = ctx.schnittWahl;
    if (!wahl || schreibt) return false;
    const slug = st.slug;
    schreibt = true; zeichneSteuer(); zeichneWahl();
    try {
      const r = await ctx.holeJson(weg, koerper);
      const s = r.j?.schnitt;
      if (r.status !== 200 || !s || !Array.isArray(s.grenzen) || s.grenzen.length < 2) {
        ctx.melde(refusalText(ctx, r), true);
        gebaut = null; zeichne();
        return false;
      }
      uebernimmAenderung(s, { projekt: r.j.projekt ?? null, slug });
      hinweis = { spur_id: wahl.spur_id, schnitt_id: s.id, text: typeof r.j.text === 'string' ? r.j.text : '', ursprung: ursprungAngebot };
      zeichne();
      return true;
    } finally { schreibt = false; zeichneSteuer(); zeichneWahl(); }
  }
  async function schreibeUrsprung() {
    const wahl = ctx.schnittWahl;
    if (!wahl || schreibt) return;
    const slug = st.slug;
    schreibt = true; zeichneSteuer(); zeichneWahl();
    try {
      const r = await ctx.holeJson('/sampler/ursprung', { spur_id: wahl.spur_id });
      if (r.status !== 200 || !r.j?.projekt) { ctx.melde(refusalText(ctx, r), true); return; }
      if (st.slug === slug) { stumm++; try { ctx.uebernimm(slug, r.j.projekt); } finally { stumm--; } }
      hinweis = { spur_id: wahl.spur_id, schnitt_id: wahl.schnitt_id, text: typeof r.j.text === 'string' ? r.j.text : '', ursprung: false };
      zeichne();
    } finally { schreibt = false; zeichneSteuer(); zeichneWahl(); }
  }
  function entwaffne() { bewaffnet = false; clearTimeout(uhr); uhr = null; }
  function neuKlick() {
    const s = schnittJetzt();
    if (!s || schreibt || methode.value === 'hand') return;
    if (s.methode === 'hand' && !bewaffnet) {   // the marker edits of a hand cut are lost: the first click only asks
      bewaffnet = true;
      uhr = setTimeout(() => { uhr = null; bewaffnet = false; zeichneSteuer(); }, BESTAETIGEN_MS);
      uhr?.unref?.();
      zeichneSteuer();
      return;
    }
    entwaffne(); zeichneSteuer();
    const m = methode.value === 'anschlag' ? 'anschlag' : 'raster';
    aendereSchnitt('/sampler/neu_schneiden', { id: s.id, methode: m, ...(m === 'raster' ? { scheiben: Number(zahl.value) } : { empfindlichkeit: Number(empf.value) }) }, { ursprungAngebot: true });
  }
  // the controls follow the cut that arrived; HAND is only an entry while the cut is a hand cut, and not one to choose
  function gleicheSteuerAb(s) {
    const n = s.grenzen.length - 1;
    methode.replaceChildren();
    for (const [wert, t] of [['raster', 'GRID'], ['anschlag', 'HITS'], ...(s.methode === 'hand' ? [['hand', 'HAND']] : [])]) {
      const o = el('option', '', t); o.value = wert; if (wert === 'hand') o.disabled = true; methode.append(o);
    }
    methode.value = ['raster', 'anschlag', 'hand'].includes(s.methode) ? s.methode : 'raster';
    zahl.replaceChildren();
    for (const z of ZAHLEN) { const o = el('option', '', String(z)); o.value = String(z); zahl.append(o); }
    zahl.value = String(naechste(n));
    empf.value = String(typeof s.empfindlichkeit === 'number' ? s.empfindlichkeit : VORGABE_EMPF);
    entwaffne();
    abgeglichen = s;
  }
  function zeichneSteuer() {
    zahl.disabled = methode.value !== 'raster';
    empf.disabled = methode.value !== 'anschlag';
    empfWert.textContent = Number(empf.value).toFixed(2);
    neu.disabled = methode.value === 'hand' || schreibt || !schnittJetzt();
    neu.textContent = bewaffnet ? SCHNITT_TEXT.neuBestaetigen : SCHNITT_TEXT.neu;
    neu.setAttribute('title', bewaffnet ? SCHNITT_TEXT.neuBestaetigenTitel : SCHNITT_TEXT.neuTitel);
  }
  const aenderung = () => { entwaffne(); zeichneSteuer(); };
  methode.addEventListener('change', aenderung);
  zahl.addEventListener('change', aenderung);
  empf.addEventListener('input', aenderung);
  empf.addEventListener('change', aenderung);
  neu.addEventListener('click', () => neuKlick());

  // ---- markers ----
  const frameAus = (s, clientX) => {
    const frames = s.grenzen[s.grenzen.length - 1], r = feld.getBoundingClientRect();
    return Math.max(0, Math.min(frames, Math.round(((clientX - r.left) / (r.width > 0 ? r.width : 1)) * frames)));
  };
  function baueMarke(s, k) {
    const frames = s.grenzen[s.grenzen.length - 1] > 0 ? s.grenzen[s.grenzen.length - 1] : 1;
    const h = markiere(el('button', 'w-marke'), 'schnitt-marke');
    h.type = 'button'; h.setAttribute('data-marke', String(k));
    h.setAttribute('title', markeTitel(k, s.guete?.[k]));
    h.style.left = prozent(s.grenzen[k] / frames);
    if (Array.isArray(s.ursprung) && !s.ursprung.includes(s.grenzen[k])) h.classList.add('bewegt');   // amber: moved, added, or kept from a hand edit
    if (s.guete?.[k]?.staerke === 0) h.classList.add('ohne-treffer');
    h.addEventListener('pointerdown', (ev) => {
      if (schreibt || (ev.button ?? 0) > 0) return;
      ev.preventDefault?.();
      try { h.setPointerCapture?.(ev.pointerId); } catch { /* a pointer that is gone */ }
      zug = { k, x0: ev.clientX, h, links: h.style.left };
    });
    h.addEventListener('pointermove', (ev) => {
      if (!zug || zug.h !== h || Math.abs(ev.clientX - zug.x0) <= ZUG_PX) return;
      const cut = schnittJetzt();
      if (cut) h.style.left = prozent(frameAus(cut, ev.clientX) / (cut.grenzen[cut.grenzen.length - 1] || 1));
    });
    h.addEventListener('pointerup', (ev) => {
      if (!zug || zug.h !== h) return;
      const z = zug; zug = null;
      try { h.releasePointerCapture?.(ev.pointerId); } catch { /* not captured */ }
      const cut = schnittJetzt();
      if (!cut || Math.abs(ev.clientX - z.x0) <= ZUG_PX) { h.style.left = z.links; return; }   // a click: the handle stays
      aendereSchnitt('/sampler/marke', { id: cut.id, art: 'schieben', marke: k, frame: frameAus(cut, ev.clientX), einrasten: !ev.altKey });
    });
    h.addEventListener('pointercancel', () => { if (zug?.h === h) { h.style.left = zug.links; zug = null; } });
    h.addEventListener('dblclick', (ev) => {
      ev.preventDefault?.();
      const cut = schnittJetzt();
      if (cut) aendereSchnitt('/sampler/marke', { id: cut.id, art: 'weg', marke: k });
    });
    return h;
  }

  // ---- drawing ----
  function baueScheiben(s, e) {
    const n = s.grenzen.length - 1, frames = s.grenzen[n] > 0 ? s.grenzen[n] : 1;
    const treffer = (Array.isArray(s.treffer) ? s.treffer : []).filter((f) => Number.isFinite(f) && f >= 0 && f <= frames).map((f) => {
      const t = markiere(el('span', 'w-treffer'), 'schnitt-treffer');
      t.style.left = prozent(f / frames);
      return t;
    });
    const liste = [], marken = [];
    for (let i = 0; i < n; i++) {
      const b = markiere(el('button', 'w-scheibe'), 'schnitt-scheibe');
      b.type = 'button'; b.setAttribute('data-scheibe', String(i)); b.setAttribute('title', SCHNITT_TEXT.hoerenTitel);
      b.style.left = prozent(s.grenzen[i] / frames); b.style.width = prozent((s.grenzen[i + 1] - s.grenzen[i]) / frames);
      b.append(markiere(el('span', 'w-scheibe-nr', String(i + 1)), 'schnitt-nr'));
      const staerke = s.guete?.[i]?.staerke;
      if (typeof staerke === 'number' && i > 0) {   // quality bar of a measured marker (D13); marker 0 is no hit that was missed: the detector cannot find one at frame 0
        const g = markiere(el('span', 'w-guete'), 'schnitt-guete');
        g.setAttribute('data-marke', String(i)); g.style.height = prozent(Math.min(1, Math.max(0, staerke)));
        b.append(g);
      }
      b.addEventListener('click', (ev) => klick(i, ev));
      b.addEventListener('dblclick', (ev) => {   // a marker at the pointer; the two clicks before it have heard the slice
        const cut = schnittJetzt();
        if (cut) aendereSchnitt('/sampler/marke', { id: cut.id, art: 'neu', frame: frameAus(cut, ev.clientX), einrasten: !ev.altKey });
      });
      liste.push(b);
      if (i > 0) marken.push(baueMarke(s, i));
    }
    feld.replaceChildren(canvas, ...treffer, ...liste, ...marken);
    gebaut = s;
    gezeichnet = '';
  }
  function zeichneWelle(s, e) {
    if (!e.welle || host.hidden) return;
    const r = canvas.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
    if (W === 0 || H === 0) return;
    const schluessel = `${s.id}|${W}|${H}`;
    if (schluessel === gezeichnet) return;
    gezeichnet = schluessel;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const g = canvas.getContext('2d'), w = e.welle, frames = s.frames > 0 ? s.frames : w.spalten * w.hop, mitte = H / 2;
    g.fillStyle = '#0b0d11'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x++) zeichneSpalte(g, x, mitte, spalten(w, (x / W) * frames / w.hop, ((x + 1) / W) * frames / w.hop), w.gain);
  }
  function zeichneWahl() {
    const wahl = ctx.schnittWahl;
    for (const b of feld.querySelectorAll('[data-w="schnitt-scheibe"]')) {
      const an = !!wahl && wahl.scheiben.includes(Number(b.dataset.scheibe));
      b.classList.toggle('gewaehlt', an); b.setAttribute('aria-pressed', String(an));
    }
    const knopf = (name, t, titelText, aus, klickt) => {
      const b = markiere(el('button', 'w-effekt-knopf', t), name);
      b.type = 'button'; b.setAttribute('title', titelText); b.disabled = aus;
      b.addEventListener('click', klickt);
      return b;
    };
    const fitKnopf = knopf('schnitt-fit', SCHNITT_TEXT.fit, SCHNITT_TEXT.fitTitel, !wahl || fitLaeuft || schreibt, () => fit());
    const aktionen = (ctx.schnittAktionen ?? []).map((a) => {
      let aktiv = false;
      try { aktiv = !!wahl && !!a.aktiv(wahl); } catch { aktiv = false; }
      const b = knopf('schnitt-aktion', a.text, a.titel ?? '', !aktiv, () => aktion(a));
      b.setAttribute('data-aktion', String(a.id));
      return b;
    });
    knoepfe.replaceChildren(fitKnopf, ...aktionen);
  }
  function zeichneText(spur, sc, e) {
    if (hinweis && (hinweis.spur_id !== spur.id || hinweis.schnitt_id !== sc.id)) hinweis = null;
    if (!hinweis) { text.textContent = ''; text.hidden = true; return; }
    text.textContent = hinweis.text; text.hidden = false;
    if (hinweis.ursprung) {
      const b = markiere(el('button', 'w-effekt-knopf', SCHNITT_TEXT.ursprung), 'schnitt-ursprung');
      b.type = 'button'; b.setAttribute('title', `${SCHNITT_TEXT.ursprungTitel} (${spur.name})`); b.disabled = schreibt;
      b.addEventListener('click', () => schreibeUrsprung());
      text.append(' ', b);
    }
  }
  function zeichne() {
    const a = ziel();
    if (!a) { zeigtSpur = null; gezeigteInfo = null; host.hidden = true; entwaffne(); setzeWahl(null); return; }
    const { spur, sc } = a;
    if (a.info) gezeigteInfo = a.info;
    zeigtSpur = spur.id;
    host.hidden = false;
    const w0 = ctx.schnittWahl;
    if (!w0 || w0.spur_id !== spur.id || w0.schnitt_id !== sc.id) setzeWahl({ spur_id: spur.id, schnitt_id: sc.id, scheiben: [] });
    const e = eintrag(sc), s = e.schnitt;
    if (!s) {
      gebaut = null; gezeichnet = '';
      feld.replaceChildren();
      steuer.hidden = true;
      titel.textContent = '';
      text.textContent = e.fehler ?? SCHNITT_TEXT.laedt; text.hidden = false;
      zeichneWahl();
      return;
    }
    steuer.hidden = false;
    titel.textContent = `${s.name} · ${s.grenzen.length - 1} slices · ${Number(Number(s.bpm).toFixed(2))} BPM`;
    if (abgeglichen !== s) gleicheSteuerAb(s);
    zeichneSteuer();
    zeichneText(spur, sc, e);
    if (gebaut !== s) baueScheiben(s, e);
    zeichneWelle(s, e);
    zeichneWahl();
  }
  ctx.zeichneSchnitt = () => zeichne();

  ctx.beiWahl.push(() => {
    for (const [id, e] of cache) if (e.fehler) cache.delete(id);   // selecting the track again tries a cut that could not be read once more
    zeichne();
    nachlesen();
  });
  ctx.beimProjekt.push((_p, wechsel) => {
    if (wechsel) zeigtSpur = null;   // another module: nothing of the old one is kept while the info is on its way
    zeichne();
  });
  // the cut is read again when it changed, not at every project event: the server tells the page about every change of a cut ({id, geaendert}), also one made
  // by a hand without a project step; the stamp of our own answers is the one cached already, so an own edit does not read twice
  ctx.beimEreignis.push((a, f) => {
    if (a !== 'schnitt' || typeof f?.id !== 'string') return;
    const e = cache.get(f.id);
    if (!e?.schnitt || f.geaendert === e.schnitt.geaendert) return;
    if (e.ladeS) { e.nochmal = true; return; }
    ladeSchnitt(f.id, e, null, true);
  });
  // every answer of the info cache redraws the track list and runs these hooks: the info of the selected track arrives that way
  (ctx.spurZeile ??= []).push((_zeile, spur) => { if (spur.id === st.wahl && ctx.info(spur) !== gezeigteInfo) zeichne(); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => zeichne()).observe(host);
  zeichne();
}
