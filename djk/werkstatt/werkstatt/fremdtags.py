"""Fremdtags von Mixed In Key/Beatport (ID3, oder das Vorbis/MP4-Aequivalent): Tonart (TKEY, Camelot),
EnergyLevel, TBPM, Artist/Title/Album. Reiner Lesezugriff ueber ffprobe (wie lauf_bestand.tag_titel); die
Werkstatt schreibt diese Tags nie und die gelesenen Dateien (auch Andreas' Bestand unter
/path/to/music/...) bleiben unberuehrt.

Tonart und Tempo aus den Tags sind NIE die Quelle der Wahrheit der Werkstatt: `material.tonart` misst die
eigene Chroma-Analyse (stimmung.py/fa.py: eigenes Spektralverfahren + Essentia, mit R-Wert), `material.raster`/
`tempo_karte_quelle` die eigene Raster-Messung (Scheibe 05, beat_this + Essentia). djk/vertrag/schemas/material.schema.json
hat darum kein freies Feld fuer Tag-Werte: `tonart.camelot` ist an r/vorsprung/aus_stems gebunden (eine
Audio-Messung, kein Tag), fuer EnergyLevel, Album, ein separates Artist-Feld und einen Tag-BPM-Vergleich gibt es
gar kein Schema-Feld. Die hier gelesenen Werte landen deshalb in einer eigenen Datei tags.json neben
material.json (siehe Nachtrag zu Scheibe 15 in docs/architektur/stand/15-werkstatt-fassung.md); TBPM nur als
Abweichung in Prozent zur eigenen Tempo-Karte (tag_bpm_abweichung_prozent), nie als Ersatz."""
import json
import re
import subprocess

from .fa import CAM_DUR, CAM_MOLL, NAMEN

CAMELOT_MUSTER = re.compile(r"^(1[0-2]|[1-9])[AB]$")
# "5A - 7": Camelot, Trennzeichen, Energiezahl 1-10 (Mixed-In-Key-Kommentarformat)
KOMMENTAR_MUSTER = re.compile(r"^\s*(1[0-2]|[1-9])([ABab])\s*[-–]\s*(10|[1-9])\s*$")

# Notenname je Camelot-Code, aus denselben Tabellen wie die eigene Tonart-Erkennung (fa.py), damit beide
# Camelot-Schreibungen im Bestand konsistent bleiben.
_NOTENNAME = {}
for _r, _c in CAM_DUR.items():
    _NOTENNAME[_c] = f"{NAMEN[_r]}-Dur"
for _r, _c in CAM_MOLL.items():
    _NOTENNAME[_c] = f"{NAMEN[_r]}-Moll"


def camelot_zu_notenname(camelot):
    """Notenname (z. B. 'C-Moll') zum Camelot-Code (z. B. '5A'); None bei ungueltigem oder unbekanntem Code."""
    return _NOTENNAME.get(camelot)


def _roh_tags(pfad):
    """{schluessel_klein: wert} aus Format- und Stream-Tags (ffprobe); Format gewinnt bei doppelten Schluesseln
    (wie lauf_bestand.tag_titel). Scheitert ffprobe oder liefert kein JSON: None (Aufrufer meldet die Warnung)."""
    try:
        q = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json",
                            str(pfad)], capture_output=True, text=True, check=True, timeout=60)
        d = json.loads(q.stdout)
    except Exception:
        return None
    tags = {}
    for quelle in [d.get("format", {})] + d.get("streams", []):
        for k, v in (quelle.get("tags") or {}).items():
            tags.setdefault(k.lower(), " ".join(str(v).split()))
    return tags


def _aus_kommentar(kommentar):
    """(camelot, energie) aus einem Kommentar-Tag im Format 'Tonart - Energie' (z. B. '5A - 7'); (None, None)
    ohne Treffer oder ohne Kommentar."""
    if not kommentar:
        return None, None
    m = KOMMENTAR_MUSTER.match(kommentar)
    if not m:
        return None, None
    return f"{m.group(1)}{m.group(2).upper()}", int(m.group(3))


