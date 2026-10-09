#!/usr/bin/env python3
"""Kit für den Kern bauen (ADR 024): aus einer Strudel-Sample-Liste (battery.json: {name: [pfad, ...], "_base": url})
je Klang eine .f32 (48 kHz, Stereo, float32 verschränkt) und kit.json mit note, name "<s>:<n>", datei, frames.
Aufruf: kit_bauen.py --liste ~/cypher-dj/battery.json --quelle /path/to/Battery4-Samples
                     --ziel ~/.config/cypherdj/kits/battery [--name battery] [--max-sek 4]"""
import argparse
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # djk/, für klang.probe und klang.lautheit
from klang import lautheit, probe  # noqa: E402

class FachlicherAbbruch(ValueError):
    """Das Kit ist fachlich nicht baubar (zu viele Klänge, Übersteuerung): Exit 1. Alles andere ist Exit 2."""


RATE = 48000
BPM, TAKTE = 130.0, 2  # Rollenmuster wie klang/probe.py
MAX_SPITZE_DB = -1.0  # mit --rollen darf kein Klang lauter sein
MAX_KLAENGE = 112  # historisch; seit F08 (Glanz 2.4.2) liegt das Zusatz-Kit auf 128 + note
AUSBLENDE = 240  # 5 ms, damit ein gekürzter Klang nicht knackt


def wandle(quelle: Path, max_sek: float) -> np.ndarray:
    roh = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(quelle), "-t", str(max_sek), "-ar", str(RATE),
                          "-ac", "2", "-f", "f32le", "-"], capture_output=True, check=True, timeout=60).stdout
    x = np.frombuffer(roh, dtype="<f4").copy()
    if x.size == 0 or x.size % 2:
        raise ValueError(f"{quelle}: keine Stereo-Daten")
    n = x.size // 2
    aus = min(AUSBLENDE, n)
    x[2 * (n - aus):] *= np.repeat(np.linspace(1.0, 0.0, aus, dtype="<f4"), 2)
    if not np.all(np.isfinite(x)):
        raise ValueError(f"{quelle}: NaN oder Inf")
    return x


def plane(liste: dict, auswahl=None, ohne_praefix=()) -> dict:
    """Rollen -> Quellen: Präfix-Einträge fallen weg, die Auswahl ersetzt gleichnamige Rollen oder ergänzt neue."""
    rollen = {k: list(v) for k, v in liste.items()
              if not k.startswith("_") and not any(k.startswith(p) for p in ohne_praefix)}
    for rolle, quellen in (auswahl or {}).items():
        if quellen:  # leere Liste = keine Auswahl, die Rolle bleibt wie in der Liste
            rollen[rolle] = list(quellen)
    return rollen


