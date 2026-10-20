"""djk-instrumente mit Attrappen für systemctl und pw-link (kein Studio, keine Units): Status-Datei sagt vst3:rb338, Bundle fehlt."""
import os
import shutil
import subprocess
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[3] / "start" / "djk-instrumente"
# Prüfinstanz (Review K2b F10): CYPHERDJ_INSTANZ wählt sie, Vorgabe b; die Ordner unter /dev/shm/cypherdj-<INST> legt
# dieser Test an und räumt sie ab (belegt: der Test bricht ab, statt sie anzufassen)
INST = os.environ.get("CYPHERDJ_INSTANZ") or "b"


def test_status_sagt_rb338_bundle_fehlt_ist_sofort_eine_klare_meldung(tmp_path):
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    (bin_ / "systemctl").write_text(f'#!/bin/sh\ncase "$*" in *is-active*cypherdj-kern-{INST}*) echo active;; *is-active*) echo inactive;; esac\nexit 0\n')
    (bin_ / "pw-link").write_text(f'#!/bin/sh\necho "cypherdj-kern-{INST}:midi_aus_1"\n')
    (bin_ / "systemd-run").write_text("#!/bin/sh\necho SYSTEMD-RUN-AUFGERUFEN >&2\nexit 0\n")
    for f in bin_.iterdir():
        f.chmod(0o755)
    home = tmp_path / "home"
    (home / ".local/lib/cypherdj/lv2/Surge XT.lv2").mkdir(parents=True)
    (home / ".local/lib/cypherdj/lv2/Surge XT.lv2/manifest.ttl").write_text("")
    shm = Path(f"/dev/shm/cypherdj-{INST}")
    assert not shm.exists(), f"Instanz {INST} ist belegt"
    shm.mkdir()
    try:
        (shm / "wirt-bass.json").write_text('{"art": "vst3:rb338"}')
        env = dict(os.environ, PATH=f"{bin_}:{os.environ['PATH']}", HOME=str(home), XDG_RUNTIME_DIR=str(tmp_path))
        t0 = __import__("time").time()
        r = subprocess.run(["bash", str(SKRIPT), "--instanz", INST, "--nur-wirte"], env=env, capture_output=True, text=True, timeout=20)
        assert r.returncode == 2, (r.returncode, r.stdout, r.stderr)
        assert "rb338 is missing" in r.stderr and "SYSTEMD-RUN" not in r.stderr, r.stderr
        assert __import__("time").time() - t0 < 10
        # Gegenprobe: mit vorhandenem Bundle läuft das Skript über die Prüfung hinaus (es wartet dann auf "bereit", die Attrappe
        # von systemd-run startet nichts): kein Sofort-Abbruch mit rc 2 innerhalb von 4 s
        (home / ".local/lib/cypherdj/vst3/rb338.vst3/Contents").mkdir(parents=True)
        try:
            r = subprocess.run(["bash", str(SKRIPT), "--instanz", INST, "--nur-wirte"], env=env, capture_output=True, text=True, timeout=4)
            assert "rb338 is missing" not in r.stderr and r.returncode != 2, (r.returncode, r.stderr)
        except subprocess.TimeoutExpired:
            pass
    finally:
        shutil.rmtree(shm, ignore_errors=True)


# ---------------------------------------------------------------- D1 K2a: Produktions-Slot arr1 (Spec 2.4)

