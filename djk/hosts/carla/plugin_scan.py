#!/usr/bin/env python3
"""Scan the installed VST3 and LV2 plugins with carla-discovery-native and keep an index.

One child process per bundle (own process group, nice 19). The child is judged by its output: a plugin counts only
if its block ends with the `carla-discovery::end::` line. A child that shows no sign of life for 10 s is
killed (`zeit`): no output and no CPU use in its process group. A bundle can take much longer in total as long as it
keeps printing or computing (LSP VST3: 10 s to the first line, ~45 s for 178 classes). Hard cap 180 s.
Anything that fails is a `blockiert` entry and is not started again until the bundle's mtime or size changes.

Plugin identity is {format, pfad, uid}. uid is the label carla-discovery prints for a VST3 class; for LV2 pfad is
the plugin URI and uid is empty. A blocked bundle is one entry with the bundle path as pfad and an empty uid.
The last stdout line is {neu, entfernt, geaendert, blockiert}, counted in entries.
"""
import argparse
import hashlib
import json
import os
import select
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

VERSION = 1
STANDARD_INDEX = "~/.local/state/cypherdj/plugins/index.json"
STANDARD_PFADE = ["~/.vst3", "/usr/lib/vst3", "/usr/local/lib/vst3", "~/.lv2", "/usr/lib/lv2", "/usr/local/lib/lv2"]
EIGENE_PFADE = ["~/.local/lib/cypherdj/vst3"]
STILLE_ZEIT = 10.0   # seconds without a single output byte
GESAMT_ZEIT = 180.0  # hard cap for one bundle
SUCHTIEFE = 3
MEHRKLASSEN_TEXT = ("Carla 2.5.8 loads only the first plugin of this bundle; "
                    "use the LV2 version if there is one")
ENDE = "carla-discovery::end::"


def discovery_programm():
    wahl = os.environ.get("DJK_CARLA_DISCOVERY")
    if wahl:
        return wahl
    for kandidat in ("/usr/lib/carla/carla-discovery-native", "/usr/local/lib/carla/carla-discovery-native"):
        if os.path.exists(kandidat):
            return kandidat
    return "carla-discovery-native"


class DiscoveryFehlt(Exception):
    """The discovery program cannot be run; nothing may be blocked because of that."""


def pruefe_discovery():
    """Resolve the discovery program; returns its identity {pfad, groesse} for the index."""
    prog = discovery_programm()
    voll = prog if os.sep in prog else shutil.which(prog)
    if not voll or not os.path.isfile(voll) or not os.access(voll, os.X_OK):
        raise DiscoveryFehlt(prog)
    return {"pfad": voll, "groesse": os.stat(voll).st_size}


def plugin_id(format_, pfad, uid):
    return hashlib.sha1(f"{format_}:{pfad}#{uid}".encode()).hexdigest()[:12]


def stat_buendel(pfad):
    """(mtime_ns, groesse) of a bundle: newest mtime and summed size of everything inside."""
    wurzel = os.path.realpath(pfad)
    neueste, summe = 0, 0
    if os.path.isfile(wurzel):
        st = os.stat(wurzel)
        return st.st_mtime_ns, st.st_size
    for dir_, _dirs, dateien in os.walk(wurzel):
        for n in [dir_] + [os.path.join(dir_, d) for d in dateien]:
            try:
                st = os.lstat(n)
            except OSError:
                continue
            neueste = max(neueste, st.st_mtime_ns)
            summe += st.st_size
    return neueste, summe


def finde_buendel(wurzeln):
    """Yield (format, path) for every *.vst3 / *.lv2 bundle below the roots."""
    gesehen = set()
    for wurzel in wurzeln:
        wurzel = os.path.expanduser(wurzel)
        if not os.path.isdir(wurzel):
            continue
        stapel = [(wurzel, 0)]
        while stapel:
            ordner, tiefe = stapel.pop()
            try:
                namen = sorted(os.listdir(ordner))
            except OSError:
                continue
            for n in namen:
                voll = os.path.join(ordner, n)
                endung = os.path.splitext(n)[1].lower()
                if endung in (".vst3", ".lv2") and (os.path.isdir(voll) or endung == ".vst3"):
                    echt = os.path.realpath(voll)
                    if echt not in gesehen:
                        gesehen.add(echt)
                        yield endung[1:], voll
                elif os.path.isdir(voll) and tiefe < SUCHTIEFE:
                    stapel.append((voll, tiefe + 1))


def gruppen_cpu(pgid):
    """CPU ticks (user+system) used so far by all processes of one process group."""
    summe = 0
    for n in os.listdir("/proc"):
        if not n.isdigit():
            continue
        try:
            with open(f"/proc/{n}/stat") as f:
                rest = f.read().rsplit(")", 1)[1].split()
        except (OSError, IndexError):
            continue
        # rest[0] = state, rest[2] = pgrp, rest[11] = utime, rest[12] = stime
        if int(rest[2]) == pgid:
            summe += int(rest[11]) + int(rest[12])
    return summe


