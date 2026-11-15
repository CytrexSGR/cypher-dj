"""Tests for the ABBA lane driver (pure parts only, no subprocess)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import cost_lane as kosten_lane  # noqa: E402


def test_parse_reads_hash_and_json_line():
    text = ("HASH lane=arr32rack pm=ok out=ok blocks=100 spur_rack_worker=7 spur_warte_max_us=12\n"
            '{"lage":"arr32rack","zyklen":100,"median_us":371.1,"p99_us":800.0,'
            '"p999_us":1000.5,"max_us":1500.0}\n')
    r = kosten_lane.parse(text)
    assert r["blocks"] == 100
    assert r["spur_rack_worker"] == 7
    assert r["p999_us"] == 1000.5
    assert r["max_us"] == 1500.0


def test_parse_empty_output_is_empty_dict():
    assert kosten_lane.parse("") == {}


def test_arm_env_block_256():
    e = kosten_lane.arm_env(256, {}, {"KOSTEN_SPUR_POOL": "1"})
    assert e["KOSTEN_PACE_US"] == "5333"
    assert e["KOSTEN_HALL_FAEDEN"] == "3"
    assert e["KOSTEN_HALL_CPUS"] == "5,6,7"
    assert e["KOSTEN_ARR_PRIO"] == "70"
    assert e["KOSTEN_HASH"] == "1"
    assert e["KOSTEN_SPUR_POOL"] == "1"


def test_arm_env_block_128_and_unpaced_block():
    assert kosten_lane.arm_env(128, {}, {})["KOSTEN_PACE_US"] == "2667"
    with pytest.raises(KeyError):
        kosten_lane.arm_env(512, {}, {})


def test_lock_paths():
    assert kosten_lane.LOCK1 == (os.environ.get("CYPHERDJ_TIMING_LOCK") or f"/tmp/claude-{os.getuid()}/cypher-echtzeit.lock")
    assert kosten_lane.LOCK2.endswith("djk/config/.echtzeit.lock")
