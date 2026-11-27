# A test instance (CYPHERDJ_INSTANZ=a..i) must not open the ALSA sequencer, because every client of the bridge family would take real controllers
# (APC20, Launch Control 3, Launchpad) away from the production instance. Opt-in: CYPHERDJ_ECHTE_GERAETE=1. The libasound handle is replaced by a
# recorder, so these tests never talk to ALSA.
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import alsa_seq  # noqa: E402


@pytest.fixture
def lib(monkeypatch):
    m = MagicMock()
    m.snd_seq_open.return_value = 0
    m.snd_seq_client_id.return_value = 128
    monkeypatch.setattr(alsa_seq, "_lib", m)
    return m


@pytest.fixture(autouse=True)
def sauber(monkeypatch):
    monkeypatch.delenv("CYPHERDJ_INSTANZ", raising=False)
    monkeypatch.delenv("CYPHERDJ_ECHTE_GERAETE", raising=False)


def test_the_production_instance_opens_the_sequencer_as_before(lib):
    c = alsa_seq.Client("cypherdj-pult")
    assert lib.snd_seq_open.call_count == 1
    assert c.id == 128


def test_a_test_instance_opens_nothing(lib, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_INSTANZ", "e")
    with pytest.raises(alsa_seq.GeraeteGesperrt) as e:
        alsa_seq.Client("cypherdj-pult")
    assert "CYPHERDJ_ECHTE_GERAETE=1" in str(e.value)
    assert lib.snd_seq_open.call_count == 0, "the sequencer was opened although the instance has no right to real devices"


@pytest.mark.parametrize("wert", ["", "0", "yes", "true"])
def test_only_the_value_1_opts_in(lib, monkeypatch, wert):
    monkeypatch.setenv("CYPHERDJ_INSTANZ", "e")
    monkeypatch.setenv("CYPHERDJ_ECHTE_GERAETE", wert)
    with pytest.raises(alsa_seq.GeraeteGesperrt):
        alsa_seq.Client("x")
    assert lib.snd_seq_open.call_count == 0


def test_a_test_instance_with_the_opt_in_opens_the_sequencer(lib, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_INSTANZ", "e")
    monkeypatch.setenv("CYPHERDJ_ECHTE_GERAETE", "1")
    alsa_seq.Client("cypherdj-pult")
    assert lib.snd_seq_open.call_count == 1


def test_an_empty_instance_variable_is_the_production_instance(lib, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_INSTANZ", "")
    alsa_seq.Client("cypherdj-pult")
    assert lib.snd_seq_open.call_count == 1


def test_the_desk_bridge_of_a_test_instance_exits_before_it_writes_or_opens_anything(lib, monkeypatch):
    import assignment as belegung
    import pult_bridge as pult_bruecke
    monkeypatch.setenv("CYPHERDJ_INSTANZ", "e")
    monkeypatch.setattr(sys, "argv", ["pult_bridge.py"])
    monkeypatch.setattr(belegung, "schreibe", lambda *_: pytest.fail("bruecke.json was written by a test instance"))
    with pytest.raises(SystemExit) as e:
        pult_bruecke.main()
    assert e.value.code == 3
    assert lib.snd_seq_open.call_count == 0
