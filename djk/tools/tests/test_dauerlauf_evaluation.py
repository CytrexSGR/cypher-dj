"""Verdict logic of the soak run (R3): synthetic minute rows, strict readings."""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import dauerlauf_evaluation as A  # noqa: E402

SKRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dauerlauf_evaluation.py")
UNITS = ("kern", "server")


def zeile(t, phase, rss=100_000, **kw):
    z = {"t_min": t, "phase": phase,
         "rss_kib": {u: rss for u in UNITS}, "fds": {u: 20 for u in UNITS},
         "luecken_frames_delta": 0, "luecke_ereignisse": 0, "luecke_frames": 0,
         "cb_max_us": 500, "cb_p99_us_max": 300,
         "neustarts": {u: 0 for u in UNITS}, "generation": 1,
         "treiber_fehler": 0, "treiber_aufrufe": 64, "zustand_n": 25,
         "treiber_endpunkte": {"regler": [60, 0], "deck_start": [2, 0], "strudel": [2, 0]},
         "treiber_lebt": True, "pegel_master_db": -20.0}
    z.update(kw)
    return z


def lauf(leerlauf=30, last=60, rss_ref=100_000, rss_ende=100_000, ende=5, aendere=None):
    """leerlauf idle rows, then last load rows; reference window at rss_ref, last `ende` rows at rss_ende."""
    zs = [zeile(t, "leerlauf") for t in range(leerlauf)]
    for i in range(last):
        rss = rss_ende if i >= last - ende else rss_ref
        zs.append(zeile(leerlauf + i, "last", rss=rss))
    if aendere:
        aendere(zs)
    return zs


def ausw(zs, **kw):
    """auswerten with the planned load equal to the rows present (so only the case under test decides)."""
    kw.setdefault("last_min", sum(1 for z in zs if z.get("phase") == "last"))
    return A.auswerten(zs, **kw)


def test_growth_4_9_percent_passes_6_percent_fails():
    ok = ausw(lauf(rss_ende=104_900))
    assert ok["bestanden"] is True and ok["speicher"]["kern"]["ok"] is True
    assert 4.8 < ok["speicher"]["kern"]["wachstum_prozent"] < 5.0
    schlecht = ausw(lauf(rss_ende=106_000))
    assert schlecht["bestanden"] is False and schlecht["speicher"]["kern"]["ok"] is False
    # exactly 5 % is not "under 5 %"
    assert ausw(lauf(rss_ende=105_000))["bestanden"] is False


def test_growth_is_judged_per_unit_not_by_sum():
    def a(zs):
        for z in zs[-5:]:
            z["rss_kib"]["server"] = 200_000   # one unit doubles, the other stays
    r = ausw(lauf(aendere=a))
    assert r["speicher"]["kern"]["ok"] and not r["speicher"]["server"]["ok"] and r["bestanden"] is False


def test_reference_is_median_so_one_spike_does_not_fool_it():
    def a(zs):
        zs[30 + 27]["rss_kib"]["kern"] = 300_000   # spike inside the reference window
    r = ausw(lauf(aendere=a))
    assert r["speicher"]["kern"]["bezug_kib"] == 100_000


def test_end_window_is_exactly_the_last_five_rows():
    """Kills M2 (end window shifted by one): a ramp makes every shift change the median."""
    def a(zs):
        # last five load rows 103..107 MiB-ish, the row before 102: median of the true window is 105_000 (5 %),
        # a window shifted back by one would read 104_000 and pass
        for z, v in zip(zs[-6:], (102_000, 103_000, 104_000, 105_000, 106_000, 107_000)):
            z["rss_kib"]["kern"] = v
    r = ausw(lauf(aendere=a))
    assert r["speicher"]["kern"]["ende_kib"] == 105_000
    assert r["speicher"]["kern"]["ok"] is False and r["bestanden"] is False


def test_reference_window_is_exactly_load_minutes_25_to_30():
    """Kills M3 (reference window shifted by one): ramp over the load rows, exact median expected."""
    def a(zs):
        for i in range(24, 33):
            zs[30 + i]["rss_kib"]["kern"] = 100_000 + (i - 24) * 1_000
    r = ausw(lauf(aendere=a))
    # window rows 25..29 hold 101_000..105_000, median 103_000
    assert r["speicher"]["kern"]["bezug_kib"] == 103_000


def test_one_gap_in_load_with_zero_baseline_fails():
    def a(zs):
        zs[45]["luecke_ereignisse"] = 1
        zs[45]["luecken_frames_delta"] = 64
        zs[45]["luecke_frames"] = 64
    r = ausw(lauf(aendere=a))
    assert r["luecken"]["ok"] is False and r["bestanden"] is False


