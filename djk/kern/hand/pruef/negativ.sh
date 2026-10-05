#!/bin/sh
# Negativ-Kontrolle und Positiv-Gegenprobe des Hand-Wegs (Scheibe 19), stumm, nur MIDI-Ports:
#   1. Softcontroller läuft 10 s ohne Tastendruck, Prüfclient verbunden -> 0 Ereignisse
#   2. derselbe Aufbau, eine Taste "q" -> genau 1 Ereignis (deck/1/fader, Wert 8)
#   3. LED-Rückweg: Prüfclient schickt "vorschlag an" über hand_led -> Softcontroller zeigt "LED vorschlag an"
# Aufruf: sh negativ.sh <hand_pruef> <softcontroller> <mapping> <ordner>; letzte Zeile GRUEN oder ROT, Rückgabe 0 bei GRUEN.
set -eu
PRUEF=$1
SOFT=$2
MAP=$3
AUS=$4
export CYPHERDJ_INSTANZ="${CYPHERDJ_INSTANZ:-b}"
Q="cypherdj-softcontroller-$CYPHERDJ_INSTANZ"
mkdir -p "$AUS"

pw-jack "$PRUEF" --mapping "$MAP" --quelle "$Q:hand" --sekunden 12 --log "$AUS/neg_empfang.jsonl" > /dev/null 2>&1 &
P=$!
sleep 10 | "$SOFT" > "$AUS/neg_soft.out" 2>&1
wait "$P"
NEG=$(grep '"typ":"ende"' "$AUS/neg_empfang.jsonl" | sed 's/.*"ereignisse":\([0-9]*\).*/\1/')
VERB=$(grep -c '"typ":"verbunden"' "$AUS/neg_empfang.jsonl" || true)

pw-jack "$PRUEF" --mapping "$MAP" --quelle "$Q:hand" --sekunden 8 --log "$AUS/pos_empfang.jsonl" \
  --led vorschlag:1 --led-ziel "$Q:led" > /dev/null 2>&1 &
P=$!
(sleep 3; printf 'q'; sleep 3) | "$SOFT" > "$AUS/pos_soft.out" 2>&1
wait "$P"
POS=$(grep '"typ":"ende"' "$AUS/pos_empfang.jsonl" | sed 's/.*"ereignisse":\([0-9]*\).*/\1/')
POS_ZIEL=$(grep -c '"bytes":\[176,7,8\].*"ziel":"deck/1/fader"' "$AUS/pos_empfang.jsonl" || true)
LED=$(grep -c '^LED vorschlag an$' "$AUS/pos_soft.out" || true)

echo "ohne Taste: verbunden=$VERB ereignisse=$NEG | eine Taste: ereignisse=$POS deck/1/fader=8: $POS_ZIEL | LED vorschlag an: $LED"
if [ "$VERB" = 1 ] && [ "$NEG" = 0 ] && [ "$POS" = 1 ] && [ "$POS_ZIEL" = 1 ] && [ "$LED" = 1 ]; then
  echo GRUEN
else
  echo ROT
  exit 1
fi
