"""Bestand neu bewerten: nur die Takt-Eins, nach der Regel von eins.entscheide_eins (Bericht 2026-10-11-grid-phase).

Je Material: beat_this auf dem Original (Downbeats), Karte aus material.json, erster Kick, Entscheidung. Handkorrekturen von
Andreas bleiben UNVERAENDERT: eine Raster-Datei (~/.config/cypherdj/raster, nur gelesen) mit |versatz| >= 1 Beat in irgendeiner
Fassung oder irgendeine Zeile `art=eins` in korrekturen.jsonl. Fuer die uebrigen gilt: nur wo die Regel eine ANDERE Eins ergibt,
steht sie im Ergebnis.

Ohne --schreiben wird nur gemessen und eine Liste (Track, alte Eins, neue Eins, Grund) ausgegeben; nichts im Bestand aendert sich.
Mit --schreiben: erst Sicherung (Index und die Dateien der betroffenen Materialien), dann je geaendertem Material eine Zeile
`art=eins` (von werkstatt) an korrekturen.jsonl und `korrigieren`. ACHTUNG: `korrigieren` legt eine neue Fassung r+1 an und
rechnet dafuer das Audio neu (Warp); die Fassungen sind unveraenderlich (ADR 015), material.json ist versiegelt. Eine Eins ohne
neue Fassung gibt es in der Kette nicht.

Aufruf (aus djk/werkstatt):
  nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.lauf_eins [--nur ID,ID] [--aus DIR] [--roh DATEI] [--schreiben --sicherung DIR]"""
import argparse
import datetime as dt
import json
import shutil
import sqlite3
import sys
from pathlib import Path

import numpy as np

from .audio import lade_mono
from .bestand import fassung_name, fassungen_von, korrektur_anhaengen, lies_json, standard_bestand
from .eins import eins_beat_this, entscheide_eins, erster_kick
from .kette import karte_aus_liste, korrigieren
from .raster_werkzeuge import SR_BEAT_THIS, SR_ESSENTIA, beat_this

BASIS = 128.0
HAND_BEATS = 1.0     # Raster-Datei ab einem ganzen Beat gilt als Eins-Korrektur von Hand
RASTER_ORDNER = Path.home() / ".config" / "cypherdj" / "raster"


def fpb(basis_bpm):
    return 48000 * 60.0 / basis_bpm


def hand_grund(mo, raster_ordner, basis_bpm=BASIS):
    """Grund, warum dieses Material von Hand korrigiert ist (None: nicht). Nur lesen."""
    mid = Path(mo).name
    for z in (json.loads(l) for l in (Path(mo) / "korrekturen.jsonl").read_text().splitlines() if l.strip()) \
            if (Path(mo) / "korrekturen.jsonl").exists() else []:
        if z["art"] == "eins":
            return f"korrekturen.jsonl art=eins ({z['von']}, Lage {z['ab_quell_beat']})"
    for d in sorted(Path(raster_ordner).glob(f"{mid}_*_r*.json")) if Path(raster_ordner).is_dir() else []:
        try:
            v = float(json.loads(d.read_text())["versatz_frames"])
        except (ValueError, KeyError, TypeError, OSError):
            continue
        if abs(v) >= HAND_BEATS * fpb(basis_bpm):
            return f"Raster-Datei {d.name}: {v:+.0f} Frames = {v / fpb(basis_bpm):+.2f} Beats"
    return None


def original_pfad(mo, material):
    return Path(mo) / material["quelle"]["datei"]


def messe_stimmen(mo, material, karte, geraet):
    """beat_this auf dem Original wie die Kette (lade_mono bei 22 050 Hz): (zaehlung je Lage, downbeats, schlaege)."""
    x22 = lade_mono(original_pfad(mo, material), SR_BEAT_THIS)
    schlaege, downbeats = beat_this(x22, geraet=geraet)
    _, zaehlung = eins_beat_this(downbeats, karte)
    return zaehlung, downbeats, schlaege


def messe_kick(mo, material, karte):
    return erster_kick(lade_mono(original_pfad(mo, material), SR_ESSENTIA), SR_ESSENTIA, karte)


