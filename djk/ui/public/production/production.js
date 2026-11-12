// PRODUCTION-Ansicht (D1, Paket V1; Spec 2.11, 3.3, 3.4, A1, A2 ohne Clip-Bearbeitung, A5- und A6-Bedienung).
// Wurzel des gekapselten Moduls: app.js ruft bindeProduktion() einmal auf und reicht Ansichtswechsel (zeige/verberge)
// und jede Nachricht aus /strom (ereignis) herein. Die Teile (BINDER) docken nur über ctx an: Haken beimProjekt,
// nachLaden, vorBild, beimBild, beimEreignis, beimSichtwechsel. Spricht nur die Projekt-API (Spec 3.4); der Wechsel
// der Ansicht schickt nichts an den Kern (A1). Oberfläche englisch. Gezeichnet wird nur, solange die Ansicht sichtbar
// ist (eigener rAF-Takt, Ring window.djkProdBild wie window.djkBild).
import { UEBER_FARBE, setzeKettenZiele } from './lanes.js';
import { menueOffen } from './context_menu.js';
import { REGLER_MAX, REGLER_SCHRITT } from './fader_curve.js';
import { neuerSchreiber } from './writer.js';
import { neuerLader, neuerNachlader, serverWeg, offlineNach } from './load.js';
import { bindeZeitachse } from './timeline_operation.js';
import { bindeProjektwahl } from './project_choice.js';
import { bindeSpuren } from './track_heads.js';
import { armStand } from './auto_recording.js';
import { bindeGruppen } from './groups.js';
import { bindeReturns } from './returns.js';
import { bindeInserts } from './inserts.js';
import { bindeMatrix } from './matrix.js';   // 1.10 slice 6: routing matrix view
import { MAX_SPUREN } from './limits.js';
import { bindeAblage } from './storage.js';
import { bindeBrowserwahl } from './browser_choice.js';      // 1.16 rest: browser mode switch
import { bindeGeraeteBrowser } from './devices_browser.js';   // 1.16 rest: DEVICES list
import { bindePresetMarken } from './preset_marker.js';   // 1.16 rest U7: origin mark of a stage / device
import { bindePresetHost } from './preset_host.js';   // 1.16 rest U7: host of the PRESETS panel in PRODUCTION
import { bindeKollektionen } from '../collections.js';   // 1.16 rest U8: the COLLECTIONS panel and "Add to collection"
import { bindeTransport } from './transport.js';
import { bindeVerlauf } from './history_display.js';
import { bindeClips } from './clip_operation.js';
import { bindeLanen } from './lanes_operation.js';
import { bindeComp } from './takes_operation.js';
import { bindeDetail } from './detail.js';
import { bindeAusgabe } from './freeze_export.js';
import { bindeMidiImport, MIDI_FEHLER } from './midi_import.js';
import { bindeVariantenReihen } from './variants.js';
import { bindeGeraete } from './devices.js';
import { bindeAufnahme } from './recording.js';
import { AUSGABE_FEHLER, mehrdeutigText } from './output.js';
import { nachladenNoetig, stemsEreignis, stemsFuerProjekt } from './stems.js';

const BINDER = [bindeZeitachse, bindeProjektwahl, bindeSpuren, bindeGruppen, bindeReturns, bindeMatrix, bindeInserts, bindeAblage, bindeTransport, bindeVerlauf, bindeLanen, bindeComp, bindeClips, bindeDetail, bindeAusgabe, bindeMidiImport, bindeVariantenReihen, bindeGeraete, bindeAufnahme,
  bindeBrowserwahl, bindeGeraeteBrowser, bindePresetHost, bindePresetMarken, bindeKollektionen];

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
  <div class="p-gruppe p-aufnahme" role="group" aria-label="Recording settings">
    <label for="p-vorzaehler">COUNT-IN</label><select id="p-vorzaehler" data-p="vorzaehler" title="Count-in before a recording starts (bars)" disabled><option value="0">Off</option><option value="1">1 bar</option><option value="2">2 bars</option><option value="4">4 bars</option></select>
    <button data-p="punch-ein" aria-pressed="false" title="Punch in: the take is cut at the start of the punch range (the raw file is kept)" disabled>PUNCH IN</button>
    <button data-p="punch-aus" aria-pressed="false" title="Punch out: the take is cut at the end of the punch range (the raw file is kept)" disabled>PUNCH OUT</button>
    <label for="p-punch-von">BAR</label><input id="p-punch-von" data-p="punch-von" class="p-takt" inputmode="numeric" size="3" autocomplete="off" title="Punch range: first bar" aria-label="Punch from bar" disabled>
    <label for="p-punch-bis">TO</label><input id="p-punch-bis" data-p="punch-bis" class="p-takt" inputmode="numeric" size="3" autocomplete="off" title="Punch range: last bar (it is included)" aria-label="Punch to bar" disabled>
    <button data-p="overdub" aria-pressed="false" title="Overdub: a MIDI recording adds notes to the clip instead of replacing the range (audio always replaces the range)" disabled>OVERDUB</button>
  </div>
  <div class="p-gruppe">
    <label for="p-tempo">TEMPO</label><input id="p-tempo" data-p="tempo" inputmode="decimal" size="6" autocomplete="off" title="Project tempo, 60 to 200 BPM: Enter sets it" disabled>
    <button data-p="loop" aria-pressed="false" title="Loop the bracket in the ruler" disabled>LOOP</button>
    <button data-p="metronom" aria-pressed="false" title="Metronome" disabled>METRO</button>
    <span class="p-autotitel" title="Automation recording: arm tracks with AUTO ● in the track head, play, and move a fader, pan, M or S">AUTO</span><button data-p="auto-touch" class="p-automodus" aria-pressed="true">TOUCH</button><button data-p="auto-latch" class="p-automodus" aria-pressed="false">LATCH</button><button data-p="auto-write" class="p-automodus" aria-pressed="false">WRITE</button>
    <button data-p="re-enable" class="p-reenable" title="Give every lane that you took over by hand back to its automation" disabled>RE-ENABLE AUTOMATION</button>
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
    <button data-p="neu-audio" title="Add an audio track" disabled>+ AUDIO</button><button data-p="neu-rb" title="Add an instrument track with the RB-338" disabled>+ RB-338</button><button data-p="neu-surge" title="Add an instrument track with Surge (host slot 1 or 2)" disabled>+ SURGE</button><button data-p="neu-rack" title="Add an instrument track with a rack: up to 4 devices side by side, each with key, velocity and chain zones" disabled>+ RACK</button><button data-p="neu-kit" title="Add an instrument track that plays a kit from the kit folder (pick the kit)" disabled>+ KIT</button>
  </div>
  <canvas class="p-lineal" data-p="lineal" title="Top strip: drag the loop bracket · bottom strip: click sets the start marker"></canvas>
  <div class="p-koerper" data-p="koerper">
    <div class="p-koepfe" data-p="koepfe"></div>
    <div class="p-flaeche" data-p="flaeche"><canvas class="p-spuren" data-p="spuren"></canvas><canvas class="p-ueber" data-p="ueber" title="Click: start marker · wheel: scroll · Ctrl+wheel: zoom · Shift+wheel: tracks"></canvas></div>
  </div>
  <div class="p-hleiste" data-p="hleiste" title="Scroll the arrangement"><div data-p="hleiste-inhalt"></div></div>
  <div class="p-leer" data-p="leer">No project open. NEW starts one, OPEN loads one.</div>
