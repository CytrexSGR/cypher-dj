#!/usr/bin/env python3
"""messlauf: drives the measurements of plan 1.11 task 1 (measuring aid, not product code). Run it under both timing locks:

  flock "$CYPHERDJ_TIMING_LOCK" flock <repo>/djk/config/.echtzeit.lock python3 messlauf.py <modus> <plugin> [...]

  matrix  <plugin>   healthy / SIGSTOP 10 s..20 s / SIGKILL 10 s, each 30 s, node.async true and false
  step3   <plugin>   three host starts: round trip active and inactive, latency call, RSS, start time
  leer               three host starts of the empty rack (no plugin loaded)
  gate               a-exp with a closed gate: does the return carry exact zeros while the input has signal?
  pfad               ENGINE_OPTION_PLUGIN_PATH as instrument_host.py sets it: does it find a-eq under /usr/lib/lv2?
plugin keys: aeq, ceq, acomp
Own unit names only: cypherdj-ins1-e (async true) and cypherdj-ins1-e-sync (async false)."""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = Path(os.environ.get("INS_OUT", os.path.expanduser("~/messungen/2026-11-10-1.11-plugins/t1")))
RT = Path("/dev/shm/cypherdj-ins1")
LV2 = f"/usr/lib/lv2:{os.path.expanduser('~/.local/lib/cypherdj/lv2')}"
PLUGINS = {"aeq": ("lv2:urn:ardour:a-eq", []), "ceq": (f"vst3:{os.path.expanduser('~/.local/lib/cypherdj/vst3/Cypher EQ.vst3')}", []),
           "acomp": ("lv2:urn:ardour:a-comp#stereo", []), "leer": ("none", []),
           # task 1b: bridge and native instruments
           "smw": (f"vst3:{os.path.expanduser('~/.vst3/yabridge/ValhallaSupermassive.vst3')}", ["5=0"]),  # param 5 = Clear: 0 = do not hold the tail cleared
           "vitw": (f"vst3:{os.path.expanduser('~/.vst3/yabridge/Vital.vst3')}", []),
           "vitn": (f"vst3:{os.path.expanduser('~/.vst3/Vital.vst3')}", [])}
INSTR = ("vitw", "vitn")


def unit_name(async_):
    return "cypherdj-ins1-e" if async_ else "cypherdj-ins1-e-sync"


def stop(unit):
    subprocess.run(["systemctl", "--user", "kill", "-s", "KILL", unit], capture_output=True)
    subprocess.run(["systemctl", "--user", "stop", unit], capture_output=True)
    subprocess.run(["systemctl", "--user", "reset-failed", unit], capture_output=True)


def start(plugin, async_, extra=()):
    unit = unit_name(async_)
    stop(unit)
    RT.mkdir(parents=True, exist_ok=True)
    st, sock = RT / f"{unit}.json", RT / f"{unit}.sock"
    for f in (st, sock):
        f.unlink(missing_ok=True)
    spec, params = PLUGINS[plugin]
    props = "{ node.async = %s node.group = cypherdj-ins1 node.lock-quantum = true }" % ("true" if async_ else "false")
    t0 = time.monotonic()
    subprocess.run(["systemd-run", "--user", "--quiet", "--collect", f"--unit={unit}", "-p", "Restart=no", f"--setenv=PIPEWIRE_PROPS={props}",
                    *[f"--setenv={k}={os.environ[k]}" for k in ("DISPLAY", "XAUTHORITY") if k in os.environ],
                    "/usr/bin/pw-jack", "-p", "256", "/usr/bin/python3", str(HERE / "carla_host.py"), "--name", unit, "--status", str(st),
                    "--sock", str(sock), "--plugin", spec, *extra, *sum((["--param", p] for p in params), [])], check=True)
    while time.monotonic() - t0 < 60:
        if st.exists():
            d = json.load(open(st))
            if d.get("bereit") or d.get("fehler"):
                d["start_to_ready_s"] = round(time.monotonic() - t0, 3)
                return unit, d
        time.sleep(0.01)
    return unit, {"fehler": ["timeout"]}


def cmd(unit, line):
    s = socket.socket(socket.AF_UNIX)
    s.settimeout(5)
    s.connect(str(RT / f"{unit}.sock"))
    s.sendall(line.encode())
    r = s.recv(4096).decode()
    s.close()
    return json.loads(r)


def probe(unit, szenario, tag, dauer=30, signal="ton", extra=()):
    r = subprocess.run([sys.executable, str(HERE / "ins_probe.py"), szenario, "--host-unit", unit, "--dauer", str(dauer), "--signal", signal,
                        "--tag", tag, "--out", str(OUT / "roh"), *extra], capture_output=True, text=True)
    p = OUT / "roh" / f"{tag}.json"
    if not p.exists():
        return {"error": r.stderr[-400:] + r.stdout[-400:]}
    return json.load(open(p))


