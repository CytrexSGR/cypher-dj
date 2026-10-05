#!/usr/bin/env python3
"""Messläufe des Vorhörers, stumm an eigener Null-Senke (cypherdj-pruef-h-vorhoerer), Aufnahme am Ziel mit
djk/pruefstand/aufnehmer. Kein hörbarer Ton, kein Fenster, keine GPU. Jeder Lauf hält das Echtzeit-Schloss
(CYPHERDJ_ECHTZEIT_SCHLOSS), startet erst bei 1-min-Last ≤ 8 und markiert Läufe über 4 als vorläufig.

  messung.py material                 Prüfmaterial erzeugen (Zähler-Datei, Klicks, Sinus) im Materialordner
  messung.py <art> [--ordner O]       ein Lauf; Arten siehe ARTEN
  messung.py alle                     alle Arten nacheinander

Das Messinstrument ist die Zähler-Datei: jedes Frame i trägt i selbst (L = ((i & 0xFFF)+1)/8192,
R = ((i >> 12)+1)/8192, float32 exakt). Aus der Aufnahme lässt sich so je Sample ablesen, welches Datei-Frame am Ziel
ankam: Rücksprung, Sprungziel und Positionsmeldung sind damit auf das Sample prüfbar, ohne Korrelation.
"""
import argparse
import fcntl
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

HIER = Path(__file__).resolve().parent.parent
DJK = HIER.parent
sys.path.insert(0, str(HIER))
from vfern import Vorhoerer  # noqa: E402

INSTANZ = "h"
PORT = 47740 + 8000
SENKE = "cypherdj-pruef-h-vorhoerer"
RATE = 48000
def echtzeit_schloss():
    """Sperrdatei der Echtzeit-Läufe: CYPHERDJ_ECHTZEIT_SCHLOSS, sonst die Zeile in umgebung.env, sonst XDG_RUNTIME_DIR oder /tmp."""
    v = os.environ.get("CYPHERDJ_ECHTZEIT_SCHLOSS")
    if not v:
        umg = Path(os.environ.get("CYPHERDJ_UMGEBUNG") or Path.home() / ".config/cypherdj/umgebung.env")
        try:
            for z in umg.read_text().splitlines():
                if z.startswith("CYPHERDJ_ECHTZEIT_SCHLOSS="):
                    v = z.split("=", 1)[1].strip().strip("\"'")
        except OSError:
            pass
    return v or str(Path(os.environ.get("XDG_RUNTIME_DIR") or "/tmp") / "cypherdj-echtzeit.lock")


MATERIAL = Path(os.environ.get("VORHOERER_MATERIAL", str(Path(tempfile.gettempdir()) / "cypherdj-vorhoerer-material")))
MP3 = os.path.join(os.environ.get("CYPHERDJ_MUSIK") or "/nicht/gesetzt/CYPHERDJ_MUSIK", "1002565_Freak_Original Mix.mp3")
SCHLOSS = echtzeit_schloss()
AUFNEHMER = DJK / "pruefstand/aufnehmer/build/cypherdj-aufnehmer"


# ---------------- Material ----------------
def zaehler_frames(n):
    i = np.arange(n, dtype=np.int64)
    return np.stack([((i & 0xFFF) + 1) / 8192.0, ((i >> 12) + 1) / 8192.0], axis=1).astype(np.float32)


def dekodiere_zaehler(x):
    """Aufnahme (N,2) → Datei-Frame je Sample, -1 wo kein gültiger Zählerwert (Stille, Überblendung)."""
    a, b = x[:, 0].astype(np.float64) * 8192.0, x[:, 1].astype(np.float64) * 8192.0
    ra, rb = np.rint(a), np.rint(b)
    ok = (np.abs(a - ra) < 1e-6) & (np.abs(b - rb) < 1e-6) & (ra >= 1) & (ra <= 4096) & (rb >= 1)
    return np.where(ok, ((rb.astype(np.int64) - 1) << 12) | (ra.astype(np.int64) - 1), -1)


def schreibe_wav(pfad, x):
    raw = Path(str(pfad) + ".f32")
    x.astype("<f4").tofile(raw)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", str(raw),
                    "-c:a", "pcm_f32le", str(pfad)], check=True)
    raw.unlink()


