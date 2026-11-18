# lc3.py: feedback for the Novation Launch Control 3 (USB 1235:0157, ALSA client "LC3 1"): encoder LEDs and the display follow what is
# learned on the controller place of the device. Protocol: Launch Control 3 Programmer's Reference Guide v1.1, see
# docs/controller/launch-control-3.md.
#
# The feedback needs the device's DAW mode, and in DAW mode the encoders report on the DAW port. So this runs only while the DAW port of the
# device sits on a controller place (CONTROLLERS tab; the kern then reads "LC3 1: DAW In" on midi_ein_<place> directly, this module is not
# in the control path). With the plain MIDI port on the place the device is left alone: its custom modes stay as they are, no feedback.
#
# What it sends, all on the DAW port: DAW mode on (9F 0C 7F), one colour per encoder LED (lit in the RGB colour of the target's box when the
# graph has a panel for it, else B0 <cc> <palette index> of the target's group; dark when free) and per button LED (CC 37..44: box colour,
# white when learned without a box, dark when free) and one display text per encoder (name of the target, shown by the
# device together with the value whenever the encoder moves). The learn state comes from the page server (GET /lernen) every second.
#
# Values go back too: the encoders are endless and in absolute mode "if the DAW sends them position information, they automatically pick that up"
# (reference guide, Absolute and relative encoder modes). GET /lernen carries the current value of a learned knob (`wert`, 0..1); it is sent as the
# encoder's own CC on channel 16 whenever it differs from what the device holds (what it sent or was sent last) and the encoder has rested for a
# second. So after a sound preset, a program change (Page buttons) or a mouse move an encoder continues from the real value instead of jumping.
# A program change also puts the program's number and name on the display (GET /controller/fokus).
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
TASTEN = range(37, 45)                  # CC numbers of the 8 buttons in DAW mode; they report on channel 1, their LED answers to the same CC
TASTEN_KANAL = 1
# The colours of the boxes (panel sections) of a synth on the LEDs, RGB 0..127. The same ten hues in the same order as CTL_FARBEN in
# djk/ui/public/device_window.js (the device window), but saturated: a pastel that reads well on the screen comes out whitish or bluish on an LED and
# two of them cannot be told apart (Andreas, 2026-11-18). Order: red, green, yellow, blue, magenta, white, orange, teal, violet, dim white.
# A colour is given by the RANK of a box among the boxes the place drives right now (the first box of a program is red, the second green ...), so a
# program always uses the strongest colours; the page ranks the same way. tests/test_lc3.py checks that both lists have the same length.
BOX_FARBEN = [(127, 0, 0), (0, 127, 0), (127, 90, 0), (0, 0, 127), (127, 0, 60),
              (127, 127, 127), (127, 30, 0), (0, 127, 50), (50, 0, 127), (25, 25, 25)]
ANZEIGE_BEI_BEWEGUNG = 0x40 | 4         # config byte: show on change (bit 6), arrangement 4 = name + numeric value
TEXT_MAX = 18
RUHE_S = 1.0                            # an encoder that moved within this time is not sent a value (the project stores a grip 400 ms after it rests)
ANZEIGE_OVERLAY = 54                    # display target: the temporary overlay
ANZEIGE_DREI_ZEILEN = 2                 # arrangement 2: three lines of text (title, name, value)
ANZEIGE_ZEIGEN = 0x7F                   # config value that brings a configured display up


def daw_modus(an):
    return bytes([0x9F, 0x0C, 0x7F if an else 0x00])


def led(index, farbe):
    """LED colour: `farbe` is a palette index (B0 <cc> <index>) or an (r, g, b) triple of 0..127 (SysEx 01 53 <index> <r> <g> <b>)."""
    if isinstance(farbe, tuple):
        return KOPF + bytes([0x01, 0x53, index & 0x7F]) + bytes(c & 0x7F for c in farbe) + bytes([0xF7])
    return bytes([0xB0, index & 0x7F, farbe & 0x7F])


