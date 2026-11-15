"""Generator of the starter demo project (`demo/project.json`): 32 bars at 128 BPM in A minor, deterministic, no random.

    python3 -m starter.demo_build            write demo/project.json
    python3 -m starter.demo_build --pruefe   exit 0 when the file equals bauen() byte for byte

Arrangement (bars are 1-based, 4 beats each):
    1-8    intro: Drums alone in 1-4 (kick), closed hats and the Pad from 5 (quiet and dark), clap from 7
    9-16   build: Bass enters at 9, Acid at 13, snare roll fills in 15 and 16, Bass filter and Acid cutoff open
    17-20  break: no kick, no bass; the Pad is pulled up (fader and cutoff), an Acid run in 19 and 20, a snare roll in 20
    21-32  drop: everything, with a crash, snare on the backbeat, open hats, tom fills, a moving bass and a 16th acid line
The Pad is the poly pad of the card (graph synth-poly, chords held two bars). The bass is `bassmusik` (saw, pulse and sub
through a wobbling filter with a ring-modulated growl band): its cutoff, wobble rate and growl jump per half bar in the drop
(synth-neuro has 69 samples of latency and the core refuses it on a project track). The Acid line is the RB-338 with accents
(velocity 127, the device accents from 120 up) and slides (a note that overlaps the next one glides into it), through a
saturator. The Drums feed a second return, a quiet tempo-synchronous echo (fx-delay-sync) that doubles the hits.
(Andreas, 2026-11-15, on the first version: bass too simple, acid too cute, the pad should come in earlier and rise in the break,
a light echo that doubles the drums.)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DATEI = Path(__file__).resolve().parent / "demo" / "project.json"
TAKTE = 32
BEATS = TAKTE * 4

# General MIDI notes of the kit `starter`
KICK, SNARE, CLAP, HAT, OHAT, CRASH = 36, 38, 39, 42, 46, 49
TOM_HI, TOM_MID, TOM_LO = 48, 45, 41

# the Hall return: the defaults of HALL_VORGABE in ui/project/model.ts, a little longer decay
HALL = {"an": True, "pre": 0.04, "decay": 0.62, "groesse": 0.4, "tief": 0.5658, "highcut": 0.7, "fahne": 0.66667}

# Pad knobs of synth-poly (normalised 0..1): k1 cutoff (a lane moves it), k3 env amount, k4 detune, k5 attack, k6 release, k7 chorus
PAD_PARAMETER = {"k1": 0.68, "k3": 0.2, "k4": 0.45, "k5": 0.81, "k6": 0.83, "k7": 0.7}

# Bass knobs of bassmusik: k1 cutoff, k2 wobble depth, k3 wobble rate, k4 resonance, k5 growl, k6 sub, k7 drive, k8 release
BASS_PARAMETER = {"k1": 0.35, "k2": 0.45, "k3": 0.5, "k4": 0.45, "k5": 0.3, "k6": 0.6, "k7": 0.55, "k8": 0.3}

# Acid: saw, high resonance, strong envelope and accent
ACID_PARAMETER = {"lautstaerke": 1.0, "wellenform": 0, "cutoff": 0.3, "resonanz": 0.78, "env_mod": 0.7, "decay": 0.35, "accent": 0.85}

# the echo return: Hall off, one effect stage; knob 1 feedback, knob 2 level (wet only)
ECHO_WERTE = {**{f"k{i}": 0.5 for i in range(1, 9)}, "k1": 0.3, "k2": 0.6}

Note = tuple[float, float, int, int]   # beat, length, key, velocity


def _takt(nr: int) -> float:
    return (nr - 1) * 4.0


def drums() -> list[Note]:
    n: list[Note] = []
    for t in range(1, TAKTE + 1):
        b = _takt(t)
        drop = t >= 21
        if t <= 16 or drop:   # kick everywhere except the break; bar 20 and the break have none
            for k in range(4):
                n.append((b + k, 0.25, KICK, 112))
        if t >= 5 and (t <= 16 or drop):   # closed hats on the 16ths, the off-beat accented; the open hat takes the last off-beat of a bar
            for k in range(4):
                n.append((b + k + 0.5, 0.125, HAT, 127))
                n.append((b + k + 0.25, 0.125, HAT, 88))
                n.append((b + k + 0.75, 0.125, HAT, 88))
            if t >= 9 and not drop:
                n.append((b + 3.5, 0.25, OHAT, 120))
        if t >= 7 and (t <= 16 or drop):   # clap on 2 and 4
            for k in (1, 3):
                n.append((b + k, 0.25, CLAP, 118))
        if drop:   # something new in the drop: crash, snare on the backbeat, open hats on every off-beat, tom fills, a ghost snare
            for k in (1, 3):
                n.append((b + k, 0.25, SNARE, 112))
            for k in range(4):
                n.append((b + k + 0.5, 0.25, OHAT, 112))
            if t % 2 == 0:
                n.append((b + 2.75, 0.125, SNARE, 55))
        if t in (21, 29):
            n.append((b, 1.0, CRASH, 105))
        if t in (24, 28):   # tom fill in the last beat
            for i, ton in enumerate((TOM_HI, TOM_HI, TOM_MID, TOM_LO)):
                n.append((b + 3 + i * 0.25, 0.25, ton, 96 - 4 * i))
    # snare rolls: bar 15 on 8ths, bar 16 on 16ths (the build), bar 20 the second half on 16ths (into the drop), bar 32 the last beat
    for i in range(8):
        n.append((_takt(15) + i * 0.5, 0.25, SNARE, 52 + i * 5))
    for i in range(16):
        n.append((_takt(16) + i * 0.25, 0.125, SNARE, 60 + i * 4))
    # break: only a quiet closed hat comes back in bar 19, and the roll in bar 20
    for k in range(4):
        n.append((_takt(19) + k + 0.5, 0.125, HAT, 70))
    for k in range(8):
        n.append((_takt(20) + k * 0.5, 0.125, HAT, 64 + k * 4))
    for i in range(8):
        n.append((_takt(20) + 2 + i * 0.25, 0.125, SNARE, 64 + i * 7))
    for i in range(4):
        n.append((_takt(32) + 3 + i * 0.25, 0.125, SNARE, 70 + i * 12))
    return n


# bass root per bar of a four-bar cycle (A1 A1 F1 G1)
_WURZEL = (33, 33, 29, 31)


def bass() -> list[Note]:
    n: list[Note] = []
    for t in list(range(9, 17)) + list(range(21, 33)):
        b, w = _takt(t), _WURZEL[(t - 1) % 4]
        if t < 21:   # build: a syncopated two-bar phrase off the beats; the last beat of bar 16 stays empty before the break
            if t % 2:
                takt = [(0.5, 0.4, 0, 100), (1.5, 0.25, 0, 100), (1.75, 0.2, 12, 86), (2.5, 0.4, 0, 100), (3.5, 0.4, 0, 96)]
            else:
                takt = [(0.5, 0.4, 0, 100), (1.25, 0.2, 12, 86), (1.5, 0.4, 0, 100), (2.5, 0.25, 0, 100), (2.75, 0.2, 7, 90),
                        (3.5, 0.25, 0, 96), (3.75, 0.2, 12, 84)]
            n.extend((b + x, l, w + d, v) for x, l, d, v in takt if not (t == 16 and x >= 3))
        elif t % 4 == 0:   # drop, every fourth bar: the phrase ends in a 16th run over octave and fifth
            takt = [(0.5, 0.25, 0, 104), (0.75, 0.2, 12, 88), (1.5, 0.4, 0, 100), (2.25, 0.2, 7, 92), (2.5, 0.2, 0, 104),
                    (2.75, 0.2, 12, 92), (3.25, 0.2, 12, 96), (3.5, 0.2, 7, 96), (3.75, 0.2, 12, 100)]
            n.extend((b + x, l, w + d, v) for x, l, d, v in takt)
        elif t % 2:   # drop, odd bars
            takt = [(0.5, 0.25, 0, 104), (0.75, 0.2, 12, 88), (1.25, 0.2, 0, 92), (1.5, 0.4, 0, 100), (2.25, 0.2, 7, 92),
                    (2.5, 0.25, 0, 104), (2.75, 0.2, 12, 88), (3.5, 0.25, 0, 100), (3.75, 0.2, 12, 90)]
            n.extend((b + x, l, w + d, v) for x, l, d, v in takt)
        else:   # drop, even bars: the answer, longer notes and the fifth
            takt = [(0.5, 0.45, 0, 104), (1.25, 0.2, 12, 90), (1.5, 0.25, 0, 100), (1.75, 0.2, 7, 90), (2.5, 0.45, 0, 104),
                    (3.25, 0.2, 12, 92), (3.5, 0.45, 7, 96)]
            n.extend((b + x, l, w + d, v) for x, l, d, v in takt)
    return n


# acid lines, one bar each: (16th step, key, accent, slide into the next note). A2 = 45.
_ACID_AUFBAU = ((0, 45, True, False), (3, 45, False, False), (6, 48, False, True), (7, 45, False, False),
                (8, 45, True, False), (11, 52, False, False), (14, 55, False, True), (15, 57, True, False))
_ACID_A = ((0, 45, True, False), (1, 45, False, False), (3, 45, False, False), (4, 48, False, True), (5, 45, False, False),
           (6, 57, True, False), (8, 45, False, False), (10, 43, False, True), (11, 45, False, False),
           (12, 52, True, False), (14, 48, False, True), (15, 45, False, False))
_ACID_B = ((0, 45, True, False), (2, 45, False, False), (3, 52, True, False), (5, 45, False, False), (6, 43, False, True),
           (7, 45, False, False), (8, 57, True, True), (9, 55, False, False), (11, 45, False, False),
           (12, 48, False, True), (13, 50, False, True), (14, 52, True, False), (15, 45, False, False))
_ACID_LAUF = ((0, 45, True, False), (2, 45, False, False), (4, 48, False, True), (5, 50, False, True), (6, 52, True, False),
              (8, 52, False, False), (9, 55, False, True), (10, 57, True, False), (12, 57, False, True), (13, 60, False, True),
              (14, 64, True, True), (15, 69, True, False))


def _acid_takt(takt_nr: int, linie) -> list[Note]:
    """A slide note is held past the next step so the RB-338 glides; an accent is velocity 127, the rest stays below 120."""
    b = _takt(takt_nr)
    return [(b + s * 0.25, 0.32 if slide else 0.18, ton, 127 if akzent else 96) for s, ton, akzent, slide in linie]


def acid() -> list[Note]:
    n: list[Note] = []
    for t in range(13, 17):   # build, bars 13-16: eight notes a bar, the first accents and slides
        n.extend(_acid_takt(t, _ACID_AUFBAU))
    n.extend(_acid_takt(19, _ACID_AUFBAU))   # break: the build figure once, then a run up into the drop
    n.extend(_acid_takt(20, _ACID_LAUF))
    for t in range(21, 33):   # drop: two answering 16th lines
        n.extend(_acid_takt(t, _ACID_A if t % 2 else _ACID_B))
    return n


# pad chords, two bars each: Am, F, C, G (voiced close, held 1.9 bars)
_AKKORDE = ((57, 60, 64), (53, 57, 60), (55, 60, 64), (55, 59, 62))


def pad() -> list[Note]:
    n: list[Note] = []
    for t in range(5, 33, 2):   # from bar 5; the cycle starts again on Am in bar 17, the break
        akk = _AKKORDE[((t - 5) // 2) % 4 if t < 17 else ((t - 17) // 2) % 4]
        for ton in akk:
            n.append((_takt(t), 7.5, ton, 80))
    return n


def _noten(roh: list[Note], erste_id: int) -> tuple[list[dict], int]:
    ids = erste_id
    aus = []
    for beat, laenge, ton, vel in sorted(roh, key=lambda x: (x[0], x[2])):
        aus.append({"id": f"n{ids}", "beat": _zahl(beat), "laenge": _zahl(laenge), "ton": ton, "vel": vel})
        ids += 1
    return aus, ids


def _zahl(x: float) -> float | int:
    x = round(x, 6)
    return int(x) if x == int(x) else x


def _lane(nr: int, ziel: str, punkte: list[tuple]) -> dict:
    """Points are (beat, value) or (beat, value, "sprung"): a jump holds the previous value up to its beat."""
    aus = []
    for p in punkte:
        punkt = {"beat": _zahl(p[0]), "wert": _zahl(p[1])}
        if len(p) > 2:
            punkt["form"] = p[2]
        aus.append(punkt)
    return {"id": f"a{nr}", "ziel": ziel, "punkte": aus}


def _stufen(von_takt: int, bis_takt: int, werte: tuple[float, ...]) -> list[tuple]:
    """One jump per half bar from bar `von_takt` to `bis_takt` inclusive, cycling through `werte`."""
    aus = []
    for i in range((bis_takt - von_takt + 1) * 2):
        aus.append((_takt(von_takt) + i * 2, werte[i % len(werte)], "sprung"))
    return aus


def bauen() -> dict:
    zaehler = 1
    spuren = []
    spec = [
        ("Drums", "#e0563b", {"art": "intern", "name": "kit", "kit": "starter"}, drums(), -6, None,
         [{"id": "r1", "db": -16}, {"id": "r2", "db": -10}], None, None),
        ("Bass", "#3b7be0", {"art": "intern", "name": "bk", "graph": "bassmusik", "parameter": BASS_PARAMETER},
         bass(), 0, "g1", None,
         [_lane(1, "geraet.k1", [(32, 0.2), (48, 0.32), (63, 0.55)] + _stufen(21, 32, (0.42, 0.62, 0.5, 0.78, 0.38, 0.66, 0.5, 0.85))),
          _lane(4, "fader", [(32, -5), (63, -3), (80, -1)]),
          _lane(6, "geraet.k5", [(32, 0.15), (63, 0.35)] + _stufen(21, 32, (0.3, 0.6, 0.25, 0.7, 0.35, 0.55, 0.3, 0.8))),
          _lane(7, "geraet.k3", [(32, 0.4)] + _stufen(21, 32, (0.4, 0.6, 0.5, 0.75)))], None),
        ("Acid", "#9be03b", {"art": "intern", "name": "rb338", "parameter": ACID_PARAMETER},
         acid(), 0, "g1", None,
         [_lane(2, "geraet.cutoff", [(48, 0.18), (63, 0.6), (72, 0.3), (79.5, 0.8), (80, 0.4, "sprung"), (96, 0.62), (104, 0.45),
                                    (112, 0.7), (124, 0.9), (128, 0.6)]),
          _lane(5, "fader", [(48, -4), (63, -1), (80, 2)]),
          _lane(8, "geraet.resonanz", [(48, 0.7), (80, 0.75), (112, 0.86), (128, 0.8)])],
         [{"id": "i1", "art": "saett", "slot": 1, "an": True, "werte": {"drive": 12, "mix": 1, "out": -12}}]),
        ("Pad", "#c03be0", {"art": "intern", "name": "bk", "graph": "synth-poly", "parameter": PAD_PARAMETER},
         pad(), -4, "g1", [{"id": "r1", "db": -8}],
         [_lane(3, "fader", [(16, -18), (32, -15), (63, -12), (64, -10), (78, -2), (80, -6), (96, -4)]),
          _lane(9, "geraet.k1", [(16, 0.3), (63, 0.42), (64, 0.45), (78, 0.88), (80, 0.68), (128, 0.72)])], None),
    ]
    for i, (name, farbe, geraet, roh, fader, gruppe, sends, lanes, inserts) in enumerate(spec, 1):
        noten, zaehler = _noten(roh, zaehler)
        s: dict = {
            "id": f"s{i}", "nr": i, "name": name, "farbe": farbe, "art": "instrument", "geraet": geraet,
            "fader_db": fader, "pan": 0, "mute": False, "solo": False, "von": "andreas",
            "clips": [{"id": f"c{i}", "art": "midi", "name": name.lower(), "start_beat": 0, "laenge_beats": BEATS, "noten": noten}],
        }
        if gruppe:
            s["ausgang"] = {"art": "gruppe", "id": gruppe}
        if sends:
            s["sends"] = sends
        if lanes:
            s["automation"] = lanes
        if inserts:
            s["inserts"] = inserts
        spuren.append(s)
    return {
        "format": "cypherdj-projekt/2", "name": "Demo", "rev": 1, "wiedergabe_rev": 1, "tempo_bpm": 128, "taktart": [4, 4],
        "loop": {"an": True, "von_beat": 0, "bis_beat": BEATS},
        "metronom": {"an": False, "pegel_db": -12, "ziel": "master"},
        "spuren": spuren,
        "gruppen": [{"id": "g1", "nr": 1, "name": "Music", "farbe": "#e0a23b", "fader_db": 3, "pan": 0, "mute": False, "solo": False,
                     "gefaltet": False}],
        "returns": [{"id": "r1", "nr": 1, "name": "Hall", "farbe": "#3bc0e0", "fader_db": 0, "pan": 0, "mute": False, "solo": False,
                     "hall": HALL},
                    {"id": "r2", "nr": 2, "name": "Echo", "farbe": "#e03b9b", "fader_db": 0, "pan": 0, "mute": False, "solo": False,
                     "hall": {**HALL, "an": False},
                     "inserts": [{"id": "i2", "art": "bk", "graph": "fx-delay-sync", "slot": 1, "an": True, "werte": ECHO_WERTE}]}],
        "master": {"fader_db": -1},
        "naechste_id": {"spur": len(spuren) + 1, "clip": len(spuren) + 1, "gruppe": 2, "lane": 10, "return": 3,
                        "insert": 3},
        "naechste_noten_id": zaehler,
    }


def _ganz(x):
    """Whole floats as integers, as JSON.stringify writes them (1.0 becomes 1)."""
    if isinstance(x, float) and x == int(x):
        return int(x)
    if isinstance(x, dict):
        return {k: _ganz(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_ganz(v) for v in x]
    return x


def text() -> str:
    """The file as model.ts writes it: keys sorted deep, one space of indent, a final newline."""
    return json.dumps(_ganz(bauen()), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="starter.demo_build")
    p.add_argument("--pruefe", action="store_true", help="exit 0 when demo/project.json equals bauen() byte for byte")
    a = p.parse_args(argv)
    if a.pruefe:
        ok = DATEI.is_file() and DATEI.read_text() == text()
        if not ok:
            print(f"{DATEI} differs from bauen(): run python3 -m starter.demo_build", file=sys.stderr)
        return 0 if ok else 1
    DATEI.write_text(text())
    print(f"wrote {DATEI} ({DATEI.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
