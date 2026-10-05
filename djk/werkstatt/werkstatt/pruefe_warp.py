"""Scheibe 15, Messung der Warp-Mechanik (offline, stumm): synthetischer Driftklick aus proben/07 b_timemap.py mit
wahrer Karte, mit und ohne Timemap (FEHLERFALL), starrer 134er-Klick (NEGATIV-KONTROLLE), Ankerabstand 1/2/4/8
Ziel-Beats (Vergleich), -12 dB Luft an mfb_voll_8.wav (FEHLERFALL ohne Luft klemmt, 08 NP K5).
Schreibt berichte/15-warp.json und berichte/15-warp.md. Arbeitsdateien unter pruef/warp/ (nicht versioniert).

Aufruf (aus djk/werkstatt): nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.pruefe_warp"""
import json
import os
import time
from pathlib import Path

import numpy as np

from . import kontrollen as K
from .eingang import geklemmt, lade_stereo48, luft, schreibe_float_wav, spitze_dbfs
from .karte import Karte
from .rastermessung import miss_starr
from .warp import SR, lies_float_wav, schreibe_f32, timemap, warp

HIER = Path(__file__).resolve().parent.parent
ARBEIT = HIER / "pruef" / "warp"
LOOP_MFB = K.WURZEL / "loops" / "mfb_voll_8.wav"
LOOP_MFB_SHA = "01f4f5401fd1f3408dcc4f9e18a2f0eabaccef88fc8737aa3fc26fe17d04b344"
GRENZE = {"mit_rms_ms": 0.19, "mit_max_ms": 0.58, "ohne_rms_ms_min": 40.0, "konst_drift_ms_pro_min": 0.5}


def fall(name, wahr, mit_timemap=True, abstand=2.0):
    pfad = K.pruefe(*K.KONTROLLEN[name])
    x = lade_stereo48(pfad)
    karte = Karte(sekunden=np.asarray(wahr, float), beats=np.arange(len(wahr), dtype=float))
    tm = timemap(karte, 128.0, len(x), abstand_beats=abstand)
    ein = ARBEIT / f"{name}_luft.wav"
    if not ein.exists():
        schreibe_float_wav(luft(x), ein)
    aus = ARBEIT / f"{name}_{'mit' if mit_timemap else 'ohne'}_{abstand:g}.wav"
    t0 = time.perf_counter()
    warp(ein, aus, tm, mit_timemap=mit_timemap)
    dt = time.perf_counter() - t0
    y = lies_float_wav(aus)
    f32 = aus.with_suffix(".f32")
    schreibe_f32(y, f32)
    soll = (tm.erster_schlag_frame + np.arange(len(wahr)) * 22500) / SR
    e = miss_starr(f32, 128.0, soll)
    e.update({"anker": int(len(tm.quelle)), "frames": int(len(y)), "ziel_frames": int(tm.ziel_frames),
              "erster_schlag_frame": int(tm.erster_schlag_frame), "geklemmt": geklemmt(y), "warp_s": round(dt, 2)})
    return e


def luft_fall():
    K.pruefe(LOOP_MFB, LOOP_MFB_SHA)
    x = lade_stereo48(LOOP_MFB)
    tm = timemap(Karte(sekunden=np.arange(32) * 60.0 / 134.0, beats=np.arange(32.0)), 128.0, len(x))
    erg = {}
    for name, ein in (("ohne_luft", x), ("mit_luft", luft(x))):
        w = ARBEIT / f"mfb_{name}.wav"
        schreibe_float_wav(ein, w)
        warp(w, ARBEIT / f"mfb_{name}_warp.wav", tm)
        y = lies_float_wav(ARBEIT / f"mfb_{name}_warp.wav")
        erg[name] = {"eingang_spitze_dbfs": spitze_dbfs(ein), "ausgang_spitze_dbfs": spitze_dbfs(y), "geklemmt": geklemmt(y)}
    return erg


