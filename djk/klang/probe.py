"""Pegelgleiche Rollen-Proben: je Kandidat ein Loop an den Muster-Positionen der Rolle, auf -18 LUFS normiert.
Aufruf (aus djk): python -m klang.probe --kandidaten k.json --rollen rollen.json --ziel <ordner> [--bpm 130] [--takte 2]"""
import argparse, json, os, subprocess, sys
from pathlib import Path
import numpy as np
from klang import lautheit, schleuse, wav

SR = 48000
ZIEL_LUFS = -18.0
TP_ZIEL = -1.05          # Reserve unter der Schleusen-Grenze (-1.0), damit Rundung nie kippt
MAX_SAMPLE_S = 4.0
KONTEXT_HAT_DB = -10.0   # Rückfall, wenn rollen.json keine spitze_db kennt; sonst spitze_db(hh) - spitze_db(bd)


MAX_AUSKLANG_S = 1.0
AUSBLENDE_ENDE_S = 0.020
FADE_EXP = 6              # 0.25**6 = -72 dB: in den letzten 5 ms der 20-ms-Ausblendung
AUSBLENDE_SCHNITT = 240   # 5 ms bei 48 kHz, wie kit_bauen
FFMPEG_TIMEOUT_S = 60


def wandle(pfad, max_sek: float = MAX_SAMPLE_S) -> np.ndarray:
    """Sample per ffmpeg auf 48 kHz Stereo (float32, Form (n, 2)). Blendet IMMER die letzten 240 Samples (5 ms)
    aus, bitgleich zu kit_bauen.wandle: die Hörprobe klingt wie das spätere Kit."""
    roh = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(pfad), "-t", str(max_sek), "-ar", str(SR),
                          "-ac", "2", "-f", "f32le", "-"], capture_output=True, check=True, timeout=FFMPEG_TIMEOUT_S).stdout
    x = np.frombuffer(roh, dtype="<f4").copy()
    if x.size == 0 or x.size % 2:
        raise ValueError(f"{pfad}: keine Stereo-Daten")
    n = x.size // 2
    aus = min(AUSBLENDE_SCHNITT, n)
    x[2 * (n - aus):] *= np.repeat(np.linspace(1.0, 0.0, aus, dtype="<f4"), 2)
    if not np.all(np.isfinite(x)):
        raise ValueError(f"{pfad}: NaN oder Inf")
    return x.reshape(-1, 2)


def _mische(sample: np.ndarray, muster, bpm: float, takte: int, gain: float = 1.0) -> np.ndarray:
    """`takte` Takte plus natürlicher Ausklang der letzten Stimmen (höchstens 1 s), am Ende 20 ms auf 0 ausgeblendet.
    Keine Faltung: vor dem ersten Schlag ist digital Stille."""
    sech = SR * 60.0 / bpm / 4.0
    takt_n = int(round(takte * 16 * sech))
    puffer = np.zeros((takt_n + len(sample), 2), dtype=np.float64)
    ende = takt_n
    for t in range(takte):
        for m in muster:
            s = int(round((t * 16 + m) * sech))
            puffer[s:s + len(sample)] += sample * gain      # additiv, nichts wird abgeschnitten
            ende = max(ende, s + len(sample))
    ende = min(ende, takt_n + int(MAX_AUSKLANG_S * SR))
    y = puffer[:ende]
    n = min(int(AUSBLENDE_ENDE_S * SR), len(y))
    y[len(y) - n:] *= (np.linspace(1.0, 0.0, n) ** FADE_EXP)[:, None]   # steil genug: letzte 5 ms < -60 dB auch bei Schnitt
    return y.astype(np.float32)


def render(sample, muster, bpm: float = 130.0, takte: int = 2) -> np.ndarray:
    """Sample (Pfad oder Array) an `muster` (Sechzehntel je Takt), `takte` Takte; Länge = takte*4*60/bpm s."""
    x = wandle(sample) if not isinstance(sample, np.ndarray) else sample
    return _mische(x, muster, bpm, takte)


def rendere_muster(klang: np.ndarray, rolle_cfg: dict, sr: int, bpm: float = 130.0, takte: int = 2) -> np.ndarray:
    """Öffentlich (für kit_bauen): bereits gewandeltes Stereo-Sample (n, 2) im Rollenmuster `rolle_cfg["muster"]`."""
    if sr != SR:
        raise ValueError(f"nur {SR} Hz unterstützt, bekommen {sr}")
    return _mische(np.asarray(klang, dtype=np.float32), rolle_cfg["muster"], bpm, takte)


