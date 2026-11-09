#!/usr/bin/env python3
"""Belegt den laufenden Kern für die Kostenmessung der Scheibe 25 (tests/target/kosten25.sh) und hält ihn als Abonnent:
Prüfklick (ROADMAP Z1) in 16 Kanälen (deck/1..4, erz/1..8, pad/1..2, bus/1..2), Fader der 14 Quellen per /k/teil
(leitstand, Setzen 2 Beats voraus) auf 0 dB, Fader von bus/1 und bus/2 per /test/hand (nur Hand, §1.5; erster Wert nur
Stellung, §7.3 Punkt 2). --rampen: dazu je Kanal eine Rampe an eq/tief über 1 000 Beats (Stellwerk rechnet je Sample).
--leer: nichts belegen, nur abonnieren (Negativ-Kontrolle). Läuft --sekunden lang, meldet sich dann ab.
--regler (Baukasten S5r): ramps deck/1..4/bk/1 and bk/2 over 1 000 beats (needs --graph).
--graph NAME (Baukasten S3c, D13): nach dem Belegen je /k/kanal/graph (Quelle leitstand) für deck/1..4, wartet auf die
Quittungen und meldet je Kanal "graph <kanal> angenommen" (Status 3) oder "graph <kanal> abgelehnt <grund>" (Status 6).
--send-graph NAME (Baukasten S6, R6; only together with --graph): additionally NAME as effect graph on the send returns fx/3
and fx/4, and deck/1..4/send/3 and send/4 at -6 dB so the buses carry signal (positive probe); six graphs in total.
--decks-offen: open the deck faders as the hand ("andreas"); from "leitstand" the kern rejects them with kein_hoerschein (I3), the
decks stay closed and no signal reaches the sends. Implied by --send-graph; give it to the reference run too (same load).
--werkzeuge LAYOUT (Plan A, A10): sets the rows of LAYOUT from werkzeug_layouts.txt (aus, limiter-gebaut, typisch, voll) with the same OSC
message the hand's server path sends (server.ts regler(): /k/teil, quelle "andreas", dauer 0, form 1, politik 0, a beat ahead; not the HTTP
hand path). Implies --decks-offen. A row counts as set only when the kern reports it started or done (/q status 2, 3 or 5; status 1 only means
scheduled); any 4, 6, 7 or 8 for the same id, also a late one, makes it rejected with the kern's reason. One line per row:
"werkzeug <pfad> angenommen" or "werkzeug <pfad> abgelehnt <grund>" (nothing started within 5 s: abgelehnt keine_ausfuehrung).
Before the rows it prints "werkzeug-layout <name> <n> rows, kern connected" (the kern answered /k/willkommen; the shell requires the line, also for aus).
The layout file is parsed with one strict grammar (header of the file); any error is exit 4. --layouts-datei PFAD: other layout file.
Aufruf: cost25_sender.py --kern-port P --port P [--leer] [--rampen] [--graph NAME [--send-graph NAME]] [--regler] [--decks-offen]
        [--werkzeuge LAYOUT [--layouts-datei PFAD]] --sekunden S"""
import argparse
import re
import sys
import time
from pathlib import Path

DJK = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(DJK / "contract"))
import mock_conductor as al  # noqa: E402

LAYOUTS = Path(__file__).resolve().parent / "werkzeug_layouts.txt"


class LayoutFehler(Exception):
    pass


RE_NAME = re.compile(r"[A-Za-z0-9_-]+")
RE_KEY = re.compile(r"[a-z][a-z0-9_]*")
RE_WERT = re.compile(r"[A-Za-z0-9._+-]+")
RE_PFAD = re.compile(r"[a-z0-9_]+(/[a-z0-9_]+)*")
RE_ZAHL = re.compile(r"-?[0-9]+(\.[0-9]+)?")
# rows each shipped layout must have; a lost line turns the run red (the shell and cost25.cpp pin the same numbers)
ZEILEN_SOLL = {"aus": 0, "limiter-gebaut": 4, "typisch": 19, "voll": 76}


