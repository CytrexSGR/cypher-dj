"""Phase des Rasters gegen die Anschlaege, gemessen auf der fertigen Fassung (basis.f32, starres Raster der Basis).

beat_this rechnet in 20-ms-Frames; die Karte trifft das Tempo, legt die Schlaege aber je Song einige Millisekunden
hinter den Anschlag (gemessen 2026-10-09, ~/messungen/2026-10-09-grid-phase-orakel: Acid +11,6 ms, Numero Uno
+5,2 ms; Ableton liegt dort bei -1,3 / -1,0 ms). Dieses Modul misst den konstanten Versatz je Fassung; `lauf_phase`
schreibt ihn als Korrektur `raster` (von werkstatt) und laesst `korrigieren` die naechste Fassung rechnen.

Instrument: Einsatz = letzter Punkt unter 20 % zwischen Fenster-Minimum und -Spitze der Hilbert-Huellkurve im Band
2 bis 8 kHz (0,5 ms geglaettet), je Rasterschlag im Fenster +-FENSTER_S. Geeicht an synthetischen Kicks mit bekannter
Zeit (WAV und MP3 320k gleich): -0,23 ms Median, p90 0,29 ms. Das Tiefband taugt dafuer nicht: Basslinien (303)
ziehen es um Dutzende Millisekunden."""
import numpy as np
from scipy.signal import butter, hilbert, sosfiltfilt

SR = 48000
BAND_HZ = (2000.0, 8000.0)
GLATT_S = 0.0005
FENSTER_S = 0.06           # Suchfenster je Schlag; 16tel-Hats bei 128 BPM liegen 117 ms daneben
SCHWELLE = 0.2             # Anteil zwischen Minimum und Spitze
KLAR = 3.0                 # Spitze muss das Dreifache des Medians der Sekunde davor erreichen
TOR_ANTEIL = 0.6           # mindestens 60 % der Schlaege mit klarem Einsatz
TOR_STREUUNG_MS = 20.0     # p90 - p10 der Einzelabstaende
TOR_BETRAG_MS = 40.0       # mehr ist kein Phasenfehler, sondern ein anderes Problem (Halbschlag, Eins)
MIN_BETRAG_MS = 1.0        # darunter lohnt keine neue Fassung


def huelle(x, sr=SR):
    sos = butter(4, BAND_HZ, "bandpass", fs=sr, output="sos")
    env = np.abs(hilbert(sosfiltfilt(sos, x)))
    n = max(1, int(GLATT_S * sr))
    return np.convolve(env, np.ones(n) / n, "same")


BREIT_HZ = (30.0, 16000.0)
MAX_NACH_BREIT_S = 0.005   # Hochband-Einsatz hoechstens so weit nach dem Einsatz des Gesamtklangs


def _einsatz(env, a, b, sr):
    w = env[a:b]
    p = int(np.argmax(w))
    lo = float(np.min(w[:p + 1]))
    unter = np.nonzero(w[:p + 1] < lo + SCHWELLE * (w[p] - lo))[0]
    return (a + (unter[-1] if len(unter) else 0)) / sr


def einsaetze(x, zeiten, sr=SR):
    """Einsatzzeit (s) je Sollzeit, NaN wo kein klarer Anschlag im Fenster liegt.

    Sicherung (2026-10-09, Kontrolle konst134): ein Hochband-Einsatz zaehlt nur, wenn er hoechstens MAX_NACH_BREIT_S
    nach dem Einsatz des Gesamtklangs (BREIT_HZ) liegt. Ohne sie fand das Instrument bei einem 1-kHz-Klick (keine Energie
    in 2 bis 8 kHz) das harte Ende des Tons 60 ms spaeter, gleichmaessig genug fuer alle Tore; dasselbe faengt einen
    Clap hinter dem Kick ab."""
    env = huelle(x, sr)
    sos = butter(4, BREIT_HZ[0], "highpass", fs=sr, output="sos")
    breit = np.abs(hilbert(sosfiltfilt(sos, x)))
    n = max(1, int(GLATT_S * sr))
    breit = np.convolve(breit, np.ones(n) / n, "same")
    aus = np.full(len(zeiten), np.nan)
    for i, t in enumerate(zeiten):
        a, b = int((t - FENSTER_S) * sr), int((t + FENSTER_S) * sr)
        if a < sr or b > len(env):
            continue
        if env[a:b].max() < KLAR * np.median(env[a - sr:a]):
            continue
        hoch = _einsatz(env, a, b, sr)
        if hoch - _einsatz(breit, a, b, sr) > MAX_NACH_BREIT_S:
            continue
        aus[i] = hoch
    return aus