</div>
<section class="p-mixer" data-p="mixer" aria-label="Groups and master" hidden>
  <div class="p-mixer-kopf"><span class="p-mixer-titel">GROUPS</span><button data-p="neu-gruppe" title="Add a group track (up to 8); put tracks into it with the output menu of each track" disabled>+ GROUP</button></div>
  <div class="p-gruppenreihe" data-p="mixer-gruppen"></div>
  <div class="p-pm" aria-label="Production master">
    <span class="p-mixer-titel">MASTER</span>
    <input class="p-pm-fader" data-p="pm-fader" type="range" min="0" max="${REGLER_MAX}" step="${REGLER_SCHRITT}" title="Production master volume (double click: 0 dB). The export is taken here, before the set limiter." aria-label="Volume production master">
    <output class="p-pm-wert" data-p="pm-wert"></output>
    <div class="meter waagrecht p-pm-pegel" data-kanal="pm"><i></i></div>
  </div>
</section>
<section class="p-returns p-mixer" data-p="returns" aria-label="Returns and sends" hidden>
  <div class="p-mixer-kopf"><span class="p-mixer-titel">RETURNS</span><button data-p="neu-return" title="Add a return strip with Cypher Hall (up to 4)" disabled>+ Return: Hall</button></div>
  <div class="p-gruppenreihe" data-p="mixer-returns"></div>
  <details class="p-sendblock" data-p="sends" hidden><summary class="p-mixer-titel">SENDS</summary><div class="p-sendraster" data-p="mixer-sends"></div></details>
</section>
<details class="p-matrix p-mixer" data-p="matrix" aria-label="Routing matrix" hidden>
  <summary class="p-mixer-titel">ROUTING MATRIX</summary>
  <div class="p-mx-status" data-p="matrix-status" role="status"></div>
  <div class="p-mx-rolle" data-p="matrix-tabelle"></div>
</details>
<details class="p-inserts p-mixer" data-p="inserts" aria-label="Insert chains" hidden>
  <summary class="p-mixer-titel" data-p="inserts-titel">INSERTS</summary>
  <div class="p-insertliste" data-p="inserts-liste"></div>
