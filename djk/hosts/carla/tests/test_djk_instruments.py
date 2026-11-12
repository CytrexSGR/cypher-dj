"""djk-instrumente mit Attrappen für systemctl und pw-link (kein Studio, keine Units): Status-Datei sagt vst3:rb338, Bundle fehlt."""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

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

def _attrappen(tmp_path, aktiv=(), aus_ports=(), ein_ports=(), status='{"bereit": true, "art": "lv2"}'):
    """systemctl (aktiv: Units ohne Suffix-Prüfung, Kern immer), pw-link (Port-Listen, Verbinden ins Log), systemd-run
    (ins Log; schreibt die Status-Datei des Wirts mit "bereit": true wie instrument_host.py). Kein Carla, keine Unit, kein JACK."""
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
        f'[ -n "$ST" ] && printf \'%s\' \'{status}\' > "$ST"\nexit 0\n')
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


# 1.9 (L10): the same for any production slot n (arr1, arr2)
def _kanten(n):
    return [f"cypherdj-kern-{INST}:arr_midi_{n}\tcypherdj-wirt-arr{n}-{INST}:events-in",
            f"cypherdj-wirt-arr{n}-{INST}:audio-out1\tcypherdj-kern-{INST}:arr_rueck_{n}_L",
            f"cypherdj-wirt-arr{n}-{INST}:audio-out2\tcypherdj-kern-{INST}:arr_rueck_{n}_R"]


def _wirt_aus(n):
    return [f"cypherdj-wirt-arr{n}-{INST}:audio-out1", f"cypherdj-wirt-arr{n}-{INST}:audio-out2"]


def _wirt_ein(n):
    return [f"cypherdj-wirt-arr{n}-{INST}:events-in"]


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
        assert r.returncode == 2 and "--arr1/--arr2 are production slots only" in r.stderr, (extra, r.returncode, r.stderr)
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


# ---------------------------------------------------------------- 1.9 T3.3: Produktions-Slot arr2 (und beide zusammen)

def test_arr2_startet_eigene_unit_und_traegt_kanten_ein_auch_ohne_kern_ports(tmp_path):
    env, log, home = _attrappen(tmp_path, aus_ports=_wirt_aus(2), ein_ports=_wirt_ein(2))
    shm = _shm()
    try:
        r = _lauf(env, "--arr2")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        aufrufe = (log / "systemd-run").read_text().splitlines()
        assert len(aufrufe) == 1, aufrufe  # nur arr2: arr1, bass und melodie bleiben unberührt
        a = aufrufe[0]
        for teil in (f"--unit=cypherdj-wirt-arr2-{INST}", f"--name cypherdj-wirt-arr2-{INST}", "--lv2 https://surge-synthesizer.github.io/lv2/surge-xt",
                     f"--status {shm}/wirt-arr2.json", f"--sock {shm}/wirt-arr2.sock",
                     f"--aktiv {home}/.config/cypherdj-{INST}/klang-arr2.fxp", "PartOf=cypherdj.target"):
            assert teil in a, (teil, a)
        assert "arr1" not in a, a
        assert (shm / "kanten").read_text().splitlines() == _kanten(2)
        assert not (log / "pw-link").exists(), "fehlende Kern-Ports: nichts verbinden, nur eintragen"
        assert "production slot 2: wirt ready" in r.stdout and "older than D1 K2b" in r.stdout and "restart the studio" in r.stdout, r.stdout
        assert "production slot 1" not in r.stdout and "live" not in r.stdout, r.stdout
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr2_eigene_wirt_ports_fehlen_nach_bereit_ist_ein_fehler(tmp_path):
    for aus, ein, fehlt in ((_wirt_aus(2), [], f"cypherdj-wirt-arr2-{INST}:events-in"), ([], _wirt_ein(2), f"cypherdj-wirt-arr2-{INST}:audio-out1")):
        t = tmp_path / fehlt.split(":")[1]
        t.mkdir()
        env, log, _ = _attrappen(t, aus_ports=aus, ein_ports=ein)
        shm = _shm()
        try:
            r = _lauf(env, "--arr2")
            assert r.returncode == 5, (fehlt, r.returncode, r.stdout, r.stderr)
            assert fehlt in r.stderr and "wirt" in r.stderr, r.stderr
            assert "live" not in r.stdout, r.stdout
        finally:
            shutil.rmtree(shm, ignore_errors=True)


