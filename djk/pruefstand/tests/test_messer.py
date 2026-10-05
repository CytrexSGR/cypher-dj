"""Messer gegen synthetische Signale mit bekannter Wahrheit: je Messer der Fehlerfall (muss treffen) und die
Negativ-Kontrolle (darf nicht treffen)."""
import numpy as np

import messer

SR = 48000
SPB = 22500.0          # Samples je Beat bei 128 BPM
TAKT = 90000           # 4 Schläge; 220 Hz haben darin 412,5 Schwingungen: jede harte Naht springt


def ton(n, f=220.0, amp=0.1, s0=0):
    return (amp * np.sin(2 * np.pi * f * (np.arange(n) + s0) / SR)).astype(np.float32)


def klickspur(n, spb=SPB, versatz=0):
    x = np.zeros(n, dtype=np.float32)
    form = np.exp(-np.arange(96) / 12.0) * np.cos(2 * np.pi * 2000.0 * np.arange(96) / SR)
    b = 0
    while True:
        s = int(np.floor(b * spb + 0.5)) + versatz
        if s + 96 > n:
            break
        x[s:s + 96] += (0.5 if b % 4 == 0 else 0.25) * form
        b += 1
    return x


def test_stille_findet_eingesetzte_luecke():
    x = ton(10 * SR)
    x[48000:48256] = 0.0                               # ein Block Stille bei 256
    s = messer.stille(x)
    assert len(s) == 1
    anfang, laenge = s[0]
    assert 47998 <= anfang <= 48000 and 256 <= laenge <= 258


def test_stille_negativ_sauberer_ton():
    assert messer.stille(ton(10 * SR)) == []           # Nulldurchgänge (1 Sample unter 1e-4) zählen nicht


def test_stille_zwei_kanaele_nur_wenn_beide_still():
    x = np.stack([ton(SR), ton(SR, f=330.0)], axis=1)
    x[1000:2000, 0] = 0.0                              # nur links still: kein Befund
    assert messer.stille(x) == []
    x[1000:2000, 1] = 0.0
    assert len(messer.stille(x)) == 1


def test_bloecke_stille_gleich_neu():
    x = ton(256 * 6)
    x[256:512] = 0.0
    x[1024:1280] = x[768:1024]
    assert messer.bloecke(x, 256) == ["neu", "stille", "neu", "neu", "gleich", "neu"]


def test_spruenge_harte_naht():
    x = ton(3 * TAKT)
    naht = 2 * TAKT - 1000                             # 220 Hz, Phase dort weit weg von null
    y = x.copy()
    y[naht:] = x[naht - TAKT: len(x) - TAKT]           # ab der Naht ein Takt früher, ohne Blende
    idx, werte, nat = messer.spruenge(y)
    assert list(idx) == [naht] and werte[0] > 0.05
    assert nat < 0.0030                                 # natürlicher größter Schritt 0,1 * 2 pi * 220 / 48000 = 0,00288


def test_spruenge_kleiner_sprung_ueber_der_schwelle():
    x = ton(TAKT).astype(np.float64)
    x[40000:] += 0.02                                   # Stufe 0,02: doppelt so groß wie die Schwelle 0,01
    idx, werte, _ = messer.spruenge(x)
    assert list(idx) == [40000] and 0.017 < werte[0] < 0.023


def test_spruenge_negativ_und_blende():
    x = ton(3 * TAKT)
    assert messer.spruenge(x)[0].size == 0
    naht = 2 * TAKT - 1000
    y = x.copy().astype(np.float64)
    g = np.arange(1, 129) / 129.0                       # 128 Samples Blende wie notbahn --blende 128
    y[naht:naht + 128] = (1 - g) * x[naht:naht + 128] + g * x[naht - TAKT:naht - TAKT + 128]
    y[naht + 128:] = x[naht + 128 - TAKT: len(x) - TAKT]
    assert messer.spruenge(y)[0].size == 0


def test_spruenge_klick_ausnahmen():
    k = klickspur(4 * TAKT)
    e = messer.einsaetze(k)
    assert messer.spruenge(k)[0].size > 0                        # Klick-Einsätze springen natürlich
    ausn = [(int(a), int(a) + 96) for a in e]
    assert messer.spruenge(k, ausnahmen=ausn)[0].size == 0


def test_einsaetze_und_phase_exakt():
    k = klickspur(12 * TAKT, versatz=512)
    e = messer.einsaetze(k)
    assert len(e) == 48 and e[0] == 512
    assert np.all(messer.phasen(e, SPB) == 0.0)


def test_raster_versatz_findet_sprung_und_null():
    k = klickspur(20 * TAKT)
    e = messer.einsaetze(k)
    r0 = messer.raster_versatz(e, SPB, vor_ende=8 * TAKT, nach_anfang=10 * TAKT)
    assert r0["versatz_samples"] == 0.0 and r0["streuung_vor"] == 0.0
    e2 = e.copy()
    e2[e2 >= 10 * TAKT] += 333                                  # Rückkehr 333 Samples daneben
    r = messer.raster_versatz(e2, SPB, vor_ende=8 * TAKT, nach_anfang=10 * TAKT)
    assert r["versatz_samples"] == 333.0


