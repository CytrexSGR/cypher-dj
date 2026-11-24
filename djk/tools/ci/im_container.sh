#!/usr/bin/env bash
# Runs a command inside the CI test container (localhost/cypherdj-test:latest).
#
#   djk/tools/ci/im_container.sh <cmd...>
#
# The repo checkout is mounted read-write at the same path it has on the host and is the working
# directory of the command. The container is removed afterwards and capped at CI_MEMORY (default 8g) of memory.
# If the host has a CDI description of an NVIDIA GPU (/etc/cdi/nvidia.yaml) the GPU is passed in (CI_GPU=0 turns that off).
# Compiler and cargo caches are named volumes (cdjci-*), /dev/shm is CI_SHM (default 12g: the tests keep their instance folders there).
# The image is only used, never built or changed here. The CI job calls this script, so a change of
# what CI runs is a change of the command in the workflow, not of this script.
set -eu
[ $# -ge 1 ] || { echo "usage: im_container.sh <cmd...>" >&2; exit 2; }
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
IMAGE=${CI_IMAGE:-localhost/cypherdj-test:latest}
MEM=${CI_MEMORY:-8g}
GPU=()
if [ "${CI_GPU:-1}" != 0 ] && [ -e /etc/cdi/nvidia.yaml ]; then GPU=(--device nvidia.com/gpu=all --security-opt=label=disable); fi
# Model weights are not in git (djk/workshop/gewichte is ignored): mounted read-only from CI_GEWICHTE.
GEW=()
G=${CI_GEWICHTE:-$HOME/cypherdj-ci/gewichte}
[ -d "$G" ] && GEW=(-v "$G:$REPO/djk/workshop/gewichte:ro")
# The Strudel sources (an external checkout, not in git) are mounted read-only where the generator looks for them (/home/bau/strudel).
STR=()
S=${CI_STRUDEL:-$HOME/strudel}
[ -d "$S" ] && STR=(-v "$S:/home/bau/strudel:ro")
# No exec: this shell stays as the parent so a cancelled job (the runner sends TERM/INT and deletes the workdir) stops the container
# instead of leaving it running on the machine; podman stop sends TERM to the init, then KILL after 5 s.
NAME="cdjci-$$"
halt() { podman stop -t 5 "$NAME" >/dev/null 2>&1; exit 143; }
trap halt TERM INT HUP
podman run --rm --init --userns=keep-id --memory "$MEM" --memory-swap "$MEM" --shm-size "${CI_SHM:-12g}" "${GPU[@]}" "${GEW[@]}" "${STR[@]}" \
  --name "$NAME" --ulimit nofile=65536:65536 \
  -v cdjci-ccache:/home/bau/.cache/ccache -v cdjci-cargo-reg:/home/bau/.cargo/registry -v cdjci-cargo-git:/home/bau/.cargo/git \
  -v "$REPO:$REPO" -w "$REPO" "$IMAGE" "$@" &
wait $!   # a trap only runs between commands, so wait in the foreground of a background child
rc=$?
trap - TERM INT HUP
exit $rc