def material():
    MATERIAL.mkdir(parents=True, exist_ok=True)
    schreibe_wav(MATERIAL / "zaehler.wav", zaehler_frames(320 * RATE))
    # Klicks: 1-Sample-Impuls 0,5 alle 0,5 s (erster bei Frame 24 000), sonst Stille
    k = np.zeros((60 * RATE, 2), np.float32)
    k[RATE // 2::RATE // 2] = 0.5
    schreibe_wav(MATERIAL / "klicks.wav", k)
    # Sinus 997 Hz, 0,5: für die Knack-Messung an einer Loop-Naht, die nicht auf eine Periode fällt
    t = np.arange(30 * RATE) / RATE
    s = (0.5 * np.sin(2 * np.pi * 997 * t)).astype(np.float32)
    schreibe_wav(MATERIAL / "sinus997.wav", np.stack([s, s], 1))
    # Probe: ffmpeg liefert die Zähler-Datei bitgenau zurück (Voraussetzung des Instruments)
    r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(MATERIAL / "zaehler.wav"), "-ac", "2", "-ar", str(RATE),
                        "-f", "f32le", "pipe:1"], capture_output=True, check=True).stdout
    d = dekodiere_zaehler(np.frombuffer(r, "<f4").reshape(-1, 2))
    ok = bool(np.array_equal(d, np.arange(320 * RATE)))
    print(json.dumps({"material": str(MATERIAL), "zaehler_bitgenau_durch_ffmpeg": ok}))
    return ok


def lies_wav(pfad):
    b = Path(pfad).read_bytes()
    o = 12
    while o < len(b):
        cid, n = b[o:o + 4], int.from_bytes(b[o + 4:o + 8], "little")
        if cid == b"data":
            return np.frombuffer(b[o + 8:o + 8 + n], "<f4").reshape(-1, 2)
        o += 8 + n + (n & 1)
    raise ValueError("kein data-Chunk")


def referenz(pfad, *vor):
    r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", *vor, "-i", pfad, "-map", "0:a:0", "-ac", "2", "-ar", str(RATE),
                        "-f", "f32le", "pipe:1"], capture_output=True, check=True).stdout
    return np.frombuffer(r, "<f4").reshape(-1, 2)


# ---------------- Lauf-Rahmen ----------------
def last1():
    return float(open("/proc/loadavg").read().split()[0])


