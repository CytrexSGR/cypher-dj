#!/usr/bin/env bash
# Keeps the logs of a gate run on the runner after the job workspace is deleted (the job log shows only the failing blocks):
#   djk/tools/ci/sichere_ergebnis.sh [.ci-ergebnis] [name] [sha]     copy to $CI_ERGEBNISSE (default ~/cypherdj-ci/ci-ergebnis)/<name>, keep the newest 6
# With a commit sha and a GREEN summary it leaves the marker $CI_GRUEN (default ~/cypherdj-ci/gruen)/<sha> (content: the run name and the kind
# `basis=...`, the 4th argument: merge = the tests were chosen against the merge base with main, delta = against the last green commit of the branch,
# full = a main run, the default). The full job on main runs nothing for a commit that was green on a branch with basis=merge only: after a delta
# run the rest of the branch's change was never tested. The quick job of a later push measures against the newest ancestor with a marker
# (gruene_basis.sh). The newest 50 markers are kept.
# A RED summary with a sha leaves the red marker $CI_ROT (default ~/cypherdj-ci/rot)/<sha> instead: the run name, `basis=<kind>`, `ref=<the commit or merge base the
# run measured against>` (the 5th argument) and `suites=a,b` (the base suites listed under "Failing tests (gate)"; the packages ui-ruhig-N count as ui-ruhig). The next quick
# run of the branch tests what changed since that commit plus those whole suites (gruene_basis.sh prints `<sha> rot <suites>`). No marker when no suite can be named
# (a suite that did not run, a folder without result): that run then measures against the older basis. The newest 50 red markers are kept.
# The flaky list of the run (flaky.txt: suite, test) is appended to $CI_ERGEBNISSE/flaky-verlauf.txt, which is never cleaned: a test that shows up in 3 runs is the next one to fix.
D=${1:-.ci-ergebnis}; N=${2:-lauf}; SHA=${3:-}; ART=${4:-full}; REF=${5:-}
Z=${CI_ERGEBNISSE:-$HOME/cypherdj-ci/ci-ergebnis}
[ -d "$D" ] || exit 0
mkdir -p "$Z" && rm -rf "${Z:?}/$N" && cp -r "$D" "$Z/$N"
[ -s "$D/flaky.txt" ] && sed "s#^#$(date -u +%FT%TZ) $N\t#" "$D/flaky.txt" >> "$Z/flaky-verlauf.txt"
ls -dt "$Z"/*/ 2>/dev/null | tail -n +7 | xargs -r rm -rf
if [ -n "$SHA" ] && grep -q '^Result: GREEN' "$D/SUMMARY.md" 2>/dev/null; then
  G=${CI_GRUEN:-$HOME/cypherdj-ci/gruen}; mkdir -p "$G" && printf '%s\nbasis=%s\n' "$N" "$ART" > "$G/$SHA"
  ls -t "$G" | tail -n +51 | sed "s#^#$G/#" | xargs -r rm -f
fi
if [ -n "$SHA" ] && grep -q '^Result: RED' "$D/SUMMARY.md" 2>/dev/null && ! grep -q '^## Not run' "$D/SUMMARY.md"; then
  # suites: the "### <suite>" headings of the section "## Failing tests (gate)"; a heading that is no suite name (e.g. "folder ruhig-1") makes the list unusable
  SU=$(awk '/^## /{f=($0 ~ /^## Failing tests \(gate\)/)} f && /^### /{sub(/^### /,""); print}' "$D/SUMMARY.md" | sed 's/^ui-ruhig-[0-9][0-9]*$/ui-ruhig/' | sort -u)
  if [ -n "$SU" ] && ! printf '%s\n' "$SU" | grep -qv '^[a-z0-9_-]*$'; then
    R=${CI_ROT:-$HOME/cypherdj-ci/rot}; mkdir -p "$R" && printf '%s\nbasis=%s\nref=%s\nsuites=%s\n' "$N" "$ART" "$REF" "$(printf '%s' "$SU" | paste -sd,)" > "$R/$SHA"
    ls -t "$R" | tail -n +51 | sed "s#^#$R/#" | xargs -r rm -f
  fi
fi
exit 0
