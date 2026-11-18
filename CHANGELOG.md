# Changelog

One entry per public update, newest first. Each entry names what changed for someone who plays, produces or
builds cypher-dj.

## 2026-11-18, tenth update

**Studio**
- Buttons and pads of a learned controller can be assigned to switches and deck actions with a click in the
  CONTROLLERS window: PFL, the three kills, compressor and gate on, the utility switches, Play and Cue. The picker of
  a button or pad offers only switches and actions, the picker of a knob only continuous targets, and after an
  assignment it moves on to the next free control. Hot cues and loops from a learned button are not there yet.
- The Akai LPD8 shows its pads as assignable tiles in each of its four programs (64 controls in all), in the layout
  of the device. The Novation Launch Control 3 names its left-hand buttons under the tiles and says which of them
  send nothing on the plain MIDI port.
- The module row of the window folds tracks and groups into one chip each, and the free graph knobs that no loaded
  graph names stay out of the lists until asked for.

## 2026-11-18, ninth update

**Studio**
- Scenes for the sequencer decks: the SCENES strip in the header stores up to eight pictures of which patterns
  play across all sequencer decks (SAVE, then a number). A click on a number switches the whole picture on the next
  bar line, every pattern at the same sample; the last click before the bar wins, and with the transport stopped it
  switches at once.
- A project can hold up to 16 Cypher Modular instrument tracks (was 8), so a full module fits next to a full
  sequencer deck. Dragging a knob moves the sound live on the first 8; on the others a knob change is applied when
  you let go.
- The studio follows the time signature of the open project (2/4 to 12/4): the bar counter, the beat dots, ramps
  "over n bars", pattern starts and the length menu of the sequencer count in that meter. The metronome accent, the
  count-in and the loop boxes still count in four.
- The page opens the project you had open again after a restart.
- EFFECTS has a MASTER tab in signal order: insert effect, glue compressor, limiter with a gain reduction meter.
- Instrument pickers group the Cypher Modular instruments by synthesis type (Analog, Wavetable, FM, Strings & Bodies, Granular,
  Sampler, Drum Synthesis, Feedback) or by role as before; TYPE and ROLE switch the grouping, and the instrument name shows the
  other one behind it.
- A sound loads its instrument: applying a preset to a channel or track that plays another instrument asks once and then loads
  the instrument with the sound.
- One search field above the shelf tabs (the / key focuses it): it searches every shelf source at once and shows the
  hits grouped by kind; show all opens them in their tab, and FITS keeps only what matches the tempo and key of the
  open module.
- Several MIDI controllers at once, each on its own place (2 to 8) with its own learn table, so two devices that send
  the same control no longer collide. CONTROLLERS opens a window of its own: the devices on the left, one table of
  every assignment on the right with a text filter, and moving a control marks its row. Known devices are drawn in
  their own layout as tiles (the LPD8 with its four programs as banks), a module view lists the free targets of a
  module, and a target can be assigned directly. Feedback for the Novation Launch Control 3 (encoder lights and display
  following what is learned) is implemented but not yet confirmed on the device.

**Production**
- Automation rows for return and master strips at the bottom of the arrangement: "+ Lane" offers the parameters of
  the strip's insert effects, and on a return also Volume. The return fader in the mixer is marked AUTO and follows
  the curve while it plays.
- FIND SOUND makes steps you can hear: subtle, clear and strong say how far a variant must differ from the current
  sound, and a knob is turned further until that is reached. A knob that cannot get there is offered at its end
  stop and marked "max". No two variants of a round carry the same word. COMPARE alternates one bar of the current
  sound and one bar of the variant, at the same loudness.

**Engine**
- The worker threads that compute tracks in parallel switch themselves back on after a late block instead of
  staying off until the next start.
- The operating journal of a set is lean: it keeps what a set needs to resume and to be read afterwards and no longer
  repeats the controller lights and their receipts every 1.5 seconds. A day of studio time wrote about 2 GB before; the
  full journal is still available as a setting for measurements.
- A restart of the page server while the core restores its state after its own restart no longer loses the restore.
- About sixty fixes from a code review of the whole studio. Three of them change the sound: no spike when the drum bus
  drive leaves 0, LFO phases stay exact over long sets, and a mixer target that changes during an open blend waits for
  the blend instead of stepping.

**For the assistant**
- Cypher can open the fader of a sequencer deck it plays itself, as with its Strudel channels. A deck with a
  loaded track keeps the listening check.

## 2026-11-17, eighth update

