// Event stream handling: /strom dispatch, announcements, Cypher state, control desk socket.
import { DECKS, setzeZielKurve } from './curves.js';
import { mixAufnehmen, gateAufnehmen } from './effects.js';
import { kanalAnsicht } from './live_module.js';   // live modules task 4
import { cypherStand } from './messages.js';
import { live, liveEreignis, liveOffen, merkeArr, pruefeLiveSpaeter, zeichneLive } from './live_view.js';
import { produktion, werkbank, tracker } from './seitenrahmen.js';
import { $, BUCHSTABE, deckAnsicht, melde, zeigePruefmodus, zustand } from './page_state.js';
import { busMix, gateMix, zeigeBusMesser, zeigeGateMesser, zeigeMasterLimiter, zeigeWerkzeug } from './effects_view.js';
import { zeigeKeylock } from './tempo_view.js';
import { GRUND_TEXT, eintragVon, zeigeDeck, zeigePegel, zeigeSchlag } from './deck_view.js';
import { fxRoutingVomKern, fxVomKern, fxZuweisungVomKern } from './beat_fx_view.js';
import { bkMarkeSpaeter, holeBkSpaeter, setzeGraphenGeladen } from './graphs_view.js';
import { lernEreignis, zeigeSendKnobs } from './learn_view.js';
import { registerHand, registerFokus } from './register_view.js';
import { fokus } from './controller_fokus.js';
import { geraetFensterEreignis } from './device_window.js';
import { zeigeCtlMarke } from './ctl_track_marker.js';
import { zeigeApcBank } from './apc_bank_marker.js';
import { spurHandEcho } from './production/track_heads.js';
import { zeilenEcho } from './production/device_view.js';
import { ladeLoops, recAktiv, recEnde, setzeLetzterBeat, taktText, uhrKopf, zeigeRec } from './loop_rec_view.js';
import { zeigeWert } from './controls_view.js';
import { zeigeColor } from './color_view.js';
import { remixFp } from './remix_window.js';
import { kompPegelAufnehmen } from './face/comp.js';
import { instrumenteSichtbar, kompGr, kompPegel, spektrumAnsichten, spektrumLeihe, spektrumNachsehen } from './effects_gemeinsam.js';
import { holeHotcues, holeRaster } from './deck_griffe.js';
import { instrumenteAnsicht } from './effects_bindung.js';
import { leitstandZaehlt, proTaktJetzt, setzeProTakt, takteProLive, zaehlerVon } from './bar_live.js';
import { zeichneSeq } from './seq_view.js';

// Demo overlay: the line "what Cypher is doing now" (POST /ansage). It stays while the text is new and fades after a
// reading time (4 s plus 60 ms per character); an empty line (f null) hides it at once.
let ansageFrist = null;
function zeigeAnsage(f) {
  let el = document.getElementById('demo-ansage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'demo-ansage';   // not 'ansage': that id is the control centre's event line in the header
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="ansage-wer">CYPHER</span><span class="ansage-text"></span>';
    document.body.appendChild(el);
  }
  clearTimeout(ansageFrist);
  if (!f || !f.text) { el.classList.remove('an'); return; }
  el.querySelector('.ansage-text').textContent = f.text;
  el.dataset.art = f.art || 'tat';
  el.classList.add('an');
  const alter = Date.now() - (f.zeit || Date.now());
  ansageFrist = setTimeout(() => el.classList.remove('an'), Math.max(0, 4000 + 60 * f.text.length - alter));
}

// studio-taktart: the page counts bars of the open project's meter n/4 (bar_live.js); it learns it from /lage and from the SSE event `taktart`.
function uebernimmTaktart(n) {
  const alt = proTaktJetzt();
  if (setzeProTakt(n) !== alt) { zeichneSeq(); zeigeCypher(); }
}
async function holeTaktart() {
  try { uebernimmTaktart(takteProLive((await (await fetch('/lage')).json()).taktart)); } catch { /* the counter stays as it was */ }
}

