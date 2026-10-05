"""Liest djk/vertrag/baender.json (Eigentümer: Scheibe 09) für Scheibe 14.

Einzige Stelle, die das Dateiformat kennt: der Kopf-Erzeuger (erzeuge_baender_h.py) und die
Python-Referenz (pruefung/referenz_baender.py) laden beide hierüber, damit Kern und Referenz
dieselben Zahlen sehen. Form laut Probe von Scheibe 09 (proben/plan-09, 2026-09-23):
  {"version": 1, "rate_hz": 48000, "fenster_samples": 48,
   "baender": [{"index": 0, "name": "sub", "unten_hz": 30.0, "oben_hz": 90.0,
                "sos": [[b0, b1, b2, a0, a1, a2], ...]}, ... sechs Bänder ...],
   "k_filter": {"sos": [[...], [...]]}}
Geduldet werden auch "rate", "von_hz"/"bis_hz" und statt "sos" zwei SOS-Listen "hochpass" und
"tiefpass" (verkettet, Hochpass zuerst, SCHNITTSTELLEN 6.2). Fehlt "k_filter", gilt der Normfilter."""
import json

NAMEN = ["sub", "tief", "tiefmitte", "mitte", "praesenz", "hoch"]   # SCHNITTSTELLEN 6.2, 14.8
GRENZEN = [(30, 90), (90, 250), (250, 800), (800, 2000), (2000, 6000), (6000, 16000)]
MAX_SEKTIONEN = 8
K_NORM = [[1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
          [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]]   # ITU-R BS.1770-4, 48 kHz


class FormatFehler(ValueError):
    pass


def _pruefe_sos(name, sos, max_sek):
    if not isinstance(sos, list) or not 1 <= len(sos) <= max_sek:
        raise FormatFehler(f"{name}: SOS-Liste fehlt oder hat nicht 1 bis {max_sek} Zeilen")
    for z in sos:
        if not isinstance(z, list) or len(z) != 6 or float(z[3]) != 1.0:
            raise FormatFehler(f"{name}: SOS-Zeile {z} nicht [b0,b1,b2,1.0,a1,a2]")
    return [[float(v) for v in z] for z in sos]


def lade(pfad):
    """Gibt (baender, k_sos) zurück: baender = [(name, von_hz, bis_hz, sos), ...] in Vertragsreihenfolge,
    k_sos = SOS des K-Filters (aus der Datei, sonst Norm)."""
    with open(pfad) as f:
        d = json.load(f)
    rate = d.get("rate_hz", d.get("rate", 48000))
    if rate != 48000:
        raise FormatFehler(f"Abtastrate {rate} statt 48000")
    if d.get("fenster_samples", 48) != 48:
        raise FormatFehler(f"fenster_samples {d.get('fenster_samples')} statt 48")
    baender = d.get("baender")
    if not isinstance(baender, list) or len(baender) != 6:
        raise FormatFehler(f"'baender' fehlt oder hat nicht 6 Eintraege; Schluessel oben: {sorted(d)}")
    aus = []
    for i, b in enumerate(baender):
        if b.get("name") != NAMEN[i]:
            raise FormatFehler(f"Band {i} heisst {b.get('name')!r}, erwartet {NAMEN[i]!r}")
        if "sos" in b:
            sos = b["sos"]
        elif isinstance(b.get("hochpass"), list) and isinstance(b.get("tiefpass"), list):
            sos = list(b["hochpass"]) + list(b["tiefpass"])
        else:
            raise FormatFehler(f"Band {NAMEN[i]}: weder 'sos' noch SOS-Listen 'hochpass'+'tiefpass'; Schluessel: {sorted(b)}")
        sos = _pruefe_sos(f"Band {NAMEN[i]}", sos, MAX_SEKTIONEN)
        von = float(b.get("unten_hz", b.get("von_hz", GRENZEN[i][0])))
        bis = float(b.get("oben_hz", b.get("bis_hz", GRENZEN[i][1])))
        aus.append((NAMEN[i], von, bis, sos))
    k = d.get("k_filter")
    k_sos = _pruefe_sos("k_filter", k["sos"], 2) if isinstance(k, dict) and "sos" in k else [list(z) for z in K_NORM]
    if len(k_sos) != 2:
        raise FormatFehler(f"k_filter: {len(k_sos)} Sektionen statt 2")
    return aus, k_sos
