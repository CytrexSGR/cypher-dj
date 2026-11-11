"""djk-insert (plan 1.11 task 6) with fakes for systemctl, systemd-run and pw-link: no studio, no unit, no JACK.
The fake systemd-run records its arguments, creates the "unit" (a marker file) and writes the status file the way the empty-rack
host does (bereit true, effekt leer); a fake systemctl reads the marker. Instance INST is only a folder under /dev/shm."""
import json
import os
import shutil
import subprocess
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[3] / "start" / "djk-insert"
INST = os.environ.get("CYPHERDJ_INSTANZ") or "b"
KERN = f"cypherdj-kern-{INST}"


def host(h):
    return f"cypherdj-ins{h}-{INST}"


def _attrappen(tmp_path, host_modus="leer", kern_ports=True, h=1):
    """host_modus: scheitert (systemd-run fails), engine (host exits before ready, JACK missing), leer (ready, empty rack), tot (host exits 2 with a reason), haengt (never writes a status file)."""
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    log = tmp_path / "log"
    log.mkdir()
    (tmp_path / "aktiv").mkdir()
    aus = [f"{host(n)}:audio-out{k}" for n in range(1, 5) for k in (1, 2)]
    ein = [f"{host(n)}:audio-in{k}" for n in range(1, 5) for k in (1, 2)]
    if kern_ports:
        aus += [f"{KERN}:arr_ins_{n}_{c}" for n in range(1, 5) for c in "LR"]
        ein += [f"{KERN}:arr_insret_{n}_{c}" for n in range(1, 5) for c in "LR"]
    (tmp_path / "aus_ports").write_text("".join(p + "\n" for p in aus))
    (tmp_path / "ein_ports").write_text("".join(p + "\n" for p in ein))
    (bin_ / "systemctl").write_text(
        f'#!/bin/sh\nA={tmp_path}/aktiv\nU=""\nfor x in "$@"; do case "$x" in cypherdj-ins*.service) U=${{x%.service}};; esac; done\n'
        'case "$*" in\n'
        f'  *is-active*cypherdj-kern-{INST}.service*) echo active;;\n'
        '  *is-active*) [ -e "$A/$U" ] && echo active || echo inactive;;\n'
        '  *show-environment*) ;;\n'
        f'  *MainPID*) cat "$A/$U.pid" 2>/dev/null || echo 0;;\n'
        f'  *NRestarts*) cat "$A/$U.nr" 2>/dev/null || echo 0;;\n'
        f'  *" stop "*) rm -f "$A/$U"; echo "$U" >> {log}/stop;;\n'
        '  *list-units*) [ -e "$A/$U" ] && echo "$U.service loaded active running";;\n'
        'esac\nexit 0\n')
    (bin_ / "pw-link").write_text(
        f'#!/bin/sh\ncase "$1" in\n  -o) cat {tmp_path}/aus_ports;;\n  -i) cat {tmp_path}/ein_ports;;\n  -l) ;;\n'
        f'  -d) printf "%s\\t%s\\n" "$2" "$3" >> {log}/pw-link-d;;\n'
        f'  *) printf "%s\\t%s\\n" "$1" "$2" >> {log}/pw-link;;\nesac\nexit 0\n')
    markt = {"leer": f'touch "$A/$U"; printf 1234 > "$A/$U.pid"; printf 0 > "$A/$U.nr"; printf \'{{"bereit": true, "effekt": "leer", "fehler": [], "pid": 1234}}\' > "$ST"; printf 42 > "$ST.puls"',
             "engine": 'printf \'{"bereit": false, "fehler": ["engine_init: no audio"]}\' > "$ST"',
             "scheitert": "exit 1",
             "tot": 'printf \'{"bereit": false, "fehler": ["nicht_ladbar"], "grund": "engine_init: no audio"}\' > "$ST"',
             "haengt": ":"}[host_modus]
    (bin_ / "systemd-run").write_text(
        f'#!/bin/sh\nA={tmp_path}/aktiv\nprintf "%s\\n" "$*" >> {log}/systemd-run\nST=""\nU=""\n'
        'while [ $# -gt 0 ]; do case "$1" in --status) ST=$2;; --unit=*) U=${1#--unit=};; esac; shift; done\n'
        f'{markt}\nexit 0\n')
    for f in bin_.iterdir():
        f.chmod(0o755)
    home = tmp_path / "home"
    (home / ".local/lib/cypherdj/vst3/Cypher EQ.vst3/Contents").mkdir(parents=True)
    env = dict(os.environ, PATH=f"{bin_}:{os.environ['PATH']}", HOME=str(home), XDG_RUNTIME_DIR=str(tmp_path),
               DISPLAY=":1", XAUTHORITY="/run/user/1000/gdm/Xauthority", DJK_INSERT_WARTE="3")
    return env, log, home


