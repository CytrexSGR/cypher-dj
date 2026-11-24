#!/usr/bin/env bash
# Test for the cypher-dj launcher: stubs for djk-start, djk-stop, djk-starter, pactl and curl in a temp root; nothing
# real is started, no unit is touched, no request leaves the machine.
# Usage: djk/start/tests/test_cypher_dj.sh   (exit 0 all OK, 1 at least one FAIL)
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
LAUNCHER=$(cd "$HIER/.." && pwd)/cypher-dj
T=$(mktemp -d "${TMPDIR:-/tmp}/cypher-dj-test.XXXX")
trap 'rm -rf "$T"' EXIT
OK=0; FAIL=0
check() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FAIL $2"; FAIL=$((FAIL + 1)); fi; }

# Layout like the package: <root>/djk/start/{cypher-dj,stubs}, <root>/djk/hand/hand.ts, /usr/bin symlink stand-in.
ROOT="$T/opt/cypher-dj"
mkdir -p "$ROOT/djk/start" "$ROOT/djk/hand" "$T/bin" "$T/stubbin" "$T/home"
cp "$LAUNCHER" "$ROOT/djk/start/cypher-dj" 2>/dev/null || true
cp "$(dirname "$LAUNCHER")/orte.sh" "$ROOT/djk/start/orte.sh"   # the launcher sources it (package spec D4 to D6)
chmod +x "$ROOT/djk/start/cypher-dj" 2>/dev/null || true
ln -s "$ROOT/djk/start/cypher-dj" "$T/bin/cypher-dj"
LOG="$T/log"
for s in djk-start djk-stop djk-starter djk-doctor djk-bericht; do
  cat > "$ROOT/djk/start/$s" <<STUB
#!/usr/bin/env bash
echo "$s \$*" >> "$LOG"
if [ "$s" = djk-start ] && [ "\${1:-}" = --zustand ]; then exit "\${STUB_ZUSTAND_RC:-1}"; fi
if [ "$s" = djk-doctor ]; then exit "\${STUB_DOCTOR_RC:-0}"; fi
exit 0
STUB
  chmod +x "$ROOT/djk/start/$s"
done
cat > "$T/stubbin/pactl" <<STUB
#!/usr/bin/env bash
echo "pactl \$*" >> "$LOG"
[ "\${STUB_PACTL_FAIL:-0}" = 1 ] && exit 1
echo "\${STUB_SINK-alsa_output.test}"
STUB
cat > "$T/stubbin/curl" <<STUB
#!/usr/bin/env bash
echo "curl \$*" >> "$LOG"
[ "\${STUB_CURL_TIMEOUT:-0}" = 1 ] && exit 28
case "\$*" in
  *proj/oeffnen*) body=\${STUB_OEFFNEN_BODY-'{"slug":"demo","rev":1}'}; code=\${STUB_OEFFNEN_CODE:-200};;
  *) body=\${STUB_TRANSPORT_BODY-'{"ok":true,"quittung":{"status":0}}'}; code=\${STUB_TRANSPORT_CODE:-200};;
esac
printf '%s\n%s' "\$body" "\$code"
STUB
chmod +x "$T/stubbin/pactl" "$T/stubbin/curl"

CJ="$T/bin/cypher-dj"
run() { : > "$LOG"; PATH="$T/stubbin:$PATH" HOME="$T/home" CYPHERDJ_UID=${CYPHERDJ_UID:-1000} "$@" > "$T/out" 2> "$T/err"; RC=$?; }

# anchor: the launcher must exist
[ -x "$LAUNCHER" ]; check $? "launcher exists and is executable"
[ -x "$ROOT/djk/start/cypher-dj" ] || { echo "no launcher, stopping"; echo "$OK OK, $FAIL FAIL"; exit 1; }

# start with sink, without Surge
run "$CJ" start
[ "$RC" = 0 ]; check $? "start rc 0 (rc $RC)"
grep -qx "djk-starter " "$LOG"; check $? "start runs djk-starter"
grep -qx "djk-start --master alsa_output.test:playback_F --ohne-cue --ton-frei --strudel --instrumente --bk-stroeme --melodie baukasten --bass rb338" "$LOG"
check $? "start args: sink, no Surge adds baukasten/rb338"

# with Surge
mkdir -p "$T/home/.local/lib/cypherdj/lv2/Surge XT.lv2"; : > "$T/home/.local/lib/cypherdj/lv2/Surge XT.lv2/manifest.ttl"
run "$CJ" start
grep -qx "djk-start --master alsa_output.test:playback_F --ohne-cue --ton-frei --strudel --instrumente --bk-stroeme" "$LOG"
check $? "start args with Surge: no melodie/bass override"
rm -rf "$T/home/.local"

# no sink: empty, and pactl failing
STUB_SINK="" run "$CJ" start
grep -q '^djk-start ' "$LOG" && ! grep -q -- '--master\|--ton-frei' "$LOG"
check $? "no sink (empty): no --master/--ton-frei"
grep -qi "silent" "$T/out" "$T/err"; check $? "no sink (empty): a line says silent sink"
STUB_PACTL_FAIL=1 run "$CJ" start
grep -q '^djk-start ' "$LOG" && ! grep -q -- '--master\|--ton-frei' "$LOG"
check $? "no sink (pactl fails): no --master/--ton-frei"
grep -qi "silent" "$T/out" "$T/err"; check $? "no sink (pactl fails): a line says silent sink"

# already running
STUB_ZUSTAND_RC=0 run "$CJ" start
[ "$RC" = 0 ] && grep -q "already running" "$T/out" && ! grep -q '^djk-start --master\|^djk-starter' "$LOG"
check $? "already running: rc 0, says so, starts nothing"

