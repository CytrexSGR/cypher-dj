"""Prueft, dass das Werkstatt-venv den System-torch (CUDA) benutzt und nichts daneben legt.

  python -m werkstatt.pruefe_umgebung                 # Laufzeit: torch, torchaudio, beat_this, Essentia
  python -m werkstatt.pruefe_umgebung --pip-plan X    # pip-Bericht (--dry-run --report X) vorab pruefen
Exit 0 = in Ordnung, 1 = Befund (Text sagt welcher)."""
import argparse, json, sys


def basis(version):
    return version.split("+")[0]


def pruefe_pip_plan(pfad):
    import torch
    plan = json.load(open(pfad))
    neu = {i["metadata"]["name"].lower(): i["metadata"]["version"] for i in plan.get("install", [])}
    print("PIP-PLAN", json.dumps(neu, sort_keys=True))
    befunde = []
    if "torch" in neu:
        befunde.append(f"pip wuerde torch {neu['torch']} ins venv legen (System: {torch.__version__})")
    if "torchaudio" in neu and basis(neu["torchaudio"]) != basis(torch.__version__):
        befunde.append(f"torchaudio {neu['torchaudio']} passt nicht zu torch {torch.__version__}")
    return befunde


def pruefe_laufzeit():
    import torch, torchaudio
    befunde = []
    print("TORCH", torch.__version__, "CUDA", torch.version.cuda, torch.__file__)
    print("TORCHAUDIO", torchaudio.__version__)
    if torch.version.cuda is None:
        befunde.append("torch ohne CUDA (Proben-venv-Fehler aus ARCHITEKTUR §8.2)")
    if basis(torchaudio.__version__) != basis(torch.__version__):
        befunde.append(f"torchaudio {torchaudio.__version__} passt nicht zu torch {torch.__version__}")
    if torch.__file__.startswith(sys.prefix):
        befunde.append(f"torch liegt im venv ({sys.prefix}) statt im System: {torch.__file__}")
    import beat_this, essentia, soundfile, soxr, einops   # noqa: F401  (Import ist die Pruefung)
    print("IMPORTE beat_this essentia soundfile soxr einops ok")
    return befunde


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pip-plan")
    a = ap.parse_args(argv)
    befunde = pruefe_pip_plan(a.pip_plan) if a.pip_plan else pruefe_laufzeit()
    for b in befunde:
        print("BEFUND", b)
    print("OK" if not befunde else "NICHT OK")
    return 1 if befunde else 0


if __name__ == "__main__":
    sys.exit(main())
