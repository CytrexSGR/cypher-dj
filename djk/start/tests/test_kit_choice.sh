#!/usr/bin/env bash
# Starter kit choice of djk-start (task 4). No unit is started and nothing real is touched: kit_choice.sh is sourced in a throw-away HOME,
# djk-start runs only in --vorlagen-nach mode, and the erzeuger block is cut out of djk-start and run against stubs (systemd-run prints
# its command line). Runs under env -i.
# Points:
#   K1 kit_wahl: default present -> default, no note; only starter present -> starter plus one note; given kit missing -> 2;
#      no kit at all -> 2 with the hint; each in the home kit folder and in a folder outside HOME
#   K2 djk-start --strudel --vorlagen-nach: the page gets --kit <chosen>; missing given kit / no kit -> 2 before anything is written
#   K3 operating case: kits techno and battery, no --kit-ordner: the three erzeuger command lines equal the lines of the version before
#      this task (golden strings below); with --kit-ordner the command line carries --kit-ordner and that folder in --allow-fs-read
#   K4 without --strudel the choice does not run (a fresh HOME without any kit still returns 0)
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
DJK=$(cd "$START/.." && pwd)
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-kitwahl-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
SYS="$O/sys"; mkdir -p "$SYS"
for c in $(seq 0 15); do mkdir -p "$SYS/cpu$c/topology"; echo $((c % 8)) > "$SYS/cpu$c/topology/core_id"; echo 0 > "$SYS/cpu$c/topology/physical_package_id"; done
echo 0-15 > "$SYS/online"
ENVSAUBER=(env -i PATH="$PATH" CYPHERDJ_SYSFS_CPU="$SYS" CYPHERDJ_UMGEBUNG=/nicht/da)
kit() { mkdir -p "$1/$2" && if [ "$2" = starter ]; then echo '{"schema": 1, "klaenge": []}'; else echo '{}'; fi > "$1/$2/kit.json"; }   # $1 kit folder, $2 kit name

# K1 kit_wahl in both kit folders
for variante in home aussen; do
  H="$O/h-$variante"; mkdir -p "$H"
  if [ "$variante" = home ]; then D="$H/.config/cypherdj/kits"; else D="$O/aussen-$variante/kits"; fi
  mkdir -p "$D"
  w() { env -i PATH="$PATH" HOME="$H" bash -c '. "$1/kit_wahl.sh"; kit_wahl "$2" "$3" "$4"' _ "$START" "$D" "$1" "$2" 2> "$O/err.txt"; }
  rm -rf "$D"; mkdir -p "$D"; kit "$D" starter
  R=$(w 0 techno); RC=$?
  [ "$RC" = 0 ] && [ "$R" = starter ] && [ "$(wc -l < "$O/err.txt")" = 1 ] && grep -q "djk-start: kit techno not found, using the starter kit" "$O/err.txt"
  pruef $? "K1 $variante: only starter present -> starter plus one note (rc $RC, out '$R')"
  kit "$D" techno
  R=$(w 0 techno); RC=$?
  [ "$RC" = 0 ] && [ "$R" = techno ] && [ ! -s "$O/err.txt" ]; pruef $? "K1 $variante: techno present -> techno, no note (rc $RC, out '$R')"
  R=$(w 0 battery); RC=$?
  [ "$RC" = 0 ] && [ "$R" = starter ] && grep -q "kit battery not found" "$O/err.txt"; pruef $? "K1 $variante: battery absent, not given -> starter (rc $RC, out '$R')"
  R=$(w 1 mine); RC=$?
  [ "$RC" = 2 ] && [ -z "$R" ] && grep -q "djk-start: kit mine missing: run djk/start/djk-starter (or build one with djk/generator/kit_build.py)" "$O/err.txt"
  pruef $? "K1 $variante: given kit missing -> 2 with the hint (rc $RC)"
  R=$(w 1 techno); RC=$?
  [ "$RC" = 0 ] && [ "$R" = techno ]; pruef $? "K1 $variante: given kit present -> kept (rc $RC, out '$R')"
  # a damaged starter is no fallback: it behaves like "no starter kit"
  for kaputt in '{kaputt' '' '{"schema": 2}' '[1]' '{}'; do
    rm -rf "$D"; mkdir -p "$D/starter"; printf '%s' "$kaputt" > "$D/starter/kit.json"
    R=$(w 0 techno); RC=$?
    [ "$RC" = 2 ] && [ -z "$R" ] && grep -q "djk-start: kit techno missing: run djk/start/djk-starter" "$O/err.txt"
    pruef $? "K1 $variante: starter kit.json '$kaputt' -> not chosen, 2 with the hint (rc $RC, out '$R')"
  done
  rm -rf "$D"; mkdir -p "$D/starter"; echo '{kaputt' > "$D/starter/kit.json"; kit "$D" techno
  R=$(w 0 techno); RC=$?
  [ "$RC" = 0 ] && [ "$R" = techno ] && [ ! -s "$O/err.txt" ]; pruef $? "K1 $variante: damaged starter, own techno present -> techno unchanged (rc $RC)"
  rm -rf "$D"; mkdir -p "$D"
  R=$(w 0 techno); RC=$?
  [ "$RC" = 2 ] && [ -z "$R" ] && grep -q "djk-start: kit techno missing: run djk/start/djk-starter (or build one with djk/generator/kit_build.py)" "$O/err.txt"
  pruef $? "K1 $variante: no kit at all -> 2 with the hint (rc $RC)"
