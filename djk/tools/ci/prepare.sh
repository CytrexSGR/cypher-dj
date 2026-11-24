#!/usr/bin/env bash
# Prepares a fresh CI checkout for djk/tools/alles.sh. Run it inside the test image (djk/tools/ci/im_container.sh djk/tools/ci/prepare.sh):
# configures the core build folder (the build itself is alles.sh's job, with ccache) and installs the node packages that have a lockfile.
# Idempotent: what is there is kept, so a persistent workdir builds incrementally.
set -eu
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$REPO"
if [ ! -f djk/core/build/CMakeCache.txt ]; then
  cmake -S djk/core -B djk/core/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DHALL_FFI_TARGET_DIR="$REPO/djk/core/build/cargo" > /dev/null
  echo "vorbereiten: core build folder configured"
fi
# Page tests render with djk/core/build/cypherdj-render. The core suite builds it too, but the page suites start at the same time as the
# core suite in a fresh checkout and would find it missing: build it here, once (ccache and the cargo volume make a repeat cheap).
ninja -C djk/core/build -j"$(( $(nproc) / 2 ))" cypherdj-render > djk/core/build/vorbereiten-render.log 2>&1 \
  || { tail -20 djk/core/build/vorbereiten-render.log; exit 1; }
echo "vorbereiten: cypherdj-render built"
# node_modules is reinstalled when it is missing or when the lockfile it was installed from has changed (a reused workdir keeps old packages).
for p in conductor contract hand; do
  if [ -f "djk/$p/package-lock.json" ]; then
    h=$(sha256sum "djk/$p/package-lock.json" | cut -c1-16)
    if [ ! -d "djk/$p/node_modules" ] || [ "$(cat "djk/$p/node_modules/.lock-sha" 2>/dev/null)" != "$h" ]; then
      rm -rf "djk/$p/node_modules"
      (cd "djk/$p" && npm ci --no-audit --no-fund --loglevel=error)
      echo "$h" > "djk/$p/node_modules/.lock-sha"
      echo "vorbereiten: djk/$p/node_modules installed"
    fi
  fi
done
# Several node tests and the catalogue builder start djk/workshop/.venv/bin/python (a dev checkout has that venv, a fresh clone does not):
# point it at the image's werkstatt venv. .venv/ is git-ignored.
if [ -n "${CYPHERDJ_PYTHON:-}" ] && [ ! -e djk/workshop/.venv/bin/python ]; then
  VENV_DIR=$(dirname "$(dirname "$CYPHERDJ_PYTHON")")
  rm -rf djk/workshop/.venv
  ln -s "$VENV_DIR" djk/workshop/.venv
  echo "vorbereiten: djk/workshop/.venv -> $VENV_DIR"
fi
