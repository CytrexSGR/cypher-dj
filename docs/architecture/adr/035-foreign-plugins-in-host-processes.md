# ADR 035: Foreign plugins in host processes, as insert stages and as instruments

Status: built on the branch `b1-plugins` (plan 1.11, tasks 1 to 17), 2026-11-10; not merged when this text was written. Andreas' listening acceptance is open (wave 1, sheet `docs/architecture/stand/hoerblatt/1.11-plugins.md`). Gate G2 and the instrument cells P9 to P11 are measured and in the stand file: G2 passed with a thin median reserve of 5.6 us (four host stages +6 to +8 us, rings +0.79 % against `main`, so no per-strip sizing), and the whole host path starts notes about 24 samples before the grid (a property that exists without 1.11, accepted for 1.11, follow-up task).
Decided: by Cypher as defaults in the plan `docs/superpowers/plans/2026-11-10-1.11-plugins.md` (D1 to D18); Andreas may override. The build started on Andreas' order of 2026-11-10 (plan asked for the same day; the recut spec is `docs/superpowers/specs/2026-11-02-1.11-plugins.md`).
Evidence: `docs/architecture/stand/plugins-1-11.md`. Interface text: `docs/architecture/INTERFACES.md` sections 1.5, 4.11, 5.13, 8 and 20.12.
Predecessors: ADR 009 (plugins outside the core; this ADR measures what ADR 009 left open and extends it from instruments to inserts), ADR 030 (production strips), ADR 033 (routing, production master, delay compensation).

## Context

Until 1.10 a foreign plugin could only be an instrument in the Carla host (`instrument_host.py --vst3`, `--lv2`). Every insert on a strip was one of our own native kinds (`komp`, `eq`, `saett`, `lim`), a closed enum with constant latency. ADR 009 decided that no third-party code is loaded into the core and that a plugin host runs as its own process on a `node.async` link, but it was marked provisional: it had never been measured what a hung or dead host delivers to the graph, and a host as an insert (a stage in series with the strip) did not exist.

Three things had to be decided before building: where the plugin lives (in the core, in a bridge thread, in its own process), how its latency joins the compensation that 1.10 built, and how a project that contains a foreign insert is exported, since the offline render has no host and the freeze taps in front of the chain.

## Decision

The final form of D1 to D18 (D-numbers are those of the plan; where the build deviated from the plan the deviation is named).

| # | Decision |
|---|---|
| D1 | One Carla process per plugin, out of process. At most `ARR_INS_HOST = 4` effect hosts at once. Instruments keep the 2 host slots of 1.9 (`ARR_WIRT_SLOTS`). The cap is a number, to be raised after the cost gate G2. |
| D2 | New insert kind `host` (`ArrInsArt::host = 5`), pool `ins/host/1..4`, one row per instance: `an`. No mapped parameter rows, no bridge thread. |
| D3 | Plugin parameters are set by the server on the host socket through its own route `POST /proj/insert/<insert_id>/param` (not a `proj_aendern` command: those are pure project changes with undo). No undo; the plugin state is the saved truth (D8). Bypass is the existing light command `insert_an`. Instruments have the same routes under `/proj/spur/<id>/geraet/`. |
| D4 | The latency of a host stage is structure: the playback file carries `latenz` (samples) per host stage, `ArrStufe::latenz`, and `ins_latenz` is a function of the stage. `latenz = round trip measured by the core at host start + latency declared by the plugin + latenz_extra`. A changed value is a new playback load. |
| D5 | `ARR_PDC_RING` 1024 to 8192 and a separate dry ring for host stages, `ARR_HOST_LAT_MAX = 8192` samples. A stage of 8192 samples or more is refused at load (`pdc_zu_lang`). The server takes such a stage out of the playback itself (`ausfall/latenz_zu_gross`). |
| D6 | Bypass keeps the latency. A host that is missing, dead or hung puts its stage on the delayed dry path with a 480-sample fade; the strip never jumps in time. The return fades back in only after 48000 samples (1 s) of continuous health. |
| D7 | Health has two sources, both outside the callback and one atomic per host: the core's own 500 ms edge check (the host's client, ports and four edges), and `/k/arr/ins_host <h> <0\|1>` from the server, which watches the host's heartbeat file. There is no stall rule inside the stage (measured, see below). |
| D8 | State lives in `<project>/plugins/<insert-id>.carxs`. The server saves it 2 s after the last `param` call, when a plugin window closes, every 30 s while one is open, before an export, on project close or switch and on server shutdown. Open never waits for a host. A state file of another plugin is refused (`zustand_passt_nicht`); a failed restore leaves the stage dry and the file untouched (`ausfall/zustand_fehler`, a `.bak` copy at every write). |
| D9 | The plugin's own window opens on the desktop through the host (`fenster`, Carla `show_custom_ui`), Andreas only. The generic parameter list stays next to it. |
| D10 | A project with at least one active host stage is exported in real time: the transport runs with a streaming capture of the production master post point. The offline render refuses a playback with an active host stage (`host_insert_echtzeit`), and the server chooses the path itself. A run in which a host stage was on the dry path or the core lost frames yields no file (`export_host_ausfall`, `export_luecke`). Host stages are therefore allowed on tracks, groups, returns and the production master. |
| D11 | Bounce of a track whose chain holds an active host stage is refused with `host_insert_echtzeit` and the hint to use resample, which already records behind the chain. Freeze stays as it is (source only). |
| D12 | Formats: VST3 and LV2 through Carla 2.5.8. CLAP is not hosted. Windows plugins come through yabridge, which turns them into Linux VST3 shells. |
| D13 | No sidechain into a foreign plugin (Carla rack mode has two audio inputs). Host stages are ordinary chain members. |
| D14 | Scan, rescan, unblock and the plugin window are Andreas' hand (`nur_andreas`). Cypher may list, insert, set parameters, bypass and remove plugins the index marks `ok`. |
| D15 | Foreign instruments reuse the instrument host path: `WirtGeraet.name = 'plugin'` in host slots 1 and 2 shared with Surge, through a new host mode `--instrument` with its own control class. The modes `--lv2`, `--sfz`, `--vst3` stay untouched. |
| D16 | Foreign plugin hosts run with the user's real `HOME`, `DISPLAY` and `XAUTHORITY`, not the private `HOME` of the instrument units: plugins keep licences, presets and window settings there. |
| D17 | The round trip is measured on the empty rack before the plugin is loaded (variant B): the server orders `ins_host`, then `ins_mess`, then `lade`, then the state restore. An impulse never passes an active plugin. |
| D18 | A VST3 bundle with more than one class: the scanner lists every class, but only the first is `ok`, the others are `blockiert` with `grund: mehrklassen`. Single-class bundles are unaffected. |

