# ADR 003: Audio connection and block size

- **Status:** provisional, measurement M1 (interface) outstanding
- **Date:** 2026-09-23
- **Requirements carried:** A4, A20, A26
- **Related to:** ADR 004, 008, 016

## Context

PipeWire 1.6.8 runs on the DJ machine with the standard quantum 1024 (10 §3a). Andreas' interface is unknown (A26);
all real-time figures come from a null sink that itself clocks per `CLOCK_MONOTONIC` (02 NP K6, 10 NP K8), under
external load of 19 to 70. The drafts contradict each other: "playability" wants 128 as the playing target,
"robustness" and "AI" want 256 as the standard.

## Decision

- **JACK API under `pw-jack`**, 48 kHz. The core connects its ports itself using JACK names, never automatically.
- **Quantum 256 (5.33 ms) is the set standard.** 128 becomes the standard only once M1 on the real interface shows
  no frame gap at 128 for 60 min with the workshop running.
- **One interface is the only driver of the DJ nodes** (one crystal clock); master (1/2) and cue (3/4) on the same
  device. Desktop sound stays on the onboard output. Core and Notbahn set `node.lock-quantum = true`; only the core
  unit sets the quantum; telemetry reports every buffer change (`/e/quantum`).
- If the interface has only two outputs: **split headphones** (left cue mono, right master mono, Mixxx pattern) as
  the emergency route until a device with four outputs is there.
- **Stem separation during a set** (one rule for all documents, ADR 011, `INTERFACES.md` §12.3): on the CPU only
  at quantum 256, as a workshop job with `Nice=19`, `CPUSchedulingPolicy=batch` and limited threads (10 NP N6: 15%
  of the 256 period, 0 gaps; at 128: 55%), never at 128; on the GPU only once Andreas has answered the question
  "GPU free during a set?" (ARCHITECTURE §13 question 4) and M9 has measured job start and end.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| 128 as standard | real stem separation on the CPU drove the wake-up at 128 to 55% of the period (at 256: 15%); under memory saturation at 128 up to 85% and 1 to 2 dropouts in 337 605 cycles; the "0 dropouts at 256" are statistically empty, 256 rests on its margin to the period | 10 NP N6, K2, test b L1/L7 |
| native PipeWire API (`pw_filter`) | later option, if node properties should be set directly; unverified | 01 §3.2 |
| cue on a second device | second clock, adaptive resampling | 02 NP K8 |
| JACK2 server instead of PipeWire | would rebuild Andreas' desktop audio; not checked | assumption |

## Consequences

- Latency heard by ear at 256 with soft Notbahn calculated at least 22.3 ms from grab to converter, at 128 at least
  11.7 ms (ARCHITECTURE §6). Whether that matters, Andreas decides in the listening session (M18).
- A foreign client with `node.force-quantum` on the same driver can overturn the quantum ("The last node to be
  activated with this property wins", `man pipewire-props`); hence an own interface for the DJ nodes.
- Kernel and boot stay as they are; the reserve option is Ubuntu's `lowlatency-kernel` plus `threadirqs`, only after
  M1 and with Andreas' yes (10 §3c, question 2).

## Evidence

10 test b (R1: 128 under GPU training 600 s, 0 gaps, wake-up max 304 µs; L3: 256 under memory saturation max
1 609 µs = 30%), NP N6, K2, risk 2; 01 §3.2 (pitfall: port name `cypher-stumm-probe`); 04 §3.1 (split).

## Reversed if

M1 shows gaps at 256 on the interface (then kernel reserve with Andreas' yes, fewer keylock decks, workshop
throttled during the set) or holds 128 stable (then 128 as standard, latency halved).
