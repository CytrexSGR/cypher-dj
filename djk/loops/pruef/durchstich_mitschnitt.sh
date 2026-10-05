#!/usr/bin/env bash
# Durchstich Mitschnitt (Plan MVP 2 Scheibe 2, ADR 025 Folgeplan) an Instanz i, stumme Senke, kein Ton. Rückgabe 0 = OK.
# Strudel s("[~ bd]*4") mit Kit pruef-impuls auf C: REC 1 Takt (djk-loop rec) schneidet den ersten bd-Treffer bei
# Beat 0,5 mit; im 1-Takt-Loop liegt er dann bei Frame 11 250, bitgleich zu bd_0.f32 des Kits. In L1 geladen spielt
# der Loop auf demselben Raster weiter wie C selbst (Strudel Stufe 1: Abstand Burst → Klick Z1 11 365, Streuung 0).
set -uo pipefail
DJK=$(cd "$(dirname "$0")/../.." && pwd)
PY=$DJK/werkstatt/.venv/bin/python
I=i; SFX=-i; V=9000
KP=$((47100 + V))
O=$(mktemp -d "${TMPDIR:-/tmp}/mitschnitt-durchstich-XXXX")
KIT=$HOME/.config/cypherdj/kits/pruef-impuls
mkdir -p "$KIT" "/dev/shm/cypherdj$SFX/erzeuger"
"$PY" - "$KIT" <<'EOF'
import json, sys, numpy as np
d = sys.argv[1]
t = np.arange(96); f = np.exp(-t / 20.0) * np.sin(t / 3.0); f = (0.15 / np.abs(f).max() * f).astype("<f4")
np.repeat(f, 2).tofile(f"{d}/bd_0.f32")
json.dump({"schema": 1, "name": "pruef-impuls", "klaenge": [{"note": 0, "name": "bd:0", "datei": "bd_0.f32", "frames": 96}]}, open(f"{d}/kit.json", "w"))
EOF
"$DJK/start/djk-start" --instanz "$I" --strudel --strudel-kit pruef-impuls > "$O/start.txt" 2>&1 || { cat "$O/start.txt"; exit 2; }
"$DJK/erzeuger/djk-muster" --instanz "$I" --text 's("[~ bd]*4")' > "$O/muster.txt" 2>&1
sleep 3  # ein Takt, bis das Muster übernommen ist
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
hand erz/1/fader 0.5 0  # C zu VOR dem REC (Plan-Review): der Mitschnitt greift vor dem Kanalzug (F2)
sleep 0.3
NAME="durchstich-rec-$$"
if ! node "$DJK/loops/djk-loop" --instanz "$I" --quelle andreas rec 4 "$NAME" > "$O/rec.txt" 2>&1; then
  cat "$O/rec.txt"; "$DJK/start/djk-stop" --instanz "$I" > /dev/null 2>&1; exit 2
fi
cat "$O/rec.txt"
AB=$(grep -o 'ab Beat [0-9.]*' "$O/rec.txt" | awk '{print $3}')
echo "RASTER ab_beat $AB, ab_sample mod 256 = $(python3 -c "print(round(float('$AB') * 22500) % 256)") (0: Blockanfang-Mutation am Ziel wirkungslos)" | tee "$O/raster.txt"
"$PY" - "$O" "$NAME" "$KIT" <<'EOF'
import sys, numpy as np
o, name, kit = sys.argv[1], sys.argv[2], sys.argv[3]
loop = np.fromfile(f"/dev/shm/cypherdj-i/loops/{name}/loop.f32", dtype="<f4")
bd = np.fromfile(f"{kit}/bd_0.f32", dtype="<f4")
ab = 11250 * 2
stueck = loop[ab:ab + bd.size]
gleich = bool(np.array_equal(stueck, bd))
print(f"BITGLEICH bd_0.f32 bei Frame 11250: {gleich} (stueck {stueck.size}, bd {bd.size})")
open(f"{o}/bitgleich.txt", "w").write("1" if gleich else "0")
EOF
# C ist seit vor dem REC zu: nur L1 klingt
if ! { L laden 1 "$NAME" && L start 1; } > "$O/loop.txt" 2>&1; then
  cat "$O/loop.txt"; "$DJK/start/djk-stop" --instanz "$I" > /dev/null 2>&1; exit 2
fi
lauf() {  # $1 Name, $2 Fader-Stellung pad/1 (0 = unten, 1 = 0 dB)
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
rm -rf "/dev/shm/cypherdj$SFX/loops/$NAME"
"$PY" - "$O" <<'EOF'
import json, sys
o = sys.argv[1]
bitgleich = open(f"{o}/bitgleich.txt").read().strip() == "1"
a, z = json.load(open(f"{o}/offen.json")), json.load(open(f"{o}/zu.json"))
soll = 11365
in_toleranz = a["abstand_min"] is not None and abs(a["abstand_min"] - soll) <= 1 and abs(a["abstand_max"] - soll) <= 1
ok = bitgleich and a["impulse"] >= 24 and a["streuung"] is not None and a["streuung"] <= 1 and in_toleranz and z["impulse"] == 0
print(("OK  " if ok else "FEHL") + f" bitgleich={bitgleich} offen {a} (Soll {soll} ±1) zu {z}  Ordner {o}")
sys.exit(0 if ok else 1)
EOF
