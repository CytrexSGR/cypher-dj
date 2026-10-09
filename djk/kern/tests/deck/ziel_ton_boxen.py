#!/usr/bin/env python3
"""Keylock Task 7 Step 7 und 9 (Plan 2026-10-06-keylock-echtzeit.md, Detailschnitt 7a): Ton und Lage einer Loop-Box am Ziel,
an einer Prüfinstanz (nie der Betriebs-Kern), mit dem Aufbau von ziel_lauf.py (Senke, Notbahn daneben, Prüfmodus, Aufnehmer).
Für den Vergleich alt (Varianten-Weg, HEAD-Binär) gegen neu (Dehner in der Box) mit demselben Material und derselben Folge.

  --fall fest     Box 1 spielt --loop ab der Eins von Beat 8 für 16 Beats (Tonhöhe/Lage ab dem Einsatz)
  --fall laden    Box 1 spielt sinus416; bei Beat 24,x wird sinus832 in die klingende Box geladen (F13): Zeit bis zum
                  richtigen Ton und Dauer des Fehlklangs ab der Übernahme
  --fall start50  Box 1 wird rund 50 ms vor einer Eins gestartet (tatsächlicher Abstand aus der Quittung)
  --fall rampe    Box spielt ab Beat 8, Rampe von --bpm auf --ziel über 8 Beats ab Beat 12 (Step 9: 128 -> 132, 130 -> 140)
  --fall rec      Keylock 7b.5 (ADR 027 Messung 5 am Ziel): der Prüfklick (2 kHz, je Schlag) läuft in erz/1, REC 4 Beats bei
                  --bpm (/k/loop/rec, Umrechnung offline), dann spielt Box 1 den Mitschnitt bei --bpm; gemessen je Klick
                  Lage gegen das Raster und Frequenz (2000 Hz mit Keylock, 2000·bpm/128 im Varispeed)
  --keylock 0     Regler keylock aus (Fehlerfall: Varispeed, bei 135 BPM +92,07 ct)
Loops (in die Prüfinstanz geschrieben): sinus416 (1 Beat, 195 Perioden), sinus832 (1 Beat), klick4 (4 Beats, Klick je Beat),
musik (Kopie von ~/.config/cypherdj/loops/a-161218-4b, nur gelesen).
Zeitbezug: Kern-Sample des ersten Aufnahme-Frames aus der Treiber-Zeit (ziel_lauf.kern_sample_der_aufnahme) plus der feste
Versatz des Ausgangs, gemessen am Prüfklick (Z1) im Kanal pad/1 (derselbe Kanalzug wie die Box) bei Beat 2 bis 5.
Ergebnis: laeufe/<lauf>-<zeit>/ergebnis.json und box.npy (Master links ab dem Ereignis, 12 Beats), ton.csv
(keylock_ton_fenster.py). Rückgabe 0 gemessen, 2 Aufbau/Instrument unbrauchbar.
Aufruf (Schloss hält der Aufrufer): flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" ziel_ton_boxen.py --fall fest --bpm 135 --loop sinus416 --lauf x
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
from pathlib import Path

import numpy as np

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
sys.path.insert(0, str(HIER.parents[3] / "tests" / "stretch-bench"))
import ziel_lauf as zl  # noqa: E402
import ziel_lauf_boxen as zb  # noqa: E402
import keylock_ton_fenster as ktf  # noqa: E402

RATE, SPB = zl.RATE, zl.SPB


def schreibe_loop(ziel: Path, x: np.ndarray, beats: int):
    neu = ziel.parent / f".{ziel.name}.neu"
    shutil.rmtree(neu, ignore_errors=True)
    neu.mkdir(parents=True)
    x.astype(np.float32).tofile(neu / "loop.f32")
    (neu / "loop.json").write_text(json.dumps({"beats": beats, "bpm": 128.0, "datei": "loop.f32", "frames": len(x),
                                               "name": ziel.name, "quelle": "pruefstand", "schema": 1}))
    shutil.rmtree(ziel, ignore_errors=True)
    neu.rename(ziel)


DRUMS = {"wav": "", "bpm": 0.0}  # --drum-wav, --drum-bpm (Gegenmessung an echten Drums, Hinweis der Hauptinstanz 08.10.)
DRUM_BEATS = 8


def drum_loop() -> np.ndarray:
    """Die ersten DRUM_BEATS Beats des Drum-Stems auf Basis 128 (ziel_lauf.drum_quelle, resample_poly): (Frames, 2)."""
    y = zl.drum_quelle(DRUMS["wav"], DRUMS["bpm"])
    return y[:DRUM_BEATS * SPB].astype(np.float32)


def loops_anlegen(lo: Path):
    lo.mkdir(parents=True, exist_ok=True)
    t = np.arange(SPB)
    for hz in (416, 832):
        s = 0.5 * np.sin(2 * np.pi * hz * t / RATE)
        schreibe_loop(lo / f"sinus{hz}", np.stack([s, s], 1), 1)
    zb.schreibe_klick_loop(lo / "klick4")
    zb.kopiere_loop(zb.MUSIK, lo / "musik")
    if DRUMS["wav"]:
        schreibe_loop(lo / "drums", drum_loop(), DRUM_BEATS)


def regler(a: zl.Aufbau, pfad: str, ab: float, wert: float):
    i = a.merke(a.nid(), f"/k/teil {pfad} ab Beat {ab}")
    a.sende("/k/teil", ",hssisddfiiss", i, "pruefstand", "", 0, pfad, float(ab), 0.0, float(wert), 0, 1, "", "")


def quittung_werte(a: zl.Aufbau, i, status, frist=5.0):
    return a.quittung(i, status, frist)


def warte_beat(a: zl.Aufbau, bpm: float, b: float):
    """Bis die Kern-Uhr Beat b erreicht (aus /uhr, gilt auch in einer Rampe)."""
    ende = time.monotonic() + 120
    while time.monotonic() < ende:
        a.abo.pumpe()
        a.abweisungen()
        for m in reversed(a.abo.eingang):
            if m.adresse == "/uhr":
                if float(m.werte[2]) >= b:
                    return
                break
    raise RuntimeError(f"Beat {b} nicht erreicht")


def rec_vorab(a: zl.Aufbau, bpm: float, aus: dict) -> float:
    """Keylock 7b.5: Prüfklick in erz/1, REC 4 Beats (ab der nächsten Vierer-Grenze), warten auf /e/mitschnitt und die Datei.
    Rückgabe: Beat, ab dem der Rest des Laufs (Prüfklick pad/1, Start) beginnt (Vielfaches von 4)."""
    a.klick("erz/1", 1)
    warte_beat(a, bpm, 1.0)
    i = a.merke(a.nid(), "/k/loop/rec 4 Beats")
    name = f"rec7b{int(time.time()) % 100000}"  # je Lauf neu: die Loop-Ablage der Prüfinstanz (tmpfs) überlebt den Lauf
    aus["rec_name"] = name
    a.sende("/k/loop/rec", ",hsis", i, "pruefstand", 4, name)
    warte_beat(a, bpm, 8.5)
    a.klick("erz/1", 0)
    ende = time.monotonic() + 20
    datei = zb.loop_ordner(a) / name / "loop.json"
    me = None
    while time.monotonic() < ende and (me is None or not datei.exists()):
        a.abo.pumpe()
        for m in a.abo.eingang:
            if m.adresse == "/e/mitschnitt" and m.werte[0] == name:
                me = list(m.werte)
    aus["rec"] = {"e_mitschnitt": me, "datei": str(datei), "loop_json": json.loads(datei.read_text()) if datei.exists() else None}
    if me is None or me[2] != 0 or not datei.exists():
        raise RuntimeError(f"REC ohne Datei: {me}")
    b = None
    for m in reversed(a.abo.eingang):
        if m.adresse == "/uhr":
            b = float(m.werte[2])
            break
    return 4.0 * math.ceil((b + 1.0) / 4.0)


def lauf(a: zl.Aufbau, arg) -> dict:
    bpm = arg.bpm
    loops_anlegen(zb.loop_ordner(a))
    ist = zb.set_neu_bpm(a, bpm)
    aus = {"bpm_soll": bpm, "bpm_uhr": ist, "fall": arg.fall, "loop": arg.loop, "keylock": arg.keylock}
    if ist is None or abs(ist - bpm) > 0.05:
        aus["ungueltig"] = f"/uhr meldet {ist}"
        return aus
    regler(a, "pad/1/fader", 0.5, 0.0)
    if not arg.keylock:
        regler(a, "keylock", 0.5, 0.0)
    b0 = 0.0
    if arg.fall == "rec":
        b0 = rec_vorab(a, bpm, aus)
        aus["loop"] = "rec7b"
    aus["pruef_beats"] = [b0 + 2, b0 + 3, b0 + 4]
    erster = "sinus416" if arg.fall == "laden" else (aus["rec_name"] if arg.fall == "rec" else arg.loop)
    zb.loop_befehl(a, "/k/loop/laden", 1, erster, 3)
    warte_beat(a, bpm, b0 + 1.5)
    a.klick("pad/1", 1)
    warte_beat(a, bpm, b0 + 4.5)
    a.klick("pad/1", 0)
    # Start: fest und laden -> Befehl bei Beat 6, Einsatz Beat 8; start50 -> rund 50 ms vor der Eins von Beat 12
    if arg.fall == "start50":
        ziel = int(12 * 60.0 / bpm * RATE) - 2400 - 1024  # der Befehl wirkt am nächsten Blockanfang
        a.warte_sample(ziel)
    else:
        warte_beat(a, bpm, b0 + 6.0)
    i = a.merke(a.nid(), "/k/loop/start Box 1")
    a.sende("/k/loop/start", ",hsi", i, "pruefstand", 1)
    q = quittung_werte(a, i, 1)
    if not q:
        raise RuntimeError("/k/loop/start ohne Quittung 1")
    beat0 = float(q[4])
    eins = math.ceil(beat0 / 4.0 - 1e-9) * 4.0
    e_start = int(round(eins * 60.0 / bpm * RATE))
    aus.update({"start_quittung_sample": q[3], "start_beat0": beat0, "einsatz_beat": eins, "einsatz_sample": e_start,
                "start_vor_eins_ms": (e_start - q[3]) / RATE * 1000})
    ereignis = e_start
    if arg.fall == "laden":
        warte_beat(a, bpm, eins + 16.3)
        j = a.merke(a.nid(), "/k/loop/laden sinus832")
        a.sende("/k/loop/laden", ",hsis", j, "pruefstand", 1, "sinus832")
        ql = quittung_werte(a, j, 1)
        if not ql:
            raise RuntimeError("/k/loop/laden sinus832 ohne Quittung 1")
        ereignis = int(ql[3])
        aus["laden_sample"] = ereignis
    if arg.fall == "rampe":
        r = a.merke(a.nid(), "/k/tempo/rampe")
        a.sende("/k/tempo/rampe", ",hsddd", r, "pruefstand", eins + 4.0, float(arg.ziel), 8.0)
        aus["rampe"] = {"ab_beat": eins + 4.0, "ziel": arg.ziel, "dauer": 8.0}
    aus["ereignis_sample"] = ereignis
    warte_beat(a, bpm, ereignis * bpm / 60.0 / RATE + 14.0)
    i = a.merke(a.nid(), "/k/loop/stopp Box 1")
    a.sende("/k/loop/stopp", ",hsi", i, "pruefstand", 1)
    warte_beat(a, bpm, ereignis * bpm / 60.0 / RATE + 16.0)
    aus["zustand_kern_ende"] = a.zustand_kern()
    return aus


def werte(o: Path, lf: dict) -> tuple[dict, int]:
    erg = dict(lf)
    if lf.get("ungueltig"):
        return erg, 2
    x, meta = zl.aufnahme(o)
    s_a = zl.kern_sample_der_aufnahme(o, meta)
    erg["aufnahme_luecken"] = meta["luecken"]
    if s_a is None:
        erg["ungueltig"] = "Zuordnung Aufnahme ↔ Kern nicht eindeutig"
        return erg, 2
    bpm = lf["bpm_soll"]
    spb = 60.0 / bpm * RATE
    # Prüfklick Z1 in pad/1: Beats 2 bis 4 (Einsatz nach dem Einschalten bei 1,5), fester Versatz des Ausgangs
    pruef = [int(round(b * spb)) for b in lf.get("pruef_beats", [2, 3, 4])]
    vp = [v for v in zl.versaetze(x, s_a, pruef)]
    if not vp:
        erg["ungueltig"] = "kein Prüfklick"
        return erg, 2
    L = int(np.median([v[2] for v in vp]))
    erg["versatz_pruefklick"] = L
    erg["versatz_pruefklick_streuung"] = int(max(abs(v[2] - L) for v in vp))
    e = lf["ereignis_sample"]
    i0 = e - s_a + L
    n = int(12 * spb)
    seg = x[i0:i0 + n, 0].astype(np.float64)
    np.save(o / "box.npy", seg.astype(np.float32))
    erg["box_spitze"] = float(np.max(np.abs(seg))) if len(seg) else 0.0
    if lf["loop"].startswith("sinus") or lf["fall"] == "laden":
        soll = 832.0 if lf["fall"] == "laden" else float(lf["loop"][5:])
        kopf, zeilen = ktf.messe(seg, soll, 0, None, 416.0 if lf["fall"] == "laden" else None)
        erg["ton"] = kopf
        with open(o / "ton.csv", "w") as f:
            f.write("t_ms,ct,rms_db,ok,still\n")
            for z in zeilen:
                f.write(f"{z['t_ms']:.1f},{'' if z['ct'] is None else round(z['ct'], 4)},{z['rms_db']:.2f},{z['ok']},{z['still']}\n")
    if lf["loop"] == "drums":  # Lage je Transient (zl.transienten_lagen): Keylock f = 1, Varispeed f = bpm/128
        q = drum_loop()[:, 0].astype(np.float64)
        tr = [p for p in zl.transienten(q) if p + 512 < len(q)]
        f = 1.0 if lf["keylock"] else bpm / 128.0
        erw, trs = [], []
        for d in range(0, 12 // DRUM_BEATS + 1):  # Durchläufe des Loops in den 12 Beats
            for p in tr:
                b = d * DRUM_BEATS + p / SPB
                if b < 11.5:
                    erw.append(b * spb)
                    trs.append(p)
        gu = []
        lagen = zl.transienten_lagen(seg, q, trs, erw, f, guete=gu)
        erg["drums"] = {"tr": trs, "erwartet": erw, "lage": lagen, "guete": gu, "f": f}
    if lf["loop"] in ("klick4", "rec7b"):  # Lage je Klick gegen das Raster ab dem Einsatz (Beat-Abstand bei bpm)
        soll = [e + int(round(k * spb)) for k in range(0, 12)]
        vd = zl.versaetze(x, s_a, soll)
        d = [v[2] - L for v in vd]
        erg["klick"] = {"n": len(d), "mittel": float(np.mean(d)) if d else None,
                        "max_betrag": int(max(abs(v) for v in d)) if d else None, "einzeln": d}
    if lf["loop"] == "rec7b":  # Keylock 7b.5: Frequenz je Klick (Prüfklick-Form exp(−i/12)·cos(2π f i), 96 Samples)
        i96 = np.arange(96)
        def frequenz(stelle):
            w = x[stelle:stelle + 160, 0].astype(np.float64)
            best = (0.0, None)
            for f in np.arange(1800.0, 2300.0, 2.0):
                for ph in np.linspace(0, 2 * np.pi, 16, endpoint=False):
                    t = np.exp(-i96 / 12.0) * np.cos(2 * np.pi * f * i96 / RATE + ph)
                    c = np.max(np.correlate(w, t, "valid")) / (np.linalg.norm(t) * (np.linalg.norm(w) + 1e-12))
                    if c > best[0]:
                        best = (float(c), float(f))
            return best
        soll = [e + int(round(k * spb)) for k in range(0, 12)]
        fr = []
        for v in zl.versaetze(x, s_a, soll):
            k, f = frequenz(max(v[0] - 32, 0))
            fr.append({"kern_sample": v[1], "f_hz": f, "korr": round(k, 4)})
        fs = [z["f_hz"] for z in fr if z["f_hz"]]
        # Bezug am selben Lauf: der Prüfklick (2000 Hz, vom Kern ohne Dehnung erzeugt) durch dieselbe Kette. Die Kette samt
        # Aufnahme verschiebt das Maß (gemessen: Prüfklick 2112 Hz statt 2000), darum zählt das Verhältnis.
        fp = [frequenz(max(v[0] - 32, 0))[1] for v in vp]
        mb, mp = (float(np.median(fs)) if fs else None), (float(np.median(fp)) if fp else None)
        erg["rec_klick_frequenz"] = {"je_klick": fr, "median_hz": mb, "pruefklick_hz": fp, "pruefklick_median_hz": mp,
                                     "ct_gegen_pruefklick": 1200 * math.log2(mb / mp) if mb and mp else None,
                                     "soll_keylock_ct": 0.0, "soll_varispeed_ct": 1200 * math.log2(bpm / 128.0)}
    return erg, 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fall", required=True, choices=["fest", "laden", "start50", "rampe", "rec"])
    ap.add_argument("--ziel", type=float, default=132.0)
    ap.add_argument("--bpm", type=float, required=True)
    ap.add_argument("--loop", default="sinus416", choices=["sinus416", "sinus832", "klick4", "musik", "drums"])
    ap.add_argument("--drum-wav", default="")
    ap.add_argument("--drum-bpm", type=float, default=0.0)
    ap.add_argument("--keylock", type=int, default=1)
    ap.add_argument("--lauf", required=True)
    ap.add_argument("--kern", default=str(zl.DJK / "kern" / "build" / "cypherdj-kern"))
    ap.add_argument("--nur-auswerten")
    arg = ap.parse_args(argv)
    DRUMS["wav"], DRUMS["bpm"] = arg.drum_wav, arg.drum_bpm
    if arg.nur_auswerten:
        o = Path(arg.nur_auswerten)
        lf = json.loads((o / "lauf.json").read_text())
    else:
        o = HIER / "laeufe" / f"{arg.lauf}-{time.strftime('%Y%m%d-%H%M%S')}"
        o.mkdir(parents=True)
        lf = {"lauf": arg.lauf, "kern": arg.kern, "drum_wav": arg.drum_wav, "drum_bpm": arg.drum_bpm, "last_vorher": zl.last(), "start": time.strftime("%Y-%m-%dT%H:%M:%S")}
        try:
            with zl.Aufbau(o, arg.lauf, arg.kern, [], 90) as auf:
                lf.update(lauf(auf, arg))
                lo = zb.loop_ordner(auf)
        except Exception as e:  # noqa: BLE001
            lf["fehler"] = repr(e)
            (o / "lauf.json").write_text(json.dumps(lf, indent=1, ensure_ascii=False, default=str))
            print(f"Aufbau gescheitert: {e!r} ({o})", file=sys.stderr)
            return 2
        for n in ("sinus416", "sinus832", "klick4", "musik", "drums"):
            shutil.rmtree(lo / n, ignore_errors=True)
        lf["last_nachher"] = zl.last()
        (o / "lauf.json").write_text(json.dumps(lf, indent=1, ensure_ascii=False, default=str))
    erg, rc = werte(o, lf)
    b = zl.blind(o)
    if b:
        erg["ungueltig"] = b
        rc = 2
    erg.update({"ordner": str(o), "rueckgabe": rc})
    (o / "ergebnis.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False, default=str))
    print(json.dumps({k: erg.get(k) for k in ("fall", "bpm_soll", "loop", "keylock", "rueckgabe", "ungueltig", "ton", "klick",
                                              "start_vor_eins_ms", "versatz_pruefklick", "ordner")}, ensure_ascii=False,
                     default=str))
    return rc


if __name__ == "__main__":
    sys.exit(main())
