"""Selbsttest der Auswertung des Stems-Lastlaufs (AK26): erfundene Läufe, je Tor ein Fall und seine Positivkontrolle."""
import copy
import json
import tempfile
from pathlib import Path

import pytest

import stems_last_auswertung as s

KERN = {"schluss": {"cb_p999_us": 900}, "frame_luecken_fenster": 0, "grenzen": {"unterlauf_0": True, "frame_luecken_0": True}, "kontrollen": {"a": True}}
PWTOP = ("S   ID  QUANT   RATE    WAIT    BUSY   W/Q   B/Q  ERR  FORMAT  NAME\n"
         "C  194      0      0    ---     ---   ---   ---     0                  cypherdj-kern-a\n"
         "R  194    256  48000   4.3us 474.0us  0.00  0.09    0                   + cypherdj-kern-a\n"
         "R   50   1024  48000   9.0us  10.0us  0.00  0.01    0                   + anderer-knoten\n")
META = "name=x modus=mit instanz=a\n123:        self.proc[name] = subprocess.Popen([\"pw-jack\", \"-p\", \"256\", *args]\n"
STEMS_OK = '{"status": "ok", "frames": 5760000}\n' * 3


def kern(p999):
    k = copy.deepcopy(KERN)
    k["schluss"]["cb_p999_us"] = p999
    return k


def lauf(d, name, k, stems=None, pwtop=PWTOP, meta=META):
    o = Path(d) / name
    o.mkdir()
    (o / "ergebnis.json").write_text(json.dumps(k))
    (o / "pwtop.txt").write_text(pwtop)
    (o / "meta.txt").write_text(meta)
    if stems is not None:
        (o / "stems.jsonl").write_text(stems)
    return s.lade(o)


def urteil(d, ohne_p=(900, 930), mit=(1000, 1020), mit_kern=None, stems=STEMS_OK, ohne_kern=None, pwtop=PWTOP, meta=META):
    ohne = [lauf(d, f"o{i}", ohne_kern or kern(p), pwtop=pwtop, meta=meta) for i, p in enumerate(ohne_p)]
    m = [lauf(d, f"m{i}", mit_kern or kern(p), stems, pwtop=pwtop, meta=meta) for i, p in enumerate(mit)]
    return s.auswerten(ohne, m)


def test_gehalten():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d)
        assert r["urteil"] == "AK26 gehalten", r
        assert r["gerissen"] == []


def test_grenze_p999_plus_200_gilt_inklusive():
    with tempfile.TemporaryDirectory() as d:
        assert urteil(d, ohne_p=(900, 900), mit=(1100, 1100))["urteil"] == "AK26 gehalten"   # genau +200 µs
    with tempfile.TemporaryDirectory() as d:
        assert urteil(d, ohne_p=(900, 900), mit=(1101, 1101))["urteil"] == "AK26 gerissen: Callback-Schwanz zu hoch"


def test_p999_gerissen():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, mit=(1300, 1350))
        assert r["urteil"] == "AK26 gerissen: Callback-Schwanz zu hoch", r
        assert r["gerissen"] == ["T1_p999_zuwachs"]


def test_frame_luecken_gerissen():
    schlecht = kern(950)
    schlecht["frame_luecken_fenster"] = 2
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, mit_kern=schlecht)
        assert r["urteil"] == "AK26 gerissen: Kern-Grenzen gerissen", r
        assert r["gerissen"] == ["T2_kern_grenzen"]


@pytest.mark.parametrize("aenderung", [
    lambda k: k.update(frame_luecken_fenster=None),
    lambda k: k["grenzen"].update(unterlauf_0=False),
    lambda k: k.update(grenzen={}),
    lambda k: k["kontrollen"].update(a=False),
])
def test_t2_jede_bedingung_einzeln(aenderung):
    schlecht = kern(950)
    aenderung(schlecht)
    with tempfile.TemporaryDirectory() as d:
        assert not urteil(d, mit_kern=schlecht)["tore"]["T2_kern_grenzen"]["ok"]


