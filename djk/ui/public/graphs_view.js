// Effect graphs and device panels per channel (graph choice, host areas, panel header, sound save).
import { zeigeFxReiter } from './effects_reiter.js';
import { htmlText, hostName, instrumentWahlHtml, graphWahlHtml, bkSpeichernHtml, bkMarke, GRAPH_KANAL_ART } from './effects.js';
import { steuerungen, parameterVon, vorgaben as panelVorgaben } from './panel.js';
import { vergesseGesendet, surgeAdapter, surgeFensterKnopf, SURGE_FENSTER, surgeFensterSenden } from './surge_adapter.js';
import { hostAdapter, istVonHost, rb338HostZuPanel, RB338_HOST_NAME, graphDesHosts, baukastenAutoPanel, knobHostName, hostKnobName } from './host_adapter.js';
import { standardBeschreibung, tagVonGraph, baueKopf } from './panel_kopf.js';
import { fehlerText } from './presets.js';   // 1.16: preset browser
import { $, $$, melde, postJson, zustand } from './page_state.js';
import { instrumenteSichtbar, platteBauen } from './effects_gemeinsam.js';
import { baueSendKnobs, hostLernOpt, lernModus, lernModusUmschalten, lernSchicken, lernen } from './learn_view.js';
import { baueFxDetail, bindeKnobs, fxGewaehlt } from './effects_view.js';
import { instrumenteAnsicht, presetSenden, wendeKanalPresetAn } from './effects_bindung.js';
import { zeigeRemix } from './remix_window.js';
import { beiAchse, katMerken, katSpeicherLesen, leseAchse, ACHSEN, gruppeVon } from './instrument_groups.js';
import { zeigePlaetze } from './slots_view.js';
// Baukasten S12: graph picker. graphenInfo = GET /graphen (the folder), graphenGeladen = what the page server sent per channel
// (SSE: stand.graphen_geladen, then a:'graphen'). Pickers sit on the strips of deck/1, deck/2, erz/2, erz/3, erz/5..7 (I5..I7), pad/1, pad/2, in the detail view
// and in the SEND RETURNS block (fx/3, fx/4); deck/3, deck/4 have no strip.
export let graphenInfo = { graphen: [], uebersprungen: [] };
export let graphenGeladen = {};
export function graphVon(k) {
  const n = graphenGeladen[k];
  return n ? (graphenInfo.graphen.find((g) => g.name === n) ?? { name: n, regler_namen: {} }) : null;
}
// Front panels: GET /graphen/panel?name= answers the panel of a graph (sidecar file, else the automatic panel) with the graph's knob ranges; null = the graph
// has no knobs at all, the slider field stays. Asked once per graph name and page load.
const panelCache = new Map();   // name -> { panel, regler } | null
const panelHol = new Map();     // name -> pending fetch
export const feldModus = new Set();    // channels whose panel was switched to the plain slider field (the MIDI learn buttons live there)
export const panelVon = (name) => (name ? panelCache.get(name) ?? null : null);
/** The graph of a channel as the knob list wants it: its names plus, when the panel answer is cached, the knob ranges it defines (knob count 8..64). */
export function graphMitBereich(k) {
  const g = graphVon(k);
  const info = g ? panelVon(g.name) : null;
  return g && info?.regler ? { ...g, regler: info.regler } : g;
}
export function holePanel(name) {
  if (!name || !graphenInfo.graphen.some((g) => g.name === name)) return Promise.resolve(null);   // unknown names would answer 404 (a console error)
  if (panelCache.has(name)) return Promise.resolve(panelCache.get(name));
  if (!panelHol.has(name)) {
    panelHol.set(name, (async () => {
      let aus = null;
      try {
        const r = await fetch(`/graphen/panel?name=${encodeURIComponent(name)}`);
        if (r.ok) {
          const j = await r.json();
          aus = j.panel ? { panel: j.panel, regler: j.regler ?? {} } : null;
          if (j.fehler?.length) melde(`Panel file of ${name} refused, showing the automatic panel: ${j.fehler[0]}${j.fehler.length > 1 ? ` (+${j.fehler.length - 1} more)` : ''}`, true);
        }
      } catch { /* the page server is gone: sliders */ }
      panelCache.set(name, aus);
      panelHol.delete(name);
      return aus;
    })());
  }
  return panelHol.get(name);
}
/** Fetch the panels of the graphs that sit on channels and rebuild the knob areas of those that have one. */
function ladePaneele() {
  for (const n of new Set(Object.values(graphenGeladen))) {
    if (panelCache.has(n)) continue;
    holePanel(n).then((p) => { if (p) baueKnobsNeu(); });
  }
}
// Front panels task 11: erz/2 (bass) and erz/3 (melodie) play a host while no Baukasten graph is loaded there. GET /klang says which one (wirt-<gruppe>.json, `art`):
// 'lv2' is Surge XT (the host started without --sfz/--vst3/--effekt/--instrument, instrument_host.py), 'vst3:*' is Cypher Modular (its own INSTRUMENT KNOBS), 'sfz:*' has
// no controls. The Surge panel and its parameter table come from GET /geraete/panel?art=surge (once per page load); the actual values from POST /klang aktion 'ist'.
export const SURGE_GRUPPE = { 'erz/2': 'bass', 'erz/3': 'melodie' };
let graphenErhalten = false;   // the first graphen_geladen state arrived (SSE stand or GET /graphen): before it a channel may look empty although it plays a graph
let surgeInfo, surgeHol = null;   // undefined = loading or not asked yet; null = failed; else { panel, parameter }
const surgeKlang = new Map();     // gruppe -> patch name of the host the last time the area was built
function holeSurge() {
  if (surgeInfo !== undefined) return Promise.resolve(surgeInfo);
  surgeHol ??= (async () => {
    let aus = null;
    try { const r = await fetch('/geraete/panel?art=surge'); if (r.ok) { const j = await r.json(); if (j.panel) aus = { panel: j.panel, parameter: j.parameter ?? [] }; } } catch { /* the area shows a retry */ }
    surgeInfo = aus;
    return aus;
  })();
  return surgeHol;
}
/** One line in the knob area, optionally with a Retry button. */
export function hostZeile(liste, text, neuLaden) {
  liste.innerHTML = `<div class="bkzeile">${htmlText(text)}${neuLaden ? ' <button type="button" data-host-neu>Retry</button>' : ''}</div>`;
  if (neuLaden) liste.querySelector('[data-host-neu]').addEventListener('click', neuLaden);
}
export async function baueHostBereich(liste, k) {
  const gruppe = SURGE_GRUPPE[k];
  const nr = (liste._hostNr = (liste._hostNr ?? 0) + 1);
  const gueltig = () => liste.isConnected && liste._hostNr === nr;
  const neuLaden = () => { surgeInfo = undefined; surgeHol = null; baueKnobsNeu(); };
  if (!graphenErhalten) { liste.textContent = 'Loading…'; return; }   // setzeGraphenGeladen / holeGraphen rebuild the area once the state is known
  liste.textContent = 'Loading…';
  let wirt;
  try { const r = await fetch('/klang'); if (!r.ok) throw new Error(`HTTP ${r.status}`); wirt = (await r.json())?.[gruppe] ?? null; }
  catch (e) { if (gueltig()) hostZeile(liste, `The instrument host could not be read (${e.message}).`, neuLaden); return; }
  if (!gueltig()) return;
  const art = typeof wirt?.art === 'string' ? wirt.art : null;
  if (art === null) { hostZeile(liste, 'No instrument host is running on this channel.', null); return; }
  const meldeAbgelehnt = () => liste._fp?.aktualisiere(true);
  const hostPlatte = (platte, adapter) => { liste.innerHTML = ''; liste.classList.add('mit-platte'); liste._fpHostKanal = k; liste._fp = platteBauen(liste, { ...platte, adapter, ...hostLernOpt(k) }); };   // no header presets; LEARN through the slot rows (host learn)
  if (art === 'sfz:grand') { hostZeile(liste, 'Grand piano (samples), no controls', null); return; }
  if (art === 'vst3:rb338') {   // RB-338 as host: its hand panel over the host's own parameters
    const info = await holeRb338();
    if (!gueltig()) return;
    if (!info) { hostZeile(liste, 'The RB-338 panel could not be loaded.', () => { rb338Info = undefined; rb338Hol = null; baueKnobsNeu(); }); return; }
    let ist = {};
    try { const r = await postJson('/klang', { gruppe, aktion: 'params' }); if (r.ok) ist = istVonHost(r.j?.params, rb338HostZuPanel); else melde(`The RB-338 values could not be read: ${r.j?.text ?? r.code}`, true); } catch { melde('The RB-338 values could not be read; the knobs show defaults until moved', true); }
    if (!gueltig()) return;
    hostPlatte({ panel: info.panel, parameter: Object.fromEntries(info.parameter.map((p) => [p.name, p])) },
      hostAdapter({ gruppe, kanal: k, hostName: (p) => RB338_HOST_NAME[p] ?? null, ist, post: postJson, melde, beiAbgelehnt: meldeAbgelehnt }));
    return;
  }
  if (art === 'vst3:baukasten') {   // Cypher Modular in the host: the panel of the graph it plays (found by its knob names), else an automatic panel of the reported knobs
    let r;
    try { r = await postJson('/klang', { gruppe, aktion: 'params' }); } catch (e) { if (gueltig()) hostZeile(liste, `The instrument host could not be read (${e.message}).`, neuLaden); return; }
    if (!gueltig()) return;
    if (!r.ok) { hostZeile(liste, `The instrument host refused: ${r.j?.text ?? r.code}`, neuLaden); return; }
    const graph = graphDesHosts(r.j?.namen, graphenInfo.graphen);
    const gp = graph ? await holePanel(graph) : null;
    if (!gueltig()) return;
    const panel = gp?.panel ?? baukastenAutoPanel(r.j?.params, r.j?.namen);
    if (panel) {
      hostPlatte({ panel, regler: gp?.regler },
        hostAdapter({ gruppe, kanal: k, hostName: knobHostName, ist: istVonHost(r.j?.params, hostKnobName), post: postJson, melde, beiAbgelehnt: meldeAbgelehnt }));
      return;
    }
  }
  if (art.startsWith('vst3:')) {   // Cypher Modular: the existing INSTRUMENT KNOBS
    liste.innerHTML = '<div class="knobbereich"><span class="bildtitel">INSTRUMENT KNOBS <b class="knobstatus">…</b></span><div class="knobliste"></div></div>';
    bindeKnobs(liste, gruppe);
    return;
  }
  if (art !== 'lv2') { hostZeile(liste, 'This instrument has no controls here.', null); return; }
  const info = await holeSurge();
  if (!gueltig()) return;
  if (!info) { hostZeile(liste, 'The Surge XT panel could not be loaded.', neuLaden); return; }
  const lies = async (namen) => { const r = await postJson('/klang', { gruppe, aktion: 'ist', parameter: namen }); return r.ok ? r.j?.werte : null; };
  const namen = [...new Set(steuerungen(info.panel).flatMap(parameterVon))];
  let ist = null;
  try { ist = await lies(namen); } catch { /* the defaults of the table are shown */ }
  if (!gueltig()) return;
  if (!ist) melde('The Surge XT values could not be read; the knobs show defaults until moved', true);
  if (surgeKlang.has(gruppe) && surgeKlang.get(gruppe) !== (wirt.klang ?? null)) vergesseGesendet(gruppe);   // another patch: what was sent no longer holds
  surgeKlang.set(gruppe, wirt.klang ?? null);
  liste.innerHTML = '';
  liste.classList.add('mit-platte');
  const adapter = surgeAdapter(gruppe, { kanal: k, parameter: info.parameter, ist, post: postJson, melde, lies, beiAbgelehnt: () => liste._fp?.aktualisiere(true) });
  liste._fpHostKanal = k;
  liste._fp = platteBauen(liste, { panel: info.panel, parameter: Object.fromEntries(info.parameter.map((p) => [p.name, p])), adapter, ...hostLernOpt(k) });   // no header presets; LEARN through the slot rows (host learn)
  surgeFensterAnbringen(liste, gruppe);
}
const surgeFensterAn = new Map();   // gruppe -> Surge's window shown (as asked by this page; the host keeps no other state)
/** The "Open Surge window" button in the Surge plate's header and the line with the host's reason under it. */
function surgeFensterAnbringen(liste, gruppe) {
  const kopf = liste.querySelector('.fp-kopf');
  if (!kopf) return;
  kopf.insertAdjacentHTML('beforeend', surgeFensterKnopf(!!surgeFensterAn.get(gruppe)));
  const hinweis = document.createElement('div');
  hinweis.className = 'fp-fensterhinweis';
  hinweis.hidden = true;
  kopf.after(hinweis);
  kopf.addEventListener('click', async (e) => {   // one listener on the header: the button is replaced after every answer
    const knopf = e.target.closest(SURGE_FENSTER);
    if (!knopf) return;
    const soll = !surgeFensterAn.get(gruppe);
    knopf.disabled = true;
    const r = await surgeFensterSenden(postJson, gruppe, soll);
    surgeFensterAn.set(gruppe, r.an);
    knopf.outerHTML = surgeFensterKnopf(r.an);
    hinweis.textContent = r.hinweis; hinweis.hidden = !r.hinweis;
  });
}
let rb338Info, rb338Hol = null;   // undefined = not asked yet; null = failed; else { panel, parameter } of GET /geraete/panel?art=rb338
function holeRb338() {
  if (rb338Info !== undefined) return Promise.resolve(rb338Info);
  rb338Hol ??= (async () => {
    let aus = null;
    try { const r = await fetch('/geraete/panel?art=rb338'); if (r.ok) { const j = await r.json(); if (j.panel) aus = { panel: j.panel, parameter: j.parameter ?? [] }; } } catch { /* the area shows a retry */ }
    rb338Info = aus;
    return aus;
  })();
  return rb338Hol;
}
export function baueKnobsNeu() { baueSendKnobs(); if ($('#fxdetail')?.firstChild) baueFxDetail(); if (instrumenteSichtbar()) instrumenteAnsicht.neuBauen(); }
/** Control path of a bk panel parameter k<n> on channel `k`: `<k>/bk/<n>`. */
const bkPfad = (k, param) => `${k}/bk/${param.slice(1)}`;
/** Adapter of the panel for a channel (contract: get(param), set(param, v), lernPfad(param)): bk parameter k<n> maps to `<kanal>/bk/<n>`;
 *  values from the control state, writes over POST /regler (latest value per parameter, every 40 ms). */
