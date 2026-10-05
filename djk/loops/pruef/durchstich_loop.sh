#!/usr/bin/env bash
# Durchstich Loop-Boxen (Plan MVP 2 Task 11) an Instanz i, stumme Senke, kein Ton. Rückgabe 0 = OK.
set -uo pipefail
DJK=$(cd "$(dirname "$0")/../.." && pwd)
PY=$DJK/werkstatt/.venv/bin/python
I=i; SFX=-i; V=9000
KP=$((47100 + V))
O=$(mktemp -d "${TMPDIR:-/tmp}/loop-durchstich-XXXX")
"$DJK/start/djk-start" --instanz "$I" > "$O/start.txt" 2>&1 || { cat "$O/start.txt"; exit 2; }
"$PY" "$DJK/loops/pruef_loop.py" "/dev/shm/cypherdj$SFX/loops" pruef-burst > /dev/null
hand() {  # /test/hand an den Kern: erst die Stellung, dann der Wert (§7.3 Punkt 2)
  node -e "
    import('$DJK/vertrag/attrappe_kern/osc.mjs').then(({ kodiere }) => {
      const s = require('node:dgram').createSocket('udp4');
      const m = (u) => kodiere('/test/hand', 'sfh', ['$1', u, 0n]);
      s.send(m($2), $KP, '127.0.0.1', () => setTimeout(() => s.send(m($3), $KP, '127.0.0.1', () => s.close()), 60));
    });"
}
klick() { node -e "
    import('$DJK/vertrag/attrappe_kern/osc.mjs').then(({ kodiere }) => {
      const s = require('node:dgram').createSocket('udp4');
      s.send(kodiere('/test/klick', 'hssi', [BigInt(Date.now()), 'pruefstand', 'master', $1]), $KP, '127.0.0.1', () => s.close());
    });"; }
L() { node "$DJK/loops/djk-loop" --instanz "$I" --quelle andreas "$@"; }
if ! { L laden 1 pruef-burst && L start 1; } > "$O/loop.txt" 2>&1; then
  cat "$O/loop.txt"; "$DJK/start/djk-stop" --instanz "$I" > /dev/null 2>&1; exit 2
fi
lauf() {  # $1 Name, $2 Fader-Stellung (0 = unten, 1 = 0 dB)
  hand pad/1/fader 0.5 "$2"
  klick 1
  sleep 3
  timeout 12 pw-record -P stream.capture.sink=true --target "cypher_stumm$SFX" --rate 48000 --channels 2 --format f32 "$O/$1.wav"
  klick 0
  "$PY" "$DJK/erzeuger/pruef/auswertung.py" "$O/$1.wav" | tee "$O/$1.json"
}
lauf offen 1
lauf zu 0
L stopp 1 >> "$O/loop.txt" 2>&1
"$DJK/start/djk-stop" --instanz "$I" > "$O/stop.txt" 2>&1
rm -rf "/dev/shm/cypherdj$SFX/loops/pruef-burst"
"$PY" - "$O" <<'EOF'
import json, sys
o = sys.argv[1]
a, z = json.load(open(f"{o}/offen.json")), json.load(open(f"{o}/zu.json"))
ok = a["impulse"] >= 24 and a["streuung"] is not None and a["streuung"] <= 1 and z["impulse"] == 0
print(("OK  " if ok else "FEHL") + f" offen {a}  zu {z}  Ordner {o}")
sys.exit(0 if ok else 1)
EOF
