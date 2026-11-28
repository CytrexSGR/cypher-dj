#!/usr/bin/env bash
# The test gate: runs every test suite of the project and writes a summary.
#
#   djk/tools/alles.sh [--repo DIR] [--nur suite,suite] [--ziel DIR] [--jobs N] [--langsam] [--betroffen [REF]] [--auch suite,suite] [--ohne-ruhig] [--paket N[/M]] [--liste]
#
# --repo   repo to test (default: the repo this script lives in). Needs the built core, the venvs and node_modules.
# --nur    only these suites (see --liste).
# --ziel   output folder (default ~/messungen/<yyyy-mm-dd>-alles/): <suite>.log and <suite>.meta per suite, SUMMARY.md.
# --langsam  the slow stage instead of the gate: exactly the tests labelled langsam (core: warp fuzz, long keylock and arrangement tests).
#          Run it when core changed (--betroffen does) and before a release candidate; the gate does not run them.
# --betroffen [REF]  only what the change against REF touches (default: merge base with origin/main; working tree included), chosen by
#          tools/betroffen.py: whole suites for core, instruments and start/, and only the test files that are changed or name the changed source
#          for the node and pytest suites. A change to CMake, a header, the contract, a lockfile or the gate itself runs the whole gate. When
#          core is touched the slow stage (core-langsam) does NOT run, like in the full gate; the nightly job runs it (--langsam). SUMMARY.md says what was selected. Exit codes as above.
# --auch suite,suite  with --betroffen: whole suites on top of the selection (the suites that failed in an earlier run of the branch: CI's red basis, see
#          ci/gruene_basis.sh). A suite the selection chose by files runs complete. Names as in --liste; ui-ruhig-N counts as ui-ruhig; an unknown name runs the whole gate.
# --jobs   size of the job pool (default: nproc). Suites run concurrently; every suite has a weight (the processes it keeps
#          busy: core CORE_W 6, instruments 8, the page suite UI_W 4, shards and others 1) and a new suite starts when its weight still fits.
#          --jobs 1 runs one suite at a time, like the old gate.
# --ohne-ruhig  the pool and the flaky rerun without the quiet stage (core-ruhig, ui-ruhig, generator-ruhig): CI runs that stage afterwards in parallel containers.
# --paket N[/M]  only package N of M of the quiet stage (M defaults to $RUHIG_PAKETE, 4). Packages 1..M: the quiet page test files (djk/ui/tests/ruhig.txt) split
#          over M packages by their measured seconds (tools/alles_verteilen.py, suites ui-ruhig-1..M); package M+1: core-ruhig and generator-ruhig. Combines
#          with --betroffen (a package keeps only the files that selection chose) and --nur; with --liste it prints the suites of the package. Every package
#          is its own run with its own --ziel; djk/tools/ci/ruhig_pakete.sh starts them in parallel containers and merges the folders (alles_report.py --ziel A B ...).
# Each suite runs in its own systemd scope (MemoryMax=6G or its weight in GB if larger, CPUWeight=50) under nice -n 10 (core: nice 0, its tests assert real-time deadlines). The page
# suite runs its test files TEST_J at a time (default 8), every other suite one file at a time.
# The suites that bind the live PipeWire graph (EXKLUSIV below) hold one lock ($ZIEL/.pipewire.lock): never two at once.
# Not covered: djk/fallback/tests (needs a live PipeWire instance) and djk/core/tests/**/test_*.py (driven by ctest).
# Failures listed in djk/tools/quarantaene.txt are reported but do not fail the gate.
# Flaky retry: after the pool and the quiet stage, every failed unit (ctest test, pytest or node test file, cargo test) runs once more, serially, on the idle machine.
# Passes the second time: reported as flaky (SUMMARY.md section, flaky.txt, the job log), the gate stays green. Fails again: red. More than 30 failed units: no
# rerun, red (a breakage, not a flake). Crashed or not-run suites are never rerun. Shell suites and doc tests are not rerun.
# Exit 0: no failure outside quarantine and nothing skipped for load. 1: at least one failure. 2: usage. 3: no failure, but tests
# were skipped for load (the gate is not green).
set -u
SELF=$(readlink -f "${BASH_SOURCE[0]}")
HIER=$(dirname "$SELF")
REPO=$(cd "$HIER/../.." && pwd)
TEST_J=${TEST_J:-8}
JOBS=$(nproc 2>/dev/null || echo 4)
CORE_J=${CORE_J:-8}   # ctest -j of the core suite
# Weights in the job pool = the load a suite really puts on the machine (measured: the machine was 70 % idle from minute 10 with the old weights 8/8/8):
CORE_W=${CORE_W:-$CORE_J}   # core, core-langsam, core-ruhig: back at 8 = CORE_J (CI 5178: weight 6 let more suites run at once, mock_core 537 -> 957 s, ui-seriell-f 864 -> 1232 s)
UI_W=${UI_W:-$TEST_J}      # ui-seite: back at TEST_J for the same reason
LANGSAM=0
BETROFFEN=0
NUR=""
AUCH=""
ZIEL=""
INTERN=""
# The serial page tests run in 8 shards, one per test instance letter a..h (letters are namespaces: port block, /dev/shm folder, lock file; the stack test takes
# the reserved letter i, CYPHERDJ_STAPEL_INSTANZ=i). tools/alles_verteilen.py splits djk/ui/tests/serial.txt over them. `--nur ui-seriell` runs all of them.
UI_SHARDS="ui-seriell-a ui-seriell-b ui-seriell-c ui-seriell-d ui-seriell-e ui-seriell-f ui-seriell-g ui-seriell-h"
# Slowest first: the pool starts suites in this order, so the long ones begin at once and the short ones fill the gaps.
# Order = start order: the longest first (measured seconds in a full run: instruments 950, ui-seriell-g 734, py-tools 617, mock_core 537, core 513,
# py-key_energy 495, py-contract 467, hand 347). The four long weight-1 suites used to start 6 to 9 minutes late, behind the weights of the big ones.
ALLE="instruments core $UI_SHARDS py-tools mock_core py-key_energy py-contract hand ui-seite py-workshop py-carla generator conductor py-bibliothek py-sound cues py-starter start-sh py-start loops py-generator py-structure_suggestion py-testbench player_cli py-ablage py-hand_bruecke py-loops py-quellen py-third_party tools-node core-ruhig ui-ruhig generator-ruhig"
# The slow stage (--langsam): the tests labelled langsam in core (warp fuzz and the other long ones, see the end of core/CMakeLists.txt). The gate leaves them out.
LANGSAM_SUITES="core-langsam"
# Run one after the other once the pool has drained: tests that assert real-time budgets or response windows fail when the other suites load the machine
# (core: ctest label ruhig; ui and generator: the files of tests/ruhig.txt).
NACH="core-ruhig ui-ruhig generator-ruhig"
# the package suites of the quiet page tests (--paket) belong to the quiet stage too
ist_nach() { case " $NACH " in *" $1 "*) return 0 ;; esac; case "$1" in ui-ruhig-[0-9]*) return 0 ;; esac; return 1; }
RUHIG_M=${RUHIG_PAKETE:-4}
PAKET=""
OHNE_RUHIG=0
# Suites that talk to the live PipeWire graph (clients, links, sinks): mutually exclusive.
EXKLUSIV="start-sh py-carla"
# core, core-langsam and core-ruhig share one build folder (ninja does not lock it) and one set of test resources: never two at once.
KERN_EXKLUSIV="core core-langsam core-ruhig"

