"""Steuerung des Carla-Wirts (Studio S5.3, ADR 009 Nr. 2: Unix-Socket nur lokal). Protokoll: eine JSON-Zeile hin,
eine zurück. Befehle: {"befehl":"lade","pfad":"/abs/klang.fxp"} → {"ok","name"} · {"befehl":"zustand"} →
{"ok","xml","patch_b64"} · {"befehl":"note","note":0..127,"velocity":1..127,"dauer":s} → {"ok"} ·
{"befehl":"fahre","name","bis","dauer"[,"von"][,"ab"][,"spur"][,"form"]} → {"ok"} (Studio S6: ab = Start in time.monotonic()
Sekunden, höchstens 1 s zurück und 1 h voraus; ohne von gilt der Ist-Wert beim Start; Studio S7: form linear (Vorgabe) oder s
wie im Kern, 3u²−2u³) · {"befehl":"ist","namen":[…]} → {"ok","werte":{name: Anzeigewert}} (1.9 U5: Ist-Werte lesen, lädt nichts) · {"befehl":"halte"[,"spur"]} →
{"ok","gehalten"} (verwirft wartende und laufende Fahrten, mit spur nur deren). Fehler → {"ok": false, "fehler": "…"},
der Wirt läuft weiter. Getrennt von instrument_host.py, damit ohne Carla testbar."""
import base64
import html
import json
import math
import ctypes
import os
import re
import select
import socket
import sys
import time

import sound as klang

sys.path.insert(0, "/usr/share/carla")
from carla_backend import BINARY_NATIVE, PLUGIN_HAS_CUSTOM_UI, PLUGIN_LV2, PLUGIN_VST3  # noqa: E402


SICHERN_NACH = 0.3  # s nach Rampen-Ende, bevor der Zustand gelesen und als Aktiv-Klang gesichert wird


def anzeige_erreichbar() -> bool:
    """Whether $DISPLAY can be opened (XOpenDisplay, a local socket: 0.1 ms measured). Carla's show_custom_ui does NOTHING on a dead display
    (assertion lines on stderr, no event, returns at once; measured 2026-11-11 with DISPLAY=:99), so the host asks first."""
    d = os.environ.get("DISPLAY")
    if not d:
        return False
    try:
        x = ctypes.CDLL("libX11.so.6")
        x.XOpenDisplay.restype, x.XOpenDisplay.argtypes = ctypes.c_void_p, [ctypes.c_char_p]
        x.XCloseDisplay.argtypes = [ctypes.c_void_p]
        h = x.XOpenDisplay(d.encode())
    except OSError:
        return True   # no libX11 to ask with: leave it to Carla as before
    if not h:
        return False
    x.XCloseDisplay(h)
    return True


def fenster_zeigen(host, an) -> dict:
    """Show or hide the plugin's own editor window (Carla show_custom_ui); the main loop of instrument_host.py runs engine_idle(), which
    maps and services the window. Answers {fenster, grund?}: `kein_fenster` (the plugin has no UI), `anzeige_unerreichbar` (DISPLAY set but not openable), `keine_anzeige` (no DISPLAY:
    the host lives on, nothing is shown). Asking for `an` twice shows one window."""
    if not isinstance(an, bool):
        raise ValueError("an: true or false")
    if an:
        if not os.environ.get("DISPLAY"):
            return {"ok": True, "fenster": False, "grund": "keine_anzeige"}
        if not anzeige_erreichbar():
            return {"ok": True, "fenster": False, "grund": "anzeige_unerreichbar"}
        if not int(host.get_plugin_info(0).get("hints", 0)) & PLUGIN_HAS_CUSTOM_UI:
            return {"ok": True, "fenster": False, "grund": "kein_fenster"}
    host.show_custom_ui(0, an)
    return {"ok": True, "fenster": an}


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
            if art == "ist":  # 1.9 U5: current display values (the driven value if there is one, else the plugin state); loads nothing
                namen = befehl.get("namen")
                if not isinstance(namen, list) or not namen or len(namen) > 64 or not all(isinstance(n, str) for n in namen):
                    raise ValueError("namen: a list of 1..64 parameter names")
                for n in namen:
                    if n not in self.bereiche:
                        raise ValueError(f"{n} nicht fahrbar (kein stufenloser Parameter in surge_bereiche.json)")
                return {"ok": True, "werte": {n: self.istwert(n) for n in namen}}
            if art == "fenster":  # plan 2026-11-11 task 9: Surge's own editor on the --lv2 path
                return fenster_zeigen(self.host, befehl["an"])
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
                    except Exception as e:  # takt läuft ungeschützt in instrument_host.py: die Fahrt fällt, der Wirt lebt
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
                anteil = anteil * anteil * (3.0 - 2.0 * anteil)   # wie Kern formula.h:27 (S-Kurve 3u^2 - 2u^3)
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


