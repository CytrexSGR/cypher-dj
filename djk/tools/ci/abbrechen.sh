#!/usr/bin/env bash
# Stops a running CI job on the runner host completely (run it there, e.g. over ssh):
#   djk/tools/ci/abbrechen.sh
# 1. the step scripts: every ruhig_pakete.sh, im_container.sh and alles.sh process (the quiet stage step runs with always() after a red pool, so it is
#    stopped too), the shells above them that only run the step (bash/sh up to, not including, the runner), and their children;
# 2. every container cdjci-<pid> (the ones im_container.sh starts: podman stop -t 5, the cache volumes cdjci-* stay);
# 3. whatever of the processes is still alive after ABBRECHEN_WARTE seconds (default 5) gets KILL.
# Prints one line per process and container it stopped, then a count. Exit 0 (also when nothing was running), 1 when something survived.
# It never touches its own process or the shells above it (the ssh session that started it). Test hooks: ABBRECHEN_KILL (the kill command, default the builtin).
set -u
KILL=${ABBRECHEN_KILL:-kill}
WARTE=${ABBRECHEN_WARTE:-5}
MUSTER='(^|/)(ruhig_pakete|im_container|alles)\.sh( |$)'

# own process and its ancestors: never stopped
SELBST=" $$ "
p=$$
while [ "${p:-0}" -gt 1 ]; do
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  [ -n "$p" ] && SELBST="$SELBST$p "
done
geschuetzt() { case "$SELBST" in *" $1 "*) return 0 ;; esac; return 1; }

# a process of the job is a shell above it when it is bash or sh (the step's script), not the runner
ist_shell() { case "$(ps -o comm= -p "$1" 2>/dev/null | tr -d ' ')" in bash|sh) return 0 ;; esac; return 1; }

ZIELE=(); SCHALEN=()
vormerken() { local x; for x in "${ZIELE[@]:-}" "${SCHALEN[@]:-}"; do [ "$x" = "$1" ] && return 0; done; ZIELE+=("$1"); }
vormerken_schale() { local x; for x in "${ZIELE[@]:-}" "${SCHALEN[@]:-}"; do [ "$x" = "$1" ] && return 0; done; SCHALEN+=("$1"); }
for pid in $(pgrep -f "$MUSTER" 2>/dev/null); do
  geschuetzt "$pid" && continue
  vormerken "$pid"
  # the shells above it: the step's bash, until something that is not a shell
  a=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  while [ -n "$a" ] && [ "$a" -gt 1 ] && ! geschuetzt "$a" && ist_shell "$a"; do vormerken_schale "$a"; a=$(ps -o ppid= -p "$a" 2>/dev/null | tr -d ' '); done
done
# children first (a stopped parent must not start the next command): the scripts newest-first, then the shells above them, innermost first
ALLE_PIDS=()
for ((i = ${#ZIELE[@]} - 1; i >= 0; i--)); do [ -z "${ZIELE[$i]}" ] || ALLE_PIDS+=("${ZIELE[$i]}"); done
for x in "${SCHALEN[@]:-}"; do [ -z "$x" ] || ALLE_PIDS+=("$x"); done
gestoppt=0
beschreibung() { ps -o args= -p "$1" 2>/dev/null | cut -c1-100; }
for pid in "${ALLE_PIDS[@]:-}"; do
  [ -n "$pid" ] || continue
  echo "stop process $pid: $(beschreibung "$pid")"
  "$KILL" -TERM "$pid" 2>/dev/null && gestoppt=$((gestoppt + 1))
done

CONT=$(podman ps --format '{{.Names}}' 2>/dev/null | grep -E '^cdjci-[0-9]+$')
for c in $CONT; do
  echo "stop container $c"
  podman stop -t 5 "$c" >/dev/null 2>&1 && gestoppt=$((gestoppt + 1))
done

sleep "$WARTE"
rest=0
for pid in "${ALLE_PIDS[@]:-}"; do
  [ -n "$pid" ] || continue
  if "$KILL" -0 "$pid" 2>/dev/null; then echo "kill process $pid (still alive)"; "$KILL" -KILL "$pid" 2>/dev/null; sleep 1; "$KILL" -0 "$pid" 2>/dev/null && rest=$((rest + 1)); fi
done
for c in $(podman ps --format '{{.Names}}' 2>/dev/null | grep -E '^cdjci-[0-9]+$'); do
  echo "kill container $c (still running)"; podman kill "$c" >/dev/null 2>&1 || rest=$((rest + 1))
done
echo "stopped: $gestoppt (processes ${#ALLE_PIDS[@]}, containers $(echo "$CONT" | grep -c .)); survivors: $rest"
[ "$rest" = 0 ]
