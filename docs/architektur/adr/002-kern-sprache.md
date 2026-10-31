# ADR 002: Language of the core

- **Status:** accepted; reasoning re-weighed after the re-check of dossier 01 (K5, K9) on 2026-09-23
- **Date:** 2026-09-23
- **Requirements carried:** A23
- **Related to:** ADR 001, 006, 016

## Context

The core computes clock, decks, keylock, mixer, Stellwerk (interlocking) RT and Messer (meter) in the real-time callback. The building blocks it needs are C or C++: Rubber Band, Bungee, libjack, libebur128, Faust output, later Ableton Link and lilv.
A23 allows an in-house build in C++ or Rust.

## Decision

- **Core in C++20**, built with CMake and Ninja (g++ 13.3 on the DJ machine). **Notbahn (the fallback path) and recording in C.**
- Real-time discipline is **mechanism, not intention**: no allocation, no lock, no I/O, no `dlopen`
  in the callback and in the stretcher worker threads; an allocation and lock guard in test operation (for example an
  `operator new` that counts in the real-time thread and aborts), long-running load tests in the chaos test rig as acceptance.
- Satellites: Leitstand (control room), MCP, player driver in Node/TypeScript; Rechner (planner), analysis, Werkstatt (workshop) in Python.
- Rust stays open for parts without C/C++ dependencies.
- **Why C++ nonetheless:** the measured reference prototypes of this night are C/C++ (`uhrkern.cpp`, `klick_kern.cpp`,
  `deckprobe.cpp`, `minikern.c`, `notbahn.c`), and Rubber Band has only a thin Rust bridge (crate 0.1.5, 120
  downloads). Weighed against this: memory errors are exactly the crash class that Rust excludes, and a
  core crash costs a Notbahn loop (01 NP K5). Compensation as a mechanism: an ASan/UBSan build in every test run
  of the test rig, plus the allocation and lock guard.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Rust for the core | equivalent in the callback; **not** rejected for lack of bridges (the reasoning "Link, lilv, Faust each need their own bridge" is wrong: `faust -lang rust` produces Rust, `rusty_link` 0.4.9, LV2 hosts `livi` 0.7.5 and `lilv` 0.2.4 exist; only Rubber Band has a thin bridge), but because all measured reference prototypes are C/C++ and the build is due tomorrow; memory safety favors Rust | 01 §3.3 (callback Rust 1.09 µs, C++ 0.77 µs on average; NP 1.17 / 0.77), 01 NP K5 |
| JavaScript in the real-time part (keep using the Stellwerk prototype) | worst block 7 053 µs = 132 % of the budget at 256, zero point without plan 14 507 µs | 09 NP b3 |
| Python in the real-time part | block analysis p99 15.2 ms at a 21.3 ms budget (1024), NP p99 17.3 ms | 08 §4.f |

## Consequences

- No compiler protection against real-time errors (01 §6.2 risk 3): the guard and the long-running tests are part of
  every acceptance, not optional.
- With Rubber Band the core is GPL-2.0-or-later; internally harmless, to be clarified on distribution (01 §6.2, ERGEBNIS §4).

## Evidence

01 §3.2 (callback mean 0.77 µs, maximum 6.9 µs at a 2 667 µs budget, 0 dropouts in 5 min at 128 and 256,
load 19 to 28; **classified per 01 NP point 2 and K9: the platform serves an almost empty FIFO callback
reliably, and says nothing about the load of a core**), §3.3, §6.2; 01 NP K5; 09 NP b3; 08 §4.f.

## Reverse if

The guard in test operation keeps finding violations that cannot be controlled in C++, or the test rig
shows memory errors in the core (ASan, crashes); then parts move to Rust with `assert_no_alloc` (01 §3.3, 01 NP K5).
