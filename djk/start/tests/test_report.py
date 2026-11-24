"""report.py / djk-bericht: journalctl, systemctl and the doctor are stubs on PATH, HOME and cwd are temp folders."""
import os
import stat
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER.parent))
sys.path.insert(0, str(HIER.parent.parent))
import report as bericht  # noqa: E402

ENTRY = HIER.parent / "djk-bericht"
USER, HOST = "tina", "box7"


def skript(pfad, text):
    pfad.write_text("#!/usr/bin/env bash\n" + text)
    pfad.chmod(pfad.stat().st_mode | stat.S_IEXEC)


@pytest.fixture
def welt(tmp_path):
    home, cwd, stub = tmp_path / "home" / USER, tmp_path / "cwd", tmp_path / "stub"
    for d in (home, cwd, stub):
        d.mkdir(parents=True)
    skript(stub / "djk-doctor", f'echo "[OK] home {home} user {USER} host {HOST}"; exit 1\n')   # exit 1 = a PROBLEM line, not an error
    skript(stub / "systemctl", 'echo "cypherdj-core.service loaded active running core"\necho "cypherdj-core-d.service loaded active running test"\n')
    skript(stub / "journalctl", f'for i in $(seq 1 "${{STUB_ZEILEN:-3}}"); do echo "line $i {home}/x on {HOST} by {USER}"; done\n')
    env = {k: v for k, v in os.environ.items() if not k.startswith("CYPHERDJ_")}
    env.update(HOME=str(home), USER=USER, PATH=f"{stub}:{env['PATH']}", CYPHERDJ_BERICHT_HOST=HOST,
               CYPHERDJ_BERICHT_DOCTOR=str(stub / "djk-doctor"))
    return type("W", (), {"home": home, "cwd": cwd, "stub": stub, "env": env})


def lauf(w, *args, cwd=None, env=None):
    return subprocess.run([sys.executable, "-I", str(ENTRY), *args], cwd=cwd or w.cwd, env=env or w.env, capture_output=True, text=True, timeout=60)


def archiv(w):
    dateien = list(w.cwd.glob("cypher-dj-report-*.tar.gz"))
    assert len(dateien) == 1, dateien
    with tarfile.open(dateien[0]) as t:
        return {m.name: t.extractfile(m).read().decode() for m in t.getmembers() if m.isfile()}


def test_scrub_replaces_home_user_host():
    assert bericht.scrub("/home/tina/x on box7 by tina", "/home/tina", "tina", "box7") == "~/x on <host> by <user>"


def test_scrub_whole_words_only_and_empty_is_noop():
    assert bericht.scrub("tinas tina-x tina", "/h/t", "tina", "") == "tinas tina-x <user>"
    assert bericht.scrub("a b", "", "", "") == "a b"


def test_scrub_resolved_home(tmp_path):
    echt = tmp_path / "echt"
    echt.mkdir()
    link = tmp_path / "link"
    link.symlink_to(echt)
    assert bericht.scrub(f"{echt}/a {link}/b", str(link), "", "") == "~/a ~/b"


def test_report_contains_no_home_user_or_host(welt):
    r = lauf(welt)
    assert r.returncode == 0, r.stderr
    m = archiv(welt)
    assert any(k.startswith("journal/") and "line 1" in v for k, v in m.items())
    for name, text in m.items():
        for geheim in (str(welt.home), USER, HOST):
            assert geheim not in text, (name, geheim)
    assert "<user>" in m["doctor.txt"] and "<host>" in m["doctor.txt"]


def test_report_without_any_unit_has_note_not_error(welt):
    skript(welt.stub / "systemctl", "exit 0\n")
    r = lauf(welt)
    assert r.returncode == 0, r.stderr
    m = archiv(welt)
    assert [k for k in m if k.startswith("journal/")] == ["journal/NO-UNITS.txt"]
    assert "No cypherdj service" in m["journal/NO-UNITS.txt"]


