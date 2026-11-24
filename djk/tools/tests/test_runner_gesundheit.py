"""runner_gesundheit.sh with a stub busctl: prints the health line, warns below 100 W, stops the job at the start on a throttled runner (speed probe), warns at the end."""
import os
import stat
import subprocess
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[1] / "ci" / "runner_gesundheit.sh"


def lauf(tmp: Path, pl1=None, busctl=True, tempo="0.11", args=()):
    env = {**os.environ, "BUSCTL": str(tmp / "busctl") if busctl else "no-such-busctl-zz"}
    env.pop("RUNNER_TEMPO_S", None); env.pop("RUNNER_TEMPO_GRENZE_S", None)
    if tempo is not None:
        env["RUNNER_TEMPO_S"] = tempo
    if busctl:
        (tmp / "busctl").write_text(
            "#!/bin/bash\ncase \"$*\" in\n"
            "  *ODMPowerLimitsJSON*) echo 's \"[{\\\"min\\\":5,\\\"max\\\":130,\\\"current\\\":" + str(pl1) + ",\\\"descriptor\\\":\\\"pl1\\\"},{\\\"current\\\":200,\\\"descriptor\\\":\\\"pl4\\\"}]\"';;\n"
            "  *GetActiveProfileJSON*) echo 's \"{\\\"id\\\":\\\"__high_performance__\\\",\\\"name\\\":\\\"x\\\"}\"';;\nesac\n")
        (tmp / "busctl").chmod(0o755)
    return subprocess.run(["bash", str(SKRIPT), *args], capture_output=True, text=True, env=env)


def test_a_capped_runner_gets_a_visible_warning_and_the_job_goes_on(tmp_path):
    r = lauf(tmp_path, 60)
    assert r.returncode == 0
    assert "pl1=60 W profile=__high_performance__" in r.stdout and "nproc=" in r.stdout
    assert "::warning::runner is power-capped at 60 W" in r.stdout


def test_a_runner_at_full_power_prints_the_line_without_a_warning(tmp_path):
    r = lauf(tmp_path, 130)
    assert r.returncode == 0 and "pl1=130 W" in r.stdout and "::warning::" not in r.stdout


def test_without_tccd_it_prints_load_and_nproc_and_stays_silent_otherwise(tmp_path):
    r = lauf(tmp_path, busctl=False)
    assert r.returncode == 0 and "pl1=n/a W" in r.stdout and "::warning::" not in r.stdout and r.stderr == ""


def test_a_throttled_runner_stops_the_job_at_the_start_and_names_the_machine(tmp_path):
    r = lauf(tmp_path, 130, tempo="0.58")
    assert r.returncode == 1
    assert "probe=0.58 s" in r.stdout and "::error::runner is throttled (speed probe 0.58 s, limit 0.4 s)" in r.stdout and "not the code" in r.stdout


def test_at_the_end_a_throttled_runner_only_warns(tmp_path):
    r = lauf(tmp_path, 130, tempo="0.58", args=("--ende",))
    assert r.returncode == 0 and "::warning::runner is throttled at the end of the job" in r.stdout and "::error::" not in r.stdout


def test_a_fast_runner_passes_start_and_end_without_a_word(tmp_path):
    for args in ((), ("--ende",)):
        r = lauf(tmp_path, 130, tempo="0.11", args=args)
        assert r.returncode == 0 and "probe=0.11 s" in r.stdout and "::" not in r.stdout


def test_the_probe_measures_for_real_when_no_value_is_given(tmp_path):
    r = lauf(tmp_path, 130, tempo=None, args=("--ende",))
    assert r.returncode == 0
    wert = float(r.stdout.split("probe=")[1].split(" s")[0])
    assert 0 < wert < 9