def _attrappen(tmp_path, aktiv=(), aus_ports=(), ein_ports=()):
    """systemctl (aktiv: Units ohne Suffix-Prüfung, Kern immer), pw-link (Port-Listen, Verbinden ins Log), systemd-run
    (ins Log; schreibt die Status-Datei des Wirts mit "bereit": true wie wirt.py). Kein Carla, keine Unit, kein JACK."""
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    log = tmp_path / "log"
    log.mkdir()
    (tmp_path / "aus_ports").write_text("".join(p + "\n" for p in aus_ports))
    (tmp_path / "ein_ports").write_text("".join(p + "\n" for p in ein_ports))
    faelle = "".join(f'  *is-active*{u}.service*) echo active;;\n' for u in aktiv)
    (bin_ / "systemctl").write_text(
        f'#!/bin/sh\ncase "$*" in\n  *is-active*cypherdj-kern-{INST}.service*) echo active;;\n' + faelle +
        '  *is-active*) echo inactive;;\nesac\nexit 0\n')
    (bin_ / "pw-link").write_text(
        f'#!/bin/sh\ncase "$1" in\n  -o) cat {tmp_path}/aus_ports;;\n  -i) cat {tmp_path}/ein_ports;;\n  -l) ;;\n'
        f'  *) printf "%s\\t%s\\n" "$1" "$2" >> {log}/pw-link;;\nesac\nexit 0\n')
    (bin_ / "systemd-run").write_text(
        f'#!/bin/sh\nprintf "%s\\n" "$*" >> {log}/systemd-run\nST=""\nwhile [ $# -gt 0 ]; do [ "$1" = --status ] && ST=$2; shift; done\n'
        '[ -n "$ST" ] && printf \'{"bereit": true, "art": "lv2"}\' > "$ST"\nexit 0\n')
    for f in bin_.iterdir():
        f.chmod(0o755)
    home = tmp_path / "home"
    (home / ".local/lib/cypherdj/lv2/Surge XT.lv2").mkdir(parents=True)
    (home / ".local/lib/cypherdj/lv2/Surge XT.lv2/manifest.ttl").write_text("")
    env = dict(os.environ, PATH=f"{bin_}:{os.environ['PATH']}", HOME=str(home), XDG_RUNTIME_DIR=str(tmp_path))
    return env, log, home


def _lauf(env, *args):
    return subprocess.run(["bash", str(SKRIPT), "--instanz", INST, *args], env=env, capture_output=True, text=True, timeout=20)


def _shm():
    shm = Path(f"/dev/shm/cypherdj-{INST}")
    assert not shm.exists(), f"Instanz {INST} ist belegt"
    shm.mkdir()
    return shm


ARR_KANTEN = [f"cypherdj-kern-{INST}:arr_midi_1\tcypherdj-wirt-arr1-{INST}:events-in",
              f"cypherdj-wirt-arr1-{INST}:audio-out1\tcypherdj-kern-{INST}:arr_rueck_1_L",
              f"cypherdj-wirt-arr1-{INST}:audio-out2\tcypherdj-kern-{INST}:arr_rueck_1_R"]


WIRT_AUS = [f"cypherdj-wirt-arr1-{INST}:audio-out1", f"cypherdj-wirt-arr1-{INST}:audio-out2"]
WIRT_EIN = [f"cypherdj-wirt-arr1-{INST}:events-in"]


def test_arr1_startet_eigene_unit_und_traegt_kanten_ein_auch_ohne_kern_ports(tmp_path):
    # Kern ohne arr-Ports (älter als K2b) und ohne midi_aus_1: arr1 braucht die DJ-Ströme nicht. Die eigenen Ports des Wirts sind da.
    env, log, home = _attrappen(tmp_path, aus_ports=WIRT_AUS, ein_ports=WIRT_EIN)
    shm = _shm()
    try:
        r = _lauf(env, "--arr1")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        aufrufe = (log / "systemd-run").read_text().splitlines()
        assert len(aufrufe) == 1, aufrufe  # nur arr1, bass und melodie bleiben unberührt
        a = aufrufe[0]
        for teil in (f"--unit=cypherdj-wirt-arr1-{INST}", f"--name cypherdj-wirt-arr1-{INST}", "--lv2 https://surge-synthesizer.github.io/lv2/surge-xt",
                     f"--status {shm}/wirt-arr1.json", f"--sock {shm}/wirt-arr1.sock",
                     f"--aktiv {home}/.config/cypherdj-{INST}/klang-arr1.fxp", "PartOf=cypherdj.target"):
            assert teil in a, (teil, a)
        assert (shm / "kanten").read_text().splitlines() == ARR_KANTEN
        assert not (log / "pw-link").exists(), "fehlende Kern-Ports: nichts verbinden, nur eintragen"
        # ehrlich (Spec 6.9): ein Kern ohne arr-Ports ist älter als K2b; der Neustart des Studios holt sie
        assert "older than D1 K2b" in r.stdout and "restart the studio" in r.stdout, r.stdout
        assert "live" not in r.stdout and "links it once the port exists" not in r.stdout, r.stdout
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr1_eigene_wirt_ports_fehlen_nach_bereit_ist_ein_fehler(tmp_path):
    # "bereit" in der Status-Datei, aber der Wirt hat keine Ports (Restart-Schleife, falscher Klientname): Fehler, nicht
    # still eintragen und "live" melden. Je fehlender Port einmal (Ausgang, Eingang).
    for aus, ein, fehlt in ((WIRT_AUS, [], f"cypherdj-wirt-arr1-{INST}:events-in"), ([], WIRT_EIN, f"cypherdj-wirt-arr1-{INST}:audio-out1")):
        t = tmp_path / fehlt.split(":")[1]
        t.mkdir()
        env, log, _ = _attrappen(t, aus_ports=aus, ein_ports=ein)
        shm = _shm()
        try:
            r = _lauf(env, "--arr1")
            assert r.returncode == 5, (fehlt, r.returncode, r.stdout, r.stderr)
            assert fehlt in r.stderr and "wirt" in r.stderr, r.stderr
            assert "live" not in r.stdout, r.stdout
        finally:
            shutil.rmtree(shm, ignore_errors=True)