def lies_layouts(datei: Path) -> dict[str, tuple[list[tuple[str, str]], list[tuple[str, float]]]]:
    """All layouts of the file: name -> (konfig lines, rows). One strict grammar (same in cost25.sh and cost25.cpp): '#' starts a comment,
    blank lines are skipped; 'layout NAME', 'konfig KEY VALUE', 'zeile PFAD NUMBER'; anything else, a missing or malformed value, a line before
    the first layout, a duplicate layout name, key or path raises LayoutFehler."""
    ergebnis: dict[str, tuple[list[tuple[str, str]], list[tuple[str, float]]]] = {}
    aktuell = ""
    try:
        text = datei.read_bytes().decode("utf-8")
    except UnicodeDecodeError as fehler:
        raise LayoutFehler(f"{datei}: not valid UTF-8 ({fehler})") from fehler
    for nr, roh in enumerate(text.split("\n"), 1):
        t = [x for x in re.split(r"[ \t]+", roh.split("#", 1)[0].strip(" \t")) if x != ""]
        if not t:
            continue

        def fehl(text: str) -> LayoutFehler:
            return LayoutFehler(f"{datei}:{nr}: {text}: {roh!r}")

        if t[0] == "layout":
            if len(t) != 2 or not RE_NAME.fullmatch(t[1]):
                raise fehl("layout needs exactly one name")
            if t[1] in ergebnis:
                raise fehl("duplicate layout")
            aktuell = t[1]
            ergebnis[aktuell] = ([], [])
        elif t[0] in ("konfig", "zeile"):
            if not aktuell:
                raise fehl(f"{t[0]} before the first layout")
            if len(t) != 3:
                raise fehl(f"{t[0]} needs exactly two values")
            konfig, zeilen = ergebnis[aktuell]
            if t[0] == "konfig":
                if not RE_KEY.fullmatch(t[1]) or not RE_WERT.fullmatch(t[2]):
                    raise fehl("malformed konfig key or value")
                if any(k == t[1] for k, _ in konfig):
                    raise fehl("duplicate konfig key")
                konfig.append((t[1], t[2]))
            else:
                if not RE_PFAD.fullmatch(t[1]) or not RE_ZAHL.fullmatch(t[2]):
                    raise fehl("malformed path or non-numeric value")
                if any(p == t[1] for p, _ in zeilen):
                    raise fehl("duplicate path")
                zeilen.append((t[1], float(t[2])))
        else:
            raise fehl("unknown keyword")
    for name, (_, zeilen) in ergebnis.items():
        if name in ZEILEN_SOLL and len(zeilen) != ZEILEN_SOLL[name]:
            raise LayoutFehler(f"{datei}: layout {name} has {len(zeilen)} rows, expected {ZEILEN_SOLL[name]}")
    return ergebnis


