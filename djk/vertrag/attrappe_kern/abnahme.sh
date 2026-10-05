#!/usr/bin/env bash
# Abnahme der Scheibe 13 (Kern-Attrappe), ROADMAP Steckbrief 13. Aufruf aus beliebigem Ordner:
#   CYPHERDJ_INSTANZ=c djk/vertrag/attrappe_kern/abnahme.sh <teil>
# Teile: last | einheit | uhr | golden | matrix | ton | ports | echtzeit | leitstand | alles
# Berichte unter djk/vertrag/attrappe_kern/berichte/ (klein, werden committet). WURZEL überschreibt ~/cypher-dj.
# Rückgabe je Teil: 0 bestanden, 1 nicht bestanden, 2 Aufruffehler.
set -u
WURZEL="${WURZEL:-$HOME/cypher-dj}"
V="$WURZEL/djk/vertrag"
A="$V/attrappe_kern"
B="$A/berichte"
mkdir -p "$B"
INSTANZ="${CYPHERDJ_INSTANZ:-}"
if ! [[ "$INSTANZ" =~ ^[a-i]$ ]]; then echo "abnahme.sh: CYPHERDJ_INSTANZ auf a bis i setzen (Strang C: c), ROADMAP Z2" >&2; exit 2; fi
K=$(( $(printf '%d' "'$INSTANZ") - 96 ))
PORT=$((47100 + 1000 * K))
MATERIAL="${MATERIAL:-${TMPDIR:-/tmp}/attrappe-abnahme-$INSTANZ/material}"
FOLGEN=$(ls "$V"/folgen/*.jsonl | grep -v '/notbahn_' | sort)
N_FOLGEN=$(echo "$FOLGEN" | wc -l)

material() {
  if [ ! -f "$MATERIAL/.fertig" ]; then
    mkdir -p "$MATERIAL" && python3 "$V/erzeuge_material.py" --ziel "$MATERIAL" > /dev/null && touch "$MATERIAL/.fertig"
  fi
}

last() {
  { date -Iseconds; uptime; nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null || echo "keine GPU-Abfrage"; } >> "$B/last.txt"
  tail -3 "$B/last.txt"
}

einheit() {
  (cd "$A" && node --test tests/*.test.mjs > "$B/einheit.txt" 2>&1)
  grep -E '^# (tests|pass|fail)' "$B/einheit.txt"
  grep -q '^# fail 0$' "$B/einheit.txt"
}

# Die Uhr trifft die Golden-Werte aus §1.3 auf 1e-6 Samples vor dem Runden, und die Folge uhr_golden ist grün
uhr() {
  (cd "$A" && node --input-type=module -e "
    import { Karte } from './uhr.mjs';
    const k = new Karte(128); k.rampe(128, 132, 32);
    // Referenz: Formeln §1.3 mit 50 Stellen (Python decimal), Plan 13 Task 1
    const soll = [[64, 1440000], [144, 3237188.0043606752], [160, 3588923.0769230769], [192, 4287104.8951048951]];
    let ok = true;
    for (const [b, s] of soll) { const d = Math.abs(k.sample(b) - s); ok = ok && d <= 1e-6;
      console.log('sample(' + b + ') = ' + k.sample(b).toFixed(9) + '  Soll ' + s.toFixed(9) + '  |Abweichung| ' + d.toExponential(2) + ' (Grenze 1e-6)'); }
    process.exit(ok ? 0 : 1);" > "$B/uhr.txt" 2>&1)
  local rc=$?
  cat "$B/uhr.txt"
  material
  node "$A/golden.mjs" --vertrag "$V" --material "$MATERIAL" "$V/folgen/uhr_golden.jsonl" | tee -a "$B/uhr.txt" | tail -1
  grep -q '^GRÜN uhr_golden' "$B/uhr.txt" && [ $rc -eq 0 ]
}

golden() {
  material
  node "$A/golden.mjs" --vertrag "$V" --material "$MATERIAL" --bericht "$B/golden.json" $FOLGEN > "$B/golden.txt" 2>&1
  local rc=$?
  echo "Dateien ohne notbahn_: $N_FOLGEN"
  tail -1 "$B/golden.txt"
  grep '^ROT' "$B/golden.txt"
  grep 'ausgelassen' "$B/golden.txt"
  # am Ziel gezählt: der Läufer muss genau so viele Folgen gefahren haben, wie Dateien da sind
  grep -q "^gefahren $N_FOLGEN, grün $N_FOLGEN, rot 0" "$B/golden.txt" || { echo "golden: nicht alle $N_FOLGEN Folgen grün gefahren" >&2; return 1; }
  return $rc
}

# Mutationsmatrix: je Mutation die rot gefärbten Folgen; Soll: die zugehörige Folge ist rot, ohne Mutation keine
matrix() {
  material
  : > "$B/matrix.txt"
  for m in keine i1_aus i2_aus i3a_aus i3b_aus i3c_aus i3d_aus i4_aus frist_aus; do
    local arg=(); [ "$m" != keine ] && arg=(--mutation "$m")
    local aus; aus=$(node "$A/golden.mjs" --vertrag "$V" --material "$MATERIAL" "${arg[@]}" $FOLGEN 2>&1)
    echo "$aus" | grep -q "^gefahren $N_FOLGEN," || { echo "matrix $m: nicht $N_FOLGEN Folgen gefahren" >&2; return 1; }
    local rot; rot=$(echo "$aus" | grep '^ROT' | sed 's/^ROT  \([^:]*\):.*/\1/' | tr '\n' ' ')
    echo "$m: ${rot:-keine}" | tee -a "$B/matrix.txt"
  done
  python3 - "$B/matrix.txt" <<'PY' | tee "$B/matrix.md"
import sys
zeilen = dict(l.split(': ', 1) for l in open(sys.argv[1]).read().splitlines())
pflicht = {'i1_aus': 'sub_doppelt', 'i2_aus': 'master_leer', 'i3a_aus': 'i3_kein_hoerschein', 'i3d_aus': 'i3_ziel_ungehoert',
           'i4_aus': 'i4_ueberlappung', 'frist_aus': 'rueckfall'}
zusatz = {'i3b_aus': 'pad_ungehoert', 'i3c_aus': 'muster_ungehoert'}
ohne = set(zeilen['keine'].split()) - {'keine'}
fehler = 0
print('| Mutation | zugehörige Folge | ohne Mutation | mit Mutation | alle roten Folgen mit Mutation |')
print('|---|---|---|---|---|')
for m, f in {**pflicht, **zusatz}.items():
    rot = zeilen[m].split()
    mit, vorher = f in rot, f in ohne
    print(f"| {m}{'' if m in pflicht else ' (Zusatz)'} | {f} | {'rot' if vorher else 'grün'} | {'rot' if mit else 'grün'} | {' '.join(rot)} |")
    if m in pflicht:
        fehler += (not mit) or vorher
print(f'Matrix: {6 - fehler} von 6 Pflicht-Mutationen färben ihre Folge rot, die ohne Mutation grün ist')
sys.exit(1 if fehler else 0)
PY
  return "${PIPESTATUS[0]}"
}