**Studio**
- One visible folder for your work: a fresh install keeps projects, modules, kits, loops, presets and the rest under
  `~/cypherdj/` (`CYPHERDJ_HEIM` moves it). An existing install keeps working where it is; the command `djk-umzug` shows
  what a move would do and moves one kind at a time, leaves a link at the old place, can undo it and carries on by fixed
  rules after an interrupted run. It also moves projects you choose out of the project list into `pruefen/`, and renames
  module folders to `<title>-<slot>-<4 characters>`. INSTALL.md section 8 has the layout.
- One list of source folders, `~/cypherdj/quellen.toml`. The SOURCES button in the shelf header opens the dialog SOURCE
  FOLDERS: every folder with a dot for "reachable now", ADD and REMOVE. The shelf, the catalog and the kit sources read
  the same list.
- Projects collect their sources: opening a project copies the sources that lie on a removable disk into its `audio/`
  folder in the background, so it plays with the disk unplugged. COLLECT in PRODUCTION copies every outside source, and
  so does a finished export. It copies, never moves or deletes, checks every copy by its sha256, runs at the lowest
  priority and waits while music plays.
- A project keeps its three newest exports; older ones move to a bin folder inside the projects folder, nothing is deleted. The
  decoded audio cache is capped at 5 GiB and the waveform cache at 1 GiB; a decode that any project names is never
  removed.

## 2026-11-17, seventh update

**Studio**
- Media browser in the shelf: the SAMPLES tab has a LIBRARY mode that searches the whole one-shot catalog by text and
  by instrument class (FOLDERS keeps the folder browser). Protected samples are not shown, files you can reach come
  first, and a disk that is not mounted is named with the number of samples it holds. Every row shows its folder;
  a click previews it and TO TRACK puts it on a new track, also for catalog files outside your sample folders.
- Favourites and recently used: a star in the row marks a sample, and a sample you put on a track, drop or load into a
  deck counts as recently used. Both are fixed collections that sort the DJ library, the shelf and the PRODUCTION
  library (reachable first, then favourites, then recent) until you choose a column to sort by.
- Drag from the shelf: drop a sample on the track list for a new track, or on a row of a drum kit track to make it the
  sound of that row. The kit is copied first, so other tracks and saved projects that play the old kit stay unchanged.

## 2026-11-17, seventh update

**Studio**
- ANALYZE window, references: drag a track or a sample from the shelf onto the window and the selected track is compared
  with it. The reference curve is level-matched, so you see where the tonal balance differs, and the three largest
  differences are named ("+6.5 dB 64 Hz to 80 Hz"). SAVE REF keeps a measured range, or one of your own tracks, as a
  reference curve by role (kick, bass, lead, master and so on) for later comparisons.
- ANALYZE window, live: the source LIVE OUTPUT shows what goes out of the master right now: spectrum with a held
  maximum, a rolling picture of the last 30 seconds, stereo correlation per band, momentary loudness and true peak.
- The spectrum resolves low notes: below 400 Hz it uses a longer window, so a bass note or a kick fundamental reads its
  real level in its own semitone band.
- Note editors: a project key (KEY, SCALE, FIND, FIT), long notes by dragging, chords, inversion and arpeggio; drag a
  note to move it, right click deletes, Shift selects a range, Ctrl single steps.

## 2026-11-17, sixth update

**Studio**
- ANALYZE window: spectrum in semitone bands, time picture, stereo correlation per band, loudness with short-term and
  momentary maxima, masking between two tracks, objective hints; measured from a render of the loop, also while the loop
  plays.

**The agent's side**
- New tool `proj_analyse` (93 tools now): the same measurement for a track, group, return or the master, optionally
  against a second strip, so the agent can judge a sound without hearing it.

## 2026-11-16, fifth update

**Studio**
- New layout: the tracks on the left, the sequencer takes the rest, and a dock below with one card per instrument track
  and one per effect. A card shows a few knobs of its device; OPEN shows the whole device in a floating window. The
  separate mix view and the sound column are gone.
- Effects are loaded into the dock (up to four) and each track has a small send knob per effect, labelled with the
  effect it feeds. The shelf is a drawer behind SHELF.
- Step sequencer for drum tracks: every row has its own length (LEN), so rows of different length drift against each
  other, its own SWING, a direction (forward, or forward and back) and SHIFT buttons that move its hits by a step.
  Step values per step: VELOCITY, CHANCE, OFFSET and ROLL (several hits inside one step). Tools DRAW, ERASE and FILL;
  Shift draws a line, Ctrl selects a range, the arrow keys move a cursor.
