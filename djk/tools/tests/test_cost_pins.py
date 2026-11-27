"""tests/cost/hash_pruefen.cmake: known host against its pin, unknown host against the plain run (fake kern_kosten_arr, no core build needed)."""
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

KOSTEN = Path(__file__).resolve().parents[2] / "core" / "tests" / "cost"
PINS = KOSTEN / "hash_pins.txt"
pytestmark = pytest.mark.skipif(shutil.which("cmake") is None, reason="needs cmake")


def attrappe(tmp_path, hashes):
    """Fake kern_kosten_arr: prints the pm/out pair chosen by KOSTEN_BLOCK and the muted/pool env, like the real lane prints its HASH line."""
    exe = tmp_path / "kern_kosten_arr"
    exe.write_text(
        "#!/bin/sh\n"
        'b=${KOSTEN_BLOCK:-256}\n'
        'if [ -n "$KOSTEN_ARR32_STUMM" ]; then echo "HASH lane=$2 pm=aaaa out=bbbb blocks=5000 x"; exit 2; fi\n'
        f'case "$b" in {hashes}\n'
        'esac\n'
        'echo "HASH lane=$2 pm=$pm out=$out blocks=5000 pool_jobs=${KOSTEN_HALL_FAEDEN:-0} tail"\n')
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
    return exe


def lauf(exe, cpu, lane="arr32ins", block="256", envv="", nach="", kontrolle=0):
    cmd = ["cmake", f"-DEXE={exe}", f"-DLANE={lane}", f"-DBLOCK={block}", f"-DENVV={envv}", f"-DNACH={nach}",
           f"-DKONTROLLE={kontrolle}", f"-DPINS={PINS}", "-P", str(KOSTEN / "hash_pruefen.cmake")]
    r = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "KOSTEN_CPU_MODELL": cpu})
    return r.returncode, r.stdout + r.stderr


LAPTOP = "13th Gen Intel(R) Core(TM) i9-13900HX"
PC = "AMD Ryzen 7 7800X3D 8-Core Processor"


def pin(host, block):
    """pm/out of a host's arr32ins pin, read from hash_pins.txt (the pins move whenever the DSP changes on purpose)."""
    for z in PINS.read_text().splitlines():
        f = z.split()
        if f[:4] == ["pin", host, "arr32ins", block]:
            return f[4], f[5]
    raise AssertionError(f"no pin for {host} {block}")


def test_known_host_with_its_pin_passes(tmp_path):
    (p2, o2), (p1, o1) = pin("i9-13900hx", "256"), pin("i9-13900hx", "128")
    exe = attrappe(tmp_path, f'256) pm={p2}; out={o2};; *) pm={p1}; out={o1};;')
    rc, out = lauf(exe, LAPTOP)
    assert rc == 0, out
    assert "pin of host i9-13900hx" in out


def test_known_host_with_the_other_hosts_bits_fails(tmp_path):
    p2, o2 = pin("ryzen-7800x3d", "256")
    exe = attrappe(tmp_path, f'256) pm={p2}; out={o2};; *) pm=1; out=2;;')
    rc, out = lauf(exe, LAPTOP)
    assert rc != 0 and "hash differs from the reference" in out
    rc, out = lauf(exe, PC)
    assert rc == 0, out


def test_unknown_host_checks_only_agreement(tmp_path):
    exe = attrappe(tmp_path, '*) pm=1234; out=5678;;')
    rc, out = lauf(exe, "Some Other CPU", envv="KOSTEN_HALL_FAEDEN=3", nach="pool_jobs=3 tail")
    assert rc == 0, out
    assert "no pin for this host" in out


def test_unknown_host_variant_disagreeing_with_plain_run_fails(tmp_path):
    exe = tmp_path / "kern_kosten_arr"
    exe.write_text('#!/bin/sh\nif [ -n "$KOSTEN_HALL_FAEDEN" ]; then pm=1; else pm=2; fi\n'
                   'echo "HASH lane=$2 pm=$pm out=9 blocks=5000 t"\n')
    exe.chmod(0o755)
    rc, out = lauf(exe, "Some Other CPU", envv="KOSTEN_HALL_FAEDEN=3")
    assert rc != 0 and "hash differs" in out


def test_control_must_differ_from_reference_on_any_host(tmp_path):
    exe = attrappe(tmp_path, '*) pm=1234; out=5678;;')
    rc, out = lauf(exe, "Some Other CPU", envv="KOSTEN_ARR32_STUMM=3", kontrolle=1)
    assert rc == 0, out
    same = tmp_path / "gleich"
    same.write_text('#!/bin/sh\necho "HASH lane=$2 pm=1 out=2 blocks=5000 x"\n')
    same.chmod(0o755)
    rc, out = lauf(same, "Some Other CPU", envv="KOSTEN_ARR32_STUMM=3", kontrolle=1)
    assert rc != 0 and "control gave the reference bits" in out


def test_missing_hash_line_fails(tmp_path):
    exe = tmp_path / "leer"
    exe.write_text("#!/bin/sh\nexit 0\n")
    exe.chmod(0o755)
    rc, out = lauf(exe, LAPTOP)
    assert rc != 0 and "no HASH line" in out


def test_tail_regex_must_match(tmp_path):
    exe = attrappe(tmp_path, '*) pm=1234; out=5678;;')
    rc, out = lauf(exe, "Some Other CPU", nach="nothing like this")
    assert rc != 0 and "does not match" in out
