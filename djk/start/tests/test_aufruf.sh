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

# A5 Riegel
for z in "alsa_output.stummschalter_echt:playback_F" "echt_stumm:playback_F" "cypher_stumm_echt:playback_F"; do
  rm -rf "$O/v"; lauf "$O/a5.txt" "$START/djk-start" "${VN[@]}" "$O/v" --master "$z" --ohne-cue; R=$?
  [ "$R" = 3 ] && [ ! -e "$O/v" ]; pruef $? "A5 Riegel $z: Rückgabe $R"
done
for z in "cypher_stumm:playback_F" "cypher_stumm-i:playback_F" "cypherdj-pruef-i-start:playback_F"; do
  rm -rf "$O/v"; lauf "$O/a5.txt" "$START/djk-start" "${VN[@]}" "$O/v" --master "$z" --ohne-cue; R=$?
  pruef $([ "$R" = 0 ]; echo $?) "A5 Negativ-Kontrolle Riegel $z: Rückgabe $R"
done

echo "ERGEBNIS $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
