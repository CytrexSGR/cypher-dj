#!/usr/bin/env python3
"""Belegt den laufenden Kern für die Kostenmessung der Scheibe 25 (tests/ziel/kosten25.sh) und hält ihn als Abonnent:
Prüfklick (ROADMAP Z1) in 16 Kanälen (deck/1..4, erz/1..8, pad/1..2, bus/1..2), Fader der 14 Quellen per /k/teil
(leitstand, Setzen 2 Beats voraus) auf 0 dB, Fader von bus/1 und bus/2 per /test/hand (nur Hand, §1.5; erster Wert nur
Stellung, §7.3 Punkt 2). --rampen: dazu je Kanal eine Rampe an eq/tief über 1 000 Beats (Stellwerk rechnet je Sample).
--leer: nichts belegen, nur abonnieren (Negativ-Kontrolle). Läuft --sekunden lang, meldet sich dann ab.
Aufruf: kosten25_sender.py --kern-port P --port P [--leer] [--rampen] --sekunden S"""
import argparse
import sys
import time
from pathlib import Path

DJK = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(DJK / "vertrag"))
import attrappe_leitstand as al  # noqa: E402

KANAELE = ["deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3", "erz/4", "erz/5", "erz/6", "erz/7",
           "erz/8", "pad/1", "pad/2", "bus/1", "bus/2"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kern-port", type=int, required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--leer", action="store_true")
    ap.add_argument("--rampen", action="store_true")
    ap.add_argument("--sekunden", type=float, default=60.0)
    a = ap.parse_args()
    k = al.Kern(a.kern_port, a.port, "kosten25")
    if k.verbinde() is None:
        print("kein /k/willkommen", file=sys.stderr)
        return 2
    while k.sample_jetzt() is None:
        k.pumpe()
    id0 = time.monotonic_ns()
    beat = k.sample_jetzt() / 22500.0 + 2.0  # 128 BPM aus kern.toml
    if not a.leer:
        for i, kanal in enumerate(KANAELE):
            k.schicke("/test/klick", ",hssi", [id0 + i, "pruefstand", kanal, 1])
            if kanal.startswith("bus/"):
                s = int(k.sample_jetzt()) + 48000
                k.schicke("/test/hand", ",sfh", [f"{kanal}/fader", 0.99, s])
                k.schicke("/test/hand", ",sfh", [f"{kanal}/fader", 1.0, s + 24000])
            else:
                k.schicke("/k/teil", ",hssisddfiiss", [id0 + 100 + i, "leitstand", "kosten", i, f"{kanal}/fader",
                                                        beat, 0.0, 0.0, 0, 1, "", ""])
            if a.rampen:
                k.schicke("/k/teil", ",hssisddfiiss", [id0 + 200 + i, "leitstand", "rampen", i, f"{kanal}/eq/tief",
                                                        beat + 4.0, 1000.0, -20.0, 1, 1, "", ""])
    ende = time.monotonic() + a.sekunden
    while time.monotonic() < ende:
        k.pumpe()
    abgelehnt = [m.roh() for m in k.eingang if m.adresse == "/q" and m.werte[2] in (4, 6, 7)]
    print(f"belegt: {'nein' if a.leer else '16 Kanäle'}, Rampen {'ja' if a.rampen else 'nein'}, "
          f"Ablehnungen {len(abgelehnt)} {abgelehnt[:3]}")
    k.schliesse()
    return 0 if not abgelehnt else 1


if __name__ == "__main__":
    sys.exit(main())
