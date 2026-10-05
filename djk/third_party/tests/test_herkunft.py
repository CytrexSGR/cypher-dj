"""Tests für pruefe_herkunft.py: python3 -m pytest djk/third_party/tests -q"""
import shutil
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pruefe_herkunft  # noqa: E402


def _kopie(tmp_path: Path) -> Path:
    ziel = tmp_path / "third_party"
    shutil.copytree(HIER, ziel, ignore=shutil.ignore_patterns("build", "__pycache__"))
    return ziel


def test_gruen():
    assert pruefe_herkunft.pruefe(HIER) == []


def test_ein_byte_anders_ist_rot(tmp_path):
    ziel = _kopie(tmp_path)
    pfad = ziel / "toml++" / "toml.hpp"
    daten = bytearray(pfad.read_bytes())
    daten[100] ^= 0x01
    pfad.write_bytes(bytes(daten))
    assert any(f.startswith("toml++: toml++/toml.hpp sha256") for f in pruefe_herkunft.pruefe(ziel))


def test_ungelistete_datei_ist_rot(tmp_path):
    ziel = _kopie(tmp_path)
    (ziel / "nlohmann" / "json_fwd.hpp").write_text("// fremd\n", encoding="utf-8")
    assert "nlohmann/json_fwd.hpp liegt in djk/third_party/, steht aber nicht in herkunft.json" in \
        pruefe_herkunft.pruefe(ziel)
