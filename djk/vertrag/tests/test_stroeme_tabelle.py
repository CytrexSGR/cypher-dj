"""Contract test S18 task 1: the shared stream <-> channel table djk/vertrag/stroeme.ts against the kern sources.
pytest -q djk/vertrag/tests/test_stroeme_tabelle.py -p no:cacheprovider. Runtime < 2 s.
Mutation probes and negative controls work on copies in tmp_path, never in the working tree.

stroeme.ts is parsed with regexes (exported object and array literals only), so the file has to stay plain data."""
import re
import shutil
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parents[1]
WURZEL = HIER.parents[1]   # repo root of this working tree (also inside a worktree)

STROEME_TS = "djk/vertrag/stroeme.ts"
MIXER_H = "djk/kern/include/cypherdj/mixer.h"
NETZ_ERZ_CPP = "djk/kern/src/netz_erz.cpp"
REGLER_CPP = "djk/kern/stellwerk/src/regler.cpp"
ERZEUGER_H = "djk/kern/include/cypherdj/erzeuger.h"
AUFNAHME_H = "djk/kern/include/cypherdj/aufnahme.h"
QUELLEN = [STROEME_TS, MIXER_H, NETZ_ERZ_CPP, REGLER_CPP, ERZEUGER_H, AUFNAHME_H]


def lies(wurzel: Path, rel: str) -> str:
    return (wurzel / rel).read_text(encoding="utf-8")


def _wert(roh: str):
    roh = roh.strip()
    if roh[0] in "'\"":
        return roh[1:-1]
    return int(roh)


def objekt(ts: str, name: str) -> dict:
    """`export const NAME = { key: value, ... }` -> dict (keys: number or quoted string)."""
    m = re.search(r"export const " + re.escape(name) + r"\b[^=]*=\s*\{(.*?)\}", ts, re.S)
    assert m, f"stroeme.ts: object literal {name} missing"
    out = {}
    for k, v in re.findall(r"""(?:^|,|\n)\s*('[^']*'|"[^"]*"|\d+)\s*:\s*('[^']*'|"[^"]*"|\d+)""", m.group(1)):
        out[_wert(k)] = _wert(v)
    return out


def liste(ts: str, name: str) -> list:
    """`export const NAME = [ ... ]` -> list."""
    m = re.search(r"export const " + re.escape(name) + r"\b[^=]*=\s*\[(.*?)\]", ts, re.S)
    assert m, f"stroeme.ts: array literal {name} missing"
    return [_wert(x) for x in re.findall(r"""'[^']*'|"[^"]*"|\d+""", m.group(1))]


def cpp_zahlen(h: str, name: str) -> list:
    """`constexpr int NAME[...] = {1, 2, 3};` -> [1, 2, 3]."""
    m = re.search(r"constexpr int " + re.escape(name) + r"\[[^\]]*\]\s*=\s*\{([^}]*)\}", h)
    assert m, f"aufnahme.h: array {name} missing"
    return [int(x) for x in re.findall(r"\d+", m.group(1))]


def mixer_index(mixer_h: str) -> dict:
    """Layout comment of MIX_QUELLEN in mixer.h -> channel name -> mixer index."""
    m = re.search(r"deck/1\.\.4 \((\d+)\.\.(\d+)\), erz/1\.\.8 \((\d+)\.\.(\d+)\), pad/1\.\.2 \((\d+), (\d+)\)", mixer_h)
    assert m, "mixer.h: layout comment 'deck/1..4 (0..3), erz/1..8 (4..11), pad/1..2 (12, 13)' not found"
    d0, d1, e0, e1, p0, p1 = map(int, m.groups())
    idx = {}
    for i in range(1, 5):
        idx[f"deck/{i}"] = d0 + i - 1
    for i in range(1, 9):
        idx[f"erz/{i}"] = e0 + i - 1
    for i in range(1, 3):
        idx[f"pad/{i}"] = p0 + i - 1
    assert d1 == 3 and e1 == 11 and p1 == 13
    return idx