class ParamSteuerung:
    """RB-338 W1: Steuerung eines VST3-Wirts (eigene Instrumente, djk/instruments). note und halte wie NotenSteuerung,
    dazu param (ein Plugin-Parameter, normiert 0..1, per Name) und params (alle Namen mit Ist-Wert). lade, fahre und
    zustand gehören zu Surge und werden mit Grund abgelehnt. halte hält nichts an (keine Rampen) und beendet keine Note; panik schickt Note-Off für alle Noten."""

    def __init__(self, host):
        self.host = host
        self.offen = []  # (zeit_aus, note)
        self.index = {host.get_parameter_info(0, i)["name"]: i for i in range(host.get_parameter_count(0))}
        # M4: Carla meldet direkt nach dem Laden für alle Parameter 0,0, das Plugin spielt aber mit seinen Vorgaben.
        # Jeden Parameter einmal auf seine Vorgabe setzen, damit params die Wahrheit zeigt.
        for i in self.index.values():
            host.set_parameter_value(0, i, host.get_parameter_ranges(0, i)["def"])

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
            if art == "halte":  # wie Surge/SFZ: Rampen und Automationen der Spur anhalten; hier gibt es keine, Noten bleiben
                return {"ok": True, "gehalten": 0}
            if art == "panik":  # Note-Off für alle Noten; kommt von der Wache und von Hand, nie von Stop Cypher
                return {"ok": True, "gehalten": self.panik()}
            if art == "param":
                name, wert = befehl["name"], float(befehl["wert"])
                if name not in self.index:
                    raise ValueError(f"unknown parameter {name!r}; known: {', '.join(self.index)}")
                if not 0.0 <= wert <= 1.0:
                    raise ValueError("wert 0..1 (normalized)")
                self.host.set_parameter_value(0, self.index[name], wert)
                return {"ok": True}
            if art == "params":
                return {"ok": True, "params": {n: self.host.get_current_parameter_value(0, i) for n, i in self.index.items()}}
            if art in ("lade", "fahre", "zustand"):
                return {"ok": False, "fehler": f"{art}: this host plays a vst3 instrument, not Surge; use param"}
            return {"ok": False, "fehler": f"unbekannter Befehl {art!r}"}
        except Exception as e:
            return {"ok": False, "fehler": f"{type(e).__name__}: {e}"}

    def panik(self) -> int:
        """Note-Off für alle 128 Noten (Kanal 1): löst eine hängende Note, deren Off verloren ging. Gibt die Anzahl zurück.
        Ein nih-plug-VST3 bekommt CC120/CC123 über Carla nicht (gemessen), deshalb der Umweg über Noten."""
        self.offen = []
        for n in range(128):
            self.host.send_midi_note(0, 0, n, 0)
        return 128

    def takt(self, jetzt: float) -> None:
        faellig = [n for t, n in self.offen if t <= jetzt]
        self.offen = [(t, n) for t, n in self.offen if t > jetzt]
        for n in faellig:
            self.host.send_midi_note(0, 0, n, 0)


