"""The storage table (package djk/ablage) for the workshop.

The workshop runs with djk/workshop as the working directory (page server jobs, pytest pythonpath = .), so `ablage` is not
importable by name there. This loads the package from its file, without touching sys.path, and registers it as `ablage`
so a later `import ablage` gets the same module. The name is not shared with djk/starter/storage.py, which is a different thing.
"""
import importlib.util
import os
import sys
from pathlib import Path

_INIT = Path(__file__).resolve().parents[2] / "ablage" / "__init__.py"   # djk/ablage/__init__.py


def _lade():
    vorhanden = sys.modules.get("ablage")
    if vorhanden is not None and os.path.realpath(getattr(vorhanden, "__file__", "") or "") == str(_INIT):
        return vorhanden
    spec = importlib.util.spec_from_file_location("ablage", _INIT, submodule_search_locations=[str(_INIT.parent)])
    modul = importlib.util.module_from_spec(spec)
    sys.modules["ablage"] = modul
    spec.loader.exec_module(modul)
    return modul


ablage = _lade()