done

# K2 djk-start --strudel in Vorlagen mode
seite() { grep '^ExecStart=' "$1/cypherdj-oberflaeche.service" 2>/dev/null; }
for variante in home aussen; do
  H="$O/k2-$variante"; mkdir -p "$H"
  if [ "$variante" = home ]; then D="$H/.config/cypherdj/kits"; KO=(); else D="$O/k2-aussen-kits"; KO=(--kit-ordner "$D"); fi
  rm -rf "$D" "$O/v"; mkdir -p "$D"; kit "$D" starter
  "${ENVSAUBER[@]}" HOME="$H" "$START/djk-start" --instanz i --strudel "${KO[@]}" --vorlagen-nach "$O/v" > "$O/a.txt" 2> "$O/e.txt"; R=$?
  [ "$R" = 0 ] && seite "$O/v" | grep -q -- "--kit starter"; pruef $? "K2 $variante: only starter present: return $R, page gets --kit starter"
  kit "$D" techno; kit "$D" battery; rm -rf "$O/v"
  "${ENVSAUBER[@]}" HOME="$H" "$START/djk-start" --instanz i --strudel "${KO[@]}" --vorlagen-nach "$O/v" > "$O/a.txt" 2> "$O/e.txt"; R=$?
  [ "$R" = 0 ] && seite "$O/v" | grep -q -- "--kit techno" && ! grep -q "not found" "$O/e.txt"; pruef $? "K2 $variante: techno present: return $R, page gets --kit techno, no note"
  rm -rf "$O/v"
  "${ENVSAUBER[@]}" HOME="$H" "$START/djk-start" --instanz i --strudel --strudel-kit mine "${KO[@]}" --vorlagen-nach "$O/v" > "$O/a.txt" 2> "$O/e.txt"; R=$?
  [ "$R" = 2 ] && grep -q "kit mine missing" "$O/e.txt" && [ ! -e "$O/v" ]; pruef $? "K2 $variante: --strudel-kit mine absent: return $R, nothing written"
  rm -rf "$D" "$O/v"; mkdir -p "$D"
  "${ENVSAUBER[@]}" HOME="$H" "$START/djk-start" --instanz i --strudel "${KO[@]}" --vorlagen-nach "$O/v" > "$O/a.txt" 2> "$O/e.txt"; R=$?
  [ "$R" = 2 ] && grep -q "kit techno missing: run djk/start/djk-starter" "$O/e.txt" && [ ! -e "$O/v" ]; pruef $? "K2 $variante: no kit: return $R with the hint, nothing written"
done

