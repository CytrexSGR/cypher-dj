#!/usr/bin/env bash
# Runs every test_*.sh of a folder for alles.sh (suite start-sh), one at a time, and prints one marker line per test:
#   SHELL ok <file>               exit 0
#   SHELL skip-last <file>        exit 77: the test refused under load or a busy lock ("SKIP load: ..." line in its output)
#   SHELL skip-integration <file> exit 2 with "explicit test instance": an integration test, not run by the gate on purpose
#   SHELL FAIL <file>             anything else
# Exit code: 1 when any test failed, else 0 (a skip is not a failure; alles_report.py reports it and the gate is not green for load skips).
cd "${1:?folder}" || exit 2
alle=0
for f in test_*.sh; do
  env -u DJK_INTEGRATION_INSTANZ timeout 900 bash "$f" > "$f.out" 2>&1
  rc=$?
  cat "$f.out"
  if [ "$rc" = 0 ]; then r=ok
  elif [ "$rc" = 77 ]; then r=skip-last
  elif [ "$rc" = 2 ] && grep -q "explicit test instance" "$f.out"; then r=skip-integration
  else r=FAIL; alle=1; fi
  rm -f "$f.out"
  echo "SHELL $r $f"
done
exit "$alle"