def load():
    return open("/proc/loadavg").read().split()[0]


def matrix(plugin):
    res = []
    for async_ in (True, False):
        for sz in ("gesund", "stopp", "kill"):
            unit, st = start(plugin, async_, ("--lv2-pfad", LV2))
            tag = f"{plugin}-{'async' if async_ else 'sync'}-{sz}"
            load0 = load()
            r = probe(unit, sz, tag)
            r["load_before"] = load0
            r["host_status"] = st
            stop(unit)
            res.append({"tag": tag, "async": async_, "szenario": sz, "result": {k: v for k, v in r.items() if k not in ("meta", "delays")}})
            print(tag, "windows (lo, cycles, gap_max, dev_max, ret_peak, zero_while_signal, equal):",
                  [(w.get("lo"), w.get("cycles"), w.get("gap_max_ms"), w.get("dev_max_ms"), w.get("ret_peak_max"),
                    w.get("zero_while_signal"), w.get("equal_nonzero")) for w in r.get("windows", [])] or r.get("overall") or r, flush=True)
    json.dump(res, open(OUT / f"matrix-{plugin}.json", "w"), indent=1)


def ordnung(plugin="aeq"):
    """Return links created first (the send link becomes the feedback link): a stalled sync host must now block the probe."""
    res = []
    for async_ in (False, True):
        for sz in ("stopp", "kill"):
            unit, st = start(plugin, async_, ("--lv2-pfad", LV2))
            tag = f"{plugin}-{'async' if async_ else 'sync'}-{sz}-rueckzuerst"
            r = probe(unit, sz, tag, extra=("--rueck-zuerst",))
            stop(unit)
            res.append({"tag": tag, "result": {k: v for k, v in r.items() if k not in ("meta", "delays")}})
            print(tag, [(w.get("lo"), w.get("cycles"), w.get("gap_max_ms"), w.get("dev_max_ms"), w.get("ret_peak_max"), w.get("zero_while_signal"))
                        for w in r.get("windows", [])] or r, flush=True)
    json.dump(res, open(OUT / f"ordnung-{plugin}.json", "w"), indent=1)


def step3(plugin, starts=3):
    res = []
    keep = ("delay_median", "delay_spread", "shape", "delays", "overall")
    for k in range(starts):
        unit, st = start(plugin, True, ("--lv2-pfad", LV2))
        row = {"start": k + 1, "status": st, "load": load()}
        if plugin == "leer":
            row["empty"] = {k2: v for k2, v in probe(unit, "rundweg", f"{plugin}-s{k + 1}-leer", 6, "puls").items() if k2 in keep}
        else:
            cmd(unit, "active 1")
            row["active"] = {k2: v for k2, v in probe(unit, "rundweg", f"{plugin}-s{k + 1}-aktiv", 6, "puls").items() if k2 in keep}
            row["latency_call"] = cmd(unit, "latency")
            cmd(unit, "active 0")
            row["inactive"] = {k2: v for k2, v in probe(unit, "rundweg", f"{plugin}-s{k + 1}-inaktiv", 6, "puls").items() if k2 in keep}
            cmd(unit, "active 1")
        row["rss_kb_after"] = cmd(unit, "rss")["rss_kb"]
        stop(unit)
        res.append(row)
        print(json.dumps(row)[:700], flush=True)
    json.dump(res, open(OUT / f"step3-{plugin}.json", "w"), indent=1)


def gate():
    PLUGINS["agate"] = ("lv2:urn:ardour:a-exp", ["3=100", "4=0"])
    PLUGINS["aoffen"] = ("lv2:urn:ardour:a-exp", ["3=1", "4=-60"])
    res = {}
    for k in ("agate", "aoffen"):
        unit, st = start(k, True, ("--lv2-pfad", LV2))
        r = probe(unit, "gesund", f"{k}-ton", 10)
        stop(unit)
        res[k] = {"status": st, "overall": r.get("overall")}
        print(k, r.get("overall"), flush=True)
    json.dump(res, open(OUT / "gate.json", "w"), indent=1)


def pfad():
    unit, st = start("aeq", True)  # default --lv2-pfad = what instrument_host.py sets
    stop(unit)
    json.dump(st, open(OUT / "pfad-wirtweise.json", "w"), indent=1)
    print("instrument_host.py path only:", st.get("fehler"), "bereit", st.get("bereit"))
    unit, st = start("aeq", True, ("--lv2-pfad", LV2))
    stop(unit)
    json.dump(st, open(OUT / "pfad-mit-usrlib.json", "w"), indent=1)
    print("with /usr/lib/lv2 added:", st.get("fehler"), "bereit", st.get("bereit"))


