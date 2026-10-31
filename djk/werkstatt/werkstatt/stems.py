"""Stems eines Ausschnitts (Paket 1.13 Slice 6, G08). Quelle: die .f32 des Dekodier-Caches (48 kHz, Stereo verschraenkt, float32 LE).
Ausschnitt [f0, f1) mit 2 s Rand je Seite, ausserhalb der Quelle Nullen (D5); Hinweg 48 -> 44,1 kHz, Trenner, Rueckweg 44,1 -> 48 kHz,
Schnitt auf exakt n = f1 - f0 Frames ab dem Rand; vier rohe .f32 (drums, bass, other, vocals) im Ordner --aus.
Nur CPU (F3, P4): CUDA_VISIBLE_DEVICES muss leer gesetzt sein, sonst Exit 4 vor jedem Import von torch.
stdout: genau eine JSON-Zeile (status ok | fehler); stderr: @@fortschritt-Zeilen (Stufen laden, trennen, schreiben).
Aufruf: python -m werkstatt.stems --quelle Q --f0 F0 --f1 F1 --aus ORDNER [--gewichte PFAD] [--threads 4] [--trenner demucs|identitaet|langsam|taub]"""
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
STEMS = ("drums", "bass", "other", "vocals")                  # Reihenfolge von htdemucs (model.sources)
STUFEN_STEMS = ("laden", "trennen", "schreiben")
IDENTITAET_ANTEILE = (0.1, 0.2, 0.3, 0.4)                       # Summe 1
STEMS_THREADS = 4                                             # D18
GEWICHTE = Path(__file__).resolve().parent.parent / "gewichte" / "htdemucs-955717e8.th"


def ausschnitt(quelle, f0, f1, rand=RAND):
    """[f0 - rand, f1 + rand) der Quelle als float32 (2, n + 2 rand); ausserhalb der Quelle Nullen."""
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
    """(4, 2, m) bei 44,1 kHz -> (4, 2, n) bei 48 kHz: zurueckrechnen, dann exakt n Frames ab dem Rand (D5)."""
    import torch
    import torchaudio
    z = torchaudio.functional.resample(y.contiguous(), SR_MODELL, SR)
    if z.shape[-1] < rand + n:
        z = torch.nn.functional.pad(z, (0, rand + n - z.shape[-1]))
    return z[..., rand: rand + n].numpy()


def trenner_identitaet(x, melde, schritte=1, pause=0.0):
    """Pruef-Trenner (P3): Summe = Eingang. Die vier Stems tragen verschiedene Anteile (IDENTITAET_ANTEILE: 0,1 / 0,2 / 0,3 / 0,4),
    damit eine Namensvertauschung messbar ist."""
    for i in range(schritte):
        time.sleep(pause)
        melde("trennen", 100.0 * (i + 1) / schritte)
    import torch
    return x.unsqueeze(0) * torch.tensor(IDENTITAET_ANTEILE, dtype=x.dtype).reshape(4, 1, 1)


def rest_db(stems, original):
    """Restsignal der Summe gegen das Original in dB (None bei Stille)."""
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
    if a.trenner == "demucs":
        trenne = _demucs_trenner(a.gewichte, a.threads)       # Task 3
    elif a.trenner == "identitaet":
        trenne = trenner_identitaet
    else:                                                     # langsam, taub: 40 Schritte a 0,1 s
        if a.trenner == "taub":
            signal.signal(signal.SIGTERM, signal.SIG_IGN)

        def trenne(x441, m):
            return trenner_identitaet(x441, m, schritte=40, pause=0.1)
    melde("trennen", 0.0)
    x441 = hinweg(x)
    frames_modell = int(x441.shape[-1])                       # Beleg der Zwischenrate: ceil(m * 44100 / 48000), torchaudio functional.py:1425
    y = trenne(x441, melde)
    s = rueckweg(y, n)
    melde("schreiben")
    aus = Path(a.aus)
    aus.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(STEMS):
        s[i].T.astype("<f4").tofile(aus / f"{name}.f32")
    return {"status": "ok", "frames": n, "stems": list(STEMS), "rest_db": rest_db(s, x[:, RAND: RAND + n]),
            "frames_modell": frames_modell}


