"""im_container.sh with a stub podman: the cargo target folder is a volume whose name carries the image id, and the volumes of other images go."""
import os
import subprocess
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[1] / "ci" / "im_container.sh"

PODMAN = r"""#!/bin/bash
D=$(dirname "$0")
case "$1 $2" in
  "image inspect") echo "${STUB_ID-sha256:0123456789abcdef0123}" ;;
  "volume ls") printf '%s\n' cdjci-ccache cdjci-cargo-target-aaaaaaaaaaaa cdjci-cargo-target-0123456789ab cdjci-cargo-target-bbbbbbbbbbbb ;;
  "volume rm") shift 2; echo "$@" >> "$D/entfernt" ;;
  *) [ "$1" = run ] && printf '%s\n' "$@" > "$D/run.args" ;;
esac
"""


def lauf(tmp: Path, **env):
    (tmp / "podman").write_text(PODMAN)
    (tmp / "podman").chmod(0o755)
    e = {**os.environ, "PATH": f"{tmp}:{os.environ['PATH']}", "CI_GPU": "0", "CI_GEWICHTE": str(tmp / "none"), "CI_STRUDEL": str(tmp / "none")}
    e.update(env)
    r = subprocess.run(["bash", str(SKRIPT), "true"], env=e, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return (tmp / "run.args").read_text().split("\n")


def test_target_volume_carries_the_image_id(tmp_path):
    a = lauf(tmp_path)
    repo = str(SKRIPT.parents[3])
    assert f"cdjci-cargo-target-0123456789ab:{repo}/djk/instruments/target" in a
    assert "cdjci-ccache:/home/bau/.cache/ccache" in a   # the old caches stay


def test_other_images_volumes_are_removed(tmp_path):
    lauf(tmp_path)
    assert sorted((tmp_path / "entfernt").read_text().split()) == ["cdjci-cargo-target-aaaaaaaaaaaa", "cdjci-cargo-target-bbbbbbbbbbbb"]


def test_unknown_image_id_still_gives_a_volume(tmp_path):
    a = lauf(tmp_path, STUB_ID="")
    assert any(x.startswith("cdjci-cargo-target-noid:") for x in a)