def test_arr2_ist_idempotent(tmp_path):
    env, log, _ = _attrappen(tmp_path, aktiv=[f"cypherdj-wirt-arr2-{INST}"], aus_ports=_wirt_aus(2), ein_ports=_wirt_ein(2))
    shm = _shm()
    try:
        (shm / "wirt-arr2.json").write_text('{"bereit": true, "art": "lv2"}')
        (shm / "kanten").write_text("andere\tzeile\n" + _kanten(2)[0] + "\n")
        for _ in range(2):
            r = _lauf(env, "--arr2")
            assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
            assert "already running" in r.stdout, r.stdout
        assert not (log / "systemd-run").exists(), "laufender Wirt wird nicht neu gestartet"
        assert (shm / "kanten").read_text().splitlines() == ["andere\tzeile"] + _kanten(2), "keine Doppelten, Fremdes bleibt"
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr2_verbindet_sobald_die_kern_ports_da_sind(tmp_path):
    # the edge test of the mutation "arr2 edges to arr_rueck_1": the kern ports of slot 2 are linked, those of slot 1 are not touched
    env, log, _ = _attrappen(
        tmp_path, aus_ports=[f"cypherdj-kern-{INST}:arr_midi_2", *_wirt_aus(2)],
        ein_ports=[*_wirt_ein(2), f"cypherdj-kern-{INST}:arr_rueck_2_L", f"cypherdj-kern-{INST}:arr_rueck_2_R"])
    shm = _shm()
    try:
        r = _lauf(env, "--arr2")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        assert (log / "pw-link").read_text().splitlines() == _kanten(2)
        assert (shm / "kanten").read_text().splitlines() == _kanten(2)
        assert "production slot 2 live" in r.stdout and "arr_midi_2 -> Surge -> arr_rueck_2_L/R" in r.stdout, r.stdout
        assert "arr_rueck_1" not in r.stdout and "arr_rueck_1" not in (shm / "kanten").read_text()
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr1_und_arr2_zusammen_starten_beide_slots_mit_je_eigenen_kanten(tmp_path):
    env, log, _ = _attrappen(
        tmp_path, aus_ports=[f"cypherdj-kern-{INST}:arr_midi_1", f"cypherdj-kern-{INST}:arr_midi_2", *_wirt_aus(1), *_wirt_aus(2)],
        ein_ports=[*_wirt_ein(1), *_wirt_ein(2), *(f"cypherdj-kern-{INST}:arr_rueck_{n}_{k}" for n in (1, 2) for k in "LR")])
    shm = _shm()
    try:
        r = _lauf(env, "--arr1", "--arr2")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        units = [z.split("--unit=")[1].split()[0] for z in (log / "systemd-run").read_text().splitlines()]
        assert units == [f"cypherdj-wirt-arr1-{INST}", f"cypherdj-wirt-arr2-{INST}"], units
        assert (shm / "kanten").read_text().splitlines() == _kanten(1) + _kanten(2)
        assert (log / "pw-link").read_text().splitlines() == _kanten(1) + _kanten(2)
        assert "production slot 1 live" in r.stdout and "production slot 2 live" in r.stdout, r.stdout
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr1_und_arr2_melden_je_slot_ob_die_kern_ports_fehlen(tmp_path):
    # the kern has the ports of slot 1 only: slot 1 is live, slot 2 is recorded but not linked, and the message says which
    env, log, _ = _attrappen(
        tmp_path, aus_ports=[f"cypherdj-kern-{INST}:arr_midi_1", *_wirt_aus(1), *_wirt_aus(2)],
        ein_ports=[*_wirt_ein(1), *_wirt_ein(2), f"cypherdj-kern-{INST}:arr_rueck_1_L", f"cypherdj-kern-{INST}:arr_rueck_1_R"])
    shm = _shm()
    try:
        r = _lauf(env, "--arr1", "--arr2")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        assert "production slot 1 live" in r.stdout and "production slot 2: wirt ready" in r.stdout, r.stdout
        assert (log / "pw-link").read_text().splitlines() == _kanten(1), "only slot 1 is linked"
        assert (shm / "kanten").read_text().splitlines() == _kanten(1) + _kanten(2), "both are recorded"
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr2_mit_bass_oder_melodie_ist_ein_aufruffehler(tmp_path):
    env, log, _ = _attrappen(tmp_path)
    for flags in (["--arr2"], ["--arr1", "--arr2"]):
        for extra in (["--bass", "surge"], ["--melodie", "fluegel"]):
            r = _lauf(env, *flags, *extra)
            assert r.returncode == 2 and "--arr1/--arr2 are production slots only" in r.stderr, (flags, extra, r.returncode, r.stderr)
    assert not (log / "systemd-run").exists()


