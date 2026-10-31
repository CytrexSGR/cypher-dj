# ADR 015: Inventory (Bestand), working inventory, crate (Kiste) and journal

- **Status:** accepted (SQLite index: assumption, to be checked in the first workshop plan); versions after the
  critique round of 2026-09-23 (ARCHITEKTUR "Kritik und Korrekturen"), binding before W1, because W1 writes the inventory first
- **Date:** 2026-09-23
- **Requirements carried:** A12, A13, A16, A1
- **Related to:** ADR 011, 020, 016

## Context

The core must never decode by itself (10 §5), reload material without a restart (A13), and after a crash show it again quickly
(10 NP K7: +0.05 ms per MiB). The locked memory limit is 4 GiB (10 test d). A12 needs
several base tempos per material. Andreas' nudge and tap corrections must reach the next render.

## Decision

1. **Inventory (Bestand)** under `~/cypher-dj/bestand/<material_id>/`, `material_id` = the first 16 hex characters of the SHA-256 of the
   source file. `original.*` and `material.json` (source metadata) are written atomically once at the first import.
   Every render is a **version (Fassung)** in its own, immutable folder `fassungen/<bpm·1000>_r<n>/` with its own
   `fassung.json` (frames, checksums, grid, bar one, loudness, gates) together with stems, shots, fingerprint,
   cross energies and reference envelopes; atomically via `rename`. Re-rendering onto a new base starts at `r1`, a
   correction (grid, bar one) places `r + 1` next to it. Deck, working inventory and listening pass bind (material, base,
   version). Reason: the earlier form (one `basis_<bpm>.f32` per tempo, metadata in the once-written
   `material.json`) had no place for `korrigieren` (same base, "never overwrite") and for `nachrendern`
   no place for frames and checksum of the new file.
2. **Audio as raw float32**, interleaved, little endian, 48 kHz, stereo, without header; length, checksum and grid in
   `material.json`. Original additionally lossless (FLAC) or as the delivered file.
3. **`korrekturen.jsonl`** per material, **the only appendable file**: grid corrections per section, bar one,
   hot cues by hand, judgements about the material. The workshop reads it at the next render; `fassung.json` notes up to
   which line has been included.
4. **Index:** `~/cypher-dj/bestand/index.sqlite`, written only by the workshop (WAL), read by the control station and the
   planner for `bestand` requests.
5. **Working inventory** `/dev/shm/cypherdj/material/<material_id>/`: copy of the files chosen for the set, survives
   core restarts; the core fades in only from there. **Crate (Kiste)** `/dev/shm/cypherdj/kiste.json`: list of the playable
   materials for controller and Cypher, written atomically by the control station. Locked budget of the core below 4 GiB,
   unloading by rule (oldest unloaded first).
6. **Set journal** under `~/cypher-dj/sets/djk/<JJJJ-MM-TT_hhmm>/journal.jsonl` (control station) and recording
   `aufnahme.f32` plus `aufnahme.json` (first core sample) next to it.
7. Formats in detail: `SCHNITTSTELLEN.md` §13, §15.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Core decodes MP3/FLAC | decoding in the real-time process; a restart would have to decode again | 10 §5 |
| WAV with header | parsing the header in the loader; raw with metadata next to it is simpler to check | assumption, robust draft |
| mutable folders (re-render overwrites) | a loaded pointer would show a changed file; no way back | assumption |
| new base files next to the old ones, metadata in `material.json` | `material.json` is written once: no place for the metadata of the new file; a correction on the same base would have the same file name | critique round 2026-09-23 |
| everything in `/dev/shm` | tmpfs occupies RAM; only the set material belongs there | 10 §3a (63 GiB RAM) |

## Consequences

- Memory: a 3-minute track in stereo float32 about 69 MB, with four stems about 345 MB per base tempo; 4 GiB hold about
  46 min of material with stems (10 test d). Several base tempos per track make it tight: unloading is mandatory.
- `MCL_FUTURE` in the core can make later fading fail (10 NP K7): the core locks per material with
  `mlock`, not across the board with `mlockall(MCL_FUTURE)`.

## Evidence

10 §5, test d (256 MiB 50.3 ms, 3.072 MiB 601.3 ms, 4.200 MiB fails), NP N8 (0.050 to 0.056 ms per MiB, 3 GiB 156
to 161 ms), K7; 08 §5 (fingerprint v1); 03 §5 (`Material`); 09 §3.8, NP K12 (journal 0.59 MB per hour).

## Breaks if

M8 shows page faults in the callback despite `mlock` (then touch the pages during loading), or the budget does not suffice for a
set (then a smaller crate or stems only on demand).
