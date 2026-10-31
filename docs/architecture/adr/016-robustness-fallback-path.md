# ADR 016: Robustness, Notbahn (fallback path), watchdog, chaos test bench

- **Status:** provisional; M2 measured, Notbahn alongside (addendum 2026-09-25); M11 (watchdog policy) and M10 (quiet machine) pending
- **Date:** 2026-09-23
- **Requirements carried:** A1, A3, A20
- **Related to:** ADR 001, 003, 015

## Context

"Live must never fall silent." Measured: a mini core as a systemd unit with `RestartSec=0` plays again after `kill -9` after 38.7 ms (10 test c). A Notbahn over shared memory prevents silence on crash and hang, a Notbahn via a graph edge only on crash. The re-check shows: the Notbahn prevents silence, not the click (13 of 14 takeovers with a jump; with music 47% audibly bright, with a crossfade 11%). The JACK xrun callback is blind. The drafts argue about blend (two blocks) versus latency (one block or parallel).

## Decision

1. **systemd user units** under `cypherdj.target`. Core and Notbahn: `Type=notify`, `Restart=always`, `RestartSec=0`, `StartLimitIntervalSec=0`, `WatchdogSec=200ms`, `WatchdogSignal=SIGKILL`, `RestartSteps=5` with `RestartMaxDelaySec=2s` against crash loops (values set; systemd 255 supports it, effect unverified, M11). Satellites: `Restart=always`, workshop `Restart=on-failure`.
2. **`WATCHDOG=1` only on real-time progress** (the core counter rises). The telemetry distinguishes "core hangs" from "core waits for a predecessor" (10 NP K5), as soon as host return paths exist (M11).
3. **Notbahn via the shared-memory ring** `/dev/shm/cypherdj/bus` (master and cue), reads one block offset; the sign of life is the progress of the write counter. On stall: loop the last bar **with a crossfade at the seam** (default: one more block, together two blocks of latency), at most 8 bars, then fade out over 2 bars and report `/nb` (LED, Leitstand); return to the core with a crossfade. NaN/DC/clip guard. **The bar length comes from the ring:** the core writes per cycle `takt_frames` (length of the last completed master bar) and `takt_anfang_w` into the ring head (`INTERFACES.md` §6.1); the Notbahn loops back by exactly `takt_frames`, from its **own history** of at least 384 000 frames per channel (2 bars at 60 BPM; the ring itself holds only 65 536 frames, less than one bar at 128). The template took the bar from a fixed `--bpm 128` at start (`notbahn.c` line 77, 96); that was wrong for any other set base and in ramps. **Ports** the Notbahn receives as call parameters from its unit (`ExecStart`), not from `kern.toml` (no TOML parser in C on the DJ machine), and it connects only after the **guard** against unsolicited sound (positive list `stumm`, `cypherdj-pruef-*`; the real interface only with `--ton-frei` after Andreas' release; `notbahn.c` line 90 as template, `INTERFACES.md` §8).
4. **State for the restart** in the seqlock `/dev/shm/cypherdj/zustand`: anchor, tempo map, decks (material, version, anchor, loop, hot cues, listening path), controls with holder, pending commands with status, and the **subscribers**. The new core continues on the grid, announces `/e/neustart` at once to all stored subscribers, and sends each one who re-registers `/e/neustart` and `/q/stand` per open command (`INTERFACES.md` §4.1, §5.1); without the list, `/e/neustart` would reach nobody until the next heartbeat (up to 2 s). The new core sets up stretchers in the loading thread and runs them through once before the callback gets them (01 NP K3, ADR 006).
5. **Own counting:** frame gaps and skipped periods are counted by the core itself; callback histogram; the wake-up measure is not an early warning.
6. **Chaos test bench** (`djk/pruefstand/`) is the acceptance of **every** slice: own null sink per run, JACK recorder at the target, seam meter, load generator (memory streaming, HTDemucs on the CPU, workshop), `kill -9` and hang (SIGSTOP, endless loop in the callback) on every unit, endurance run, report with the commitments from ARCHITECTURE §7. Done means: failure case before, measurement after, negative control.
7. **The kernel stays** as it is; reserve `lowlatency-kernel` plus `threadirqs` only after M1 and with Andreas' yes.
8. **No second core as a hot spare** for now.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| no Notbahn | silence at every crash (29.4 to 48 ms) and at every hang until the watchdog | 10 test c |
| Notbahn via graph edge | if the core hangs, it holds the Notbahn back behind it: 181 to 216 ms silence | 10 test c, NP |
| Notbahn without blend (one block) | 47% of takeovers with real music audibly bright | 10 NP N2 |
| Notbahn via `node.async` instead of the ring | measured equally well (0 ms in 4 of 4 hangs, one block); the ring is own code with an explicit sign of life and already evidenced in three test runs | 10 NP N9, test c |
| Notbahn in parallel at the driver (without extra block) | unmeasured: does a hanging core deliver silence or old blocks? | M2b |
| second core as hot spare | double computing load, stateful stretchers drift apart | 10 §3c (hypothesis there) |
| JACK xrun callback as watchdog | blind to overruns of the own client | 01 §4.2, 10 test b, `pipewire-jack.c` line 2070 to 2073 |
| `RestartSec` default 100 ms | gap 149.4 instead of 42.7 ms | 10 test c |

## Consequences

- Latency: the soft Notbahn costs two blocks (at 256: 10.7 ms); without blend, one block, but then it clicks only in the crash case. Decision at the listening session (question 3 in ARCHITECTURE §13).
- The bar loop is audible; the 8-bar upper limit is set, not heard.
- PipeWire restart is unverified (it interrupts Andreas' desktop sound and needs his yes).

## Evidence

10 test c (`RestartSec=0`: first block 38.7 ms, NP 39.9; shared-memory Notbahn 0 ms silence in 5 of 5 and 4 of 4, NP 5 of 5 and 2 of 2; latency 255.88 against 127.83 samples; watchdog 190.7 to 214.5 ms; grid ≤ 0.2 samples, NP ≤ 0.95), test b (K1b: 44 gaps, 0 xrun callbacks), NP K1, N1 (13 of 14 with jump), N2 (47% → 11%), N3, N8, N9, K4, K5, K7; 01 §4.2, test e3; `proben/10-robustheit-betrieb/src/notbahn.c` (switching without blend, only the return path blends).

## Overturned if

M2 shows that the blend is not click-free online (then a longer blend or another loop length); the golden sequences `notbahn_124` and `notbahn_rampe` show a return next to the grid (then the loop from `takt_anfang_w` instead of from the stall point); M2b shows that a parallel Notbahn at the driver gets silence instead of old blocks (then one block less latency); M11 shows false watchdog deaths.

## Addendum 2026-09-25: Notbahn alongside (M2 measured, question 3 answered)

`(A, 2026-09-25: „ok daneben")` on the numbers from M2 (`messungen/M02-notbahn-naht/BERICHT.md`, slice 06): in series with 1 block of blend, every grab costs 512 samples (10.7 ms) more than the direct path; alongside, a crash costs one block of silence with a click, and every return costs 512 to 768 samples of doubled sound, without extra latency (click 255.92 against 255.63 samples direct). A hanging core delivers silence at the driver, not old blocks; alongside it holds up (9 of 9, exactly one block each).

Decision changed: **the Notbahn sits alongside at the driver**, not in series. Slice 10 builds alongside; the requirement "soft Notbahn" lapses until the listening session. The takeover blend from M2 (E2, 1 block) applies only to the in-series path and is therefore no longer a build requirement. The listening test at the listening session (slice 46) remains: if the click tips for Andreas' ear, it goes back to series with 1 block of blend (measured, holds up).

## Addendum 2026-10-29: edge reversed (--vor instead of --kante)

The edge from the core output to the Notbahn input (addendum 2026-09-25, order core first) made the Notbahn a dependent of the core. After kill -9 it waited until the kernel had cleared the address space of the dead core (exit_mm before exit_files): 2.5 ms on 26.09., 20 ms on 29.10. with 322 MB of locked memory, i.e. 3 blocks of silence instead of 1 (control run +300 MB: 5 blocks). Since then the Notbahn connects its never-written output `vor` to the never-read core input `notbahn_vor`. It always runs before the core, sees w of the previous cycle, and one cycle of stall suffices (without the edge, two would be needed). Measured kill x20: silence 256 samples in 20/20, all bounds of the series green; with +300 MB ballast likewise 256. The same path resolves the finding sigstop-kern 2026-09-26 (Notbahn waited for the hanging core). Evidence: ~/messungen/2026-10-29-neustart/STILLE.md.
