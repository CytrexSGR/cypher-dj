#!/usr/bin/env python3
"""Schreibt WAV-Breaks als ganze Klänge in ein Zusatz-Kit (Format wie kits/rec/kit.json), damit Strudel sie mit
begin/end choppt. Aufruf: break_kit.py --ziel ~/.config/cypherdj/kits/rec-a NAME=PFAD.wav [...]
Rückgabe 0 = geschrieben, 2 = Aufruf/Datei falsch. Schreibt kit.json zuletzt (der Erzeuger lädt bei Änderung neu)."""
import argparse, contextlib, json, re, subprocess, sys, time
from pathlib import Path

MAX_FRAMES = 480_000  # 10 s bei 48 kHz, wie kit_schreiben.mjs
NAME = re.compile(r"^[a-z][a-z0-9_]{0,15}$")
ERSTE_NOTE = 112


@contextlib.contextmanager
def sperre(ordner: Path):
    """Dieselbe Sperre wie kit_schreiben.mjs:30-44 (mkdir .sperre, nach 10 s verwaist), damit Loop-Box und dieses
    Werkzeug sich keine Einträge überschreiben."""
    s, bis = ordner / ".sperre", time.time() + 5
    while True:
        try:
            s.mkdir(); break
        except FileExistsError:
            try:
                if time.time() - s.stat().st_mtime > 10: s.rmdir(); continue
            except FileNotFoundError:
                continue
            if time.time() > bis: raise SystemExit(f"break_kit: Kit {ordner} ist gesperrt ({s})")
            time.sleep(0.05)
    try:
        yield
    finally:
        s.rmdir()


def zu_f32(quelle: Path) -> bytes:
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(quelle), "-ac", "2", "-ar", "48000", "-f", "f32le", "-"],
                       capture_output=True)
    if r.returncode != 0:
        raise ValueError(r.stderr.decode(errors="replace").strip())
    return r.stdout


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ziel", required=True)
    ap.add_argument("klaenge", nargs="+")
    a = ap.parse_args()
    ziel = Path(a.ziel).expanduser()
    eintraege = []
    for arg in a.klaenge:
        name, _, pfad = arg.partition("=")
        if not NAME.match(name) or not pfad:
            print(f"break_kit: '{arg}' ist nicht NAME=PFAD (NAME [a-z][a-z0-9_]{{0,15}})", file=sys.stderr)
            return 2
        try:
            daten = zu_f32(Path(pfad))
        except ValueError as e:
            print(f"break_kit: {pfad}: {e}", file=sys.stderr)
            return 2
        frames = len(daten) // 8
        if frames > MAX_FRAMES:
            print(f"break_kit: {pfad} ist {frames / 48000:.1f} s, höchstens 10 s", file=sys.stderr)
            return 2
        eintraege.append((name, daten, frames, pfad))
    ziel.mkdir(parents=True, exist_ok=True)
    with sperre(ziel):
        kit_pfad = ziel / "kit.json"
        alt = json.loads(kit_pfad.read_text()) if kit_pfad.exists() else {"klaenge": []}
        neue_namen = {f"{e[0]}:0" for e in eintraege}
        klaenge = [k for k in alt["klaenge"] if k["name"] not in neue_namen]  # Loop-Box-Einträge bleiben
        belegt = {k["note"] for k in klaenge}
        frei = (n for n in range(ERSTE_NOTE, 128) if n not in belegt)
        for name, daten, frames, pfad in eintraege:
            datei = f"{name}_0.f32"
            (ziel / datei).write_bytes(daten)
            klaenge.append({"note": next(frei), "name": f"{name}:0", "datei": datei, "frames": frames,
                            "quelle": f"wav:{pfad}"})
        tmp = ziel / "kit.json.neu"
        tmp.write_text(json.dumps({"schema": 1, "name": ziel.name, "klaenge": klaenge}, indent=1, ensure_ascii=False))
        tmp.replace(kit_pfad)
    print(f"kit {ziel.name}: {len(klaenge)} Klänge → {ziel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
