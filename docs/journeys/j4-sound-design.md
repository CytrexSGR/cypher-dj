# Journey 4: design a sound, keep it, use it again

This chapter follows one sound from a fresh project to a saved preset and back into a second project. Every label
in quotation marks is the text on the screen (knob names such as CUTOFF are shown in capitals). The same path runs
as an automated tour (`j4`, see the end of the chapter).

## 1. Open an instrument

1. Open the PRODUCTION view and start a project with NEW.
2. In the library on the left, open INSTRUMENTS AND EFFECTS and take the Cypher Modular graph `bass-banddrive`.
   Drop it on the arrangement. A track named `bass-banddrive` appears and its device panel shows the front panel
   of the graph: knobs such as CUTOFF and RESONANCE.
3. Draw a short clip with a few notes (four bars are enough for a first listen).

A Cypher Modular patch is a graph of building blocks, not a file of knob positions. The knobs on the panel are the
graph's `regler` nodes (see [Cypher Modular](../cypher-modular.md)).

## 2. Change it

Turn CUTOFF down and RESONANCE up. Every knob moves the sound at once and is stored in the track's device as part
of the project, so Undo takes it back. The tour turns two knobs the same way and expects the route to accept both.

The device panel also has OPEN ↗, which shows the full device here in the page, and WINDOW ↗, which opens it as a
separate browser window.

## 3. Hear the difference

Play the clip, or press EXPORT in the toolbar to render the loop bracket (or the whole song) as a WAV file. The
tour does the second: it exports the track once with the stock knobs and once with the changed knobs and measures
both files offline. A change counts as audible when the spectral centroid moves by at least 15 percent or the level
by at least 1.5 dB. A track that exports silent is a failure of its own.

## 4. Save it as a preset

1. In the PRESETS list, press SAVE AS PRESET. The form unfolds.
2. Set the Device selector at the top of PRESETS to "Cypher Modular". Until a device is picked, the name field
   reads "Pick a device to save its current settings" and SAVE CURRENT stays disabled.
3. If the project has several instrument tracks of that device, the "Save from" selector next to the name picks
   the track whose current settings are saved (for example "Track 1 bass-banddrive").
4. Type a name and fill in the description, which is required: Kind, Sub-kind, character (1 to 6 words), use
   (1 to 5 words), Energy and one sentence of text. Character and use take words from a fixed list (for example
   "dark", "deep" and "drop"); a word outside the list is refused with the allowed words in the message.
5. Press SAVE CURRENT. The message line says "Saved" followed by the name.

Set the Origin selector to "Mine": the preset is listed there, next to the factory ones. A preset belongs to its
device and is kept outside the project, so it is still there after the project is closed.

## 5. Use it again

Open a second project (or add a new instrument track) and drag the preset from the PRESETS list onto the track
row in the arrangement. The server works out what the preset does to that track and writes it in one step: the
graph and the knob values come back. Press EXPORT. The file sounds like the first project's changed sound, not like
the stock sound. The tour checks exactly that: the second export must differ from its own stock export and match
the saved sound.

## 6. Change the graph itself

Presets keep knob values. To change what the sound is made of, edit the graph: add or remove blocks and wires. The
blocks and their parameters are listed in [Cypher Modular](../cypher-modular.md). The tour does not exercise the
node-level editing gesture in the page yet; its step `j4.knoten` reports a SKIP and names the session that owns it.

## 7. Every kind of device sounds

The steps above use one graph. The studio registers devices in several families, and the tour plays one of each through a
project track, exports the track and measures the file:

| Family | Device | What is measured |
|---|---|---|
| drums | `drums-909` | three kick hits: each is loud enough, low (the centroid of its first 150 ms), starts at once and decays |
| mono synth | `synth-mono` | three notes, C3, G3 and C4: each bar carries sound, the pitch of the second and third note is 7 and 12 semitones above the first (within half a semitone), and every note ends |
| poly synth | `juno-pad` | the same three notes |
| neuro synth | `synth-greif2` | the same three notes |
| effect | `fx-crunch` | the same synth notes with the effect put behind the track as a stage: the sound changes (centroid 15 percent or level 1.5 dB) and the file stays whole |

Pitch is compared inside one export, note against note, so a device whose tuning is a few cents off still passes. A file
that is silent, clips or contains NaN fails with the reason. Every export is checked before it is measured.

## 8. Kraken and its patch field

Kraken (`synth-kraken`) is a semi-modular synth whose sound is set by pins in a patch field. The tour plays the three notes
through it like any other device. Then it sets one pin, the noise source into the output (row "Noise", column "Out", weight
0.8), reads the stored pins back (the factory pins stay and one is added) and exports again: the sound must change.

## 9. Drum Synth: one recipe and its own knobs per pad

Drum Synth (`drum-synth`) is a kit of building-block drum recipes. Every pad has its own recipe and its own knobs, named
after the pad ("Kick Tune", "Snare Tune", "Closed Hat Tune" and so on). The tour builds a small kit, kick, snare and closed
hat on the notes 36, 38 and 42, and checks that the three pads sound different: the kick is low, the closed hat is high, the
snare lies between. Then it turns one knob, "Kick Tune", and exports again: the kick pad changes and the snare and the hat
sound the same as before.

## 10. Notes in the piano roll

Open a clip and draw notes in the piano roll. The roll writes them into the clip as one change (`noten_neu`) and the clip
plays them. The tour draws three notes into an empty clip the same way, checks that all three are in the clip, exports and
measures their pitch. Then it edits as the roll does: the right button deletes a note (`noten_loeschen`), a drag moves one
(`noten_aendern`). The export must be silent where the deleted note was, and the moved note must sit where it was dragged.

## The tour that checks this chapter

```
python3 djk/tools/tour_cli.py j4 --instanz f --kurz
```

| Step | What it checks |
|---|---|
| `j4.oeffnen` | the graph opens and its knobs are listed |
| `j4.aendern` | two knobs turn and the core accepts both |
| `j4.hoeren` | the export with the changed knobs sounds different from the stock one |
| `j4.speichern` | the preset name is new for this run (the list must not contain it before), and the save answers with origin, device and name |
| `j4.wieder` | the preset is in the list under "Mine" and reads back with its knob values |
| `j4.in_j3` | in a fresh project the preset changes the exported sound |
| `j4.aufraeumen` | the tour deletes the preset it saved, so no run can find an earlier run's file |
| `j4.knoten` | node gesture in the graph editor: SKIP |
| `j4.familie_drums`, `j4.familie_mono`, `j4.familie_poly`, `j4.familie_neuro` | one device of each family plays three notes (or hits) through a track: it sounds, does not clip, has the right pitch or a low kick with an attack, and the notes end |
| `j4.familie_fx` | an effect stage behind a synth track changes the exported sound |
| `j4.kraken` | Kraken plays the three notes with the right pitch |
| `j4.kraken_stift` | one patch-field pin is stored (the factory pins stay) and the sound changes |
| `j4.drumsynth` | a three-pad Drum Synth kit: kick low, closed hat high, snare between |
| `j4.drumsynth_knopf` | one pad's knob changes that pad and leaves the other pads alone |
| `j4.klavierrolle` | notes drawn into a clip play with the right pitch; a deleted note is silent and a moved note moved |
