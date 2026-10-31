# ADR 030: Production in the core (arrangement, track mixer, instruments, offline export)

Status: accepted 2026-10-15 (Cypher, architecture assignment from Andreas). Implementation: vertical slice D1 (Durchstich), packages S1 to S3, K1 to K3, V1, V2.
Full text of the decisions and interfaces: `docs/masterplan/D1-SPEC.md`, sections 2 and 3.

## Context

cypher-dj is meant to become a production environment (masterplan wave 1). The core knows decks, loop boxes, generators and a
DJ mixer with 18 fixed channels, but no transport, no tracks, no pan/mute/solo and no export. The survey of 15.10. (u1 to u6) and the adversarial review of the spec (2 BLOCKER, 20 MAJOR) are the basis.

## Decision

1. The page server owns the project (folder with `project.json`, `undo.jsonl`); the core plays a playback,
   which it loads via its own load thread and swaps via pointer handover.
2. New core module `Arrangement` with its own transport on the one clock, without `/k/set/neu`, without JACK transport.
3. Own track mixer in the module (8 tracks, control roles on channel −1); the sum goes to the channel `erz/4`
   reserved for production. The DJ mixer stays unchanged.
4. RB-338 runs as FFI in the core; foreign instruments in the Carla host, in their own slots with a lead-in (Vorhalt).
5. Export as offline render of the same core (`cypherdj-render`) with the control state of the running core;
   host tracks are frozen in real time beforehand. JACK freewheel rejected for D1.
6. No OSC field carries a path; files lie in the working folder per instance.

## Consequences

Production does not touch the DJ path as long as `erz/4` is neutral. Production channel strips (inserts, sends,
groups) grow in the module, not in the DJ mixer. More than 8 tracks, automation and warp need later packages.
Project bar equal to DJ bar only with bar quantization.
