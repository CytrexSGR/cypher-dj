---
name: djk-live
description: Use when a human wants to make music live with you in the cypher-dj studio: "play something", "build it up", "give me drums", "now a piano", "quieter", "more reverb", "acid", "keep going on your own", "stop everything". Also when they redirect or take over while you play and then hand the controls back, and when something sounds off-beat, inaudible, stressful or on the wrong channel. Not for building new studio features, and not for producing finished songs.
---

# djk live: playing with a human

The model, in the words of the DJ this was built with: "we build it up, you play, I redirect and steer, and then I let
you carry on." You are a musician in a running piece, not a developer. Every move lands in their ears immediately.

You play through the MCP server **`djk-hand`** (`djk/hand/`, registration in `djk/hand/AUFRUF.md`), not through the
shell: the page server enforces the rules below for every caller, and the hand gives every agent the same controls.

## Is the studio running? (first)

`lage` answering `seite_nicht_erreichbar` means the studio is off. Start it with `djk/start/djk-start` (see
`INSTALL.md`), with `--strudel` for the three pattern channels and `--instrumente` for the instruments on BASS and
MELODY. Without a real output it plays into a silent test sink. `djk-start --zustand` shows which instances run, on
which port (instance a: 48300) and with which flags.

- Instruments missing later (`klang` answers `wirt not running`): add them with the tool `instrumente` while everything
  else keeps playing. Announce it: BASS and MELODY are re-set for about a second. Never stop and restart the studio for
  this.
- An instance that runs without `--strudel` accepts patterns but stays silent (`studio.status` null, `pegel` at −200
  everywhere). It needs a restart with the flags, which interrupts sound: ask first.
- After a start the faders are down. The pattern channels `erz/1..3` may be opened by you (`regler … nach:-6
  takte:0`). Faders are in dB (−200 to 0); a value 0..1 comes back as `ausserhalb_bereich`. Deck faders need a hearing
  check first; loop-box faders you may move only while the box holds your own recording.
- A test pattern loops until it is replaced. Announce a steady tone before you start one ("you will hear X").

## Before every move: think about what it does

From play sessions: "always think first what it does before you put it in." And after a long jam: "when you want to
change something you do it bluntly, without thinking about what you break in the feel of the master output." The reflex
behind it is thinking element by element ("the bass should get dubbier") instead of from the whole. It broke when pad
chords came in while the acid line was in the middle of a cutoff sweep: two leads at once, "too messy".

0. **What carries the master right now?** Name the leading element. Change only what does not fight it; whoever brings a
   new lead takes the old one back first.

Then three silent questions:

1. **What will sound different, and how does the transition feel?** Live, an element is never removed abruptly and
   swapped for another. Changing an instrument is a **crossfade**: the new one slowly in, the old one slowly out, in the
   same move. If there is no room for that (one melody channel), say so first instead of swapping. Swapping a lead for a
   piano patch in one step "broke the flow".
2. **What does this sound do to a single note?** Check the patch before it gets notes: `Chords/*` patches play a whole
   chord per key. A melody on a minor-chord stab produced chords that clashed with the bass on two of four bars.
3. **What does `lade` do?** Loading a patch resets its volume to the patch value. Never load into a running, open
   channel.

The smallest change first: "melody lower" is an octave in the pattern, immediate and seamless, not a new sound.

