#!/usr/bin/env python3
"""Prüfläufe der Scheibe 35 am Ziel, stumm (SCHNITTSTELLEN §19.5, ROADMAP §8.4, §8.5): eigene Null-Senke mit vier
Kanälen je Lauf, der Kern an seinen eigenen Ausgängen (10k: --master <senke>:playback_F --cue <senke>:playback_R,
Selbst-Wächter 100 ms wie die Unit), JACK-Aufnehmer mit vier Kanälen am Monitor der Senke (cypherdj-aufnehmer4, 18),
ein OSC-Abonnent (djk/vertrag/attrappe_leitstand.py als Bibliothek), der Befehle schickt und alles protokolliert, und der
Softcontroller aus Scheibe 19 als ALSA-Gerät über die Midi-Bridge (Instanz-Suffix nach Z2). Kein Notbahn-Prozess: gemessen
wird am eigenen Kern-Ausgang (Plan 35 Architektur). Der Controller-Ordner der Instanz (~/.config/cypherdj-<i>/controller/)
bekommt vor jedem Lauf softcontroller.json, mvp_voll.json und kaputt_ziel.json (Plan 35 E7).

Die Klick-Träger-Fassung (traeger_fassung.py, links Klick je Beat, rechts 12-kHz-Träger) liegt auf Deck 1; der Fader
steht ab einem Beat vor dem Start auf −10 dB, Deck 1 startet auf einem ganzen Beat (Bezug für V, start.json).

Arten:
  latenz    Softcontroller --mess N (CC 1/7 = deck/1/fader, Werte i mod 128, Pause 13 bis 47 ms), --log senden.jsonl
  mutation  wie latenz mit dem Kern cypherdj-kern-mutation-folgeblock (Fehlerfall Plan 35 E2)
  ruhe      Softcontroller --sekunden lang verbunden, keine Taste (Negativ-Kontrolle: 0 /e/hand, 0 Sprünge, Überlauf 0)
  play      Play und Cue am Ziel (Tasten über den Softcontroller, /test/hand über OSC mit hand_osc = true), --mapping
  neustart  Hand über kill -9 des Kerns (Unit mit Restart=always): Wiederverbindung, erster Wert, Latenz danach (--n Griffe)
  spaet     Controller nach dem Kern: Verbinder verbindet binnen 500 ms nach dem Port, danach /e/hand (E8)
  mapping   /k/mapping am Ziel: tausch (Ziele wechseln), kaputt_ziel (abgelehnt pruefung, altes gilt weiter), zurück
  kaputt_start  Start mit kaputtem Mapping: Kern läuft und spielt, Fehler mit Zeile im Protokoll, 0 /e/hand
  betrieb   MVP-Schritt Betrieb: Unit-Kern ohne --konfig mit der Betriebs-kern.toml, /e/hand auf einen Softcontroller-Griff
  pegel     /pegel am Ziel: Sinus bekannter Pegel auf Deck 1, spitze_db gegen Erwartung und Aufnahme, Fader unten, Deck 2 leer
  osc_aus   Negativ-Kontrolle: /test/hand ohne hand_osc und ohne Prüfmodus wird abgewiesen, das Deck läuft weiter

Aufruf: ziel_hand.py --art latenz [--n 300] [--lauf NAME] [--kern PROG] [--sekunden 60]
Umgebung: CYPHERDJ_INSTANZ (Scheibe 35: i). Das Echtzeit-Schloss hält der Aufrufer (ziel_hand.sh).
Ergebnis: djk/kern/tests/hand/laeufe/<lauf>-<zeit>/ mit lauf.json und auswertung.json; Rückgabe der Auswertung.
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

HIER = Path(__file__).resolve().parent
DJK = HIER.parents[2]
sys.path.insert(0, str(DJK / "vertrag"))
import attrappe_leitstand as al  # noqa: E402

SPB = 22500
SOFT = DJK / "werkzeuge" / "softcontroller" / "build" / "softcontroller"
MAPPINGS = {"softcontroller.json": DJK / "konfig" / "controller" / "softcontroller.json",
            "mvp_voll.json": HIER / "mappings" / "mvp_voll.json",
            "kaputt_ziel.json": HIER / "mappings" / "kaputt_ziel.json",
            "tausch.json": HIER / "mappings" / "tausch.json"}


def instanz():
    i = os.environ.get("CYPHERDJ_INSTANZ", "")
    if len(i) != 1 or not "a" <= i <= "i":
        raise SystemExit("CYPHERDJ_INSTANZ setzen (Scheibe 35: export CYPHERDJ_INSTANZ=i)")
    return i, ord(i) - 96


def last():
    return open("/proc/loadavg").read().strip()


class Aufbau:
    """Senke, Kern, Aufnehmer und Abonnent; räumt beim Verlassen alles weg (auch bei Fehlern)."""

    def __init__(self, o: Path, name: str, kern: str, toml: dict, sekunden: float, kern_args=(), als_unit=False,
                 soft_vorher=None, konfig_standard=False):
        self.o, self.name, self.kern_prog, self.toml, self.sek, self.kern_args = o, name, kern, toml, sekunden, kern_args
        self.als_unit = als_unit        # Kern als transiente Unit mit den Eigenschaften der echten (Restart=always, RestartSec=0)
        self.soft_vorher = soft_vorher  # Argumente des Softcontrollers, der VOR dem Kern startet (Task 7)
        self.unit = f"djk35-kern-{instanz()[0]}"
        self.konfig_standard = konfig_standard  # Kern ohne --konfig und ohne --pruefmodus, Datei am Standardpfad der Instanz
        self.i, self.k = instanz()
        self.senke = f"cypherdj-pruef-{self.i}-h35{name}"[:60]
        self.shm = Path(f"/dev/shm/cypherdj-{self.i}")
        self.ab = self.shm / "material"
        self.controller = Path.home() / ".config" / f"cypherdj-{self.i}" / "controller"
        self.proc: dict[str, subprocess.Popen] = {}
        self.modul = None
        self.abo = None
        self.id = time.monotonic_ns()

    def starte(self, name, args, env=None, stdin=None):
        err = open(self.o / f"{name}.err", "a")
        self.proc[name] = subprocess.Popen(["pw-jack", "-p", "256", *args], stdout=subprocess.DEVNULL, stderr=err,
                                           env=env, stdin=stdin)
        return self.proc[name]

    def kern_starten(self):
        err = self.o / "kern.err"
        err.touch()
        schon = err.stat().st_size if err.exists() else 0
        argv = [self.kern_prog, "--konfig", str(self.o / "kern.toml"), "--master", f"{self.senke}:playback_F", "--cue",
                f"{self.senke}:playback_R", "--waechter-ms", "100", *self.kern_args]
        if self.konfig_standard:  # wie die Betriebs-Unit: keine --konfig, die Datei liegt unter ~/.config/cypherdj-<i>/kern.toml
            del argv[1:3]
        if self.als_unit:  # wie die echte Unit (djk/units/cypherdj-kern.service): systemd startet nach kill -9 neu
            sys.path.insert(0, str(DJK / "kern" / "tests" / "neustart"))
            import unit_eigenschaften as ue  # noqa: E402
            subprocess.run(["systemctl", "--user", "reset-failed", self.unit], capture_output=True)
            cmd = ["systemd-run", "--user", "--unit", self.unit, "-G"]
            for e in ue.eigenschaften(str(DJK / "units" / "cypherdj-kern.service")):
                cmd += ["-p", e]
            cmd += ["-p", f"Environment=CYPHERDJ_INSTANZ={self.i}", "-p", f"StandardError=append:{err}", "-p",
                    f"StandardOutput=append:{self.o / 'kern.out'}", "--", "/usr/bin/pw-jack", "-p", "256", *argv]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f"systemd-run gescheitert: {r.stderr[-400:]}")
            p = None
        else:
            p = self.starte("kern", argv)
        ende = time.monotonic() + 10
        while time.monotonic() < ende:
            if "läuft" in err.read_bytes()[schon:].decode(errors="replace"):
                return p
            if p is not None and p.poll() is not None:
                break
            time.sleep(0.05)
        raise RuntimeError(f"Kern startet nicht: {err.read_text(errors='replace')[-800:]}")

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
        self.controller.mkdir(parents=True, exist_ok=True)
        for n, q in MAPPINGS.items():
            if q.exists():
                shutil.copyfile(q, self.controller / n)
        zeilen = []
        for z in (DJK / "konfig" / "kern.toml").read_text().splitlines():
            k = z.split("=", 1)[0].strip()
            if k in self.toml:
                v = self.toml.pop(k)
                z = f"{k} = " + (json.dumps(v) if isinstance(v, str) else ("true" if v is True else "false"
                                                                            if v is False else str(v)))
            zeilen.append(z)
        zeilen += [f"{k} = " + (json.dumps(v) if isinstance(v, str) else ("true" if v is True else "false"
                                                                         if v is False else str(v)))
                   for k, v in self.toml.items()]
        (self.o / "kern.toml").write_text("\n".join(zeilen) + "\n")
        if self.konfig_standard:  # Kopie der Betriebs-kern.toml an den Standardpfad der Prüfinstanz (nichts überschreiben)
            ziel = self.controller.parent / "kern.toml"
            if ziel.exists():
                raise RuntimeError(f"{ziel} existiert schon")
            shutil.copyfile(Path.home() / ".config" / "cypherdj" / "kern.toml", ziel)
            self.eigene_konfig = ziel
        self.modul = subprocess.run(["pactl", "load-module", "module-null-sink", f"sink_name={self.senke}", "channels=4",
                                     "channel_map=front-left,front-right,rear-left,rear-right",
                                     f"sink_properties=node.description={self.senke}"],
                                    capture_output=True, text=True, check=True).stdout.strip()
        for _ in range(50):
            if f"{self.senke}:playback_FL" in subprocess.run(["pw-link", "-i"], capture_output=True, text=True).stdout:
                break
            time.sleep(0.1)
        if self.soft_vorher is not None:
            self.softcontroller(self.soft_vorher)
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
            if self.abo:
                self.abo.pumpe()
                self.abo.schliesse()
        except Exception:  # noqa: BLE001
            pass
        if getattr(self, "eigene_konfig", None) and self.eigene_konfig.exists():
            self.eigene_konfig.unlink()  # die von diesem Lauf angelegte Prüfinstanz-Datei
        if self.als_unit:
            subprocess.run(["systemctl", "--user", "stop", self.unit], capture_output=True, timeout=15)
            subprocess.run(["systemctl", "--user", "reset-failed", self.unit], capture_output=True)
        for name in ("soft", "kern", "aufnehmer"):
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

    def nid(self):
        self.id += 1
        return self.id

    def sende(self, adresse, typen, *werte):
        self.abo.schicke(adresse, typen, list(werte))

    def pumpe_bis(self, bed, frist, was):
        ende = time.monotonic() + frist
        while time.monotonic() < ende:
            self.abo.pumpe()
            if bed():
                return
        raise RuntimeError(f"{was}: nicht in {frist} s")

    def warte_beat(self, b):
        self.pumpe_bis(lambda: (self.abo.sample_jetzt() or -1) >= b * SPB, 600, f"Beat {b}")

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
        self.abo.set_neu = i
        self.sende("/k/set/neu", ",hsd", i, "pruefstand", 128.0)
        if not self.quittung(i, 2):
            raise RuntimeError("/k/set/neu ohne Quittung gestartet")
        self.pumpe_bis(lambda: self.abo.uhr is not None, 5, "/uhr der neuen Zeitachse")

    def laden(self, deck, mid):
        i = self.nid()
        self.sende("/k/deck/laden", ",hsisdii", i, "leitstand", deck, mid, 128.0, 1, 0)
        if not self.quittung(i, 3, 30.0):
            raise RuntimeError(f"Deck {deck}: {mid} nicht geladen")

    def teil(self, pfad, ab, wert, dauer=0.0, plan="", quelle="pruefstand"):
        i = self.nid()
        self.sende("/k/teil", ",hssisddfiiss", i, quelle, plan, 0, pfad, float(ab), float(dauer), float(wert), 0, 1,
                   "", "")
        return i

    def start(self, deck, ab, quell=0.0):
        i = self.nid()
        self.sende("/k/deck/start", ",hssssiddi", i, "andreas", "", "", "", deck, float(ab), float(quell), 0)
        return i

    def softcontroller(self, args=(), stdin=None):
        env = dict(os.environ, CYPHERDJ_INSTANZ=self.i)
        out = open(self.o / "soft.out", "a")
        self.proc["soft"] = subprocess.Popen([str(SOFT), *args], stdin=stdin if stdin is not None else subprocess.DEVNULL,
                                             stdout=out, stderr=out, env=env)
        return self.proc["soft"]

    def deck1_bereit(self, material="c1c0000000000035", fader_db=-10.0):
        """Deck 1 laden, Fader einen Beat vor dem Start auf fader_db, Start auf einem ganzen Beat; start.json."""
        self.set_neu()
        self.laden(1, material)
        b_fader = math.ceil((self.abo.sample_jetzt() or 0) / SPB) + 2
        b_start = b_fader + 1
        self.teil("deck/1/fader", b_fader, fader_db)
        s = self.start(1, b_start)
        (self.o / "start.json").write_text(json.dumps({"b_start": b_start, "s_start": b_start * SPB,
                                                       "fader_db": fader_db, "material": material}) + "\n")
        self.warte_beat(b_start + 1)
        if not self.quittung(s, 2, 2.0):
            raise RuntimeError("Deck 1 nicht gestartet")
        return b_start


VORLAUF_MS = 15000  # der Softcontroller wartet so lange mit dem ersten Griff: die Hand ist dann verbunden, das Deck läuft


def hand_zuerst(a: Aufbau, args, stdin=None):
    """Softcontroller starten und warten, bis der Verbinder hand_in verbunden hat, VOR dem Deck-Start. Befund des ersten
    Laufs (2026-09-26): die Verbindung ändert den Graphen (der Kern meldet /e/luecke, der Aufnehmer eine Lücke) und der
    Pfadversatz V des Kern-Ausgangs zur Aufnahme springt dabei um einen Block (341 davor, 85 danach); V muss im selben
    Zustand gemessen werden wie die Griffe."""
    p = a.softcontroller(args, stdin=stdin)
    kern_err = a.o / "kern.err"
    a.pumpe_bis(lambda: "hand_in verbunden" in kern_err.read_text(errors="replace"), 15, "hand_in verbunden")
    ende = time.monotonic() + 1.5  # Graph nach der Verbindung beruhigen lassen
    while time.monotonic() < ende:
        a.abo.pumpe()
    return p


def erste_sendung_nach(a: Aufbau, t_bereit_us: int):
    z = [json.loads(x) for x in (a.o / "senden.jsonl").read_text().splitlines() if x.startswith('{"typ":"gesendet"')]
    if not z or z[0]["t_send_us"] < t_bereit_us:
        raise RuntimeError("Softcontroller sendete vor dem Lauf des Decks (Vorlauf zu kurz)")


def art_latenz(a: Aufbau, arg):
    t0 = time.monotonic()
    p = hand_zuerst(a, ["--mess", str(arg.n), "--vorlauf-ms", str(VORLAUF_MS), "--log", str(a.o / "senden.jsonl")])
    b = a.deck1_bereit()
    a.warte_beat(b + 2)
    t_bereit_us = time.monotonic_ns() // 1000
    while p.poll() is None:
        a.abo.pumpe()
    ende = time.monotonic() + 1.0
    while time.monotonic() < ende:
        a.abo.pumpe()
    erste_sendung_nach(a, t_bereit_us)
    return {"b_start": b, "soft_rc": p.returncode, "soft_s": round(time.monotonic() - t0, 3)}


def art_ruhe(a: Aufbau, arg):
    p = hand_zuerst(a, [], stdin=subprocess.PIPE)  # verbunden, keine Taste (stdin offen, leer)
    b = a.deck1_bereit()
    a.warte_beat(b + 2)
    ende = time.monotonic() + arg.sekunden
    while time.monotonic() < ende:
        a.abo.pumpe()
    p.stdin.close()
    p.wait(5)
    ende = time.monotonic() + 1.0
    while time.monotonic() < ende:
        a.abo.pumpe()
    return {"b_start": b, "soft_rc": p.returncode, "ruhe_s": arg.sekunden}


def phase_warten(a: Aufbau, beat: int, phase: float):
    """Wartet, bis das Kern-Sample (beat + phase) · SPB erreicht ist (Uhr aus /uhr, extrapoliert)."""
    a.pumpe_bis(lambda: (a.abo.sample_jetzt() or -1) >= (beat + phase) * SPB, 600, f"Beat {beat} Phase {phase}")


def art_play(a: Aufbau, arg):
    """Play und Cue am Ziel (Plan 35 Task 5). Deck 1 startet vom Leitstand-Weg auf einem ganzen Beat (Bezug der Klicklage D),
    dann: Cue laufend (Taste v: Halt mit Rampe, zurück auf den Cue-Punkt 0), Play (Taste c, Phase 0,3: erster Klick auf dem
    nächsten Master-Beat), Cue über /test/hand, Play über /test/hand (Sample bei Phase 0,4), Play auf laufendem Deck (Halt).
    Die Tasten gehen über den Softcontroller (stdin) und das Mapping (--mapping mvp_voll: quant beat, softcontroller:
    sofort), die /test/hand-Griffe über OSC (kern.toml hand_osc = true)."""
    log = open(a.o / "schritte.jsonl", "w")

    def schritt(name, **kw):
        log.write(json.dumps({"schritt": name, **kw}) + "\n")
        log.flush()

    p = hand_zuerst(a, [], stdin=subprocess.PIPE)
    b0 = a.deck1_bereit()
    a.warte_beat(b0 + 6)  # sechs Klicks des Bezugsstarts

    def taste(z, name, beat, phase):
        phase_warten(a, beat, phase)
        t = time.monotonic_ns()
        p.stdin.write(z.encode())
        p.stdin.flush()
        schritt(name, t_ns=t, taste=z)

    def osc(name, pfad, roh, beat, phase):
        s = int((beat + phase) * SPB)
        a.sende("/test/hand", ",sfh", pfad, float(roh), s)
        schritt(name, sample=s, pfad=pfad, midi_roh=roh)

    n = b0 + 6
    taste("v", "cue_laufend", n, 0.5)                  # Cue laufend: Halt, zurück auf den Cue-Punkt
    taste("c", "play_beat_1", n + 3, 0.3)              # Play stehend: erster Klick auf Beat n + 4
    phase_warten(a, n + 10, 0.3)
    osc("osc_cue", "deck/1/cue", 1.0, n + 10, 0.5)     # /test/hand Cue laufend
    phase_warten(a, n + 12, 0.9)
    osc("osc_play", "deck/1/play", 1.0, n + 13, 0.4)   # /test/hand Play: Start auf Beat n + 14
    taste("c", "play_laufend", n + 20, 0.5)            # Play laufend: Halt
    phase_warten(a, n + 24, 0.0)
    ende = time.monotonic() + 1.0
    while time.monotonic() < ende:
        a.abo.pumpe()
    p.stdin.close()
    p.wait(5)
    return {"b_start": b0, "soft_rc": p.returncode, "mapping": arg.mapping}


def art_neustart(a: Aufbau, arg):
    """Hand über einen Kern-Neustart (Plan 35 Task 7): der Kern läuft als transiente Unit mit den Eigenschaften der echten
    (Restart=always, RestartSec=0), der Softcontroller sendet Fader-Griffe durch (--mess), Deck 1 spielt; nach etwa 5 s
    Griffen kill -9 auf den Hauptprozess der Unit. systemd startet neu, der Kern setzt Deck und Zeitachse fort (Scheibe 18),
    der Verbinder verbindet hand_in wieder (E8). Der Softcontroller startet VOR dem Kern (sein Port ist beim ersten Start
    des Kerns schon da), er wird nicht neu gestartet."""
    log = open(a.o / "schritte.jsonl", "w")
    kern_err = a.o / "kern.err"
    a.pumpe_bis(lambda: "hand_in verbunden" in kern_err.read_text(errors="replace"), 15, "hand_in verbunden (Kern 1)")
    ende = time.monotonic() + 1.5
    while time.monotonic() < ende:
        a.abo.pumpe()
    b0 = a.deck1_bereit()
    a.warte_beat(b0 + 2)
    senden = a.o / "senden.jsonl"
    a.pumpe_bis(lambda: senden.exists() and senden.read_text().count('"gesendet"') >= 170, 120, "170 Griffe gesendet")
    pid = int(subprocess.run(["systemctl", "--user", "show", "-p", "MainPID", "--value", a.unit], capture_output=True,
                             text=True).stdout.strip() or 0)
    if pid <= 0:
        raise RuntimeError("kein MainPID der Unit")
    t = time.monotonic_ns()
    os.kill(pid, signal.SIGKILL)
    log.write(json.dumps({"schritt": "kill", "pid": pid, "t_ns": t}) + "\n")
    log.flush()
    p = a.proc["soft"]
    while p.poll() is None:
        a.abo.pumpe()
    ende = time.monotonic() + 1.0
    while time.monotonic() < ende:
        a.abo.pumpe()
    neu = int(subprocess.run(["systemctl", "--user", "show", "-p", "MainPID", "--value", a.unit], capture_output=True,
                             text=True).stdout.strip() or 0)
    return {"b_start": b0, "soft_rc": p.returncode, "pid_alt": pid, "pid_neu": neu}


def art_spaet(a: Aufbau, arg):
    """Der Controller kommt nach dem Kern (E8): der Softcontroller startet erst, wenn Kern und Deck laufen; der Verbinder muss
    hand_in binnen 500 ms nach dem Erscheinen des Ports verbinden (Fehlerfall: Verbinder nur beim Start)."""
    b0 = a.deck1_bereit()
    a.warte_beat(b0 + 2)
    t = time.monotonic_ns()
    p = a.softcontroller(stdin=subprocess.PIPE)
    kern_err = a.o / "kern.err"
    ende = time.monotonic() + 6.0
    while time.monotonic() < ende and "hand_in verbunden" not in kern_err.read_text(errors="replace"):
        a.abo.pumpe()
    for _ in range(4):  # Fader-Tasten: CC 1/7 aufwärts, der erste Wert nur Stellung
        p.stdin.write(b"q")
        p.stdin.flush()
        pause = time.monotonic() + 0.15
        while time.monotonic() < pause:
            a.abo.pumpe()
    ende = time.monotonic() + 1.0
    while time.monotonic() < ende:
        a.abo.pumpe()
    p.stdin.close()
    p.wait(5)
    (a.o / "schritte.jsonl").write_text(json.dumps({"schritt": "softcontroller_start", "t_ns": t}) + "\n")
    return {"b_start": b0, "soft_rc": p.returncode}


def tasten(a: Aufbau, p, zeichen: str, pause=0.15):
    for z in zeichen:
        p.stdin.write(z.encode())
        p.stdin.flush()
        ende = time.monotonic() + pause
        while time.monotonic() < ende:
            a.abo.pumpe()


def art_mapping(a: Aufbau, arg):
    """/k/mapping am Ziel (Plan 35 Task 8): Fader-Taste q (CC 1/7) erst nach softcontroller.json (deck/1/fader), nach
    /k/mapping tausch (CC 1/7 -> deck/2/fader) auf deck/2/fader, nach /k/mapping kaputt_ziel (abgelehnt, Zeile 5) weiter auf
    deck/2/fader, nach /k/mapping softcontroller wieder auf deck/1/fader."""
    log = open(a.o / "schritte.jsonl", "w")

    def schritt(name, **kw):
        log.write(json.dumps({"schritt": name, "t_ns": time.monotonic_ns(), **kw}) + "\n")
        log.flush()

    p = hand_zuerst(a, [], stdin=subprocess.PIPE)
    b0 = a.deck1_bereit()
    a.warte_beat(b0 + 2)
    schritt("taste_q_1")
    tasten(a, p, "qqq")
    for name, geraet, status in (("mapping_tausch", "tausch", 3), ("mapping_kaputt", "kaputt_ziel", 6),
                                 ("mapping_zurueck", "softcontroller", 3)):
        i = a.nid()
        schritt(name, id=i, geraet=geraet)
        a.sende("/k/mapping", ",hss", i, "leitstand", geraet)
        if not a.quittung(i, status, 3.0):
            raise RuntimeError(f"/k/mapping {geraet}: keine Quittung {status}")
        schritt(name + "_quittiert")
        tasten(a, p, "qqq")
        schritt(name + "_tasten")
    ende = time.monotonic() + 1.0
    while time.monotonic() < ende:
        a.abo.pumpe()
    p.stdin.close()
    p.wait(5)
    return {"b_start": b0, "soft_rc": p.returncode}


def art_kaputt_start(a: Aufbau, arg):
    """Start mit kaputtem Mapping (controller_geraet = kaputt_ziel): der Kern läuft und spielt, meldet den Fehler mit Zeile,
    der Softcontroller kann nichts bewirken (0 /e/hand)."""
    b0 = a.deck1_bereit()
    a.warte_beat(b0 + 2)
    p = a.softcontroller(stdin=subprocess.PIPE)
    ende = time.monotonic() + 1.5
    while time.monotonic() < ende:
        a.abo.pumpe()
    tasten(a, p, "qqqq")
    ende = time.monotonic() + 1.0
    while time.monotonic() < ende:
        a.abo.pumpe()
    p.stdin.close()
    p.wait(5)
    return {"b_start": b0, "soft_rc": p.returncode}


def art_betrieb(a: Aufbau, arg):
    """MVP-Schritt Betrieb (Plan 35 Task 9): der Kern startet als transiente Unit mit den Eigenschaften der echten, ohne
    --konfig und ohne --pruefmodus; seine kern.toml ist die Kopie der Betriebs-Datei ~/.config/cypherdj/kern.toml
    (controller_geraet softcontroller, hand_osc true), das Mapping liegt unter ~/.config/cypherdj-i/controller/. Nachweis:
    ein Softcontroller-Griff (Taste q) ergibt /e/hand auf deck/1/fader; /test/hand deck/2/fader wird ohne Prüfmodus
    angenommen (hand_osc)."""
    b0 = a.deck1_bereit()
    a.warte_beat(b0 + 2)
    p = hand_zuerst(a, [], stdin=subprocess.PIPE)
    tasten(a, p, "qqqq")
    for roh in (0.2, 0.7, 0.9):
        a.sende("/test/hand", ",sfh", "deck/2/fader", roh, int((a.abo.sample_jetzt() or 0) + 4000))
        ende = time.monotonic() + 0.15
        while time.monotonic() < ende:
            a.abo.pumpe()
    for roh, name in ((1.0, "taste/annehmen"), (0.0, "taste/annehmen"), (1.0, "taste/verwerfen")):  # Annahme-Weg der Oberfläche
        a.sende("/test/hand", ",sfh", name, roh, int((a.abo.sample_jetzt() or 0) + 4000))
        ende = time.monotonic() + 0.15
        while time.monotonic() < ende:
            a.abo.pumpe()
    ende = time.monotonic() + 1.0
    while time.monotonic() < ende:
        a.abo.pumpe()
    p.stdin.close()
    p.wait(5)
    return {"b_start": b0, "soft_rc": p.returncode}


def art_pegel(a: Aufbau, arg):
    """/pegel am Ziel (Vorgriff aus 43): Deck 1 spielt einen Sinus (1 kHz, 0,25) bei Fader −10 dB, erwartet deck/1 und master
    −22,04 dB; nach Beat b0 + 12 fährt der Fader auf −200 (Teil pruefstand), erwartet −200; Deck 2 ist leer."""
    log = open(a.o / "schritte.jsonl", "w")
    b0 = a.deck1_bereit()
    a.warte_beat(b0 + 10)
    n = b0 + 12
    a.teil("deck/1/fader", n, -200.0, 0.0)
    log.write(json.dumps({"schritt": "fader_unten", "beat": n}) + "\n")
    log.flush()
    a.warte_beat(n + 5)
    return {"b_start": b0}


def art_osc_aus(a: Aufbau, arg):
    """Negativ-Kontrolle: weder hand_osc noch Prüfmodus (kern.toml hand_osc = false): /test/hand wird abgewiesen
    (/e/protokollfehler unbekannte_adresse), das Deck läuft weiter."""
    log = open(a.o / "schritte.jsonl", "w")
    p = hand_zuerst(a, [], stdin=subprocess.PIPE)
    b0 = a.deck1_bereit()
    a.warte_beat(b0 + 6)
    s = int(((b0 + 6) + 0.5) * SPB)
    a.sende("/test/hand", ",sfh", "deck/1/cue", 1.0, s)
    log.write(json.dumps({"schritt": "osc_cue", "sample": s}) + "\n")
    log.flush()
    a.pumpe_bis(lambda: any(m.adresse == "/e/protokollfehler" for m in a.abo.eingang), 5, "/e/protokollfehler")
    phase_warten(a, b0 + 10, 0.0)
    p.stdin.close()
    p.wait(5)
    return {"b_start": b0, "soft_rc": p.returncode}


ARTEN = {"latenz": art_latenz, "mutation": art_latenz, "ruhe": art_ruhe, "play": art_play, "osc_aus": art_osc_aus,
         "neustart": art_neustart, "spaet": art_spaet, "mapping": art_mapping, "kaputt_start": art_kaputt_start,
         "betrieb": art_betrieb, "pegel": art_pegel}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Prüfläufe der Scheibe 35 am Ziel (stumm)")
    ap.add_argument("--art", required=True, choices=sorted(ARTEN))
    ap.add_argument("--lauf")
    ap.add_argument("--kern")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--sekunden", type=float, default=60.0)
    ap.add_argument("--mapping", default="mvp_voll", help="Mapping der Art play: mvp_voll (quant beat) oder softcontroller")
    ap.add_argument("--p50-bezug", type=float, default=5.333)
    a = ap.parse_args(argv)
    name = a.lauf or a.art
    kern = a.kern or str(DJK / "kern" / "build" / ("cypherdj-kern-mutation-folgeblock" if a.art == "mutation"
                                                   else "cypherdj-kern"))
    o = HIER / "laeufe" / f"{name}-{time.strftime('%Y%m%d-%H%M%S')}"
    o.mkdir(parents=True)
    toml = {"controller_geraet": "softcontroller"}
    if a.art == "kaputt_start":
        toml = {"controller_geraet": "kaputt_ziel"}
    if a.art == "play":
        toml = {"controller_geraet": a.mapping, "hand_osc": True}
    sek = {"latenz": 40 + a.n * 0.035, "mutation": 40 + a.n * 0.035, "ruhe": a.sekunden + 40, "play": 45.0,
           "osc_aus": 35.0, "spaet": 35.0, "mapping": 45.0, "kaputt_start": 35.0, "betrieb": 35.0, "pegel": 30.0, "neustart": 30 + a.n * 0.035 + 30}[a.art]
    lauf = {"art": a.art, "lauf": name, "kern": kern, "n": a.n, "start": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "last_vorher": last()}
    (o / "lauf.meta").write_text(f"last_vorher={lauf['last_vorher']}\n")
    try:
        extra = {}
        if a.art == "neustart":
            extra = {"als_unit": True, "soft_vorher": ["--mess", str(a.n), "--vorlauf-ms", "22000", "--log",
                                                       str(o / "senden.jsonl")]}
        if a.art == "betrieb":
            extra = {"als_unit": True, "konfig_standard": True}
        with Aufbau(o, name, kern, toml, sek, **extra) as auf:
            python_traeger = [sys.executable, str(HIER / "traeger_fassung.py"), "--ziel", str(auf.ab),
                              "--material-id", "c1c0000000000035", "--beats", str(int(sek * 128 / 60) + 16)]
            if a.art == "pegel":
                python_traeger += ["--freq", "1000", "--ohne-klick", "--traeger", "0.25"]
            subprocess.run(python_traeger, check=True, capture_output=True)
            lauf.update(ARTEN[a.art](auf, a))
    except Exception as e:  # noqa: BLE001
        lauf["fehler"] = repr(e)
        (o / "lauf.json").write_text(json.dumps(lauf, indent=1, ensure_ascii=False))
        print(f"Aufbau gescheitert: {e!r} ({o})", file=sys.stderr)
        return 2
    lauf["last_nachher"] = last()
    with open(o / "lauf.meta", "a") as f:
        f.write(f"last_nachher={lauf['last_nachher']}\n")
    (o / "lauf.json").write_text(json.dumps(lauf, indent=1, ensure_ascii=False))
    art = a.art
    extra = ["--p50-bezug", str(a.p50_bezug)] if art == "mutation" else []
    r = subprocess.run([sys.executable, str(HIER / "auswertung_hand.py"), str(o), "--art", art, *extra],
                       capture_output=True, text=True)
    (o / "auswertung.json").write_text(r.stdout)
    print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "LEER", o)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
