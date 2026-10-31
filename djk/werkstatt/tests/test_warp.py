import numpy as np
import pytest
from werkstatt.karte import Karte
from werkstatt.warp import ausduennen, frames_je_beat, timemap


def test_frames_je_beat_128_exakt():
    assert frames_je_beat(128.0) == 22500.0


def test_timemap_starrer_134er_klick():
    """konst134 aus b_timemap: Schlaege ab 0,25 s, Periode 60/134. Quell-Beat 0 landet bei 0,25 s * 134/128."""
    s = 0.25 + np.arange(134) * 60.0 / 134.0
    tm = timemap(Karte(sekunden=s, beats=np.arange(134.0)), 128.0, 2904000)
    assert tm.erster_schlag_frame == 12562            # 0,25 / (60/134) * 22500 = 12562,5 -> gerade gerundet
    assert tm.ziel_frames == 3040125                  # 2 904 000 * 134/128
    d = np.diff(tm.ziel)
    assert np.all(d[:-1] == 45000) and d[-1] == 22500  # Anker je 2 Ziel-Beats, der letzte immer
    assert tm.quelle[0] == 12000 and tm.ziel[-1] == 12562 + 133 * 22500


def test_ausduennen_haelt_ersten_und_letzten():
    z = np.arange(0, 11) * 22500
    assert list(ausduennen(z, 45000 - 0.5)) == [0, 2, 4, 6, 8, 10]
    assert list(ausduennen(z[:10], 45000 - 0.5)) == [0, 2, 4, 6, 8, 9]


def test_timemap_doppeltempo_nimmt_jeden_eintrag():
    s = 0.2 + np.arange(20) * 60.0 / 90.0
    tm = timemap(Karte(sekunden=s, beats=2.0 * np.arange(20), vielfaches=2.0), 128.0, 48000 * 20)
    assert len(tm.quelle) == 20


def test_timemap_lehnt_fallende_karte_ab():
    with pytest.raises(ValueError):
        timemap(Karte(sekunden=np.array([1.0, 0.5, 2.0]), beats=np.arange(3.0)), 128.0, 480000)


# --- Karte reicht ueber das Dateiende (Mediathek d70e478cfbddd17f, 2026-10-11) ---------------------------------------
# Der letzte Schlag der Karte lag 315 Frames (6,6 ms) hinter dem letzten dekodierten Frame: beat_this setzt den letzten
# Schlag auf das 20-ms-Raster direkt ans Dateiende, die Glaettung schiebt ihn darueber. Das ist kein kaputtes Material.

def _karte_d70e():
    import json
    from pathlib import Path
    d = json.loads((Path(__file__).parent / "daten" / "karte_d70e478c.json").read_text())
    liste = np.array(d["tempo_karte_quelle"], dtype=float)
    return Karte(sekunden=liste[:, 0], beats=liste[:, 1], vielfaches=d["vielfaches"]), d["len_x_frames"]


def test_timemap_echte_karte_d70e_laeuft_durch():
    """Der Fehlerfall am echten Fall: Karte und Dateilaenge aus der Messung. Vorher ValueError."""
    karte, n = _karte_d70e()
    assert int(np.rint(karte.sekunden[-1] * 48000)) >= n            # die Karte reicht wirklich darueber
    tm = timemap(karte, 128.0, n)
    assert tm.quelle[-1] < n                                          # kein Anker hinter dem Dateiende
    assert tm.ziel_frames > tm.ziel[-1]
    assert np.all(np.diff(tm.quelle) > 0) and np.all(np.diff(tm.ziel) > 0)
    assert tm.erster_schlag_frame == timemap(karte, 128.0, n + 24000).erster_schlag_frame   # Raster-Anfang unberuehrt


def test_timemap_ueberstand_unter_einem_schlag_kuerzt_nur_den_schluss():
    """Synthetisch: nur der letzte Eintrag liegt 300 Frames hinter dem Ende. Die Anker davor bleiben bit-gleich zur
    Rechnung mit einer Dateilaenge, die den ganzen Schluss enthaelt."""
    s = 0.25 + np.arange(40) * 0.5
    k = Karte(sekunden=s, beats=np.arange(40.0))
    letzter = int(np.rint(s[-1] * 48000))
    lang = timemap(k, 128.0, letzter + 24000)                       # Datei reicht weit ueber den letzten Eintrag
    kurz = timemap(k, 128.0, letzter - 300)                         # letzter Eintrag 300 Frames hinter dem Ende
    assert kurz.quelle[-1] < letzter - 300
    n = len(kurz.quelle) - 1
    assert list(kurz.quelle[:n]) == list(lang.quelle[:n]) and list(kurz.ziel[:n]) == list(lang.ziel[:n])
    assert kurz.erster_schlag_frame == lang.erster_schlag_frame


