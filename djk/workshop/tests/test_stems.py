"""werkstatt.stems without the model (slice 6, D19 stage 1; six stems since 2026-11-06): click track through the range, 48 -> 44.1 kHz,
test separator, back to 48 kHz, cut. Real process as the server starts it. Position of every click in every stem +-1 sample, length exactly n,
zeros outside the source, folding of empty optional stems (D4)."""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

from werkstatt import stems
from click_helper import braucht_torch

HIER = Path(__file__).resolve().parent.parent
SR = 48000


def klick_f32(pfad, dauer_s=12.0, abstand_s=0.5, start_s=0.3):
    """Ein-Sample-Klicks (0,8, beide Kanaele) wie die Dekodier-Cache-Datei: float32 little endian, Stereo verschraenkt."""
    n = int(dauer_s * SR)
    x = np.zeros((n, 2), dtype="<f4")
    lagen = np.array([int(round((start_s + i * abstand_s) * SR)) for i in range(int((dauer_s - start_s) / abstand_s))])
    x[lagen] = 0.8
    x.tofile(pfad)
    return lagen


def spitzen(kanal, anteil=0.3, abstand=2400):
    a = np.abs(kanal)
    aus, ende = [], -1
    for i in np.flatnonzero(a >= anteil * a.max()):
        if i <= ende:
            continue
        j = int(i + np.argmax(a[i:i + abstand]))
        aus.append(j)
        ende = j + abstand
    return np.array(aus)


def lauf(*args, env_cuda=""):
    env = {k: v for k, v in os.environ.items() if k != "CUDA_VISIBLE_DEVICES"}
    if env_cuda is not None:
        env["CUDA_VISIBLE_DEVICES"] = env_cuda
    r = subprocess.run(["nice", "-n", "19", sys.executable, "-m", "werkstatt.stems", *args], cwd=HIER, env=env,
                       capture_output=True, text=True, timeout=300)
    return r.returncode, r.stdout, r.stderr


def lies(ordner, stem):
    return np.fromfile(ordner / f"{stem}.f32", dtype="<f4").reshape(-1, 2)


@braucht_torch
def test_lage_und_laenge_jedes_stems(tmp_path):
    q = tmp_path / "q.f32"
    lagen = klick_f32(q)
    f0, f1 = 48000, 9 * 48000 + 17                            # 17: n ist keine runde Zahl
    rc, out, err = lauf("--quelle", str(q), "--f0", str(f0), "--f1", str(f1), "--aus", str(tmp_path / "s"), "--trenner", "identitaet")
    assert rc == 0, err
    j = json.loads(out.strip().splitlines()[-1])
    assert j["status"] == "ok" and j["frames"] == f1 - f0 and j["stems"] == list(stems.STEMS)
    soll = lagen[(lagen >= f0) & (lagen < f1)] - f0
    for s in stems.STEMS:
        y = lies(tmp_path / "s", s)
        assert y.shape == (f1 - f0, 2), s                     # Laenge +-0
        ist = spitzen(y[:, 0])
        assert len(ist) == len(soll), (s, len(ist), len(soll))
        assert int(np.max(np.abs(ist - soll))) <= 1, (s, np.abs(ist - soll).max())   # Lage +-1 Sample


@braucht_torch
def test_ausserhalb_der_quelle_nullen(tmp_path):
    q = tmp_path / "q.f32"
    lagen = klick_f32(q, dauer_s=4.0)
    f0, f1 = -24000, 4 * 48000 + 24000                        # je 0,5 s vor dem Anfang und hinter dem Ende
    rc, out, err = lauf("--quelle", str(q), "--f0", str(f0), "--f1", str(f1), "--aus", str(tmp_path / "s"), "--trenner", "identitaet")
    assert rc == 0, err
    y = lies(tmp_path / "s", "drums")
    assert y.shape[0] == f1 - f0
    assert np.abs(y[:12000]).max() < 1e-4                     # vor der Quelle still (Abstand zum ersten Klick 0,8 s)
    assert int(spitzen(y[:, 0])[0]) - (int(lagen[0]) - f0) in (-1, 0, 1)