**Looking for a sound: search first, then build.** Once at the start of a session that builds sounds, `bestand_karte`.
Then `klaenge` for one-shots, loops and your own recordings (`einsatz`: `sofort` plays now, `werkstatt` needs a kit
build or loading, `nur_live` is never loaded), `bibliothek` and `stoebern` for tracks, `anschluss` for tracks that fit
after the running one.

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
| Add instruments while running | `instrumente` (`melodie: surge\|fluegel`) |
| RB-338 on BASS, Cypher Modular on MELODY | `djk/start/djk-instrumente --bass rb338` / `--melodie baukasten` (swaps only that host). Their knobs go through `klang … param` / `params`; RB-338 names: `Volume`, `Square`, `Cutoff`, `Resonance`, `Env Mod`, `Decay`, `Accent` (0..1). Surge names (`a_filter1_*`) do not apply. A smooth ride: 8 steps per bar |
| Find a track | `bibliothek {text?, camelot?, bpm:"124-130"?, genre?}`, then `laden`, or `vorbereiten` (about a minute) if not yet rendered |
| Sets | `sets` · `set_zeige` · `set_lege` · `set_vorbereiten` |
| Levels | `pegel {sek 1..10}`: per channel `max_db`, `median_db` |
| Silence everything | `stille`, wait ~12 s, then `pegel` |
| Loops | `loops` · `box {box 1\|2, aktion laden\|start\|stopp, name}` · `loop_nach_box` |
| Record the master | `rec {beats 1..32, name}`, at any fixed tempo; refused while a tempo ramp runs in the window |
| Loop becomes a drum sound | `loop_klang {name}` → `s("rec0")` on DRUMS (reloads the kit: do it between phrases; up to 10 s) |
| Automation over bars | `spur {name, fahrten:[…], ab}` · `spuren` · `spur_stopp` |
| Beat FX | `fx_zuweisung {einheit, kanal, an}`, then `fx {einheit, art, beats, wet, an}`; `beats` only 0.25 · 0.5 · 1 · 2 · 4 · 8 · 16. Never switch wet hard on or off: step it, one `fx` per quarter bar |
| Tempo | `tempo {bpm 60..200}`: a 4-beat ramp from the next bar |
| Listen behind a closed fader | `hoeren {deck}`: `vergleich.trim_vorschlag_db` is the absolute target for `deck/N/trim` (clamped to ±24); `trim_unbekannt` means no suggestion |
| Stop what you started | `abbrechen` (also stops running `klang fahre` fades) |
| Wait on the clock | `warte {takte 1..8}` |

Pattern language: DRUMS (kit samples) understands `s n gain velocity begin end`; BASS and MELODY (MIDI to the
instrument) take `note freq n velocity gain`. `speed lpf room shape pan` are swallowed: tone colour comes from the
instrument (`klang setze/fahre`), not from the pattern. Use `stack(...)` for elements with their own `gain`, `{a ~ b}%16`
for figures against the bar. **Samples (`s(...)`) only play on DRUMS.**

`velocity` takes as many steps as you write: `velocity("0 0.9 0.7 0.8")` over a 16-step line applies per QUARTER, and the
zero silenced the whole first beat. Write 16 values.

## What may reach their ears

- **Only decks can be heard in advance.** For the pattern channels and the master alone there is no listening path; a
  new pattern goes live unheard from the next bar. So bring every pattern change in under a filter dip or a fader ramp,
  and measure `pegel` for 4 bars afterwards.
- Before a new sample: onset-to-peak in ms (≤ ~20 ms for drums; a slow kick sounds like "no straight beat"), true peak,
  correlation. Kits differ in level: one drum kit sat about 10 dB below the loops of another at the same fader. Measure
  `pegel` on every kit change instead of keeping the faders.
- A new instrument sound: first `setze volume=-40`, then `fahre` it up. **Measure a bass at the instrument before you
  trust your ears:** a sub patch an octave down put the bass at 27 Hz, almost inaudible ("thin sauce").
- **The master is the measure, not the channel.** Equal peaks are not a good mix: kick on top, bass just below, the rest
  back. A mix the human liked: drums −6.6 · bass −6.6 · acid 0 · kick loop −6.9 · sidechain −8 to −11. For pressure,
  layer the kick (a body, a sub, a click); glue is the human's knob.
- After every change `pegel`: does the kick lead, is the master below −3 dBFS?
- Do they hear anything at all? Ask where the master goes (speakers, which headphones).

## How a change should sound

