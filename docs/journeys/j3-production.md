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

Click `EXPORT`: it opens the export dialog. With `LOOP` on, only the loop bracket is exported, otherwise the whole song. Leave the
format on `Master only` and click `EXPORT` in the dialog. The export is a WAV file (48 kHz, 32 bit float) in the export folder of
the project, never overwriting an older one, and the page says `Export finished`. For a
test export of the chapter's song, set the loop bracket to bars 1 to 8 first (`LOOP`, `BAR 1 TO 8`).

The first export is quiet: its loudest point is about -28 dB, and the sound does not clip. This is not a fault. The sound
`Classic Acid` sets the RB-338 `VOLUME` knob to -12 dB, and the notes of this chapter are deep sub-bass, which peaks low. To
get a louder file, turn the `VOLUME` knob of the RB-338 up (at its maximum the peak is about -17 dB), or raise the track fader
and the master.

Two warnings can appear. If the export is louder than the limiter ceiling of the set, it says so: lower the master or the track
fader. If the render has a gap (the machine was too busy), the export is refused with `export_luecke`; export again with other
programs closed.

## 9. Draw a volume lane

Open the automation lanes of the track (`Show automation lanes of this track`) and draw a line over four bars: the volume
starts at -24 dB and ends at 0 dB. `Add a lane for another target to this track` makes a lane for another knob, for example a
filter. Press `▶ PLAY`: the meter of the track climbs with the line, and the export follows it exactly: the level of the file
rises by 3 dB every second at 120 BPM.

## 10. Effects on a track

Each track has a chain of inserts: Cypher EQ, Komp (compressor), Saett (saturator), a limiter and a few more. The sound goes
through them in the order of the chain, before the track fader and the pan. What each one does to the exported file:

- **EQ.** A cut of 18 dB at 180 Hz (bell, Q 1) takes about 12 dB out of the band 120 to 250 Hz and leaves everything above 2 kHz where it was.
- **Komp.** With the threshold 10 dB under the peak of the dry track, a ratio of 10 and an attack of 1 ms the loudest point of the file falls by about 7 dB. Take an attack of 1 ms or more: the lowest value the field takes (0.1 ms) makes the export refuse the track.
- **Saett.** The saturator adds harmonics. A deep, almost pure bass tone with drive 36 dB has most of its energy above 300 Hz afterwards, where the clean tone had almost none.
- **Limiter.** The loudest point of the file stays under the ceiling. The master pan law takes another 3 dB off a centred track, so a ceiling of -21.5 dB gives a file peak of -24.5 dB.
- **Hall.** The reverb is a return (section 6): make a return without a loaded effect, set the send of the track to 0 dB and export with a tail (`ausklang_beats`). One short note rings on for more than eight seconds instead of a fifth of a second.

## 11. Plugin delay compensation

Some inserts delay the sound by a few samples (the EQ and Saett by 69, the limiter by 86). The engine delays every other track by the
same amount, so a track with such an insert still lines up with one without. Pan two copies of one part hard left and hard right,
put an EQ or a limiter on one of them and export: the two channels are not shifted against each other (0 samples; without the
compensation you would see 69 or 86).

## 12. Export the notes as MIDI

`EXPORT MIDI` in the workbench writes the notes of the project as Standard MIDI files, nothing is rendered: one file with all
parts and one file per part. A muted track is not part of it. The notes in the file are the notes of the clip: the same
pitches, velocities, starts and lengths, and the tempo of the project.

## 13. Collect, move and bring back a project

- **Collect.** `COLLECT ALL` in the `PROJECT` section copies every audio file from outside into the folder of the project. The report says how many files it copied, how many were there already and which it could not find.
- **A file goes missing.** A file that was moved away shows under `MISSING` with the button `FIND`. `FIND` looks for the file in the library by its content, so it works only when a library catalogue exists; without one it says so (`katalog_fehlt`). `PICK FILE` takes a file you choose: the project copies it into its audio folder when it is the same file, byte for byte, and refuses it otherwise.
- **Take it along.** `EXPORT PROJECT` saves the project with its audio as one zip file. `IMPORT PROJECT` makes a new project of such a file: it has the same tracks and clips, its audio is in place, and it does not replace the project you had open.

## 14. Undo and redo

`Undo (Ctrl+Z)` takes the last edit back, `Redo (Ctrl+Shift+Z)` puts it back. One undo undoes one edit: two fader moves that are more than
a second apart are two steps. Moves of the same fader within a second count as one drag and are one step together.

## 15. Two takes and a comp

Arm an audio track and record the same bars twice: every pass is one take, and each take is its own lane under the track. Drag a range on
`Take 1` to comp it into the track: that range of the take plays instead of what the track held there. Click the name of a take to audition
it; the audition is not part of the project and ends when you click again. Undo takes the comp back, redo puts it back.

The tour step `j3.take` records two passes of two bars, comps bar 1 from the first take, auditions it, exports before and after the comp and
undoes it. In the export the low band over the high band must differ by at least 12 dB between bar 1 (kick) and bar 2 (hats), and undo must give
back the clips of the track as they were. The step needs a sound a production project can record: Strudel and the loop decks sit in the live
container and are silent while a project is open, and the library of the tour instance is empty, so the step is skipped (`abhaengigkeit`) until
such a source exists.

## 16. A rack with two devices and a macro

A rack on an instrument track holds several devices, each with a key zone. Add a rack with two RB-338 members, one for the notes up to 59 and one
from 60, and give macro 1 a target: the cutoff of the low member. Turning the macro from 0 to 1 opens the filter of that member while the other one
stays as it is. `Save variation` keeps the macro values under a name, `Load variation` brings them back, and one undo takes the load back.