usage() { sed -n '2,34p' "$SELF" | sed 's/^# \{0,1\}//' >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) [ $# -ge 2 ] || usage; REPO=$(cd "$2" 2>/dev/null && pwd) || { echo "alles: no such repo folder: $2" >&2; exit 2; }; shift 2 ;;
    --jobs) [ $# -ge 2 ] || usage; case "$2" in ''|*[!0-9]*|0) echo "alles: --jobs needs a positive number" >&2; exit 2 ;; esac; JOBS=$2; shift 2 ;;
    --nur) [ $# -ge 2 ] || usage; NUR=$2; shift 2 ;;
    --ziel) [ $# -ge 2 ] || usage; ZIEL=$2; shift 2 ;;
    --langsam) LANGSAM=1; shift ;;
    --liste) LISTE=1; shift ;;
    --betroffen) BETROFFEN=1; BASIS=""; if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then BASIS=$2; shift; fi; shift ;;
    --auch) [ $# -ge 2 ] || usage; AUCH=$2; shift 2 ;;
    --ohne-ruhig) OHNE_RUHIG=1; shift ;;
    --paket) [ $# -ge 2 ] || usage; PAKET=$2; shift 2 ;;
    --intern) [ $# -ge 2 ] || usage; INTERN=$2; shift 2 ;;
    -h|--help) usage ;;
    *) echo "alles: unknown option $1" >&2; usage ;;
  esac
