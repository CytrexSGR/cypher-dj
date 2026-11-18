#!/usr/bin/env bash
# djk-stop removes neustart_stand.json together with the core state (task: persistence card t_7f487235, round 3). The file in the hotcue folder
# is only good for the kern life that wrote it; the core state in /dev/shm survives neither a PC reboot nor djk-stop, so after a stop the file
# must go too. The real djk-stop runs against stubs (systemctl, pactl, fuser on PATH), a temp HOME, a temp CYPHERDJ_HEIM and a temp
# shm base (DJK_SHM_BASIS): no real unit, no real file, no real /dev/shm is touched.
# Aufruf: tests/test_restart_state.sh
#   N1 production: the file in the resolved hotcue folder (new place, under CYPHERDJ_HEIM) is removed, neighbours stay
#   N2 production with the old hotcue folder present (~/.config/cypherdj/hotcues, the old place wins in the table): that file is removed
#   N3 test instance e: only its own file (<shm>/cypherdj-e/hotcues) is removed; other instances and production stay
#   N4 production stop leaves a test instance's file alone
#   N5 no file there: djk-stop still ends with 0
#   N6 the call sits behind the core-state loop in djk-stop
#   N7 the core-state loop removes only under DJK_SHM_BASIS
#   N8 no real file (core state, hotcue file, start.env) changed; a static guard aborts before any run if djk-stop has a literal /dev/shm path
# Rückgabe: 0 alle Punkte OK, 1 mindestens einer FEHL.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-neustart-stand-test.XXXX")
trap 'rm -rf "$O"' EXIT
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
# GUARD (2026-11-18: an earlier version of this test deleted the REAL studio core state, because djk-stop's core-state loop had a
# literal /dev/shm path that DJK_SHM_BASIS did not reach). Before anything runs: every code line of djk-stop that names /dev/shm must
# be the one default line SHM=${DJK_SHM_BASIS:-/dev/shm}; any other one aborts the test without running djk-stop.
LECK=$(grep -n '/dev/shm' "$START/djk-stop" | grep -v '^[0-9]*:[[:space:]]*#' | grep -v '^[0-9]*:SHM=\${DJK_SHM_BASIS:-/dev/shm}')
if [ -n "$LECK" ]; then echo "ABBRUCH: djk-stop has a /dev/shm path outside DJK_SHM_BASIS, the test would touch the real studio:"; echo "$LECK"; exit 1; fi
# the real files this test must never touch: stamped before, compared after (any change = FEHL)
echt() { for f in /dev/shm/cypherdj*/zustand /dev/shm/cypherdj*/bus /dev/shm/cypherdj*/kanten /dev/shm/cypherdj*/neustarts \
    /dev/shm/cypherdj*/hotcues/neustart_stand.json "$HOME"/.config/cypherdj/hotcues/neustart_stand.json \
    "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"/cypherdj*/start.env; do [ -e "$f" ] && stat -c '%n %i %s %Y' "$f"; done 2>/dev/null; }
VORHER=$(echt)
mkdir -p "$O/bin" "$O/heim" "$O/home" "$O/shm" "$O/run"
for s in systemctl pactl fuser; do printf '#!/usr/bin/env bash\nexit 1\n' > "$O/bin/$s"; chmod +x "$O/bin/$s"; done
# a stop of the given instance ('' = production) in the temp world
stopp() {
  env -i PATH="$O/bin:$PATH" HOME="$O/home" XDG_RUNTIME_DIR="$O/run" CYPHERDJ_HEIM="$O/heim" CYPHERDJ_UMGEBUNG="$O/keine.env" \
    DJK_SHM_BASIS="$O/shm" "$START/djk-stop" --instanz "$1" --still
}
datei() { mkdir -p "$(dirname "$1")"; echo '{"v":1}' > "$1"; }
NEU="$O/heim/werke/korrekturen/hotcues"; ALT="$O/home/.config/cypherdj/hotcues"
# N1
datei "$NEU/neustart_stand.json"; datei "$NEU/aktive_loops.json"
stopp ""; R=$?
[ "$R" = 0 ] && [ ! -e "$NEU/neustart_stand.json" ] && [ -e "$NEU/aktive_loops.json" ]
pruef $? "N1 production: neustart_stand.json removed, aktive_loops.json stays (rc $R)"
# N3 and N4 first with a production file present
datei "$NEU/neustart_stand.json"
for i in b e; do datei "$O/shm/cypherdj-$i/hotcues/neustart_stand.json"; datei "$O/shm/cypherdj-$i/hotcues/aktive_loops.json"; done
stopp e; R=$?
[ "$R" = 0 ] && [ ! -e "$O/shm/cypherdj-e/hotcues/neustart_stand.json" ] && [ -e "$O/shm/cypherdj-e/hotcues/aktive_loops.json" ] \
  && [ -e "$O/shm/cypherdj-b/hotcues/neustart_stand.json" ] && [ -e "$NEU/neustart_stand.json" ]
pruef $? "N3 instance e: only its own file removed, instance b and production untouched (rc $R)"
stopp ""; R=$?
[ "$R" = 0 ] && [ ! -e "$NEU/neustart_stand.json" ] && [ -e "$O/shm/cypherdj-b/hotcues/neustart_stand.json" ]
pruef $? "N4 production stop removes its file and leaves instance b's (rc $R)"
# N2 old place present
datei "$ALT/neustart_stand.json"; datei "$ALT/aktive_loops.json"
stopp ""; R=$?
[ "$R" = 0 ] && [ ! -e "$ALT/neustart_stand.json" ] && [ -e "$ALT/aktive_loops.json" ]
pruef $? "N2 production with the old hotcue folder: file there removed, neighbour stays (rc $R)"
# N5 nothing there
rm -f "$ALT/neustart_stand.json" "$NEU/neustart_stand.json"; stopp ""; R1=$?; stopp e; R2=$?; stopp d; R3=$?
[ "$R1" = 0 ] && [ "$R2" = 0 ] && [ "$R3" = 0 ]
pruef $? "N5 no file: rc $R1 $R2 $R3"
# N6 order in the script text: the call comes after the core-state loop
A=$(grep -n 'removed core state' "$START/djk-stop" | head -1 | cut -d: -f1); B=$(grep -n '^neustart_stand_weg$' "$START/djk-stop" | head -1 | cut -d: -f1)
[ -n "$A" ] && [ -n "$B" ] && [ "$B" -gt "$A" ]
pruef $? "N6 neustart_stand_weg is called after the core-state loop (lines ${A:-none}, ${B:-none})"
# N7 the core-state loop works in the temp shm base (the fuser stub says "not held")
datei "$O/shm/cypherdj-e/zustand"; datei "$O/shm/cypherdj-e/kanten"; stopp e; R=$?
[ "$R" = 0 ] && [ ! -e "$O/shm/cypherdj-e/zustand" ] && [ ! -e "$O/shm/cypherdj-e/kanten" ]
pruef $? "N7 instance e: core state removed under the temp shm base (rc $R)"
# N8 nothing real was touched
NACHHER=$(echt)
[ "$VORHER" = "$NACHHER" ]
pruef $? "N8 real core state, hotcue files and start.env unchanged$( [ "$VORHER" = "$NACHHER" ] || printf ': %s' "$(diff <(echo "$VORHER") <(echo "$NACHHER") | tr '\n' ' ')")"
echo "Ergebnis: $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
