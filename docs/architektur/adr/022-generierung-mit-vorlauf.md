# ADR 022: Generating fresh songs with lead time

- **Status:** provisional, measurement M14 (end to end) pending
- **Date:** 2026-09-23
- **Requirements carried:** A2, A13, A19
- **Related to:** ADR 011, 013, 015

## Context

A2: "if we generate songs in parallel, I want to be able to split them during operation with you and fold them smoothly
into a running set." All three drafts left the generation time unmeasured and worried about the graphics memory of the
DJ machine (12 282 MiB, up to 11 218 occupied by others). What they had not read: MiniMax Music 3 runs on the GPU machine
(ComfyUI instance `:8288`, GB10 with shared memory). There a run now costs 4.7 to 7.2 s of compute time per second of
music (spread due to 28 services running in parallel), model loading 65 to 80 s warm and 284 s cold; a rented L40S
manages 1.35-fold real time. These are operating findings from the skill `cypher-musik` respectively
`cypher-musik-mietgpu`, there explicitly not stated as hardware findings and not measured again today.

## Decision

1. **Generation on the GPU machine** via ComfyUI (MiniMax Music 3), triggered by the workshop (`auftrag` type
   `generieren`); result via HTTP to the DJ machine, then the workshop chain (ADR 011). The DJ machine's GPU remains for
   stems. Address and workflow in the workshop configuration; prompt form per skill `cypher-musik` (duration 40 to 50 %
   above the target length, text for the full length, target BPM close to the set base). **Whether MiniMax hits a
   target BPM is unmeasured** (M14 measures BPM fidelity against the prompt); the skill advises against exact BPMs
   (line 59), and the ten existing songs lie at 89.9 to 180.7 BPM (c_drift.log), i.e. stretch factors 0.71 to 1.42
   relative to the base 128.
2. **The crate is a queue with lead time.** "Generating during the set" means: order when a song is needed in about 15
   to 30 minutes (generation 14 to 22 min of computing plus loading for 3 minutes of music, workshop computed 1 to 5
   min). The control station shows the expected completion time in bars for each order; Cypher (tool `erzeuge`,
   autonomy from level 1 allowed because nothing becomes audible) or Andreas order.
3. **Several seeds in one process** (load the model only once) when more than one song is ordered.
4. **Rented GPU** as an option if Andreas wants faster songs in the set (1.35-fold real time: a 3-minute song about
   4 min); cost and setup are his decision (skill `cypher-musik-mietgpu`).
5. The GPU machine is shared; parallel use by other waves is coordinated via the wave coordination (Wellen-Koordination),
   not in the set.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Generation on the DJ machine's GPU | 12 GB graphics memory, with training running about 1 GB free; not today's MiniMax path | research §3c; 10 §3a |
| planning "live" as a second-level cadence | generation takes minutes; the set would wait | Skill `cypher-musik` |
| ACE-Step Turbo instead of MiniMax | under 10 s per song (vendor figure), but a different model, sound unchecked | research §3c |

## Consequences

- A2 is carried with lead time, not with seconds; that is how it stands in the summary.
- M14 measures the whole chain with a free and a busy GPU machine and writes the figure into the crate planning.
- Songs that trip a workshop gate (weak pulse, grid, stretch factor over ±15 %) go only to Andreas (ADR 011); of the ten existing MiniMax songs, according to c_drift, eight would hit the pulse clarity and seven the stretch factor (calculated). If MiniMax does not hit the target BPM, A2 stays thin for Cypher until M14 and M19 clarify it.

## Evidence

Skill `cypher-musik` (internal), section "The numbers you plan with" (sixfold real time, 4.7 to 7.2 s per second of music, model loading 65 to 80 s warm, 284 s cold, 28 services on one GPU) and section on the ComfyUI instance `GPU-Maschine:8288`; skill `cypher-musik-mietgpu` (internal), line 8 (GPU machine 7.0-fold, L40S 1.35-fold real time); research §3c; 07 `c_drift.log` (pulse clarity).

## Overturned if

M14 shows clearly shorter or longer times (then adjust the lead time), or Andreas wants generation at a per-second cadence (then a different model, own check).