def test_arr1_ist_idempotent(tmp_path):
    env, log, _ = _attrappen(tmp_path, aktiv=[f"cypherdj-wirt-arr1-{INST}"], aus_ports=WIRT_AUS, ein_ports=WIRT_EIN)
    shm = _shm()
    try:
        (shm / "wirt-arr1.json").write_text('{"bereit": true, "art": "lv2"}')
        (shm / "kanten").write_text("andere\tzeile\n" + ARR_KANTEN[0] + "\n")
        for _ in range(2):
            r = _lauf(env, "--arr1")
            assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
            assert "already running" in r.stdout, r.stdout
        assert not (log / "systemd-run").exists(), "laufender Wirt wird nicht neu gestartet"
        assert (shm / "kanten").read_text().splitlines() == ["andere\tzeile"] + ARR_KANTEN, "keine Doppelten, Fremdes bleibt"
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr1_verbindet_sobald_die_kern_ports_da_sind(tmp_path):
    env, log, _ = _attrappen(
        tmp_path, aus_ports=[f"cypherdj-kern-{INST}:arr_midi_1", f"cypherdj-wirt-arr1-{INST}:audio-out1", f"cypherdj-wirt-arr1-{INST}:audio-out2"],
        ein_ports=[f"cypherdj-wirt-arr1-{INST}:events-in", f"cypherdj-kern-{INST}:arr_rueck_1_L", f"cypherdj-kern-{INST}:arr_rueck_1_R"])
    shm = _shm()
    try:
        r = _lauf(env, "--arr1")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        assert (log / "pw-link").read_text().splitlines() == ARR_KANTEN
        assert (shm / "kanten").read_text().splitlines() == ARR_KANTEN
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr1_mit_bass_oder_melodie_ist_ein_aufruffehler(tmp_path):
    env, log, _ = _attrappen(tmp_path)
    for extra in (["--bass", "surge"], ["--melodie", "fluegel"]):
        r = _lauf(env, "--arr1", *extra)
        assert r.returncode == 2 and "--arr1 is the production slot" in r.stderr, (extra, r.returncode, r.stderr)
    assert not (log / "systemd-run").exists()


def test_arr1_steht_in_der_hilfe():
    r = subprocess.run(["bash", str(SKRIPT), "--help"], capture_output=True, text=True, timeout=10)
    assert r.returncode == 0 and "--arr1" in r.stdout and "cypherdj-wirt-arr1" in r.stdout, r.stdout


def test_ohne_arr1_bleiben_die_dj_gruppen_wie_sie_waren(tmp_path):
    # Negativ-Kontrolle: der gemeinsame Gruppen-Weg ändert bass und melodie nicht (Kanten, Units, keine arr-Zeile)
    env, log, _ = _attrappen(tmp_path, aus_ports=[f"cypherdj-kern-{INST}:midi_aus_1"])
    shm = _shm()
    try:
        r = _lauf(env, "--nur-wirte")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        units = [z.split("--unit=")[1].split()[0] for z in (log / "systemd-run").read_text().splitlines()]
        assert units == [f"cypherdj-wirt-bass-{INST}", f"cypherdj-wirt-melodie-{INST}"]
        erwartet = [f"cypherdj-kern-{INST}:midi_aus_1\tcypherdj-wirt-bass-{INST}:events-in",
                    f"cypherdj-wirt-bass-{INST}:audio-out1\tcypherdj-kern-{INST}:rueck_erz_2_L",
                    f"cypherdj-wirt-bass-{INST}:audio-out2\tcypherdj-kern-{INST}:rueck_erz_2_R",
                    f"cypherdj-kern-{INST}:midi_aus_2\tcypherdj-wirt-melodie-{INST}:events-in",
                    f"cypherdj-wirt-melodie-{INST}:audio-out1\tcypherdj-kern-{INST}:rueck_erz_3_L",
                    f"cypherdj-wirt-melodie-{INST}:audio-out2\tcypherdj-kern-{INST}:rueck_erz_3_R"]
        assert (shm / "kanten").read_text().splitlines() == erwartet
        assert (log / "pw-link").read_text().splitlines() == erwartet, "DJ-Kanten werden wie bisher immer verbunden"
    finally:
        shutil.rmtree(shm, ignore_errors=True)


