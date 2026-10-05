#!/usr/bin/env bash
# Baut djk/kern/dsp so ein, wie Strang A es tut (add_subdirectory ohne Tests), und startet das Prüfprogramm.
# Aufruf: pruefung/einbindung.sh <pfad zu djk/kern/dsp>
set -uo pipefail
dsp="$(cd "${1:?Aufruf: einbindung.sh <djk/kern/dsp>}" && pwd)"
hier="$(cd "$(dirname "$0")" && pwd)"
bau="$(mktemp -d)"
trap 'rm -rf "$bau"' EXIT
if ! cmake -S "$hier/einbindung" -B "$bau" -G Ninja -DDSP_DIR="$dsp" -DCMAKE_BUILD_TYPE=Release > "$bau/cmake.log" 2>&1; then
  echo "einbindung: cmake gescheitert"; grep -m3 -E 'Error|error' "$bau/cmake.log"; exit 1
fi
if ! nice -n 19 ninja -C "$bau" -j4 > "$bau/ninja.log" 2>&1; then
  echo "einbindung: Bau gescheitert"; grep -m3 -E 'error|FAILED' "$bau/ninja.log"; exit 1
fi
"$bau/einbindung"
