# ADR 020: Listening paths in the deck (no stretcher at factor 1)

- **Status:** provisional; measurements M5 (switch direct ↔ stretcher, file swap), M3 (stretcher in real time), M16
  (stretcher on the stem sum) are outstanding; the direct path alone carries from slice 1
- **Date:** 2026-09-23
- **Requirements carried:** A9, A10, A12, A14, A20
- **Related to:** ADR 006, 007, 011, 004

## Context

A12 (decided, Andreas "kk" (OK)): "At import every loop is stretched once offline to the set base
(additional file), live the keylock only does the deviation. No tempo steps; if the set stays elsewhere for longer,
the splitter renders in the background onto the new base." The draft "Robustheit" nevertheless keeps R3 always
in the listening path (same latency for all decks); "Spielbarkeit" places no stretcher in the listening path at factor 1; "KI" says
the same without a switching mechanism. Judges 1 and 3 recommend the direct path, judge 3 with exactly one
stretcher path and without a jump engine, until M2b requires it.

## Decision

1. **Direct path:** If the set tempo equals the base of the loaded file (|bpm/basis − 1| < 10⁻⁶), the deck reads the
   file at the target read head without a stretcher, in the callback. Stems are mixed there without a stretcher (stem mute takes
   effect one period after the grip). **What sounds:** if the loaded version has stems, the stem sum sounds and the base file
   is not loaded; without stems the base file sounds and `stem/*` is rejected (`keine_stems`). Switching happens
   only at loading, because Demucs stems summed do not give the mix bit-identically; reference envelope and cross energies
   come from exactly what sounds (`SCHNITTSTELLEN.md` §4.4, §13.1).
2. **Shadow stretcher:** for **every audibly or pre-listened deck** an R3 stretcher runs warm (factor 1, input from
   the same band, in a work thread with lead-in). If the tempo deviates (ramp, hand segment), it takes over before the first deviating sample with a **20 ms cosine fade**; if the tempo returns to the base, the
   deck fades back to the direct path (on a beat boundary). The audible stretcher never gets a factor closer than
   10⁻⁶ to 1.0 (M4 E4, 2026-09-25: return to exactly 1.0 jumps the pitch by up to 87 ct for 45 ms); a tempo that returns to
   the base therefore ends in the direct path. On the stretcher path the **stem sum** runs through a
   stretcher. Budget: at most 4 real-time stretchers at the same time, at most 2 per work thread (01 NP K1); the
   control station locks more (`budget_stretcher`). [PROVISIONAL, 2026-09-23 13:3x: the re-check to dossier 01 measures R3 in FIFO work threads with lead-in with 8 per thread without underrun (16 on 2 and 32 on 4 threads, limit only at 16 per thread; SCHED_OTHER instead of FIFO: 23 underruns). M3 (slice 30) decides the limit.] A shadow stretcher is created in the loading thread and run through once with
   `retrieve` before it runs warm (01 NP K3).
3. **Re-rendering:** if the set tempo stays steady for **16 bars** at a value unequal to the base (default, set), the
   control station declares a new **set base** and gives the workshop re-render orders with priority 1 for all loaded
   decks, priority 2 for the next candidates. If the new file lies in the working inventory, the deck swaps on a
   phrase boundary via `/k/deck/basis_tausch` with a fade to the direct path of the new base.
4. **No jump engine** (second, pre-filled stretcher instance for hand jumps) in V1; it comes only if M2b and
   the listening session require it. Hand jumps on the stretcher path land on the next reachable grid point
   (ADR 007).
5. **Roll buffer behind the keylock** for the stretcher path from slice 5, after M6 (ADR 007).
6. **Fallback, if M5 fails:** R3 always in the listening path (draft "Robustheit"), then without a fade between paths.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| R3 always in the listening path | at factor 1.0 not transparent (artefacts −63.7 dB, others −102.8), makes transients softer (pre-echo +4.5/+7.5 dB, kick rise 9.07 instead of 3.09 ms, measured offline on the WASM path); 0.1 % stretches cost drums 2.24 dB crest; hand jumps always through 80.9 ms band lead-in | 03 §4c; ERGEBNIS §2.5; 08 §4.e; 03 §4a |
| stretcher only on demand (cold) | pre-filling costs 4.096 samples of input (about 16 R3 steps, calculated about 6 ms of computation, peaks up to 14.7 ms per block); hand tempo only took effect afterwards | 02 test c, 01 §4.5, 03 §4e |
| one stretcher per stem | 16 stretchers do not arithmetically fit into one real-time thread; stem deck in the callback 16 blocks over budget | 01 §4.5, 03 §4e |
| jump engine immediately | largest state machine in the real-time path, unmeasured; quantised grips do not need it | judge 3 |
| tempo steps (several fixed base files) | A12 excludes steps | A12 |

## Consequences

- In the normal case (set at 128) every deck is bit-exact, without keylock latency and without stretcher artefacts; the keylock is
  nevertheless fulfilled, because the base file was stretched offline with R3 (A10).
- The warm stretchers cost computing time permanently (about 360 to 400 µs per R3 step and instance, 01 §4.5), even
  when the direct path plays.
- Comb filtering during the 20 ms fade of two differently processed paths is possible (03 §4a "Discarded measurement methods": phase vocoders change the fine phase), unmeasured: M5.
- Re-rendering a 5-minute track with four stems costs by calculation 1 to 5 min on several cores (R3 offline 5 to
  23 times real time per core, 07 `b_strecken.log`); the stretcher plays in the meantime.
- Several base tempos per material in the working inventory burden the 4 GiB budget (ADR 015).

## Evidence

A12 verbatim; 01 §4.5 way out 1; 03 §4a (null machine 0.000 ms drift in 30 min, band lead-in 0.6 frames; R3
band lead-in 3.884.9 frames), §4b (start with compensation 0.00 ms), §4c; ERGEBNIS §2.3 (cosine fade at the fade
1.34 dB / −93.8 dBFS between two R3 nodes), §2.5; 08 §4.e; 10 test b L2 (16 × R3 offline next to the measuring client: 0
gaps at 128, wake-up max 196 µs).

## Breaks if

M5 shows audible comb filtering or position errors at the switch (then R3 always in the listening path for decks that
deviate from the tempo in the set), or M3 shows that 4 warm stretchers do not fit the budget (then warm only for audible decks, pre-listening
on the direct path).