def test_arr2_steht_in_der_hilfe():
    r = subprocess.run(["bash", str(SKRIPT), "--help"], capture_output=True, text=True, timeout=10)
    assert r.returncode == 0 and "--arr2" in r.stdout and "cypherdj-wirt-arr2" in r.stdout, r.stdout


def test_arr3_ist_unbekannt(tmp_path):
    env, log, _ = _attrappen(tmp_path)
    r = _lauf(env, "--arr3")
    assert r.returncode == 2 and "unknown option --arr3" in r.stderr, (r.returncode, r.stderr)
    assert not (log / "systemd-run").exists()


# ---------------------------------------------------------------- Spec 6.9: djk-stop und djk-start kennen wirt-arr1

START = Path(__file__).resolve().parents[3] / "start"


def _units_attrappen(tmp_path, geladen=()):
    """systemctl mit Zustand (eine Datei je geladener Unit): is-active, list-units, stop, reset-failed, show; systemd-run
    legt die Unit an und schreibt die Status-Datei mit "bereit" wie instrument_host.py; pw-link kennt die Ports des arr1-Wirts, keine
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
    ports_aus = "\n".join(WIRT_AUS + _wirt_aus(2))   # 1.9: the ports of both production hosts
    ports_ein = "\n".join(WIRT_EIN + _wirt_ein(2))
    (bin_ / "pw-link").write_text(f"""#!/bin/sh
case "$1" in -o) printf '{ports_aus}\n';; -i) printf '{ports_ein}\n';; -l) ;; *) printf '%s\t%s\n' "$1" "$2" >> {log}/pw-link;; esac
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
    for p in ("core/build/cypherdj-kern", "fallback/build/cypherdj-notbahn"):
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


def test_djk_stop_raeumt_beide_produktions_wirte_ab(tmp_path):
    env, log, units = _units_attrappen(tmp_path)
    shm = _shm()
    try:
        r = _lauf(env, "--arr1", "--arr2")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        for n in (1, 2):
            assert (units / f"cypherdj-wirt-arr{n}-{INST}.service").exists(), f"Vorbedingung: arr{n} läuft (simuliert)"
        t = subprocess.run(["bash", str(START / "djk-stop"), "--instanz", INST, "--alles", "--trocken"], env=env,
                           capture_output=True, text=True, timeout=30)
        for n in (1, 2):
            assert f"would stop cypherdj-wirt-arr{n}-{INST}.service" in t.stdout, t.stdout
        s = subprocess.run(["bash", str(START / "djk-stop"), "--instanz", INST], env=env, capture_output=True, text=True, timeout=30)
        assert s.returncode == 0, (s.returncode, s.stdout, s.stderr)
        for n in (1, 2):
            assert f"stopped cypherdj-wirt-arr{n}-{INST}.service" in s.stdout, s.stdout
        assert not list(units.iterdir()), list(units.iterdir())
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_djk_stop_raeumt_den_arr2_wirt_allein_ab(tmp_path):
    env, log, units = _units_attrappen(tmp_path)
    shm = _shm()
    try:
        assert _lauf(env, "--arr2").returncode == 0
        assert (units / f"cypherdj-wirt-arr2-{INST}.service").exists() and not (units / f"cypherdj-wirt-arr1-{INST}.service").exists()
        s = subprocess.run(["bash", str(START / "djk-stop"), "--instanz", INST], env=env, capture_output=True, text=True, timeout=30)
        assert s.returncode == 0 and f"stopped cypherdj-wirt-arr2-{INST}.service" in s.stdout, (s.returncode, s.stdout, s.stderr)
        assert not list(units.iterdir()), list(units.iterdir())
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_djk_stop_meldet_einen_uebrig_gebliebenen_arr2_wirt(tmp_path):
    env, log, units = _units_attrappen(tmp_path, geladen=[f"cypherdj-wirt-arr2-{INST}"])
    zaeh = tmp_path / "bin" / "systemctl"
    zaeh.write_text(zaeh.read_text().replace('stop) for u in "$@"; do rm -f "$U/$u"; done;;',
                                             'stop) for u in "$@"; do case "$u" in *arr2*) ;; *) rm -f "$U/$u";; esac; done;;'))
    s = subprocess.run(["bash", str(START / "djk-stop"), "--instanz", INST], env=env, capture_output=True, text=True, timeout=30)
    assert s.returncode == 1 and f"cypherdj-wirt-arr2-{INST}.service" in s.stderr, (s.returncode, s.stdout, s.stderr)
    assert "is down" not in s.stdout


