#!/bin/bash
# Erzeugt die Faust-Header des Kerns. Ausgabe nie von Hand ändern: .dsp ändern, dieses Skript laufen lassen, beides committen.
set -euo pipefail
cd "$(dirname "$0")"
Z=../include/cypherdj/gen
mkdir -p "$Z"
faust --version | sed -n 1p > "$Z/FAUST_VERSION" # sed statt head: head -1 beendet die Pipe früh, pipefail meldet SIGPIPE (141)
faust -lang cpp -ns cdjfaust -cn ZitaHall -scn FaustBasis zita_hall.dsp -o "$Z/zita_hall.h"
if [ -f kleber.dsp ]; then faust -lang cpp -ns cdjfaust -cn KleberDsp -scn FaustBasis kleber.dsp -o "$Z/kleber.h"; fi
