# ADR 017: Role of Strudel

- **Status:** accepted
- **Date:** 2026-09-23
- **Requirements carried:** A22, A21, A25
- **Related to:** ADR 010, 018

## Context

So far Strudel was the heart in the browser: patterns, scheduling (Cyclist, `cps` as clock) and sound (superdough).
Andreas asked: "isn't the core really the fast music, or MIDI note generation, right?" (A22). Measured 2026-09-22: the
Strudel core runs in Node without a browser, 1 000 bars, 7 000 events, 44 ms.

## Decision

Strudel remains **the function "pattern to events"**: `@strudel/core` and `@strudel/mini` 1.2.6, only
`pattern.queryArc(a, b)`, in the generator unit (ADR 010). No more: Strudel's scheduler (Cyclist), Strudel's clock
(`cps`), superdough as sound, the browser as runtime. One cycle is one bar; beat = 4 · cycle. The mini notation is the
content language in the play sheet (Spielzettel). Strudel is used unchanged as its own process (AGPL, no fork to pass on).

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Strudel as scheduler (Cyclist) | 0.1 s latency, preview about 0.2 s, `setPattern` replaces immediately without grid | 06 §3.1 (`cyclist.mjs:17`, `:123-124`) |
| `cps` as clock | falls away with the browser; knows no ramp in the core | 02 §3.1 E |
| Strudel's `stretch` as keylock | 110 Hz probe stays at 105.5 Hz | 00-anforderungen §10 |
| pattrns (Renoise) as a second pattern language | second language without gain, "experimental" | 06 §3.1 |

## Consequences

- Patterns that Andreas or Cypher write in the play sheet sound through core channels (SunVox host, pads, later plugins), with channel strip and listening pass.
- Strudel's OSC path (WebSocket to a helper server with wall-clock timestamp) is not used.

## Evidence

06 §3.1, check a (query per two-bar window median 146 µs), §4.3; 02 §3.1; A22 with measurement of 2026-09-22 (00-anforderungen §7).

## Overturned if

Never in principle; only the mini notation as content language could change, if Cypher writes it poorly in the play sheet (measurement in the plan of slice 7).