def test_djk_start_sieht_einen_liegengebliebenen_arr2_wirt_als_belegt(tmp_path):
    for geladen in ([f"cypherdj-wirt-arr2-{INST}"], []):
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
                assert f"cypherdj-wirt-arr2-{INST}.service" in r.stderr and "--arr2" in r.stderr and "djk-stop" in r.stderr, r.stderr
            else:
                assert r.returncode == 2 and "silent sink" in r.stderr, (r.returncode, r.stdout, r.stderr)
            assert not (log / "systemd-run").exists(), "nichts gestartet"
        finally:
            shutil.rmtree(shm, ignore_errors=True)


# ---------------------------------------------------------------- Baukasten S1: --melodie baukasten

def _melodie_zeile(log):
    return next(z for z in (log / "systemd-run").read_text().splitlines() if f"--unit=cypherdj-wirt-melodie-{INST}" in z)


def test_melodie_baukasten_startet_den_wirt_mit_bundle_und_graph(tmp_path):
    env, log, home = _attrappen(tmp_path, aus_ports=[f"cypherdj-kern-{INST}:midi_aus_1"])
    (home / ".local/lib/cypherdj/vst3/baukasten.vst3/Contents").mkdir(parents=True)
    graph = home / f".config/cypherdj-{INST}/baukasten-melodie.json"
    graph.parent.mkdir(parents=True)
    graph.write_text("{}")
    shm = _shm()
    try:
        r = _lauf(env, "--nur-wirte", "--melodie", "baukasten")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        z = _melodie_zeile(log)
        assert f"--vst3 {home}/.local/lib/cypherdj/vst3/baukasten.vst3" in z, z
        assert f"--setenv=CYPHERDJ_BAUKASTEN_GRAPH={graph}" in z, z
        assert "CYPHERDJ_BAUKASTEN_GRAPH" not in next(x for x in (log / "systemd-run").read_text().splitlines()
                                                   if f"--unit=cypherdj-wirt-bass-{INST}" in x), "nur die Baukasten-Gruppe"
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_melodie_baukasten_ohne_graphdatei_setzt_den_pfad_trotzdem(tmp_path):
    # Plan-Review F5: die Umgebung der Unit steht beim Anlegen fest; kommt die Datei später, muss ein Neustart sie finden
    env, log, home = _attrappen(tmp_path, aus_ports=[f"cypherdj-kern-{INST}:midi_aus_1"])
    (home / ".local/lib/cypherdj/vst3/baukasten.vst3/Contents").mkdir(parents=True)
    shm = _shm()
    try:
        r = _lauf(env, "--nur-wirte", "--melodie", "baukasten")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        z = _melodie_zeile(log)
        assert f"--setenv=CYPHERDJ_BAUKASTEN_GRAPH={home}/.config/cypherdj-{INST}/baukasten-melodie.json" in z, z
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_status_sagt_baukasten_bundle_fehlt_ist_eine_klare_meldung(tmp_path):
    # Plan-Review F11: ohne --melodie bleibt die Art aus der Status-Datei; fehlt dann das Bundle, Abbruch vor systemd-run
    env, log, _ = _attrappen(tmp_path, aus_ports=[f"cypherdj-kern-{INST}:midi_aus_1"])  # Wirt tot, Status-Datei bleibt
    shm = _shm()
    try:
        (shm / "wirt-melodie.json").write_text('{"art": "vst3:baukasten"}')
        r = _lauf(env, "--nur-wirte")
        assert r.returncode == 2 and "was baukasten (status file) but baukasten is missing" in r.stderr, (r.returncode, r.stderr)
        assert not (log / "systemd-run").exists() or "wirt-melodie" not in (log / "systemd-run").read_text()
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_melodie_baukasten_ohne_bundle_ist_ein_aufruffehler(tmp_path):
    env, log, _ = _attrappen(tmp_path, aus_ports=[f"cypherdj-kern-{INST}:midi_aus_1"])
    shm = _shm()
    try:
        r = _lauf(env, "--nur-wirte", "--melodie", "baukasten")
        assert r.returncode == 2 and "baukasten missing" in r.stderr, (r.returncode, r.stderr)
        assert not (log / "systemd-run").exists(), "kein Wirt gestartet"
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_melodie_unbekannt_nennt_baukasten(tmp_path):
    env, _, _ = _attrappen(tmp_path)
    r = _lauf(env, "--melodie", "zauber")
    assert r.returncode == 2 and "surge, fluegel or baukasten" in r.stderr, r.stderr