def test_breite_grundlinie_ungueltig():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, ohne_p=(800, 1000))
        assert r["urteil"].startswith("Messung ungültig") and not r["tore"]["T6_spreizung"]["ok"], r


def test_kaputte_grundlinie_ungueltig():
    schlecht = kern(900)
    schlecht["frame_luecken_fenster"] = 1
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, ohne_kern=schlecht)
        assert r["urteil"].startswith("Messung ungültig") and not r["tore"]["T7_grundlinie_kern"]["ok"], r


@pytest.mark.parametrize("stems", [
    '{"status": "ok"}\n',                                                      # nur eine Zeile
    STEMS_OK + '{"status": "fehler", "grund": "x"}\n',                         # ein Fehler
    "",                                                                        # leer
    "kein json\n" * 5,                                                         # nichts lesbar
])
def test_last_nicht_belegt_ungueltig(stems):
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, stems=stems)
        assert r["urteil"].startswith("Messung ungültig") and not r["tore"]["T9_last"]["ok"], r


def test_quantum_128_ungueltig():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, pwtop=PWTOP.replace("  256  48000", "  128  48000"))
        assert r["urteil"].startswith("Messung ungültig") and not r["tore"]["T10_quantum"]["ok"], r


def test_quantum_eine_zeile_128_unter_vielen_reisst():
    with tempfile.TemporaryDirectory() as d:
        pw = PWTOP + "R  194    128  48000   4.3us 474.0us  0.00  0.09    0                   + cypherdj-kern-a\n"
        assert not urteil(d, pwtop=pw)["tore"]["T10_quantum"]["ok"]


def test_quantum_0_beim_anlauf_zaehlt_nicht():
    # S6 Task 14 (2026-10-31): pw-top zeigt den frischen Kern einmal als „R  0  0  0.0us“, bevor der Graph ihn treibt; alle drei
    # Grundlinien rissen T10 daran. Quantum 0 heißt nicht getrieben, nicht falsches Quantum. Nur 0 bleibt ungültig (Negativ-Kontrolle).
    anlauf = "R  194      0      0   0.0us   0.0us  ???   ???     0                  cypherdj-kern-a\n"
    with tempfile.TemporaryDirectory() as d:
        kopf, rest = PWTOP.split("\n", 1)
        assert urteil(d, pwtop=f"{kopf}\n{anlauf}{rest}")["tore"]["T10_quantum"]["ok"]
    with tempfile.TemporaryDirectory() as d:
        assert not urteil(d, pwtop=f"S   ID  QUANT\n{anlauf}")["tore"]["T10_quantum"]["ok"]


def test_keine_kernzeile_oder_kein_pwjack_ungueltig():
    with tempfile.TemporaryDirectory() as d:
        assert not urteil(d, pwtop="S ID QUANT\n")["tore"]["T10_quantum"]["ok"]
    with tempfile.TemporaryDirectory() as d:
        assert not urteil(d, meta="name=x\n")["tore"]["T10_quantum"]["ok"]


def test_ungueltig_schlaegt_gerissen():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, mit=(2000, 2000), stems="")
        assert r["urteil"].startswith("Messung ungültig"), r
        assert "T1_p999_zuwachs" in r["gerissen"]


def test_main_rueckgabe_und_ausgabe(tmp_path, capsys, monkeypatch):
    for n, p in (("o0", 900), ("o1", 920)):
        lauf(tmp_path, n, kern(p))
    for n, p in (("m0", 1000), ("m1", 1010)):
        lauf(tmp_path, n, kern(p), STEMS_OK)
    aus = tmp_path / "bericht.json"
    monkeypatch.setattr("sys.argv", ["x", "--ohne", str(tmp_path / "o0"), str(tmp_path / "o1"), "--mit", str(tmp_path / "m0"), str(tmp_path / "m1"),
                                      "--ausgabe", str(aus)])
    assert s.main() == 0
    assert json.loads(aus.read_text())["urteil"] == "AK26 gehalten"
    (tmp_path / "m0" / "stems.jsonl").write_text("")
    assert s.main() == 2


