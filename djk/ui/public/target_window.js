// The window of one insert stage or one strip (stage 2 of the one dock work, ADR 041): the page opened as `/#geraet=ins:<stage id>` (or ret:/grp:/master) shows
// that one thing, big, in its own window. Like the instrument window (device_window.js) it is a full page instance: it loads the project and writes
// back through the same coalescing writer (window_project.js), reads the same events, and shows the SAME content the floating panel of the main page
// shows: the native face of a stage is the face builder of production/insert_face.js drawn INTO the window (ctx.faceEinbettung), so OPEN and WINDOW ↗
// cannot drift apart. It does not follow the controller focus and sends none (only the instrument window does).
// UI texts English.
import { neuesFensterProjekt } from './window_project.js';
import { bindeInsertDienste, straenge, ARTEN, HOST_ART } from './production/inserts.js';
import { returnListe } from './production/routing.js';
import { produktionDockHost } from './production/dock_host.js';
import { montiereDock } from './dock/dock.js';
import { montiereFenster } from './dock/window.js';
import { FACE_ARTEN } from './production/insert_face.js';
import { nachladenNoetig } from './production/stems.js';
import { antwortText } from './production/production.js';
import { schliesseFace } from './face/frame.js';
import { GERAET_FENSTER_TEXT } from './device_open.js';
import { zielAusHash } from './dock/target.js';

/** The strip of a target and what it is called in the window title. For a stage target `ins:<id>` the stage is found in whichever strip holds it. */
export function findeStufe(projekt, stufenId) {
  for (const strang of straenge(projekt)) {
    const insert = strang.inserts.find((i) => i.id === stufenId);
    if (insert) return { strang, insert };
  }
  return null;
}
const artName = (insert) => (insert.art === 'host' ? (insert.plugin?.name ?? HOST_ART.name) : (ARTEN[insert.art]?.name ?? insert.art));

/**
 * The state of the window from the project: { art: 'ok' | 'kein_projekt' | 'anderes_projekt' | 'weg', text, strang?, insert? }. `slug0` is the project the window was opened for.
 */
export function zielFensterLage({ ziel, slug0, slug, projekt }) {
  if (!projekt) return { art: 'kein_projekt', text: GERAET_FENSTER_TEXT.keinProjekt };
  if (slug0 !== null && slug !== slug0) return { art: 'anderes_projekt', text: GERAET_FENSTER_TEXT.anderesProjekt(slug0) };
  if (ziel.art === 'ins') {
    const x = findeStufe(projekt, ziel.id);
    return x ? { art: 'ok', text: '', ...x } : { art: 'weg', text: GERAET_FENSTER_TEXT.stufeWeg };
  }
  if (ziel.art === 'master') return { art: 'ok', text: '', name: 'Master' };
  if (ziel.art === 'grp') {
    const g = (projekt.gruppen ?? []).find((x) => x.id === ziel.id);
    return g ? { art: 'ok', text: '', name: `Group ${g.name}` } : { art: 'weg', text: GERAET_FENSTER_TEXT.gruppeWeg };
  }
  if (ziel.art === 'ret') {
    const r = returnListe(projekt, { mitLoopdeck: true }).find((x) => x.id === ziel.id);
    return r ? { art: 'ok', text: '', name: r.name } : { art: 'weg', text: GERAET_FENSTER_TEXT.rueckWeg };
  }
  return { art: 'weg', text: '' };
}

/**
 * Builds the window page into `wurzel`. opt: { ziel (parsed, dock/target.js), post, holeGet?, wurzel, dokument?, zeitgeber? }.
 * Returns { ereignis(a, f), ctx, lage, zeige }.
 */
