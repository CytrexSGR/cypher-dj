"""One-class VST3 bundles: a copy of the shim module klasse.so (vst3_klasse/klasse.c) in front of one class of a real
multi-class VST3 bundle, so Carla 2.5.8 (which loads only the first class of a bundle) can load any class.

Layout of a generated bundle:
    <wurzel>/<plugin_id>.vst3/Contents/x86_64-linux/<plugin_id>.so   copy of klasse.so
    <wurzel>/<plugin_id>.vst3/Contents/Resources/klasse.txt          line 1 real module .so, line 2 class index k
k is the position of the class in the output of carla-discovery-native for the real bundle (the shim counts only the
"Audio Module Class" classes, as discovery does).
"""
import os
import shutil
from pathlib import Path

SHIM = Path.home() / ".local/lib/cypherdj/vst3_klasse/klasse.so"
WURZEL = Path.home() / ".local/state/cypherdj/plugins/klassen"
INHALT = "x86_64-linux"


def echtes_modul(echter_buendel):
    """The single .so under <bundle>/Contents/x86_64-linux/."""
    ordner = Path(echter_buendel) / "Contents" / INHALT
    module = sorted(p for p in ordner.glob("*.so") if p.is_file()) if ordner.is_dir() else []
    if len(module) != 1:
        raise FileNotFoundError(f"expected exactly one .so in {ordner}, found {len(module)}")
    return module[0].resolve()


def _schreibe(ziel, daten):
    """Replace ziel atomically when its content differs."""
    try:
        if ziel.read_bytes() == daten:
            return
    except OSError:
        pass
    neu = ziel.with_name(ziel.name + ".neu")
    neu.write_bytes(daten)
    os.replace(neu, ziel)


def buendel(echter_buendel, index, plugin_id, wurzel=WURZEL, shim=SHIM):
    """Create (idempotent) the one-class bundle for class `index` of `echter_buendel`; returns its path."""
    shim = Path(shim)
    if not shim.is_file():
        raise FileNotFoundError(f"shim not built: {shim} (run vst3_klasse/build.sh)")
    if int(index) < 0 or not plugin_id or "/" in plugin_id or plugin_id.startswith("."):
        raise ValueError(f"bad class index or plugin id: {index!r} {plugin_id!r}")
    modul = echtes_modul(echter_buendel)
    ziel = Path(wurzel) / f"{plugin_id}.vst3"
    binaer = ziel / "Contents" / INHALT
    res = ziel / "Contents" / "Resources"
    binaer.mkdir(parents=True, exist_ok=True)
    res.mkdir(parents=True, exist_ok=True)
    for alt in binaer.iterdir():
        if alt.name != f"{plugin_id}.so":
            if alt.is_dir() and not alt.is_symlink():
                shutil.rmtree(alt)
            else:
                alt.unlink()
    _schreibe(binaer / f"{plugin_id}.so", shim.read_bytes())
    _schreibe(res / "klasse.txt", f"{modul}\n{int(index)}\n".encode())
    return str(ziel)