- LENGTH sets the module length from 1 to 128 bars, STEPS the resolution (4, 8 or 16 per bar), VIEW how many bars a page
  shows. A loop range can be dragged above the steps.
- EXPORT WAV and EXPORT MIDI write the module as a sum and per track.
- Sample player: a SAMPLES tab on the shelf browses your own sample folders (listed in
  `~/.config/cypherdj/sampler/wurzeln.json`), with a search over folder and file names and a preview by click. TO TRACK
  puts one file on a new instrument track that plays it across the keys; the root note comes from pitch detection and
  the file name. Samples in a protected vendor format are not listed.
- Multisample instruments: a folder of note samples (note, velocity layer and take in the file names) becomes one
  instrument with INSTRUMENT TO TRACK: the right sample for the key and the velocity, round robin between takes. Loop
  points stored in WAV or AIFF files become sustain loops with a cross-fade, and a sibling folder of release samples
  plays when a key is let go, with its own level knob. Built instruments are kept on a new INSTRUMENTS tab.

**Cypher Modular**
- The `sampler` block has a zone mode: a table of zones (key range, velocity range, root, gain, pan, sustain loop,
  release sample) over one memory-mapped sample pack of up to 2 GiB, a `vel` input and two outputs for release samples.

## 2026-11-16, fourth update

**Studio**
- Modules on the shelf have SAVE AS (a copy under a new name, with its own history) and DELETE (asks first; the module
  moves to a bin folder next to the projects, so it can be put back by hand). Every change is still saved at once.
- KIT TO TRACK now writes the hits where the slices sat in the loop, so the new drum track plays at once instead of
  starting empty.
- In the slice grid VELOCITY, LENGTH and REVERSE act on the hits of a step on every row, as PITCH does, so a step can be
  reversed without first selecting its slice row.
- Cypher Modular: the Greif preset Pluck Stab is louder (it sat too low in a mix).

## 2026-11-16, third update

**Studio**
- Slice a loop: SLICE TO TRACK on a library loop or on the audio of a module (the loop or one of its stems) cuts it into
  slices and makes an instrument track that plays them in their original order, so it sounds like the loop first. The
  project tempo is fitted on the SPEED knob when it is within a factor of four of the loop's tempo. Cut by grid (4, 8,
  16, 32 or 64 equal slices) or at the hits found in the audio (the sensitivity sets how many).
- The notes grid has a new kind, SLICE: one row per slice, so you reorder, repeat, shorten and reverse hits as steps.
  REVERSE turns a step around, and a PITCH lane sets the pitch of one step only, exact to its own hit.
- A strip above the sound panel shows the waveform with the numbered slices and, per marker, how strong the hit is and
  how far it sits from the grid. Click a slice to hear it, shift-click to select. Drag a marker (it snaps to a hit or
  the grid, Alt turns that off), double-click a slice to add a marker, double-click a handle to remove it. CUT AGAIN cuts
  the same audio by another method or count and the patterns keep their slice numbers; WRITE ORIGINAL ORDER puts the
  slices back in the order of the loop.
- TO KIT turns the selected slices into a drum kit (names like bd, sd, hh are proposed from the sound and can be
  changed). KIT TO TRACK puts it on a drum track, and the kit plays from the drum grid and from a Strudel text on that
  track.
- TO TONE turns one slice, or a run of slices, into an instrument that plays at the pitch of the note you play. The root
  note is proposed by a pitch detection and can be changed with ROOT.
- The shelf has a third tab, CUTS: every cut you made, with TO TRACK and DELETE (a cut that a track still plays is not
  deleted, and the page says where it is used). Silent loops of the library are marked and cannot be sliced.
- A loop longer than the module makes the module longer in the same step, so the whole loop plays.
- Click a key of the piano, a drum row (kick, rim, snare …) or a slice row in the grid to hear it through the track.
- STEP VALUES has `+ lane`: any knob of a Cypher Modular instrument becomes a step lane next to VELOCITY and LENGTH. A
  step holds its own knob value, the other steps play the knob; shift-click removes a value, `×` the lane.

**Instruments and effects**
- Cypher Modular: the `sampler` block takes a slice table (up to 64 slices of any length) and a note mode in which the
  note picks the slice (notes 0 to 63 forward, 64 to 127 the same slice reversed). New inputs `tempo`, `halb` and
  `ausklang` set speed, pitch in semitones and the release of a hit. Files may be 60 seconds long (was 30).
