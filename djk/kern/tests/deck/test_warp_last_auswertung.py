"""Selbsttest der Auswertung der Messprobe Arbeitsfaden-Last: erfundene Läufe, ein Fall je Tor und seine Positivkontrolle."""
import copy
import json
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

import warp_last_auswertung as w

KERN = {"schluss": {"cb_p999_us": 900}, "frame_luecken_fenster": 0, "grenzen": {"unterlauf_0": True, "frame_luecken_0": True}, "kontrollen": {"a": True}}
WERK = {"prio": 60, "prio_fehler": 0, "unterlauf": 0, "reserve_min_frames": 7000, "sturm_ms": [15.0, 19.0], "cpu_kerne": 0.34, "mib_je_stimme": 0.7,
        "korn_p50_us": 96, "korn_p99_us": 163, "korn_p999_us": 378, "korn_max_us": 610}


def lauf(d, name, kern, werk=None):
    o = Path(d) / name
    o.mkdir()
    (o / "ergebnis.json").write_text(json.dumps(kern))
    if werk is not None:
        (o / "werk.json").write_text(json.dumps(werk))
    return str(o)


def kern(p999):
    k = copy.deepcopy(KERN)
    k["schluss"]["cb_p999_us"] = p999
    return k


INSTRUMENT = {"prio": 60, "prio_fehler": 0, "unterlauf": 1000}
OHNE_VARIANTEN = {n: [] for n in ("fein", "zwei", "halb")}


def urteil(d, ohne_p=(900, 930), mit_p=(960, 980), werk=None, instrument=1000, ohne_kern=None, instrument_roh=None):
    ohne = [lauf(d, f"o{i}", ohne_kern or kern(p)) for i, p in enumerate(ohne_p)]
    mit = [lauf(d, f"m{i}", kern(p), werk or WERK) for i, p in enumerate(mit_p)]
    return w.auswerten(w.gruppe("o", ohne), w.gruppe("m", mit), OHNE_VARIANTEN, instrument_roh or {**INSTRUMENT, "unterlauf": instrument})


def test_alles_gut():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d)
        assert r["urteil"].startswith("S2 wie geplant"), r
        assert all(v["ok"] for k, v in r["tore"].items() if k.startswith("T"))


def test_callback_schwanz_zu_hoch():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, mit_p=(1200, 1250))
        assert not r["tore"]["T1_p999_zuwachs"]["ok"] and r["urteil"].startswith("Callback-Schwanz zu hoch")


def test_werk_unterlauf_und_sturm():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, werk={**WERK, "unterlauf": 3})
        assert not r["tore"]["T3_werk_unterlauf"]["ok"] and "mehr Vorlauf" in r["urteil"]
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, werk={**WERK, "sturm_ms": [15.0, 80.0]})
        assert not r["tore"]["T4_sturm"]["ok"] and "mehr Vorlauf" in r["urteil"]
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, werk={**WERK, "sturm_ms": [-1.0]})
        assert not r["tore"]["T4_sturm"]["ok"], "-1 = nach 1 s nicht fertig"


def test_blindes_instrument_und_breite_grundlinie_machen_die_messung_ungueltig():
    with tempfile.TemporaryDirectory() as d:
        assert urteil(d, instrument=0)["urteil"].startswith("Messung ungültig")
    with tempfile.TemporaryDirectory() as d:
        assert urteil(d, ohne_p=(800, 1000))["urteil"].startswith("Messung ungültig")


def test_kern_grenze_gerissen():
    with tempfile.TemporaryDirectory() as d:
        ohne = [lauf(d, f"o{i}", kern(900)) for i in range(2)]
        schlecht = kern(950)
        schlecht["frame_luecken_fenster"] = 2
        mit = [lauf(d, "m0", schlecht, WERK), lauf(d, "m1", kern(950), WERK)]
        r = w.auswerten(w.gruppe("o", ohne), w.gruppe("m", mit), OHNE_VARIANTEN, {**INSTRUMENT, "unterlauf": 5})
        assert not r["tore"]["T2_kern_grenzen"]["ok"]


def test_varianten_werden_genannt_wenn_nur_der_schwanz_reisst():
    with tempfile.TemporaryDirectory() as d:
        ohne = [lauf(d, f"o{i}", kern(900)) for i in range(2)]
        mit = [lauf(d, f"m{i}", kern(1300), WERK) for i in range(2)]
        fein = [lauf(d, "f0", kern(980), WERK)]
        halb = [lauf(d, "h0", kern(1250), WERK)]
        r = w.auswerten(w.gruppe("o", ohne), w.gruppe("m", mit), {"fein": w.gruppe("f", fein), "zwei": [], "halb": w.gruppe("h", halb)}, {**INSTRUMENT, "unterlauf": 9})
        assert r["urteil"] == "Callback-Schwanz zu hoch: halten fein", r["urteil"]


