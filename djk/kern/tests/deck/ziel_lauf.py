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
  keylock  Keylock Task 4.2: --material klick (Klick-Fassung), sinus (Sinus links, Klick rechts) oder sinusrein (Sinus
           1000 Hz auf beiden Kanälen); Start Beat 32 bei 128, Rampe 128 -> 132 ab Beat 48 über 32 Beats, bis Beat 112.
           Lage je Klick (Korrelation, Teil-Sample) gegen das Ideal ±12, auf der Basis 0 (Direktweg), Mittel ausgewiesen;
           Tonhöhe je 100 ms ±2 ct, Null-Läufe 0; Ring hörbar und Zähler aus /zustand/deck. --keylock-aus: Regler keylock 0
           über teil() (Fehlerfall: +53,27 ct nach der Rampe). --bezug ORDNER: je Klick gegen diesen Varispeed-Lauf ±12.
  drums    Keylock Task 4.2: echter Drum-Loop (--drum-wav, Raster --drum-bpm) auf Basis 128 gebracht, bei --bpm: Durchgang
           auf der Basis (misst die Kette), Keylock an, Keylock aus; Lage der Transienten (über 2 kHz, Güte ≥ 0,8) gegen
           die Quelle durch die Kette und gegen den Varispeed-Bezug, Mittel und Spannweite ausgewiesen.
  keylock4 Keylock Task 4.3: vier Decks im Keylock (Deck 1 mit vier Stems), Tempo nie auf der Basis, alle 64 Beats eine
           Rampe, --sekunden lang: Unterläufe und Aufgaben 0 je Deck, Ring hörbar, frame_luecken 0, cb_max_us ≤ 2500.
  hoerprobe Keylock Task 4.5: echter Track (--echt, --bestand, --quell), Rampe 128 -> 136; schreibt hoerprobe.wav.
Die Golden-Folgen laden und start_quell_beat fährt tests/ziel/lauf25.sh --laeufer tests/ziel/lauf31.py (Scheibe 25).

Aufruf: ziel_lauf.py --art klick --lauf k1 [--kern PROGRAMM] [--minuten 30] [--kern-arg ARG ...]
Umgebung: CYPHERDJ_INSTANZ (Strang A: a). Ergebnis: djk/kern/tests/deck/laeufe/<lauf>-<zeit>/ mit ergebnis.json.
Rückgabe: 0 alle Grenzen gehalten, 1 mindestens eine gerissen, 2 Aufbau oder Instrument unbrauchbar (auch: Aufnahme mit
Spitze 0 auf allen Kanälen, blind(); Quittung 4 oder 6 auf einen eigenen Befehl, abweisungen(); Task 4.1).
Das Echtzeit-Schloss hält der Aufrufer: flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" python3 ziel_lauf.py ...
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
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


