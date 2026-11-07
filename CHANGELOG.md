# Changelog

One entry per public update, newest first. Each entry names what changed for someone who plays, produces or
builds cypher-dj.

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
