"""gruene_basis.sh and the marker kind of sichere_ergebnis.sh, on a throw-away git repo (no network, no runner)."""
import os
import subprocess
import sys
from pathlib import Path

CI = Path(__file__).resolve().parents[1] / "ci"
BASIS = CI / "gruene_basis.sh"
SICHERE = CI / "sichere_ergebnis.sh"
sys.path.insert(0, str(CI.parent))
import betroffen  # noqa: E402


def git(repo, *a):
    r = subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, check=True,
                       env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
    return r.stdout.strip()


def commit(repo, name):
    (repo / name).write_text(name)
    git(repo, "add", name)
    git(repo, "commit", "-q", "-m", name)
    return git(repo, "rev-parse", "HEAD")


def fixture(tmp):
    """main: m1 m2; branch from m2: b1 b2 b3 (HEAD). origin/main is a ref pointing at m2."""
    repo = tmp / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    c = {"m1": commit(repo, "m1"), "m2": commit(repo, "m2")}
    git(repo, "update-ref", "refs/remotes/origin/main", c["m2"])
    git(repo, "checkout", "-q", "-b", "zweig")
    for n in ("b1", "b2", "b3"):
        c[n] = commit(repo, n)
    return repo, c


def lauf(repo, gruen, *args, rot=None):
    r = subprocess.run(["bash", str(BASIS), *args], cwd=repo, capture_output=True, text=True,
                       env={**os.environ, "CI_GRUEN": str(gruen), "CI_ROT": str(rot or gruen.parent / "rot-leer")})
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def test_ohne_marker_merge_basis(tmp_path):
    repo, c = fixture(tmp_path)
    assert lauf(repo, tmp_path / "gruen") == f"{c['m2']} merge"


def test_neuester_gruener_vorfahr(tmp_path):
    repo, c = fixture(tmp_path)
    g = tmp_path / "gruen"
    g.mkdir()
    (g / c["b1"]).write_text("1-quick\n")
    assert lauf(repo, g) == f"{c['b1']} delta"
    (g / c["b2"]).write_text("2-quick\n")
    assert lauf(repo, g) == f"{c['b2']} delta"


def test_marker_auf_head_zaehlt_nicht(tmp_path):
    repo, c = fixture(tmp_path)
    g = tmp_path / "gruen"
    g.mkdir()
    (g / c["b3"]).write_text("3-quick\n")
    assert lauf(repo, g) == f"{c['m2']} merge"


def test_marker_auf_main_ist_keine_delta_basis(tmp_path):
    repo, c = fixture(tmp_path)
    g = tmp_path / "gruen"
    g.mkdir()
    (g / c["m1"]).write_text("old\n")
    (g / c["m2"]).write_text("full\n")
    assert lauf(repo, g) == f"{c['m2']} merge"


def test_marker_eines_fremden_zweigs_zaehlt_nicht(tmp_path):
    repo, c = fixture(tmp_path)
    git(repo, "checkout", "-q", "-b", "anderer", c["m2"])
    fremd = commit(repo, "x1")
    git(repo, "checkout", "-q", "zweig")
    g = tmp_path / "gruen"
    g.mkdir()
    (g / fremd).write_text("x\n")
    assert lauf(repo, g) == f"{c['m2']} merge"


def test_ohne_merge_basis(tmp_path):
    repo, c = fixture(tmp_path)
    git(repo, "update-ref", "-d", "refs/remotes/origin/main")
    assert lauf(repo, tmp_path / "gruen") == "- merge"


def test_anderer_hauptzweig_als_argument(tmp_path):
    repo, c = fixture(tmp_path)
    git(repo, "update-ref", "refs/remotes/origin/zwei", c["m1"])
    assert lauf(repo, tmp_path / "gruen", "origin/zwei") == f"{c['m1']} merge"