def wineprocs():
    """Wine/yabridge processes of this user (scan of /proc, so no command line of ours matches itself)."""
    out = []
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                cl = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
            except OSError:
                continue
            if any(k in cl for k in ("wineserver", "yabridge-host", "winedevice", "services.exe", "explorer.exe", "plugplay", "rpcss", "wine-preloader")) \
                    and "messlauf" not in cl and "pgrep" not in cl:
                out.append(f"{pid} {cl[:110]}")
    return "\n".join(out)


def rss_tree(unit):
    """VmRSS (kB) per process of the unit's cgroup (host plus Wine processes) and the sum."""
    cg = subprocess.run(["systemctl", "--user", "show", "-p", "ControlGroup", "--value", unit], capture_output=True, text=True).stdout.strip()
    rows = {}
    for pid in open(f"/sys/fs/cgroup{cg}/cgroup.procs").read().split():
        try:
            comm = open(f"/proc/{pid}/comm").read().strip()
            for l in open(f"/proc/{pid}/status"):
                if l.startswith("VmRSS:"):
                    rows[f"{pid}:{comm}"] = int(l.split()[1])
        except OSError:
            pass
    return {"procs": rows, "sum_kb": sum(rows.values())}


def extra_for(plugin):
    return ("--lv2-pfad", LV2, "--defaults") + (("--hold-note", "48") if plugin in INSTR else ())


def start3(plugin):
    """Three host starts: time to ready, RSS tree, declared latency; effect: round trip with the empty rack is in `leer`; here
    the active/inactive round trip as step3 does. Instruments: only start, RSS, note check through a short probe run."""
    res = []
    for k in range(3):
        unit, st = start(plugin, True, extra_for(plugin))
        time.sleep(2)
        row = {"start": k + 1, "load": load(), "status": {x: st.get(x) for x in ("bereit", "fehler", "ready_s", "latency", "plugin", "start_to_ready_s")},
               "rss": rss_tree(unit)}
        if plugin in INSTR:
            r = probe(unit, "gesund", f"{plugin}-s{k + 1}-ton", 6, "ton")
            row["probe"] = r.get("overall")
        else:
            cmd(unit, "active 1")
            row["active"] = {k2: v for k2, v in probe(unit, "rundweg", f"{plugin}-s{k + 1}-aktiv", 6, "puls").items()
                             if k2 in ("delay_median", "delay_spread", "shape", "delays", "overall")}
            row["latency_call"] = cmd(unit, "latency")
        stop(unit)
        res.append(row)
        print(json.dumps(row)[:900], flush=True)
    json.dump(res, open(OUT / f"start3-{plugin}.json", "w"), indent=1)


def lang(plugin, dauer):
    unit, st = start(plugin, True, extra_for(plugin))
    tag = f"{plugin}-lang{dauer}"
    time.sleep(2)
    rss0 = rss_tree(unit)
    r = probe(unit, "gesund", tag, dauer, "ton")
    r["load_before"] = load()
    r["host_status"] = st
    r["rss_start"] = rss0
    r["rss_end"] = rss_tree(unit)
    stop(unit)
    json.dump(r, open(OUT / f"lang-{plugin}.json", "w"), indent=1)
    print(tag, json.dumps({k: v for k, v in r.items() if k not in ("meta", "delays")})[:1500], flush=True)


def killwine(plugin):
    import signal as sg
    unit, st = start(plugin, True, extra_for(plugin))
    time.sleep(1)
    before = rss_tree(unit)
    r = probe(unit, "killwine", f"{plugin}-killwine", 30, "ton")
    out = {"status": st, "before": before, "probe": {k: v for k, v in r.items() if k not in ("meta", "delays")}}
    t0 = time.monotonic()
    try:
        out["host_answers_after"] = cmd(unit, "rss")
    except Exception as e:  # noqa: BLE001
        out["host_answers_after"] = f"{type(e).__name__}: {e}"
    out["host_state"] = subprocess.run(["systemctl", "--user", "is-active", unit], capture_output=True, text=True).stdout.strip()
    try:
        out["rss_after"] = rss_tree(unit)
    except OSError as e:
        out["rss_after"] = str(e)
    out["wine_procs_after_s"] = wineprocs()
    stop(unit)
    time.sleep(3)
    out["wine_procs_after_stop"] = wineprocs()
    json.dump(out, open(OUT / f"killwine-{plugin}.json", "w"), indent=1)
    print(json.dumps(out)[:2500], flush=True)


