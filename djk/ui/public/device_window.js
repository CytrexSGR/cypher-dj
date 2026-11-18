// The device window of a PROJECT track (2026-11-18, Andreas: "mir ist nicht klar wie ich den synth in einem extra fenster öffnen kann"): the page opened as
// `/#geraet=<track id>` shows only the full front panel of that track's instrument, so it can sit on a second monitor next to the arrangement and be played
// with a hardware controller. Like the Remix window (#remix) and the Controllers window (#controller) it is a full page instance that follows the core on its own.
//
// Two halves:
//   - the opener: oeffneGeraetFenster(spurId, melde) is the one function every OPEN ↗ control calls (one window name, djk-geraet: a second click focuses the window, the address turns it to its track);
//   - the window: bindeGeraetFenster() builds the smallest project context (the loader, the writer and the event rules of PRODUCTION: production/load.js,
//     writer.js, stems.js) and hands it to the panel code the PRODUCTION device panel and the workbench big view use (bindeGeraetAnsicht, bindeRackPanel).
//     Values follow the project (events, undo, a controller's write-back) and the core row spur/<slot>/bk/<k> (stream.js fills window.djk.regler and calls
//     zeilenEcho). Writes are the same commands with the same labels as in the main page. The window reports its track to the page server (controller focus).
//
// FOLLOW (2026-11-18, Andreas: a click on track 2 left the window on the synth of track 1 without its controller strip): the window follows the synth in front.
// When the controller focus moves to another project track that has a view (a click on its head in PRODUCTION, the workbench, a SEQ deck), the window shows that
// track; the address becomes #geraet=<id> (replaceState). FOLLOW off pins the window to its track (kept per browser in localStorage). OPEN ↗ always uses
// this one window (one window name) and turns it to its track by the address (hashchange).
// UI texts English.
import { bindeGeraetAnsicht, bkZeilenPfad, GERAET_TEXT } from './production/device_view.js';
import { bindeRackPanel } from './production/rack_device_operation.js';
import { neuerLader, neuerNachlader, offlineNach } from './production/load.js';
import { neuerSchreiber } from './production/writer.js';
import { nachladenNoetig } from './production/stems.js';
import { antwortText, meldeNachSchreiben } from './production/production.js';
import { geraetText } from './seq_field.js';
import { fokus as geteilterFokus } from './controller_fokus.js';
import { GERAET_FENSTER_TEXT, geraetFensterSpur, geraetFensterSpurId, kannGeraetFenster } from './device_open.js';
import { neuesGeraetLernen } from './device_learn.js';

// ---------- what the window shows ----------
/** The state of the window from the project: { art: 'ok' | 'kein_projekt' | 'anderes_projekt' | 'spur_weg', spur, text }. `slug0` is the project the window
 *  was opened for (the first one it saw): another project with a track of the same id is not this window's track. */
const FOLGEN_SCHLUESSEL = 'djk-geraet-folgen';
// The controller strip folded (2026-11-18, Andreas: "das möchte ich einklappen können und dann können auch die zahlen auf den knöpfen verschwinden"): only the
// head line of each controller stays (name, program, SAVE MAPPING), the rows of the strip and the numbers on the knobs go. Kept per browser.
const OFFEN_SCHLUESSEL = 'djk-geraet-ctl-offen';   // '1' = the strip is shown (the earlier key djk-geraet-ctl-zu is ignored: folded is the default now)
const leseZu = () => { try { return globalThis.localStorage?.getItem(OFFEN_SCHLUESSEL) !== '1'; } catch { return true; } };   // folded unless SHOW was chosen (Andreas 2026-11-18: "sollte midi standardmäßig eingeklappt sein")
const schreibeZu = (zu) => { try { globalThis.localStorage?.setItem(OFFEN_SCHLUESSEL, zu ? '0' : '1'); } catch { /* no storage: only this window */ } };
const leseFolgen = () => { try { return globalThis.localStorage?.getItem(FOLGEN_SCHLUESSEL) !== '0'; } catch { return true; } };
const schreibeFolgen = (an) => { try { globalThis.localStorage?.setItem(FOLGEN_SCHLUESSEL, an ? '1' : '0'); } catch { /* no storage: only this window */ } };

