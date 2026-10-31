#!/usr/bin/env bash
# Paket 1.13 Warp, Slice 2 (AK31 am Ziel): EIN Lauf von ziel_lauf_boxen.py (vier Decks im Keylock und zwei Loop-Boxen an einer Prüfinstanz, Null-Senke, Notbahn daneben) mit
# einem Arrangement mit 32 Audio-Spuren im Kern: ohne = ungewarpt (Grundlinie), warp = jeder Clip COMPLEX im Warp-Werk des Kerns (kern.toml warp_faeden, Vorgabe 4).
# Aufruf: warp_arr_lauf.sh <name> <ohne|warp> [minuten] [ausgabe-ordner]
# Umgebung: CYPHERDJ_INSTANZ (Prüfinstanz, nie g, h, i, nie der Betrieb), KERN (Pfad zu cypherdj-kern, Vorgabe $DJK/kern/build/cypherdj-kern; der Bau braucht CYPHERDJ_BUNGEE=ON).
#           Das Echtzeit-Schloss nimmt das Skript selbst.
# Ergebnis: <ausgabe>/<name>/{ergebnis.json (Kopie des Kern-Laufs), meta.txt}. Rückgabe: Rückgabe von ziel_lauf_boxen.py (0 Gate gehalten, 1 gerissen, 2 ungültig), 3 kein Schloss, 4 Aufruf.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
[ -n "${1:-}" ] || { echo "name fehlt" >&2; exit 4; }
case "${2:-}" in ohne|warp) ;; *) echo "modus ohne|warp" >&2; exit 4;; esac
NAME="$1"; MODUS="$2"; MIN="${3:-5}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
AUS="${4:-$HOME/messungen/2026-10-24-w2-bau/ziel}"
[ -n "${CYPHERDJ_INSTANZ:-}" ] || { echo "CYPHERDJ_INSTANZ setzen (Prüfinstanz a)" >&2; exit 4; }
case "$CYPHERDJ_INSTANZ" in g|h|i) echo "Instanz $CYPHERDJ_INSTANZ ist tabu" >&2; exit 4;; esac
KERN="${KERN:-$DJK/kern/build/cypherdj-kern}"
O="$AUS/$NAME"; mkdir -p "$O"
exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
echo "[warp-arr $NAME] warte auf das Echtzeit-Schloss ..." >&2
flock -w 7200 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
{ echo "name=$NAME modus=$MODUS minuten=$MIN instanz=$CYPHERDJ_INSTANZ"; echo "start=$(date -Is)"; echo "uptime=$(uptime)"; echo "kern=$KERN"; } > "$O/meta.txt"
python3 "$HIER/ziel_lauf_boxen.py" --fall T128 --boxen an --arr "$MODUS" --lauf "warparr-$NAME" --minuten "$MIN" --kern "$KERN"
RC=$?
echo "rueckgabe_kern=$RC" >> "$O/meta.txt"
ERG=$(ls -dt "$HIER"/laeufe/warparr-"$NAME"-* 2>/dev/null | head -1)
[ -n "$ERG" ] && cp "$ERG/ergebnis.json" "$O/ergebnis.json" && echo "kern_lauf=$ERG" >> "$O/meta.txt"
echo "ende=$(date -Is)" >> "$O/meta.txt"
exit $RC
