#!/usr/bin/env python3
"""Instrument-Kontrolle der Auswertung (Scheibe 35, Plan Task 1): künstliche Läufe mit bekannter Wahrheit im Format
von ziel_hand.py (abonnent.jsonl mit /uhr und /e/hand, ziel.f32 mit vier Kanälen und ziel.f32.json, start.json,
senden.jsonl, kern.err). Der Kern-Pfad liegt V_WAHR = 340 Samples vor der Aufnahme, die Aufnahme beginnt S_A = −5 120
Samples vor dem Anfang der Zeitachse; davor liegt eine alte Zeitachse (/uhr ab 0), die die Auswertung verwerfen muss.

  richtig    jeder Griff i ≥ 1 wirkt am Sample seines Versatzes, eine Periode (5,333 ms) nach dem Senden, der erste nur
             Stellung; /e/hand nach der 20-Hz-Drossel auf den Griff-Samples  --art latenz -> GRUEN, V = 340
  folgeblock jeder Griff wirkt am Anfang des Folgeblocks (Mutation)            --art latenz -> ROT
                                                                               --art mutation -> GRUEN (Befund folgeblock)
  erster     auch der erste Wert springt (erster Wert wirkt)                   --art latenz -> ROT
  versatz    wie richtig, alle Sprünge 48 Samples (1 ms) später               --art latenz -> ROT
  leer       keine Aufnahme                                                    --art latenz -> LEER
  luecke     wie richtig, aber der Aufnehmer meldet eine Lücke mitten in den Griffen (Frame-Zahl der Datei) --art latenz -> LEER
  luecke_kern wie richtig, aber der Kern meldet /e/luecke mitten in den Griffen                          --art latenz -> LEER
  ruhe       Träger ohne Griff, kein /e/hand, Überlauf 0                       --art ruhe   -> GRUEN
  ruhe_griff ein Griff mitten im Ruhelauf                                      --art ruhe   -> ROT
Rückgabe 0, wenn jedes Urteil stimmt und V genau 340 ist; je Fall eine Zeile.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

import numpy as np

HIER = pathlib.Path(__file__).resolve().parent
SR, N, SPB, A = 48000, 256, 22500, 0.5
V_WAHR, S_A = 340, -5120
T0 = 7_000_000_000  # mono_ns des Kern-Samples 0 der neuen Zeitachse


def t_ns(s):
    return T0 + s * 1e9 / SR


def drossel(samples):
    """/e/hand wie stellwerk/src/melder.cpp: sofort, wenn ≥ 2 400 Samples seit der letzten Meldung, sonst Nachzügler am
    Zyklusende mit dem Sample des letzten Griffs."""
    g, offen, aus, i = -10 ** 9, None, [], 0
    for c0 in range(0, samples[-1] + 4 * N, N):
        while i < len(samples) and samples[i] < c0 + N:
            if samples[i] - g >= 2400:
                aus.append(samples[i])
                g, offen = samples[i], None
            else:
                offen = samples[i]
            i += 1
        if offen is not None and c0 + N - 1 - g >= 2400:
            aus.append(offen)
            g, offen = c0 + N - 1, None
    return aus


def lauf(o, art):
    rng = np.random.default_rng(35)
    o.mkdir(parents=True)
    s_start = 6 * SPB
    dauer = 16 * SR
    (o / "start.json").write_text(json.dumps({"b_start": 6, "s_start": s_start}) + "\n")
    (o / "lauf.meta").write_text("last_vorher=synthetisch\n")
    gain = np.zeros(dauer)
    gain[s_start:] = 10 ** (-10 / 20)
    zeilen = [{"t_ns": 0, "adresse": "/uhr", "werte": [s, int(t_ns(s) - 9e9), s / SPB, 128.0, 0.0]}
              for s in range(0, 40 * N, N)]  # alte Zeitachse vor /k/set/neu
    zeilen += [{"t_ns": 0, "adresse": "/uhr", "werte": [s, int(t_ns(s)), s / SPB, 128.0, 0.0]}
               for s in range(0, dauer, N)]
    sendungen, griffe = [], []
    s = s_start + 3 * SPB
    n_griffe = 0 if art.startswith("ruhe") else 300
    for i in range(n_griffe):
        t_send_us = int(t_ns(s) / 1000 - 5333.3 + rng.uniform(-0.02, 0.02) * 1000)
        sendungen.append(json.dumps({"typ": "gesendet", "i": i, "t_send_us": t_send_us, "wert": i % 128}))
        s_eff = s
        if art == "folgeblock":
            s_eff = (s // N + 1) * N
        if art == "versatz":
            s_eff = s + 48
        if i > 0 or art == "erster":
            gain[s_eff:] *= 1.05 if i % 2 else 1 / 1.03
            griffe.append(s_eff)
        s += int(rng.integers(624, 2256))
    if art == "ruhe_griff":
        gain[10 * SR:] *= 1.05
    for h in (drossel(griffe) if griffe else []):
        e_s = h - 48 if art == "versatz" else h  # der Kern meldet das Sample des Griffs, das Ziel zeigt 48 später
        zeilen.append({"t_ns": 0, "adresse": "/e/hand", "werte": ["deck/1/fader", 0.5, e_s, e_s / SPB]})
    k = np.arange(dauer)
    out = A * gain * np.array([0.0, 1.0, 0.0, -1.0])[k % 4]
    frames = dauer - S_A + V_WAHR
    y = np.zeros((frames, 4), dtype=np.float32)
    # Aufnahme-Frame f zeigt den Kern-Ausgang des Samples f + S_A − V
    f = np.arange(frames)
    ks = f + S_A - V_WAHR
    ok = (ks >= 0) & (ks < dauer)
    y[ok, 1] = out[ks[ok]].astype(np.float32)
    if art != "leer":
        y.tofile(o / "ziel.f32")
        meta = {"erster_mono_ns": int(t_ns(S_A))}
        if art == "luecke":
            meta["luecken_bei"] = [[s_start + 8 * SPB, -167936]]
        (o / "ziel.f32.json").write_text(json.dumps(meta) + "\n")
        if art == "luecke_kern":
            zeilen.append({"t_ns": 0, "adresse": "/e/luecke", "werte": [s_start + 8 * SPB, -167936, 0]})
    (o / "abonnent.jsonl").write_text("".join(json.dumps(z) + "\n" for z in zeilen))
    (o / "senden.jsonl").write_text("".join(z + "\n" for z in sendungen))
    (o / "kern.err").write_text('{"zyklen":1,"hand_ueberlauf":0,"hand_ohne_wirkung":0}\n')


def urteil(o, art, *extra):
    r = subprocess.run([sys.executable, str(HIER / "auswertung_hand.py"), str(o), "--art", art, *extra],
                       capture_output=True, text=True)
    z = r.stdout.strip().splitlines()
    try:
        erg = json.loads(z[0]) if z else {}
    except json.JSONDecodeError:
        erg = {}
    return (z[-1] if z else "LEER"), erg, r.returncode


def main():
    faelle = [("richtig", "latenz", "GRUEN", ()), ("folgeblock", "latenz", "ROT", ()),
              ("folgeblock", "mutation", "GRUEN", ("--p50-bezug", "5.333")), ("erster", "latenz", "ROT", ()),
              ("versatz", "latenz", "ROT", ()), ("leer", "latenz", "LEER", ()),
              ("luecke", "latenz", "LEER", ()), ("luecke_kern", "latenz", "LEER", ()), ("ruhe", "ruhe", "GRUEN", ()),
              ("ruhe_griff", "ruhe", "ROT", ())]
    fehler = 0
    with tempfile.TemporaryDirectory() as d:
        for synth, art, soll, extra in faelle:
            o = pathlib.Path(d) / f"{synth}-{art}"
            lauf(o, synth)
            ist, erg, rc = urteil(o, art, *extra)
            ok = ist == soll and (ist == "LEER" or erg.get("versatz_V") == V_WAHR)
            if synth == "folgeblock" and art == "latenz":
                ok = ok and erg.get("befund") == "folgeblock"
            fehler += not ok
            print(f"{'OK ' if ok else 'ROT'} {synth:10s} --art {art:8s} -> {ist} (soll {soll}) rc {rc} "
                  f"V {erg.get('versatz_V')} befund {erg.get('befund')} latenz {erg.get('latenz_ms')} "
                  f"gemessen {erg.get('gemessen')} e_hand {erg.get('e_hand', {}).get('anteil')}")
    print("alle Fälle wie erwartet" if not fehler else f"{fehler} Fälle falsch")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
