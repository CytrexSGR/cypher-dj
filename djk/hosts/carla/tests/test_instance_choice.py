"""instanz_wahl: the test instance of the insert and instrument tests is named by CYPHERDJ_TEST_INSTANZ or free, a busy one is a skip reason."""
import pytest

import instance_choice as w


def test_named_free_instance_is_taken_and_a_busy_one_gives_a_reason(monkeypatch):
    belegt = {"b"}
    monkeypatch.setattr(w, "_frei", lambda i: i not in belegt)
    monkeypatch.setenv("CYPHERDJ_TEST_INSTANZ", "d")
    assert w.waehle() == ("d", "")
    monkeypatch.setenv("CYPHERDJ_TEST_INSTANZ", "b")
    i, grund = w.waehle()
    assert i == "b" and "busy" in grund


def test_without_a_name_the_first_free_letter_is_taken_and_none_free_is_a_reason(monkeypatch):
    monkeypatch.delenv("CYPHERDJ_TEST_INSTANZ", raising=False)
    monkeypatch.setattr(w, "_frei", lambda i: i not in {"e", "d"})
    assert w.waehle() == ("c", "")
    monkeypatch.setattr(w, "_frei", lambda i: False)
    assert "no free test instance" in w.waehle()[1]


def test_a_bad_letter_is_refused(monkeypatch):
    monkeypatch.setenv("CYPHERDJ_TEST_INSTANZ", "z")
    with pytest.raises(ValueError):
        w.waehle()


def test_busy_skip_skips_instead_of_failing(monkeypatch):
    monkeypatch.setattr(w, "_frei", lambda i: False)
    with pytest.raises(pytest.skip.Exception):
        w.busy_skip()
