"""Stems of a range (package 1.13 slice 6, G08; model since 2026-11-06: BS-RoFormer-SW on the GPU only, plan
docs/superpowers/plans/2026-11-06-stems-roformer-gpu.md). Source: the .f32 of the decode cache (48 kHz, stereo interleaved, float32 LE).
Range [f0, f1) with 2 s margin on each side, zeros outside the source (D5); 48 -> 44.1 kHz, separator, 44.1 -> 48 kHz, cut to exactly
n = f1 - f0 frames after the margin. Six stems (drums, bass, other, vocals, guitar, piano); guitar and piano are dropped when they are
more than LEER_DB below the input and their signal goes to other (D4). One raw .f32 per placed stem in --aus.
GPU only (D2, Andreas 2026-11-06: "vielleicht sollten wir grundsätzlich das nur zulassen wenn auch gpu verfügbar ist"): no CUDA ->
keine_gpu, less than GPU_FREI_MB free or out of memory during the run -> gpu_belegt. There is no CPU path.
stdout: exactly one JSON line (status ok | fehler); stderr: @@fortschritt lines (stages laden, trennen, schreiben).
Call: python -m werkstatt.stems --quelle Q --f0 F0 --f1 F1 --aus DIR [--gewichte PATH] [--threads 2] [--trenner roformer|identitaet|identitaet_vier|gpu_belegt|langsam|taub]"""
import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path

import numpy as np

SR = 48000
SR_MODELL = 44100
RAND = 2 * SR                                                 # D5
STEMS = ("drums", "bass", "other", "vocals", "guitar", "piano")   # order of the placed tracks
PFLICHT = ("drums", "bass", "other", "vocals")               # always placed (deck contract §4.4 knows these four)
LEER_DB = -45.0                                               # D4: an optional stem this far below the input RMS is dropped into other
STUFEN_STEMS = ("laden", "trennen", "schreiben")
IDENTITAET_ANTEILE = (0.05, 0.10, 0.15, 0.20, 0.22, 0.28)     # sum 1, all different so a swapped name shows
STEMS_THREADS = 2   # D18, AK26, 2026-11-04: 4 threads raised the set p99.9 by ~600 us, 2 by 156 us (limit 200), Andreas: "Ok"
GPU_FREI_MB = int(os.environ.get("CYPHERDJ_STEMS_GPU_FREI_MB", "4500"))   # free before the run: context ~250 MB + measured peak 3.4 GB + room
GPU_DECKEL_MB = 4096                                          # torch cap; measured 2026-11-06: 2.9 GB allocated, 3.4 GB reserved (8 min track)
GEWICHTE = Path(__file__).resolve().parent.parent / "gewichte" / "BS-Rofo-SW-Fixed.ckpt"
SHA256_GEWICHTE = "24e7d35ee9c64415673d3fd33e06a67cac2c103c5df6267ba1576459c775916e"
THIRD_PARTY = Path(__file__).resolve().parents[2] / "third_party"

# BS-Rofo-SW-Fixed.yaml (bs-roformer-infer 0.1.5), only the keys BSRoformer accepts
MODELL = dict(dim=256, depth=12, stereo=True, num_stems=6, time_transformer_depth=1, freq_transformer_depth=1, dim_head=64, heads=8,
              attn_dropout=0.1, ff_dropout=0.1, flash_attn=True, dim_freqs_in=1025, stft_n_fft=2048, stft_hop_length=512,
              stft_win_length=2048, stft_normalized=False, mask_estimator_depth=2, multi_stft_resolution_loss_weight=1.0,
              multi_stft_resolutions_window_sizes=(4096, 2048, 1024, 512, 256), multi_stft_hop_size=147, multi_stft_normalized=False)
MODELL_STEMS = ("bass", "drums", "other", "vocals", "guitar", "piano")   # training.instruments, the model's output order
CHUNK = 588800                                                # inference.chunk_size (13.35 s at 44.1 kHz)
UEBERLAPP = 2                                                 # inference.num_overlap


class GpuFehler(Exception):
    """Ends the run with grund keine_gpu or gpu_belegt; the project stays unchanged."""
    def __init__(self, grund, text):
        super().__init__(text)
        self.grund = grund


def ausschnitt(quelle, f0, f1, rand=RAND):
    """[f0 - rand, f1 + rand) of the source as float32 (2, n + 2 rand); zeros outside the source."""
    roh = np.memmap(quelle, dtype="<f4", mode="r")
    frames = roh.size // 2
    x = roh[: frames * 2].reshape(frames, 2)
    a, b = f0 - rand, f1 + rand
    aus = np.zeros((b - a, 2), dtype=np.float32)
    lo, hi = max(a, 0), min(b, frames)
    if hi > lo:
        aus[lo - a: hi - a] = x[lo:hi]
    return np.ascontiguousarray(aus.T)


def hinweg(x):
    import torch
    import torchaudio
    return torchaudio.functional.resample(torch.from_numpy(x), SR, SR_MODELL)


