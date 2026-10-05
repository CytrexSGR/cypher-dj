#!/usr/bin/env python3
"""Auswertung der Läufe der Scheibe 35 am Ziel (ziel_hand.py). Liest aus dem Laufordner:
  abonnent.jsonl   alles vom Kern mit Empfangszeit (auch /uhr: Kern-Sample gegen CLOCK_MONOTONIC, §5.2)
  ziel.f32(.json)  Aufnahme am Monitor der eigenen Senke, vier Kanäle (Master L/R, Cue L/R), dazu CLOCK_MONOTONIC des
                   ersten Frames (cypherdj-aufnehmer4, Scheibe 18)
  start.json       Kern-Sample s_start, an dem Deck 1 aus der Stille startet (Träger rechts setzt ein)
  senden.jsonl     Sendezeiten des Softcontrollers (--mess N --log, Scheibe 19: CC 1/7 = deck/1/fader, Wert i mod 128)

Messgerät: die Hülle e[n] = sqrt(y[n]² + y[n+1]²) des 12-kHz-Trägers (4 Samples je Periode) ist bei fester Verstärkung
konstant; ein Fader-Griff ist ein Sprung der Hülle.

Latenz-Definition (Plan 35 Task 1): die Aufnahme liegt um den festen Pfadversatz V hinter dem Kern-Sample. Die
Aufnahme wird über die Treiber-Zeit auf die Kern-Zeitachse gelegt (Kern-Sample s_a ihres ersten Frames, wie
tests/deck/ziel_lauf.py); V = F(Start) + s_a − s_start wird am Deck-Start gemessen (Stille → Träger) und als eigene Zahl
ausgegeben. Ein Sprung am Aufnahme-Frame F liegt am Kern-Sample S = F + s_a − V; Latenz L = T(S) − t_send mit T aus dem
/uhr des Blocks, der S enthält. Wer F statt S nimmt, misst V/48 ms mehr.

Grenzen:
  latenz    ≥ 250 Griffe mit Sprung, der erste Wert (0) ohne Sprung (§7.3 Punkt 2), p50 in [P50_MIN; P50_MAX] ms,
            Spanne ≤ 0,10 ms, kein Block-Befund; Gegenprobe: jede /e/hand, deren Griff einen Sprung hat, liegt auf
            dessen Sample (h − S in 0 bis 2 Samples, siehe GEGENPROBE_SAMPLES), Anteil 100 %, und mindestens --mindest-e-hand solcher /e/hand
  mutation  Fehlerfall „Folgeblock“ erkannt: ≥ 90 % der Sprünge auf demselben Rest mod 256 (Blockanfang), Spanne ≥ 4 ms,
            Maximum − p50 des grünen Laufs (--p50-bezug) in [4,67 − 0,6; 5,34 + 0,1] ms
            Lücke des Graphen (Aufnehmer luecken_bei, Kern /e/luecke) zwischen Deck-Start und letztem Griff: LEER
  play      Play und Cue: erster Klick auf dem nächsten Master-Beat ±1 Sample, Folgeklicks im Raster, Halt nach 480 Samples
  osc_aus   /test/hand ohne hand_osc: /e/protokollfehler unbekannte_adresse, Deck läuft weiter
  ruhe      0 /e/hand, 0 /e/taste, 0 Sprünge der Hülle nach dem Start, Überlauf der Kern-Hand 0 (Schlusszeile kern.err)
Rückgabe 0 GRÜN, 1 ROT, 2 Instrument oder Lauf unbrauchbar (LEER). Letzte Zeile GRUEN, ROT oder LEER.
Aufruf: auswertung_hand.py <lauf> --art latenz|mutation|ruhe [--p50-bezug MS] [--mindest-e-hand N]
"""
import argparse
import bisect
import json
import math
import pathlib
import sys

import numpy as np

SR = 48000
N = 256
P50_MIN, P50_MAX, SPANNE_MAX = 5.28, 5.36, 0.10
# Gegenprobe Kern gegen Ziel: das Ziel zeigt den Sprung 0 bis 2 Samples vor dem /e/hand-Sample. Gemessen im Lauf
# 2026-09-26 19:41 (172 /e/hand): h − S = 1 (99), 2 (73), nie 0 oder 3. Ursache: die Hülle über zwei Samples zeigt den Sprung
# je nach Phase des Trägers ein Sample früher (0 oder 1), und der Bezug V (Deck-Start) ist ein Träger-Einsatz durch
# den Kanalzug, dessen Filter ihn über drei Samples verschmieren (Hülle um den Einsatz 0; 0; 0,062; 0,131; 0,134 bei
# Plateau 0,158): der Einsatz liegt rund ein Sample später als der Sprung des Faders am selben Kern-Sample. Ein Block-
# Fehler (Folgeblock im Mittel 128 Samples, 1 ms = 48) bleibt weit außerhalb.
GEGENPROBE_SAMPLES = (0, 1, 2)


def lies_jsonl(p):
    out = []
    if not p.exists():
        return out
    for z in p.read_text(errors="replace").splitlines():
        try:
            out.append(json.loads(z))
        except json.JSONDecodeError:
            pass
    return out


def neue_zeitachse(ein):
    """Nachrichten ab dem letzten /uhr mit Sample 0 (die Zeitachse aus /k/set/neu des Treibers)."""
    k0 = None
    for k, z in enumerate(ein):
        if z.get("adresse") == "/uhr" and z["werte"][0] == 0:
            k0 = k
    return ein[k0:] if k0 is not None else []


class Uhr:
    """Kern-Sample ↔ CLOCK_MONOTONIC aus /uhr (Blockanfang, §5.2)."""

    def __init__(self, ein):
        paare = sorted({(z["werte"][0], z["werte"][1]) for z in ein if z.get("adresse") == "/uhr"})
        self.s = [p[0] for p in paare]
        self.t = [p[1] for p in paare]

    def zeit_ns(self, s):
        k = bisect.bisect_right(self.s, s) - 1
        if k < 0:
            return None
        return self.t[k] + (s - self.s[k]) * 1e9 / SR

    def sample(self, t_ns):
        k = bisect.bisect_right(self.t, t_ns) - 1
        if k < 0:
            return None
        return self.s[k] + (t_ns - self.t[k]) * SR / 1e9


