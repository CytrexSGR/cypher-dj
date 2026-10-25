#!/usr/bin/env bash
# Messprobe Arbeitsfaden-Last (Paket 1.13 Warp, vor Slice 2): EIN Lauf von ziel_lauf_boxen.py (vier Decks im Keylock und zwei Loop-Boxen an einer
# Prüfinstanz, Null-Senke, Notbahn daneben) ohne oder mit einem Warp-Werk daneben (kern_kosten_warp_werk: 32 Bungee-Stimmen auf 4 Arbeitsfäden mit
# Vorlauf, SCHED_FIFO unter den Keylock-Fäden). Das Werk läuft als eigener Prozess auf derselben Maschine; es teilt Kerne, Caches und Speicherbandbreite
# mit dem Kern, nicht den Prozess (die Scheduler-Wirkung innerhalb eines Prozesses ist damit nicht gemessen; Bericht, offene Flanke).
# Aufruf: warp_last_lauf.sh <name> <modus> [minuten] [ausgabe-ordner]
#   modus: ohne            Grundlinie, kein Werk
#          mit             Werk 32 Stimmen, 4 Fäden, Korn 512 (COMPLEX)
#          fein            Werk 32 Stimmen, 4 Fäden, Korn 256 (TONES)
#          zwei            Werk 32 Stimmen, 2 Fäden, Korn 512
#          halb            Werk 16 Stimmen, 4 Fäden, Korn 512 (Pool halbiert)
#          WERK_EXTRA      weitere Argumente für das Werk, z. B. --vorlauf 12288 oder --faeden 6 (Umgebungsvariable)
# Umgebung: CYPHERDJ_INSTANZ (Prüfinstanz, nie g, h, i, nie der Betrieb), WERK (Pfad zu kern_kosten_warp_werk, Vorgabe $DJK/kern/build/kern_kosten_warp_werk),
#           KERN (Pfad zu cypherdj-kern, Vorvorgabe $DJK/kern/build/cypherdj-kern). Das Echtzeit-Schloss nimmt das Skript selbst.
# Ergebnis: <ausgabe>/<name>/{werk.txt, werk.json, ergebnis.json (Kopie des Kern-Laufs), meta.txt}. Rückgabe: Rückgabe von ziel_lauf_boxen.py (0 Gate
# gehalten, 1 gerissen, 2 ungültig), 3 kein Schloss, 4 Aufruf.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
# fehlende Aufrufargumente enden mit 4 (nicht mit 1 = Gate gerissen): `${1:?}` bricht in bash mit 1 ab
[ -n "${1:-}" ] || { echo "name fehlt" >&2; exit 4; }
[ -n "${2:-}" ] || { echo "modus fehlt (ohne|mit|fein|zwei|halb)" >&2; exit 4; }
NAME="$1"; MODUS="$2"; MIN="${3:-5}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
AUS="${4:-$HOME/messungen/2026-10-24-w1-bau/messprobe}"
[ -n "${CYPHERDJ_INSTANZ:-}" ] || { echo "CYPHERDJ_INSTANZ setzen (Prüfinstanz a)" >&2; exit 4; }
case "$CYPHERDJ_INSTANZ" in g|h|i) echo "Instanz $CYPHERDJ_INSTANZ ist tabu" >&2; exit 4;; esac
WERK="${WERK:-$DJK/kern/build/kern_kosten_warp_werk}"
KERN="${KERN:-$DJK/kern/build/cypherdj-kern}"
case "$MODUS" in
  ohne) WERK_ARGS="";;
  mit)  WERK_ARGS="--stimmen 32 --faeden 4 --fein 0";;
  fein) WERK_ARGS="--stimmen 32 --faeden 4 --fein 1";;
  zwei) WERK_ARGS="--stimmen 32 --faeden 2 --fein 0";;
  halb) WERK_ARGS="--stimmen 16 --faeden 4 --fein 0";;
  *) echo "modus ohne|mit|fein|zwei|halb" >&2; exit 4;;
esac
WERK_ARGS="$WERK_ARGS ${WERK_EXTRA:-}"      # weitere Werk-Argumente, z. B. WERK_EXTRA="--vorlauf 12288" (nur wirksam bei einem Modus mit Werk)
[ "$MODUS" = ohne ] && WERK_ARGS=""
O="$AUS/$NAME"; mkdir -p "$O"
exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
echo "[warp-last $NAME] warte auf das Echtzeit-Schloss ..." >&2
flock -w 7200 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
{ echo "name=$NAME modus=$MODUS minuten=$MIN instanz=$CYPHERDJ_INSTANZ"; echo "start=$(date -Is)"; echo "uptime=$(uptime)";
  echo "kern=$KERN werk=$WERK args=$WERK_ARGS"; } > "$O/meta.txt"
WP=""
aufraeumen() { [ -n "$WP" ] && kill -TERM "$WP" 2>/dev/null && wait "$WP" 2>/dev/null; }
trap aufraeumen EXIT
if [ -n "$WERK_ARGS" ]; then
  # Das Werk läuft über Aufbau (Decks laden, rund 90 s) und Messfenster; Priorität 60: über allen Nicht-RT-Prozessen, unter den Keylock-Fäden (78)
  # und dem Kern-Callback. --sturm-s 20: alle 20 s ein Neuansatz aller Stimmen (Start-Sturm, Zeit bis alle Ringe 2048 Frames halten)
  # shellcheck disable=SC2086
  "$WERK" $WERK_ARGS --prio 60 --sturm-s 20 --sek $(( MIN * 60 + 150 )) --json > "$O/werk.txt" 2>&1 &
  WP=$!
fi
python3 "$HIER/ziel_lauf_boxen.py" --fall T128 --boxen an --lauf "warplast-$NAME" --minuten "$MIN" --kern "$KERN"
RC=$?
echo "rueckgabe_kern=$RC" >> "$O/meta.txt"
if [ -n "$WP" ]; then wait "$WP"; echo "rueckgabe_werk=$?" >> "$O/meta.txt"; WP=""; tail -n 1 "$O/werk.txt" > "$O/werk.json"; fi
ERG=$(ls -dt "$HIER"/laeufe/warplast-"$NAME"-* 2>/dev/null | head -1)
[ -n "$ERG" ] && cp "$ERG/ergebnis.json" "$O/ergebnis.json" && echo "kern_lauf=$ERG" >> "$O/meta.txt"
echo "ende=$(date -Is)" >> "$O/meta.txt"
exit $RC
