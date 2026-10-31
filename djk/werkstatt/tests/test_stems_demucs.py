"""werkstatt.stems mit echtem htdemucs, nur CPU, ohne Netz (Slice 6, P1). Kurz: 3 s Rauschen mit Klicks."""
import importlib.util
import os

import numpy as np
import pytest

from werkstatt import stems

# Review M2: fehlen demucs oder Gewichte, ist das ein FEHLER, kein stilles Ueberspringen. Nur mit DJK_STEMS_OHNE_DEMUCS=1 (ausdruecklich, z. B. auf einem
# Rechner ohne Task 1) wird uebersprungen, und pytest zeigt es mit -rs als SKIPPED; ein solcher Lauf gilt nicht als gruen.
_FEHLT = [x for x, ok in (("demucs", importlib.util.find_spec("demucs") is not None), (str(stems.GEWICHTE), stems.GEWICHTE.is_file())) if not ok]
if _FEHLT and os.environ.get("DJK_STEMS_OHNE_DEMUCS") == "1":
    pytestmark = pytest.mark.skip(reason=f"DJK_STEMS_OHNE_DEMUCS=1, es fehlt: {_FEHLT}")


@pytest.fixture(autouse=True)
def _vorhanden():
    if _FEHLT and os.environ.get("DJK_STEMS_OHNE_DEMUCS") != "1":
        pytest.fail(f"es fehlt {_FEHLT}: Task 1 (Installation) und im Worktree den gewichte-Symlink (Arbeitsweise) nachholen")


def test_laden_ohne_netz_und_nur_cpu(monkeypatch):
    assert os.environ.get("CUDA_VISIBLE_DEVICES") == "", "Test nur mit CUDA_VISIBLE_DEVICES= starten"
    import torch.hub

    def kein_netz(*a, **k):
        raise AssertionError("Netz-Zugriff beim Laden")
    monkeypatch.setattr(torch.hub, "load_state_dict_from_url", kein_netz)
    m = stems.lade_modell(stems.GEWICHTE)
    assert list(m.sources) == list(stems.STEMS)
    assert m.samplerate == stems.SR_MODELL
    assert all(p.device.type == "cpu" for p in m.parameters())


def test_falsche_gewichte_werden_abgelehnt(tmp_path):
    f = tmp_path / "x.th"; f.write_bytes(b"x")
    with pytest.raises(RuntimeError, match="gewichte_sha"):
        stems.lade_modell(f)


def test_trennung_kurz_bitgleich_zweimal_und_fortschritt():
    import torch
    rng = np.random.default_rng(1)
    x = torch.from_numpy((0.1 * rng.standard_normal((2, 3 * 44100))).astype(np.float32))
    gemeldet = []
    trenne = stems._demucs_trenner(stems.GEWICHTE, 4)
    y1 = trenne(x, lambda n, p=None, t=None: gemeldet.append((n, p)))
    y2 = trenne(x, lambda *a, **k: None)
    assert tuple(y1.shape) == (4, 2, 3 * 44100)
    assert torch.equal(y1, y2)                                 # D18: shifts=0, deterministisch
    assert gemeldet and gemeldet[-1] == ("trennen", 100.0)
    assert torch.get_num_threads() == 4


# --- Nachbesserung T3 (Review): Quellen-Zuordnung und D18-Parameter, ohne Rechenlast ---
KONST = {"drums": 0.1, "bass": 0.2, "other": 0.3, "vocals": 0.4}


class _StubModell:
    sources = ["vocals", "drums", "bass", "other"]            # absichtlich anders als STEMS


def _stub_apply(aufrufe):
    import torch

    def apply_model(modell, mix, **kw):
        aufrufe.append(kw)
        y = torch.stack([torch.full((2, mix.shape[-1]), KONST[s]) for s in modell.sources])
        return y[None]
    return apply_model


def test_zuordnung_trenner_stub_permutierte_quellen(monkeypatch):
    import torch
    import demucs.apply as da
    aufrufe = []
    monkeypatch.setattr(stems, "lade_modell", lambda pfad: _StubModell())
    monkeypatch.setattr(da, "apply_model", _stub_apply(aufrufe))
    y = stems._demucs_trenner("egal", 4)(torch.zeros(2, 1000), lambda *a, **k: None)
    for i, s in enumerate(stems.STEMS):
        assert float(y[i].mean()) == pytest.approx(KONST[s]), f"Stem {i} soll {s} tragen"


def test_zuordnung_dateien_tragen_den_namen(monkeypatch, tmp_path):
    import demucs.apply as da
    monkeypatch.setattr(stems, "lade_modell", lambda pfad: _StubModell())
    monkeypatch.setattr(da, "apply_model", _stub_apply([]))
    q = tmp_path / "q.f32"
    np.zeros(2 * 6 * 48000, dtype="<f4").tofile(q)
    assert stems.main(["--quelle", str(q), "--f0", "48000", "--f1", "240000", "--aus", str(tmp_path / "o")]) == 0
    for s in stems.STEMS:
        d = np.fromfile(tmp_path / "o" / f"{s}.f32", dtype="<f4")
        mitte = d[len(d) // 4: 3 * len(d) // 4]
        assert abs(float(mitte.mean()) - KONST[s]) < 0.01, f"{s}.f32 traegt nicht die Konstante von {s}"


def test_d18_parameter_an_apply_model(monkeypatch):
    import torch
    import demucs.apply as da
    echt = da.apply_model
    aufrufe = []

    def spion(*a, **kw):
        aufrufe.append(kw)
        return echt(*a, **kw)
    monkeypatch.setattr(da, "apply_model", spion)
    x = torch.from_numpy((0.1 * np.random.default_rng(2).standard_normal((2, 2 * 44100))).astype(np.float32))
    stems._demucs_trenner(stems.GEWICHTE, 4)(x, lambda *a, **k: None)
    kw = aufrufe[0]                                            # erster Aufruf = der von trenne(); die weiteren sind demucs-interne Rekursion
    assert kw["progress"] is True and kw["num_workers"] == 0
    assert (kw["shifts"], kw["split"], kw["overlap"], kw["device"]) == (0, True, 0.25, "cpu")


def test_fortschritt_mehrere_chunks_monoton():
    import torch
    x = torch.from_numpy((0.1 * np.random.default_rng(3).standard_normal((2, 13 * 44100))).astype(np.float32))
    gemeldet = []
    stems._demucs_trenner(stems.GEWICHTE, 4)(x, lambda n, p=None, t=None: gemeldet.append(p))
    assert len(gemeldet) > 1 and gemeldet == sorted(gemeldet) and len(set(gemeldet)) == len(gemeldet) and gemeldet[-1] == 100.0