def main():
    ARBEIT.mkdir(parents=True, exist_ok=True)
    last_vor = os.getloadavg()[0]
    d, k = K.wahrheit_drift(), K.wahrheit_konst134()
    erg = {"drift_synth/mit": fall("drift_synth", d), "drift_synth/ohne": fall("drift_synth", d, mit_timemap=False),
           "konst134/mit": fall("konst134", k), "konst134/ohne": fall("konst134", k, mit_timemap=False)}
    erg["anker"] = {f"{n}/{a:g}": fall(n, w, abstand=a) for n, w in (("konst134", k), ("drift_synth", d))
                    for a in (1.0, 2.0, 4.0, 8.0)}
    erg["luft"] = luft_fall()
    erg["last_vor_nach"] = [round(last_vor, 2), round(os.getloadavg()[0], 2)]
    dm, do, km = erg["drift_synth/mit"], erg["drift_synth/ohne"], erg["konst134/mit"]
    erg["urteil"] = {
        "mechanik": dm["rest_rms_ms"] <= GRENZE["mit_rms_ms"] and dm["rest_max_ms"] <= GRENZE["mit_max_ms"],
        "fehlerfall_ohne_timemap": do["rest_rms_ms"] >= GRENZE["ohne_rms_ms_min"],
        "konst134_starr": km["rest_rms_ms"] <= GRENZE["mit_rms_ms"]
                          and abs(km["drift_linear_ms_pro_min"]) <= GRENZE["konst_drift_ms_pro_min"]
                          and km["gegen_soll"]["gepaart"] == km["gegen_soll"]["von"],
        "luft_klemmt_nicht": erg["luft"]["mit_luft"]["geklemmt"] == 0 and erg["luft"]["ohne_luft"]["geklemmt"] > 0}
    (HIER / "berichte").mkdir(exist_ok=True)
    (HIER / "berichte" / "15-warp.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False) + "\n")
    z = ["# Scheibe 15: Warp-Mechanik (offline, stumm)", "",
         f"Last 1 min vor/nach: {erg['last_vor_nach'][0]} / {erg['last_vor_nach'][1]}. Instrument: `rastermessung.miss_starr` "
         "(Klick-Einsätze, Hochpass 500 Hz, Rest gegen das starre 128er-Raster, Median ab; wie `b_timemap.py`).", "",
         "| Fall | Einsätze | Rest RMS ms | Rest max ms | Drift ms/min | gegen Soll gepaart | Anker | geklemmt |",
         "|---|---|---|---|---|---|---|---|"]
    for n in ("drift_synth/mit", "drift_synth/ohne", "konst134/mit", "konst134/ohne"):
        e = erg[n]
        z.append(f"| {n} | {e['einsaetze']} | {e['rest_rms_ms']} | {e['rest_max_ms']} | {e['drift_linear_ms_pro_min']} | "
                 f"{e['gegen_soll']['gepaart']}/{e['gegen_soll']['von']} | {e['anker']} | {e['geklemmt']} |")
    z += ["", "## Ankerabstand (Ziel-Beats)", "", "| Fall | Rest RMS ms | Rest max ms | Drift ms/min | Anker |", "|---|---|---|---|---|"]
    for n, e in erg["anker"].items():
        z.append(f"| {n} | {e['rest_rms_ms']} | {e['rest_max_ms']} | {e['drift_linear_ms_pro_min']} | {e['anker']} |")
    z += ["", "## −12 dB Luft (mfb_voll_8.wav, 134 → 128)", "", "| Fall | Spitze Eingang dBFS | Spitze Ausgang dBFS | geklemmt |",
          "|---|---|---|---|"]
    for n, e in erg["luft"].items():
        z.append(f"| {n} | {e['eingang_spitze_dbfs']} | {e['ausgang_spitze_dbfs']} | {e['geklemmt']} |")
    z += ["", "## Urteil", ""] + [f"- {n}: {'ja' if v else 'NEIN'}" for n, v in erg["urteil"].items()]
    (HIER / "berichte" / "15-warp.md").write_text("\n".join(z) + "\n")
    print("\n".join(z))
    return 0 if all(erg["urteil"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
