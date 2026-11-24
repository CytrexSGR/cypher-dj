"""Test instance of the djk-insert and djk-instrumente tests (they create /dev/shm/cypherdj-<i> folders and refuse to touch a busy one).

CYPHERDJ_TEST_INSTANZ=a..i names the instance (same variable as the node tests). Without it the first letter whose folder does not
exist is taken, so a studio or another session on b, f, g, h never turns into a false failure. A named instance that is busy, or no
free letter at all, makes the tests SKIP with that reason (see `busy_skip`); nothing is ever deleted or reused.
"""
import os
from pathlib import Path

import pytest

_REIHE = "edcbaihgf"  # first choice e: the page tests use h (default), g and f


def _frei(i):
    return not Path(f"/dev/shm/cypherdj-{i}").exists()


def waehle():
    """-> (instance letter, reason or ''). The letter is returned even when busy so that module level names stay valid."""
    wunsch = os.environ.get("CYPHERDJ_TEST_INSTANZ", "")
    if wunsch:
        if wunsch not in list("abcdefghi"):
            raise ValueError(f"CYPHERDJ_TEST_INSTANZ must be a letter a to i, got {wunsch!r}")
        return wunsch, "" if _frei(wunsch) else f"test instance {wunsch} is busy (/dev/shm/cypherdj-{wunsch} exists)"
    for i in _REIHE:
        if _frei(i):
            return i, ""
    return _REIHE[0], "no free test instance a to i (every /dev/shm/cypherdj-<i> exists)"


INST, GRUND = waehle()


def busy_skip():
    """Call right before the test creates its folder: the instance may have been taken since import. Skips, never fails."""
    if not _frei(INST):
        pytest.skip(f"test instance {INST} is busy (/dev/shm/cypherdj-{INST} exists): set CYPHERDJ_TEST_INSTANZ to a free letter")