done
if [ -n "$PAKET" ]; then
  case "$PAKET" in */*) RUHIG_M=${PAKET#*/}; PAKET=${PAKET%/*} ;; esac
  case "$PAKET$RUHIG_M" in *[!0-9]*|'') echo "alles: --paket needs N or N/M (numbers)" >&2; exit 2 ;; esac
  { [ "$RUHIG_M" -ge 1 ] && [ "$PAKET" -ge 1 ] && [ "$PAKET" -le $((RUHIG_M + 1)) ]; } || { echo "alles: --paket N/M needs 1 <= N <= M+1 (M+1 is core-ruhig and generator-ruhig)" >&2; exit 2; }
fi
[ "$OHNE_RUHIG" = 0 ] || [ -z "$PAKET" ] || { echo "alles: --ohne-ruhig cannot be combined with --paket" >&2; exit 2; }
# the suites of the quiet package N of M among the selected ones (stdin: the selection, stdout: the package's suites). The page files come from
# alles_verteilen.py; a package without a file has no suite (node --test with no file would run everything).
paket_suites() {
  local gew=" $1 " out="" a=()
  if [ "$PAKET" -le "$RUHIG_M" ]; then
    case "$gew" in *" ui-ruhig "*)
      [ -z "${BETR:-}" ] || [ ! -f "$BETR/ui-ruhig.txt" ] || a=(--aus "$BETR/ui-ruhig.txt")
      [ "$(python3 "$HIER/alles_verteilen.py" --ruhig-paket "$PAKET/$RUHIG_M" "${a[@]}" | grep -c .)" -eq 0 ] || out="ui-ruhig-$PAKET" ;;
    esac
  else
    for s in core-ruhig generator-ruhig; do case "$gew" in *" $s "*) out="$out $s" ;; esac; done
  fi
  echo $out
}
if [ "${LISTE:-0}" = 1 ] && [ -n "$PAKET" ]; then paket_suites " $ALLE " | tr ' ' '\n'; exit 0; fi
if [ "${LISTE:-0}" = 1 ]; then if [ "$LANGSAM" = 1 ]; then echo $LANGSAM_SUITES; else echo $ALLE; fi | tr ' ' '\n'; exit 0; fi
[ -n "$ZIEL" ] || ZIEL="$HOME/messungen/$(date +%F)-alles"
D="$REPO/djk"
PW_SCHLOSS="$ZIEL/.pipewire.lock"
BAU_J=$(( JOBS / 2 )); [ "$BAU_J" -ge 2 ] || BAU_J=2   # ninja -j of the core build
[ -d "$D" ] || { echo "alles: $REPO has no djk folder" >&2; exit 2; }

PY=${CYPHERDJ_PYTHON:-$D/workshop/.venv/bin/python}
[ -x "$PY" ] || PY=python3
PY_MIK="$REPO/cues/venv-mik/bin/python"
# the CI image carries the same interpreter (essentia-tensorflow) and the models outside any checkout
[ -x "$PY_MIK" ] || { [ -z "${CYPHERDJ_MIK:-}" ] || PY_MIK="$CYPHERDJ_MIK/bin/python"; }

# files chosen by --betroffen for a suite (one per line in $BETR/<suite>.txt, relative to the suite's folder), else the default given
dateien_oder() { if [ -n "${BETR:-}" ] && [ -f "$BETR/$1.txt" ]; then tr '\n' ' ' < "$BETR/$1.txt"; else echo "$2"; fi; }

# command line of a suite: prints "<kind>|<shell command>"
suite_befehl() {
  local s=$1 serial par
  case "$s" in
    ui-seite|ui-seriell-?)
      serial='$( { grep -v "^#" tests/serial.txt; sed "s/[[:space:]]*#.*//" tests/ruhig.txt; } | grep -v "^$" | sed "s#^#tests/#")'
      if [ "$s" = ui-seite ]; then
        local f; f=$(dateien_oder ui-seite "")
        if [ -n "$f" ]; then echo "node|cd '$D/ui' && node --test --test-timeout=600000 --test-reporter=tap --test-concurrency=${TEST_J:-8} $f"
        else echo "node|cd '$D/ui' && SERIAL=$serial && node --test --test-timeout=600000 --test-reporter=tap --test-concurrency=${TEST_J:-8} \$(ls tests/*.test.mjs | sort | grep -vxF -f <(echo \"\$SERIAL\"))"; fi
      else
        # one shard: its own TMPDIR (a test asserts that nothing new appears under TMPDIR; another shard's temp folders must not count), its own test instance letter, the files alles_verteilen.py assigns to it, one at a time
        local f; f=$(dateien_oder "$s" "")
        [ -n "$f" ] || f="\$(python3 '$HIER/alles_verteilen.py' ${s##*-} | sed 's#^#tests/#')"
        echo "node|T=\$(mktemp -d) && trap 'rm -rf \"\$T\"' EXIT && export TMPDIR=\$T && cd '$D/ui' && CYPHERDJ_TEST_INSTANZ=${s##*-} CYPHERDJ_STAPEL_INSTANZ=i node --test --test-timeout=600000 --test-reporter=tap --test-concurrency=1 $f"
      fi ;;
    core)
      # Without the mutation programs (-DCYPHERDJ_MUTATIONEN=OFF: their tests are left out below anyway, so nobody runs them), then the gate's tests in parallel (ctest
      # respects RESOURCE_LOCK), without the slow stage (label langsam) and without the PipeWire-bound tests (label pipewire), which come last under the shared lock.
      echo "ctest|cmake -DCYPHERDJ_MUTATIONEN=OFF '$D/core/build' > /dev/null; ninja -k 0 -j$BAU_J -C '$D/core/build'; b=\$?; ctest --test-dir '$D/core/build' -j$CORE_J --timeout 300 --output-on-failure -E _mutation -LE 'langsam|pipewire|ruhig'; c=\$?; flock '$PW_SCHLOSS' ctest --test-dir '$D/core/build' --timeout 300 --output-on-failure -E _mutation -L pipewire; c2=\$?; [ \$c = 0 ] && c=\$c2; [ \$b = 0 ] && exit \$c; exit 1" ;;
    core-ruhig)
      echo "ctest|cmake -DCYPHERDJ_MUTATIONEN=OFF '$D/core/build' > /dev/null; ninja -k 0 -j$BAU_J -C '$D/core/build'; b=\$?; ctest --test-dir '$D/core/build' -j$CORE_J --timeout 600 --output-on-failure -E _mutation -L ruhig; c=\$?; [ \$b = 0 ] && exit \$c; exit 1" ;;
    core-langsam)
      echo "ctest|cmake -DCYPHERDJ_MUTATIONEN=OFF '$D/core/build' > /dev/null; ninja -k 0 -j$BAU_J -C '$D/core/build'; b=\$?; ctest --test-dir '$D/core/build' -j$CORE_J --output-on-failure -L langsam; c=\$?; [ \$b = 0 ] && exit \$c; exit 1" ;;
    conductor) echo "node|cd '$D/conductor' && node --test --test-reporter=tap --test-concurrency=1 $(dateien_oder conductor 'tests/*.test.ts ../announcement/tests/*.test.ts')" ;;
    player_cli) echo "node|cd '$D/player_cli' && node --test --test-reporter=tap --test-concurrency=1 $(dateien_oder player_cli 'tests/*.test.ts')" ;;
    # hand's tests default to the test instances c, e and f, which the ui-seriell shards own: it runs on g and takes turns with shard g (lock below).
    # Not on i: with all shards a..h and hand on i at once, py-carla (no fixed letter, takes the first free one) found none and skipped 52 tests (CI 5148).
    hand) echo "node|cd '$D/$s' && CYPHERDJ_TEST_INSTANZ=g node --test --test-reporter=tap --test-concurrency=1 $(dateien_oder "$s" 'tests/*.test.mjs')" ;;
    generator) echo "node|cd '$D/generator' && node --test --test-reporter=tap --test-concurrency=1 $(dateien_oder generator "\$(ls tests/*.test.mjs | grep -vxF -f <(sed 's/[[:space:]]*#.*//; /^\$/d; s#^#tests/#' tests/ruhig.txt))")" ;;
    # the quiet stage of the node suites: timing-sensitive test files alone, one at a time, after the pool (tests/ruhig.txt of the area)
    ui-ruhig) echo "node|T=\$(mktemp -d) && trap 'rm -rf \"\$T\"' EXIT && export TMPDIR=\$T && cd '$D/ui' && CYPHERDJ_TEST_INSTANZ=h CYPHERDJ_STAPEL_INSTANZ=i node --test --test-timeout=600000 --test-reporter=tap --test-concurrency=1 $(dateien_oder ui-ruhig "\$(sed 's/[[:space:]]*#.*//; /^\$/d; s#^#tests/#' tests/ruhig.txt)")" ;;
    ui-ruhig-[0-9]*)
      # one package of the quiet page tests (--paket): its share of tests/ruhig.txt (or of the files --betroffen chose), one at a time, on instance h of its own container
      local f aus=""; f=$(dateien_oder "$s" "")
      [ -z "${BETR:-}" ] || [ ! -f "$BETR/ui-ruhig.txt" ] || aus="--aus '$BETR/ui-ruhig.txt'"
      [ -n "$f" ] || f="\$(python3 '$HIER/alles_verteilen.py' --ruhig-paket ${s##*-}/$RUHIG_M $aus)"
      echo "node|T=\$(mktemp -d) && trap 'rm -rf \"\$T\"' EXIT && export TMPDIR=\$T && cd '$D/ui' && CYPHERDJ_TEST_INSTANZ=h CYPHERDJ_STAPEL_INSTANZ=i node --test --test-timeout=600000 --test-reporter=tap --test-concurrency=1 $f" ;;
    generator-ruhig) echo "node|cd '$D/generator' && node --test --test-reporter=tap --test-concurrency=1 $(dateien_oder generator-ruhig "\$(sed 's/[[:space:]]*#.*//; /^\$/d; s#^#tests/#' tests/ruhig.txt)")" ;;
    cues|loops) echo "node|cd '$D/$s' && node --test --test-reporter=tap --test-concurrency=1 $(dateien_oder "$s" 'tests/*.test.mjs')" ;;
    mock_core) echo "node|cd '$D/contract/mock_core' && node --test --test-reporter=tap --test-concurrency=1 $(dateien_oder mock_core 'tests/*.test.mjs')" ;;
    tools-node) echo "node|cd '$D/tools' && node --test --test-reporter=tap --test-concurrency=1 $(dateien_oder tools-node 'tests/*.test.mjs')" ;;
    py-*)
      local p=${s#py-} dir py=$PY
      dir=$p
      case "$p" in
        carla) dir=hosts/carla; py=python3 ;;
        key_energy) [ -x "$PY_MIK" ] && py=$PY_MIK ;;
      esac
      echo "pytest|cd '$D/$dir' && '$py' -m pytest -q -p no:cacheprovider -rfE $(dateien_oder "$s" '')" ;;
    instruments)
      echo "cargo|bash '$HIER/alles_cargo.sh' '$D/instruments' 6 $BAU_J" ;;
    start-sh)
      echo "shell|bash '$HIER/alles_shell_run.sh' '$D/start/tests'" ;;
    *) return 1 ;;
  esac
}