def test_gap_in_frames_alone_fails_even_without_event():
    def a(zs):
        zs[50]["luecken_frames_delta"] = 3   # core counter moved, no /e/luecke seen
    assert ausw(lauf(aendere=a))["luecken"]["ok"] is False


def test_gap_equal_to_baseline_passes():
    def a(zs):
        for i in (3, 40):
            zs[i]["luecke_ereignisse"] = 2
            zs[i]["luecken_frames_delta"] = 8
            zs[i]["luecke_frames"] = 8
    r = ausw(lauf(aendere=a))
    # baseline: 2 events in minute 3 of 30 idle minutes scaled to an hour = 4; load block (60 min) holds 2
    assert r["luecken"]["grundlinie_pro_stunde"] == {"ereignisse": 4.0, "frames": 16.0, "ereignis_frames": 16.0}
    assert r["luecken"]["ok"] is True


def test_every_hour_block_is_judged_separately():
    def a(zs):
        zs[30 + 130]["luecke_ereignisse"] = 1   # hour 3 of a 4 hour load
    r = ausw(lauf(last=240, aendere=a))
    assert len(r["luecken"]["last_pro_stunde"]) == 4
    assert r["luecken"]["ok"] is False


def test_remainder_minutes_are_not_dropped():
    def a(zs):
        zs[-1]["luecke_ereignisse"] = 1   # last minute of a 65 minute load
    r = ausw(lauf(last=65, aendere=a))
    assert len(r["luecken"]["last_pro_stunde"]) == 1
    assert r["luecken"]["ok"] is False


def test_one_restart_counter_bump_fails():
    def a(zs):
        for z in zs[50:]:
            z["neustarts"]["server"] = 1
    r = ausw(lauf(aendere=a))
    assert r["neustarts"]["ok"] is False and "server" in r["neustarts"]["einheiten"] and r["bestanden"] is False


def test_restart_bump_in_a_single_middle_row_fails():
    """Kills M6 (only the last row is compared): the counter differs in one middle row only."""
    def a(zs):
        zs[55]["neustarts"]["server"] = 1
    r = ausw(lauf(aendere=a))
    assert r["neustarts"]["ok"] is False and r["neustarts"]["einheiten"] == ["server"] and r["bestanden"] is False


def test_restart_bump_in_idle_phase_fails_too():
    def a(zs):
        for z in zs[5:]:
            z["neustarts"]["kern"] = 1
    assert ausw(lauf(aendere=a))["neustarts"]["ok"] is False


def test_generation_change_fails():
    def a(zs):
        for z in zs[40:]:
            z["generation"] = 2
    r = ausw(lauf(aendere=a))
    assert r["neustarts"]["ok"] is False and r["bestanden"] is False


def test_generation_change_and_back_still_fails():
    def a(zs):
        zs[40]["generation"] = 2
    assert ausw(lauf(aendere=a))["neustarts"]["ok"] is False


def test_missing_reference_window_is_unusable_not_pass():
    r = ausw(lauf(last=20))   # load ends before minute 25
    assert r["bestanden"] is False and r["unbrauchbar"]


def test_no_load_rows_or_no_idle_rows_is_unusable():
    assert ausw(lauf(last=0))["unbrauchbar"]
    assert ausw([z for z in lauf() if z["phase"] == "last"])["unbrauchbar"]


def test_short_idle_phase_is_unusable():
    assert ausw(lauf(leerlauf=20))["unbrauchbar"]   # 30 expected


def test_unknown_phase_label_is_unusable():
    def a(zs):
        zs[10]["phase"] = "warmup"
    assert ausw(lauf(aendere=a))["unbrauchbar"]


def test_unit_disappearing_fails():
    def a(zs):
        del zs[-3]["rss_kib"]["server"]
        del zs[-3]["fds"]["server"]
        del zs[-3]["neustarts"]["server"]
    r = ausw(lauf(aendere=a))
    assert r["bestanden"] is False and any("disappeared" in f for f in r["fails"])


def test_unit_sets_that_differ_inside_a_row_are_unusable():
    def a(zs):
        del zs[-3]["rss_kib"]["server"]
    assert ausw(lauf(aendere=a))["unbrauchbar"]


def test_zero_reference_memory_is_unusable():
    assert ausw(lauf(rss_ref=0, rss_ende=10))["unbrauchbar"]


def test_minute_hole_is_unusable():
    def a(zs):
        del zs[70]
    assert ausw(lauf(aendere=a))["unbrauchbar"]


def test_missing_key_is_unusable():
    def a(zs):
        del zs[12]["cb_max_us"]
    assert ausw(lauf(aendere=a))["unbrauchbar"]


def test_aborted_run_is_never_passed():
    """35 of 240 planned load minutes (SIGTERM): rows exist, the verdict is 'aborted', exit 2."""
    r = A.auswerten(lauf(last=35), last_min=240)
    assert r["bestanden"] is False and str(r["unbrauchbar"]).startswith("aborted")
    assert "35 of 240" in r["unbrauchbar"]
    assert "ABORTED" in A.markdown(r) and A.exit_code(r) == 2