export function kanalAdapter(k) {
  const warte = new Map(), neu = new Map();
  return {
    get: (param) => { const w = zustand.regler?.[bkPfad(k, param)]; return typeof w === 'number' ? w : undefined; },
    lernPfad: (param) => bkPfad(k, param),
    set: (param, v) => {
      neu.set(param, v);
      if (warte.has(param)) return;
      warte.set(param, setTimeout(async () => {
        warte.delete(param);
        let a;
        try { a = await postJson('/regler', { pfad: bkPfad(k, param), nach: neu.get(param), ab: 'jetzt' }); } catch (e) { melde(`Knob not sent: ${e.message}`, true); return; }
        if (!a.ok) melde(`Knob refused: ${a.j?.text ?? a.j?.fehler ?? a.code}`, true);
      }, 40));
    },
  };
}
// Preset header of an instrument panel (panel_kopf.js): the register is read once (and again after a SAVE); `kopfPreset` remembers the last preset applied per channel and graph.
let kopfRegister = null;
const kopfPreset = new Map();   // `${kanal}|${graph}` -> { id, name }
async function holeKopfRegister() {
  try { const r = await fetch('/presets/register'); if (r.ok) kopfRegister = (await r.json()).register ?? null; } catch { /* the header stays as it was */ }
}
// A valid description for a preset saved from a panel that has no earlier preset to copy it from (standardBeschreibung in panel_kopf.js, words from GET /presets/vokabular).
async function kopfStandardBeschreibung(kanal, graph) {
  let inhalt = null;
  try { const r = await fetch('/presets/vokabular'); if (r.ok) inhalt = (await r.json()).inhalt; } catch { /* fixed words */ }
  return standardBeschreibung(graph, kanal, inhalt);
}
async function sichereKanalPreset(kanal, graph, name, adapter) {
  const letzt = kopfPreset.get(`${kanal}|${graph}`);
  let beschreibung = null;
  if (letzt) {
    const m = /^(werk|nutzer):([^/]+)\/(.+)$/.exec(letzt.id);
    try { const r = m && await fetch(`/presets/${m[1]}/${m[2]}/${m[3]}`); if (r?.ok) beschreibung = (await r.json()).beschreibung ?? null; } catch { /* default below */ }
  }
  beschreibung ??= await kopfStandardBeschreibung(kanal, graph);
  const werte = {};
  for (let n = 1; n <= 64; n++) werte[`knob${n}`] = adapter.get(`k${n}`) ?? 0.5;
  const r = await presetSenden('/presets', { name, geraet: 'baukasten', graph, werte, beschreibung, tags: tagVonGraph(graph) ? [tagVonGraph(graph)] : [] });
  if (r.code !== 200 && r.code !== 201) return { ok: false, text: fehlerText(r) };
  await holeKopfRegister();
  return { ok: true, text: `Preset "${name}" saved` };
}
export const kopfHandles = new Map();   // channel -> header handle: redrawn whenever the learn state changes from outside the header
export function panelKopf(k, graph, titel, adapter) {
  return (host, info) => {
    const schluessel = `${k}|${graph}`;
    const kopf = baueKopf(host, { titel, geraet: { art: 'bk', graph }, register: () => kopfRegister, aktiv: () => kopfPreset.get(schluessel)?.id ?? '',
      melde: (text, fehler) => melde(text, fehler),
      anwenden: async (id) => {
        const r = await wendeKanalPresetAn(id, k);
        if (r.ok) { const e = kopfRegister?.eintraege?.find((x) => x.id === id); kopfPreset.set(schluessel, { id, name: e?.name ?? id }); }
        return r;
      },
      sichern: (name) => sichereKanalPreset(k, graph, name, adapter),
      lernen: info?.lernen ? { an: () => lernModus.has(k), umschalten: () => lernModusUmschalten(k) } : undefined });
    kopfHandles.set(k, kopf);
    if (!kopfRegister) holeKopfRegister().then(() => kopf.neu());
  };
}
/** The panel's defaults ({param: k}) go out BEFORE the graph is loaded (knobs first, then graph, like the project restore): knobs live on the channel, a swapped graph inherits them. */
export async function schickeVorgaben(kanal, werte) {
  for (const [param, nach] of Object.entries(werte)) {
    let a;
    try { a = await postJson('/regler', { pfad: bkPfad(kanal, param), nach, ab: 'jetzt' }); } catch (e) { melde(`Panel defaults not sent: ${e.message}`, true); return; }
    if (!a.ok) { melde(`Panel defaults refused: ${a.j?.text ?? a.j?.fehler ?? a.code}`, true); return; }
  }
}
// Instrument picker by group: the display name of the host of erz/2 (bass) and erz/3 (melodie), read from GET /klang; the group last chosen per channel AND axis
// (localStorage, in try/catch: { <kanal>: { prinzip?: id, rolle?: id } }, an old string value is the role) and the group browsed to for the graph that was loaded
// at that moment on that axis (it falls back to the loaded graph's own group). The axis itself (type or role) is the page-wide choice of instrument_groups.js.
export const hostNamen = {};
export const instrDurchsucht = {};
let instrKat = {};
try { instrKat = katSpeicherLesen(localStorage.getItem('djk-instrument-kat')); } catch { /* without storage: no memory */ }
export function merkeInstrKat(k, kat, achse = leseAchse()) {
  instrKat = katMerken(instrKat, k, achse, kat);
  try { localStorage.setItem('djk-instrument-kat', JSON.stringify(instrKat)); } catch { /* without storage: only now */ }
}
function katFuer(k, achse) {
  const geladen = graphenGeladen[k] ?? '';
  const d = instrDurchsucht[k];
  if (d && d.fuer === geladen && d.achse === achse) return d.kat;
  return geladen === '' ? (instrKat[k]?.[achse] ?? null) : null;
}
export async function holeHostNamen() {
  try {
    const r = await fetch('/klang');
    if (!r.ok) return;
    const j = await r.json();
    let neu = false;
    for (const [k, g] of Object.entries(SURGE_GRUPPE)) { const n = hostName(j?.[g]); if (hostNamen[k] !== n) { hostNamen[k] = n; neu = true; } }
    if (neu) { zeigeGraphWahl(); if (instrumenteSichtbar()) instrumenteAnsicht.neuBauen(); }
  } catch { /* the default name Surge XT stays */ }
}
beiAchse(() => zeigeGraphWahl());   // the page-wide grouping changed: the pickers that are not focused redraw; nothing is sent
export function zeigeGraphWahl() {
  for (const platz of $$('[data-graphplatz]')) {
    const k = platz.dataset.graphplatz;
    if (platz.contains(document.activeElement)) continue;   // do not pull the list away while it is open
    const achse = leseAchse();
    platz.innerHTML = (platz.closest('#instrumente') ? instrumentWahlHtml(k, graphenInfo.graphen, graphenGeladen[k] ?? '', hostNamen[k], katFuer(k, achse), achse) : graphWahlHtml(k, graphenInfo.graphen, graphenGeladen[k] ?? '', hostNamen[k], achse))
      + bkSpeichernHtml(k, bkMarke(k, bkGespeichert, graphenGeladen[k], zustand.regler, panelVon(graphenGeladen[k])?.regler), bkGespeichert !== null, graphenGeladen[k]);   // S17
  }
  zeigeFxReiter();   // the insert lights of the EFFECTS tabs follow the loaded graphs (MASTER has no other trigger)
}
// S17: sound snapshot of the open project. bkGespeichert = GET /proj/bk gespeichert, null without a project. Fetched on start, on SSE 'proj'
// (debounced) and after SAVE SOUND; the marker follows the live knob values without polling (a knob event refreshes it at most every 250 ms).
let bkGespeichert = null, bkTimer = null, bkMarkeTimer = null;
export async function holeBk() {
  try {
    // GET /proj/bk answers 409 without an open project, and the browser logs every 4xx as a console error (the DJ acceptance A0/A0b/A6
    // counts it); so ask the cheap rev view first, which answers 200 with slug null when nothing is open
    const offen = await fetch('/proj/aktuell?nur=rev');
    if (!offen.ok || (await offen.json()).slug == null) { bkGespeichert = null; zeigeGraphWahl(); return; }
    const r = await fetch('/proj/bk');
    bkGespeichert = r.ok ? ((await r.json()).gespeichert ?? []) : null;
  } catch { /* the page server is gone: keep what the marker had */ }
  zeigeGraphWahl();
}
export function holeBkSpaeter() { clearTimeout(bkTimer); bkTimer = setTimeout(holeBk, 300); }
export function bkMarkeSpaeter() { if (!bkMarkeTimer) bkMarkeTimer = setTimeout(() => { bkMarkeTimer = null; zeigeGraphWahl(); }, 250); }
export async function speichereSound(kanal) {
  let r;
  try { r = await postJson('/proj/bk/merken', { kanaele: [kanal] }); } catch (e) { melde(`Page server unreachable: ${e.message}`, true); return; }
  window.djkGesendet.push({ bk_merken: { kanal }, code: r.code, antwort: r.j });
  if (!r.ok) melde(`Save sound refused: ${r.j?.text ?? r.j?.fehler ?? r.code}`, true);
  else if (r.j?.bk?.unbekannt?.length) melde(`Sound saved; ${r.j.bk.unbekannt.length} knob value(s) were unknown and kept as stored`, false);
  await holeBk();
}
export async function holeGraphen() {
  try {
    const j = await (await fetch('/graphen')).json();
    if (Array.isArray(j.graphen)) { graphenInfo = { graphen: j.graphen, uebersprungen: j.uebersprungen ?? [] }; graphenGeladen = j.geladen ?? graphenGeladen; if (j.geladen) graphenErhalten = true; }
    panelCache.clear();
    zeigeGraphWahl();
    zeigeRemix();
    baueSendKnobs();
    if (GRAPH_KANAL_ART[fxGewaehlt] || $('#fxdetail')?.firstChild) baueFxDetail();
    if (instrumenteSichtbar()) instrumenteAnsicht.neuBauen();
    ladePaneele();
  } catch { /* the page server is gone: the picker keeps what it had */ }
}
export function setzeGraphenGeladen(neu) {
  const vorher = graphenGeladen[fxGewaehlt];
  const alt = graphenGeladen;
  graphenGeladen = neu ?? {};
  graphenErhalten = true;
  const armiert = lernen.wartet?.pfad?.split('/bk/')[0];   // a graph change on the channel that waits for a controller drops the armed learn
  if (armiert && alt[armiert] !== graphenGeladen[armiert]) lernSchicken('/lernen', { pfad: null });
  zeigeGraphWahl();
  baueSendKnobs();
  zeigeRemix(); zeigePlaetze();   // the REMIX place follows the core state (target, lock of the place switch)
  if (graphenGeladen[fxGewaehlt] !== vorher) baueFxDetail();   // knob names (and the Surge knobs of erz/2, erz/3) follow the graph
  if (instrumenteSichtbar()) instrumenteAnsicht.neuBauen();   // deferred until pointerup while a panel control is held
  ladePaneele();
}
export async function waehleGraph(kanal, name) {
  let r;
  const gewaehlt = graphenInfo.graphen.find((g) => g.name === name);
  if (gewaehlt) for (const a of ACHSEN) merkeInstrKat(kanal, gruppeVon(gewaehlt, a), a);   // the group of the chosen instrument, on both axes: what shows after "Off"
  if (lernen.wartet?.pfad?.startsWith(`${kanal}/bk/`)) lernSchicken('/lernen', { pfad: null });   // the knob it waited for is about to change meaning
  if (name) { const info = await holePanel(name); if (info) await schickeVorgaben(kanal, panelVorgaben(info.panel)); }   // every graph with knobs has a panel (file or automatic)
  try { r = await postJson('/graph', { kanal, name }); } catch (e) { melde(`Page server unreachable: ${e.message}`, true); zeigeGraphWahl(); return; }
  window.djkGesendet.push({ graph: { kanal, name }, code: r.code, antwort: r.j });
  if (!r.ok) melde(`Graph refused: ${r.j?.text ?? r.j?.fehler ?? r.code}`, true);
  else if (r.j?.quittung?.status === 6) melde(`Graph refused: ${r.j.quittung.grund}`, true);
  else if (!r.j?.quittung) melde('Graph: no answer from the core yet (a large sampler loads slowly); check the picker', true);
  else if (r.j?.warnung) melde(`Graph loaded, but: ${r.j.warnung}`, true);   // kit-mode stream: Andreas is warned, not locked
  zeigeGraphWahl();   // back to what is really loaded when refused
}
