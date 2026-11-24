#!/usr/bin/env bash
# check_deb.sh <deb> [result dir]
# Smoke test of a cypher-dj .deb in a fresh Ubuntu KVM VM (SMOKE_RELEASE=noble (24.04, default) or resolute (26.04) cloud image, qcow2 overlay: the
# base image stays clean). First a static check: no librubberband in Depends, none NEEDED by cypherdj-render and cypherdj-kern.
# Provisions PipeWire and a null sink, makes the compilers unusable, installs the .deb as `tester`, real-time fix, `cypher-dj start`,
# `cypher-dj demo` with the master peak over a fixed window after the transport runs (above -30 dBFS), tour.sh through the write paths
# of the agent tools, `find /opt/cypher-dj -newer <stamp>` (nothing), sounds on the null sink measured with parec (Strudel, RB-338,
# Baukasten bass-acid: peak above -40 dBFS, silence after stop), journal without EACCES/EROFS, `cypher-dj mcp` plus mcp_probe.mjs
# (tool count), `cypher-dj stop`.
# The VM boot block is vmlib.sh, the guest side is gast_smoke.sh (+ gast_lib.sh), the verdict is verdict_smoke.py. tour.sh and mcp_probe.mjs
# come from PAKET (default: docs/veroeffentlichung/paket of this checkout).
# Environment: SMOKE_RELEASE (noble|resolute), CDJ_CI_DIR (default ~/cypherdj-ci), PAKET, VM_CPUS (8), VM_MEM (16G), SSH_PORT (2223), KEEP=1 (leave the VM running).
# Result: <result dir>/smoke.json, smoke.txt, guest.log (default <CDJ_CI_DIR>/out/smoke-<version>/). Exit 0 all checks pass, 1 a check failed, 2 setup problem.
set -uo pipefail
HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
PAKET=${PAKET:-$(realpath "$HERE/../../../../docs/veroeffentlichung/paket")}
DEB=${1:-}; [ -f "$DEB" ] || { echo "usage: $0 <deb> [result dir]" >&2; exit 2; }
DEB=$(realpath "$DEB")
VERSION=$(dpkg-deb -f "$DEB" Version) || { echo "pruefe_deb: not a .deb" >&2; exit 2; }
CI=${CDJ_CI_DIR:-$HOME/cypherdj-ci}
RES=$(realpath -m "${2:-$CI/out/smoke-$VERSION}"); mkdir -p "$RES"
say() { echo "$*" | tee -a "$RES/smoke.txt"; }
: > "$RES/smoke.txt"
die() { say "SETUP PROBLEM: $*"; exit 2; }
. "$HERE/vmlib.sh"

# static facts of the one package for both releases: no librubberband soname in Depends, none NEEDED by the two binaries that use it
if dpkg-deb -f "$DEB" Depends | grep -q librubberband; then die "Depends names a librubberband package: $(dpkg-deb -f "$DEB" Depends)"; fi
TMPX=$(mktemp -d); trap 'rm -rf "$TMPX"; vm_notaus' EXIT
dpkg-deb --fsys-tarfile "$DEB" | tar -x -C "$TMPX" ./opt/cypher-dj/djk/core/build/cypherdj-render ./opt/cypher-dj/djk/core/build/cypherdj-kern || die "cannot extract the core binaries"
for b in cypherdj-render cypherdj-kern; do
  readelf -d "$TMPX/opt/cypher-dj/djk/core/build/$b" > "$RES/needed-$b.txt" || die "readelf failed on $b"
  if grep -q 'NEEDED.*librubberband' "$RES/needed-$b.txt"; then die "$b needs librubberband.so (static link missing)"; fi
done
say "static check ok: no librubberband in Depends, none NEEDED by cypherdj-render and cypherdj-kern"

vm_boot
vm_copy "$DEB" "$PAKET/tour.sh" "$PAKET/mcp_probe.mjs" "$HERE/gast_smoke.sh" "$HERE/gast_lib.sh"
HOSTSHA=$(sha256sum "$DEB" | cut -d' ' -f1)
vm 'bash ~/gast_smoke.sh' > "$RES/guest.log" 2>&1
GRC=$?
[ "$GRC" -le 1 ] || say "guest script ended with rc $GRC"
[ "${KEEP:-0}" = 1 ] || vm_stop

python3 -I "$HERE/verdict_smoke.py" "$RES" "$HOSTSHA" "$VERSION" > "$RES/verdict.txt"
cat "$RES/verdict.txt" | tee -a "$RES/smoke.txt"
grep -q '^RESULT PASS' "$RES/verdict.txt"
