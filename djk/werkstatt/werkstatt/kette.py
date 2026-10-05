"""Werkstatt-Kette, Teil 2 (Scheibe 15): aus einer Quelldatei ein Material im Bestand mit Fassung r1 auf der
Set-Basis; `korrigieren` legt r+1 daneben (SCHNITTSTELLEN §12.1, §12.3, §13; ADR 011 Entscheidung 2, ADR 015).

Reihenfolge je Song: Original sichern, dekodieren (48 kHz Stereo Float), Lautheit der Quelle, Raster (Scheibe 05:
beat_this, Essentia, Tempo-Wahl, Takt-Eins; Pulsklarheit aus proben/07 c_drift.json, sonst null), Stimmung und
Tonart (zwei Werkzeuge), material.json (Schema), dann `rendere`: -12 dB Luft, Warp per Timemap mit
Stimmungskorrektur, basis.f32, Lautheit der Fassung, vorlaeufige Tore, fassung.json (Schema), versiegeln,
veroeffentlichen, Index. Stems, Fingerabdruck, Kreuzenergien, Referenz-Huellkurven, Struktur, Hotcue-Vorschlaege und
das Raster-Tor mit dem unabhaengigen Anschlag-Instrument kommen mit Scheibe 23; bis dahin gilt das Raster-Tor als
unbestimmt und damit gerissen (§12.3: „weniger Anschlaege gelten als unbestimmt und damit als gerissen“)."""
import os
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np

from . import vertrag
from .audio import lade_mono
from .bestand import (aufraeumen, fassung_name, fassungen_von, fsync_baum, korrekturen_lesen, lies_json,
                      rename_ohne_ueberschreiben, schreibe_json, sha256_datei, versiegeln)
from .eingang import LUFT_DB, geklemmt, lade_stereo48, luft, quelle_info, schreibe_float_wav, spitze_dbfs
from .fremdtags import lese_tags
from .index import eintragen, oeffne
from .karte import Karte
from .lautheit import lautheit, lufs_je_takt
from .stimmung import entscheide, essentia_cent, eigen, tonart
from .warp import frames_je_beat, lies_float_wav, schreibe_f32, timemap, warp

VERLUSTBEHAFTET = {".mp3", ".ogg", ".m4a", ".aac", ".opus"}
TOR_RASTER_MS = 8.0       # §2.1 tor_raster_ms
TOR_KLARHEIT = 0.1        # §2.1 tor_klarheit
TOR_STRECKFAKTOR = 0.20   # §2.1 tor_streckfaktor (0,20 seit ff24935/§12.3 vom 2026-09-25; Plan nannte 0,15)
TOR_HEADROOM_DBTP = -1.0  # §2.1 tor_headroom_dbtp
WARNUNG_RASTER = "Tor raster ungemessen bis Scheibe 23 (unabhaengige Anschlaege), gilt als gerissen"


class KeineNeuenKorrekturen(Exception):
    pass


def karte_aus_liste(liste, vielfaches):
    k = np.asarray(liste, dtype=float)
    return Karte(sekunden=k[:, 0], beats=k[:, 1], vielfaches=float(vielfaches))


def pulsklarheit_aus_c_drift(quelle):
    """Pulsklarheit nach dem Verfahren c_drift.py, wie Scheibe 05 sie liest (proben/07 c_drift.json, Schluessel =
    Dateiname); fuer Dateien, die dort fehlen: None (Tor klarheit dann unbestimmt, rechnet Scheibe 23)."""
    from .lauf_raster import c_drift_werte
    e = c_drift_werte().get(Path(quelle).name)
    return None if e is None else float(e["klarheit_median"])


def raster_messen(quelle, geraet="cpu"):
    """Scheibe 05 (`lauf_raster.miss`): Karte und `raster` in der Datenform von §13.2."""
    from .lauf_raster import c_drift_werte, miss
    e = miss(Path(quelle).name, Path(quelle), cd=c_drift_werte().get(Path(quelle).name), geraet=geraet)
    r = dict(e["raster"])
    # §13.2 (Andreas 2026-09-25, B11): abweichung_ms_p90 ist die Form ohne Versatz (05: form_p90_ms), der konstante
    # Versatz steht daneben, Werkzeug minus Zweitwerkzeug. 05 `vergleiche` meldet versatz_ms positiv, wenn Essentia
    # spaeter liegt als beat_this, also Zweitwerkzeug minus Werkzeug: Vorzeichen umdrehen.
    v = e["vergleich_essentia"]["versatz_ms"]
    r["versatz_zweitwerkzeug_ms"] = None if v is None else round(-float(v), 2)
    warn = list(e.get("warnungen", []))
    if r["erste_eins_quell_beat"] is None:          # beat_this ohne Downbeat im Kartenbereich
        r["erste_eins_quell_beat"] = r["erste_eins_zweitverfahren"] if r["erste_eins_zweitverfahren"] is not None else 0
        warn.append("Takt-Eins ohne beat_this-Downbeat, Zweitverfahren oder 0 genommen")
    info = {"bpm_beat_this": e["bpm_beat_this"], "streckfaktor_05": e["streckfaktor"], "laufzeit_s": e["laufzeit_s"],
            "eins_beat_this": e["eins_beat_this"]}
    return e["tempo_karte_quelle"], r, info, warn


