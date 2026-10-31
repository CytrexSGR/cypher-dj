# ADR 018: Farewell to the browser in the audio path

- **Status:** accepted
- **Date:** 2026-09-23
- **Requirements carried:** A25, A24, A3, A10
- **Related to:** ADR 001, 017, 019

## Context

Today's state plays through the conductor page in Chromium with superdough and worklets; the ongoing plan "hold pitch" (`docs/superpowers/plans/2026-09-23-tonhoehe-halten.md`) builds Rubber Band as a WASM worklet per orbit into it. A25 explicitly allows the route from the browser into an own app.

## Decision

The **browser leaves the audio path.** No sound, no clock, no scheduling any more in the browser. A browser page may later be **pure display**, reading only the Leitstand WebSocket (ADR 019). The plan "hold pitch" is a transition to listening and comparing, not a goal; its findings (keylock sound, double nodes) flow in as measurements. Today's services with `nohup` and PID files are replaced by units as soon as the new core takes over their role; until then they remain untouched.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| browser with its own Web Audio engine | deaths of the conductor page (three times on 2026-09-22), a renderer crash leaves the page considered open, a worklet once failed to load, the factor changed before the rate change, latency depends on the factor, Chromium is a Pulse client with its own buffer | 01 §3.8 |
| node-web-audio-api as core without browser | every worklet hangs on a JS thread: 669 dropouts in 60 s with an empty worklet, in the re-check 1 539 (the number depends on external load, confirmed qualitatively; the render thread ran without real-time priority), 0 without worklet | 01 §3.4, test b3, 01 NP (b real-time, point 5) |
| Rubber Band as WASM in the worklet permanently | needs four add-ons (M/S, HeapArray patch against failure after about 271 factor changes, idle node, cosine blend); natively these fall away | RESULT §1, §8 |

## Consequences

- The switch is a rebuild of the audio path, not a rework; the slices in ARCHITECTURE §9.2 build it.
- All Web Audio-specific knowledge (worklet patches) is no longer maintained.
- node-web-audio-api remains useful for offline rendering in the workbench, but only on a quiet machine: the "235-fold real time" (01 §3.4) ran at about 3 under load; at load 27 it came back again at 2.5-fold, WASM at 1.8 to 2.2-fold (01 NP K7).

## Evidence

01 §3.4, §3.8, test b; RESULT §1, §4, §8; `docs/zwei-decks.md` (the conductor survives the death of its page).

## Overturned if

Never for the audio path; for the display, ADR 019 decides.