def test_report_without_systemctl_and_journalctl_still_works(welt):
    (welt.stub / "systemctl").unlink()
    (welt.stub / "journalctl").unlink()
    env = dict(welt.env, PATH=f"{welt.stub}:/nonexistent")
    r = subprocess.run(["/usr/bin/python3", "-I", str(ENTRY)], cwd=welt.cwd, env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert "not installed" in archiv(welt)["journal/NO-UNITS.txt"]


def test_ohne_journal_leaves_journal_out_and_says_so(welt):
    r = lauf(welt, "--ohne-journal")
    assert r.returncode == 0
    assert not [k for k in archiv(welt) if k.startswith("journal")]
    assert "--ohne-journal" in r.stdout and "left out" in r.stdout


def test_project_only_with_flag(welt):
    heim = welt.home / "cypherdj" / "werke"
    (heim / "korrekturen" / "hotcues").mkdir(parents=True)
    (heim / "projekte" / "mein").mkdir(parents=True)
    (heim / "korrekturen" / "hotcues" / "offenes_projekt.json").write_text('{"v":1,"slug":"mein"}')
    (heim / "projekte" / "mein" / "project.json").write_text(f'{{"quelle":"{welt.home}/a.wav"}}')
    lauf(welt)
    assert "project.json" not in archiv(welt)
    for f in welt.cwd.glob("*.tar.gz"):
        f.unlink()
    r = lauf(welt, "--mit-projekt")
    assert r.returncode == 0, r.stderr
    assert archiv(welt)["project.json"] == '{"quelle":"~/a.wav"}'


def test_mit_projekt_without_open_project_is_a_note(welt):
    r = lauf(welt, "--mit-projekt")
    assert r.returncode == 0, r.stderr
    assert "project.json" not in archiv(welt)
    assert "No project is open" in r.stdout


def test_journal_cut_at_2000_lines(welt):
    r = lauf(welt, env=dict(welt.env, STUB_ZEILEN="5000"))
    assert r.returncode == 0
    m = archiv(welt)
    assert len(m["journal/cypherdj-core.service.txt"].splitlines()) == 2000
    assert "line 5000" in m["journal/cypherdj-core.service.txt"]


def test_instanz_picks_only_its_units(welt):
    lauf(welt, "--instanz", "d")
    assert [k for k in archiv(welt) if k.startswith("journal/")] == ["journal/cypherdj-core-d.service.txt"]


def test_prints_notice_before_writing_and_contents_after(welt):
    r = lauf(welt)
    o = r.stdout
    a, b, c = o.index("track titles"), o.index("seitenfehler.txt"), o.index("Nothing is sent")
    assert a < b < c
    assert o.index("Wrote") < b


def test_runs_from_unrelated_cwd_and_bad_flag_is_usage(welt, tmp_path):
    fremd = tmp_path / "fremd"
    fremd.mkdir()
    (fremd / "report.py").write_text("raise SystemExit('planted')")
    (welt.cwd).mkdir(exist_ok=True)
    r = lauf(welt, cwd=fremd)
    assert r.returncode == 0, r.stderr
    assert list(fremd.glob("cypher-dj-report-*.tar.gz"))
    assert lauf(welt, "--nope").returncode == 2


def test_page_errors_are_included(welt):
    ordner = welt.home / "cypherdj" / "werke" / "korrekturen" / "hotcues"
    ordner.mkdir(parents=True)
    (ordner / "seitenfehler.jsonl").write_text(f'{{"meldung":"boom {welt.home}"}}\n')
    t = archiv(welt) if lauf(welt).returncode == 0 else None
    assert "boom ~" in t["seitenfehler.txt"]


def test_scrub_url_encoded_home_and_letter_case():
    assert bericht.scrub("%2Fhome%2Ftina%2Fx file:///home/tina/a%20b", "/home/tina", "tina", "box7") == "~%2Fx file://~/a%20b"
    assert bericht.scrub("TINA at BOX7, Tina's", "/home/tina", "tina", "box7") == "<user> at <host>, <user>'s"
    assert bericht.scrub("/mnt/x/home/tina/y", "/home/tina", "tina", "") == "/mnt/x/home/<user>/y"


def test_scrub_home_with_space_url_encoded():
    assert bericht.scrub("file:///home/a%20b/c", "/home/a b", "", "") == "file://~/c"


def test_stopped_unit_with_journal_is_included(welt):
    skript(welt.stub / "systemctl", "exit 0\n")
    skript(welt.stub / "journalctl", 'if [ "$3" = "-F" ] || [ "$2" = "-F" ]; then echo cypherdj-core.service; echo other.service; else echo "old line"; fi\n')
    r = lauf(welt)
    assert r.returncode == 0, r.stderr
    m = archiv(welt)
    assert "old line" in m["journal/cypherdj-core.service.txt"]
    assert "journal/NO-UNITS.txt" not in m and not any("other" in k for k in m)
