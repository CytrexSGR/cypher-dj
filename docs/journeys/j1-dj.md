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

## 6. Cues, loops, jumps and scrub

Press a "Cue 1-8" pad on an empty slot to set a hotcue at the playing position; a pad can hold a shot cue or, with a loop length, a loop cue. Pressing a set pad jumps the deck to the cue and, on a loop cue, starts the loop. The tour sets all eight, plays the farthest shot cue and reads the deck position back: it must land where the cue was set, on the beat grid (within a quarter beat), and a loop cue must leave the deck looping. The jump buttons move the playing deck by whole beats: the tour jumps eight beats forward and back and checks that the position moves by that distance and no more.

The LOOP button with the length buttons (1 2 4 8 16 32 64 beats) holds the deck inside the loop, and the arrows move it. The tour starts a four-beat loop and samples the position over two bars: it must never leave the loop and must wrap at least once. It then steps through the other lengths. Dragging the waveform scrubs: the tour grabs the waveform, drags it two beats and lets go, and the deck must continue two beats further on in the same phase, so a scrub out and back leaves the beat grid where it was.

## 7. Listen on the headphones

The PFL button on a channel sends that channel to the headphones before its fader, so you can find the next track while its fader is closed. The tour presses PFL on a closed channel and checks that the cue meter rises well above its idle level while the master meter and the channel itself stay silent, and that the cue falls silent again when PFL is off. The MIX knob under the headphone section blends the master into the headphones: all the way to the PFL side the cue carries no master, all the way to the master side it carries the master about 12 dB lower, and the cue level knob lifts or lowers the whole cue. The tour measures each of these on the cue meter. Both PFL and these knobs are hand controls, so the tour sets them as the owner and lists them in its notes. Playing a track from the library to the headphones (the audition in the browser) uses the same cue output: the tour starts one and checks that it shows on the cue meter and not on the master. An instance without headphones connected cannot do this, and the tour then skips that step and says why.

## 8. Compressor and reverb

COMP on a channel compresses it before its fader. The tour opens deck A and puts it in a four-beat loop, so the same material goes round and the peak can be compared. It reads the channel peak with the compressor off, switches COMP on with a low threshold and a high ratio, and reads it again: the peak must drop by at least 6 dB, and come back when COMP is off. REVERB is one of the beat FX types and uses the shared hall: the tour assigns an FX unit to the master, stops the deck with the effect off and measures how long the tail rings, then repeats it with REVERB and requires a tail at least half a second longer.

## What the tour checks about the file

The recorded file has the right length, two channels, no clipping, no DC offset, and no silent gap longer than one second
inside the mix.

Some steps need the hearing check or are only for the person at the desk: opening a channel fader, starting an open deck, and
PLAY itself. The tour makes these few calls as the owner and lists them in the notes of `bericht.json` and `bericht.md`.

## Run it yourself

    python3 djk/tools/tour_cli.py j1 --instanz c --kurz

Without `--kurz` the tracks are about three minutes long. The report lands as `bericht.md` and `bericht.json` in the
tour's output folder, the recording under `mitschnitt/`.
