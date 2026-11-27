"""betroffen.py: which suites a change touches, and when it escalates to the whole gate."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import alles_verteilen as av  # noqa: E402
import betroffen as b  # noqa: E402

UI = os.path.join(os.path.dirname(__file__), "..", "..", "ui", "tests")


def plan(*dateien):
    return b.plane(list(dateien))


def test_cmake_header_contract_lockfile_escalate():
    for rel in ("djk/core/CMakeLists.txt", "djk/core/src/anker.h", "djk/contract/schema/x.json", "djk/instruments/Cargo.lock",
                "djk/ui/package.json", "djk/requirements.txt", "djk/tools/alles.sh", "djk/ui/tests/serial.txt"):
        g, suites, dateien, _ = plan(rel)
        assert g and not suites and not dateien, rel


def test_one_escalating_file_wins_over_others():
    g, *_ = plan("djk/hand/hand.ts", "djk/core/src/anker.h")
    assert g


def test_rust_source_selects_instruments():
    g, suites, dateien, _ = plan("djk/instruments/modular_dsp/src/lib.rs")
    assert not g and suites == {"instruments"} and not dateien


def test_core_source_selects_core():
    g, suites, _, _ = plan("djk/core/src/anchor.cpp")
    assert not g and "core" in suites


def test_start_files_select_start_sh():
    g, suites, _, _ = plan("djk/start/tests/check_digital_watch.sh")
    assert not g and suites == {"start-sh"}
    g, suites, _, _ = plan("djk/start/profiles.py")
    assert suites == {"start-sh", "py-start"}


def test_changed_node_test_runs_itself():
    g, suites, dateien, _ = plan("djk/hand/tests/audit_wait_langsam.test.mjs")
    assert not g and not suites
    assert dateien == {"hand": {"tests/audit_wait_langsam.test.mjs"}}


def test_changed_serial_page_test_goes_to_its_shard_only():
    serial = av.ohne_ruhig(av.lies_serial(f"{UI}/serial.txt"), f"{UI}/ruhig.txt")
    f = serial[0]
    verteilung = av.verteile(serial, av.lies_zeiten(f"{UI}/serial_zeiten.txt"), list("abcdefgh"), av.lies_fest(f"{UI}/serial_instanz.txt"))
    shard = next(s for s, fs in verteilung.items() if f in fs)
    g, suites, dateien, _ = plan(f"djk/ui/tests/{f}")
    assert not g and dateien == {f"ui-seriell-{shard}": {f"tests/{f}"}}


def test_changed_parallel_page_test_goes_to_ui_seite():
    serial = set(av.lies_serial(f"{UI}/serial.txt"))
    f = next(n for n in sorted(os.listdir(UI)) if n.endswith(".test.mjs") and n not in serial)
    _, _, dateien, _ = plan(f"djk/ui/tests/{f}")
    assert dateien == {"ui-seite": {f"tests/{f}"}}


def test_whole_suite_replaces_its_file_selection():
    _, suites, dateien, _ = plan("djk/core/src/anchor.cpp", "djk/core/tests/x.py")
    assert "core" in suites and "core" not in dateien


def test_docs_select_nothing():
    g, suites, dateien, nichts = plan("docs/readme.md")
    assert not g and not suites and not dateien


def test_contract_prose_does_not_escalate_but_a_contract_file_does():
    assert not plan("djk/contract/README.md")[0]
    assert plan("djk/contract/auftrag.schema.json")[0]


def test_changed_quiet_page_test_goes_to_the_quiet_stage():
    g, suites, dateien, _ = plan("djk/ui/tests/sound_live.test.mjs")
    assert not g and dateien == {"ui-ruhig": {"tests/sound_live.test.mjs"}}
    g, suites, dateien, _ = plan("djk/generator/tests/pattern_ereignisse.test.mjs")
    assert not g and dateien == {"generator-ruhig": {"tests/pattern_ereignisse.test.mjs"}}


# ---- review fix round 1: nothing runs only for proven irrelevant paths, consumers are selected, git errors are hard ----
import subprocess  # noqa: E402

import pytest  # noqa: E402
import fast as sn  # noqa: E402

REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "..")


def test_a_changed_source_that_no_test_names_escalates_instead_of_running_nothing():
    for rel in ("djk/ui/project/seq.ts", "djk/ui/public/app.js", "djk/ui/ear.ts", "djk/contract/mock_core/osc.mjs"):
        if not os.path.exists(os.path.join(REPO_ROOT, rel)):
            continue
        g, suites, dateien, nichts = plan(rel)
        assert g or suites or dateien, f"{rel}: the plan is empty ({nichts})"


def test_paths_outside_every_suite_escalate_unless_they_are_on_the_allow_list():
    for rel in ("third_party/bungee/src/x.cpp", "djk/third_party/bungee/src/x.cpp", "djk/config/kern.toml", ".github/workflows/ci.yml", ".anyhost/workflows/paket.yml", "djk/tools/ci/image/Containerfile",
                "djk/tools/ci/image/build.sh", "djk/tools/ci/im_container.sh", "djk/tools/ci/prepare.sh", "djk/tools/fast.py",
                "djk/tools/betroffen.py", "djk/tools/alles_report.py", "djk/tools/skips_decke.txt", "Makefile", "something.bin"):
        g, suites, dateien, nichts = plan(rel)
        assert g and not nichts, rel
    for rel in ("docs/zz_note_no_test_names_this.md", "zz_other_note.md", ".gitignore", "LICENSE"):
        g, suites, dateien, nichts = plan(rel)
        assert not g and not suites and not dateien and nichts == [rel], rel


def test_documentation_a_test_reads_selects_that_test_instead_of_nothing():
    g, suites, dateien, nichts = plan("docs/veroeffentlichung/public/README.md")
    gewaehlt = {f for fs in dateien.values() for f in fs}
    assert not g and not nichts and {"tests/ui_woerter.test.mjs", "tests/hand_presets.test.mjs"} <= gewaehlt


def test_core_change_selects_the_page_tests_that_start_the_render_and_the_hand_suite():
    g, suites, dateien, _ = plan("djk/core/src/clock.cpp")
    assert not g and {"core", "hand"} <= suites
    gewaehlt = {f for fs in dateien.values() for f in fs}
    grep = {os.path.relpath(p, os.path.join(UI, "..")) for p in (
        os.path.join(UI, n) for n in os.listdir(UI) if n.endswith(".test.mjs") and "cypherdj-render" in open(os.path.join(UI, n), errors="ignore").read()
        or n.endswith(".test.mjs") and "CYPHERDJ_RENDER" in open(os.path.join(UI, n), errors="ignore").read())}
    assert grep and grep <= gewaehlt, sorted(grep - gewaehlt)


def test_a_mock_core_change_selects_the_tests_of_other_packages_that_import_it():
    g, suites, dateien, _ = plan("djk/contract/mock_core/osc.mjs")
    assert not g
    gewaehlt = {f for fs in dateien.values() for f in fs}
    assert "tests/server.test.mjs" in gewaehlt   # ui/tests/server.test.mjs imports ../../contract/mock_core/osc.mjs
    assert any(k.startswith("ui-") for k in dateien)


def test_import_scan_is_transitive(tmp_path, monkeypatch):
    (tmp_path / "a.test.mjs").write_text("import { x } from './b.mjs';\n")
    (tmp_path / "b.mjs").write_text("export * from './c.ts';\n")
    (tmp_path / "c.ts").write_text("export const x = 1;\n")
    assert str(tmp_path / "c.ts") in sn.importiert_transitiv(tmp_path / "a.test.mjs")


def _repo(tmp_path):
    def g(*a):
        subprocess.run(["git", "-C", str(tmp_path), *a], check=True, capture_output=True)
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t")
    (tmp_path / "keep.txt").write_text("k\n"); (tmp_path / "gone.cpp").write_text("x\n"); (tmp_path / "old.py").write_text("y\n")
    g("add", "."); g("commit", "-qm", "base")
    return g


def test_deleted_and_renamed_files_stay_in_the_change_list(tmp_path, monkeypatch):
    g = _repo(tmp_path)
    monkeypatch.setattr(sn, "REPO", tmp_path)
    (tmp_path / "gone.cpp").unlink()
    g("mv", "old.py", "new.py")
    (tmp_path / "fresh.txt").write_text("f\n")
    assert sn.geaendert("HEAD") == ["fresh.txt", "gone.cpp", "new.py", "old.py"]


def test_unknown_ref_and_missing_merge_base_are_hard_errors(tmp_path, monkeypatch):
    _repo(tmp_path)
    monkeypatch.setattr(sn, "REPO", tmp_path)
    with pytest.raises(SystemExit) as e:
        sn.basis("origin/mian")
    assert "unknown ref" in str(e.value)
    with pytest.raises(SystemExit) as e:
        sn.basis(None)   # no origin/main in this repo
    assert "merge base" in str(e.value)
    assert sn.basis("HEAD")


def test_a_failing_git_diff_aborts(tmp_path, monkeypatch):
    _repo(tmp_path)
    monkeypatch.setattr(sn, "REPO", tmp_path)
    with pytest.raises(SystemExit):
        sn.geaendert("no-such-ref")


def test_a_deleted_gate_or_source_file_is_judged_by_its_path():
    g, *_ = plan("djk/tools/ci/prepare.sh")      # does not matter whether the file exists: the path decides
    assert g
    g, suites, *_ = plan("djk/core/src/geloescht_weg.cpp")
    assert not g and "core" in suites


def test_core_change_in_the_note_program_selects_the_page_test_that_starts_it():
    g, suites, dateien, _ = plan("djk/core/noten/src/render.cpp")
    gewaehlt = {f for fs in dateien.values() for f in fs}
    assert not g and "tests/proj_notes_real.test.mjs" in gewaehlt, sorted(gewaehlt)
