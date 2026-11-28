// Moved unchanged out of hand.ts: the clip, analysis, stems, plugin and preset tools of the tool table.
import path from 'node:path';
import { PRESET_ID } from '../ui/presets/preset_id.ts';
import {
  FEHL_STATUS, type Json, http, FRIST_VORGABE_MS, fristVon, FRIST_GRUND, zahl, deck, ab, raster, SUCHE, isObj, definiert, PRESET_ZIEL, type Werkzeug,
  fehlerAntwort, mitRev,
} from './hand_core.ts';

export const WERKZEUGE_PROJ_CLIPS: Werkzeug[] = [
  { name: 'geraete_lage', description: 'Audio and MIDI inputs of the core and their devices: per input (1 to 4, plus the MIDI input) the assigned device profile (pc-eingang, xdj-xz, usb-audio for any other USB audio interface such as the Seiren or the K6), whether the device is present (da), linked in the core (verbunden; null = the core has sent no state for 2 s, unknown), the input level (pegel_db, -200 = silence, null = unknown), the measured latency (latenz, with art software or kabel) and frei_fuer_cypher. I may use an external input only when frei_fuer_cypher is true: Andreas releases each input himself, I cannot change it. Also the detected sources (quellen), the profiles and the last core state (kern.ein: verbunden bit mask, MIDI events seen and lost, last MIDI sample, last impulse sample).',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/geraete') },
  // Paket 1.13 (Warp, Slice 1): der Warp eines Audio-Clips mit Markern; lesen, ändern geht über proj_aendern (warp_setzen, warp_auto)
  { name: 'proj_warp', description: 'Read the warp of an audio clip of the open project. Answers {clip_id, start_beat, laenge_beats, warp, bei?}: warp is null for a clip without warp, else {an (false = markers kept but the clip plays unwarped), modus (repitch: speed follows the project tempo, the pitch goes with it; beats: drum slices on their beat, with the object beats {raster, loop, huelle} in the answer when it is set (absent = default transienten/vor/100); complex and tones keep the pitch), quelle (takte | mediathek | werkstatt | traktor | hand), eins_unsicher (true: the bar one of the track is a guess, the page shows "downbeat?"), transpose_st, detune_ct (pitch factor = 2^(transpose_st/12 + detune_ct/1200), complex and tones only), versatz_beats (which beat of the warp plays at the clip start), marker_zahl, marker: [{quell_s (source seconds), beat (clip beat; 0 is the 1.1.1 of the source), projekt_beat (where the marker lies in the first pass of the clip), segment_bpm (source tempo of the segment starting at the marker, null at the last marker)}]}. bei_beat (a project beat) adds bei {projekt_beat, quell_s}: the source second that plays there, as a counter check against what you hear or measured. von_beat and bis_beat (project beats) limit the marker list; marker_max (1 to 4096, default 200) caps it: marker_zahl is the number of markers in the clip, marker_gezeigt the number shown, weiter_ab_projekt_beat the project beat of the first marker not shown (use it as von_beat for the next page). transienten_zahl (the hits the server found in the source inside the clip; null: audio not decoded yet), transienten (source seconds of the hits in the window von_beat..bis_beat, at most transienten_max, default 4096), transienten_gezeigt (their number); tempo {mittel_bpm, min_bpm, max_bpm} and erster_marker {quell_s, beat} summarise the warp without the list (a track analysed by the Werkstatt has 350 to 2300 markers, one per beat; beat 0 is the first bar one). Change it with proj_aendern (warp_setzen, warp_auto, clip_aendern versatz_beats). Refused: kein_projekt, clip_unbekannt, feld_nur_audio.',
    inputSchema: { type: 'object', required: ['clip_id'], properties: {
      clip_id: { type: 'string', description: 'clip id from proj_lage, e.g. c3' },
      von_beat: zahl('first project beat of the marker list', {}),
      bis_beat: zahl('last project beat of the marker list', {}),
      bei_beat: zahl('project beat at which to read the source second W(bei_beat)', {}),
      marker_max: { type: 'integer', minimum: 1, maximum: 4096, description: 'at most this many markers in the list (default 200)' },
      transienten_max: { type: 'integer', minimum: 1, maximum: 32768, description: 'at most this many transients in the list (default 4096)' } } },
    lauf: (p) => http('GET', `/proj/warp?clip_id=${encodeURIComponent(String(p.clip_id))}${['von_beat', 'bis_beat', 'bei_beat', 'marker_max', 'transienten_max'].filter((k) => p[k] !== undefined)
      .map((k) => `&${k}=${encodeURIComponent(String(p[k]))}`).join('')}`) },
  // Note editor slice 1 (B5): the notes of an audio clip (detected from its pitch curve); editing goes through proj_aendern (audio_noten_aendern, audio_noten_zuruecksetzen, audio_noten_entfernen)
  { name: 'proj_noten', description: 'Read or detect the notes of an audio clip of the open project (single voice or single instrument; the pitch of the sound is cut into notes). '
    + 'Without flags it reads: {clip_id, quelle_sha, kurve, noten, analyse, render}. noten is the note list of the clip, null while the clip has none (an empty list means the detection found no notes): '
    + 'each note is {id (t1, t2, ... by start time, fixed), qa and qe (detected start and end in SOURCE seconds: the recording\'s own time, not beats, not project time), qton (detected pitch, float MIDI, A4 = 69, 60.5 is half way between C4 and C#4), p (level 0..1)} '
    + 'and a target field only when the note was edited: ton (target pitch, float MIDI), and a and e (target start and end in source seconds, like qa and qe), and vib and drift (factors of the detected vibrato and drift, 0 flat, 1 as sung and not stored, up to 4). The detected values qa, qe and qton never change. '
    + 'With a pitch curve every note carries mass, without one only a note with a target; mass is the measure of the edit from the list: {a_ms, e_ms (target minus detected start and end, ms, 0.1), laenge_ms (target length, ms), dehnung (target length divided by detected length, 1e-3), ton_ct (target minus detected pitch, cents, 0.1), and when the pitch curve is known vib_ct and drift_ct (source vibrato width peak to peak and drift range, cents), vib_ziel_ct and drift_ziel_ct (the same after the vib and drift factors)}. '
    + 'kurve is {id, detektor (pyin | netz), stimmhaft_anteil (share of pitched frames 0..1), mono} of the pitch curve the notes were cut from, null without notes. '
    + 'analyse is the last state of a detection of this clip in the open project (null before one), render the state of the edit sound: '
    + 'zustand quelle (no note has a target, the clip plays its source), rechnet (the edit is queued or computed, the clip still plays its source), alt (the previous render plays while the new one is computed), '
    + 'bereit (the exact edit plays; sekunden = computing time; messung = [{id, ton_ist, fehler_ct}], one entry per edited note: the pitch measured on the rendered sound over the middle of the note, float MIDI, and its distance to the target, cents; a note too short or unvoiced there has no entry), fehler (the clip plays its source; grund noten_programm_fehlt, noten_render_fehler or noten_kurve_fehlt with text); render is null when the server has no render service. '
    + 'After an edit with proj_aendern the render takes a moment: read again until zustand is bereit before you judge the sound. '
    + 'erkennen: true detects the notes (the clip must be decoded; one run at a time; no GPU; the result is one project change with the label "Detect notes <clip name>", one undo step with proj_undo). '
    + 'The call waits for the end and answers like a read with analyse = the end state, or up to '
    + `${FRIST_VORGABE_MS.proj_noten / 60_000} min (DJK_HAND_FRIST_PROJ_NOTEN_MS), then it answers laeuft with auftrag_id and the run goes on: read again later (analyse) or cancel it with abbrechen. `
    + 'analyse.zustand is laeuft (stufe, prozent), fertig (noten = count, detektor, sekunden, at most one hinweis with its English text: '
    + 'keine_noten = "No notes found in this clip." (an empty list is placed, no error), wenig_stimmhaft = "Little pitched sound found. If this is a full mix, separate stems first and detect notes on the vocal stem." (the notes are placed as usual), '
    + 'netz_fehler = "the network detector failed; the notes come from the own detector"), abgebrochen (grund abbruch or noten_zeitlimit), veraltet (grund veraltet: the clip or its source or its notes changed during the run, nothing placed; or ki_gestoppt: Stop Cypher was set at the end, the result was discarded) '
    + 'or fehler (grund noten_mehrstimmig = "More than one note at a time. Separate stems first, then detect notes on a stem." (more than 30 percent of the checked frames hold more than one note: use proj_stems and detect on a stem, nothing is placed), '
    + 'or noten_fehler with detail: a program failed or wrote no valid result, nothing changed). Closing or switching the project during a run cancels it; a run whose own state is no longer visible answers unbekannt. '
    + 'neu: true (only with erkennen) detects again on a clip that already has notes and replaces the list in one undo step; all edits of the old list are lost. Without it a clip with notes is refused noten_vorhanden. '
    + 'abbrechen: auftrag_id (integer, from erkennen or analyse; clip_id is not needed) cancels the running detection, the end state abgebrochen follows; an unknown or finished id is kein_auftrag, a run whose notes are already placed is zu_spaet (undo them with proj_undo). '
    + 'Refusals of erkennen (nothing changed): kein_projekt, clip_unbekannt, feld_nur_audio (a MIDI clip: it has its own note commands), audio_fehlt (the audio is not decoded yet), noten_laeuft (another detection runs, the detail names its auftrag_id), '
    + 'stems_laeuft (a stem separation runs), ki_gestoppt (Stop Cypher is set), nur_andreas_spur (the track belongs to Andreas), noten_vorhanden, noten_programm_fehlt (cypherdj-noten is not built or not installed), argument_ungueltig, argument_unbekannt. '
    + 'The read refuses kein_projekt, clip_unbekannt, feld_nur_audio and argument_ungueltig. '
    + 'The notes are not edited here: change targets with proj_aendern (audio_noten_aendern {clip_id, ids, ton | ton_um | a, e | zeit_um | vib | vib_um | drift | drift_um, mit_nachbarn?}, audio_noten_raster {clip_id, ids?, zeit?, ton?, staerke?, tonart?} to quantise starts or snap pitches, audio_noten_zuruecksetzen {clip_id, ids?}, audio_noten_entfernen {clip_id}); their refusals are named there (keine_audio_noten, noten_unbekannt, noten_ton_grenze and the others). '
    + 'Time edits (zeit_um moves, a and e set the edges, mit_nachbarn lets touching neighbours follow) are limited to a stretch of 0.25..4 (noten_dehnung_grenze) and to non-overlapping notes (noten_ueberlappen); after a time edit read again until render is bereit. '
    + 'An export waits up to 60 s for pending renders and is refused noten_render_fehlt when the edit is not ready by then.',
    inputSchema: { type: 'object', properties: {
      clip_id: { type: 'string', description: 'audio clip id from proj_lage, e.g. c3 (required except with abbrechen)' },
      erkennen: { type: 'boolean', description: 'true: detect the notes of the clip and wait for the end' },
      neu: { type: 'boolean', description: 'only with erkennen: replace an existing note list (the edits are lost)' },
      abbrechen: { type: 'integer', minimum: 1, description: 'auftrag_id of the running detection to cancel' } } },
    lauf: (p) => projNoten(p) },
  // Automation Slice 1/2 (ADR 032): read the points of a lane; changing goes through proj_aendern (auto_neu, auto_punkte, auto_loeschen, auto_aendern)
  { name: 'proj_auto', description: 'Read the automation lines (lanes) of the open project. Give lane_id (from proj_lage lanes, e.g. a1) for one lane '
    + 'or spur_id for all lanes of one track (also a group, a return or "master": their insert and rack lanes). Answers {lane_id, spur_id, ziel, gesperrt? (true only when the lane is locked), punkte_zahl (all points of the lane), punkte_gezeigt, '
    + 'punkte: [{beat (project beat), wert, form (linear | s | sprung: the segment INTO this point)}], '
    + 'weiter_ab_beat? (more points after the shown ones), bei?: {beat, wert}}; with spur_id: {spur_id, lanes: [...]}. '
    + 'ziel and the unit of wert: fader (dB, -200..6, -200 = off), pan (-1..1), mute and solo (0 or 1, always jumps), '
    + 'geraet.lautstaerke, geraet.cutoff, geraet.resonanz, geraet.env_mod (0..1, only on tracks with the RB-338 device), geraet.k1..geraet.k64 (0..1, the knobs of a bk track; an untouched knob sits at the graph\'s default, 0.5 where it has none), '
    + 'send.<returnId> (dB, -200..6, the level of a send of a track into that return), insert.<stage id>.<param> (the unit and range of that insert parameter, e.g. dB for schwelle), plugin.<host stage id>.<index> (0..1, a parameter of a foreign plugin: index as in the plugin\'s parameter list (plugins aktion parameter); played by the page server at 50 Hz, about 10 ms timing, not sample-accurate; at most 16 per plugin, plugin_lanen_voll (409), counted per host stage and NOT against the 12 lanes per strip that reach the core), rack.m1..rack.m4 (0..1). '
    + 'bei_beat reads the value the core plays at that project beat, in the unit of the lane (before the first point the first value holds, after the last the last); the answer carries it as bei. '
    + 'gesperrt: true = the lane is locked, auto_punkte and auto_loeschen are refused with lane_gesperrt until proj_aendern auto_aendern {lane_id, gesperrt: false}. '
    + 'von_beat and bis_beat (project beats, both included) narrow the list; punkte_max (default 200) caps it. '
    + 'A lane that Andreas recorded by hand (touch, latch or write take) is an ordinary lane here: read it like any other. '
    + 'Changing lanes: proj_aendern auto_neu, auto_punkte, auto_loeschen, auto_aendern. Refused: lane_unbekannt (404), spur_unbekannt (404), kein_projekt. '
    + 'CLIP ENVELOPES (slice 5): give clip_id (from proj_lage) and ziel (gain | transpose | spur_fader | spur_pan | geraet.lautstaerke | geraet.cutoff | geraet.resonanz | geraet.env_mod | geraet.k1..geraet.k64) to read the envelope of that target on that clip; clip_id alone lists every envelope of the clip as {clip_id, spur_id, huellkurven: [...]}, an empty list when it has none. '
    + 'Answers {clip_id, spur_id, ziel, verknuepft (true = linked: repeats with the clip loop; false = unlinked), loop_beats? (only unlinked), punkte_zahl, punkte_gezeigt, punkte: [{beat, wert, form}], weiter_ab_beat?, bei?: {beat, wert}}. '
    + 'For a clip envelope ALL beats (von_beat, bis_beat, bei_beat, the points) are CLIP beats counted from the clip start, not project beats; bei is the value the core plays at that clip beat (with the repetition of a linked or unlinked envelope), in the unit of the target (gain and spur_fader in dB, transpose in semitones before rounding, spur_pan and geraet.* plain). '
    + 'clip_id does not go with lane_id or spur_id (argument_ungueltig). Refused for a clip: clip_unbekannt (404), huellkurve_unbekannt (404, the clip carries no envelope for that ziel), huellkurve_ziel (400, ziel is not an envelope target). '
    + 'MODULATOR LIVE READ: give mod_id (from proj_lage modulatoren, alone, not with lane_id, spur_id or clip_id) to read what one modulator does to its targets right now. Answers {mod_id, nr, art, an, ausgang, ziele: [{strang_id, ziel, einheit, basis, versatz, wert, tiefe, polaritaet}]}. '
    + 'ausgang is the modulator output -1..1 the core reported last (null while the core reports none, e.g. no core yet). basis is the value the page server knows for that target: the last value the core reported for that row when there is one, else the project value (null for device and plugin targets, which the server does not track); versatz is the offset in the unit of the target (dB, pan units, 0..1, for insert parameters already multiplied by the parameter range); wert = basis + versatz clamped to the range of the target. versatz and wert are null while ausgang or basis is unknown. Several modulators on one target add up in the core, so wert here shows only this modulator. Moving the base (any write, or Andreas by hand) moves wert, the offset stays on top. Refused: mod_unbekannt (404), kein_projekt (409).',
    inputSchema: { type: 'object', properties: {
      lane_id: { type: 'string', description: 'lane id from proj_lage, e.g. a1' },
      mod_id: { type: 'string', description: 'modulator id from proj_lage modulatoren, e.g. m1: read its live offsets (alone)' },
      spur_id: { type: 'string', description: 'track id: all lanes of that track (instead of lane_id)' },
      clip_id: { type: 'string', description: 'clip id from proj_lage: read the clip envelopes (instead of lane_id or spur_id); then the beats below are CLIP beats' },
      ziel: { type: 'string', description: 'with clip_id: the envelope target to read (gain | transpose | spur_fader | spur_pan | geraet.lautstaerke | geraet.cutoff | geraet.resonanz | geraet.env_mod | geraet.k1..geraet.k64); without it every envelope of the clip' },
      von_beat: zahl('first beat of the point list (project beat for a lane, clip beat for a clip envelope)', {}),
      bis_beat: zahl('last beat of the point list (project beat for a lane, clip beat for a clip envelope)', {}),
      bei_beat: zahl('beat at which to read the lane value (project beat; clip beat for a clip envelope), in the unit of the lane target', {}),
      punkte_max: { type: 'integer', minimum: 1, maximum: 8192, description: 'at most this many points in the list (default 200)' } } },
    lauf: (p) => http('GET', `/proj/auto?${['lane_id', 'mod_id', 'spur_id', 'clip_id', 'ziel', 'von_beat', 'bis_beat', 'bei_beat', 'punkte_max'].filter((k) => p[k] !== undefined)
      .map((k) => `${k}=${encodeURIComponent(String(p[k]))}`).join('&')}`) },
  // Automation Slice 3 (ADR 032, D9): Cypher may only re-enable overridden lanes; the override route (/proj/auto/uebersteuern) is Andreas' hand and is never called here
  { name: 'proj_auto_zustand', description: 'Give overridden automation lanes back (re-enable). A lane is overridden (uebersteuert: true in proj_lage) when Andreas grabbed its field (fader, pan, mute or solo of a track) on the page or the controller; '
    + 'it then keeps his value instead of following the line. Give {re_enable: true} to re-enable every overridden lane, or {spur_id, ziel} (ziel: fader | pan | mute | solo) for one. '
    + 'This tool only re-enables: Cypher cannot override a lane and cannot arm automation recording: both are Andreas\' hand, no tool exists for either, and the server answers such a request from Cypher with nur_andreas. A take that Andreas records arrives as an ordinary lane, readable with proj_auto, and he can lock it with auto_aendern. A lane that is not overridden stays as it is. The lane follows the line again from the next block, with a short blend, not a jump. '
    + 'Answers {ok: true, quittung, alle: true | spur_id, ziel}. Refused: ki_gestoppt (409, Stop Cypher is set: wait for Andreas), argument_ungueltig (400: give re_enable true, or spur_id and ziel, not both), argument_ungueltig also for a half call, a non-string spur_id or a ziel outside fader | pan | mute | solo (refused here without a request; the server answers auto_ziel_unbekannt 400 as a backstop), kein_kern (503); only with spur_id and ziel: kein_projekt, spur_unbekannt (404).',
    inputSchema: { type: 'object', properties: {
      re_enable: { type: 'boolean', description: 'true = re-enable every overridden lane' },
      spur_id: { type: 'string', description: 'track id from proj_lage, e.g. s3 (with ziel, instead of re_enable)' },
      ziel: { type: 'string', enum: ['fader', 'pan', 'mute', 'solo'], description: 'the field of that track' } } },
    // the low-level server does not check the schema: a wrong combination is refused here without a request
    lauf: async (p) => {
      const hat = (k: string) => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
      const nein = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      if (hat('re_enable')) {   // shape 1: {re_enable: true} and nothing else
        if (p.re_enable !== true) return nein('re_enable must be true (or leave it out and give spur_id and ziel)');
        if (hat('spur_id') || hat('ziel')) return nein('re_enable true re-enables every lane: leave out spur_id and ziel, or leave out re_enable');
        return http('POST', '/proj/auto/re_enable', { alle: true });
      }
      // shape 2: {spur_id, ziel}
      if (!hat('spur_id') && !hat('ziel')) return nein('give re_enable true, or spur_id and ziel');
      if (typeof p.spur_id !== 'string') return nein(hat('spur_id') ? 'spur_id must be a string (a track id from proj_lage, e.g. s3)' : 'spur_id is missing (give it together with ziel)');
      if (!hat('ziel')) return nein('ziel is missing (give it together with spur_id)');
      if (p.ziel !== 'fader' && p.ziel !== 'pan' && p.ziel !== 'mute' && p.ziel !== 'solo') return nein('ziel must be fader, pan, mute or solo');
      return http('POST', '/proj/auto/re_enable', { spur_id: p.spur_id, ziel: p.ziel });
    } },
  // 1.14 Comping Slice 1 (R8, R10): audition of one take of a track; the choice is not part of the project and not undoable
  { name: 'take_vorhoeren', description: 'Audition one take of a track in the open project, or stop the audition. Give {spur_id, take_id}: that take plays instead of the track\'s comp (the track\'s own playback, not the project change); '
    + 'take_id null ends the audition and the comp plays again. Takes are made and edited with proj_aendern (take_neu, take_umbenennen, take_loeschen, comp_waehlen); proj_lage shows the takes of each track. On an instrument track the take is a MIDI take and the audition plays its notes. '
    + 'The audition is not part of the project: it is not saved, not undoable and not in the history. Answers {vorhoeren: {<spur_id>: <take_id>}} (every track that is being auditioned; empty = none). '
    + 'Refused: take_unbekannt, aufnahme_laeuft, kein_projekt, ki_gestoppt (Stop Cypher is set: wait for Andreas); argument_ungueltig (400) locally for an empty or non-string spur_id, or a take_id that is neither a non-empty string nor null.',
    inputSchema: { type: 'object', required: ['spur_id', 'take_id'], properties: {
      spur_id: { type: 'string', description: 'track id from proj_lage, e.g. s3' },
      take_id: { type: ['string', 'null'], description: 'take id from proj_lage, or null to end the audition' } } },
    // the low-level server does not check the schema: a wrong shape is refused here without a request
    lauf: async (p) => {
      const nein = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      if (typeof p.spur_id !== 'string' || p.spur_id === '') return nein('spur_id must be a non-empty string (a track id from proj_lage, e.g. s3)');
      if (!Object.prototype.hasOwnProperty.call(p, 'take_id') || (p.take_id !== null && (typeof p.take_id !== 'string' || p.take_id === ''))) return nein('take_id must be a non-empty string (a take id from proj_lage) or null to end the audition');
      return http('POST', '/proj/take_vorhoeren', { spur_id: p.spur_id, take_id: p.take_id });
    } },
  // S17: sound snapshot of the project (Baukasten graph + knob values per channel)
  { name: 'proj_bk', description: 'Sound snapshot of the open project: which Baukasten graph sits on erz/2, erz/3, deck/1|2, pad/1|2 (fx/3, fx/4 on request) and the graph knob values <kanal>/bk/1..64. '
    + 'aktion lage = saved against live per channel ({kanaele: [{kanal, gespeichert, live, regler_gespeichert, regler_live, gleich}]}; gleich true/false, null = a live value is unknown). '
    + 'merken = save what is loaded now (one undo step "Cypher Modular: save sound"; kanaele optional, default erz/2, erz/3, deck/1|2, pad/1|2 that have a graph; never removes an entry, remove one with proj_aendern bk_setzen {kanal, graph: null}); '
    + 'answers bk {gemerkt, unbekannt} (unbekannt = knobs whose live value was unknown: their stored value is kept). laden = apply the saved sound now (knobs, then graph). '
    + 'Opening the project and a kern restart apply it by themselves. Undo changes only the project, it does not change the running sound. '
    + 'Refused while Stop Cypher is set (ki_gestoppt); channels whose stream has AUTO off are skipped (auto_aus); bk_nicht_geladen, bk_nichts_geladen, kein_projekt (409).',
    inputSchema: { type: 'object', properties: {
      aktion: { type: 'string', enum: ['lage', 'merken', 'laden'] },
      kanaele: { type: 'array', items: { type: 'string' }, description: 'channels, e.g. ["erz/3", "deck/1"] (merken, laden); default: all that apply' } }, required: ['aktion'] },
    // the low-level server does not check the schema: an unknown aktion is refused here without a request
    lauf: async (p) => (p.aktion !== 'lage' && p.aktion !== 'merken' && p.aktion !== 'laden' ? { code: 400, j: { fehler: 'aktion_unbekannt', text: 'aktion must be lage, merken or laden' } }
      : p.aktion === 'lage' ? http('GET', '/proj/bk') : http('POST', p.aktion === 'merken' ? '/proj/bk/merken?antwort=kurz' : '/proj/bk/laden', p.kanaele ? { kanaele: p.kanaele } : {})) },
  // Paket 1.13 Slice 6 (D1, D14, D15): Stems trennen; die Antwort des Servers ist {auftrag_id, frames}, das Ende liest projStems aus /proj/aktuell
  { name: 'proj_stems', description: 'Separate one audio clip of the open project into stems on the GPU (BS-RoFormer; drums, bass, other, vocals always, '
    + 'guitar and piano only when they are not empty, otherwise they are in other): the whole clip or '
    + 'von_beat..bis_beat inside it (at most 600 s of source; about 45 s for 8 min). GPU only: less than 4.5 GB free ends with fehler gpu_belegt, '
    + 'no GPU with keine_gpu, the project unchanged. The end is one project change with one undo step: the original part is muted, four to six new '
    + 'tracks with the stems lie under it in a group "Stems: <name>", warped like the original. The call waits until the end (fertig, abgebrochen, veraltet, '
    + `fehler with grund) or up to ${FRIST_VORGABE_MS.proj_stems / 60_000} min (DJK_HAND_FRIST_PROJ_STEMS_MS), `
    + 'then answers laeuft with auftrag_id; the run goes on. '
    + 'If the project was changed or closed meanwhile, the run is cancelled and the answer is unbekannt (the result is not visible here: check proj_lage); '
    + 'a failed status query also answers unbekannt with detail. Only one run at a time (stems_laeuft). Refused on a track of Andreas (nur_andreas_spur), with Stop Cypher (ki_gestoppt), with a looped clip (stems_loop), with more or less than '
    + 'one audio clip in the range (mehrere_clips), when six free tracks are missing (zu_viele_spuren), before the core has reported (kein_kernstand), '
    + 'with a range over 600 s of source (stems_zu_gross). Runs on the GPU only (BS-RoFormer, about 45 s per 8-minute track, about 3 GB video memory); without a free GPU it is refused (keine_gpu, gpu_belegt).',
    inputSchema: { type: 'object', properties: {
      clip_id: { type: 'string', description: 'audio clip id from proj_lage, e.g. c3 (or spur_id)' },
      spur_id: { type: 'string', description: 'track id; exactly one audio clip must lie in the range' },
      von_beat: zahl('first project beat (default: clip start)', { minimum: 0 }), bis_beat: zahl('end beat (default: clip end)', { minimum: 0 }),
      geraet: { type: 'string', enum: ['cpu', 'gpu'], description: 'default gpu (falls back to the CPU when the GPU is busy); cpu forces the CPU' } } },
    lauf: (p) => projStems(p) },
  { name: 'proj_stems_abbrechen',
    description: 'Cancel the running stem separation (auftrag_id from proj_stems): the run ends with abgebrochen, nothing changes. Unknown id or a run that has already ended: kein_auftrag; zu_spaet only while the result is being saved.',
    inputSchema: { type: 'object', required: ['auftrag_id'], properties: { auftrag_id: { type: 'integer', minimum: 1 } } },
    lauf: (p) => http('POST', '/proj/stems/abbrechen', { auftrag_id: p.auftrag_id }) },
  // plan 1.11 tasks 8 and 10: the foreign plugins. Cypher may list, look at, read and set parameters; the scan and the plugin window are Andreas' hand only.
  { name: 'plugins', description: 'Foreign plugins (VST3, LV2). aktion liste {text?, art? (effekt | instrument | sonst)}: the plugin index [{id, format, pfad, uid, name, hersteller, art, audio_ein, audio_aus, parameter (count), status (ok | blockiert), grund?, text?}], at most 200 entries (abgeschnitten, gesamt say more; narrow it with text); an empty list means no scan has run yet (Andreas starts it). '
      + 'A VST3 bundle with several classes lists every class as its own entry; they load one by one through a small shim the install builds '
      + '(vst3_klasse/build.sh), and without it the later classes are blockiert (grund mehrklassen). '
      + 'aktion zeige {id}: one entry; plugin_unbekannt (404) when the ID is not in the index. Put an effect on a strip with proj_aendern insert_setzen art "host" and plugin_id (only status ok and art effekt). '
      + 'aktion parameter {insert_id or spur_id}: the parameters of the plugin on that host stage (or of the plugin instrument of that track) [{index, name, min, max, vorgabe, einheit, wert (0..1)}]; insert_id is the stage id from proj_lage (art host). '
      + 'A parameter can also be automated: proj_aendern auto_neu with ziel plugin.<stage id>.<index> (0..1, at most 16 lanes per host stage). '
      + 'A parameter can also sit on a controller knob: proj_aendern plugin_regler_setzen {insert_id, knopf 1..16, index} (index_doppelt when the parameter has another knob); the knob is the controller row plug/<host slot>/k<knopf>, a plugin lane on the same parameter wins while the transport plays; Andreas learns the controller onto the knob. '
      + 'A plugin with audio_ein >= 4 (a compressor with a sidechain input) takes a sidechain key on its host stage: proj_aendern insert_setzen art "host" with key, or insert_param_setzen param "key"; other plugins are kein_schluessel. '
      + 'A plugin INSTRUMENT is the device of a track: proj_aendern spur_neu {art: "instrument", geraet: {art: "wirt", name: "plugin", plugin_id}} (only status ok and art instrument, else kein_instrument; it takes one of the two Surge slots, a third host track is slot_belegt); parameter and param take spur_id of that track instead of insert_id. '
      + 'aktion param {insert_id or spur_id, werte: {<index>: 0..1}}: sets plugin knobs directly in the host (no project command, no undo step; Stop Cypher blocks it with ki_gestoppt). Reasons: insert_unbekannt, host_fehlt (host not ready), param_unbekannt, argument_ungueltig. '
      + 'There is no rescan, unblock or window action here: Andreas does those.',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['liste', 'zeige', 'parameter', 'param'] },
      text: { type: 'string', description: 'liste: part of the name, maker or path' }, art: { type: 'string', enum: ['effekt', 'instrument', 'sonst'] },
      id: { type: 'string', description: 'zeige: the plugin ID from liste' }, insert_id: { type: 'string', description: 'parameter, param: the host stage id' },
      spur_id: { type: 'string', description: 'parameter, param: the track id of a plugin instrument track (instead of insert_id)' },
      werte: { type: 'object', description: 'param: {<parameter index>: value 0..1}, 1 to 256 entries' } } },
    lauf: async (p) => {
      const fehlt = (was: string) => fehlerAntwort(400, 'argument_fehlt', `plugins ${String(p.aktion)} needs ${was}`);
      const stufe = typeof p.insert_id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(p.insert_id) ? p.insert_id : null;
      if (p.aktion === 'liste' || p.aktion === 'zeige') {
        const q = new URLSearchParams();
        if (p.aktion === 'liste') { if (typeof p.text === 'string' && p.text) q.set('text', p.text); if (typeof p.art === 'string' && p.art) q.set('art', p.art); }
        const r = await http('GET', `/plugins${q.size ? `?${q}` : ''}`);
        if (r.code !== 200) return r;
        const alle = (Array.isArray(r.j.plugins) ? r.j.plugins : []) as Json[];
        if (p.aktion === 'zeige') {
          if (typeof p.id !== 'string' || p.id === '') return fehlt('id');
          const e = alle.find((x) => x.id === p.id);
          return e ? { code: 200, j: e } : fehlerAntwort(404, 'plugin_unbekannt', 'that plugin is not in the plugin index');
        }
        return { code: 200, j: { plugins: alle.slice(0, 200), gesamt: alle.length, ...(alle.length > 200 ? { abgeschnitten: true } : {}) } };
      }
      if (p.aktion === 'parameter' || p.aktion === 'param') {
        const spur = typeof p.spur_id === 'string' && /^s[0-9]{1,6}$/.test(p.spur_id) ? p.spur_id : null;
        if (stufe !== null && spur !== null) return fehlerAntwort(400, 'argument_ungueltig', 'insert_id and spur_id name the same plugin: give one');
        if (stufe === null && spur === null) return fehlt('insert_id (the host stage id) or spur_id (a plugin instrument track)');
        const basis = spur !== null ? `/proj/spur/${spur}/geraet` : `/proj/insert/${stufe}`;
        if (p.aktion === 'parameter') return http('GET', `${basis}/parameter`);
        if (p.werte === null || typeof p.werte !== 'object' || Array.isArray(p.werte)) return fehlt('werte {<index>: 0..1}');
        return http('POST', `${basis}/param`, { werte: p.werte });
      }
      return fehlerAntwort(400, 'aktion_unbekannt', 'aktion is liste, zeige, parameter or param');
    } },
  { name: 'presets_suchen', description: SUCHE.description, inputSchema: SUCHE.input_schema as Json,
    lauf: (p) => http('POST', '/presets/suche', p) },
  { name: 'presets_lesen', description: 'Read one preset with its values, description and tags. id is the register id <werk|nutzer>:<geraet>/<slug> as presets_suchen returns it, e.g. werk:komp/drum-bus. A malformed id is refused here without a request.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'register id, e.g. werk:komp/drum-bus or nutzer:rb338/my-bass' } } },
    lauf: async (p) => {
      if (typeof p.id !== 'string' || !PRESET_ID.test(p.id)) return fehlerAntwort(400, 'preset_id_ungueltig', 'a preset id looks like werk:komp/drum-bus or nutzer:rb338/my-bass (<werk|nutzer>:<geraet>/<slug>)');
      const [, herkunft, geraet, slug] = /^(werk|nutzer):([^/]+)\/(.+)$/.exec(p.id)!;
      return http('GET', `/presets/${herkunft}/${encodeURIComponent(geraet)}/${encodeURIComponent(slug)}`);
    } },
  { name: 'presets_speichern', description: 'Save a preset as a user preset (nutzer), marked as mine (autor cypher). Give exactly one of werte (plugin parameter values by their ids, with geraet) or ziel (take the current values of a target, see presets_anwenden for the target shapes; only spur and insert targets; geraet and graph then come from the target and must not be given). beschreibung is {art, unterart, charakter[], genre[], einsatz[], energie 1..5, text}: its words come only from the closed vocabulary of presets_suchen; a refused word comes back as details with the allowed words (erlaubt), correct and send again. Saving over an existing name needs ueberschreiben true, and I may overwrite only presets I saved myself (else nur_andreas_preset); factory presets (werk) are read only. Answer {herkunft, geraet, slug, geaendert}; read it back with presets_lesen id nutzer:<geraet>/<slug>.',
    inputSchema: { type: 'object', required: ['name', 'beschreibung'], properties: {
      name: { type: 'string', description: 'preset name (the file name is derived from it)' },
      geraet: { type: 'string', description: 'device id (rb338, baukasten, komp, eq, saett, hall, ...); required with werte, not allowed with ziel' },
      beschreibung: { type: 'object', description: '{art, unterart, charakter: [..], genre: [..], einsatz: [..], energie: 1..5, text}, words from the vocabulary' },
      werte: { type: 'object', description: 'parameter values by plugin id (plain values, enums by their text, switches as booleans)' },
      stifte: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, description: 'patch field pins [satz 0..1, zeile 0..15, spalte 0..15, wert -1..1 but not 0], sorted, no position twice (device baukasten with werte only; with ziel the pins come from the track)' },
      ziel: PRESET_ZIEL, graph: { type: 'string', description: 'Baukasten graph name (device baukasten only)' },
      tags: { type: 'array', items: { type: 'string' } }, notiz: { type: 'string' },
      ueberschreiben: { type: 'boolean', description: 'replace an existing user preset of this name (only one I saved)' } } },
    lauf: async (p) => {
      const hatW = p.werte !== undefined, hatZ = p.ziel !== undefined;
      if (hatW === hatZ) return fehlerAntwort(400, 'werte_oder_ziel', 'give exactly one of werte (values by plugin id, with geraet) or ziel (a target whose current values are taken)');
      if (hatW) {
        if (typeof p.geraet !== 'string') return fehlerAntwort(400, 'geraet_fehlt', 'saving werte needs geraet (the device id)');
        return http('POST', '/presets', definiert(p, 'name', 'geraet', 'beschreibung', 'werte', 'stifte', 'graph', 'tags', 'notiz', 'ueberschreiben'));
      }
      if (p.geraet !== undefined || p.graph !== undefined) return fehlerAntwort(400, 'geraet_aus_ziel', 'with ziel the device and graph come from the target; do not give geraet or graph');
      return http('POST', '/presets/von_ziel', definiert(p, 'ziel', 'name', 'beschreibung', 'tags', 'notiz', 'ueberschreiben'));
    } },
  { name: 'presets_anwenden', description: 'Apply a preset to a target: the server computes a plan from the preset, the target and the open project, and I send it through the normal routes, so it is one undo step with the source cypher (project targets: one proj_aendern with the label "Preset <name>"; kern channel targets: one regler call per value, no ramp; it stops at the first refusal and reports which values were accepted, which one was refused and which were never sent). Target shapes: {art: "spur", spur_id} (rb338 or bk track: its device values; a bk preset on a track with another graph is refused with graph_anders unless graph_laden is true), {art: "insert", insert_id} (an existing stage gets the values), {art: "insert_neu", strang_id} (a new stage at the end of the chain), {art: "kanal", kanal} (kern source channel such as deck/1: channel compressor and mix tools; an instrument channel such as erz/6: the 64 graph knobs). A refused plan sends nothing (kein_ziel for hall presets, art_nicht_aktiv, geraet_passt_nicht, kanal_art, ziel_unbekannt, kein_projekt). graph_laden true (optional, default false) lets a Baukasten instrument preset load its own instrument: on a track with another bk graph the track exchanges its graph in the same undo step (hinweise: graph_gewechselt, the old knob values are not carried over, a graph with latency stays refused on a SEQ pattern: graph_latenz); on an instrument channel I send the graph (POST /graph) FIRST and the knob requests only after the kern accepted it, a refused graph sends no knob. Without it a preset of another graph is refused graph_anders or kein_graph; a preset whose instrument is not installed is refused graph_fehlt. The answer carries uebersprungen (parameters the target cannot carry, never dropped silently) and hinweise; applying values to a frozen track drops its freeze (hinweise: freeze_geht). rev defaults to the current project revision (proj_lage); rev_veraltet means someone changed it: read again.',
    inputSchema: { type: 'object', required: ['id', 'ziel'], properties: { id: { type: 'string', description: 'register id <werk|nutzer>:<geraet>/<slug>' }, ziel: PRESET_ZIEL, rev: { type: 'integer', minimum: 0 },
      graph_laden: { type: 'boolean', description: 'true: a Baukasten instrument preset loads its graph on the target first (track: exchanged in the same change; channel: graph sent before the knobs). Default false: another graph is refused.' } } },
    lauf: (p) => presetsAnwenden(p) },
  { name: 'kollektionen', description: 'Collections: named lists of samples, presets and devices. Without slug: all collections [{slug, name, anzahl, autor?, geaendert}]. With slug: that collection {slug, name, autor?, angelegt, geaendert, posten}; an item is {art: "sample", sha} | {art: "preset", id} | {art: "geraet", geraet}. Read only; change with kollektion_aendern.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string', description: 'collection slug, e.g. dark-stuff' } } },
    lauf: (p) => (typeof p.slug === 'string' ? http('GET', `/kollektionen/${encodeURIComponent(p.slug)}`) : http('GET', '/kollektionen')) },
  { name: 'kollektion_aendern', description: 'Change collections. aktion neu {name}: create one (marked as mine). aktion posten {slug, hinzu?: [item], weg?: [item], erwartet?}: add and/or remove items (items as in kollektionen; erwartet = the geaendert stamp you read, a stale one is refused with veraltet; at most 500 items). aktion umbenennen {slug, name}. aktion loeschen {slug} (the collection goes to the trash folder). I may remove items from, rename or delete only collections I created myself (else nur_andreas_kollektion); I may add items to any. When Andreas renames one of mine it becomes his, and from then on I may not change it.',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['neu', 'posten', 'umbenennen', 'loeschen'] }, slug: { type: 'string' }, name: { type: 'string' },
      hinzu: { type: 'array', items: { type: 'object' } }, weg: { type: 'array', items: { type: 'object' } }, erwartet: { type: 'string', description: 'the geaendert stamp of the collection as read' } } },
    lauf: (p) => {
      const slug = typeof p.slug === 'string' ? encodeURIComponent(p.slug) : null;
      const fehlt = (was: string) => fehlerAntwort(400, 'argument_fehlt', `kollektion_aendern ${String(p.aktion)} needs ${was}`);
      if (p.aktion === 'neu') return typeof p.name === 'string' ? http('POST', '/kollektionen', { name: p.name }) : fehlt('name');
      if (p.aktion === 'posten') {
        if (!slug) return fehlt('slug');
        if (p.hinzu === undefined && p.weg === undefined) return fehlt('hinzu and/or weg');
        return http('POST', `/kollektionen/${slug}/posten`, definiert(p, 'hinzu', 'weg', 'erwartet'));
      }
      if (p.aktion === 'umbenennen') return !slug ? fehlt('slug') : typeof p.name !== 'string' ? fehlt('name') : http('POST', `/kollektionen/${slug}/umbenennen`, { name: p.name });
      if (p.aktion === 'loeschen') return slug ? http('POST', `/kollektionen/${slug}/loeschen`, {}) : fehlt('slug');
      return Promise.resolve(fehlerAntwort(400, 'aktion_unbekannt', 'aktion is one of neu, posten, umbenennen, loeschen'));
    } },
];

