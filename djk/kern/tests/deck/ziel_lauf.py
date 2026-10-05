#!/usr/bin/env python3
"""Abnahme der Scheibe 31 am Ziel, stumm (SCHNITTSTELLEN §19.5, ROADMAP §8.4): eigene Null-Senke mit vier Kanälen je
Lauf, Kern mit Prüfmodus an eigenen Ausgängen (10k: --master <senke>:playback_F --cue <senke>:playback_R, Selbst-Wächter
100 ms wie die Unit), Notbahn daneben (ADR 016 Nachtrag, --daneben --kante cypherdj-kern-<i>:master_L, Vorlage
djk/kern/tests/neustart/serie.sh und tests/ziel/lauf25.sh), JACK-Aufnehmer mit vier Kanälen am Monitor der Senke (cypherdj-aufnehmer4, Scheibe 18), dazu ein
OSC-Abonnent (djk/vertrag/attrappe_leitstand.py als Bibliothek), der Befehle schickt und alles protokolliert.

Die Zuordnung Aufnahme ↔ Kern-Sample kommt aus der Treiber-Zeit: der Aufnehmer schreibt die Zyklus-Zeit (µs) seines
ersten Blocks, der Kern die jedes Blocks in /uhr; beide laufen im selben Graphen, also ist die Zeit gleich. Den festen
Versatz des Kern-Ausgangs (seit 25 mit dem Vorhalt des Master-Limiters, 84 Samples; F19) misst der Prüfklick Z1 im Kanal deck/1 (derselbe Kanalzug wie das Deck, bekannt genau seit
Scheibe 25); das Deck muss denselben Versatz zeigen, Klick für Klick.

Arten (--art):
  klick    Klick-Fassung (128 BPM, klick_fassung.py) auf Deck 1, --minuten lang: Prüfklick Z1 (Beat 8 bis 22),
           Negativ-Kontrolle geladen, nicht gestartet, Fader offen (Beat 24 bis 31), Start bei Beat 32 auf Quell-Beat 0;
           jeder Klick auf dem erwarteten Sample nach dem Versatz des Prüfklicks, Drift 0 (03 Probe 4a).
  m8       Laden im Spiel (M8): Deck 1 klickt, Deck 2 lädt eine Fassung mit --mib MiB (Vorgabe 3072), startet und liest
           je 16 Beats am Anfang, in der Mitte und am Ende der Datei; Frame-Lücken des Kerns und Seitenfehler des
           Callback-Fadens (/proc/<pid>/task/<tid>/stat) vor, während und nach; danach Deck 3 mit 4 200 MiB (dünn)
           -> budget_speicher (10 Probe d).
           --echt MATERIAL:FASSUNG (Plan 31 Nachtrag N4, Task 13a): Deck 2 lädt statt der erzeugten Datei eine echte
           Fassung aus bestand/, vorher mit dem Kopierschritt der MVP-Oberfläche (djk/oberflaeche/arbeitsbestand.ts,
           Form 36 F2: Größe und sha256 beim Kopieren, rename) in den Arbeitsbestand der Prüfinstanz gebracht; der
           Budget-Teil (Deck 3) entfällt. --ohne-laden: Negativ-Kontrolle, Deck 1 klickt allein über dieselbe Dauer.
  stems    vier Stems gegen die Offline-Summe: Deck 1 mit Stems (Beat 16 bis 32), Deck 2 mit der Summe als Basis (Beat
           48 bis 64), Differenz der Aufnahme über 15 Beats; Positiv-Kontrolle Deck 1 noch einmal mit stem/vocals stumm.
  neustart Deck 1 klickt, kill -9 auf den Kern bei --abschuss-s Sekunden, sofortiger Neustart aus dem Zustand; danach
           Klicks auf demselben Versatz (±1 Sample), Stille am Ziel. --zusatz-mib N lädt vorher N MiB auf Deck 2 (das
           der neue Kern mit einblenden muss); die Dauer bis zum ersten Zyklus meldet der Kern selbst (Treiber-Frames).
  kosten   Callback-Kosten mit vier spielenden Decks (Deck 1 mit vier Stems, Decks 2 bis 4 Basis), alle Fader offen,
           --sekunden lang; Verteilung aus der Schlusszeile des Kerns (cb_p50/p99/p999/max, wie kosten25.sh aus 25);
           Zusage ARCHITEKTUR §7: p99,9 unter 1 067 µs, Maximum unter 2 667 µs bei Quantum 256.
Die Golden-Folgen laden und start_quell_beat fährt tests/ziel/lauf25.sh --laeufer tests/ziel/lauf31.py (Scheibe 25).

Aufruf: ziel_lauf.py --art klick --lauf k1 [--kern PROGRAMM] [--minuten 30] [--kern-arg ARG ...]
Umgebung: CYPHERDJ_INSTANZ (Strang A: a). Ergebnis: djk/kern/tests/deck/laeufe/<lauf>-<zeit>/ mit ergebnis.json.
Rückgabe: 0 alle Grenzen gehalten, 1 mindestens eine gerissen, 2 Aufbau oder Instrument unbrauchbar.
Das Echtzeit-Schloss hält der Aufrufer: flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" python3 ziel_lauf.py ...
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HIER = Path(__file__).resolve().parent
DJK = HIER.parents[2]
sys.path.insert(0, str(DJK / "vertrag"))
sys.path.insert(0, str(DJK / "pruefstand"))
import attrappe_leitstand as al  # noqa: E402
import messer  # noqa: E402

RATE = 48000
SPB = 22500          # Samples je Beat bei 128 BPM
STUMM = 1e-6         # §1.2: ≤ −120 dB


def instanz():
    i = os.environ.get("CYPHERDJ_INSTANZ", "")
    if len(i) != 1 or not "a" <= i <= "i":
        raise SystemExit("CYPHERDJ_INSTANZ setzen (Strang A: export CYPHERDJ_INSTANZ=a)")
    return i, ord(i) - 96


def last():
    return open("/proc/loadavg").read().split()[0]


class Aufbau:
    """Senke, Notbahn, Kern, Aufnehmer und Abonnent; räumt beim Verlassen alles weg (auch bei Fehlern)."""

    def __init__(self, ordner: Path, lauf: str, kern: str, kern_args: list[str], sekunden: float):
        self.o, self.lauf, self.kern_prog, self.kern_args, self.sek = ordner, lauf, kern, kern_args, sekunden
        self.i, self.k = instanz()
        self.senke = f"cypherdj-pruef-{self.i}-{lauf}"
        self.shm = Path(f"/dev/shm/cypherdj-{self.i}")
        self.ab = self.shm / "material"
        self.proc: dict[str, subprocess.Popen] = {}
        self.modul = None
        self.id = time.monotonic_ns()

    def starte(self, name, args, env=None):
        err = open(self.o / f"{name}.err", "a")
        self.proc[name] = subprocess.Popen(["pw-jack", "-p", "256", *args], stdout=subprocess.DEVNULL, stderr=err,
                                           env=env)
        return self.proc[name]

    def kern_starten(self):
        err = self.o / "kern.err"
        schon = err.stat().st_size if err.exists() else 0  # nach einem Neustart zählt nur die neue Ausgabe
        p = self.starte("kern", [self.kern_prog, "--konfig", str(self.o / "kern.toml"), "--master",
                                 f"{self.senke}:playback_F", "--cue", f"{self.senke}:playback_R", "--waechter-ms", "100",
                                 *self.kern_args])
        ende = time.monotonic() + 10
        while time.monotonic() < ende:
            if "läuft" in err.read_bytes()[schon:].decode(errors="replace"):
                return p
            if p.poll() is not None:
                break
            time.sleep(0.05)
        raise RuntimeError(f"Kern startet nicht: {(self.o / 'kern.err').read_text(errors='replace')[-800:]}")

    def __enter__(self):
        try:
            return self._aufbauen()
        except BaseException:
            self.__exit__()
            raise

    def _aufbauen(self):
        belegt = subprocess.run(["ss", "-uln"], capture_output=True, text=True).stdout
        for port in (47100 + 1000 * self.k, 47140 + 1000 * self.k):
            if f"127.0.0.1:{port} " in belegt:
                raise RuntimeError(f"UDP-Port {port} der Prüfinstanz {self.i} ist belegt (andere Session?)")
        for p in ("bus", "zustand"):  # frische Zeitachse dieser Prüfinstanz, nur wenn niemand sie hält
            f = self.shm / p
            if f.exists() and subprocess.run(["fuser", "-s", str(f)]).returncode != 0:
                f.unlink()
        self.ab.mkdir(parents=True, exist_ok=True)
        toml = (DJK / "konfig" / "kern.toml").read_text()
        toml = "\n".join("pruefmodus = true" if z.startswith("pruefmodus") else z for z in toml.splitlines())
        (self.o / "kern.toml").write_text(toml + "\n")
        self.modul = subprocess.run(["pactl", "load-module", "module-null-sink", f"sink_name={self.senke}", "channels=4",
                                     "channel_map=front-left,front-right,rear-left,rear-right",
                                     f"sink_properties=node.description={self.senke}"],
                                    capture_output=True, text=True, check=True).stdout.strip()
        for _ in range(50):
            if f"{self.senke}:playback_FL" in subprocess.run(["pw-link", "-i"], capture_output=True, text=True).stdout:
                break
            time.sleep(0.1)
        # Notbahn daneben am Treiber (ADR 016 Nachtrag, 10k), Kante am Kern-Port; ohne --cue führte sie nur 2 Ziele
        self.starte("notbahn", [str(DJK / "notbahn" / "build" / "cypherdj-notbahn"), "--master",
                                f"{self.senke}:playback_F", "--cue", f"{self.senke}:playback_R", "--daneben", "--kante",
                                f"cypherdj-kern-{self.i}:master_L"])
        self.kern_starten()
        self.starte("aufnehmer", [str(DJK / "kern" / "build" / "cypherdj-aufnehmer4"), "--quelle", self.senke, "--datei",
                                  str(self.o / "ziel.f32"), "--sekunden", str(self.sek), "--bereit",
                                  str(self.o / "aufnahme.bereit")])
        for _ in range(100):
            if (self.o / "aufnahme.bereit").exists():
                break
            time.sleep(0.05)
        self.abo = al.Kern(47100 + 1000 * self.k, 47140 + 1000 * self.k, "pruefstand", self.o / "abonnent.jsonl")
        if self.abo.verbinde() is None:
            raise RuntimeError("kein /k/willkommen")
        return self

    def __exit__(self, *_):
        try:
            if getattr(self, "abo", None):
                self.abo.schliesse()
        except Exception:  # noqa: BLE001
            pass
        for name in ("kern", "aufnehmer", "notbahn"):
            p = self.proc.get(name)
            if p and p.poll() is None:
                p.send_signal(signal.SIGTERM)
                try:
                    p.wait(10)
                except subprocess.TimeoutExpired:
                    p.kill()
        if self.modul:
            subprocess.run(["pactl", "unload-module", self.modul])
            self.modul = None

    # --- Befehle und Warten ------------------------------------------------------------------------------------
    def nid(self):
        self.id += 1
        return self.id

    def sende(self, adresse, typen, *werte):
        self.abo.schicke(adresse, typen, list(werte))

    def warte_sample(self, s, frist=7200):
        ende = time.monotonic() + frist
        while time.monotonic() < ende:
            self.abo.pumpe()
            j = self.abo.sample_jetzt()
            if j is not None and j >= s:
                return
        raise RuntimeError(f"Kern-Uhr erreicht Sample {s} nicht")

    def warte_beat(self, b):
        self.warte_sample(b * SPB)

    def quittung(self, i, status, frist=5.0):
        ende = time.monotonic() + frist
        while time.monotonic() < ende:
            self.abo.pumpe()
            for m in self.abo.eingang:
                if m.adresse == "/q" and m.werte[0] == i and m.werte[2] == status:
                    return m.werte
        return None

    def set_neu(self):
        i = self.nid()
        self.abo.eingang.clear()
        self.sende("/k/set/neu", ",hsd", i, "pruefstand", 128.0)
        if not self.quittung(i, 2):
            raise RuntimeError("/k/set/neu ohne Quittung gestartet")
        self.abo.uhr = None
        while self.abo.uhr is None:
            self.abo.pumpe()

    def laden(self, deck, mid, mit_stems=0, erwarte=3, frist=30.0, fassung=1):
        i = self.nid()
        self.sende("/k/deck/laden", ",hsisdii", i, "leitstand", deck, mid, 128.0, fassung, mit_stems)
        return self.quittung(i, erwarte, frist), i

    def teil(self, pfad, ab, wert):
        self.sende("/k/teil", ",hssisddfiiss", self.nid(), "pruefstand", "", 0, pfad, float(ab), 0.0, float(wert), 0, 1,
                   "", "")

    def start(self, deck, ab, quell):
        i = self.nid()
        self.sende("/k/deck/start", ",hssssiddi", i, "andreas", "", "", "", deck, float(ab), float(quell), 0)
        return i

    def stopp(self, deck, ab):
        i = self.nid()
        self.sende("/k/deck/stopp", ",hssssidi", i, "andreas", "", "", "", deck, float(ab), 1)
        return i

    def klick(self, kanal, an):
        self.sende("/test/klick", ",hssi", self.nid(), "pruefstand", kanal, an)

    def zustand_kern(self):
        """Letztes /zustand/kern: (generation, frame_luecken, cb_max_us)."""
        for m in reversed(self.abo.eingang):
            if m.adresse == "/zustand/kern":
                return m.werte[0], m.werte[3], m.werte[5]
        return None

    def cb_tid(self):
        for z in (self.o / "kern.err").read_text(errors="replace").splitlines():
            if "Callback-Faden" in z:
                return int(z.rsplit(" ", 1)[1])
        return None


def seitenfehler(pid, tid):
    """(minflt, majflt) eines Fadens (Felder 10 und 12 von /proc/<pid>/task/<tid>/stat)."""
    s = Path(f"/proc/{pid}/task/{tid}/stat").read_text()
    f = s[s.rindex(")") + 2:].split()
    return int(f[7]), int(f[9])


def gesperrt_kib(pid):
    """VmLck des Prozesses in KiB (Befund B4: Eigenbedarf des Kerns neben dem Material)."""
    for z in Path(f"/proc/{pid}/status").read_text().splitlines():
        if z.startswith("VmLck:"):
            return int(z.split()[1])
    return None


def klick_fassung(ab, mid, *args):
    r = subprocess.run([sys.executable, str(HIER / "klick_fassung.py"), "--ziel", str(ab), "--material-id", mid, *args],
                       capture_output=True, text=True, check=True)
    return [json.loads(z) for z in r.stdout.splitlines() if z.strip()]


# --- Auswertung ------------------------------------------------------------------------------------------------------
def aufnahme(o: Path):
    meta = json.loads((o / "ziel.f32.json").read_text())
    x = np.fromfile(o / "ziel.f32", dtype=np.float32)
    return x[: len(x) // 4 * 4].reshape(-1, 4), meta


def kern_sample_der_aufnahme(o: Path, meta) -> int | None:
    """Kern-Sample (Zeitachse ab /k/set/neu) des ersten Aufnahme-Frames. Aufnehmer und Kern laufen im selben Graphen:
    ein Block, der t ns nach dem ersten Aufnahme-Block beginnt, liegt round(t · 48 000 / 10⁹ / 256) · 256 Frames
    dahinter. Gerechnet über die ersten 2 s /uhr der neuen Zeitachse; alle müssen dasselbe ergeben (sonst None)."""
    t0 = meta["erster_mono_ns"]
    uhr = [json.loads(z)["werte"] for z in open(o / "abonnent.jsonl") if '"/uhr"' in z]
    i0 = next((i for i, w in enumerate(uhr) if w[0] == 0), None)
    if i0 is None:
        return None
    kand = {int(w[0]) - int(round((w[1] - t0) * RATE / 1e9 / 256.0)) * 256 for w in uhr[i0:i0 + 375]}
    return kand.pop() if len(kand) == 1 else None


def versaetze(x, s_a, soll):
    """Für jeden Einsatz der Aufnahme (Master links): Aufnahme-Index + s_a − nächster Soll-Einsatz (Kern-Samples)."""
    e = messer.einsaetze(x[:, 0], schwelle=0.05, ruhe=2000)
    soll = np.asarray(sorted(soll), dtype=np.int64)
    aus = []
    for i in e:
        s = int(i) + s_a
        j = int(np.searchsorted(soll, s))
        kand = [soll[k] for k in (j - 1, j) if 0 <= k < len(soll)]
        if not kand:
            continue
        n = min(kand, key=lambda v: abs(v - s))
        if abs(n - s) < 5000:
            aus.append((int(i), int(n), s - int(n)))
    return aus


def art_klick(a: Aufbau, arg) -> dict:
    beats = int(math.ceil(arg.minuten * 60 * 128 / 60.0)) + 8
    klick_fassung(a.ab, "c1c0000000000031", "--beats", str(beats))
    a.set_neu()
    q, _ = a.laden(1, "c1c0000000000031")
    if not q:
        raise RuntimeError("Laden der Klick-Fassung ohne Quittung fertig")
    a.teil("deck/1/fader", 4.0, 0.0)
    a.warte_beat(6)
    a.klick("deck/1", 1)       # Z1: ab dem nächsten Schlag (Beat 7 oder 8)
    a.warte_beat(21.5)
    a.klick("deck/1", 0)
    a.warte_beat(30)
    s1 = a.start(1, 32.0, 0.0)
    ende_beat = 32 + int(arg.minuten * 128)
    a.warte_beat(ende_beat)
    a.stopp(1, ende_beat + 1.0)
    a.warte_beat(ende_beat + 3)
    start = a.quittung(s1, 2, 1.0)
    return {"start_quittung": start, "ende_beat": ende_beat, "zustand_kern_ende": a.zustand_kern()}


def werte_klick(o: Path, lauf: dict) -> tuple[dict, int]:
    x, meta = aufnahme(o)
    s_a = kern_sample_der_aufnahme(o, meta)
    zk = lauf.get("zustand_kern_ende")
    erg = {"aufnahme_frames": int(x.shape[0]), "aufnahme_luecken": meta["luecken"], "kern_sample_erster": s_a,
           "kern_frame_luecken": zk[1] if zk else None}
    if s_a is None:
        erg["fehler"] = "Zuordnung Aufnahme ↔ Kern nicht eindeutig"
        return erg, 2
    ende = lauf["ende_beat"]
    pruef = [b * SPB for b in range(7, 22)]                      # Z1 Beats 7 bis 21 (abgeschaltet vor 22)
    deck = [32 * SPB + q * SPB for q in range(0, ende - 32)]     # Quell-Beat q bei Beat 32 + q (§13.1, §4.4)
    vp = [v for v in versaetze(x, s_a, pruef) if v[1] < 22 * SPB]
    vd = [v for v in versaetze(x, s_a, deck) if 32 * SPB <= v[1] < ende * SPB]
    erg["pruefklick_anzahl"] = len(vp)
    erg["deck_klicks_anzahl"] = len(vd)
    erg["deck_klicks_soll"] = len(deck)
    if not vp or not vd:
        erg["fehler"] = "keine Klicks"
        return erg, 2
    L = int(np.median([v[2] for v in vp]))
    d = np.array([v[2] for v in vd])
    werte, zahl = np.unique(d, return_counts=True)
    erg["versatz_pruefklick"] = L
    erg["versatz_pruefklick_streuung"] = int(max(abs(v[2] - L) for v in vp))
    erg["versatz_deck_haeufigkeit"] = {int(w): int(n) for w, n in zip(werte, zahl)}
    erg["versatz_deck_min"], erg["versatz_deck_max"] = int(d.min()), int(d.max())
    erg["drift_samples"] = int(d[-1] - d[0])
    erg["dauer_s"] = round((vd[-1][1] - vd[0][1]) / RATE, 1)
    # Negativ-Kontrolle: geladen, nicht gestartet, Fader offen (Beat 24 bis 31)
    i0, i1 = 24 * SPB - s_a, 31 * SPB - s_a
    erg["ruhe_spitze"] = float(np.max(np.abs(x[max(i0, 0):max(i1, 0), :2]))) if i1 > 0 else None
    if meta["luecken"] != 0 or not zk or zk[1] != 0:
        # eine Lücke verschiebt Aufnahme gegen Kern um einen Block: dann misst der Versatz den Graphen, nicht das Deck
        erg["fehler"] = "Lücken im Graphen: Lauf ungültig, auf ruhiger Maschine wiederholen (M10)"
        return erg, 2
    grenzen = {"jeder_klick_auf_dem_sample": erg["versatz_deck_min"] == L == erg["versatz_deck_max"],
               "keiner_fehlt": len(vd) == len(deck), "drift_0": erg["drift_samples"] == 0,
               "ruhe_unter_120db": erg["ruhe_spitze"] is not None and erg["ruhe_spitze"] <= STUMM}
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


def in_arbeitsbestand(ab: Path, mid: str, fassung: int) -> dict:
    """Kopierschritt der MVP-Oberfläche (60m, djk/oberflaeche/arbeitsbestand.ts inArbeitsbestand): bestand/ -> ab."""
    js = ("import { inArbeitsbestand } from %s; const r = await inArbeitsbestand(%s, %s, %s, 128, %d); "
          "console.log(JSON.stringify(r));") % (json.dumps(str(DJK / "oberflaeche" / "arbeitsbestand.ts")),
                                               json.dumps(str(DJK.parent / "bestand")), json.dumps(str(ab)),
                                               json.dumps(mid), fassung)
    r = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Kopierschritt {mid} r{fassung}: {(r.stdout + r.stderr).strip()[-400:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def art_m8(a: Aufbau, arg) -> dict:
    klick_fassung(a.ab, "c1c0000000000081", "--beats", "256")
    t = time.monotonic()
    kopie = None
    if arg.echt:
        mid2, fas2 = arg.echt.split(":")[0], int(arg.echt.split(":")[1])
        kopie = in_arbeitsbestand(a.ab, mid2, fas2)
        g = json.loads((Path(kopie["ordner"]) / "fassung.json").read_text())
    else:
        mid2, fas2 = "c1c0000000000082", 1
        [g] = klick_fassung(a.ab, mid2, "--beats", "8", "--mib", str(arg.mib))
        klick_fassung(a.ab, "c1c0000000000083", "--mib", "4200", "--duenn")
    erz_s = time.monotonic() - t
    a.set_neu()
    if not a.laden(1, "c1c0000000000081")[0]:
        raise RuntimeError("Deck 1 lädt nicht")
    a.teil("deck/1/fader", 4.0, 0.0)
    a.start(1, 8.0, 0.0)
    pid, tid = a.proc["kern"].pid, a.cb_tid()  # pw-jack endet mit exec: die PID ist die des Kerns
    a.warte_beat(16)
    z0, f0, v0 = a.zustand_kern(), seitenfehler(pid, tid), gesperrt_kib(pid)
    t_laden = time.monotonic()
    if arg.ohne_laden:  # Negativ-Kontrolle: Deck 1 klickt allein über dieselbe Dauer, nichts wird geladen
        q = None
        a.warte_sample(a.abo.sample_jetzt() + 2 * SPB)
    else:
        q, lid = a.laden(2, mid2, frist=120.0, fassung=fas2)
    laden_s = time.monotonic() - t_laden
    z1, f1 = a.zustand_kern(), seitenfehler(pid, tid)
    # Deck 2 liest je 16 Beats am Anfang, in der Mitte und am Ende der Datei (Fader zu: gelesen wird trotzdem);
    # Quell-Beat 0 ist der erste Schlag (§13.1), der Dateianfang liegt bei −erster_schlag_frame / SPB
    q_anf = -g.get("erster_schlag_frame", 0) / SPB
    q_ende = q_anf + g["frames"] / SPB
    s2 = math.ceil(a.abo.sample_jetzt() / SPB) + 4
    if not arg.ohne_laden:
        for n, q0 in enumerate((math.ceil(q_anf), math.floor((q_anf + q_ende) / 2), math.floor(q_ende) - 20)):
            a.start(2, float(s2 + 16 * n), float(q0))
    a.warte_beat(s2 + 48 + 2)
    z2, f2, v2 = a.zustand_kern(), seitenfehler(pid, tid), gesperrt_kib(pid)
    q_budget = None
    if not arg.echt and not arg.ohne_laden:
        q_budget, bid = a.laden(3, "c1c0000000000083", erwarte=6, frist=10.0)
    if kopie and kopie.get("kopiert"):
        shutil.rmtree(Path(kopie["ordner"]).parent.parent, ignore_errors=True)  # die eigene Kopie wieder weg
    return {"erzeugen_s": round(erz_s, 1), "mib": None if arg.echt else arg.mib, "frames": g["frames"],
            "echt": arg.echt, "kopie": kopie, "ohne_laden": arg.ohne_laden, "laden_s": round(laden_s, 3),
            "laden_quittung_fertig": q is not None, "kern_pid": pid, "cb_tid": tid,
            "zustand_kern": {"vorher": z0, "nach_laden": z1, "nach_lesen": z2},
            "seitenfehler": {"vorher": f0, "nach_laden": f1, "nach_lesen": f2},
            "budget_4200": q_budget[5] if q_budget else None,
            "vmlck_kib": {"deck_1_geladen": v0, "nach_laden_und_lesen": v2}}


def werte_m8(o: Path, lauf: dict) -> tuple[dict, int]:
    f0, f1, f2 = (lauf["seitenfehler"][k] for k in ("vorher", "nach_laden", "nach_lesen"))
    z0, z1, z2 = (lauf["zustand_kern"][k] for k in ("vorher", "nach_laden", "nach_lesen"))
    erg = dict(lauf)
    erg["seitenfehler_beim_laden"] = (f1[0] - f0[0]) + (f1[1] - f0[1])
    erg["seitenfehler_beim_lesen"] = (f2[0] - f1[0]) + (f2[1] - f1[1])
    erg["frame_luecken_laden_und_lesen"] = (z2[1] - z0[1]) if z0 and z2 and z0[0] == z2[0] else None
    grenzen = {"laden_fertig": lauf["laden_quittung_fertig"] or bool(lauf.get("ohne_laden")),
               "luecken_0": erg["frame_luecken_laden_und_lesen"] == 0,
               "seitenfehler_0": erg["seitenfehler_beim_laden"] == 0 and erg["seitenfehler_beim_lesen"] == 0}
    if not lauf.get("echt") and not lauf.get("ohne_laden"):
        grenzen["budget_speicher_bei_4200"] = lauf["budget_4200"] == "budget_speicher"
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


def art_stems(a: Aufbau, arg) -> dict:
    klick_fassung(a.ab, "c1c0000000000051", "--beats", "40", "--stems", "--summe-als", "c1c0000000000052")
    a.set_neu()
    ok1 = a.laden(1, "c1c0000000000051", mit_stems=1)[0]
    ok2 = a.laden(2, "c1c0000000000052", mit_stems=0)[0]
    if not (ok1 and ok2):
        raise RuntimeError("Stems oder Summe laden nicht")
    a.teil("deck/1/fader", 4.0, 0.0)
    a.teil("deck/2/fader", 4.0, 0.0)
    a.warte_beat(10)
    a.start(1, 16.0, 0.0)
    a.stopp(1, 32.0)
    a.warte_beat(44)
    a.start(2, 48.0, 0.0)
    a.stopp(2, 64.0)
    a.teil("deck/1/stem/vocals", 70.0, -200.0)  # Positiv-Kontrolle: vocals stumm
    a.warte_beat(76)
    a.start(1, 80.0, 0.0)
    a.stopp(1, 96.0)
    a.warte_beat(98)
    return {}


def werte_stems(o: Path, lauf: dict) -> tuple[dict, int]:
    x, meta = aufnahme(o)
    s_a = kern_sample_der_aufnahme(o, meta)
    if s_a is None:
        return {"fehler": "keine Zuordnung Aufnahme ↔ Kern"}, 2
    lang = 15 * SPB
    seg = lambda b: x[b * SPB - s_a: b * SPB - s_a + lang + 2048, :2].astype(np.float64)  # noqa: E731
    p1, p2, p3 = seg(16), seg(48), seg(80)
    erg = {"spitze": float(np.max(np.abs(p1))), "diff_stems_summe": float(np.max(np.abs(p1 - p2))),
           "diff_vocals_stumm": float(np.max(np.abs(p1 - p3))), "aufnahme_luecken": meta["luecken"]}
    erg["bitgleich"] = erg["diff_stems_summe"] == 0.0
    erg["diff_stems_summe_db"] = None if erg["bitgleich"] else 20 * math.log10(erg["diff_stems_summe"])
    if meta["luecken"] != 0:  # eine Lücke verschiebt die Phasen gegeneinander: Vergleich ungültig
        erg["fehler"] = "Lücken im Graphen: Lauf ungültig, wiederholen"
        return erg, 2
    grenzen = {"signal_da": erg["spitze"] > 0.05, "summe_unter_120db": erg["diff_stems_summe"] <= STUMM,
               "positiv_kontrolle": erg["diff_vocals_stumm"] > 0.01}
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


def art_neustart(a: Aufbau, arg) -> dict:
    klick_fassung(a.ab, "c1c0000000000091", "--beats", "256")
    if arg.zusatz_mib:
        klick_fassung(a.ab, "c1c0000000000092", "--beats", "8", "--mib", str(arg.zusatz_mib))
    a.set_neu()
    if not a.laden(1, "c1c0000000000091")[0]:
        raise RuntimeError("Deck 1 lädt nicht")
    if arg.zusatz_mib and not a.laden(2, "c1c0000000000092", frist=120.0)[0]:
        raise RuntimeError("Deck 2 lädt das Zusatz-Material nicht")
    a.teil("deck/1/fader", 4.0, 0.0)
    a.warte_beat(6)
    a.klick("deck/1", 1)
    a.warte_beat(21.5)
    a.klick("deck/1", 0)
    a.start(1, 32.0, 0.0)
    a.warte_sample(32 * SPB + arg.abschuss_s * RATE)
    t_kill = time.monotonic_ns()
    a.proc["kern"].send_signal(signal.SIGKILL)
    a.proc["kern"].wait()
    a.kern_starten()
    t_neu = time.monotonic_ns()
    a.warte_sample(32 * SPB + (arg.abschuss_s + 20) * RATE)
    return {"kill_mono_ns": t_kill, "neu_mono_ns": t_neu, "abschuss_s": arg.abschuss_s, "zusatz_mib": arg.zusatz_mib}


def werte_neustart(o: Path, lauf: dict) -> tuple[dict, int]:
    """Fenster 5 s vor bis 10 s nach dem Abschuss: jeder Klick des Decks da und auf dem Versatz des Prüfklicks
    (±1 Sample, ARCHITEKTUR §7 Raster ≤ 1 Sample); Lücken des Kerns im Fenster (/e/luecke) machen den Lauf ungültig.
    Stille misst der Klick selbst: ein fehlender Klick im Fenster ist die Stille (das Material ist zwischen den
    Schlägen still, ein Stille-Messer auf Dauersignal passt hier nicht)."""
    x, meta = aufnahme(o)
    s_a = kern_sample_der_aufnahme(o, meta)
    if s_a is None:
        return {"fehler": "keine Zuordnung Aufnahme ↔ Kern"}, 2
    t0 = meta["erster_mono_ns"]
    i_kill = int((lauf["kill_mono_ns"] - t0) * RATE / 1e9)
    von, bis = i_kill - 5 * RATE + s_a, i_kill + 10 * RATE + s_a      # in Kern-Samples der Zeitachse
    pruef = [b * SPB for b in range(7, 22)]
    deck = [32 * SPB + q * SPB for q in range(0, 256)]
    vp = [v for v in versaetze(x, s_a, pruef) if v[1] < 22 * SPB]
    L = int(np.median([v[2] for v in vp])) if vp else None
    soll = [s for s in deck if von <= s < bis]
    im = [v for v in versaetze(x, s_a, deck) if von <= v[1] < bis]
    luecken = [json.loads(z)["werte"] for z in open(o / "abonnent.jsonl") if '"/e/luecke"' in z]
    erg = {"versatz_pruefklick": L, "klicks_im_fenster": len(im), "klicks_soll": len(soll),
           "abw_max": max((abs(v[2] - L) for v in im), default=None) if L is not None else None,
           "neustart_ms": round((lauf["neu_mono_ns"] - lauf["kill_mono_ns"]) / 1e6, 1),
           "kern_luecken_im_lauf": len(luecken), "aufnahme_luecken": meta["luecken"]}
    # ARCHITEKTUR §7 „Kern wieder hörbar ≤ 250 ms samt Material“: Ausfall vom letzten Anker bis zum ersten Zyklus des
    # neuen Kerns in Treiber-Frames, wie der Kern selbst ihn meldet (main.cpp „fortgesetzt auf dem Anker“)
    fort = [z for z in (o / "kern.err").read_text(errors="replace").splitlines() if "fortgesetzt auf dem Anker" in z]
    d = int(fort[-1].split(" Frames laut Treiber")[0].rsplit(" ", 1)[1]) if fort else None
    erg["ausfall_ms_treiber"] = round(d / 48.0, 1) if d is not None else None
    erg["zusatz_mib"] = lauf.get("zusatz_mib", 0)
    grenzen = {"jeder_klick_da": len(im) == len(soll) and len(soll) >= 30,
               "raster_1_sample": erg["abw_max"] is not None and erg["abw_max"] <= 1,
               "wieder_da_250ms": d is not None and d <= 250 * 48}
    erg["grenzen"] = grenzen
    if all(grenzen.values()) and any(von <= w[0] < bis for w in luecken):
        erg["fehler"] = "Lücke des Kerns im Fenster: grün, aber ungültig, wiederholen"
        return erg, 2
    return erg, 0 if all(grenzen.values()) else 1


def art_kosten(a: Aufbau, arg) -> dict:
    beats = int(arg.sekunden * 128 / 60) + 64
    klick_fassung(a.ab, "c1c00000000000b1", "--beats", str(beats), "--stems", "--summe-als", "c1c00000000000b2")
    for n in (3, 4):
        klick_fassung(a.ab, f"c1c00000000000b{n}", "--beats", str(beats))
    a.set_neu()
    for d, mid, st in ((1, "c1c00000000000b1", 1), (2, "c1c00000000000b2", 0), (3, "c1c00000000000b3", 0),
                       (4, "c1c00000000000b4", 0)):
        if not a.laden(d, mid, mit_stems=st)[0]:
            raise RuntimeError(f"Deck {d} lädt nicht")
        a.teil(f"deck/{d}/fader", 4.0, -6.0)
        a.start(d, 8.0, 0.0)
    a.warte_beat(8)
    t0 = time.monotonic()
    a.warte_sample(8 * SPB + arg.sekunden * RATE)
    zustand = [m.werte for m in a.abo.eingang if m.adresse == "/zustand/deck" and m.werte[1] == 2]
    return {"sekunden": arg.sekunden, "wand_s": round(time.monotonic() - t0, 1),
            "decks_laufend": sorted({w[0] for w in zustand})}


def werte_kosten(o: Path, lauf: dict) -> tuple[dict, int]:
    z = [x for x in (o / "kern.err").read_text(errors="replace").splitlines() if x.startswith('{"zyklen"')]
    if not z:
        return {"fehler": "keine Schlusszeile des Kerns"}, 2
    erg = dict(lauf, **json.loads(z[-1]))
    grenzen = {"vier_decks_liefen": erg.get("decks_laufend") == [1, 2, 3, 4],
               "p999_unter_1067": erg["cb_p999_us"] < 1067, "max_unter_2667": erg["cb_max_us"] < 2667}
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


ARTEN = {"kosten": (art_kosten, werte_kosten), "klick": (art_klick, werte_klick), "m8": (art_m8, werte_m8), "stems": (art_stems, werte_stems),
         "neustart": (art_neustart, werte_neustart)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Abnahme der Scheibe 31 am Ziel (stumm)")
    ap.add_argument("--art", required=True, choices=sorted(ARTEN))
    ap.add_argument("--lauf", required=True)
    ap.add_argument("--kern", default=str(DJK / "kern" / "build" / "cypherdj-kern"))
    ap.add_argument("--kern-arg", action="append", default=[])
    ap.add_argument("--minuten", type=float, default=30.0)
    ap.add_argument("--mib", type=int, default=3072)
    ap.add_argument("--abschuss-s", type=int, default=20)
    ap.add_argument("--zusatz-mib", type=int, default=0)
    ap.add_argument("--sekunden", type=int, default=60, help="kosten: Dauer mit vier spielenden Decks")
    ap.add_argument("--echt", default="", help="m8: MATERIAL:FASSUNG aus bestand/ statt erzeugter Datei (Task 13a)")
    ap.add_argument("--ohne-laden", action="store_true", help="m8: Negativ-Kontrolle ohne Laden")
    ap.add_argument("--nur-auswerten")
    a = ap.parse_args(argv)
    lauf_fn, werte_fn = ARTEN[a.art]
    if a.nur_auswerten:
        o = Path(a.nur_auswerten)
        lauf = json.loads((o / "lauf.json").read_text())
    else:
        o = HIER / "laeufe" / f"{a.lauf}-{time.strftime('%Y%m%d-%H%M%S')}"
        o.mkdir(parents=True)
        sek = {"klick": a.minuten * 60 + 60, "m8": 150, "stems": 60, "neustart": a.abschuss_s + 60,
               "kosten": a.sekunden + 30}[a.art]
        lauf = {"art": a.art, "lauf": a.lauf, "kern": a.kern, "kern_args": a.kern_arg, "last_vorher": last(),
                "start": time.strftime("%Y-%m-%dT%H:%M:%S")}
        try:
            with Aufbau(o, a.lauf, a.kern, a.kern_arg, sek) as auf:
                lauf.update(lauf_fn(auf, a))
                ab = auf.ab
        except Exception as e:  # noqa: BLE001
            lauf["fehler"] = repr(e)
            (o / "lauf.json").write_text(json.dumps(lauf, indent=1, ensure_ascii=False))
            print(f"Aufbau gescheitert: {e!r} ({o})", file=sys.stderr)
            return 2
        lauf["last_nachher"] = last()
        for p in ab.glob("c1c00000000000*"):  # eigenes Material wieder weg (die 3 GiB belegen RAM)
            shutil.rmtree(p, ignore_errors=True)
        (o / "lauf.json").write_text(json.dumps(lauf, indent=1, ensure_ascii=False, default=str))
    erg, rc = werte_fn(o, lauf)
    erg.update({"art": a.art, "lauf": a.lauf, "ordner": str(o), "last_vorher": lauf.get("last_vorher"),
                "last_nachher": lauf.get("last_nachher"), "rueckgabe": rc})
    (o / "ergebnis.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False, default=str))
    print(json.dumps(erg, ensure_ascii=False, default=str))
    return rc


if __name__ == "__main__":
    sys.exit(main())
