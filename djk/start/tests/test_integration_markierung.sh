#!/usr/bin/env bash
# The tests that start real units are integration tests: they refuse to run without an explicit test instance, before anything is started.
# test_start.sh runs from a throw-away copy of the tree against stubs (pactl, systemctl, flock, pw-link on PATH log every call), so even a red run
# starts nothing real. test_target.sh skips its Z5 section (real unit of instance h, real djk-stop) unless DJK_INTEGRATION_INSTANZ=h.
# Aufruf: tests/test_integration_markierung.sh
#   M1 test_start.sh without an instance: rc 2, message names the instance, no stub was called
#   M2 test_start.sh with DJK_INTEGRATION_INSTANZ=zz (not a letter a to i): rc 2, no stub was called
#   M3 test_start.sh with an explicit instance is not refused by the guard (it may still stop at its load check)
#   M4 test_target.sh without DJK_INTEGRATION_INSTANZ prints "SKIP Z5" and does not build the Z5 fixtures
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-integration-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
mkdir -p "$O/baum/start/tests" "$O/baum/config" "$O/bin"
cp "$HIER/test_start.sh" "$O/baum/start/tests/"
[ -f "$HIER/integration.sh" ] && cp "$HIER/integration.sh" "$O/baum/start/tests/"
cp "$HIER/../../config/realtime_lock.sh" "$O/baum/config/"
printf '#!/usr/bin/env bash\necho "stop $*" >> "%s/aufrufe"\n' "$O" > "$O/baum/start/djk-stop"
chmod +x "$O/baum/start/djk-stop"
for c in pactl systemctl flock pw-link; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "%s/aufrufe"\nexit 1\n' "$c" "$O" > "$O/bin/$c"
  chmod +x "$O/bin/$c"
done
# one run of the copied test_start.sh; $1 = instance argument (may be empty), the rest = extra env assignments
lauf() {
  local arg=$1; shift
  : > "$O/aufrufe"
  env -u DJK_INTEGRATION_INSTANZ "$@" PATH="$O/bin:$PATH" CYPHERDJ_ECHTZEIT_SCHLOSS="$O/lock" \
    timeout 20 bash "$O/baum/start/tests/test_start.sh" ${arg:+"$arg"} >"$O/aus.txt" 2>&1
}

lauf ""; R=$?
[ "$R" = 2 ] && grep -q "explicit test instance" "$O/aus.txt" && [ ! -s "$O/aufrufe" ]
pruef $? "M1 no instance: rc $R, calls: $(tr '\n' ';' < "$O/aufrufe" | head -c 160)"
lauf "" DJK_INTEGRATION_INSTANZ=zz; R=$?
[ "$R" = 2 ] && [ ! -s "$O/aufrufe" ]
pruef $? "M2 instance zz: rc $R, calls: $(tr '\n' ';' < "$O/aufrufe" | head -c 160)"
lauf e; R=$?
! grep -q "explicit test instance" "$O/aus.txt"
pruef $? "M3 explicit instance e is not refused by the guard: rc $R, $(head -c 100 "$O/aus.txt" | tr '\n' ' ')"

env -u DJK_INTEGRATION_INSTANZ timeout 120 bash "$HIER/test_target.sh" >"$O/ziel.txt" 2>&1
grep -q "^SKIP Z5" "$O/ziel.txt" && ! grep -q "Z5 Aufbau" "$O/ziel.txt"
pruef $? "M4 test_target.sh without the variable skips Z5: $(grep -m1 'Z5' "$O/ziel.txt" | head -c 120)"
echo "ERGEBNIS $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