# 1.9 U3 (acceptance run u3-abnahme-1): the first start of instance d with --arr1 --arr2 stopped with "wirt arr2: own port ...:audio-out1 missing
# after ready" and the same start passed minutes later. Two causes can produce that and both are closed here: (1) `pw-link -o | grep -qxF` under
# pipefail dies of SIGPIPE when grep exits first (ledger D33 saw it in djk-start), (2) the port is registered a moment after "bereit".
def _alle_ports(n):
    return [*_wirt_aus(n), f"cypherdj-kern-{INST}:arr_midi_{n}"], [*_wirt_ein(n), f"cypherdj-kern-{INST}:arr_rueck_{n}_L", f"cypherdj-kern-{INST}:arr_rueck_{n}_R"]


def test_arr2_grosse_portliste_ist_kein_fehler_sigpipe(tmp_path):
    aus, ein = _alle_ports(2)
    env, log, _ = _attrappen(tmp_path, aus_ports=aus, ein_ports=ein)
    bin_ = tmp_path / "bin"
    # the wanted ports come first, then 400000 lines: grep -q leaves at the first match while pw-link is still writing (exec: the process dies of
    # SIGPIPE like the real pw-link, a shell that goes on to `exit 0` would hide it)
    (bin_ / "pw-link").write_text(
        f'#!/bin/sh\ncase "$1" in\n  -o) cat {tmp_path}/aus_ports; exec seq 1 400000;;\n  -i) cat {tmp_path}/ein_ports; exec seq 1 400000;;\n  -l) ;;\n'
        f'  *) printf "%s\\t%s\\n" "$1" "$2" >> {log}/pw-link;;\nesac\nexit 0\n')
    shm = _shm()
    try:
        for _ in range(5):
            shutil.rmtree(shm / "kanten", ignore_errors=True)
            (shm / "kanten").unlink(missing_ok=True)
            r = _lauf(env, "--arr2")
            assert r.returncode in (0,), (r.returncode, r.stdout[-300:], r.stderr[-300:])
            assert "production slot 2 live" in r.stdout, r.stdout[-300:]
            shutil.rmtree(shm / "wirt-arr2.json", ignore_errors=True)
            (shm / "wirt-arr2.json").unlink(missing_ok=True)
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr2_eigene_ports_kommen_einen_moment_nach_bereit(tmp_path):
    aus, ein = _alle_ports(2)
    env, log, _ = _attrappen(tmp_path, aus_ports=aus, ein_ports=ein)
    bin_ = tmp_path / "bin"
    zaehler = tmp_path / "zaehler"
    # the own ports show only from the 4th listing on (about a second after "bereit" in the real run)
    (bin_ / "pw-link").write_text(
        f'#!/bin/sh\ncase "$1" in\n  -o|-i) n=$(cat {zaehler} 2>/dev/null || echo 0); n=$((n+1)); echo $n > {zaehler}\n'
        f'    if [ "$n" -ge 4 ]; then if [ "$1" = -o ]; then cat {tmp_path}/aus_ports; else cat {tmp_path}/ein_ports; fi; fi;;\n  -l) ;;\n'
        f'  *) printf "%s\\t%s\\n" "$1" "$2" >> {log}/pw-link;;\nesac\nexit 0\n')
    shm = _shm()
    try:
        r = _lauf(env, "--arr2")
        assert r.returncode == 0, (r.returncode, r.stdout[-300:], r.stderr[-300:])
        assert "production slot 2 live" in r.stdout, r.stdout[-300:]
    finally:
        shutil.rmtree(shm, ignore_errors=True)


# ---------------------------------------------------------------- plan 1.11 task 16: negative control, the Surge start lines stay byte-identical

GOLDEN = Path(__file__).resolve().parent / "data" / "instrumente_surge_golden.json"


