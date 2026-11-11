#!/usr/bin/env python3
"""cypherdj-wirt (Studio S5.1/S5.3, ADR 009, INTERFACES §8): Carla 2.5.8 im Rack-Modus ohne Fenster als JACK-Client,
ein LV2-Instrument je Prozess (genau EINE Engine je Prozess: mehrere nacheinander stürzten in der Vorprobe ab). Läuft
unter pw-jack; node.async/node.group setzt die Unit über PIPEWIRE_PROPS. --sock: Steuer-Socket (host_control.py).
--aktiv: Klang-Datei (.fxp), mit der der Wirt startet und die er bei jedem `lade` überschreibt. Rückgabe 2 bei
Startfehler (Unit startet dann nicht in Schleife neu), 0 nach SIGTERM. Ein kaputter Aktiv-Klang ist KEIN Startfehler:
der Wirt spielt dann die Surge-Init und trägt den Fehler in den Status.
--sfz statt --lv2 (Glanz Welle 4): Carlas eingebauter SFZ-Sampler, z. B. der Flügel aus instrument_build.py. Dann gibt es
nur note/halte am Socket, keinen Aktiv-Klang; eine nicht ladbare SFZ (instrument_bauen.pruefe) ist ein Startfehler.
--vst3 (RB-338 W1): ein VST3-Bundle der eigenen Instrumente (djk/instruments), Socket-Befehle note/halte/param/params
(ParamSteuerung, Regler normiert 0..1); ein fehlendes Bundle oder eine nicht lesbare Parameterliste ist ein Startfehler
(Rückgabe 2, Eintrag im Status).
--effekt <vst3|lv2>:<pfad>#<uid> (Plan 1.11 task 2): a foreign effect, host starts with an EMPTY rack (status `leer`), the
socket command `lade` adds the plugin (EffektSteuerung). A plugin that cannot be loaded (`nicht_ladbar`) or has no audio
input (`kein_effekt`) answers the reason at `lade`, writes it to the status file and exits 2 (no restart loop). Heartbeat:
`<status>.puls`, a counter rewritten every 20 ms. Command `fenster {an}` (task 15) shows or hides the plugin's own window
(Carla show_custom_ui); the main loop's engine_idle() services it (clicks in the window reach the plugin parameters)."""
import argparse
import ctypes
import json
import os
import select
import signal
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, "/usr/share/carla")
from carla_backend import (BINARY_NATIVE, PLUGIN_SFZ, ENGINE_OPTION_OSC_ENABLED, ENGINE_OPTION_PATH_BINARIES,  # noqa: E402
                           ENGINE_OPTION_PATH_RESOURCES, ENGINE_OPTION_PLUGIN_PATH, ENGINE_OPTION_PREFER_PLUGIN_BRIDGES,
                           ENGINE_OPTION_PROCESS_MODE, ENGINE_OPTION_TRANSPORT_MODE, ENGINE_PROCESS_MODE_CONTINUOUS_RACK,
                           ENGINE_TRANSPORT_MODE_INTERNAL, PLUGIN_LV2, PLUGIN_OPTION_SEND_ALL_SOUND_OFF, PLUGIN_VST3, CarlaHostDLL)

