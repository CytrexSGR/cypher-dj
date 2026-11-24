#!/usr/bin/env bash
# build_rc.sh <version> <export tree>
# Builds cypher-dj_<version>_amd64.deb from a public export tree (docs/veroeffentlichung/export.py) with
# docs/veroeffentlichung/paket/baue_deb.sh inside the Ubuntu 24.04 build image (Containerfile next to this script) and
# leaves the .deb and its .sha256 in $CDJ_CI_DIR/out/. Warm builds: the cargo registry, rustup, ccache, pnpm/npm caches,
# the Strudel checkout and the baue_deb work tree live in named podman volumes (cdj-*).
# Environment: CDJ_CPUSET (CPU list for the build container via taskset, e.g. 24-31; empty = no restriction), CDJ_CI_DIR (state folder, default ~/cypherdj-ci), PAKET (folder of baue_deb.sh, default: the one of this
# checkout), JOBS (16), CLEAN=1 (fresh work tree, the cache volumes stay), BUDGET_MB (1500: the build container is killed
# when the host downloads more than this since the start, image build included; 0 = no limit).
# Writes $CDJ_CI_DIR/out/build-<version>.log and build-<version>.stats (wall time per phase, download volume).
# Exit 0 ok, 1 build failed, 2 usage, 3 download budget exceeded.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <version> <export tree>" >&2; exit 2; }
VERSION=$1
CI=${CDJ_CI_DIR:-$HOME/cypherdj-ci}; HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
EXPORT=$(realpath "$2"); PAKET=${PAKET:-$(realpath "$HERE/../../../../docs/veroeffentlichung/paket")}
JOBS=${JOBS:-16}; BUDGET_MB=${BUDGET_MB:-1500}; IMAGE=localhost/cdj-bau:24.04
OUT=$CI/out; mkdir -p "$OUT"
LOG=$OUT/build-$VERSION.log; STATS=$OUT/build-$VERSION.stats
[ -f "$EXPORT/djk/core/CMakeLists.txt" ] || { echo "baue_rc: $EXPORT is not an export tree" >&2; exit 2; }
[ -f "$PAKET/baue_deb.sh" ] || { echo "baue_rc: $PAKET/baue_deb.sh missing" >&2; exit 2; }

IF=$(ip route show default | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')
rx() { cat "/sys/class/net/$IF/statistics/rx_bytes"; }
RX0=$(rx); T0=$(date +%s); : > "$STATS"; : > "$LOG"
note() { printf '%s\n' "$*" | tee -a "$STATS"; }
note "version $VERSION  start $(date -Is)  interface $IF  jobs $JOBS"

# watchdog: stop the build container when the download budget is spent
rm -f "$OUT/.budget-$VERSION"
if [ "$BUDGET_MB" != 0 ]; then
  ( while sleep 5; do
      if [ $(( ($(rx) - RX0) / 1048576 )) -gt "$BUDGET_MB" ]; then
        echo "baue_rc: download budget of $BUDGET_MB MiB exceeded, stopping" | tee -a "$STATS" >> "$LOG"
        echo over > "$OUT/.budget-$VERSION"; podman kill cdj-bau-run >/dev/null 2>&1 || true; exit
      fi
    done ) &
  WD=$!; trap 'kill $WD 2>/dev/null || true' EXIT
fi

phase() { note "phase $1  wall $(( $(date +%s) - T1 )) s  download $(( ($(rx) - R1) / 1048576 )) MiB"; }
T1=$(date +%s); R1=$(rx)
podman build -q -t "$IMAGE" -f "$HERE/Containerfile" "$HERE" >/dev/null 2>>"$LOG" || { echo "baue_rc: image build failed (see $LOG)" >&2; exit 1; }
phase image
[ ! -f "$OUT/.budget-$VERSION" ] || exit 3

[ "${CLEAN:-0}" != 1 ] || podman volume rm -f cdj-work >/dev/null
INCR=1; [ "${CLEAN:-0}" != 1 ] || INCR=0
T1=$(date +%s); R1=$(rx)
podman rm -f cdj-bau-run >/dev/null 2>&1 || true
# CDJ_CPUSET: taskset on the podman client; conmon and the container inherit the affinity (rootless podman has no cpuset cgroup controller, so --cpuset-cpus fails)
${CDJ_CPUSET:+taskset -c "$CDJ_CPUSET"} podman run --name cdj-bau-run --rm --userns=keep-id \
  -v cdj-work:/work -v cdj-cargo:/home/bau/.cargo -v cdj-rustup:/home/bau/.rustup -v cdj-ccache:/home/bau/.cache/ccache \
  -v cdj-pnpm:/home/bau/.local/share/pnpm -v cdj-pnpmcache:/home/bau/.cache/pnpm -v cdj-npm:/home/bau/.npm \
  -v cdj-strudel:/home/bau/strudel \
  -v "$EXPORT":/export:ro -v "$PAKET":/paket:ro -v "$OUT":/out \
  -e JOBS="$JOBS" -e INCREMENTAL="$INCR" -e STRUDEL_SRC=/home/bau/strudel \
  "$IMAGE" bash -c '. "$HOME/.cargo/env" 2>/dev/null || true; /paket/baue_deb.sh /export "$0" /work && cp -f /work/cypher-dj_"$0"_amd64.deb /out/' "$VERSION" >>"$LOG" 2>&1 \
  || { rc=$?; [ -f "$OUT/.budget-$VERSION" ] && exit 3; echo "baue_rc: build failed rc $rc (see $LOG)" >&2; exit 1; }
phase build
DEB=$OUT/cypher-dj_${VERSION}_amd64.deb
[ -f "$DEB" ] || { echo "baue_rc: no .deb produced" >&2; exit 1; }
( cd "$OUT" && sha256sum "$(basename "$DEB")" > "$(basename "$DEB").sha256" )
note "total wall $(( $(date +%s) - T0 )) s  download $(( ($(rx) - RX0) / 1048576 )) MiB"
note "deb $(stat -c %s "$DEB") bytes  $(cat "$DEB.sha256")"
