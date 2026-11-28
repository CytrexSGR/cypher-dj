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
    for rel in ("djk/previewer/CMakeLists.txt", "djk/contract/schema/x.json", "djk/instruments/Cargo.lock",
                "djk/ui/package.json", "djk/requirements.txt", "djk/tools/alles.sh", "djk/ui/tests/serial.txt"):
        g, suites, dateien, _ = plan(rel)
        assert g and not suites and not dateien, rel


def test_one_escalating_file_wins_over_others():
    g, *_ = plan("djk/hand/hand.ts", "djk/tools/alles.sh")
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
    assert plan("djk/contract/zz_unbekannt.xyz")[0]   # no row of VERTRAG names it


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
    assert "tests/server_routes_inventory.test.mjs" in gewaehlt   # ui/tests/server_routes_inventory.test.mjs imports ../../contract/mock_core/osc.mjs
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


def _zeilen(tabelle):
    return lambda rel: tabelle.get(rel, [])


def test_an_added_serial_entry_runs_only_the_named_file_in_its_shard():
    serial = av.ohne_ruhig(av.lies_serial(f"{UI}/serial.txt"), f"{UI}/ruhig.txt")
    f = serial[-1]
    g, suites, dateien, _ = b.plane(["djk/ui/tests/serial.txt"], zeilen_fn=_zeilen({"djk/ui/tests/serial.txt": [f]}))
    assert not g and not suites
    assert [s for s in dateien if s.startswith("ui-seriell-")] and all(fs == {f"tests/{f}"} for fs in dateien.values()), dateien


def test_a_comment_change_in_a_test_list_runs_nothing():
    for rel in ("djk/ui/tests/serial.txt", "djk/ui/tests/ruhig.txt", "djk/generator/tests/ruhig.txt"):
        g, suites, dateien, _ = b.plane([rel], zeilen_fn=_zeilen({rel: ["# new explanation", ""]}))
        assert not g and not suites and not dateien, rel


def test_timing_and_pin_lists_name_the_file_in_their_second_field():
    serial = av.lies_serial(f"{UI}/serial.txt")
    f = serial[0]
    for rel, zeile in (("djk/ui/tests/serial_zeiten.txt", f"12.5 {f}"), ("djk/ui/tests/serial_instanz.txt", f"c {f}  # reason")):
        g, _, dateien, _ = b.plane([rel], zeilen_fn=_zeilen({rel: [zeile]}))
        assert not g and any(f"tests/{f}" in fs for fs in dateien.values()), rel


def test_a_removed_entry_of_a_deleted_file_names_nothing():
    rel = "djk/ui/tests/serial.txt"
    g, suites, dateien, _ = b.plane([rel], zeilen_fn=_zeilen({rel: ["gibt_es_nicht_mehr.test.mjs"]}))
    assert not g and not suites and not dateien


def test_an_unreadable_test_list_line_still_escalates():
    rel = "djk/ui/tests/serial.txt"
    for zeile in ("*.test.mjs", "some words here", "../ausbruch.test.mjs"):
        g, *_ = b.plane([rel], zeilen_fn=_zeilen({rel: [zeile]}))
        assert g, zeile


def test_the_gate_scripts_escalate_even_with_line_reading():
    for rel in ("djk/tools/alles.sh", "djk/tools/betroffen.py", "djk/tools/quarantaene.txt"):
        g, *_ = b.plane([rel], zeilen_fn=_zeilen({rel: ["x.test.mjs"]}))
        assert g, rel


# ---- step 7 of the CI plan: CMake and header of the core and the contract files no longer select the whole gate ----
def gewaehlt(dateien):
    return {f for fs in dateien.values() for f in fs}


def test_core_cmake_and_cmake_module_select_the_core_suites_and_the_programs_tests_not_the_whole_gate():
    for rel in ("djk/core/CMakeLists.txt", "djk/core/noten/CMakeLists.txt", "djk/core/tests/cost/hash_pruefen.cmake"):
        g, suites, dateien, _ = plan(rel)
        assert not g and {"core", "hand", "mock_core"} <= suites, rel
        # a page test that starts the real cypherdj-kern (not only the render) is in: the build of every program changed
        assert "tests/prelisten.test.mjs" in gewaehlt(dateien), rel
        assert "tests/proj_notes_real.test.mjs" in gewaehlt(dateien), rel


