# Journey 1: DJ, from two files to a recorded mix

This chapter walks through a first DJ session with two tracks you have never loaded before. The same steps are run
by a checking tour (`python3 djk/tools/tour_cli.py j1 --instanz c --kurz`), so the chapter and the software are held
against each other: when a label here and on the page differ, the tour is wrong or this text is. The tour does not
only read the page's state back. It records the mix and measures the recording, and the chapter says below what each
measurement shows.

## What you need

Two audio files in one folder, and a studio instance started. If the folder is not in your library yet, add it once with
`djk/start/djk-bibliothek dazu <folder>`. The tour makes its own two tracks (about 90 seconds each in the short run, 124 and
128 BPM, in different keys, the second one starting with a third of a second of silence) so it does not depend on your music.

## 1. Find the tracks

Open the DJ view. The library is the panel at the bottom of the page (the BROWSER button in the top bar shows or hides it):
open LIBRARY, then BROWSE, then the ALL TRACKS tab. It lists every audio file of the added folders. A track that
was never analysed shows PREPARE in the Status column. Click it: the status turns to PREPARING... and then READY. Preparation finds the
tempo, the beat grid and the key. The tour checks the tempo and the key it finds against the ones the tracks were
rendered with.

## 2. Load, record, play

If the DJ view says "The live set is not open", press OPEN LIVE SET: the decks then take tracks (their LOAD buttons stay
grey until then). A READY row offers LOAD A and LOAD B. Load one track into each deck. Turn KEY on (the button reads KEY ? while its
state is unknown) so that a tempo change does not change the pitch, and type the master tempo into the BPM field
(Enter applies it from the next bar). Press REC MIX: the master mix is now written to a WAV file. Then press PLAY on
deck A and open its channel fader.

## 3. Bring in the second deck

After a few bars press SYNC on deck B. The deck starts on the next bar line, from its first downbeat, at the master tempo.
Its channel fader is low and its EQ low knob is down, so only the top of the track is heard.

The tour measures this in the recording: the kicks of deck B must land on the beat grid of deck A, within 10 ms, both while the
two play together and after deck A has left. A deck B that starts half a beat off, or a few tens of milliseconds, turns the
step red.

## 4. Swap the basses

Over 16 bars bring deck B up and deck A down with the channel faders. Halfway, turn the EQ low knob of deck B up and that of
deck A down. The tour checks this in the recording too: the low band of deck A must fall and the low band of deck B must rise,
each by at least 12 dB beyond what the faders did in the same time.

## 5. Take deck A out, play with FX

Close deck A and stop it. Deck B plays on alone: first clean, which shows whether KEY held its pitch (the tour measures the pitch of
a marker tone in the track and allows 20 cents), then FX1 on with ON for a few bars and off again (the tour looks for the echo
repeats between the kicks). Press REC MIX again to stop the recording.

## What the tour checks about the file

The recorded file has the right length, two channels, no clipping, no DC offset, and no silent gap longer than one second
inside the mix.

Some steps need the hearing check or are only for the person at the desk: opening a channel fader, starting an open deck, and
PLAY itself. The tour makes these few calls as the owner and lists them in the notes of `bericht.json` and `bericht.md`.

## Run it yourself

    python3 djk/tools/tour_cli.py j1 --instanz c --kurz

Without `--kurz` the tracks are about three minutes long. The report lands as `bericht.md` and `bericht.json` in the
tour's output folder, the recording under `mitschnitt/`.
