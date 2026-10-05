#!/usr/bin/env python3
"""Auswertung einer Abschuss-Serie der Scheibe 18 (serie.sh) am Ziel, gegen ARCHITEKTUR §7:

  stille_ms            Läufe von mindestens 48 Samples mit |Cue| < 1e-3 im Prüfsignal, je Eingriff aufsummiert;
                       stille_samples dasselbe in Samples. Grenzen seit der Notbahn daneben (ADR 016 Nachtrag
                       2026-09-25, ARCHITEKTUR §7): kill -9 höchstens 1 Block (256 Samples), SIGSTOP höchstens 450 ms
                       (WatchdogSec 200 ms plus 250 ms Genauigkeit von systemd, Plan-Befund B5); Ruhe 0
  raster_abw_samples   Klick-Einsatz nach der Rückkehr gegen llround(sample_at(b)) plus festen Versatz (Grenze 1);
                       raster_abw_gesamt_samples dasselbe gegen den Versatz vor dem ersten Eingriff (Grenze 1, nur
                       ohne Graph-Lücke im Lauf): so summiert sich kein kleiner Versatz über viele Neustarts auf
  cue_abw_samples      Versatz, um den das Prüfsignal nach der Rückkehr gegen die Rechnung verschoben ist (Grenze 1)
  hoerbar_ms           Tod des alten Kerns (kill -9 bzw. SIGKILL des Watchdogs) bis zum ersten Ziel-Sample, ab dem
                       das Prüfsignal wieder bitgleich mit der Rechnung läuft (100 ms lang) (Grenze 250 ms)
  watchdog_ms          SIGSTOP bis „Watchdog timeout“ oder „Selbst-Waechter: SIGKILL“ im Journal (getoetet_von) (Grenze 450 ms; watchdog_ueber_250 zählt die
                       Eingriffe über der Zusage 250 ms aus ARCHITEKTUR §7, als Befund, nicht als Grenze)
  neustart_ms          Eingriff bis Empfang von /e/neustart beim gespeicherten Abonnenten. neustart_vor_herzschlag:
                       es kam, bevor der neue Kern einen Herzschlag des Abonnenten mit /k/willkommen der neuen
                       Generation beantwortete (ein Herzschlag, der in die Pause fiel, geht verloren und zählt nicht);
                       herzschlag_antwort_ms: Eingriff bis zu dieser Antwort (ohne gespeicherte Abonnenten der
                       frühestmögliche Zeitpunkt, bis zu 2 s)
  neustarts            NRestarts der Unit gegen die Zahl der Eingriffe
  graph_luecke         der Aufnehmer sah im Fenster eines Eingriffs (3 s davor bis zum nächsten) einen Sprung des
                       Treiber-Frames (Treiberwechsel, Xrun des ganzen Graphen): der Eingriff ist nicht beurteilbar,
                       der Lauf gilt als Instrument-Fehler (wiederholen). Den Versatz Aufnahme − Kern-Sample misst
                       jeder Eingriff aus den Klicks seiner eigenen 3 s davor, damit eine Lücke früher im Lauf nicht
                       weiterträgt.

Aufruf: auswertung.py <lauf-ordner> [--nur-bericht]
Rückgabe: 0 alle Grenzen gehalten, 1 mindestens eine gerissen, 2 Instrument unbrauchbar.
"""
import json
import math
import os
import re
import sys

import numpy as np

RATE = 48000
BLOCK = 256    # Quantum der Serien (serie.sh: pw-jack -p 256)
GLEICH = 1e-4  # Rest des Prüfsignals, unter dem ein Sample als gleich gilt (ein Versatz um 1 Sample gibt ~0,1)