def normiere(x: np.ndarray, sr: int, ziel_lufs: float = ZIEL_LUFS):
    """Auf ziel_lufs integriert; liegt True-Peak danach > -1 dBTP, wird die ganze Probe abgesenkt.
    Rückgabe (y, abgesenkt_db) mit abgesenkt_db >= 0."""
    l = lautheit.integriert(x, sr)
    if not np.isfinite(l):
        raise ValueError("Probe ist still, keine Lautheit messbar")
    y = x * np.float32(10 ** ((ziel_lufs - l) / 20))
    tp = lautheit.true_peak_db(y, sr)
    ab = 0.0
    if tp > -1.0:
        ab = float(tp - TP_ZIEL)
        y = y * np.float32(10 ** (-ab / 20))
    return y.astype(np.float32), ab


def normiere_gruppe(xs, sr: int, ziel_lufs: float = ZIEL_LUFS):
    """Pegelgleich innerhalb einer Gruppe: gemeinsames Ziel = min(ziel_lufs, tiefstes LUFS, bei dem die kritischste
    Probe noch TP <= TP_ZIEL schafft). Rückgabe (ys, gruppen_ziel_lufs)."""
    ls = [lautheit.integriert(x, sr) for x in xs]
    if not all(np.isfinite(l) for l in ls):
        raise ValueError("Probe ist still, keine Lautheit messbar")
    ziel = ziel_lufs
    for x, l in zip(xs, ls):
        tp18 = lautheit.true_peak_db(x, sr) + (ziel_lufs - l)     # TP linear im Gain
        ziel = min(ziel, ziel_lufs - max(0.0, tp18 - TP_ZIEL))
    return [(x * np.float32(10 ** ((ziel - l) / 20))).astype(np.float32) for x, l in zip(xs, ls)], float(ziel)


def _spitze_normiert(x: np.ndarray, db: float) -> np.ndarray:
    return x * np.float32(10 ** (db / 20) / max(float(np.abs(x).max()), 1e-9))


def _eintrag(nr, pfad, k, y, ziel, kontext=False):
    e = {"nr": nr, "pfad": str(pfad), "quelle": k["pfad"], "kuenstler": k.get("kuenstler"),
         "lufs": round(float(lautheit.integriert(y, SR)), 2), "tp": round(float(lautheit.true_peak_db(y, SR)), 2),
         "ziel_lufs": round(ziel, 2)}
    if ziel < ZIEL_LUFS:
        e["abgesenkt_db"] = round(ZIEL_LUFS - ziel, 2)      # Info: Absenkung der ganzen Gruppe
    if kontext:
        e["kontext"] = True
    return e


