# Note editor contract: `cypherdj-noten`, note list, curve sidecar, render key

Contract version 1. This text, the schemas `audio_noten.schema.json`, `noten_kurve.schema.json`, `noten_kurve_roh.schema.json`,
`noten_auftrag.schema.json`, `noten_zeile.schema.json` (all in `schemas/`), the example files in `cases/noten/` and the page and
server module `djk/ui/project/notes_contract.ts` say the same thing. The tests `tests/test_notes_contract.py` and
`djk/ui/tests/notes_contract.test.mjs` keep them equal. The core library `cdj_noten` and the program `cypherdj-noten` implement
the command line below; the server and the page only read and write the files described here.

## Units and constants

| Name | Value |
|---|---|
| sample rate `sr` | 48000 |
| hop | 256 samples; frame `i` is centred at sample `i * 256` |
| frame count of a source of `n` stereo frames | `floor(n / 256) + 1` (`frameZahl`) |
| pitch in the curve | cents, MIDI times 100 (A4 = 6900.0), `0` = unvoiced, otherwise 1500 to 11000 |
| pitch of a note | float MIDI, A4 = 69, 0 to 127 |
| time | source seconds (the recording's own time, never beats) |
| detector version | `DETEKTOR_VERSION` (`pyin-<n>`); network detector `NETZ_VERSION` (`netz-<n>`) |
| segmenter version | `SEGMENTIERER_VERSION` (`noten_hmm-<n>`) |
| engine version | `MASCHINE_VERSION` (`teilton-<n>`) |
| curve id | `<detector version>.<segmenter version>`, for example `pyin-<n>.noten_hmm-<m>` |
| monophonic threshold | `MONO_ANTEIL_MAX` (0.30): a source is polyphonic when more than this share of the checked frames is |

Any change of an algorithm that changes its output bumps its number. A change of the monophonic check bumps the segmenter number.
The numbers live in one place per side: the constants named above in `notes_contract.ts` for the server, one header of the core
library for `cypherdj-noten`. This text does not repeat them, so a bump does not touch it.

## The clip field `audio_noten`

An optional field of an audio clip: `{ "kurve": <curve id>, "liste": [note, ...] }`, schema `audio_noten.schema.json`. The curve
id says which curve (own detector or network) the notes were cut from, so that a render knows its source of truth and the render
key changes with it. The list has 0 to 4096 notes, ordered by `qa`, with `qe[i] <= qa[i+1]` (touching notes are allowed).

A note:

| Field | Meaning | Range |
|---|---|---|
| `id` | unique in the list | `t1` to `t999999` (`^t[1-9][0-9]{0,5}$`) |
| `qa`, `qe` | detected start and end, seconds | `qa >= 0`, `qe > qa + 0.01` |
| `qton` | detected pitch, float MIDI, centre of the note | 0 to 127 |
| `p` | level | 0 to 1 |
| `a`, `e` | target start and end, seconds | `a >= 0`, effective end greater than effective start |
| `ton` | target pitch, float MIDI | inside 0 to 127 and within `qton` +-24 (see `tonImSpann`) |
| `vib`, `drift` | factor, 1 = unchanged | 0 to 4 |
| `formant` | semitones | -12 to +12 |
| `gain_db` | dB | -48 to +12 |

Target fields are written only when they differ from the detected value: `ton != qton`, `a != qa`, `e != qe`, `vib != 1`,
`drift != 1`, `formant != 0`, `gain_db != 0`. A target that equals its default is invalid, so the stored form is canonical. No
other fields are allowed. The effective start is `a` if present, else `qa`; the effective end is `e` if present, else `qe`.

The span of `ton` is decided by one helper, `tonImSpann(ton, qton)`: `0 <= ton <= 127` and `|ton - qton| <= 24 + 1e-4`. The
tolerance of 1e-4 exists because targets are rounded to 1e-4 (`rundeTon`) while `qton` has no decimals rule: a target of exactly
`qton + 24` must stay valid after rounding (`cases/noten/audio_noten_ton_24_gut.json`: `qton` 60.12346, `ton` 84.1235). The core uses
the same rule.

Rules over the whole list (not expressible in JSON Schema), in this fixed order, each rule across all notes before the next one:

1. duplicate ids,
2. duration: `qe > qa + 0.01` is required, so a duration of exactly 0.01 s is refused,
3. targets against detected values, note by note and, within a note, in this order: `ton` equal to `qton`, `ton` beyond the span,
   `a` equal to `qa`, `e` equal to `qe`, effective end not greater than effective start,
4. order: `qa` must not decrease,
5. overlap: `qe[i] <= qa[i+1]`.

Shape errors come first: the shape of every note (types, ranges, patterns, unknown fields, default-valued targets) is checked over the
whole list before any rule is reported, `ton` outside 0 to 127 included.

## The curve sidecar

`<arbeitsordner>/noten/<source sha>.<curve id>.json` (`kurveDatei`), schema `noten_kurve.schema.json`. It can always be
recomputed from the source. Fields: `format` (`cdj-noten-kurve/1`), `quelle` (64 lowercase hex), `frames` (stereo frames of the
source), `sr`, `hop`, `detektor` (`pyin` or `netz`), `kurve` (the curve id; it starts with the version that matches
`detektor`), `f0_ct` and `konf` (each `frameZahl(frames)` entries; `f0_ct` has two decimals, `konf` three, 0 to 1), `noten`
(detected notes `{qa, qe, qton, p}` with the ordering rules above and no id), `stimmhaft_anteil` (share of voiced frames, 0 to 1),
and optionally `mono` (`geprueft_frames`, `anteil` 0 to 1, `mehrstimmig`, `hrr_db_schwelle`, `periode_schwelle`), written by
`pruefe` only.

Rules over `mono`: `mehrstimmig` is true exactly when `anteil > MONO_ANTEIL_MAX` (exactly the threshold is not polyphonic), and
`geprueft_frames` 0 means `anteil` 0 and `mehrstimmig` false. A violation is `format`.

Notes of the sidecar follow the list rules above that apply without ids and targets (duration, order, overlap). In addition
`kurvePruefung` requires each note to end at most one hop after the last sample, `qe <= (frames + hop) / sr` (a note ends at the end
of its last frame, and the last frame is centred at or before the last sample). Whether the notes of a clip stay inside its source
is checked by the server in B2, where the length of the source is known.

## The external curve

Input of `segment`, schema `noten_kurve_roh.schema.json`: `format` (`cdj-noten-kurve-roh/1`), `frames`, `sr`, `hop`, `detektor`
(`netz`), `detektor_version` (`netz-<n>`), `f0_ct`, `konf` (rules as in the sidecar).

## The render order

Input of `render`, schema `noten_auftrag.schema.json`: `format` (`cdj-noten-auftrag/1`), `kurve` (the curve id, must equal the
sidecar's: otherwise `kurve_passt_nicht`, see `auftragPasstZurKurve`) and `liste` (exactly the clip's list, all notes, untouched
ones included, with the list rules above).

## Command line of `cypherdj-noten`

Exit 0 ok; 1 failure with an error line; 2 usage error (`argument`); 143 on SIGTERM. Outputs are written to `<aus>.tmp` and
renamed when complete, so a failure or a SIGTERM leaves no partial output file. Slice 1 renders pitch only: `render` refuses a
note list that carries any target other than `ton` with `nicht_unterstuetzt`.

### `version`

Result `{"status":"ok","programm":"cypherdj-noten","vertrag":1,"detektor":<DETEKTOR_VERSION>,"segmentierer":<SEGMENTIERER_VERSION>,"maschine":<MASCHINE_VERSION>}`.

### `analyse <quelle.f32> <aus.json> [--sha <hex>]`

Own detector and segmenter; writes the sidecar without `mono`. The source sha is the file name stem when it is 64 hex digits,
else `--sha` (missing: `argument`). The detector runs on (L+R)/2: one curve for both channels. A silent, very short or noisy
source ends ok with an empty note list.

### `segment <quelle.f32> <roh.json> <aus.json> [--sha <hex>]`

Cuts notes from an external curve and writes a sidecar with `detektor` `netz` and the curve id `<detektor_version>.<SEGMENTIERER_VERSION>`.

### `pruefe <quelle.f32> <kurve.json>`

The monophonic check: rewrites the sidecar with `mono` (atomically). A separate step, so that the detector path does not wait for
the engine analysis it needs and the network path runs the same check. A polyphonic result is not an error: the line says
`mehrstimmig: true`.

### `render <quelle.f32> <kurve.json> <auftrag.json> <aus.f32> [--vorher <f32> --nur <id,id,...>]`

The output has exactly the frames of the source. `--nur` requires `--vorher` (`argument` otherwise); `--vorher` of another length
is `vorher_passt_nicht`. The sample rate (48000, stereo, float32 little endian) and the frame count come from the source file.

## Lines

stdout: exactly one JSON line, schema `noten_zeile.schema.json`. Every result line ends with one LF; `zeilePruefung` accepts the
text with or without that one trailing LF, and refuses a second LF, a CR, or a line break inside.

| Command | Ok line (`status: "ok"` and) |
|---|---|
| `version` | `programm`, `vertrag`, `detektor`, `segmentierer`, `maschine` |
| `analyse`, `segment` | `datei`, `noten` (count), `stimmhaft` (0 to 1), `sekunden` (CPU seconds) |
| `pruefe` | `mehrstimmig`, `anteil`, `sekunden` |
| `render` | `datei`, `bereiche` (`[[s0, s1], ...]`, rewritten sample ranges, half open, `s0 < s1`), `sekunden` |

Failure: `{"status":"fehler","fehler":<code>,"text":<English text>}`.

`sekunden` is process CPU time (getrusage); a wall clock never decides a limit.

stderr progress: `@@fortschritt {"stufe":k,"von":n,"name":<name>,"prozent":p}`, the form `liesFortschrittsZeichen` in
`djk/ui/media_library.ts` reads (`1 <= stufe <= von`, `prozent` 0 to 100; the optional string `teil` is accepted as there), at most ten
lines per second. Names: `laden`, `tonhoehe`,
`noten`, `pruefen`, `rendern`, `schreiben`.

## Error codes

| Code | Meaning |
|---|---|
| `argument` | usage error (exit 2): missing or unknown argument, `--nur` without `--vorher`, no source sha |
| `datei_fehlt` | an input file does not exist |
| `datei_kaputt` | the f32 size is not a multiple of 8, or a JSON file cannot be read |
| `format` | a JSON file does not match its schema, `ton` outside 0 to 127 included; the array lengths of a curve against its `frames`; a `mono` rule is broken |
| `kurve_passt_nicht` | `frames`, `sr` or `hop` of the curve differ from the source, or the curve id of the order differs from the sidecar's |
| `noten_ungueltig` | the notes break a list rule: duplicate id, duration, a target equal to the detected value, `ton` beyond the span, effective end, order, overlap, a note ending after the source |
| `nicht_unterstuetzt` | the order carries a target other than `ton` (slice 1) |
| `vorher_passt_nicht` | the `--vorher` file has another length than the source |
| `schreiben` | an output file cannot be written or renamed |
| `nicht_gebaut` | the command is still a stub (only while a command is not built) |

## Reason codes

One table for the checks of `notes_contract.ts`, the Python copy of the rules in the contract test and the core; the expected code of
every bad example file is in `cases/noten/gruende.json` (the tests of both sides assert that table).

| What is wrong | Clip field (`audioNotenPruefung`) | Files (sidecar, raw curve, order, lines) |
|---|---|---|
| anything the schema refuses (shape, ranges, patterns, unknown fields, default-valued targets) | `argument_ungueltig` | `format` |
| `ton` outside 0 to 127 | `noten_ton_grenze` | `format` |
| `ton` within 0 to 127 but beyond the span of 24 semitones | `noten_ton_grenze` | `noten_ungueltig` |
| any other list rule (duplicate id, duration, target equal to detected value, effective end, order, overlap) | `argument_ungueltig` | `noten_ungueltig` |
| array lengths of a curve against its `frames`, decimals of `f0_ct` and `konf`, a `mono` rule | not applicable | `format` |
| curve `frames` differ from the source, order's curve id differs from the sidecar's | not applicable | `kurve_passt_nicht` |

Precedence: shape errors win over rule errors for the whole list, then the rules run in the fixed order above. In a sidecar the
order is: shape of the file, `mono` rules, shape of all notes, array lengths and decimals, then the list rules of the notes.

## The render key

`renderSchluessel(quelleSha, kurve, maschine, liste)` is the sha256 (64 lowercase hex) over the UTF-8 text

```
cdj-noten-render/1\n<source sha>\n<curve id>\n<engine version>\n<kanonischeListe(liste)>
```

(`\n` is a line feed, no trailing newline). `kanonischeListe` is `JSON.stringify` of an array with one array per note in list
order: `[qa, qe, qton, a, e, ton, vib, drift, formant, gain_db]`, absent targets as `null`, seconds (`qa`, `qe`, `a`, `e`) rounded
to 1e-6 (`rundeS`), every other number to 1e-4 (`rundeTon`). `id` and `p` are not part of it: they do not change the sound. The
curve id is in the key besides source, notes and engine, because the same notes on another curve render differently. Only the
server computes keys; the C++ side never does. `cases/noten/schluessel.json` holds three hand-written pre-images with the digest
made by `sha256sum`.
