#!/usr/bin/env bash
# version_off_tag.sh <tag-or-version>: prints the package version for a release tag.
#   v0.4.0       -> 0.4.0
#   v0.4.0-rc1   -> 0.4.0~rc1    (a pre-release must sort BEFORE the final version in dpkg; the tilde does that, a hyphen does not)
# The leading v is optional. Every hyphen after the numbers becomes a tilde. Exit 2 when the text is not X.Y.Z or X.Y.Z-suffix.
set -eu
t=${1:-}; t=${t#v}
[[ "$t" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)*$ ]] || { echo "version_aus_tag: '$1' is not vX.Y.Z or vX.Y.Z-suffix" >&2; exit 2; }
printf '%s\n' "${t//-/\~}"