# K3 the erzeuger block, cut out of djk-start and run against stubs
BLOCK=$(sed -n '/^    ZIEL=""$/,/^    UNITS+=("\$U")$/p' "$START/djk-start")
[ -n "$BLOCK" ] || { echo "FEHL erzeuger block not found in djk-start"; exit 1; }
erzeuger() {  # $1 HOME, $2 kit folder as djk-start would hold it (KIT_ORDNER, may be empty), $3 INSTR
  env -i PATH="$PATH" HOME="$1" DJK=/D KIT_ORDNER="$2" INSTR="$3" SFX="" I="" P_KERN=47100 P_ERZ=47300 KIT=techno KIT2=battery KIT3=battery \
    KITS="${2:-$1/.config/cypherdj/kits}" bash -c '
    systemd-run() { echo "RUN $*"; }; mkdir() { :; }; warte() { :; }; abbruch() { echo "ABBRUCH $1"; exit 5; }; w() { echo "$1"; }
    UNITS=()
    for s in 1 2 3; do
'"$BLOCK"'
    done'
}
KH="$O/k3h"; EXT="$O/k3ext"
for d in "$KH/.config/cypherdj/kits" "$EXT"; do kit "$d" techno; kit "$d" battery; done
LINIEN=$(erzeuger "$KH" "" 0 2>&1 | sed -n 's/^    RUN/RUN/p')
NODE=/usr/bin/node
G1="RUN --user --quiet --collect --unit=cypherdj-erzeuger -p Restart=always -p RestartSec=1 -p RestartPreventExitStatus=2 -p PartOf=cypherdj.target $NODE --permission --allow-fs-read=/D --allow-fs-read=/H/strudel --allow-fs-read=/H/.config/cypherdj/kits --allow-fs-read=/dev/shm/cypherdj/erzeuger --allow-fs-write=/dev/shm/cypherdj/erzeuger /D/erzeuger/erzeuger.mjs --kern-port 47100 --abo-port 47300 --kit techno --kit-zusatz rec --name erzeuger --strom 1 --kanal erz/1 --muster /dev/shm/cypherdj/erzeuger/strom1.js"
G2="RUN --user --quiet --collect --unit=cypherdj-erzeuger2 -p Restart=always -p RestartSec=1 -p RestartPreventExitStatus=2 -p PartOf=cypherdj.target $NODE --permission --allow-fs-read=/D --allow-fs-read=/H/strudel --allow-fs-read=/H/.config/cypherdj/kits --allow-fs-read=/dev/shm/cypherdj/erzeuger2 --allow-fs-write=/dev/shm/cypherdj/erzeuger2 /D/erzeuger/erzeuger.mjs --kern-port 47100 --abo-port 47301 --kit battery --name erzeuger2 --strom 2 --kanal erz/2 --muster /dev/shm/cypherdj/erzeuger2/strom1.js"
G3="RUN --user --quiet --collect --unit=cypherdj-erzeuger3 -p Restart=always -p RestartSec=1 -p RestartPreventExitStatus=2 -p PartOf=cypherdj.target $NODE --permission --allow-fs-read=/D --allow-fs-read=/H/strudel --allow-fs-read=/H/.config/cypherdj/kits --allow-fs-read=/dev/shm/cypherdj/erzeuger3 --allow-fs-write=/dev/shm/cypherdj/erzeuger3 /D/erzeuger/erzeuger.mjs --kern-port 47100 --abo-port 47302 --kit battery --name erzeuger3 --strom 3 --kanal erz/3 --muster /dev/shm/cypherdj/erzeuger3/strom1.js"
G1=${G1//\/H\//$KH/}; G2=${G2//\/H\//$KH/}; G3=${G3//\/H\//$KH/}
[ "$LINIEN" = "$G1"$'\n'"$G2"$'\n'"$G3" ]
pruef $? "K3 operating case (techno, battery, no --kit-ordner): the three erzeuger lines equal the lines before this task"
[ "$LINIEN" = "$G1"$'\n'"$G2"$'\n'"$G3" ] || { diff <(echo "$LINIEN") <(printf '%s\n%s\n%s\n' "$G1" "$G2" "$G3") | head -6; }
LK=$(erzeuger "$KH" "$EXT" 0 2>&1 | sed -n 's/^    RUN/RUN/p')
[ "$(echo "$LK" | grep -c -- "--kit-ordner $EXT")" = 3 ] && [ "$(echo "$LK" | grep -c -- "--allow-fs-read=$EXT")" = 3 ] && ! echo "$LK" | grep -q -- "--allow-fs-read=$KH/.config/cypherdj/kits"
pruef $? "K3 with a kit folder: all three lines carry --kit-ordner and --allow-fs-read of that folder, not the home folder"

# K4 without --strudel
H="$O/k4"; mkdir -p "$H"; rm -rf "$O/v"
"${ENVSAUBER[@]}" HOME="$H" "$START/djk-start" --instanz i --vorlagen-nach "$O/v" > "$O/a.txt" 2> "$O/e.txt"; R=$?
pruef $([ "$R" = 0 ]; echo $?) "K4 no --strudel, no kit anywhere: return $R"

# K5 --help documents the kit choice: the starter fallback, --strudel-kit* and return 2 in the template mode
"$START/djk-start" --help > "$O/h.txt" 2>&1; R=$?
[ "$R" = 0 ] && grep -q -- "^  --strudel-kit NAME" "$O/h.txt" && grep -q -- "--strudel-kit2 NAME" "$O/h.txt" && grep -q -- "--strudel-kit3 NAME" "$O/h.txt"
pruef $? "K5 --help describes --strudel-kit, --strudel-kit2, --strudel-kit3"
grep -q "starter kit" "$O/h.txt" && grep -q "djk-starter" "$O/h.txt"; pruef $? "K5 --help names the starter fallback and djk-starter"
grep -q "In template mode (--vorlagen-nach) with --strudel a missing kit is return 2" "$O/h.txt"
pruef $? "K5 --help documents return 2 in the template mode (kit missing)"

# K6 the starter check does not need python3: a PATH without it gives the same answers
NOPY="$O/nopy-bin"; mkdir -p "$NOPY"
for t in bash cat grep wc tr sed; do ln -s "$(command -v $t)" "$NOPY/$t"; done
D="$O/k6"; H="$O/k6h"; mkdir -p "$H"
w6() { env -i PATH="$NOPY" HOME="$H" "$NOPY/bash" -c '. "$1/kit_wahl.sh"; kit_wahl "$2" 0 techno' _ "$START" "$D" 2> "$O/err.txt"; }
rm -rf "$D"; mkdir -p "$D"; kit "$D" starter
R=$(w6); RC=$?; [ "$RC" = 0 ] && [ "$R" = starter ]; pruef $? "K6 no python3: valid starter kit.json -> starter (rc $RC, out '$R')"
for kaputt in '{kaputt' '' '{"schema": 2}' '[1]' '{}' '{"schema": 1' '"schema": 1}'; do
  rm -rf "$D"; mkdir -p "$D/starter"; printf '%s' "$kaputt" > "$D/starter/kit.json"
  R=$(w6); RC=$?; [ "$RC" = 2 ] && [ -z "$R" ]; pruef $? "K6 no python3: starter kit.json '$kaputt' -> not chosen (rc $RC)"
done

echo "ERGEBNIS $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