@braucht_torch
def test_fortschritt_auf_stderr(tmp_path):
    q = tmp_path / "q.f32"; klick_f32(q, dauer_s=2.0)
    rc, _, err = lauf("--quelle", str(q), "--f0", "0", "--f1", "48000", "--aus", str(tmp_path / "s"), "--trenner", "identitaet")
    assert rc == 0
    namen = [json.loads(z.split(" ", 1)[1])["name"] for z in err.splitlines() if z.startswith("@@fortschritt ")]
    assert namen[0] == "laden" and "trennen" in namen and namen[-1] == "schreiben"


@braucht_torch
def test_kein_cpu_waechter_mehr(tmp_path):
    """GPU only (plan 2026-11-06, D2): the test separators run whatever CUDA_VISIBLE_DEVICES says; the old CPU guard (exit 4) is gone."""
    q = tmp_path / "q.f32"; klick_f32(q, dauer_s=2.0)
    for cuda in (None, "0", ""):
        rc, out, _ = lauf("--quelle", str(q), "--f0", "0", "--f1", "48000", "--aus", str(tmp_path / f"s{cuda}"), "--trenner", "identitaet",
                          env_cuda=cuda)
        assert rc == 0 and json.loads(out.strip())["status"] == "ok", cuda


def test_aufruf_fehler(tmp_path):
    q = tmp_path / "q.f32"; klick_f32(q, dauer_s=2.0)
    rc, out, _ = lauf("--quelle", str(q), "--f0", "100", "--f1", "100", "--aus", str(tmp_path / "s"), "--trenner", "identitaet")
    assert rc == 2 and json.loads(out.strip())["grund"] == "argument"


# --- Nachbesserung T2 (Review): Zwischenrate, ausschnitt() direkt, rest_db, verschiedene Stems ---
ANTEILE = {"drums": 0.05, "bass": 0.10, "other": 0.15, "vocals": 0.20, "guitar": 0.22, "piano": 0.28}   # literal, catches a swapped name