class EffektSteuerung:
    """Plan 1.11 task 2: control of a foreign effect host (--effekt). One plugin per process, plugin id 0. The host starts
    with an EMPTY rack (status `leer`): an inactive plugin in Carla returns silence, so the core measures the bare round
    trip first and `lade` adds the plugin afterwards (D17, variant B). Plugin identity is {format, pfad, uid}; uid is the
    label carla-discovery prints (empty for LV2, where pfad is the URI). Parameters travel as 0..1: LV2 values are mapped
    linearly onto [min, max], VST3 values pass as they are (Carla reports normalized VST3 parameters).
    A plugin that cannot be loaded or is not an effect sets `ende = 2` and `grund`; instrument_host.py then writes the reason to the
    status file and exits 2, so a supervisor does not restart-loop. `latenz_fn` returns the declared latency in samples,
    `puls` is the heartbeat file (a counter rewritten every 20 ms from takt)."""

    PULS_ABSTAND = 0.02
    LATENZ_WARTEN = True

    def _art_fehlt(self, h):
        """None if the plugin is the right kind (an effect: it has an audio input), else (grund, detail)."""
        if h.get_audio_port_count_info(0)["ins"] == 0:
            return "kein_effekt", "plugin has no audio input (an instrument?)"
        return None

    def __init__(self, host, format: str, pfad: str, uid: str, latenz_fn, puls=None, melde=None):
        self.host, self.format, self.pfad, self.uid = host, format, pfad, uid
        self.latenz_fn, self.puls, self.melde = latenz_fn, puls, melde  # melde(zustand, **extra): status marker for the supervisor
        self.aktiv_an = True
        self.status = "leer"
        self.ende = None
        self.grund = None
        self.zaehler = 0
        self.letzter_puls = None
        self.bereiche = {}  # index -> (min, max)

    def _scheitern(self, grund: str, detail: str) -> dict:
        self.ende, self.grund, self.detail = 2, grund, detail
        return {"ok": False, "fehler": grund, "detail": detail}

    def lade(self) -> dict:
        if self.status != "leer":
            return {"ok": False, "fehler": "schon_geladen"}
        h = self.host
        # The Carla load call cannot be interrupted (no heartbeat meanwhile): mark it so a supervisor can tell busy from hung.
        self.status = "laedt"
        if self.melde:
            self.melde("laedt", laedt_seit=time.time())
        try:
            return self._lade(h)
        finally:
            if self.status == "laedt":
                self.status = "leer"
            if self.melde:
                self.melde(self.status)

    def _lade(self, h) -> dict:
        if self.format == "vst3":
            ok = h.add_plugin(BINARY_NATIVE, PLUGIN_VST3, os.path.abspath(self.pfad), "", self.uid, 0, None, 0)
        elif self.format == "lv2":
            ok = h.add_plugin(BINARY_NATIVE, PLUGIN_LV2, "", "", self.pfad, 0, None, 0)
        else:
            return self._scheitern("nicht_ladbar", f"unknown format {self.format!r}")
        if not ok:
            return self._scheitern("nicht_ladbar", str(h.get_last_error()))
        geladen = h.get_plugin_info(0).get("label", "")
        if self.format == "vst3" and self.uid and geladen != self.uid:
            # Carla ignores an unknown VST3 label and loads the bundle's first class (D18): refuse instead of misreport
            h.remove_plugin(0)
            return self._scheitern("nicht_ladbar", f"class {self.uid!r} not found in the bundle (Carla loaded {geladen!r})")
        fehlt = self._art_fehlt(h)
        if fehlt:
            h.remove_plugin(0)
            return self._scheitern(*fehlt)
        n = h.get_parameter_count(0)
        for i in range(n):  # Carla starts VST3 parameters at 0 while the plugin plays its defaults (see ParamSteuerung)
            r = h.get_parameter_ranges(0, i)
            self.bereiche[i] = (float(r["min"]), float(r["max"]))
            h.set_parameter_value(0, i, r["def"])
        h.set_active(0, True)
        # Some plugins (LSP) declare their latency only after the first process cycles (measured: 0 right after load,
        # 240 within 100 ms). Wait up to 0.3 s for a non-zero value; a plugin with true latency 0 pays the 0.3 s once.
        ende = time.monotonic() + (0.3 if self.LATENZ_WARTEN else 0.0)
        while int(self.latenz_fn()) == 0 and time.monotonic() < ende:
            if hasattr(h, "engine_idle"):
                h.engine_idle()
            self.takt(time.monotonic())  # the heartbeat must not stall while we wait
            time.sleep(0.02)
        self.aktiv_an = True
        self.status = "geladen"
        return {"ok": True}

    def fenster(self, an) -> dict:
        """Task 15: see fenster_zeigen."""
        return fenster_zeigen(self.host, an)

    def _aus_norm(self, i: int, x: float) -> float:
        x = min(max(float(x), 0.0), 1.0)
        if self.format != "lv2":
            return x
        lo, hi = self.bereiche[i]
        return lo + x * (hi - lo)

    def _nach_norm(self, i: int, v: float) -> float:
        if self.format != "lv2":
            return v
        lo, hi = self.bereiche[i]
        return 0.0 if hi == lo else min(max((v - lo) / (hi - lo), 0.0), 1.0)

    def _zustand_passt(self, pfad: str) -> bool:
        """The file's <Info> must describe this plugin: Name, plus Label (VST3) or URI (LV2) and UniqueID where present."""
        with open(pfad) as f:
            m = re.search(r"<Info>(.*?)</Info>", f.read(), re.S)
        if not m:
            return False
        info = {k: html.unescape(v) for k, v in re.findall(r"<(\w+)>(.*?)</\1>", m.group(1), re.S)}
        pi = self.host.get_plugin_info(0)
        if info.get("Name") != pi["name"]:
            return False
        if "Label" in info and info["Label"] != pi.get("label", info["Label"]):
            return False
        if "URI" in info and info["URI"] != self.pfad:
            return False
        if "UniqueID" in info and info["UniqueID"] != str(pi.get("uniqueId", info["UniqueID"])):
            return False
        return True

    def bearbeite(self, befehl: dict, jetzt: float) -> dict:
        try:
            art = befehl.get("befehl")
            if art == "lade":
                return self.lade()
            if art in ("info", "params", "params_setzen", "aktiv", "latenz", "zustand_holen", "zustand_setzen", "fenster"):
                if self.status != "geladen":
                    return {"ok": False, "fehler": "leer"}
            h = self.host
            if art == "info":
                pi = h.get_plugin_info(0)
                ports = h.get_audio_port_count_info(0)
                parameter = []
                for i in range(h.get_parameter_count(0)):
                    r = h.get_parameter_ranges(0, i)
                    parameter.append({"index": i, "name": h.get_parameter_info(0, i)["name"], "min": r["min"], "max": r["max"],
                                      "vorgabe": r["def"], "einheit": h.get_parameter_info(0, i).get("unit", "")})
                return {"ok": True, "name": pi["name"], "hersteller": pi["maker"], "audio_ein": ports["ins"],
                        "audio_aus": ports["outs"], "latenz": int(self.latenz_fn()), "parameter": parameter}
            if art == "params":
                return {"ok": True, "werte": {str(i): self._nach_norm(i, h.get_current_parameter_value(0, i))
                                              for i in self.bereiche}}
            if art == "params_setzen":
                werte = befehl["werte"]
                if not isinstance(werte, dict):
                    raise ValueError("werte: an object {index: 0..1}")
                setzen = []
                for k, x in werte.items():  # validate everything first: a rejected batch changes nothing
                    try:
                        i = int(k)
                    except (TypeError, ValueError):
                        i = -1
                    if i not in self.bereiche:
                        return {"ok": False, "fehler": "param_unbekannt", "index": k}
                    try:
                        x = float(x)
                    except (TypeError, ValueError):
                        x = float("nan")
                    if not math.isfinite(x):
                        return {"ok": False, "fehler": "wert_ungueltig", "index": k}
                    setzen.append((i, self._aus_norm(i, x)))
                for i, v in setzen:
                    h.set_parameter_value(0, i, v)
                return {"ok": True}
            if art == "aktiv":
                h.set_active(0, bool(befehl["an"]))
                self.aktiv_an = bool(befehl["an"])
                return {"ok": True}
            if art == "latenz":
                return {"ok": True, "latenz": int(self.latenz_fn())}
            if art == "fenster":
                return self.fenster(befehl["an"])
            if art == "zustand_holen":
                if not h.save_plugin_state(0, befehl["pfad"]):
                    raise RuntimeError("save_plugin_state: " + str(h.get_last_error()))
                return {"ok": True}
            if art == "zustand_setzen":
                if not self._zustand_passt(befehl["pfad"]):
                    return {"ok": False, "fehler": "zustand_passt_nicht"}
                ok = h.load_plugin_state(0, befehl["pfad"])
                h.set_active(0, self.aktiv_an)  # Carla applies <Active> from the file: restore the current state
                if not ok:
                    raise RuntimeError("load_plugin_state: " + str(h.get_last_error()))
                return {"ok": True}
            return {"ok": False, "fehler": f"unbekannter Befehl {art!r}"}
        except Exception as e:
            return {"ok": False, "fehler": f"{type(e).__name__}: {e}"}

    def takt(self, jetzt: float) -> None:
        if self.puls is None or (self.letzter_puls is not None and jetzt - self.letzter_puls < self.PULS_ABSTAND):
            return
        self.letzter_puls = jetzt
        self.zaehler += 1
        tmp = self.puls + ".neu"
        with open(tmp, "w") as f:
            f.write(str(self.zaehler))
        os.replace(tmp, self.puls)


