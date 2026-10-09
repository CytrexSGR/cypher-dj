#!/usr/bin/env python3
"""Flügel für den Carla-Wirt bauen (Glanz Welle 4): aus dem Ableton-Core-Library-Flügel (30 Tonorte x 4 Anschlagstufen,
offene AIFF) ein SFZ mit Tonbereichen und lovel/hivel, gespielt von Carlas eingebautem SFZ-Sampler (wirt.py --sfz).

Carla wählt den Decoder nach der Endung: ".aif" lehnt es ab („ad_open(): no decoder backend"), ".aiff" und ".ogg"
lädt libsndfile (gemessen 2026-10-06, ~/messungen/2026-10-06-welle4-fluegel/). Deshalb Symlinks mit Endung .aiff statt
einer Umwandlung: kein Platz, die Originale bleiben in der Core Library. Lizenz: die Klänge dürfen in eigener Musik
klingen, die Dateien gehören nicht ins Repo; hier liegen nur Verweise unter ~/.config.

Aufruf: instrument_bauen.py [--quelle DIR] [--ziel ~/.config/cypherdj/instrumente/grand] [--name grand]"""
import argparse
import os
import re
import shutil
import sys
from pathlib import Path

QUELLE = Path.home() / ".wine-ableton/drive_c/ProgramData/Ableton/Live 12 Standard/Resources/Core Library/Samples/Multisamples/Grand Piano"
ZIEL = Path.home() / ".config/cypherdj/instrumente/grand"
STUFEN = (("p", 1, 40), ("mf", 41, 80), ("f", 81, 110), ("ff", 111, 127))
TASTEN = (21, 108)  # A0..C8 eines Flügels in MIDI
TONKLASSE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
DATEI = re.compile(r"GrandPiano ([A-G]#?) ?(-?\d) (p|mf|f|ff)\.aif")  # Live schreibt einmal "A# 1"


class Abbruch(ValueError):
    pass


def midi(ton: str) -> int:
    """Ableton-Tonname → MIDI-Note; Ableton zählt C3 = 60 (am Flügel gemessen: C3 klingt bei 262 Hz)."""
    m = re.fullmatch(r"([A-G]#?)(-?\d)", ton)
    if not m:
        raise Abbruch(f"Tonname {ton!r}")
    return 12 * (int(m[2]) + 2) + TONKLASSE[m[1]]


def baue(quelle: Path, ziel: Path, name: str) -> Path:
    toene: dict[int, dict[str, str]] = {}
    for f in sorted(os.listdir(quelle)):
        m = DATEI.fullmatch(f)
        if m:
            toene.setdefault(midi(m[1] + m[2]), {})[m[3]] = f
    if not toene:
        raise Abbruch(f"keine Flügel-Samples (GrandPiano <Ton> <Stufe>.aif) in {quelle}")
    for k, st in toene.items():
        fehlt = [s for s, _, _ in STUFEN if s not in st]
        if fehlt:
            raise Abbruch(f"Ton {k}: Stufe {', '.join(fehlt)} fehlt")
    proben = ziel / "proben"
    if proben.exists():
        shutil.rmtree(proben)
    proben.mkdir(parents=True)
    kerne = sorted(toene)
    zeilen = [f"// {name}: Ableton Core Library Grand Piano über Symlinks, {len(kerne)} Tonorte, 4 Anschlagstufen.",
              "// Erzeugt von djk/wirte/carla/instrument_bauen.py, nicht von Hand ändern.",
              f"<control> default_path={proben}/", "<group> ampeg_release=0.8"]
    for i, k in enumerate(kerne):
        lo = TASTEN[0] if i == 0 else (kerne[i - 1] + k) // 2 + 1
        hi = TASTEN[1] if i == len(kerne) - 1 else (k + kerne[i + 1]) // 2
        for stufe, lv, hv in STUFEN:
            original = quelle / toene[k][stufe]
            link = f"{k:03d}_{stufe}.aiff"
            (proben / link).symlink_to(original.resolve())
            zeilen.append(f"<region> sample={link} pitch_keycenter={k} lokey={lo} hikey={hi} lovel={lv} hivel={hv}")
    sfz = ziel / f"{name}.sfz"
    tmp = sfz.with_suffix(".sfz.neu")
    tmp.write_text("\n".join(zeilen) + "\n")
    os.replace(tmp, sfz)
    return sfz


ENDUNGEN = (".wav", ".aiff", ".ogg", ".flac")  # was Carlas Decoder nach Endung annimmt (.aif nicht, gemessen)


def pruefe(sfz: Path) -> list[str]:
    """Vor dem Laden im Wirt: Carla meldet SFZ-Ladefehler nur auf stdout, get_last_error ist dort unzuverlässig
    (meldete im Spike „Invalid or unsupported plugin type" bei geladenem, klingendem SFZ). Leer = ladbar."""
    if not sfz.is_file():
        return [f"{sfz}: fehlt"]
    basis, fehler = sfz.parent, []
    for z in sfz.read_text().splitlines():
        m = re.search(r"default_path=(\S+)", z)
        if m:
            basis = Path(m[1]) if Path(m[1]).is_absolute() else sfz.parent / m[1]
        m = re.search(r"sample=(\S+)", z)
        if m:
            p = basis / m[1]
            if p.suffix.lower() not in ENDUNGEN:
                fehler.append(f"{p.name}: Endung {p.suffix} lädt Carla nicht")
            elif not p.exists():
                fehler.append(f"{p}: fehlt")
    return fehler


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--quelle", type=Path, default=QUELLE)
    ap.add_argument("--ziel", type=Path, default=ZIEL)
    ap.add_argument("--name", default="grand")
    a = ap.parse_args(argv)
    try:
        sfz = baue(a.quelle, a.ziel, a.name)
    except (Abbruch, OSError) as e:
        print(f"instrument_bauen: {e}", file=sys.stderr)
        return 1
    print(f"{sfz}: {sum(1 for z in sfz.read_text().splitlines() if z.startswith('<region>'))} Regionen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