def bewerte(mo, raster_ordner, geraet="cpu", roh=None):
    mo = Path(mo)
    mid = mo.name
    material = lies_json(mo / "material.json")
    alt = int(material["raster"]["erste_eins_quell_beat"])
    zeile = {"mid": mid, "titel": material["titel"], "alt": alt, "neu": alt, "aendert": False, "unsicher": None,
             "anteil": None, "zaehlung": None, "kick_lage": None, "quelle": None, "status": None, "grund": ""}
    hand = hand_grund(mo, raster_ordner)
    if hand:
        return {**zeile, "status": "handkorrektur", "grund": hand}
    karte = karte_aus_liste(material["tempo_karte_quelle"], material["raster"]["tempo_vielfaches"])
    if roh is not None and mid in roh:
        zaehlung = roh[mid]["zaehlung"]
    else:
        zaehlung = [int(v) for v in messe_stimmen(mo, material, karte, geraet)[0]]
        if roh is not None:
            roh[mid] = {"zaehlung": zaehlung}
    mehrheit = int(np.argmax(zaehlung)) if sum(zaehlung) > 0 else None
    kick = messe_kick(mo, material, karte)
    e = entscheide_eins(mehrheit, zaehlung, kick)
    return {**zeile, "neu": e["eins"], "aendert": e["eins"] != alt, "unsicher": e["unsicher"], "anteil": e["anteil"],
            "zaehlung": zaehlung, "kick_lage": e["kick_lage"], "quelle": e["quelle"], "mehrheit": mehrheit,
            "status": "geaendert" if e["eins"] != alt else "keine_aenderung",
            "grund": e["grund"] + ("" if e["eins"] == alt else f"; Material hat {alt}")}


def bewerte_bestand(bestand, raster_ordner=RASTER_ORDNER, geraet="cpu", nur=None, roh=None):
    bestand = Path(bestand)
    ids = sorted(p.name for p in bestand.iterdir() if p.is_dir() and (p / "material.json").is_file())
    return [bewerte(bestand / m, raster_ordner, geraet, roh) for m in ids if not nur or m in nur or m[:4] in nur]


def rendere_neu(mid, bestand):
    return korrigieren(mid, bestand)


def sichere_index(bestand, sicherung):
    """Index per sqlite-Backup (konsistent, nur lesend am Original)."""
    sicherung = Path(sicherung)
    sicherung.mkdir(parents=True, exist_ok=True)
    quelle = sqlite3.connect(f"file:{Path(bestand) / 'index.sqlite'}?mode=ro", uri=True)
    ziel = sqlite3.connect(sicherung / "index.sqlite")
    quelle.backup(ziel)
    ziel.close()
    quelle.close()


def sichere(bestand, zeilen, sicherung):
    """Index und je betroffenem Material material.json, korrekturen.jsonl, alle fassung.json."""
    sicherung = Path(sicherung)
    sicherung.mkdir(parents=True, exist_ok=False)
    sichere_index(bestand, sicherung)
    for z in zeilen:
        if not z["aendert"]:
            continue
        mo, so = Path(bestand) / z["mid"], sicherung / z["mid"]
        so.mkdir()
        for n in ("material.json", "korrekturen.jsonl", "tags.json", "eins_bewertung.json"):
            if (mo / n).exists():
                shutil.copy2(mo / n, so / n)
        for _, _, p in fassungen_von(mo):
            (so / "fassungen" / p.name).mkdir(parents=True)
            shutil.copy2(p / "fassung.json", so / "fassungen" / p.name / "fassung.json")


def schreibe_seitendateien(bestand, zeilen, sicherung):
    """„Nur bewerten“ (Review B2): je bewertetem, nicht von Hand korrigiertem Material eine Datei eins_bewertung.json neben
    material.json. Nichts in material.json oder fassung.json (versiegelt, unveraenderlich). Die Seite liest sie fuer
    „downbeat?“; Fassungs-Felder haben Vorrang. Vorher Sicherung des Index nach `sicherung`. Rueckgabe: Zahl der Dateien."""
    bestand = Path(bestand)
    sichere_index(bestand, sicherung)
    n = 0
    zeit = dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    for z in zeilen:
        if z["status"] == "handkorrektur":
            continue
        d = {"schema": 1, "zeit": zeit, "von": "werkstatt/lauf_eins", "eins_material": z["alt"], "eins_vorschlag": z["neu"],
             "unsicher": bool(z["unsicher"]), "anteil": z["anteil"], "quelle": z["quelle"], "kick_lage": z["kick_lage"],
             "zaehlung": z["zaehlung"], "grund": z["grund"]}
        ziel = bestand / z["mid"] / "eins_bewertung.json"
        tmp = ziel.with_suffix(".json.neu")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        tmp.replace(ziel)
        n += 1
    return n