# --- Uhr nach SCHNITTSTELLEN §1.3 --------------------------------------------------------------------------------
class Karte:
    """Konstant `bpm` ab Beat 0 bei Sample 0, optional eine Rampe (ab_beat, ziel_bpm, dauer_beats) danach konstant."""

    def __init__(self, bpm, rampe=None):
        self.bpm = bpm
        self.rampe = rampe
        if rampe:
            ab, ziel, dauer = rampe
            self.s_ab = 60.0 * RATE * ab / bpm
            self.T = dauer * 60.0 / ((bpm + ziel) / 2.0)
            self.k = (ziel - bpm) / self.T
            self.b_ende = ab + dauer
            self.s_ende = self.s_ab + RATE * self.T
            self.ziel = ziel

    def sample_at(self, b):
        if not self.rampe or b <= self.rampe[0]:
            return 60.0 * RATE * b / self.bpm
        ab, ziel, dauer = self.rampe
        if b <= self.b_ende:
            db = b - ab
            return self.s_ab + RATE * 120.0 * db / (self.bpm + math.sqrt(self.bpm ** 2 + 120.0 * self.k * db))
        return self.s_ende + 60.0 * RATE * (b - self.b_ende) / ziel

    def beat_at(self, s):
        if not self.rampe or s <= self.s_ab:
            return s * self.bpm / (60.0 * RATE)
        ab, ziel, dauer = self.rampe
        if s <= self.s_ende:
            dt = (s - self.s_ab) / RATE
            return ab + (self.bpm * dt + self.k * dt * dt / 2.0) / 60.0
        return self.b_ende + (s - self.s_ende) * ziel / (60.0 * RATE)

    def takt_frames(self, b_takt):
        return round(self.sample_at(b_takt + 4.0)) - round(self.sample_at(b_takt))


# --- Prüfsignal wie djk/kern/include/cypherdj/pruef_cue.h --------------------------------------------------------
M64 = np.uint64(0xFFFFFFFFFFFFFFFF)