def test_aborted_run_with_a_restart_is_a_fail_not_aborted():
    def a(zs):
        zs[50]["neustarts"]["kern"] = 1
    r = A.auswerten(lauf(last=35, aendere=a), last_min=240)
    assert r["fails"] and A.exit_code(r) == 1


def test_unusable_does_not_hide_a_simultaneous_restart_fail():
    def a(zs):
        del zs[70]                      # minute hole: unusable
        zs[55]["neustarts"]["server"] = 1   # and a restart
    r = ausw(lauf(aendere=a))
    assert r["bestanden"] is False and r["unbrauchbar"] is None and r["fails"]
    assert A.exit_code(r) == 1 and "FAILED" in A.markdown(r)
    assert "minute hole" in " ".join(r["hinweise"])


def test_unit_appearing_later_is_measured_from_its_first_minute_and_reported():
    def a(zs):
        for z in zs[45:]:               # instrument host starts in load minute 15; rows before 45 lack it
            z["rss_kib"]["wirt"] = 50_000
            z["fds"]["wirt"] = 10
            z["neustarts"]["wirt"] = 0
    r = ausw(lauf(aendere=a))
    assert r["neue_einheiten"] == [{"einheit": "wirt", "t_min": 45}]
    assert r["speicher"]["wirt"]["spaeter_gestartet"] is True and r["speicher"]["wirt"]["wachstum_prozent"] == 0
    assert r["bestanden"] is True
    assert "wirt (minute 45)" in A.markdown(r)


def test_late_unit_that_grows_fails():
    def a(zs):
        for i, z in enumerate(zs[45:]):
            z["rss_kib"]["wirt"] = 50_000
            z["fds"]["wirt"] = 10
            z["neustarts"]["wirt"] = 0
        for z in zs[-5:]:
            z["rss_kib"]["wirt"] = 60_000
        for z in zs[:45]:
            for k in ("rss_kib", "fds", "neustarts"):
                z[k].pop("wirt", None)
    r = ausw(lauf(aendere=a))
    assert r["speicher"]["wirt"]["ok"] is False and r["bestanden"] is False


def test_late_unit_restart_counter_change_fails():
    def a(zs):
        for z in zs[45:]:
            z["rss_kib"]["wirt"] = 50_000
            z["fds"]["wirt"] = 10
            z["neustarts"]["wirt"] = 0
        zs[60]["neustarts"]["wirt"] = 1
    r = ausw(lauf(aendere=a))
    assert r["neustarts"]["ok"] is False and "wirt" in r["neustarts"]["einheiten"]


def test_driver_endpoint_below_expected_count_in_one_minute_fails():
    def a(zs):
        zs[60]["treiber_endpunkte"]["deck_start"] = [0, 0]   # no deck launch in that minute
    r = ausw(lauf(aendere=a))
    assert r["treiber"]["ok"] is False and r["bestanden"] is False
    assert r["treiber"]["endpunkte"]["deck_start"]["minuten_darunter"] == [60]
    assert any("deck_start" in f for f in r["fails"])


def test_knob_below_one_hertz_fails():
    def a(zs):
        for z in zs[30:]:
            z["treiber_endpunkte"]["regler"] = [30, 0]   # the 0.54 Hz case of the first dry run
    assert ausw(lauf(aendere=a))["bestanden"] is False


def test_every_deck_start_failing_fails_although_global_rate_is_low():
    def a(zs):
        for z in zs[30:]:
            z["treiber_endpunkte"]["deck_start"] = [2, 2]   # 2 of 64 calls = 3 %, but all launches fail
    r = ausw(lauf(aendere=a))
    assert r["treiber"]["ok"] is False and r["bestanden"] is False


def test_endpoint_error_rate_is_judged_per_endpoint_at_5_percent():
    def a(zs):
        for z in zs[30:]:
            z["treiber_endpunkte"]["regler"] = [60, 4]   # 6.7 %
    assert ausw(lauf(aendere=a))["bestanden"] is False

    def b(zs):
        for z in zs[30:]:
            z["treiber_endpunkte"]["regler"] = [60, 3]   # exactly 5 %
    assert ausw(lauf(aendere=b))["bestanden"] is True


def test_dead_driver_thread_fails():
    def a(zs):
        zs[75]["treiber_lebt"] = False
    r = ausw(lauf(aendere=a))
    assert r["treiber"]["lebt"] is False and r["bestanden"] is False


def test_first_load_minute_is_setup_and_exempt_from_minimum_counts():
    def a(zs):
        zs[30]["treiber_endpunkte"] = {"regler": [10, 0], "deck_start": [0, 0], "strudel": [1, 0]}
    assert ausw(lauf(aendere=a))["bestanden"] is True