// Paket 1.13 Slice 6 (D1): proj_stems startet und fragt /proj/aktuell?noten=zahl ab, bis der Lauf endet oder die Frist abläuft; danach laeuft mit auftrag_id,
// der Lauf geht auf dem Server weiter (kein Abbruch). Frist: FRIST_VORGABE_MS.proj_stems (20 min,
// Begründung in FRIST_GRUND), Umgebung DJK_HAND_FRIST_PROJ_STEMS_MS.
// Nachbesserung T9: der Server bindet `stems` an das offene Projekt (session.ts); nach Wechsel oder Schließen fehlt das Feld. Fehlt der EIGENE Lauf in
// mindestens STEMS_FEHLT_N Abfragen in Folge UND STEMS_FEHLT_MS lang (flüchtiges Fehlen bleibt erlaubt), endet das Werkzeug mit `unbekannt`; eine Antwort
// ≠ 200 beendet sofort mit `unbekannt` und ihrem detail. Fremde Stände (andere auftrag_id) gelten als „eigener Lauf fehlt“.
export const STEMS_FEHLT_N = 3;
export const STEMS_FEHLT_MS = (): number => { const v = Number(process.env.DJK_HAND_STEMS_FEHLT_MS); return Number.isFinite(v) && v >= 0 ? v : 2000; };
export const STEMS_UNBEKANNT = 'project changed or closed, the run was cancelled or its result is not visible here; check proj_lage';
export async function projStems(p: Json): Promise<{ code: number; j: Json }> {
  const koerper: Json = {};
  for (const k of ['clip_id', 'spur_id', 'von_beat', 'bis_beat', 'geraet']) if (p[k] !== undefined) koerper[k] = p[k];
  const s = await http('POST', '/proj/stems', koerper);
  if (s.code !== 200) return s;
  const id = (s.j as { auftrag_id: number }).auftrag_id;
  const frist = fristVon('proj_stems');
  const t0 = Date.now();
  let fehltSeit = 0, fehlt = 0;
  for (;;) {
    const a = await http('GET', '/proj/aktuell?noten=zahl');
    if (a.code !== 200) {
      const d = [a.j.fehler, a.j.text, a.j.detail].filter((x) => typeof x === 'string').join(': ');
      return { code: 200, j: { auftrag_id: id, zustand: 'unbekannt', text: STEMS_UNBEKANNT, detail: `/proj/aktuell answered ${a.code}${d ? ` (${d})` : ''}` } };
    }
    const st = (a.j as { stems?: Json }).stems as (Json & { auftrag_id?: number; zustand?: string }) | undefined;
    const eigen = st && st.auftrag_id === id;
    if (eigen && st.zustand !== 'laeuft') return { code: 200, j: st };
    if (eigen) { fehlt = 0; } else {
      if (fehlt === 0) fehltSeit = Date.now();
      fehlt++;
      if (fehlt >= STEMS_FEHLT_N && Date.now() - fehltSeit >= STEMS_FEHLT_MS()) {
        return { code: 200, j: { auftrag_id: id, zustand: 'unbekannt', text: STEMS_UNBEKANNT } };
      }
    }
    if (Date.now() - t0 >= frist) {
      return { code: 200, j: { ...(eigen ? st : {}), auftrag_id: id, zustand: 'laeuft', text: `still running after ${Math.round(frist / 1000)} s (tool limit, `
        + 'DJK_HAND_FRIST_PROJ_STEMS_MS); the run goes on: call proj_lage later (field stems) or proj_stems_abbrechen' } };
    }
    await new Promise((r) => setTimeout(r, Math.min(2000, Math.max(50, frist / 8))));
  }
}