/** The track the window turns to when the controller focus changes to `fokus` ({ spur_id } of controller_fokus), or null: FOLLOW off, a live channel, the
 *  window's own track, a track not in the project or one without a view. Pure. */
export function folgeZiel({ folgt, fokus, spurId, projekt }) {
  const id = fokus?.spur_id;
  if (!folgt || typeof id !== 'string' || id === '' || id === spurId) return null;
  const spur = (projekt?.spuren ?? []).find((s) => s.id === id);
  return spur && kannGeraetFenster(spur) ? id : null;
}

export function geraetFensterLage({ spurId, slug0, slug, projekt }) {
  if (!projekt) return { art: 'kein_projekt', spur: null, text: GERAET_FENSTER_TEXT.keinProjekt };
  if (slug0 !== null && slug !== slug0) return { art: 'anderes_projekt', spur: null, text: GERAET_FENSTER_TEXT.anderesProjekt(slug0) };
  const spur = (projekt.spuren ?? []).find((s) => s.id === spurId) ?? null;
  if (!spur) return { art: 'spur_weg', spur: null, text: GERAET_FENSTER_TEXT.spurWeg };
  return { art: 'ok', spur, text: '' };
}

/** The colours of the boxes (sections) of a panel in the device window: the control numbers of a box, its title and its strip cells share one. The same
 *  ten hues in the same order as BOX_FARBEN of the Launch Control LEDs (djk/hand_bruecke/lc3.py): red, green, yellow, blue, magenta, white, orange, teal,
 *  violet, grey. A colour is given by the rank of a box among the boxes the controllers drive right now, as the LEDs do it. */
export const CTL_FARBEN = ['#ff5a4d', '#4cd964', '#ffd60a', '#4d8dff', '#ff5ad1', '#f2f2f2', '#ff9f0a', '#35d0ba', '#b78cf2', '#9a9a9a'];
/** The same boxes in the exact colours the LEDs of the Launch Control show (BOX_FARBEN in lc3.py, RGB 0..127 scaled to 0..255; tests/test_lc3.py
 *  compares the two lists): the title bar of a box and the badges of the strip are filled with them, so the screen names the colour the device shows.
 *  CTL_FARBEN above are the readable tones of the same hues for small text on the dark panel (the number inside a knob). */
export const CTL_LED = ['#ff0000', '#00ff00', '#ffb500', '#0000ff', '#ff0078', '#ffffff', '#ff3c00', '#00ff64', '#6400ff', '#323232'];
const CTL_LED_TEXT = ['#fff', '#000', '#000', '#fff', '#fff', '#000', '#fff', '#000', '#fff', '#fff'];   // the text that reads on each of them

/**
 * Which control of which controller drives which knob of this track: one entry per controller place that has entries on `basis` (spur/<slot>/bk/).
 * { platz, geraet, zellen: [{ regler, kurz, zeile, spalte, knopf (number or null: the control is free here), name }] }. The cells are the knobs of the
 * catalogue device in its hardware layout (zeile, spalte); an entry on a CC the catalogue does not know comes last (zeile 0). A cell whose assignment has `box` carries it. `zuordnungen` and
 * `controller` are GET /lernen, `katalog` is GET /register; `spurName` is cut off the front of the target names. Pure.
 */