# Negativ-Kontrolle: keine JACK- oder PipeWire-Bibliothek im Prozess, kein Unix-Socket, kein neuer Port.
# Positiv-Kontrolle des Instruments: eine eigene Null-Senke (ROADMAP §8.4) erscheint in pw-link -o und verschwindet wieder.
ton() {
  material
  local z; z=$(mktemp -d)
  pw-link -o | sort > "$B/pwlink_vorher.txt"
  node "$WURZEL/djk/vertrag/attrappe_kern.mjs" --frisch --zustand "$z/zustand.json" --arbeitsbestand "$MATERIAL" > "$z/log" 2>&1 &
  local pid=$!
  sleep 2
  local libs; libs=$(grep -c -E 'libjack|libpipewire|libasound|libpulse' "/proc/$pid/maps")
  local sockets; sockets=$(ss -xap 2>/dev/null | grep -c "pid=$pid,")
  local lebt=0; kill -0 "$pid" 2>/dev/null && lebt=1
  kill "$pid"; wait "$pid" 2>/dev/null
  pw-link -o | sort > "$B/pwlink_nachher.txt"
  local roh; roh=$(diff "$B/pwlink_vorher.txt" "$B/pwlink_nachher.txt" | grep -c '^[<>]')
  local eigen; eigen=$(diff "$B/pwlink_vorher.txt" "$B/pwlink_nachher.txt" | grep '^[<>]' | grep -c -i -E 'node|attrappe|cypherdj-kern')
  local pw; pw=$(pgrep -x pipewire | head -1)
  local positiv_lib; positiv_lib=$(grep -c 'libpipewire' "/proc/$pw/maps")
  local senke="cypherdj-pruef-$INSTANZ-ton"
  local modid; modid=$(pactl load-module module-null-sink "sink_name=$senke" "sink_properties=node.description=$senke")
  sleep 1
  local positiv_port; positiv_port=$(pw-link -o | grep -c "$senke")
  pactl unload-module "$modid"
  sleep 1
  local weg; weg=$(pw-link -o | grep -c "$senke")
  {
    echo "Attrappe lief während der Prüfung: $lebt (Soll 1)"
    echo "Audio-Bibliotheken im Attrappen-Prozess: $libs (Soll 0)"
    echo "Positiv-Kontrolle libpipewire im pipewire-Prozess $pw: $positiv_lib (Soll > 0)"
    echo "Unix-Sockets des Attrappen-Prozesses: $sockets (Soll 0, kein PipeWire-Anschluss)"
    echo "pw-link -o vorher $(wc -l < "$B/pwlink_vorher.txt") Zeilen, nachher $(wc -l < "$B/pwlink_nachher.txt"), Unterschiede $roh, davon mit node/attrappe/cypherdj-kern im Namen $eigen (Soll 0)"
    echo "Positiv-Kontrolle Null-Senke $senke: $positiv_port Ports sichtbar (Soll > 0), nach dem Entladen $weg (Soll 0)"
  } | tee "$B/ton.txt"
  diff "$B/pwlink_vorher.txt" "$B/pwlink_nachher.txt" | grep '^[<>]' >> "$B/ton.txt"
  rm -rf "$z"
  [ "$lebt" -eq 1 ] && [ "$libs" -eq 0 ] && [ "$positiv_lib" -gt 0 ] && [ "$sockets" -eq 0 ] && [ "$eigen" -eq 0 ] && [ "$positiv_port" -gt 0 ] && [ "$weg" -eq 0 ]
}