def _golden_szenarien(tmp_root, skript=SKRIPT):
    """Runs the Surge start paths against the stubs and returns everything observable (exit code, both streams, the systemd-run,
    pw-link and kanten logs) with the temp path replaced. The golden file holds this output of the script before task 16."""
    kern_arr = [f"cypherdj-kern-{INST}:arr_midi_1", f"cypherdj-kern-{INST}:arr_midi_2"]
    kern_rueck = [f"cypherdj-kern-{INST}:arr_rueck_{n}_{k}" for n in (1, 2) for k in "LR"]
    dj_aus = [f"cypherdj-kern-{INST}:midi_aus_1", f"cypherdj-kern-{INST}:midi_aus_2"]
    dj_wirt_aus = [f"cypherdj-wirt-{g}-{INST}:audio-out{k}" for g in ("bass", "melodie") for k in (1, 2)]
    dj_wirt_ein = [f"cypherdj-wirt-{g}-{INST}:events-in" for g in ("bass", "melodie")]
    dj_rueck = [f"cypherdj-kern-{INST}:rueck_erz_{n}_{k}" for n in (2, 3) for k in "LR"]
    faelle = {
        "arr1": (["--arr1"], WIRT_AUS + WIRT_EIN[:0], WIRT_EIN, True),
        "arr2": (["--arr2"], _wirt_aus(2), _wirt_ein(2), True),
        "arr1_arr2_mit_kern": (["--arr1", "--arr2"], [*kern_arr, *_wirt_aus(1), *_wirt_aus(2)], [*_wirt_ein(1), *_wirt_ein(2), *kern_rueck], True),
        "dj_nur_wirte": (["--nur-wirte"], [*dj_aus, *dj_wirt_aus], [*dj_wirt_ein, *dj_rueck], False),
    }
    ergebnis = {}
    for name, (args, aus, ein, _) in faelle.items():
        tmp = Path(tmp_root) / name
        tmp.mkdir()
        env, log, _home = _attrappen(tmp, aus_ports=aus, ein_ports=ein)
        for v in ("DISPLAY", "XAUTHORITY"):   # the golden file was made without a display; the display case has its own test below
            env.pop(v, None)
        shm = _shm()
        try:
            r = subprocess.run(["bash", str(skript), "--instanz", INST, *args], env=env, capture_output=True, text=True, timeout=30)
            text = lambda p: p.read_text() if p.exists() else None  # noqa: E731
            ergebnis[name] = {"rc": r.returncode, "stdout": r.stdout, "stderr": r.stderr, "systemd-run": text(log / "systemd-run"),
                              "pw-link": text(log / "pw-link"), "kanten": text(shm / "kanten")}
        finally:
            shutil.rmtree(shm, ignore_errors=True)
    return json.loads(json.dumps(ergebnis).replace(str(tmp_root), "<T>").replace(str(SKRIPT.parents[1]), "<DJK>"))


def test_surge_startzeilen_sind_byte_gleich_wie_vor_task_16(tmp_path):
    golden = json.loads(GOLDEN.read_text())
    ist = _golden_szenarien(tmp_path)
    assert ist == golden
    assert all(v["rc"] == 0 for v in golden.values()) and "--lv2 https://surge-synthesizer" in golden["arr2"]["systemd-run"]


# ---------------------------------------------------------------- plan 1.11 task 16: plugin instruments on the production slots

def _plugin_umgebung(tmp_path, n=2, status=None, aktiv=(), kern_ports=False, **kw):
    spec = f"vst3:{tmp_path}/home/.vst3/Synth.vst3#uid-1"
    if status is None:
        status = json.dumps({"bereit": True, "art": "plugin", "kennung": spec}).replace('"', '"')
    aus = [*(_wirt_aus(n)), *([f"cypherdj-kern-{INST}:arr_midi_{n}"] if kern_ports else [])]
    ein = [*(_wirt_ein(n)), *([f"cypherdj-kern-{INST}:arr_rueck_{n}_L", f"cypherdj-kern-{INST}:arr_rueck_{n}_R"] if kern_ports else [])]
    env, log, home = _attrappen(tmp_path, aktiv=aktiv, aus_ports=aus, ein_ports=ein, status=status, **kw)
    (home / ".vst3/Synth.vst3/Contents").mkdir(parents=True)
    env.update(DISPLAY=":7", XAUTHORITY="/tmp/xauth-test")
    return env, log, home, spec