# root refusal
CYPHERDJ_UID=0 run "$CJ" start
[ "$RC" = 2 ] && [ "$(cat "$T/out" "$T/err" | wc -l)" = 1 ] && ! grep -q '^djk-start\|^djk-starter' "$LOG"
check $? "root: rc 2, one line, nothing started (rc $RC)"

# stop / status pass through
run "$CJ" stop; grep -qx "djk-stop " "$LOG"; check $? "stop calls djk-stop"
run "$CJ" status; grep -qx "djk-start --zustand" "$LOG"; check $? "status calls djk-start --zustand"

# demo
run "$CJ" demo
[ "$RC" = 0 ] && grep -q 'curl .*127.0.0.1:47300/proj/oeffnen' "$LOG" && grep -q '"slug":"demo"' "$LOG" \
  && grep -q 'curl .*127.0.0.1:47300/proj/transport' "$LOG" && grep -q '"aktion":"start"' "$LOG" \
  && grep -q 'application/json' "$LOG" && grep -q 'http://127.0.0.1:47300/' "$T/out"
check $? "demo: open demo, transport start, JSON content type, prints page URL (rc $RC)"

# demo failure paths
STUB_TRANSPORT_BODY='{"ok":false,"quittung":{"status":7,"grund":"ki_stopp"}}' run "$CJ" demo
[ "$RC" = 1 ] && grep -q '"ok":false' "$T/err" && ! grep -q "plays" "$T/out"
check $? "demo: transport ok:false -> rc 1, answer shown, no success line (rc $RC)"
STUB_OEFFNEN_CODE=409 STUB_OEFFNEN_BODY='{"fehler":"live_laeuft"}' run "$CJ" demo
[ "$RC" = 1 ] && grep -q "a live set is playing" "$T/err" && ! grep -q 'proj/transport' "$LOG"
check $? "demo: 409 live_laeuft -> understandable line, rc 1, no transport call (rc $RC)"
STUB_OEFFNEN_CODE=500 STUB_OEFFNEN_BODY='{"fehler":"boom"}' run "$CJ" demo
[ "$RC" = 1 ] && grep -q boom "$T/err" && ! grep -q 'proj/transport' "$LOG"
check $? "demo: open fails -> rc 1 with answer, no transport call"
STUB_CURL_TIMEOUT=1 run "$CJ" demo
[ "$RC" = 1 ] && grep -q "does not answer" "$T/err"
check $? "demo: timeout -> rc 1, says studio does not answer"
run "$CJ" demo
grep -q -- '--max-time 30 .*proj/oeffnen' "$LOG" && grep -q -- '--max-time 10 .*proj/transport' "$LOG"
check $? "demo: curl --max-time 30 (open) and 10 (transport)"

# mcp
run "$CJ" mcp
python3 -I - "$T/out" "$ROOT" <<'PY'
import json, sys
lines = open(sys.argv[1]).read().splitlines()
assert len(lines) == 1, lines
d = json.loads(lines[0])
c = d["cypher-dj"]
assert c["args"] == [sys.argv[2] + "/djk/hand/hand.ts"], c
assert c["command"] == "/usr/bin/node", c
PY
check $? "mcp: one JSON line, names the temp root via symlink, node /usr/bin/node"
mkdir -p "$ROOT/node/bin"; : > "$ROOT/node/bin/node"; chmod +x "$ROOT/node/bin/node"
run "$CJ" mcp
grep -q "\"command\":\"$ROOT/node/bin/node\"" "$T/out"; check $? "mcp: bundled node preferred"
CYPHERDJ_NODE=/opt/x/node run "$CJ" mcp
grep -q '"command":"/opt/x/node"' "$T/out"; check $? "mcp: CYPHERDJ_NODE wins"

# mcp with a quote and a backslash in the root path
QROOT="$T/q\"x\\y"
mkdir -p "$QROOT/djk/start" "$QROOT/djk/hand"
cp "$ROOT/djk/start/cypher-dj" "$QROOT/djk/start/cypher-dj"
run "$QROOT/djk/start/cypher-dj" mcp
python3 -I - "$T/out" "$QROOT" <<'PY'
import json, sys
d = json.loads(open(sys.argv[1]).read())
assert d["cypher-dj"]["args"] == [sys.argv[2] + "/djk/hand/hand.ts"], d
PY
check $? "mcp: root with quote and backslash still parses as JSON and names the root"

# doctor: arguments pass through, the stub's exit code is the launcher's
run "$CJ" doctor --instanz i; [ "$RC" = 0 ] && grep -qx "djk-doctor --instanz i" "$LOG"; check $? "doctor: passes --instanz i through (rc $RC)"
STUB_DOCTOR_RC=1 run "$CJ" doctor; [ "$RC" = 1 ]; check $? "doctor: returns the doctor's exit code 1 (rc $RC)"

# report: arguments pass through
run "$CJ" report --ohne-journal --instanz d; [ "$RC" = 0 ] && grep -qx "djk-bericht --ohne-journal --instanz d" "$LOG"; check $? "report: passes its flags through (rc $RC)"
run "$CJ" help; grep -q "report" "$T/out"; check $? "help names report"

# unknown / help
run "$CJ" frobnicate; [ "$RC" = 2 ] && grep -q "start" "$T/out" "$T/err"; check $? "unknown command: help, rc 2 (rc $RC)"
run "$CJ"; [ "$RC" = 2 ]; check $? "no command: rc 2 (rc $RC)"
run "$CJ" help; [ "$RC" = 0 ] && grep -q "demo" "$T/out" && grep -q "doctor" "$T/out"; check $? "help: rc 0"

echo "$OK OK, $FAIL FAIL"
[ "$FAIL" = 0 ]