# --- Review-Nachzug Task 16 (Runde 1) ---------------------------------------------------------------------------------------------------------

def mit_kern(mit_kern_json, p=950, werk=None, **vorgabe):
    """Auswertung mit zwei gleichen `mit`-Läufen aus mit_kern_json und gültiger Grundlinie."""
    with tempfile.TemporaryDirectory() as d:
        ohne = [lauf(d, f"o{i}", kern(900)) for i in range(2)]
        mit = [lauf(d, f"m{i}", mit_kern_json, werk or WERK) for i in range(2)]
        return w.auswerten(w.gruppe("o", ohne), w.gruppe("m", mit), vorgabe.get("andere", OHNE_VARIANTEN), INSTRUMENT)


def test_nur_t2_gerissen_ist_ein_eigenes_urteil_kein_callback_schwanz():
    # Befund 1: T1 hält (p99,9 +50 µs), nur die Kern-Grenze reißt. Das Urteil darf den Schwanz nicht beschuldigen.
    schlecht = kern(950)
    schlecht["frame_luecken_fenster"] = 2
    r = mit_kern(schlecht)
    assert r["tore"]["T1_p999_zuwachs"]["ok"] and not r["tore"]["T2_kern_grenzen"]["ok"]
    assert r["urteil"] == "Kern-Grenzen gerissen: halten nur keine der Varianten fein/zwei/halb", r["urteil"]
    assert "Callback-Schwanz" not in r["urteil"]
    assert r["gerissen"] == ["T2_kern_grenzen"]


def test_t1_und_t2_gerissen_nennt_beides():
    schlecht = kern(1300)
    schlecht["frame_luecken_fenster"] = 2
    r = mit_kern(schlecht)
    assert r["urteil"] == "Callback-Schwanz zu hoch und Kern-Grenzen gerissen: halten nur keine der Varianten fein/zwei/halb", r["urteil"]
    assert r["gerissen"] == ["T1_p999_zuwachs", "T2_kern_grenzen"]


def test_nur_t1_gerissen_bleibt_callback_schwanz():
    r = mit_kern(kern(1300))
    assert r["urteil"] == "Callback-Schwanz zu hoch: halten nur keine der Varianten fein/zwei/halb", r["urteil"]
    assert r["gerissen"] == ["T1_p999_zuwachs"]


def test_alle_gerissenen_tore_stehen_im_ergebnis():
    r = mit_kern(kern(950), werk={**WERK, "unterlauf": 3})
    assert r["gerissen"] == ["T3_werk_unterlauf"]


@pytest.mark.parametrize("aenderung", [
    lambda k: k.update(frame_luecken_fenster=2),
    lambda k: k.update(frame_luecken_fenster=None),
    lambda k: k["grenzen"].update(unterlauf_0=False),
    lambda k: k.update(grenzen={}),
    lambda k: k["kontrollen"].update(a=False),   # Befund 4: die Kontrollen von ziel_lauf_boxen.py zählen für T2
])
def test_t2_jede_bedingung_einzeln(aenderung):
    schlecht = kern(950)
    aenderung(schlecht)
    r = mit_kern(schlecht)
    assert not r["tore"]["T2_kern_grenzen"]["ok"], r["tore"]["T2_kern_grenzen"]


def test_t2_positivkontrolle_gutes_kern_json():
    assert mit_kern(kern(950))["tore"]["T2_kern_grenzen"]["ok"]


def varianten_urteil(fein_kern=None, fein_werk=None, fein_p=980, zwei=None):
    """`mit` reißt T1 (p99,9 +400 µs); fein bekommt die übergebene Kern- und Werk-Zeile."""
    with tempfile.TemporaryDirectory() as d:
        ohne = [lauf(d, f"o{i}", kern(900)) for i in range(2)]
        mit = [lauf(d, f"m{i}", kern(1300), WERK) for i in range(2)]
        fk = fein_kern or kern(fein_p)
        fein = [lauf(d, "f0", fk, fein_werk or WERK)]
        andere = {"fein": w.gruppe("f", fein), "zwei": w.gruppe("z", zwei or []), "halb": []}
        return w.auswerten(w.gruppe("o", ohne), w.gruppe("m", mit), andere, INSTRUMENT)


