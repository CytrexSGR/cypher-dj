"""Network pitch path of the note editor (plan B, task B3): SwiftF0 plus a restricted YIN, written as the raw curve of
djk/contract/notes.md ("The external curve", schema noten_kurve_roh.schema.json). Port of the bench detector `swiftf0_yin`
(messungen/M21-noten/m21_k_swiftf0.py, report BERICHT_gesamt.md).

SwiftF0 is a small convolutional network (MIT code, MIT ONNX model, package swift-f0): mono audio at 16 kHz in, one pitch and one
voicing confidence per 256 samples (16 ms) out. The audio is resampled with scipy's polyphase filter (zero phase; the package's own
soxr path is not used), the network frames are placed on their measured centres (FRAME_VERSATZ) and interpolated onto the contract
grid (hop 256 samples at 48 kHz, frame i centred at sample i * 256). The network decides voicing and the coarse pitch; an own YIN
search restricted to +-BAND_CT of that pitch gives the fine value, so an octave error of the YIN is impossible by construction.

The source is the .f32 of the decode cache (48 kHz, stereo interleaved, float32 little endian); the detector runs on (L+R)/2.
Calls:
  python -m werkstatt.notes_net --pruefen
      stdout {"status":"ok","netz":true,"version":"netz-1"} exit 0, or {"status":"fehler","grund":"netz_fehlt"} exit 1
  python -m werkstatt.notes_net --quelle <f32> --aus <roh.json>
      raw curve written atomically; stdout {"status":"ok","frames":n,"stimmhaft":x} (n = stereo frames of the source, x = share of
      voiced frames); failures {"status":"fehler","grund":"datei_fehlt"|"datei_kaputt"|"netz_fehlt"|"schreiben"} exit 1.
stdout carries the result line alone (everything else is moved to stderr); stderr carries `@@fortschritt` lines (stages laden,
tonhoehe, schreiben; each stage reports prozent 0 at its start and 100 at its end, as noten_zeile.schema.json#/$defs/fortschritt
requires)."""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

from werkstatt.progress import PRAEFIX

NETZ_VERSION = "netz-1"      # bump with any change of the algorithm below that changes its output (contract rule)
SR = 48000
HOP = 256                    # contract grid
NETZ_SR = 16000
NETZ_HOP = 256               # network frame: 16 ms at 16 kHz
FRAME_VERSATZ = -0.0014      # seconds the network frame centre lies after j*256/16000 (measured against a chirp, bench `rahmenversatz`)
FENSTER = 1536               # YIN integration window in samples at 48 kHz
FENSTER_S = FENSTER / 48000
YIN_SCHWELLE = 0.5           # above this normalised difference the coarse value stands
BAND_CT = 50.0               # YIN search band around the network's pitch
STIMM_SCHWELLE = 0.5         # network confidence from which a frame is voiced
CT_MIN, CT_MAX = 1500.0, 11000.0   # range of a voiced value in the contract
STUFEN = ("laden", "tonhoehe", "schreiben")

_NETZ = None


class NetzFehlt(Exception):
    """The runtime (swift_f0, onnxruntime) is not installed or cannot load the model."""


class DateiFehlt(Exception):
    pass


class DateiKaputt(Exception):
    pass


class SchreibFehler(Exception):
    pass


def _netz():
    global _NETZ
    if _NETZ is None:
        try:
            from swift_f0 import SwiftF0
            _NETZ = SwiftF0(threads=2, spin=False)
        except (ImportError, OSError, RuntimeError, ValueError) as ex:   # import and model load (onnxruntime errors are RuntimeError): no network
            raise NetzFehlt(f"{type(ex).__name__}: {ex}") from ex
    return _NETZ


def melde(name: str, prozent: float) -> None:
    """One progress line on stderr (schema noten_zeile.schema.json#/$defs/fortschritt: prozent a number, no `teil`)."""
    z = {"stufe": STUFEN.index(name) + 1, "von": len(STUFEN), "name": name, "prozent": prozent}
    sys.stderr.write(PRAEFIX + json.dumps(z) + "\n")
    sys.stderr.flush()


