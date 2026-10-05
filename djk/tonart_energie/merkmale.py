"""Merkmale je Track: einmal dekodieren, alles daraus rechnen, als JSON (Skalare) + NPZ (Vektoren) cachen.

Tonart:  libKeyFinder (eigenes kleines CLI, liest PCM von stdin) · Essentia-HPCP 36 Bins mit
         KeyExtractor-ähnlicher Einstellung, darauf es.Key mit mehreren Profilen (ess_*) · zusätzlich
         es.KeyExtractor voll je Profil (essx_*), weil die Nachbildung am ersten Track abwich.
Energie: EBU R128 (integriert, LRA, Kurzzeit-Verteilung), Spitze/RMS/Crest, drei Bänder mit Verlauf,
         Onsetrate, spektraler Schwerpunkt/Fluss, Dynamik-Komplexität, Anteil lauter Abschnitte,
         BPM aus Tag; Essentia-TF: MusiCNN (DEAM/emoMusic/MuSe Arousal+Valence, Danceability,
         Moods) und Discogs-EffNet (Engagement, Approachability, Jamendo-Mood).
Nur CPU. Kein Ton.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "1")
os.environ.setdefault("TF_NUM_INTEROP_THREADS", "1")

import numpy as np

from .camelot import aus_keyfinder, aus_name, zu_camelot

VENV = Path.home() / "cypher-dj/cues/venv-mik"
KF_CLI = VENV / "bin/keyfinder-stdin"
MODELLE = VENV / "modelle"
CACHE = Path.home() / "cypher-dj/cues/merkmale"
SR = 44100
PROFILE = ["edma", "edmm", "bgate", "braw", "temperley", "krumhansl", "shaath"]
JAMENDO_AUSWAHL = ["energetic", "powerful", "fast", "party", "upbeat", "dark", "calm", "relaxing", "slow", "heavy"]
BAENDER = {"tief": (20, 150), "mitte": (150, 2500), "hoch": (2500, 16000)}
N_VERLAUF = 64


def track_id(pfad: str) -> str:
    return hashlib.sha1(pfad.encode()).hexdigest()[:16]


def dekodiere(pfad: str, sr: int = SR) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", pfad, "-ac", "1", "-ar", str(sr),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


# ---------- Tonart ----------

def keyfinder(x: np.ndarray, sr: int = SR) -> tuple[str | None, np.ndarray]:
    out = subprocess.run([str(KF_CLI), str(sr)], input=x.astype(np.float32).tobytes(),
                         capture_output=True, check=True).stdout.decode().splitlines()
    k = aus_keyfinder(int(out[0]))
    chroma = np.array([float(v) for v in out[1].split()]) if len(out) > 1 else np.zeros(72)
    return (zu_camelot(*k) if k else None), chroma


def hpcp_rahmen(x: np.ndarray, es) -> np.ndarray:
    """HPCP je Rahmen wie im KeyExtractor (frame 4096, hop 4096, hann, 25..3500 Hz, cosine), aber 36 Bins."""
    fen = es.Windowing(type="hann")
    spek = es.Spectrum(size=4096)
    peaks = es.SpectralPeaks(orderBy="magnitude", magnitudeThreshold=1e-4, minFrequency=25,
                             maxFrequency=3500, maxPeaks=60, sampleRate=SR)
    hpcp = es.HPCP(size=36, referenceFrequency=440, harmonics=4, bandPreset=True, minFrequency=25,
                   maxFrequency=3500, weightType="cosine", nonLinear=False, windowSize=1.0, sampleRate=SR)
    rows = []
    for fr in es.FrameGenerator(x, frameSize=4096, hopSize=4096, startFromZero=True):
        f, m = peaks(spek(fen(fr)))
        rows.append(hpcp(f, m))
    return np.array(rows, dtype=np.float32)


def tonart(x: np.ndarray, es) -> tuple[dict, dict]:
    z, v = {}, {}
    t = time.perf_counter()
    z["kf_key"], v["kf_chroma72"] = keyfinder(x)
    z["t_keyfinder"] = time.perf_counter() - t

    t = time.perf_counter()
    H = hpcp_rahmen(x, es)
    mittel = H.mean(0) if len(H) else np.zeros(36, np.float32)
    mittel = mittel / (mittel.max() or 1)
    v["hpcp36"] = mittel
    seg = np.array_split(H, 16) if len(H) >= 16 else [H]
    v["hpcp36_segmente"] = np.array([s.mean(0) if len(s) else np.zeros(36) for s in seg], dtype=np.float32)
    for prof in PROFILE:
        key, scale, staerke, erste_zu_zweite = es.Key(profileType=prof, pcpSize=36, numHarmonics=4,
                                                     slope=0.6, usePolyphony=True, useThreeChords=True)(mittel)[:4]
        z[f"ess_{prof}_key"] = zu_camelot(*aus_name(key, scale))
        z[f"ess_{prof}_staerke"] = float(staerke)
        z[f"ess_{prof}_abstand"] = float(erste_zu_zweite)
    z["t_hpcp_keys"] = time.perf_counter() - t

    t = time.perf_counter()
    for prof in PROFILE:                                     # voller KeyExtractor (eigene HPCP, 12 Bins)
        key, scale, staerke = es.KeyExtractor(profileType=prof, sampleRate=SR)(x)
        z[f"essx_{prof}_key"] = zu_camelot(*aus_name(key, scale))
        z[f"essx_{prof}_staerke"] = float(staerke)
    z["t_keyextractor"] = time.perf_counter() - t
    # gefaltete 12er-HPCP (Bin 0 = A in Essentia) für die CSV
    for i, w in enumerate(mittel.reshape(12, 3).sum(1)):
        z[f"hpcp12_{i:02d}"] = float(w)
    return z, v


# ---------- Energie ----------

def _verlauf(werte: np.ndarray, n: int = N_VERLAUF) -> np.ndarray:
    teile = np.array_split(werte, n) if len(werte) >= n else [werte]
    return np.array([np.mean(t) if len(t) else np.nan for t in teile], dtype=np.float32)


def energie(x: np.ndarray, es, bpm: float | None) -> tuple[dict, dict]:
    z, v = {}, {}
    t = time.perf_counter()
    # EBU R128 braucht Stereo: Mono auf beide Kanäle (gleichbleibender Versatz ggü. echtem Stereo)
    st = np.stack([x, x], axis=1).astype(np.float32)
    mom, kurz, integ, lra = es.LoudnessEBUR128(sampleRate=SR, hopSize=0.1)(st)
    kurz = np.asarray(kurz)
    gueltig = kurz[kurz > -70]
    z["lufs_int"] = float(integ)
    z["lra"] = float(lra)
    if len(gueltig):
        for p in (10, 50, 90, 95):
            z[f"st_p{p}"] = float(np.percentile(gueltig, p))
        z["st_std"] = float(gueltig.std())
        z["st_max"] = float(gueltig.max())
        z["anteil_laut"] = float(np.mean(gueltig >= integ - 1.0))        # Anteil Kurzzeit >= integriert - 1 LU
        z["anteil_nahe_max"] = float(np.mean(gueltig >= gueltig.max() - 3.0))
        z["anteil_leise"] = float(np.mean(gueltig < integ - 8.0))
    v["kurzzeit_verlauf"] = _verlauf(np.where(kurz > -70, kurz, -70))
    spitze = float(np.abs(x).max()) if len(x) else 0.0
    rms = float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if len(x) else 0.0
    z["spitze_dbfs"] = 20 * np.log10(spitze + 1e-12)
    z["rms_dbfs"] = 20 * np.log10(rms + 1e-12)
    z["crest_db"] = z["spitze_dbfs"] - z["rms_dbfs"]
    z["t_lautheit"] = time.perf_counter() - t

    t = time.perf_counter()
    n, hop = 2048, 1024
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop]
    f = np.fft.rfftfreq(n, 1 / SR)
    fen = np.hanning(n).astype(np.float32)
    band_e = {b: [] for b in BAENDER}
    zentr, fluss = [], []
    vorher = None
    for i in range(0, len(fr), 512):                                   # blockweise, spart Speicher
        S = np.abs(np.fft.rfft(fr[i:i + 512] * fen, axis=1)).astype(np.float32)
        P = S ** 2
        for b, (lo, hi) in BAENDER.items():
            band_e[b].append(P[:, (f >= lo) & (f < hi)].sum(1))
        ges = P.sum(1) + 1e-12
        zentr.append((P * f).sum(1) / ges)
        Sn = S / (S.sum(1, keepdims=True) + 1e-12)
        d = np.diff(Sn, axis=0, prepend=Sn[:1] if vorher is None else vorher[None])
        fluss.append(np.sqrt((np.maximum(d, 0) ** 2).sum(1)))
        vorher = Sn[-1]
    E = {b: np.concatenate(band_e[b]) for b in BAENDER}
    summe = sum(E.values()) + 1e-12
    for b in BAENDER:
        db = 10 * np.log10(E[b] + 1e-12)
        z[f"band_{b}_anteil"] = float(E[b].sum() / summe.sum())
        z[f"band_{b}_std_db"] = float(db[db > db.max() - 60].std())
        vl = _verlauf(db)
        v[f"band_{b}_verlauf"] = vl
        z[f"band_{b}_verlauf_spanne_db"] = float(np.nanpercentile(vl, 95) - np.nanpercentile(vl, 5))
    zentr = np.concatenate(zentr)
    fluss = np.concatenate(fluss)
    laut = summe > np.percentile(summe, 20)                             # Stille/Intro-Leere nicht mitteln
    z["schwerpunkt_hz"] = float(zentr[laut].mean())
    z["schwerpunkt_std_hz"] = float(zentr[laut].std())
    z["fluss_mittel"] = float(fluss[laut].mean())
    z["fluss_std"] = float(fluss[laut].std())
    v["schwerpunkt_verlauf"] = _verlauf(zentr)
    v["fluss_verlauf"] = _verlauf(fluss)
    z["t_spektrum"] = time.perf_counter() - t

    t = time.perf_counter()
    onsets, rate = es.OnsetRate()(x)
    z["onset_rate"] = float(rate)
    z["bpm_tag"] = bpm
    z["onsets_pro_schlag"] = float(rate / (bpm / 60)) if bpm else None
    dyn, lautheit = es.DynamicComplexity(sampleRate=SR)(x)
    z["dyn_komplexitaet"] = float(dyn)
    z["t_rhythmus_dynamik"] = time.perf_counter() - t
    return z, v


# ---------- Essentia-TensorFlow ----------

class TFModelle:
    def __init__(self, es):
        m = str(MODELLE)
        self.musicnn = es.TensorflowPredictMusiCNN(graphFilename=f"{m}/msd-musicnn-1.pb", output="model/dense/BiasAdd")
        self.effnet = es.TensorflowPredictEffnetDiscogs(graphFilename=f"{m}/discogs-effnet-bs64-1.pb",
                                                        output="PartitionedCall:1")
        self.koepfe_musicnn = {
            name: es.TensorflowPredict2D(graphFilename=f"{m}/{datei}.pb", output=out)
            for name, datei, out in [
                ("deam", "deam-msd-musicnn-2", "model/Identity"),
                ("emomusic", "emomusic-msd-musicnn-2", "model/Identity"),
                ("muse", "muse-msd-musicnn-2", "model/Identity"),
                ("dance", "danceability-msd-musicnn-1", "model/Softmax"),
                ("aggressive", "mood_aggressive-msd-musicnn-1", "model/Softmax"),
                ("party", "mood_party-msd-musicnn-1", "model/Softmax"),
                ("relaxed", "mood_relaxed-msd-musicnn-1", "model/Softmax"),
            ]}
        self.koepfe_effnet = {
            name: es.TensorflowPredict2D(graphFilename=f"{m}/{datei}.pb", output=out)
            for name, datei, out in [
                ("engagement", "engagement_regression-discogs-effnet-1", "model/Identity"),
                ("approachability", "approachability_regression-discogs-effnet-1", "model/Identity"),
                ("jamendo", "mtg_jamendo_moodtheme-discogs-effnet-1", "model/Sigmoid"),
            ]}
        self.jamendo_klassen = json.load(open(f"{m}/mtg_jamendo_moodtheme-discogs-effnet-1.json"))["classes"]
        self.resample = es.Resample(inputSampleRate=SR, outputSampleRate=16000, quality=1)

    def __call__(self, x: np.ndarray) -> tuple[dict, dict]:
        z, v = {}, {}
        t = time.perf_counter()
        x16 = self.resample(x)
        emb = self.musicnn(x16)
        v["musicnn_emb"] = emb.mean(0).astype(np.float32)
        k = self.koepfe_musicnn
        for name in ("deam", "emomusic", "muse"):
            p = k[name](emb).mean(0)                         # [valence, arousal], Skala 1..9
            z[f"tf_{name}_valence"], z[f"tf_{name}_arousal"] = float(p[0]), float(p[1])
        z["tf_danceable"] = float(k["dance"](emb).mean(0)[0])
        z["tf_aggressive"] = float(k["aggressive"](emb).mean(0)[0])
        z["tf_party"] = float(k["party"](emb).mean(0)[1])
        z["tf_relaxed"] = float(k["relaxed"](emb).mean(0)[1])
        z["t_musicnn"] = time.perf_counter() - t

        t = time.perf_counter()
        emb2 = self.effnet(x16)
        v["effnet_emb"] = emb2.mean(0).astype(np.float32)
        z["tf_engagement"] = float(self.koepfe_effnet["engagement"](emb2).mean())
        z["tf_approachability"] = float(self.koepfe_effnet["approachability"](emb2).mean())
        jam = self.koepfe_effnet["jamendo"](emb2).mean(0)
        v["jamendo56"] = jam.astype(np.float32)
        for name in JAMENDO_AUSWAHL:
            z[f"tf_jam_{name}"] = float(jam[self.jamendo_klassen.index(name)])
        z["t_effnet"] = time.perf_counter() - t
        return z, v


# ---------- ein Track ----------

def verarbeite(zeile: dict, es, tf: TFModelle | None, cache: Path = CACHE) -> dict:
    tid = track_id(zeile["pfad"])
    t0 = time.perf_counter()
    x = dekodiere(zeile["pfad"])
    z = {"id": tid, "t_dekodieren": time.perf_counter() - t0, "samples": int(len(x))}
    try:
        bpm = float(zeile.get("tbpm") or 0) or None
    except ValueError:
        bpm = None
    zk, vk = tonart(x, es)
    ze, ve = energie(x, es, bpm)
    z.update(zk); z.update(ze)
    vek = {**vk, **ve}
    if tf is not None:
        zt, vt = tf(x)
        z.update(zt); vek.update(vt)
    z["laufzeit_s"] = time.perf_counter() - t0
    z["cpu_s"] = time.process_time()                         # kumuliert je Worker, zur Plausibilisierung
    (cache / "npz").mkdir(parents=True, exist_ok=True)
    (cache / "json").mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache / "npz" / f"{tid}.npz", **vek)
    tmp = cache / "json" / f"{tid}.json.tmp"
    tmp.write_text(json.dumps({"zeile": zeile, "merkmale": z}, default=float))
    tmp.rename(cache / "json" / f"{tid}.json")
    return z
