#!/usr/bin/env bash
# Scheibe 25: eine Golden-Folge gegen den echten Kern an einer eigenen Null-Senke mit vier Kanälen (SCHNITTSTELLEN
# §19.5, ROADMAP §8.4; Vorlage djk/kern/tests/neustart/serie.sh aus Scheibe 18): Notbahn (Scheibe 10) an der Senke,
# Kern als transiente Unit mit den Eigenschaften aus djk/units/cypherdj-kern.service (nach kill -9 startet systemd ihn
# neu; verbindet seine Ports selbst mit der Senke, Selbst-Wächter 100 ms wie die Unit), Notbahn daneben (ADR 016
# Nachtrag, Kante am Kern-Port), JACK-Aufnehmer am Monitor der Senke, Läufer lauf25.py. Frischer Kern je Aufruf: Ring und Zustand der Instanz
# vorher weg (nur, wenn kein Prozess sie hält). Kein Ton an echte Ausgänge (Riegel der Notbahn). Hält das
# Echtzeit-Schloss für den ganzen Lauf (ROADMAP §8.5), Fremdlast vorher und nachher in fremdlast.txt.
#
# Aufruf: lauf25.sh --lauf NAME [--kern PROGRAMM] [--klick KANAL] [--sekunden S] FOLGE.jsonl
#   --kern      anderes Kern-Programm (Fehlerfall: build/cypherdj-kern-mutation-hand; Vorher: Kern aus Scheibe 18)
#   --klick     /test/klick an für diesen Kanal vor der Folge (ROADMAP Z1)
#   --sekunden  Länge der Aufnahme am Ziel (Vorgabe 55)
#   --laeufer   anderer Folgen-Läufer mit denselben Aufrufparametern (Scheibe 31: lauf31.py, mit Decks)
# Umgebung: CYPHERDJ_INSTANZ (Strang A: a). Ergebnis: djk/kern/tests/ziel/laeufe/<NAME>-<datum>/ mit laeufer.txt,
# bericht.json, protokoll.jsonl, ziel.f32(.json), kern.txt (Journal der Unit), notbahn.err, fremdlast.txt.
# Rückgabe: die des Läufers (0 grün, 1 rot, 2 keine Verbindung), 3 kein Schloss, 4 Aufruf oder Aufbau.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen (Strang A: export CYPHERDJ_INSTANZ=a)}"
I=$CYPHERDJ_INSTANZ
case "$I" in [a-i]) K=$(( $(printf '%d' "'$I") - 96 ));; *) echo "CYPHERDJ_INSTANZ=$I: a bis i" >&2; exit 4;; esac
LAUF=x KERN=$DJK/kern/build/cypherdj-kern KLICK="" SEK=55 FOLGE="" LAEUFER=$HIER/lauf25.py
while [ $# -gt 0 ]; do
  case "$1" in
    --lauf) LAUF=$2; shift 2;; --kern) KERN=$2; shift 2;; --klick) KLICK=$2; shift 2;;
    --sekunden) SEK=$2; shift 2;; --laeufer) LAEUFER=$2; shift 2;;
    -*) echo "lauf25.sh: unbekannt $1" >&2; exit 4;; *) FOLGE=$1; shift;;
  esac
done
NOTBAHN=$DJK/notbahn/build/cypherdj-notbahn
AUFNEHMER=$DJK/kern/build/cypherdj-aufnehmer4
for p in "$KERN" "$NOTBAHN" "$AUFNEHMER"; do [ -x "$p" ] || { echo "fehlt: $p" >&2; exit 4; }; done
[ -f "$FOLGE" ] || { echo "Folge fehlt: $FOLGE" >&2; exit 4; }
NB_ARGS="--daneben --kante cypherdj-kern-$I:master_L"   # Notbahn daneben (ADR 016 Nachtrag), wie neustart/serie.sh aus 18
UNIT=cypherdj-kern-$I
SENKE=cypherdj-pruef-$I-$LAUF
KERN_PORT=$((47100 + 1000 * K)); ABO_PORT=$((47140 + 1000 * K))
O=$HIER/laeufe/$LAUF-$(date +%Y%m%d-%H%M%S)
mkdir -p "$O"
fremdlast() { echo "$1 $(cat /proc/loadavg)"; nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>&1 | sed "s/^/gpu $1 /"; }

if [ -z "${CYPHERDJ_SCHLOSS_GEHALTEN:-}" ]; then  # eine äußere Reihe hält das Schloss schon
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  echo "[$LAUF] warte auf das Echtzeit-Schloss ..." >&2
  flock -w 10800 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
