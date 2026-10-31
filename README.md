# cypher-dj

**A DJ studio that a human and an AI agent play together.** Two decks, two loop boxes, three live-coded
pattern channels and a software synthesizer, mixed by a real-time core in C++ that keeps one sample
clock. An AI agent can play along through its own set of controls; the human always has the last word.

Built in Germany by Andreas, a DJ, and Cypher, the lab's AI agent (Claude models), starting
19 September 2026.

> **Status: public beta.** It was built on one Linux machine, and Andreas plays and mixes on it there. The native parts build on
> a fresh Ubuntu 24.04 (see [INSTALL.md](INSTALL.md)), but nobody else has played a set on it yet. Code comments are in German. Issues are welcome, see [Contributing](#contributing).

![Overview: DJ view, studio, warp and stems, arrangement with piano roll, Cypher Modular, media library, cue tool, compressor](docs/screens/overview.png)

More pages: [Production, warp and stems](docs/production.md) · [Cypher Modular](docs/cypher-modular.md) · [Track analysis](docs/analysis.md) · [How it was built](docs/how-it-was-built.md) · [Screenshots](docs/gallery.md)

## What it does

**Play**
- Two decks with a beat grid, eight hot cues, loops, beat jump and quantized jumps (1/4 beat to 4 bars)
- 3-band EQ with kill, filter, channel faders, crossfader, master and headphone cue
- Beat FX on any channel or the master, timed in beats: echo, flanger, phaser, filter, reverb, delay,
  ping pong, trans, roll, slip roll, vinyl brake and spiral
- Sound color FX on each channel's COLOR knob, as on a Pioneer mixer: filter, space, dub echo, sweep, noise
  and crush
- A compressor on every source channel (threshold, ratio, knee, attack, release, makeup, parallel mix) with
  presets and an external sidechain, for example the kick ducking the bass
- A reverb send into Cypher Hall, our own spectral reverb (see below)
- Two loop boxes that record, resample and play back in time
- Three [Strudel](https://strudel.cc) pattern channels (drums, bass, melody). Strudel runs as its own
  process; the core plays the resulting events at the sample
- Real instruments: Surge XT hosted in Carla, played by the patterns
- One clock: decks, loop boxes, patterns and effects are scheduled on the same sample counter in the core
- Live master tempo from 60 to 200 BPM, ramped over a bar: the decks and the loop boxes (key-locked,
  pitch kept), the pattern channels and recordings follow it

**Prepare**
- A workshop that reads a track once: loudness, key, tempo map and beat grid, then renders it to the set
  tempo so it is ready to play. The grid is snapped to the kick transients where they can be measured
  cleanly. On the two tracks checked against Ableton Live's warp markers (both measured against the same detected
  kick onsets), the median offset is about 1 ms. The spread from beat to beat is larger, and tracks that cannot be
  measured cleanly keep the raw grid
- A cue tool: a 3-band waveform of the whole track, hot cues set from the keyboard
- Import of grid and cues from a Traktor collection
- A library with sets that can be prepared ahead of time
- A media library browser for tracks, loops and one-shot samples: folder tree, full-text search, filters
  for key (with harmonic neighbours), BPM and energy, a waveform per item, headphone preview, and loops
  straight into a loop box
- Key and energy analysis for the whole library, with BPM filled in where it was missing

**Produce** (since October 2026)
- A PRODUCTION view next to DJ and STUDIO: arrangement with a timeline, library browser, detail area for the selected
  clip, transport bar
- Up to 32 tracks and 8 group tracks; every track goes to the production master or into a group
- Audio tracks: drag a sample from the library onto a track; clips snap to the grid and can be moved, trimmed, split,
  duplicated, faded and looped inside their length
- **Warp**: an audio clip follows the project tempo. The warp markers come from the workshop's beat grid, a Traktor
  grid or the library BPM, and can be set, moved and deleted by hand in a sample editor (double or halve the tempo, set
  bar one here, warp from here, take the project tempo from the clip). Four modes: RE-PITCH (varispeed), COMPLEX and
  TONES (time-stretched with Bungee, pitch kept) and BEATS (slices at the grid or at the transients). Transpose from
  -12 to +24 semitones, detune by ±50 cents. Quantize Audio pulls the transients onto a 1/16 grid
- **Stems**: Separate Stems in a clip's menu splits it into drums, bass, other and vocals with Demucs, on the GPU in seconds (CPU fallback). Four
  tracks appear under the clip in a group, beat-exact, and the original is muted; one undo step takes it all back. The
  run shows its progress and can be cancelled
- Instrument tracks with the built-in RB-338 or Surge XT (one hosted slot); notes are drawn in a piano
  roll with velocity and 1/16 quantize
- Recording: arm an audio track and record one of the studio's own channels onto it, bit-identical
- Tempo, loop range and metronome; per track volume, pan, mute, solo and a meter
- Projects are folders with a JSON file; every change is one undo step, and the undo history survives a restart
- Variants: tracks can share a group (say bass A, B, C); one click in the transport bar makes one of them audible
  and mutes the others, as a single undo step
- Per-track loudness: an offline render measures integrated LUFS, LRA and true peak of every track as it sits in the
  mix (mute and solo count as in the mix); the tracks add up to the export within 0.1 LU
- Stop Cypher hands the arrangement over instead of stopping it: what plays keeps playing, Cypher stops acting, and a
  start of Cypher's that is still waiting for its bar is dropped
- WAV export as an offline render by the same core that plays live. Hosted instrument tracks are frozen first, so the
  file matches what was heard (see [Measured](#measured))
- The agent builds and edits the same projects through its own tools (create tracks, write clips and notes, warp,
  separate stems, mix, start the transport, export)

![PRODUCTION view: one of our own songs split into four stems under the muted original, the warp editor below in COMPLEX mode](docs/screens/production-warp-stems.png)

**Measure before it is loud**
- A native headphone previewer, separate from the browser, which only draws
- The core measures every deck behind its closed fader: band energy, loudness, and overlap in the
  sub-bass with what is already playing
- A rule in the core: the agent may not open a deck that has not been measured first. The human may.

**Let an agent play along**
- "The hand": an [MCP](https://modelcontextprotocol.io) server with tools to load, cue, loop, set EQ and
  effects, write patterns and play instruments
- Some controls stay human-only: crossfader, master, headphone cue, bus faders and effect routing
- Any move by hand overrides the agent, and a stop control halts it
- In the conductor process, autonomy levels from 0 (listen) to 3 (transitions on its own). The
  default is 1: the agent suggests, the human decides
- A skill for Claude Code in [`skills/djk-live/`](skills/djk-live/SKILL.md) that teaches an agent how to play
  *with* a human: think about what a move does before making it, crossfade instead of swapping, one change
  every 8 bars and announce it first. A second skill, [`skills/track-analysis/`](skills/track-analysis/SKILL.md), teaches how
  to measure a track's tempo, grid and phase and cut it into loops and one-shots that close cleanly. Copy a folder into the
  skills folder of Claude Code (`.claude/skills` in your home directory) to use it

## Own instruments and effects

Written in Rust, each as a DSP library plus a VST3 plugin (built with nih-plug), measured against
references before they went in:

- **Cypher EQ**: a parametric 8-band EQ (a filter bank of state-variable filters, 2x oversampled) whose
  curves follow the analog target curve up to 20 kHz within 0.27 dB, where a plain bilinear design is
  off by several dB near the top
- **Cypher Hall**: a spectral reverb (energy decay per frequency bin, early reflections, frequency-wise
  ducking, freeze). It is the reverb on the send and the REVERB beat FX
- **Cypher Komp**: a feed-forward compressor after Giannoulis, Massberg and Reiss (2012) with soft knee,
  parallel mix, external sidechain and a high-pass in the detector; six presets
- **Cypher Saett**: a tanh saturator with first-order antiderivative antialiasing (Bilbao et al. 2017)
  at 2x oversampling; on a hard-driven sawtooth the aliasing stays below -60 dB, against -50 dB without
  oversampling. Available as a plugin, not yet in the core
- **Cypher Modular**: a modular synthesizer. A patch is a JSON graph of building blocks (oscillators, filters,
  envelopes, LFOs, chorus, reverb, delay, dynamics and free feedback paths) with eight knobs that the human or the agent
  can turn. It plays on the melody channel. Example patches: a Juno-style pad, a sync lead, a wobble bass. See [docs/cypher-modular.md](docs/cypher-modular.md)
- **RB-338**: a 303-style bass voice with cutoff, resonance, envelope, decay, accent and slide, playable
  from the bass pattern channel instead of Surge XT

## More in the box

The lists above are the headline. Also in there:

- **Studio view**: the three Strudel channels side by side, each with an automation lane for fader,
  filter and cutoff over 4 to 32 bars
- **Effects section**: one strip per channel showing what plays and how much the compressor pulls, an
  expanded view with every control, and automation per loop for compressor, filter, hall send and EQ
- **Resampling**: record the master into the loop library (1 to 32 beats, starting on the beat), cut a
  running deck loop sample-exact into a loop box, or turn a recorded loop into a Strudel sound
  (`s("rec0")`) that the drum channel can play right away
- **Sounds**: browse, load and save Surge XT patches for the bass and melody channels
- **Mixer details**: per-channel trim, a glue compressor on the master, effect routing post-fader or
  insert, a headphone cue/master blend, level meters per channel
- **Grid by hand**: nudge a track's grid, set bar one on the real downbeat, and keep it for that track
- **Cue pads** as jump cues or loop cues, quantized to the grid
- **Sets**: collect tracks for a planned set and prepare all of them in one go
- **The agent's side**: 56 tools in the MCP server. Besides playing it can listen to a deck behind its
  closed fader, read the levels of the last seconds, wait on the master clock for a number of bars, run
  automation tracks and ramps over bars, and cancel everything it started. When it has an idea while the
  human plays, it proposes; the human accepts or rejects with one key
- **Cue tool**: key and BPM filters with a harmonic-mix option (±1 on the Camelot wheel), named cues,
  4-, 8- and 16-bar loops, quantize, and taking over existing Traktor cues

## How it was built

It started on 19 September 2026 as a Strudel set in a browser, run by Cypher, played with Andreas. On 22 September
Andreas described how he mixes; it became 26 requirements and, the next day, 23 architecture decisions. On 26 September he
turned the plan around: "I want to play with you from the start, not alone." Since then the agent interface is built for
two at the same desk. Every feature since then went through a written plan, one implementing agent per task and a
reviewer per task, and was only called done after its failure case had been shown before and after the fix. The longer
story, with what Andreas said and what came of it: [docs/how-it-was-built.md](docs/how-it-was-built.md).

## Measured

Every number has a date. Measured on the development machine, often under load from other work,
mostly against a silent test sink. Not benchmarks.

| What | Result | Date |
|---|---|---|
| Previewer, command to first sample at the sink | median 8.3 ms over 20 plays (no real audio interface) | 2026-09-26 |
| Previewer, jumps | 8 of 8 targets sample-accurate | 2026-09-26 |
| Waveform of a whole track | 608 ms first time, 32 ms from cache (median of 10 tracks) | 2026-09-26 |
| Key detection | 76.7 % exact and 82.5 % within a neighbouring key, compared with Mixed In Key on 120 held-out tracks | 2026-09-26 |
| Production export against live playback (3 tracks: audio loop, RB-338, frozen Surge XT, 32 beats) | residual peak -200 dBFS, i.e. sample-identical; shifting one track by a single sample turns the test red | 2026-10-17 |
| Audio callback p99.9 with an arrangement playing, quantum 256 | 642 to 789 µs over three runs; 755 to 904 µs with exports rendering in parallel | 2026-10-17 |
| Stem separation of a four-minute track, RTX 4070 Ti | 4.2 to 4.6 s, about 1.2 GB of video memory (CPU: 3 to 4 minutes) | 2026-10-31 |
| Stems against the warped original (real track, beats 16 to 48, at 124 and 128 BPM) | warp markers 0.000 samples apart, frame count exact, one undo restores the project exactly | 2026-10-31 |
| Audio callback p99.9 while a stem separation runs on the CPU, quantum 256 | 1744 to 1838 µs, against 877 to 955 µs without (three runs each); 1407 to 1432 µs when core and Demucs are pinned to separate CPU cores | 2026-10-31 |

## Known limits of the beta

- **Decks keep their pitch at any master tempo, in real time, including during a tempo ramp.** After each
  deck event (start, jump, hotcue) a bridge of about 0.1 s plays in varispeed until the stretcher takes over.
  A deck started by hand does not start while a tempo change is pending or ramping: from the moment the tempo
  changes until the end of its one-bar ramp, which begins on the next downbeat.
- Linux with PipeWire (JACK API) only, tested on Ubuntu 24.04. Pro-Audio device profiles cannot be
  used as outputs yet.
- The headphone path has been checked for signal and level on one USB DAC; its latency and unplugging and
  replugging a device have not been measured.
- Bar-one (downbeat) detection is unreliable; set bar one by hand where it is wrong.
- The instrument round trip (core to Surge XT and back, about 11 ms) is compensated by sending notes early;
  the value was measured against the real instrument at one audio buffer size (256 frames); the offset scales
  with the buffer size and has been checked in software at 128 and 512.
- Human and agent are told apart by a label on localhost. That is a convention, not a security boundary.
  Do not expose the ports to a network.
- The measurement rule covers decks; the pattern channels are deliberately exempt.
- Stem separation on the CPU is heavy: while it runs, the audio callback's tail doubles (see [Measured](#measured)). On a
  free GPU it takes seconds instead. Without one, separate stems when nothing is playing live. Up to 600 s of source per run.
- Stems are not sample-identical to the warped original: summed after warping they leave a residual of about -8 dB, so
  do not play them together with the unmuted original. The drum hits scatter by up to 2 ms (p90) around the original's.
- An energy fingerprint and cue suggestions are planned for the workshop, not built. An
  experimental cue-suggestion pipeline is included as a separate research tool.
- Key detection is weak on major keys (the test library is almost all minor).
- Learning from the human's judgement is planned, not built.
- Production: one hosted Surge XT slot, no automation, sends or plugin inserts yet; recording takes the studio's own
  channels only. Export is refused while the transport is running. The live track meters show sample peaks; loudness is
  measured offline (per track or in the export).
- Sounds saved from a loop into the pattern channels play at their recorded speed, and parameter rides on the
  hosted instrument keep their duration in seconds; neither follows tempo changes yet.
- Many moving parts: Rubber Band, JACK/PipeWire, ffmpeg, Node.js 22.18+, Python, and optionally
  Strudel, Carla and Surge XT. See [INSTALL.md](INSTALL.md).
- The library search expects a catalog database that is not part of this repository.
- Code comments are in German. The architecture docs and ADRs are written in German and published here as English translations; the export refuses to publish a translation whose German source has changed since. Field names and code words in the docs stay German (`regler`, `warp_setzen`). The interface is in English.

## Getting started

See [INSTALL.md](INSTALL.md). No music is included: bring your own tracks and samples.

## Contributing

During the beta we do not take code contributions (pull requests). Bug reports and ideas as issues
are very welcome.

## License

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE). The core links the Rubber Band
Library (GPL) and the pattern channels load Strudel (AGPL). Third-party components:
[THIRD_PARTY.md](THIRD_PARTY.md).

Copyright (C) 2026 Infinimind Creations