# ---------------------------------------------------------------- Spec 6.9: djk-stop und djk-start kennen wirt-arr1

START = Path(__file__).resolve().parents[3] / "start"


def _units_attrappen(tmp_path, geladen=()):
    """systemctl mit Zustand (eine Datei je geladener Unit): is-active, list-units, stop, reset-failed, show; systemd-run
    legt die Unit an und schreibt die Status-Datei mit "bereit" wie wirt.py; pw-link kennt die Ports des arr1-Wirts, keine
    arr-Ports des Kerns (Kern älter als K2b); pactl scheitert (kein Ton, keine Senke); ss leer. Kein Carla, keine echte Unit."""
    bin_, log, units = tmp_path / "bin", tmp_path / "log", tmp_path / "units"
    for d in (bin_, log, units):
        d.mkdir()
    for u in (f"cypherdj-kern-{INST}", *geladen):
        (units / f"{u}.service").write_text("")
    (bin_ / "systemctl").write_text(f"""#!/bin/bash
U={units}; printf '%s\\n' "$*" >> {log}/systemctl
args=(); for a in "$@"; do case "$a" in --*) ;; *) args+=("$a");; esac; done
cmd=${{args[0]}}; set -- "${{args[@]:1}}"
case "$cmd" in
  is-active) [ -f "$U/$1" ] && echo active || echo inactive;;
  list-units) for u in "$@"; do [ -f "$U/$u" ] && echo "$u loaded active running x"; done;;
  stop) for u in "$@"; do rm -f "$U/$u"; done;;
  show) [ -f "$U/${{@: -1}}" ] && echo active || echo;;
esac
exit 0
""")
    (bin_ / "systemd-run").write_text(f"""#!/bin/bash
printf '%s\\n' "$*" >> {log}/systemd-run
ST=""; for a in "$@"; do case "$a" in --unit=*) : > "{units}/${{a#--unit=}}.service";; esac; done
while [ $# -gt 0 ]; do [ "$1" = --status ] && ST=$2; shift; done
[ -n "$ST" ] && printf '{{"bereit": true, "art": "lv2"}}' > "$ST"
exit 0
""")
    ports_aus = "\n".join(WIRT_AUS)
    (bin_ / "pw-link").write_text(f"""#!/bin/sh
case "$1" in -o) printf '{ports_aus}\n';; -i) printf '{WIRT_EIN[0]}\n';; -l) ;; *) printf '%s\t%s\n' "$1" "$2" >> {log}/pw-link;; esac
exit 0
""")
    (bin_ / "pactl").write_text(f"#!/bin/sh\nprintf '%s\\n' \"$*\" >> {log}/pactl\nexit 1\n")
    (bin_ / "ss").write_text("#!/bin/sh\nexit 0\n")
    for f in bin_.iterdir():
        f.chmod(0o755)
    home = tmp_path / "home"
    (home / ".local/lib/cypherdj/lv2/Surge XT.lv2").mkdir(parents=True)
    (home / ".local/lib/cypherdj/lv2/Surge XT.lv2/manifest.ttl").write_text("")
    run = tmp_path / "run"
    run.mkdir()
    env = dict(os.environ, PATH=f"{bin_}:{os.environ['PATH']}", HOME=str(home), XDG_RUNTIME_DIR=str(run))
    env.pop("CYPHERDJ_INSTANZ", None)
    return env, log, units


