#!/usr/bin/env python3
"""profiles.py: bring back the card profile of a real ALSA output whose ports are missing.

Measured 2026-11-19 after a PC reboot: the digital output alsa_output.pci-0000_16_00.6.iec958-stereo was gone, the card
sat on output:iec958-ac3-surround-51, and the stereo profiles were not even offered (the card probe at boot left them
out). djk-start then stopped with "output ... not found". A restart of WirePlumber/PipeWire made the card probe again,
the stereo profile came back and was restored from WirePlumber's saved default.

Call: profiles.py --senke <node.name> [--neustart-erlaubt] [--warte <s>]
  node.name  alsa_output.<card>.<profile>, for example alsa_output.pci-0000_16_00.6.iec958-stereo
Steps, each only while the sink is missing:
  1. the card offers a profile output:<profile> (alone or with +input:...): set the available one with the highest
     priority (pactl set-card-profile) and wait for the sink.
  2. not offered and --neustart-erlaubt: restart wireplumber (the ALSA monitor probes the card again), then step 1;
     still missing: restart pipewire, pipewire-pulse and wireplumber together, then step 1. djk-start passes
     --neustart-erlaubt only when no cypherdj instance is running, because a restart cuts every audio stream.
Exit: 0 the sink exists (it did or now does), 3 not repaired (the output says why), 2 bad call.
Test stand: DJK_FIX_KARTEN (file with `pactl --format=json list cards`) and DJK_FIX_SENKEN (file with
`pactl list short sinks`) replace the live reads; DJK_PROFIL_TROCKEN=1 prints the commands instead of running them."""
import argparse
import json
import os
import re
import subprocess
import sys
import time


def lies(fix, befehl):
    pfad = os.environ.get(fix)
    if pfad:
        with open(pfad, encoding="utf-8") as f:
            return f.read()
    r = subprocess.run(befehl, capture_output=True, text=True, timeout=10, env={**os.environ, "LC_ALL": "C"})
    return r.stdout if r.returncode == 0 else ""


def zerlege(senke):
    """alsa_output.<card>.<profile> -> (alsa_card.<card>, <profile>), or None for any other sink name."""
    m = re.fullmatch(r"alsa_output\.(.+)\.([A-Za-z0-9_+-]+)", senke)
    if not m:
        return None
    return f"alsa_card.{m.group(1)}", m.group(2)


def waehle(karten, karte, profil):
    """The available profile of `karte` whose output part is exactly output:<profil>; highest priority first.
    Returns (name or None, active profile or None, card found)."""
    for c in karten:
        if c.get("name") != karte:
            continue
        passend = []
        for name, p in (c.get("profiles") or {}).items():
            teile = name.split("+")
            if f"output:{profil}" in teile and p.get("available", False):
                passend.append((p.get("priority", 0), name))
        passend.sort(reverse=True)
        return (passend[0][1] if passend else None), c.get("active_profile"), True
    return None, None, False


def senke_da(senke):
    return any(z.split("\t")[1:2] == [senke] for z in lies("DJK_FIX_SENKEN", ["pactl", "list", "short", "sinks"]).splitlines())


def karten():
    try:
        return json.loads(lies("DJK_FIX_KARTEN", ["pactl", "--format=json", "list", "cards"]) or "[]")
    except json.JSONDecodeError:
        return []


def tu(befehl):
    print("  profile: " + " ".join(befehl))
    if os.environ.get("DJK_PROFIL_TROCKEN"):
        return True
    return subprocess.run(befehl, capture_output=True, text=True, timeout=30).returncode == 0


def warte_auf(senke, s):
    if os.environ.get("DJK_PROFIL_TROCKEN"):
        return senke_da(senke)
    ende = time.monotonic() + s
    while time.monotonic() < ende:
        if senke_da(senke):
            return True
        time.sleep(0.2)
    return senke_da(senke)


def setze(karte, profil, senke, s):
    name, aktiv, gefunden = waehle(karten(), karte, profil)
    if not gefunden:
        return "card_missing", aktiv
    if name is None:
        return "not_offered", aktiv
    tu(["pactl", "set-card-profile", karte, name])
    return ("ok" if warte_auf(senke, s) else "set_but_missing"), aktiv


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--senke", required=True)
    ap.add_argument("--neustart-erlaubt", action="store_true")
    ap.add_argument("--warte", type=float, default=5.0)
    a = ap.parse_args()
    teile = zerlege(a.senke)
    if teile is None:
        print(f"profiles.py: '{a.senke}' is not an ALSA output (alsa_output.<card>.<profile>), nothing to repair", file=sys.stderr)
        return 3
    karte, profil = teile
    if senke_da(a.senke):
        return 0
    lage, aktiv = setze(karte, profil, a.senke, a.warte)
    print(f"  profile: {karte} active {aktiv}, output:{profil}: {lage}")
    if lage == "ok":
        return 0
    if not a.neustart_erlaubt:
        print("  profile: a restart of the audio server would be needed, not allowed here (a cypherdj instance is running)")
        return 3
    for dienste in (["wireplumber"], ["pipewire", "pipewire-pulse", "wireplumber"]):
        tu(["systemctl", "--user", "restart", *dienste])
        if not os.environ.get("DJK_PROFIL_TROCKEN"):
            time.sleep(3)
        if warte_auf(a.senke, 2):
            print(f"  profile: sink back after restarting {' '.join(dienste)}")
            return 0
        lage, aktiv = setze(karte, profil, a.senke, a.warte)
        print(f"  profile: after restarting {' '.join(dienste)}: active {aktiv}, output:{profil}: {lage}")
        if lage == "ok":
            return 0
    return 3


if __name__ == "__main__":
    sys.exit(main())
