"""Profile des Prüfstands: ein Prüflauf ist eine TOML-Datei unter djk/pruefstand/profile/ (tomllib, Python 3.12).
`lade` ergänzt Vorgaben, prüft jeden Schlüssel (unbekannte Schlüssel sind ein Fehler, wie §2.1 für kern.toml) und gibt
ein vollständiges dict zurück, das unverändert in lauf.json landet."""
import os
import re
import tomllib

VORGABE = {
    "name": None, "zweck": None, "dauer_s": 60.0, "quantum": 256, "bpm": 128.0, "instanz": "f",
    "quelle": {"art": None, "programm": "", "argumente": [], "neustart": False, "anker": True,
               "spin_alle": 0, "spin_anteil": 0.0, "eigenschaften": []},
    "kern": {"pruefmodus": True, "test_last_alle": 0, "test_last_perioden": 0.0},
    "notbahn": {"an": True, "programm": "notbahn/build/cypherdj-notbahn", "kante": True},   # daneben (ADR 016 Nachtrag)
    "last": {"profil": "", "vorlauf_s": 10.0,
             "demucs_python": os.environ.get("CYPHERDJ_DEMUCS_PYTHON", "")},   # Pflicht nur für Profil p1 (LastP1 meldet es klar)
    "eingriff": [],
    "erwartung": {},
}
PROGRAMM = {"kern": "kern/build/cypherdj-kern", "pruefquelle": "pruefstand/build/cypherdj-pruefquelle",
            "pruefquelle_direkt": "pruefstand/build/cypherdj-pruefquelle"}
EINGRIFF = {"nach_s": None, "art": None, "ziel": None, "halten_s": 0.0}
ERWARTUNG = {"stille_ms_max", "stille_ereignisse_min", "stille_ereignisse_max", "spruenge_je_eingriff_min",
             "eingriffe_mit_sprung_min", "spruenge_max", "raster_versatz_max", "fehlende_klicks_min", "fehlende_klicks_max", "kern_luecken_min", "kern_luecken_max",
             "notbahn_uebernahmen_min", "notbahn_uebernahmen_max", "schleife_in_jedem_eingriff",
             "schleife_abweichung_max", "last_belegt",
             # seit der Notbahn daneben (Plan 16 vom 2026-09-26), nur zusätzlich (E12):
             "stille_bloecke_max", "spins_min", "spin_luecken_abweichung_max", "ziel_luecken_min", "ziel_luecken_max",
             "kern_ziel_luecken_abweichung_max", "rueckgabe_in_jedem_eingriff", "raster_schleife_max"}


class ProfilFehler(ValueError):
    pass


def _mische(vorgabe, wert, pfad):
    if not isinstance(wert, dict):
        raise ProfilFehler(f"{pfad}: Tabelle erwartet")
    unbekannt = set(wert) - set(vorgabe)
    if unbekannt:
        raise ProfilFehler(f"{pfad}: unbekannter Schlüssel {sorted(unbekannt)[0]}")
    out = dict(vorgabe)
    out.update(wert)
    return out


