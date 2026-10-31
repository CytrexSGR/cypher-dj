---
name: track-analysis
description: Use when a finished recording should become playable parts in cypher-dj: loops for a set, an acapella, drums without vocals, cue points for a deck, or a beat grid you can trust. Also when a cut loop does not close cleanly, drifts against another track, stays silent in the player or suddenly sounds an octave too high, and when you need to know whether a grid really sits on the beat. Not for generating new music.
---

# Measuring and cutting a track

Your ears are not at the computer. Every sentence about how something sounds is a measurement, or a guess dressed up as
a sentence.

That decides everything else. With images you see the result. Here you see a number, and the number can come from a
buffer that has not been updated for forty seconds. In one session that hid for forty minutes that no sound came out
at all; the human heard it at once. Without a working instrument the human becomes the instrument. That is allowed,
but then every attempt has to settle as much as possible instead of using them up as a sensor.

## The chain

Six steps. Each one ends with a measurement.

| # | Step | done when |
|---|---|---|
| 1 | **Separate stems** (Demucs, CPU) | four files exist, each exactly as long as the original |
| 2 | **Find the beats** | the residual against the fitted line is known, not guessed |
| 3 | **Measure the structure** | energy per bar and stem, block boundaries visible |
| 4 | **Cut loops** | each one sample-exact at its target length |
| 5 | **Wire them in** | the target file is provably fetched by the player |
| 6 | **Listen** | level measured against a real zero point, or the human |

In cypher-dj: `djk/werkstatt/werkstatt/stems.py` separates a range on the CPU (or Separate Stems in the PRODUCTION
view), `kick_messer.py` finds where the kick of each expected beat starts, `phase.py` measures the grid's phase against
the hits.

## Is the grid constant? Measure, then decide

There are two regimes, and the wrong assumption costs the whole job.

- **A mixed or live recording breathes.** On one measured track the residual against a straight line was 10 ms on
  average and 129 ms at most; over eight minutes a fixed grid drifted almost four beats. The human saw it in the
  waveform before any number showed it. Here: track every beat with soft phase and period correction, and cut at the
  beats actually tracked. The global BPM is then a result, not an input.
- **A track produced on a grid does not.** On such a track beat tracking was worse than the fixed grid: a quarter of
  the beats had no kick to lock to, residual 44.5 ms. Here: fit one fixed grid and check its phase.

Three cross-checks that only hold together: a line fitted over all beats · the median of the beat intervals · first
half against second half. If they disagree, the tracking broke, not the track.

## Phase needs a zero point

Counting onsets against the nearest eighth note does not measure a grid. On a track that was provably clean it gave a
median of 57 ms, almost exactly what uniformly random hits give (a quarter of the interval, 61 ms): it measured its own
false hits. What works: the phase of the kick envelope, checked against a synthetic click comb as the zero point. A
method that cannot tell a perfect click comb from random hits measures nothing.

A low band with every hit in it is not a kick detector either: on real tracks it found two events per beat about 25 ms
apart (kick and bass). Ask "where does the kick of this beat start", one event per expected beat.

## Two kinds of loop, and you need both

- **Cut at the real beats**: sounds right when dropped back into the original.
- **Stretched to a fixed grid**: does not drift against another track on the other deck. This is the kind for a deck
  that works with fixed loop lengths.

On a cleanly tracked track the stretch is tiny (measured below 0.5 %, mostly below 0.02 %) and inaudible. Whoever
delivers only one kind delivers the wrong one for half the uses.

## What went wrong when measured

Five traps, each paid for once.

**`atempo` does not hit the length.** It rounds per block; of 16 files, 7 were more than 5 ms off, up to 14 ms. Over ten
loop passes that is 140 ms, audible. Fix: stretch 0.5 % too long on purpose, then trim hard to the sample count
(`atrim=end_sample=N`). The error is then zero, not small.

**The column order of a CSV tool is not the order you asked for.** `ffprobe -show_entries
stream=duration_ts,sample_rate -of csv=p=0` answers `48000,749695`: rate first, then the sample count. Whoever takes
`[0]` reads the rate and gets the same value for every file. Fix: ask for one field at a time, or use `-of json`. And in
general: when a check gives the same result for every item, the checker is broken, not the items.

**Long samples do not play.** In Strudel, 16- and 20-bar loops (5.7 MB) were loaded and never played: master at
-180 dB, while short ones sat at -29 dB. Below 3 MB everything ran. 4 and 8 bars are the lengths you mix with anyway.

**Without a set tempo the bass becomes an organ.** If the environment runs at its default tempo, `loopAt(n)` squeezes the
sample: a sub-bass lands two octaves higher and sounds like a deep-house organ. The human heard it faster than any
measurement. Set `cps = BPM/60/4` (one cycle is one bar) and check: `n/cps` must hit the loop length.

**After a switch the level tap measures wrong, in both directions.** Right after switching, the master tap once
reported -180 dB while a simultaneous recording of the system output heard -24.1 dB; in another run it read 36 dB too
low. Settled, both agree within 0.3 dB (10 runs). The tap is not broken, it is **empty during the transition**. That
produces silent results that are not. The wait that helps is not a constant: it depends on the tail of the previous
sample and scales with its length (measured 8 s for short loops, 18 s for long ones).

- Measure the wait once for the loop length in use, instead of guessing it per run.
- Before "silent" becomes a finding: a **second, independent instrument**. A recording of the system output (`parec` on
  the monitor of the default sink, with a moment of lead-in) depends on nothing the engine does.

## Listening means measuring, and measuring needs a zero point

A loop only counts as playable once it has been measured against **forced silence**. Silence must give a different
value from signal, or the instrument measures nothing. With an intact path the gap is huge: -180 dB against -23 dB,
nothing in between. If zero point and signal carry the same value, the series is frozen.

A second proof that costs nothing: the access log of the sample server. Does the player fetch the file at all? A
`GET … 200` is harder evidence than any level, because it has no inertia.

**A silent loop is not a finding until it was silent a second time.** In one check, 5 of 48 stayed silent on the first
try and all played on the second. Two causes were possible and were not cleanly separated: the engine loads a sample
only on its first trigger, and the tap is empty after a switch. In practice: second try, and on a contradiction the
independent instrument.

## When nothing comes

Before guessing at the cause, make the other side's state visible. An endpoint that returns what is really loaded in
the player costs three lines and ends every speculation. Measured: forty minutes of guessing against ten seconds of
looking. In that case the editor held the raw JSON envelope instead of the code, because the endpoint expected plain
text.

And: an error message that appears at the same place on **every** call is never cosmetic, however plausible the
numbers next to it look.

## Not for this

- Generating music instead of taking it apart
- A single sound or a drum kit without a recording as its source
- A single question without output ("what key is this?"): a script is enough, no procedure needed