import instrument_build as instrument_bauen  # noqa: E402
from host_control import EffektSteuerung, InstrumentSteuerung, NotenSteuerung, ParamSteuerung, Steuerung, Zeilenserver  # noqa: E402
from host_watch import JackVerbindungen, Wache  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    art = ap.add_mutually_exclusive_group(required=True)
    art.add_argument("--lv2", help="LV2-URI des Instruments (Surge XT)")
    art.add_argument("--sfz", help="SFZ-Datei für Carlas eingebauten Sampler")
    art.add_argument("--vst3", help="Pfad zu einem .vst3-Bundle (eigene Instrumente, djk/instruments)")
    art.add_argument("--effekt", help="foreign effect plugin <vst3|lv2>:<pfad>#<uid>; the rack starts empty, the command `lade` adds it")
    art.add_argument("--instrument", help="foreign instrument plugin <vst3|lv2>:<pfad>#<uid>; loaded at start (InstrumentSteuerung)")
    ap.add_argument("--lv2-pfad", default=os.path.expanduser("~/.local/lib/cypherdj/lv2"))
    ap.add_argument("--status", required=True)
    ap.add_argument("--sock", default="", help="Unix-Socket für lade/zustand/note (leer = keiner)")
    ap.add_argument("--aktiv", default="", help="Klang-Datei .fxp: beim Start laden, bei jedem lade überschreiben")
    a = ap.parse_args(argv)
    fremd = a.effekt or a.instrument
    if fremd:
        fmt, _, rest = fremd.partition(":")
        pfad, _, uid = rest.rpartition("#") if "#" in rest else (rest, "", "")
        if fmt not in ("vst3", "lv2") or not pfad or not a.sock:
            ap.error("--effekt/--instrument <vst3|lv2>:<pfad>#<uid> needs a known format, a path and --sock")
    status = {"name": a.name, "pid": os.getpid(), "bereit": False, "fehler": [], "sock": a.sock, "klang": None,
              "art": (f"sfz:{os.path.splitext(os.path.basename(a.sfz))[0]}" if a.sfz
                      else f"vst3:{os.path.splitext(os.path.basename(a.vst3.rstrip('/')))[0]}" if a.vst3
                      else f"effekt:{a.effekt}" if a.effekt else "plugin" if a.instrument else "lv2")}
    if a.instrument:
        status["kennung"] = a.instrument  # which plugin: `art` only says "a foreign plugin instrument" (djk-instrumente compares this)

    def schreibe():
        tmp = a.status + ".neu"
        with open(tmp, "w") as f:
            json.dump(status, f, ensure_ascii=False)
        os.replace(tmp, a.status)

    if a.sfz:
        maengel = instrument_bauen.pruefe(Path(a.sfz))
        if maengel:
            status["fehler"].append(f"sfz: {len(maengel)} Mängel, zuerst: {maengel[0]}")
            schreibe()
            return 2
    if a.vst3 and not os.path.isdir(a.vst3):
        status["fehler"].append(f"vst3: {a.vst3} fehlt")
        schreibe()
        return 2
    host = CarlaHostDLL("/usr/lib/carla/libcarla_standalone2.so", False)
    host.set_engine_option(ENGINE_OPTION_PATH_BINARIES, 0, "/usr/lib/carla")
    host.set_engine_option(ENGINE_OPTION_PATH_RESOURCES, 0, "/usr/share/carla/resources")
    host.set_engine_option(ENGINE_OPTION_PROCESS_MODE, ENGINE_PROCESS_MODE_CONTINUOUS_RACK, "")
    host.set_engine_option(ENGINE_OPTION_PREFER_PLUGIN_BRIDGES, 0, "")
    host.set_engine_option(ENGINE_OPTION_TRANSPORT_MODE, ENGINE_TRANSPORT_MODE_INTERNAL, "")
    host.set_engine_option(ENGINE_OPTION_OSC_ENABLED, 0, "")  # ADR 009: Carlas OSC aus
    host.set_engine_option(ENGINE_OPTION_PLUGIN_PATH, PLUGIN_LV2,
                           ":".join([a.lv2_pfad, "/usr/lib/lv2", "/usr/local/lib/lv2", os.path.expanduser("~/.lv2")]) if fremd else a.lv2_pfad)
    if not host.engine_init("JACK", a.name):
        status["fehler"].append("engine_init: " + str(host.get_last_error()))
        schreibe()
        return 2
    # Paket 2 Slice 3 (F06): ohne diese Option verwirft Carla CC120/CC123 am Eingang (gemessen: All-Off erreichte events-in,
    # der Ton blieb; CarlaPluginLV2.cpp, 2.5.8). Nebenwirkung geprüft (Review Q3, slice-3/q3/analyse.txt): Surge ohne
    # threadSafeRestore setzt bei `djk-klang lade` die Stimmen zurück; das bricht klingende Noten und Release-Fahnen auch
    # OHNE die Option innerhalb von 50 ms auf unter -160 dBFS ab (n=1 je Fall), die Option ändert daran nichts Messbares.
    if fremd:
        geladen = True  # effect, variant B: empty rack, `lade` adds the plugin; instrument: loaded below, before `bereit`
    elif a.sfz:
        geladen = host.add_plugin(BINARY_NATIVE, PLUGIN_SFZ, os.path.abspath(a.sfz), "", "", 0, None, PLUGIN_OPTION_SEND_ALL_SOUND_OFF)
    elif a.vst3:
        geladen = host.add_plugin(BINARY_NATIVE, PLUGIN_VST3, os.path.abspath(a.vst3), "", "", 0, None, PLUGIN_OPTION_SEND_ALL_SOUND_OFF)
    else:
        geladen = host.add_plugin(BINARY_NATIVE, PLUGIN_LV2, "", "", a.lv2, 0, None, PLUGIN_OPTION_SEND_ALL_SOUND_OFF)
    if not geladen:
        status["fehler"].append("add_plugin: " + str(host.get_last_error()))
        schreibe()
        host.engine_close()
        return 2
    if not fremd:
        host.set_active(0, True)
        info = host.get_plugin_info(0)
        status.update({"plugin": info["name"], "maker": info["maker"]})
    arbeit = a.status + ".arbeit"
    os.makedirs(arbeit, exist_ok=True)
    wache = None
    if fremd:
        lib = host.lib
        lib.carla_get_plugin_latency.argtypes = (ctypes.c_void_p, ctypes.c_uint)
        lib.carla_get_plugin_latency.restype = ctypes.c_uint32
        def melde(zustand, **extra):  # busy-loading marker: `laedt` + start time before the uninterruptible Carla call
            status["effekt"] = zustand
            status.pop("laedt_seit", None)
            status.update(extra)
            schreibe()

        klasse = InstrumentSteuerung if a.instrument else EffektSteuerung
        st, bereiche = klasse(host, fmt, pfad, uid, lambda: lib.carla_get_plugin_latency(host.handle, 0),
                              a.status + ".puls", melde), {}
        status["effekt"] = "leer"
        if a.instrument:  # an instrument is loaded at start; a plugin that is none (no MIDI input) or does not load ends the host
            r = st.lade()
            status["effekt"] = st.status
            if not r["ok"]:
                status["fehler"].append(st.grund)
                status["grund"] = st.detail
                schreibe()
                host.engine_close()
                return 2
            status["plugin"] = host.get_plugin_info(0)["name"]
            status["maker"] = host.get_plugin_info(0)["maker"]
            try:  # note-off for all once the core re-links the MIDI edge (as for the own VST3 instruments)
                wache = Wache(JackVerbindungen(f"{a.name}:events-in", f"{a.name}-wacht").verbunden, st.panik)
            except Exception as e:
                status["fehler"].append(f"wache: {type(e).__name__}: {e} (hängende Noten nach Neuverbindung möglich)")
    elif a.vst3:
        try:
            st, bereiche = ParamSteuerung(host), {}
        except Exception as e:
            status["fehler"].append(f"steuerung: {type(e).__name__}: {e}")
            schreibe()
            host.engine_close()
            return 2
        status["klang"] = status["art"]
        try:  # Note-Off für alle, sobald der Kern die MIDI-Kante neu verbindet (sein All-Off erreicht ein nih-plug-VST3 nicht)
            wache = Wache(JackVerbindungen(f"{a.name}:events-in", f"{a.name}-wacht").verbunden, st.panik)
        except Exception as e:
            status["fehler"].append(f"wache: {type(e).__name__}: {e} (hängende Noten nach Neuverbindung möglich)")
    elif a.sfz:
        st, bereiche = NotenSteuerung(host), {}
        status["klang"] = status["art"]
    else:
        bereiche_pfad = os.path.join(os.path.dirname(os.path.abspath(__file__)), "surge_bereiche.json")
        try:
            with open(bereiche_pfad) as f:
                bereiche = json.load(f)["parameter"]
        except (OSError, ValueError, KeyError) as e:
            bereiche = {}
            status["fehler"].append(f"bereiche: {type(e).__name__}: {e}")
        try:
            st = Steuerung(host, arbeit, a.aktiv or None, bereiche)
        except Exception as e:
            status["fehler"].append(f"steuerung: {type(e).__name__}: {e}")
            schreibe()
            host.engine_close()
            return 2
        if a.aktiv and os.path.exists(a.aktiv):
            r = st.bearbeite({"befehl": "lade", "pfad": a.aktiv}, time.monotonic())
            if r["ok"]:
                status["klang"] = r["name"]
            else:
                status["fehler"].append("aktiv-klang: " + r["fehler"])
    srv = None
    if a.sock:
        try:
            os.unlink(a.sock)
        except FileNotFoundError:
            pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(a.sock)
        srv.listen(4)
        srv.setblocking(False)
    status["fahrbar"] = len(bereiche)
    status["bereit"] = True
    schreibe()
    laeuft = [True]
    rc = [0]

    def bearbeite_zeile(zeile: bytes) -> dict:
        try:
            antwort = st.bearbeite(json.loads(zeile), time.monotonic())
        except Exception as e:
            antwort = {"ok": False, "fehler": f"{type(e).__name__}: {e}"}
        if fremd:
            status["effekt"] = st.status
            if st.ende is not None:  # reason into the status file, then exit 2: a supervisor must not restart-loop
                status["fehler"].append(st.grund)
                status["grund"] = st.detail
                status["bereit"] = False
                rc[0], laeuft[0] = st.ende, False
            elif st.status == "geladen":
                status["plugin"] = st.host.get_plugin_info(0)["name"]
            schreibe()
        elif antwort.get("ok") and "name" in antwort:
            status["klang"] = antwort["name"]
            schreibe()
        return antwort

    zs = Zeilenserver(srv) if srv is not None else None
    signal.signal(signal.SIGTERM, lambda *_: laeuft.__setitem__(0, False))
    signal.signal(signal.SIGINT, lambda *_: laeuft.__setitem__(0, False))
    while laeuft[0]:
        host.engine_idle()
        st.takt(time.monotonic())
        if wache is not None:
            wache.takt(time.monotonic())
            if wache.fehler is not None:  # die Wache ist ausgefallen: sichtbar machen, der Wirt spielt weiter
                status["fehler"].append(f"wache: {wache.fehler} (hängende Noten nach Neuverbindung möglich)")
                schreibe()
                wache = None
        if zs is None:
            time.sleep(0.02)
            continue
        zs.bediene(0.02, bearbeite_zeile)  # non-blocking: a silent client never stalls the loop (heartbeat, takt)
    if srv is not None:
        srv.close()
        try:
            os.unlink(a.sock)
        except FileNotFoundError:
            pass
    host.engine_close()
    return rc[0]


if __name__ == "__main__":
    sys.exit(main())
