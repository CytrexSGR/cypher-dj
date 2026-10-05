#!/bin/bash
# Kosten je Kanal und Block unter dem gemeinsamen Echtzeit-Schloss, Fremdlast vorher und nachher.
#   werkzeuge/kosten.sh <build-ordner>      Ausgabe auf stdout (der Plan leitet sie in eine Datei)
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -euo pipefail
B=${1:?build-ordner}
# Review 04 Punkt 2: höchstens 2 h warten, sonst Rückgabe 1 statt einer halben Ausgabe
flock -w 7200 "$CYPHERDJ_ECHTZEIT_SCHLOSS" bash -c '
B='"$B"'
echo "uptime vorher: $(uptime)"
nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null | sed "s/^/gpu vorher: /" || echo "gpu vorher: nvidia-smi fehlt"
for r in 1 2 3; do
  for s in leer ruhend faehrt; do echo -n "lauf$r "; "$B/kosten" $s; done
  if [ -x "$B/kosten_faust_lr8" ]; then echo -n "lauf$r "; "$B/kosten_faust_lr8"; fi
done
echo "uptime nachher: $(uptime)"
nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null | sed "s/^/gpu nachher: /" || echo "gpu nachher: nvidia-smi fehlt"
'
