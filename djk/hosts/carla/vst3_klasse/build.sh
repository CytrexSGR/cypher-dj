#!/usr/bin/env bash
# build.sh [target dir]: builds the one-class VST3 shim module klasse.so (default ~/.local/lib/cypherdj/vst3_klasse).
set -euo pipefail
HIER=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
ZIEL=${1:-$HOME/.local/lib/cypherdj/vst3_klasse}
mkdir -p "$ZIEL"
cc -shared -fPIC -O2 -Wall -Wextra -fvisibility=hidden -o "$ZIEL/klasse.so.neu" "$HIER/klasse.c" -ldl -lpthread
mv -f "$ZIEL/klasse.so.neu" "$ZIEL/klasse.so"