export function controllerBelegung({ zuordnungen, katalog, controller, basis, spurName }) {
  if (typeof basis !== 'string' || basis === '') return [];
  const aus = [];
  const knopfVon = (z) => Number(z.pfad.slice(basis.length));
  const nameVon = (z) => { const n = String(z.name ?? ''); return (spurName && n.startsWith(`${spurName} `) ? n.slice(spurName.length + 1) : n) || `Knob ${knopfVon(z)}`; };
  const boxVon = (z) => (Number.isInteger(z?.box) && z.box >= 0 ? { box: z.box } : {});   // the panel section index the server found for the knob (GET /lernen `box`)
  for (const c of controller ?? []) {
    const eigene = (zuordnungen ?? []).filter((z) => z.platz === c.platz && typeof z.pfad === 'string' && z.pfad.startsWith(basis) && /^[0-9]+$/.test(z.pfad.slice(basis.length)));
    if (!eigene.length) continue;
    const g = (katalog ?? []).find((k) => k.weg === 'lernen' && typeof k.midi === 'string' && String(c.port ?? '').includes(k.midi) && Array.isArray(k.regler)) ?? null;
    const rest = new Set(eigene), zellen = [];
    // the knobs of the device, and its buttons and pads (they step a selector); a table entry on channel 0 is "any channel" (core mapping)
    for (const r of g?.regler ?? []) {
      const z = eigene.find((x) => (x.typ ?? 'cc') === r.typ && x.nr === r.nr && (x.kanal === r.kanal || x.kanal === r.kanal_daw || x.kanal === 0)) ?? null;
      if (z) rest.delete(z);
      zellen.push({ regler: r.name, kurz: r.name.replace(/^Enc\s*/, '').replace(/^Btn\s*/, 'B').replace(/^Pad\s*/, 'P'), zeile: r.zeile, spalte: r.spalte, knopf: z ? knopfVon(z) : null, name: z ? nameVon(z) : '', ...boxVon(z) });
    }
    let i = 0;
    for (const z of rest) zellen.push({ regler: `CC ${z.nr}`, kurz: `CC${z.nr}`, zeile: 0, spalte: ++i, knopf: knopfVon(z), name: nameVon(z), ...boxVon(z) });
    aus.push({ platz: c.platz, geraet: g?.name ?? c.name ?? `Controller ${c.platz}`, zellen });
  }
  return aus;
}

/**
 * Builds the window page into `wurzel` and starts following the project. opt: { spurId, post (POST helper, jsonPost), holeGet?, wurzel, dokument?, fokus? (the sender, default the shared one), zeitgeber?, ansichtOpt? (tests) }.
 * Returns { ereignis(a, f) } for the event stream (stream.js) and the pieces for tests ({ ctx, lage, zeige }).
 */
