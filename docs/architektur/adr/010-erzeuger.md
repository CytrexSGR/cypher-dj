# ADR 010: Erzeuger (generators: Strudel patterns, Spielzettel (play sheets), SunVox, MIDI)

- **Status:** provisional, measurement M7 (sound host as `node.async`) is outstanding; slice 7
- **Date:** 2026-09-23
- **Requirements carried:** A21, A22, A14, A4, A1
- **Related to:** ADR 017, 009, 005

## Context

A21: instruments and generators (Erzeuger) are equal in rank, in the same bar as the decks, not flanged onto a DJ mixer.
A22: Strudel stays for turning patterns into events. 06 proposes SunVox as sound generator **inside** the core (sample-exact
only with block division); "robustness" and judges 1 and 2 want no foreign code in the core.

## Decision

1. **Generators deliver only events with a beat stamp.** The Strudel core runs as its own unit
   `cypherdj-erzeuger@strudel` (Node, `@strudel/core`/`mini` 1.2.6, only `queryArc`), wakes up per bar and sends
   a window `[n+1, n+3)` as "replace" directly to the core (`/erz/fenster`, `/erz/ev`). Past events are never touched;
   events that arrive too late are counted by the core as `zu_spaet` and not played.
2. **Pattern change** at the grid boundary: the generator sends a window `[q, Horizont)` with the new pattern at once;
   the default grid is the next bar.
3. **Play sheet (Spielzettel)** (tracker lines for time, jump and transition, mini notation for content) is the shared
   text of Andreas and Cypher; errors come with a line number. AI pattern text runs in a worker without file or network
   rights. Transitions in the play sheet (`uebergang A->B basstausch 16T`) go to the control room (Leitstand) and are
   expanded there like a choice (ADR 013).
4. **SunVox in its own sound host (Klang-Wirt)** `cypherdj-klang@sunvox` (C++ around `sunvox.so` 2.1.4d): events per
   JACK MIDI with sample offset from the core; the host splits its block at the event point; return path `node.async`
   with a pulse; the core stamps the events earlier by the return-path latency. SunVox's own sequencer is not used
   (tempo only in whole BPM).
5. **Every generator is a full channel in the core** (channel strip like a deck); its fader starts at −200 dB and only
   opens with a listening pass (A4 for generators, 09 NP K10). **A pattern change is new content too:** on an open
   channel the core plays events of a pattern only with a valid listening pass `muster/<m>` of this channel;
   otherwise it counts them as `ungehoert` (I3c, `SCHNITTSTELLEN.md` §4.8). A new pattern therefore sounds first on a
   closed generator channel and then comes in by plan, like a new track; `/erz/strom` names for this the core channel
   on which the sound returns.
6. **MIDI to devices** only as an output of the core (JACK MIDI with sample offset), never directly from Node.
7. No to Renoise.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Strudel's Cyclist as scheduler | 0.1 s latency; `setPattern` replaces at once without a grid; appending instead of replacing: change only after 4.4 s | 06 §3.1, test a, stream 2 |
| Seconds stamp | in the tempo ramp up to 12.8 ms off | 06 test a, stream 3 |
| SunVox in the core | foreign binary library in the real-time process; accuracy also holds outside via JACK MIDI with offset and block division | 06 test b (T2 60 of 60), 02 k_midi1 (0 frames), 05 §4.5 |
| SunVox as clock source | tempo only in whole BPM (`uint16_t bpm`) | 06 §3.1 |
| MIDI directly from Node | without stamp, median 12 ms, up to 29 ms off | 06 test a, stream 4 |
| Renoise as generator | needs X.org, tools not real-time, proprietary | 06 §3.1, research on trackers |

## Consequences

- Lead time of at least one bar (1.875 s at 128), covers Node hangs up to the horizon (measured 4.7 s), then silence
  instead of a flood.
- Send change bundles twice or wait for the receipt (loss of a change moves it by up to one bar; conjecture 06 risk 3).
- Strudel is AGPL: keep it unchanged as a separate process; do not pass on a fork.

## Evidence

06 test a (295 of 295 frame-exact, also in the ramp; every third packet lost: nothing missing; change on the bar after
0.61 s; Node 6 s sluggish: exact up to the horizon, then 2.8 beats of silence), test b (SunVox with division 60 of 60,
without up to 15.9 ms), test c (play sheet of 64 bars in 17.5 ms, errors with line number), risks 1 to 7. Dossier 06
not yet checked.

## Reverse if

M7 shows that a hanging sound host drags the core along despite `node.async`; then SunVox only after its own check, or not at all.
