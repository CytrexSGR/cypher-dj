#!/usr/bin/env bash
# Test for djk-doctor: stubs on PATH, temp HOME, nothing real is started or touched.
# Usage: djk/start/tests/test_doctor.sh   (exit 0 all OK, 1 at least one FAIL)
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
DOCTOR=$(cd "$HIER/.." && pwd)/djk-doctor
LAUNCHER=$(cd "$HIER/.." && pwd)/cypher-dj
T=$(mktemp -d "${TMPDIR:-/tmp}/doctor-test.XXXX")
trap 'rm -rf "$T"; [ -n "${HOLD:-}" ] && kill "$HOLD" 2>/dev/null' EXIT
OK=0; FAIL=0
check() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FAIL $2"; FAIL=$((FAIL + 1)); fi; }

mkdir -p "$T/good" "$T/home" "$T/cwd"
# The test never looks at a real instance port: it picks two free ports itself and hands them over (CYPHERDJ_DOCTOR_PORTS replaces the table).
freier_port() { python3 -I -c 'import socket,sys; s=socket.socket(socket.AF_INET, socket.SOCK_STREAM if sys.argv[1]=="tcp" else socket.SOCK_DGRAM); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])' "$1"; }
PT=$(freier_port tcp); PU=$(freier_port udp)
export CYPHERDJ_DOCTOR_PORTS="tcp:$PT:test page,udp:$PU:test core"
printf '#!/usr/bin/env bash\necho CUDA\n' > "$T/py-cuda"; printf '#!/usr/bin/env bash\necho CPU\n' > "$T/py-cpu"; printf '#!/usr/bin/env bash\necho NOTORCH\n' > "$T/py-notorch"
chmod +x "$T/py-cuda" "$T/py-cpu" "$T/py-notorch"
export CYPHERDJ_DOCTOR_VENV_PYTHON="$T/py-cuda"
stub() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$T/good/$1"; chmod +x "$T/good/$1"; }
stub systemd-run 'printf "4194304\n95\n"'
stub systemctl 'exit 3'
stub pactl 'echo alsa_output.test'
stub pw-link 'echo x'
stub nvidia-smi 'echo NVIDIA-stub'
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/pw-jack"; chmod +x "$T/pw-jack"
# a restricted PATH: the stubs plus the basic tools, never the real pactl or systemd-run
mkdir -p "$T/base"
for p in bash env sed head timeout mktemp rm cat python3 ss grep dirname readlink; do
  w=$(command -v "$p") && ln -sf "$w" "$T/base/$p"
done
run() {  # run <extra PATH dir first> args...: cwd is an unrelated folder
  local d=$1; shift
  ( cd "$T/cwd" && PATH="$d:$T/base" HOME="$T/home" SYSTEMLAGE_PWJACK="$T/pw-jack" SYSTEMLAGE_FRIST=5 "$@" ) > "$T/out" 2> "$T/err"; RC=$?
}

IDS="systemd_sitzung echtzeit pactl pipewire jack senke ports platte surge carla cuda katalog version"

# all good: exit 0, every ID once (lines carry no ID, so count and order are checked through the text of each check)
run "$T/good" "$DOCTOR"
[ "$RC" = 0 ]; check $? "all good: exit 0 (rc $RC)"
[ "$(grep -c '^\[' "$T/out")" = 13 ]; check $? "all good: 13 check lines ($(grep -c '^\[' "$T/out"))"
! grep -q '^\[PROBLEM\]' "$T/out"; check $? "all good: no PROBLEM line"
[ ! -s "$T/err" ]; check $? "all good: stderr empty"

# run from an unrelated cwd under python3 -I still starts (run() already uses $T/cwd)
grep -q 'pactl' "$T/out"; check $? "unrelated cwd: starts and reports pactl"

# no pactl
mkdir -p "$T/nopactl"; cp -P "$T/good/"* "$T/nopactl/"; rm "$T/nopactl/pactl"
run "$T/nopactl" "$DOCTOR"
[ "$RC" = 1 ]; check $? "no pactl: exit 1 (rc $RC)"
grep -q '^\[PROBLEM\].*pactl.*->  *sudo apt install' "$T/out"; check $? "no pactl: PROBLEM line names pactl with a fix"
! grep -q Traceback "$T/err" "$T/out"; check $? "no pactl: no traceback"

# no systemd-run
mkdir -p "$T/nosd"; cp -P "$T/good/"* "$T/nosd/"; rm "$T/nosd/systemd-run"
S=$SECONDS; run "$T/nosd" "$DOCTOR"; D=$((SECONDS - S))
[ "$RC" = 1 ]; check $? "no systemd-run: exit 1 (rc $RC)"
grep -q '^\[PROBLEM\].*systemd' "$T/out"; check $? "no systemd-run: PROBLEM names the systemd user session"
[ "$D" -lt 20 ]; check $? "no systemd-run: finished in ${D} s"
! grep -q Traceback "$T/err" "$T/out"; check $? "no systemd-run: no traceback"

