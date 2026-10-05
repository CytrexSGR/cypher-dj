#!/usr/bin/env python3
"""Übersetzt eine Unit-Datei in Eigenschaften für `systemd-run --user -p ...`, damit Prüfläufe die Unit transient mit
genau ihren Einstellungen starten (ROADMAP §8.4: nie enable). Übernommen werden alle Schlüssel aus [Service] außer
ExecStart und Environment (die setzt der Prüflauf selbst) und StartLimitIntervalSec aus [Unit].
Aufruf: unit_eigenschaften.py <datei.service> [--ohne-notify]   Ausgabe: eine Zeile mit -p Schlüssel=Wert ...
--ohne-notify: für ein Kern-Programm ohne sd_notify (Fehlerfall mit dem Kern aus 08): Type=exec statt notify, ohne
Watchdog (ein Kern ohne WATCHDOG=1 würde sonst alle 200 ms getötet), alles andere gleich."""
import sys

AUS_UNIT = {"StartLimitIntervalSec", "StartLimitBurst"}
NICHT = {"ExecStart", "Environment"}
NOTIFY = {"Type", "NotifyAccess", "WatchdogSec", "WatchdogSignal"}


def eigenschaften(pfad, ohne_notify=False):
    teil = None
    aus = ["Type=exec"] if ohne_notify else []
    for zeile in open(pfad, encoding="utf-8"):
        z = zeile.strip()
        if not z or z.startswith("#"):
            continue
        if z.startswith("["):
            teil = z
            continue
        schluessel, _, wert = z.partition("=")
        if teil == "[Service]" and schluessel not in NICHT and not (ohne_notify and schluessel in NOTIFY):
            aus.append(f"{schluessel}={wert}")
        elif teil == "[Unit]" and schluessel in AUS_UNIT:
            aus.append(f"{schluessel}={wert}")
    return aus


if __name__ == "__main__":
    print(" ".join(f"-p {e}" for e in eigenschaften(sys.argv[1], "--ohne-notify" in sys.argv[2:])))
