#!/usr/bin/env python3
"""carla_host: throw-away Carla host for the insert measurements of plan 1.11 task 1 (measuring aid, not product code;
modelled on djk/hosts/carla/instrument_host.py: rack mode, one engine per process, plugin id 0, ENGINE_OPTION_PLUGIN_PATH as instrument_host.py sets it).

  carla_host.py --name N --status F --sock S --plugin <none | lv2:URI | vst3:PATH | vst3:PATH::LABEL[::UNIQUEID]>

Started like the instrument host, under pw-jack with PIPEWIRE_PROPS (node.async etc.). Socket commands (one line, JSON answer):
  param I V       set_parameter_value
  note N V        send_midi_note (V=0 off)     ui 1|0   show_custom_ui
  active 0|1      set_active(0, ..)       latency       carla_get_plugin_latency via ctypes     rss      VmRSS in kB
  info            plugin name and counts  quit
The status file gets "bereit": true and "ready_s" (seconds from process start to ready) once the engine runs."""
import argparse
import ctypes
import json
import os
import select
import signal
import socket
import sys
import time

T0 = time.monotonic()
sys.path.insert(0, "/usr/share/carla")
from carla_backend import (BINARY_NATIVE, ENGINE_OPTION_OSC_ENABLED, ENGINE_OPTION_PATH_BINARIES, ENGINE_OPTION_PATH_RESOURCES,  # noqa: E402
                           ENGINE_OPTION_PLUGIN_PATH, ENGINE_OPTION_PREFER_PLUGIN_BRIDGES, ENGINE_OPTION_PROCESS_MODE,
                           ENGINE_OPTION_TRANSPORT_MODE, ENGINE_PROCESS_MODE_CONTINUOUS_RACK, ENGINE_TRANSPORT_MODE_INTERNAL,
                           PLUGIN_LV2, PLUGIN_OPTION_SEND_ALL_SOUND_OFF, PLUGIN_VST3, CarlaHostDLL)