def klemme_ersten_schlag(liste, raster):
    """Erster Schlag knapp vor dem Dateianfang (raster/karte bei Signal, das direkt auf der Eins beginnt: die
    geglaettete Karte legt ihn z. B. bei -8 ms) -> auf 0 klemmen, sonst scheitert material.json am Schema
    (tempo_karte_quelle/0/0 >= 0). Rueckgabe (liste, raster, warnungen). Liegt auch der zweite Schlag nicht nach 0,
    ist die Karte kaputt: ValueError statt still zu verbiegen."""
    if not liste or liste[0][0] >= 0:
        return liste, raster, []
    if len(liste) < 2 or liste[1][0] <= 0:
        raise ValueError(f"Karte beginnt mit mehr als einem Schlag vor dem Dateianfang: {liste[:2]}")
    v = float(liste[0][0])
    liste = [[0.0, liste[0][1]]] + [list(z) for z in liste[1:]]
    raster = dict(raster)
    if raster.get("erster_schlag_quelle_s") is not None and raster["erster_schlag_quelle_s"] < 0:
        raster["erster_schlag_quelle_s"] = 0.0
    return liste, raster, [f"Erster Schlag bei {v * 1000:.1f} ms vor dem Dateianfang, auf 0 geklemmt"]


def raster_aus_wahrheit(karte, pulsklarheit=None):
    """Fuer Kontrollen mit bekannter Wahrheit (konst134, drift_synth): die Karte setzt niemand ausser der Wahrheit."""
    return {"werkzeug": "wahrheit", "zweitwerkzeug": "keins", "abweichung_ms_p90": None,
            "versatz_zweitwerkzeug_ms": None, "pulsklarheit": pulsklarheit,
            "erster_schlag_quelle_s": round(float(karte.sekunden[0]), 6), "taktart": 4,
            "tempo_vielfaches": float(karte.vielfaches), "erste_eins_quell_beat": 0, "erste_eins_zweitverfahren": None}


def tore(material, lautheit_fassung, streckfaktor, eins_beat_this):
    """Vorlaeufige Tore (§12.3) mit dem, was Scheibe 15 misst; `raster` bleibt bis Scheibe 23 unbestimmt."""
    klar = material["raster"]["pulsklarheit"]
    eins_zw = material["raster"]["erste_eins_zweitverfahren"]
    tp = lautheit_fassung["echtspitze_dbtp"]
    return {"raster": {"ok": False, "wert_ms": None, "grenze_ms": TOR_RASTER_MS, "anschlaege": 0},
            "headroom": {"ok": tp <= TOR_HEADROOM_DBTP, "wert_dbtp": tp, "grenze_dbtp": TOR_HEADROOM_DBTP},
            "klarheit": {"ok": klar is not None and klar >= TOR_KLARHEIT, "wert": 0.0 if klar is None else klar,
                         "grenze": TOR_KLARHEIT},
            "streckfaktor": {"ok": abs(streckfaktor - 1.0) <= TOR_STRECKFAKTOR, "wert": round(streckfaktor, 4),
                             "grenze": TOR_STRECKFAKTOR},
            "eins": {"ok": eins_beat_this is not None and eins_beat_this == eins_zw, "beat_this": eins_beat_this,
                     "zweitverfahren": eins_zw}}