def schreibe(bestand, zeilen, sicherung):
    """Sicherung, dann je geaendertem Material eine Zeile art=eins und korrigieren (rechnet Audio, siehe Kopf)."""
    bestand = Path(bestand)
    sichere(bestand, zeilen, sicherung)
    fertig = []
    for z in zeilen:
        if not z["aendert"]:
            continue
        mo = bestand / z["mid"]
        r = max(r for b, r, _ in fassungen_von(mo) if abs(b - BASIS) < 1e-9)
        korrektur_anhaengen(mo, {"zeit": dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "von": "werkstatt", "art": "eins",
                                 "fassung": fassung_name(BASIS, r), "ab_quell_beat": float(z["neu"]), "bis_quell_beat": None,
                                 "versatz_ms": None, "nr": None, "text": f"Eins {z['alt']} -> {z['neu']}: {z['grund']}"[:300]})
        rendere_neu(z["mid"], bestand)
        fertig.append(z["mid"])
    return fertig


def tabelle(zeilen):
    z = ["| Track | mid | alte Eins | neue Eins | Status | unsicher | Anteil | Zaehlung | Kick | Grund |", "|---|---|---|---|---|---|---|---|---|---|"]
    for r in zeilen:
        z.append(f"| {r['titel'][:40]} | {r['mid'][:8]} | {r['alt']} | {r['neu']} | {r['status']} | "
                 f"{'–' if r['unsicher'] is None else ('ja' if r['unsicher'] else 'nein')} | "
                 f"{'–' if r['anteil'] is None else r['anteil']} | {'–' if r['zaehlung'] is None else r['zaehlung']} | "
                 f"{'–' if r['kick_lage'] is None else r['kick_lage']} | {r['grund']} |")
    return "\n".join(z) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--bestand", type=Path, default=standard_bestand())
    ap.add_argument("--raster", type=Path, default=RASTER_ORDNER)
    ap.add_argument("--nur", default="")
    ap.add_argument("--aus", type=Path, default=None, help="Ordner fuer trockenlauf.json/.md")
    ap.add_argument("--roh", type=Path, default=None, help="Zwischenspeicher der Stimmen (jsonl), spart beat_this beim Wiederholen")
    ap.add_argument("--geraet", default="cpu")
    ap.add_argument("--bewerten", action="store_true", help="nur Seitendateien eins_bewertung.json schreiben (braucht --sicherung)")
    ap.add_argument("--schreiben", action="store_true")
    ap.add_argument("--sicherung", type=Path, default=None)
    a = ap.parse_args(argv)
    import torch
    torch.set_num_threads(2)
    roh = {}
    if a.roh and a.roh.exists():
        roh = {j["mid"]: j for j in (json.loads(l) for l in a.roh.read_text().splitlines() if l.strip())}
    nur = set(filter(None, a.nur.split(",")))
    zeilen = bewerte_bestand(a.bestand, a.raster, a.geraet, nur, roh)
    if a.roh:
        a.roh.parent.mkdir(parents=True, exist_ok=True)
        a.roh.write_text("".join(json.dumps({"mid": m, **v}) + "\n" for m, v in roh.items()))
    print(tabelle(zeilen))
    n = {k: sum(1 for z in zeilen if z["status"] == k) for k in ("handkorrektur", "geaendert", "keine_aenderung")}
    print(f"{len(zeilen)} Materialien: {n['handkorrektur']} Handkorrektur (unveraendert), {n['geaendert']} wuerden sich aendern, "
          f"{n['keine_aenderung']} ohne Aenderung; unsicher: {sum(1 for z in zeilen if z['unsicher'])}")
    if a.aus:
        a.aus.mkdir(parents=True, exist_ok=True)
        (a.aus / "trockenlauf.json").write_text(json.dumps(zeilen, ensure_ascii=False, indent=1))
        (a.aus / "trockenlauf.md").write_text(tabelle(zeilen))
    if a.bewerten:
        if not a.sicherung:
            ap.error("--bewerten braucht --sicherung DIR")
        print("Seitendateien geschrieben:", schreibe_seitendateien(a.bestand, zeilen, a.sicherung))
    if a.schreiben:
        if not a.sicherung:
            ap.error("--schreiben braucht --sicherung DIR")
        print("geschrieben und neu gerendert:", schreibe(a.bestand, zeilen, a.sicherung))
    return 0


if __name__ == "__main__":
    sys.exit(main())
