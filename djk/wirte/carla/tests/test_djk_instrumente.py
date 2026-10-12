"""djk-instrumente mit Attrappen für systemctl und pw-link (kein Studio, keine Units): Status-Datei sagt vst3:rb338, Bundle fehlt."""
import os
import shutil
import subprocess
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[3] / "start" / "djk-instrumente"
INST = "d"  # nur dieser Test; die Ordner unter /dev/shm/cypherdj-d legt er an und räumt sie ab


def test_status_sagt_rb338_bundle_fehlt_ist_sofort_eine_klare_meldung(tmp_path):
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    (bin_ / "systemctl").write_text('#!/bin/sh\ncase "$*" in *is-active*cypherdj-kern-d*) echo active;; *is-active*) echo inactive;; esac\nexit 0\n')
    (bin_ / "pw-link").write_text('#!/bin/sh\necho "cypherdj-kern-d:midi_aus_1"\n')
    (bin_ / "systemd-run").write_text("#!/bin/sh\necho SYSTEMD-RUN-AUFGERUFEN >&2\nexit 0\n")
    for f in bin_.iterdir():
        f.chmod(0o755)
    home = tmp_path / "home"
    (home / ".local/lib/cypherdj/lv2/Surge XT.lv2").mkdir(parents=True)
    (home / ".local/lib/cypherdj/lv2/Surge XT.lv2/manifest.ttl").write_text("")
    shm = Path(f"/dev/shm/cypherdj-{INST}")
    assert not shm.exists(), "Instanz d ist belegt"
    shm.mkdir()
    try:
        (shm / "wirt-bass.json").write_text('{"art": "vst3:rb338"}')
        env = dict(os.environ, PATH=f"{bin_}:{os.environ['PATH']}", HOME=str(home), XDG_RUNTIME_DIR=str(tmp_path))
        t0 = __import__("time").time()
        r = subprocess.run(["bash", str(SKRIPT), "--instanz", INST, "--nur-wirte"], env=env, capture_output=True, text=True, timeout=20)
        assert r.returncode == 2, (r.returncode, r.stdout, r.stderr)
        assert "rb338 is missing" in r.stderr and "SYSTEMD-RUN" not in r.stderr, r.stderr
        assert __import__("time").time() - t0 < 10
        # Gegenprobe: mit vorhandenem Bundle läuft das Skript über die Prüfung hinaus (es wartet dann auf "bereit", die Attrappe
        # von systemd-run startet nichts): kein Sofort-Abbruch mit rc 2 innerhalb von 4 s
        (home / ".local/lib/cypherdj/vst3/rb338.vst3/Contents").mkdir(parents=True)
        try:
            r = subprocess.run(["bash", str(SKRIPT), "--instanz", INST, "--nur-wirte"], env=env, capture_output=True, text=True, timeout=4)
            assert "rb338 is missing" not in r.stderr and r.returncode != 2, (r.returncode, r.stderr)
        except subprocess.TimeoutExpired:
            pass
    finally:
        shutil.rmtree(shm, ignore_errors=True)