def box_raenge(zuordnungen, platz):
    """{box index: rank} of the boxes the assignments of `platz` point at, in ascending box order (the reading order of the panel)."""
    boxen = sorted({z["box"] for z in zuordnungen if z.get("platz", 1) == platz and isinstance(z.get("box"), int) and not isinstance(z.get("box"), bool) and z["box"] >= 0})
    return {b: i for i, b in enumerate(boxen)}


def box_farbe(z, raenge):
    """The RGB colour of the box of assignment `z` (the rank of its `box` among the boxes in use), or None when it has none."""
    rang = raenge.get(z.get("box")) if isinstance(z.get("box"), int) and not isinstance(z.get("box"), bool) else None
    return None if rang is None else BOX_FARBEN[rang % len(BOX_FARBEN)]


def anzeige_konfig(ziel, konfig):
    return KOPF + bytes([0x04, ziel & 0x7F, konfig & 0x7F, 0xF7])


def anzeige_text(ziel, feld, text):
    sauber = bytes(c if 0x20 <= c <= 0x7E else 0x3F for c in text.encode("ascii", "replace")[:TEXT_MAX])
    return KOPF + bytes([0x06, ziel & 0x7F, feld & 0x7F]) + sauber + bytes([0xF7])


# The Page buttons step the controller program of the place (POST /controller/programm; the page server then rewrites the table and this module lights the
# LEDs of the new program and sends its values). Page up = the previous program, Page down = the next. The CC numbers are NOT in the Programmer's Reference
# Guide; measured on the unit on 2026-11-18 (aseqdump on the DAW port): CC 106 and 107 on channel 1. A press of any other unknown control is logged once.
PAGE_SCHRITT = {106: -1, 107: 1}


def programm_schritt(daten):
    """-1 / +1 for a press of Page up / Page down (a CC with a value above 0, any channel), else None."""
    if len(daten) != 3 or (daten[0] & 0xF0) != 0xB0 or daten[2] == 0:
        return None
    return PAGE_SCHRITT.get(daten[1])


def unbekannter_druck(daten):
    """(channel, cc) of a pressed control that is neither an encoder, a numbered button nor a Page button, else None."""
    if len(daten) != 3 or (daten[0] & 0xF0) != 0xB0 or daten[2] == 0:
        return None
    if daten[1] in ENCODER or daten[1] in TASTEN or daten[1] in PAGE_SCHRITT:
        return None
    return (daten[0] & 0x0F) + 1, daten[1]


