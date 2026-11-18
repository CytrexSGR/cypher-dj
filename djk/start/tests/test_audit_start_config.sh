#!/usr/bin/env bash
# Audit U30 repro for djk-start, without units, without PipeWire, without sound: everything runs through --vorlagen-nach (templates into a
# throwaway folder); nothing here starts or stops a unit.
# Aufruf: tests/test_audit_start_config.sh
#   U30 --kern-konfig / --leitstand-konfig naming a file whose FOLDER does not exist -> Rückgabe 2 and the file named (not the default config)
# Rückgabe: 0 alle Punkte OK, 1 mindestens einer FEHL.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-audit-start-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
SYS="$O/sys"; mkdir -p "$SYS"
for c in $(seq 0 15); do mkdir -p "$SYS/cpu$c/topology"; echo $((c % 8)) > "$SYS/cpu$c/topology/core_id"; echo 0 > "$SYS/cpu$c/topology/physical_package_id"; done
echo 0-15 > "$SYS/online"
export CYPHERDJ_SYSFS_CPU="$SYS"
unset CYPHERDJ_KERN_KERNE CYPHERDJ_KERN_CPUS CYPHERDJ_STEMS_CPUS

# U30
for opt in --kern-konfig --leitstand-konfig; do
  timeout 5 "$START/djk-start" --instanz i --vorlagen-nach "$O/v" "$opt" "$O/gibtsnicht/x.toml" > "$O/u30.txt" 2>&1; R=$?
  [ "$R" = 2 ] && grep -q "gibtsnicht/x.toml" "$O/u30.txt"
  pruef $? "U30 $opt with a missing folder: Rückgabe $R (erwartet 2): $(head -1 "$O/u30.txt")"
  rm -rf "$O/v"
done
# Negativ-Kontrolle: the default start without the option still works
timeout 5 "$START/djk-start" --instanz i --vorlagen-nach "$O/v" > "$O/u30n.txt" 2>&1; R=$?
pruef $([ "$R" = 0 ]; echo $?) "U30 Negativ-Kontrolle ohne Option: Rückgabe $R"

echo "Ergebnis: $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