def hostkill(plugin):
    """SIGKILL of the host's main process only (systemd keeps the cgroup): which Wine processes stay behind, and for how long?"""
    unit, st = start(plugin, True, extra_for(plugin))
    time.sleep(2)
    before = wineprocs()
    subprocess.run(["systemctl", "--user", "kill", "--kill-whom=main", "-s", "KILL", unit], capture_output=True)
    res, t0 = {}, time.monotonic()
    for t in (1, 3, 10, 30):
        time.sleep(max(0, t - (time.monotonic() - t0)))
        res[f"after_{t}s"] = wineprocs()
    res["unit_state"] = subprocess.run(["systemctl", "--user", "is-active", unit], capture_output=True, text=True).stdout.strip()
    stop(unit)
    time.sleep(2)
    res["after_unit_stop"] = wineprocs()
    json.dump({"before": before, **res}, open(OUT / f"hostkill-{plugin}.json", "w"), indent=1)
    print(json.dumps({"before": before, **res}), flush=True)


def _wins():
    t = subprocess.run("xwininfo -root -tree", shell=True, capture_output=True, text=True).stdout
    return [l.strip() for l in t.splitlines() if ("yabridge" in l or "(GUI)" in l or "Vital" in l or "Carla" in l) and "Firefox" not in l]


def _shot(wid, path):
    subprocess.run(["import", "-window", wid, path], capture_output=True)
    return os.path.exists(path)


def ui(plugin):
    """show_custom_ui: does a window exist (xwininfo), does it redraw after parameter changes (screenshots of that window differ),
    does the host stay alive, does hide remove it."""
    import re
    unit, st = start(plugin, True, extra_for(plugin))
    time.sleep(1)
    out = {"status": {k: st.get(k) for k in ("bereit", "fehler", "plugin")}, "windows_before": _wins()}
    out["show"] = cmd(unit, "ui 1")
    time.sleep(4)
    out["windows_open"] = _wins()
    wid = None
    for l in out["windows_open"]:
        m = re.match(r"(0x[0-9a-f]+) \"([^\"]*)\".*\s(\d+)x(\d+)\+", l)
        if m and ("(GUI)" in m.group(2) or "Vital" in m.group(2)):
            wid = m.group(1)
            out["window"] = {"id": wid, "title": m.group(2), "size": f"{m.group(3)}x{m.group(4)}"}
    out["host_alive_open"] = cmd(unit, "rss")
    d = Path(os.environ.get("INS_OUT", str(OUT))) / "roh"
    if wid:
        out["shot_before"] = _shot(wid, str(d / f"ui-{plugin}-vor.png"))
    changes = [(0, 0.9), (13, 0.5)] if plugin == "smw" else [(i, 0.9) for i in range(0, 40)]
    for i, v in changes:
        cmd(unit, f"param {i} {v}")
    time.sleep(2)
    if wid:
        out["shot_after"] = _shot(wid, str(d / f"ui-{plugin}-nach.png"))
        r = subprocess.run(["compare", "-metric", "AE", str(d / f"ui-{plugin}-vor.png"), str(d / f"ui-{plugin}-nach.png"), "null:"],
                           capture_output=True, text=True)
        out["pixels_changed"] = (r.stderr or r.stdout).strip()
    out["windows_after_param"] = _wins()
    out["host_alive_after_param"] = cmd(unit, "rss")
    time.sleep(2)
    out["hide"] = cmd(unit, "ui 0")
    time.sleep(2)
    out["windows_after_hide"] = _wins()
    stop(unit)
    json.dump(out, open(OUT / f"ui-{plugin}.json", "w"), indent=1)
    print(json.dumps(out, indent=1), flush=True)


if __name__ == "__main__":
    (OUT / "roh").mkdir(parents=True, exist_ok=True)
    m = sys.argv[1]
    print("loadavg at start", load(), flush=True)
    if m == "matrix":
        matrix(sys.argv[2])
    elif m == "step3":
        step3(sys.argv[2])
    elif m == "leer":
        step3("leer")
    elif m == "ordnung":
        ordnung(sys.argv[2] if len(sys.argv) > 2 else "aeq")
    elif m == "start3":
        start3(sys.argv[2])
    elif m == "lang":
        lang(sys.argv[2], int(sys.argv[3]))
    elif m == "killwine":
        killwine(sys.argv[2])
    elif m == "hostkill":
        hostkill(sys.argv[2])
    elif m == "ui":
        ui(sys.argv[2])
    elif m == "gate":
        gate()
    elif m == "pfad":
        pfad()
