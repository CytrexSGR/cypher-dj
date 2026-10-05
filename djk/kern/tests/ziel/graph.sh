# Gemeinsame Schritte der Läufe am Graphen (Scheibe 08), zum Einbinden mit `. graph.sh`. Übernommen aus
# djk/pruefstand/klick/lauf.sh (Scheibe 01): erst wenn die Notbahn an der eigenen Senke hängt, treibt diese Senke die
# Gruppe cypherdj-<i>, und erst dann darf der Kern starten (ein früher gestarteter Kern ohne eigene Ports landete kurz
# am Standard-Treiber und zwänge ihm Quantum 256 auf). Danach hält meta.txt fest, wer den Graphen treibt und welche
# eigenen Knoten leben; auswertung.py (01) liest das mit graph_pruefen.
# Braucht CYPHERDJ_INSTANZ und SENKE.

# notbahn_verbinden <meta>: wartet bis 5 s, bis cypherdj-notbahn-<i>:master_L an <SENKE>:playback_FL hängt.
# Schreibt notbahn_verbunden=ja|nein nach <meta>; Rückgabe 0 nur bei ja.
notbahn_verbinden() {
  local v=nein
  for _ in $(seq 1 50); do
    pw-link -l | grep -A1 -x "cypherdj-notbahn-$CYPHERDJ_INSTANZ:master_L" | grep -q -- "|-> $SENKE:playback_FL" && { v=ja; break; }
    sleep 0.1
  done
  echo "notbahn_verbunden=$v" >> "$1"
  [ "$v" = ja ]
}

# graph_festhalten <meta> <knoten ...>: pw-top (Rahmen 2 und 3, alle cypherdj-Knoten, auch fremder Instanzen; der erste
# Rahmen hat noch keine Zahlen, und unter Last kam Rahmen 2 in der Plan-Probe unvollständig, darum drei Rahmen und 6 s),
# je Knoten die Zahl der lebenden cypherdj-<knoten>-<i>, die Verbindungen der eigenen Senke. graph_pruefen (01) wertet
# die letzte Zeile der Senke aus.
graph_festhalten() {
  local meta=$1 k; shift
  { echo "== pw-top"; timeout 6 pw-top -b -n 3 2>/dev/null | awk '/QUANT/{n++} n>=2' | grep -E "QUANT|cypherdj-"
    echo "== knoten"; for k in "$@"; do echo "$k=$(pw-cli ls Node | grep -c "node.name = \"cypherdj-$k-$CYPHERDJ_INSTANZ\"")"; done
    echo "== pw-link"; pw-link -l | grep -A2 -E "^cypherdj-(notbahn|aufnehmer)-$CYPHERDJ_INSTANZ|^$SENKE"; } >> "$meta"
}
