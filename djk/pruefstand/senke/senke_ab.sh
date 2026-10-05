#!/usr/bin/env bash
# Entlädt die eigene Null-Senke eines Prüflaufs und prüft am Ziel, dass das Modul weg ist. Aufruf: senke_ab.sh <name>
set -euo pipefail
NAME="${1:?Name fehlt}"
DATEI=${TMPDIR:-/tmp}/cypherdj-senken/$NAME.modid
ID=$(cat "$DATEI")
pactl list short modules | grep -q "^$ID[[:space:]]" || { echo "Modul $ID ($NAME) war schon weg" >&2; rm -f "$DATEI"; exit 0; }
pactl unload-module "$ID"
if pactl list short modules | grep -q "^$ID[[:space:]]"; then echo "Modul $ID ($NAME) noch geladen" >&2; exit 5; fi
rm -f "$DATEI"
echo "Senke $NAME (Modul $ID) entladen"