// Note editor B5: proj_noten. Without flags GET /proj/noten; erkennen posts the run, then reads /proj/aktuell every second (the field `noten` of the run's auftrag_id)
// until it ends or the deadline passes (laeuft with auftrag_id, the run goes on); abbrechen posts the auftrag_id. A run whose own state vanishes (project closed or
// switched) ends with unbekannt like proj_stems (same thresholds).
export const NOTEN_UNBEKANNT = 'project changed or closed, the run was cancelled or its state is not visible here; read the clip with proj_noten (analyse) or proj_lage';
export const ungueltigNoten = (text: string): { code: number; j: Json } => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
export async function projNoten(p: Json): Promise<{ code: number; j: Json }> {
  const clip = p.clip_id;
  if (p.abbrechen !== undefined) {
    if (p.erkennen === true || p.neu !== undefined || clip !== undefined) return ungueltigNoten('abbrechen stands alone: give only the auftrag_id');
    if (!Number.isInteger(p.abbrechen) || (p.abbrechen as number) < 1) return ungueltigNoten('abbrechen: the auftrag_id (integer, 1 or more) is required');
    return http('POST', '/proj/noten/abbrechen', { auftrag_id: p.abbrechen });
  }
  if (typeof clip !== 'string' || clip === '') return ungueltigNoten('clip_id: a clip id is required');
  if (p.neu !== undefined && p.erkennen !== true) return ungueltigNoten('neu: only with erkennen: true');
  const lesen = (): Promise<{ code: number; j: Json }> => http('GET', `/proj/noten?clip_id=${encodeURIComponent(clip)}`);
  if (p.erkennen !== true) return lesen();
  const s = await http('POST', '/proj/noten/erkennen', p.neu === true ? { clip_id: clip, neu: true } : { clip_id: clip });
  if (s.code !== 200) {
    // antwort() keeps fehler, text and detail only: the id of the running job (noten_laeuft) goes into detail
    if (s.j.fehler === 'noten_laeuft' && typeof s.j.auftrag_id === 'number' && s.j.detail === undefined) s.j = { ...s.j, detail: `auftrag_id ${s.j.auftrag_id}` };
    return s;
  }
  const id = (s.j as { auftrag_id: number }).auftrag_id;
  const frist = fristVon('proj_noten');
  const t0 = Date.now();
  let fehltSeit = 0, fehlt = 0;
  for (;;) {
    const a = await http('GET', '/proj/aktuell?noten=zahl');
    if (a.code !== 200) {
      const d = [a.j.fehler, a.j.text, a.j.detail].filter((x) => typeof x === 'string').join(': ');
      return { code: 200, j: { auftrag_id: id, zustand: 'unbekannt', text: NOTEN_UNBEKANNT, detail: `/proj/aktuell answered ${a.code}${d ? ` (${d})` : ''}` } };
    }
    const st = (a.j as { noten?: Json }).noten as (Json & { auftrag_id?: number; zustand?: string }) | undefined;
    const eigen = !!st && st.auftrag_id === id;
    if (eigen && st.zustand !== 'laeuft') {
      if (st.zustand !== 'fertig') return { code: 200, j: st };
      const g = await lesen();
      return g.code === 200 ? { code: 200, j: { ...g.j, analyse: st } } : g;
    }
    if (eigen) { fehlt = 0; } else {
      if (fehlt === 0) fehltSeit = Date.now();
      fehlt++;
      if (fehlt >= STEMS_FEHLT_N && Date.now() - fehltSeit >= STEMS_FEHLT_MS()) return { code: 200, j: { auftrag_id: id, zustand: 'unbekannt', text: NOTEN_UNBEKANNT } };
    }
    if (Date.now() - t0 >= frist) {
      return { code: 200, j: { ...(eigen ? st : {}), auftrag_id: id, zustand: 'laeuft', text: `still running after ${Math.round(frist / 1000)} s (tool limit, `
        + 'DJK_HAND_FRIST_PROJ_NOTEN_MS); the run goes on: read the clip with proj_noten later (field analyse) or cancel it with abbrechen' } };
    }
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(50, frist / 8))));
  }
}

