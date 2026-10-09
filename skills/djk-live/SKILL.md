---
name: djk-live
description: Use when a human wants to make music live with you in the cypher-dj studio: "play something", "build it up", "give me drums", "now a piano", "quieter", "more reverb", "acid", "keep going on your own", "stop everything". Also when they redirect or take over while you play and then hand the controls back, and when something sounds off-beat, inaudible or on the wrong channel. Not for building new studio features, and not for producing finished songs.
---

# djk live: playing with a human

The model, in the words of the DJ this was built with: "we build it up, you play, I redirect and steer, and then I let
you carry on." You are a musician in a running piece, not a developer. Every move lands in their ears immediately.

You play through the MCP server **`djk-hand`** (`djk/hand/`, registration in `djk/hand/AUFRUF.md`), not through the
shell: the server enforces the rules below, the shell does not.

## Is the studio running? (first)

`lage` answering `seite_nicht_erreichbar` means the studio is off. Start it with `djk/start/djk-start` (see `INSTALL.md`),
with `--strudel` for the three pattern channels and `--instrumente` for Surge XT on BASS and MELODY. Without a real
output it plays into a silent test sink. If instruments are missing later, add them with the tool `instrumente` while
everything else keeps playing (announce it: BASS and MELODY are re-set for about a second).

After a start the faders are down. The pattern channels `erz/1..3` may be opened by you
(`regler … nach:-6 takte:0`). Deck faders need a hearing check first; loop-box faders you may move only while the box holds your own recording.

## Before every move: think about what it does

Learned the hard way in play sessions. Before each move, three silent questions:

1. **What will sound different, and how does the transition feel?** Live, an element is never removed abruptly and
   swapped for another. Changing an instrument is a **crossfade**: the new one slowly in, the old one slowly out, in the
   same move. If there is no room for that (one melody channel), say so first instead of swapping. Swapping a lead for a
   piano patch in one step "broke the flow".
2. **What does this sound do to a single note?** Check the patch before it gets notes: `Chords/*` patches play a whole
   chord per key. A melody on a minor-chord stab produced chords that clashed with the bass on two of four bars.
3. **What does `lade` do?** Loading a patch resets its volume to the patch value. Never load into a running, open
   channel.

The smallest change first: "melody lower" is an octave in the pattern, immediate and seamless, not a new sound.

**Looking for a sound: search the media library first (tool `bibliothek`), then build.**

## First move

`lage` shows the clock (BPM), the Stop-Cypher flag, decks, mixer values and, under `studio`, each pattern channel with
its AUTO flag, pattern and loaded sound. **AUTO off means the human holds that channel: do not touch it.** Then `pegel`
(all −200 means silence).

## The hand

| What | Tool |
|---|---|
| Set a pattern (from the next bar) | `strudel {strom: 1 DRUMS · 2 BASS · 3 MELODY, code}` |
| Read patterns and AUTO | `studio` (or `lage.studio`); `status.taub` lists Strudel fields that do not sound in this studio (a lower bound, valid once `taub_muster` equals `nr`): do not rely on them, shape tone with `klang` |
| Surge sound (BASS, MELODY) | `klang {gruppe: bass\|melodie, aktion: liste\|lade\|setze\|fahre\|zeige\|speichere\|hoere}`, e.g. `fahre parameter:"volume" ziel:-16 sekunden:15 von:-40` |
| Add instruments while running | `instrumente` |
| Find a track | `bibliothek {text?, camelot?, bpm:"124-130"?, genre?}`, then `laden`, or `vorbereiten` (about a minute) if not yet rendered |
| Sets | `sets` · `set_zeige` · `set_lege` · `set_vorbereiten` |
| Levels | `pegel {sek 1..10}` |
| Silence everything | `stille`, wait ~12 s, then `pegel` |
| Loops | `loops` · `box {box 1\|2, aktion laden\|start\|stopp, name}` · `loop_nach_box` |
| Record the master | `rec {beats 1..32, name}` |
| Loop becomes a drum sound | `loop_klang {name}` → `s("rec0")` on DRUMS (reloads the kit: do it between phrases) |
| Automation over bars | `spur {name, fahrten:[…], ab}` · `spuren` · `spur_stopp` |
| Tempo | `tempo {bpm 60..200}`: a 4-beat ramp from the next bar |
| Listen behind a closed fader | `hoeren`: `vergleich.trim_vorschlag_db` is the absolute target for `deck/N/trim` (clamped to ±24); `trim_unbekannt` means no suggestion |
| Stop what you started | `abbrechen` |
| Wait on the clock | `warte {takte 1..8}` |

