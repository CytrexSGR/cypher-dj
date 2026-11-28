"""abbrechen.sh with stubbed podman, pgrep, ps and kill: nothing real is started or stopped."""
import os
import subprocess
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[1] / "ci" / "abbrechen.sh"


def stubs(tmp, prozesse, container, zaeh=()):
    """prozesse: {pid: (ppid, comm, args)}; container: names podman ps shows; zaeh: pids that survive TERM and KILL."""
    (tmp / "prozesse").write_text("".join(f"{p} {pp} {c} {a}\n" for p, (pp, c, a) in prozesse.items()))
    (tmp / "container").write_text("".join(n + "\n" for n in container))
    (tmp / "lebt").write_text("".join(f"{p}\n" for p in prozesse))
    (tmp / "zaeh").write_text("".join(f"{p}\n" for p in zaeh))
    (tmp / "log").write_text("")
    d = tmp / "bin"
    d.mkdir()
    (d / "pgrep").write_text(f'''#!/bin/bash
# every process whose args match the pattern (the real pgrep -f), alive ones only
while read -r pid pp comm args; do grep -qx "$pid" "{tmp}/lebt" && [[ "$args" =~ $2 ]] && echo "$pid"; done < "{tmp}/prozesse"
exit 0
''')
    (d / "ps").write_text(f'''#!/bin/bash
# ps -o <ppid=|comm=|args=> -p PID
pid=$4; line=$(grep "^$pid " "{tmp}/prozesse") || exit 1
read -r p pp comm args <<< "$line"
case "$2" in ppid=) echo "$pp";; comm=) echo "$comm";; args=) echo "$args";; esac
''')
    (d / "kill").write_text(f'''#!/bin/bash
echo "kill $*" >> "{tmp}/log"
case "$1" in
  -0) grep -qx "$2" "{tmp}/lebt" ;;
  -KILL) grep -qx "$2" "{tmp}/zaeh" || {{ grep -vx "$2" "{tmp}/lebt" > "{tmp}/lebt.n"; mv "{tmp}/lebt.n" "{tmp}/lebt"; }} ;;
  -TERM) grep -qx "$2" "{tmp}/zaeh" || {{ grep -vx "$2" "{tmp}/lebt" > "{tmp}/lebt.n"; mv "{tmp}/lebt.n" "{tmp}/lebt"; }} ;;
esac
''')
    (d / "podman").write_text(f'''#!/bin/bash
echo "podman $*" >> "{tmp}/log"
case "$1" in
  ps) cat "{tmp}/container" ;;
  stop|kill) n=${{@: -1}}; grep -vx "$n" "{tmp}/container" > "{tmp}/container.n"; mv "{tmp}/container.n" "{tmp}/container" ;;
esac
''')
    for f in d.iterdir():
        f.chmod(0o755)
    return d


def lauf(tmp, **kw):
    d = stubs(tmp, **kw)
    env = {**os.environ, "PATH": f"{d}:{os.environ['PATH']}", "ABBRECHEN_KILL": str(d / "kill"), "ABBRECHEN_WARTE": "0"}
    r = subprocess.run(["bash", str(SKRIPT)], capture_output=True, text=True, env=env, timeout=60)
    return r, (tmp / "log").read_text().splitlines()


JOB = {
    100: (1, "ci-runner", "ci-runner daemon"),
    200: (100, "bash", "bash -e /home/ci/.cache/act/step-3.sh"),                       # the step's shell
    201: (200, "bash", "bash djk/tools/ci/ruhig_pakete.sh /w/.ci-ergebnis --betroffen abc"),
    202: (201, "bash", "bash djk/tools/ci/im_container.sh djk/tools/alles.sh --paket 1/4"),
    203: (200, "bash", "bash djk/tools/ci/im_container.sh djk/tools/alles.sh --ohne-ruhig"),
    300: (1, "vim", "vim notes_alles.sh.txt"),
}


def test_stoppt_schritt_skripte_und_alle_cdjci_container(tmp_path):
    r, log = lauf(tmp_path, prozesse=JOB, container=["cdjci-4711", "cdjci-4712", "other-box", "cdjci-ccache"])
    assert r.returncode == 0, r.stdout + r.stderr
    killed = [l.split()[2] for l in log if l.startswith("kill -TERM")]
    assert sorted(killed) == ["200", "201", "202", "203"]            # the step shell and the scripts below it; not the runner, not vim
    assert killed.index("202") < killed.index("201") < killed.index("200")   # children first
    assert "podman stop -t 5 cdjci-4711" in log and "podman stop -t 5 cdjci-4712" in log
    assert not any("other-box" in l or "cdjci-ccache" in l for l in log if l.startswith("podman stop") or l.startswith("podman kill"))
    assert "stop process 201" in r.stdout and "stop container cdjci-4711" in r.stdout
    assert "survivors: 0" in r.stdout


def test_nichts_laeuft_ist_kein_fehler(tmp_path):
    r, log = lauf(tmp_path, prozesse={100: JOB[100], 300: JOB[300]}, container=[])
    assert r.returncode == 0 and "stopped: 0" in r.stdout
    assert not any(l.startswith("kill -TERM") or l.startswith("podman stop") for l in log)


def test_ueberlebender_prozess_bekommt_kill_und_wird_gemeldet(tmp_path):
    r, log = lauf(tmp_path, prozesse=JOB, container=["cdjci-1"], zaeh=[202])
    assert "kill -KILL 202" in log
    assert "kill -KILL 201" not in log                               # it died of the TERM
    assert r.returncode == 1 and "survivors: 1" in r.stdout


def test_laufender_container_nach_stop_wird_gekillt(tmp_path):
    d = stubs(tmp_path, prozesse={}, container=["cdjci-9"])
    (d / "podman").write_text(f'#!/bin/bash\necho "podman $*" >> "{tmp_path}/log"\ncase "$1" in ps) cat "{tmp_path}/container";; kill) : > "{tmp_path}/container";; esac\n')
    env = {**os.environ, "PATH": f"{d}:{os.environ['PATH']}", "ABBRECHEN_KILL": str(d / "kill"), "ABBRECHEN_WARTE": "0"}
    r = subprocess.run(["bash", str(SKRIPT)], capture_output=True, text=True, env=env, timeout=60)
    assert "podman kill cdjci-9" in (tmp_path / "log").read_text() and r.returncode == 0
