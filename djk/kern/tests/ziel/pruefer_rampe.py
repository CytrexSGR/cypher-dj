#!/usr/bin/env python3
"""Prüfer für den Prüfklick in einer Tempo-Rampe am Ziel (Scheibe 08, Abnahme „Am Ziel“): meldet sich an, setzt eine
neue Zeitachse bei 128 BPM, schaltet /test/klick an, schickt /k/tempo/rampe 128 -> 132 über 32 Beats ab dem ersten
Taktanfang, der mindestens 8 Beats nach dem ersten Klick liegt (§3: Mindestvorlauf 1 Beat), hört bis 8 Beats nach dem
Rampenende zu und schaltet den Klick aus. Jede empfangene Nachricht (auch /uhr) steht im Protokoll; die letzte Zeile
{"zusammenfassung": ...} nennt Rampe, Quittungen und ersten Klick für auswertung_rampe.py.
Baut auf dem Prüfer der Scheibe 01 auf (djk/pruefstand/klick/pruefer.py: Anmeldung, Herzschlag, Protokoll).
Umgebung: CYPHERDJ_INSTANZ verschiebt die Ports (ROADMAP Z2).
Aufruf: pruefer_rampe.py --log L.jsonl --bereit B --aufnahme-bereit A [--ziel-bpm 132] [--dauer-beats 32]
Rückgabe: 0 erfüllt (alle Quittungen wie erwartet), 1 nicht erfüllt.
"""
import argparse
import math
import sys
import time
from pathlib import Path

DJK = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(DJK / "pruefstand" / "klick"))
from pruefer import QUELLE, Pruefer, warte_datei  # noqa: E402  (Scheibe 01)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", required=True)
    ap.add_argument("--bereit", required=True)
    ap.add_argument("--aufnahme-bereit", required=True)
    ap.add_argument("--ziel-bpm", type=float, default=132.0)
    ap.add_argument("--dauer-beats", type=float, default=32.0)
    a = ap.parse_args()
    p = Pruefer(a.log)
    z = {"art": "klick_rampe", "erfuellt": False}
    if not p.anmelden():
        z["grund"] = "kein /k/willkommen"
        p.ende(z)
        return 1
    q = p.set_neu(128.0)
    if not q or q[2] != 2:
        z["grund"] = "keine Quittung 2 auf /k/set/neu"
        p.ende(z)
        return 1
    Path(a.bereit).write_text("bereit\n")
    if not warte_datei(a.aufnahme_bereit, 15.0):
        z["grund"] = "Aufnehmer meldet sich nicht"
        p.ende(z)
        return 1
    time.sleep(0.3)
    ik = p.naechste_id()
    p.sende("/test/klick", "hssi", ik, QUELLE, "master", 1)
    k2 = p.quittung(ik, 2, 3.0)
    if not k2 or k2[2] != 2:
        z["grund"] = "keine Quittung 2 auf /test/klick"
        p.ende(z)
        return 1
    erster = k2[4]
    ab_beat = 4.0 * math.ceil((erster + 8.0) / 4.0)
    ir = p.naechste_id()
    p.sende("/k/tempo/rampe", "hsddd", ir, QUELLE, ab_beat, a.ziel_bpm, a.dauer_beats)
    stati = []
    ende_beat = ab_beat + a.dauer_beats + 8.0
    frist = time.monotonic() + (ende_beat - erster + 16.0) * 60.0 / 128.0
    while (p.beat is None or p.beat < ende_beat) and time.monotonic() < frist:
        r = p.warte(lambda adr, w: adr == "/q" and w[0] == ir, 0.1)
        if r:
            stati.append({"status": r[1][2], "ist_sample": r[1][3], "ist_beat": r[1][4], "grund": r[1][5]})
    ia = p.naechste_id()
    p.sende("/test/klick", "hssi", ia, QUELLE, "master", 0)
    p.quittung(ia, 2)
    z.update({"erster_klick_beat": erster, "erster_klick_sample": k2[3], "rampe": {
        "ab_beat": ab_beat, "ziel_bpm": a.ziel_bpm, "dauer_beats": a.dauer_beats, "quittungen": stati},
        "letzter_beat_gesehen": p.beat})
    z["erfuellt"] = [s["status"] for s in stati] == [1, 2, 3] and p.beat is not None and p.beat >= ende_beat
    p.ende(z)
    return 0 if z["erfuellt"] else 1


if __name__ == "__main__":
    sys.exit(main())
