#!/usr/bin/env bash
# Baukasten S3b Task 4 (Plan D13, D14): Callback-Kosten mit N Baukasten-Strömen bk:juno-pad im echten JACK-Callback.
# Nimmt das Echtzeit-Schloss einmal, startet kosten25.sh (16 Prüfklick-Kanäle wie Scheibe 25) mit graph_faeden F und
# dazu N Erzeuger, je einer pro Strom k = 1..N auf erz/k mit Ziel bk:juno-pad und einem gehaltenen Akkord aus 8 Tönen.
# Der Kern liest Graphen aus ~/.config/cypherdj/baukasten/<name>.json OHNE Instanz (main.cpp): das Skript legt
# juno-pad.json dort nur an, wenn sie fehlt, und entfernt beim Räumen nur, was es selbst angelegt hat (Review M5).
# Aufruf: CYPHERDJ_INSTANZ=d kosten_bk.sh --lauf NAME --stroeme N [--faeden F] [--kern PROGRAMM] [--sekunden 60]
# Ergebnis: eine Zeile je Lauf auf stdout (p50, p99,9, Maximum, gehalten, Zählerzeile Graph-Werk, loadavg vorher);
# Rohdaten in tests/ziel/laeufe/<NAME>-<datum>/. Rückgabe wie kosten25.sh (0 gehalten, 1 gerissen oder Positivprobe gerissen,
# 3 Schloss, 4 Aufbau). Ströme: höchstens 6, auf erz/1, 2, 3, 5, 6, 7 (erz/4 reserviert, erz/8 Vorhöreingang).
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen (S3b: d)}"
I=$CYPHERDJ_INSTANZ
case "$I" in [a-i]) K=$(( $(printf '%d' "'$I") - 96 ));; *) echo "CYPHERDJ_INSTANZ=$I: a bis i" >&2; exit 4;; esac
LAUF="" N=0 F=2 KERN=$DJK/kern/build/cypherdj-kern SEK=60
while [ $# -gt 0 ]; do
  case "$1" in
    --lauf) LAUF=$2; shift 2;; --stroeme) N=$2; shift 2;; --faeden) F=$2; shift 2;;
    --kern) KERN=$2; shift 2;; --sekunden) SEK=$2; shift 2;; *) echo "kosten_bk.sh: unbekannt $1" >&2; exit 4;;
  esac
done
[ -n "$LAUF" ] || { echo "--lauf fehlt" >&2; exit 4; }
# Kanäle der Ströme: erz/4 gehört der Produktion (netz_erz.cpp lehnt ihn als "reserviert" ab), erz/8 ist der Vorhöreingang.
KANAL=(0 1 2 3 5 6 7)   # Strom k (1..6) -> erz/${KANAL[k]}
case "$N" in ''|*[!0-9]*) echo "--stroeme $N: ganze Zahl 0 bis 6" >&2; exit 4;; esac
case "$F" in ''|*[!0-9]*) echo "--faeden $F: ganze Zahl 0 bis 8" >&2; exit 4;; esac
[ "$N" -le 6 ] || { echo "--stroeme $N: höchstens 6 (erz/4 reserviert, erz/8 Vorhöreingang)" >&2; exit 4; }
[ "$F" -le 8 ] || { echo "--faeden $F: höchstens 8" >&2; exit 4; }
BK_ORDNER=$HOME/.config/cypherdj/baukasten
GRAPH=$BK_ORDNER/juno-pad.json
ANGELEGT_ORDNER="" ANGELEGT_GRAPH="" ERZ=() KP=""
mkdir -p "$HIER/laeufe"
MUSTER_ORDNER=$(mktemp -d "$HIER/laeufe/.muster-XXXX")
START_MARKE=$MUSTER_ORDNER/.start
raeumen() {
  for p in "${ERZ[@]}"; do kill -TERM "$p" 2>/dev/null; wait "$p" 2>/dev/null; done
  [ -n "$KP" ] && { kill -TERM "$KP" 2>/dev/null; wait "$KP" 2>/dev/null; }
  [ -n "$ANGELEGT_GRAPH" ] && rm -f "$GRAPH"
  [ -n "$ANGELEGT_ORDNER" ] && rmdir "$BK_ORDNER" 2>/dev/null
  rm -rf "$MUSTER_ORDNER"
}
trap raeumen EXIT
exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
echo "[$LAUF] warte auf das Echtzeit-Schloss ..." >&2
flock -w 10800 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
[ -d "$BK_ORDNER" ] || { mkdir -p "$BK_ORDNER" && ANGELEGT_ORDNER=1; }
[ -f "$GRAPH" ] || { cp "$DJK/instrumente/baukasten_dsp/beispiele/juno-pad.json" "$GRAPH" && ANGELEGT_GRAPH=1; }
# ein Akkord aus 8 Tönen, jede Note länger als der Lauf (64 Zyklen); Format wie erzeuger/tests/erzeuger.test.mjs
cat > "$MUSTER_ORDNER/akkord.js" <<'STRUDEL'
note("[a2,c#3,e3,g#3,b3,d4,f#4,a4]").slow(64)
STRUDEL
VOR=$(cut -d' ' -f1-3 /proc/loadavg)
KPORT=$((47100 + 1000 * K))
CYPHERDJ_SCHLOSS_GEHALTEN=1 "$HIER/kosten25.sh" --lauf "$LAUF" --kern "$KERN" --sekunden "$SEK" \
  --konfig-sed "s/^graph_faeden = [0-9]*/graph_faeden = $F/" > "$MUSTER_ORDNER/kosten25.out" 2>&1 & KP=$!