- A knob in a graph can be marked `rastet`: it jumps to its value at each note instead of gliding, and a lane on it is
  read at the beat of each note. The slice device uses this for SPEED and PITCH.

**For the agent**
- A new tool `sampler` (92 tools now): list what can be cut, cut, read a cut as text, put it on a track, cut again, move,
  add and remove markers, make a kit or a tone from slices, delete a cut or a tone.
- A new core command plays one note on a project track while the transport stands; clicking a slice in the strip uses it.

**Limits to know**
- The track made from a loop starts at 0 dB; the pan law of the track makes it about 3 dB quieter than the loop.
- A kit made from hits reaches the live drum stream only after a restart; on its own track it plays at once.
- A knob lane changes its value in steps; there is no glide between two steps.

## 2026-11-16, second update

**Instruments and effects**
- `synth-greif2` (Greif 2): Greif's graph and knobs with tables built for a strong Position, the main tone knob of a
  wavetable synth: A "basic to buzz" (sine to an impulse train), B "formant growl" (a resonant peak sweeping over 24
  harmonics), C "hard sync" (slave ratio 1 to 9). Position moves the spectral centroid of A from 137 to 5546 Hz (Greif:
  177 to 486 Hz). Phase modulation starts at 0, because any phase modulation makes the wavetable block choose a duller
  table level for head room. Twelve factory presets with Greif's knob values, for an A/B.

**Device panels**
- A new display type `wavetable`: the table of an oscillator as stacked frames in pseudo-3D, the frame at Position
  highlighted and drawn through the Warp map, following the knobs live.
- Greif and Greif 2 show it on all three oscillators, plus a response curve for both filters, the shape of all three
  envelopes and the waveform of both LFOs.

## 2026-11-16

**Studio**
- The STUDIO view is now a loop workbench: build a module of up to eight instrument tracks that play together with
  one transport, one tempo and one length (1, 2, 4, 8 or 16 bars), independent of the DJ decks. Start from a template
  or an empty module; every change is saved as you make it, and the shelf at the bottom lists your modules.
- Track list with level, mute, solo, meters, add and delete. A CHANGE button next to the instrument swaps a track's
  instrument and keeps its notes. The instrument menu is grouped by category (bass, drums, keys, lead, pad, textur).
- Notes grid: one row per sound for drum instruments, one row per pitch for synths (two octaves visible, scroll over
  the whole range, an octave bar to jump), steps 1, 5, 9 and 13 marked, velocity and length per step, paging over
  long loops.
- SOUND area: the large front panel of the selected instrument and an insert chain of up to four effects per track,
  with the device faces of the PRODUCTION view.
- The previous Studio layout (three Strudel channels for playing live) stays under the new LIVE button.

**Instruments and effects**
- `synth-greif` (Greif), a hybrid wavetable synth: three wavetable oscillators with their own spectra, phase
  modulation between them, warp, an octave stack, a chaos modulator, a frequency shifter and a clean sub. 63 knobs,
  eight voices, twelve factory presets.
- Two new Cypher Modular blocks: `chaos` (a Lorenz or Roessler attractor as a never-repeating LFO) and `schieber`
  (frequency shifter). The `wavetable` block gains phase modulation, warp, an octave stack and custom spectra.
- Live knob control of Cypher Modular graphs now reaches knobs 1 to 64 (was 32).

**General**
- Long menus scroll inside the window; the mouse wheel over a menu scrolls it instead of closing it.

## 2026-11-15, second update

**Production**
- Edit tools for audio and MIDI clips: an EDIT toolbar above the arrangement (SPLIT, GLUE, DUPLICATE, COPY, CUT,
  PASTE, DELETE) and a context menu with split at the pointer. GLUE joins the selected clips of one track into one
  clip, PASTE also works on another track. Shortcuts: Ctrl+E, Ctrl+J, Ctrl+D, Ctrl+C, Ctrl+X, Ctrl+V, Del. A clip
  edge shows a resize cursor and a grip.
- Device faces: the compressor (insert stage and channel compressor) with its curve, live gain reduction, key and
  bypass; the EQ with its response curve and draggable band handles; the saturator with its transfer curve; the
  limiter with ceiling, static curve and gain reduction; the Hall of a return. Compressor and limiter show their input
  and output peaks.
