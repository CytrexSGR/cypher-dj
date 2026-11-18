#!/usr/bin/env bash
# djk-start steps 2b2 to 2d (device graphs, recipe graphs, panels, categories) install into the graph folder of the kern, which is the production
# folder whatever the instance. A production start replaces a differing file; a test instance (I set) installs only what is absent and leaves a
# differing file alone, with a note on stderr. The steps are cut out of djk-start and run against a throw-away HOME and a fake DJK tree, so no unit
# is started and nothing real is changed.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
SCHRITT=$(sed -n '/^# 2b2/,/^# 3 Belegt/p' "$HIER/../djk-start")
[ -n "$SCHRITT" ] || { echo "FEHL: steps 2b2 to 2d not found in djk-start"; exit 1; }
H=$(mktemp -d "${TMPDIR:-/tmp}/djk-werksgraphen-instanz.XXXX")
trap 'rm -rf "$H"' EXIT
rc=0
ok() { echo "OK   $1"; }
fehl() { echo "FEHL $1"; rc=1; }
D="$H/djk"; M="$D/instruments/modular_dsp"; BK="$H/baukasten"
mkdir -p "$M/demos/recipes" "$M/paneele"
echo '[{"name":"dev","art":"bk"}]' > "$M/geraete.json"
echo '{"patches":[{"datei":"rez.json"}]}' > "$M/demos/recipes/MANIFEST.json"
echo '{"from":"branch"}' > "$M/demos/dev.json"
echo '{"from":"branch"}' > "$M/demos/recipes/rez.json"
echo '{"from":"branch"}' > "$M/paneele/pan.json"
echo '{"from":"branch"}' > "$M/kategorien.json"
DATEIEN=("$BK/dev.json" "$BK/rez.json" "$BK/panels/pan.json" "$BK/panels/kategorien.json")
run() { I="$1" DJK="$D" BK_ORDNER="$BK" bash -c "I=\$I; $SCHRITT" > "$H/aus.txt" 2> "$H/fehl.txt"; }
alle() { local f; for f in "${DATEIEN[@]}"; do [ -f "$f" ] && grep -q "\"$1\"" "$f" || return 1; done; }
vorbelegen() { local f; for f in "${DATEIEN[@]}"; do mkdir -p "$(dirname "$f")"; echo '{"from":"studio"}' > "$f"; done; }

run i
if alle from && [ "$(grep -c installed "$H/aus.txt")" = 4 ] && [ ! -s "$H/fehl.txt" ] && ! grep -q studio "${DATEIEN[@]}"; then ok "test instance installs absent files, announced"; else fehl "test instance, fresh folder"; fi

rm -rf "$BK"; vorbelegen
run i
if alle studio && [ ! -s "$H/aus.txt" ] && [ "$(grep -c untouched "$H/fehl.txt")" = 4 ]; then ok "test instance leaves 4 differing files alone, 4 notes on stderr"; else fehl "test instance overwrote or kept silent"; fi

rm -rf "$BK"; vorbelegen; for f in "${DATEIEN[@]}"; do echo '{"from":"branch"}' > "$f"; done
run i
if [ ! -s "$H/aus.txt" ] && [ ! -s "$H/fehl.txt" ]; then ok "test instance is silent on identical files"; else fehl "identical files made noise"; fi

rm -rf "$BK"; vorbelegen
run ""
if alle branch && [ "$(grep -c installed "$H/aus.txt")" = 4 ]; then ok "production start replaces differing files, announced"; else fehl "production start did not install"; fi
exit $rc
