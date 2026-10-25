// PRODUCTION-Ansicht (D1, Paket V1; Spec 2.11, 3.3, 3.4, A1, A2 ohne Clip-Bearbeitung, A5- und A6-Bedienung).
// Wurzel des gekapselten Moduls: app.js ruft bindeProduktion() einmal auf und reicht Ansichtswechsel (zeige/verberge)
// und jede Nachricht aus /strom (ereignis) herein. Die Teile (BINDER) docken nur über ctx an: Haken beimProjekt,
// nachLaden, vorBild, beimBild, beimEreignis, beimSichtwechsel. Spricht nur die Projekt-API (Spec 3.4); der Wechsel
// der Ansicht schickt nichts an den Kern (A1). Oberfläche englisch. Gezeichnet wird nur, solange die Ansicht sichtbar
// ist (eigener rAF-Takt, Ring window.djkProdBild wie window.djkBild).
import { neuerSchreiber } from './schreiber.js';
import { neuerLader, serverWeg, offlineNach } from './laden.js';
import { bindeZeitachse } from './zeitachse_bedienung.js';
import { bindeProjektwahl } from './projektwahl.js';
import { bindeSpuren } from './spurkoepfe.js';
import { bindeGruppen } from './gruppen.js';
import { MAX_SPUREN } from './grenzen.js';
import { bindeAblage } from './ablage.js';
import { bindeTransport } from './transport.js';
import { bindeVerlauf } from './verlauf_anzeige.js';
import { bindeClips } from './clip_bedienung.js';
import { bindeDetail } from './detail.js';
import { bindeAusgabe } from './freeze_export.js';
import { bindeVariantenReihen } from './varianten.js';
import { bindeGeraete } from './geraete.js';
import { bindeAufnahme } from './aufnahme.js';
import { AUSGABE_FEHLER, mehrdeutigText } from './ausgabe.js';

const BINDER = [bindeZeitachse, bindeProjektwahl, bindeSpuren, bindeGruppen, bindeAblage, bindeTransport, bindeVerlauf, bindeClips, bindeDetail, bindeAusgabe, bindeVariantenReihen, bindeGeraete, bindeAufnahme];

