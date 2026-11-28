"""bericht: `cypher-dj report` writes one scrubbed tar.gz a user can attach to a bug report. Nothing is sent anywhere.

Contents: README.txt, version.txt, doctor.txt, system.txt, journal/<unit>.txt (last 2,000 lines per cypherdj unit, left out with
--ohne-journal), seitenfehler.txt (page errors), speicher.txt (storage folders with sizes, no file names) and, only with --mit-projekt,
project.json of the open project. Scrub rule: home folder -> ~, user name -> <user>, host name -> <host>.

Test hooks: CYPHERDJ_BERICHT_DOCTOR (command instead of the sibling djk-doctor), CYPHERDJ_BERICHT_HOST (host name to scrub).
journalctl and systemctl are looked up on PATH, so tests can stub them.
"""
from __future__ import annotations

import datetime
import io
import os
import platform
import re
import shlex
import socket
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HIER = Path(__file__).resolve().parent
DJK = HIER.parent
if str(DJK) not in sys.path:
    sys.path.insert(0, str(DJK))

JOURNAL_ZEILEN = 2000
FRIST = 20  # seconds per external command

HINWEIS = ("Note: journal lines can name track titles and file names of what was playing. "
           "Use --ohne-journal to leave the journal out.")
HINWEIS_OHNE = "The journal is left out (--ohne-journal)."
README = """cypher-dj report

This file was made on your machine by `cypher-dj report`. Nothing was sent anywhere; you decide whether to share it.
Home folder, user name and host name are replaced by ~, <user> and <host>.

Members:
  version.txt       package version and project format
  doctor.txt        the output of `cypher-dj doctor`
  system.txt        operating system and CPU
  journal/          the last 2,000 lines of each cypherdj service (absent with --ohne-journal); lines can name track titles
  seitenfehler.txt  errors the page reported (the page server keeps them in a small rotating file)
  speicher.txt      the storage folders and how large they are (no file names)
  project.json      the open project, only with --mit-projekt
"""


def scrub(text: str, home: str, user: str, host: str) -> str:
    """Home folder (resolved and URL-encoded forms too) -> ~; user and host as whole words, any letter case -> <user>, <host>.
    Empty values change nothing. A home path only counts at the start of a path (not after a word character)."""
    from urllib.parse import quote
    homes = {h.rstrip("/") for h in (home, os.path.realpath(home) if home else "") if h and h.rstrip("/")}
    formen = set(homes) | {quote(h, safe="/") for h in homes} | {quote(h, safe="") for h in homes}
    for h in sorted(formen, key=len, reverse=True):
        text = re.sub(r"(?<![\w])" + re.escape(h) + r"(?![\w-])", "~", text, flags=re.IGNORECASE)
    for wert, ersatz in ((user, "<user>"), (host, "<host>")):
        if wert:
            text = re.sub(r"(?<![\w-])" + re.escape(wert) + r"(?![\w-])", ersatz, text, flags=re.IGNORECASE)
    return text


def _lauf(argv: list[str], frist: int = FRIST) -> tuple[int | None, str]:
    """Run a command; (None, reason) when it cannot run, else (exit code, stdout+stderr)."""
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=frist, check=False, errors="replace")
    except FileNotFoundError:
        return None, f"{argv[0]} is not installed"
    except subprocess.TimeoutExpired:
        return None, f"{argv[0]} did not answer in {frist} s"
    except OSError as e:
        return None, f"{argv[0]} could not run ({e})"
    return r.returncode, r.stdout + (r.stderr if r.returncode != 0 else "")


def _einheiten(instanz: str) -> tuple[list[str], str]:
    rc, aus = _lauf(["systemctl", "--user", "list-units", "cypherdj*", "--all", "--plain", "--no-legend"])
    if rc is None:
        return [], aus
    kandidaten = [z.split()[0] for z in aus.splitlines() if z.split()]
    # a stopped unit is no longer listed but its journal is still there: every unit name the journal knows counts too
    rj, auj = _lauf(["journalctl", "--user", "-F", "_SYSTEMD_USER_UNIT"], 10)
    if rj == 0:
        kandidaten += [z.strip() for z in auj.splitlines() if re.fullmatch(r"cypherdj[\w@.:-]*", z.strip())]
    namen = []
    for name in dict.fromkeys(kandidaten):
        if not name.startswith("cypherdj"):
            continue
        stamm = re.sub(r"\.(service|scope|socket|timer)$", "", name)
        mit_buchstabe = re.search(r"-([a-i])$", stamm)
        if instanz:
            if mit_buchstabe and mit_buchstabe.group(1) == instanz:
                namen.append(name)
        elif not mit_buchstabe:
            namen.append(name)
    return namen, ""


