#!/usr/bin/env bash
# Scheibe 25: Callback-Kosten im echten JACK-Callback (ARCHITECTURE §7: p99,9 unter 20 % der Periode, 1,07 ms bei 256;
# Maximum unter 50 %, 2,67 ms). Eigene Null-Senke, Notbahn, Kern mit Prüfmodus bei Quantum 256; cost25_sender.py belegt
# 16 Kanäle (oder keinen: --leer) und hält den Kern --sekunden lang; dann SIGTERM, und die Schlusszeile des Kerns nennt
# cb_p50_us, cb_p99_us, cb_p999_us, cb_max_us über alle Zyklen (Verteilung im Netz-Faden, telemetry.h) sowie die
# selbst gezählten Frame-Lücken. Hält das Echtzeit-Schloss, Fremdlast vorher und nachher (ROADMAP §8.5).
# Aufruf: cost25.sh --lauf NAME [--kern PROGRAMM] [--leer] [--rampen] [--last] [--sekunden 60] [--konfig-sed AUSDRUCK]
#                     [--graph NAME [--send-graph NAME]] [--regler] [--decks-offen] [--werkzeuge LAYOUT [--layouts-datei PFAD]]
#   --graph    Baukasten S3c (D13): der Sender setzt NAME als Effekt-Graph auf deck/1..4 (/k/kanal/graph); legt
#              ~/.config/cypherdj/baukasten/NAME.json aus modular_dsp/demos/ nur an, wenn sie fehlt, und räumt nur
#              das Eigene. ergebnis.json trägt graph_angenommen (Zeilen "graph .. angenommen" im Sender); ungleich 4:
#              POSITIVPROBE GERISSEN und Rückgabe 1
#   --send-graph  Baukasten S6 (R6, only with --graph): additionally NAME as effect graph on fx/3 and fx/4, send/3 and send/4
#              of deck/1..4 at -6 dB (the buses carry signal); six graphs, graph_angenommen must be 6 (else 4)
#   --decks-offen  open the deck faders as the hand (from "leitstand" they are rejected kein_hoerschein and stay closed); implied by
#              --send-graph, give it to the reference run (--graph only) as well so both runs carry the same load
#   --konfig-sed  sed-Ausdruck auf die kern.toml des Laufs, neben pruefmodus (Baukasten S3b: graph_faeden je Lauf)
#   --werkzeuge LAYOUT  Plan A (A10): sets the rows of LAYOUT from werkzeug_layouts.txt with the OSC message of the hand's server path
#              (/k/teil, quelle andreas), implies --decks-offen, and writes the layout's kern.toml lines (kanal_limiter_vorhalt_ms, kanal_limiter_echtspitze) into the run's kern.toml.
#              Layouts: aus (tools off, limiters not built) · limiter-gebaut (limiters built, all lim/an 0) · typisch (2 gates hard,
#              4 utilities, 1 multiband, 1 limiter without true peak, spectrum on master) · voll (13 gates ratio, 17 utilities with bass
#              mono, 4 multibands, 4 limiters with true peak, spectrum). ergebnis.json carries werkzeug_angenommen, werkzeug_soll, decks_offen and
#              konfig_effektiv; a row counts only when the kern started it (see the sender); unequal, a missing konfig line or a failed sender:
#              POSITIVPROBE GERISSEN and return 1 (a broken layout file or sender: return 4). --layouts-datei PFAD uses another layout file (probe tests with a broken layout).
#   --last     Fehlerfall für das Instrument: jeder 100. Zyklus verbrennt eine halbe Periode (Kern --test-last-*)
# Ergebnis: djk/core/tests/target/laeufe/<NAME>-<datum>/ergebnis.json (Schlusszeile des Kerns plus Lauf-Angaben).
# Rückgabe: 0 Zusage gehalten, 1 gerissen, 3 kein Schloss, 4 Aufruf oder Aufbau.
. "$(dirname "$0")/../../../config/realtime_lock.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen (Strang A: export CYPHERDJ_INSTANZ=a)}"
I=$CYPHERDJ_INSTANZ
case "$I" in [a-i]) K=$(( $(printf '%d' "'$I") - 96 ));; *) echo "CYPHERDJ_INSTANZ=$I: a bis i" >&2; exit 4;; esac
LAUF=kosten KERN=$DJK/core/build/cypherdj-kern SENDER_ARG=() LAST=() SEK=60 KSED=() GRAPH_NAME="" SEND_GRAPH_NAME="" WERKZEUGE="" LEER=0 LAYOUTS=$HIER/werkzeug_layouts.txt
while [ $# -gt 0 ]; do
  case "$1" in
    --lauf) LAUF=$2; shift 2;; --kern) KERN=$2; shift 2;; --leer) SENDER_ARG+=(--leer); LEER=1; shift;;
    --rampen) SENDER_ARG+=(--rampen); shift;; --last) LAST=(--test-last-alle 100 --test-last-perioden 0.5); shift;;
    --graph) GRAPH_NAME=$2; SENDER_ARG+=(--graph "$2"); shift 2;; --regler) SENDER_ARG+=(--regler); shift;;
    --decks-offen) SENDER_ARG+=(--decks-offen); shift;;
    --werkzeuge) WERKZEUGE=$2; SENDER_ARG+=(--werkzeuge "$2" --decks-offen); shift 2;;
    --layouts-datei) LAYOUTS=$2; shift 2;;
    --send-graph) SEND_GRAPH_NAME=$2; SENDER_ARG+=(--send-graph "$2"); shift 2;;
    --sekunden) SEK=$2; shift 2;; --konfig-sed) KSED+=(-e "$2"); shift 2;; *) echo "cost25.sh: unbekannt $1" >&2; exit 4;;
  esac
