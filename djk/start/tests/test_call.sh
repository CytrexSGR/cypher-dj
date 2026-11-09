#!/usr/bin/env bash
# Prüflauf für Aufruf, Konfiguration und Riegel von djk-start/djk-stop, ohne Units, ohne PipeWire, ohne Ton.
# Alles läuft über --vorlagen-nach (füllt Drop-ins in ein Wegwerf-Verzeichnis) oder bricht vorher ab.
# Aufruf: tests/test_call.sh
# Prüfpunkte:
#   A1 jede Option ohne Wert (letztes Argument, oder gefolgt von einer Option) -> Rückgabe 2 binnen 3 s, Meldung nennt
#      die Option, kein Traceback; djk-stop --instanz ebenso. Negativ-Kontrolle: djk-stop --instanz i --still -> 0.
#   A2 Konfiguration: Befehlseinschleusung in udp_port, kaputte TOML, Port außerhalb, Wahrheitswert als Port,
#      relativer Arbeitsbestand -> Rückgabe 2, Meldung nennt Datei und Schlüssel, kein Traceback, nichts ausgeführt.
#      Negativ-Kontrolle: unveränderte config/kern.toml -> 0.
#   A3 Weitergabe: --kern-konfig mit udp_port 47170 und eigenem Arbeitsbestand -> Oberfläche bekommt --kern-port,
#      --arbeitsbestand, --leitstand-ws; Leitstand --kern-port und --kern-konfig.
#   A4 Prüfmodus: Vorgabe setzt --pruefmodus beim Kern, --ohne-pruefmodus nicht.
#   A5 Riegel: "stumm" mitten im Namen -> 3; cypher_stumm, cypher_stumm-<i>, cypherdj-pruef-* -> 0.
# Rückgabe: 0 alle Punkte OK, 1 mindestens einer FEHL.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
DJK=$(cd "$START/.." && pwd)
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-aufruf-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
# Läuft höchstens 3 s; Rückgabe 124 heißt: hing.
lauf() { local aus=$1; shift; timeout 3 "$@" > "$aus" 2>&1; }
VN=(--instanz i --vorlagen-nach)
# Host independent: the core split always comes from an invented sysfs tree (8 cores, 16 threads like the dev box), never from the real machine.
SYS="$O/sys"; mkdir -p "$SYS"
for c in $(seq 0 15); do mkdir -p "$SYS/cpu$c/topology"; echo $((c % 8)) > "$SYS/cpu$c/topology/core_id"; echo 0 > "$SYS/cpu$c/topology/physical_package_id"; done
echo 0-15 > "$SYS/online"
export CYPHERDJ_SYSFS_CPU="$SYS"
unset CYPHERDJ_KERN_KERNE CYPHERDJ_KERN_CPUS CYPHERDJ_STEMS_CPUS

# A1 fehlende Werte
for opt in --instanz --master --cue --kern-konfig --leitstand-konfig --vorlagen-nach; do
  lauf "$O/a1.txt" "$START/djk-start" "$opt"; R=$?
  [ "$R" = 2 ] && grep -q -- "$opt" "$O/a1.txt" && ! grep -q Traceback "$O/a1.txt"
  pruef $? "A1 djk-start $opt (letztes): Rückgabe $R: $(head -1 "$O/a1.txt")"
done
for opt in --master --cue --kern-konfig --leitstand-konfig --vorlagen-nach; do
  # immer hinter --vorlagen-nach: dieser Punkt darf nie in den echten Start fallen
  lauf "$O/a1.txt" "$START/djk-start" "${VN[@]}" "$O/v" "$opt" --ton-frei; R=$?
  [ "$R" = 2 ] && grep -q -- "$opt" "$O/a1.txt"; pruef $? "A1 djk-start $opt --ton-frei: Rückgabe $R: $(head -1 "$O/a1.txt")"
done
lauf "$O/a1.txt" "$START/djk-stop" --instanz; R=$?
[ "$R" = 2 ] && grep -q -- "--instanz" "$O/a1.txt"; pruef $? "A1 djk-stop --instanz (letztes): Rückgabe $R: $(head -1 "$O/a1.txt")"
lauf "$O/a1.txt" "$START/djk-stop" --instanz i --still; R=$?
pruef $([ "$R" = 0 ]; echo $?) "A1 Negativ-Kontrolle djk-stop --instanz i --still: Rückgabe $R"

