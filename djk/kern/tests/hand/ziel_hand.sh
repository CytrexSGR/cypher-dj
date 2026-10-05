#!/usr/bin/env bash
# Prüflauf der Scheibe 35 am Ziel unter dem Echtzeit-Schloss (ROADMAP §8.5): hält das Echtzeit-Schloss (CYPHERDJ_ECHTZEIT_SCHLOSS)
# für den ganzen Lauf und ruft ziel_hand.py mit denselben Argumenten. Stumm: eigene Null-Senke je Lauf, nie an echte
# Ausgänge. Aufruf: CYPHERDJ_INSTANZ=i ziel_hand.sh --art latenz --n 300 (weitere Arten: ziel_hand.py --help).
# Rückgabe: die von ziel_hand.py (0 GRÜN, 1 ROT, 2 Aufbau oder Instrument unbrauchbar), 3 kein Schloss.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen (Scheibe 35: i)}"
HIER=$(cd "$(dirname "$0")" && pwd)
exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
flock -w 3600 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
python3 "$HIER/ziel_hand.py" "$@"