class InstrumentSteuerung(EffektSteuerung):
    """Plan 1.11 task 16: control of a foreign instrument host (--instrument). Same plugin identity, index-based parameter
    commands, state and `fenster` as EffektSteuerung, plus note, halte and panik with the meaning they have in ParamSteuerung.
    The host loads the plugin at start (no empty-rack round trip: an instrument's latency is measured like Surge's, so there is
    no latency wait either). A plugin without a MIDI input is no instrument: `kein_instrument`, exit 2."""

    LATENZ_WARTEN = False

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.offen = []  # (time off, note)

    def _art_fehlt(self, h):
        if h.get_midi_port_count_info(0)["ins"] == 0:
            return "kein_instrument", "plugin has no MIDI input (an effect?)"
        return None

    def bearbeite(self, befehl: dict, jetzt: float) -> dict:
        art = befehl.get("befehl")
        if art not in ("note", "halte", "panik"):
            return super().bearbeite(befehl, jetzt)
        try:
            if self.status != "geladen":
                return {"ok": False, "fehler": "leer"}
            if art == "note":
                note, vel = int(befehl["note"]), int(befehl.get("velocity", 100))
                dauer = float(befehl.get("dauer", 1.0))
                if not (0 <= note <= 127 and 1 <= vel <= 127 and 0 < dauer <= 30):
                    raise ValueError("note 0..127, velocity 1..127, dauer 0..30 s")
                self.host.send_midi_note(0, 0, note, vel)
                self.offen.append((jetzt + dauer, note))
                return {"ok": True}
            if art == "halte":  # as in ParamSteuerung: there are no ramps here, notes stay
                return {"ok": True, "gehalten": 0}
            return {"ok": True, "gehalten": self.panik()}
        except Exception as e:
            return {"ok": False, "fehler": f"{type(e).__name__}: {e}"}

    def panik(self) -> int:
        """Note-off for all 128 notes on channel 1 (a note whose off got lost); returns the count."""
        self.offen = []
        for n in range(128):
            self.host.send_midi_note(0, 0, n, 0)
        return 128

    def takt(self, jetzt: float) -> None:
        faellig = [n for t, n in self.offen if t <= jetzt]
        self.offen = [(t, n) for t, n in self.offen if t > jetzt]
        for n in faellig:
            self.host.send_midi_note(0, 0, n, 0)
        super().takt(jetzt)


