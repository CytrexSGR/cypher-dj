#!/usr/bin/env bash
# release.sh <version> [--trocken]
# Sets the release tag v<version> from the owner's machine and pushes only that tag; the tag starts the package workflow of the CI
# (build, smoke test in a VM, release with the package). <version> is X.Y.Z or X.Y.Z-suffix (0.4.0, 0.4.0-rc1); the package gets X.Y.Z~suffix.
#
# Why here and not on the runner: the export sieve compares the export with the owner's project names, and those never leave this machine.
# So the sieve runs here with the real names, and the runner trusts that it ran (paket.yml says so in its log).
#
# Refuses, creating nothing, when
#   - the working tree is not clean (tracked changes or untracked files),
#   - HEAD is not contained in origin/main (after a fetch),
#   - the tag already exists locally or on origin,
#   - the export sieve (docs/veroeffentlichung/export.py, the call the local export uses, default project folders) reports any finding
#     or checked no project name at all (an empty or missing project folder must not pass the privacy gate),
#   - CHANGELOG.md (docs/veroeffentlichung/public/CHANGELOG.md) has no section for the version.
# Then: annotated tag v<version> on HEAD, `git push origin refs/tags/v<version>` (nothing else). --trocken stops before the tag.
# Exit 0 done (or dry run passed), 1 refused, 2 usage.
set -uo pipefail
HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
VERSION=${1:-}; TROCKEN=0; [ "${2:-}" = --trocken ] && TROCKEN=1
[ -n "$VERSION" ] && { [ $# -eq 1 ] || [ "${2:-}" = --trocken ]; } || { echo "usage: $0 <version> [--trocken]" >&2; exit 2; }
PKGV=$("$HERE/paket/version_off_tag.sh" "$VERSION") || exit 2
TAG=v${VERSION#v}
nein() { echo "release.sh: refused: $*" >&2; exit 1; }
g() { git -C "$REPO" "$@"; }

[ -z "$(g status --porcelain)" ] || nein "the working tree is not clean ($(g status --porcelain | wc -l) entries); commit or remove them first"
g fetch -q origin main || nein "cannot fetch origin/main"
g merge-base --is-ancestor HEAD origin/main || nein "HEAD $(g rev-parse --short HEAD) is not on origin/main; push it to main first (or check out main)"
g rev-parse -q --verify "refs/tags/$TAG" >/dev/null && nein "tag $TAG already exists locally"
[ -z "$(g ls-remote --tags origin "refs/tags/$TAG")" ] || nein "tag $TAG already exists on origin"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "export sieve with the real project names (the local export call) ..."
if ! python3 "$REPO/docs/veroeffentlichung/export.py" "$TMP/export" --bericht "$TMP/bericht.txt" > "$TMP/export.out" 2>&1; then
  tail -5 "$TMP/export.out" >&2; head -30 "$TMP/bericht.txt" >&2 || true
  nein "the export sieve has findings (report above); fix them first"
fi
tail -2 "$TMP/export.out"
NAMEN=$(sed -n 's/^project names checked \([0-9][0-9]*\).*/\1/p' "$TMP/export.out" | tail -1)
[ -n "$NAMEN" ] && [ "$NAMEN" -gt 0 ] || nein "no project name was checked (${NAMEN:-no count reported}); the project folders are missing or empty, so the privacy gate would pass empty"
python3 -I "$HERE/paket/changelog_abschnitt.py" "$REPO/docs/veroeffentlichung/public/CHANGELOG.md" "$PKGV" > "$TMP/abschnitt.md" \
  || nein "CHANGELOG.md has no section for version $PKGV"
echo "changelog section: $(head -1 "$TMP/abschnitt.md")"

if [ "$TROCKEN" = 1 ]; then echo "dry run passed: would tag $TAG at $(g rev-parse --short HEAD) (package $PKGV) and push only that tag"; exit 0; fi
g tag -a "$TAG" -m "cypher-dj $PKGV" || nein "could not create the tag"
g push origin "refs/tags/$TAG" || { g tag -d "$TAG" >/dev/null; nein "pushing the tag failed; the local tag is removed again"; }
echo "tag $TAG at $(g rev-parse --short HEAD) pushed; the runner builds package $PKGV"
