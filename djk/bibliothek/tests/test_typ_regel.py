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


@pytest.mark.parametrize("name,erwartet", [
    ("Abnahme Eins 128", 128), ("Artist - Song (128)", 128), ("Artist - Song [126]", 126), ("Song 124 BPM", 124),
    ("128 Song", None), ("Track 2019", None), ("Song 12", None), ("Song 200", None),
])
def test_bpm_aus_namen_lose_for_tracks(name, erwartet):
    """Kanban t_747a905b: a track named 'Artist - Song 128' carries its BPM at the end or in brackets."""
    assert bpm_aus_namen(name, lose=True) == erwartet


@pytest.mark.parametrize("name", ["Kick 90", "Vocal 120", "Song (128)"])
def test_the_strict_rule_is_unchanged(name):
    assert bpm_aus_namen(name) is None