// 1.16 rest U5: presets_anwenden. The server only COMPUTES the plan (POST /presets/anwenden changes nothing); this function sends it, with the
// rules of check/b116_send.mjs sendePlan: weg 'proj' = ONE /proj/aendern {rev, label, befehle}; weg 'regler' = one /regler {pfad, nach, ab: jetzt}
// per request in order, stopping at the first refusal; a refused plan sends nothing. Refusal of a /regler: HTTP >= 400 or a kern quittung with a
// FEHL_STATUS (sendePlan stops on status 6 only; 4, 7 and 8 are failures for every other hand tool too, so they stop here as well).
export async function presetsAnwenden(p: Json): Promise<{ code: number; j: Json }> {
  if (typeof p.id !== 'string' || !PRESET_ID.test(p.id)) return fehlerAntwort(400, 'preset_id_ungueltig', 'a preset id looks like werk:komp/drum-bus or nutzer:rb338/my-bass (<werk|nutzer>:<geraet>/<slug>)');
  if (!isObj(p.ziel)) return fehlerAntwort(400, 'ziel_fehlt', 'ziel is an object such as {art: "insert", insert_id} (see the tool description)');
  const plan = await http('POST', '/presets/anwenden', { id: p.id, ziel: p.ziel, ...(p.graph_laden === true ? { graph_laden: true } : {}) });
  if (plan.code !== 200) return plan;
  const pl = plan.j as { weg?: string; label?: string; befehle?: Json[]; anfragen?: { pfad: string; nach: number }[]; uebersprungen?: string[]; hinweise?: string[]; graph?: { kanal: string; name: string } };
  const gemeinsam = { id: p.id, uebersprungen: pl.uebersprungen ?? [], hinweise: pl.hinweise ?? [] };
  if (pl.weg === 'proj') {
    const r = await mitRev(p, '/proj/aendern', { label: pl.label, befehle: pl.befehle });
    if (r.code >= 400) return r;
    return { code: 200, j: { ok: true, weg: 'proj', label: pl.label, ...gemeinsam, rev: r.j.rev, kern: r.j.kern } };
  }
  if (pl.weg === 'regler') {
    const anfragen = pl.anfragen ?? [];
    // D28: the plan of a sound whose instrument is not on the channel carries the graph. It goes FIRST and the kern must accept it (quittung 2, 3 or 5, like
    // proj_strom_aufnehmen) before any knob is sent: knobs into a channel without the graph would land on the wrong instrument.
    if (pl.graph) {
      const g = await http('POST', '/graph', { kanal: pl.graph.kanal, name: pl.graph.name });
      const gq = g.j.quittung as { status: number; grund: string } | null | undefined;
      if (g.code >= 400 || !gq || ![2, 3, 5].includes(gq.status)) {
        const grund = g.code >= 400 ? (g.j.fehler ?? `http ${g.code}`) : gq ? (gq.grund || 'graph_nicht_bestaetigt') : 'keine_quittung';
        const text = g.code >= 400 ? g.j.text : gq ? `the kern did not accept the graph ${pl.graph.name} (status ${gq.status})` : `the kern did not answer the load of the graph ${pl.graph.name} in time (check graphen geladen)`;
        return { code: g.code >= 400 ? g.code : 409, j: { ...g.j, fehler: grund, text, detail: { angenommen: [], abgelehnt: 'graph', offen: anfragen.map((x) => x.pfad), ...gemeinsam } } };
      }
    }
    for (let i = 0; i < anfragen.length; i++) {
      const a = anfragen[i];
      const r = await http('POST', '/regler', { pfad: a.pfad, nach: a.nach, ab: 'jetzt' });
      const q = r.j.quittung as { status: number; grund: string } | null | undefined;
      if (r.code >= 400 || (q && FEHL_STATUS.has(q.status))) {
        return { code: r.code >= 400 ? r.code : 409, j: { ...r.j, fehler: r.j.fehler ?? q?.grund ?? `http ${r.code}`,
          detail: { angenommen: anfragen.slice(0, i).map((x) => x.pfad), abgelehnt: a.pfad, offen: anfragen.slice(i + 1).map((x) => x.pfad), ...gemeinsam, ...(r.j.detail === undefined ? {} : { regler: r.j.detail }) } } };
      }
    }
    return { code: 200, j: { ok: true, weg: 'regler', gesendet: anfragen.length, ...(pl.graph ? { graph: pl.graph.name } : {}), ...gemeinsam } };
  }
  return fehlerAntwort(502, 'plan_unbekannt', 'the page server answered a plan without a known weg (proj or regler)');
}
