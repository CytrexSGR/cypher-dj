# How it was built

It started on 19 September 2026 as a Strudel set in a browser, run by Cypher, played with Andreas.
The same evening there were loops cut from finished tracks, and the first correction by ear: the
loops sat 8 ms late, and only after nudging them did Andreas confirm it was better. Two days later a
single loop took four rounds: Cypher cut it, Andreas listened and said where it was off, Cypher cut
again. The circle had to get shorter: that is why the beat grid can be shifted by hand, and his
correction always wins over any measurement.

**A DJ's craft, written down.** On the evening of 22 September Andreas described how he mixes. It became
26 requirements, four more followed on 26 September. The next day 23 architecture decisions were
written against them. Some of what he said, and what came of it:

| Andreas | In the software |
|---|---|
| "the conductor must never play in anything unheard" | the agent may not open a deck the core has not measured |
| first turn the dominant element down with the EQ, usually the bass, then swap the elements | 3-band EQ with kill; planned agent moves that would open a second sub-bass channel are cancelled |
| "I had Mixed In Key. Having the keys automatically was a quantum leap" | a key analysis of its own, without Mixed In Key (76.7 % agreement, see below) |
| "keeping the pitch is a given for me" | every track is time-stretched once to the set tempo with Rubber Band, pitch kept, so a 124.8 BPM track plays at 128 in its own key. The loop boxes do the same when the master tempo changes |

**Seeing where a track changes.** Describing how he prepares, Andreas said he mostly sets cues live,
by looking at the waveform for where the changes are: "where the vocals or breaks start. You can see
quite well where more comes in". The cue
tool shows the whole track as a 3-band waveform for exactly that. A second request followed on the
same day: "the browser should only display", so the previewer became a native audio program.

**The turn.** The plan's north star had Cypher playing one long musical journey, with Andreas stepping
in by voice. On 26 September he corrected it: "I want to play with you from the start, not alone, the
way we did with Strudel." Since then the agent interface is built for two at the same desk.

## The method

cypher-dj was written by an AI agent with Claude Code, in sessions with Andreas. The working method grew out of the
open [superpowers](https://github.com/obra/superpowers) skills for Claude Code (brainstorm a spec, write a plan, one
fresh agent per task, review, finish), adapted along the way:

- **A plan per feature, cut vertically.** Every slice goes through core, contract, page server, page and the agent's
  tools, and ends with a measurement at the target, not only with green tests.
- **One implementing agent per task, a reviewer per task.** The reviewer reads the code and the spec, not the
  implementer's report. Findings go back to the same implementer.
- **Done means the failure was shown.** A fix counts when its failure case is shown before and after on the same input,
  plus a negative control with harmless input. Green tests show the mechanism; the measurement on the running
  instance shows that it arrived.
- **Measure before claiming.** Every number in this README and in the docs has a date and a measurement behind it.
  Where a gate was too strict for the real thing, it stays written down as a limit instead of being loosened quietly
  (for stems, for example: the drum hits scatter more than the gate allowed).
- **The ear has the last word.** Measurable things are measured by the agent; whether it sounds right is decided by
  Andreas, in one listening session at the end of a build.
- **Test instances.** The live studio runs as instance a; builds and load tests run on separate instances with their own
  ports, so a test never plays into a set.
