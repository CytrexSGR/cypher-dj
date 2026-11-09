#!/usr/bin/env bash
# Startet djk/units/cypherdj-leitstand.service als transiente User-Unit (nie enable, ROADMAP §8.4): ExecStart und
# alle Schlüssel aus [Service] kommen aus der Datei, %h wird aufgelöst, dazu CYPHERDJ_INSTANZ und Zusatzargumente.
# Aufruf: unit_probe.sh <instanz> <unit-suffix> [argumente an den Leitstand ...]
# Ausgabe: der Unit-Name. DJK (Vorgabe ~/cypher-dj/djk) erlaubt eine Plan-Probe an anderem Ort.
set -euo pipefail
INST="$1"; SUFFIX="$2"; shift 2
DJK="${DJK:-$HOME/cypher-dj/djk}"
UNIT_DATEI="$DJK/units/cypherdj-leitstand.service"
ersetze() { sed -e "s|%h/cypher-dj/djk|$DJK|g" -e "s|%h|$HOME|g"; }
EXEC=$(sed -n 's/^ExecStart=//p' "$UNIT_DATEI" | ersetze)
PROPS=()
while IFS= read -r z; do PROPS+=(-p "$z"); done < <(sed -n '/^\[Service\]/,/^\[/p' "$UNIT_DATEI" \
  | grep -E '^[A-Za-z]+=' | grep -v -E '^(ExecStart|Type)=' | ersetze)
NAME="cypherdj-leitstand-$INST-$SUFFIX"
# shellcheck disable=SC2086
systemd-run --user --quiet --unit="$NAME" --service-type=simple --setenv=CYPHERDJ_INSTANZ="$INST" "${PROPS[@]}" \
  $EXEC "$@"
echo "$NAME"
