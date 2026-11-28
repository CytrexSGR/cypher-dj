#!/usr/bin/env bash
# Prints the evidence of every failed suite of a gate run (the job workspace is deleted afterwards, the job log is all that stays):
#   djk/tools/ci/zeige_error.sh [.ci-ergebnis]
# Per suite with exit != 0: the failing TAP blocks (not ok + the 25 lines after it), else the last 40 lines of the log.
D=${1:-.ci-ergebnis}
# Pin drift first: failing tests whose text carries "[pin]" (ui/tests/support/pins.mjs) are a re-pin, not a bug; one command fixes them.
# A 'not ok' line is counted as pin drift when the [pin] marker stands in the 25 lines after it (the assertion message of its block).
pin=0; alle=0
for m in "$D"/*.meta "$D"/ruhig-*/*.meta; do
  [ -f "$m" ] || continue
  grep -qx 'exit=0' "$m" && continue
  l="$(dirname "$m")/$(basename "$m" .meta).log"
  [ -f "$l" ] || continue
  a=$(grep -c '^ *not ok' "$l"); p=$(grep -A25 '^ *not ok' "$l" | awk '/^ *not ok/{if(b&&h)n++;b=1;h=0} /\[pin\]/{h=1} END{if(b&&h)n++;print n+0}')
  alle=$((alle + a)); pin=$((pin + p))
done
[ "$alle" -gt 0 ] && echo "$pin of $alle failing tests are pin drift only: run djk/tools/pins_follow_up.sh"
for m in "$D"/*.meta "$D"/ruhig-*/*.meta; do
  [ -f "$m" ] || continue
  grep -qx 'exit=0' "$m" && continue
  s=$(basename "$m" .meta); L="$(dirname "$m")/$s.log"
  echo "=== $s ($(grep -h '^exit=' "$m"))"
  if grep -q '^ *not ok' "$L" 2>/dev/null; then
    grep -A25 '^ *not ok' "$L" | cut -c1-300 | head -150
  else
    tail -40 "$L" 2>/dev/null | cut -c1-300
  fi
done
exit 0
