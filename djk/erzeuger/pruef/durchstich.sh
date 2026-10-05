#!/usr/bin/env bash
# Durchstich Strudel Stufe 1 (Plan 2026-09-27 Task 9) an Instanz i, stumme Senke, kein Ton. Rückgabe 0 = OK.
set -uo pipefail
DJK=$(cd "$(dirname "$0")/../.." && pwd)
PY=$DJK/werkstatt/.venv/bin/python
I=i; SFX=-i; V=9000
KP=$((47100 + V)); ABO=$((47160 + V))
O=$(mktemp -d "${TMPDIR:-/tmp}/durchstich-XXXX")
KIT=$HOME/.config/cypherdj/kits/pruef-impuls
mkdir -p "$KIT" "/dev/shm/cypherdj$SFX/erzeuger"
"$PY" - "$KIT" <<'EOF'
import json, sys, numpy as np
d = sys.argv[1]
t = np.arange(96); f = np.exp(-t / 20.0) * np.sin(t / 3.0); f = (0.15 / np.abs(f).max() * f).astype("<f4")
np.repeat(f, 2).tofile(f"{d}/bd_0.f32")
json.dump({"schema": 1, "name": "pruef-impuls", "klaenge": [{"note": 0, "name": "bd:0", "datei": "bd_0.f32", "frames": 96}]}, open(f"{d}/kit.json", "w"))
EOF
echo 's("[~ bd]*4")' > "/dev/shm/cypherdj$SFX/erzeuger/strom1.js"
"$DJK/start/djk-start" --instanz "$I" > "$O/start.txt" 2>&1 || { cat "$O/start.txt"; exit 2; }
node --permission --allow-fs-read="$DJK" --allow-fs-read="$HOME/strudel" --allow-fs-read="$KIT/.." \
  --allow-fs-read="/dev/shm/cypherdj$SFX/erzeuger" "$DJK/erzeuger/erzeuger.mjs" --kern-port "$KP" --abo-port "$ABO" \
  --kit pruef-impuls --muster "/dev/shm/cypherdj$SFX/erzeuger/strom1.js" 2> "$O/erzeuger.log" &
EP=$!
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
lauf() {  # $1 Name, $2 Fader-Stellung (0 = unten, 1 = 0 dB)
  hand erz/1/fader 0.5 "$2"
  klick 1
  sleep 3
  # 12 s = 25 Beats bei 128 BPM: 8 s gäben nur 17 Bursts, zu wenig für >= 24
  timeout 12 pw-record -P stream.capture.sink=true --target "cypher_stumm$SFX" --rate 48000 --channels 2 --format f32 "$O/$1.wav"
  klick 0
  "$PY" "$DJK/erzeuger/pruef/auswertung.py" "$O/$1.wav" | tee "$O/$1.json"
}
lauf offen 1
wechsel_lauf() {
  hand erz/1/fader 0.5 1
  klick 1
  sleep 2
  ( sleep 3; node "$DJK/erzeuger/djk-muster" --instanz "$I" --text 's("[~ bd ~ ~]*4")' ) &
  timeout 8 pw-record -P stream.capture.sink=true --target "cypher_stumm$SFX" --rate 48000 --channels 2 --format f32 "$O/wechsel.wav"
  klick 0
  "$PY" "$DJK/erzeuger/pruef/auswertung.py" --wechsel "$O/wechsel.wav" | tee "$O/wechsel.json"
  echo 's("[~ bd]*4")' > "/dev/shm/cypherdj$SFX/erzeuger/strom1.js"
}
wechsel_lauf
lauf zu 0
kill "$EP"; wait "$EP" 2>/dev/null
"$DJK/start/djk-stop" --instanz "$I" > "$O/stop.txt" 2>&1
"$PY" - "$O" <<'EOF'
import json, sys
o = sys.argv[1]
a, z = json.load(open(f"{o}/offen.json")), json.load(open(f"{o}/zu.json"))
w = json.load(open(f"{o}/wechsel.json"))
ok = a["impulse"] >= 24 and a["streuung"] is not None and a["streuung"] <= 1 and z["impulse"] == 0
ok = ok and w["ok"] and w["auf_takt_eins"]
print(("OK  " if ok else "FEHL") + f" offen {a}  zu {z}  wechsel {w}  Ordner {o}")
sys.exit(0 if ok else 1)
EOF