export function bindeZielFenster(opt) {
  const d = opt.dokument ?? globalThis.document, wurzel = opt.wurzel, ziel = opt.ziel, zeitgeber = opt.zeitgeber ?? globalThis;
  const el = (tag, klasse, text) => { const e = d.createElement(tag); e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
  const kopf = el('div', 'gf-kopf'), name = el('b', 'gf-name', ''), hinweis = el('span', 'gf-hinweis'), meldung = el('span', 'gf-meldung');
  hinweis.setAttribute('role', 'status'); meldung.setAttribute('role', 'status');
  const platte = el('div', 'gf-platte zf-platte');
  kopf.append(name, el('span', 'gf-sp'), meldung, hinweis);
  wurzel.replaceChildren(kopf, platte);

  const fp = neuesFensterProjekt({
    post: opt.post, holeGet: opt.holeGet, zeitgeber,
    zeigeMeldung: (text, fehler) => { meldung.textContent = text; meldung.classList.toggle('fehler', fehler); },
    beiAenderung: () => zeige(),
    beiProjekt: (p, wechsel) => { for (const h of ctx.beimProjekt) h(p, wechsel); },
  });
  const { st, ctx, nachlader } = fp;
  // what the PRODUCTION services expect of their ctx (the hooks the faces register on, the text helper); the faces draw into the window page
  ctx.beimProjekt = []; ctx.beimEreignis = []; ctx.beimBild = []; ctx.beiWahl = []; ctx.antwortText = antwortText; ctx.fenster = null;
  const strang = ziel.art === 'ret' || ziel.art === 'grp' || ziel.art === 'master';
  if (!strang) ctx.faceEinbettung = platte;   // a stage: its face is the window; the faces opened from the chips of a strip card float as in PRODUCTION
  const speicher = (() => { try { return globalThis.localStorage; } catch { return null; } })();
  ctx.lies = (k, v) => { try { const x = speicher?.getItem(k); return x === null || x === undefined ? v : JSON.parse(x); } catch { return v; } };
  ctx.merke = (k, v) => { try { speicher?.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };
  bindeInsertDienste(ctx);
  let stufeVoll = null;   // the window layer of a stage without a native face (Baukasten, util, plugin): oeffneStufeVoll fills the page
  if (ziel.art === 'ins') {
    const dockEl = el('div', 'w-dock zf-dock'), flaecheEl = el('div', 'w-fenster-flaeche w-fenster-flaeche-voll');
    dockEl.setAttribute('data-w', 'dock'); flaecheEl.setAttribute('data-w', 'fenster-flaeche');
    platte.append(flaecheEl);
    ctx.$ = (w) => (w === 'dock-wurzel' ? dockEl : w === 'fenster-flaeche' ? flaecheEl : null);
    const host = produktionDockHost(ctx);
    const m = montiereFenster(host);
    ctx.fenster = m.fenster; stufeVoll = m;
  }
  if (strang) {   // the card of the strip (the dock with one card), its chips and OPEN open the stage windows in this page as in PRODUCTION
    const dockEl = el('div', 'w-dock zf-dock'), flaecheEl = el('div', 'w-fenster-flaeche');
    dockEl.setAttribute('data-w', 'dock'); flaecheEl.setAttribute('data-w', 'fenster-flaeche');
    platte.append(dockEl, flaecheEl);
    ctx.$ = (w) => (w === 'dock-wurzel' ? dockEl : w === 'fenster-flaeche' ? flaecheEl : null);
    const host = { ...produktionDockHost(ctx), einzel: ziel.text };
    montiereDock(host);
    const { fenster, oeffneGeraet, oeffneStufe } = montiereFenster(host);
    ctx.fenster = fenster; ctx.oeffneGeraet = oeffneGeraet; ctx.oeffneStufe = oeffneStufe;
    zeitgeber.setInterval?.(() => { const t = globalThis.performance?.now?.() ?? Date.now(); for (const h of ctx.beimBild) h(t); }, 1000);
  }

  const lage = () => zielFensterLage({ ziel, slug0: fp.slug0(), slug: st.slug, projekt: st.projekt });
  let offenId = null;   // the stage whose face is drawn
  function zeige() {
    const l = lage();
    wurzel.classList.toggle('gf-weg', l.art !== 'ok');
    hinweis.textContent = l.art === 'ok' ? '' : l.text;
    if (st.getrennt) hinweis.textContent = GERAET_FENSTER_TEXT.offline;
    if (l.art !== 'ok') { if (offenId !== null) { schliesseFace(d); stufeVoll?.fenster.schliesseAlle(); offenId = null; } name.textContent = ''; return; }
    if (strang) { name.textContent = l.name; try { d.title = `djk ${l.name}`; } catch { /* no title in a test DOM */ } return; }   // the dock listens to the project by itself
    name.textContent = `${l.strang.name} · ${artName(l.insert)}`;
    try { d.title = `djk ${artName(l.insert)} ${l.strang.name}`; } catch { /* no title in a test DOM */ }
    if (offenId === l.insert.id) return;   // the open face follows the project by itself (bindeInsertFace)
    offenId = l.insert.id;
    if (!FACE_ARTEN.includes(l.insert.art)) { stufeVoll.oeffneStufeVoll(l.strang.id, l.insert.id); return; }
    ctx.insertFaceOeffnen(l.strang, l.insert);
  }
  let standN = 0;
  function ereignis(a, f) {
    for (const h of ctx.beimEreignis) h(a, f);
    if (a === 'stand') { standN++; if (st.getrennt || standN > 1) nachlader.plane(); return; }
    if (nachladenNoetig(a, f, { sichtbar: true, slug: st.slug, rev: st.projekt?.rev, eigene: ctx.schreiber.istEigeneRev })) nachlader.plane();
  }
  zeige();
  nachlader.starte();
  return { ereignis, ctx, lage, zeige };
}

let gebunden = null;
/** app.js: starts the window mode on `#geraet-fenster` (called when the address names a stage or a strip). */
export function starteZielFenster(post, hash = globalThis.location?.hash) {
  const ziel = zielAusHash(hash);
  if (!ziel) return null;
  document.body.classList.add('geraet-fenster', 'ziel-fenster');
  const wurzel = document.querySelector('#geraet-fenster');
  if (!wurzel) return null;
  wurzel.hidden = false;
  gebunden = bindeZielFenster({ ziel, post, wurzel });
  return gebunden;
}
/** stream.js: every event of the stream goes to the window mode, when there is one. */
export function zielFensterEreignis(a, f) { gebunden?.ereignis(a, f); }
