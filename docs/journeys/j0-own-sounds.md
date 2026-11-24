# Journey 0: bring your own sounds

You have a folder of samples on your disk and nothing else. By the end of this chapter one of those files is the kick of
a drum track and you hear it. Nothing is copied: the files stay where they are.

The tour `python3 djk/tools/tour_cli.py j0 --instanz <letter>` checks the same journey on a fresh test instance that has
graphs and kits but no catalogue and no library. It does not use the browser: it makes the calls the screens make
(add a folder, import, search, put a sound on a pad, play) and measures the result. The clicks in this chapter are
what you do yourself. If a step here refuses, the tour step named in brackets tells you which call failed and why.

## 1. Point the app at your folder

Press the **BROWSER** key. The LIBRARY section of a fresh install shows a card: **Where is your music?** with the text
"Add the folder your samples and tracks live in. The files stay where they are."

1. Click **ADD FOLDER**. A dialog titled **Choose a folder** opens at the list of roots (Home and every mounted disk).
2. Click folder names to go down, the path in the top row shows where you are, `..` goes up.
3. Click **CHOOSE**. (**CANCEL** or Escape closes the dialog without a change.)

The message line says "Folder added: the library builds now". [`j0.ordner`, `j0.quelle`]

If the dialog shows an error instead of folders, the folder is outside your home and the mounted disks: move it or
mount the disk. Only folders are listed, not files.

## 2. Wait for the catalogue

The library scans the folder, reads the audio features and writes the catalogue. A few files take seconds, a large
collection takes a while. When it is done the one-shots of the folder are listed under the tab **ONE-SHOTS** (the
other tabs are **TRACKS**, **LOOPS**, **MIDI** and **PATTERNS**). A kick named `Kick 01.wav` shows as `Kick 01` with
the class `kick`. Short files land under ONE-SHOTS, a 30 second loop under LOOPS. [`j0.katalog`]

If the list stays empty, click **RESCAN**. If it is still empty the folder holds no audio files the library can read, or
the disk is not mounted.

## 3. Add one more file

**IMPORT** (next to ADD FOLDER) takes audio and MIDI files from this computer, or drop them on the panel. Imported
files are copied into the instance's import folder and are in the catalogue after the next short build. [`j0.import`]

If the file does not turn up, check that it is a normal audio file; the import names every refused file with its
reason.

## 4. Find the kick

Type `kick` into **Search everything** and press Enter. The one-shot `Kick 01` is the first hit. In a module the shelf has the
same search under **SHELF** then **SAMPLES**, with the field "Search the sample catalog". Each row shows a **▶**
preview, a star, the name, the folder, the class and the length. [`j0.finden`]

If nothing comes back, the catalogue is not finished or empty: go back to step 2.

## 5. Put it on a pad

Open or create a module and add a drum track that plays a sample kit (**+ INSTRUMENT TRACK**, then a kit from the
**KITS** list). Its rows are the pads: `bd:0` is the kick, `sd:0` the snare, `hh:0` the closed hat.

Open **SHELF**, choose **SAMPLES**, search `kick`, and drag `Kick 01` onto the name of the row `bd:0`. The message line
says: "Kick 01.wav is now bd:0 on Drums (kit starter-2)". The kit is copied for this module, so the original kit stays
as it was. **TO TRACK** on a row does something else: it puts the sample on a new instrument track that plays it
across the keys. [`j0.benutzen`]

If you drop on a drum synth track the message says "plays a drum synth, not a sample kit": use a kit track, or
TO TRACK. If the message says the sample "is not reachable any more", its file or disk is gone.

## 6. Listen

Press **▶ PLAY** in the module header (it starts on the next bar) and **■ STOP** when you are done. You hear your
kick on every beat of the pattern, not the old pad sound. The master meter moves and stays below clipping.
[`j0.pad`, `j0.hoeren`]

The tour proves that it is your file and not the old pad. Its sample folder holds a kick with a short 3 kHz click that
no starter pad has. After the sound is placed, the tour reads back that the track plays the new kit and that the pad
file in it carries the click, and it measures while the track plays that the click is in the master spectrum and was not
before the swap. [`j0.vorher`]

If you hear nothing: look at the module's master and track faders, and check that the sound output is the one you
listen on. The tour measures this on the master meter: below -60 dBFS counts as silent, 0 dBFS or more as clipping.
