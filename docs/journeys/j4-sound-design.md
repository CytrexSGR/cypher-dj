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
