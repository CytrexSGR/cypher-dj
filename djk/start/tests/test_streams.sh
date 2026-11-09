#!/usr/bin/env bash
# S18 task 4: djk-stroeme (adds the multi-stream erzeuger to a running studio) and djk-start --bk-stroeme, tested WITHOUT
# systemd: djk-stroeme --trocken prints the systemd-run command line instead of running it.
# Usage: tests/test_streams.sh        Exit 0 when every point is OK, 1 otherwise.
#   P1 instance f: unit, setenv, PartOf, RestartPreventExitStatus, abo port 53165, kern port 53100, streams, name,
#      five --allow-fs-write folders, --allow-fs-read of the djk tree
#   P2 without --instanz: unit cypherdj-erzeuger-bk, port 47165, kern port 47100 (negative control: no -f suffix)
#   P3 --trocken starts nothing and touches nothing (no folder is created)
#   P4 djk-start --bk-stroeme without --strudel exits 2 before any unit starts
#   P5 djk-start --help exits 0 and names --bk-stroeme; djk-stroeme --help exits 0
#   P6 bad instance and unknown option exit 2
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
DJK=$(cd "$START/.." && pwd)
FEHL=0
ok()   { echo "OK   $1"; }
fehl() { echo "FEHL $1"; FEHL=1; }
hat()  { # $1 label, $2 text, $3 fixed string that must be in it
  if grep -qF -- "$3" <<<"$2"; then ok "$1: $3"; else fehl "$1: missing '$3' in: $2"; fi
}
nicht() { # $1 label, $2 text, $3 fixed string that must NOT be in it
  if grep -qF -- "$3" <<<"$2"; then fehl "$1: unexpected '$3' in: $2"; else ok "$1: no '$3'"; fi
}

# P1
A=$("$START/djk-stroeme" --instanz f --trocken 2>&1); RC=$?
[ "$RC" = 0 ] && ok "P1 exit 0" || fehl "P1 exit $RC: $A"
[ "$(wc -l <<<"$A")" = 1 ] && ok "P1 exactly one line" || fehl "P1 not one line: $A"
for s in "systemd-run" "--unit=cypherdj-erzeuger-bk-f" "--setenv=CYPHERDJ_INSTANZ=f" "-p PartOf=cypherdj.target" \
         "-p RestartPreventExitStatus=2" "--abo-port 53165" "--kern-port 53100" "--strom 5,6,7,9,10" "--name erzeuger-bk" \
         "--muster-basis /dev/shm/cypherdj-f/erzeuger" "--allow-fs-read=$DJK" "generator_bk.mjs" "--permission"; do
  hat "P1" "$A" "$s"
done
for n in 5 6 7 9 10; do hat "P1" "$A" "--allow-fs-write=/dev/shm/cypherdj-f/erzeuger$n"; done
N=$(grep -o -- '--allow-fs-write=' <<<"$A" | wc -l)
[ "$N" = 5 ] && ok "P1 exactly five --allow-fs-write" || fehl "P1 $N --allow-fs-write instead of 5"

# P2
B=$(env -u CYPHERDJ_INSTANZ "$START/djk-stroeme" --trocken 2>&1); RC=$?
[ "$RC" = 0 ] && ok "P2 exit 0" || fehl "P2 exit $RC: $B"
hat "P2" "$B" "--unit=cypherdj-erzeuger-bk "
hat "P2" "$B" "--abo-port 47165"
hat "P2" "$B" "--kern-port 47100"
hat "P2" "$B" "--allow-fs-write=/dev/shm/cypherdj/erzeuger5"
nicht "P2" "$B" "-bk-f"
nicht "P2" "$B" "CYPHERDJ_INSTANZ"

# P3: --trocken creates nothing
if [ -e /dev/shm/cypherdj-h ]; then fehl "P3 /dev/shm/cypherdj-h exists before the test, pick another instance"; else
  "$START/djk-stroeme" --instanz h --trocken >/dev/null 2>&1
  [ ! -e /dev/shm/cypherdj-h ] && ok "P3 --trocken created no folder" || { fehl "P3 --trocken created /dev/shm/cypherdj-h"; rm -rf /dev/shm/cypherdj-h; }
fi

# P4: needs --strudel (exit before any unit starts: the usage check comes right after option parsing)
C=$("$START/djk-start" --bk-stroeme --instanz h 2>&1); RC=$?
[ "$RC" = 2 ] && ok "P4 --bk-stroeme without --strudel exits 2" || fehl "P4 exit $RC: $C"
hat "P4" "$C" "--bk-stroeme needs --strudel"
[ ! -e /dev/shm/cypherdj-h ] && ok "P4 nothing created" || { fehl "P4 created /dev/shm/cypherdj-h"; rm -rf /dev/shm/cypherdj-h; }

# P5
H=$("$START/djk-start" --help 2>&1); RC=$?
[ "$RC" = 0 ] && ok "P5 djk-start --help exits 0" || fehl "P5 djk-start --help exit $RC"
hat "P5" "$H" "--bk-stroeme"
H2=$("$START/djk-stroeme" --help 2>&1); RC=$?
[ "$RC" = 0 ] && ok "P5 djk-stroeme --help exits 0" || fehl "P5 djk-stroeme --help exit $RC"

# P6
"$START/djk-stroeme" --instanz z --trocken >/dev/null 2>&1; RC=$?
[ "$RC" = 2 ] && ok "P6 bad instance exits 2" || fehl "P6 bad instance exit $RC"
"$START/djk-stroeme" --bogus >/dev/null 2>&1; RC=$?
[ "$RC" = 2 ] && ok "P6 unknown option exits 2" || fehl "P6 unknown option exit $RC"

[ "$FEHL" = 0 ] && echo "ALL OK" || echo "FAILED"
exit "$FEHL"