def pruefe(wurzel: Path) -> list:
    """All findings as strings; empty = green."""
    f = []
    ts = lies(wurzel, STROEME_TS)
    idx = mixer_index(lies(wurzel, MIXER_H))

    # 1. STROM_KANAL and the stream = mixer index - 3 rule
    erwartet = {1: "erz/1", 2: "erz/2", 3: "erz/3", 5: "erz/5", 6: "erz/6", 7: "erz/7", 9: "pad/1", 10: "pad/2"}
    sk = objekt(ts, "STROM_KANAL")
    if sk != erwartet:
        f.append(f"STROM_KANAL differs: {sk} != {erwartet}")
    for s, k in sk.items():
        if k not in idx or s != idx[k] - 3:
            f.append(f"STROM_KANAL: stream {s} -> {k} violates stream == mixer index - 3")

    # 2. INSTRUMENT_STROEME against the kern rule (netz_erz.cpp) and the kn_bk list (regler.cpp)
    inst = liste(ts, "INSTRUMENT_STROEME")
    if inst != [2, 3, 5, 6, 7, 9, 10]:
        f.append(f"INSTRUMENT_STROEME differs: {inst}")
    netz = lies(wurzel, NETZ_ERZ_CPP)
    m = re.search(r"kanal_ok = k >= (\d+) && k <= (\d+) && k != Mixer::kanal_index\(VORHOER_KANAL\)", netz)
    if not m:
        f.append("netz_erz.cpp: kanal_ok rule not found")
    else:
        lo, hi = int(m.group(1)), int(m.group(2))
        vorhoer = re.search(r'VORHOER_KANAL = "([^"]+)"', lies(wurzel, MIXER_H)).group(1)
        arr = re.search(r'ARR_KANAL = "([^"]+)"', lies(wurzel, MIXER_H)).group(1)
        regler = lies(wurzel, REGLER_CPP)
        kn_bk = re.search(r"for \(const char\* kn_bk : \{([^}]*)\}", regler)
        kn_liste = re.findall(r'"([^"]+)"', kn_bk.group(1)) if kn_bk else []
        for s in inst:
            k = sk.get(s)
            if k is None:
                f.append(f"INSTRUMENT_STROEME: stream {s} has no channel")
                continue
            if not (lo <= idx[k] <= hi):
                f.append(f"kern rule (netz_erz.cpp k >= {lo} && k <= {hi}) refuses {k}")
            if k in (vorhoer, arr):
                f.append(f"kern refuses {k} (cue or production channel)")
            if k not in kn_liste:
                f.append(f"regler.cpp kn_bk list lacks {k}")

    # 3. BK_STROEME and STROM_MIDI_ZIEL
    bk = liste(ts, "BK_STROEME")
    if bk != [5, 6, 7, 9, 10]:
        f.append(f"BK_STROEME differs: {bk}")
    mz = objekt(ts, "STROM_MIDI_ZIEL")
    if sorted(mz) != sorted(bk):
        f.append(f"STROM_MIDI_ZIEL keys {sorted(mz)} != BK_STROEME {sorted(bk)}")
    ports = int(re.search(r"ERZ_MIDI_PORTS = (\d+)", lies(wurzel, ERZEUGER_H)).group(1))
    for s, z in mz.items():
        mm = re.fullmatch(r"midi:([1-4]):([1-9]|1[0-6])", str(z))
        if not mm:
            f.append(f"STROM_MIDI_ZIEL[{s}] = {z!r} is not midi:<1..4>:<1..16>")
        elif int(mm.group(1)) > ports:
            f.append(f"STROM_MIDI_ZIEL[{s}] = {z} uses a port above ERZ_MIDI_PORTS {ports}")
        if z in ("midi:1:1", "midi:2:1"):
            f.append(f"STROM_MIDI_ZIEL[{s}] = {z} collides with the studio's instrument targets")
    if len(set(mz.values())) != len(mz):
        f.append(f"STROM_MIDI_ZIEL has duplicate targets: {mz}")

    # 4. REC_EINGANG and INTERNE_EINGAENGE
    re_erw = {"erz/1": 11, "erz/2": 12, "erz/3": 13, "erz/5": 15, "erz/6": 16, "erz/7": 17, "pad/1": 21, "pad/2": 22}
    rec = objekt(ts, "REC_EINGANG")
    if rec != re_erw:
        f.append(f"REC_EINGANG differs: {rec}")
    ie = liste(ts, "INTERNE_EINGAENGE")
    if ie != list(re_erw):
        f.append(f"INTERNE_EINGAENGE differs: {ie}")

    # 5. aufnahme.h: REC_CODES / REC_MIXER (the kern's tap table) agree with REC_EINGANG and the mixer layout
    auf = lies(wurzel, AUFNAHME_H)
    codes = cpp_zahlen(auf, "REC_CODES")
    mix = cpp_zahlen(auf, "REC_MIXER")
    if codes != list(re_erw.values()):
        f.append(f"aufnahme.h REC_CODES {codes} differs from REC_EINGANG {list(re_erw.values())}")
    elif mix != [idx[k] for k in re_erw]:
        f.append(f"aufnahme.h REC_MIXER {mix} differs from the mixer index of {list(re_erw)}: {[idx[k] for k in re_erw]}")
    return f


