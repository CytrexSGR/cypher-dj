"""Abnahme der Scheibe 05 gegen den eigenen Bericht. Die Grenzen stehen mit Begruendung im Plan
(docs/superpowers/plans/2026-09-23-djk-05-werkstatt-raster.md, Task 9); hier nur als Zahlen.

  python -m werkstatt.abnahme BERICHT.json [--umgebung berichte/05-umgebung.txt] [--nur-kontrollen]

Jede Zeile: OK, RISS (vorhergesagt) oder RISS. Exit 0, wenn kein unvorhergesagter RISS dabei ist."""
import argparse, json, sys
from pathlib import Path

from . import kontrollen as K

ROADMAP_NULL_MS = 1.0        # Steckbrief 05: beat_this gegen Essentia p90 <= 1 ms; auch „Rest nahe 0“
TOR_RASTER_MS = 8.0          # §2.1 tor_raster_ms (Flam-Untergrenze)
FESTE_BPM_FEHLERFALL_MS = 40.0
BPM_TOLERANZ = 0.05
KONTROLLEN = ("konst134", "drift_synth", "mfbass", "eins_synth")
SYNTHETISCH = ("konst134", "drift_synth", "eins_synth")
RASTER_FELDER = ["abweichung_ms_p90", "erste_eins_quell_beat", "erste_eins_zweitverfahren", "erster_schlag_quelle_s",
                 "pulsklarheit", "taktart", "tempo_vielfaches", "werkzeug", "zweitwerkzeug"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("bericht", type=Path)
    ap.add_argument("--umgebung", type=Path)
    ap.add_argument("--nur-kontrollen", action="store_true")
    a = ap.parse_args(argv)
    daten = json.loads(a.bericht.read_text())
    d = {e["name"]: e for e in daten["dateien"]}
    ergebnis = {"unvorhergesagt": 0}

    def zeile(ok, text, vorhergesagt=False):
        if ok:
            print("OK                 ", text)
        elif vorhergesagt:
            print("RISS (vorhergesagt)", text)
        else:
            print("RISS               ", text)
            ergebnis["unvorhergesagt"] += 1

    if a.umgebung:
        z = a.umgebung.read_text().splitlines()
        vor = [l.split(" ", 1)[1] for l in z if l.startswith("VORHER ")]
        nach = [l.split(" ", 1)[1] for l in z if l.startswith("NACHHER ")]
        zeile(len(vor) == 1 and vor == nach and "cu" in vor[0], f"UMGEBUNG torch vorher {vor} nachher {nach}")

    k, dr, mf, es = (d[n] for n in KONTROLLEN)
    form, form_gcv = k["vergleich_essentia"]["form_p90_ms"], k["vergleich_essentia_gcv"]["form_p90_ms"]
    zeile(k["karte_info"]["modell"] == "gerade" and k["karte_gegen_gerade"]["form_p90_ms"] == 0.0,
          f"NULL konst134 Karte konstant: Modell {k['karte_info']['modell']}, "
          f"gegen Gerade p90 {k['karte_gegen_gerade']['form_p90_ms']} ms")
    zeile(abs(k["bpm_beat_this"] - 134.0) <= BPM_TOLERANZ, f"NULL konst134 Karte {k['bpm_beat_this']} BPM (134 ± {BPM_TOLERANZ})")
    zeile(form is not None and form <= ROADMAP_NULL_MS,
          f"NULL konst134 beat_this gegen Essentia Form p90 {form} ms (≤ {ROADMAP_NULL_MS})")
    zeile(form_gcv is not None and form_gcv > ROADMAP_NULL_MS,
          f"FEHLERFALL konst134 dasselbe mit GCV-Glaettung Form p90 {form_gcv} ms (> {ROADMAP_NULL_MS})")
    rk, rkf = k["rest_beat_this"], k["rest_feste_bpm"]
    zeile(rk["rest_p90_ms"] <= ROADMAP_NULL_MS and rkf["rest_p90_ms"] <= ROADMAP_NULL_MS,
          f"NEGATIV konst134 Rest Karte p90 {rk['rest_p90_ms']} ms, feste BPM p90 {rkf['rest_p90_ms']} ms (≤ {ROADMAP_NULL_MS})")
    rd, rdf = dr["rest_beat_this"], dr["rest_feste_bpm"]
    zeile(dr["karte_info"]["modell"] == "spline" and rd["rest_rms_ms"] <= TOR_RASTER_MS,
          f"POSITIV drift_synth Modell {dr['karte_info']['modell']}, Rest Karte RMS {rd['rest_rms_ms']} ms (≤ {TOR_RASTER_MS})")
    zeile(rd["rest_p90_ms"] <= TOR_RASTER_MS, f"POSITIV drift_synth Rest Karte p90 {rd['rest_p90_ms']} ms (Tor ≤ {TOR_RASTER_MS})",
          vorhergesagt=True)
    zeile(rdf["rest_rms_ms"] > FESTE_BPM_FEHLERFALL_MS,
          f"FEHLERFALL drift_synth feste BPM RMS {rdf['rest_rms_ms']} ms (> {FESTE_BPM_FEHLERFALL_MS})")
    zeile(abs(mf["bpm_beat_this"] - 134.0) <= BPM_TOLERANZ, f"REFERENZ mfbass {mf['bpm_beat_this']} BPM (134 ± {BPM_TOLERANZ})")
    zeile(es["eins_beat_this"] == es["eins_tiefband"] == es["eins_erwartet"],
          f"EINS eins_synth beat_this {es['eins_beat_this']} Tief-Band {es['eins_tiefband']} eingebaut {es['eins_erwartet']}")

    if not a.nur_kontrollen:
        songs = [e for e in daten["dateien"] if e["name"] not in SYNTHETISCH]
        quelle = sorted(p.name for p in K.BESTAND_SONGS.iterdir() if p.suffix.lower() in (".mp3", ".flac", ".wav"))
        am_ziel = sorted(e["name"] for e in daten["dateien"] if e["name"] not in KONTROLLEN)
        zeile(am_ziel == quelle, f"DATEIEN {len(am_ziel)} Songs im Bericht, {len(quelle)} unter samples/bestand/")
        voll = all(len(e["tempo_karte_quelle"]) >= 8 and sorted(e["raster"]) == RASTER_FELDER for e in daten["dateien"])
        zeile(voll, f"FORM §13.2 je Datei tempo_karte_quelle (≥ 8 Eintraege) und raster mit {len(RASTER_FELDER)} Feldern")
        gleich = sum(1 for e in songs if e["eins_gleich"])
        zeile(True, f"EINS beide Verfahren gleich bei {gleich} von {len(songs)} Songs (gezaehlt, keine Grenze)")
        einig = sum(1 for e in songs if e["werkzeuge_einig"])
        zeile(True, f"WERKZEUGE einig bei {einig} von {len(songs)} Songs (Form p90 ≤ {TOR_RASTER_MS} ms, sonst Warnung)")
        gerade = sum(1 for e in songs if e["karte_info"]["modell"] == "gerade")
        zeile(True, f"MODELL Gerade bei {gerade} von {len(songs)} Songs, sonst Spline")
        v = {x: sum(1 for e in songs if e["tempo_vielfaches"] == x) for x in (0.5, 1.0, 2.0)}
        tor = sum(1 for e in songs if e["tor_streckfaktor_ok"])
        zeile(True, f"TEMPO-WAHL v=0,5: {v[0.5]}, v=1: {v[1.0]}, v=2: {v[2.0]}; Tor streckfaktor ok bei {tor} von {len(songs)}")
        lz = sorted(e["laufzeit_s"]["gesamt"] for e in songs if e["name"] != "mfbass")
        kopf = daten["kopf"]
        zeile(True, f"LAUFZEIT je Song {lz[0]} bis {lz[-1]} s (samples/bestand, Geraet {kopf['geraet']}), "
                    f"Fremdlast vor {kopf['last_vor']:.2f} nach {kopf['last_nach']:.2f}"
                    + (" (ueber 4: vorlaeufig, M10)" if max(kopf["last_vor"], kopf["last_nach"]) > 4 else ""))
    print("UNVORHERGESEHENE RISSE", ergebnis["unvorhergesagt"])
    return 1 if ergebnis["unvorhergesagt"] else 0


if __name__ == "__main__":
    sys.exit(main())