fi
fremdlast vorher > "$O/fremdlast.txt"
sed -e "s/^pruefmodus = [^#]*/pruefmodus = true /" "$DJK/konfig/kern.toml" > "$O/kern.toml"
for f in "/dev/shm/cypherdj-$I/bus" "/dev/shm/cypherdj-$I/zustand"; do
  if [ -e "$f" ]; then
    if fuser -s "$f" 2>/dev/null; then echo "$f in Benutzung: fremder Kern oder Notbahn der Instanz $I" >&2; exit 4; fi
    rm -f "$f"
  fi
done
NB=""; AP=""; MOD=""
aufraeumen() {
  # Scheibe 25: nach dem Lauf den eigenen Neustart-Zustand wieder weg, sonst setzt der nächste Kern der Instanz (etwa
  # luecken_lauf.sh aus 08) die belegten Kanäle und Prüfklicks dieses Laufs fort (gemessen: luecken_halb −84 Samples)
  [ -n "$AP" ] && kill -TERM "$AP" 2>/dev/null
  systemctl --user stop "$UNIT" 2>/dev/null; systemctl --user reset-failed "$UNIT" 2>/dev/null
  if [ -n "$NB" ]; then kill -TERM "$NB" 2>/dev/null; wait "$NB" 2>/dev/null; fi
  if [ -n "$MOD" ]; then
    pactl unload-module "$MOD"
    pactl list short modules | grep -q "^$MOD[[:space:]]" && echo "senke $MOD noch geladen" >> "$O/fremdlast.txt"
  fi
  fremdlast nachher >> "$O/fremdlast.txt"
  f=/dev/shm/cypherdj-$I/zustand; if [ -e "$f" ] && ! fuser -s "$f" 2>/dev/null; then rm -f "$f"; fi
}
trap aufraeumen EXIT
MOD=$(pactl load-module module-null-sink sink_name="$SENKE" channels=4 \
  channel_map=front-left,front-right,rear-left,rear-right sink_properties=node.description="$SENKE")
for _ in $(seq 1 50); do pw-link -i | grep -qx "$SENKE:playback_RL" && break; sleep 0.1; done
# shellcheck disable=SC2086
pw-jack -p 256 "$NOTBAHN" --master "$SENKE:playback_F" --cue "$SENKE:playback_R" $NB_ARGS 2> "$O/notbahn.err" & NB=$!
systemctl --user reset-failed "$UNIT" 2>/dev/null
# shellcheck disable=SC2046
systemd-run --user --unit="$UNIT" $(python3 "$DJK/kern/tests/neustart/unit_eigenschaften.py" \
  "$DJK/units/cypherdj-kern.service") -p Environment=CYPHERDJ_INSTANZ="$I" -- /usr/bin/pw-jack -p 256 "$KERN" \
  --konfig "$O/kern.toml" --pruefmodus --master "$SENKE:playback_F" --cue "$SENKE:playback_R" --waechter-ms 100 \
  > "$O/systemd-run.txt" 2>&1 || { cat "$O/systemd-run.txt" >&2; exit 4; }
for _ in $(seq 1 50); do [ "$(systemctl --user is-active "$UNIT")" = active ] && break; sleep 0.1; done
[ "$(systemctl --user is-active "$UNIT")" = active ] || { echo "Kern-Unit nicht aktiv" >&2; exit 4; }
pw-jack -p 256 "$AUFNEHMER" --quelle "$SENKE" --datei "$O/ziel.f32" --sekunden "$SEK" --bereit "$O/aufnahme.bereit" \
  2> "$O/aufnehmer.err" & AP=$!
for _ in $(seq 1 100); do [ -s "$O/aufnahme.bereit" ] && break; sleep 0.05; done
[ -s "$O/aufnahme.bereit" ] || { echo "Aufnehmer meldet sich nicht (aufnehmer.err)" >&2; exit 4; }
KLICK_ARG=(); [ -n "$KLICK" ] && KLICK_ARG=(--klick "$KLICK")
timeout 900 python3 "$LAEUFER" --kern-port "$KERN_PORT" --port "$ABO_PORT" --unit "$UNIT" "${KLICK_ARG[@]}" \
  --bericht "$O/bericht.json" --protokoll "$O/protokoll.jsonl" "$FOLGE" > "$O/laeufer.txt" 2>&1
RC=$?
wait "$AP" 2>/dev/null; AP=""
systemctl --user show -p NRestarts -p ActiveState -p MainPID "$UNIT" > "$O/unit.txt"
journalctl --user -u "$UNIT" -o short-monotonic --no-pager --since "@$(( $(date +%s) - SEK - 120 ))" > "$O/kern.txt" 2>&1
cat "$O/laeufer.txt"
echo "ordner $O"
exit $RC