def test_djk_stop_raeumt_den_arr1_wirt_ab(tmp_path):
    env, log, units = _units_attrappen(tmp_path)
    shm = _shm()
    try:
        r = _lauf(env, "--arr1")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        assert (units / f"cypherdj-wirt-arr1-{INST}.service").exists(), "Vorbedingung: arr1 läuft (simuliert)"
        # Trockenlauf nennt ihn
        t = subprocess.run(["bash", str(START / "djk-stop"), "--instanz", INST, "--alles", "--trocken"], env=env,
                           capture_output=True, text=True, timeout=30)
        assert f"would stop cypherdj-wirt-arr1-{INST}.service" in t.stdout, t.stdout
        assert (units / f"cypherdj-wirt-arr1-{INST}.service").exists(), "Trockenlauf ändert nichts"
        s = subprocess.run(["bash", str(START / "djk-stop"), "--instanz", INST], env=env, capture_output=True, text=True, timeout=30)
        assert s.returncode == 0, (s.returncode, s.stdout, s.stderr)
        assert not (units / f"cypherdj-wirt-arr1-{INST}.service").exists(), "arr1-Wirt läuft nach djk-stop weiter"
        assert f"stopped cypherdj-wirt-arr1-{INST}.service" in s.stdout, s.stdout
        assert not list(units.iterdir()), list(units.iterdir())
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_djk_stop_meldet_einen_uebrig_gebliebenen_arr1_wirt(tmp_path):
    # Die Schlussprüfung (REST) kennt arr1: bleibt er geladen (stop scheitert), Rückgabe 1 statt "is down, 0 units"
    env, log, units = _units_attrappen(tmp_path, geladen=[f"cypherdj-wirt-arr1-{INST}"])
    zaeh = tmp_path / "bin" / "systemctl"
    zaeh.write_text(zaeh.read_text().replace('stop) for u in "$@"; do rm -f "$U/$u"; done;;',
                                             'stop) for u in "$@"; do case "$u" in *arr1*) ;; *) rm -f "$U/$u";; esac; done;;'))
    s = subprocess.run(["bash", str(START / "djk-stop"), "--instanz", INST], env=env, capture_output=True, text=True, timeout=30)
    assert s.returncode == 1 and f"cypherdj-wirt-arr1-{INST}.service" in s.stderr, (s.returncode, s.stdout, s.stderr)
    assert "is down" not in s.stdout


def _fake_djk(tmp_path):
    djk = tmp_path / "djk"
    for p in ("kern/build/cypherdj-kern", "notbahn/build/cypherdj-notbahn"):
        (djk / p).parent.mkdir(parents=True, exist_ok=True)
        (djk / p).write_text("#!/bin/sh\nexit 0\n")
        (djk / p).chmod(0o755)
    (djk / "units").mkdir()
    for u in ("kern", "notbahn", "leitstand"):
        (djk / f"units/cypherdj-{u}.service").write_text("")
    dump = tmp_path / "pw-dump.json"
    dump.write_text("[]")
    return djk, dump


def test_djk_start_sieht_einen_liegengebliebenen_arr1_wirt_als_belegt(tmp_path):
    for geladen in ([f"cypherdj-wirt-arr1-{INST}"], []):
        t = tmp_path / ("mit" if geladen else "ohne")
        t.mkdir()
        env, log, units = _units_attrappen(t, geladen=geladen)
        (units / f"cypherdj-kern-{INST}.service").unlink()  # kein Kern der Instanz geladen
        djk, dump = _fake_djk(t)
        env = dict(env, DJK=str(djk), DJK_PW_DUMP=str(dump))
        shm = _shm()
        try:
            r = subprocess.run(["bash", str(START / "djk-start"), "--instanz", INST], env=env, capture_output=True, text=True, timeout=60)
            if geladen:
                assert r.returncode == 4, (r.returncode, r.stdout, r.stderr)
                assert f"cypherdj-wirt-arr1-{INST}.service" in r.stderr and "djk-stop" in r.stderr, r.stderr
            else:
                # Negativ-Kontrolle: ohne Rest kommt der Start an der Belegt-Prüfung vorbei (und scheitert an der
                # Attrappe von pactl beim Anlegen der stummen Senke, Rückgabe 2)
                assert r.returncode == 2 and "silent sink" in r.stderr, (r.returncode, r.stdout, r.stderr)
            assert not (log / "systemd-run").exists(), "nichts gestartet"
        finally:
            shutil.rmtree(shm, ignore_errors=True)