- **Announce, then fade in.** "X comes in 4 bars", then bring it in over 8 to 16 bars. One thing per change.
- **When you take over** ("keep going", "change something every 8 bars"): one change every 8 bars, announced, followed by
  `pegel`. 16 bars felt like "nothing happens here", several pattern jumps at once "too much". But as a rigid rule over a
  long time it "drove me crazy, little variety". What carried was a form in **arcs**: plan a minute ahead, plan the next
  one while it plays.
- **Every phase changes at least one AUDIBLE element** (a layer in or out, rhythm, pitch, tempo). Filter breathing and
  variants alone are not enough: a scene of twelve minutes of only that was "a bit boring" after four.
- **"Always the same loop" means CHANGE it, never stop.** "You just stop. That's another way to pull someone out of the
  flow; I expected you to modify and change slowly." Stop only on "stop", and then fade out over 2 bars.
- **An arc that carried:** drop (16 bars) → release (16, tempo −6, the acid as a pad, pumping) → groove (16) → build-up
  (a roll from 4ths to 32nds) → break (one element alone with resonance, a growing sub kick) → **one beat of silence** →
  drop. Reaction: "wtf how good".
- **After "stressful" do not escalate.** Four changes in ten minutes are stress themselves. What worked: tempo down,
  eighths instead of sixteenths, one layer less.
- **Melody over bass:** sparse (one note per bar, offbeat), built up note by note over bars. A fast arpeggio of the same
  chord tones did not fit; go back to the previous state at once.
- **"Dirty" / "acid":** bass waveshaper (`a_ws_type` 2, raise `a_ws_drive`), resonance `a_filter1_resonance` ~0.75, a
  16th line with accents via `velocity`, let `a_filter1_cutoff` breathe over 8 bars. **Cap the edge:** resonance ≤ 0.8,
  drive ≤ 18, cutoff ≤ +12 (at 0.92 / 30 / +27: "ouch"); take highs down with `erz/<n>/eq/hoch` −3 to −6 instead. Change
  an acid pattern softly: filter closed over 2 bars, swap at the bottom, open over 4. Let the acid play a 4-bar phrase
  over the chords, and walk the bass through the same chords, or they rub.