KANAELE = ["deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3", "erz/4", "erz/5", "erz/6", "erz/7",
           "erz/8", "pad/1", "pad/2", "bus/1", "bus/2"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kern-port", type=int, required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--leer", action="store_true")
    ap.add_argument("--rampen", action="store_true")
    ap.add_argument("--graph", default="")
    ap.add_argument("--regler", action="store_true")
    ap.add_argument("--send-graph", default="")
    ap.add_argument("--decks-offen", action="store_true")
    ap.add_argument("--werkzeuge", default="")
    ap.add_argument("--layouts-datei", default=str(LAYOUTS))
    ap.add_argument("--sekunden", type=float, default=60.0)
    a = ap.parse_args()
    if a.werkzeuge:   # parse the layout file before anything is sent: a broken file is exit 4 without touching the kern
        try:
            layouts = lies_layouts(Path(a.layouts_datei))
            if a.werkzeuge not in layouts:
                raise LayoutFehler(f"layout {a.werkzeuge} not in {a.layouts_datei}")
        except (LayoutFehler, OSError) as fehler:
            print(f"--werkzeuge {a.werkzeuge}: {fehler}", file=sys.stderr)
            return 4
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
                quelle = "andreas" if (a.decks_offen or a.send_graph or a.werkzeuge) and kanal.startswith("deck/") else "leitstand"
                k.schicke("/k/teil", ",hssisddfiiss", [id0 + 100 + i, quelle, "kosten", i, f"{kanal}/fader",
                                                        beat, 0.0, 0.0, 0, 1, "", ""])
            if a.rampen:
                k.schicke("/k/teil", ",hssisddfiiss", [id0 + 200 + i, "leitstand", "rampen", i, f"{kanal}/eq/tief",
                                                        beat + 4.0, 1000.0, -20.0, 1, 1, "", ""])
    graph_aus: list[str] = []
    if a.send_graph and not a.graph:
        print("--send-graph braucht --graph", file=sys.stderr)
        return 2
    if a.graph:
        kennung = {id0 + 300 + i: f"deck/{i + 1}" for i in range(4)}
        namen = {kid: a.graph for kid in kennung}
        if a.send_graph:   # S6: the send buses must carry signal, otherwise the send graphs would cost nothing
            for i in range(4):
                for n in (3, 4):
                    k.schicke("/k/teil", ",hssisddfiiss", [id0 + 400 + 10 * i + n, "leitstand", "kosten-send", i,
                                                            f"deck/{i + 1}/send/{n}", beat, 0.0, -6.0, 0, 1, "", ""])
            for j, kanal in enumerate(("fx/3", "fx/4")):
                kennung[id0 + 320 + j] = kanal
                namen[id0 + 320 + j] = a.send_graph
        for kid, kanal in kennung.items():
            k.schicke("/k/kanal/graph", ",hsss", [kid, "leitstand", kanal, namen[kid]])
        frist = time.monotonic() + 5.0
        quittiert: set[int] = set()
        while len(quittiert) < len(kennung) and time.monotonic() < frist:
            k.pumpe()
            for m in k.eingang:
                if m.adresse == "/q" and m.werte[0] in kennung and m.werte[0] not in quittiert and m.werte[2] in (3, 6):
                    quittiert.add(m.werte[0])
                    kanal = kennung[m.werte[0]]
                    graph_aus.append(f"graph {kanal} angenommen" if m.werte[2] == 3
                                     else f"graph {kanal} abgelehnt {m.werte[5]}")
        for kid, kanal in kennung.items():
            if kid not in quittiert:
                graph_aus.append(f"graph {kanal} abgelehnt keine_quittung")
    werkzeug_aus: list[str] = []
    if a.werkzeuge:   # A10: the rows of the layout; the kern's answer decides, not our send
        wz_zeilen = layouts[a.werkzeuge][1]
        print(f"werkzeug-layout {a.werkzeuge} {len(wz_zeilen)} rows, kern connected")
        beat_w = k.sample_jetzt() / 22500.0 + 2.0  # 128 BPM, as above
        wz_kennung = {id0 + 1000 + i: pfad for i, (pfad, _) in enumerate(wz_zeilen)}
        for i, (pfad, wert) in enumerate(wz_zeilen):
            k.schicke("/k/teil", ",hssisddfiiss", [id0 + 1000 + i, "andreas", "kosten-wz", i, pfad, beat_w, 0.0, wert, 1, 0, "", ""])

        def wz_status(kid: int) -> set[int]:
            return {m.werte[2] for m in k.eingang if m.adresse == "/q" and m.werte[0] == kid}

        frist = time.monotonic() + 5.0
        while time.monotonic() < frist and not all(wz_status(kid) & {2, 3, 4, 5, 6, 7, 8} for kid in wz_kennung):
            k.pumpe()
    if a.regler:   # Baukasten S5r (D13): ramp graph knobs 1 and 2 on deck/1..4 over 1 000 beats, every block moves
        beat_r = k.sample_jetzt() / 22500.0 + 2.0  # 128 BPM, as above
        for i in range(4):
            for j, nr in enumerate((1, 2)):
                k.schicke("/k/teil", ",hssisddfiiss", [id0 + 400 + 2 * i + j, "leitstand", "regler", 2 * i + j,
                                                        f"deck/{i + 1}/bk/{nr}", beat_r + 4.0, 1000.0, 1.0, 1, 1, "", ""])
    ende = time.monotonic() + a.sekunden
    while time.monotonic() < ende:
        k.pumpe()
    abgelehnt = [m.roh() for m in k.eingang if m.adresse == "/q" and m.werte[2] in (4, 6, 7)]
    print(f"belegt: {'nein' if a.leer else '16 Kanäle'}, Rampen {'ja' if a.rampen else 'nein'}, Regler {'ja' if a.regler else 'nein'}, "
          f"Ablehnungen {len(abgelehnt)} {abgelehnt[:3]}")
    for z in graph_aus:
        print(z)
    if a.werkzeuge:   # evaluated at the end, so a rejection after the window still counts
        for kid, pfad in wz_kennung.items():
            st = wz_status(kid)
            grund = next((m.werte[5] or str(m.werte[2]) for m in k.eingang
                          if m.adresse == "/q" and m.werte[0] == kid and m.werte[2] in (4, 6, 7, 8)), "")
            if grund:
                werkzeug_aus.append(f"werkzeug {pfad} abgelehnt {grund}")
            elif st & {2, 3, 5}:
                werkzeug_aus.append(f"werkzeug {pfad} angenommen")
            else:
                werkzeug_aus.append(f"werkzeug {pfad} abgelehnt keine_ausfuehrung")
    if a.werkzeuge and not a.leer:   # evidence that the decks were opened: the four deck fader rows were started (same rule as the tool rows)
        for i in range(4):
            st = wz_status(id0 + 100 + i)
            grund = next((m.werte[5] or str(m.werte[2]) for m in k.eingang
                          if m.adresse == "/q" and m.werte[0] == id0 + 100 + i and m.werte[2] in (4, 6, 7, 8)), "")
            werkzeug_aus.append(f"deckfader {KANAELE[i]} " + (f"abgelehnt {grund}" if grund else "angenommen" if st & {2, 3, 5} else "abgelehnt keine_ausfuehrung"))
    for z in werkzeug_aus:
        print(z)
    k.schliesse()
    return 0 if not abgelehnt else 1


if __name__ == "__main__":
    sys.exit(main())
