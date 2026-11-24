#!/usr/bin/env bash
# Keeps the logs of a gate run on the runner after the job workspace is deleted (the job log shows only the failing blocks):
#   djk/tools/ci/sichere_ergebnis.sh [.ci-ergebnis] [name]     copy to $CI_ERGEBNISSE (default ~/cypherdj-ci/ci-ergebnis)/<name>, keep the newest 6
# The flaky list of the run (flaky.txt: suite, test) is appended to $CI_ERGEBNISSE/flaky-verlauf.txt, which is never cleaned: a test that shows up in 3 runs is the next one to fix.
D=${1:-.ci-ergebnis}; N=${2:-lauf}
Z=${CI_ERGEBNISSE:-$HOME/cypherdj-ci/ci-ergebnis}
[ -d "$D" ] || exit 0
mkdir -p "$Z" && rm -rf "${Z:?}/$N" && cp -r "$D" "$Z/$N"
[ -s "$D/flaky.txt" ] && sed "s#^#$(date -u +%FT%TZ) $N\t#" "$D/flaky.txt" >> "$Z/flaky-verlauf.txt"
ls -dt "$Z"/*/ 2>/dev/null | tail -n +7 | xargs -r rm -rf
exit 0
