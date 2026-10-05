#!/usr/bin/env bash
# Riegel gegen ungefragten Ton am lebenden Graphen (SCHNITTSTELLEN.md §8). Beide Ziele sind eigene Null-Senken, also
# stumm, auch wenn der Riegel versagt:
#   verboten  riegelprobe-<i>            (weder „stumm“ noch cypherdj-pruef-): Rückgabe 3, keine Verbindung
#   erlaubt   cypherdj-pruef-<i>-riegel  Positiv-Gegenprobe: dieselbe Messung sieht die Verbindung
# Die Verbindungen werden 1 s nach dem Start gezählt, solange eine fehlerhafte Notbahn noch liefe.
# Aufruf: CYPHERDJ_INSTANZ=a riegel.sh <ausgabe-ordner>   Rückgabe 0 bestanden, 1 nicht bestanden.
set -uo pipefail
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen}"
AUS="${1:?Ausgabe-Ordner fehlt}"
mkdir -p "$AUS"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../.." && pwd)
NB=$DJK/notbahn/build/cypherdj-notbahn
I=$CYPHERDJ_INSTANZ
VERBOTEN=riegelprobe-$I
ERLAUBT=cypherdj-pruef-$I-riegel
ID_V=$(pactl load-module module-null-sink sink_name="$VERBOTEN" sink_properties=node.description="$VERBOTEN")
"$DJK/pruefstand/senke/senke_an.sh" "$ERLAUBT" > /dev/null
trap 'pactl unload-module "$ID_V"; "$DJK/pruefstand/senke/senke_ab.sh" "$ERLAUBT" > /dev/null' EXIT
for _ in $(seq 1 50); do pw-link -i | grep -qx "$VERBOTEN:playback_FL" && break; sleep 0.1; done
zaehle() { pw-link -l | grep -c -e "cypherdj-notbahn-$I:master_" ; }

pw-link -l > "$AUS/links_vorher.txt"
pw-jack -p 256 "$NB" --master "$VERBOTEN:playback_F" 2> "$AUS/riegel_verboten.err" & P=$!
sleep 1
pw-link -l > "$AUS/links_waehrend.txt"
N_V=$(grep -c "cypherdj-notbahn-$I:master_" "$AUS/links_waehrend.txt")
kill "$P" 2>/dev/null
wait "$P"; RC=$?
pw-link -l > "$AUS/links_nachher.txt"
filter() { grep -E "$VERBOTEN|cypherdj-notbahn-$I" "$1"; }
GLEICH=nein
diff <(filter "$AUS/links_vorher.txt") <(filter "$AUS/links_waehrend.txt") > /dev/null &&
  diff <(filter "$AUS/links_vorher.txt") <(filter "$AUS/links_nachher.txt") > /dev/null && GLEICH=ja
echo "verboten: Rückgabe $RC, Verbindungen der Notbahn nach 1 s: $N_V, pw-link -l (gefiltert) vorher gleich während gleich nachher: $GLEICH"
echo "verboten: Meldung: $(cat "$AUS/riegel_verboten.err")"
echo "ungefiltert: $(diff "$AUS/links_vorher.txt" "$AUS/links_nachher.txt" | grep -c '^[<>]') geänderte Zeilen (andere Sessions)"

pw-jack -p 256 "$NB" --master "$ERLAUBT:playback_F" 2> "$AUS/riegel_erlaubt.err" & P=$!
sleep 1
N_E=$(zaehle)
kill -TERM "$P"; wait "$P"; RC_E=$?
echo "erlaubt (Gegenprobe): Verbindungen der Notbahn nach 1 s: $N_E, Rückgabe nach SIGTERM $RC_E"
[ "$RC" = 3 ] && [ "$N_V" = 0 ] && [ "$GLEICH" = ja ] && [ "$N_E" -ge 2 ] && { echo "Riegel bestanden"; exit 0; }
echo "Riegel NICHT bestanden"; exit 1
