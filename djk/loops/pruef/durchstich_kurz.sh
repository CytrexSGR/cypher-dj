#!/usr/bin/env bash
# Durchstich MVP 2 Scheibe 3, Slice 3 (kurze Längen, beats) an Instanz i, stumme Senke, kein Ton.
# (1) REC 1 Beat viermal von s("[~ bd]*4"): je 22 500 Frames, Burst bitgleich zu bd_0 bei Frame 11 250, Einsatz auf
#     einem ganzen Beat, und nicht nur auf Takt-Einsen (mit dem alten 4-Beat-Raster wären alle ab_beat Vielfache von 4).
# (2) REC 2 Beats: 45 000 Frames, Bursts bei 11 250 und 33 750.
# (3) Alte Loop-Datei (takte 1, wie die Hörtest-Aufnahmen): djk-loop liste zeigt 4 Beat(s), laden in L1 → bereit.
set -uo pipefail
DJK=$(cd "$(dirname "$0")/../.." && pwd)
PY=$DJK/werkstatt/.venv/bin/python
I=i; SFX=-i
O=${AUSGABE:-$(mktemp -d "${TMPDIR:-/tmp}/durchstich-kurz-XXXX")}
mkdir -p "$O"
KIT=$HOME/.config/cypherdj/kits/pruef-impuls
LOOPS=/dev/shm/cypherdj$SFX/loops
trap 'rm -rf "$LOOPS"/kurz-*-$$ "$LOOPS/alt-$$"' EXIT
"$DJK/start/djk-start" --instanz "$I" --strudel --strudel-kit pruef-impuls > "$O/start.txt" 2>&1 || { cat "$O/start.txt"; exit 2; }
L() { node "$DJK/loops/djk-loop" --instanz "$I" --quelle andreas "$@"; }
"$DJK/erzeuger/djk-muster" --instanz "$I" --text 's("[~ bd]*4")' > "$O/muster.txt" 2>&1
sleep 4
for k in 1 2 3 4; do L rec 1 "kurz-1-$k-$$" >> "$O/rec.txt" 2>&1; sleep 0.$((RANDOM % 9)); done
L rec 2 "kurz-2-$$" >> "$O/rec.txt" 2>&1
mkdir -p "$LOOPS/alt-$$"
"$PY" -c "import numpy as np; np.zeros(180000, dtype='<f4').tofile('$LOOPS/alt-$$/loop.f32')"
echo '{"schema": 1, "name": "alt", "takte": 1, "bpm": 128, "frames": 90000, "datei": "loop.f32"}' > "$LOOPS/alt-$$/loop.json"
L liste > "$O/liste.txt" 2>&1
L laden 1 "alt-$$" > "$O/alt.txt" 2>&1
"$DJK/start/djk-stop" --instanz "$I" > "$O/stop.txt" 2>&1
cat "$O/rec.txt" "$O/alt.txt"
"$PY" - "$O" "$LOOPS" "$$" "$KIT/bd_0.f32" <<'PY'
import json, re, sys
import numpy as np
o, ordner, pid, kitdatei = sys.argv[1:]
bd = np.fromfile(kitdatei, dtype="<f4").reshape(-1, 2)
lies = lambda n: np.fromfile(f"{ordner}/{n}/loop.f32", dtype="<f4").reshape(-1, 2)
rec = open(f"{o}/rec.txt").read()
ab = [float(x) for x in re.findall(r"ab Beat ([0-9.]+)", rec)]
eins = [lies(f"kurz-1-{k}-{pid}") for k in (1, 2, 3, 4)]
zwei = lies(f"kurz-2-{pid}")
erg = {
  "ein_beat_frames": [len(x) for x in eins],
  "ein_beat_burst_bitgleich_von_4": sum(bool(np.array_equal(x[11250:11250 + 96], bd)) for x in eins),
  "ab_beat": ab,
  "ab_beat_ganzzahlig": all(b == int(b) for b in ab),
  "ab_beat_nicht_nur_takt_eins": any(int(b) % 4 for b in ab[:4]),
  "zwei_beats_frames": len(zwei),
  "zwei_beats_bursts": [bool(np.array_equal(zwei[s:s + 96], bd)) for s in (11250, 33750)],
  "alt_liste": re.findall(rf"alt-{pid}\t.*", open(f"{o}/liste.txt").read()),
  "alt_geladen": open(f"{o}/alt.txt").read().strip(),
}
ok = erg["ein_beat_frames"] == [22500] * 4 and erg["ein_beat_burst_bitgleich_von_4"] == 4 and erg["ab_beat_ganzzahlig"] \
     and erg["ab_beat_nicht_nur_takt_eins"] and erg["zwei_beats_frames"] == 45000 and all(erg["zwei_beats_bursts"]) \
     and erg["alt_liste"] and "4 Beat" in erg["alt_liste"][0] and "bereit" in erg["alt_geladen"]
json.dump(erg, open(f"{o}/ergebnis.json", "w"), indent=1)
print(("OK  " if ok else "FEHL") + f" {erg}  Ordner {o}")
sys.exit(0 if ok else 1)
PY
