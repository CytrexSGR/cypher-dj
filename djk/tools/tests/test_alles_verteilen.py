"""alles_verteilen.py: the shards of the serial page tests."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import alles_verteilen as av  # noqa: E402

SHARDS = list("abcdefgh")
TESTS = os.path.join(os.path.dirname(__file__), "..", "..", "ui", "tests")


def echte_verteilung():
    return av.verteile(av.ohne_ruhig(av.lies_serial(f"{TESTS}/serial.txt"), f"{TESTS}/ruhig.txt"), av.lies_zeiten(f"{TESTS}/serial_zeiten.txt"), SHARDS,
                       av.lies_fest(f"{TESTS}/serial_instanz.txt"))


def test_every_serial_file_runs_in_exactly_one_shard():
    v = echte_verteilung()
    alle = [f for fs in v.values() for f in fs]
    assert sorted(alle) == sorted(set(av.ohne_ruhig(av.lies_serial(f"{TESTS}/serial.txt"), f"{TESTS}/ruhig.txt")))
    assert len(alle) == len(set(alle))


def test_every_file_of_the_serial_list_exists_and_the_pins_name_listed_files():
    serial = av.lies_serial(f"{TESTS}/serial.txt")
    assert all(os.path.exists(f"{TESTS}/{f}") for f in serial)
    for f, s in av.lies_fest(f"{TESTS}/serial_instanz.txt").items():
        assert f in serial and s in SHARDS


def test_pinned_file_goes_to_its_letter():
    v = echte_verteilung()
    assert "paths_instance2.test.mjs" in v["e"]


def test_shards_are_balanced_by_the_measured_seconds():
    z = av.lies_zeiten(f"{TESTS}/serial_zeiten.txt")
    v = echte_verteilung()
    summen = [sum(z.get(f, av.UNBEKANNT_S) for f in fs) for fs in v.values()]
    # the biggest single file bounds the longest shard; the others are within one small file of the mean
    assert max(summen) <= max(max(z.values()), sum(summen) / len(summen) + 15)


def test_distribution_is_deterministic_and_unknown_files_count_five_seconds():
    a = av.verteile(["x.mjs", "y.mjs", "z.mjs"], {"x.mjs": 100.0}, ["a", "b"])
    b = av.verteile(["z.mjs", "y.mjs", "x.mjs"], {"x.mjs": 100.0}, ["a", "b"])
    assert a == b == {"a": ["x.mjs"], "b": ["y.mjs", "z.mjs"]}


def test_quiet_files_exist_and_are_in_no_shard():
    ruhig = [z.split("#")[0].strip() for z in open(f"{TESTS}/ruhig.txt").read().splitlines() if z.split("#")[0].strip()]
    assert ruhig and all(os.path.exists(f"{TESTS}/{f}") for f in ruhig)
    im_shard = {f for fs in echte_verteilung().values() for f in fs}
    assert not (set(ruhig) & im_shard)
    gen = os.path.join(TESTS, "..", "..", "generator", "tests")
    zeilen = [z.split("#")[0].strip() for z in open(f"{gen}/ruhig.txt").read().splitlines() if z.split("#")[0].strip()]
    assert zeilen and all(os.path.exists(f"{gen}/{f}") for f in zeilen)


# ---- the quiet stage in parallel packages (alles.sh --paket) ----------------------------------------------------------------------------

def ruhig_zeiten():
    return {**av.lies_zeiten(f"{TESTS}/serial_zeiten.txt"), **av.lies_zeiten(f"{TESTS}/ruhig_zeiten.txt")}


def ruhig_pakete(m, aus=None):
    return [av.ruhig_paket(n, m, f"{TESTS}/ruhig.txt", ruhig_zeiten(), aus) for n in range(1, m + 1)]


def test_every_quiet_file_is_in_exactly_one_package_for_every_package_count():
    ruhig = {f"tests/{f}" for f in av.lies_ruhig(f"{TESTS}/ruhig.txt")}
    assert ruhig
    for m in (1, 2, 3, 4, 6):
        alle = [f for p in ruhig_pakete(m) for f in p]
        assert sorted(alle) == sorted(ruhig) and len(alle) == len(set(alle)), m


def test_quiet_packages_are_balanced_by_the_measured_seconds():
    z = ruhig_zeiten()
    for m in (2, 3, 4):
        summen = [sum(z.get(f.removeprefix("tests/"), av.UNBEKANNT_S) for f in p) for p in ruhig_pakete(m)]
        # one file (server_track_run.test.mjs, about 150 s) is longer than the rest together: it bounds the longest package, the others share the rest evenly
        assert max(summen) <= max(max(z[f] for f in av.lies_ruhig(f"{TESTS}/ruhig.txt")), sum(summen) / m + 30), (m, summen)
        rest = sorted(summen)[:-1]
        assert max(rest) - min(rest) <= 30, (m, summen)


def test_quiet_packages_are_deterministic_and_pure_in_their_input_order():
    f = ["a.mjs", "b.mjs", "c.mjs", "d.mjs", "e.mjs"]
    z = {"a.mjs": 50.0, "b.mjs": 20.0, "c.mjs": 20.0, "d.mjs": 10.0}
    x = av.ruhig_pakete(f, z, 2)
    assert x == av.ruhig_pakete(list(reversed(f)), z, 2) == [["a.mjs", "e.mjs"], ["b.mjs", "c.mjs", "d.mjs"]]   # e.mjs: 5 s unknown, tie 50/50 goes to package 1
    assert av.ruhig_pakete([], {}, 3) == [[], [], []]
    assert av.ruhig_pakete(["a.mjs"], {}, 3) == [["a.mjs"], [], []]   # fewer files than packages: the rest stay empty


def test_the_quiet_times_file_names_only_quiet_files_and_no_file_bounds_the_packages():
    ruhig = av.lies_ruhig(f"{TESTS}/ruhig.txt")
    zeiten = av.lies_zeiten(f"{TESTS}/ruhig_zeiten.txt")
    assert zeiten and set(zeiten) <= ruhig
    assert max(zeiten.values()) <= 170, max(zeiten, key=zeiten.get)   # a longer file would bound the longest package again (server.test.mjs did, 560 s)


def test_a_betroffen_selection_restricts_the_packages(tmp_path):
    aus = tmp_path / "ui-ruhig.txt"
    aus.write_text("tests/server_track_run.test.mjs\ntests/sperre.test.mjs\n")
    p = ruhig_pakete(4, str(aus))
    assert sorted(f for x in p for f in x) == ["tests/server_track_run.test.mjs", "tests/lock.test.mjs"]
    assert sum(1 for x in p if x) == 2


def test_command_line_prints_a_package_and_refuses_a_bad_one(capsys):
    assert av.main(["--ruhig-paket", "1/4"]) == 0
    assert capsys.readouterr().out.split() == ruhig_pakete(4)[0]
    assert av.main(["--ruhig-paket", "5/4"]) == 2