def rueckweg(y, n, rand=RAND):
    """(k, 2, m) at 44.1 kHz -> (k, 2, n) at 48 kHz: resample, then exactly n frames after the margin (D5)."""
    import torch
    import torchaudio
    z = torchaudio.functional.resample(y.contiguous(), SR_MODELL, SR)
    if z.shape[-1] < rand + n:
        z = torch.nn.functional.pad(z, (0, rand + n - z.shape[-1]))
    return z[..., rand: rand + n].numpy()


def trenner_identitaet(x, melde, schritte=1, pause=0.0):
    """Test separator (P3): sum = input. The six stems carry different shares (IDENTITAET_ANTEILE) so a swapped name is measurable."""
    for i in range(schritte):
        time.sleep(pause)
        melde("trennen", 100.0 * (i + 1) / schritte)
    import torch
    return x.unsqueeze(0) * torch.tensor(IDENTITAET_ANTEILE, dtype=x.dtype).reshape(len(STEMS), 1, 1)


def _db(x):
    e = float(np.sqrt(np.mean(np.asarray(x, dtype=np.float64) ** 2)))
    return None if e == 0.0 else 20 * np.log10(e)


def falte(s, original, grenze_db=LEER_DB):
    """D4: s (6, 2, n) in STEMS order. An optional stem whose RMS lies more than -grenze_db below the original is added to other and
    dropped. Returns (placed names, their arrays (k, 2, n), dropped [{stem, db}]). The sum over the placed stems equals the sum over all six."""
    ref = _db(original)
    s = np.array(s, dtype=np.float32, copy=True)
    weg = []
    for i, name in enumerate(STEMS):
        if name in PFLICHT:
            continue
        d = _db(s[i])
        rel = None if d is None or ref is None else d - ref
        if rel is None or rel < grenze_db:
            s[STEMS.index("other")] += s[i]
            weg.append({"stem": name, "db": None if rel is None else round(rel, 1)})
    namen = [n for n in STEMS if n not in {w["stem"] for w in weg}]
    return namen, s[[STEMS.index(n) for n in namen]], weg


def rest_db(stems, original):
    """Residual of the stem sum against the original in dB (None for silence)."""
    o = original.astype(np.float64)
    e0 = float(np.sqrt(np.mean(o ** 2)))
    if e0 == 0.0:
        return None
    r = stems.astype(np.float64).sum(axis=0) - o
    return round(20 * np.log10(max(float(np.sqrt(np.mean(r ** 2))), 1e-12) / e0), 2)


def _lauf(a, melde):
    melde("laden")
    n = a.f1 - a.f0
    x = ausschnitt(a.quelle, a.f0, a.f1)
    if a.trenner == "roformer":
        trenne = _roformer_trenner(a.gewichte, a.threads)
    elif a.trenner == "identitaet":
        trenne = trenner_identitaet
    elif a.trenner == "identitaet_vier":                      # test: guitar and piano silent, so D4 drops them (sum stays the input)
        def trenne(x441, m):
            y = trenner_identitaet(x441, m)
            y[2] += y[4] + y[5]
            y[4:] = 0
            return y
    elif a.trenner == "gpu_belegt":                           # test: the refusal of D2 without a GPU
        raise GpuFehler("gpu_belegt", "test separator: 0 MB free on the GPU")
    else:                                                     # langsam, taub: 40 steps of 0.1 s
        if a.trenner == "taub":
            signal.signal(signal.SIGTERM, signal.SIG_IGN)

        def trenne(x441, m):
            return trenner_identitaet(x441, m, schritte=40, pause=0.1)
    melde("trennen", 0.0)
    x441 = hinweg(x)
    frames_modell = int(x441.shape[-1])                       # proof of the intermediate rate: ceil(m * 44100 / 48000)
    y = trenne(x441, melde)
    s = rueckweg(y, n)
    original = x[:, RAND: RAND + n]
    namen, s, weg = falte(s, original)
    melde("schreiben")
    aus = Path(a.aus)
    aus.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(namen):
        s[i].T.astype("<f4").tofile(aus / f"{name}.f32")
    return {"status": "ok", "frames": n, "stems": namen, "verworfen": weg, "rest_db": rest_db(s, original),
            "frames_modell": frames_modell, "geraet": getattr(trenne, "geraet", "test"), "vram_mb": getattr(trenne, "vram_mb", None)}


def lade_modell(pfad, soll=SHA256_GEWICHTE):
    """Offline: own sha256 check, torch.load(weights_only=True), BSRoformer from the vendored code (djk/third_party/bs_roformer)."""
    import torch
    from werkstatt.gewichte import sha256
    if sha256(pfad) != soll:
        raise RuntimeError("gewichte_sha")
    if str(THIRD_PARTY) not in sys.path:
        sys.path.insert(0, str(THIRD_PARTY))
    from bs_roformer.bs_roformer import BSRoformer
    modell = BSRoformer(**MODELL)
    sd = torch.load(pfad, map_location="cpu", weights_only=True)
    modell.load_state_dict(sd.get("state_dict", sd) if isinstance(sd, dict) else sd)
    modell.eval()
    return modell


