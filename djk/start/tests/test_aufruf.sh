#!/usr/bin/env bash
# Prüflauf für Aufruf, Konfiguration und Riegel von djk-start/djk-stop, ohne Units, ohne PipeWire, ohne Ton.
# Alles läuft über --vorlagen-nach (füllt Drop-ins in ein Wegwerf-Verzeichnis) oder bricht vorher ab.
# Aufruf: tests/test_aufruf.sh
# Prüfpunkte:
#   A1 jede Option ohne Wert (letztes Argument, oder gefolgt von einer Option) -> Rückgabe 2 binnen 3 s, Meldung nennt
#      die Option, kein Traceback; djk-stop --instanz ebenso. Negativ-Kontrolle: djk-stop --instanz i --still -> 0.
#   A2 Konfiguration: Befehlseinschleusung in udp_port, kaputte TOML, Port außerhalb, Wahrheitswert als Port,
#      relativer Arbeitsbestand -> Rückgabe 2, Meldung nennt Datei und Schlüssel, kein Traceback, nichts ausgeführt.
#      Negativ-Kontrolle: unveränderte konfig/kern.toml -> 0.
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
kk() { sed "s|^$1 *=.*|$1 = $2|" "$DJK/konfig/kern.toml" > "$O/kern.toml"; }
fall() {  # $1 Name, $2 Datei-Option, $3 Schlüssel für die Meldung
  lauf "$O/a2.txt" "$START/djk-start" "${VN[@]}" "$O/v" "$2" "$O/${4:-kern}.toml"; R=$?
  [ "$R" = 2 ] && grep -q "${4:-kern}.toml" "$O/a2.txt" && grep -q -- "$3" "$O/a2.txt" && ! grep -q Traceback "$O/a2.txt" \
    && [ ! -e "$O/eingeschleust" ]
  pruef $? "A2 $1: Rückgabe $R: $(head -1 "$O/a2.txt")"
}
kk udp_port "\"V[\$(touch $O/eingeschleust)]\""; fall "Einschleusung in udp_port" --kern-konfig udp_port
sed 's|^udp_port *=.*|udp_port = |' "$DJK/konfig/kern.toml" > "$O/kern.toml"; fall "kaputte TOML" --kern-konfig "kern.toml"
kk udp_port 99999; fall "udp_port 99999" --kern-konfig udp_port
kk udp_port 47100.5; fall "udp_port 47100.5" --kern-konfig udp_port
kk arbeitsbestand '"material"'; fall "arbeitsbestand relativ" --kern-konfig arbeitsbestand
kk arbeitsbestand '"/dev/shm/mit leerzeichen"'; fall "arbeitsbestand mit Leerzeichen" --kern-konfig arbeitsbestand
sed 's|^ws_port *=.*|ws_port = true|' "$DJK/konfig/leitstand.toml" > "$O/leitstand.toml"; fall "ws_port true" --leitstand-konfig ws_port leitstand
cp "$DJK/konfig/kern.toml" "$O/kern.toml"
lauf "$O/a2.txt" "$START/djk-start" "${VN[@]}" "$O/v" --kern-konfig "$O/kern.toml"; R=$?
pruef $([ "$R" = 0 ]; echo $?) "A2 Negativ-Kontrolle unveränderte kern.toml: Rückgabe $R"

# A3 Weitergabe an Oberfläche und Leitstand
sed -e 's|^udp_port *=.*|udp_port = 47170|' -e 's|^arbeitsbestand *=.*|arbeitsbestand = "/dev/shm/cypherdj/material-abw"|' \
  "$DJK/konfig/kern.toml" > "$O/kern.toml"
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
[ "$R" = 2 ]; pruef $? "A6 Negativ-Kontrolle --arr2: Rückgabe $R"

echo "ERGEBNIS $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
