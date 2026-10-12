#!/usr/bin/env bash
# Listen- und Muster-Ablage je Instanz (Review S2b Befund 7): Prüfinstanzen schreiben NICHT in die Bibliothek des Betriebs.
# Nur Vorlagen (--vorlagen-nach), kein Start, kein Dienst, kein Ton. Aufruf: tests/test_ablage.sh [instanz a..i, Vorgabe b]
# Prüfpunkte:
#   A1 Prüfinstanz: die Oberfläche bekommt --sammlungen und --muster-bibliothek unter /dev/shm/cypherdj-<i>/bibliothek
#   A2 Negativ-Kontrolle Betrieb (keine Instanz): keine der beiden Optionen, es gelten die Vorgaben der Seite (<repo>/bibliothek)
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
I=${1:-b}
case "$I" in [a-i]) ;; *) echo "Instanz a bis i" >&2; exit 2;; esac
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-ablage-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
# Auflösung gegen ein aufgezeichnetes pw-dump wie test_ziel.sh: nichts am lebenden PipeWire
echo '[]' > "$O/dump.json"; export DJK_PW_DUMP="$O/dump.json"
zeile() { grep -h -A3 '^ExecStart=' "$O/v/cypherdj-oberflaeche.service" 2>/dev/null | tr '\n' ' '; }
rm -rf "$O/v"; "$START/djk-start" --instanz "$I" --vorlagen-nach "$O/v" >"$O/a1.txt" 2>&1; R=$?
Z=$(zeile)
[ "$R" = 0 ] && [[ "$Z" == *"--sammlungen /dev/shm/cypherdj-$I/bibliothek/sets"* ]] && [[ "$Z" == *"--muster-bibliothek /dev/shm/cypherdj-$I/bibliothek/muster"* ]]
pruef $? "A1 Prüfinstanz $I: eigene Ablage unter /dev/shm/cypherdj-$I/bibliothek: rc $R: ${Z:0:300} $(head -c 200 "$O/a1.txt")"
env -u CYPHERDJ_INSTANZ "$START/djk-start" --vorlagen-nach "$O/v2" >"$O/a2.txt" 2>&1; R=$?
Z=$(grep -h -A3 '^ExecStart=' "$O/v2/cypherdj-oberflaeche.service" 2>/dev/null | tr '\n' ' ')
[ "$R" = 0 ] && [ -n "$Z" ] && [[ "$Z" != *"--sammlungen"* ]] && [[ "$Z" != *"--muster-bibliothek"* ]]
pruef $? "A2 Betrieb: weder --sammlungen noch --muster-bibliothek (Vorgabe der Seite): rc $R: ${Z:0:200} $(head -c 200 "$O/a2.txt")"
# S5-Review B4: der Welle-Cache einer Prüfinstanz liegt in ihrem /dev/shm, nie im Cache des Betriebs (~/.cache/cypherdj/welle)
rm -rf "$O/v"; "$START/djk-start" --instanz "$I" --vorlagen-nach "$O/v" >"$O/a3.txt" 2>&1; R=$?; Z1=$(zeile)
[ "$R" = 0 ] && [[ "$Z1" == *"--welle-cache /dev/shm/cypherdj-$I/welle"* ]]
pruef $? "A3 Prüfinstanz $I: --welle-cache /dev/shm/cypherdj-$I/welle: rc $R: ${Z1:0:300}"
Z2=$(grep -h -A3 '^ExecStart=' "$O/v2/cypherdj-oberflaeche.service" 2>/dev/null | tr '\n' ' ')
[ -n "$Z2" ] && [[ "$Z2" != *"--welle-cache"* ]]
pruef $? "A4 Betrieb: kein --welle-cache (Vorgabe der Seite: ~/.cache/cypherdj/welle): ${Z2:0:200}"
echo "OK $OK FEHL $FEHL"; [ "$FEHL" = 0 ]
