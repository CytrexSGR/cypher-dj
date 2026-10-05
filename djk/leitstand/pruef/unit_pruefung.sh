#!/usr/bin/env bash
# Prüft djk/units/cypherdj-leitstand.service, nur transient (nie enable, ROADMAP §8.4), gegen den Taktgeber der Tests:
#  U1 systemd-analyze verify meldet nichts;
#  U2 Start: Unit aktiv, Journal beginnt mit set_start, noch kein Neustart (Negativ-Kontrolle);
#  U3 Fehlerfall kill -9: systemd startet nach RestartSec neu, das Journal läuft mit genau einer fortsetzung weiter;
#  U4 systemctl stop: letzte Journalzeile /k/tschuess, kein Leitstand-Prozess übrig;
#  U5 Fehlerfall Konfigurationsfehler: Rückgabe 2, kein Neustart (RestartPreventExitStatus=2).
# Aufruf: CYPHERDJ_INSTANZ=c pruef/unit_pruefung.sh     Rückgabe 0 = alle Punkte grün, 1 sonst.
set -uo pipefail
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen, Strang C: export CYPHERDJ_INSTANZ=c}"
HIER=$(cd "$(dirname "$0")" && pwd)
LS=$(cd "$HIER/.." && pwd)
export DJK; DJK=$(cd "$LS/.." && pwd)
K=$(( $(printf '%d' "'$CYPHERDJ_INSTANZ") - 96 )); V=$(( 1000 * K ))
TG_PORT=$((47180 + V))           # Taktgeber an Stelle des Kerns
SET=2026-09-23_1200
T=$(mktemp -d "${TMPDIR:-/tmp}/djk12-unit.XXXXXX")
J=$T/sets/$SET/journal.jsonl
FEHL=0
ok() { if [ "$1" = 0 ]; then echo "OK   $2"; else echo "FEHL $2"; FEHL=1; fi; }
eigenschaft() { systemctl --user show -p "$2" --value "$1"; }

node "$LS/tests/hilfen/taktgeber.ts" --port "$TG_PORT" > "$T/tg.out" 2>&1 & TG=$!
trap 'kill $TG 2>/dev/null; systemctl --user stop cypherdj-leitstand-$CYPHERDJ_INSTANZ-u1 2>/dev/null; \
  systemctl --user reset-failed cypherdj-leitstand-$CYPHERDJ_INSTANZ-u1 cypherdj-leitstand-$CYPHERDJ_INSTANZ-u2 2>/dev/null' EXIT
printf 'version = 1\nws_port = 47280\nabo_port = 47181\nsets = "%s/sets"\n' "$T" > "$T/leitstand.toml"
printf 'version = 1\nws_prot = 47280\n' > "$T/falsch.toml"
sleep 0.5

n=$(systemd-analyze --user verify "$DJK/units/cypherdj-leitstand.service" 2>&1 | wc -l)
ok "$([ "$n" = 0 ]; echo $?)" "U1 systemd-analyze verify: $n Meldungen"

U1=$("$HIER/unit_probe.sh" "$CYPHERDJ_INSTANZ" u1 --konfig "$T/leitstand.toml" --kern-port "$TG_PORT" --set-id "$SET")
sleep 3
a=$(eigenschaft "$U1" ActiveState); r=$(eigenschaft "$U1" NRestarts); erste=$(head -1 "$J" 2>/dev/null | grep -o '"typ":"[a-z_]*"')
ok "$([ "$a" = active ] && [ "$r" = 0 ] && [ "$erste" = '"typ":"set_start"' ]; echo $?)" \
  "U2 Start: $a, NRestarts $r, erste Zeile $erste"

pid=$(eigenschaft "$U1" MainPID); kill -9 "$pid"; sleep 3
a=$(eigenschaft "$U1" ActiveState); r=$(eigenschaft "$U1" NRestarts); neu=$(eigenschaft "$U1" MainPID)
f=$(grep -c '"typ":"fortsetzung"' "$J")
ok "$([ "$a" = active ] && [ "$r" = 1 ] && [ "$neu" != "$pid" ] && [ "$f" = 1 ]; echo $?)" \
  "U3 kill -9 PID $pid: $a, NRestarts $r, neue PID $neu, fortsetzung $f"

systemctl --user stop "$U1"; sleep 0.5
letzte=$(tail -1 "$J" | grep -o '"typ":"[a-z_/]*"'); rest=$(pgrep -f "[s]rc/leitstand.ts --konfig $T" | wc -l)
ok "$([ "$letzte" = '"typ":"/k/tschuess"' ] && [ "$rest" = 0 ]; echo $?)" "U4 stop: letzte Zeile $letzte, Prozesse übrig $rest"

U2=$("$HIER/unit_probe.sh" "$CYPHERDJ_INSTANZ" u2 --konfig "$T/falsch.toml" --kern-port "$TG_PORT")
sleep 3
s=$(eigenschaft "$U2" ExecMainStatus); r=$(eigenschaft "$U2" NRestarts); a=$(eigenschaft "$U2" ActiveState)
ok "$([ "$s" = 2 ] && [ "$r" = 0 ] && [ "$a" = failed ]; echo $?)" "U5 Konfigurationsfehler: Rückgabe $s, NRestarts $r, $a"
systemctl --user reset-failed "$U2" 2>/dev/null
exit $FEHL