def phase_messen(x, zeiten, sr=SR):
    """Versatz der Anschlaege gegen die Sollzeiten. versatz_ms > 0: Anschlaege spaeter als das Raster (Semantik von
    korrektur.versatz_ms, §13.3). ok nur, wenn alle Tore halten; sonst steht der Grund in `grund`."""
    zeiten = np.asarray(zeiten, dtype=float)
    e = einsaetze(x, zeiten, sr)
    d = (e - zeiten)[~np.isnan(e)] * 1000.0
    m = {"schlaege": int(len(zeiten)), "klar": int(len(d)),
         "anteil": round(len(d) / len(zeiten), 3) if len(zeiten) else 0.0,
         "versatz_ms": None, "streuung_ms": None, "ok": False, "grund": None}
    if len(d) < 16:
        m["grund"] = "zu wenige klare Anschlaege"
        return m
    m["versatz_ms"] = round(float(np.median(d)), 2)
    m["streuung_ms"] = round(float(np.percentile(d, 90) - np.percentile(d, 10)), 2)
    if m["anteil"] < TOR_ANTEIL:
        m["grund"] = f"Anteil klarer Anschlaege {m['anteil']} unter {TOR_ANTEIL}"
    elif m["streuung_ms"] > TOR_STREUUNG_MS:
        m["grund"] = f"Streuung {m['streuung_ms']} ms ueber {TOR_STREUUNG_MS}"
    elif abs(m["versatz_ms"]) > TOR_BETRAG_MS:
        m["grund"] = f"Versatz {m['versatz_ms']} ms ueber {TOR_BETRAG_MS}"
    else:
        m["ok"] = True
    return m


