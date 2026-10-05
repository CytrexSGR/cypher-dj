"""Scheibe 15: jeder Song unter samples/bestand/ und stems/mfbass/orig.mp3 wird Material im Bestand (Fassung
128000_r1). Schon vorhandenes Material bleibt unberuehrt (Status 'vorhanden'). Danach Bericht aus dem, was im
Bestand steht: berichte/15-bestand.json und berichte/15-bestand.md.

Aufruf (aus djk/werkstatt):
  nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.lauf_bestand [--quelle ORDNER] [--bestand PFAD]
      [--nur name1,name2] [--bericht NAME] [--berichte ORDNER]
Vorgabe fuer --bestand: $CYPHERDJ_BESTAND, sonst ~/cypher-dj/bestand.
--quelle ORDNER: statt samples/bestand (und ohne die Kontrolle mfbass) jede Audiodatei unter ORDNER, rekursiv;
fehlt ORDNER oder ist er eine Datei, endet der Aufruf mit Endcode 2. Titel: 'Artist – Title' aus den Tags, sonst
relativer Pfad ohne Endung (eindeutig gemacht, siehe `sammle`); --nur trifft Titel, relativen Pfad oder Dateinamen.
Formate: ENDUNGEN (mp3, flac, wav, aiff/aif/aifc, m4a, aac); dekodiert wird ueber ffmpeg wie in der Kette.
Alles andere, versteckte Dateien und nicht dekodierbare Dateien werden mit Grund gezaehlt und gemeldet; ein Track,
an dem `einlesen` scheitert, zaehlt als fehlgeschlagen, der Lauf geht weiter. Je Track stehen Dauer, Laufzeit und
1-min-Last vor/nach im Bericht (Abschnitt "Dieser Lauf")."""
import argparse
import json
import os
import subprocess
import time
import traceback
from pathlib import Path

from . import kontrollen as K
from .bestand import fassungen_von, lies_json, materialien, standard_bestand
from .vertrag import sauber
from .fremdtags import repariere_text
from .index import zaehle
from .kette import einlesen
from .eingang import quelle_info

HIER = Path(__file__).resolve().parent.parent


ENDUNGEN = (".mp3", ".flac", ".wav", ".aiff", ".aif", ".aifc", ".m4a", ".aac")


def dauer(p):
    """Dauer in s ueber ffprobe; None, wenn die Datei keinen dekodierbaren Audiostrom hat (dann Grund als str)."""
    try:
        return quelle_info(p)["dauer_s"], None
    except Exception as ex:                      # ffprobe rc != 0, kein Audiostrom, keine Dauer
        msg = getattr(ex, "stderr", "") or str(ex) or type(ex).__name__
        return None, "not decodable: " + " ".join(str(msg).split())[:160]


def tag_titel(p):
    """'Artist – Title' aus den Tags, wie ffprobe sie liest (ID3, Vorbis-Kommentare, MP4-Atome; Format- und
    Stream-Tags, Schluessel ohne Gross/Klein). Nur Title: Title. Kein Title oder ffprobe scheitert: None."""
    try:
        q = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json",
                            str(p)], capture_output=True, text=True, check=True, timeout=60)
        d = json.loads(q.stdout)
    except Exception:
        return None
    tags = {}
    for quelle in [d.get("format", {})] + d.get("streams", []):
        for k, v in (quelle.get("tags") or {}).items():
            tags.setdefault(k.lower(), " ".join(str(v).split()))
    artist, title = repariere_text(tags.get("artist")), repariere_text(tags.get("title"))
    if not title:
        return None
    return f"{artist} – {title}" if artist else title


