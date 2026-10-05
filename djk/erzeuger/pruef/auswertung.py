#!/usr/bin/env python3
"""Durchstich Strudel Stufe 1 (Plan 2026-09-27 Task 9 und 11): Spitzen in einer Aufnahme (|x| > 0,05, Maximum in 200
Samples, dann 1 000 Samples Totzeit, wie kern35.h klicks()). Spitze < 0,2: Burst aus dem Kit; >= 0,2: Prüfklick Z1.
auswerten: Abstand Burst → voriger Klick (min, max, Streuung). wechsel: altes Muster Achtel-Offbeats (Abstand ≈ SPB/2),
neues Sechzehntel-Versatz (≈ SPB/4); erster neuer Burst, davor nur alte, danach nur neue, und ob er im Takt liegt, der
mit der Eins beginnt (Klick-Spitze 0,5). Ein Burst direkt auf dem Beat verschmölze mit dem Klick (84 Samples Abstand).
Aufruf: auswertung.py aufnahme.wav  |  auswertung.py --wechsel aufnahme.wav  |  auswertung.py --selbsttest"""
import json
import sys

import numpy as np

SPB = 22500
GRENZE = 0.2


def spitzen(x: np.ndarray) -> list:
    a = np.abs(x)
    out, n = [], 0
    kandidaten = np.where(a > 0.05)[0]
    while n < kandidaten.size:
        s = int(kandidaten[n])
        m = s + int(np.argmax(a[s:s + 200]))
        out.append((m, float(a[m])))
        n = int(np.searchsorted(kandidaten, s + 1000))
    return out


def trennen(x: np.ndarray):
    sp = spitzen(x)
    return [i for i, v in sp if v < GRENZE], [(i, v) for i, v in sp if v >= GRENZE]


def auswerten(x: np.ndarray) -> dict:
    burst, klick = trennen(x)
    ki = np.array([i for i, _ in klick], dtype=np.int64)
    d = []
    for i in burst:
        j = int(np.searchsorted(ki, i)) - 1
        if j >= 0:
            d.append(int(i - ki[j]))
    return {"impulse": len(burst), "klicks": len(klick), "abstand_min": min(d) if d else None,
            "abstand_max": max(d) if d else None, "streuung": (max(d) - min(d)) if d else None}


def wechsel(x: np.ndarray) -> dict:
    burst, klick = trennen(x)
    ki = np.array([i for i, _ in klick], dtype=np.int64)
    art = []
    for i in burst:
        j = int(np.searchsorted(ki, i)) - 1
        if j >= 0:
            art.append(("neu" if (i - ki[j]) < 3 * SPB // 8 else "alt", i, j))
    erster = next(((i, j) for a, i, j in art if a == "neu"), None)
    ok = erster is not None and all(a == "alt" for a, i, _ in art if i < erster[0]) \
        and all(a == "neu" for a, i, _ in art if i >= erster[0])
    eins = bool(erster is not None and klick[erster[1]][1] > 0.4)
    return {"ok": bool(ok), "erster_neuer": erster[0] if erster else None, "auf_takt_eins": eins}


def form(n=96, spitze=0.25):
    t = np.arange(n)
    f = np.exp(-t / 20.0) * np.sin(t / 3.0)
    return (spitze / np.abs(f).max() * f).astype(np.float32)


def synth(takte: int, wechsel_ab_beat=None) -> np.ndarray:
    x = np.zeros(takte * 4 * SPB + SPB, dtype=np.float32)
    for b in range(takte * 4):
        x[b * SPB:b * SPB + 96] += form(spitze=0.5 if b % 4 == 0 else 0.25)
        ab = wechsel_ab_beat if wechsel_ab_beat is not None else 10 ** 9
        s = b * SPB + (SPB // 4 + 84 if b >= ab else SPB // 2 + 84)
        x[s:s + 96] += form(spitze=0.15)
    return x


def selbsttest() -> None:
    r = auswerten(synth(3))
    assert r["impulse"] == 12 and r["klicks"] == 12 and r["streuung"] == 0, r
    x = synth(3)
    x[5 * SPB + SPB // 2 + 84:5 * SPB + SPB // 2 + 180] = 0.0
    x[5 * SPB + SPB // 2 + 85:5 * SPB + SPB // 2 + 181] = form(spitze=0.15)   # ein Burst ein Sample daneben
    assert auswerten(x)["streuung"] == 1
    w = wechsel(synth(8, wechsel_ab_beat=16))
    assert w["ok"] and w["auf_takt_eins"], w
    w = wechsel(synth(8, wechsel_ab_beat=18))   # Wechsel mitten im Takt: kein Takt-Anfang
    assert w["ok"] and not w["auf_takt_eins"], w
    print("selbsttest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selbsttest"]:
        selbsttest()
    else:
        import soundfile as sf
        pfad = sys.argv[-1]
        daten, rate = sf.read(pfad, dtype="float32", always_2d=True)
        assert rate == 48000, rate
        print(json.dumps(wechsel(daten[:, 0]) if sys.argv[1] == "--wechsel" else auswerten(daten[:, 0])))
