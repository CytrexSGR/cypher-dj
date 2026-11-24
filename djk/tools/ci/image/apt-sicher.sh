#!/bin/bash
# apt-sicher.sh PACKAGE...  installs the packages like `apt-get install`, but first adds up the download size apt would fetch
# (--print-uris) and stops with a message when it is more than 1 GB. Used by the Containerfile for every apt step.
set -euo pipefail
GRENZE=1073741824
apt-get update
summe=$(apt-get install -y --no-install-recommends --print-uris "$@" | awk "/^'/ {s+=\$3} END {printf \"%d\", s}")
if [ "${summe:-0}" -gt "$GRENZE" ]; then
  echo "apt-sicher: STOP, these packages would download $summe bytes (limit $GRENZE, 1 GB). Nothing was installed." >&2
  exit 3
fi
echo "apt-sicher: download size $summe bytes" >&2
apt-get install -y --no-install-recommends "$@"
rm -rf /var/lib/apt/lists/*