def test_start_arr2_plugin_baut_dieselbe_unit_und_kanten_wie_surge_mit_dem_plugin_argument(tmp_path):
    env, log, home, spec = _plugin_umgebung(tmp_path, kern_ports=True)
    shm = _shm()
    try:
        r = _lauf(env, "start", "arr2", f"plugin:{spec}")
        assert r.returncode == 0, (r.returncode, r.stdout, r.stderr)
        aufrufe = (log / "systemd-run").read_text().splitlines()
        assert len(aufrufe) == 1, aufrufe
        a = aufrufe[0]
        for teil in (f"--unit=cypherdj-wirt-arr2-{INST}", f"--name cypherdj-wirt-arr2-{INST}", f"--instrument {spec}",
                     f"--status {shm}/wirt-arr2.json", f"--sock {shm}/wirt-arr2.sock", "PartOf=cypherdj.target",
                     "-p Restart=always -p RestartSec=2 -p RestartPreventExitStatus=2"):
            assert teil in a, (teil, a)
        assert "--lv2" not in a and "--aktiv" not in a, a   # not Surge's argument list
        assert (shm / "kanten").read_text().splitlines() == _kanten(2)
        assert (log / "pw-link").read_text().splitlines() == _kanten(2)
        assert "plugin" in r.stdout and "production slot 2 live" in r.stdout, r.stdout
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_plugin_host_laeuft_mit_echtem_home_display_und_xauthority(tmp_path):
    env, log, home, spec = _plugin_umgebung(tmp_path)
    shm = _shm()
    try:
        assert _lauf(env, "start", "arr2", f"plugin:{spec}").returncode == 0
        a = (log / "systemd-run").read_text()
        assert f"--setenv=HOME={home} " in a and ".local/state/cypherdj/wirt-arr2" not in a, a   # D16: real HOME, not the Surge sandbox
        assert "--setenv=DISPLAY=:7" in a and "--setenv=XAUTHORITY=/tmp/xauth-test" in a, a
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_start_arr1_plugin_schreibt_die_kanten_von_slot_1(tmp_path):
    env, log, home, spec = _plugin_umgebung(tmp_path, n=1)
    shm = _shm()
    try:
        assert _lauf(env, "start", "arr1", f"plugin:{spec}").returncode == 0
        assert (shm / "kanten").read_text().splitlines() == _kanten(1)
        assert f"--unit=cypherdj-wirt-arr1-{INST}" in (log / "systemd-run").read_text()
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_plugin_effekt_ist_exit_2_kein_instrument(tmp_path):
    status = json.dumps({"bereit": False, "fehler": ["kein_instrument"], "grund": "plugin has no MIDI input (an effect?)"})
    env, log, home, spec = _plugin_umgebung(tmp_path, status=status)
    shm = _shm()
    try:
        r = _lauf(env, "start", "arr2", f"plugin:{spec}")
        assert r.returncode == 2 and "kein_instrument" in r.stderr, (r.returncode, r.stdout, r.stderr)
        assert not (shm / "kanten").exists() or (shm / "kanten").read_text() == "", "no edges for a host that did not come up"
        assert not (log / "pw-link").exists()
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_plugin_nicht_ladbar_ist_exit_2(tmp_path):
    env, log, home, spec = _plugin_umgebung(tmp_path)
    r = _lauf(env, "start", "arr2", f"plugin:vst3:{tmp_path}/gibts-nicht.vst3#")
    assert r.returncode == 2 and "not loadable" in r.stderr and not (log / "systemd-run").exists(), (r.returncode, r.stderr)
    r = _lauf(env, "start", "arr2", "plugin:lv2:urn:gibt:es:nicht#")
    assert r.returncode == 2 and "not loadable" in r.stderr and not (log / "systemd-run").exists(), (r.returncode, r.stderr)


@pytest.mark.parametrize("args,fragment", [
    (["start", "arr2", "plugin:foo:/x#"], "format"),
    (["start", "arr2", "plugin:"], "plugin"),
    (["start", "arr2", "klingt"], "surge or plugin"),
    (["start", "bass", "surge"], "arr1 or arr2"),
    (["start", "arr3", "surge"], "arr1 or arr2"),
    (["start", "arr2"], "needs"),
    (["start", "arr2", "surge", "extra"], "unexpected"),
])
def test_start_aufruffehler(tmp_path, args, fragment):
    env, log, home, spec = _plugin_umgebung(tmp_path)
    r = _lauf(env, *args)
    assert r.returncode == 2 and fragment in r.stderr and not (log / "systemd-run").exists(), (args, r.returncode, r.stderr)


