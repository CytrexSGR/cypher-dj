"""The quiet stage in parallel containers: alles.sh --paket / --ohne-ruhig, ruhig_pakete.sh with a stub in place of the container, ci.yml, im_container CPU cap."""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
REPO = TOOLS.parents[1]
ALLES = TOOLS / "alles.sh"
PAKETE = TOOLS / "ci" / "ruhig_pakete.sh"
sys.path.insert(0, str(TOOLS))
import alles_verteilen as av  # noqa: E402

UI = REPO / "djk" / "ui" / "tests"


def alles(*args, **kw):
    return subprocess.run(["bash", str(ALLES), *args], capture_output=True, text=True, timeout=120, **kw)


def test_paket_listing_names_the_suites_of_each_package():
    assert [alles("--paket", f"{n}/4", "--liste").stdout.split() for n in range(1, 6)] == [
        ["ui-ruhig-1"], ["ui-ruhig-2"], ["ui-ruhig-3"], ["ui-ruhig-4"], ["core-ruhig", "generator-ruhig"]]
    assert [alles("--paket", f"{n}/2", "--liste").stdout.split() for n in range(1, 4)] == [["ui-ruhig-1"], ["ui-ruhig-2"], ["core-ruhig", "generator-ruhig"]]


def test_the_package_count_is_one_variable_and_defaults_to_four():
    e = {**os.environ, "RUHIG_PAKETE": "2"}
    assert alles("--paket", "3", "--liste", env=e).stdout.split() == ["core-ruhig", "generator-ruhig"]
    e.pop("RUHIG_PAKETE")
    assert alles("--paket", "5", "--liste", env=e).stdout.split() == ["core-ruhig", "generator-ruhig"]
    assert alles("--paket", "6", "--liste", env=e).returncode == 2


def test_bad_paket_arguments_are_refused():
    for a in ("0/4", "x/4", "1/0", "7/4", "1/"):
        assert alles("--paket", a, "--liste").returncode == 2, a
    assert alles("--paket", "1/4", "--ohne-ruhig", "--liste").returncode == 2


def test_the_package_commands_cover_every_quiet_file_once_on_instance_h(tmp_path):
    node = tmp_path / "bin" / "node"
    node.parent.mkdir()
    node.write_text('#!/bin/bash\necho "ARGS $*"\necho "INSTANZ $CYPHERDJ_TEST_INSTANZ"\n')
    node.chmod(0o755)
    env = {**os.environ, "PATH": f"{node.parent}:{os.environ['PATH']}"}
    gesehen = []
    for n in range(1, 5):
        z = tmp_path / f"z{n}"
        r = alles("--paket", f"{n}/4", "--intern", f"ui-ruhig-{n}", "--ziel", str(z), env=env)
        assert r.returncode == 0, r.stderr
        log = (z / f"ui-ruhig-{n}.log").read_text()
        assert "INSTANZ h" in log
        gesehen += [w for w in log.split("ARGS", 1)[1].splitlines()[0].split() if w.startswith("tests/")]
    assert sorted(gesehen) == sorted(f"tests/{f}" for f in av.lies_ruhig(UI / "ruhig.txt"))


def test_a_package_with_nothing_selected_writes_a_green_summary_and_runs_no_suite(tmp_path):
    r = alles("--paket", "5/4", "--nur", "py-tools", "--ziel", str(tmp_path / "z"))
    assert r.returncode == 0 and "Result: GREEN, nothing selected" in (tmp_path / "z" / "SUMMARY.md").read_text()
    assert not list((tmp_path / "z").glob("*.meta"))


def test_ohne_ruhig_runs_everything_but_the_quiet_stage():
    src = ALLES.read_text()
    assert 'ist_nach "$s" || W="$W $s"' in src and "--ohne-ruhig) OHNE_RUHIG=1" in src
    # the quiet suites are exactly the last three of the gate list plus the page packages
    assert [s for s in alles("--liste").stdout.split() if s.endswith("-ruhig")] == ["core-ruhig", "ui-ruhig", "generator-ruhig"]


