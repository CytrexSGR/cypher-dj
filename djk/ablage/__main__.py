"""python3 -m ablage pfad <kind|fixed-name> | shell | envnamen"""
from __future__ import annotations

import shlex
import sys

from . import arten, fest, fest_env, fest_namen, ordner, orte


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 2 and argv[0] == "pfad":
            n = argv[1]
            print(ordner(n) if n in arten() else fest(n))
            return 0
        if argv == ["envnamen"]:   # every environment variable of a place a test instance keeps in its own folder, for djk-start's umgebung.env filter
            for n in sorted({z for z in [orte(a)["env"] for a in arten() if not orte(a)["kern"] or orte(a)["kern_env"]] + [fest_env(n) for n in fest_namen()] if z}):
                print(n)
            return 0
        if argv == ["shell"]:
            for a in arten():
                print(f"ABLAGE_{a.upper()}={shlex.quote(str(ordner(a)))}")
            for n in fest_namen():
                print(f"ABLAGE_{n.upper()}={shlex.quote(str(fest(n)))}")
            return 0
    except (ValueError, KeyError) as e:
        print(f"ablage: {e}", file=sys.stderr)
        return 2
    print("usage: python3 -m ablage pfad <kind|fixed-name> | shell | envnamen", file=sys.stderr)
    return 2


sys.exit(main(sys.argv[1:]))
