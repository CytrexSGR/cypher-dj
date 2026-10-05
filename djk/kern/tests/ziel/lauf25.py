#!/usr/bin/env python3
"""Folgen-Läufer der Scheibe 25 (Kern-Schiene): fährt Golden-Folgen aus djk/vertrag/folgen/ gegen den echten Kern.
Dünne Ableitung des Läufers aus Scheibe 08 (djk/vertrag/attrappe_leitstand.py: Verbindung, Herzschlag, Handlungen zu
ihrem Sample, Urteil über folgen_vergleich.py, wert mit Vorgabe, erwarte_nicht, erlaube); er ändert ihn nicht
(Territorium 08) und ergänzt nur, was der Kern dieser Scheibe braucht (Plan 25, Nachtrag A und D):

  * Bereiche (FORMAT.md Punkt 14): der Kern aus 25 baut zeitachse, regler, ki und pruefstand; Zeilen anderer Bereiche
    (deck, hoerschein, invariante, …) werden übersprungen und gezählt. 08 hält die ausgeschalteten Bereiche in der
    Modulvariablen BEREICHE_AUS (gelesen in Lauf.fahre und Lauf.urteile); dieser Läufer setzt sie vor dem Lauf auf
    „alles außer --bereiche“ (eine Unterklasse mit eigenem Attribut wirkte nicht). Zeilen ohne `bereich` gelten immer.
  * aktion kern_kill9 (Punkt 16): kill -9 auf den Hauptprozess der Kern-Unit (--unit, MainPID aus systemd); systemd
    startet den Kern neu (Restart=always, RestartSec=0). Der Weg aus 08 (Kern selbst neu starten) liefe unter
    lauf25.sh auf zwei Kerne an einem Port.
  * --klick KANAL: vor der ersten Folge /test/klick an für diesen Kanal (ROADMAP Z1), für die Messung am Ziel.

Aufruf: lauf25.py [--kern-port P] [--port P] [--name N] [--unit U] [--klick KANAL] [--bereiche a,b,...]
                  [--bericht B.json] [--protokoll P.jsonl] folge.jsonl [folge.jsonl ...]
Ports nach ROADMAP Z2 aus CYPHERDJ_INSTANZ (Kern 47100 + 1000·k, eigener Port 47140 + 1000·k).
Rückgabe: 0 alle Folgen grün, 1 mindestens eine rot, 2 keine Verbindung.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

DJK = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(DJK / "vertrag"))
import attrappe_leitstand as al  # noqa: E402  (Scheibe 08)

GEBAUT = ("zeitachse", "regler", "ki", "pruefstand")


class AlleAusser:
    """Für al.BEREICHE_AUS: enthält jeden Bereich außer den gebauten; None (Zeile ohne Bereich) nie."""

    def __init__(self, gebaut):
        self.gebaut = set(gebaut)

    def __contains__(self, b) -> bool:
        return b is not None and b not in self.gebaut


class Lauf25(al.Lauf):
    def __init__(self, kern: al.Kern, felder: dict, unit: str):
        super().__init__(kern, felder)
        self.unit = unit
        self.kills: list[dict] = []
        self.uebersprungen = 0

    def handle(self, z: dict) -> tuple[bool, str]:
        if z.get("t") == "aktion" and z.get("was") == "kern_kill9":
            return self.kill9(z)
        return super().handle(z)

    def kill9(self, z: dict) -> tuple[bool, str]:
        if not self.unit:
            return False, "kern_kill9 braucht --unit (die Kern-Unit des Prüflaufs)"
        if not self.warte_bis(z["sample"]):
            return False, "Kern-Uhr erreicht das Abschuss-Sample nicht"
        r = subprocess.run(["systemctl", "--user", "show", "-p", "MainPID", "--value", self.unit],
                           capture_output=True, text=True)
        pid = int(r.stdout.strip() or 0) if r.stdout.strip().isdigit() else 0
        if pid <= 0:
            return False, f"kein MainPID für {self.unit}"
        os.kill(pid, signal.SIGKILL)
        self.kills.append({"pid": pid, "t_ns": time.monotonic_ns(), "sample": self.k.sample_jetzt()})
        return True, f"kill -9 {pid} bei Sample {self.k.sample_jetzt():.0f}"

    def fahre(self, zeilen: list[tuple[int, dict]]) -> bool:
        self.uebersprungen = sum(1 for _, z in zeilen if z.get("bereich") in al.BEREICHE_AUS)
        return super().fahre(zeilen)


def main(argv: list[str] | None = None, lauf_klasse=None, gebaut=GEBAUT) -> int:
    """lauf_klasse, gebaut: Ableitungen späterer Scheiben (Scheibe 31: lauf31.py mit Decks)."""
    lauf_klasse = lauf_klasse or Lauf25
    k = al.instanz_k()
    ap = argparse.ArgumentParser(description="Folgen-Läufer gegen den echten Kern")
    ap.add_argument("folgen", nargs="+")
    ap.add_argument("--kern-port", type=int, default=47100 + 1000 * k)
    ap.add_argument("--port", type=int, default=47140 + 1000 * k)
    ap.add_argument("--name", default="pruefstand")
    ap.add_argument("--unit", default="")
    ap.add_argument("--klick", default="")
    ap.add_argument("--bereiche", default=",".join(gebaut))
    ap.add_argument("--osc-json", default=str(DJK / "vertrag" / "osc.json"))
    ap.add_argument("--bericht")
    ap.add_argument("--protokoll")
    a = ap.parse_args(argv)
    al.BEREICHE_AUS = AlleAusser(b for b in a.bereiche.split(",") if b)
    felder = al.lade_feldnamen(Path(a.osc_json))
    kern = al.Kern(a.kern_port, a.port, a.name, Path(a.protokoll) if a.protokoll else None, felder)
    bericht, alle_gruen = [], True
    try:
        if kern.verbinde() is None:
            print(f"kein /k/willkommen vom Kern auf Port {a.kern_port}", file=sys.stderr)
            return 2
        if a.klick:
            kern.schicke("/test/klick", ",hssi", [time.monotonic_ns(), "pruefstand", a.klick, 1])
        for pfad in a.folgen:
            lauf = lauf_klasse(kern, felder, a.unit)
            t0 = time.monotonic()
            gruen = lauf.fahre(al.lies_folge(pfad))
            alle_gruen &= gruen
            rot = [s for s in lauf.schritte if not s["ok"]]
            print(("GRÜN " if gruen else "ROT  ") + f"{os.path.basename(pfad)}: {len(lauf.schritte)} Schritte, "
                  f"{lauf.uebersprungen} Zeilen anderer Bereiche übersprungen"
                  + ("" if gruen else f", Zeile {rot[0]['zeile']}: {rot[0]['info'][:400]}"
                     + (f" (+{len(rot) - 1})" if len(rot) > 1 else "")), flush=True)
            bericht.append({"folge": pfad, "gruen": gruen, "dauer_s": round(time.monotonic() - t0, 3),
                            "uebersprungen": lauf.uebersprungen, "kills": lauf.kills, "schritte": lauf.schritte,
                            "quittungen": lauf.quittungen()})
    finally:
        kern.schliesse()
    if a.bericht:
        Path(a.bericht).write_text(json.dumps(bericht, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0 if alle_gruen else 1


if __name__ == "__main__":
    sys.exit(main())