# ---- ruhig_pakete.sh with a stub in place of the container -------------------------------------------------------------------------------

STUB = r"""#!/bin/bash
# stands in for im_container.sh: args are `djk/tools/alles.sh --paket n/M [..] --ziel DIR`
n=${3%%/*}; ziel=${@: -1}
echo "$n $CI_CPUS $CI_MEMORY $(date +%s.%N)" >> "$STUB_LOG"
echo "$@" >> "$STUB_ARGS"
sleep 0.6
[ "$STUB_MODUS" = nichts ] && exit 0
mkdir -p "$ziel"
if [ "$STUB_MODUS:$n" = "rot:2" ]; then
  printf '    not ok 1 - case b\nnot ok 1 - tests/a.test.mjs\n# pass 4\n# fail 1\n# skipped 0\n' > "$ziel/ui-ruhig-$n.log"; printf 'kind=node\nseconds=1\nexit=1\n' > "$ziel/ui-ruhig-$n.meta"; exit 1
fi
printf '# pass %s\n# fail 0\n# skipped 0\n' "$n" > "$ziel/ui-ruhig-$n.log"; printf 'kind=node\nseconds=1\nexit=0\n' > "$ziel/ui-ruhig-$n.meta"
[ "$STUB_MODUS:$n" = "abbruch:4" ] && exit 2
exit 0
"""


def pakete(tmp_path, modus, *extra, m="4"):
    stub = tmp_path / "stub.sh"
    stub.write_text(STUB)
    stub.chmod(0o755)
    ziel = tmp_path / "ergebnis"
    ziel.mkdir(exist_ok=True)
    (ziel / "SUMMARY.md").write_text("# pool\n")   # the pool's folder: it ran, it only holds no suite in this test
    env = {**os.environ, "RUHIG_CONTAINER": str(stub), "STUB_LOG": str(tmp_path / "log"), "STUB_ARGS": str(tmp_path / "args"), "STUB_MODUS": modus, "RUHIG_PAKETE": m}
    t0 = time.time()
    r = subprocess.run(["bash", str(PAKETE), str(ziel), *extra], env=env, capture_output=True, text=True, timeout=120)
    return r, ziel, time.time() - t0


def test_all_packages_start_at_once_each_with_a_cpu_cap_and_its_own_folder(tmp_path):
    r, ziel, dauer = pakete(tmp_path, "gruen", "--betroffen", "abc123", m="4")
    zeilen = [z.split() for z in (tmp_path / "log").read_text().splitlines()]
    assert sorted(int(z[0]) for z in zeilen) == [1, 2, 3, 4, 5]
    starts = [float(z[3]) for z in zeilen]
    assert max(starts) - min(starts) < 0.5 and dauer < 3.0   # parallel: five stubs of 0.6 s do not take 3 s one after the other
    cpus = {int(z[0]): z[1] for z in zeilen}
    assert [cpus[n] for n in (1, 2, 3, 4, 5)] == ["4", "4", "4", "4", "8"] and {z[2] for z in zeilen} == {"8g"}
    args = sorted((tmp_path / "args").read_text().splitlines())
    for n in range(1, 6):
        assert f"djk/tools/alles.sh --paket {n}/4 --betroffen abc123 --ziel {ziel}/ruhig-{n}" in args


def test_the_merged_report_is_one_summary_and_green_when_every_package_is(tmp_path):
    r, ziel, _ = pakete(tmp_path, "gruen")
    assert r.returncode == 0, r.stdout + r.stderr
    md = (ziel / "SUMMARY.md").read_text()
    assert "| ui-ruhig-1 | 1 |" in md and "| ui-ruhig-4 | 4 |" in md and "Result: GREEN" in md


