// Moved unchanged out of hand.ts: the live tools (lage to klang) of the tool table.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mittle, zielAufTerz, gegenZiel, chroma, tonartPasst, parseTonart, urteil, KLASSEN } from './mischung.ts';
import { terzVon, TERZ_HZ } from '../ui/project/sound_contract.ts';
import { ALLE_STROEME } from '../contract/streams.ts';   // container core U7: the stream list is the shared table, not a copy here
import { OSZI_KANAELE } from '../ui/ear.ts';   // the channels of the envelope ring, one list for server and hand
import { loopOrdnerVorgabe } from '../ui/paths.ts';   // strand 11 task 7.10: the loop folder the stimme CLI writes into
import { bandMitteHz, SPEKTRUM_FRIST_MS } from '../ui/public/spectrum.js';   // 1.15 A9: one source for the band centres and the staleness limit
import {
  type Json, INSTANZ, stroemeListe, lageForm, http, httpGrund, zahl, deck12, deck, ab, raster, WARTE_FRIST_MAX_MS, proTaktVon, MISCHUNG_ZIELE,
  type Werkzeug, fehlerAntwort, mitRev,
} from './hand_core.ts';

export const WERKZEUGE_LIVE: Werkzeug[] = [
  { name: 'lage', description: 'Current state: master clock (beat, bar, bpm; uhr.naechster_takt and uhr.naechste_phrase_takt: the absolute bars a spur with ab takt / phrase would anchor at now), Stop-Cypher flag, decks 1-4 (track, bar in track, loop, open/closed; a deck on a SEQ place carries no track and reads status 0), the four places (plaetze: the type of each place, leer, track, strudel, seq, loops or stems, with its group) and the four containers (container: what each of the strips A..D plays), mixer values (fader, trim, trim_auto, eq, kill, filter of the four container strips deck/1, deck/2, pad/1, pad/2 and of the stream aliases erz/1-3, 5-7 always, a closed fader reads -200, an absent fader means the kern has not said it yet and is never 0 dB; sends 1, 2, 3 and 4 of those same channels, decks included (earlier only send 2 showed, not 1, 3, 4), duck, reverb return, glue once off their defaults, a send that is absent is off; after a kern restart all values are empty until the new kern reports them), the loop decks, FX, my last acknowledgements, and the studio: AUTO/pattern per instance, loaded Surge sound (after a set it reads "edited": the name then says nothing about the content), and ins_gr (only while a project insert stage computes: {"ins/komp/<n>": gain reduction in dB, "ins/saett/<n>": how far the clipper goes over its ceiling in dB (0 = never over), "ins/eq/<n>": the deepest dynamic change of the EQ stage in dB (positive = cut, negative = boost; only a stage with a dynamic band on reports), "ins/mb/<n>": the deepest band of a multiband stage in dB, "ins/mb/<n>/b1" .. "ins/mb/<n>/b3": the signed reading of each band (positive = gain reduction, negative = upward lift), "ins/trans/<n>": the largest level change of the transient shaper in the last block in dB (the size only, always 0 or more, a lift counts like a cut; an imager reports nothing), n = the slot of the stage as in proj_lage inserts; a stage that is bypassed or removed is absent after 0.5 s), hall_pool ({an, faeden, spaet, zurueck}: Hall pool of the kern for the return Halls, absent from an old kern; an false = no pool, no free cores or the pool switched itself off after repeated late blocks, the Halls then run in the callback and the sound stays the same), spur_pool ({an, modus, blocks_parallel, einheiten_worker, einheiten_caller, seriell, haengt, spaet, zurueck}: the pool of the kern for the track phases of the arrangement, absent only from an old kern (a kern without a pool sends zeros: an false, modus aus); modus is aus, an or auto as in force, an false = the phases run serial in the callback (also while the workers have no real-time priority), the sound stays the same; einheiten_worker counts units done on the workers, einheiten_caller the units the callback computed itself in phases that went to the pool (jobs it took back are in zurueck), haengt and spaet are late or stuck workers), and the digital output (ausgang.zustand: gut = on, aus = OFF and silent, kampf = keeps dropping, wache_stumm = watch not running, unbewacht = silent sink; faelle = dropouts this session). Call this before every move. Arguments: felder (top-level keys to keep, uhr always stays) and kurz (true: only what changed since the last lage or warte answer this hand gave: {uhr, ki, geaendert: {dotted path: value}, entfernt, spuren: channels touched, quittungen_neu}; the first kurz call returns everything). harmonie: the live harmony lane {tonart, folge, takte_je_akkord, ab_takt, jetzt: {takt, akkord}, naechster_wechsel_takt}.',
    inputSchema: { type: 'object', properties: { kurz: { type: 'boolean' }, felder: { type: 'array', items: { type: 'string' } } } }, lauf: async (p) => lageForm(await http('GET', '/lage'), p) },
  { name: 'bestand', description: 'Tracks that can be loaded (rendered at 128 BPM): material_id, title, key (camelot), original BPM, length. Optional text filter on title or key.',
    inputSchema: { type: 'object', properties: { suche: { type: 'string' }, max: { type: 'integer', minimum: 1, maximum: 50 } } },
    lauf: async (p) => {
      const r = await http('GET', '/bestand');
      const s = String(p.suche ?? '').toLowerCase(), max = Number(p.max ?? 20);
      const liste = (r.j as unknown as Json[]).filter((e) => !s || `${e.titel} ${e.camelot}`.toLowerCase().includes(s)).slice(0, max)
        .map((e) => ({ material_id: e.material_id, titel: e.titel, camelot: e.camelot, quelle_bpm: e.quelle_bpm, dauer_s: e.dauer_s }));
      return { code: r.code, j: { eintraege: liste } as unknown as Json };
    } },
  { name: 'laden', description: 'Load a track onto a deck. The deck must not be playing with its fader open. Fader is closed after loading.',
    inputSchema: { type: 'object', required: ['deck', 'material_id'], properties: { deck, material_id: { type: 'string' } } },
    lauf: (p) => http('POST', '/laden', p) },
  { name: 'deck_start', description: 'Start a deck in sync with the master, on the next bar by default (with another deck playing, on the next bar in phase with it: the downbeats meet), from the downbeat of the track (or quell_beat). Only on a CLOSED deck (fader down): that is how I pre-listen. On an open deck it is refused (ziel_ungehoert).',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck, ab, quell_beat: zahl('source beat to start from (default: first downbeat)') } },
    lauf: (p) => http('POST', '/deck/start', p) },
  { name: 'deck_stopp', description: 'Stop a deck (default: now).', inputSchema: { type: 'object', required: ['deck'], properties: { deck, ab } },
    lauf: (p) => http('POST', '/deck/stopp', p) },
  { name: 'sprung', description: 'Jump inside a track: to a source beat (ziel) or by delta beats. Snapped to the raster, phase kept. Refused on an open deck (unheard material).',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck, ziel: zahl('target source beat'), delta: zahl('beats to jump, negative = back'), raster } },
    lauf: (p) => http('POST', '/deck/sprung', { raster: 4, ...p }) },
  { name: 'loop', description: 'Deck loop on/off: beats 1, 2, 4, 8, 16, 32, 64 starts a loop at the raster; beats 0 ends it. Allowed on an open deck (repeats what is heard).',
    inputSchema: { type: 'object', required: ['deck', 'beats'], properties: { deck, beats: { type: 'integer', enum: [0, 1, 2, 4, 8, 16, 32, 64] }, raster } },
    lauf: (p) => http('POST', '/deck/loop', { deck: p.deck, laenge: p.beats, raster: p.raster ?? 4 }) },
  { name: 'pad', description: 'Hotcue pads 1-8: setzen (shot or loop cue at the playhead, or while a loop runs: that loop), spielen (jump in; refused on an open deck), loeschen.',
    inputSchema: { type: 'object', required: ['deck', 'nr', 'aktion'], properties: { deck, nr: { type: 'integer', minimum: 1, maximum: 8 },
      aktion: { type: 'string', enum: ['setzen', 'spielen', 'loeschen'] }, art: { type: 'string', enum: ['shot', 'loop'] },
      beats: { type: 'integer', enum: [1, 2, 4, 8, 16, 32, 64] }, raster } },
    lauf: async (p) => {
      const d: Json = { deck: p.deck, nr: p.nr, aktion: p.aktion, raster: p.raster ?? 1 };
      if (p.aktion === 'setzen') {
        const l = await http('GET', `/deck/loop?deck=${p.deck}`);
        if (p.art === 'loop' && (l.j as Json).laenge) Object.assign(d, { aus_loop: true, laenge: (l.j as Json).laenge });
        else {
          const lage = (await http('GET', '/lage')).j as { decks: Json[] };
          const q = lage.decks.find((x) => x.deck === p.deck)?.quell_beat;
          Object.assign(d, { quell_beat: q, art: p.art ?? 'shot', ...(p.art === 'loop' ? { laenge: p.beats ?? 4 } : {}) });
        }
      }
      return http('POST', '/deck/hotcue', d);
    } },
  { name: 'loop_nach_box', description: 'Load the running deck loop into a cell of loop deck 1 or 2 (box 1 = loop deck 1, box 2 = loop deck 2): POST /loopdeck/laden with the source {von_deck: deck}, into the first empty cell. '
    + 'Use loopdeck laden for a chosen track and cell. Refused: ki_gestoppt, deck_voll (no empty cell), quelle_unbekannt (the deck has no active loop), zu_lang, audio_budget, kein_loopdeck.',
    inputSchema: { type: 'object', required: ['deck', 'box'], properties: { deck, box: { type: 'integer', enum: [1, 2] } } },
    lauf: (p) => httpGrund('POST', '/loopdeck/laden', { deck: p.box, quelle: { von_deck: p.deck } }) },
  // plan live-module task 4: the live modules (the live container is the project that runs during a set; a module = one exported deck loop with its stems)
  { name: 'live_oeffnen', description: 'Open the live container, the persistent project that holds the live modules (places A to D, a module sits in one place), creating it on first use. '
    + 'If it is already open this changes nothing. Closes the project that was open like proj_oeffnen. I cannot confirm a switch away from a RUNNING live '
    + 'container while a deck plays: that is refused with live_laeuft, Andreas confirms on the page. Answers slug and slots (the group id per slot, null = empty). '
    + 'A module group of an older live project that still sits at -200 dB is raised to 0 dB on the open when the channel of its container is closed; with the channel open it stays and the answer names the slot under fader.gemeldet. '
    + 'Needed once before modul_export.',
    inputSchema: { type: 'object', properties: {} },
    lauf: () => http('POST', '/live/oeffnen', {}) },
  { name: 'modul_export', description: 'Export the running loop of a deck (1, 2, 3 or 4; normally deck 3 on headphones) as a module of the live container: the loop is cut '
    + 'sample-exact from the deck rendering and sounds at once through the module Loop track, the stem separation (drums, bass, other, vocals, guitar and piano when '
    + 'present) runs in the background on the GPU and replaces the loop when it is done (follow it with modul_stand). The module plays on a DJ channel: place A (also 1) on deck/1, B (2) on deck/2, C (3) on pad/1, D (4) on pad/2, through the strip of that container (trim, EQ, kill, filter, fader, PFL). '
    + 'The module group fader stays at 0 dB; the channel fader is the only gain. The channel is closed at the export (Andreas brings it in with the strip, I cannot open it: regler on that strip answers kein_hoerschein), the original of each stem is the track below its stem group. '
    + 'slot A to D (or 1 to 4); without slot the '
    + 'server takes the first free place whose channel is closed (order C, D, A, B). Refused with kanal_offen (the channel of that slot is open: trim plus fader above -26 dB or a planned or running ramp; PFL does not matter; without slot: every free slot is open), slot_belegt (that slot holds a module: modul_leeren first), kein_loop (no loop on the deck), kein_bibliothekstrack '
    + '(the deck does not play a library track), kein_liveprojekt (live_oeffnen first), ki_gestoppt (Stop Cypher). A busy GPU does not refuse the export: the module stays '
    + 'loop-only and modul_stand names gpu_belegt, modul_stems tries again. Answers slot, gruppe_id, laenge_beats, rev, stand.',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck, slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' } } },
    lauf: (p) => http('POST', '/modul/export', p) },
  { name: 'modul_leeren', description: 'Clear a live slot: the module fades out over takte bars (0 = at once; 0, 1, 2, 4, 8 or 16) and is then removed, the slot is free again. '
    + 'Every module is saved to the module library at export and again when cleared. Refused with slot_leer (nothing in that slot) and rampe_laeuft (a fade of that slot is running).',
    inputSchema: { type: 'object', required: ['slot', 'takte'], properties: { slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' }, takte: { type: 'integer', enum: [0, 1, 2, 4, 8, 16], description: 'bars to fade out over, 0 = at once' } } },
    lauf: (p) => http('POST', '/modul/leeren', p) },
  { name: 'modul_stems', description: 'Separate the stems of a module again when it has none: after a failed separation (gpu_belegt, stems_fehler), a busy GPU or a server restart. '
    + 'Starts the run in the background and answers at once with the slot state; follow it with modul_stand. Refused with slot_leer, modul_hat_stems (already separated), '
    + 'stems_laeuft (a run of that slot is going), kein_liveprojekt, ki_gestoppt.',
    inputSchema: { type: 'object', required: ['slot'], properties: { slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' } } },
    lauf: (p) => http('POST', '/modul/stems', p) },
  { name: 'modul_stand', description: 'State of the four places: per slot null (empty) or {gruppe_id, name, titel, stems: {stems: wartet | laeuft | fertig | fehler, grund?, text?, auftrag_id?}}. '
    + 'wartet = decoding the loop, laeuft = separating (the percent is in proj_lage stems), fertig = the stem groups are in the module, fehler = loop-only module with the reason in grund and text.',
    inputSchema: { type: 'object', properties: {} },
    lauf: () => http('GET', '/modul/stand') },
  { name: 'modul_tonart',
    description: 'Adapt the module of live place A to D to the key of the deck on the master (the playing deck with the loudest channel): the whole module moves by the '
      + 'shortest semitone distance (-6..+6, major and minor relative keys counted as equal, Am to Cm is +3); MIDI notes by pitch, stem clips by warp transpose_st '
      + '(drums in repitch mode stay); the MIDI of drum tracks (drum-map graph or kit) stays, there the note picks the drum. One undo step. The shift is stored on the module, so calling it again changes nothing. GET /modul/stand shows tonart_abstand per slot. '
      + 'Answers {slot, deck, deck_tonart, abstand, bewegt, transponiert, rev}. Reasons: kein_liveprojekt, slot_leer, kein_deck (no deck plays), tonart_unbekannt (module or deck key '
      + 'unknown), ki_gestoppt.',
    inputSchema: { type: 'object', required: ['slot'], properties: { slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' } } },
    lauf: (p) => http('POST', '/modul/tonart', { slot: p.slot }) },
  // SEQ deck v2 task 3 (spec 2026-11-14-seq-deck-design, sections 5 and 7): one tool for the sequencer decks of the DJ places; patterns are written and read as text
  { name: 'seq', description: 'The SEQ decks of the DJ places (platz 1 to 4): a deck holds patterns, a pattern is an instrument track with one MIDI clip and free lanes (notes, values per step, curves on a knob); the lanes are a view on ordinary project clips, so what is written here is the clip in PRODUCTION. '
    + 'Actions: stand (every place: null = no deck, else {gruppe_id, folgen: [{spur_id, clip_id, name, geraet, stumm, editierbar, laenge_beats, zeilen, text}]}; text is the pattern in the notation below; a pattern that is not editable (laid out in PRODUCTION) has editierbar false and no text), anlegen {platz} (builds an empty deck), '
    + 'folge {platz, text} (writes one or several patterns from the notation) or folge {platz, name} (reads one pattern of the deck as text, ignoring case), leeren {platz} (removes the deck and its patterns), modul {platz, slug, abschnitt?} (loads a Workbench module, the slugs of proj_liste entries with werkbank true, into the deck; with abschnitt (a section id from tracker song) any project, e.g. a tracker project, hands that one section to the deck (TO DJ): at most 64 beats, refused as abschnitt_zu_lang, abschnitt_unbekannt, abschnitt_leer or zu_viele_bk (Baukasten tracks of the live project plus the section, over 16), effect commands and sample slots come along, the tracker project is not changed. Per module: one pattern per instrument track with the same instrument, notes and knob values; a place without a deck gets one, a deck that is there gets the patterns added muted and named "<name> 2", "<name> 3" and so on; an answer {ok, bericht, rev, projekt, gruppe_id} where bericht lists the patterns and what was left out: sends, inserts, master inserts, returns, groups, chain automation, the key, audio and host instrument tracks, and notes beyond beat 64; it is one undo step and all or nothing, with kein_werkbank, modul_ohne_instrument, unbekannt, the track limits as projekt_ungueltig and the gates of anlegen for a new deck). Every write answers {rev, projekt, kern, gruppe_id}, or ohne_aenderung true when the text said what the project already holds. '
    + 'One text is ONE write and one undo step: all patterns of it, or none. A pattern I make by text starts muted (stumm), Andreas brings it in. The deck is heard on the strip of deck/<platz>: while the place holds a SEQ deck and no loaded track I can open that fader and trim with regler without a hearing pass (a loaded track needs the pass). '
    + 'NOTATION. A head line, then one line per lane: "folge <name> <instrument> <length>"; a name with spaces is in double quotes. Instruments: bk:<graph> (a Baukasten instrument), kit:<kit>, rb338. Length: 2bar, 3/4bar or 6b (beats), at most 64 beats, a multiple of 0.125 beat. For a pattern that exists, instrument and length may be left out: another length acts like the length control of the page (notes behind the new end go), another instrument is refused (argument_ungueltig, naming the playing one). A new pattern needs the instrument. The name is unique in the deck, ignoring case. '
    + 'Note lanes: "noten <lane id> [<note>] <grid> <cells>". Grids 1/4, 1/8, 1/16, 1/32. With a note (a number, a note name or a kit sound name) it is a trigger lane: one character per cell, . rest, x hit (velocity 100), X accent (127), o ghost (60); written back velocity falls into the bands up to 79, 80 to 110 and from 111. Without a note it is the pitched lane (one per pattern): tokens, . rest, a note name, ~ lengthens the note before it by one cell, c1+g1 a chord. Note names are those of the piano roll, 60 = c3, c-2 = 0, sharps d#1 (flats eb1 are read too). Spaces and | between cells are ignored (| marks bars). '
    + 'Value lanes: "werte <target> <grid> <cells> [je <length>]": a number per cell or . (no value). Targets: vel (velocity 1..127 of the notes of a note lane, the cell needs a note) and len (length in cells), with @<lane id> when the pattern has several note lanes (vel@kick); k<n> (knob n of a Baukasten instrument), a knob name without spaces (Cutoff), a knob name in double quotes ("Env amount"), for the RB-338 cutoff, resonanz, lautstaerke, env_mod (also its names); transpose, fader (track level dB), pan. Knob values are absolute 0..1. Where a werte vel line exists, it sets the velocities and x X o only say that a note is there; a len line wins over ~. A knob lane is an envelope: a cell without a number has no point and holds the value before it; the first cell always carries a value (it is written back with the value of the last cell; an envelope without a point at the start reads the value over the seam there, the last point, and writing that back changes nothing). k<n> with n 1 to 64 is a target of every Baukasten instrument; a knob the graph does not have reads back with the comment "; no such knob". je gives the envelope a length of its own (then the cell count follows it). '
    + 'Curve lanes: "kurve <target> <shape> <from> <to> [stufen <n>] [saat <n>] [je <length>]" with the shapes sinus, dreieck, saege, saege_ab, rechteck, rampe, zufall (stufen 1 to 64, default 8; the period is the length of the lane: the pattern, or je), or "kurve <target> punkte <beat>:<value> ..." (a point may end in @s or @sprung for the curve form; the beat is in the lane). '
    + 'A ";" starts a comment to the end of the line; read back, knobs are written as k<n> (the RB-338 by name) with the knob name as comment, a kit sound as comment after the note of its lane. '
    + 'A lane line is the whole lane: a cell with . has no note and no point afterwards. A lane the text does not name stays as it is. Reading back the text of a pattern and writing it changes nothing: a token that says the same as the data (same velocity band, same notes, same tie count, same value to two decimals) leaves that note or point as Andreas set it; a werte vel or len cell reads the value of the lowest note of the cell (a chord of velocities 90 and 40 reads as 90 and stays as it is), a really different value is set on every note of the cell. A lane id, a note or a target twice in one pattern is refused with both line numbers. A pattern shows all its lanes, also more than 32 derived ones; at most 32 lanes are stored (zu_gross when a write would store more). Cells count from 0 in the messages. '
    + 'Example: "folge bass  bk:bassmusik  2bar" then "noten bass  1/16  c1 ~ . c1 . . d#1 ~ . . c1 . g0 ~ ~ . | c1 ~ . c2 . . d#1 ~ . . f1 . g1 ~ . a#0", "werte vel  1/16  120 . . 64 . . 100 . . . 70 . 115 . . . | 120 . . 90 . . 100 . . . 76 . 108 . . 64", "werte k3  1/16  .25 . . .30 . . .55 . . . .35 . .80 . . . | .25 . . .90 . . .50 . . . .62 . .75 . . .40", "kurve k4  sinus .08 .92  je 3/4bar"; a drum pattern: "folge drums  kit:909  1bar", "noten kick 36  1/16  x...x...x.o.x...", "noten hat 42  1/32  x...o...x...o...x...o...x.o.oxxX". '
    + 'A line that does not fit (cell count, unknown knob, a knob name with spaces outside quotes, a value out of range, a note a trigger lane owns) refuses the whole text with argument_ungueltig and the line, lane and cell in the text; nothing is written. A knob lane on an instrument without that knob: huellkurve_ziel. '
    + 'Gates: anlegen is refused with kanal_offen when the channel deck/<platz> is open (trim plus fader above -26 dB), with deck_laeuft while deck <platz> plays, with seq_belegt when the place already holds a deck; I cannot clear a deck whose channel is open (kanal_offen), Andreas can; patterns may be written while the channel is open. Undo (proj_undo), redo (proj_redo) and opening a project are not gated by kanal_offen. Other refusals: seq_fehlt (no deck in that place), kein_liveprojekt (live_oeffnen first), ki_gestoppt (Stop Cypher), argument_ungueltig. '
    + 'SCENES (eight slots over all SEQ decks, stored in the project): szene_speichern {slot} saves the CURRENT mute picture (which patterns are on, which are off; I never pass ids), '
    + 'szene_starten {slot} switches all patterns of the scene together on the NEXT BAR (patterns join at their running position, mute is a level switch; a later press wins over a pending one; '
    + 'an M click between press and bar does not cancel it: the scene executes and overwrites), szene_loeschen {slot} empties the slot, szenen lists the slots as {szenen: [null or {an, aus} counts] x 8, aktiv, wartet}. '
    + 'slot is 1 to 8. Reasons: szene_leer_slot (starting an empty slot), szene_leer (no SEQ deck exists), kein_liveprojekt, ki_gestoppt, argument_ungueltig. '
    + 'A pattern that Andreas arranged in PRODUCTION (several clips, a clip that does not start at 0) is refused by name. The page shows the deck in place <platz> as soon as that place is silent.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['stand', 'anlegen', 'leeren', 'folge', 'modul', 'szene_speichern', 'szene_starten', 'szene_loeschen', 'szenen'] },
      platz: { type: 'integer', enum: [1, 2, 3, 4], description: 'the DJ place of the deck; needed by anlegen, leeren, folge and modul' },
      slot: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8], description: 'szene_speichern, szene_starten, szene_loeschen: the scene slot' },
      text: { type: 'string', description: 'folge: the notation, a head line and one line per lane, lines separated by a line break; one text may hold several patterns' },
      name: { type: 'string', description: 'folge: the name of a pattern of the deck; with name (and without text) the pattern is read back as text' },
      slug: { type: 'string', description: 'modul: the slug of a Workbench module (a proj_liste entry with werkbank true), or of any project with abschnitt' },
      abschnitt: { type: 'string', description: 'modul: the id of a section of that project (tracker song lists them): only that section goes to the deck' } } },
    lauf: async (p) => {
      const aktion = p.aktion;
      const falsch = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      if (aktion === 'stand') return http('GET', '/seq/stand');
      if (aktion === 'szenen') return http('GET', '/seq/szenen');
      if (aktion === 'szene_speichern' || aktion === 'szene_starten' || aktion === 'szene_loeschen') {
        if (typeof p.slot !== 'number' || !Number.isInteger(p.slot) || p.slot < 1 || p.slot > 8) return falsch(`${aktion} needs slot (1 to 8)`);
        return http('POST', '/seq/szene', { slot: p.slot - 1, aktion: aktion.slice('szene_'.length) });
      }
      if (aktion !== 'anlegen' && aktion !== 'leeren' && aktion !== 'folge' && aktion !== 'modul') return falsch('aktion: stand, anlegen, leeren, folge, modul, szene_speichern, szene_starten, szene_loeschen or szenen expected');
      if (typeof p.platz !== 'number' || !Number.isInteger(p.platz) || p.platz < 1 || p.platz > 4) return falsch(`${aktion} needs platz (1 to 4)`);
      if (aktion === 'folge') {
        if ((typeof p.text === 'string') === (typeof p.name === 'string')) return falsch('folge needs text (to write patterns) or name (to read one pattern as text), not both and not neither');
        if (typeof p.text === 'string') return http('POST', '/seq/text', { platz: p.platz, text: p.text });
        const s = await http('GET', '/seq/stand');
        if (s.code !== 200) return s;
        const eintrag = (s.j as Record<string, { folgen: { name: string; text: string | null; editierbar: boolean }[] } | null>)[String(p.platz)];
        if (!eintrag) return { code: 409, j: { fehler: 'seq_fehlt', text: `place ${p.platz} holds no SEQ deck` } };
        const f = eintrag.folgen.find((x) => x.name.toLowerCase() === String(p.name).toLowerCase());
        if (!f) return { code: 404, j: { fehler: 'folge_unbekannt', text: `place ${p.platz} has no pattern ${String(p.name)} (it has ${eintrag.folgen.map((x) => x.name).join(', ') || 'none'})` } };
        if (!f.editierbar || f.text === null) return { code: 409, j: { fehler: 'folge_nicht_editierbar', text: `pattern ${f.name} is arranged in PRODUCTION and has no text` } };
        return { code: 200, j: { platz: p.platz, name: f.name, text: f.text } };
      }
      if (aktion === 'modul') {
        if (typeof p.slug !== 'string' || p.slug === '') return falsch('modul needs slug (the slug of a Workbench module)');
        if (p.abschnitt !== undefined && (typeof p.abschnitt !== 'string' || p.abschnitt === '')) return falsch('modul: abschnitt must be a section id');
        return http('POST', '/seq/modul', { platz: p.platz, slug: p.slug, ...(p.abschnitt !== undefined ? { abschnitt: p.abschnitt } : {}) });
      }
      return http('POST', aktion === 'anlegen' ? '/seq/anlegen' : '/seq/leeren', { platz: p.platz });
    } },
  // tracker task 9 (spec 2026-11-18-tracker-design, section 5): the tracker view of the open project as text, and the section commands
  { name: 'tracker', description: 'The tracker view of the open project (the same raster as the TRACKER page): a song is a list of sections, a section is a raster of rows (rows per beat = lpb) over the instrument tracks; the raster is a view on ordinary MIDI clips, so what is written here is the clip in PRODUCTION. '
    + 'Actions: song (GET /tracker/song: {lpb, ticks, abschnitte: [{id, nr, name, von_beat, laenge_beats, zeilen, muster: [{spur_id, buchstabe, name, clip_id, verbund?}]}]}), lesen {abschnitt, von?, bis?, spuren?} (a section, or a range of rows (decimal) and tracks (letters, "A,B") as text), '
    + 'schreiben {text, rev?} (writes the text back), abschnitt_neu {nach?, zeilen?, name?}, abschnitt_duplizieren {id, als: verknuepft | kopie}, abschnitt_loeschen {id}, abschnitt_verschieben {id, richtung: -1 | 1}, abschnitt_laenge {id, zeilen}, abschnitt_umbenennen {id, name | null}. '
    + 'The section actions are the project commands of the same name, sent as a one-command list like proj_aendern (one undo step); id and nach are the section ids that song lists. '
    + 'TEXT. Head: "section NN "name"  rows R  lpb L  ticks T" and for a part "from XX to XX" (NN is the 0-based section number, rows in hex, both included). Then a legend line "row | A name | B name" (the letters of the instrument tracks; audio tracks are not in the text but keep their letter, so a letter can be skipped: write the letters as lesen shows them), then one line per row: the row in hex, then one block per track, separated by "|". '
    + 'A block holds its note columns (at most 8) separated by " / ", each "NOTE VOL DLY CHN RPT", then per effect column two spaces and "XXX vv". NOTE is C-3 (MIDI 60 = C-3), ... empty, === note off, lo a note below C-0 (it can be kept, not typed). VOL is hex 01..7F; the effect and knob values are hex 00..FF. DLY is a signed decimal, a percentage of a sixteenth ("+25", "-10", "..." none; on a note off the delay of its end). '
    + 'CHN is a chance 01..99, RPT repeats 2..8 (".." and "." none). An effect cell is "... .." empty, an effect command "CODE vv" (stored in the clip, in the column it stands in: "VIB 46", "ARP 37"; CODE in ARP SLU SLD GLD VIB TRM VSL LVL RTG PAN OFS REV, vv two hex digits; an unknown code refuses the line), K01..K64 a knob value (a jump point of that knob at the row; the knob values of a row are one set per track, a knob the block does not list is removed from that row) or ~~~ a drawn curve (shown, never written). Codes: ARP xy (each tick the pitch cycles through +0, +x, +y semitones), SLU xx (slide up xx/16 semitone per tick), SLD xx (slide down xx/16 semitone per tick), GLD xx (glide to the note of the row by xx/16 semitone per tick), VIB xy (vibrato, speed x/64 cycle per tick, depth y/8 semitone), TRM xy (tremolo, speed x, depth y/16 of the full level), VSL xy (volume slide, up x/64 or down y/64 of the full level per tick), LVL xx (level xx/FF from this row), RTG 0y (retrigger every y ticks), PAN xx (track pan, 00 left, 80 centre, FF right), OFS xx (sample offset xx/256 of the sample), REV 01 (the note plays backwards). ";" starts a comment, blank lines and spacing do not matter. '
    + 'INS: a track whose device has a slot role (the sampler graphs) has the column "INS" right after NOTE ("NOTE INS VOL DLY CHN RPT"), the slot of the note as two decimal digits 01..32 or ".." none; INS outside 01..32, or on a cell without a note, refuses the line, and a track without the role has no INS column. '
    + 'Example: "section 00 ""  rows 64  lpb 4  ticks 6  from 00 to 03", "row | A Bass", "00  | C-3 64 ... .. .  ... ..", "01  | D-3 7F ... 50 .  ... ..", "02  | === .. ... .. .  ... ..". '
    + 'WRITING. schreiben takes the text of lesen (edited): only the rows, tracks and note columns the text names are touched, and only a cell that differs from what the raster shows is written, so the text as read gives no commands (answer {rev, ohne_aenderung: true}). Head, section number, rows, lpb, ticks and legend letters must match the project. '
    + 'The whole text is ONE undo step. A line that does not fit refuses the whole text with argument_ungueltig and zeile (1-based) and nothing is written; a "===" in a cell where no note sounds is refused ("note off where no note sounds"). When a track has notes the raster does not show (more than 8 at one time) the head ends with "hidden: <letter> <n>", and writing never touches them. Other reasons: kein_projekt, tracker_live and tracker_werkbank (the live container and Workbench modules have no tracker view), rev_veraltet, and the section reasons of the commands (abschnitt_unbekannt, abschnitt_letzter, abschnitt_rand, abschnitt_grenze, abschnitt_verknuepft, zeit_schnitt). '
    + 'Answers of the writing actions are short like proj_aendern ({rev, kern, noten_zahl per clip}). '
    + 'import_mod {pfad} makes a NEW tracker module from a ProTracker module file (.mod, at most 4 MiB), given as <sample root>/<path in the root>: the samples become one bank graph, the song one history step; answer {slug, bank, rev, bericht, text}, the text says what was left out.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['song', 'lesen', 'schreiben', 'import_mod', 'abschnitt_neu', 'abschnitt_duplizieren', 'abschnitt_loeschen', 'abschnitt_verschieben', 'abschnitt_laenge', 'abschnitt_umbenennen'] },
      abschnitt: { type: 'string', description: 'lesen: the section id (song lists them)' },
      von: { type: 'integer', minimum: 0, description: 'lesen: first row of the part (decimal)' },
      bis: { type: 'integer', minimum: 0, description: 'lesen: last row of the part (decimal, included)' },
      spuren: { type: 'string', description: 'lesen: track letters of the part, comma separated ("A,C")' },
      text: { type: 'string', description: 'schreiben: the text form of a section or part' },
      rev: { type: 'integer', minimum: 0, description: 'schreiben and the section actions: the project rev (default: the current one)' },
      id: { type: 'string', description: 'abschnitt_duplizieren, _loeschen, _verschieben, _laenge, _umbenennen: the section id' },
      nach: { type: 'string', description: 'abschnitt_neu: the section after which the new one goes (default: the end)' },
      zeilen: { type: 'integer', minimum: 1, description: 'abschnitt_neu (default 64) and abschnitt_laenge: the rows of the section' },
      name: { type: ['string', 'null'], description: 'abschnitt_neu and abschnitt_umbenennen: the name (1 to 40 characters; null removes it)' },
      als: { type: 'string', enum: ['verknuepft', 'kopie'], description: 'abschnitt_duplizieren: linked members of the pattern, or unique copies' },
      richtung: { type: 'integer', enum: [-1, 1], description: 'abschnitt_verschieben: -1 earlier, 1 later' },
      pfad: { type: 'string', description: 'import_mod: the module file as <sample root>/<path>' },
      label: { type: 'string', description: 'the history label of a section action' } } },
    lauf: async (p) => {
      const aktion = p.aktion;
      const falsch = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      if (aktion === 'song') return http('GET', '/tracker/song');
      if (aktion === 'import_mod') {
        if (typeof p.pfad !== 'string' || p.pfad === '') return falsch('import_mod needs pfad (<sample root>/<path of the .mod file>)');
        return http('POST', '/tracker/import_mod', { pfad: p.pfad });
      }
      if (aktion === 'lesen') {
        if (typeof p.abschnitt !== 'string' || p.abschnitt === '') return falsch('lesen needs abschnitt (a section id, song lists them)');
        const q = new URLSearchParams({ abschnitt: p.abschnitt });
        for (const k of ['von', 'bis', 'spuren'] as const) if (p[k] !== undefined && p[k] !== null) q.set(k, String(p[k]));
        return http('GET', `/tracker/text?${q.toString()}`);
      }
      if (aktion === 'schreiben') {
        if (typeof p.text !== 'string' || p.text === '') return falsch('schreiben needs text (the text form of a section)');
        return mitRev(p, '/tracker/text', { text: p.text });
      }
      const felder: Record<string, string[]> = { abschnitt_neu: ['nach', 'zeilen', 'name'], abschnitt_duplizieren: ['id', 'als'], abschnitt_loeschen: ['id'],
        abschnitt_verschieben: ['id', 'richtung'], abschnitt_laenge: ['id', 'zeilen'], abschnitt_umbenennen: ['id', 'name'] };
      if (typeof aktion !== 'string' || !(aktion in felder)) return falsch('aktion: song, lesen, schreiben, import_mod, abschnitt_neu, abschnitt_duplizieren, abschnitt_loeschen, abschnitt_verschieben, abschnitt_laenge or abschnitt_umbenennen expected');
      const pflicht: Record<string, string[]> = { abschnitt_duplizieren: ['als'], abschnitt_verschieben: ['richtung'], abschnitt_laenge: ['zeilen'] };
      if (aktion !== 'abschnitt_neu' && typeof p.id !== 'string') return falsch(`${aktion} needs id (a section id)`);
      for (const k of pflicht[aktion] ?? []) if (p[k] === undefined) return falsch(`${aktion} needs ${k}`);
      if (aktion === 'abschnitt_umbenennen' && p.name === undefined) return falsch('abschnitt_umbenennen needs name (text, or null to remove it)');
      const befehl: Json = { befehl: aktion };
      for (const k of felder[aktion]) if (p[k] !== undefined) befehl[k] = p[k];
      return mitRev(p, '/proj/aendern', { label: typeof p.label === 'string' ? p.label : `Tracker ${aktion.replace('abschnitt_', 'section ')}`, befehle: [befehl] });
    } },
  // plan 1.11 tasks 8 and 10: the foreign plugins. Cypher may list, look at, read and set parameters; the scan and the plugin window are Andreas' hand only.
  // loop deck H1: the loop decks (2 decks x 4 tracks x 8 cells); routes /loopdeck/* and /loopset*
  { name: 'loopdeck', description: 'The loop decks (deck 1 or 2: 4 tracks of 8 cells, each cell holds a loop or a one-shot). A deck sounds through the container strip of the place that shows it (place N = strip N: A deck/1, B deck/2, C pad/1, D pad/2); the page shows it from the places, nothing to set. aktion: stand (both decks, beat, bpm), laden {deck, spur?, zelle?, quelle} (quelle is {loop: name}, {sha}, {modul: id, stem?} or {von_deck: 1..4}; without spur and zelle the first empty cell), '
    + 'start {deck, spur, zelle, versatz_beats?, raster?} (quantised to the grid), stopp {deck, spur?} (one track or the whole deck), szene {deck, zeile} (row 1..8 starts, others stop), sprung {deck, spur, slice 1..8} (jump inside the playing cell), raster {deck, raster}, '
    + 'zelle {deck, spur, zelle, name?, farbe?, art?, gain_db?, beats?, leeren?: true}, '
    + 'spur {deck, spur, fader_db? (-200..6), mute?, filter? (-1..1), eq? {tief, mitte, hoch} (dB -200..6; tief is LO, mitte is MID, hoch is HI), kill? {tief, mitte, hoch} booleans (a kill keeps the knob value), fx? {"1", "2", "3"} booleans (the FX 1 2 3 assignment of the track, like the 1 2 3 keys of a mixer channel; 3 sends the track into the Remix bus), send? {hall, delay} (dB -200..0; the first send opens the deck own HALL or DELAY return)} sets the channel strip of one track, '
    + 'effekt {deck, spur, graph?: name or \'\' to remove, an?: boolean} puts a Baukasten graph into the track effect slot or switches it, effekte lists the qualifying graphs {name, kurz, latenz}, set_speichern {deck, name}, set_laden {deck, name}, sets (the saved loop sets). '
    + 'Refused with 409 or 400: ki_gestoppt (Stop Cypher), zelle_leer, deck_voll (no empty cell), audio_budget (512 MiB of distinct audio), zu_lang (cell audio over 60 s), quelle_unbekannt, kein_loopdeck (that deck does not exist), nichts_gespielt (sprung on a track that never played), nur_loop (sprung on a one-shot cell), set_unbekannt, kein_platz (the 8 Baukasten stages, the 5 stages of the chain or the 4 returns are full), graph_unbekannt (not a qualifying graph). '
    + 'Also: projekt_offen, modul_nicht_umwandelbar, set_defekt, audio_fehlt, keine_uhr, zelle_laedt (the cell is still loading). szene and stopp may answer ok with abgelehnt [{spur, grund}]: tracks that refused, the rest went through. zelle leeren: true is sent alone.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['stand', 'laden', 'start', 'stopp', 'szene', 'sprung', 'raster', 'zelle', 'set_speichern', 'set_laden', 'sets', 'spur', 'effekt', 'effekte'] },
      deck: { type: 'integer', enum: [1, 2], description: 'loop deck 1 or 2' },
      spur: { type: 'integer', minimum: 1, maximum: 4 }, zelle: { type: 'integer', minimum: 1, maximum: 8 }, zeile: { type: 'integer', minimum: 1, maximum: 8 }, slice: { type: 'integer', minimum: 1, maximum: 8 },
      quelle: { type: 'object', description: 'laden: {loop: name} | {sha} | {modul: id, stem?: name} | {von_deck: 1..4}' },
      versatz_beats: { type: 'number' }, raster: { type: 'string', enum: ['1/4', '1/2', '1', 'takt', '4takte'], description: 'grid (start: for this start only; raster: the new deck grid)' },
      name: { type: 'string', description: 'zelle: cell name; set_speichern and set_laden: loop set name' }, farbe: { type: 'integer', minimum: 0, maximum: 15, description: 'cell colour 0..15' }, art: { type: 'string', enum: ['loop', 'einmal'] },
      gain_db: { type: 'number', minimum: -60, maximum: 12 }, beats: { type: 'number', minimum: 0.25, maximum: 64, description: 'a multiple of 0.25' }, leeren: { type: 'boolean' },
      fader_db: { type: 'number', minimum: -200, maximum: 6, description: 'spur: track fader in dB' }, mute: { type: 'boolean' }, filter: { type: 'number', minimum: -1, maximum: 1, description: 'spur: filter -1..1' },
      eq: { type: 'object', description: 'spur: EQ knobs in dB, -200..6', properties: { tief: { type: 'number', minimum: -200, maximum: 6 }, mitte: { type: 'number', minimum: -200, maximum: 6 }, hoch: { type: 'number', minimum: -200, maximum: 6 } } },
      kill: { type: 'object', description: 'spur: band kills, the knob value stays', properties: { tief: { type: 'boolean' }, mitte: { type: 'boolean' }, hoch: { type: 'boolean' } } },
      fx: { type: 'object', description: 'spur: FX 1 2 3 assignment of the track', properties: { '1': { type: 'boolean' }, '2': { type: 'boolean' }, '3': { type: 'boolean' } } },
      send: { type: 'object', description: 'spur: sends in dB, -200..0', properties: { hall: { type: 'number', minimum: -200, maximum: 0 }, delay: { type: 'number', minimum: -200, maximum: 0 } } },
      graph: { type: 'string', description: "effekt: graph name, '' removes the effect" }, an: { type: 'boolean', description: 'effekt: switch the effect on or off' } } },
    lauf: async (p) => {
      const falsch = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      const wege: Record<string, [string, string[]]> = {
        laden: ['/loopdeck/laden', ['deck', 'spur', 'zelle', 'quelle']],
        start: ['/loopdeck/start', ['deck', 'spur', 'zelle', 'versatz_beats', 'raster']],
        stopp: ['/loopdeck/stopp', ['deck', 'spur']],
        szene: ['/loopdeck/szene', ['deck', 'zeile']],
        sprung: ['/loopdeck/sprung', ['deck', 'spur', 'slice']],
        raster: ['/loopdeck/raster', ['deck', 'raster']],
        zelle: ['/loopdeck/zelle', ['deck', 'spur', 'zelle', 'name', 'farbe', 'art', 'gain_db', 'beats', 'leeren']],
        set_speichern: ['/loopset/speichern', ['deck', 'name']],
        set_laden: ['/loopset/laden', ['deck', 'name']],
        spur: ['/loopdeck/spur', ['deck', 'spur', 'fader_db', 'mute', 'filter', 'eq', 'kill', 'fx', 'send']],
        effekt: ['/loopdeck/effekt', ['deck', 'spur', 'graph', 'an']],
      };
      if (p.aktion === 'stand') return httpGrund('GET', '/loopdeck/stand');
      if (p.aktion === 'sets') return httpGrund('GET', '/loopsets');
      if (p.aktion === 'effekte') return httpGrund('GET', '/loopdeck/effekte');
      const weg = typeof p.aktion === 'string' && Object.hasOwn(wege, p.aktion) ? wege[p.aktion] : undefined;
      if (!weg) return falsch(`unknown aktion ${String(p.aktion)}`);
      const d: Json = {};
      for (const k of weg[1]) if (p[k] !== undefined) d[k] = p[k];
      return httpGrund('POST', weg[0], d);
    } },
  { name: 'session', description: 'The session view: the launch grid across the columns of both loop decks (columns L1.1 to L2.4 in the containers A..D that show them), scenes are rows 1..8 over all columns. '
    + 'stand returns the session stand {raster, szenen, beat, bpm, container: [{buchstabe, typ, name, spalten}], geparkt}: every column with its 8 cells ({halten: true} is a hold slot that a scene leaves alone), its play state and its mixer values. '
    + 'start {spur_id, zelle: 1..8, raster?} launches one cell (grid: raster, else the cell raster, else the session grid), stopp {spur_id?} stops one column or, without spur_id, every column. '
    + '`loopdeck szene` launches one deck\'s row; `session szene {zeile}` launches the row across all columns at one grid point: a filled cell starts, an empty slot stops its column, a hold slot is left alone, and a scene with a tempo also ramps the master tempo to it (over one beat, at the same grid point). '
    + 'raster {raster} sets the one launch grid of the live container (the session and both loop decks). '
    + 'szene_neu {nach?: 0..7} inserts an empty row after row nach (0 = at the top; absent = after the last row with content), szene_fangen {nach?} inserts a row with copies of the cells that play now (a pending launch does not count), '
    + 'szene_doppeln {zeile} copies a row right below itself, szene_loeschen {zeile} removes a row and moves the rows below up, szene_aendern {zeile, name?, farbe? 0..15, bpm? or null, takte? or null} edits a scene (null removes bpm or takte). Each write is one undo step. '
    + 'Refused with 409, 404 or 400: kein_projekt (no live project is open; the session view never opens one), zelle_leer, spur_unbekannt (no session column with that id), keine_uhr (no core clock yet), zelle_laedt (the cell is still loading), '
    + 'zeilen_voll (all 8 rows are in use, szene_neu, szene_fangen and szene_doppeln need row 8 free), ki_gestoppt (Stop Cypher), beschaeftigt (a scene with a tempo while a freeze runs; nothing of the scene is sent), argument_ungueltig. '
    + 'Cell editor (S1b): zelle {spur_id, zelle, transponieren? semitones, rueckwaerts?, blende?, scheiben?, keylock?, raster?, name?, farbe?, gain_db?, beats?, bpm?} edits a cell (null removes a field; transponieren needs keylock), '
    + 'huelle {spur_id, zelle, ziel: gain|filter|send.hall|send.delay, punkte: [{beat, wert, form?}] or null} sets or removes an envelope, scheiben {spur_id, zelle, teilung: 1/16|1/8|takt|transienten} cuts the cell into slices, '
    + 'neue_zelle {spur_id, zelle} renders the cell with its edits into a new cell in the next free slot (answers spur_id, zelle, trocken), zum_sampler {spur_id, zelle} writes the slices as a sampler kit, vorhoeren {spur_id, zelle, slot} plays one slice for me only. '
    + 'More refusals: nur_keylock (transponieren without keylock), scheiben_ungueltig, huelle_ungueltig, zellen_ungueltig (the project holds cells that fail the checks), deck_voll, audio_budget, einmal_zu_lang (scheiben on a one-shot without beats that is longer than 64 beats at its tempo: set beats and bpm by hand). '
    + 'szene and stopp may answer ok with abgelehnt [{spur_id, grund}]: columns that refused, the rest went through. szene also lists laedt [spur_id] (cells still loading, not started) and gehalten [spur_id] (hold slots, left alone); '
    + 'a scene with a tempo answers tempo (the ramp was acknowledged) or tempo_abgelehnt (the core refused it with its reason, or kein_kern when it gave no receipt), the starts of the scene stay in either case.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['stand', 'start', 'stopp', 'szene', 'raster', 'szene_neu', 'szene_fangen', 'szene_aendern', 'szene_doppeln', 'szene_loeschen', 'zelle', 'huelle', 'scheiben', 'neue_zelle', 'zum_sampler', 'vorhoeren'] },
      spur_id: { type: 'string', description: 'start, stopp, zelle, huelle, scheiben, neue_zelle, zum_sampler, vorhoeren: the column (its track id from stand)' }, zelle: { type: 'integer', minimum: 1, maximum: 8, description: 'start: the cell (row) 1..8' },
      zeile: { type: 'integer', minimum: 1, maximum: 8, description: 'szene, szene_aendern, szene_doppeln, szene_loeschen: the row 1..8' },
      raster: { type: 'string', enum: ['1/4', '1/2', '1', 'takt', '4takte'], description: 'start: for this start only; raster: the new launch grid' },
      nach: { type: 'integer', minimum: 0, maximum: 7, description: 'szene_neu, szene_fangen: insert after this row (0 = at the top)' },
      name: { type: 'string', description: 'szene_aendern: scene name, 0..32 characters' }, farbe: { type: 'integer', minimum: 0, maximum: 15, description: 'szene_aendern: scene colour 0..15' },
      bpm: { type: ['number', 'null'], description: 'szene_aendern: launching the scene ramps the tempo here (60..200); null removes it' },
      takte: { type: ['integer', 'null'], minimum: 1, maximum: 256, description: 'szene_aendern: scene length in bars; null removes it' },
      transponieren: { type: ['integer', 'null'], minimum: -24, maximum: 24, description: 'zelle: whole semitones -24..24 (needs keylock); null removes' }, rueckwaerts: { type: ['boolean', 'null'], description: 'zelle: play backwards; null removes' },
      blende: { enum: [true, null], description: 'zelle: true fades the loop seam out and in (a fixed fade, not a length); null removes' }, scheiben: { type: ['object', 'null'], description: 'zelle: {teilung, grenzen, folge} slice set; null removes' },
      keylock: { type: ['boolean', 'null'], description: 'zelle: keep the pitch; null removes' }, gain_db: { type: ['number', 'null'], description: 'zelle: cell gain in dB' },
      beats: { type: ['number', 'null'], description: 'zelle: cell length in beats' },
      ziel: { type: 'string', enum: ['gain', 'filter', 'send.hall', 'send.delay'], description: 'huelle: the envelope target' },
      punkte: { type: ['array', 'null'], items: { type: 'object' }, description: 'huelle: [{beat, wert, form?}]; null removes the envelope' },
      teilung: { type: 'string', enum: ['1/16', '1/8', 'takt', 'transienten'], description: 'scheiben: how to cut' },
      slot: { type: 'integer', minimum: 1, maximum: 64, description: 'vorhoeren: the slice' } } },
    lauf: async (p) => {
      const wege: Record<string, [string, string[]]> = {
        start: ['/session/start', ['spur_id', 'zelle', 'raster']],
        stopp: ['/session/stopp', ['spur_id']],
        szene: ['/session/szene', ['zeile']],
        raster: ['/session/raster', ['raster']],
        szene_neu: ['/session/szene_neu', ['nach']],
        szene_fangen: ['/session/szene_fangen', ['nach']],
        szene_aendern: ['/session/szene_aendern', ['zeile', 'name', 'farbe', 'bpm', 'takte']],
        szene_doppeln: ['/session/szene_doppeln', ['zeile']],
        szene_loeschen: ['/session/szene_loeschen', ['zeile']],
        zelle: ['/session/zelle', ['spur_id', 'zelle', 'transponieren', 'rueckwaerts', 'blende', 'scheiben', 'keylock', 'raster', 'name', 'farbe', 'gain_db', 'beats', 'bpm']],
        huelle: ['/session/huelle', ['spur_id', 'zelle', 'ziel', 'punkte']],
        scheiben: ['/session/scheiben', ['spur_id', 'zelle', 'teilung']],
        neue_zelle: ['/session/neue_zelle', ['spur_id', 'zelle']],
        zum_sampler: ['/session/zum_sampler', ['spur_id', 'zelle']],
        vorhoeren: ['/session/vorhoeren', ['spur_id', 'zelle', 'slot']],
      };
      if (p.aktion === 'stand') return httpGrund('GET', '/session/stand');
      const weg = typeof p.aktion === 'string' && Object.hasOwn(wege, p.aktion) ? wege[p.aktion] : undefined;
      if (!weg) return { code: 400, j: { fehler: 'argument_ungueltig', text: `unknown aktion ${String(p.aktion)}` } };
      const d: Json = {};
      for (const k of weg[1]) if (p[k] !== undefined) d[k] = p[k];
      return httpGrund('POST', weg[0], d);
    } },
  { name: 'box', description: 'Loop 1 / Loop 2 are loop deck 1 / 2. laden (name from the loop library) loads that library loop into a cell of the loop deck (POST /loopdeck/laden with the source {loop: name}): spur 1..4 and zelle 1..8 pick the cell, without them the first empty cell is used. Refused: ki_gestoppt, deck_voll, quelle_unbekannt, zu_lang, audio_budget, kein_loopdeck. '
    + 'start and stopp are gone: start a cell with loopdeck start, stop with loopdeck stopp, so they answer box_ersetzt.',
    inputSchema: { type: 'object', required: ['box', 'aktion'], properties: { box: { type: 'integer', enum: [1, 2] }, aktion: { type: 'string', enum: ['laden', 'start', 'stopp'] }, name: { type: 'string' },
      spur: { type: 'integer', minimum: 1, maximum: 4 }, zelle: { type: 'integer', minimum: 1, maximum: 8 } } },
    lauf: async (p) => {
      if (p.aktion !== 'laden') return { code: 409, j: { fehler: 'box_ersetzt', text: 'the core loop boxes are replaced by the loop decks: load with box laden, start and stop cells with loopdeck start and loopdeck stopp' } };
      if (typeof p.name !== 'string') return { code: 400, j: { fehler: 'argument_ungueltig', text: 'box laden needs name (a loop of the loop library)' } };
      const d: Json = { deck: p.box };
      if (p.spur !== undefined) d.spur = p.spur;
      if (p.zelle !== undefined) d.zelle = p.zelle;
      d.quelle = { loop: p.name };
      return httpGrund('POST', '/loopdeck/laden', d);
    } },
  { name: 'regler', description: 'Move a mixer control, optionally as a ramp over bars (my way to blend: channel fader, EQ, filter). Paths: deck/1|2/(fader|trim|eq/tief|eq/mitte|eq/hoch|kill/tief|kill/mitte|kill/hoch|filter), pad/1|2/... (deck/1, deck/2, pad/1 and pad/2 are the four container strips of the places A..D; pad/1 and pad/2 are the strips of places C and D, whatever the place holds; deck/N of a place that holds a SEQ deck and no loaded track opens without a hearing pass, a loaded track needs the pass: a stopped track on such a place is ejected by the first refused open, the answer says seq_geleert, then retry), the player rows deck/N/stem/*, erz/<n>/(fader|pfl|eq/*|kill/*|filter|bk/k) as aliases of the strip that plays stream n (the page server resolves them; with no strudel module placed they answer kein_strudel_modul), fx/1|2/(notenwert|rueckkopplung|rueckweg), duck/tiefe (dB -24..0, 0 = off: kick ducks bass and melody), duck/release (ms 50..600). <kanal>/komp/(an 0/1, schwelle dB -60..0, ratio 1..20, attack ms 0.1..100, release ms 10..1000, makeup dB 0..24, mix 0..1, sc 0..14 = sidechain key: 0 own signal, else source channel + 1, erz/1 = 5): compressor per source channel (container strips and stream aliases), after EQ/filter, before the fader; off by default. color/art (sound color FX like the XDJ-XZ, global for all channels: 0 FILTER, 1 SPACE, 2 DUB ECHO, 3 SWEEP, 4 NOISE, 5 CRUSH; set only, use ab:jetzt) and color/param (PARAMETER 0..1, default 0.5): the filter knob of every channel is the COLOR knob, center = dry, SPACE and DUB ECHO tails ring out when it returns to center. <kanal>/bk/1..64 (deck/1|2, pad/1|2, erz/1|2|3|5|6|7; 0..1, start value: the graph\'s own default, 0.5 where it has none; smoothed 20 ms in the engine) steer the knobs (up to 64, as many as the graph defines) of the graph loaded on that channel (effect graph or instrument graph on a container strip or an erz stream); a channel without a graph ignores them. fx/3/bk/1..64, fx/4/bk/1..64 (same range) steer the knobs of the effect graph on that send return. master/bk/1..64 (same range) steer the knobs of the effect graph on the DJ master sum (master insert, graph kanal \'master\'). Mix tools: <source>/gate/(an 0/1, schwelle dBFS -90..0, hysterese dB 0..24, ratio 1..100 = 100 hard gate, bereich dB -120..0, attack ms 0.1..500, hold ms 0..2000, release ms 1..5000, sc 0..14 = sidechain key as komp/sc) on deck/1|2 and pad/1|2 (the container strips; streams and their erz aliases have no gate rows); <source or bus>/util/(balance -1..1, breite % 0..200, bassmono Hz 0..500 = off, phase_l|phase_r|tausch|dc 0/1) on those and bus/1..4; bus/1..4 only: mb/an 0/1, mb/grenze_tief|grenze_hoch Hz 20..20000, mb/(tief|mitte|hoch)/(schwelle dB -60..0, ratio 1..20, attack ms 0.1..500, release ms 1..5000, knie dB 0..24, makeup dB -24..24 = trim on top of the automatic make-up, umgehen 0/1) = three-band compressor (every band adds back its own average gain reduction by itself, so compressing a band does not make it quieter; makeup 0 = automatic only), lim/(an 0/1, decke dBFS -60..0, abklingen ms 1..2000) = channel limiter (does nothing while kern.toml kanal_limiter_vorhalt_ms is 0, the default); global spektrum/kanal (0 off, 1..4 = the containers A..D = deck/1, deck/2, pad/1, pad/2, 5..8 = bus/1..4, 9 = master sum) picks the analyser source. All off or neutral by default, none of them counts as making things quieter for my autonomy. keylock (0/1, set only, default 1): one switch for all sources (decks, loop decks), 1 keeps the pitch at any tempo, 0 = varispeed. <kanal>/send/2 feeds the reverb (fx/2 return, 0 dB default; send -200..0 dB, -200 = off). trim is the hand part of the gain and ADDS to trim_auto, the read-only automatic gain of the loaded track (set at load, shown in lage as <strip>/trim_auto, refused as a write; a strip with no track reads 0). Units: fader/trim/eq in dB (fader -200..0, eq -200..+6), filter -1..+1, kill 0/1. Crossfader, master (master/pegel, master/kleber = threshold of the sum compressor 0..1, 0 = off), the channel targets and crossfader sides (<kanal>/ziel, <kanal>/xseite), PFL, cue/mix, cue/split, master/pfl, grp/<n>/cue and the bus faders are mine to move too. Still Andreas\' hand only (nur_hand): cue/pegel (the headphone level at his ears) and deck/<n>/transport (a holder of the jog, no value; use deck_start and deck_stopp). A raise of master/pegel, of a bus/<n>/fader or of the fader or trim of a loops or stems container by more than 6 dB must be a ramp of at least 1 bar (takte >= 1), else it is refused with nur_rampe; an unknown current level counts as quiet, so a set above -20 dB needs a ramp then. Stop Cypher still stops everything, including fx/routing and the live keys (ki_gestoppt). Opening a closed channel (trim+fader above -26 dB, deck/1|2 only) needs a valid hearing check from hoeren (urteil ok); the server attaches it. erz channels and container strips open freely with regler, whatever they play (the loops and stems strips are no longer refused), bus channels pass the hearing check as well, and while my ramp on a container is open I cannot load foreign material into it (box_offen_oder_faehrt). Automation tracks (spur) still may not open container strips. Andreas touching the control aborts my ramp (status 7 hand). A move into my own running ramp on the same path is queued to the ramp\'s end (verschoben_auf). Rejections at the start beat itself only show in lage (quittungen). Project mixer paths (spur/1..128/*, grp/1..16/*, pm/fader, the sends spur|grp/n/send/1..8, the returns ret/1..8/* and the insert stages ins/komp/1..160/* (an, schwelle, ratio, knie, attack, release, makeup, mix, schp, sc), ins/eq/1..160/* (an, out, propq, b1..b8/an|typ|freq|gain|q|steil|platz, and the dynamic bands d1..d8/dyn 0..4 (not a lane target)|schwelle dB -60..0|bereich dB -24..24, dyn_attack ms 0.1..100, dyn_release ms 5..1000) ins/saett/1..32/* (an, drive, out, mix, kurve 0..2, decke dBFS -24..0, knie dB 0..12), ins/trans/1..32/* (an, angriff dB -24..24, halten dB -24..24, tempo ms 1..100, out dB -24..12, mix 0..1), ins/bild/1..16/* (an, grenze_tief Hz 40..1000, grenze_hoch Hz 1000..12000, breite_tief 0..1, breite_mitte 0..2, breite_hoch 0..2, mono_unter Hz 0..300) and ins/lim/1..8/* (an, decke dBFS -60..0, abklingen ms 1..2000) and ins/utility/1..8/* (an, breite 0..4, mono_unter Hz, gain dB, balance) and ins/gate/1..16/* and ins/mb/1..8/* (an plus the values of the kind, mb as b1..b3/<name>, the upward group u1..u3/(schwelle dB -80..0|ratio 1..4|bereich dB 0..24) and sc 0..128 = the key, not a lane target) and the rack macros rack/1..12/m1..m4) are refused with ueber_projekt: they change only through the project (proj_aendern: spur_aendern, gruppenspur_aendern, master_aendern, send_setzen, return_aendern, insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung, rack_setzen, rack_makro).',
    inputSchema: { type: 'object', required: ['pfad', 'nach'], properties: { pfad: { type: 'string' }, nach: zahl('target value'),
      takte: zahl('ramp length in bars (0 = set)', { minimum: 0, maximum: 64 }), ab, form: { type: 'string', enum: ['s', 'linear'] } } },
    lauf: (p) => http('POST', '/regler', p) },
  { name: 'fx', description: 'Beat FX unit 1 or 2: art 1-8 (1 echo, 2 flanger, 3 phaser, 4 filter, 5 reverb: beats = decay time, param1 = size; 6 delay: one repeat, param1 = tone; 7 ping pong: repeats alternate left/right, param1 = feedback; 8 trans: beat gate, param1 = duty; 9 roll: records at on, repeats in beat length; 10 slip roll: like roll, re-records when beats change; 11 vinyl brake: slows to a stop over beats; 12 spiral: echo whose pitch glides when beats change, param1 = feedback), beats, wet 0..1, params 0..1, an. Only while AUTO is on and I am not stopped.',
    inputSchema: { type: 'object', required: ['einheit', 'art', 'beats', 'wet', 'an'], properties: { einheit: { type: 'integer', enum: [1, 2] },
      art: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, beats: { type: 'number' }, wet: zahl('0..1'), param1: zahl('0..1'), param2: zahl('0..1'), param3: zahl('0..1'), an: { type: 'boolean' } } },
    lauf: (p) => http('POST', '/fx', { param1: 0.5, param2: 0.5, param3: 0.5, ...p }) },
  { name: 'fx_zuweisung', description: 'Assign a channel to Beat FX 1 or 2 (kanal like deck/1, pad/1, erz/1, master), or to unit 3, the insert on fx/3 that carries the remix graph (any source channel such as deck/1|2, pad/1|2, erz/1..8, never master).',
    inputSchema: { type: 'object', required: ['einheit', 'kanal', 'an'], properties: { einheit: { type: 'integer', enum: [1, 2, 3] }, kanal: { type: 'string' }, an: { type: 'boolean' } } },
    lauf: (p) => http('POST', '/fx/zuweisung', p) },
  { name: 'graphen', description: 'Baukasten graphs in the graph folder (CYPHERDJ_BK_ORDNER, else $HOME/.config/cypherdj/baukasten, which is a link to the devices folder of the home folder, by default ~/cypherdj/werke/geraete, once the layout of INSTALL.md section 8 is in use): name, art (instrument = a synth/sampler that plays the notes of a Strudel stream; effekt = an insert with an input), regler_namen (the names of its knobs, numbered 1..64) and geladen (which graph sits on which channel, as the kern reports it; geladen_geprueft_vor_ms = age of the last kern report in ms, null = not known yet). uebersprungen lists files that were not usable (bad name or JSON). Free to read.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/graphen') },
  { name: 'graph', description: 'Put a Baukasten graph on a channel or take it off again (name "" removes). Instruments (art instrument) go on erz/2 (bass stream) or erz/3 (melody stream) and REPLACE that stream\'s sound (Surge or the Cypher synth) until removed (after a restart of the kern alone the page server loads the graph again; a full studio stop and start begins without it); the stream keeps playing its pattern through the graph. More instrument streams: erz/5, erz/6, erz/7 (streams 5, 6, 7) and erz/9, erz/10 (streams 9, 10, ordinary streams like the others). Streams 5..10 are played by one extra erzeuger process (djk/start/djk-stroeme, or djk-start --bk-stroeme); without it the call fails with kein_erzeuger. Write their patterns with strudel (strom 5, 6, 7, 9, 10); a stream parked without a graph is silent. erz/1 is a drum kit stream: no instrument there. Effects (art effekt) go on the container strips deck/1|2 and pad/1|2, the send returns fx/3, fx/4 or the DJ master sum (master: an insert that replaces the sum just before the master FX and the master fader; needs an eingang node, latency 0); their knobs are fx/3/bk/1..64, fx/4/bk/1..64, master/bk/1..64 (regler). Effects also go, as an insert on the channel before its fader, on erz/1..3 (Strudel drums, bass, melody) as an insert of the container strips (pad/1 and pad/2 are the strips of places C and D), knobs <kanal>/bk/1..64; a channel holds one graph: an effect on erz/2, erz/3 is refused with belegt while an instrument graph plays there, and the other way round. Sampler graphs read their files from <graph folder>/samples/ and may take a few seconds to load (the call waits up to 4 s; quittung null = no answer yet; graphen.geladen shows the kern state as soon as it has loaded). Refused while Stop Cypher is set (ki_gestoppt) and, for erz/N, while AUTO of that stream is off (auto_aus). A kern refusal comes back as a tool error with its reason (pruefung, kein_eingang, ...).',
    inputSchema: { type: 'object', required: ['kanal', 'name'], properties: { kanal: { type: 'string', enum: ['erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2', 'deck/1', 'deck/2', 'fx/3', 'fx/4', 'master', 'erz/1'] }, name: { type: 'string', description: 'graph name from graphen, or "" to remove' } } },
    lauf: (p) => http('POST', '/graph', { kanal: p.kanal, name: p.name }) },
  // Strand 11 task 7.10: voice phrases (WAV files made beforehand) become one slotted loop, are cut and put on an instrument channel.
  { name: 'stimme', description: 'Voice phrases as a playable instrument: turns several WAV files (one phrase each; make the WAVs first, this tool does no speech synthesis) into one loop of equal slots (stil roh = trimmed and levelled, fluester = whispered with a short echo), '
      + 'cuts it into one slice per phrase (method raster, scheiben = number of phrases unless given) and puts the cut on a channel. dateien = absolute paths of the WAVs (the order is the phrase order), takte = bars per phrase slot (default 1), name = loop name (refused when a loop of that name exists), '
      + 'kanal = erz/5, erz/6, erz/7, pad/1 or pad/2. Answers {loop, schnitt, kanal, noten}: noten is "note n-1 = phrase n" (play note 0 for the first phrase).',
    inputSchema: { type: 'object', required: ['dateien', 'stil', 'name', 'kanal'], properties: {
      dateien: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'absolute paths of the phrase WAV files, one phrase each' },
      stil: { type: 'string', enum: ['roh', 'fluester'] },
      takte: { type: 'integer', minimum: 1, maximum: 16, description: 'bars per phrase slot (default 1)' },
      name: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$', description: 'name of the new loop' },
      kanal: { type: 'string', enum: ['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'] },
      scheiben: { type: 'integer', minimum: 1, maximum: 64, description: 'slices of the cut (default: the number of phrases)' } } },
    lauf: async (p) => {
      const nein = (text: string) => fehlerAntwort(400, 'argument_ungueltig', text);
      const d = p.dateien;
      if (!Array.isArray(d) || d.length === 0 || d.some((x) => typeof x !== 'string' || !path.isAbsolute(x))) return nein('dateien must be a non-empty list of absolute paths');
      if (p.stil !== 'roh' && p.stil !== 'fluester') return nein('stil must be roh or fluester');
      if (typeof p.name !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(p.name)) return nein('name must match [A-Za-z0-9_-]{1,40}');
      if (!['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'].includes(p.kanal as string)) return nein('kanal must be erz/5, erz/6, erz/7, pad/1 or pad/2');
      if (p.takte !== undefined && (!Number.isInteger(p.takte) || (p.takte as number) < 1 || (p.takte as number) > 16)) return nein('takte must be an integer 1..16');
      if (p.scheiben !== undefined && (!Number.isInteger(p.scheiben) || (p.scheiben as number) < 1 || (p.scheiben as number) > 64)) return nein('scheiben must be an integer 1..64');
      const cli = process.env.DJK_STIMME_BAUEN;
      const skript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'voice_build.py');
      const argv = [...(d as string[]), '--stil', p.stil, '--name', p.name, '--loops', loopOrdnerVorgabe(INSTANZ), ...(p.takte !== undefined ? ['--takte', String(p.takte)] : [])];
      const lauf = await new Promise<{ ok: boolean; text: string }>((ok) => execFile(cli ?? 'python3', cli ? argv : [skript, ...argv], { timeout: 120000 }, (e, aus, err) =>
        ok(e ? { ok: false, text: err.trim() || e.message } : { ok: true, text: aus })));
      if (!lauf.ok) return fehlerAntwort(500, 'stimme_bauen_gescheitert', lauf.text);
      const schnitt = await http('POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: p.name }, name: p.name, methode: 'raster', scheiben: p.scheiben ?? d.length });
      const sid = (schnitt.j.schnitt as Json | undefined)?.id;
      if (schnitt.code !== 200 || typeof sid !== 'string') return schnitt.code === 200 ? fehlerAntwort(502, 'schnitt_ohne_id', 'the page server answered the cut without an id') : schnitt;
      const g = await http('POST', '/graph', { kanal: p.kanal, name: sid });
      if (g.code !== 200) return g;
      return { code: 200, j: { loop: p.name, schnitt: sid, kanal: p.kanal, noten: 'note n-1 = phrase n' } };
    } },
  { name: 'strudel', description: 'Send a Strudel pattern to one of the instances: strom 1 drums (erz/1), 2 bass (erz/2), 3 melody (erz/3); with the extra erzeuger process (djk-stroeme) also 5, 6, 7 (erz/5..7) and 9, 10 (erz/9, erz/10: ordinary streams), any stream of the shared table; a stream without a track gets one, and the streams above 3 sound only through a Baukasten graph (graph). A strudel module must be placed in a place (otherwise the call is refused with kein_strudel_modul). Plays from the next bar. Only while Andreas has AUTO on for that instance (auto_aus otherwise). A pattern without any onset in the 16 bars from the next bar on counts as silence, like `silence`: it releases notes that are still held at that bar line (a sparse pattern such as `.slow(32)` is silence in this sense and cuts a held long note; a pattern with an onset inside the 16 bars never does, held notes then ring to their own end). After the next bar, studio shows status.taub: Strudel fields that do not sound in this studio (cutoff = lpf, hcutoff = hpf, room, delay, fmi ...); do not rely on them. taub lists at least these fields once taub_muster equals nr (fields first heard in later bars are added). '
      + 'Pattern methods .rein(n) and .raus(n) fade a layer in or out: time zero is the bar where THIS pattern starts to apply (its switch bar), not the global cycle, and n is the number of bars. .rein(n) scales the level of every note onset by k squared (k = 0 at the switch bar, 1 after n bars), .raus(n) by (1-k) squared, so a .raus layer is silent after n bars but still sends its onsets; n must be > 0 (compile error otherwise). The factor multiplies gain if the pattern sets one, else velocity, else it becomes the gain. It acts per note onset: a held pad note does not fade, use a fader ramp (spur) for that. Send the next pattern without the .raus layers. '
      + 'bezeichnung (1..60 characters) names what the stream plays in plain words Andreas can say back ("conga", "acid line"); it is shown on the channel strip of the studio page and in lage studio.stroeme. Always name what you play. Every pattern write replaces the label, a write without bezeichnung (also silence) clears it. '
      + 'To make a stream follow a chord sequence, set the lane with harmonie and use .harm(oktave) or .akkordton(oktave) in the pattern.',
    inputSchema: { type: 'object', required: ['code'], properties: { code: { type: 'string' }, strom: { type: 'integer', enum: [...ALLE_STROEME] }, bezeichnung: { type: 'string', minLength: 1, maxLength: 60, description: 'what this stream plays, in plain words ("conga", "acid line")' } } },
    lauf: (p) => http('POST', '/strudel', { text: p.code, strom: p.strom ?? 1, ...(p.bezeichnung !== undefined ? { bezeichnung: p.bezeichnung } : {}) }) },
  { name: 'harmonie', description: 'Live harmony lane: a repeating chord sequence that the Strudel streams follow, so bass, pad and melody stay in one key and change chord together. Set it with folge, chord symbols separated by spaces ("Am7 Dm7 G7 Cmaj7"), takte_je_akkord bars per chord (1, 2, 4 or 8; default 1), optionally tonart ("A minor"; otherwise found from the chords). The lane starts at the next bar (ab takt, default) or the next phrase (ab phrase), or at anker_takt (an absolute bar; refused with anker_vorbei if it has passed); the sequence repeats from there. '
      + 'A change is ONE call: the generator re-plans every stream from that bar, so all of them land on the same downbeat. aus true switches the lane off (no folge needed). probe true only checks the symbols and answers without writing. '
      + 'In a Strudel pattern (strudel) use .harm(oktave) for scale degrees of the lane key, e.g. n("0 2 4 7").harm(2) is a bass on degrees, and .akkordton(oktave) for the tones of the lane chord, e.g. n("[0,1,2]").akkordton(4) is a pad. '
      + 'studio status.harmonie.fremd counts, per stream, planned notes that lie outside the lane. lage harmonie shows the lane now (chord now, next change bar). The lane is session state, not a project change: no undo, like strudel. Refused while Stop Cypher is set (ki_gestoppt). Bad symbols give argument_ungueltig naming the symbol.',
    inputSchema: { type: 'object', properties: { folge: { type: 'string', description: 'chord symbols separated by spaces, e.g. "Am7 Dm7 G7 Cmaj7"; required unless aus' }, takte_je_akkord: { type: 'integer', enum: [1, 2, 4, 8] }, tonart: { type: 'string', description: 'e.g. "A minor"' }, ab: { type: 'string', enum: ['takt', 'phrase'] }, anker_takt: { type: 'integer', description: 'absolute bar where the lane starts' }, probe: { type: 'boolean' }, aus: { type: 'boolean' } } },
    lauf: (p) => {
      const k = {};
      for (const f of ['folge', 'takte_je_akkord', 'tonart', 'ab', 'anker_takt', 'probe', 'aus']) if (p[f] !== undefined) k[f] = p[f];
      return http('POST', '/harmonie', k);
    } },
  { name: 'abbrechen', description: 'Abort all my running and waiting ramps and deck commands; values stay where they are.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('POST', '/abbruch', {}) },
  { name: 'tempo', description: 'Set the master tempo (60-200 BPM): a 4-beat ramp starting on the next bar. Loop decks, REC, Strudel and playing decks follow; a deck also starts at any tempo. All sources keep their pitch (keylock, on by default; `keylock` via regler). lage regler.keylock: 1 on, 0 off, null unknown. With keylock off decks and loop decks follow in varispeed: their pitch moves with the tempo (128 -> 132 is +0.5 semitones). Exceptions with keylock on, still varispeed: a deck in a loop (until loops get keylock), a core started without keylock (kern.toml keylock = false), and about 0.1 s after each deck event (start, jump, hotcue) until the stretcher takes over; lage decks[].hoerweg 1 means the pitch is held. Refused while Stop Cypher is set (ki_gestoppt) and while a project freeze runs (beschaeftigt: proj_freeze, or the freeze inside proj_export; ask again when it is done).',
    inputSchema: { type: 'object', required: ['bpm'], properties: { bpm: zahl('target BPM', { minimum: 60, maximum: 200 }) } },
    lauf: (p) => http('POST', '/tempo', { bpm: p.bpm }) },
  { name: 'ansage', description: 'Show one line on the studio page over every view: what I am doing now, for an audience (demo overlay). Up to 300 characters; an empty text hides it. It fades by itself after a reading time. Speaking through cypher-say with CYPHER_SAY_ZIEL=studio sets the spoken sentence as the line already (shown in the voice colour).',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 300, description: 'the line, empty = hide' } } },
    lauf: (p) => http('POST', '/ansage', { text: p.text }) },
  { name: 'warte', description: 'Wait on the master clock, then return the state (lage), with the same optional kurz and felder (the diff runs against the last answer this hand gave, not against the polls inside the wait). '
      + 'Default: takte 1-8 bars. With bis "spur_ende" and name (an automation track): wait until that track is vorher_takte bars (0-64, default 4) before its end and answer {grund: "vorher", rest_takte, ...lage}; '
      + 'grund "gestoppt" = the track vanished before its end (stopped), "beendet" = it ended on its own; an unknown name at the first poll is refused with spur_unbekannt. '
      + 'The wait has one fixed deadline set at the first poll (the remaining bars at 60 BPM plus 30 s, at most 15 minutes): when it is reached the answer is {bis: "frist", rest_takte, ...lage}; a master clock that has not moved for 10 s ends it with {bis: "uhr_steht", ...}. Bars are counted with the meter of lage (taktart), 4 beats when absent. '
      + 'Polls every 2 s. For a loop track ende_beat is the end of the pass that is running now, so the wait ends before this pass, not before the loop as a whole.',
    inputSchema: { type: 'object', properties: { takte: { type: 'integer', minimum: 1, maximum: 8 }, bis: { type: 'string', enum: ['spur_ende'] },
      name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$', description: 'bis spur_ende: the track name' }, vorher_takte: { type: 'integer', minimum: 0, maximum: 64, default: 4 },
      kurz: { type: 'boolean' }, felder: { type: 'array', items: { type: 'string' } } } },
    lauf: async (p) => {
      if (p.bis === 'spur_ende') {
        if (typeof p.name !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(p.name)) return { code: 400, j: { fehler: 'name_fehlt', text: 'bis spur_ende needs name (the track name)' } };
        const vorher = p.vorher_takte === undefined ? 4 : Number(p.vorher_takte);
        if (!Number.isInteger(vorher) || vorher < 0 || vorher > 64) return { code: 400, j: { fehler: 'vorher_takte', text: 'vorher_takte: integer 0..64' } };
        let frist = 0, letztesEnde = Infinity, erste = true, letzterBeat = -Infinity, bewegtSeit = Date.now();
        for (;;) {
          const [sp, l] = [await http('GET', '/spur'), await http('GET', '/lage')];
          const beat = (l.j as { uhr?: { beat?: number } }).uhr?.beat;
          if (typeof beat !== 'number') return { code: l.code >= 400 ? l.code : 502, j: { fehler: 'keine_uhr', text: 'GET /lage carries no master clock beat', lage: l.j } };
          const proTakt = proTaktVon(l.j);
          const liste = Array.isArray(sp.j) ? sp.j as { name?: string; ende_beat?: number }[] : [];
          const e = liste.find((x) => x.name === p.name);
          if (e === undefined || typeof e.ende_beat !== 'number') {
            if (erste) return { code: 404, j: { fehler: 'spur_unbekannt', text: `no running automation track named ${String(p.name)}` } };
            const grund = beat < letztesEnde ? 'gestoppt' : 'beendet';
            const f = lageForm(l, p);
            return f.code === 200 ? { code: 200, j: { grund, ...f.j } } : f;
          }
          const restBeats = e.ende_beat - beat;
          if (erste) frist = Date.now() + Math.min(WARTE_FRIST_MAX_MS, Math.max(0, restBeats) * 1000 + 30_000);   // one fixed deadline: the end at 60 BPM plus 30 s, capped
          erste = false; letztesEnde = e.ende_beat;
          if (restBeats <= proTakt * vorher) {
            const f = lageForm(l, p);
            return f.code === 200 ? { code: 200, j: { grund: 'vorher', rest_takte: Math.max(0, restBeats) / proTakt, ...f.j } } : f;
          }
          if (beat > letzterBeat) { letzterBeat = beat; bewegtSeit = Date.now(); }
          const bis = Date.now() - bewegtSeit >= 10_000 ? 'uhr_steht' : Date.now() > frist ? 'frist' : null;   // a stopped clock or the deadline ends the wait
          if (bis) {
            const f = lageForm(l, p);
            return f.code === 200 ? { code: 200, j: { bis, rest_takte: Math.max(0, restBeats) / proTakt, ...f.j } } : f;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!Number.isInteger(p.takte) || Number(p.takte) < 1 || Number(p.takte) > 8) return { code: 400, j: { fehler: 'takte', text: 'takte: integer 1..8 (or bis spur_ende with name)' } };
      const l0 = (await http('GET', '/lage')).j as { uhr: { beat: number } };
      const start = l0.uhr.beat, ziel = start + proTaktVon(l0) * Number(p.takte);
      const t0 = Date.now();
      // Frist: the time the bars take at the slowest master tempo (60 BPM, ramps may slow down on the way) plus 10 s; a fixed 30 s cut 8 bars short below 64 BPM (audit U28).
      const fristMs = proTaktVon(l0) * Number(p.takte) * 60_000 / 60 + 10_000;
      for (;;) {
        const l = await http('GET', '/lage');
        if ((l.j as { uhr: { beat: number } }).uhr.beat >= ziel) return lageForm(l, p);
        if (Date.now() - t0 > fristMs) return { code: 504, j: { fehler: 'warte_frist', text: `the master clock did not reach beat ${ziel} within ${Math.round(fristMs / 1000)} s (clock stopped?)`, lage: l.j } };
        await new Promise((r) => setTimeout(r, 100));
      }
    } },
  { name: 'hoeren', description: 'Listen to a deck behind its fader: six bands, loudness, peak, overlap with the '
      + 'running master per band, level difference, EQ suggestion (tief/mitte/hoch in dB) and bass swap hint. Works '
      + 'on a CLOSED deck: start it with deck_start first, wait 4 bars. A place that carries a SEQ deck (deck = the place number 1 to 4) is heard the same way: the SEQ deck plays into the strip of deck/N, so no deck_start is needed, the project transport (proj_transport start) must run and the pattern must not be muted. Use it again after changing EQ or trim. '
      + 'vergleich.trim_vorschlag_db is the absolute target for deck/N/trim in dB (current trim minus the level difference, clamped to -24..+24), meaningful only while the deck is closed; trim_unbekannt: true instead means the studio does not know the current trim (after a server restart), so no suggestion; none either if one side is silent. sync.partner names the deck that sync.deck_gegen_deck_ms was measured against, null without a running deck that has an open channel; a SEQ place is never a partner.',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck: deck12,
      takte: { type: 'integer', minimum: 1, maximum: 16, default: 4, description: 'bars to measure (default: 4)' } } },
    lauf: (p) => http('GET', `/hoeren?deck=${p.deck}&takte=${p.takte ?? 4}`) },
  { name: 'studio', description: 'Studio state of the Strudel instances (1 drums, 2 bass, 3 melody, plus the Baukasten streams 5, 6, 7, 9, 10 while their erzeuger runs): current pattern, AUTO flag (autonom) and author (von) per instance. Call before playing: AUTO off means Andreas holds that instance and my writes are refused (auto_aus). status.taub lists Strudel fields of the current pattern that do not sound here (at least these once taub_muster equals nr; fields first heard in later bars are added). With a harmony lane set (harmonie), status.harmonie per stream is {noten, fremd, fremd_toene}: planned notes, and how many of them (and which tones) lie outside the lane.',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const stroeme: Json[] = [];
      let code = 200;
      for (const strom of await stroemeListe()) {
        const r = await http('GET', `/strudel?strom=${strom}`);
        code = Math.max(code, r.code);
        stroeme.push({ strom, ...r.j });
      }
      return { code, j: { stroeme } };
    } },
  { name: 'loops', description: 'Loop library: name, beats and source of every recorded loop. still true = the file is digital silence (it loads but plays nothing; do not build on it). Use the names with box (laden) and loop_klang.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/loops') },
  { name: 'rec', description: 'Record the Strudel generators before trim into the loop library: DRUMS (erz/1) alone, or with summe: true the sum DRUMS + BASS + MELODY (erz/1+2+3; not the master, no fader, no FX, the sum can exceed 0 dB: set gain_db of the loop deck cell). beats 1, 2, 4, 8, 16 or 32, name [a-z0-9_-]{1,32}. Starts on the next multiple of beats. Works at any steady tempo (the loop is stored at 128 BPM and plays back at the master tempo); refused with ausserhalb_bereich while a tempo ramp is running or queued, and by the core while Stop Cypher is set or when a recording overlaps.',
    inputSchema: { type: 'object', required: ['beats', 'name'], properties: { beats: { type: 'integer', enum: [1, 2, 4, 8, 16, 32] }, name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' }, summe: { type: 'boolean', description: 'true: sum of erz/1+2+3 instead of erz/1' } } },
    lauf: (p) => http('POST', '/loop', { aktion: 'rec', beats: p.beats, name: p.name, ...(p.summe !== undefined ? { summe: p.summe } : {}) }) },
  { name: 'loop_klang', description: 'Turn a library loop into a Strudel sound rec0, rec1, ... (add-on to the drums kit), playable as s("rec0") without restart. Reloads the drums kit: it may cut sounding voices, so do it between phrases, not mid-fill. Refused while Stop Cypher is set or AUTO of instance 1 (drums) is off.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'loop name from loops' }, klang: { type: 'string', description: 'optional sound name' } } },
    lauf: (p) => http('POST', '/loop', { aktion: 'kit', name: p.name, ...(p.klang !== undefined ? { klang: p.klang } : {}) }) },
  { name: 'spur', description: 'Start an automation track: a list of moves on the bar grid, anchored at the next bar (ab: takt, default) or the next phrase (ab: phrase, 8 bars). Arguments: name [a-z0-9_-]{1,32}, fahrten, ab, anker_takt, probe. '
      + 'The anchor is the next bar or phrase on the absolute phrase grid (bar 1 mod 8); lage uhr.naechster_takt / uhr.naechste_phrase_takt name those bars now. anker_takt n (integer >= 1, at most 256 bars ahead) anchors at the absolute bar n instead of ab (not together with ab; anker_vorbei when it is already past, the answer names fruehester_takt). probe: true runs every check and answers the plan (anker_beat, anker_takt, ende_beat, muster) without scheduling anything, so you know the anchor before it fires. '
      + 'Each move: {ziel, ab_takt, takte?, nach?, von?, form?: "s"|"linear", muster?}. Targets (ziel): mixer paths (erz/2/filter, deck/1/eq/tief, ...), wirt:bass/<param> and wirt:melodie/<param> (Surge parameters), strom:<n> for n in 1, 2, 3, 5, 6, 7, 9, 10 (with muster: switch that stream\'s pattern at ab_takt; the Baukasten streams 5, 6, 7, 9, 10 need their generator running, else strom_ohne_erzeuger). A move on a DISCRETE Surge parameter of wirt:bass/<param> or wirt:melodie/<param> (one that is not continuous: a switch, a type, a mode) is a set: nach is the value, takte 0 or absent, no von, no form, not inside a loop. The host reloads its state at that beat, so use a silent beat: the reload cuts sounding notes. Sets of one host on the same beat travel together; spur_stopp drops sets still waiting. '
      + 'A track may not open a closed channel and may not touch an instance whose AUTO is off. Andreas touching a control aborts the move on it. Stop it with spur_stopp. '
      + 'Track mixer paths spur/1..128/* (fader, pan, mute, solo of a project track) and the group and master paths grp/1..16/* and pm/fader, the send paths spur|grp/n/send/1..8, the return paths ret/1..8/* (fader, pan, mute, solo, hall/*) and the insert stage paths ins/komp/1..160/*, ins/eq/1..160/* (also d1..d8/dyn|schwelle|bereich, dyn_attack, dyn_release), ins/saett/1..32/* (an, drive, out, mix, kurve, decke, knie), ins/trans/1..32/* (an, angriff, halten, tempo, out, mix), ins/bild/1..16/* (an, grenze_tief, grenze_hoch, breite_tief, breite_mitte, breite_hoch, mono_unter), ins/lim/1..8/* (an, decke dBFS -60..0, abklingen ms 1..2000) and ins/utility/1..8/* and ins/gate/1..16/* and ins/mb/1..8/* (b<m>/*, u<m>/schwelle|ratio|bereich, sc) and the rack macro paths rack/1..12/m1..m4 are refused with ueber_projekt: they change only through the project (proj_aendern: spur_aendern, gruppenspur_aendern, master_aendern, send_setzen, return_aendern, insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung, rack_setzen, rack_makro). '
      + 'A track mixer automation line inside a project is a lane, not a spur: proj_aendern auto_neu / auto_punkte / auto_aendern / auto_loeschen, read it with proj_auto. '
      + 'Loop (Studio track band): schleife_takte n (1..64) plays the moves as a pass of n bars again and again until spur_stopp; every move lies inside the pass '
      + '(ab_takt <= n, a ramp ends at n+1 at the latest, no set on bar n+1, no strom: targets). A hand on a target, AUTO off or Stop Cypher ends my loop. '
      + 'aendern: true changes a running loop of mine (same name, schleife_takte required, it may change) from its next pass, never inside the current one; '
      + 'the answer gives ab_beat/ab_takt (uebernaechster: true when the next pass was already on its way). aendern exists for loops only (keine_schleife) '
      + 'and only for the owner (nur_andreas on his loops). '
      + 'A strom: move with muster may carry bezeichnung (1..60 characters, plain words for what the stream plays from that bar: "conga"); it labels the stream when that pattern is written, and a move without it clears the label. bezeichnung on any other target is refused.',
    inputSchema: { type: 'object', required: ['name', 'fahrten'], properties: { name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' },
      fahrten: { type: 'array', items: { type: 'object', required: ['ziel', 'ab_takt'], properties: { ziel: { type: 'string' }, ab_takt: { type: 'number' }, takte: { type: 'number' },
        nach: { type: 'number' }, von: { type: 'number' }, form: { type: 'string', enum: ['s', 'linear'] }, muster: { type: 'string' },
        bezeichnung: { type: 'string', minLength: 1, maxLength: 60, description: 'strom: moves with muster only: label of the stream from that bar' } } } },
      ab: { type: 'string', enum: ['takt', 'phrase'] },
      anker_takt: { type: 'integer', minimum: 1, description: 'absolute bar to anchor at (not together with ab)' }, probe: { type: 'boolean', description: 'true: check and answer the plan, schedule nothing' },
      schleife_takte: { type: 'integer', minimum: 1, maximum: 64 }, aendern: { type: 'boolean' } } },   // 1.12 S7: loop, change of a loop
    lauf: (p) => {
      const spur = { name: p.name, fahrten: p.fahrten, ...(p.schleife_takte !== undefined ? { schleife_takte: p.schleife_takte } : {}) };
      return p.aendern === true ? http('POST', '/spur/aendern', { name: p.name, spur }) : http('POST', '/spur', { spur, ...(p.anker_takt !== undefined ? { anker_takt: p.anker_takt } : {}), ...(p.ab !== undefined || p.anker_takt === undefined ? { ab: p.ab ?? 'takt' } : {}), ...(p.probe !== undefined ? { probe: p.probe } : {}) });
    } },
  { name: 'bogen', description: 'Play an arc: layered sections on the bar grid, compiled by the server into one automation track. Arguments: name, takte (1..128), schichten, bruch, fahrten, ab, anker_takt, probe. '
      + 'schichten: each layer {strom, muster, ab_takt, bis_takt?, rein?, raus?, name?} puts a Strudel pattern on a stream (1, 2, 3, 5, 6, 7, 9, 10) from bar ab_takt of the arc (bar 1 = the anchor). bis_takt is exclusive (at most takte + 1); without it the layer keeps playing after the arc. '
      + 'Layers on the same stream are stacked, and a layer that enters or leaves later is a new section of that stream. rein n fades a layer in over n bars (1..32), raus n fades it out over the n bars before bis_takt (needs bis_takt); a fade may run across the start of another layer, the server continues it in the next section. '
      + 'bruch {ab_takt, takte, behalte: [strom]}: a break: every stream of the arc (a stream with a layer in it) that is not listed in behalte is silent for those bars and its layers come back at its end as the drop; a stream the arc has no layer on is never touched and keeps playing. '
      + 'A layer name (1..60 characters, plain words: "conga", "acid line") becomes the stream label shown on the channel strip: name every layer; layers stacked on one stream are joined with " + ". '
      + 'fahrten: optional hand-written moves as for spur (mixer paths, wirt: targets), passed into the same track. '
      + 'ab (takt or phrase) and anker_takt anchor the arc as for spur; probe: true runs every check and answers anchor, compiled sections (kompiliert) and plan without scheduling or sending anything: probe first, then start. '
      + 'The answer is the spur answer plus kompiliert (the track body) and plan [{takt, strom, text}]. spuren shows a running arc with bogen.naechste (in_takten, text of its next change). '
      + 'No schleife on an arc (bogen_schleife): to repeat an arc, `warte` with bis spur_ende, then call bogen again. Stop it with spur_stopp (same name). All spur rules apply (AUTO off on a layer stream is auto_aus, nur_andreas, Stop Cypher).',
    inputSchema: { type: 'object', required: ['name', 'takte', 'schichten'], properties: { name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' },
      takte: { type: 'integer', minimum: 1, maximum: 128 },
      schichten: { type: 'array', items: { type: 'object', required: ['strom', 'muster', 'ab_takt'], properties: { strom: { type: 'integer' }, muster: { type: 'string' }, ab_takt: { type: 'integer', minimum: 1 },
        bis_takt: { type: 'integer', minimum: 2, description: 'exclusive end bar; absent = keeps playing' }, rein: { type: 'integer', minimum: 1, maximum: 32 }, raus: { type: 'integer', minimum: 1, maximum: 32 },
        name: { type: 'string', minLength: 1, maxLength: 60 } } } },
      bruch: { type: 'object', required: ['ab_takt', 'takte', 'behalte'], properties: { ab_takt: { type: 'integer', minimum: 1 }, takte: { type: 'integer', minimum: 1 }, behalte: { type: 'array', items: { type: 'integer' } } } },
      fahrten: { type: 'array', items: { type: 'object', required: ['ziel', 'ab_takt'], properties: { ziel: { type: 'string' }, ab_takt: { type: 'number' }, takte: { type: 'number' },
        nach: { type: 'number' }, von: { type: 'number' }, form: { type: 'string', enum: ['s', 'linear'] }, muster: { type: 'string' } } } },
      ab: { type: 'string', enum: ['takt', 'phrase'] },
      anker_takt: { type: 'integer', minimum: 1, description: 'absolute bar to anchor at (not together with ab)' }, probe: { type: 'boolean', description: 'true: check and answer the plan, schedule nothing' } } },
    lauf: (p) => {
      const d: Json = { name: p.name, takte: p.takte, schichten: p.schichten };
      for (const k of ['bruch', 'fahrten', 'ab', 'anker_takt', 'probe']) if (p[k] !== undefined) d[k] = p[k];
      return http('POST', '/bogen', d);
    } },
  { name: 'spur_stopp', description: 'Stop one of MY automation tracks by name (Andreas\' tracks answer nur_andreas).',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    lauf: (p) => http('POST', '/spur/stopp', { name: p.name }) },
  { name: 'spuren', description: 'Running automation tracks, with the parts the core rejected.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/spur') },
  { name: 'szene', description: 'Live scenes: a snapshot of the whole live state that can be restored exactly. A scene holds the patterns per stream (with their phase offset), the mixer values, the loaded graphs, the Surge sounds of bass and melody, the beat FX units with their assignment and routing, and the running Cypher loops. '
      + 'aktion: sichern (store under name [a-z0-9_-]{1,32}; szene_vorhanden when the name exists, use ersetzen to overwrite), ersetzen, laden, liste, zeige (the stored content), loeschen. '
      + 'laden restores on the next bar as one internal track szene-<name> (takte 0..16: continuous mixer values ramp over that many bars, 0 = set at once). It saves the state as _vor_laden first, so the undo is `szene laden _vor_laden`. '
      + 'A part that Cypher may not touch right now (AUTO off on that stream, a refused control, a missing generator) is not restored and is listed under ausgelassen [{ziel, grund}]; everything else is restored. '
      + 'stille saves _vor_stille automatically before it silences, so `szene laden _vor_stille` brings the sound back (not when everything is silent already: szene_vorher schon_still). Names starting with _ are automatic; _vor_stille and _vor_laden keep three generations (-1, -2 are the older ones). Needs the open live project (kein_projekt otherwise).',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'] },
      name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$', description: 'required except for liste' },
      takte: { type: 'integer', minimum: 0, maximum: 16, description: 'laden: ramp the continuous mixer values over this many bars (default 0 = at once)' } } },
    lauf: (p) => {
      const falsch = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      const AKTIONEN = ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'];
      if (typeof p.aktion !== 'string' || !AKTIONEN.includes(p.aktion)) return falsch(`unknown aktion ${String(p.aktion)}`);
      const d: Json = { aktion: p.aktion };
      if (p.name !== undefined) d.name = p.name;
      if (p.takte !== undefined) d.takte = p.takte;
      return http('POST', '/szene', d);
    } },
  { name: 'aufbau', description: 'Stored session setups, outside any project: the whole live state of a session (everything a scene holds) plus the tempo, the four container faders (deck/1, deck/2, pad/1, pad/2) and the graphs of the Baukasten streams, so that one call rebuilds the studio, also after a core restart. '
      + 'aktion: sichern (store under name [a-z0-9_-]{1,32}; aufbau_vorhanden when the name exists, use ersetzen to overwrite), ersetzen, laden, liste, zeige (the stored content), loeschen (the file is kept in the papierkorb folder). '
      + 'laden opens the live container first if none is open (live_laeuft is returned when that is refused), sets the tempo, restores the graphs, and brings the scene back with every continuous value ramping over 2 bars (never nur_rampe, also from -200 dB after a restart). '
      + 'Answer: the scene answer plus live_geoeffnet, bpm and kanaele. What Cypher may not touch right now is not restored and is listed under ausgelassen [{ziel, grund}]; a container fader on a track place needs a hearing check first and comes back under ausgelassen with kein_hoerschein. Unknown name: aufbau_unbekannt.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'] },
      name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$', description: 'required except for liste' } } },
    lauf: (p) => {
      const AKTIONEN = ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'];
      if (typeof p.aktion !== 'string' || !AKTIONEN.includes(p.aktion)) return { code: 400, j: { fehler: 'argument_ungueltig', text: `unknown aktion ${String(p.aktion)}` } };
      const d: Json = { aktion: p.aktion };
      if (p.name !== undefined) d.name = p.name;
      return http('POST', '/aufbau', d);
    } },
  { name: 'stille', description: 'Silence all Strudel instances from the next bar (tails ring for about 10 s; a note that is still held at that bar line, e.g. a long note on an instrument graph, is released there too, with a kern that knows the cut, otherwise it rings to its own end): the three studio streams and every Baukasten stream (5, 6, 7, 9, 10) whose erzeuger runs. All of them are always sent; if AUTO is off on one, that one is reported and the others still go silent.',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const stroeme: Json[] = [], fehler: string[] = [];
      let code = 200;
      // snapshot first so that `szene laden _vor_stille` brings the sound back; a failed or slow snapshot (1.5 s) never stops the silence,
      // and over a silence the server keeps the older snapshot (schon_still)
      let sicherung: Json | string;
      try {
        const sich = await http('POST', '/szene', { aktion: 'sichern', name: '_vor_stille' }, false, AbortSignal.timeout(1500));
        sicherung = sich.code >= 400 ? { fehler: String(sich.j.fehler ?? `http ${sich.code}`) }
          : sich.j.grund === 'schon_still' ? 'schon_still' : { name: '_vor_stille' };
      } catch (e) { sicherung = { fehler: (e as Error).name === 'TimeoutError' ? 'zeitlimit' : String((e as Error).message) }; }
      for (const strom of await stroemeListe()) {
        const r = await http('POST', '/strudel', { text: 'silence', strom });
        code = Math.max(code, r.code);
        stroeme.push({ strom, code: r.code, ...r.j });
        if (r.code >= 400) fehler.push(`strom ${strom}: ${String(r.j.fehler ?? `http ${r.code}`)}`);
      }
      return { code, j: { stroeme, szene_vorher: sicherung, ...(fehler.length ? { fehler: 'teilweise: ' + fehler.join('; ') } : {}) } };
    } },
  { name: 'mischung', description: 'Mix check of the master over N bars (live): samples the live analysis every 500 ms for the length of takte bars (at the bpm of lage), drops samples where the engine stands (steht) or the window is silent (stumm), averages the 1/12 octave spectrum by power. '
    + 'Answer {takte, proben, baender {sub, bass, mitte, praesenz, luft: dB difference to the genre target, level-matched, + = more than the target; only with ziel}, terz {hz, db, ziel_db?}, chroma {C..B, sums to 1}, tonart? {name, passt 0..1, staerkste: 3 pitch classes}, lufs_s, lufs_m_mittel, peak_db (the highest peak of the samples inside the N bars, not a true peak and not the peak since a reset), korrelation, ziel_grob, urteil}. '
    + 'ziel: techno, house, deep_house, dub, techstep or minimal; the target curves are ROUGH (a hand-set club tilt, not measured: ziel_grob is true), use them as a direction. '
    + 'tonart: Am, F#, C# minor or Camelot 8A; absent = the key of a playing deck from lage if there is one, else no key line (the chroma is a guess from the spectrum, a mix of several keys shows low). '
    + 'urteil is one line: peak above -1 dB is too hot, a region off by more than 3 dB is named with its sign, a key match below 0.5 is named. It takes takte bars of real time. It changes nothing.',
    inputSchema: { type: 'object', properties: { takte: { type: 'integer', minimum: 1, maximum: 16, default: 4 }, ziel: { type: 'string', enum: Object.keys(MISCHUNG_ZIELE.ziele) }, tonart: { type: 'string', description: 'Am, F#, C# minor or Camelot 8A' } } },
    lauf: async (p) => {
      const takte = p.takte === undefined ? 4 : Number(p.takte);
      if (!Number.isInteger(takte) || takte < 1 || takte > 16) return { code: 400, j: { fehler: 'takte_ungueltig', text: 'takte must be an integer 1..16' } };
      const ziel = p.ziel === undefined ? undefined : String(p.ziel);
      if (ziel !== undefined && !(ziel in MISCHUNG_ZIELE.ziele)) return { code: 400, j: { fehler: 'ziel_unbekannt', text: `ziel must be one of ${Object.keys(MISCHUNG_ZIELE.ziele).join(', ')}` } };
      const tonartArg = p.tonart === undefined ? undefined : String(p.tonart);
      if (tonartArg !== undefined && parseTonart(tonartArg) === null) return { code: 400, j: { fehler: 'tonart_ungueltig', text: 'tonart: Am, F#, C# minor or Camelot 8A' } };
      const l = await http('GET', '/lage');
      if (l.code !== 200) return l;
      const lj = l.j as { uhr?: { bpm?: number }; decks?: unknown; taktart?: unknown };
      const bpm = Number(lj.uhr?.bpm);
      if (!(bpm > 0)) return { code: 409, j: { fehler: 'kein_tempo', text: 'lage has no master tempo' } };
      const n = Math.max(1, Math.ceil(takte * proTaktVon(lj) * 60 / bpm / 0.5));
      const proben: number[][] = [], lufsM: number[] = [], korrs: number[] = [];
      let tpMax: number | null = null, lufsS: number | null = null;
      for (let k = 0; k < n; k++) {
        if (k > 0) await new Promise((ok) => setTimeout(ok, 500));
        const [r, m] = [await http('GET', '/analyse/live'), await http('GET', '/analyse/pegel')];
        const mj = (m.code === 200 && m.j !== null && typeof m.j === 'object' ? m.j : null) as Record<string, Json> | null;
        if (mj && typeof mj.lufs_s === 'number') lufsS = mj.lufs_s;
        const j = (r.code === 200 && r.j !== null && typeof r.j === 'object' ? r.j : null) as Record<string, any> | null;
        if (!j || j.leer !== false || j.steht === true || j.stumm === true) continue;
        const db = j.spektrum?.db;
        if (!Array.isArray(db) || db.length !== 120) return { code: 502, j: { fehler: 'antwort_ungueltig', text: 'GET /analyse/live: the spectrum is not 120 bands' } };
        proben.push(db as number[]);
        if (typeof j.lufs_m === 'number') lufsM.push(j.lufs_m);
        if (typeof j.true_peak_dbtp === 'number') tpMax = tpMax === null ? j.true_peak_dbtp : Math.max(tpMax, j.true_peak_dbtp);   // peak of the window of one sample, collected inside the N bars only
        if (typeof j.stereo?.korrelation === 'number') korrs.push(j.stereo.korrelation);
      }
      if (proben.length === 0) return { code: 409, j: { fehler: 'nichts_gehoert', text: 'no usable sample: the engine stands or the master is silent', proben: 0 } };
      const db120 = mittle(proben), terz = terzVon(db120), chr = chroma(db120);
      const zielDb = ziel ? zielAufTerz(MISCHUNG_ZIELE.anker_hz, MISCHUNG_ZIELE.ziele[ziel]) : undefined;
      const gz = zielDb ? gegenZiel(terz, zielDb) : undefined;
      let tonartName = tonartArg;
      if (tonartName === undefined && Array.isArray(lj.decks)) {
        const d = (lj.decks as Array<{ status?: number; camelot?: string | null }>).find((x) => Number(x?.status) >= 2 && typeof x.camelot === 'string' && parseTonart(x.camelot) !== null);
        if (d) tonartName = d.camelot as string;
      }
      const ton = tonartName !== undefined ? tonartPasst(chr, tonartName) : null;
      const mean = (a: number[]): number | null => (a.length > 0 ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const antwort = {
        takte, proben: proben.length,
        ...(gz ? { baender: gz.regionen } : {}),
        terz: { hz: [...TERZ_HZ], db: terz, ...(zielDb ? { ziel_db: zielDb } : {}) },
        chroma: Object.fromEntries(KLASSEN.map((c, i) => [c, chr[i]])),
        ...(ton ? { tonart: ton } : {}),
        lufs_s: lufsS, lufs_m_mittel: mean(lufsM), peak_db: tpMax, korrelation: mean(korrs), ziel_grob: MISCHUNG_ZIELE.grob,
        urteil: urteil({ peak_db: tpMax, regionen: gz?.regionen ?? {}, tonart: ton, ziel }),
      };
      return { code: 200, j: antwort as unknown as Json };
    } },
  { name: 'pegel', description: 'Levels of the last N seconds (1..10, default 3) per channel (erz/1..3, erz/5..7 (Baukasten instruments), pad/1..2, deck/1..2 (the container strips), spur/1..128 for each production track that has content, grp/1..16 for each group that has members or child groups, ret/1..8 for each return, pm (the production master after its fader, before the set limiter), master, cue): number of samples, peak dBFS (max_db, -200 = silence) and median of the audible peaks (median_db, null if silent). The peak is the sample peak after the track fader, not loudness: a 808 kick and a quiet pad can show the same peak and sound very different. For loudness per track use proj_lautheit. Read it after every change: master must stay below -3 dBFS, the kick leads. nur_hoerbar: true drops the channels with max_db at or below -90.',
    inputSchema: { type: 'object', properties: { sek: { type: 'integer', minimum: 1, maximum: 10, default: 3, description: 'window in seconds (default: 3)' }, nur_hoerbar: { type: 'boolean' } } },
    lauf: async (p) => {
      const r = await http('GET', `/pegel?sek=${p.sek ?? 3}`);
      const k = (r.j as { kanaele?: Record<string, { max_db?: number }> }).kanaele;
      if (p.nur_hoerbar !== true || r.code !== 200 || k === undefined || k === null || typeof k !== 'object') return r;
      return { code: r.code, j: { ...r.j, kanaele: Object.fromEntries(Object.entries(k).filter(([, v]) => !(Number(v?.max_db) <= -90))) } };
    } },
  { name: 'spektrum', description: 'The last frame of the spectrum analyser: 29 bands, three per octave, with the centre of each band in Hz (1000 Hz x 2^(i/3), i = -16..12, i.e. 24.8 Hz .. 16 kHz) and its level in dB (a full-scale sine reads about 0 dB, silence about -90 or lower). '
      + 'Answers {leer:true} while the analyser is off or no frame has arrived yet; right after choosing a source {leer:true} is normal (the window refills first), ask again after about 100 ms. '
      + 'Otherwise {leer:false, kanal (the source: deck/1, bus/2, master ...), rahmen (frame number since the last source change), alter_ms (age of the frame), veraltet (true when alter_ms is above 500 ms: the frame is stale, the analyser has stopped delivering, do not read it as the current sound), baender:[{hz, db}]}. '
      + 'The source is chosen with regler spektrum/kanal (0 off, 1..4 = the containers A..D = deck/1, deck/2, pad/1, pad/2, 5..8 = bus/1..4, 9 = master sum; a stream is heard through the container that plays it); this tool only reads and changes nothing.',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const r = await http('GET', '/spektrum');
      if (r.code !== 200) return r;
      const j = (r.j !== null && typeof r.j === 'object' ? r.j : {}) as { leer?: unknown; pegel?: unknown; alter_ms?: unknown };
      if (typeof j.leer !== 'boolean') return { code: 502, j: { fehler: 'antwort_ungueltig', text: 'GET /spektrum answered without a boolean leer', antwort: r.j } };
      if (j.leer) return r;
      const { pegel, ...rest } = j;
      if (typeof pegel !== 'string' || !/^-?\d+(,-?\d+){28}$/.test(pegel)) {
        return { code: 502, j: { fehler: 'pegel_ungueltig', text: 'the spectrum frame is not 29 integers in 0.1 dB' } };
      }
      const baender = pegel.split(',').map((x, i) => ({ hz: Math.round(bandMitteHz(i) * 10) / 10, db: Number(x) / 10 }));
      return { code: 200, j: { ...rest, veraltet: typeof j.alter_ms !== 'number' || j.alter_ms > SPEKTRUM_FRIST_MS, baender } };
    } },
  { name: 'oszilloskop', description: 'Scope for the last N seconds (1..15, default 5) of one channel: peak and when it happened, RMS, onsets (rises over a threshold, with time and strength), pump depth (how deep the low band swings per beat at the current tempo, null without tempo; on a bass or pad channel this is sidechain pumping, on a drum channel it is only the decay of the hits), click suspects, and a one-line envelope. '
      + 'Honest limits: this is the 1 ms envelope of the kern (peak and band RMS per millisecond, taken after EQ and filter, before the fader), not samples. A short spike that stands out against its neighbours is only a click SUSPECT; a real jump in the sample values is invisible here. '
      + 'Times are milliseconds before the end of the window (-1200 ms = 1.2 s ago). Channels: deck/1|2, pad/1|2 (the container strips), erz/1..4 (erz/4 = the production sum), master (before the master fader and limiter), cue. A deck that is not loaded reads as silence. '
      + 'Errors: kanal and sek out of range are 400, kein_ring (409) means the kern writes no envelope ring (kern off). Reads only, changes nothing.',
    inputSchema: { type: 'object', properties: { kanal: { type: 'string', enum: Object.keys(OSZI_KANAELE), description: 'channel to look at' },
      sek: { type: 'integer', minimum: 1, maximum: 15, default: 5, description: 'window in seconds (default: 5)' } }, required: ['kanal'] },
    lauf: async (p) => {
      const sek = p.sek ?? 5;
      const r = await http('GET', `/oszi?kanal=${encodeURIComponent(String(p.kanal ?? ''))}&sek=${encodeURIComponent(String(sek))}`);
      return r.code === 200 ? { ...r, text: osziText(r.j) } : r;
    } },
  { name: 'klang', description: 'Surge XT sounds on the BASS (strom 2) and MELODY (strom 3) instances. gruppe: bass|melodie. aktion: '
      + 'liste (find factory/own patches by regex, e.g. filter "Leads/Acidofil"; no gruppe needed), zeige (current values, optional regex filter), lade (load a patch by name, e.g. "Chords/Minor Chord Retro Stab"), '
      + 'setze (werte {NAME: number}; non-continuous parameters reload the state = audible click; with ab (jetzt|schlag|takt|phrase) or ab_beat (a core beat) the set is queued and the host reloads at that beat, so pick a silent beat: the reload cuts sounding notes; the answer gives ab_beat and ab_takt), fahre (parameter, ziel, sekunden, optional von: stepless fade, e.g. volume -12 over 15 s from -40), '
      + 'speichere (save the running sound under name [a-z0-9_-]{1,32}), hoere (play a note directly on the host: note 0..127, dauer seconds). '
      + 'If the instance plays Cypher Modular (our own synth, see instrumente) instead of Surge: params (Knob 1..64 with value 0..1 and the knob names from the graph, e.g. "Knob 1": "Cutoff"; free like zeige) '
      + 'and param (name "Knob 1".."Knob 8", wert 0..1, set at once, smoothed 20 ms in the synth); the Surge actions do not apply there. '
      + 'Blend with fahre, never hard-set volume while playing. Writing actions are refused while Stop Cypher is set or AUTO of that instance is off; zeige and liste are free. Values must not start with "-".',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      gruppe: { type: 'string', enum: ['bass', 'melodie'], description: 'required except for liste' },
      aktion: { type: 'string', enum: ['liste', 'zeige', 'lade', 'setze', 'fahre', 'speichere', 'hoere', 'params', 'param'] },
      name: { type: 'string', description: 'lade: patch name or path; speichere: [a-z0-9_-]{1,32}; param: "Knob 1".."Knob 8"' },
      wert: { type: 'number', minimum: 0, maximum: 1, description: 'param: knob position 0..1' },
      werte: { type: 'object', additionalProperties: { type: 'number' }, description: 'setze: {PARAMETER: number}' },
      ab: { type: 'string', enum: ['jetzt', 'schlag', 'takt', 'phrase'], description: 'setze: reload at this grid point (ab_beat wins when both are given)' },
      ab_beat: { type: 'number', description: 'setze: reload at this core beat' },
      parameter: { type: 'string', description: 'fahre: continuous Surge parameter, e.g. volume, a_filter1_cutoff' },
      ziel: { type: 'number' }, sekunden: { type: 'number', minimum: 0, maximum: 600 }, von: { type: 'number' },
      filter: { type: 'string', description: 'regex for zeige / liste' },
      note: { type: 'integer', minimum: 0, maximum: 127 }, dauer: { type: 'number', description: 'hoere: seconds' } } },
    lauf: (p) => http('POST', '/klang', p) },
];