class Lauf:
    def __init__(self, art, ordner, mutante=False, blende=False, sekunden=20.0):
        self.art, self.o, self.mutante, self.blende, self.sek = art, Path(ordner), mutante, blende, sekunden
        self.procs = []

    def __enter__(self):
        if self.o.exists():
            raise SystemExit(f"{self.o} existiert schon")
        self.o.mkdir(parents=True)
        self.schloss = open(SCHLOSS, "w")
        t0 = time.monotonic()
        fcntl.flock(self.schloss, fcntl.LOCK_EX)
        self.warte_schloss_s = time.monotonic() - t0
        t0 = time.monotonic()
        while last1() > 8.0:
            if time.monotonic() - t0 > 1800:
                raise SystemExit("1-min-Last blieb 30 min über 8")
            time.sleep(10)
        self.last_vor = last1()
        self.env = dict(os.environ, CYPHERDJ_INSTANZ=INSTANZ)
        r = subprocess.run([str(DJK / "pruefstand/senke/senke_an.sh"), SENKE], capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit(f"Senke: {r.stderr}")
        self.senke_id = r.stdout.strip()
        binr = HIER / "build" / ("cypherdj-vorhoerer-mutante" if self.mutante else "cypherdj-vorhoerer")
        args = ["pw-jack", "-p", "256", str(binr), "--ausgang", f"{SENKE}:playback_F"] + ([] if self.blende else ["--ohne-blende"])
        self.vlog = open(self.o / "vorhoerer.log", "w")
        self.vh = subprocess.Popen(args, env=self.env, stderr=self.vlog, stdout=self.vlog)
        self.procs.append(self.vh)
        self.prot = open(self.o / "osc.jsonl", "w")
        self.v = Vorhoerer(PORT, self.prot)
        for _ in range(100):  # bis er antwortet
            self.v.hallo()
            if self.v.warte_auf({"/v/position"}, 0.1):
                break
        else:
            raise SystemExit("Vorhörer antwortet nicht")
        bereit = self.o / "aufnahme.bereit"
        self.auf = subprocess.Popen(["pw-jack", "-p", "256", str(AUFNEHMER), "--quelle", f"{SENKE}:monitor_F", "--datei",
                                     str(self.o / "aufnahme.wav"), "--sekunden", str(self.sek), "--bereit", str(bereit)],
                                    env=self.env, stderr=open(self.o / "aufnehmer.txt", "w"))
        self.procs.append(self.auf)
        for _ in range(100):
            if bereit.exists() and bereit.read_text().strip():
                break
            time.sleep(0.05)
        else:
            raise SystemExit("Aufnehmer nicht bereit")
        return self

    def warte_ende(self):
        """Meldungen einsammeln, bis der Aufnehmer fertig ist."""
        while self.auf.poll() is None:
            self.v.sammle(0.2)

    def __exit__(self, *a):
        for p in reversed(self.procs):
            if p.poll() is None:
                p.terminate()
        for p in self.procs:
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
        self.prot.close()
        self.vlog.close()
        subprocess.run([str(DJK / "pruefstand/senke/senke_ab.sh"), SENKE], capture_output=True)
        lv = self.last_vor
        json.dump({"art": self.art, "mutante": self.mutante, "blende": self.blende, "sekunden": self.sek,
                   "last_vorher": lv, "last_nachher": last1(), "vorlaeufig": lv > 4.0 or last1() > 4.0,
                   "warte_schloss_s": round(self.warte_schloss_s, 1), "quantum": 256, "instanz": INSTANZ, "senke": SENKE},
                  open(self.o / "lauf.json", "w"), indent=1)
        fcntl.flock(self.schloss, fcntl.LOCK_UN)
        self.schloss.close()


def laden(L, pfad):
    L.v.laden(pfad)
    m = L.v.warte_auf({"/v/geladen", "/v/fehler"}, 60)
    if not m or m[1] != "/v/geladen":
        raise SystemExit(f"Laden gescheitert: {m}")
    return m[2][1]


def f(s):
    return int(round(s * RATE))


# ---------------- Auswertung-Helfer ----------------
def auf_meta(o):
    return json.loads((Path(o) / "aufnahme.wav.json").read_text())


def vh_zaehler(o):
    for z in reversed((Path(o) / "vorhoerer.log").read_text().splitlines()):
        if z.startswith("{"):
            return json.loads(z)
    return {}


def osc(o):
    return [json.loads(z) for z in (Path(o) / "osc.jsonl").read_text().splitlines()]


def spruenge(idx):
    """Stellen k, an denen auf ein gültiges idx[k] ein gültiges idx[k+1] != idx[k]+1 folgt."""
    a, b = idx[:-1], idx[1:]
    k = np.nonzero((a >= 0) & (b >= 0) & (b != a + 1))[0]
    return [(int(i), int(idx[i]), int(idx[i + 1])) for i in k]


def positionen_gegen_aufnahme(o, idx, meta):
    """Jede /v/position (s, jack_frame) gegen die Aufnahme. Die Meldung nennt das Datei-Frame, das der Vorhörer am
    Anfang des Zyklus mit Frame-Zeit jack_frame ausgibt. Am Ziel kommt es um den Graph-Versatz d später an. d wird als
    häufigster Abstand gemessen (nicht angenommen); Fehler = Datei-Frame in der Aufnahme bei jack_frame + d minus
    gemeldetes Frame. Rückgabe: (Fehler je Meldung in Samples, d)."""
    f0, n = meta["erster_jack_frame"], len(idx)
    paare = []
    for m in osc(o):
        if m["r"] != "<" or m["adr"] != "/v/position":
            continue
        s, fr = m["w"]
        paare.append(((fr - f0) % (1 << 32), int(round(s * RATE))))
    roh = [int(idx[k]) - p for k, p in paare if k < n and idx[k] >= 0]
    if not roh:
        return np.array([], np.int64), None
    w, c = np.unique(roh, return_counts=True)
    d = -int(w[np.argmax(c)])
    fehler = [int(idx[k + d]) - p for k, p in paare if 0 <= k + d < n and idx[k + d] >= 0]
    return np.array(fehler, dtype=np.int64), d


def pos_bericht(o, idx, meta):
    fe, d = positionen_gegen_aufnahme(o, idx, meta)
    st = stat(fe)
    if st["n"]:
        st["max_abs_ms"] = st["max_abs"] / RATE * 1000
    return {"graph_versatz_samples": d, "graph_versatz_ms": None if d is None else d / RATE * 1000, "fehler_samples": st,
            "meldungen_mit_fehler": int(np.count_nonzero(fe))}


def stat(a):
    a = np.asarray(a, float)
    if not len(a):
        return {"n": 0}
    return {"n": int(len(a)), "min": float(a.min()), "median": float(np.median(a)), "max": float(a.max()),
            "max_abs": float(np.abs(a).max())}


# ---------------- Arten ----------------
A_S, B_S = 10.0 + 123 / RATE, 11.2345  # Loop nicht auf Blockgrenzen: A = 480 123, B = 539 256 Frames


def lauf_naht(o, mutante=False):
    with Lauf("naht_mutante" if mutante else "naht", o, mutante=mutante, sekunden=14) as L:
        laden(L, str(MATERIAL / "zaehler.wav"))
        L.v.springe(A_S - 0.5)
        L.v.loop(A_S, B_S)
        L.v.sammle(0.3)
        L.v.play()
        L.v.sammle(11.0)
        L.v.pause()
        L.warte_ende()
    x = lies_wav(Path(o) / "aufnahme.wav")
    idx = dekodiere_zaehler(x)
    a, b = f(A_S), f(B_S)
    sp = spruenge(idx)
    fehler_a = [post - a for _, pre, post in sp]
    fehler_b = [pre + 1 - b for _, pre, post in sp]
    pos = pos_bericht(o, idx, auf_meta(o))
    e = {"A_frame": a, "B_frame": b, "rueckspruenge_aufnahme": len(sp), "fehler_ziel_A_samples": stat(fehler_a),
         "fehler_ende_B_samples": stat(fehler_b), "erste_spruenge": sp[:5], "ungueltige_samples_im_spiel": ungueltig_im_spiel(idx),
         "position": pos, "vorhoerer": vh_zaehler(o), "aufnehmer": auf_meta(o)}
    return e


def ungueltig_im_spiel(idx):
    ok = np.nonzero(idx >= 0)[0]
    if not len(ok):
        return 0
    return int(np.sum(idx[ok[0]:ok[-1] + 1] < 0))


def lauf_knack(o, blende):
    """Sinus 997 Hz, Loop über 0,51234 s (keine ganze Periodenzahl): größter Sample-Schritt an der Naht."""
    with Lauf("knack_blende" if blende else "knack_ohne", o, blende=blende, sekunden=8) as L:
        laden(L, str(MATERIAL / "sinus997.wav"))
        L.v.springe(2.0)
        L.v.loop(2.3, 2.3 + 0.51234)
        L.v.sammle(0.3)
        L.v.play()
        L.v.sammle(6.0)
        L.v.pause()
        L.warte_ende()
    x = lies_wav(Path(o) / "aufnahme.wav")[:, 0].astype(np.float64)
    nz = np.nonzero(x)[0]
    x = x[nz[0] + 100:nz[-1] - 100]
    d = np.abs(np.diff(x))
    normal = 0.5 * 2 * np.pi * 997 / RATE  # größter Schritt eines ungestörten Sinus
    return {"max_schritt": float(d.max()), "max_schritt_ungestoert_theorie": normal,
            "schritte_ueber_1_5x": int(np.sum(d > 1.5 * normal)), "vorhoerer": vh_zaehler(o), "aufnehmer": auf_meta(o)}


ZIELE = [30.0, 100.25, 7.123, 200.5, 50.0 + 77 / RATE, 150.0, 3.3333, 250.0]


def lauf_sprung(o):
    with Lauf("sprung", o, sekunden=16) as L:
        laden(L, str(MATERIAL / "zaehler.wav"))
        L.v.springe(5.0)
        L.v.play()
        L.v.sammle(1.0)
        for z in ZIELE:
            L.v.springe(z)
            L.v.sammle(1.4)
        L.v.pause()
        L.warte_ende()
    x = lies_wav(Path(o) / "aufnahme.wav")
    idx = dekodiere_zaehler(x)
    sp = spruenge(idx)
    meta = auf_meta(o)
    befehle = [m for m in osc(o) if m["r"] == ">" and m["adr"] == "/v/springe"][1:]  # der erste ist vor play
    je = []
    for (k, pre, post), m in zip(sp, befehle):
        ankunft_ns = meta["erster_mono_ns"] + (k + 1) // 256 * 256 * 1e9 / RATE
        je.append({"ziel_s": m["w"][0], "ziel_frame": f(m["w"][0]), "erstes_sample": post, "fehler": post - f(m["w"][0]),
                   "befehl_bis_ziel_ms": (ankunft_ns - m["t_ns"]) / 1e6})
    pos = pos_bericht(o, idx, meta)
    return {"spruenge_aufnahme": len(sp), "befehle": len(befehle), "je_sprung": je,
            "fehler_samples": stat([j["fehler"] for j in je]), "befehl_bis_ziel_ms": stat([j["befehl_bis_ziel_ms"] for j in je]),
            "ungueltige_samples_im_spiel": ungueltig_im_spiel(idx), "position": pos,
            "vorhoerer": vh_zaehler(o), "aufnehmer": meta}


MP3_ZIELE = [12.0, 61.5, 123.456, 200.0, 300.25]


def lauf_sprung_mp3(o):
    if not os.path.exists(MP3):
        raise SystemExit(f"SKIP: MP3 fehlt ({MP3}); CYPHERDJ_MUSIK auf die Wurzel der Musiksammlung setzen")
    with Lauf("sprung_mp3", o, sekunden=12) as L:
        dauer = laden(L, MP3)
        for z in MP3_ZIELE:
            L.v.springe(z)
            L.v.sammle(0.25)
            L.v.play()
            L.v.sammle(1.0)
            L.v.pause()
            L.v.sammle(0.35)
        L.warte_ende()
    x = lies_wav(Path(o) / "aufnahme.wav")
    ref = referenz(MP3)
    ref_falsch = referenz(MP3, "-flags2", "+skip_manual")  # Fehlerfall: Encoder-Vorlauf NICHT abgeschnitten
    nz = np.abs(x[:, 0]) + np.abs(x[:, 1]) > 0
    # Abschnitte: Anfänge nach mindestens 0,1 s Stille
    anf = [int(k) for k in np.nonzero(nz[1:] & ~nz[:-1])[0] + 1 if not nz[max(0, k - 4800):k].any()]
    if nz[0]:
        anf = [0] + anf
    def lag(r, k, z, w=8192, such=3000):
        seg = x[k:k + w, 0].astype(np.float64)
        z0 = f(z)
        best, bl = -2.0, None
        for l in range(-such, such + 1):
            q = r[z0 + l:z0 + l + w, 0].astype(np.float64)
            if len(q) < w:
                continue
            c = float(np.dot(seg, q) / (np.linalg.norm(seg) * np.linalg.norm(q) + 1e-12))
            if c > best:
                best, bl = c, l
        return bl, best
    je = []
    for k, z in zip(anf, MP3_ZIELE):
        l, c = lag(ref, k, z)
        lf, cf = lag(ref_falsch, k, z)
        gleich = float(np.max(np.abs(x[k:k + 8192, :] - ref[f(z):f(z) + 8192, :])))
        je.append({"ziel_s": z, "lag_samples": l, "korrelation": round(c, 6), "max_abweichung_bitweise": gleich,
                   "fehlerfall_lag_ohne_vorlaufschnitt": lf, "fehlerfall_korrelation": round(cf, 6)})
    return {"dauer_s": dauer, "abschnitte": len(anf), "je_sprung": je, "vorhoerer": vh_zaehler(o), "aufnehmer": auf_meta(o),
            "ffprobe_start_time": subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                                                  "stream=start_time", "-of", "csv=p=0", MP3], capture_output=True, text=True).stdout.strip()}


