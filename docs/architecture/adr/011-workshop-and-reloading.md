# ADR 011: Werkstatt (workshop) and live reloading

- **Status:** provisional; measurements M13 (grid and bar one of the MiniMax songs after warp), M14 (end to end, BPM fidelity),
  M19 (large stretch factors, tuning correction) and M9 (GPU in the set) are outstanding; dossier 07 is missing; corrected after the
  critique round of 2026-09-23 (ARCHITECTURE "Kritik und Korrekturen")
- **Date:** 2026-09-23
- **Requirements carried:** A2, A10, A12, A13, A16, A19
- **Related to:** ADR 015 (inventory), 022 (generation), 020 (re-rendering), 006

## Context

A13: the splitting (stems, loops, single hits, tempo, bar one, key, text) runs during the set as its own
role (Sonnet), reports "done" and puts material into the inventory, which the system reloads without a restart.
Interim finding of the night: MiniMax songs have weak pulse clarity (0.03 to 0.24) and a drift figure of
9.6 to 183.1 (corrected 2026-09-23 05:2x after dossier 07: the minimum is zeig-mir-wo-du-klein-warst.mp3 with 9.6) ms/min, `sofa-abend.mp3` 906.3 ms/min (07 `c_drift.log`, state 02:59). The figure is the median
of the absolute values of 60-s slopes from 8-s phase windows (`c_drift.py`); at clarity below 0.1 it cannot be
separated from measurement noise, a control with a rigid grid and weak pulse is missing (read from the code,
guess about the size). Independently of this, the best fixed BPM of all MiniMax songs does not lie on whole numbers
(89.905 to 180.709; against the rounded BPM 47 to 153 ms/min, column `gg`).

## Decision

1. **Workshop as its own units:** a queue service `cypherdj-werkstatt` and jobs as
   `cypherdj-werkstatt-job@` with `Nice=19`, `CPUSchedulingPolicy=batch`, `IOSchedulingClass=idle`, limited
   threads.
2. **Chain per song** (each step writes into the job directory, only the last one publishes):
   1. decode (ffmpeg, float32, 48 kHz), −12 dB headroom;
   2. beat grid and **tempo map of the source** (beat_this; second tool Essentia; a deviation between the two is a
      warning), **bar one** (downbeat from beat_this, second method low-band energy per beat position),
      half or double tempo choice (stretch factor to the set base closest to 1);
   3. **warp per timemap** with R3 onto the rigid grid of the set base (default 128), float, in the same run
      the tuning correction to A = 440 Hz (only under 35 cents and when two tools agree, ADR 012); the trim
      comes on loading from `ziel_lufs` and the LUFS of the version;
   4. stems with the same map: in the set on the CPU only at quantum 256 (Nice 19, batch, 10 NP N6: 15 % of the
      period), never at 128; on the DJ machine GPU only after Andreas' answer to question 4 (ARCHITECTURE §13) and M9. **W1
      starts without stems** (cut list);
   5. fingerprint v1 in beat time, cross-energies with the mixer filters, reference envelopes (six bands like the
      ring), all from what sounds (stem sum or base file); structure, hotcue suggestions at phrases from bar one,
      loops, single hits on the set base;
   6. **gates** (`INTERFACES.md` §12.3): grid residue of the **independently** measured low-band hits on the warped
      result (`fa.py`, not beat_this or Essentia, which set the map), pulse clarity ≥ 0.1 without exception,
      stretch factor ±15 %, bar-one agreement, headroom. Material that tears a gate is offered **only to Andreas**
      (`nur_fuer_andreas`), never to Cypher, with a warning;
   7. atomically into the inventory: new material as a whole folder, each further **version** as its own folder
      `fassungen/<bpm·1000>_r<n>/` (temporary folder, `rename`, never overwritten, ADR 015), `material_fertig` to the
      control room.
3. **Queue with priority:** 1 re-rendering of loaded decks onto a new set base (ADR 020), 2 ingesting
   fresh songs, 3 reserve. GPU jobs serially.
4. **Reloading without restart:** the control room copies material into the working inventory `/dev/shm/cypherdj/material/`;
   the core loader fades it in via `mmap`, locks it via `mlock`, checks, and passes a pointer into the callback.
5. **Splitter** (A13) from slice 6 is its own Sonnet session with workshop tools: it judges (loop boundaries,
   names, warnings such as "vocal out of tune"), the chain computes. Until then the chain runs without Sonnet.
