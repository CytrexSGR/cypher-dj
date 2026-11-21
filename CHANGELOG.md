# Changelog

One entry per public update, newest first. Each entry names what changed for someone who plays, produces or
builds cypher-dj.

## 2026-11-21, sixteenth update

**Containers as the console unit**
- The mixer now has four containers, A to D, each with one channel strip and one input: empty, the deck player of that
  container, or a module. Whatever sits in a container sounds through its fader, EQ, filter and sends, and nothing reaches
  the master past a container.
- Any module can sit in any container, a Strudel module in A or B included. A module no longer has fixed channels of its own.
- The Strudel module holds one track per stream, up to 16 streams, each with its own strip (inserts, filter, EQ with kill,
  fader, sends into a Hall and a Delay return). The streams 9 and 10 are normal streams now. The old `erz/<n>` paths keep
  working, controller maps and scripts need no change.
- The arrangement engine has eight returns instead of four.
- The loop boxes are gone; loops play in the loop deck. Production runs as a service with a hidden strip and renders
  bit for bit as before, and the previewer is a service as well.
- Project files are written as `cypherdj-projekt/3` with the four places; older files are lifted when they are opened.

**Engine load**
- A muted pattern no longer computes behind its closed mute: it gets no new notes, its tail dies away and its instrument
  rests. Whether a note is muted is decided on the note's own sample, so a scene that unmutes on the bar keeps the note on
  that bar. With the track's PFL on, a muted track keeps its notes for the cue.
- When the track workers have to step back and the serial fallback cannot keep up either, the workers come back on the next
  block instead of staying off for minutes. Before, a heavy project could slow the clock to half its tempo.
- Every one of the 16 Baukasten tracks of a project now moves its sound live when a knob is dragged (before: the first 8).

## 2026-11-20, fifteenth update

**Loop decks**
- The LOOPS place now holds two loop decks (LOOP 1 and LOOP 2) of four tracks with eight cells each, in place of the two
  module slots A and B. Each deck sums into one mixer channel, L1 and L2.
- A click on a cell launches it on the next point of the launch grid (a quarter beat, half beat, beat, bar or four
  bars); the cell that was playing on that track ends on the same point. A loop keeps the master tempo, a one-shot plays
  as recorded. Launching works with the transport stopped or running, and the transport does not stop a playing loop.
- Scene buttons start a whole row of cells at once; an empty cell in the row stops its track.
- Every track has a volume, a mute and a filter (left low-pass, right high-pass, centre neutral).
- Cells have a name, one of 16 colours, a kind (loop or one-shot), a gain and a length; they can be moved and swapped,
  also between the two decks. Library loops and the loops and stems of a module can be loaded into a cell, and a track deck
  can export its running loop into a loop deck track with LOOP and 1 2 3 4.
- Loop sets store the content of a deck under a name; loading one replaces the deck in a single undo step.
- A running loop can be re-entered at one of eight slices.
- A Traktor Kontrol S8 side can show its loop deck: the pads launch cells in the cell colours, SHIFT and a pad stops a
  track, the encoders move the row pair and the grid, the faders, dials and buttons set volume, filter and mute, the
  display buttons launch scenes and CAPTURE takes the running loop of the track deck into the deck.
- Every loop track has its own small channel strip inside the deck: a three-band EQ with kill, a HALL and a DELAY send whose
  echo stays inside the deck's mixer channel, and one effect slot (for example Remix or Crunch). The strip row is folded away
  by default and opens with STRIP; on the S8 the FX buttons switch the four dials between filter, the EQ bands and the sends.
- The four faders now belong to the four places: place 1 is strip A, place 2 is B, place 3 is L1 and place 4 is L2 (the S8
  and the APC20 stay fixed). What stands in a place, a track deck, a SEQ deck, the Strudel sum or a loop deck, sounds
  through the fader of that place; a loop deck plays into the channel of the place that shows it.
- The Strudel place can record the sum of its three channels into a loop deck track: a click on a track number in the row at the foot of the
  place takes the running sum and writes it as a new cell.
- Screenshots: a new LOOP 1 view with the channel strip row open, and new DJ view, media library, effects and overview
  images that show the loop decks instead of the old slots.
- Launching, switching, the filter and the slices were measured in the studio; the feel on the page and on the S8 is still to be
  checked by hand.

## 2026-11-20, fourteenth update

**SEQ deck**
- Every SEQ deck has its own PLAY/STOP in its head. On a stopped live container it starts this deck alone; a second
  deck joins a running one just before the next bar and leaves on the bar, so decks come and go in time.
- "hide empty" folds away the lanes that hold nothing at the press and counts them in the pattern head; a lane added
  or emptied afterwards stays in view.