# Z2: die Attrappe nimmt den Port ihrer Prüfinstanz und teilt ihn nie (belegt: Rückgabewert 3)
ports() {
  local z; z=$(mktemp -d)
  node "$WURZEL/djk/vertrag/attrappe_kern.mjs" --frisch --zustand "$z/a.json" --arbeitsbestand "$z" > "$z/log" 2>&1 &
  local pid=$!
  sleep 1.5
  local gebunden; gebunden=$(ss -uapn | grep -c "127.0.0.1:$PORT .*pid=$pid,")
  node "$WURZEL/djk/vertrag/attrappe_kern.mjs" --frisch --zustand "$z/b.json" --arbeitsbestand "$z" > "$z/log2" 2>&1
  local rc=$?
  kill "$pid"; wait "$pid" 2>/dev/null
  local tests_port0; tests_port0=$(grep -c "'--udp-port', '0'" "$A/tests/server.test.mjs")
  local tests_fest; tests_fest=$(grep -E -c "'--udp-port', '[1-9]" "$A/tests/server.test.mjs")
  {
    echo "Instanz $INSTANZ: Attrappe auf 127.0.0.1:$PORT gebunden: $gebunden (Soll 1); Kern der Vorgabe-Instanz 47100, Kern Strang A 48100"
    echo "Zweite Attrappe derselben Instanz auf belegtem Port: Rückgabewert $rc (Soll 3): $(cat "$z/log2")"
    echo "server.test.mjs bindet Port 0 (vom System vergeben): $tests_port0 Stelle(n) (Soll ≥ 1); feste Portnummer hinter --udp-port: $tests_fest (Soll 0)"
    echo "golden.mjs öffnet keinen Socket: $(grep -c "dgram" "$A/golden.mjs") dgram-Importe (Soll 0)"
  } | tee "$B/ports.txt"
  rm -rf "$z"
  [ "$gebunden" -eq 1 ] && [ "$rc" -eq 3 ] && [ "$tests_port0" -ge 1 ] && [ "$tests_fest" -eq 0 ] && [ "$(grep -c dgram "$A/golden.mjs")" -eq 0 ]
}