@pytest.fixture
def kopie(tmp_path):
    for rel in QUELLEN:
        ziel = tmp_path / rel
        ziel.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(WURZEL / rel, ziel)
    return tmp_path


def mutiere(wurzel: Path, rel: str, alt: str, neu: str) -> None:
    p = wurzel / rel
    t = p.read_text(encoding="utf-8")
    treffer = t.count(alt)
    assert treffer == 1, f"mutation hits {treffer}x instead of 1x in {rel}: {alt!r}"   # else the mutation is a no-op
    p.write_text(t.replace(alt, neu), encoding="utf-8")


def test_working_tree_is_green():
    assert pruefe(WURZEL) == []


def test_negative_control_unchanged_copy_is_green(kopie):
    assert pruefe(kopie) == []


def test_negative_control_whitespace_and_comment_only_change_stays_green(kopie):
    p = kopie / STROEME_TS
    p.write_text("// harmless comment\n" + p.read_text(encoding="utf-8").replace(", ", ",  "), encoding="utf-8")
    assert pruefe(kopie) == []


MUTATIONEN = [
    (STROEME_TS, "9: 'pad/1'", "9: 'pad/2'", "violates stream == mixer index - 3"),
    (NETZ_ERZ_CPP, "k <= 13", "k <= 12", "kern rule (netz_erz.cpp k >= 4 && k <= 12) refuses pad/2"),
    (REGLER_CPP, '"erz/7", ', "", "regler.cpp kn_bk list lacks erz/7"),
    (STROEME_TS, "10: 'midi:4:2'", "10: 'midi:4:1'", "duplicate targets"),
    (AUFNAHME_H, "{4, 5, 6, 8, 9, 10, 12, 13}", "{4, 5, 6, 8, 9, 9, 12, 13}", "REC_MIXER"),   # code 17 would record the tap of erz/6
    (AUFNAHME_H, "{4, 5, 6, 8, 9, 10, 12, 13}", "{4, 5, 6, 8, 9, 10, 13, 12}", "REC_MIXER"),   # pad taps swapped
    (AUFNAHME_H, "{11, 12, 13, 15, 16, 17, 21, 22}", "{11, 12, 13, 15, 16, 17, 21, 23}", "REC_CODES"),
]


@pytest.mark.parametrize("rel,alt,neu,meldung", MUTATIONEN, ids=[m[3][:40] for m in MUTATIONEN])
def test_mutation_turns_red(kopie, rel, alt, neu, meldung):
    mutiere(kopie, rel, alt, neu)
    gefunden = pruefe(kopie)
    assert any(meldung in x for x in gefunden), gefunden