def lauf_latenz(o, n=20):
    with Lauf("latenz", o, sekunden=n * 0.75 + 3) as L:
        laden(L, str(MATERIAL / "klicks.wav"))
        for j in range(n):
            L.v.springe((j + 1) * 0.5)  # genau auf einen Klick (Frame 24 000·(j+1))
            L.v.sammle(0.2)
            L.v.play()
            L.v.sammle(0.3)
            L.v.pause()
            L.v.sammle(0.2)
        L.warte_ende()
    x = lies_wav(Path(o) / "aufnahme.wav")[:, 0]
    meta = auf_meta(o)
    plays = [m["t_ns"] for m in osc(o) if m["r"] == ">" and m["adr"] == "/v/play"]
    klick = np.nonzero(x != 0)[0]
    # erster Klick je Abspielen: Klicks liegen 24 000 Frames auseinander; nach play kommt der erste sofort
    ms, werte = [], []
    for t in plays:
        k0 = int((t - meta["erster_mono_ns"]) / 1e9 * RATE)
        nach = klick[klick >= k0 - 256]
        if not len(nach):
            continue
        k = int(nach[0])
        ankunft = meta["erster_mono_ns"] + k // 256 * 256 * 1e9 / RATE
        ms.append((ankunft - t) / 1e6)
        werte.append(float(x[k]))
    return {"n": len(plays), "befehl_bis_ziel_zyklus_ms": stat(ms), "einzeln_ms": [round(v, 3) for v in ms],
            "erstes_sample_ist_klick": all(v == 0.5 for v in werte), "quantum_ms": 256 / RATE * 1000,
            "vorhoerer": vh_zaehler(o), "aufnehmer": meta}


