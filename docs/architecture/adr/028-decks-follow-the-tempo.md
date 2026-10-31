# ADR 028: Decks follow the live tempo (varispeed immediately, version swap for the pitch)

Status: **partly superseded (2026-10-08):** the version swap (slice 2, `deck_keylock.ts`, render and `/k/deck/basis_tausch` from the page) was dismantled with keylock task 3; the pitch is now held by the Dehner in the core (plan `docs/superpowers/plans/2026-10-06-keylock-echtzeit.md`, version 4; ADR 029 comes with task 4). Varispeed (slice 1) still applies, with keylock off. `/k/deck/basis_tausch` and `werkstatt.fassung` remain as tools.
Earlier status: slice 1 (varispeed) and slice 2 (version swap) implemented 2026-10-06; accepted at the target; listening session 06.10.: Andreas "yes, that fits" (varispeed up, on the swap back to the original pitch) (Cypher).
Trigger: Andreas 05.10.: "we also made live tempo changes" (park item `e65c5c17`), 06.10.: "grand piano done, then wave 3 with writing-plans please". Plan: `docs/superpowers/plans/2026-10-06-welle3-beatmatch.md`.

## Context

Up to wave 2 the core rejected a tempo change as long as a deck was running (`kern.cpp`, acknowledgement 6 `kein_stretcher`), and a deck started only at its base (`kern_deck.cpp`). Measured 06.10. on check instance i: `POST /tempo 132` with a running deck → `{"status":6,"grund":"kein_stretcher"}` (`~/messungen/2026-10-06-welle3-beatmatch/`). Loop boxes, REC and Strudel have followed the tempo since ADR 026/027, the decks have not. The ROADMAP foresaw Rubber Band R3 in the real-time path per deck for this (slices 34, 50 to 52); before that lie four open slices, and the real-time measurement series M3 (slice 30) was paused on 25.09. at Andreas' objection ("you're blocking my computer").

## Decision

1. **Varispeed in the deck.** The deck knows the map of the core clock and holds the master beat of its anchor. Read head `kopf(s) = anker_f + (beat_at(s) − anker_b) · fpb`: a source beat remains a master beat (phase-locked, also in ramps), read with Catmull-Rom like the loop box (ADR 026). If the tempo stands at the base over the whole block, the deck reads integer as before (bit-identical). Switch direct → varispeed at the same position without blend; varispeed → direct on the next whole frame with the 128 blend (step back at most 0.5 frame). `deck.cpp`, `deck.h`.
2. **Start and ramp at any tempo.** Both `kein_stretcher` rejections fall away (core and mock). `/k/set/neu` remains rejected while a deck runs (`deck_laeuft`): a new time axis would break the beat anchor.
3. **Deadline and restart via beats.** `/e/frist` computes in varispeed via the beat anchor; the restart state already carried the anchor in beats (`anker_master_beat`) and now sets it directly (`setze_lauf_beat`).
4. **Pitch via version swap:** the workshop renders from the original a version at the target tempo (`werkstatt.fassung`, at most two extra tempi per track, nothing is deleted); the page copies it into the working set and sends `/k/deck/basis_tausch` (source `werkstatt`) to a bar one at the earliest one beat ahead, and never before the end of a running ramp (`deck_keylock.ts`). The core loads the version via the loader and swaps at the target beat with a 960-frame blend (the old head runs on in it with its varispeed step) at the same source beat; a loop is recalculated, the grid of the old version no longer applies. Afterwards the deck reads directly.

## Discarded

| Route | Why not | Source |
|---|---|---|
| R3 live in the deck now (slices 50 to 52) | four open preliminary stages; M3 paused at Andreas' objection; R3-fine in the 256-frame block up to 4458 µs against a 5333 µs budget with two instances | status 30, ADR 027 "Discarded" |
| Decks still only at their base | does not answer the first DJ question | Glanz programme wave 3 |

## Consequences

- Until the swap, a deck's pitch drifts: 128 → 132 +0.53 semitones, 128 → 140 +1.55. The page shows `VARI +0,5 st` on the deck.
- Sound fidelity of the Catmull-Rom path calculated as in ADR 026, not heard. The old blend (128 frames) keeps reading integer in varispeed: at factor 1.03 it deviates over its length by about 4 frames (calculated, within the blend).
- Cost: in varispeed, per sample two `beat_at` calls and four frame reads per deck; real-time measurement in task 3 of the plan.

Measured values: plan section "Ergebnisse" (Results), raw data `~/messungen/2026-10-06-welle3-beatmatch/`.
