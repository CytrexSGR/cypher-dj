"""Scheibe 05: Tempo-Karte (beat_this, Zweitwerkzeug Essentia), Takt-Eins (Downbeat und
Tief-Band) und Tempo-Wahl zur Basis 128 fuer die Kontrollen und alle Songs unter samples/bestand/.
Schreibt berichte/05-raster.json (alles, samt Karten in der Form von §13.2) und
berichte/05-raster.md (Tabellen). Schreibt nichts in den Bestand.

Aufruf (aus djk/werkstatt): nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.lauf_raster [--nur a,b] [--aus DIR]"""
import argparse, json, os, sys, time
from pathlib import Path
import numpy as np

from . import kontrollen as K
from .audio import lade_mono
from .eins import eins_beat_this, eins_tiefband
from .phase import verfeinere_schlaege
from .karte import karte_aus_schlaegen, karte_fest, rest_gegen_wahrheit, vergleiche
from .raster_werkzeuge import SR_BEAT_THIS, SR_ESSENTIA, beat_this, essentia_schlaege
from .tempo_wahl import tor_streckfaktor, waehle_vielfaches

HIER = Path(__file__).resolve().parent.parent
BASIS = 128.0
FAEDEN = 4           # werkstatt.toml `threads`, Vorgabe 4 (SCHNITTSTELLEN §2.1)
TOR_RASTER_MS = 8.0  # werkstatt.toml `tor_raster_ms` (§2.1): hier Grenze fuer „Werkzeuge einig“ (ADR 011 E2.2)
KONTROLL_NAMEN = ("konst134", "drift_synth", "mfbass", "eins_synth")


def c_drift_werte():
    """bpm_fest und klarheit_median je Datei aus proben/07 c_drift.json (Vergleich, Pulsklarheit)."""
    return {Path(e["datei"]).name: e for e in json.loads((K.PROBEN07 / "c_drift.json").read_text())}


def eins_erwartet(karte, eins_zeiten):
    """Lage mod 4 der bekannten Takt-Einsen im Bereich der Karte (Mehrheit)."""
    z = np.asarray(eins_zeiten, dtype=float)
    z = z[(z >= karte.sekunden[0]) & (z <= karte.sekunden[-1])]
    if len(z) == 0:
        return None
    return int(np.argmax(np.bincount(np.rint(karte.beat_bei(z)).astype(int) % 4, minlength=4)))


