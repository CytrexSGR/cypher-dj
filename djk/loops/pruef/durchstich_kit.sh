#!/usr/bin/env bash
# Durchstich MVP 2 Scheibe 3, Slice 2 (Mitschnitt → Strudel-Klang, live) an Instanz i, stumme Senke, kein Ton.
# Messinstrument: Mitschnitt von C vor dem Kanalzug (bitgleich). Ablauf ohne Neustart von Kern oder Erzeuger:
#   A = REC 1 Takt von s("[~ bd]*4")                    (Prüf-Kit, Offbeat-Bursts)
#   0 = REC 1 Takt von s("rec0") BEVOR es rec0 gibt      → Stille (Negativ-Kontrolle: der Name ist unbekannt)
#   djk-loop kit A                                       → Klang rec0 im Kit rec-i, der Erzeuger lädt nach
#   B = REC 1 Takt von s("rec0")                         → B == A bitgleich (Einsatz auf der Eins wie der REC)
#   C = REC 1 Takt von s("rec0*4").slice(4, "3 2 1 0")  → Viertel k von C == Viertel 3-k von A
# Rückgabe 0 = OK. Fehlerfall: KERN=<cypherdj-kern-mutation-begin> (begin/end ignoriert) → C fällt durch.
set -uo pipefail
DJK=$(cd "$(dirname "$0")/../.." && pwd)
PY=$DJK/werkstatt/.venv/bin/python
I=i; SFX=-i
O=${AUSGABE:-$(mktemp -d "${TMPDIR:-/tmp}/durchstich-kit-XXXX")}
mkdir -p "$O"
REC_KIT=$HOME/.config/cypherdj/kits/rec$SFX
LOOPS=/dev/shm/cypherdj$SFX/loops
BIN=$DJK/kern/build/cypherdj-kern
rm -rf "$REC_KIT"
aufraeumen() {
  [ -f "$O/kern.echt" ] && cp "$O/kern.echt" "$BIN" && rm -f "$O/kern.echt"
  rm -rf "$REC_KIT" "$LOOPS/kit-a-$$" "$LOOPS/kit-0-$$" "$LOOPS/kit-b-$$" "$LOOPS/kit-c-$$"
}
trap aufraeumen EXIT
if [ -n "${KERN:-}" ]; then cp "$BIN" "$O/kern.echt" && cp "$KERN" "$BIN"; fi
"$DJK/start/djk-start" --instanz "$I" --strudel --strudel-kit pruef-impuls > "$O/start.txt" 2>&1 || { cat "$O/start.txt"; exit 2; }
L() { node "$DJK/loops/djk-loop" --instanz "$I" --quelle andreas "$@"; }
rec() {  # $1 Name, $2 Muster
  "$DJK/erzeuger/djk-muster" --instanz "$I" --text "$2" >> "$O/muster.txt" 2>&1
  sleep 4
  L rec 4 "$1" >> "$O/rec.txt" 2>&1
}
rec "kit-a-$$" 's("[~ bd]*4")'
rec "kit-0-$$" 's("rec0")'
L --kit pruef-impuls kit "kit-a-$$" >> "$O/kit.txt" 2>&1
cat "$O/kit.txt"
rec "kit-b-$$" 's("rec0")'
rec "kit-c-$$" 's("rec0*4").slice(4, "3 2 1 0")'
journalctl --user -u "cypherdj-erzeuger$SFX" --since "-3 min" --no-pager > "$O/erzeuger.log" 2>&1
"$DJK/start/djk-stop" --instanz "$I" > "$O/stop.txt" 2>&1
cat "$O/rec.txt"
"$PY" - "$O" "$LOOPS" "$$" <<'PY'
import json, sys
import numpy as np
o, ordner, pid = sys.argv[1:]
lies = lambda n: np.fromfile(f"{ordner}/kit-{n}-{pid}/loop.f32", dtype="<f4").reshape(-1, 2)
A, N, B, C = lies("a"), lies("0"), lies("b"), lies("c")
q = len(A) // 4
erg = {
  "a_hat_ton": bool(np.any(A)),
  "vorher_still": not bool(np.any(N)),
  "b_gleich_a": bool(np.array_equal(B, A)),
  "c_viertel_umgekehrt_von_4": sum(bool(np.array_equal(C[k*q:(k+1)*q], A[(3-k)*q:(4-k)*q])) for k in range(4)),
  "frames": [len(A), len(N), len(B), len(C)],
}
ok = erg["a_hat_ton"] and erg["vorher_still"] and erg["b_gleich_a"] and erg["c_viertel_umgekehrt_von_4"] == 4
json.dump(erg, open(f"{o}/ergebnis.json", "w"), indent=1)
print(("OK  " if ok else "FEHL") + f" {erg}  Ordner {o}")
sys.exit(0 if ok else 1)
PY