def sammle(ordner):
    """([(pfad, titel, dauer_s)], [(pfad, grund)]) fuer alle Dateien unter ORDNER, rekursiv, sortiert.
    Nichts faellt still: jede Datei, die nicht eingelesen wird, steht mit Grund in der zweiten Liste, auch ein toter
    Symlink. Titel: aus den Tags (tag_titel), sonst relativer Pfad ohne Endung; kommt ein Titel mehrfach vor, traegt
    der Tag-Titel den relativen Pfad in Klammern, der Pfad-Titel die Endung."""
    ordner = Path(ordner)
    liste, weg = [], []
    for p in sorted(x for x in ordner.rglob("*") if x.is_file() or (x.is_symlink() and not x.exists())):
        rel = p.relative_to(ordner)
        if any(t.startswith(".") for t in rel.parts):
            weg.append((p, "hidden file"))
        elif p.is_symlink() and not p.exists():
            weg.append((p, f"broken symlink -> {os.readlink(p)}"))
        elif p.suffix.lower() not in ENDUNGEN:
            weg.append((p, f"unsupported format {p.suffix.lower() or '(none)'}"))
        else:
            d, grund = dauer(p)
            if grund:
                weg.append((p, grund))
            else:
                t = tag_titel(p)
                liste.append((p, t if t else rel.with_suffix("").as_posix(), d, t is not None))
    zahl = {}
    for _, t, _, _ in liste:
        zahl[t] = zahl.get(t, 0) + 1
    aus = []
    for p, t, d, getaggt in liste:
        if zahl[t] > 1:
            rel = p.relative_to(ordner).as_posix()
            t = f"{t} ({rel})" if getaggt else rel
        aus.append((p, t, d))
    return aus, weg


def quellen(ordner=None):
    """(liste, uebersprungen, wurzel). Ohne ORDNER: mfbass zuerst (sha256 geprueft), dann samples/bestand/."""
    if ordner is not None:
        liste, weg = sammle(ordner)
        return liste, weg, Path(ordner)
    liste, weg = sammle(K.BESTAND_SONGS)
    mf = K.pruefe(*K.KONTROLLEN["mfbass"])
    return [(mf, "mfbass", dauer(mf)[0])] + liste, weg, K.BESTAND_SONGS


def zeile(mo):
    m = lies_json(mo / "material.json")
    fs = fassungen_von(mo)
    b, r, p = [x for x in fs if abs(x[0] - 128.0) < 1e-9 and x[1] == 1][0]
    f = lies_json(p / "fassung.json")
    t = m["tonart"]
    return {"titel": m["titel"], "material_id": m["material_id"], "fassungen": [q.name for _, _, q in fs],
            "quelle_datei": m["quelle"]["datei"], "dauer_s": m["quelle"]["dauer_s"],
            "werkzeug": m["raster"]["werkzeug"], "tempo_vielfaches": m["raster"]["tempo_vielfaches"],
            "pulsklarheit": m["raster"]["pulsklarheit"], "eins": m["raster"]["erste_eins_quell_beat"],
            "eins_zweit": m["raster"]["erste_eins_zweitverfahren"],
            "stimmung_cent": t["stimmung_cent"], "stimmung_r": t["stimmung_r"],
            "stimmung_zweit": t["stimmung_cent_zweitwerkzeug"], "camelot": t["camelot"],
            "korrektur_cent": f["stimmung_korrektur_cent"],
            "lufs_quelle": m["lautheit_quelle"]["lufs_integriert"], "tp_quelle": m["lautheit_quelle"]["echtspitze_dbtp"],
            "lufs_fassung": f["lautheit"]["lufs_integriert"], "tp_fassung": f["lautheit"]["echtspitze_dbtp"],
            "frames": f["frames"], "erster_schlag_frame": f["erster_schlag_frame"],
            "streckfaktor": f["tore"]["streckfaktor"]["wert"],
            "tore": {n: v["ok"] for n, v in f["tore"].items()}, "nur_fuer_andreas": f["nur_fuer_andreas"],
            "warnungen": f["warnungen"]}


def f2(x, n=2):
    return "–" if x is None else f"{x:.{n}f}".replace(".", ",")