# weight of a suite in the job pool: the number of processes it keeps busy
gewicht() {
  case "$1" in
    core|core-langsam|core-ruhig) echo "$CORE_W" ;;
    instruments) echo 8 ;;
    ui-seite) echo "$UI_W" ;;
    *) echo 1 ;;
  esac
}

# run one suite: log, meta
lauf_eine() {
  local s=$1 spec kind cmd t0 rc mem
  spec=$(suite_befehl "$s") || { echo "alles: unknown suite $s" >&2; return 2; }
  kind=${spec%%|*}; cmd=${spec#*|}
  mkdir -p "$ZIEL"
  rm -f "$ZIEL/$s.meta"
  case "$s" in hand|ui-seriell-g) exec 6>"$ZIEL/.inst-g.lock"; flock 6 ;; esac   # test instance g: shard g and hand take turns
  case " $EXKLUSIV " in *" $s "*) exec 8>"$PW_SCHLOSS"; flock 8 ;; esac   # held until this job's last process ends; the wait is not part of the suite's seconds
  case " $KERN_EXKLUSIV " in *" $s "*) exec 7>"$ZIEL/.kern.lock"; flock 7 ;; esac
  t0=$(date +%s)
  mem=$(gewicht "$s"); [ "$mem" -ge 6 ] || mem=6
  if [ "$kind" = cargo ] && ! command -v cargo >/dev/null; then
    echo "alles: $s skipped, cargo not found" >&2; return 0
  else
    local scope=() nicewert=10
    case "$s" in core|core-langsam|core-ruhig|ui-ruhig|ui-ruhig-[0-9]*|generator-ruhig) nicewert=0 ;; esac   # the core tests assert real-time deadlines (they failed under the load of the other suites at nice 10)
    systemd-run --user --scope -q true 2>/dev/null && scope=(systemd-run --user --scope -q -p MemoryMax=${mem}G -p CPUWeight=50)
    [ ${#scope[@]} -gt 0 ] || echo "alles: no systemd user scope, running without memory cap" >&2
    "${scope[@]}" nice -n "$nicewert" timeout -k 30 7200 bash -c "$cmd" > "$ZIEL/$s.log" 2>&1
    rc=$?
  fi
  printf 'kind=%s\nseconds=%s\nexit=%s\n' "$kind" "$(( $(date +%s) - t0 ))" "$rc" > "$ZIEL/$s.meta"
  echo "alles: $s exit $rc"
  return 0
}

if [ -n "$INTERN" ]; then lauf_eine "$INTERN"; exit 0; fi

# Results of an earlier run in the same folder must never be read as this run's (a CI workdir can be reused, and "nothing to run" exits early).
mkdir -p "$ZIEL" || exit 2
rm -rf "$ZIEL/rerun"; rm -f "$ZIEL"/*.meta "$ZIEL"/*.log "$ZIEL"/SUMMARY.md "$ZIEL"/flaky.txt
BETR=""
if [ "$BETROFFEN" = 1 ]; then
  [ -z "$NUR" ] && [ "$LANGSAM" = 0 ] || { echo "alles: --betroffen cannot be combined with --nur or --langsam" >&2; exit 2; }
  [ "$REPO" = "$(cd "$HIER/../.." && pwd)" ] || { echo "alles: --betroffen reads the change of the repo this script lives in; do not combine it with --repo" >&2; exit 2; }
  mkdir -p "$ZIEL" || exit 2
  rm -rf "$ZIEL/betroffen"
  PLAN=$(python3 "$HIER/betroffen.py" ${BASIS:+--gegen "$BASIS"} --ziel "$ZIEL/betroffen") || { echo "alles: betroffen.py failed" >&2; exit 2; }
  echo "$PLAN" > "$ZIEL/betroffen.txt"; echo "$PLAN" | sed 's/^/alles: betroffen: /'
  GEWAEHLT=" "
  BETR_ZIEL="$ZIEL/betroffen"
  case "$PLAN" in
    ESKALATION*) GEWAEHLT=" $ALLE " ;;
    *) while read -r art name _; do
         case "$art" in SUITE|DATEIEN) GEWAEHLT="$GEWAEHLT$name " ;; esac
         [ "$art-$name" = "SUITE-core" ] && GEWAEHLT="$GEWAEHLT core-ruhig "
       done <<< "$PLAN" ;;
  esac
  if [ -n "$AUCH" ]; then
    for s in $(echo "$AUCH" | tr ',' ' '); do
      s=$(echo "$s" | sed 's/^ui-ruhig-[0-9]*$/ui-ruhig/')
      case " $ALLE core-langsam " in
        *" $s "*) GEWAEHLT="$GEWAEHLT$s "; rm -f "$BETR_ZIEL/$s.txt" ;;   # the whole suite, not only the chosen files
        *) echo "alles: --auch: unknown suite '$s': the whole gate runs"; GEWAEHLT=" $ALLE " ;;
      esac
    done
    echo "alles: betroffen: --auch $AUCH"; echo "AUCH $AUCH" >> "$ZIEL/betroffen.txt"
  fi
  WAHL=""
  for s in $ALLE core-langsam; do case "$GEWAEHLT" in *" $s "*) WAHL="$WAHL $s" ;; esac; done
  if [ -z "$WAHL" ]; then
    echo "alles: betroffen: nothing to run"
    { echo "# Test run summary"; echo; echo "Nothing to run: every changed path is on the allow list of irrelevant paths (see betroffen.txt)."; echo
      sed 's/^/    /' "$ZIEL/betroffen.txt"; echo; echo "Result: GREEN, nothing selected"; } > "$ZIEL/SUMMARY.md"
    exit 0
  fi
  BETR="$ZIEL/betroffen"
elif [ -n "$AUCH" ]; then
  echo "alles: --auch needs --betroffen" >&2; exit 2
elif [ -n "$NUR" ]; then
  WAHL=$(echo ",$NUR," | sed "s/,ui-seriell,/,${UI_SHARDS// /,},/g" | tr ',' ' ')
  for s in $WAHL; do
    case " $ALLE $LANGSAM_SUITES " in *" $s "*) ;; *) echo "alles: unknown suite $s (see --liste)" >&2; exit 2 ;; esac
  done
elif [ "$LANGSAM" = 1 ]; then
  WAHL=$LANGSAM_SUITES
else
  WAHL=$ALLE
fi

# --paket: only the suites of that package of the quiet stage; --ohne-ruhig: everything but the quiet stage
if [ -n "$PAKET" ] || [ "$OHNE_RUHIG" = 1 ]; then
  if [ -n "$PAKET" ]; then WAHL=$(paket_suites " $WAHL "); else
    W=""; for s in $WAHL; do ist_nach "$s" || W="$W $s"; done; WAHL=$W
  fi
  if [ -z "${WAHL// /}" ]; then
    echo "alles: nothing to run in this part of the gate"
    mkdir -p "$ZIEL" && rm -rf "$ZIEL/rerun"; rm -f "$ZIEL"/*.meta "$ZIEL"/*.log "$ZIEL"/SUMMARY.md "$ZIEL"/flaky.txt
    { echo "# Test run summary"; echo; echo "Nothing to run in this part of the gate ($([ -n "$PAKET" ] && echo "quiet package $PAKET of $RUHIG_M" || echo "pool without the quiet stage")): the selection holds none of its suites."; echo
      echo "Result: GREEN, nothing selected"; } > "$ZIEL/SUMMARY.md"
    exit 0
  fi
fi

mkdir -p "$ZIEL" || exit 2
rm -rf "$ZIEL/rerun"; rm -f "$ZIEL"/*.meta "$ZIEL"/*.log "$ZIEL"/SUMMARY.md "$ZIEL"/flaky.txt
export BETR ZIEL REPO PW_SCHLOSS CYPHERDJ_PYTHON="${CYPHERDJ_PYTHON:-}"
ARGS=(--repo "$REPO" --ziel "$ZIEL")
NICHT=()
# bounded job pool: start the next suite when its weight still fits into --jobs (a suite heavier than the pool runs alone)
declare -A GEW=()
benutzt=0
for s in $WAHL; do
  ist_nach "$s" && continue
  w=$(gewicht "$s"); [ "$w" -le "$JOBS" ] || w=$JOBS
  while [ "$benutzt" -gt 0 ] && [ $((benutzt + w)) -gt "$JOBS" ]; do
    fertig=""; wait -n -p fertig || true
    [ -n "$fertig" ] && benutzt=$((benutzt - ${GEW[$fertig]:-0}))
  done
  ( lauf_eine "$s" ) &
  GEW[$!]=$w; benutzt=$((benutzt + w))
done
wait
for s in $WAHL; do ist_nach "$s" && ( lauf_eine "$s" ); done
# Flaky retry: the units that failed (alles_report.py --rerun-plan names them) run once more, one after the other, on the idle machine: ctest by test name,
# pytest and node by test file, cargo by test name in its binary. A unit that passes is reported as flaky, one that fails again stays red. More than 30 failed
# units: no rerun (the plan is empty, the report says so). A suite that crashed or ran no test is never rerun.
RERUN="$ZIEL/rerun"
lauf_nochmal() {
  local s=$1 kind=$2 cmd t0 rc
  case "$kind" in
    node|pytest) cmd=$( TEST_J=1; BETR="$RERUN/betr"; suite_befehl "$s" ) || return 0; cmd=${cmd#*|} ;;
    ctest)
      local re; re=$(sed 's/[][\\.*^$+?(){}|\/]/\\&/g' "$RERUN/$s.einheiten" | paste -sd'|')
      cmd="flock '$PW_SCHLOSS' ctest --test-dir '$D/core/build' --timeout 600 --output-on-failure -R '^($re)\$'" ;;
    cargo) cmd="bash '$HIER/alles_cargo.sh' --rerun '$D/instruments' '$RERUN/$s.einheiten'" ;;
    *) return 0 ;;
  esac
  t0=$(date +%s)
  nice -n 0 timeout -k 30 3600 bash -c "$cmd" > "$RERUN/$s.log" 2>&1; rc=$?
  printf 'kind=%s\nseconds=%s\nexit=%s\n' "$kind" "$(( $(date +%s) - t0 ))" "$rc" > "$RERUN/$s.meta"
  echo "alles: rerun $s exit $rc"
}
python3 "$HIER/alles_report.py" --ziel "$ZIEL" --quarantaene "$HIER/quarantaene.txt" --rerun-plan > "$ZIEL/rerun-plan.out" || true
while read -r rs rk; do [ -n "$rs" ] && lauf_nochmal "$rs" "$rk"; done < "$ZIEL/rerun-plan.out"
command -v cargo >/dev/null || NICHT+=(--nicht-gelaufen "instruments: cargo not found")

python3 "$HIER/alles_report.py" --ziel "$ZIEL" --quarantaene "$HIER/quarantaene.txt" --skips "$HIER/skips_decke.txt" --erwartet "$WAHL" "${NICHT[@]}"
rc=$?
if [ -s "$ZIEL/flaky.txt" ]; then echo "alles: FLAKY (failed, then passed on the rerun):"; sed 's/^/alles:   /' "$ZIEL/flaky.txt"; fi
if [ -n "$BETR" ]; then
  { echo; echo "## Selection (--betroffen)"; echo; sed 's/^/    /' "$ZIEL/betroffen.txt"; echo; echo "Suites run: $WAHL"; } >> "$ZIEL/SUMMARY.md"
fi
exit $rc
