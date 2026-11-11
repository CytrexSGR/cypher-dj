"""Kontrollen mit bekannter Wahrheit (proben/07-werkstatt-zerleger, c_drift.log) und die
synthetische Takt-Eins-Kontrolle `eins_synth`."""
import hashlib, json, os, tempfile
from pathlib import Path
import numpy as np

WURZEL = Path(os.environ.get("CYPHERDJ_WURZEL", Path.home() / "cypher-dj"))
PROBEN07 = WURZEL / "proben" / "07-werkstatt-zerleger"
# The two synthetic controls and the drift time map are not stored in the public repository: when the author's probe folder is
# missing they are written from the recipe below (same code as proben/07 b_timemap.py, byte-identical, sha256 checked) into this
# folder. The author's files are used when present.
ERZEUGT = Path(os.environ.get("CYPHERDJ_KONTROLLEN", Path(tempfile.gettempdir()) / "cypherdj-kontrollen"))


def _pfad(vorhanden, name):
    return vorhanden if vorhanden.is_file() else ERZEUGT / name
BESTAND_SONGS = WURZEL / "samples" / "bestand"
MFBASS = WURZEL / "stems" / "mfbass"

# sha256 gemessen 2026-09-23 (Plan 05); eine andere Datei heisst: andere Wahrheit, Lauf bricht ab
KONTROLLEN = {
    "konst134": (_pfad(PROBEN07 / "b_out" / "konst134_quelle.wav", "konst134_quelle.wav"),
                 "4f46dfd2594d697d6149639b3907b0cd493d27eeb2d7acabed9aae8c42655722"),
    "drift_synth": (_pfad(PROBEN07 / "b_out" / "drift_quelle.wav", "drift_quelle.wav"),
                    "3e7b8d8a6b86bec501ba3a9d52ec3d864830a7bf648006738fcc9e4bed0ac58f"),
    "mfbass": (MFBASS / "orig.mp3",
               "5bac533628e1da8fec8acdc2cdcf8f0fbe2698a897cb90825d23f5a3b59255dd"),
}
DRIFT_TIMEMAP = (_pfad(PROBEN07 / "b_out" / "drift_timemap.txt", "drift_timemap.txt"),
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


SR = 48000
P128 = 22500   # samples per beat at 128 BPM and 48 kHz (60/128 * 48000)


def _klicktrack(schlaege_s, dauer_s, pfad):
    """1-kHz click track (60 ms bursts, 2 ms attack), 24-bit stereo WAV; returns the beat times that fit into the file."""
    import soundfile as sf
    n = int(dauer_s * SR)
    x = np.zeros(n)
    L = int(0.060 * SR)
    t = np.arange(L) / SR
    burst = 0.7 * np.sin(2 * np.pi * 1000 * t) * (np.minimum(1, t / 0.002) * np.exp(-t / 0.030))
    for s in schlaege_s:
        a = int(round(s * SR))
        if a + L < n:
            x[a:a + L] += burst
    Path(pfad).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(pfad), np.stack([x, x], 1).astype(np.float32), SR, subtype="PCM_24")
    return np.array([s for s in schlaege_s if int(round(s * SR)) + L < n])


def _erzeuge_konst134(pfad):
    """Constant 134 BPM click, 60.5 s: beats at 0.25 + i * 60/134 s."""
    _klicktrack(0.25 + np.arange(0, 60 * 134 / 60) * 60 / 134, 60.5, pfad)


def _drift_schlaege():
    """Beat times of the drifting source: bpm(t) = 127.5 + t/120 + 0.5 sin(2 pi t / 45), integrated at 0.1 ms."""
    D = 120.0
    tt = np.arange(0, D, 1e-4)
    bpm = 127.5 + 1 * tt / D + 0.5 * np.sin(2 * np.pi * tt / 45)
    phase = np.cumsum(bpm / 60) * 1e-4
    t0 = 0.25
    return np.concatenate([[t0], t0 + np.interp(np.arange(1, int(phase[-1]) - 1), phase, tt)]), D


def _erzeuge_drift_quelle(pfad):
    schlaege, D = _drift_schlaege()
    _klicktrack(schlaege, D + 1.0, pfad)


def _erzeuge_drift_timemap(pfad):
    """Source sample of every beat -> target sample on the rigid 128 grid (the file rubberband --timemap reads)."""
    schlaege, D = _drift_schlaege()
    with tempfile.TemporaryDirectory() as t:
        wahr = _klicktrack(schlaege, D + 1.0, Path(t) / "q.wav")
    s_src = np.round(wahr * SR).astype(int)
    s_tgt = s_src[0] + np.arange(len(s_src)) * P128
    Path(pfad).parent.mkdir(parents=True, exist_ok=True)
    with open(pfad, "w") as f:
        for a, b in zip(s_src, s_tgt):
            f.write(f"{a} {b}\n")


def pruefe(pfad, erwartet):
    """Checks the sha256 of a control file; a file that is missing and has a recipe here is written first."""
    erzeuger = {"4f46dfd2594d697d6149639b3907b0cd493d27eeb2d7acabed9aae8c42655722": _erzeuge_konst134,
                "3e7b8d8a6b86bec501ba3a9d52ec3d864830a7bf648006738fcc9e4bed0ac58f": _erzeuge_drift_quelle,
                "b724699087f105e0e8a321a2159fe76a92a06d99c8412623ea092dbf720d7728": _erzeuge_drift_timemap}
    if not Path(pfad).is_file() and erwartet in erzeuger:
        erzeuger[erwartet](pfad)
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
