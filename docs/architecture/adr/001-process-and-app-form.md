# ADR 001: Process form and app form

- **Status:** accepted
- **Date:** 2026-09-23
- **Requirements carried:** A1, A3, A17, A23, A24, A25
- **Related to:** ADR 002, 016, 018, 019

## Context

Today the DJ part runs in the browser (Dirigent page, superdough) and as loose Python and Node services with
`nohup` and PID files (`dirigent.pid`, `battery_server.pid`, `pegel.pid`, `vox_server.pid`, 10 §3a). The
Dirigent page died three times on 2026-09-22, and one worklet module once failed to load (01 §3.8). A25 allows
its own app, A24 puts the interface back, A17 demands a modular core with routing.

## Decision

A **real-time core** (`cypherdj-kern`, C++) is the only process that computes in time. Behind it sits a
tiny **Notbahn (the fallback path)** (`cypherdj-notbahn`, C). Everything else is a **satellite** in its own process:
control station (Leitstand), player (Cypher), MCP adapter, Rechner (planner), analysis, Werkstatt (workshop), recording, later splitter (Zerleger), generator (Erzeuger),
sound and plugin hosts (Klang- und Plugin-Wirte), Link bridge, front end (Oberfläche). Each process is a **systemd user unit** under
`cypherdj.target`. "The app" in the sense of A25 is this network, started with
`systemctl --user start cypherdj.target`, without a window.

Satellites talk to the core only through commands with a target beat (OSC/UDP), finished files and decoupled
audio return paths (`INTERFACES.md` §2). If a satellite dies, at most its share is missing.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| One large program (JUCE app with GUI, plugin host, engine) | one address space: a crash of a plugin or the GUI takes the music with it; JUCE brings AGPL and a GUI chain with no benefit for a service without a window | 01 §3.7, §6.1; 05 §4.5 |
| Mixxx as deck engine, AI alongside | the clock then belongs to Mixxx, everything else runs behind it; Mixxx script timer at best every 20 ms; quantize does not wait for the bar | A14 (Andreas on Mixxx), 09 §3.3, research on loop jumping |
| Ardour as the heart | Andreas: "doesn't really feel good" | A14 |
| Browser stays as audio path | the page's death, worklet load failures, Chromium as Pulse client with its own buffer | 01 §3.8; ADR 018 |
| Own supervisor instead of systemd | one more component that can die | 10 §3c |

## Consequences

- Every boundary between processes is a contract: `INTERFACES.md` is mandatory for all sessions.
- Satellites can be built in parallel, the control station first against a core dummy (ADR 021).
- Operation needs units, limits (`LimitRTPRIO`, `LimitMEMLOCK`), watchdog rules (ADR 016).
- Today's `nohup` services are being replaced, not continued.

## Evidence

- 01 test e2: sender via SIGKILL, the core continued playing 51 of 51 beat intervals exactly.
- 01 test e1: second core via SIGKILL, the first one continued 63 of 63 beats exactly.
- 01 test b3: node-web-audio-api with an empty worklet 669 dropouts in 60 s, without worklet 0 (re-check: 1,539, the
  number depends on foreign load, the finding stands; 01 NP).
- 10 §5: unit cut; 10 test c: systemd starts a core with `RestartSec=0` in 38.7 ms until the first block.

## Breaks if

The process boundaries themselves produce dropouts (for example a hanging satellite stalls the driver): M7 checks this
for return paths, M11 for the watchdog.
