# lc3.py: feedback for the Novation Launch Control 3 (USB 1235:0157, ALSA client "LC3 1"): encoder LEDs and the display follow what is
# learned on the controller place of the device. Protocol: Launch Control 3 Programmer's Reference Guide v1.1, see
# docs/controller/launch-control-3.md.
#
# The feedback needs the device's DAW mode, and in DAW mode the encoders report on the DAW port. So this runs only while the DAW port of the
# device sits on a controller place (CONTROLLERS tab; the kern then reads "LC3 1: DAW In" on midi_ein_<place> directly, this module is not
# in the control path). With the plain MIDI port on the place the device is left alone: its custom modes stay as they are, no feedback.
#
# What it sends, all on the DAW port: DAW mode on (9F 0C 7F), one colour per encoder LED (B0 <cc> <palette index>: lit in the colour of the
# target's group when the encoder is learned, dark when it is free) and one display text per encoder (name of the target, shown by the
# device together with the value whenever the encoder moves). The learn state comes from the page server (GET /lernen) every two seconds.
import json
import time
import urllib.request

import alsa_seq

SEITE = "http://127.0.0.1:47300"
GERAET = "LC3 1:1"                      # ALSA address of the DAW port (client name : port index)
KOPF = bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16])
ENCODER = range(13, 29)                 # CC numbers of the 16 encoders in DAW mode (channel 16), also their LED and display indices
DAW_KANAL = 16
FARBEN = {"deck": 41, "fx": 21, "erz": 13, "pad": 13}   # palette indices: blue, green, yellow; everything else white
FARBE_SONST, FARBE_AUS = 3, 0
ANZEIGE_BEI_BEWEGUNG = 0x40 | 4         # config byte: show on change (bit 6), arrangement 4 = name + numeric value
TEXT_MAX = 18


def daw_modus(an):
    return bytes([0x9F, 0x0C, 0x7F if an else 0x00])


def led(index, farbe):
    return bytes([0xB0, index & 0x7F, farbe & 0x7F])


def anzeige_konfig(ziel, konfig):
    return KOPF + bytes([0x04, ziel & 0x7F, konfig & 0x7F, 0xF7])


def anzeige_text(ziel, feld, text):
    sauber = bytes(c if 0x20 <= c <= 0x7E else 0x3F for c in text.encode("ascii", "replace")[:TEXT_MAX])
    return KOPF + bytes([0x06, ziel & 0x7F, feld & 0x7F]) + sauber + bytes([0xF7])


def platz_von(lernen):
    """The controller place whose port is the DAW port of the Launch Control, or None (GET /lernen `controller`)."""
    for c in lernen.get("controller") or []:
        port = str(c.get("port", ""))
        if "LC3" in port and "DAW" in port:
            return c.get("platz")
    return None


def soll(lernen, platz):
    """{encoder index: (colour, text)} for all 16 encoders from the assignments of `platz` (GET /lernen `zuordnungen`)."""
    aus = {i: (FARBE_AUS, "free") for i in ENCODER}
    for z in lernen.get("zuordnungen") or []:
        if z.get("platz", 1) != platz or z.get("kanal") != DAW_KANAL or z.get("nr") not in ENCODER:
            continue
        if z.get("typ", "cc") != "cc" or z.get("art", "absolut") != "absolut":
            continue   # a learned button or pad (note, or a switch/action "taste"): not an encoder
        pfad = str(z.get("pfad", ""))
        aus[z["nr"]] = (FARBEN.get(pfad.split("/")[0], FARBE_SONST), str(z.get("name") or pfad))
    return aus


def nachrichten(neu, alt):
    """The MIDI messages that turn the device from `alt` into `neu` (both as soll() answers them; alt {} sends everything)."""
    aus = []
    for i in ENCODER:
        if neu[i] == alt.get(i):
            continue
        farbe, text = neu[i]
        if alt.get(i, (None, None))[0] != farbe:
            aus.append(led(i, farbe))
        aus.append(anzeige_konfig(i, ANZEIGE_BEI_BEWEGUNG))
        aus.append(anzeige_text(i, 0, text))
    return aus


def hole_lernen():
    with urllib.request.urlopen(SEITE + "/lernen", timeout=1.0) as r:
        return json.loads(r.read() or b"{}")


def lauf(stop, log, hole=hole_lernen, takt=2.0):
    """Runs until `stop` is set. Leaves DAW mode when the DAW port leaves its place and at the end."""
    seq = alsa_seq.Client("cypherdj-lc3")
    aus = seq.port_out("daw")
    an, gesendet = False, {}
    try:
        while not stop.is_set():
            try:
                lernen = hole()
            except (OSError, ValueError):
                lernen = None   # page server away: keep the device as it is
            if lernen is not None:
                platz = platz_von(lernen)
                zustand = seq.connect_to_state(aus, GERAET) if platz is not None or an else None
                if zustand is None or platz is None:
                    if an and zustand is not None:
                        seq.send(aus, daw_modus(False))
                        log("LC3: DAW mode off (its DAW port is on no controller place)")
                    an, gesendet = False, {}
                else:
                    if zustand == "new" or not an:
                        time.sleep(0.1)   # a fresh subscription needs a moment before the device takes messages
                        seq.send(aus, daw_modus(True))
                        an, gesendet = True, {}
                        log("LC3: DAW mode on, feedback for controller place", platz)
                    neu = soll(lernen, platz)
                    for n in nachrichten(neu, gesendet):
                        seq.send(aus, n)
                        time.sleep(0.002)
                    gesendet = neu
            stop.wait(takt)
    finally:
        if an:
            seq.send(aus, daw_modus(False))
        seq.close()


if __name__ == "__main__":
    import sys
    import threading
    ende = threading.Event()
    try:
        lauf(ende, lambda *a: print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True))
    except KeyboardInterrupt:
        ende.set()
