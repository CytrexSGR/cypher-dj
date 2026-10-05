#!/usr/bin/env bash
# Mutationsprobe: kopiert djk/pruefstand in einen Wegwerf-Ordner, ändert dort eine Stelle und lässt die Tests laufen.
# Ein Messer ist nur dann geprüft, wenn seine Mutante rot wird (Fehlerfall) und das Original grün bleibt.
# Aufruf: tests/mutation.sh <datei> <sed-ausdruck> <testdatei> [pytest-filter]
# Rückgabewert: 0, wenn die Mutante rot wurde (gewollt); 1, wenn sie grün blieb; 2 bei Aufruffehler.
set -u
[ $# -ge 3 ] || { echo "Aufruf: tests/mutation.sh <datei> <sed-ausdruck> <testdatei> [pytest-filter]" >&2; exit 2; }
HIER=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/pruefstand-mutation.XXXXXX")
trap 'rm -rf "$T"' EXIT
cp -r "$HIER" "$T/pruefstand"
rm -rf "$T/pruefstand/laeufe" "$T/pruefstand/build"
vorher=$(md5sum < "$T/pruefstand/$1")
sed -i "$2" "$T/pruefstand/$1"
[ "$vorher" != "$(md5sum < "$T/pruefstand/$1")" ] || { echo "Mutation greift nicht: $1 unverändert" >&2; exit 2; }
if python3 -m pytest -q -p no:cacheprovider "$T/pruefstand/$3" ${4:+-k "$4"} > "$T/aus.txt" 2>&1; then
  echo "MUTANTE GRÜN (Messer blind): $1 | $2"; tail -1 "$T/aus.txt"; exit 1
fi
echo "Mutante rot (gewollt): $(tail -1 "$T/aus.txt")"
grep -E '^(FAILED|ERROR) ' "$T/aus.txt" | sed -E 's/^[A-Z]+ [^:]*::/  rot: /; s/ - .*//'