Deviations of the build from the plan text: the playback file carries the host number as `slot` (1 to 4, the loader subtracts 1), not `h - 1` as the plan text says. The protocol of `ins_mess` repeats up to 6 times at 250 ms when the core answers `host_fehlt` right after the flag, because its own edge check had not seen the host yet (found on the real core, task 8). The raw capture of a real-time export goes to a short path under `/tmp/cdj-<pid>/`, because the OSC string of `/k/arr/export_lauf` holds 47 bytes and the work-folder path did not fit (found on the real core).

### What the measurement of task 1 settled (`~/messungen/2026-11-10-1.11-plugins/t1.md`)

- Gate G1 passed: a SIGSTOP-hung `node.async = true` host moved the probe's cycle by at most 0.043 ms against a nominal 5.333 ms (gate: below 2 ms). The control with `node.async = false` and the return linked first stopped the probe for 10 s, so the harness does see a stall. ADR 009's "overturned if" did not occur.
- A stopped or killed host leaves its return port at exact digital zero within 1.3 to 10.5 ms. No held or repeated block in any run.
- The round trip is exactly 2 x quantum (512 samples at 256) plus the plugin's declared latency, spread 0 within a run and over three starts. The hypothesis "2 x quantum + 25" was not confirmed (the 25 samples belong to the MIDI path).
- An inactive plugin in Carla's rack returns silence, so D17 is variant B.
- Exact zero on the return does not separate a dead host from a plugin that is legitimately silent (a healthy host with a zero-gain plugin returned 939 of 939 cycles of exact zero with signal at the input), so there is no stall rule inside the stage and the health flag alone decides (D7).
- `carla_get_plugin_latency` works (Cypher EQ 69, a-eq 0, a-comp 0). LSP Limiter Stereo as LV2 declares 240 (task 2).
- Carla 2.5.8 loads only the first class of a multi-plugin VST3 bundle and evaluates neither label nor unique id (D18).
- The LV2 search path has to be a colon list that includes `/usr/lib/lv2`.

### What the measurement of task 1b settled (`t1b.md`, gate G1b)

- Vital native: usable (0.31 s start, 249 MB, 30 minutes without a lost or repeated block, window opens and redraws). It is the instrument of the acceptance sheet.
- Valhalla Supermassive (Windows VST3 through yabridge 5.1.1 and Wine 11.21): usable with a named limit. Round trip exactly 2 x quantum + 0 declared, spread 0 over three starts, 393 MB in total. Limit: one lost block (exact-zero return, graph shifted 4.2 ms) in 60 minutes, none in 90 minutes of the other runs, cause not attributed.
- Killing the Wine side makes the Carla host abort about 1 s later (`SIGABRT`). The return is exact zero from 6.4 ms after the kill. The health flag plus restart covers this, no special path.
- Vital for Windows through the bridge works but needs 792 MB against 249 MB native, so the native build is the choice.

