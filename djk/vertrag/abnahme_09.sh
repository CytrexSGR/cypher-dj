#!/usr/bin/env bash
# Abnahme Scheibe 09 (vertrag-schemas-folgen), ohne die 60-s-Ratenmessung (die läuft getrennt unter dem Echtzeit-
# Schloss: flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" python3 djk/vertrag/messe_ringrate.py --dauer 60).
# Aufruf: bash djk/vertrag/abnahme_09.sh [WURZEL]   (Vorgabe WURZEL = ~/cypher-dj)
# Rückgabe 0 nur, wenn jeder Punkt so ausgeht wie erwartet: Prüfungen grün (rc 0), jeder Fehlerfall rot (rc 1).
set -u
WURZEL=${1:-$HOME/cypher-dj}
V=$WURZEL/djk/vertrag
TEXT=$WURZEL/docs/architektur/SCHNITTSTELLEN.md
mkdir -p "${TMPDIR:-/tmp}"
T=$(mktemp -d "${TMPDIR:-/tmp}/djk09-abnahme.XXXXXX")
fehler=0
punkt() {   # punkt <name> <erwarteter rc> <befehl...>
  local name=$1 soll=$2; shift 2
  local aus rc
  aus=$("$@" 2>&1); rc=$?
  if [ "$rc" = "$soll" ]; then echo "OK     $name (rc=$rc)"; else echo "FALSCH $name (rc=$rc, erwartet $soll)"; fehler=1; fi
  printf '%s\n' "$aus" | grep -E '^(Abnahme-|Beispiele am|geprüft:|§6.2 laut|§19.3 nennt|Vertragsanker|[0-9]+ Folgen im|FEHLER|ROT|GRÜN|ERGEBNIS|[0-9]+ passed|[0-9]+ failed)' \
    | sed 's/^/       /' | head -12
}
echo "Fremdlast vorher (1/5/15 min): $(cut -d' ' -f1-3 /proc/loadavg)"
punkt "Tests djk/vertrag/tests (Scheiben 02 und 09)" 0 python3 -m pytest -q "$V/tests" -p no:cacheprovider
punkt "02 unverändert: osc.json gegen den Vertragstext" 0 python3 "$V/pruefe_osc.py"
punkt "Schemas gegen die Beispiele im Vertragstext" 0 python3 "$V/pruefe_schemas.py"
echo "Gegenprobe Zählung am Text (awk, unabhängig von vertrag_beispiele.py), Abschnitte §6.5 §9.1 §12.1 §12.2 §13.3 §14.x:"
awk '
/^## [0-9]+\. /{split($2,a,"."); s=a[1]; next}
/^### [0-9]+\.[0-9]+ /{s=$2; next}
{ if (s=="6.5"||s=="9.1"||s=="12.1"||s=="12.2"||s=="13.3"||s ~ /^14\./) {
    if ($0 ~ /^```json/) {n++; next}
    if ($0 ~ /^```/) next
    z=$0; while (match(z, /`\{/)) { vor = (RSTART > 1) ? substr(z, RSTART-1, 1) : ""; if (vor != "`") n++; z=substr(z, RSTART+2) } } }
END { print "       " n " JSON-Beispiele am Text" }' "$TEXT"
sed 's/"baender_db":\[-28.3,-29.3,-28.6,-31.5,-28.2,-24.9\],"urteil":"ok","gruende":\[\]}/"baender_db":[-28.3,-29.3,-28.6,-31.5,-28.2,-24.9],"gruende":[]}/' \
  "$TEXT" > "$T/vertrag_ohne_urteil.md"
punkt "Fehlerfall: §14.5-Beispiel ohne Pflichtfeld urteil" 1 python3 "$V/pruefe_schemas.py" --vertrag "$T/vertrag_ohne_urteil.md"
punkt "baender.json gegen §6.2 (scipy, -3 dB ±2 %)" 0 python3 "$V/pruefe_baender.py"
python3 - "$V" "$T/baender_33hz.json" <<'EOF'
import json, sys
sys.path.insert(0, sys.argv[1])
import erzeuge_baender as eb
d = eb.baue()
d["baender"][0]["sos"] = [[float(v) for v in z] for z in eb.band_sos(33.0, 90.0)]
open(sys.argv[2], "w").write(json.dumps(d))
EOF
punkt "Fehlerfall: Sub-Band unten auf 33 Hz verschoben" 1 python3 "$V/pruefe_baender.py" "$T/baender_33hz.json"
punkt "Golden-Folgen voll (Herleitung, Form, Anker, Abdeckung, 02-Prüfung)" 0 python3 "$V/pruefe_golden.py" --voll
cp -r "$V/folgen" "$T/folgen_mut"
sed -i 's/"wert":-7.5,/"wert":-7.4,/' "$T/folgen_mut/teil_rampe.jsonl"
punkt "Mutationsprobe: teil_rampe Beat 80 = -7,4 statt -7,5" 1 python3 "$V/pruefe_golden.py" --voll --ordner "$T/folgen_mut"
punkt "Grundformat Scheibe 02 über alle Folgen" 0 python3 "$V/pruefe_folgen.py"
echo "Fremdlast nachher (1/5/15 min): $(cut -d' ' -f1-3 /proc/loadavg)"
rm -rf "$T"
[ "$fehler" = 0 ] && echo "ABNAHME OHNE RATENMESSUNG: GRÜN" || echo "ABNAHME OHNE RATENMESSUNG: ROT"
exit $fehler