class Zeilenserver:
    """Non-blocking line server for the host loop: one JSON line in, one answer out. Reads from every connection through the
    same select as accept, so a client that connects and stays silent (or aborts mid-line) never stalls the main loop and
    its heartbeat. A connection that has not completed a line within LEERLAUF seconds is dropped."""

    LEERLAUF = 2.0
    MAX_ZEILE = 1 << 20

    def __init__(self, srv):
        self.srv = srv
        self.clients = {}  # conn -> [buffer, time of last data]

    def bediene(self, timeout: float, fn) -> None:
        """Wait up to timeout for socket activity and serve it. fn(line: bytes) -> dict is the answer sent back."""
        try:
            lesbar, _, _ = select.select([self.srv, *self.clients], [], [], timeout)
        except InterruptedError:
            return
        jetzt = time.monotonic()
        for c in lesbar:
            if c is self.srv:
                try:
                    conn, _ = self.srv.accept()
                except BlockingIOError:
                    continue
                conn.setblocking(False)
                self.clients[conn] = [b"", jetzt]
                continue
            try:
                daten = c.recv(65536)
            except BlockingIOError:
                continue
            except OSError:
                daten = b""
            puffer = self.clients[c]
            if not daten:  # closed (possibly mid-line): drop
                self._zu(c)
                continue
            puffer[0] += daten
            puffer[1] = jetzt
            if b"\n" in puffer[0] or len(puffer[0]) >= self.MAX_ZEILE:
                zeile = puffer[0].split(b"\n", 1)[0]
                try:
                    antwort = fn(zeile)
                except Exception as e:
                    antwort = {"ok": False, "fehler": f"{type(e).__name__}: {e}"}
                try:
                    c.settimeout(0.5)
                    c.sendall((json.dumps(antwort, ensure_ascii=False) + "\n").encode())
                except OSError:
                    pass
                self._zu(c)
        for c, (_, t) in list(self.clients.items()):
            if jetzt - t > self.LEERLAUF:
                self._zu(c)

    def _zu(self, c) -> None:
        self.clients.pop(c, None)
        try:
            c.close()
        except OSError:
            pass


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
