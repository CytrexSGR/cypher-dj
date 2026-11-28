#!/usr/bin/env bash
# The quiet stage of the gate in parallel containers, then one merged report.
#
#   djk/tools/ci/ruhig_pakete.sh <ziel> [alles.sh options, e.g. --betroffen REF]
#
# Runs `alles.sh --paket n/M` for the packages 1..M+1 (M = $RUHIG_PAKETE, default 4: the quiet page test files split over M packages by their measured
# seconds, package M+1 = core-ruhig and generator-ruhig), every one in its own container (own network, own /dev/shm, so every one may use test instance h)
# with its own result folder <ziel>/ruhig-<n> and a CPU cap, all at once. It waits for all of them, prints their output, then merges the folders
# (<ziel> itself holds the pool's results: alles.sh --ohne-ruhig) with alles_report.py into <ziel>/SUMMARY.md. Exit: the report's (0 green, 1 red,
# 3 skipped for load); 1 as well when a container ended with a code the report does not explain.
# The package count drops to 2 with RUHIG_PAKETE=2 when the quiet tests turn out flaky in parallel.
#   RUHIG_PAKETE (4), RUHIG_CPUS (4: page packages), RUHIG_CPUS_KERN (8: the core package, its ctest runs 8 at a time), RUHIG_MEMORY (8g per container),
#   RUHIG_CONTAINER (the command that runs a command in a container, default im_container.sh next to this script; a stub in the tests).
set -u
HIER=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TOOLS=$(dirname "$HIER")
[ $# -ge 1 ] || { echo "usage: ruhig_pakete.sh <ziel> [alles.sh options]" >&2; exit 2; }
mkdir -p "$1" || exit 2
ZIEL=$(cd "$1" && pwd); shift
M=${RUHIG_PAKETE:-4}
case "$M" in ''|*[!0-9]*|0) echo "ruhig_pakete: RUHIG_PAKETE must be a positive number, got '$M'" >&2; exit 2 ;; esac
IM=${RUHIG_CONTAINER:-$HIER/im_container.sh}
cd "$(cd "$TOOLS/../.." && pwd)" || exit 2
PIDS=()
for n in $(seq 1 $((M + 1))); do
  rm -rf "${ZIEL:?}/ruhig-$n" "$ZIEL/ruhig-$n.out"
  cpus=${RUHIG_CPUS:-4}; [ "$n" -le "$M" ] || cpus=${RUHIG_CPUS_KERN:-8}
  CI_MEMORY=${RUHIG_MEMORY:-8g} CI_CPUS=$cpus "$IM" djk/tools/alles.sh --paket "$n/$M" "$@" --ziel "$ZIEL/ruhig-$n" > "$ZIEL/ruhig-$n.out" 2>&1 &
  PIDS+=($!)
done
RCS=(); bad=0
for i in "${!PIDS[@]}"; do
  rc=0; wait "${PIDS[$i]}" || rc=$?
  RCS+=("$rc"); [ "$rc" = 0 ] || bad=1
done
for n in $(seq 1 $((M + 1))); do
  echo "=== quiet package $n of $M (exit ${RCS[$((n - 1))]}) ==="
  cat "$ZIEL/ruhig-$n.out" 2>/dev/null
done
DIRS=(); for n in $(seq 1 $((M + 1))); do DIRS+=("$ZIEL/ruhig-$n"); done
echo "=== merged report ==="
python3 "$TOOLS/alles_report.py" --ziel "$ZIEL" "${DIRS[@]}" --quarantaene "$TOOLS/quarantaene.txt" --skips "$TOOLS/skips_decke.txt"
rc=$?
# the merged SUMMARY.md replaced the pool's: bring its selection back
if [ -s "$ZIEL/betroffen.txt" ]; then { echo; echo "## Selection (--betroffen)"; echo; sed 's/^/    /' "$ZIEL/betroffen.txt"; echo; echo "Quiet stage: $M page packages plus the core package, in parallel containers"; } >> "$ZIEL/SUMMARY.md"; fi
if [ -s "$ZIEL/flaky.txt" ]; then echo "alles: FLAKY (failed, then passed on the rerun):"; sed 's/^/alles:   /' "$ZIEL/flaky.txt"; fi
[ "$rc" != 0 ] || [ "$bad" = 0 ] || { echo "ruhig_pakete: a container ended non-zero (${RCS[*]}) but the report is green: red"; rc=1; }
exit $rc