- A place that holds a SEQ deck can switch to TRACK, LOOPS or Strudel at any time: the deck is muted on the next bar
  and kept, and SEQ shows it again. Before, the deck had to be cleared first.
- A Novation Launchpad Mini MK3 can be the step grid of the SEQ deck: four lanes of 16 steps in the colours of the
  page, a white playhead, a pad press sets or clears a step. Built and tested against a simulated device; the look on
  the real device is still to be checked.

**DJ view**
- On screens around 1080 px and lower the library dock now gives way, so the faders of the lower mixer strips stay
  visible while it is open.

**Docs**
- The overview collage shows twelve current views, among them the SEQ deck, the LIVE view, the tracker and Cypher
  Remix; the gallery has new screens of the DJ view, the SEQ deck, the tracker and the Remix window.

## 2026-11-20, thirteenth update

**First track made entirely inside cypher-dj**
- Cypher produced a five-minute techno track in the application alone: the patterns written in TRACKER, Kraken as
  bass, drone and acid line, the Drum Synth, a Kick Synth tuned to the key and resampled to audio, Duck by Kick,
  returns and automation lanes, measured and exported in PRODUCTION. Andreas judged it by ear and liked it. Every
  place where the work got stuck became a fix or a note below.

**Studio**
- Every insert stage, return, group and the master can open in a window of its own (WINDOW ↗ on the card or in the
  chip menu), with the full surface of the stage; a knob turned there writes into the project and the window follows
  the project. A window whose target was deleted says so, and undo brings it back.
- Hints for newcomers, from a usability test with a reader who knew only these docs: the empty arrangement and the
  DEVICES list say how to add an instrument track (double click or drag), the deck says how to open the library
  (⤢ or G), TRACKER says when EDIT is off, the export line names a loop-only export, and the preset menu is labelled.

**Tracker**
- The ProTracker import was run against 25 real modules (public domain and Creative Commons) and now matches the
  length libopenmpt plays for all of them. Fixed on the way: 15-sample Soundtracker modules, pattern loops (E6x),
  pattern break and position jump (Bxx, Dxx), tempo and speed changes (the project tempo is the mean over the rows
  played), songs faster or slower than 60 to 200 BPM, and the level of 6 and 8 channel modules. EC, ED, E1, E2, EA,
  EB and 9xx without a note are reported and left out.
- Clearing the last note of a pattern removes the emptied clip and its linked copies, so no empty clip stays behind
  in every section.

**Install**
- A fresh install from this repository in an empty Ubuntu 24.04 container found three faults, all fixed: the start
  script could not read the storage table, `djk/requirements.txt` lacked Pillow (the S8 and Maschine screens), and a
  Python module of the Surge host was shadowed by a package of the same name.

**Sounds**
- An offline check of 78 sounds (Kraken, Drum Synth, the 8-bit devices and the presets of the six upgraded synths)
  found no DSP defect and eight sounds that were too hot: Kraken Fold Drone, the Juno pad of Poly Synth, the choir
  wavetable synth and two Amiga presets now peak below -1 dBFS.

**Limits to know**
- The window of a stage was checked against a stand-in page; size and place on a real second monitor and the native
  plugin window were not.
- Two Kraken presets (Gate Walker, Glass Rain) keep sounding after note off on purpose; in a set that can surprise.

## 2026-11-20, twelfth update

**Tracker**
- A fifth view, TRACKER, shows the open production project as tracker rows: a column per instrument track, a cell per
  note, the song list as the arrangement. There is no separate tracker document: what you write there opens in
  PRODUCTION and the other way round. Keyboard entry, selection, clipboard, interpolation, transpose, undo and
  transport; time insert and remove and section commands with ripple; a text form of the pattern.
- Patterns that repeat in the song are linked clips: an edit in one reaches all of them, and trimming one unlinks it.
  PRODUCTION shows the chain sign and the section borders on the ruler.
- Effect commands in up to four effect columns, in the manner of the classic trackers: arpeggio, slide up and down,
  glide to note, vibrato, tremolo, volume slide, set level, retrigger, pan, sample offset and reverse, on a grid of
  ticks per row (6 by default, the 50 Hz of the old trackers at 125 BPM and 4 lines per beat). They are stored as
  commands and unrolled for playback, offline render and MIDI export; on stepped 8-bit devices every tick is a jump,
  on smooth devices the movement glides.
- 8-bit devices for the Baukasten: amiga (a bank of up to 32 sample slots in the manner of an Amiga voice), chip-puls,
  chip-dreieck and chip-rauschen, built on two new blocks, `paula` and `lfsr`. Templates 8-BIT 4 CHANNELS and CHIP,
  SAVE MODULE and a tracker shelf.
