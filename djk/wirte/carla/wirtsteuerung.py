"""Steuerung des Carla-Wirts (Studio S5.3, ADR 009 Nr. 2: Unix-Socket nur lokal). Protokoll: eine JSON-Zeile hin,
eine zurück. Befehle: {"befehl":"lade","pfad":"/abs/klang.fxp"} → {"ok","name"} · {"befehl":"zustand"} →
{"ok","xml","patch_b64"} · {"befehl":"note","note":0..127,"velocity":1..127,"dauer":s} → {"ok"} ·
{"befehl":"fahre","name","bis","dauer"[,"von"][,"ab"][,"spur"][,"form"]} → {"ok"} (Studio S6: ab = Start in time.monotonic()
Sekunden, höchstens 1 s zurück und 1 h voraus; ohne von gilt der Ist-Wert beim Start; Studio S7: form linear (Vorgabe) oder s
wie im Kern, 3u²−2u³) · {"befehl":"halte"[,"spur"]} →
{"ok","gehalten"} (verwirft wartende und laufende Fahrten, mit spur nur deren). Fehler → {"ok": false, "fehler": "…"},
der Wirt läuft weiter. Getrennt von wirt.py, damit ohne Carla testbar."""
import base64
import json
import os
import re
import socket
import sys

import klang


SICHERN_NACH = 0.3  # s nach Rampen-Ende, bevor der Zustand gelesen und als Aktiv-Klang gesichert wird