def rendere(x, karte, material, basis_bpm, r, fassung_ordner, arbeit, korrekturen_bis_zeile, erste_eins,
            hotcues, korrektur_cent, warnungen, eins_beat_this):
    """Eine Fassung in `fassung_ordner` (noch nicht veroeffentlicht). Rueckgabe (fassung_json, messwerte)."""
    t0 = time.perf_counter()
    fassung_ordner.mkdir(parents=True)
    tm = timemap(karte, basis_bpm, len(x))
    ein = arbeit / "luft.wav"
    schreibe_float_wav(luft(x), ein)
    aus = arbeit / "warp.wav"
    befehl = warp(ein, aus, tm, korrektur_cent=korrektur_cent)
    y = lies_float_wav(aus)
    schreibe_f32(y, fassung_ordner / "basis.f32")
    t_warp = time.perf_counter() - t0
    fpb = frames_je_beat(basis_bpm)
    l = lautheit(y)
    l["lufs_je_takt"] = lufs_je_takt(y, tm.erster_schlag_frame + erste_eins * fpb, 4 * fpb)
    streck = basis_bpm / (60.0 * float(np.polyfit(karte.sekunden, karte.beats, 1)[0]))
    t = tore(material, l, streck, eins_beat_this)
    warn = list(warnungen) + [WARNUNG_RASTER]
    for name, tor in t.items():
        if name != "raster" and not tor["ok"]:
            warn.append(f"Tor {name} gerissen")
    f = {"schema": 1, "material_id": material["material_id"], "basis_bpm": float(basis_bpm), "fassung": int(r),
         "korrekturen_bis_zeile": int(korrekturen_bis_zeile), "datei": "basis.f32", "frames": int(len(y)),
         "sha256": sha256_datei(fassung_ordner / "basis.f32"), "erster_schlag_frame": int(tm.erster_schlag_frame),
         "beats": round((len(y) - tm.erster_schlag_frame) / fpb, 6), "erste_eins_quell_beat": int(erste_eins),
         "analyse_quelle": "basis", "stems": {}, "schuesse": [], "headroom_db": LUFT_DB,
         "stimmung_korrektur_cent": float(korrektur_cent), "lautheit": l, "struktur": {"phrasen": []},
         "hotcues": hotcues, "loops": [], "tore": t, "nur_fuer_andreas": not all(v["ok"] for v in t.values()),
         "warnungen": warn}
    vertrag.pruefe("fassung.schema.json", f)
    schreibe_json(fassung_ordner / "fassung.json", f)
    messwerte = {"geklemmt": geklemmt(y), "spitze_dbfs": spitze_dbfs(y), "streckfaktor": round(streck, 4),
                 "anker": int(len(tm.quelle)), "warp_s": round(t_warp, 2), "befehl": " ".join(befehl[:-2])}
    for d in (ein, aus, aus.with_suffix(".timemap.txt")):
        d.unlink(missing_ok=True)
    return f, messwerte