SHA256_GEWICHTE = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"


def lade_modell(pfad, soll=SHA256_GEWICHTE):
    """Offline (P1): eigene sha256-Pruefung, torch.load(weights_only=False), demucs.states.load_model(paket) (Dict-Zweig states.py:53),
    BagOfModels([m]) wie get_model('htdemucs') (remote/htdemucs.yaml: models ['955717e8'], Gewicht 1, apply.py:28-60)."""
    import torch
    from demucs.apply import BagOfModels
    from demucs.states import load_model
    from werkstatt.gewichte import sha256
    if sha256(pfad) != soll:
        raise RuntimeError("gewichte_sha")
    paket = torch.load(pfad, map_location="cpu", weights_only=False)
    modell = BagOfModels([load_model(paket)])
    modell.eval()
    return modell


class _TqdmMelder:
    """Ersatz fuer das Modul tqdm in demucs.apply (apply.py:247-248: tqdm.tqdm(futures, ...)). Die Futures rechnen lazy beim result()
    (DummyPoolExecutor, utils.py:121-135): nach dem yield ist das Stueck gerechnet, dann wird gemeldet."""
    def __init__(self, melde):
        self.melde = melde

    def tqdm(self, folge, **_):
        folge = list(folge)
        for i, x in enumerate(folge):
            yield x
            self.melde("trennen", 100.0 * (i + 1) / len(folge))


def _demucs_trenner(gewichte, threads):
    import torch
    import demucs.apply as da
    torch.set_num_threads(threads)
    modell = lade_modell(gewichte)

    def trenne(x441, melde):
        da.tqdm = _TqdmMelder(melde)
        with torch.no_grad():
            y = da.apply_model(modell, x441[None], shifts=0, split=True, overlap=0.25, progress=True, device="cpu", num_workers=0)[0]
        namen = list(modell.sources)
        return torch.stack([y[namen.index(s)] for s in STEMS])
    return trenne


def _ergebnis(erg):
    sys.stdout.write(json.dumps(erg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main(argv=None):
    if os.environ.get("CUDA_VISIBLE_DEVICES") != "":          # P4: vor jedem Import von torch
        _ergebnis({"status": "fehler", "grund": "gpu_sichtbar", "text": "CUDA_VISIBLE_DEVICES must be set and empty: stems run on the CPU only"})
        return 4
    ap = argparse.ArgumentParser()
    ap.add_argument("--quelle", required=True)
    ap.add_argument("--f0", type=int, required=True)
    ap.add_argument("--f1", type=int, required=True)
    ap.add_argument("--aus", required=True)
    ap.add_argument("--gewichte", default=str(GEWICHTE))
    ap.add_argument("--threads", type=int, default=STEMS_THREADS)
    ap.add_argument("--trenner", choices=("demucs", "identitaet", "langsam", "taub"), default="demucs")
    a = ap.parse_args(argv)
    if a.f1 <= a.f0:
        _ergebnis({"status": "fehler", "grund": "argument", "text": "f1 must be greater than f0"})
        return 2
    from werkstatt.fortschritt import melder
    melde = melder(stufen=STUFEN_STEMS)
    sys.stdout.flush()
    echt = os.dup(1)                                          # stdout gehoert allein der Ergebniszeile (Muster einzeln.py:66-74)
    os.dup2(2, 1)
    try:
        erg = _lauf(a, melde)
    except Exception as ex:                                   # noqa: BLE001 - jeder Fehler wird zur Ergebniszeile
        erg = {"status": "fehler", "grund": str(ex)[:200] or type(ex).__name__}
    finally:
        sys.stdout.flush()
        os.dup2(echt, 1)
        os.close(echt)
    _ergebnis(erg)
    return 0 if erg["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
