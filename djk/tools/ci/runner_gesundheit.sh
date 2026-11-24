#!/usr/bin/env bash
# Prints one health line of the runner: CPU power limit pl1 and the active power profile (tccd on the TUXEDO laptop), a speed probe, load average, nproc.
#   djk/tools/ci/runner_gesundheit.sh            at the start of a job: a throttled runner stops the job here (exit 1), before the gate runs
#   djk/tools/ci/runner_gesundheit.sh --ende     in the summary step: prints the line again and warns, never fails
# Speed probe: the best of three runs of a fixed single-core workload (python sum(range(10**7)), about 0.1 s on this runner at full speed).
# Above RUNNER_TEMPO_GRENZE_S (default 0.4) the machine is throttled: firmware held the laptop at 800 MHz on 2026-11-24 (probe 0.58 s) with
# every power limit at its normal value, and a full gate went red on twelve timing tests after 43 minutes. A red run on a throttled runner
# says nothing about the code, so the start refuses to run and the end says so next to the failures.
# A pl1 below 100 W adds a visible ::warning:: (timings of a power-capped runner are not comparable). Without tccd pl1 and profile are n/a.
# Environment: RUNNER_TEMPO_GRENZE_S, RUNNER_TEMPO_S (use this value instead of measuring: tests), BUSCTL.
ENDE=0; [ "${1:-}" = --ende ] && ENDE=1
BUSCTL=${BUSCTL:-busctl}
tccd() { "$BUSCTL" --system call com.tuxedocomputers.tccd /com/tuxedocomputers/tccd com.tuxedocomputers.tccd "$1" 2>/dev/null; }
json() { sed -n 's/^s "\(.*\)"$/\1/p' | sed 's/\\"/"/g'; }   # busctl prints the string as s "..." with escaped quotes
pl1=""; profil=""
if command -v "$BUSCTL" >/dev/null 2>&1; then
  pl1=$(tccd ODMPowerLimitsJSON | json | python3 -c 'import sys,json
try:
    for e in json.load(sys.stdin):
        if e.get("descriptor") == "pl1": print(int(e["current"])); break
except Exception: pass' 2>/dev/null)
  profil=$(tccd GetActiveProfileJSON | json | python3 -c 'import sys,json
try: print(json.load(sys.stdin)["id"])
except Exception: pass' 2>/dev/null)
fi
tempo=${RUNNER_TEMPO_S:-$(python3 -c 'import time
b = 9.0
for _ in range(3):
    t = time.perf_counter(); sum(range(10**7)); b = min(b, time.perf_counter() - t)
print(round(b, 3))' 2>/dev/null)}
grenze=${RUNNER_TEMPO_GRENZE_S:-0.4}
echo "runner health: pl1=${pl1:-n/a} W profile=${profil:-n/a} probe=${tempo:-n/a} s load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null) nproc=$(nproc 2>/dev/null)"
if [ -n "$pl1" ] && [ "$pl1" -lt 100 ] 2>/dev/null; then
  echo "::warning::runner is power-capped at ${pl1} W (profile ${profil:-unknown}), timings are not comparable"
fi
if [ -n "$tempo" ] && python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)' "$tempo" "$grenze" 2>/dev/null; then
  if [ "$ENDE" = 1 ]; then
    echo "::warning::runner is throttled at the end of the job (speed probe ${tempo} s, limit ${grenze} s): failed timing tests of this run are the machine, not the code"
    exit 0
  fi
  echo "::error::runner is throttled (speed probe ${tempo} s, limit ${grenze} s): the gate does not run; this is the machine, not the code"
  exit 1
fi
exit 0