- A knob of a Cypher Modular instrument changes the sound while it is dragged, with one undo step per drag.
- Projects take the meters 2/4 to 12/4. Ruler, position, bar fields, punch bars and the MIDI import follow it.
- The loop range is set by dragging in the ruler or with the BAR and TO fields next to LOOP.
- Automation lanes on groups (insert parameters and rack macros); a group header opens its own automation row.
- Instrument graphs with latency (for example `synth-neuro`) play on project tracks; their latency joins the delay
  compensation of the strip.
- MIDI import: strings, brass and winds go to pad and keys graphs, melodic RB-338 parts start soft.
- The plug-in panel is a fixed overlay with a close button.

**Instruments and effects**
- `bass-banddrive`, a bass for electro, neuro and reese: wavetable and bite voice, a band split, folded mids into a
  moving vowel filter and a clean mono sub, 24 knobs and six factory presets.
- Two new Cypher Modular blocks: `allpass` (first and second order phase rotator) and `kreuz` (Linkwitz-Riley
  crossover with 2 or 3 bands and a compensated sum).
- `drums-909` and `drums-808` have seven per-group level knobs in dB; 0 dB is the old sound byte for byte. The
  `drums-kick` recipe tunes down to 36 Hz and has a pitch decay knob.
- The recipe graphs join the installed graph set, each with one factory preset. Factory presets of effect graphs
  also apply to Cypher Modular insert stages. The factory preset folders carry English names.

**DJ**
- Stems that arrive in an open module no longer sound together with the loop for about 65 ms (a jump of about +6 dB).
- A kern restart brings back the FX3 assignments and the kind of a switched-off FX unit, also when it comes right
  after another restart.
- A CONTROLLERS tab lists every controller assignment, and any continuous target can be learned from it.
- EFFECTS shows one channel at a time, chosen by tabs with lights. LOAD is offered only for decks on a Track place.
- Traktor Kontrol S8: the PLAY and LOOP LEDs follow the deck; the SEQ screen shows the cells of the pattern.

**Getting started**
- A 32-bar demo project for new users with intro, build, break and drop.

## 2026-11-15

**DJ**
- SEQ, a pattern sequencer place. A pattern plays one instrument and holds the lanes you add: notes, one value per
  step, or a curve drawn or shaped onto any knob of the instrument. Each lane has its own grid, from 1/4 to 1/32, and
  may run shorter than the notes. The data is an ordinary MIDI clip with envelopes, so PRODUCTION shows the same
  pattern in its piano roll. The agent writes and reads a whole pattern as text (`seq`).
- Cypher Remix moved from a place to FX3, a third FX unit in its own window. Every channel strip has a key 3 that
  sends the channel through it; key 3 on the master sends all channels.
- The main mixer has four channel strips: deck A, deck B, L1 and L2. The Strudel channels have their strips inside the
  Strudel place, with a SOUND column that picks the instrument of bass and melody and shows its first four knobs.
- A track place folds to a mini view and gives its height to the other place of its column.
- The project transport starts on the next bar of the master clock, also when nothing else plays, so a SEQ deck and
  synced decks stay on the same beat.

**Controllers**
- Akai APC20 as main console for the four DJ channels and the master, Traktor Kontrol S8 with its two screens
  (scrolling waveform, hot cue marks, whole-track overview, Strudel, loop and SEQ views), hot cue pads, loop and browse
  encoders and touch strips (tempo bend while playing, scratch when stopped, SHIFT seeks in whole beats), Maschine MK2
  as a desk for Cypher Modular knobs with their names on its displays, LPD8 knobs on the remix.

## 2026-11-14

**DJ**
- Cypher Remix, a beat-synchronous remix station, as a fourth kind of DJ place. SCENE has one bipolar control: to the
  right five build-up effects, to the left five break-down effects, and a pump that ducks the effect on the beat.
  ISOLATE cuts or adds three bands (cut/add, trans/roll, isolator, gate). PAD rolls the input or plays four drum voices
  in the beat grid from a touch field. RELEASE is a lever that ends the sound with a brake, an echo or a back spin
  and brings the original back when let go. The place picks where the device sits: the master, deck 1 to 4, the loop
  slots L1 and L2, or the Strudel drums, bass or melody. It loads neutral and passes the signal bit for bit until a
  control moves.
- The DJ master has an insert place for an effect graph, in front of the master beat FX (`master/bk/1..64`).
- The loop slots and the three Strudel channels take an effect graph as an insert before their fader. A channel holds
  one graph: where an instrument graph plays, an effect is refused with `belegt`, and the other way round.
- The loop slots show the waveform of their loop with a beat grid, bar numbers and the playhead of the live
  transport.
- Beside a Remix place the two loop strips line up under the deck strips.

