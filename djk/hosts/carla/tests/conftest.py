import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _anzeige_erreichbar(request, monkeypatch):
    """The tests name a fake DISPLAY (:9): reachability is answered true unless a test tests it itself (marker `echte_anzeige`)."""
    if "echte_anzeige" in request.keywords:
        return
    import host_control as wirtsteuerung
    monkeypatch.setattr(wirtsteuerung, "anzeige_erreichbar", lambda: True)


def pytest_configure(config):
    config.addinivalue_line("markers", "echte_anzeige: the test checks the display reachability itself (no stub)")
