# Production, warp and stems

The PRODUCTION view sits next to DJ and STUDIO. It is an arrangement: tracks on a timeline, a library browser on the
left, a detail area for the selected clip below, a transport bar on top. The same real-time core that plays the DJ set
plays the arrangement, on the same sample clock.

![PRODUCTION view: one of our own songs split into four stems under the muted original, the warp editor below in COMPLEX mode](screens/production-warp-stems.png)

## Tracks, groups, master

Up to 32 tracks and 8 group tracks. Every track goes to the production master or into one group. Audio tracks take
samples and tracks dragged from the library; instrument tracks play the RB-338 or one hosted Surge XT. Per track:
volume, pan, mute, solo, a meter. Every change is one undo step, and the undo history survives a restart.

## Warp

An audio clip with warp on follows the project tempo, also through tempo changes.

- **Where the markers come from**: in this order, the workshop's analysis of the track (beat grid snapped to the kick),
  a Traktor grid, the bar count of a loop, the library BPM. A long track without an analysis is warped from the best
  source at once and refined when the analysis arrives, as long as the clip is not playing.
- **By hand**: the sample editor shows the clip's waveform with its markers and, in grey, the detected transients.
  Double click adds or deletes a marker, dragging moves it (with Shift its beat). Further: double or halve the tempo,
  Set 1.1.1 Here (bar one at this spot), Warp From Here (straight from here, or start here), Set Project Tempo from the
  clip.
- **Modes**:
  - RE-PITCH: varispeed, pitch follows the tempo
  - COMPLEX: time-stretched with Bungee (grain 512), pitch kept
  - TONES: the same with a shorter grain (256)
  - BEATS: the clip is cut into slices at the grid (1/4 to 1/32) or at the transients, each slice starts on its beat;
    the gap after a slice can stay silent or be filled forwards or forwards and back, with a fade
- **Transpose and detune**: -12 to +24 semitones and ±50 cents (not in RE-PITCH).
- **Quantize Audio**: moves the transients onto a 1/16 grid, as one undo step.

## Stems

Right click an audio clip, Separate Stems. Demucs (htdemucs) splits the clip's source range into drums, bass, other and
vocals. It runs on the CPU at the lowest priority; the menu shows the progress (Cancel Stems, 26 %) and a cancelled run
leaves the project untouched. When it is done, four audio tracks appear under the clip in a new group, each stem warped
exactly like the original, and the original is muted. One undo step takes all of it back. Up to 600 s of source.

What was measured on 31 October 2026 on a real track, at 124 and 128 BPM: the warp markers of the stems sit 0.000
samples from the original's, the frame count is exact, one undo restores the project exactly.

Limits:
- While Demucs runs, the core's audio callback tail doubles (p99.9 from about 0.9 to 1.8 ms at quantum 256). Pinning
  core and Demucs to separate CPU cores brings it to about 1.4 ms. Do not separate stems while a set is playing.
- The drum hits of the drums stem scatter by up to 2 ms (p90) around the original's; the median offset is 0.
- Summed after warping, the four stems leave a residual of about -8 dB against the warped original (the warp starts each
  clip with its own phase). The stems are coherent with each other; together with the unmuted original they can comb.

## Arrangement, piano roll, export

![PRODUCTION view: three tracks (audio kick, RB-338 bass, frozen Surge XT lead), 8-bar loop, piano roll of the bass line](screens/production-view.png)

Notes are drawn in a piano roll with velocity and 1/16 quantize. Tracks can share a variant group (bass A, B, C) where
one click makes one of them audible. Recording takes one of the studio's own channels onto an armed audio track,
bit-identical. The WAV export is an offline render by the same core; hosted instruments are frozen first, so the file is
sample-identical to what was heard (residual -200 dBFS, measured 17 October 2026). An offline render measures LUFS, LRA
and true peak per track as it sits in the mix.

The agent has the same projects through its tools: create tracks, write clips and notes, warp, separate stems, mix,
start the transport, export.