**Instruments**
- Cypher Modular has a `remix` block and the device `fx-remix` (52 block types). Its panel brings two new controls, a
  spring-back lever and a touch field in the beat grid, and switches that read the centre as off.

**Agent**
- The `graph` tool takes `master` and effects on `erz/1..3`, `pad/1`, `pad/2`; `regler` moves their knobs
  (`master/bk/<n>`, `<channel>/bk/<n>`).

## 2026-11-13, evening

**DJ**
- Up to four decks. The DJ view has four places; each shows a track deck, the Strudel channels or the loop slots.
  A place switches only while its channel is silent (fader closed, no headphone cue), and the layout is kept per
  browser.
- Loop slots L1 and L2 play on their own DJ channels (`pad/1`, `pad/2`) with EQ, filter, fader and crossfader side,
  instead of on the master. A loop cut from a deck, or loaded by the agent with `box` or `loop_nach_box`, becomes a
  live module with stems and MIDI in the first free slot whose channel is closed (`POST /modul/loop`).
- A module is never placed into a slot whose channel is open, by the page or by the agent (`kanal_offen`); the
  headphone cue does not count as open. The offline render treats the DJ channels as the master, so a live module
  renders the same as in production.
- The crossfader sits centred under the mixer again; disabled buttons look disabled; the channel faders use the free
  height of the strip.

**Instruments**
- Cypher Labor, a new and experimental Cypher Modular block (`labor`) with an instrument and an effect device: a
  two-channel feedback processor with a one-bit delay model, a level-dependent resonant filter and cross feedback.
  Cypher Modular now has 51 block types.

**Production**
- GROUPS, RETURNS and CLIP fold like the other panels, and the arrangement takes the freed height.

## 2026-11-13 (v0.2.0-beta)

**Production**
- The master limiter now catches true peaks between samples. A test tone at +6 dBFS against a -1 dB ceiling came
  out 3 dB over the ceiling before and stays under it now. The limiter stage has 12 samples more latency; the
  delay compensation takes care of it.
- Export with a tail: `ausklang_beats` (0 to 64) on `POST /proj/export` and the `proj_export` tool renders that many
  beats past the end, so a reverb tail is no longer cut off.
- Insert chains hold five stages instead of four.
- MIDI import: tracks on a Cypher Modular graph start at -6 dB, because these graphs play about 12 dB louder than the
  RB-338. Import to Surge XT checked end to end.
- Strudel patterns are compiled in a child process without network access (bubblewrap); without a usable
  bubblewrap the child runs as before and says so once.

**First start**
- The starter sounds rendered by `djk-starter` are dedicated to the public domain (CC0); see THIRD_PARTY.md.
- The example `umgebung.env` sets no paths any more: every line is commented out, so a copy used unedited keeps the
  defaults (before, the library step tried to build its catalog under `/path/to`).
- `djk-starter` repairs half-finished runs: leftovers of an aborted run are cleaned up, a missing loop WAV is
  rendered again, a damaged loop file is reported as `damaged` (return 4) instead of kept.
- `djk-bibliothek` never replaces a catalog with a partial scan when a subfolder cannot be read (return 6); track BPM is
  also read from a plain number at the end of a file name ("Song 128", "Song (128)").
- Sets prepared on another machine: "prepare all" takes the tracks from your own catalog.
- `djk-start --help` names the starter fallback and the kit options; kit choice works without python3.

**Under the hood**
- The working repository now uses the English folder names of this export, so paths in documents and tools are the
  same on both sides.
- A fresh build of this export in a clean Ubuntu 24.04 container followed INSTALL.md from top to bottom; the three
  findings of that run are fixed (the example environment file above, two tests).

## 2026-11-12

**Instruments**
- Three Cypher Modular devices for a low-end-first way of producing: Kick Synth (a sine kick tuned in Hz from
  20 to 130 Hz, with pitch envelope, click, drive and an exact polarity switch, three factory presets), Crunch (an
  insert effect: band limit, two saturation stages each followed by its own limiter at -1 dBFS and output level, dry
  path delay compensated) and Polarity (flips left, right or both channels exactly).
- New Cypher Modular devices: Mono Synth, Poly Synth and Neuro Bass (three synthesizers), Drums 909 and Drums 808
  (two drum machines, the MIDI note picks the drum) and Filterbox, an effect with six filter models and three
  modulation sources. Saw Ladder, the built-in patch, now has ten knobs and three presets.