def test_timemap_karte_knapp_innerhalb_aendert_sich_nicht():
    """Negativkontrolle: letzter Eintrag 1 Frame vor dem Ende: kein Anker faellt weg, Ergebnis wie bisher."""
    s = 0.25 + np.arange(40) * 0.5
    k = Karte(sekunden=s, beats=np.arange(40.0))
    letzter = int(np.rint(s[-1] * 48000))
    tm = timemap(k, 128.0, letzter + 1)
    assert tm.quelle[-1] == letzter                                   # der letzte Eintrag bleibt Anker
    assert tm.ziel_frames == int(tm.ziel[-1] + round(1 / (0.5 * 48000) * 22500))


def test_timemap_ueberstand_grenze_9ms_laeuft_60ms_nicht():
    """Toleranz 50 ms: 9 ms (432 Frames, gemessener Hoechstwert Stichprobe) laufen durch, 60 ms (2880) nicht."""
    s = 0.25 + np.arange(40) * 0.5
    k = Karte(sekunden=s, beats=np.arange(40.0))
    letzter = int(np.rint(s[-1] * 48000))
    tm = timemap(k, 128.0, letzter - 432 + 1)                       # Eintrag 432 Frames hinter dem letzten Frame
    assert tm.quelle[-1] < letzter - 432 + 1
    with pytest.raises(ValueError, match="Dateiende"):
        timemap(k, 128.0, letzter - 2880 + 1)
    with pytest.raises(ValueError, match="Dateiende"):
        timemap(k, 128.0, letzter - 2400)                           # Ueberstand genau 2400 Frames = 50 ms: zu weit


def test_timemap_karte_weit_ueber_dem_ende_bleibt_fehler():
    """Negativkontrolle: eine Karte, die einen ganzen Schlag und mehr hinter dem Ende liegt, ist falsches Material oder
    eine falsche Laenge: weiter ValueError."""
    s = 0.25 + np.arange(40) * 0.5
    k = Karte(sekunden=s, beats=np.arange(40.0))
    letzter = int(np.rint(s[-1] * 48000))
    with pytest.raises(ValueError, match="Dateiende"):
        timemap(k, 128.0, letzter - 24000 - 1)                      # letzter Eintrag > 1 Schlag (24000 Frames) dahinter
    with pytest.raises(ValueError, match="Dateiende"):
        timemap(k, 128.0, letzter - 10 * 48000)                     # 10 s dahinter


def _klickspur(s0, bpm, n, sr=48000):
    t = np.arange(int(0.004 * sr)) / sr
    k = np.sin(2 * np.pi * 3000 * t) * np.exp(-t / 0.001) * 0.5
    x = np.zeros((int((s0 + n * 60.0 / bpm + 1) * sr), 2))
    for b in range(n):
        a = int(round((s0 + b * 60.0 / bpm) * sr))
        x[a:a + len(k)] += k[:, None]
    return x


def test_schreibe_timemap_laesst_den_anker_null_null_weg(tmp_path):
    """Ein Anker (0, 0) verschiebt rubberband -3 --timemap die ganze Ausgabe (2026-10-29, Queen of Pain: erster Schlag auf 0
    geklemmt, Kick im Deck 20 ms vor dem Raster). Der Anfang ist ohnehin 0 -> 0; alle anderen Anker bleiben."""
    from werkstatt.warp import Timemap, schreibe_timemap
    p = tmp_path / "t.txt"
    schreibe_timemap(Timemap(quelle=np.array([0, 44308, 88615]), ziel=np.array([0, 45000, 90000]), erster_schlag_frame=0, ziel_frames=90000), p)
    assert p.read_text().split("\n")[:2] == ["44308 45000", "88615 90000"]
    schreibe_timemap(Timemap(quelle=np.array([5, 44308]), ziel=np.array([0, 45000]), erster_schlag_frame=0, ziel_frames=45000), p)
    assert p.read_text().startswith("5 0\n")   # nur genau (0, 0) fällt weg