def pruefe_gpu(torch, frei_mb=None):
    """D2: CUDA present and frei_mb free, else GpuFehler. Caps torch at GPU_DECKEL_MB."""
    frei_mb = GPU_FREI_MB if frei_mb is None else frei_mb
    if not torch.cuda.is_available():
        raise GpuFehler("keine_gpu", "no CUDA device: stems run on the GPU only")
    frei, gesamt = torch.cuda.mem_get_info()
    if frei < frei_mb * 2**20:
        raise GpuFehler("gpu_belegt", f"{frei // 2**20} MB free on the GPU, {frei_mb} needed")
    torch.cuda.set_per_process_memory_fraction(min(1.0, GPU_DECKEL_MB * 2**20 / gesamt))


def fenster(torch, laenge, blende):
    w = torch.ones(laenge)
    w[:blende] = torch.linspace(0, 1, blende)
    w[-blende:] = torch.linspace(1, 0, blende)
    return w


def ueberlapp_addieren(modell, mix, melde, torch, dev, chunk=CHUNK, ueberlapp=UEBERLAPP):
    """demix_track of bs-roformer-infer 0.1.5 (utils.py:61-150) with one change (D3): result and counter live on the CPU and only one
    chunk at a time goes to the GPU. Measured 2026-11-06: VRAM flat at 3.3-3.6 GB instead of 4.5-9.0 GB, output bit-equal."""
    nn = torch.nn
    schritt = chunk // ueberlapp
    blende = chunk // 10
    rand = chunk - schritt
    gepolstert = mix.shape[1] > 2 * rand and rand > 0
    if gepolstert:
        mix = nn.functional.pad(mix, (rand, rand), mode="reflect")
    w0 = fenster(torch, chunk, blende)
    ergebnis = torch.zeros((len(MODELL_STEMS),) + tuple(mix.shape), dtype=torch.float32)
    zaehler = torch.zeros_like(ergebnis)
    gesamt = mix.shape[1]
    i = 0
    with torch.autocast("cuda"), torch.no_grad():
        while i < gesamt:
            teil = mix[:, i:i + chunk]
            laenge = teil.shape[-1]
            if laenge < chunk:
                if laenge > chunk // 2 + 1:
                    teil = nn.functional.pad(teil, (0, chunk - laenge), mode="reflect")
                else:
                    teil = nn.functional.pad(teil, (0, chunk - laenge, 0, 0), mode="constant", value=0)
            y = modell(teil.to(dev).unsqueeze(0))[0].float().cpu()
            w = w0.clone()
            if i == 0:
                w[:blende] = 1
            elif i + chunk >= gesamt:
                w[-blende:] = 1
            ergebnis[..., i:i + laenge] += y[..., :laenge] * w[:laenge]
            zaehler[..., i:i + laenge] += w[:laenge]
            i += schritt
            melde("trennen", 100.0 * min(i, gesamt) / gesamt)
    q = torch.nan_to_num(ergebnis / zaehler, nan=0.0)
    return q[..., rand:-rand] if gepolstert else q


def _roformer_trenner(gewichte, threads):
    import torch
    torch.set_num_threads(threads)
    pruefe_gpu(torch)
    modell = lade_modell(gewichte).to("cuda")

    def trenne(x441, melde):
        try:
            y = ueberlapp_addieren(modell, x441, melde, torch, "cuda")
        except torch.cuda.OutOfMemoryError as ex:
            raise GpuFehler("gpu_belegt", "the GPU ran out of memory during the separation") from ex
        trenne.vram_mb = round(torch.cuda.max_memory_reserved() / 2**20)
        return torch.stack([y[MODELL_STEMS.index(s)] for s in STEMS])
    trenne.geraet = "cuda"
    trenne.vram_mb = None
    return trenne


def _ergebnis(erg):
    sys.stdout.write(json.dumps(erg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--quelle", required=True)
    ap.add_argument("--f0", type=int, required=True)
    ap.add_argument("--f1", type=int, required=True)
    ap.add_argument("--aus", required=True)
    ap.add_argument("--gewichte", default=str(GEWICHTE))
    ap.add_argument("--threads", type=int, default=STEMS_THREADS)
    ap.add_argument("--trenner", choices=("roformer", "identitaet", "identitaet_vier", "gpu_belegt", "langsam", "taub"), default="roformer")
    a = ap.parse_args(argv)
    if a.f1 <= a.f0:
        _ergebnis({"status": "fehler", "grund": "argument", "text": "f1 must be greater than f0"})
        return 2
    from werkstatt.fortschritt import melder
    melde = melder(stufen=STUFEN_STEMS)
    sys.stdout.flush()
    echt = os.dup(1)                                          # stdout belongs to the result line alone (pattern einzeln.py:66-74)
    os.dup2(2, 1)
    try:
        erg = _lauf(a, melde)
    except GpuFehler as ex:
        erg = {"status": "fehler", "grund": ex.grund, "text": str(ex)}
    except Exception as ex:                                   # noqa: BLE001 - every error becomes the result line
        erg = {"status": "fehler", "grund": str(ex)[:200] or type(ex).__name__}
    finally:
        sys.stdout.flush()
        os.dup2(echt, 1)
        os.close(echt)
    _ergebnis(erg)
    return 0 if erg["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
