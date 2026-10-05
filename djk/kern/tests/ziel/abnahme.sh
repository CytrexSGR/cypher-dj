#!/usr/bin/env bash
# Abnahme der Scheibe 08 (ROADMAP Steckbrief 08) in einem Zug. Erst ohne Graph: ctest (normal, ASan/UBSan),
# ThreadSanitizer am Befehlsring samt Mutation, Tests des Läufers, unbekannter TOML-Schlüssel. Dann alle Läufe am Graphen
# unter EINEM Echtzeit-Schloss (rund 25 min): die drei Golden-Folgen gegen den Kern (grün) und gegen den Kern aus
# Scheibe 01 (rot), uhr_golden gegen die Mutation „Rampe in Samples“ (rot), Karte voll, Prüfklick in der Rampe
# (Kern grün, Mutation rot), Lückenzähler mit künstlicher Callback-Last (10 K1b), mit halber Last (Negativ-Kontrolle)
# und 10 min Ruhelauf. Zum Schluss bericht.py.
# Ein Lauf mit unbrauchbarem Instrument (Rückgabe 2) wird wiederholt, höchstens 3 Versuche.
# Aufruf im Repo-Wurzelverzeichnis: CYPHERDJ_INSTANZ=a KERN01=<pfad> djk/kern/tests/ziel/abnahme.sh
#   KERN01: das Programm cypherdj-kern aus Scheibe 01 (Task 0 des Plans legt es nach ${TMPDIR:-/tmp}/djk08/kern01/).
#   CYPHERDJ_SCHLOSS=gehalten: der Aufrufer hält das Echtzeit-Schloss schon; jede meta.txt vermerkt schloss=gehalten.
# Rückgabe: die von bericht.py (0 bestanden), 3 kein Schloss.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen, Strang A: export CYPHERDJ_INSTANZ=a}"
: "${KERN01:?KERN01 setzen: Pfad zum cypherdj-kern der Scheibe 01}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
K=$DJK/kern
AUS=${AUS:-$HIER/ergebnisse/$(date +%Y%m%d-%H%M%S)}
mkdir -p "$AUS"
echo "Abnahme nach $AUS" >&2

ctest --test-dir "$K/build" --output-on-failure > "$AUS/ctest_kern.txt" 2>&1
ctest --test-dir "$K/build-asan" --output-on-failure > "$AUS/ctest_kern_asan.txt" 2>&1
{ timeout 300 setarch "$(uname -m)" -R "$K/build-tsan/test_spsc_ring"; echo "rueckgabe=$?"; } > "$AUS/tsan.txt" 2>&1
{ timeout 300 setarch "$(uname -m)" -R "$K/build-tsan-mut/test_spsc_ring"; echo "rueckgabe=$?"; } \
  > "$AUS/tsan_mutation.txt" 2>&1
timeout 600 python3 -m pytest "$K/tests/leitstand" -q > "$AUS/laeufer.txt" 2>&1
sed 's/^start_bpm = /start_bmp = /' "$DJK/konfig/kern.toml" > "$AUS/kern_tippfehler.toml"
{ timeout 10 "$K/build/cypherdj-kern" --konfig "$AUS/kern_tippfehler.toml"; echo "rueckgabe=$?"; } \
  > "$AUS/toml_tippfehler.txt" 2>&1

if [ "${CYPHERDJ_SCHLOSS:-}" = gehalten ]; then  # hält schon der Aufrufer (oder Plan-Probe ohne Schloss, steht in meta)
  echo "Echtzeit-Schloss hält der Aufrufer ($(date +%T))" >&2
else
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  echo "warte auf das Echtzeit-Schloss ... ($(date +%T))" >&2
  flock -w 7200 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
  echo "Echtzeit-Schloss erhalten ($(date +%T))" >&2
  export CYPHERDJ_SCHLOSS=gehalten
fi

wiederhole() {  # <name> <befehl ...>: bis zu 3 Versuche, solange das Instrument unbrauchbar meldet (Rückgabe 2); der
  local name=$1 v rc; shift  # Ordner eines unbrauchbaren Versuchs bleibt als <name>.unbrauchbar<v> liegen (Beleg)
  for v in 1 2 3; do
    "$@"; rc=$?
    echo "$name Versuch $v Rückgabe $rc" >> "$AUS/laeufe.txt"
    [ "$rc" != 2 ] && return 0
    [ -d "$AUS/$name" ] && mv "$AUS/$name" "$AUS/$name.unbrauchbar$v"
  done
}
Z=$K/tests/ziel
"$Z/folgen_lauf.sh" "$K/build/cypherdj-kern" "$AUS" folgen08;                       echo "folgen08 $?" >> "$AUS/laeufe.txt"
"$Z/folgen_lauf.sh" "$K/build/cypherdj-kern" "$AUS" karte_voll "$Z/karte_voll.jsonl"; echo "karte_voll $?" >> "$AUS/laeufe.txt"
KERN_ARGS="" "$Z/folgen_lauf.sh" "$KERN01" "$AUS" folgen01;                         echo "folgen01 $?" >> "$AUS/laeufe.txt"
"$Z/folgen_lauf.sh" "$K/build/cypherdj-kern-mutation-rampe" "$AUS" folgen_mut \
  "$DJK/vertrag/folgen/uhr_golden.jsonl";                                            echo "folgen_mut $?" >> "$AUS/laeufe.txt"
wiederhole klick_rampe "$Z/klick_rampe_lauf.sh" "$K/build/cypherdj-kern" "$AUS" klick_rampe
wiederhole klick_rampe_mut "$Z/klick_rampe_lauf.sh" "$K/build/cypherdj-kern-mutation-rampe" "$AUS" klick_rampe_mut
wiederhole luecken_last "$Z/luecken_lauf.sh" "$K/build/cypherdj-kern" "$AUS" luecken_last 120 einige \
  --test-last-alle 500 --test-last-perioden 1.5
wiederhole luecken_halb "$Z/luecken_lauf.sh" "$K/build/cypherdj-kern" "$AUS" luecken_halb 120 keine \
  --test-last-alle 500 --test-last-perioden 0.5
wiederhole ruhelauf "$Z/luecken_lauf.sh" "$K/build/cypherdj-kern" "$AUS" ruhelauf 1280 keine
[ -e /proc/self/fd/9 ] && flock -u 9
python3 "$Z/bericht.py" "$AUS"