def sollzeiten(fassung, sr=SR):
    """Starres Raster der Fassung: erster_schlag_frame + k * Periode der Basis, ganze Datei."""
    per = 60.0 / fassung["basis_bpm"] * sr
    n = int((fassung["frames"] - fassung["erster_schlag_frame"]) // per)
    return (fassung["erster_schlag_frame"] + per * np.arange(n + 1)) / sr


TAKT = 4                   # Schlaege je Abschnitt (die Timemap ankert alle 2 Schlaege, ein Takt kommt also an)
GLATT_TAKTE = 5            # gleitender Median ueber so viele Takte: ein einzelner Ausreisser-Takt kippt nichts
TOR_REST_MS = 12.0         # p90 - p10 der Einzelabstaende nach Abzug der geglaetteten Kurve
TOR_POSITIONEN_MS = 3.0    # Mediane der vier Schlagpositionen im Takt duerfen hoechstens so weit auseinander liegen
MIN_KLAR_JE_TAKT = 3       # ein Takt zaehlt nur mit so vielen klaren Anschlaegen
# Warum TOR_POSITIONEN_MS (gemessen 2026-10-09): bei Lovelee Dae (House, 1999) misst das Hochband auf 1 und 3 eine Hihat
# (-15 ms) und auf 2 und 4 den Clap hinter dem Kick (+13 ms), das Tiefband dagegen auf allen vier Positionen -3 ms.
# Wechselt der Median mit der Position, misst das Instrument nicht den Kick; dann wird nichts geschrieben.


def _gleitender_median(v, n):
    h = n // 2
    aus = np.full(len(v), np.nan)
    for i in range(len(v)):
        w = v[max(0, i - h):i + h + 1]
        w = w[~np.isnan(w)]
        if len(w):
            aus[i] = np.median(w)
    return aus


def abschnitte_messen(x, zeiten, sr=SR, takt=TAKT, glatt_takte=GLATT_TAKTE):
    """Versatz je Takt (Anschlaege gegen Sollzeiten, Vorzeichen wie phase_messen), geglaettet. Fuer Stuecke, die
    schwanken (alte Sequencer, Band, Platte): ein konstanter Versatz traegt dort nicht (Lovelee Dae +-12 ms).
    Rueckgabe: takte [{ab_beat, bis_beat, versatz_ms}], rest_ms (Streuung um die Kurve), ok/grund wie phase_messen."""
    zeiten = np.asarray(zeiten, dtype=float)
    e = einsaetze(x, zeiten, sr)
    d = (e - zeiten) * 1000.0
    n_takte = len(zeiten) // takt
    roh = np.array([np.nanmedian(d[i * takt:(i + 1) * takt])
                    if np.sum(~np.isnan(d[i * takt:(i + 1) * takt])) >= MIN_KLAR_JE_TAKT else np.nan
                    for i in range(n_takte)])
    b = d[:n_takte * takt].reshape(n_takte, takt) if n_takte else np.empty((0, takt))
    pos = [np.nanmedian(b[:, j]) if np.any(~np.isnan(b[:, j])) else np.nan for j in range(takt)]
    kurve = _gleitender_median(roh, glatt_takte)
    gueltig = ~np.isnan(kurve)
    if gueltig.any():   # Luecken (Breaks ohne Anschlag) linear aus den Nachbarn, an den Raendern gehalten
        idx = np.arange(n_takte)
        kurve = np.interp(idx, idx[gueltig], kurve[gueltig])
    m = {"schlaege": int(len(zeiten)), "klar": int(np.sum(~np.isnan(d))),
         "anteil": round(float(np.mean(~np.isnan(d))), 3) if len(d) else 0.0,
         "takte": [], "rest_ms": None, "spanne_ms": None, "positionen_ms": [None if np.isnan(v) else round(float(v), 2)
                                                                            for v in pos],
         "ok": False, "grund": None}
    if m["klar"] < 16 or not gueltig.any():
        m["grund"] = "zu wenige klare Anschlaege"
        return m
    rest = d[:n_takte * takt] - np.repeat(kurve, takt)
    rest = rest[~np.isnan(rest)]
    m["rest_ms"] = round(float(np.percentile(rest, 90) - np.percentile(rest, 10)), 2)
    m["spanne_ms"] = [round(float(kurve.min()), 2), round(float(kurve.max()), 2)]
    m["takte"] = [{"ab_beat": i * takt, "bis_beat": (i + 1) * takt, "versatz_ms": round(float(v), 2)}
                  for i, v in enumerate(kurve)]
    if m["anteil"] < TOR_ANTEIL:
        m["grund"] = f"Anteil klarer Anschlaege {m['anteil']} unter {TOR_ANTEIL}"
    elif np.nanmax(pos) - np.nanmin(pos) > TOR_POSITIONEN_MS:
        m["grund"] = f"Schlagpositionen uneinig {m['positionen_ms']} ms (misst nicht den Kick)"
    elif m["rest_ms"] > TOR_REST_MS:
        m["grund"] = f"Rest um die Kurve {m['rest_ms']} ms ueber {TOR_REST_MS}"
    elif max(abs(kurve.min()), abs(kurve.max())) > TOR_BETRAG_MS:
        m["grund"] = f"Versatz bis {m['spanne_ms']} ms ueber {TOR_BETRAG_MS}"
    else:
        m["ok"] = True
    return m


VERFEINERN_FENSTER = 16    # Schlaege je Seite fuer den gleitenden Median der Abstaende
VERFEINERN_AUSREISSER_MS = 8.0


def verfeinere_schlaege(x, sr, schlaege):
    """beat_this-Schlaege (Quell-Sekunden) auf die Anschlaege einrasten, BEVOR die Karte gebaut wird (2026-10-09, Andreas:
    „die Automatik praeziser"). Je Schlag der Einsatz im Hochband; wo er fehlt oder mehr als VERFEINERN_AUSREISSER_MS vom
    gleitenden Median der Nachbarn abweicht, wird der beat_this-Schlag um diesen Median verschoben (sonst mischten sich
    zwei Bezuege). Tore wie abschnitte_messen: Anteil, die vier Positionen (Zaehlung mod 4, Eins egal) auf
    TOR_POSITIONEN_MS einig, Betrag. Reisst ein Tor: die Schlaege unveraendert zurueck, Grund in info."""
    s = np.asarray(schlaege, dtype=float)
    e = einsaetze(x, s, sr)
    d = (e - s) * 1000.0
    info = {"schlaege": int(len(s)), "klar": int(np.sum(~np.isnan(d))), "verfeinert": False, "grund": None,
            "versatz_median_ms": None, "positionen_ms": None, "ersetzt": 0}
    if info["klar"] < 16:
        info["grund"] = "zu wenige klare Anschlaege"
        return s, info
    info["versatz_median_ms"] = round(float(np.nanmedian(d)), 2)
    pos = [np.nanmedian(d[j::4]) if np.any(~np.isnan(d[j::4])) else np.nan for j in range(4)]
    info["positionen_ms"] = [None if np.isnan(v) else round(float(v), 2) for v in pos]
    lokal = np.array([np.nanmedian(d[max(0, i - VERFEINERN_FENSTER):i + VERFEINERN_FENSTER + 1])
                      if np.any(~np.isnan(d[max(0, i - VERFEINERN_FENSTER):i + VERFEINERN_FENSTER + 1])) else np.nan
                      for i in range(len(d))])
    lokal = np.where(np.isnan(lokal), np.nanmedian(d), lokal)
    gut = ~np.isnan(d) & (np.abs(d - lokal) <= VERFEINERN_AUSREISSER_MS)
    if np.mean(~np.isnan(d)) < TOR_ANTEIL:
        info["grund"] = f"Anteil klarer Anschlaege {np.mean(~np.isnan(d)):.3f} unter {TOR_ANTEIL}"
    elif np.nanmax(pos) - np.nanmin(pos) > TOR_POSITIONEN_MS:
        info["grund"] = f"Schlagpositionen uneinig {info['positionen_ms']} ms (misst nicht den Kick)"
    elif np.max(np.abs(lokal)) > TOR_BETRAG_MS + 20.0:
        info["grund"] = f"lokaler Versatz bis {np.max(np.abs(lokal)):.1f} ms"
    if info["grund"]:
        return s, info
    neu = np.where(gut, e, s + lokal / 1000.0)
    info.update({"verfeinert": True, "ersetzt": int(np.sum(~gut))})
    return neu, info