# free space under 5 GB: NOTE on the disk check
run "$T/good" env CYPHERDJ_DOCTOR_FREI_BYTES=1000000000 "$DOCTOR"
grep -q '^\[NOTE\].*disk' "$T/out"; check $? "low space: NOTE on the disk line"
[ "$RC" = 0 ]; check $? "low space: a NOTE does not fail (rc $RC)"
run "$T/good" env CYPHERDJ_DOCTOR_FREI_BYTES=900000000000 "$DOCTOR"
grep -q '^\[OK\].*disk' "$T/out"; check $? "plenty of space: OK on the disk line"

# a bound foreign port (the test's own tcp port), a bound udp port, and the control without either
python3 -I -c 'import socket,sys,time; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(1); time.sleep(60)' "$PT" &
HOLD=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do ss -Hlnt "sport = :$PT" | grep -q . && break; sleep 0.2; done
run "$T/good" "$DOCTOR"
[ "$RC" = 1 ]; check $? "bound port: exit 1 (rc $RC)"
grep -q "^\[PROBLEM\].*$PT" "$T/out"; check $? "bound port: PROBLEM names the port"
kill "$HOLD" 2>/dev/null; wait "$HOLD" 2>/dev/null; HOLD=""
python3 -I -c 'import socket,sys,time; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1",int(sys.argv[1]))); time.sleep(60)' "$PU" &
HOLD=$!
sleep 0.5
run "$T/good" "$DOCTOR"
grep -q "^\[PROBLEM\].*udp $PU" "$T/out"; check $? "bound udp port: PROBLEM names udp $PU"
kill "$HOLD" 2>/dev/null; wait "$HOLD" 2>/dev/null; HOLD=""
run "$T/good" "$DOCTOR"
! grep -q '^\[PROBLEM\].*port' "$T/out" && grep -q '^\[OK\].*ports are free' "$T/out"; check $? "control: unbound ports give OK"

# udp_port of kern.toml is respected (the port table is read directly, no real port is touched)
mkdir -p "$T/home/.config/cypherdj"; printf 'udp_port = 51234\n' > "$T/home/.config/cypherdj/kern.toml"
HOME="$T/home" python3 -I - "$DOCTOR" <<'PY'
import importlib.machinery, importlib.util, os, sys
os.environ.pop("CYPHERDJ_DOCTOR_PORTS", None)
l = importlib.machinery.SourceFileLoader("djk_doctor", sys.argv[1]); sp = importlib.util.spec_from_loader("djk_doctor", l)
m = importlib.util.module_from_spec(sp); l.exec_module(m)
t = m.tabelle("", 0)
assert ("udp", 51234, "core commands") in t, t

PY
check $? "kern.toml udp_port is used for the core port"
rm -rf "$T/home/.config"

# CUDA: torch importable and cuda available is the test, not nvidia-smi alone
run "$T/good" "$DOCTOR"; grep -q '^\[OK\].*PyTorch sees the GPU' "$T/out"; check $? "cuda: torch sees the GPU -> OK"
CYPHERDJ_DOCTOR_VENV_PYTHON="$T/py-notorch" run "$T/good" env CYPHERDJ_DOCTOR_VENV_PYTHON="$T/py-notorch" "$DOCTOR"
grep -q '^\[NOTE\].*GPU found.*PyTorch is missing' "$T/out"; check $? "cuda: GPU but no PyTorch -> NOTE 'GPU found but PyTorch missing'"
run "$T/good" env CYPHERDJ_DOCTOR_VENV_PYTHON="$T/py-cpu" "$DOCTOR"
grep -q '^\[NOTE\].*cuda.is_available() is false' "$T/out"; check $? "cuda: torch without cuda -> NOTE"
mkdir -p "$T/nogpu"; cp -P "$T/good/"* "$T/nogpu/"; rm "$T/nogpu/nvidia-smi"
run "$T/nogpu" env CYPHERDJ_DOCTOR_VENV_PYTHON="$T/py-notorch" "$DOCTOR"
grep -q '^\[NOTE\].*no usable GPU' "$T/out"; check $? "cuda: no GPU, no torch -> NOTE"

# version names the project format
grep -q '^\[OK\] cypher-dj .*project format cypherdj-projekt/[0-9]' "$T/out"; check $? "version: line carries the project format"

# catalogue: missing, empty, filled
KD="$T/home/.local/share/cypherdj/mediathek"; mkdir -p "$KD"
run "$T/good" "$DOCTOR"; grep -q '^\[NOTE\].*catalog is not built' "$T/out"; check $? "catalog missing: NOTE"
python3 -I -c 'import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute("CREATE TABLE katalog (sha TEXT)"); d.commit()' "$KD/katalog.sqlite"
run "$T/good" "$DOCTOR"; grep -q '^\[NOTE\].*catalog is empty' "$T/out"; check $? "catalog empty: NOTE"
python3 -I -c 'import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute("INSERT INTO katalog VALUES (\"x\")"); d.commit()' "$KD/katalog.sqlite"
run "$T/good" "$DOCTOR"; grep -q '^\[OK\].*catalog holds 1 entries' "$T/out"; check $? "catalog filled: OK"

# bad argument
run "$T/good" "$DOCTOR" --instanz zz
[ "$RC" = 2 ]; check $? "bad instance: exit 2 (rc $RC)"

echo "$OK OK, $FAIL FAIL"
[ "$FAIL" = 0 ]