// Oscilloscope answer as compact text: figures first, then one line of block characters (peak per group of points, -60..0 dB).
export function osziText(j: Json): string {
  const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const liste = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const kuerze = (xs: string[], max: number): string => (xs.length > max ? [...xs.slice(0, max), `+${xs.length - max} more`] : xs).join(', ');
  const einsaetze = liste(j.einsaetze).map((e) => `${num((e as Json).t_ms)} ms +${num((e as Json).db)} dB`);
  const klicks = liste(j.klick_verdacht).map((t) => `${num(t)} ms`);
  const verfuegbar = num(j.verfuegbar_ms), angefragt = num(j.angefragt_ms);
  const bpm = typeof j.bpm === 'number' ? ` (${j.bpm} BPM)` : '';
  const pump = typeof j.pumptiefe_db === 'number' ? `${j.pumptiefe_db} dB per beat${bpm}` : 'unknown (no tempo, or less than one beat of data)';
  const hoch = liste(j.huellkurve_max_db).map(num);
  const ZEICHEN = 60, STUFEN = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
  let linie = '';
  for (let z = 0; z < Math.min(ZEICHEN, hoch.length); ++z) {
    const g = hoch.slice(Math.floor((z * hoch.length) / ZEICHEN), Math.max(Math.floor(((z + 1) * hoch.length) / ZEICHEN), Math.floor((z * hoch.length) / ZEICHEN) + 1));
    const m = Math.max(...g);
    linie += m <= -60 ? ' ' : STUFEN[Math.min(7, Math.floor(((m + 60) / 60) * 8))];
  }
  return [
    `Scope ${String(j.kanal)}, last ${Math.round(verfuegbar / 100) / 10} s${verfuegbar < angefragt ? ` (only ${verfuegbar} of ${angefragt} ms available)` : ''}, 1 ms envelope, no samples`,
    `Peak ${num(j.spitze_db)} dB at ${num(j.spitze_t_ms)} ms | RMS ${num(j.rms_db)} dB (-200 = silence)`,
    `Onsets (${einsaetze.length}): ${einsaetze.length ? kuerze(einsaetze, 12) : 'none'}`,
    `Pump depth: ${pump}`,
    `Click suspects (${klicks.length}): ${klicks.length ? kuerze(klicks, 10) : 'none'}`,
    `Envelope (peak, ${Math.round(verfuegbar / ZEICHEN)} ms per character, blank <= -60 dB, full block = 0 dB, right edge = now): ${linie}`,
  ].join('\n');
}
