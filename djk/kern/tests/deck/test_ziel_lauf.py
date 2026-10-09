#!/usr/bin/env python3
"""Selbsttest von ziel_lauf.py ohne JACK (Keylock-Plan Task 4 Step 1): das Messwerkzeug darf nicht blind bestehen.

Lauf w3k-20261006-210207 (06.10.) nahm 2,2 s auf allen vier Kanälen exakt 0 auf, 0 Prüfklicks: der Kern lehnte
/k/teil deck/1/fader (Quelle pruefstand, ohne Hörschein) mit Quittung 6 kein_hoerschein ab (I3a, Ohr T14), der Fader
blieb zu, und ziel_lauf.py sah die Abweisung nicht. Geprüft wird:
  1. blind(): eine Aufnahme mit Spitze 0 auf allen Kanälen ist ein Instrumentfehler; ein einziger Klick ist es nicht.
  2. main --nur-auswerten: ein stiller Lauf endet mit 2, auch bei einer Art, deren Grenzen die Aufnahme nicht lesen
     (kosten); Negativ-Kontrolle: derselbe Lauf mit Signal bleibt 0.
  3. Abweisung: Quittung 6 oder 4 auf einen eigenen Befehl bricht warte_sample sofort ab (mit Grund); 1 und 2 nicht.
  4. teil() öffnet einen Deck-Fader mit Quelle pruefstand und einem Hörschein der Prüfinstanz (/k/hoerschein vorher,
     Kanal und inhalt des geladenen Decks, Messfelder NaN); nie als andreas. Schließen und Stem-Regler ohne Schein;
     ein Fader auf einem nie geladenen Deck ist ein Aufbaufehler.
Aufruf: test_ziel_lauf.py   (Rückgabe 0: alles grün)"""
import json
import pathlib
import sys
import tempfile

import numpy as np

HIER = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import ziel_lauf as zl  # noqa: E402

fehler = 0


def pruef(bed, text):
    global fehler
    print(("ok   " if bed else "GESCHEITERT: ") + text)
    if not bed:
        fehler += 1


def lauf_ordner(wurzel: pathlib.Path, name: str, signal: bool) -> pathlib.Path:
    """Ein ausgewerteter kosten-Lauf, dessen Kern-Grenzen alle halten; nur die Aufnahme unterscheidet sich."""
    o = wurzel / name
    o.mkdir()
    x = np.zeros((48000, 4), dtype=np.float32)
    if signal:
        x[24000, 0] = 0.5
    x.tofile(o / "ziel.f32")
    (o / "ziel.f32.json").write_text(json.dumps({"erster_mono_ns": 0, "frames": 48000, "luecken": 0, "quantum": 256}))
    (o / "kern.err").write_text('{"zyklen":100,"frame_luecken_gesamt":0,"cb_p999_us":500,"cb_max_us":900}\n')
    (o / "lauf.json").write_text(json.dumps({"art": "kosten", "lauf": name, "decks_laufend": [1, 2, 3, 4]}))
    return o


class Abo:
    """Abonnent ohne Netz: Eingang von Hand, Kern-Uhr weit voraus, Gesendetes protokolliert."""

    def __init__(self, eingang):
        self.eingang, self.gesendet = eingang, []

    def pumpe(self):
        pass

    def sample_jetzt(self):
        return 1e12

    def schicke(self, adresse, typen, werte):
        self.gesendet.append((adresse, typen, werte))
        if adresse == "/k/hoerschein":  # der Kern quittiert die Registrierung sofort mit 1, 2, 3
            self.eingang += [q(werte[0], 1), q(werte[0], 2), q(werte[0], 3)]


def aufbau(eingang=()):
    a = object.__new__(zl.Aufbau)
    a.id, a.abo, a.lauf = 100, Abo(list(eingang)), "t"
    a.inhalt = {1: "c1c0000000000031/128000_r1"}  # Deck 1 geladen (laden() merkt es sich)
    return a


def q(i, status, grund=""):
    return zl.al.Nachricht("/q", ",hsihds", [i, "andreas", status, 90000, 4.0, grund], 0.0)


