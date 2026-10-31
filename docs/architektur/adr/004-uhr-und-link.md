# ADR 004: The one clock, sync to the outside, and Link

- **Status:** accepted; Link bridge provisional, measurement M12 pending; drift against interface crystal M1 still open
- **Date:** 2026-09-23
- **Requirements carried:** A9, A11, A12, A20
- **Related to:** ADR 005, 020, 016

## Context

A20 requires "everything in lockstep". Candidates for the clock were: own sample counter, driver frame time,
JACK transport, Ableton Link, Strudel's `cps`. Dossier 01 §4.2 proposed deriving the position after a dropout from the
graph's frame time; the draft "Spielbarkeit" (playability) wanted to close gaps by catching up; the draft "Robustheit"
(robustness) wants to keep the clock steady inside and re-anchor it outside.

## Decision

1. **The one clock** is its own `int64` sample counter in the core's real-time callback (sum of the `nframes`) plus a
   **tempo card** of segments (constant or linear in time; S-shaped corners only after V1). Beat, bar, phrase and
   deadline are functions of it (formulas: `SCHNITTSTELLEN.md` §1.3).
2. **Steady inside, re-anchored outside.** A dropped cycle is not caught up: the music shifts against the wall clock by
   one block, inside nobody notices. Outward (Link, MIDI clock), every detected gap and every driver change
   re-anchors, resets the HostTimeFilter, and reports `/e/luecke`.
3. **Anchor in the state** `{anker_sample, anker_mono_ns, Tempo-Karte}` in `/dev/shm`; a freshly started core
   continues where it would have stood without a crash.
4. **Tempo card limited** (64 segments), past segments are discarded, a rejected change is acknowledged as `abgelehnt`
   with reason `karte_voll`. Andreas' tempo control is **one** hand segment that is overwritten each cycle.
5. **No tempo jumps**, only ramps with a minimum duration of 1 beat, **also for Andreas' hand:** every encoder detent
   (0.01 BPM) drives the hand segment as a ramp over 1 beat (`SCHNITTSTELLEN.md` §1.3, §7.3 point 7). Reason: the only
   native factor jump measured on pitch lay 95 ms over 10 ct and had 128 null samples (ERGEBNIS §2.6). M4 (2026-09-25):
   small changes produce no null samples in the time-based design (E7, E9), but cost phase, each one on its own; hence
   a factor cadence of 43 blocks (rule 6). Ramp over 1 beat with 50 ms lead confirmed (E1, E2, E6). S-shaped corners
   (04 §4.5) come as a later segment type; at linear corners a residual peak of −107.3 dBFS remained in the delay, below
   the 16-bit step.
6. **Phase control per deck** on the stretcher path (ADR 020): source position against `sample_at`, readjust the factor
   at most every 43 blocks, |c| ≤ 100 ppm, on the delay model D = 50 ms (M4 E3, E5, 2026-09-25; "a few ppm per block"
   drifts away); for planned ramps the factor leads by one engine delay (50 ms) (M4 E1 confirmed).
7. **Outward:** MIDI clock (24 ppq, start on bar one) from the core over JACK MIDI; **Ableton Link in its own bridge
   unit** `cypherdj-link`, which reads `/uhr`; the core always leads, foreign tempo changes are only reported
   (directive on 02 question 1). **JACK transport never.** Both only from slice 9.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Driver frame time as clock | jumped by −2 978 880 305 frames at a driver change; four times in 06 run 1 | 02 check b; 06 §4.1 |
| Catching up gaps from the frame time | every gap would be a jump in all decks and stretchers (click); re-anchoring outside helps just as much | 02 NP "Was fehlt" 3, N6 |
| JACK transport | state belongs to the driver, breaks at a driver change, knows no ramp | 02 check b, k_trans1, k_midi1 |
| Link as inner clock | tempo in whole µs per beat (132 becomes 132.000132), 50 ms send brake, takeover 0.15 to 50.25 ms, own system clock `CLOCK_MONOTONIC_RAW` | 02 check a, e, NP N3 |
| Link in the core | network threads and LAN packets do not belong in the audio process (assumption); in-process measured error of 14 µs settled | 02 NP N6; M12 compares |
| Strudel's `cps` | falls away with the browser | 02 §3.1 E |

## Consequences

- All other processes speak in beats (ADR 005).
- After a driver change an offset of milliseconds arises outward (measured 1.046 and 2.787 ms); hence a fixed driver in the set.
- The drift of samples against the system clock on the real crystal is unmeasured (M1): an anchor in monotonic time holds the grid across restarts only as long as this drift is small.

## Evidence

02 §3.1 (formulas), check b (commands in beats, 0 samples, K2: by construction), check d (5.7·10⁻¹⁴ beats), NP N1 (tempo changed after sending: beats 0 samples, ms up to 554 samples), N4 (card full after 15), N5 (R3 deck in the ramp up to 1.92 ms, then 1.4 ms, 8.1 ppm at 132), N6 (HostTimeFilter after driver change 2.67 s to 2.8 ms off), k_midi1 (2 287 MIDI clock ticks 0 frames off, within PipeWire); 04 §4.5 (S-corners: −107.3 → −144.5 dBFS); ERGEBNIS §2.6 (native factor jump 95 ms over 10 ct, 128 null samples); 10 check c (grid after restart ≤ 0.2 samples, NP ≤ 0.95).

## Overturned if

M1 shows a large drift between interface crystal and system clock (then anchor in driver frames plus drift estimate), or M12 shows that the Link bridge is clearly worse than Link in-process.
