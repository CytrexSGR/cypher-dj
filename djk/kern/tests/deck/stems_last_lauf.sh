#!/usr/bin/env bash
# Lastlauf AK26 (Paket 1.13 Warp, Slice 6 Stems, D20): EIN Lauf von ziel_lauf_boxen.py (vier Decks im Keylock und zwei Loop-Boxen an einer Prüfinstanz,
# Null-Senke, Quantum 256 per pw-jack) ohne oder mit einem echten werkstatt.stems-Lauf daneben (demucs htdemucs, 4 Fäden, nice 19, ionice -c3, nie die
# GPU). Die Last ist der Python-Prozess der Werkstatt, wie ihn der Server startet; er teilt Kerne, Caches und Speicherbandbreite mit dem Kern.
# Aufruf: stems_last_lauf.sh <name> <modus> [minuten] [ausgabe-ordner]
#   modus: ohne   Grundlinie, keine Last
#          mit    echter werkstatt.stems-Lauf (demucs, 4 Fäden, nice 19, ionice -c3, CUDA_VISIBLE_DEVICES leer) auf QUELLE, in Schleife über das Messfenster
# Umgebung: CYPHERDJ_INSTANZ (Prüfinstanz, nie g, h, i, nie der Betrieb), QUELLE (.f32 des Dekodier-Caches, Vorgabe der Probe-Track b3f393fc...),
#           PY (Werkstatt-venv-Python, Vorgabe $DJK/werkstatt/.venv/bin/python), KERN (Pfad zu cypherdj-kern, Vorgabe $DJK/kern/build/cypherdj-kern),
#           SCHLOSS_WARTE_S (Wartezeit auf das Echtzeit-Schloss, Vorgabe 7200; für Prüfungen). Das Echtzeit-Schloss nimmt das Skript selbst.
# Ergebnis: <ausgabe>/<name>-<zeitstempel>-<pid>/{meta.txt, ergebnis.json und pwtop.txt (Kopien des Kern-Laufs), stems.jsonl, stems.stderr}.
# Rückgabe: Rückgabe von ziel_lauf_boxen.py (0 Gate gehalten, 1 gerissen, 2 ungültig), 3 kein Schloss, 4 Aufruf.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
# fehlende Aufrufargumente enden mit 4 (nicht mit 1 = Gate gerissen)
[ -n "${1:-}" ] || { echo "name fehlt" >&2; exit 4; }
[ -n "${2:-}" ] || { echo "modus fehlt (ohne|mit)" >&2; exit 4; }
NAME="$1"; MODUS="$2"; MIN="${3:-5}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
AUS="${4:-$HOME/messungen/2026-10-30-w6-bau/lastlauf}"
[ -n "${CYPHERDJ_INSTANZ:-}" ] || { echo "CYPHERDJ_INSTANZ setzen (Prüfinstanz)" >&2; exit 4; }
case "$CYPHERDJ_INSTANZ" in g|h|i) echo "Instanz $CYPHERDJ_INSTANZ ist tabu" >&2; exit 4;; esac
case "$MODUS" in ohne|mit) ;; *) echo "modus ohne|mit" >&2; exit 4;; esac
KERN="${KERN:-$DJK/kern/build/cypherdj-kern}"
PY="${PY:-$DJK/werkstatt/.venv/bin/python}"
QUELLE="${QUELLE:-$(ls ~/.cache/cypherdj*/arr/audio/b3f393fcf7b9dcf7a1532c0bb77dd5685ecc03927aaf6366233465e3be4948ec.f32 2>/dev/null | head -1)}"
# Vorprüfungen VOR dem Schloss: ein Lauf, der nicht messen kann, darf das Echtzeit-Schloss nicht halten (und keinen Fork-Sturm auslösen)
[ -x "$KERN" ] || { echo "KERN nicht ausführbar: $KERN" >&2; exit 4; }
if [ "$MODUS" = mit ]; then
  [ -x "$PY" ] || { echo "PY nicht ausführbar: $PY" >&2; exit 4; }
  (cd "$DJK/werkstatt" && CUDA_VISIBLE_DEVICES= nice -n 19 "$PY" -c "import werkstatt.stems") >/dev/null 2>&1 \
    || { echo "import werkstatt.stems scheitert mit PY=$PY" >&2; exit 4; }
  [ -f "$QUELLE" ] || { echo "QUELLE fehlt" >&2; exit 4; }
  # 120 s Stereo float32 bei 48 kHz = 120*48000*8 Bytes (die Schleife trennt --f1 120*48000)
  [ "$(stat -c %s "$QUELLE")" -ge $(( 120 * 48000 * 8 )) ] || { echo "QUELLE kürzer als 120 s: $QUELLE" >&2; exit 4; }
