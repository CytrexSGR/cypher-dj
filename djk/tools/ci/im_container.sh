#!/usr/bin/env bash
# Runs a command inside the CI test container (localhost/cypherdj-test:latest).
#
#   djk/tools/ci/im_container.sh <cmd...>
#
# The repo checkout is mounted read-write at the same path it has on the host and is the working
# directory of the command. The container is removed afterwards and capped at CI_MEMORY (default 8g) of memory.
# CI_CPUS caps the CPUs of the container (podman --cpus; unset: no cap). Parallel containers (ruhig_pakete.sh) use it so one cannot take the machine.
# If the host has a CDI description of an NVIDIA GPU (/etc/cdi/nvidia.yaml) the GPU is passed in (CI_GPU=0 turns that off).
# Compiler and cargo caches are named volumes (cdjci-*), /dev/shm is CI_SHM (default 12g: the tests keep their instance folders there).
# The cargo target folder of the instruments workspace is a volume too, cdjci-cargo-target-<image id>: the name carries the id of the image, so a
# changed toolchain starts a fresh folder (the volumes of other images are removed). Cargo keys the workspace crates relative to the workspace
# root, so the registry and git crates stay built across jobs although every job has its own checkout path. The core build folder is NOT a volume:
# CMake refuses a cache made for another source path, and the runner gives every job a new path.
# The image is only used, never built or changed here. The CI job calls this script, so a change of
# what CI runs is a change of the command in the workflow, not of this script.
set -eu
[ $# -ge 1 ] || { echo "usage: im_container.sh <cmd...>" >&2; exit 2; }
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
IMAGE=${CI_IMAGE:-localhost/cypherdj-test:latest}
MEM=${CI_MEMORY:-8g}
GPU=()
CPUS=()
[ -z "${CI_CPUS:-}" ] || CPUS=(--cpus "$CI_CPUS")
if [ "${CI_GPU:-1}" != 0 ] && [ -e /etc/cdi/nvidia.yaml ]; then GPU=(--device nvidia.com/gpu=all --security-opt=label=disable); fi
# Model weights are not in git (djk/workshop/gewichte is ignored): mounted read-only from CI_GEWICHTE.
GEW=()
G=${CI_GEWICHTE:-$HOME/cypherdj-ci/gewichte}
[ -d "$G" ] && GEW=(-v "$G:$REPO/djk/workshop/gewichte:ro")
# The Strudel sources (an external checkout, not in git) are mounted read-only where the generator looks for them (/home/bau/strudel).
STR=()
S=${CI_STRUDEL:-$HOME/strudel}
[ -d "$S" ] && STR=(-v "$S:/home/bau/strudel:ro")
# Cache volume of the target folder, named after the image id (not the tag: `latest` moves). Without an id (stub, odd podman) a fixed suffix.
IH=$(podman image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null | head -n 1 | sed 's/^sha256://' | tr -cd 'a-f0-9' | cut -c1-12)
IH=${IH:-noid}
TARGET_VOL="cdjci-cargo-target-$IH"
# best effort: the target folders of earlier images are dead weight (several GB each); a volume in use is kept by podman
podman volume ls -q 2>/dev/null | grep '^cdjci-cargo-target-' | grep -vxF "$TARGET_VOL" | xargs -r podman volume rm >/dev/null 2>&1 || true
# No exec: this shell stays as the parent so a cancelled job (the runner sends TERM/INT and deletes the workdir) stops the container
# instead of leaving it running on the machine; podman stop sends TERM to the init, then KILL after 5 s.
NAME="cdjci-$$"
halt() { podman stop -t 5 "$NAME" >/dev/null 2>&1; exit 143; }
trap halt TERM INT HUP
# A trap does not run on KILL, and the runner of a cancelled job may kill the whole process group of the step: this shell dies, the container
# (under conmon, outside the group) runs on (t_41c45344). A guard in its own session outlives that and stops the container once this shell is gone.
setsid bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 2; done; podman stop -t 5 "$2" >/dev/null 2>&1' im-container-waechter "$$" "$NAME" \
  </dev/null >/dev/null 2>&1 &
WAECHTER=$!
podman run --rm --init --userns=keep-id --memory "$MEM" --memory-swap "$MEM" --shm-size "${CI_SHM:-12g}" "${CPUS[@]}" "${GPU[@]}" "${GEW[@]}" "${STR[@]}" \
  --name "$NAME" --ulimit nofile=65536:65536 \
  -v cdjci-ccache:/home/bau/.cache/ccache -v cdjci-cargo-reg:/home/bau/.cargo/registry -v cdjci-cargo-git:/home/bau/.cargo/git \
  -v "$TARGET_VOL:$REPO/djk/instruments/target" \
  -v "$REPO:$REPO" -w "$REPO" "$IMAGE" "$@" &
rc=0
wait $! || rc=$?   # a trap only runs between commands, so wait in the foreground of a background child; || keeps set -e from leaving before the cleanup
trap - TERM INT HUP
kill "$WAECHTER" 2>/dev/null   # the container ended by itself (--rm): nothing left to stop
exit $rc
