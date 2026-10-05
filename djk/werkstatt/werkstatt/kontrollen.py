"""Kontrollen mit bekannter Wahrheit (proben/07-werkstatt-zerleger, c_drift.log) und die
synthetische Takt-Eins-Kontrolle `eins_synth`."""
import hashlib, json, os
from pathlib import Path
import numpy as np

WURZEL = Path(os.environ.get("CYPHERDJ_WURZEL", Path.home() / "cypher-dj"))
PROBEN07 = WURZEL / "proben" / "07-werkstatt-zerleger"
BESTAND_SONGS = WURZEL / "samples" / "bestand"
MFBASS = WURZEL / "stems" / "mfbass"

# sha256 gemessen 2026-09-23 (Plan 05); eine andere Datei heisst: andere Wahrheit, Lauf bricht ab
KONTROLLEN = {
    "konst134": (PROBEN07 / "b_out" / "konst134_quelle.wav",
                 "4f46dfd2594d697d6149639b3907b0cd493d27eeb2d7acabed9aae8c42655722"),
    "drift_synth": (PROBEN07 / "b_out" / "drift_quelle.wav",
                    "3e7b8d8a6b86bec501ba3a9d52ec3d864830a7bf648006738fcc9e4bed0ac58f"),
    "mfbass": (MFBASS / "orig.mp3",
               "5bac533628e1da8fec8acdc2cdcf8f0fbe2698a897cb90825d23f5a3b59255dd"),
}
DRIFT_TIMEMAP = (PROBEN07 / "b_out" / "drift_timemap.txt",
                 "b724699087f105e0e8a321a2159fe76a92a06d99c8412623ea092dbf720d7728")
MFBASS_BEATS = (MFBASS / "beats.json",
                "ff212ee4f5cf3aa007c4de6cb1516bfb0255f8196866128809f19fd6d84b48bf")
EINS_SYNTH_SHA256 = "a0f637fa37891aa4cb7fb9a01e3cddd9bac69821814ac4b6cd5fe4e457204bca"   # erzeuge_eins_synth()


def sha256(pfad):
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def pruefe(pfad, erwartet):
    ist = sha256(pfad)
    if ist != erwartet:
        raise RuntimeError(f"{pfad}: sha256 {ist} statt {erwartet}")
    return Path(pfad)


def wahrheit_konst134():
    """b_timemap.py: klicktrack(0.25 + np.arange(0, 60 * 134 / 60) * 60 / 134, 60.5, ...)."""
    return 0.25 + np.arange(134) * 60.0 / 134.0


def wahrheit_drift():
    """drift_timemap.txt Spalte 1 = Quell-Sample jedes Schlags (b_timemap.py `s_src`), 48 kHz."""
    pruefe(*DRIFT_TIMEMAP)
    return np.loadtxt(DRIFT_TIMEMAP[0])[:, 0] / 48000.0


def referenz_mfbass():
    """beats.json: festes Raster 134,000 BPM, Eins = Traktor-AutoGrid 678,904 ms (ID3)."""
    pruefe(*MFBASS_BEATS)
    d = json.loads(MFBASS_BEATS[0].read_text())
    return {"bpm": float(d["bpm_gerade"]), "eins_s": float(d["beats"][0]), "schlaege": np.array(d["beats"])}


def erzeuge_eins_synth(pfad, bpm=128.0, takte=24, auftakt=2, sr=48000):
    """House-Muster mit bekannter Eins: Kick (Sweep 120 -> 50 Hz) auf jedem Schlag, auf der Eins
    lauter und mit Basston 41,2 Hz; Clap auf 2 und 4; leise Hi-Hat auf den Offbeats. Die Datei
    beginnt mit `auftakt` Schlaegen vor der ersten Eins. Rueckgabe: (schlagzeiten_s, eins_zeiten_s)."""
    from scipy import signal
    from scipy.io import wavfile
    per = 60.0 / bpm
    n_schlaege = auftakt + 4 * takte
    schlaege = 0.5 + per * np.arange(n_schlaege)
    x = np.zeros(int((schlaege[-1] + 2 * per) * sr))
    rng = np.random.default_rng(5)
    tk = np.arange(int(0.3 * sr)) / sr
    f = 50 + 70 * np.exp(-tk / 0.03)
    kick = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-tk / 0.15)
    bass = np.sin(2 * np.pi * 41.2 * tk) * np.minimum(1, tk / 0.005) * np.exp(-tk / 0.2)
    tc = np.arange(int(0.12 * sr)) / sr
    clap = signal.sosfilt(signal.butter(2, [1000, 3000], "bandpass", fs=sr, output="sos"),
                          rng.standard_normal(len(tc))) * np.exp(-tc / 0.03)
    th = np.arange(int(0.04 * sr)) / sr
    hat = signal.sosfilt(signal.butter(2, 7000, "highpass", fs=sr, output="sos"),
                         rng.standard_normal(len(th))) * np.exp(-th / 0.01)
    for i, s in enumerate(schlaege):
        a = int(round(s * sr))
        lage = (i - auftakt) % 4
        x[a:a + len(kick)] += (0.9 if lage == 0 else 0.6) * kick
        if lage == 0:
            x[a:a + len(bass)] += 0.5 * bass
        if lage in (1, 3):
            x[a:a + len(clap)] += 0.5 * clap
        h = int(round((s + per / 2) * sr))
        if h + len(hat) < len(x):
            x[h:h + len(hat)] += 0.08 * hat
    x *= 0.5 / np.abs(x).max()
    Path(pfad).parent.mkdir(parents=True, exist_ok=True)
    # scipy statt soundfile: libsndfile schreibt in Float-WAV einen PEAK-Block mit Uhrzeit, dann
    # hat jede Erzeugung eine andere sha256 (Planprobe 2026-09-23); so ist die Datei bytegleich.
    wavfile.write(str(pfad), sr, np.stack([x, x], 1).astype(np.float32))
    return schlaege, schlaege[auftakt::4]