- IMPORT MOD reads a ProTracker module into a new tracker module, samples and patterns included, in one undo step.
- TO DJ hands the current section (up to 64 beats) to a SEQ deck, one pattern per instrument track.

**One dock**
- PRODUCTION and the EFFECTS tab of DJ and LIVE use the same dock as STUDIO: one card per track, group, return, effect
  unit and the master, the effects as chips on the card, the same menus and the same floating windows. In PRODUCTION
  it replaces GROUPS, RETURNS and INSERTS; in the EFFECTS tab it replaces the channel strips, the detail view and the
  MASTER, SENDS and BUS panels. Cards take plugin, effect and preset drops, + INSERT lists what can go there, and a
  chip menu holds bypass, order, key source and the native window.

**Instruments**
- Kraken, a semi-modular synth with four voices and a 16 by 16 patch field, with a cabinet view that draws the jacks
  and cables, and 14 factory presets (six of them use the patch field). New blocks `matrix`, `funktion` (a dual-slope
  function generator) and `lpg` (a low-pass gate).
- Drum Synth: a kit of eight pads (kick, rim, snare, clap, tom, closed hat, open hat, cymbal), each pad a drum recipe
  with its own knobs, picked by the played note through the new block `notenwahl`.
- Front panels for the rest of the instruments and effect graphs (analog role instruments, wavetable, FM, sampler,
  drums), and factory programs of the Launch Control 3 for every instrument panel. A panel greys a control that is not
  heard with the current settings and says in its tooltip what makes it heard.
- The DEVICES list has a star per device, filter chips for favourites and your own collections, and a double click
  adds the instrument as a new track or the effect to the selected strip.
- Sampler: key and velocity cross-fades between zones and a release level that follows the hold time.
- Wavetable tables are cached and shared between voices: a 256-frame table needs about half the memory and half the
  build time, bit-identical to before. Tables can now hold up to 256 frames.
- Fixes that change the sound: the Phase mod knob of Neuro Bass and the Clean sub knob of the Reese wavetable synth had
  no audible effect and now do; the wavetable oscillator restarts only on a rising trigger.

**Engine and studio**
- MIDI export writes one channel per part (drums on channel 10) and widens the bend range to the largest bend.
- A Surge host that systemd restarted gets its parameter map back without waiting for the next command; a deck load
  ends running fader parts of the whole coupling group; a return fader lane can be taken over by hand while its
  automation plays.
- A number of smaller fixes in the tracker, the slot banks, the start scripts and the tests.

**Limits to know**
- The tracker, Kraken, the Drum Synth and the dock were checked in automated tests (the dock of the EFFECTS tab also in a
  headless browser); they have not yet been heard in full by a listener. The MOD import reads four-channel ProTracker
  modules and was tested with generated modules, not with a collection of real ones.
- The dock is not yet in the FX1, FX2 and COLOR units of the DJ view; they keep their old surfaces.
- SFZ import and export for the sampler are not built.

## 2026-11-18, eleventh update

**Controllers**
- A controller place can follow the synth in front. With FOLLOW on for a place in the CONTROLLERS window, the knobs of the
  instrument you select (a project track in PRODUCTION or in the workbench, a pattern of a SEQ deck, a channel in
  INSTRUMENTS) are put on the controls of that device, and they move with you when you select another one. Factory
  presets ship for the Novation Launch Control 3 and the Akai LPD8 for six synths: Mono Synth, Poly Synth, Neuro Bass and
  the three wavetable synths (reese, supersaw, chor). SAVE MAPPING keeps your own layout of a synth, which FOLLOW then
  prefers over the factory one. A knob of a project track that you turn on a controller is written into the project
  after it has rested for a moment, as one undo step labelled Controller, except for a knob that a lane or a clip
  envelope drives.
- Programs on the Launch Control 3. A preset can hold several programs: whole assignments of the 16 encoders and 8
  buttons for one synth, cut along the boxes of its front panel (Mono Synth has four: oscillators, mixer and filter;
  envelopes, LFO and voice; modulation and chaos; effects). Page up and Page down step through them, and the device
  window turns to the page that belongs to the program. The display shows the program number and the names of its boxes
  for a moment.
- The eight buttons of the Launch Control 3 step the choice fields of a synth, such as waveform, filter type and voice
  mode: every press moves the field to its next position and wraps around.
- The LEDs of the Launch Control 3 show the colour of the panel box the control belongs to, the same colour the device
  window gives the box. Every program starts with the strongest colours.