export function strom() {
  const q = new EventSource('/strom');
  q.onmessage = (m) => {
    const { a, f } = JSON.parse(m.data);
    try { produktion?.ereignis(a, f); } catch (e) { console.error('Production view:', e); }   // D1 V1: proj, /zustand/arr; ein Fehler dort hält die DJ-Anzeige nicht an
    try { werkbank?.ereignis(a, f); } catch (e) { console.error('Workbench view:', e); }   // like the line above: an error there does not stop the DJ display
    try { tracker?.ereignis(a, f); } catch (e) { console.error('Tracker view:', e); }   // like the lines above
    try { geraetFensterEreignis(a, f); } catch (e) { console.error('Device window:', e); }   // the #geraet window mode (no-op elsewhere)
    if (a === '/zustand/arr') { merkeArr(f); zeigeMasterLimiter(f); }   // the loop slots follow the transport of the live container; the MASTER tab's LIMITER meter reads limiter_db
    switch (a) {
      case 'stand':
        Object.assign(zustand.regler, f.regler);
        for (const [n, z] of Object.entries(f.decks)) zustand.decks[n] = z;
        for (const [n, g] of Object.entries(f.geladen)) zustand.geladen[n] = g.material_id;
        for (const p of Object.keys(f.regler)) zeigeWert(p);
        zeigeWerkzeug();   // A8: a state (load, reconnect) fills the Gate/Utility strips; they have no polling like the compressor
        if ('spektrum/kanal' in f.regler) { for (const a of spektrumAnsichten) a.setzeQuelle(f.regler['spektrum/kanal']); spektrumLeihe.beiStand(f.regler['spektrum/kanal']); }   // A7b; a key left by a reload while the device page was open
        zeigeKeylock();   // Keylock 3
        DECKS.forEach(zeigeDeck); pruefeLiveSpaeter(0);   // live modules: the stream (re)connects, read the live container again
        for (const [n, l] of Object.entries(f.loops ?? {})) zustand.loops[n] = l;
        if (Array.isArray(f.fx)) f.fx.forEach((x, u) => { if (x) fxVomKern(u, x); });
        if (f.fxZuweisung) f.fxZuweisung.forEach((m, u) => { for (const [kanal, an] of Object.entries(m)) fxZuweisungVomKern(u, kanal, an ? 1 : 0); });
        if (f.fxRouting) fxRoutingVomKern(f.fxRouting === 'insert' ? 1 : 0);
        if (f.graphen_geladen) setzeGraphenGeladen(f.graphen_geladen);   // S12
        $('#v-kern').classList.toggle('an', f.kern === 'verbunden');
        zeigePruefmodus(f.pruefmodus);
        holeTaktart();   // the page may load after a meter change: /lage carries `taktart` only when it is not 4/4
        break;
      case 'taktart': uebernimmTaktart(f.proTakt); break;   // studio-taktart: the open project's meter changed (only sent when it is not 4/4 or leaves it)
      case 'ansage': zeigeAnsage(f); break;   // demo overlay (POST /ansage)
      case 'graphen': setzeGraphenGeladen(f.geladen); break;   // S12
      case 'lernen': lernEreignis(f); break;   // S19
      case 'controller_fokus': fokus.vomServer(f); registerFokus(f); zeigeCtlMarke(f); break;
      case 'pult': zeigeApcBank(f); break;   // the APC20 bank in PRODUCTION (areas/controller/pult_production.ts)   // the synth in front or what a controller place applied changed (page server, body of GET /controller/fokus)
      case '/e/hand': registerHand(String(f.pfad ?? '')); break;   // a controller moved a control: the Controllers window marks its row
      case 'proj': holeBkSpaeter(); liveEreignis(a, f); break;   // S17: the project changed or was opened; live modules task 4: the panel follows
      case 'modul': liveEreignis(a, f); break;   // live modules task 4: slot state of the module export (separation)
      case 'seq': liveEreignis(a, f); break;   // SEQ deck: a step or the deck itself was written ({platz, rev})
      case 'pruefmodus': zeigePruefmodus(f.stand); break;
      case 'kern': $('#v-kern').classList.toggle('an', f.zustand === 'verbunden'); break;
      case '/uhr':
        $('#v-kern').classList.add('an');
        zeigeSchlag(f.beat);
        uhrKopf.melde(f.beat, f.bpm, performance.now(), true);
        setzeLetzterBeat(f.beat); zeigeRec(f.beat);
        if (!taktVomLeitstand || !leitstandZaehlt(proTaktJetzt())) { const z = zaehlerVon(f.beat, proTaktJetzt()); $('#takt').textContent = z.takt; $('#phrase').textContent = z.phrase; }
        if (document.activeElement !== $('#bpm')) $('#bpm').value = f.bpm.toFixed(2);
        if (zustand.bpm !== f.bpm) { zustand.bpm = f.bpm; DECKS.forEach(zeigeDeck); }
        break;
      case '/e/regler':
        zustand.regler[f.pfad] = f.wert; zeigeWert(f.pfad);
        if (/^pad\/[12]\/(fader|trim)$/.test(f.pfad) && liveOffen()) {   // the channel state of a slot (Loop 1, Loop 2) follows the strip: redraw only when it flips
          const k = `${kanalAnsicht('A', zustand.regler).offen}${kanalAnsicht('B', zustand.regler).offen}`;
          if (k !== live.kanal) { live.kanal = k; zeichneLive(); }
        }
        if (/\/bk\/([1-9]|[1-5][0-9]|6[0-4])$/.test(f.pfad)) bkMarkeSpaeter();   // S17: the saved/differs marker follows the graph knobs
        if (f.pfad === 'keylock') { zeigeKeylock(); DECKS.forEach(zeigeDeck); }   // Keylock 3: Taste und VARI
        if (f.pfad === 'color/art' || f.pfad === 'color/param') zeigeColor();
        if (f.pfad === 'spektrum/kanal') for (const a of spektrumAnsichten) a.setzeQuelle(f.wert);   // A7b
        { const m = /^(.+?\/\d)\/(?:gate|util|mb|lim)\/[\w/]+$/.exec(f.pfad); if (m) zeigeWerkzeug(m[1]); }   // A8, A8b (bus multiband and limiter)
        if (/^fx\/[34]\/bk\//.test(f.pfad)) zeigeSendKnobs();   // S14: the send-return knobs follow the echo (also a move by Cypher)
        if (/^master\/bk\//.test(f.pfad)) zeigeSendKnobs();   // the knobs of the master insert (MASTER tab, same row type) follow it too
        { const m = /^(.+)\/bk\/([1-9]|[1-5][0-9]|6[0-4])$/.exec(f.pfad); if (m && instrumenteSichtbar() && m[1] === instrumenteAnsicht.gewaehlt()) instrumenteAnsicht.aktualisiere(); }   // ... and the panel in INSTRUMENTS
        if (f.halter === 'mensch') spurHandEcho(f.pfad, f.wert);   // a hand moved a track fader or pan: the PRODUCTION heads show it at once
        if (/^spur\/\d+\/bk\/\d+$/.test(f.pfad)) zeilenEcho(f.pfad);   // P2: the device panel of a track follows its row (a controller moved it)
        if (remixFp && /\/bk\/\d+$/.test(f.pfad)) remixFp.aktualisiere();   // the REMIX panel follows the knob echo of its target
        break;
      case '/zustand/spektrum':   // A7b: 25 Hz while a source is selected
        { let neu = false; for (const a of spektrumAnsichten) if (a.aufnehmen(f)) neu = true; if (neu) spektrumNachsehen(); }
        break;
      case '/zustand/komp':
        kompGr[f.kanal] = { db: Number(f.gr_db), t: performance.now() };
        break;
      case '/e/stufe_pegel':   // device faces T9: the channel compressor's input and output peak (the insert stages' reports are taken in production/inserts.js)
        kompPegelAufnehmen(kompPegel, f, performance.now());
        break;
      case '/zustand/mix':   // A8b (D10): gain reduction of the bus tools; A6: the server passes the address on, the kern sends it, gate_db feeds the source strips
        if (mixAufnehmen(busMix, f, performance.now())) zeigeBusMesser();
        if (gateAufnehmen(gateMix, f, performance.now())) zeigeGateMesser();   // A6: gate_db of a source channel
        break;
      case '/zustand/deck':
        zustand.decks[f.deck] = f;
        deckAnsicht[f.deck]?.kopf.melde(f.quell_beat, zustand.bpm ?? 128, performance.now(), f.status >= 2);
        if (deckAnsicht[f.deck]) zeigeDeck(f.deck);
        break;
      case '/e/hotcue': if (deckAnsicht[f.deck]) holeHotcues(f.deck); break;   // Plan E9
      case '/e/raster': if (deckAnsicht[f.deck]) holeRaster(f.deck); break;     // Plan Grid
      case '/e/fx': fxVomKern(Number(f.einheit) - 1, f); break;
      case '/e/fx/zuweisung': fxZuweisungVomKern(Number(f.einheit) - 1, String(f.kanal), Number(f.an)); break;
      case '/e/fx/routing': fxRoutingVomKern(Number(f.routing)); break;
      case '/e/geladen': {
        zustand.geladen[f.deck] = f.material_id;
        (zustand.geladenFelder ??= {})[f.deck] = f;
        delete zustand.decks[f.deck];
        const e = eintragVon(f.material_id);
        melde(`Deck ${BUCHSTABE[f.deck] ?? f.deck}: “${e?.titel ?? f.material_id}” loaded`);
        const d = $(`.deck[data-deck="${f.deck}"]`);
        if (deckAnsicht[f.deck]) deckAnsicht[f.deck].id = null;
        if (deckAnsicht[f.deck]) zeigeDeck(f.deck);
        break;
      }
      case '/q': {
        const eig = zustand.eigeneLaden.get(f.id);
        if (eig && f.status === 6) melde(`Load to deck ${BUCHSTABE[eig.deck]} refused: ${GRUND_TEXT[f.grund] ?? f.grund}`, true);
        break;
      }
      case '/pegel': zeigePegel(f.kanal, f.spitze_db); break;
      case '/e/loop': {
        zustand.loops[f.box] = f;
        break;
      }
      case '/e/mitschnitt':
        if (f.name === recAktiv) recEnde(f.status === 0);  // ein fremder REC (Cypher) beendet den eigenen nicht
        melde(f.status === 0 ? `Loop “${f.name}” recorded (${taktText(f.beats)})`
          : `Recording “${f.name}” failed`, f.status !== 0);
        if (!$('[data-tabelle="loops"]').hidden) ladeLoops();
        break;
      case '/e/neustart': zustand.loops = {}; recEnde(); break;  // REC: Puffer starb mit dem Kern
      case '/e/protokollfehler': melde(`Core rejected ${f.adresse}: ${f.grund}`, true); break;
      default: break;
    }
  };
  q.onerror = () => $('#v-kern').classList.remove('an');
}

// ---------- Leitstand (nur lesend, Rolle anzeige, §9.2) ----------
const NB = ['core is back', 'EMERGENCY LOOP playing', 'emergency loop faded out', 'handing back to the core'];
function englisch(e) {
  switch (e.art) {
    case 'geladen': return [`deck ${BUCHSTABE[e.deck] ?? e.deck} loaded “${eintragVon(e.material_id)?.titel ?? e.material_id}”`, 'info'];
    case 'neustart': return [`core restarted (generation ${e.generation})`, 'warnung'];
    case 'luecke': return [`core dropout, ${e.frames} frames`, 'warnung'];
    case 'rueckfall': return [`fallback loop deck ${BUCHSTABE[e.deck] ?? e.deck} ${e.an === 1 ? 'on' : 'off'}`, 'warnung'];
    case 'notbahn': return [NB[e.zustand] ?? `emergency path ${e.zustand}`, e.zustand === 0 ? 'info' : 'warnung'];
    case 'plan_vorgeschlagen': return [`Cypher proposes: ${e.vorschlag.text}`, 'info'];
    case 'vorschlag_angenommen': return ['proposal accepted', 'info'];
    case 'vorschlag_verworfen': return ['proposal rejected', 'info'];
    case 'vorschlag_verfallen': return ['proposal expired', 'warnung'];
    case 'ki_stopp': return [e.gestoppt === 1 ? 'Cypher stopped' : 'Cypher released', 'warnung'];
    case 'invariante': return [`safety rule ${e.invariante} held a plan`, 'warnung'];
    default: return null;
  }
}
let leitstandDa = false;
// Cyphers Vorschlag und Stopp-Taste (Plan M-1 Annahme-Weg): die Seite zeigt den offenen Vorschlag und schickt Andreas' Taste an den Kern
let cypherLage = { vorschlag: null, gestoppt: false };
export function zeigeCypher() {
  const v = cypherLage.vorschlag;
  $('#vorschlag').hidden = !v;
  if (v) $('#vorschlag').textContent = `Cypher proposes (bar ${Math.floor(v.start_beat / proTaktJetzt()) + 1}): ${v.text}`;
  $('#t-annehmen').hidden = !v; $('#t-verwerfen').hidden = !v;
  $('#t-stopp').hidden = cypherLage.gestoppt; $('#t-freigabe').hidden = !cypherLage.gestoppt;
}
async function sendeTaste(name) {
  const r = await fetch('/taste', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); melde(`Key “${name}” not sent: ${j.text ?? j.fehler ?? r.status}`, true); }
}
for (const n of ['annehmen', 'verwerfen', 'stopp', 'freigabe']) $(`#t-${n}`).addEventListener('click', () => sendeTaste(n));
function cypherEreignis(e) {
  const neu = cypherStand(cypherLage, e);
  if (neu) { cypherLage = neu; zeigeCypher(); }
}
let taktVomLeitstand = false; // BAR/PHRASE aus dem Takt-Strom (§9.3), bis dahin aus /uhr
export async function leitstand() {
  const k = await (await fetch('/konfig')).json();
  if (k.ziel_kurve) setzeZielKurve(k.ziel_kurve);   // Kern oder Attrappe: was der Server meldet, rechnet die Seite
  let seq = 0;
  const verbinde = () => {
    const ws = new WebSocket(k.leitstand_ws);
    ws.onopen = () => ws.send(JSON.stringify({ v: 1, seq: ++seq, von: 'anzeige', typ: 'hallo',
      zeit: { sample: 0, beat: 0, takt: 1, phrase: 1 }, daten: { rolle: 'anzeige', name: 'oberflaeche', protokoll: 1 } }));
    ws.onmessage = (m) => {
      const n = JSON.parse(m.data);
      if (n.typ === 'willkommen') { leitstandDa = true; $('#v-leitstand').classList.add('an'); }
      if (n.typ === 'takt') { taktVomLeitstand = true; if (leitstandZaehlt(proTaktJetzt())) { $('#takt').textContent = n.daten.takt; $('#phrase').textContent = n.daten.phrase; } }   // the conductor counts 4
      // Die Ansage-Sätze des Leitstands sind deutsch (ADR 019); die Seite ist englisch und sagt Ereignisse selbst an
      if (n.typ === 'ereignis') cypherEreignis(n.daten);
      if (n.typ === 'ereignis') { const t = englisch(n.daten); if (t) { const a = $('#ansage'); a.textContent = `Bar ${n.daten.takt}: ${t[0]}`; a.className = `ansage ${t[1]}`; } }
    };
    ws.onclose = () => { cypherLage = { ...cypherLage, vorschlag: null }; zeigeCypher(); leitstandDa = false; taktVomLeitstand = false; seq = 0; $('#v-leitstand').classList.remove('an'); setTimeout(verbinde, 2000); };
  };
  verbinde();
}