const GERUEST = `
<div class="p-transport" role="toolbar" aria-label="Transport">
  <div class="p-gruppe p-projekt">
    <span class="p-name" data-p="name">No project</span>
    <button data-p="neu" title="Start a new project">NEW</button>
    <input data-p="neu-name" placeholder="Project name, Enter" maxlength="60" aria-label="New project name" hidden>
    <select data-p="oeffnen" title="Open a project" aria-label="Open project"><option value="">OPEN…</option></select>
  </div>
  <div class="p-gruppe">
    <button data-p="play" class="p-play" title="Play from the start marker" disabled>▶ PLAY</button>
    <button data-p="stopp" title="Stop" disabled>■ STOP</button>
    <button data-p="rec" class="p-rec" aria-pressed="false" title="Open a project first" disabled>● REC</button><span data-p="rec-status" class="p-recstatus" role="status"></span>
    <output data-p="position" class="p-position" title="Position: bar.beat.sixteenth">1.1.1</output>
  </div>
  <div class="p-gruppe">
    <label for="p-tempo">TEMPO</label><input id="p-tempo" data-p="tempo" inputmode="decimal" size="6" autocomplete="off" title="Project tempo, 60 to 200 BPM: Enter sets it" disabled>
    <button data-p="loop" aria-pressed="false" title="Loop the bracket in the ruler" disabled>LOOP</button>
    <button data-p="metronom" aria-pressed="false" title="Metronome" disabled>METRO</button>
  </div>
  <div class="p-gruppe">
    <label for="p-raster">GRID</label><select id="p-raster" data-p="raster" title="Snap grid"></select>
    <button data-p="follow" aria-pressed="true" title="Follow the playhead (scrolling by hand turns it off)">FOLLOW</button>
    <button data-p="zoom-aus" title="Zoom out (Ctrl+wheel)" aria-label="Zoom out">−</button><button data-p="zoom-ein" title="Zoom in (Ctrl+wheel)" aria-label="Zoom in">+</button>
  </div>
  <div class="p-gruppe">
    <button data-p="undo" title="Undo (Ctrl+Z)" disabled>↶ UNDO</button><button data-p="redo" title="Redo (Ctrl+Shift+Z)" disabled>↷ REDO</button>
    <button data-p="verlauf" aria-expanded="false" title="History of changes">HISTORY ▾</button>
  </div>
  <div class="p-gruppe p-varianten" data-p="varianten" role="group" aria-label="Variants" hidden></div>
  <span class="p-offline" data-p="offline" role="status" title="The project server does not answer: this is the last state it sent" hidden>OFFLINE</span>
  <span class="p-meldung" data-p="meldung" role="status"></span>
  <span class="p-kern" data-p="kern" title="Arrangement in the core: loaded revision and transport state"></span>
  <span class="p-limiter" data-p="limiter" role="status" title="The set limiter is reducing the master: the room hears less than the production master and the export carry" hidden>SET LIMITER</span>
</div>
<ol class="p-verlauf" data-p="verlauf-liste" aria-label="History" hidden></ol>
<div class="p-arr">
  <div class="p-ecke">
    <button data-p="neu-audio" title="Add an audio track" disabled>+ AUDIO</button><button data-p="neu-rb" title="Add an instrument track with the RB-338" disabled>+ RB-338</button><button data-p="neu-surge" title="Add an instrument track with Surge (host slot 1)" disabled>+ SURGE</button>
  </div>
  <canvas class="p-lineal" data-p="lineal" title="Top strip: drag the loop bracket · bottom strip: click sets the start marker"></canvas>
  <div class="p-koerper" data-p="koerper">
    <div class="p-koepfe" data-p="koepfe"></div>
    <div class="p-flaeche" data-p="flaeche"><canvas class="p-spuren" data-p="spuren"></canvas><canvas class="p-ueber" data-p="ueber" title="Click: start marker · wheel: scroll · Ctrl+wheel: zoom · Shift+wheel: tracks"></canvas></div>
  </div>
  <div class="p-leer" data-p="leer">No project open. NEW starts one, OPEN loads one.</div>
</div>
<section class="p-mixer" data-p="mixer" aria-label="Groups and master" hidden>
  <div class="p-mixer-kopf"><span class="p-mixer-titel">GROUPS</span><button data-p="neu-gruppe" title="Add a group track (up to 8); put tracks into it with the output menu of each track" disabled>+ GROUP</button></div>
  <div class="p-gruppenreihe" data-p="mixer-gruppen"></div>
  <div class="p-pm" aria-label="Production master">
    <span class="p-mixer-titel">MASTER</span>
    <input class="p-pm-fader" data-p="pm-fader" type="range" min="-60" max="6" step="0.5" title="Production master volume (double click: 0 dB). The export is taken here, before the set limiter." aria-label="Volume production master">
    <output class="p-pm-wert" data-p="pm-wert"></output>
    <div class="meter waagrecht p-pm-pegel" data-kanal="pm"><i></i></div>
  </div>
</section>
<details class="p-geraete" data-p="geraete"><summary>INPUTS</summary><div data-p="geraete-liste" role="group" aria-label="Audio and MIDI inputs"></div></details>
<section class="p-detail" data-p="detail" aria-label="Detail"><div class="p-detail-kopf">CLIP</div><div class="p-detail-leer">No clip selected.</div></section>`;