def lauf_abschnitt(q):
    """Markdown fuer den Abschnitt 'Dieser Lauf': je Track Dauer, Laufzeit, Last; dann Uebersprungenes mit Grund."""
    z = ["## Dieser Lauf", "",
         f"Quelle `{q['ordner']}` (rekursiv): gefunden {q['gefunden']}, eingelesen {q['eingelesen']}, "
         f"davon neu {q['neu']} und vorhanden {q['vorhanden']}. Fehlgeschlagen: {q['fehlgeschlagen']}. "
         f"Übersprungen: {q['uebersprungen']}.", "",
         "| Titel | material_id | Status | Datei | Dauer s | Laufzeit s | Last vor → nach |", "|" + "---|" * 7]
    for e in q["tracks"]:
        lv = e.get("last_vor_nach") or [None, None]
        z.append(f"| {e['titel']} | `{e.get('material_id') or '–'}` | {e['status']} | {e['datei']} | "
                 f"{f2(e['dauer_s'], 1)} | {f2(e['sekunden'], 1)} | {f2(lv[0])} → {f2(lv[1])} |")
    if q["fehlgeschlagen"]:
        z += ["", "### Fehlgeschlagen", ""]
        z += [f"- {e['datei']}: {e['fehler']}" for e in q["tracks"] if e["status"] == "failed"]
    z += ["", "### Übersprungen", ""]
    z += [f"- {u['datei']}: {u['grund']}" for u in q["uebersprungen_liste"]] or ["- keine"]
    return z


def bericht(bestand, lauf, quelle=None, berichte=None, name="15-bestand"):
    zeilen = [zeile(mo) for mo in materialien(bestand)]
    n_m, n_f = zaehle(bestand)
    z = ["# Scheibe 15: Bestand nach dem Einlesen", "",
         f"Bestand `{bestand}`: {len(zeilen)} Material-Ordner, Index {n_m} Materialien und {n_f} Fassungen. "
         "Stimmung: eigen = Spektralspitzen aus `fa.py` (R = Richtungsschärfe), zweit = Essentia; korrigiert wird nur "
         "bei R ≥ 0,1, Abstand ≤ 10 ct und Mittel unter 35 ct.", "",
         "| Titel | material_id | v | Streckfaktor | Klarheit | Eins bt/zweit | Stimmung eigen (R) / zweit ct | Korrektur ct | "
         "LUFS Quelle → Fassung | Echtspitze Fassung dBTP | Tore h/k/s/e | Laufzeit s |",
         "|" + "---|" * 12]
    for e in zeilen:
        t = e["tore"]
        lz = lauf.get(e["material_id"], {}).get("zeiten", {}).get("gesamt")
        z.append(f"| {e['titel']} | `{e['material_id']}` | {e['tempo_vielfaches']:g} | {f2(e['streckfaktor'], 4)} | "
                 f"{f2(e['pulsklarheit'])} | {e['eins']}/{'–' if e['eins_zweit'] is None else e['eins_zweit']} | "
                 f"{f2(e['stimmung_cent'], 1)} ({f2(e['stimmung_r'])}) / {f2(e['stimmung_zweit'], 1)} | "
                 f"{f2(e['korrektur_cent'], 1)} | {f2(e['lufs_quelle'])} → {f2(e['lufs_fassung'])} | {f2(e['tp_fassung'])} | "
                 f"{''.join('+' if t[n] else '−' for n in ('headroom', 'klarheit', 'streckfaktor', 'eins'))} | {f2(lz, 1)} |")
    z += (["", *lauf_abschnitt(quelle)] if quelle else [])
    z += ["", "Tor `raster` ist in Scheibe 15 für jede Fassung unbestimmt und damit gerissen (Scheibe 23 misst es); "
          "darum steht `nur_fuer_andreas` überall auf true.", "", "## Warnungen", ""]
    for e in zeilen:
        for w in e["warnungen"]:
            z.append(f"- {e['titel']}: {w}")
    berichte = Path(berichte) if berichte else HIER / "berichte"
    berichte.mkdir(parents=True, exist_ok=True)
    daten = {"bestand": str(bestand), "zeilen": zeilen, "lauf": lauf, "index": [n_m, n_f]}
    if quelle:
        daten["quelle"] = quelle
    (berichte / f"{name}.json").write_text(json.dumps(sauber(daten), indent=1, ensure_ascii=False) + "\n")
    (berichte / f"{name}.md").write_text("\n".join(z) + "\n")
    return z


