"""alles_report.py: quarantine file parser, log parsers and the summary writer."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import alles_report as ab  # noqa: E402


def test_quarantine_parser_ignores_comments_and_keeps_names():
    text = "# header\n\nui-seite tests/a.test.mjs  # flaky under load\ncore test_x # why\nbad\n  # indented comment\n"
    assert ab.parse_quarantaene(text) == [("ui-seite", "tests/a.test.mjs"), ("core", "test_x")]


def test_quarantine_matches_name_or_file_of_same_suite_only():
    q = [("ui-seite", "tests/a.test.mjs")]
    assert ab.ist_quarantaene("ui-seite", ("some case", "tests/a.test.mjs"), q)
    assert not ab.ist_quarantaene("hand", ("some case", "tests/a.test.mjs"), q)


def test_split_suites_use_the_quarantine_name_of_their_base_suite():
    q = [("ui-seriell", "tests/a.test.mjs"), ("core", "test_x")]
    assert ab.ist_quarantaene("ui-seriell-c", ("case", "tests/a.test.mjs"), q)
    assert ab.ist_quarantaene("core-langsam", ("test_x",), q)
    assert ab.ist_quarantaene("core-ruhig", ("test_x",), q)
    assert ab.grundsuite("ui-ruhig") == "ui-seite" and ab.grundsuite("generator-ruhig") == "generator"
    assert not ab.ist_quarantaene("ui-seriell-i", ("case", "tests/a.test.mjs"), q)
    assert not ab.ist_quarantaene("ui-seite", ("case", "tests/a.test.mjs"), q)


def test_node_parser_tags_nested_failures_with_their_file():
    # nested lines are indented in real TAP; build them that way
    tap = "    ok 1 - case a\n    not ok 2 - case b\nnot ok 1 - tests/a.test.mjs\nok 2 - tests/b.test.mjs\n# pass 1\n# fail 1\n# skipped 0\n"
    assert ab.parse_node(tap) == (1, 1, 0, [("case b", "tests/a.test.mjs")])


def test_pytest_ctest_cargo_shell_parsers():
    assert ab.parse_pytest("FAILED t/test_a.py::test_x - boom\n2 failed, 5 passed, 1 skipped in 0.3s\n") == (
        5, 2, 1, [("t/test_a.py::test_x", "t/test_a.py")])
    ct = "1/2 Test  #1: alpha ......   Passed    0.01 sec\n2/2 Test  #2: beta .....***Failed    0.02 sec\n"
    assert ab.parse_ctest(ct) == (1, 1, 0, [("beta", "beta")])
    cg = "test a ... ok\ntest b ... FAILED\ntest result: FAILED. 3 passed; 1 failed; 2 ignored; 0 measured\n"
    assert ab.parse_cargo(cg) == (3, 1, 2, [("b", "b")])
    assert ab.parse_shell("SHELL ok a.sh\nSHELL FAIL b.sh\n") == (1, 1, 0, [("b.sh", "b.sh")])


def test_ctest_parser_counts_a_failure_with_a_wrapped_message_from_the_failed_list():
    ct = ("1/3 Test  #1: alpha ......   Passed    0.01 sec\n"
          "2/3 Test  #2: beta .....***Failed  Required regular expression not found. Regex=[HASH x\n]  8.42 sec\n"
          "3/3 Test  #3: gamma .....***Failed    0.02 sec\n\n"
          "The following tests FAILED:\n\t  2 - beta (Failed)\n\t  3 - gamma (Failed)\n\t  4 - delta (Timeout)\n")
    p, f, s, fehler = ab.parse_ctest(ct)
    assert (p, f) == (1, 3)
    assert sorted(n for n, _ in fehler) == ["beta", "delta", "gamma"]


def test_summary_table_and_gate(tmp_path):
    (tmp_path / "hand.log").write_text("    not ok 1 - c1\nnot ok 1 - tests/q.test.mjs\n# pass 4\n# fail 1\n# skipped 2\n")
    (tmp_path / "hand.meta").write_text("kind=node\nseconds=7\nexit=1\n")
    (tmp_path / "core.log").write_text("1/1 Test  #1: t ..... Passed 0.1 sec\n")
    (tmp_path / "core.meta").write_text("kind=ctest\nseconds=3\nexit=0\n")
    (tmp_path / "q.txt").write_text("hand tests/q.test.mjs  # load\n")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(tmp_path / "q.txt")]) == 0
    md = (tmp_path / "SUMMARY.md").read_text()
    assert "| hand | 4 | 1 | 2 | 7 | 1 |" in md and "| core | 1 | 0 | 0 | 3 | 0 |" in md
    assert "Quarantined failures" in md and "- c1" in md
    (tmp_path / "q.txt").write_text("")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(tmp_path / "q.txt")]) == 1
    assert "RED" in (tmp_path / "SUMMARY.md").read_text()


def test_suite_without_named_failure_but_nonzero_exit_fails_the_gate(tmp_path):
    (tmp_path / "x.log").write_text("cargo not found, suite not started\n")
    (tmp_path / "x.meta").write_text("kind=cargo\nseconds=0\nexit=127\n")
    rows, harte, quar, _last, _fl = ab.auswerten(tmp_path, [])
    assert "x" in harte and rows[0]["exit"] == 127


def test_load_skip_is_counted_as_skipped_and_the_gate_is_not_green(tmp_path):
    (tmp_path / "start-sh.log").write_text(
        "OK a\nSHELL ok test_a.sh\nSKIP load: 1-min load 9 > 4, nothing started\nSHELL skip-last test_start.sh\n"
        "integration test: needs an explicit test instance\nSHELL skip-integration test_b.sh\n")
    (tmp_path / "start-sh.meta").write_text("kind=shell\nseconds=1\nexit=0\n")
    (tmp_path / "q.txt").write_text("")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(tmp_path / "q.txt")]) == 3
    md = (tmp_path / "SUMMARY.md").read_text()
    assert "| start-sh | 1 | 0 | 2 | 1 | 0 |" in md
    assert "test_start.sh: SKIP load: 1-min load 9 > 4" in md and "NOT GREEN" in md
    assert "test_b.sh" not in md.split("Skipped for load")[1]


def test_shell_runner_reports_fail_skip_and_a_nonzero_exit(tmp_path):
    import subprocess
    d = tmp_path / "t"
    d.mkdir()
    (d / "test_a.sh").write_text("echo fine\n")
    (d / "test_b.sh").write_text("echo 'SKIP load: busy'\nexit 77\n")
    (d / "test_c.sh").write_text("echo 'integration test: needs an explicit test instance' >&2\nexit 2\n")
    runner = os.path.join(os.path.dirname(__file__), "..", "alles_shell_run.sh")
    r = subprocess.run(["bash", runner, str(d)], capture_output=True, text=True)
    assert r.returncode == 0
    assert "SHELL ok test_a.sh" in r.stdout and "SHELL skip-last test_b.sh" in r.stdout and "SHELL skip-integration test_c.sh" in r.stdout
    (d / "test_d.sh").write_text("exit 1\n")
    r = subprocess.run(["bash", runner, str(d)], capture_output=True, text=True)
    assert r.returncode == 1 and "SHELL FAIL test_d.sh" in r.stdout


def test_core_summary_names_every_failure_of_a_captured_ctest_log(tmp_path):
    """Captured from gate run 3 (core.log): ctest said "10 tests failed out of 400", the old summary showed only 2 (the quarantined timeouts)."""
    import shutil
    shutil.copy(os.path.join(os.path.dirname(__file__), "fixtures", "ctest_lauf3.txt"), tmp_path / "core.log")
    (tmp_path / "core.meta").write_text("kind=ctest\nseconds=3908\nexit=8\n")
    (tmp_path / "q.txt").write_text("core test_warp_werk_folgen\ncore test_warp_werk_folgen_dicht\n")
    rows, harte, quar, _, _fl = ab.auswerten(tmp_path, ab.parse_quarantaene((tmp_path / "q.txt").read_text()))
    assert rows[0]["failed"] == 10
    assert len(harte["core"]) == 8 and all(n.startswith("kosten_arr_hash") for n in harte["core"])
    assert sorted(quar["core"]) == ["test_warp_werk_folgen", "test_warp_werk_folgen_dicht"]
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(tmp_path / "q.txt")]) == 1
    md = (tmp_path / "SUMMARY.md").read_text()
    assert "kosten_arr_hash_spur_ohne_fifo" in md.split("## Quarantined")[0] and "| core | 3 | 10 |" in md


def test_nonzero_exit_without_named_failure_is_red_with_its_reason(tmp_path):
    (tmp_path / "x.log").write_text("something broke\n")
    (tmp_path / "x.meta").write_text("kind=ctest\nseconds=1\nexit=3\n")
    _, harte, _, _, _fl = ab.auswerten(tmp_path, [])
    assert harte["x"] == ["suite exit 3 without named failure (see x.log)"]


def test_ctest_skipped_tests_in_the_did_not_run_list_are_not_failures():
    ct = ("1/2 Test  #1: alpha ......   Passed    0.01 sec\n\nThe following tests FAILED:\n\t  2 - beta (Failed)\nErrors while running CTest\n"
          "\n100% tests passed, 0 tests failed out of 1\n\nThe following tests did not run:\n\t399 - test_latenz_verdrahtung (Skipped)\n")
    assert [n for n, _ in ab.parse_ctest(ct)[3]] == ["beta"]


def _suite(d, name, kind, ex, log):
    (d / f"{name}.log").write_text(log)
    (d / f"{name}.meta").write_text(f"kind={kind}\nseconds=1\nexit={ex}\n")


def _q(d):
    (d / "q.txt").write_text("")
    return str(d / "q.txt")


def test_a_suite_that_exited_zero_without_a_single_test_is_red(tmp_path):
    _suite(tmp_path, "x", "cargo", 0, "")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path)]) == 1
    assert "ran no test" in (tmp_path / "SUMMARY.md").read_text()


def test_a_file_whose_tests_are_all_skipped_is_not_a_zero_test_run(tmp_path):
    # measured on ui-seriell-h: 0 passed, 3 skipped, exit 0 is a legitimate result (the skip ceiling polices it, not this rule)
    _suite(tmp_path, "ui-seriell-h", "node", 0, "# pass 0\n# fail 0\n# skipped 3\n")
    (tmp_path / "d.txt").write_text("ui-seriell 3\n")
    rc = ab.main(["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path), "--skips", str(tmp_path / "d.txt")])
    assert rc == 0 and "ran no test" not in (tmp_path / "SUMMARY.md").read_text()


def test_a_suite_in_not_run_makes_the_result_red(tmp_path):
    _suite(tmp_path, "hand", "node", 0, "# pass 3\n# fail 0\n# skipped 0\n")
    rc = ab.main(["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path), "--nicht-gelaufen", "instruments: cargo not found"])
    md = (tmp_path / "SUMMARY.md").read_text()
    assert rc == 1 and "Result: RED" in md and "instruments: cargo not found" in md


def test_an_expected_suite_without_a_meta_file_is_red(tmp_path):
    _suite(tmp_path, "hand", "node", 0, "# pass 3\n# fail 0\n# skipped 0\n")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path), "--erwartet", "hand"]) == 0
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path), "--erwartet", "hand instruments"]) == 1
    assert "instruments" in (tmp_path / "SUMMARY.md").read_text().split("Failing tests")[1]


def test_the_measured_case_cargo_missing_exit_zero_empty_log_is_not_green(tmp_path):
    _suite(tmp_path, "instruments", "cargo", 0, "")
    rc = ab.main(["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path), "--nicht-gelaufen", "instruments: cargo not found"])
    assert rc == 1 and "GREEN" not in (tmp_path / "SUMMARY.md").read_text()


def test_skip_ceiling_is_per_base_suite_and_shards_count_together(tmp_path):
    _suite(tmp_path, "ui-seriell-a", "node", 0, "# pass 5\n# fail 0\n# skipped 2\n")
    _suite(tmp_path, "ui-seriell-b", "node", 0, "# pass 5\n# fail 0\n# skipped 2\n")
    (tmp_path / "decke.txt").write_text("# c\nui-seriell 4\n")
    args = ["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path), "--skips", str(tmp_path / "decke.txt")]
    assert ab.main(args) == 0
    (tmp_path / "decke.txt").write_text("ui-seriell 3\n")
    assert ab.main(args) == 1
    assert "ui-seriell" in (tmp_path / "SUMMARY.md").read_text().split("Failing tests")[1]


def test_fewer_skips_than_the_ceiling_is_green_and_noted(tmp_path):
    _suite(tmp_path, "hand", "node", 0, "# pass 5\n# fail 0\n# skipped 1\n")
    (tmp_path / "decke.txt").write_text("hand 4\n")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path), "--skips", str(tmp_path / "decke.txt")]) == 0
    assert "hand: 1 skipped, ceiling 4" in (tmp_path / "SUMMARY.md").read_text()


def test_a_suite_without_a_ceiling_line_may_not_skip(tmp_path):
    _suite(tmp_path, "hand", "node", 0, "# pass 5\n# fail 0\n# skipped 1\n")
    (tmp_path / "decke.txt").write_text("# nothing pinned\n")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", _q(tmp_path), "--skips", str(tmp_path / "decke.txt")]) == 1


def test_the_pinned_ceiling_file_parses_and_names_known_suites():
    import pathlib
    decke = ab.lies_skips((pathlib.Path(__file__).parent.parent / "skips_decke.txt").read_text())
    assert decke["ui-seite"] > 100 and decke["instruments"] > 0 and all(isinstance(v, int) for v in decke.values())


# ---- flaky retry -------------------------------------------------------------------------------------------------------------------------

def _tap_fehler(datei, name="case b"):
    return (f"    not ok 1 - {name}\n      ---\n      location: '{datei}:84:1'\n      ...\nnot ok 1 - {datei}\n# pass 3\n# fail 1\n# skipped 0\n")


def _lauf(ziel, name, kind, text, exit_code, unter=""):
    d = ziel / unter if unter else ziel
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.log").write_text(text)
    (d / f"{name}.meta").write_text(f"kind={kind}\nseconds=5\nexit={exit_code}\n")


def _plan_und_bericht(ziel):
    q = ziel / "q.txt"
    q.write_text("")
    assert ab.main(["--ziel", str(ziel), "--quarantaene", str(q), "--rerun-plan"]) == 0
    return q


def test_a_node_failure_that_passes_on_the_rerun_is_flaky_and_the_gate_is_green(tmp_path):
    _lauf(tmp_path, "hand", "node", _tap_fehler("/w/djk/hand/tests/a.test.mjs"), 1)
    q = _plan_und_bericht(tmp_path)
    assert (tmp_path / "rerun" / "plan.txt").read_text() == "hand node\n"
    assert (tmp_path / "rerun" / "betr" / "hand.txt").read_text() == "/w/djk/hand/tests/a.test.mjs\n"
    _lauf(tmp_path, "hand", "node", "ok 1 - /w/djk/hand/tests/a.test.mjs\n# pass 4\n# fail 0\n# skipped 0\n", 0, "rerun")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(q)]) == 0
    md = (tmp_path / "SUMMARY.md").read_text()
    assert "## Flaky" in md and "### hand" in md and "- case b" in md and "Result: GREEN" in md
    assert (tmp_path / "flaky.txt").read_text() == "hand\tcase b\n"
    assert "| hand | 3 | 0 | 0 | 5 | 1 |" in md   # not counted as failed any more; exit is the first round's


def test_a_unit_that_fails_on_the_rerun_too_stays_red(tmp_path):
    _lauf(tmp_path, "hand", "node", _tap_fehler("/w/djk/hand/tests/a.test.mjs"), 1)
    q = _plan_und_bericht(tmp_path)
    _lauf(tmp_path, "hand", "node", _tap_fehler("/w/djk/hand/tests/a.test.mjs"), 1, "rerun")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(q)]) == 1
    md = (tmp_path / "SUMMARY.md").read_text()
    assert "## Failing tests (gate)" in md and "- case b" in md and "RED" in md
    assert (tmp_path / "flaky.txt").read_text() == ""


def test_a_new_failure_found_by_the_rerun_is_red_not_flaky(tmp_path):
    _lauf(tmp_path, "hand", "node", _tap_fehler("/w/djk/hand/tests/a.test.mjs"), 1)
    q = _plan_und_bericht(tmp_path)
    _lauf(tmp_path, "hand", "node", _tap_fehler("/w/djk/hand/tests/a.test.mjs", "case c"), 1, "rerun")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(q)]) == 1
    assert (tmp_path / "flaky.txt").read_text() == "hand\tcase b\n"   # case b passed; the file still has case c failing
    assert "- case c" in (tmp_path / "SUMMARY.md").read_text()


def test_more_than_30_failed_units_means_no_rerun_and_red(tmp_path):
    ctest = "".join(f"{i}/40 Test  #{i}: t{i} .....***Failed    0.02 sec\n" for i in range(1, 32))
    _lauf(tmp_path, "core", "ctest", ctest, 8)
    q = _plan_und_bericht(tmp_path)
    assert (tmp_path / "rerun" / "plan.txt").read_text() == ""
    assert (tmp_path / "rerun" / "CAP").read_text().strip() == "31"
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(q)]) == 1
    md = (tmp_path / "SUMMARY.md").read_text()
    assert "no rerun" in md and "RED" in md and "- t1\n" in md


def test_exactly_30_failed_units_are_rerun(tmp_path):
    ctest = "".join(f"{i}/40 Test  #{i}: t{i} .....***Failed    0.02 sec\n" for i in range(1, 31))
    _lauf(tmp_path, "core", "ctest", ctest, 8)
    _plan_und_bericht(tmp_path)
    assert len((tmp_path / "rerun" / "core.einheiten").read_text().split()) == 30


def test_a_suite_that_crashed_or_ran_no_test_is_never_rerun_and_never_flaky(tmp_path):
    _lauf(tmp_path, "cues", "node", "boom\n", 139)                       # crash, no TAP
    _lauf(tmp_path, "loops", "node", "# pass 0\n# fail 0\n# skipped 0\n", 0)   # ran no test
    _lauf(tmp_path, "hand", "node", _tap_fehler("/w/a.test.mjs"), 1)
    q = _plan_und_bericht(tmp_path)
    assert (tmp_path / "rerun" / "plan.txt").read_text() == "hand node\n"
    # even a green "rerun" file for the crashed suite must not turn it into flaky
    _lauf(tmp_path, "cues", "node", "ok 1 - x\n# pass 1\n# fail 0\n# skipped 0\n", 0, "rerun")
    (tmp_path / "rerun" / "cues.namen").write_text("suite exit 139\n")
    _lauf(tmp_path, "hand", "node", "ok 1 - x\n# pass 4\n# fail 0\n# skipped 0\n", 0, "rerun")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(q)]) == 1
    md = (tmp_path / "SUMMARY.md").read_text()
    assert "cues" in md.split("## Flaky")[0] and "cues" not in md.split("## Flaky")[1].split("## Quarantined")[0]
    assert (tmp_path / "flaky.txt").read_text() == "hand\tcase b\n"


def test_a_rerun_that_crashes_proves_nothing_the_failure_stays(tmp_path):
    _lauf(tmp_path, "hand", "node", _tap_fehler("/w/a.test.mjs"), 1)
    q = _plan_und_bericht(tmp_path)
    _lauf(tmp_path, "hand", "node", "Segmentation fault\n", 139, "rerun")
    assert ab.main(["--ziel", str(tmp_path), "--quarantaene", str(q)]) == 1
    assert (tmp_path / "flaky.txt").read_text() == ""


def test_a_node_failure_without_a_file_is_not_rerun(tmp_path):
    _lauf(tmp_path, "hand", "node", "    not ok 1 - case b\nnot ok 1 - case b\n# pass 3\n# fail 1\n# skipped 0\n", 1)
    _plan_und_bericht(tmp_path)
    assert (tmp_path / "rerun" / "plan.txt").read_text() == ""


def test_rerun_units_per_runner(tmp_path):
    _lauf(tmp_path, "py-tools", "pytest", "FAILED t/test_a.py::test_x[1] - boom\nFAILED t/test_a.py::test_y - boom\n2 failed, 5 passed in 0.3s\n", 1)
    _lauf(tmp_path, "core", "ctest", "1/2 Test  #1: alpha ......   Passed    0.01 sec\n2/2 Test  #2: beta .....***Failed    0.02 sec\n", 8)
    cargo = ("     Running /b/x-1  [cwd=/w/instruments/a]\ntest m::ok ... ok\ntest m::bad ... FAILED\ntest result: FAILED. 1 passed; 1 failed; 0 ignored\n"
             "   Doc-tests a\ntest result: ok. 0 passed\n")
    _lauf(tmp_path, "instruments", "cargo", cargo, 101)
    _plan_und_bericht(tmp_path)
    r = tmp_path / "rerun"
    assert (r / "betr" / "py-tools.txt").read_text() == "t/test_a.py\n"
    assert (r / "core.einheiten").read_text() == "beta\n"
    assert (r / "instruments.einheiten").read_text() == "/w/instruments/a|/b/x-1|m::bad\n"


def test_a_failing_doc_test_is_not_rerun(tmp_path):
    cargo = "     Running /b/x-1  [cwd=/w/i/a]\ntest result: ok. 3 passed\n   Doc-tests a\ntest d ... FAILED\ntest result: FAILED. 0 passed; 1 failed\n"
    _lauf(tmp_path, "instruments", "cargo", cargo, 101)
    _plan_und_bericht(tmp_path)
    assert (tmp_path / "rerun" / "plan.txt").read_text() == ""


# ---- several result folders: the pool and the parallel packages of the quiet stage ------------------------------------------------------

def _ordner(tmp_path, name):
    d = tmp_path / name
    d.mkdir()
    return d


def test_the_quiet_page_packages_use_the_quarantine_name_and_skip_ceiling_of_ui_seite():
    assert ab.grundsuite("ui-ruhig-3") == "ui-seite" and ab.grundsuite("ui-ruhig") == "ui-seite" and ab.grundsuite("ui-ruhig-x") == "ui-ruhig-x"
    assert ab.ist_quarantaene("ui-ruhig-2", ("case", "tests/a.test.mjs"), [("ui-seite", "tests/a.test.mjs")])


def test_merged_folders_give_one_summary_in_the_first_folder(tmp_path):
    pool, p1, p2 = (_ordner(tmp_path, n) for n in ("pool", "ruhig-1", "ruhig-2"))
    _suite(pool, "hand", "node", 0, "# pass 3\n# fail 0\n# skipped 0\n")
    _suite(p1, "ui-ruhig-1", "node", 0, "# pass 5\n# fail 0\n# skipped 0\n")
    _suite(p2, "ui-ruhig-2", "node", 0, "# pass 7\n# fail 0\n# skipped 0\n")
    assert ab.main(["--ziel", str(pool), str(p1), str(p2), "--quarantaene", _q(tmp_path)]) == 0
    md = (pool / "SUMMARY.md").read_text()
    assert "| hand | 3 |" in md and "| ui-ruhig-1 | 5 |" in md and "| ui-ruhig-2 | 7 |" in md
    assert "Total: passed 15, failed 0, skipped 0." in md and "Result: GREEN" in md
    assert not (p1 / "SUMMARY.md").exists()


def test_a_failure_in_any_folder_is_red_and_quarantine_applies_across_folders(tmp_path):
    pool, p1 = _ordner(tmp_path, "pool"), _ordner(tmp_path, "ruhig-1")
    _suite(pool, "hand", "node", 0, "# pass 3\n# fail 0\n# skipped 0\n")
    _suite(p1, "ui-ruhig-1", "node", 1, "    not ok 1 - case b\nnot ok 1 - tests/a.test.mjs\n# pass 4\n# fail 1\n# skipped 0\n")
    args = ["--ziel", str(pool), str(p1)]
    assert ab.main(args + ["--quarantaene", _q(tmp_path)]) == 1
    assert "### ui-ruhig-1" in (pool / "SUMMARY.md").read_text()
    q = tmp_path / "q2.txt"
    q.write_text("ui-seite tests/a.test.mjs  # known\n")
    assert ab.main(args + ["--quarantaene", str(q)]) == 0
    assert "Quarantined" in (pool / "SUMMARY.md").read_text()


def test_skip_ceilings_count_over_all_folders(tmp_path):
    pool, p1, p2 = (_ordner(tmp_path, n) for n in ("pool", "ruhig-1", "ruhig-2"))
    _suite(pool, "ui-seite", "node", 0, "# pass 5\n# fail 0\n# skipped 2\n")
    _suite(p1, "ui-ruhig-1", "node", 0, "# pass 5\n# fail 0\n# skipped 1\n")
    _suite(p2, "ui-ruhig-2", "node", 0, "# pass 5\n# fail 0\n# skipped 1\n")
    (tmp_path / "decke.txt").write_text("ui-seite 4\n")
    args = ["--ziel", str(pool), str(p1), str(p2), "--quarantaene", _q(tmp_path), "--skips", str(tmp_path / "decke.txt")]
    assert ab.main(args) == 0
    (tmp_path / "decke.txt").write_text("ui-seite 3\n")   # each folder alone is under 3, together they are 4
    assert ab.main(args) == 1
    assert "ui-seite" in (pool / "SUMMARY.md").read_text().split("Failing tests")[1]


def test_load_skips_and_flaky_reruns_of_a_package_count_in_the_merged_summary(tmp_path):
    pool, p1 = _ordner(tmp_path, "pool"), _ordner(tmp_path, "ruhig-1")
    _suite(pool, "hand", "node", 0, "# pass 3\n# fail 0\n# skipped 0\n")
    _lauf(p1, "ui-ruhig-1", "node", _tap_fehler("/w/djk/ui/tests/a.test.mjs"), 1)
    q = _q(tmp_path)
    assert ab.main(["--ziel", str(p1), "--quarantaene", q, "--rerun-plan"]) == 0   # each package plans and reruns inside its own folder
    _lauf(p1, "ui-ruhig-1", "node", "ok 1 - /w/djk/ui/tests/a.test.mjs\n# pass 4\n# fail 0\n# skipped 0\n", 0, "rerun")
    assert ab.main(["--ziel", str(pool), str(p1), "--quarantaene", q]) == 0
    md = (pool / "SUMMARY.md").read_text()
    assert "### ui-ruhig-1" in md.split("## Flaky")[1] and "Result: GREEN" in md
    assert (pool / "flaky.txt").read_text() == "ui-ruhig-1\tcase b\n"
    _suite(p1, "shellsuite", "shell", 0, "SKIP load 9\nSHELL skip-last t.sh\nSHELL ok a.sh\n")
    assert ab.main(["--ziel", str(pool), str(p1), "--quarantaene", q]) == 3   # skipped for load in a package: not green


def test_a_folder_that_wrote_nothing_is_red_but_a_nothing_selected_summary_is_not(tmp_path):
    pool, p1, p2 = (_ordner(tmp_path, n) for n in ("pool", "ruhig-1", "ruhig-2"))
    _suite(pool, "hand", "node", 0, "# pass 3\n# fail 0\n# skipped 0\n")
    (p2 / "SUMMARY.md").write_text("# Test run summary\n\nResult: GREEN, nothing selected\n")
    args = ["--ziel", str(pool), str(p1), str(p2), "--quarantaene", _q(tmp_path)]
    assert ab.main(args) == 1
    assert "folder ruhig-1" in (pool / "SUMMARY.md").read_text()
    _suite(p1, "ui-ruhig-1", "node", 0, "# pass 5\n# fail 0\n# skipped 0\n")
    assert ab.main(args) == 0


def test_a_suite_expected_but_missing_from_every_folder_is_red_and_the_rerun_plan_takes_one_folder(tmp_path):
    pool, p1 = _ordner(tmp_path, "pool"), _ordner(tmp_path, "ruhig-1")
    _suite(pool, "hand", "node", 0, "# pass 3\n# fail 0\n# skipped 0\n")
    _suite(p1, "ui-ruhig-1", "node", 0, "# pass 5\n# fail 0\n# skipped 0\n")
    args = ["--ziel", str(pool), str(p1), "--quarantaene", _q(tmp_path)]
    assert ab.main(args + ["--erwartet", "hand ui-ruhig-1"]) == 0
    assert ab.main(args + ["--erwartet", "hand ui-ruhig-1 core-ruhig"]) == 1
    assert ab.main(args + ["--rerun-plan"]) == 2