def einlesen(quelle, bestand, basis_bpm=128.0, karte=None, geraet="cpu", auftrag_id=None, titel=None):
    """Neues Material mit Fassung r1. Liegt das Material schon im Bestand: nichts schreiben, Status 'vorhanden'.
    karte: nur fuer Kontrollen mit bekannter Wahrheit; sonst misst Scheibe 05 die Karte."""
    quelle, bestand = Path(quelle), Path(bestand)
    t0 = time.perf_counter()
    sha = sha256_datei(quelle)
    mid = sha[:16]
    if (bestand / mid).exists():
        return {"material_id": mid, "status": "vorhanden"}
    auftrag_id = auftrag_id or f"e-{mid}"
    arbeit = bestand / ".arbeit" / auftrag_id
    aufraeumen(arbeit)                              # Rest eines abgebrochenen Laufs derselben Werkstatt
    try:
        mo = arbeit / mid
        (mo / "fassungen").mkdir(parents=True)
        endung = quelle.suffix.lower()
        shutil.copyfile(quelle, mo / f"original{endung}")
        if endung in VERLUSTBEHAFTET:
            subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(quelle), "-c:a", "flac",
                            str(mo / "original.flac")], check=True)
        (mo / "korrekturen.jsonl").touch()
        zeiten = {}
        x = lade_stereo48(quelle)
        lq = lautheit(x)
        t = time.perf_counter()
        warnungen = []
        if karte is None:
            liste, raster, rinfo, w = raster_messen(quelle, geraet)
            warnungen += w
            eins_bt = rinfo["eins_beat_this"]
        else:
            liste, raster, rinfo = karte.als_liste(), raster_aus_wahrheit(karte, pulsklarheit_aus_c_drift(quelle)), {}
            eins_bt = None
        liste, raster, w = klemme_ersten_schlag(liste, raster)
        warnungen += w
        zeiten["raster"] = round(time.perf_counter() - t, 2)
        karte_r = karte_aus_liste(liste, raster["tempo_vielfaches"])   # Fassung genau aus material.json
        t = time.perf_counter()
        x48 = x.mean(axis=1)
        c1, rr = eigen(x48)
        c2 = essentia_cent(lade_mono(quelle, 44100))
        stimmung = entscheide(c1, rr, c2)
        ta = tonart(x48, c1)
        zeiten["stimmung"] = round(time.perf_counter() - t, 2)
        if stimmung["warnung"]:
            warnungen.append(stimmung["warnung"])
        info = quelle_info(quelle)
        fremd = lese_tags(quelle)
        warnungen += fremd.pop("warnungen")
        eigen_bpm = None
        try:
            steig = float(np.polyfit(karte_r.sekunden, karte_r.beats, 1)[0])
            if steig > 0:
                eigen_bpm = 60.0 * steig
        except (ValueError, TypeError, np.linalg.LinAlgError):
            eigen_bpm = None
        fremd["tag_bpm_abweichung_prozent"] = (round((fremd["tag_bpm"] - eigen_bpm) / eigen_bpm * 100.0, 2)
                                                if fremd["tag_bpm"] and eigen_bpm else None)
        material = {"schema": 1, "material_id": mid, "titel": titel or quelle.stem,
                    "herkunft": {"art": "datei", "prompt": None, "stil": None, "seed": None, "generator": None,
                                 "erzeugt_am": None, "auftrag_id": auftrag_id},
                    "text": {"quelle": "keiner", "zeilen": []},
                    "quelle": {"datei": f"original{endung}", "sr": info["sr"], "kanaele": info["kanaele"],
                               "dauer_s": info["dauer_s"], "sha256": sha},
                    "tempo_karte_quelle": liste, "raster": raster, "lautheit_quelle": lq,
                    "tonart": {**ta, "stimmung_cent": None if c1 is None else round(c1, 2),
                               "stimmung_r": None if rr is None else round(rr, 3),
                               "stimmung_cent_zweitwerkzeug": None if c2 is None else round(c2, 2), "aus_stems": False}}
        vertrag.pruefe("material.schema.json", material)
        schreibe_json(mo / "material.json", material)
        hat_fremdtags = any(fremd[k] for k in ("tkey", "energie", "tag_bpm", "artist", "titel", "album"))
        if hat_fremdtags:
            schreibe_json(mo / "tags.json", fremd)
        name = fassung_name(basis_bpm, 1)
        t = time.perf_counter()
        f, mw = rendere(x, karte_r, material, basis_bpm, 1, mo / "fassungen" / name, arbeit, 0,
                        raster["erste_eins_quell_beat"], [], stimmung["korrektur_cent"], warnungen, eins_bt)
        zeiten["rendern"] = round(time.perf_counter() - t, 2)
        versiegeln_liste = [mo / "material.json"] + list(mo.glob("original.*"))
        if hat_fremdtags:
            versiegeln_liste.append(mo / "tags.json")
        for p in versiegeln_liste:
            versiegeln(p)
        versiegeln(mo / "fassungen" / name)
        fsync_baum(mo)
        rename_ohne_ueberschreiben(mo, bestand / mid)
        con = oeffne(bestand)
        eintragen(con, bestand / mid, basis_bpm)
        con.close()
        aufraeumen(arbeit)
        zeiten["gesamt"] = round(time.perf_counter() - t0, 2)
        return {"material_id": mid, "status": "neu", "fassung": name, "titel": material["titel"],
                "stimmung": {"eigen": c1, "r": rr, "essentia": c2, **stimmung}, "messwerte": mw, "zeiten": zeiten,
                "raster": rinfo, "tore": {k: v["ok"] for k, v in f["tore"].items()}, "lufs": f["lautheit"]["lufs_integriert"]}
    except BaseException:                           # Befund 3: gescheiterter Track laesst keine Kopie liegen
        aufraeumen(arbeit)
        raise