@pytest.mark.skipif(not __import__("shutil").which("rubberband"), reason="rubberband fehlt")
@pytest.mark.parametrize("s0,bpm", [(0.0, 130.0), (0.0, 124.0), (0.227, 130.0)])
def test_warp_klicks_auf_dem_raster_auch_mit_erstem_schlag_auf_null(tmp_path, s0, bpm):
    """Wahrheit: Klick je Schlag. Nach dem Warp auf 128 liegt jeder Klick ±2 ms auf dem Raster, auch wenn der erste Schlag
    auf Frame 0 liegt (vorher: Median −15,3 ms bei 130, +31,1 ms bei 124)."""
    import soundfile as sf
    from werkstatt.warp import warp
    n, sr = 120, 48000
    x = _klickspur(s0, bpm, n)
    sf.write(tmp_path / "e.wav", x.astype(np.float32), sr, subtype="FLOAT")
    tm = timemap(Karte(sekunden=s0 + np.arange(n) * 60.0 / bpm, beats=np.arange(float(n))), 128.0, len(x))
    warp(tmp_path / "e.wav", tmp_path / "a.wav", tm)
    y = np.abs(sf.read(tmp_path / "a.wav")[0].mean(axis=1))
    r = []
    for b in range(n - 2):
        c = int(tm.erster_schlag_frame + b * frames_je_beat(128.0))
        lo = max(0, c - 2400)
        seg = y[lo:c + 2400]
        r.append((lo + int(np.argmax(seg > 0.2 * seg.max())) - c) / sr * 1000)
    assert abs(np.median(r)) <= 2.0 and np.max(np.abs(r)) <= 3.0, (np.median(r), min(r), max(r))


@pytest.mark.skipif(not __import__("shutil").which("rubberband"), reason="rubberband fehlt")
def test_vorlauf_traegt_ersten_schlag_vor_dem_dateianfang(tmp_path):
    """580de55457b9bbba (2026-10-30): erster Schlag 14 ms vor dem Dateianfang, auf 0 geklemmt; die Phasenkorrektur um
    −9,2 ms legt quell_beat 0 vor den Anfang, timemap lehnt ab. Mit Vorlauf (Stille davor) läuft es, und jeder Klick liegt
    ±2 ms auf dem Raster."""
    import soundfile as sf
    from werkstatt.warp import karte_mit_vorlauf, vorlauf_frames, warp
    n, sr, bpm, s0 = 120, 48000, 125.0, -0.009
    x = _klickspur(0.2, bpm, n)[int(round((0.2 - s0) * sr)):]     # Klick b bei s0 + b * Periode, Schlag 0 abgeschnitten
    k = Karte(sekunden=s0 + np.arange(n) * 60.0 / bpm, beats=np.arange(float(n)))
    with pytest.raises(ValueError, match="Dateianfang"):
        timemap(k, 128.0, len(x))
    v = vorlauf_frames(k)
    assert v == int(np.ceil(-s0 * sr))
    k2 = karte_mit_vorlauf(k, v)
    x2 = np.concatenate([np.zeros((v, 2)), x])
    sf.write(tmp_path / "e.wav", x2.astype(np.float32), sr, subtype="FLOAT")
    tm = timemap(k2, 128.0, len(x2))
    warp(tmp_path / "e.wav", tmp_path / "a.wav", tm)
    y = np.abs(sf.read(tmp_path / "a.wav")[0].mean(axis=1))
    r = []
    for b in range(1, n - 2):
        c = int(tm.erster_schlag_frame + b * frames_je_beat(128.0))
        lo = max(0, c - 2400)
        seg = y[lo:c + 2400]
        r.append((lo + int(np.argmax(seg > 0.2 * seg.max())) - c) / sr * 1000)
    assert abs(np.median(r)) <= 2.0 and np.max(np.abs(r)) <= 3.0, (np.median(r), min(r), max(r))


def test_vorlauf_null_wenn_schlag_null_im_signal():
    """Negativkontrolle: quell_beat 0 bei 0 oder danach braucht keinen Vorlauf, die Karte bleibt dieselbe."""
    from werkstatt.warp import karte_mit_vorlauf, vorlauf_frames
    for s0 in (0.0, 0.227):
        k = Karte(sekunden=s0 + np.arange(8) * 0.48, beats=np.arange(8.0))
        assert vorlauf_frames(k) == 0 and karte_mit_vorlauf(k, 0) is k