6. **Grid by hand** (nudge, tap, bar one) produces corrections per section; `korrigieren` renders from them a
   new version `r + 1` (ADR 007, 015). This is the fallback, in case M13 fails.
7. **Workshop environment** (measured 2026-09-23): the probe venv has torch 2.5.1+cpu and no GPU; beat_this and
   Demucs never ran with real weights (10 NP N6 used random ones, `~/.cache/torch` is missing), the first run loads
   the weights from the network (`beat_this/inference.py`: `CHECKPOINT_URL`). The plan of W1 creates a new venv with
   `--system-site-packages` (system torch 2.10.0+cu128) and loads the weights once in advance with a size check
   (over 1 GB only with Andreas' yes).

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| constant BPM per song (grid from the best fixed BPM) | residue without timemap 45.26 ms RMS on the drifting click | 07 `b_timemap.log` |
| R2 for the warp | 1.94 ms RMS residue, −1.15 ct; does not hold low tones | 07 `b_timemap.log`, 03 §4c |
| command line without headroom | clips at ±1.0 even with `--ignore-clipping` (MFB up to +5.09 dBFS) | 08 NP K5 |
| stems in the set on the CPU at 128 | HTDemucs drove the wakeup at 128 to 55 % of the period (at 256: 15 %, hence allowed there) | 10 NP N6 |
| core decodes itself | decoding in the core process, a restart would have to decode again | 10 §5 |
| live analysis detects a wrong grid | the offset against the reference does not see a wrong grid | 08 NP K4 |
| check the gate with the tool that set the map | measures its own error (pattern from 08 NP K3: the same meter before and after) | 08 NP K3 |
| re-rendering overwrites or supplements `material.json` | loaded pointers and listening passs pointed at changed data; the correction would have no room | ADR 015 |

## Consequences

- **GPU not secured:** PyTorch Demucs needs according to research roughly 7 GB of graphics memory (undated README figure,
  unmeasured); with foreign training roughly 1 GB remains (research §3c), in this night foreign services occupied 7 786
  to 10 832 of 12 282 MiB (`nvidia-smi`, own measurement against 04:20, critique finding 04:10). The "roughly 5 s per 3-minute song" applies to a TensorRT
  engine (not commercial, for sm89 still to be built), **not** to this chain. M9 measures the need of the real chain.
- Fresh songs are minutes away: fingerprint plus cross-energies of an 8-minute song 75 s on one core
  (08 NP), R3 offline 5- to 23-fold real time per core under load (07 `b_strecken.log`), stems on the GPU
  unmeasured; calculated 1 to 5 min for 3 minutes of audio (M14 measures).
- The gates are uncalibrated until M13 and M19 run; until then a torn gate blocks only Cypher's access, not
  Andreas' (for him it is a warning). Of the ten existing MiniMax songs, after c_drift eight tear the gate
  `klarheit` and seven the gate `streckfaktor` (calculated from the BPM, with half/double tempo choice).
- Dossier 07 flows in via the plans; if it contradicts this decision, the dossier together with its re-check applies.

## Evidence

07 `c_drift.log`, `c_drift.py`, `b_timemap.log`/`.json` (R3 with timemap: residue 0.19 ms RMS, max 0.58 ms; 255 of 255
hits; **classified: timemap mechanics on a synthetic click with known ground truth, the timemap comes from the
true hit times; detection on MiniMax songs is measured by M13**), `b_strecken.log` (R3 110.000 Hz; 0.64 to 3.21 s per 15-s loop), `pip_torch.log` (torch, demucs 4.0.1,
beat_this 1.1.0, Essentia 2.1b6 installed); 08 NP K5, "Was fehlt" 6; 10 §5, NP N6, N8 (0.05 ms per MiB); research
§3c (GPU as workshop; TensorRT stems roughly 5 s per 3-minute song on an RTX 3090, single benchmark, not
commercial; PyTorch Demucs roughly 7 GB graphics memory, undated), question 2 there; 10 NP K6 (GPU job start and end
unmeasured); A13.

## Reverses if

M13 shows that the tempo map on MiniMax songs does not hold even with two tools (residue at the output above the
flam limit of 8 ms): then "grid by hand" as a mandatory step (tap during pre-listening) or generation with a stricter
prompt (fixed tempo) before ingesting.