echtzeit() {
  material
  node "$A/echtzeit.mjs" --vertrag "$V" --material "$MATERIAL" --bericht "$B/echtzeit.json" $FOLGEN > "$B/echtzeit.txt" 2>&1
  local rc=$?
  echo "Dateien ohne notbahn_: $N_FOLGEN"
  tail -1 "$B/echtzeit.txt"
  grep -E '^ROT|UNTER LAST' "$B/echtzeit.txt"
  grep -q "^gefahren $N_FOLGEN, grün $N_FOLGEN, rot 0" "$B/echtzeit.txt" || { echo "echtzeit: nicht alle $N_FOLGEN Folgen grün gefahren" >&2; return 1; }
  return $rc
}

# Offizieller Läufer aus Scheibe 08, je Folge gegen eine frische Attrappe (FORMAT.md Punkt 2: /k/set/neu wird
# abgelehnt, solange ein Deck läuft). Ein ROT, dessen Grund eine unbekannte Schritt-Art ist, gehört dem Läufer (08), nicht
# der Attrappe: es wird getrennt gezählt und als Befund gemeldet (Plan 13, Task 19), die Abnahme bleibt dann offen.
leitstand() {
  material
  : > "$B/leitstand.txt"
  local gruen=0 rot=0 art=0 fehler=0
  local konf; konf=$(mktemp -d)
  printf 'version = 1\npruefmodus = true\n' > "$konf/kern.toml"
  for f in $FOLGEN; do
    local z; z=$(mktemp -d)
    node "$WURZEL/djk/vertrag/attrappe_kern.mjs" --frisch --konfig "$konf/kern.toml" --zustand "$z/zustand.json" --arbeitsbestand "$MATERIAL" > "$z/log" 2>&1 &
    local pid=$!
    sleep 1
    timeout 900 python3 "$V/attrappe_leitstand.py" --bericht "$z/bericht.json" "$f" > "$z/aus" 2>&1
    local rc=$?
    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    local zeile; zeile=$(grep -E '^(GRÜN|ROT)' "$z/aus" | head -1 | cut -c1-240)
    if [ $rc -eq 0 ]; then gruen=$((gruen + 1))
    elif [ $rc -eq 1 ] && echo "$zeile" | grep -q -i 'schritt-art'; then art=$((art + 1))
    elif [ $rc -eq 1 ]; then rot=$((rot + 1))
    else fehler=$((fehler + 1)); zeile="$zeile $(tail -2 "$z/aus" | tr '\n' ' ' | cut -c1-200)"; fi
    echo "rc=$rc $(basename "$f" .jsonl): $zeile" | tee -a "$B/leitstand.txt"
    rm -rf "$z"
  done
  rm -rf "$konf"
  echo "attrappe_leitstand.py: gefahren $((gruen + rot + art + fehler)) von $N_FOLGEN, grün $gruen, rot $rot, rot wegen unbekannter Schritt-Art $art, Aufruffehler $fehler" | tee -a "$B/leitstand.txt"
  [ "$rot" -eq 0 ] && [ "$art" -eq 0 ] && [ "$fehler" -eq 0 ] && [ "$gruen" -eq "$N_FOLGEN" ]
}

case "${1:-}" in
  last) last ;;
  einheit) einheit ;;
  uhr) uhr ;;
  golden) golden ;;
  matrix) matrix ;;
  ton) ton ;;
  ports) ports ;;
  echtzeit) echtzeit ;;
  leitstand) leitstand ;;
  alles) g=0; last; for t in einheit uhr golden matrix ton ports echtzeit leitstand; do echo "== $t"; $t || { echo "== $t NICHT BESTANDEN"; g=1; }; done; last; exit $g ;;
  *) echo "Aufruf: CYPHERDJ_INSTANZ=c $0 last|einheit|uhr|golden|matrix|ton|ports|echtzeit|leitstand|alles" >&2; exit 2 ;;
esac
