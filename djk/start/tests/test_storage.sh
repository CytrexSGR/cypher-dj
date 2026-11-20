#!/usr/bin/env bash
# Listen- und Muster-Ablage je Instanz (Review S2b Befund 7): Prüfinstanzen schreiben NICHT in die Bibliothek des Betriebs.
# Nur Vorlagen (--vorlagen-nach), kein Start, kein Dienst, kein Ton. Aufruf: tests/test_storage.sh [instanz a..i, Vorgabe b]
# Prüfpunkte:
#   A1 Prüfinstanz: die Oberfläche bekommt --sammlungen und --muster-bibliothek unter /dev/shm/cypherdj-<i>/bibliothek
#   A2 Negativ-Kontrolle Betrieb (keine Instanz): keine der beiden Optionen, es gelten die Vorgaben der Seite (<repo>/bibliothek)
#   A5 Betrieb mit verlinktem Kit-Ordner (tmp HOME): die Kit-Wahl und der Loop-Ordner kommen aus der Ablage-Tabelle, der Erzeuger
#      bekommt --allow-fs-read für den Link und für sein Ziel (Block aus djk-start gegen Stubs)
#   A6 fresh HOME: djk-starter --nur demo creates heim/werke/projekte/demo and the kit link (vorgabe neu, task 14)
#   A7 heim on a missing disk: djk-start prints the refusal, creates nothing there and goes on (stops at the missing kit, no unit started)
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
I=${1:-b}
case "$I" in [a-i]) ;; *) echo "Instanz a bis i" >&2; exit 2;; esac
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-ablage-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
# Auflösung gegen ein aufgezeichnetes pw-dump wie test_target.sh: nichts am lebenden PipeWire
echo '[]' > "$O/dump.json"; export DJK_PW_DUMP="$O/dump.json"
zeile() { grep -h -A3 '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null | tr '\n' ' '; }
rm -rf "$O/v"; "$START/djk-start" --instanz "$I" --vorlagen-nach "$O/v" >"$O/a1.txt" 2>&1; R=$?
Z=$(zeile)
[ "$R" = 0 ] && [[ "$Z" == *"--sammlungen /dev/shm/cypherdj-$I/bibliothek/sets"* ]] && [[ "$Z" == *"--muster-bibliothek /dev/shm/cypherdj-$I/bibliothek/muster"* ]]
pruef $? "A1 Prüfinstanz $I: eigene Ablage unter /dev/shm/cypherdj-$I/bibliothek: rc $R: ${Z:0:300} $(head -c 200 "$O/a1.txt")"
env -u CYPHERDJ_INSTANZ "$START/djk-start" --vorlagen-nach "$O/v2" >"$O/a2.txt" 2>&1; R=$?
Z=$(grep -h -A3 '^ExecStart=' "$O/v2/cypherdj-oberflaeche.service" 2>/dev/null | tr '\n' ' ')
[ "$R" = 0 ] && [ -n "$Z" ] && [[ "$Z" != *"--sammlungen"* ]] && [[ "$Z" != *"--muster-bibliothek"* ]]
pruef $? "A2 Betrieb: weder --sammlungen noch --muster-bibliothek (Vorgabe der Seite): rc $R: ${Z:0:200} $(head -c 200 "$O/a2.txt")"
# S5-Review B4: der Welle-Cache einer Prüfinstanz liegt in ihrem /dev/shm, nie im Cache des Betriebs (~/.cache/cypherdj/welle)
rm -rf "$O/v"; "$START/djk-start" --instanz "$I" --vorlagen-nach "$O/v" >"$O/a3.txt" 2>&1; R=$?; Z1=$(zeile)
[ "$R" = 0 ] && [[ "$Z1" == *"--welle-cache /dev/shm/cypherdj-$I/welle"* ]]
pruef $? "A3 Prüfinstanz $I: --welle-cache /dev/shm/cypherdj-$I/welle: rc $R: ${Z1:0:300}"
Z2=$(grep -h -A3 '^ExecStart=' "$O/v2/cypherdj-oberflaeche.service" 2>/dev/null | tr '\n' ' ')
[ -n "$Z2" ] && [[ "$Z2" != *"--welle-cache"* ]]
pruef $? "A4 Betrieb: kein --welle-cache (Vorgabe der Seite: ~/.cache/cypherdj/welle): ${Z2:0:200}"

# A5 production with a linked kit folder, in a tmp HOME (nothing of the real HOME is read or written)
SYS="$O/sys"; mkdir -p "$SYS"
for c in $(seq 0 15); do mkdir -p "$SYS/cpu$c/topology"; echo $((c % 8)) > "$SYS/cpu$c/topology/core_id"; echo 0 > "$SYS/cpu$c/topology/physical_package_id"; done
echo 0-15 > "$SYS/online"
H5="$O/h5"; ECHT="$O/echte kits"; mkdir -p "$H5/.config/cypherdj" "$ECHT/techno" "$ECHT/battery"
echo '{}' > "$ECHT/techno/kit.json"; echo '{}' > "$ECHT/battery/kit.json"
ln -s "$ECHT" "$H5/.config/cypherdj/kits"
K5=$(env -i PATH="$PATH" HOME="$H5" PYTHONPATH="$START/.." PYTHONSAFEPATH=1 python3 -m storage pfad kits)
[ "$K5" = "$H5/.config/cypherdj/kits" ]
pruef $? "A5 python3 -m storage pfad kits names the (linked) kit folder of the tmp HOME: $K5"
rm -rf "$O/v5"
env -i PATH="$PATH" HOME="$H5" CYPHERDJ_SYSFS_CPU="$SYS" CYPHERDJ_UMGEBUNG=/nicht/da DJK_PW_DUMP="$O/dump.json" \
  "$START/djk-start" --strudel --vorlagen-nach "$O/v5" >"$O/a5.txt" 2>&1; R=$?
Z5=$(grep -h -A3 '^ExecStart=' "$O/v5/cypherdj-oberflaeche.service" 2>/dev/null | tr '\n' ' ')
[ "$R" = 0 ] && [[ "$Z5" == *"--kit techno"* ]] && [[ "$Z5" == *"--loops $H5/.config/cypherdj/loops"* ]]
pruef $? "A5 production: --vorlagen-nach finds the kit through the table's kit folder (a link) and names the table's loop folder: rc $R: ${Z5:0:300} $(head -c 200 "$O/a5.txt")"
BLOCK=$(sed -n '/^    ZIEL=""$/,/^    UNITS+=("\$U")$/p' "$START/djk-start")
[ -n "$BLOCK" ] || { echo "FEHL erzeuger block not found in djk-start"; exit 1; }
erz5() {  # $1 kit folder as the table gives it
  env -i PATH="$PATH" HOME="$H5" DJK=/D KIT_ORDNER="" INSTR=0 SFX="" I="" P_KERN=47100 P_ERZ=47300 KIT=techno KIT2=battery KIT3=battery KITS="$1" bash -c '
    systemd-run() { echo "RUN $*"; }; mkdir() { :; }; warte() { :; }; abbruch() { echo "ABBRUCH $1"; exit 5; }; w() { echo "$1"; }
    UNITS=()
    for s in 1 2 3; do
'"$BLOCK"'
    done' 2>&1 | sed -n 's/^    RUN/RUN/p'
}
L5=$(erz5 "$K5")
[ "$(echo "$L5" | grep -c -- "--allow-fs-read=$K5 ")" = 3 ] && [ "$(echo "$L5" | grep -c -- "--allow-fs-read=$ECHT ")" = 3 ]
pruef $? "A5 production: a linked kit folder: all three erzeuger lines carry --allow-fs-read for the link and for its target"
mkdir -p "$O/h5b/kits/techno" "$O/h5b/kits/battery"; echo '{}' > "$O/h5b/kits/techno/kit.json"; echo '{}' > "$O/h5b/kits/battery/kit.json"; L5B=$(erz5 "$O/h5b/kits")
[ "$(echo "$L5B" | grep -c -- "--allow-fs-read=$O/h5b/kits ")" = 3 ] && [ "$(echo "$L5B" | grep -o -- "--allow-fs-read=$O/h5b/kits " | wc -l)" = 3 ]
pruef $? "A5 production: a real kit folder: the lines are unchanged (one --allow-fs-read per folder)"
# A6 fresh HOME (task 14): the shipped table says vorgabe neu; djk-starter first runs "djk-umzug einrichten --still"
H6="$O/h6"; mkdir -p "$H6"
env -i PATH="$PATH" HOME="$H6" CYPHERDJ_UMGEBUNG=/nicht/da "$START/djk-starter" --nur demo >"$O/a6.txt" 2>&1; R=$?
[ "$R" = 0 ] && [ -f "$H6/cypherdj/werke/projekte/demo/project.json" ] && [ ! -e "$H6/cypherdj-projekte" ] \
  && [ "$(readlink "$H6/.config/cypherdj/kits")" = "$H6/cypherdj/werke/kits" ] && [ -d "$H6/cypherdj/werke/kits" ] \
  && [ "$(readlink "$H6/.config/cypherdj/loops")" = "$H6/cypherdj/werke/loops" ] && [ -d "$H6/cypherdj/werke/presets" ]
pruef $? "A6 fresh HOME: djk-starter --nur demo creates heim/werke/projekte/demo and the kit link: rc $R: $(head -c 300 "$O/a6.txt")"
# the second run may still add the old-place link of a kind that has content by now (einrichten, state nur_neu); from then on nothing changes
env -i PATH="$PATH" HOME="$H6" CYPHERDJ_UMGEBUNG=/nicht/da "$START/djk-starter" --nur demo >"$O/a6b.txt" 2>&1; R2=$?
LS1=$(cd "$H6" && find . ! -name bericht.jsonl | sort | tr '\n' ' ')
env -i PATH="$PATH" HOME="$H6" CYPHERDJ_UMGEBUNG=/nicht/da "$START/djk-starter" --nur demo >"$O/a6b.txt" 2>&1; R=$?
[ "$R" = 0 ] && [ "$R2" = 0 ] && [ "$LS1" = "$(cd "$H6" && find . ! -name bericht.jsonl | sort | tr '\n' ' ')" ] && grep -q "kept project demo" "$O/a6b.txt"
pruef $? "A6 a further run of djk-starter changes nothing: rc $R"
# a test instance never creates the heim folder
H6B="$O/h6b"; mkdir -p "$H6B"
env -i PATH="$PATH" HOME="$H6B" CYPHERDJ_UMGEBUNG=/nicht/da "$START/djk-starter" --nur graphen --instanz i >"$O/a6c.txt" 2>&1
[ ! -e "$H6B/cypherdj" ]
pruef $? "A6 a test instance does not create the heim folder"

# A7 heim whose parent is missing (unmounted disk): djk-start reports it, creates nothing there and goes on. The run stops at the
# missing --strudel kit (exit 2) before anything is started; stubs for the tools that would start something prove it.
H7="$O/h7"; mkdir -p "$H7" "$O/stub"
for t in systemd-run systemctl pactl pw-link pw-jack; do printf '#!/bin/sh\necho "$0 $*" >> "%s/aufrufe"\nexit 99\n' "$O" > "$O/stub/$t"; chmod +x "$O/stub/$t"; done
env -i PATH="$O/stub:$PATH" HOME="$H7" CYPHERDJ_HEIM="$O/keine-platte/cypherdj" CYPHERDJ_SYSFS_CPU="$SYS" CYPHERDJ_UMGEBUNG=/nicht/da DJK_PW_DUMP="$O/dump.json" \
  "$START/djk-start" --strudel >"$O/a7.txt" 2>&1; R=$?
[ "$R" = 6 ] && grep -q "CYPHERDJ_HEIM ($O/keine-platte/cypherdj) has no marker file .cypherdj-heim: is the disk mounted?" "$O/a7.txt" \
  && grep -q "Nothing started" "$O/a7.txt" && [ ! -e "$O/keine-platte" ] && [ ! -e "$H7/cypherdj" ] && [ ! -s "$O/aufrufe" ]
pruef $? "A7 heim on a missing disk: refusal printed, nothing created there, start aborts with exit 6, no unit started: rc $R: $(head -c 400 "$O/a7.txt")"
echo "OK $OK FEHL $FEHL"; [ "$FEHL" = 0 ]
