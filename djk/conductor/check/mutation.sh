#!/usr/bin/env bash
# Mutationsprobe (Fehlerfall vorher/nachher am selben Test): kopiert djk/conductor und djk/announcement in einen
# Wegwerf-Ordner, verfälscht dort genau eine Stelle einer Quelldatei per sed und fährt einen Test. Der Test muss rot
# werden; die echte Quelle bleibt unberührt (am Ende per sha256sum geprüft).
# Aufruf: check/mutation.sh <datei relativ zu djk/> <sed-ausdruck> <test relativ zu djk/>
# Beispiel: check/mutation.sh conductor/src/osc.ts 's/writeInt32BE/writeInt32LE/' conductor/tests/osc.test.ts
# Rückgabe: 0 = Test rot wie erwartet, 1 = Test blieb grün (Test taugt nicht), 2 = sed hat nichts geändert.
set -uo pipefail
DATEI="$1"; AUSDRUCK="$2"; TEST="$3"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../.." && pwd)
W=$(mktemp -d "${TMPDIR:-/tmp}/djk12-mut.XXXXXX")
trap 'rm -rf "$W"' EXIT
vorher=$(sha256sum "$DJK/$DATEI" | cut -d' ' -f1)
mkdir -p "$W/conductor" "$W/config"
( cd "$DJK/conductor" && tar --exclude=node_modules -cf - . ) | ( cd "$W/conductor" && tar -xf - )
ln -s "$DJK/conductor/node_modules" "$W/conductor/node_modules"
[ -d "$DJK/announcement" ] && cp -r "$DJK/announcement" "$W/announcement"
cp "$DJK/config/leitstand.toml" "$W/config/" 2>/dev/null
ln -s "$DJK/contract" "$W/contract"
sed -i "$AUSDRUCK" "$W/$DATEI"
if cmp -s "$DJK/$DATEI" "$W/$DATEI"; then echo "MUTATION WIRKUNGSLOS: sed änderte $DATEI nicht" >&2; exit 2; fi
diff <(cat "$DJK/$DATEI") "$W/$DATEI" | head -4 >&2
( cd "$W/conductor" && timeout 120 node --test --test-concurrency=1 "$W/$TEST" > "$W/lauf.txt" 2>&1 )
RC=$?
grep -E '^# (pass|fail)' "$W/lauf.txt" >&2
[ "$(sha256sum "$DJK/$DATEI" | cut -d' ' -f1)" = "$vorher" ] || { echo "QUELLE VERÄNDERT: $DATEI" >&2; exit 1; }
if [ "$RC" -ne 0 ]; then echo "ROT wie erwartet: $TEST fängt die Mutation in $DATEI"; exit 0; fi
echo "GRÜN trotz Mutation: $TEST fängt die Mutation in $DATEI nicht" >&2
exit 1
