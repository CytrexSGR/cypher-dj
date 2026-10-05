"""Lastprofil P1 ohne Last: Zusammenfassung aus erfundenen Sekundenproben und Logzeilen, Vergleich zweier Läufe.
Das Urteil „P1 hat gelastet“ prüft tests/test_auswertung.py."""
from last.p1 import LastP1, vergleiche


def test_zusammenfassung_aus_proben_und_logs(tmp_path):
    (tmp_path / "lastgen.log").write_text("lastgen faeden 16 mib 64 sekunden 70.0 durchsatz_gib_s 41.50\n")
    (tmp_path / "demucs.log").write_text("runde 1 7.10 s\nrunde 2 6.90 s\nrunde 3 7.30 s\nfertig 3\n")
    l = LastP1(tmp_path, "lastgen")
    l.proben = [{"t_s": float(s), "cpu_belegt_pct": 90.0, "lastgen_kerne": 10.0 if s >= 10 else 1.0,
                 "demucs_kerne": 5.0, "lastgen_rss_mib": 1030.0, "demucs_rss_mib": 900.0,
                 "mem_verfuegbar_mib": 20000.0 - s, "last1": 20.0 + s / 10} for s in range(1, 31)]
    z = l.zusammenfassung()
    assert z["proben"] == 21 and z["lastgen_kerne"] == 10.0 and z["demucs_kerne"] == 5.0
    assert z["lastgen_durchsatz_gib_s"] == 41.5 and z["demucs_runden"] == 3 and z["demucs_runde_median_s"] == 7.1
    assert z["mem_verfuegbar_mib_min"] == 19970.0 and z["last1_max"] == 23.0


def test_vergleiche_relativ():
    a = {"lastgen_kerne": 10.0, "demucs_kerne": 5.0, "lastgen_rss_mib": 1000.0, "lastgen_durchsatz_gib_s": 40.0,
         "demucs_runde_median_s": 7.0}
    b = dict(a, lastgen_durchsatz_gib_s=30.0, demucs_kerne=None)
    v = vergleiche(a, b)
    assert v["lastgen_kerne"] == 0.0 and v["lastgen_durchsatz_gib_s"] == 0.25 and v["demucs_kerne"] is None