def sichere(tmp, gruen, sha, *basis, summary="Result: GREEN\n", rot=None):
    z = tmp / "erg"
    z.mkdir(exist_ok=True)
    (z / "SUMMARY.md").write_text(summary)
    env = {**os.environ, "CI_GRUEN": str(gruen), "CI_ERGEBNISSE": str(tmp / "kopie"), "CI_ROT": str(rot or tmp / "rot")}
    r = subprocess.run(["bash", str(SICHERE), str(z), "7-quick", sha, *basis], capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr


def test_marker_traegt_die_art(tmp_path):
    g = tmp_path / "gruen"
    sichere(tmp_path, g, "aaa", "merge")
    assert (g / "aaa").read_text().split() == ["7-quick", "basis=merge"]
    sichere(tmp_path, g, "bbb", "delta")
    assert "basis=delta" in (g / "bbb").read_text().split()
    sichere(tmp_path, g, "ccc")
    assert (g / "ccc").read_text().split() == ["7-quick", "basis=full"]


def test_roter_lauf_ohne_marker(tmp_path):
    g = tmp_path / "gruen"
    sichere(tmp_path, g, "ddd", "delta", summary="Result: RED\n")
    assert not (g / "ddd").exists()


def rot_summary(*suites):
    return "# Test run summary\n\n## Failing tests (gate)\n\n" + "".join(f"### {s}\n- a test\n\n" for s in suites) + \
        "## Flaky (failed, then passed on the rerun)\n\n### flakysuite\n- x\n\nResult: RED, failures outside quarantine\n"


def test_roter_lauf_schreibt_rot_marker(tmp_path):
    g, r = tmp_path / "gruen", tmp_path / "rot"
    sichere(tmp_path, g, "ddd", "delta", "abc123", summary=rot_summary("py-tools", "ui-ruhig-2", "ui-ruhig-3"), rot=r)
    assert not (g / "ddd").exists()
    assert (r / "ddd").read_text().split() == ["7-quick", "basis=delta", "ref=abc123", "suites=py-tools,ui-ruhig"]   # flaky is not red


def test_rot_marker_nur_mit_benennbaren_suites(tmp_path):
    r = tmp_path / "rot"
    sichere(tmp_path, tmp_path / "g", "e1", "delta", "x", summary="## Failing tests (gate)\n\nnone\n\n## Not run\n\nResult: RED, a suite did not run\n", rot=r)
    sichere(tmp_path, tmp_path / "g", "e2", "delta", "x", summary="## Failing tests (gate)\n\n### folder ruhig-1\n- no result\n\nResult: RED\n", rot=r)
    sichere(tmp_path, tmp_path / "g", "e3", "delta", "x", summary="## Not run\n\n- instruments: cargo not found\n\n## Failing tests (gate)\n\n### py-tools\n- t\n\nResult: RED\n", rot=r)
    sichere(tmp_path, tmp_path / "g", "e4", "delta", "x", summary="Result: GREEN, no failure outside quarantine\n", rot=r)
    assert not r.exists() or list(r.iterdir()) == []


def test_nur_die_neuesten_50_rot_marker(tmp_path):
    r = tmp_path / "rot"
    r.mkdir()
    for i in range(55):
        (r / f"old{i:02d}").write_text("x")
        os.utime(r / f"old{i:02d}", (1000 + i, 1000 + i))
    sichere(tmp_path, tmp_path / "g", "neu", "delta", "x", summary=rot_summary("py-tools"), rot=r)
    names = {p.name for p in r.iterdir()}
    assert len(names) == 50 and "neu" in names and "old00" not in names and "old54" in names


def test_rot_marker_gefunden_und_suites_durchgereicht(tmp_path):
    repo, c = fixture(tmp_path)
    g, r = tmp_path / "gruen", tmp_path / "rot"
    sichere(tmp_path, g, c["b2"], "merge", c["m2"], summary=rot_summary("py-tools", "core"), rot=r)
    assert lauf(repo, g, rot=r) == f"{c['b2']} rot core,py-tools"
    # the sichere_ergebnis output is what gruene_basis reads: the same sha with a green marker too counts as green
    (g / c["b2"]).parent.mkdir(exist_ok=True)
    (g / c["b2"]).write_text("1\nbasis=delta\n")
    assert lauf(repo, g, rot=r) == f"{c['b2']} delta"


def test_gruener_marker_neuer_als_rot_gewinnt(tmp_path):
    repo, c = fixture(tmp_path)
    g, r = tmp_path / "gruen", tmp_path / "rot"
    sichere(tmp_path, g, c["b1"], "merge", c["m2"], summary=rot_summary("py-tools"), rot=r)
    g.mkdir()
    (g / c["b2"]).write_text("2\nbasis=delta\n")
    assert lauf(repo, g, rot=r) == f"{c['b2']} delta"
    # and a red marker newer than the green one wins
    (g / c["b2"]).unlink()
    (g / c["b1"]).write_text("1\nbasis=delta\n")
    sichere(tmp_path, g, c["b2"], "delta", c["b1"], summary=rot_summary("hand"), rot=r)
    assert lauf(repo, g, rot=r) == f"{c['b2']} rot hand"


def test_rot_marker_ohne_suites_und_fremder_zweig_zaehlen_nicht(tmp_path):
    repo, c = fixture(tmp_path)
    r = tmp_path / "rot"
    r.mkdir()
    (r / c["b2"]).write_text("7-quick\nbasis=delta\nref=x\n")   # no suites line
    assert lauf(repo, tmp_path / "gruen", rot=r) == f"{c['m2']} merge"
    (r / c["m2"]).write_text("7-quick\nbasis=delta\nref=x\nsuites=core\n")   # a commit of main is no branch basis
    assert lauf(repo, tmp_path / "gruen", rot=r) == f"{c['m2']} merge"


def test_aenderung_am_gate_seit_rot_eskaliert_test_aenderung_nicht(tmp_path):
    """The range since the red commit decides (betroffen.plane): a gate file escalates, a test or source file selects only itself."""
    repo, c = fixture(tmp_path)
    r = tmp_path / "rot"
    sichere(tmp_path, tmp_path / "g", c["b1"], "merge", c["m2"], summary=rot_summary("py-tools"), rot=r)
    (repo / "djk" / "tools").mkdir(parents=True)
    (repo / "djk" / "tools" / "alles.sh").write_text("x")
    (repo / "djk" / "hand").mkdir()
    (repo / "djk" / "hand" / "hand.ts").write_text("x")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "gate+hand")
    out = lauf(repo, tmp_path / "g", rot=r)
    assert out == f"{c['b1']} rot py-tools"
    ref = out.split()[0]
    geaendert = [f for f in git(repo, "diff", "--name-only", ref).split() if f.startswith("djk/")]   # (the fixture's own b2, b3 files name no suite)
    assert betroffen.plane(geaendert)[0]   # the gate changed since the red run: the whole gate
    geaendert.remove("djk/tools/alles.sh")
    esk, suites, dateien, _ = betroffen.plane(geaendert)
    assert not esk and "hand" in (set(suites) | set(dateien))   # without it: the suites the change touches