def lauf_stumm(o):
    """Negativ-Kontrolle: laden, springen, Loop setzen, aber kein /v/play: am Ziel muss Stille liegen."""
    with Lauf("stumm", o, sekunden=6) as L:
        laden(L, str(MATERIAL / "klicks.wav"))
        L.v.springe(0.5)
        L.v.loop(0.4, 0.6)
        L.v.springe(1.0)
        L.warte_ende()
    x = lies_wav(Path(o) / "aufnahme.wav")
    return {"nicht_null_samples": int(np.count_nonzero(x)), "frames": len(x), "vorhoerer": vh_zaehler(o), "aufnehmer": auf_meta(o)}


def luecken_zaehlung(idx):
    """Eigene Lückenzählung über die Zähler-Datei: im Spielbereich jede Stelle, an der die Folge nicht +1 weitergeht,
    und jede Folge ungültiger Samples (Stille oder Fremdes) zählt als Lücke."""
    ok = np.nonzero(idx >= 0)[0]
    if not len(ok):
        return {"luecken": 0, "spruenge": 0, "stille_folgen": 0}
    s = idx[ok[0]:ok[-1] + 1]
    ung = s < 0
    folgen = int(np.sum(ung[1:] & ~ung[:-1]))
    sp = len(spruenge(s))
    return {"luecken": folgen + sp, "spruenge": sp, "stille_folgen": folgen, "spielbereich_frames": int(len(s)),
            "erstes_frame": int(s[0]), "letztes_frame": int(s[-1])}