def main(argv=None):
    ap = argparse.ArgumentParser(description="Read audio files into the Bestand and write a report.")
    ap.add_argument("--quelle", default=None, help="source folder, searched recursively (default: samples/bestand "
                    "plus the mfbass control)")
    ap.add_argument("--bestand", default=str(standard_bestand()))
    ap.add_argument("--nur", default="")
    ap.add_argument("--bericht", default="15-bestand", help="report name (NAME.json, NAME.md)")
    ap.add_argument("--berichte", default=str(HIER / "berichte"), help="report folder")
    a = ap.parse_args(argv)
    if a.quelle is not None:                         # Befund 1: kein "found 0" als Erfolg ueber einen falschen Pfad
        q = Path(a.quelle).expanduser()
        if not q.exists():
            ap.error(f"--quelle {q}: path does not exist")
        if not q.is_dir():
            ap.error(f"--quelle {q}: not a folder")
    bestand = Path(a.bestand).expanduser()
    bestand.mkdir(parents=True, exist_ok=True)
    nur = {n for n in a.nur.split(",") if n}
    berichte = Path(a.berichte).expanduser()
    alt = berichte / f"{a.bericht}.json"           # Laufzeiten frueherer Laeufe bleiben im Bericht stehen
    lauf = json.loads(alt.read_text()).get("lauf", {}) if alt.is_file() else {}
    liste, weg, wurzel = quellen(Path(a.quelle).expanduser() if a.quelle else None)
    tracks = []
    for p, titel, dauer_s in liste:
        rel = p.relative_to(wurzel).with_suffix("").as_posix() if p.is_relative_to(wurzel) else p.stem
        if nur and not nur & {titel, rel, p.stem}:
            continue
        last = os.getloadavg()[0]
        t0 = time.perf_counter()
        datei = p.relative_to(wurzel).as_posix() if p.is_relative_to(wurzel) else str(p)
        try:
            e = einlesen(p, bestand, titel=titel)
        except Exception as ex:                     # ein kaputter Track haelt den Lauf nicht an, er wird gemeldet
            e = {"material_id": None, "status": "failed",
                 "fehler": f"{type(ex).__name__}: {ex}".strip()[:300]}
            traceback.print_exc()
        e["last_vor_nach"] = [round(last, 2), round(os.getloadavg()[0], 2)]
        e["sekunden"] = round(time.perf_counter() - t0, 1)
        e["dauer_s"] = dauer_s
        if e["status"] != "failed" and (e["status"] == "neu" or e["material_id"] not in lauf):
            lauf[e["material_id"]] = e
        tracks.append({"titel": titel, "datei": datei, "material_id": e["material_id"], "status": e["status"],
                       "dauer_s": dauer_s, "sekunden": e["sekunden"], "last_vor_nach": e["last_vor_nach"],
                       **({"fehler": e["fehler"]} if "fehler" in e else {})})
        print(f"{titel:32s} {e['material_id'] or '-':16s} {e['status']:9s} {dauer_s or 0:7.1f} s audio "
              f"{e['sekunden']:7.1f} s run  load {e['last_vor_nach'][0]:.2f}->{e['last_vor_nach'][1]:.2f}  "
              f"{e.get('fehler', '')}{e.get('stimmung', {}).get('grund', '')} {e.get('tore', '')}", flush=True)
    uebersprungen = [{"datei": p.relative_to(wurzel).as_posix(), "grund": g} for p, g in weg]
    for u in uebersprungen:
        print(f"skipped: {u['datei']}: {u['grund']}", flush=True)
    fehl = sum(t["status"] == "failed" for t in tracks)
    q = {"ordner": str(wurzel), "gefunden": len(liste), "eingelesen": len(tracks) - fehl,
         "neu": sum(t["status"] == "neu" for t in tracks), "vorhanden": sum(t["status"] == "vorhanden" for t in tracks),
         "fehlgeschlagen": fehl, "uebersprungen": len(uebersprungen), "uebersprungen_liste": uebersprungen,
         "tracks": tracks}
    print("\n".join(bericht(bestand, lauf, quelle=q, berichte=berichte, name=a.bericht)))
    print(f"found {q['gefunden']}, read {q['eingelesen']}, failed {fehl}, skipped {len(uebersprungen)}", flush=True)
    return 1 if fehl else 0


if __name__ == "__main__":
    raise SystemExit(main())
