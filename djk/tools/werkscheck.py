#!/usr/bin/env python3
"""Factory sound check (gate 8): every factory preset and every device is rendered offline and measured.

    werkscheck.py [--nur modular|effekte|geraete] [--ausgabe DIR]

Folders: `modular` = the 165 Cypher Modular presets, `effekte` = the comp, eq, sat and reverb presets plus the rb338 presets
(everything that goes through the project render), `geraete` = the 72 devices of geraete.json. No flag runs all three.

Two ways to a sound, both offline, never against a running instance:
  klang_pruefung   Cypher Modular instrument graphs (preset and device), named phrase, WAV measured here
  projekt          render_preset.mjs: the one-track project the page's preview builds, raw render (before the preview's normalisation)
Thresholds (plan "Globale Vorgaben"): silent = peak below -60 dBFS; clipping = any |x| >= 1.0; DC = |mean| above 0.01 on a channel;
NaN = any NaN or Inf sample. A red row is not changed here; skips are listed with their reason and are not red.
Exit code: 0 all fine, 1 at least one red row, 77 cargo or cypherdj-render missing.
"""
import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SR = 48000
STUMM_DB = -60.0
DC_MAX = 0.01
HIER = Path(__file__).resolve().parent
REPO = HIER.parent.parent
FABRIK = REPO / "djk/ui/presets/factory"
MODULAR_DIR = REPO / "djk/instruments/modular_dsp"
DEMOS = MODULAR_DIR / "demos"
GERAETE = MODULAR_DIR / "geraete.json"
RENDER_PRESET = HIER / "tour" / "render_preset.mjs"
ORDNER = ["comp", "eq", "modular", "rb338", "reverb", "sat", "geraete"]
SKIP_EXIT = 3          # render_preset.mjs: this preset cannot be placed by the project render

ROLLE_PHRASE = {"bass": "bass", "lead": "lead", "pad": "chord", "keys": "chord", "pluck": "lead", "drums": "kit",
                "percussion": "perc", "fx": "held", "delay": "held", "reverb": "held"}
FAMILIE_PHRASE = {"drums": "kit", "mono": "bass", "neuro": "bass", "poly": "chord", "fx": "held"}
RETTUNG_PHRASEN = ["lead", "held", "perc", "bass"]    # tried in turn when the first phrase renders silence (note range, not the sound)


# ---------------------------------------------------------------- measurement