def test_cmake_outside_the_core_and_third_party_still_escalate():
    for rel in ("djk/previewer/CMakeLists.txt", "djk/testbench/CMakeLists.txt", "third_party/x/CMakeLists.txt", "djk/third_party/y/z.cmake"):
        assert plan(rel)[0], rel


def test_core_header_selects_the_core_suites_and_the_code_outside_the_core_that_names_it():
    g, suites, dateien, _ = plan("djk/core/include/cypherdj/arr_pdc.h")
    assert not g and {"core", "hand", "mock_core"} <= suites
    # djk/starter/tests/test_demo_build.py names arr_pdc.h, djk/ui/public/production/pdc.js too (a source: the tests that name it run)
    assert "tests/test_demo_build.py" in dateien.get("py-starter", set())
    g, suites, dateien, _ = plan("djk/core/signalbox/include/cypherdj/signalbox/controls.h")
    assert not g and "core" in suites
    assert "tests/production_device_view.test.mjs" in gewaehlt(dateien)      # names controls.h


def test_a_header_nobody_outside_the_core_names_selects_only_the_core_side():
    g, suites, dateien, _ = plan("djk/core/include/cypherdj/zz_kein_leser_ausserhalb.h")
    assert not g and {"core", "hand", "mock_core"} <= suites


def test_the_gate_and_lockfiles_still_escalate_next_to_a_core_header():
    for rel in ("djk/tools/alles.sh", "djk/tools/ci/prepare.sh", ".anyhost/workflows/ci.yml", "djk/hand/package-lock.json", "djk/tools/betroffen.py"):
        g, *_ = plan("djk/core/include/cypherdj/arr_pdc.h", rel)
        assert g, rel


def test_contract_table_rows_match_the_files_they_name():
    assert b.vertrag_zeile("djk/contract/osc.json")[0] == {"py-contract", "mock_core"}
    assert b.vertrag_zeile("djk/contract/schemas/defs.schema.json")[0] == {"py-contract"}
    assert b.vertrag_zeile("djk/contract/cases/noten/gruende.json")[2] == ["cases/noten"]
    assert b.vertrag_zeile("djk/contract/cases/arr_ki_stopp.json")[0] == {"py-contract", "mock_core"}
    assert b.vertrag_zeile("docs/interfaces/insert_module.json")[1][0].endswith("insert_zeilen.inc")
    assert b.vertrag_zeile("djk/contract/unbekannt.xyz") is None
    assert not b.vertrag_datei("djk/contract/tests/test_osc.py") and not b.vertrag_datei("djk/contract/mock_core/arr.mjs")
    assert not b.vertrag_datei("djk/contract/notes.md") and b.vertrag_datei("docs/interfaces/lesbare_namen.json")


def test_every_contract_file_in_the_repo_is_known_or_escalates_by_name():
    # a file of the contract folders that no row names must be a reason to escalate (never silently nothing)
    for rel in b.schnell.git("ls-files", "--", "djk/contract", "docs/interfaces").split():
        if b.vertrag_datei(rel) and b.vertrag_zeile(rel) is None and os.path.basename(rel) not in b.LOCK_NAMEN:
            assert b.eskalation(rel), rel


def test_osc_json_selects_py_contract_mock_core_core_and_the_readers_by_name():
    g, suites, dateien, _ = plan("djk/contract/osc.json")
    assert not g and {"py-contract", "mock_core", "core", "hand"} <= suites
    assert "py-contract" not in dateien and "mock_core" not in dateien       # run whole instead
    assert any(k.startswith("ui-") for k in dateien) and "conductor" in dateien


def test_a_schema_selects_py_contract_and_its_named_readers_but_not_instruments():
    g, suites, dateien, _ = plan("djk/contract/schemas/defs.schema.json")
    # defs.schema.json is also read by name by the names checker, so core (its ctest) comes with py-contract
    assert not g and suites == {"py-contract", "core"}
    assert "instruments" not in dateien and "hand" not in suites
    g, suites, _, _ = plan("djk/contract/schemas/auftrag.schema.json")
    assert not g and suites == {"py-contract"}