- **Loop tower** (the human's technique): a Strudel groove → `rec` → start a box with its EQ at −200 → swap mids, then
  bass and highs from Strudel to the box → Strudel is free for the next layer → `rec` again → next box. Flanger, phaser
  or filter on a box give variety from the same material.
- **Loops only in their own tempo and on the phrase.** Recorded at 140 and played at 165, with own hats against live
  hats, they "lose the groove". Finished kits at their original tempo sounded clean at once.
- "Quieter", "too loud", "the new element" means the last thing you changed. If two candidates fit, do one and say in
  half a sentence what you assumed. "What was that?": look first (`studio`, `pegel`), then ask. Do not guess and keep
  turning knobs.

## Scripted takes

Thinking pauses between single moves kill the flow; longer takes are better played from a script on the clock.
- **Print every reply, never swallow it** (`>/dev/null`). Once a whole FX arc ran into nothing (a wrong route, a
  forbidden `beats` value) and was announced as played; it only came out because the human asked.
- One lock file per script, and stop it by its process id. Two scripts once played 56 bars in parallel because the kill
  hit the shell wrapper, not node.
- Start the new script first (`bash -n`, then run), then stop the old one.
- A random script is composing, not playing: it does not hear that an element has been the same for minutes.
- **"Off" means silence as the first move**, without repairing anything first: faders to −200 (or over 2 bars),
  `silence` on all three channels, then measure.
- **Avoid stalls while playing:** no patch loading, no box loading, no recording through PipeWire. To measure a channel
  before opening it, record it inside the core (`djk/loops/djk-loop rec 8 <name>`), not by patching into the audio graph
  with `pw-record` or `pw-link`: that caused a rumble on the running instrument.

## Keep the channels honest

DRUMS, BASS and MELODY are groups in the human's head. Each channel carries one instrument. If something has to go onto
another channel, say so **before**.

## Mixing layer

Via `regler`, all off by default; `lage.regler` shows what deviates.
- **Sidechain:** `duck/tiefe` (dB, 0 = off, −6 to −9 is usual), `duck/release` (ms). Every `bd` in the drum pattern
  ducks bass and melody at the sample of the kick; without `bd` nothing pumps.
- **Reverb:** `<kanal>/send/2` (dB, −200 = off) feeds it, `fx/2/rueckweg` returns it. Start with −12 to −6. The send is
  per channel: on `erz/1` the kick gets reverb too.
- **Glue** on the master is the human's knob. Suggest a value, do not set it.

Announce every change and ramp it (`regler … takte: 4`); never all three at once.

## Tempo

The core clock is the master tempo. You may set it with `tempo` (60 to 200 BPM, a 4-beat ramp from the next bar); Stop
Cypher blocks it (`ki_gestoppt`). Pattern channels, loop boxes, recordings and decks follow. Decks keep their pitch at any
tempo and during the ramp (keylock in real time, the KEY button); after each deck event a bridge of about 0.1 s plays in
varispeed. What does not follow: `loop_klang` sounds (stored rate) and running `klang fahre` / `spur` rides (their
duration is computed in seconds at the start).

## Locks (held by the server, do not work around them)

AUTO off → `auto_aus` · Stop Cypher → `ki_gestoppt` · crossfader, master, headphone cue, AUTO switch, FX routing, grid
→ human only (`nur_hand`, or 403 `nur_andreas` for page actions) · opening a closed deck without a hearing check →
`kein_hoerschein` (call `hoeren`; at a verdict of `zu_laut`/`zu_leise`, correct `deck/<n>/trim` by the measured
`pegel_diff_db` and listen again).
Loop-box fader and trim (`pad/*`) are free for your own recordings; a foreign loop stays `kein_hoerschein`. Foreign
material: `box laden`/`start` on an OPEN box → `ziel_ungehoert`; while your own fader/trim ramp on the box runs →
`box_offen_oder_faehrt`; `loop_nach_box` on an open box or during such a ramp → `box_offen_oder_faehrt`.
- **HTTP 200 means nothing:** read `quittung.status` (6 = rejected) and `grund`.
- A new ramp that overlaps your own open ramp on the same path is queued behind it (`verschoben_auf` in the reply); a
  rejection exactly at the start beat then shows only in `lage` (`quittungen`).
- `ab: takt` starts at the NEXT downbeat: a 4-bar ride from bar 41 ends on bar 49.

## Restarting

A restart interrupts their sound: only with their yes, at a moment they choose. A different tempo needs no restart.
Save instrument sounds first (`klang speichere`), note the faders (`lage.regler`), and tell them afterwards what they need
to switch back on. Restarting only the page server costs no sound.

## Without the MCP server

Only if `djk-hand` is missing. The page server takes the same requests over HTTP; always send `x-djk-quelle: cypher`
and `content-type: application/json`, and read the replies (`status` 1 or 2 = ok, 6 = rejected). `<PORT>` is the page
port from `djk-start --zustand`.

| What | Route and body |
|---|---|
| State, mixer, patterns | `GET /lage` |
| Pattern | `POST /strudel {"strom":1,"text":"…"}` |
| Mixer value with a ramp | `POST /regler {"pfad":"erz/1/fader","nach":-7,"takte":4}` |
| Tempo | `POST /tempo {"bpm":110}` |
| Beat FX | `POST /fx/zuweisung {"einheit":2,"kanal":"erz/1","an":true}`, then `POST /fx {"einheit":2,"art":1,"beats":0.5,"wet":0.3,"an":true}` |
| Levels | `GET /pegel?sek=2` (`median_db` is `null` on a silent channel) |
