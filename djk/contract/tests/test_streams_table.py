"""Contract test S18 / container core V4: the shared stream, alias and recording tables djk/contract/stroeme.ts.
pytest -q djk/contract/tests/test_streams_table.py -p no:cacheprovider. Runtime < 3 s.

Sources read (D-K18): streams.ts and the generated pult_table.h only. No core source file is parsed here: the core
checks its own side against pult_table.h. Mutation probes and negative controls work on copies in tmp_path.

streams.ts is parsed with regexes (exported object and array literals only), so the file has to stay plain data.
The runtime test loads it with node (erasable TypeScript, type stripping)."""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parents[1]
WURZEL = HIER.parents[1]   # repo root of this working tree (also inside a worktree)

STROEME_TS = "djk/contract/streams.ts"
PULT_H = "djk/core/include/cypherdj/pult_table.h"
PULT_TS = "djk/contract/pult.ts"
QUELLEN = [STROEME_TS, PULT_H, PULT_TS]

STROM_KANAL_ERWARTET = {1: "erz/1", 2: "erz/2", 3: "erz/3", 5: "erz/5", 6: "erz/6", 7: "erz/7", 9: "erz/9", 10: "erz/10"}
REC_ERWARTET = {"erz/1": 11, "erz/2": 12, "erz/3": 13, "erz/5": 15, "erz/6": 16, "erz/7": 17,
                "pad/1": 21, "pad/2": 22, "deck/1": 23, "deck/2": 24}


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
    assert m, f"streams.ts: object literal {name} missing"
    out = {}
    for k, v in re.findall(r"""(?:^|,|\n)\s*('[^']*'|"[^"]*"|\d+)\s*:\s*('[^']*'|"[^"]*"|\d+)""", m.group(1)):
        out[_wert(k)] = _wert(v)
    assert out, f"streams.ts: object literal {name} parsed empty"
    return out


def liste(ts: str, name: str) -> list:
    """`export const NAME = [ ... ]` -> list."""
    m = re.search(r"export const " + re.escape(name) + r"\b[^=]*=\s*\[(.*?)\]", ts, re.S)
    assert m, f"streams.ts: array literal {name} missing"
    out = [_wert(x) for x in re.findall(r"""'[^']*'|"[^"]*"|\d+""", m.group(1))]
    assert out, f"streams.ts: array literal {name} parsed empty"
    return out


def pult_zahl(h: str, name: str) -> int:
    m = re.search(r"inline constexpr int " + re.escape(name) + r"\s*=\s*(\d+);", h)
    assert m, f"pult_table.h: constant {name} missing"
    return int(m.group(1))


def pult_pfade(h: str, name: str) -> list:
    m = re.search(r"inline constexpr const char\* " + re.escape(name) + r"\[\d+\]\s*=\s*\{([^}]*)\}", h)
    assert m, f"pult_table.h: array {name} missing"
    out = re.findall(r'"([^"]+)"', m.group(1))
    assert out, f"pult_table.h: array {name} parsed empty"
    return out


def alle_stroeme(wurzel: Path, f: list) -> list:
    """ALLE_STROEME is not a copy: streams.ts imports PULT_ALIAS_STROEME from pult.ts (generated from pult.json alias_stroeme) and aliases it."""
    ts = lies(wurzel, STROEME_TS)
    if not re.search(r"import\s*\{\s*PULT_ALIAS_STROEME\s*\}\s*from\s*'\./pult\.ts'", ts) \
            or not re.search(r"export const ALLE_STROEME\s*=\s*PULT_ALIAS_STROEME\b", ts):
        f.append("ALLE_STROEME is a copy: it must be `= PULT_ALIAS_STROEME` imported from ./pult.ts")
    return liste(lies(wurzel, PULT_TS), "PULT_ALIAS_STROEME")


