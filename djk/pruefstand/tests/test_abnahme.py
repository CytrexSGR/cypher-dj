"""Abnahme-Zusammenfassung an erfundenen Laufordnern: vollständig und erfüllt, dann je ein Fehlerfall (fehlender Lauf,
verfehlter Lauf, P1 außerhalb der Spanne)."""
import json

import abnahme

LAST = {"lastgen_kerne": 10.0, "demucs_kerne": 5.0, "lastgen_rss_mib": 1030.0, "lastgen_durchsatz_gib_s": 40.0,
        "demucs_runde_median_s": 7.0}


def lege_an(o, name, i, ergebnis="erfuellt", last=None, vorlaeufig=False):
    d = o / f"20260924-10{i:02d}00-{name}"
    d.mkdir()
    (d / "auswertung.json").write_text(json.dumps({"ergebnis": ergebnis, "vorlaeufig": vorlaeufig, "last": last}))


def alles(o, ohne=(), p1b=LAST, vorlaeufig=False):
    i = 0
    for name, n, _ in abnahme.REIHE:
        if name in ohne:
            continue
        for k in range(n):
            i += 1
            lege_an(o, name, i, last=(LAST if k == 0 else p1b) if name == "p1-kern" else None, vorlaeufig=vorlaeufig)


def test_vollstaendig_erfuellt(tmp_path):
    alles(tmp_path)
    text, ok = abnahme.zusammenfassen(tmp_path)
    assert ok and text.endswith("Gesamt: ERFÜLLT") and "reproduzierbar" in text


def test_fehlender_lauf(tmp_path):
    alles(tmp_path, ohne=("ruhe-kern",))
    text, ok = abnahme.zusammenfassen(tmp_path)
    assert not ok and "| ruhe-kern |" in text and "fehlt" in text


def test_verfehlter_lauf_zaehlt(tmp_path):
    alles(tmp_path)
    lege_an(tmp_path, "kill-kern", 99, ergebnis="verfehlt")          # jüngster von fünf verfehlt
    assert not abnahme.zusammenfassen(tmp_path)[1]


def test_p1_ausserhalb_der_spanne(tmp_path):
    alles(tmp_path, p1b=dict(LAST, lastgen_durchsatz_gib_s=30.0))     # 25 % weniger Durchsatz
    text, ok = abnahme.zusammenfassen(tmp_path)
    assert not ok and "NICHT belegt" in text


def test_aehnliche_namen_werden_nicht_vermischt(tmp_path):
    alles(tmp_path)
    lege_an(tmp_path, "luecke-ziel-null", 98, ergebnis="verfehlt")   # darf nicht als luecke-ziel zählen
    l = abnahme.laeufe_von(tmp_path, "luecke-ziel")
    assert all(d.name.endswith("-luecke-ziel") for d, _ in l) and len(l) == 1


def test_p1_ausserhalb_unter_fremdlast_ist_vorlaeufig(tmp_path):
    alles(tmp_path, p1b=dict(LAST, lastgen_durchsatz_gib_s=30.0), vorlaeufig=True)
    text, ok = abnahme.zusammenfassen(tmp_path)
    assert ok and "VORLÄUFIG (außerhalb" in text and text.endswith("Gesamt: ERFÜLLT, VORLÄUFIG")
