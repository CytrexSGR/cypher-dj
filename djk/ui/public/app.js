// djk MVP-Oberfläche (Scheibe 60m). Kein Ton: diese Seite erzeugt und spielt nie Audio.
// Öffnen sendet nichts an den Kern: gesendet wird nur auf einen Griff (Zeiger, Rad, Klick) oder LOAD.
// Lesen: /strom (Kern über den Seiten-Server), Leitstand-WS als Rolle "anzeige" (takt, ansage, ereignis).
import { bindeSpurbaender } from './track_tape_view.js';
import { bindeProduktion } from './production/production.js';
import { bindeModule } from './module_library.js';   // plan live-module task 10: the MODULES tab
import { bindeKopplung } from './coupling.js';   // task 10: pair a tablet (main page only)
import { DECKS } from './curves.js';
import { leitstand, strom, zeigeCypher } from './stream.js';
import { baueDecks, ladeBestand, zeigeDeck } from './deck_view.js';
import { baueLoopZuege, baueRec, ladeLoops, letzterBeat } from './loop_rec_view.js';
import { bindePlaetze } from './slots_view.js';
import { baueSeqPlaetze } from './seq_view.js';
import { $, $$, jsonPost, melde, zustand } from './page_state.js';
import { bindeLive, liveOeffnen, pruefeLive } from './live_view.js';
import { bindeAnsicht, bindeMusterFeld, bindeReiter, bindeSchublade, bindeTablet, setzeProduktion } from './seitenrahmen.js';
import { bindeLibrary, bindeSets } from './library_view.js';
import { ladeBaum, markiereTyp } from './browse_detail.js';
import { bindeTempo } from './tempo_view.js';
import { bindeColor } from './color_view.js';
import { bindeEffekte, presetPanel, zeigePresets } from './effects_bindung.js';
import { stoebernLaden, stz } from './browse_table.js';
import { bindeRemixFenster } from './remix_window.js';
import { bindeStrudelSound } from './strudel_sound.js';
import { bindeFx, bindeFxZuweisung } from './beat_fx_view.js';
import { bindeKnoepfe, zeigeWert } from './controls_view.js';
import { ausgang, bild } from './output_view.js';

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
bindeMusterFeld();
try { bindeSpurbaender(jsonPost, () => letzterBeat); } catch (e) { console.error('Studio S7 lanes:', e); }   // Studio S7
try { setzeProduktion(bindeProduktion({ presetsZeigen: () => zeigePresets(), presetsNeu: () => presetPanel?.aktualisiereZiele(), presetListe: () => presetPanel?.z.liste ?? [], post: jsonPost, bpm: () => zustand.bpm ?? 128, stoebern: () => zustand.stoebern, bibliothek: () => { if (!stz.treffer.length) { stoebernLaden(); ladeBaum(); } } })); } catch (e) { console.error('Production view:', e); }   // D1 V1
bindeAnsicht();
bindeTablet();
bindeRemixFenster();
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

