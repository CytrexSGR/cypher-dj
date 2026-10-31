# ADR 012: Fingerprint, fit, style, live analysis, learning

- **Status:** accepted; listening-permit thresholds and the rule of thumb against the optimizer provisional until M18, low-band limits until M20; corrected after the critique round of 2026-09-23 (ARCHITECTURE "Kritik und Korrekturen", i.e. "critique and corrections")
- **Date:** 2026-09-23
- **Requirements carried:** A4, A6, A7, A8, A15, A16, A20
- **Related to:** ADR 008, 011, 013, 023

## Context

A16: fingerprint per material, fit as a calculation, transition as a plan over time, style as a parameter set; what
stays art is which track, which style, which moment; what predicts a good transition is learned from Andreas'
judgment. 08 built fingerprint, fit and an optimizer; the re-check shows that the simple rule of thumb doubles the sub
less (08 NP K1) and that live analysis does not see a wrong grid (K4).

## Decision

1. **Fingerprint v1** when importing into the workshop, in beat time (sixteenths), fields per 08 §5 (`fa.py`):
   loudness (LUFS, true peak, crest, LUFS per bar), six bands, energy profile, onsets per band with strength, kick phase,
   tuning with directional sharpness R, key (Camelot, chroma, lead), bass character, vocal share, reference envelopes,
   cross energies `C[b, j, j', s]` **with the mixer filters** (LR8 246/2484 Hz).
2. **Tuning and key** only from tonal stems (pads, bass) with R ≥ 0.1 and a second tool (Essentia); drum loops without
   key. **Automatic tuning alignment on import:** the workshop pulls every incoming track offline in the same R3 run as
   the warp to A = 440 Hz, only under 35 cent deviation and when both tools agree (to 10 cent); otherwise no correction,
   only warning and suggestion (directive on 08 question 1 "automatically retune incoming tracks", Andreas can overturn
   it). **Live there is no pitch path:** the direct path holds no stretcher, and the contract has no pitch control per
   deck; pairwise alignment live would need its own version per pair or a stretcher in the listening path. Pitch of the
   correction unmeasured: M19.
3. **Fit** is a calculation in the planner: trim per track, phase shift, overlap per band, onsets within 30 ms, key,
   tuning, stretch cost, vocals doubled.
4. **Style = parameter set, executed as a rule** (rule of thumb with parameters: length, course, entry, ramp, bass-swap
   bar, A-out bar, sub/low limits, pumping), and indeed **exactly the measured rule** `saat()` from
   `probe_b_uebergang.py` with all controls, anchor values and shapes (`INTERFACES.md` §14.4). The **prediction**
   over cross energies checks each rule before use: **locking only against the sub limit**; the low-band limits only
   report warnings until M20, because the measured rule of thumb itself lies above them (all bands, 08 NP K1: "safe"
   sub 0.082 at limit 0,10, **low 0.402 at 0.20**, low-mid 0.951; "hard" sub 0.015 at 0,25, **low 0.355 at 0.35**,
   low-mid 0.860). With the contract limits the planner would have locked both standard styles on the only measured
   pair. The **optimizer** remains an option until Andreas' A/B judgment lets it beat the rule (first question in the
   listening session: `sicher_saat.wav` against `sicher_optimiert.wav`). Starting values "safe" and "hard" from 08
   §3.3.4 (measured), genre styles as starting values (guess).
5. **"Pumping"** is 0 dB until Andreas' answer (A8 open); the three readings (gain, bass emphasized, sidechain from the
   clock) are provided as parameters.
6. **Live analysis:** block-rate DSP in the core (six analysis bands as envelopes at 1 kHz, LUFS;
   `INTERFACES.md` §6.2, same filters as the reference `huelle_1khz.npy`); end-of-bar evaluation in
   `cypherdj-analyse`: bands and overlap per band, **offset per deck against its reference** (checks the execution,
   search window ±200 ms, band with highest correlation) **and onsets deck against deck in the low band** (checks the
   grid). Collisions are predicted and measured live (the decision "predict only" from 08 §3.3.6 is open again through
   NP K4).
7. **Listening permit** of a pre-listened channel after 4 bars of measurement at the measuring tap: offset against
   reference, deck against deck, short LUFS, level against the running deck, bands. Thresholds as data (provisional:
   offset ≤ 2.0 ms and tempo ±0.5 % from 09 §6, set there; deck against deck ≤ 8 ms as lower bound of the flam range from
   08 §3.3.2; level ±3 dB after trim, set without a source). All four are calibrated in the listening session M18.
8. **Learning:** every set is learning data (fit, plan parameters, measured values per bar, judgments, acceptances and
   rejections, hand grabs in Cypher plans); **learning by watching**: Andreas' own transitions lie as control curves with
   sample stamps in the journal and become style parameters; **A/B pairs after the set**, not during it; model
   L1-logistic on feature differences (Bradley-Terry), trained between sets.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Optimizer as default | breaks its own sub limit (0.135 at limit 0.10); rule of thumb 0.082. In the other bands the optimizer is better (low 0.238 versus 0,402, low-mid 0.530 versus 0,951, loudness 0.83 versus 1.29 LU); which band counts is decided by Andreas' ear (M18). Cost comparison measures with its own objective function | 08 NP K1 |
| Camelot only (Mixed-In-Key logic) | same key, yet 25 to 34 cent out of tune (two tools) | 08 §4.a, NP K3 |
| large learned transition model (GAN) | listening test: no significant difference from linear and rule | 08 §3.1 (Chen 2022) |
| count collisions only live | a causal detector does not separate coinciding kicks from flams | 08 §4.c |
| predict collisions only | a wrong grid stays invisible; after correction 66 % of the MFB beats in the flam range | 08 NP K4 |
| absolute judgments "good/muddy" | pairwise outperforms absolute in every row of the simulation | 08 §4.d, NP K6 |

## Consequences

- The prediction with keylock has a realistic error of 0.038 overlap and 0.41 LU (08 NP K2); that is the acceptance limit of slice 2.
- "About 40 judgments" is an optimistic bound; with half as sharp a taste, 160 are not enough for "which numbers count" (08 NP K6).
- Backward (reverse) analysis per Kim 2021 becomes redundant through learning by watching, because Andreas' control curves are available in plain form (guess about quality).

## Evidence

08 §3.1, §3.3.1 to 3.3.6, §4.a (168 of 168 fingerprints), §4.b, §4.b2 (with cross terms LR4 and LR8 equally good, 0.0119), §4.c (built-in 20 ms arrived as 20.0 to 21.9 ms), §4.d, §4.f (Python block p99 15.2 ms; planner "safe" 3.9 s, NP 0.891 s); NP K1 to K6, "Was fehlt" (what is missing) 1 to 6; 09 §6 (sync thresholds 2.0 ms, tempo ±0.5 %, set).

## Overturned if

Andreas finds the optimizer audibly better in the listening session (then optimizer for this style); the listening-permit thresholds show by ear as too strict or too lax (data, not architecture); M20 shows that a rule of thumb with early-lowered A-low holds the low limits (then they lock) or does not (then set limits anew); M19 shows audible errors of the tuning correction (then suggestion only).