// Texte zu den Gründen der Projekt-API: die Gründe aus S2-Kern (projekt/befehle.ts, verlauf.ts) und Spec 3.4. Fehlt einer,
// zeigt die Seite „Rejected: <code>“ (tests/produktion_wurzel.test.mjs hält die Liste beisammen).
export const FEHLER_TEXT = {
  rev_veraltet: 'The project changed elsewhere: reloaded, please repeat',
  regler_abgelehnt: 'The core refused a mixer change: nothing was changed',
  nichts_zu_tun: 'Nothing to undo or redo', kein_projekt: 'No project open', unbekannt: 'No such project', name_ungueltig: 'A project name needs 1 to 80 characters',
  ki_gestoppt: 'Stop Cypher is set', ki_stopp: 'Stop Cypher was pressed: the start was dropped', deck_laeuft: 'A deck is playing: the tempo stays until it stops', nicht_geladen: 'The core has no arrangement loaded yet',
  zu_gross: AUSGABE_FEHLER.zu_gross, server_fehler: 'The project server did not answer: showing the last state', netz: 'Page server unreachable', keine_antwort: 'No answer from the core',
  routing_zyklus: 'A group cannot feed itself', routing_grenze: 'Groups do not nest, and there are at most 8',
  ziel_unbekannt: 'That output no longer exists', gruppe_unbekannt: 'That group no longer exists',
  spur_bereich: `At most ${MAX_SPUREN} tracks`, slot_belegt: 'D1 has one Surge slot', spur_unbekannt: 'That track no longer exists', clip_unbekannt: 'That clip no longer exists',
  kein_eingang: 'A track can only be armed with a recording input', eingang_fehlt: 'That recording input does not exist', zu_viele_scharf: 'At most 8 audio tracks can be armed at once', aufnahme_laeuft: 'A recording is running', nichts_scharf: 'No track is armed', keine_aufnahme: 'No recording is running', kein_platz: 'Not enough free disk space to record', ersetzen_loop: 'The take could not replace a looped clip; it is saved as a file', veraltet_spur: 'The armed track no longer exists', ueberlappung: 'A transport is already running; stop it before recording', transport_abgelehnt: 'The transport did not start; nothing was recorded', aufnahme_abgelehnt: 'The core refused the recording', aufnahme_abgebrochen: 'The core dropped the recording before it began; nothing was recorded', leer: 'The take contains no audio', take_zu_lang: 'The take is longer than a WAV file can hold (about 3 hours); the raw file is kept', uebernahme_fehler: 'The take could not be placed on the track; the raw file is kept',
  index_bereich: 'No such track position', tempo_bereich: 'Tempo: 60 to 200 BPM', loop_bereich: 'The loop needs at least 1 beat',
  argument_ungueltig: 'That value is not allowed', argument_unbekannt: 'The core does not know that setting', befehl_unbekannt: 'The server does not know that command',
  art_passt_nicht: 'That clip does not fit this track', sha_ungueltig: 'That sample is not in the catalogue', clip_nicht_midi: 'That is not a MIDI clip',
  warp_marker: 'The warp markers are not valid', warp_faktor: 'A warp segment has a tempo outside 15 to 800 BPM', warp_modus: 'That warp mode does not exist yet',
  transpose_repitch: 'RE-PITCH follows the tempo: no transpose here', kein_warp: 'That clip has no warp yet', offset_bei_warp: 'The clip is warped: use its offset in beats',
  kein_tempo: 'The library has no tempo for this sample: it stays unwarped', warp_auto_neuer_clip: 'Auto-warp a new clip with its own clip_neu',
  fade_zu_lang: 'The fades are longer than the clip', feld_nur_audio: 'That setting only exists on audio clips', beat_ausserhalb: 'That position is outside the clip',
  noten_unbekannt: 'That note no longer exists', id_belegt: 'That id is taken', projekt_ungueltig: 'The change would make the project invalid',
  // verlauf.ts und ablage.ts (S2): Verlauf und Ablage des Projekts
  verlauf_inkonsistent: 'The change history does not fit the project: nothing was changed', verlauf_kaputt: 'The change history file is damaged',
  label_ungueltig: 'The change needs a description of 1 to 200 characters', projekt_busy: 'Another process has this project open',
  json_kaputt: 'The project file is damaged', slug_ungueltig: 'That is not a valid project name',
  log_voraus: 'The change history is ahead of the project file: open the project again', quelle_ungueltig: 'That source is not valid',
  verlauf_geschlossen: 'The change history is closed: open the project again', rev_nicht_steigend: 'The change history would go backwards: nothing was changed',
  // D1 V2 Nachzug (7a): alle übrigen Gründe des Servers im selben Baum (tests/produktion_gruende.test.mjs liest sie aus dem Code).
  // patch.ts (PatchFehler, kommt als verlauf_inkonsistent an; Text trotzdem, falls ein Weg ihn einmal durchreicht)
  pfad_ungueltig: 'The change history does not fit the project: nothing was changed', pfad_unbekannt: 'The change history does not fit the project: nothing was changed',
  op_unbekannt: 'The change history does not fit the project: nothing was changed', existiert_schon: 'The change history does not fit the project: nothing was changed',
  id_passt_nicht: 'The change history does not fit the project: nothing was changed',
  // wiedergabe.ts (WiedergabeFehler): kommt als kern.wiedergabe.fehler (7c), Text hier für jeden anderen Weg
  nr_ungueltig: 'The core got an invalid arrangement number', arbeitsordner_fehlt: 'The work folder of this instance is missing',
  datei_fehlt: 'A file of the arrangement is missing (a frozen track?)',
  // bereiche/proj (ProjFehler, BEREICH_GRUENDE, Tempo-Weg)
  koerper_zu_gross: 'The change is too big (more than 1 MiB)', json: 'The server could not read the request', koerper_kein_objekt: 'The server could not read the request',
  intern: 'The project server hit an internal error: nothing was changed', beschaeftigt: AUSGABE_FEHLER.beschaeftigt,
  katalog_fehlt: 'The sample catalogue is not available', sha_unbekannt: 'That sample is not in the catalogue', nur_live: 'That sample is protected (Ableton Live only)',
  quelle_fehlt: 'The sample file is missing', aktion_unbekannt: 'The server does not know that transport action', beat_ungueltig: 'That start position is not allowed',
  tempo_abgelehnt: 'The core refused the tempo', kein_kern: 'The core is not running', rampe_haengt: 'The tempo change did not finish in the core',
  transport_laeuft: 'Your transport is running: Cypher switches the project only after it stops',
  // katalog.ts (KatalogFehler)
  camelot_ungueltig: 'That key is not valid', katalog_kaputt: 'The sample catalogue is damaged', katalog_schema: 'The sample catalogue has an unknown format',
  facette_ungueltig: 'That filter is not valid', zu_viele_suchwoerter: 'Too many search words', sort_ungueltig: 'That sort order is not valid',
  suche_ungueltig: 'That search is not valid', mid_ungueltig: 'That entry id is not valid',
  // server.ts: Spur-Regler nur über das Projekt (Spec 6.22)
  ueber_projekt: 'Track mixer changes go through the project',
  // http/transport.ts postAbgewiesen (V2 Fix F9, Spec 6.34: auch die Router-Gründe brauchen einen Text): 415 und 403
  nur_json: 'The server only takes JSON requests', fremde_herkunft: 'The server refused a request from another page',
};
// V2 Fix-Runde 2 H7 (Spec 6.34): beschaeftigt und zu_gross sind mehrdeutig (ein Freeze, ein Öffnen, eine Tempo-Rampe; Grenzen des Kerns). Wie in
// ausgabe.js (F12) zeigt die Seite dann den text der Antwort, wenn er da ist, sonst einen neutralen Text, der keine Ursache behauptet (vorher fest
// „A freeze is running“ und „The change is too big“). Der S2-Text zu zu_gross ist heute deutsch (projekt/befehle.ts); S3 stellt die Server-Texte um.
export function fehlerText(r) {
  if (r?.j && 'quittung' in r.j && r.j.quittung === null) return FEHLER_TEXT.keine_antwort;   // der Kern hat nicht geantwortet: nie stiller Erfolg
  const code = r?.j?.fehler ?? r?.j?.grund;
  return mehrdeutigText(r) ?? FEHLER_TEXT[code] ?? `Rejected: ${code ?? `HTTP ${r?.status}`}`;
}
// D1 V2 Nachzug (7c, 7d): eine angenommene Änderung, die der Kern nicht nachvollzieht, ist kein stiller Erfolg. /proj/aendern (und
// undo/redo) antworten 200 mit kern.wiedergabe = {nr: null, fehler, text}, wenn der Übersetzer die Wiedergabe nicht bauen konnte
// (WiedergabeFehler, bereiche/proj/sitzung.ts schreibeNeueWiedergabe), und mit kern.regler = 'kein_kern', wenn Mixer-Werte ohne Kern
// angenommen wurden (Spec 6.30). {nr: null, aufgeschoben: true} (Freeze-Sperre, Spec 6.23) lädt später und ist kein Fehler.
export const WIEDERGABE_TEXT = {
  datei_fehlt: 'a frozen track file is missing', zu_gross: 'too many clips or notes for the core',
  arbeitsordner_fehlt: 'the work folder of this instance is missing', nr_ungueltig: 'the arrangement number is invalid',
};
export function kernHinweis(kern) {
  const f = kern?.wiedergabe?.fehler;
  if (f) return `Saved, but the core did not load the arrangement: ${WIEDERGABE_TEXT[f] ?? f}`;
  if (kern?.regler === 'kein_kern') return 'Saved; the core is not running';
  return null;
}
// Text zu einer Antwort ohne Erfolg: ein 5xx ohne Grund ist „der Server antwortet nicht“, nie „Rejected: HTTP 503“. Gilt für den Schreibweg
// und (V2 Fix F3) für FREEZE und EXPORT (freeze_export.js über ctx.antwortText)
export const antwortText = (r) => fehlerText(serverWeg(r) && r.status !== 0 ? { j: { fehler: 'server_fehler' } } : r);
const lies = (k, v) => { try { return localStorage.getItem(k) ?? v; } catch { return v; } };
const merke = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ohne Speicher: nur jetzt */ } };

