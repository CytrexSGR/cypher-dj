#!/usr/bin/env bash
# A test instance never takes a store variable from the owner's umgebung.env, and its units get a copy of that file without them (unit.py
# --umgebungsdatei). The owner's start reads the file exactly as before. The top of djk-start (umgebung.env, --instanz look-ahead, storage table) is cut out
# and run against a throw-away HOME and umgebung.env; no unit starts, nothing real is touched.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd); DJK=$(cd "$START/.." && pwd)
KOPF=$(sed -n '/^UMG=/,/^eval "\$ABLAGE_AUS"/p' "$START/djk-start")
[ -n "$KOPF" ] || { echo "FEHL: head of djk-start not found"; exit 1; }
H=$(mktemp -d "${TMPDIR:-/tmp}/djk-instanz-umgebung.XXXX"); trap 'rm -rf "$H"' EXIT
rc=0; ok() { echo "OK   $1"; }; fehl() { echo "FEHL $1"; rc=1; }
cat > "$H/umgebung.env" <<'ENV'
CYPHERDJ_MEDIATHEK=/mnt/echt/mediathek.sqlite
export CYPHERDJ_KATALOG=/mnt/echt/katalog.sqlite
CYPHERDJ_BK_ORDNER=/home/echt/baukasten
CYPHERDJ_MUSIK=/mnt/echt/musik
CYPHERDJ_DEMUCS_PYTHON=/usr/bin/python3
ENV
lauf() {  # $1 = arguments of djk-start ("--instanz e" or ""), env of the caller from the rest
  local args=$1; shift
  env -i HOME="$H/home" PATH="$PATH" DJK="$DJK" HIER="$START" CYPHERDJ_UMGEBUNG="$H/umgebung.env" "$@" bash -c 'set -uo pipefail; set -- '"$args"'; '"$KOPF"'; echo "MED=${CYPHERDJ_MEDIATHEK:-}|KAT=${CYPHERDJ_KATALOG:-}|BK=${CYPHERDJ_BK_ORDNER:-}|MUSIK=${CYPHERDJ_MUSIK:-}|PY=${CYPHERDJ_DEMUCS_PYTHON:-}|A_MED=$ABLAGE_MEDIATHEK|A_GER=$ABLAGE_GERAETE"'
}
mkdir -p "$H/home"
aus=$(lauf "--instanz e") ; echo "$aus" | sed 's/^/     /'
case "$aus" in *"MED=|KAT=|BK=|MUSIK=/mnt/echt/musik|PY=/usr/bin/python3|A_MED=/dev/shm/cypherdj-e/mediathek/mediathek.sqlite|A_GER=/dev/shm/cypherdj-e/geraete") ok "instance e: store variables of umgebung.env dropped, the others kept, table answers with the instance folders";; *) fehl "instance e";; esac
aus=$(lauf "" CYPHERDJ_INSTANZ=e); case "$aus" in *"MED=|KAT=|BK=|"*"A_GER=/dev/shm/cypherdj-e/geraete") ok "instance from the environment (no option) too";; *) fehl "instance from env: $aus";; esac
aus=$(lauf "--instanz e" CYPHERDJ_MEDIATHEK=/tmp/eigene.sqlite); case "$aus" in "MED=/tmp/eigene.sqlite|KAT=|"*"A_MED=/tmp/eigene.sqlite"*) ok "a variable the caller set itself wins on an instance";; *) fehl "caller variable: $aus";; esac
aus=$(lauf ""); case "$aus" in "MED=/mnt/echt/mediathek.sqlite|KAT=/mnt/echt/katalog.sqlite|BK=/home/echt/baukasten|MUSIK=/mnt/echt/musik|PY=/usr/bin/python3|A_MED=/mnt/echt/mediathek.sqlite|A_GER=/home/echt/baukasten") ok "owner (no instance): umgebung.env read exactly as before";; *) fehl "owner: $aus";; esac
# unit.py: EnvironmentFile of the page unit
U="$START/templates/cypherdj-oberflaeche.service"
v=(--var NODE=/usr/bin/node --var STEMS_CPUS=1 --var OBERFLAECHE_ARGS=--x)
o=$(python3 "$START/unit.py" --unit "$U" --djk "$DJK" "${v[@]}" | grep '^EnvironmentFile'); [ "$o" = "EnvironmentFile=-$HOME/.config/cypherdj/umgebung.env" ] && ok "owner unit: EnvironmentFile unchanged" || fehl "owner unit EnvironmentFile: $o"
python3 "$START/unit.py" --unit "$U" --djk "$DJK" --umgebungsdatei /dev/shm/cypherdj-e/umgebung.env "${v[@]}" | grep -qx 'EnvironmentFile=-/dev/shm/cypherdj-e/umgebung.env' && ok "instance unit: EnvironmentFile points at the filtered copy" || fehl "instance unit EnvironmentFile"
exit $rc
