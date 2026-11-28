"""Pool planning of alles.sh: start order (long suites first), the suite set, hand shares instance g with shard g."""
import re
import subprocess
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[1] / "alles.sh"
QUELLE = SKRIPT.read_text()


def liste():
    return subprocess.run(["bash", str(SKRIPT), "--liste"], capture_output=True, text=True, check=True).stdout.split()


def test_suite_set_is_unchanged():
    # the order moved; no suite may get lost or appear twice
    erwartet = set("""core ui-seriell-a ui-seriell-b ui-seriell-c ui-seriell-d ui-seriell-e ui-seriell-f ui-seriell-g ui-seriell-h instruments ui-seite py-tools
        py-workshop hand py-contract mock_core py-carla generator conductor py-bibliothek py-sound cues py-starter start-sh py-key_energy py-start loops
        py-generator py-structure_suggestion py-testbench player_cli py-ablage py-hand_bruecke py-loops py-quellen py-third_party tools-node core-ruhig
        ui-ruhig generator-ruhig""".split())
    l = liste()
    assert len(l) == len(set(l)) and set(l) == erwartet


def test_long_suites_start_before_the_page_suite_and_the_small_ones():
    l = liste()
    for lang in ("instruments", "core", "py-tools", "mock_core", "py-key_energy", "py-contract", "hand"):
        assert l.index(lang) < l.index("ui-seite") < l.index("py-workshop"), lang
    assert [l.index(f"ui-seriell-{c}") for c in "abcdefgh"] == sorted(l.index(f"ui-seriell-{c}") for c in "abcdefgh")
    assert l[-3:] == ["core-ruhig", "ui-ruhig", "generator-ruhig"]   # the quiet stage keeps its order


def test_weights_follow_the_load():
    m = re.search(r"gewicht\(\) \{(.*?)\n\}", QUELLE, re.S).group(1)
    assert 'core|core-langsam|core-ruhig) echo "$CORE_W"' in m and 'ui-seite) echo "$UI_W"' in m and "instruments) echo 8" in m and "*) echo 1" in m
    assert "CORE_W=${CORE_W:-$CORE_J}" in QUELLE and "UI_W=${UI_W:-$TEST_J}" in QUELLE   # lighter weights slowed the pool (CI 5178)


def test_hand_shares_instance_g_with_shard_g_and_leaves_i_free():
    # i stays free in the pool: py-carla takes the first free letter, and with shards a..h plus hand on i it found none (CI 5148, 52 skips)
    hand = re.search(r"^\s*hand\) echo \"node\|(.*)\" ;;$", QUELLE, re.M).group(1)
    assert "CYPHERDJ_TEST_INSTANZ=g " in hand
    assert ".inst-g.lock" in QUELLE
    # no shard uses i: the shards are a..h
    assert re.search(r'UI_SHARDS="(ui-seriell-[a-h] ?){8}"', QUELLE)