- The three synthesizers got a build-out. Mono Synth and Poly Synth: a modulation envelope, a second LFO with tempo
  sync and a choice of target, a velocity depth knob and tuning. Poly Synth also a second oscillator and glide. Mono
  Synth also an effects section (chorus, delay, reverb), Neuro Bass a second oscillator, a second LFO, key follow,
  velocity, delay and reverb. Every new amount starts at off and old values are kept, so the existing factory
  presets render byte for byte as before (checked against the old graphs with a null test).
- Per-voice analog drift: a new Drift knob on Mono Synth and Poly Synth. At zero the sound is exactly the old one.
  The wavetable instruments got a wave envelope.
- Cypher Modular has 12 new block types, 50 in all: sample and hold, a multi-stage envelope, an envelope follower, a
  tuned comb filter, a vowel filter, three more filter models, a selector, a drum kit block, a wavefolder and the
  drift block.
- Knob rows per channel, track and stage widened from 8 to 32 and then to 64. A graph can give each knob a start
  value and a centre value, so a knob can begin at "off".
- 55 new factory presets: 40 for the drum machines and the three synthesizers, six more for the synthesizers from
  today's build-out, six for the wavetable instruments and three for Saw Ladder. The preset browser now lists
  103 factory presets.

**Production**
- Up to 16 group tracks, and groups can sit inside groups: a DRUMS group can hold KICK, PERC and HATS groups, each
  with its own inserts, fader and sends. Mute acts on everything below a group, solo keeps the groups above it
  sounding. A project without nested groups sounds and saves exactly as before.
- Cypher Modular graphs come back after a restart of the kern alone.
- Cypher Modular skips the branches of a switch that are not selected. That saves compute; the sound stays bit for
  bit the same.

**Live modules**
- A running loop on a deck can become a live module in slot A or B: it sounds at once, the stems are separated in
  the background. Per stem you can blend between the original and a new instrument path (drums on Drums 909, bass
  on Neuro Bass), adapt the module to the key of the deck on the master, and fade it out over up to 16 bars.
- Modules can be saved, searched and placed again in a later set or a production project, with one undo step.

**First start**
- New users no longer need their own music to begin: `djk-starter` renders kits, loops and a demo project from the
  project's own graphs on your machine, with three starter patterns in the Strudel browser.
- `djk-bibliothek` builds the catalog from your own folders (add, remove, show, build). A deck can prepare a track
  from that catalog when there is no other media library. A catalog built elsewhere is only read, never replaced.

**Panels**
- Every instrument channel has a front panel (a plate) with real units on the knobs, envelope, LFO shape and filter
  curve displays and MIDI learn; Cypher Modular plates also have a preset picker and a save button in the header. A device without a hand-made panel gets an
  automatic one.
- A device page shows the plate enlarged over the page, with a live spectrum of the channel.
- Plates in PRODUCTION: on instrument tracks, on Cypher Modular insert stages and, automatically, on host plugins.
  Live panels for hosted instruments.
- MIDI learn on plate controls, and for the parameters of hosted instruments on the bass and melody channels.
- A Surge XT quick panel with 50 parameters and envelope drawings, and a button that opens the real Surge window.
- With several MIDI controllers connected, you choose the port; software ports are skipped.

**Tablet**
- A tablet in the home network can show the device page as a touch view with large knobs and faders. It is off
  until you switch it on in a config file, and every device is paired with a link that works for two minutes.
  Paired devices expire 30 days after last use. A tablet cannot start or stop playback, change projects or evaluate code.

**Agent**
- The agent has 90 tools: ten for live modules and `oszilloskop`, which shows the last seconds of a channel as an
  envelope with peak, RMS, onsets, pump depth and click suspects. The new knobs, the 64 knob rows and the new presets
  are reached through the existing tools.

## 2026-11-11

**Production**
- Automation lanes on the parameters of insert stages, on the four rack macros and on the eight knobs of a Cypher
  Modular track.
- A utility insert with stereo width from 0 to 4 and bass mono; larger pools per project (8 EQs, 4 saturators,
  2 limiters, 8 utilities).
- A Cypher Modular effect graph as an insert stage, with a tempo-synced delay return as the first shipped graph.
- MIDI import: Standard MIDI files (format 0 and 1) into tracks and MIDI clips, with a preview and a single undo step.
- A Strudel pattern can be turned into an ordinary MIDI clip with notes and clip envelopes.

**Agent**
- The agent has 79 tools, new ones for the MIDI import and the pattern clip.

## 2026-11-10

