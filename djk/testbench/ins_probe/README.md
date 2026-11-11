# ins_probe: measuring client for the insert host round trip

Measuring tool for plan 1.11 (foreign plugins), task 1. Not product code; nothing in the studio links against it.

## What it is

* `ins_probe.c`: JACK client `cypherdj-probe` (name overridable), output ports `arr_ins_1_L/R`, input ports `arr_insret_1_L/R`.
  Per cycle it logs the callback start (CLOCK_MONOTONIC), the gap to the previous start, the peak of the return, whether
  the return block equals the previous return block and whether it is exact zero. It keeps the raw samples (out L, return L,
  return R) for the offline impulse search. The callback allocates and locks nothing. If the host dies the probe keeps
  logging and ends with exit 0 after `--dauer` seconds.
  Signals: `puls` (one impulse of 0.5 every 16384 samples, at offset 100) and `ton` (440 Hz sine, 0.25).
  `--fake delay:N|wdh|stille` replaces JACK by a paced thread and a fake producer thread (used by the self-test).
* `ins_probe.py`: scenario runner and analysis. The binary is built on demand into `$INS_PROBE_BIN_DIR`.
  * `ins_probe.py selbsttest`: feeds the analysis a delay of 300 samples (must report 300 +/- 0), a repeated block and silence.
    `INS_PROBE_MUTATION=1` builds an off-by-one into the impulse search; the self-test must then fail (300 reported as 301).
  * `ins_probe.py <gesund|stopp|kill|rundweg> --host-unit <unit> [--dauer 30] [--signal ton|puls]`: links the probe to
    the host (`<unit>:audio-in1/2`, `audio-out1/2`; the host's JACK client has the unit's name), runs, sends `SIGSTOP` at 10 s and
    `SIGCONT` at 20 s (`stopp`) or `SIGKILL` at 10 s (`kill`) to the unit's main process, writes `<tag>.json` with per-window
    statistics (cycle gap, return peak, exact-zero returns while the input carries signal, repeated blocks).
    `--rueck-zuerst` links the return ports before the send ports. Only in that order does a stopped `node.async = false` host
    stall the probe (the control that proves the harness can see a stall); in the default (studio) order PipeWire treats the
    return link as the feedback link and a stopped host of either kind does not stall the probe.
* Measuring aids (named here on purpose, all throw-away):
  * `carla_host.py`: Carla host in rack mode like `djk/hosts/carla/instrument_host.py` (plugin id 0, one engine per process,
    `ENGINE_OPTION_PLUGIN_PATH` as `instrument_host.py` sets it, overridable with `--lv2-pfad`), with a socket for `active`, `latency`
    (`carla_get_plugin_latency` through ctypes), `rss`, `param`.
  * `messlauf.py`: starts the host as transient user unit (`cypherdj-ins1-e`, `cypherdj-ins1-e-sync`) with the
    `PIPEWIRE_PROPS` of `djk/start/djk-instrumente:153` (own `node.group`), runs the scenarios and the step-3 measurements.
  * `all.sh`: the whole series; every chunk runs under both timing locks
    (the machine-wide timing lock `$CYPHERDJ_TIMING_LOCK`, default `/tmp/claude-<uid>/cypher-echtzeit.lock`, and `djk/config/.echtzeit.lock`).

## Running

    ins_probe.py selbsttest
    ./all.sh > ~/messungen/<dir>/t1/alle.log

Raw data and the summary of the first series: `~/messungen/2026-11-10-1.11-plugins/t1/` and `t1.md`.

## Task 1b additions

`messlauf.py` modes `start3|lang <key> <s>|killwine|hostkill|ui` for the keys `smw` (Valhalla Supermassive through yabridge), `vitw` (Vital for Windows through yabridge),
`vitn` (Vital native); `INS_OUT` redirects the output directory. `carla_host.py` gained `--hold-note`, `note` and `ui` commands; `ins_probe.py` the scenario `killwine`.
Install notes for the bridge: `BRIDGE.md`. Results: `~/messungen/2026-11-10-1.11-plugins/t1b.md`.

## Known limits

* Carla 2.5.8 loads the first class of a multi-plugin VST3 bundle whatever `name`, `label` or `uniqueId` are passed
  (see t1.md); the LSP bundle therefore cannot be used to select "Compressor Stereo".
* The probe node itself is not `node.async`; its group is `cypherdj-ins1` (not the studio's group).
* The probe's block size is the one of the first cycle; a quantum change during a run is not followed.