export function bindeProduktion({ post, bpm, stoebern, bibliothek = null, wurzel = document.querySelector('#produktion') }) {
  wurzel.innerHTML = GERUEST;
  const $ = (n) => wurzel.querySelector(`[data-p="${n}"]`);
  const st = { slug: null, projekt: null, sichtbar: false, laeuft: false, arr: null, kopfBeat: null, start: 0, getrennt: false };
  window.djkProd = st;            // für die Browserprobe (lesen)
  window.djkProdBild = [];        // Zeichendauer je Bild in ms, Ring 600
  let meldeUhr = 0;
  function melde(text, fehler = false) {
    const m = $('meldung'); m.textContent = text; m.classList.toggle('fehler', fehler);
    clearTimeout(meldeUhr); meldeUhr = setTimeout(() => { m.textContent = ''; }, 6000);
  }
  // Server weg: die dauerhafte Anzeige OFFLINE bleibt, bis der Strom wieder verbunden ist und neu geladen wurde (die Meldung
  // daneben verschwindet nach 6 s, die Ansicht zeigt weiter den alten Stand)
  function setzeGetrennt(an) { st.getrennt = an; $('offline').hidden = !an; wurzel.classList.toggle('offline', an); }
  // D1 V2 Nachzug (7b): jede Antwort entscheidet über OFFLINE (laden.js offlineNach): Ausfall setzt es, Erfolg nimmt es zurück,
  // eine Ablehnung mit Grund (auch 5xx mit Grund) lässt es, wie es ist
  const merkeAntwort = (r) => { const o = offlineNach(r); if (o !== null && o !== st.getrennt) setzeGetrennt(o); return r; };
  async function holeJson(weg, koerper) {
    try { const r = await post(weg, koerper); let j = null; try { j = await r.json(); } catch { /* leer */ } return merkeAntwort({ status: r.status, j }); }
    catch (e) { return merkeAntwort({ status: 0, j: { fehler: 'netz', text: e.message } }); }
  }
  async function holeGet(weg) {
    try { const r = await fetch(weg); let j = null; try { j = await r.json(); } catch { /* leer */ } return merkeAntwort({ status: r.status, j }); }
    catch (e) { return merkeAntwort({ status: 0, j: { fehler: 'netz', text: e.message } }); }
  }
  const ctx = { st, $, bpm, stoebern, melde, holeJson, holeGet, lies, merke, fehlerText, antwortText,
    beimProjekt: [], nachLaden: [], vorBild: [], beimBild: [], beimEreignis: [], beimSichtwechsel: [],
    ausgabeLauf: () => {} };   // V2 Fix F14: freeze_export.js setzt es (ausgabe_lauf aus GET /proj/aktuell)

  // Neuer Stand vom Server; ein älterer Stand desselben Projekts als der gezeigte wird verworfen
  function setzeProjekt(slug, p) {
    if (slug !== null && slug === st.slug && st.projekt && p.rev < st.projekt.rev) return;
    const wechsel = slug !== st.slug;
    st.slug = slug; st.projekt = p;
    if (slug !== null) ctx.schreiber.setze(slug, p.rev);
    $('leer').hidden = !!p;
    $('name').textContent = p ? p.name : 'No project';
    for (const h of ctx.beimProjekt) h(p, wechsel);
  }
  ctx.uebernimm = (slug, p) => { setzeProjekt(slug, p); for (const h of ctx.nachLaden) h(); };
  // Server weg (Status 0 oder 5xx): der gezeigte Stand bleibt, die Ansicht meldet es; kommt der Server wieder (SSE-Strom
  // verbindet neu), lädt ereignis() neu. Nur eine Antwort des Servers leert die Ansicht (laden.js).
  const ladeAktuell = neuerLader({
    hole: () => holeGet('/proj/aktuell'),
    uebernimm: (slug, p, j) => { ctx.uebernimm(slug, p); ctx.ausgabeLauf(j?.ausgabe_lauf ?? null); },   // V2 Fix F14: Lauf aus /proj/aktuell
    leere: (j) => { setzeProjekt(null, null); ctx.ausgabeLauf(j?.ausgabe_lauf ?? null); },
    // 7b: OFFLINE setzt holeGet (merkeAntwort); ein 5xx mit Grund behält den Stand und zeigt den Text des Grunds
    beiWeg: (r) => melde(antwortText(r), true),
    beiDa: () => setzeGetrennt(false),
  });
  ctx.ladeAktuell = ladeAktuell;
  let ladeUhr = 0;
  const planeLaden = () => { clearTimeout(ladeUhr); ladeUhr = setTimeout(ladeAktuell, 30); };

  // Schreibweg: nacheinander, mit rev (Spec 3.4); 409 rev_veraltet lädt neu
  ctx.schreiber = neuerSchreiber({
    holeJson,
    beiProjekt: (slug, p, rev, j) => { ctx.uebernimm(slug, p); const h = kernHinweis(j?.kern); if (h) melde(h, true); },
    // rev_veraltet: neu laden und das Promise zurückgeben, der Schreiber hält die Schlange bis der neue Stand gesetzt ist
    beiFehler: (a, r) => {
      melde(antwortText(r), true);
      if (r.status === 409 && r.j?.fehler === 'rev_veraltet') return ladeAktuell();
    },
    beiVerworfen: (n) => melde(`The project changed elsewhere: reloaded, ${n} waiting change${n === 1 ? '' : 's'} dropped, please repeat`, true),
  });
  ctx.aendere = (label, befehle, schluessel) => ctx.schreiber.aendere(label, befehle, schluessel);
  ctx.aendereMit = (rechne) => ctx.schreiber.aendereMit(rechne);   // V2 Fix F2: Zug beim Senden aus dem dann gültigen Stand
  // V2 Fix-Runde 2 H1 (Spec 6.34): jede Änderung, deren Befehle aus dem Projektstand folgen (Pfeiltasten, Quantisieren, Duplizieren, Umschalter …),
  // rechnet erst, wenn sie im Schreiber an der Reihe ist: rechne(p) → {label, befehle} | null aus genau dem Stand p, dessen rev mitgeht. Eine
  // Änderung davor, die noch unterwegs ist, steckt dann schon in p. Wechselt inzwischen das Projekt, geht nichts.
  ctx.aendereAus = (rechne) => {
    const slug = st.slug;
    return ctx.schreiber.aendereMit(() => {
      const p = st.projekt;
      if (!p || st.slug !== slug) return null;
      const x = rechne(p);
      return x ? { ...x, rev: p.rev } : null;
    });
  };

  for (const binde of BINDER) binde(ctx);

  function bild() {
    if (!st.sichtbar) { st.laeuft = false; return; }
    const t0 = performance.now();
    for (const h of ctx.vorBild) h(t0);
    for (const h of ctx.beimBild) h(t0);
    window.djkProdBild.push(performance.now() - t0); if (window.djkProdBild.length > 600) window.djkProdBild.shift();
    requestAnimationFrame(bild);
  }
  function zeige() {
    st.sichtbar = true;
    // Die Library sichtbar zu machen ist Sache von produktion.css (body.produktion); hier nur die Daten laden, falls noch keine da
    // sind. Kein Klick auf DJ-Bedienelemente: der schrieb djk-bereich in den Speicher und setzte den Fokus in #lib-suche.
    bibliothek?.();
    for (const h of ctx.beimSichtwechsel) h(true);
    ladeAktuell();
    if (!st.laeuft) { st.laeuft = true; requestAnimationFrame(bild); }
  }
  function verberge() { st.sichtbar = false; for (const h of ctx.beimSichtwechsel) h(false); }
  let standN = 0;
  function ereignis(a, f) {
    // Das Anfangsbild 'stand' kommt bei jedem (Wieder-)Verbinden des Stroms: nach einem Ausfall den Stand neu holen
    if (a === 'stand') { standN++; if (st.sichtbar && (st.getrennt || standN > 1)) planeLaden(); }
    // Die eigene Änderung kommt als SSE vor der HTTP-Antwort: dafür nicht nachladen (die Antwort bringt den Stand)
    if (a === 'proj' && st.sichtbar && !ctx.schreiber.istEigeneRev(f?.slug, f?.rev) && (f?.clip_id || f?.slug !== st.slug || f?.rev > (st.projekt?.rev ?? -1))) planeLaden();
    for (const h of ctx.beimEreignis) h(a, f);
  }
  setzeProjekt(null, null);
  return { zeige, verberge, ereignis };
}
