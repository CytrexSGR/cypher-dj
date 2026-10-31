# ADR 009: Plugins outside the core

- **Status:** provisional, measurement M7 (host decoupling via `node.async`) pending; plugins at the earliest in slice 8
- **Date:** 2026-09-23
- **Requirements carried:** A18, A17, A21, A23
- **Related to:** ADR 001, 010, 016

## Context

A18 wants plugins as an interface to instruments and effects. 05 §1 recommends deck effects as CLAP/LV2 **in** the core; 10 §5 allows third-party code only in parallel on sends; 10 NP K5 says this contradicts A18/A21 and proposes decoupled return paths. The drafts "AI" and "Play" allow vetted CLAP/LV2 in the core later, "Robustness" never; judges 1 and 2 recommend "no third-party code in the core until a vetted list passes the chaos test bench".

## Decision

1. **No `dlopen` in the core.** Deck effects are own code (Faust-generated or C++); vetted source code under a free license that is statically compiled in (for example an Airwindows effect, MIT) counts as own code.
2. **Plugin hosts** per group as their own units `cypherdj-wirt@<gruppe>`: Carla 2.5.8 as a library (C API), own `HOME` and `XDG_*`, own Xvfb display, Carla's OSC off, control via a Unix socket, local only; return paths as their own JACK client with **`node.async = true`** and a **pulse port** as a sign of life.
3. **Timing comes from the core:** notes and parameters on the beat only as JACK MIDI with sample offset (CC via `set_parameter_mapped_control_index`); OSC never for time-critical matters.
4. **Latency per slot** is measured through at loading by click and read again after the first block; the core holds events back by the latency of the return path plus one block (async).
5. Allowed: instrument, send effect, and as a **fail-safe insert** (the core keeps the dry path ready at the same time and fades back when the pulse stops, hypothesis, M7). Never in series before the master.
6. A list of vetted plugins in the core is a later ADR, at the earliest when it passes the chaos test bench.
7. NI plugins via yabridge only on Andreas' request per instrument (05 question 1); without UI.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| CLAP/LV2 in the core | one address space: a plugin crash takes the whole music down with it; a hang in the Carla process produced no cycle for over 6 s | 01 §6.1, 05 §4.5 |
| Carla bridge per plugin | isolates the process, not the timing: whole graph silent for 1 024 ms (hard-wired wait time) | 05 §4.5, `CarlaPluginBridge.cpp` line 2000 |
| Plugin host synchronous on the graph | a hanging node in series stops everything behind it | 10 test c (edge Notbahn (fallback path) 181 to 213 ms silence) |
| only in parallel directly to the sink | bypasses mixer, limiter and Notbahn; contradicts A21 | 10 NP K5 |
| PipeWire filter-chain | does not report latency (ProcessLatency 0 with 480 samples of delay), no event path | 05 §3.1 |
| OSC to Carla for parameters | 1.67 to 37.58 ms scatter; Carla's OSC listens on 0.0.0.0 | 05 §4.4, §4.1 |

## Consequences

- Every host return path costs one block of latency (async), compensated by holding back events.
- Send effects from hosts come back via `fx/3` and `fx/4` (sends 3 and 4 per channel, `INTERFACES.md` §1.5); the mixer is an assignment table, so that host return paths can be added without rework (A17).
- Open and decisive: what a dead or hanging async predecessor delivers (old block or silence), and the contradiction between 05 §4.5 (a hang in the process freezes the driver cycle) and 10 NP N3 (a parallel hang does not hold it up). If M7 turns out badly, plugins stay out of the mix until Carla is built with a short bridge wait time.
- Plugins write into foreign folders (Dexed 34 files, Surge folders, 05 §4.3): own `HOME` is mandatory.

## Evidence

05 §3.1, §4.1, §4.2 (reported 480/64/240 = measured, but not passed on; x42 without atom ports does not process at all), §4.4 (MIDI-CC 0 to 3 samples, 28 of 28), §4.5; 10 NP N9 (`node.async`: hang 0 ms silence in 4 of 4, latency exactly one block), K5, N3; Bitwig manual "Individually" (10 §3b). Dossier 05 unverified.

## Overturned if

M7 shows that a hanging host still halts the driver despite `node.async` (then no plugins in the set until a Carla rebuild), or that the pulse does not reliably detect the dead return path.

## Correction 2026-10-11 (RB-338 W1, test `~/messungen/2026-10-11-rb338-probe/BERICHT.md`, status `stand/rb338-w1.md`)

Measured or read in the code, deviating from the text above (the text above remains as the decision status of 2026-09-23):

- **Status:** The hosts run in operation (Surge XT, SFZ-Flügel (grand piano), since RB-338 W1 also an own VST3). M7 (host decoupling) has not been made up as a separate measurement in operation; `node.async` is set in the unit.
- **No. 2:** The units are transient (`systemd-run`, `cypherdj-wirt-<gruppe>[-<i>]`), not a template `cypherdj-wirt@<gruppe>`. There is **no Xvfb**; Carla runs headless without DISPLAY (VST3 too). The return path is the host client itself (`audio-out1/2` → `rueck_erz_<n>_L/R` in the core). A **pulse port does not exist**, neither in the host nor in the core.
- **No. 3:** CC via `set_parameter_mapped_control_index` is not used in the code. For nih-plug VST3, raw CC/pitch bend do not reach the plugin via Carla (`IMidiMapping`); the Carla mapping takes effect, W1 goes the way via the host command `param`.
- **No. 4:** Instead of latency per slot, the core reserves in advance (`2·n + 25` samples, `kern.cpp:252`).
- **Addendum:** VST3 is the only way for own (nih-plug) instruments: Carla 2.5.8 does not load CLAP, nih-plug does not build LV2.
