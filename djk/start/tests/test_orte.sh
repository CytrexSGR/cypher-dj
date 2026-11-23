#!/usr/bin/env bash
# Places that resolve from the code's location (package 1.0 task 1, spec D4 to D6): node binary, Strudel folder, VST3 folders.
# No unit is started: djk-start only runs with --vorlagen-nach, djk-stroeme only with --trocken, orte.sh is sourced.
# Usage: tests/test_orte.sh        Exit 0 when every point is OK, 1 otherwise.
#   O1 temp root with node/bin/node, strudel/packages, lib/vst3/rb338.vst3: the rendered units name <root>/node/bin/node,
#      djk-stroeme --trocken names the same node and --allow-fs-read=<root>/strudel
#   O2 the same without those folders: /usr/bin/node and $HOME/strudel (today's lines)
#   O3 orte_bundle finds the bundle of the root when ~/.local/lib/cypherdj/vst3 lacks it, and prefers the home folder when it has it
#   O4 CYPHERDJ_NODE wins over the root; CYPHERDJ_STRUDEL wins over the root; STRUDEL_PAKETE's parent wins over both;
#      a missing CYPHERDJ_STRUDEL folder is an error (2) naming the variable
#   O5 orte_vst3_pfade: order, empty elements ignored
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
DJK_ECHT=$(cd "$START/.." && pwd)
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-orte-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
SYS="$O/sys"; mkdir -p "$SYS"
for c in $(seq 0 15); do mkdir -p "$SYS/cpu$c/topology"; echo $((c % 8)) > "$SYS/cpu$c/topology/core_id"; echo 0 > "$SYS/cpu$c/topology/physical_package_id"; done
echo 0-15 > "$SYS/online"
H="$O/home"; mkdir -p "$H"
# a root whose djk/ is a link to this checkout's djk/: orte.sh derives the root from the path as given (DJK), not from the link target
mkroot() { local r=$1; mkdir -p "$r"; ln -s "$DJK_ECHT" "$r/djk"; }
mkvoll() { local r=$1; mkdir -p "$r/node/bin" "$r/strudel/packages" "$r/lib/vst3/rb338.vst3"; printf '#!/bin/sh\n' > "$r/node/bin/node"; chmod +x "$r/node/bin/node"; }
# $1 root, the rest: extra env assignments, then the command. Runs with a clean environment.
mit() { local r=$1; shift; env -i PATH="$PATH" HOME="$H" CYPHERDJ_SYSFS_CPU="$SYS" CYPHERDJ_UMGEBUNG=/nicht/da DJK="$r/djk" "$@"; }

R1="$O/mit"; mkroot "$R1"; mkvoll "$R1"
R2="$O/ohne"; mkroot "$R2"

# O1
mit "$R1" "$START/djk-start" --instanz i --vorlagen-nach "$O/v1" > "$O/o1.txt" 2>&1 || cat "$O/o1.txt"
grep -q "^ExecStart=$R1/node/bin/node " "$O/v1/cypherdj-oberflaeche.service" && grep -q "^ExecStart=$R1/node/bin/node " "$O/v1/cypherdj-leitstand.service.d/betrieb.conf"
pruef $? "O1 rendered units (page, leitstand) name $R1/node/bin/node"
A=$(mit "$R1" "$START/djk-stroeme" --instanz i --trocken 2>&1)
grep -qF -- " $R1/node/bin/node --permission " <<<"$A" && grep -qF -- "--allow-fs-read=$R1/strudel " <<<"$A" && ! grep -qF -- "$H/strudel" <<<"$A"
pruef $? "O1 djk-stroeme --trocken: node $R1/node/bin/node, --allow-fs-read=$R1/strudel"

# O2
mit "$R2" "$START/djk-start" --instanz i --vorlagen-nach "$O/v2" > "$O/o2.txt" 2>&1 || cat "$O/o2.txt"
grep -q "^ExecStart=/usr/bin/node " "$O/v2/cypherdj-oberflaeche.service" && grep -q "^ExecStart=/usr/bin/node " "$O/v2/cypherdj-leitstand.service.d/betrieb.conf"
pruef $? "O2 without the root folders the units name /usr/bin/node"
A=$(mit "$R2" "$START/djk-stroeme" --instanz i --trocken 2>&1)
grep -qF -- " /usr/bin/node --permission " <<<"$A" && grep -qF -- "--allow-fs-read=$H/strudel " <<<"$A"
pruef $? "O2 djk-stroeme --trocken: /usr/bin/node and --allow-fs-read=$H/strudel"