fi
exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
echo "[stems-last $NAME] warte auf das Echtzeit-Schloss ..." >&2
flock -w "${SCHLOSS_WARTE_S:-7200}" 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
# Jeder Lauf bekommt einen frischen Ordner (Name, Zeitstempel, PID): keine Altdaten in stems.jsonl, und der Kern-Lauf ist genau dieser
LAUF="$NAME-$(date +%Y%m%dT%H%M%S)-$$"
O="$AUS/$LAUF"; mkdir -p "$AUS" && mkdir "$O" || { echo "Ordner existiert schon oder nicht anlegbar: $O" >&2; exit 4; }
{ echo "name=$NAME lauf=$LAUF modus=$MODUS minuten=$MIN instanz=$CYPHERDJ_INSTANZ quelle=${QUELLE:-}"; echo "start=$(date -Is)"; echo "uptime=$(uptime)";
  echo "kern=$KERN"; echo "ziel_lauf_py_sha=$(sha256sum "$HIER/ziel_lauf.py" | cut -d' ' -f1)"; grep -n "pw-jack" "$HIER/ziel_lauf.py"; } > "$O/meta.txt"
WP=""
aufraeumen() {
  if [ -n "$WP" ]; then
    pkill -TERM -P "$WP" 2>/dev/null   # erst das laufende Kind (python), dann die Unterschale
    kill -TERM "$WP" 2>/dev/null
    wait "$WP" 2>/dev/null
    WP=""
  fi
}
trap aufraeumen EXIT
if [ "$MODUS" = mit ]; then
  # Schleife über das Messfenster (Aufbau der Decks rund 90 s plus Fenster); ein Lauf auf 120 s Quelle dauert bei RTF 0,27 rund 35 s.
  # Sie gibt das Schloss (fd 9) frei, endet, wenn das Skript weg ist (auch bei SIGKILL), und bremst bei Fehlern: 2 s Pause, nach 3 in Folge Schluss
  # (die Fehlerzeile in stems.jsonl macht die Messung ungültig, T9).
  ELTERN=$$
  (
    exec 9>&-
    cd "$DJK/werkstatt" || exit 4
    ENDE=$(( $(date +%s) + MIN * 60 + 150 )); i=0; FEHLER=0
    while [ "$(date +%s)" -lt "$ENDE" ] && kill -0 "$ELTERN" 2>/dev/null; do
      i=$((i + 1))
      # OMP_NUM_THREADS=4 und keine GPU: wie stems_lauf.ts das Kind startet (Nachzug F7)
      if CUDA_VISIBLE_DEVICES= OMP_NUM_THREADS=4 nice -n 19 ionice -c3 "$PY" -m werkstatt.stems --quelle "$QUELLE" --f0 0 \
        --f1 $((120 * 48000)) --aus "$O/s-$i" \
        >> "$O/stems.jsonl" 2>> "$O/stems.stderr"; then FEHLER=0; else
        FEHLER=$((FEHLER + 1))
        if [ "$FEHLER" -ge 3 ]; then
          echo '{"status": "fehler", "grund": "schleife_abbruch_3_fehler_in_folge"}' >> "$O/stems.jsonl"; rm -rf "$O/s-$i"; break
        fi
        sleep 2
      fi
      rm -rf "$O/s-$i"
    done
  ) &
  WP=$!
fi
python3 "$HIER/ziel_lauf_boxen.py" --fall T128 --boxen an --lauf "stemslast-$LAUF" --minuten "$MIN" --kern "$KERN"
RC=$?
aufraeumen
echo "rueckgabe_kern=$RC" >> "$O/meta.txt"
ERG=$(ls -dt "$HIER"/laeufe/stemslast-"$LAUF"-* 2>/dev/null | head -1)   # LAUF ist einmalig (Zeitstempel, PID)
if [ -n "$ERG" ]; then
  cp "$ERG/ergebnis.json" "$O/ergebnis.json"
  cp "$ERG/pwtop.txt" "$O/pwtop.txt"
  echo "kern_lauf=$ERG" >> "$O/meta.txt"
fi
echo "ende=$(date -Is)" >> "$O/meta.txt"
exit $RC