def _atomar(pfad, schreibe) -> None:
    """schreibe(tmp) in `<pfad>.tmp.<pid>`, dann os.replace; bei Fehler wird tmp entfernt."""
    pfad = Path(pfad)
    pfad.parent.mkdir(parents=True, exist_ok=True)
    tmp = f"{pfad}.tmp.{os.getpid()}"
    try:
        schreibe(tmp)
        os.replace(tmp, pfad)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def rendere(kandidaten: dict, rollen: dict, ziel, bpm: float = 130.0, takte: int = 2) -> dict:
    """Pegelgleichheit gilt je Gruppe (Rolle; bd-Kontext-Varianten eigene Gruppe): alle Proben einer Gruppe
    landen auf demselben LUFS. Index-Einträge tragen `ziel_lufs` der Gruppe."""
    ziel = Path(ziel)
    ziel.mkdir(parents=True, exist_ok=True)
    muster = {r: d["muster"] for r, d in rollen["rollen"].items()}
    rd = rollen["rollen"]
    hat_db = (rd["hh"]["spitze_db"] - rd["bd"]["spitze_db"]) if "spitze_db" in rd.get("hh", {}) and "spitze_db" in rd.get("bd", {}) else KONTEXT_HAT_DB
    hat = None
    if kandidaten.get("hh"):
        try:
            hat = _spitze_normiert(wandle(kandidaten["hh"][0]["pfad"]), 0.0)
        except (ValueError, subprocess.SubprocessError):
            hat = None
    verworfen = []

    def ablehnen(rolle, k, grund, verstoesse, kontext=False):
        verworfen.append({"rolle": rolle, "quelle": k["pfad"], "kuenstler": k.get("kuenstler"),
                          "variante": "kontext" if kontext else "solo", "grund": grund, "verstoesse": verstoesse})

    gruppen = {}   # (rolle, kontext) -> [(nr, k, x)]
    for rolle, liste in kandidaten.items():
        if rolle not in muster:
            continue
        for nr, k in enumerate(liste, 1):
            try:
                s = wandle(k["pfad"])
            except (ValueError, subprocess.SubprocessError) as ex:
                ablehnen(rolle, k, "unlesbar", [str(ex)])
                continue
            gruppen.setdefault((rolle, False), []).append((nr, k, _mische(s, muster[rolle], bpm, takte)))
            if rolle == "bd" and hat is not None and "hh" in muster:
                kick = _mische(_spitze_normiert(s, 0.0), muster["bd"], bpm, takte)
                hats = _mische(hat, muster["hh"], bpm, takte, 10 ** (hat_db / 20))
                x = np.zeros((max(len(kick), len(hats)), 2), dtype=np.float32)   # Ausklänge verschieden lang
                x[:len(kick)] += kick
                x[:len(hats)] += hats
                gruppen.setdefault((rolle, True), []).append((nr, k, x))

    index = {r: [] for r in kandidaten if r in muster}
    for (rolle, kontext), mitglieder in gruppen.items():
        # 1. Vorprüfung: Korrelation/Clips/Stille hängen nicht am Gain; Durchfaller dürfen das Gruppenziel nicht treiben
        ok = []
        for nr, k, x in mitglieder:
            try:
                u = schleuse.urteil(normiere(x, SR)[0], SR)
            except ValueError as ex:
                ablehnen(rolle, k, "still", [str(ex)], kontext)
                continue
            harte = [v for v in u["verstoesse"] if v["kriterium"] != "lautheit"]
            if harte:
                ablehnen(rolle, k, ",".join(v["kriterium"] for v in harte), schleuse.endlich(harte), kontext)
            else:
                ok.append((nr, k, x))
        if not ok:
            continue
        # 2. gemeinsames Gruppenziel, endgültige Prüfung, schreiben
        ys, z = normiere_gruppe([x for _, _, x in ok], SR)
        for (nr, k, _), y in zip(ok, ys):
            u = schleuse.urteil(y, SR)
            if not u["bestanden"]:
                ablehnen(rolle, k, ",".join(v["kriterium"] for v in u["verstoesse"]), schleuse.endlich(u["verstoesse"]), kontext)
                continue
            pfad = ziel / rolle / (f"{nr}_kontext.wav" if kontext else f"{nr}.wav")
            _atomar(pfad, lambda tmp: wav.schreibe(tmp, y, SR))
            index[rolle].append(_eintrag(nr, pfad, k, y, z, kontext))
    for es in index.values():
        es.sort(key=lambda e: (e["nr"], bool(e.get("kontext"))))
    # Indizes erst nach allen WAVs, atomar: ein Abbruch davor lässt den alten Index unberührt
    _atomar(ziel / "index.json", lambda tmp: Path(tmp).write_text(json.dumps(index, indent=1, ensure_ascii=False)))
    _atomar(ziel / "verworfen.json", lambda tmp: Path(tmp).write_text(json.dumps(verworfen, indent=1, ensure_ascii=False)))
    return index


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--kandidaten", required=True); ap.add_argument("--rollen", required=True)
    ap.add_argument("--ziel", required=True); ap.add_argument("--bpm", type=float, default=130.0)
    ap.add_argument("--takte", type=int, default=2)
    a = ap.parse_args(argv)
    try:
        with open(a.kandidaten) as f:
            kand = json.load(f)
        with open(a.rollen) as f:
            rol = json.load(f)
        idx = rendere(kand, rol, a.ziel, a.bpm, a.takte)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as ex:
        print(f"FEHLER: {type(ex).__name__}: {ex}", file=sys.stderr)
        return 2
    n = sum(len(v) for v in idx.values())
    print(f"{n} Proben in {a.ziel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
