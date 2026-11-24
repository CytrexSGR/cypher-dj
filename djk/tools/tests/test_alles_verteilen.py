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