def pruefe(p):
    """Ergänztes, geprüftes Profil; ProfilFehler mit Schlüsselnamen bei jedem Verstoß."""
    top = {k: v for k, v in VORGABE.items() if not isinstance(v, (dict, list))}
    unbekannt = set(p) - set(VORGABE)
    if unbekannt:
        raise ProfilFehler(f"unbekannter Schlüssel {sorted(unbekannt)[0]}")
    out = {k: p.get(k, v) for k, v in top.items()}
    for k in ("quelle", "kern", "notbahn", "last"):
        out[k] = _mische(VORGABE[k], p.get(k, {}), k)
    unbek_erw = set(p.get("erwartung", {})) - ERWARTUNG
    if unbek_erw:
        raise ProfilFehler(f"erwartung: unbekannter Schlüssel {sorted(unbek_erw)[0]}")
    out["erwartung"] = dict(p.get("erwartung", {}))
    out["eingriff"] = [_mische(EINGRIFF, e, f"eingriff[{i}]") for i, e in enumerate(p.get("eingriff", []))]
    if not out["name"] or not re.fullmatch(r"[a-z0-9-]{1,24}", out["name"]):
        raise ProfilFehler("name: [a-z0-9-]{1,24} verlangt")
    if not out["zweck"]:
        raise ProfilFehler("zweck: ein Satz verlangt")
    if out["instanz"] not in list("abcdefghi"):
        raise ProfilFehler("instanz: a bis i (ROADMAP Z2); die Vorgabe-Instanz gehört den Meilenstein-Sitzungen")
    if out["quantum"] not in (128, 256):
        raise ProfilFehler("quantum: 128 oder 256")
    if not 60.0 <= out["bpm"] <= 200.0:
        raise ProfilFehler("bpm: 60 bis 200")
    q = out["quelle"]
    if q["art"] not in PROGRAMM:
        raise ProfilFehler(f"quelle.art: eins von {sorted(PROGRAMM)}")
    if not q["programm"]:
        q["programm"] = PROGRAMM[q["art"]]
    for e in q["eigenschaften"]:
        if not re.fullmatch(r"[A-Za-z]+=\S+", str(e)):
            raise ProfilFehler(f"quelle.eigenschaften: Form Schlüssel=Wert verlangt, nicht {e!r}")
    if q["art"] == "pruefquelle_direkt" and out["notbahn"]["an"]:
        raise ProfilFehler("notbahn.an: bei pruefquelle_direkt spielt die Quelle selbst an die Senke, Notbahn aus")
    k = out["kern"]
    if (k["test_last_alle"] or k["test_last_perioden"]) and (q["art"] != "kern" or not k["pruefmodus"]
                                                            or k["test_last_alle"] < 1 or k["test_last_perioden"] <= 0):
        raise ProfilFehler("kern.test_last_*: nur bei quelle.art = kern mit Prüfmodus, alle >= 1 und perioden > 0")
    if out["last"]["profil"] not in ("", "p1"):
        raise ProfilFehler("last.profil: \"\" oder \"p1\"")
    for i, e in enumerate(out["eingriff"]):
        if e["art"] not in ("kill9", "sigstop"):
            raise ProfilFehler(f"eingriff[{i}].art: kill9 oder sigstop")
        if not (e["ziel"] in ("quelle", "notbahn") or re.fullmatch(r"(unit:[A-Za-z0-9@_.-]+|pid:\d+)", str(e["ziel"]))):
            raise ProfilFehler(f"eingriff[{i}].ziel: quelle, notbahn, unit:<name> oder pid:<n>")
        if e["nach_s"] is None or not 0 < e["nach_s"] < out["dauer_s"]:
            raise ProfilFehler(f"eingriff[{i}].nach_s: innerhalb der Aufnahme")
        if e["art"] == "sigstop" and e["halten_s"] <= 0:
            raise ProfilFehler(f"eingriff[{i}].halten_s: > 0 bei sigstop")
    zeiten = [e["nach_s"] for e in out["eingriff"]]
    if zeiten != sorted(zeiten):
        raise ProfilFehler("eingriff: nach Zeit ordnen")
    return out


def lade(pfad, kurz_s=None):
    """Profil aus einer TOML-Datei. `kurz_s`: Probelauf mit dieser Dauer, Name mit Endung -kurz (die Abnahme zählt ihn
    nicht); Eingriffe nach dem Ende fallen weg."""
    with open(pfad, "rb") as f:
        roh = tomllib.load(f)
    if kurz_s is not None:
        roh["dauer_s"] = float(kurz_s)
        roh["name"] = f"{roh.get('name', '')}-kurz"
        roh["eingriff"] = [e for e in roh.get("eingriff", []) if e.get("nach_s", 0) < kurz_s - 2.0]
    return pruefe(roh)