def aufnahme(lauf):
    p = lauf / "ziel.f32"
    if not p.exists() or p.stat().st_size < 16 * SR:
        return None, None
    x = np.fromfile(p, dtype=np.float32)
    meta = json.loads((lauf / "ziel.f32.json").read_text())
    return x[: len(x) // 4 * 4].reshape(-1, 4), meta


def kern_sample_der_aufnahme(uhr_werte, t0):
    """Kern-Sample des ersten Aufnahme-Frames (wie tests/deck/ziel_lauf.py): Aufnehmer und Kern laufen im selben
    Graphen, ein Block t ns nach dem ersten Aufnahme-Block liegt round(t · 48 000 / 10⁹ / 256) · 256 Frames dahinter.
    Über die ersten 375 /uhr der Zeitachse; alle müssen dasselbe ergeben, sonst None."""
    kand = {int(w[0]) - int(round((w[1] - t0) * SR / 1e9 / N)) * N for w in uhr_werte[:375]}
    return kand.pop() if len(kand) == 1 else None


def huelle(r):
    r = r.astype(np.float64)
    return np.sqrt(r[:-1] ** 2 + r[1:] ** 2)


def sprung(e, lo, hi):
    """Stärkster Sprung der Hülle in [lo, hi): (Frame, vorher, nachher) oder None."""
    lo, hi = max(lo, 200), min(hi, len(e) - 200)
    if hi - lo < 10:
        return None
    d = np.abs(e[lo + 3:hi + 3] - e[lo - 3:hi - 3])
    n = lo + int(np.argmax(d))
    vor, nach = float(np.median(e[n - 150:n - 10])), float(np.median(e[n + 10:n + 150]))
    if abs(nach - vor) < 1e-6 + 2e-3 * max(vor, nach):
        return None
    for f in range(n - 12, n + 12):
        if abs(e[f] - vor) > 0.5 * abs(nach - vor):
            return f, vor, nach
    return None


def einsatz(e):
    """Frame, an dem der Träger aus der Stille einsetzt (Hülle über die Hälfte ihres Plateaus), und das Plateau."""
    an = np.nonzero(e > 1e-4)[0]
    if len(an) == 0:
        return None, None
    f0 = int(an[0])
    plateau = float(np.median(e[f0 + 100:f0 + 2100]))
    lo = max(f0 - 50, 0)
    return lo + int(np.argmax(e[lo:f0 + 50] > 0.5 * plateau)), plateau


def perzentil(w, q):
    s = sorted(w)
    return s[max(0, math.ceil(q / 100 * len(s)) - 1)]


def kern_schluss(lauf):
    """Schlusszeile des Kerns (JSON in kern.err) oder {}."""
    p = lauf / "kern.err"
    if not p.exists():
        return {}
    for z in reversed(p.read_text(errors="replace").splitlines()):
        if z.startswith("{") and '"zyklen"' in z:
            try:
                return json.loads(z)
            except json.JSONDecodeError:
                return {}
    return {}


def luecke_im_fenster(lauf, ein, meta, f_start, s_start, uhr, s_a, V):
    """Text, wenn der Aufnehmer (luecken_bei, Frames in der Datei) oder der Kern (/e/luecke, Kern-Sample) eine Lücke
    zwischen dem Deck-Start (V-Messung) und dem letzten Griff meldet, sonst ''."""
    sendungen = [z for z in lies_jsonl(lauf / "senden.jsonl") if z.get("typ") == "gesendet"]
    if not sendungen:
        return ""
    sp = uhr.sample(sendungen[-1]["t_send_us"] * 1000 + 6e6)
    if sp is None:
        return ""
    f_ende = int(round(sp)) - s_a + V + 700
    s_ende = int(round(sp)) + 700
    for pos, *_ in meta.get("luecken_bei", []):
        if f_start - 300 <= pos <= f_ende:
            return f"Aufnehmer, Frame {pos} (Fenster {f_start} bis {f_ende})"
    for z in ein:
        if z["adresse"] == "/e/luecke" and s_start <= z["werte"][0] <= s_ende:
            return f"Kern, Sample {z['werte'][0]} (Fenster {s_start} bis {s_ende})"
    return ""


def latenz(lauf, ein, uhr, e, V, s_a, erg, a):
    sendungen = [z for z in lies_jsonl(lauf / "senden.jsonl") if z.get("typ") == "gesendet"]
    lat, still, ohne, s_ziel, erster = [], 0, 0, [], None
    # erwarteter Aufnahme-Frame je Sendung (eine Periode später); gesucht wird nur bis zur Mitte zum Nachbarn, damit der
    # Sprung des nächsten Griffs nie für diesen zählt (Abstand der Sendungen 13 bis 47 ms, Softcontroller --mess)
    pred = []
    for z in sendungen:
        sp = uhr.sample(z["t_send_us"] * 1000 + 5.333e6)
        pred.append(None if sp is None else int(round(sp)) - s_a + V)
    for j, z in enumerate(sendungen):
        f_pred = pred[j]
        if f_pred is None:
            ohne += 1
            continue
        lo = f_pred - 400 if j == 0 or pred[j - 1] is None else max(f_pred - 400, (pred[j - 1] + f_pred) // 2)
        hi = (f_pred + 700 if j + 1 == len(pred) or pred[j + 1] is None
              else min(f_pred + 700, (f_pred + pred[j + 1]) // 2))
        s = sprung(e, lo, hi)
        if z["i"] == 0:
            erster = {"sprung": s is not None, "huelle": float(np.median(e[max(f_pred - 300, 0):f_pred + 600]))}
            continue
        if s is None:
            if float(np.max(e[lo:hi])) < 1e-5:
                still += 1  # Fader unter −60 dB vor und nach dem Griff (nach dem Umlauf 127 → 0): nichts zu sehen
            else:
                ohne += 1
            continue
        S = s[0] + s_a - V
        s_ziel.append(S)
        lat.append((uhr.zeit_ns(S) - z["t_send_us"] * 1000) / 1e6)
    erg.update({"gesendet": len(sendungen), "gemessen": len(lat), "stumm_vor_und_nach": still,
                "ohne_sprung": ohne, "erster_wert": erster})
    if not lat:
        return False
    erg["latenz_ms"] = {"p50": round(perzentil(lat, 50), 4), "min": round(min(lat), 4), "max": round(max(lat), 4),
                        "spanne": round(max(lat) - min(lat), 4), "p95": round(perzentil(lat, 95), 4)}
    # Block-Befund: im richtigen Fall verteilt sich S mod 256 (Versatz im Zyklus) über alle Reste; wirkt jeder Griff am
    # Anfang des Folgeblocks, landen alle auf demselben Rest (0, wenn V den Pfad des Fader-Griffs genau trifft)
    reste = np.bincount(np.asarray(s_ziel, dtype=np.int64) % N, minlength=N)
    rest = int(np.argmax(reste))
    erg["block_rest"] = {"rest": rest, "anteil": round(float(reste[rest]) / len(s_ziel), 4),
                         "verschiedene_reste": int(np.count_nonzero(reste))}
    erg["befund"] = "folgeblock" if reste[rest] >= 0.9 * len(s_ziel) else "versatz"
    # Gegenprobe Kern gegen Ziel: /e/hand (erstes, letztes Ereignis einer Geste, höchstens 20 Hz, §5.8; Nachzügler mit
    # dem Sample des letzten Griffs im Fenster) trägt das Sample eines Griffs
    hs = sorted(z["werte"][2] for z in ein if z["adresse"] == "/e/hand" and z["werte"][0] == "deck/1/fader")
    s_arr = np.asarray(sorted(s_ziel), dtype=np.int64)
    geprueft = gleich = 0
    abweichend = []
    for h in hs:
        k = int(np.searchsorted(s_arr, h))
        nah = [int(s_arr[i]) for i in (k - 1, k) if 0 <= i < len(s_arr)]
        if not nah:
            continue
        S = min(nah, key=lambda v: abs(v - h))
        if abs(S - h) > 300:
            continue  # /e/hand eines Griffs ohne Sprung (stumm): am Ziel nichts zu vergleichen
        geprueft += 1
        if h - S in GEGENPROBE_SAMPLES:
            gleich += 1
        else:
            abweichend.append([h, S])
    erg["e_hand"] = {"anzahl": len(hs), "mit_sprung": geprueft, "gleich": gleich,
                     "anteil": round(gleich / geprueft, 4) if geprueft else None, "abweichend": abweichend[:10],
                     "mindest": a.mindest_e_hand}
    lm = erg["latenz_ms"]
    if a.art == "latenz":
        return (len(lat) >= 250 and erster is not None and not erster["sprung"] and P50_MIN <= lm["p50"] <= P50_MAX
                and lm["spanne"] <= SPANNE_MAX and erg["befund"] == "versatz" and geprueft > 0 and gleich == geprueft
                and len(hs) >= a.mindest_e_hand)
    spaet = lm["max"] - a.p50_bezug
    erg["folgeblock_ms"] = {"max_ueber_p50_bezug": round(spaet, 4), "p50_bezug": a.p50_bezug}
    return (len(lat) >= 250 and erg["befund"] == "folgeblock" and lm["spanne"] >= 4.0
            and 4.67 - 0.6 <= spaet <= 5.34 + 0.1)


K_KLICK = 28  # Lage des Maximums der Klickform nach dem Einsatz (test_kern_midi: Klicklage 112 = Limiter-Vorhalt 84 + 28)
SPB = 22500   # Samples je Beat bei 128 BPM


def klicks_links(l):
    """Klicks links wie kern35.h klicks(): Lage des Betragsmaximums in den 200 Samples nach dem ersten |x| > 0,05."""
    a = np.abs(l)
    cand = np.nonzero(a > 0.05)[0]
    out, i = [], 0
    while i < len(cand):
        n = int(cand[i])
        out.append(n + int(np.argmax(a[n:n + 200])))
        i = int(np.searchsorted(cand, n + 1000))
    return out


def play(lauf, ein, uhr, x, s_a, st, erg):
    """Play und Cue am Ziel (Plan 35 Task 5). Bezug ist der Start des Decks vom Leitstand-Weg auf einem ganzen Beat: die
    Klicklage D = erster Klick − s_start (Pfad, Limiter-Vorhalt, Lage des Maximums) gilt für jeden Klick dieses Laufs.
    Play stehend: erster Klick auf dem nächsten Master-Beat (D + B · 22 500) ±1 Sample, die Folgeklicks im Raster;
    Halt (Cue laufend, Play laufend): der Träger rechts ist 480 Samples nach der Taste still (Rampe), danach bleibt es still
    bis zum nächsten Schritt. Die Zeit der Tasten kommt aus dem Softcontroller-Schreiben plus 5,29 ms (Latenz aus Task 2),
    die der /test/hand-Griffe aus ihrem Sample."""
    sc = lies_jsonl(lauf / "schritte.jsonl")
    kl = [int(m) + s_a for m in klicks_links(x[:, 0])]
    e = huelle(x[:, 1])
    s_start = st["s_start"]
    ref = [g for g in kl if g >= s_start - 2000][:6]
    if len(ref) < 6 or not sc:
        erg["fehler"] = "Bezugsklicks oder Schritte fehlen"
        return False
    D = ref[0] - s_start
    ref_abw = [ref[j] - ref[0] - j * SPB for j in range(6)]
    erg.update({"klicklage_D": D, "klicklage_D_mod_256": D % N, "bezug_abweichung": ref_abw})
    ok = all(abs(v) <= 1 for v in ref_abw)
    zeiten = []
    for z in sc:
        zeiten.append(uhr.sample(z["t_ns"] + 5.29e6) if "t_ns" in z else float(z["sample"]))
    schritte = []

    def frame_von_t(t):
        return int(round(t + (D - K_KLICK) - s_a))

    for k, z in enumerate(sc):
        S = zeiten[k]
        r = {"schritt": z["schritt"], "S": round(S, 1)}
        naechster = zeiten[k + 1] - 300 if k + 1 < len(sc) else S + 40000
        if z["schritt"].startswith("play_beat") or z["schritt"] == "osc_play":
            phase = (S / SPB) % 1.0
            B = int(math.ceil(S / SPB))
            nach = [c for c in kl if c - D > S]
            c1 = nach[0] if nach else None
            r.update({"phase": round(phase, 3), "beat_erwartet": B})
            if c1 is None:
                r["ok"] = False
            else:
                abw = c1 - D - B * SPB
                folge = []
                for j in range(1, 4):
                    ziel = c1 + j * SPB
                    nah = min(kl, key=lambda c: abs(c - ziel))
                    folge.append(nah - ziel)
                davor = [c for c in kl if S + D < c < B * SPB + D - 5]
                r.update({"erster_klick_abweichung": abw, "folge_abweichung": folge, "klicks_vor_dem_beat": len(davor)})
                r["ok"] = (0.1 <= phase <= 0.9 and abs(abw) <= 1 and all(abs(v) <= 1 for v in folge) and not davor)
        else:  # Halt: Cue laufend, Play laufend
            f0 = frame_von_t(S)
            lauf_vor = float(np.median(e[f0 - 900:f0 - 300]))
            stille = np.nonzero(e[f0:f0 + 6000] < 1e-3)[0]
            f_sil = f0 + int(stille[0]) if len(stille) else None
            dt = None if f_sil is None else f_sil - f0
            f1 = frame_von_t(naechster)
            danach = float(np.max(e[f_sil + 60:f1])) if f_sil is not None and f_sil + 60 < f1 else None
            klicks_danach = [c for c in kl if S + D + 1300 < c < naechster + D]
            genau = "sample" in z  # /test/hand: das Sample ist exakt, die Taste hat 5,29 ms ± Jitter
            lo, hi = (440, 520) if genau else (0, 1300)
            r.update({"traeger_vorher": round(lauf_vor, 4), "stille_nach_samples": dt, "traeger_danach_max": danach,
                      "klicks_danach": len(klicks_danach)})
            r["ok"] = (lauf_vor > 0.1 and dt is not None and lo <= dt <= hi and danach is not None and danach < 1e-3
                       and not klicks_danach)
        ok = ok and bool(r["ok"])
        schritte.append(r)
    erg["schritte"] = schritte
    return ok


def griffe_finden(sendungen, uhr, e, A):
    """Sprünge der Hülle je Griff. A = Aufnahme-Frame − Kern-Sample des Pfads (Frame = S + A). Rückgabe je Griff
    (Index, Frame des Sprungs oder None, Latenz in ms oder None). Suchfenster wie latenz(): eine Periode nach dem Senden,
    bis zur Mitte zum Nachbarn."""
    pred = []
    for z in sendungen:
        sp = uhr.sample(z["t_send_us"] * 1000 + 5.333e6)
        pred.append(None if sp is None else int(round(sp)) + A)
    aus = []
    for j, z in enumerate(sendungen):
        if pred[j] is None:
            aus.append((z["i"], None, None))
            continue
        lo = pred[j] - 400 if j == 0 or pred[j - 1] is None else max(pred[j] - 400, (pred[j - 1] + pred[j]) // 2)
        hi = (pred[j] + 700 if j + 1 == len(pred) or pred[j + 1] is None
              else min(pred[j] + 700, (pred[j] + pred[j + 1]) // 2))
        sp = sprung(e, lo, hi)
        if sp is None:
            aus.append((z["i"], None, None))
            continue
        S = sp[0] - A
        aus.append((z["i"], sp[0], (uhr.zeit_ns(S) - z["t_send_us"] * 1000) / 1e6))
    return aus


def neustart(lauf, ein, x, st, f_start, meta, erg):
    """Hand über einen Kern-Neustart (Plan 35 Task 7). kill -9 auf den Kern der Unit (Restart=always, RestartSec=0),
    Softcontroller sendet durch. Geprüft: neuer Client → hand_in verbunden ≤ 500 ms (Zeiten aus kern.err, CLOCK_MONOTONIC),
    Mapping neu geladen, erster Griff nach der Verbindung ohne Sprung und ohne /e/hand, danach Sprünge am Ziel mit der Latenz
    des Laufs vor dem Kill (p50 Unterschied ≤ 0,08 ms, absolut im Fenster von Task 2 ± 0,06 ms). Aufnahme-Bezug je
    Generation: vor dem Kill der Deck-Start (A = f_start − s_start, wie Task 2), danach der Wiedereinsatz des Trägers am
    ersten Kern-Sample der neuen Generation (Lücke des Aufnehmers), weil Frames der Aufnahme und Samples des neuen Kerns
    danach um eine beliebige Zahl gegeneinander liegen."""
    import re
    sc = lies_jsonl(lauf / "schritte.jsonl")
    kill = next((z for z in sc if z["schritt"] == "kill"), None)
    err = (lauf / "kern.err").read_text(errors="replace")
    oeffnet = [int(m) for m in re.findall(r"öffnet \(mono_ns (\d+)\)", err)]
    laeuft = [int(m) for m in re.findall(r"läuft: .*mono_ns (\d+)", err)]
    hands = [(int(a), int(b)) for a, b in re.findall(r"Hand: .* verbunden \(mono_ns (\d+), Verbindung (\d+)\)", err)]
    mappings = len(re.findall(r"Mapping .*: Gerät softcontroller, 44 Einträge", err))
    if kill is None or len(oeffnet) != 2 or len(laeuft) != 2 or len(hands) < 1:
        erg["fehler"] = "kein kill oder nicht genau zwei Kern-Starts in kern.err"
        erg["kern_err_starts"] = {"oeffnet": len(oeffnet), "laeuft": len(laeuft), "hand": len(hands)}
        return None
    t_kill = kill["t_ns"]
    hand2 = [t for t, n in hands if t > laeuft[0] and t > t_kill]
    t_conn = hand2[0] if hand2 else None
    verzug = None if t_conn is None else (t_conn - oeffnet[1]) / 1e6
    erg.update({"neustart_erkannt_nach_ms": round((oeffnet[1] - t_kill) / 1e6, 1),
                "hand_verbunden_nach_client_ms": None if verzug is None else round(verzug, 2),
                "hand_verbunden_nach_laeuft_ms": None if t_conn is None else round((t_conn - laeuft[1]) / 1e6, 2),
                "mapping_geladen": mappings, "kern_starts": 2})
    ein_nz = neue_zeitachse(ein)
    uhr = Uhr(ein_nz)
    nach = [z["werte"] for z in ein_nz if z["adresse"] == "/uhr" and z["werte"][1] > t_kill]
    if not nach:
        erg["fehler"] = "kein /uhr nach dem Neustart"
        return False
    s_f = min(w[0] for w in nach)
    e = huelle(x[:, 1])
    A1 = f_start - st["s_start"]
    sendungen = [z for z in lies_jsonl(lauf / "senden.jsonl") if z.get("typ") == "gesendet"]
    vor = [z for z in sendungen if z["t_send_us"] * 1000 + 6e6 < t_kill and z["i"] > 0]
    dahinter = [z for z in sendungen if t_conn is not None and z["t_send_us"] * 1000 + 5.3e6 >= t_conn]
    verloren = [z for z in sendungen if z["t_send_us"] * 1000 + 6e6 >= t_kill and (t_conn is None or
                z["t_send_us"] * 1000 + 5.3e6 < t_conn)]
    erg.update({"griffe_vor_kill": len(vor), "griffe_verloren": len(verloren), "griffe_nach_verbindung": len(dahinter)})
    g1 = griffe_finden(vor, uhr, e, A1)
    lat1 = [g[2] for g in g1 if g[2] is not None]
    # Wiedereinsatz des Trägers: die Lücke des Aufnehmers, hinter der er wieder klingt
    f_on = None
    for p, *_ in meta.get("luecken_bei", []):
        if p < 1000 or p + 6000 > len(e):
            continue
        stille = np.nonzero(e[p - 300:p + 2000] < 1e-3)[0]  # der Kern ist tot: Stille um die Lücke des Aufnehmers
        if len(stille) < 100:
            continue
        s0 = p - 300 + int(stille[0])
        for f in range(s0 + 20, min(s0 + 4000, len(e) - 1600)):
            if e[f] > 0.5 * float(np.median(e[f + 100:f + 1500])) > 1e-4:
                f_on = f
                break
        if f_on is not None:
            break
    if f_on is None:
        erg["fehler"] = "Wiedereinsatz des Trägers nach dem Neustart nicht gefunden"
        return False
    A2_on = f_on - s_f
    # Bezug nach dem Neustart: das Klickraster des wieder eingeblendeten Decks (links, ein Klick je Beat auf dem Raster der
    # Zeitachse, Lage K_KLICK nach dem Einsatz), gegen dieselbe Lage vor dem Kill. Frames der Aufnahme und Samples des
    # neuen Kerns liegen nach dem Neustart um eine beliebige Zahl gegeneinander (die Zeitachse setzt sich über die
    # Uhr fort), der Wiedereinsatz des Trägers trägt den Vorhalt des Limiters und ist darum kein Bezug (Befund).
    kl = np.array(klicks_links(x[:, 0]))
    rest = (kl - K_KLICK - A1) % SPB
    rest = np.where(rest > SPB // 2, rest - SPB, rest)  # Abweichung von der Lage vor dem Kill in (−SPB/2, SPB/2]
    d_vor = rest[kl < f_on - 3000]
    d_nach = rest[kl > f_on + 3000]
    if len(d_vor) < 10 or len(d_nach) < 10:
        erg["fehler"] = "zu wenige Klicks vor oder nach dem Neustart"
        return False
    A2 = A1 + int(round(float(np.median(d_nach)) - float(np.median(d_vor))))
    # Gegenprobe unabhängig vom Klickraster: die Sprünge der Griffe liegen zum /e/hand-Sample des Kerns im selben Abstand
    hs = sorted((z["werte"][2], z["t_ns"]) for z in ein_nz if z["adresse"] == "/e/hand" and z["werte"][0] == "deck/1/fader")

    def abstand(sel, A):
        res = []
        for h, tn in hs:
            if sel(tn):
                sp = sprung(e, h + A - 1200, h + A + 1200)
                if sp:
                    res.append(sp[0] - h)
        return (int(np.median(res)), len(res)) if res else (None, 0)

    abst_vor = abstand(lambda t: t < t_kill - 1e7, A1)
    abst_nach = abstand(lambda t: t > t_kill + 2e8, A2)
    erg.update({"A_vor_kill": A1, "A_nach_neustart": A2, "A_nach_neustart_ueber_wiedereinsatz": A2_on,
                "klickraster_verschiebung": A2 - A1, "sprung_minus_e_hand": {"vor": abst_vor, "nach": abst_nach},
                "wiedereinsatz_frame": f_on, "erstes_sample_neu": s_f})
    pegel_vor = float(np.median(e[f_on - 6000:f_on - 3000])) if f_on > 6000 else None
    pegel_nach = float(np.median(e[f_on + 100:f_on + 300]))
    g2 = griffe_finden(dahinter, uhr, e, A2)
    lat2 = [g[2] for g in g2[1:] if g[2] is not None]  # ohne den ersten Griff
    erster = g2[0] if g2 else None
    # der Wiedereinsatz des Trägers (Kern läuft wieder) liegt im Suchfenster des ersten Griffs und ist kein Griff
    erster_sprung = erster is not None and erster[1] is not None and abs(erster[1] - f_on) > 40
    # /e/hand nach der Verbindung: keine zum ersten Griff, dann welche
    hs = sorted(h for h, tn in hs if tn > t_kill)
    S_erster = None if not dahinter else uhr.sample(dahinter[0]["t_send_us"] * 1000 + 5.333e6)
    e_hand_erster = S_erster is not None and any(abs(h - S_erster) < 700 for h in hs)
    erg.update({"erster_griff_sprung": erster_sprung, "e_hand_zum_ersten_griff": e_hand_erster,
                "e_hand_nach_neustart": len(hs), "pegel_vor": None if pegel_vor is None else round(pegel_vor, 4),
                "pegel_nach": round(pegel_nach, 4),
                "latenz_vor_ms": {"n": len(lat1), "p50": round(perzentil(lat1, 50), 4) if lat1 else None,
                                  "spanne": round(max(lat1) - min(lat1), 4) if lat1 else None},
                "latenz_nach_ms": {"n": len(lat2), "p50": round(perzentil(lat2, 50), 4) if lat2 else None,
                                   "spanne": round(max(lat2) - min(lat2), 4) if lat2 else None}})
    if not lat1 or not lat2:
        return False
    p1, p2 = perzentil(lat1, 50), perzentil(lat2, 50)
    erg["latenz_unterschied_ms"] = round(p2 - p1, 4)
    return (verzug is not None and verzug <= 500.0 and mappings == 2 and not erster_sprung and not e_hand_erster
            and len(lat2) >= 0.8 * max(1, len(dahinter) - 1 - 20) and P50_MIN - 0.06 <= p2 <= P50_MAX + 0.06
            and abs(p2 - p1) <= 0.08 and (max(lat2) - min(lat2)) <= SPANNE_MAX + 0.05
            and abst_nach[0] is not None and abst_vor[0] is not None and abs(abst_nach[0] - (A2 - A1) - abst_vor[0]) <= 3
            and pegel_vor is not None and abs(pegel_nach - pegel_vor) <= 0.05 * pegel_vor + 0.02)


def spaet(lauf, ein, erg):
    """Controller nach dem Kern (Plan 35 E8): der Softcontroller startet, wenn der Kern schon läuft. Der Verbinder (alle
    500 ms) verbindet hand_in; danach kommen /e/hand auf den Fader-Tasten. Grenze: Verbindung höchstens 500 ms plus
    Anlaufzeit des Softcontrollers (ALSA-Client und Port, rund 100 ms) nach dem Start, mindestens ein /e/hand."""
    import re
    sc = lies_jsonl(lauf / "schritte.jsonl")
    t0 = sc[0]["t_ns"] if sc else None
    err = (lauf / "kern.err").read_text(errors="replace")
    hands = [int(a) for a, _ in re.findall(r"Hand: .* verbunden \(mono_ns (\d+), Verbindung (\d+)\)", err)]
    verzug = None if not hands or t0 is None else (hands[-1] - t0) / 1e6
    n_hand = sum(1 for z in ein if z["adresse"] == "/e/hand" and z["werte"][0] == "deck/1/fader")
    erg.update({"verbunden_nach_softcontroller_start_ms": None if verzug is None else round(verzug, 1),
                "verbindungen": len(hands), "e_hand": n_hand})
    return verzug is not None and 0 <= verzug <= 700 and n_hand >= 1


def mapping_tausch(lauf, ein, x, erg):
    """/k/mapping am Ziel (Plan 35 Task 8): /e/hand je Abschnitt zwischen den Schritten. Erwartet: vor dem Tausch
    deck/1/fader; nach tausch (Quittung 3) nur deck/2/fader; nach kaputt_ziel (Quittung 6 Grund pruefung, Text mit Zeile 5 in
    kern.err) weiter nur deck/2/fader (das alte gilt weiter); nach der Rückkehr zu softcontroller wieder deck/1/fader."""
    sc = lies_jsonl(lauf / "schritte.jsonl")
    t = {z["schritt"]: z["t_ns"] for z in sc}
    hs = [(z["t_ns"], z["werte"][0]) for z in ein if z["adresse"] == "/e/hand"]
    qs = {z["werte"][0]: z["werte"] for z in ein if z["adresse"] == "/q"}
    ids = {z["schritt"]: z.get("id") for z in sc}

    def pfade(von, bis):
        return sorted({p for tn, p in hs if t[von] < tn <= t[bis]})

    quitt = {}
    for n in ("mapping_tausch", "mapping_kaputt", "mapping_zurueck"):
        stat = [z["werte"][2] for z in ein if z["adresse"] == "/q" and z["werte"][0] == ids[n]]
        grund = [z["werte"][5] for z in ein if z["adresse"] == "/q" and z["werte"][0] == ids[n] and z["werte"][2] == 6]
        quitt[n] = {"status": stat, "grund": grund}
    err = (lauf / "kern.err").read_text(errors="replace")
    text = "kaputt_ziel.json: Zeile 5: unbekanntes_ziel: \"deck/1/fadr\"" in err
    abschnitte = {"vor_tausch": pfade("taste_q_1", "mapping_tausch"),
                  "nach_tausch": pfade("mapping_tausch_quittiert", "mapping_tausch_tasten"),
                  "nach_kaputt": pfade("mapping_kaputt_quittiert", "mapping_kaputt_tasten"),
                  "nach_zurueck": pfade("mapping_zurueck_quittiert", "mapping_zurueck_tasten")}
    erg.update({"e_hand_pfade": abschnitte, "quittungen": quitt, "fehlertext_mit_zeile_im_protokoll": text})
    return (abschnitte["vor_tausch"] == ["deck/1/fader"] and abschnitte["nach_tausch"] == ["deck/2/fader"]
            and abschnitte["nach_kaputt"] == ["deck/2/fader"] and abschnitte["nach_zurueck"] == ["deck/1/fader"]
            and quitt["mapping_tausch"]["status"][-1:] == [3] and 1 in quitt["mapping_tausch"]["status"]
            and quitt["mapping_kaputt"]["status"] == [6] and quitt["mapping_kaputt"]["grund"] == ["pruefung"]
            and quitt["mapping_zurueck"]["status"][-1:] == [3] and text)


def kaputt_start(lauf, ein, x, f_start, erg):
    """Start mit kaputtem Mapping: Kern läuft (Schlusszeile), Träger klingt (Deck spielt), Fehlertext mit Zeile in kern.err,
    0 /e/hand und keine Verbindung von hand_in."""
    err = (lauf / "kern.err").read_text(errors="replace")
    ks = kern_schluss(lauf)
    e = huelle(x[:, 1])
    pegel = float(np.median(e[f_start + 3000:len(e) - 4000]))
    n_hand = sum(1 for z in ein if z["adresse"] == "/e/hand")
    text = "kaputt_ziel.json: Zeile 5: unbekanntes_ziel: \"deck/1/fadr\"" in err and "Kern ohne Controller" in err
    erg.update({"fehlertext_mit_zeile": text, "e_hand": n_hand, "traeger_pegel": round(pegel, 4),
                "hand_verbindungen": err.count("Hand: "), "schlusszeile_zyklen": ks.get("zyklen"),
                "hand_neuverbindungen": ks.get("hand_neuverbindungen")})
    return text and n_hand == 0 and pegel > 0.1 and err.count("Hand: ") == 0 and ks.get("zyklen", 0) > 1000


def betrieb(lauf, ein, erg):
    """MVP-Schritt Betrieb: Kern ohne --konfig und ohne Prüfmodus (kern.err „Prüfmodus aus“, Konfiguration am Standardpfad der
    Instanz), Mapping aus dem Controller-Ordner, /e/hand auf deck/1/fader (Softcontroller-Taste) und auf deck/2/fader
    (/test/hand über hand_osc)."""
    err = (lauf / "kern.err").read_text(errors="replace")
    h1 = sum(1 for z in ein if z["adresse"] == "/e/hand" and z["werte"][0] == "deck/1/fader")
    h2 = sum(1 for z in ein if z["adresse"] == "/e/hand" and z["werte"][0] == "deck/2/fader")
    fehler = [z for z in ein if z["adresse"] == "/e/protokollfehler"]
    tasten = [(z["werte"][0], z["werte"][1]) for z in ein if z["adresse"] == "/e/taste"]
    erg.update({"e_taste": tasten, "e_hand_softcontroller_deck1": h1, "e_hand_test_hand_deck2": h2, "protokollfehler": len(fehler),
                "pruefmodus_aus": "Prüfmodus aus" in err, "konfig_standardpfad": "/.config/cypherdj-i/kern.toml" in err,
                "mapping_geladen": "softcontroller.json: Gerät softcontroller, 44 Einträge" in err})
    return (h1 >= 1 and h2 >= 1 and not fehler and tasten == [("annehmen", 1), ("verwerfen", 1)] and "Prüfmodus aus" in err and "/.config/cypherdj-i/kern.toml" in err
            and "softcontroller.json: Gerät softcontroller, 44 Einträge" in err)


def pegel(lauf, ein, x, st, erg):
    """/pegel am Ziel. Sinus 1 kHz, Amplitude 0,25, Fader −10 dB: erwartet 20 log10 0,25 − 10 = −22,04 dB für deck/1 und
    master (±0,1), gegen die Spitze der Aufnahme am Ausgang (unabhängig vom Kern) im selben Fenster; cue und leere Decks
    stumm oder ohne Meldung; nach dem Fader-Teil auf −200 unter −199 dB; Rate 20 Hz ±2."""
    sc = lies_jsonl(lauf / "schritte.jsonl")
    t_unten = next(z for z in sc if z["schritt"] == "fader_unten")["beat"] * SPB
    s_start = st["s_start"]
    pe = [(z["werte"][0], z["werte"][1], z["t_ns"]) for z in ein if z["adresse"] == "/pegel"]
    uhr = Uhr(neue_zeitachse(ein))

    def sample_von(t_ns):
        return uhr.sample(t_ns)

    def fenster(kanal, lo, hi):
        return [w for k, w, t in pe if k == kanal and (sample_von(t) or 0) >= lo and (sample_von(t) or 0) < hi]

    soll = 20 * math.log10(0.25) - 10.0
    stetig = (s_start + 3 * SPB, t_unten - 3000)
    d1, ma, cu = (fenster(k, *stetig) for k in ("deck/1", "master", "cue"))
    unten = (t_unten + 3 * SPB, t_unten + 5 * SPB)
    d1u, mau = fenster("deck/1", *unten), fenster("master", *unten)
    # Spitze der Aufnahme im stetigen Fenster: der Ausgang liegt V Frames hinter dem Kern-Sample (V mod 256 bekannt; die
    # Spitze eines stetigen Sinus hängt davon nicht ab), Fenster in Aufnahme-Frames über s_a und V
    s_a = kern_sample_der_aufnahme([z["werte"] for z in neue_zeitachse(ein) if z["adresse"] == "/uhr"],
                                   json.loads((lauf / "ziel.f32.json").read_text())["erster_mono_ns"])
    f0, f1 = stetig[0] - s_a + 512, stetig[1] - s_a - 512
    aufn = float(np.max(np.abs(x[f0:f1, 0:2])))
    aufn_db = 20 * math.log10(aufn) if aufn > 0 else -200.0
    aufn_unten = float(np.max(np.abs(x[(unten[0] - s_a + 1024):(unten[1] - s_a - 512), 0:2])))
    n_rate = len(fenster("deck/1", s_start + 3 * SPB, s_start + 3 * SPB + 48000 * 2))
    leer = [k for k, w, t in pe if k in ("deck/2", "deck/3", "deck/4")]
    med = lambda v: float(np.median(v)) if v else None  # noqa: E731
    erg.update({"soll_db": round(soll, 3), "deck1_median": med(d1), "master_median": med(ma), "cue_max": max(cu) if cu else None,
                "aufnahme_spitze_db": round(aufn_db, 3), "deck1_unten_max": max(d1u) if d1u else None,
                "master_unten_max": max(mau) if mau else None, "aufnahme_unten_linear": aufn_unten,
                "meldungen_je_2s": n_rate, "meldungen_leere_decks": len(leer), "n_deck1": len(d1)})
    return (d1 and ma and cu and abs(med(d1) - soll) <= 0.1 and abs(med(ma) - soll) <= 0.1
            and abs(aufn_db - med(ma)) <= 0.1 and max(cu) <= -199 and d1u and mau and max(d1u) <= -199
            and max(mau) <= -199 and aufn_unten < 1e-5 and 38 <= n_rate <= 42 and not leer)


def osc_aus(lauf, ein, uhr, x, s_a, st, erg):
    """Negativ-Kontrolle: /test/hand ohne hand_osc und ohne Prüfmodus: /e/protokollfehler unbekannte_adresse, der Träger
    läuft nach dem Griff weiter (die Cue-Taste über OSC hätte ihn nach 480 Samples stumm gemacht)."""
    sc = lies_jsonl(lauf / "schritte.jsonl")
    pf = [z["werte"] for z in ein if z["adresse"] == "/e/protokollfehler" and z["werte"][0] == "/test/hand"]
    e = huelle(x[:, 1])
    S = float(sc[0]["sample"]) if sc else 0.0
    # Träger: Kern-Sample des Decks ≈ Frame + s_a − V; hier nur „läuft weiter“ im Fenster 2 000 bis 30 000 Samples nach S
    V = int(erg["versatz_V"])
    f0 = int(round(S - s_a + V))
    lauf_danach = float(np.median(e[f0 + 2000:f0 + 30000]))
    erg.update({"protokollfehler": pf[:3], "traeger_danach_median": round(lauf_danach, 4)})
    return bool(pf) and all(w[1] == "unbekannte_adresse" for w in pf) and lauf_danach > 0.1


def ruhe(lauf, ein, e, f_start, erg):
    ks = kern_schluss(lauf)
    spr = []
    lo = f_start + 3000
    # Hülle in Fenstern zu 2 048 Frames: ein Sprung ändert den Median zweier Nachbarfenster um mehr als 1 %
    fen = [float(np.median(e[k:k + 2048])) for k in range(lo, len(e) - 4096, 2048)]
    for k in range(1, len(fen)):
        if fen[k - 1] > 1e-5 and abs(fen[k] - fen[k - 1]) > 0.01 * fen[k - 1]:
            spr.append(lo + k * 2048)
    erg.update({"spruenge": spr[:10], "n_spruenge": len(spr), "fenster": len(fen),
                "hand_ueberlauf": ks.get("hand_ueberlauf"), "hand_ohne_wirkung": ks.get("hand_ohne_wirkung")})
    return erg["hand"] == 0 and not erg["taste"] and not spr and len(fen) > 100 and ks.get("hand_ueberlauf") == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lauf")
    ap.add_argument("--art", required=True, choices=["latenz", "mutation", "ruhe", "play", "osc_aus", "neustart", "spaet", "mapping", "kaputt_start", "betrieb", "pegel"])
    ap.add_argument("--p50-bezug", type=float, default=5.333, help="p50 des grünen Laufs in ms (für mutation)")
    ap.add_argument("--mindest-e-hand", type=int, default=89,
                    help="Mindestzahl /e/hand aus Drossel (50 ms) und Sendeabständen, vorher gerechnet (Stand 35)")
    a = ap.parse_args()
    lauf = pathlib.Path(a.lauf)
    ein = neue_zeitachse(lies_jsonl(lauf / "abonnent.jsonl"))
    uhr = Uhr(ein)
    x, meta = aufnahme(lauf)
    erg = {"art": a.art, "lauf": str(lauf)}
    if x is None or not uhr.s or not (lauf / "start.json").exists():
        erg["fehler"] = "keine Aufnahme, kein /uhr der Zeitachse oder kein start.json"
        print(json.dumps(erg, ensure_ascii=False))
        print("LEER")
        return 2
    st = json.loads((lauf / "start.json").read_text())
    uw = [z["werte"] for z in ein if z["adresse"] == "/uhr"]
    s_a = kern_sample_der_aufnahme(uw, meta["erster_mono_ns"])
    e = huelle(x[:, 1])
    f_start, plateau = einsatz(e)
    erg.update({"frames": int(len(x)), "s_a": s_a, "s_start": st["s_start"],
                "hand": sum(1 for z in ein if z["adresse"] == "/e/hand"),
                "taste": [z["werte"] for z in ein if z["adresse"] == "/e/taste"]})
    if s_a is None or f_start is None:
        erg["fehler"] = "Aufnahme nicht auf die Kern-Zeitachse zu legen" if s_a is None else "kein Einsatz des Trägers"
        print(json.dumps(erg, ensure_ascii=False))
        print("LEER")
        return 2
    V = f_start + s_a - st["s_start"]
    # V ist nur modulo Block bestimmt (Kern-Sample der Aufnahme s_a auf den Block gerundet, kürzt sich in S = F + s_a − V
    # heraus); modulo 256 bleibt der Pfad: Limiter-Vorhalt 84 + Träger-Einsatz durch den Kanalzug
    erg.update({"versatz_V": V, "versatz_V_mod_256": V % N, "einsatz_frame": f_start, "plateau": round(plateau, 6)})
    meta_txt = (lauf / "lauf.meta").read_text() if (lauf / "lauf.meta").exists() else ""
    erg["fremdlast"] = [z for z in meta_txt.splitlines() if z.startswith("last_")]
    if a.art == "play":
        gruen = play(lauf, ein, uhr, x, s_a, st, erg)
    elif a.art == "neustart":
        gruen = neustart(lauf, ein, x, st, f_start, meta, erg)
        if gruen is None:
            print(json.dumps(erg, ensure_ascii=False))
            print("LEER")
            return 2
    elif a.art == "pegel":
        gruen = pegel(lauf, ein, x, st, erg)
    elif a.art == "betrieb":
        gruen = betrieb(lauf, ein, erg)
    elif a.art == "mapping":
        gruen = mapping_tausch(lauf, ein, x, erg)
    elif a.art == "kaputt_start":
        gruen = kaputt_start(lauf, ein, x, f_start, erg)
    elif a.art == "spaet":
        gruen = spaet(lauf, ein, erg)
    elif a.art == "osc_aus":
        gruen = osc_aus(lauf, ein, uhr, x, s_a, st, erg)
    elif a.art in ("latenz", "mutation"):
        luecke = luecke_im_fenster(lauf, ein, meta, f_start, st["s_start"], uhr, s_a, V)
        if luecke:
            # eine Lücke des Graphen zwischen V-Messung und Griffen verschiebt Aufnahme gegen Kern um einen Block (Befund
            # 2026-09-26: Verbindung von hand_in, V 341 → 85): der Lauf misst den Graphen, nicht die Hand
            erg["fehler"] = "Lücke des Graphen im Messfenster, Lauf ungültig: " + luecke
            print(json.dumps(erg, ensure_ascii=False))
            print("LEER")
            return 2
        gruen = latenz(lauf, ein, uhr, e, V, s_a, erg, a)
    else:
        gruen = ruhe(lauf, ein, e, f_start, erg)
    erg["urteil"] = "GRUEN" if gruen else "ROT"
    print(json.dumps(erg, ensure_ascii=False))
    print(erg["urteil"])
    return 0 if gruen else 1


if __name__ == "__main__":
    sys.exit(main())
