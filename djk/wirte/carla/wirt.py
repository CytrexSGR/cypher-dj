#!/usr/bin/env python3
"""cypherdj-wirt (Studio S5.1/S5.3, ADR 009, SCHNITTSTELLEN §8): Carla 2.5.8 im Rack-Modus ohne Fenster als JACK-Client,
ein LV2-Instrument je Prozess (genau EINE Engine je Prozess: mehrere nacheinander stürzten in der Vorprobe ab). Läuft
unter pw-jack; node.async/node.group setzt die Unit über PIPEWIRE_PROPS. --sock: Steuer-Socket (wirtsteuerung.py).
--aktiv: Klang-Datei (.fxp), mit der der Wirt startet und die er bei jedem `lade` überschreibt. Rückgabe 2 bei
Startfehler (Unit startet dann nicht in Schleife neu), 0 nach SIGTERM. Ein kaputter Aktiv-Klang ist KEIN Startfehler:
der Wirt spielt dann die Surge-Init und trägt den Fehler in den Status."""
import argparse
import json
import os
import select
import signal
import socket
import sys
import time

sys.path.insert(0, "/usr/share/carla")
from carla_backend import (BINARY_NATIVE, ENGINE_OPTION_OSC_ENABLED, ENGINE_OPTION_PATH_BINARIES,  # noqa: E402
                           ENGINE_OPTION_PATH_RESOURCES, ENGINE_OPTION_PLUGIN_PATH, ENGINE_OPTION_PREFER_PLUGIN_BRIDGES,
                           ENGINE_OPTION_PROCESS_MODE, ENGINE_OPTION_TRANSPORT_MODE, ENGINE_PROCESS_MODE_CONTINUOUS_RACK,
                           ENGINE_TRANSPORT_MODE_INTERNAL, PLUGIN_LV2, PLUGIN_OPTION_SEND_ALL_SOUND_OFF, CarlaHostDLL)

from wirtsteuerung import Steuerung  # noqa: E402


def lies_zeile(conn) -> bytes:
    daten = b""
    while not daten.endswith(b"\n") and len(daten) < 1 << 20:
        t = conn.recv(65536)
        if not t:
            break
        daten += t
    return daten


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--lv2", required=True, help="LV2-URI des Instruments")
    ap.add_argument("--lv2-pfad", default=os.path.expanduser("~/.local/lib/cypherdj/lv2"))
    ap.add_argument("--status", required=True)
    ap.add_argument("--sock", default="", help="Unix-Socket für lade/zustand/note (leer = keiner)")
    ap.add_argument("--aktiv", default="", help="Klang-Datei .fxp: beim Start laden, bei jedem lade überschreiben")
    a = ap.parse_args(argv)
    status = {"name": a.name, "pid": os.getpid(), "bereit": False, "fehler": [], "sock": a.sock, "klang": None}

    def schreibe():
        tmp = a.status + ".neu"
        with open(tmp, "w") as f:
            json.dump(status, f, ensure_ascii=False)
        os.replace(tmp, a.status)

    host = CarlaHostDLL("/usr/lib/carla/libcarla_standalone2.so", False)
    host.set_engine_option(ENGINE_OPTION_PATH_BINARIES, 0, "/usr/lib/carla")
    host.set_engine_option(ENGINE_OPTION_PATH_RESOURCES, 0, "/usr/share/carla/resources")
    host.set_engine_option(ENGINE_OPTION_PROCESS_MODE, ENGINE_PROCESS_MODE_CONTINUOUS_RACK, "")
    host.set_engine_option(ENGINE_OPTION_PREFER_PLUGIN_BRIDGES, 0, "")
    host.set_engine_option(ENGINE_OPTION_TRANSPORT_MODE, ENGINE_TRANSPORT_MODE_INTERNAL, "")
    host.set_engine_option(ENGINE_OPTION_OSC_ENABLED, 0, "")  # ADR 009: Carlas OSC aus
    host.set_engine_option(ENGINE_OPTION_PLUGIN_PATH, PLUGIN_LV2, a.lv2_pfad)
    if not host.engine_init("JACK", a.name):
        status["fehler"].append("engine_init: " + str(host.get_last_error()))
        schreibe()
        return 2
    # Paket 2 Slice 3 (F06): ohne diese Option verwirft Carla CC120/CC123 am Eingang (gemessen: All-Off erreichte events-in,
    # der Ton blieb; CarlaPluginLV2.cpp, 2.5.8). Nebenwirkung geprüft (Review Q3, slice-3/q3/analyse.txt): Surge ohne
    # threadSafeRestore setzt bei `djk-klang lade` die Stimmen zurück; das bricht klingende Noten und Release-Fahnen auch
    # OHNE die Option innerhalb von 50 ms auf unter -160 dBFS ab (n=1 je Fall), die Option ändert daran nichts Messbares.
    if not host.add_plugin(BINARY_NATIVE, PLUGIN_LV2, "", "", a.lv2, 0, None, PLUGIN_OPTION_SEND_ALL_SOUND_OFF):
        status["fehler"].append("add_plugin: " + str(host.get_last_error()))
        schreibe()
        host.engine_close()
        return 2
    host.set_active(0, True)
    info = host.get_plugin_info(0)
    status.update({"plugin": info["name"], "maker": info["maker"]})
    arbeit = a.status + ".arbeit"
    os.makedirs(arbeit, exist_ok=True)
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
    signal.signal(signal.SIGTERM, lambda *_: laeuft.__setitem__(0, False))
    signal.signal(signal.SIGINT, lambda *_: laeuft.__setitem__(0, False))
    while laeuft[0]:
        host.engine_idle()
        st.takt(time.monotonic())
        if srv is None:
            time.sleep(0.02)
            continue
        try:
            lesbar, _, _ = select.select([srv], [], [], 0.02)
        except InterruptedError:
            continue
        if not lesbar:
            continue
        try:
            conn, _ = srv.accept()
        except BlockingIOError:
            continue
        with conn:
            conn.settimeout(2.0)
            try:
                antwort = st.bearbeite(json.loads(lies_zeile(conn)), time.monotonic())
            except Exception as e:
                antwort = {"ok": False, "fehler": f"{type(e).__name__}: {e}"}
            if antwort.get("ok") and "name" in antwort:
                status["klang"] = antwort["name"]
                schreibe()
            try:
                conn.sendall((json.dumps(antwort, ensure_ascii=False) + "\n").encode())
            except OSError:
                pass
    if srv is not None:
        srv.close()
        try:
            os.unlink(a.sock)
        except FileNotFoundError:
            pass
    host.engine_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
