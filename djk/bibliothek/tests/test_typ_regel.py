import pytest

from bibliothek.typ_regel import bestimme, bpm_aus_namen


@pytest.mark.parametrize("rel,dauer,bpm,wtyp,erwartet", [
    ("Drums/Kick 01.wav", 0.4, None, "auto", "oneshot"),
    ("Loops/DT_126_Groove.wav", 3.81, 126, "auto", "loop"),
    ("Music/Artist - Song.mp3", 305, 128, "auto", "track"),
    ("Pack/Bass_124bpm_Am.wav", 7.74, 124, "auto", "loop"),
    ("Pack/Riser.wav", 2.2, None, "auto", "oneshot"),
    ("Loops/long loop 90.wav", 85.3, 90, "auto", "loop"),
    ("Hits/Crash.wav", 4.0, None, "auto", "oneshot"),
    ("x/Kick.wav", 0.4, None, "track", "track"),
    ("Loops/Pad.wav", 130, None, "auto", "track"),   # loop token needs dauer < 120
    ("Hits/Long.wav", 40, None, "auto", "oneshot"),  # hit token needs < 30, no bpm, < 60
])
def test_bestimme(rel, dauer, bpm, wtyp, erwartet):
    assert bestimme(rel, dauer, bpm, wtyp) == erwartet


@pytest.mark.parametrize("name,erwartet", [
    ("DT_126_Groove", 126), ("Bass 124bpm", 124), ("loop_95_bpm", 95),
    ("Track 2019", None), ("Kick 01", None),
])
def test_bpm_aus_namen(name, erwartet):
    assert bpm_aus_namen(name) == erwartet