@braucht_torch
def test_zwischenrate_und_randbreite_ueber_frames_modell(tmp_path):
    """Der Trenner sieht ceil((n + 2*RAND) * 44100 / 48000) Frames (torchaudio functional.py:1425: ceil(new_freq * length / orig_freq)).
    RAND woertlich 2 s = 96000 Frames, nicht aus dem Modul: faengt falsche Rate, vertauschte Richtung, fehlende Resamples, falsche Randbreite."""
    q = tmp_path / "q.f32"; klick_f32(q)
    f0, f1 = 48000, 9 * 48000 + 17
    n = f1 - f0
    rc, out, err = lauf("--quelle", str(q), "--f0", str(f0), "--f1", str(f1), "--aus", str(tmp_path / "s"), "--trenner", "identitaet")
    assert rc == 0, err
    m = n + 2 * 96000
    assert json.loads(out.strip())["frames_modell"] == -(-m * 44100 // 48000)


@braucht_torch
def test_stems_tragen_ihre_namen(tmp_path):
    """Six different shares (0.05 .. 0.28): jede Datei traegt den Pegel ihres Namens. Die Resample-Kette daempft Ein-Sample-Klicks um
    gemessen 0,90 (gleich fuer alle), darum zaehlt das Verhaeltnis zum Gesamtpegel, nicht der Absolutwert."""
    q = tmp_path / "q.f32"; klick_f32(q)
    rc, out, err = lauf("--quelle", str(q), "--f0", "48000", "--f1", str(9 * 48000), "--aus", str(tmp_path / "s"), "--trenner", "identitaet")
    assert rc == 0, err
    assert json.loads(out.strip())["stems"] == ["drums", "bass", "other", "vocals", "guitar", "piano"]
    spitze = {name: float(np.abs(lies(tmp_path / "s", name)).max()) for name in ANTEILE}
    gesamt = sum(spitze.values())
    for name, anteil in ANTEILE.items():
        assert abs(spitze[name] / gesamt - anteil) < 0.01, (name, spitze)


@braucht_torch
def test_rest_db_aus_dem_prozess_gegen_unabhaengige_rechnung(tmp_path):
    q = tmp_path / "q.f32"; klick_f32(q)
    f0, f1 = 48000, 9 * 48000
    rc, out, err = lauf("--quelle", str(q), "--f0", str(f0), "--f1", str(f1), "--aus", str(tmp_path / "s"), "--trenner", "identitaet")
    assert rc == 0, err
    summe = sum(lies(tmp_path / "s", s).astype(np.float64) for s in stems.STEMS)
    orig = np.fromfile(q, dtype="<f4").reshape(-1, 2)[f0:f1].astype(np.float64)
    soll = 20 * np.log10(np.sqrt(np.mean((summe - orig) ** 2)) / np.sqrt(np.mean(orig ** 2)))
    ist = json.loads(out.strip())["rest_db"]
    assert abs(ist - soll) < 0.05 and ist < -10, (ist, soll)   # gemessen -13,7 dB: Ein-Sample-Klicks sind kein bandbegrenztes Signal


def test_rest_db_rechnung():
    x = np.random.default_rng(1).standard_normal((2, 1000)).astype(np.float32)
    assert abs(stems.rest_db(np.stack([x * 0.275] * 4), x) - (-20.0)) < 0.01           # Summe 1,1 x: Rest 0,1 x = -20 dB
    assert stems.rest_db(np.stack([x] * 4), x) == round(20 * np.log10(3.0), 2)         # Summe 4 x: Rest 3 x
    assert stems.rest_db(np.stack([x * 0.25] * 4), x) < -200                           # Summe == x: Deckel 1e-12
    assert stems.rest_db(np.stack([x] * 4), np.zeros_like(x)) is None                  # Stille: keine Angabe


def test_ausschnitt_direkt(tmp_path):
    """Form (2, n + 4 SR), Nullen links UND rechts ausserhalb der Quelle, Mitte bitgleich zur Quelle. Randbreite woertlich 2 s."""
    rng = np.random.default_rng(7)
    frames = 3 * SR
    quelle = (rng.random((frames, 2), dtype=np.float32) + 0.5).astype("<f4")          # nie 0, damit Nullen eindeutig Rand sind
    q = tmp_path / "q.f32"; quelle.tofile(q)
    f0, f1 = -SR // 2, frames + SR // 4                                               # ragt links 0,5 s und rechts 0,25 s hinaus
    a = stems.ausschnitt(q, f0, f1)
    n = f1 - f0
    assert a.shape == (2, n + 4 * SR) and a.dtype == np.float32
    links = f0 - 2 * SR                                                               # Projekt-Frame des ersten Ausschnitt-Frames
    i0, i1 = 0 - links, frames - links                                                # Quelle liegt in [i0, i1)
    assert np.all(a[:, :i0] == 0.0) and np.all(a[:, i1:] == 0.0)
    assert i0 == 2 * SR + SR // 2 and a.shape[1] - i1 == 2 * SR + SR // 4             # beide Raender voll vorhanden
    assert np.array_equal(a[:, i0:i1], quelle.T)                                      # Mitte bitgleich


def test_falte_leere_optionale_stems_nach_other():
    """D4: guitar and piano below LEER_DB (literal -45) relative to the input go into other; the four required stems always stay;
    the sum over the placed stems equals the sum over all six."""
    rng = np.random.default_rng(3)
    orig = rng.standard_normal((2, 4800)).astype(np.float32)
    s = np.stack([orig * 0.25, orig * 0.25, orig * 0.2, orig * 0.3, orig * 10 ** (-50 / 20), orig * 10 ** (-40 / 20)])
    namen, y, weg = stems.falte(s, orig)
    assert namen == ["drums", "bass", "other", "vocals", "piano"]
    assert [w["stem"] for w in weg] == ["guitar"] and abs(weg[0]["db"] - (-50.0)) < 0.1
    assert np.allclose(y.sum(axis=0), s.sum(axis=0), atol=1e-6)
    assert np.allclose(y[2], s[2] + s[4], atol=1e-7)                                 # guitar went into other
    stumm = np.stack([orig * 0.0] * 6)
    namen, _, weg = stems.falte(stumm, orig)
    assert namen == ["drums", "bass", "other", "vocals"] and {w["stem"] for w in weg} == {"guitar", "piano"}   # silence is dropped too
    namen, _, _ = stems.falte(np.stack([orig] * 6), orig)
    assert namen == list(stems.STEMS)                                                  # nothing quiet: all six


def test_falte_grenze_beidseitig():
    orig = np.ones((2, 100), dtype=np.float32)
    knapp_drueber = 10 ** (-44.9 / 20); knapp_drunter = 10 ** (-45.1 / 20)
    s = np.stack([orig] * 4 + [orig * knapp_drueber, orig * knapp_drunter])
    namen, _, weg = stems.falte(s, orig)
    assert "guitar" in namen and [w["stem"] for w in weg] == ["piano"]
