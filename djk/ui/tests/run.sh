#!/bin/bash
# Page/server test runner in two stages.
#   fast: every file not in tests/serial.txt, in parallel (about 5 min). Use this while building.
#   full: the fast stage and the serial stage (tests/serial.txt, one file at a time) side by side (about 18 min). Use before a merge.
# The old runner ran all 360 files one at a time (about 60 min).
set -u
cd "$(dirname "$0")/.." || exit 2
MODE=${1:-full}
J=${TEST_J:-$(nproc)}
SERIAL=$(grep -v '^#' tests/serial.txt | sed 's#^#tests/#')
PARALLEL=$(ls tests/*.test.mjs | sort | grep -vxF -f <(echo "$SERIAL"))
case "$MODE" in
  fast) exec node --test --test-concurrency="$J" $PARALLEL ;;
  full)
    node --test --test-concurrency="$J" $PARALLEL > /tmp/djk-test-parallel.$$.log 2>&1 & P=$!
    node --test --test-concurrency=1 $SERIAL > /tmp/djk-test-serial.$$.log 2>&1 & Q=$!
    wait $P; RP=$?; wait $Q; RQ=$?
    for s in parallel serial; do echo "== $s"; grep -E '^# (tests|pass|fail)' /tmp/djk-test-$s.$$.log; grep -E '^not ok' /tmp/djk-test-$s.$$.log | head -20; done
    if [ $RP = 0 ] && [ $RQ = 0 ]; then rm -f /tmp/djk-test-parallel.$$.log /tmp/djk-test-serial.$$.log; exit 0; fi
    echo "failed: the full TAP logs stay in /tmp/djk-test-parallel.$$.log and /tmp/djk-test-serial.$$.log"; exit 1 ;;
  *) echo "usage: tests/run.sh fast|full"; exit 2 ;;
esac