def pruefe(wurzel: Path) -> list:
    """All findings as strings; empty = green."""
    f = []
    ts = lies(wurzel, STROEME_TS)
    h = lies(wurzel, PULT_H)
    container = pult_pfade(h, "PULT_CONTAINER_PFAD")
    n_strom = pult_zahl(h, "PULT_STROEME")

    # 1. STROM_KANAL: alias path of the Strudel track per stream, never a pad entry, never a mixer index rule
    sk = objekt(ts, "STROM_KANAL")
    if sk != STROM_KANAL_ERWARTET:
        f.append(f"STROM_KANAL differs: {sk} != {STROM_KANAL_ERWARTET}")
    for s, k in sk.items():
        if str(k).startswith("pad/"):
            f.append(f"STROM_KANAL: stream {s} -> {k} is a pad entry")
        if k != f"erz/{s}":
            f.append(f"STROM_KANAL: stream {s} -> {k} is not erz/{s}")
        if not 1 <= s <= n_strom:
            f.append(f"STROM_KANAL: stream {s} is outside 1..{n_strom} (pult_table.h PULT_STROEME)")
    alle = alle_stroeme(wurzel, f)
    if alle != sorted(sk):
        f.append(f"ALLE_STROEME {alle} differs from the keys of STROM_KANAL {sorted(sk)}")
    for refused in (4, 8):
        if refused in alle:
            f.append(f"ALLE_STROEME contains the unused stream {refused}")

    # 2. INSTRUMENT_STROEME, BK_STROEME, STROM_MIDI_ZIEL
    inst = liste(ts, "INSTRUMENT_STROEME")
    if inst != [s for s in alle if s != 1]:
        f.append(f"INSTRUMENT_STROEME differs: {inst} (stream 1 is the drum kit and carries no graph)")
    bk = liste(ts, "BK_STROEME")
    if bk != [5, 6, 7, 9, 10]:
        f.append(f"BK_STROEME differs: {bk}")
    mz = objekt(ts, "STROM_MIDI_ZIEL")
    if sorted(mz) != sorted(bk):
        f.append(f"STROM_MIDI_ZIEL keys {sorted(mz)} != BK_STROEME {sorted(bk)}")
    for s, z in mz.items():
        mm = re.fullmatch(r"midi:([1-4]):([1-9]|1[0-6])", str(z))
        if not mm:
            f.append(f"STROM_MIDI_ZIEL[{s}] = {z!r} is not midi:<1..4>:<1..16>")
        if z in ("midi:1:1", "midi:2:1"):
            f.append(f"STROM_MIDI_ZIEL[{s}] = {z} collides with the studio's instrument targets")
    if len(set(mz.values())) != len(mz):
        f.append(f"STROM_MIDI_ZIEL has duplicate targets: {mz}")

    # 3. REC_EINGANG and INTERNE_EINGAENGE
    rec = objekt(ts, "REC_EINGANG")
    if rec != REC_ERWARTET:
        f.append(f"REC_EINGANG differs: {rec}")
    ie = liste(ts, "INTERNE_EINGAENGE")
    if ie != list(rec):
        f.append(f"INTERNE_EINGAENGE differs from the keys of REC_EINGANG: {ie}")
    for k, code in rec.items():
        if k.startswith("erz/"):
            s = int(k[4:])
            if code != 10 + s or s not in sk:
                f.append(f"REC_EINGANG[{k}] = {code} is not a stream buffer code 10 + stream of a known stream")
        elif k in container:
            erwartet = 21 + (container.index(k) - 2) % 4   # C, D, A, B = 21, 22, 23, 24
            if code != erwartet:
                f.append(f"REC_EINGANG[{k}] = {code}, container input code should be {erwartet}")
        else:
            f.append(f"REC_EINGANG key {k} is neither erz/<n> nor a container path of pult_table.h")
    if any(c in (14, 18) for c in rec.values()):
        f.append("REC_EINGANG uses a refused code (14 or 18)")
    if sorted(c for c in rec.values() if c >= 21) != [21, 22, 23, 24]:
        f.append("REC_EINGANG container codes are not exactly 21..24")
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