def lies_wav(pfad) -> np.ndarray:
    """RIFF WAV (32-bit float or 16-bit PCM) as float32 array (frames, channels). ValueError when it is anything else."""
    b = Path(pfad).read_bytes()
    if len(b) < 12 or b[:4] != b"RIFF" or b[8:12] != b"WAVE":
        raise ValueError("no RIFF/WAVE")
    fmt = None
    o = 12
    while o + 8 <= len(b):
        cid, n = b[o:o + 4], struct.unpack("<I", b[o + 4:o + 8])[0]
        k = o + 8
        if cid == b"fmt " and k + 16 <= len(b):
            tag, kan, _rate, _, _, bits = struct.unpack("<HHIIHH", b[k:k + 16])
            fmt = (tag, kan, bits)
        elif cid == b"data":
            if fmt is None:
                raise ValueError("data before fmt")
            tag, kan, bits = fmt
            d = b[k:k + min(n, len(b) - k)]
            if tag in (3, 0xFFFE) and bits == 32:
                a = np.frombuffer(d[: len(d) // 4 * 4], dtype="<f4").astype("float32")
            elif tag == 1 and bits == 16:
                a = np.frombuffer(d[: len(d) // 2 * 2], dtype="<i2").astype("float32") / 32768.0
            else:
                raise ValueError(f"format {tag}/{bits}")
            kan = max(1, kan)
            return a[: len(a) // kan * kan].reshape(-1, kan)
        o = k + n + (n % 2)
    raise ValueError("no data chunk")


def _db(x: float) -> float:
    return float(20 * np.log10(max(x, 1e-10)))


def messe_datei(pfad) -> dict:
    """Raw measurement of a render. Missing or unreadable files come back as a dict `urteil` turns red."""
    p = Path(pfad)
    if not p.exists():
        return {"fehlt": True}
    try:
        x = lies_wav(p)
    except (ValueError, OSError, struct.error):
        return {"unlesbar": True}
    if x.size == 0:
        return {"unlesbar": True}
    endlich = np.isfinite(x)
    nan = bool((~endlich).any())
    y = np.where(endlich, x, 0.0).astype("float64")
    spitze = float(np.abs(y).max())
    rms = float(np.sqrt((y ** 2).mean()))
    dcs = y.mean(axis=0)
    dc = float(dcs[np.argmax(np.abs(dcs))])
    return {"spitze_db": round(_db(spitze), 2), "rms_db": round(_db(rms), 2), "dc": round(dc, 5), "nan": nan,
            "still": _db(spitze) < STUMM_DB, "uebersteuert": bool((np.abs(y) >= 1.0).any()), "dauer_s": round(len(x) / SR, 3)}


def dc_eingang(pfad) -> float:
    """Largest |mean| of any channel in any whole second of a file (0.0 for a file that cannot be read): the DC an effect starts from."""
    try:
        x = lies_wav(pfad).astype("float64")
    except (ValueError, OSError, struct.error):
        return 0.0
    n = len(x) // SR
    if n == 0:
        return float(np.abs(x.mean(axis=0)).max()) if len(x) else 0.0
    return float(max(np.abs(x[i * SR:(i + 1) * SR].mean(axis=0)).max() for i in range(n)))


def urteil(m: dict, eingang_dc: float = 0.0):
    """('gruen' | 'rot', reasons). DC is red only when the output's DC exceeds the threshold AND the DC the input already carried."""
    if m.get("fehlt"):
        return "rot", ["fehlt"]
    if m.get("unlesbar"):
        return "rot", ["unlesbar"]
    g = []
    if m["nan"]:
        g.append("nan")
    if m["still"]:
        g.append("still")
    if m["uebersteuert"]:
        g.append("uebersteuert")
    if abs(m["dc"]) > DC_MAX and abs(m["dc"]) > eingang_dc:
        g.append("dc")
    return ("rot" if g else "gruen"), g


def mit_rohspitze(m: dict, r: dict) -> dict:
    """klang_pruefung writes its WAV clamped to +-1 as 16 bit, so clipping cannot show in that file. Its JSON `peak_db` is the raw peak:
    it replaces the file's peak, and a raw peak at or above 0 dBFS counts as clipping (|x| >= 1.0)."""
    p = r.get("peak_db")
    if "spitze_db" in m and isinstance(p, (int, float)):
        m["spitze_db"] = round(float(p), 2)
        if p >= 0.0:
            m["uebersteuert"] = True
    return m


def mit_maximaler_rohspitze(m: dict, spitzen: dict) -> dict:
    """The clipping verdict of a melodic instrument looks at the loudest of all phrases, not only at its role phrase.
    `spitzen` maps phrase to raw peak_db. The report peak becomes the maximum; at or above 0 dBFS it is clipping, and the phrase is named."""
    if "spitze_db" not in m or not spitzen:
        return m
    ph = max(spitzen, key=spitzen.get)
    if spitzen[ph] > m["spitze_db"]:
        m["spitze_db"] = round(float(spitzen[ph]), 2)
    if spitzen[ph] >= 0.0:
        m["uebersteuert"] = True
        m["spitzen_phrase"] = ph
    return m


def erzeuge_eingang(pfad) -> None:
    """The input of an effect render: 1 s pink noise, 1 s sine sweep 50 Hz to 10 kHz (both peak -12 dBFS), 1 s silence for the tail.
    32-bit float stereo 48 kHz, the layout `leseStarterWav` of the preview accepts."""
    amp = 10 ** (-12 / 20)
    rng = np.random.default_rng(1)
    n = SR
    rosa = []
    for _ in range(2):
        w = rng.standard_normal(n)
        s = np.fft.rfft(w)
        f = np.fft.rfftfreq(n, 1 / SR)
        f[0] = f[1]
        s = s / np.sqrt(f)
        s[f < 10.0] = 0.0          # DC-free: nothing below 10 Hz (a 1 s block has its mean in bin 0), no offset for a saturator to amplify
        rosa.append(np.fft.irfft(s, n))
    rosa = np.stack(rosa, axis=1)
    rosa[:, :] -= rosa.mean(axis=0)
    rosa = rosa / np.abs(rosa).max() * amp
    t = np.arange(n) / SR
    k = np.log(10000 / 50)
    sweep = np.sin(2 * np.pi * 50 * (np.exp(k * t) - 1) / k)
    sweep = (sweep - sweep.mean()) * amp / np.abs(sweep - sweep.mean()).max()      # a sweep does not end on a whole cycle: take its mean out
    sweep = np.stack([sweep, sweep], axis=1)
    x = np.concatenate([rosa, sweep, np.zeros((n, 2))]).astype("<f4")
    d = x.tobytes()
    kopf = b"RIFF" + struct.pack("<I", 36 + len(d)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, SR, SR * 8, 8, 32)
    Path(pfad).write_bytes(kopf + b"data" + struct.pack("<I", len(d)) + d)


# ---------------------------------------------------------------- manifests

def _graph_datei(demos: Path, name: str):
    """The name klang_pruefung resolves under demos/ (without .json), or None."""
    for rel in (name, f"recipes/{name}"):
        if (demos / f"{rel}.json").exists():
            return rel
    return None


def _ist_effekt(demos: Path, rel):
    if rel is None:
        return False
    try:
        return any(k.get("art") == "eingang" for k in json.loads((demos / f"{rel}.json").read_text())["knoten"])
    except (OSError, ValueError, KeyError, TypeError):
        return False


def manifest_modular(preset_ordner, demos) -> list:
    """One entry per Cypher Modular preset file, sorted by file name."""
    demos = Path(demos)
    aus = []
    for f in sorted(Path(preset_ordner).glob("*.preset.json")):
        j = json.loads(f.read_text())
        slug = f.name[: -len(".preset.json")]
        rel = _graph_datei(demos, j.get("graph", ""))
        knoepfe = {}
        for k, v in (j.get("werte") or {}).items():
            if k.startswith("knob") and k[4:].isdigit():
                knoepfe[k[4:]] = v
        rolle = (j.get("beschreibung") or {}).get("art")
        e = {"id": f"werk:{j['geraet']}/{slug}", "ordner": "modular", "art": j.get("geraet_typ", "instrument"), "graph": j.get("graph"),
             "graph_datei": rel, "knoepfe": knoepfe, "stifte": j.get("stifte") or None, "phrase": ROLLE_PHRASE.get(rolle, "lead"),
             "effekt": _ist_effekt(demos, rel), "grund": ""}
        if rel is None:
            e["grund"] = f"graph '{j.get('graph')}' not found under demos/"
        aus.append(e)
    return aus


def manifest_geraete(geraete_json, demos) -> list:
    """One entry per device. bk devices: klang_pruefung (instrument graph) or projekt (effect graph); rb338: projekt; the rest: skip."""
    demos = Path(demos)
    aus = []
    for d in json.loads(Path(geraete_json).read_text()):
        n, art = d["name"], d.get("art")
        e = {"id": n, "ordner": "geraete", "art": art, "graph": n, "graph_datei": None, "knoepfe": {}, "stifte": None,
             "phrase": FAMILIE_PHRASE.get(d.get("familie"), "lead"), "effekt": False, "weg": "skip", "grund": ""}
        if art == "bk":
            rel = _graph_datei(demos, n)
            e["graph_datei"] = rel
            e["effekt"] = _ist_effekt(demos, rel)
            e["weg"] = "projekt" if e["effekt"] else "klang_pruefung"
            if rel is None:
                e["grund"] = f"graph '{n}' not found under demos/"
        elif art == "rb338":
            e["weg"] = "projekt"
        else:
            e["grund"] = "third-party plugin, not part of the factory sound"
        aus.append(e)
    return aus


# ---------------------------------------------------------------- running

def _zeile(e, weg, m, grund_zusatz="", eingang_dc=0.0):
    u, g = urteil(m, eingang_dc)
    if "fehlt" in m or "unlesbar" in m:
        g = []                 # the extra text says why; "unlesbar" alone would hide it
    gr = ", ".join(g + ([grund_zusatz] if grund_zusatz else []))
    return {"id": e["id"], "ordner": e["ordner"], "art": e["art"], "weg": weg, "urteil": u, "spitze_db": m.get("spitze_db"),
            "rms_db": m.get("rms_db"), "dc": m.get("dc"), "nan": m.get("nan"), "still": m.get("still"), "grund": gr}


def _skip(e, grund):
    return {"id": e["id"], "ordner": e["ordner"], "art": e["art"], "weg": "skip", "urteil": "skip", "spitze_db": None, "rms_db": None,
            "dc": None, "nan": None, "still": None, "grund": grund}


def _sicher(id_):
    return id_.replace(":", "_").replace("/", "_")


def _behalte_wav(quelle: Path, ausgabe: Path, id_):
    d = ausgabe / "wav"
    d.mkdir(parents=True, exist_ok=True)
    shutil.copy2(quelle, d / f"{_sicher(id_)}.wav")


def _klang_pruefung(binar: Path, faelle: list, phrase_je_fall: dict, tmp: Path, wurzel: Path) -> dict:
    """Runs klang_pruefung over the cases (own process, sequential renders); returns {name: result dict or None}. A crash is retried case by case."""
    def lauf(teil):
        man = tmp / "manifest.json"
        aus = tmp / "out.json"
        man.write_text(json.dumps([{"name": _sicher(e["id"]), "graph": e["graph_datei"], "knoepfe": e["knoepfe"], "stifte": e["stifte"],
                                    "phrase": phrase_je_fall[e["id"]], "wurzel": str(wurzel)} for e in teil]))
        aus.unlink(missing_ok=True)
        r = subprocess.run([str(binar), str(man), str(aus), "--wav", str(tmp)], capture_output=True, text=True, timeout=900)
        if r.returncode != 0 or not aus.exists():
            fehl = r.stderr or ""
            z = fehl.splitlines()
            for i, l in enumerate(z):          # the panic message is the line after "panicked at"
                if "panicked at" in l and i + 1 < len(z):
                    fehl = z[i + 1]
                    break
            return None, fehl[-300:]
        j = json.loads(aus.read_text())
        liste = j if isinstance(j, list) else j.get("faelle", list(j.values()))
        return {x["name"]: x for x in liste}, ""
    erg = {}
    for i in range(0, len(faelle), 20):
        teil = faelle[i:i + 20]
        res, fehler = lauf(teil)
        if res is None:
            res = {}
            for e in teil:
                r1, f1 = lauf([e])
                res.update(r1 if r1 else {_sicher(e["id"]): {"abgestuerzt": f1.strip().splitlines()[-1] if f1.strip() else "crash"}})
        for e in teil:
            n = _sicher(e["id"])
            erg[n] = res.get(n)
            # measure now, the next chunk reuses the folder names
            w = tmp / f"{n}.wav"
            if isinstance(erg[n], dict) and "abgestuerzt" not in erg[n]:
                erg[n]["_mass"] = messe_datei(w)
                if w.exists():
                    erg[n]["_wav"] = tmp / f"{n}.keep.wav"
                    w.replace(erg[n]["_wav"])
    return erg


ALLE_PHRASEN = ["bass", "lead", "chord", "held", "perc", "kit"]


def laufe_klang(binar: Path, eintraege: list, ausgabe: Path, wurzel: Path, alle_phrasen: bool = False) -> list:
    """alle_phrasen: the clipping verdict also takes the raw peak of every phrase in ALLE_PHRASEN (the sound verdict stays on the role phrase)."""
    zeilen = []
    tmp = Path(tempfile.mkdtemp(prefix="werkscheck-", dir=ausgabe))
    try:
        offen = {e["id"]: e for e in eintraege}
        spitzen, fertig, ausfaelle = {}, {}, {}
        phrase = {e["id"]: e["phrase"] for e in eintraege}
        versuche = {e["id"]: [e["phrase"]] for e in eintraege}
        for runde in range(1 + len(RETTUNG_PHRASEN)):
            if not offen:
                break
            erg = _klang_pruefung(binar, list(offen.values()), phrase, tmp, wurzel)
            weiter = {}
            for id_, e in offen.items():
                r = erg.get(_sicher(id_))
                if r is None or "abgestuerzt" in r:
                    zeilen.append(_zeile(e, "klang_pruefung", {"unlesbar": True}, "klang_pruefung failed: " + (r or {}).get("abgestuerzt", "no result")))
                    continue
                m = mit_rohspitze(r["_mass"], r)
                if r.get("nicht_endlich", 0) and "nan" in m:
                    m["nan"] = True      # the engine counted non-finite samples before its guard rescued them
                u, _ = urteil(m)
                if m.get("still") and runde < len(RETTUNG_PHRASEN):
                    nxt = [p for p in RETTUNG_PHRASEN if p not in versuche[id_]]
                    if nxt:
                        versuche[id_].append(nxt[0])
                        phrase[id_] = nxt[0]
                        weiter[id_] = e
                        continue
                if alle_phrasen:
                    spitzen[id_] = {phrase[id_]: r["peak_db"]} if isinstance(r.get("peak_db"), (int, float)) else {}
                    fertig[id_] = (e, m, f"phrase {versuche[id_][-1]}" if len(versuche[id_]) > 1 else "")
                    if u == "rot" and r.get("_wav"):
                        _behalte_wav(r["_wav"], ausgabe, e["id"])
                    continue
                z = _zeile(e, "klang_pruefung", m, f"phrase {versuche[id_][-1]}" if len(versuche[id_]) > 1 or u == "rot" else "")
                if u == "rot" and r.get("_wav"):
                    _behalte_wav(r["_wav"], ausgabe, e["id"])
                zeilen.append(z)
            for r in erg.values():
                if isinstance(r, dict) and r.get("_wav"):
                    Path(r["_wav"]).unlink(missing_ok=True)
            offen = weiter
        if alle_phrasen and fertig:
            for ph in ALLE_PHRASEN:
                rest = [e for e, _, _ in fertig.values() if ph not in spitzen[e["id"]]]
                if not rest:
                    continue
                erg = _klang_pruefung(binar, rest, {e["id"]: ph for e in rest}, tmp, wurzel)
                for e in rest:
                    r = erg.get(_sicher(e["id"]))
                    if isinstance(r, dict) and isinstance(r.get("peak_db"), (int, float)) and "abgestuerzt" not in r:
                        spitzen[e["id"]][ph] = r["peak_db"]
                    else:
                        ursache = (r or {}).get("abgestuerzt", "no result") if isinstance(r, dict) or r is None else "no result"
                        ausfaelle.setdefault(e["id"], []).append(f"phrase {ph}: {ursache}")
                for r in erg.values():
                    if isinstance(r, dict) and r.get("_wav"):
                        Path(r["_wav"]).unlink(missing_ok=True)
            for id_, (e, m, zusatz) in fertig.items():
                m = mit_maximaler_rohspitze(m, spitzen[id_])
                if id_ in ausfaelle:        # a phrase that did not render is not "no peak": the maximum is unknown, so the row is red
                    m = dict(m, unlesbar=True)
                    zeilen.append(_zeile(e, "klang_pruefung", m, "klang_pruefung failed: " + "; ".join(ausfaelle[id_])))
                    continue
                u, _ = urteil(m)
                if m.get("spitzen_phrase"):
                    zusatz = ", ".join(x for x in [zusatz, f"clips on phrase {m['spitzen_phrase']} ({spitzen[id_][m['spitzen_phrase']]:+.2f} dBFS)"] if x)
                elif u == "rot" and not zusatz:
                    zusatz = f"phrase {phrase[id_]}"
                zeilen.append(_zeile(e, "klang_pruefung", m, zusatz))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return zeilen


def laufe_projekt(eintrag: dict, ausgabe: Path, eingang: Path, graphordner: Path, eingang_dc: float = 0.0, werk: Path = FABRIK) -> dict:
    """One render_preset.mjs call; the WAV is kept only for a red row."""
    wav = ausgabe / f".roh-{_sicher(eintrag['id'])}.wav"
    cmd = ["node", str(RENDER_PRESET), "--aus", str(wav), "--graphordner", str(graphordner)]
    if eintrag["ordner"] == "geraete":
        cmd += ["--geraet", "rb338"] if eintrag["art"] == "rb338" else ["--graph", eintrag["graph"]]
    else:
        cmd += ["--preset", eintrag["id"], "--werk", str(werk)]      # the presets come from the folder under test, not from this checkout
    mit_eingang = bool(eintrag.get("effekt")) or eintrag["ordner"] in ("comp", "eq", "sat", "reverb")
    if mit_eingang:
        cmd += ["--eingang", str(eingang)]
    dc0 = eingang_dc if mit_eingang else 0.0
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, cwd=str(REPO / "djk/ui"))
    except subprocess.TimeoutExpired:
        wav.unlink(missing_ok=True)
        return _zeile(eintrag, "projekt", {"unlesbar": True}, "render timed out")
    try:
        if r.returncode == SKIP_EXIT:
            return _skip(eintrag, (r.stdout.strip().splitlines() or ["cannot be placed"])[-1][:200])
        if r.returncode != 0:
            return _zeile(eintrag, "projekt", {"unlesbar": True}, "render_preset failed: " + ((r.stderr.strip().splitlines() or ["?"])[-1])[:200])
        m = messe_datei(wav)
        z = _zeile(eintrag, "projekt", m, "", dc0)
        if z["urteil"] == "rot" and wav.exists():
            _behalte_wav(wav, ausgabe, eintrag["id"])
        return z
    finally:
        wav.unlink(missing_ok=True)


def preset_eintraege(ordner: str, fabrik=FABRIK) -> list:
    """Entries of the project-render folders (comp, eq, sat, reverb, rb338)."""
    aus = []
    for f in sorted((Path(fabrik) / ordner).glob("*.preset.json")):
        j = json.loads(f.read_text())
        aus.append({"id": f"werk:{j['geraet']}/{f.name[:-len('.preset.json')]}", "ordner": ordner, "art": j.get("geraet_typ", ""),
                    "graph": None, "knoepfe": {}, "stifte": None, "phrase": "", "effekt": j.get("geraet_typ") == "effekt"})
    return aus


# ---------------------------------------------------------------- report

def schreibe_bericht(ausgabe, zeilen: list, notizen: list, eingang_dc=None, quellen=None) -> None:
    ausgabe = Path(ausgabe)
    ausgabe.mkdir(parents=True, exist_ok=True)
    zahlen = {}
    for z in zeilen:
        c = zahlen.setdefault(z["ordner"], {"gesamt": 0, "gruen": 0, "rot": 0, "skip": 0})
        c["gesamt"] += 1
        c[z["urteil"]] += 1
    rot = [z for z in zeilen if z["urteil"] == "rot"]
    skip = [z for z in zeilen if z["urteil"] == "skip"]
    (ausgabe / "bericht.json").write_text(json.dumps({"zahlen": zahlen, "eingang_dc": eingang_dc, "quellen": quellen, "zeilen": zeilen, "notizen": notizen}, indent=1))
    f = lambda v: "-" if v is None else v  # noqa: E731
    md = ["# Factory sound check", "", f"{len(zeilen)} rows, {len(rot)} red, {len(skip)} skipped.", "",
          *([f"Preset folder: {quellen['presets']}  ", f"Demos folder: {quellen['demos']}  ", f"Devices file: {quellen['devices']}", ""] if quellen else []),
          *([f"Input DC (effect input, largest |mean| per channel and second): {eingang_dc:.2e}. A DC row is red only when the output exceeds {DC_MAX} and this value.", ""] if eingang_dc is not None else []), "| folder | total | green | red | skip |", "|---|---|---|---|---|"]
    for o in ORDNER:
        if o in zahlen:
            c = zahlen[o]
            md.append(f"| {o} | {c['gesamt']} | {c['gruen']} | {c['rot']} | {c['skip']} |")
    md += ["", "## Red", ""]
    md += ["| id | peak dB | rms dB | dc | reason |", "|---|---|---|---|---|"] if rot else ["none"]
    for z in rot:
        md.append(f"| {z['id']} | {f(z['spitze_db'])} | {f(z['rms_db'])} | {f(z['dc'])} | {z['grund']} |")
    md += ["", "## Skipped (not red)", ""]
    md += ["| id | reason |", "|---|---|"] if skip else ["none"]
    for z in skip:
        md.append(f"| {z['id']} | {z['grund']} |")
    gruen = [z["id"] for z in zeilen if z["urteil"] == "gruen"]
    md += ["", "## Green", "", ", ".join(gruen) if gruen else "none"]
    if notizen:
        md += ["", "## Notes", ""] + [f"- {n}" for n in notizen]
    (ausgabe / "bericht.md").write_text("\n".join(md) + "\n")


def exitcode(zeilen: list, werkzeug_fehlt: bool) -> int:
    if werkzeug_fehlt:
        return 77
    return 1 if any(z["urteil"] == "rot" for z in zeilen) else 0


def render_programm() -> Path:
    return Path(os.environ.get("CYPHERDJ_RENDER") or REPO / "djk/core/build/cypherdj-render")


def baue_beispiele() -> Path:
    """Builds the klang_pruefung and erzeuge_probe examples; returns the folder holding both binaries."""
    r = subprocess.run(["cargo", "build", "--release", "--example", "klang_pruefung", "--example", "erzeuge_probe"], cwd=str(MODULAR_DIR),
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-500:])
    return Path(os.environ.get("CARGO_TARGET_DIR") or MODULAR_DIR / "target") / "release/examples"


def erzeuge_proben(beispiele: Path, ziel: Path) -> None:
    """The sample root the sampler and amiga graphs read: the generated samples plus the amiga factory bank (what the page's graph install writes)."""
    ziel.mkdir(parents=True, exist_ok=True)
    for cmd in ([str(beispiele / "erzeuge_probe"), str(ziel)], [sys.executable, str(MODULAR_DIR / "build_amiga_samples.py"), str(ziel)]):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"sample generation failed: {r.stderr[-300:]}")


def layout_zu_presets(fabrik):
    """(demos folder, devices file) of the checkout a preset folder belongs to. The folder must be `<repo>/djk/ui/presets/factory`
    of a checkout that has `djk/instruments/modular_dsp/{demos,geraete.json}`; anything else raises ValueError (no silent mixing
    of presets from one checkout with graphs or devices from another)."""
    fabrik = Path(fabrik).resolve()
    if fabrik == FABRIK.resolve():
        return DEMOS, GERAETE
    if fabrik.parts[-4:] != ("djk", "ui", "presets", "factory"):
        raise ValueError(f"--presets {fabrik}: not a <repo>/djk/ui/presets/factory folder")
    repo = fabrik.parents[3]
    dsp = repo / "djk/instruments/modular_dsp"
    for n, ok in (("demos/", (dsp / "demos").is_dir()), ("geraete.json", (dsp / "geraete.json").is_file())):
        if not ok:
            raise ValueError(f"--presets {fabrik}: checkout {repo} has no {dsp / n}")
    return dsp / "demos", dsp / "geraete.json"


def graph_fuer_binar(rel, demos):
    """klang_pruefung opens `<its own checkout>/demos/<graph>.json`; a graph of another checkout is named by a relative path from there."""
    if rel is None or Path(demos).resolve() == DEMOS.resolve():
        return rel
    return os.path.relpath(Path(demos) / rel, DEMOS)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--nur", choices=["modular", "effekte", "geraete"])
    ap.add_argument("--presets", default=str(FABRIK), help="preset folder to check (default: this checkout's factory presets), e.g. another worktree's djk/ui/presets/factory")
    ap.add_argument("--ausgabe", default=str(Path.home() / "messungen/2026-11-23-tour/werkscheck"))
    a = ap.parse_args(argv)
    fabrik = Path(a.presets).resolve()
    try:
        demos, geraete_json = layout_zu_presets(fabrik)
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    if not list((fabrik / "modular").glob("*.preset.json")):
        print(f"error: --presets {fabrik}: no modular presets found", file=sys.stderr)
        return 2
    ausgabe = Path(a.ausgabe)
    ausgabe.mkdir(parents=True, exist_ok=True)
    if not shutil.which("cargo") or not render_programm().exists():
        print("cargo or cypherdj-render missing", file=sys.stderr)
        return 77
    beispiele = baue_beispiele()
    binar = beispiele / "klang_pruefung"
    eingang = ausgabe / "eingang.wav"
    erzeuge_eingang(eingang)
    eing_dc = dc_eingang(eingang)
    # one folder with every graph the presets and devices name, flat, for the project render (CYPHERDJ_BK_ORDNER)
    graphordner = Path(tempfile.mkdtemp(prefix="werkscheck-graphen-", dir=ausgabe))
    for q in list(demos.glob("*.json")) + list((demos / "recipes").glob("*.json")):
        (graphordner / q.name).symlink_to(q)
    proben = graphordner / "samples"
    erzeuge_proben(beispiele, proben)
    zeilen, notizen = [], []
    try:
        if a.nur in (None, "modular"):
            m = manifest_modular(fabrik / "modular", demos)
            for e in m:
                e["graph_datei"] = graph_fuer_binar(e["graph_datei"], demos)
            klang = [e for e in m if not e["effekt"] and e["graph_datei"]]
            zeilen += laufe_klang(binar, klang, ausgabe, proben, alle_phrasen=True)
            for e in m:
                if e["effekt"]:
                    zeilen.append(laufe_projekt(e, ausgabe, eingang, graphordner, eing_dc, fabrik))
                elif not e["graph_datei"]:
                    zeilen.append(_zeile(e, "skip", {"fehlt": True}, e["grund"]))
        if a.nur in (None, "effekte"):
            for o in ["comp", "eq", "sat", "reverb", "rb338"]:
                for e in preset_eintraege(o, fabrik):
                    zeilen.append(laufe_projekt(e, ausgabe, eingang, graphordner, eing_dc, fabrik))
        if a.nur in (None, "geraete"):
            g = manifest_geraete(geraete_json, demos)
            for e in g:
                e["graph_datei"] = graph_fuer_binar(e["graph_datei"], demos)
            klang = [e for e in g if e["weg"] == "klang_pruefung" and e["graph_datei"]]
            zeilen += laufe_klang(binar, klang, ausgabe, proben, alle_phrasen=True)
            for e in g:
                if e["weg"] == "skip":
                    zeilen.append(_skip(e, e["grund"]))
                elif e["weg"] == "projekt":
                    zeilen.append(laufe_projekt(e, ausgabe, eingang, graphordner, eing_dc, fabrik))
                elif not e["graph_datei"]:
                    zeilen.append(_zeile(e, "klang_pruefung", {"fehlt": True}, e["grund"]))
    finally:
        shutil.rmtree(graphordner, ignore_errors=True)
    if a.nur is None:
        notizen.append(f"rows: {len(zeilen)} (expected 285 = 213 presets + 72 devices)")
    if not zeilen:
        print("error: 0 rows checked", file=sys.stderr)
        return 2
    schreibe_bericht(ausgabe, zeilen, notizen, eing_dc, {"presets": str(fabrik), "demos": str(demos), "devices": str(geraete_json)})
    print(f"{len(zeilen)} rows, {sum(z['urteil'] == 'rot' for z in zeilen)} red, {sum(z['urteil'] == 'skip' for z in zeilen)} skipped; report in {ausgabe}")
    return exitcode(zeilen, False)


if __name__ == "__main__":
    sys.exit(main())
