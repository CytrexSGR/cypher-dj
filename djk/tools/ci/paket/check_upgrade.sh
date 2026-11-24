#!/usr/bin/env bash
# check_upgrade.sh <old.deb> <new.deb> [result dir]
# Upgrade check in a fresh Ubuntu 24.04 KVM VM (qcow2 overlay over the noble cloud image): install <old.deb> as `tester`, make user data
# (project "upgrade-probe" with a real four-second take through /proj/aufnahme, plus a user preset through POST /presets), stop, snapshot;
# install <new.deb> over it; the studio starts again (units active, none failed), the project opens with its take byte-identical, the preset
# is still there and reads back with its values, `cypher-dj demo` plays (master above -30 dBFS), no user file lost or changed except
# program-owned state (the upgrade rule of upgrade_vergleich.py), no EACCES/EROFS and no error from a cypherdj unit in the user journal.
# The VM boot block is vmlib.sh; the guest side is gast_upgrade.sh, which calls PAKET/tests/upgrade_gast.sh (vorher / nachher) with
# upgrade_vergleich.py and gast_lib.sh; the verdict is verdict_upgrade.py.
# Environment: CDJ_CI_DIR (default ~/cypherdj-ci), PAKET, VM_CPUS (8), VM_MEM (16G), SSH_PORT (2223), KEEP=1 (leave the VM running).
# Result: <result dir>/upgrade.json, upgrade.txt, guest.log (default <CDJ_CI_DIR>/out/upgrade-<old>-to-<new>/). Exit 0 pass, 1 a check failed, 2 setup problem.
set -uo pipefail
HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
PAKET=${PAKET:-$(realpath "$HERE/../../../../docs/veroeffentlichung/paket")}
OLD=${1:-}; NEW=${2:-}; [ -f "$OLD" ] && [ -f "$NEW" ] || { echo "usage: $0 <old.deb> <new.deb> [result dir]" >&2; exit 2; }
OLD=$(realpath "$OLD"); NEW=$(realpath "$NEW")
OLDV=$(dpkg-deb -f "$OLD" Version) && VERSION=$(dpkg-deb -f "$NEW" Version) || { echo "pruefe_upgrade: not a .deb" >&2; exit 2; }
dpkg --compare-versions "$VERSION" gt "$OLDV" || { echo "pruefe_upgrade: $VERSION is not greater than $OLDV" >&2; exit 2; }
CI=${CDJ_CI_DIR:-$HOME/cypherdj-ci}
RES=$(realpath -m "${3:-$CI/out/upgrade-$OLDV-to-$VERSION}"); mkdir -p "$RES"
say() { echo "$*" | tee -a "$RES/upgrade.txt"; }
: > "$RES/upgrade.txt"
die() { say "SETUP PROBLEM: $*"; exit 2; }
. "$HERE/vmlib.sh"

vm_boot
vm_copy "$OLD" "$NEW" "$PAKET/tests/upgrade_gast.sh" "$PAKET/tests/upgrade_vergleich.py" "$HERE/gast_upgrade.sh" "$HERE/gast_lib.sh"
say "upgrade check: $OLDV -> $VERSION ($(basename "$OLD") sha256 $(sha256sum "$OLD" | cut -c1-12), $(basename "$NEW") sha256 $(sha256sum "$NEW" | cut -c1-12))"
vm 'bash ~/gast_upgrade.sh' > "$RES/guest.log" 2>&1
GRC=$?
[ "$GRC" -le 1 ] || say "guest script ended with rc $GRC"
mkdir -p "$RES/snapshots"
for f in vorher.txt nachher-1.txt nachher-2.txt nachher-3.txt notes-vorher.txt notes-nachher.txt geliefert.txt; do vm "cat ~/upgrade/out/$f" > "$RES/snapshots/$f" 2>/dev/null; done
[ "${KEEP:-0}" = 1 ] || vm_stop

python3 -I "$HERE/verdict_upgrade.py" "$RES" "$OLDV" "$VERSION" > "$RES/verdict.txt"
cat "$RES/verdict.txt" | tee -a "$RES/upgrade.txt"
grep -q '^RESULT PASS' "$RES/verdict.txt"
