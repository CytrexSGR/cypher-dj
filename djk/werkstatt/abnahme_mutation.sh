#!/usr/bin/env bash
# Scheibe 15: Positiv-Gegenprobe der Abnahme-Zaehlung. Eine Kopie eines Pruef-Bestands (Vorgabe pruef/kontroll_bestand
# aus Task 12, zwei Materialien) bekommt je Pruefung genau einen eingebauten Fehler; jede Pruefung muss NEIN sagen und
# abnahme_15 mit 1 enden. Der echte Bestand wird nie angefasst.
# Aufruf (aus djk/werkstatt): bash abnahme_mutation.sh [QUELLE]
set -u
QUELLE=${1:-pruef/kontroll_bestand}
PY=.venv/bin/python
T=$(mktemp -d "${TMPDIR:-/tmp}/djk15-mut.XXXXXX")
cp -a "$QUELLE" "$T/b"
M=$(ls "$T/b" | grep -E '^[0-9a-f]{16}$' | head -1)
M2=$(ls "$T/b" | grep -E '^[0-9a-f]{16}$' | tail -1)
F="$T/b/$M/fassungen/128000_r1"
F2="$T/b/$M2/fassungen/128000_r1"
chmod u+w "$F" "$F/fassung.json" "$F/basis.f32" "$F2" "$F2/fassung.json"
"$PY" - "$F" "$F2" <<'PYEOF'
import json, sys, numpy as np
f, f2 = sys.argv[1], sys.argv[2]
d = json.load(open(f + "/fassung.json")); del d["lautheit"]; json.dump(d, open(f + "/fassung.json", "w"))    # Schema
y = np.memmap(f + "/basis.f32", dtype="<f4", mode="r+"); y[1000] = 1.0; y.flush()                        # Luft
d = json.load(open(f2 + "/fassung.json")); d["stimmung_korrektur_cent"] = 0.0                            # Stimmung
json.dump(d, open(f2 + "/fassung.json", "w"))
PYEOF
chmod 0444 "$F/fassung.json" "$F2/fassung.json"; chmod 0644 "$F/basis.f32"; chmod 0555 "$F" "$F2"      # Versiegelt
"$PY" - "$T/b/index.sqlite" "$M" <<'PYEOF'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1]); c.execute("DELETE FROM fassung WHERE material_id=?", (sys.argv[2],)); c.commit()
PYEOF
"$PY" -m werkstatt.abnahme_15 --bestand "$T/b" --ohne-warp --kein-bericht 2>&1 | grep -E "^- |^Urteil"
rc=${PIPESTATUS[0]}
echo "rc=$rc"
chmod -R u+w "$T"; rm -rf "$T"
