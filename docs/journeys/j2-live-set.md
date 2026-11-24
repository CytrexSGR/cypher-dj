# Journey 2: play a live set

You play for half an hour: loops from the loop deck, a Strudel pattern, a SEQ pattern, scenes that change every few
minutes, the four container faders under your hands. At the end you have the set as one audio file. The point of this
chapter is that nothing drops out: no gap in the sound, no clipping, no audio dropout (xrun) of the engine.

The tour `python3 djk/tools/tour_cli.py j2 --instanz <letter>` plays exactly this set on a test instance and measures
it. `--kurz` plays two minutes with a scene change every 20 seconds instead of thirty minutes with one every two
minutes. The tour step in brackets names the check that goes with each stage.

## 1. Open the live set

If the page shows "OPEN LIVE SET", click it. The live container is the project that holds your set; it stays between
sessions. The four containers A to D are the four places of the DJ view. [`j2.aufbau`]

## 2. Fill the containers

Each container has a header with the buttons **EMPTY**, **TRACK**, **STRUDEL**, **SEQ**, **LOOPS** and **STEMS**; the one you
choose decides what the container holds, and the mixer strip in the middle is named after it ("A loops", "C strudel").

- **Loops.** Choose **LOOPS** for container A and for container B. Each loop deck (panels **LOOP 1** and **LOOP 2**)
  has four tracks of eight cells; the numbers 1 to 8 on the left are the rows. Open **LIBRARY**, then its tab **LOOPS**,
  and drag a loop onto an empty cell ("Empty: click to select it as load target (or drop a loop here)"). A scene is one
  row: fill the same row on three tracks, then the next row with other loops.
- **Strudel.** Choose **STRUDEL** for container C. The streams are the tabs **DRUMS**, **BASS** and **MELODY**. Write a pattern
  into the text box of each, for example `s("bd*4, [~ hh]*4")`, and click **PLAY ⏎**.
- **SEQ.** Choose **SEQ** for container D and click **+ pattern**. Click steps in its lanes (for example a kick on every
  fourth step, a hat in between) and click **M** if the pattern is muted, so it plays. In the header row **SCENES**, click
  **SAVE**, then **1** to store this picture as SEQ scene 1. Mute the pattern, click **SAVE**, then **2** for scene 2.

All container faders are down at first (the strips show "-∞ dB"). That is intended: nothing is heard until you open them.

## 3. Measure first, then play

Before the set, let the engine idle for a moment and note the xruns it makes on its own. The tour does this for two
minutes (20 seconds with `--kurz`) and holds the set against that figure: a quiet machine has none, a busy machine may
have a few, and the set is allowed only the same rate. [`j2.basis`]

## 4. Play

1. Click **REC MIX** in the header. It turns into a red dot and a clock, "● REC 00:05".
2. Raise the four container faders to about -6 dB.
3. Start the sound: click a row number of a loop deck (it launches that row on the next bar, the grid is set by the
   buttons **1/4**, **1/2**, **1**, **BAR**, **4**), click **▶ PLAY** on the SEQ deck. There is no separate transport key
   in the DJ view.
4. Change the scene: click another row number of the loop deck, and a number in the **SCENES** row.
5. Every few seconds move one fader a few dB, a different one each time.

What you should hear: continuous sound with the loops changing on the beat. What should not happen: a gap longer than
two seconds in the master (unless you planned a break), any red clip indicator, any dropout. [`j2.set`, `j2.szenen`,
`j2.container`]

If a fader will not open: a channel that plays loops opens only by your own hand, never by Cypher. Move it yourself.
If a scene is refused, the message names the reason (for example "No loop deck on that place."): the place has no
deck yet, put one there with **LOOPS**.

## 5. Stop and keep the recording

Click the red **REC** key again (the header key reads "● REC 00:00" while it runs). For ten seconds it shows "Saved: <file name>"; hold the mouse over it to see the full
path. The file is a stereo WAV of the master from the first click to the second. [`j2.mitschnitt`]

The tour opens the file and checks: it decodes without errors, it is as long as the set, no sample reaches 0 dBFS,
there is no silent stretch of two seconds or more. [`j2.datei`]

If the key says the core is not running, start the studio first. If it says a recording is already running, stop that
one first. Both answers leave your sound untouched.

## 6. A controller on the set

An Akai APC20 can drive scenes and faders. The tour cannot check this: it needs the device in the room. The step is
reported as skipped, never as passed, and it belongs to the owner session J2. [`j2.apc20`]

## 7. The loop deck pop-up: strips, slices, warp, devices

Open the pop-up from a loop deck place; **×** or Esc closes it. It shows the same cells as the place, plus a strip for
each track (fader, mute), a column of scenes, and a bottom area with the tabs **CLIP** and **DEVICES**. The clip editor has
a **SLICES** tab ("SLICE BY" 1/8 cuts the cell into eight parts, a pad launches one of them, the play order is yours) and a
**WARP** tab (**KEYLOCK** ON stretches the cell to the master tempo and keeps its pitch, OFF follows the tempo as
re-pitch; the transpose moves the pitch on top). **DEVICES** puts an effect on the track.

The tour cannot click in a browser, so it drives the same routes the pop-up writes through and measures what you would
hear. For this it loads one synthetic cell of four beats whose eight slices are eight different steady tones, so that a
recording of the master shows which slice played when, and removes it again at the end.

- **Strips, clip gain, scene.** A strip fader at -12 dB lowers the deck channel by 12 dB (within 1.5 dB), the strip mute
  silences it, a clip gain of -6 dB lowers it by 6 dB, and a scene with its own tempo of 116 BPM brings the master clock to
  116. The tour also checks that the view switches to the pop-up and back and that the files with the tabs are served.
  [`j2.popup`]
- **Slices.** SLICE BY 1/8 returns the eight boundaries on the beat grid. In a recording of four pieces the cell is
  launched from the top (slices 1, 2, 3, 4 in order), at slice 3 (3, 4, 5, 6), at slice 6 (6, 7, 8, 1) and, after the play
  order was reversed, from the top again (8, 7, 6, 5). A slice lasts half a beat within 10 percent. [`j2.scheiben`]
- **Warp.** With the master at 112 BPM against a cell cut at 128 BPM the cell still lasts four beats of the master
  (within 2 percent) and its repeats drift off the bar grid by less than 30 ms. The pitch follows the mode: unchanged with
  KEYLOCK ON, 112/128 of it with KEYLOCK OFF, one octave up with transpose +12. [`j2.warp`]
- **Devices.** A steady tone is recorded while a saturator is added on DEVICES: its harmonics rise by at least 20 dB, and
  the tour removes the device again. [`j2.geraete`]

A step that fails names what it measured. The tour does not loosen a limit to pass: if the slice you launched is not the
slice you hear, that is a finding about the product.