def baue(liste: dict, quelle: Path, ziel: Path, name: str, max_sek: float,
         auswahl=None, rollen=None, ohne_praefix=()) -> dict:
    plan = plane(liste, auswahl, ohne_praefix)
    if sum(len(v) for v in plan.values()) > MAX_KLAENGE:
        raise FachlicherAbbruch(f"mehr als {MAX_KLAENGE} Klänge: Noten 112+ belegt das Zusatz-Kit rec")
    cfg = rollen or {}
    rd = cfg.get("rollen", {})
    pegel = {r: float(v) for r, v in cfg.get("pegel_zusatz", {}).items()}
    pegel.update({r: float(d["spitze_db"]) for r, d in rd.items() if "spitze_db" in d})
    klaenge, daten, note = [], [], 0
    quellen = {}
    for s in sorted(plan):
        for n, rel in enumerate(plan[s]):
            x = wandle(quelle / urllib.parse.unquote(rel), max_sek)
            klaenge.append({"note": note, "name": f"{s}:{n}", "datei": f"{s}_{n}.f32", "frames": x.size // 2})
            daten.append(x)
            quellen[note] = (s, rel)
            note += 1
    # Rollen mit Muster: innerhalb der Rolle gleich laut im Rollenmuster, die Rolle über ihre höchste Spitze verankert
    for s in {r for r, _ in quellen.values()}:
        if s in rd and "spitze_db" in rd[s] and rd[s].get("muster"):
            idx = [i for i, (r, _) in quellen.items() if r == s]
            ls = []
            for i in idx:
                l = lautheit.integriert(probe.rendere_muster(daten[i].reshape(-1, 2), rd[s], RATE, BPM, TAKTE), RATE)
                if not np.isfinite(l):
                    raise ValueError(f"{quellen[i][1]}: still im Rollenmuster, keine Lautheit messbar")
                ls.append(l)
            g = [10 ** ((ls[0] - l) / 20) for l in ls]           # alle auf den Muster-LUFS des ersten
            spitzen = [float(np.max(np.abs(daten[i]))) * gi for i, gi in zip(idx, g)]
            skala = 10 ** (pegel[s] / 20) / max(spitzen)
            for i, gi in zip(idx, g):
                daten[i] = (daten[i] * np.float32(gi * skala)).astype("<f4")
                klaenge[i]["spitze_db"] = pegel[s]
                klaenge[i]["muster_lufs"] = round(float(lautheit.integriert(
                    probe.rendere_muster(daten[i].reshape(-1, 2), rd[s], RATE, BPM, TAKTE), RATE)), 2)
    for i, (s, rel) in quellen.items():
        x = daten[i]
        spitze = float(np.max(np.abs(x)))
        if s in pegel and "spitze_db" not in klaenge[i]:
            if spitze == 0.0:
                raise ValueError(f"{rel}: Stille, kein Pegel herstellbar")
            x = (x * np.float32(10 ** (pegel[s] / 20) / spitze)).astype("<f4")
            klaenge[i]["spitze_db"] = pegel[s]
            spitze = float(np.max(np.abs(x)))
            daten[i] = x
        if rollen is not None and spitze > 10 ** (MAX_SPITZE_DB / 20) * 1.0001:
            raise FachlicherAbbruch(f"{klaenge[i]['name']} ({rel}): Spitze {20 * np.log10(spitze):+.2f} dBFS liegt über "
                                    f"{MAX_SPITZE_DB} dBFS, Rolle '{s}' braucht einen Pegel in rollen.json")
    ziel.mkdir(parents=True, exist_ok=True)
    for e, x in zip(klaenge, daten):
        (ziel / e["datei"]).write_bytes(x.tobytes())
    kit = {"schema": 1, "name": name, "klaenge": klaenge}
    (ziel / "kit.json").write_text(json.dumps(kit, indent=1))
    return kit


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--liste", required=True)
    ap.add_argument("--quelle", required=True)
    ap.add_argument("--ziel", required=True)
    ap.add_argument("--name")
    ap.add_argument("--max-sek", type=float, default=4.0)
    ap.add_argument("--auswahl", help="auswahl.json {rolle: [absolute Quellen]} ersetzt/ergänzt Rollen")
    ap.add_argument("--rollen", help="rollen.json: normiert Klänge der genannten Rollen auf spitze_db")
    ap.add_argument("--ohne-praefix", action="append", default=[], help="Rollen mit diesem Präfix weglassen (wiederholbar)")
    a = ap.parse_args(argv)
    ziel = Path(a.ziel).expanduser()
    lies = lambda p: json.loads(Path(p).expanduser().read_text()) if p else None  # noqa: E731
    try:
        kit = baue(lies(a.liste), Path(a.quelle), ziel, a.name or ziel.name, a.max_sek,
                   auswahl=lies(a.auswahl), rollen=lies(a.rollen), ohne_praefix=a.ohne_praefix)
    except FachlicherAbbruch as e:
        print(f"kit_bauen: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"kit_bauen: {e}", file=sys.stderr)
        return 2
    except subprocess.CalledProcessError as e:
        datei = e.cmd[e.cmd.index("-i") + 1] if "-i" in e.cmd else str(e.cmd[0])
        err = (e.stderr or b"").decode(errors="replace").strip().splitlines()
        print(f"kit_bauen: {datei}: {err[-1] if err else f'ffmpeg endete mit Code {e.returncode}'}", file=sys.stderr)
        return 2
    except subprocess.TimeoutExpired as e:
        print(f"kit_bauen: {e.cmd[e.cmd.index('-i') + 1]}: ffmpeg nach {e.timeout:g} s abgebrochen", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(f"kit_bauen: {e.filename or e}: {e.strerror or 'nicht gefunden'} (ffmpeg oder Eingabedatei)", file=sys.stderr)
        return 2
    groesse = sum(k["frames"] for k in kit["klaenge"]) * 8
    print(f"kit {kit['name']}: {len(kit['klaenge'])} Klänge, {groesse / 2**20:.1f} MiB, nach {ziel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
