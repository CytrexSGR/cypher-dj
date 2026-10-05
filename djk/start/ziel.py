#!/usr/bin/env python3
"""Löst ein Ausgangs-Ziel von djk-start in seine zwei Namensformen auf (Plan M-1, Blocker 1, Befund B4).

Warum zwei Formen: `pw-link` (und damit ports_da/verbunden in djk-start) kennt nur `node.name`
(alsa_output.pci-0000_16_00.6.iec958-stereo:playback_FL). Der Kern und die Notbahn laufen unter `pw-jack`; dort heißt
der Client des Geräts `node.description` (Family 17h/19h HD Audio Controller Digitales Stereo (IEC958):playback_FL).
Belegt ist nur diese eine Richtung: der Vorhörer hängt so am Digital-Out (`pw-link -l` zeigt die Verbindung auf den
node.name-Port, gestartet mit --ausgang "<node.description>:playback_F"). Der Gegenfall (node.name unter pw-jack)
steht nur im Commit f1b69f8 und ist hier nicht gemessen. Nicht geprüft: was pipewire-jack bei zwei Geräten mit
gleicher Beschreibung tut (hier wird das abgewiesen, nicht geraten).

Aufruf: ziel.py PRÄFIX [--dump DATEI]     PRÄFIX = "<node.name oder node.description>:<Portbasis>", z. B. ...:playback_F
        Umgebung DJK_PW_DUMP=DATEI wie --dump (Prüfstand: ein aufgezeichnetes `pw-dump` statt des lebenden).
Ausgabe: eine Zeile "NODE-PRÄFIX<TAB>KERN-PRÄFIX". NODE für pw-link, KERN für --master/--cue an den Kern.
Kein Treffer unter den Audio-Geräten (stumme Senke, cypherdj-pruef-*, JACK-Client): beide Formen = Eingabe.
Rückgabe: 0, 2 Eingabe ungültig (kein ':', Zeichen außerhalb der erlaubten, Beschreibung mehrdeutig).
Erlaubte Zeichen im Namen: Buchstaben, Ziffern, Leerzeichen und . _ ( ) / + , -. Anführungszeichen, Backslash, Dollar,
Prozent, At und Semikolon sind ausgeschlossen: die Namen landen in Befehlszeilen und systemd-Dateien."""
import json
import os
import re
import subprocess
import sys

NAME_OK = re.compile(r"[\w ._()/+,-]+")
BASIS_OK = re.compile(r"[A-Za-z0-9_]+")


def fehler(text):
    print(f"ziel.py: {text}", file=sys.stderr)
    sys.exit(2)


def knoten(dump_datei):
    """(node.name, node.description) aller Audio-Geräte; leer, wenn PipeWire nicht antwortet."""
    try:
        if dump_datei:
            with open(dump_datei, encoding="utf-8") as f:
                daten = json.load(f)
        else:
            r = subprocess.run(["pw-dump"], capture_output=True, text=True, timeout=10)
            if r.returncode != 0:
                return []
            daten = json.loads(r.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return []
    aus = []
    for o in daten:
        if o.get("type") != "PipeWire:Interface:Node":
            continue
        p = o.get("info", {}).get("props", {})
        if str(p.get("media.class", "")).startswith("Audio/") and p.get("node.name"):
            aus.append((p["node.name"], p.get("node.description", "")))
    return aus


def loese(ziel, dump_datei):
    name, doppelpunkt, basis = ziel.rpartition(":")
    if not doppelpunkt or not name or not BASIS_OK.fullmatch(basis):
        fehler(f"target {ziel!r}: expected '<sink>:<port base>' (e.g. cypher_stumm:playback_F or "
               f"alsa_output.<...>.iec958-stereo:playback_F); the kern appends L and R to it")
    if not NAME_OK.fullmatch(name):
        fehler(f"target {ziel!r}: sink name has characters outside letters, digits, space and . _ ( ) / + , -")
    liste = knoten(dump_datei)
    nach_name = [n for n in liste if n[0] == name]
    if nach_name:
        node, desc = nach_name[0]
    else:
        nach_desc = [n for n in liste if n[1] == name]
        if len(nach_desc) > 1:
            fehler(f"description {name!r} matches {len(nach_desc)} devices ({', '.join(n[0] for n in nach_desc)}); "
                   f"pass the node.name (pw-link -i) instead")
        if not nach_desc:
            return f"{name}:{basis}", f"{name}:{basis}"
        node, desc = nach_desc[0]
    if not desc:
        desc = node
    if not NAME_OK.fullmatch(desc):
        fehler(f"device {node!r} has a description with unsupported characters ({desc!r})")
    return f"{node}:{basis}", f"{desc}:{basis}"


def main(argv):
    dump = os.environ.get("DJK_PW_DUMP") or None
    args = list(argv)
    if "--dump" in args:
        i = args.index("--dump")
        if i + 1 >= len(args):
            fehler("--dump needs a file")
        dump = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1:
        fehler("usage: ziel.py PREFIX [--dump FILE]")
    node, kern = loese(args[0], dump)
    print(f"{node}\t{kern}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
