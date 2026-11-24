#!/usr/bin/env bash
# sieb.sh: runs the public export sieve (docs/veroeffentlichung/export.py) over the checked-out tree, so a finding
# (host name, local path, project name, German doc without English version ...) shows at push time instead of at tag time.
# The runner holds no project folders: an empty folder is passed, so project names are not checked here; release.sh
# still checks them with the owner's folders before a tag.
# Exit 0 no finding, 1 findings (listed), 2 the sieve could not run.
set -uo pipefail
REPO=${SIEB_REPO:-$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)}
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/keine-projekte"
python3 "$REPO/docs/veroeffentlichung/export.py" "$T/export" --projekte-ordner "$T/keine-projekte" \
  --bericht "$T/bericht.txt" > "$T/out.txt" 2>&1
rc=$?
grep -E '^dateien ' "$T/out.txt" || true
[ $rc -eq 0 ] && { echo "export sieve: no finding"; exit 0; }
if [ $rc -eq 1 ] && grep -q '^dateien .* funde [1-9]' "$T/out.txt"; then
  n=$(grep -c . "$T/bericht.txt")
  echo "::error::export sieve: $n finding(s); the next release tag would be refused. Kind, file:line, text:"
  head -60 "$T/bericht.txt"
  [ "$n" -gt 60 ] && echo "... $((n - 60)) more"
  exit 1
fi
echo "::error::export sieve could not run (exit $rc):"
tail -20 "$T/out.txt"
exit 2
