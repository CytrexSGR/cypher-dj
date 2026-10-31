# ADR 023: Stellwerk (interlocking), runtime invariants and deadline watchdog

- **Status:** accepted (fallback loop and audible threshold provisional until slice 2 and M18); I2, I3 and "audible"
  corrected after the critique round of 2026-09-23 (ARCHITECTURE "Critique and corrections")
- **Date:** 2026-09-23
- **Requirements carried:** A1, A4, A6, A7, A14, A20
- **Related to:** ADR 005, 008, 012, 013

## Context

The Stellwerk prototype (09) executes plans in beats, sample-exactly; the hand wins per control; the interlock checks
listening passs. The re-check found five errors that would sound wrong today: sub doubled after a grab,
because plans never couple and the sub rule is checked only at submission (K1); empty master when B is interlocked
at the start and A still fades out (K2); jump at the first grab (K3); a noise step aborts Cypher's run (K4);
overlapping parts on the same control jump (K5). In addition, the listening pass check does not carry the
level (K10), and when a deadline is missed a fallback is missing ("What is missing").

## Decision

1. **Stellwerk split in two:** the **control centre (Leitstand)** accepts and interlocks (form, autonomy, too late,
   control with the human, overlap, listening pass, budget), assigns couplings (bass-swap pairs, "A out" to
   "B in") and submits parts with a target beat. The **Stellwerk RT in the core** executes: control table with
   holder, ramps and setting in beats (converted per block with the currently valid tempo map), discrete deck parts
   **with plan, group and listening pass, like control parts** (they fall with their group), hand arbiter,
   start at the actual value without a jump.
2. **Hand first:** a grab sets the holder to `mensch` on the same sample and aborts only this control and its group
   (running and waiting parts, from any plan). Takeover scaled or relative, first value only a position, dead zone
   3/128 (ADR 014). The invariants never bind the hand.
3. **Runtime invariants in the core**, checked before each part start, in every cycle in which a plan part moves an
   affected control, and after each hand grab (definitions: `INTERFACES.md` §17):
   - **I1 Sub never doubled:** a plan part that would make a second channel "low open" is aborted with its group
     (`invariante sub_doppelt`).
   - **I2 Master never empty:** a plan part or a deck stop from a plan that would make the last audible channel
     inaudible holds at the actual value, or waits until another channel is audible (`invariante master_leer`). A
     deck is audible only if it is running: a stopped or never started B holds "A out" instead of counting as
     audible (otherwise exactly the case of 09 NP K2 would end in silence again).
   - **I3 New content only with a listening pass** (A4 verbatim: "the conductor may never play anything
     unheard"; not only "never fade in unheard"): (a) a plan part that opens a closed channel needs a valid listening
     certificate for channel and content (material and version), `beat ≤ gueltig_bis`, tempo within ±0.5 % of the
     measurement and, for decks, a source position in the measured range; "open" counts via trim and fader, not via
     crossfader, bus or master; (b) a hit on an open pad needs a listening pass for that hit; (c) a new
     pattern on an open generator channel plays only with a listening pass for that pattern; (d) Cypher's
     jump or hot cue on an open deck needs a measured target or Andreas' acceptance. Otherwise it is interlocked
     (forms: `INTERFACES.md` §17).
   - **I4 No overlap** on the same control (also within a plan).
4. **Deadline watchdog in the core:** if a running deck is the **only audible channel**, fewer than 32 beats
   (8 bars) remain until the end of its material, and no accepted part makes another channel audible in time, the
   core places a loop over the last full 16 beats (4 bars) of the material from bar one and reports `rueckfall`.
   Each grab or command on this deck triggers it; only an **executed** deck stop by Andreas prevents it (a plan stop
   that waits because of I2 does not). Neither a dead player nor a dead control centre produces silence, and
   Andreas' normal mixing (a second channel is audible) never triggers it.
5. **Cypher stop** in the core (ADR 013), also without the control centre.
6. "Open" means: trim plus fader above −26 dB (for I3). "Audible" means: effective channel level (trim, fader, bus,
   crossfader weight, master) above −26 dB **and**, for decks, the deck is running (for I1, I2, deadline watchdog;
   linear 0,05, threshold from 09 §6, set); "low open" means audible, kill low and EQ low above −12 dB (set). All to
   be calibrated in M18.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Stellwerk entirely in the control centre (JS) | worst block 7 053 µs | 09 NP b3 |
| invariants only at submission | grab on A's bass before the swap: 15 bars of sub doubled | 09 NP K1 |
| expect coupling from the LLM | 0 of 105 plans set `gruppe` | 09 NP K1 |
| hand aborts the whole plan | A's bass never goes out | 09 test b `naiv_ganzer_plan` |
| hand takes effect only at block start | 224 samples = 4.67 ms too late | 09 test b `naiv_block` |
| fallback in the control centre | if the control centre dies, there is no fallback | 09 NP K2, "What is missing" |
| I3 only for "unheard becomes heard" | new content on an already audible channel (hit, pattern, jump) and a fader behind a closed crossfader reached the master without a listening pass | critique round 2026-09-23, 09 "What is missing" (listening pass on a jump on an audible deck) |
| "audible" without "running" | a stopped B counted as audible, I2 let "A out" run: silence | critique round 2026-09-23, 09 NP K2 |

## Consequences

- Invariants can hold a transition; the core reports it, and the control centre asks Cypher anew (turn trigger).
- The thresholds are set; wrong thresholds make Cypher too cautious or let flams (flams) through.
- Regression tests: the 12 tests from `stellwerk.test.mjs` and the cases a1 to a5 from `nachpruefung/angriff.mjs`
  must turn red against the C++ core if the respective rule is missing, and green with it.

## Evidence

09 §3.3 (six guiding principles), test b (abort at sample 1 620 000, only `A.gain`; tempo 132 after acceptance:
switch point on the bar, converted to samples it would be 170 ms too late), test b2 (mutations turn red),
NP K1 to K5, K10, b3; 03 §4d (loop on the band, 0.0 frames).

## Reversed if

Slice 2 shows that I2 holds too often in real transitions (then I2 only for plans with source `cypher`); the
fallback loop sounds wrong in the listening session (other length, or a fade-out instead of a loop).
