#!/usr/bin/env bash
# Durchstich Klang K1 T3: Kern-Master aufnehmen -> Schleuse-Urteil, an einer Prüfinstanz, stumme Senke, kein Ton.
# Prüf-Kit pruef-ton: EIN Klang bd:0 = 997-Hz-Sinus, 1,0 s, -14 dBFS, 10 ms Ein-/Ausblende, L=R. Muster s("bd"):
# ein Anschlag je Takt (Takt >= 1 s bei <= 240 BPM), keine Überlappung. Fader erz/1 per /test/hand (Stellung 0..1).
# Gutfall (Fader 1): Exit 0, BESTANDEN, lufs in [-20,-8], korrelation > 0,99, dauer_s >= 7,9.
# Stummfall (Fader 0, derselbe Lauf): Exit 1, Verstoß lautheit. Rückgabe 0 = beide wie erwartet, 1 = nicht, 2 = Aufbau.
# Instanz: CYPHERDJ_INSTANZ oder f (Vorgabe). Ports aus der Instanz abgeleitet wie djk-start: V = 1000 * (Buchstabe - 'a' + 1).
set -uo pipefail
DJK=$(cd "$(dirname "$0")/../.." && pwd)
PY=$DJK/werkstatt/.venv/bin/python
I=${CYPHERDJ_INSTANZ:-f}
case "$I" in [a-i]) ;; *) echo "Instanz '$I' ungültig" >&2; exit 2;; esac
V=$(( 1000 * ($(printf '%d' "'$I") - 96) ))   # f -> 6000, Kern-UDP 47100+V = 53100 (gemessen in djk-start-Ausgabe)
KP=$((47100 + V))
O=${ZIEL:-$HOME/messungen/klang/durchstich-$(date +%Y%m%d-%H%M%S)}
mkdir -p "$O"
KIT=$HOME/.config/cypherdj/kits/pruef-ton
mkdir -p "$KIT" "/dev/shm/cypherdj-$I/erzeuger"
"$PY" - "$KIT" <<'PYEOF'
import json, sys, numpy as np
d = sys.argv[1]; sr = 48000; n = sr
t = np.arange(n) / sr
x = np.sin(2 * np.pi * 997 * t) * 10 ** (-14 / 20)
f = int(0.010 * sr); r = np.ones(n); r[:f] = np.linspace(0, 1, f); r[-f:] = np.linspace(1, 0, f)
x = (x * r).astype("<f4")
np.repeat(x, 2).tofile(f"{d}/bd_0.f32")
json.dump({"schema": 1, "name": "pruef-ton", "klaenge": [{"note": 0, "name": "bd:0", "datei": "bd_0.f32", "frames": n}]}, open(f"{d}/kit.json", "w"))
PYEOF
stopp() { "$DJK/start/djk-stop" --instanz "$I" > "$O/stop.txt" 2>&1; }
"$DJK/start/djk-start" --instanz "$I" --strudel --strudel-kit pruef-ton > "$O/start.txt" 2>&1 || { cat "$O/start.txt"; exit 2; }  # bei "busy" (fremde Welle) läuft nichts von uns: nicht stoppen
trap stopp EXIT
"$DJK/erzeuger/djk-muster" --instanz "$I" --text 's("bd")' > "$O/muster.txt" 2>&1 || { echo "djk-muster gescheitert:"; cat "$O/muster.txt"; exit 2; }
sleep 4  # bis das Muster übernommen ist
hand() {  # /test/hand: erst die Stellung $2, dann der Wert $3
  node -e "
    import('$DJK/vertrag/attrappe_kern/osc.mjs').then(({ kodiere }) => {
      const s = require('node:dgram').createSocket('udp4');
      const m = (u) => kodiere('/test/hand', 'sfh', ['$1', u, 0n]);
      s.send(m($2), $KP, '127.0.0.1', () => setTimeout(() => s.send(m($3), $KP, '127.0.0.1', () => s.close()), 60));
    });" || { echo "hand $1 gescheitert" >&2; exit 2; }
}
fall() {  # $1 Name, $2 Fader-Stellung
  hand erz/1/fader 0.5 "$2"; sleep 1.5
  "$DJK/klang/djk-schleuse" --instanz "$I" --sekunden 8 --ziel "$O/$1" > "$O/$1.konsole.txt" 2>&1
  echo $? > "$O/$1.exit"
  cat "$O/$1.konsole.txt"
}
fall gut 1
fall stumm 0
for n in gut stumm; do  # ohne Urteil kein Ergebnis: Aufbau-/Messfehler, kein Python-Traceback
  [ -s "$O/$n/urteil.json" ] || { echo "FEHL: $O/$n/urteil.json fehlt (djk-schleuse Exit $(cat "$O/$n.exit"), siehe $O/$n.konsole.txt)" >&2; exit 2; }
done
"$PY" - "$O" <<'PYEOF'
import json, sys
o = sys.argv[1]
ex = lambda n: int(open(f"{o}/{n}.exit").read())
g = json.load(open(f"{o}/gut/urteil.json")); s = json.load(open(f"{o}/stumm/urteil.json"))
m = g["messung"]
gut = ex("gut") == 0 and g["bestanden"] and -20 <= m["lufs"] <= -8 and m["korrelation"] > 0.99 and m["dauer_s"] >= 7.9
stumm = ex("stumm") == 1 and not s["bestanden"] and any(v["kriterium"] == "lautheit" for v in s["verstoesse"])
print(("OK  " if gut and stumm else "FEHL") + f" gut={gut} (exit {ex('gut')}, lufs {m['lufs']}, tp {m['true_peak_dbtp']}, korr {m['korrelation']}, dauer {m['dauer_s']})"
      f" stumm={stumm} (exit {ex('stumm')}, lufs {s['messung']['lufs']}, verstoesse {[v['kriterium'] for v in s['verstoesse']]})  Ordner {o}")
sys.exit(0 if gut and stumm else 1)
PYEOF