with tempfile.TemporaryDirectory() as t:
    w = pathlib.Path(t)
    still, laut = lauf_ordner(w, "still", False), lauf_ordner(w, "laut", True)

    # 1. blind()
    pruef(zl.blind(still) is not None, f"blind(): Spitze 0 auf allen Kanälen ist ein Fehler ({zl.blind(still)})")
    pruef(zl.blind(laut) is None, "blind(): ein Klick 0,5 auf Master links ist keiner (Negativ-Kontrolle)")

    # 2. main --nur-auswerten
    rc = zl.main(["--art", "kosten", "--lauf", "still", "--nur-auswerten", str(still)])
    erg = json.loads((still / "ergebnis.json").read_text())
    pruef(rc == 2 and "blind" in erg.get("fehler", ""), f"stiller kosten-Lauf endet mit 2 und Fehler blind (rc {rc}, "
          f"fehler {erg.get('fehler')!r})")
    rc = zl.main(["--art", "kosten", "--lauf", "laut", "--nur-auswerten", str(laut)])
    pruef(rc == 0, f"derselbe Lauf mit Signal bleibt 0 (Negativ-Kontrolle, rc {rc})")

    # 3. Abweisung eines eigenen Befehls
    for status, grund in ((6, "kein_hoerschein"), (4, "")):
        a = aufbau()
        a.teil("deck/1/fader", 4.0, 0.0)
        a.abo.eingang += [q(a.id, 1), q(a.id, status, grund)]
        try:
            a.warte_sample(10)
            pruef(False, f"Quittung {status} auf /k/teil bricht warte_sample ab (lief durch)")
        except RuntimeError as e:
            pruef("deck/1/fader" in str(e) and grund in str(e), f"Quittung {status} {grund} bricht ab: {e}")
    a = aufbau()
    a.teil("deck/1/fader", 4.0, 0.0)
    a.abo.eingang += [q(a.id, 1), q(a.id, 2), q(12345, 6, "fremder_befehl")]
    try:
        a.warte_sample(10)
        pruef(True, "Quittung 1 und 2, fremde 6: kein Abbruch (Negativ-Kontrolle)")
    except RuntimeError as e:
        pruef(False, f"Quittung 1 und 2, fremde 6: kein Abbruch (brach ab: {e})")

    # 4. Fader mit Hörschein, Quelle pruefstand
    a = aufbau()
    a.inhalt = {1: "c1c0000000000031/128000_r1"}
    a.teil("deck/1/fader", 4.0, 0.0)
    g = a.abo.gesendet
    pruef([x[0] for x in g] == ["/k/hoerschein", "/k/teil"], f"Fader öffnen: erst /k/hoerschein, dann /k/teil "
          f"({[x[0] for x in g]})")
    hs, teil = g[0][2], g[-1][2]
    pruef(hs[1] == "pruefstand" and hs[3] == "deck/1" and hs[4] == "c1c0000000000031/128000_r1" and hs[5] == "ok"
          and hs[7] >= 4.0 and hs[8] <= 0.0 and all(v != v for v in hs[10:13]),
          f"Hörschein: Quelle pruefstand, Kanal deck/1, inhalt des Decks, gültig ab Beat 4, Messfelder NaN ({hs})")
    pruef(teil[1] == "pruefstand" and teil[-1] == hs[2] and teil[-1].startswith("pruefstand-"),
          f"/k/teil: Quelle pruefstand mit hs_id {hs[2]!r} (Quelle {teil[1]!r}, hoerschein {teil[-1]!r})")
    pruef(all(x[2][1] != "andreas" for x in g), "kein Befehl dieses Weges gibt sich als andreas aus")
    a = aufbau()
    a.inhalt = {1: "c1c0000000000051/128000_r1"}
    a.teil("deck/1/stem/vocals", 70.0, -200.0)
    a.teil("deck/1/fader", 80.0, -200.0)
    pruef([x[0] for x in a.abo.gesendet] == ["/k/teil", "/k/teil"] and a.abo.gesendet[0][2][-1] == "",
          "Stem-Regler und Schließen ohne Hörschein (Negativ-Kontrolle)")
    try:
        aufbau().teil("deck/3/fader", 4.0, 0.0)
        pruef(False, "Fader auf ungeladenem Deck ist ein Aufbaufehler (lief durch)")
    except RuntimeError as e:
        pruef("kein geladener Inhalt" in str(e), f"Fader auf ungeladenem Deck: {e}")

    # 5. Task 4.2: Karte wie uhr.cpp (Rampe ab llround(sample_at(ab)), Ende auf llround), beat_at ∘ sample_at = id
    k = zl.KarteP()
    pruef(k.sample_at(40.0) == 40 * zl.SPB and k.bpm_bei_beat(40.0) == 128.0, "Karte 128: sample_at(40) = 40 · 22 500")
    k.rampe(52.0, 132.0, 8.0)
    d = max(abs(k.sample_at(b) - zl.tempo_sample_at(b)) for b in (52.0, 55.5, 60.0, 70.0, 100.0))
    pruef(d < 1.0, f"eine Rampe 128 -> 132 wie tempo_sample_at (Welle 3), Abweichung {d:.3f} Samples")
    k.rampe(80.0, 124.0, 4.0)
    rund = max(abs(k.beat_at(k.sample_at(b)) - b) for b in (10.0, 53.3, 61.0, 81.7, 90.0))
    pruef(rund < 1e-9 and abs(k.bpm_bei_beat(90.0) - 124.0) < 1e-12 and abs(k.bpm_bei_beat(56.0) - 130.0) < 0.3,
          f"zwei Rampen: beat_at(sample_at(b)) = b ({rund:.1e}), Tempo nach der zweiten 124")

    # 6. Klick-Lage per Korrelation, Teil-Sample (Bezugspunkt Klick-Anfang)
    def klick_bei(n, soll, d):
        """Klicks auf soll + d, d gebrochen: bandbegrenzt verschoben (Phase im Spektrum), wie es eine Abtastung nach
        Varispeed oder R3 liefert; ein analytisch an gebrochener Stelle abgetasteter Klick hätte eine andere Form."""
        x0 = np.zeros(n)
        for s in soll:
            x0[int(s):int(s) + 96] += 0.5 * zl.fassung_klick_form()
        X = np.fft.rfft(x0)
        return np.fft.irfft(X * np.exp(-2j * np.pi * np.arange(len(X)) * d / n), n)
    soll = [10000.0 + 21000.0 * q for q in range(6)]
    for ist_minus_soll in (0.0, 7.0, 0.25, -3.5, 11.25):
        x = klick_bei(140000, soll, ist_minus_soll)
        l = zl.klick_lagen(x, soll, zl.fassung_klick_form())
        pruef(all(v is not None and abs(v - ist_minus_soll) < 0.1 for v in l),
              f"Klick-Lage {ist_minus_soll:+.2f}: gemessen {[None if v is None else round(float(v), 3) for v in l]}")
    pruef(zl.klick_lagen(np.zeros(5000), [4000.0], zl.fassung_klick_form()) == [None],
          "Klick-Lage: Fenster ragt aus der Aufnahme -> None")

    # 7. Tonhöhe je 100-ms-Fenster und Null-Läufe
    t = np.arange(48000 * 2)
    ct = zl.ton_fenster(0.5 * np.sin(2 * np.pi * 1000.0 * t / 48000.0), 0, len(t))
    pruef(len(ct) == 20 and max(abs(c) for c in ct) < 0.01, f"1000 Hz: 20 Fenster, max {max(abs(c) for c in ct):.4f} ct")
    ct = zl.ton_fenster(0.5 * np.sin(2 * np.pi * 1031.25 * t / 48000.0), 0, len(t))
    pruef(all(abs(c - 1200 * np.log2(132 / 128)) < 0.05 for c in ct), f"1031,25 Hz: +53,27 ct (Varispeed 132), {ct[3]:.3f}")
    y = 0.5 * np.sin(2 * np.pi * 1000.0 * t / 48000.0)
    y[30000:30040] = 0.0
    z = y.copy()
    z[30000:30040] = 0.0
    z[30031] = 1e-3
    pruef(zl.null_laeufe(y, 0, len(y)) == 1 and zl.null_laeufe(z, 0, len(z)) == 0,
          "Null-Läufe: 40 Nullen zählen, zweimal 31 nicht (Negativ-Kontrolle)")

    # 8. Transienten-Lage am Drum-Material: Vorlage aus der Quelle, Ausgabe verzögert bzw. im Varispeed gedehnt
    rng = np.random.default_rng(7)
    quelle = np.zeros(22500 * 8)
    for p in range(0, len(quelle) - 2000, 5625):     # Sechzehntel bei 128: abklingende Rauschstöße
        quelle[p:p + 1500] += rng.standard_normal(1500) * np.exp(-np.arange(1500) / 200.0)
    tr = zl.transienten(quelle)
    pruef(len(tr) >= 28, f"Transienten in der Quelle gefunden: {len(tr)} (Soll 31 bis 32)")
    aus = np.concatenate([np.zeros(1000), quelle])   # Keylock-Fall: Quelle um 1000 + 0 verschoben
    l = zl.transienten_lagen(aus, quelle, tr, [p + 1000.0 - 5.0 for p in tr], 1.0)
    pruef(all(v is not None and abs(v - 5.0) < 0.2 for v in l), f"Transienten +5 Samples: {np.round(l[:4], 2)}")
    f = 132.0 / 128.0                                 # Varispeed-Fall: Ausgabe(j) = Quelle(j · f)
    jv = np.arange(int(len(quelle) / f) - 10)
    var = np.interp(jv * f, np.arange(len(quelle)), quelle)
    l = zl.transienten_lagen(var, quelle, tr, [p / f for p in tr], f)
    pruef(all(v is not None and abs(v) < 0.5 for v in l), f"Varispeed-Vorlage gedehnt: Lage 0 ({np.round(l[:4], 2)})")

    # 8b. Kette aus einem Direktweg-Stück: Verzögerung plus Allpass (wie der LR8-Isolator) wird nachgebildet; eine
    # nichtlineare Kette (Begrenzer) bleibt mit Rest stehen (Negativ-Kontrolle)
    from scipy.signal import lfilter
    q8 = rng.standard_normal(200000) * 0.2
    c = 0.7                                          # Allpass 1. Ordnung (c + z⁻¹) / (1 + c z⁻¹)
    y8 = lfilter([c, 1.0], [1.0, c], np.concatenate([np.zeros(300), q8])[:len(q8)])
    h, rest = zl.kette_schaetzen(q8, y8)
    pruef(rest < 0.01, f"Kette Verzögerung 300 + Allpass nachgebildet, Rest {rest:.2e}")
    _, rest = zl.kette_schaetzen(q8, np.clip(y8, -0.15, 0.15))
    pruef(rest > 0.05, f"nichtlineare Kette (Begrenzer) bleibt mit Rest {rest:.3f} (Negativ-Kontrolle)")

    # 9. Reihen aus dem Protokoll: /zustand/deck ab der neuen Zeitachse, je /uhr davor
    zeilen = [{"adresse": "/uhr", "werte": [999744, 0, 0, 128.0, 0.0]},
              {"adresse": "/zustand/deck", "werte": [1, 2, "x", 128.0, 1, 0.0, 0.0, 1.0, 0.0, 1, 4, 0.0, 9, 9]},
              {"adresse": "/uhr", "werte": [0, 0, 0.0, 128.0, 0.0]},
              {"adresse": "/zustand/deck", "werte": [1, 2, "x", 128.0, 1, 0.0, 0.0, 1.0, 0.0, 0, 4, 0.0, 0, 0]},
              {"adresse": "/uhr", "werte": [256, 0, 0.0, 128.0, 0.0]},
              {"adresse": "/zustand/deck", "werte": [1, 2, "x", 128.0, 1, 0.0, 0.0, 1.0, 0.0, 1, 4, 0.0, 0, 2]},
              {"adresse": "/zustand/kern", "werte": [1, 256, 256, 0, 0, 812, 300, 0, 4, 0, 0]}]
    p = w / "abo.jsonl"
    p.write_text("\n".join(json.dumps(z) for z in zeilen) + "\n")
    r = zl.reihen(p)
    pruef(r["deck"][1] == [(0, 2, 0, 0, 0), (256, 2, 1, 0, 2)] and r["kern"] == [(256, 1, 0, 812, 4)],
          f"Reihen ab Sample 0 der neuen Achse, alte Achse verworfen ({r})")

print("test_ziel_lauf:", "grün" if fehler == 0 else f"{fehler} gescheitert")
sys.exit(1 if fehler else 0)
