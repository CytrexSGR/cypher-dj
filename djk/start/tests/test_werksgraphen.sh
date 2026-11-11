#!/usr/bin/env bash
# arr-bk: djk-start installs the shipped graph fx-delay-sync into the graph folder when it is missing (step 2b), never overwrites a file and
# touches no other graph. The step is cut out of djk-start and run against a throw-away HOME, so no unit is started and nothing real is changed.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../.." && pwd)
SCHRITT=$(sed -n '/^# 2b Shipped graphs/,/^done$/p' "$HIER/../djk-start")
[ -n "$SCHRITT" ] || { echo "FEHL: step 2b not found in djk-start"; exit 1; }
H=$(mktemp -d "${TMPDIR:-/tmp}/djk-werksgraphen.XXXX")
trap 'rm -rf "$H"' EXIT
rc=0
ok() { echo "OK   $1"; }
fehl() { echo "FEHL $1"; rc=1; }
run() { HOME="$H" DJK="$DJK" bash -c "$SCHRITT"; }
ZIEL="$H/.config/cypherdj/baukasten/fx-delay-sync.json"
run > "$H/aus1.txt"
if [ -f "$ZIEL" ] && cmp -s "$ZIEL" "$DJK/instruments/modular_dsp/demos/fx-delay-sync.json" && grep -q installed "$H/aus1.txt"; then ok "a fresh folder gets fx-delay-sync, announced"; else fehl "fresh install"; fi
echo '{"own": true}' > "$ZIEL"
run > "$H/aus2.txt"
if grep -q '"own"' "$ZIEL" && [ ! -s "$H/aus2.txt" ]; then ok "an existing file is not overwritten, nothing announced"; else fehl "overwrite guard"; fi
rm "$ZIEL"
: > "$H/.config/cypherdj/baukasten/mein.json"
run > /dev/null
if [ "$(ls "$H/.config/cypherdj/baukasten" | sort | tr '\n' ' ')" = "fx-delay-sync.json mein.json " ]; then ok "only the listed graph is installed, others stay as they are"; else fehl "other files touched"; fi
exit $rc