def test_start_arr2_surge_ist_wie_arr2(tmp_path):
    env, log, home, spec = _plugin_umgebung(tmp_path, status='{"bereit": true, "art": "lv2"}')
    shm = _shm()
    try:
        assert _lauf(env, "start", "arr2", "surge").returncode == 0
        assert "--lv2 https://surge-synthesizer.github.io/lv2/surge-xt" in (log / "systemd-run").read_text()
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_plugin_start_ist_idempotent_und_anderes_plugin_tauscht_nur_den_wirt(tmp_path):
    env, log, home, spec = _plugin_umgebung(tmp_path, aktiv=[f"cypherdj-wirt-arr2-{INST}"])
    shm = _shm()
    try:
        (shm / "wirt-arr2.json").write_text(json.dumps({"bereit": True, "art": "plugin", "kennung": spec}))
        r = _lauf(env, "start", "arr2", f"plugin:{spec}")
        assert r.returncode == 0 and "already running" in r.stdout and not (log / "systemd-run").exists(), (r.stdout, r.stderr)
        (home / ".vst3/Other.vst3/Contents").mkdir(parents=True)
        r = _lauf(env, "start", "arr2", f"plugin:vst3:{home}/.vst3/Other.vst3#")
        assert "stopped, switching to" in r.stdout, r.stdout
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_arr2_ohne_angabe_laesst_ein_laufendes_plugin_stehen(tmp_path):
    env, log, home, spec = _plugin_umgebung(tmp_path, aktiv=[f"cypherdj-wirt-arr2-{INST}"])
    shm = _shm()
    try:
        (shm / "wirt-arr2.json").write_text(json.dumps({"bereit": True, "art": "plugin", "kennung": spec}))
        r = _lauf(env, "--arr2")
        assert r.returncode == 0 and "already running" in r.stdout and not (log / "systemd-run").exists(), (r.stdout, r.stderr)
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_start_steht_in_der_hilfe():
    r = subprocess.run(["bash", str(SKRIPT), "--help"], capture_output=True, text=True, timeout=10)
    assert r.returncode == 0 and "start arr1|arr2" in r.stdout and "plugin:" in r.stdout and "kein_instrument" in r.stdout, r.stdout


@pytest.mark.skipif(not Path("/usr/lib/lv2/reasonablesynth.lv2").is_dir(), reason="reasonablesynth not installed")
def test_start_plugin_lv2_reasonablesynth_startet_im_neuen_modus_nicht_in_surges_steuerung(tmp_path):
    uri = "lv2:https://community.ardour.org/node/7596#"
    env, log, home, _ = _plugin_umgebung(tmp_path, status=json.dumps({"bereit": True, "art": "plugin", "kennung": uri}))
    shm = _shm()
    try:
        r = _lauf(env, "start", "arr2", f"plugin:{uri}")
        assert r.returncode == 0, (r.stdout, r.stderr)
        a = (log / "systemd-run").read_text()
        assert f"--instrument {uri}" in a and "--lv2 " not in a and "--aktiv" not in a, a
    finally:
        shutil.rmtree(shm, ignore_errors=True)


# ---------------------------------------------------------------- plan 2026-11-11 task 9: the Surge host gets the display for its own window

def test_surge_wirt_bekommt_display_und_xauthority_aber_sein_privates_home(tmp_path):
    env, log, home = _attrappen(tmp_path, aus_ports=_wirt_aus(2), ein_ports=_wirt_ein(2))
    env.update(DISPLAY=":7", XAUTHORITY="/tmp/xauth-test")
    shm = _shm()
    try:
        r = _lauf(env, "--arr2")
        assert r.returncode == 0, (r.returncode, r.stdout[-300:], r.stderr[-300:])
        a = (log / "systemd-run").read_text()
        assert "--setenv=DISPLAY=:7" in a and "--setenv=XAUTHORITY=/tmp/xauth-test" in a, a
        assert f"--setenv=HOME={home}/.local/state/cypherdj/wirt-arr2-{INST}" in a, a   # Surge keeps its sandbox HOME
    finally:
        shutil.rmtree(shm, ignore_errors=True)


def test_surge_wirt_ohne_display_in_der_umgebung_liest_ihn_aus_dem_user_manager(tmp_path):
    env, log, home = _attrappen(tmp_path, aus_ports=_wirt_aus(2), ein_ports=_wirt_ein(2))
    for v in ("DISPLAY", "XAUTHORITY"):
        env.pop(v, None)
    (tmp_path / "bin" / "systemctl").write_text(
        f'#!/bin/sh\ncase "$*" in\n  *is-active*cypherdj-kern-{INST}.service*) echo active;;\n  *is-active*) echo inactive;;\n'
        '  *show-environment*) printf "DISPLAY=:3\\nXAUTHORITY=/tmp/xa-manager\\n";;\nesac\nexit 0\n')
    shm = _shm()
    try:
        assert _lauf(env, "--arr2").returncode == 0
        a = (log / "systemd-run").read_text()
        assert "--setenv=DISPLAY=:3" in a and "--setenv=XAUTHORITY=/tmp/xa-manager" in a, a
    finally:
        shutil.rmtree(shm, ignore_errors=True)