touch "$START_MARKE"
for _ in $(seq 1 100); do ss -uln | grep -q ":$KPORT " && break; sleep 0.1; done
ss -uln | grep -q ":$KPORT " || { echo "[$LAUF] Kern-Port $KPORT lauscht nicht" >&2; exit 4; }
for k in $(seq 1 "$N"); do
  CYPHERDJ_INSTANZ=$I node "$DJK/erzeuger/erzeuger.mjs" --kern-port "$KPORT" --abo-port $((47160 + 1000 * K + k)) \
    --name "kosten-$k" --strom "$k" --kanal "erz/${KANAL[$k]}" --ziel bk:juno-pad --muster "$MUSTER_ORDNER/akkord.js" \
    2> "$MUSTER_ORDNER/erz$k.log" & ERZ+=($!)
done
wait "$KP"; RC=$?; KP=""
# Ergebnisverzeichnis: nur eines, das nach dem Skriptstart entstand und genau <LAUF>-<datum>-<zeit> heißt (kein Raten über ls)
LAUF_RE=$(printf '%s' "$LAUF" | sed 's/[][\\.*^$+?(){}|\/]/\\&/g')
mapfile -t TREFFER < <(find "$HIER/laeufe" -mindepth 1 -maxdepth 1 -type d -newer "$START_MARKE" -printf '%f\n' 2>/dev/null \
  | grep -E "^${LAUF_RE}-[0-9]{8}-[0-9]{6}$")
[ "${#TREFFER[@]}" -eq 1 ] || { echo "[$LAUF] Ergebnisverzeichnis nicht eindeutig (${#TREFFER[@]} Treffer nach Start, kosten25 rc=$RC)" >&2; exit 4; }
O=$HIER/laeufe/${TREFFER[0]}
for k in $(seq 1 "$N"); do cp "$MUSTER_ORDNER/erz$k.log" "$O/" 2>/dev/null; done
cp "$MUSTER_ORDNER/kosten25.out" "$O/" 2>/dev/null
python3 - "$O" "$LAUF" "$N" "$F" "$VOR" <<'PY'
import json, re, sys
o, lauf, n, f, vor = sys.argv[1:6]
e = json.load(open(f"{o}/ergebnis.json", encoding="utf-8"))
gw = [z.strip() for z in open(f"{o}/kern.err", encoding="utf-8", errors="replace") if z.startswith("Graph-Werk: ") and "Aufträge" in z]
# Positivprobe (D13): jeder Strom hat genau einen Anlauf gehabt, Aufträge liefen, kein Block war verspätet
fehler = []
m = re.search(r"(\d+) Aufträge, \d+ gestohlen, (\d+) Anlauf, (\d+) verspätet", gw[-1]) if gw else None
if not m:
    fehler.append("keine Zählerzeile")
else:
    auftraege, anlauf, spaet = (int(x) for x in m.groups())
    if anlauf != int(n): fehler.append(f"Anlauf {anlauf} statt {n}")
    if int(n) > 0 and auftraege == 0: fehler.append("0 Aufträge")
    if spaet != 0: fehler.append(f"verspätet {spaet}")
probe = f"POSITIVPROBE GERISSEN ({', '.join(fehler)})" if fehler else "Positivprobe ok"
print(f"{lauf} stroeme={n} faeden={f}: p50 {e['cb_p50_us']} p99,9 {e['cb_p999_us']} max {e['cb_max_us']} us, "
      f"luecken {e.get('frame_luecken_gesamt')}, gehalten {e['gehalten']}, load {vor} | {gw[-1] if gw else 'Graph-Werk: KEINE ZÄHLERZEILE'} | "
      f"{probe} | Pegel erz/k: ungeprüft (kosten25 legt keinen Ereignis-Mitschnitt ab)")
sys.exit(1 if fehler else 0)
PY
PRC=$?
[ "$RC" -ne 0 ] && exit "$RC"
exit "$PRC"