def test_klick_pausen_stille_bis_zum_fensterende():
    k = klickspur(20 * TAKT)
    e = messer.einsaetze(k)
    tot = e[e < 10 * TAKT + 100]                                # nach Takt 10 kommt nichts mehr (Notbahn tot)
    p = messer.klick_pausen(tot, SPB, 9 * TAKT, 18 * TAKT)
    assert p["fehlende_klicks"] == 31                           # 8 Takte = 32 Schläge, der erste davon klang noch
    ok = messer.klick_pausen(e, SPB, 9 * TAKT, 18 * TAKT)
    assert ok["fehlende_klicks"] == 0


def test_klick_pausen_fehlende_und_keine():
    k = klickspur(20 * TAKT)
    e = messer.einsaetze(k)
    p0 = messer.klick_pausen(e, SPB, 5 * TAKT, 10 * TAKT)
    assert p0["fehlende_klicks"] == 0 and p0["stille_samples"] == 0.0
    e2 = e[(e < 6 * TAKT) | (e >= 6 * TAKT + 2 * SPB)]         # zwei Klicks fehlen
    p = messer.klick_pausen(e2, SPB, 5 * TAKT, 10 * TAKT)
    assert p["fehlende_klicks"] == 2 and p["stille_samples"] == 2 * SPB


def test_schleife_treue_exakt_und_mit_loch():
    k = klickspur(12 * TAKT)
    y = k.copy()
    y[6 * TAKT:] = np.tile(k[5 * TAKT:6 * TAKT], 6)            # ab Takt 6 schleift der letzte Takt, bitgleich
    r = messer.schleife_treue(y, 4 * SPB, 5 * TAKT, 12 * TAKT)
    assert r["takt_frames"] == TAKT and r["abweichend"] == 0 and r["stille_frames"] == 0
    z = y.copy()
    e = messer.einsaetze(k)
    loch = int(e[(e > 8 * TAKT)][0])
    z[loch - 100:loch + 156] = 0.0                               # ein Block Stille genau über einem Klick
    r2 = messer.schleife_treue(z, 4 * SPB, 5 * TAKT, 12 * TAKT)
    assert r2["stille_frames"] > 0 and r2["abweichend"] > 0


def test_schleife_treue_nichtganzer_takt():
    spb = SR * 60.0 / 124.0                                      # 23225,8 Samples je Schlag, Takt 92903,2
    L = int(round(4 * spb))                                      # die Notbahn schleift mit ganzem takt_frames
    y = klickspur(12 * L, spb=spb)
    for s in range(6 * L, len(y), L):
        y[s:s + L] = y[s - L:s][:len(y) - s]
    r = messer.schleife_treue(y, 4 * spb, 6 * L + 10, len(y))
    assert r["abweichend"] == 0 and r["takt_frames"] == L == 92903


def test_raster_luecken_zaehlt_perioden_und_negativ():
    k = klickspur(20 * TAKT)
    e = messer.einsaetze(k)
    assert messer.raster_luecken(e, SPB, 256) == {"luecken": 0, "rueckwaerts": 0, "krumm": 0, "spruenge": []}
    e2 = e.copy()
    e2[e2 >= 5 * TAKT] += 256                                    # eine ausgelassene Periode
    e2[e2 >= 12 * TAKT] += 512                                   # zwei auf einmal
    r = messer.raster_luecken(e2, SPB, 256)
    assert r["luecken"] == 3 and r["rueckwaerts"] == 0 and r["krumm"] == 0 and len(r["spruenge"]) == 2
    e3 = e.copy()
    e3[e3 >= 5 * TAKT] += 1                                      # Jitter von einem Sample ist keine Lücke
    assert messer.raster_luecken(e3, SPB, 256)["luecken"] == 0
    e4 = e.copy()
    e4[e4 >= 5 * TAKT] += 300                                    # kein Vielfaches der Periode: krumm
    assert messer.raster_luecken(e4, SPB, 256)["krumm"] == 1


def test_stille_kurze_luecke_und_grenze():
    x = ton(10 * SR)
    x[24000:24020] = 0.0                                          # 20 Samples: über der Mindestlänge 16
    x[96000:96010] = 0.0                                          # 10 Samples: darunter
    s = messer.stille(x)
    assert len(s) == 1 and 24000 - 2 <= s[0][0] <= 24000 and 20 <= s[0][1] <= 22


def test_schleife_treue_kleine_abweichung():
    k = klickspur(12 * TAKT)
    y = k.copy()
    y[6 * TAKT:] = np.tile(k[5 * TAKT:6 * TAKT], 6)
    y[8 * TAKT + 5] += 1e-3                                       # ein Frame leicht daneben, kein Loch
    r = messer.schleife_treue(y, 4 * SPB, 5 * TAKT, 12 * TAKT)
    assert r["abweichend"] == 2 and r["stille_frames"] == 0      # das Frame selbst und sein Nachfolger einen Takt später
