#!/usr/bin/env python3
"""changelog_abschnitt.py CHANGELOG.md VERSION: prints the section ("## ..." up to the next one) whose heading names exactly the version.

The version of a heading is its first version token (X.Y.Z or X.Y.Z-suffix); 0.4.0~rc1 and 0.4.0-rc1 are the same. The match is exact:
a pre-release section (1.0.0-rc1) is not the section of 1.0.0 and the other way round, and a version named later in the heading
("1.1.0, replaces 1.0.0") does not count. Exit 1 and nothing on stdout when no section has that version.
"""
import re
import sys


TOKEN = re.compile(r"(?<![\d.])\d+\.\d+\.\d+(?:[-~][0-9A-Za-z.]*[0-9A-Za-z])?(?!\.?\d)")


def abschnitt(text: str, version: str):
    ziel = version.replace("~", "-")
    for t in re.split(r"(?m)^(?=## )", text)[1:]:
        m = TOKEN.search(t.splitlines()[0])
        if m and m.group(0).replace("~", "-") == ziel:
            return t.strip()
    return None


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    a = abschnitt(open(sys.argv[1], encoding="utf-8").read(), sys.argv[2])
    if a is None:
        print(f"changelog_abschnitt: no section of {sys.argv[1]} names version {sys.argv[2]}", file=sys.stderr)
        sys.exit(1)
    print(a)