def test_the_noten_cases_select_py_contract_and_core_because_ctest_reads_the_folder():
    g, suites, _, _ = plan("djk/contract/cases/noten/gruende.json")
    assert not g and {"py-contract", "core"} <= suites


def test_insert_module_json_selects_what_the_generator_writes_and_its_readers():
    g, suites, dateien, _ = plan("docs/interfaces/insert_module.json")
    assert not g and {"py-contract", "mock_core", "core", "hand"} <= suites
    # generated djk/conductor/src/insert_controls.ts: the conductor tests that name or import it run
    assert "conductor" in dateien


def test_a_generator_script_selects_its_outputs_readers_too():
    g, suites, _, _ = plan("djk/contract/generate_insert.py")
    assert not g and {"py-contract", "mock_core", "core"} <= suites


def test_data_only_contract_files_select_py_contract_and_nothing_wider():
    g, suites, dateien, _ = plan("djk/contract/demos/zuordnung.json")
    assert not g and suites == {"py-contract"} and "core" not in dateien


def test_an_unknown_contract_file_and_an_unknown_interface_file_escalate():
    assert plan("djk/contract/unbekannt.xyz")[0]
    assert plan("docs/interfaces/neu_ohne_zeile.yaml")[0]


def test_a_python_test_that_names_a_page_source_importing_a_generated_file_runs():
    # insert_module.json -> generated ui/project/insert_key.ts <- imported by ui/project/model.ts <- named by starter/tests/test_demo.py
    g, _, dateien, _ = plan("docs/interfaces/insert_module.json")
    assert not g and "tests/test_demo.py" in dateien.get("py-starter", set())


def test_a_core_pin_list_selects_the_python_test_that_reads_it_by_name():
    g, suites, dateien, _ = plan("djk/core/tests/cost/hash_pins.txt", "djk/core/CMakeLists.txt")
    assert not g and "core" in suites
    assert "tests/test_cost_pins.py" in dateien.get("py-tools", set())


def test_the_data_files_of_the_contract_escalate_when_the_gate_changes_with_them():
    g, *_ = plan("djk/contract/osc.json", "djk/tools/alles_cargo.sh")
    assert g


def test_sources_read_by_name_by_the_names_checker_select_core_and_py_contract():
    # djk/ui/server.ts and the hand mapping header are read by name (q.lies) by check_name_lists.py, with no import edge to it
    for rel in ("djk/ui/server.ts", "djk/core/hand/src/names.cpp", "docs/architecture/INTERFACES.md", "djk/ui/public/curves.js"):
        g, suites, _, _ = plan(rel)
        assert g == [] and {"core", "py-contract"} <= suites, rel


def test_the_names_checker_list_is_derived_from_its_string_literals_and_covers_glob_folders():
    quellen = b.namenslisten_quellen()
    assert "djk/ui/server.ts" in quellen and "djk/contract/mock_core/contract.mjs" in quellen   # q.lies and file://@@/ import
    assert any(q == "djk/config/controller" for q in quellen)                                  # a folder read by a glob
    assert b.namenslisten_quelle("djk/config/controller/softcontroller.json")                  # anything below a folder counts
    assert not b.namenslisten_quelle("djk/ui/public/other_unread_file.js")


def test_a_new_source_literal_in_the_names_checker_counts_without_a_table_edit(tmp_path, monkeypatch):
    (tmp_path / "djk/contract").mkdir(parents=True)
    (tmp_path / "djk/contract/check_name_lists.py").write_text('x = q.lies("djk/ui/neu_quelle.ts")\ny = "not a path"\n')
    monkeypatch.setattr(b, "REPO", tmp_path)
    b._namenslisten_cache.clear()
    assert b.namenslisten_quelle("djk/ui/neu_quelle.ts") and not b.namenslisten_quelle("djk/ui/server.ts")
    b._namenslisten_cache.clear()