def wende_raster_an(karte, zeilen, basis_bpm):
    """Raster-Korrekturen (§13.3, Art `raster`) in Quell-Zeit. Festlegung F2 dieser Scheibe: `versatz_ms` ist die
    Lage der Anschlaege gegen das Raster der genannten Fassung (positiv = zu spaet); verschoben wird die
    Quell-Sekunde jedes Eintrags im Abschnitt [ab_quell_beat, bis_quell_beat) um
    versatz * (lokale Quell-Periode / Periode der Basis), damit die Anschlaege dort aufs Raster fallen."""
    s = np.array(karte.sekunden, dtype=float)
    q = np.asarray(karte.beats, dtype=float)
    per_basis = 60.0 / basis_bpm
    per_quelle = np.gradient(s, q)
    for z in zeilen:
        if z["art"] != "raster" or z["versatz_ms"] is None:
            continue
        drin = (q >= z["ab_quell_beat"]) & (q < z["bis_quell_beat"])
        s[drin] += z["versatz_ms"] / 1000.0 * per_quelle[drin] / per_basis
    if np.any(np.diff(s) <= 0):
        raise ValueError("Raster-Korrektur macht die Karte nicht mehr steigend")
    return Karte(sekunden=s, beats=q, vielfaches=karte.vielfaches)


def eins_und_hotcues(material, zeilen):
    """Takt-Eins (Art `eins`: ab_quell_beat ist der erklaerte Schlag, §13.3) und Hotcues von Hand (Art `hotcue`,
    ab_quell_beat null = loeschen) in Zeilenfolge; die letzte Zeile je Nummer gilt."""
    eins = material["raster"]["erste_eins_quell_beat"]
    hotcues = {}
    for z in zeilen:
        if z["art"] == "eins" and z["ab_quell_beat"] is not None:
            eins = int(round(z["ab_quell_beat"])) % 4
        if z["art"] == "hotcue" and z["nr"] is not None:
            if z["ab_quell_beat"] is None:
                hotcues.pop(z["nr"], None)
            else:
                hotcues[z["nr"]] = {"nr": z["nr"], "quell_beat": float(z["ab_quell_beat"]),
                                    "name": z["text"] or f"Hotcue {z['nr']}", "von": z["von"]}
    return eins, [hotcues[k] for k in sorted(hotcues)]


def korrigieren(material_id, bestand, basis_bpm=128.0):
    """§12.1 `korrigieren`: alle Zeilen von korrekturen.jsonl einrechnen, neue Fassung r+1 auf derselben Basis.
    Die alte Fassung wird nur gelesen (fassung.json fuer r, Zeilenstand, Stimmung)."""
    bestand = Path(bestand)
    mo = bestand / material_id
    zeilen = korrekturen_lesen(mo)
    for i, z in enumerate(zeilen, 1):
        f = vertrag.fehler("korrektur.schema.json", z)
        if f:
            raise ValueError(f"{material_id}: korrekturen.jsonl Zeile {i} ungueltig: {f[:3]}")
    auf_basis = [(r, p) for b, r, p in fassungen_von(mo) if abs(b - basis_bpm) < 1e-9]
    if not auf_basis:
        raise FileNotFoundError(f"{material_id}: keine Fassung auf Basis {basis_bpm}")
    r_alt, p_alt = max(auf_basis)
    alt = lies_json(p_alt / "fassung.json")
    if len(zeilen) <= alt["korrekturen_bis_zeile"]:
        raise KeineNeuenKorrekturen(f"{material_id}: {len(zeilen)} Zeilen, {p_alt.name} rechnet schon "
                                    f"{alt['korrekturen_bis_zeile']} ein")
    material = lies_json(mo / "material.json")
    karte = karte_aus_liste(material["tempo_karte_quelle"], material["raster"]["tempo_vielfaches"])
    karte = wende_raster_an(karte, zeilen, basis_bpm)
    eins, hotcues = eins_und_hotcues(material, zeilen)
    r = r_alt + 1
    name = fassung_name(basis_bpm, r)
    arbeit = bestand / ".arbeit" / f"k-{material_id}-r{r}"
    aufraeumen(arbeit)
    arbeit.mkdir(parents=True)
    x = lade_stereo48(mo / material["quelle"]["datei"])
    warn = [w for w in alt["warnungen"] if w.startswith(("Stimmung", "Takt-Eins", "Erster Schlag"))]
    f, mw = rendere(x, karte, material, basis_bpm, r, arbeit / name, arbeit, len(zeilen), eins, hotcues,
                    alt["stimmung_korrektur_cent"], warn, alt["tore"]["eins"]["beat_this"])
    versiegeln(arbeit / name, ordner_selbst=False)
    fsync_baum(arbeit / name)
    rename_ohne_ueberschreiben(arbeit / name, mo / "fassungen" / name)
    os.chmod(mo / "fassungen" / name, 0o555)
    con = oeffne(bestand)
    eintragen(con, mo, basis_bpm)
    con.close()
    aufraeumen(arbeit)
    return {"material_id": material_id, "fassung": name, "korrekturen_bis_zeile": len(zeilen), "messwerte": mw}
