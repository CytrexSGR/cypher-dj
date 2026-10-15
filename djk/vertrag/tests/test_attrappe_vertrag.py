"""B1-Regressionsschutz: der bestehende Node-Test der Attrappe (Adresstabellen gegen osc.json) im pytest-Lauf.
Eigene Datei, weil er node und den Arbeitsbaum braucht und mit dem Namenslisten-Prüfer nichts teilt."""
import subprocess
from pathlib import Path

VERTRAG = Path(__file__).resolve().parents[1]


def test_attrappe_adressen_gegen_osc_json():
    r = subprocess.run(["node", "--test", "attrappe_kern/tests/vertrag.test.mjs"], cwd=VERTRAG,
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stdout[-800:]