done
NOTBAHN=$DJK/fallback/build/cypherdj-notbahn
case "$GRAPH_NAME" in *[!A-Za-z0-9_-]*) echo "--graph $GRAPH_NAME: nur Buchstaben, Ziffern, - und _" >&2; exit 4;; esac
case "$SEND_GRAPH_NAME" in *[!A-Za-z0-9_-]*) echo "--send-graph $SEND_GRAPH_NAME: nur Buchstaben, Ziffern, - und _" >&2; exit 4;; esac
case "$WERKZEUGE" in *[!A-Za-z0-9_-]*) echo "--werkzeuge $WERKZEUGE: only letters, digits, - and _" >&2; exit 4;; esac
# One strict grammar for werkzeug_layouts.txt, the same in cost25_sender.py and cost25.cpp: '#' comment, blank lines; 'layout NAME',
# 'konfig KEY VALUE', 'zeile PATH NUMBER'; unknown keyword, wrong token count, malformed or non-numeric value, a line before the first layout,
# duplicate layout/key/path, or a shipped layout with the wrong row count: message on stderr, exit 4. Prints "KONFIG k v" lines of layout $1,
# then "ZEILEN n"; layout missing: "FEHLT".
layout_lesen() {
  awk -v l="$1" 'function f(m) { printf("werkzeug_layouts: %s:%d: %s: %s\n", FILENAME, NR, m, $0) > "/dev/stderr"; bad = 1; exit 4 }
    BEGIN { soll["aus"] = 0; soll["limiter-gebaut"] = 4; soll["typisch"] = 19; soll["voll"] = 76 }
    { raw = $0; sub(/#.*/, ""); gsub(/^[ \t]+|[ \t]+$/, ""); if ($0 == "") next; n = split($0, t, /[ \t]+/)
      if (t[1] == "layout") {
        if (n != 2 || t[2] !~ /^[A-Za-z0-9_-]+$/) { $0 = raw; f("layout needs exactly one name") }
        if (t[2] in zahl) { $0 = raw; f("duplicate layout") }
        cur = t[2]; zahl[cur] = 0
      } else if (t[1] == "konfig" || t[1] == "zeile") {
        $0 = raw
        if (cur == "") f(t[1] " before the first layout")
        if (n != 3) f(t[1] " needs exactly two values")
        if (t[1] == "konfig") {
          if (t[2] !~ /^[a-z][a-z0-9_]*$/ || t[3] !~ /^[A-Za-z0-9._+-]+$/) f("malformed konfig key or value")
          if ((cur SUBSEP t[2]) in seen) f("duplicate konfig key")
          seen[cur SUBSEP t[2]] = 1; if (cur == l) kz = kz "KONFIG " t[2] " " t[3] "\n"
        } else {
          if (t[2] !~ /^[a-z0-9_]+(\/[a-z0-9_]+)*$/ || t[3] !~ /^-?[0-9]+(\.[0-9]+)?$/) f("malformed path or non-numeric value")
          if ((cur SUBSEP t[2]) in seen) f("duplicate path")
          seen[cur SUBSEP t[2]] = 1; zahl[cur]++
        }
      } else { $0 = raw; f("unknown keyword") } }
    END { if (bad) exit 4
      for (k in soll) if ((k in zahl) && zahl[k] != soll[k]) { printf("werkzeug_layouts: layout %s has %d rows, expected %d\n", k, zahl[k], soll[k]) > "/dev/stderr"; exit 4 }
      if (!(l in zahl)) print "FEHLT"; else { printf("%sZEILEN %d\n", kz, zahl[l]) } }' "$LAYOUTS"
}
WZ_SOLL=0 WZ_KONFIG=""
if [ -n "$WERKZEUGE" ]; then
  [ -r "$LAYOUTS" ] || { echo "--werkzeuge: cannot read $LAYOUTS" >&2; exit 4; }
  WZ_AUS=$(layout_lesen "$WERKZEUGE") || exit 4
  [ "$WZ_AUS" != FEHLT ] || { echo "--werkzeuge $WERKZEUGE: layout not in $LAYOUTS" >&2; exit 4; }
  WZ_SOLL=$(printf '%s\n' "$WZ_AUS" | awk '$1=="ZEILEN"{print $2}')
  WZ_KONFIG=$(printf '%s\n' "$WZ_AUS" | awk '$1=="KONFIG"{print $2 "=" $3}' | paste -sd, -)
  SENDER_ARG+=(--layouts-datei "$LAYOUTS")
fi
[ -z "$SEND_GRAPH_NAME" ] || [ -n "$GRAPH_NAME" ] || { echo "--send-graph braucht --graph" >&2; exit 4; }
BK_ORDNER=$HOME/.config/cypherdj/baukasten BK_DATEI="" BK_ANGELEGT="" BK_ORDNER_ANGELEGT=""
BK_DATEI2="" BK_ANGELEGT2="" QUELLE2=""
if [ -n "$GRAPH_NAME" ]; then
  QUELLE=$DJK/instruments/modular_dsp/demos/$GRAPH_NAME.json
  [ -f "$QUELLE" ] || { echo "fehlt: $QUELLE" >&2; exit 4; }
  BK_DATEI=$BK_ORDNER/$GRAPH_NAME.json
fi
if [ -n "$SEND_GRAPH_NAME" ]; then
  QUELLE2=$DJK/instruments/modular_dsp/demos/$SEND_GRAPH_NAME.json
  [ -f "$QUELLE2" ] || { echo "fehlt: $QUELLE2" >&2; exit 4; }
  BK_DATEI2=$BK_ORDNER/$SEND_GRAPH_NAME.json
fi
for p in "$KERN" "$NOTBAHN"; do [ -x "$p" ] || { echo "fehlt: $p" >&2; exit 4; }; done
NB_ARGS="--daneben --vor cypherdj-kern-$I:notbahn_vor"   # Notbahn daneben (ADR 016 Nachtrag), wie restart/series.sh aus 18
SENKE=cypherdj-pruef-$I-$LAUF
O=$HIER/laeufe/$LAUF-$(date +%Y%m%d-%H%M%S)
mkdir -p "$O"
if [ -z "${CYPHERDJ_SCHLOSS_GEHALTEN:-}" ]; then
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  echo "[$LAUF] warte auf das Echtzeit-Schloss ..." >&2
  flock -w 10800 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
fi
VOR=$(cut -d' ' -f1-3 /proc/loadavg)
sed -e "s/^pruefmodus = [^#]*/pruefmodus = true /" "${KSED[@]}" "$DJK/config/kern.toml" > "$O/kern.toml"
if [ -n "$WERKZEUGE" ]; then   # the layout's kern.toml lines (values are plain tokens by the grammar): replace a present key, else append
  [ -z "$(tail -c1 "$O/kern.toml")" ] || echo >> "$O/kern.toml"   # the copied file may lack a trailing newline
  while read -r _ KEY VAL; do
    if grep -q "^$KEY *=" "$O/kern.toml"; then sed -i -e "s|^$KEY *=[^#]*|$KEY = $VAL |" "$O/kern.toml"; else echo "$KEY = $VAL" >> "$O/kern.toml"; fi
  done < <(printf '%s\n' "$WZ_AUS" | awk '$1=="KONFIG"{print}')
fi
for f in "/dev/shm/cypherdj-$I/bus" "/dev/shm/cypherdj-$I/zustand"; do
  if [ -e "$f" ]; then
    if fuser -s "$f" 2>/dev/null; then echo "$f in Benutzung" >&2; exit 4; fi
    rm -f "$f"
  fi
done
NB=""; KP=""; MOD=""
aufraeumen() {
  # Scheibe 25: nach dem Lauf den eigenen Neustart-Zustand wieder weg, sonst setzt der nächste Kern der Instanz (etwa
  # gaps_run.sh aus 08) die belegten Kanäle und Prüfklicks dieses Laufs fort (gemessen: luecken_halb −84 Samples)
  [ -n "$KP" ] && kill -TERM "$KP" 2>/dev/null && wait "$KP" 2>/dev/null
  [ -n "$NB" ] && kill -TERM "$NB" 2>/dev/null && wait "$NB" 2>/dev/null
  [ -n "$MOD" ] && pactl unload-module "$MOD"
  [ -n "$BK_ANGELEGT" ] && rm -f "$BK_DATEI"
  [ -n "$BK_ANGELEGT2" ] && rm -f "$BK_DATEI2"
  [ -n "$BK_ORDNER_ANGELEGT" ] && rmdir "$BK_ORDNER" 2>/dev/null
  f=/dev/shm/cypherdj-$I/zustand; if [ -e "$f" ] && ! fuser -s "$f" 2>/dev/null; then rm -f "$f"; fi
}
trap aufraeumen EXIT
if [ -n "$GRAPH_NAME" ]; then   # erst nach dem Schloss und der Falle: was wir anlegen, räumen wir
  [ -d "$BK_ORDNER" ] || { mkdir -p "$BK_ORDNER" && BK_ORDNER_ANGELEGT=1; }
  [ -f "$BK_DATEI" ] || { cp "$QUELLE" "$BK_DATEI" && BK_ANGELEGT=1; }
  if [ -n "$SEND_GRAPH_NAME" ]; then
    [ -f "$BK_DATEI2" ] || { cp "$QUELLE2" "$BK_DATEI2" && BK_ANGELEGT2=1; }
  fi
fi
MOD=$(pactl load-module module-null-sink sink_name="$SENKE" channels=4 \
  channel_map=front-left,front-right,rear-left,rear-right sink_properties=node.description="$SENKE")
for _ in $(seq 1 50); do pw-link -i | grep -qx "$SENKE:playback_RL" && break; sleep 0.1; done
# shellcheck disable=SC2086
pw-jack -p 256 "$NOTBAHN" --master "$SENKE:playback_F" --cue "$SENKE:playback_R" $NB_ARGS 2> "$O/notbahn.err" & NB=$!
CYPHERDJ_INSTANZ=$I pw-jack -p 256 "$KERN" --konfig "$O/kern.toml" --pruefmodus --master "$SENKE:playback_F" \
  --cue "$SENKE:playback_R" --waechter-ms 100 "${LAST[@]}" 2> "$O/kern.err" & KP=$!
sleep 1
if [ -n "$WERKZEUGE" ] && ! kill -0 "$KP" 2>/dev/null; then echo "kern exited at start (see $O/kern.err)" >&2; exit 4; fi
python3 "$HIER/cost25_sender.py" --kern-port $((47100 + 1000 * K)) --port $((47140 + 1000 * K)) \
  "${SENDER_ARG[@]}" --sekunden "$SEK" > "$O/sender.txt" 2>&1
SENDER_RC=$?
kill -TERM "$KP"; wait "$KP" 2>/dev/null; KP=""
NACH=$(cut -d' ' -f1-3 /proc/loadavg)
python3 - "$O" "$LAUF" "$VOR" "$NACH" "$SEK" "$GRAPH_NAME" "$SEND_GRAPH_NAME" "$WERKZEUGE" "$WZ_SOLL" "$WZ_KONFIG" "$SENDER_RC" "$LEER" <<'PY'
import json, sys
o, lauf, vor, nach, sek, graph, send_graph, werkzeuge, wz_soll, wz_konfig, sender_rc, leer = sys.argv[1:13]
leer = leer == "1"
zeile = [z for z in open(f"{o}/kern.err", encoding="utf-8") if z.startswith('{"zyklen"')][-1]
e = json.loads(zeile)
e.update({"lauf": lauf, "last_vorher": vor, "last_nachher": nach, "sekunden": float(sek),
          "sender": open(f"{o}/sender.txt", encoding="utf-8").read().strip(),
          "zusage_p999_us": 1067, "zusage_max_us": 2667})
e["gehalten"] = e["cb_p999_us"] < 1067 and e["cb_max_us"] < 2667
probe_gerissen = False
if graph:   # Positivprobe (D13): alle vier Decks haben den Graphen angenommen, sonst ist die Messung wertlos
    e["graph"] = graph
    e["graph_angenommen"] = sum(1 for z in e["sender"].splitlines() if z.startswith("graph ") and z.endswith(" angenommen"))
    soll = 6 if send_graph else 4   # S6: four decks, plus fx/3 and fx/4 with --send-graph
    e["graph_soll"] = soll
    if send_graph: e["send_graph"] = send_graph
    probe_gerissen = e["graph_angenommen"] != soll
wz_gerissen = False
wz_text = ""
if werkzeuge:   # Positivprobe (A10): the kern started every row of the layout and got the konfig lines; else the layout result is worthless
    e["werkzeuge"] = werkzeuge
    e["sender_rc"] = int(sender_rc)
    e["decks_offen"] = sum(1 for z in e["sender"].splitlines() if z.startswith("deckfader deck/") and z.endswith(" angenommen")) == 4   # the sender's evidence: four deck faders started
    e["werkzeug_angenommen"] = sum(1 for z in e["sender"].splitlines() if z.startswith("werkzeug ") and z.endswith(" angenommen"))
    e["werkzeug_soll"] = int(wz_soll)
    soll_konfig = dict(p.split("=", 1) for p in wz_konfig.split(",") if p)
    toml = [z.split("#", 1)[0].strip() for z in open(f"{o}/kern.toml", encoding="utf-8")]
    e["konfig_effektiv"] = {k: [z.split("=", 1)[1].strip() for z in toml if z.split("=", 1)[0].strip() == k and "=" in z] for k in soll_konfig}
    kern_log = open(f"{o}/kern.err", encoding="utf-8").read()
    kern_las = f"Konfiguration {o}/kern.toml" in kern_log   # the kern's start line names the file it read (the kern does not echo the values)
    verbunden = f"werkzeug-layout {werkzeuge} {wz_soll} rows, kern connected" in e["sender"].splitlines()
    gruende = []
    if int(sender_rc) >= 2: gruende.append(f"sender rc {sender_rc}")
    if not verbunden: gruende.append("no 'kern connected' line of the sender")
    if not leer and not e["decks_offen"]: gruende.append("deck faders not all started (decks_offen false)")
    if e["werkzeug_angenommen"] != e["werkzeug_soll"]: gruende.append(f"werkzeug_angenommen {e['werkzeug_angenommen']} statt {e['werkzeug_soll']}")
    for k, v in soll_konfig.items():
        if e["konfig_effektiv"][k] != [v]: gruende.append(f"konfig {k} {e['konfig_effektiv'][k]} statt [{v!r}]")
    if not kern_las: gruende.append("kern.err does not name the run's kern.toml")
    wz_gerissen = bool(gruende)
    wz_text = "; ".join(gruende)
json.dump(e, open(f"{o}/ergebnis.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(e, ensure_ascii=False))
if probe_gerissen:
    print(f"POSITIVPROBE GERISSEN: graph_angenommen {e['graph_angenommen']} statt {soll} ({graph})")
    sys.exit(1)
if wz_gerissen:
    print(f"POSITIVPROBE GERISSEN: werkzeug_angenommen {e['werkzeug_angenommen']} statt {e['werkzeug_soll']} ({werkzeuge}) [{wz_text}]")
    sys.exit(1)
sys.exit(0 if e["gehalten"] else 1)
PY
