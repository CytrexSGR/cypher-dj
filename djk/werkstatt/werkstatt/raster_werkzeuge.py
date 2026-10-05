"""Raster-Werkzeuge: beat_this setzt die Karte, Essentia ist Zweitwerkzeug (AGPL-3.0, nur
Pruefmittel, ARCHITEKTUR §8.2). Beide bekommen fertig dekodierte Mono-Signale."""
from pathlib import Path
import numpy as np

SR_BEAT_THIS = 22050
SR_ESSENTIA = 44100
GEWICHTE = Path(__file__).resolve().parent.parent / "gewichte" / "beat_this-final0.ckpt"

_modelle = {}


def beat_this(x, gewichte=GEWICHTE, geraet="cpu"):
    """(schlaege_s, downbeats_s) aus Mono-Signal bei 22 050 Hz. Fehlt die Gewichtsdatei, bricht
    das ab: beat_this wuerde sonst still aus dem Netz nachladen (inference.py `load_checkpoint`)."""
    gewichte = Path(gewichte)
    if not gewichte.is_file():
        raise FileNotFoundError(f"Gewichte fehlen: {gewichte} (erst: python -m werkstatt.gewichte)")
    from beat_this.inference import Audio2Beats
    schluessel = (str(gewichte), geraet)
    if schluessel not in _modelle:
        _modelle[schluessel] = Audio2Beats(checkpoint_path=str(gewichte), device=geraet)
    b, d = _modelle[schluessel](np.asarray(x, dtype=np.float32), SR_BEAT_THIS)
    return np.asarray(b, dtype=float), np.asarray(d, dtype=float)


def essentia_schlaege(x):
    """(ticks_s, bpm, konfidenz) aus Mono-Signal bei 44 100 Hz, RhythmExtractor2013 multifeature."""
    import essentia.standard as es
    bpm, ticks, konfidenz, _, _ = es.RhythmExtractor2013(method="multifeature")(np.asarray(x, dtype=np.float32))
    return np.asarray(ticks, dtype=float), float(bpm), float(konfidenz)
