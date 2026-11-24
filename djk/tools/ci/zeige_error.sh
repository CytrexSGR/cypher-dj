#!/usr/bin/env bash
# Prints the evidence of every failed suite of a gate run (the job workspace is deleted afterwards, the job log is all that stays):
#   djk/tools/ci/zeige_error.sh [.ci-ergebnis]
# Per suite with exit != 0: the failing TAP blocks (not ok + the 25 lines after it), else the last 40 lines of the log.
D=${1:-.ci-ergebnis}
for m in "$D"/*.meta; do
  [ -f "$m" ] || continue
  grep -qx 'exit=0' "$m" && continue
  s=$(basename "$m" .meta)
  echo "=== $s ($(grep -h '^exit=' "$m"))"
  if grep -q '^ *not ok' "$D/$s.log" 2>/dev/null; then
    grep -A25 '^ *not ok' "$D/$s.log" | cut -c1-300 | head -150
  else
    tail -40 "$D/$s.log" 2>/dev/null | cut -c1-300
  fi
done
exit 0