The tour step `j3.rack` plays four beats of low notes and four beats of high notes through such a rack and exports twice, with the macro at 0 and
at 1. Both halves must sound, the share of the energy above 1 kHz in the low half must rise by at least 6 dB, and in the high half it may change by
at most 1.5 dB. It also saves, changes and loads the variation and checks that one undo takes the load back.

## 17. A foreign plugin with a lane

A third-party plugin runs on a track as a host stage: it lives in its own process (Carla), so a crashing plugin does not take the studio with it. Add
the LSP stereo limiter (LV2) to a track from the plugin browser and wait until the stage reads `bereit`. Draw a lane on its threshold: the lane
holds the limiter down in steps of 20 ms for as long as it runs. Delete the lane and the threshold is free again.

The tour step `j3.plugin` builds a project of its own, exports it dry (A), adds the stage and waits at most 60 s for the host, draws a flat lane that puts
the threshold 24 dB under the dry peak and exports again (B), deletes the lane and exports a third time (C). The peak of B must be at least 6 dB under A,
and C must be at least 3 dB louder than B, so the lane did it and not a stuck value. A project with a plugin stage exports in real time, so the step
takes as long as the song lasts, three times. Without Carla or without the LSP plugins the step is skipped (`abhaengigkeit`); it stays skipped until the instance has a plugin scan with the LSP plugins.

## 18. Merge

Select two tracks and choose `Merge`: both are bounced over the range into one new audio track, and the two sources are muted. The export sounds the
same as before. Undo takes the new track away again. Tracks with insert stages are refused.

The tour step `j3.zusammen` merges two RB-338 tracks (panned left and right, two different notes) over eight beats and exports before and after. RMS
and the peak of each channel of the two exports must be within 0.5 dB, and they may lie at most one sample apart. One undo must remove the new track.

## 19. Resample

`Resample` bounces a strip as it sounds after its inserts into a new audio track, so the new track carries what you heard, effects included.

The tour step `j3.resample` puts a utility insert (+6 dB) on an RB-338 track, exports it, resamples the strip, mutes the source and exports again.
Level and peaks of the new track must be within 0.5 dB of the strip, and it must start at the same sample (at most one sample apart).

## What the tour does, and what it leaves out

The tour `djk/tools/tour_cli.py j3 --instanz <letter>` does what this chapter describes, but through the hand tools of the studio (the tools Cypher uses) instead of
clicks on the page, and measures the result. It checks that the export is at least eight bars long, has sound all the way
(not silent, not only a few seconds of it), does not clip, is free of NaN and without DC offset, and that its peak is not more
than 6 dB below the level heard while the song plays. It also exports the same eight bars before and after the tempo change
and requires that the end of the sound moves, so a tempo change that only exists in the project data does not pass.

Beyond the sections up to 8 the tour also drives the sections 9 to 19 and measures each one, in the exported audio or in the state of the project
read back (the extension steps `j3.midi_export`, `j3.einsammeln`, `j3.relink`, `j3.undo`, `j3.zip` on the project of the chapter, and `j3.auto`, `j3.eq`,
`j3.komp`, `j3.hall`, `j3.saett`, `j3.limiter`, `j3.pdc`, `j3.take`, `j3.rack`, `j3.plugin`, `j3.zusammen`, `j3.resample`, each in a small project of its own with a source that is the same in every second):

- **Lane.** The level of the export climbs by the 3.00 dB per second of the lane (the tour accepts 0.75 dB more or less) and no second is more than 2 dB away from the straight line.
- **EQ.** The band 120 to 250 Hz falls by at least 6 dB and the energy above 2 kHz changes by at most 1 dB.
- **Komp.** The peak of the export falls by at least 2 dB. The tour also writes down the crest factor, but does not judge it: with this steady source the crest does not fall (the compressor lowers the peaks and the whole level together).
- **Hall.** The end of the sound moves later by at least 2 seconds.
- **Saett.** The share of the energy above 300 Hz rises by at least 6 dB. The source is a near-sine bass lifted by 24 dB with a utility insert, otherwise the saturator has nothing to bend.
- **Limiter.** The peak stays at most 0.1 dB over the ceiling and not more than 4.5 dB under it.
- **Delay compensation.** Left and right of an export with a latent insert lag at most one sample apart.
- **MIDI.** The notes read back from the file equal the four notes of the chapter's file (pitch, velocity, start, length) and the tempo is 120 BPM. The tour unmutes the track for the export and mutes it again.
- **Collect, relink, zip.** The collect report names no missing file. The tour moves the audio file of the project out of the folder and requires `MISSING`, asks `FIND` (a missing library catalogue is an accepted answer), relinks the file and requires a copy with the same content in the audio folder. The zip is exported, imported as a new project and opened: same tracks, same clips, no missing file.
- **Undo.** After two edits one undo reads back the value of the first edit, redo reads back the value of the second.

Two steps are shortened on purpose:

- **Audio bounce instead of an input recording.** The tour makes its audio track by bouncing the MIDI track (section 4). Recording
  from a real input is reported as SKIP, because it needs an audio input released by the owner.
- **MIDI file instead of live MIDI.** The tour writes a MIDI file and imports it (section 2). Playing in notes from a keyboard
  is reported as SKIP, because it needs a MIDI keyboard.

The Surge step is SKIP (and the tour ends with exit code 77) on a machine without the production host or without Surge XT.