def lauf_luecke_probe(o):
    """Positiv-Probe der Lückenzählung: 0,5 s Pause mitten im Spiel muss genau eine Lücke ergeben."""
    with Lauf("luecke_probe", o, sekunden=8) as L:
        laden(L, str(MATERIAL / "zaehler.wav"))
        L.v.play()
        L.v.sammle(3.0)
        L.v.pause()
        L.v.sammle(0.5)
        L.v.play()
        L.v.sammle(2.5)
        L.v.pause()
        L.warte_ende()
    idx = dekodiere_zaehler(lies_wav(Path(o) / "aufnahme.wav"))
    return {**luecken_zaehlung(idx), "vorhoerer": vh_zaehler(o), "aufnehmer": auf_meta(o)}


def lauf_ruhe(o, sek=300):
    with Lauf("ruhe", o, sekunden=sek + 4) as L:
        laden(L, str(MATERIAL / "zaehler.wav"))
        L.v.play()
        L.warte_ende()
    idx = dekodiere_zaehler(lies_wav(Path(o) / "aufnahme.wav"))
    pos = pos_bericht(o, idx, auf_meta(o))
    lz = luecken_zaehlung(idx)
    return {**lz, "spielzeit_s": lz.get("spielbereich_frames", 0) / RATE, "position": pos,
            "vorhoerer": vh_zaehler(o), "aufnehmer": auf_meta(o)}


ARTEN = {
    "naht": lambda o: lauf_naht(o), "naht_mutante": lambda o: lauf_naht(o, True),
    "knack_ohne": lambda o: lauf_knack(o, False), "knack_blende": lambda o: lauf_knack(o, True),
    "sprung": lauf_sprung, "sprung_mp3": lauf_sprung_mp3, "latenz": lauf_latenz, "stumm": lauf_stumm,
    "luecke_probe": lauf_luecke_probe, "ruhe": lauf_ruhe,
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("art")
    ap.add_argument("--ordner")
    ap.add_argument("--praefix", default=time.strftime("%Y%m%d-%H%M"))
    a = ap.parse_args()
    if a.art == "material":
        return 0 if material() else 1
    arten = list(ARTEN) if a.art == "alle" else [a.art]
    for art in arten:
        o = Path(a.ordner) if a.ordner and len(arten) == 1 else HIER / "laeufe" / f"{a.praefix}_{art}"
        e = ARTEN[art](o)
        e["lauf"] = json.loads((o / "lauf.json").read_text())
        (o / "ergebnis.json").write_text(json.dumps(e, indent=1, ensure_ascii=False))
        kurz = {k: v for k, v in e.items() if k not in ("aufnehmer", "je_sprung", "erste_spruenge", "einzeln_ms")}
        print(art, json.dumps(kurz, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