def test_variante_haelt_nur_wenn_alle_tore_halten():
    # Befund 2, Fall B der Prüfung: fein hält den p99,9, reißt aber Werk-Unterläufe, Sturm und Frame-Lücken
    assert varianten_urteil()["urteil"] == "Callback-Schwanz zu hoch: halten fein"   # Positivkontrolle: alle Tore der Variante halten
    assert varianten_urteil(fein_werk={**WERK, "unterlauf": 500})["urteil"].endswith("nur keine der Varianten fein/zwei/halb")
    assert varianten_urteil(fein_werk={**WERK, "sturm_ms": [-1.0]})["urteil"].endswith("nur keine der Varianten fein/zwei/halb")
    assert varianten_urteil(fein_werk={**WERK, "sturm_ms": [80.0]})["urteil"].endswith("nur keine der Varianten fein/zwei/halb")
    schlecht = kern(980)
    schlecht["frame_luecken_fenster"] = 7
    assert varianten_urteil(fein_kern=schlecht)["urteil"].endswith("nur keine der Varianten fein/zwei/halb")
    r = varianten_urteil(fein_kern=schlecht, fein_werk={**WERK, "unterlauf": 500, "sturm_ms": [-1.0]})
    assert "halten fein" not in r["urteil"]


def test_variante_zwei_haelt_und_fein_nicht():
    with tempfile.TemporaryDirectory() as d:
        zwei = [lauf(d, "z0", kern(990), WERK)]
        r = varianten_urteil(fein_werk={**WERK, "unterlauf": 1}, zwei=zwei)
        assert r["urteil"] == "Callback-Schwanz zu hoch: halten zwei", r["urteil"]


def test_kaputte_grundlinie_macht_die_messung_ungueltig():
    # Befund 3: die `ohne`-Läufe sind die Bezugsgröße; reißen sie selbst eine Kern-Grenze, ist nichts zu werten
    schlecht = kern(900)
    schlecht["grenzen"]["unterlauf_0"] = False
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, ohne_kern=schlecht)
        assert r["urteil"].startswith("Messung ungültig"), r["urteil"]
        assert not r["tore"]["T7_grundlinie_kern"]["ok"]
    with tempfile.TemporaryDirectory() as d:
        assert urteil(d)["tore"]["T7_grundlinie_kern"]["ok"]   # Positivkontrolle


def test_werk_prio_nicht_gesetzt_macht_die_messung_ungueltig():
    # Befund 5: SCHED_FIFO nicht gesetzt (z. B. fehlende Rechte) -> die Werk-Fäden liefen unter SCHED_OTHER, der Lauf misst etwas anderes
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, werk={**WERK, "prio_fehler": 2})
        assert r["urteil"].startswith("Messung ungültig") and not r["tore"]["T8_prio"]["ok"], r["urteil"]
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, instrument_roh={**INSTRUMENT, "prio_fehler": 1})
        assert r["urteil"].startswith("Messung ungültig") and not r["tore"]["T8_prio"]["ok"], r["urteil"]
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, werk={**WERK, "prio": 0})   # nie angefordert: auch ungültig
        assert not r["tore"]["T8_prio"]["ok"]
    with tempfile.TemporaryDirectory() as d:
        alt = {k: v for k, v in WERK.items() if k not in ("prio", "prio_fehler")}   # Programmstand ohne die Meldung
        assert not urteil(d, werk=alt)["tore"]["T8_prio"]["ok"]
    with tempfile.TemporaryDirectory() as d:
        ohne_meldung = {k: v for k, v in WERK.items() if k != "prio_fehler"}   # prio angefordert, aber kein Wort, ob es gesetzt wurde
        assert not urteil(d, werk=ohne_meldung)["tore"]["T8_prio"]["ok"]
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d)
        assert r["tore"]["T8_prio"]["ok"] and r["urteil"].startswith("S2 wie geplant")   # Positivkontrolle


def test_variante_mit_prio_fehler_macht_die_messung_ungueltig():
    r = varianten_urteil(fein_werk={**WERK, "prio_fehler": 1})
    assert r["urteil"].startswith("Messung ungültig"), r["urteil"]


# --- Lauf-Skript: Aufrufargumente, Rückgabe 4 (Befund 6) ----------------------------------------------------------------------------------------

SKRIPT = Path(__file__).with_name("warp_last_lauf.sh")


def skript(*args, **env):
    e = {k: v for k, v in os.environ.items() if k != "CYPHERDJ_INSTANZ"}
    e.update(env)
    return subprocess.run(["bash", str(SKRIPT), *args], env=e, capture_output=True, text=True, timeout=30)


@pytest.mark.parametrize("args,env", [
    ((), {"CYPHERDJ_INSTANZ": "a"}),                  # Name fehlt
    (("x",), {"CYPHERDJ_INSTANZ": "a"}),              # Modus fehlt
    (("x", "mit"), {}),                               # Instanz fehlt
    (("x", "mit"), {"CYPHERDJ_INSTANZ": "g"}),        # tabu
    (("x", "mit"), {"CYPHERDJ_INSTANZ": "h"}),
    (("x", "mit"), {"CYPHERDJ_INSTANZ": "i"}),
    (("x", "unsinn"), {"CYPHERDJ_INSTANZ": "a"}),     # Modus unbekannt
])
def test_skript_aufruffehler_enden_mit_4(args, env):
    r = skript(*args, **env)
    assert r.returncode == 4, (r.returncode, r.stderr)
