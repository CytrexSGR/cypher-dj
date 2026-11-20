"""profiles.py against recorded pactl output (no card is touched: DJK_PROFIL_TROCKEN prints the commands)."""
import json
import os
import subprocess
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
PROFIL = HIER.parent / "profiles.py"
sys.path.insert(0, str(HIER.parent))
import profiles as profil  # noqa: E402

KARTE = "alsa_card.pci-0000_16_00.6"
SENKE = "alsa_output.pci-0000_16_00.6.iec958-stereo"


def karte(profile, aktiv):
    return [{"name": KARTE, "active_profile": aktiv, "profiles": profile}]


# After the reboot of 2026-11-19: only AC3 offered, stereo missing.
NACH_NEUSTART = karte({
    "output:analog-stereo": {"priority": 6500, "available": False},
    "output:iec958-ac3-surround-51": {"priority": 300, "available": True},
}, "output:iec958-ac3-surround-51")
# Normal state, but the card switched to AC3 (e.g. by a desktop sound dialog).
ANGEBOTEN = karte({
    "output:iec958-stereo+input:analog-stereo": {"priority": 5565, "available": True},
    "output:iec958-stereo": {"priority": 5500, "available": True},
    "output:iec958-ac3-surround-51": {"priority": 300, "available": True},
}, "output:iec958-ac3-surround-51")


def lauf(tmp_path, karten, senken, *args):
    k = tmp_path / "karten.json"
    k.write_text(json.dumps(karten))
    s = tmp_path / "senken.txt"
    s.write_text(senken)
    env = {**os.environ, "DJK_FIX_KARTEN": str(k), "DJK_FIX_SENKEN": str(s), "DJK_PROFIL_TROCKEN": "1"}
    return subprocess.run([sys.executable, str(PROFIL), "--senke", SENKE, *args], capture_output=True, text=True, env=env, timeout=20)


def test_split_sink_name():
    assert profil.zerlege(SENKE) == (KARTE, "iec958-stereo")
    assert profil.zerlege("cypher_stumm") is None


def test_choose_highest_available_profile_with_exact_output_part():
    name, aktiv, gefunden = profil.waehle(ANGEBOTEN, KARTE, "iec958-stereo")
    assert (name, aktiv, gefunden) == ("output:iec958-stereo+input:analog-stereo", "output:iec958-ac3-surround-51", True)
    # iec958-stereo must not match iec958-ac3-surround-51 or analog-stereo
    assert profil.waehle(NACH_NEUSTART, KARTE, "iec958-stereo") == (None, "output:iec958-ac3-surround-51", True)
    assert profil.waehle(NACH_NEUSTART, "alsa_card.other", "iec958-stereo")[2] is False


def test_unavailable_profile_is_not_chosen():
    k = karte({"output:iec958-stereo": {"priority": 5500, "available": False}}, "off")
    assert profil.waehle(k, KARTE, "iec958-stereo")[0] is None


def test_sink_present_does_nothing(tmp_path):
    r = lauf(tmp_path, ANGEBOTEN, f"71\t{SENKE}\tPipeWire\ts32le 2ch 48000Hz\tRUNNING\n")
    assert r.returncode == 0
    assert "pactl" not in r.stdout


def test_offered_profile_is_set(tmp_path):
    r = lauf(tmp_path, ANGEBOTEN, "")
    assert f"pactl set-card-profile {KARTE} output:iec958-stereo+input:analog-stereo" in r.stdout
    assert "systemctl" not in r.stdout


def test_not_offered_without_permission_does_not_restart(tmp_path):
    r = lauf(tmp_path, NACH_NEUSTART, "")
    assert r.returncode == 3
    assert "systemctl" not in r.stdout
    assert "not allowed here" in r.stdout


def test_not_offered_with_permission_restarts_wireplumber_first(tmp_path):
    r = lauf(tmp_path, NACH_NEUSTART, "", "--neustart-erlaubt")
    zeilen = [z for z in r.stdout.splitlines() if "systemctl" in z]
    assert zeilen[0].endswith("restart wireplumber")
    assert zeilen[1].endswith("restart pipewire pipewire-pulse wireplumber")
    assert r.returncode == 3  # the recorded state never changes in the test stand


def test_non_alsa_sink_is_refused(tmp_path):
    env = {**os.environ, "DJK_PROFIL_TROCKEN": "1"}
    r = subprocess.run([sys.executable, str(PROFIL), "--senke", "cypher_stumm"], capture_output=True, text=True, env=env, timeout=20)
    assert r.returncode == 3
    assert "not an ALSA output" in r.stderr