def test_pwjack_zeile_ohne_256_reisst():
    with tempfile.TemporaryDirectory() as d:
        assert not urteil(d, meta=META.replace('"256"', '"128"'))["tore"]["T10_quantum"]["ok"]


FREMD128 = "R  300    128  48000   4.3us 474.0us  0.00  0.09    0                   + cypherdj-kern-b\n"
FREMD256 = FREMD128.replace("   128  ", "   256  ")
EIGEN_WEG = "".join(z + "\n" for z in PWTOP.splitlines() if "cypherdj-kern-a" not in z)


def test_fremder_kern_bei_128_neben_eigenem_256_gilt():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, pwtop=PWTOP + FREMD128)
        assert r["urteil"] == "AK26 gehalten", r


def test_nur_fremder_kern_bei_256_ist_ungueltig():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, pwtop=EIGEN_WEG + FREMD256)
        assert r["urteil"].startswith("Messung ungültig") and not r["tore"]["T10_quantum"]["ok"], r


def test_knotenname_exakt_nicht_praefix():
    with tempfile.TemporaryDirectory() as d:
        pw = EIGEN_WEG + FREMD256.replace("cypherdj-kern-b", "cypherdj-kern-ab")   # Instanz a darf nicht ab treffen
        assert not urteil(d, pwtop=pw)["tore"]["T10_quantum"]["ok"]
    with tempfile.TemporaryDirectory() as d:
        pw = EIGEN_WEG + FREMD256.replace("cypherdj-kern-b", "cypherdj-kern")        # ohne Bindestrich-Instanz auch nicht
        assert not urteil(d, pwtop=pw)["tore"]["T10_quantum"]["ok"]


def test_ohne_instanz_in_meta_ungueltig():
    with tempfile.TemporaryDirectory() as d:
        assert not urteil(d, meta=META.replace("instanz=a", ""))["tore"]["T10_quantum"]["ok"]


def test_kurze_zeile_wirft_nicht():
    with tempfile.TemporaryDirectory() as d:
        assert urteil(d, pwtop=PWTOP + "cypherdj-kern-a\n")["urteil"] == "AK26 gehalten"


def test_median_nicht_min_und_nicht_nur_erster_lauf():
    with tempfile.TemporaryDirectory() as d:
        r = urteil(d, ohne_p=(900, 900), mit=(1000, 1300, 1350))   # Median +400 reißt; Minimum oder erster Lauf (+100) hielte
        assert r["urteil"] == "AK26 gerissen: Callback-Schwanz zu hoch", r


def test_nur_zweiter_mit_lauf_mit_frame_luecken_reisst_t2():
    schlecht = kern(1000)
    schlecht["frame_luecken_fenster"] = 3
    with tempfile.TemporaryDirectory() as d:
        ohne = [lauf(d, f"o{i}", kern(900)) for i in range(2)]
        mit = [lauf(d, "m0", kern(1000), STEMS_OK), lauf(d, "m1", schlecht, STEMS_OK)]
        assert s.auswerten(ohne, mit)["urteil"] == "AK26 gerissen: Kern-Grenzen gerissen"


def test_main_fehlendes_ergebnis_ist_ungueltig_2(tmp_path, monkeypatch, capsys):
    for n, p in (("o0", 900), ("o1", 920)):
        lauf(tmp_path, n, kern(p))
    lauf(tmp_path, "m0", kern(1000), STEMS_OK)
    (tmp_path / "m0" / "ergebnis.json").unlink()
    monkeypatch.setattr("sys.argv", ["x", "--ohne", str(tmp_path / "o0"), str(tmp_path / "o1"), "--mit", str(tmp_path / "m0")])
    assert s.main() == 2
    assert "Messung ungültig" in capsys.readouterr().out
