#!/usr/bin/env bash
# What the quick job measures its change against: the newest commit of this branch (an ancestor of HEAD that main does not have) that has a
# green OR red marker (green: $CI_GRUEN, default ~/cypherdj-ci/gruen/<sha>; red: $CI_ROT, default ~/cypherdj-ci/rot/<sha>; both written by
# sichere_ergebnis.sh), else the merge base with main. A red run tested everything it selected except the suites it lists, so the next run
# needs only the change since then plus those suites. A commit with both markers counts as green.
#   djk/tools/ci/gruene_basis.sh [main ref, default origin/main]        run inside the checkout
# Prints one line: "<ref> <kind>"
#   <sha> delta   the last green commit of the branch: only what the branch changed since then is tested
#   <sha> rot <suite,suite,...>  the last red commit of the branch: what the branch changed since then plus those whole suites (alles.sh --auch)
#   <sha> merge   the merge base with main: the whole change of the branch is tested (what a fast-forward merge needs)
#   -     merge   no merge base: the caller runs the whole gate (which covers the same ground as the merge base run)
# For rot the caller records basis=delta. The kind is what sichere_ergebnis.sh records in the marker (basis=...): the full job on main skips a commit only when it was green with basis=merge.
set -u
MAIN=${1:-origin/main}
G=${CI_GRUEN:-$HOME/cypherdj-ci/gruen}
R=${CI_ROT:-$HOME/cypherdj-ci/rot}
MB=$(git merge-base HEAD "$MAIN" 2>/dev/null) || { echo "- merge"; exit 0; }
HEAD_SHA=$(git rev-parse HEAD)
# newest first; only commits the branch added (a shallow checkout holds no more than the way down to the merge base)
while read -r c; do
  [ "$c" = "$HEAD_SHA" ] && continue
  if [ -e "$G/$c" ]; then echo "$c delta"; exit 0; fi
  if [ -s "$R/$c" ]; then
    su=$(sed -n 's/^suites=//p' "$R/$c" | head -n 1 | tr -cd 'a-z0-9,_-')
    [ -n "$su" ] || continue   # a red marker without suites tells nothing: look further down
    echo "$c rot $su"; exit 0
  fi
done < <(git rev-list HEAD "^$MB" 2>/dev/null)
echo "$MB merge"