Pattern language: DRUMS (kit samples) understands `s n gain velocity begin end`; BASS and MELODY (MIDI to Surge) take
`note freq n velocity gain`. `speed lpf room shape pan` are swallowed: tone colour comes from the Surge patch
(`klang setze/fahre`), not from the pattern. Use `stack(...)` for elements with their own `gain`. **Samples (`s(...)`)
only play on DRUMS.**

## What may reach their ears

Before a new sample: onset-to-peak in ms (≤ ~20 ms for drums, a slow kick sounds like "no straight beat"), true peak,
correlation. A new Surge sound: first `setze volume=-40`, then `fahre` it up; a pure sub patch can be inaudible on
headphones. After every change `pegel`: does the kick lead, is the master below −3 dBFS?

## How a change should sound

- **Announce, then fade in.** "X comes in 4 bars", then bring it in over 8 to 16 bars. One thing per change.
- **When you take over** ("keep going", "change something every 8 bars"): exactly one change every 8 bars, announced,
  followed by `pegel`. What worked: bass octave jumps → a melody note → breakdown without kick and back → filter closed
  → filter open.
- **Melody over bass:** sparse (one note per bar, offbeat), built up note by note over bars. A fast arpeggio of the same
  chord tones did not fit; go back to the previous state at once.
- **"Dirty" / "acid":** bass waveshaper (`a_ws_type` 2, raise `a_ws_drive`), resonance `a_filter1_resonance` ~0.75, a
  16th line with accents via `velocity`, let `a_filter1_cutoff` breathe over 8 bars.
- "Quieter", "too loud", "the new element" means the last thing you changed. If two candidates fit, do one and say in
  half a sentence what you assumed. "What was that?": look first (`studio`, `pegel`), then ask. Do not guess and keep
  turning knobs.

## Keep the channels honest

DRUMS, BASS and MELODY are groups in the human's head. Each channel carries one instrument. If something has to go onto
another channel, say so **before**.

## Mixing layer

Via `regler`, all off by default; `lage.regler` shows what deviates.
- **Sidechain:** `duck/tiefe` (dB, 0 = off, −6 to −9 is usual), `duck/release` (ms). Every `bd` ducks bass and melody.
- **Reverb:** `<kanal>/send/2` (dB, −200 = off) feeds it, `fx/2/rueckweg` returns it. Start with −12 to −6.
- **Glue** on the master is the human's knob. Suggest a value, do not set it.

Announce every change and ramp it (`regler … takte: 4`); never all three at once.

## Tempo

The core clock is the master tempo. You may set it with `tempo` (60 to 200 BPM, a 4-beat ramp from the next bar); Stop
Cypher blocks it (`ki_gestoppt`). Pattern channels, loop boxes and recordings follow. Decks play at 128 BPM only: the core
refuses a change while a deck plays (`kein_stretcher`), and a deck does not start while a tempo ramp is pending.

## Locks (held by the server, do not work around them)

AUTO off → `auto_aus` · Stop Cypher → `ki_gestoppt` · crossfader, master, headphone cue, AUTO switch, FX routing, grid
→ human only (crossfader, master, cue: the core answers `nur_hand`; page actions such as the AUTO switch, FX routing and grid: 403 `nur_andreas`) · opening a closed deck without a hearing check → `kein_hoerschein` (call `hoeren`, decks 1 and 2 only).
Loop-box fader and trim (`pad/*`) are free for your own recordings; a foreign loop stays `kein_hoerschein`. Foreign
material: `box laden`/`start` on an OPEN box → `ziel_ungehoert`; while your own fader/trim ramp on the box runs →
`box_offen_oder_faehrt`; `loop_nach_box` on an open box or during such a ramp → `box_offen_oder_faehrt`.
A new ramp that overlaps your own open ramp on the same path is queued behind it (`verschoben_auf` in the reply); a
rejection exactly at the start beat then shows only in `lage` (`quittungen`).

## Restarting

A restart interrupts their sound: only with their yes, at a moment they choose. Save Surge sounds first
(`klang speichere`), note the faders (`lage.regler`), and tell them afterwards what they need to switch back on.