def repariere_text(s):
    """Doppelt kodiertes UTF-8 zurueck ('DahlbÃ¤ck' -> 'Dahlbäck'): manche Tags tragen UTF-8-Bytes als Latin-1
    gespeichert, ffprobe liest sie wörtlich. Repariert wird je Abschnitt aus Latin-1-Zeichen (ein eingefügtes
    '–' zwischen Artist und Titel trennt nur), und nur, wenn dessen Bytes gültiges UTF-8 sind; echtes 'SÃO'
    (kein gültiges UTF-8) bleibt stehen."""
    if not s or not any(0x80 <= ord(c) <= 0xFF for c in s):
        return s

    def abschnitt(m):
        t = m.group(0)
        try:
            return t.encode("latin-1").decode("utf-8")
        except UnicodeDecodeError:
            return t
    return re.sub(r"[\x00-\xff]+", abschnitt, s)


def lese_tags(pfad):
    """Fremdtags aus Mixed In Key/Beatport-ID3 (TKEY, EnergyLevel oder Kommentar 'Tonart - Energie', TBPM,
    Artist, Title, Album). Rueckgabe: {tkey, notenname, energie, tag_bpm, artist, titel, album, warnungen}.
    Fehlende Felder bleiben None; ein kaputter Tag-Wert (nicht der erwarteten Form) bleibt ebenfalls None, mit
    einer Warnung in `warnungen` je kaputtem Feld. Nichts bricht ab, auch nicht, wenn ffprobe selbst scheitert
    oder die Datei gar keine Fremdtags traegt."""
    aus = {"tkey": None, "notenname": None, "energie": None, "tag_bpm": None, "artist": None, "titel": None,
           "album": None, "warnungen": []}
    tags = _roh_tags(pfad)
    if tags is None:
        aus["warnungen"].append("Fremdtags nicht lesbar (ffprobe gescheitert)")
        return aus

    aus["artist"] = repariere_text(tags.get("artist")) or None
    aus["titel"] = repariere_text(tags.get("title")) or None
    aus["album"] = repariere_text(tags.get("album")) or None

    roh_tkey = tags.get("tkey")
    kom_camelot, kom_energie = _aus_kommentar(tags.get("comment"))

    if roh_tkey:
        if CAMELOT_MUSTER.match(roh_tkey.strip()):
            aus["tkey"] = roh_tkey.strip()
        else:
            aus["warnungen"].append(f"TKEY-Tag ungueltig: {roh_tkey!r}")
    elif kom_camelot:
        aus["tkey"] = kom_camelot
    if aus["tkey"]:
        aus["notenname"] = camelot_zu_notenname(aus["tkey"])

    roh_energie = tags.get("energylevel") or tags.get("txxx:energylevel") or tags.get("energy")
    if roh_energie:
        try:
            e = int(str(roh_energie).strip())
        except ValueError:
            aus["warnungen"].append(f"EnergyLevel-Tag ungueltig: {roh_energie!r}")
        else:
            if 1 <= e <= 10:
                aus["energie"] = e
            else:
                aus["warnungen"].append(f"EnergyLevel-Tag ausserhalb 1-10: {roh_energie!r}")
    elif kom_energie is not None:
        aus["energie"] = kom_energie

    roh_bpm = tags.get("tbpm")
    if roh_bpm:
        try:
            aus["tag_bpm"] = float(str(roh_bpm).strip().replace(",", "."))
        except ValueError:
            aus["warnungen"].append(f"TBPM-Tag ungueltig: {roh_bpm!r}")

    if not any([aus["tkey"], aus["energie"], aus["tag_bpm"], aus["artist"], aus["titel"], aus["album"]]):
        aus["warnungen"].append("keine Fremdtags gefunden (TKEY, EnergyLevel/Kommentar, TBPM, Artist, Title, Album)")
    return aus
