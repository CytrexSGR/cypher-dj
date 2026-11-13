import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _anzeige_erreichbar(request, monkeypatch):
    """The tests name a fake DISPLAY (:9): reachability is answered true unless a test tests it itself (marker `echte_anzeige`)."""
    if "echte_anzeige" in request.keywords:
        return
    try:
        import host_control as wirtsteuerung
    except ModuleNotFoundError as e:
        if e.name == "carla_backend":   # no Carla installation: the tests that need it are skipped at collection, the others do not need the stub
            return
        raise
    monkeypatch.setattr(wirtsteuerung, "anzeige_erreichbar", lambda: True)


def pytest_configure(config):
    config.addinivalue_line("markers", "echte_anzeige: the test checks the display reachability itself (no stub)")


@pytest.hookimpl(hookwrapper=True)
def pytest_make_collect_report(collector):
    """A test file that needs Carla's Python module (part of a Carla installation, not on PyPI) is skipped with that reason when it is missing."""
    out = yield
    rep = out.get_result()
    if rep.outcome == "failed" and "No module named 'carla_backend'" in str(rep.longrepr):
        rep.outcome = "skipped"
        rep.longrepr = (str(collector.path), 0, "Skipped: carla_backend (Carla 2.5 installation) is not importable")