def _auf_16k(x: np.ndarray, sr: int) -> np.ndarray:
    x = np.ascontiguousarray(x, dtype=np.float32)
    if sr == NETZ_SR:
        return x
    g = math.gcd(NETZ_SR, sr)
    return np.ascontiguousarray(resample_poly(x, NETZ_SR // g, sr // g).astype(np.float32))


def netz_roh(x: np.ndarray, sr: int):
    """The network's own output for mono x: (centre times in seconds, pitch Hz, confidence). The centre times are the package's
    timestamps plus FRAME_VERSATZ."""
    y = _auf_16k(x, sr)
    if len(y) < NETZ_HOP:
        y = np.pad(y, (0, NETZ_HOP - len(y)))
    netz = _netz()
    try:
        r = netz.detect(y, NETZ_SR)
    except (RuntimeError, OSError) as ex:                      # a failure of the runtime; any other exception is a bug and propagates
        raise NetzFehlt(f"{type(ex).__name__}: {ex}") from ex
    return r.timestamps + FRAME_VERSATZ, r.pitch_hz, r.confidence


def auf_raster(zeit: np.ndarray, hz: np.ndarray, konf: np.ndarray, sr: int, n: int, hop: int = HOP):
    """Interpolate the network frames onto the contract grid (frame i centred at sample i*hop, n audio samples): returns (cents with
    0 = unvoiced, confidence). The pitch in cents is interpolated between voiced neighbours, the voicing comes from the nearest
    network frame, the confidence is interpolated linearly."""
    nf = n // hop + 1
    t = np.arange(nf) * hop / sr
    stimm = (konf >= STIMM_SCHWELLE) & (hz > 0)
    ct = np.where(stimm, 6900.0 + 1200.0 * np.log2(np.maximum(hz, 1e-3) / 440.0), 0.0)
    dt = zeit[1] - zeit[0] if len(zeit) > 1 else NETZ_HOP / NETZ_SR
    p = (t - zeit[0]) / dt
    lo = np.clip(np.floor(p).astype(int), 0, len(zeit) - 1)
    hi = np.clip(lo + 1, 0, len(zeit) - 1)
    fr = np.clip(p - np.floor(p), 0.0, 1.0)
    nah = np.where(fr >= 0.5, hi, lo)
    both = stimm[lo] & stimm[hi]
    wert = np.where(both, ct[lo] * (1 - fr) + ct[hi] * fr, ct[nah])
    f0 = np.where(stimm[nah], wert, 0.0)
    k = konf[lo] * (1 - fr) + konf[hi] * fr
    return f0, np.clip(k, 0.0, 1.0)


def yin_fein(x: np.ndarray, sr: int, f0_ct: np.ndarray, hop: int = HOP, band_ct: float = BAND_CT,
             schwelle: float = YIN_SCHWELLE) -> tuple[np.ndarray, np.ndarray]:
    """Fine pitch by YIN inside +-band_ct of the coarse value per frame. For every voiced frame (f0_ct > 0) the difference function
    d(tau) = sum_j (x_j - x_{j+tau})^2 over a window of FENSTER samples centred on the frame is computed (by FFT, batched),
    normalised by its cumulative mean, and its minimum is searched only for lags inside the band; the minimum is refined by a
    parabola. Returns (cents, normalised minimum per frame, 1.0 where unvoiced or fallback). Frames whose minimum exceeds `schwelle`
    keep the coarse value."""
    nf = len(f0_ct)
    w = int(round(FENSTER_S * sr))
    aus = np.array(f0_ct, dtype=np.float64)
    dmin = np.ones(nf)
    stimm = np.flatnonzero(f0_ct > 0)
    if len(stimm) == 0:
        return aus, dmin
    f_hz = 440.0 * 2.0 ** ((f0_ct[stimm] / 100.0 - 69.0) / 12.0)
    tau0 = sr / f_hz
    f = 2.0 ** (band_ct / 1200.0)
    lo = np.floor(tau0 / f).astype(int) - 1       # one extra lag each side for the parabola
    hi = np.ceil(tau0 * f).astype(int) + 1
    lo = np.maximum(lo, 2)
    laenge = w + hi + 2
    nfft = (2 ** np.ceil(np.log2(np.maximum(laenge, 64)))).astype(int)
    xp = np.concatenate([np.zeros(w), np.asarray(x, dtype=np.float64), np.zeros(w + 4096)])
    for nf_ in np.unique(nfft):
        sel = np.flatnonzero(nfft == nf_)
        for c0 in range(0, len(sel), 512):
            ids = sel[c0: c0 + 512]
            fr_idx = stimm[ids]
            starts = fr_idx * hop - w // 2 + w         # offset by the left padding of w
            mat = np.stack([xp[s: s + nf_] for s in starts])          # (m, nfft) frame of samples, zero padded to nfft
            a = mat[:, :w]
            ffa = np.fft.rfft(a, nf_, axis=1)
            ffb = np.fft.rfft(mat, nf_, axis=1)
            c = np.fft.irfft(np.conj(ffa) * ffb, nf_, axis=1)         # c[tau] = sum_j a_j * mat_{j+tau}
            cs = np.concatenate([np.zeros((len(ids), 1)), np.cumsum(mat * mat, axis=1)], axis=1)
            e1 = np.sum(a * a, axis=1)[:, None]
            taus = np.arange(0, nf_ - w)
            e2 = cs[:, w + taus] - cs[:, taus]
            d = e1 + e2 - 2.0 * c[:, taus]
            d[:, 0] = 0.0
            cm = np.cumsum(d, axis=1)
            cmndf = np.ones_like(d)
            cmndf[:, 1:] = d[:, 1:] * taus[None, 1:] / np.maximum(cm[:, 1:], 1e-12)
            for r, i in enumerate(ids):
                l, h = lo[i], min(hi[i], len(taus) - 2)
                seg = cmndf[r, l: h + 1]
                if len(seg) < 3:
                    continue
                k = int(np.argmin(seg))
                v = seg[k]
                if k == 0 or k == len(seg) - 1:
                    tau = l + k
                else:
                    den = seg[k - 1] - 2 * seg[k] + seg[k + 1]
                    tau = l + k + (0.5 * (seg[k - 1] - seg[k + 1]) / den if den > 1e-12 else 0.0)
                dmin[stimm[i]] = v
                if v <= schwelle:
                    aus[stimm[i]] = 6900.0 + 1200.0 * math.log2((sr / tau) / 440.0)
    return aus, dmin


def swiftf0_yin(x: np.ndarray, sr: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """Detector `swiftf0_yin` for mono x: (cents with 0 = unvoiced, confidence), one entry per grid frame, `len(x) // HOP + 1`
    entries (an empty x gives one unvoiced frame)."""
    x = np.nan_to_num(np.asarray(x, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    if len(x) == 0:
        return np.zeros(1), np.zeros(1)
    z, hz, kf = netz_roh(x, sr)
    f0, k = auf_raster(z, hz, kf, sr, len(x))
    fein, _ = yin_fein(x, sr, f0)
    return fein, k


def roh_kurve(stereo: np.ndarray, melde=lambda name, prozent: None) -> dict:
    """Raw curve object (schema noten_kurve_roh.schema.json) for a source of shape (n, 2), float32."""
    n = len(stereo)
    mono = ((stereo[:, 0].astype(np.float32) + stereo[:, 1].astype(np.float32)) * np.float32(0.5)) if n else np.zeros(0, np.float32)
    melde("tonhoehe", 0)
    f0, konf = swiftf0_yin(mono, SR)
    f0 = np.where((f0 >= CT_MIN) & (f0 <= CT_MAX), f0, 0.0)       # the network's range keeps every voiced value inside; belt and braces
    f0_r = np.round(f0, 2)
    f0_r = np.where((f0_r >= CT_MIN) & (f0_r <= CT_MAX), f0_r, 0.0)
    konf_r = np.round(np.clip(np.nan_to_num(konf, nan=0.0), 0.0, 1.0), 3)
    melde("tonhoehe", 100)
    return {
        "format": "cdj-noten-kurve-roh/1", "frames": int(n), "sr": SR, "hop": HOP, "detektor": "netz",
        "detektor_version": NETZ_VERSION,
        "f0_ct": [0 if v == 0 else float(v) for v in f0_r],
        "konf": [float(v) for v in konf_r],
    }


def lies_quelle(pfad) -> np.ndarray:
    p = Path(pfad)
    if not p.is_file():
        raise DateiFehlt(str(p))
    try:
        groesse = p.stat().st_size
        if groesse % 8:
            raise DateiKaputt(f"size {groesse} is not a multiple of 8")
        return np.fromfile(p, dtype="<f4").reshape(-1, 2)
    except OSError as ex:
        raise DateiKaputt(str(ex)) from ex


def schreibe_atomar(pfad, obj) -> None:
    ziel = Path(pfad)
    teil = ziel.with_name(ziel.name + ".tmp")
    try:
        teil.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(teil, ziel)
    except OSError as ex:
        try:
            teil.unlink()
        except OSError:
            pass
        raise SchreibFehler(str(ex)) from ex


def _lauf(a) -> dict:
    melde("laden", 0)
    stereo = lies_quelle(a.quelle)
    melde("laden", 100)
    _netz()                                                   # a missing runtime is `netz_fehlt` before any work
    kurve = roh_kurve(stereo, melde)
    melde("schreiben", 0)
    schreibe_atomar(a.aus, kurve)
    melde("schreiben", 100)
    f0 = kurve["f0_ct"]
    return {"status": "ok", "frames": kurve["frames"], "stimmhaft": round(sum(1 for v in f0 if v) / len(f0), 4)}


def _ergebnis(erg: dict) -> None:
    sys.stdout.write(json.dumps(erg, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def pruefen() -> int:
    try:
        _netz()
    except NetzFehlt as ex:
        sys.stderr.write(f"noten_netz: {ex}\n")
        _ergebnis({"status": "fehler", "grund": "netz_fehlt"})
        return 1
    _ergebnis({"status": "ok", "netz": True, "version": NETZ_VERSION})
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="werkstatt.notes_net")
    ap.add_argument("--pruefen", action="store_true", help="report whether the network runtime is usable")
    ap.add_argument("--quelle", help="source .f32 (48 kHz, stereo, float32 LE)")
    ap.add_argument("--aus", help="raw curve output (.json)")
    a = ap.parse_args(argv)
    if a.pruefen:
        if a.quelle or a.aus:
            ap.error("--pruefen takes no other argument")
        return pruefen()
    if not (a.quelle and a.aus):
        ap.error("--quelle and --aus are required (or --pruefen)")
    sys.stdout.flush()
    echt = os.dup(1)                                          # stdout belongs to the result line alone (pattern stems.py)
    os.dup2(2, 1)
    try:
        erg = _lauf(a)
    except DateiFehlt as ex:
        erg = {"status": "fehler", "grund": "datei_fehlt"}
        sys.stderr.write(f"noten_netz: {ex}\n")
    except DateiKaputt as ex:
        erg = {"status": "fehler", "grund": "datei_kaputt"}
        sys.stderr.write(f"noten_netz: {ex}\n")
    except SchreibFehler as ex:
        erg = {"status": "fehler", "grund": "schreiben"}
        sys.stderr.write(f"noten_netz: {ex}\n")
    except NetzFehlt as ex:                                   # import, model load or runtime failure; a programming error is not caught
        erg = {"status": "fehler", "grund": "netz_fehlt"}
        sys.stderr.write(f"noten_netz: {ex}\n")
    finally:
        sys.stdout.flush()
        os.dup2(echt, 1)
        os.close(echt)
    _ergebnis(erg)
    return 0 if erg["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