**Plugins**
- Third-party VST3 and LV2 plugins as insert stages on tracks, groups, returns and the master, and as instruments on
  tracks. Each plugin runs in its own process: if it crashes or hangs, its strip plays dry and in time, and the rest
  keeps playing.
- A scan that survives crashing and hanging plugins, a plugin browser with search, the plugin's own window, plugin
  state stored in the project, and latency compensation for the plugin.
- Projects with plugin stages are exported in real time; the agent can list, insert, bypass and set parameters.

## 2026-11-09

**Recording**
- Audio and MIDI takes in the arrangement: count-in, punch in and out, overdub, take lanes, input monitoring and
  latency-exact placement.

**Instruments**
- Instrument racks: several instruments on one track with key and velocity zones and a chain selector, four macro
  knobs that drive parameters across the members, and stored variations of the macro settings.
- A second Surge XT slot, so two Surge tracks can play side by side.
- A Surge track stores its patch in the project. The patch is chosen from the Surge library and loaded again when
  the project opens.
- A sound word such as `dark` on a Surge patch whose filter is off is refused with a reason instead of doing nothing.

**Routing**
- Group tracks that can be folded in the arrangement, Ctrl+G groups the selected tracks.
- A routing matrix in the page and for the agent: outputs, sends and sidechain keys in one grid.
- Sidechain keys before or after the fader of the source; group, return and master stages can also listen to
  groups and returns.
- Resample any track, group, return or the master into a new audio track.
- Loudness per group and per return.

**Engine**
- The freeze, export and bounce paths wait for the engine's stop report, so two of them in a row no longer refuse.

## 2026-11-07

**Mixing and effects in production**
- Insert chains on tracks, groups, returns and the production master: compressor, EQ, saturator and a master
  limiter, with rack macros and pre or post sends to the returns.
- Mix tools: gate, utility, multiband, channel limiter and a spectrum view.
- Sidechain for the compressor: it can listen to a track, a group, a return or a DJ input (a deck or the pattern
  generator). "Duck by Kick" sets up a ducking compressor keyed by the kick track in one step.
- Latency compensation in the arrangement mixer: tracks with and without plugins stay sample-aligned.
- The reverb runs on its own worker threads.

**Instruments**
- Kit and rack tracks, Surge XT parameters stored in the project.
- Description to sound: a word such as `bright`, `dark`, `tight` or `soft` moves the instrument's parameters by a
  bounded step, one undo step each. Presets can be searched and applied by the agent.

**Stems**
- Stem separation runs on the GPU with BS-RoFormer: drums, bass, other and vocals, plus guitar and piano when they
  are not empty.

**Recording a set**
- Set recording, a voice channel for spoken commentary that ducks the music while you talk, and a text overlay
  for videos.

**Repository**
- The test suites were run on a fresh Ubuntu 24.04 machine. `INSTALL.md` lists what they need. Tests that still depend
  on the local media library or local measurement folders are left out of the public repository for now.

## 2026-11-01
- Cypher Modular: detune on the Fairlight sampler, spring reverb, graphs on more generator channels and the pads.
- Automation lanes in the project.

## 2026-10-31
- Warp markers by hand, warp modes COMPLEX, TONES and BEATS.
- Stems with Demucs, on the GPU when there is enough free video memory, otherwise on the CPU.
- Cypher Modular, with its graph knobs in the control table, the agent tools and the page.
- Documentation in English: architecture, interfaces, ADRs and the agent tool guide. New README, docs pages and
  screenshots.

## 2026-10-25
- Production with 32 tracks, group tracks and a production master with routing.
- Clip warp in RE-PITCH: automatic from the library's bar count, follows tempo changes and ramps sample-accurately.

## 2026-10-20
- First cut of the production view: arrangement, audio and instrument tracks (RB-338, Surge XT), piano roll,
  track mixer, projects with undo, WAV export by the core with a sample-identical null test.
- Track variants (A/B/C in one click), per-track loudness measured offline.
- Stop Cypher hands the arrangement over instead of stopping it.
- Audible scrub on the decks, beat map anchoring.

## 2026-10-15
- Cypher Saett saturator.
- Grid accuracy in the README stated as measured.

## 2026-10-12
- Effects section, own instruments and effects, media library browser.

## 2026-10-09
- Real-time keylock on the decks, Play by hand at any tempo, beat grid snapped to the kick.
- The instrument round trip is latency-compensated.

## 2026-10-05
- First public beta: decks with keylock and sync, live master tempo, screenshots, and the `djk-live` skill that
  shows how an agent plays together with a human.
