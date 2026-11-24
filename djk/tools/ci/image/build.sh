#!/usr/bin/env bash
# Builds the CI test image from djk/tools/ci/image/Containerfile when the runner does not have it yet.
#   djk/tools/ci/image/build.sh            prints the image tag (localhost/cypherdj-test:<hash>) on the last line; builds if missing
#   CI_IMAGE_CACHE=DIR                    the local cache folder (default $HOME/cypherdj-ci/image-cache), see README.md
# The tag is the hash of Containerfile, requirements.txt, kf_cli.cpp and the cache MANIFEST, so a changed recipe gives a new image and an
# unchanged one is never rebuilt. After a successful build or hit, `localhost/cypherdj-test:latest` points to it (im_container.sh uses that).
# Nothing large is downloaded (apt steps stop above 1 GB, pip is offline, the cache is checked against MANIFEST): the torch stack and the other big parts come from the cache; a missing part stops the build with a message.
set -eu
HIER=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HIER/../../../.." && pwd)
CACHE=${CI_IMAGE_CACHE:-$HOME/cypherdj-ci/image-cache}
NAME=localhost/cypherdj-test
BENOETIGT="torch-gpu werkstatt-venv-sp mik-sp mik-modelle wheels"
HASH=$(cat "$HIER/Containerfile" "$REPO/djk/requirements.txt" "$HIER/kf_cli.cpp" "$HIER/apt-sicher.sh" "$CACHE/MANIFEST" 2>/dev/null | sha256sum | cut -c1-12)
TAG=$NAME:$HASH
if podman image exists "$TAG"; then
  echo "baue: image $TAG exists, not rebuilt" >&2
else
  for d in $BENOETIGT; do
    [ -d "$CACHE/$d" ] || { echo "baue: STOP, the cache folder $CACHE has no '$d'. The image is not built, nothing is downloaded (the torch stack alone is > 6 GB)." >&2
                            echo "baue: fill the cache as described in djk/tools/ci/image/README.md, then run this again." >&2; exit 3; }
  done
  [ -f "$CACHE/MANIFEST" ] || { echo "baue: STOP, $CACHE/MANIFEST is missing (README.md says how to write it)." >&2; exit 3; }
  # Guard 1: the cache must be what MANIFEST says (name, file count, bytes), otherwise a half-copied torch tree would be built in.
  while read -r name n bytes; do
    [ -n "$name" ] || continue
    [ -d "$CACHE/$name" ] || { echo "baue: STOP, MANIFEST lists '$name' but $CACHE/$name does not exist." >&2; exit 3; }
    is_n=$(find "$CACHE/$name" -type f | wc -l); is_b=$(du -sb "$CACHE/$name" | cut -f1)
    [ "$is_n" = "$n" ] && [ "$is_b" = "$bytes" ] || { echo "baue: STOP, $CACHE/$name does not match MANIFEST (files $is_n, bytes $is_b; MANIFEST says $n, $bytes). Refill the folder or rewrite MANIFEST (README.md)." >&2; exit 3; }
  done < "$CACHE/MANIFEST"
  for d in $BENOETIGT; do
    grep -q "^$d " "$CACHE/MANIFEST" || { echo "baue: STOP, MANIFEST has no line for '$d' (README.md says how to write it)." >&2; exit 3; }
  done
  # Guard 2: pip runs offline against $CACHE/wheels, but a heavy package in requirements.txt is rejected here with a clear message first.
  if grep -Eiq '^[[:space:]]*(torch|torchvision|torchaudio|triton|tensorflow|nvidia-[a-z0-9-]+)([^a-z0-9-]|$)' "$REPO/djk/requirements.txt"; then
    echo "baue: STOP, djk/requirements.txt has an active torch/tensorflow/nvidia/triton line. Those are several GB and come from the cache (torch-gpu), never from pip. Not built, nothing downloaded." >&2; exit 3
  fi
  CTX=$(mktemp -d); trap 'rm -rf "$CTX"' EXIT
  cp "$HIER/kf_cli.cpp" "$HIER/apt-sicher.sh" "$CTX/"; cp "$REPO/djk/requirements.txt" "$CTX/requirements.txt"
  echo "baue: building $TAG (apt, node, rust and libKeyFinder are fetched, each step guarded to 1 GB at most; pip runs offline from $CACHE/wheels)" >&2
  podman build -q --format docker -t "$TAG" -f "$HIER/Containerfile" --build-context "cache=$CACHE" "$CTX" >&2
fi
podman tag "$TAG" "$NAME:latest"
echo "$TAG"