def _lauf(env, *args):
    return subprocess.run(["bash", str(SKRIPT), *args], env=env, capture_output=True, text=True, timeout=30)


def _shm():
    shm = Path(f"/dev/shm/cypherdj-{INST}")
    assert not shm.exists(), f"Instanz {INST} ist belegt"
    shm.mkdir()
    return shm


def _vst3(home):
    return f"vst3:{home}/.local/lib/cypherdj/vst3/Cypher EQ.vst3#cypher-eq"


def kanten_soll(h):
    return [f"{KERN}:arr_ins_{h}_L\t{host(h)}:audio-in1", f"{KERN}:arr_ins_{h}_R\t{host(h)}:audio-in2",
            f"{host(h)}:audio-out1\t{KERN}:arr_insret_{h}_L", f"{host(h)}:audio-out2\t{KERN}:arr_insret_{h}_R"]


def _aufrufe(log):
    p = log / "systemd-run"
    return p.read_text().splitlines() if p.exists() else []


def test_start_schreibt_vier_kanten_einmal_und_startet_die_unit_mit_echtem_home_und_display(tmp_path):
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        spec = _vst3(home)
        r = _lauf(env, "start", "1", spec, "--instanz", INST)
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        assert (shm / "kanten").read_text().splitlines() == kanten_soll(1)
        a = _aufrufe(log)
        assert len(a) == 1, a
        for teil in (f"--unit={host(1)}", f"--name {host(1)}", f"--effekt {spec}", f"--status {shm}/ins-1.json", f"--sock {shm}/ins-1.sock",
                     "Restart=always", "RestartPreventExitStatus=2", "PartOf=cypherdj.target", "--setenv=DISPLAY=:1",
                     "--setenv=XAUTHORITY=/run/user/1000/gdm/Xauthority", "node.async = true", f"node.group = cypherdj-{INST}"):
            assert teil in a[0], (teil, a[0])
        assert "--setenv=HOME" not in a[0], "D16: real HOME, not a private one"
        links = (log / "pw-link").read_text().splitlines()
        assert links == kanten_soll(1), links
        # second start: unit runs, nothing starts again, nothing is duplicated
        r = _lauf(env, "start", "1", spec, "--instanz", INST)
        assert r.returncode == 0, (r.stdout, r.stderr)
        assert len(_aufrufe(log)) == 1
        assert (shm / "kanten").read_text().splitlines() == kanten_soll(1)
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_kanal_zuordnung_links_zu_eingang1_rechts_zu_eingang2_und_zurueck(tmp_path):
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        assert _lauf(env, "start", "3", _vst3(home), "--instanz", INST).returncode == 0
        paare = {tuple(z.split("\t")) for z in (shm / "kanten").read_text().splitlines()}
        assert (f"{KERN}:arr_ins_3_L", f"{host(3)}:audio-in1") in paare
        assert (f"{KERN}:arr_ins_3_R", f"{host(3)}:audio-in2") in paare
        assert (f"{host(3)}:audio-out1", f"{KERN}:arr_insret_3_L") in paare
        assert (f"{host(3)}:audio-out2", f"{KERN}:arr_insret_3_R") in paare and len(paare) == 4
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_ohne_kern_ports_werden_kanten_nur_eingetragen(tmp_path):
    env, log, home = _attrappen(tmp_path, kern_ports=False)
    shm = _shm()
    try:
        r = _lauf(env, "start", "2", _vst3(home), "--instanz", INST)
        assert r.returncode == 0, (r.stdout, r.stderr)
        assert (shm / "kanten").read_text().splitlines() == kanten_soll(2)
        assert not (log / "pw-link").exists(), "kern ports missing: record only, the core links"
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_mono_plugin_bekommt_dieselben_vier_stereo_kanten(tmp_path):
    # measured on instance e (t6.md): Carla's rack exposes audio-in1/2 and audio-out1/2 for a mono plugin too, so there is no mono linking
    env, log, home = _attrappen(tmp_path)
    (home / ".local/lib/cypherdj/lv2/lsp.lv2").mkdir(parents=True)
    (home / ".local/lib/cypherdj/lv2/lsp.lv2/manifest.ttl").write_text("@prefix plug: <http://lsp-plug.in/plugins/lv2/> .\n\nplug:compressor_mono\n\ta lv2:Plugin ;\n\tlv2:binary <x.so> .\n")
    shm = _shm()
    try:
        r = _lauf(env, "start", "1", "lv2:http://lsp-plug.in/plugins/lv2/compressor_mono#", "--instanz", INST)
        assert r.returncode == 0, (r.stdout, r.stderr)
        assert (shm / "kanten").read_text().splitlines() == kanten_soll(1)
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_stop_entfernt_unit_und_nur_die_eigenen_kanten(tmp_path):
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        fremd = f"{KERN}:arr_midi_1\tcypherdj-wirt-arr1-{INST}:events-in"
        (shm / "kanten").write_text(fremd + "\n")
        assert _lauf(env, "start", "1", _vst3(home), "--instanz", INST).returncode == 0
        assert _lauf(env, "start", "2", _vst3(home), "--instanz", INST).returncode == 0
        r = _lauf(env, "stop", "1", "--instanz", INST)
        assert r.returncode == 0, (r.stdout, r.stderr)
        assert not (tmp_path / "aktiv" / host(1)).exists() and (tmp_path / "aktiv" / host(2)).exists()
        assert (shm / "kanten").read_text().splitlines() == [fremd] + kanten_soll(2)
        assert not (shm / "ins-1.json").exists() and not (shm / "ins-1.json.puls").exists()
        # stopping a host that is not running is fine
        assert _lauf(env, "stop", "1", "--instanz", INST).returncode == 0
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_fehlendes_plugin_exit_2_unit_wird_nicht_gestartet_keine_kanten(tmp_path):
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        for spec, wort in ((f"vst3:{home}/nope.vst3#x", "nope.vst3"), ("lv2:urn:gibt:es:nicht#", "urn:gibt:es:nicht")):
            r = _lauf(env, "start", "1", spec, "--instanz", INST)
            assert r.returncode == 2, (spec, r.returncode, r.stdout, r.stderr)
            assert wort in r.stderr, r.stderr
        assert _aufrufe(log) == [] and not (tmp_path / "aktiv" / host(1)).exists()
        assert not (shm / "kanten").exists() or (shm / "kanten").read_text() == ""
        # unknown format: also exit 2, nothing started
        assert _lauf(env, "start", "1", "clap:x#y", "--instanz", INST).returncode == 2
        assert _aufrufe(log) == []
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_start_5_ist_exit_3_und_startet_nichts(tmp_path):
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        for h in ("5", "0", "x", "-1", ""):
            r = _lauf(env, "start", h, _vst3(home), "--instanz", INST)
            assert r.returncode == 3, (h, r.returncode, r.stdout, r.stderr)
            assert "host_grenze" in r.stderr
        assert _lauf(env, "stop", "5", "--instanz", INST).returncode == 3
        assert _lauf(env, "status", "5", "--instanz", INST).returncode == 3
        assert _aufrufe(log) == [] and not (log / "stop").exists() and not (shm / "kanten").exists()
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_host_stirbt_beim_start_exit_2_mit_grund_und_keine_unit_keine_kanten(tmp_path):
    env, log, home = _attrappen(tmp_path, host_modus="tot")
    shm = _shm()
    try:
        r = _lauf(env, "start", "1", _vst3(home), "--instanz", INST)
        assert r.returncode == 2, (r.returncode, r.stdout, r.stderr)
        assert "engine_init: no audio" in r.stderr, r.stderr
        assert not (shm / "kanten").exists() or (shm / "kanten").read_text() == ""
        assert not (tmp_path / "aktiv" / host(1)).exists()
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_host_wird_nicht_bereit_exit_5_unit_wird_gestoppt(tmp_path):
    env, log, home = _attrappen(tmp_path, host_modus="haengt")
    shm = _shm()
    try:
        r = _lauf(env, "start", "1", _vst3(home), "--instanz", INST)
        assert r.returncode == 5, (r.returncode, r.stdout, r.stderr)
        assert (log / "stop").read_text().split() == [host(1)]
        assert not (shm / "kanten").exists() or (shm / "kanten").read_text() == ""
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_status_eines_nie_gestarteten_hosts_ist_laeuft_false_und_exit_0(tmp_path):
    # negative control: a host that never ran answers false, not an error
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        r = _lauf(env, "status", "4", "--instanz", INST)
        assert r.returncode == 0, (r.stdout, r.stderr)
        z = r.stdout.strip().splitlines()
        assert len(z) == 1
        d = json.loads(z[0])
        assert d["h"] == 4 and d["laeuft"] is False and d["bereit"] is None and d["grund"] is None and d["puls"] is None
        assert set(d) == {"h", "laeuft", "bereit", "grund", "sock", "puls", "pid", "starts"}
        assert d["pid"] is None and d["starts"] is None
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_status_eines_laufenden_hosts_zeigt_leer_sock_und_puls(tmp_path):
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        assert _lauf(env, "start", "1", _vst3(home), "--instanz", INST).returncode == 0
        d = json.loads(_lauf(env, "status", "1", "--instanz", INST).stdout)
        assert d == {"h": 1, "laeuft": True, "bereit": "leer", "grund": None, "sock": f"{shm}/ins-1.sock", "puls": 42, "pid": 1234, "starts": 0}
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_status_nach_neustart_meldet_die_alte_datei_nicht_als_bereit(tmp_path):
    # the unit was restarted by systemd (new MainPID, NRestarts 1) and the status file is still the dead process's: it must not
    # count as "leer"/"geladen" (an empty rack would be taken for a loaded one); once the new process writes its own file, it counts
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        assert _lauf(env, "start", "1", _vst3(home), "--instanz", INST).returncode == 0
        (shm / "ins-1.json").write_text('{"bereit": true, "effekt": "geladen", "fehler": [], "pid": 1234}')
        assert json.loads(_lauf(env, "status", "1", "--instanz", INST).stdout)["bereit"] == "geladen"
        (tmp_path / "aktiv" / host(1)).with_name(host(1) + ".pid").write_text("1300")
        (tmp_path / "aktiv" / (host(1) + ".nr")).write_text("1")
        d = json.loads(_lauf(env, "status", "1", "--instanz", INST).stdout)
        assert d["laeuft"] is True and d["bereit"] is None and d["grund"] == "neustart" and d["puls"] is None, d
        assert d["pid"] == 1300 and d["starts"] == 1, d
        (shm / "ins-1.json").write_text('{"bereit": true, "effekt": "leer", "fehler": [], "pid": 1300}')
        d = json.loads(_lauf(env, "status", "1", "--instanz", INST).stdout)
        assert d["bereit"] == "leer" and d["grund"] is None and d["pid"] == 1300, d
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_engine_fehler_vor_bereit_ist_exit_5_nicht_2(tmp_path):
    # JACK missing is not a plugin problem: exit 5 with the reason; exit 2 is only for nicht_ladbar / kein_effekt
    env, log, home = _attrappen(tmp_path, host_modus="engine")
    shm = _shm()
    try:
        r = _lauf(env, "start", "1", _vst3(home), "--instanz", INST)
        assert r.returncode == 5, (r.returncode, r.stdout, r.stderr)
        assert "engine_init: no audio" in r.stderr and "not loadable" not in r.stderr, r.stderr
        assert not (tmp_path / "aktiv" / host(1)).exists()
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_zweiter_start_mit_anderem_plugin_ist_exit_4_belegt_gleiches_ist_exit_0(tmp_path):
    env, log, home = _attrappen(tmp_path)
    (home / ".local/lib/cypherdj/vst3/Anderes.vst3/Contents").mkdir(parents=True)
    shm = _shm()
    try:
        assert _lauf(env, "start", "1", _vst3(home), "--instanz", INST).returncode == 0
        r = _lauf(env, "start", "1", f"vst3:{home}/.local/lib/cypherdj/vst3/Anderes.vst3#x", "--instanz", INST)
        assert r.returncode == 4 and "belegt" in r.stderr and "Cypher EQ" in r.stderr, (r.returncode, r.stdout, r.stderr)
        assert len(_aufrufe(log)) == 1 and (tmp_path / "aktiv" / host(1)).exists()
        assert (shm / "kanten").read_text().splitlines() == kanten_soll(1)
        assert _lauf(env, "start", "1", _vst3(home), "--instanz", INST).returncode == 0
        # after stop the slot is free again
        assert _lauf(env, "stop", "1", "--instanz", INST).returncode == 0
        assert _lauf(env, "start", "1", f"vst3:{home}/.local/lib/cypherdj/vst3/Anderes.vst3#x", "--instanz", INST).returncode == 0
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_systemd_run_scheitert_raeumt_kanten_dieses_hosts_ab(tmp_path):
    env, log, home = _attrappen(tmp_path, host_modus="scheitert")
    shm = _shm()
    try:
        fremd = f"{KERN}:arr_midi_1\tcypherdj-wirt-arr1-{INST}:events-in"
        (shm / "kanten").write_text(fremd + "\n" + "\n".join(kanten_soll(1)) + "\n")
        r = _lauf(env, "start", "1", _vst3(home), "--instanz", INST)
        assert r.returncode == 5, (r.returncode, r.stdout, r.stderr)
        assert (shm / "kanten").read_text().splitlines() == [fremd]
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_status_eines_toten_hosts_meldet_keinen_alten_bereit_zustand(tmp_path):
    # unit gone (systemd between crash and restart): the old file says bereit, but nothing runs: no state, no pulse
    env, log, home = _attrappen(tmp_path)
    shm = _shm()
    try:
        assert _lauf(env, "start", "1", _vst3(home), "--instanz", INST).returncode == 0
        (tmp_path / "aktiv" / host(1)).unlink()
        d = json.loads(_lauf(env, "status", "1", "--instanz", INST).stdout)
        assert d["laeuft"] is False and d["bereit"] is None and d["puls"] is None and d["pid"] is None, d
    finally:
        shutil.rmtree(shm, ignore_errors=True)