</details>
<details class="p-geraete" data-p="geraete"><summary>INPUTS</summary><div data-p="geraete-liste" role="group" aria-label="Audio and MIDI inputs"></div></details>
<section class="p-detail" data-p="detail" aria-label="Detail"><div class="p-detail-kopf">CLIP</div><div class="p-detail-leer">No clip selected.</div></section>`;

// 1.12 S3: events after which the list of overridden lanes is fetched again. /e/neustart and /k/willkommen: a new core generation clears the server
// mirror without any /e/auto, so the page would keep a stale orange. Only a visible page reloads (a hidden one loads in zeige()).
export const LADE_EREIGNISSE = new Set(['/e/auto', '/e/neustart', '/k/willkommen']);
export const ladeNachEreignis = (a, sichtbar) => !!sichtbar && LADE_EREIGNISSE.has(a);

// Texte zu den Gründen der Projekt-API: die Gründe aus S2-Kern (project/commands.ts, history.ts) und Spec 3.4. Fehlt einer,
// zeigt die Seite „Rejected: <code>“ (tests/production_root.test.mjs hält die Liste beisammen).
export const FEHLER_TEXT = {
  ...MIDI_FEHLER,   // MIDI import (midi_import.js)
  veraltet: 'The clip changed while separating: nothing was placed',
  audio_fehlt: 'An audio clip is still being prepared: try again in a moment',
  stems_laeuft: 'A stem separation is already running',
  stems_nur_gpu: 'Stems run on the GPU only',
  gpu_belegt: 'The GPU is busy (4.5 GB free needed): nothing was changed, try again later',
  keine_gpu: 'No GPU available for stems: nothing was changed',
  stems_fehler: 'The stem separation failed: nothing was changed',
  stems_loop: 'Switch the clip loop off before separating stems',
  stems_zu_gross: 'The range to separate is longer than 600 s: choose a shorter range',
  stems_zeitlimit: 'The stem separation took too long and was stopped: nothing was changed',
  abbruch: 'The stem separation was cancelled',
  zu_spaet: 'The stems are already placed: use undo to remove them',
  kein_kernstand: 'The core has not reported its state yet: try again in a moment',
  nur_andreas: 'Only Andreas may do this',
  auto_ziel_unbekannt: 'The lane field is none of fader, pan, mute, solo',
  auto_abgelehnt: 'The core refused the lane override',
  nur_andreas_spur: 'This track belongs to Andreas: Cypher may not separate it',
  kein_auftrag: 'No stem separation with this id is running',
  mehrere_clips: 'Exactly one audio clip must lie in the range',
  zu_viele_spuren: 'Separating stems needs four free tracks',
  merge_leer: 'The tracks play nothing in this range',
  merge_gruppen: 'The tracks feed different groups: merge or bounce tracks of one group',
  merge_teil_solo: 'Some of the tracks are solo: solo all of them or none',
  merge_sends: 'The tracks have different sends: give them identical sends or none',
  merge_inserts: 'A track has an insert chain: remove the inserts and merge or bounce again',
  merge_freeze_noetig: 'A Surge track has unfrozen notes: freeze it first',
  merge_andreas_spur: 'This track belongs to Andreas: Cypher may not merge or bounce it',
  merge_keine_spur_frei: 'Merging or bouncing needs one free track',
  resample_leer: 'That strip is silent in the range (muted or empty): nothing was resampled',
  resample_fehler: 'Resampling failed in the core: nothing was saved',
  bounce_nur_audio: 'Only an audio track can be bounced in place: use Bounce to New Track, or Freeze for a Surge track',
  bounce_ziel_art: 'Bounced audio can only be pasted onto an audio track',
  export_bereich: 'The range must be 1 to 1024 beats long, starting at beat 0 or later',
  rev_veraltet: 'The project changed elsewhere: reloaded, please repeat',
  regler_abgelehnt: 'The core refused a mixer change: nothing was changed',
  auto_an_nicht_quittiert: 'The core did not confirm the automation override: the take may be missing it',
  projekt_gewechselt: 'The project was switched meanwhile: the action was dropped',
  nichts_zu_tun: 'Nothing to undo or redo', kein_projekt: 'No project open', unbekannt: 'No such project', name_ungueltig: 'A project name needs 1 to 80 characters',
  ki_gestoppt: 'Stop Cypher is set', ki_stopp: 'Stop Cypher was pressed: the start was dropped', deck_laeuft: 'A deck is playing: the tempo stays until it stops', nicht_geladen: 'The core has no arrangement loaded yet',
  live_laeuft: 'The live container is playing while a deck plays: opening another project would stop it',
  kein_loop: 'The deck has no active loop to export', kein_bibliothekstrack: 'The deck track is not a library track', kein_liveprojekt: 'The live container is not open',
  kein_liveprojekt_flag: 'A project named live exists without the live flag: rename it',
  slot_leer: 'That live slot holds no module', modul_hat_stems: 'That module already has its stems',
  modul_unbekannt: 'No module with that id is saved', modul_nicht_einsetzbar: 'This module holds something the project cannot take',   // task 10
  rampe_laeuft: 'That live slot is already being cleared or blended', kein_neuer_pfad: 'That stem has no new instrument path to blend to',
  unbekanntes_deck: 'There is no such deck',
  kein_deck: 'No deck is playing on the master, so there is no key to adapt to', tonart_unbekannt: 'The key of the module or of the deck is unknown',
  zu_gross: AUSGABE_FEHLER.zu_gross, server_fehler: 'The project server did not answer: showing the last state', netz: 'Page server unreachable', keine_antwort: 'No answer from the core',
  routing_zyklus: 'A group cannot feed itself or one of its own members', routing_grenze: 'There are at most 16 groups and 4 returns',
  ziel_unbekannt: 'That output or target does not exist for this track', gruppe_unbekannt: 'That group no longer exists', return_unbekannt: 'That return no longer exists',
  insert_unbekannt: 'That insert stage no longer exists', art_unbekannt: 'That insert kind is not available (compressor, EQ, saturator, limiter, utility and effect graph exist in this version)',
  sidechain_spaet: 'That key source is computed after this stage: tracks can listen to tracks and DJ inputs, groups also to the pre of other groups',
  sidechain_zyklus: 'That key would depend on the stage itself: its own strip, its own group, the master, or two tracks keying each other',
  sidechain_quelle: 'That key source is not available in the arrangement (erz/2, erz/3, erz/5 to erz/8 and pad/1, pad/2 come after the mixer)',
  kette_voll: 'The insert chain of that strip is full (four stages at most)', ins_voll: 'All stages of that kind are in use (twelve compressors, eight EQs, four saturators, two limiters, eight utilities and eight effect graphs at most)',
  host_grenze: 'All four plugin hosts are in use: remove a plugin stage before adding another', host_fehlt: 'The plugin host is not running or not ready yet',
  plugin_nicht_ladbar: 'That plugin cannot be loaded', zustand_passt_nicht: 'The saved plugin state belongs to another plugin and was not applied',
  param_unbekannt: 'That plugin has no such parameter',
  plugin_unbekannt: 'That plugin is not in the index: scan first', plugin_blockiert: 'That plugin failed its scan and is blocked',
  absturz_schleife: 'The plugin keeps crashing: switch the stage off and on to try again', zustand_fehler: 'The saved plugin state could not be restored: the stage stays off',
  latenz_zu_gross: 'The plugin latency is too large: the stage is left out',
  kein_effekt: 'That plugin is not an effect', kein_instrument: 'That plugin is not an instrument', scan_laeuft: 'A plugin scan is already running',
  kein_fenster: 'That plugin cannot show a window here', keine_anzeige: 'That plugin has no user interface', host_insert_echtzeit: 'A strip with an active plugin stage cannot be rendered offline: use Resample',
  export_host_ausfall: 'A plugin host failed during the real-time export: nothing was exported, try again',
  export_luecke: 'The real-time export dropped audio: nothing was exported, try again',
  rack_unbekannt: 'That strip has no rack any more', variation_voll: 'A rack holds at most 8 variations',
  variation_unbekannt: 'That variation no longer exists', rack_voll: 'All twelve racks are in use', makro_voll: 'A strip can have at most 16 macro mappings',
  ziel_doppelt: 'A parameter can be driven by one macro only', param_nicht_stetig: 'A macro drives continuous parameters only, not switches or step lists', glied_ohne_rack: 'A member target needs a track with an instrument rack', makro_ziel_wirt: 'A Surge member takes no macro target',
  param_gemappt: 'That parameter is driven by a macro: remove the mapping first, or automate the macro instead',
  param_hat_lane: 'That parameter has an automation line: delete the line first, or automate the macro instead', lane_unbekannt: 'That automation line no longer exists', lane_doppelt: 'This track already has a lane for that target', lane_gesperrt: 'That line is locked: unlock it first', bereich_leer: 'Select a range on the line first (it must not be empty)', huellkurve_ziel: 'That envelope does not fit this clip', huellkurve_unbekannt: 'That clip has no such envelope', geraet_huellkurven: 'Delete the device envelopes of this track\'s clips before switching to a host instrument', form_ungueltig: 'That shape is not available on this line (mute and solo take Square only)', geraet_lanes: 'Delete the device lines of this track before switching to a host instrument', punkte_ungueltig: 'The line points are not valid (mute and solo points must be jumps)',
  kit_unbekannt: 'That kit is not in the kit folder',
  keine_rackspur: 'That track has no instrument rack', rack_voll_glieder: 'A rack holds at most 4 members', glied_unbekannt: 'That rack member no longer exists',
  rack_letztes_glied: 'The last member of a rack cannot be removed: convert the track to a plain device instead',
  richtung_unbekannt: 'That direction word is not known for this track\'s device', richtung_grenze: 'That direction cannot go further: the parameters are at their bound',
  patch_unbekannt: 'That Surge patch is not in the library',
  richtung_wirkungslos: 'That word moves filter 1, and filter 1 is off in the patch the Surge host plays: load a patch with filter 1 on, or use another word',
  preset_unbekannt: 'That preset does not exist',
  wirt_wert_unbekannt: 'The current value of that Surge parameter is not known: start the Surge host or set the parameter first',
  spur_bereich: `At most ${MAX_SPUREN} tracks`, slot_belegt: 'Both Surge slots are in use (1, 2)', wirt_antwortet_nicht: 'The instrument host did not answer', spur_unbekannt: 'That track no longer exists', clip_unbekannt: 'That clip no longer exists',
  kein_eingang: 'A track can only be armed with a recording input', eingang_nicht_frei: 'This input is not released for Cypher: release it in the device settings (Cypher may use)', latenz_ungueltig: 'The latency profile of this input is not plausible: measure it again', eingang_fehlt: 'That recording input does not exist', zu_viele_scharf: 'At most 8 audio tracks can be armed at once', aufnahme_laeuft: 'A recording is running', nichts_scharf: 'No track is armed', keine_aufnahme: 'No recording is running', kein_platz: 'Not enough free disk space to record', ersetzen_loop: 'A looped clip is in the way; split or move it first (a recorded take is kept as a file)', veraltet_spur: 'The armed track no longer exists', ueberlappung: 'A transport is already running; stop it before recording', transport_abgelehnt: 'The transport did not start; nothing was recorded', einsatz_ausgeblieben: 'The take did not begin within the expected time (count-in or next bar); nothing was recorded', punch_leer: 'The punch range does not touch the take; nothing was placed (the take is kept as a file)', aufnahme_abgelehnt: 'The core refused the recording', aufnahme_abgebrochen: 'The core dropped the recording before it began; nothing was recorded', leer: 'The take contains no audio', keine_noten: 'The MIDI take holds no complete note inside the recorded range; nothing was placed (the take is kept as a file)', take_zu_lang: 'The take is longer than a WAV file can hold (about 3 hours); the raw file is kept', uebernahme_fehler: 'The take could not be placed on the track; the raw file is kept',
  index_bereich: 'No such track position', tempo_bereich: 'Tempo: 60 to 200 BPM', loop_bereich: 'The loop needs at least 1 beat',
  argument_ungueltig: 'That value is not allowed', argument_unbekannt: 'The core does not know that setting', befehl_unbekannt: 'The server does not know that command',
  art_passt_nicht: 'That clip does not fit this track', sha_ungueltig: 'That sample is not in the catalogue', clip_nicht_midi: 'That is not a MIDI clip',
  muster_fehler: 'The pattern does not run', muster_zeitlimit: 'The pattern took too long to evaluate: make it smaller',
  muster_ziel_passt_nicht: 'The pattern does not fit this track: s(...) belongs on a kit track, note(...) on an instrument track', muster_fehlt: 'That clip has no stored pattern',
  muster_zu_gross: 'The pattern is too big: make it smaller',
  handarbeit_vorhanden: 'The notes or envelopes of this clip were changed by hand since the pattern made them: tick OVERWRITE to replace them',
  muster_nicht_verfuegbar: 'This server cannot translate patterns', klang_unbekannt: 'A sound of the pattern is not in the kit of this track',
  warp_marker: 'The warp markers are not valid', warp_faktor: 'A warp segment has a tempo outside 15 to 800 BPM',
  transienten_fehlen: 'The audio is not decoded yet, so its transients are unknown', keine_transienten: 'There is no transient in that range',
 marker_unbekannt: 'There is no warp marker at that beat any more', warp_modus: 'That warp mode does not exist yet',
  beats_einheiten: 'Too many BEATS units in this clip: choose a coarser grid', quantisieren_konflikt: 'Quantizing would put two markers in the wrong order: choose a smaller range or a finer grid',
  transpose_repitch: 'RE-PITCH follows the tempo: no transpose here', kein_warp: 'That clip has no warp yet', offset_bei_warp: 'The clip is warped: use its offset in beats',
  kein_tempo: 'No tempo found for this sample (no analysis, no Traktor grid, no bars, no library BPM): it stays unwarped', warp_auto_neuer_clip: 'Auto-warp a new clip with its own clip_neu',
  fade_zu_lang: 'The fades are longer than the clip', feld_nur_audio: 'That setting only exists on audio clips', beat_ausserhalb: 'That position is outside the clip',
  noten_unbekannt: 'That note no longer exists', id_belegt: 'That id is taken', projekt_ungueltig: 'The change would make the project invalid',
  // history.ts und storage.ts (S2): Verlauf und Ablage des Projekts
  verlauf_inkonsistent: 'The change history does not fit the project: nothing was changed', verlauf_kaputt: 'The change history file is damaged',
  label_ungueltig: 'The change needs a description of 1 to 200 characters', projekt_busy: 'Another process has this project open',
  json_kaputt: 'The project file is damaged', slug_ungueltig: 'That is not a valid project name',
  log_voraus: 'The change history is ahead of the project file: open the project again', quelle_ungueltig: 'That source is not valid',
  verlauf_geschlossen: 'The change history is closed: open the project again', rev_nicht_steigend: 'The change history would go backwards: nothing was changed',
  // D1 V2 Nachzug (7a): alle übrigen Gründe des Servers im selben Baum (tests/production_reasons.test.mjs liest sie aus dem Code).
  // patch.ts (PatchFehler, kommt als verlauf_inkonsistent an; Text trotzdem, falls ein Weg ihn einmal durchreicht)
  pfad_ungueltig: 'The change history does not fit the project: nothing was changed', pfad_unbekannt: 'The change history does not fit the project: nothing was changed',
  op_unbekannt: 'The change history does not fit the project: nothing was changed', existiert_schon: 'The change history does not fit the project: nothing was changed',
  id_passt_nicht: 'The change history does not fit the project: nothing was changed',
  // playback.ts (WiedergabeFehler): kommt als kern.wiedergabe.fehler (7c), Text hier für jeden anderen Weg
  nr_ungueltig: 'The core got an invalid arrangement number', arbeitsordner_fehlt: 'The work folder of this instance is missing',
  datei_fehlt: 'A file of the arrangement is missing (a frozen track?)',
  // areas/proj (ProjFehler, BEREICH_GRUENDE, Tempo-Weg)
  koerper_zu_gross: 'The change is too big (more than 1 MiB)', json: 'The server could not read the request', koerper_kein_objekt: 'The server could not read the request',
  intern: 'The project server hit an internal error: nothing was changed', beschaeftigt: AUSGABE_FEHLER.beschaeftigt,
  katalog_fehlt: 'The sample catalogue is not available', sha_unbekannt: 'That sample is not in the catalogue', nur_live: 'That sample is protected (Ableton Live only)',
  quelle_fehlt: 'The sample file is missing', aktion_unbekannt: 'The server does not know that transport action', beat_ungueltig: 'That start position is not allowed',
  tempo_abgelehnt: 'The core refused the tempo', kein_kern: 'The core is not running', rampe_haengt: 'The tempo change did not finish in the core',
  transport_laeuft: 'Your transport is running: Cypher switches the project only after it stops',
  // catalog.ts (KatalogFehler)
  camelot_ungueltig: 'That key is not valid', katalog_kaputt: 'The sample catalogue is damaged', katalog_schema: 'The sample catalogue has an unknown format',
  facette_ungueltig: 'That filter is not valid', zu_viele_suchwoerter: 'Too many search words', sort_ungueltig: 'That sort order is not valid',
  suche_ungueltig: 'That search is not valid', mid_ungueltig: 'That entry id is not valid',
  // server.ts: Spur-Regler nur über das Projekt (Spec 6.22)
  ueber_projekt: 'Track mixer changes go through the project',
  // http/transport.ts postAbgewiesen (V2 Fix F9, Spec 6.34: auch die Router-Gründe brauchen einen Text): 415 und 403
  nur_json: 'The server only takes JSON requests', fremde_herkunft: 'The server refused a request from another page',
  // Baukasten S17: sound snapshot of the project (areas/proj/modular.ts)
  bk_nicht_geladen: 'No Baukasten graph is loaded on that channel: load one before saving the sound',
  bk_nichts_geladen: 'No Baukasten graph is loaded on a default channel: load one or name the channels to save',
  kein_baukasten: 'This server has no Baukasten graph bridge: the sound snapshot is not available',
  // 1.14 Comping, take lanes (task 7: the reasons of rename, delete and audition; the comp reasons come with the gesture)
  comp_leer: 'The range is empty or outside the take lane: drag over a part of the take lane',
  take_unbekannt: 'That take lane no longer exists', takes_voll: 'A track holds at most 32 take lanes', take_nur_audio: 'Only audio tracks have take lanes',
  take_name_ungueltig: 'A take lane name has 1 to 64 characters, not only spaces',
};
// V2 Fix-Runde 2 H7 (Spec 6.34): beschaeftigt und zu_gross sind mehrdeutig (ein Freeze, ein Öffnen, eine Tempo-Rampe; Grenzen des Kerns). Wie in
// output.js (F12) zeigt die Seite dann den text der Antwort, wenn er da ist, sonst einen neutralen Text, der keine Ursache behauptet (vorher fest
// „A freeze is running“ und „The change is too big“). Der S2-Text zu zu_gross ist heute deutsch (project/commands.ts); S3 stellt die Server-Texte um.
const MUSTER_GRUENDE = new Set(['muster_fehler', 'klang_unbekannt', 'muster_ziel_passt_nicht', 'muster_zeitlimit', 'muster_zu_gross', 'handarbeit_vorhanden']);
export function fehlerText(r) {
  if (r?.j && 'quittung' in r.j && r.j.quittung === null) return FEHLER_TEXT.keine_antwort;   // der Kern hat nicht geantwortet: nie stiller Erfolg
  const code = r?.j?.fehler ?? r?.j?.grund;
  // strudel-clip: the detail of a pattern refusal is the useful part (line and column, the sounds of the kit), so it is shown
  if (MUSTER_GRUENDE.has(code) && typeof r?.j?.detail === 'string') return `${FEHLER_TEXT[code]}: ${r.j.detail}`;
  return mehrdeutigText(r) ?? FEHLER_TEXT[code] ?? `Rejected: ${code ?? `HTTP ${r?.status}`}`;
}
// D1 V2 Nachzug (7c, 7d): eine angenommene Änderung, die der Kern nicht nachvollzieht, ist kein stiller Erfolg. /proj/aendern (und
// undo/redo) antworten 200 mit kern.wiedergabe = {nr: null, fehler, text}, wenn der Übersetzer die Wiedergabe nicht bauen konnte
// (WiedergabeFehler, areas/proj/session.ts schreibeNeueWiedergabe), und mit kern.regler = 'kein_kern', wenn Mixer-Werte ohne Kern
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
// Slice 3a (T7): die Hinweise des Schreibwegs (`hinweise: [{index, hinweis}]` in der Antwort von clip_neu mit warp "auto" und warp_auto) waren auf der Seite stumm
export const HINWEIS_TEXT = {
  kein_tempo: FEHLER_TEXT.kein_tempo,
  analyse_angefordert: 'Analysing the track in the background: the analysed warp replaces the current one when it arrives and the clip is not playing',
  analyse_laeuft: 'The analysis of this track is already running',
  karte_zu_gross: 'The beat map has more than 4096 markers: warped from the next source instead',
  karte_unbrauchbar: 'The beat map of this track is not usable (a beat is out of range): warped from the next source instead',
  // Slice 3b: Set 1.1.1 Here und sein Rückweg an die Analyse (D3)
  eins_gemeldet: 'Bar one set. The correction is saved with the track: the decks use it too, and the next warp of this track starts there',
  eins_nur_hier: 'Bar one set in this clip only: no correction written (the track is not in the deck stock, or this instance writes none)',
  eins_rueckweg_fehler: 'Bar one set in this clip, but the correction could not be saved with the track',
  // 1.12: a write to a parameter on which a lane lies (the server's text names the lane; this one is the fallback)
  lane_treibt: 'This parameter is driven by an automation lane while the arrangement plays: the value is saved as the rest value',
};
export function hinweisMeldung(hinweise) {
  if (!Array.isArray(hinweise) || hinweise.length === 0) return null;
  const texte = [...new Set(hinweise.map((h) => (h.hinweis === 'lane_treibt' && h.text ? h.text.charAt(0).toUpperCase() + h.text.slice(1) : HINWEIS_TEXT[h.hinweis] ?? `Note: ${h.hinweis}`)))];
  return { text: texte.join(' · '), fehler: hinweise.some((h) => h.hinweis === 'kein_tempo' || h.hinweis === 'eins_rueckweg_fehler') };
}
// Slice 3a: SSE {a: 'proj', f: {clip_id, analyse: 'wartet'|'laeuft'|'karte_bereit'|'fertig'|'fehler'|'verworfen', grund?}}. Die Seite lädt bei clip_id ohnehin nach
// (ereignis); eine Meldung gibt es nur, wo der Nutzer etwas wissen muss: die Analyse ist gescheitert, die Karte ist da, aber der Clip klingt (D1: sie wartet), oder
// die Karte kam, aber der Clip war inzwischen angefasst oder Cypher gestoppt
export function analyseMeldung(f) {
  if (f?.analyse === 'fehler') return { text: `Analysis failed${f.grund ? `: ${f.grund}` : ''}. The clip keeps its current warp`, fehler: true };
  if (f?.analyse === 'karte_bereit') return { text: 'The analysis arrived. The clip is playing: the analysed warp replaces the current one as soon as the clip is not playing', fehler: false };
  if (f?.analyse === 'verworfen' && f.grund === 'angefasst') return { text: 'The analysis arrived, but the clip was changed meanwhile: it stays as it is. Press WARP to use the analysis', fehler: false };
  if (f?.analyse === 'verworfen' && f.grund === 'ki_gestoppt') return { text: 'The analysis arrived, but Stop Cypher is set: the clip stays as it is. Press WARP to use the analysis', fehler: false };
  return null;
}
// Nach einem angenommenen Schreibzug (beiProjekt des Schreibers in bindeProduktion): der Kern-Hinweis hat Vorrang, sonst die Hinweise des Schreibwegs, sonst nichts
export function meldeNachSchreiben(j, melde) {
  const h = kernHinweis(j?.kern), m = hinweisMeldung(j?.hinweise), p = musterMeldung(j?.muster);
  // the core hint keeps its precedence over the other hints; the pattern report is said next to it (it names the fields that were not applied)
  const ganz = [h, p?.text, h || p ? null : m?.text].filter(Boolean).join(' · ');
  if (ganz) melde(ganz, h !== null || p?.fehler === true || (!p && m?.fehler === true));
}
// strudel-clip: the report of a generated clip (answer key `muster`): what was written and, never silent, which Strudel fields have no target here
export function musterMeldung(liste) {
  if (!Array.isArray(liste) || liste.length === 0) return null;
  const texte = liste.map((m) => `Pattern: ${m.noten_zahl} note${m.noten_zahl === 1 ? '' : 's'}, ${m.takte} bar${m.takte === 1 ? '' : 's'}${m.loop_beats ? `, loop ${m.loop_beats} beats` : ''}${m.huellkurven?.length ? `, envelopes ${m.huellkurven.join(', ')}` : ''}`
    + `${m.ohne_ziel?.length ? `. Not applied (no target here): ${m.ohne_ziel.join(', ')}` : ''}${m.hinweise?.length ? `. ${m.hinweise.join('. ')}` : ''}`);
  return { text: texte.join(' · '), fehler: liste.some((m) => m.ohne_ziel?.length > 0) };
}
// Text zu einer Antwort ohne Erfolg: ein 5xx ohne Grund ist „der Server antwortet nicht“, nie „Rejected: HTTP 503“. Gilt für den Schreibweg
// und (V2 Fix F3) für FREEZE und EXPORT (freeze_export.js über ctx.antwortText)
export const antwortText = (r) => fehlerText(serverWeg(r) && r.status !== 0 ? { j: { fehler: 'server_fehler' } } : r);
const lies = (k, v) => { try { return localStorage.getItem(k) ?? v; } catch { return v; } };
const merke = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ohne Speicher: nur jetzt */ } };

// Ctrl+G is left to the browser only where the focus takes text (a range or a button must not swallow it: after a fader move Ctrl+G is still "group")
const TEXT_ARTEN = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password', '']);
export const nimmtTextAn = (t) => !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true
  || (t.tagName === 'INPUT' && TEXT_ARTEN.has(String(t.type ?? '').toLowerCase())));

export function bindeProduktion({ post, bpm, stoebern, bibliothek = null, presetsZeigen = null, presetsNeu = null, presetListe = () => [], wurzel = document.querySelector('#produktion') }) {
  wurzel.innerHTML = GERUEST;
  const $ = (n) => wurzel.querySelector(`[data-p="${n}"]`);
  const st = { slug: null, projekt: null, sichtbar: false, laeuft: false, arr: null, kopfBeat: null, start: 0, getrennt: false, analyse: [], stems: null, autoUeber: [], geraete: null };
  document.documentElement.style.setProperty('--ueber', UEBER_FARBE);   // the one orange for the stylesheet (production.css uses var(--ueber))
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
  // D1 V2 Nachzug (7b): jede Antwort entscheidet über OFFLINE (load.js offlineNach): Ausfall setzt es, Erfolg nimmt es zurück,
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
    beimProjekt: [], nachLaden: [], vorBild: [], beimBild: [], beimEreignis: [], beimSichtwechsel: [], beimMarken: [], beiGeraete: [],
    presetsZeigen, presetsNeu,   // 1.16 rest U7: app.js callbacks of the PRESETS panel (see preset_host.js)
    presetListe,                 // 1.16 rest U8: the rows of the PRESETS panel (right click "Add to collection", collections.js)
    ausgabeLauf: () => {} };   // V2 Fix F14: freeze_export.js setzt es (ausgabe_lauf aus GET /proj/aktuell)

  // Neuer Stand vom Server; ein älterer Stand desselben Projekts als der gezeigte wird verworfen
  function setzeProjekt(slug, p) {
    if (slug !== null && slug === st.slug && st.projekt && p.rev < st.projekt.rev) return;
    const wechsel = slug !== st.slug;
    if (wechsel) st.stems = stemsFuerProjekt(st.stems, slug);   // Projektwechsel: ein fremder Stand fällt weg
    st.slug = slug; st.projekt = p; setzeKettenZiele(p);   // 1.12 slice 6: the ranges of the insert and rack lane targets come from the project
    if (slug !== null) ctx.schreiber.setze(slug, p.rev);
    $('leer').hidden = !!p;
    $('name').textContent = p ? p.name : 'No project';
    for (const h of ctx.beimProjekt) h(p, wechsel);
  }
  ctx.uebernimm = (slug, p) => { setzeProjekt(slug, p); for (const h of ctx.nachLaden) h(); };
  // Server weg (Status 0 oder 5xx): der gezeigte Stand bleibt, die Ansicht meldet es; kommt der Server wieder (SSE-Strom
  // verbindet neu), lädt ereignis() neu. Nur eine Antwort des Servers leert die Ansicht (load.js).
  const ladeRoh = neuerLader({
    hole: () => holeGet('/proj/aktuell'),
    uebernimm: (slug, p, j) => { st.autoArm = armStand(j?.auto_arm); if (j?.auto_arm) st.autoModus = st.autoArm.modus;   // 1.12 S3 task 9: armed tracks and mode, from the server only
      st.instrumente = Array.isArray(j?.instrumente) ? j.instrumente : [];   // plan 1.11 task 17: states of the plugin instrument hosts
      st.autoUeber = Array.isArray(j?.auto_uebersteuert) ? j.auto_uebersteuert : [];   // 1.12 S3 (D8): overridden lanes, from the server only
      st.analyse = Array.isArray(j?.analyse) ? j.analyse : []; st.stems = stemsFuerProjekt(j?.stems, slug);
      st.vorhoeren = j?.vorhoeren && typeof j.vorhoeren === 'object' ? j.vorhoeren : {};   // 1.14: audition map {spur_id: take_id}, from the server only
      ctx.uebernimm(slug, p); ctx.ausgabeLauf(j?.ausgabe_lauf ?? null); },   // Slice 3a: Analysen, Slice 6: stems
    leere: (j) => { st.autoArm = armStand(null); st.autoUeber = []; st.analyse = []; st.stems = null; st.vorhoeren = {}; setzeProjekt(null, null); ctx.ausgabeLauf(j?.ausgabe_lauf ?? null); },
    // 7b: OFFLINE setzt holeGet (merkeAntwort); ein 5xx mit Grund behält den Stand und zeigt den Text des Grunds
    beiWeg: (r) => melde(antwortText(r), true),
    beiDa: () => setzeGetrennt(false),
  });
  const nachlader = neuerNachlader(ladeRoh, 30);
  const ladeAktuell = nachlader.starte;
  ctx.ladeAktuell = ladeAktuell;
  const planeLaden = nachlader.plane;

  // Schreibweg: nacheinander, mit rev (Spec 3.4); 409 rev_veraltet lädt neu
  ctx.schreiber = neuerSchreiber({
    holeJson,
    beiProjekt: (slug, p, rev, j) => {
      ctx.uebernimm(slug, p);
      meldeNachSchreiben(j, melde);
    },
    // rev_veraltet: neu laden und das Promise zurückgeben, der Schreiber hält die Schlange bis der neue Stand gesetzt ist
    beiFehler: (a, r) => {
      melde(antwortText(r), true);
      if (r.status === 409 && r.j?.fehler === 'rev_veraltet') return ladeAktuell();
    },
    beiWiederhole: async () => { nachlader.starte(); await nachlader.fertig(); },   // task 9: the retry waits for the NEWEST applied load (an overtaken one does not count)
    beiFremdeRev: () => planeLaden(),   // task 9: an event taken for our own write was not (a server take): fetch the state
    beiVerworfen: (n) => melde(`The project changed elsewhere: reloaded, ${n} waiting change${n === 1 ? '' : 's'} dropped, please repeat`, true),
  });
  ctx.aendere = (label, befehle, schluessel, optionen) => ctx.schreiber.aendere(label, befehle, schluessel, optionen);
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
  // 1.10 T3 (D5): a plain click elsewhere or Escape clears the track selection (Ctrl/Shift+click on a name keeps it)
  document.addEventListener('click', (e) => {
    if (!st.spurWahl?.size) return;
    if (e.target?.closest?.('.p-arr-name, .p-arr-gruppe .p-ausgang') || ((e.ctrlKey || e.shiftKey || e.metaKey) && e.target?.closest?.('.p-spurname'))) return;   // a click on a group head name selects the head itself; a click on the output select of a group head keeps the selection
    ctx.wahlLeeren();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.sichtbar && !menueOffen() && !e.defaultPrevented && !document.body.classList.contains('geraeteseite') && st.spurWahl?.size) ctx.wahlLeeren(); });
  // 1.10 T3: Ctrl+G groups the selected tracks (track_heads.js ctx.gruppiere); ignored in text fields, where the browser keeps the key
  document.addEventListener('keydown', (e) => {
    if (!st.sichtbar || e.repeat || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'g') return;
    if (nimmtTextAn(e.target)) return;
    e.preventDefault();
    ctx.gruppiere?.();
  });

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
    // Die Library sichtbar zu machen ist Sache von production.css (body.produktion); hier nur die Daten laden, falls noch keine da
    // sind. Kein Klick auf DJ-Bedienelemente: der schrieb djk-bereich in den Speicher und setzte den Fokus in #lib-suche.
    bibliothek?.();
    for (const h of ctx.beimSichtwechsel) h(true);
    ladeAktuell();
    if (!st.laeuft) { st.laeuft = true; requestAnimationFrame(bild); }
  }
  function verberge() { st.sichtbar = false; for (const h of ctx.beimSichtwechsel) h(false); }
  let standN = 0;
  function ereignis(a, f) {
    // Slice 6 (D13): Stems-Meldungen {stems:{slug,clip_id,zustand,prozent,…}} tragen kein rev und kein f.slug. Stand merken, Ende melden, neu zeichnen;
    // nachladen nur bei fertig (nachladenNoetig), nie bei einem Fortschritts-Tick. Die Haken (beimEreignis) lesen f.stems nicht.
    // Ein Stand eines anderen Projekts wird ignoriert (Clip-ids kollidieren zwischen Projekten).
    const se = a === 'proj' ? stemsEreignis(f, { slug: st.slug, sichtbar: st.sichtbar }, FEHLER_TEXT) : { behandelt: false };
    if (se.behandelt) {
      if (se.uebernimm) st.stems = se.stand;
      if (se.meldung) melde(se.meldung.text, se.meldung.fehler);
      if (se.nachladen) planeLaden();
      return;
    }
    if (ladeNachEreignis(a, st.sichtbar)) planeLaden();   // 1.12 S3: an override changed in the core; the server mirror has it already, fetch the list (orange follows)
    if (a === 'proj') { const m = analyseMeldung(f); if (m) melde(m.text, m.fehler); }   // Slice 3a: Analyse-Ereignisse mit Meldung
    // Das Anfangsbild 'stand' kommt bei jedem (Wieder-)Verbinden des Stroms: nach einem Ausfall den Stand neu holen
    if (a === 'stand') { standN++; if (st.sichtbar && (st.getrennt || standN > 1)) planeLaden(); }
    // Die eigene Änderung kommt als SSE vor der HTTP-Antwort: dafür nicht nachladen (die Antwort bringt den Stand)
    if (nachladenNoetig(a, f, { sichtbar: st.sichtbar, slug: st.slug, rev: st.projekt?.rev, eigene: ctx.schreiber.istEigeneRev })) planeLaden();
    for (const h of ctx.beimEreignis) h(a, f);
  }
  setzeProjekt(null, null);
  return { zeige, verberge, ereignis, presetHost: ctx.presetHost };
}
