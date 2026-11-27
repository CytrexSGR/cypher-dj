"""im_container.sh with a stub podman: a cancelled CI job must not leave its container running (t_41c45344).

The stub stands for the real split: `podman run` is the client in this process group, the container itself lives outside it (under conmon).
The stub's container is a `setsid sleep` with a pid file; `podman stop` kills it and leaves a marker."""
import os
import signal
import subprocess
import time
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[1] / "ci" / "im_container.sh"

PODMAN = r"""#!/bin/bash
D=$(dirname "$0")
case "$1" in
  run)
    name=""; prev=""
    for a in "$@"; do [ "$prev" = --name ] && name=$a; prev=$a; done
    setsid sleep "${STUB_DAUER:-300}" </dev/null >/dev/null 2>&1 &
    echo $! > "$D/$name.pid"
    while kill -0 "$(cat "$D/$name.pid")" 2>/dev/null; do sleep 0.1; done
    exit "${STUB_RC:-0}" ;;
  stop)
    name=${@: -1}
    [ -f "$D/$name.pid" ] && kill "$(cat "$D/$name.pid")" 2>/dev/null
    echo stopped >> "$D/$name.stopped" ;;
esac
"""


def stub(tmp: Path, **env):
    (tmp / "podman").write_text(PODMAN)
    (tmp / "podman").chmod(0o755)
    e = {**os.environ, "PATH": f"{tmp}:{os.environ['PATH']}", "CI_GPU": "0", "CI_GEWICHTE": str(tmp / "none"), "CI_STRUDEL": str(tmp / "none")}
    e.update(env)
    return e


def starte(tmp: Path, **env):
    p = subprocess.Popen(["bash", str(SKRIPT), "true"], env=stub(tmp, **env), start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pid_datei = tmp / f"cdjci-{p.pid}.pid"
    for _ in range(100):
        if pid_datei.exists() and pid_datei.read_text().strip():
            return p, int(pid_datei.read_text())
        time.sleep(0.05)
    raise AssertionError("the stub container never started")


def lebt(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return Path(f"/proc/{pid}/stat").exists() and Path(f"/proc/{pid}/stat").read_text().split()[2] != "Z"


def warte_bis(bedingung, sekunden=15.0):
    ende = time.time() + sekunden
    while time.time() < ende:
        if bedingung():
            return True
        time.sleep(0.1)
    return bedingung()


def test_kill_of_the_whole_process_group_still_stops_the_container(tmp_path):
    # the runner of a cancelled job kills the step's process group; a trap does not run on KILL
    p, container = starte(tmp_path)
    os.killpg(p.pid, signal.SIGKILL)
    p.wait()
    assert warte_bis(lambda: not lebt(container)), "the container is still running after the job was killed"
    assert (tmp_path / f"cdjci-{p.pid}.stopped").exists()


def test_term_stops_the_container_and_ends_with_143(tmp_path):
    p, container = starte(tmp_path)
    os.kill(p.pid, signal.SIGTERM)
    assert p.wait(timeout=15) == 143
    assert warte_bis(lambda: not lebt(container))


def test_a_normal_run_passes_the_exit_code_through_and_leaves_no_guard(tmp_path):
    r = subprocess.run(["bash", str(SKRIPT), "true"], env=stub(tmp_path, STUB_DAUER="0.3", STUB_RC="3"), capture_output=True, text=True, timeout=30)
    assert r.returncode == 3
    namen = [d.stem for d in tmp_path.glob("cdjci-*.pid")]
    assert len(namen) == 1
    time.sleep(3)   # a guard polls every 2 s: it must be gone, not stop a container that ended on its own
    waechter = [z for z in subprocess.run(["ps", "-eo", "args"], capture_output=True, text=True).stdout.splitlines()
                if z.startswith("im-container-waechter") and namen[0] in z]
    assert waechter == [], waechter
    assert not (tmp_path / f"{namen[0]}.stopped").exists()