# A2 Konfiguration
kk() { sed "s|^$1 *=.*|$1 = $2|" "$DJK/config/kern.toml" > "$O/kern.toml"; }
fall() {  # $1 Name, $2 Datei-Option, $3 Schlüssel für die Meldung
  lauf "$O/a2.txt" "$START/djk-start" "${VN[@]}" "$O/v" "$2" "$O/${4:-kern}.toml"; R=$?
  [ "$R" = 2 ] && grep -q "${4:-kern}.toml" "$O/a2.txt" && grep -q -- "$3" "$O/a2.txt" && ! grep -q Traceback "$O/a2.txt" \
    && [ ! -e "$O/eingeschleust" ]
  pruef $? "A2 $1: Rückgabe $R: $(head -1 "$O/a2.txt")"
}
kk udp_port "\"V[\$(touch $O/eingeschleust)]\""; fall "Einschleusung in udp_port" --kern-konfig udp_port
sed 's|^udp_port *=.*|udp_port = |' "$DJK/config/kern.toml" > "$O/kern.toml"; fall "kaputte TOML" --kern-konfig "kern.toml"
kk udp_port 99999; fall "udp_port 99999" --kern-konfig udp_port
kk udp_port 47100.5; fall "udp_port 47100.5" --kern-konfig udp_port
kk arbeitsbestand '"material"'; fall "arbeitsbestand relativ" --kern-konfig arbeitsbestand
kk arbeitsbestand '"/dev/shm/mit leerzeichen"'; fall "arbeitsbestand mit Leerzeichen" --kern-konfig arbeitsbestand
sed 's|^ws_port *=.*|ws_port = true|' "$DJK/config/leitstand.toml" > "$O/leitstand.toml"; fall "ws_port true" --leitstand-konfig ws_port leitstand
cp "$DJK/config/kern.toml" "$O/kern.toml"
lauf "$O/a2.txt" "$START/djk-start" "${VN[@]}" "$O/v" --kern-konfig "$O/kern.toml"; R=$?
pruef $([ "$R" = 0 ]; echo $?) "A2 Negativ-Kontrolle unveränderte kern.toml: Rückgabe $R"

# A3 Weitergabe an Oberfläche und Leitstand
sed -e 's|^udp_port *=.*|udp_port = 47170|' -e 's|^arbeitsbestand *=.*|arbeitsbestand = "/dev/shm/cypherdj/material-abw"|' \
  "$DJK/config/kern.toml" > "$O/kern.toml"
rm -rf "$O/v"; lauf "$O/a3.txt" "$START/djk-start" "${VN[@]}" "$O/v" --kern-konfig "$O/kern.toml"; R=$?
OF=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
LS=$(grep '^ExecStart=/' "$O/v/cypherdj-leitstand.service.d/betrieb.conf" 2>/dev/null)
[ "$R" = 0 ] && [[ "$OF" == *"--kern-port 56170"* ]] && [[ "$OF" == *"--arbeitsbestand /dev/shm/cypherdj-i/material-abw"* ]] \
  && [[ "$OF" == *"--leitstand-ws 56200"* ]] && [[ "$LS" == *"--kern-port 56170"* ]] && [[ "$LS" == *"--kern-konfig $O/kern.toml"* ]]
pruef $? "A3 Weitergabe udp_port/arbeitsbestand: Rückgabe $R | $OF | $LS"

# A4 Prüfmodus als Vorgabe
rm -rf "$O/v"; lauf "$O/a4.txt" "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
K1=$(grep '^ExecStart=/' "$O/v/cypherdj-kern.service.d/betrieb.conf" 2>/dev/null)
rm -rf "$O/v"; lauf "$O/a4b.txt" "$START/djk-start" "${VN[@]}" "$O/v" --ohne-pruefmodus; R2=$?
K2=$(grep '^ExecStart=/' "$O/v/cypherdj-kern.service.d/betrieb.conf" 2>/dev/null)
[ "$R" = 0 ] && [[ "$K1" == *"--pruefmodus"* ]] && [ "$R2" = 0 ] && [ -n "$K2" ] && [[ "$K2" != *"--pruefmodus"* ]]
pruef $? "A4 Prüfmodus: Vorgabe mit ($R), --ohne-pruefmodus ohne ($R2)"