def entdecke(format_, pfad):
    """Run one child, cut at 10 s of no output and no CPU use. Returns (blocks, ausgang) with ausgang in ok|zeit|abgestuerzt|ungueltig|leer."""
    try:
        p = subprocess.Popen(["nice", "-n", "19", discovery_programm(), format_, pfad],
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as exc:  # not the bundle's fault: never blocks it
        raise DiscoveryFehlt(str(exc)) from exc
    fd = p.stdout.fileno()
    start = letzte = time.monotonic()
    puffer, zeit = b"", False
    cpu = 0
    while True:
        jetzt = time.monotonic()
        rest = min(letzte + STILLE_ZEIT, start + GESAMT_ZEIT) - jetzt
        if rest <= 0:
            zeit = True
            break
        bereit, _, _ = select.select([fd], [], [], min(rest, 0.25))
        if not bereit:
            # silent, but a plugin that is busy loading (LSP: 10 s before the first line) is not hung
            neu = gruppen_cpu(p.pid)
            if neu > cpu:
                cpu, letzte = neu, time.monotonic()
            continue
        stueck = os.read(fd, 65536)
        if not stueck:
            break
        puffer += stueck
        letzte = time.monotonic()
    if zeit:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.wait()
    p.stdout.close()
    # the child may have forked helpers into its group (wine): never leave them behind
    try:
        os.killpg(p.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass

    bloecke, aktuell, fehler, leer, unvollstaendig = [], None, False, False, False
    for zeile in puffer.decode("utf-8", "replace").splitlines():
        if not zeile.startswith("carla-discovery::"):
            continue
        teile = zeile.split("::", 2)
        schluessel, wert = teile[1], (teile[2] if len(teile) > 2 else "")
        if schluessel == "init":
            aktuell = {}
        elif schluessel == "end":
            if aktuell is not None:
                bloecke.append(aktuell)
            aktuell = None
        elif schluessel == "error":
            fehler = True
        elif (schluessel == "warning" and "doesn't provide any plugins" in wert) \
                or (schluessel == "info" and wert.startswith("skipping")):
            leer = True  # carla itself says: nothing to list here
        elif aktuell is not None:
            aktuell[schluessel] = wert
    unvollstaendig = aktuell is not None
    if bloecke and not unvollstaendig and not fehler:
        return bloecke, "ok"  # judged by output: a crash or hang at unload after the last end:: does not matter
    if zeit:
        return [], "zeit"
    if p.returncode != 0:
        return [], "abgestuerzt"
    if unvollstaendig or fehler:
        return [], "ungueltig"
    if not bloecke:
        return [], "leer" if leer else "ungueltig"
    return bloecke, "ok"


def zahl(block, schluessel):
    try:
        return int(block.get(schluessel, "0"))
    except ValueError:
        return 0


def art_von(block):
    ein, aus = zahl(block, "audio.ins"), zahl(block, "audio.outs")
    if block.get("category") == "synth" or (ein == 0 and zahl(block, "midi.ins") > 0 and aus > 0):
        return "instrument"
    if ein > 0 and aus > 0:
        return "effekt"
    return "sonst"


def ist_eigen(block, buendel):
    """Own plugin: maker cypher-dj, or living in the own bundle folder. A third party named Cypher... is not."""
    eigener = os.path.realpath(os.path.expanduser(EIGENE_PFADE[0])) + os.sep
    return block.get("maker", "") == "cypher-dj" or os.path.realpath(buendel).startswith(eigener)


def eintrag_aus_block(format_, buendel, block, status="ok", grund=None, text=None):
    label = block.get("label", "")
    if format_ == "lv2":
        pfad, uid = (label.split("/", 1)[1] if "/" in label else label), ""
    else:
        pfad, uid = buendel, label
    e = {"id": plugin_id(format_, pfad, uid), "format": format_, "pfad": pfad, "uid": uid,
         "name": block.get("name", ""), "hersteller": block.get("maker", ""), "art": art_von(block),
         "audio_ein": zahl(block, "audio.ins"), "audio_aus": zahl(block, "audio.outs"),
         "parameter": zahl(block, "parameters.ins"), "status": status}
    if grund:
        e["grund"] = grund
    if text:
        e["text"] = text
    if ist_eigen(block, buendel):
        e["eigen"] = True
    return e


def blockiert_eintrag(format_, buendel, grund):
    name = os.path.basename(buendel.rstrip("/"))
    return {"id": plugin_id(format_, buendel, ""), "format": format_, "pfad": buendel, "uid": "", "name": name,
            "hersteller": "", "art": "sonst", "audio_ein": 0, "audio_aus": 0, "parameter": 0,
            "status": "blockiert", "grund": grund}


def scanne_buendel(format_, buendel):
    """Entries for one bundle, plus whether it is 'leer' (no plugins, nothing to list)."""
    bloecke, ausgang = entdecke(format_, buendel)
    if ausgang == "leer":
        return [], True
    if ausgang != "ok":
        return [blockiert_eintrag(format_, buendel, ausgang)], False
    if format_ == "vst3" and len(bloecke) > 1:
        es = [eintrag_aus_block(format_, buendel, bloecke[0])]
        for b in bloecke[1:]:
            es.append(eintrag_aus_block(format_, buendel, b, "blockiert", "mehrklassen", MEHRKLASSEN_TEXT))
        return es, False
    return [eintrag_aus_block(format_, buendel, b) for b in bloecke], False


def lade_index(pfad):
    try:
        d = json.loads(Path(pfad).read_text())
        if d.get("version") == VERSION:
            return d
    except (OSError, ValueError):
        pass
    return {"version": VERSION, "eintraege": [], "uebersprungen": []}


def schreibe_index(pfad, daten):
    pfad = Path(pfad)
    pfad.parent.mkdir(parents=True, exist_ok=True)
    tmp = pfad.with_name(f".{pfad.name}.{os.getpid()}.tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(daten, f, indent=1, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, pfad)
    finally:
        if tmp.exists():
            tmp.unlink()


def scanne(wurzeln, index_pfad, mit_eigenen=False):
    discovery = pruefe_discovery()
    alt = lade_index(index_pfad)
    wechsel = alt.get("discovery") != discovery  # new program: blocked bundles get one more chance
    # state per bundle path: entries, or a skip record (empty bundle / own bundle)
    alt_eintraege, alt_skip = {}, {}
    for e in alt.get("eintraege", []):
        alt_eintraege.setdefault(e["buendel"], []).append(e)
    for s in alt.get("uebersprungen", []):
        alt_skip[s["buendel"]] = s
    alt_ids = {e["id"] for es in alt_eintraege.values() for e in es}

    neue, skips, geaendert_ids = [], [], set()
    for format_, buendel in finde_buendel(wurzeln):
        mtime, groesse = stat_buendel(buendel)
        vorher = alt_eintraege.get(buendel)
        skip = alt_skip.get(buendel)
        if vorher and vorher[0]["mtime"] == mtime and vorher[0]["groesse"] == groesse \
                and not (wechsel and any(e["status"] == "blockiert" for e in vorher)):
            if mit_eigenen or not any(e.get("eigen") for e in vorher):
                neue.extend(vorher)
                continue
            skips.append({"buendel": buendel, "grund": "eigen", "mtime": mtime, "groesse": groesse})
            continue
        if skip and skip["mtime"] == mtime and skip["groesse"] == groesse \
                and not (skip["grund"] == "eigen" and mit_eigenen):
            skips.append(skip)
            continue
        try:
            es, leer = scanne_buendel(format_, buendel)
        except DiscoveryFehlt:
            raise
        except Exception as exc:  # one broken bundle must not end the scan
            print(f"plugin_scan: {buendel}: {exc}", file=sys.stderr)
            es, leer = [blockiert_eintrag(format_, buendel, "ungueltig")], False
        if leer:
            skips.append({"buendel": buendel, "grund": "leer", "mtime": mtime, "groesse": groesse})
            continue
        if not mit_eigenen and es and any(e.get("eigen") for e in es):
            skips.append({"buendel": buendel, "grund": "eigen", "mtime": mtime, "groesse": groesse})
            continue
        jetzt = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        for e in es:
            e.update({"buendel": buendel, "mtime": mtime, "groesse": groesse, "gescannt": jetzt})
            if vorher:
                geaendert_ids.add(e["id"])
        neue.extend(es)

    neue_ids = {e["id"] for e in neue}
    daten = {"version": VERSION, "discovery": discovery, "eintraege": neue,
             "uebersprungen": skips}
    schreibe_index(index_pfad, daten)
    return {"neu": len(neue_ids - alt_ids), "entfernt": len(alt_ids - neue_ids),
            "geaendert": len(geaendert_ids & alt_ids),
            "blockiert": sum(1 for e in neue if e["status"] == "blockiert")}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pfade", nargs="+", help="directories to search (default: the system and user plugin paths)")
    ap.add_argument("--index", default=STANDARD_INDEX)
    ap.add_argument("--mit-eigenen", action="store_true", help="also scan and list the Cypher-DJ own bundles")
    a = ap.parse_args(argv)
    wurzeln = list(a.pfade or STANDARD_PFADE)
    if a.mit_eigenen:
        wurzeln += EIGENE_PFADE
    try:
        bericht = scanne(wurzeln, os.path.expanduser(a.index), a.mit_eigenen)
    except DiscoveryFehlt as exc:
        print(f"discovery_fehlt: {exc}", file=sys.stderr)
        return 3
    print(json.dumps(bericht))
    return 0


if __name__ == "__main__":
    sys.exit(main())