class Steuerung:
    def __init__(self, host, arbeitsordner: str, aktiv, bereiche=None):
        self.host = host
        self.vorlage = os.path.join(arbeitsordner, "vorlage.carxs")
        self.laden = os.path.join(arbeitsordner, "laden.carxs")
        self.aktiv = aktiv
        self.offen = []  # (zeit_aus, note)
        self.bereiche = bereiche or {}
        self.rampen = {}
        self.ist = {}  # Name → zuletzt gesetzter Wert (Startwert der nächsten Fahrt ohne von)
        self.sichern_ab = None  # Zeitpunkt, ab dem der gefahrene Stand als Aktiv-Klang gesichert wird
        self.name = "cypher"
        if not host.save_plugin_state(0, self.vorlage):
            raise RuntimeError("save_plugin_state (Vorlage) fehlgeschlagen")
        with open(self.vorlage) as f:
            self.vorlage_text = f.read()
        klang.carxs_patch(self.vorlage_text)  # wirft, wenn kein Surge-Zustand drin ist

    def lade(self, pfad: str) -> str:
        with open(pfad, "rb") as f:
            daten = f.read()
        patch = klang.fxp_lesen(daten)
        with open(self.laden, "w") as f:
            f.write(klang.carxs_mit_patch(self.vorlage_text, patch))
        if not self.host.load_plugin_state(0, self.laden):
            raise RuntimeError("load_plugin_state: " + str(self.host.get_last_error()))
        self.ist.clear()  # der neue Klang bringt eigene Werte mit; sonst startet die nächste Fahrt am alten
        if self.aktiv and os.path.abspath(pfad) != os.path.abspath(self.aktiv):
            tmp = self.aktiv + ".neu"
            with open(tmp, "wb") as f:
                f.write(daten)
            os.replace(tmp, self.aktiv)
        self.name = klang.fxp_name(daten) or self.name
        return klang.fxp_name(daten)

    def zustand(self) -> bytes:
        if not self.host.save_plugin_state(0, self.laden):
            raise RuntimeError("save_plugin_state: " + str(self.host.get_last_error()))
        with open(self.laden) as f:
            return klang.carxs_patch(f.read())

    def bearbeite(self, befehl: dict, jetzt: float) -> dict:
        try:
            art = befehl.get("befehl")
            if art == "lade":
                return {"ok": True, "name": self.lade(befehl["pfad"])}
            if art == "zustand":
                patch = self.zustand()
                return {"ok": True, "xml": klang.xml_aus_patch(patch), "patch_b64": base64.b64encode(patch).decode()}
            if art == "note":
                note, vel = int(befehl["note"]), int(befehl.get("velocity", 100))
                dauer = float(befehl.get("dauer", 1.0))
                if not (0 <= note <= 127 and 1 <= vel <= 127 and 0 < dauer <= 30):
                    raise ValueError("note 0..127, velocity 1..127, dauer 0..30 s")
                self.host.send_midi_note(0, 0, note, vel)
                self.offen.append((jetzt + dauer, note))
                return {"ok": True}
            if art == "fahre":
                name = befehl["name"]
                if name not in self.bereiche:
                    raise ValueError(f"{name} nicht fahrbar (kein stufenloser Parameter in surge_bereiche.json); setze lädt den Zustand")
                bis, dauer = float(befehl["bis"]), float(befehl.get("dauer", 0))
                if not 0 <= dauer <= 600:
                    raise ValueError("dauer 0..600 s")
                form = befehl.get("form", "linear")
                if form not in ("linear", "s"):
                    raise ValueError("form: linear or s")
                ab = float(befehl["ab"]) if "ab" in befehl else jetzt
                if not jetzt - 1.0 <= ab <= jetzt + 3600.0:
                    raise ValueError("ab: time.monotonic() seconds, at most 1 s back and 1 h ahead")
                von = float(befehl["von"]) if "von" in befehl else (self.istwert(name) if ab <= jetzt else None)
                b = self.bereiche[name]
                # eine Fahrt ersetzt alle, die ab ihrem Start oder später beginnen würden; die Liste bleibt nach t0 sortiert
                alte = self.rampen.get(name, [])
                liste = [r for r in alte if r["t0"] < ab]
                ersetzt = sum(1 for r in alte if r["t0"] >= ab and not r["gestartet"])
                liste.append({"index": b["index"], "punkte": b["punkte"], "t0": ab, "t1": ab + dauer, "von": von, "bis": bis,
                              "spur": befehl.get("spur"), "form": form, "gestartet": False})
                self.rampen[name] = liste
                if dauer == 0 and ab <= jetzt:
                    self.takt(jetzt)
                return {"ok": True, "ersetzt": ersetzt} if ersetzt else {"ok": True}
            if art == "halte":
                spur, gehalten = befehl.get("spur"), 0
                for name in list(self.rampen):
                    bleibt = [r for r in self.rampen[name] if spur is not None and r["spur"] != spur]
                    gehalten += len(self.rampen[name]) - len(bleibt)
                    if bleibt:
                        self.rampen[name] = bleibt
                    else:
                        del self.rampen[name]
                return {"ok": True, "gehalten": gehalten}
            return {"ok": False, "fehler": f"unbekannter Befehl {art!r}"}
        except Exception as e:  # jeder Fehler geht als Antwort zurück, der Wirt läuft weiter
            return {"ok": False, "fehler": f"{type(e).__name__}: {e}"}

    def istwert(self, name: str) -> float:
        if name in self.ist:
            return self.ist[name]
        werte = dict(klang.werte(klang.xml_aus_patch(self.zustand()), f"^{name}$"))
        return float(re.search(r'value="([^"]*)"', werte[name]).group(1))

    def takt(self, jetzt: float) -> None:
        faellig = [n for t, n in self.offen if t <= jetzt]
        self.offen = [(t, n) for t, n in self.offen if t > jetzt]
        for n in faellig:
            self.host.send_midi_note(0, 0, n, 0)
        fertig = False
        for name in list(self.rampen):
            liste = self.rampen[name]
            laufend = [r for r in liste if r["t0"] <= jetzt]
            if not laufend:
                continue
            r = laufend[-1]  # die jüngste gestartete gilt; frühere sind überholt
            if not r["gestartet"]:
                r["gestartet"] = True
                if r["von"] is None:
                    try:
                        r["von"] = self.istwert(name)
                    except Exception as e:  # takt läuft ungeschützt in wirt.py: die Fahrt fällt, der Wirt lebt
                        print(f"fahre verworfen {name}: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
                        rest = liste[liste.index(r) + 1:]
                        if rest:
                            self.rampen[name] = rest
                        else:
                            del self.rampen[name]
                        continue
                print(f"fahre start {name} soll {r['t0']:.3f} ist {jetzt:.3f}", file=sys.stderr, flush=True)
            anteil = 1.0 if r["t1"] <= r["t0"] else min(max((jetzt - r["t0"]) / (r["t1"] - r["t0"]), 0.0), 1.0)
            if r.get("form") == "s":
                anteil = anteil * anteil * (3.0 - 2.0 * anteil)   # wie Kern formel.h:27 (S-Kurve 3u^2 - 2u^3)
            wert = r["von"] + (r["bis"] - r["von"]) * anteil
            self.host.set_parameter_value(0, r["index"], klang.normiert(r["punkte"], wert))
            self.ist[name] = min(max(wert, min(r["punkte"])), max(r["punkte"]))   # F7: der Ist-Wert liegt im Bereich, nicht darüber hinaus
            rest = liste[liste.index(r) + 1:]
            if anteil >= 1.0:
                fertig = True
                if rest:
                    self.rampen[name] = rest
                else:
                    del self.rampen[name]
            else:
                self.rampen[name] = [r] + rest
        if fertig and self.aktiv:
            # Surge übernimmt einen gesetzten Parameter erst nach einigen Zyklen (Kalibrierung 2026-09-29: ein
            # engine_idle reichte nicht); sofort gesichert stand im Aktiv-Klang der alte Wert (19,95 statt -35).
            self.sichern_ab = jetzt + SICHERN_NACH
        if self.sichern_ab is not None and jetzt >= self.sichern_ab and self.aktiv:
            self.sichern_ab = None
            daten = klang.fxp_bauen(self.zustand(), self.name)
            tmp = self.aktiv + ".neu"
            with open(tmp, "wb") as f:
                f.write(daten)
            os.replace(tmp, self.aktiv)


class NotenSteuerung:
    """Glanz Welle 4: Steuerung eines SFZ-Wirts (Carlas eingebauter Sampler, kein Surge). Nur note und halte; lade,
    zustand und fahre gehören zu Surge und werden mit Grund abgelehnt. Gleiche Notenlogik wie Steuerung."""

    def __init__(self, host):
        self.host = host
        self.offen = []  # (zeit_aus, note)

    def bearbeite(self, befehl: dict, jetzt: float) -> dict:
        try:
            art = befehl.get("befehl")
            if art == "note":
                note, vel = int(befehl["note"]), int(befehl.get("velocity", 100))
                dauer = float(befehl.get("dauer", 1.0))
                if not (0 <= note <= 127 and 1 <= vel <= 127 and 0 < dauer <= 30):
                    raise ValueError("note 0..127, velocity 1..127, dauer 0..30 s")
                self.host.send_midi_note(0, 0, note, vel)
                self.offen.append((jetzt + dauer, note))
                return {"ok": True}
            if art == "halte":
                return {"ok": True, "gehalten": 0}
            if art in ("lade", "zustand", "fahre"):
                return {"ok": False, "fehler": f"{art}: this host plays an sfz sampler, not Surge; only note works"}
            return {"ok": False, "fehler": f"unbekannter Befehl {art!r}"}
        except Exception as e:
            return {"ok": False, "fehler": f"{type(e).__name__}: {e}"}

    def takt(self, jetzt: float) -> None:
        faellig = [n for t, n in self.offen if t <= jetzt]
        self.offen = [(t, n) for t, n in self.offen if t > jetzt]
        for n in faellig:
            self.host.send_midi_note(0, 0, n, 0)


def sende(sock_pfad: str, befehl: dict, timeout: float = 10.0) -> dict:
    """Client-Seite desselben Protokolls (djk-klang, tonprobe)."""
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(sock_pfad)
        s.sendall((json.dumps(befehl) + "\n").encode())
        daten = b""
        while not daten.endswith(b"\n"):
            t = s.recv(1 << 20)
            if not t:
                break
            daten += t
    finally:
        s.close()
    return json.loads(daten)