- The values of the knobs go back to the endless encoders, so after a sound preset, a program change or a move with the
  mouse an encoder carries on from the real value instead of jumping.
- A mapping entry can be valid on any MIDI channel, so a device set to another channel or program still drives its
  preset. An entry on an exact channel wins.
- The keys and pads of a MIDI keyboard play the instrument in front. That is the selected project track while it is in
  front (the studio arms it for MIDI for as long as it is in front, without writing anything into the project, and a
  recording takes that arm back), or a live channel: the bass, the melody, the extra pattern streams and the two loop box
  pads. The CONTROLLERS window shows one line, KEYS to the target, with a switch. A note that is assigned to a button in
  the learn table is a button, not a key.
- Akai APC20 as the project mixer: while the main window shows PRODUCTION, faders 1 to 8 move the tracks of a bank of
  eight and the master fader moves the project master (the fader travel follows the taper of the page's faders, so half
  travel is half travel on the screen). Activator, Solo/Cue and Record Arm are mute, solo and arm of the track, with
  their LEDs. Shift with Play or Stop starts and stops the arrangement, Shift with Left or Right steps the bank, Shift with
  Up or Down moves the track in front, and the synth window and the Launch Control follow it. PRODUCTION frames the tracks
  of the bank with an orange bar. In every other view the APC20 is the DJ console as before.

**Studio**
- A window of its own for the instrument of a project track, for a second monitor: OPEN in the PRODUCTION track head and
  in the header of the device panel, WINDOW on the device card of the workbench dock, OPEN in a SEQ pattern head. The
  address is `#geraet=<track>`. It shows the front panel of that track and follows the project: values changed in the
  main page, by undo or by a controller show at once, and a knob dragged there makes the same undo step as in the main
  page. The window follows the track in front (FOLLOW in its title line; off pins it to its track), and one window
  serves every track.
- The device window has a controller strip above the panel. It draws the controls of every controller that drives the
  track in the layout of the device, buttons and pads included, with the number of the control inside the knob it drives.
  HIDE and SHOW fold it (folded at first); the head line with the program, LEARN and SAVE MAPPING and the box titles
  in the LED colours stay. LEARN arms a knob of the panel for MIDI learn.
- PRODUCTION track heads: every track fader has the same length (a long device name is cut instead of widening the head),
  a fader or pan that a controller moves shows in the head at once, and a yellow frame with CTL marks the track the
  controllers drive.
- Five duplicate instruments leave the instrument pickers: Greif 2, the three Juno Pad variants with echo, hall and
  dynamics, and the sync lead example. A loaded one stays listed where it sits, the graphs still load by name, and their
  sounds stay in the sound list (Greif 2 sounds carry the suffix II; each of the other four has one factory sound).

**Instruments and effects**
- Synth upgrades. Mono Synth gets a chaos LFO (rate, to cutoff, to oscillator 2 pitch) and a clean sub that skips filters
  and effects. Poly Synth gets wave position, warp, stack, phase modulation and chaos. Neuro Bass gets warp, stack, phase
  modulation, chaos and drift. The three wavetable synths get warp, stack and chaos, and in part phase modulation, a clean
  sub, band drive and a chorus. Warp has three modes (bend, asym, sync); stack adds a copy an octave up, on some synths
  also an octave and a fifth. With every new knob at its start value, the default sound and the factory presets of
  before render byte for byte as before (a null test against the old graphs). Measured on synthetic signals, not yet
  heard by a listener.
- 191 factory presets of our own devices ship now, 143 of them for Cypher Modular graphs.

**For the assistant**
- Cypher can set a controller place and its FOLLOW flag. Learning, presets and mapping stay with you.

**Limits to know**
- Not confirmed on the device: that the encoders carry on from the value sent back (the bytes go out, the unit sends no
  echo), the text on the Launch Control 3 display, the button LEDs, the step buttons, and the keys of a keyboard reaching
  a live channel (tested in the core's tests only). The encoder LEDs were seen lit on the device; the first, pale palette
  was replaced by saturated colours that have not been looked at since. The Page buttons were measured on the unit.
- Akai APC20 in PRODUCTION: the Shift functions are taken from a description of the device and were not measured on it.
  The rest was checked by injecting MIDI; hand tests so far were the faders (whose taper was corrected after one), not
  mute, solo, arm or the steps of bank and track.
- Controllers reach the knobs of the first eight Cypher Modular tracks of a project (the core has rows for eight). The
  ninth to sixteenth track take a knob by hand but no controller.
- The first press of a step button after a restart or a preset change starts from the value of the row, not from the
  project's value.
- A Launch Control 3 left in its fixed default mode sends on another channel and does not match the factory presets.

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
