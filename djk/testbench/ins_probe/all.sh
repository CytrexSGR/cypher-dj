#!/bin/bash
# all.sh: the whole task-1 measurement series, one chunk per lock hold (both locks, see README).
D=$(cd "$(dirname "$0")" && pwd)
# first lock: the machine-wide timing lock (override with CYPHERDJ_TIMING_LOCK; default: a per-user folder in /tmp)
L1=${CYPHERDJ_TIMING_LOCK:-/tmp/claude-$(id -u)/cypher-echtzeit.lock}
mkdir -p "$(dirname "$L1")"
L2=$(cd "$D/../../config" && pwd)/.echtzeit.lock
for chunk in "matrix aeq" "matrix ceq" "matrix acomp" "step3 aeq" "step3 ceq" "step3 acomp" "leer" "gate" "pfad" "ordnung aeq" "ordnung ceq" "ordnung acomp"; do
  echo "##### $chunk $(date +%T)"
  flock "$L1" flock "$L2" python3 "$D/messlauf.py" $chunk
done
echo "##### fertig $(date +%T)"