# A3b Mediathek-Pfad: CYPHERDJ_MEDIATHEK wird durchgereicht, ohne Variable fehlt die Option, Leerzeichen -> 2
rm -rf "$O/v"; CYPHERDJ_MEDIATHEK=/tmp/mt-pruef/mediathek.sqlite lauf "$O/a3b.txt" "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
OF=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
rm -rf "$O/v"; CYPHERDJ_UMGEBUNG=/nicht/da lauf "$O/a3c.txt" "$START/djk-start" "${VN[@]}" "$O/v"; R2=$?
OF2=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
CYPHERDJ_MEDIATHEK="/tmp/mit leer/m.sqlite" lauf "$O/a3d.txt" "$START/djk-start" "${VN[@]}" "$O/v2"; R3=$?
[ "$R" = 0 ] && [[ "$OF" == *"--mediathek /tmp/mt-pruef/mediathek.sqlite"* ]] && [ "$R2" = 0 ] && [ -n "$OF2" ] && [[ "$OF2" != *"--mediathek"* ]] && [ "$R3" = 2 ]
pruef $? "A3b Mediathek-Pfad: mit Variable ($R) durchgereicht, ohne ($R2) keine Option, mit Leerzeichen ($R3, erwartet 2)"
# A3e Katalog-Pfad (Paket 1.13): CYPHERDJ_KATALOG wird als --katalog durchgereicht, ohne Variable fehlt die Option, Leerzeichen -> 2
rm -rf "$O/v"; CYPHERDJ_KATALOG=/tmp/w1-ziel/katalog.sqlite lauf "$O/a3e.txt" "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
OF=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
rm -rf "$O/v"; lauf "$O/a3f.txt" env -u CYPHERDJ_KATALOG CYPHERDJ_UMGEBUNG=/nicht/da "$START/djk-start" "${VN[@]}" "$O/v"; R2=$?
OF2=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
CYPHERDJ_KATALOG="/tmp/mit leer/k.sqlite" lauf "$O/a3g.txt" "$START/djk-start" "${VN[@]}" "$O/v2"; R3=$?
[ "$R" = 0 ] && [[ "$OF" == *"--katalog /tmp/w1-ziel/katalog.sqlite"* ]] && [ "$R2" = 0 ] && [ -n "$OF2" ] && [[ "$OF2" != *"--katalog"* ]] && [ "$R3" = 2 ]
pruef $? "A3e Katalog-Pfad: mit Variable ($R) durchgereicht, ohne ($R2) keine Option, mit Leerzeichen ($R3, erwartet 2)"
# A3h Ablage und Python (Paket 1.13 S3a): CYPHERDJ_ANALYSE wird als --analyse, CYPHERDJ_PYTHON als --python durchgereicht, ohne Variable fehlt die Option;
#     Leerzeichen -> 2; eine Prüfinstanz nimmt nur eine Ablage unter /tmp oder /dev/shm (nie die echte unter ~/werkstatt) -> 2
rm -rf "$O/v"; CYPHERDJ_ANALYSE=/tmp/w3a-ziel/analyse CYPHERDJ_PYTHON=/tmp/w3a-py/bin/python lauf "$O/a3h.txt" "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
OF=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
rm -rf "$O/v"; lauf "$O/a3i.txt" env -u CYPHERDJ_ANALYSE -u CYPHERDJ_PYTHON CYPHERDJ_UMGEBUNG=/nicht/da "$START/djk-start" "${VN[@]}" "$O/v"; R2=$?
OF2=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
CYPHERDJ_ANALYSE="/tmp/mit leer/a" lauf "$O/a3j.txt" "$START/djk-start" "${VN[@]}" "$O/v2"; R3=$?
CYPHERDJ_PYTHON="/tmp/mit leer/python" lauf "$O/a3k.txt" "$START/djk-start" "${VN[@]}" "$O/v3"; R4=$?
CYPHERDJ_ANALYSE="$HOME/werkstatt/cypher-dj-analyse" lauf "$O/a3l.txt" "$START/djk-start" "${VN[@]}" "$O/v4"; R5=$?
[ "$R" = 0 ] && [[ "$OF" == *"--analyse /tmp/w3a-ziel/analyse"* ]] && [[ "$OF" == *"--python /tmp/w3a-py/bin/python"* ]] && [ "$R2" = 0 ] && [ -n "$OF2" ] \
  && [[ "$OF2" != *"--analyse"* ]] && [[ "$OF2" != *"--python"* ]] && [ "$R3" = 2 ] && [ "$R4" = 2 ] && [ "$R5" = 2 ]