def _version() -> str:
    ver = ""
    rc, aus = _lauf(["dpkg-query", "-W", "-f", "${Version}", "cypher-dj"], 5)
    if rc == 0 and aus.strip():
        ver = aus.strip() + " (package)"
    if not ver:
        rc, aus = _lauf(["git", "-C", str(DJK.parent), "describe", "--tags", "--always"], 5) if (DJK.parent / ".git").exists() else (None, "")
        if rc == 0 and aus.strip():
            ver = aus.strip() + " (git)"
    if not ver:
        ver = "unknown"
    fmt = "unknown"
    try:
        m = re.search(r"export const FORMAT = '([^']+)'", (DJK / "ui" / "project" / "model_types.ts").read_text(encoding="utf-8"))
        fmt = m.group(1) if m else fmt
    except OSError:
        pass
    return f"cypher-dj {ver}\nproject format {fmt}\n"


def _system() -> str:
    zeilen = []
    try:
        for z in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
            if z.startswith("PRETTY_NAME="):
                zeilen.append("OS: " + z.split("=", 1)[1].strip('"'))
    except OSError:
        zeilen.append("OS: unknown")
    zeilen.append(f"Kernel: {platform.release()} {platform.machine()}")
    try:
        cpu = next((z.split(":", 1)[1].strip() for z in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines()
                    if z.startswith("model name")), "unknown")
        mem = next((z.split(":", 1)[1].strip() for z in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines()
                    if z.startswith("MemTotal")), "unknown")
        zeilen.append(f"CPU: {cpu} ({os.cpu_count()} threads)")
        zeilen.append(f"Memory: {mem}")
    except OSError:
        zeilen.append("CPU: unknown")
    return "\n".join(zeilen) + "\n"


def _groesse(ordner: str) -> tuple[int, int]:
    gesamt = anzahl = 0
    for wurzel, _dirs, dateien in os.walk(ordner, followlinks=False):
        for d in dateien:
            try:
                gesamt += os.lstat(os.path.join(wurzel, d)).st_size
                anzahl += 1
            except OSError:
                pass
    return gesamt, anzahl


def _speicher() -> str:
    import ablage
    zeilen = []
    for art in ablage.arten():
        try:
            o = str(ablage.ordner(art))
        except (ValueError, KeyError, OSError) as e:
            zeilen.append(f"{art}\t(not resolvable: {e})")
            continue
        if not os.path.isdir(o):
            zeilen.append(f"{art}\t{o}\t(absent)")
            continue
        b, n = _groesse(o)
        zeilen.append(f"{art}\t{o}\t{b / 1048576:.1f} MiB\t{n} files")
    return "\n".join(zeilen) + "\n"


def _zustandsordner(instanz: str) -> Path:
    if instanz:
        return Path(f"/dev/shm/cypherdj-{instanz}/hotcues")
    import ablage
    return ablage.ordner("hotcues")


def _seitenfehler(instanz: str) -> str:
    try:
        ordner = _zustandsordner(instanz)
    except (ValueError, KeyError, OSError) as e:
        return f"No page error file ({e}).\n"
    teile = []
    for name in ("seitenfehler.jsonl.1", "seitenfehler.jsonl"):
        try:
            teile.append((ordner / name).read_text(encoding="utf-8", errors="replace"))
        except OSError:
            pass
    return "".join(teile) if teile else "No page errors recorded.\n"