def test_silent_master_under_load_fails():
    def a(zs):
        zs[70]["pegel_master_db"] = -90.0
    r = ausw(lauf(aendere=a))
    assert r["treiber"]["pegel_ok"] is False and r["bestanden"] is False


def test_driver_that_did_nothing_is_unusable():
    def a(zs):
        for z in zs:
            z["treiber_aufrufe"] = 0
            z["treiber_endpunkte"] = {}
    r = ausw(lauf(aendere=a))
    assert r["unbrauchbar"] and r["bestanden"] is False


def test_dry_run_reports_memory_but_does_not_judge_it_and_says_so():
    zs = lauf(leerlauf=2, last=8, ende=5, rss_ende=130_000)   # +30 %: a leak in a 10 minute run proves nothing
    r = A.auswerten(zs, leerlauf_min=2, bezug=(3, 4), ende_min=5, last_min=8, probelauf=True)
    assert r["art"] == "probelauf" and r["speicher"]["kern"]["ok"] is None and r["bestanden"] is True
    md = A.markdown(r)
    assert "Dry run (10 min): says nothing about leaks" in md and "NOT an R3 verdict" in md
    assert "not judged" in md and "PASSED" not in md.split("\n")[0]


def test_dry_run_with_a_restart_still_fails():
    def a(zs):
        zs[7]["neustarts"]["kern"] = 1
    r = A.auswerten(lauf(leerlauf=2, last=8, aendere=a), leerlauf_min=2, bezug=(3, 4), last_min=8, probelauf=True)
    assert r["fails"] and A.exit_code(r) == 1


def test_missing_coverage_is_partial_never_a_pass_and_never_hides_a_fail():
    r = ausw(lauf(), nicht_abgedeckt=["instrument plugin host did not run under load"])
    assert r["bestanden"] is False and r["unbrauchbar"].startswith("partial R3 coverage") and A.exit_code(r) == 2
    assert "PARTIAL R3 COVERAGE" in A.markdown(r).split("\n")[0]

    def a(zs):
        zs[55]["neustarts"]["server"] = 1
    assert A.exit_code(ausw(lauf(aendere=a), nicht_abgedeckt=["x"])) == 1


def test_default_windows_do_not_fit_a_ten_minute_run():
    assert ausw(lauf(leerlauf=2, last=8))["unbrauchbar"]


def test_passing_run_has_all_sections():
    r = ausw(lauf())
    assert r["bestanden"] is True and r["unbrauchbar"] is None
    assert set(r) >= {"speicher", "luecken", "neustarts", "treiber", "bestanden", "unbrauchbar"}
    assert r["luecken"]["grundlinie_pro_stunde"]["ereignisse"] == 0
    assert r["art"] == "r3" and "Soak verdict: PASSED" in A.markdown(r)


def _cli(tmp_path, zs, *args):
    p = tmp_path / "minuten.jsonl"
    p.write_text("".join(json.dumps(z) + "\n" for z in zs))
    return subprocess.run([sys.executable, SKRIPT, str(p), *args], capture_output=True, text=True)


def test_cli_exit_codes(tmp_path):
    ok = _cli(tmp_path, lauf(), "--last-min", "60")
    assert ok.returncode == 0 and "|" in ok.stdout
    out = tmp_path / "u.json"
    assert _cli(tmp_path, lauf(rss_ende=110_000), "--last-min", "60", "--json", str(out)).returncode == 1
    assert json.loads(out.read_text())["bestanden"] is False
    assert _cli(tmp_path, lauf(last=10), "--last-min", "10").returncode == 2
    assert _cli(tmp_path, lauf()).returncode == 2     # 60 of the default 240 load minutes: aborted
    assert _cli(tmp_path, lauf(leerlauf=2, last=8), "--probelauf").returncode == 0
    (tmp_path / "leer.jsonl").write_text("")
    assert subprocess.run([sys.executable, SKRIPT, str(tmp_path / "leer.jsonl")], capture_output=True).returncode == 2
    assert subprocess.run([sys.executable, SKRIPT, str(tmp_path / "gibtsnicht")], capture_output=True).returncode == 2


def test_cli_fail_wins_over_unusable(tmp_path):
    def a(zs):
        del zs[70]
        zs[55]["neustarts"]["server"] = 1
    assert _cli(tmp_path, lauf(aendere=a), "--last-min", "60").returncode == 1


def test_minute_without_core_state_messages_is_unusable():
    def a(zs):
        zs[40]["zustand_n"] = 0   # deaf minute: its zero gaps are no reading
    assert ausw(lauf(aendere=a))["unbrauchbar"]
    assert ausw(lauf())["bestanden"] is True