pruef $? "A3h Ablage/Python: mit Variablen ($R) durchgereicht, ohne ($R2) keine Option, mit Leerzeichen ($R3, $R4) und echte Ablage in der Prüfinstanz ($R5) erwartet 2"

# A3m Bestand für Eins-Korrekturen (Paket 1.13 S3b): CYPHERDJ_KORREKTUREN wird als --korrekturen durchgereicht, ohne Variable fehlt die Option; Leerzeichen -> 2;
#     eine Prüfinstanz nimmt nur einen Bestand unter /tmp oder /dev/shm (nie ~/cypher-dj/bestand) -> 2
rm -rf "$O/v"; CYPHERDJ_KORREKTUREN=/tmp/w3b-ziel/bestand lauf "$O/a3m.txt" "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
OF=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
rm -rf "$O/v"; lauf "$O/a3n.txt" env -u CYPHERDJ_KORREKTUREN CYPHERDJ_UMGEBUNG=/nicht/da "$START/djk-start" "${VN[@]}" "$O/v"; R2=$?
OF2=$(grep '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
CYPHERDJ_KORREKTUREN="/tmp/mit leer/b" lauf "$O/a3o.txt" "$START/djk-start" "${VN[@]}" "$O/v2"; R3=$?
CYPHERDJ_KORREKTUREN="$HOME/cypher-dj/bestand" lauf "$O/a3p.txt" "$START/djk-start" "${VN[@]}" "$O/v4"; R4=$?
[ "$R" = 0 ] && [[ "$OF" == *"--korrekturen /tmp/w3b-ziel/bestand"* ]] && [ "$R2" = 0 ] && [ -n "$OF2" ] && [[ "$OF2" != *"--korrekturen"* ]] && [ "$R3" = 2 ] && [ "$R4" = 2 ]
pruef $? "A3m Bestand für Korrekturen: mit Variable ($R) durchgereicht, ohne ($R2) keine Option, mit Leerzeichen ($R3) und echter Bestand in der Prüfinstanz ($R4) erwartet 2"
# A5 Riegel
for z in "alsa_output.stummschalter_echt:playback_F" "echt_stumm:playback_F" "cypher_stumm_echt:playback_F"; do
  rm -rf "$O/v"; lauf "$O/a5.txt" "$START/djk-start" "${VN[@]}" "$O/v" --master "$z" --ohne-cue; R=$?
  [ "$R" = 3 ] && [ ! -e "$O/v" ]; pruef $? "A5 Riegel $z: Rückgabe $R"
done
for z in "cypher_stumm:playback_F" "cypher_stumm-i:playback_F" "cypherdj-pruef-i-start:playback_F"; do
  rm -rf "$O/v"; lauf "$O/a5.txt" "$START/djk-start" "${VN[@]}" "$O/v" --master "$z" --ohne-cue; R=$?
  pruef $([ "$R" = 0 ]; echo $?) "A5 Negativ-Kontrolle Riegel $z: Rückgabe $R"
done

# A6 --arr1 (Paket 1.18): der Produktions-Wirt startet über djk-start; die Option ist bekannt (Vorlagen-Modus nimmt sie an), steht in --help und im
#    Aufruf, und die Zeile mit djk-instrumente --arr1 steht im Startweg. Negativ-Kontrolle: eine unbekannte Option bleibt Rückgabe 2.
rm -rf "$O/v"; lauf "$O/a6.txt" "$START/djk-start" "${VN[@]}" "$O/v" --arr1; R=$?
pruef $([ "$R" = 0 ]; echo $?) "A6 djk-start --arr1 (Vorlagen-Modus): Rückgabe $R"
lauf "$O/a6.txt" "$START/djk-start" --help; R=$?
[ "$R" = 0 ] && grep -q -- "^  --arr1 " "$O/a6.txt"; pruef $? "A6 --help beschreibt --arr1: Rückgabe $R"
grep -q 'djk-instrumente" ${I:+--instanz "$I"} --arr1' "$START/djk-start"; pruef $? "A6 der Startweg ruft djk-instrumente --arr1"
lauf "$O/a6.txt" "$START/djk-start" "${VN[@]}" "$O/v" --arr2; R=$?
pruef $([ "$R" = 0 ]; echo $?) "A6 djk-start --arr2 (Vorlagen-Modus, 1.9): Rückgabe $R"
rm -rf "$O/v"; lauf "$O/a6.txt" "$START/djk-start" "${VN[@]}" "$O/v" --arr1 --arr2; R=$?
pruef $([ "$R" = 0 ]; echo $?) "A6 djk-start --arr1 --arr2 zusammen: Rückgabe $R"
lauf "$O/a6.txt" "$START/djk-start" --help; R=$?
[ "$R" = 0 ] && grep -q -- "^  --arr2 " "$O/a6.txt"; pruef $? "A6 --help beschreibt --arr2: Rückgabe $R"
grep -q 'djk-instrumente" ${I:+--instanz "$I"} --arr2' "$START/djk-start"; pruef $? "A6 der Startweg ruft djk-instrumente --arr2"
lauf "$O/a6.txt" "$START/djk-start" "${VN[@]}" "$O/v" --arr3; R=$?
[ "$R" = 2 ]; pruef $? "A6 Negativ-Kontrolle --arr3: Rückgabe $R"

# A7 --kit-ordner (package 1.9 T2.0): the option is known (Vorlagen mode accepts it), is in --help, an existing directory is accepted, a file or a missing
#    path is return 2 with a message naming the option, and the start path hands CYPHERDJ_KIT_ORDNER to the units (systemd-run --setenv on the starte line).
#    Negative control: without --kit-ordner the same call stays return 0 and the start path still sets CYPHERDJ_INSTANZ.
mkdir -p "$O/kitsd"; : > "$O/keinordner"
rm -rf "$O/v"; lauf "$O/a7.txt" "$START/djk-start" "${VN[@]}" "$O/v" --kit-ordner "$O/kitsd"; R=$?
pruef $([ "$R" = 0 ]; echo $?) "A7 djk-start --kit-ordner DIR (Vorlagen-Modus): Rückgabe $R"
lauf "$O/a7.txt" "$START/djk-start" --help; R=$?
[ "$R" = 0 ] && grep -q -- "^  --kit-ordner " "$O/a7.txt"; pruef $? "A7 --help beschreibt --kit-ordner: Rückgabe $R"
grep -E '^ *systemd-run .*--setenv=CYPHERDJ_KIT_ORDNER=\$KIT_ORDNER' "$START/djk-start" | grep -q 'CYPHERDJ_INSTANZ=\$I'; pruef $? "A7 die starte-Zeile gibt CYPHERDJ_KIT_ORDNER neben CYPHERDJ_INSTANZ weiter"
for z in "$O/keinordner" "$O/gibtsnicht"; do
  lauf "$O/a7.txt" "$START/djk-start" "${VN[@]}" "$O/v" --kit-ordner "$z"; R=$?
  [ "$R" = 2 ] && grep -q -- "--kit-ordner" "$O/a7.txt" && ! grep -q Traceback "$O/a7.txt"; pruef $? "A7 --kit-ordner $(basename "$z") (kein Ordner): Rückgabe $R: $(head -1 "$O/a7.txt")"
done
lauf "$O/a7.txt" "$START/djk-start" --kit-ordner; R=$?
[ "$R" = 2 ] && grep -q -- "--kit-ordner" "$O/a7.txt"; pruef $? "A7 --kit-ordner (letztes, ohne Wert): Rückgabe $R"
rm -rf "$O/v"; lauf "$O/a7.txt" "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
pruef $([ "$R" = 0 ]; echo $?) "A7 Negativ-Kontrolle ohne --kit-ordner: Rückgabe $R"

# A7 Core allocation (cores.py): on an invented sysfs tree (8 cores, 16 threads like the dev box) the kern process gets 4 physical cores with siblings
#    (CPUAffinity 0-3 8-11), the page gets the rest as CYPHERDJ_STEMS_CPUS (4-7,12-15), the start line "Cores:" names both.
#    CYPHERDJ_KERN_KERNE=2 changes both; an explicit CYPHERDJ_KERN_CPUS wins (stems = the rest); an explicit CYPHERDJ_STEMS_CPUS wins for the stems;
#    a core count outside the range is clamped (with a note); a core count that is no number, and a CPU that does not exist -> return 2, nothing filled.
kerne_lauf() { rm -rf "$O/v"; env -u CYPHERDJ_KERN_CPUS -u CYPHERDJ_STEMS_CPUS -u CYPHERDJ_KERN_KERNE CYPHERDJ_UMGEBUNG=/nicht/da CYPHERDJ_SYSFS_CPU="$SYS" "$@" > "$O/a7.txt" 2>&1; }
kerne_lauf timeout 3 "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
AFF=$(grep '^CPUAffinity=' "$O/v/cypherdj-kern.service.d/betrieb.conf" 2>/dev/null); STE=$(grep '^Environment=CYPHERDJ_STEMS_CPUS=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
[ "$R" = 0 ] && [ "$AFF" = "CPUAffinity=\"0-3 8-11\"" ] && [ "$STE" = "Environment=CYPHERDJ_STEMS_CPUS=4-7,12-15" ] && grep -q "^Cores: kern process 4 physical cores (CPUs 0-3 8-11), stems CPUs 4-7,12-15$" "$O/a7.txt"
pruef $? "A7 default 4 cores: $AFF, $STE (return $R)"
kerne_lauf env CYPHERDJ_KERN_KERNE=2 timeout 3 "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
AFF=$(grep '^CPUAffinity=' "$O/v/cypherdj-kern.service.d/betrieb.conf" 2>/dev/null); STE=$(grep '^Environment=CYPHERDJ_STEMS_CPUS=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
[ "$R" = 0 ] && [ "$AFF" = "CPUAffinity=\"0-1 8-9\"" ] && [ "$STE" = "Environment=CYPHERDJ_STEMS_CPUS=2-7,10-15" ]
pruef $? "A7 CYPHERDJ_KERN_KERNE=2: $AFF, $STE (return $R)"
kerne_lauf env CYPHERDJ_KERN_CPUS="0 1 8 9" timeout 3 "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
AFF=$(grep '^CPUAffinity=' "$O/v/cypherdj-kern.service.d/betrieb.conf" 2>/dev/null); STE=$(grep '^Environment=CYPHERDJ_STEMS_CPUS=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
[ "$R" = 0 ] && [ "$AFF" = "CPUAffinity=\"0-1 8-9\"" ] && [ "$STE" = "Environment=CYPHERDJ_STEMS_CPUS=2-7,10-15" ] && grep -q "^Cores: kern process CYPHERDJ_KERN_CPUS (CPUs 0-1 8-9)" "$O/a7.txt"
pruef $? "A7 explicit CYPHERDJ_KERN_CPUS wins: $AFF, $STE (return $R)"
kerne_lauf env CYPHERDJ_STEMS_CPUS="6-7" timeout 3 "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
AFF=$(grep '^CPUAffinity=' "$O/v/cypherdj-kern.service.d/betrieb.conf" 2>/dev/null); STE=$(grep '^Environment=CYPHERDJ_STEMS_CPUS=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
[ "$R" = 0 ] && [ "$AFF" = "CPUAffinity=\"0-3 8-11\"" ] && [ "$STE" = "Environment=CYPHERDJ_STEMS_CPUS=6-7" ]
pruef $? "A7 explicit CYPHERDJ_STEMS_CPUS wins for the stems: $STE (return $R)"
kerne_lauf env CYPHERDJ_KERN_KERNE=8 timeout 3 "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
AFF=$(grep '^CPUAffinity=' "$O/v/cypherdj-kern.service.d/betrieb.conf" 2>/dev/null); STE=$(grep '^Environment=CYPHERDJ_STEMS_CPUS=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null)
[ "$R" = 0 ] && [ "$AFF" = "CPUAffinity=\"0-6 8-14\"" ] && [ "$STE" = "Environment=CYPHERDJ_STEMS_CPUS=7,15" ] && grep -q "note: CYPHERDJ_KERN_KERNE = 8 is outside 1 to 7.*using 7" "$O/a7.txt"
pruef $? "A7 core count 8 is clamped: $AFF, $STE (return $R)"
kerne_lauf env CYPHERDJ_KERN_KERNE=vier timeout 3 "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
[ "$R" = 2 ] && grep -q "whole number" "$O/a7.txt" && [ ! -e "$O/v/cypherdj-kern.service.d/betrieb.conf" ]
pruef $? "A7 negative control core count 'vier': return $R, nothing filled"
kerne_lauf env CYPHERDJ_KERN_CPUS="0 99" timeout 3 "$START/djk-start" "${VN[@]}" "$O/v"; R=$?
[ "$R" = 2 ] && grep -q "not online" "$O/a7.txt"; pruef $? "A7 negative control CPU 99: return $R"

echo "ERGEBNIS $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
