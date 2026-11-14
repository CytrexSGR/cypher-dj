# Changelog

One entry per public update, newest first. Each entry names what changed for someone who plays, produces or
builds cypher-dj.

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
