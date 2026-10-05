#!/usr/bin/env bash
# Eigene Null-Senke je Prüflauf (ROADMAP §8.4, SCHNITTSTELLEN §19.5). Aufruf: senke_an.sh <name>
# Der Name muss mit cypherdj-pruef- beginnen (Riegel §8). Gibt die Modul-ID aus und legt sie ab unter
# ${TMPDIR:-/tmp}/cypherdj-senken/<name>.modid. Wartet, bis der JACK-Port <name>:playback_FL sichtbar ist.
# Andreas' Standardausgang darf sich dabei nicht ändern; tut er es doch, wird die Senke sofort wieder entladen (Rückgabe 6).
set -euo pipefail
NAME="${1:?Name fehlt}"
case "$NAME" in cypherdj-pruef-*) ;; *) echo "Senke $NAME: Name muss mit cypherdj-pruef- beginnen" >&2; exit 3 ;; esac
ABLAGE=${TMPDIR:-/tmp}/cypherdj-senken
mkdir -p "$ABLAGE"
if [ -f "$ABLAGE/$NAME.modid" ]; then echo "Senke $NAME existiert schon (Modul $(cat "$ABLAGE/$NAME.modid"))" >&2; exit 4; fi
VORHER=$(pactl get-default-sink)
ID=$(pactl load-module module-null-sink sink_name="$NAME" sink_properties=node.description="$NAME")
echo "$ID" > "$ABLAGE/$NAME.modid"
NACHHER=$(pactl get-default-sink)
if [ "$VORHER" != "$NACHHER" ]; then
  pactl unload-module "$ID"
  rm -f "$ABLAGE/$NAME.modid"
  echo "Senke $NAME: Standardausgang wechselte von $VORHER auf $NACHHER; Senke wieder entladen" >&2
  exit 6
fi
for _ in $(seq 1 50); do
  if pw-link -i | grep -qx "$NAME:playback_FL"; then echo "$ID"; exit 0; fi
  sleep 0.1
done
echo "Senke $NAME: Port $NAME:playback_FL nach 5 s nicht sichtbar" >&2
exit 5