def _offenes_projekt(instanz: str) -> tuple[str | None, str]:
    """(project.json text, note): the text only when a project is open and its file is readable."""
    import json
    import ablage
    try:
        slug = json.loads((_zustandsordner(instanz) / "offenes_projekt.json").read_text(encoding="utf-8")).get("slug")
    except (OSError, ValueError, AttributeError):
        slug = None
    if not isinstance(slug, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", slug) or slug.startswith("."):
        return None, "No project is open, so project.json is not included."
    try:
        return (Path(ablage.ordner("projekte")) / slug / "project.json").read_text(encoding="utf-8"), ""
    except (OSError, ValueError, KeyError):
        return None, "The open project's project.json could not be read, so it is not included."


def sammle(opt: dict) -> dict[str, str]:
    """Archive member name -> scrubbed text. opt: instanz ('' or a..i), mit_projekt, ohne_journal. Notes go to opt['hinweise'] when present."""
    instanz = opt.get("instanz", "")
    hinweise = opt.setdefault("hinweise", [])
    home = os.environ.get("HOME") or os.path.expanduser("~")
    user = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
    if not user:
        try:
            import pwd
            user = pwd.getpwuid(os.getuid()).pw_name
        except (ImportError, KeyError):
            user = ""
    host = os.environ.get("CYPHERDJ_BERICHT_HOST") or socket.gethostname()
    roh: dict[str, str] = {"README.txt": README, "version.txt": _version()}

    doctor = shlex.split(os.environ["CYPHERDJ_BERICHT_DOCTOR"]) if os.environ.get("CYPHERDJ_BERICHT_DOCTOR") else [str(HIER / "djk-doctor")]
    rc, aus = _lauf(doctor + (["--instanz", instanz] if instanz else []), 90)
    roh["doctor.txt"] = aus if rc is not None else f"The doctor could not run: {aus}\n"   # exit code 1 only means a PROBLEM line

    roh["system.txt"] = _system()
    if not opt.get("ohne_journal"):
        einheiten, grund = _einheiten(instanz)
        if not einheiten:
            roh["journal/NO-UNITS.txt"] = (f"No cypherdj unit was found ({grund}).\n" if grund
                                                  else "No cypherdj service is known to systemd, so there is no journal to include.\n")
        for e in einheiten:
            rc, aus = _lauf(["journalctl", "--user", "-u", e, "-n", str(JOURNAL_ZEILEN), "--no-pager"])
            if rc is None:
                aus = f"The journal could not be read: {aus}\n"
            zeilen = aus.splitlines()[-JOURNAL_ZEILEN:]
            roh[f"journal/{e}.txt"] = "\n".join(zeilen) + "\n"
    roh["seitenfehler.txt"] = _seitenfehler(instanz)
    try:
        roh["speicher.txt"] = _speicher()
    except Exception as e:  # noqa: BLE001 (a broken storage table must not stop the report)
        roh["speicher.txt"] = f"The storage folders could not be listed ({type(e).__name__}: {e}).\n"
    if opt.get("mit_projekt"):
        text, note = _offenes_projekt(instanz)
        if text is None:
            hinweise.append(note)
        else:
            roh["project.json"] = text
    return {k: scrub(v, home, user, host) for k, v in roh.items()}


def _lies_args(argv: list[str]) -> dict | None:
    opt: dict = {"instanz": "", "mit_projekt": False, "ohne_journal": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--mit-projekt":
            opt["mit_projekt"] = True
        elif a == "--ohne-journal":
            opt["ohne_journal"] = True
        elif a == "--instanz" and i + 1 < len(argv) and re.fullmatch(r"[a-i]", argv[i + 1]):
            i += 1
            opt["instanz"] = argv[i]
        else:
            return None
        i += 1
    return opt


def main(argv: list[str]) -> int:
    opt = _lies_args(argv)
    if opt is None:
        print("Usage: cypher-dj report [--mit-projekt] [--ohne-journal] [--instanz a..i]", file=sys.stderr)
        return 2
    print(HINWEIS_OHNE if opt["ohne_journal"] else HINWEIS)
    sys.stdout.flush()
    teile = sammle(opt)
    name = f"cypher-dj-report-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.tar.gz"
    jetzt = time.time()
    try:
        with tarfile.open(name, "w:gz") as tar:
            for member, text in teile.items():
                daten = text.encode("utf-8")
                info = tarfile.TarInfo(member)
                info.size, info.mtime, info.mode = len(daten), jetzt, 0o644
                tar.addfile(info, io.BytesIO(daten))
    except OSError as e:
        print(f"cypher-dj report: cannot write {name} here ({e}); change to a folder you can write to.", file=sys.stderr)
        return 1
    for h in opt.get("hinweise", []):
        print(h)
    print(f"Wrote {os.path.abspath(name)} with:")
    for member in teile:
        print(f"  {member}")
    print("Nothing is sent anywhere. Attach the file to your bug report yourself if you want to share it.")
    return 0
