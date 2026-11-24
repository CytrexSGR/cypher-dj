"""Guards of the CI image build: build.sh (cache against MANIFEST, heavy packages in requirements.txt) and apt-sicher.sh (1 GB limit).
They run the real scripts with a stub `podman` / `apt-get` in PATH, so nothing is built or downloaded."""
import os
import shutil
import stat
import subprocess
from pathlib import Path

IMAGE = Path(__file__).resolve().parents[1] / "ci" / "image"


def stub(bin_dir: Path, name: str, body: str) -> None:
    f = bin_dir / name
    f.write_text("#!/bin/bash\n" + body + "\n")
    f.chmod(f.stat().st_mode | stat.S_IEXEC)


def baum(tmp: Path, requirements: str, manifest: str, folders: dict):
    """A copy of the repo layout djk/tools/ci/image with its own requirements.txt and a cache folder."""
    img = tmp / "repo" / "djk" / "tools" / "ci" / "image"
    img.mkdir(parents=True)
    for n in ("build.sh", "Containerfile", "kf_cli.cpp", "apt-sicher.sh"):
        shutil.copy(IMAGE / n, img / n)
    (tmp / "repo" / "djk" / "requirements.txt").write_text(requirements)
    cache = tmp / "cache"
    for name, files in folders.items():
        (cache / name).mkdir(parents=True)
        for fn, data in files.items():
            (cache / name / fn).write_bytes(data)
    (cache / "MANIFEST").write_text(manifest)
    bin_dir = tmp / "bin"
    bin_dir.mkdir()
    stub(bin_dir, "podman", 'case "$1 $2" in "image exists") exit 1;; build*) echo BUILD-CALLED >&2; exit 0;; esac; exit 0')
    return img / "build.sh", cache, bin_dir


def lauf(script, cache, bin_dir):
    env = dict(os.environ, CI_IMAGE_CACHE=str(cache), PATH=f"{bin_dir}:{os.environ['PATH']}")
    return subprocess.run(["bash", str(script)], capture_output=True, text=True, env=env)


def bytes_von(ordner: Path) -> int:
    return int(subprocess.check_output(["du", "-sb", str(ordner)]).split()[0])


ALLE = ("torch-gpu", "werkstatt-venv-sp", "mik-sp", "mik-modelle", "wheels")


def richtig(tmp: Path, requirements="numpy>=2.4\n"):
    folders = {n: {"a.bin": b"x" * 100} for n in ALLE}
    script, cache, bin_dir = baum(tmp, requirements, "", folders)
    (cache / "MANIFEST").write_text("".join(f"{n} 1 {bytes_von(cache / n)}\n" for n in ALLE))
    return script, cache, bin_dir


def test_matching_cache_builds(tmp_path):
    script, cache, bin_dir = richtig(tmp_path)
    r = lauf(script, cache, bin_dir)
    assert r.returncode == 0, r.stderr
    assert "BUILD-CALLED" in r.stderr


def test_cache_folder_not_matching_manifest_stops(tmp_path):
    script, cache, bin_dir = richtig(tmp_path)
    (cache / "torch-gpu" / "b.bin").write_bytes(b"y")  # a file the MANIFEST does not know
    r = lauf(script, cache, bin_dir)
    assert r.returncode == 3
    assert "torch-gpu does not match MANIFEST" in r.stderr
    assert "BUILD-CALLED" not in r.stderr


def test_truncated_file_in_cache_stops(tmp_path):
    script, cache, bin_dir = richtig(tmp_path)
    (cache / "mik-sp" / "a.bin").write_bytes(b"x" * 10)  # same count, fewer bytes (a half-copied file)
    r = lauf(script, cache, bin_dir)
    assert r.returncode == 3 and "mik-sp does not match MANIFEST" in r.stderr


def test_manifest_without_a_needed_folder_stops(tmp_path):
    script, cache, bin_dir = richtig(tmp_path)
    lines = [l for l in (cache / "MANIFEST").read_text().splitlines() if not l.startswith("wheels ")]
    (cache / "MANIFEST").write_text("\n".join(lines) + "\n")
    r = lauf(script, cache, bin_dir)
    assert r.returncode == 3 and "no line for 'wheels'" in r.stderr


def test_missing_cache_folder_stops(tmp_path):
    script, cache, bin_dir = richtig(tmp_path)
    shutil.rmtree(cache / "wheels")
    r = lauf(script, cache, bin_dir)
    assert r.returncode == 3 and "no 'wheels'" in r.stderr


def test_uncommented_torch_in_requirements_stops_without_download(tmp_path):
    for zeile in ("torch\n", "torch>=2.10\n", "  torchvision==0.25\n", "nvidia-cudnn-cu12\n", "triton\n", "tensorflow\n"):
        sub = tmp_path / zeile.strip().replace(">", "").replace("=", "")
        sub.mkdir()
        script, cache, bin_dir = richtig(sub, "numpy>=2.4\n" + zeile)
        r = lauf(script, cache, bin_dir)
        assert r.returncode == 3, (zeile, r.stderr)
        assert "active torch/tensorflow/nvidia/triton line" in r.stderr
        assert "BUILD-CALLED" not in r.stderr


def test_commented_torch_is_fine(tmp_path):
    script, cache, bin_dir = richtig(tmp_path, "numpy>=2.4\n#   torch (CUDA build)\n# torch\n")
    assert lauf(script, cache, bin_dir).returncode == 0


def test_containerfile_installs_offline_with_pipefail():
    text = (IMAGE / "Containerfile").read_text()
    assert 'SHELL ["/bin/bash", "-o", "pipefail", "-c"]' in text
    pips = [l for l in text.splitlines() if "pip install" in l]
    assert pips and all("--no-index" in l for l in pips)
    assert "podman build -q --format docker" in (IMAGE / "build.sh").read_text()  # SHELL is ignored in OCI format


def apt_lauf(tmp: Path, size: int):
    bin_dir = tmp / "bin"
    bin_dir.mkdir()
    stub(bin_dir, "apt-get", f'''case "$*" in *print-uris*) echo "'http://x/a.deb' a.deb {size} MD5Sum:00";; *install*) echo INSTALL-CALLED >&2;; esac''')
    stub(bin_dir, "rm", "exit 0")
    env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}")
    return subprocess.run(["bash", str(IMAGE / "apt-sicher.sh"), "paket"], capture_output=True, text=True, env=env)


def test_apt_over_one_gb_stops(tmp_path):
    r = apt_lauf(tmp_path, 1073741825)
    assert r.returncode == 3 and "STOP" in r.stderr and "INSTALL-CALLED" not in r.stderr


def test_apt_under_one_gb_installs(tmp_path):
    r = apt_lauf(tmp_path, 300000000)
    assert r.returncode == 0 and "INSTALL-CALLED" in r.stderr