## Consequences

- A foreign plugin cannot take the core down. It can make its strip dry: the stage crosses to the delayed dry signal in 480 samples without a jump in time, measured on the real core at 147 ms (kill) and 257 to 561 ms (stop) after the signal (t8). Until the watchdog flags a hung host, its strip is silent, not dry (up to 510 ms, within the 600 ms of D6).
- A project without a host stage is byte-identical in its playback file and bit-identical in sound (`arr_mixer_solo_ref.bin`, sha256 `ae4cbc0272d859af954fbf53617e414f314c02994bf6eda5adaa7830510710d2`, unchanged).
- Delay compensation grows: rings of 8192 samples instead of 1024, and the cost of the larger rings is gate G2: the lane without host stages is +11.6 us (+0.79 %) against `main` 0fc35017 (limit 2 %), four host stages add +6 to +8 us median (`t18.md`). The median reserve against the 1500 us gate is thin, 5.6 us in the worst valid run.
- A project with an active host stage cannot be exported faster than real time. A five-minute project took 303.2 s (t14). An xrun during the run ends in `export_luecke` and no file.
- At most 4 effect hosts and 2 instrument hosts. Instrument hosts and Surge share the 2 slots.
- A host is restarted by the supervisor, at most three failed starts in 60 s (`ausfall/absturz_schleife`, then the stage stays dry until the user acts).
- A plugin that reports another latency after a preset change is noticed at the next parameter set, window close or state save, and costs one playback reload (open flank 5 of the plan).
- No sidechain into a plugin and no automation lanes or controller mapping of plugin parameters, until insert lanes exist (Kanban `t_dea1bae4`).
- Windows plugins need yabridge and a Wine prefix. Activation of commercial plugins under Wine (Native Instruments, Native Access) is not covered and is a follow-up of its own; Kontakt would come first.

## Rejected

| Alternative | Reason |
|---|---|
| Hosting the plugin in the core (`dlopen`, in-process) | one address space: a plugin crash takes the whole music down with it (ADR 009 decision 1). Not reconsidered; the measurement of G1 shows the out-of-process path costs 2 x quantum and nothing else. |
| Freeze with trim for strips with a foreign insert | the freeze taps in front of the chain, so a frozen strip would not carry the plugin; trimming the latency afterwards means a second path with its own alignment. A real-time pass through the production master is the only truthful capture and needs no new rule (D10). |
| A bridge thread inside the core that polls the host's parameters and latency live, with mapped parameter rows | the plugin's parameters only pay off with controller mapping and insert lanes, which no kind has yet. The server sets parameters on the host socket (D3) and the latency is structure (D4). Saves a thread in the real-time path and a live re-alignment. |
| Cross-fade of a live latency value at 4 Hz | the compensation is computed at load and a reload reuses that path. |
| Offline render with a host in the loop | the render runs the core without JACK; a host needs real time. |
| A stall rule inside the stage (N blocks of exact zero) | measured: a healthy plugin that is silent looks the same. The flag decides. |
| CLAP | Carla 2.5.8 cannot host it; a newer Carla or an own host is a separate task. |

## Overturned if

A later measurement shows that the larger delay rings or four host stages move the cost lane by more than the stand file allows (the median reserve is only 5.6 us today) (then the rings are sized per strip at load), or that real use needs more than four effect hosts (then the cap is raised, a number). A newer Carla that selects a class inside a multi-plugin VST3 bundle removes D18.

## Addendum 2026-11-10: the 25 samples were refuted (wirt-timing)

The remark in the task 1 list above, "the 25 samples belong to the MIDI path", is refuted. The old lead of a Note-On for a host slot was 2n + 25; it came from a measurement of 2026-09-30 whose method carried a bias of about +14 samples (`~/messungen/2026-09-30-k2-sidechain/rundweg.md`), plus the envelope of the patch it used. The MIDI path is the same round trip as the audio path, exactly 2n (core -> host -> core), so every host note sounded 25 samples before its grid point. The lead is now `erz_midi_vorhalt(n) = 2n` (`djk/core/include/cypherdj/generator.h`). Measured at quantum 256 with `acceptance_p1.mjs --teil 3`: Surge +2/+1, reasonablesynth +3/+2, RB-338 0/0, Vital +3/+3 samples after the grid, live, in the freeze and in the export alike (details in `docs/architecture/stand/plugins-1-11.md`, open flank 7). Two limits stay: the round trip is measured only at quantum 256, and Surge applies a Note-On at the next 32-sample boundary of its own block, so a Surge note sounds 0 to 31 samples after its grid point (the core does not compensate). The declared latency of a plugin is still not part of the lead.
