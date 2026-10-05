"""Kandidaten je Drum-Rolle aus dem Sample-Bestand: filtern nach Künstlernamen, messen, über Künstler gestreut wählen.
Exit: 0 ok, 2 Bedien-/Laufzeitfehler (Bestand unlesbar, Rolle leer, Datei fehlt); Programmierfehler mit Traceback.
Aufruf (aus djk/): python -m klang.kandidaten --rollen klang/rollen.json --aus kandidaten.json"""
import argparse, json, os, re, subprocess, sys, warnings
from pathlib import Path
import numpy as np
from scipy import signal
from klang import lautheit, wav

def _band_db(mono, sr, a, b):
    f, p = signal.welch(mono, sr, nperseg=min(8192, len(mono)))
    return float(10 * np.log10(max(p[(f >= a) & (f < b)].sum(), 1e-20)))

LESEFEHLER = (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired)

class KandidatenFehler(Exception):
    """Bestand oder Lesen ist so kaputt, dass ein Ergebnis irreführend wäre."""

def _messe(pfad, kuenstler, ist_bd):
    x, sr = wav.lies(pfad)
    if not np.isfinite(x).all():
        raise ValueError("nicht_endlich")
    with warnings.catch_warnings():
        # lautheit.baender_db ruft welch mit nperseg=8192 auch auf sehr kurzen Samples; nur diese Warnung schweigt
        warnings.filterwarnings("ignore", message=".*nperseg.*", category=UserWarning)
        return _messe_werte(pfad, kuenstler, ist_bd, x, sr)

def _messe_werte(pfad, kuenstler, ist_bd, x, sr):
    k = {"pfad": str(pfad), "kuenstler": kuenstler, "dauer_s": round(len(x) / sr, 4), "klingt_s": round(klingt_s(x, sr), 4), "anschlaege": anschlaege(x, sr),
         "spitze_db": round(lautheit.sample_spitze_db(x), 2),
         "spitze_ms": round(float(np.abs(x).max(axis=1).argmax()) / sr * 1000, 1),   # 2026-09-30: späte Kicks im Kit techno
         "baender_db": {n: round(v, 2) for n, v in lautheit.baender_db(x, sr).items()}}
    if ist_bd:
        m = x.astype(np.float64).mean(axis=1)
        k["koerper_db"] = round(_band_db(m, sr, 100, 300) - _band_db(m, sr, 40, 80), 2)
    return k

# Schwellen des Einzelschlag-Zählers. Herkunft: ~/messungen/2026-09-29-klang-k1/t4-oneshot.md
ANSTIEG_DB = 9.0                     # Vorgabe Controller 2026-09-29; trennt die 4 Nicht-Einzelschläge (4-10 Anschläge) von 16/16 Kicks
ABFALL_DB = 3.0                      # gesetzt, geprüft an t4-oneshot.md (Kandidaten + 70 Zufallsdateien): erst nach 3 dB Abfall zählt ein Anstieg
ZWEITER_ANSCHLAG_FRUEHESTENS_MS = 30.0   # ab dem ERSTEN Anschlag gemessen; Vorgabe Controller 2026-09-29
FENSTER_DB = 40.0                    # Hüllkurve und `klingt_s` gelten bis 40 dB unter der Spitze; gesetzt, geprüft an t4-oneshot.md (Snare Slam 1: Datei 1,16 s, klingt 0,32 s)

def anschlaege(x, sr, hop_ms=5, fenster_ms=25):
    """Zählt Anschläge auf der Hüllkurve (25-ms-RMS, 5-ms-Schritt, 40 dB unter der Spitze abgeschnitten).
    Neuer Anschlag = Anstieg um >= 9 dB über das Minimum nach einem Abfall (>= 3 dB), frühestens 30 ms nach dem ersten."""
    m = x.astype(np.float64).mean(axis=1)
    h = max(1, int(sr * hop_ms / 1000)); w = max(h, int(sr * fenster_ms / 1000))
    m = np.concatenate([m, np.zeros(w)])
    n = (len(m) - w) // h
    if n <= 0:
        return 0
    c = np.concatenate([[0.0], np.cumsum(m ** 2)])
    idx = np.arange(n) * h
    db = 20 * np.log10(np.maximum(np.sqrt((c[idx + w] - c[idx]) / w), 1e-9))
    boden = db.max() - FENSTER_DB
    if db.max() <= -90.0:
        return 0
    db = np.maximum(db, boden)
    erst = int(np.argmax(db > boden))
    zahl, hoch, tief, scharf = 1, db[erst], 0.0, False
    min_fr = int(np.ceil(ZWEITER_ANSCHLAG_FRUEHESTENS_MS / hop_ms))
    for i in range(erst + 1, n):
        if not scharf:
            hoch = max(hoch, db[i])
            if db[i] <= hoch - ABFALL_DB:
                scharf, tief = True, db[i]
        else:
            tief = min(tief, db[i])
            if db[i] - tief >= ANSTIEG_DB and i - erst >= min_fr:
                zahl += 1
                scharf, hoch = False, db[i]
    return zahl