def pruef_cue(s):
    """x(S) = 0,1·(k − 2^22)/2^22, k = splitmix64(S) >> 41; bitgleich zur C++-Rechnung (float32)."""
    x = np.asarray(s, dtype=np.int64).astype(np.uint64)
    with np.errstate(over="ignore"):
        x = x + np.uint64(0x9E3779B97F4A7C15)
        x = (x ^ (x >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
        x = (x ^ (x >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
        x = x ^ (x >> np.uint64(31))
    k = (x >> np.uint64(41)).astype(np.int64) - 4194304
    return k.astype(np.float32) * np.float32(np.float32(0.1) / np.float32(4194304.0))


# --- Hilfen ------------------------------------------------------------------------------------------------------
def jsonl(pfad):
    if not os.path.exists(pfad):
        return []
    aus = []
    for z in open(pfad):
        z = z.strip()
        if z:
            try:
                aus.append(json.loads(z))
            except json.JSONDecodeError:
                pass
    return aus


def klick_einsaetze(x, schwelle=0.05, ruhe=200):
    """Indizes, an denen |x| die Schwelle überschreitet und die `ruhe` Samples davor unter 0,01 lagen."""
    a = np.abs(x)
    kand = np.flatnonzero((a[1:] > schwelle) & (a[:-1] <= schwelle)) + 1
    laut = np.concatenate(([0], np.cumsum(a >= 0.01)))
    aus = [int(i) for i in kand if i >= ruhe and laut[i] - laut[i - ruhe] == 0]
    return np.array(aus, dtype=np.int64)


def stille_laeufe(x, schwelle=1e-3, mindest=48):
    """Liste (anfang, laenge) aller Läufe mit |x| < schwelle von mindestens `mindest` Samples."""
    leise = np.abs(x) < schwelle
    if not leise.any():
        return []
    d = np.diff(np.concatenate(([0], leise.astype(np.int8), [0])))
    anf = np.flatnonzero(d == 1)
    end = np.flatnonzero(d == -1)
    return [(int(a), int(e - a)) for a, e in zip(anf, end) if e - a >= mindest]


def journal_zeiten(pfad, muster):
    """CLOCK_MONOTONIC in ns aller Journal-Zeilen (short-monotonic), die `muster` enthalten."""
    aus = []
    if not os.path.exists(pfad):
        return aus
    for z in open(pfad, errors="replace"):
        m = re.match(r"\[\s*(\d+)\.(\d+)\]", z)
        if m and muster in z:
            aus.append(int(m.group(1)) * 1_000_000_000 + int(m.group(2).ljust(9, "0")[:9]))
    return aus


# --- Auswertung --------------------------------------------------------------------------------------------------
def werte(o):
    lauf = json.load(open(os.path.join(o, "lauf.json")))
    meta = json.load(open(os.path.join(o, "ziel.f32.json")))
    roh = np.fromfile(os.path.join(o, "ziel.f32"), dtype=np.float32)
    x = roh[: len(roh) // 4 * 4].reshape(-1, 4)
    ereignisse = [e for e in jsonl(os.path.join(o, "ereignisse.jsonl")) if "t_ns" in e]
    abo = jsonl(os.path.join(o, "abonnent.jsonl"))
    karte = Karte(lauf["bpm"], lauf["rampe"])
    t0 = meta["erster_mono_ns"]
    frame = lambda t: int(round((t - t0) * RATE / 1e9))  # noqa: E731  Aufnahme-Index eines Zeitpunkts
    ergebnis = {"lauf": lauf["lauf"], "art": lauf["art"], "instrument": {}, "ereignisse": [], "grenzen": {}}
    ins = ergebnis["instrument"]
    ins["aufnahme_frames"] = int(x.shape[0])
    ins["aufnahme_luecken"] = meta["luecken"]
    ins["aufnahme_ueberlauf"] = meta["ueberlauf"]
    luecken_bei = meta.get("luecken_bei")  # [[Index in der Datei, fehlende Treiber-Frames], ...]; ältere Aufnehmer: fehlt
    ins["aufnahme_luecken_bei"] = luecken_bei

    # Beginn der Zeitachse: /q gestartet (2) auf /k/set/neu (FORMAT.md Punkt 2; ein Kern, der auch 3 schickt, zählt ab 2)
    set_neu_id = next((m["w"][0] for m in abo if m.get("gesendet") == "/k/set/neu"), None)
    t_set = next((m["t"] for m in abo if m.get("adr") == "/q" and m["w"][0] == set_neu_id and m["w"][2] in (2, 3)), None)
    if t_set is None:
        ins["fehler"] = "kein /q gestartet auf /k/set/neu"
        return ergebnis, 2
    uhr = [(m["t"], m["w"][0], m["w"][1]) for m in abo if m.get("adr") == "/uhr" and m["t"] > t_set]
    uhr_np = np.array([(u[2], u[1]) for u in uhr], dtype=np.float64)  # (mono_ns des Blocks, Kern-Sample)

    def kern_sample_bei(t):
        """Kern-Sample zur Zeit t nach dem letzten /uhr davor (nur zur Beat-Zuordnung, ±1 Block genau)."""
        j = np.searchsorted(uhr_np[:, 0], t) - 1
        j = max(j, 0)
        return uhr_np[j, 1] + (t - uhr_np[j, 0]) * RATE / 1e9

    i_start = max(frame(t_set) + RATE, 0)  # eine Sekunde nach /k/set/neu
    t_erster = ereignisse[0]["t_ns"] if ereignisse else None
    i_erster = frame(t_erster) if t_erster else x.shape[0]

    # Versatz Aufnahme-Index − Kern-Sample aus den Klicks vor dem ersten Eingriff
    eins = klick_einsaetze(x[:, 0])
    def versatz_je_klick(idx):
        aus = []
        for i in idx:
            t = t0 + i * 1e9 / RATE
            b = round(karte.beat_at(kern_sample_bei(t) - 512))  # Laufzeit Kern → Ziel rund zwei Blöcke
            aus.append((int(i), b, int(i) - int(round(karte.sample_at(b)))))
        return aus
    vor = [v for v in versatz_je_klick(eins[(eins > i_start) & (eins < i_erster - RATE // 10)])]
    if len(vor) < 4:
        ins["fehler"] = f"nur {len(vor)} Klicks vor dem ersten Eingriff"
        return ergebnis, 2
    d = np.array([v[2] for v in vor])
    D = int(np.median(d))
    ins["versatz_samples"] = D
    ins["versatz_streuung_vorher"] = int(np.max(np.abs(d - D)))
    ins["klicks_vorher"] = len(vor)

    # Prüfsignal: Rest gegen die Rechnung mit demselben Versatz
    cue = x[:, 2]
    rest = None
    if lauf["pruef_cue"]:
        s = np.arange(x.shape[0], dtype=np.int64) - D
        soll = pruef_cue(np.maximum(s, 0))
        rest = np.abs(cue - soll)
        rv = rest[i_start:i_erster - RATE // 10]
        ins["cue_rest_max_vorher"] = float(rv.max()) if rv.size else None
        stille = stille_laeufe(cue[i_start:])
        ins["stille_gesamt_ms"] = sum(l for _, l in stille) * 1000.0 / RATE

    # Journal: Watchdog-Tode
    j = os.path.join(o, "journal.txt")
    t_unit = next((int(z.split()[1]) for z in open(os.path.join(o, "lauf.txt")) if z.startswith("t_unit_ns")), 0) \
        if os.path.exists(os.path.join(o, "lauf.txt")) else 0
    wd = [t for t in journal_zeiten(j, "Watchdog timeout") if t >= t_unit]  # nur dieser Lauf, nicht der Unit-Vorgänger
    ins["watchdog_tode"] = len(wd)
    # Selbst-Wächter (Stand 18, --waechter-ms): seine Zeile steht im Journal des Kerns, kurz vor seinem SIGKILL
    sw = [t for t in journal_zeiten(j, "Selbst-Waechter: SIGKILL") if t >= t_unit]
    ins["waechter_tode"] = len(sw)
    unit = open(os.path.join(o, "unit.txt")).read() if os.path.exists(os.path.join(o, "unit.txt")) else ""
    m = re.search(r"NRestarts=(\d+)", unit)
    ins["neustarts"] = int(m.group(1)) if m else None

    # Telemetrie des Kerns (§5.4, /zustand/kern ,iihiiiiiiii): Callback-Maximum und p99 je Sekunde, Frame-Lücken
    zk = [m["w"] for m in abo if m.get("adr") == "/zustand/kern" and m["t"] > t_set]
    if zk:
        ins["kern_cb_max_us"] = max(w[5] for w in zk)
        ins["kern_cb_p99_us_max"] = max(w[6] for w in zk)
        ins["kern_aufwach_max_us"] = max(w[7] for w in zk)
        ins["kern_frame_luecken_max"] = max(w[3] for w in zk)
    for n, e in enumerate(ereignisse):
        t_e = e["t_ns"]
        t_naechst = ereignisse[n + 1]["t_ns"] if n + 1 < len(ereignisse) else t0 + x.shape[0] * 1e9 / RATE
        r = {"i": e["i"], "art": e["art"]}
        # Tod des alten Kerns: kill -9 sofort, SIGSTOP beim Watchdog-SIGKILL
        t_tod = t_e
        if e["art"] == "stop":
            w = sorted((t, "systemd") for t in wd if t_e < t < t_naechst)
            w += sorted((t, "selbst") for t in sw if t_e < t < t_naechst)
            w.sort()
            r["watchdog_ms"] = (w[0][0] - t_e) / 1e6 if w else None
            r["getoetet_von"] = w[0][1] if w else None
            t_tod = w[0][0] if w else t_e
        i_e, i_n = frame(t_e), min(frame(t_naechst), x.shape[0])
        # Versatz dieses Eingriffs aus den Klicks der 3 s davor (eine Graph-Lücke früher im Lauf trägt nicht weiter)
        vor_e = versatz_je_klick(eins[(eins > max(i_e - 3 * RATE, i_start)) & (eins < i_e - RATE // 10)])
        D_e = int(np.median([v[2] for v in vor_e])) if len(vor_e) >= 3 else D
        r["versatz_samples"] = D_e
        r["graph_luecke"] = any(max(i_e - 3 * RATE, 0) <= li < i_n for li, _ in (luecken_bei or []))
        # /e/neustart beim gespeicherten Abonnenten
        ns = [m for m in abo if m.get("adr") == "/e/neustart" and t_e < m["t"] < t_naechst]
        wk = [m for m in abo if m.get("adr") == "/k/willkommen" and t_e < m["t"] < t_naechst and m["w"][1] >= 1]
        r["herzschlag_antwort_ms"] = (wk[0]["t"] - t_e) / 1e6 if wk else None
        if ns:
            r["neustart_ms"] = (ns[0]["t"] - t_e) / 1e6
            r["neustart_generation"] = ns[0]["w"][0]
            r["neustart_vor_herzschlag"] = not wk or ns[0]["t"] < wk[0]["t"]
            # erste /uhr der neuen Generation: Sample ab dem ersten Sample der Generation (alte /uhr unterwegs
            # tragen kleinere Samples)
            erste_neue = next((m for m in abo if m.get("adr") == "/uhr" and t_e < m["t"] < t_naechst
                               and m["w"][0] >= ns[0]["w"][1]), None)
            r["neustart_zuerst"] = erste_neue is None or ns[0]["t"] <= erste_neue["t"]
        else:
            r["neustart_ms"] = None
            r["neustart_vor_herzschlag"] = False
        # Rückkehr: Prüfsignal wieder gleich der Rechnung, 4800 Samples lang; gesucht mit Versatz v in ±8 Samples,
        # damit auch eine Rückkehr neben dem Raster gefunden und ihr Versatz gemessen wird
        if rest is not None:
            gut0 = np.abs(cue[i_e:i_n] - pruef_cue(np.maximum(np.arange(i_e, i_n, dtype=np.int64) - D_e, 0))) < GLEICH
            abw = np.flatnonzero(~gut0)          # erste Abweichung: dort beginnt die Unterbrechung
            beste = None
            if abw.size:
                a0 = i_e + int(abw[0])
                ende = min(i_n, a0 + 2 * RATE)   # Rückkehr muss binnen 2 s kommen, sonst gilt sie als ausgeblieben
                basis = pruef_cue(np.maximum(np.arange(a0 - 8, ende + 8, dtype=np.int64) - D_e, 0))
                seg = cue[a0:ende]
                for v in range(-8, 9):
                    soll_v = basis[8 - v:8 - v + (ende - a0)]
                    gut = (np.abs(seg - soll_v) < GLEICH).astype(np.int64)
                    if gut.size < 4800:
                        continue
                    c = np.concatenate(([0], np.cumsum(gut)))
                    k = np.flatnonzero(c[4800:] - c[:-4800] == 4800)
                    if k.size and (beste is None or a0 + int(k[0]) < beste[0]):
                        beste = (a0 + int(k[0]), v)
            if beste:
                i_r, v = beste
                r["hoerbar_ms"] = (i_r - frame(t_tod)) * 1000.0 / RATE
                r["unterbrochen_ms"] = (i_r - (i_e + int(abw[0]))) * 1000.0 / RATE
                r["cue_abw_samples"] = v
            else:
                r["hoerbar_ms"] = None
                r["cue_abw_samples"] = None
            st = stille_laeufe(cue[i_e:i_n])
            r["stille_samples"] = int(sum(l for _, l in st))
            r["stille_ms"] = r["stille_samples"] * 1000.0 / RATE
        # Klick-Raster nach der Rückkehr (Klicks ab 0,5 s nach dem Eingriff bis zum nächsten)
        nach = eins[(eins > i_e + RATE // 2) & (eins < i_n - RATE // 10)]
        vs = versatz_je_klick(nach)
        if vs:
            dv = [v[2] - D_e for v in vs]
            r["raster_abw_samples"] = int(max(dv, key=abs))
            # gegen den Versatz vor dem ersten Eingriff: ein Versatz, der sich über viele Neustarts aufsummiert
            r["raster_abw_gesamt_samples"] = int(max((v[2] - D for v in vs), key=abs))
            r["klicks_nach"] = len(vs)
            # Phasensprung im Schlagraster (für den Fehlerfall: Kern ohne Zustand beginnt bei Beat 0)
            schlag = karte.sample_at(1.0)
            r["raster_sprung_phase"] = int(round((dv[0] + schlag / 2) % schlag - schlag / 2))
        else:
            r["raster_abw_samples"] = None
            r["klicks_nach"] = 0
        ergebnis["ereignisse"].append(r)

    # Grenzen
    g = ergebnis["grenzen"]
    ev = ergebnis["ereignisse"]
    def alle(feld, pruef):  # nur beurteilbare Eingriffe (ohne Graph-Lücke im Fenster)
        vals = [e.get(feld) for e in ev if not e.get("graph_luecke")]
        return {"werte": vals, "ok": bool(vals) and all(v is not None and pruef(v) for v in vals)}
    if lauf["art"] in ("kill", "stop"):
        g["raster_abw_le_1"] = alle("raster_abw_samples", lambda v: abs(v) <= 1)
        if not meta["luecken"]:  # nach einer Graph-Lücke ist der Bezug vor dem ersten Eingriff verschoben
            g["raster_gesamt_le_1"] = alle("raster_abw_gesamt_samples", lambda v: abs(v) <= 1)
        g["neustart_vor_herzschlag"] = alle("neustart_vor_herzschlag", lambda v: v is True)
        g["neustarts_gleich_eingriffe"] = {"werte": [ins["neustarts"], len(ev)], "ok": ins["neustarts"] == len(ev)}
        if lauf["pruef_cue"]:
            if lauf["art"] == "kill":   # daneben: ein Absturz kostet höchstens einen Block (ADR 016 Nachtrag)
                g["stille_le_1_block"] = alle("stille_samples", lambda v: v <= BLOCK)
            else:                       # Hänger: bis der Watchdog tötet, wartet die Notbahn über die Kante mit (16)
                g["stille_le_450_ms"] = alle("stille_ms", lambda v: v <= 450)
            g["hoerbar_le_250_ms"] = alle("hoerbar_ms", lambda v: v <= 250)
            g["cue_abw_le_1"] = alle("cue_abw_samples", lambda v: abs(v) <= 1)
        if lauf["art"] == "stop":
            g["watchdog_le_450_ms"] = alle("watchdog_ms", lambda v: v <= 450)
            ins["watchdog_ueber_250"] = sum(1 for e in ev if (e.get("watchdog_ms") or 0) > 250)
    else:  # Ruhe: 0 Neustarts, kein Watchdog-Tod, Raster und Prüfsignal durchgehend
        spaeter = versatz_je_klick(eins[eins > i_start])
        dv = [v[2] - D for v in spaeter]
        g["neustarts_0"] = {"werte": [ins["neustarts"]], "ok": ins["neustarts"] == 0}
        g["watchdog_tode_0"] = {"werte": [ins["watchdog_tode"], ins["waechter_tode"]],
                                "ok": ins["watchdog_tode"] == 0 and ins["waechter_tode"] == 0}
        g["raster_abw_0"] = {"werte": [int(max(dv, key=abs)) if dv else None, len(dv)], "ok": bool(dv) and max(map(abs, dv)) == 0}
        if rest is not None:
            rmax = float(rest[i_start:].max())
            g["cue_gleich"] = {"werte": [rmax], "ok": rmax < GLEICH}
            g["stille_0_ms"] = {"werte": [ins["stille_gesamt_ms"]], "ok": ins["stille_gesamt_ms"] == 0}
    if meta["ueberlauf"] or ins["versatz_streuung_vorher"] > 1:
        ins["fehler"] = "Aufnehmer-Überläufe oder Versatz vorher gestreut"
        return ergebnis, 2
    betroffen = [e["i"] for e in ev if e.get("graph_luecke")]
    if meta["luecken"] and (luecken_bei is None or lauf["art"] == "ruhe" or betroffen):
        ins["fehler"] = (f"Graph-Lücke im Fenster der Eingriffe {betroffen}" if betroffen else
                         "Graph-Lücke im Lauf (Ruhe oder Aufnehmer ohne Lückenstellen)")
        return ergebnis, 2
    return ergebnis, 0 if all(v["ok"] for v in g.values()) else 1


def main():
    o = sys.argv[1]
    ergebnis, rc = werte(o)
    json.dump(ergebnis, open(os.path.join(o, "auswertung.json"), "w"), indent=1, default=str)
    ins = ergebnis["instrument"]
    print(f"lauf {ergebnis['lauf']} art {ergebnis['art']}: instrument {json.dumps(ins, default=str)}")
    for e in ergebnis["ereignisse"]:
        print("  " + " ".join(f"{k}={v:.1f}" if isinstance(v, float) else f"{k}={v}" for k, v in e.items()))
    for k, v in ergebnis["grenzen"].items():
        print(f"{'PASS' if v['ok'] else 'FAIL'} {k} {v['werte']}")
    print("ERGEBNIS", {0: "GRUEN", 1: "ROT", 2: "INSTRUMENT"}[rc])
    sys.exit(rc)


if __name__ == "__main__":
    main()
