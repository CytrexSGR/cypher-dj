#!/usr/bin/env bash
# Durchstich MVP 2 Scheibe 3, Slice 1 (begin/end, §4.8 Parameter-Schwanz) an Instanz i, stumme Senke, kein Ton.
# Messinstrument ist der Mitschnitt von C vor dem Kanalzug (bitgleich, wie Scheibe 2); der Master-Ausgang taugt nicht,
# die Kanalkette verschmiert Einzelschläge (erster Lauf 27.09.: Läufe bis 898 Samples).
# Zwei REC zu je 1 Takt mit dem Prüf-Kit (bd:0 = 96 Frames), Muster [~ bd]*4 (Offbeats, Frame 11 250 + k · 22 500):
#   voll:  s("[~ bd]*4")             → an jedem Offbeat bd_0[0:96] bitgleich (Negativ-Kontrolle)
#   begin: s("[~ bd]*4").begin(0.5)  → an jedem Offbeat bd_0[48:96] bitgleich, danach 48 Frames Stille
# Rückgabe 0 = OK. Fehlerfall: KERN=<cypherdj-kern-mutation-begin> tauscht den Kern für diesen Lauf.
set -uo pipefail
DJK=$(cd "$(dirname "$0")/../.." && pwd)
PY=$DJK/werkstatt/.venv/bin/python
I=i; SFX=-i
O=${AUSGABE:-$(mktemp -d "${TMPDIR:-/tmp}/durchstich-begin-XXXX")}
mkdir -p "$O"
KIT=$HOME/.config/cypherdj/kits/pruef-impuls
BIN=$DJK/kern/build/cypherdj-kern
if [ -n "${KERN:-}" ]; then cp "$BIN" "$O/kern.echt" && cp "$KERN" "$BIN"; trap 'cp "$O/kern.echt" "$BIN"; rm -f "$O/kern.echt"' EXIT; fi
"$DJK/start/djk-start" --instanz "$I" --strudel --strudel-kit pruef-impuls > "$O/start.txt" 2>&1 || { cat "$O/start.txt"; exit 2; }
rec() {  # $1 Name, $2 Muster
  "$DJK/erzeuger/djk-muster" --instanz "$I" --text "$2" >> "$O/muster.txt" 2>&1
  sleep 4  # bis das Muster sicher gilt (Wechsel am nächsten Takt)
  node "$DJK/loops/djk-loop" --instanz "$I" --quelle andreas rec 4 "$1" >> "$O/rec.txt" 2>&1
}
N1="begin-voll-$$"; N2="begin-halb-$$"
rec "$N1" 's("[~ bd]*4")'
rec "$N2" 's("[~ bd]*4").begin(0.5)'
"$DJK/start/djk-stop" --instanz "$I" > "$O/stop.txt" 2>&1
"$PY" - "$O" "/dev/shm/cypherdj$SFX/loops" "$N1" "$N2" "$KIT/bd_0.f32" <<'PY'
import json, sys
import numpy as np
o, ordner, n1, n2, kitdatei = sys.argv[1:]
bd = np.fromfile(kitdatei, dtype="<f4").reshape(-1, 2)
def lies(n):
    return np.fromfile(f"{ordner}/{n}/loop.f32", dtype="<f4").reshape(-1, 2)
def pruef(x, soll):
    treffer = 0
    for k in range(4):
        a = 11250 + k * 22500
        stueck, rest = x[a:a + len(soll)], x[a + len(soll):a + 96]
        treffer += bool(np.array_equal(stueck, soll) and not np.any(rest))
    return treffer
v, h = lies(n1), lies(n2)
erg = {"voll_bitgleich_von_4": pruef(v, bd), "halb_bitgleich_von_4": pruef(h, bd[48:]),
       "halb_wie_voll_von_4": pruef(h, bd), "frames": [len(v), len(h)]}
ok = erg["voll_bitgleich_von_4"] == 4 and erg["halb_bitgleich_von_4"] == 4 and erg["halb_wie_voll_von_4"] == 0
json.dump(erg, open(f"{o}/ergebnis.json", "w"), indent=1)
print(("OK  " if ok else "FEHL") + f" {erg}  Ordner {o}")
sys.exit(0 if ok else 1)
PY
RC=$?
rm -rf "/dev/shm/cypherdj$SFX/loops/$N1" "/dev/shm/cypherdj$SFX/loops/$N2"
exit $RC