# O3 / O5
b() { local r=$1; shift; mit "$r" bash -c '. "$1/orte.sh"; shift; "$@"' _ "$START" "$@"; }
[ "$(b "$R1" orte_bundle rb338.vst3)" = "$R1/lib/vst3/rb338.vst3" ]
pruef $? "O3 orte_bundle finds the bundle of the root when the home folder lacks it"
mkdir -p "$H/.local/lib/cypherdj/vst3/rb338.vst3"
[ "$(b "$R1" orte_bundle rb338.vst3)" = "$H/.local/lib/cypherdj/vst3/rb338.vst3" ]
pruef $? "O3 the home folder wins when it has the bundle"
[ -z "$(b "$R1" orte_bundle baukasten.vst3)" ]
pruef $? "O3 a bundle no folder has gives an empty answer"
rm -rf "$H/.local"
L=$(mit "$R1" CYPHERDJ_VST3_PFADE="/a::/b:" bash -c '. "$1/orte.sh"; orte_vst3_pfade' _ "$START")
[ "$L" = "$H/.local/lib/cypherdj/vst3
/a
/b
$R1/lib/vst3" ]
pruef $? "O5 orte_vst3_pfade: home folder, /a, /b (empty elements dropped), root folder"
L=$(b "$R2" orte_vst3_pfade)
[ "$L" = "$H/.local/lib/cypherdj/vst3" ]
pruef $? "O5 without lib/vst3 in the root the root folder is not listed"

# O4
[ "$(mit "$R1" CYPHERDJ_NODE=/x/node bash -c '. "$1/orte.sh"; orte_node' _ "$START")" = /x/node ]
pruef $? "O4 CYPHERDJ_NODE wins over the root"
S="$O/fremd"; mkdir -p "$S/packages"
[ "$(mit "$R1" CYPHERDJ_STRUDEL="$S" bash -c '. "$1/orte.sh"; orte_strudel' _ "$START")" = "$S" ]
pruef $? "O4 CYPHERDJ_STRUDEL wins over the root"
[ "$(mit "$R1" CYPHERDJ_STRUDEL="$S" STRUDEL_PAKETE=/p/q/packages bash -c '. "$1/orte.sh"; orte_strudel' _ "$START")" = /p/q ]
pruef $? "O4 the parent of STRUDEL_PAKETE wins over CYPHERDJ_STRUDEL"
E=$(mit "$R1" CYPHERDJ_STRUDEL=/missing bash -c '. "$1/orte.sh"; orte_strudel' _ "$START" 2>&1); RC=$?
[ "$RC" = 2 ] && [ "$E" = "CYPHERDJ_STRUDEL: /missing does not exist" ]
pruef $? "O4 missing CYPHERDJ_STRUDEL: rc 2 and the message (rc $RC: $E)"

# O6 import and read grant name the same folder: the unit gets STRUDEL_PAKETE=<folder>/packages in every case
S6="$O/gewaehlt"; mkdir -p "$S6/packages"
A=$(mit "$R1" CYPHERDJ_STRUDEL="$S6" "$START/djk-stroeme" --instanz i --trocken 2>&1)
grep -qF -- "--allow-fs-read=$S6 " <<<"$A" && grep -qF -- "--setenv=STRUDEL_PAKETE=$S6/packages " <<<"$A"
pruef $? "O6 djk-stroeme --trocken with CYPHERDJ_STRUDEL: grant and setenv name $S6"
A=$(mit "$R1" "$START/djk-stroeme" --instanz i --trocken 2>&1)
grep -qF -- "--allow-fs-read=$R1/strudel " <<<"$A" && grep -qF -- "--setenv=STRUDEL_PAKETE=$R1/strudel/packages " <<<"$A"
pruef $? "O6 djk-stroeme --trocken with the root's strudel: grant and setenv name $R1/strudel"
A=$(mit "$R2" "$START/djk-stroeme" --instanz i --trocken 2>&1)
grep -qF -- "--setenv=STRUDEL_PAKETE=$H/strudel/packages " <<<"$A"
pruef $? "O6 djk-stroeme --trocken default: setenv names \$HOME/strudel/packages"
# the erzeuger line of djk-start: the folder block and one pass of the erzeuger block, cut out of djk-start and run against stubs
PBLOCK=$(sed -n '/^PAKETE_ENV=()$/,/^fi$/p' "$START/djk-start")
EBLOCK=$(sed -n '/^    ZIEL=""$/,/^    UNITS+=("\$U")$/p' "$START/djk-start")
[ -n "$PBLOCK" ] && [ -n "$EBLOCK" ]; pruef $? "O6 blocks found in djk-start"
KITD="$O/kits"; mkdir -p "$KITD/techno" "$KITD/battery"; echo '{}' > "$KITD/techno/kit.json"; echo '{}' > "$KITD/battery/kit.json"
erz() {  # $1 root, the rest: env assignments; prints the first erzeuger systemd-run line
  local r=$1; shift
  mit "$r" "$@" SFX="" I="" P_KERN=47100 P_ERZ=47300 KIT=techno KIT2=battery KIT3=battery KITS="$KITD" KIT_ORDNER="" INSTR=0 STRUDEL=1 NODE=/usr/bin/node HIER="$START" bash -c '
    . "$HIER/orte.sh"
    systemd-run() { echo "RUN $*"; }; mkdir() { :; }; warte() { :; }; abbruch() { echo "ABBRUCH $1"; exit 5; }; w() { echo "$1"; }
    UNITS=()
    '"$PBLOCK"'
    for s in 1; do
'"$EBLOCK"'
    done' 2>&1 | sed -n 's/^    RUN/RUN/p'
}
A=$(erz "$R1" CYPHERDJ_STRUDEL="$S6")
grep -qF -- "--setenv=STRUDEL_PAKETE=$S6/packages " <<<"$A" && grep -qF -- "--allow-fs-read=$S6 " <<<"$A"
pruef $? "O6 djk-start erzeuger line with CYPHERDJ_STRUDEL: grant and setenv name $S6"
A=$(erz "$R2")
grep -qF -- "--setenv=STRUDEL_PAKETE=$H/strudel/packages " <<<"$A" && grep -qF -- "--allow-fs-read=$H/strudel " <<<"$A"
pruef $? "O6 djk-start erzeuger line default: grant and setenv name \$HOME/strudel"

echo "$OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
