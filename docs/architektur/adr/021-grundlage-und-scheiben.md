# ADR 021: Basis of the synthesis and order of the slices (Scheiben)

- **Status:** accepted
- **Date:** 2026-09-23
- **Requirements carried:** A1, A2, A3, A13, A26
- **Related to:** all; ARCHITEKTUR §1, §9

## Context

Three drafts (Robustheit, Spielbarkeit, KI-Mitspiel) were rated by three judges. They contradict each other:
judge 1 picks "AI" as the winner, judge 2 "Play" as the basis (from a DJ point of view, with its own total just behind AI),
judge 3 "Robust" as the substructure (live safety and feasibility weighted twice). The weighted totals of all three
judges put "AI" in front: 70.75 / 69 / 68.25 against "Robust" 67.5 / 68.25 / 66.75 and "Play" 62 / 64.75 / 64.25. The
three drafts propose different first slices: "AI" the whole AI loop silent, "Play" Andreas' two decks, "Robust" one deck
that does not fall silent. The judges name common weaknesses: the core rests on unchecked dossiers (01, 03); R3 in
working threads has nowhere been measured in real time; the workshop data is outdated (eighth MiniMax song); end-to-end
generation is unmeasured; the choice was measured only as text; no listening session is scheduled; no cut list; effort
estimates are uncalibrated.

## Decision

1. **The basis is "AI co-play first"**, because it has the highest weighted total with all three judges and carries the
   core goal A1/A2/A13 and the doubly weighted A4 most precisely. The adoption lists of the three judges coincide:
   **core and operation from "Robust", deck and hand from "Play", AI layer from "AI"**. Thus the result does not depend
   on the choice of the basis, only the order of the slices.
2. **Order of the slices** (ARCHITEKTUR §9.2):
   - **Slice 0, preconditions (silent, in parallel):** M3 (R3 in working threads as a JACK client), M13 (grid of the
     MiniMax songs, also `sofa-abend`), M15 (choice as a tool call, 30 min simulation), M2 (seam), M10 if quiet, M14 when
     the GPU machine is free, M1 as soon as device and yes are there. Reason: judge 3 ("nobody makes the deck real-time
     test a precondition"), judges 1 and 2 (grid, choice, generation unmeasured).
   - **Slice 1, three work items in parallel after a short shared lead-in:** first **V0** (one owner, roughly half a
     session day): test reference prototypes into the repo, `djk/third_party/`, machine-readable contract `djk/vertrag/`
     with golden sequences, test hand input and ring mock (`SCHNITTSTELLEN.md` §19.0). Then core (with Notbahn (the
     fallback path), direct-path decks, chaos test rig v1), Leitstand with MCP and player against a **core mock**, and
     the workshop chain v1. Reason: parallelism is Andreas' engine; the contract makes it possible, but only if there is
     exactly one machine-readable truth (two sessions that each generate `djk/vertrag/` themselves deliver two).
   - **Slice 2:** Cypher chooses, the code computes, silent, with the attack cases from 09 NP as regression.
   - **Slice 3, hand and ear:** controller, interface (M1), Andreas plays alone, **listening session M18** before the
     expensive keylock parts are built. Reason: judge 2 ("the largest unmeasured quantity is Andreas' ear and hand") and
     the common weakness "no listening session".
   - **Slice 4, first shared tone at a fixed 128 on the direct path**, with a song ordered at the start of the set that
     comes through the workshop during the set. Reason: the direct path needs no stretcher (ADR 020), so the shared tone
     becomes independent of the riskiest building block; A2 is carried before keylock live (judges 1 and 2: A2 came too
     late in all drafts).
   - **Slice 5:** tempo and keylock live. Then workshop in the set (6), own track (7), plugins (8), outside world and
     surface (9).
3. **Cut list** per slice (ARCHITEKTUR §9.3); never cut: invariants I1 to I3, deadline guard, listening-certificate
   requirement, stop key, Notbahn.
4. **Effort** in session days (one session, one working day), estimate, uncalibrated; critical path up to slice 4
   roughly 16.5 session days with three parallel sessions, V0 included (calculated from ARCHITEKTUR §8.1).

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| "Play" as the basis, Andreas' decks first | most expensive route to the shared tone (roughly 30 session days), many unmeasured innovations in the real-time path; its advantage (early ear) is taken over here by slice 3 | judges 1, 3 |
| "Robust" as the basis, robustness first | A2/A13 only after the shared tone, second half of A12 missing, AI co-play thin; its strengths (test rig, no foreign code) are taken over | judges 1, 2 |
| "AI" slices unchanged | slice 3 there bundles interface, R3 in threads, ramps, Notbahn, units, recording, hardware in 6 days (optimistic); Andreas hears late | judges 1, 3 |
| Keylock live before the shared tone | makes the shared tone depend on the unmeasured R3 real-time path | ADR 020, M3 |

## Consequences

- Up to slice 5 the set runs at a fixed tempo (base 128 or another fixed base); A9 is until then carried only as "one
  fixed set tempo" and noted that way in the journal.
- The core mock is a work item of its own: it speaks the contract, simulates clock and receipts, without sound.
- The listening session needs Andreas' time and yes (question 3 in ARCHITEKTUR §13).
- **Secure the reference prototypes before the start:** no file under `proben/` is in git (measured 2026-09-23: `git ls-files proben`
  → 0, `du -sh proben` 18 GB); `vendor/` in 03 and 04 is excluded via `.gitignore`, `*.log` via the root `.gitignore`
  (the evidence logs such as `c_drift.log` need an exception). A session in a worktree or a fresh clone would see
  neither prototypes nor evidence. V0 commits code and result files of the tests (without WAV, venv, vendor, raw
  recordings); the plans name prototypes only with a repo path.
- **Acceptances measurable:** every acceptance names load profile, duration, quantum, external-load log and repetition
  rule (ARCHITEKTUR §9.2); runs under external load count as provisional and are repeated in M10.

## Evidence

Judge ratings (totals, winner rationales, adoption lists, common weaknesses), passed along in the synthesis order;
drafts `entwuerfe/entwurf-ki.md` §5, `entwurf-robust.md` §5, `entwurf-spiel.md` §5; ADR 020.

## Reverse if

M3 fails (then keylock live later; the direct path still carries slice 4), M13 fails (then grid by hand as a
requirement in slice 4), or Andreas wants a different order (his direction).
