#!/usr/bin/env python3
"""Keylock Task 7 Step 1b (Plan 2026-10-06-keylock-echtzeit.md, Detailschnitt 7a, Gate G1): Last am Ziel mit vier Decks
und zwei Loop-Boxen, an einer Prüfinstanz (nie der Betriebs-Kern). Ändert ziel_lauf.py nicht, nutzt dessen Aufbau
(Senke, Notbahn daneben, Kern im Prüfmodus, Aufnehmer, Abonnent) und klick_fassung.

ziel_lauf.py --art kosten misst hierfür nichts (Prüfung M1): set_neu sendet fest 128,0 (alles im Direktweg mit Schatten)
und das Werkzeug kennt keinen /k/loop/*-Befehl. Hier:
  - set_neu_bpm(bpm) mit Kontrolle: /uhr meldet bpm innerhalb ±0,05 des Solls, sonst Lauf "ungültig" (Rückgabe 2);
  - vier Decks wie art_kosten (Fader −6 dB über teil mit Hörschein der Prüfinstanz beim jetzigen Tempo, Quelle pruefstand),
    dazu Box 1 mit einem Klick-Loop und Box 2 mit einem Musik-Loop, geladen und gestartet vor dem Messfenster;
  - Fälle --fall T128 (Schatten), T100, T170, R (130 -> 140 ab Beat 16 über 16 Beats, im Wechsel alle 64 Beats zurück);
  - --boxen an (Messung), leer (Grundlinie: Boxen leer), still (Negativ-Kontrolle: geladen, nicht gestartet);
  - --stoerer: Instrument-Check. Der Kern wird auf EINEN Kern gepinnt (taskset), daneben ein Busy-Loop SCHED_FIFO mit der
    Priorität der Keylock-Fäden auf demselben Kern: die Arbeits-Threads verhungern, Unterläufe MÜSSEN erscheinen.
Gemessen: Schlusszeile des Kerns ({"zyklen"...} und die Keylock-Zeile {"keylock"...} des Spikes 7.1b: Kosten und Leser-
Zähler je Quelle), /zustand/kern im Messfenster (cb_max_us je 1 s, frame_luecken), /zustand/deck (keylock_unterlauf,
keylock_aufgegeben), /zustand/box (Keylock 7b.3: dieselben Zähler und keylock_ring_voll je Box), CPU je Faden aus /proc/<pid>/task/<tid>/stat über das Fenster, VmRSS/VmLck, pw-top BUSY/WAIT des
Kerns als zweite Quelle. Grenzen (Gate G1): Unterlauf 0, frame_luecken 0 im Messfenster (Lücken davor ausgewiesen),
cb_max_us <= 2500 im Messfenster (/zustand/kern), aufgegeben 0, ring_voll 0,
Wächter 0, prio_fehler 0. Positiv-Kontrolle (boxen an): kl-arbeit-5/6 CPU > 0,5 × Median kl-arbeit-1..4, render_n und
gelesen der Boxen > 0. Negativ-Kontrolle (still): kl-arbeit-5/6 < 5 % des Deck-Medians.

Paket 1.13 Slice 2 (AK31 am Ziel): --arr ohne|warp legt zusätzlich ein Arrangement mit 32 Audio-Spuren in den Kern (acht Töne, je vier Spuren, Loop-Klammer 0 bis 16 Beats,
auf 125-BPM-Quellen im 128er Kern) und startet es vor dem Messfenster: ohne = ungewarpt (Grundlinie), warp = jeder Clip COMPLEX, das Warp-Werk des Kerns rechnet. Gemessen
wird zusätzlich /zustand/warp im Fenster (Unterlauf, kein_platz, spät: Grenze 0) und die Schlusszeile {"warp"…} des Kerns (Kosten je Block, CPU je Werk-Faden). Die Grenze des
Callbacks (p99,9 höchstens Grundlinie + 150 µs) vergleicht die Hauptinstanz zwischen den beiden Läufen (--arr ohne gegen --arr warp, gleiche Minuten).

Aufruf (Schloss hält der Aufrufer): flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" ziel_lauf_boxen.py --fall T100 --boxen an --lauf g1
Rückgabe 0 Gate gehalten, 1 gerissen, 2 ungültig (Aufbau, Tempo, Kontrolle).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import statistics
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import ziel_lauf as zl  # noqa: E402

RATE, SPB = zl.RATE, zl.SPB
MUSIK = Path.home() / ".config" / "cypherdj" / "loops" / "a-161218-4b"  # nur gelesen (kopiert in die Prüfinstanz)
FAELLE = {"T128": 128.0, "T100": 100.0, "T170": 170.0, "R": 130.0, "T135": 135.0}
GRENZE_CB_US = 2500
SPUREN_WARP = 32   # Spuren des Arrangements mit einem Warp-Clip in diesem Lauf (arr32warp)


def warp_plaetze() -> int:
    """Plätze im Warp-Werk, gelesen aus dem Kern-Kopf (ARR_WARP_PLAETZE in warp_werk.h), nicht geraten."""
    kopf = HIER.parents[1] / "include" / "cypherdj" / "warp_werk.h"
    m = re.search(r"constexpr\s+int\s+ARR_WARP_PLAETZE\s*=\s*(\d+)", kopf.read_text(encoding="utf-8"))
    if not m:
        raise RuntimeError(f"ARR_WARP_PLAETZE nicht gefunden in {kopf}")
    return int(m.group(1))


def set_neu_bpm(a: zl.Aufbau, bpm: float) -> float:
    """Wie Aufbau.set_neu, aber mit bpm; gibt das Tempo zurück, das /uhr danach meldet."""
    i = a.nid()
    a.abo.eingang.clear()
    a.sende("/k/set/neu", ",hsd", i, "pruefstand", float(bpm))
    if not a.quittung(i, 2):
        raise RuntimeError("/k/set/neu ohne Quittung")
    a.abo.uhr = None
    while a.abo.uhr is None:
        a.abo.pumpe()
    return uhr_bpm(a)


def uhr_bpm(a: zl.Aufbau):
    for m in reversed(a.abo.eingang):
        if m.adresse == "/uhr":
            return float(m.werte[3])
    return None


def hoerschein_bpm(a: zl.Aufbau, deck: int, ab: float, bpm: float) -> str:
    """Aufbau.hoerschein mit dem jetzigen Tempo (der Kern prüft es beim Öffnen auf ±0,5 %, stellwerk/src/i3.cpp)."""
    inhalt = a.__dict__["inhalt"][deck]
    i, hs = a.nid(), zl.hs_id(a.lauf, deck)
    nan = float("nan")
    a.sende("/k/hoerschein", ",hsssssddddfff", i, "pruefstand", hs, f"deck/{deck}", inhalt, "ok", float(bpm),
            float(ab) + 64.0, 0.0, 1e9, nan, nan, nan)
    if not a.quittung(i, 3):
        raise RuntimeError(f"/k/hoerschein {hs} ohne Quittung 3")
    return hs


def teil_bpm(a: zl.Aufbau, pfad: str, ab: float, wert: float, bpm: float):
    m = re.fullmatch(r"deck/([1-4])/(fader|trim)", pfad)
    hs = hoerschein_bpm(a, int(m.group(1)), ab, bpm) if m and wert > -200.0 else ""
    i = a.merke(a.nid(), f"/k/teil {pfad} ab Beat {ab}")
    a.sende("/k/teil", ",hssisddfiiss", i, "pruefstand", "", 0, pfad, float(ab), 0.0, float(wert), 0, 1, "", hs)


def start_pruef(a: zl.Aufbau, deck: int, ab: float, quell: float):
    i = a.merke(a.nid(), f"/k/deck/start Deck {deck} ab Beat {ab}")
    a.sende("/k/deck/start", ",hssssiddi", i, "pruefstand", "", "", "", deck, float(ab), float(quell), 0)
    return i


def loop_ordner(a: zl.Aufbau) -> Path:
    return a.shm / "loops"


def schreibe_klick_loop(ziel: Path):
    """4 Beats bei 128 BPM, Klick (wie klick_fassung) auf jedem Beat, Takt-Eins 0,5, sonst 0,25."""
    n = 4 * SPB
    x = np.zeros((n, 2), dtype=np.float32)
    i = np.arange(96)
    k = np.exp(-i / 12.0) * np.cos(2 * np.pi * 2000 * i / RATE)
    for b in range(4):
        x[b * SPB:b * SPB + 96, :] = (0.5 if b == 0 else 0.25) * k[:, None]
    neu = ziel.parent / f".{ziel.name}.neu"
    shutil.rmtree(neu, ignore_errors=True)
    neu.mkdir(parents=True)
    x.tofile(neu / "loop.f32")
    (neu / "loop.json").write_text(json.dumps({"beats": 4, "bpm": 128.0, "datei": "loop.f32", "frames": n,
                                               "name": ziel.name, "quelle": "pruefstand", "schema": 1}))
    shutil.rmtree(ziel, ignore_errors=True)
    neu.rename(ziel)


def kopiere_loop(quelle: Path, ziel: Path):
    shutil.rmtree(ziel, ignore_errors=True)
    shutil.copytree(quelle, ziel)
    j = json.loads((ziel / "loop.json").read_text())
    j["name"] = ziel.name
    (ziel / "loop.json").write_text(json.dumps(j))


def loop_befehl(a: zl.Aufbau, adresse: str, box: int, name: str | None = None, erwarte: int = 1):
    i = a.merke(a.nid(), f"{adresse} Box {box}")
    if name is None:
        a.sende(adresse, ",hsi", i, "pruefstand", box)
    else:
        a.sende(adresse, ",hsis", i, "pruefstand", box, name)
    if not a.quittung(i, erwarte, 5.0):
        raise RuntimeError(f"{adresse} Box {box} ohne Quittung {erwarte}")


def faeden(pid: int) -> dict:
    """{tid: (name, ticks)} aller Fäden des Kerns."""
    aus = {}
    for t in os.listdir(f"/proc/{pid}/task"):
        try:
            st = open(f"/proc/{pid}/task/{t}/stat").read()
        except OSError:
            continue
        name = st[st.index("(") + 1:st.rindex(")")]
        f = st[st.rindex(")") + 2:].split()
        aus[int(t)] = (name, int(f[11]) + int(f[12]))
    return aus


def vm(pid: int) -> dict:
    d = {}
    for z in Path(f"/proc/{pid}/status").read_text().splitlines():
        if z.startswith(("VmRSS:", "VmLck:")):
            d[z.split(":")[0]] = int(z.split()[1])
    return d


class PwTop:
    """pw-top -b im Hintergrund; BUSY/WAIT (µs) und ERR des Knotens cypherdj-kern-<i> je Ausgabe."""

    def __init__(self, datei: Path):
        self.f = open(datei, "w")
        env = dict(os.environ, LC_ALL="C")
        self.p = subprocess.Popen(["pw-top", "-b"], stdout=self.f, stderr=subprocess.DEVNULL, env=env,
                                  start_new_session=True)
        self.datei = datei

    def ende(self, knoten: str) -> dict:
        try:
            os.killpg(self.p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        self.p.wait(5)
        self.f.close()
        busy, wait, err = [], [], []
        for z in self.datei.read_text(errors="replace").splitlines():
            t = z.split()
            if len(t) >= 9 and t[-1] == knoten and t[4].endswith(("us", "ms")):
                def us(x):
                    return float(x[:-2]) * (1000.0 if x.endswith("ms") else 1.0)
                try:
                    wait.append(us(t[4]))
                    busy.append(us(t[5]))
                    err.append(int(t[8]))
                except ValueError:
                    pass
        return {"n": len(busy), "busy_max_us": max(busy) if busy else None,
                "busy_median_us": statistics.median(busy) if busy else None,
                "wait_max_us": max(wait) if wait else None, "err_max": max(err) if err else None}


ARR_BEATS = 16           # Länge der Loop-Klammer und der Clips (Paket 1.13 Slice 2)
ARR_FPB125 = 23040       # Frames je Beat einer 125-BPM-Quelle


def arr_ordner(a: zl.Aufbau) -> Path:
    """Arbeitsordner der Wiedergaben dieser Prüfinstanz (kern.toml-Vorgabe: ~/.cache/cypherdj-<i>/arr)."""
    return Path.home() / ".cache" / f"cypherdj-{a.i}" / "arr"


def arr_wiedergabe(ordner: Path, modus: str, nr: int = 1) -> dict:
    """Schreibt acht Töne (je 17 Quell-Beats) und wiedergabe-<nr>.json: 32 Audio-Spuren, vier je Ton, ein Clip über 16 Beats; modus warp: COMPLEX mit zwei Markern."""
    (ordner / "audio").mkdir(parents=True, exist_ok=True)
    frames = 17 * ARR_FPB125
    t = np.arange(frames, dtype=np.float64) / RATE
    shas = []
    for q in range(8):
        sha = "e" * 63 + "0123456789abcdef"[q]
        x = (0.3 * np.sin(2 * np.pi * 220.0 * (1.0 + 0.07 * q) * t)).astype(np.float32)
        np.stack([x, x], axis=1).tofile(ordner / "audio" / f"{sha}.f32")
        shas.append(sha)
    spuren = []
    for sp in range(1, 33):
        sha = shas[(sp - 1) % 8]
        clip = {"id": f"w{sp}", "start_beat": 0.0, "laenge_beats": float(ARR_BEATS), "sha256": sha, "datei": str(ordner / "audio" / f"{sha}.f32"),
                "frames": frames, "offset_frames": 0, "gain_db": -12.0, "ein_beats": 0.0, "aus_beats": 0.0}
        if modus == "warp":
            clip["warp"] = {"modus": 2, "w": [[0, 0], [ARR_BEATS, ARR_BEATS * ARR_FPB125]]}
        spuren.append({"nr": sp, "art": "audio", "clips": [clip]})
    wg = {"format": "cypherdj-arr/2", "nr": nr, "spuren": spuren}
    (ordner / f"wiedergabe-{nr}.json").write_text(json.dumps(wg))
    return wg


def arr_starten(a: zl.Aufbau, modus: str):
    """Laden, Loop-Klammer, Start (Quant 0) wie der Seiten-Server; jede Quittung wird abgewartet (laden 3, loop 3, start 1)."""
    arr_wiedergabe(arr_ordner(a), modus)
    i = a.merke(a.nid(), "/k/arr/laden 1")
    a.sende("/k/arr/laden", ",hsi", i, "pruefstand", 1)
    if not a.quittung(i, 3, 20.0):
        raise RuntimeError("/k/arr/laden ohne Quittung 3 (kern.err: Grund)")
    i = a.merke(a.nid(), "/k/arr/loop")
    a.sende("/k/arr/loop", ",hsidd", i, "pruefstand", 1, 0.0, float(ARR_BEATS))
    if not a.quittung(i, 3, 5.0):
        raise RuntimeError("/k/arr/loop ohne Quittung 3")
    i = a.merke(a.nid(), "/k/arr/start")
    a.sende("/k/arr/start", ",hsdi", i, "pruefstand", 0.0, 0)
    if not a.quittung(i, 1, 5.0):
        raise RuntimeError("/k/arr/start ohne Quittung 1")


def lauf(a: zl.Aufbau, arg) -> dict:
    bpm0 = FAELLE[arg.fall]
    beats = int(arg.minuten * 60 * 175 / 60) + 128
    zl.klick_fassung(a.ab, "c1c00000000000b1", "--beats", str(beats), "--stems", "--summe-als", "c1c00000000000b2")
    for n in (3, 4):
        zl.klick_fassung(a.ab, f"c1c00000000000b{n}", "--beats", str(beats))
    lo = loop_ordner(a)
    lo.mkdir(parents=True, exist_ok=True)
    schreibe_klick_loop(lo / "g1klick")
    kopiere_loop(MUSIK, lo / "g1musik")
    bpm_ist = set_neu_bpm(a, bpm0)
    aus = {"bpm_soll": bpm0, "bpm_uhr": bpm_ist}
    if bpm_ist is None or abs(bpm_ist - bpm0) > 0.05:
        aus["ungueltig"] = f"/uhr meldet {bpm_ist} statt {bpm0}"
        return aus
    for d, mid, st in ((1, "c1c00000000000b1", 1), (2, "c1c00000000000b2", 0), (3, "c1c00000000000b3", 0),
                       (4, "c1c00000000000b4", 0)):
        if not a.laden(d, mid, mit_stems=st)[0]:
            raise RuntimeError(f"Deck {d} lädt nicht")
        teil_bpm(a, f"deck/{d}/fader", 4.0, -6.0, bpm0)
        start_pruef(a, d, 8.0, 0.0)
    if arg.boxen in ("an", "still"):
        loop_befehl(a, "/k/loop/laden", 1, "g1klick", 3)
        loop_befehl(a, "/k/loop/laden", 2, "g1musik", 3)
        if arg.boxen == "an":
            loop_befehl(a, "/k/loop/start", 1)
            loop_befehl(a, "/k/loop/start", 2)
    if arg.arr != "aus":
        teil_bpm(a, "erz/4/fader", 4.0, 0.0, bpm0)   # erz/4 offen wie im Betrieb (D1 Spec 2.3), sonst rechnete der Kern ein Arrangement ins Leere
        arr_starten(a, arg.arr)
    pid = a.proc["kern"].pid
    # Keylock-Bau nach READY (kern.err) abwarten
    ende = time.monotonic() + 10
    while "Keylock bereit" not in (a.o / "kern.err").read_text(errors="replace"):
        if time.monotonic() > ende:
            raise RuntimeError("Keylock wird nicht bereit (kern.err)")
        a.abo.pumpe()
    stoerer = None
    if arg.stoerer:
        kern_cpu = str(arg.stoerer_cpu)
        subprocess.run(["taskset", "-a", "-p", "-c", kern_cpu, str(pid)], check=True, capture_output=True)
        stoerer = subprocess.Popen(["chrt", "-f", str(arg.stoerer_prio), "taskset", "-c", kern_cpu, sys.executable, "-c",
                                    "import time\nt=time.monotonic()+%d\nwhile time.monotonic()<t: pass" %
                                    int(arg.minuten * 60 + 20)])
    # Rampen (Fall R): ab Beat 16 auf 140 über 16 Beats, alle 64 Beats im Wechsel zurück
    rampen = []
    if arg.fall == "R":
        b, hoch = 16.0, True
        while b < beats - 64:
            rampen.append((b, 140.0 if hoch else 130.0))
            b += 64.0
            hoch = not hoch
    ri = 0

    def rampen_bis(beat_jetzt):
        nonlocal ri
        while ri < len(rampen) and rampen[ri][0] <= beat_jetzt + 8:
            r = a.merke(a.nid(), f"/k/tempo/rampe ab {rampen[ri][0]}")
            a.sende("/k/tempo/rampe", ",hsddd", r, "pruefstand", rampen[ri][0], rampen[ri][1], 16.0)
            ri += 1

    def beat_jetzt():
        for m in reversed(a.abo.eingang):
            if m.adresse == "/uhr":
                return float(m.werte[2])
        return 0.0

    # Einschwingen bis Beat 12, dann das Fenster
    while beat_jetzt() < 12.0:
        a.abo.pumpe()
        a.abweisungen()
        rampen_bis(beat_jetzt())
    n_ein = len(a.abo.eingang)
    f0, v0, t0 = faeden(pid), vm(pid), time.monotonic()
    pw = PwTop(a.o / "pwtop.txt")
    ende = t0 + arg.minuten * 60
    # Step 9: alle --ereignisse-s Sekunden ein Ereignis an einer Box in Zufallsfolge (Laden, Start, Stopp, Raster)
    import random
    rng = random.Random(9)
    naechstes = t0 + arg.ereignisse_s if arg.ereignisse_s > 0 else float("inf")
    ereignisse = []
    while time.monotonic() < ende:
        a.abo.pumpe()
        a.abweisungen()
        rampen_bis(beat_jetzt())
        if time.monotonic() >= naechstes:
            naechstes += arg.ereignisse_s
            box, art = rng.randint(1, 2), rng.choice(["laden", "start", "stopp", "raster"])
            i = a.nid()
            if art == "laden":
                a.sende("/k/loop/laden", ",hsis", i, "pruefstand", box, rng.choice(["g1klick", "g1musik"]))
            elif art == "raster":
                a.sende("/k/loop/raster", ",hsii", i, "pruefstand", box, rng.randint(0, 20000))
            else:
                a.sende(f"/k/loop/{art}", ",hsi", i, "pruefstand", box)
            ereignisse.append((round(time.monotonic() - t0, 1), box, art))
    f1, v1, t1 = faeden(pid), vm(pid), time.monotonic()
    pwt = pw.ende(f"cypherdj-kern-{a.i}")
    if stoerer:
        stoerer.kill()
        stoerer.wait()
    fenster = a.abo.eingang[n_ein:]
    zk = [m.werte for m in fenster if m.adresse == "/zustand/kern"]
    zd, zb = {}, {}
    for m in fenster:
        if m.adresse == "/zustand/deck":
            zd[m.werte[0]] = m.werte
        elif m.adresse == "/zustand/box":  # Keylock 7b.3 (§5.5b): Zähler je Box
            zb[m.werte[0]] = m.werte
    zw = [m.werte for m in fenster if m.adresse == "/zustand/warp"]   # Slice 2: stimmen, unterlauf, kein_platz, spaet, faeden
    bpms = [float(m.werte[3]) for m in fenster if m.adresse == "/uhr"]
    cpu = {}
    for tid, (name, ticks) in f1.items():
        vor = f0.get(tid, (name, 0))[1]
        cpu.setdefault(name, []).append(round((ticks - vor) / os.sysconf("SC_CLK_TCK"), 3))
    aus.update({
        "fenster_s": round(t1 - t0, 1), "cpu_s_je_faden": cpu, "vm_vorher": v0, "vm_nachher": v1, "pwtop": pwt,
        "zk_n": len(zk), "cb_max_us_fenster": max((w[5] for w in zk), default=None),
        "cb_p99_us_fenster_max": max((w[6] for w in zk), default=None),
        "frame_luecken_fenster": (zk[-1][3] - zk[0][3]) if zk and zk[0][0] == zk[-1][0] else None,
        "frame_luecken_ende": zk[-1][3] if zk else None,
        "deck_zustand_ende": {d: {"status": w[1], "hoerweg": w[9], "stretcher_fuell": w[10], "keylock_unterlauf": w[12],
                                  "keylock_aufgegeben": w[13]} for d, w in zd.items()},
        "box_zustand_ende": {b: {"status": w[1], "keylock_unterlauf": w[2], "keylock_aufgegeben": w[3],
                                 "keylock_ring_voll": w[4], "keylock_kein_platz": w[5] if len(w) > 5 else None}
                             for b, w in zb.items()},
        "bpm_fenster_min": min(bpms) if bpms else None, "bpm_fenster_max": max(bpms) if bpms else None,
        "rampen_gesendet": ri, "kern_pid": pid, "stoerer": bool(arg.stoerer), "ereignisse": ereignisse,
        "arr": arg.arr, "warp_zustand_n": len(zw), "warp_zustand_ende": list(zw[-1]) if zw else None,
        "warp_stimmen_max": max((w[0] for w in zw), default=None)})
    return aus


def werte(o: Path, lf: dict, arg) -> tuple[dict, int]:
    erg = dict(lf)
    if lf.get("ungueltig"):
        return erg, 2
    z = [x for x in (o / "kern.err").read_text(errors="replace").splitlines()]
    sz = [x for x in z if x.startswith('{"zyklen"')]
    kl = [x for x in z if x.startswith('{"keylock"')]
    if not sz or not kl:
        erg["ungueltig"] = "keine Schlusszeile des Kerns"
        return erg, 2
    erg["schluss"] = json.loads(sz[-1])
    k = json.loads(kl[-1])["keylock"]
    erg["keylock"] = k
    erg["waechter_zeilen"] = [x for x in z if "Keylock-Wächter" in x]
    cpu = lf["cpu_s_je_faden"]
    arb = {n: sum(cpu.get(f"kl-arbeit-{n}", [0.0])) for n in range(1, 7)}
    deck_med = statistics.median([arb[n] for n in range(1, 5)])
    erg["arbeit_cpu_s"] = arb
    erg["arbeit_cpu_anteil"] = {n: round(arb[n] / lf["fenster_s"], 4) for n in arb}
    q = k["quellen"]
    le = k["leser"]
    kontrollen = {}
    if arg.boxen == "an":
        kontrollen["box_faeden_rechnen"] = all(arb[n] > 0.5 * deck_med for n in (5, 6))
        kontrollen["render_n_alle"] = all(x and x["render_n"] > 0 for x in q)
        kontrollen["box_gelesen"] = all(le[i]["gelesen"] > 0 for i in (4, 5))
    elif arg.boxen == "still":
        kontrollen["box_faeden_ruhen"] = all(arb[n] < 0.05 * deck_med for n in (5, 6))
    else:
        kontrollen["box_faeden_ruhen"] = all(arb[n] < 0.05 * deck_med for n in (5, 6))
    kontrollen["decks_rechnen"] = deck_med > 0.0
    zwe = lf.get("warp_zustand_ende")
    if arg.arr == "warp":   # Positiv-Kontrolle: das Werk rechnet wirklich 32 Stimmen; /zustand/warp kommt an
        # an der Loop-Naht setzt der Kern den nächsten Durchlauf vorab an: bis zu 64 Stimmen (gemessen 651 x 32 und 40 x 64 bei 40 Nähten in 300 s). Mindestens 32 (alle Spuren
        # klingen), höchstens die Plätze des Werks (ARR_WARP_PLAETZE)
        smax = lf.get("warp_stimmen_max")
        kontrollen["warp_stimmen_32_bis_pool"] = smax is not None and SPUREN_WARP <= smax <= warp_plaetze()
        kontrollen["warp_zustand_da"] = bool(zwe)
        wz = [x for x in z if x.startswith('{"warp"')]
        kontrollen["warp_schluss_da"] = bool(wz)
        if wz:
            erg["warp"] = json.loads(wz[-1])["warp"]
    erg["kontrollen"] = kontrollen
    unterlauf = sum(x["unterlauf"] for x in le)
    zd = lf.get("deck_zustand_ende", {})
    zb = lf.get("box_zustand_ende", {})
    if arg.boxen == "an":  # Keylock 7b.3: geladene Boxen melden /zustand/box; fehlt es, ist der Lauf nicht auswertbar
        kontrollen["box_zustand_da"] = len(zb) == 2
    grenzen = {
        "unterlauf_0": unterlauf == 0 and all(w["keylock_unterlauf"] == 0 for w in list(zd.values()) + list(zb.values())),
        "frame_luecken_0": lf.get("frame_luecken_fenster") == 0,
        "cb_max_us_le_2500": lf.get("cb_max_us_fenster") is not None and lf["cb_max_us_fenster"] <= GRENZE_CB_US,
        "aufgegeben_0": sum(x["aufgegeben"] for x in le) == 0 and all(w["keylock_aufgegeben"] == 0
                                                                      for w in list(zd.values()) + list(zb.values())),
        "ring_voll_0": sum(x["ring_voll"] for x in q if x) == 0 and all(w["keylock_ring_voll"] == 0 for w in zb.values()),
        "waechter_0": k["waechter"] == 0,
        "prio_fehler_0": k["prio_fehler"] == 0,
    }
    if arg.arr == "warp" and zwe:   # AK31: 300 s am Ziel warp_unterlauf 0; Pool nie voll, nie spät (zwe: stimmen, unterlauf, kein_platz, spaet, faeden)
        grenzen["warp_unterlauf_0"] = zwe[1] == 0
        grenzen["warp_kein_platz_0"] = zwe[2] == 0
        grenzen["warp_spaet_0"] = zwe[3] == 0
    erg["grenzen"] = grenzen
    # ausgewiesen, nicht Gate: Lücken außerhalb des Messfensters (Start des Kerns, Bau der Dehner nach READY) mit dem
    # ersten /zustand/kern, das sie zeigt
    erg["frame_luecken_gesamt"] = erg["schluss"]["frame_luecken_gesamt"]
    for z in open(o / "abonnent.jsonl"):
        if '"/zustand/kern"' in z:
            w = json.loads(z)["werte"]
            if w[3]:
                erg["erste_luecke_zustand_kern"] = w
                break
    erg["unterlauf_summe"] = unterlauf
    erg["hart_summe"] = sum(x["hart"] for x in le)
    if not all(kontrollen.values()):
        erg["ungueltig"] = "Kontrolle gerissen: " + ", ".join(n for n, v in kontrollen.items() if not v)
        return erg, 2
    return erg, 0 if all(grenzen.values()) else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Gate G1: Last mit 4 Decks und 2 Loop-Boxen an einer Prüfinstanz")
    ap.add_argument("--fall", required=True, choices=sorted(FAELLE))
    ap.add_argument("--boxen", default="an", choices=["an", "leer", "still"])
    ap.add_argument("--lauf", required=True)
    ap.add_argument("--minuten", type=float, default=5.0)
    ap.add_argument("--kern", default=str(zl.DJK / "kern" / "build" / "cypherdj-kern"))
    ap.add_argument("--kern-arg", action="append", default=[])
    ap.add_argument("--stoerer", action="store_true")
    ap.add_argument("--ereignisse-s", type=float, default=0.0, help="Step 9: alle so viele Sekunden ein Box-Ereignis")
    ap.add_argument("--stoerer-cpu", type=int, default=15)
    ap.add_argument("--stoerer-prio", type=int, default=78)
    ap.add_argument("--arr", default="aus", choices=["aus", "ohne", "warp"], help="Slice 2: Arrangement mit 32 Audio-Spuren daneben (ohne = ungewarpt, warp = COMPLEX im Warp-Werk)")
    ap.add_argument("--nur-auswerten")
    arg = ap.parse_args(argv)
    if arg.nur_auswerten:
        o = Path(arg.nur_auswerten)
        lf = json.loads((o / "lauf.json").read_text())
    else:
        o = HIER / "laeufe" / f"{arg.lauf}-{time.strftime('%Y%m%d-%H%M%S')}"
        o.mkdir(parents=True)
        lf = {"fall": arg.fall, "boxen": arg.boxen, "arr": arg.arr, "lauf": arg.lauf, "kern": arg.kern, "last_vorher": zl.last(),
              "start": time.strftime("%Y-%m-%dT%H:%M:%S")}
        try:
            with zl.Aufbau(o, arg.lauf, arg.kern, arg.kern_arg, arg.minuten * 60 + 90) as auf:
                lf.update(lauf(auf, arg))
                ab, lo = auf.ab, loop_ordner(auf)
        except Exception as e:  # noqa: BLE001
            lf["fehler"] = repr(e)
            (o / "lauf.json").write_text(json.dumps(lf, indent=1, ensure_ascii=False, default=str))
            print(f"Aufbau gescheitert: {e!r} ({o})", file=sys.stderr)
            return 2
        lf["last_nachher"] = zl.last()
        for p in ab.glob("c1c00000000000*"):
            shutil.rmtree(p, ignore_errors=True)
        for n in ("g1klick", "g1musik"):
            shutil.rmtree(lo / n, ignore_errors=True)
        if arg.arr != "aus":   # Slice 2: die Töne und die Wiedergabe dieses Laufs
            ao = arr_ordner(auf)
            for q in range(8):
                (ao / "audio" / ("e" * 63 + "0123456789abcdef"[q] + ".f32")).unlink(missing_ok=True)
            (ao / "wiedergabe-1.json").unlink(missing_ok=True)
        (o / "lauf.json").write_text(json.dumps(lf, indent=1, ensure_ascii=False, default=str))
    erg, rc = werte(o, lf, arg)
    b = zl.blind(o)
    if b:
        erg["ungueltig"] = b
        rc = 2
    erg.update({"ordner": str(o), "rueckgabe": rc, "last_vorher": lf.get("last_vorher"),
                "last_nachher": lf.get("last_nachher")})
    (o / "ergebnis.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False, default=str))
    print(json.dumps({k: erg.get(k) for k in ("fall", "boxen", "arr", "rueckgabe", "ungueltig", "grenzen", "kontrollen",
                                              "cb_max_us_fenster", "unterlauf_summe", "arbeit_cpu_anteil", "pwtop",
                                              "ordner")}, ensure_ascii=False, default=str))
    return rc


if __name__ == "__main__":
    sys.exit(main())
