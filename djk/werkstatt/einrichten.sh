#!/usr/bin/env bash
# Werkstatt-venv (Scheibe 05): System-torch mit CUDA bleibt, was es ist; belegt vorher und nachher.
set -euo pipefail
cd "$(dirname "$0")"
python3 -c 'import torch; print("VORHER", torch.__version__, torch.version.cuda, torch.__file__)'
[ -d .venv ] || python3 -m venv --system-site-packages .venv
PIP=".venv/bin/python -m pip"
nice -n 19 $PIP install --dry-run --quiet --report pip_plan_torch.json -r anforderungen-torch.txt
.venv/bin/python -m werkstatt.pruefe_umgebung --pip-plan pip_plan_torch.json
nice -n 19 ionice -c3 $PIP install --quiet -r anforderungen-torch.txt
nice -n 19 $PIP install --dry-run --quiet --report pip_plan.json -r anforderungen.txt
.venv/bin/python -m werkstatt.pruefe_umgebung --pip-plan pip_plan.json
nice -n 19 ionice -c3 $PIP install --quiet -r anforderungen.txt
nice -n 19 $PIP install --dry-run --quiet --no-deps --report pip_plan_stems.json -r anforderungen-stems.txt
.venv/bin/python -m werkstatt.pruefe_umgebung --pip-plan pip_plan_stems.json
nice -n 19 ionice -c3 $PIP install --quiet --no-deps -r anforderungen-stems.txt
.venv/bin/python -m werkstatt.gewichte_stems   # 80 MB, unter der G3-Grenze; mit --von <datei> ohne Netz
.venv/bin/python -c 'import torch; print("NACHHER", torch.__version__, torch.version.cuda, torch.__file__)'
.venv/bin/python -m werkstatt.pruefe_umgebung