def test_strom_kanal_hat_keine_pad_eintraege():
    sk = objekt(lies(WURZEL, STROEME_TS), "STROM_KANAL")
    assert not [v for v in sk.values() if v.startswith("pad/")]
    assert sorted(sk) == alle_stroeme(WURZEL, [])
    assert all(v == f"erz/{k}" for k, v in sk.items())


def test_rec_eingang_deckt_container_eingaenge_und_strombuffer():
    ts = lies(WURZEL, STROEME_TS)
    rec = objekt(ts, "REC_EINGANG")
    assert rec == REC_ERWARTET
    assert liste(ts, "INTERNE_EINGAENGE") == list(rec)
    container = pult_pfade(lies(WURZEL, PULT_H), "PULT_CONTAINER_PFAD")
    assert all(k in container for k in rec if not k.startswith("erz/"))
    assert sorted(c for c in rec.values() if c >= 21) == [21, 22, 23, 24]
    assert 14 not in rec.values() and 18 not in rec.values()


def test_kanal_von_strom_und_zurueck():
    skript = (
        f"import {{kanalVonStrom, stromVonKanal, istBkStrom}} from {str(WURZEL / STROEME_TS)!r};"
        "console.log(JSON.stringify([kanalVonStrom(9), kanalVonStrom(4), stromVonKanal('erz/10'),"
        "stromVonKanal('pad/1'), stromVonKanal('erz/4'), istBkStrom(9), istBkStrom(3)]))"
    )
    r = subprocess.run(["node", "--input-type=module", "-e", skript], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == '["erz/9",null,10,null,null,true,false]'


def test_alle_stroeme_gleich_alias_stroeme_der_pult_json():
    """Runtime parity (container core V review I4): the stream list the page server reads equals pult.json alias_stroeme."""
    import json
    soll = json.loads((WURZEL / "djk/contract/pult.json").read_text(encoding="utf-8"))["alias_stroeme"]
    skript = f"import {{ALLE_STROEME}} from {str(WURZEL / STROEME_TS)!r}; console.log(JSON.stringify([...ALLE_STROEME]))"
    r = subprocess.run(["node", "--input-type=module", "-e", skript], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == soll


MUTATIONEN = [
    (STROEME_TS, "  9: 'erz/9',", "  9: 'pad/1',", "is a pad entry"),
    (PULT_TS, "PULT_ALIAS_STROEME = [1, 2, 3, 5, 6, 7, 9, 10]", "PULT_ALIAS_STROEME = [1, 2, 3, 5, 6, 7, 9]", "ALLE_STROEME"),
    (STROEME_TS, "export const ALLE_STROEME = PULT_ALIAS_STROEME;", "export const ALLE_STROEME = [1, 2, 3, 5, 6, 7, 9, 10] as const;",
     "is a copy"),
    (STROEME_TS, "'erz/6': 16,", "'erz/6': 14,", "REC_EINGANG"),
    (STROEME_TS, "'deck/2': 24,", "'deck/2': 25,", "REC_EINGANG"),
    (STROEME_TS, "10: 'midi:4:2'", "10: 'midi:4:1'", "duplicate targets"),
    (PULT_H, '{"deck/1", "deck/2", "pad/1", "pad/2"}', '{"deck/1", "deck/2", "pad/1", "pad/3"}', "pad/2"),
    (PULT_H, '{"deck/1", "deck/2", "pad/1", "pad/2"}', '{"deck/2", "deck/1", "pad/1", "pad/2"}', "container input code"),
    (PULT_H, "PULT_STROEME = 16", "PULT_STROEME = 8", "outside 1..8"),
]


@pytest.mark.parametrize("rel,alt,neu,meldung", MUTATIONEN, ids=[f"{i}-{m[3][:30]}" for i, m in enumerate(MUTATIONEN)])
def test_mutation_turns_red(kopie, rel, alt, neu, meldung):
    mutiere(kopie, rel, alt, neu)
    gefunden = pruefe(kopie)
    assert any(meldung in x for x in gefunden), gefunden