def miss(name, pfad, wahrheit=None, eins_zeiten=None, cd=None, geraet="cpu"):
    last_vor = os.getloadavg()[0]
    zeit = {}
    t0 = time.perf_counter()
    x22 = lade_mono(pfad, SR_BEAT_THIS)
    x44 = lade_mono(pfad, SR_ESSENTIA)
    zeit["dekodieren"] = time.perf_counter() - t0
    t = time.perf_counter()
    schlaege, downbeats = beat_this(x22, geraet=geraet)
    zeit["beat_this"] = time.perf_counter() - t
    t = time.perf_counter()
    ticks, ess_bpm_global, ess_konfidenz = essentia_schlaege(x44)
    schlaege_bt = np.asarray(schlaege, dtype=float)
    schlaege, verfeinerung = verfeinere_schlaege(x44, SR_ESSENTIA, schlaege_bt)   # 2026-10-09: auf die Anschlaege
    zeit["essentia"] = time.perf_counter() - t
    t = time.perf_counter()
    k1 = karte_aus_schlaegen(schlaege)
    bpm = k1.bpm_gesamt()
    v, faktor = waehle_vielfaches(bpm, BASIS)
    karte = k1.gezaehlt(v)
    ke1 = karte_aus_schlaegen(ticks)
    oktave = min((1.0, 2.0, 0.5), key=lambda o: abs(ke1.bpm_gesamt() * o / bpm - 1.0))
    ke = ke1.gezaehlt(v * oktave)
    vgl = vergleiche(karte, ke)
    gerade = vergleiche(karte_fest(schlaege), k1)
    einig = vgl["form_p90_ms"] is not None and vgl["form_p90_ms"] <= TOR_RASTER_MS
    warnungen = ([] if verfeinerung["verfeinert"] else [f"Raster nicht an Anschlaegen verfeinert: {verfeinerung['grund']}"])
    warnungen += [] if einig else [f"Raster-Werkzeuge uneinig: Form p90 {vgl['form_p90_ms']} ms "
                                  f"(beat_this {bpm:.3f}, Essentia {ke1.bpm_gesamt():.3f} BPM)"]
    zeit["karte"] = time.perf_counter() - t
    t = time.perf_counter()
    eins_bt, zaehlung = eins_beat_this(downbeats, karte)
    eins_tb, vorsprung, energie = eins_tiefband(x22, SR_BEAT_THIS, karte)
    zeit["eins"] = time.perf_counter() - t
    zeit["gesamt"] = time.perf_counter() - t0
    e = {"name": name, "datei": str(pfad), "dauer_s": round(len(x22) / SR_BEAT_THIS, 1),
         "schlaege_roh": int(len(schlaege)), "downbeats_roh": int(len(downbeats)), "karte_info": k1.info,
         "karte_essentia_info": ke1.info,
         "karte_von_s": round(float(karte.sekunden[0]), 3), "karte_bis_s": round(float(karte.sekunden[-1]), 3),
         "bpm_beat_this": round(bpm, 3), "bpm_essentia_karte": round(ke1.bpm_gesamt(), 3),
         "bpm_essentia_global": round(ess_bpm_global, 3), "essentia_oktave": oktave,
         "bpm_lokal_p10_p90": [round(float(np.percentile(k1.bpm_lokal(), p)), 3) for p in (10, 90)],
         "bpm_c_drift": cd.get("bpm_fest") if cd else None,
         "tempo_vielfaches": v, "streckfaktor": round(faktor, 4), "tor_streckfaktor_ok": tor_streckfaktor(faktor),
         "vergleich_essentia": vgl, "werkzeuge_einig": einig, "warnungen": warnungen,
         "karte_gegen_gerade": gerade,
         "eins_beat_this": eins_bt, "eins_zaehlung": zaehlung, "eins_tiefband": eins_tb,
         "eins_vorsprung": vorsprung, "eins_gleich": eins_bt is not None and eins_bt == eins_tb,
         "laufzeit_s": {k: round(w, 2) for k, w in zeit.items()},
         "last_vor_nach": [round(last_vor, 2), round(os.getloadavg()[0], 2)],
         "raster": {"werkzeug": "beat_this", "zweitwerkzeug": "essentia",
                    "abweichung_ms_p90": vgl["form_p90_ms"],
                    "pulsklarheit": cd.get("klarheit_median") if cd else None,
                    "erster_schlag_quelle_s": round(float(karte.sekunden[0]), 6), "taktart": 4,
                    "tempo_vielfaches": v, "erste_eins_quell_beat": eins_bt,
                    "erste_eins_zweitverfahren": eins_tb},
         "tempo_karte_quelle": karte.als_liste(),
         "verfeinerung": verfeinerung,
         "roh": {"schlaege_s": [round(float(s), 4) for s in schlaege_bt],
                 "downbeats_s": [round(float(s), 4) for s in downbeats],
                 "essentia_ticks_s": [round(float(s), 6) for s in ticks]}}
    if wahrheit is not None:
        e["rest_beat_this"] = rest_gegen_wahrheit(k1, wahrheit)
        e["rest_feste_bpm"] = rest_gegen_wahrheit(karte_fest(schlaege), wahrheit)
        e["rest_essentia"] = rest_gegen_wahrheit(ke1, wahrheit)
        # Vergleich mit der scipy-Vorgabe GCV (Fehlerfall der Glaettung, Plan 05 Task 3 und 7)
        kg, keg = karte_aus_schlaegen(schlaege, glaettung="gcv"), karte_aus_schlaegen(ticks, glaettung="gcv")
        e["rest_beat_this_gcv"] = rest_gegen_wahrheit(kg, wahrheit)
        e["vergleich_essentia_gcv"] = vergleiche(kg.gezaehlt(v), keg.gezaehlt(v * oktave))
        e["karte_gegen_gerade_gcv"] = vergleiche(karte_fest(schlaege), kg)
    if eins_zeiten is not None:
        e["eins_erwartet"] = eins_erwartet(karte, eins_zeiten)
    return e


def ziele():
    cd = c_drift_werte()
    mf = K.referenz_mfbass()
    eins_pfad = HIER / "kontrollen" / "eins_synth.wav"
    eins_schlaege, eins_zeiten = K.erzeuge_eins_synth(eins_pfad)
    K.pruefe(eins_pfad, K.EINS_SYNTH_SHA256)
    per = 60.0 / mf["bpm"]
    mf_einsen = mf["eins_s"] + 4 * per * np.arange(int(600 / (4 * per)))
    liste = [("konst134", K.pruefe(*K.KONTROLLEN["konst134"]), K.wahrheit_konst134(), None, None),
             ("drift_synth", K.pruefe(*K.KONTROLLEN["drift_synth"]), K.wahrheit_drift(), None, None),
             ("mfbass", K.pruefe(*K.KONTROLLEN["mfbass"]), None, mf_einsen, cd.get("orig.mp3")),
             ("eins_synth", eins_pfad, eins_schlaege, eins_zeiten, None)]
    for p in sorted(K.BESTAND_SONGS.iterdir()):
        if p.suffix.lower() in (".mp3", ".flac", ".wav"):
            liste.append((p.name, p, None, None, cd.get(p.name)))
    return liste


