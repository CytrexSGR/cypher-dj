#!/usr/bin/env bash
# Audit U31 repro for djk-start, without units, without PipeWire, without sound. abbruch() is run against a stub djk-stop; the calls to the
# other two helpers are checked in the script text (a real run of an empty instance would touch the production start).
# Aufruf: tests/test_audit_start_instance.sh
#   U31 djk-start passes the instance to its helpers (djk-stop, djk-instrumente, djk-stroeme) explicitly, also when it is empty,
#       so an exported CYPHERDJ_INSTANZ cannot redirect the rollback to another instance.
# Rückgabe: 0 alle Punkte OK, 1 mindestens einer FEHL.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-audit-start-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
# U31 abbruch() against a stub djk-stop that records its arguments; the exported CYPHERDJ_INSTANZ is a different instance
mkdir -p "$O/hier"
printf '#!/usr/bin/env bash\nprintf "<%%s>" "$@" > "%s/stop-args"\n' "$O" > "$O/hier/djk-stop"; chmod +x "$O/hier/djk-stop"
sed -n '/^abbruch() {/,/^}/p' "$START/djk-start" > "$O/abbruch.sh"
[ -s "$O/abbruch.sh" ]; pruef $? "U31 abbruch() found in djk-start"
for I in "" b; do
  rm -f "$O/stop-args"
  ( HIER="$O/hier"; export CYPHERDJ_INSTANZ=a; I=$I; . "$O/abbruch.sh"; abbruch "test" "" ) > /dev/null 2>&1
  ERW="<--instanz><$I><--still>"
  [ "$(cat "$O/stop-args" 2>/dev/null)" = "$ERW" ]
  pruef $? "U31 abbruch with I='$I' and CYPHERDJ_INSTANZ=a calls djk-stop with $ERW, got: $(cat "$O/stop-args" 2>/dev/null)"
done
# the other helper calls: never the ${I:+...} form, always --instanz "$I"
N=$(grep -cE '"\$HIER/djk-(stop|instrumente|stroeme)" \$\{I:\+' "$START/djk-start")
pruef $([ "$N" = 0 ]; echo $?) "U31 no helper call of djk-start drops --instanz when it is empty ($N calls with the \${I:+...} form)"
M=$(grep -cE '"\$HIER/djk-(stop|instrumente|stroeme)" --instanz "\$I"' "$START/djk-start")
pruef $([ "$M" = 5 ]; echo $?) "U31 five helper calls pass --instanz \"\$I\" ($M found)"

echo "Ergebnis: $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