def rss_kb():
    for l in open("/proc/self/status"):
        if l.startswith("VmRSS:"):
            return int(l.split()[1])
    return -1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--status", required=True)
    ap.add_argument("--sock", required=True)
    ap.add_argument("--plugin", default="none")
    ap.add_argument("--defaults", action="store_true", help="set every parameter to its default (Carla starts VST3 parameters at 0)")
    ap.add_argument("--param", action="append", default=[], help="INDEX=VALUE, set after activation (repeatable)")
    ap.add_argument("--hold-note", type=int, default=-1, help="send note-on N (velocity 100) once the plugin is active and keep it held")
    ap.add_argument("--lv2-pfad", default=os.path.expanduser("~/.local/lib/cypherdj/lv2"))
    a = ap.parse_args()
    status = {"name": a.name, "pid": os.getpid(), "plugin_arg": a.plugin, "bereit": False, "fehler": []}

    def schreibe():
        with open(a.status + ".neu", "w") as f:
            json.dump(status, f)
        os.replace(a.status + ".neu", a.status)

    host = CarlaHostDLL("/usr/lib/carla/libcarla_standalone2.so", False)
    lib = host.lib
    lib.carla_get_plugin_latency.argtypes = (ctypes.c_void_p, ctypes.c_uint)
    lib.carla_get_plugin_latency.restype = ctypes.c_uint32
    host.set_engine_option(ENGINE_OPTION_PATH_BINARIES, 0, "/usr/lib/carla")
    host.set_engine_option(ENGINE_OPTION_PATH_RESOURCES, 0, "/usr/share/carla/resources")
    host.set_engine_option(ENGINE_OPTION_PROCESS_MODE, ENGINE_PROCESS_MODE_CONTINUOUS_RACK, "")
    host.set_engine_option(ENGINE_OPTION_PREFER_PLUGIN_BRIDGES, 0, "")
    host.set_engine_option(ENGINE_OPTION_TRANSPORT_MODE, ENGINE_TRANSPORT_MODE_INTERNAL, "")
    host.set_engine_option(ENGINE_OPTION_OSC_ENABLED, 0, "")
    host.set_engine_option(ENGINE_OPTION_PLUGIN_PATH, PLUGIN_LV2, a.lv2_pfad)  # exactly as instrument_host.py
    if not host.engine_init("JACK", a.name):
        status["fehler"].append("engine_init: " + str(host.get_last_error()))
        schreibe()
        return 2
    kind, _, arg = a.plugin.partition(":")
    if kind == "lv2":
        ok = host.add_plugin(BINARY_NATIVE, PLUGIN_LV2, "", "", arg, 0, None, PLUGIN_OPTION_SEND_ALL_SOUND_OFF)
    elif kind == "vst3":
        path, _, rest = arg.partition("::")
        label, _, uid = rest.partition("::")
        ok = host.add_plugin(BINARY_NATIVE, PLUGIN_VST3, path, "", label, int(uid or 0), None, PLUGIN_OPTION_SEND_ALL_SOUND_OFF)
    elif kind == "none":
        ok = True
    else:
        ok = False
        status["fehler"].append("bad --plugin")
    if not ok:
        status["fehler"].append("add_plugin: " + str(host.get_last_error()))
        schreibe()
        host.engine_close()
        return 2
    if kind != "none":
        host.set_active(0, True)
        if a.defaults:
            for i in range(host.get_parameter_count(0)):
                host.set_parameter_value(0, i, host.get_parameter_ranges(0, i)["def"])
            status["params_after"] = [round(host.get_current_parameter_value(0, i), 3) for i in range(host.get_parameter_count(0))]
        status["plugin"] = host.get_plugin_info(0)["name"]
        status["latency"] = int(lib.carla_get_plugin_latency(host.handle, 0))
    if a.hold_note >= 0 and kind != "none":
        host.send_midi_note(0, 0, a.hold_note, 100)
    for kv in a.param:
        i, _, v = kv.partition("=")
        host.set_parameter_value(0, int(i), float(v))
    status["plugin_count"] = host.get_current_plugin_count()
    status["ready_s"] = round(time.monotonic() - T0, 3)
    status["rss_kb_ready"] = rss_kb()
    status["bereit"] = True
    schreibe()
    try:
        os.unlink(a.sock)
    except FileNotFoundError:
        pass
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(a.sock)
    srv.listen(4)
    srv.setblocking(False)
    run = [True]
    signal.signal(signal.SIGTERM, lambda *_: run.__setitem__(0, False))
    signal.signal(signal.SIGINT, lambda *_: run.__setitem__(0, False))
    while run[0]:
        host.engine_idle()
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
            cmd = conn.recv(4096).decode().split()
            try:
                if cmd[0] == "active":
                    host.set_active(0, bool(int(cmd[1])))
                    r = {"ok": True}
                elif cmd[0] == "param":
                    host.set_parameter_value(0, int(cmd[1]), float(cmd[2]))
                    r = {"ok": True}
                elif cmd[0] == "latency":
                    r = {"ok": True, "latency": int(lib.carla_get_plugin_latency(host.handle, 0))}
                elif cmd[0] == "note":  # note N V (V=0: off)
                    host.send_midi_note(0, 0, int(cmd[1]), int(cmd[2]))
                    r = {"ok": True}
                elif cmd[0] == "ui":  # ui 1|0: show_custom_ui
                    host.show_custom_ui(0, bool(int(cmd[1])))
                    r = {"ok": True}
                elif cmd[0] == "rss":
                    r = {"ok": True, "rss_kb": rss_kb()}
                elif cmd[0] == "info":
                    r = {"ok": True, "plugin_count": host.get_current_plugin_count(), "name": status.get("plugin")}
                elif cmd[0] == "quit":
                    run[0] = False
                    r = {"ok": True}
                else:
                    r = {"ok": False, "fehler": "unknown"}
            except Exception as e:  # noqa: BLE001
                r = {"ok": False, "fehler": f"{type(e).__name__}: {e}"}
            conn.sendall((json.dumps(r) + "\n").encode())
    srv.close()
    try:
        os.unlink(a.sock)
    except FileNotFoundError:
        pass
    host.engine_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