# Umbauplan Bungee S2: Maschine des Keylocks (kern.toml keylock_maschine) und die Hilfsprogramme der Prüfinstanz, wenn sie nicht
# unter DJK/kern/build bzw. DJK/notbahn/build liegen (Arbeitsbaum mit eigenem Bau-Ordner). Gesetzt in main() aus den Argumenten.
OPT = {"maschine": "", "aufnehmer": "", "notbahn": ""}


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
        # Task 4.2: Last neben jede Zahl (vmstat je Sekunde über den ganzen Lauf, kein JACK, kein Ton)
        self.vmstat = subprocess.Popen(["vmstat", "-n", "-t", "1"], stdout=open(self.o / "vmstat.txt", "w"),
                                       stderr=subprocess.DEVNULL, env={**os.environ, "LC_ALL": "C"})
        toml = (DJK / "konfig" / "kern.toml").read_text()
        toml = "\n".join("pruefmodus = true" if z.startswith("pruefmodus") else z for z in toml.splitlines())
        if OPT["maschine"]:
            toml += f'\nkeylock_maschine = "{OPT["maschine"]}"'
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
        self.starte("notbahn", [OPT["notbahn"] or str(DJK / "notbahn" / "build" / "cypherdj-notbahn"), "--master",
                                f"{self.senke}:playback_F", "--cue", f"{self.senke}:playback_R", "--daneben", "--kante",
                                f"cypherdj-kern-{self.i}:master_L"])
        self.kern_starten()
        self.starte("aufnehmer", [OPT["aufnehmer"] or str(DJK / "kern" / "build" / "cypherdj-aufnehmer4"), "--quelle", self.senke, "--datei",
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
        if getattr(self, "vmstat", None) and self.vmstat.poll() is None:
            self.vmstat.terminate()
            self.vmstat.wait(5)

    # --- Befehle und Warten ------------------------------------------------------------------------------------
    def nid(self):
        self.id += 1
        return self.id

    def sende(self, adresse, typen, *werte):
        self.abo.schicke(adresse, typen, list(werte))

    def merke(self, i, was):
        """Eigener Befehl, dessen Abweisung den Lauf beenden muss (abweisungen)."""
        self.__dict__.setdefault("eigene", {})[i] = was
        return i

    def abweisungen(self):
        """Task 4.1: Quittung 4 (verspätet verworfen) oder 6 (abgelehnt) auf einen eigenen Befehl ist ein Aufbaufehler.
        Vorher blieb sie ungelesen: Lauf w3k-20261006-210207 lief mit abgelehntem Fader (6 kein_hoerschein) stumm
        durch. Liest den Eingang ab der zuletzt gelesenen Stelle; set_neu ersetzt ihn, dann von vorn."""
        eigene, ein = self.__dict__.get("eigene", {}), self.abo.eingang
        k = self.__dict__.get("gelesen", 0)
        if k > len(ein):
            k = 0
        for m in ein[k:]:
            if m.adresse == "/q" and len(m.werte) > 5 and m.werte[0] in eigene and m.werte[2] in (4, 6):
                raise RuntimeError(f"{eigene[m.werte[0]]} abgewiesen: Quittung {m.werte[2]} {m.werte[5]!r} "
                                   f"bei Sample {m.werte[3]}")
        self.gelesen = len(ein)

    def warte_sample(self, s, frist=7200):
        ende = time.monotonic() + frist
        while time.monotonic() < ende:
            self.abo.pumpe()
            self.abweisungen()
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
        self.__dict__.setdefault("inhalt", {})[deck] = f"{mid}/128000_r{fassung}"  # §4.5 inhalt, Basis 128 wie unten
        self.sende("/k/deck/laden", ",hsisdii", i, "leitstand", deck, mid, 128.0, fassung, mit_stems)
        return self.quittung(i, erwarte, frist), i

    def hoerschein(self, deck, ab):
        """Task 4.1b: Hörschein der Prüfinstanz für deck/<n> (§4.5 /k/hoerschein, I3a §17). Seit Ohr T14 (28.09.) lehnt
        der Kern einen Fader, der einen Deck-Kanal öffnet, ohne gültigen Hörschein ab (Quittung 6 kein_hoerschein);
        ohne ihn blieb jeder Fader zu, die Aufnahme exakt 0 (Lauf w3k-20261006-210207). Der Kern prüft beim Öffnen nur
        Kanal, inhalt, gueltig_bis_beat, Tempo (±0,5 %) und die Quellposition in [quell_von, quell_bis + 64]
        (kern_stellwerk.cpp Befehl::HOERSCHEIN). Der Inhalt ist hier die selbst erzeugte Klick-Fassung, Sample für Sample
        bekannt, keine Vorhör-Messung: Quelle pruefstand, hs_id pruefstand-*, die Messfelder sync_ms, pegel_diff_db,
        lufs_kurz NaN (nicht gemessen), Bereich die ganze Fassung. Vorbild: Ohr T14 Step 5 (djk/hand/tests/
        durchstich_i3.mjs, handgemachter Schein an der Prüfinstanz)."""
        inhalt = self.__dict__.get("inhalt", {}).get(deck)
        if inhalt is None:
            raise RuntimeError(f"Hörschein für deck/{deck}: kein geladener Inhalt")
        i, hs = self.nid(), f"pruefstand-{self.lauf}-deck{deck}"
        nan = float("nan")
        self.sende("/k/hoerschein", ",hsssssddddfff", i, "pruefstand", hs, f"deck/{deck}", inhalt, "ok", 128.0,
                   float(ab) + 64.0, 0.0, 1e9, nan, nan, nan)
        if not self.quittung(i, 3):
            raise RuntimeError(f"/k/hoerschein {hs} {inhalt} ohne Quittung 3")
        return hs

    def teil(self, pfad, ab, wert):
        # Öffnet der Teil einen Deck-Kanal (Fader oder Trim, I3a), geht er mit einem Hörschein der Prüfinstanz; Quelle
        # bleibt pruefstand (kein Auftritt als andreas, Task 4.1b). Schließen und Stem-Regler brauchen keinen.
        m = re.fullmatch(r"deck/([1-4])/(fader|trim)", pfad)
        hs = self.hoerschein(int(m.group(1)), ab) if m and wert > -200.0 else ""
        i = self.merke(self.nid(), f"/k/teil {pfad} ab Beat {ab}")
        self.sende("/k/teil", ",hssisddfiiss", i, "pruefstand", "", 0, pfad, float(ab), 0.0, float(wert), 0, 1, "", hs)

    def start(self, deck, ab, quell):
        i = self.merke(self.nid(), f"/k/deck/start Deck {deck} ab Beat {ab}")
        # Task 4.2: Quelle pruefstand wie alle eigenen Befehle (DECK_START ist kein nur_hand-Regler, quelle_ok nimmt
        # jede der sechs Quellen, netz_deck.cpp:22; vorher stand hier andreas)
        self.sende("/k/deck/start", ",hssssiddi", i, "pruefstand", "", "", "", deck, float(ab), float(quell), 0)
        return i

    def stopp(self, deck, ab):
        i = self.merke(self.nid(), f"/k/deck/stopp Deck {deck} ab Beat {ab}")
        self.sende("/k/deck/stopp", ",hssssidi", i, "pruefstand", "", "", "", deck, float(ab), 1)
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
def blind(o: Path) -> str | None:
    """Task 4.1: jede Art lässt mindestens ein Deck mit offenem Fader spielen; eine Aufnahme mit Spitze 0 auf allen vier
    Kanälen heißt, das Instrument hat nichts gesehen (Fader abgelehnt, Senke falsch verdrahtet), nicht: Grenze gehalten.
    Ohne Aufnahme ebenso. Liest abschnittweise (30 min sind 1,4 GB)."""
    f = o / "ziel.f32"
    if not f.exists() or f.stat().st_size < 16:
        return "Instrument blind: keine Aufnahme"
    x = np.memmap(f, dtype=np.float32, mode="r")
    n = len(x) // 4 * 4
    spitze = 0.0
    for i in range(0, n, 4 * RATE * 60):
        spitze = max(spitze, float(np.max(np.abs(x[i:min(i + 4 * RATE * 60, n)]))))
        if spitze > STUMM:
            return None
    return f"Instrument blind: Spitze {spitze:g} auf allen vier Kanälen über {n // 4} Frames"


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


def erstes_nicht_still(x, s_a, von, bis):
    """Erstes Kern-Sample in [von, bis) mit |Master links| > STUMM (None: keins). Einblende-fest (F10, Welle 2): das erste
    Sample der Einblende trägt 1/DECK_START_EIN des Materials, ist also nicht still, wo das Material es nicht ist."""
    i0, i1 = max(von - s_a, 0), max(min(bis - s_a, x.shape[0]), 0)
    if i1 <= i0:
        return None
    idx = np.flatnonzero(np.abs(x[i0:i1, 0]) > STUMM)
    return int(idx[0]) + i0 + s_a if idx.size else None


def startsample_treue(x, s_a, beat=32):
    """Prüfung 2.3 Befund 6: Startsample-Treue am Ziel trotz Einblende. Der Startklick (Quell-Beat 0, Start aus dem Stand
    bei Beat `beat`) und der volle Klick einen Beat später werden mit demselben Maß gemessen (erstes nicht stilles Sample
    nach der Stille zwischen den Schlägen); beide Versätze gegen ihr Soll-Sample müssen gleich sein. Ein zu früher, zu
    später oder am Blockanfang liegender Start verschiebt nur den ersten."""
    a = erstes_nicht_still(x, s_a, beat * SPB - 1000, beat * SPB + 1000)
    b = erstes_nicht_still(x, s_a, (beat + 1) * SPB - 1000, (beat + 1) * SPB + 1000)
    return (None if a is None else a - beat * SPB), (None if b is None else b - (beat + 1) * SPB)


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
    deck = [32 * SPB + q * SPB for q in range(1, ende - 32)]     # Quell-Beat q bei Beat 32 + q (§13.1, §4.4)
    # F10 (Welle 2): der Klick am Startsample liegt in der Einblende (DECK_START_EIN), über die Schwelle gezählt ab dem
    # zweiten; das Startsample selbst misst startsample_treue (einblende-fest, Prüfung 2.3 Befund 6)
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
    erg["start_versatz"], erg["start_versatz_beat_danach"] = startsample_treue(x, s_a)
    if meta["luecken"] != 0 or not zk or zk[1] != 0:
        # eine Lücke verschiebt Aufnahme gegen Kern um einen Block: dann misst der Versatz den Graphen, nicht das Deck
        erg["fehler"] = "Lücken im Graphen: Lauf ungültig, auf ruhiger Maschine wiederholen (M10)"
        return erg, 2
    grenzen = {"jeder_klick_auf_dem_sample": erg["versatz_deck_min"] == L == erg["versatz_deck_max"],
               "keiner_fehlt": len(vd) == len(deck), "drift_0": erg["drift_samples"] == 0,
               "ruhe_unter_120db": erg["ruhe_spitze"] is not None and erg["ruhe_spitze"] <= STUMM,
               "start_auf_dem_sample": erg["start_versatz"] is not None and
               erg["start_versatz"] == erg["start_versatz_beat_danach"] == L}
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


def in_arbeitsbestand(ab: Path, mid: str, fassung: int, bestand: Path | None = None) -> dict:
    """Kopierschritt der MVP-Oberfläche (60m, djk/oberflaeche/arbeitsbestand.ts inArbeitsbestand): bestand/ -> ab.
    bestand: Vorgabe DJK.parent/bestand; in einem Worktree liegt der Bestand nur im Haupt-Checkout (Task 4.2, --bestand)."""
    js = ("import { inArbeitsbestand } from %s; const r = await inArbeitsbestand(%s, %s, %s, 128, %d); "
          "console.log(JSON.stringify(r));") % (json.dumps(str(DJK / "oberflaeche" / "arbeitsbestand.ts")),
                                               json.dumps(str(bestand or DJK.parent / "bestand")), json.dumps(str(ab)),
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
    # F10 (Welle 2): der Klick am Startsample liegt in der Einblende (DECK_START_EIN), über die Schwelle gezählt ab dem
    # zweiten; das Startsample selbst misst startsample_treue (einblende-fest, Prüfung 2.3 Befund 6)
    deck = [32 * SPB + q * SPB for q in range(1, 256)]
    vp = [v for v in versaetze(x, s_a, pruef) if v[1] < 22 * SPB]
    L = int(np.median([v[2] for v in vp])) if vp else None
    soll = [s for s in deck if von <= s < bis]
    im = [v for v in versaetze(x, s_a, deck) if von <= v[1] < bis]
    luecken = [json.loads(z)["werte"] for z in open(o / "abonnent.jsonl") if '"/e/luecke"' in z]
    erg = {"versatz_pruefklick": L, "klicks_im_fenster": len(im), "klicks_soll": len(soll),
           "abw_max": max((abs(v[2] - L) for v in im), default=None) if L is not None else None,
           "neustart_ms": round((lauf["neu_mono_ns"] - lauf["kill_mono_ns"]) / 1e6, 1),
           "kern_luecken_im_lauf": len(luecken), "aufnahme_luecken": meta["luecken"]}
    erg["start_versatz"], erg["start_versatz_beat_danach"] = startsample_treue(x, s_a)
    # ARCHITEKTUR §7 „Kern wieder hörbar ≤ 250 ms samt Material“: Ausfall vom letzten Anker bis zum ersten Zyklus des
    # neuen Kerns in Treiber-Frames, wie der Kern selbst ihn meldet (main.cpp „fortgesetzt auf dem Anker“)
    fort = [z for z in (o / "kern.err").read_text(errors="replace").splitlines() if "fortgesetzt auf dem Anker" in z]
    d = int(fort[-1].split(" Frames laut Treiber")[0].rsplit(" ", 1)[1]) if fort else None
    erg["ausfall_ms_treiber"] = round(d / 48.0, 1) if d is not None else None
    erg["zusatz_mib"] = lauf.get("zusatz_mib", 0)
    grenzen = {"jeder_klick_da": len(im) == len(soll) and len(soll) >= 30,
               "raster_1_sample": erg["abw_max"] is not None and erg["abw_max"] <= 1,
               "wieder_da_250ms": d is not None and d <= 250 * 48,
               "start_auf_dem_sample": erg["start_versatz"] is not None and
               erg["start_versatz"] == erg["start_versatz_beat_danach"] == L}
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


# --- Welle 3 (ADR 028): Deck folgt einer Tempo-Rampe im Varispeed ------------------------------------------------------
T_AB, T_ZIEL, T_DAUER, T_ENDE = 52.0, 132.0, 8.0, 100  # Rampe ab Beat 52 auf 132 über 8 Beats, Lauf bis Beat 100


def tempo_sample_at(b: float) -> float:
    """Kern-Sample des Master-Beats b für die Karte dieses Laufs: 128 bis T_AB, dann linear in der Zeit auf T_ZIEL über
    T_DAUER Beats (uhr.h: Segment linear in der Zeit), danach konstant (wie Karte::sample_at)."""
    s_ab = T_AB * SPB
    if b <= T_AB:
        return b * SPB
    T = T_DAUER * 60.0 * 2.0 / (128.0 + T_ZIEL)          # Dauer der Rampe in s
    k = (T_ZIEL - 128.0) / T                              # BPM je s
    if b <= T_AB + T_DAUER:
        x = b - T_AB                                      # Beats seit Rampenbeginn: (128 t + k t²/2) / 60 = x
        t = (-128.0 + math.sqrt(128.0 ** 2 + 2.0 * k * 60.0 * x)) / k
        return s_ab + t * RATE
    return s_ab + T * RATE + (b - T_AB - T_DAUER) * 60.0 / T_ZIEL * RATE


def art_tempo(a: Aufbau, arg) -> dict:
    klick_fassung(a.ab, "c1c0000000000032", "--beats", "160")
    a.set_neu()
    q, _ = a.laden(1, "c1c0000000000032")
    if not q:
        raise RuntimeError("Laden der Klick-Fassung ohne Quittung fertig")
    a.teil("deck/1/fader", 4.0, 0.0)
    a.warte_beat(6)
    a.klick("deck/1", 1)
    a.warte_beat(21.5)
    a.klick("deck/1", 0)
    a.warte_beat(30)
    s1 = a.start(1, 32.0, 0.0)
    a.warte_beat(44)
    r = a.nid()
    a.sende("/k/tempo/rampe", ",hsddd", r, "pruefstand", T_AB, T_ZIEL, T_DAUER)  # Task 4.2: nicht als andreas
    a.warte_sample(int(tempo_sample_at(T_ENDE)))
    st = a.stopp(1, T_ENDE + 1.0)
    a.warte_sample(int(tempo_sample_at(T_ENDE + 3)))
    return {"start_quittung": a.quittung(s1, 2, 1.0), "rampe_quittung": [a.quittung(r, x, 1.0) for x in (1, 6)],
            "stopp": st, "ende_beat": T_ENDE, "zustand_kern_ende": a.zustand_kern()}


def werte_tempo(o: Path, lauf: dict) -> tuple[dict, int]:
    x, meta = aufnahme(o)
    s_a = kern_sample_der_aufnahme(o, meta)
    zk = lauf.get("zustand_kern_ende")
    erg = {"aufnahme_luecken": meta["luecken"], "kern_sample_erster": s_a, "kern_frame_luecken": zk[1] if zk else None,
           "rampe_quittung": lauf.get("rampe_quittung")}
    if s_a is None:
        erg["fehler"] = "Zuordnung Aufnahme ↔ Kern nicht eindeutig"
        return erg, 2
    pruef = [b * SPB for b in range(7, 22)]
    deck = [int(round(tempo_sample_at(32 + q))) for q in range(1, T_ENDE - 32)]   # Quell-Beat q bei Master-Beat 32 + q
    vp = [v for v in versaetze(x, s_a, pruef) if v[1] < 22 * SPB]
    vd = [v for v in versaetze(x, s_a, deck) if 32 * SPB <= v[1] < tempo_sample_at(T_ENDE)]
    if not vp or not vd:
        erg["fehler"] = "keine Klicks"
        return erg, 2
    L = int(np.median([v[2] for v in vp]))
    d = np.array([v[2] - L for v in vd])                  # Abweichung vom Soll nach dem festen Ausgangsversatz
    soll_b = [32 + 1 + i for i in range(len(deck))]
    def abschnitt(b0, b1):
        w = [v[2] - L for v in vd if tempo_sample_at(b0) <= v[1] < tempo_sample_at(b1)]
        return {"n": len(w), "min": int(min(w)) if w else None, "max": int(max(w)) if w else None}
    erg.update({"versatz_pruefklick": L, "deck_klicks_anzahl": len(vd), "deck_klicks_soll": len(deck),
                "vor_rampe": abschnitt(33, T_AB), "in_rampe": abschnitt(T_AB, T_AB + T_DAUER),
                "nach_rampe": abschnitt(T_AB + T_DAUER, T_ENDE), "abweichung_max_betrag": int(np.abs(d).max())})
    if meta["luecken"] != 0 or not zk or zk[1] != 0:
        erg["fehler"] = "Lücken im Graphen: Lauf ungültig, auf ruhiger Maschine wiederholen (M10)"
        return erg, 2
    rq = lauf.get("rampe_quittung") or [None, None]
    grenzen = {"rampe_angenommen": rq[0] is not None and rq[1] is None,
               "jeder_klick_hoechstens_1ms": erg["abweichung_max_betrag"] <= 48,
               "keiner_fehlt": len(vd) == len(deck)}
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


# --- Keylock Task 4.2, 4.3, 4.5 (Plan 2026-10-06-keylock-echtzeit.md: Messgrößen, Befund Sägezahn) -------------------
# Lage: Teil-Sample per Korrelation mit der Klickform (wie keylock_mess.h klick_lage), nicht per Schwelle: die Klickform
# hinter R3 ist gedehnt, eine Schwelle misst dann die Form mit. Bezugspunkt der Klick-Anfang (mitte 0, wie
# test_kern_keylock_faeden rampe). Soll = Karte (KarteP, Nachbau von uhr.cpp) plus fester Versatz der Kette, gemessen am
# Prüfklick Z1 mit derselben Korrelation. „Rohes R3 gleicher Faktorfolge“ (Messgröße b des Befunds) gibt es am Ziel nicht:
# die Faktorfolge des Dehners ist von außen nicht sichtbar. Tragend am Ziel ist darum je Klick die Lage gegen das Ideal
# und gegen den Varispeed-Bezug (derselbe Lauf mit Keylock aus, --bezug), wie test_kern_keylock_faeden rampe.
def llround(x: float) -> int:
    """C llround: ,5 vom Nullpunkt weg (Python round rundet zur geraden Zahl)."""
    return int(math.floor(x + 0.5)) if x >= 0 else -int(math.floor(-x + 0.5))


class KarteP:
    """Tempo-Karte wie djk/kern/src/uhr.cpp (Karte::neu, rampe, beat_at, sample_at, bpm_at), Segmente (s0, b0, bpm0, k, T):
    die Rampe beginnt bei llround(sample_at(ab)), ihr Ende-Segment bei llround(s_ende) mit nachgeführtem Beat."""

    def __init__(self, bpm: float = 128.0):
        self.seg = [(0, 0.0, bpm, 0.0, math.inf)]

    def _i_s(self, s):
        i = 0
        while i + 1 < len(self.seg) and self.seg[i + 1][0] <= s:
            i += 1
        return i

    def _i_b(self, b):
        i = 0
        while i + 1 < len(self.seg) and self.seg[i + 1][1] <= b:
            i += 1
        return i

    def beat_at(self, s: float) -> float:
        s0, b0, bpm0, k, _ = self.seg[self._i_s(s)]
        dt = (s - s0) / RATE
        return b0 + (bpm0 * dt + 0.5 * k * dt * dt) / 60.0

    def sample_at(self, b: float) -> float:
        s0, b0, bpm0, k, _ = self.seg[self._i_b(b)]
        db = b - b0
        return s0 + 120.0 * db / (bpm0 + math.sqrt(bpm0 * bpm0 + 120.0 * k * db)) * RATE

    def bpm_at(self, s: float) -> float:
        s0, _, bpm0, k, _ = self.seg[self._i_s(s)]
        return bpm0 + k * (s - s0) / RATE

    def bpm_bei_beat(self, b: float) -> float:
        return self.bpm_at(self.sample_at(b))

    def rampe(self, ab: float, ziel: float, dauer: float):
        s0 = llround(self.sample_at(ab))
        b0, bpm0, b_ende = self.beat_at(s0), self.bpm_at(s0), ab + dauer
        T = (b_ende - b0) * 60.0 / ((bpm0 + ziel) / 2.0)
        k = (ziel - bpm0) / T
        m = self._i_s(s0)
        self.seg = self.seg[:m if self.seg[m][0] == s0 else m + 1] + [(s0, b0, bpm0, k, T)]
        s_ende = s0 + T * RATE
        s1 = llround(s_ende)
        self.seg.append((s1, b_ende + (s1 - s_ende) * ziel / (60.0 * RATE), ziel, 0.0, math.inf))


def fassung_klick_form() -> np.ndarray:
    """Klickform aus klick_fassung.py und klick.cpp (96 Samples)."""
    i = np.arange(96, dtype=np.float64)
    return np.exp(-i / 12.0) * np.cos(2.0 * math.pi * 2000.0 * i / RATE)


def _parabel(cc, am):
    if 0 < am < len(cc) - 1:
        a, b, c = cc[am - 1], cc[am], cc[am + 1]
        d = a - 2 * b + c
        if d != 0:
            return am + 0.5 * (a - c) / d
    return float(am)


def klick_lagen(x, soll, tpl, mitte: float = 0.0, such: int = 3000) -> list:
    """Je Soll-Index (Aufnahme-Index des Bezugspunkts `mitte` der Vorlage): Ist − Soll in Samples, Teil-Sample über die
    Parabel durch das Korrelationsmaximum (keylock_mess.h klick_lage). None: Fenster ragt aus der Aufnahme."""
    x = np.asarray(x, dtype=np.float64)
    n, aus = len(tpl), []
    for s in soll:
        lo, hi = int(s - mitte) - such, int(s - mitte) + such
        if lo < 1 or hi + n + 1 >= len(x):
            aus.append(None)
            continue
        cc = np.correlate(x[lo:hi + n], tpl, "valid")
        aus.append(lo + _parabel(cc, int(np.argmax(cc))) + mitte - s)
    return aus


def ton_fenster(x, a: int, b: int, n: int = 4800, f0: float = 1000.0) -> list:
    """Tonhöhe je 100-ms-Fenster in [a, b) gegen f0 in Cent, über steigende Nulldurchgänge (keylock_mess.h freq)."""
    x = np.asarray(x, dtype=np.float64)
    aus = []
    for s in range(a, b - n + 1, n):
        w = x[s:s + n]
        i = np.flatnonzero((w[:-1] < 0) & (w[1:] >= 0))
        if len(i) < 2:
            aus.append(float("nan"))
            continue
        t = i + w[i] / (w[i] - w[i + 1])
        aus.append(1200.0 * math.log2((len(i) - 1) * RATE / (t[-1] - t[0]) / f0))
    return aus


def null_laeufe(x, a: int, b: int, mind: int = 32) -> int:
    """Läufe von mindestens `mind` exakten Nullen in [a, b) (Messgröße Null-Samples, ≥ 32 mitten im Sinus)."""
    z = np.concatenate(([False], np.asarray(x[a:b]) == 0.0, [False]))
    d = np.diff(z.astype(np.int8))
    return int(np.sum((np.flatnonzero(d == -1) - np.flatnonzero(d == 1)) >= mind))


def transienten(quelle, abstand: int = 1500, fenster: int = 64, faktor: float = 3.0, anteil: float = 0.05) -> list:
    """Quellframes der Einsätze eines Drum-Materials: Hüllkurve der ersten Differenz (betont Anschläge), RMS über
    `fenster` Samples; Einsatz, wo sie das `faktor`-Fache ihres Mittels über die 960 bis 96 Samples davor und `anteil`
    des Maximums übersteigt, höchstens einer je `abstand` Samples. Nicht das Raster: im Loop liegen die Schläge neben
    den Sechzehnteln (mfb_drums_8: rund 0,3 Sechzehntel daneben, 08.10. gemessen)."""
    q = np.asarray(quelle, dtype=np.float64)
    d = np.diff(q, prepend=0.0)
    c = np.concatenate(([0.0], np.cumsum(d * d)))
    env = np.sqrt((c[fenster:] - c[:-fenster]) / fenster)
    n = np.arange(len(env))
    c2 = np.concatenate(([0.0], np.cumsum(env)))
    lo, hi = np.clip(n - 960, 0, None), np.clip(n - 96, 1, None)
    vor = (c2[hi] - c2[lo]) / np.maximum(hi - lo, 1)
    kand = np.flatnonzero((env > faktor * np.maximum(vor, 1e-9)) & (env > anteil * env.max()) & (n >= 960))
    aus = []
    for k in kand:
        if not aus or k - aus[-1] > abstand:
            aus.append(int(k))
    return aus


def transienten_lagen(aus, quelle, tr, erwartet, f: float, vor: int = 64, lang: int = 512, such: int = 400,
                      min_ncc: float = 0.0, guete: list | None = None) -> list:
    """Lage (Ist − erwartet, Samples) jedes Quell-Transienten p in der Ausgabe `aus` (Aufnahme-Indizes `erwartet`):
    normierte Korrelation mit der Vorlage aus der Quelle ab p − vor, in der Zeit um f gedehnt (Varispeed: Ausgabe(j) =
    Quelle(p + (j − E)·f); Keylock: f = 1, R3 hält die Form). Teil-Sample über die Parabel. None: außerhalb oder
    Korrelationsmaximum unter min_ncc (die Vorlage passt dort nicht, die Lage wäre geraten); guete: je Transient das
    Maximum der normierten Korrelation."""
    x = np.asarray(aus, dtype=np.float64)
    q = np.asarray(quelle, dtype=np.float64)
    ix = np.arange(len(q), dtype=np.float64)
    c2 = np.concatenate(([0.0], np.cumsum(x * x)))
    erg = []
    for p, e in zip(tr, erwartet):
        tpl = np.interp(p + (np.arange(lang) - vor) * f, ix, q)
        lo, hi = int(e - vor) - such, int(e - vor) + such
        if lo < 1 or hi + lang + 1 >= len(x) or not np.any(tpl):
            erg.append(None)
            if guete is not None:
                guete.append(float("nan"))
            continue
        cc = np.correlate(x[lo:hi + lang], tpl, "valid")
        en = np.sqrt(np.maximum(c2[lo + lang:hi + lang + 1] - c2[lo:hi + 1], 1e-30))
        cc = cc / (en * float(np.linalg.norm(tpl)))
        am = int(np.argmax(cc))
        if guete is not None:
            guete.append(float(cc[am]))
        erg.append(lo + _parabel(cc, am) + vor - e if cc[am] >= min_ncc else None)
    return erg


def reihen(pfad: Path) -> dict:
    """Aus abonnent.jsonl ab dem letzten /uhr mit Sample 0 (die Zeitachse von /k/set/neu): je Deck (Sample des /uhr davor,
    status, hoerweg, keylock_unterlauf, keylock_aufgegeben) aus /zustand/deck (§5.5) und (Sample, generation,
    frame_luecken, cb_max_us, stretcher_aktiv) aus /zustand/kern (§5.4); dazu /uhr (sample, beat, bpm)."""
    z = [json.loads(l) for l in open(pfad) if l.strip()]
    i0 = max((i for i, m in enumerate(z) if m["adresse"] == "/uhr" and m["werte"][0] == 0), default=None)
    erg = {"deck": {}, "kern": [], "uhr": []}
    if i0 is None:
        return erg
    s = 0
    for m in z[i0:]:
        w = m["werte"]
        if m["adresse"] == "/uhr":
            s = int(w[0])
            erg["uhr"].append((s, float(w[2]), float(w[3])))
        elif m["adresse"] == "/zustand/deck" and len(w) >= 14:
            erg["deck"].setdefault(int(w[0]), []).append((s, int(w[1]), int(w[9]), int(w[12]), int(w[13])))
        elif m["adresse"] == "/zustand/kern" and len(w) >= 9:
            erg["kern"].append((s, int(w[0]), int(w[3]), int(w[5]), int(w[8])))
    return erg


def karte_gegen_uhr(k: KarteP, r: dict) -> float:
    """Größte Abweichung |beat_at(sample) − beat| über alle /uhr der Zeitachse: prüft den Nachbau der Karte am Kern."""
    return max((abs(k.beat_at(s) - b) for s, b, _ in r["uhr"]), default=float("inf"))


def last_vmstat(o: Path) -> dict | None:
    """Zusammenfassung von vmstat.txt (eine Zeile je Sekunde): r (lauffähig), us, sy, id, wa, cs; Mittel und Extreme."""
    f = o / "vmstat.txt"
    if not f.exists():
        return None
    kopf, zeilen = None, []
    for z in f.read_text().splitlines():
        t = z.split()
        if "us" in [x.lower() for x in t] and "sy" in [x.lower() for x in t]:
            kopf = [x.lower() for x in t]
        elif kopf and t and t[0].isdigit():
            zeilen.append(dict(zip(kopf, t)))
    zeilen = zeilen[1:]  # die erste Zeile ist das Mittel seit dem Booten
    if not zeilen:
        return None
    w = lambda k: [int(x[k]) for x in zeilen]  # noqa: E731
    return {"sekunden": len(zeilen), "r_max": max(w("r")), "r_mittel": round(float(np.mean(w("r"))), 2),
            "us_mittel": round(float(np.mean(w("us"))), 1), "sy_mittel": round(float(np.mean(w("sy"))), 1),
            "id_min": min(w("id")), "id_mittel": round(float(np.mean(w("id"))), 1), "wa_max": max(w("wa")),
            "cs_max": max(w("cs"))}


def statistik(v) -> dict:
    v = [x for x in v if x is not None]
    if not v:
        return {"n": 0}
    a = np.asarray(v)
    return {"n": len(v), "mittel": round(float(a.mean()), 2), "min": round(float(a.min()), 2),
            "max": round(float(a.max()), 2), "spannweite": round(float(a.max() - a.min()), 2),
            "std": round(float(a.std()), 2), "max_betrag": round(float(np.abs(a).max()), 2)}


def pruefklick_versatz(x, s_a, kanal: int):
    """Fester Versatz der Kette (Kern-Samples) am Prüfklick Z1 (Beats 7 bis 21 bei 128), per Korrelation; (Median,
    Streuung, Anzahl)."""
    l = [v for v in klick_lagen(x[:, kanal], [b * SPB - s_a for b in range(7, 22)], fassung_klick_form()) if v is not None]
    if not l:
        return None, None, 0
    m = float(np.median(l))
    return m, float(max(abs(v - m) for v in l)), len(l)


def fehler_aufnahme(o: Path, lauf: dict):
    """Gemeinsamer Anfang der Keylock-Auswertungen: Aufnahme, Zuordnung, Lücken. (x, meta, s_a, erg) oder erg mit fehler."""
    x, meta = aufnahme(o)
    s_a = kern_sample_der_aufnahme(o, meta)
    zk = lauf.get("zustand_kern_ende")
    erg = {"aufnahme_frames": int(x.shape[0]), "aufnahme_luecken": meta["luecken"], "kern_sample_erster": s_a,
           "kern_frame_luecken": zk[1] if zk else None}
    if s_a is None:
        erg["fehler"] = "Zuordnung Aufnahme ↔ Kern nicht eindeutig"
    elif meta["luecken"] != 0 or not zk or zk[1] != 0:
        erg["fehler"] = "Lücken im Graphen: Lauf ungültig, auf ruhiger Maschine wiederholen (M10)"
    return x, meta, s_a, erg


def deck_im_fenster(r: dict, deck: int, s0: float, s1: float) -> list:
    return [z for z in r["deck"].get(deck, []) if s0 <= z[0] < s1]


# Art keylock: Klick-Fassung (oder Sinus links, Klick rechts), Start Beat 32 auf Quell-Beat 0 bei 128 (Direktweg auf der
# Basis, Architektur 7), Rampe 128 -> 132 ab Beat 48 über 32 Beats, danach 132 bis Beat 112. --keylock-aus: Regler
# keylock 0 über teil() vor dem Start (Fehlerfall: Varispeed, nach der Rampe +53,27 ct).
KL_START, KL_RAMPE_AB, KL_RAMPE_BEATS, KL_ZIEL, KL_ENDE = 32, 48.0, 32.0, 132.0, 112


def kl_karte() -> KarteP:
    k = KarteP()
    k.rampe(KL_RAMPE_AB, KL_ZIEL, KL_RAMPE_BEATS)
    return k


def tempo_rampe(a: Aufbau, ab, ziel, dauer):
    r = a.merke(a.nid(), f"/k/tempo/rampe ab Beat {ab} auf {ziel} über {dauer}")
    a.sende("/k/tempo/rampe", ",hsddd", r, "pruefstand", float(ab), float(ziel), float(dauer))
    return r


def art_keylock(a: Aufbau, arg) -> dict:
    mid = {"klick": "c1c0000000000041", "sinus": "c1c0000000000042", "sinusrein": "c1c0000000000044"}[arg.material]
    if arg.material == "sinusrein":
        fassung_schreiben(a.ab, mid, sinus_rein(KL_ENDE - KL_START + 8), "Sinus 1000 Hz", "Sinus-Fassung Keylock Task 4.2")
    else:
        klick_fassung(a.ab, mid, "--beats", str(KL_ENDE - KL_START + 8),
                      *(["--sinus-links", "1000"] if arg.material == "sinus" else []))
    a.set_neu()
    if not a.laden(1, mid)[0]:
        raise RuntimeError("Laden der Klick-Fassung ohne Quittung fertig")
    a.teil("deck/1/fader", 4.0, 0.0)
    if arg.keylock_aus:
        a.teil("keylock", 5.0, 0.0)
    a.warte_beat(6)
    a.klick("deck/1", 1)
    a.warte_beat(21.5)
    a.klick("deck/1", 0)
    a.warte_beat(30)
    s1 = a.start(1, float(KL_START), 0.0)
    a.warte_beat(40)
    r = tempo_rampe(a, KL_RAMPE_AB, KL_ZIEL, KL_RAMPE_BEATS)
    k = kl_karte()
    a.warte_sample(int(k.sample_at(KL_ENDE)))
    a.stopp(1, KL_ENDE + 1.0)
    if arg.keylock_aus:
        a.teil("keylock", KL_ENDE + 2.0, 1.0)  # zurück auf die Vorgabe
    a.warte_sample(int(k.sample_at(KL_ENDE + 3)))
    return {"material": arg.material, "keylock_aus": arg.keylock_aus, "start_quittung": a.quittung(s1, 2, 1.0),
            "rampe_quittung": [a.quittung(r, x, 1.0) for x in (1, 6)], "ende_beat": KL_ENDE,
            "zustand_kern_ende": a.zustand_kern()}


def werte_keylock(o: Path, lauf: dict, bezug: str | None = None) -> tuple[dict, int]:
    x, meta, s_a, erg = fehler_aufnahme(o, lauf)
    if "fehler" in erg:
        return erg, 2
    sinus = lauf["material"] in ("sinus", "sinusrein")
    klicks = lauf["material"] != "sinusrein"
    kk = 1 if sinus else 0                                  # Klicks: Master rechts (Sinus links) bzw. links
    k = kl_karte()
    r = reihen(o / "abonnent.jsonl")
    erg["karte_gegen_uhr_beats"] = karte_gegen_uhr(k, r)
    L, streu, n_p = pruefklick_versatz(x, s_a, kk)
    erg.update({"versatz_pruefklick": L, "versatz_pruefklick_streuung": streu, "pruefklick_anzahl": n_p})
    if L is None or erg["karte_gegen_uhr_beats"] > 1e-6:
        erg["fehler"] = "kein Prüfklick" if L is None else "Karte passt nicht zur Uhr des Kerns"
        return erg, 2
    qs = list(range(1, KL_ENDE - KL_START - 1)) if klicks else []  # Quell-Beat q bei Master-Beat 32 + q
    soll = [k.sample_at(KL_START + q) + L - s_a for q in qs]
    lagen = klick_lagen(x[:, kk], soll, fassung_klick_form())
    erg["klicks"] = [[q, None if v is None else round(v, 3)] for q, v in zip(qs, lagen)]
    teil = {"basis": (KL_START, KL_RAMPE_AB), "blende": (KL_RAMPE_AB, KL_RAMPE_AB + 1),
            "rampe": (KL_RAMPE_AB + 1, KL_RAMPE_AB + KL_RAMPE_BEATS),
            "nach_rampe": (KL_RAMPE_AB + KL_RAMPE_BEATS, KL_ENDE)}
    for name, (b0, b1) in teil.items():
        erg[f"lage_{name}"] = statistik([v for q, v in zip(qs, lagen) if b0 <= KL_START + q < b1])
    ring = [v for q, v in zip(qs, lagen) if KL_START + q >= KL_RAMPE_AB + 1]
    erg["lage_mittel_ausgewiesen"] = ("absolutes Mittel ±3 gilt nur für den Hann-Klick (Befund Sägezahn); die "
                                      "Klick-Fassung wird ausgewiesen, nicht geprüft")
    # Ring hörbar und Zähler (§5.5), Fenster ab einem Beat nach Rampenbeginn bis zum Ende
    s_r0, s_r1 = k.sample_at(KL_RAMPE_AB + 1), k.sample_at(KL_ENDE)
    dz = deck_im_fenster(r, 1, s_r0, s_r1)
    erg["zustand_deck_meldungen"] = len(dz)
    erg["ring_hoerbar_anteil"] = round(sum(z[2] == 1 for z in dz) / len(dz), 4) if dz else None
    ende = r["deck"].get(1, [(0, 0, 0, -1, -1)])[-1]
    erg["keylock_unterlauf"], erg["keylock_aufgegeben"] = ende[3], ende[4]
    grenzen = {"ring_hoerbar": erg["ring_hoerbar_anteil"] == 1.0, "unterlauf_0": ende[3] == 0 and ende[4] == 0}
    if klicks:
        grenzen.update({"keiner_fehlt": all(v is not None for v in lagen),
                        "basis_direktweg_0": erg["lage_basis"]["n"] > 0 and erg["lage_basis"]["max_betrag"] <= 0.5,
                        "jeder_klick_12_gegen_ideal": bool(ring) and all(v is not None and abs(v) <= 12.0 for v in ring)})
    if sinus:  # Aufnahme-Index eines Kern-Samples s: s + L − s_a (die Kette verzögert um L)
        idx = lambda s: int(round(s + L - s_a))  # noqa: E731
        a0, a1 = idx(s_r0), idx(s_r1)
        ct = ton_fenster(x[:, 0], a0, a1)
        nach = ton_fenster(x[:, 0], idx(k.sample_at(KL_RAMPE_AB + KL_RAMPE_BEATS + 1)), a1)
        erg["tonhoehe_ct"] = statistik(ct)
        erg["tonhoehe_nach_rampe_ct"] = statistik(nach)
        erg["tonhoehe_ueber_2ct"] = [[round((a0 + 4800 * i + s_a - L) / SPB, 2), round(c, 2)]
                                     for i, c in enumerate(ct) if not abs(c) <= 2.0][:20]  # Kern-Beat bei 128, ct
        erg["varispeed_soll_ct"] = round(1200 * math.log2(KL_ZIEL / 128.0), 3)
        # Null-Läufe über das ganze Spiel: ab dem zweiten Sample des Starts (Sinus-Phase 0 bei Quellframe 0) bis Stopp
        erg["null_laeufe"] = null_laeufe(x[:, 0], idx(k.sample_at(KL_START)) + 1, idx(k.sample_at(KL_ENDE)))
        grenzen["tonhoehe_2ct"] = bool(ct) and all(abs(c) <= 2.0 for c in ct)
        grenzen["null_samples_0"] = erg["null_laeufe"] == 0
    if bezug:  # je Klick gegen den Varispeed-Bezug (Lauf mit --keylock-aus, gleiches Material)
        bz = {q: v for q, v in json.loads((Path(bezug) / "ergebnis.json").read_text())["klicks"]}
        d = [v - bz[q] for q, v in zip(qs, lagen)
             if KL_START + q >= KL_RAMPE_AB + 1 and v is not None and bz.get(q) is not None]
        erg["bezug"] = str(bezug)
        erg["lage_gegen_varispeed"] = statistik(d)
        grenzen["jeder_klick_12_gegen_varispeed"] = bool(d) and all(abs(v) <= 12.0 for v in d)
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


# Art drums: echtes Drum-Material (Loop aus dem Bestand, offline auf Basis 128 gebracht und wiederholt) bei --bpm T. Ein
# Lauf, drei Durchgänge: 0 auf der Basis 128 (Direktweg, misst die Kette: der LR8-Isolator im Kanalzug ist ein Allpass,
# Gruppenlaufzeit je Frequenz verschieden, am Loop gemessen 08.10.: nach der besten reinen Verschiebung 53 % Rest), dann
# Rampe auf T, A Keylock an, B Keylock aus (Varispeed-Bezug), beide auf T. Bezug je Durchgang: die Quelle durch die
# geschätzte Kette (A) bzw. die offline gedehnte Quelle durch dieselbe Kette (B), nicht die nackte Quelle.
DR_N0, DR_N = 16, 40
DR_HOCHPASS, DR_GUETE = 2000.0, 0.8
DR_0 = 24.0                                             # Durchgang 0 ab Beat 24 (nach dem Prüfklick)
DR_RAMPE_AB, DR_RAMPE_BEATS = DR_0 + DR_N0 + 2, 2.0     # Rampe ab Beat 42 auf T
DR_A = DR_RAMPE_AB + DR_RAMPE_BEATS + 4                 # Durchgang A ab Beat 48
DR_B = DR_A + DR_N + 8                                  # Durchgang B ab Beat 96


def kette_schaetzen(quelle, aus, taps: int = 8192, vor: int = 256):
    """FIR der Kette aus einem Direktweg-Stück: aus[n] ≈ Σ h[m] · quelle[n − m + vor] (kleinste Quadrate im Spektrum,
    Wiener mit kleiner Regularisierung), h auf [0, taps) gekürzt, vor Samples Vorlauf. Rückgabe (h, Rest): Rest = RMS des
    Fehlers der Nachbildung / RMS von aus über das Stück (Prüfung, dass die Kette linear und zeitinvariant ist)."""
    q, y = np.asarray(quelle, dtype=np.float64), np.asarray(aus, dtype=np.float64)
    n = 1 << 16                                      # Welch-Schätzer H1: Σ Y·conj(Q) / Σ |Q|², Hann, halber Vorschub
    w = np.hanning(n)
    sq, sy = 0.0, 0.0
    for a in range(0, len(q) - n + 1, n // 2):
        Q, Y = np.fft.rfft(w * q[a:a + n]), np.fft.rfft(w * y[a:a + n])
        sy, sq = sy + Y * np.conj(Q), sq + np.abs(Q) ** 2
    H = sy / (sq + 1e-9 * np.max(sq))
    h = np.roll(np.fft.irfft(H, n), vor)[:taps]
    nach = kette_anwenden(q, h, vor)
    m = slice(taps, len(q) - taps)
    return h, float(np.std(nach[m] - y[m]) / max(np.std(y[m]), 1e-30))


def kette_anwenden(quelle, h, vor: int = 256):
    from scipy.signal import fftconvolve
    return fftconvolve(np.asarray(quelle, dtype=np.float64), h)[vor:vor + len(quelle)]


def drum_quelle(wav: str, quell_bpm: float, wiederholungen: int = 3) -> np.ndarray:
    """Drum-Loop (WAV, 16 bit, 48 kHz, ganze Takte bei quell_bpm) auf Basis 128 umgerechnet (scipy resample_poly,
    Länge × quell_bpm/128) und wiederholt: (Frames, 2) float32. Deterministisch, damit die Auswertung sie neu baut."""
    import wave
    from fractions import Fraction
    from scipy.signal import resample_poly
    with wave.open(wav) as w:
        if w.getframerate() != RATE or w.getsampwidth() != 2 or w.getnchannels() != 2:
            raise RuntimeError(f"{wav}: erwartet 48 kHz, 16 bit, stereo")
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2).astype(np.float64) / 32768.0
    fr = Fraction(quell_bpm / 128.0).limit_denominator(1000)
    y = resample_poly(x, fr.numerator, fr.denominator, axis=0)
    beats = round(len(x) / (60.0 / quell_bpm * RATE))
    n = beats * SPB                                       # ganze Beats bei 128: Naht der Wiederholung auf dem Raster
    y = np.concatenate([y[:n]] * wiederholungen).astype(np.float32)
    return y


def drum_fassung(ab: Path, mid: str, y: np.ndarray, wav: str) -> dict:
    return fassung_schreiben(ab, mid, y, f"Drums {Path(wav).name}", f"Drum-Loop {Path(wav).name}, Prüfmaterial Keylock Task 4.2")


def sinus_rein(beats: int) -> np.ndarray:
    """Reiner Sinus 1000 Hz, Spitze 0,5, auf beiden Kanälen (Phase 0 bei Frame 0), Basis 128: die Sinus-Fassung der
    Messgröße Tonhöhe ohne Klicks daneben (bei --material sinus stört der Klick rechts den Sinus links, R3 rechnet die
    Kanäle zusammen)."""
    t = np.arange((beats + 1) * SPB, dtype=np.float64)
    v = (0.5 * np.sin(2.0 * math.pi * 1000.0 * t / RATE)).astype(np.float32)
    return np.stack([v, v], axis=1)


def fassung_schreiben(ab: Path, mid: str, y: np.ndarray, titel: str, warnung: str) -> dict:
    """Schreibt ein Material als Fassung 128000_r1 (Basis 128, erster Schlag Frame 0) nach SCHNITTSTELLEN §6.4, mit
    den JSON-Bausteinen von klick_fassung.py; atomar über .<mid>.tmp und rename."""
    import hashlib
    sys.path.insert(0, str(HIER))
    import klick_fassung as kf
    tmp, ziel = ab / f".{mid}.tmp", ab / mid
    shutil.rmtree(tmp, ignore_errors=True)
    ordner = tmp / "fassungen" / "128000_r1"
    ordner.mkdir(parents=True)
    b = np.ascontiguousarray(y, dtype="<f4").tobytes()
    (ordner / "basis.f32").write_bytes(b)
    sha = hashlib.sha256(b).hexdigest()
    beats = len(y) / SPB
    fj = kf.fassung_json(mid, 128.0, 1, len(y), sha, 0, beats, 0, -16.0, {}, "basis")
    fj["warnungen"] = [warnung]
    (ordner / "fassung.json").write_text(json.dumps(fj, ensure_ascii=False, indent=1) + "\n")
    mj = kf.material_json(mid, titel, len(y) / RATE, int(beats), -16.0, 0, 128.0, 0, sha)
    (tmp / "material.json").write_text(json.dumps(mj, ensure_ascii=False, indent=1) + "\n")
    shutil.rmtree(ziel, ignore_errors=True)
    os.rename(tmp, ziel)
    return {"frames": len(y), "beats": round(beats, 3), "sha256": sha}


def dr_karte(bpm: float) -> KarteP:
    k = KarteP()
    if bpm != 128.0:
        k.rampe(DR_RAMPE_AB, bpm, DR_RAMPE_BEATS)
    return k


def art_drums(a: Aufbau, arg) -> dict:
    mid = "c1c0000000000043"
    info = drum_fassung(a.ab, mid, drum_quelle(arg.drum_wav, arg.drum_bpm), arg.drum_wav)
    a.set_neu()
    if not a.laden(1, mid)[0]:
        raise RuntimeError("Laden des Drum-Materials ohne Quittung fertig")
    a.teil("deck/1/fader", 4.0, -12.0)   # −12 dB: der Master-Limiter (−1 dBTP) soll die Transienten nicht formen
    a.warte_beat(6)
    a.klick("deck/1", 1)
    a.warte_beat(21.5)
    a.klick("deck/1", 0)
    s0 = a.start(1, DR_0, 0.0)                              # Durchgang 0: Basis 128, Direktweg
    a.stopp(1, DR_0 + DR_N0)
    r = tempo_rampe(a, DR_RAMPE_AB, arg.bpm, DR_RAMPE_BEATS) if arg.bpm != 128.0 else None
    k = dr_karte(arg.bpm)
    a.warte_sample(int(k.sample_at(DR_A - 2)))
    sa = a.start(1, DR_A, 0.0)
    a.stopp(1, DR_A + DR_N)
    a.teil("keylock", DR_A + DR_N + 2, 0.0)
    a.warte_sample(int(k.sample_at(DR_B - 2)))
    sb = a.start(1, DR_B, 0.0)
    a.stopp(1, DR_B + DR_N)
    a.teil("keylock", DR_B + DR_N + 2, 1.0)
    a.warte_sample(int(k.sample_at(DR_B + DR_N + 4)))
    return {"bpm": arg.bpm, "drum_wav": arg.drum_wav, "drum_bpm": arg.drum_bpm, "material": info,
            "start_0": DR_0, "start_a": DR_A, "start_b": DR_B, "durchgang_beats": DR_N,
            "start_quittung": [a.quittung(x, 2, 1.0) for x in (s0, sa, sb)],
            "rampe_quittung": None if r is None else [a.quittung(r, x, 1.0) for x in (1, 6)],
            "zustand_kern_ende": a.zustand_kern()}


def werte_drums(o: Path, lauf: dict, bezug: str | None = None) -> tuple[dict, int]:
    from fractions import Fraction
    from scipy.signal import resample_poly
    x, meta, s_a, erg = fehler_aufnahme(o, lauf)
    if "fehler" in erg:
        return erg, 2
    bpm, f = lauf["bpm"], lauf["bpm"] / 128.0
    k = dr_karte(bpm)
    r = reihen(o / "abonnent.jsonl")
    erg.update({"bpm": bpm, "faktor": round(f, 6), "karte_gegen_uhr_beats": karte_gegen_uhr(k, r)})
    L, streu, n_p = pruefklick_versatz(x, s_a, 0)
    erg.update({"versatz_pruefklick": L, "pruefklick_anzahl": n_p})
    if erg["karte_gegen_uhr_beats"] > 1e-6:
        erg["fehler"] = "Karte passt nicht zur Uhr des Kerns"
        return erg, 2
    y = drum_quelle(lauf["drum_wav"], lauf["drum_bpm"])
    q = y[:, 0].astype(np.float64)
    ml = x[:, 0].astype(np.float64)
    # Kette aus Durchgang 0: Quellframes [2, 14) Beats gegen die Aufnahme ab Kern-Sample sample_at(24) (Direktweg: Quellframe
    # n klingt bei Kern-Sample sample_at(24) + n, die Kette verschiebt und formt; h trägt beides)
    i0 = int(round(k.sample_at(lauf["start_0"]))) - s_a
    a_, b_ = 2 * SPB, 14 * SPB
    h, rest = kette_schaetzen(q[a_:b_], ml[i0 + a_:i0 + b_])
    erg["kette_rest"] = round(rest, 5)
    erg["kette_spitze_bei"] = int(np.argmax(np.abs(h))) - 256
    qh = kette_anwenden(q, h)                                # Quelle durch die Kette, Index = Quellframe
    tr = [p for p in transienten(q) if 2 * SPB <= p < (DR_N - 1) * SPB]   # ohne Brücke und Stopp-Rampe
    fr = Fraction(f).limit_denominator(1000)
    qv = kette_anwenden(resample_poly(q, fr.denominator, fr.numerator), h)  # Varispeed offline: Quellframe p bei p / f
    # Korreliert wird über 2 kHz (Butterworth 4. Ordnung, vor- und rückwärts, ohne Phase): darunter tragen Bassdrum-Körper
    # und Bass, die R3 dehnt und deren Periode die Korrelation an falsche Stellen zieht (08.10., 132 BPM: ohne Hochpass
    # 52 von 93 Treffern mit Güte > 0,8, davon die meisten am Rand des Suchfensters ±400; mit Hochpass alle Treffer mit
    # Güte > 0,8 zwischen −12,7 und −2,1). Gezählt wird nur, wo die normierte Korrelation ≥ DR_GUETE ist.
    from scipy.signal import butter, sosfiltfilt
    sos = butter(4, DR_HOCHPASS, btype="high", fs=RATE, output="sos")
    mh, qhh, qvh = (sosfiltfilt(sos, v) for v in (ml, qh, qv))
    lagen, gueten = {}, {}
    for name, b0, ref, pos in (("direktweg", lauf["start_0"], qhh, [float(p) for p in tr]),
                               ("keylock", lauf["start_a"], qhh, [float(p) for p in tr]),
                               ("varispeed", lauf["start_b"], qvh, [p / f for p in tr])):
        nn = DR_N0 if name == "direktweg" else DR_N
        sel = [i for i, p in enumerate(tr) if p < (nn - 1) * SPB]
        e = [k.sample_at(b0 + tr[i] / SPB) - s_a for i in sel]
        g = []
        lagen[name] = dict(zip(sel, transienten_lagen(mh, ref, [pos[i] for i in sel], e, 1.0, min_ncc=DR_GUETE, guete=g)))
        gueten[name] = dict(zip(sel, g))
        erg[f"lage_{name}"] = statistik(list(lagen[name].values()))
        erg[f"lage_{name}"]["unter_guete"] = sum(v is None for v in lagen[name].values())
    d = [lagen["keylock"][i] - lagen["varispeed"][i] for i in range(len(tr))
         if lagen["keylock"].get(i) is not None and lagen["varispeed"].get(i) is not None]
    erg["transienten"] = len(tr)
    erg["lage_gegen_varispeed"] = statistik(d)
    erg["guete_grenze"], erg["hochpass_hz"] = DR_GUETE, DR_HOCHPASS
    erg["je_transient"] = [[int(p), lagen["keylock"].get(i), round(gueten["keylock"].get(i, float("nan")), 3),
                            lagen["varispeed"].get(i), round(gueten["varispeed"].get(i, float("nan")), 3)]
                           for i, p in enumerate(tr)]
    s = lambda b: k.sample_at(b)  # noqa: E731
    da = deck_im_fenster(r, 1, s(lauf["start_a"] + 2), s(lauf["start_a"] + DR_N - 1))
    db = deck_im_fenster(r, 1, s(lauf["start_b"] + 2), s(lauf["start_b"] + DR_N - 1))
    erg["ring_hoerbar_anteil_a"] = round(sum(z[2] == 1 for z in da) / len(da), 4) if da else None
    erg["ring_hoerbar_anteil_b"] = round(sum(z[2] == 1 for z in db) / len(db), 4) if db else None
    ende = r["deck"].get(1, [(0, 0, 0, -1, -1)])[-1]
    erg["keylock_unterlauf"], erg["keylock_aufgegeben"] = ende[3], ende[4]
    # keine Grenze im Plan (Mittel und Spannweite werden ausgewiesen); geprüft wird nur, dass die Messung trägt
    basis = bpm == 128.0
    grenzen = {"kette_linear_rest_unter_1prozent": rest < 0.01,
               "keylock_mindestens_20_treffer": erg["lage_keylock"]["n"] >= 20,
               "direktweg_lage_0": erg["lage_direktweg"].get("max_betrag", 99) <= 0.5,
               "varispeed_lage_unter_2": erg["lage_varispeed"].get("max_betrag", 99) <= 2.0,
               "transienten_mindestens_40": len(tr) >= 40,
               "a_ring_b_varispeed": (erg["ring_hoerbar_anteil_a"] == (0.0 if basis else 1.0)
                                      and erg["ring_hoerbar_anteil_b"] == 0.0),
               "unterlauf_0": ende[3] == 0 and ende[4] == 0}
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


# Art keylock4 (Task 4 Step 3, Prüfer M4): vier Decks spielen im Keylock (Deck 1 mit vier Stems, Deck 2 Sinus links, 3 und
# 4 Klick), Fader −6 dB, Tempo nie auf der Basis: 132 vor dem Start, danach alle 64 Beats eine Rampe über 16 Beats im
# Wechsel 136, 130, 134, 132 (der Dehner arbeitet auch in Rampen). --sekunden lang ab dem Start.
K4_ZIELE = (136.0, 130.0, 134.0, 132.0)


def art_keylock4(a: Aufbau, arg) -> dict:
    beats = int(arg.sekunden * 140 / 60) + 96
    klick_fassung(a.ab, "c1c00000000000c1", "--beats", str(beats), "--stems")
    klick_fassung(a.ab, "c1c00000000000c2", "--beats", str(beats), "--sinus-links", "1000")
    for n in (3, 4):
        klick_fassung(a.ab, f"c1c00000000000c{n}", "--beats", str(beats))
    a.set_neu()
    for d, mid, st in ((1, "c1c00000000000c1", 1), (2, "c1c00000000000c2", 0), (3, "c1c00000000000c3", 0),
                       (4, "c1c00000000000c4", 0)):
        if not a.laden(d, mid, mit_stems=st)[0]:
            raise RuntimeError(f"Deck {d} lädt nicht")
    b0 = math.ceil(a.abo.sample_jetzt() / SPB) + 4        # alles relativ zum Stand nach dem Laden (Karte noch 128)
    for d in range(1, 5):
        a.teil(f"deck/{d}/fader", float(b0), -6.0)
    rampen = [(b0 + 4.0, 132.0, 2.0)]
    tempo_rampe(a, *rampen[0])
    start = b0 + 12.0
    for d in range(1, 5):
        a.start(d, start, 0.0)
    k = KarteP()
    k.rampe(*rampen[0])
    s_start = k.sample_at(start)
    s_ende = s_start + arg.sekunden * RATE
    n = 0
    while True:
        ab = start + 64.0 * (n + 1)
        if k.sample_at(ab) + 16 * 60 / 128 * RATE > s_ende:
            break
        a.warte_sample(int(k.sample_at(ab - 16)))
        rampen.append((ab, K4_ZIELE[n % 4], 16.0))
        tempo_rampe(a, *rampen[-1])
        k.rampe(*rampen[-1])
        n += 1
    a.warte_sample(int(s_ende))
    ende_beat = math.ceil(k.beat_at(s_ende)) + 2
    for d in range(1, 5):
        a.stopp(d, float(ende_beat))
    a.warte_sample(int(k.sample_at(ende_beat + 2)))
    return {"sekunden": arg.sekunden, "start_beat": start, "ende_beat": ende_beat, "rampen": rampen,
            "s_start": s_start, "s_ende": s_ende, "zustand_kern_ende": a.zustand_kern()}


def werte_keylock4(o: Path, lauf: dict) -> tuple[dict, int]:
    r = reihen(o / "abonnent.jsonl")
    k = KarteP()
    for ramp in lauf["rampen"]:
        k.rampe(*ramp)
    erg = {"sekunden": lauf["sekunden"], "karte_gegen_uhr_beats": karte_gegen_uhr(k, r), "rampen": lauf["rampen"]}
    s0 = k.sample_at(lauf["start_beat"] + 2)              # nach Brücke und Einschwingen
    s1 = lauf["s_ende"]
    decks = {}
    for d in range(1, 5):
        z = deck_im_fenster(r, d, s0, s1)
        alle = r["deck"].get(d, [])
        decks[d] = {"meldungen": len(z), "laeuft_anteil": round(sum(m[1] == 2 for m in z) / len(z), 4) if z else None,
                    "ring_hoerbar_anteil": round(sum(m[2] == 1 for m in z) / len(z), 4) if z else None,
                    "keylock_unterlauf": max((m[3] for m in alle), default=None),
                    "keylock_aufgegeben": max((m[4] for m in alle), default=None)}
    erg["decks"] = decks
    kz = [m for m in r["kern"] if s0 <= m[0] < s1]
    gen = kz[-1][1] if kz else None
    erg["frame_luecken"] = max((m[2] for m in r["kern"] if m[1] == gen), default=None)
    erg["cb_max_us_im_lauf"] = max((m[3] for m in kz), default=None)
    erg["stretcher_aktiv_max"] = max((m[4] for m in kz), default=None)
    erg["zustand_kern_meldungen"] = len(kz)
    zs = [x for x in (o / "kern.err").read_text(errors="replace").splitlines() if x.startswith('{"zyklen"')]
    erg["schlusszeile"] = json.loads(zs[-1]) if zs else None
    ok_d = all(v["meldungen"] > 1000 and v["laeuft_anteil"] == 1.0 and v["ring_hoerbar_anteil"] == 1.0
               for v in decks.values())
    grenzen = {"vier_decks_im_keylock": ok_d,
               "unterlauf_0": all(v["keylock_unterlauf"] == 0 and v["keylock_aufgegeben"] == 0 for v in decks.values()),
               "frame_luecken_0": erg["frame_luecken"] == 0,
               "cb_max_2500": erg["cb_max_us_im_lauf"] is not None and erg["cb_max_us_im_lauf"] <= 2500,
               "karte_wie_kern": erg["karte_gegen_uhr_beats"] < 1e-6}
    if erg["schlusszeile"]:
        grenzen["cb_max_2500_schlusszeile"] = erg["schlusszeile"].get("cb_max_us", 1e9) <= 2500
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


# Art hoerprobe (Task 4 Step 4 liegt bei Andreas; hier nur das Material): echter Track aus bestand/ (--echt), Start Beat 8
# auf --quell, Rampe 128 -> 136 ab Beat 24 über 16 Beats, 136 bis Beat 56; --keylock-aus für den Vergleich. Schreibt
# hoerprobe.wav (Master, 16 bit, 48 kHz) in den Lauf-Ordner.
HP_START, HP_RAMPE_AB, HP_RAMPE_BEATS, HP_ZIEL, HP_ENDE = 8, 24.0, 16.0, 136.0, 56


def hp_karte() -> KarteP:
    k = KarteP()
    k.rampe(HP_RAMPE_AB, HP_ZIEL, HP_RAMPE_BEATS)
    return k


def art_hoerprobe(a: Aufbau, arg) -> dict:
    mid, fas = arg.echt.split(":")[0], int(arg.echt.split(":")[1])
    kopie = in_arbeitsbestand(a.ab, mid, fas, Path(arg.bestand) if arg.bestand else None)
    try:
        a.set_neu()
        if not a.laden(1, mid, frist=120.0, fassung=fas)[0]:
            raise RuntimeError("Track lädt nicht")
        a.teil("deck/1/fader", 4.0, 0.0)
        if arg.keylock_aus:
            a.teil("keylock", 5.0, 0.0)
        a.start(1, float(HP_START), float(arg.quell))
        r = tempo_rampe(a, HP_RAMPE_AB, HP_ZIEL, HP_RAMPE_BEATS)
        k = hp_karte()
        a.stopp(1, float(HP_ENDE))
        if arg.keylock_aus:
            a.teil("keylock", HP_ENDE + 1.0, 1.0)
        a.warte_sample(int(k.sample_at(HP_ENDE + 3)))
    finally:
        if kopie and kopie.get("kopiert"):
            shutil.rmtree(Path(kopie["ordner"]).parent.parent, ignore_errors=True)
    return {"echt": arg.echt, "quell": arg.quell, "keylock_aus": arg.keylock_aus, "kopie": kopie,
            "rampe_quittung": [a.quittung(r, x, 1.0) for x in (1, 6)], "zustand_kern_ende": a.zustand_kern()}


# Art s2 (Umbauplan Bungee S2): ein echter Track (--echt, --quell) ab Takt 104 bei 135 BPM, Keylock-Maschine aus kern.toml
# (--maschine). Karte auf 135 vor dem Start (Fader bei Beat 4 auf 128: der Hörschein gilt nur bei Tempo ±0,5 %; Rampe Beat 6 über 2 Beats), Start bei Beat 10 auf --quell - 4; ab Beat 14 (= --quell) werden
# 30 s als s2.wav geschnitten (die Varispeed-Brücke des Starts liegt davor).
S2_START, S2_RAMPE_AB, S2_RAMPE_BEATS, S2_ZIEL, S2_SCHNITT, S2_SEKUNDEN = 10, 6.0, 2.0, 135.0, 14.0, 30


def s2_karte() -> KarteP:
    k = KarteP()
    k.rampe(S2_RAMPE_AB, S2_ZIEL, S2_RAMPE_BEATS)
    return k


def art_s2(a: Aufbau, arg) -> dict:
    mid, fas = arg.echt.split(":")[0], int(arg.echt.split(":")[1])
    kopie = in_arbeitsbestand(a.ab, mid, fas, Path(arg.bestand) if arg.bestand else None)
    try:
        a.set_neu()
        if not a.laden(1, mid, frist=120.0, fassung=fas)[0]:
            raise RuntimeError("Track lädt nicht")
        a.teil("deck/1/fader", 4.0, 0.0)
        r = tempo_rampe(a, S2_RAMPE_AB, S2_ZIEL, S2_RAMPE_BEATS)
        s1 = a.start(1, float(S2_START), float(arg.quell) - (S2_SCHNITT - S2_START))
        k = s2_karte()
        ende = k.beat_at(k.sample_at(S2_SCHNITT) + (S2_SEKUNDEN + 3) * RATE)
        a.warte_sample(int(k.sample_at(ende)))
        a.stopp(1, float(int(ende) + 1))
        a.warte_sample(int(k.sample_at(int(ende) + 3)))
    finally:
        if kopie and kopie.get("kopiert"):
            shutil.rmtree(Path(kopie["ordner"]).parent.parent, ignore_errors=True)
    return {"echt": arg.echt, "quell": arg.quell, "maschine": OPT["maschine"] or "r3", "kopie": kopie,
            "start_quittung": a.quittung(s1, 2, 1.0), "rampe_quittung": [a.quittung(r, x, 1.0) for x in (1, 6)],
            "zustand_kern_ende": a.zustand_kern()}


def werte_s2(o: Path, lauf: dict, bezug: str | None = None) -> tuple[dict, int]:
    x, meta, s_a, erg = fehler_aufnahme(o, lauf)
    if "fehler" in erg:
        return erg, 2
    k = s2_karte()
    i0 = int(k.sample_at(S2_SCHNITT) - s_a)
    i1 = i0 + S2_SEKUNDEN * RATE
    if i0 < 0 or i1 > x.shape[0]:
        erg["fehler"] = "Schnitt liegt außerhalb der Aufnahme"
        return erg, 2
    wav_schreiben(o / "s2_roh.wav", x[i0:i1, :2])
    r = reihen(o / "abonnent.jsonl")
    dz = deck_im_fenster(r, 1, k.sample_at(S2_SCHNITT), k.sample_at(S2_SCHNITT) + S2_SEKUNDEN * RATE)
    ende = r["deck"].get(1, [(0, 0, 0, -1, -1)])[-1]
    erg.update({"wav": str(o / "s2_roh.wav"), "spitze": float(np.max(np.abs(x[i0:i1, :2]))),
                "ring_hoerbar_anteil": round(sum(z[2] == 1 for z in dz) / len(dz), 4) if dz else None,
                "keylock_unterlauf": ende[3], "keylock_aufgegeben": ende[4], "maschine": lauf["maschine"],
                "karte_gegen_uhr_beats": karte_gegen_uhr(k, r)})
    grenzen = {"signal": erg["spitze"] > 0.01, "ring_hoerbar": erg["ring_hoerbar_anteil"] == 1.0,
               "unterlauf_0": ende[3] == 0 and ende[4] == 0, "karte_passt": erg["karte_gegen_uhr_beats"] < 1e-6}
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


# Art s3 (Umbauplan Bungee S3, Gate Last): 4 Decks (Deck 1 mit vier Stems) + 2 Loop-Boxen im Keylock, Maschine aus kern.toml
# (--maschine), --sekunden lang im Messfenster. Tempo 130, Rampen 130 -> 136 -> 130 (16 Beats, alle 64 Beats), ab dem Fenster alle
# --ereignisse-s Sekunden ein Box-Ereignis (laden, start, stopp, raster; dieselbe Folge in jedem Lauf, Zufall mit Saat 9).
#   --s3-modus normal  Rampen und Box-Ereignisse (30 in 300 s bei 10 s).
#   --s3-modus sturm   Rampen, dazu --sturm-n mal der Knopf keylock aus und 3 Beats später an (alle 8 Beats): beim Einschalten
#                      setzen alle Quellen im selben Zyklus an (Kontrolle: antrieb.ansaetze_max_zyklus des Kerns = 6).
#   --last-prozesse N  künstliche Last: N nice-19-Rechenschleifen (sha256sum /dev/zero), nur per PID beendet; Lauf beginnt, wenn
#                      loadavg(1 min) >= --last-ziel (höchstens 300 s Anlauf). Ohne Last gilt loadavg < 8 zum Start (sonst 2).
# Gate je Lauf: frame_luecken 0 im Fenster, keylock_unterlauf 0, aufgegeben 0, cb_max_us <= 2500 (Sturm <= 4000).
S3_BPM0, S3_BPM1, S3_RAMPE_BEATS, S3_RAMPE_ABSTAND, S3_CB_NORMAL, S3_CB_STURM, S3_LAST_GATE = 130.0, 136.0, 16.0, 64.0, 2500, 4000, 8.0


def last_starten(n: int, ziel: float, max_s: float = 300.0) -> tuple[list, dict]:
    """n nice-19-Rechenschleifen; wartet, bis loadavg(1 min) >= ziel. Beendet wird nur per PID (last_beenden)."""
    procs = [subprocess.Popen(["nice", "-n", "19", "sha256sum", "/dev/zero"], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL) for _ in range(n)]
    info = {"prozesse": [p.pid for p in procs], "last_vor_start": None, "anlauf_s": None}
    t0 = time.monotonic()
    while time.monotonic() - t0 < max_s and float(last()) < ziel:
        time.sleep(2)
    info.update({"anlauf_s": round(time.monotonic() - t0, 1), "last_nach_anlauf": last()})
    return procs, info


def last_beenden(procs: list):
    for p in procs:
        if p.poll() is None:
            p.terminate()
    for p in procs:
        try:
            p.wait(10)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait(10)


def art_s3(a: Aufbau, arg) -> dict:
    sys.modules["ziel_lauf"] = sys.modules[__name__]  # ziel_lauf_boxen importiert uns: dieselbe Datei, dasselbe OPT
    import random
    import ziel_lauf_boxen as zb
    bpm0 = S3_BPM0
    beats = int((arg.sekunden + 60) * 140 / 60) + 128
    klick_fassung(a.ab, "c1c00000000000b1", "--beats", str(beats), "--stems", "--summe-als", "c1c00000000000b2")
    for n in (3, 4):
        klick_fassung(a.ab, f"c1c00000000000b{n}", "--beats", str(beats))
    lo = zb.loop_ordner(a)
    lo.mkdir(parents=True, exist_ok=True)
    zb.schreibe_klick_loop(lo / "g1klick")
    zb.kopiere_loop(zb.MUSIK, lo / "g1musik")
    aus = {"bpm_soll": bpm0, "bpm_uhr": zb.set_neu_bpm(a, bpm0), "s3_modus": arg.s3_modus, "maschine": OPT["maschine"] or "r3"}
    if aus["bpm_uhr"] is None or abs(aus["bpm_uhr"] - bpm0) > 0.05:
        aus["ungueltig"] = f"/uhr meldet {aus['bpm_uhr']} statt {bpm0}"
        return aus
    for d, mid, st in ((1, "c1c00000000000b1", 1), (2, "c1c00000000000b2", 0), (3, "c1c00000000000b3", 0),
                       (4, "c1c00000000000b4", 0)):
        if not a.laden(d, mid, mit_stems=st)[0]:
            raise RuntimeError(f"Deck {d} lädt nicht")
        zb.teil_bpm(a, f"deck/{d}/fader", 4.0, -6.0, bpm0)
        zb.start_pruef(a, d, 8.0, 0.0)
    zb.loop_befehl(a, "/k/loop/laden", 1, "g1klick", 3)
    zb.loop_befehl(a, "/k/loop/laden", 2, "g1musik", 3)
    zb.loop_befehl(a, "/k/loop/start", 1)
    zb.loop_befehl(a, "/k/loop/start", 2)
    pid = a.proc["kern"].pid
    ende = time.monotonic() + 10
    while "Keylock bereit" not in (a.o / "kern.err").read_text(errors="replace"):
        if time.monotonic() > ende:
            raise RuntimeError("Keylock wird nicht bereit (kern.err)")
        a.abo.pumpe()
    rampen, b, hoch = [], 16.0, True
    while b < beats - 64:
        rampen.append((b, S3_BPM1 if hoch else S3_BPM0))
        b += S3_RAMPE_ABSTAND
        hoch = not hoch
    ri = 0

    def beat_jetzt():
        for m in reversed(a.abo.eingang):
            if m.adresse == "/uhr":
                return float(m.werte[2])
        return 0.0

    def rampen_bis(bj):
        nonlocal ri
        while ri < len(rampen) and rampen[ri][0] <= bj + 8:
            r = a.merke(a.nid(), f"/k/tempo/rampe ab {rampen[ri][0]}")
            a.sende("/k/tempo/rampe", ",hsddd", r, "pruefstand", rampen[ri][0], rampen[ri][1], S3_RAMPE_BEATS)
            ri += 1

    while beat_jetzt() < 12.0:  # Einschwingen, dann das Fenster
        a.abo.pumpe()
        a.abweisungen()
        rampen_bis(beat_jetzt())
    n_ein = len(a.abo.eingang)
    t0, last_fenster_anfang = time.monotonic(), last()
    rng = random.Random(9)
    ereignisse, stuerme = [], []
    naechstes = t0 + arg.ereignisse_s if (arg.s3_modus == "normal" and arg.ereignisse_s > 0) else float("inf")
    sturm_beat = beat_jetzt() + 12.0
    while time.monotonic() < t0 + arg.sekunden:
        a.abo.pumpe()
        a.abweisungen()
        bj = beat_jetzt()
        rampen_bis(bj)
        if arg.s3_modus == "sturm" and len(stuerme) < arg.sturm_n and bj + 2.0 >= sturm_beat:
            a.teil("keylock", sturm_beat, 0.0)       # aus: Decks und Boxen gehen auf den Direktweg ...
            a.teil("keylock", sturm_beat + 3.0, 1.0)  # ... an: alle sechs setzen im selben Zyklus an
            stuerme.append((round(time.monotonic() - t0, 1), sturm_beat))
            sturm_beat += 8.0
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
    if arg.s3_modus == "sturm":  # der letzte Sturm muss ausklingen
        t1 = time.monotonic() + 6
        while time.monotonic() < t1:
            a.abo.pumpe()
            a.abweisungen()
    last_fenster_ende, t_ende = last(), time.monotonic()
    fenster = a.abo.eingang[n_ein:]
    zk = [m.werte for m in fenster if m.adresse == "/zustand/kern"]
    zd, zbx = {}, {}
    for m in fenster:
        if m.adresse == "/zustand/deck":
            zd[m.werte[0]] = m.werte
        elif m.adresse == "/zustand/box":
            zbx[m.werte[0]] = m.werte
    aus.update({
        "fenster_s": round(t_ende - t0, 1), "last_fenster_anfang": last_fenster_anfang, "last_fenster_ende": last_fenster_ende,
        "zk_n": len(zk), "cb_max_us_fenster": max((w[5] for w in zk), default=None),
        "frame_luecken_fenster": (zk[-1][3] - zk[0][3]) if zk and zk[0][0] == zk[-1][0] else None,
        "frame_luecken_ende": zk[-1][3] if zk else None,
        "deck_zustand_ende": {d: {"status": w[1], "hoerweg": w[9], "keylock_unterlauf": w[12], "keylock_aufgegeben": w[13]}
                              for d, w in zd.items()},
        "box_zustand_ende": {b: {"status": w[1], "keylock_unterlauf": w[2], "keylock_aufgegeben": w[3], "keylock_ring_voll": w[4]}
                             for b, w in zbx.items()},
        "rampen_gesendet": ri, "kern_pid": pid, "ereignisse": ereignisse, "stuerme": stuerme})
    return aus


def werte_s3(o: Path, lauf: dict) -> tuple[dict, int]:
    erg = dict(lauf)
    if lauf.get("ungueltig"):
        return erg, 2
    z = (o / "kern.err").read_text(errors="replace").splitlines()
    sz = [x for x in z if x.startswith('{"zyklen"')]
    kl = [x for x in z if x.startswith('{"keylock"')]
    if not sz or not kl:
        erg["ungueltig"] = "keine Schlusszeile des Kerns"
        return erg, 2
    sch, k = json.loads(sz[-1]), json.loads(kl[-1])["keylock"]
    erg.update({"schluss": sch, "keylock": k})
    sturm = lauf["s3_modus"] == "sturm"
    grenze_cb = S3_CB_STURM if sturm else S3_CB_NORMAL
    zd, zbx, le = lauf.get("deck_zustand_ende", {}), lauf.get("box_zustand_ende", {}), k["leser"]
    unterlauf = sum(x["unterlauf"] for x in le) + sum(w["keylock_unterlauf"] for w in list(zd.values()) + list(zbx.values()))
    aufgegeben = sum(x["aufgegeben"] for x in le) + sum(w["keylock_aufgegeben"] for w in list(zd.values()) + list(zbx.values()))
    ant = k.get("antrieb", {})
    erg.update({"unterlauf_summe": unterlauf, "aufgegeben_summe": aufgegeben, "cb_grenze_us": grenze_cb,
                "cb_p50_us": sch["cb_p50_us"], "cb_p99_us": sch["cb_p99_us"], "cb_p999_us": sch["cb_p999_us"],
                "cb_max_us_schluss": sch["cb_max_us"], "frame_luecken_gesamt": sch["frame_luecken_gesamt"],
                "render_p999_max_quellen_us": max((q["render_p999_us"] for q in k["quellen"] if q), default=None)})
    kontrollen = {"decks_und_boxen_rechnen": all(q and q["render_n"] > 0 for q in k["quellen"]),
                  "gelesen_alle": all(x["gelesen"] > 0 for x in le), "box_zustand_da": len(zbx) == 2,
                  "last_gate": (float(lauf["last_vorher"]) < S3_LAST_GATE) or bool(lauf.get("last_prozesse"))}
    if lauf.get("last_prozesse"):
        kontrollen["last_erreicht"] = float(lauf.get("last_fenster_anfang", 0)) >= 0.9 * lauf["last_ziel"]
    if sturm:
        kontrollen["sturm_n"] = len(lauf["stuerme"]) >= lauf["sturm_n"]
        if lauf["maschine"] != "r3":
            kontrollen["sechs_im_selben_zyklus"] = ant.get("ansaetze_max_zyklus", 0) >= 6
    else:
        kontrollen["ereignisse_erwartet"] = len(lauf["ereignisse"]) >= int(lauf["fenster_s"] / lauf["ereignisse_s"]) - 1
    erg["kontrollen"] = kontrollen
    grenzen = {"frame_luecken_0": lauf.get("frame_luecken_fenster") == 0, "keylock_unterlauf_0": unterlauf == 0,
               "aufgegeben_0": aufgegeben == 0,
               "cb_max_le_grenze": lauf.get("cb_max_us_fenster") is not None and lauf["cb_max_us_fenster"] <= grenze_cb,
               "ring_voll_0": sum(q["ring_voll"] for q in k["quellen"] if q) == 0}
    erg["grenzen"] = grenzen
    if not all(kontrollen.values()):
        erg["ungueltig"] = "Kontrolle gerissen: " + ", ".join(n for n, v in kontrollen.items() if not v)
        return erg, 2
    return erg, 0 if all(grenzen.values()) else 1


def wav_schreiben(pfad: Path, x: np.ndarray):
    import wave
    y = np.clip(np.round(x * 32767.0), -32768, 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(y.tobytes())


def werte_hoerprobe(o: Path, lauf: dict, bezug: str | None = None) -> tuple[dict, int]:
    x, meta, s_a, erg = fehler_aufnahme(o, lauf)
    if "fehler" in erg:
        return erg, 2
    k = hp_karte()
    i0, i1 = int(k.sample_at(HP_START - 0.5) - s_a), int(k.sample_at(HP_ENDE) + RATE - s_a)
    wav_schreiben(o / "hoerprobe.wav", x[i0:i1, :2])
    r = reihen(o / "abonnent.jsonl")
    dz = deck_im_fenster(r, 1, k.sample_at(HP_RAMPE_AB + 1), k.sample_at(HP_ENDE - 1))
    erg.update({"wav": str(o / "hoerprobe.wav"), "wav_s": round((i1 - i0) / RATE, 2),
                "spitze": float(np.max(np.abs(x[i0:i1, :2]))),
                "ring_hoerbar_anteil": round(sum(z[2] == 1 for z in dz) / len(dz), 4) if dz else None,
                "karte_gegen_uhr_beats": karte_gegen_uhr(k, r)})
    grenzen = {"signal": erg["spitze"] > 0.01,
               "weg_wie_bestellt": erg["ring_hoerbar_anteil"] == (0.0 if lauf["keylock_aus"] else 1.0)}
    erg["grenzen"] = grenzen
    return erg, 0 if all(grenzen.values()) else 1


ARTEN = {"kosten": (art_kosten, werte_kosten), "klick": (art_klick, werte_klick), "m8": (art_m8, werte_m8), "stems": (art_stems, werte_stems),
         "neustart": (art_neustart, werte_neustart), "tempo": (art_tempo, werte_tempo),
         "keylock": (art_keylock, werte_keylock), "drums": (art_drums, werte_drums),
         "keylock4": (art_keylock4, werte_keylock4),
         "hoerprobe": (art_hoerprobe, werte_hoerprobe), "s2": (art_s2, werte_s2), "s3": (art_s3, werte_s3)}


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
    # Task 4.2 bis 4.5 (Keylock)
    ap.add_argument("--material", choices=("klick", "sinus", "sinusrein"), default="klick",
                    help="keylock: Klick; Sinus links und Klick rechts; reiner Sinus auf beiden Kanälen")
    ap.add_argument("--keylock-aus", action="store_true", help="keylock, hoerprobe: Regler keylock 0 (Fehlerfall)")
    ap.add_argument("--bezug", help="keylock: Lauf-Ordner mit --keylock-aus, je Klick gegen diesen Varispeed-Bezug")
    ap.add_argument("--bpm", type=float, default=132.0, help="drums: Tempo der Karte")
    ap.add_argument("--drum-wav", default=str(DJK.parent / "loops" / "mfb_drums_8.wav"), help="drums: Drum-Loop (WAV)")
    ap.add_argument("--drum-bpm", type=float, default=134.0, help="drums: Tempo des Loops (Raster der WAV)")
    ap.add_argument("--quell", type=float, default=160.0, help="hoerprobe: Quell-Beat am Start")
    ap.add_argument("--bestand", default="", help="hoerprobe: bestand/ (Vorgabe DJK.parent/bestand)")
    ap.add_argument("--maschine", default="", choices=("", "r3", "bungee", "bungee_fein"),
                    help="Bungee S2: kern.toml keylock_maschine der Prüfinstanz (leer: wie die Vorlage konfig/kern.toml)")
    ap.add_argument("--aufnehmer", default="", help="Pfad cypherdj-aufnehmer4 (Vorgabe DJK/kern/build)")
    ap.add_argument("--notbahn", default="", help="Pfad cypherdj-notbahn (Vorgabe DJK/notbahn/build)")
    ap.add_argument("--s3-modus", default="normal", choices=("normal", "sturm"), help="s3: Normallauf oder Knopf-Sturm")
    ap.add_argument("--sturm-n", type=int, default=24, help="s3 sturm: Zahl der Stürme (Knopf aus/an)")
    ap.add_argument("--ereignisse-s", type=float, default=10.0, help="s3 normal: alle so viele Sekunden ein Box-Ereignis")
    ap.add_argument("--last-prozesse", type=int, default=0, help="s3: künstliche Last, so viele nice-19-Rechenschleifen")
    ap.add_argument("--last-ziel", type=float, default=18.0, help="s3: loadavg(1 min), ab der der Lauf beginnt")
    a = ap.parse_args(argv)
    OPT.update({"maschine": a.maschine, "aufnehmer": a.aufnehmer, "notbahn": a.notbahn})
    lauf_fn, werte_fn = ARTEN[a.art]
    if a.nur_auswerten:
        o = Path(a.nur_auswerten)
        lauf = json.loads((o / "lauf.json").read_text())
    else:
        o = HIER / "laeufe" / f"{a.lauf}-{time.strftime('%Y%m%d-%H%M%S')}"
        o.mkdir(parents=True)
        sek = {"klick": a.minuten * 60 + 60, "m8": 150, "stems": 60, "neustart": a.abschuss_s + 60,
               "kosten": a.sekunden + 30, "tempo": 90, "keylock": 90,
               "drums": dr_karte(a.bpm).sample_at(DR_B + DR_N + 6) / RATE + 30,
               "keylock4": a.sekunden + 90, "hoerprobe": 60, "s2": 75, "s3": a.sekunden + 90}[a.art]
        lauf = {"art": a.art, "lauf": a.lauf, "kern": a.kern, "kern_args": a.kern_arg, "last_vorher": last(),
                "start": time.strftime("%Y-%m-%dT%H:%M:%S")}
        last_procs = []
        if a.art == "s3":
            lauf.update({"s3_modus": a.s3_modus, "sturm_n": a.sturm_n, "ereignisse_s": a.ereignisse_s,
                         "last_prozesse": a.last_prozesse, "last_ziel": a.last_ziel, "sekunden": a.sekunden})
        try:
            if a.art == "s3" and a.last_prozesse > 0:  # künstliche Last: vor dem Aufbau, damit loadavg beim Fenster steht
                last_procs, info = last_starten(a.last_prozesse, a.last_ziel)
                lauf.update({"last_info": info, "last_vorher": last()})
            with Aufbau(o, a.lauf, a.kern, a.kern_arg, sek) as auf:
                lauf.update(lauf_fn(auf, a))
                ab = auf.ab
        except Exception as e:  # noqa: BLE001
            lauf["fehler"] = repr(e)
            (o / "lauf.json").write_text(json.dumps(lauf, indent=1, ensure_ascii=False))
            print(f"Aufbau gescheitert: {e!r} ({o})", file=sys.stderr)
            return 2
        finally:
            last_beenden(last_procs)  # nur per PID
        lauf["last_nachher"] = last()
        for p in ab.glob("c1c00000000000*"):  # eigenes Material wieder weg (die 3 GiB belegen RAM)
            shutil.rmtree(p, ignore_errors=True)
        for n in ("g1klick", "g1musik"):
            shutil.rmtree(ab.parent / "loops" / n, ignore_errors=True)
        (o / "lauf.json").write_text(json.dumps(lauf, indent=1, ensure_ascii=False, default=str))
    erg, rc = werte_fn(o, lauf, a.bezug) if a.art in ("keylock", "drums", "hoerprobe", "s2") else werte_fn(o, lauf)
    b = blind(o)
    if b:  # vor jeder Grenze: ein stiller Lauf besteht nichts, auch wo die Grenzen die Aufnahme nicht lesen (kosten)
        erg["fehler"] = b + (f"; dazu: {erg['fehler']}" if erg.get("fehler") else "")
        rc = 2
    erg.update({"art": a.art, "lauf": a.lauf, "ordner": str(o), "last_vorher": lauf.get("last_vorher"),
                "last_nachher": lauf.get("last_nachher"), "last_vmstat": last_vmstat(o), "rueckgabe": rc})
    (o / "ergebnis.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False, default=str))
    print(json.dumps(erg, ensure_ascii=False, default=str))
    return rc


if __name__ == "__main__":
    sys.exit(main())