def f(x, n=2):
    return "–" if x is None else f"{x:.{n}f}".replace(".", ",")


def f_ms(x):
    """Millisekunden fuer die Tabelle; ueber einer Sekunde zaehlt nur noch „uneinig“."""
    return "> 1000" if x is not None and x > 1000 else f(x)


def f_modell(info):
    return "Gerade" if info["modell"] == "gerade" else f"Spline h {f(info['h_schlaege'], 1)}"


def bericht_md(alle, kopf):
    z = [f"# Scheibe 05: Tempo-Karte und Takt-Eins der Quelle", "",
         f"*Erzeugt {kopf['zeit']} von `werkstatt/lauf_raster.py`, torch {kopf['torch']} (CUDA {kopf['cuda']}), "
         f"Gerät {kopf['geraet']}, {FAEDEN} Fäden, Fremdlast (1-min) vor {f(kopf['last_vor'])} nach {f(kopf['last_nach'])}. "
         "Rest = Karte gegen bekannte Schlagzeiten, konstanter Versatz abgezogen und getrennt als „Versatz“ "
         "(positiv = Karte später). Form = beat_this-Karte gegen Essentia-Karte, Versatz abgezogen. "
         "Karte: Modellwahl per Block-Kreuzvalidierung (Gerade oder Spline mit Kernbreite h Schläge); "
         "GCV ist die scipy-Vorgabe, hier nur als Vergleich.*", "",
         "## Kontrollen mit bekannter Wahrheit", "",
         "| Kontrolle | Modell | BPM Karte | Rest beat_this RMS / p90 / max ms | Versatz ms | Rest feste BPM RMS / p90 ms | "
         "Rest Essentia RMS / p90 ms | Form bt–Ess p90 ms | Rest GCV RMS / p90 ms | Form bt–Ess p90 GCV ms |",
         "|---|---|---|---|---|---|---|---|---|---|"]
    for e in alle:
        if "rest_beat_this" in e:
            r, rf, re_, v = e["rest_beat_this"], e["rest_feste_bpm"], e["rest_essentia"], e["vergleich_essentia"]
            rg, vg = e["rest_beat_this_gcv"], e["vergleich_essentia_gcv"]
            z.append(f"| {e['name']} | {f_modell(e['karte_info'])} | {f(e['bpm_beat_this'], 3)} | "
                     f"{f(r['rest_rms_ms'])} / {f(r['rest_p90_ms'])} / {f(r['rest_max_ms'])} | {f(r['versatz_ms'])} | "
                     f"{f(rf['rest_rms_ms'])} / {f(rf['rest_p90_ms'])} | {f(re_['rest_rms_ms'])} / {f(re_['rest_p90_ms'])} | "
                     f"{f(v['form_p90_ms'])} | {f(rg['rest_rms_ms'])} / {f(rg['rest_p90_ms'])} | {f(vg['form_p90_ms'])} |")
    z += ["", "## Alle Dateien", "",
          "| Datei | Dauer s | Schläge roh / Kette (Ketten) | Karte von–bis s | Modell | BPM beat_this | BPM c_drift | "
          "BPM Essentia | Karte gegen Gerade p90 ms | v | Streckfaktor | Tor ±0,15 | Form bt–Ess p90 ms | Werkzeuge | "
          "Versatz bt–Ess ms | Eins bt (Zählung) | Eins Tief (Vorsprung) | gleich | Eins erwartet | "
          "Laufzeit bt / Ess / Karte / gesamt s |",
          "|" + "---|" * 20]
    for e in alle:
        i, v, lz = e["karte_info"], e["vergleich_essentia"], e["laufzeit_s"]
        z.append(f"| {e['name']} | {f(e['dauer_s'], 1)} | {e['schlaege_roh']} / {i['kette_schlaege']} ({i['ketten']}) | "
                 f"{f(e['karte_von_s'], 1)}–{f(e['karte_bis_s'], 1)} | {f_modell(i)} | {f(e['bpm_beat_this'], 3)} | "
                 f"{f(e['bpm_c_drift'], 3)} | {f(e['bpm_essentia_karte'], 3)} | {f(e['karte_gegen_gerade']['form_p90_ms'])} | "
                 f"{e['tempo_vielfaches']:g} | {f(e['streckfaktor'], 4)} | "
                 f"{'ok' if e['tor_streckfaktor_ok'] else 'reißt'} | {f_ms(v['form_p90_ms'])} | "
                 f"{'einig' if e['werkzeuge_einig'] else 'uneinig'} | {f_ms(v['versatz_ms'])} | "
                 f"{e['eins_beat_this']} ({'/'.join(map(str, e['eins_zaehlung']))}) | {e['eins_tiefband']} "
                 f"({f(e['eins_vorsprung'], 3)}) | {'ja' if e['eins_gleich'] else 'nein'} | "
                 f"{'–' if e.get('eins_erwartet') is None else e['eins_erwartet']} | "
                 f"{f(lz['beat_this'], 1)} / {f(lz['essentia'], 1)} / {f(lz['karte'], 1)} / {f(lz['gesamt'], 1)} |")
    songs = [e for e in alle if e["name"] not in ("konst134", "drift_synth", "eins_synth")]
    gleich = sum(1 for e in songs if e["eins_gleich"])
    einig = sum(1 for e in songs if e["werkzeuge_einig"])
    z += ["", "## Takt-Eins", "",
          f"beat_this-Downbeat und Tief-Band-Verfahren stimmen bei **{gleich} von {len(songs)}** Songs überein "
          "(mfbass und `samples/bestand/`; die drei synthetischen Kontrollen zählen nicht mit). Bekannte Eins nur bei "
          "`eins_synth` (eingebaut); bei mfbass steht in „Eins erwartet“ der Traktor-AutoGrid-Anker aus der ID3, "
          "kein geprüfter Downbeat. Bei v = 2 kann beat_this nur die Lagen 0 und 2 treffen.",
          "", "## Werkzeuge und Warnungen", "",
          f"beat_this und Essentia sind bei **{einig} von {len(songs)}** Songs einig (Form p90 ≤ {f(TOR_RASTER_MS, 1)} ms, "
          "`tor_raster_ms`); jede Uneinigkeit ist nach ADR 011 eine Warnung. „Karte gegen Gerade“ ist die Abweichung "
          "der beat_this-Karte vom besten festen Tempo (p90, Median ab): so weit wiche ein Warp mit fester BPM von dem "
          "mit der Karte ab.", ""]
    for e in alle:
        for w in e["warnungen"]:
            z.append(f"- {e['name']}: {w}")
    return "\n".join(z) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--nur", default="")
    ap.add_argument("--aus", type=Path, default=HIER / "berichte")
    ap.add_argument("--geraet", default="cpu")
    a = ap.parse_args(argv)
    import torch
    torch.set_num_threads(FAEDEN)
    nur = set(filter(None, a.nur.split(",")))
    kopf = {"zeit": time.strftime("%Y-%m-%d %H:%M"), "torch": torch.__version__, "cuda": torch.version.cuda,
            "geraet": a.geraet, "last_vor": os.getloadavg()[0]}
    alle = []
    for name, pfad, wahrheit, einsen, cd in ziele():
        if nur and name not in nur:
            continue
        e = miss(name, pfad, wahrheit, einsen, cd, a.geraet)
        alle.append(e)
        print(f"{name:34s} bpm {e['bpm_beat_this']:8.3f} v {e['tempo_vielfaches']:g} f {e['streckfaktor']:.4f} "
              f"{e['karte_info']['modell']:6s} form {e['vergleich_essentia']['form_p90_ms']} "
              f"eins {e['eins_beat_this']}/{e['eins_tiefband']} zeit {e['laufzeit_s']['gesamt']:.1f}s"
              + (f" rest {e['rest_beat_this']['rest_rms_ms']}/{e['rest_beat_this']['rest_p90_ms']}"
                 f" fest {e['rest_feste_bpm']['rest_rms_ms']}" if "rest_beat_this" in e else ""), flush=True)
    kopf["last_nach"] = os.getloadavg()[0]
    a.aus.mkdir(parents=True, exist_ok=True)
    (a.aus / "05-raster.json").write_text(json.dumps({"kopf": kopf, "dateien": alle}, ensure_ascii=False, indent=1))
    (a.aus / "05-raster.md").write_text(bericht_md(alle, kopf))
    print("->", a.aus / "05-raster.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