def test_a_package_count_of_two_gives_three_containers(tmp_path):
    r, ziel, _ = pakete(tmp_path, "gruen", m="2")
    assert len((tmp_path / "log").read_text().splitlines()) == 3 and "--paket 3/2" in (tmp_path / "args").read_text()


def test_a_red_package_fails_the_step_and_shows_in_the_summary(tmp_path):
    r, ziel, _ = pakete(tmp_path, "rot")
    assert r.returncode == 1
    assert "### ui-ruhig-2" in (ziel / "SUMMARY.md").read_text() and "Result: RED" in (ziel / "SUMMARY.md").read_text()


def test_a_package_that_wrote_nothing_fails_the_step(tmp_path):
    r, ziel, _ = pakete(tmp_path, "nichts")
    assert r.returncode == 1 and "no result in" in (ziel / "SUMMARY.md").read_text()


def test_a_container_that_dies_with_an_unexplained_code_fails_the_step(tmp_path):
    r, ziel, _ = pakete(tmp_path, "abbruch")
    assert r.returncode == 1


def test_a_bad_package_count_is_refused(tmp_path):
    r, _, _ = pakete(tmp_path, "gruen", m="0")
    assert r.returncode == 2


# ---- the workflow and the container script -----------------------------------------------------------------------------------------------

def _jobs_und_schritte(text):
    """{job: [step text]} of a workflow file, by indentation (the gate container has no PyYAML): a job is a line `  <name>:`,
    a step starts with `      - `."""
    jobs, job, schritte = {}, None, None
    for zeile in text.splitlines():
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", zeile)
        if m:
            job = m.group(1)
            schritte = jobs.setdefault(job, [])
            continue
        if job is None:
            continue
        if zeile.startswith("      - "):
            schritte.append(zeile + "\n")
        elif schritte and (zeile.startswith("        ") or not zeile.strip()):
            schritte[-1] += zeile + "\n"
    return jobs


def test_ci_yml_runs_the_quiet_stage_as_its_own_step_after_the_pool():
    ci = sorted(REPO.glob(".*/workflows/ci.yml"))   # the forge folder by pattern: its name is kept out of the public export
    if not ci:
        pytest.skip("no CI workflow in this tree (public export)")
    jobs = _jobs_und_schritte(ci[0].read_text())
    for job in ("quick", "full"):
        steps = jobs[job]
        i = next(k for k, s in enumerate(steps) if "--ohne-ruhig" in s)
        q = steps[i + 1]
        assert "ruhig_pakete.sh" in q and re.search(r"RUHIG_PAKETE:\s*4\b", q) and "always()" in q
        assert "Summary" in steps[i + 2].splitlines()[0]
    # the slow stage has no quiet stage and stays as it was
    assert all("--ohne-ruhig" not in s for s in jobs["slow"] + jobs["nightly"])


def podman_args(tmp_path, **env):
    (tmp_path / "podman").write_text('#!/bin/bash\ncase "$1 $2" in "image inspect") echo sha256:0123456789abcdef;; "volume ls") ;; *) [ "$1" = run ] && printf "%s\\n" "$@" > "$(dirname "$0")/run.args";; esac\n')
    (tmp_path / "podman").chmod(0o755)
    e = {k: v for k, v in os.environ.items() if k != "CI_CPUS"}
    e.update({"PATH": f"{tmp_path}:{os.environ['PATH']}", "CI_GPU": "0", "CI_GEWICHTE": str(tmp_path / "none"), "CI_STRUDEL": str(tmp_path / "none"), **env})
    assert subprocess.run(["bash", str(TOOLS / "ci" / "im_container.sh"), "true"], env=e, capture_output=True, timeout=60).returncode == 0
    return (tmp_path / "run.args").read_text().split("\n")


def test_container_cpu_cap_is_optional(tmp_path):
    a = podman_args(tmp_path, CI_CPUS="4")
    assert a[a.index("--cpus") + 1] == "4"
    (tmp_path / "run.args").unlink()
    assert "--cpus" not in podman_args(tmp_path)
