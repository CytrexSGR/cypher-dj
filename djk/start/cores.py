#!/usr/bin/env python3
"""Core allocation in ONE place (multi-core spec 2026-11-06): how many physical cores the kern process gets and what is left for the rest.

djk-start calls it at start. From the topology (<sysfs>/cpu<N>/topology/{core_id,physical_package_id}, online CPUs only, from <sysfs>/online):
kern CPUs = the first n physical cores (by lowest CPU number) with their SMT siblings, stems CPUs = all other online CPUs.
An explicit CYPHERDJ_KERN_CPUS (--kern-cpus) wins for the kern (stems = the other online CPUs), an explicit CYPHERDJ_STEMS_CPUS (--stems-cpus) for the stems.
A core count above the range is clamped (to cores - 1, at least 1) with a note on stderr; text that is not a number is an error.
The kern process inherits the mask (CPUAffinity of the unit); the Hall choice inside the kern (waehle_hall_cpus) works inside it, there is no second source.

Call: cores.py [--sysfs DIR] [--n 4] [--kern-cpus LIST] [--stems-cpus LIST]
Output (stdout, three lines): KERN_CPUS=<ranges, space separated, for CPUAffinity>  STEMS_CPUS=<ranges, comma separated>  KERN_KERNE=<n or ->
Errors: return code 2, message on stderr. Notes (clamping, overlap): stderr, return code 0."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

VORGABE_N = 4
SYSFS = "/sys/devices/system/cpu"


def liste_lesen(text: str) -> set[int]:
    """'0-3,8 9' -> {0,1,2,3,8,9}. Raises ValueError for anything else."""
    r: set[int] = set()
    for t in re.split(r"[,\s]+", text.strip()):
        if not t:
            continue
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", t)
        if not m:
            raise ValueError(f"not a CPU list: '{text}'")
        a, b = int(m.group(1)), int(m.group(2) or m.group(1))
        if b < a:
            raise ValueError(f"not a CPU list (range backwards): '{text}'")
        r.update(range(a, b + 1))
    return r


def bereiche(cpus: set[int], trenner: str) -> str:
    s = sorted(cpus)
    teile: list[str] = []
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[j] + 1:
            j += 1
        teile.append(str(s[i]) if i == j else f"{s[i]}-{s[j]}")
        i = j + 1
    return trenner.join(teile)


def online(sysfs: str) -> set[int]:
    root = Path(sysfs)
    try:
        return liste_lesen((root / "online").read_text())
    except (OSError, ValueError):
        return {int(p.name[3:]) for p in root.glob("cpu[0-9]*") if p.name[3:].isdigit()}


def physische_kerne(sysfs: str, aktiv: set[int]) -> list[list[int]]:
    """Groups of equal (package, core_id) among the online CPUs, ordered by lowest CPU; CPUs without readable topology are left out."""
    gruppen: dict[tuple[int, int], list[int]] = {}
    for c in sorted(aktiv):
        d = Path(sysfs) / f"cpu{c}" / "topology"
        try:
            kern = int((d / "core_id").read_text())
            paket = int((d / "physical_package_id").read_text())
        except (OSError, ValueError):
            continue
        gruppen.setdefault((paket, kern), []).append(c)
    return sorted(gruppen.values(), key=lambda g: g[0])


def plane(n: int, kern_cpus: str = "", stems_cpus: str = "", sysfs: str = SYSFS) -> tuple[set[int], set[int], int | None, list[str]]:
    """(kern CPUs, stems CPUs, n or None with explicit kern_cpus, notes). Raises ValueError with a readable message naming the variable."""
    notes: list[str] = []
    aktiv = online(sysfs)
    if not aktiv:
        raise ValueError(f"no online CPUs under {sysfs}")
    if kern_cpus.strip():
        try:
            kern = liste_lesen(kern_cpus)
        except ValueError as e:
            raise ValueError(f"CYPHERDJ_KERN_CPUS: {e}") from None
        if not kern <= aktiv:
            raise ValueError(f"CYPHERDJ_KERN_CPUS names CPUs that are not online: {bereiche(kern - aktiv, ',')}")
        n_aus = None
    else:
        kerne = physische_kerne(sysfs, aktiv)
        if len(kerne) < 2:
            raise ValueError(f"only {len(kerne)} physical core readable, the kern process and the stems need separate cores")
        gewollt = n
        n = max(1, min(n, len(kerne) - 1))
        if n != gewollt:
            notes.append(f"CYPHERDJ_KERN_KERNE = {gewollt} is outside 1 to {len(kerne) - 1} (physical cores of this machine: {len(kerne)}), using {n}")
        kern = {c for g in kerne[:n] for c in g}
        n_aus = n
    if stems_cpus.strip():
        try:
            stems = liste_lesen(stems_cpus)
        except ValueError as e:
            raise ValueError(f"CYPHERDJ_STEMS_CPUS: {e}") from None
        if not stems <= aktiv:
            raise ValueError(f"CYPHERDJ_STEMS_CPUS names CPUs that are not online: {bereiche(stems - aktiv, ',')}")
        if stems & kern:
            notes.append(f"CYPHERDJ_STEMS_CPUS overlaps the kern CPUs ({bereiche(stems & kern, ',')}): the stems share cores with the real-time kern")
    else:
        stems = aktiv - kern
    if not stems:
        raise ValueError("no CPU is left for the stems")
    return kern, stems, n_aus, notes


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sysfs", default=SYSFS)
    ap.add_argument("--n", default=str(VORGABE_N))
    ap.add_argument("--kern-cpus", default="")
    ap.add_argument("--stems-cpus", default="")
    a = ap.parse_args(argv)
    try:
        if not re.fullmatch(r"\d+", a.n):
            raise ValueError(f"CYPHERDJ_KERN_KERNE must be a whole number, is '{a.n}'")
        kern, stems, n, notes = plane(int(a.n), a.kern_cpus, a.stems_cpus, a.sysfs)
    except ValueError as e:
        print(f"djk-start: {e}. Nothing started.", file=sys.stderr)
        return 2
    for z in notes:
        print(f"djk-start: note: {z}", file=sys.stderr)
    print(f"KERN_CPUS={bereiche(kern, ' ')}")
    print(f"STEMS_CPUS={bereiche(stems, ',')}")
    print(f"KERN_KERNE={n if n is not None else '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