def klingt_s(x, sr, unter_db=FENSTER_DB):
    """Zeit bis zum letzten Sample, das noch höchstens `unter_db` unter der Spitze liegt (Dateilänge enthält oft stille Ausklänge)."""
    a = np.abs(x).max(axis=1)
    if a.max() <= 0:
        return 0.0
    return float((np.nonzero(a >= a.max() * 10 ** (-unter_db / 20))[0][-1] + 1) / sr)

def _kuenstler_von(name, kuenstler):
    n = name.lower()
    return next((k for k in kuenstler if k.lower() in n), None)

def _rundlauf(gruppen, maximum):
    """Ein Element je Künstler pro Runde, bis `maximum` erreicht oder alles vergeben."""
    reihen = [list(v) for _, v in sorted(gruppen.items())]
    out = []
    while len(out) < maximum and any(reihen):
        for r in reihen:
            if r and len(out) < maximum:
                out.append(r.pop(0))
    return out

def _loese(wert, rolle):
    """Platzhalter ${NAME} in einem Quellpfad aus der Umgebung ersetzen; ungesetzt: klarer Fehler statt Absturz."""
    def ersetze(m):
        v = os.environ.get(m.group(1))
        if not v:
            raise KandidatenFehler(f"Rolle {rolle}: Umgebungsvariable {m.group(1)} ist nicht gesetzt "
                                   f"(Sample-Quelle {wert}; Vorlage djk/konfig/umgebung.env.beispiel)")
        return v
    return re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", ersetze, wert)

def sammle(cfg):
    ergebnis = {}
    for rolle, d in cfg["rollen"].items():
        gruppen = {}
        filt = [s.lower() for s in d.get("name_enthaelt", [])]
        ohne = [s.lower() for s in d.get("name_ohne", [])]
        max_dauer = d.get("max_dauer_s")
        max_spitze = d.get("max_spitze_ms")   # Spitze nach mehr ms klingt neben dem Raster (bd:0 161 ms, bd:4 101 ms)
        gesehen = unlesbar = 0
        for quelle, wurzel in cfg["quellen"].items():
            for ordner in d["ordner"].get(quelle, []):
                pfad = Path(_loese(wurzel, rolle)) / ordner
                if not pfad.is_dir():
                    print(f"WARNUNG: Ordner fehlt: {pfad}", file=sys.stderr)
                    continue
                for f in sorted(pfad.glob("*.wav")):
                    if filt and not all(s in f.name.lower() for s in filt):
                        continue
                    if any(s in f.name.lower() for s in ohne):
                        continue
                    k = _kuenstler_von(f.name, cfg["kuenstler"])
                    if not k:
                        continue
                    gesehen += 1
                    try:
                        m = _messe(f, k, rolle == "bd")
                        if m["anschlaege"] != 1 or (max_dauer is not None and m["klingt_s"] > max_dauer):
                            continue                # kein Einzelschlag (Fill, Swell, Loop, Rolle)
                        if max_spitze is not None and m["spitze_ms"] > max_spitze:
                            continue                # Spitze zu spät: klingt neben dem Takt
                        gruppen.setdefault(k, []).append(m)
                    except LESEFEHLER as e:      # defekte WAV: melden, überspringen; Programmfehler bleiben laut
                        unlesbar += 1
                        print(f"WARNUNG: verworfen ({e}): {f}", file=sys.stderr)
        if gesehen and unlesbar * 2 > gesehen:
            raise KandidatenFehler(f"Rolle {rolle}: {unlesbar} von {gesehen} Dateien unlesbar")
        ergebnis[rolle] = _rundlauf(gruppen, d["max"])
        if gesehen and not ergebnis[rolle]:
            raise KandidatenFehler(f"Rolle {rolle}: leer, obwohl {gesehen} Dateien passten (davon {unlesbar} unlesbar)")
    return ergebnis

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rollen", default=str(Path(__file__).with_name("rollen.json")))
    ap.add_argument("--aus", required=True)
    a = ap.parse_args(argv)
    try:
        out = sammle(json.loads(Path(a.rollen).read_text()))
    except (KandidatenFehler, OSError, json.JSONDecodeError) as e:     # erwartete Laufzeit-/Bedienfehler: Exit 2, kein Traceback
        print(f"FEHLER: {e}; {a.aus} nicht geschrieben", file=sys.stderr)
        raise SystemExit(2)
    text = json.dumps(out, indent=1, ensure_ascii=False, allow_nan=False)
    ziel = Path(a.aus)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    tmp = ziel.with_name(ziel.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, ziel)
    for r, v in out.items():
        print(f"{r}: {len(v)}")

if __name__ == "__main__":
    main()
