// djk MVP-Oberfläche (Scheibe 60m). Kein Ton: diese Seite erzeugt und spielt nie Audio.
// Öffnen sendet nichts an den Kern: gesendet wird nur auf einen Griff (Zeiger, Rad, Klick) oder LOAD.
// Lesen: /strom (Kern über den Seiten-Server), Leitstand-WS als Rolle "anzeige" (takt, ansage, ereignis).
import { bindeSpurbaender } from './track_tape_view.js';
import { bindeProduktion } from './production/production.js';
import { bindeWerkbank } from './werkbank/werkbank.js';
import { bindeTracker } from './tracker/tracker.js';
import { bindeModule } from './module_library.js';   // plan live-module task 10: the MODULES tab
import { bindeKopplung } from './coupling.js';   // task 10: pair a tablet (main page only)
import { DECKS } from './curves.js';
import { leitstand, strom, zeigeCypher } from './stream.js';
import { baueDecks, ladeBestand, zeigeDeck } from './deck_view.js';
import { baueLoopZuege, baueRec, ladeLoops, letzterBeat } from './loop_rec_view.js';
import { bindePlaetze } from './slots_view.js';
import { baueSeqPlaetze } from './seq_view.js';
import { $, $$, jsonPost, melde, zustand } from './page_state.js';
import { bindeLive, liveOeffnen, pruefeLive, pruefeLiveSpaeter } from './live_view.js';
import { bindeAnsicht, bindeMusterFeld, bindeReiter, bindeSchublade, bindeTablet, setzeProduktion, setzeWerkbank, setzeTracker, setzeAnsicht, meldeAnsicht } from './seitenrahmen.js';
import { bindeLibrary, bindeSets } from './library_view.js';
import { ladeBaum, markiereTyp } from './browse_detail.js';
import { bindeTempo } from './tempo_view.js';
import { bindeColor } from './color_view.js';
import { bindeEffekte, presetPanel, zeigePresets } from './effects_bindung.js';
import { controllerFenster, remixFenster } from './effects_gemeinsam.js';
import { bindeFensterFokus, fokus } from './controller_fokus.js';
import { zeigeCtlMarke } from './ctl_track_marker.js';
import { zeigeApcBank } from './apc_bank_marker.js';
import { stoebernLaden, stz } from './browse_table.js';
import { bindeRemixFenster } from './remix_window.js';
import { geraetFensterSpurId } from './device_open.js';
import { starteGeraetFenster } from './device_window.js';   // #geraet=<track id>: the device window of a project track
import { bindeStrudelSound } from './strudel_sound.js';
import { bindeFx, bindeFxZuweisung } from './beat_fx_view.js';
import { bindeKnoepfe, zeigeWert } from './controls_view.js';
import { ausgang, bild } from './output_view.js';
import { bindeLiveDock } from './live_dock/host.js';

// ---------- Aufbau: am Ende der Datei, nach allen Definitionen (dreimal am 2026-09-28 griff der Aufbau auf ein const,
// das weiter unten stand: Temporal Dead Zone; hier unten gilt jedes const der Datei schon) ----------
zeigeCypher();
baueDecks();
baueLoopZuege();
baueSeqPlaetze();   // the four SEQ nodes exist before the layout is applied
bindePlaetze();
bindeStrudelSound();   // SOUND column of the Strudel place, before the graph list arrives (zeigeGraphWahl fills its pickers)
for (const b of $$('[data-liveoeffnen]')) b.addEventListener('click', liveOeffnen);   // the only way the page opens the live container: a click, with the confirmation
baueRec();
bindeReiter();
bindeLibrary(); markiereTyp();

bindeSets();
bindeSchublade();
bindeTempo();
bindeColor();
bindeEffekte();
try { bindeLiveDock(); } catch (e) { console.error('Live dock:', e); }   // the EFFECTS tab of DJ and LIVE shows the dock (live_dock/host.js)
bindeMusterFeld();
try { bindeSpurbaender(jsonPost, () => letzterBeat); } catch (e) { console.error('Studio S7 lanes:', e); }   // Studio S7
if (!geraetFensterSpurId) try { setzeProduktion(bindeProduktion({ presetsZeigen: () => zeigePresets(), presetsNeu: () => presetPanel?.aktualisiereZiele(), presetListe: () => presetPanel?.z.liste ?? [], post: jsonPost, bpm: () => zustand.bpm ?? 128, stoebern: () => zustand.stoebern, bibliothek: () => { if (!stz.treffer.length) { stoebernLaden(); ladeBaum(); } } })); } catch (e) { console.error('Production view:', e); }   // D1 V1
if (!geraetFensterSpurId) try { setzeWerkbank(bindeWerkbank({ post: jsonPost, zeigeDj: () => { setzeAnsicht('dj'); pruefeLiveSpaeter(0); } })); } catch (e) { console.error('Workbench view:', e); }   // the fourth view, STUDIO; TO SEQ DECK: the DJ view then reads the changed live container
if (!geraetFensterSpurId) try { setzeTracker(bindeTracker({ post: jsonPost, zeigeDj: () => { setzeAnsicht('dj'); pruefeLiveSpaeter(0); } })); } catch (e) { console.error('Tracker view:', e); }   // the fifth view, TRACKER: the open project as rows
bindeAnsicht();
bindeTablet();
bindeRemixFenster();
if (geraetFensterSpurId) starteGeraetFenster(jsonPost);   // the device window follows the project on its own (the views above are not built: it shows no arrangement); before the focus sender below
// The synth in front goes to the page server (controller places that follow). Not from the Controllers window or the Remix window: they show no synth.
// The window sends what it shows again when it loads and when it gets the browser focus, so switching between two windows follows.
if (!controllerFenster && !remixFenster) { fokus.verbinde((f) => jsonPost('/controller/fokus', f)); bindeFensterFokus(); }
if (!geraetFensterSpurId && !controllerFenster && !remixFenster) {   // the APC20 bank frame at load; the view again on focus and every 20 s (a restarted page server forgets it)
  fetch('/controller/pult').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) zeigeApcBank(j); }, () => {});
  window.addEventListener('focus', () => meldeAnsicht(undefined, true));
  setInterval(() => meldeAnsicht(undefined, true), 20000);
}
if (!geraetFensterSpurId && !controllerFenster && !remixFenster) fetch('/controller/fokus').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) zeigeCtlMarke(j); }, () => {});   // the CTL mark on the track the controllers drive, before the first event
{ const reiter = $('[data-reiter="module"]'), tabelle = $('#module-tabelle'); if (reiter && tabelle) bindeModule({ reiter, tabelle, melde: (t) => melde(t) }); }   // task 10
{ const knopf = $('#kopplung-knopf'), dialog = $('#kopplung'); if (knopf && dialog) bindeKopplung({ knopf, dialog }); }   // task 10: the QR code of a one-time pairing link
bindeFx();
bindeFxZuweisung();
bindeKnoepfe();
for (const o of $$('[data-wert]')) zeigeWert(o.dataset.wert);
for (const k of $$('.schalter[data-pfad]')) zeigeWert(k.dataset.pfad);
for (const g of $$('.xzuweisung[data-pfad]')) zeigeWert(g.dataset.pfad);  // Vorgabe THRU blass, bis der Kern meldet
DECKS.forEach(zeigeDeck);
bindeLive();
pruefeLive();
ladeBestand().then(() => { DECKS.forEach(zeigeDeck); });
ladeLoops();
requestAnimationFrame(bild);
strom();
leitstand();
ausgang(); setInterval(ausgang, 1000);

