# Journey 3: make a song in PRODUCTION

From an empty project to a WAV file: a MIDI part, an instrument sound, an audio track, a tempo change on one clip,
a volume and a send, a saved version and the export. Plan about 15 minutes. You need no outside files: the chapter makes its own
small MIDI file.

## Before you start

Open the PRODUCTION view (next to DJ and STUDIO). The transport bar on top says `No project`. Keep the volume of your
speakers low the first time. The chapter's sound is a deep bass and the export is quiet (see section 8).

## 1. Create the project

Click `NEW`, type a name into the field `Project name, Enter` and press Enter. The name appears on the left of the
transport bar instead of `No project`. `OPEN…` lists the projects you made before.

## 2. Bring in a MIDI part

Click `IMPORT MIDI` and choose a Standard MIDI file (format 0 or 1, up to 8 MiB). The page shows a short preview: the parts
of the file, their notes and the tempo, with a tick box per part. Click `IMPORT`. One instrument track with one MIDI clip appears, and
the project takes the tempo of the file. One Undo takes the whole import back.

The file used by the tour is eight bars at 120 BPM with four long notes (C1, E1, G1, C2), one every two bars.

## 3. Choose a sound

Open the `PRESETS` panel and drag a bass preset, for example Classic Acid, onto the track. The track now plays that
sound; the change is one undo step. A preset made for another instrument is refused with a message instead of being forced
on the track.

A Surge track (a Surge XT instrument in a host) needs the production host. It is available only when Cypher DJ was started
with the production host `arr1` and Surge XT is installed; without the host, freeze and export refuse a Surge track with `wirt_fehlt`.

## 4. Get audio onto an audio track

Right click the MIDI clip and choose `Bounce to New Track`. The menu line ends with the range, for example
`Bounce to New Track (beats 0–32)`. The track is rendered offline in a moment into a new audio
track below it, and the source track is muted so you hear it once. Its clip is a real audio clip: it has a waveform, it can be
warped and it is exported like any other.

Recording a real input (the `● REC` key with an armed audio track) works the same way afterwards, but needs an audio input that
you have released for Cypher in the device settings.

## 5. Give the clip another tempo

Select the audio clip. The sample editor below shows its waveform and its markers. A clip with warp on follows the project
tempo; drag the second marker to a later or earlier beat and the clip is played at the tempo between the markers. The marker
list shows the tempo of each segment. The tour sets 105 BPM for a clip that was made at 120.

## 6. Mix: one volume, one send

Move the `Volume` fader of the audio track down by about 3 dB (double click returns it to 0 dB). Click `+ LOAD EFFECT` in
the EFFECTS row and pick a delay: it becomes return `R1`. Open `ROUTING MATRIX`: the column `R1 Delay` has a cell for each
track. Set the cell of the audio track to about -6 dB. Press `▶ PLAY`: the meter of the
track moves, and what you hear is the clip with its echo. `■ STOP` ends it.

## 7. Save a version

Open the `PROJECTS` section of the browser on the left. Under `VERSIONS` type a name into `Name of this version` and click
`SAVE VERSION`. The line appears in the list; `RESTORE` goes back to it and keeps the present state as a version first.
Named versions are never removed.

## 8. Export

Click `EXPORT`. With `LOOP` on, only the loop bracket is exported, otherwise the whole song. The export is a WAV file (48 kHz,
32 bit float) in the export folder of the project, never overwriting an older one, and the page says `Export finished`. For a
test export of the chapter's song, set the loop bracket to bars 1 to 8 first (`LOOP`, `BAR 1 TO 8`).

The first export is quiet: its loudest point is about -28 dB, and the sound does not clip. This is not a fault. The sound
`Classic Acid` sets the RB-338 `VOLUME` knob to -12 dB, and the notes of this chapter are deep sub-bass, which peaks low. To
get a louder file, turn the `VOLUME` knob of the RB-338 up (at its maximum the peak is about -17 dB), or raise the track fader
and the master.

Two warnings can appear. If the export is louder than the limiter ceiling of the set, it says so: lower the master or the track
fader. If the render has a gap (the machine was too busy), the export is refused with `export_luecke`; export again with other
programs closed.

## What the tour does, and what it leaves out

The tour `djk/tools/tour_cli.py j3 --instanz <letter>` does what this chapter describes, but through the hand tools of the studio (the tools Cypher uses) instead of
clicks on the page, and measures the result. It checks that the export is at least eight bars long, has sound all the way
(not silent, not only a few seconds of it), does not clip, is free of NaN and without DC offset, and that its peak is not more
than 6 dB below the level heard while the song plays. It also exports the same eight bars before and after the tempo change
and requires that the end of the sound moves, so a tempo change that only exists in the project data does not pass.

Two steps are shortened on purpose:

- **Audio bounce instead of an input recording.** The tour makes its audio track by bouncing the MIDI track (section 4). Recording
  from a real input is reported as SKIP, because it needs an audio input released by the owner.
- **MIDI file instead of live MIDI.** The tour writes a MIDI file and imports it (section 2). Playing in notes from a keyboard
  is reported as SKIP, because it needs a MIDI keyboard.

The Surge step is SKIP (and the tour ends with exit code 77) on a machine without the production host or without Surge XT.
