# Track analysis

The workshop (`djk/werkstatt`) reads a track once and prepares it for the set. It runs offline, at low priority, and
writes its results next to the track's version so the decks, the cue tool, the library and the PRODUCTION warp can use
them.

## What it measures

- **Loudness**: integrated LUFS, loudness range and true peak.
- **Tempo map and beat grid**: beats from `beat_this`, then `phase.py` measures the constant offset of the grid
  against the kick hits and snaps it. Tracks that cannot be measured cleanly keep the raw grid. A separate kick messer
  (`kick_messer.py`, one event per expected beat) checks warped exports against their source.
  On the two tracks checked against Ableton Live's warp markers, the median offset is about 1 ms; the spread from beat
  to beat is larger.
- **Bar one** (the downbeat): detected, but unreliable. Set it by hand where it is wrong (Set 1.1.1 Here in the warp
  editor, or the grid controls on a deck); a correction by hand always wins over a measurement.
- **Key and energy** for the whole library, with BPM filled in where it was missing. Key detection agreed with Mixed In
  Key on 76.7 % of 120 held-out tracks exactly and on 82.5 % within a neighbouring key (26 September 2026). It is weak on
  major keys: the test library is almost all minor.
- **Rendering**: every track is time-stretched once to the set tempo with Rubber Band, pitch kept.
- **Stems** on request, see [production.md](production.md#stems).

## How the measuring is checked

Each step ends with a measurement against a zero point that can fail. Two lessons that shaped the code:

- Counting onsets against the nearest eighth note does not measure a grid. On a provably clean track it gave almost
  exactly what random hits give: it measured its own false hits. The phase is measured on the kick envelope instead,
  against a synthetic click comb as the zero point.
- A low band with every hit in it is not a kick detector: on real tracks it found kick and bass as two events about
  25 ms apart. The kick messer therefore asks "where does the kick of this beat start".

The skill [`skills/track-analysis/`](../skills/track-analysis/SKILL.md) carries the full procedure for an agent:
separating, finding the beats, measuring the structure, cutting loops that close sample-exact, and the traps that were
paid for along the way.