export function bindeGeraetFenster(opt) {
  const { post } = opt, d = opt.dokument ?? globalThis.document, wurzel = opt.wurzel, fokus = opt.fokus ?? geteilterFokus;
  let spurId = opt.spurId;   // the track shown: FOLLOW and OPEN ↗ turn the window to another one (wechsle)
  let folgt = opt.folgt ?? leseFolgen();
  let zu = opt.zu ?? leseZu();   // the strip folded: its rows and the numbers on the knobs hidden (class gf-ctl-zu on the root)
  wurzel.classList.toggle('gf-ctl-zu', zu);
  const el = (tag, klasse, text) => { const e = d.createElement(tag); e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
  const kopf = el('div', 'gf-kopf'), name = el('b', 'gf-name', spurId), geraet = el('span', 'gf-geraet'), hinweis = el('span', 'gf-hinweis'), meldung = el('span', 'gf-meldung');
  hinweis.setAttribute('role', 'status'); meldung.setAttribute('role', 'status');
  const platte = el('div', 'gf-platte'), streifen = el('div', 'gf-ctl');
  streifen.hidden = true;
  const folgeKnopf = el('button', 'gf-folgen', 'FOLLOW');
  folgeKnopf.type = 'button';
  const zeigeFolgen = () => {
    folgeKnopf.classList.toggle('an', folgt); folgeKnopf.setAttribute?.('aria-pressed', String(folgt));
    folgeKnopf.title = folgt ? 'FOLLOW on: this window shows the synth of the track you select in the main window. Click to keep this track here'
      : 'FOLLOW off: this window stays on this track. Click to follow the track you select in the main window';
  };
  folgeKnopf.addEventListener?.('click', () => { folgt = !folgt; schreibeFolgen(folgt); zeigeFolgen(); });
  zeigeFolgen();
  kopf.append(name, geraet, folgeKnopf, el('span', 'gf-sp'), meldung, hinweis);
  wurzel.replaceChildren(kopf, streifen, platte);

  const st = { slug: null, projekt: null, getrennt: false };
  let slug0 = null, meldeUhr = null;
  const zeitgeber = opt.zeitgeber ?? globalThis;
  const melde = (text, fehler = false) => {
    meldung.textContent = text; meldung.classList.toggle('fehler', fehler);
    zeitgeber.clearTimeout(meldeUhr); meldeUhr = zeitgeber.setTimeout(() => { meldung.textContent = ''; }, 6000);
  };
  const merkeAntwort = (r) => { const o = offlineNach(r); if (o !== null && o !== st.getrennt) { st.getrennt = o; zeige(); } return r; };
  const holeJson = async (weg, koerper) => {
    try { const r = await post(weg, koerper); let j = null; try { j = await r.json(); } catch { /* empty */ } return merkeAntwort({ status: r.status, j }); }
    catch (e) { return merkeAntwort({ status: 0, j: { fehler: 'netz', text: e.message } }); }
  };
  const holeGet = opt.holeGet ?? (async (weg) => {
    try { const r = await fetch(weg); let j = null; try { j = await r.json(); } catch { /* empty */ } return merkeAntwort({ status: r.status, j }); }
    catch (e) { return merkeAntwort({ status: 0, j: { fehler: 'netz', text: e.message } }); }
  });
  const ctx = { st, melde, holeJson, holeGet };

  // The project, loaded like PRODUCTION loads it (GET /proj/aktuell; an older state of the same project is dropped), written like PRODUCTION writes it.
  const uebernimm = (slug, p) => {
    if (slug !== null && slug === st.slug && st.projekt && p && p.rev < st.projekt.rev) return;
    st.slug = slug; st.projekt = p;
    if (slug !== null) ctx.schreiber.setze(slug, p.rev);
    if (slug0 === null && slug !== null) slug0 = slug;   // the project this window was opened for
    zeige();
  };
  const lade = neuerLader({
    hole: () => holeGet('/proj/aktuell'),
    uebernimm: (slug, p) => uebernimm(slug, p),
    leere: () => uebernimm(null, null),
    beiWeg: (r) => melde(antwortText(r), true),
    beiDa: () => { if (st.getrennt) { st.getrennt = false; zeige(); } },
  });
  const nachlader = neuerNachlader(lade, 30);
  ctx.schreiber = neuerSchreiber({
    holeJson,
    beiProjekt: (slug, p, rev, j) => { uebernimm(slug, p); meldeNachSchreiben(j, melde); },
    beiFehler: (a, r) => { melde(antwortText(r), true); if (r.status === 409 && r.j?.fehler === 'rev_veraltet') return nachlader.starte(); },
    beiWiederhole: async () => { nachlader.starte(); await nachlader.fertig(); },
    beiFremdeRev: () => nachlader.plane(),
    beiVerworfen: (n) => melde(`The project changed elsewhere: reloaded, ${n} waiting change${n === 1 ? '' : 's'} dropped, please repeat`, true),
  });
  ctx.aendere = (label, befehle, schluessel, optionen) => ctx.schreiber.aendere(label, befehle, schluessel, optionen);
  ctx.aendereAus = (rechne) => {   // the command is computed when its turn comes, from the project as it is then (like PRODUCTION)
    const slug = st.slug;
    return ctx.schreiber.aendereMit(() => {
      const p = st.projekt;
      if (!p || st.slug !== slug) return null;
      const x = rechne(p);
      return x ? { ...x, rev: p.rev } : null;
    });
  };

  // The panel code of PRODUCTION: one device view, one rack panel (a track shows one of them), both in the same place.
  const ansichtHost = el('div', 'gf-geraet'), rackHost = el('div', 'p-irack gf-rack');
  platte.append(ansichtHost, rackHost);
  const lernen = neuesGeraetLernen({ holeJson, holeGet, melde, beiStand: () => { ansicht?.lernenNeu(); zeigeBelegung(); } });   // MIDI learn on the knobs of this panel
  let seiteJetzt = null;   // the page (tab) of the panel that is shown: told with the focus, a following controller takes the mapping of that page
  const beiSeite = (_spur, id) => { seiteJetzt = id; fokus.melde({ spur_id: spurId, seite: id }, 'geraet-fenster'); };
  const ansicht = bindeGeraetAnsicht(ctx, ansichtHost, { breit: true, dokument: d, lernen, lernKopf: false, beiSeite, ...(opt.ansichtOpt ?? {}) });
  const rack = bindeRackPanel(ctx, rackHost);
  let gemeldet = false, zuletzt = null;
  const lage = () => geraetFensterLage({ spurId, slug0, slug: st.slug, projekt: st.projekt });
  function zeige() {
    const l = lage();
    zuletzt = l;
    const s = l.spur;
    name.textContent = s?.name ?? spurId;
    geraet.textContent = s ? geraetText(s) : '';
    hinweis.textContent = l.text || (st.getrennt ? GERAET_FENSTER_TEXT.offline : '');
    d.title = s ? `${s.name} · ${geraetText(s)}` : 'djk device';
    wurzel.classList.toggle('gf-weg', l.art !== 'ok');   // gone: only the line above, nothing to click
    const istRack = s?.geraet?.art === 'rack';
    ansichtHost.hidden = istRack || !s; rackHost.hidden = !istRack;
    if (istRack) { ansicht.zeige(null); rack.zeige(s); return; }
    rack.zeige(null);
    if (!s) { ansicht.zeige(null); return; }
    if (!ansicht.zeige(s)) { const p = el('p', 'gf-keins', GERAET_TEXT.keins); ansichtHost.replaceChildren(p); }   // a device without a view: the text of the main page
    // the track is in front of this window: told when it first shows, and again whenever it gets the browser focus (bindeFensterFokus asks the source below)
    if (!gemeldet) { gemeldet = true; fokus.melde(seiteJetzt ? { spur_id: spurId, seite: seiteJetzt } : { spur_id: spurId }, 'geraet-fenster'); }
    zeigeBelegung();
  }
  // Turns the window to another track: its panel, its strip, its title. `melden`: tell the server it is in front now (OPEN ↗ by the address); a turn that
  // follows the focus does not, the focus is there already.
  function wechsle(neu, melden) {
    if (!neu || neu === spurId) return;
    if (lernen.stand().an) lernen.umschalten();   // an armed learn belongs to the knob of the old track
    spurId = neu; seiteJetzt = null; gemeldet = !melden;
    try { if (geraetFensterSpur(globalThis.location?.hash) !== neu) globalThis.history?.replaceState?.(null, '', `#geraet=${encodeURIComponent(neu)}`); } catch { /* a test page */ }
    zeige();
    planeBelegung();
  }
  fokus.registriere('geraet-fenster', () => (zuletzt?.art === 'ok' ? (seiteJetzt ? { spur_id: spurId, seite: seiteJetzt } : { spur_id: spurId }) : null));

  // Which controller control drives which knob: a strip in the layout of the hardware above the panel, and the control's number on the knob itself.
  // Read from GET /lernen and GET /register, again whenever the tables or the controller focus change. Nothing is written from here.
  let belegung = [], katalog = null, ctlUhr = null;
  const programme = new Map();   // controller place -> { nr, von, name }: the program of the place (GET /controller/fokus `plaetze`), Page up/down on the device steps it
  // The controller state of the server: the programs of the places, and the page in front. A program on another page turns the panel to that page.
  function nimmFokusLage(f) {
    programme.clear();
    for (const p of f?.plaetze ?? []) if (p?.programm && Number.isInteger(p.platz)) programme.set(p.platz, p.programm);
    const s = f?.fokus;
    if (s && s.spur_id === spurId && typeof s.seite === 'string' && s.seite !== seiteJetzt) ansicht.zeigeSeite(s.seite);
  }
  const schalteProgramm = async (platz, schritt) => {
    const r = await holeJson('/controller/programm', { platz, schritt });
    if (r.status === 200) { nimmFokusLage(r.j); zeigeBelegung(); } else if (r.j?.fehler !== 'keine_programme') melde(`Program not changed: ${r.j?.text ?? r.j?.fehler ?? `HTTP ${r.status}`}`, true);
  };
  const basisJetzt = () => { const z = st.projekt ? bkZeilenPfad(st.projekt.spuren ?? [], spurId, 'k1') : null; return z ? z.slice(0, -1) : null; };
  function markiere() {
    let zellen = [];
    try { zellen = [...(ansichtHost.querySelectorAll?.('.fp-zelle[data-param]') ?? [])]; } catch { return; }
    const marke = new Map(), boxVonKnopf = new Map();
    for (const b of belegung) for (const z of b.zellen) if (z.knopf !== null && !marke.has(`k${z.knopf}`)) { marke.set(`k${z.knopf}`, z.kurz); if (z.box !== undefined) boxVonKnopf.set(`k${z.knopf}`, z.box); }
    // one colour per box (section) of the panel: the numbers of its knobs, its title and the cells of the strip share it. The index comes from the
    // server (`box`, the same one the controller LEDs use); without it (no panel known there) the sections are counted in the order of the page.
    const boxen = [];
    const rang = new Map([...new Set(boxVonKnopf.values())].sort((x, y) => x - y).map((b, i) => [b, i]));   // the rank of a box among the boxes in use (lc3.py box_raenge)
    const indexVon = (z) => { const b = boxVonKnopf.get(z.dataset.param); if (b !== undefined) return rang.get(b) % CTL_FARBEN.length; const id = z.closest?.('.fp-sektion')?.dataset?.sektion ?? ''; let i = boxen.indexOf(id); if (i < 0) i = boxen.push(id) - 1; return i % CTL_FARBEN.length; };
    try { for (const s of ansichtHost.querySelectorAll('.fp-sektion')) { boxen.push(s.dataset.sektion ?? ''); delete s.dataset.ctlBox; } } catch { /* no sections */ }
    const farbe = new Map();
    for (const z of zellen) {   // the number sits in the knob; a control without a knob (selector, switch) carries it at its corner
      const m = marke.get(z.dataset.param), knopf = z.querySelector?.('.fp-knopf') ?? null, traeger = knopf ?? z;
      if (knopf && z.dataset.ctl !== undefined) delete z.dataset.ctl;
      if (m === undefined) { if (traeger.dataset.ctl !== undefined) delete traeger.dataset.ctl; continue; }
      if (traeger.dataset.ctl !== m) traeger.dataset.ctl = m;
      const fi = indexVon(z), f = CTL_FARBEN[fi], box = z.closest?.('.fp-sektion');
      traeger.style?.setProperty('--ctl', f);
      if (box) { box.dataset.ctlBox = '1'; box.style?.setProperty('--ctl', f); box.style?.setProperty('--ctl-led', CTL_LED[fi]); box.style?.setProperty('--ctl-ledtext', CTL_LED_TEXT[fi]); }
      if (!farbe.has(z.dataset.param)) farbe.set(z.dataset.param, fi);
    }
    try { for (const c of streifen.querySelectorAll('.gf-ctl-z[data-knopf]')) { const fi = farbe.get(`k${c.dataset.knopf}`); if (fi !== undefined) { c.style.setProperty('--ctl', CTL_LED[fi]); c.style.setProperty('--ctl-ledtext', CTL_LED_TEXT[fi]); } else { c.style.removeProperty('--ctl'); c.style.removeProperty('--ctl-ledtext'); } } } catch { /* a strip without cells */ }
  }
  function zeigeBelegung() {
    const l = lernen.daten();
    belegung = katalog && zuletzt?.art === 'ok' ? controllerBelegung({ zuordnungen: l.zuordnungen, controller: l.controller, katalog, basis: basisJetzt(), spurName: zuletzt.spur?.name }) : [];
    // LEARN sits next to SAVE MAPPING (2026-11-18, Andreas); a Baukasten synth with nothing mapped yet gets the head line alone, so LEARN is always there
    const kannLernen = zuletzt?.art === 'ok' && zuletzt.spur?.geraet?.art === 'intern' && zuletzt.spur.geraet.name === 'bk';
    const lernKnopf = () => {
      const k = el('button', lernen.an() ? 'gf-ctl-lernen an' : 'gf-ctl-lernen', 'LEARN');
      k.type = 'button';
      k.title = lernen.an() ? 'LEARN on: click a knob, then move a control on your controller. Click to stop' : 'MIDI learn: click, then a knob, then move a control on your controller';
      k.setAttribute?.('aria-pressed', String(lernen.an()));
      k.addEventListener?.('click', () => lernen.umschalten());
      return k;
    };
    streifen.hidden = belegung.length === 0 && !kannLernen;
    if (belegung.length === 0) {
      const kopfzeile = el('div', 'gf-ctl-kopf');
      if (kannLernen) kopfzeile.append(el('span', 'gf-ctl-name', 'Controller: nothing mapped on this synth'), el('span', 'gf-sp'), lernKnopf());
      const block = el('div', 'gf-ctl-geraet'); block.append(kopfzeile);
      streifen.replaceChildren(...(kannLernen ? [block] : []));
      markiere();
      return;
    }
    streifen.replaceChildren(...belegung.map((b) => {
      const block = el('div', 'gf-ctl-geraet');
      const kopfzeile = el('div', 'gf-ctl-kopf'), sichern = el('button', 'gf-ctl-sichern', 'SAVE MAPPING');
      sichern.type = 'button';
      sichern.title = 'Keep this mapping for this synth: FOLLOW loads it whenever a track with this synth is in front';
      sichern.addEventListener?.('click', () => { void sichereBelegung(b.platz); });
      const klappe = el('button', 'gf-ctl-klappe', zu ? 'SHOW' : 'HIDE');
      klappe.type = 'button';
      klappe.title = zu ? 'Show the mapping: the controls of the device and the numbers on the knobs' : 'Fold the mapping: hide the controls of the device and the numbers on the knobs';
      klappe.setAttribute?.('aria-expanded', String(!zu));
      klappe.addEventListener?.('click', () => { zu = !zu; schreibeZu(zu); wurzel.classList.toggle('gf-ctl-zu', zu); zeigeBelegung(); });
      kopfzeile.append(klappe, el('span', 'gf-ctl-name', b.geraet));
      const pr = programme.get(b.platz);
      if (pr) {   // the program of this place: number, name, and the two steps Page up/down do on the device
        const zurueck = el('button', 'gf-ctl-prog', '◀'), vor = el('button', 'gf-ctl-prog', '▶');
        zurueck.type = 'button'; vor.type = 'button';
        zurueck.title = 'Previous program (Page up on the device)'; vor.title = 'Next program (Page down on the device)';
        zurueck.disabled = pr.nr <= 1; vor.disabled = pr.nr >= pr.von;
        zurueck.addEventListener?.('click', () => { void schalteProgramm(b.platz, -1); });
        vor.addEventListener?.('click', () => { void schalteProgramm(b.platz, 1); });
        kopfzeile.append(zurueck, el('b', 'gf-ctl-prognr', `${pr.nr}/${pr.von}`), vor, el('span', 'gf-ctl-progname', pr.name));
      }
      kopfzeile.append(...(kannLernen ? [lernKnopf()] : []), sichern);
      block.append(kopfzeile);
      const zeilen = [...new Set(b.zellen.map((z) => z.zeile))].sort((x, y) => (x || 99) - (y || 99));
      for (const nr of zeilen) {
        const reihe = el('div', 'gf-ctl-reihe');
        for (const z of b.zellen.filter((x) => x.zeile === nr).sort((x, y) => x.spalte - y.spalte)) {
          const zelle = el('div', z.knopf === null ? 'gf-ctl-z frei' : 'gf-ctl-z');
          zelle.title = z.knopf === null ? `${z.regler}: free` : `${z.regler}: ${z.name}`;
          if (z.knopf !== null) zelle.dataset.knopf = String(z.knopf);
          zelle.append(el('b', '', z.kurz), el('span', '', z.name));
          reihe.append(zelle);
        }
        block.append(reihe);
      }
      return block;
    }));
    markiere();
  }
  // Saves what the place has on this synth as the user's preset of the graph (it wins over the factory preset when the place follows).
  async function sichereBelegung(platz) {
    fokus.melde(seiteJetzt ? { spur_id: spurId, seite: seiteJetzt } : { spur_id: spurId }, 'geraet-fenster');   // the preset is taken from the synth and the page in front: these
    const r = await holeJson('/controller/presets/speichern', { platz, art: 'instrument' });
    if (r.status === 200 || r.status === 201) melde(`Mapping saved for ${r.j?.preset?.name ?? 'this synth'}`);
    else melde(`Mapping not saved: ${r.j?.text ?? r.j?.fehler ?? `HTTP ${r.status}`}`, true);
  }
  async function ladeBelegung() {
    if (katalog === null) { const r = await holeGet('/register'); if (r?.status === 200 && Array.isArray(r.j?.katalog)) katalog = r.j.katalog; }
    const fl = await holeGet('/controller/fokus');
    if (fl?.status === 200) nimmFokusLage(fl.j);
    await lernen.lade();   // beiStand draws the strip
    zeigeBelegung();
  }
  const planeBelegung = () => { zeitgeber.clearTimeout(ctlUhr); ctlUhr = zeitgeber.setTimeout(() => { void ladeBelegung(); }, 200); };
  if (typeof globalThis.MutationObserver === 'function' && ansichtHost instanceof (globalThis.Node ?? Object)) {
    try { new globalThis.MutationObserver(() => markiere()).observe(ansichtHost, { childList: true, subtree: true }); } catch { /* no observer: the marks are set when the tables are read */ }
  }

  let standN = 0;
  function ereignis(a, f) {
    if (a === 'lernen') lernen.ereignis(f);
    if (a === 'controller_fokus') { const z = folgeZiel({ folgt, fokus: f?.fokus, spurId, projekt: st.projekt }); if (z) wechsle(z, false); nimmFokusLage(f); planeBelegung(); }
    if (a === 'stand') { standN++; planeBelegung(); if (st.getrennt || standN > 1) nachlader.plane(); return; }   // the first picture of the stream carries nothing new; a reconnect loads again
    if (nachladenNoetig(a, f, { sichtbar: true, slug: st.slug, rev: st.projekt?.rev, eigene: ctx.schreiber.istEigeneRev })) nachlader.plane();
  }
  zeige();
  nachlader.starte();
  void ladeBelegung();
  return { ereignis, ctx, lage, zeige, belegung: () => belegung, wechsle, spur: () => spurId, folgt: () => folgt, zu: () => zu };
}

let gebunden = null;
/** app.js: starts the window mode on `#geraet-fenster` (only called when the address names a track). */
export function starteGeraetFenster(post) {
  document.body.classList.add('geraet-fenster');
  const wurzel = document.querySelector('#geraet-fenster');
  if (!wurzel) return null;
  wurzel.hidden = false;
  gebunden = bindeGeraetFenster({ spurId: geraetFensterSpurId, post, wurzel });
  globalThis.addEventListener?.('hashchange', () => { const id = geraetFensterSpur(globalThis.location?.hash); if (id) gebunden?.wechsle(id, true); });   // OPEN ↗ of another track
  return gebunden;
}
/** stream.js: every event of the stream goes to the window mode, when there is one. */
export function geraetFensterEreignis(a, f) { gebunden?.ereignis(a, f); }
