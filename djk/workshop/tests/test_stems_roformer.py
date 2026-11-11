"""werkstatt.stems with BS-RoFormer (plan 2026-11-06-stems-roformer-gpu). Without GPU load: stem order, file names, overlap-add against a
stub model, the GPU rule (D2) with a fake torch. With the real model on the GPU: tests marked `gpu`, run with `-m gpu`; missing weights
or CUDA there are a FAILURE, not a skip (review M2 of slice 6)."""
import os

import numpy as np
import pytest

from werkstatt import stems
from click_helper import braucht_torch


# --- stub model: no GPU, no weights ---
KONST = {"bass": 0.1, "drums": 0.2, "other": 0.3, "vocals": 0.4, "guitar": 0.5, "piano": 0.6}   # literal, catches a swapped order


class _StubModell:
    """Returns per stem a constant in the model's output order (MODELL_STEMS), shape (1, 6, 2, n) like BSRoformer."""
    def __call__(self, x):
        import torch
        n = x.shape[-1]
        return torch.stack([torch.full((2, n), KONST[s]) for s in stems.MODELL_STEMS])[None]


def _stub_trenner(monkeypatch):
    import torch

    def trenner(gewichte, threads):
        def trenne(x441, melde):
            y = stems.ueberlapp_addieren(_StubModell(), x441, melde, torch, "cpu")
            return torch.stack([y[stems.MODELL_STEMS.index(s)] for s in stems.STEMS])
        trenne.geraet = "stub"
        return trenne
    monkeypatch.setattr(stems, "_roformer_trenner", trenner)


@braucht_torch
def test_ueberlapp_addieren_haelt_konstanten_und_laenge():
    """The windows sum to the counter, so a constant model output stays that constant everywhere, also over the reflect padding."""
    import torch
    for n in (5 * 44100, 30 * 44100 + 7):                      # one short (no padding) and one long (padding, several chunks)
        gemeldet = []
        y = stems.ueberlapp_addieren(_StubModell(), torch.zeros(2, n), lambda s, p=None, t=None: gemeldet.append(p), torch, "cpu")
        assert tuple(y.shape) == (6, 2, n)
        for i, s in enumerate(stems.MODELL_STEMS):
            assert float((y[i] - KONST[s]).abs().max()) < 1e-6, s
        assert gemeldet == sorted(gemeldet) and gemeldet[-1] == 100.0


@braucht_torch
def test_zuordnung_dateien_tragen_den_namen(monkeypatch, tmp_path):
    _stub_trenner(monkeypatch)
    q = tmp_path / "q.f32"
    (0.01 * np.random.default_rng(4).standard_normal(2 * 6 * 48000)).astype("<f4").tofile(q)   # not silent: silence drops guitar and piano (D4)
    assert stems.main(["--quelle", str(q), "--f0", "48000", "--f1", "240000", "--aus", str(tmp_path / "o")]) == 0
    for s in stems.STEMS:                                      # stub output is loud everywhere: all six placed
        d = np.fromfile(tmp_path / "o" / f"{s}.f32", dtype="<f4")
        mitte = d[len(d) // 4: 3 * len(d) // 4]
        assert abs(float(mitte.mean()) - KONST[s]) < 0.01, f"{s}.f32 does not carry the constant of {s}"


class _FalschCuda:
    def __init__(self, da=True, frei=8000, gesamt=12000):
        self.da, self.frei, self.gesamt, self.deckel = da, frei, gesamt, None

    def is_available(self):
        return self.da

    def mem_get_info(self):
        return self.frei * 2**20, self.gesamt * 2**20

    def set_per_process_memory_fraction(self, f):
        self.deckel = f


class _FalschTorch:
    def __init__(self, **k):
        self.cuda = _FalschCuda(**k)


def test_pruefe_gpu_nur_mit_platz_und_gedeckelt():
    t = _FalschTorch(frei=8000)
    stems.pruefe_gpu(t, frei_mb=4500)
    assert abs(t.cuda.deckel - stems.GPU_DECKEL_MB / 12000) < 1e-9
    t = _FalschTorch(frei=4000)
    with pytest.raises(stems.GpuFehler) as e:
        stems.pruefe_gpu(t, frei_mb=4500)
    assert e.value.grund == "gpu_belegt" and t.cuda.deckel is None
    with pytest.raises(stems.GpuFehler) as e:
        stems.pruefe_gpu(_FalschTorch(da=False), frei_mb=4500)
    assert e.value.grund == "keine_gpu"


def test_gpu_fehler_wird_ergebniszeile_ohne_dateien(monkeypatch, tmp_path, capsys):
    def trenner(gewichte, threads):
        raise stems.GpuFehler("gpu_belegt", "1000 MB free on the GPU, 4500 needed")
    monkeypatch.setattr(stems, "_roformer_trenner", trenner)
    q = tmp_path / "q.f32"
    np.zeros(2 * 3 * 48000, dtype="<f4").tofile(q)
    assert stems.main(["--quelle", str(q), "--f0", "0", "--f1", "48000", "--aus", str(tmp_path / "o")]) == 1
    import json
    j = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert j["status"] == "fehler" and j["grund"] == "gpu_belegt" and not (tmp_path / "o").exists()


@braucht_torch
def test_falsche_gewichte_werden_abgelehnt(tmp_path):
    f = tmp_path / "x.ckpt"; f.write_bytes(b"x")
    with pytest.raises(RuntimeError, match="gewichte_sha"):
        stems.lade_modell(f)


def test_stems_default_threads_two():
    """AK26 (2026-11-04): 4 threads raised the set's p99.9 by ~600 us, 2 by 156 us (limit 200); the default is 2."""
    assert stems.STEMS_THREADS == 2


# --- real model on the GPU (`pytest -m gpu`) ---
@pytest.mark.gpu
def test_echte_trennung_kurz_deterministisch_und_vram():
    import torch
    assert stems.GEWICHTE.is_file(), f"missing {stems.GEWICHTE}: python -m werkstatt.weights_stems --von <file>"
    assert torch.cuda.is_available(), "no CUDA: the gpu tests need the GPU"
    rng = np.random.default_rng(1)
    x = torch.from_numpy((0.1 * rng.standard_normal((2, 20 * 44100))).astype(np.float32))
    trenne = stems._roformer_trenner(stems.GEWICHTE, 2)
    gemeldet = []
    y1 = trenne(x, lambda n, p=None, t=None: gemeldet.append(p))
    y2 = trenne(x, lambda *a, **k: None)
    assert tuple(y1.shape) == (6, 2, 20 * 44100)
    assert torch.equal(y1, y2)
    assert gemeldet[-1] == 100.0 and trenne.vram_mb is not None and trenne.vram_mb < stems.GPU_DECKEL_MB
    assert os.environ.get("CUDA_VISIBLE_DEVICES", "0") != ""
