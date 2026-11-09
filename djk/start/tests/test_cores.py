"""cores.py: core allocation from an invented sysfs tree (no real machine needed). Machine like the dev box: 8 cores, 16 threads (cpu i and i+8 share core i)."""
import subprocess
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER.parent))
import cores as kerne  # noqa: E402


def baum(tmp_path, cpus, online=None):
    """cpus: list of (cpu, core_id, package); online: text for <root>/online or None (file missing)."""
    root = tmp_path / "cpu"
    for c, k, p in cpus:
        d = root / f"cpu{c}" / "topology"
        d.mkdir(parents=True)
        (d / "core_id").write_text(f"{k}\n")
        (d / "physical_package_id").write_text(f"{p}\n")
    (root / "cpufreq").mkdir(exist_ok=True)
    if online is not None:
        (root / "online").write_text(online + "\n")
    return str(root)


def rechner16(tmp_path):
    return baum(tmp_path, [(c, c % 8, 0) for c in range(16)], "0-15")


def test_vorgabe_vier_kerne_auf_107(tmp_path):
    kern, stems, n, notes = kerne.plane(4, sysfs=rechner16(tmp_path))
    assert kerne.bereiche(kern, " ") == "0-3 8-11"
    assert kerne.bereiche(stems, ",") == "4-7,12-15"
    assert n == 4 and notes == []


@pytest.mark.parametrize("n,kern,stems", [(1, "0 8", "1-7,9-15"), (2, "0-1 8-9", "2-7,10-15"), (7, "0-6 8-14", "7,15")])
def test_andere_kernzahlen(tmp_path, n, kern, stems):
    k, s, _, _ = kerne.plane(n, sysfs=rechner16(tmp_path))
    assert (kerne.bereiche(k, " "), kerne.bereiche(s, ",")) == (kern, stems)


@pytest.mark.parametrize("n,gebraucht", [(0, 1), (8, 7), (9, 7), (100, 7)])
def test_kernzahl_ausserhalb_wird_geklemmt(tmp_path, n, gebraucht):
    k, s, n_aus, notes = kerne.plane(n, sysfs=rechner16(tmp_path))
    assert n_aus == gebraucht and len(k) == 2 * gebraucht and len(notes) == 1 and "outside 1 to 7" in notes[0] and f"using {gebraucht}" in notes[0]
    assert not (k & s) and s            # the stems always keep a core


def test_nur_online_cpus_genau(tmp_path):
    root = baum(tmp_path, [(c, c % 8, 0) for c in range(16) if c not in (2, 10, 3)], "0-1,4-9,11-15")
    k, s, _, _ = kerne.plane(4, sysfs=root)
    assert k == {0, 8, 1, 9, 4, 12, 5, 13}   # ordered by the lowest cpu: cores 0, 1, 4, 5 (core 3 has only cpu 11 left and comes after 7)
    assert s == {6, 7, 11, 14, 15}
    assert not (k & s)


def test_zwei_pakete_gleiche_core_ids(tmp_path):   # Intel-like: cpu 0,1 = core 0, ... and a second package with the same core_ids
    root = baum(tmp_path, [(c, (c // 2) % 2, c // 4) for c in range(8)], "0-7")
    k, s, _, _ = kerne.plane(2, sysfs=root)
    assert k == {0, 1, 2, 3} and s == {4, 5, 6, 7}


def test_online_datei_fehlt_dann_verzeichnisse(tmp_path):
    root = baum(tmp_path, [(c, c % 4, 0) for c in range(8)], None)
    assert kerne.online(root) == set(range(8))


def test_explizite_kern_cpus_gewinnen(tmp_path):
    k, s, n, _ = kerne.plane(4, kern_cpus="0 1 8 9", sysfs=rechner16(tmp_path))
    assert k == {0, 1, 8, 9} and s == set(range(16)) - k and n is None


def test_explizite_stems_cpus_gewinnen(tmp_path):
    root = rechner16(tmp_path)
    k, s, n, notes = kerne.plane(4, stems_cpus="6-7,14-15", sysfs=root)
    assert kerne.bereiche(k, " ") == "0-3 8-11" and s == {6, 7, 14, 15} and n == 4 and notes == []
    _, _, _, notes = kerne.plane(4, stems_cpus="3-5", sysfs=root)   # overlaps the kern CPUs: a note, no error
    assert len(notes) == 1 and "overlaps" in notes[0] and "3" in notes[0]
    k, s, _, _ = kerne.plane(4, kern_cpus="0-3", stems_cpus="12", sysfs=root)
    assert s == {12}


def test_fehler(tmp_path):
    root = rechner16(tmp_path)
    with pytest.raises(ValueError, match="CYPHERDJ_KERN_CPUS names CPUs that are not online"):
        kerne.plane(4, kern_cpus="0,99", sysfs=root)
    with pytest.raises(ValueError, match="CYPHERDJ_STEMS_CPUS: not a CPU list"):
        kerne.plane(4, stems_cpus="x", sysfs=root)
    with pytest.raises(ValueError, match="not online"):
        kerne.plane(4, stems_cpus="99", sysfs=root)
    with pytest.raises(ValueError, match="not a CPU list"):
        kerne.plane(4, kern_cpus="a-b", sysfs=root)
    with pytest.raises(ValueError, match="no CPU is left"):
        kerne.plane(4, kern_cpus="0-15", sysfs=root)
    with pytest.raises(ValueError, match="separate cores"):
        kerne.plane(1, sysfs=baum(tmp_path / "x", [(0, 0, 0), (1, 0, 0)], "0-1"))
    with pytest.raises(ValueError, match="no online CPUs"):
        kerne.plane(1, sysfs=str(tmp_path / "gibt_es_nicht"))


def test_listen():
    assert kerne.liste_lesen("0-3,8 9") == {0, 1, 2, 3, 8, 9}
    assert kerne.bereiche({0, 1, 2, 3, 8, 9, 11}, ",") == "0-3,8-9,11"
    for schlecht in ("1-", "3-1", "x", "1;2"):
        with pytest.raises(ValueError):
            kerne.liste_lesen(schlecht)


def test_aufruf_ausgabe_und_fehler(tmp_path):
    root = rechner16(tmp_path)
    r = subprocess.run([sys.executable, str(HIER.parent / "cores.py"), "--sysfs", root], capture_output=True, text=True)
    assert r.returncode == 0
    assert r.stdout.split("\n")[:3] == ["KERN_CPUS=0-3 8-11", "STEMS_CPUS=4-7,12-15", "KERN_KERNE=4"]
    r = subprocess.run([sys.executable, str(HIER.parent / "cores.py"), "--sysfs", root, "--n", "vier"], capture_output=True, text=True)
    assert r.returncode == 2 and "whole number" in r.stderr and "Traceback" not in r.stderr
    r = subprocess.run([sys.executable, str(HIER.parent / "cores.py"), "--sysfs", root, "--kern-cpus", "0 1"], capture_output=True, text=True)
    assert r.stdout.split("\n")[2] == "KERN_KERNE=-"