def sende_programm(platz, schritt):
    req = urllib.request.Request(SEITE + "/controller/programm", data=json.dumps({"platz": platz, "schritt": schritt}).encode(),
                                 method="POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=1.0) as r:
        r.read()


def platz_von(lernen):
    """The controller place whose port is the DAW port of the Launch Control, or None (GET /lernen `controller`)."""
    for c in lernen.get("controller") or []:
        port = str(c.get("port", ""))
        if "LC3" in port and "DAW" in port:
            return c.get("platz")
    return None


def soll(lernen, platz):
    """{LED index: (colour, text)} from the assignments of `platz` (GET /lernen `zuordnungen`): the 16 encoders (text = what the display shows)
    and the 8 buttons (text None: no display). A colour is the RGB of the box of the target (`box`), else the palette index of its group
    (encoder) or white (button); a free control is dark."""
    aus = {i: (FARBE_AUS, "free") for i in ENCODER}
    aus.update({i: (FARBE_AUS, None) for i in TASTEN})
    raenge = box_raenge(lernen.get("zuordnungen") or [], platz)
    for z in lernen.get("zuordnungen") or []:
        if z.get("platz", 1) != platz:
            continue
        if z.get("kanal") in (TASTEN_KANAL, 0) and z.get("nr") in TASTEN and z.get("typ", "cc") == "cc":
            aus[z["nr"]] = (box_farbe(z, raenge) or FARBE_SONST, None)   # a learned button, any art
            continue
        if z.get("kanal") not in (DAW_KANAL, 0) or z.get("nr") not in ENCODER:   # 0: an entry for any channel (a preset)
            continue
        if z.get("typ", "cc") != "cc" or z.get("art", "absolut") != "absolut":
            continue   # a learned button or pad (note, or a switch/action "taste"): not an encoder
        pfad = str(z.get("pfad", ""))
        aus[z["nr"]] = (box_farbe(z, raenge) or FARBEN.get(pfad.split("/")[0], FARBE_SONST), str(z.get("name") or pfad))
    return aus


def encoder_wert(daten):
    """(cc, value) of an encoder move the device reports (a CC 13..28, any channel), else None."""
    if len(daten) != 3 or (daten[0] & 0xF0) != 0xB0 or daten[1] not in ENCODER:
        return None
    return daten[1], daten[2]


def werte(lernen, platz):
    """{encoder CC: 0..127} from the current values (`wert`, 0..1) of the knobs the encoders of `platz` drive; an entry without a value is left out."""
    aus = {}
    for z in lernen.get("zuordnungen") or []:
        w = z.get("wert")
        if z.get("platz", 1) != platz or z.get("kanal") not in (DAW_KANAL, 0) or z.get("nr") not in ENCODER:
            continue
        if z.get("typ", "cc") != "cc" or z.get("art", "absolut") != "absolut" or isinstance(w, bool) or not isinstance(w, (int, float)):
            continue
        aus[z["nr"]] = max(0, min(127, int(w * 127 + 0.5)))
    return aus


def wert_nachrichten(soll_werte, geraet, bewegt, jetzt, ruhe=RUHE_S):
    """The CCs (channel 16) that bring the encoders to `soll_werte`: one per encoder whose value differs from what the device holds (`geraet`,
    {cc: value}) and that has rested for `ruhe` seconds (`bewegt`, {cc: time of its last move}). Returns [(cc, bytes)]."""
    aus = []
    for cc in sorted(soll_werte):
        if geraet.get(cc) == soll_werte[cc] or jetzt - bewegt.get(cc, float("-inf")) < ruhe:
            continue
        aus.append((cc, bytes([0xB0 | (DAW_KANAL - 1), cc, soll_werte[cc]])))
    return aus


def programm_von(fokus, platz):
    """(nr, of, name) of the controller program of `platz` (GET /controller/fokus `plaetze`), or None."""
    for p in (fokus or {}).get("plaetze") or []:
        pr = p.get("programm")
        if p.get("platz") == platz and isinstance(pr, dict):
            return pr.get("nr"), pr.get("von"), str(pr.get("name") or "")
    return None


def programm_zeilen(name, breite=TEXT_MAX):
    """Two display lines from a program name like "OSCILLATORS · MIXER · FILTER · TUNE": whole box names, as many as fit on the first line, the rest on the second."""
    teile = [t.strip() for t in name.split("\u00b7") if t.strip()]
    eins, zwei = [], []
    for t in teile:
        (eins if not zwei and (not eins or len(" ".join([*eins, t])) <= breite) else zwei).append(t)
    return " ".join(eins), " ".join(zwei)


def programm_anzeige(programm):
    """The messages that show a program on the display for a moment: "PROGRAM 2/4" over its box names on two lines."""
    nr, von, name = programm
    eins, zwei = programm_zeilen(name)
    return [anzeige_konfig(ANZEIGE_OVERLAY, ANZEIGE_DREI_ZEILEN), anzeige_text(ANZEIGE_OVERLAY, 0, f"PROGRAM {nr}/{von}"),
            anzeige_text(ANZEIGE_OVERLAY, 1, eins), anzeige_text(ANZEIGE_OVERLAY, 2, zwei), anzeige_konfig(ANZEIGE_OVERLAY, ANZEIGE_ZEIGEN)]


def nachrichten(neu, alt):
    """The MIDI messages that turn the device from `alt` into `neu` (both as soll() answers them; alt {} sends everything)."""
    aus = []
    for i in [*ENCODER, *TASTEN]:
        if neu[i] == alt.get(i):
            continue
        farbe, text = neu[i]
        if alt.get(i, (None, None))[0] != farbe:
            aus.append(led(i, farbe))
        if text is None:
            continue   # a button has no display
        aus.append(anzeige_konfig(i, ANZEIGE_BEI_BEWEGUNG))
        aus.append(anzeige_text(i, 0, text))
    return aus


def hole_lernen():
    with urllib.request.urlopen(SEITE + "/lernen", timeout=1.0) as r:
        return json.loads(r.read() or b"{}")


def hole_fokus():
    with urllib.request.urlopen(SEITE + "/controller/fokus", timeout=1.0) as r:
        return json.loads(r.read() or b"{}")


def lauf(stop, log, hole=hole_lernen, takt=1.0, schalte=sende_programm, fokus=hole_fokus):
    """Runs until `stop` is set. Leaves DAW mode when the DAW port leaves its place and at the end."""
    seq = alsa_seq.Client("cypherdj-lc3")
    aus = seq.port_out("daw")
    ein = seq.port_in("daw_ein")   # the Page buttons are read here (the encoders and numbered buttons go to the kern directly)
    an, gesendet, platz, gemeldet = False, {}, None, set()
    geraet, bewegt, programm = {}, {}, None   # encoder CC -> the value the device holds / the time of its last move; the program shown last

    def lies():
        """Reads what the device sent: encoder moves are noted, a Page press steps the program (True then), an unknown control is logged once."""
        geschaltet = False
        for _port, daten in seq.receive():
            e = encoder_wert(daten)
            if e is not None:
                geraet[e[0]], bewegt[e[0]] = e[1], time.monotonic()
                continue
            schritt = programm_schritt(daten)
            if schritt is not None and an and platz is not None:
                try:
                    schalte(platz, schritt)
                    geschaltet = True
                except (OSError, ValueError) as e:
                    log("LC3: program step not sent:", e)
            else:
                u = unbekannter_druck(daten)
                if u is not None and u not in gemeldet:
                    gemeldet.add(u)
                    log("LC3: unknown control pressed on the DAW port: channel", u[0], "CC", u[1])
        return geschaltet

    try:
        while not stop.is_set():
            geholt = time.monotonic()   # a value in the answer is at least this old: an encoder that moved after it is not overwritten
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
                    an, gesendet, programm = False, {}, None
                    geraet.clear()
                else:
                    if zustand == "new" or not an:
                        seq.connect_from(ein, GERAET)
                        time.sleep(0.1)   # a fresh subscription needs a moment before the device takes messages
                        seq.send(aus, daw_modus(True))
                        an, gesendet, programm = True, {}, None
                        geraet.clear()   # the device may hold anything: every value is sent anew
                        log("LC3: DAW mode on, feedback for controller place", platz)
                    neu = soll(lernen, platz)
                    for n in nachrichten(neu, gesendet):
                        seq.send(aus, n)
                        time.sleep(0.002)
                    gesendet = neu
                    lies()   # moves that came in while the page server answered
                    for cc, n in wert_nachrichten(werte(lernen, platz), geraet, bewegt, geholt):
                        seq.send(aus, n)
                        geraet[cc] = n[2]
                        time.sleep(0.002)
                    try:
                        pr = programm_von(fokus(), platz)
                    except (OSError, ValueError):
                        pr = programm
                    if pr is not None and pr != programm:
                        for n in programm_anzeige(pr):
                            seq.send(aus, n)
                            time.sleep(0.002)
                    programm = pr
            # wait for the next round, reading the device meanwhile; a program step starts the next round at once (the LEDs and values follow the new table)
            ende = time.monotonic() + takt
            while not stop.is_set() and time.monotonic() < ende:
                if lies():
                    time.sleep(0.15)   # the page server writes the table and the kern loads it
                    break
                stop.wait(0.03)
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
